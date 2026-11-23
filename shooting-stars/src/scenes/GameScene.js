(function (ns) {
    'use strict';

    const CONFIG = ns.CONFIG;
    const PALETTE = ns.PALETTE;
    const DEPTH = ns.DEPTH;
    const SCENES = ns.SCENES;
    const utils = ns.utils;
    const ui = utils.ui;

    class GameScene extends Phaser.Scene {
        constructor() {
            super(SCENES.GAME);
        }

        init(data) {
            const payload = data || {};
            // 方案管内容、档位管物理（9a）：合成「本局生效档位」= 档位物理 + 方案内容池，
            // 下游（生成 / 渲染 / 读数）照旧读 level.pool。缺参与未知 scheme 回落标准方案
            this.scheme = ns.schemeById(payload.scheme);
            this.level = ns.levelFor(this.scheme.id, payload.levelId);
            // 缺参与未知 mode 都回落默认模式，和 levelById 一个套路
            this.mode = ns.modeById(payload.mode).id;
            // 局次只沿 scene.start 的 data 传：菜单 1 → 结算 → R 重开 +1，没有全局计数器
            this.runIndex = payload.runIndex || 1;
        }

        create() {
            utils.applyRenderScale(this);
            utils.fadeIn(this);
            // 背景流星要按本档星速取 2×，所以把基准速度喂进去；爬升由 setTempo 一起带
            this.backdrop = new ns.objects.Backdrop(this, { horizon: true, starSpeed: this.level.speed });

            // 残影池先建：Star 构造时就要拿到它，之后每颗星自己在 step 里拖尾
            this.trail = new ns.objects.TrailPool(this);
            this.pool = new ns.objects.StarPool(this, { level: this.level, trail: this.trail });
            this.effects = new ns.objects.Effects(this, { level: this.level });
            // 爬升曲线只有无尽模式走（MODES.climb），闯关模式速度与间隔恒定
            this.director = new ns.systems.SpawnDirector(this.pool, this.level, { climb: ns.modeById(this.mode).climb });
            // 严格模式吃开局快照（6c）：设置入口只在菜单，这一局的计分规则恒定；
            // 减少动效相反，触发点现读 utils.reducedMotion()，切了立即生效
            this.keeper = new ns.systems.ScoreKeeper({ lives: this.level.lives, strict: ns.systems.settings().strict });
            this.store = ns.systems.storage();
            this.audio = ns.systems.audio();
            // 6e：触屏设备才挂点星判定，纯键盘设备鼠标点击行为不变
            this.touchInput = utils.touchDevice();
            // 7：开发读数只在 ?debug=1 出现，开局读一次（查询串局内不会变）
            this.debug = utils.debugMode();
            this.lastJudge = null;
            this.finished = false;
            // 3e 的全局反馈状态：定格倍率与它剩下的真实毫秒、已经撒过几场星屑雨。
            // Clock 是场景常驻对象：上一局若在定格里暂停并直接退出，timeScale 会留在那一局，开局先归位
            this.slowLeft = 0;
            this.setSlow(1);
            this.milestone = 0;
            // 5c 的冰晶全局减速：命中冰晶星就把这个计时器重置回 4 秒（重置而不是叠加——
            // 连敲两颗不会攒成 8 秒或 ×0.25）。画面那半归 Effects，它只认 filter 状态
            this.chillLeft = 0;
            // 6b 最后一条命的心跳：这个数是"距下一跳还剩几毫秒"，常态归零 ⇒ 掉到最后一条命那一帧就跳第一下
            this.heartClock = 0;
            // 3f 的可读性读数：减速区里有几颗、最低那颗的实际速度（已含 ×0.92）
            this.nearCount = 0;
            this.lowestSpeed = 0;

            this.guides = this.add.graphics().setDepth(DEPTH.guide);
            // 参考线默认隐藏，` 是隐藏快捷键（7）；?debug=1 下随读数默认开
            this.guidesVisible = this.debug;
            this.guideLabels = this.debug ? this.buildGuideLabels() : [];
            this.drawGuides();

            this.hud = new ns.objects.HUD(this, { level: this.level, mode: this.mode });
            this.buildControls();

            // 6.4：难度确认后先给 3 秒缓冲，第一颗星与生成器都等 GO! 那一刻（onGo）才启动
            this.countdown = new ns.objects.Countdown(this, {
                level: this.level,
                mode: this.mode,
                scheme: this.scheme.id,
                effects: this.effects,
                onGo: () => this.onSpawn(this.director.spawn())
            });

            // 5b 误敲黑洞的镜头回弹：zoom 的基准是 RENDER_SCALE（display.js 用它锁世界坐标），
            // 缩到 base × 1.06 再弹回 base。一个常驻监听 + 标志位，连敲两颗黑洞也不会攒出一串回调
            this.voidZoomPending = false;
            this.cameras.main.on(Phaser.Cameras.Scene2D.Events.ZOOM_COMPLETE, () => {
                if (!this.voidZoomPending) { return; }
                this.voidZoomPending = false;
                this.cameras.main.zoomTo(ns.RENDER_SCALE, CONFIG.VOID_ZOOM_MS, 'Sine.easeInOut');
            });

            utils.bindKeys(this, (event) => {
                // Cmd+R / Ctrl+F 这类浏览器快捷键不是游戏输入。Shift 不在此列：它不改 event.code
                if (event.ctrlKey || event.metaKey || event.altKey) { return; }
                // 控制键全部挪出字母池：P / M / D 现在要留给判定，暂停只用 Esc
                // 控制键走不到 ui.button 的 activate（右下角那三个按钮是它们的指针入口，声音在那边响），
                // 所以这里各补一声，事件名与按钮一致——键盘和点击听起来是同一件事
                switch (event.code) {
                    case 'Escape':
                        this.audio.play('uiOn');
                        this.pause();
                        return;
                    case 'Backquote':
                        this.audio.play('uiMove');
                        this.toggleGuides();
                        return;
                    case 'Backslash':
                        this.audio.play('uiBack');
                        utils.fadeTo(this, SCENES.MENU);
                        return;
                }
                const letter = utils.letters.codeToLetter(event.code);
                if (letter) { this.judge(letter); }
            });

            // 6e 触屏降级：点中一颗星 = 敲它的字母，喂进与键盘同一份 judge()——最低优先 /
            // 黑洞误敲 / 双星顺序全部原样，统计口径因此天然一致。点空白不计失误（没有字母可判），
            // 装饰流星不在 pool.active 里，天然点不动。scene.input 的监听随场景 shutdown 清，不用显式摘
            if (this.touchInput) {
                this.input.on('pointerdown', (pointer) => {
                    if (this._ssFading || this.finished || this.scene.isPaused()) { return; }
                    const point = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
                    // 地平线以下是暂停 / 回菜单按钮的地盘：按钮在 pointerup 激活、点星在 pointerdown，
                    // 同一次点击两边都会收到，不隔开的话点暂停会顺手判掉一颗星
                    if (point.y > CONFIG.HORIZON_Y) { return; }
                    const points = [];
                    for (const star of this.pool.active) {
                        for (const node of star.nodes) {
                            if (!node.view.visible) { continue; }
                            // 双星点中还没轮到那颗 = 敲它的字母 ⇒ 无匹配记失误，与键盘的顺序错同一条路
                            points.push({
                                x: star.x + node.view.x,
                                y: star.y,
                                letter: node === star.node ? star.letter : node.letter
                            });
                        }
                    }
                    const hit = utils.letters.tapMatch(points, point.x, point.y, CONFIG.TAP_RADIUS);
                    if (hit) { this.judge(hit.letter); }
                });
            }

            // 6d 失焦自动暂停：blur（窗口失焦但仍可见）与 hidden（切后台）两条都收。
            // launch / pause 是 queueOp：hidden 时主循环随即睡去，排队的那一次在回来醒来的
            // 第一帧先于任何场景 update 落地（SceneManager 先 processQueue 再 step），不会先掉一帧的星。
            // 缓冲期同样暂停——倒计时吃 update 的 dt，冻住后回来接着数
            const autoPause = () => {
                if (!this.finished && !this.scene.isPaused()) { this.pause(); }
            };
            this.game.events.on(Phaser.Core.Events.BLUR, autoPause);
            this.game.events.on(Phaser.Core.Events.HIDDEN, autoPause);
            // game.events 不随场景 shutdown 清，显式摘（同 meteorIn 的 update 钩子那条坑）
            this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
                this.game.events.off(Phaser.Core.Events.BLUR, autoPause);
                this.game.events.off(Phaser.Core.Events.HIDDEN, autoPause);
            });

            this.time.addEvent({ delay: 250, loop: true, callback: this.refreshReadout, callbackScope: this });
            this.refreshReadout();
        }

        // 倒计时还没走到 GO!：生成器未启动、敲字母不判定、用时也不计——那 3 秒缓冲不算这一局
        get buffering() {
            return !!this.countdown && !this.countdown.started;
        }

        // 命中目标与描边脉冲共用 lowestMatch，掉下去的必然是亮着的那颗
        judge(letter) {
            if (this.buffering) { return; }
            const active = this.pool.active;
            const target = utils.letters.lowestMatch(active, letter);
            // 5b 判定分流：最低匹配是黑洞就走误敲分支，不走 Effects.burst。黑洞照常参与
            // 最低优先消歧——同字母里它最低时，敲这个字母命中的就是它，白脉冲说的也是实话
            if (target && target.typeSpec.hazard) {
                const spec = target.typeSpec;
                const info = { x: target.x, y: target.y, type: spec.id };
                this.pool.release(target);
                const scoreBefore = this.keeper.score;
                const dead = this.keeper.voidStrike();
                const lost = scoreBefore - this.keeper.score;
                // 专属音读类型表的 sound（6b 换掉了 6a 那条"误敲黑洞暂走坠毁音"的临时映射）：
                // 坠毁是"星掉下去了"，误敲是"你伸手进了黑洞"，两件事必须听得出差别
                this.audio.play(spec.sound);
                this.effects.voidStrike(info);
                this.effects.voidFlash();
                this.voidCamera();
                utils.letters.markTargets(active);
                this.lastJudge = { letter: letter, hit: false, hazard: true, gained: 0, lost: lost, spec: spec };
                if (this.judgeText) { this.judgeText.setColor(PALETTE.danger); }
                this.refreshReadout();
                if (dead) { this.finish(); }
                return;
            }
            // 键序推进分流（9d）：最低匹配的星还没敲到最后一键，这一击**不是击落**——不计分、不动连击、
            // 不推进爬升，星留在场上把进度推进一格（双星首颗变暗 + 连线缩短 + 第二颗放大就是这条的视觉落地）。
            // 按 sequence.isLast 而不是按类型 id 分流：单键星恒 isLast 直接走击落，多键星逐键推进。
            // advance() 把 letter 换成下一个待敲键，于是判定与白圈自动跟着走，letters.js 一行没改
            if (target && !ns.utils.sequence.isLast(target.seq)) {
                const spec = target.typeSpec;
                // 快照要在 advance 之前取：字母上飘的位置是刚被敲掉的那一键
                const info = target.snapshot();
                // 多音字星（9g）的快照带的是**规范读音**的键，未必是玩家真敲下的那个——「行」敲 h
                // 推进时飘"x"等于告诉玩家"你刚才敲的是 x"，所以用按下的键覆写。单键星与单读音星
                // 两者恒等，这一行对它们是空操作（击落分支不需要：那一下飘的是显示面）
                info.letter = letter;
                target.advance(letter);
                // 推进不是击落：走类型表的 armSound 那一声轻的（6b 换掉了 6a "暂走命中音"的临时映射）。
                // 它不读连击音阶——音高固定才听得出"这一下和普通命中不是一回事"
                this.audio.play(spec.armSound);
                this.effects.pairArm(info);
                // 待敲键换了，重复字母的白圈立刻重算，不等下一帧
                utils.letters.markTargets(active);
                // done / total 是推进后的键序进度：读数写"2/6"，9e 的界面验收要看得见
                // "敲对一键进度亮一格"确实对得上，而不只是看星面上那排点。
                // next 写**全部**候选键（多音字是 x/h 这样两个），只写规范键会漏掉另一条读音
                this.lastJudge = {
                    letter: letter, hit: false, arm: true, spec: spec, next: target.nextKeys.join('/'),
                    done: target.seq.depth, total: ns.utils.sequence.total(target.seq)
                };
                if (this.judgeText) { this.judgeText.setColor(PALETTE.info); }
                this.refreshReadout();
                return;
            }
            let gained = 0;
            let lost = 0;
            let spec = null;
            let order = null;
            let orderPair = false;
            if (target) {
                spec = target.typeSpec;
                // 五件套要的位置 / 颜色 / 字母 / 自转角 / 缩放 / 光晕在归还前取快照：特效放的是拷贝，
                // 真星立刻回池，下一击不会又命中同一颗。双星的快照另附已经敲暗的那一颗（spent），
                // "两颗一起消除"由 Effects 的类型专属件补齐，这里不必认识星位
                const info = target.snapshot();
                this.pool.release(target);
                // 类型奖励是 3.3 得分公式的第三项：金色星 +50、双星 +30、普通星 0，一样吃连击倍率
                gained = this.keeper.hit(info.y, spec.bonus);
                // 命中音读类型表的 sound（6b）：普通星与双星走那条连击音阶，金色星是琶音、冰晶星是颤音——
                // 后两者的根音同样取这张音阶表，所以"连击越高音越高"对特殊星一样成立，专属的只是音色。
                // 音高读加完之后的连击：第 5 击本身就吃 1.5×，音阶与倍率同一拍上行
                this.audio.play(spec.sound, { step: this.keeper.combo - 1 });
                info.gained = gained;
                info.tier = this.keeper.tier();
                info.multiplier = this.keeper.multiplier();
                this.effects.burst(info);
                // 5c：冰晶星的命中效果是全屏 4 秒（所有星 ×0.5 + 冷蓝 + 冰晶飘落），
                // 不是它自己那颗星上的什么专属特效，所以起的是全局计时器而不是往 burst 里加一件
                if (spec.chill) { this.chillLeft = CONFIG.ICE_MS; }
                // 定格、星屑雨与冰晶都只在这一条命中路径上触发：坠毁与按错不给任何全局反馈
                if (this.keeper.combo >= CONFIG.HIT_STOP_COMBO) { this.hitStop(); }
                const milestone = this.keeper.milestones();
                if (milestone > this.milestone) {
                    this.milestone = milestone;
                    // 计数照涨、雨看开关（6c）：减少动效砍的是庆祝粒子，不是里程碑本身
                    if (!utils.reducedMotion()) { this.effects.emitRain(); }
                }
                // 立刻重算，剩下那颗重复字母的脉冲不用等下一帧
                utils.letters.markTargets(active);
                if (this.director.registerHit()) { this.onClimb(); }
            } else {
                lost = this.keeper.miss();
                this.audio.play('miss');
                // 敲了某颗星还没轮到的后续键（9d，双星顺序错是两键特例、9e 序列星同理）：
                // 判定上它就是"无匹配"——后续键不参与最低优先，白圈也从不指着它，
                // 所以"命中目标 = 亮脉冲的那颗"这条不变量没动。
                // 读数要写清是顺序问题，验收时才分得清"屏幕上真的没有这个字母"；
                // 线连双星与单体序列星的代价措辞不同（两颗都不消除 / 进度不回退），所以连 pair 一起记
                for (const star of active) {
                    if (ns.utils.sequence.isLaterKey(star.seq, letter)) {
                        // 多音字星（9g）的待敲键不止一个，读数要把两条读音都写出来
                        // （只写规范键的话，玩家走的是另一条读音时会读成"我明明敲对了"）
                        order = star.nextKeys.join('/');
                        orderPair = star.pair;
                        break;
                    }
                }
            }
            this.lastJudge = {
                letter: letter, hit: !!target, gained: gained, lost: lost, spec: spec,
                order: order, orderPair: orderPair
            };
            if (this.judgeText) { this.judgeText.setColor(target ? PALETTE.success : PALETTE.danger); }
            this.refreshReadout();
        }

        // 爬升一级：横幅与背景闪烁吃同一份 progress 快照，两边不会差半级；
        // 顶条那行进度与倍率由 judge 尾部的 refreshReadout 一起刷
        onClimb() {
            const progress = this.director.progress();
            this.hud.levelUp(progress);
            this.backdrop.setTempo(progress.speedRatio);
        }

        // 5b：真黑洞第一次即将出现在真实局里时给一次性提示（harness/gameplay.md 已决：做）。
        // 只有一行横幅，不做慢放——慢放与 hit stop 共用 slow 状态，第一颗黑洞常出现在连击中，
        // 两套慢放叠在一起会把 60ms 定格拖成读不出的长停顿。写 voidSeen 之后不再触发；
        // 存档不可用时写进内存 cache，本会话内也只提示一次
        onSpawn(star) {
            if (!star || !star.typeSpec.hazard || this.store.read('voidSeen', false)) { return; }
            this.store.write('voidSeen', true);
            const hint = ui.text(this, CONFIG.WIDTH / 2, CONFIG.VOID_HINT_Y, '黑洞别敲，让它落下去', {
                fontSize: '18px',
                fontStyle: '600',
                color: PALETTE.warning,
                shadow: { offsetX: 0, offsetY: 1, color: PALETTE.skyTop, blur: 8, fill: true }
            }).setDepth(DEPTH.hud).setAlpha(0);
            this.tweens.add({ targets: hint, alpha: 1, duration: CONFIG.VOID_HINT_FADE_MS, ease: 'Cubic.easeOut' });
            this.time.delayedCall(CONFIG.VOID_HINT_MS, () => {
                this.tweens.add({
                    targets: hint,
                    alpha: 0,
                    duration: CONFIG.VOID_HINT_FADE_MS,
                    ease: 'Cubic.easeIn',
                    onComplete: () => hint.destroy()
                });
            });
        }

        // 5b 误敲黑洞的镜头反馈：向中心缩 1.06× 再回弹 + 大震动（黑闪在 Effects 里按 dt 走）。
        // 全局最重的反馈给最重的错误——震屏时长与强度都比坠毁重一档（harness/gameplay.md）。
        // 减少动效只砍震屏（6c）：zoom 回弹是缩放不是震屏，保留
        voidCamera() {
            const camera = this.cameras.main;
            this.voidZoomPending = true;
            camera.zoomTo(ns.RENDER_SCALE * CONFIG.VOID_ZOOM, CONFIG.VOID_ZOOM_MS, 'Sine.easeOut');
            if (!utils.reducedMotion()) { camera.shake(CONFIG.VOID_SHAKE_MS, CONFIG.VOID_SHAKE); }
        }

        // 命中定格（harness/ui.md）：40+ 连击那一击把之后 60ms 压到 0.35×。
        // 倒计时用真实 delta 自己走，不用 time.delayedCall——timeScale 会把定时器一起拖慢，60ms 变 170ms。
        // 减少动效砍掉它（6c）：全场凝一下是装饰性运动，判定与计分不受影响
        hitStop() {
            if (utils.reducedMotion()) { return; }
            this.slowLeft = CONFIG.HIT_STOP_MS;
            this.setSlow(CONFIG.HIT_STOP_SCALE);
        }

        // dt 与 time.timeScale 必须一起改：星星 / 光尾 / 特效全吃 dt，只改 timeScale 的话
        // 慢下来的只有 HUD 那条 tween，画面上看不出"凝住"
        setSlow(scale) {
            this.slow = scale;
            this.time.timeScale = scale;
        }

        // 最后一条命的心跳（6b）：判据与压暗 / 辉光常亮同一份（lives ≤ 1，harness/ui.md），
        // 时钟吃 clamp 后的 ms 累加，所以暂停与切标签页时心跳跟着停——用 delayedCall 会在暂停里继续跳。
        // 结算转场那 220ms 也停（finished），画面已经在淡出了，心跳还在走就是噪音
        heartbeat(ms) {
            if (this.finished || this.keeper.lives > 1) {
                this.heartClock = 0;
                return;
            }
            this.heartClock -= ms;
            if (this.heartClock > 0) { return; }
            this.heartClock = CONFIG.DANGER_HEART_MS;
            this.audio.play('heart');
        }

        // ?debug=1 的参考线标签：生成线 / 档位表 / 地平线 + 特效 / 背景 / 氛围 / 可读性四行读数。
        // 正常模式不建（guideLabels 为空数组），参考线只剩网格与几条界线
        buildGuideLabels() {
            const cx = CONFIG.WIDTH / 2;
            const level = this.level;
            const labels = [
                ui.text(this, cx, 78, '生成线 y = ' + CONFIG.SPAWN_Y + '（画布外）', {
                    fontSize: '12px',
                    fontFamily: CONFIG.MONO,
                    color: PALETTE.hudMuted
                }).setDepth(DEPTH.hud).setAlpha(0.55),
                // 这一行全部来自 LEVELS，切档后数字跟着变就说明逻辑真的在读表。
                // 2c 起爬升会偏离表值，所以标明是基准，实时倍率看顶条右侧那行
                ui.text(this, cx, 98, '档位表（基准）· ' + level.speed + 'px/s · 间隔 ' + level.spawnInterval + 'ms · 上限 ' +
                    level.maxOnScreen + ' · 命 ' + level.lives + ' · 字号 ' + level.fontSize + ' · 描边 ' + level.stroke +
                    ' · 池 ' + level.pool.length, {
                    fontSize: '11px',
                    fontFamily: CONFIG.MONO,
                    color: PALETTE.hudMuted
                }).setDepth(DEPTH.hud).setAlpha(0.5),
                ui.text(this, cx, 538, '地平线 y = ' + CONFIG.HORIZON_Y + ' · 落到这里坠毁并扣一条命', {
                    fontSize: '12px',
                    fontFamily: CONFIG.MONO,
                    color: PALETTE.hudText,
                    shadow: { offsetX: 0, offsetY: 1, color: PALETTE.skyTop, blur: 6, fill: true }
                }).setDepth(DEPTH.hud).setAlpha(0.85)
            ];

            // 四个短命池的借出 / 累计创建 + 在场粒子 + 发射器个数（恒为 1）
            this.fxText = ui.text(this, cx, 118, '', {
                fontSize: '11px',
                fontFamily: CONFIG.MONO,
                color: PALETTE.hudMuted
            }).setDepth(DEPTH.hud).setAlpha(0.5);
            labels.push(this.fxText);

            // 星点数随连击从 84 涨到 135，装饰流星的"建 4"应当全程不变。
            // 排在顶条正下方而不是接在特效那行后面——y=150 的 LEVEL UP 横幅会盖住 124–176 那一带
            this.bgText = ui.text(this, cx, 64, '', {
                fontSize: '11px',
                fontFamily: CONFIG.MONO,
                color: PALETTE.hudMuted
            }).setDepth(DEPTH.hud).setAlpha(0.5);
            labels.push(this.bgText);

            // 定格倍率与剩余毫秒、里程碑计数、星屑雨池、最后一条命的压暗与坠毁闪光。
            // 接在特效那行（118）下面，无尽模式爬升时会被 LEVEL UP 横幅（124–176）盖住 0.7s——
            // 读数只在判定 / 坠毁 / 250ms 定时三种时机刷，横幅挡住的那几次不影响核对
            this.ambText = ui.text(this, cx, 132, '', {
                fontSize: '11px',
                fontFamily: CONFIG.MONO,
                color: PALETTE.hudMuted
            }).setDepth(DEPTH.hud).setAlpha(0.5);
            labels.push(this.ambText);

            // 减速线位置、减速区里的颗数、最低那颗的实际速度，
            // 以及"屏幕上的分数 / 真实分数"——滚动中两个数不相等，追平了就说明 200ms 滚完
            this.readText = ui.text(this, cx, 146, '', {
                fontSize: '11px',
                fontFamily: CONFIG.MONO,
                color: PALETTE.hudMuted
            }).setDepth(DEPTH.hud).setAlpha(0.5);
            labels.push(this.readText);
            return labels;
        }

        // 左下角常驻准确率与手速是 HUD 的；?debug=1 才在它下面加两行开发读数（y=575 / 589）。
        // 暂停 / 回菜单是控制键的指针入口（触屏局内的唯一出口），两种模式都在
        buildControls() {
            if (this.debug) {
                const style = { fontSize: '11px', fontFamily: CONFIG.MONO, color: PALETTE.hudMuted };
                this.readout = ui.text(this, 28, 575, '', style).setOrigin(0, 0.5).setDepth(DEPTH.hud).setAlpha(0.85);
                this.judgeText = ui.text(this, 28, 589, '', style).setOrigin(0, 0.5).setDepth(DEPTH.hud).setAlpha(0.95);
            }

            const right = CONFIG.WIDTH - 28;
            const actions = [
                { label: '暂停', hint: 'Esc', accent: PALETTE.starColors[5], x: right - 158, onSelect: () => this.pause() },
                { label: '回菜单', hint: '\\', accent: PALETTE.starColors[2], sound: 'uiBack', x: right - 50, onSelect: () => utils.fadeTo(this, SCENES.MENU) }
            ];

            const buttons = actions.map((action) => ui.button(this, Object.assign({
                width: 100, height: 30, fontSize: '13px', padX: 10, y: 576
            }, action)).setDepth(DEPTH.hud));

            utils.riseIn(this, buttons, { delay: 120, stagger: 60, distance: 10 });
        }

        drawGuides() {
            const width = CONFIG.WIDTH;
            const height = CONFIG.HEIGHT;
            this.guides.clear();
            this.guideLabels.forEach((label) => label.setVisible(this.guidesVisible));
            if (!this.guidesVisible) { return; }

            this.guides.lineStyle(1, ns.tint(PALETTE.info), 0.07);
            for (let x = 100; x < width; x += 100) {
                this.guides.lineBetween(x, 52, x, height);
            }
            for (let y = 100; y < height; y += 100) {
                this.guides.lineBetween(0, y, width, y);
            }
            this.guides.lineStyle(1, ns.tint(PALETTE.horizon), 0.28);
            this.guides.lineBetween(0, CONFIG.HORIZON_Y, width, CONFIG.HORIZON_Y);
            // 减速线（harness/gameplay.md）：这条线以下速度 ×0.92 并亮起暖橘描边
            this.guides.lineStyle(1, ns.tint(PALETTE.horizon), 0.16);
            this.guides.lineBetween(0, CONFIG.NEAR_Y, width, CONFIG.NEAR_Y);
            this.guides.lineStyle(1, ns.tint(PALETTE.info), 0.22);
            this.guides.lineBetween(width / 2, 52, width / 2, CONFIG.HORIZON_Y);
        }

        toggleGuides() {
            this.guidesVisible = !this.guidesVisible;
            this.drawGuides();
        }

        update(time, delta) {
            const ms = Math.min(delta, CONFIG.DELTA_MAX);
            if (this.slowLeft > 0) {
                this.slowLeft -= ms;
                if (this.slowLeft <= 0) { this.setSlow(1); }
            }
            const dt = ms / 1000 * this.slow;
            // 5c 的冰晶计时用真实毫秒扣（同 slowLeft），不吃定格那 0.35×：4 秒就是 4 秒墙上时间。
            // 倍率每帧现读一次、喂给场上每一颗星——减速开始后新生成的那几颗自然也在内
            if (this.chillLeft > 0) { this.chillLeft = Math.max(0, this.chillLeft - ms); }
            const chill = this.chillLeft > 0 ? CONFIG.ICE_SLOW : 1;
            this.effects.setGlobalFilter(this.chillLeft > 0 ? 'ice' : null);
            // 倒计时先走：GO! 落在这一帧时生成器同帧启动，下面那道闸当场就开
            if (this.countdown) {
                this.countdown.update(dt);
                if (this.countdown.done) { this.countdown = null; }
            }
            if (!this.buffering) { this.keeper.tick(dt); }
            // 倍率是加亮的唯一真值来源，每帧现读：命中、按错、坠毁三条改连击的路径都不用各接一次
            this.trail.setBoost(this.keeper.multiplier() >= CONFIG.TRAIL_BOOST_AT);
            this.trail.update(dt);
            // 结算转场那 220ms 里也要继续推进，否则最后一次命中的特效会冻在半空
            this.effects.update(dt);
            const active = this.pool.active;
            let lowest = 0;
            let lowestSpeed = 0;
            let near = 0;
            for (let i = active.length - 1; i >= 0; i--) {
                const star = active[i];
                star.step(dt, chill);
                if (star.near) { near++; }
                if (star.y > lowest) {
                    lowest = star.y;
                    // step 刚算好的这一帧实际速度（已含减速区与冰晶两条倍率），公式不在这里重抄
                    lowestSpeed = star.fallSpeed;
                }
                if (star.y > CONFIG.HORIZON_Y) {
                    const hazard = star.typeSpec.hazard;
                    this.pool.release(star);
                    // 5b：黑洞落到地平线无任何惩罚——不扣命、不算坠毁、不断连击（harness/gameplay.md）。
                    // 它是唯一"落下去是对的"的星，onCrash 的震屏与地平线闪光也一并不给
                    if (!hazard) { this.onCrash(); }
                }
            }
            this.nearCount = near;
            this.lowestSpeed = lowestSpeed;
            // 星点密度与紫幕跟着倍率走，地平线跟着最低那颗星走，三件都每帧现读
            this.backdrop.setCombo(this.keeper.multiplier());
            this.backdrop.setPressure((lowest - CONFIG.HORIZON_WARN_Y) / (CONFIG.HORIZON_Y - CONFIG.HORIZON_WARN_Y));
            // 最后一条命的氛围同样现读：扣命那一下自动变暗，不用在 onCrash 里再接一次
            this.backdrop.setDanger(this.keeper.lives <= 1);
            // 心跳是这份氛围的声音那一半，同一个判据、同一帧现读（它吃真实 ms，不吃定格那 0.35×）
            this.heartbeat(ms);
            this.backdrop.update(dt);
            // 倒计时的 3 秒缓冲与结算转场那 220ms 都不生成、不判定，只让背景与特效继续走
            if (this.finished || this.buffering) { return; }
            this.onSpawn(this.director.update(dt));
            utils.letters.markTargets(active);
        }

        // 转场那 220ms 里 _ssFading 已经挡住了键盘判定，坠毁也一并不再计，两边对称
        onCrash() {
            if (this.finished || this._ssFading) { return; }
            const dead = this.keeper.crash();
            this.audio.play('crash');
            // 震感只给坠毁：普通命中一律不震，否则三分钟就晕了（harness/ui.md）。
            // 减少动效连这份也砍（6c），地平线闪光与生命图标碎裂照旧——它们是颜色与小额动画
            if (!utils.reducedMotion()) { this.cameras.main.shake(CONFIG.CRASH_SHAKE_MS, CONFIG.CRASH_SHAKE); }
            this.backdrop.flashHorizon();
            this.refreshReadout();
            if (dead) { this.finish(); }
        }

        finish() {
            this.finished = true;
            // 只有生命耗尽的完整一局入档：中途回菜单或暂停里放弃的半局不计最高分与累计局数
            const stats = this.keeper.stats();
            const record = this.store.submitRun(this.scheme.id, this.level.id, this.mode, stats);
            // best 并进 stats 供结算页破纪录行显示，keeper 本身不知道存档
            stats.best = record.best;
            // stats() 是新对象，fade 期间场上的星继续动也不会改到已经交出去的这份
            utils.fadeTo(this, SCENES.GAME_OVER, {
                levelId: this.level.id,
                scheme: this.scheme.id,
                mode: this.mode,
                runIndex: this.runIndex,
                stats: stats,
                isRecord: record.isRecord,
                previousBest: record.previous,
                totals: record.totals,
                persistent: this.store.available
            });
        }

        refreshReadout() {
            this.hud.sync(this.keeper, this.director.progress());
            // 正常模式到此为止：HUD 之外不建任何读数文本，250ms 定时器也不再做字符串拼接
            if (!this.debug) { return; }
            const loop = this.game.loop;
            const pool = this.pool.stats();
            const trail = this.trail.stats();
            const spawn = this.director.stats();
            const keeper = this.keeper;
            const skipped = spawn.cap + spawn.overlap + spawn.empty + spawn.letter;
            const judge = this.lastJudge;

            // 两个池都只报「借出/总数 建N」：空闲数可由总数减借出算出，上采样倍数在控制台读
            // utils.upsampleRatio()。腾出来的宽度给残影池，否则这行会压到右下角按钮上
            this.readout.setText(Math.round(loop.actualFps) + ' FPS · Δ' + loop.delta.toFixed(1) + 'ms · RS ' + ns.RENDER_SCALE +
                ' · 星 ' + pool.active + '/' + this.pool.size + ' 建 ' + pool.created +
                ' · 尾 ' + trail.active + '/' + this.trail.size + ' 建 ' + trail.created);
            // 4c 的验收读数：缓冲期把"生成器未启动"写在屏幕上，GO! 之后换回判定那行
            if (this.buffering) {
                this.judgeText.setText('倒计时 ' + this.countdown.left().toFixed(1) +
                    's · 生成器未启动 · 敲字母不判定');
            } else {
                // 5a 的验收读数：类型那一段只在特殊星上出现，普通星每击都拖一截"（普通星 ×1）"
                // 只是噪音。这里的 ×N 是生成时乘上去的系数，实测速度看"可读"那行的最低 Npx/s。
                // 5b 的误敲是第三种判定结果：不是命中也不是无匹配，单独写出来。
                // 5c 的冰晶星 speedMul 是 1（标准下落），报"×1"等于什么都没说，改报它给全场的那条。
                // 5d 的双星 speedMul 同样是 1，报它有意义的只有"两颗一起消除"与那 +30；
                // 敲第一颗（arm）与顺序敲错（order）是第四、第五种结果，各自写清代价。
                // 9e 起 arm 与 order 也发生在单体序列星上（普通星在单元方案里就是多键星），
                // 措辞按 pair 标志分岔：双星说"两颗都不消除"、序列星说"进度不回退"并报 n/m 进度
                const typeNote = judge && judge.hit && judge.spec.id !== ns.DEFAULT_STAR_TYPE
                    ? '（' + judge.spec.name + (judge.spec.chill
                        ? ' 全场 ×' + CONFIG.ICE_SLOW + '·' + CONFIG.ICE_MS / 1000 + 's'
                        : judge.spec.pair ? ' 顺序敲完两颗一起消除 +' + judge.spec.bonus
                        : ' ×' + judge.spec.speedMul) + '）' : '';
                // 6c 严格模式：按错（无匹配 / 顺序错 / 误敲黑洞）实扣的分写进读数，
                // 顶条分数同时往下滚——两处说的是同一次罚分。judge 在第一次敲键前是 null，
                // 与 typeNote 同一条 guard：GO 后定时器就会走进这个分支，漏了保护会抛异常打断主循环
                const lostNote = judge && judge.lost ? ' −' + judge.lost + ' 分（严格）' : '';
                const judgeNote = !judge ? ''
                    : judge.hazard ? ' 误敲黑洞 −1 命' + lostNote
                    : judge.hit ? ' 命中 +' + judge.gained + typeNote
                    : judge.arm ? (judge.spec.pair
                        ? ' 双星第一颗已敲暗（不计分不断连击），接着敲 ' + judge.next
                        : ' 序列星推进 ' + judge.done + '/' + judge.total + '（不计分不断连击），接着敲 ' + judge.next)
                    : judge.order ? (judge.orderPair
                        ? ' 双星顺序错，要先敲 ' + judge.order + '（记一次失误、两颗都不消除）' + lostNote
                        : ' 序列星顺序错，要先敲 ' + judge.order + '（记一次失误、进度不回退）' + lostNote)
                    : ' 无匹配' + lostNote;
                this.judgeText.setText('生成 ' + spawn.spawned + ' · 跳过 ' + skipped + ' · 击落 ' + keeper.hits +
                    ' · 失误 ' + keeper.misses + ' · 坠毁 ' + keeper.crashes +
                    ' · 监听 ' + this.input.keyboard.listenerCount('keydown') +
                    (judge ? ' · 敲 ' + judge.letter + judgeNote
                        : this.touchInput ? ' · 点星星或敲字母开始' : ' · 敲字母键开始'));
            }

            const fx = this.effects.stats();
            this.fxText.setText('特效 五件齐发' +
                ' · 闪 ' + fx.flash.active + '/' + fx.flash.size + ' 建 ' + fx.flash.created +
                ' · 环 ' + fx.ring.active + '/' + fx.ring.size + ' 建 ' + fx.ring.created +
                ' · 字 ' + fx.letter.active + '/' + fx.letter.size + ' 建 ' + fx.letter.created +
                ' · 分 ' + fx.score.active + '/' + fx.score.size + ' 建 ' + fx.score.created +
                ' · 柱 ' + fx.pillar.active + '/' + fx.pillar.size + ' 建 ' + fx.pillar.created +
                ' · 吸 ' + fx.void.active + '/' + fx.void.size + ' 建 ' + fx.void.created +
                ' · 冰 ' + fx.ice.active + '/' + fx.ice.size + ' 建 ' + fx.ice.created +
                ' · 屑 ' + fx.sparks + '/' + CONFIG.FX_SPARK_MAX_ALIVE + ' · 发射器 ' + fx.emitters);

            const bg = this.backdrop.stats();
            this.bgText.setText('背景 星点 ' + bg.stars + '/' + bg.starTotal + ' · 密度 ' + bg.density.toFixed(2) +
                '× · 紫 ' + bg.veil.toFixed(2) + ' · 流星 ' + bg.decor.active + '/' + bg.decor.size +
                ' 建 ' + bg.decor.created + ' · ' + Math.round(bg.decorSpeed) + 'px/s · 紧迫 ' + bg.pressure.toFixed(2));

            this.ambText.setText('氛围 定格 ' + this.slow.toFixed(2) + '× 剩 ' + Math.max(0, Math.round(this.slowLeft)) +
                'ms · 里程碑 ' + this.milestone + ' · 雨 ' + fx.rain.active + '/' + fx.rain.size + ' 建 ' + fx.rain.created +
                ' · 压暗 ' + bg.danger.toFixed(2) + ' · 地平线闪光 ' + bg.flash.toFixed(2) +
                // 5c：剩余秒数是 GameScene 的计时器，霜是 Effects 那个 0..1 的画面量。
                // 两者不同步的那 0.4s 正是淡入淡出，归零时必须同时归零（验收第二条）
                ' · 冰晶 ' + (this.chillLeft / 1000).toFixed(1) + 's 霜 ' + fx.frost.toFixed(2));

            // 9e：单元方案的星面字号不是档位字号（汉字按面积读，走 unitArt 那条红线），
            // 读数报真正渲染的那个值 + 星体尺寸，验收"长键序星面读得清"才对得上号
            this.readText.setText('可读 减速线 y=' + CONFIG.NEAR_Y + ' · 减速 ' + this.nearCount + ' 颗 · 最低 ' +
                Math.round(this.lowestSpeed) + 'px/s · 分数 ' + this.hud.shownScore() + '/' + keeper.score +
                ' · 字号 ' + (this.level.units
                    ? this.level.units.face + '（星面）· 星体 ' + this.level.units.body
                    : this.level.fontSize) + ' / 描边 ' + this.level.stroke);
        }

        // launch 与 pause 都是 queueOp，下一次 SceneManager.update 才生效：
        // 本帧还会再走一次 update（位移在 clamp 内），下一帧起星星完全静止
        pause() {
            if (this._ssFading) { return; }
            this.hud.sync(this.keeper, this.director.progress());
            this.scene.launch(SCENES.PAUSE, {
                levelId: this.level.id,
                mode: this.mode,
                scheme: this.scheme.id,
                runIndex: this.runIndex,
                onScreen: this.pool.active.length,
                stats: this.keeper.stats()
            });
            this.scene.pause();
        }
    }

    ns.scenes = ns.scenes || {};
    ns.scenes.GameScene = GameScene;
})(window.ShootingStars = window.ShootingStars || {});