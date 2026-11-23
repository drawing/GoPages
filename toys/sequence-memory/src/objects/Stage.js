(function (ns) {
    'use strict';

    const PALETTE = ns.PALETTE;
    const DEPTH = ns.DEPTH;
    const MOTION = ns.MOTION;
    const objects = ns.objects = ns.objects || {};
    const ui = ns.utils.ui;

    // 中央呈现台（harness/requirements.md2e）：呈现形态决定测哪条通道——符号在屏幕中央逐个闪现、位置恒定，
    // 玩家就没有"哪一格亮过"这个免费索引可用，只能记身份（harness/gameplay.md）。复现仍走 Board 的
    // 棋盘：呈现不泄露位置，这两件事合起来才成立，只做一半等于没做。
    //
    // 动效契约与 Board 的格子一字不差（harness/ui.md）：亮起 80ms 柔光淡入 + 1→1.08→1 弹一下、
    // 标记转白、熄灭 180ms 留余晖——换形态不换节奏，否则"四种类型节奏一致"这条判据就废了。
    // 物件常驻、状态走 sync(view)（harness/ui.md）；呈现阶段不接任何输入（harness/gameplay.md），
    // 所以这里连 setInteractive 都不挂。
    //
    // 符号的表达按 kind 分两条：形状 / 数字只有一张 image，换项时换纹理与染色
    //（与 HUD 进度点"重画内容不重建物件"同一条纪律）。四形状与十个数字烤的是同尺寸
    // 白色纹理（GLYPH_SIZE × TEXTURE_SUPERSAMPLE），换纹理之后要再给一次 setDisplaySize——
    // scale 是数值，纹理换了显示尺寸就跟着变。扑克的牌面是容器不是一张 image（2g），
    // 走 Cards.faceKit 的常驻牌面 + 牌背翻牌，另见 cardStage

    // 中央符号的边长占玩法区边长的比例：够大才有"闪一下"的分量，又不顶满面板——
    // 柔光要按 2.1 倍扩散（与 Board 的格子同一个倍数），留出余晖的空间
    const SIDE = 0.62;
    // 标记占符号边长的比例。Board 的格子是 0.44，这里符号大得多，比例略收才不顶边
    const GLYPH = 0.5;
    // 与 Board 的格子同一个圆角比例：形态换了，视觉语言不换
    const RADIUS = 0.16;
    // 中央大牌的尺寸（harness/ui.md）：按场景给的可用矩形内接 5:7 吃满，只给柔光与上下留余量。
    // 原先是"视口短边 × 0.4、夹进 120–160"——那个 160 的硬顶是 52 张牌堆时代要和整副牌挤同一块
    // 地方留下的；呈现搬到中央、呈现期选牌器整层隐藏之后，那张牌是屏幕上唯一的玩法物件，
    // 没有理由还只有 160 宽。仍不走 fitBoard 的结果：那是选牌器装不下时的适配（13 格 + tab 要排得下），
    // 呈现的分量不该跟着点数格的排布缩。
    // 0.88 / 0.94 是留给柔光（2.2 / 1.7 倍扩散）与短提示 / 状态行的余量，320 的顶防桌面上一张牌糊满屏。
    // 竖屏因此吃满：390×844 拿到 296×414（原先 156×218）、320×568 拿到 209×293（原先 128×179）。
    // 横屏在 4d 之后也拿得到：HUD 搬进左列、可用高是视口全高减留白，844×390 是 226×316、
    // 568×320 与 480×320 是 185×259，不再越界；min 120 仍是荒谬视口的底，
    // 与 fitBoard 同一条纪律（宁可溢出也不缩到下限以下）
    const CARD_FIT = { w: 0.88, h: 0.94, min: 120, max: 320 };

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    objects.stage = function (scene, opts) {
        if (ns.BOARDS[opts.type].kind === 'picker') { return cardStage(scene, opts); }
        return glyphStage(scene, opts);
    };

    function glyphStage(scene, opts) {
        const symbols = ns.SYMBOLS[opts.type];
        const side = Math.round(opts.size * SIDE);
        const radius = Math.round(side * RADIUS);
        const glyph = Math.round(side * GLYPH);
        const container = scene.add.container(opts.x, opts.y).setDepth(DEPTH.board);
        // 减少动效（4b，harness/ui.md）：亮起弹一下砍掉，柔光淡入 / 熄灭余晖照旧——
        // 呈现台与棋盘格子同一条契约，换形态不换节奏，降级也不换
        const reduced = ns.utils.reducedMotion();

        // 台座常驻：项与项之间中央是空的，没有锚点玩家不知道该看哪里。
        // 它只是锚点，不给任何可点的暗示（呈现阶段没有呼吸光，同 Board 的纪律）。
        // sink：台座是凹进去的槽，高光与暗影换边（暗影压上缘、高光留下缘），
        // 与亮起那块板子（凸出来、白光压上缘）正好相反（harness/ui.md 材质那条）
        const socket = scene.add.graphics();
        ui.slab(socket, -side / 2, -side / 2, side, side, radius, {
            hex: PALETTE.surface, alpha: 0.5, sink: true, hi: 0.16, lo: 0.45,
            stroke: PALETTE.surfaceEdge, strokeWidth: 1, strokeAlpha: 0.6
        });

        // 柔光 ADD 混合（harness/ui.md 材质那条）：normal 混合下它是盖在台座上的一层灰雾，
        // ADD 才是"从符号里透出来的光"
        const glow = scene.add.image(0, 0, 'glow')
            .setDisplaySize(side * 2.1, side * 2.1)
            .setBlendMode(Phaser.BlendModes.ADD)
            .setAlpha(0);
        const panel = scene.add.graphics().setAlpha(0);
        const mark = scene.add.image(0, 0, 'glyph-' + symbols[0].glyph)
            .setDisplaySize(glyph, glyph)
            .setAlpha(0);
        // 弹一下要柔光 / 面板 / 标记三层一起动，所以套一个子容器
        const box = scene.add.container(0, 0, [glow, panel, mark]);
        container.add([socket, box]);

        let shown = null;
        let scaleTween = null;

        function fade(obj, to, duration) {
            scene.tweens.killTweensOf(obj);
            scene.tweens.add({ targets: obj, alpha: to, duration: duration, ease: 'Quad.easeOut' });
        }

        function sync(view) {
            const presenting = view.phase === 'present' || view.phase === 'lead';
            const index = presenting && view.lit !== null ? view.lit : null;
            // 目标态没变就不动：呈现节拍里的每一次 sync 都走这里，只有换项与熄灭该有 tween
            if (index === shown) { return; }
            shown = index;

            if (index === null) {
                fade(glow, 0, MOTION.litOut);
                fade(panel, 0, MOTION.litOut);
                fade(mark, 0, MOTION.litOut);
                return;
            }

            const symbol = symbols[index];
            panel.clear();
            // 与 Board 的亮起格同一份画法（harness/ui.md"换形态不换节奏"，材质也同一份）：
            // 上缘白光 + 下缘暗影，与 ADD 柔光一起构成"发光实体"
            ui.slab(panel, -side / 2, -side / 2, side, side, radius, {
                hex: symbol.hex, alpha: 0.92, hi: 0.3, lo: 0.24,
                strokeWidth: 2, strokeAlpha: 0.95
            });
            glow.setTint(ns.tint(symbol.hex));
            mark.setTexture('glyph-' + symbol.glyph)
                .setDisplaySize(glyph, glyph)
                .setTint(ns.tint('#ffffff'));
            fade(glow, 0.42, MOTION.litIn);
            fade(panel, 1, MOTION.litIn);
            fade(mark, 1, MOTION.litIn);

            if (!reduced) {
                if (scaleTween) { scaleTween.stop(); }
                box.setScale(1);
                scaleTween = scene.tweens.add({
                    targets: box, scaleX: 1.08, scaleY: 1.08,
                    duration: MOTION.pop / 2, ease: 'Back.easeOut', yoyo: true,
                    onComplete: function () { scaleTween = null; }
                });
            }
        }

        return { container: container, sync: sync };
    }

    // 扑克呈现（2g，harness/ui.md）：屏幕正中一张大牌，牌背 → 翻正 → 淡出。
    // 翻牌复用 MOTION.flip 的 scaleX 1→0 换面 →0→1；柔光淡入 / 淡出留余晖仍走 litIn / litOut
    // ——换形态不换节奏。牌面走 Cards.faceKit：容器常驻，换项只换纹理 / 墨色与点位摆位。
    // 这一档牌宽必然 ≥ Cards.FULL_MIN，拿到的是完整牌面（四角角标 + 标准点位 / 宫廷窗格）；
    // 点数格与结算回放格共用同一份画法，牌宽不够就走 mini 档（harness/ui.md）。
    // 呈现阶段不接任何输入，台座没有呼吸光（同 glyphStage 的纪律）
    function cardStage(scene, opts) {
        const symbols = ns.SYMBOLS[opts.type];
        // 可用矩形由场景给（GameScene 才知道 HUD / 短提示 / 状态行 / 按钮的内扣，
        // Stage 自己只拿得到视口）；横屏给的是面板宽不是列宽，面板右对齐，给列宽会把牌推出屏幕
        const avail = opts.avail;
        const cardW = Math.round(clamp(
            Math.min(avail.w * CARD_FIT.w, avail.h * CARD_FIT.h * objects.cards.ratio),
            CARD_FIT.min, CARD_FIT.max
        ));
        const cardH = Math.round(cardW / objects.cards.ratio);
        const radius = Math.max(2, Math.round(cardW * 0.1));
        const container = scene.add.container(opts.x, opts.y).setDepth(DEPTH.board);

        // 台座是牌形的暗槽：项与项之间中央只剩它当视线锚点，不给任何可点的暗示。
        // sink 与 glyphStage 的台座同一条：槽是凹进去的，高光与暗影换边（harness/ui.md 材质那条）
        const socket = scene.add.graphics();
        ui.slab(socket, -cardW / 2, -cardH / 2, cardW, cardH, radius, {
            hex: PALETTE.surface, alpha: 0.5, sink: true, hi: 0.16, lo: 0.45,
            stroke: PALETTE.surfaceEdge, strokeWidth: 1, strokeAlpha: 0.6
        });

        // 柔光 ADD 混合，与 glyphStage 同一条：牌面是不透明的纸白，挡住的中间那段不参与合成，
        // 看得见的是溢出到牌外面那一圈
        const glow = scene.add.image(0, 0, 'glow')
            .setDisplaySize(cardW * 2.2, cardH * 1.7)
            .setBlendMode(Phaser.BlendModes.ADD)
            .setAlpha(0);
        const back = objects.cards.back(scene, 0, 0, cardW, cardH).setAlpha(0);
        const kit = objects.cards.faceKit(scene, cardW, cardH);
        const face = kit.container.setVisible(false);
        // 翻牌写 box 的 scaleX，淡入淡出写 back / face 的 alpha：
        // 两个通道各写各的物件，fade 的 killTweensOf 不会误杀翻牌
        const box = scene.add.container(0, 0, [back, face]);
        container.add([socket, glow, box]);

        let shown = null;
        let flipTween = null;

        function fade(obj, to, duration) {
            scene.tweens.killTweensOf(obj);
            scene.tweens.add({ targets: obj, alpha: to, duration: duration, ease: 'Quad.easeOut' });
        }

        function stopFlip() {
            if (flipTween) { flipTween.stop(); flipTween = null; }
        }

        function sync(view) {
            const presenting = view.phase === 'present' || view.phase === 'lead';
            const index = presenting && view.lit !== null ? view.lit : null;
            if (index === shown) { return; }
            shown = index;

            if (index === null) {
                // 熄灭可能落在翻牌半路：停住翻牌，把当前看得见的那一面淡出留余晖，
                // 下一项开始时 box 会整个复位，不会留着半张牌
                stopFlip();
                fade(glow, 0, MOTION.litOut);
                fade(back, 0, MOTION.litOut);
                fade(face, 0, MOTION.litOut);
                return;
            }

            const symbol = symbols[index];
            stopFlip();
            box.setScale(1);
            back.setVisible(true);
            scene.tweens.killTweensOf(face);
            face.setVisible(false).setAlpha(1);
            kit.paint(symbol.card);
            glow.setTint(ns.tint(symbol.hex));
            fade(glow, 0.42, MOTION.litIn);
            fade(back, 1, MOTION.litIn);
            flipTween = scene.tweens.add({
                targets: box, scaleX: 0, duration: MOTION.flip, ease: 'Quad.easeIn',
                onComplete: function () {
                    back.setVisible(false);
                    face.setVisible(true);
                    flipTween = scene.tweens.add({
                        targets: box, scaleX: 1, duration: MOTION.flip, ease: 'Quad.easeOut',
                        onComplete: function () { flipTween = null; }
                    });
                }
            });
        }

        return { container: container, sync: sync };
    }
})(window.SequenceMemory = window.SequenceMemory || {});
