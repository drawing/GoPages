(function (ns) {
    'use strict';

    const systems = ns.systems = ns.systems || {};
    let state = null;
    let last = null;

    // 生成策略读表（3a 起两条路都通）：MODES.generate = fresh（冲榜，每关独立）/ append（休闲，重播 + 末尾追加）。
    // 判定两模式同为即点即判（退格 / 容错评估过不做，harness/requirements.md 3b）。
    // 正常入口（首页）都会传快照进来；不传的用 Setup 的默认组合兜底——
    // 它由 ROADMAP 决定，永远是一份现在就能玩的配置
    function openingSettings() {
        return systems.Setup.snapshot();
    }

    // 判定基准跟着这一关的序列走，换关就换一个 Judge：上一关的输入不该留到下一关。
    // 方向交给 Judge 反转期望顺序（3c）：序列本身永远是正序的那一条，呈现层不认方向
    function openRound() {
        state.judge = systems.Judge.create({
            sequence: state.generator.current(),
            direction: state.direction.id
        });
    }

    // 局内唯一状态，归 systems/ 而不是场景（AGENTS 分层红线）：转屏与拖窗口靠 scene.restart() 重排，
    // 状态长在场景里就会丢局，所以 GameScene 的 create() 只能是这份状态的纯函数（harness/architecture.md）
    systems.session = {
        start: function (settings) {
            const snapshot = settings || openingSettings();
            const type = ns.typeById(snapshot.type);
            const mode = ns.modeById(snapshot.mode);
            const generator = systems.SequenceGenerator.create({
                symbols: type.symbols,
                startLength: snapshot.startLength,
                unique: type.unique,
                generate: mode.generate
            });
            last = null;
            state = {
                settings: snapshot,
                type: type,
                mode: mode,
                direction: ns.directionById(snapshot.direction),
                speed: ns.speedById(snapshot.speed),
                generator: generator,
                judge: null,
                // 得分 = 本局全对过的最大长度（harness/gameplay.md），起始 0
                cleared: 0,
                // 复现用时与输入数按局累计（5a，tie-break 的第二顺位"平均复现用时" = ms / taps）：
                // 只计复现阶段且判定未定的时间，暂停与判定已定后的等待都不算（harness/gameplay.md）
                recallMs: 0,
                taps: 0,
                // 呈现 → 隐藏 → 复现三段的相位（harness/gameplay.md）。
                // 它必须在 session 里而不是场景里：转屏 restart 之后场景靠它知道自己该画哪一段，
                // 丢了 'hidden' 就会把序列再播一遍，等于让玩家白看一次
                phase: 'present',
                paused: false
            };
            generator.next();
            openRound();
            return state;
        },
        active: function () { return state !== null; },
        view: function () { return state; },
        judge: function () { return state ? state.judge : null; },
        // 序列只有生成器一个来源，这里每次现取，不另存一份
        round: function () {
            if (!state) { return null; }
            return {
                index: state.generator.round(),
                length: state.generator.length(),
                sequence: state.generator.current()
            };
        },
        // 现在的节拍（harness/gameplay.md 休闲里程碑）：开局选的那一档留在 state.speed 与结算快照里
        // 当记录身份（组合键 = 类型 × 模式 × 方向 × 速度档），这里是"长度跨过几个里程碑之后实际多快"。
        // 派生值不是设置，所以现取而不写进快照——纪律 1 管的是设置，里程碑与长度同类归局内状态。
        // 只有休闲有里程碑（MODES.milestones）：冲榜与挑战开局那一档就是全程那一档，原样返回。
        // 调用方保证有活局（GameScene 的 create 会兜底开局，PauseScene 没有局就 stop）
        speedNow: function () {
            if (!state.mode.milestones) {
                return { tier: 0, show: state.speed.show, gap: state.speed.gap };
            }
            return ns.milestoneSpeed(state.speed, state.generator.length());
        },
        // 播完遮住：进入"该你了"，等玩家自己点开始复现，不用固定倒计时催促（harness/gameplay.md）
        cover: function () {
            if (state) { state.phase = 'hidden'; }
            return state;
        },
        beginRecall: function () {
            if (state) { state.phase = 'recall'; }
            return state;
        },
        phase: function () { return state ? state.phase : null; },
        // 暂停是局内状态的一部分，不是覆盖层的界面状态：暂停期间转屏会把 GameScene 一起 restart，
        // 它得靠这个标记决定"画完再把自己按回 paused"，否则覆盖层底下那一局会继续跑
        pause: function () {
            if (state) { state.paused = true; }
            return state;
        },
        resume: function () {
            if (state) { state.paused = false; }
            return state;
        },
        paused: function () { return state ? state.paused : false; },
        // 复现计时由场景每帧喂 dt（与节拍同一条 update 时钟）。单帧 clamp 到 100ms：
        // 切后台回来的 delta 可能巨大，不该把那段等待算进复现用时
        tick: function (dt) {
            if (!state || state.paused || state.phase !== 'recall' || state.judge.settled()) { return; }
            state.recallMs += Math.min(Math.max(dt, 0), 100);
        },
        // 全对：先把这一关的长度记成得分，再生成下一关（长度 +1），相位回到呈现
        advance: function () {
            if (!state) { return null; }
            state.cleared = state.generator.length();
            state.taps += state.judge.inputs().length;
            state.generator.next();
            state.phase = 'present';
            openRound();
            return state;
        },
        // 出错即终：把这一局冻结成快照交给结算屏，逐位对照的素材（序列 + 输入 + 错处）都在这里。
        // sequence 是呈现顺序（播了什么），rows / inputs / wrongAt 是复现顺序（该怎么点）——
        // 倒序局两者互为反转，结算画的是 rows（harness/architecture.md）
        finish: function () {
            if (!state) { return last; }
            last = {
                settings: state.settings,
                type: state.type,
                mode: state.mode,
                direction: state.direction,
                speed: state.speed,
                score: state.cleared,
                // 累计复现用时与输入数（含本关）：记录层拿它算平均复现用时（5a，tie-break 素材）
                ms: state.recallMs,
                taps: state.taps + state.judge.inputs().length,
                index: state.generator.round(),
                length: state.generator.length(),
                sequence: state.generator.current(),
                inputs: state.judge.inputs(),
                wrongAt: state.judge.wrongAt(),
                rows: state.judge.compare()
            };
            state = null;
            return last;
        },
        last: function () { return last; },
        end: function () { state = null; last = null; }
    };
})(window.SequenceMemory = window.SequenceMemory || {});
