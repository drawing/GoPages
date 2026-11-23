import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const ns = load();
const session = ns.systems.session;
const Setup = ns.systems.Setup;

// 局内状态归 systems/ 是功能前提不是归类洁癖：转屏靠 scene.restart() 重排，
// 状态长在场景里就会丢局（harness/requirements.mdT9.1）。这里只验迁移后核心链路没断
test('开局读一次快照，全对换关加长，出错冻结成结算快照', () => {
    session.start(Setup.snapshot({ mode: 'ranked' }));
    assert.equal(session.active(), true);
    assert.equal(session.round().length, ns.START_LENGTH);

    session.advance();
    assert.equal(session.round().length, ns.START_LENGTH + 1);
    assert.equal(session.view().cleared, ns.START_LENGTH);

    // 点错第一位：冲榜即点即判，错处之后没有输入的位是 missed 而不是 bad（harness/requirements.md1c）
    const expected = Array.from(session.round().sequence);
    session.judge().tap((expected[0] + 1) % ns.typeById('color').symbols);

    const last = session.finish();
    assert.equal(last.score, ns.START_LENGTH);
    assert.equal(last.wrongAt, 0);
    assert.deepEqual(Array.from(last.rows, (row) => row.state), ['bad', 'missed', 'missed']);
    assert.equal(session.active(), false);
    assert.equal(session.last(), last);

    session.end();
    assert.equal(session.last(), null);
});

// 相位与暂停归 session 而不是场景，是"转屏不丢当前这一局"的前提（harness/requirements.mdT9.1）：
// restart 之后场景靠这两样才知道自己该画哪一段、要不要接着 paused
test('三段相位跟着走，暂停不动局内状态', () => {
    session.start(Setup.snapshot({ mode: 'ranked' }));
    assert.equal(session.phase(), 'present');
    assert.equal(session.paused(), false);

    session.cover();
    assert.equal(session.phase(), 'hidden');
    session.beginRecall();
    assert.equal(session.phase(), 'recall');

    // 暂停只是覆盖层盖上来：关次、长度、序列与已输入的位一个都不能变
    const round = session.round();
    session.judge().tap(round.sequence[0]);
    session.pause();
    assert.equal(session.paused(), true);
    assert.deepEqual(session.round(), round);
    assert.equal(session.judge().step(), 1);
    session.resume();
    assert.equal(session.paused(), false);

    // 全对换关：相位回到呈现，下一关从头再播
    session.judge().tap(round.sequence[1]);
    session.advance();
    assert.equal(session.phase(), 'present');
    assert.equal(session.judge().step(), 0);

    session.end();
});

// 2a 的逻辑层那一半：换类型只是换符号集，判定路径、三态算法与结算快照一个样
//（harness/gameplay.md "四种类型走同一条判定路径"）。界面那一半——节奏与颜色一致——由人点（AGENTS 验证边界）
test('位置类型走同一条判定路径，符号落在九宫格里且都有说法', () => {
    session.start(Setup.snapshot({ type: 'position' }));
    assert.equal(session.view().settings.type, 'position');
    assert.equal(session.view().type.symbols, 9);

    const round = session.round();
    for (const symbol of Array.from(round.sequence)) {
        assert.ok(symbol >= 0 && symbol < 9);
        assert.ok(ns.symbolName('position', symbol).length > 0);
    }

    // 全对一关照样 +1，接着点错：三态与错处仍由 Judge.compare() 一处算，与颜色类型同一套
    for (const symbol of Array.from(round.sequence)) {
        assert.equal(session.judge().tap(symbol).ok, true);
    }
    session.advance();
    assert.equal(session.round().length, ns.START_LENGTH + 1);

    const next = Array.from(session.round().sequence);
    session.cover();
    session.beginRecall();
    assert.equal(session.judge().tap(next[0]).ok, true);
    assert.equal(session.judge().tap((next[1] + 1) % 9).failed, true);

    const last = session.finish();
    assert.equal(last.type.id, 'position');
    assert.equal(last.wrongAt, 1);
    assert.deepEqual(Array.from(last.rows, (row) => row.state), ['ok', 'bad', 'missed']);
    assert.ok(ns.symbolName(last.type.id, last.rows[1].expected).length > 0);

    session.end();
});

// 2b：数字类型并入同一条判定路径（harness/gameplay.md "点错就是记错"，没有打字支线）。
// 逻辑层与颜色 / 位置一个样：换类型只是换符号集；键盘排布与节奏由人点（AGENTS 验证边界）
test('数字类型走同一条判定路径，符号落在 0–9 且都有说法', () => {
    session.start(Setup.snapshot({ type: 'digit' }));
    assert.equal(session.view().settings.type, 'digit');
    assert.equal(session.view().type.symbols, 10);

    const round = session.round();
    for (const symbol of Array.from(round.sequence)) {
        assert.ok(symbol >= 0 && symbol < 10);
        assert.equal(ns.symbolName('digit', symbol), String(symbol));
    }

    // 全对一关照样 +1，接着点错：即点即判、三态与错处仍由 Judge.compare() 一处算
    for (const symbol of Array.from(round.sequence)) {
        assert.equal(session.judge().tap(symbol).ok, true);
    }
    session.advance();
    assert.equal(session.round().length, ns.START_LENGTH + 1);

    const next = Array.from(session.round().sequence);
    session.cover();
    session.beginRecall();
    assert.equal(session.judge().tap(next[0]).ok, true);
    assert.equal(session.judge().tap((next[1] + 1) % 10).failed, true);

    const last = session.finish();
    assert.equal(last.type.id, 'digit');
    assert.equal(last.wrongAt, 1);
    assert.deepEqual(Array.from(last.rows, (row) => row.state), ['ok', 'bad', 'missed']);
    assert.equal(ns.symbolName(last.type.id, last.rows[1].expected), String(next[1]));

    session.end();
});

// 2d：扑克并入同一条判定路径，且序列无放回（harness/gameplay.md "扑克序列无重复牌"——
// 允许重复的话"选过的置灰不可再选"会把同一张牌的第二次出现锁死）。
// 渲染那一半——翻牌节奏、整副翻正、选过置灰——由人点（AGENTS 验证边界）
test('扑克类型走同一条判定路径，序列无重复牌且都有说法', () => {
    session.start(Setup.snapshot({ type: 'card' }));
    assert.equal(session.view().settings.type, 'card');
    assert.equal(session.view().type.symbols, 52);

    const round = session.round();
    const seq = Array.from(round.sequence);
    assert.equal(new Set(seq).size, seq.length);
    for (const symbol of seq) {
        assert.ok(symbol >= 0 && symbol < 52);
        assert.equal(ns.symbolName('card', symbol), ns.CARDS[symbol].name);
    }

    // 全对一关照样 +1，接着点错：即点即判、三态与错处仍由 Judge.compare() 一处算
    for (const symbol of seq) {
        assert.equal(session.judge().tap(symbol).ok, true);
    }
    session.advance();
    assert.equal(session.round().length, ns.START_LENGTH + 1);

    const next = Array.from(session.round().sequence);
    assert.equal(new Set(next).size, next.length);
    session.cover();
    session.beginRecall();
    assert.equal(session.judge().tap(next[0]).ok, true);
    assert.equal(session.judge().tap((next[1] + 1) % 52).failed, true);

    const last = session.finish();
    assert.equal(last.type.id, 'card');
    assert.equal(last.wrongAt, 1);
    assert.deepEqual(Array.from(last.rows, (row) => row.state), ['ok', 'bad', 'missed']);
    assert.equal(ns.symbolName(last.type.id, last.rows[1].expected), ns.CARDS[next[1]].name);

    session.end();
});

// 3a：休闲一局走追加生成，速度读数跟着里程碑走（harness/gameplay.md）。
// 判定与冲榜同为即点即判（退格 / 容错评估过不做，harness/requirements.md 3b）。
// speedNow 是派生值不是设置：开局那一档留在快照与结算里当记录身份，局内提速不改它
test('休闲一局：每关重播旧序列，speedNow 跟着里程碑提速而组合键不变', () => {
    session.start(Setup.snapshot({ mode: 'leisure' }));
    assert.equal(session.view().mode.generate, 'append');

    const base = session.view().speed;
    let previous = Array.from(session.round().sequence);
    assert.equal(previous.length, ns.START_LENGTH);
    assert.equal(session.speedNow().tier, 0);
    assert.equal(session.speedNow().show, base.show);

    // 打到长度 5：前缀一路不动、每关只多一项，跨过第一个里程碑
    while (session.round().length < 5) {
        for (const symbol of Array.from(session.round().sequence)) {
            assert.equal(session.judge().tap(symbol).ok, true);
        }
        session.advance();
        const next = Array.from(session.round().sequence);
        assert.deepEqual(next.slice(0, previous.length), previous);
        assert.equal(next.length, previous.length + 1);
        previous = next;
    }

    assert.equal(session.round().length, 5);
    assert.equal(session.speedNow().tier, 1);
    assert.ok(session.speedNow().show < base.show);

    // 组合键里的那一档没被局内提速碰到，结算冻住的也是它
    assert.equal(session.view().speed.id, 'normal');
    assert.equal(session.view().settings.speed, 'normal');
    assert.equal(session.finish().speed.id, 'normal');

    session.end();
});

// 3c：挑战档 = 冲榜 · 倒序 · 快（harness/gameplay.md）。呈现序列仍正序，复现从最后一项点起；
// 快照里 sequence 是呈现顺序、rows 是复现顺序，两者互为反转（harness/architecture.md）
test('挑战一局：正着点第一下就错，倒着点全对换关，结算按复现顺序对照', () => {
    const challenge = () => Setup.snapshot({ mode: 'ranked', direction: 'backward' });

    session.start(challenge());
    assert.equal(session.view().direction.id, 'backward');
    assert.equal(session.view().speed.id, 'fast');

    // 相邻重复是这一类的规则（harness/gameplay.md），起始长度 2 的关有 1/4 概率抽到两项相同——
    // 那时"呈现的第一项"与"倒序该点的第一项"是同一个符号，下面这条断言无从谈起，换一条序列再试。
    // 撞上是随机不是 bug，所以是测试不能假定两项不同，不是生成器要去重
    let seq = Array.from(session.round().sequence);
    while (seq[0] === seq[seq.length - 1]) {
        session.start(challenge());
        seq = Array.from(session.round().sequence);
    }
    assert.equal(session.judge().tap(seq[0]).failed, true);
    const last = session.finish();
    assert.equal(last.wrongAt, 0);
    assert.deepEqual(Array.from(last.sequence), seq);
    assert.deepEqual(Array.from(last.rows, (row) => row.expected), seq.slice().reverse());
    assert.deepEqual(Array.from(last.rows, (row) => row.state), ['bad', 'missed']);

    // 再来一局倒着点：全对换关，长度 +1，判定路径与正序同一套
    session.start(challenge());
    const next = Array.from(session.round().sequence);
    for (const symbol of next.slice().reverse()) {
        assert.equal(session.judge().tap(symbol).ok, true);
    }
    session.advance();
    assert.equal(session.round().length, ns.START_LENGTH + 1);
    assert.equal(session.view().cleared, ns.START_LENGTH);

    session.end();
});

// 3c：里程碑只休闲（MODES.milestones）——此前 speedNow 不认模式，冲榜局内也会跟着提速，
// 与"休闲里程碑提速"的文档不符。冲榜与挑战开局那一档就是全程那一档
test('里程碑只休闲：冲榜与挑战打到长度 5 也不提速', () => {
    for (const picks of [{ mode: 'ranked' }, { mode: 'ranked', direction: 'backward' }]) {
        session.start(Setup.snapshot(picks));
        const base = session.view().speed;

        while (session.round().length < 5) {
            // 期望顺序从 compare 取，正序倒序同一条路
            const expected = Array.from(session.judge().compare(), (row) => row.expected);
            for (const symbol of expected) {
                assert.equal(session.judge().tap(symbol).ok, true);
            }
            session.advance();
        }

        assert.equal(session.round().length, 5);
        assert.equal(session.speedNow().tier, 0);
        assert.equal(session.speedNow().show, base.show);
        assert.equal(session.speedNow().gap, base.gap);
        session.end();
    }
});

// 5a：复现用时是 tie-break 的第二顺位（平均复现用时 = ms / taps，harness/gameplay.md）。
// 只计复现阶段且判定未定的时间：呈现 / 隐藏 / 暂停 / 全对或点错之后的等待都不算
test('复现计时只计判定未定的复现阶段，ms / taps 随局累计进结算快照', () => {
    session.start(Setup.snapshot({ mode: 'ranked' }));
    session.tick(50);                    // present 不计
    session.cover();
    session.tick(50);                    // hidden 不计
    session.beginRecall();
    session.tick(30);
    session.pause();
    session.tick(100);                   // 暂停冻住
    session.resume();
    const seq = Array.from(session.round().sequence);
    session.judge().tap(seq[0]);
    session.tick(20);
    session.judge().tap(seq[1]);         // 全对，判定已定
    session.tick(100);                   // 等玩家点"下一关"的等待不计
    session.advance();

    session.cover();
    session.beginRecall();
    session.tick(10);
    const next = Array.from(session.round().sequence);
    session.judge().tap((next[0] + 1) % ns.typeById('color').symbols);
    session.tick(100);                   // 点错之后的等待不计

    const last = session.finish();
    assert.equal(last.ms, 60);           // 30 + 20 + 10
    assert.equal(last.taps, 3);          // 上一关 2 下 + 本关 1 下
    session.end();
});

// 切后台回来的 delta 可能巨大：单帧 clamp 到 100ms，不把等待算进复现用时
test('复现计时单帧 clamp：巨大 delta 只计 100ms', () => {
    session.start(Setup.snapshot({ mode: 'ranked' }));
    session.cover();
    session.beginRecall();
    session.tick(60000);
    const seq = Array.from(session.round().sequence);
    session.judge().tap((seq[0] + 1) % ns.typeById('color').symbols);
    assert.equal(session.finish().ms, 100);
    session.end();
});
