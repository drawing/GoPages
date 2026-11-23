import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const ns = load();
const make = (sequence) => ns.systems.Judge.create({ sequence });

test('即点即判：点对逐步推进，最后一项对上才全对', () => {
    const judge = make([0, 3, 1]);
    assert.equal(judge.step(), 0);
    assert.equal(judge.settled(), false);

    const first = judge.tap(0);
    assert.equal(first.ok, true);
    assert.equal(first.step, 1);
    assert.equal(first.cleared, false);
    assert.equal(judge.settled(), false);

    judge.tap(3);
    const last = judge.tap(1);
    assert.equal(last.cleared, true);
    assert.equal(last.failed, false);
    assert.equal(judge.cleared(), true);
    assert.equal(judge.failed(), false);
    assert.equal(judge.settled(), true);
    assert.equal(judge.wrongAt(), null);
});

test('点错立刻终结：wrongAt 停在出错那一位，之后的点按不算数', () => {
    const judge = make([2, 0, 3, 1]);
    judge.tap(2);
    const wrong = judge.tap(3);
    assert.equal(wrong.ok, false);
    assert.equal(wrong.failed, true);
    assert.equal(wrong.cleared, false);
    assert.equal(judge.wrongAt(), 1);
    assert.equal(judge.settled(), true);

    // 判定已定，补点正确项也不能把结论翻回来
    assert.equal(judge.tap(0), null);
    assert.equal(judge.tap(3), null);
    assert.equal(judge.step(), 2);
    assert.equal(judge.wrongAt(), 1);
    assert.equal(judge.cleared(), false);
});

test('按位比对而不是看符号有没有出现过，相邻重复项要各点一次', () => {
    const order = make([0, 1]);
    assert.equal(order.tap(1).failed, true);
    assert.equal(order.wrongAt(), 0);

    const repeat = make([2, 2, 1]);
    assert.equal(repeat.tap(2).cleared, false);
    assert.equal(repeat.tap(2).cleared, false);
    assert.equal(repeat.tap(1).cleared, true);

    const short = make([2, 2]);
    short.tap(2);
    assert.equal(short.cleared(), false);
    assert.equal(short.tap(2).cleared, true);
});

test('inputs() 给拷贝，外部改动不污染判定与结算对照', () => {
    const judge = make([1, 0, 3]);
    judge.tap(1);
    judge.tap(0);
    const taken = judge.inputs();
    taken[0] = 99;
    taken.push(99);
    assert.deepEqual(Array.from(judge.inputs()), [1, 0]);
    assert.equal(judge.tap(3).cleared, true);
    assert.deepEqual(Array.from(judge.inputs()), [1, 0, 3]);
});

test('逐位对照：长度以正确序列为准，错处之后是未输入而不是错', () => {
    const judge = make([2, 2, 1, 0]);
    judge.tap(2);
    judge.tap(1);
    const rows = Array.from(judge.compare());
    assert.deepEqual(rows.map((row) => row.at), [0, 1, 2, 3]);
    assert.deepEqual(rows.map((row) => row.expected), [2, 2, 1, 0]);
    assert.deepEqual(rows.map((row) => row.actual), [2, 1, null, null]);
    assert.deepEqual(rows.map((row) => row.state), ['ok', 'bad', 'missed', 'missed']);
    assert.equal(rows[1].at, judge.wrongAt());
});

test('逐位对照：一位没点时全是未输入，全对时没有错也没有未输入', () => {
    const idle = Array.from(make([0, 3]).compare());
    assert.deepEqual(idle.map((row) => row.state), ['missed', 'missed']);
    assert.deepEqual(idle.map((row) => row.actual), [null, null]);

    const judge = make([0, 3, 0]);
    judge.tap(0);
    judge.tap(3);
    judge.tap(0);
    const rows = Array.from(judge.compare());
    assert.deepEqual(rows.map((row) => row.state), ['ok', 'ok', 'ok']);
    assert.deepEqual(rows.map((row) => row.actual), [0, 3, 0]);
});

// 3c：倒序只反转期望顺序——呈现仍正序（生成器永远给正序），复现从最后一项点起。
// compare / wrongAt 按复现顺序对齐，结算逐位回放画的就是"该怎么点"（harness/architecture.md）
test('倒序：第一下该点呈现的最后一项，点首项就是错在第 1 位', () => {
    const sequence = [0, 3, 1];
    const judge = ns.systems.Judge.create({ sequence, direction: 'backward' });
    // 反转的是拷贝，传进来的呈现序列不被污染
    assert.deepEqual(sequence, [0, 3, 1]);

    assert.equal(judge.tap(0).failed, true);
    assert.equal(judge.wrongAt(), 0);
    const rows = Array.from(judge.compare());
    assert.deepEqual(rows.map((row) => row.expected), [1, 3, 0]);
    assert.deepEqual(rows.map((row) => row.state), ['bad', 'missed', 'missed']);
});

test('倒序：从最后一项点起全对，相邻重复仍按位判定，缺省方向是正序', () => {
    const judge = ns.systems.Judge.create({ sequence: [2, 0, 3, 1], direction: 'backward' });
    assert.equal(judge.tap(1).ok, true);
    assert.equal(judge.tap(3).ok, true);
    assert.equal(judge.tap(0).ok, true);
    assert.equal(judge.tap(2).cleared, true);
    assert.deepEqual(Array.from(judge.inputs()), [1, 3, 0, 2]);

    const repeat = ns.systems.Judge.create({ sequence: [2, 2, 1], direction: 'backward' });
    assert.equal(repeat.tap(1).ok, true);
    assert.equal(repeat.tap(2).cleared, false);
    assert.equal(repeat.tap(2).cleared, true);

    const forward = make([0, 1]);
    assert.equal(forward.tap(0).ok, true);
    assert.equal(forward.tap(1).cleared, true);
});