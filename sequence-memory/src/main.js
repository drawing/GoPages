(function (ns) {
    'use strict';

    const PALETTE = ns.PALETTE;
    const utils = ns.utils;

    ns.hideSplash = function () {
        const splash = document.getElementById('splash');
        if (!splash) { return; }
        splash.classList.add('is-hidden');
        window.setTimeout(function () {
            if (splash.parentNode) { splash.parentNode.removeChild(splash); }
        }, 450);
    };

    ns.start = function () {
        const scenes = ns.scenes;
        const box = document.getElementById('game-container').getBoundingClientRect();
        const cssW = Math.max(1, Math.round(box.width));
        const cssH = Math.max(1, Math.round(box.height));
        const render = ns.RENDER_SCALE;

        ns.game = new Phaser.Game({
            type: Phaser.AUTO,
            parent: 'game-container',
            backgroundColor: PALETTE.skyTop,
            banner: false,
            // 音效走 Web Audio 现场合成（harness/architecture.md，阶段 4a），不启用 Phaser 的声音管理器
            audio: { noAudio: true },
            scale: {
                // NONE + zoom = 1/S，不是 harness/architecture.md 原来写的 RESIZE：RESIZE 模式下 updateScale 会把
                // canvas.width 钉成 CSS 像素，超采样根本挂不上去，retina 上 12px 的汉字必然发糊。
                // 这里 baseSize = CSS × S（就是 backing store），zoom 把 displaySize 推回 CSS 尺寸，
                // 于是 canvas 铺满视口、displayScale 正好是 S（指针坐标跟着对）、布局空间是 CSS 像素。
                // 视口变化由 utils/display.js 接管：debounce 之后重设尺寸，方向或宽高比变了才 restart 场景
                mode: Phaser.Scale.NONE,
                autoCenter: Phaser.Scale.NO_CENTER,
                width: cssW * render,
                height: cssH * render,
                zoom: 1 / render
            },
            scene: [
                scenes.BootScene,
                scenes.MenuScene,
                scenes.GameScene,
                scenes.PauseScene,
                scenes.GameOverScene,
                scenes.RecordsScene,
                scenes.SettingsScene,
                scenes.HowToScene
            ]
        });

        // DOM 已经 ready 时 boot 是在 new Phaser.Game() 里同步跑完的，READY 早就发过了，两种情况都得挂上
        function booted() {
            utils.watchViewport();
            utils.relayout();
        }

        if (ns.game.isBooted) { booted(); } else { ns.game.events.once(Phaser.Core.Events.READY, booted); }

        // iOS 首次解锁 AudioContext 必须在用户手势的同步调用栈里（harness/requirements.md #7）：
        // 挂 window 捕获监听而不是 Phaser 输入事件——后者进队列派发，不保证还在手势栈里。
        // 监听常驻不摘：iOS 切后台再回来 ctx 会重新 suspended，下一次点按顺手再解锁
        const unlock = function () { ns.systems.Audio.unlock(); };
        window.addEventListener('pointerdown', unlock, true);
        window.addEventListener('keydown', unlock, true);
    };
})(window.SequenceMemory = window.SequenceMemory || {});
