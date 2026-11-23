import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const ns = load();
const Storage = ns.systems.Storage;

// 假后端：鸭子类型 localStorage（AGENTS：外部依赖走构造参数传入，不碰真浏览器）。
// broken 指定哪个方法抛异常，模拟隐私模式 / 配额满 / 读损坏
function fakeBackend(broken) {
    const map = new Map();
    const guard = (name) => {
        if (broken === name) { throw new Error('QuotaExceededError'); }
    };
    return {
        map,
        getItem(key) { guard('getItem'); return map.has(key) ? map.get(key) : null; },
        setItem(key, value) { guard('setItem'); map.set(key, String(value)); },
        removeItem(key) { guard('removeItem'); map.delete(key); }
    };
}

test('隐私探测要真写一次：setItem 抛异常判不可用，probe 写完即删', () => {
    const good = fakeBackend();
    const store = new Storage(good);
    assert.equal(store.available, true);
    // probe 不许留在存档里
    assert.equal(good.map.has(ns.STORAGE_NS + '.probe'), false);

    // 隐私模式：对象存在、getItem 正常，只有 setItem 抛——判"存在"不够
    const privateMode = new Storage(fakeBackend('setItem'));
    assert.equal(privateMode.available, false);

    // 假 window 没有 localStorage（Node 加载）同样退回内存，不抛
    assert.equal(new Storage(null).available, false);
});

test('写不进退回内存：本会话以 cache 为准，不回头读盘上的旧值', () => {
    const backend = fakeBackend();
    const store = new Storage(backend);
    assert.equal(store.write('best', { a: 1 }), true);

    // 配额满：写盘失败，但内存里那份才是最新的
    backend.setItem = () => { throw new Error('QuotaExceededError'); };
    assert.equal(store.write('best', { a: 2 }), false);
    assert.equal(store.available, false);
    assert.deepEqual(store.read('best', null), { a: 2 });

    // 没有后端也照样读写（纯内存兜底），游戏照常跑
    const memory = new Storage(null);
    assert.equal(memory.write('best', { a: 3 }), false);
    assert.deepEqual(memory.read('best', null), { a: 3 });
    assert.equal(memory.read('missing', 'fallback'), 'fallback');
});

test('读值损坏只当这一格没有：JSON 坏了回落 fallback，存档可用性不动', () => {
    const backend = fakeBackend();
    backend.map.set(ns.STORAGE_NS + '.best', '{broken json');
    const store = new Storage(backend);
    assert.equal(store.read('best', 'fallback'), 'fallback');
    assert.equal(store.available, true);

    // getItem 抛异常才判不可用
    const broken = new Storage(fakeBackend('getItem'));
    assert.equal(broken.read('best', 'fallback'), 'fallback');
    assert.equal(broken.available, false);
});