(function (ns) {
    'use strict';

    const CONFIG = ns.CONFIG;

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

        // 6a：AudioContext 必须在用户手势的同步调用栈里 resume，capture 监听赶在 Phaser 之前拿到事件。
        // 常驻不摘——iOS 切后台再回来 ctx 重新 suspended，下一次点按顺手再解锁（6d 的恢复不靠刷新）
        const unlock = function () { ns.systems.audio().unlock(); };
        window.addEventListener('pointerdown', unlock, true);
        window.addEventListener('keydown', unlock, true);

        // 6d：回前台主动恢复一次挂起的 ctx（已有过手势才有效）。浏览器不批就保持 suspended，
        // 上面的手势监听常驻兜底——恢复不靠刷新
        document.addEventListener('visibilitychange', function () {
            if (!document.hidden) { ns.systems.audio().resume(); }
        });

        ns.game = new Phaser.Game({
            type: Phaser.AUTO,
            parent: 'game-container',
            backgroundColor: ns.PALETTE.skyTop,
            banner: false,
            // 音效走自建 AudioSys（6a），不启用 Phaser 的声音管理器
            audio: { noAudio: true },
            scale: {
                mode: Phaser.Scale.FIT,
                autoCenter: Phaser.Scale.CENTER_BOTH,
                width: CONFIG.WIDTH * ns.RENDER_SCALE,
                height: CONFIG.HEIGHT * ns.RENDER_SCALE
            },
            physics: { default: 'arcade', arcade: { gravity: { x: 0, y: 0 } } },
            // 除了 Enter / 空格 / 方向键，还要捕获 Lv5 的符号键：Firefox 的 '/' 与 "'" 快速查找会抢走焦点。
            // 场景 handler 跑在 rAF 里，那时默认行为已经发生，自己 preventDefault 没用，只有这里能拦。
            // 59 / 61 / 173 是 Firefox 的历史 keyCode（; = -），标准值是 186 / 187 / 189，两套都收。
            // Phaser 只在没有任何修饰键时才 preventDefault，所以 Ctrl+± 缩放、Cmd+R 都不受影响
            input: {
                // 6e：两拇指交替点星时第二根手指也要有指针可用，默认数量不够会丢 pointerdown
                activePointers: 3,
                keyboard: {
                    capture: [13, 32, 37, 38, 39, 40,
                        59, 61, 173, 186, 187, 188, 189, 190, 191, 219, 221, 222]
                }
            },
            scene: [
                scenes.BootScene,
                scenes.MenuScene,
                scenes.TutorialScene,
                scenes.GameScene,
                scenes.PauseScene,
                scenes.GameOverScene
            ]
        });

        ns.game.scale.on(Phaser.Scale.Events.RESIZE, ns.utils.syncRenderScale);
        ns.game.events.on(Phaser.Core.Events.POST_STEP, ns.utils.checkPixelRatio);
    };
})(window.ShootingStars = window.ShootingStars || {});