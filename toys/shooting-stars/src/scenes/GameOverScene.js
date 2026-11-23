(function (ns) {
    'use strict';

    const CONFIG = ns.CONFIG;
    const PALETTE = ns.PALETTE;
    const DEPTH = ns.DEPTH;
    const SCENES = ns.SCENES;
    const utils = ns.utils;
    const ui = utils.ui;

    const CX = CONFIG.WIDTH / 2;

    // 七行统计（harness/ui.md）：best 不在这里，它归 2800ms 的破纪录行（纪录 / 最高分两种口径）
    const METRICS = [
        { key: 'hits', label: '击落' },
        { key: 'misses', label: '失误' },
        { key: 'crashes', label: '坠毁' },
        { key: 'accuracy', label: '准确率', format: (value) => value.toFixed(1) + '%' },
        { key: 'maxCombo', label: '最高连击' },
        { key: 'speed', label: '手速', format: (value) => Math.round(value) + '/min' },
        { key: 'elapsed', label: '用时', format: (value) => value.toFixed(1) + 's' }
    ];

    class GameOverScene extends Phaser.Scene {
        constructor() {
            super(SCENES.GAME_OVER);
        }

        init(data) {
            this.level = ns.levelById(data.levelId);
            this.scheme = ns.schemeById(data.scheme);
            this.mode = data.mode;
            this.runIndex = data.runIndex;
            this.stats = data.stats;
            // 破纪录判定与累计三项都由 Storage.submitRun 算完传来，这里只负责显示
            this.isRecord = data.isRecord;
            this.previousBest = data.previousBest;
            this.totals = data.totals;
            this.persistent = data.persistent;
        }

        create() {
            utils.applyRenderScale(this);
            utils.fadeIn(this);
            this.backdrop = new ns.objects.Backdrop(this, { horizon: true });
            // 按钮与键盘共用一道闸：3200ms 揭示之前 R / E / M 与点击都不响应
            this.ready = false;
            // 星屑雨复用 3e 的 Effects.emitRain。GameScene 那份已随 stop 销毁，这里自建；
            // 只在破纪录分支建，非纪录局不背那百来个特效对象
            this.effects = this.isRecord ? new ns.objects.Effects(this, { level: this.level }) : null;

            const modeName = ns.modeById(this.mode).name;

            const title = ui.text(this, CX, 92, 'GAME OVER', {
                fontSize: '44px',
                fontStyle: '800',
                letterSpacing: 6,
                color: PALETTE.hudText,
                shadow: { offsetX: 0, offsetY: 0, color: PALETTE.skyEmber, blur: 22, fill: true }
            }).setDepth(DEPTH.hud);

            const subtitle = ui.text(this, CX, 132, this.scheme.name + '方案 · Lv' + this.level.id + ' ' + this.level.name +
                ' · ' + modeName + ' · 第 ' + this.runIndex + ' 局 · 生命耗尽', {
                fontSize: '13px',
                color: PALETTE.hudMuted
            }).setDepth(DEPTH.hud).setAlpha(0);

            const scoreLabel = ui.text(this, CX, 178, '得分', {
                fontSize: '12px',
                color: PALETTE.hudMuted,
                letterSpacing: 6
            }).setDepth(DEPTH.hud).setAlpha(0);

            const score = ui.text(this, CX, 218, '0', {
                fontSize: '46px',
                fontStyle: '700',
                fontFamily: CONFIG.MONO,
                color: PALETTE.gold
            }).setDepth(DEPTH.hud).setAlpha(0);

            const card = ui.card(this, CX, 337, 460, 190).setDepth(DEPTH.hud).setAlpha(0);
            const rows = METRICS.map((metric, index) => {
                const value = this.stats[metric.key];
                const shown = value == null ? '—' : (metric.format ? metric.format(value) : String(value));
                const label = ui.text(this, -190, 0, metric.label, {
                    fontSize: '12px',
                    color: PALETTE.hudMuted,
                    letterSpacing: 2
                }).setOrigin(0, 0.5);
                const number = ui.text(this, 190, 0, shown, {
                    fontSize: '18px',
                    fontStyle: '600',
                    fontFamily: CONFIG.MONO,
                    color: PALETTE.hudText
                }).setOrigin(1, 0.5);
                return this.add.container(CX, 262 + index * 25, [label, number])
                    .setDepth(DEPTH.hud).setAlpha(0);
            });

            const recordLine = this.buildRecordLine(modeName).setDepth(DEPTH.hud).setAlpha(0);

            const buttons = [
                ui.button(this, {
                    x: CX - 196, y: 506, width: 180, height: 46,
                    label: '再来一局', hint: 'R', accent: PALETTE.gold,
                    onSelect: () => this.restart()
                }),
                // 三个出口两声：上行那声只给"再来一局"（继续玩），离开这一页的两个都是下行音
                ui.button(this, {
                    x: CX, y: 506, width: 180, height: 46,
                    label: '换个难度', hint: 'E', accent: PALETTE.starColors[4], sound: 'uiBack',
                    onSelect: () => this.toMenu(true)
                }),
                ui.button(this, {
                    x: CX + 196, y: 506, width: 180, height: 46,
                    label: '主菜单', hint: 'M', accent: PALETTE.starColors[2], sound: 'uiBack',
                    onSelect: () => this.toMenu(false)
                })
            ].map((button) => {
                button.setDepth(DEPTH.hud).setAlpha(0);
                button.input.enabled = false;
                return button;
            });

            const totals = this.totals;
            const totalsLine = ui.text(this, CX, 545, (this.persistent ? '本地累计' : '本页累计') +
                ' · ' + totals.runs + ' 局 · 击落 ' + totals.hits + ' · 历史最高连击 ' + totals.maxCombo, {
                fontSize: '12px',
                fontFamily: CONFIG.MONO,
                color: PALETTE.hudMuted
            }).setDepth(DEPTH.hud).setAlpha(0);

            const diagnostic = utils.debugMode()
                ? this.buildDiagnostic().setDepth(DEPTH.hud).setAlpha(0)
                : null;

            const keysLine = ui.text(this, CX, 580, 'R 再来一局 · E 换个难度 · M / Esc 主菜单', {
                fontSize: '12px',
                fontFamily: CONFIG.MONO,
                color: PALETTE.hudMuted
            }).setDepth(DEPTH.hud).setAlpha(0);

            // 逐条揭示（harness/ui.md）。结算没有暂停态，沿用 4b 的 delayedCall + tween 即可，
            // 不必像 4c 那样自建 dt 时钟——那里必须与生成器共用一个时钟，这里没有要闸的逻辑
            utils.meteorIn(this, title, { color: PALETTE.starlight });

            this.time.delayedCall(CONFIG.OVER_SCORE_DELAY_MS, () => {
                this.tweens.add({
                    targets: [subtitle, scoreLabel, score],
                    alpha: 1,
                    duration: CONFIG.OVER_FADE_MS
                });
                // 滚的是平对象不是文本（同 3f 的 HUD 分数），onComplete 精确落终值
                const roll = { value: 0 };
                this.tweens.add({
                    targets: roll,
                    value: this.stats.score,
                    duration: CONFIG.OVER_SCORE_ROLL_MS,
                    ease: 'Cubic.easeOut',
                    onUpdate: () => score.setText(String(Math.round(roll.value))),
                    onComplete: () => score.setText(String(this.stats.score))
                });
            });

            this.time.delayedCall(CONFIG.OVER_STATS_DELAY_MS, () => {
                this.tweens.add({ targets: card, alpha: 1, duration: CONFIG.OVER_FADE_MS });
                utils.slideIn(this, rows, {
                    stagger: CONFIG.OVER_STATS_STAGGER_MS,
                    duration: CONFIG.OVER_STATS_SLIDE_MS
                });
            });

            this.time.delayedCall(CONFIG.OVER_RECORD_DELAY_MS, () => {
                utils.riseIn(this, recordLine, { distance: 8, duration: 240 });
                if (this.effects) { this.effects.emitRain(); }
            });

            this.time.delayedCall(CONFIG.OVER_BUTTONS_DELAY_MS, () => {
                this.ready = true;
                buttons.forEach((button) => { button.input.enabled = true; });
                this.tweens.add({
                    targets: buttons.concat([totalsLine], diagnostic ? [diagnostic] : []),
                    alpha: 1,
                    duration: CONFIG.OVER_FADE_MS
                });
                this.tweens.add({ targets: keysLine, alpha: 0.8, duration: CONFIG.OVER_FADE_MS });
            });

            // restart / toMenu 自己不出声：按钮那一路的声音在 ui.button 的 activate 里，
            // 键盘这一路走不到它，所以在这里补同一份事件名
            utils.bindKeys(this, (event) => {
                if (!this.ready) { return; }
                const audio = ns.systems.audio();
                switch (event.code) {
                    case 'KeyR':
                    case 'Enter':
                    case 'NumpadEnter':
                        audio.play('uiOn');
                        this.restart();
                        break;
                    case 'KeyE':
                        audio.play('uiBack');
                        this.toMenu(true);
                        break;
                    case 'KeyM':
                    case 'Escape':
                        audio.play('uiBack');
                        this.toMenu(false);
                        break;
                }
            });
        }

        // 破纪录：金色横幅 + 明细（星屑雨在揭示那一刻撒）；否则显示"最高分 X（scope）"（harness/ui.md）。
        // 存档不可用时明细 / 整行换琥珀警示——记录留不住这件事优先说清
        buildRecordLine(modeName) {
            const scope = this.scheme.name + '方案 · Lv' + this.level.id + ' ' + this.level.name + ' · ' + modeName;
            if (this.isRecord) {
                const banner = ui.text(this, 0, -8, 'NEW RECORD!', {
                    fontSize: '18px',
                    fontStyle: '800',
                    letterSpacing: 3,
                    color: PALETTE.gold
                });
                const width = banner.width + 40;
                const band = this.add.graphics();
                band.fillStyle(ns.tint(PALETTE.gold), 0.14);
                band.fillRoundedRect(-width / 2, -24, width, 32, 16);
                band.lineStyle(1, ns.tint(PALETTE.gold), 0.5);
                band.strokeRoundedRect(-width / 2, -24, width, 32, 16);
                const detail = ui.text(this, 0, 18, this.persistent
                    ? (this.previousBest > 0
                        ? scope + ' 最高分 ' + this.previousBest + ' → ' + this.stats.best
                        : scope + ' 的第一条存档')
                    : '本地存档不可用 · 新纪录只在本页有效，刷新即清零', {
                    fontSize: '11px',
                    color: this.persistent ? PALETTE.hudMuted : PALETTE.warning
                });
                return this.add.container(CX, 458, [band, banner, detail]);
            }
            return ui.text(this, CX, 462, this.persistent
                ? '最高分 ' + this.stats.best + '（' + scope + '）'
                : '本地存档不可用（隐私模式或配额已满）· 记录只在本页有效，刷新即清零', {
                fontSize: '12px',
                color: this.persistent ? PALETTE.hudMuted : PALETTE.warning
            });
        }

        // fadeTo 走 scene.start，Phaser 内部会先 stop 本场景；GameScene 在 finish 那一步就已经被 stop。
        // 局次沿 data 递增，重开十次看这个数字就知道场景真的重建了
        restart() {
            utils.fadeTo(this, SCENES.GAME, {
                levelId: this.level.id,
                scheme: this.scheme.id,
                mode: this.mode,
                runIndex: this.runIndex + 1
            });
        }

        // E 与 M 都回菜单，但 E 带着刚玩的那档 / 方案 / 玩法回去（MenuScene.init 预选），
        // M 不带参——菜单读持久化的选择（9b），两条路恢复的都是上次所选
        toMenu(pickLevel) {
            utils.fadeTo(this, SCENES.MENU, pickLevel
                ? { levelId: this.level.id, scheme: this.scheme.id, mode: this.mode }
                : undefined);
        }

        // ?debug=1 的诊断行（7 收进开关）：把"GameScene 真的 stop 了"搬到屏幕上——stop 会销毁显示对象
        // 并清空监听，三个数都该是"已 stop / 0 / 0"。运行中的监听数看 GameScene 的 ?debug=1 读数
        buildDiagnostic() {
            const game = this.scene.get(SCENES.GAME);
            const state = this.scene.isActive(SCENES.GAME) ? '仍在 update' : '已 stop';
            return ui.text(this, CX, 561, 'GameScene ' + state +
                ' · 残留显示对象 ' + game.children.length +
                ' · 残留 keydown 监听 ' + game.input.keyboard.listenerCount('keydown'), {
                fontSize: '11px',
                fontFamily: CONFIG.MONO,
                color: PALETTE.hudMuted
            });
        }
        // 装饰流星的位移每帧推一次；星点闪烁与地平线脉冲在 Backdrop 自己的批量 timer 里；
        // 破纪录的星屑雨吃同一道 clamp 后的 dt（同 GameScene 喂 Effects）
        update(time, delta) {
            const dt = Math.min(delta, CONFIG.DELTA_MAX) / 1000;
            this.backdrop.update(dt);
            if (this.effects) { this.effects.update(dt); }
        }
    }

    ns.scenes = ns.scenes || {};
    ns.scenes.GameOverScene = GameOverScene;
})(window.ShootingStars = window.ShootingStars || {});