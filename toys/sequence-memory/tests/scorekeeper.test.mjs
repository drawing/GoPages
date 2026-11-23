import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const ns = load();
const Storage = ns.systems.Storage;
const ScoreKeeper = ns.systems.ScoreKeeper;

function fakeBackend() {
    const map = new Map();
    return {
        map,
        getItem(key) { return map.has(key) ? map.get(key) : null; },
        setItem(key, value) { map.set(key, String(value)); },
        removeItem(key) { map.delete(key); }
    };
}

// 结算快照的鸭子类型：submit 只读 settings / score / wrongAt / ms / taps
function run(type, score, extra) {
    return Object.assign({
        settings: { type: type, mode: 'ranked', direction: 'forward', speed: 'normal' },
        score: score,
        wrongAt: 0,
        ms: 1000,
        taps: 10
    }, extra || {});
}

// 提交结果里"最高与破纪录"那三件。参照字段（percentile / rank / rankTotal，5d）另有专测，
// 不在这里连带钉住——它们随常模数据变，钉在一起会让改常模的提交动到不相干的断言
function outcome(result) {
    return { best: result.best, previous: result.previous, isRecord: result.isRecord };
}

test('组合键收敛到 TYPES × PRESETS：12 个合法键，PRESETS 没覆盖的组合不产生记录', () => {
    const keeper = new ScoreKeeper(new Storage(fakeBackend()));
    let count = 0;
    for (const type of ns.TYPES) {
        for (const preset of ns.PRESETS) {
            const picks = { type: type.id, mode: preset.mode, direction: preset.direction, speed: preset.speed };
            assert.ok(ScoreKeeper.comboKey(picks));
            count += 1;
        }
    }
    assert.equal(count, ns.TYPES.length * ns.PRESETS.length);

    // 冲榜 · 正序 · 快不是任何一个玩法档（冲榜锁默认速）：不产生记录，读也是 null
    const uncovered = { type: 'color', mode: 'ranked', direction: 'forward', speed: 'fast' };
    assert.equal(ScoreKeeper.comboKey(uncovered), null);
    assert.equal(keeper.submit(run('color', 5, { settings: uncovered })), null);
    assert.equal(keeper.bestOf(uncovered), null);
});

test('最高只升不降，破纪录判定与达成日期一起算完交回', () => {
    const keeper = new ScoreKeeper(new Storage(fakeBackend()));
    const picks = { type: 'digit', mode: 'ranked' };

    assert.equal(keeper.bestOf(picks), null);
    const first = keeper.submit(run('digit', 6));
    assert.deepEqual(outcome(first), { best: 6, previous: 0, isRecord: true });
    assert.ok(keeper.recordOf(picks).bestAt > 0);

    // 低分不改最高，也不刷新达成日期
    const bestAt = keeper.recordOf(picks).bestAt;
    const second = keeper.submit(run('digit', 4));
    assert.deepEqual(outcome(second), { best: 6, previous: 6, isRecord: false });
    assert.equal(keeper.recordOf(picks).bestAt, bestAt);

    const third = keeper.submit(run('digit', 8));
    assert.deepEqual(outcome(third), { best: 8, previous: 6, isRecord: true });
    assert.equal(keeper.bestOf(picks), 8);
});

test('最近 20 局只留最新：超出的左滚，累计错次 / 用时 / 输入数不丢', () => {
    const keeper = new ScoreKeeper(new Storage(fakeBackend()));
    const picks = { type: 'position', mode: 'ranked' };
    for (let i = 1; i <= ns.HISTORY_LIMIT + 5; i += 1) {
        keeper.submit(run('position', i));
    }
    const record = keeper.recordOf(picks);
    assert.equal(record.runs.length, ns.HISTORY_LIMIT);
    // 留下的是最新 20 局（6..25），最旧的 5 局滚出去
    assert.deepEqual(Array.from(record.runs, (r) => r.score),
        Array.from({ length: ns.HISTORY_LIMIT }, (_, i) => i + 6));
    assert.equal(record.errors, ns.HISTORY_LIMIT + 5);
    assert.equal(record.ms, (ns.HISTORY_LIMIT + 5) * 1000);
    assert.equal(record.taps, (ns.HISTORY_LIMIT + 5) * 10);
    assert.equal(record.best, ns.HISTORY_LIMIT + 5);
});

test('不同组合互不串键，刷新（换实例同一后端）后历史最高还在', () => {
    const backend = fakeBackend();
    const keeper = new ScoreKeeper(new Storage(backend));
    keeper.submit(run('digit', 7));
    keeper.submit({ ...run('color', 4), settings: { type: 'color', mode: 'leisure', direction: 'forward', speed: 'normal' } });
    keeper.submit({ ...run('digit', 5), settings: { type: 'digit', mode: 'ranked', direction: 'backward', speed: 'fast' } });

    assert.equal(keeper.bestOf({ type: 'digit', mode: 'ranked' }), 7);
    assert.equal(keeper.bestOf({ type: 'color', mode: 'leisure' }), 4);
    assert.equal(keeper.bestOf({ type: 'digit', mode: 'ranked', direction: 'backward', speed: 'fast' }), 5);
    assert.equal(keeper.bestOf({ type: 'card' }), null);

    // 刷新 = 新实例读同一份盘：记录还在（5a 验收点）
    const refreshed = new ScoreKeeper(new Storage(backend));
    assert.equal(refreshed.bestOf({ type: 'digit', mode: 'ranked' }), 7);
    assert.equal(refreshed.recordOf({ type: 'digit', mode: 'ranked' }).runs.length, 1);
});

test('读值校验：坏字段归零、坏局丢弃、未知键趁落盘清掉，__proto__ 查不到真值', () => {
    const backend = fakeBackend();
    // null 原型对象才装得下 '__proto__' 自有键（普通字面量里它是原型 setter）
    const dirty = Object.create(null);
    dirty['digit-ranked-forward-normal'] = {
        best: '7', bestAt: -1, errors: 2.9, ms: null, taps: 3,
        runs: [{ score: 5, at: 123 }, null, 'bad', { at: 456 }]
    };
    dirty['color-leisure-forward-normal'] = 'not an object';
    dirty['made-up-key'] = { best: 99 };
    dirty['__proto__'] = { best: 99 };
    backend.map.set(ns.STORAGE_NS + '.records', JSON.stringify(dirty));
    const keeper = new ScoreKeeper(new Storage(backend));

    const record = keeper.recordOf({ type: 'digit', mode: 'ranked' });
    assert.equal(record.best, 0);          // 字符串不认
    assert.equal(record.bestAt, 0);        // 负数不认
    assert.equal(record.errors, 2);        // 小数向下取整
    assert.equal(record.ms, 0);
    assert.equal(record.taps, 3);
    // 坏局丢弃，缺 score 的局按 0 分留下（曲线上的一个点，不是崩溃）
    assert.deepEqual(Array.from(record.runs, (r) => r.score), [5, 0]);
    assert.equal(keeper.bestOf({ type: 'color', mode: 'leisure' }), null);
    assert.equal(keeper.recordOf({ type: 'card' }), null);

    // 提交一次，未知键与坏记录趁这次落盘清掉
    keeper.submit(run('digit', 6));
    const stored = JSON.parse(backend.map.get(ns.STORAGE_NS + '.records'));
    assert.deepEqual(Object.keys(stored).sort(), ['digit-ranked-forward-normal']);
    assert.equal(stored['digit-ranked-forward-normal'].best, 6);
});

test('最高为 0 视同没有记录：界面显示 –，但 0 分局仍进曲线与累计', () => {
    const keeper = new ScoreKeeper(new Storage(fakeBackend()));
    keeper.submit(run('color', 0));
    assert.equal(keeper.bestOf({ type: 'color', mode: 'ranked' }), null);
    const record = keeper.recordOf({ type: 'color', mode: 'ranked' });
    assert.equal(record.runs.length, 1);
    assert.equal(record.errors, 1);
});

test('隐私模式退回内存：同一份 storage 跨实例共享，本会话记录不丢', () => {
    const memory = new Storage(null);
    const a = new ScoreKeeper(memory);
    const b = new ScoreKeeper(memory);
    a.submit(run('digit', 7));
    assert.equal(b.bestOf({ type: 'digit', mode: 'ranked' }), 7);
});

// ---- 记录页素材 typeBoard（5b）----

function preset(id) {
    return ns.PRESETS.find((item) => item.id === id);
}

// 按玩法档提交一局：taps 固定 1，于是这一档的平均复现用时 = 各局 ms 的平均值（传同一个 ms 就等于它）
function play(keeper, type, preset, score, ms) {
    return keeper.submit(run(type, score, {
        settings: { type: type, mode: preset.mode, direction: preset.direction, speed: preset.speed },
        ms: ms,
        taps: 1
    }));
}

function ids(entries) {
    return Array.from(entries, (entry) => entry.preset.id);
}

test('typeBoard：12 个组合各读自己那一份，一张卡都不串键（5b 验收点）', () => {
    const keeper = new ScoreKeeper(new Storage(fakeBackend()));
    const scores = new Map();
    let n = 1;
    ns.TYPES.forEach((type) => {
        ns.PRESETS.forEach((item) => {
            scores.set(type.id + '/' + item.id, n);
            play(keeper, type.id, item, n, n * 100);
            n += 1;
        });
    });

    ns.TYPES.forEach((type) => {
        const board = keeper.typeBoard(type.id);
        assert.equal(board.ranked.length + board.leisure.length, ns.PRESETS.length);
        ids(board.leisure).forEach((id) => assert.ok(board.ranked.every((entry) => entry.preset.id !== id)));

        Array.from(board.ranked).concat(Array.from(board.leisure)).forEach((entry) => {
            const wanted = scores.get(type.id + '/' + entry.preset.id);
            assert.equal(entry.picks.type, type.id);
            assert.equal(entry.best, wanted);
            assert.equal(entry.errors, 1);                 // 一局一次错，累计没吃到别的组合
            assert.equal(entry.avg, wanted * 100);         // ms / taps 也没吃到别的组合
        });
    });
});

test('typeBoard：tie-break 三顺位——最高 desc → 总错次 asc → 平均复现 asc → 玩法档原序', () => {
    // 最高不同：高的在前
    let keeper = new ScoreKeeper(new Storage(fakeBackend()));
    play(keeper, 'digit', preset('ranked'), 6, 900);
    play(keeper, 'digit', preset('challenge'), 9, 900);
    assert.deepEqual(ids(keeper.typeBoard('digit').ranked), ['challenge', 'ranked']);

    // 最高相同、总错次不同：错次少的在前（平均复现更慢也照样在前）
    keeper = new ScoreKeeper(new Storage(fakeBackend()));
    for (let i = 0; i < 5; i += 1) { play(keeper, 'digit', preset('ranked'), i === 0 ? 7 : 1, 1200); }
    for (let i = 0; i < 3; i += 1) { play(keeper, 'digit', preset('challenge'), i === 0 ? 7 : 1, 1500); }
    assert.deepEqual(ids(keeper.typeBoard('digit').ranked), ['challenge', 'ranked']);

    // 最高与总错次都相同：平均复现用时短的在前
    keeper = new ScoreKeeper(new Storage(fakeBackend()));
    for (let i = 0; i < 3; i += 1) { play(keeper, 'digit', preset('ranked'), i === 0 ? 7 : 1, 1500); }
    for (let i = 0; i < 3; i += 1) { play(keeper, 'digit', preset('challenge'), i === 0 ? 7 : 1, 1200); }
    assert.deepEqual(ids(keeper.typeBoard('digit').ranked), ['challenge', 'ranked']);

    // 三者全同：回落玩法档原序（顺序必须确定，不许随读盘抖）
    keeper = new ScoreKeeper(new Storage(fakeBackend()));
    play(keeper, 'digit', preset('challenge'), 7, 1000);
    play(keeper, 'digit', preset('ranked'), 7, 1000);
    assert.deepEqual(ids(keeper.typeBoard('digit').ranked), ['ranked', 'challenge']);
});

test('typeBoard：休闲单独一组不参与冲榜档的顺序，没玩过的档留在榜里排最后', () => {
    const keeper = new ScoreKeeper(new Storage(fakeBackend()));
    // 休闲打得比两个冲榜档都高：它不进 ranked，也不把 ranked 的顺序带偏
    play(keeper, 'color', preset('leisure'), 12, 900);
    play(keeper, 'color', preset('ranked'), 5, 900);

    const board = keeper.typeBoard('color');
    assert.deepEqual(ids(board.ranked), ['ranked', 'challenge']);
    assert.deepEqual(ids(board.leisure), ['leisure']);
    board.ranked.forEach((entry) => assert.equal(ns.modeById(entry.picks.mode).ranked, true));
    board.leisure.forEach((entry) => assert.equal(ns.modeById(entry.picks.mode).ranked, false));
    assert.equal(board.leisure[0].best, 12);

    // 没玩过的挑战档仍在榜里（不是被 filter 掉）：best 为 null、累计为 0，排在有记录的后面
    assert.equal(board.ranked[1].best, null);
    assert.equal(board.ranked[1].errors, 0);
    assert.equal(board.ranked[1].avg, null);
});

test('typeBoard：taps 为 0 时 avg 是 null 不是 NaN，缺平均用时的排后面（两种摆法都成立）', () => {
    function boardWith(ranked, challenge) {
        const backend = fakeBackend();
        backend.map.set(ns.STORAGE_NS + '.records', JSON.stringify({
            'digit-ranked-forward-normal': ranked,
            'digit-ranked-backward-fast': challenge
        }));
        return new ScoreKeeper(new Storage(backend)).typeBoard('digit');
    }
    const noTaps = { best: 7, bestAt: 1, errors: 2, ms: 0, taps: 0, runs: [] };
    const withTaps = { best: 7, bestAt: 2, errors: 2, ms: 2400, taps: 2, runs: [] };

    // comparator 出 NaN 的话 sort 结果会取决于输入次序，所以两个方向都要钉一遍
    assert.deepEqual(ids(boardWith(noTaps, withTaps).ranked), ['challenge', 'ranked']);
    assert.deepEqual(ids(boardWith(withTaps, noTaps).ranked), ['ranked', 'challenge']);
    assert.equal(boardWith(noTaps, withTaps).ranked[1].avg, null);
});

test('typeBoard：只打出 0 分的档 best 是 null（与 bestOf 同口径），总错次与平均复现仍在', () => {
    const keeper = new ScoreKeeper(new Storage(fakeBackend()));
    play(keeper, 'position', preset('ranked'), 0, 800);
    play(keeper, 'position', preset('ranked'), 0, 800);

    const entry = keeper.typeBoard('position').ranked.find((item) => item.preset.id === 'ranked');
    assert.equal(entry.best, null);
    assert.equal(entry.errors, 2);
    assert.equal(entry.avg, 800);
    assert.equal(keeper.bestOf({ type: 'position', mode: 'ranked' }), null);
});

// ---- 曲线素材（5c）：记录页只从 typeBoard 读，runs 跟着卡一起交出来 ----

test('typeBoard：每档的 runs 是它自己那 20 局，超出的左滚、不串键', () => {
    const keeper = new ScoreKeeper(new Storage(fakeBackend()));
    for (let i = 1; i <= ns.HISTORY_LIMIT + 4; i += 1) { play(keeper, 'digit', preset('ranked'), i, 900); }
    play(keeper, 'digit', preset('challenge'), 3, 900);

    const board = keeper.typeBoard('digit');
    const ranked = board.ranked.find((entry) => entry.preset.id === 'ranked');
    const challenge = board.ranked.find((entry) => entry.preset.id === 'challenge');

    // 最旧的 4 局滚出去，留下最新 20 局（5..24）：这就是"超 20 局左滚"的数据面
    assert.deepEqual(Array.from(ranked.runs, (run) => run.score),
        Array.from({ length: ns.HISTORY_LIMIT }, (_, i) => i + 5));
    assert.deepEqual(Array.from(challenge.runs, (run) => run.score), [3]);
    assert.equal(ranked.best, ns.HISTORY_LIMIT + 4);

    // 没玩过的档 runs 是空数组不是 undefined：场景据此走曲线的空态
    assert.deepEqual(Array.from(board.leisure[0].runs), []);
    assert.equal(board.leisure[0].best, null);
});

test('typeBoard：runs 按先后排不按分数排（横轴是局序），0 分的局也在曲线上', () => {
    const keeper = new ScoreKeeper(new Storage(fakeBackend()));
    [4, 0, 7, 5].forEach((score) => play(keeper, 'color', preset('leisure'), score, 800));

    const entry = keeper.typeBoard('color').leisure[0];
    assert.deepEqual(Array.from(entry.runs, (run) => run.score), [4, 0, 7, 5]);
    assert.equal(entry.best, 7);                       // 最高只升不降，与曲线各说各的
    assert.ok(entry.runs.every((run) => run.at > 0));   // 每局带自己的时间戳
});

// ---- 参照数字（5d）：常模百分位与"历史第几好"都在提交 / 读档时算完，场景只拼句子 ----

test('submit 交回参照数字：冲榜档给常模百分位，休闲不给（落回历史第几好）', () => {
    const keeper = new ScoreKeeper(new Storage(fakeBackend()));

    const first = play(keeper, 'digit', preset('ranked'), 7, 900);
    assert.equal(first.percentile, 50);              // 正序常模均值就是 7
    assert.equal(first.rank, null);                  // 不足两局不给名次
    assert.equal(first.rankTotal, 1);

    const second = play(keeper, 'digit', preset('ranked'), 6, 900);
    assert.equal(second.percentile, ns.systems.Norms.percentile('digit', 'forward', 6));
    assert.equal(second.rank, 2);                    // 上一局的 7 比它好
    assert.equal(second.rankTotal, 2);
    assert.equal(second.isRecord, false);

    // 休闲的分数与常模不同量纲（累积追加、重播允许复述）：不查常模，只跟自己比
    play(keeper, 'digit', preset('leisure'), 9, 900);
    const leisure = play(keeper, 'digit', preset('leisure'), 15, 900);
    assert.equal(leisure.percentile, null);
    assert.equal(leisure.rank, 1);
    assert.equal(leisure.rankTotal, 2);
});

test('submit：无常模的类型只有名次，挑战档读倒序那一格常模，0 分局两个都不给', () => {
    const keeper = new ScoreKeeper(new Storage(fakeBackend()));

    play(keeper, 'card', preset('challenge'), 4, 900);
    const card = play(keeper, 'card', preset('challenge'), 3, 900);
    assert.equal(card.percentile, null);             // 扑克没有公开常模
    assert.equal(card.rank, 2);
    assert.equal(card.rankTotal, 2);

    // 挑战 = 冲榜 · 倒序 · 快：查的是倒序那一格（均值 5），拿正序的 7 当均值会把 5 说成垫底
    const challenge = play(keeper, 'digit', preset('challenge'), 5, 900);
    assert.equal(challenge.percentile, 50);

    const zero = play(keeper, 'card', preset('ranked'), 0, 900);
    assert.equal(zero.percentile, null);
    assert.equal(zero.rank, null);                   // 0 分是"没有成绩"，不是"垫底"
    assert.equal(zero.rankTotal, 1);
});

test('typeBoard：百分位挂在冲榜档的卡上，休闲 / 无常模类型 / 没记录的档都是 null', () => {
    const keeper = new ScoreKeeper(new Storage(fakeBackend()));
    play(keeper, 'digit', preset('ranked'), 7, 900);
    play(keeper, 'digit', preset('challenge'), 6, 900);
    play(keeper, 'digit', preset('leisure'), 15, 900);

    const board = keeper.typeBoard('digit');
    const ranked = board.ranked.find((entry) => entry.preset.id === 'ranked');
    const challenge = board.ranked.find((entry) => entry.preset.id === 'challenge');
    assert.equal(ranked.percentile, 50);
    assert.ok(challenge.percentile > 50);            // 倒序均值 5，6 项已经在均值之上
    assert.equal(board.leisure[0].percentile, null);
    assert.equal(board.leisure[0].best, 15);         // 休闲的成绩照存，只是不拿去查常模

    // 无常模的类型：三张卡一个百分位都没有（记录页那一句整句不画）
    play(keeper, 'card', preset('ranked'), 5, 900);
    const cards = keeper.typeBoard('card');
    assert.ok(Array.from(cards.ranked).concat(Array.from(cards.leisure))
        .every((entry) => entry.percentile === null));

    // 没玩过的档与只打出 0 分的档：best 是 null，百分位也跟着是 null
    assert.equal(cards.ranked.find((entry) => entry.preset.id === 'challenge').percentile, null);
    play(keeper, 'position', preset('ranked'), 0, 900);
    const zero = keeper.typeBoard('position').ranked.find((entry) => entry.preset.id === 'ranked');
    assert.equal(zero.best, null);
    assert.equal(zero.percentile, null);
});