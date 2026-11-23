(function (ns) {
    'use strict';

    const PALETTE = ns.PALETTE;
    const CONFIG = ns.CONFIG;
    const DEPTH = ns.DEPTH;
    const MOTION = ns.MOTION;
    const GAP_RATIO = 0.055;
    const objects = ns.objects = ns.objects || {};
    const ui = ns.utils.ui;
    const art = objects.symbols;

    // 玩法区（harness/requirements.md 抽出的 Board 抽象）：呈现与复现的节奏、状态机与反馈动作全在这一处实现，
    // 类型只给两样东西——config.BOARDS 的排布（几行几列，允许 slots 映射与空格）与
    // config.SYMBOLS 的每格样子（名字 / 强调色 / 标记纹理，画法在 objects/Symbols.js）。
    // 于是颜色、位置与数字共用同一份亮起 80ms / 熄灭 180ms 留余晖 / 遮罩 / 呼吸光 /
    // 逐格示意 / 波浪（harness/ui.md 动效契约）。
    // 颜色的标记是形状：位置 + 形状 + 颜色三重冗余（harness/gameplay.md）；位置类型没有标记，
    // 九格同色不印字，信息全在"哪一格亮"；数字的标记是数字本身，十键同色（harness/ui.md）。
    // 注：stream 形态（颜色 2e、数字 2f）下呈现不在棋盘上，颜色那条"位置冗余"随之失效、
    // 只剩形状，而形状对所有人常驻——所以 4b 不设色盲开关（harness/requirements.md）。
    //
    // 1i 起物件常驻（harness/ui.md）：格子与遮罩在建的时候一次造好，之后只走 sync(view)——
    // 目标状态全量由传进来的 view 推导，tween 只负责把物件动到目标，不销毁重建。
    //
    // 下面三份实现共用同一份返回契约与节拍契约，差的只有"符号怎么表达"：
    // gridBoard 方阵（棋盘上点亮格子）、streamBoard 中央呈现 + 复现层（2e–2i，
    // 呈现形态决定测哪条通道，见 config.TYPES 的 stage；复现层按 kind 选方阵或选牌器）、
    // cardPicker 两步选牌器（2h，取代 2d 的 52 张牌堆：花色 tab 是导航、点数格才提交；
    // 2i 在顶部加一条已选序列条，全对的波浪扫它）

    // 外框几何一处算：宽就是传进来的 size，高由行数推（数字键盘 3 列 4 行不是正方形）。
    // 场景适配可用空间时调 measure，不自己拿列数猜比例（harness/ui.md）
    function frame(spec, size) {
        const gap = Math.round(size * GAP_RATIO);
        const pad = Math.round((size - gap * (spec.cols - 1)) / spec.cols);
        return {
            width: size,
            height: spec.rows * pad + (spec.rows - 1) * gap,
            pad: pad, gap: gap
        };
    }

    // 选牌器几何（2h）：宽 = 7 格 + 6 缝，高 = 已选序列条（2i）+ 两行点数格（7 + 6）+ 花色 tab 行（钉底）。
    // 点数格是 5:7 的迷你牌面（与中央大牌同一个比例），tab 行不吃牌的比例、只吃触控下限。
    // 缝按格宽的比例走，所以格宽要从"宽 = cols × w + (cols-1) × w × 比例"反解，
    // 不能先拿宽除列数再扣缝——那样格宽会偏小、缝又偏大
    const PICKER_GAP = 0.09;
    // 已选序列条（2i，harness/ui.md）：牌面是点数格的 0.64 倍（390 宽的手机拿到 28×39），
    // 槽位与点数格共用同一套列栅格（格宽 + 缝），于是每行同样是 7 张、列与下面的点数格对齐，
    // 槽宽 ≥44 由 picker 的 min 一并保证。序列条只读（退格评估过不做，harness/requirements.md 3b）。
    // 预留两行：一行只够长度 7 的关，而全对波浪要按点选顺序
    // 扫完全部已选（n 通常 ≤10，2d）。带子钉进框里而不是浮在框外，measure 才算得到这段高度，
    // fitBoard 才知道要给它留位置
    const STRIP_SCALE = 0.64;
    const STRIP_ROWS = 2;
    // 呈现 / 隐藏阶段没有已输入的牌，序列条是空的：一个共用的空数组，省掉每次 sync 的分配
    const NO_PICKS = [];

    function pickerFrame(spec, size) {
        const cols = spec.cols;
        const cellW = Math.floor(size / (cols + (cols - 1) * PICKER_GAP));
        const gap = Math.round(cellW * PICKER_GAP);
        const cellH = Math.round(cellW / objects.cards.ratio);
        const width = cols * cellW + (cols - 1) * gap;
        const tabH = Math.max(CONFIG.TOUCH_TARGET, Math.round(cellH * 0.78));
        const tabGap = gap * 2;
        const tabW = Math.floor((width - (ns.SUITS.length - 1) * tabGap) / ns.SUITS.length);
        const stripW = Math.max(16, Math.round(cellW * STRIP_SCALE));
        const stripH = Math.round(stripW / objects.cards.ratio);
        const stripSlotH = Math.max(CONFIG.TOUCH_TARGET, stripH + gap);
        const stripBand = STRIP_ROWS * stripSlotH + (STRIP_ROWS - 1) * gap;
        const height = stripBand + gap + spec.rows * cellH + (spec.rows - 1) * gap + gap + tabH;
        const top = -height / 2;
        return {
            width: width,
            height: height,
            cellW: cellW, cellH: cellH, gap: gap,
            tabH: tabH, tabW: tabW, tabGap: tabGap,
            // 竖向三个锚点一处算完：序列条带子的下沿、点数格首行中心、tab 行中心（钉底）。
            // 带子下沿固定，行数变了只往上长——点数格与 tab 不跟着跳（它们是接输入的那两层）
            stripBottom: top + stripBand,
            cellTop: top + stripBand + gap + cellH / 2,
            tabY: top + stripBand + gap + spec.rows * cellH + (spec.rows - 1) * gap + gap + tabH / 2,
            stripW: stripW, stripH: stripH, stripSlotH: stripSlotH,
            stripRows: STRIP_ROWS, stripCols: cols
        };
    }

    // 分派只此一处：场景仍然不认类型，它给的还是 { type, x, y, size, avail, onTap }，
    // 拿到的还是同一份返回契约（avail 是呈现台的可用矩形，只有 stream 那一支读，
    // 方阵不读、契约不变）。呈现形态在先（stage，2e–2h）：stream 的类型一律走
    // streamBoard，复现层在它里面按 kind 选；board 只剩位置——棋盘上点亮格子
    objects.board = function (scene, opts) {
        if (ns.typeById(opts.type).stage === 'stream') { return streamBoard(scene, opts); }
        return gridBoard(scene, opts);
    };

    // 中央呈现 + 复现层（harness/requirements.md2e 颜色 / 2f 数字 / 2g 扑克呈现 / 2h 扑克复现）：
    // 呈现阶段整层复现区都不露出来，符号在中央逐个闪现（objects/Stage.js），
    // 复现才把棋盘 / 选牌器发下来。位置不在呈现里出现，玩家就没有免费索引可用。
    // 遮罩的意思随之从"遮住刚才亮过的棋盘"变成"刚才中间闪的那些现在盖住了"——
    // 三相位的视觉区分与操作权限一字不变（harness/ui.md）：呈现只看、隐藏一个"开始复现"、复现可点。
    //
    // 两层套在一个外层容器里，于是入场升起、0.92→1 缩放、点错抖动、全对的粒子爆发
    // 都作用在"当前看得见的那一层"上，GameScene 一行不用改（它只多传一个 phase 字段）
    function streamBoard(scene, opts) {
        const wrap = scene.add.container(opts.x, opts.y).setDepth(DEPTH.board);
        // 复现层按 kind 选：扑克是两步选牌器（2h），其余是方阵。
        // 两份实现的返回契约一字不差，下面的两层切换不认类型
        const recallImpl = ns.BOARDS[opts.type].kind === 'picker' ? cardPicker : gridBoard;
        const recall = recallImpl(scene, {
            type: opts.type, x: 0, y: 0, size: opts.size, onTap: opts.onTap
        });
        // avail 原样转给呈现台：呈现期这一层整块隐藏，那张符号是屏幕上唯一的玩法物件，
        // 尺寸按可用矩形定而不是跟着复现面板缩（harness/ui.md）
        const stage = objects.stage(scene, {
            type: opts.type, x: 0, y: 0, size: opts.size, avail: opts.avail
        });
        wrap.add([recall.container, stage.container]);
        stage.container.setAlpha(0).setVisible(false);

        // 复现层是缺省看得见的那一层；呈现台要等第一次 sync 才知道该不该上来
        let shown = 'recall';
        let fresh = true;

        function layer(obj, on, duration) {
            scene.tweens.killTweensOf(obj);
            if (!duration) {
                obj.setAlpha(on ? 1 : 0).setVisible(on);
                return;
            }
            // 淡出期间要看得见，淡到 0 之后再关；alpha 恰为 0 的物件 Phaser 跳过命中测试（1j）
            obj.setVisible(true);
            scene.tweens.add({
                targets: obj, alpha: on ? 1 : 0, duration: duration, ease: 'Quad.easeOut',
                onComplete: function () { if (!on) { obj.setVisible(false); } }
            });
        }

        function sync(view) {
            const presenting = view.phase === 'present' || view.phase === 'lead';
            const want = presenting ? 'stage' : 'recall';
            if (want !== shown) {
                shown = want;
                // 首次同步直接落位不交叉淡入：转屏 restart 会重跑 create()，
                // 淡入会先闪一帧错的层（纪律 2 的"不缓存上一次状态"在这里就是 fresh 这一面旗）
                const duration = fresh ? 0 : MOTION.veilIn;
                layer(stage.container, presenting, duration);
                layer(recall.container, !presenting, duration);
            }
            fresh = false;

            stage.sync(view);
            // 呈现期间复现层保持"已遮住且没有亮着的格子"：这一层现在看不见，但遮罩要在它露出来
            // 之前就位，否则 hidden 那一拍会先闪出整副棋盘 / 选牌器再盖上
            recall.sync(presenting
                ? Object.assign({}, view, { lit: null, veil: true, interactive: false })
                : view);
        }

        return {
            container: wrap,
            sync: sync,
            tick: function (time) { if (shown !== 'stage') { recall.tick(time); } },
            // recall.container 在 wrap 里是 (0, 0)，涟漪要的是世界坐标，补回外层这一段偏移
            center: function (index) {
                const at = recall.center(index);
                return { x: at.x + wrap.x, y: at.y + wrap.y, size: at.size, hex: at.hex };
            },
            cue: function () { recall.cue(); },
            wave: function () { recall.wave(); }
        };
    }

    // 方阵（颜色 / 位置 / 数字）：棋盘上点亮格子。位置类型的呈现与复现共用同一副格子；
    // stream 类型（颜色 / 数字）这一份只做复现，呈现期间整层不露出来（streamBoard）
    function gridBoard(scene, opts) {
        const spec = ns.BOARDS[opts.type];
        const cols = spec.cols;
        const size = opts.size;
        const f = frame(spec, size);
        const pad = f.pad;
        const gap = f.gap;
        const height = f.height;
        const radius = Math.round(pad * 0.16);
        const glyph = Math.round(pad * 0.44);
        const container = scene.add.container(opts.x, opts.y).setDepth(DEPTH.board);
        const state = { veil: false, interactive: false, phase: null };
        // 减少动效（4b，harness/ui.md）：构建时读一次，转屏 restart 重读。砍弹跳 / 呼吸光，
        // 波浪与示意的行进降级成同时亮——亮起 / 余晖 / 遮罩 / 按下缩放这些信息性动画照旧
        const reduced = ns.utils.reducedMotion();

        function fade(tile, obj, to, duration) {
            scene.tweens.killTweensOf(obj);
            const tween = scene.tweens.add({
                targets: obj, alpha: to, duration: duration, ease: 'Quad.easeOut',
                onComplete: function () { if (obj === tile.glow) { tile.glowTween = null; } }
            });
            // 呼吸光只在没有柔光 tween 挂着时写 alpha，否则会和淡入淡出打架
            if (obj === tile.glow) { tile.glowTween = tween; }
        }

        function scaleTo(tile, to, duration, ease) {
            if (tile.scaleTween) { tile.scaleTween.stop(); }
            tile.scaleTween = scene.tweens.add({
                targets: tile.box, scaleX: to, scaleY: to,
                duration: duration, ease: ease || 'Quad.easeOut',
                onComplete: function () { tile.scaleTween = null; }
            });
        }

        // 标记是可选的（位置类型没有）：染色与淡入淡出都走这两个小口子，
        // 状态机里就不必到处写 if (tile.mark)
        function tintMark(tile, hex) {
            if (tile.mark) { tile.mark.setTint(ns.tint(hex)); }
        }

        function fadeMark(tile, to, duration) {
            if (tile.mark) { fade(tile, tile.mark, to, duration); }
        }

        // 暗底常驻：未亮时低饱和暗底 + 弱描边，hover 只是把描边与边缘高光加重，不换物件。
        // 主体走 ui.slab（harness/ui.md 材质那条）：平填充 + 1px 描边读起来是表格单元格，
        // 上缘一道白光 + 下缘一道暗影才是"一块板子"。暗底给得比亮起态重——同样的幅度在暗色上看不出来
        function drawBase(tile) {
            const strong = tile.hovered && state.interactive;
            tile.base.clear();
            ui.slab(tile.base, -pad / 2, -pad / 2, pad, pad, radius, {
                hex: PALETTE.surface,
                alpha: strong ? 0.82 : 0.66,
                hi: strong ? 0.18 : 0.14,
                lo: strong ? 0.34 : 0.3,
                stroke: tile.symbol.hex,
                strokeWidth: strong ? 2 : 1,
                strokeAlpha: strong ? 0.9 : 0.34
            });
        }

        // 亮起层单独一张 graphics，alpha 在 0↔1 之间 tween：
        // 亮 / 灭的颜色过渡因此是渐变而不是硬切，熄灭时柔光淡出留余晖（harness/ui.md）。
        // 上缘那道白高光在饱和色上是"玻璃边缘"，与 ADD 柔光一起构成"发光实体"
        function drawLit(tile) {
            tile.litPanel.clear();
            ui.slab(tile.litPanel, -pad / 2, -pad / 2, pad, pad, radius, {
                hex: tile.accent, alpha: 0.92, hi: 0.3, lo: 0.24,
                strokeWidth: 2, strokeAlpha: 0.95
            });
        }

        const tiles = ns.SYMBOLS[opts.type].map(function (symbol, index) {
            // 格子位置行优先：缺省符号下标就是格子位置（颜色 2×2、位置 3×3）；
            // 带 slots 的排布按映射落位（数字电话键盘：1–9 上三行、0 末行正中，harness/ui.md）
            const cell = spec.slots ? spec.slots[index] : index;
            const cx = -size / 2 + pad / 2 + (cell % cols) * (pad + gap);
            const cy = -height / 2 + pad / 2 + Math.floor(cell / cols) * (pad + gap);
            // 柔光 ADD 混合（harness/ui.md 材质那条）：normal 混合下它是盖在背景上的一层灰雾，
            // ADD 才是"从格子里透出来的光"。它排在 base / litPanel 之下，所以被板子挡住的那部分
            // 不参与合成，看得见的是溢出到格子外面那一圈光晕
            const glow = scene.add.image(0, 0, 'glow')
                .setDisplaySize(pad * 2.1, pad * 2.1)
                .setTint(ns.tint(symbol.hex))
                .setBlendMode(Phaser.BlendModes.ADD)
                .setAlpha(0);
            const base = scene.add.graphics();
            const litPanel = scene.add.graphics().setAlpha(0);
            const mark = art.mark(scene, opts.type, index, glyph);
            const box = scene.add.container(cx, cy, [glow, base, litPanel].concat(mark ? [mark] : []));
            const tile = {
                symbol: symbol, index: index, cell: cell, box: box, glow: glow, base: base,
                litPanel: litPanel, mark: mark,
                lit: false, accent: symbol.hex, hovered: false, armed: false,
                glowTween: null, scaleTween: null
            };
            drawBase(tile);
            drawLit(tile);

            // input 常驻挂好，能不能点由 sync 按相位开关：呈现阶段不接玩法输入
            //（harness/gameplay.md），判定已定之后也不接——连点的那几下不算数
            box.setSize(pad, pad);
            // hitArea 用左上角为原点的纹理空间：判定时 Phaser 会先给本地坐标加上 displayOrigin
            //（Container 恒为 width/height 的一半），与 ui.button / ui.chip 同一套约定
            box.setInteractive({
                hitArea: new Phaser.Geom.Rectangle(0, 0, pad, pad),
                hitAreaCallback: Phaser.Geom.Rectangle.Contains,
                useHandCursor: true
            });
            box.input.enabled = false;
            box.on('pointerover', function () {
                tile.hovered = true;
                drawBase(tile);
            });
            box.on('pointerout', function () {
                tile.hovered = false;
                tile.armed = false;
                drawBase(tile);
                if (!tile.lit) { scaleTo(tile, 1, 110); }
            });
            box.on('pointerdown', function () {
                if (scene._smFading) { return; }
                tile.armed = true;
                scaleTo(tile, 0.94, MOTION.press);
            });
            box.on('pointerup', function () {
                if (!tile.armed || scene._smFading) { return; }
                tile.armed = false;
                scaleTo(tile, 1, 90);
                opts.onTap(index);
            });

            return tile;
        });

        // 遮罩是盖在玩法区上的一层 scrim + 一行小字，不是换一屏（harness/ui.md）。
        // 不用 ui.card——卡片是菜单型屏幕的构件，局内不出现
        const veilPanel = scene.add.graphics().setAlpha(0);
        veilPanel.fillStyle(ns.tint(PALETTE.overlay), 0.94);
        veilPanel.fillRoundedRect(-size / 2, -height / 2, size, height, Math.round(radius * 1.4));
        veilPanel.lineStyle(1, ns.tint(PALETTE.surfaceEdge), 0.5);
        veilPanel.strokeRoundedRect(-size / 2, -height / 2, size, height, Math.round(radius * 1.4));
        const veilText = ui.text(scene, 0, 0, '序列已遮住', {
            fontSize: '13px', color: PALETTE.textDim, letterSpacing: 2
        }).setAlpha(0);

        container.add(tiles.map(function (tile) { return tile.box; }).concat([veilPanel, veilText]));

        // 示意 / 波浪的逐格延迟按空间顺序（行优先）推进：数字键盘的符号序是 0–9 而 0 在末行，
        // 按符号序亮灯会跳来跳去；颜色 / 位置的符号序就是空间序，行为不变
        const spatial = tiles.slice().sort(function (a, b) { return a.cell - b.cell; });

        // 全量同步：view 进、目标状态出，每一格都比对自己的当前态决定要不要动。
        // 不允许"只更新我记得的那个对象"——漏更新在结构上不会出现（harness/ui.md）
        function sync(view) {
            const veilChanged = view.veil !== state.veil;
            const phaseChanged = view.phase !== state.phase;
            state.veil = view.veil;
            state.interactive = view.interactive;
            state.phase = view.phase;

            tiles.forEach(function (tile) {
                const lit = !view.veil && view.lit === tile.index;
                // 点错的那一格整格换成危险色：颜色在这里是判定结论，不是这一格的身份
                const accent = lit && view.verdict === 'bad' ? PALETTE.danger : tile.symbol.hex;
                tile.box.input.enabled = view.interactive;

                if (accent !== tile.accent) {
                    tile.accent = accent;
                    drawLit(tile);
                    tile.glow.setTint(ns.tint(accent));
                    if (!lit) { tintMark(tile, accent); }
                }

                if (lit !== tile.lit) {
                    tile.lit = lit;
                    if (lit) {
                        tintMark(tile, '#ffffff');
                        fade(tile, tile.glow, 0.42, MOTION.litIn);
                        fade(tile, tile.litPanel, 1, MOTION.litIn);
                        fadeMark(tile, 1, MOTION.litIn);
                        // 弹一下的落点感：1→1.08→1，静止态停在 1 才不发虚。减少动效时砍掉（装饰）
                        if (!reduced) {
                            if (tile.scaleTween) { tile.scaleTween.stop(); }
                            tile.box.setScale(1);
                            tile.scaleTween = scene.tweens.add({
                                targets: tile.box, scaleX: 1.08, scaleY: 1.08,
                                duration: MOTION.pop / 2, ease: 'Back.easeOut', yoyo: true,
                                onComplete: function () { tile.scaleTween = null; }
                            });
                        }
                    } else {
                        tintMark(tile, view.veil ? PALETTE.textFaint : tile.accent);
                        fade(tile, tile.glow, 0, MOTION.litOut);
                        fade(tile, tile.litPanel, 0, MOTION.litOut);
                        fadeMark(tile, view.veil ? 0.3 : 0.92, MOTION.litOut);
                        scaleTo(tile, 1, 120);
                    }
                } else if (veilChanged && !lit) {
                    // 遮住的时候连标记一起压暗：颜色与形状都是序列的信息，不能留一半
                    tintMark(tile, view.veil ? PALETTE.textFaint : tile.accent);
                    fadeMark(tile, view.veil ? 0.3 : 0.92, view.veil ? MOTION.veilIn : MOTION.veilOut);
                    if (view.veil) {
                        fade(tile, tile.glow, 0, MOTION.veilIn);
                        fade(tile, tile.litPanel, 0, MOTION.veilIn);
                    }
                }
            });

            if (veilChanged) {
                const duration = view.veil ? MOTION.veilIn : MOTION.veilOut;
                scene.tweens.killTweensOf(veilPanel);
                scene.tweens.killTweensOf(veilText);
                scene.tweens.add({ targets: veilPanel, alpha: view.veil ? 1 : 0, duration: duration, ease: 'Quad.easeOut' });
                scene.tweens.add({ targets: veilText, alpha: view.veil ? 1 : 0, duration: duration, ease: 'Quad.easeOut' });
            }

            // 相位切换全量归位：wave / cue 是带 delay 的 transient 脉冲，起始值在延迟走完那一刻才取，
            // 可能把"淡出到一半"的 alpha 当成静止态，yoyo 回来停在半亮（高亮框残留）。逻辑态没变的格子
            // 上面的增量分支不会再碰，所以相位一变就把未亮格子的柔光 / 亮起层 kill 回 0——状态永远赢
            if (phaseChanged) {
                tiles.forEach(function (tile) {
                    if (tile.lit) { return; }
                    scene.tweens.killTweensOf(tile.glow);
                    scene.tweens.killTweensOf(tile.litPanel);
                    tile.glowTween = null;
                    tile.glow.setAlpha(0);
                    tile.litPanel.setAlpha(0);
                });
            }
        }

        // 复现待命态的呼吸光：极轻微的正弦 alpha，告诉玩家"这里可以点"（harness/ui.md）。
        // 呈现阶段没有呼吸——呈现不给任何可点的暗示。由场景 update 驱动，暂停自动冻住
        function tick(time) {
            if (reduced || !state.interactive || state.veil) { return; }
            tiles.forEach(function (tile) {
                if (tile.lit || tile.glowTween) { return; }
                tile.glow.alpha = 0.05 + 0.04 * (0.5 + 0.5 * Math.sin(time / 900 + tile.index * 1.7));
            });
        }

        // 某一格的中心世界坐标、边长与它自己的强调色：涟漪要对准格子本身、染成那一格的颜色，
        // 场景不必回头翻 COLORS（harness/requirements.md）。给的是身份色而不是 accent——点错时 accent 已经是危险色
        function center(index) {
            const tile = tiles[index];
            return { x: container.x + tile.box.x, y: container.y + tile.box.y, size: pad, hex: tile.symbol.hex };
        }

        // 隐藏→复现：逐格轻"呼吸"一次示意可点（harness/ui.md）。只动柔光，yoyo 落回当前值。
        // 挂进 glowTween 是为了让 tick 在这段期间停手——呼吸光和示意脉冲不能同时写 alpha
        function cue() {
            spatial.forEach(function (tile, i) {
                if (tile.glowTween) { tile.glowTween.stop(); }
                tile.glowTween = scene.tweens.add({
                    targets: tile.glow, alpha: 0.3,
                    duration: 140, delay: reduced ? 0 : i * MOTION.wave, yoyo: true, ease: 'Sine.easeInOut',
                    onComplete: function () { tile.glowTween = null; }
                });
            });
        }

        // 全对：逐格波浪式亮一遍（harness/ui.md）。与 cue 一样是 transient 脉冲、不改 state：
        // yoyo 落回 tween 起始值（= 当前状态推导的值），中途玩家提前走的话，
        // 下一次 sync 的 fade 会 kill 掉这些 tween——状态永远赢（harness/ui.md）
        function wave() {
            spatial.forEach(function (tile, i) {
                const delay = reduced ? 0 : i * MOTION.wave;
                scene.tweens.add({
                    targets: tile.glow, alpha: 0.55,
                    duration: MOTION.litIn, delay: delay, hold: 90, yoyo: true, ease: 'Quad.easeOut'
                });
                scene.tweens.add({
                    targets: tile.litPanel, alpha: 1,
                    duration: MOTION.litIn, delay: delay, hold: 90, yoyo: true, ease: 'Quad.easeOut'
                });
            });
        }

        return { container: container, sync: sync, tick: tick, center: center, cue: cue, wave: wave };
    }

    // 两步选牌器（2h，取代 2d 的 52 张牌堆）：与方阵 board 共用返回契约
    // { container, sync, tick, center, cue, wave }，节拍仍全在 GameScene 的一条累加时钟上，
    // 这里只管把 view 推导成目标状态。与方阵的不同都是牌自己的表达（harness/ui.md、harness/gameplay.md）：
    // ① 钉底的 4 个花色 tab 是**导航不是提交**：点它只切点数面板，不计入判定、点错没有代价；
    //    点点数格才调 onTap(花色 × 13 + 点数)，下标结构与 CARDS 一致，所以 Judge / session 零改动。
    // ② 当前花色是渲染游标，不进 session（判据仍是 1g 那条"丢了会不会让玩家白看一遍序列"）：
    //    转屏丢了就重新推一个默认值，不痛。
    // ③ 选过的点数格压暗置灰 + 关 input（序列无放回），目标全量由 view.picked 推导；
    //    点错那一格盖危险色，但牌面仍看得清——要看得出"错成了哪张"。
    // ④ 顶部是已选序列条（2i）：横排自己点过的那几张牌，与置灰同一份 view.picked，
    //    全对的波浪扫这条不扫面板。它不接输入、也没有呼吸光（呼吸是"可以点"的暗示）
    function cardPicker(scene, opts) {
        const spec = ns.BOARDS[opts.type];
        const f = pickerFrame(spec, opts.size);
        const suits = ns.SUITS;
        const perSuit = ns.RANKS.length;
        const cellW = f.cellW;
        const cellH = f.cellH;
        const radius = Math.max(2, Math.round(cellW * 0.1));
        // 52 张同强调色（config.SYMBOLS.card）：身份印在牌面上，一格一色是制造干扰
        const HEX = ns.SYMBOLS[opts.type][0].hex;
        const container = scene.add.container(opts.x, opts.y).setDepth(DEPTH.board);
        const state = { veil: false, interactive: false };
        // 减少动效（4b）：与方阵同一条契约——砍弹跳 / 呼吸光 / 切花色挤压，波浪与示意降级成同时亮
        const reduced = ns.utils.reducedMotion();

        // 当前花色与最近一次 view：切 tab 是选牌器内部的事，GameScene 不会为它再 sync 一次，
        // 所以切完要拿同一份 view 把 13 格 + 4 tab 全量重推导一遍（纪律 2）
        let suit = 0;
        let lastView = null;
        let fresh = true;

        function fade(cell, obj, to, duration) {
            scene.tweens.killTweensOf(obj);
            const tween = scene.tweens.add({
                targets: obj, alpha: to, duration: duration, ease: 'Quad.easeOut',
                onComplete: function () { if (obj === cell.glow) { cell.glowTween = null; } }
            });
            // 呼吸光只在没有柔光 tween 挂着时写 alpha，否则会和淡入淡出打架
            if (obj === cell.glow) { cell.glowTween = tween; }
        }

        // 按下 / 弹一下 / 落回都写同一个 scale 通道，一个物件同一时刻只挂一条
        function scaleTo(cell, to, duration, ease) {
            if (cell.scaleTween) { cell.scaleTween.stop(); }
            cell.scaleTween = scene.tweens.add({
                targets: cell.box, scaleX: to, scaleY: to,
                duration: duration, ease: ease || 'Quad.easeOut',
                onComplete: function () { cell.scaleTween = null; }
            });
        }

        // 亮起 / 点错的覆盖层：盖在牌面上的一层薄色 + 一道描边。点错用危险色但只盖 0.3，
        // 牌面本身仍看得清（2d 的判据原样继承）；点对用这一格的强调色，更薄
        function drawMark(cell) {
            cell.mark.clear();
            cell.mark.fillStyle(ns.tint(cell.accent), cell.bad ? 0.3 : 0.16);
            cell.mark.fillRoundedRect(-cellW / 2, -cellH / 2, cellW, cellH, radius);
            cell.mark.lineStyle(2, ns.tint(cell.accent), 0.95);
            cell.mark.strokeRoundedRect(-cellW / 2, -cellH / 2, cellW, cellH, radius);
        }

        function drawTab(tab) {
            const active = tab.index === suit;
            const strong = active || (tab.hovered && state.interactive);
            const w = f.tabW;
            const h = f.tabH;
            const r = Math.min(12, Math.round(h * 0.28));
            tab.base.clear();
            ui.slab(tab.base, -w / 2, -h / 2, w, h, r, {
                hex: PALETTE.surface,
                alpha: active ? 0.95 : 0.6,
                hi: active ? 0.18 : 0.1,
                lo: active ? 0.26 : 0.2,
                stroke: active ? PALETTE.dominantSoft : PALETTE.surfaceEdge,
                strokeWidth: active ? 2 : 1,
                strokeAlpha: active ? 0.95 : (strong ? 0.8 : 0.5)
            });
            // 当前态不只靠颜色：顶上一道指示条，不看颜色也认得出"现在在哪一门"（harness/ui.md）。
            // tab 钉底，指示条翻到顶缘、指向它上方的点数格（原先 tab 在顶时它在底缘）
            if (active) {
                tab.base.fillStyle(ns.tint(PALETTE.dominantSoft), 0.95);
                tab.base.fillRoundedRect(-w * 0.28, -h / 2 + 3, w * 0.56, 3, 1.5);
            }
            // 黑花色在深色底上不能用牌面的墨色（cardInk 几乎看不见）：tab 上黑花色画成亮色、
            // 红花色仍是 cardRed。红黑不是唯一通道——四门轮廓两两可分（2c）
            tab.icon.setTint(ns.tint(tab.suit.red ? PALETTE.cardRed : PALETTE.text));
            tab.icon.setAlpha(active ? 1 : 0.66);
            tab.count.setColor(active ? PALETTE.text : PALETTE.textFaint);
        }

        function tabScale(tab, to, duration) {
            if (tab.scaleTween) { tab.scaleTween.stop(); }
            tab.scaleTween = scene.tweens.add({
                targets: tab.box, scaleX: to, scaleY: to,
                duration: duration, ease: 'Quad.easeOut',
                onComplete: function () { tab.scaleTween = null; }
            });
        }

        const tabRowW = suits.length * f.tabW + (suits.length - 1) * f.tabGap;
        const iconSize = Math.round(f.tabH * 0.46);
        const tabs = suits.map(function (s, i) {
            const x = -tabRowW / 2 + f.tabW / 2 + i * (f.tabW + f.tabGap);
            const base = scene.add.graphics();
            const icon = scene.add.image(-f.tabW * 0.18, 0, 'glyph-suit-' + s.id)
                .setDisplaySize(iconSize, iconSize);
            const count = ui.text(scene, f.tabW * 0.24, 0, '0', {
                fontSize: '12px', fontFamily: CONFIG.MONO, color: PALETTE.textDim
            });
            const box = scene.add.container(x, f.tabY, [base, icon, count]);
            const tab = {
                index: i, suit: s, box: box, base: base, icon: icon, count: count,
                hovered: false, armed: false, scaleTween: null
            };
            drawTab(tab);

            // input 常驻挂好，能不能点由 apply 按相位开关：呈现与隐藏阶段不接任何玩法入口
            box.setSize(f.tabW, f.tabH);
            // hitArea 用左上角为原点的纹理空间（Container 判定时会先加 displayOrigin），
            // 与 ui.button / 方阵格子同一套约定
            box.setInteractive({
                hitArea: new Phaser.Geom.Rectangle(0, 0, f.tabW, f.tabH),
                hitAreaCallback: Phaser.Geom.Rectangle.Contains,
                useHandCursor: true
            });
            box.input.enabled = false;
            box.on('pointerover', function () { tab.hovered = true; drawTab(tab); });
            box.on('pointerout', function () {
                tab.hovered = false;
                tab.armed = false;
                drawTab(tab);
                tabScale(tab, 1, 110);
            });
            box.on('pointerdown', function () {
                if (scene._smFading) { return; }
                tab.armed = true;
                tabScale(tab, 0.96, MOTION.press);
            });
            box.on('pointerup', function () {
                if (!tab.armed || scene._smFading) { return; }
                tab.armed = false;
                tabScale(tab, 1, 90);
                selectSuit(i);
            });
            return tab;
        });

        const cells = ns.RANKS.map(function (_, r) {
            // 点数行优先排两行（7 + 6，末行末列留空）：A–K 是玩家极熟的线性序列，
            // 两行横向扫一眼就完（harness/ui.md）
            const col = r % spec.cols;
            const row = Math.floor(r / spec.cols);
            const cx = -f.width / 2 + cellW / 2 + col * (cellW + f.gap);
            const cy = f.cellTop + row * (cellH + f.gap);
            // 柔光 ADD 混合，与方阵格子同一条（harness/ui.md 材质那条）：牌面是不透明的纸白，
            // 挡住的中间那段不参与合成，看得见的是溢出到牌外面那一圈
            const glow = scene.add.image(0, 0, 'glow')
                .setDisplaySize(cellW * 2.2, cellH * 1.7)
                .setTint(ns.tint(HEX))
                .setBlendMode(Phaser.BlendModes.ADD)
                .setAlpha(0);
            const kit = objects.cards.faceKit(scene, cellW, cellH);
            const mark = scene.add.graphics().setAlpha(0);
            const box = scene.add.container(cx, cy, [glow, kit.container, mark]);
            const cell = {
                rank: r, box: box, glow: glow, kit: kit, mark: mark,
                lit: false, bad: false, picked: false, accent: HEX,
                hovered: false, armed: false, glowTween: null, scaleTween: null
            };
            drawMark(cell);
            kit.paint(ns.CARDS[suit * perSuit + r]);

            box.setSize(cellW, cellH);
            box.setInteractive({
                hitArea: new Phaser.Geom.Rectangle(0, 0, cellW, cellH),
                hitAreaCallback: Phaser.Geom.Rectangle.Contains,
                useHandCursor: true
            });
            box.input.enabled = false;
            box.on('pointerover', function () {
                cell.hovered = true;
                if (box.input.enabled) { cell.glow.alpha = 0.18; }
            });
            box.on('pointerout', function () {
                cell.hovered = false;
                cell.armed = false;
                if (!cell.lit) { cell.glow.alpha = 0; }
                scaleTo(cell, 1, 110);
            });
            box.on('pointerdown', function () {
                if (scene._smFading) { return; }
                cell.armed = true;
                scaleTo(cell, 0.94, MOTION.press);
            });
            box.on('pointerup', function () {
                if (!cell.armed || scene._smFading) { return; }
                cell.armed = false;
                scaleTo(cell, 1, 90);
                // 提交的是整张牌的下标（花色 × 13 + 点数），与 CARDS / Judge 同一套
                opts.onTap(suit * perSuit + cell.rank);
            });
            return cell;
        });

        // 已选序列条（2i，harness/ui.md）：横排自己点过的那几张牌。它承担两件事——置灰总览
        //（选过的牌分散在四个花色面板里，没有这条就看不见）、全对波浪的载体（wave 扫这条不扫面板）。
        // 它是玩家自己的输入不是答案，不违反"不给内容提示"（harness/gameplay.md）。
        // 槽位建满预留的两行常驻（同"物件常驻"纪律，不随选牌数销毁重建），牌面走 faceKit——
        // 与点数格、中央呈现台、结算迷你回放同一份画法，四处不会漂移。
        // 不接输入：连 setInteractive 都不挂，所以也没有呼吸光（呼吸是"可以点"的暗示）
        const stripCap = f.stripRows * f.stripCols;
        const strip = Array.from({ length: stripCap }, function () {
            const glow = scene.add.image(0, 0, 'glow')
                .setDisplaySize(f.stripW * 2.2, f.stripH * 1.7)
                .setTint(ns.tint(HEX))
                .setBlendMode(Phaser.BlendModes.ADD)
                .setAlpha(0);
            const kit = objects.cards.faceKit(scene, f.stripW, f.stripH);
            const box = scene.add.container(0, 0, [glow, kit.container]);
            box.setAlpha(0).setVisible(false);
            return { box: box, glow: glow, kit: kit, card: null, shown: false, scaleTween: null };
        });

        // 新一张弹进来：淡入 + 弹一下，与点数格"亮起"同一条视觉语言（harness/ui.md）。
        // immediate 用于转屏 restart——重建之后直接落位，不给一串迟到的入场动画
        function stripIn(slot, immediate) {
            if (slot.scaleTween) { slot.scaleTween.stop(); }
            slot.scaleTween = null;
            // 淡入那条不单独记名，killTweensOf 一并收掉：上一次没走完的淡入不该和这一次叠在一起
            scene.tweens.killTweensOf(slot.box);
            slot.box.setVisible(true);
            slot.glow.setAlpha(0);
            if (immediate) {
                slot.box.setAlpha(1).setScale(1);
                return;
            }
            slot.box.setAlpha(0).setScale(1);
            scene.tweens.add({
                targets: slot.box, alpha: 1, duration: MOTION.litIn, ease: 'Quad.easeOut'
            });
            // 弹一下减少动效时砍掉，淡入保留（新牌出现是信息）
            if (!reduced) {
                slot.scaleTween = scene.tweens.add({
                    targets: slot.box, scaleX: 1.1, scaleY: 1.1,
                    duration: MOTION.pop / 2, ease: 'Back.easeOut', yoyo: true,
                    onComplete: function () { slot.scaleTween = null; }
                });
            }
        }

        // 收起来（换关 / 重开本局）：不动画，直接藏，并把挂在这一槽上的 tween 一并收掉——
        // 波浪可能还在半路上，留着会让下一轮的第一张牌自己闪一下
        function stripOut(slot) {
            if (slot.scaleTween) { slot.scaleTween.stop(); }
            slot.scaleTween = null;
            scene.tweens.killTweensOf(slot.box);
            scene.tweens.killTweensOf(slot.glow);
            slot.box.setAlpha(0).setScale(1).setVisible(false);
            slot.glow.setAlpha(0);
        }

        // 遮罩与方阵同一套：一层 scrim + 一行小字盖住玩法区，不是换一屏（harness/ui.md）
        const veilPanel = scene.add.graphics().setAlpha(0);
        veilPanel.fillStyle(ns.tint(PALETTE.overlay), 0.94);
        veilPanel.fillRoundedRect(-f.width / 2, -f.height / 2, f.width, f.height, Math.round(radius * 1.4));
        veilPanel.lineStyle(1, ns.tint(PALETTE.surfaceEdge), 0.5);
        veilPanel.strokeRoundedRect(-f.width / 2, -f.height / 2, f.width, f.height, Math.round(radius * 1.4));
        const veilText = ui.text(scene, 0, 0, '序列已遮住', {
            fontSize: '13px', color: PALETTE.textDim, letterSpacing: 2
        }).setAlpha(0);

        // 序列条排在最前（z 序最底）：它的柔光按 2.2 / 1.7 倍扩散，脉冲时会溢出到下方点数格上，
        // 让点数格与 tab 盖在光晕之上，溢出的那一圈就不糊在可点的东西上
        container.add(strip.map(function (slot) { return slot.box; })
            .concat(tabs.map(function (tab) { return tab.box; }))
            .concat(cells.map(function (cell) { return cell.box; }))
            .concat([veilPanel, veilText]));

        function paintFaces() {
            cells.forEach(function (cell) {
                cell.kit.paint(ns.CARDS[suit * perSuit + cell.rank]);
            });
        }

        // 切花色：13 格整组换面。内容**立刻**换（不是挤到 0 才换），挤压只是回响——
        // 这样换面动画被按下 / 亮起打断也不会留着旧花色的牌面，身份永远与 tab 一致
        function flipCells() {
            // 减少动效：内容在 paintFaces 已经立刻换好，挤压只是回响，整段砍掉
            if (reduced) { return; }
            cells.forEach(function (cell) {
                if (cell.scaleTween) { cell.scaleTween.stop(); }
                cell.box.setScale(1);
                cell.scaleTween = scene.tweens.add({
                    targets: cell.box, scaleX: 0, duration: MOTION.tab / 2, ease: 'Quad.easeIn',
                    onComplete: function () {
                        cell.scaleTween = scene.tweens.add({
                            targets: cell.box, scaleX: 1, duration: MOTION.tab / 2, ease: 'Quad.easeOut',
                            onComplete: function () { cell.scaleTween = null; }
                        });
                    }
                });
            });
        }

        // 点花色是导航不是提交（harness/gameplay.md）：不调 onTap、不进判定，点错没有代价
        function selectSuit(i) {
            if (i === suit) { return; }
            suit = i;
            paintFaces();
            apply(false);
            flipCells();
            ns.systems.Audio.play('ui');
        }

        // 全量推导：目标状态 = (最近一次 view, 当前花色)。sync 与切 tab 都走这里，
        // 不允许"只更新我记得的那一格"——漏更新在结构上不会出现（harness/ui.md）。
        // immediate 只在转屏 restart 之后的第一次同步为真：那一次直接落位，不放入场动画
        function apply(immediate) {
            const view = lastView;
            const picked = new Set(view.picked);
            const veilChanged = view.veil !== state.veil;
            state.veil = view.veil;
            state.interactive = view.interactive;

            tabs.forEach(function (tab) {
                let n = 0;
                picked.forEach(function (index) {
                    if (Math.floor(index / perSuit) === tab.index) { n += 1; }
                });
                tab.count.setText(String(n));
                tab.box.input.enabled = view.interactive;
                drawTab(tab);
            });

            cells.forEach(function (cell) {
                const index = suit * perSuit + cell.rank;
                const lit = !view.veil && view.lit === index;
                const bad = lit && view.verdict === 'bad';
                const accent = bad ? PALETTE.danger : HEX;
                const isPicked = picked.has(index) && (view.interactive || view.settled);
                cell.box.input.enabled = view.interactive && !picked.has(index);

                if (accent !== cell.accent) {
                    cell.accent = accent;
                    cell.bad = bad;
                    drawMark(cell);
                    cell.glow.setTint(ns.tint(accent));
                }
                if (isPicked !== cell.picked) {
                    cell.picked = isPicked;
                    // 置灰即关 input，Phaser 不保证补一次 pointerout：hover / 按下态自己收掉，
                    // 不然呼吸光会一直跳过这一格、armed 留着也会让下一次抬起误提交
                    if (isPicked) { cell.hovered = false; cell.armed = false; }
                    // 压暗置灰：牌面仍认得出，只是"选过了，不能再选"（2d 的判据）
                    scene.tweens.killTweensOf(cell.kit.container);
                    cell.kit.container.setAlpha(isPicked ? 0.35 : 1);
                }
                if (lit !== cell.lit) {
                    cell.lit = lit;
                    if (lit) {
                        fade(cell, cell.glow, 0.42, MOTION.litIn);
                        fade(cell, cell.mark, 1, MOTION.litIn);
                        // 弹一下与方阵格子同一个契约：1→1.08→1，静止态停在 1 才不发虚。减少动效时砍掉
                        if (!reduced) {
                            if (cell.scaleTween) { cell.scaleTween.stop(); }
                            cell.box.setScale(1);
                            cell.scaleTween = scene.tweens.add({
                                targets: cell.box, scaleX: 1.08, scaleY: 1.08,
                                duration: MOTION.pop / 2, ease: 'Back.easeOut', yoyo: true,
                                onComplete: function () { cell.scaleTween = null; }
                            });
                        }
                    } else {
                        fade(cell, cell.glow, 0, MOTION.litOut);
                        fade(cell, cell.mark, 0, MOTION.litOut);
                        scaleTo(cell, 1, 120);
                    }
                }
            });

            // 已选序列条（2i）：与置灰同一份数据、同一个判据（复现中或判定已定才露出来），
            // 只是同一份 view.picked 的另一个渲染出口——按点选顺序横排，不另存一份状态（纪律 2）。
            // 判定已定之后仍留着：全对的波浪扫的就是这条，点错时也要看得见自己选到哪儿了
            const picks = (view.interactive || view.settled) ? view.picked : NO_PICKS;
            // 超出预留的两行就只留最近的：关卡长度要先到 15 才碰得到这条上限，而那时波浪
            // 也早就扫不完 FEEDBACK.clear 那 640ms 了（harness/requirements.md2i 记的已知取舍）
            const from = Math.max(0, picks.length - stripCap);
            const rows = Math.max(1, Math.ceil((picks.length - from) / f.stripCols));
            strip.forEach(function (slot, i) {
                // 行优先，列落在点数格那一套栅格上；带子下沿钉住，行数变了整块往上长——
                // 接输入的 tab 与点数格因此不会因为序列条多了一行而跳位
                slot.box.setPosition(
                    -f.width / 2 + cellW / 2 + (i % f.stripCols) * (cellW + f.gap),
                    f.stripBottom - f.stripSlotH / 2
                        - (rows - 1 - Math.floor(i / f.stripCols)) * (f.stripSlotH + f.gap)
                );
                const at = from + i;
                if (at >= picks.length) {
                    if (slot.shown) {
                        slot.shown = false;
                        stripOut(slot);
                    }
                    return;
                }
                const index = picks[at];
                // 牌面只在换牌时重画：faceKit 换的是纹理与墨色（同 Stage 的 glyph 那条纪律）
                if (slot.card !== index) {
                    slot.card = index;
                    slot.kit.paint(ns.CARDS[index]);
                }
                if (!slot.shown) {
                    slot.shown = true;
                    stripIn(slot, immediate);
                }
            });

            if (veilChanged) {
                const duration = view.veil ? MOTION.veilIn : MOTION.veilOut;
                scene.tweens.killTweensOf(veilPanel);
                scene.tweens.killTweensOf(veilText);
                scene.tweens.add({ targets: veilPanel, alpha: view.veil ? 1 : 0, duration: duration, ease: 'Quad.easeOut' });
                scene.tweens.add({ targets: veilText, alpha: view.veil ? 1 : 0, duration: duration, ease: 'Quad.easeOut' });
                // 遮住时把呼吸光的残留一并收掉：tick 随相位停手，不补这一下柔光会停在半亮
                if (view.veil) {
                    cells.forEach(function (cell) { fade(cell, cell.glow, 0, MOTION.veilIn); });
                }
            }
        }

        function sync(view) {
            lastView = view;
            const immediate = fresh;
            if (fresh) {
                fresh = false;
                // 当前花色不进 session，但重建时可以从已输入推一个合理的默认：
                // 转屏之后玩家仍看着自己刚才选牌的那一门，一张都没选才是黑桃
                const picked = view.picked;
                if (picked.length) { suit = Math.floor(picked[picked.length - 1] / perSuit); }
                paintFaces();
            }
            apply(immediate);
        }

        // 复现待命的呼吸光：与方阵同一条契约，选过 / 亮着 / 有 tween / hover 的格停手
        function tick(time) {
            if (reduced || !state.interactive || state.veil) { return; }
            cells.forEach(function (cell) {
                if (cell.lit || cell.picked || cell.glowTween || cell.hovered) { return; }
                cell.glow.alpha = 0.05 + 0.04 * (0.5 + 0.5 * Math.sin(time / 900 + cell.rank * 1.7));
            });
        }

        // 点数格的位置四门共用（面板只换内容不换排布），所以哪怕亮着的那张不在当前面板，
        // 涟漪也落在它那一格该在的位置上
        function center(index) {
            const cell = cells[index % perSuit];
            return { x: container.x + cell.box.x, y: container.y + cell.box.y, size: cellW, hex: HEX };
        }

        // 隐藏→复现：当前花色的点数格依次轻"呼吸"一次示意可点（harness/ui.md）。
        // 只动柔光，yoyo 落回当前值；挂进 glowTween 让 tick 在这段期间停手
        function cue() {
            cells.forEach(function (cell, i) {
                if (cell.glowTween) { cell.glowTween.stop(); }
                cell.glowTween = scene.tweens.add({
                    targets: cell.glow, alpha: 0.3,
                    duration: 140, delay: reduced ? 0 : i * MOTION.wave, yoyo: true, ease: 'Sine.easeInOut',
                    onComplete: function () { cell.glowTween = null; }
                });
            });
        }

        // 全对波浪（2i）：按点选顺序在已选序列条上逐个脉冲——该被庆祝的是玩家自己选过的那几张，
        // 不是"哪几格被选过"（2h 留的那个空实现就是这个接口），所以不扫点数面板。
        // 仍是 transient 脉冲、不改 state：yoyo 落回当前值，玩家提前走时下一次 apply 的
        // stripOut 会把它们连物件一起收掉——状态永远赢（harness/ui.md）。
        // 逐格间隔仍是 MOTION.wave 70ms，与方阵的波浪同一个节拍
        function wave() {
            strip.forEach(function (slot, i) {
                if (!slot.shown) { return; }
                const delay = reduced ? 0 : i * MOTION.wave;
                scene.tweens.add({
                    targets: slot.glow, alpha: 0.55,
                    duration: MOTION.litIn, delay: delay, hold: 90, yoyo: true, ease: 'Quad.easeOut'
                });
                // 先停掉入场那一下并显式归 1：带 delay 的 tween 是在延迟走完那一刻才取起始值的，
                // 不归位就会把"弹到一半"当成静止态，yoyo 回来停在放大的一档
                if (slot.scaleTween) { slot.scaleTween.stop(); }
                slot.box.setScale(1);
                // 弹一下比格子的 1.08 大：牌面只有 28px 宽，1.08 看不出来。减少动效时砍掉
                if (!reduced) {
                    slot.scaleTween = scene.tweens.add({
                        targets: slot.box, scaleX: 1.16, scaleY: 1.16,
                        duration: MOTION.pop / 2, delay: delay, ease: 'Back.easeOut', yoyo: true,
                        onComplete: function () { slot.scaleTween = null; }
                    });
                }
            });
        }

        return { container: container, sync: sync, tick: tick, center: center, cue: cue, wave: wave };
    }

    // 外框几何开放给场景：适配可用空间时先量宽高再定边长，
    // 非正方形排布（数字键盘 / 选牌器）的高由这里给，场景不自己猜比例（harness/ui.md）
    objects.board.measure = function (typeId, size) {
        const spec = ns.BOARDS[typeId];
        return spec.kind === 'picker' ? pickerFrame(spec, size) : frame(spec, size);
    };
})(window.SequenceMemory = window.SequenceMemory || {});
