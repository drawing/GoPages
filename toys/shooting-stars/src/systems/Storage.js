(function (ns) {
    'use strict';

    const CONFIG = ns.CONFIG;
    const systems = ns.systems = ns.systems || {};

    // 记录键 = 「方案@版本:档位-玩法」（9a）。方案带版本是封印开关：规则变更 bump 版本后
    // 旧键落在合法集之外，bestMap 读不到 ⇒ 旧记录封存不混算。合法集由 SCHEMES × LEVELS × MODES
    // 生成，用 null 原型的表查键，手改出来的 __proto__ 取不到真值
    function keyFor(scheme, levelId, modeId) {
        return scheme.id + '@' + scheme.version + ':' + levelId + '-' + modeId;
    }

    const BEST_KEYS = (function () {
        const keys = Object.create(null);
        ns.SCHEMES.forEach(function (scheme) {
            ns.LEVELS.forEach(function (level) {
                ns.MODES.forEach(function (mode) { keys[keyFor(scheme, level.id, mode.id)] = true; });
            });
        });
        return keys;
    })();

    function intValue(value) {
        return typeof value === 'number' && isFinite(value) && value >= 0 ? Math.floor(value) : 0;
    }

    // localStorage 是外部边界：隐私模式下 setItem 抛异常、配额会写满、存着的值可能被改成任何字符串。
    // 所有读写都兜底，失败就退回内存，游戏照常跑。不引用 Phaser，能在 Node 里直接加载验证
    class Storage {
        constructor(backend) {
            this.backend = Storage.detect(backend);
            this.available = !!this.backend;
            this.cache = Object.create(null);
        }

        // 隐私模式下 localStorage 对象存在、getItem 也正常，只有 setItem 抛 QuotaExceededError，
        // 所以判"存在"不够，必须真写一次再删掉
        static detect(backend) {
            try {
                const store = backend || window.localStorage;
                if (!store) { return null; }
                const probe = CONFIG.STORAGE_NS + '.probe';
                store.setItem(probe, '1');
                store.removeItem(probe);
                return store;
            } catch (err) {
                return null;
            }
        }

        static bestKey(schemeId, levelId, modeId) {
            return keyFor(ns.schemeById(schemeId), ns.levelById(levelId).id, ns.modeById(modeId).id);
        }

        // 9a 之前的旧键是「档位-玩法」（无方案段）——它们就是标准方案初版的记录，升级时原样并进
        // 当前标准键（验收：旧最高分升级后原样可读）。解析不出合法档位/玩法的当脏键返回 null
        static upgradeKey(key) {
            const match = /^(\d+)-(.+)$/.exec(key);
            if (!match) { return null; }
            const levelId = Number(match[1]);
            const modeId = match[2];
            const known = ns.LEVELS.some(function (level) { return level.id === levelId; }) &&
                ns.MODES.some(function (mode) { return mode.id === modeId; });
            return known ? Storage.bestKey(ns.DEFAULT_SCHEME, levelId, modeId) : null;
        }

        // 本会话内以 cache 为准：写盘失败后内存里那份才是最新的，不能再回头读旧值
        read(name, fallback) {
            if (name in this.cache) { return this.cache[name]; }
            if (!this.backend) { return fallback; }

            let raw = null;
            try {
                raw = this.backend.getItem(CONFIG.STORAGE_NS + '.' + name);
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
                this.backend.setItem(CONFIG.STORAGE_NS + '.' + name, JSON.stringify(value));
                this.available = true;
                return true;
            } catch (err) {
                this.available = false;
                return false;
            }
        }

        // 每次都洗成新对象交出去，调用方改不到存档。旧键（9a 前的「档位-玩法」）一次性并进
        // 当前标准键并整份洗回盘；未知键 / 坏值 / 旧版本键一并丢掉（封存而不混算）
        bestMap() {
            const raw = this.read('best', null);
            const map = {};
            let upgraded = false;
            if (raw && typeof raw === 'object') {
                Object.keys(raw).forEach(function (key) {
                    const score = intValue(raw[key]);
                    if (score <= 0) { return; }
                    if (BEST_KEYS[key]) { map[key] = score; return; }
                    const legacy = Storage.upgradeKey(key);
                    // 同一组合若已有新格式记录，以新的为准（旧键只在空缺时补位）
                    if (legacy && BEST_KEYS[legacy] && map[legacy] == null) {
                        map[legacy] = score;
                        upgraded = true;
                    }
                });
            }
            // 迁移落盘一次：下次读到的就是新格式。cache-first，写失败本会话仍以内存这份为准
            if (upgraded) { this.write('best', map); }
            return map;
        }

        totals() {
            const raw = this.read('stats', null);
            const source = raw && typeof raw === 'object' ? raw : {};
            return {
                runs: intValue(source.runs),
                hits: intValue(source.hits),
                maxCombo: intValue(source.maxCombo)
            };
        }

        // 菜单选择（9b）：玩法 × 方案持久化，刷新保留。读值按 modeById / schemeById 校验——
        // 未知 id / 坏值一律回落默认，手改出来的选择不进游戏；写前同样归一，不落脏键
        selection() {
            const raw = this.read('menu', null);
            const source = raw && typeof raw === 'object' ? raw : {};
            return { mode: ns.modeById(source.mode).id, scheme: ns.schemeById(source.scheme).id };
        }

        saveSelection(modeId, schemeId) {
            this.write('menu', { mode: ns.modeById(modeId).id, scheme: ns.schemeById(schemeId).id });
        }

        // 一局结束调一次。最高分只升不降，破纪录判定与累计三项一起算完交回去，
        // 场景层不再自己比大小，免得菜单与结算页各算一套。记录按「方案 × 玩法 × 档位」分记（9a）
        submitRun(schemeId, levelId, modeId, stats) {
            const run = stats || {};
            const key = Storage.bestKey(schemeId, levelId, modeId);
            const score = intValue(run.score);
            const bests = this.bestMap();
            const previous = bests[key] || 0;
            const best = Math.max(previous, score);
            if (best > previous) {
                bests[key] = best;
                this.write('best', bests);
            }

            const totals = this.totals();
            totals.runs += 1;
            totals.hits += intValue(run.hits);
            totals.maxCombo = Math.max(totals.maxCombo, intValue(run.maxCombo));
            this.write('stats', totals);

            return {
                best: best,
                previous: previous,
                isRecord: score > previous,
                totals: Object.assign({}, totals)
            };
        }
    }

    let shared = null;

    // 三个场景共用一份。隐私模式降级成内存对象时，GameScene 写的那份必须还能被结算页与菜单读到，
    // 各 new 一个的话本会话的记录会在场景切换时丢光
    systems.storage = function () {
        if (!shared) { shared = new Storage(); }
        return shared;
    };

    systems.Storage = Storage;
})(window.ShootingStars = window.ShootingStars || {});