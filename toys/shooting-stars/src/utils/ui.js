(function (ns) {
    'use strict';

    const CONFIG = ns.CONFIG;
    const PALETTE = ns.PALETTE;
    const utils = ns.utils;
    const ui = utils.ui = {};

    ui.text = function (scene, x, y, content, style) {
        const defaults = {
            fontFamily: CONFIG.FONT,
            fontSize: '16px',
            color: PALETTE.hudText,
            resolution: ns.RENDER_SCALE
        };
        return scene.add.text(x, y, content, Object.assign(defaults, style || {})).setOrigin(0.5);
    };

    // 数字走等宽字体、字母走正文字体（8 易混字形，harness/ui.md）：正文字体的 '0' 与 'o' 只差高度，
    // 高速下落里读不出；等宽字体的斜杠零是类别级线索，不用比大小就分得出。
    // 星体字母一次只有一个字符，所以按字符挑家族就够。映射只此一处——星体字母与命中上飘字母
    // 必须同一份字形，否则炸开那一下换脸。符号不换：它们的问题是太小不是混淆
    ui.glyphFamily = function (ch) {
        return ch >= '0' && ch <= '9' ? CONFIG.MONO : CONFIG.FONT;
    };

    ui.card = function (scene, x, y, width, height, options) {
        const opts = options || {};
        const radius = opts.radius == null ? 18 : opts.radius;
        const left = x - width / 2;
        const top = y - height / 2;
        const graphics = scene.add.graphics();
        graphics.fillStyle(ns.tint(opts.fill || PALETTE.surface), opts.fillAlpha == null ? 0.78 : opts.fillAlpha);
        graphics.fillRoundedRect(left, top, width, height, radius);
        graphics.lineStyle(1, ns.tint(opts.stroke || PALETTE.surfaceEdge), opts.strokeAlpha == null ? 0.8 : opts.strokeAlpha);
        graphics.strokeRoundedRect(left, top, width, height, radius);
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
        return scene.add.container(x, y, [graphics, text]);
    };

    ui.button = function (scene, options) {
        const width = options.width || 268;
        const height = options.height || 50;
        const padX = options.padX == null ? 22 : options.padX;
        const barInset = Math.min(13, Math.round(height * 0.26));
        const accentHex = options.accent || PALETTE.gold;
        const accent = ns.tint(accentHex);
        const graphics = scene.add.graphics();
        const label = ui.text(scene, -width / 2 + padX, -1, options.label, {
            fontSize: options.fontSize || '17px',
            fontStyle: '600',
            letterSpacing: 0.6
        }).setOrigin(0, 0.5);
        const children = [graphics, label];

        // meta 是右侧的次要读数（如该档最高分），排在键位提示左边；没有键位时它就贴右边缘
        const meta = options.meta == null ? null : ui.text(scene, width / 2 - (options.hint ? 44 : 18), 0, options.meta, {
            fontSize: '12px',
            fontFamily: CONFIG.MONO,
            color: PALETTE.hudMuted
        }).setOrigin(1, 0.5);
        const hint = options.hint ? ui.text(scene, width / 2 - 18, 0, options.hint, {
            fontSize: '12px',
            fontFamily: CONFIG.MONO,
            color: PALETTE.hudMuted
        }).setOrigin(1, 0.5) : null;

        if (meta) { children.push(meta); }
        if (hint) { children.push(hint); }

        const button = scene.add.container(options.x, options.y, children);
        let selected = false;
        let hovered = false;
        let armed = false;

        function draw() {
            const active = selected || hovered;
            const radius = Math.min(14, height / 2);
            graphics.clear();
            graphics.fillStyle(ns.tint(PALETTE.surface), active ? 0.94 : 0.6);
            graphics.fillRoundedRect(-width / 2, -height / 2, width, height, radius);
            graphics.lineStyle(active ? 1.6 : 1, accent, active ? 0.9 : 0.24);
            graphics.strokeRoundedRect(-width / 2, -height / 2, width, height, radius);
            if (active) {
                graphics.fillStyle(accent, 0.95);
                graphics.fillRoundedRect(-width / 2 + 9, -height / 2 + barInset, 3, height - barInset * 2, 2);
            }
            label.setColor(active ? PALETTE.hudText : PALETTE.hudMuted);
            if (meta) { meta.setColor(active ? accentHex : PALETTE.hudMuted); }
            if (hint) { hint.setColor(active ? accentHex : PALETTE.hudMuted); }
        }

        let scaleTween = null;

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

        // 6b 的 UI 音只在 activate 这一处：指针点击与键盘（menu.activate → flash）都走它，不会各响一次。
        // options.sound 缺省确认音；显式传 null = 这个按钮不出声，它的 onSelect 自己会响（翻页 / 音量步进）
        const sound = options.sound === undefined ? 'uiOn' : options.sound;

        function activate() {
            if (scene._ssFading) { return; }
            if (sound) { ns.systems.audio().play(sound); }
            options.onSelect();
        }

        button.setSize(width, height);
        // hitArea 用左上角为原点的纹理空间：判定时 Phaser 会先给本地坐标加上 displayOrigin
        //  （Container 恒为 width/height 的一半），写成子物体那套居中坐标会只剩左上 1/4 可点
        button.setInteractive({
            hitArea: new Phaser.Geom.Rectangle(0, 0, width, height),
            hitAreaCallback: Phaser.Geom.Rectangle.Contains,
            useHandCursor: true
        });
        button.on('pointerover', function () { hovered = true; draw(); tweenScale(1.03, 120, true); });
        button.on('pointerout', function () { hovered = false; armed = false; draw(); tweenScale(1, 150); });
        button.on('pointerdown', function () { armed = true; tweenScale(0.97, 70); });
        button.on('pointerup', function () {
            if (!armed) { return; }
            armed = false;
            tweenScale(1, 90);
            activate();
        });

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
            if (scene._ssFading) { return; }
            tweenScale(1.06, 90, true, activate);
        };

        draw();
        return button;
    };

    ui.menu = function (scene, items, options) {
        const opts = options || {};
        const height = opts.height || 50;
        const gap = opts.gap == null ? 12 : opts.gap;
        const buttons = items.map(function (item, index) {
            return ui.button(scene, Object.assign({}, item, {
                x: opts.x,
                y: opts.y + index * (height + gap),
                width: opts.width,
                height: height
            }));
        });

        let current = 0;
        // 模态面板打开时置 false：键盘与 hover 选择都停，指针点击由全屏遮罩挡住（topOnly）
        let enabled = true;

        function select(index) {
            const next = Phaser.Math.Wrap(index, 0, buttons.length);
            // 选中项真的换了才响（6b）：构造时那次 select(0) 与悬停回原项都是 next === current，
            // 不出声——否则每次进菜单都白响一下，鼠标停在按钮上抖一下也是
            const moved = next !== current;
            buttons[current].setSelected(false);
            current = next;
            buttons[current].setSelected(true);
            if (moved) { ns.systems.audio().play('uiMove'); }
            if (opts.onChange) { opts.onChange(items[next], next); }
        }

        buttons.forEach(function (button, index) {
            button.on('pointerover', function () { if (enabled) { select(index); } });
        });

        const api = {
            buttons: buttons,
            select: select,
            activate: function () { buttons[current].flash(); },
            setEnabled: function (value) { enabled = value; },
            get index() { return current; }
        };

        select(0);

        utils.bindKeys(scene, function (event) {
            if (!enabled) { return; }
            switch (event.code) {
                case 'ArrowUp':
                case 'KeyW':
                    select(current - 1);
                    break;
                case 'ArrowDown':
                case 'KeyS':
                    select(current + 1);
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
})(window.ShootingStars = window.ShootingStars || {});