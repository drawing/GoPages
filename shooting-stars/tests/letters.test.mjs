import test from 'node:test';
import assert from 'node:assert/strict';

import { load } from './load.mjs';

const ns = load();
const letters = ns.utils.letters;
const sequence = ns.utils.sequence;

// 9g 起 lowestMatch / markTargets 读的是 star.nextKeys（待敲键的**集合**），
// 单键星与单读音星的集合只有一个元素 = 原来那个 star.letter
function fakeStar(letter, y) {
    const star = { letter: letter, nextKeys: [letter], y: y, pulse: null };
    star.setPulse = function (value) { star.pulse = value; };
    return star;
}

// 多音字星（9g）：多个候选键，letter 是规范键（集合第一个）
function fakeUnitStar(nextKeys, y) {
    const star = { letter: nextKeys[0], nextKeys: Array.from(nextKeys), y: y, pulse: null };
    star.setPulse = function (value) { star.pulse = value; };
    return star;
}

// Star.syncKeys 做的事：从键序状态派生 nextKeys（待敲键集合）与 letter（规范键 = 集合第一个）。
// Array.from 把 vm 里的数组拷回本 realm，deepEqual 才不比原型
function sync(star, seq) {
    star.nextKeys = Array.from(sequence.nextKeys(seq));
    star.letter = star.nextKeys[0] || '';
    return star;
}

function fakeSeqStar(seq, y) {
    const star = { seq: seq, y: y, pulse: null };
    star.setPulse = function (value) { star.pulse = value; };
    return sync(star, seq);
}

test('loader：config → utils → systems 三层都装配进命名空间', function () {
    assert.equal(typeof ns.CONFIG.LETTER_MAX_SAME, 'number');
    assert.equal(typeof letters.pickLetter, 'function');
    assert.equal(typeof ns.systems.SpawnDirector, 'function');
    // RENDER_SCALE 由假 window 的 devicePixelRatio / innerWidth 算出，能证明 window 真的被读到了
    assert.equal(ns.RENDER_SCALE, 1);
});

test('handOf：按标准指法分手，表外键返回 null', function () {
    assert.equal(letters.handOf('a'), 'L');
    assert.equal(letters.handOf('5'), 'L');
    assert.equal(letters.handOf('y'), 'R');
    assert.equal(letters.handOf(';'), 'R');
    assert.equal(letters.handOf('?'), null);
});

test('weightOf：字母查频率表，数字与符号各给一档平权', function () {
    assert.equal(letters.weightOf('e'), 12.702);
    assert.equal(letters.weightOf('z'), 0.074);
    assert.equal(letters.weightOf('7'), 2.2);
    assert.equal(letters.weightOf(';'), 1.4);
});

test('pickLetter：候选被硬约束清空时返回 null，不放宽约束', function () {
    assert.equal(letters.pickLetter(['a'], { last: 'a' }), null);
    assert.equal(letters.pickLetter(['a'], { onScreen: ['a', 'a'] }), null);
    assert.equal(letters.pickLetter([], {}), null);
});

test('pickLetter：重复取样也不会撞上一个字母', function () {
    const pool = 'abcdef'.split('');
    for (let i = 0; i < 200; i++) {
        const key = letters.pickLetter(pool, { last: 'a', onScreen: ['b', 'b'] });
        assert.notEqual(key, 'a');
        assert.ok(pool.includes(key));
    }
});

test('pickLetter：exclude 里的字母绝对不挑，即使 onScreen 没满', function () {
    const pool = 'abc'.split('');
    for (let i = 0; i < 100; i++) {
        const key = letters.pickLetter(pool, { exclude: ['a', 'b'] });
        assert.equal(key, 'c');
    }
    // exclude 清空候选时返回 null，不放宽
    assert.equal(letters.pickLetter(pool, { exclude: ['a', 'b', 'c'] }), null);
    // exclude 与 last / onScreen 叠加：三条约束同时生效
    assert.equal(letters.pickLetter(pool, { last: 'c', exclude: ['a'], onScreen: ['b', 'b'] }), null);
});

// 9c 专练的纯池：符号键全在右手，"连续同手 40%"退化为全同手（异手候选为空的分支兜住）；
// 数字符号平权，纯池里取样仍在池内且不连续重复
test('pickLetter：纯符号池全同手不卡死，纯数字池取样都在池内', function () {
    const symbols = "-=[]',./;".split('');
    for (let i = 0; i < 200; i++) {
        const key = letters.pickLetter(symbols, { last: ';' });
        assert.ok(key && symbols.includes(key) && key !== ';');
    }
    const digits = '0123456789'.split('');
    for (let i = 0; i < 200; i++) {
        const key = letters.pickLetter(digits, { last: '0' });
        assert.ok(digits.includes(key) && key !== '0');
    }
});

test('lowestMatch：同字母取 y 最大的那颗', function () {
    const high = fakeStar('k', 120);
    const low = fakeStar('k', 400);
    assert.equal(letters.lowestMatch([high, low], 'k'), low);
    assert.equal(letters.lowestMatch([high, low], 'x'), null);
});

// 判定（lowestMatch）与视觉辅助（markTargets）必须指向同一颗星，否则玩家会觉得判定随机
test('命中目标就是亮脉冲的那颗', function () {
    const stars = [fakeStar('k', 100), fakeStar('k', 420), fakeStar('z', 300)];
    letters.markTargets(stars);
    assert.equal(letters.lowestMatch(stars, 'k'), stars.find((star) => star.pulse));
});

test('codeToLetter：只认物理键位，大小写与 Shift 都影响不到它', function () {
    assert.equal(letters.codeToLetter('KeyA'), 'a');
    assert.equal(letters.codeToLetter('KeyZ'), 'z');
    assert.equal(letters.codeToLetter('Digit0'), '0');
    assert.equal(letters.codeToLetter('Digit9'), '9');
    assert.equal(letters.codeToLetter('Semicolon'), ';');
    assert.equal(letters.codeToLetter('Quote'), "'");
    assert.equal(letters.codeToLetter('BracketLeft'), '[');
});

test('codeToLetter：控制键、修饰键、小键盘返回 null，不计失误', function () {
    const ignored = ['Escape', 'Enter', 'Space', 'Tab', 'Backspace', 'ArrowUp', 'ShiftLeft',
        'ControlLeft', 'AltLeft', 'MetaLeft', 'CapsLock', 'Backquote', 'Backslash', 'Numpad1', 'F1', '', undefined];
    for (const code of ignored) {
        assert.equal(letters.codeToLetter(code), null, code);
    }
});

test('codeToLetter：45 键池每个字符都有唯一键位，没有键位落在池外', function () {
    const codes = [];
    for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') { codes.push('Key' + ch); }
    for (const ch of '0123456789') { codes.push('Digit' + ch); }
    codes.push('Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Quote', 'Semicolon', 'Comma', 'Period', 'Slash');

    const mapped = codes.map(letters.codeToLetter);
    const full = 'abcdefghijklmnopqrstuvwxyz0123456789-=[]\',./;';
    assert.equal(new Set(mapped).size, codes.length);
    assert.deepEqual(mapped.slice().sort(), full.split('').sort());

    for (const level of ns.LEVELS) {
        for (const ch of ns.levelFor('standard', level.id).pool) {
            assert.ok(mapped.includes(ch), 'Lv' + level.id + ' 的 ' + ch + ' 没有对应键位');
        }
    }
});

test('markTargets：只有重复字母里最低的那颗亮脉冲', function () {
    const dupHigh = fakeStar('k', 100);
    const dupLow = fakeStar('k', 420);
    const unique = fakeStar('z', 300);

    letters.markTargets([dupHigh, dupLow, unique]);

    assert.equal(dupLow.pulse, true);
    assert.equal(dupHigh.pulse, false);
    assert.equal(unique.pulse, false);
});

// 5d 双星：Star.letter 永远是"轮到敲的那一颗"，还没轮到的那颗挂在 pending 上，
// 所以判定与白圈不必认识双星（harness/architecture.md）——这条钉住那个契约
test('双星只有轮到敲的那颗是目标：pending 那个字母敲了就是无匹配', function () {
    const pair = fakeStar('t', 400);
    pair.pending = 'h';
    const other = fakeStar('h', 300);

    letters.markTargets([pair, other]);

    assert.equal(letters.lowestMatch([pair, other], 't'), pair, '轮到敲的那颗必须是目标');
    // 'h' 只匹配那颗普通星：双星的第二颗还没轮到，白圈也从不指着它（指着它就是撒谎）
    assert.equal(letters.lowestMatch([pair, other], 'h'), other);
    assert.equal(pair.pulse, false);
    assert.equal(other.pulse, false, '没有重复字母就不该亮圈');
});

// 9d 键序泛化：多键星的白圈永远指向"待敲键"，敲对推进后白圈跟着换键，
// 还没轮到的后续键敲了就是无匹配（双星顺序错规则推广到 N 键）。nextKeys / letter 是 seq 的
// 派生缓存，所以判定与白圈共用一份计算——这条钉住那个不变量
test('多键星白圈按待敲键匹配：推进后跟着换键，后续键敲了是无匹配', function () {
    const seq = sequence.create(['h', 'a', 'o']);
    const multi = fakeSeqStar(seq, 400);
    const other = fakeStar('a', 300);

    // 进度 0：待敲键 h；后续 a/o 还没轮到，'a' 只匹配那颗普通星，'o' 无匹配
    assert.equal(letters.lowestMatch([multi, other], 'h'), multi);
    assert.equal(letters.lowestMatch([multi, other], 'a'), other);
    assert.equal(letters.lowestMatch([multi, other], 'o'), null);

    // 敲对 h 推进到 a（Star.advance 做的事）：nextKeys 换成 [a]，判定与白圈自动跟着走
    sequence.advance(seq, 'h');
    sync(multi, seq);
    letters.markTargets([multi, other]);
    assert.equal(letters.lowestMatch([multi, other], 'a'), multi, '推进后最低优先按新键匹配');
    assert.equal(multi.pulse, true, '重复字母 a 里最低那颗（多键星）亮圈');
    assert.equal(other.pulse, false);

    // 再推进到 o：a 不再是它的键，白圈口径仍与判定一致
    sequence.advance(seq, 'a');
    sync(multi, seq);
    assert.equal(letters.lowestMatch([multi, other], 'o'), multi);
    assert.equal(letters.lowestMatch([multi, other], 'a'), other);
});

// 9g 多音字：任一读音都是合法目标，所以 lowestMatch 对它的**每个**候选键都返回它
test('多音字星：任一读音的待敲键都匹配它，后续键仍不匹配', function () {
    const xing = fakeUnitStar(['x', 'h'], 400);
    assert.equal(letters.lowestMatch([xing], 'x'), xing);
    assert.equal(letters.lowestMatch([xing], 'h'), xing);
    assert.equal(letters.lowestMatch([xing], 'a'), null, '后续键不参与匹配（敲它是顺序错）');
});

// 白圈的**保守口径**：多音字星只在"敲我任何一个候选键都掉我"时才亮。
// 「行」在上、「好」在下 ⇒ 敲 h 掉「好」、敲 x 掉「行」，所以「行」不亮——亮起来等于说
// "敲 h 也掉我"，是撒谎；「好」照旧亮。宁可少亮，不能撒谎
test('多音字白圈：只对部分候选键最低时不亮，共享那个键的单音字星照旧亮', function () {
    const xing = fakeUnitStar(['x', 'h'], 100);
    const hao = fakeStar('h', 400);
    letters.markTargets([xing, hao]);
    assert.equal(letters.lowestMatch([xing, hao], 'h'), hao, '敲 h 掉最低那颗');
    assert.equal(letters.lowestMatch([xing, hao], 'x'), xing, '敲 x 掉多音字星');
    assert.equal(xing.pulse, false, '对 h 不是最低 ⇒ 不亮');
    assert.equal(hao.pulse, true, 'h 与「行」共享、且它是最低 ⇒ 照旧亮');
});

// 反过来：多音字星在最低位时，它对每个候选键都是最低 ⇒ 亮；上面那颗单音字星不亮
test('多音字白圈：对每个候选键都最低且有共享时亮', function () {
    const xing = fakeUnitStar(['x', 'h'], 400);
    const hao = fakeStar('h', 100);
    letters.markTargets([xing, hao]);
    assert.equal(letters.lowestMatch([xing, hao], 'h'), xing);
    assert.equal(letters.lowestMatch([xing, hao], 'x'), xing);
    assert.equal(xing.pulse, true, '敲 x 或 h 掉的都是它，且 h 与别人共享 ⇒ 亮');
    assert.equal(hao.pulse, false, '敲 h 掉的是「行」不是它 ⇒ 不亮');
});

// 没有共享就不亮（与单键星同一条纪律）：独占自己那两个候选键时不需要消歧提示
test('多音字白圈：候选键没人共享就不亮', function () {
    const xing = fakeUnitStar(['x', 'h'], 400);
    const ma = fakeStar('m', 300);
    letters.markTargets([xing, ma]);
    assert.equal(xing.pulse, false, 'x 与 h 都只有它一个，没有歧义要提示');
    assert.equal(ma.pulse, false);
});

// 多音字推进后锁定一条读音：候选集合收窄成一个，白圈口径随之退回单键星那一套
test('多音字白圈：锁定读音后候选集合收窄，与单键星同一条口径', function () {
    const seq = sequence.create([['x', 'i', 'n', 'g'], ['h', 'a', 'n', 'g']]);
    const xing = fakeSeqStar(seq, 100);
    const hao = fakeStar('h', 400);
    assert.deepEqual(xing.nextKeys, ['x', 'h'], '候选键按读音表顺序');
    letters.markTargets([xing, hao]);
    assert.equal(xing.pulse, false, 'h 的最低是「好」⇒ 不亮');
    assert.equal(hao.pulse, true);

    sequence.advance(seq, 'x');
    sync(xing, seq);
    assert.deepEqual(xing.nextKeys, ['i'], 'hang 那条已死，只剩 xing');
    assert.equal(xing.letter, 'i', '规范键跟着收窄');
    letters.markTargets([xing, hao]);
    assert.equal(letters.lowestMatch([xing, hao], 'h'), hao, 'h 不再匹配「行」');
    assert.equal(xing.pulse, false, 'i 没人共享 ⇒ 不亮');
    assert.equal(hao.pulse, false, 'h 现在只有它一个 ⇒ 也不亮');
});

// 6e 触屏降级：tapMatch 只做几何（半径内最近圆心），判定仍是字母级——
// 点星的字母喂进 lowestMatch，与键盘走同一份消歧
test('tapMatch：半径内取圆心最近的点，边界含、半径外与空列表返回 null', function () {
    const near = { x: 100, y: 200, letter: 'a' };
    const far = { x: 140, y: 200, letter: 'b' };
    assert.equal(letters.tapMatch([far, near], 105, 200, 60), near);
    // 恰好落在半径上算命中（≤ 不是 <）
    assert.equal(letters.tapMatch([near], 160, 200, 60), near);
    assert.equal(letters.tapMatch([near], 161, 200, 60), null);
    assert.equal(letters.tapMatch([], 100, 200, 60), null);
});

test('触屏点高了也掉最低那颗：tapMatch 出字母，lowestMatch 消歧，与键盘同一条路', function () {
    const high = fakeStar('k', 100);
    const low = fakeStar('k', 420);
    // GameScene 摊平的点列：每颗星一个 {x, y, letter}
    const points = [
        { x: 200, y: high.y, letter: high.letter },
        { x: 500, y: low.y, letter: low.letter }
    ];
    const hit = letters.tapMatch(points, 210, 110, 60);
    assert.equal(hit.letter, 'k');
    assert.equal(letters.lowestMatch([high, low], hit.letter), low);
});
