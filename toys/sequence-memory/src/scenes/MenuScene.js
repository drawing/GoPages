(function (ns) {
    'use strict';

    const CONFIG = ns.CONFIG;
    const PALETTE = ns.PALETTE;
    const DEPTH = ns.DEPTH;
    const SCENES = ns.SCENES;
    const utils = ns.utils;
    const ui = utils.ui;
    const objects = ns.objects;
    const Setup = ns.systems.Setup;

    const TITLE = ['更', '上', '层', '楼'];
    const LEAD = '看一遍序列，遮住，按顺序复现。全对就加一位，出错这一局结束，得分是全对过的最大长度。';
    const PLAY_LABEL = '玩法';
    const PICK_LABEL = '开始新游戏 · 点一种类型就开局';
    const PICK_LABEL_SHORT = '点一种类型就开局';

    // 历史最高读 ScoreKeeper（5a，组合键 = 类型 × 模式 × 方向 × 速度档）：
    // 无记录或最高为 0 返回 null，显示"–"，不解释为什么没有（harness/ui.md）
    function bestOf(picks) { return ns.systems.scoreKeeper().bestOf(picks); }

    function bestLabel(picks) {
        const best = bestOf(picks);
        return best == null ? '–' : '最高 ' + best;
    }

    // 玩法档读数下面那一句描述**生成方式与方向**（harness/ui.md）：档名本身不传达差别，
    // 而承接长解释的"玩法"页是常驻入口、不强制读，玩家仍可能盲选，选错档产生的记录还不可比。
    // 判定两模式相同（即点即判），所以这一句不提判定；方向是"玩什么"，挑战那句带上它
    const MODE_LINE = {
        leisure: '重播旧序列，末尾多一项',
        ranked: '每关全新序列'
    };

    // 当前玩法档的读数：档名 · 方向 · 速度，换行接一句生成方式（倒序再补半句方向）。
    // 类型不写进来——类型由你点哪一行决定，这里写死一种反而像是只有那种类型能玩
    function presetLine(picks) {
        const speed = ns.speedById(picks.speed);
        const readout = [
            ns.modeById(picks.mode).name,
            ns.directionById(picks.direction).name,
            '每项 ' + speed.show + 'ms'
        ].join(' · ');
        const line = MODE_LINE[picks.mode] +
            (picks.direction === 'backward' ? '，倒着点回来' : '');
        return readout + '\n' + line;
    }

    // 出口按钮的高度：钉底排布要先知道它多高，画按钮的地方也用它，两边不能各算一套。
    // 触控下限兜底（4d）：此前是 40，手机上差 4px 不达标
    function actionsHeight(view) {
        return Math.max(CONFIG.TOUCH_TARGET, Math.round(view.unit * 1.8));
    }

    // "每枚够宽"的阈值，两处共用（harness/ui.md 首页）：底部三枚出口按它决定 padX 给 18 还是 8，
    // 玩法档一行按它决定留不留"玩法"行标签——窄于这个数就开始为省地方砍东西
    const SEG_MIN = 72;

    class MenuScene extends Phaser.Scene {
        constructor() {
            super(SCENES.MENU);
        }

        create() {
            utils.applyRenderScale(this);
            utils.fadeIn(this);
            this.paint(true);
        }

        // 换一次档就整块重画（AGENTS 界面纪律 2）：类型行的 meta 与档读数都由草稿推导，
        // 不做差异化更新，也就不会漏掉其中一处。animate 只在进场景时为真，换档不重放入场动画
        paint(animate) {
            this.tweens.killAll();
            this.children.removeAll(true);

            const view = utils.layout(this);
            // 首页星空压暗（ui.md 面板半透那条）：背景只需要安静地衬着。
            // 流星只首页给（ui.md 远楼剪影那条）：偶尔一闪的活气，不进局内扰呈现
            objects.backdrop(this, view, { starScale: 0.8, meteor: true });

            // 横屏不是竖屏的缩小版，是同一套构件换一种排布（harness/gameplay.md / harness/requirements.md 4d）：
            // 左边品牌区 + 出口钉底，右边玩法区。出口在左列是 4d 定案：320 高的横屏右列装不下
            // 玩法档行 + 四行类型 + 出口，搬去左列才保得住四行 44px 的类型行（与设置页同一种排布）
            const wide = !view.isPortrait;
            if (wide) {
                const pair = Math.min(view.w - view.gutter * 2, 860);
                const left = Math.round(pair * 0.44);
                const right = pair - left - view.gutter;
                const leftX = view.cx - pair / 2 + left / 2;
                const rightX = view.cx + pair / 2 - right / 2;
                this.buildBrand(leftX, left, view, view.gutter, animate);
                this.buildActions(leftX, left, view, view.h - view.gutter - actionsHeight(view), animate);
                const playEnd = this.buildPlay(rightX, right, view, view.gutter);
                this.buildPicks(rightX, right, view, playEnd, animate);
                return;
            }

            const width = utils.contentWidth(view, 460);
            const brandEnd = this.buildBrand(view.cx, width, view, view.gutter, animate);
            const playEnd = this.buildPlay(view.cx, width, view, brandEnd);
            this.buildPicks(view.cx, width, view, playEnd, animate);

            // 出口钉底：竖屏高（844）的时候中间留白，比整块顶在上方看着稳
            const actionY = view.h - view.gutter - actionsHeight(view);
            this.buildActions(view.cx, width, view, actionY, animate);
        }

        // 标题四个字各吃一个信号色，逐个弹入再轻轻浮起来。
        // 四个色就是玩法里的四个色块，首页先把这套编码亮出来
        buildBrand(cx, width, view, y, animate) {
            // 减少动效（4b，harness/ui.md）：标题弹入与常驻浮动都砍掉，四个字直接落位。
            // 换档重画本来就不重放弹入，这里砍的是进场景那一次与浮动
            const reduced = utils.reducedMotion();
            const enter = animate && !reduced;
            // 字号同时受列宽约束（4d）：四个字加字距的总宽 = size × (1.24 × 3 + 1)，
            // 窄左列（480×320 横屏只有 192px）不缩字号会溢进右列
            const size = Math.round(Math.min(view.unit * 2.4, 52,
                Math.floor(width / (1.24 * (TITLE.length - 1) + 1))));
            const spacing = Math.round(size * 1.24);
            const startX = cx - spacing * (TITLE.length - 1) / 2;
            const titleY = y + size * 0.78;

            TITLE.forEach((char, index) => {
                const hex = ns.COLORS[index].hex;
                // 柔光 ADD 混合（harness/ui.md 材质那条）：normal 混合下四个字各自罩一块灰雾，
                // ADD 才是字后面透出来的光。量收过一档（α0.34→0.2、2×→1.7×，ui.md 面板半透那条）：
                // 四团大光晕叠在一起是首页最吵的一块，光只需要衬出字、不需要自己当主角
                const glow = this.add.image(0, Math.round(size * 0.08), 'glow')
                    .setDisplaySize(size * 1.7, size * 1.7)
                    .setTint(ns.tint(hex))
                    .setBlendMode(Phaser.BlendModes.ADD)
                    .setAlpha(0.2);
                const text = ui.text(this, 0, 0, char, {
                    fontSize: size + 'px',
                    fontStyle: '700',
                    color: hex,
                    shadow: { offsetX: 0, offsetY: 3, color: PALETTE.skyTop, blur: 14, fill: true }
                });
                const glyph = this.add.container(startX + index * spacing, titleY, [glow, text])
                    .setDepth(DEPTH.hud).setAlpha(enter ? 0 : 1).setScale(enter ? 0.86 : 1);

                if (enter) {
                    this.tweens.add({
                        targets: glyph, alpha: 1, scaleX: 1, scaleY: 1,
                        duration: 420, delay: index * 90, ease: 'Back.easeOut'
                    });
                }
                // 浮动是常驻的：换档重画不重放弹入，但标题该继续轻轻浮着（减少动效时不浮）
                if (!reduced) {
                    this.tweens.add({
                        targets: glyph, y: titleY - Math.round(size * 0.08),
                        duration: 2300 + index * 220, delay: (enter ? 420 : 0) + index * 90,
                        yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
                    });
                }
            });

            const cursor = titleY + size * 0.78 + Math.round(view.unit * 0.5);
            const lead = ui.text(this, cx, cursor, LEAD, {
                fontSize: '13px',
                color: PALETTE.textDim,
                lineSpacing: 5,
                wordWrap: { width: width }
            }).setOrigin(0.5, 0).setDepth(DEPTH.hud);

            return cursor + lead.height + Math.round(view.unit * 0.8);
        }

        // 玩法档（harness/gameplay.md）：开局前唯一的规则选择，一行**等宽三段** + 读数（档名·方向·速度 + 一句生成方式）。
        // 只画已开放的档；只剩一个档时整行胶囊不画——点不动的胶囊和灰箭头一样像 bug（harness/ui.md）。
        // 段宽按列宽三等分，不跟着文字走：档名只有两个字，量出来 49px，而触控下限把高度顶到 44，
        // 三枚排一起就成了三个圆点（harness/ui.md 首页）
        buildPlay(cx, width, view, y) {
            // 传草稿进去：不传的话 selected 是按默认组合算的，结算"换个玩法"带回来的档就不高亮
            //（与类型行同一条——带回来的组合得看得见）。只有一个档时整行不画，这条差别在 3a 之前显不出来
            const presets = Setup.presets(Setup.draft());
            const left = cx - width / 2;
            // 触控下限兜底（4d）：此前是 30，手机上只有 33px，与局内同一条纪律
            const chipH = Math.max(CONFIG.TOUCH_TARGET, Math.round(view.unit * 1.5));
            let cursor = y;

            if (presets.length > 1) {
                const gap = 6;
                const gaps = gap * (presets.length - 1);
                // 文字先建后量（与记录页卡片降级同一条）：留着行标签每段还剩多宽，
                // 不足 SEG_MIN 就砍掉标签、三段吃满整列（568×320 / 480×320 横屏的右列走这条）
                const label = ui.text(this, left, cursor + chipH / 2, PLAY_LABEL, {
                    fontSize: '12px',
                    color: PALETTE.textFaint,
                    letterSpacing: 2
                }).setOrigin(0, 0.5).setDepth(DEPTH.hud);
                const labelGap = Math.round(view.unit * 0.7);
                const keepLabel = Math.floor((width - label.width - labelGap - gaps) / presets.length) >= SEG_MIN;
                if (!keepLabel) { label.destroy(); }
                const head = keepLabel ? label.width + labelGap : 0;

                // 余数给最右一段：行尾与下面四行类型行齐平，1–2px 的缺口比"没对齐"显眼
                const each = Math.floor((width - head - gaps) / presets.length);
                let x = left + head;
                presets.forEach((preset, index) => {
                    const chip = ui.chip(this, {
                        x: 0,
                        y: cursor + chipH / 2,
                        label: preset.name,
                        accent: PALETTE.dominantSoft,
                        selected: preset.selected,
                        height: chipH,
                        width: index === presets.length - 1
                            ? width - head - gaps - each * (presets.length - 1)
                            : each,
                        fontSize: '12px',
                        onSelect: () => this.pickPreset(preset)
                    }).setDepth(DEPTH.panel);
                    chip.setX(x + chip.width / 2);
                    x += chip.width + gap;
                });

                cursor += chipH + Math.round(view.unit * 0.45);
            }

            // 顶对齐（ui.md 首页节）：居中对齐会让两行读数的上半截骑进胶囊行缝、压住胶囊下沿
            const line = ui.text(this, cx, cursor, presetLine(Setup.draft()), {
                fontSize: '11px',
                fontFamily: CONFIG.MONO,
                color: PALETTE.textDim,
                wordWrap: { width: width }
            }).setOrigin(0.5, 0).setDepth(DEPTH.hud);

            return cursor + line.height + Math.round(view.unit * 0.8);
        }

        // 四档类型 = 四种游戏，也是难度阶梯本身（harness/gameplay.md）。点一行直接开局，
        // 右侧 meta 是该组合的历史最高；还没做的档置灰保留（1d 纪律只留给"屏幕没落地"与
        // "类型没落地"，玩法档不置灰而是压根不画）
        buildPicks(cx, width, view, y, animate) {
            const draft = Setup.draft();
            const rowH = Math.max(CONFIG.TOUCH_TARGET, Math.round(view.unit * 2));
            const gap = Math.round(rowH * 0.22);
            // 标签带上符号集大小：四档只差一个名字的话，行中间会空得没道理。
            // 窄屏（横屏两列时右栏只有 ~220px）放不下，会和右侧读数撞上，那就只留名字
            const verbose = width >= 300;
            const items = ns.TYPES.map((type) => {
                const ready = ns.ROADMAP.type[type.id] === true;
                return {
                    label: verbose ? type.name + ' · ' + type.symbols + ' 个符号' : type.name,
                    // 组合 = 这一行的类型 × 当前玩法档，四份记录互不污染（harness/requirements.md5b）
                    meta: ready ? bestLabel(Object.assign({}, draft, { type: type.id })) : ns.MARKS.pending,
                    disabled: !ready,
                    onSelect: () => this.start(type.id)
                };
            });

            // 短横屏压缩（4d，harness/ui.md）：正常排布装不下右列时，砍标签、收紧行缝——
            // 四行 44px 是触控下限不可再压，出口已搬去左列。判据从实际高度推，不写死视口阈值
            const labelBlock = Math.round(view.unit * 1.1);
            const normalEnd = y + labelBlock + items.length * rowH + (items.length - 1) * gap;
            const compact = !view.isPortrait && normalEnd > view.h - view.gutter;
            const rowGap = compact ? Math.max(4, Math.round(rowH * 0.1)) : gap;
            const top = y + (compact ? Math.round(view.unit * 0.3) : labelBlock);

            if (!compact) {
                ui.text(this, cx - width / 2, y + 8, width >= 300 ? PICK_LABEL : PICK_LABEL_SHORT, {
                    fontSize: '12px',
                    color: PALETTE.textFaint,
                    letterSpacing: 2
                }).setOrigin(0, 0.5).setDepth(DEPTH.hud);
            }

            this.menu = ui.menu(this, items, { x: cx, y: top + rowH / 2, width: width, height: rowH, gap: rowGap });
            this.menu.buttons.forEach((button) => button.setDepth(DEPTH.panel));
            // 高亮草稿里的那一种类型：结算"换个玩法"带回来的组合得看得见（harness/gameplay.md）。
            // ui.menu 建好时默认选第 0 行，草稿是别的类型就挪过去
            const draftIndex = ns.TYPES.findIndex((type) => type.id === draft.type);
            if (draftIndex > 0) { this.menu.select(draftIndex); }
            if (animate) {
                utils.riseIn(this, this.menu.buttons, { delay: 300, stagger: 70, distance: 14 });
            }

            return top + items.length * rowH + (items.length - 1) * rowGap + Math.round(view.unit * 0.6);
        }

        buildActions(cx, width, view, y, animate) {
            const height = actionsHeight(view);
            const gap = Math.round(view.unit * 0.5);
            const each = Math.floor((width - gap * 2) / 3);
            // 三个入口都通着真实场景（记录 5b、设置 4c、玩法 7）。窄列 padX 收到 8：
            // 480×320 横屏左列只有 192px，三枚各 58px，"玩法"两个字 14px 约 29px 宽，
            // 默认 18 的内扣放不下（harness/ui.md 首页）
            const specs = [
                { label: '记录', key: SCENES.RECORDS },
                { label: '设置', key: SCENES.SETTINGS },
                { label: '玩法', key: SCENES.HOW_TO }
            ];

            const buttons = specs.map((spec, index) => ui.button(this, {
                x: cx - width / 2 + each / 2 + index * (each + gap),
                y: y + height / 2,
                width: each,
                height: height,
                fontSize: '14px',
                padX: each >= SEG_MIN ? 18 : 8,
                label: spec.label,
                accent: PALETTE.dominantSoft,
                onSelect: () => utils.fadeTo(this, spec.key)
            }).setDepth(DEPTH.panel));

            if (animate) {
                utils.riseIn(this, buttons, { delay: 620, stagger: 70, distance: 10 });
            }
            return y + height + Math.round(view.unit * 0.7);
        }

        // 点类型行直接开局，没有确认步（harness/ui.md）：误触的代价是一次点击，
        // 暂停里有"回首页"、结算里有"再来一局"，比每次开局多一跳便宜。
        // 类型先写进草稿再取快照——草稿归 systems（跨场景状态），所以转屏 restart 与
        // 结算"换个玩法"带回来的组合都不丢（harness/requirements.mdT9.1），局内只认这份快照（纪律 1）
        start(typeId) {
            if (this._smFading) { return; }
            const picks = Setup.use(Object.assign({}, Setup.draft(), { type: typeId }));
            ns.systems.session.start(Setup.snapshot(picks));
            utils.fadeTo(this, SCENES.GAME);
        }

        // 换档只改草稿里档管的那三个键，类型保持玩家上次点的那一种
        pickPreset(preset) {
            Setup.use(Object.assign({}, Setup.draft(), preset.picks));
            this.paint(false);
        }
    }

    ns.scenes = ns.scenes || {};
    ns.scenes.MenuScene = MenuScene;
})(window.SequenceMemory = window.SequenceMemory || {});
