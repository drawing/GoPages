(function (ns) {
    'use strict';

    const CONFIG = ns.CONFIG;
    const PALETTE = ns.PALETTE;
    const DEPTH = ns.DEPTH;
    const objects = ns.objects = ns.objects || {};
    const ui = ns.utils.ui;

    // 刻度步长：1 / 2 / 5 的十倍进位里挑最小的那一档，让格子数不超过四格
    function tickStep(top) {
        const steps = [1, 2, 5, 10, 20, 50, 100];
        return steps.find(function (step) { return top / step <= 4; }) || 100;
    }

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    // 内扣与缝跟记录页的卡同一套推法（都从 unit 来，场景里不写死像素）
    function padOf(view) { return Math.max(8, Math.round(view.unit * 0.55)); }
    function gapOf(view) { return Math.max(6, Math.round(view.unit * 0.3)); }

    // 图位（画曲线那一块，不含标题与内扣）的上下限：下限再矮就看不出趋势、不如整块不给，
    // 上限不让一块图吃掉半屏（与卡片 NUM_MAX 同一条取舍）
    const PLOT_MIN = 30;
    const PLOT_MAX = 96;
    // 11px 标题行的高。Chart 里量出来的实际值会差 1–2px，那点差由图位吸收
    const TITLE_H = 15;

    // 曲线块的预算口径：块高 = 内扣 ×2 + 标题 + 缝 + 图位，前三项都从 unit 推，所以"块高下限"
    // 不是一个常量——写死一个 76 的话，大 unit 上光内扣就吃掉 48，图位只剩几 px。
    // 场景按它算预算、objects.chart 按它摆图，两边共用这一份，不会各算一套
    objects.chartFit = function (view) {
        const chrome = padOf(view) * 2 + gapOf(view) + TITLE_H;
        return {
            min: chrome + PLOT_MIN,
            want: chrome + clamp(Math.round(view.unit * 2.6), PLOT_MIN, PLOT_MAX)
        };
    };

    function dashedLine(graphics, x1, x2, y, dash, gap) {
        for (let x = x1; x < x2; x += dash + gap) {
            graphics.lineBetween(x, y, Math.min(x2, x + dash), y);
        }
    }

    // 最近 N 局曲线（5c，harness/ui.md 记录页）：手绘折线，不引图表库（harness/architecture.md）。
    // 一块 = 卡 + 一行标题（左"最近 20 局 · 本游戏成绩"，右组合读数）+ 图。
    //
    // **横轴是固定的 HISTORY_LIMIT 个槽位、从左端起**：局数不满时曲线往右长（"曲线正确增长"），
    // 满 20 局之后每来一局整条左移一格（"超 20 局左滚"）。比例尺不随局数变，所以两次打开页面
    // 看到的斜率是同一个斜率；右边空出来的地方是还没打的局，不是 bug。
    //
    // 纵轴 0 起，顶就是"最近局里的最高 / 历史最高"中较大的那个（不取整，顶上那个数字得是玩家
    // 真打出过的成绩）；中间刻度按 1 / 2 / 5 的十倍进位挑，一格不足 14px 时只留两端。
    // 历史最高画成**虚线参考线 + 数字标签**：与实线曲线的差别在虚实与标签上，不只靠颜色
    //（harness/ui.md 色觉友好那条）。
    //
    // 措辞与格式化归调用方（5b 那条口径：systems 交数字、场景拼句子），title / meta / bestText /
    // emptyText 都是现成字符串，这里只管摆。opts = { cx, y, width, height, view, scores, best,
    // title, meta, bestText, emptyText }
    objects.chart = function (scene, opts) {
        const view = opts.view;
        const width = opts.width;
        const height = opts.height;
        const left = opts.cx - width / 2;
        const top = opts.y;
        const pad = padOf(view);
        const gap = gapOf(view);
        const scores = opts.scores;
        const container = scene.add.container(0, 0).setDepth(DEPTH.hud);

        const card = ui.card(scene, opts.cx, top + height / 2, width, height, { fillAlpha: 0.5 });
        const plot = scene.add.graphics();
        const texts = [];

        const title = ui.text(scene, left + pad, top + pad, opts.title, {
            fontSize: '11px', color: PALETTE.textFaint, letterSpacing: 1
        }).setOrigin(0, 0);
        texts.push(title);

        const inner = width - pad * 2;
        if (opts.meta) {
            // 组合读数放右边，放不下就让位（与首页 / 结算窄列右侧读数同一条截断纪律）：
            // 标题那句"本游戏成绩"是措辞红线点名要的，让位的只能是读数
            const meta = ui.text(scene, left + width - pad, top + pad, opts.meta, {
                fontSize: '11px', fontFamily: CONFIG.MONO, color: PALETTE.textDim
            }).setOrigin(1, 0);
            meta.setVisible(title.width + meta.width + 12 <= inner);
            texts.push(meta);
        }

        const plotTop = top + pad + title.height + gap;
        const plotBottom = top + height - pad;
        const plotH = plotBottom - plotTop;

        // 这一档一局都没有：标题照画（说明这块是什么），图位一行说明状态。
        // 不解释为什么没有，与卡片"无记录显示 –"同一条纪律（harness/ui.md）
        if (!scores.length) {
            texts.push(ui.text(scene, opts.cx, (plotTop + plotBottom) / 2, opts.emptyText, {
                fontSize: '11px', color: PALETTE.textFaint
            }));
            container.add([card, plot].concat(texts));
            return;
        }

        const best = opts.best;
        // 纵轴顶 = 最近局里的最高与历史最高中较大的那个，**不向上取整到"漂亮"的刻度**：
        // 顶上那个数字应当是玩家真打出过的成绩，取整会画出一个谁都没打到过的 8 当参照
        const topValue = Math.max(best || 0, Math.max.apply(null, scores), 1);
        const step = tickStep(topValue);
        // 0 与顶恒在（基线与"你打到过几"是这块图的两个端点），中间刻度按步长补：
        // 一格不足 14px 就只留两端，小图里密刻度是噪点不是信息（9px 的数字会叠在一起）
        const ticks = [0];
        if (plotH / Math.ceil(topValue / step) >= 14) {
            for (let value = step; value < topValue; value += step) { ticks.push(value); }
            // 顶与最后一条中间刻度挨得太近时砍掉中间那条，两个数字叠着就都读不出了
            if (ticks.length > 1 && topValue - ticks[ticks.length - 1] < step * 0.6) { ticks.pop(); }
        }
        ticks.push(topValue);

        // 刻度标签先建后量：纵轴那道留白宽由最宽的那个数字决定，不写死像素
        const labels = ticks.map(function (value) {
            const label = ui.text(scene, 0, 0, String(value), {
                fontSize: '9px', fontFamily: CONFIG.MONO, color: PALETTE.textFaint
            }).setOrigin(1, 0.5);
            texts.push(label);
            return { value: value, label: label };
        });
        const gutter = labels.reduce(function (max, item) {
            return Math.max(max, item.label.width);
        }, 0) + 6;
        const plotLeft = left + pad + gutter;
        const plotRight = left + width - pad;
        const plotW = plotRight - plotLeft;
        const yOf = function (value) { return plotBottom - (value / topValue) * plotH; };

        plot.fillStyle(ns.tint(PALETTE.overlay), 0.3);
        plot.fillRect(plotLeft, plotTop, plotW, plotH);

        // 0 那条是基线，比其余刻度实一点：曲线落在 0 上时（打出过 0 分的局）要看得出它是"贴着底"
        labels.forEach(function (item) {
            const y = Math.round(yOf(item.value));
            plot.lineStyle(1, ns.tint(PALETTE.surfaceEdge), item.value === 0 ? 0.5 : 0.24);
            plot.lineBetween(plotLeft, y, plotRight, y);
            item.label.setPosition(plotLeft - 6, y);
        });

        if (best != null) {
            const y = Math.round(yOf(best));
            plot.lineStyle(1.4, ns.tint(PALETTE.warning), 0.8);
            dashedLine(plot, plotLeft, plotRight, y, 5, 4);
            // 标签贴线的右端上方；线贴近图顶时往下压，别把字推出卡外
            texts.push(ui.text(scene, plotRight, Math.max(plotTop + 12, y - 4), opts.bestText, {
                fontSize: '10px', fontFamily: CONFIG.MONO, color: PALETTE.warning
            }).setOrigin(1, 1));
        }

        const slotW = plotW / (ns.HISTORY_LIMIT - 1);
        const points = scores.map(function (score, index) {
            return { x: plotLeft + index * slotW, y: yOf(score) };
        });

        plot.lineStyle(2, ns.tint(PALETTE.dominantSoft), 0.95);
        plot.beginPath();
        points.forEach(function (point, index) {
            if (index) { plot.lineTo(point.x, point.y); } else { plot.moveTo(point.x, point.y); }
        });
        plot.strokePath();

        // 点必画：只有一局时折线一段都没有，那个点就是"你打过一局"的全部证据。
        // 最近一局大一号并用亮色——大小是形状通道，不只靠颜色（harness/ui.md）
        points.forEach(function (point, index) {
            const last = index === points.length - 1;
            plot.fillStyle(ns.tint(last ? PALETTE.text : PALETTE.dominantSoft), 1);
            plot.fillCircle(point.x, point.y, last ? 3.2 : 2.2);
        });

        container.add([card, plot].concat(texts));
    };
})(window.SequenceMemory = window.SequenceMemory || {});
