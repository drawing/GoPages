(function (ns) {
    'use strict';

    const CONFIG = ns.CONFIG;
    const utils = ns.utils = ns.utils || {};

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    // 场景里禁止写死像素常量（harness/architecture.md）：位置与尺寸一律从这个结构推导。
    // w / h 是 CSS 像素，也就是 camera zoom 之后的世界空间；竖屏与横屏拿到的是同一套字段，
    // 排布差异由场景自己按 isPortrait 决定（横屏不是缩小版，是另一种排布）
    utils.layout = function (scene) {
        const camera = scene.cameras.main;
        const w = Math.round(camera.width / ns.RENDER_SCALE);
        const h = Math.round(camera.height / ns.RENDER_SCALE);
        const short = Math.min(w, h);

        return {
            w: w,
            h: h,
            cx: w / 2,
            cy: h / 2,
            gutter: Math.round(clamp(short * CONFIG.GUTTER.ratio, CONFIG.GUTTER.min, CONFIG.GUTTER.max)),
            unit: Math.round(clamp(short / CONFIG.UNIT.divisor, CONFIG.UNIT.min, CONFIG.UNIT.max)),
            isPortrait: h >= w
        };
    };

    // 内容区宽度：竖屏吃满留白之后的宽度，横屏与桌面窗口收到一个可读的行宽上限
    utils.contentWidth = function (view, max) {
        return Math.min(view.w - view.gutter * 2, max || 560);
    };
})(window.SequenceMemory = window.SequenceMemory || {});
