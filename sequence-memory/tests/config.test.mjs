import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const ns = load();

test('八个场景 key 唯一，PALETTE / DEPTH 是渲染层的唯一来源', () => {
    const keys = Object.values(ns.SCENES);
    assert.equal(keys.length, 8);
    assert.equal(new Set(keys).size, 8);
    assert.equal(ns.SCENES.BOOT, 'BootScene');
    assert.equal(ns.SCENES.GAME_OVER, 'GameOverScene');
    // 选设置屏已删（harness/requirements.md1l）：开局前的选择回到首页的玩法档 + 类型行
    assert.equal(ns.SCENES.SETUP, undefined);

    // 四个信号色一个没换（harness/gameplay.md：避开红 / 绿对），且与 COLORS 表一一对应
    assert.deepEqual(Array.from(ns.COLORS, (c) => c.hex),
        [ns.PALETTE.blue, ns.PALETTE.amber, ns.PALETTE.magenta, ns.PALETTE.teal]);
    assert.equal(ns.tint(ns.PALETTE.blue), 0x4c8dff);

    // 层序只要求相对关系，具体数值留给实现阶段挑空位
    const order = Array.from(['backdrop', 'board', 'fx', 'hud', 'overlay', 'panel'], (k) => ns.DEPTH[k]);
    assert.deepEqual(order, [...order].sort((a, b) => a - b));
    assert.ok(ns.CONFIG.TOUCH_TARGET >= 44);
});

test('四种类型：符号集大小定难度，输入方式统一成点按', () => {
    assert.deepEqual(Array.from(ns.TYPES, (t) => t.symbols), [4, 9, 10, 52]);
    // 数字类型改成点按 0–9 键盘之后，"打字类"这条支线不存在了（harness/gameplay.md）
    assert.equal(new Set(Array.from(ns.TYPES, (t) => t.input)).size, 1);
    assert.equal(ns.typeById('digit').input, 'tap');
    assert.equal(new Set(ns.COLORS.map((c) => c.shape)).size, ns.COLORS.length);
    assert.equal(ns.COLORS.length, ns.typeById('color').symbols);
});

// 2a：类型只给数据（SYMBOLS 的每格样子 + BOARDS 的排布），节奏与画法在渲染层一处实现。
// 这条钉住"开放一种类型就得给全它的符号表与排布"——ROADMAP 改成 true 而表没跟上，
// 界面会在 ns.SYMBOLS[type] 上直接炸，让测试先炸
test('已开放的类型都有一份符号表与排布，格子数与符号数对得上', () => {
    const open = Array.from(ns.TYPES).filter((type) => ns.ROADMAP.type[type.id] === true);
    assert.deepEqual(open.map((type) => type.id), ['color', 'position', 'digit', 'card']);
    assert.deepEqual(Object.keys({ ...ns.SYMBOLS }).sort(), open.map((type) => type.id).sort());
    assert.deepEqual(Object.keys({ ...ns.BOARDS }).sort(), open.map((type) => type.id).sort());

    for (const type of open) {
        const set = Array.from(ns.SYMBOLS[type.id]);
        const spec = { ...ns.BOARDS[type.id] };

        assert.equal(set.length, type.symbols);
        // 排布允许有空格（数字电话键盘 3×4 装 10 键）：带 slots 时格子数可以多于符号数，
        // 但映射必须是单射、每个符号都落在真实格子里；不带 slots 就是满方阵。
        // 选牌器（2h）是第三种：格子里排的是当前花色的 13 个点数，不是 52 张牌——
        // 花色在 tab 那一层导航，所以格子数只需装得下一门花色
        const cells = spec.cols * spec.rows;
        if (spec.kind === 'picker') {
            assert.ok(cells >= ns.RANKS.length);
        } else if (spec.slots) {
            assert.equal(spec.slots.length, type.symbols);
            assert.equal(new Set(spec.slots).size, type.symbols);
            for (const cell of spec.slots) {
                assert.ok(cell >= 0 && cell < cells);
            }
        } else {
            assert.equal(cells, type.symbols);
        }
        // 名字要能唯一指认一格：结算的诊断行只剩这一个说法（harness/ui.md）
        assert.equal(new Set(set.map((symbol) => symbol.name)).size, set.length);
        // 触控下限：玩法区的最小边长要能让每格 ≥44px（harness/ui.md）。
        // 2h 起扑克不再豁免——2d 给 52 张牌堆开的那条例外随网格一起删了
        assert.ok(spec.min >= spec.cols * ns.CONFIG.TOUCH_TARGET);
        for (const symbol of set) {
            assert.match(symbol.hex, /^#[0-9a-f]{6}$/i);
        }
    }

    // 位置类型九格同色、不带标记：颜色在这里信息量为零，一格一色等于制造干扰（harness/ui.md）
    assert.equal(new Set(Array.from(ns.SYMBOLS.position, (symbol) => symbol.hex)).size, 1);
    assert.deepEqual(Array.from(ns.SYMBOLS.position, (symbol) => symbol.glyph), Array(9).fill(null));
    // 颜色仍是一格一形状（位置 + 形状 + 颜色三重冗余，harness/gameplay.md），符号名沿用 1c 的口径
    assert.equal(new Set(Array.from(ns.SYMBOLS.color, (symbol) => symbol.glyph)).size, 4);
    assert.equal(ns.symbolName('color', 0), '蓝（圆形）');
    assert.equal(ns.symbolName('position', 0), '左上');
    assert.equal(ns.symbolName('position', 4), '正中');
    assert.equal(ns.symbolName('position', 8), '右下');

    // 数字是电话键盘（2b，harness/ui.md）：十键同色、数字本身就是标记与说法，
    // 1–9 按行优先占上三行、0 在末行正中——排布是玩法的一部分，钉住防止无意改动
    assert.deepEqual(Array.from(ns.SYMBOLS.digit, (symbol) => symbol.name),
        ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
    assert.equal(new Set(Array.from(ns.SYMBOLS.digit, (symbol) => symbol.hex)).size, 1);
    assert.equal(new Set(Array.from(ns.SYMBOLS.digit, (symbol) => symbol.glyph)).size, 10);
    const digitSpec = ns.BOARDS.digit;
    assert.deepEqual(Array.from(digitSpec.slots), [10, 0, 1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(ns.symbolName('digit', 3), '3');

    // 扑克（2d / 2h）：52 张同强调色——身份印在牌面上（点数 + 花色），一格一色是制造干扰，
    // 判据与位置九格同色、数字十键同色同源。名字与牌面数据都从 CARDS 推；
    // 序列无放回（unique），不然"选过的置灰"会把同一张牌的第二次出现锁死（harness/gameplay.md）
    assert.equal(ns.typeById('card').unique, true);
    for (const id of ['color', 'position', 'digit']) {
        assert.ok(!ns.typeById(id).unique);
    }
    assert.equal(new Set(Array.from(ns.SYMBOLS.card, (symbol) => symbol.hex)).size, 1);
    assert.deepEqual(Array.from(ns.SYMBOLS.card, (symbol) => symbol.name),
        Array.from(ns.CARDS, (card) => card.name));
    assert.deepEqual(Array.from(ns.SYMBOLS.card, (symbol) => symbol.card.id),
        Array.from(ns.CARDS, (card) => card.id));
    assert.equal(ns.symbolName('card', 0), '黑桃 A');
    assert.equal(ns.symbolName('card', 13), '红桃 A');
    assert.equal(ns.symbolName('card', 51), '方块 K');
});

// 2h：扑克复现是两步选牌，不是 52 张同屏网格（harness/gameplay.md 不做清单的两条硬理由：触控不可能达标 +
// 网格本身就是位置坐标系）。这条钉住排布与触控下限，以及"牌堆那套东西真的删干净了"
test('扑克选牌器：花色 tab 导航 + 两行点数格，触控不再豁免', () => {
    const spec = ns.BOARDS.card;
    assert.equal(spec.kind, 'picker');
    // 13 点数分两行 7 + 6（harness/ui.md）：A–K 是线性序列，两行横向扫一眼就完
    assert.equal(spec.cols, 7);
    assert.equal(spec.rows, 2);
    assert.ok(spec.cols * spec.rows >= ns.RANKS.length);
    // 花色是 tab 那一层，四门都要有 tab；点它只切面板，不占格子也不提交
    assert.equal(ns.SUITS.length, 4);
    // min 是"每格宽 ≥44px"所需的玩法区宽：7 格 + 6 缝。缩到下限以下就等于把触控豁免还回来
    assert.ok(spec.min >= spec.cols * ns.CONFIG.TOUCH_TARGET);
    // 提交的下标仍是整张牌（花色 × 13 + 点数），与 CARDS / Judge 同一套——
    // 两步选牌只改复现的排布，判定 / 计分 / 存档 schema 一个字段不变
    assert.equal(ns.CARDS[2 * 13 + 5].name, '梅花 6');

    // 52 张牌堆的错峰翻正随网格一起删了；切花色 tab 的整组换面接在它留下的位置上
    assert.equal(ns.MOTION.deal, undefined);
    assert.ok(ns.MOTION.tab > 0);
});

// 2c：一副牌的数据表。牌面画法在渲染层（AGENTS 测试边界里不测），这里只钉数据不变量——
// 52 张不重不漏、红黑各 26、下标 = 花色 × 13 + 点数。2d 的 SYMBOLS.card / BOARDS.card
// 与临时场景的排布都按这个顺序读，改了顺序等于换了一副牌
test('一副牌 52 张：4 花色 × 13 点数，红黑各 26', () => {
    assert.deepEqual(Array.from(ns.SUITS, (s) => s.id), ['spade', 'heart', 'club', 'diamond']);
    assert.equal(ns.RANKS.length, 13);
    assert.equal(ns.CARDS.length, ns.typeById('card').symbols);
    assert.equal(new Set(Array.from(ns.CARDS, (c) => c.id)).size, 52);
    assert.equal(new Set(Array.from(ns.CARDS, (c) => c.name)).size, 52);

    Array.from(ns.CARDS).forEach((card, i) => {
        const suit = ns.SUITS[Math.floor(i / 13)];
        assert.equal(card.suit, suit.id);
        assert.equal(card.rank, ns.RANKS[i % 13]);
        // 红黑是花色自带的属性，不是 52 张各写一遍
        assert.equal(card.red, suit.red);
        assert.equal(card.name, suit.name + ' ' + card.rank);
    });

    const red = Array.from(ns.CARDS).filter((c) => c.red);
    assert.equal(red.length, 26);
    assert.deepEqual([...new Set(red.map((c) => c.suit))].sort(), ['diamond', 'heart']);
    assert.equal(ns.CARDS[0].id, 'spade-A');
    assert.equal(ns.CARDS[51].id, 'diamond-K');
});

// 2e / 2f / 2g：呈现形态。判据是"测哪条通道取决于呈现时哪个维度在变"——呈现与复现共用同一张棋盘时
// 位置就是身份的免费索引，四种类型会塌成同一款空间广度游戏（harness/requirements.md2e 的动机）。
// 这条钉住三个易错点：每档都声明了形态（漏声明会静默走 board 分支）；stream 档的每个符号
// 都画得出身份（glyph 走换纹理、card 走常驻牌面，两者都没有就是一片空白的色块）；
// 位置类型必须是 board——位置就是它呈现的内容本身，搬到中央这一档就没有内容了
test('呈现形态：每档都声明了 stage，stream 档的符号都画得出身份', () => {
    for (const type of ns.TYPES) {
        assert.ok(['stream', 'board'].includes(type.stage), type.id);
        if (type.stage !== 'stream') { continue; }
        for (const symbol of ns.SYMBOLS[type.id]) {
            assert.ok(symbol.glyph || symbol.card, type.id + ' ' + symbol.name);
        }
    }
    assert.equal(ns.typeById('position').stage, 'board');
    // 2f：数字也是中央闪现——逐项呈现、看完复述才与常模的测法对上（harness/gameplay.md），
    // 复现仍是电话键盘。改回 board 等于把位置这条免费索引还给它
    assert.equal(ns.typeById('digit').stage, 'stream');
    // 2g：扑克也是中央翻牌——52 格牌堆里翻某一张，记"第几行第几张"等于记牌面的坐标形式，
    // 玩家从头到尾不必读清牌面（harness/gameplay.md）。改回 board 就是把这条免费索引还给它
    assert.equal(ns.typeById('card').stage, 'stream');
});

test('未知 id 回落到默认档而不是第一项', () => {
    assert.equal(ns.typeById(undefined).id, 'color');
    assert.equal(ns.modeById('nope').id, 'leisure');
    assert.equal(ns.directionById(null).id, 'forward');
    assert.equal(ns.speedById('nope').id, 'normal');
    assert.equal(ns.speedById('fast').show, 400);
});

test('速度三档递减且都在可调区间内，里程碑只休闲', () => {
    const shows = Array.from(ns.SPEEDS, (s) => s.show);
    assert.deepEqual(shows, [...shows].sort((a, b) => b - a));
    for (const speed of ns.SPEEDS) {
        assert.ok(speed.show >= ns.SPEED_RANGE.min && speed.show <= ns.SPEED_RANGE.max);
        assert.ok(speed.gap > 0);
    }
    // 里程碑提速只休闲（3c 起明确）：冲榜与挑战开局那一档就是全程那一档
    assert.equal(ns.modeById('leisure').milestones, true);
    assert.equal(ns.modeById('ranked').milestones, false);
    // 两模式同走即点即判，没有退格 / 容错（3b 已取消，harness/requirements.md）
    assert.equal(ns.modeById('ranked').judge, 'instant');
    assert.equal(ns.modeById('leisure').judge, 'instant');
    assert.equal(ns.modeById('leisure').retries, 0);
    assert.deepEqual(Array.from(ns.SPEED_MILESTONES), [5, 9, 13]);
});

// 3c：挑战档 = 冲榜 · 倒序 · 快，倒序放开。组合键与冲榜不同（方向 + 速度都不同），
// 记录只跟同组合比——锁速纪律只约束冲榜本档（harness/gameplay.md）
test('挑战档进表：冲榜 · 倒序 · 快，倒序已开放', () => {
    const challenge = ns.PRESETS.find((preset) => preset.id === 'challenge');
    assert.equal(challenge.mode, 'ranked');
    assert.equal(challenge.direction, 'backward');
    assert.equal(challenge.speed, 'fast');
    assert.equal(ns.ROADMAP.direction.backward, true);
    assert.equal(ns.directionById('backward').name, '倒序');
});

// 3a：里程碑提速走自己的台阶，不占 SPEEDS 的档（harness/gameplay.md）。
// 口径是**当前序列长度**，不是本局累计呈现项数——后者会让第 2 关就到 5、第 3 关到 9，开局即顶满。
// 比例与下限都是 config 里的数据，这里钉行为：跨档点、单调变快、下限、不改开局那一档
test('里程碑按当前长度跨档，show / gap 同比缩小且不低于下限', () => {
    const base = ns.speedById('normal');

    // 长度 4 还没到第一个里程碑，节拍与开局那一档一字不差
    assert.deepEqual({ ...ns.milestoneSpeed(base, 4) }, { tier: 0, show: base.show, gap: base.gap });

    const ladder = Array.from(ns.SPEED_MILESTONES, (at) => ns.milestoneSpeed(base, at));
    assert.deepEqual(ladder.map((step) => step.tier), [1, 2, 3]);

    let previous = base.show;
    for (const step of ladder) {
        assert.ok(step.show < previous, '跨一个里程碑就该更快');
        assert.ok(step.gap > 0);
        previous = step.show;
    }
    assert.equal(ladder[0].show, Math.round(base.show * ns.MILESTONE_RATIO));

    // 台阶是长度区间：5–8 都是第一档，9 才跨到第二档
    assert.equal(ns.milestoneSpeed(base, 5).tier, 1);
    assert.equal(ns.milestoneSpeed(base, 8).tier, 1);
    assert.equal(ns.milestoneSpeed(base, 9).tier, 2);

    // 下限：快档当起点时第三个里程碑落在 SPEED_RANGE.min 上，不会再往下
    assert.equal(ns.milestoneSpeed(ns.speedById('fast'), 13).show, ns.SPEED_RANGE.min);

    // 纯函数：开局那一档是组合键里的记录身份，不能被局内提速改掉
    ns.milestoneSpeed(base, 13);
    assert.equal(base.show, ns.speedById('normal').show);
    assert.equal(base.gap, ns.speedById('normal').gap);
});

test('默认设置每次返回新快照，且每个 id 都在表里', () => {
    const a = ns.defaultSettings();
    a.speed = 'fast';
    a.type = 'card';
    const b = ns.defaultSettings();
    assert.equal(b.speed, 'normal');
    assert.equal(b.type, 'color');
    assert.equal(b.startLength, ns.START_LENGTH);
    assert.equal(ns.START_LENGTH, 2);
    assert.equal(b.colorTones, false);
    assert.equal(ns.typeById(b.type).id, b.type);
    assert.equal(ns.modeById(b.mode).id, b.mode);
    assert.equal(ns.directionById(b.direction).id, b.direction);
    assert.equal(ns.speedById(b.speed).id, b.speed);
});

// 4c：起始长度离散三档（harness/gameplay.md 设置项）。上限低于第一个里程碑——
// 起始 ≥5 开局第一关就跨档提速，"提速必须被看见"在开局那一关失效
test('起始长度三档 2–4，含默认值且上限低于第一个里程碑', () => {
    assert.deepEqual(Array.from(ns.START_LENGTHS), [2, 3, 4]);
    assert.equal(ns.START_LENGTHS[0], ns.START_LENGTH);
    assert.ok(Math.max(...ns.START_LENGTHS) < ns.SPEED_MILESTONES[0]);
});

test('常模：颜色与扑克没有常模，倒序均值低于正序，有均值的都带离散度', () => {
    assert.equal(ns.NORMS.color, null);
    assert.equal(ns.NORMS.card, null);
    for (const type of ['digit', 'position']) {
        assert.ok(ns.NORMS[type].backward.mean < ns.NORMS[type].forward.mean);
        for (const direction of ['forward', 'backward']) {
            const norm = ns.NORMS[type][direction];
            // 5d：sd 缺失（null）就是"这一格没有常模"，Norms 据此不给百分位。
            // 数字的离散度文献没直接给，取的是近似值（见 config NORMS 的注释），但必须有——
            // 只有均值算不出 z 分数
            assert.ok(norm.mean > 0);
            assert.ok(norm.sd > 0);
            assert.ok(norm.source);
        }
    }
    assert.equal(ns.HISTORY_LIMIT, 20);
    assert.equal(ns.STORAGE_NS, 'toys.sequence-memory');
});

// 标注是措辞红线点名要在页面上的（harness/gameplay.md）：近似 + 常模听觉 / 本作视觉差异，
// 宽窄两版都得说全这两件事，窄版只是短不是删
test('常模标注三句都带"听觉 / 视觉"与"近似"，记录页那句另说清按最好一局算', () => {
    for (const note of [ns.NORMS_NOTE, ns.NORMS_NOTE_BEST, ns.NORMS_NOTE_SHORT]) {
        assert.ok(note.includes('听觉') && note.includes('视觉'));
        assert.ok(note.includes('近似'));
    }
    assert.ok(ns.NORMS_NOTE_BEST.includes('最好的一局'));
    assert.ok(ns.NORMS_NOTE_SHORT.length < ns.NORMS_NOTE.length);
});
