(function (ns) {
    'use strict';

    const systems = ns.systems = ns.systems || {};

    // 开局前的选择规则全在这里：哪些玩法档现在能玩、选择怎么归一、怎么压成一份可玩快照。
    // 界面只画返回的结构，不自己翻 ROADMAP 判断实现进度（harness/requirements.md1d / 1l）

    function ready(key, id) { return ns.ROADMAP[key][id] === true; }

    // 回落目标 = **本组的默认档**（config.DEFAULTS），默认档自己没开放才退到表里第一个已实现项。
    // 不能一律取第一个：休闲放开之后模式回落到 MODES[0] = 休闲，速度若跟着回落到
    // SPEEDS[0] = 慢，默认草稿成了"休闲 · 慢"、一个胶囊都不高亮（harness/architecture.md 已知坑）。
    // 3c 起速度从 PRESETS 取（见 normalize），这类坑在结构上消失；其余键的回落仍认默认档
    function fallbackFor(group) {
        const preferred = group.table.find(function (item) {
            return item.id === ns.DEFAULTS[group.key] && ready(group.key, item.id);
        });
        return preferred || group.table.find(function (item) { return ready(group.key, item.id); });
    }

    function presetReady(preset) {
        return ready('mode', preset.mode) &&
            ready('direction', preset.direction) &&
            ready('speed', preset.speed);
    }

    // 未知 id 与还没实现的选项一律回落到一份现在就能开局的组合
    function normalize(draft) {
        const source = draft || {};
        const picks = {};

        ns.OPTION_GROUPS.forEach(function (group) {
            const wanted = group.table.find(function (item) {
                return item.id === source[group.key] && ready(group.key, item.id);
            });
            picks[group.key] = (wanted || fallbackFor(group)).id;
        });

        // 速度由玩法档（模式 × 方向）决定，不是自由选项（harness/gameplay.md，3c 拍板）：
        // 冲榜正序锁默认档为了记录可比，挑战（冲榜 · 倒序）自带快档、记录走自己的组合键。
        // 按 模式 × 方向 找档取它的速度；这个组合没有档（如休闲 · 倒序）就回落到该模式的档——
        // 草稿永远正好落在一个胶囊上，不会一个都不高亮
        const preset = ns.PRESETS.find(function (item) {
            return presetReady(item) && item.mode === picks.mode && item.direction === picks.direction;
        }) || ns.PRESETS.find(function (item) {
            return presetReady(item) && item.mode === picks.mode;
        }) || ns.PRESETS.find(presetReady);
        picks.mode = preset.mode;
        picks.direction = preset.direction;
        picks.speed = preset.speed;
        return picks;
    }

    // 玩法档 = 模式 × 方向 × 速度 的命名组合（harness/gameplay.md 阶梯定位表）。
    // 类型不在里面：类型是"玩哪个游戏"，由首页的类型行给。
    // 三项在 ROADMAP 里全开放这一档才出现——没开放的档不画也不置灰（harness/ui.md），
    // 玩家看到的永远是"现在能玩什么"，不是一张开发进度表
    function presets(draft) {
        const picks = normalize(draft);

        return ns.PRESETS.filter(presetReady).map(function (preset) {
            return {
                id: preset.id,
                name: preset.name,
                // 交给 use() 的就是这三个键，与 draft 里的 type 合并后仍是一份完整组合
                picks: { mode: preset.mode, direction: preset.direction, speed: preset.speed },
                selected: picks.mode === preset.mode &&
                    picks.direction === preset.direction &&
                    picks.speed === preset.speed
            };
        });
    }

    // 待开局的选择（"下一局用什么"）是跨场景的状态，不是某一屏的界面状态，所以归 systems
    // 而不是场景（harness/requirements.md迁移边界表）：首页读它决定开局组合与档的高亮，结算的"换个玩法"把上一局快照写回它
    let draft = normalize();

    systems.Setup = {
        normalize: normalize,
        presets: presets,
        // 开局用：每次都是新对象，局内改不到全局默认（AGENTS 界面纪律 1）。
        // 全局偏好（声音两开关 / 起始长度 / 进度点）从 Prefs 合并进来：局内只认这份快照，不回读 Prefs。
        // 冲榜与挑战锁起始长度 2（MODES.ranked，记录可比）——锁定只此一处，生成器不认模式；
        // 休闲读偏好（2–4，harness/gameplay.md 设置项）
        snapshot: function (picks) {
            const normalized = normalize(picks);
            const prefs = systems.Prefs.get();
            if (ns.modeById(normalized.mode).ranked) { prefs.startLength = ns.START_LENGTH; }
            return Object.assign(ns.defaultSettings(), prefs, normalized);
        },
        draft: function () { return draft; },
        use: function (picks) {
            draft = normalize(picks);
            return draft;
        }
    };
})(window.SequenceMemory = window.SequenceMemory || {});
