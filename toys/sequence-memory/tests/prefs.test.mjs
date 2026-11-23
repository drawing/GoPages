import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const ns = load();
const Prefs = ns.systems.Prefs;
const Setup = ns.systems.Setup;
const session = ns.systems.session;

// Prefs 是浏览器边界服务（localStorage 包 try/catch），这里测的是归 systems 的那一半：
// 读值 / 写值校验与"偏好 → 开局快照"的合并纪律（AGENTS：存储 schema 与读值校验可测）。
// load.mjs 的假 window 没有 localStorage，Prefs 退回内存——set 照样生效，正好用来钉校验
test('四项全局偏好：默认值与 get 拷贝', () => {
    assert.deepEqual({ ...Prefs.get() }, {
        sound: true, colorTones: false, startLength: ns.START_LENGTH, progressDots: true
    });
    const taken = Prefs.get();
    taken.sound = false;
    taken.startLength = 4;
    assert.equal(Prefs.get().sound, true);
    assert.equal(Prefs.get().startLength, ns.START_LENGTH);
});

test('写值按键型校验：布尔只认布尔，起始长度只认表内档，未知键忽略', () => {
    // 布尔键：非布尔一律不写（旧版本 / 手改 / 损坏值不该把开关变成 undefined）
    for (const key of ['sound', 'colorTones', 'progressDots']) {
        const before = Prefs.get()[key];
        for (const bad of ['true', 1, null, undefined]) {
            Prefs.set(key, bad);
            assert.equal(Prefs.get()[key], before);
        }
        Prefs.set(key, !before);
        assert.equal(Prefs.get()[key], !before);
        Prefs.set(key, before);
    }

    // startLength 只认 START_LENGTHS 表内值：5 越过上限（第一个里程碑）、字符串与小数都不认
    for (const bad of [5, 1, '3', 2.5, true, null]) {
        Prefs.set('startLength', bad);
        assert.equal(Prefs.get().startLength, ns.START_LENGTH);
    }
    for (const n of ns.START_LENGTHS) {
        Prefs.set('startLength', n);
        assert.equal(Prefs.get().startLength, n);
    }
    Prefs.set('startLength', ns.START_LENGTH);

    // 玩法档的键不归 Prefs（它们归 Setup 草稿），未知键同样不写
    Prefs.set('mode', 'ranked');
    Prefs.set('nope', true);
    assert.equal(Prefs.get().mode, undefined);
    assert.equal(Prefs.get().nope, undefined);
});

// 纪律 1 的合并口：快照读 Prefs 活值，但冲榜与挑战的起始长度锁回 2（记录可比），
// 锁定只在 snapshot 一处——生成器不认模式（harness/architecture.md）
test('快照合并偏好：休闲读起始长度，冲榜与挑战锁 2，快照改不到 Prefs', () => {
    Prefs.set('startLength', 4);
    Prefs.set('progressDots', false);
    Prefs.set('sound', false);

    const leisure = Setup.snapshot({ mode: 'leisure' });
    assert.equal(leisure.startLength, 4);
    assert.equal(leisure.progressDots, false);
    assert.equal(leisure.sound, false);

    for (const picks of [{ mode: 'ranked' }, { mode: 'ranked', direction: 'backward' }]) {
        assert.equal(Setup.snapshot(picks).startLength, ns.START_LENGTH);
    }

    // 快照每次是新对象：局内改它污染不到全局偏好
    leisure.startLength = 2;
    leisure.progressDots = true;
    assert.equal(Prefs.get().startLength, 4);
    assert.equal(Prefs.get().progressDots, false);

    Prefs.set('startLength', ns.START_LENGTH);
    Prefs.set('progressDots', true);
    Prefs.set('sound', true);
});

// 偏好的终点是开局：起始长度进生成器（休闲），冲榜锁 2；进度点 / 声音随快照冻住，
// 局内改 Prefs 不影响这一局（下一局才生效）
test('起始长度进生成器：休闲从 4 起，冲榜仍从 2 起；局内改偏好不动本局', () => {
    Prefs.set('startLength', 4);

    session.start(Setup.snapshot({ mode: 'leisure' }));
    assert.equal(session.round().length, 4);
    assert.equal(session.view().settings.startLength, 4);
    session.advance();
    assert.equal(session.round().length, 5);

    // 局中改不了：活值改了，本局快照纹丝不动
    Prefs.set('startLength', 2);
    Prefs.set('progressDots', false);
    assert.equal(session.view().settings.startLength, 4);
    assert.equal(session.view().settings.progressDots, true);
    session.end();

    session.start(Setup.snapshot({ mode: 'ranked' }));
    assert.equal(session.round().length, ns.START_LENGTH);
    session.end();

    // 下一局才生效：新快照读到改后的活值
    assert.equal(Setup.snapshot({ mode: 'leisure' }).startLength, 2);
    assert.equal(Setup.snapshot({ mode: 'leisure' }).progressDots, false);
    Prefs.set('progressDots', true);
});