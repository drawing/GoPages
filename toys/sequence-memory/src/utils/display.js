(function (ns) {
    'use strict';

    const CONFIG = ns.CONFIG;
    const utils = ns.utils = ns.utils || {};

    // 超采样倍数 S：backing store = CSS 尺寸 × S，camera zoom S，于是布局空间恒等于 CSS 像素（harness/architecture.md）。
    // 与 shooting-stars 的差别是这里没有固定设计尺寸，S 只跟 devicePixelRatio 走，不按 FIT 的缩放比补偿
    function neededScale() {
        const dpr = window.devicePixelRatio || 1;
        return Math.min(CONFIG.RENDER_SCALE_MAX, Math.max(1, Math.ceil(dpr)));
    }

    ns.RENDER_SCALE = neededScale();

    // 视口的 CSS 尺寸是布局的唯一来源。parentSize 只在 refresh 时更新，所以先让引擎量一次；
    // boot 早期还没量到（parentSize 是 0）时退回 window 尺寸
    function measure(scale) {
        scale.getParentBounds();
        const parent = scale.parentSize;
        const w = parent.width > 0 ? parent.width : window.innerWidth;
        const h = parent.height > 0 ? parent.height : window.innerHeight;
        return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
    }

    // camera 的尺寸跟 backing store（设备像素），zoom 把世界缩回 CSS 像素。
    // ScaleManager 从场景拿（scene.sys.game.scale）而不是从 ns.game 拿：场景 create() 有可能
    // 跑在 ns.game 赋值之前。不用 camera.centerOn：它按 midPoint 算 scroll，而 midPoint 要等
    // 下一帧 preRender 才更新，转屏后第一次 create 会拿到旧尺寸算出的中心，把画面推出视口
    function fitCamera(scene) {
        const camera = scene.cameras.main;
        const css = measure(scene.sys.game.scale);
        const scale = ns.RENDER_SCALE;
        camera.setSize(css.w * scale, css.h * scale);
        camera.setZoom(scale);
        camera.scrollX = css.w / 2 - camera.width / 2;
        camera.scrollY = css.h / 2 - camera.height / 2;
        return camera;
    }

    // 每个场景 create() 首行必须调它，与 shooting-stars 那条硬约束同源
    utils.applyRenderScale = function (scene) {
        return fitCamera(scene);
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

    // 画布跟视口：baseSize = CSS × S，ScaleManager 的 zoom = 1/S 把 CSS 尺寸推回视口大小，
    // 于是 canvas 的 backing store 是设备像素、CSS 尺寸是视口尺寸，displayScale 正好是 S（指针坐标也跟着对）。
    // 这里刻意不用 Phaser.Scale.RESIZE：RESIZE 模式下 updateScale 会把 canvas.width 钉成 CSS 像素，
    // 超采样根本挂不上去，retina 上 12px 的汉字必然发糊
    function applyGameSize(css) {
        const scale = ns.game.scale;
        const next = neededScale();
        if (next !== ns.RENDER_SCALE) {
            ns.RENDER_SCALE = next;
            scale.setZoom(1 / next);
        }
        scale.resize(css.w * next, css.h * next);
    }

    // 只在方向真的翻了、或宽高比 / 尺寸跨过阈值时才重排场景（harness/architecture.md、harness/requirements.md #16）。
    // 手机地址栏收放只改高度：390×844 → 390×914 是 8% 的高度差、0.035 的宽高比差，两个阈值都拦得住，
    // 画布照常跟着视口变（不溢出、不留黑边），但场景不 restart，玩家一滚动页面画面不会闪。
    // 第一次调用（引擎刚 READY）只对齐尺寸不重排：那时场景本来就是刚 create 出来的
    function needsRebuild(before, next) {
        if (!before) { return false; }
        if ((before.h >= before.w) !== (next.h >= next.w)) { return true; }
        if (Math.abs(next.h / next.w - before.h / before.w) > CONFIG.RESTART_ASPECT_EPSILON) { return true; }
        return Math.abs(next.w - before.w) / before.w > CONFIG.RESTART_SIZE_EPSILON ||
            Math.abs(next.h - before.h) / before.h > CONFIG.RESTART_SIZE_EPSILON;
    }

    let last = null;

    // 局内状态在 systems/session.js 而不在场景里，所以 restart 等于免费重排而不是丢局（harness/architecture.md）。
    // data 要显式带上：restart 不传参就把 init 的 data 冲成 undefined
    utils.relayout = function () {
        const css = measure(ns.game.scale);
        const next = neededScale();
        // 自己调 scale.resize 也会发 RESIZE，尺寸没变就得在这里断掉，否则每 140ms 空转一轮
        if (last && last.w === css.w && last.h === css.h && next === ns.RENDER_SCALE) { return; }

        const rebuild = needsRebuild(last, css);
        last = css;
        applyGameSize(css);

        ns.game.scene.scenes.forEach(function (scene) {
            if (!scene.sys.isActive() && !scene.sys.isPaused()) { return; }
            if (rebuild) {
                scene.scene.restart(scene.sys.settings.data);
            } else {
                fitCamera(scene);
                rescaleText(scene.children.list);
            }
        });
    };

    let timer = null;

    // debounce 是必须的：桌面拖窗口每帧都在发 resize，手机地址栏收放也是高频触发
    function schedule() {
        if (timer !== null) { window.clearTimeout(timer); }
        timer = window.setTimeout(function () {
            timer = null;
            utils.relayout();
        }, CONFIG.RESIZE_DEBOUNCE_MS);
    }

    // 窗口拖到另一块 DPR 不同的屏幕时 CSS 尺寸不变、RESIZE 不触发，
    // matchMedia 的 resolution 事件各家实现也不齐，所以每帧比一次数值，代价只有一次浮点比较
    let lastPixelRatio = window.devicePixelRatio || 1;

    utils.checkPixelRatio = function () {
        const ratio = window.devicePixelRatio || 1;
        if (ratio === lastPixelRatio) { return; }
        lastPixelRatio = ratio;
        schedule();
    };

    utils.watchViewport = function () {
        ns.game.scale.on(Phaser.Scale.Events.RESIZE, schedule);
        ns.game.events.on(Phaser.Core.Events.POST_STEP, utils.checkPixelRatio);
        window.addEventListener('resize', schedule);
        window.addEventListener('orientationchange', schedule);
    };
})(window.SequenceMemory = window.SequenceMemory || {});
