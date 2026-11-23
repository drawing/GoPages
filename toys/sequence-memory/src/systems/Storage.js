(function (ns) {
    'use strict';

    const systems = ns.systems = ns.systems || {};

    // 浏览器边界服务（与 Audio / Prefs 同类）：localStorage 包在 try/catch 里，
    // Node 加载（tests/load.mjs 的假 window 没有 localStorage）与隐私模式都不抛异常。
    // 外部依赖走构造参数传入（new Storage(fakeBackend)），不在模块里直接读 window.localStorage——
    // 测试注入假后端就能验探测与兜底，不用碰真浏览器（AGENTS 测试边界）
    class Storage {
        constructor(backend) {
            this.backend = Storage.detect(backend);
            this.available = !!this.backend;
            this.cache = Object.create(null);
        }

        // 隐私模式下 localStorage 对象存在、getItem 也正常，只有 setItem 抛 QuotaExceededError，
        // 所以判"存在"不够，必须真写一次再删掉（5a 统一探测口径，Prefs 也走这里）
        static detect(backend) {
            try {
                const store = backend || window.localStorage;
                if (!store) { return null; }
                const probe = ns.STORAGE_NS + '.probe';
                store.setItem(probe, '1');
                store.removeItem(probe);
                return store;
            } catch (err) {
                return null;
            }
        }

        // 本会话内以 cache 为准：写盘失败后内存里那份才是最新的，不能再回头读旧值
        read(name, fallback) {
            if (name in this.cache) { return this.cache[name]; }
            if (!this.backend) { return fallback; }

            let raw = null;
            try {
                raw = this.backend.getItem(ns.STORAGE_NS + '.' + name);
            } catch (err) {
                this.available = false;
                return fallback;
            }
            if (raw == null) { return fallback; }

            try {
                this.cache[name] = JSON.parse(raw);
            } catch (err) {
                // 值被改坏了只是这一格没有，不代表存档不可用，available 不动
                return fallback;
            }
            return this.cache[name];
        }

        write(name, value) {
            this.cache[name] = value;
            if (!this.backend) { return false; }
            try {
                this.backend.setItem(ns.STORAGE_NS + '.' + name, JSON.stringify(value));
                this.available = true;
                return true;
            } catch (err) {
                this.available = false;
                return false;
            }
        }
    }

    let shared = null;

    // 全应用共用一份：隐私模式降级成内存对象时，结算写的那份必须还能被首页与记录页读到，
    // 各 new 一个的话本会话的记录会在场景切换时丢光
    systems.storage = function () {
        if (!shared) { shared = new Storage(); }
        return shared;
    };

    systems.Storage = Storage;
})(window.SequenceMemory = window.SequenceMemory || {});