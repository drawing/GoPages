(function (ns) {
    'use strict';

    const CONFIG = ns.CONFIG;
    const PALETTE = ns.PALETTE;
    const DEPTH = ns.DEPTH;
    const SCENES = ns.SCENES;
    const utils = ns.utils;
    const ui = utils.ui;
    const objects = ns.objects;

    const TITLE = '玩法';
    const LEAD = '全部规则在这一页，局内与结算不再重复。';
    const LEAD_SHORT = '全部规则在这一页';

    // 7 改判：静态规则页，不做可玩脚本关、不做首次强制拦截（harness/requirements.md）。
    // 承接全部规则长解释——1m 把它们从结算搬走、局内短提示也不许带规则，账都记在这一页。
    // 四枚胶囊分页（与记录页类型分页同一种构件）：四类型 × 两模式 × 两方向的规则分布在这四页，
    // 一页的正文量才装得进最紧的横屏（480×320）。文案是内容不是数据表：加类型要连正文一起写，
    // 与首页 LEAD / 记录页 FOOT 同一条口径，留在场景里。纯静态页零逻辑，不新增测试（AGENTS 测试边界）
    const TABS = [
        {
            id: 'round', label: '规则',
            sections: [
                {
                    head: '三段相位',
                    body: '呈现：序列逐项闪现（位置类型直接在棋盘上点亮），这时只能看。隐藏：序列遮住，点「开始复现」决定什么时候开始。复现：按顺序点回来。不限时，没有倒计时催你。'
                },
                {
                    head: '点错即终',
                    body: '点对一项进一项；点错这一局立刻结束——不能撤销，没有重试，错了再来一局就好。每全对一关，长度 +1，进入下一关。'
                },
                {
                    head: '得分',
                    body: '得分 = 本局全对过的最大长度，点错的那一关不算。起始长度 2；休闲可在设置页调 2–4，冲榜与挑战固定 2。'
                }
            ]
        },
        {
            id: 'preset', label: '玩法档',
            sections: [
                {
                    head: '休闲 · 累积追加',
                    body: '每轮重播整段旧序列，末尾新增 1 项。长度到 5 / 9 / 13 各提速一档：顶条毫秒读数变小，跨档那一关说一次「提速」。重播允许复述，分数随练习膨胀，记录单独一栏不与冲榜混。'
                },
                {
                    head: '冲榜 · 每关独立',
                    body: '每关全新随机序列，长度就是关卡数。速度固定，局内不提速——记录与排行只从这里来。'
                },
                {
                    head: '挑战 · 倒序 · 快',
                    body: '呈现仍正序，复现从最后一项倒着点回来：第一下该点呈现的最后一项。倒序只在挑战档，不进休闲。速度由玩法档决定，不是自由选项。'
                }
            ]
        },
        {
            id: 'type', label: '类型',
            sections: [
                {
                    head: '颜色 · 4 个符号',
                    body: '四色各配固定形状（圆 / 方 / 三角 / 菱），中央闪现，复现点四色块。认形状不靠颜色。'
                },
                {
                    head: '位置 · 9 个符号',
                    body: '3×3 九宫格，在棋盘上点亮、按序点格。唯一在棋盘上呈现的类型。'
                },
                {
                    head: '数字 · 10 个符号',
                    body: '0–9 中央闪现，复现点电话键盘，0 在末行正中。'
                },
                {
                    head: '扑克 · 52 张',
                    body: '中央逐张翻牌。复现两步：点花色只切面板，不算提交；点点数格才判定。一副牌无放回，选过的置灰不可再选。'
                }
            ]
        },
        {
            id: 'record', label: '记录',
            sections: [
                {
                    head: '暂停与放弃',
                    body: '局内随时可暂停，呈现阶段暂停会把序列一起遮住。暂停里「回首页」是放弃本局，不进记录——只有走完结算的局才进记录。'
                },
                {
                    head: '本地记录',
                    body: '记录只存在这台设备上，按 类型 × 玩法档 分开存，不同组合不互比。记录页能看每档的历史最高与最近 20 局曲线，都是本游戏成绩。'
                },
                {
                    head: '全局偏好',
                    body: '设置页的音效 / 音调 / 起始长度 / 进度点下一局生效，局中改不了。'
                }
            ]
        }
    ];

    // 触控下限兜底，与首页 / 设置页 / 记录页同一个函数形状
    function controlHeight(view) {
        return Math.max(CONFIG.TOUCH_TARGET, Math.round(view.unit * 1.8));
    }

    class HowToScene extends Phaser.Scene {
        constructor() {
            super(SCENES.HOW_TO);
        }

        create() {
            utils.applyRenderScale(this);
            utils.fadeIn(this);
            // 当前页存场景实例字段，不传 data：转屏 restart 会把 settings.data 原样重放，
            // data 里带"进页时那一页"就会冲掉玩家后来点的页（与记录页同一条已知坑）。
            // 实例跨 restart 复用，只在第一次进来时播种默认页
            if (this._tabId == null) { this._tabId = TABS[0].id; }
            this.paint(true);
            // Esc 返回是桌面增强不是前提："返回首页"才是主入口（8d 前纯指针可走通）。
            // 胶囊用 ui.chip 直接建而不是 ui.menu——bindKeys 一个场景只留一个 handler
            utils.bindKeys(this, (event) => {
                if (event.code === 'Escape') { this.back(); }
            });
        }

        // 换一页整块重画（AGENTS 界面纪律 2，与记录页换类型同一条）：正文全由 TABS 推导，
        // 不做差异化更新。animate 只在进场景时为真，换页不重放入场动画
        paint(animate) {
            this.tweens.killAll();
            this.children.removeAll(true);

            const view = utils.layout(this);
            const backdrop = objects.backdrop(this, view);
            const tab = TABS.find((item) => item.id === this._tabId) || TABS[0];
            const backTop = view.h - view.gutter - controlHeight(view);

            // 横屏同构件换排布：左列标题 + 总说明 + 返回钉底，右列胶囊 + 正文。
            // 左列取 0.38（其余菜单页 0.44）：这一页左列只有标题与返回，没有曲线也没有偏好行，
            // 收窄让宽给正文——480×320 的右列从 222 变 248，正文行数少一档（harness/ui.md）
            if (!view.isPortrait) {
                const pair = Math.min(view.w - view.gutter * 2, 860);
                const left = Math.round(pair * 0.38);
                const right = pair - left - view.gutter;
                const leftX = view.cx - pair / 2 + left / 2;
                const rightX = view.cx + pair / 2 - right / 2;
                this.buildHead(leftX, left, view, view.gutter);
                this.buildBack(leftX, left, view, backTop);
                const tabsEnd = this.buildTabs(rightX, right, view, view.gutter);
                this.buildSections(rightX, right, view, tabsEnd, tab, view.h - view.gutter - tabsEnd);
            } else {
                const width = utils.contentWidth(view, 460);
                const headEnd = this.buildHead(view.cx, width, view, view.gutter);
                const tabsEnd = this.buildTabs(view.cx, width, view, headEnd);
                this.buildBack(view.cx, width, view, backTop);
                this.buildSections(view.cx, width, view, tabsEnd, tab,
                    backTop - Math.round(view.unit * 0.6) - tabsEnd);
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
            // 窄列砍总说明的后半句（与记录页 LEAD / LEAD_SHORT 同一条取舍）
            const lead = ui.text(this, cx, y + title.height + 6, width >= 300 ? LEAD : LEAD_SHORT, {
                fontSize: '11px', color: PALETTE.textFaint, letterSpacing: 1,
                wordWrap: { width: width }
            }).setOrigin(0.5, 0).setDepth(DEPTH.hud);
            return y + title.height + 6 + lead.height + Math.round(view.unit * 0.8);
        }

        // 四枚胶囊 = 四页规则。padX 收 8：四枚 ≥44 的胶囊一行 206px，最紧的横屏右列（248px）
        // 放得下；换行是兜底不是排布——换行再吃 50px 高度会把正文压到降级下限以下
        buildTabs(cx, width, view, y) {
            const height = controlHeight(view);
            const gap = 6;
            const left = cx - width / 2;

            const chips = TABS.map((item) => ui.chip(this, {
                x: 0, y: 0, label: item.label,
                accent: PALETTE.dominantSoft,
                selected: item.id === this._tabId,
                height: height, fontSize: '13px', padX: 8,
                onSelect: () => this.pickTab(item.id)
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

        // 一页的正文 = 若干节"小标题 + 一段正文"，左对齐。文字先建后量，装不下预算按顺序降级：
        // 字号 12→11 → 行距 4→2 → 节距收紧 → 标题缝收紧（同记录页"降级只改文字不重建物件"那条）。
        // 标准视口（含 480×320 横屏）在下限之上装得下；更荒谬的视口宁可溢出也不缩到下限以下
        buildSections(cx, width, view, y, tab, budget) {
            const left = cx - width / 2;
            const items = tab.sections.map((section) => ({
                head: ui.text(this, left, 0, section.head, {
                    fontSize: '12px', fontStyle: '600', color: PALETTE.text, letterSpacing: 1
                }).setOrigin(0, 0).setDepth(DEPTH.hud),
                body: ui.text(this, left, 0, section.body, {
                    fontSize: '12px', color: PALETTE.textDim, lineSpacing: 4,
                    wordWrap: { width: width }
                }).setOrigin(0, 0).setDepth(DEPTH.hud)
            }));

            let bodySize = 12;
            let lineSpacing = 4;
            let headGap = 3;
            let gap = Math.round(view.unit * 0.45);
            const gapMin = Math.max(4, Math.round(view.unit * 0.2));
            const totalOf = () => items.reduce((sum, item) =>
                sum + item.head.height + headGap + item.body.height, 0) + gap * (items.length - 1);
            const apply = () => items.forEach((item) => {
                item.body.setFontSize(bodySize);
                item.body.setLineSpacing(lineSpacing);
            });

            while (totalOf() > budget && (bodySize > 11 || lineSpacing > 2 || gap > gapMin || headGap > 2)) {
                if (bodySize > 11) { bodySize = 11; }
                else if (lineSpacing > 2) { lineSpacing = 2; }
                else if (gap > gapMin) { gap = gapMin; }
                else { headGap = 2; }
                apply();
            }

            let cursor = y;
            items.forEach((item, index) => {
                if (index > 0) { cursor += gap; }
                item.head.setY(cursor);
                cursor += item.head.height + headGap;
                item.body.setY(cursor);
                cursor += item.body.height;
            });
            return cursor;
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

        // 点当前页不重画：画面不会变，重画只会白烧一遍纹理（与记录页 pickType 同一条）
        pickTab(tabId) {
            if (this._smFading || tabId === this._tabId) { return; }
            this._tabId = tabId;
            this.paint(false);
        }
    }

    ns.scenes = ns.scenes || {};
    ns.scenes.HowToScene = HowToScene;
})(window.SequenceMemory = window.SequenceMemory || {});