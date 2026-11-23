(function (ns) {
    'use strict';

    const PALETTE = ns.PALETTE;
    const objects = ns.objects = ns.objects || {};

    // 扑克牌面（harness/architecture.md / 2c）。三件事是定案：
    // ① 不烤 52 张牌面纹理，也不烤图集——牌面本体是 Graphics 矢量，按实际尺寸画，所以任意尺寸
    //    都不发糊；点数与花色是 BootScene 烤好的 17 张白色纹理（13 点数 + 4 花色）tint 成红 / 黑墨，
    //    与形状、数字同一条 tint 路径。显存因此与牌数无关（harness/requirements.md）
    // ② 牌面按**牌宽**分两档，档由尺寸推、不由调用点推——四处（face / 中央呈现台 / 点数格 /
    //    序列条）仍然是同一份画法，不会漂移：
    //      full ≥ FULL_MIN  左上 + 右下（旋转 180°，真牌双头）角标 + 中央标准点位（A–10 按真实排布，
    //                       下半区的点倒过来）/ 宫廷窗格（J Q K）
    //      mini 再小         中央点数 + 中央花色
    //    原先"中央上大点数、下大花色，不做标准点位、不给四角角标"那条**已作废**：一对居中的
    //    点数 + 花色看着像从真牌上切下来的一个角，不像一张牌（harness/ui.md）。
    //    但 mini 档不跟着升级：44px 的点数格塞进角标，中央点数就得从 27px 压到 19px——
    //    角标在那个尺寸上只有 9px，是噪点不是信息，代价却是复现端的可读性。
    //    点数格 / 序列条 / 回放格仍走 mini，可读性问题归 harness/requirements.md 那条便宜路
    // ③ 牌背走同一条矢量路径，不烤纹理（2d 已落地 back()），所以"要不要烤成图集"这个问题不存在
    const RATIO = 5 / 7;      // 宽 / 高：标准扑克牌 2.5 × 3.5
    const FRAME_MIN = 40;     // 内框细线的下限：再窄两道线挤在一起，边缘反而看着脏

    // 门槛落在两档实际尺寸之间的空档里：呈现台 120–320（Stage.CARD_FIT）、点数格 44–61、
    // 序列条 16–39、结算回放格 10–21（Board.pickerFrame / Symbols.mini），所以不必卡得很准
    const FULL_MIN = 90;

    // full 档的角标：x / rankY 是角标中心离牌角的内缩（按牌宽 / 牌高取比例），点数在上花色在下。
    // 这几个数是按"角标不与点位区相碰"倒推的：点位两列在 0.29 / 0.71、最大 0.235 宽，
    // 角标右沿收到 0.163 才留出缝（字形只占纹理约 0.8，实际留白比这更宽）
    const CORNER = { x: 0.095, rankY: 0.085, rank: 0.135, suit: 0.1, gap: 0.55 };

    // 标准点位：x / y 是牌宽 / 牌高的比例（0.5 = 正中）。两列 0.29 / 0.71、中列 0.5；
    // 9 与 10 每列四个点、行距收到 0.18，其余每列三个点、行距 0.26。落在下半区（y > 0.5）的
    // 点旋转 180°——真牌是双头的。J Q K 不在这张表里，走宫廷窗格
    const LX = 0.29;
    const CX = 0.5;
    const RX = 0.71;
    const PIPS = {
        A: [[CX, 0.5]],
        2: [[CX, 0.24], [CX, 0.76]],
        3: [[CX, 0.24], [CX, 0.5], [CX, 0.76]],
        4: [[LX, 0.24], [RX, 0.24], [LX, 0.76], [RX, 0.76]],
        5: [[LX, 0.24], [RX, 0.24], [CX, 0.5], [LX, 0.76], [RX, 0.76]],
        6: [[LX, 0.24], [RX, 0.24], [LX, 0.5], [RX, 0.5], [LX, 0.76], [RX, 0.76]],
        7: [[LX, 0.24], [RX, 0.24], [CX, 0.37], [LX, 0.5], [RX, 0.5], [LX, 0.76], [RX, 0.76]],
        8: [[LX, 0.24], [RX, 0.24], [CX, 0.37], [LX, 0.5], [RX, 0.5], [CX, 0.63], [LX, 0.76], [RX, 0.76]],
        9: [[LX, 0.22], [RX, 0.22], [LX, 0.4], [RX, 0.4], [CX, 0.5], [LX, 0.6], [RX, 0.6], [LX, 0.78], [RX, 0.78]],
        10: [[LX, 0.22], [RX, 0.22], [CX, 0.31], [LX, 0.4], [RX, 0.4],
            [LX, 0.58], [RX, 0.58], [CX, 0.69], [LX, 0.76], [RX, 0.76]]
    };
    // 点位大小按张数收：A 是一颗大星，2–5 疏朗给大一点，6–10 密所以收一档
    const PIP_BIG = 0.38;
    const PIP_MID = 0.235;
    const PIP_SMALL = 0.195;
    const MAX_PIPS = 10;

    // 宫廷窗格（J Q K）：真牌中间是一块矩形窗、上下双头对称。这里画窗格 + 中央大字母 +
    // 字母上下各一个小花色（下面那个倒过来），不假装能画出人像
    const COURT = {
        x0: 0.26, x1: 0.74, y0: 0.15, y1: 0.85,
        letter: 0.26, suit: 0.12, suitTopY: 0.26, suitBottomY: 0.74
    };

    // mini 档：中央点数 + 中央花色（原画法原样保留）
    const MINI = { rank: 0.62, rankY: -0.19, suit: 0.5, suitY: 0.21 };

    function drawBody(art, width, height) {
        const radius = Math.max(2, Math.round(width * 0.1));
        art.fillStyle(ns.tint(PALETTE.cardPaper), 1);
        art.fillRoundedRect(-width / 2, -height / 2, width, height, radius);
        art.lineStyle(1, ns.tint(PALETTE.cardEdge), 1);
        art.strokeRoundedRect(-width / 2, -height / 2, width, height, radius);
        if (width >= FRAME_MIN) {
            art.lineStyle(1, ns.tint(PALETTE.cardEdge), 0.5);
            art.strokeRoundedRect(-width / 2 + 3, -height / 2 + 3, width - 6, height - 6, Math.max(1, radius - 2));
        }
    }

    function inkOf(card) {
        return ns.tint(card.red ? PALETTE.cardRed : PALETTE.cardInk);
    }

    // 点数与花色都是白色纹理 tint 成墨色，与 Board 里的形状 / 数字同一套做法。
    // 纹理是方形的、字形只占其中约 0.8，所以给的尺寸比"看起来的字号"大一档
    function glyph(scene, key, size, x, y) {
        return scene.add.image(x, y, key).setDisplaySize(size, size);
    }

    // setTexture 会按新纹理重置尺寸，换完要再给一次显示尺寸（同 Stage 的 glyph 分支）
    function retint(img, key, ink, size) {
        img.setTexture(key).setDisplaySize(size, size).setTint(ink);
    }

    function miniFace(scene, width, height) {
        const rankSize = Math.round(width * MINI.rank);
        const suitSize = Math.round(width * MINI.suit);
        const rank = glyph(scene, 'glyph-rank-A', rankSize, 0, Math.round(height * MINI.rankY));
        const suit = glyph(scene, 'glyph-suit-spade', suitSize, 0, Math.round(height * MINI.suitY));
        return {
            list: [rank, suit],
            paint: function (card, ink) {
                retint(rank, 'glyph-rank-' + card.rank, ink, rankSize);
                retint(suit, 'glyph-suit-' + card.suit, ink, suitSize);
            }
        };
    }

    function fullFace(scene, width, height) {
        const rankSize = Math.round(width * CORNER.rank);
        const suitSize = Math.round(width * CORNER.suit);
        const cx = Math.round(width * CORNER.x);
        const rankY = Math.round(height * CORNER.rankY);
        const suitY = rankY + Math.round((rankSize + suitSize) * CORNER.gap);

        // 角标两份，右下那一份是同一套偏移旋转 180°：容器转 π 会把子物件 (a, b) 映到 (-a, -b)，
        // 所以挂在右下角上就自动是"倒过来的左上角"，不必另算一套坐标
        function cornerMark(px, py, spin) {
            const rank = glyph(scene, 'glyph-rank-A', rankSize, cx, rankY);
            const suit = glyph(scene, 'glyph-suit-spade', suitSize, cx, suitY);
            const box = scene.add.container(px, py, [rank, suit]);
            if (spin) { box.setRotation(Math.PI); }
            return { box: box, rank: rank, suit: suit };
        }
        const tl = cornerMark(-width / 2, -height / 2, false);
        const br = cornerMark(width / 2, height / 2, true);

        // 点位建满最多的那张（10）常驻，paint 里按点数摆位置与开关——换项不重建物件（纪律 2）
        const pips = [];
        for (let i = 0; i < MAX_PIPS; i += 1) {
            pips.push(glyph(scene, 'glyph-suit-spade', 1, 0, 0).setVisible(false));
        }

        // 宫廷窗格只与牌面尺寸有关、与是哪张牌无关，所以建的时候画一次，之后只开关
        const court = scene.add.graphics().setVisible(false);
        const wx = (COURT.x0 - 0.5) * width;
        const wy = (COURT.y0 - 0.5) * height;
        const ww = (COURT.x1 - COURT.x0) * width;
        const wh = (COURT.y1 - COURT.y0) * height;
        const wr = Math.max(2, Math.round(width * 0.04));
        court.fillStyle(ns.tint(PALETTE.cardEdge), 0.22);
        court.fillRoundedRect(wx, wy, ww, wh, wr);
        court.lineStyle(1, ns.tint(PALETTE.cardEdge), 0.9);
        court.strokeRoundedRect(wx, wy, ww, wh, wr);

        const letterSize = Math.round(width * COURT.letter);
        const courtSuitSize = Math.round(width * COURT.suit);
        const letter = glyph(scene, 'glyph-rank-J', letterSize, 0, 0).setVisible(false);
        const courtTop = glyph(scene, 'glyph-suit-spade', courtSuitSize, 0,
            Math.round((COURT.suitTopY - 0.5) * height)).setVisible(false);
        const courtBottom = glyph(scene, 'glyph-suit-spade', courtSuitSize, 0,
            Math.round((COURT.suitBottomY - 0.5) * height)).setRotation(Math.PI).setVisible(false);

        return {
            list: [court, letter, courtTop, courtBottom].concat(pips, [tl.box, br.box]),
            paint: function (card, ink) {
                retint(tl.rank, 'glyph-rank-' + card.rank, ink, rankSize);
                retint(tl.suit, 'glyph-suit-' + card.suit, ink, suitSize);
                retint(br.rank, 'glyph-rank-' + card.rank, ink, rankSize);
                retint(br.suit, 'glyph-suit-' + card.suit, ink, suitSize);

                const layout = PIPS[card.rank];
                const isCourt = !layout;
                court.setVisible(isCourt);
                letter.setVisible(isCourt);
                courtTop.setVisible(isCourt);
                courtBottom.setVisible(isCourt);
                if (isCourt) {
                    retint(letter, 'glyph-rank-' + card.rank, ink, letterSize);
                    retint(courtTop, 'glyph-suit-' + card.suit, ink, courtSuitSize);
                    retint(courtBottom, 'glyph-suit-' + card.suit, ink, courtSuitSize);
                }

                const count = layout ? layout.length : 0;
                const size = Math.round(width * (count === 1 ? PIP_BIG
                    : count <= 5 ? PIP_MID : PIP_SMALL));
                pips.forEach(function (pip, i) {
                    const at = layout ? layout[i] : null;
                    if (!at) {
                        pip.setVisible(false);
                        return;
                    }
                    retint(pip, 'glyph-suit-' + card.suit, ink, size);
                    pip.setPosition(Math.round((at[0] - 0.5) * width), Math.round((at[1] - 0.5) * height))
                        .setRotation(at[1] > 0.5 ? Math.PI : 0)
                        .setVisible(true);
                });
            }
        };
    }

    // 常驻牌面（2g）：容器建一次，换牌只换纹理 / 墨色 / 点位摆位——与 Stage 的 glyph
    // "换项换纹理不重建物件"同一条纪律。face()、中央呈现台、点数格与序列条都走这一份，
    // 四处画法不会漂移。档位在这里定一次（牌宽在容器生命周期里不变），调用点不选档。
    // 初始纹理只是占位，paint 之前不该被看见
    function faceKit(scene, width, height) {
        const build = width >= FULL_MIN ? fullFace : miniFace;
        const art = scene.add.graphics();
        drawBody(art, width, height);
        const face = build(scene, width, height);
        const container = scene.add.container(0, 0, [art].concat(face.list));

        return {
            container: container,
            paint: function (card) { face.paint(card, inkOf(card)); }
        };
    }

    objects.cards = {
        ratio: RATIO,

        // 一张牌的正面：返回以 (x, y) 为中心的 Container，高度由调用方按 ratio 给。
        // 结算的迷你回放格用它；局内两处（2g 中央呈现台、2h 点数格）走下面的 faceKit，
        // 三处同一份画法。翻牌就是给这个容器挂 scaleX 1→0 换面 →0→1（harness/architecture.md）：
        // 矢量本体与纹理子物件一起被压扁，不需要另做一张"翻到一半"的纹理
        face: function (scene, card, x, y, width, height) {
            const kit = faceKit(scene, width, height);
            kit.paint(card);
            return kit.container.setPosition(x, y);
        },

        // 常驻牌面 + 换内容（2g 的中央呈现台在用）：{ container, paint(card) }
        faceKit: faceKit,

        // 牌背（2d，harness/ui.md）：深紫底 + 细边 + 内框 + 中央菱形标记，与牌面同一条矢量路径。
        // 内框与标记在牌宽不足时省略——小尺寸下几道细线挤在一起反而看着脏（同 FRAME_MIN 判据）
        back: function (scene, x, y, width, height) {
            const radius = Math.max(2, Math.round(width * 0.1));
            const art = scene.add.graphics();
            art.fillStyle(ns.tint(PALETTE.cardBack), 1);
            art.fillRoundedRect(-width / 2, -height / 2, width, height, radius);
            art.lineStyle(1, ns.tint(PALETTE.dominantSoft), 0.55);
            art.strokeRoundedRect(-width / 2, -height / 2, width, height, radius);
            if (width >= FRAME_MIN) {
                art.lineStyle(1, ns.tint(PALETTE.dominantSoft), 0.3);
                art.strokeRoundedRect(-width / 2 + 3, -height / 2 + 3, width - 6, height - 6, Math.max(1, radius - 2));
                const d = width * 0.16;
                art.fillStyle(ns.tint(PALETTE.dominantSoft), 0.5);
                art.beginPath();
                art.moveTo(0, -d);
                art.lineTo(d, 0);
                art.lineTo(0, d);
                art.lineTo(-d, 0);
                art.closePath();
                art.fillPath();
            }
            return scene.add.container(x, y, [art]);
        }
    };
})(window.SequenceMemory = window.SequenceMemory || {});
