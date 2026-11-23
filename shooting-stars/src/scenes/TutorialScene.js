(function (ns) {
    'use strict';

    const CONFIG = ns.CONFIG;
    const PALETTE = ns.PALETTE;
    const DEPTH = ns.DEPTH;
    const SCENES = ns.SCENES;
    const utils = ns.utils;
    const ui = utils.ui;

    // 中文没有空格，Phaser 默认按空格断词等于不折行，长句会单行捅出卡片，必须 useAdvancedWrap。
    const WRAP_WIDTH = 520;
    // prompt / note 各自在固定带子里垂直居中（带高按 2 行留），换步骤行数变化不会顶到星图或计数。
    const PROMPT_BAND_TOP = 322;
    const NOTE_BAND_TOP = 374;

    // 静态说明即最终形态（4d 取消交互式教学）：note 是每页一句静态补充，不是通关条件。
    // 页数随规则增补（9e 起五页）——凡"不能自行推断"的规则就占一页：双星（9d 之前）与
    // 序列星（9e，星面上不是键）都是。圆点 / 底部提示 / 直达键三处一律按 STEPS.length 推，
    // 加页只改这张表
    const STEPS = [
        {
            title: '第一步 · 敲下星星上的字母',
            prompt: '星星上的字母，就是你要敲的键。让它落到地平线会坠毁并扣一条命；\n按错键不扣命，只清连击——放手敲。',
            note: '命中位置越低得分越高；连击越高倍率越高，飘分与光尾跟着变亮。\n（有些方案的星面上不是字母，见第五步）',
            art: 'single'
        },
        {
            title: '第二步 · 重复字母先打最低的',
            prompt: '同屏出现两个相同字母时，先打最靠近地平线的那颗，最低的那颗会亮脉冲描边。',
            note: '不用瞄准：敲同一个字母总是掉最低那颗，白圈指的就是它。',
            art: 'double-same'
        },
        {
            title: '第三步 · 金色抢分，黑洞别碰',
            prompt: '金色星值得抢；黑洞千万别敲，敲了会被吸走一条命，\n让它自己落到地平线就好（不扣命、不断连击）。',
            note: '金色星下落快 1.3 倍，高风险高回报；黑洞 Lv3 及以上才出现。',
            art: 'gold-void'
        },
        {
            title: '第四步 · 双星按顺序敲完',
            prompt: '双星是一条线连着的两颗小星，各带一个字母：先敲大那颗。\n敲掉后它变暗、连线缩短、第二颗放大；顺序敲错记一次失误、不消除。',
            note: '连线末端的箭头指向下一颗；双星 Lv3 及以上难度才出现。',
            art: 'pair'
        },
        {
            title: '第五步 · 序列星：一个字，一串键',
            prompt: '序列星的星面上是一个完整的字，不是键：把它整个拼出来，敲对一键亮一格。\n星面不告诉你怎么拼——敲错记一次失误、已亮的格不灭，进度不回退。',
            // 多音字"任一读音都算对"（9g）写在这句补充里、不单独占页：它是"比预期更宽松"而不是
            // "更严格"，敲对了当场就知道，但不写的话不知道某个字还有第二个读音的人只会以为自己拼错了。
            // 示意图仍是单读音的「好」= h-a-o——画两条并行键序会把"一个字 = 一串键"讲糊
            note: '亮几格就是敲对了几键，点本身不说是哪一键；敲完最后一格整颗星才炸开、才算一次击落。\n多音字任一读音都算对——「行」敲 xing 或 hang 都能消除，敲定第一键就锁那条读音。',
            art: 'sequence'
        }
    ];

    // 直达键的上限跟着页数走（原来是写死的 [1-4]）：加一页不改这里就会漏一个键
    const DIGITS = new RegExp('^Digit[1-' + STEPS.length + ']$');

    class TutorialScene extends Phaser.Scene {
        constructor() {
            super(SCENES.TUTORIAL);
        }

        init(data) {
            this.level = ns.levelById(data && data.levelId);
        }

        create() {
            utils.applyRenderScale(this);
            utils.fadeIn(this);
            this.backdrop = new ns.objects.Backdrop(this, { horizon: true });

            const cx = CONFIG.WIDTH / 2;
            this.step = 0;
            this.artTweens = [];

            ui.text(this, cx, 62, '玩法说明', {
                fontSize: '26px',
                fontStyle: '700',
                letterSpacing: 8
            }).setDepth(DEPTH.hud);

            ui.card(this, cx, 300, 620, 306).setDepth(DEPTH.hud);

            // 圆点整排居中，起点按页数推（原来写死 cx - 54 = 四页那排的左端）
            this.dots = STEPS.map((step, index) => {
                const dot = this.add.circle(cx - (STEPS.length - 1) * 18 + index * 36, 176, 6, ns.tint(PALETTE.hudMuted), 0.4)
                    .setDepth(DEPTH.hud)
                    .setInteractive({ useHandCursor: true });
                dot.on('pointerdown', () => this.show(index));
                return dot;
            });

            this.stepTitle = ui.text(this, cx, 214, '', {
                fontSize: '19px',
                fontStyle: '600',
                color: PALETTE.gold,
                letterSpacing: 2
            }).setDepth(DEPTH.hud);

            this.prompt = ui.text(this, cx, PROMPT_BAND_TOP, '', {
                fontSize: '14px',
                color: PALETTE.hudText,
                align: 'center',
                wordWrap: { width: WRAP_WIDTH, useAdvancedWrap: true },
                lineSpacing: 6
            }).setDepth(DEPTH.hud);

            this.note = ui.text(this, cx, NOTE_BAND_TOP, '', {
                fontSize: '12px',
                color: PALETTE.hudMuted,
                align: 'center',
                wordWrap: { width: WRAP_WIDTH, useAdvancedWrap: true }
            }).setDepth(DEPTH.hud);

            this.counter = ui.text(this, cx, 424, '', {
                fontSize: '12px',
                fontFamily: CONFIG.MONO,
                color: PALETTE.hudMuted
            }).setDepth(DEPTH.hud).setAlpha(0.7);

            const prev = ui.button(this, {
                x: cx - 172, y: 486, width: 164, height: 42,
                label: '上一步', hint: '←', accent: PALETTE.info, sound: null,
                onSelect: () => this.show(this.step - 1)
            }).setDepth(DEPTH.hud);

            const back = ui.button(this, {
                x: cx, y: 486, width: 164, height: 42,
                label: '返回菜单', hint: 'Esc', accent: PALETTE.starColors[2], sound: 'uiBack',
                onSelect: () => utils.fadeTo(this, SCENES.MENU)
            }).setDepth(DEPTH.hud);

            const next = ui.button(this, {
                x: cx + 172, y: 486, width: 164, height: 42,
                label: '下一步', hint: '→', accent: PALETTE.gold, sound: null,
                onSelect: () => this.show(this.step + 1)
            }).setDepth(DEPTH.hud);

            this.prevButton = prev;
            this.nextButton = next;

            // 地平线亮带在 HORIZON_Y 552 之下，提示行压在山影暗区才读得清
            ui.text(this, cx, 534, 'Lv' + this.level.id + ' ' + this.level.name + ' · ← → 切换步骤 · 1–' +
                STEPS.length + ' 直达 · Esc 返回菜单', {
                fontSize: '12px',
                fontFamily: CONFIG.MONO,
                color: PALETTE.hudMuted
            }).setDepth(DEPTH.hud).setAlpha(0.8);

            utils.bindKeys(this, (event) => {
                switch (event.code) {
                    case 'ArrowLeft':
                        this.show(this.step - 1);
                        break;
                    case 'ArrowRight':
                    case 'Enter':
                    case 'NumpadEnter':
                        this.show(this.step + 1);
                        break;
                    case 'Escape':
                        // Esc 走不到按钮的 activate，那一声"返回"在这里补（翻页音由 show 自己出）
                        ns.systems.audio().play('uiBack');
                        utils.fadeTo(this, SCENES.MENU);
                        break;
                    default:
                        if (DIGITS.test(event.code)) {
                            this.show(Number(event.code.slice(5)) - 1);
                        }
                }
            });

            this.show(0);
        }

        // 翻页音（6b）放在 show 里而不是按钮上：←→ / Enter / 直达数字 / 圆点 / 上一步 / 下一步六条路径都经过这里，
        // 一处就够。真的换页才响——create 末尾那次 show(0) 与在第一页按"上一步"都是原地不动，不该出声
        show(index) {
            const next = Phaser.Math.Clamp(index, 0, STEPS.length - 1);
            const moved = next !== this.step;
            this.step = next;
            if (moved) { ns.systems.audio().play('uiMove'); }
            const step = STEPS[this.step];

            this.stepTitle.setText(step.title);
            this.prompt.setText(step.prompt);
            this.note.setText(step.note);
            // setText 后高度才确定，按各自带子顶 + 半高落位
            this.prompt.setY(PROMPT_BAND_TOP + this.prompt.height / 2);
            this.note.setY(NOTE_BAND_TOP + this.note.height / 2);
            this.counter.setText('步骤 ' + (this.step + 1) + ' / ' + STEPS.length);

            this.dots.forEach((dot, i) => {
                const active = i === this.step;
                dot.setFillStyle(ns.tint(active ? PALETTE.gold : PALETTE.hudMuted), active ? 1 : 0.35);
                dot.setRadius(active ? 7 : 5);
            });

            const first = this.step === 0;
            const last = this.step === STEPS.length - 1;
            this.prevButton.setAlpha(first ? 0.4 : 1);
            this.nextButton.setAlpha(last ? 0.4 : 1);
            this.prevButton.input.enabled = !first;
            this.nextButton.input.enabled = !last;

            this.buildArt(step.art);
        }

        buildArt(kind) {
            if (this.art) {
                this.artTweens.forEach((tween) => tween.stop());
                this.artTweens.length = 0;
                this.art.destroy();
            }

            const cx = CONFIG.WIDTH / 2;
            const y = 264;
            this.art = this.add.container(cx, y).setDepth(DEPTH.hud);

            if (kind === 'single') {
                this.art.add(this.glyph(-84, 0, 'a', PALETTE.starColors[2], 0.86));
                this.art.add(this.arrow(-4, 0));
                this.art.add(this.keyCap(76, 0, 'A'));
            } else if (kind === 'double-same') {
                this.art.add(this.glyph(-70, -16, 's', PALETTE.starColors[4], 0.68));
                const low = this.glyph(40, 14, 's', PALETTE.starColors[4], 0.86);
                const ring = this.add.circle(40, 14, 36, ns.tint(PALETTE.starColors[4]), 0)
                    .setStrokeStyle(2, ns.tint(PALETTE.starColors[4]), 0.85);
                this.art.add([ring, low]);
                this.artTweens.push(this.tweens.add({
                    targets: ring,
                    scaleX: 1.14,
                    scaleY: 1.14,
                    alpha: 0.25,
                    duration: 900,
                    yoyo: true,
                    repeat: -1,
                    ease: 'Sine.easeInOut'
                }));
            } else if (kind === 'gold-void') {
                this.art.add(this.glyph(-96, 0, 'k', PALETTE.gold, 0.86));
                const spark = this.add.image(-96, 0, 'spark').setScale(0.9).setAlpha(0.55);
                this.art.add(spark);
                this.artTweens.push(this.tweens.add({
                    targets: spark,
                    angle: 90,
                    duration: 4200,
                    repeat: -1,
                    ease: 'Sine.easeInOut'
                }));
                this.art.add(this.voidGlyph(92, 0));
            } else if (kind === 'sequence') {
                // 9e 单体序列星：与真星同一份几何（config 的 UNIT_* / unitArt），
                // 星体尺寸 / 显示面字号与位置 / 进度点的点距点径全部读表——示意图与游戏里
                // 长得不一样就等于白教（同下面双星那条纪律）。星体用 starHi（216 源）显示到 96，
                // 用 72 源的 'star' 放大就违反"只缩不放"。右边三枚键帽说的是"一个字 = 一串键"，
                // 亮的那一格说的是"敲对一键亮一格"（好 = h-a-o）
                const art = ns.unitArt(this.level);
                const ratio = art.body / CONFIG.STAR_SIZE;
                const color = PALETTE.starColors[1];
                const tint = ns.tint(color);
                const starX = -112;
                this.art.add(this.add.image(starX, 0, 'glow').setTint(tint)
                    .setScale(CONFIG.STAR_HALO_SCALE * ratio).setAlpha(CONFIG.STAR_HALO_ALPHA));
                this.art.add(this.add.image(starX, 0, 'starHi').setTint(tint).setDisplaySize(art.body, art.body));
                this.art.add(this.add.image(starX, 0, 'starCore')
                    .setDisplaySize(CONFIG.STAR_CORE_SIZE * ratio, CONFIG.STAR_CORE_SIZE * ratio));
                this.art.add(ui.text(this, starX, art.faceY, '好', {
                    fontSize: art.face + 'px',
                    fontStyle: '700',
                    color: PALETTE.letter,
                    stroke: PALETTE.starlight,
                    strokeThickness: this.level.stroke
                }));
                const pips = this.add.graphics();
                // 好 = h-a-o：三枚键帽与三格点说的是同一个键序，亮一格 = 已经敲对一键。
                // 整排居中用的是 Star.drawPips 那个式子，示意图不与真星各算一套
                const demo = ['H', 'A', 'O'];
                const done = 1;
                const from = starX - (demo.length - 1) * art.pipPitch / 2;
                for (let i = 0; i < demo.length; i++) {
                    const x = from + i * art.pipPitch;
                    const on = i < done;
                    pips.fillStyle(ns.tint(on ? PALETTE.starlight : PALETTE.letter),
                        on ? 1 : CONFIG.UNIT_PIP_DIM_ALPHA);
                    pips.fillCircle(x, art.pipY, art.pipR * (on ? 1 : CONFIG.UNIT_PIP_DIM_SCALE));
                    if (on) {
                        pips.lineStyle(CONFIG.UNIT_PIP_EDGE, ns.tint(PALETTE.letter), CONFIG.UNIT_PIP_EDGE_ALPHA);
                        pips.strokeCircle(x, art.pipY, art.pipR);
                    }
                }
                this.art.add(pips);
                this.art.add(this.arrow(starX + art.body / 2 + 30, 0));
                demo.forEach((key, index) => this.art.add(this.keyCap(24 + index * 56, 0, key)));
            } else {
                // 与真双星同一份几何（config 的 PAIR_*）：大那颗先敲、小那颗是下一颗、
                // 连线末端的箭头指向下一颗——顺序只靠形状与大小读（harness/ui.md），
                // 示意图与游戏里长得不一样就等于白教
                const color = PALETTE.starColors[3];
                const gap = CONFIG.PAIR_GAP / 2;
                const chevron = CONFIG.PAIR_CHEVRON;
                const tip = gap - CONFIG.STAR_SIZE * CONFIG.PAIR_TAIL_SCALE / 2 - chevron / 2;
                const line = this.add.graphics();
                line.lineStyle(CONFIG.PAIR_LINK_WIDTH, ns.tint(color), 0.7);
                line.lineBetween(-gap, 0, gap, 0);
                line.lineBetween(tip - chevron, -chevron * 0.6, tip, 0);
                line.lineBetween(tip - chevron, chevron * 0.6, tip, 0);
                this.art.add(line);
                this.art.add(this.glyph(-gap, 0, 't', color, CONFIG.PAIR_LEAD_SCALE));
                this.art.add(this.glyph(gap, 0, 'h', color, CONFIG.PAIR_TAIL_SCALE));
            }

            this.art.setAlpha(0);
            this.artTweens.push(this.tweens.add({ targets: this.art, alpha: 1, duration: 260, ease: 'Quad.easeOut' }));
        }

        glyph(x, y, letter, color, scale) {
            const tint = ns.tint(color);
            const glow = this.add.image(0, 0, 'glow').setTint(tint).setScale(scale * 1.1).setAlpha(0.4);
            const body = this.add.image(0, 0, 'star').setTint(tint).setScale(scale);
            const core = this.add.image(0, 0, 'starCore').setScale(scale * 0.95);
            const text = ui.text(this, 0, 1, letter, {
                fontSize: Math.round(26 * scale) + 'px',
                fontStyle: '700',
                color: PALETTE.letter
            });
            return this.add.container(x, y, [glow, body, core, text]);
        }

        voidGlyph(x, y) {
            const graphics = this.add.graphics();
            graphics.fillStyle(ns.tint(PALETTE.voidCore), 1);
            graphics.fillCircle(0, 0, 24);
            graphics.lineStyle(3, ns.tint(PALETTE.voidDiskIn), 0.9);
            graphics.strokeEllipse(0, 0, 76, 26);
            graphics.lineStyle(2, ns.tint(PALETTE.voidDiskOut), 0.8);
            graphics.strokeEllipse(0, 0, 60, 18);
            return this.add.container(x, y, [graphics]);
        }

        arrow(x, y) {
            const graphics = this.add.graphics();
            graphics.lineStyle(2, ns.tint(PALETTE.hudMuted), 0.8);
            graphics.lineBetween(-18, 0, 16, 0);
            graphics.lineBetween(6, -8, 16, 0);
            graphics.lineBetween(6, 8, 16, 0);
            return this.add.container(x, y, [graphics]);
        }

        keyCap(x, y, letter) {
            const graphics = this.add.graphics();
            graphics.fillStyle(ns.tint(PALETTE.surface), 0.95);
            graphics.fillRoundedRect(-24, -24, 48, 48, 10);
            graphics.lineStyle(1.5, ns.tint(PALETTE.surfaceEdge), 1);
            graphics.strokeRoundedRect(-24, -24, 48, 48, 10);
            const text = ui.text(this, 0, 0, letter, { fontSize: '20px', fontStyle: '700', fontFamily: CONFIG.MONO });
            return this.add.container(x, y, [graphics, text]);
        }
        // 装饰流星的位移每帧推一次；星点闪烁与地平线脉冲在 Backdrop 自己的批量 timer 里
        update(time, delta) {
            this.backdrop.update(Math.min(delta, CONFIG.DELTA_MAX) / 1000);
        }
    }

    ns.scenes = ns.scenes || {};
    ns.scenes.TutorialScene = TutorialScene;
})(window.ShootingStars = window.ShootingStars || {});