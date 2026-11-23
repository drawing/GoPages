(function (ns) {
    'use strict';

    const CONFIG = ns.CONFIG;
    const PALETTE = ns.PALETTE;
    const DEPTH = ns.DEPTH;
    const objects = ns.objects = ns.objects || {};

    // 峰线手写而不是随机：山形是美术，随机会让每次刷新换一张脸。
    // 每项是 [x, 高度系数]，系数乘 RIDGE_RISE 就是峰顶高出地平线多少
    const FAR_RIDGE = [[0, 0.6], [64, 0.88], [138, 0.52], [214, 1], [300, 0.66], [372, 0.84],
        [452, 0.48], [540, 0.92], [628, 0.58], [712, 0.86], [800, 0.56]];
    const NEAR_RIDGE = [[0, 0.32], [86, 0.54], [170, 0.24], [268, 0.62], [352, 0.3], [430, 0.46],
        [520, 0.2], [604, 0.52], [700, 0.26], [780, 0.44], [800, 0.3]];

    function ridgePath(graphics, peaks, horizonY) {
        graphics.beginPath();
        graphics.moveTo(0, horizonY + 12);
        for (let i = 0; i < peaks.length; i++) {
            graphics.lineTo(peaks[i][0], horizonY - CONFIG.RIDGE_RISE * peaks[i][1]);
        }
        graphics.lineTo(CONFIG.WIDTH, horizonY + 12);
        graphics.closePath();
        graphics.fillPath();
    }

    // 三层折线的针叶树剪影，站脚在 (x, baseY)
    function pinePath(graphics, x, baseY, height, half) {
        graphics.beginPath();
        graphics.moveTo(x, baseY - height);
        graphics.lineTo(x + half * 0.45, baseY - height * 0.55);
        graphics.lineTo(x + half * 0.26, baseY - height * 0.55);
        graphics.lineTo(x + half * 0.76, baseY - height * 0.22);
        graphics.lineTo(x + half * 0.5, baseY - height * 0.22);
        graphics.lineTo(x + half, baseY);
        graphics.lineTo(x - half, baseY);
        graphics.lineTo(x - half * 0.5, baseY - height * 0.22);
        graphics.lineTo(x - half * 0.76, baseY - height * 0.22);
        graphics.lineTo(x - half * 0.26, baseY - height * 0.55);
        graphics.lineTo(x - half * 0.45, baseY - height * 0.55);
        graphics.closePath();
        graphics.fillPath();
    }

    // 指数追赶会在目标值上方留一条永远收不掉的尾巴：密度停在 1.0000001 时，
    // rank 恰好为 1 的那颗星就永远判成"该亮"，连击断了也退不回去。够近就直接落到目标值
    function approach(value, target, step) {
        const next = value + (target - value) * step;
        return Math.abs(target - next) < 0.001 ? target : next;
    }

    // 背景六层（harness/ui.md）：天空 0 / 紫幕 0.2 / 星点 0.5 / 装饰流星 1 / 远山 2 / 树线 5 / 地平线 8。
    // 闪烁与脉冲走一个 80ms 的批量 timer（harness/architecture.md），只有装饰流星的位移每帧推
    class Backdrop {
        constructor(scene, options) {
            const opts = options || {};
            const width = CONFIG.WIDTH;
            const height = CONFIG.HEIGHT;
            const horizonY = CONFIG.HORIZON_Y;

            this.scene = scene;
            this.fade = 1;
            this.points = [];
            this.starVisible = 0;
            this.combo = 0;
            this.comboTarget = 0;
            this.pressure = 0;
            this.pressureTarget = 0;
            this.pulsePhase = 0;
            this.flash = 0;
            this.danger = 0;
            this.dangerTarget = 0;

            this.sky = scene.add.image(0, 0, 'sky')
                .setOrigin(0)
                .setDisplaySize(width, height)
                .setDepth(DEPTH.sky);

            this.veil = scene.add.image(0, 0, 'dusk')
                .setOrigin(0)
                .setDisplaySize(width, height)
                .setDepth(DEPTH.dusk)
                .setAlpha(0);

            // 最后一条命的压暗层：一整块 scrim 盖住天空到远山，α0.25 ⇒ 亮度约剩 0.75。
            // 不用 5.6 写的 postFX ColorMatrix——那是 WebGL only，Canvas 渲染器下毫无反应。
            // fillAlpha 留默认的 1：它与对象 alpha 相乘，建的时候写 0 这层就永远不可见了
            this.dim = scene.add.rectangle(width / 2, height / 2, width, height, ns.tint(PALETTE.scrim))
                .setDepth(DEPTH.dim)
                .setAlpha(0)
                .setVisible(false);

            // 星点按满连击时的密度一次建好，连击只改可见数量，运行期不再 new
            this.baseCount = opts.starCount == null ? CONFIG.SKY_STAR_COUNT : opts.starCount;
            const count = Math.ceil(this.baseCount * CONFIG.SKY_DENSITY_MAX);
            for (let i = 0; i < count; i++) {
                const warm = Math.random() < 0.18;
                const point = scene.add.image(
                    Phaser.Math.Between(6, width - 6),
                    Phaser.Math.Between(8, horizonY - CONFIG.RIDGE_RISE - 6),
                    'dot'
                )
                    .setDepth(DEPTH.stars)
                    .setScale(Phaser.Math.FloatBetween(0.16, 0.46))
                    .setTint(ns.tint(warm ? PALETTE.starlightWarm : PALETTE.starlight));
                point.baseAlpha = Phaser.Math.FloatBetween(0.3, 0.9);
                point.phase = Math.random() * Math.PI * 2;
                point.rate = Phaser.Math.FloatBetween(0.5, 1.7);
                // 前 84 颗常驻，其余按 rank 随连击依次解锁。位置本来就是随机的，新增的不会聚成一团
                point.rank = i / this.baseCount;
                point.vis = i < this.baseCount ? 1 : 0;
                point.setVisible(point.vis > 0);
                this.points.push(point);
            }

            if (opts.horizon) {
                this.buildTerrain();
                this.buildHorizon();
            }
            if (opts.decor !== false) { this.buildDecor(opts.starSpeed); }

            this.tempo = 1;
            this.clock = 0;
            this.lastTick = scene.time.now;
            this.timer = scene.time.addEvent({
                delay: 80,
                loop: true,
                callback: this.refresh,
                callbackScope: this
            });
            this.refresh();
        }

        // 远山与树线用 Graphics 矢量画，不 bake 纹理：camera zoom 把世界放大 RENDER_SCALE 倍，
        // 硬边剪影烤成 800px 宽的图就要被放大重采样，补到 3× 又要吃 4.8MB 显存；矢量边缘天然锐利。
        // 三层各一个 Graphics 而不合成一张：fadeIn 时整体 α<1，同一个对象里的重叠填充会透出接缝
        buildTerrain() {
            const scene = this.scene;
            const horizonY = CONFIG.HORIZON_Y;
            const baseY = horizonY + CONFIG.TREELINE_BASE;

            this.ridgeFar = scene.add.graphics().setDepth(DEPTH.ridge);
            this.ridgeFar.fillStyle(ns.tint(PALETTE.ridgeFar), 1);
            ridgePath(this.ridgeFar, FAR_RIDGE, horizonY);

            this.ridge = scene.add.graphics().setDepth(DEPTH.ridge);
            this.ridge.fillStyle(ns.tint(PALETTE.ridge), 1);
            ridgePath(this.ridge, NEAR_RIDGE, horizonY);

            this.treeline = scene.add.graphics().setDepth(DEPTH.ground);
            this.treeline.fillStyle(ns.tint(PALETTE.treeline), 1);
            this.treeline.beginPath();
            this.treeline.moveTo(0, CONFIG.HEIGHT);
            for (let x = 0; x <= CONFIG.WIDTH; x += 20) {
                this.treeline.lineTo(x, baseY - 3 * Math.sin(x / 90) - 2 * Math.sin(x / 37));
            }
            this.treeline.lineTo(CONFIG.WIDTH, CONFIG.HEIGHT);
            this.treeline.closePath();
            this.treeline.fillPath();

            for (let x = 12; x < CONFIG.WIDTH; x += CONFIG.TREELINE_GAP) {
                // 两个不同周期的正弦叠出高矮疏密，不用随机数：刷新后还是同一排树。
                // 树梢最高到地平线下 4px——光带在 8 层，树在 5 层，越线就会被一条亮线横穿
                const k = 0.5 + 0.5 * Math.sin(x * 0.42) * Math.cos(x * 0.17);
                const height = CONFIG.TREELINE_MIN + (CONFIG.TREELINE_MAX - CONFIG.TREELINE_MIN) * k;
                pinePath(this.treeline, x, baseY + 2, height, height * 0.34);
            }
        }

        buildHorizon() {
            const scene = this.scene;
            const width = CONFIG.WIDTH;
            const horizonY = CONFIG.HORIZON_Y;

            this.glowUp = scene.add.image(0, horizonY - 52, 'horizonGlow')
                .setOrigin(0)
                .setDisplaySize(width, 52)
                .setDepth(DEPTH.horizon);
            this.glowDown = scene.add.image(0, horizonY, 'horizonGlow')
                .setOrigin(0)
                .setDisplaySize(width, 26)
                .setFlipY(true)
                .setDepth(DEPTH.horizon);
            // 警示辉光单独一层叠在常态之上：常态亮度一点不动，紧迫时才有得加
            this.glowWarn = scene.add.image(0, horizonY - 78, 'horizonGlow')
                .setOrigin(0)
                .setDisplaySize(width, 78)
                .setDepth(DEPTH.horizon)
                .setAlpha(0);
            this.band = scene.add.rectangle(width / 2, horizonY, width, 3, ns.tint(PALETTE.horizon), 0.9)
                .setDepth(DEPTH.horizon);
        }

        // 装饰流星：暗、小、快、斜、无字母，五条差异缺一不可，少一条玩家就会去敲背景
        buildDecor(starSpeed) {
            const scene = this.scene;
            const size = CONFIG.DECOR_POOL_SIZE;
            // 缺参按标准档算：Boot 与菜单没有档位，背景流星照样是"标准档星速 × 2"
            this.decorSpeed = (starSpeed || ns.levelById(ns.DEFAULT_LEVEL).speed) * CONFIG.DECOR_SPEED_MUL;
            this.decor = { size: size, created: size, free: [], active: [] };
            this.decorClock = 0;
            // 首颗提前到 0.9–2.1s，免得刚进场景要盯七秒才看得到一颗
            this.decorWait = Phaser.Math.Between(900, 2100);
            this.decorSin = Math.sin(CONFIG.DECOR_ANGLE * Math.PI / 180);
            this.decorCos = Math.cos(CONFIG.DECOR_ANGLE * Math.PI / 180);

            for (let i = 0; i < size; i++) {
                const tail = scene.add.image(0, -4, 'decorTail')
                    .setOrigin(0.5, 1)
                    .setDisplaySize(CONFIG.DECOR_TAIL_WIDTH, CONFIG.DECOR_TAIL)
                    .setBlendMode(Phaser.BlendModes.ADD);
                const head = scene.add.image(0, 0, 'star').setScale(CONFIG.DECOR_SCALE);
                const view = scene.add.container(0, 0, [tail, head])
                    .setDepth(DEPTH.decor)
                    .setAlpha(CONFIG.DECOR_ALPHA)
                    .setActive(false)
                    .setVisible(false);
                this.decor.free.push({ view: view, x: 0, y: 0, dx: 0, dy: 0 });
            }
        }

        spawnDecor() {
            const pool = this.decor;
            let meteor = pool.free.pop();
            if (meteor) {
                pool.active.push(meteor);
            } else {
                // 池满抢最旧那颗（同 TrailPool / Effects）：背景少一颗没人察觉，
                // 动态扩容却会让"建 N 恒定"这条验收失效
                meteor = pool.active.shift();
                pool.active.push(meteor);
            }
            const dir = Math.random() < 0.5 ? -1 : 1;
            meteor.dx = this.decorSin * dir;
            meteor.dy = this.decorCos;
            meteor.x = Phaser.Math.Between(60, CONFIG.WIDTH - 60);
            meteor.y = -CONFIG.DECOR_MARGIN;
            // 把容器本地的 +y 轴转到行进方向，画在 -y 的尾迹自然拖在身后
            meteor.view.setRotation(-Math.atan2(meteor.dx, meteor.dy))
                .setPosition(meteor.x, meteor.y)
                .setAlpha(CONFIG.DECOR_ALPHA * this.fade)
                .setActive(true)
                .setVisible(true);
        }

        // 2c 的爬升反馈接口：闪烁推进速率与装饰流星速度共用它，两者都跟着实际星速走
        setTempo(value) {
            this.tempo = value;
            return this;
        }

        // 连击倍率 → 星点密度与紫幕浓度（×1.0 → ×1.6）。GameScene 每帧现读 keeper.multiplier()，
        // 与光尾加亮同一个真值来源，命中 / 按错 / 坠毁三条路都不用各接一次
        setCombo(multiplier) {
            const top = CONFIG.COMBO_TIERS[CONFIG.COMBO_TIERS.length - 1].multiplier;
            this.comboTarget = Phaser.Math.Clamp((multiplier - 1) / (top - 1), 0, 1);
            return this;
        }

        // 下方 1/3 里最靠下那颗星有多贴近地平线，0–1
        setPressure(value) {
            this.pressureTarget = Phaser.Math.Clamp(value, 0, 1);
            return this;
        }

        // 最后一条命：天空压暗、地平线辉光常亮、装饰流星停发（心跳低频音留 6b）。
        // GameScene 每帧现读 keeper.lives，扣命那一下自动生效，不用在 onCrash 里再接一次
        setDanger(on) {
            this.dangerTarget = on ? 1 : 0;
            return this;
        }

        // 坠毁那一下：光带与上下辉光瞬间提到最亮，再 HORIZON_FLASH_MS 内落回常态。
        // flash 由 update(dt) 扣减而不是挂 Tween——暂停时这 200ms 跟着停住，回来接着落
        flashHorizon() {
            if (!this.band) { return this; }
            this.flash = 1;
            this.applyHorizon();
            return this;
        }

        // 常态亮度与脉冲走 80ms 的批量 timer（harness/architecture.md）；坠毁闪光只有 200ms，批量采样只剩三下、
        // 看着是三级跳，所以闪光期间由 update 每帧再调一次。两处算的是同一个式子，先后无所谓
        applyHorizon() {
            const fade = this.fade;
            const breathe = 0.78 + 0.16 * Math.sin(this.clock * 0.9);
            // 紧迫脉冲、最后一条命的常亮、坠毁闪光三者叠加，一律 clamp 在 1 以内
            const warn = Math.min(1, this.pressure * (0.5 + 0.5 * Math.sin(this.pulsePhase)) +
                this.danger * CONFIG.DANGER_GLOW);
            this.band.setAlpha(Math.min(1, breathe + 0.22 * warn + this.flash) * fade);
            this.glowUp.setAlpha(Math.min(1, 0.9 + this.flash) * fade);
            this.glowDown.setAlpha(Math.min(1, 0.4 + this.flash * 0.6) * fade);
            this.glowWarn.setAlpha(Math.min(1, CONFIG.HORIZON_PULSE_ALPHA * warn + this.flash * 0.7) * fade);
        }

        density() {
            return 1 + (CONFIG.SKY_DENSITY_MAX - 1) * this.combo;
        }

        // 位移必须每帧推（harness/architecture.md）。各场景在自己的 update 里喂 clamp 后的 dt，
        // 暂停时场景 update 不跑，流星与真星一起停住
        update(dt) {
            if (this.flash > 0) {
                this.flash = Math.max(0, this.flash - dt * 1000 / CONFIG.HORIZON_FLASH_MS);
                if (this.band) { this.applyHorizon(); }
            }
            if (!this.decor) { return; }
            this.decorClock += dt * 1000;
            // 最后一条命时不再撒装饰流星，天上只剩真星。已在飞的那几颗自然飞出画面，不做瞬灭。
            // 减少动效同样停发（6c）：触发点现读，设置面板切掉的那一拍起就不撒了
            if (this.dangerTarget === 0 && !ns.utils.reducedMotion() && this.decorClock >= this.decorWait) {
                this.decorClock = 0;
                this.decorWait = Phaser.Math.Between(CONFIG.DECOR_GAP_MIN, CONFIG.DECOR_GAP_MAX);
                this.spawnDecor();
            }

            const speed = this.decorSpeed * this.tempo;
            const margin = CONFIG.DECOR_MARGIN;
            const right = CONFIG.WIDTH + margin;
            const bottom = CONFIG.HEIGHT + margin;
            const active = this.decor.active;
            for (let i = active.length - 1; i >= 0; i--) {
                const meteor = active[i];
                meteor.x += meteor.dx * speed * dt;
                meteor.y += meteor.dy * speed * dt;
                if (meteor.y > bottom || meteor.x < -margin || meteor.x > right) {
                    active.splice(i, 1);
                    meteor.view.setActive(false).setVisible(false);
                    this.decor.free.push(meteor);
                    continue;
                }
                meteor.view.setPosition(meteor.x, meteor.y);
            }
        }

        refresh() {
            const now = this.scene.time.now;
            const dt = Math.min((now - this.lastTick) / 1000, 0.25);
            this.lastTick = now;
            // 闪烁走自己的累加时钟而不是 time.now × tempo：改 tempo 的那一刻相位不会跳变，
            // 暂停回来那段大间隔也被 clamp 掉，星点不会突然闪一大下
            this.clock += dt * this.tempo;
            // 连击与紧迫度都追一个目标值：跨档时星点是渐次亮起，而不是二十颗一起冒出来
            this.combo = approach(this.combo, this.comboTarget, Math.min(1, dt * CONFIG.SKY_EASE));
            this.pressure = approach(this.pressure, this.pressureTarget, Math.min(1, dt * CONFIG.HORIZON_EASE));
            this.danger = approach(this.danger, this.dangerTarget, Math.min(1, dt * CONFIG.DANGER_EASE));
            // 脉冲频率随紧迫度变，相位同样得单独累加，否则变速那一刻整条光带会跳一下
            this.pulsePhase += dt * (CONFIG.HORIZON_PULSE_RATE +
                (CONFIG.HORIZON_PULSE_FAST - CONFIG.HORIZON_PULSE_RATE) * this.pressure);

            const t = this.clock;
            const fade = this.fade;
            const density = this.density();
            const ease = Math.min(1, dt * CONFIG.SKY_EASE);
            this.sky.setAlpha(fade);
            this.veil.setAlpha(CONFIG.SKY_VEIL_ALPHA * this.combo * fade);
            // approach 会精确落到 0，所以这个 > 0 就是"这一层要不要画"的开关
            this.dim.setVisible(this.danger > 0).setAlpha(CONFIG.DANGER_DIM * this.danger * fade);

            let visible = 0;
            for (let i = 0; i < this.points.length; i++) {
                const point = this.points[i];
                const want = point.rank < density ? 1 : 0;
                point.vis += (want - point.vis) * ease;
                if (point.vis < 0.01) {
                    point.vis = 0;
                    point.setVisible(false);
                    continue;
                }
                visible++;
                const twinkle = 0.58 + 0.42 * Math.sin(t * point.rate + point.phase);
                point.setVisible(true).setAlpha(point.baseAlpha * twinkle * point.vis * fade);
            }
            this.starVisible = visible;

            if (this.band) {
                this.ridgeFar.setAlpha(fade);
                this.ridge.setAlpha(fade);
                this.treeline.setAlpha(fade);
                this.applyHorizon();
            }

            if (this.decor) {
                const active = this.decor.active;
                for (let i = 0; i < active.length; i++) {
                    active[i].view.setAlpha(CONFIG.DECOR_ALPHA * fade);
                }
            }
        }

        stats() {
            const decor = this.decor;
            return {
                stars: this.starVisible,
                starTotal: this.points.length,
                density: this.density(),
                veil: CONFIG.SKY_VEIL_ALPHA * this.combo,
                pressure: this.pressure,
                flash: this.flash,
                danger: this.danger,
                decorSpeed: decor ? this.decorSpeed * this.tempo : 0,
                decor: {
                    active: decor ? decor.active.length : 0,
                    size: decor ? decor.size : 0,
                    created: decor ? decor.created : 0
                }
            };
        }

        fadeIn(duration) {
            this.fade = 0;
            this.refresh();
            this.scene.tweens.add({ targets: this, fade: 1, duration: duration || 420, ease: 'Sine.easeOut' });
            return this;
        }
    }

    objects.Backdrop = Backdrop;
})(window.ShootingStars = window.ShootingStars || {});