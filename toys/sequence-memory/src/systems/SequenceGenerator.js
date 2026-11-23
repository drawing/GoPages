(function (ns) {
    'use strict';

    const systems = ns.systems = ns.systems || {};

    // 符号一律是 0..symbols-1 的下标，四种类型共用（颜色 4 / 位置 9 / 数字 10 / 扑克 52）。
    // generate 读 MODES.generate（harness/gameplay.md）：
    //   fresh  = 每关全新随机序列（冲榜）；
    //   append = 每关重播整段旧序列 + 末尾新增 1 项（休闲）。
    // 两者的长度阶梯一样（起始长度 + 关次 - 1），差的只是"旧的那一段换不换"。
    // 倒序（3c）是判定侧期望顺序的事，不在这里——生成器永远给正序的那一条，呈现也永远正序。
    // unique = 无放回抽取（TYPES.card，harness/gameplay.md）：扑克"选过的置灰不可再选"，
    // 允许重复会把同一张牌的第二次出现锁死；长度随之以符号集封顶
    systems.SequenceGenerator = {
        create: function (opts) {
            const symbols = opts.symbols;
            const startLength = opts.startLength || ns.START_LENGTH;
            const random = opts.random || Math.random;
            const unique = !!opts.unique;
            const append = opts.generate === 'append';
            let sequence = [];
            let round = 0;

            function draw(length) {
                if (!unique) {
                    const items = [];
                    for (let i = 0; i < length; i += 1) {
                        items.push(Math.floor(random() * symbols));
                    }
                    return items;
                }
                // 部分 Fisher–Yates：洗到第 count 张就停，前 count 张即序列，不重不漏
                const count = Math.min(length, symbols);
                const pool = Array.from({ length: symbols }, function (_, i) { return i; });
                for (let i = 0; i < count; i += 1) {
                    const j = i + Math.floor(random() * (symbols - i));
                    const tmp = pool[i];
                    pool[i] = pool[j];
                    pool[j] = tmp;
                }
                return pool.slice(0, count);
            }

            // 追加只抽末尾那一项。unique 时要在"还没用过的符号"里抽，否则新增项会撞上旧序列里的
            // 某一张，而扑克的规则是选过置灰不可再选（harness/gameplay.md）。抽满了返回 null
            function drawOne() {
                if (!unique) { return Math.floor(random() * symbols); }
                const pool = [];
                for (let i = 0; i < symbols; i += 1) {
                    if (sequence.indexOf(i) < 0) { pool.push(i); }
                }
                if (!pool.length) { return null; }
                return pool[Math.floor(random() * pool.length)];
            }

            return {
                next: function () {
                    round += 1;
                    // 追加的第一关没有旧序列可留，直接抽起始长度
                    if (append && sequence.length) {
                        // 符号集抽满就没有新项可加（扑克 52 张封顶）：长度停在这里、这一关重播同一条。
                        // 硬加会破坏"无放回"，而那一类的置灰规则正是建在它上面
                        const added = drawOne();
                        if (added !== null) { sequence = sequence.concat([added]); }
                        return sequence.slice();
                    }
                    sequence = draw(startLength + round - 1);
                    return sequence.slice();
                },
                // 一律给拷贝：界面拿到的序列被改动也不会污染这一关的判定基准
                current: function () { return sequence.slice(); },
                round: function () { return round; },
                length: function () { return sequence.length; },
                reset: function () { sequence = []; round = 0; }
            };
        }
    };
})(window.SequenceMemory = window.SequenceMemory || {});