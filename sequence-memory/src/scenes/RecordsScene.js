(function (ns) {
    'use strict';

    const CONFIG = ns.CONFIG;
    const PALETTE = ns.PALETTE;
    const DEPTH = ns.DEPTH;
    const SCENES = ns.SCENES;
    const utils = ns.utils;
    const ui = utils.ui;
    const objects = ns.objects;
    const Setup = ns.systems.Setup;

    const TITLE = '记录';
    const LEAD = '本游戏成绩，只存在这台设备上。类型之间不互比，同一类型下三档也各算各的。';
    const LEAD_SHORT = '本游戏成绩 · 只存在这台设备上';
    const BEST_LABEL = '最高';
    // 页脚那句实话是 harness/gameplay.md 措辞红线点名要写在记录页脚的：任何一档排布都不砍它，
    // 装不下时砍的是卡片上的达成日期与数字字号
    const FOOT = '本页都是本游戏成绩，不做认知能力断言。分数上涨多半是练习效应，4–8 周进平台期是这个品类的常态。';
    // 曲线自己的标注（5c）：措辞红线要求曲线一律标"本游戏成绩"，页脚那句管的是整页，这一句管的是这块图
    const CHART_TITLE = '最近 ' + ns.HISTORY_LIMIT + ' 局 · 本游戏成绩';
    // 空态只说状态、不解释为什么没有（与卡片"无记录显示 –"同一条纪律）
    const CHART_EMPTY = '这一档还没有记录';

    // 历史最高数字的字号上下限：上限不让一张卡吃掉半屏，下限与结算回放格的 18px 同一条纪律
    //（再小就读不出是几位数了，宁可溢出也不缩到下限以下，harness/ui.md）
    const NUM_MAX = 38;
    const NUM_MIN = 18;

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    // 曲线默认画给"下一局要玩的那一档"：normalize 保证草稿正好落在一个玩法档上
    //（harness/architecture.md 已知坑），所以这里一定找得到
    function draftPreset() {
        const draft = Setup.draft();
        return ns.PRESETS.find(function (preset) {
            return preset.mode === draft.mode &&
                preset.direction === draft.direction &&
                preset.speed === draft.speed;
        }) || ns.PRESETS[0];
    }

    // 触控下限兜底，与首页 / 设置页出口同一个函数形状：胶囊与出口按钮都拿它当最小高度
    function controlHeight(view) {
        return Math.max(CONFIG.TOUCH_TARGET, Math.round(view.unit * 1.8));
    }

    // 达成日期用本地时区拼，不用 toISOString()：UTC 会把东八区的晚上显示成前一天
    function dateOf(at) {
        const date = new Date(at);
        const pad = function (value) { return value < 10 ? '0' + value : String(value); };
        return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
    }

    // 组合读数与首页 / 结算同一口径："每项 Nms" 不带速度档名（毫秒数本身就是速度信息）。
    // 档名用玩法档的名字（休闲 / 冲榜 / 挑战）而不是模式名——首页胶囊上写的就是它
    function comboText(entry) {
        const preset = entry.preset;
        return [
            preset.name,
            ns.directionById(preset.direction).name,
            '每项 ' + ns.speedById(preset.speed).show + 'ms'
        ].join(' · ');
    }

    // 累计读数。没玩过的档整行不画（无记录显示"–"、不解释为什么没有，harness/ui.md）；
    // 总错次与平均复现用时是 tie-break 的两个顺位（harness/gameplay.md），摆出来才看得出卡为什么这么排。
    // 常模那句（5d）挂在同一行末尾、不新开一行：卡仍然是两行（5b 的不变量没破），它与达成日期 /
    // 总错次 / 平均复现是同一类小字读数；顺带也便宜一点、更可退——新开一行是每张卡固定 +19px，
    // 挂在行里只在把第二行挤成第三行时 +15px，砍它是缩短一个字符串、第二行立刻收回去
    //（harness/ui.md 记录页）。"最高 N 项"不重复——大数字就在同一张卡的第一行，
    // "按最好一局算偏高"那句实话在页脚
    function metaLine(entry, withDate, withNorm) {
        const parts = [];
        if (withDate && entry.bestAt > 0) { parts.push('达成于 ' + dateOf(entry.bestAt)); }
        if (entry.errors > 0) { parts.push('总错次 ' + entry.errors); }
        if (entry.avg != null) { parts.push('平均复现 ' + (entry.avg / 1000).toFixed(1) + ' 秒/项'); }
        if (withNorm && entry.percentile != null) { parts.push('常模约在第 ' + entry.percentile + ' 百分位'); }
        return parts.join(' · ');
    }

    class RecordsScene extends Phaser.Scene {
        constructor() {
            super(SCENES.RECORDS);
        }

        create() {
            utils.applyRenderScale(this);
            utils.fadeIn(this);
            // 当前类型与选中的档都存场景实例字段，不走 scene data：转屏 restart 会把
            // settings.data 原样重放，data 里带"进页时那一份选择"就会冲掉玩家后来点的类型与卡片
            //（harness/architecture.md 已知坑）。实例跨 restart 复用，所以选择不会丢，
            // 只在第一次进来时从草稿播种一次。也不回写 Setup.draft——看记录不该偷偷改掉下一局的组合
            if (this._typeId == null) { this._typeId = Setup.draft().type; }
            if (this._presetId == null) { this._presetId = draftPreset().id; }
            this.paint(true);
            // Esc 返回是桌面增强不是前提："返回首页"才是主入口（8d 前纯指针可走通）。
            // tab 用 ui.chip 直接建而不是 ui.menu——ui.menu 内部会调 utils.bindKeys，
            // 而 bindKeys 一个场景只留一个 handler，两边都绑就会有一个被摘掉
            utils.bindKeys(this, (event) => {
                if (event.code === 'Escape') { this.back(); }
            });
        }

        // 换一次类型或换一张卡整块重画（AGENTS 界面纪律 2，与首页换档、设置页改开关同一条）：
        // 卡片内容与曲线全由 ScoreKeeper.typeBoard 推导，不做差异化更新。animate 只在进场景时为真
        paint(animate) {
            this.tweens.killAll();
            this.children.removeAll(true);

            const view = utils.layout(this);
            const backdrop = objects.backdrop(this, view);
            const board = ns.systems.scoreKeeper().typeBoard(this._typeId);
            // 常模标注（5d）跟着"这一页有没有常模"走，不跟着降级阶梯走：阶梯要先量页脚的高度才知道
            // 卡片有多少预算，页脚再等阶梯的结果就成了循环（harness/ui.md 记录页）。颜色 / 扑克两页
            // 一张卡都没有百分位，页脚一个字也不提常模
            const hasNorm = board.ranked.some((entry) => entry.percentile != null);
            // 曲线画给选中的那一张卡（5c）。typeBoard 把 PRESETS 三个档一个不少地交出来
            //（没玩过的也在，best 为 null），所以这里一定找得到
            const selected = board.ranked.concat(board.leisure)
                .find((entry) => entry.preset.id === this._presetId);
            const backTop = view.h - view.gutter - controlHeight(view);

            // 横屏不是竖屏的缩小版，是同一套构件换一种排布（harness/ui.md）：
            // 左列标题 + 总说明 + 曲线 + 页脚 + 返回钉底，右列类型 tab + 三张卡。
            // 曲线在左列不在右列：最紧的那一档横屏（480×320）右列只有 222px 宽，
            // 三张卡按最小排布就把预算吃完了，放右列等于在那一档视口上没有曲线
            if (!view.isPortrait) {
                const pair = Math.min(view.w - view.gutter * 2, 860);
                const left = Math.round(pair * 0.44);
                const right = pair - left - view.gutter;
                const leftX = view.cx - pair / 2 + left / 2;
                const rightX = view.cx + pair / 2 - right / 2;

                const headEnd = this.buildHead(leftX, left, view, view.gutter);
                this.buildBack(leftX, left, view, backTop);
                const foot = this.buildFoot(leftX, left, 0, this.normNote(left, hasNorm));
                const footTop = backTop - Math.round(view.unit * 0.6) - foot.height;
                foot.setY(footTop);

                const chartBudget = footTop - Math.round(view.unit * 0.6) - headEnd;
                // 块高的上下限从 objects.chartFit 取（内扣与缝都跟着 unit 走，写死一个下限
                // 会在大 unit 上被内扣吃光）；预算不够下限就整块不给
                const fit = objects.chartFit(view);
                if (chartBudget >= fit.min) {
                    this.buildChart(leftX, left, view, headEnd,
                        Math.min(fit.want, chartBudget), selected);
                }

                const tabsEnd = this.buildTabs(rightX, right, view, view.gutter);
                this.buildBoard(rightX, right, view, tabsEnd, board,
                    view.h - view.gutter - tabsEnd, selected, false);
            } else {
                const width = utils.contentWidth(view, 460);
                const headEnd = this.buildHead(view.cx, width, view, view.gutter);
                const tabsEnd = this.buildTabs(view.cx, width, view, headEnd);

                // 页脚排在钉底出口上面，卡片与曲线共用的预算到页脚为止（同结算回放的高度预算）
                this.buildBack(view.cx, width, view, backTop);
                const foot = this.buildFoot(view.cx, width, 0, this.normNote(width, hasNorm));
                const footTop = backTop - Math.round(view.unit * 0.6) - foot.height;
                foot.setY(footTop);

                this.buildBoard(view.cx, width, view, tabsEnd, board,
                    footTop - Math.round(view.unit * 0.6) - tabsEnd, selected, true);
            }

            // 背景不参与入场动画：它一动就会露出底色
            if (animate) {
                utils.riseIn(this, this.children.list.filter((object) => backdrop.indexOf(object) < 0), {
                    delay: 60, stagger: 6, distance: 12
                });
            }
        }

        buildHead(cx, width, view, y) {
            const title = ui.text(this, cx, y, TITLE, {
                fontSize: '22px', fontStyle: '600', letterSpacing: 5
            }).setOrigin(0.5, 0).setDepth(DEPTH.hud);
            // 窄列砍总说明的后半句（与首页类型行 verbose / 设置页说明行同一条取舍）
            const lead = ui.text(this, cx, y + title.height + 6, width >= 300 ? LEAD : LEAD_SHORT, {
                fontSize: '11px', color: PALETTE.textFaint, letterSpacing: 1,
                wordWrap: { width: width }
            }).setOrigin(0.5, 0).setDepth(DEPTH.hud);
            return y + title.height + 6 + lead.height + Math.round(view.unit * 0.8);
        }

        // 类型 tab = 分页（harness/gameplay.md：所有记录一律按类型分组，类型之间永不同屏比较）。
        // 不加"类型"行标签（白吃一行高度，最紧的那一档视口就爆了）；常态四枚排在同一行，
        // 装不下才换行——换行是兜底不是排布（harness/ui.md 记录页）
        buildTabs(cx, width, view, y) {
            const height = controlHeight(view);
            const gap = 6;
            const left = cx - width / 2;

            const chips = ns.TYPES.map((type) => ui.chip(this, {
                x: 0, y: 0, label: type.name,
                accent: PALETTE.dominantSoft,
                selected: type.id === this._typeId,
                // padX 收到 10：480×320 横屏的右列只有 222px，默认 12 的话四枚胶囊要 214px、
                // 差一点就换行，换行会再吃 50px 高度把卡片挤到下限以下
                height: height, fontSize: '13px', padX: 10,
                onSelect: () => this.pickType(type.id)
            }).setDepth(DEPTH.panel));

            let x = left;
            let row = y;
            chips.forEach((chip) => {
                if (x > left && x + chip.width > left + width) {
                    x = left;
                    row += height + gap;
                }
                chip.setPosition(x + chip.width / 2, row + height / 2);
                x += chip.width + gap;
            });

            return row + height + Math.round(view.unit * 0.5);
        }

        // 一个类型下的三张卡 + 选中那张卡的曲线（5c）：冲榜档按 tie-break 排好
        //（顺序在 ScoreKeeper.typeBoard 里定），休闲在分隔线下面单独一栏、不参与那个顺序。
        // 文字先建后量：装不下预算就按顺序降级——先砍达成日期，再缩数字到 NUM_MIN 为止，
        // 再砍常模那一句（5d，排在字号之后：字号是卡的门面，常模那句是近似参照），
        // 三级都到底还留不出曲线的最小块高才砍曲线（页脚与卡片一张都不砍）。
        // 曲线的高度**先**从预算里划出来、卡片拿剩下的去跑阶梯：反过来的话（卡片先吃满、
        // 曲线拿剩的），小屏上明明降一级字号就放得下的曲线会被砍掉。
        // withChart 为假 = 横屏，曲线归左列，右列这一块只排卡片
        buildBoard(cx, width, view, y, board, budget, selected, withChart) {
            const pad = Math.max(8, Math.round(view.unit * 0.55));
            const gap = Math.round(view.unit * 0.45);
            const dividerGap = Math.round(view.unit * 0.4);

            const items = [];
            [board.ranked, board.leisure].forEach((group, groupIndex) => {
                group.forEach((entry, index) => {
                    items.push({ entry: entry, divider: groupIndex > 0 && index === 0 });
                });
            });
            if (items.length === 0) { return y; }

            const natural = clamp(Math.round(view.unit * 1.6), NUM_MIN, NUM_MAX);
            let withDate = width >= 300;
            let withNorm = true;
            let numSize = natural;
            items.forEach((item) => { item.text = this.cardTexts(width, item.entry, pad, numSize); });

            const heightOf = function (item) {
                const text = item.text;
                const row = Math.max(text.readout.height, text.number.height);
                return pad * 2 + row + (text.metrics.text ? text.metrics.height + 4 : 0);
            };
            const totalOf = function () {
                return items.reduce(function (sum, item) {
                    return sum + heightOf(item) + (item.divider ? dividerGap * 2 + 1 : 0);
                }, 0) + gap * (items.length - 1);
            };
            // 降级只改文字与字号，不重建物件（同 Effects 池物件的 setFontSize 纪律）
            const apply = () => {
                items.forEach(function (item) {
                    item.text.metrics.setText(metaLine(item.entry, withDate, withNorm));
                    item.text.number.setFontSize(numSize);
                });
            };
            // 量一级排布要多高：withDate / numSize / withNorm 是阶梯上的三级旋钮，同一批物件量得出任何一级
            const measure = (date, size, norm) => {
                withDate = date;
                numSize = size;
                withNorm = norm;
                apply();
                return totalOf();
            };

            // 曲线先占位、卡片拿剩下的（阶梯从最宽松的一级重新起算；占位按**三级旋钮全关**量，
            // 于是"卡片在全最小排布下一定装得下剩下的预算"这条不变量与 5c 一样成立）。
            // 块高的下限与目标值都在 objects.chartFit 里，与画法共用一份口径
            const fit = objects.chartFit(view);
            const spare = withChart ? budget - gap - measure(false, NUM_MIN, false) : 0;
            const chartH = spare >= fit.min ? Math.min(fit.want, spare) : 0;
            const cardsBudget = chartH ? budget - chartH - gap : budget;

            measure(width >= 300, natural, true);
            while (totalOf() > cardsBudget && (withDate || numSize > NUM_MIN || withNorm)) {
                if (withDate) { withDate = false; }
                else if (numSize > NUM_MIN) { numSize -= 2; }
                else { withNorm = false; }
                apply();
            }

            let cursor = y;
            items.forEach((item) => {
                if (item.divider) {
                    cursor += dividerGap;
                    // 分隔线就是"休闲单独一栏"的全部表达，不加组标题：卡里的档名已经写了"休闲"
                    this.add.graphics().setDepth(DEPTH.board)
                        .lineStyle(1, ns.tint(PALETTE.surfaceEdge), 0.75)
                        .lineBetween(cx - width / 2, cursor, cx + width / 2, cursor);
                    cursor += dividerGap + 1;
                }
                cursor = this.placeCard(cx, width, item, cursor, pad, item.entry === selected) + gap;
            });
            cursor -= gap;

            if (chartH) { this.buildChart(cx, width, view, cursor + gap, chartH, selected); }
            return cursor;
        }

        // 曲线块：选中那张卡的最近 HISTORY_LIMIT 局 + 历史最高参考线。
        // 措辞在这里拼、画法在 objects/Chart.js（5b 那条口径：交出去的是数字，格式化归场景）
        buildChart(cx, width, view, y, height, entry) {
            objects.chart(this, {
                cx: cx,
                y: y,
                width: width,
                height: height,
                view: view,
                scores: entry.runs.map((run) => run.score),
                best: entry.best,
                title: CHART_TITLE,
                meta: comboText(entry),
                // best 为 null（没记录 / 最高是 0）时 Chart 不画参考线，也就不需要这个标签
                bestText: entry.best == null ? null : BEST_LABEL + ' ' + entry.best,
                emptyText: CHART_EMPTY
            });
        }

        // 一张卡的四件文字先建出来量高度，位置等降级定了再摆。readout 的换行宽按**最大**字号时的
        // 数字宽留位：降级只缩数字，缩完只会更宽松，不必回头重排 readout
        cardTexts(width, entry, pad, numSize) {
            const inner = width - pad * 2;
            const empty = entry.best == null;
            const number = ui.text(this, 0, 0, empty ? '–' : String(entry.best), {
                fontSize: numSize + 'px',
                fontStyle: '700',
                fontFamily: CONFIG.MONO,
                color: empty ? PALETTE.textFaint : PALETTE.text
            }).setOrigin(1, 0.5).setDepth(DEPTH.hud);
            const label = ui.text(this, 0, 0, BEST_LABEL, {
                fontSize: '10px', color: PALETTE.textFaint, letterSpacing: 1
            }).setOrigin(1, 0.5).setDepth(DEPTH.hud);
            const readout = ui.text(this, 0, 0, comboText(entry), {
                fontSize: '11px', fontFamily: CONFIG.MONO, color: PALETTE.textDim,
                wordWrap: { width: Math.max(60, inner - number.width - label.width - 12) }
            }).setOrigin(0, 0.5).setDepth(DEPTH.hud);
            const metrics = ui.text(this, 0, 0, '', {
                fontSize: '11px', fontFamily: CONFIG.MONO, color: PALETTE.textFaint,
                wordWrap: { width: inner }
            }).setOrigin(0, 0).setDepth(DEPTH.hud);
            return { number: number, label: label, readout: readout, metrics: metrics };
        }

        // 一张卡（5b 的排布 + 5c 的可选）：点它就把曲线换成这一档的。卡高 ≥ 57px，触控下限自然达标
        placeCard(cx, width, item, y, pad, selected) {
            const text = item.text;
            const left = cx - width / 2 + pad;
            const right = cx + width / 2 - pad;
            const row = Math.max(text.readout.height, text.number.height);
            const metricsH = text.metrics.text ? text.metrics.height + 4 : 0;
            const height = pad * 2 + row + metricsH;

            ui.card(this, cx, y + height / 2, width, height, {
                fillAlpha: 0.62,
                selected: selected,
                onSelect: () => this.pickPreset(item.entry.preset.id)
            }).setDepth(DEPTH.board);

            const rowY = y + pad + row / 2;
            text.readout.setPosition(left, rowY);
            text.number.setPosition(right, rowY);
            text.label.setPosition(right - text.number.width - 6, rowY);
            text.metrics.setVisible(!!metricsH);
            if (metricsH) { text.metrics.setPosition(left, y + pad + row + 4); }

            return y + height;
        }

        // 常模标注（5d）：窄列换短版，与卡片的达成日期、首页类型行 verbose 同一个阈值 300。
        // 标注可以变短，不能整句砍掉——砍掉标注的百分位就变成了一句结论（harness/gameplay.md 措辞红线）
        normNote(width, hasNorm) {
            if (!hasNorm) { return null; }
            return width >= 300 ? ns.NORMS_NOTE_BEST : ns.NORMS_NOTE_SHORT;
        }

        // 页脚一句都不砍（harness/ui.md）：常模标注是**追加**一段，不是替换原句
        buildFoot(cx, width, y, note) {
            return ui.text(this, cx, y, note ? FOOT + '\n' + note : FOOT, {
                fontSize: '11px', color: PALETTE.textFaint, lineSpacing: 3,
                wordWrap: { width: width }
            }).setOrigin(0.5, 0).setDepth(DEPTH.hud);
        }

        buildBack(cx, width, view, y) {
            const height = controlHeight(view);
            ui.button(this, {
                x: cx, y: y + height / 2, width: Math.min(width, 320), height: height,
                fontSize: '14px', padX: 18,
                label: '返回首页', accent: PALETTE.textFaint,
                onSelect: () => this.back()
            }).setDepth(DEPTH.panel);
        }

        back() {
            if (this._smFading) { return; }
            utils.fadeTo(this, SCENES.MENU);
        }

        // 点当前页不重画：画面不会变，重画只会白烧一遍纹理
        pickType(typeId) {
            if (this._smFading || typeId === this._typeId) { return; }
            this._typeId = typeId;
            this.paint(false);
        }

        // 换一张卡 = 换曲线（5c），同 pickType 一条路：整块重画，选中态与曲线都由 typeBoard 推导。
        // 选中的档跨类型保留（三个玩法档每个类型都有），换 tab 不必重选
        pickPreset(presetId) {
            if (this._smFading || presetId === this._presetId) { return; }
            this._presetId = presetId;
            this.paint(false);
        }
    }

    ns.scenes = ns.scenes || {};
    ns.scenes.RecordsScene = RecordsScene;
})(window.SequenceMemory = window.SequenceMemory || {});
