(function (ns) {
    'use strict';

    const CONFIG = ns.CONFIG;
    const PALETTE = ns.PALETTE;
    const DEPTH = ns.DEPTH;
    const MOTION = ns.MOTION;
    const SCENES = ns.SCENES;
    const utils = ns.utils;
    const ui = utils.ui;
    const objects = ns.objects;
    const session = ns.systems.session;
    const audio = ns.systems.Audio;
    const DANGER = Phaser.Display.Color.HexStringToColor(PALETTE.danger);

    // 局内只旁白状态，一行短提示（harness/ui.md）。长解释全部归"玩法"页（7），
    // 长度 n 不写进句子——HUD 的大字与进度点已经表达了
    const COPY = {
        lead: '准备',
        present: '记住顺序',
        hidden: '该你了',
        recall: '按顺序点回来',
        // 倒序局的 recall 改说这句（harness/ui.md）：呈现仍正序，复现从最后一项点起。
        // 方向的常驻保险在 HUD 读数里，这句是动手前最后一次提醒
        recallBack: '倒着点回来',
        cleared: '全对，长度 +1',
        failed: '点错了',
        // 休闲跨过里程碑的那一关，lead 改说这句（harness/ui.md）：说的是"发生了什么"不是规则，
        // 一关只说一次，第一项亮起来就回到 COPY.lead
        speed: '提速'
    };

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    // 玩法区按宽高两个维度适配可用矩形：先按宽定边长，高由 Board.measure 给
    // （方阵宽高相等、数字键盘 3 列 4 行、选牌器是两行 5:7 的点数格 + 钉底 tab 行），
    // 装不下就按比例缩（harness/ui.md）。下限仍兜底：极小视口宁可溢出也不缩到下限以下
    function fitBoard(typeId, spec, availW, availH, cap) {
        let size = clamp(availW, spec.min, cap);
        const f = objects.board.measure(typeId, size);
        if (f.height > availH) {
            size = clamp(Math.floor(size * availH / f.height), spec.min, cap);
        }
        return size;
    }

    class GameScene extends Phaser.Scene {
        constructor() {
            super(SCENES.GAME);
        }

        // create() 是 session 状态的纯函数（harness/requirements.mdT9.1）：转屏与拖窗口靠 scene.restart() 重排，
        // 局面本身全在 systems/session.js，这里只留一份"呈现播到第几项"的渲染游标，restart 之后从头重播。
        // 1i 起进屏整块重画只发生在这里：物件一次建好常驻，之后状态变化全走 sync()（harness/ui.md）
        create() {
            utils.applyRenderScale(this);
            utils.fadeIn(this);
            // 刷新页面或直接落到这一屏时没有局内状态：用 Setup 的默认组合兜一份，
            // 它由 ROADMAP 决定，永远是现在就能开局的配置
            if (!session.active()) { session.start(); }

            this.beat = null;
            this.entered = false;
            // 减少动效（4b，harness/ui.md）：create 时读一次，转屏 restart 重读 = 免费跟随系统切换
            this.reduced = utils.reducedMotion();
            this.build();
            this.resetCursor();
            this.sync();

            // 入场：背景不动，其余构件升起；面板另给 0.92→1 的缩放入场（harness/ui.md）。
            // 减少动效时 riseIn 自己降级，缩放入场也砍掉，物件直接落位
            utils.riseIn(this, [this.hud.container, this.hint, this.board.container, this.status], {
                delay: 40, stagger: 7, distance: 10
            });
            if (!this.reduced) {
                this.board.container.setScale(0.92);
                this.tweens.add({
                    targets: this.board.container, scaleX: 1, scaleY: 1,
                    duration: CONFIG.FADE_MS, ease: 'Quad.easeOut'
                });
            }
            this.entered = true;

            // Esc 是桌面增强，不是任何功能的前提：顶条上那个"暂停"才是主入口（harness/requirements.mdT6）
            utils.bindKeys(this, (event) => {
                if (event.code === 'Escape') { this.openPause(); }
            });

            // 暂停时转屏会连这一屏一起 restart：画完就把自己按回 paused，等覆盖层的"继续"再跑。
            // 节拍不会偷跑——paused 的场景 update 不推进
            if (session.paused()) { this.scene.pause(); }
        }

        // 常驻物件一次建好：背景 / HUD / 短提示 / 面板 / 底部读数与两个动作按钮。
        // 排布从 layout 推（harness/requirements.mdT9）：竖屏面板居中吃剩余空间，横屏左列 HUD + 提示 + 按钮、
        // 右列面板吃满上下留白之间的全高——同一套构件换一种排布，不是缩小版（harness/gameplay.md）
        build() {
            const view = utils.layout(this);
            // 玩法区按这一局的类型建（harness/requirements.md2a）：类型来自开局那一次快照（纪律 1），
            // 排布与最小边长读 config.BOARDS，节奏与状态机全在 Board 一处，场景不认类型
            const typeId = session.view().settings.type;
            const spec = ns.BOARDS[typeId];
            objects.backdrop(this, view);

            const gapV = Math.round(view.unit * 0.45);
            const hintH = 20;
            const actionH = Math.max(CONFIG.TOUCH_TARGET, Math.round(view.unit * 2));
            const statusH = 16;
            const actionY = view.h - view.gutter - actionH / 2;
            const statusY = actionY - actionH / 2 - Math.round(gapV * 0.6) - statusH / 2;
            const wide = !view.isPortrait;

            let hintX;
            let hintAlign;
            let hintY;
            let colW;
            let boardX;
            let boardY;
            let boardSize;
            let boardW;
            let boardH;

            if (wide) {
                // 横屏玩法区吃满上下留白之间的全高（4d，harness/ui.md）：HUD 搬进左列，不再在顶部占两行——
                // 选牌器最小框高 276，旧排布在 844×390 裁 59px、568×320 裁 111px（底行点半行），
                // 现在 844×390 / 568×320 / 480×320 底行零裁切
                const boardTop = view.gutter;
                const boardBottom = view.h - view.gutter;
                boardSize = fitBoard(typeId, spec, view.w * 0.44, boardBottom - boardTop, 420);
                boardX = view.w - view.gutter - boardSize / 2;
                boardY = (boardTop + boardBottom) / 2;
                // 左列宽 = 面板左沿再留一道缝，下限只挡荒谬视口：窄于 480 的横屏保证不了不重叠
                //（选牌器 min 332 是触控硬底，宁可溢出不缩，harness/ui.md）
                colW = clamp(Math.round(boardX - boardSize / 2 - view.gutter - gapV), 88, 400);
                this.hud = objects.hud(this, { view: view, colW: colW, onPause: () => this.openPause() });
                hintX = view.gutter;
                hintAlign = 0;
                hintY = view.gutter + this.hud.height + gapV;
                // 呈现台的可用矩形给的是面板宽不是 view.w * 0.44 那一列：面板右对齐，
                // 给列宽会把中央大牌推出屏幕右边（harness/architecture.md）
                boardW = boardSize;
                boardH = boardBottom - boardTop;
            } else {
                this.hud = objects.hud(this, { view: view, onPause: () => this.openPause() });
                colW = utils.contentWidth(view, 520);
                hintX = view.cx;
                hintAlign = 0.5;
                hintY = view.gutter + this.hud.height + gapV;
                const boardTop = hintY + hintH + gapV;
                const boardBottom = statusY - statusH / 2 - gapV;
                boardSize = fitBoard(typeId, spec, colW, boardBottom - boardTop, 460);
                boardX = view.cx;
                boardY = (boardTop + boardBottom) / 2;
                boardW = colW;
                boardH = boardBottom - boardTop;
            }

            this.hint = ui.text(this, hintX, hintY, '', {
                fontSize: '13px',
                color: PALETTE.textDim,
                letterSpacing: 1
            }).setOrigin(hintAlign, 0).setDepth(DEPTH.hud);

            this.board = objects.board(this, {
                type: typeId,
                x: boardX, y: boardY, size: boardSize,
                // 呈现台按这一块可用矩形定尺寸（harness/ui.md）：不是 fitBoard 之后的面板尺寸——
                // 面板是装不下才缩的，呈现不继承那个缩放。Stage 自己只拿得到视口，
                // HUD / 短提示 / 状态行 / 按钮的内扣只有这里算得出来
                avail: { w: boardW, h: boardH },
                onTap: (index) => this.tap(index)
            });
            this.fx = objects.effects(this);

            this.status = ui.text(this, hintX, statusY, '', {
                fontSize: '12px',
                color: PALETTE.textFaint,
                letterSpacing: 0.6,
                wordWrap: { width: colW }
            }).setOrigin(hintAlign, 0.5).setDepth(DEPTH.hud);

            // 两个动作按钮都常驻，sync 按相位开关（harness/ui.md）：
            // 隐藏相位给主按钮"开始复现"；判定已定给次级小按钮提前走（1b 的健壮性定案保留）。
            // 收起不是销毁：alpha 淡出 + 关 input，物件还在，下次出现接着用
            const actionX = wide ? view.gutter + colW / 2 : view.cx;
            this.primary = ui.button(this, {
                x: actionX, y: actionY, width: Math.min(colW, 320), height: actionH,
                fontSize: '15px', padX: 20,
                label: '开始复现', accent: PALETTE.dominantSoft, onSelect: () => this.beginRecall()
            }).setDepth(DEPTH.panel).setAlpha(0);
            this.secondary = ui.button(this, {
                x: actionX, y: actionY, width: Math.min(colW, 200), height: actionH,
                fontSize: '13px', padX: 16,
                label: '下一关', accent: PALETTE.textFaint, onSelect: () => this.proceed()
            }).setDepth(DEPTH.panel).setAlpha(0);
            this.primary.input.enabled = false;
            this.secondary.input.enabled = false;
            this.primary._smShown = false;
            this.secondary._smShown = false;
        }

        // 渲染游标清零。判定已定（全对 / 点错）时把最后点的那一格亮回来：
        // 只剩四块禁用色块的话，看不出刚才发生了什么（1b 的定案跟着迁过来）
        resetCursor() {
            this.playAt = 0;
            this.lit = null;
            this.verdict = null;
            // "提速"那一句是 transient 的：转屏 restart 与暂停里的"重开本局"都不重放它
            //（HUD 的 ms 读数已经是新值，迟到的旁白没有信息量），只有 proceed 换关时才置起来
            this.speedCue = false;

            const judge = session.judge();
            if (judge && judge.settled()) {
                const inputs = judge.inputs();
                this.lit = inputs.length ? inputs[inputs.length - 1] : null;
                this.verdict = judge.failed() ? 'bad' : 'ok';
            }
        }

        // 局内的节拍全走这一条累加时钟，不用 scene.time 的定时器：场景 paused 时 update 不推进，
        // 暂停就自动冻住节拍；restart 之后从 0 重来。同一时刻只有一件事在等
        update(time, delta) {
            if (this._smFading) { return; }

            this.board.tick(time);

            const run = session.view();
            // 暂停覆盖层里点"重开本局"会换掉整份局内状态：认出来重新同步，其余情况一律不动
            if (run !== this.run) {
                if (!run) { return; }
                this.resetCursor();
                this.sync();
                return;
            }

            // 复现用时跟着这条时钟走（5a）：暂停 / 判定已定由 session.tick 自己挡住
            session.tick(delta);

            if (!this.beat) { return; }
            this.beat.left -= delta;
            if (this.beat.left > 0) { return; }
            const fire = this.beat.at;
            this.beat = null;
            fire();
        }

        after(ms, at) {
            this.beat = { left: ms, at: at };
        }

        // 唯一的状态同步入口（harness/ui.md）：全量由 session 推导目标状态，交给常驻物件的 sync，
        // tween 只负责把物件动到目标。每次同步完按当前相位挂一个节拍。
        // 不允许"只更新我记得的那个对象"——目标状态永远是 session 的纯函数
        sync() {
            const run = session.view();
            this.run = run;
            const round = session.round();
            const judge = session.judge();

            // 相位 = session 的三段 + 判定已定的两个收尾态；呈现还没播第一项时另给一句"准备"
            const settled = judge.settled();
            const stage = session.phase();
            const phase = settled ? (judge.failed() ? 'failed' : 'cleared')
                : (stage === 'present' && this.playAt === 0 && this.lit === null ? 'lead' : stage);

            const step = stage === 'present' ? this.playAt : (stage === 'hidden' ? 0 : judge.step());

            this.hud.sync({
                run: run, round: round, step: step,
                // 里程碑之后的活值：HUD 的 ms 读数跟着变小，就是"提速了"的可见证据（harness/ui.md）
                speed: session.speedNow(),
                badAt: judge.failed() ? judge.wrongAt() : null
            });
            const recallCopy = run.direction.id === 'backward' ? COPY.recallBack : COPY.recall;
            this.setHint(this.speedCue && phase === 'lead' ? COPY.speed
                : (phase === 'recall' ? recallCopy : COPY[phase]));
            this.board.sync({
                lit: this.lit, verdict: this.verdict,
                veil: stage === 'hidden', interactive: phase === 'recall',
                // 呈现形态（2e）：stream 的类型在呈现期间整层棋盘都不露出来，Board 靠这个字段
                // 认出"现在是呈现还是复现"。方阵不读它，契约不变（同 picked / settled）
                phase: phase,
                // 选牌器要用：置灰与花色 tab 的已选计数由已输入全量推导、判定已定后保持置灰（2h）。
                // 方阵 board 不读这两个字段，契约不变
                picked: judge.inputs(), settled: settled
            });

            // 底部读数只补进度与错处，不重复相位提示
            this.status.setText(phase === 'recall' ? '已输入 ' + step + ' / ' + round.length
                : (phase === 'failed' ? '错在第 ' + (judge.wrongAt() + 1) + ' 位' : ''));

            this.setAction(this.primary, phase === 'hidden');
            this.setAction(this.secondary, phase === 'cleared' || phase === 'failed',
                phase === 'failed' ? '看结算' : '下一关');

            this.arm();
        }

        setHint(text) {
            if (this.hint.text === text) { return; }
            this.hint.setText(text);
            if (!this.entered) { return; }
            this.tweens.killTweensOf(this.hint);
            this.hint.setAlpha(0);
            this.tweens.add({ targets: this.hint, alpha: 1, duration: MOTION.hint });
        }

        setAction(button, show, label) {
            if (label && button._smLabel !== label) {
                button._smLabel = label;
                button.setLabel(label);
            }
            if (show === button._smShown) { return; }
            button._smShown = show;
            button.input.enabled = show;
            this.tweens.killTweensOf(button);
            // Phaser 的命中测试跳过 alpha 恰为 0 的物件（willRender）：从 0 起淡入的话，
            // 第一帧里按钮看得见轮廓却点不动。抬到 0.02 起步，视觉无差、第一帧就可点
            if (show && button.alpha === 0) { button.setAlpha(0.02); }
            this.tweens.add({ targets: button, alpha: show ? 1 : 0, duration: MOTION.action, ease: 'Quad.easeOut' });
        }

        // 每次同步之后重新挂一个节拍。呈现的三段（首项前 / 亮 / 灭）各吃自己的时长，
        // 亮多久与间隔多久读 session.speedNow()（开局那一档 × 里程碑台阶，harness/gameplay.md），
        // 末项之后多留一拍再遮，否则最后一闪会被遮罩吃掉
        arm() {
            this.beat = null;
            const speed = session.speedNow();
            const stage = session.phase();

            if (stage === 'present') {
                if (this.lit !== null) {
                    this.after(speed.show, () => this.hideItem());
                    return;
                }
                if (this.playAt === 0) {
                    this.after(ns.PLAYBACK.lead, () => this.showItem(0));
                    return;
                }
                const done = this.playAt >= session.round().length;
                this.after(done ? ns.PLAYBACK.tail : speed.gap,
                    () => (done ? this.cover() : this.showItem(this.playAt)));
                return;
            }

            const judge = session.judge();
            if (judge.settled()) {
                // 自动去向之前的停顿：留出感知时间，玩家也能自己点按钮提前走。
                // 点错另加 hitStop：fail 节拍推迟约 120ms 再挂（harness/ui.md），
                // 不引入新定时器，走同一条累加时钟，暂停照样冻得住
                const pause = judge.failed() ? ns.FEEDBACK.fail + MOTION.hitStop : ns.FEEDBACK.clear;
                this.after(pause, () => this.proceed());
                return;
            }

            if (this.lit !== null) {
                // 跟手的那一闪与呈现速度档无关，不该随档位忽快忽慢
                this.after(ns.FEEDBACK.tap, () => {
                    this.lit = null;
                    this.verdict = null;
                    this.sync();
                });
            }
        }

        showItem(index) {
            this.lit = session.round().sequence[index];
            this.playAt = index + 1;
            this.sync();
            // 类型与下标交给 Audio：颜色音调开时按色定音高，其余类型 / 关时回落中性音（4a）
            audio.play('lit', { type: session.view().type.id, index: this.lit });
        }

        hideItem() {
            this.lit = null;
            this.sync();
        }

        cover() {
            this.lit = null;
            session.cover();
            this.sync();
            audio.play('veil');
        }

        beginRecall() {
            session.beginRecall();
            this.sync();
            audio.play('recall');
            this.board.cue();
        }

        tap(index) {
            if (this._smFading) { return; }
            const result = session.judge().tap(index);
            // 判定已定之后连点的那几下不算数（Judge 自己挡），界面也不要跟着动
            if (!result) { return; }

            this.lit = index;
            this.verdict = result.ok ? 'ok' : 'bad';
            this.sync();

            // 每个输入必有回响（harness/ui.md 原则 3）。特效是事件的一次性回响，不进 sync 的目标状态
            if (result.failed) {
                // 点错的那一下要重（harness/gameplay.md）：危险色 + 红闪 + 玩法区抖动 + 低鸣。
                // hit stop 在 arm() 里以 fail 节拍推迟实现，不在这里。
                // 减少动效时红闪与抖动砍掉（装饰），危险色 + hit stop + 低鸣照旧——信息一条不丢
                if (!this.reduced) {
                    this.cameras.main.flash(MOTION.flash, DANGER.red, DANGER.green, DANGER.blue);
                }
                this.fx.shake(this.board.container);
                audio.play('bad');
                return;
            }
            // 涟漪染成那一格自己的强调色，颜色由 Board 给：场景不认类型、也不翻 COLORS（harness/requirements.md2a）
            const at = this.board.center(index);
            this.fx.ripple(at.x, at.y, at.hex, at.size);
            audio.play('ok', { type: session.view().type.id, index: index });
            if (result.cleared) {
                this.board.wave();
                this.fx.burst(this.board.container.x, this.board.container.y);
                audio.play('clear');
            }
        }

        // 两条去向都走这里：全对换关接着播，出错冻快照进结算（1b / 1c 的定案不变）
        proceed() {
            if (this._smFading) { return; }
            if (session.judge().failed()) {
                const last = session.finish();
                // 记录只在这里提交一次（5a）：结算屏 create 随转屏 restart 重放，放那边会重复记账。
                // 提交结果（previous / isRecord）冻进快照给结算读——提交发生在进结算屏之前，
                // 结算再读活值就已经含本局，破纪录永远亮不起来
                last.record = ns.systems.scoreKeeper().submit(last);
                utils.fadeTo(this, SCENES.GAME_OVER);
                return;
            }
            const tierBefore = session.speedNow().tier;
            session.advance();
            this.resetCursor();
            // 里程碑提速要给回响（harness/ui.md）：声音在这里响一次，短提示由 sync 换成"提速"。
            // 必须放在 resetCursor 之后——它会把 speedCue 清掉（转屏与"重开本局"都不重放这句旁白）
            if (session.speedNow().tier > tierBefore) {
                this.speedCue = true;
                audio.play('speed');
            }
            this.sync();
        }

        // 覆盖层用 launch + pause（harness/requirements.mdT5）：GameScene 不销毁，paused 之后 update 不推进，
        // 节拍跟着冻住，回来接着走。暂停状态记在 session 里，覆盖层期间转屏也认得出来
        openPause() {
            if (this._smFading || session.paused()) { return; }
            session.pause();
            this.scene.launch(SCENES.PAUSE);
            this.scene.pause();
        }
    }

    ns.scenes = ns.scenes || {};
    ns.scenes.GameScene = GameScene;
})(window.SequenceMemory = window.SequenceMemory || {});