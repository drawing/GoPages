(function (ns) {
    'use strict';

    const utils = ns.utils = ns.utils || {};

    // 触屏检测（6e）：maxTouchPoints ∨ ontouchstart 任一命中就算触屏。
    // 触屏笔记本两个信号都有，键盘与点星并存——降级是加法不是替换。
    // 缺 API（老浏览器 / Node 假 window）一律当纯键盘：宁可少给降级，不误给提示条
    utils.touchDevice = function () {
        if (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) { return true; }
        return typeof window !== 'undefined' && 'ontouchstart' in window;
    };
})(window.ShootingStars = window.ShootingStars || {});