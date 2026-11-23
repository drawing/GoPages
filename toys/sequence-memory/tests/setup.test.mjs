import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const ns = load();
const Setup = ns.systems.Setup;

const isOpen = (preset) => ['mode', 'direction', 'speed']
    .every((key) => ns.ROADMAP[key][preset[key]] === true);

// 玩法档取代了原来的四组矩阵（harness/requirements.md1l）：档只管 模式 × 方向 × 速度，类型由首页的类型行给。
// 未开放的档不画也不置灰，所以 presets() 的输出就是玩家能看到的全部
test('玩法档只列已开放的，且每项都在 ROADMAP 里登记为 true', () => {
    const presets = Array.from(Setup.presets());

    // 3a 起休闲放开即完整（判定与冲榜同为即点即判，退格 / 容错不做，harness/requirements.md 3b）；
    // 3c 起倒序放开，挑战档（冲榜 · 倒序 · 快）进表
    assert.deepEqual(presets.map((preset) => preset.id), ['leisure', 'ranked', 'challenge']);
    assert.deepEqual(Array.from(ns.PRESETS.filter(isOpen), (preset) => preset.id), ['leisure', 'ranked', 'challenge']);
    assert.equal(presets[0].selected, true);
    assert.equal(presets[1].selected, false);

    for (const preset of presets) {
        const source = ns.PRESETS.find((item) => item.id === preset.id);
        assert.deepEqual(Object.keys({ ...preset.picks }).sort(), ['direction', 'mode', 'speed']);
        for (const key of ['mode', 'direction', 'speed']) {
            assert.equal(preset.picks[key], source[key]);
            assert.equal(ns.ROADMAP[key][preset.picks[key]], true);
        }
    }

    // 玩家可见文案不带阶段号（harness/ui.md）；locked 那一态随速度档退出玩家链路而作废
    assert.deepEqual({ ...ns.MARKS }, { pending: '未开放' });
    assert.doesNotMatch(JSON.stringify(presets), /阶段/);
    assert.doesNotMatch(JSON.stringify(presets), /接入/);
});

// 档给出的组合必须是"现在就能开局"的：normalize 不该把它改成别的档。
// 各档的组合键互不相同，否则记录（第六节的组合键）会串到同一张榜上
test('每个开放档 normalize 之后还是它自己，各档组合键互不相同', () => {
    const open = Array.from(ns.PRESETS).filter(isOpen);
    const base = { ...Setup.normalize() };
    const keys = new Set();

    for (const preset of open) {
        const picks = Setup.normalize({ mode: preset.mode, direction: preset.direction, speed: preset.speed });
        assert.deepEqual({ ...picks }, { ...base, mode: preset.mode, direction: preset.direction, speed: preset.speed });
        keys.add([picks.mode, picks.direction, picks.speed].join('/'));
    }

    assert.equal(keys.size, open.length);
    assert.ok(open.length >= 1);
});

// 回落认**默认档**不认表序（harness/architecture.md 已知坑）：速度若跟着模式回落到
// SPEEDS[0] = 慢，默认组合就成了"休闲 · 慢"、一个胶囊都不高亮。3c 起速度直接从 PRESETS 取，
// 这类坑在结构上消失，这条仍钉"默认草稿正好选中第一项"
test('默认组合正好是 PRESETS 第一项，未知速度回落默认档而不是慢', () => {
    const picks = Setup.normalize();
    const first = ns.PRESETS[0];

    assert.equal(picks.mode, first.mode);
    assert.equal(picks.direction, first.direction);
    assert.equal(picks.speed, first.speed);
    assert.equal(Setup.presets(picks).find((preset) => preset.id === first.id).selected, true);

    // 这个坑成立的前提：表序第一项不是默认档
    assert.notEqual(ns.SPEEDS[0].id, ns.DEFAULTS.speed);
    assert.equal(ns.DEFAULTS.speed, 'normal');
    assert.equal(Setup.normalize({ speed: 'nope' }).speed, ns.DEFAULTS.speed);
});

// 3c 拍板（harness/gameplay.md）：速度由玩法档决定，不是自由选项。冲榜正序锁默认档
// 为了记录可比；挑战（冲榜 · 倒序）自带快档——组合键含速度档，挑战记录只跟挑战比，
// 快档从此可达。休闲没有倒序档，方向回落到正序。草稿永远正好落在一个胶囊上
test('速度由玩法档决定：冲榜正序锁默认，挑战自带快档，休闲不倒序', () => {
    assert.equal(Setup.normalize({ mode: 'ranked', direction: 'forward', speed: 'fast' }).speed,
        ns.defaultSettings().speed);

    const challenge = Setup.normalize({ mode: 'ranked', direction: 'backward' });
    assert.equal(challenge.mode, 'ranked');
    assert.equal(challenge.direction, 'backward');
    assert.equal(challenge.speed, 'fast');

    const leisureBack = Setup.normalize({ mode: 'leisure', direction: 'backward' });
    assert.equal(leisureBack.mode, 'leisure');
    assert.equal(leisureBack.direction, 'forward');
    assert.equal(leisureBack.speed, 'normal');

    for (const draft of [{}, { mode: 'ranked', direction: 'backward', speed: 'slow' },
        { mode: 'leisure', direction: 'backward' }, { mode: 'nope', direction: 'nope', speed: 'nope' }]) {
        const picks = Setup.normalize(draft);
        const selected = Array.from(Setup.presets(picks)).filter((preset) => preset.selected);
        assert.equal(selected.length, 1);
    }
});

test('未实现与未知 id 都回落到能玩的组合，快照每次是新对象', () => {
    const picks = Setup.normalize({ type: 'nope', mode: 'leisure', direction: 'backward', speed: 'nope' });
    assert.equal(picks.type, 'color');
    // 休闲 3a 起已开放，不再被回落掉；休闲没有倒序档，方向回落到正序（3c）
    assert.equal(picks.mode, 'leisure');
    assert.equal(picks.direction, 'forward');
    // 未知速度回落到**默认档**，不是 SPEEDS[0] = 慢（下面那条专门钉它）
    assert.equal(picks.speed, 'normal');

    const taken = Setup.snapshot(picks);
    taken.type = 'digit';
    taken.sound = false;
    const fresh = Setup.snapshot(picks);
    assert.equal(fresh.type, 'color');
    assert.equal(fresh.sound, true);
    assert.equal(fresh.startLength, ns.START_LENGTH);
    assert.equal(ns.defaultSettings().sound, true);
});

test('待开局的选择归 systems：跨场景读写，写进去之前先归一', () => {
    assert.deepEqual(Setup.draft(), Setup.normalize());

    // 未知类型与冲榜锁住的速度档都要被归一掉，所以 draft 永远是现在就能开局的组合。
    // 展开成本地对象再比：draft 跨 realm，原型不是本地 Object，deepEqual 会先卡在原型上
    Setup.use({ type: 'nope', mode: 'ranked', speed: 'fast' });
    assert.deepEqual({ ...Setup.draft() }, { type: 'color', mode: 'ranked', direction: 'forward', speed: 'normal' });
    assert.equal(Setup.snapshot(Setup.draft()).startLength, ns.START_LENGTH);

    // 首页点类型行直接开局：写进草稿的类型要在快照里活着（harness/ui.md）
    Setup.use({ ...Setup.draft(), type: 'color' });
    assert.equal(Setup.snapshot(Setup.draft()).type, 'color');
});
