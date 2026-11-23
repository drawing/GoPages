(function (ns) {
    'use strict';

    const systems = ns.systems = ns.systems || {};

    // 全局偏好（harness/gameplay.md 设置项两层里的"全局偏好"层）：4a 落声音两开关，
    // 4c 补齐四键——起始长度（仅休闲生效，冲榜与挑战的锁定在 Setup.snapshot）与进度点。
    // 玩法档那四个键不归这里——它们归 Setup 的草稿。
    //
    // 与 Audio / Storage 同类：浏览器边界服务归 systems/，不碰 Phaser 也不碰 scenes。
    // 读写走 systems.Storage（5a 统一隐私探测口径）：probe 真写一次判可用性，
    // Node 加载（假 window 没有 localStorage）与隐私模式都退回内存默认值，不崩
    const KEY = 'prefs';
    const DEFAULTS = {
        sound: true,
        colorTones: false,
        startLength: ns.START_LENGTH,
        progressDots: true
    };
    const KEYS = Object.keys(DEFAULTS);

    // 读值按键型校验：存进去的可能是旧版本 / 手改的 / 损坏的 JSON，
    // 未知键与非法值一律回落默认，不让一个坏字段把开关变成 undefined。
    // startLength 只认 START_LENGTHS 表内值（离散档，与速度档同一条取舍）
    function valid(key, value) {
        if (key === 'startLength') { return ns.START_LENGTHS.indexOf(value) >= 0; }
        return typeof value === 'boolean';
    }

    function sanitize(raw) {
        const out = Object.assign({}, DEFAULTS);
        if (!raw || typeof raw !== 'object') { return out; }
        KEYS.forEach(function (key) {
            if (valid(key, raw[key])) { out[key] = raw[key]; }
        });
        return out;
    }

    function read() {
        return sanitize(systems.storage().read(KEY, null));
    }

    let prefs = read();

    systems.Prefs = {
        // 每次返回拷贝：调用方（Setup.snapshot / 界面）改不到这份全局状态
        get: function () { return Object.assign({}, prefs); },
        set: function (key, value) {
            if (KEYS.indexOf(key) < 0 || !valid(key, value)) { return systems.Prefs.get(); }
            prefs[key] = value;
            // 写不进（隐私模式 / 配额满）Storage 自己退回内存：本会话内开关仍生效，刷新后回默认
            systems.storage().write(KEY, prefs);
            return systems.Prefs.get();
        }
    };
})(window.SequenceMemory = window.SequenceMemory || {});