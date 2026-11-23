(function (ns) {
    'use strict';

    const CONFIG = ns.CONFIG;
    const PALETTE = ns.PALETTE;
    const DEPTH = ns.DEPTH;
    const SCENES = ns.SCENES;
    const utils = ns.utils;
    const ui = utils.ui;
    const session = ns.systems.session;

    const TITLE = '已暂停';
    const NOTE = '本游戏不限时，暂停不影响成绩可比性。呈现阶段的序列也一起遮住了，回来接着播。';

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    // 覆盖层场景（harness/architecture.md）：scene.launch + scene.pause('GameScene')，不是整页替换。
    // 局内状态一律从 systems/session 现读，不从 launch 的 data 进来——data 是一次性消息，
    // 而覆盖层期间转屏会拿同一份 data 重放 restart（harness/requirements.md 1f）
    class PauseScene extends Phaser.Scene {
        constructor() {
            super(SCENES.PAUSE);
        }

        create() {
            utils.applyRenderScale(this);
            // 场景实例跨多次暂停复用，转场守卫与输入开关必须每次 create 复位
            this._smFading = false;
            this.input.enabled = true;

            if (!session.active()) {
                this.scene.stop();
                return;
            }

            const view = utils.layout(this);
            // 遮住玩法区靠这一层：GameScene 只是 paused，画面还在渲染，
            // 半透明会透出底下的色块，等于让玩家白看一遍序列。
            // 和背景一样多铺一圈——纯高度抖动（地址栏收放）只把画布跟上视口、不重排场景（harness/architecture.md）
            const overscan = Math.round(Math.max(view.w, view.h) * 0.12);
            this.scrim = this.add.rectangle(view.cx, view.cy, view.w + overscan, view.h + overscan,
                ns.tint(PALETTE.scrim), 0).setDepth(DEPTH.overlay);
            this.tweens.add({ targets: this.scrim, alpha: 0.9, duration: 180, ease: 'Quad.easeOut' });

            this.layer = this.add.container(0, 0, this.buildPanel(view)).setDepth(DEPTH.panel);
            utils.riseIn(this, this.layer.list, { stagger: 20, distance: 10, duration: 300 });

            // Esc 是桌面增强，不是任何功能的前提：三个出口都点得到（harness/architecture.md）
            utils.bindKeys(this, (event) => {
                if (event.code === 'Escape' || event.code === 'Enter' || event.code === 'NumpadEnter') {
                    this.resumeGame();
                }
            });
        }

        buildPanel(view) {
            const run = session.view();
            const round = session.round();
            // 速度读活值不读快照（harness/ui.md）：休闲跨过里程碑之后，暂停里看到的也是现在这一档
            const speed = session.speedNow();
            const gap = Math.round(view.unit * 0.45);
            const pad = Math.max(16, Math.round(view.unit * 0.8));
            const width = clamp(Math.round(Math.min(view.w - view.gutter * 2, 420)), 240, 420);
            const specs = [
                { label: '继续', accent: PALETTE.success, onSelect: () => this.resumeGame() },
                { label: '重开本局', accent: PALETTE.dominantSoft, onSelect: () => this.restartRound() },
                { label: '回首页', accent: PALETTE.textFaint, onSelect: () => this.quit() }
            ];

            // 说明行先建出来量高。卡片高度按内容实测：矮屏（横屏手机只有 320 高）放不下，
            // 先压按钮高度（压到触控下限为止），再放不下就砍说明行——三个出口必须都在
            const note = ui.text(this, 0, 0, NOTE, {
                fontSize: '11px',
                color: PALETTE.textFaint,
                lineSpacing: 4,
                wordWrap: { width: width - pad * 2 }
            });
            const titleH = 30;
            const readoutH = 34;
            const fixed = pad * 2 + titleH + readoutH;
            const availH = view.h - view.gutter * 2;
            // 块间留白的数量跟着说明行在不在变：标题 / 读数 / (说明) / 三个按钮之间各一道，
            // 按钮循环还会在最后一个按钮后面多留一道当底部余量
            const heightOf = (noteHeight, buttonHeight) => fixed + noteHeight +
                buttonHeight * specs.length + gap * (noteHeight ? 6 : 5);

            let noteH = note.height;
            let btnH = Math.max(CONFIG.TOUCH_TARGET, Math.round(view.unit * 1.9));
            let height = heightOf(noteH, btnH);

            if (height > availH) {
                btnH = Math.max(CONFIG.TOUCH_TARGET,
                    Math.floor((availH - fixed - noteH - gap * 6) / specs.length));
                height = heightOf(noteH, btnH);
            }
            if (height > availH) {
                note.destroy();
                noteH = 0;
                height = heightOf(0, btnH);
            }

            const cx = view.cx;
            const top = view.cy - height / 2;
            const mono = { fontSize: '11px', fontFamily: CONFIG.MONO };
            const parts = [
                ui.card(this, cx, view.cy, width, height, { fill: PALETTE.overlay, fillAlpha: 0.96, radius: 18 }),
                ui.text(this, cx, top + pad + titleH / 2, TITLE, {
                    fontSize: '22px', fontStyle: '600', letterSpacing: 5
                }),
                ui.text(this, cx, top + pad + titleH + gap + 8, [
                    run.type.name, run.mode.name, run.direction.name, '每项 ' + speed.show + 'ms'
                ].join(' · '), Object.assign({ color: PALETTE.textDim }, mono)),
                ui.text(this, cx, top + pad + titleH + gap + 24, '第 ' + round.index + ' 关 · 长度 ' + round.length +
                    ' · 已全对 ' + run.cleared, Object.assign({ color: PALETTE.textFaint }, mono))
            ];

            let y = top + pad + titleH + gap + readoutH + gap;
            if (noteH) {
                note.setPosition(cx, y + noteH / 2);
                parts.push(note);
                y += noteH + gap;
            }

            specs.forEach((spec) => {
                parts.push(ui.button(this, {
                    x: cx, y: y + btnH / 2, width: width - pad * 2, height: btnH,
                    fontSize: '14px', padX: 18,
                    label: spec.label, accent: spec.accent, onSelect: spec.onSelect
                }));
                y += btnH + gap;
            });

            return parts;
        }

        // 继续：GameScene 只是 paused，节拍冻在原地，resume 之后接着跑
        resumeGame() {
            if (this._smFading) { return; }
            session.resume();
            this.close();
        }

        // 重开本局：用开局那一次读到的快照重开一份（不回读全局设置），
        // GameScene 在 update 里认出"整份状态被换掉了"，自己重画并从第一项重播
        restartRound() {
            if (this._smFading) { return; }
            session.start(session.view().settings);
            this.close();
        }

        // 回首页 = 放弃本局。GameScene 得显式 stop：paused 的场景仍然在渲染，
        // 留着它就会叠在首页底下
        quit() {
            if (this._smFading) { return; }
            session.end();
            this.scene.stop(SCENES.GAME);
            utils.fadeTo(this, SCENES.MENU);
        }

        close() {
            this._smFading = true;
            this.input.enabled = false;
            // 卡片跟遮罩一起淡出：只淡遮罩的话，这 150ms 里卡片还浮在已经亮回来的画面上
            this.tweens.add({ targets: this.layer, alpha: 0, duration: 150, ease: 'Quad.easeIn' });
            this.tweens.add({
                targets: this.scrim, alpha: 0, duration: 150, ease: 'Quad.easeIn',
                onComplete: () => {
                    this.scene.resume(SCENES.GAME);
                    this.scene.stop();
                }
            });
        }
    }

    ns.scenes = ns.scenes || {};
    ns.scenes.PauseScene = PauseScene;
})(window.SequenceMemory = window.SequenceMemory || {});
