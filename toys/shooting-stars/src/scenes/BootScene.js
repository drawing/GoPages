(function (ns) {
    'use strict';

    const CONFIG = ns.CONFIG;
    const PALETTE = ns.PALETTE;
    const DEPTH = ns.DEPTH;
    const SCENES = ns.SCENES;
    const utils = ns.utils;

    function canvas(scene, key, width, height) {
        if (scene.textures.exists(key)) { scene.textures.remove(key); }
        return scene.textures.createCanvas(key, width, height);
    }

    function rgba(hex, alpha) {
        const int = ns.tint(hex);
        return 'rgba(' + ((int >> 16) & 255) + ',' + ((int >> 8) & 255) + ',' + (int & 255) + ',' + alpha + ')';
    }

    function towards(from, to, distance) {
        const dx = to[0] - from[0];
        const dy = to[1] - from[1];
        const length = Math.hypot(dx, dy) || 1;
        const d = Math.min(distance, length / 2);
        return [from[0] + dx / length * d, from[1] + dy / length * d];
    }

    function starPath(ctx, cx, cy, outer, inner, points, corner) {
        const vertices = [];
        const step = Math.PI / points;
        for (let i = 0; i < points * 2; i++) {
            const radius = i % 2 === 0 ? outer : inner;
            const angle = -Math.PI / 2 + i * step;
            vertices.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]);
        }
        ctx.beginPath();
        for (let i = 0; i < vertices.length; i++) {
            const current = vertices[i];
            const start = towards(current, vertices[(i - 1 + vertices.length) % vertices.length], corner);
            const end = towards(current, vertices[(i + 1) % vertices.length], corner);
            if (i === 0) { ctx.moveTo(start[0], start[1]); } else { ctx.lineTo(start[0], start[1]); }
            ctx.quadraticCurveTo(current[0], current[1], end[0], end[1]);
        }
        ctx.closePath();
    }

    // 5c 的六角冰晶轮廓：正六边形，顶点朝上，圆角同五角星那条（尖角在 zoom 下最先糊）。
    // 边数与"直边不内凹"两样都与五角星不同，剪影一眼分得开——色觉友好靠的就是这个（harness/ui.md）
    function hexPath(ctx, cx, cy, radius, corner) {
        const vertices = [];
        for (let i = 0; i < 6; i++) {
            const angle = -Math.PI / 2 + i * Math.PI / 3;
            vertices.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]);
        }
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const current = vertices[i];
            const start = towards(current, vertices[(i + 5) % 6], corner);
            const end = towards(current, vertices[(i + 1) % 6], corner);
            if (i === 0) { ctx.moveTo(start[0], start[1]); } else { ctx.lineTo(start[0], start[1]); }
            ctx.quadraticCurveTo(current[0], current[1], end[0], end[1]);
        }
        ctx.closePath();
    }

    function roundedPath(ctx, x, y, width, height, radius) {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.arcTo(x + width, y, x + width, y + height, radius);
        ctx.arcTo(x + width, y + height, x, y + height, radius);
        ctx.arcTo(x, y + height, x, y, radius);
        ctx.arcTo(x, y, x + width, y, radius);
        ctx.closePath();
    }

    function bakeProgressBar(scene) {
        const texture = canvas(scene, 'progressBar', 320, 6);
        const ctx = texture.context;
        const gradient = ctx.createLinearGradient(0, 0, 320, 0);
        gradient.addColorStop(0, PALETTE.info);
        gradient.addColorStop(0.55, PALETTE.gold);
        gradient.addColorStop(1, PALETTE.skyEmber);
        roundedPath(ctx, 0, 0, 320, 6, 3);
        ctx.fillStyle = gradient;
        ctx.fill();
        texture.refresh();
    }

    // 星体参数按 72px 写（harness/ui.md），超采样时整体等比放大（圆角半径也要跟着放，否则角会变尖）
    function paintStar(ctx, size, shaded) {
        const center = size / 2;
        const k = size / CONFIG.STAR_SIZE;

        // 外发光：轮廓向外扩 6px，tint 后就是同色光晕
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        starPath(ctx, center, center, 32 * k, 17 * k, 5, 5 * k);
        ctx.fill();

        // shaded 版主体填灰阶径向渐变：setTint 逐像素相乘，内圈被压暗一档、外圈拿到全量色，
        // 再由上层那张不 tint 的 starCore 盖成接近纯白——"外圈饱和 + 内核渐白"是这两层配合出来的，
        // 单层做不到（白像素乘 tint 只会得到 tint 本身）。只有下落的星星能这么烤：
        // 生命图标那些小星没有白芯，压暗会在中心留一块暗斑
        if (shaded) {
            const body = ctx.createRadialGradient(center, center, 0, center, center, 26 * k);
            body.addColorStop(0, 'rgba(140,140,140,1)');
            body.addColorStop(0.5, 'rgba(190,190,190,1)');
            body.addColorStop(1, '#ffffff');
            ctx.fillStyle = body;
        } else {
            ctx.fillStyle = '#ffffff';
        }
        starPath(ctx, center, center, 26 * k, 13 * k, 5, 4 * k);
        ctx.fill();
    }

    function bakeStar(scene) {
        const size = CONFIG.STAR_SIZE;
        let texture = canvas(scene, 'star', size, size);
        paintStar(texture.context, size, false);
        texture.refresh();

        // starHi 只给下落的星星（Star.js 里 setDisplaySize 缩回 72）；
        // 生命图标与教学示意都是缩小显示，继续用 star，不会被重采样
        const hi = size * CONFIG.STAR_SUPERSAMPLE;
        texture = canvas(scene, 'starHi', hi, hi);
        paintStar(texture.context, hi, true);
        texture.refresh();
    }

    function bakeCore(scene) {
        const texture = canvas(scene, 'starCore', 32, 32);
        const ctx = texture.context;
        const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
        gradient.addColorStop(0, 'rgba(255,255,255,1)');
        gradient.addColorStop(0.66, 'rgba(255,255,255,1)');
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 32, 32);
        texture.refresh();
    }

    // 四芒高光（5a 的金色星，harness/ui.md）：横竖各一条 2px 白光，两端渐隐才像"光芒"而不是一个加号。
    // 没烤进 starHi 里：烤进主体就等于每颗星都有芒，"普通星可选"与"一眼能分"
    // 同时失效。与 starHi 同倍数超采样、显示时同样缩回 72，2px 的硬边在 zoom 下才不发虚
    function bakeGlint(scene) {
        const size = CONFIG.STAR_SIZE * CONFIG.STAR_SUPERSAMPLE;
        const texture = canvas(scene, 'starGlint', size, size);
        const ctx = texture.context;
        const k = size / CONFIG.STAR_SIZE;
        const arm = CONFIG.STAR_GLINT_ARM * k;
        const half = CONFIG.STAR_GLINT_WIDTH * k / 2;
        const center = size / 2;
        glintBar(ctx, center, arm, half, true);
        glintBar(ctx, center, arm, half, false);
        texture.refresh();
    }

    function glintBar(ctx, center, arm, half, horizontal) {
        const gradient = horizontal
            ? ctx.createLinearGradient(center - arm, 0, center + arm, 0)
            : ctx.createLinearGradient(0, center - arm, 0, center + arm);
        gradient.addColorStop(0, 'rgba(255,255,255,0)');
        gradient.addColorStop(0.5, 'rgba(255,255,255,' + CONFIG.STAR_GLINT_ALPHA + ')');
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gradient;
        if (horizontal) {
            ctx.fillRect(center - arm, center - half, arm * 2, half * 2);
        } else {
            ctx.fillRect(center - half, center - arm, half * 2, arm * 2);
        }
    }

    // 5b 的黑洞：紫橘吸积盘 + 两条旋臂 + 深色核心。颜色烤死在纹理里、显示时不 tint——
    // 深色核心乘 tint 只会更黑，紫橘渐变是它的身份色而不是星色。与 starHi 同倍数超采样、
    // 显示缩回 72：旋臂是 2px 级的硬边，zoom 下最先糊。旋臂 + 环的形状是"不能碰"的辨识依据，
    // 色觉障碍下靠它而不是紫橘两色（harness/gameplay.md）
    function bakeVoid(scene) {
        const size = CONFIG.STAR_SIZE * CONFIG.STAR_SUPERSAMPLE;
        const texture = canvas(scene, 'voidStar', size, size);
        const ctx = texture.context;
        const k = size / CONFIG.STAR_SIZE;
        const center = size / 2;

        // 吸积盘：内紫外橘的径向渐变环，两端收到透明
        const disk = ctx.createRadialGradient(center, center, 15 * k, center, center, 35 * k);
        disk.addColorStop(0, rgba(PALETTE.voidDiskIn, 0));
        disk.addColorStop(0.25, rgba(PALETTE.voidDiskIn, 0.85));
        disk.addColorStop(0.6, rgba(PALETTE.voidDiskOut, 0.9));
        disk.addColorStop(0.85, rgba(PALETTE.voidDiskOut, 0.35));
        disk.addColorStop(1, rgba(PALETTE.voidDiskOut, 0));
        ctx.fillStyle = disk;
        ctx.fillRect(0, 0, size, size);

        // 两条旋臂：从核心边缘向外旋开的螺线，白色半透明，是"漩涡"形状的来源
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 2 * k;
        ctx.lineCap = 'round';
        for (let arm = 0; arm < 2; arm++) {
            ctx.beginPath();
            for (let i = 0; i <= 40; i++) {
                const t = i / 40;
                const angle = arm * Math.PI + t * 2.4;
                const radius = (19 + 14 * t) * k;
                const x = center + Math.cos(angle) * radius;
                const y = center + Math.sin(angle) * radius;
                if (i === 0) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
            }
            ctx.stroke();
        }

        // 深色核心盖在盘中央，边界一圈细亮环（光子环）——黑洞的标志性轮廓
        ctx.fillStyle = PALETTE.voidCore;
        ctx.beginPath();
        ctx.arc(center, center, 17 * k, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 1.2 * k;
        ctx.beginPath();
        ctx.arc(center, center, 17 * k, 0, Math.PI * 2);
        ctx.stroke();
        texture.refresh();
    }

    // 5c 的六角冰晶（主体 #bee3f8 + 描边 #63b3ed，harness/ui.md）。与 starHi 同倍数超采样、
    // 显示缩回 72：描边是 2px 级的硬边，zoom 下最先糊。
    // 主体仍烤灰阶径向渐变、显示时 tint：外圈拿到全量冰蓝，内核由上层白芯盖成接近纯白，
    // 与五角星是同一套两层配合（白像素乘 tint 只会得到 tint 本身，单层做不到）。
    // 蓝描边烤死在纹理里：Canvas 渲染器忽略 setTint，冰晶在 fallback 下
    // 退化成白色六角形，这圈蓝边与"六角"这个剪影是那时还分得出类型的东西（同金色星的四芒）
    function bakeIce(scene) {
        const size = CONFIG.STAR_SIZE * CONFIG.STAR_SUPERSAMPLE;
        const texture = canvas(scene, 'iceStar', size, size);
        const ctx = texture.context;
        const k = size / CONFIG.STAR_SIZE;
        const center = size / 2;

        // 外发光：轮廓向外扩 6px，tint 后就是同色光晕（同 paintStar）
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        hexPath(ctx, center, center, 32 * k, 5 * k);
        ctx.fill();

        const body = ctx.createRadialGradient(center, center, 0, center, center, 26 * k);
        body.addColorStop(0, 'rgba(150,150,150,1)');
        body.addColorStop(0.55, 'rgba(198,198,198,1)');
        body.addColorStop(1, '#ffffff');
        ctx.fillStyle = body;
        hexPath(ctx, center, center, 26 * k, 3 * k);
        ctx.fill();

        // 描边走同一条路径：WebGL 下它跟着 tint 相乘（#63b3ed × #bee3f8）成为更深一档的蓝，
        // 正是设计里"主体浅蓝 + 描边蓝"那个对比（harness/ui.md）
        ctx.strokeStyle = PALETTE.iceEdge;
        ctx.lineWidth = 2.5 * k;
        ctx.stroke();

        // 六条棱面短线只画在外圈那一段（16k → 24k，顶点在 26k）：中心留给字母。
        // 满幅辐条会从字母底下穿过去，读起来是"字被划花了"
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 1.6 * k;
        ctx.lineCap = 'round';
        for (let i = 0; i < 6; i++) {
            const angle = -Math.PI / 2 + i * Math.PI / 3;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            ctx.beginPath();
            ctx.moveTo(center + cos * 16 * k, center + sin * 16 * k);
            ctx.lineTo(center + cos * 24 * k, center + sin * 24 * k);
            ctx.stroke();
        }
        texture.refresh();
    }

    function bakeGlow(scene) {
        const texture = canvas(scene, 'glow', 128, 128);
        const ctx = texture.context;
        const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
        gradient.addColorStop(0, 'rgba(255,255,255,0.55)');
        gradient.addColorStop(0.35, 'rgba(255,255,255,0.22)');
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 128, 128);
        texture.refresh();
    }

    function bakeSpark(scene) {
        const texture = canvas(scene, 'spark', 48, 48);
        const ctx = texture.context;
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        starPath(ctx, 24, 24, 23, 4, 4, 2);
        ctx.fill();
        texture.refresh();
    }

    // 重复字母的"最低那颗"描边圈：白色不 tint，Canvas 渲染器下也看得见。
    // 9e 烤到 128 / 圈半径 48：单元方案的星体是 96，圈的世界半径要跟着长到 48（= 星体尺寸的一半，
    // 与 72 星体的 36 同一条规则）才留得出同比例净空，而它是 2.5px 硬边、最经不起放大。
    // 于是常规星体显示 scale 0.75——从 9d 的"放大到 1.06"变成纯缩，比原先更锐（harness/ui.md）
    function bakeRing(scene) {
        const size = CONFIG.RING_BAKE;
        const texture = canvas(scene, 'ring', size, size);
        const ctx = texture.context;
        // 线宽与阴影按 96 基准同比放大，显示时缩回去，世界坐标下仍是 2.5px / blur 7
        const k = size / (CONFIG.RING_RADIUS * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.lineWidth = 2.5 * k;
        ctx.shadowColor = 'rgba(255,255,255,0.7)';
        ctx.shadowBlur = 7 * k;
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, CONFIG.RING_RADIUS, 0, Math.PI * 2);
        ctx.stroke();
        texture.refresh();
    }

    // 冲击波白环（harness/ui.md）：一条软的白色亮带，tint 后就是星色光环。源 256px 显示基准 96px，
    // 放大到 2.4× 仍在源尺寸内；软渐变没有硬边，不需要 starHi 那样的 3× 超采样
    function bakeShock(scene) {
        const size = CONFIG.FX_SHOCK_SIZE;
        const texture = canvas(scene, 'shock', size, size);
        const ctx = texture.context;
        const center = size / 2;
        const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
        gradient.addColorStop(0, 'rgba(255,255,255,0)');
        gradient.addColorStop(0.62, 'rgba(255,255,255,0)');
        gradient.addColorStop(0.8, 'rgba(255,255,255,0.5)');
        gradient.addColorStop(0.9, 'rgba(255,255,255,1)');
        gradient.addColorStop(0.97, 'rgba(255,255,255,0.32)');
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, size, size);
        texture.refresh();
    }

    // 5a 的金色星光柱：一道向上渐隐的软光带，底端（命中点）最亮。横向两端用 destination-in
    // 擦成柔边（与 decorTail 同一套做法）。源 64×256、显示 40×220，动画里 scale 最大只到 1
    function bakePillar(scene) {
        const width = CONFIG.FX_PILLAR_SOURCE_W;
        const height = CONFIG.FX_PILLAR_SOURCE_H;
        const texture = canvas(scene, 'pillar', width, height);
        const ctx = texture.context;
        const gradient = ctx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, rgba(PALETTE.starlight, 0));
        gradient.addColorStop(0.3, rgba(PALETTE.starlight, 0.3));
        gradient.addColorStop(1, rgba(PALETTE.starlight, 1));
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
        const soft = ctx.createLinearGradient(0, 0, width, 0);
        soft.addColorStop(0, 'rgba(0,0,0,0)');
        soft.addColorStop(0.5, 'rgba(0,0,0,1)');
        soft.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalCompositeOperation = 'destination-in';
        ctx.fillStyle = soft;
        ctx.fillRect(0, 0, width, height);
        ctx.globalCompositeOperation = 'source-over';
        texture.refresh();
    }

    function bakeSky(scene) {
        const texture = canvas(scene, 'sky', 8, CONFIG.HEIGHT);
        const ctx = texture.context;
        const gradient = ctx.createLinearGradient(0, 0, 0, CONFIG.HEIGHT);
        gradient.addColorStop(0, PALETTE.skyTop);
        gradient.addColorStop(0.42, PALETTE.skyNight);
        gradient.addColorStop(0.72, PALETTE.skyDusk);
        gradient.addColorStop(1, PALETTE.skyEmber);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 8, CONFIG.HEIGHT);
        texture.refresh();
    }

    // 连击越浓，中段天空越紫。独立一层紫幕而不是给 sky 加 tint：
    // tint 是逐像素相乘，只会把天空压暗，且 Canvas 渲染器直接忽略它
    function bakeDusk(scene) {
        const texture = canvas(scene, 'dusk', 8, CONFIG.HEIGHT);
        const ctx = texture.context;
        const gradient = ctx.createLinearGradient(0, 0, 0, CONFIG.HEIGHT);
        gradient.addColorStop(0, rgba(PALETTE.duskVeil, 0));
        gradient.addColorStop(0.34, rgba(PALETTE.duskVeil, 0.55));
        gradient.addColorStop(0.72, rgba(PALETTE.skyDusk, 0.42));
        gradient.addColorStop(1, rgba(PALETTE.skyEmber, 0));
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 8, CONFIG.HEIGHT);
        texture.refresh();
    }

    // 装饰流星的尾迹：一条向上渐隐的软光带，头端宽、尾端尖。
    // 源烤到显示长度的 2×，软渐变没有硬边，不像星体那样需要 3× 超采样
    function bakeDecorTail(scene) {
        const width = 32;
        const height = CONFIG.DECOR_TAIL * 2;
        const texture = canvas(scene, 'decorTail', width, height);
        const ctx = texture.context;
        const cx = width / 2;
        const gradient = ctx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, rgba(PALETTE.starlight, 0));
        gradient.addColorStop(0.55, rgba(PALETTE.starlight, 0.3));
        gradient.addColorStop(1, rgba(PALETTE.starlight, 0.9));
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.moveTo(cx - 1, 0);
        ctx.lineTo(cx + 1, 0);
        ctx.lineTo(width, height);
        ctx.lineTo(0, height);
        ctx.closePath();
        ctx.fill();
        // 横向柔边：destination-in 拿一条中间实、两侧透的渐变把三角的硬边擦掉
        const soft = ctx.createLinearGradient(0, 0, width, 0);
        soft.addColorStop(0, 'rgba(0,0,0,0)');
        soft.addColorStop(0.5, 'rgba(0,0,0,1)');
        soft.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalCompositeOperation = 'destination-in';
        ctx.fillStyle = soft;
        ctx.fillRect(0, 0, width, height);
        ctx.globalCompositeOperation = 'source-over';
        texture.refresh();
    }

    // 顶条（harness/ui.md）：竖向渐变 + 下沿一段软裙边。文字所在的那 52px 接近实心（1a 实测整条半透明
    // 会让下落的星透上来糊住 SCORE 与生命图标），透明度全留给裙边，星星从条下沿滑出去而不是被硬切。
    // 竖向渐变横向拉满 800px 不损失任何细节，与 sky / horizonGlow 同一套 8px 宽的做法
    function bakeHudBar(scene) {
        const height = CONFIG.HUD_BAR_HEIGHT + CONFIG.HUD_BAR_SKIRT;
        const texture = canvas(scene, 'hudBar', 8, height);
        const ctx = texture.context;
        const edge = CONFIG.HUD_BAR_HEIGHT / height;
        const gradient = ctx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, rgba(PALETTE.surface, 0.98));
        gradient.addColorStop(0.42, rgba(PALETTE.hudBar, 0.97));
        gradient.addColorStop(edge * 0.86, rgba(PALETTE.hudBar, 0.95));
        gradient.addColorStop(edge, rgba(PALETTE.overlay, 0.62));
        gradient.addColorStop(1, rgba(PALETTE.overlay, 0));
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 8, height);
        texture.refresh();
    }

    function bakeDot(scene) {
        const texture = canvas(scene, 'dot', 16, 16);
        const ctx = texture.context;
        const gradient = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
        gradient.addColorStop(0, 'rgba(255,255,255,1)');
        gradient.addColorStop(0.28, 'rgba(255,255,255,0.85)');
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 16, 16);
        texture.refresh();
    }

    function bakeHorizonGlow(scene) {
        const texture = canvas(scene, 'horizonGlow', 8, 64);
        const ctx = texture.context;
        const gradient = ctx.createLinearGradient(0, 0, 0, 64);
        gradient.addColorStop(0, 'rgba(246,173,85,0)');
        gradient.addColorStop(0.6, 'rgba(246,173,85,0.22)');
        gradient.addColorStop(1, 'rgba(246,173,85,0.62)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 8, 64);
        texture.refresh();
    }

    class BootScene extends Phaser.Scene {
        constructor() {
            super(SCENES.BOOT);
        }

        create() {
            ns.hideSplash();
            utils.applyRenderScale(this);
            utils.fadeIn(this);

            this.taskIndex = 0;
            this.progress = 0;
            this.target = 0;
            this.finished = false;
            this.startedAt = this.game.loop.time;

            this.tasks = [
                { label: '锻造星体', run: function () { bakeStar(this); bakeCore(this); bakeGlint(this); bakeVoid(this); bakeIce(this); bakeGlow(this); bakeSpark(this); bakeRing(this); bakeShock(this); bakePillar(this); } },
                { label: '渲染黄昏天空', run: function () { bakeSky(this); bakeDusk(this); } },
                { label: '播撒星点', run: function () { bakeDot(this); } },
                { label: '升起地平线', run: function () { bakeHorizonGlow(this); } },
                { label: '点亮仪表顶栏', run: function () { bakeHudBar(this); } },
                { label: '牵引装饰流星', run: function () { bakeDecorTail(this); } },
                { label: '铺开夜空', run: function () { this.backdrop = new ns.objects.Backdrop(this, { horizon: true }).fadeIn(520); } }
            ];

            this.runTask();
            this.buildInterface();

            this.taskTimer = this.time.addEvent({
                delay: CONFIG.BOOT_STEP_MS,
                loop: true,
                callback: function () {
                    if (this.taskIndex < this.tasks.length) {
                        this.runTask();
                    } else {
                        this.taskTimer.remove();
                    }
                },
                callbackScope: this
            });
        }

        runTask() {
            const task = this.tasks[this.taskIndex];
            task.run.call(this);
            this.taskIndex++;
            this.target = this.taskIndex / this.tasks.length;
            this.finished = this.taskIndex >= this.tasks.length;
            if (this.status) {
                this.status.setText(this.finished ? '准备就绪' : this.tasks[this.taskIndex].label);
            }
        }

        buildInterface() {
            const cx = CONFIG.WIDTH / 2;

            this.logo = this.add.container(cx, 208).setDepth(DEPTH.hud);
            this.logoGlow = this.add.image(0, 0, 'glow').setTint(ns.tint(PALETTE.gold)).setScale(2.6).setAlpha(0.45);
            this.logoStar = this.add.image(0, 0, 'star').setTint(ns.tint(PALETTE.gold)).setScale(1.25);
            this.logoCore = this.add.image(0, 0, 'starCore');
            this.logoSpark = this.add.image(0, 0, 'spark').setAlpha(0.4).setScale(1.15);
            this.logo.add([this.logoGlow, this.logoStar, this.logoCore, this.logoSpark]);

            this.tweens.add({
                targets: this.logo,
                scaleX: 1.06,
                scaleY: 1.06,
                duration: 1700,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut'
            });

            this.title = utils.ui.text(this, cx, 316, '流星打字', {
                fontSize: '34px',
                fontStyle: '600',
                letterSpacing: 10,
                shadow: { offsetX: 0, offsetY: 3, color: PALETTE.skyTop, blur: 14, fill: true }
            }).setDepth(DEPTH.hud);

            this.status = utils.ui.text(this, cx, 358, this.tasks[this.taskIndex].label, {
                fontSize: '13px',
                color: PALETTE.hudMuted,
                letterSpacing: 3
            }).setDepth(DEPTH.hud);

            this.barTrack = this.add.graphics().setDepth(DEPTH.hud);
            this.barTrack.fillStyle(ns.tint(PALETTE.hudBar), 0.75);
            this.barTrack.fillRoundedRect(cx - 160, 400, 320, 6, 3);
            this.barTrack.lineStyle(1, ns.tint(PALETTE.surfaceEdge), 0.7);
            this.barTrack.strokeRoundedRect(cx - 160, 400, 320, 6, 3);

            bakeProgressBar(this);
            this.barFill = this.add.image(cx - 160, 400, 'progressBar')
                .setOrigin(0, 0)
                .setDepth(DEPTH.hud)
                .setCrop(0, 0, 0, 6);

            this.percent = utils.ui.text(this, cx, 428, '0%', {
                fontSize: '12px',
                fontFamily: CONFIG.MONO,
                color: PALETTE.hudMuted,
                letterSpacing: 2
            }).setDepth(DEPTH.hud);

            utils.ui.text(this, cx, 500, '纹理与音效全部程序化生成 · 零图片资源', {
                fontSize: '12px',
                color: PALETTE.hudMuted
            }).setDepth(DEPTH.hud).setAlpha(0.55);
        }

        update(time, delta) {
            const dt = Math.min(delta, CONFIG.DELTA_MAX) / 1000;
            // 背景是最后一步才铺的，前几步还没有
            if (this.backdrop) { this.backdrop.update(dt); }
            this.logo.rotation += dt * 0.45;
            this.logoSpark.rotation -= dt * 1.1;

            this.progress += (this.target - this.progress) * Math.min(1, dt * 7);
            this.barFill.setCrop(0, 0, 320 * this.progress, 6);
            this.percent.setText(Math.round(this.progress * 100) + '%');

            if (this.finished && this.progress > 0.995 && this.game.loop.time - this.startedAt >= CONFIG.BOOT_MIN_MS) {
                utils.fadeTo(this, SCENES.MENU);
            }
        }
    }

    ns.scenes = ns.scenes || {};
    ns.scenes.BootScene = BootScene;
})(window.ShootingStars = window.ShootingStars || {});