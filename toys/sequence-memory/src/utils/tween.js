(function (ns) {
    'use strict';

    const CONFIG = ns.CONFIG;
    const PALETTE = ns.PALETTE;
    const utils = ns.utils = ns.utils || {};
    const SCRIM = Phaser.Display.Color.HexStringToColor(PALETTE.scrim);

    // 减少动效（4b，harness/ui.md）：系统偏好不是玩家设置——不进 Prefs、不持久化、不进开局快照。
    // 每次现读 matchMedia：物件在构建时读一次，场景 create / 转屏 restart 重读，
    // 等于免费跟随系统切换。读不到（老浏览器 / 假 window）回落"不减"
    utils.reducedMotion = function () {
        try {
            return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        } catch (err) {
            return false;
        }
    };

    // 场景切换统一走 fadeTo，参数走 scene.start(key, data) + init(data)，不留全局可变界面状态（harness/architecture.md）
    utils.fadeTo = function (scene, key, data) {
        if (scene._smFading) { return; }
        scene._smFading = true;
        scene.input.enabled = false;
        const camera = scene.cameras.main;
        camera.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, function () {
            scene.scene.start(key, data);
        });
        camera.fadeOut(CONFIG.FADE_MS, SCRIM.red, SCRIM.green, SCRIM.blue);
    };

    utils.fadeIn = function (scene) {
        scene._smFading = false;
        scene.input.enabled = true;
        scene.cameras.main.fadeIn(CONFIG.FADE_MS, SCRIM.red, SCRIM.green, SCRIM.blue);
    };

    // 桌面键盘增强。一个场景只留一个 handler：菜单型屏幕换一次值就整块重画（纪律 2），
    // 重画会再走一次构件构建，不摘掉旧 handler 就会一次次叠上去，最后按键去操作已销毁的物件
    utils.bindKeys = function (scene, handler) {
        const keyboard = scene.input.keyboard;
        if (scene._smKeyHandler) { keyboard.off('keydown', scene._smKeyHandler); }
        const bound = function (event) {
            if (event.repeat || scene._smFading || scene.scene.isPaused()) { return; }
            handler(event);
        };
        scene._smKeyHandler = bound;
        keyboard.on('keydown', bound);
    };

    utils.riseIn = function (scene, targets, options) {
        // 进场上浮是装饰性运动：减少动效时直接落位（物件本就在终点，不动就是降级）
        if (utils.reducedMotion()) { return; }
        const opts = options || {};
        const list = [].concat(targets);
        const distance = opts.distance == null ? 14 : opts.distance;
        const alpha = opts.alpha == null ? 1 : opts.alpha;
        list.forEach(function (target, index) {
            const y = target.y;
            target.setY(y + distance).setAlpha(0);
            scene.tweens.add({
                targets: target,
                y: y,
                alpha: alpha,
                duration: opts.duration || 380,
                delay: (opts.delay || 0) + index * (opts.stagger || 0),
                ease: 'Cubic.easeOut'
            });
        });
    };
})(window.SequenceMemory = window.SequenceMemory || {});
