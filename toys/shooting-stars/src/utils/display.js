(function (ns) {
    'use strict';

    const CONFIG = ns.CONFIG;
    const utils = ns.utils = ns.utils || {};

    // FIT 只改 canvas 的 CSS 尺寸，backing store 仍是 gameSize。gameSize 停在 800×600 时，
    //  retina 上整帧要被放大 3–5 倍，12px 的汉字只有 13 行真实像素去填 40 多行设备像素，必然发糊。
    //  所以把 framebuffer 抬到设备像素量级，再用 camera zoom 把世界坐标锁回 800×600。
    const MAX_SCALE = 3;

    function neededScale() {
        const dpr = window.devicePixelRatio || 1;
        const fit = Math.min(window.innerWidth / CONFIG.WIDTH, window.innerHeight / CONFIG.HEIGHT);
        return Math.min(MAX_SCALE, Math.max(1, Math.ceil(dpr * fit)));
    }

    ns.RENDER_SCALE = neededScale();

    utils.applyRenderScale = function (scene) {
        const camera = scene.cameras.main;
        camera.setZoom(ns.RENDER_SCALE);
        // zoom 以 camera 中心为锚点，不补偿的话世界原点会被推到画面外
        camera.centerOn(CONFIG.WIDTH / 2, CONFIG.HEIGHT / 2);
        return camera;
    };

    function rescaleText(list) {
        list.forEach(function (object) {
            if (object.type === 'Text') {
                object.setResolution(ns.RENDER_SCALE);
            } else if (object.list) {
                rescaleText(object.list);
            }
        });
    }

    utils.syncRenderScale = function () {
        const next = neededScale();
        if (next === ns.RENDER_SCALE || !ns.game) { return; }

        ns.RENDER_SCALE = next;
        const scale = ns.game.scale;
        scale.setGameSize(CONFIG.WIDTH * next, CONFIG.HEIGHT * next);
        // setGameSize 内部的 refresh 会拿上一轮的 parentSize 算 CSS 尺寸，
        //  而它尾部的 getParentBounds 又把新尺寸写了回去，轮询从此认为"没变化"，画面会永远停在上一个尺寸。
        scale.getParentBounds();
        scale.refresh();
        ns.game.scene.scenes.forEach(function (scene) {
            if (!scene.sys.isActive() && !scene.sys.isPaused()) { return; }
            utils.applyRenderScale(scene);
            rescaleText(scene.children.list);
        });
    };

    // 每帧真实设备像素 / framebuffer 像素，1.00 表示文字像素级锐利
    utils.upsampleRatio = function () {
        const css = ns.game.scale.displaySize.width / CONFIG.WIDTH;
        return css * (window.devicePixelRatio || 1) / ns.RENDER_SCALE;
    };

    // 窗口拖到另一块 DPR 不同的屏幕时，CSS 尺寸不变，Phaser 的 RESIZE 不会触发，
    //  matchMedia 的 resolution 事件在各家实现也不齐，所以每帧比一次数值，代价只有一次浮点比较。
    let lastPixelRatio = window.devicePixelRatio || 1;

    utils.checkPixelRatio = function () {
        const ratio = window.devicePixelRatio || 1;
        if (ratio === lastPixelRatio) { return; }
        lastPixelRatio = ratio;
        utils.syncRenderScale();
    };
})(window.ShootingStars = window.ShootingStars || {});