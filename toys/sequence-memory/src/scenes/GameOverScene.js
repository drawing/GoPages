(function (ns) {
    'use strict';

    const CONFIG = ns.CONFIG;
    const PALETTE = ns.PALETTE;
    const DEPTH = ns.DEPTH;
    const SCENES = ns.SCENES;
    const utils = ns.utils;
    const ui = utils.ui;
    const objects = ns.objects;
    const session = ns.systems.session;
    const Setup = ns.systems.Setup;

    // 三态的说法沿用 1c 在 DOM 里逐屏验过的那一套：missed 是"没点到"，不是"点错了"
    const VERDICT = { ok: '对', bad: '错', missed: '未输入' };
    // 免责底注压成一行（harness/ui.md）。曲线 / 技巧提示的去向只写在 harness，不上屏幕；
    // 历史最高与百分位都已上屏（5a / 5d，见 outcomeOf 与 referenceOf）
    const FOOT = '本页只说自己这一局的成绩，不做认知能力断言。';

    // 同组合历史最高读终局时冻进快照的提交结果（5a，GameScene.proceed 提交一次）：
    // previous 是开局前的最高，isRecord 是破纪录判定。不能在这里读 ScoreKeeper 活值——
    // 提交发生在进这一屏之前，活值已含本局，破纪录永远亮不起来。
    // 与 MenuScene 的 bestOf 同一份口径：最高为 0 视同没有，显示"–"不解释（harness/ui.md）
    function outcomeOf(last) {
        const outcome = last.record;
        const record = !!outcome && outcome.isRecord;
        const best = outcome ? (record ? outcome.previous : outcome.best) : 0;
        return { record: record, best: best > 0 ? best : null };
    }

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    // 结算的参照行（5d，harness/gameplay.md 反馈 ④）：冲榜档的 数字 / 位置 查常模百分位，
    // 其余（休闲 / 颜色 / 扑克）改"这一局在最近 N 局里排第 K 好"。两份数字都在 ScoreKeeper.submit
    // 里算完冻进快照——现读活值会读到别的局（与 best / isRecord 同一条理由，harness/architecture.md）。
    // 三种情况整块不给：0 分局（percentile 与 rank 都是 null）、破纪录且无常模（"第 1 好"与新纪录徽标、
    // 历史最高那行说的是同一件事，1m 那条"砍的只是重复句子"）、只有一局且无常模（rank 为 null）。
    // note 为真 = 这一行查了常模，得带近似标注；"历史第几好"是自己的成绩，没有近似可言
    function referenceOf(last) {
        const outcome = last.record || {};
        if (outcome.percentile != null) {
            return { line: '常模参照 · 这一局约在第 ' + outcome.percentile + ' 百分位', note: true };
        }
        if (outcome.isRecord || outcome.rank == null) { return null; }
        const span = '最近 ' + outcome.rankTotal + ' 局';
        return {
            line: outcome.rank === 1
                ? '历史参照 · 这一局是' + span + '里最好的成绩'
                : '历史参照 · 这一局在' + span + '里排第 ' + outcome.rank + ' 好',
            note: false
        };
    }

    // 组合读数读冻结快照里的那一档，不读里程碑之后的活值（session.speedNow）：
    // 组合键 = 类型 × 模式 × 方向 × 速度档，它是**记录身份**，休闲局内提了几档都不改这一条。
    // 所以同一局 HUD 与结算的 ms 数可以不同，这是有意的（harness/ui.md、harness/architecture.md 已知坑）
    function comboText(last) {
        return [last.type.name, last.mode.name, last.direction.name,
            '每项 ' + last.speed.show + 'ms'].join(' · ');
    }

    // 出口按钮的高度：钉底排布要先知道它多高，画按钮的地方也用它，两边不能各算一套
    function actionsHeight(view) {
        return Math.max(CONFIG.TOUCH_TARGET, Math.round(view.unit * 1.8));
    }

    class GameOverScene extends Phaser.Scene {
        constructor() {
            super(SCENES.GAME_OVER);
        }

        // 结算只读 session.finish() 冻住的那一份快照，不回读判定器（1c 的定案）。
        // create() 是这份快照的纯函数：转屏 restart 等于免费重排，素材一个不少
        create() {
            utils.applyRenderScale(this);
            utils.fadeIn(this);

            const last = session.last();
            // 刷新或直接落到这一屏时没有快照：回首页，别在一堆 last.xxx 上炸掉
            if (!last) {
                utils.fadeTo(this, SCENES.MENU);
                return;
            }

            const view = utils.layout(this);
            const wide = !view.isPortrait;
            const backdrop = objects.backdrop(this, view);

            if (wide) {
                // 横屏不是竖屏的缩小版，是同一套构件换一种排布（harness/gameplay.md）：
                // 左边成绩与出口，右边诊断与逐位回放
                const pair = Math.min(view.w - view.gutter * 2, 880);
                const left = Math.round(pair * 0.4);
                const right = pair - left - view.gutter;
                const leftX = view.cx - pair / 2 + left / 2;
                const rightX = view.cx + pair / 2 - right / 2;

                let y = view.gutter;
                y = this.buildHeader(leftX, left, view, y, last);
                y = this.buildScore(leftX, left, view, y, last);
                y = this.buildMetrics(leftX, left, view, y, last);
                this.buildActions(leftX, left, view, view.h - view.gutter - actionsHeight(view), last);

                let ry = view.gutter;
                ry = this.buildDiagnosis(rightX, right, view, ry, last, 0.5);
                // 参照行归右列（5d）：它的高度从回放预算里扣，装不下就是格子小一号，不会推出屏幕
                ry = this.buildReference(rightX, right, view, ry, last);
                // 回放的高度预算 = 到下留白为止再扣免责底注的预留（4d）：长序列在 320 高的横屏上
                // 会把图例与底注推出屏幕，装不下就缩格子边长而不是 overflow
                ry = this.buildPlayback(rightX, right, view, ry, last,
                    view.h - view.gutter - ry - Math.round(view.unit * 1.8));
                this.buildFoot(rightX, right, view, ry, 0.5);
            } else {
                const width = utils.contentWidth(view, 460);

                // 出口钉底，说明排在它上面：竖屏高（844）的时候中间留白，比整块顶在上方稳
                const actionY = view.h - view.gutter - actionsHeight(view);
                const foot = this.buildFoot(view.cx, width, view, 0, 0.5);
                const footTop = actionY - Math.round(view.unit * 0.6) - foot.height;
                foot.setY(footTop);

                let y = view.gutter;
                y = this.buildHeader(view.cx, width, view, y, last);
                y = this.buildScore(view.cx, width, view, y, last);
                y = this.buildReference(view.cx, width, view, y, last);
                y = this.buildMetrics(view.cx, width, view, y, last);
                y = this.buildDiagnosis(view.cx, width, view, y, last, 0.5);
                this.buildPlayback(view.cx, width, view, y, last);

                this.buildActions(view.cx, width, view, actionY, last);
            }

            // 背景不参与入场动画：它一动就会露出底色
            utils.riseIn(this, this.children.list.filter((object) => backdrop.indexOf(object) < 0), {
                delay: 60, stagger: 6, distance: 12
            });
        }

        buildHeader(cx, width, view, y, last) {
            ui.badge(this, cx, y + 12, '本局结束', PALETTE.danger).setDepth(DEPTH.hud);
            const combo = ui.text(this, cx, y + 34, comboText(last), {
                fontSize: '11px',
                fontFamily: CONFIG.MONO,
                color: PALETTE.textDim,
                wordWrap: { width: width }
            }).setDepth(DEPTH.hud);
            return y + 34 + combo.height / 2 + Math.round(view.unit * 0.7);
        }

        // 大字长度 + 数字滚动（harness/gameplay.md 反馈第 1 条）。大字是这一屏的绝对主角（harness/ui.md），
        // 其余读数全部压小给它让位。滚动是唯一的动效重点，转屏 restart 会再滚一次——
        // 重排等于重新入场，这里刻意不为它缓存"已经滚过了"
        buildScore(cx, width, view, y, last) {
            const size = clamp(Math.round(view.unit * (view.isPortrait ? 3.6 : 2.8)), 48, 96);
            const label = ui.text(this, cx, y + 8, '本局最大全对长度', {
                fontSize: '12px',
                color: PALETTE.textFaint,
                letterSpacing: 3
            }).setOrigin(0.5, 0).setDepth(DEPTH.hud);

            const value = ui.text(this, cx, y + 16 + label.height + size * 0.42, String(last.score), {
                fontSize: size + 'px',
                fontStyle: '700',
                fontFamily: CONFIG.MONO,
                color: last.score > 0 ? PALETTE.text : PALETTE.textDim,
                shadow: { offsetX: 0, offsetY: 4, color: PALETTE.skyTop, blur: 18, fill: true }
            }).setDepth(DEPTH.hud);

            // 减少动效（4b，harness/ui.md）：数字滚动砍掉、直接落值——成绩本身是信息，滚过去只是装饰
            if (last.score > 0 && !utils.reducedMotion()) {
                value.setText('0');
                // addCounter 只收一个 config 对象：1h 写成 addCounter(0, {...}) 时 0 被当成 config，
                // 真正的配置整个被丢弃，计数器按默认 0→1 空跑——1j 真机驱动时发现并修掉
                this.tweens.addCounter({
                    from: 0,
                    to: last.score,
                    duration: 620,
                    ease: 'Cubic.easeOut',
                    onUpdate: (tween) => value.setText(String(Math.round(tween.getValue())))
                });
            }

            let cursor = y + 16 + label.height + size * 0.84 + Math.round(view.unit * 0.35);

            // 破纪录要"明确庆祝"（harness/gameplay.md 反馈第 3 条）：判定与读数都来自终局那次提交
            const outcome = outcomeOf(last);
            const record = outcome.record;
            const best = outcome.best;
            if (record) {
                ui.badge(this, cx, cursor + 13, 'NEW RECORD · 新纪录', PALETTE.success).setDepth(DEPTH.hud);
                cursor += 26 + Math.round(view.unit * 0.3);
            }

            const bestLine = ui.text(this, cx, cursor, record
                ? '同组合历史最高 ' + best + '，这一局超过它 ' + (last.score - best) + ' 项'
                : '同组合历史最高 · ' + (best == null ? '–' : best), {
                fontSize: '11px',
                fontFamily: CONFIG.MONO,
                color: record ? PALETTE.success : PALETTE.textFaint,
                wordWrap: { width: width }
            }).setDepth(DEPTH.hud);

            return cursor + bestLine.height / 2 + Math.round(view.unit * 0.8);
        }

        // 参照一行 + 近似标注（5d，harness/ui.md 结算）：标注更小更淡，它是给愿意读的人读的，
        // 不该与数据抢视觉重量。窄列换短版（与记录页页脚、卡片达成日期同一个阈值 300）——
        // 标注可以变短，不能整句砍掉（harness/gameplay.md 措辞红线）。
        // **竖屏排在"同组合历史最高"下面**（gameplay 的 ③ → ④ 顺序）；**横屏归右列、排在诊断之后**：
        // 左列在最紧的两档横屏上只剩二十几 px 余量，多两行会压到出口按钮上，而右列本来就有
        // 回放的高度预算机制，多两行只是格子小一号
        buildReference(cx, width, view, y, last) {
            const reference = referenceOf(last);
            if (!reference) { return y; }

            const line = ui.text(this, cx, y, reference.line, {
                fontSize: '11px',
                fontFamily: CONFIG.MONO,
                color: PALETTE.textDim,
                wordWrap: { width: width }
            }).setOrigin(0.5, 0).setDepth(DEPTH.hud);
            let cursor = y + line.height + 3;

            if (reference.note) {
                const note = ui.text(this, cx, cursor, width >= 300 ? ns.NORMS_NOTE : ns.NORMS_NOTE_SHORT, {
                    fontSize: '10px',
                    color: PALETTE.textFaint,
                    wordWrap: { width: width }
                }).setOrigin(0.5, 0).setDepth(DEPTH.hud);
                cursor += note.height;
            }

            return cursor + Math.round(view.unit * 0.5);
        }

        // 指标压成一行小字（harness/ui.md）：得分只回答"到哪了"，这一行回答"停在哪、差在哪"。
        // 四个数据点一个不少，但从四张卡降为一行旁白——高度与视觉重量都让给大字和逐位回放
        buildMetrics(cx, width, view, y, last) {
            const wrong = last.wrongAt == null ? '–' : String(last.wrongAt + 1);
            const line = ui.text(this, cx, y, [
                '停在第 ' + last.index + ' 关',
                '该关长度 ' + last.length,
                '错在第 ' + wrong + ' 位',
                '已输入 ' + last.inputs.length + ' / ' + last.length
            ].join(' · '), {
                fontSize: '11px',
                fontFamily: CONFIG.MONO,
                color: PALETTE.textDim,
                wordWrap: { width: width }
            }).setOrigin(0.5, 0).setDepth(DEPTH.hud);

            return y + line.height + Math.round(view.unit * 0.8);
        }

        // 诊断只留一行（1m，harness/ui.md 结算文案）：错在第几位指标行已说，
        // 该点什么 / 你点了什么回放的 bad 列已画，"未输入不算错"图例 + 破折号已表达。
        // 规则解释（出错即停 / 得分口径）归"玩法"页，结算不再重复
        buildDiagnosis(cx, width, view, y, last, align) {
            const wrong = last.rows[last.wrongAt];
            // 符号名按类型查，ns.symbolName 是唯一的说法来源（harness/requirements.md2a）：颜色是"蓝（圆形）"，
            // 位置是"左上"——九格同色，只有方位名能说清错成了哪一格
            const typeId = last.type.id;
            const line = ui.text(this, cx, y, '第 ' + (last.wrongAt + 1) + ' 位：该点 ' +
                ns.symbolName(typeId, wrong.expected) + '，你点了 ' + ns.symbolName(typeId, wrong.actual), {
                fontSize: '12px',
                color: PALETTE.textDim,
                wordWrap: { width: width }
            }).setOrigin(align, 0).setDepth(DEPTH.hud);

            return y + line.height + Math.round(view.unit * 0.8);
        }

        // 逐位格子回放：上排正确序列、下排你的输入，按位置对齐成列（harness/requirements.md迁移边界表里
        // "ui.table 对照表 → 一排格子回放"）。对齐与三态全在 Judge.compare() 里算好、随快照冻住，
        // 这里只负责画。列数与格子边长都从 width 推，长序列自动换行，不写死像素。
        // availH 是横屏的高度预算（4d）：装不下就缩边长（下限 18），竖屏不给、行为不变
        buildPlayback(cx, width, view, y, last, availH) {
            const rows = last.rows;
            const colGap = Math.max(6, Math.round(view.unit * 0.22));
            const numH = 11;
            const innerGap = 4;

            // 先按"尽量两行装完"定边长，再据实际边长算每行几列：
            // 边长直接除宽度的话，短序列的格子会大到荒谬，长序列又会挤成一团
            const target = clamp(Math.ceil(rows.length / 2), 4, 16);
            let cell = clamp(Math.floor((width - (target - 1) * colGap) / target), 18, 38);
            let perLine;
            let lines;
            let lineGap;
            let blockH;
            const fit = () => {
                perLine = Math.max(1, Math.floor((width + colGap) / (cell + colGap)));
                lines = Math.ceil(rows.length / perLine);
                lineGap = Math.round(cell * 0.45);
                blockH = numH + cell * 2 + innerGap;
            };
            fit();

            // 关号与长度指标行已说，标题不再重复（1m）
            const head = ui.text(this, cx, y, '逐位对照', {
                fontSize: '12px',
                color: PALETTE.textFaint,
                letterSpacing: 1.4
            }).setDepth(DEPTH.hud);

            const top = y + head.height / 2 + Math.round(view.unit * 0.5);

            if (availH != null) {
                const budget = availH - (top - y) - (24 + Math.round(view.unit * 0.6));
                while (cell > 18 && lines * blockH + (lines - 1) * lineGap > budget) {
                    cell -= 2;
                    fit();
                }
            }

            rows.forEach((row, index) => {
                const line = Math.floor(index / perLine);
                const col = index % perLine;
                const count = Math.min(perLine, rows.length - line * perLine);
                const lineW = count * cell + (count - 1) * colGap;
                const x = cx - lineW / 2 + col * (cell + colGap) + cell / 2;
                const cy = top + line * (blockH + lineGap);

                this.buildCell(last.type.id, x, cy + numH + cell / 2, cell, row.expected, row.state, false);
                this.buildCell(last.type.id, x, cy + numH + cell + innerGap + cell / 2, cell, row.actual, row.state, true);

                // 位次压在小格子上限才给：格子只有 18px 时，数字比格子还宽，反而看不出是第几位
                if (cell >= 22) {
                    ui.text(this, x, cy + numH / 2, String(row.at + 1), {
                        fontSize: '9px',
                        fontFamily: CONFIG.MONO,
                        color: row.state === 'bad' ? PALETTE.danger : PALETTE.textFaint
                    }).setDepth(DEPTH.hud);
                }
            });

            let cursor = top + lines * blockH + (lines - 1) * lineGap + Math.round(view.unit * 0.5);

            // 图例各吃自己的状态色，与格子同一套颜色约定；三态不许只靠颜色（harness/ui.md 色觉友好那条）：
            // "未输入"用破折号而不是空格，"错"另有右上角折角，图例本身只是色键
            const legend = [
                { label: VERDICT.ok, color: PALETTE.success },
                { label: VERDICT.bad, color: PALETTE.danger },
                { label: VERDICT.missed, color: PALETTE.textFaint }
            ];
            const chips = legend.map((item) => ui.badge(this, 0, 0, item.label, item.color).setDepth(DEPTH.hud));
            const chipGap = Math.round(view.unit * 0.35);
            const total = chips.reduce((sum, chip) => sum + chip.width, 0) + chipGap * (chips.length - 1);
            let x = cx - total / 2;
            chips.forEach((chip) => {
                chip.setPosition(x + chip.width / 2, cursor + 12);
                x += chip.width + chipGap;
            });

            // 回放下的规则解释已删（1m）："按位置比、重复符号各点一次"归"玩法"页
            return cursor + 24 + Math.round(view.unit * 0.6);
        }

        // 一格 = 一个符号。input 为真时画的是玩家点的那一个：missed 没有输入，给一个破折号；
        // bad 的那一列整格描危险色 + 右上角折角，但符号本身仍按它自己的样子画——要看得出"错成了什么"。
        // 符号的画法按类型走 objects.symbols.mini（harness/requirements.md2a）：颜色画形状，位置画迷你九宫格只亮那一格
        buildCell(typeId, x, y, size, symbol, state, input) {
            const bad = state === 'bad';
            const missed = input && state === 'missed';
            const pad = Math.max(2, Math.round(size * 0.08));
            const box = size - pad * 2;
            const radius = Math.round(box * 0.2);

            const panel = this.add.graphics().setDepth(DEPTH.board);
            panel.fillStyle(ns.tint(bad ? PALETTE.danger : PALETTE.overlay), bad ? 0.2 : (missed ? 0.3 : 0.6));
            panel.fillRoundedRect(x - box / 2, y - box / 2, box, box, radius);
            panel.lineStyle(bad ? 1.6 : 1, ns.tint(bad ? PALETTE.danger : PALETTE.surfaceEdge), bad ? 0.95 : 0.6);
            panel.strokeRoundedRect(x - box / 2, y - box / 2, box, box, radius);

            if (missed) {
                ui.text(this, x, y, '—', {
                    fontSize: Math.round(size * 0.5) + 'px',
                    color: PALETTE.textFaint
                }).setDepth(DEPTH.hud);
                return;
            }

            // 形状纹理与局内 Board 共用 BootScene 烤的那一份，迷你九宫格是 Graphics 现画：
            // 两处画法都在 Symbols.js，结算这一屏不认类型
            objects.symbols.mini(this, typeId, symbol, x, y, Math.round(size * 0.52))
                .setAlpha(input && state === 'ok' ? 0.95 : 0.9)
                .setDepth(DEPTH.board);

            // "错"再给一条形状通道：右上角一个折角（4b，harness/ui.md 色觉友好那条——三态不许只靠颜色）。
            // 用折角不用 ✕ 角标：格子只有 18–38px，✕ 画在角内会压住符号（位置类型的迷你九宫格与
            // 扑克迷你牌面都吃满内框），画在角外会伸进 4–6px 的格缝撞邻格；折角吃的是格子自己的角，
            // 符号最多被盖住一个角（mini 档牌面的点数与花色都在中央），而且不需要按格子大小开关。
            // 顶点从圆角弧上起（不是数学角），折角才完全落在面板里、不出一根尖刺
            if (bad) {
                const cut = Math.max(3, Math.round(box * 0.28));
                const tip = radius * 0.3;
                this.add.graphics().setDepth(DEPTH.board)
                    .fillStyle(ns.tint(PALETTE.danger), 0.95)
                    .fillTriangle(
                        x + box / 2 - tip, y - box / 2 + tip,
                        x + box / 2, y - box / 2 + cut,
                        x + box / 2 - cut, y - box / 2
                    );
            }
        }

        buildActions(cx, width, view, y, last) {
            const height = actionsHeight(view);
            const gap = Math.round(view.unit * 0.4);
            const each = Math.floor((width - gap) / 2);
            // 窄列右侧读数让位（4d，与首页同一条截断纪律）：四字标签 + "同设置" / "回首页"
            // 放不下时砍读数，标签本身已说清去向。130 是标签 + 读数 + 内扣的实测下限
            const withMeta = each >= 130;
            const specs = [
                {
                    label: '再来一局',
                    meta: '同设置',
                    accent: PALETTE.success,
                    // 沿用这一局的快照，不回读全局设置（AGENTS 界面纪律 1）。
                    // snapshot() 会归一并给一份新对象，于是下一局改不到这份冻住的素材
                    onSelect: () => this.replay(last)
                },
                {
                    label: '换个玩法',
                    meta: '回首页',
                    accent: PALETTE.dominantSoft,
                    // 选设置屏已删（harness/requirements.md1l）：换玩法就是回首页，玩法档与四种类型都在那里。
                    // 先把这一局的快照写回草稿（1d / 1f 的定案不变），首页据此高亮档与类型
                    onSelect: () => this.changeSetup(last)
                }
            ];

            specs.forEach((spec, index) => ui.button(this, {
                x: cx - width / 2 + each / 2 + index * (each + gap),
                y: y + height / 2,
                width: each,
                height: height,
                fontSize: '15px',
                padX: 16,
                label: spec.label,
                meta: withMeta ? spec.meta : null,
                accent: spec.accent,
                onSelect: spec.onSelect
            }).setDepth(DEPTH.panel));
        }

        buildFoot(cx, width, view, y, align) {
            return ui.text(this, cx, y, FOOT, {
                fontSize: '11px',
                color: PALETTE.textFaint,
                wordWrap: { width: width }
            }).setOrigin(align, 0).setDepth(DEPTH.hud);
        }

        replay(last) {
            if (this._smFading) { return; }
            session.start(Setup.snapshot(last.settings));
            utils.fadeTo(this, SCENES.GAME);
        }

        changeSetup(last) {
            if (this._smFading) { return; }
            Setup.use(last.settings);
            utils.fadeTo(this, SCENES.MENU);
        }
    }

    ns.scenes = ns.scenes || {};
    ns.scenes.GameOverScene = GameOverScene;
})(window.SequenceMemory = window.SequenceMemory || {});
