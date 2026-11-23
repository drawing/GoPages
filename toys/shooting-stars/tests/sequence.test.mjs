import test from 'node:test';
import assert from 'node:assert/strict';

import { load } from './load.mjs';

const ns = load();
const sequence = ns.utils.sequence;

// load.mjs 用 node:vm 造假 window，那里造的数组与本 realm 的 Array.prototype 不是一个，
// deepStrictEqual 连原型一起比 —— 逐层拷回本 realm 再断言（harness/architecture.md 已知坑）
const arr = (value) => Array.from(value);
const nested = (value) => Array.from(value, (path) => Array.from(path));

// 9d 键序引擎：普通字母星 = 单键特例、双星 = 两键特例、序列星 = 多键单体。
// 推进只前进不回退，敲完判定与"待敲键集合"是判定与白圈共用的那一份口径。
// **9g 起一颗星可以带一组读音**（多音字任一读音都算对）：状态是 { paths, depth }，
// paths 是仍然存活的那几条读音，每敲对一键按它过滤一次——"敲对第一键就锁定那条读音"
// 因此是过滤的自然结果，不是额外规则
test('create：键序拷一份、进度从 0 起，改原数组不污染状态', function () {
    const keys = ['h', 'a', 'o'];
    const seq = sequence.create(keys);
    assert.deepEqual(nested(seq.paths), [['h', 'a', 'o']], '一串键 = 一条 path');
    assert.equal(seq.depth, 0);
    keys[0] = 'x';
    assert.deepEqual(arr(sequence.nextKeys(seq)), ['h'], 'create 没拷数组，原数组改了键序跟着变');
});

test('create：一组读音拷成多条 path，改原数组同样不污染', function () {
    const readings = [['x', 'i', 'n', 'g'], ['h', 'a', 'n', 'g']];
    const seq = sequence.create(readings);
    assert.deepEqual(nested(seq.paths), [['x', 'i', 'n', 'g'], ['h', 'a', 'n', 'g']]);
    assert.equal(seq.depth, 0);
    readings[0][0] = 'z';
    assert.deepEqual(arr(sequence.nextKeys(seq)).sort(), ['h', 'x'], '多读音也要逐条拷');
});

test('create：空内容与单键都只有一条 path，不炸', function () {
    assert.deepEqual(nested(sequence.create([]).paths), [[]]);
    assert.equal(sequence.total(sequence.create([])), 0);
    assert.deepEqual(arr(sequence.nextKeys(sequence.create([]))), []);
    assert.deepEqual(arr(sequence.nextKeys(sequence.create(['k']))), ['k']);
});

test('单键特例：待敲键就是它、没有再下一键、敲对即敲完', function () {
    const seq = sequence.create(['k']);
    assert.deepEqual(arr(sequence.nextKeys(seq)), ['k']);
    assert.equal(sequence.pendingKey(seq), null);
    assert.equal(sequence.total(seq), 1);
    assert.equal(sequence.isLast(seq), true, '单键星恒 isLast，判定直接走击落');
    assert.equal(sequence.advance(seq, 'k'), true, '敲对单键就是敲完');
    assert.equal(seq.depth, 1);
});

test('两键特例（双星）：首键推进不计敲完、次键才是最后一键', function () {
    const seq = sequence.create(['t', 'h']);
    assert.deepEqual(arr(sequence.nextKeys(seq)), ['t']);
    assert.equal(sequence.pendingKey(seq), 'h');
    assert.equal(sequence.isLast(seq), false);
    assert.equal(sequence.advance(seq, 't'), false, '首键敲对只是推进，不是击落');
    assert.deepEqual(arr(sequence.nextKeys(seq)), ['h']);
    assert.equal(sequence.pendingKey(seq), null);
    assert.equal(sequence.isLast(seq), true);
    assert.equal(sequence.advance(seq, 'h'), true);
});

test('多键单体（zhuang 六键）：逐键推进、进度只前进不回退、最后一键才敲完', function () {
    const keys = ['z', 'h', 'u', 'a', 'n', 'g'];
    const seq = sequence.create(keys);
    for (let i = 0; i < keys.length; i++) {
        assert.equal(seq.depth, i);
        assert.deepEqual(arr(sequence.nextKeys(seq)), [keys[i]]);
        assert.equal(sequence.pendingKey(seq), i + 1 < keys.length ? keys[i + 1] : null);
        assert.equal(sequence.total(seq), keys.length);
        assert.equal(sequence.isLast(seq), i === keys.length - 1);
        const complete = sequence.advance(seq, keys[i]);
        assert.equal(complete, i === keys.length - 1, '第 ' + (i + 1) + ' 键的敲完判定');
        assert.equal(seq.depth, i + 1, '进度必须恰好前进一格');
    }
});

// 9g 多音字：两条读音各给一个候选键，敲任一条都能走完。等长约束（config.test 逐字钉）
// 保证 total 恒定、isLast 在两条读音上同时成立，所以消除时机唯一、进度点数有定义
test('多音字（行 xing / hang）：任一读音都能逐键走完，消除时机唯一', function () {
    const readings = [['x', 'i', 'n', 'g'], ['h', 'a', 'n', 'g']];
    for (const reading of readings) {
        const seq = sequence.create(readings);
        assert.deepEqual(arr(sequence.nextKeys(seq)).sort(), ['h', 'x'], '两条读音各给一个首键');
        assert.equal(sequence.total(seq), 4, '等长所以总格数唯一');
        for (let i = 0; i < reading.length; i++) {
            assert.equal(sequence.isLast(seq), i === reading.length - 1,
                '走 ' + reading.join('') + ' 时第 ' + (i + 1) + ' 键的敲完判定');
            assert.equal(sequence.advance(seq, reading[i]), i === reading.length - 1);
            assert.equal(seq.depth, i + 1);
            assert.equal(sequence.total(seq), 4, '锁定读音后总格数不变（进度点不会少一格）');
        }
        assert.deepEqual(arr(sequence.nextKeys(seq)), [], '敲完之后没有待敲键');
    }
});

// 敲对第一键就锁定那条读音：存活路径按敲下的键过滤，另一条读音作废。
// 于是「行」敲 x 之后只剩 ing，再敲 a 是失误（hang 那条已经死了）——进度不回退这条通则照旧
test('多音字：敲对第一键就锁定那条读音，另一条作废', function () {
    const seq = sequence.create([['x', 'i', 'n', 'g'], ['h', 'a', 'n', 'g']]);
    assert.equal(sequence.advance(seq, 'x'), false);
    assert.equal(seq.paths.length, 1, '只剩 xing 那条');
    assert.deepEqual(arr(sequence.nextKeys(seq)), ['i']);
    assert.deepEqual(arr(seq.paths[0]), ['x', 'i', 'n', 'g']);
    // hang 那条已经死了：a 是它的第二键，现在敲它是无匹配
    assert.equal(sequence.advance(seq, 'a'), false, 'a 不在存活读音的待敲键里');
    assert.equal(seq.depth, 1, '不匹配的键绝不推进');
    assert.deepEqual(arr(sequence.nextKeys(seq)), ['i'], '状态原样');
});

// advance 收到不匹配的键必须**不改状态**：判定层已经先匹配过，走不到这一支；
// 真走到了也不能把一颗好星弄坏（清空 paths 会让 nextKeys 变空、白圈与判定一起失准）
test('advance：不匹配的键返回 false 且不改状态', function () {
    const seq = sequence.create(['h', 'a', 'o']);
    assert.equal(sequence.advance(seq, 'z'), false);
    assert.equal(seq.depth, 0);
    assert.deepEqual(nested(seq.paths), [['h', 'a', 'o']]);
    assert.deepEqual(arr(sequence.nextKeys(seq)), ['h']);
    assert.equal(sequence.isLast(seq), false, '空键序不会被误判成敲完');
});

// 两条读音在当前进度上是同一个键时，候选集合要去重：「的」de / di 都以 d 起头，
// 待敲键只有一个 d。不去重的话生成侧会把同一颗星数成占了两个 d 名额
test('nextKeys 去重：两条读音当前键相同时只给一个', function () {
    const seq = sequence.create([['d', 'e'], ['d', 'i']]);
    assert.deepEqual(arr(sequence.nextKeys(seq)), ['d']);
    assert.equal(sequence.pendingKey(seq), 'e', 'pendingKey 取规范路径（第一条读音）');
    assert.equal(sequence.advance(seq, 'd'), false);
    assert.deepEqual(arr(sequence.nextKeys(seq)).sort(), ['e', 'i'], '第二键才分岔');
    assert.equal(sequence.isLast(seq), true, '等长 ⇒ 两条同时到尽头，消除时机唯一');
    assert.equal(sequence.advance(seq, 'i'), true, '走 dì 那条也能敲完');
});

test('isLaterKey：只认进度之后的后续键，当前键与敲过的键都不算', function () {
    const seq = sequence.create(['h', 'a', 'o']);
    // 进度 0：当前是 h，后续 a/o 敲了都是顺序错
    assert.equal(sequence.isLaterKey(seq, 'a'), true);
    assert.equal(sequence.isLaterKey(seq, 'o'), true);
    assert.equal(sequence.isLaterKey(seq, 'h'), false, '当前键不是"后续键"');
    assert.equal(sequence.isLaterKey(seq, 'x'), false);
    // 推进到 a：o 仍是后续，h 已敲过不算，a 是当前键
    sequence.advance(seq, 'h');
    assert.equal(sequence.isLaterKey(seq, 'o'), true);
    assert.equal(sequence.isLaterKey(seq, 'a'), false);
    assert.equal(sequence.isLaterKey(seq, 'h'), false, '敲过的键不算顺序错');
    // 单键星没有任何后续键
    assert.equal(sequence.isLaterKey(sequence.create(['k']), 'k'), false);
});

// 键序里允许重复键（如拼音 nian 的两个 n）：isLaterKey 只看进度之后，
// 不会因为前面敲过同一个键就把后面的同键漏掉
test('isLaterKey：键序含重复键时仍按位置认后续键', function () {
    const seq = sequence.create(['n', 'i', 'a', 'n']);
    assert.equal(sequence.isLaterKey(seq, 'n'), true, '末尾那个 n 还没轮到');
    sequence.advance(seq, 'n'); // 敲掉首个 n
    assert.equal(sequence.isLaterKey(seq, 'n'), true, '进度之后仍有一个 n');
    sequence.advance(seq, 'i');
    sequence.advance(seq, 'a');
    assert.equal(sequence.isLaterKey(seq, 'n'), false, '最后一个 n 已是当前键');
});

// 多音字的顺序错诊断要跨**全部存活读音**看：「行」还没锁定时，i（xing 的第二键）与
// a（hang 的第二键）都是"还没轮到的后续键"，读数得说清是顺序问题而不是屏幕上没这个键。
// 锁定之后只看存活那条
test('isLaterKey：多音字跨全部存活读音认后续键，锁定后只看存活那条', function () {
    const seq = sequence.create([['x', 'i', 'n', 'g'], ['h', 'a', 'n', 'g']]);
    assert.equal(sequence.isLaterKey(seq, 'i'), true, 'xing 的第二键');
    assert.equal(sequence.isLaterKey(seq, 'a'), true, 'hang 的第二键');
    assert.equal(sequence.isLaterKey(seq, 'g'), true, '两条读音的末键');
    assert.equal(sequence.isLaterKey(seq, 'x'), false, 'x 是当前待敲键');
    assert.equal(sequence.isLaterKey(seq, 'h'), false, 'h 也是当前待敲键');
    sequence.advance(seq, 'x');
    assert.equal(sequence.isLaterKey(seq, 'i'), false, '锁定后 i 已是当前待敲键，不是"后续键"');
    assert.equal(sequence.isLaterKey(seq, 'n'), true, 'xing 剩下的 n / g 仍是后续键');
    assert.equal(sequence.isLaterKey(seq, 'a'), false, 'hang 那条已经死了，a 不再是后续键');
});
