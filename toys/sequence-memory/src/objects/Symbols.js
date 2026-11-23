(function (ns) {
    'use strict';

    const PALETTE = ns.PALETTE;
    const objects = ns.objects = ns.objects || {};

    // 每种类型"一格符号怎么画"收在这一处（harness/requirements.md2a）：局内格子的常驻标记与结算回放格里的
    // 迷你符号读同一份数据（config.SYMBOLS），于是 Board 与 GameOverScene 都不认类型。
    // 数据在 config、画法在这里——分层红线不许 systems 碰渲染，反过来渲染也不该各画各的
    objects.symbols = {
        // 局内那一格常驻的标记：颜色是它自己的形状（位置 + 形状 + 颜色三重冗余，harness/gameplay.md），
        // 数字是数字本身（十键同色，数字就是身份，harness/ui.md），位置类型没有标记——
        // 九格同色不印字，信息全在"哪一格亮"。没有就返回 null，由 Board 跳过，不造一个空物件冒充
        mark: function (scene, typeId, index, size) {
            const symbol = ns.SYMBOLS[typeId][index];
            if (!symbol.glyph) { return null; }
            return scene.add.image(0, 0, 'glyph-' + symbol.glyph)
                .setDisplaySize(size, size)
                .setTint(ns.tint(symbol.hex))
                .setAlpha(0.92);
        },

        // 结算回放格里的符号（harness/ui.md）：颜色画形状，数字画它自己的数字（与局内共用烤好的纹理），
        // 位置画一个迷你九宫格、只亮对应那一格，扑克画一张迷你牌面（与局内共用 Cards.face）。
        // 判据与 1h 的三态纪律同源——回放要能不靠颜色读懂：位置类型九格同色，
        // 回放里再画九个一样的方块等于什么也没说，必须画出"是哪一格"；
        // 扑克 52 张同强调色，只画一个紫点同样什么也没说，必须画出点数与花色
        mini: function (scene, typeId, index, x, y, size) {
            const symbol = ns.SYMBOLS[typeId][index];
            if (symbol.card) {
                // 牌面撑到传进来尺寸的 1.5 倍高（同九宫格的 span 判据）：回放格 18–38px，
                // 迷你牌约 14–30px 高，仍落在格子内框里
                const h = Math.round(size * 1.5);
                const w = Math.round(h * objects.cards.ratio);
                return objects.cards.face(scene, symbol.card, x, y, w, h);
            }
            if (symbol.glyph) {
                return scene.add.image(x, y, 'glyph-' + symbol.glyph)
                    .setDisplaySize(size, size)
                    .setTint(ns.tint(symbol.hex));
            }

            const spec = ns.BOARDS[typeId];
            const art = scene.add.graphics();
            // 点阵撑到传进来尺寸的 1.5 倍：调用方给的是格子的 0.52，九宫格比一个形状占得多一点，
            // 但仍落在格子内框里（回放格 18–38px，内框约 0.84 倍）
            const span = size * 1.5;
            const pitch = span / spec.cols;
            const dot = Math.max(1, pitch * 0.22);

            for (let i = 0; i < spec.cols * spec.rows; i += 1) {
                const cx = x - span / 2 + pitch * ((i % spec.cols) + 0.5);
                const cy = y - span / 2 + pitch * (Math.floor(i / spec.cols) + 0.5);
                const on = i === index;
                art.fillStyle(ns.tint(on ? symbol.hex : PALETTE.surfaceEdge), on ? 1 : 0.7);
                art.fillCircle(cx, cy, on ? dot * 1.5 : dot);
            }
            return art;
        }
    };
})(window.SequenceMemory = window.SequenceMemory || {});
