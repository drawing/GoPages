(function (ns) {
    'use strict';

    const CONFIG = ns.CONFIG;
    const letters = ns.utils.letters;
    const systems = ns.systems = ns.systems || {};

    class SpawnDirector {
        constructor(pool, level, options) {
            const opts = options || {};
            this.pool = pool;
            this.level = level;
            // 只有无尽模式接爬升曲线（MODES.climb），闯关模式速度与间隔恒定
            this.climb = !!opts.climb;
            this.acc = 0;
            this.last = null;
            this.stage = 0;
            this.sinceClimb = 0;
            this.speedRatio = 1;
            this.intervalRatio = 1;
            // level 是 levelFor 合成的本局生效档位（9a：档位物理 + 方案内容池），每次开局新建。
            // 爬升后的值只存在这几份派生字段上，生成与节奏一律读派生值，绝不写回共享表
            this.baseSpeed = level.speed;
            this.baseInterval = level.spawnInterval;
            this.speed = level.speed;
            this.interval = level.spawnInterval;
            // 单元方案（9e）：level.units 是 levelFor 合成好的「单元表 + 星面造型」，null 就是键位方案。
            // 大星体（96）比常规星多出来的那截半宽，生成边距与横向间隔都要算进去——
            // 与双星的 PAIR_SPAN 内缩同一条纪律，否则星体会挂在画布外或压在邻星身上
            this.units = level.units || null;
            this.bodyExtra = this.units ? (this.units.body - CONFIG.STAR_SIZE) / 2 : 0;
            this.counters = { spawned: 0, cap: 0, overlap: 0, empty: 0, letter: 0 };
        }

        // dt 由调用方 clamp 后传入：切标签页回来不会一次性补生成一堆星
        update(dt) {
            this.acc += dt * 1000;
            if (this.acc < this.interval) { return null; }
            this.acc -= this.interval;
            return this.spawn();
        }

        // 每击落一颗调一次。攒满 CLIMB.every 就爬一级并返回新级数，否则返回 null；
        // 闯关模式恒返回 null，GameScene 也就不会去动横幅与背景
        registerHit() {
            if (!this.climb) { return null; }
            this.sinceClimb++;
            if (this.sinceClimb < CONFIG.CLIMB.every) { return null; }
            this.sinceClimb = 0;
            this.stage++;
            this.applyStage();
            return this.stage;
        }

        // 按级数算闭式幂，不逐级连乘：连乘 1.06 会攒浮点误差，封顶比较就不准了
        applyStage() {
            const climb = CONFIG.CLIMB;
            this.speedRatio = Math.min(Math.pow(climb.speedMul, this.stage), climb.speedCap);
            this.intervalRatio = Math.max(Math.pow(climb.intervalMul, this.stage), climb.intervalFloor);
            const before = this.speed;
            this.speed = this.baseSpeed * this.speedRatio;
            this.interval = this.baseInterval * this.intervalRatio;
            // 场上的星一起提速：4.2 改的是全局下落速度，不是只影响之后生成的那几颗
            const scale = this.speed / before;
            this.pool.active.forEach(function (star) { star.speed *= scale; });
        }

        // HUD 的进度条与读数吃这份快照，每次都是新对象
        progress() {
            const climb = CONFIG.CLIMB;
            return {
                stage: this.stage,
                sinceClimb: this.sinceClimb,
                every: climb.every,
                speedRatio: this.speedRatio,
                intervalRatio: this.intervalRatio,
                capped: this.speedRatio >= climb.speedCap && this.intervalRatio <= climb.intervalFloor
            };
        }

        spawn() {
            const active = this.pool.active;
            if (active.length >= this.level.maxOnScreen) {
                this.counters.cap++;
                return null;
            }

            // 类型先定（5a）：双星（5d）要按它决定拿几个字母、生成边距内缩多少。
            // 5e 起按权重表抽（pickStarType）：候选与加倍读 LEVELS，同屏特殊星数现数——
            // 双星算一个整体，配额满了回落普通星，这一拍照常生成
            let specials = 0;
            for (const star of active) {
                if (star.typeSpec && star.typeSpec.id !== ns.DEFAULT_STAR_TYPE) { specials++; }
            }
            const spec = ns.pickStarType(this.level, specials, Math.random());
            const picked = this.pickContent(spec, active);
            if (!picked) {
                this.counters.letter++;
                return null;
            }

            const x = this.pickX(spec, active);
            if (x === null) {
                this.counters.overlap++;
                return null;
            }

            // 类型决定速度与星色（5a）：颜色仍不跟着字母走，1b 立的那条不变量没动
            const star = this.pool.acquire(picked.keys, x, this.speed * spec.speedMul, spec, picked.face);
            if (!star) {
                this.counters.empty++;
                return null;
            }

            // "不连续重复"的口径跟着内容走：单元方案记显示面（不连着出同一个字），键位方案记末键。
            // 单元方案的 picked.keys 是一组读音不是键串，所以那条尾巴只有键位方案会走到
            // （face 恒非 null，`||` 短路），别把它当成"任意方案都取末键"
            this.last = picked.face || picked.keys[picked.keys.length - 1];
            this.counters.spawned++;
            return star;
        }

        // 这一拍生成什么内容（9e 分岔）：键位方案挑字母，单元方案挑一个单元 { face, keys, readings }
        // ——显示面与键序分离。两条路守同一条纪律：挑不出来就整拍跳过，不退化、不放宽硬约束。
        // 交出去的 keys 是**键序内容**：键位方案一串键、单元方案一组读音（9g 多音字任一读音都算对，
        // 单读音字就是一组里只有一条），Star.spawn 直接喂给 sequence.create
        pickContent(spec, active) {
            if (!this.units) {
                const keys = this.pickLetters(spec, active);
                return keys ? { keys: keys, face: null } : null;
            }
            const onScreen = [];
            for (const star of active) {
                // 数**每个**待敲键：多音字星任一读音都算对，所以它占它每个候选键的同屏名额
                // （只数规范键会让白圈在两个都接受该键的星之间撒谎）。后续键仍不数——它们藏在
                // 显示面里、不参与判定，数它只会白白收紧生成。
                // exclude 恒空——黑洞不进单元方案（类型表的 unit 标志，理由见 harness/gameplay.md
                // 特殊星节）；9g-5 若要请回黑洞，得先给键序引擎补一个"剩余键"读口
                for (const key of star.nextKeys) { onScreen.push(key); }
            }
            const unit = ns.pickUnit(this.units.list, { last: this.last, onScreen: onScreen }, Math.random());
            return unit ? { keys: unit.readings, face: unit.face } : null;
        }

        // 这颗星要带的字母：单颗星一个，双星两个（5d）。第二个接着第一个挑，所以一对不会同字母；
        // 任一个挑不出来就整次跳过，不退化成单颗星——"要么是一对，要么这一拍不生成"，
        // 与 pickLetter 的硬约束同一条纪律（不放宽）
        pickLetters(spec, active) {
            const onScreen = [];
            const exclude = [];
            for (const star of active) {
                onScreen.push(star.letter);
                // 双星还没轮到的那颗也占着屏幕上一个字母位："同屏同字母 ≤2"是给它一起算的
                if (star.pending) { onScreen.push(star.pending); }
                // 黑洞字母隔离：黑洞与非黑洞不共享字母，消除"按了扣命、不按也扣命"的无解陷阱
                const isVoid = star.typeSpec && star.typeSpec.hazard;
                if (spec.hazard ? !isVoid : isVoid) {
                    exclude.push(star.letter);
                    if (star.pending) { exclude.push(star.pending); }
                }
            }
            const first = letters.pickLetter(this.level.pool, { last: this.last, onScreen: onScreen, exclude: exclude });
            if (!first) { return null; }
            if (!spec.pair) { return [first]; }
            onScreen.push(first);
            const second = letters.pickLetter(this.level.pool, { last: first, onScreen: onScreen, exclude: exclude });
            return second ? [first, second] : null;
        }

        // 双星比一颗星宽（PAIR_SPAN）、单元方案的星体是 96（9e）：边距按多出来的那截内缩，
        // 否则左节点 / 大星体会挂在画布外读不到字；横向间隔同样加宽，否则它会压在邻星身上。
        // 常规单颗星两截都是 0，规则与 5d 之前一模一样
        pickX(spec, active) {
            const extra = spec.pair ? CONFIG.PAIR_SPAN - CONFIG.STAR_SIZE / 2 : this.bodyExtra;
            const margin = CONFIG.SPAWN_MARGIN + extra;
            const span = CONFIG.WIDTH - margin * 2;
            for (let attempt = 0; attempt < CONFIG.SPAWN_TRIES; attempt++) {
                const x = margin + Math.random() * span;
                if (!this.blocked(x, active, extra)) { return x; }
            }
            return null;
        }

        blocked(x, active, extra) {
            for (const star of active) {
                if (Math.abs(x - star.x) < CONFIG.SPAWN_GAP_X + extra + star.spanExtra &&
                    Math.abs(CONFIG.SPAWN_Y - star.y) < CONFIG.SPAWN_GAP_Y) {
                    return true;
                }
            }
            return false;
        }

        stats() {
            return Object.assign({ active: this.pool.active.length }, this.counters);
        }
    }

    systems.SpawnDirector = SpawnDirector;
})(window.ShootingStars = window.ShootingStars || {});