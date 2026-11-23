(function (ns) {
    'use strict';

    const CONFIG = ns.CONFIG;
    const PALETTE = ns.PALETTE;
    const DEPTH = ns.DEPTH;
    const SCENES = ns.SCENES;
    const utils = ns.utils;
    const ui = utils.ui;

    const CX = CONFIG.WIDTH / 2;
    const CARD_WIDTH = 420;
    const CARD_HEIGHT = 344;
    const LIFE_GAP = 22;

    class PauseScene extends Phaser.Scene {
        constructor() {
            super(SCENES.PAUSE);
        }

        // 局内状态只从 launch 的 data 进来，不去读 GameScene 实例
        init(data) {
            this.level = ns.levelById(data.levelId);
            this.mode = data.mode;
            this.scheme = ns.schemeById(data.scheme);
            this.runIndex = data.runIndex;
            this.onScreen = data.onScreen;
            this.stats = data.stats;
        }

        create() {
            utils.applyRenderScale(this);
            // 场景实例跨多次暂停复用，转场守卫与输入开关必须每次 create 复位
            this._ssFading = false;
            this.input.enabled = true;
            this.openedAt = this.game.loop.time;

            this.scrim = this.add.rectangle(CX, CONFIG.HEIGHT / 2, CONFIG.WIDTH, CONFIG.HEIGHT, ns.tint(PALETTE.scrim), 0)
                .setDepth(DEPTH.overlay);
            this.tweens.add({ targets: this.scrim, fillAlpha: 0.72, duration: 180, ease: 'Quad.easeOut' });

            const parts = this.buildPanel();
            this.layer = this.add.container(0, 0, parts).setDepth(DEPTH.panel);
            this.refreshTimer();

            utils.riseIn(this, parts, { stagger: 22, distance: 12, duration: 300 });

            // close 自己不出声：按钮那一路的声音在 ui.button 的 activate 里，键盘这一路走不到它，所以在这里补
            utils.bindKeys(this, (event) => {
                const audio = ns.systems.audio();
                switch (event.code) {
                    case 'Escape':
                    case 'KeyP':
                    case 'Enter':
                    case 'NumpadEnter':
                        audio.play('uiOn');
                        this.close(false);
                        break;
                    case 'KeyM':
                        audio.play('uiBack');
                        this.close(true);
                        break;
                }
            });
        }

        buildPanel() {
            const stats = this.stats;
            const modeName = ns.modeById(this.mode).name;
            const mono = { fontSize: '12px', fontFamily: CONFIG.MONO, color: PALETTE.hudMuted };

            const parts = [
                ui.card(this, CX, 300, CARD_WIDTH, CARD_HEIGHT, { fill: PALETTE.overlay, fillAlpha: 0.94 }),
                ui.text(this, CX, 168, '已暂停', {
                    fontSize: '26px',
                    fontStyle: '700',
                    color: PALETTE.starColors[5],
                    letterSpacing: 6
                }),
                ui.text(this, CX, 196, this.scheme.name + '方案 · Lv' + this.level.id + ' ' + this.level.name +
                    ' · ' + modeName + ' · 第 ' + this.runIndex + ' 局', {
                    fontSize: '12px',
                    color: PALETTE.hudMuted
                }),
                this.add.rectangle(CX, 216, CARD_WIDTH - 80, 1, ns.tint(PALETTE.surfaceEdge), 0.55)
            ];

            const columns = [CX - 132, CX, CX + 132];
            ['分数', '连击', '生命'].forEach((label, index) => {
                parts.push(ui.text(this, columns[index], 240, label, {
                    fontSize: '11px',
                    color: PALETTE.hudMuted,
                    letterSpacing: 2
                }));
            });

            parts.push(ui.text(this, columns[0], 268, String(stats.score), {
                fontSize: '24px',
                fontStyle: '700',
                fontFamily: CONFIG.MONO,
                color: PALETTE.gold
            }));

            parts.push(ui.text(this, columns[1], 268, '×' + stats.multiplier + '  (' + stats.combo + ')', {
                fontSize: '19px',
                fontStyle: '600',
                fontFamily: CONFIG.MONO,
                color: stats.combo ? PALETTE.starColors[3] : PALETTE.hudMuted
            }));

            // 掉掉的命留成暗星，一眼看出"剩几条 / 一共几条"。
            // 用 tint 而不是 alpha 区分：riseIn 会把所有 part 的 alpha 统一 tween 回 1
            const lives = this.level.lives;
            const left = columns[2] - (lives - 1) * LIFE_GAP / 2;
            for (let i = 0; i < lives; i++) {
                parts.push(this.add.image(left + i * LIFE_GAP, 268, 'star')
                    .setScale(0.28)
                    .setTint(ns.tint(i < stats.lives ? PALETTE.gold : PALETTE.surfaceEdge)));
            }

            parts.push(ui.text(this, CX, 302, '击落 ' + stats.hits + ' · 失误 ' + stats.misses +
                ' · 坠毁 ' + stats.crashes + ' · 准确率 ' + stats.accuracy.toFixed(1) + '%', mono));

            parts.push(ui.text(this, CX, 320, '用时 ' + stats.elapsed.toFixed(1) + 's · 手速 ' +
                Math.round(stats.speed) + '/min · 场上 ' + this.onScreen + ' 颗', mono));

            this.timerText = ui.text(this, CX, 346, '', {
                fontSize: '12px',
                fontFamily: CONFIG.MONO,
                color: PALETTE.info
            });
            parts.push(this.timerText);

            parts.push(ui.button(this, {
                x: CX, y: 388, width: 344, height: 44,
                label: '继续游戏', hint: 'Esc', accent: PALETTE.success,
                onSelect: () => this.close(false)
            }));

            parts.push(ui.button(this, {
                x: CX, y: 438, width: 344, height: 44,
                label: '放弃本局，回菜单', hint: 'M', accent: PALETTE.starColors[2], sound: 'uiBack',
                onSelect: () => this.close(true)
            }));

            parts.push(ui.text(this, CX, 496, 'Esc / Enter 继续 · M 放弃本局 · 暂停期间敲字母不判定', mono));

            return parts;
        }

        close(toMenu) {
            if (this._ssFading) { return; }
            this._ssFading = true;
            this.input.enabled = false;
            // 卡片跟遮罩一起淡出：只淡遮罩的话，这 150ms 里卡片还浮在已经亮回来的画面上
            this.tweens.add({ targets: this.layer, alpha: 0, duration: 150, ease: 'Quad.easeIn' });
            this.tweens.add({
                targets: this.scrim,
                fillAlpha: 0,
                duration: 150,
                ease: 'Quad.easeIn',
                onComplete: () => {
                    if (toMenu) {
                        this.scene.stop(SCENES.GAME);
                        this.scene.start(SCENES.MENU);
                    } else {
                        this.scene.resume(SCENES.GAME);
                        this.scene.stop();
                    }
                }
            });
        }

        // 用 loop.time 而不是 time.now：后者在 create 时还是 0，会算出一个天文数字。
        // "GameScene paused/running"那半是诊断读数，只在 ?debug=1 出现（7）
        refreshTimer() {
            const seconds = (this.game.loop.time - this.openedAt) / 1000;
            const state = utils.debugMode()
                ? ' · GameScene ' + (this.scene.isPaused(SCENES.GAME) ? 'paused' : 'running')
                : '';
            this.timerText.setText('已暂停 ' + seconds.toFixed(1) + ' 秒' + state);
        }

        update() {
            this.refreshTimer();
        }
    }

    ns.scenes = ns.scenes || {};
    ns.scenes.PauseScene = PauseScene;
})(window.ShootingStars = window.ShootingStars || {});