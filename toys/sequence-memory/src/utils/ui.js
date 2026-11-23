(function (ns) {
    'use strict';

    const CONFIG = ns.CONFIG;
    const PALETTE = ns.PALETTE;
    const utils = ns.utils;
    const ui = utils.ui = {};

    // 菜单构件主体默认透明度（ui.md 面板半透那条，用户手工调定 0.50）：
    // 半透是有意为之——远楼剪影的轮廓透过面板可见，透出来的是深色剪影的暗形，
    // 浅字深底对比度不掉。选中 / hover 态不走这个数，仍坐实
    const PANEL_ALPHA = 0.50;

    ui.text = function (scene, x, y, content, style) {
        const defaults = {
            fontFamily: CONFIG.FONT,
            fontSize: '16px',
            color: PALETTE.text,
            resolution: ns.RENDER_SCALE
        };
        const merged = Object.assign(defaults, style || {});
        // 中文没有空格，Phaser 默认按空格分词会整行不换（harness/architecture.md 的验证点，1l 在浏览器里
        // 确认过：390 宽下首页 LEAD 被裁掉两头）。advancedWordWrap 对超宽的"单词"逐字断行，
        // 拉丁文仍先按空格断，行为不变
        if (merged.wordWrap && merged.wordWrap.useAdvancedWrap == null) {
            merged.wordWrap = Object.assign({}, merged.wordWrap, { useAdvancedWrap: true });
        }
        return scene.add.text(x, y, content, merged).setOrigin(0.5);
    };

    // 圆角矩形的一半轮廓：只描上缘（含两个上角）或只描下缘。整圈描白会把下缘也提亮，
    // 那就成了"玻璃边框"而不是"光从上面来"。Phaser 的 arc 在同一条 path 上会接着上一个点
    // 连直线，所以两段 arc 之间那条顶边 / 底边是免费的，不用另画
    function rimEdge(graphics, left, top, width, height, radius, isTop, color, alpha) {
        const r = Math.min(radius, width / 2, height / 2);
        const bottom = top + height;
        graphics.lineStyle(1, color, alpha);
        graphics.beginPath();
        if (isTop) {
            graphics.arc(left + r, top + r, r, Math.PI, Math.PI * 1.5);
            graphics.arc(left + width - r, top + r, r, Math.PI * 1.5, Math.PI * 2);
        } else {
            graphics.arc(left + width - r, bottom - r, r, 0, Math.PI / 2);
            graphics.arc(left + r, bottom - r, r, Math.PI / 2, Math.PI);
        }
        graphics.strokePath();
    }

    // 一块被上方光源照着的板子（harness/ui.md 材质那条）：主体平填充 + 描边，再沿上缘压一道
    // 白色高光、沿下缘压一道暗影。平填充 + 1px 描边读起来是"色块"，加这两笔才是"板子"。
    //
    // **不用 fillGradientStyle**：Phaser 3.90 的 WebGL 只在 fillRect 上把四角色映到真四角；
    // 走 fillPath 的形状（圆角矩形就是）由 earcut 切成三角形之后，每个三角形拿到的是
    // TL / TR / BL 三个角色、按三角形自己的顶点序贴上去（batchFillPath 连 BR 都不读），
    // 于是一块板子上是按三角形分块的色斑 + 对角接缝。Canvas 渲染器更干脆，
    // GRADIENT_FILL_STYLE 整条跳过。所以"上亮下暗"只能靠这两道边缘描边，
    // 真渐变留给烤纹理的地方（sky / hudBar 是 image，没有这个问题）
    //
    // sink = true 时两笔对调：空台座是凹进去的槽，不是凸出来的板子。flat = true 两笔都不画（置灰）
    ui.slab = function (graphics, left, top, width, height, radius, opts) {
        const hi = opts.flat ? 0 : (opts.hi == null ? 0.12 : opts.hi);
        const lo = opts.flat ? 0 : (opts.lo == null ? 0.22 : opts.lo);
        graphics.fillStyle(ns.tint(opts.hex), opts.alpha == null ? 1 : opts.alpha);
        graphics.fillRoundedRect(left, top, width, height, radius);
        if (opts.wash) {
            graphics.fillStyle(ns.tint(opts.wash.hex), opts.wash.alpha);
            graphics.fillRoundedRect(left, top, width, height, radius);
        }
        graphics.lineStyle(opts.strokeWidth == null ? 1 : opts.strokeWidth,
            ns.tint(opts.stroke == null ? opts.hex : opts.stroke),
            opts.strokeAlpha == null ? 0.9 : opts.strokeAlpha);
        graphics.strokeRoundedRect(left, top, width, height, radius);
        // 两笔内缩 1 画在描边内沿上：同心才不会露出两条平行线。sink 只把两笔换到对面那条边，
        // 颜色不换——白永远是高光、黑永远是暗影，换的是"光从哪一侧进来"
        const inset = 1;
        if (hi) {
            rimEdge(graphics, left + inset, top + inset, width - inset * 2, height - inset * 2,
                Math.max(1, radius - inset), !opts.sink, 0xffffff, hi);
        }
        if (lo) {
            rimEdge(graphics, left + inset, top + inset, width - inset * 2, height - inset * 2,
                Math.max(1, radius - inset), !!opts.sink, 0x000000, lo);
        }
        return graphics;
    };

    // 面板卡。给了 onSelect 就是**可选卡**（5c，记录页点一张卡换下面那条曲线）：hover 与选中
    // 重画描边与底色，选中另给左侧一条强调条——选中态不只靠颜色（harness/ui.md 色觉友好那条），
    // 与 ui.button 的 active 条同一套状态语言。命中区是一个空 Container：Graphics 自己没有 Origin
    // 组件，用它的 hitArea 要自己补偏移，而 Container 那套 (0,0,w,h) 约定全项目已经在用。
    // 返回的仍是那张 Graphics，不可选的调用方一字不改
    ui.card = function (scene, x, y, width, height, options) {
        const opts = options || {};
        const radius = opts.radius == null ? 18 : opts.radius;
        const left = x - width / 2;
        const top = y - height / 2;
        const graphics = scene.add.graphics();
        const selectable = typeof opts.onSelect === 'function';
        const accentHex = opts.accent || PALETTE.dominantSoft;
        const accent = ns.tint(accentHex);
        const selected = !!opts.selected;
        let hovered = false;
        let armed = false;

        function draw() {
            const strong = selectable && (selected || hovered);
            graphics.clear();
            // 默认态平填充 + 弱描边，边缘材质只给 hover / 选中（ui.md 材质那条）；
            // 主体半透，剪影轮廓透出来（ui.md 面板半透那条）
            ui.slab(graphics, left, top, width, height, radius, {
                hex: opts.fill || PALETTE.surface,
                alpha: opts.fillAlpha == null ? PANEL_ALPHA : opts.fillAlpha,
                hi: strong ? 0.16 : 0,
                lo: strong ? 0.26 : 0,
                wash: strong ? { hex: accentHex, alpha: 0.1 } : null,
                stroke: strong ? accentHex : (opts.stroke || PALETTE.surfaceEdge),
                strokeWidth: strong ? 1.6 : 1,
                strokeAlpha: strong ? 0.9 : (opts.strokeAlpha == null ? 0.8 : opts.strokeAlpha)
            });
            if (selectable && selected) {
                // 强调条压在卡自己的内扣里（记录页的文字内扣 ≥10，条占 6–9）：不碰内容，
                // 也仍在圆角弧以内（弧只吃掉角上 18px，条上下各留了 inset）
                const inset = Math.min(13, Math.round(height * 0.18));
                graphics.fillStyle(accent, 0.95);
                graphics.fillRoundedRect(left + 6, top + inset, 3, height - inset * 2, 2);
            }
        }

        draw();

        if (selectable) {
            const hit = scene.add.container(x, y).setSize(width, height);
            hit.setInteractive({
                hitArea: new Phaser.Geom.Rectangle(0, 0, width, height),
                hitAreaCallback: Phaser.Geom.Rectangle.Contains,
                useHandCursor: true
            });
            hit.on('pointerover', function () { hovered = true; draw(); });
            hit.on('pointerout', function () { hovered = false; armed = false; draw(); });
            hit.on('pointerdown', function () { armed = true; });
            hit.on('pointerup', function () {
                if (!armed || scene._smFading) { return; }
                armed = false;
                ns.systems.Audio.play('ui');
                opts.onSelect();
            });
        }

        return graphics;
    };

    ui.badge = function (scene, x, y, label, color) {
        const hex = color || PALETTE.info;
        const text = ui.text(scene, 0, 0, label, { fontSize: '12px', color: hex, letterSpacing: 1.2 });
        const width = text.width + 24;
        const graphics = scene.add.graphics();
        graphics.fillStyle(ns.tint(hex), 0.12);
        graphics.fillRoundedRect(-width / 2, -12, width, 24, 12);
        graphics.lineStyle(1, ns.tint(hex), 0.42);
        graphics.strokeRoundedRect(-width / 2, -12, width, 24, 12);
        // Container 的 width 默认是 0：调用方要按宽度排一排徽标（结算图例），不给尺寸就会全叠在原点
        return scene.add.container(x, y, [graphics, text]).setSize(width, 24);
    };

    ui.button = function (scene, options) {
        const width = options.width || 268;
        const height = options.height || Math.max(CONFIG.TOUCH_TARGET, 50);
        const padX = options.padX == null ? 22 : options.padX;
        const barInset = Math.min(13, Math.round(height * 0.26));
        const accentHex = options.accent || PALETTE.dominantSoft;
        const accent = ns.tint(accentHex);
        // 置灰不是一种灰：accent 由调用方按状态给（如未开放入口的中性灰、主按钮的应用紫），描边与右侧读数都吃它
        const disabled = !!options.disabled;
        const graphics = scene.add.graphics();
        // 纯动作按钮（无右侧读数）标签居中；带 meta / hint 的列表行保持左标签 + 右读数（ui.md）。
        // align: 'left' 是显式例外（设置页行按钮）：状态写在标签里、没有 meta，但整行读的是列表不是动作
        const centered = options.align !== 'left' && options.meta == null && !options.hint;
        const label = ui.text(scene, centered ? 0 : -width / 2 + padX, -1, options.label, {
            fontSize: options.fontSize || '17px',
            fontStyle: '600',
            letterSpacing: 0.6
        }).setOrigin(centered ? 0.5 : 0, 0.5);
        const children = [graphics, label];

        // meta 是右侧的次要读数（如该组合的历史最高），排在键位提示左边；没有键位时它就贴右边缘。
        // hint 是桌面键位提示，阶段 8d 才接：手机上不许出现（harness/architecture.md）
        const meta = options.meta == null ? null : ui.text(scene, width / 2 - (options.hint ? 44 : 18), 0, options.meta, {
            fontSize: '12px',
            fontFamily: CONFIG.MONO,
            color: PALETTE.textDim
        }).setOrigin(1, 0.5);
        const hint = options.hint ? ui.text(scene, width / 2 - 18, 0, options.hint, {
            fontSize: '12px',
            fontFamily: CONFIG.MONO,
            color: PALETTE.textDim
        }).setOrigin(1, 0.5) : null;

        if (meta) { children.push(meta); }
        if (hint) { children.push(hint); }

        const button = scene.add.container(options.x, options.y, children);
        let selected = false;
        let hovered = false;
        let armed = false;

        function draw() {
            const active = !disabled && (selected || hovered);
            const radius = Math.min(14, height / 2);
            graphics.clear();
            if (disabled) {
                // 暗底 + 弱描边，但 meta 保留状态色：置灰之后"为什么不能选"还得读得出来。
                // flat：材质是给能点的东西的，置灰的板子不该有光泽
                ui.slab(graphics, -width / 2, -height / 2, width, height, radius, {
                    hex: PALETTE.overlay, alpha: 0.5, flat: true,
                    stroke: accentHex, strokeWidth: 1, strokeAlpha: 0.34
                });
                label.setColor(PALETTE.textFaint);
                if (meta) { meta.setColor(accentHex); }
                if (hint) { hint.setColor(PALETTE.textFaint); }
                return;
            }
            // 默认态平填充 + 弱描边，材质只给 active；主体半透（ui.md 材质 / 面板半透两条）
            ui.slab(graphics, -width / 2, -height / 2, width, height, radius, {
                hex: PALETTE.surface,
                alpha: active ? 0.98 : PANEL_ALPHA,
                hi: active ? 0.18 : 0,
                lo: active ? 0.26 : 0,
                stroke: accentHex,
                strokeWidth: active ? 1.6 : 1,
                strokeAlpha: active ? 0.9 : 0.3
            });
            if (active) {
                graphics.fillStyle(accent, 0.95);
                graphics.fillRoundedRect(-width / 2 + 9, -height / 2 + barInset, 3, height - barInset * 2, 2);
            }
            label.setColor(active ? PALETTE.text : PALETTE.textDim);
            if (meta) { meta.setColor(active ? accentHex : PALETTE.textDim); }
            if (hint) { hint.setColor(active ? accentHex : PALETTE.textDim); }
        }

        let scaleTween = null;
        // 减少动效（4b，harness/ui.md）：hover 浮动与 flash 的弹一下砍掉，按下缩放保留（信息性反馈）
        const reduced = utils.reducedMotion();

        // 静止态必须停在 scale 1：文字是预栅格化纹理，长期停在 1.02 会一直重采样发虚
        function tweenScale(value, duration, yoyo, onComplete) {
            if (scaleTween) { scaleTween.stop(); }
            scaleTween = scene.tweens.add({
                targets: button,
                scaleX: value,
                scaleY: value,
                duration: duration,
                yoyo: !!yoyo,
                ease: 'Quad.easeOut',
                onComplete: onComplete || null
            });
        }

        function activate() {
            if (scene._smFading) { return; }
            ns.systems.Audio.play('ui');
            options.onSelect();
        }

        button.setSize(width, height);
        // 置灰的按钮压根不挂 input：不是"点了没反应"，是根本不接指针，hover 也不会有反馈
        if (!disabled) {
            // hitArea 用左上角为原点的纹理空间：判定时 Phaser 会先给本地坐标加上 displayOrigin
            //（Container 恒为 width/height 的一半），写成子物体那套居中坐标会只剩左上 1/4 可点
            button.setInteractive({
                hitArea: new Phaser.Geom.Rectangle(0, 0, width, height),
                hitAreaCallback: Phaser.Geom.Rectangle.Contains,
                useHandCursor: true
            });
            button.on('pointerover', function () { hovered = true; draw(); if (!reduced) { tweenScale(1.03, 120, true); } });
            button.on('pointerout', function () { hovered = false; armed = false; draw(); tweenScale(1, 150); });
            button.on('pointerdown', function () { armed = true; tweenScale(0.97, 70); });
            button.on('pointerup', function () {
                if (!armed) { return; }
                armed = false;
                tweenScale(1, 90);
                activate();
            });
        }

        button.setSelected = function (value) {
            selected = value;
            draw();
            return button;
        };

        button.setLabel = function (value) {
            label.setText(value);
            return button;
        };

        button.setMeta = function (value) {
            meta.setText(value);
            return button;
        };

        button.flash = function () {
            if (scene._smFading) { return; }
            if (reduced) { activate(); return; }
            tweenScale(1.06, 90, true, activate);
        };

        draw();
        return button;
    };

    // 选项胶囊：宽度跟着文字走（ui.button 要外部给宽度），三态是 选中 / 可选 / 置灰。
    // mark 是状态后缀（如"未开放"），与名字分开着色；首页的玩法档用它。
    // 给了 width 就是等宽分段（首页玩法档按列宽三等分，harness/ui.md）：仍不小于文字自身的内扣宽
    // 与高度——调用方算出来的段宽偏窄时宁可溢出一点行宽，也不能把字挤出板子
    ui.chip = function (scene, options) {
        const height = options.height || 34;
        const padX = options.padX == null ? 12 : options.padX;
        const selected = !!options.selected;
        const disabled = !!options.disabled;
        const accentHex = options.accent || PALETTE.dominantSoft;

        const label = ui.text(scene, 0, 0, options.label, {
            fontSize: options.fontSize || '12px',
            fontStyle: selected ? '600' : '400',
            letterSpacing: 0.4
        });
        const mark = options.mark ? ui.text(scene, 0, 0, options.mark, {
            fontSize: '10px',
            fontFamily: CONFIG.MONO,
            letterSpacing: 0.2
        }) : null;

        const innerGap = mark ? 5 : 0;
        const inner = label.width + innerGap + (mark ? mark.width : 0);
        const natural = Math.max(height, Math.ceil(inner + padX * 2));
        const width = Math.max(natural, Math.round(options.width || 0));
        label.setX(-inner / 2 + label.width / 2);
        if (mark) { mark.setX(-inner / 2 + label.width + innerGap + mark.width / 2); }

        const graphics = scene.add.graphics();
        const chip = scene.add.container(options.x, options.y, mark ? [graphics, label, mark] : [graphics, label]);
        let hovered = false;
        let armed = false;

        function draw() {
            const radius = height / 2;
            const strong = !disabled && (selected || hovered);
            graphics.clear();
            // 默认态平填充 + 弱描边，材质与 wash 只给选中 / hover；主体半透（ui.md 两条）
            ui.slab(graphics, -width / 2, -height / 2, width, height, radius, {
                hex: disabled ? PALETTE.overlay : PALETTE.surface,
                alpha: disabled ? 0.5 : (strong ? 0.96 : PANEL_ALPHA),
                flat: disabled,
                hi: strong ? 0.18 : 0,
                lo: strong ? 0.26 : 0,
                wash: (selected && !disabled) ? { hex: accentHex, alpha: 0.3 } : null,
                stroke: accentHex,
                strokeWidth: strong ? 1.4 : 1,
                strokeAlpha: disabled ? 0.34 : (strong ? 0.9 : 0.3)
            });
            label.setColor(disabled ? PALETTE.textFaint : (selected ? PALETTE.text : PALETTE.textDim));
            if (mark) { mark.setColor(disabled || strong ? accentHex : PALETTE.textFaint); }
        }

        chip.setSize(width, height);
        if (!disabled) {
            // 与 ui.button 同一套 hitArea 约定（Container 的本地坐标判定会先加 displayOrigin）
            chip.setInteractive({
                hitArea: new Phaser.Geom.Rectangle(0, 0, width, height),
                hitAreaCallback: Phaser.Geom.Rectangle.Contains,
                useHandCursor: true
            });
            chip.on('pointerover', function () { hovered = true; draw(); });
            chip.on('pointerout', function () { hovered = false; armed = false; draw(); });
            chip.on('pointerdown', function () { armed = true; });
            chip.on('pointerup', function () {
                if (!armed || scene._smFading) { return; }
                armed = false;
                ns.systems.Audio.play('ui');
                options.onSelect();
            });
        }

        draw();
        return chip;
    };

    ui.menu = function (scene, items, options) {
        const opts = options || {};
        const height = opts.height || Math.max(CONFIG.TOUCH_TARGET, 50);
        const gap = opts.gap == null ? 12 : opts.gap;
        const buttons = items.map(function (item, index) {
            return ui.button(scene, Object.assign({}, item, {
                x: opts.x,
                y: opts.y + index * (height + gap),
                width: opts.width,
                height: height
            }));
        });

        const usable = items.map(function (item) { return !item.disabled; });
        let current = -1;

        // 置灰项跳过：↑↓ 与 hover 都只在能选的档之间走，落到置灰档上会让人以为点得动
        function nearest(index, direction) {
            for (let step = 0; step < buttons.length; step += 1) {
                const candidate = Phaser.Math.Wrap(index + direction * step, 0, buttons.length);
                if (usable[candidate]) { return candidate; }
            }
            return -1;
        }

        function select(index, direction) {
            const next = nearest(index, direction || 1);
            if (next < 0) { return; }
            if (current >= 0) { buttons[current].setSelected(false); }
            current = next;
            buttons[current].setSelected(true);
            if (opts.onChange) { opts.onChange(items[next], next); }
        }

        buttons.forEach(function (button, index) {
            button.on('pointerover', function () { select(index); });
        });

        const api = {
            buttons: buttons,
            select: select,
            activate: function () { if (current >= 0) { buttons[current].flash(); } },
            get index() { return current; }
        };

        select(0);

        // 方向键与 Enter 是桌面增强，不是任何功能的前提：8d 之前所有场景只靠指针就得走通（harness/architecture.md）
        utils.bindKeys(scene, function (event) {
            switch (event.code) {
                case 'ArrowUp':
                case 'KeyW':
                    select(current - 1, -1);
                    break;
                case 'ArrowDown':
                case 'KeyS':
                    select(current + 1, 1);
                    break;
                case 'Enter':
                case 'NumpadEnter':
                case 'Space':
                    api.activate();
                    break;
                default:
                    if (opts.onKey) { opts.onKey(event, api); }
            }
        });

        return api;
    };
})(window.SequenceMemory = window.SequenceMemory || {});
