import test from 'node:test';
import assert from 'node:assert/strict';

import { load } from './load.mjs';

const ns = load();
const CONFIG = ns.CONFIG;
const Settings = ns.systems.Settings;
const Storage = ns.systems.Storage;
const NS = 'toys.shooting-stars';

// 与 storage.test 同一份最小 localStorage 鸭子类型
function backend(initial) {
    const data = new Map(Object.entries(initial || {}));
    return {
        data: data,
        getItem: (key) => (data.has(key) ? data.get(key) : null),
        setItem: (key, value) => { data.set(key, String(value)); },
        removeItem: (key) => { data.delete(key); }
    };
}

function saved(disk) {
    return JSON.parse(disk.data.get(NS + '.settings'));
}

test('默认值：没有存档时音量取表值，三个开关全关，构造不写盘', function () {
    const disk = backend();
    const settings = new Settings(new Storage(disk));
    assert.equal(settings.volume, CONFIG.AUDIO.defaultVolume);
    assert.equal(settings.muted, false);
    assert.equal(settings.reducedMotion, false);
    assert.equal(settings.strict, false);
    assert.equal(disk.data.size, 0, '读不该产生写');
});

// settings 里的值是外部输入：旧版本只有 volume/muted 两字段，手改可能塞进任何字符串
test('脏数据：volume 只收有限数字并 clamp，布尔只认 true，坏 JSON 与非对象当没有', function () {
    const cases = [
        ['{"volume":"abc"}', CONFIG.AUDIO.defaultVolume],
        ['{"volume":null}', CONFIG.AUDIO.defaultVolume],
        ['{"volume":-0.5}', 0],
        ['{"volume":2}', 1],
        ['{"volume":0.35}', 0.35]
    ];
    for (const [raw, volume] of cases) {
        const settings = new Settings(new Storage(backend({ [NS + '.settings']: raw })));
        assert.equal(settings.volume, volume, raw);
    }

    const dirty = new Settings(new Storage(backend({
        [NS + '.settings']: '{"muted":"true","reducedMotion":1,"strict":true}'
    })));
    assert.equal(dirty.muted, false);
    assert.equal(dirty.reducedMotion, false);
    assert.equal(dirty.strict, true);

    for (const raw of ['not json', '42', '"str"']) {
        const settings = new Settings(new Storage(backend({ [NS + '.settings']: raw })));
        assert.equal(settings.volume, CONFIG.AUDIO.defaultVolume, raw);
        assert.equal(settings.strict, false, raw);
    }
});

// 6c 的核心契约：四字段整份写。AudioSys 委托进来之后，改音量不能把 strict 冲掉
test('持久化：四字段整份落盘，改一个不丢其余，新实例读得回', function () {
    const disk = backend();
    const store = new Storage(disk);
    const settings = new Settings(store);

    settings.set('strict', true);
    settings.set('volume', 0.5);
    assert.deepEqual(saved(disk), { volume: 0.5, muted: false, reducedMotion: false, strict: true });

    settings.set('reducedMotion', true);
    settings.set('muted', true);
    assert.deepEqual(saved(disk), { volume: 0.5, muted: true, reducedMotion: true, strict: true });

    const back = new Settings(new Storage(disk));
    assert.equal(back.volume, 0.5);
    assert.equal(back.muted, true);
    assert.equal(back.reducedMotion, true);
    assert.equal(back.strict, true);
});

test('set 只认四个键：未知键不写盘，布尔键塞非 true 一律落成关', function () {
    const disk = backend();
    const settings = new Settings(new Storage(disk));
    settings.set('nope', true);
    assert.equal(disk.data.size, 0);

    settings.set('muted', 'yes');
    assert.equal(settings.muted, false);
    assert.equal(saved(disk).muted, false);
});

test('隐私模式：写盘抛异常不抛出去，本会话读得到自己改的开关', function () {
    const disk = backend();
    disk.setItem = function () { throw new Error('QuotaExceededError'); };
    const store = new Storage(disk);
    const settings = new Settings(store);

    settings.set('strict', true);
    settings.set('reducedMotion', true);
    assert.equal(store.available, false);
    assert.equal(settings.strict, true);
    assert.equal(settings.reducedMotion, true);
    assert.equal(disk.data.size, 0);
});

// AudioSys 自 6c 起不再自己写 settings 键：getter 现读 Settings，setter 转发。
// 这条守的是"两个写者互相覆盖"那个坑——音量改动必须保留其余三个字段
test('AudioSys 委托 Settings：音量/静音改动不冲掉其余字段，getter 现读活值', function () {
    const disk = backend();
    const settings = new Settings(new Storage(disk));
    const audio = new ns.systems.AudioSys(settings);

    settings.set('strict', true);
    audio.setVolume(0.3);
    assert.equal(audio.volume, 0.3);
    assert.equal(settings.volume, 0.3);
    assert.deepEqual(saved(disk), { volume: 0.3, muted: false, reducedMotion: false, strict: true });

    audio.setMuted(true);
    assert.equal(audio.muted, true);
    assert.equal(saved(disk).strict, true, '静音把严格模式冲掉了');

    settings.set('volume', 0.6);
    assert.equal(audio.volume, 0.6, 'getter 必须现读而不是构造时拷一份');
});

test('单例与读取口：全项目一份，utils.reducedMotion 现读活值', function () {
    assert.equal(ns.systems.settings(), ns.systems.settings());
    assert.equal(new Settings().volume, CONFIG.AUDIO.defaultVolume, '没有 localStorage 也不抛');

    const settings = ns.systems.settings();
    settings.set('reducedMotion', true);
    assert.equal(ns.utils.reducedMotion(), true);
    settings.set('reducedMotion', false);
    assert.equal(ns.utils.reducedMotion(), false);
});

// 6d：系统偏好并进读取口——生效值 = 设置开关 ∨ prefers-reduced-motion，门控调用点一行不动。
// MediaQueryList 建一次复用（Backdrop 每帧都问）、matches 现读，系统切换立即跟上
test('系统减少动效：设置关着也降级、设置关不掉系统偏好、matches 现读、MQL 只建一次', function () {
    const query = { matches: true };
    let calls = 0;
    let asked = null;
    const local = load({
        matchMedia: function (q) { calls++; asked = q; return query; }
    });
    const settings = local.systems.settings();
    assert.equal(settings.reducedMotion, false);
    assert.equal(local.utils.systemReducedMotion(), true);
    assert.equal(local.utils.reducedMotion(), true, '系统开着，设置关着也要降级');
    assert.equal(asked, '(prefers-reduced-motion: reduce)');

    settings.set('reducedMotion', false);
    assert.equal(local.utils.reducedMotion(), true, '系统偏好不是设置能关掉的');

    query.matches = false;
    assert.equal(local.utils.reducedMotion(), false, '系统切换要立即跟上，不用重开');
    settings.set('reducedMotion', true);
    assert.equal(local.utils.reducedMotion(), true, '设置开关那一半照旧');
    assert.equal(calls, 1, 'MediaQueryList 建一次复用，不能每帧现造');
});

test('无 matchMedia / matchMedia 抛异常：当系统不减，只认设置开关', function () {
    const bare = load();
    assert.equal(bare.utils.systemReducedMotion(), false);
    assert.equal(bare.utils.reducedMotion(), false);
    bare.systems.settings().set('reducedMotion', true);
    assert.equal(bare.utils.reducedMotion(), true);

    const broken = load({ matchMedia: function () { throw new Error('not supported'); } });
    assert.equal(broken.utils.systemReducedMotion(), false);
    assert.equal(broken.utils.reducedMotion(), false);
});