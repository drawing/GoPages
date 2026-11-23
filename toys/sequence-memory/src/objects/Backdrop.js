(function (ns) {
    'use strict';

    const DEPTH = ns.DEPTH;
    const PALETTE = ns.PALETTE;
    const objects = ns.objects = ns.objects || {};

    // 星点位置用固定种子的 LCG 生成，不用 Math.random：转屏 restart 会重画整块背景，
    // 随机会让星空每次都换一张脸。y 只取上半屏——下半屏是渐变发亮的地方，星点在那儿看不见。
    // 每颗另带自己的慢眨周期（2–5s）与相位，错开之后整片星空不会同步呼吸（harness/ui.md）
    function starField(count) {
        let seed = 20260115;
        function next() {
            seed = (seed * 48271) % 2147483647;
            return seed / 2147483647;
        }

        const list = [];
        for (let i = 0; i < count; i += 1) {
            list.push({
                x: next(),
                y: 0.04 + next() * 0.56,
                r: 0.7 + next() * 1.5,
                a: 0.25 + next() * 0.5,
                period: 2000 + next() * 3000,
                phase: next() * Math.PI * 2
            });
        }
        return list;
    }

    const STARS = starField(100);

    // 地平线剪影与星点同一条纪律：固定种子 + 归一化坐标，转屏 restart 不换地平线。
    // 两层楼群各自从左到右随机步进生成，楼宽与步进重叠一点，连成一片而不是几根孤柱。
    // heroX 是那座四层塔的位置（偏右，避开竖屏内容列正中）
    function skyline() {
        let seed = 20261122;
        function next() {
            seed = (seed * 48271) % 2147483647;
            return seed / 2147483647;
        }

        const far = [];
        let x = -0.02;
        while (x < 1.02) {
            const w = 0.045 + next() * 0.05;
            far.push({ x: x, w: w, h: 0.035 + next() * 0.05, cap: next() < 0.3 });
            x += w * (0.7 + next() * 0.25);
        }
        const near = [];
        x = -0.02;
        while (x < 1.02) {
            const w = 0.05 + next() * 0.06;
            near.push({
                x: x, w: w, h: 0.08 + next() * 0.12,
                step: next() < 0.35, antenna: next() < 0.18
            });
            x += w * (0.75 + next() * 0.25);
        }
        return { far: far, near: near, heroX: 0.64 + next() * 0.08 };
    }

    const SKYLINE = skyline();

    // 两层楼群 + 一座古代阁楼（harness/ui.md 远楼剪影那条）。远层浅近层深是大气透视：
    // 底部 skyGlow 发亮，楼群用夜色压上去才读得出"远处有城"。高度 = 视口高占比 + overscan 半圈，
    // 底边沉在 overscan 底——纯高度抖动时楼不悬空。窗灯只给塔身，静态不眨
    function drawSkyline(scene, view, left, top, width, height) {
        const g = scene.add.graphics().setDepth(DEPTH.backdrop);
        const baseY = top + height;
        const extra = (height - view.h) / 2;

        g.fillStyle(ns.tint(PALETTE.skyNight), 0.6);
        SKYLINE.far.forEach(function (b) {
            const bx = left + b.x * width;
            const bw = b.w * width;
            const bh = b.h * view.h + extra;
            g.fillRect(bx, baseY - bh, bw, bh);
            if (b.cap) { g.fillRect(bx + bw * 0.25, baseY - bh - bw * 0.18, bw * 0.5, bw * 0.18); }
        });

        g.fillStyle(ns.tint(PALETTE.skyTop), 0.8);
        SKYLINE.near.forEach(function (b) {
            const bx = left + b.x * width;
            const bw = b.w * width;
            const bh = b.h * view.h + extra;
            g.fillRect(bx, baseY - bh, bw, bh);
            if (b.step) { g.fillRect(bx + bw * 0.2, baseY - bh - bh * 0.28, bw * 0.55, bh * 0.28); }
            if (b.antenna) { g.fillRect(bx + bw * 0.5, baseY - bh - bh * 0.22, Math.max(1, bw * 0.03), bh * 0.22); }
        });

        // 古代阁楼：台基 + 四层（楼体 + 平座 + 飞檐）+ 攒尖宝顶（harness/ui.md 远楼剪影那条）。
        // 飞檐翘角用折线逼近——Phaser Graphics 没有贝塞尔，檐口凹曲线取四个点、两端上挑，
        // 剪影尺寸下读起来就是弯的；直线梯形檐读作通用宝塔，翘角才是古建的身份笔。
        // 塔高 0.32 × 视口高：上半截高出底部出口行，楼从按钮后面升起来
        const H = 0.32 * view.h + extra;
        const W = H * 0.36;
        const hx = left + SKYLINE.heroX * width;
        const windows = [];
        let door = null;
        let y = baseY;
        g.fillRect(hx - W * 0.65, y - H * 0.025, W * 1.3, H * 0.025);
        y -= H * 0.025;
        for (let i = 0; i < 4; i += 1) {
            const bw = W * (1 - i * 0.16);
            const bodyH = H * 0.13;
            const roofH = H * 0.075;
            g.fillRect(hx - bw / 2, y - bodyH, bw, bodyH);
            if (i === 0) {
                door = { x: hx, y: y, w: bw * 0.22, h: bodyH * 0.62 };
            } else {
                windows.push({ x: hx - bw * 0.2, y: y - bodyH * 0.5 });
                if (i < 3) { windows.push({ x: hx + bw * 0.2, y: y - bodyH * 0.5 }); }
            }
            y -= bodyH;
            // 平座：檐下一道比楼体略宽的薄横板，层与层之间阁楼的节奏
            g.fillRect(hx - bw * 0.59, y - H * 0.018, bw * 1.18, H * 0.018);
            y -= H * 0.018;
            const rw = bw * 1.55;
            const rt = bw * 0.42;
            const lift = roofH * 0.45;
            g.beginPath();
            g.moveTo(hx - rw / 2, y - lift);
            g.lineTo(hx - rw * 0.36, y - lift * 0.25);
            g.lineTo(hx - rw * 0.18, y - lift * 0.04);
            g.lineTo(hx, y);
            g.lineTo(hx + rw * 0.18, y - lift * 0.04);
            g.lineTo(hx + rw * 0.36, y - lift * 0.25);
            g.lineTo(hx + rw / 2, y - lift);
            if (i < 3) {
                g.lineTo(hx + rt / 2, y - roofH);
                g.lineTo(hx - rt / 2, y - roofH);
                y -= roofH;
            } else {
                // 顶层不收平台，直接攒尖到顶
                g.lineTo(hx, y - roofH * 1.7);
                y -= roofH * 1.7;
            }
            g.closePath();
            g.fillPath();
        }
        g.fillRect(hx - 1, y - H * 0.03, 2, H * 0.03);
        g.fillCircle(hx, y - H * 0.03, Math.max(1.5, H * 0.012));

        // 拱门与窗灯：暖白极暗点缀，静态不眨。拱门 = 矩形 + 上半圆
        g.fillStyle(ns.tint(PALETTE.windowLight), 0.2);
        g.fillRect(door.x - door.w / 2, door.y - door.h * 0.7, door.w, door.h * 0.7);
        g.fillCircle(door.x, door.y - door.h * 0.7, door.w / 2);
        const ws = Math.max(1.5, H * 0.014);
        g.fillStyle(ns.tint(PALETTE.windowLight), 0.25);
        windows.forEach(function (win) { g.fillRect(win.x - ws / 2, win.y - ws / 2, ws, ws); });

        return g;
    }

    // 偶发流星（只首页，opts.meteor；harness/ui.md）：上半屏一道暗光斜划，
    // 尾迹沿运动反方向分六段渐淡。间隔 9–16s 随机——是"偶尔一闪"不是常驻动效。
    // 画布物件随场景销毁，但重画（换档 paint）杀不掉已排定的 delayedCall：
    // fire 开头认 g.scene，物件没了整条链就停，不留游荡定时器
    function meteorLayer(scene, view, left, top, width, height) {
        const g = scene.add.graphics().setDepth(DEPTH.backdrop).setVisible(false);
        const L = Math.round(Math.min(view.w, view.h) * 0.22);
        for (let i = 0; i < 6; i += 1) {
            g.lineStyle(1.5, 0xffffff, 0.5 * (1 - i / 6));
            g.beginPath();
            g.moveTo(-L * i / 6, 0);
            g.lineTo(-L * (i + 1) / 6, 0);
            g.strokePath();
        }
        g.fillStyle(0xffffff, 0.9);
        g.fillCircle(0, 0, 1.4);

        function schedule() {
            scene.time.delayedCall(9000 + Math.random() * 7000, fire);
        }
        function fire() {
            if (!g.scene) { return; }
            const dir = Math.random() < 0.5 ? 1 : -1;
            const ang = (18 + Math.random() * 14) * Math.PI / 180;
            const x0 = left + width * (0.15 + Math.random() * 0.7);
            const y0 = top + height * (0.06 + Math.random() * 0.24);
            const dist = L * (1.6 + Math.random() * 0.8);
            g.setVisible(true).setAlpha(0);
            g.setRotation(dir > 0 ? ang : Math.PI - ang);
            scene.tweens.add({
                targets: { t: 0 }, t: 1, duration: 750 + Math.random() * 350,
                onUpdate: function (tween) {
                    const t = tween.getValue();
                    g.setPosition(x0 + dir * Math.cos(ang) * dist * t, y0 + Math.sin(ang) * dist * t);
                    g.setAlpha(0.3 * Math.sin(Math.PI * t));
                },
                onComplete: function () {
                    g.setVisible(false);
                    if (g.scene) { schedule(); }
                }
            });
        }
        scene.time.delayedCall(5000 + Math.random() * 3000, fire);
        return g;
    }

    // 夜空背景：一张竖向渐变 + 一层星点 + 一道地平线剪影（首页另加偶发流星）。
    // 返回建出来的所有对象，调用方把它们排除在入场动画之外（背景一动就会露出底色）。
    // 尺寸一律从 layout 推，并且多铺一圈：纯高度抖动（手机地址栏收放）只把画布跟上视口、
    // 不重排场景，背景要是刚好铺满旧视口，边上就会露出一条底色（harness/architecture.md）。
    // opts.starScale 压暗星点（首页传 0.8，ui.md 面板半透那条）：不传原样，其余场景不受影响。
    // opts.meteor 只首页传 true：transient 动效不进局内免得扰呈现（ui.md 远楼剪影那条）
    objects.backdrop = function (scene, view, opts) {
        const starScale = opts && opts.starScale != null ? opts.starScale : 1;
        const overscan = Math.round(Math.max(view.w, view.h) * 0.12);
        const width = view.w + overscan;
        const height = view.h + overscan;
        const left = view.cx - width / 2;
        const top = view.cy - height / 2;

        const sky = scene.add.image(view.cx, view.cy, 'sky')
            .setDisplaySize(width, height)
            .setDepth(DEPTH.backdrop);

        // 100 颗星画进同一个 Graphics：一个绘制调用。慢眨靠每帧按正弦重算 alpha 重画这一层，
        // 渐变本体不动。驱动用一条 repeat tween 而不是场景 update 钩子：调用方零接线，
        // 场景 paused 时 tween 不走、星空自动冻住，restart 时随场景销毁
        const stars = scene.add.graphics().setDepth(DEPTH.backdrop);
        function drawStars(time) {
            stars.clear();
            STARS.forEach(function (star) {
                const wave = 0.55 + 0.45 * Math.sin(time / star.period * Math.PI * 2 + star.phase);
                stars.fillStyle(0xffffff, Math.max(0.04, star.a * wave * starScale));
                stars.fillCircle(left + star.x * width, top + star.y * height, star.r);
            });
        }
        drawStars(0);
        // 减少动效（4b，harness/ui.md）：星空慢眨是常驻装饰，降级时静态画一次就停，
        // 渐变本体本来就不动。星空仍是那片星空（固定种子），只是不眨了
        if (!ns.utils.reducedMotion()) {
            scene.tweens.add({
                targets: { t: 0 }, t: 1, duration: 1000, repeat: -1,
                onUpdate: function () { drawStars(scene.time.now); }
            });
        }

        // 剪影全场景常驻（同一个世界的地平线）；静态绘制，减少动效不涉及
        const skylineG = drawSkyline(scene, view, left, top, width, height);
        const layers = [sky, stars, skylineG];
        if (opts && opts.meteor && !ns.utils.reducedMotion()) {
            layers.push(meteorLayer(scene, view, left, top, width, height));
        }
        return layers;
    };
})(window.SequenceMemory = window.SequenceMemory || {});