(function (ns) {
    'use strict';

    const CONFIG = ns.CONFIG;
    const PALETTE = ns.PALETTE;
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

    // 夜空竖向渐变。源只有 8px 宽：渐变的信息全在纵向上，横向拉伸不丢细节。
    // 视口高度是变的（harness/architecture.md 没有固定设计尺寸），所以靠 setDisplaySize 拉伸，不烤多份
    function bakeSky(scene) {
        const texture = canvas(scene, 'sky', 8, 512);
        const ctx = texture.context;
        const gradient = ctx.createLinearGradient(0, 0, 0, 512);
        gradient.addColorStop(0, PALETTE.skyTop);
        gradient.addColorStop(0.46, PALETTE.skyNight);
        gradient.addColorStop(0.78, PALETTE.skyDusk);
        // 底部紫光收过一档（0.4→0.3，ui.md 面板半透那条）：它是氛围不是主角，
        // 太亮时菜单物件像浮在一团紫雾上而不是坐在夜空上
        gradient.addColorStop(1, rgba(PALETTE.skyGlow, 0.3));
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 8, 512);
        texture.refresh();
    }

    // 局内顶条（harness/ui.md 材质那条）：与 sky 同一条做法——源只有 8px 宽，渐变的信息全在纵向上，
    // 横向拉伸不丢细节。它要被拉到 214–297 CSS px 高（× 最高 3 倍超采样），512 的源在最紧那一档
    // 是放大 1.7 倍——平滑渐变放大只是行重复，不像硬边那样发虚（sky 是 512 拉到整个视口高，5 倍）。
    // 底缘 CONFIG.HUD_BAR_SKIRT 那一段渐隐到 α0：读数浮在一层仪表玻璃上，硬底边会把它读成贴上去的挡板
    function bakeHudBar(scene) {
        const texture = canvas(scene, 'hudBar', 8, 512);
        const ctx = texture.context;
        const skirt = CONFIG.HUD_BAR_SKIRT;
        const gradient = ctx.createLinearGradient(0, 0, 0, 512);
        gradient.addColorStop(0, rgba(PALETTE.overlay, 0.94));
        gradient.addColorStop(0.4, rgba(PALETTE.overlay, 0.86));
        gradient.addColorStop(1 - skirt, rgba(PALETTE.overlay, 0.55));
        gradient.addColorStop(1 - skirt * 0.4, rgba(PALETTE.overlay, 0.18));
        gradient.addColorStop(1, rgba(PALETTE.overlay, 0));
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 8, 512);
        texture.refresh();
    }

    // 白色柔光：tint 之后就是任意色的光晕，呈现阶段"亮起"与命中反馈都要用（阶段 4a / 1g）。
    // 用它的六处一律 ADD 混合（harness/ui.md 材质那条）：normal 混合下它是盖在物件上的一层灰雾，
    // ADD 才是"从物件里透出来的光"
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

    // 白色涟漪环：点对反馈用，tint 成那一格的颜色。外圈一道淡描边当柔光，不另烤纹理
    function bakeRing(scene) {
        const texture = canvas(scene, 'ring', 128, 128);
        const ctx = texture.context;
        ctx.strokeStyle = 'rgba(255,255,255,0.28)';
        ctx.lineWidth = 13;
        ctx.beginPath();
        ctx.arc(64, 64, 56, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(64, 64, 56, 0, Math.PI * 2);
        ctx.stroke();
        texture.refresh();
    }

    // 粒子用的小白点：ADD 混合下 tint 成四色之一，全对爆发用（1j）
    function bakeSpark(scene) {
        const texture = canvas(scene, 'spark', 16, 16);
        const ctx = texture.context;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(8, 8, 6, 0, Math.PI * 2);
        ctx.fill();
        texture.refresh();
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

    // 形状从 style.css 的 glyph-* 迁过来（harness/architecture.md）：圆 / 方 / 三角 / 菱，比例照原样。
    // 三角与菱的尖角靠"同色描边 + lineJoin round"钝化，比手算圆角弧省十几行
    function paintGlyph(ctx, shape, size) {
        const center = size / 2;
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#ffffff';
        ctx.lineJoin = 'round';
        ctx.lineWidth = size * 0.05;

        if (shape === 'circle') {
            ctx.beginPath();
            ctx.arc(center, center, size * 0.44, 0, Math.PI * 2);
            ctx.fill();
            return;
        }

        if (shape === 'square') {
            roundedPath(ctx, size * 0.08, size * 0.08, size * 0.84, size * 0.84, size * 0.14);
            ctx.fill();
            return;
        }

        ctx.beginPath();
        if (shape === 'triangle') {
            ctx.moveTo(center, size * 0.06);
            ctx.lineTo(size * 0.97, size * 0.94);
            ctx.lineTo(size * 0.03, size * 0.94);
        } else {
            ctx.moveTo(center, size * 0.04);
            ctx.lineTo(size * 0.96, center);
            ctx.lineTo(center, size * 0.96);
            ctx.lineTo(size * 0.04, center);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    }

    // 四个形状各烤一张白色纹理，显示时 tint 成信号色：一份形状一种颜色，形状常驻对所有人都在
    //（4b 定案：不设色盲开关，非颜色通道不是模式），所以不需要另烤一套纹理。
    // 按 TEXTURE_SUPERSAMPLE 倍烤，任何 DPR 下都只缩不放，所以 resize 时不用重烤
    function bakeGlyphs(scene) {
        const size = CONFIG.GLYPH_SIZE * CONFIG.TEXTURE_SUPERSAMPLE;
        ns.COLORS.forEach(function (color) {
            const texture = canvas(scene, 'glyph-' + color.shape, size, size);
            paintGlyph(texture.context, color.shape, size);
            texture.refresh();
        });
    }

    // 数字键盘的十个数字同样烤成白色纹理（2b）：与形状同一条 tint 路径，
    // 亮起转白 / 回放格迷你符号都复用同一份。字号略大于纹理边长，让数字的视觉重量
    // 与形状相当（数字字形天然比圆 / 方瘦，居中烤不裁切——数字没有下伸部）
    function bakeDigits(scene) {
        const size = CONFIG.GLYPH_SIZE * CONFIG.TEXTURE_SUPERSAMPLE;
        for (let d = 0; d <= 9; d += 1) {
            const texture = canvas(scene, 'glyph-digit-' + d, size, size);
            const ctx = texture.context;
            ctx.fillStyle = '#ffffff';
            ctx.font = '700 ' + Math.round(size * 1.1) + 'px ' + CONFIG.MONO;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(d), size / 2, size / 2);
            texture.refresh();
        }
    }

    // 心形 = 两瓣圆 + 一个收到盒底的三角，一次 fill 走 nonzero 绕向就是实心（不描边、不算贝塞尔）。
    // w × h 是外接盒：两瓣半径 w/4、圆心在盒顶往下 r 处，于是最宽处正好是盒子宽
    function heartBody(ctx, cx, cy, w, h) {
        const r = w / 4;
        const top = cy - h / 2;
        ctx.beginPath();
        ctx.arc(cx - r, top + r, r, 0, Math.PI * 2);
        ctx.arc(cx + r, top + r, r, 0, Math.PI * 2);
        ctx.moveTo(cx - w / 2, top + r);
        ctx.lineTo(cx + w / 2, top + r);
        ctx.lineTo(cx, top + h);
        ctx.closePath();
        ctx.fill();
    }

    // 黑桃与梅花共用的那道牌梗：从牌身往下张开的一个三角
    function suitStem(ctx, cx, cy, size) {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + size * 0.12, cy + size * 0.4);
        ctx.lineTo(cx - size * 0.12, cy + size * 0.4);
        ctx.closePath();
        ctx.fill();
    }

    // 四个花色（harness/architecture.md：canvas 程序化描 path，不用 Unicode 扑克字符也不用 PNG 素材）。
    // 黑桃就是心形绕牌面中线镜像过来加一道牌梗——用 ctx.scale(1, -1) 翻，不重算一遍坐标，
    // 于是两个花色的轮廓天然对称。四门轮廓两两可分，不靠红黑也认得出（harness/ui.md 色觉友好那条）
    function paintSuit(ctx, suitId, size) {
        const cx = size / 2;
        const cy = size / 2;
        ctx.fillStyle = '#ffffff';

        if (suitId === 'diamond') {
            const w = size * 0.66;
            const h = size * 0.9;
            ctx.beginPath();
            ctx.moveTo(cx, cy - h / 2);
            ctx.lineTo(cx + w / 2, cy);
            ctx.lineTo(cx, cy + h / 2);
            ctx.lineTo(cx - w / 2, cy);
            ctx.closePath();
            ctx.fill();
            return;
        }

        if (suitId === 'heart') {
            heartBody(ctx, cx, cy, size * 0.86, size * 0.8);
            return;
        }

        if (suitId === 'club') {
            const lobe = size * 0.2;
            ctx.beginPath();
            ctx.arc(cx, cy - size * 0.3, lobe, 0, Math.PI * 2);
            ctx.arc(cx - size * 0.24, cy + size * 0.02, lobe, 0, Math.PI * 2);
            ctx.arc(cx + size * 0.24, cy + size * 0.02, lobe, 0, Math.PI * 2);
            ctx.fill();
            suitStem(ctx, cx, cy + size * 0.05, size);
            return;
        }

        // 牌身先画在中线偏下一点，镜像之后牌尖就顶到盒顶下方 0.06、两瓣收到中线下方 0.30，
        // 下半格留给牌梗（一直张到 0.46）——不先偏移的话牌梗会整段埋在两瓣里看不见
        ctx.save();
        ctx.translate(0, cy);
        ctx.scale(1, -1);
        ctx.translate(0, -cy);
        heartBody(ctx, cx, cy + size * 0.07, size * 0.8, size * 0.74);
        ctx.restore();
        suitStem(ctx, cx, cy + size * 0.06, size);
    }

    // 四个花色各烤一张白色纹理（2c）：显示时 tint 成红 / 黑墨（objects/Cards.js），
    // 与形状、数字同一条 tint 路径，所以一副牌只有 17 张小纹理，不是 52 张牌面（harness/architecture.md）
    function bakeSuits(scene) {
        const size = CONFIG.GLYPH_SIZE * CONFIG.TEXTURE_SUPERSAMPLE;
        ns.SUITS.forEach(function (suit) {
            const texture = canvas(scene, 'glyph-suit-' + suit.id, size, size);
            paintSuit(texture.context, suit.id, size);
            texture.refresh();
        });
    }

    // 13 个点数同样烤成白色纹理。字号按字符数收一档（'10' 是两个字符），再用 measureText 兜住
    // 平台字体差异：MONO 是一串 fallback，各家实际拿到的字形宽度不一样，顶到边就会被裁掉
    function bakeRanks(scene) {
        const size = CONFIG.GLYPH_SIZE * CONFIG.TEXTURE_SUPERSAMPLE;
        ns.RANKS.forEach(function (rank) {
            const texture = canvas(scene, 'glyph-rank-' + rank, size, size);
            const ctx = texture.context;
            let px = Math.round(size * (rank.length > 1 ? 0.78 : 1.12));
            ctx.font = '700 ' + px + 'px ' + CONFIG.MONO;
            const wide = ctx.measureText(rank).width;
            if (wide > size * 0.9) {
                px = Math.round(px * size * 0.9 / wide);
                ctx.font = '700 ' + px + 'px ' + CONFIG.MONO;
            }
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(rank, size / 2, size / 2);
            texture.refresh();
        });
    }

    class BootScene extends Phaser.Scene {
        constructor() {
            super(SCENES.BOOT);
        }

        create() {
            ns.hideSplash();
            utils.applyRenderScale(this);

            bakeSky(this);
            bakeHudBar(this);
            bakeGlow(this);
            bakeRing(this);
            bakeSpark(this);
            bakeGlyphs(this);
            bakeDigits(this);
            bakeSuits(this);
            bakeRanks(this);

            // 纹理全是程序化烤的，没有加载进度可言，烤完直接进首页
            utils.fadeTo(this, SCENES.MENU);
        }
    }

    ns.scenes = ns.scenes || {};
    ns.scenes.BootScene = BootScene;
})(window.SequenceMemory = window.SequenceMemory || {});
