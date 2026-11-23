import test from 'node:test';
import assert from 'node:assert/strict';

import { load } from './load.mjs';

const ns = load();
const Storage = ns.systems.Storage;
const NS = 'toys.shooting-stars';

// 最小 localStorage 鸭子类型：只有 getItem / setItem / removeItem，不模拟配额与事件
function backend(initial) {
    const data = new Map(Object.entries(initial || {}));
    return {
        data: data,
        getItem: (key) => (data.has(key) ? data.get(key) : null),
        setItem: (key, value) => { data.set(key, String(value)); },
        removeItem: (key) => { data.delete(key); }
    };
}

function run(score, hits, maxCombo) {
    return { score: score, hits: hits, maxCombo: maxCombo };
}

// 9a 起记录键 = 「方案@版本:档位-玩法」，标准方案初版 version 1
const key = (levelId, modeId) => Storage.bestKey('standard', levelId, modeId);

// 键名是跨会话契约：改了前缀或格式，玩家已存的最高分就读不回来了
test('落盘键名与格式：统一前缀，best 按「方案@版本:档位-玩法」存整数', function () {
    const disk = backend();
    const store = new Storage(disk);
    assert.equal(store.available, true);
    assert.equal(key(3, 'endless'), 'standard@1:3-endless');
    assert.equal(key(3, 'normal'), 'standard@1:3-normal');
    // 缺参与未知 id 回落默认方案 / 默认档 / 默认模式（与 levelById / modeById 同一套路）
    assert.equal(Storage.bestKey('nope', 99, 'nope'), 'standard@1:3-normal');

    store.submitRun('standard', 3, 'endless', run(1580, 40, 12));

    for (const k of disk.data.keys()) { assert.ok(k.startsWith(NS + '.'), k); }
    assert.equal(JSON.parse(disk.data.get(NS + '.best'))['standard@1:3-endless'], 1580);
    assert.deepEqual(JSON.parse(disk.data.get(NS + '.stats')), { runs: 1, hits: 40, maxCombo: 12 });
});

test('方案 × 玩法 × 档位分开记，低分不覆盖高分', function () {
    const store = new Storage(backend());
    store.submitRun('standard', 3, 'normal', run(1220, 30, 9));
    store.submitRun('standard', 3, 'endless', run(1580, 40, 12));
    store.submitRun('standard', 4, 'endless', run(900, 20, 6));

    const lower = store.submitRun('standard', 3, 'endless', run(100, 3, 2));
    assert.equal(lower.isRecord, false);
    assert.equal(lower.best, 1580);
    // 跨 realm 的对象原型不同，deepStrictEqual 会连原型一起比，先展开拷回本 realm
    assert.deepEqual({ ...store.bestMap() }, {
        'standard@1:3-normal': 1220, 'standard@1:3-endless': 1580, 'standard@1:4-endless': 900
    });
});

test('破纪录：首次有分即纪录，同分不算，更高分给出旧值', function () {
    const store = new Storage(backend());
    const first = store.submitRun('standard', 1, 'normal', run(200, 5, 3));
    assert.equal(first.best, 200);
    assert.equal(first.previous, 0);
    assert.equal(first.isRecord, true);
    assert.deepEqual({ ...first.totals }, { runs: 1, hits: 5, maxCombo: 3 });

    const tie = store.submitRun('standard', 1, 'normal', run(200, 5, 3));
    assert.equal(tie.isRecord, false);
    assert.equal(tie.previous, 200);

    const better = store.submitRun('standard', 1, 'normal', run(260, 7, 4));
    assert.equal(better.isRecord, true);
    assert.equal(better.previous, 200);
    assert.equal(better.best, 260);

    // 一局 0 分不该被当成破纪录
    assert.equal(new Storage(backend()).submitRun('standard', 2, 'normal', run(0, 0, 0)).isRecord, false);
});

test('累计三项：局数与击落累加，最高连击取历史最大，交出去的是拷贝（全局一份不分方案）', function () {
    const store = new Storage(backend());
    store.submitRun('standard', 3, 'normal', run(100, 10, 7));
    store.submitRun('standard', 3, 'endless', run(50, 4, 3));
    const third = store.submitRun('standard', 4, 'endless', run(80, 6, 5));

    assert.deepEqual({ ...third.totals }, { runs: 3, hits: 20, maxCombo: 7 });
    assert.deepEqual({ ...store.totals() }, { runs: 3, hits: 20, maxCombo: 7 });

    third.totals.runs = 999;
    assert.equal(store.totals().runs, 3);
});

test('隐私模式：setItem 抛异常也不抛出去，本会话仍读得到自己写的记录', function () {
    const disk = backend();
    disk.setItem = function () { throw new Error('QuotaExceededError'); };
    const store = new Storage(disk);

    assert.equal(store.available, false);
    assert.equal(store.submitRun('standard', 3, 'endless', run(1580, 40, 12)).best, 1580);
    assert.deepEqual({ ...store.bestMap() }, { 'standard@1:3-endless': 1580 });
    assert.deepEqual({ ...store.totals() }, { runs: 1, hits: 40, maxCombo: 12 });
    assert.equal(disk.data.size, 0);
});

// 配额中途写满：已落盘的留着，新记录只在内存，游戏不能因此中断
test('写盘中途失败：翻成不可用，内存里是最新值，盘上还是旧值', function () {
    const disk = backend();
    const store = new Storage(disk);
    store.submitRun('standard', 3, 'endless', run(1580, 40, 12));

    const setItem = disk.setItem;
    disk.setItem = function () { throw new Error('QuotaExceededError'); };
    const record = store.submitRun('standard', 3, 'endless', run(2000, 50, 15));

    assert.equal(record.isRecord, true);
    assert.equal(store.available, false);
    assert.equal(store.bestMap()['standard@1:3-endless'], 2000);
    assert.equal(store.totals().runs, 2);
    assert.equal(JSON.parse(disk.data.get(NS + '.best'))['standard@1:3-endless'], 1580);

    disk.setItem = setItem;
    store.submitRun('standard', 3, 'endless', run(10, 1, 1));
    assert.equal(store.available, true);
});

test('没有 localStorage：默认构造不抛，整局照常记在内存', function () {
    const store = new Storage();
    assert.equal(store.available, false);
    assert.equal(store.submitRun('standard', 3, 'normal', run(120, 6, 4)).best, 120);
    assert.deepEqual({ ...store.bestMap() }, { 'standard@1:3-normal': 120 });
    assert.equal(ns.systems.storage(), ns.systems.storage());
});

// localStorage 里的值是外部输入，可能被手改成任何东西
test('脏数据：非法键与非负整数以外的值全丢，坏 JSON 当没有，不污染原型', function () {
    const disk = backend({
        [NS + '.best']: '{"standard@1:3-endless":"abc","standard@1:3-normal":12.7,"standard@1:2-normal":-5,"standard@1:9-nope":999,"__proto__":{"polluted":true}}',
        [NS + '.stats']: 'not json'
    });
    const store = new Storage(disk);

    assert.deepEqual({ ...store.bestMap() }, { 'standard@1:3-normal': 12 });
    assert.deepEqual({ ...store.totals() }, { runs: 0, hits: 0, maxCombo: 0 });
    assert.equal({}.polluted, undefined);
    // 值坏了不等于存档不可用，下一次写入照样落盘
    assert.equal(store.available, true);
    assert.equal(store.submitRun('standard', 3, 'endless', run(5, 1, 1)).isRecord, true);
    assert.deepEqual({ ...store.bestMap() }, { 'standard@1:3-normal': 12, 'standard@1:3-endless': 5 });
});

// 9a 验收：标准方案旧最高分升级后原样可读。旧键「档位-玩法」一次性并进当前标准键并洗回盘
test('旧键迁移：legacy「档位-玩法」原样并进标准方案，落盘洗成新格式，脏键丢掉', function () {
    const disk = backend({
        [NS + '.best']: '{"3-endless":1580,"3-normal":1220,"2-normal":300,"9-nope":999,"__proto__":{"polluted":true}}'
    });
    const store = new Storage(disk);

    assert.deepEqual({ ...store.bestMap() }, {
        'standard@1:3-endless': 1580, 'standard@1:3-normal': 1220, 'standard@1:2-normal': 300
    });
    // 迁移一次性落盘：盘上已是新格式，旧键与脏键都不在了
    const onDisk = JSON.parse(disk.data.get(NS + '.best'));
    assert.deepEqual({ ...onDisk }, {
        'standard@1:3-endless': 1580, 'standard@1:3-normal': 1220, 'standard@1:2-normal': 300
    });
    assert.equal({}.polluted, undefined);
    // 再读一次走 cache，仍是新格式（幂等，不会反复迁移）
    assert.deepEqual({ ...store.bestMap() }, { ...onDisk });
    // 迁移后接着玩，旧最高分仍是门槛（1580 不被低分覆盖）
    assert.equal(store.submitRun('standard', 3, 'endless', run(100, 3, 2)).best, 1580);
});

test('迁移时新旧键并存：同一组合以新格式记录为准，旧键只补空缺', function () {
    const disk = backend({
        [NS + '.best']: '{"3-endless":100,"standard@1:3-endless":200,"4-normal":50}'
    });
    const store = new Storage(disk);
    assert.deepEqual({ ...store.bestMap() }, {
        'standard@1:3-endless': 200, 'standard@1:4-normal': 50
    });
});

// 方案带版本是封印开关：旧版本键落在合法集之外，读不到 ⇒ 不混算，新规则从零起
test('版本封印：旧版本记录读不到，新版本首局即破纪录，互不混算', function () {
    const disk = backend({
        [NS + '.best']: '{"standard@0:3-endless":999,"standard@1:3-normal":50}'
    });
    const store = new Storage(disk);
    // 当前 version 1：@0 那条封存读不到，@1 的正常读
    assert.deepEqual({ ...store.bestMap() }, { 'standard@1:3-normal': 50 });
    // 旧版本 999 不当门槛：新版本同一组合首局有分即纪录
    const record = store.submitRun('standard', 3, 'endless', run(10, 1, 1));
    assert.equal(record.isRecord, true);
    assert.equal(record.previous, 0);
    assert.equal(record.best, 10);
});

// 榜随方案走（9b 验收的前置）：未注册方案的键不并进任何已注册方案，跨方案分数不并列比较。
// 9c 起 letters / digits / symbols 已注册（它们的记录线见下一条测试），脏键要用真未注册的 id
test('方案隔离：未知方案的键丢弃，标准方案记录不受影响', function () {
    const disk = backend({
        [NS + '.best']: '{"pinyin@1:3-endless":500,"nope@1:3-endless":800,"standard@1:3-endless":200}'
    });
    const store = new Storage(disk);
    assert.deepEqual({ ...store.bestMap() }, { 'standard@1:3-endless': 200 });
    // 标准方案接着玩，门槛仍是自己的 200，不被别的方案的 500/800 抬高
    assert.equal(store.submitRun('standard', 3, 'endless', run(300, 8, 4)).previous, 200);
});

// 9c 验收：三专练方案与标准方案的记录互不串号——同档同玩法各记各的，门槛与破纪录判定各自独立
test('专练方案独立记录线：四方案同档同玩法各记各的，换实例读得回，累计仍全局一份', function () {
    const disk = backend();
    const store = new Storage(disk);
    store.submitRun('standard', 1, 'normal', run(100, 5, 3));
    store.submitRun('letters', 1, 'normal', run(200, 6, 4));
    store.submitRun('digits', 1, 'normal', run(300, 7, 5));
    store.submitRun('symbols', 1, 'normal', run(400, 8, 6));
    assert.deepEqual({ ...store.bestMap() }, {
        'standard@1:1-normal': 100, 'letters@1:1-normal': 200,
        'digits@1:1-normal': 300, 'symbols@1:1-normal': 400
    });

    // 各方案的门槛是自己的：数字专练低分不覆盖，字母专练换个玩法首局即破纪录
    assert.equal(store.submitRun('digits', 1, 'normal', run(50, 2, 1)).previous, 300);
    assert.equal(store.submitRun('letters', 1, 'endless', run(10, 1, 1)).isRecord, true);

    // 换实例（刷新）读得回；累计三项不分方案，六局都在
    const fresh = new Storage(disk);
    assert.equal(fresh.bestMap()['symbols@1:1-normal'], 400);
    assert.equal(fresh.totals().runs, 6);
});

// 9e：汉字方案进注册表就有自己那条记录线（键同样是「方案@版本:档位-玩法」），
// 与其余四方案互不串号——单元方案没动存储一行代码，这条守住"自动扩"是真的自动。
// 9g-1 把 hanzi bump 到 version 2（内容表加了多音字、判定语义跟着变），顺带守住封印那条：
// hanzi@1 的旧记录读不到、盘上仍留着不删
test('汉字方案独立记录线：与专练方案同档同玩法各记各的，换实例读得回', function () {
    const disk = backend();
    const store = new Storage(disk);
    // 键由注册表推（含方案版本），只有版本号那一条写死——它钉的正是"9g-1 bump 过了"这件事
    const hanziKey = Storage.bestKey('hanzi', 3, 'endless');
    const lettersKey = Storage.bestKey('letters', 3, 'endless');
    assert.equal(hanziKey, 'hanzi@2:3-endless', '9g-1 内容表变更后 hanzi 应当是 version 2');
    store.submitRun('hanzi', 3, 'endless', run(800, 20, 9));
    store.submitRun('letters', 3, 'endless', run(700, 30, 8));
    assert.deepEqual({ ...store.bestMap() }, { [hanziKey]: 800, [lettersKey]: 700 });

    // 门槛是自己的：重打低分不覆盖，也不判定成破纪录
    const again = store.submitRun('hanzi', 3, 'endless', run(500, 10, 5));
    assert.equal(again.previous, 800);
    assert.equal(again.isRecord, false);
    assert.equal(new Storage(disk).bestMap()[hanziKey], 800);
});

// 版本封印（9a 的机制，9g-1 第一次真用上）：盘上留着 hanzi@1 的旧分，当前版本读不到它，
// 也不与新规则的分混算；@2 的正常读写
test('hanzi 版本封印：@1 的旧记录读不到但盘上留着，@2 各记各的', function () {
    const disk = backend({ [NS + '.best']: '{"hanzi@1:3-endless":999,"hanzi@2:3-endless":50}' });
    const store = new Storage(disk);
    assert.deepEqual({ ...store.bestMap() }, { 'hanzi@2:3-endless': 50 }, '@1 那条落在合法键集之外');
    assert.equal(JSON.parse(disk.data.get(NS + '.best'))['hanzi@1:3-endless'], 999, '封存不等于删除');
});

// 9f：双拼方案进注册表就有自己那条记录线，与汉字 / 专练方案互不串号——
// 同档同玩法各记各的，存储一行代码没动，这条守住"自动扩"是真的自动。
// **flypy 仍是 version 1**（9g-1 没动它）：内容串里一个多音字都没有 ⇒ 每单元只有一条读音
// ⇒ 行为与 9f 逐字相同，所以旧记录不该被封存（config.test 钉的是同一件事的另一面）
test('双拼方案独立记录线：与汉字 / 专练方案同档同玩法各记各的，换实例读得回', function () {
    const disk = backend();
    const store = new Storage(disk);
    const flypyKey = Storage.bestKey('flypy', 3, 'endless');
    assert.equal(flypyKey, 'flypy@1:3-endless', '9g-1 没改 flypy 的内容，版本不该动');
    store.submitRun('flypy', 3, 'endless', run(900, 25, 10));
    store.submitRun('hanzi', 3, 'endless', run(800, 20, 9));
    store.submitRun('letters', 3, 'endless', run(700, 30, 8));
    assert.deepEqual({ ...store.bestMap() }, {
        [flypyKey]: 900,
        [Storage.bestKey('hanzi', 3, 'endless')]: 800,
        [Storage.bestKey('letters', 3, 'endless')]: 700
    });

    const again = store.submitRun('flypy', 3, 'endless', run(500, 10, 5));
    assert.equal(again.previous, 900);
    assert.equal(again.isRecord, false);
    assert.equal(new Storage(disk).bestMap()[flypyKey], 900);
    // 双拼也是合法菜单选择，持久化与校验回落同一条路
    store.saveSelection('endless', 'flypy');
    assert.deepEqual({ ...new Storage(disk).selection() }, { mode: 'endless', scheme: 'flypy' });
});

// 9c：专练方案 id 进了注册表就是合法选择，持久化与校验回落同标准方案一条路
test('菜单选择：专练方案 id 合法，saveSelection 落盘换实例读得回', function () {
    const disk = backend();
    const store = new Storage(disk);
    store.saveSelection('endless', 'digits');
    assert.deepEqual({ ...new Storage(disk).selection() }, { mode: 'endless', scheme: 'digits' });
    assert.deepEqual({ ...JSON.parse(disk.data.get(NS + '.menu')) }, { mode: 'endless', scheme: 'digits' });
});

// 迁移落盘失败（配额中途写满）：cache-first，内存已是迁移后的新格式，本会话读得到；
// 盘上洗盘失败仍留旧键，下次可用时再迁。隐私模式（构造即不可用）根本不读盘，迁移无从谈起
test('迁移落盘失败：内存仍是迁移后的新格式，本会话读得到，盘上留旧键', function () {
    const disk = backend({ [NS + '.best']: '{"3-endless":1580}' });
    const store = new Storage(disk);
    assert.equal(store.available, true);

    disk.setItem = function () { throw new Error('QuotaExceededError'); };
    assert.deepEqual({ ...store.bestMap() }, { 'standard@1:3-endless': 1580 });
    assert.equal(store.available, false);
    assert.equal(store.submitRun('standard', 3, 'endless', run(2000, 50, 15)).best, 2000);
    // 写盘失败：盘上还是旧键，没被洗成新格式
    assert.deepEqual({ ...JSON.parse(disk.data.get(NS + '.best')) }, { '3-endless': 1580 });
});

// 9b：菜单选择（玩法 × 方案）持久化，刷新保留
test('菜单选择：缺省回落闯关 × 标准，saveSelection 落盘后换实例读得回', function () {
    const disk = backend();
    const store = new Storage(disk);
    assert.deepEqual({ ...store.selection() }, { mode: 'normal', scheme: 'standard' });

    store.saveSelection('endless', 'standard');
    assert.deepEqual({ ...new Storage(disk).selection() }, { mode: 'endless', scheme: 'standard' });
    assert.deepEqual({ ...JSON.parse(disk.data.get(NS + '.menu')) }, { mode: 'endless', scheme: 'standard' });
});

// menu 键的值是外部输入，可能被手改成任何东西
test('菜单选择脏数据：未知 id / 非对象回落默认，合法字段保留', function () {
    const unknown = new Storage(backend({ [NS + '.menu']: '{"mode":"nope","scheme":"standard"}' }));
    assert.deepEqual({ ...unknown.selection() }, { mode: 'normal', scheme: 'standard' });

    const bad = new Storage(backend({ [NS + '.menu']: '"not an object"' }));
    assert.deepEqual({ ...bad.selection() }, { mode: 'normal', scheme: 'standard' });

    const partial = new Storage(backend({ [NS + '.menu']: '{"mode":"endless"}' }));
    assert.deepEqual({ ...partial.selection() }, { mode: 'endless', scheme: 'standard' });
});

test('saveSelection 写前归一：未知 id 落成默认，不把脏选择写进盘', function () {
    const disk = backend();
    const store = new Storage(disk);
    store.saveSelection('nope', 'nope');
    assert.deepEqual({ ...JSON.parse(disk.data.get(NS + '.menu')) }, { mode: 'normal', scheme: 'standard' });
});