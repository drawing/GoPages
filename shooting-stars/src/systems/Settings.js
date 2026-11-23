(function (ns) {
    'use strict';

    const CONFIG = ns.CONFIG;
    const systems = ns.systems = ns.systems || {};

    // settings 键的唯一写者（6c，harness/architecture.md）：volume / muted / reducedMotion / strict
    // 四字段整份写。AudioSys 的音量/静音也委托这里——两个写者各写各的字段会互相覆盖。
    // 与 Storage 同类但不碰浏览器 API：存档读写全走注入的 store，纯逻辑能在 Node 里直接测
    class Settings {
        constructor(store) {
            this.store = store || systems.storage();
            const saved = this.store.read('settings', null);
            const source = saved && typeof saved === 'object' ? saved : {};
            this.volume = Settings.sanitizeVolume(source.volume);
            // 布尔只认 === true：旧版本缺字段、手改成 "true" / 1 一律回落关
            this.muted = source.muted === true;
            this.reducedMotion = source.reducedMotion === true;
            this.strict = source.strict === true;
        }

        static sanitizeVolume(value) {
            if (typeof value !== 'number' || !isFinite(value)) { return CONFIG.AUDIO.defaultVolume; }
            return Math.min(1, Math.max(0, value));
        }

        set(key, value) {
            if (key === 'volume') {
                this.volume = Settings.sanitizeVolume(value);
            } else if (key === 'muted' || key === 'reducedMotion' || key === 'strict') {
                this[key] = value === true;
            } else {
                return;
            }
            this.persist();
        }

        persist() {
            this.store.write('settings', {
                volume: this.volume,
                muted: this.muted,
                reducedMotion: this.reducedMotion,
                strict: this.strict
            });
        }
    }

    let shared = null;

    // 与 storage / audio 同一个套路：全项目一份，设置面板写的那份 GameScene 与 Backdrop 现读
    systems.settings = function () {
        if (!shared) { shared = new Settings(); }
        return shared;
    };

    systems.Settings = Settings;
})(window.ShootingStars = window.ShootingStars || {});