import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const ns = load();
const make = (opts) => ns.systems.SequenceGenerator.create(opts);

test('长度阶梯：首关等于起始长度，每关 +1，关次同步', () => {
    const gen = make({ symbols: 4, startLength: 2, random: () => 0.1 });
    assert.equal(gen.round(), 0);
    assert.equal(gen.current().length, 0);
    assert.equal(gen.next().length, 2);
    assert.equal(gen.next().length, 3);
    assert.equal(gen.next().length, 4);
    assert.equal(gen.round(), 3);
    assert.equal(gen.length(), 4);
});

test('每一项都是符号集内的整数下标，含随机源取到两端的情况', () => {
    const edges = [0, 0.999999];
    let i = 0;
    const gen = make({ symbols: 4, startLength: 6, random: () => edges[i++ % edges.length] });
    const seq = Array.from(gen.next());
    assert.deepEqual(seq, [0, 3, 0, 3, 0, 3]);
    for (const item of seq) {
        assert.ok(Number.isInteger(item) && item >= 0 && item < 4);
    }
});

test('current() 给拷贝，外部改动不污染本关；reset 回到未开局', () => {
    const gen = make({ symbols: 4, startLength: 2, random: () => 0.5 });
    gen.next();
    const taken = gen.current();
    taken[0] = 99;
    taken.push(99);
    // 相邻重复项是允许的，不做去重：Simon 原版也允许，靠项间间隔区分两次亮起
    assert.deepEqual(Array.from(gen.current()), [2, 2]);
    gen.reset();
    assert.equal(gen.round(), 0);
    assert.equal(gen.current().length, 0);
    assert.equal(gen.next().length, 2);
});

test('起始长度缺省回落到 START_LENGTH，不同随机源给出不同序列', () => {
    const low = make({ symbols: 10, random: () => 0.05 });
    const high = make({ symbols: 10, random: () => 0.95 });
    assert.deepEqual(Array.from(low.next()), [0, 0]);
    assert.deepEqual(Array.from(high.next()), [9, 9]);
    assert.equal(low.length(), ns.START_LENGTH);
});

// 2d：扑克无放回抽取（TYPES.card.unique，harness/gameplay.md "扑克序列无重复牌"）——
// 一关之内不重不漏，长度以符号集封顶；另三种类型仍允许相邻重复（上面第三条钉着）
test('无放回抽取：一关之内不重复，长度以符号集封顶', () => {
    const gen = make({ symbols: 10, startLength: 2, unique: true, random: () => 0.5 });
    for (let round = 0; round < 12; round += 1) {
        const seq = Array.from(gen.next());
        assert.equal(new Set(seq).size, seq.length);
        for (const item of seq) {
            assert.ok(Number.isInteger(item) && item >= 0 && item < 10);
        }
    }
    // 第 12 关名义长度 13，封顶到符号集 10
    assert.equal(gen.length(), 10);

    // 随机源取两端也不越界、不重复：0 恒等置换，0.999999 每次换到末尾
    for (const value of [0, 0.999999]) {
        const edge = make({ symbols: 52, startLength: 8, unique: true, random: () => value });
        const seq = Array.from(edge.next());
        assert.equal(seq.length, 8);
        assert.equal(new Set(seq).size, 8);
        for (const item of seq) {
            assert.ok(item >= 0 && item < 52);
        }
    }

    // 抽满整副就是一个 permutation：52 张不重不漏
    const full = make({ symbols: 52, startLength: 52, unique: true });
    assert.deepEqual(Array.from(full.next()).sort((a, b) => a - b),
        Array.from({ length: 52 }, (_, i) => i));
});

// 3a：休闲的累积追加（MODES.generate = 'append'，harness/gameplay.md）——每关重播整段旧序列 +
// 末尾新增 1 项。长度阶梯与冲榜一样（起始长度 + 关次 - 1），差的只是"旧的那一段换不换"
test('追加生成：旧前缀一字不动，每关只在末尾多一项', () => {
    const gen = make({ symbols: 4, startLength: 2, generate: 'append', random: () => 0.5 });
    const first = Array.from(gen.next());
    assert.equal(first.length, 2);

    const second = Array.from(gen.next());
    assert.deepEqual(second.slice(0, first.length), first);
    assert.equal(second.length, first.length + 1);

    const third = Array.from(gen.next());
    assert.deepEqual(third.slice(0, second.length), second);
    assert.equal(third.length, 4);
    assert.equal(gen.round(), 3);

    // 冲榜（fresh，也是缺省）不留旧前缀：换一个随机源，第二关的前两项就与第一关不同。
    // 常值随机源看不出这条差别——两边都会是"前缀不动"
    let i = 0;
    const values = [0.1, 0.1, 0.9, 0.9, 0.9];
    const fresh = make({ symbols: 4, startLength: 2, random: () => values[i++ % values.length] });
    const f1 = Array.from(fresh.next());
    const f2 = Array.from(fresh.next());
    assert.deepEqual(f1, [0, 0]);
    assert.deepEqual(f2, [3, 3, 3]);
    assert.equal(f2.length, f1.length + 1);
    assert.equal(make({ symbols: 4, generate: 'fresh' }).next().length, ns.START_LENGTH);
});

// 追加 + 无放回（扑克）：新增那一项要在"还没用过的符号"里抽，否则它会撞上旧序列里的某一张，
// 而"选过置灰不可再选"正是建在不重复上面（harness/gameplay.md）。抽满整副就没有新项可加，长度封顶
test('追加生成碰上无放回：新项不与旧项重复，抽满符号集后长度封顶', () => {
    const gen = make({ symbols: 6, startLength: 2, unique: true, generate: 'append', random: () => 0.5 });
    let previous = Array.from(gen.next());
    assert.equal(previous.length, 2);

    for (let round = 2; round <= 4; round += 1) {
        const next = Array.from(gen.next());
        assert.deepEqual(next.slice(0, previous.length), previous);
        assert.equal(next.length, previous.length + 1);
        assert.equal(new Set(next).size, next.length);
        for (const item of next) {
            assert.ok(Number.isInteger(item) && item >= 0 && item < 6);
        }
        previous = next;
    }

    // 长度 6 已抽满符号集：再 next() 不重复也不越界，长度停在这里、这一关重播同一条
    gen.next();
    gen.next();
    const full = Array.from(gen.current());
    assert.equal(gen.round(), 6);
    assert.equal(full.length, 6);
    assert.deepEqual(full.sort((a, b) => a - b), [0, 1, 2, 3, 4, 5]);
});