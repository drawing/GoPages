(function (ns) {
    'use strict';

    const CONFIG = ns.CONFIG;
    const PALETTE = ns.PALETTE;
    const DEPTH = ns.DEPTH;
    const SCENES = ns.SCENES;
    const utils = ns.utils;
    const ui = utils.ui;
    const objects = ns.objects;
    const Prefs = ns.systems.Prefs;

    const TITLE = '设置';
    const LEAD = '全局偏好 · 下一局生效';

    // 只放全局偏好（harness/gameplay.md 设置项两层）：玩法档不归这里——"玩什么"在首页。
    // 色盲模式不进（4b：非颜色通道常驻，没有可切的东西），减少动效不进（跟随系统，4b）。
    // 四项都照走纪律 1：Prefs 持久化、开局读进快照、局内改不了——所以这一屏只在开局前可达
    const ROWS = [
        { key: 'sound', label: '音效', note: '全部声音的总开关' },
        { key: 'colorTones', label: '音调', note: '颜色类型一色一音高，打开时预览' },
        { key: 'startLength', label: '起始长度', note: '仅休闲；冲榜与挑战固定 2', kind: 'length' },
        { key: 'progressDots', label: '进度点', note: '局内顶条的圆点，关掉仍留计数' }
    ];

    // 出口按钮的高度：钉底排布要先知道它多高，画按钮的地方也用它，两边不能各算一套
    function backHeight(view) {
        return Math.max(CONFIG.TOUCH_TARGET, Math.round(view.unit * 1.8));
    }

    class SettingsScene extends Phaser.Scene {
        constructor() {
            super(SCENES.SETTINGS);
        }

        create() {
            utils.applyRenderScale(this);
            utils.fadeIn(this);
            this.paint(true);
            // Esc 返回是桌面增强，不是任何功能的前提："返回首页"才是主入口（8d 前纯指针可走通）
            utils.bindKeys(this, (event) => {
                if (event.code === 'Escape') { this.back(); }
            });
        }

        // 点任何一下整块重画（AGENTS 界面纪律 2，与首页换档同一条）：行按钮的"开 / 关"标签与
        // 步进读数都由 Prefs 全量推导，不做差异化更新。animate 只在进场景时为真，重画不重放入场动画
        paint(animate) {
            this.tweens.killAll();
            this.children.removeAll(true);

            const view = utils.layout(this);
            const backdrop = objects.backdrop(this, view);
            const prefs = Prefs.get();
            const rowGap = Math.round(view.unit * 0.5);

            // 横屏不是竖屏的缩小版，是同一套构件换一种排布（harness/ui.md）：
            // 左列标题 + 总说明 + 返回钉底，右列四行偏好
            if (!view.isPortrait) {
                const pair = Math.min(view.w - view.gutter * 2, 860);
                const left = Math.round(pair * 0.44);
                const right = pair - left - view.gutter;
                const leftX = view.cx - pair / 2 + left / 2;
                const rightX = view.cx + pair / 2 - right / 2;
                this.buildHead(leftX, left, view, view.gutter);
                this.buildBack(leftX, left, view, view.h - view.gutter - backHeight(view));
                let y = view.gutter;
                ROWS.forEach((spec) => {
                    y = this.buildRow(rightX, right, view, y, spec, prefs) + rowGap;
                });
            } else {
                const width = utils.contentWidth(view, 460);
                let y = this.buildHead(view.cx, width, view, view.gutter);
                ROWS.forEach((spec) => {
                    y = this.buildRow(view.cx, width, view, y, spec, prefs) + rowGap;
                });
                // 出口钉底：竖屏高（844）的时候中间留白，与首页同一条排布取舍
                this.buildBack(view.cx, width, view, view.h - view.gutter - backHeight(view));
            }

            // 背景不参与入场动画：它一动就会露出底色
            if (animate) {
                utils.riseIn(this, this.children.list.filter((object) => backdrop.indexOf(object) < 0), {
                    delay: 60, stagger: 6, distance: 12
                });
            }
        }

        buildHead(cx, width, view, y) {
            const title = ui.text(this, cx, y, TITLE, {
                fontSize: '22px', fontStyle: '600', letterSpacing: 5
            }).setOrigin(0.5, 0).setDepth(DEPTH.hud);
            const lead = ui.text(this, cx, y + title.height + 6, LEAD, {
                fontSize: '11px', color: PALETTE.textFaint, letterSpacing: 1,
                wordWrap: { width: width }
            }).setOrigin(0.5, 0).setDepth(DEPTH.hud);
            return y + title.height + 6 + lead.height + Math.round(view.unit * 0.8);
        }

        // 一行偏好 = 吃满列宽的行构件 + 下方一句小字说明（harness/ui.md 设置页，参考 shooting-stars
        // 设置面板）：开关是整行按钮，状态写进标签（"音效：开"，状态即文案，非颜色通道）；
        // 起始长度是 − / + 步进行，仍走 START_LENGTHS 离散三档，到边界那一端置灰。
        // 说明行在窄列砍掉（与首页类型行 verbose 同一条取舍）
        buildRow(cx, width, view, y, spec, prefs) {
            const left = cx - width / 2;
            // +12 是给步进按钮留的上下内扣：按钮边长 = 行高 − 12，仍不低于触控下限
            const rowH = Math.max(CONFIG.TOUCH_TARGET + 12, Math.round(view.unit * 2.4));
            if (spec.kind === 'length') {
                this.buildLengthRow(cx, width, y, rowH, prefs);
            } else {
                ui.button(this, {
                    x: cx, y: y + rowH / 2, width: width, height: rowH,
                    align: 'left', accent: PALETTE.dominantSoft,
                    label: spec.label + '：' + (prefs[spec.key] ? '开' : '关'),
                    onSelect: () => this.pick(spec.key, !prefs[spec.key])
                }).setDepth(DEPTH.panel);
            }

            let height = rowH;
            if (width >= 300) {
                const note = ui.text(this, left, y + rowH + 3, spec.note, {
                    fontSize: '11px', color: PALETTE.textFaint, lineSpacing: 3,
                    wordWrap: { width: width }
                }).setOrigin(0, 0).setDepth(DEPTH.hud);
                height += 3 + note.height;
            }
            return y + height;
        }

        // 步进行（与 shooting-stars 音量行同款）：整宽 slab 行底 + 两端方形 − / + 按钮 + 中央读数。
        // 行底不可选（ui.card 无 onSelect），只承担"这一行是一个构件"的轮廓；按钮到边界置灰——
        // 置灰不接指针，不是"点了没反应"。读数本身就是状态，不另靠颜色
        buildLengthRow(cx, width, y, rowH, prefs) {
            const left = cx - width / 2;
            const lengths = ns.START_LENGTHS;
            const index = lengths.indexOf(prefs.startLength);
            const inset = 6;
            const btnSize = rowH - inset * 2;
            const midY = y + rowH / 2;
            ui.card(this, cx, midY, width, rowH, { radius: 14 }).setDepth(DEPTH.panel);
            ui.text(this, cx, midY, '起始长度 ' + prefs.startLength, {
                fontSize: '15px', fontStyle: '600', letterSpacing: 0.5
            }).setDepth(DEPTH.panel);
            ui.button(this, {
                x: left + inset + btnSize / 2, y: midY, width: btnSize, height: btnSize,
                label: '−', fontSize: '20px', accent: PALETTE.dominantSoft,
                disabled: index <= 0, onSelect: () => this.step(-1)
            }).setDepth(DEPTH.panel);
            ui.button(this, {
                x: left + width - inset - btnSize / 2, y: midY, width: btnSize, height: btnSize,
                label: '+', fontSize: '20px', accent: PALETTE.dominantSoft,
                disabled: index >= lengths.length - 1, onSelect: () => this.step(1)
            }).setDepth(DEPTH.panel);
        }

        // 步进一格：边界由按钮置灰表达，这里再兜底一次（Prefs.set 自己也只认表内值）
        step(dir) {
            const lengths = ns.START_LENGTHS;
            const next = lengths[lengths.indexOf(Prefs.get().startLength) + dir];
            if (next != null) { this.pick('startLength', next); }
        }

        buildBack(cx, width, view, y) {
            const height = backHeight(view);
            ui.button(this, {
                x: cx, y: y + height / 2, width: Math.min(width, 320), height: height,
                fontSize: '14px', padX: 18,
                label: '返回首页', accent: PALETTE.textFaint,
                onSelect: () => this.back()
            }).setDepth(DEPTH.panel);
        }

        back() {
            if (this._smFading) { return; }
            utils.fadeTo(this, SCENES.MENU);
        }

        // 改完立刻持久化并重画；下一局开局时 Setup.snapshot 才把它读进快照（纪律 1）。
        // 打开音调当场预览四色四音高——开关的回响就是它本身的声音（harness/ui.md 声音节）；
        // 音效关着时 Audio 自己挡住预览。按钮那一下 UI 点击在 onSelect 之前响，关音效也听得到最后这一声
        pick(key, value) {
            Prefs.set(key, value);
            if (key === 'colorTones' && value) { ns.systems.Audio.play('tones'); }
            this.paint(false);
        }
    }

    ns.scenes = ns.scenes || {};
    ns.scenes.SettingsScene = SettingsScene;
})(window.SequenceMemory = window.SequenceMemory || {});