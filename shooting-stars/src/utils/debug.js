(function (ns) {
    'use strict';

    const utils = ns.utils = ns.utils || {};

    // 开发读数开关（7）：?debug=1 才显示帧率 / 池统计 / 判定等读数与参考线标签。
    // 浏览器边界检测同 touchDevice 一类：缺 location（老浏览器 / Node 假 window）一律当关。
    // 只认精确的 debug=1——debug=0 / debug=10 / xdebug=1 都不算
    utils.debugMode = function () {
        if (typeof window === 'undefined' || !window.location) { return false; }
        return /(?:^|[?&])debug=1(?:&|$)/.test(window.location.search || '');
    };
})(window.ShootingStars = window.ShootingStars || {});