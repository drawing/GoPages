import test from 'node:test';
import assert from 'node:assert/strict';

import { load } from './load.mjs';

const ns = load();
const CONFIG = ns.CONFIG;
const PALETTE = ns.PALETTE;

// harness/gameplay.md 的难度表，逐格抄下来当契约：调手感只能改 config.js，改到与表不符就该在这里失败。
// 9a 拆分后这张表描述的是「标准方案合成后的生效档位」= 档位物理 + 标准内容池（levelFor）
const TABLE = [
    { id: 1, name: '入门', speed: 70, spawnInterval: 1800, maxOnScreen: 4, poolSize: 10, lives: 5, fontSize: 28, stroke: 2, specials: [], specialBoost: 1 },
    { id: 2, name: '轻松', speed: 100, spawnInterval: 1400, maxOnScreen: 5, poolSize: 20, lives: 5, fontSize: 28, stroke: 2, specials: ['gold', 'ice'], specialBoost: 1 },
    { id: 3, name: '标准', speed: 135, spawnInterval: 1050, maxOnScreen: 7, poolSize: 26, lives: 4, fontSize: 30, stroke: 2, specials: ['gold', 'ice', 'void', 'double'], specialBoost: 1 },
    { id: 4, name: '困难', speed: 175, spawnInterval: 850, maxOnScreen: 7, poolSize: 36, lives: 3, fontSize: 32, stroke: 3, specials: ['gold', 'ice', 'void', 'double'], specialBoost: 1 },
    { id: 5, name: '大师', speed: 225, spawnInterval: 620, maxOnScreen: 8, poolSize: 45, lives: 3, fontSize: 34, stroke: 3, specials: ['gold', 'ice', 'void', 'double'], specialBoost: 2 }
];

// 档位只管物理（9a）：LEVELS 不再带内容池，物理与可读性补偿字段逐格对齐难度表
test('LEVELS 只管物理：五档不含内容池，物理字段逐格对齐难度表', function () {
    assert.equal(ns.LEVELS.length, TABLE.length);
    ns.LEVELS.forEach(function (level, index) {
        const row = TABLE[index];
        assert.ok(!('pool' in level), 'Lv' + row.id + ' 档位还带着内容池（内容归方案）');
        for (const key of Object.keys(row)) {
            if (key === 'poolSize') { continue; }
            const actual = level[key];
            // 表里的数组来自 load.mjs 的 vm realm，deepStrictEqual 会比原型，先拷回本 realm
            assert.deepEqual(Array.isArray(actual) ? Array.from(actual) : actual, row[key], 'Lv' + row.id + ' 的 ' + key);
        }
    });
});

// 标准方案内容表 = 拆分前的现状：levelFor 合成的生效档位逐格对齐旧难度表（含池大小），
// 守住"判定与计分一字不改、旧最高分原样可读"那条验收
test('标准方案合成档位：levelFor 逐格对齐旧难度表（物理 + 中排→全池）', function () {
    ns.LEVELS.forEach(function (level, index) {
        const row = TABLE[index];
        const composed = ns.levelFor('standard', level.id);
        for (const key of Object.keys(row)) {
            const actual = key === 'poolSize' ? composed.pool.length : composed[key];
            assert.deepEqual(Array.isArray(actual) ? Array.from(actual) : actual, row[key], 'Lv' + row.id + ' 的 ' + key);
        }
    });
});

// 设计约束：难度来自速度与字母池，不靠同屏密度堆——五档理论同屏必须都停在 4–5
test('反应窗口 8.6s 收到 2.7s，理论同屏五档恒在 4–5', function () {
    const travel = CONFIG.HORIZON_Y - CONFIG.SPAWN_Y;
    const windows = ns.LEVELS.map((level) => travel / level.speed);

    assert.equal(windows[0].toFixed(1), '8.6');
    assert.equal(windows[4].toFixed(1), '2.7');

    ns.LEVELS.forEach(function (level, index) {
        const density = windows[index] / (level.spawnInterval / 1000);
        assert.ok(density >= 4 && density <= 5, 'Lv' + level.id + ' 理论同屏 ' + density);
        if (index === 0) { return; }
        assert.ok(windows[index] < windows[index - 1], 'Lv' + level.id + ' 反应窗口没收紧');
        assert.ok(level.spawnInterval < ns.LEVELS[index - 1].spawnInterval);
        // 内容池梯度归标准方案（9a）：逐档扩池仍是设计契约，只是真值搬进了 SCHEMES
        const pool = ns.levelFor('standard', level.id).pool;
        const prevPool = ns.levelFor('standard', ns.LEVELS[index - 1].id).pool;
        assert.ok(pool.length > prevPool.length);
        assert.ok(level.fontSize >= ns.LEVELS[index - 1].fontSize, '高速档字号不能反而变小');
    });
});

test('字母池：无重复键，Lv1 只有中排，Lv5 收齐八个符号与分号', function () {
    const full = 'abcdefghijklmnopqrstuvwxyz0123456789-=[]\',./;';
    for (const level of ns.LEVELS) {
        const pool = ns.levelFor('standard', level.id).pool;
        assert.equal(new Set(pool).size, pool.length, 'Lv' + level.id + ' 有重复键');
        for (const ch of pool) {
            assert.ok(full.includes(ch), 'Lv' + level.id + ' 的 ' + ch + ' 不在 45 键全集里');
        }
    }

    assert.equal(ns.levelFor('standard', 1).pool, 'asdfghjkl;');
    assert.equal(ns.levelFor('standard', 3).pool, 'abcdefghijklmnopqrstuvwxyz');
    for (const ch of '0123456789') { assert.ok(ns.levelFor('standard', 4).pool.includes(ch), ch); }
    for (const ch of '-=[]\',./;') { assert.ok(ns.levelFor('standard', 5).pool.includes(ch), ch); }
});

test('levelById：五档都取得到，缺参与未知 id 回落默认档而不是第一档', function () {
    for (const level of ns.LEVELS) { assert.equal(ns.levelById(level.id), level); }
    assert.equal(ns.levelById(undefined), ns.levelById(ns.DEFAULT_LEVEL));
    assert.equal(ns.levelById(99), ns.levelById(ns.DEFAULT_LEVEL));
    assert.notEqual(ns.levelById(99).id, ns.LEVELS[0].id);
});

// 9a 方案注册表：标准方案带版本、内容梯度覆盖五档；schemeById 与 levelById 同一套回落纪律
test('SCHEMES：标准方案 version 1、内容表覆盖五档且逐档扩池，schemeById 回落标准', function () {
    const standard = ns.schemeById('standard');
    assert.equal(standard, ns.schemeById(ns.DEFAULT_SCHEME));
    assert.equal(standard.id, 'standard');
    assert.equal(standard.version, 1);
    assert.ok(standard.name.length > 0 && standard.desc.length > 0);
    // 内容梯度表必须给五档各一份池，且逐档严格扩池（标准方案 = 中排 → 全池）
    let prev = 0;
    for (const level of ns.LEVELS) {
        const pool = standard.content[level.id];
        assert.ok(typeof pool === 'string' && pool.length > 0, 'Lv' + level.id + ' 缺内容池');
        assert.ok(pool.length > prev, 'Lv' + level.id + ' 内容池没扩');
        prev = pool.length;
    }
    // 缺参与未知 id 回落标准方案，不是 SCHEMES[0] 的偶然顺序
    assert.equal(ns.schemeById(undefined), standard);
    assert.equal(ns.schemeById('nope'), standard);
});

// 9c 专练方案：字母 / 数字 / 符号注册进表，各有内容梯度。字母任何档位不出数字符号
// （';' 属符号键，中排也剔除）；数字符号入门档即出全池、五档恒定（档位只提速）；
// 物理仍读共享 LEVELS——改档位物理所有方案同步生效。9e 又注册了汉字方案（下面单独一条）
test('专练方案：字母逐档扩到全字母不出数字符号，数字符号入门即全池且五档恒定', function () {
    assert.deepEqual(Array.from(ns.SCHEMES.filter((scheme) => !scheme.combo), (scheme) => scheme.id), ['standard', 'letters', 'digits', 'symbols', 'hanzi', 'flypy']);
    for (const id of ['letters', 'digits', 'symbols']) {
        const scheme = ns.schemeById(id);
        assert.equal(scheme.version, 1);
        assert.ok(scheme.name.length > 0 && scheme.desc.length > 0, id + ' 缺名字或说明');
        for (const level of ns.LEVELS) {
            const pool = scheme.content[level.id];
            assert.ok(typeof pool === 'string' && pool.length > 0, id + ' Lv' + level.id + ' 缺内容池');
            assert.equal(new Set(pool).size, pool.length, id + ' Lv' + level.id + ' 有重复键');
            // 物理读共享档位：合成档位的物理字段与 LEVELS 逐格一致，池才归方案
            const composed = ns.levelFor(id, level.id);
            assert.equal(composed.speed, level.speed);
            assert.equal(composed.fontSize, level.fontSize);
            assert.equal(composed.pool, pool);
        }
    }

    const letters = ns.schemeById('letters');
    for (const level of ns.LEVELS) {
        for (const ch of letters.content[level.id]) {
            assert.ok(ch >= 'a' && ch <= 'z', '字母专练 Lv' + level.id + ' 出了 ' + ch);
        }
    }
    assert.equal(letters.content[1], 'asdfghjkl');
    assert.equal(letters.content[2], 'asdfghjklqwertyuiop');
    assert.equal(letters.content[3], 'abcdefghijklmnopqrstuvwxyz');
    assert.equal(letters.content[4], letters.content[3]);
    assert.equal(letters.content[5], letters.content[3]);

    const digits = ns.schemeById('digits');
    const symbols = ns.schemeById('symbols');
    assert.equal(digits.content[1], '0123456789');
    assert.equal(symbols.content[1], "-=[]',./;");
    for (const level of ns.LEVELS) {
        assert.equal(digits.content[level.id], digits.content[1], '数字专练 Lv' + level.id + ' 内容变了（档位只提速）');
        assert.equal(symbols.content[level.id], symbols.content[1], '符号专练 Lv' + level.id + ' 内容变了（档位只提速）');
    }
});

// 9h 组合专练：四种组合程序化注册——内容逐档 = 成员拼接（成员池互不相交 ⇒ 无重复键），
// version = 成员之和（任一成员 bump 版本改池时旧组合记录键自动失效封存，9a 封印契约的推广）
test('组合专练注册：内容逐档 = 成员拼接，version = 成员之和，不出双星不是单元', function () {
    const combos = ns.SCHEMES.filter((scheme) => scheme.combo);
    assert.deepEqual(Array.from(combos, (scheme) => scheme.id),
        ['letters+digits', 'letters+symbols', 'digits+symbols', 'letters+digits+symbols']);
    for (const combo of combos) {
        const members = combo.id.split('+').map((id) => ns.schemeById(id));
        assert.equal(combo.version, members.reduce((sum, member) => sum + member.version, 0), combo.id + ' 版本不是成员之和');
        assert.equal(combo.pair, false, combo.id + ' 不该用线连双星');
        assert.equal(combo.unit, false, combo.id + ' 不该是单元方案');
        for (const level of ns.LEVELS) {
            const pool = combo.content[level.id];
            assert.equal(pool, members.map((member) => member.content[level.id]).join(''), combo.id + ' Lv' + level.id + ' 内容不是成员拼接');
            assert.equal(new Set(pool).size, pool.length, combo.id + ' Lv' + level.id + ' 有重复键');
        }
    }
});

// 9h 多选互斥（弹层 onSelect 只调这个纯函数）：三成员任意组合可达且与点击序无关；
// 标准 / 汉字 / 双拼单选互斥（点它即清空组合）；组合空了回落标准
test('toggleScheme：组合与点击序无关，标准/汉字/双拼单选互斥，空集回落标准', function () {
    // 从标准出发，任意点击序到三合都是同一个规范 id
    assert.equal(ns.toggleScheme(ns.toggleScheme(ns.toggleScheme('standard', 'symbols'), 'letters'), 'digits'), 'letters+digits+symbols');
    assert.equal(ns.toggleScheme(ns.toggleScheme(ns.toggleScheme('standard', 'digits'), 'symbols'), 'letters'), 'letters+digits+symbols');
    // 单成员 = 单元素组合；再点已选成员是取消
    assert.equal(ns.toggleScheme('standard', 'letters'), 'letters');
    assert.equal(ns.toggleScheme('letters', 'digits'), 'letters+digits');
    assert.equal(ns.toggleScheme('letters+digits', 'letters'), 'digits');
    assert.equal(ns.toggleScheme('letters+digits+symbols', 'digits'), 'letters+symbols');
    assert.equal(ns.toggleScheme('letters', 'letters'), 'standard');
    // 互斥行：组合态 / 单元态点它都直接换成它
    for (const id of ['standard', 'hanzi', 'flypy']) {
        assert.equal(ns.toggleScheme('letters+digits', id), id);
        assert.equal(ns.toggleScheme('hanzi', id), id);
    }
    // 单元 / 标准态点成员 = 从头起组合，不与原方案叠加
    assert.equal(ns.toggleScheme('hanzi', 'digits'), 'digits');
    assert.equal(ns.toggleScheme('flypy', 'symbols'), 'symbols');
});

// 所有**键位方案**的池：字符都在 45 键全集里（letters.test 已逐键证明全集每个字符有唯一键位），
// 控制键 ` 与 \ 永远在池外——否则参考线 / 回菜单快捷键会变成"打不掉的星"。
// 9e 起单元方案的内容串是汉字（一个字一个单元），它的"池"要按**键序**验，见下面那条字表契约
test('键位方案的池：都在 45 键全集内，控制键 ` 与 \\ 不在任何池里', function () {
    const full = 'abcdefghijklmnopqrstuvwxyz0123456789-=[]\',./;';
    for (const scheme of ns.SCHEMES) {
        if (scheme.unit) { continue; }
        for (const level of ns.LEVELS) {
            const pool = scheme.content[level.id];
            assert.ok(!pool.includes('`') && !pool.includes('\\'), scheme.id + ' Lv' + level.id + ' 收了控制键');
            for (const ch of pool) {
                assert.ok(full.includes(ch), scheme.id + ' Lv' + level.id + ' 的 ' + ch + ' 不在 45 键全集里');
            }
        }
    }
});

// levelFor 合成「本局生效档位」：物理来自共享档位、池来自方案，每次新对象不污染共享表；
// 改档位物理所有方案同步生效（跨方案逐格对齐在下面专练方案那条守）
test('levelFor：物理读共享档位、池读方案，返回新对象，缺参回落标准方案与默认档', function () {
    const composed = ns.levelFor('standard', 3);
    const tier = ns.levelById(3);
    assert.equal(composed.speed, tier.speed);
    assert.equal(composed.fontSize, tier.fontSize);
    assert.deepEqual(Array.from(composed.specials), Array.from(tier.specials));
    assert.equal(composed.pool, ns.schemeById('standard').content[3]);
    assert.notEqual(composed, tier, '合成档位不该是共享条目本身');
    // 就地改合成对象不污染共享 LEVELS 与 SCHEMES
    composed.speed = 999;
    composed.pool = 'zzz';
    assert.equal(ns.levelById(3).speed, tier.speed);
    assert.equal(ns.schemeById('standard').content[3], 'abcdefghijklmnopqrstuvwxyz');
    // 缺参与未知 scheme/level 回落标准方案 + 默认档
    assert.equal(ns.levelFor(undefined, undefined).pool, ns.levelFor('standard', ns.DEFAULT_LEVEL).pool);
    assert.equal(ns.levelFor('nope', 99).id, ns.DEFAULT_LEVEL);
});

// 9d 线连双星仅标准方案：方案 pair 标志驱动 levelFor 过滤 specials——标准保留 double、
// 专练滤掉它；过滤按类型表的 pair 标志（不硬编码 id），共享 LEVELS 不动，门禁只在合成层
test('双星门禁：标准方案保留 double，专练滤掉它，共享档位不被改', function () {
    assert.equal(ns.schemeById('standard').pair, true);
    for (const id of ['letters', 'digits', 'symbols']) {
        assert.equal(ns.schemeById(id).pair, false, id + ' 不该用线连双星');
    }
    for (const id of [3, 4, 5]) {
        assert.ok(ns.levelFor('standard', id).specials.includes('double'), '标准 Lv' + id + ' 丢了双星');
    }
    for (const id of ['letters', 'digits', 'symbols']) {
        for (const lv of [3, 4, 5]) {
            const specials = Array.from(ns.levelFor(id, lv).specials).sort();
            assert.deepEqual(specials, ['gold', 'ice', 'void'], id + ' Lv' + lv + ' 的特殊星清单');
        }
    }
    // 共享 LEVELS 仍含 double（门禁只在 levelFor 合成层，调档位物理不波及）
    for (const id of [3, 4, 5]) { assert.ok(ns.levelById(id).specials.includes('double')); }
    // 合成 specials 是新数组：就地改不污染共享档位
    const composed = ns.levelFor('standard', 3);
    composed.specials.push('nope');
    assert.ok(!ns.levelById(3).specials.includes('nope'));
});

// 9e 单元方案的字表契约（harness/gameplay.md 单元方案节）：内容串里每个字都查得到、
// 键序在 2–6 键且全在 a–z（调号 / ü / 分隔符一律不收）、每档无重复字、逐档累加。
// 梯度按**键序长度**走：Lv1 只有 2–3 键，Lv5 才出现 6 键——最长拼音压不到，
// 那条可读性红线就等于没验过。9g-1 只放宽了多音字、没换梯度轴，所以这套断言照旧成立
test('汉字方案字表：每字键序在 a–z 内，逐档累加，Lv5 才出 6 键', function () {
    const scheme = ns.schemeById('hanzi');
    assert.equal(scheme.unit, true);
    assert.equal(scheme.pair, false, '单元方案用单体序列星，不挂线连双星');
    // 9g-1 bump 到 2：内容表加了 19 个多音字、判定语义也跟着变（一颗星可由两条键序消除），
    // hanzi@1 的旧记录因此自然封存不混算
    assert.equal(scheme.version, 2);
    assert.ok(scheme.name.length > 0 && scheme.desc.length > 0, '缺名字或说明');

    let previous = '';
    for (const level of ns.LEVELS) {
        const chars = scheme.content[level.id];
        assert.ok(typeof chars === 'string' && chars.length > 0, 'Lv' + level.id + ' 缺内容');
        assert.ok(chars.startsWith(previous), 'Lv' + level.id + ' 不是逐档累加（升档会丢掉上一档的字）');
        assert.ok(chars.length > previous.length, 'Lv' + level.id + ' 字数没有增长');
        previous = chars;
        assert.equal(new Set(chars).size, chars.length, 'Lv' + level.id + ' 有重复字');

        const units = ns.unitsFor(chars);
        assert.equal(units.length, chars.length);
        for (const unit of units) {
            assert.equal(unit.face.length, 1, unit.face + ' 的显示面应当是一个汉字');
            assert.ok(unit.readings.length >= 1, unit.face + ' 至少要有一条读音');
            assert.deepEqual(Array.from(unit.keys), Array.from(unit.readings[0]),
                unit.face + ' 的 keys 应当是规范读音（readings[0]）');
            for (const reading of unit.readings) {
                assert.ok(reading.length >= 2 && reading.length <= 6,
                    unit.face + ' 的键序长度 ' + reading.length + ' 不在 2–6 之间');
                for (const key of reading) {
                    assert.ok(key >= 'a' && key <= 'z',
                        unit.face + ' 的键 ' + key + ' 不在 a–z 里（调号 / ü / 分隔符都不许收）');
                }
            }
        }
        // 合成档位：pool 仍是内容串（与键位方案同构，菜单预览与 ?debug 读数一行不改），
        // 单元表与造型几何挂在 level.units 上
        const composed = ns.levelFor('hanzi', level.id);
        assert.equal(composed.pool, chars);
        assert.equal(composed.units.list.length, chars.length);
        assert.equal(composed.speed, level.speed, '物理仍读共享档位');
    }
    // 逐档字数（9g-1 加了 19 个多音字：28 → 43 → 66 → 83 → 94）
    assert.deepEqual(Array.from(ns.LEVELS, (level) => scheme.content[level.id].length),
        [28, 43, 66, 83, 94]);

    const lengths = (id) => ns.levelFor('hanzi', id).units.list.map((unit) => unit.keys.length);
    assert.equal(Math.max(...lengths(1)), 3, 'Lv1 不该出 4 键以上');
    assert.equal(Math.max(...lengths(3)), 4);
    assert.equal(Math.max(...lengths(4)), 5);
    assert.equal(Math.max(...lengths(5)), 6, 'Lv5 必须出现最长拼音');
    assert.ok(lengths(5).filter((length) => length === 6).length >= 3,
        '6 键的字太少，长键序星面读不读得清根本点不出来');
    // 每一档**新增**那批字的键数必须齐整（梯度就是按键序长度走的）：钉增量而不是钉整档的上限，
    // 才抓得住"把一个 4 键字塞进 Lv1"与"把一个 2 键字当成 3 键档的内容"这两种放错格子
    const bands = { 1: [2, 3], 2: [3, 3], 3: [4, 4], 4: [5, 5], 5: [6, 6] };
    let prior = '';
    for (const level of ns.LEVELS) {
        const chars = scheme.content[level.id];
        const band = bands[level.id];
        for (const unit of ns.unitsFor(chars.slice(prior.length))) {
            assert.ok(unit.keys.length >= band[0] && unit.keys.length <= band[1],
                'Lv' + level.id + ' 新增的 ' + unit.face + ' 是 ' + unit.keys.length +
                ' 键，这一档只收 ' + band[0] + '–' + band[1] + ' 键');
        }
        prior = chars;
    }
    // 字表缺字要炸出来而不是静默跳过：静默跳过会让某一档悄悄少几个字没人发现
    assert.throws(() => ns.unitsFor('龘'), /字表里没有这个字/);
});

// 9g-1 多音字的收字硬约束（harness/gameplay.md 多音字节 + architecture.md 已知坑）：
// **各读音等长且两两不同**。等长一刀堵掉三个洞——等长 ⇒ 不互为前缀 ⇒ 消除时机唯一
// （不会出现"敲完 de 时 dei 还差一键、星该不该炸"）⇒ 进度点总数恒有定义；等长也 ⇒
// 没有短读音可挑 ⇒ "一个单元 = 一次击落"的计分不被"挑最短读音"这个退化最优解污染。
// 两两不同是省得同一颗星挂两条一模一样的路径（白占 nextKeys 去重的功夫，读数也难懂）
test('多音字收字约束：每字各读音等长且两两不同，不等长的常用多音字一个没收', function () {
    const all = ns.levelFor('hanzi', 5).units.list;
    // Array.from 把 vm 里的数组拷回本 realm（.map 会沿用 vm 的 Array 物种），deepEqual 才不比原型
    const spellings = (unit) => Array.from(unit.readings, (reading) => reading.join(''));
    let polyphones = 0;
    for (const unit of all) {
        const lengths = new Set(unit.readings.map((reading) => reading.length));
        assert.equal(lengths.size, 1, unit.face + ' 的各读音不等长（' + spellings(unit).join(' / ') +
            '）——消除时机与进度点数都会失去定义');
        const codes = spellings(unit);
        assert.equal(new Set(codes).size, codes.length, unit.face + ' 有两条相同的读音');
        if (unit.readings.length > 1) { polyphones++; }
    }
    // 反向保险：多音字全被约束挡光的话，上面那个循环等于没跑
    assert.ok(polyphones >= 10, '只收到 ' + polyphones + ' 个多音字，字表大概没接上');
    // 抽查锚点：钉住"任一读音都写在表里"，不是碰巧等长
    const find = (face) => all.find((unit) => unit.face === face);
    assert.deepEqual(spellings(find('行')), ['xing', 'hang']);
    assert.deepEqual(spellings(find('地')), ['di', 'de']);
    assert.deepEqual(spellings(find('长')), ['chang', 'zhang']);
    assert.deepEqual(spellings(find('的')), ['de', 'di'], '两条读音同首键，nextKeys 要去重成一个 d');
    assert.equal(find('好').readings.length, 1, '好 hǎo / hào 字母串本来就相同，写一条就够');
    assert.equal(find('中').readings.length, 1, '中 zhōng / zhòng 同理');
    // 不等长的常用多音字必须**不在**表里（收进来就会同时捅出前缀歧义 / 点数无定义 / 挑短读音三个洞）
    for (const face of '会得石大车还没六给似宿削') {
        assert.equal(find(face), undefined, face + ' 各读音不等长，不该收进来');
    }
});

// 9f 小鹤双拼编码（harness/gameplay.md 双拼方案节）：声母 zh→v/ch→i/sh→u + 韵母键位，
// 零声母统一「首字母 + 韵母键」，ü 的键盘形式 v/ve、iu/ui/un 缩写都覆盖。抽查锚点钉住规则
test('encodeShuangpin：声母 / 韵母 / 零声母 / ü / 缩写逐条锚点', function () {
    const enc = (s) => ns.encodeShuangpin(s, ns.FLYPY).join('');
    // 翘舌声母 + 长韵母
    assert.equal(enc('zhuang'), 'vl');
    assert.equal(enc('chuang'), 'il');
    assert.equal(enc('shuang'), 'ul');
    assert.equal(enc('zhong'), 'vs');
    assert.equal(enc('shi'), 'ui');
    assert.equal(enc('chi'), 'ii');
    assert.equal(enc('zhi'), 'vi');
    // ui / un / iu 缩写
    assert.equal(enc('hui'), 'hv');
    assert.equal(enc('shui'), 'uv');
    assert.equal(enc('jun'), 'jy');
    assert.equal(enc('qun'), 'qy');
    assert.equal(enc('xun'), 'xy');
    assert.equal(enc('jiu'), 'jq');
    // ü：l/n 后键盘形式 v/ve；ju/qu/xu/yu 本就用 u
    assert.equal(enc('nv'), 'nv');
    assert.equal(enc('lv'), 'lv');
    assert.equal(enc('nve'), 'nt');
    assert.equal(enc('lve'), 'lt');
    assert.equal(enc('yue'), 'yt');
    assert.equal(enc('xue'), 'xt');
    assert.equal(enc('yuan'), 'yr');
    assert.equal(enc('quan'), 'qr');
    assert.equal(enc('yu'), 'yu');
    // 零声母：首字母 + 韵母键（单韵母双写）
    assert.equal(enc('a'), 'aa');
    assert.equal(enc('o'), 'oo');
    assert.equal(enc('e'), 'ee');
    assert.equal(enc('ai'), 'ad');
    assert.equal(enc('ei'), 'ew');
    assert.equal(enc('ao'), 'ac');
    assert.equal(enc('ou'), 'oz');
    assert.equal(enc('an'), 'aj');
    assert.equal(enc('en'), 'ef');
    assert.equal(enc('ang'), 'ah');
    assert.equal(enc('eng'), 'eg');
    assert.equal(enc('er'), 'er');
    // y/w 当声母 + 缩写韵母
    assert.equal(enc('you'), 'yz');
    assert.equal(enc('yong'), 'ys');
    assert.equal(enc('yin'), 'yb');
    assert.equal(enc('ying'), 'yk');
    assert.equal(enc('weng'), 'wg');
    assert.equal(enc('yi'), 'yi');
    assert.equal(enc('wu'), 'wu');
    // 查不到韵母返回 null（配置错误暴露，不静默）
    assert.equal(ns.encodeShuangpin('zzz', ns.FLYPY), null);
});

// 9f 映射表覆盖全部合法音节、码字唯一（无死键 + 干净双射）：412 个音节每个都编码成 2 个 a–z 键，
// 且全局无碰撞。lo 与 luo 同码（o/uo 都映 O）已剔除 lo——这条钉住"剔除后仍是双射"
test('小鹤双拼映射：覆盖 412 个合法音节，每音节恒 2 个 a–z 键且码字全局唯一', function () {
    assert.equal(ns.SYLLABLES.length, 412);
    assert.ok(!ns.SYLLABLES.includes('lo'), 'lo 与 luo 同码，应当剔除');
    assert.ok(ns.SYLLABLES.includes('luo'));
    assert.equal(new Set(ns.SYLLABLES).size, ns.SYLLABLES.length, '音节表有重复');
    const seen = Object.create(null);
    for (const syllable of ns.SYLLABLES) {
        const keys = ns.encodeShuangpin(syllable, ns.FLYPY);
        assert.ok(Array.isArray(keys) && keys.length === 2, syllable + ' 没编码成两键');
        for (const key of keys) {
            assert.ok(key >= 'a' && key <= 'z', syllable + ' 的键 ' + key + ' 不在 a–z 里');
        }
        const code = keys.join('');
        assert.ok(!seen[code], '码字 ' + code + ' 碰撞：' + seen[code] + ' / ' + syllable);
        seen[code] = syllable;
    }
});

// 9f 换映射方案 = 注册新方案而非改本方案：编码器由 map 驱动，换一张 map 就得到不同的键。
// 这里改一个韵母键位验证编码器读的是入参 map，而不是写死的小鹤表
test('encodeShuangpin 由 map 驱动：换一张映射表得到不同键（换方案不改编码器）', function () {
    const altered = { initials: Object.assign({}, ns.FLYPY.initials), finals: Object.assign({}, ns.FLYPY.finals, { ang: 'x' }) };
    assert.equal(ns.encodeShuangpin('shang', ns.FLYPY).join(''), 'uh');
    assert.equal(ns.encodeShuangpin('shang', altered).join(''), 'ux');
    // 原表不被改动
    assert.equal(ns.FLYPY.finals.ang, 'h');
});

// 9f 双拼方案契约：unit:true / pair:false / version 1，内容复用汉字表按音节常用度逐档累加，
// 每单元键序恒 2 键且全 a–z、星面单汉字；合成档位走 unit 门禁（只留金 / 冰）、造型复用 9e
test('双拼方案：恒 2 键、内容逐档累加且每字在汉字表内、门禁与造型复用单元方案', function () {
    const scheme = ns.schemeById('flypy');
    assert.equal(scheme.unit, true);
    assert.equal(scheme.pair, false, '双拼用单体序列星，不挂线连双星');
    assert.equal(scheme.version, 1);
    assert.ok(scheme.name.length > 0 && scheme.desc.length > 0, '缺名字或说明');
    assert.ok(scheme.shuangpin, '双拼方案要挂映射表');

    let previous = '';
    for (const level of ns.LEVELS) {
        const chars = scheme.content[level.id];
        assert.ok(typeof chars === 'string' && chars.length > 0, 'Lv' + level.id + ' 缺内容');
        assert.ok(chars.startsWith(previous), 'Lv' + level.id + ' 不是逐档累加');
        assert.ok(chars.length > previous.length, 'Lv' + level.id + ' 字数没有增长');
        previous = chars;
        assert.equal(new Set(chars).size, chars.length, 'Lv' + level.id + ' 有重复字');

        const composed = ns.levelFor('flypy', level.id);
        assert.equal(composed.pool, chars);
        assert.equal(composed.units.list.length, chars.length);
        assert.equal(composed.units.body, ns.CONFIG.UNIT_STAR_SIZE, '星体复用 9e 的 96');
        assert.equal(composed.speed, level.speed, '物理仍读共享档位');
        for (const unit of composed.units.list) {
            assert.equal(unit.face.length, 1, unit.face + ' 的星面应当是一个汉字');
            assert.ok(ns.unitsFor(unit.face), unit.face + ' 不在汉字表内');
            assert.equal(unit.keys.length, 2, unit.face + ' 的双拼键序应当恒 2 键');
            for (const key of unit.keys) {
                assert.ok(key >= 'a' && key <= 'z', unit.face + ' 的键 ' + key + ' 不在 a–z 里');
            }
            // **这条断言就是 flypy 不用 bump 版本的理由**（9g-1）：内容串里一个多音字都没有，
            // 所以每个单元仍只有一条读音、行为与 9f 逐字相同。哪天往 FLYPY_L* 里塞进多音字，
            // 这条会失败——那时才需要 version +1（双拼恒 2 键，等长约束天然满足，机制已就位）
            assert.equal(unit.readings.length, 1,
                unit.face + ' 在双拼内容里出现了多条读音，内容表变了就该 bump version');
            for (const reading of unit.readings) {
                assert.equal(reading.length, 2, unit.face + ' 的每条读音都该恒 2 键');
            }
        }
        // unit 门禁：黑洞与双星都滤掉，只留金 / 冰
        const expected = Array.from(level.specials).filter((id) => ns.starType(id).unit).sort();
        assert.deepEqual(Array.from(composed.specials).sort(), expected, '双拼 Lv' + level.id + ' 的特殊星清单');
    }
    // 全拼汉字方案不受影响：同一个「好」仍是 h-a-o 三键（双拼才是两键）
    assert.deepEqual(Array.from(ns.unitsFor('好')[0].keys), ['h', 'a', 'o']);
    assert.deepEqual(Array.from(ns.levelFor('flypy', 1).units.list.find((u) => u.face === '好').keys), ['h', 'c']);
});

// 9e 单体序列星的造型几何（harness/ui.md 单体序列星节 + 原未决 #8 的定案）：星体恒 96
// （×4/3 剪影自相似，**不随键序长度逐星变**——星体大小不该变成"这颗有几键"的读数）、
// 面字号 = 档位 fontSize × 0.66 夹在红线 [18, 26] 内、点在上（星体最宽那一段）面在下。
// 三条几何不变量守住：字的墨迹底不越底部 V 形缺口、点排不戳出星腰、点与字不叠
test('序列星造型：面字号随档位走且不低于红线，点排与显示面都落在星体实心区内', function () {
    const CONFIG = ns.CONFIG;
    const body = CONFIG.UNIT_STAR_SIZE;
    assert.equal(body, 96);
    assert.equal(body * 3, CONFIG.STAR_SIZE * 4, '星体是 72 × 4/3：剪影自相似，tint 边与白芯比例不变');

    // 五档逐格：面字号 = round(fontSize × 0.66)，落在红线内且随档位单调不减
    assert.deepEqual(Array.from(ns.LEVELS, (level) => ns.unitArt(level).face), [18, 18, 20, 21, 22]);
    for (const level of ns.LEVELS) {
        const art = ns.unitArt(level);
        assert.equal(art.body, body);
        assert.ok(art.face >= CONFIG.UNIT_FACE_MIN, 'Lv' + level.id + ' 的面字号破了可读性红线');
        assert.ok(art.face <= CONFIG.UNIT_FACE_MAX, 'Lv' + level.id + ' 的面字号捅出白芯');
        assert.equal(art.face, ns.unitFaceSize(level), 'cells 缺省就是 1（汉字）');
        // 墨迹底不越底部缺口：越过就等于字有一半画在星体外的夜空上
        assert.ok(art.faceY + art.faceHalf <= CONFIG.UNIT_NOTCH_Y * body + 1e-9,
            'Lv' + level.id + ' 的字墨迹越过了底部缺口');
        // 点与字不叠（贴边是设计值：面顶紧贴点排下沿 + 净空）
        assert.ok(art.faceY - art.faceHalf >= art.pipY + art.pipR + CONFIG.UNIT_PIP_GAP - 1e-9,
            'Lv' + level.id + ' 的字与点排叠在一起');
        assert.equal(art.pipY, CONFIG.UNIT_PIP_Y * body);
    }
    // 最长键序（6 键）的点排仍在星腰内：半宽 = (6−1) × 点距 / 2 + 点径
    const art = ns.unitArt(ns.levelById(5));
    const halfSpan = 5 * art.pipPitch / 2 + art.pipR;
    assert.ok(halfSpan <= CONFIG.UNIT_BAND_HALF * body,
        '6 个点戳出了星体实心区（半宽 ' + halfSpan.toFixed(1) + ' > ' + (CONFIG.UNIT_BAND_HALF * body).toFixed(1) + '）');
    // 点距 ≥ 3 倍点径：相邻两点净空一个半径，亮暗才分得开（2.2 × 3 在浮点上是 6.6000…1，留一点容差）
    assert.ok(art.pipPitch >= art.pipR * 3 - 1e-9);
});

// 多格拉丁面（9f 的音节）的口子：按格数缩到 fit，缩不动就停在红线上——
// **如实报"撞红线"而不是假装塞得下**，那时要么换汉字面、要么升级星体，是 9f 自己的决定
test('星面字号：多格拉丁面按格数缩到 fit，撞红线时仍如实报超预算', function () {
    const level = ns.levelById(5);
    const budget = ns.CONFIG.UNIT_FACE_BOX * ns.CONFIG.UNIT_STAR_SIZE;
    assert.equal(ns.unitFaceSize(level, 1), ns.unitArt(level).face);
    assert.equal(ns.unitFaceSize(level, 2), Math.max(ns.CONFIG.UNIT_FACE_MIN, Math.floor(budget / 2)));
    assert.equal(ns.unitFaceSize(level, 6), ns.CONFIG.UNIT_FACE_MIN, '6 格音节面撞红线');
    assert.ok(6 * ns.unitFaceSize(level, 6) > budget, '撞红线就是塞不下，别把它当成"已经 fit 了"');
});

// 9e 单元方案的门禁：黑洞与双星都装不进单体序列星，levelFor 按类型表的 unit 标志滤掉它们
// ——与 9d 的 pair 门禁同一条套路（不硬编码 id），共享 LEVELS 不动，门禁只在合成层
test('单元方案门禁：滤掉黑洞与双星只留金 / 冰，类型表标志钉住，共享档位不被改', function () {
    for (const id of ['standard', 'letters', 'digits', 'symbols']) {
        assert.equal(ns.schemeById(id).unit, false, id + ' 不是单元方案');
    }
    // 黑洞不进单元方案的理由是"玩家按对了却掉命"（gameplay.md 特殊星节），所以标志必须钉住
    assert.equal(ns.starType('void').unit, false, '黑洞只有一个"不能按的键"，装不进显示面');
    assert.equal(ns.starType('double').unit, false, '双星是线连造型，与单体序列星互斥');
    for (const id of ['normal', 'gold', 'ice']) {
        assert.equal(ns.starType(id).unit, true, id + ' 在单元方案里要能装一个单元');
    }
    for (const level of ns.LEVELS) {
        const expected = Array.from(level.specials)
            .filter((id) => ns.starType(id).unit)
            .sort();
        assert.deepEqual(Array.from(ns.levelFor('hanzi', level.id).specials).sort(), expected,
            '汉字方案 Lv' + level.id + ' 的特殊星清单');
    }
    assert.deepEqual(Array.from(ns.levelFor('hanzi', 5).specials).sort(), ['gold', 'ice'],
        'Lv5 也只留金 / 冰：黑洞与双星都被滤掉');
    // 共享 LEVELS 仍含 void 与 double（门禁只在 levelFor 合成层）
    for (const id of [3, 4, 5]) {
        assert.ok(ns.levelById(id).specials.includes('void') && ns.levelById(id).specials.includes('double'));
    }
    // 单元方案里金 / 冰仍参与加权：候选少了，配额与加倍机制不变
    const composed = ns.levelFor('hanzi', 5);
    assert.equal(composed.specialBoost, 2, 'Lv5 特殊星加倍照旧');
    assert.notEqual(ns.pickStarType(composed, 0, 0.99), null);
});

// 9e 单元方案的挑选：只保留 pickLetter 四条规则里对单元仍有意义的两条（不连续重复同一个字、
// 同屏「下一个待敲键」≤ LETTER_MAX_SAME）。英文频率加权与 40% 异手交替**不套用**——
// 单元层平权，与数字 / 符号专练同一口径。无候选返回 null 由生成侧整拍跳过，不放宽硬约束
test('pickUnit：首键同屏上限与不连续重复是硬约束，平权分布，无候选返回 null', function () {
    // 好 hao / 马 ma / 米 mi / 人 ren / 天 tian —— 首键 h m m r t，'m' 撞一次便于验上限
    const list = ns.unitsFor('好马米人天');
    assert.equal(ns.pickUnit(list, { last: '好' }, 0).face, '马', '不连续重复同一个显示面');
    assert.equal(ns.pickUnit(list, { onScreen: ['m', 'm'] }, 0).face, '好',
        '首键 m 已经有两颗（马 / 米），第三颗必须换首键');
    assert.equal(ns.pickUnit(list, { exclude: ['h'] }, 0).face, '马',
        'exclude 挡的也是首键（9e 恒空，留给 9g 请回黑洞时用）');
    assert.equal(ns.pickUnit(list, { onScreen: ['h', 'h', 'm', 'm', 'r', 'r', 't', 't'] }, 0), null,
        '全部首键都满了就该返回 null，由生成侧整拍跳过而不是放宽约束');
    // 平权：roll 均分候选，五个字各被取到一次（若套了英文频率加权，m / r 会明显偏多）
    const seen = [];
    for (let i = 0; i < list.length; i++) {
        seen.push(ns.pickUnit(list, {}, (i + 0.5) / list.length).face);
    }
    assert.deepEqual(seen.sort(), Array.from(list, (unit) => unit.face).sort());
});

// 9g-1：多音字占它**每个**候选首键的同屏名额——任一读音都算对，所以只要有一个首键满了
// 就不能出；只查规范读音那条会让白圈在两个都接受该键的星之间撒谎
test('pickUnit：多音字的每个候选首键都算同屏名额，任一满了就挡它', function () {
    // 行 xing/hang（首键 x 与 h）、好 hao（h）、马 ma（m）
    const list = ns.unitsFor('行好马');
    assert.deepEqual(Array.from(list[0].readings[0]), ['x', 'i', 'n', 'g']);
    assert.deepEqual(Array.from(list[0].readings[1]), ['h', 'a', 'n', 'g']);
    // h 满了两颗 ⇒「行」不能出（尽管它的规范读音是 xing、x 一个名额都没占），只剩「马」
    assert.equal(ns.pickUnit(list, { onScreen: ['h', 'h', 'm'], last: '好' }, 0).face, '马',
        'h 满了就挡「行」：它的 hang 那条读音也吃 h 这个键');
    // 反过来 x 满了同样挡它——规则是"每个首键都没满"，不是"规范读音的首键没满"
    assert.equal(ns.pickUnit(list, { onScreen: ['x', 'x'] }, 0).face, '好',
        'x 满了也挡「行」：它占两个名额，不是一个');
    // 全部首键都满 ⇒ 无候选，返回 null 由生成侧整拍跳过，不放宽硬约束
    assert.equal(ns.pickUnit(list, { onScreen: ['x', 'x', 'h', 'h', 'm', 'm'] }, 0), null);
    // exclude（9g-5 请回黑洞时才非空）同样按每个候选首键判
    assert.equal(ns.pickUnit(list, { exclude: ['x'] }, 0).face, '好');
});

// 6b / 9e：类型表填的事件名必须在 CONFIG.AUDIO 里真有那一条——填错或漏填不会报错，只会静默不出声。
// 9e 之前普通 / 金色 / 冰晶的 armSound 是 null（那时只有双星会推进），单元方案里它们都是多键星，
// 推进那一下就成了哑的；这条钉住"能装单元的类型必须有推进音"
test('类型表的音效字段：sound 与 armSound 都指得向 AUDIO 里真实存在的事件', function () {
    for (const type of ns.STAR_TYPES) {
        assert.ok(ns.CONFIG.AUDIO[type.sound], type.id + ' 的 sound "' + type.sound + '" 在 AUDIO 表里没有');
        if (type.armSound === null) {
            assert.equal(type.id, 'void', '只有黑洞能不填推进音：它不能敲、永远不会推进');
        } else {
            assert.ok(ns.CONFIG.AUDIO[type.armSound], type.id + ' 的 armSound 在 AUDIO 表里没有');
        }
        if (type.unit) {
            assert.ok(type.armSound, type.id + ' 在单元方案里会推进，缺 armSound 推进就是静默的');
        }
    }
    // 事件名 9e 从 pair 改成 arm（9d 起字段就叫 armSound，双星与单元方案永不同屏所以共用一声）
    assert.ok(ns.CONFIG.AUDIO.arm && !ns.CONFIG.AUDIO.pair);
});

// 判定圈跟着星体同比长（harness/ui.md）：96 星体的尖离 36 的圈只剩 1.3px，白圈会贴在星尖上。
// 纹理烤到 128 / 圈半径 48 之后，常规星体从"放大 1.06"变成纯缩 0.75——只缩不放那条硬约束
test('判定圈：世界半径 = 星体尺寸的一半，常规星仍是 36 且从此只缩不放', function () {
    const worldRadius = (size) => size / (ns.CONFIG.RING_RADIUS * 2) * ns.CONFIG.RING_RADIUS;
    assert.equal(ns.CONFIG.RING_BAKE, 128);
    assert.equal(ns.CONFIG.RING_RADIUS, 48);
    assert.equal(worldRadius(ns.CONFIG.STAR_SIZE), ns.CONFIG.STAR_SIZE / 2, '常规星的圈半径 36 不能变');
    assert.equal(worldRadius(ns.CONFIG.UNIT_STAR_SIZE), ns.CONFIG.UNIT_STAR_SIZE / 2);
    assert.ok(ns.CONFIG.STAR_SIZE / (ns.CONFIG.RING_RADIUS * 2) < 1, '常规星必须是缩小显示，否则又是放大重采样');
    assert.ok(worldRadius(ns.CONFIG.STAR_SIZE) > ns.CONFIG.STAR_SIZE * 0.36,
        '圈要留在星尖之外（外尖半径 0.36 × 尺寸），贴着星尖的白圈读不出是描边');
});

// 菜单 / HUD / 暂停面板 / 结算页四处的模式名都从这张表取，名字改了四处一起变
test('MODES：闯关与无尽各一条且只有无尽爬升，modeById 回落默认模式', function () {
    assert.deepEqual(Array.from(ns.MODES, (mode) => mode.id), ['normal', 'endless']);
    assert.deepEqual(Array.from(ns.MODES, (mode) => mode.name), ['闯关', '无尽']);
    assert.deepEqual(Array.from(ns.MODES, (mode) => mode.climb), [false, true]);
    for (const mode of ns.MODES) {
        assert.ok(mode.desc.length > 0, mode.id + ' 缺说明文案');
        assert.equal(ns.modeById(mode.id), mode);
    }
    assert.equal(ns.modeById(undefined), ns.modeById(ns.DEFAULT_MODE));
    assert.equal(ns.modeById('nope'), ns.modeById(ns.DEFAULT_MODE));
    assert.equal(ns.modeById(ns.DEFAULT_MODE).climb, false);
});

// 光尾本身是渲染层（不测），但它读的这张表有三处跨表契约，写错了页面只会"看着没生效"
test('光尾表：harness/ui.md 参数、加亮门槛真在 COMBO_TIERS 里、60 节够五档基准峰值', function () {
    assert.equal(CONFIG.TRAIL_POOL_SIZE, 60);
    assert.equal(CONFIG.TRAIL_INTERVAL_MS, 40);
    assert.equal(CONFIG.TRAIL_FAST_INTERVAL_MS, 25);
    assert.equal(CONFIG.TRAIL_LIFE_MS, 300);
    assert.equal(CONFIG.TRAIL_ALPHA, 0.32);
    assert.equal(CONFIG.TRAIL_ALPHA_BOOST, 0.5);
    assert.equal(CONFIG.TRAIL_SCALE_FROM, 0.85);
    assert.equal(CONFIG.TRAIL_SCALE_TO, 0.5);

    // 门槛是倍率不是连击数：表里没有 3× 这一档的话，加亮永远不触发
    assert.ok(Array.from(CONFIG.COMBO_TIERS, (tier) => tier.multiplier).includes(CONFIG.TRAIL_BOOST_AT));
    assert.equal(CONFIG.TRAIL_BOOST_AT, 3);

    // "高速档"按实际速度判，所以 Lv1–3 走 40ms、Lv4/Lv5 走 25ms，爬升过线后自动切
    const travel = CONFIG.HORIZON_Y - CONFIG.SPAWN_Y;
    for (const level of ns.LEVELS) {
        const gap = level.speed >= CONFIG.TRAIL_FAST_SPEED ? CONFIG.TRAIL_FAST_INTERVAL_MS : CONFIG.TRAIL_INTERVAL_MS;
        assert.equal(gap, level.id >= 4 ? 25 : 40, 'Lv' + level.id + ' 的残影间隔');
        const onScreen = Math.ceil(travel / level.speed / (level.spawnInterval / 1000));
        const demand = onScreen * Math.ceil(CONFIG.TRAIL_LIFE_MS / gap);
        assert.ok(demand <= CONFIG.TRAIL_POOL_SIZE, 'Lv' + level.id + ' 基准峰值要 ' + demand + ' 节');
    }
});

// 五件套本身是渲染层（不测），但它读的这张表有三处写错了只会"看着没生效"的跨表契约
test('命中特效表：harness/ui.md 参数、金色门槛真在 COMBO_TIERS 里、四个池够爬升封顶后的连打', function () {
    assert.equal(CONFIG.FX_FLASH_MS, 80);
    assert.equal(CONFIG.FX_FLASH_SCALE, 1.35);
    assert.equal(CONFIG.FX_FLASH_ALPHA, 0.9);
    assert.equal(CONFIG.FX_RING_MS, 250);
    assert.equal(CONFIG.FX_RING_SCALE_FROM, 0.3);
    assert.equal(CONFIG.FX_RING_SCALE_TO, 2.4);
    assert.equal(CONFIG.FX_RING_ALPHA, 0.9);
    assert.equal(CONFIG.FX_LETTER_MS, 320);
    assert.equal(CONFIG.FX_LETTER_SCALE, 1.8);
    assert.equal(CONFIG.FX_LETTER_RISE, 40);
    assert.equal(CONFIG.FX_SCORE_RISE, 50);
    assert.equal(CONFIG.FX_SCORE_SIZE_MIN, 16);
    assert.equal(CONFIG.FX_SCORE_SIZE_MAX, 26);
    assert.equal(CONFIG.FX_SPARK_MIN, 14);
    assert.equal(CONFIG.FX_SPARK_MAX, 20);
    assert.equal(CONFIG.FX_SPARK_SPEED_MIN, 100);
    assert.equal(CONFIG.FX_SPARK_SPEED_MAX, 260);
    assert.equal(CONFIG.FX_SPARK_GRAVITY, 180);
    assert.equal(CONFIG.FX_SPARK_LIFE_MIN, 500);
    assert.equal(CONFIG.FX_SPARK_LIFE_MAX, 900);

    // 与光尾加亮同理：表里没有 3× 这一档的话，飘分永远不会变金
    assert.ok(Array.from(CONFIG.COMBO_TIERS, (tier) => tier.multiplier).includes(CONFIG.FX_SCORE_GOLD_AT));
    assert.equal(CONFIG.FX_SCORE_GOLD_AT, 3);
    // 字号按档位序号插值，只有一档的话整条映射退化成一个常数
    assert.ok(CONFIG.COMBO_TIERS.length > 1);
    assert.ok(CONFIG.FX_SCORE_SIZE_MIN < CONFIG.FX_SCORE_SIZE_MAX);

    // 环放大到 2.4× 后仍不超过源纹理，才是"只缩不放"（harness/architecture.md 的 DPR 硬约束）
    assert.ok(CONFIG.FX_RING_SIZE * CONFIG.FX_RING_SCALE_TO <= CONFIG.FX_SHOCK_SIZE);

    // 最快的连打节奏 = 爬升封顶后的生成间隔；四个池都得撑住这个速率下同时在场的件数
    const lives = [
        ['闪', CONFIG.FX_FLASH_MS, CONFIG.FX_FLASH_POOL_SIZE],
        ['环', CONFIG.FX_RING_MS, CONFIG.FX_RING_POOL_SIZE],
        ['字', CONFIG.FX_LETTER_MS, CONFIG.FX_LETTER_POOL_SIZE],
        ['分', CONFIG.FX_SCORE_MS, CONFIG.FX_SCORE_POOL_SIZE]
    ];
    for (const level of ns.LEVELS) {
        const fastest = level.spawnInterval * CONFIG.CLIMB.intervalFloor;
        for (const [name, life, size] of lives) {
            const demand = Math.ceil(life / fastest);
            assert.ok(demand <= size, 'Lv' + level.id + ' 的' + name + '峰值要 ' + demand + ' 个，池只有 ' + size);
        }
        // 粒子按"整屏一次清空"算：同屏上限 × 每簇上限
        assert.ok(level.maxOnScreen * CONFIG.FX_SPARK_MAX <= CONFIG.FX_SPARK_MAX_ALIVE,
            'Lv' + level.id + ' 整屏清空要 ' + level.maxOnScreen * CONFIG.FX_SPARK_MAX + ' 颗');
    }
});

// 背景六层是渲染层（不测），但它读的这张表有几处写错了只会"看着没生效"或"玩家去敲背景"
test('背景表：六层 depth（harness/ui.md）、装饰流星四条参数差异、树梢不越过光带', function () {
    assert.deepEqual(['sky', 'stars', 'decor', 'ridge', 'ground', 'horizon'].map((key) => ns.DEPTH[key]),
        [0, 0.5, 1, 2, 5, 8]);
    // 紫幕是六层之外多出来的一层，必须夹在天空与星点之间；真星与 HUD 始终压在全部背景之上
    assert.ok(ns.DEPTH.sky < ns.DEPTH.dusk && ns.DEPTH.dusk < ns.DEPTH.stars);
    assert.ok(ns.DEPTH.horizon < ns.DEPTH.trail);
    assert.ok(ns.DEPTH.trail < ns.DEPTH.star);
    assert.ok(ns.DEPTH.star < ns.DEPTH.particle && ns.DEPTH.particle < ns.DEPTH.hud);

    // 第五条差异"无字母"是结构（Backdrop 只放星体 + 尾迹），这里守另外四条
    assert.equal(CONFIG.DECOR_ALPHA, 0.22);
    assert.equal(CONFIG.DECOR_SCALE, 0.5);
    assert.equal(CONFIG.DECOR_ANGLE, 30);
    assert.equal(CONFIG.DECOR_SPEED_MUL, 2);
    assert.ok(CONFIG.DECOR_ALPHA < CONFIG.TRAIL_ALPHA, '背景流星比光尾还亮就会被当成真星');
    assert.ok(CONFIG.DECOR_SCALE < 1);
    assert.ok(CONFIG.DECOR_ANGLE > 0 && CONFIG.DECOR_ANGLE < 90, '斜向才与竖直下落的真星区分得开');
    assert.ok(CONFIG.DECOR_SPEED_MUL > 1);
    assert.ok(CONFIG.DECOR_GAP_MIN >= 3000 && CONFIG.DECOR_GAP_MAX <= 7000 && CONFIG.DECOR_GAP_MIN < CONFIG.DECOR_GAP_MAX);

    // 池要撑住最慢档（Lv1 × 2）走完整屏时的并发：斜向路程 ÷ 速度 ÷ 最短间隔
    const slowest = ns.LEVELS[0].speed * CONFIG.DECOR_SPEED_MUL;
    const travel = (CONFIG.HEIGHT + CONFIG.DECOR_MARGIN * 2) / Math.cos(CONFIG.DECOR_ANGLE * Math.PI / 180);
    const concurrent = Math.ceil(travel / slowest / (CONFIG.DECOR_GAP_MIN / 1000));
    assert.ok(concurrent <= CONFIG.DECOR_POOL_SIZE, '最慢档要 ' + concurrent + ' 颗同屏');

    assert.equal(CONFIG.SKY_STAR_COUNT, 84);
    assert.equal(CONFIG.SKY_DENSITY_MAX, 1.6);
    assert.ok(CONFIG.SKY_VEIL_ALPHA > 0 && CONFIG.SKY_VEIL_ALPHA < 1);
    // setCombo 拿最高档倍率当分母，只有 1× 的话整条映射除零
    assert.ok(CONFIG.COMBO_TIERS[CONFIG.COMBO_TIERS.length - 1].multiplier > 1);

    // 树线在 5 层、光带在 8 层：树梢越过地平线就会被一条亮线横穿
    assert.ok(CONFIG.TREELINE_MAX <= CONFIG.TREELINE_BASE, '树梢越过地平线了');
    assert.ok(CONFIG.TREELINE_MIN > 0 && CONFIG.TREELINE_MIN < CONFIG.TREELINE_MAX);
    assert.ok(CONFIG.TREELINE_BASE < CONFIG.HEIGHT - CONFIG.HORIZON_Y, '树线站脚掉出画布了');
    assert.ok(CONFIG.RIDGE_RISE > 0 && CONFIG.HORIZON_Y - CONFIG.RIDGE_RISE > CONFIG.HORIZON_WARN_Y,
        '远山爬进上方 2/3 的游戏区了');

    // 紧迫区就是下方 1/3，与 URGENCY 最高档共用 y=400 那条线
    assert.equal(CONFIG.HORIZON_WARN_Y, CONFIG.HEIGHT * 2 / 3);
    assert.equal(CONFIG.URGENCY_BONUS.length, 3);
    assert.ok(CONFIG.HORIZON_PULSE_FAST > CONFIG.HORIZON_PULSE_RATE);
    assert.ok(CONFIG.HORIZON_PULSE_ALPHA > 0 && CONFIG.HORIZON_PULSE_ALPHA <= 1);
});

// 震屏、定格、星屑雨、压暗层全是渲染层（不测），但这张表有几处写错了只会"看着没生效"
test('全局反馈表：harness/ui.md 参数、定格门槛真在 COMBO_TIERS 里、星屑雨落进画面又不砸到地平线', function () {
    assert.equal(CONFIG.CRASH_SHAKE_MS, 120);
    assert.equal(CONFIG.CRASH_SHAKE, 0.006);
    assert.equal(CONFIG.HORIZON_FLASH_MS, 200);
    // 闪光要比批量 timer 的间隔长，否则每帧重算那套逻辑白写（80ms 采三下就是三级跳）
    assert.ok(CONFIG.HORIZON_FLASH_MS > 80);

    // 与 TRAIL_BOOST_AT / FX_SCORE_GOLD_AT 同理：门槛必须是表里真有的连击档，写 45 就永不触发
    assert.equal(CONFIG.HIT_STOP_COMBO, CONFIG.COMBO_TIERS[CONFIG.COMBO_TIERS.length - 1].at);
    assert.ok(CONFIG.HIT_STOP_SCALE > 0 && CONFIG.HIT_STOP_SCALE < 1, '倍率不小于 1 就不叫定格');
    assert.ok(CONFIG.HIT_STOP_MS > 0 && CONFIG.HIT_STOP_MS <= CONFIG.CRASH_SHAKE_MS, '长过震屏就像卡帧');

    assert.equal(CONFIG.SCORE_MILESTONE, 500);
    assert.equal(CONFIG.FX_RAIN_COUNT, 30);
    assert.ok(CONFIG.FX_RAIN_ALPHA < 1 && CONFIG.FX_RAIN_ALPHA > 0);
    const fastest = CONFIG.FX_RAIN_SPEED_MAX * CONFIG.FX_RAIN_MS / 1000;
    const slowest = CONFIG.FX_RAIN_SPEED_MIN * CONFIG.FX_RAIN_MS / 1000;
    // 撒在高处的那些也得落进画面，否则一场雨里大半根本看不见
    assert.ok(slowest > CONFIG.FX_RAIN_SPREAD, '最慢的一条整场都在画布外');
    // 但从画布顶出发的那条不能砸到地平线：星屑雨是庆祝，不该盖住坠毁那条最重要的线
    assert.ok(fastest <= CONFIG.HORIZON_Y, '最快的一条落到 y=' + fastest);

    // 压暗层要同时满足"天空变暗"与"地平线辉光常亮"，只能夹在地面与光带之间
    assert.ok(ns.DEPTH.ground < ns.DEPTH.dim && ns.DEPTH.dim < ns.DEPTH.horizon);
    // 设计的 brightness(0.75) 换算成 scrim 叠加：α 与剩下的亮度必须互补
    assert.equal(CONFIG.DANGER_DIM, 0.25);
    assert.ok(CONFIG.DANGER_GLOW > 0 && CONFIG.DANGER_GLOW <= 1);
});

// 6c 严格模式罚分：设计契约是"按错扣一次基础分"（harness/gameplay.md），
// 设置面板标签上的 −N 也读它——两个值漂移的话，写的和扣的就对不上了
test('严格模式罚分等于一次基础分，且是正整数', function () {
    assert.equal(CONFIG.STRICT_MISS_PENALTY, CONFIG.SCORE_BASE);
    assert.ok(Number.isInteger(CONFIG.STRICT_MISS_PENALTY) && CONFIG.STRICT_MISS_PENALTY > 0);
});

// 6e 触屏热区：半径至少盖住星体本身，否则点在星上反而判不中；
// 上限不封死（指腹热区刻意比星体大一圈），但必须是个有限正数，tapMatch 拿它算距离平方
test('触屏热区半径盖得住星体，且是有限正数', function () {
    assert.ok(Number.isFinite(CONFIG.TAP_RADIUS) && CONFIG.TAP_RADIUS > 0);
    assert.ok(CONFIG.TAP_RADIUS > CONFIG.STAR_SIZE / 2, '热区比星体还小，点在星上判不中');
    // 9e 起星体有两档（常规 72 / 单元方案 96）：要盖得住**大的那档**，
    // 否则点在单元星的星尖上反而判不中
    assert.ok(CONFIG.TAP_RADIUS > CONFIG.UNIT_STAR_SIZE / 2, '热区盖不住单元方案的 96 星体');
});

// 3f 把层序梳成一张全命名的表：调用点不再写 DEPTH.hud - 1，插一层只用挑空位。
// 层序本身是渲染结果（不测），但"谁压谁"是这张表说了算，写反了页面上只会看着不对
test('层序表：3f 十四层严格递增，闪白夹在真星与粒子之间，覆盖层压住 HUD', function () {
    const ladder = ['sky', 'dusk', 'stars', 'decor', 'ridge', 'ground', 'dim', 'horizon',
        'trail', 'star', 'flash', 'particle', 'guide', 'hud', 'overlay', 'panel'];
    assert.deepEqual(Object.keys(ns.DEPTH).sort(), Array.from(ladder).sort());

    const depths = ladder.map((key) => ns.DEPTH[key]);
    for (let i = 1; i < depths.length; i++) {
        assert.ok(depths[i] > depths[i - 1], ladder[i] + ' 没压在 ' + ladder[i - 1] + ' 之上');
    }
    // 层序设计里那十层的值一个没动
    assert.deepEqual(['sky', 'stars', 'decor', 'ridge', 'ground', 'horizon', 'trail', 'star', 'particle', 'hud', 'overlay']
        .map((key) => ns.DEPTH[key]), [0, 0.5, 1, 2, 5, 8, 10, 11, 20, 30, 40]);
});

// 分数滚动、combo 弹跳、减速补偿都是渲染层（不测），但这张表有几处写错了只会"看着没生效"
test('HUD 与可读性表：harness/ui.md 动效参数、减速区在紧迫段内、两种脉冲三样都分得开', function () {
    assert.equal(CONFIG.HUD_SCORE_ROLL_MS, 200);
    assert.equal(CONFIG.HUD_COMBO_POP_MS, 120);
    assert.equal(CONFIG.HUD_COMBO_POP_SCALE, 1.35);
    assert.ok(CONFIG.HUD_COMBO_BREAK_MS > 0 && CONFIG.HUD_CLIMB_MS > 0);
    // 裙边只是渐隐段，顶条本体仍要盖住两行文字
    assert.ok(CONFIG.HUD_BAR_SKIRT > 0 && CONFIG.HUD_BAR_HEIGHT >= 48);

    // 减速线就是下方 1/5 的上沿，且整段落在紧迫奖励区里——设计说减速是为了强化"紧迫奖励"的价值（harness/gameplay.md）
    assert.equal(CONFIG.NEAR_ZONE, 0.2);
    assert.equal(CONFIG.NEAR_Y, CONFIG.HEIGHT * (1 - CONFIG.NEAR_ZONE));
    assert.ok(CONFIG.NEAR_Y >= CONFIG.HORIZON_WARN_Y && CONFIG.NEAR_Y < CONFIG.HORIZON_Y);
    assert.equal(CONFIG.NEAR_SPEED_MUL, 0.92);
    assert.ok(CONFIG.NEAR_SPEED_MUL > 0 && CONFIG.NEAR_SPEED_MUL < 1, '倍率不小于 1 就不叫减速');
    // 减速换来的读取窗口：Lv5 爬升封顶后仍有 0.19s，比不减速多出约 9%
    const fastest = ns.LEVELS[4].speed * CONFIG.CLIMB.speedCap;
    const span = CONFIG.HORIZON_Y - CONFIG.NEAR_Y;
    assert.ok(span / (fastest * CONFIG.NEAR_SPEED_MUL) > span / fastest);
    assert.ok(CONFIG.NEAR_HALO_ALPHA > CONFIG.STAR_HALO_ALPHA, '进了减速区光晕反而更暗就白做了');

    // 白脉冲 = 敲这个字母会掉的那颗，暖橘脉冲 = 快坠毁了。Canvas 渲染器忽略 tint，
    // 所以大小与频率也必须不同，否则 fallback 下两种含义读不出区别
    assert.notEqual(CONFIG.NEAR_PULSE_RATE, CONFIG.PULSE_RATE);
    assert.notEqual(CONFIG.NEAR_PULSE_SCALE, 1);
    assert.ok(CONFIG.NEAR_PULSE_ALPHA_MIN > 0 && CONFIG.NEAR_PULSE_ALPHA_MAX <= 1);
    assert.ok(CONFIG.NEAR_PULSE_ALPHA_MIN < CONFIG.NEAR_PULSE_ALPHA_MAX);

    // 档位强调色收进 LEVELS 后菜单与 HUD 读同一份：五档各不相同才是一条难度梯度
    const accents = Array.from(ns.LEVELS, (level) => level.accent);
    assert.equal(new Set(accents).size, accents.length);
    for (const accent of accents) { assert.ok(PALETTE.starColors.includes(accent), accent); }
});

// meteorIn 本身是渲染层（不测），但它读的时序表（harness/ui.md）有几处写错了只会"看着没生效"或光尾断节
test('流星表：harness/ui.md 时序、光尾池撑住并发峰值、闪白短于压扁、起点在画布外', function () {
    assert.equal(CONFIG.METEOR_FROM_X, 120);
    assert.equal(CONFIG.METEOR_FROM_Y, -60);
    assert.equal(CONFIG.METEOR_FALL_MS, 420);
    assert.equal(CONFIG.METEOR_STAGGER_MS, 90);
    assert.equal(CONFIG.METEOR_FLASH_MS, 80);
    assert.equal(CONFIG.METEOR_SQUASH_MS, 180);
    assert.equal(CONFIG.METEOR_SQUASH_DOWN, 0.72);
    assert.equal(CONFIG.METEOR_SQUASH_UP, 1.08);
    assert.equal(CONFIG.METEOR_SPARKS, 8);

    // 并发数由"划落时长 ÷ 间隔"决定，与字符数无关：GAME OVER 九字符与标题四字峰值相同
    const concurrent = Math.ceil(CONFIG.METEOR_FALL_MS / CONFIG.METEOR_STAGGER_MS);
    const demand = concurrent * Math.ceil(CONFIG.TRAIL_LIFE_MS / CONFIG.METEOR_TRAIL_GAP_MS);
    assert.ok(demand <= CONFIG.METEOR_TRAIL_SIZE, '光尾峰值要 ' + demand + ' 节，池只有 ' + CONFIG.METEOR_TRAIL_SIZE);

    // 闪白是落地第一瞬，压扁是整个落地过程；闪白长过压扁就会拖进回弹段
    assert.ok(CONFIG.METEOR_FLASH_MS < CONFIG.METEOR_SQUASH_MS);
    assert.ok(CONFIG.METEOR_SQUASH_DOWN < 1 && CONFIG.METEOR_SQUASH_UP > 1);
    // 起点必须在画布顶外，否则字符在画面内凭空出现而不是划进来
    assert.ok(CONFIG.METEOR_FROM_Y < 0);
});

// 菜单入场是渲染层（不测），但时序数字（harness/ui.md）写错了只会"看着没生效"：
// 副标题要在标题全部落定之后才浮起，滑入间隔要短于划落间隔才接得上节奏
test('菜单入场表：300ms / 8px / 60ms（harness/ui.md），留白短于一次划落', function () {
    assert.equal(CONFIG.MENU_REVEAL_DELAY_MS, 300);
    assert.equal(CONFIG.MENU_SUBTITLE_RISE, 8);
    assert.equal(CONFIG.MENU_SLIDE_STAGGER_MS, 60);

    // 落定后的留白长过一次划落，画面就像卡住了；滑入比划落还慢同样拖沓
    assert.ok(CONFIG.MENU_REVEAL_DELAY_MS > 0 && CONFIG.MENU_REVEAL_DELAY_MS < CONFIG.METEOR_FALL_MS);
    assert.ok(CONFIG.MENU_SLIDE_STAGGER_MS < CONFIG.METEOR_STAGGER_MS);
    assert.ok(CONFIG.MENU_SUBTITLE_RISE > 0 && CONFIG.MENU_SUBTITLE_RISE <= 16);
});

// 倒计时本身是渲染层（不测），但时序与两条跨表契约（harness/ui.md）写错了只会"看着没生效"：
// 缓冲不够 3 秒就失去"把手放回键盘"的作用，遮罩淡得比白环慢则那圈冲击波全程被压暗
test('倒计时表：3-2-1-GO 时序（harness/ui.md）、遮罩淡出短于白环寿命、数字只缩不放', function () {
    assert.equal(CONFIG.COUNTDOWN_STEPS, 3);
    assert.equal(CONFIG.COUNTDOWN_STEP_MS, 1000);
    assert.equal(CONFIG.COUNTDOWN_SCRIM, 0.35);
    assert.equal(CONFIG.COUNTDOWN_SCALE_FROM, 2.2);
    assert.equal(CONFIG.COUNTDOWN_SCALE_TO, 1);
    assert.equal(CONFIG.COUNTDOWN_GO_SCALE_FROM, 0.6);
    assert.equal(CONFIG.COUNTDOWN_GO_SCALE_TO, 1.6);

    // "3 秒缓冲才出现第一颗星"：缓冲就是三个数字各一秒，GO! 的停留不算在内
    assert.equal(CONFIG.COUNTDOWN_STEPS * CONFIG.COUNTDOWN_STEP_MS, 3000);
    // 数字从大缩到精确的 1，GO! 从小于 1 弹到大于 1；两者的 resolution 都按各自最大倍数烤
    assert.ok(CONFIG.COUNTDOWN_SCALE_FROM > CONFIG.COUNTDOWN_SCALE_TO);
    assert.ok(CONFIG.COUNTDOWN_GO_SCALE_FROM < 1 && CONFIG.COUNTDOWN_GO_SCALE_TO > 1);
    // 弹出段要在 GO! 淡完之前结束，否则字还在扩就已经透明了
    assert.ok(CONFIG.COUNTDOWN_GO_POP_MS < CONFIG.COUNTDOWN_GO_MS);
    // 白环复用 3c 的冲击波：遮罩必须先淡完，环才不被压暗；GO! 自己要比遮罩多留一会儿
    assert.ok(CONFIG.COUNTDOWN_FADE_MS <= CONFIG.FX_RING_MS);
    assert.ok(CONFIG.COUNTDOWN_GO_MS > CONFIG.COUNTDOWN_FADE_MS);
    // 信息条在顶条裙边之下、中央数字之上，淡入短于一个数字的寿命才算"快速闪过"
    assert.ok(CONFIG.COUNTDOWN_INFO_Y > CONFIG.HUD_BAR_HEIGHT + CONFIG.HUD_BAR_SKIRT);
    assert.ok(CONFIG.COUNTDOWN_INFO_Y < CONFIG.HEIGHT / 2);
    assert.ok(CONFIG.COUNTDOWN_INFO_IN_MS < CONFIG.COUNTDOWN_STEP_MS);
});

// 结算揭示是渲染层（不测），但时序数字（harness/ui.md）写错了只会"看着没生效"：
// 分数滚完恰好接统计、末行统计落定恰好接破纪录行、按钮淡完不超验收的 3.5s
test('结算表：逐条揭示时序（harness/ui.md）、两段首尾相接、按钮 3.5s 内可交互', function () {
    assert.equal(CONFIG.OVER_SCORE_DELAY_MS, 400);
    assert.equal(CONFIG.OVER_SCORE_ROLL_MS, 1000);
    assert.equal(CONFIG.OVER_STATS_DELAY_MS, 1400);
    assert.equal(CONFIG.OVER_STATS_STAGGER_MS, 180);
    assert.equal(CONFIG.OVER_STATS_SLIDE_MS, 320);
    assert.equal(CONFIG.OVER_RECORD_DELAY_MS, 2800);
    assert.equal(CONFIG.OVER_BUTTONS_DELAY_MS, 3200);

    // 五个揭示节点严格递增，标题划落（0ms）在最前
    const steps = [0, CONFIG.OVER_SCORE_DELAY_MS, CONFIG.OVER_STATS_DELAY_MS,
        CONFIG.OVER_RECORD_DELAY_MS, CONFIG.OVER_BUTTONS_DELAY_MS];
    for (let i = 1; i < steps.length; i++) { assert.ok(steps[i] > steps[i - 1]); }

    // 分数滚完的那一刻统计开始滑入；七行统计的末行落定恰好接破纪录行（6 个间隔 + 一段滑入）
    assert.equal(CONFIG.OVER_SCORE_DELAY_MS + CONFIG.OVER_SCORE_ROLL_MS, CONFIG.OVER_STATS_DELAY_MS);
    assert.equal(CONFIG.OVER_STATS_DELAY_MS + 6 * CONFIG.OVER_STATS_STAGGER_MS + CONFIG.OVER_STATS_SLIDE_MS,
        CONFIG.OVER_RECORD_DELAY_MS);
    // 按钮淡完不超过 3.5s，淡入本身得是一段可见的过程
    assert.ok(CONFIG.OVER_BUTTONS_DELAY_MS + CONFIG.OVER_FADE_MS <= 3500);
    assert.ok(CONFIG.OVER_FADE_MS > 0 && CONFIG.OVER_FADE_MS < CONFIG.OVER_SCORE_ROLL_MS);
});

// 特殊星的造型与光柱是渲染层（不测），但这张类型表是 5b–5d「只填表不改流程」的地基，
// harness/gameplay.md 特殊星表的四个数字是设计契约，写错了页面上只会"看着没生效"
test('特殊星类型表：金色星逐格（harness/gameplay.md）、普通星不再随机到金色、四芒与光柱都只缩不放', function () {
    assert.deepEqual(Array.from(ns.STAR_TYPES, (type) => type.id), ['normal', 'gold', 'ice', 'void', 'double']);

    const gold = ns.starType('gold');
    assert.equal(gold.name, '金色星');
    assert.equal(gold.weight, 6);
    assert.equal(gold.speedMul, 1.3);
    assert.equal(gold.bonus, 50);
    assert.deepEqual(Array.from(gold.colors), [PALETTE.gold]);
    assert.ok(gold.glint, '没有四芒的话金色星与普通星只差一个颜色');
    assert.ok(gold.pillar, '设计给的命中特效是金色星屑 + 光柱');

    const normal = ns.starType('normal');
    assert.equal(normal.weight, 82);
    assert.equal(normal.speedMul, 1);
    assert.equal(normal.bonus, 0);
    assert.ok(!normal.glint && !normal.pillar && !normal.chill && !normal.pair);
    // 金色是金色星的身份色：普通星也能随机到金，"一眼能分"就只剩四芒一条腿
    assert.ok(normal.colors.length > 0);
    assert.ok(!normal.colors.includes(PALETTE.gold));
    for (const color of normal.colors) { assert.ok(PALETTE.starColors.includes(color), color); }
    // 加权表凑满 100（pickStarType 按它归一）：五行权重就是 harness/gameplay.md 的 82 / 6 / 5 / 5 / 2
    assert.equal(Array.from(ns.STAR_TYPES, (type) => type.weight).reduce((sum, weight) => sum + weight, 0), 100);
    // 同屏特殊星上限（harness/gameplay.md）：双星算一个，配额满回落普通星
    assert.equal(CONFIG.SPECIAL_MAX_ON_SCREEN, 2);

    // 与 levelById 同一套路：缺参与未知 id 回落普通星，不会静默变成金色星
    assert.equal(ns.starType(undefined), normal);
    assert.equal(ns.starType(null), normal);
    assert.equal(ns.starType('nope'), normal);
    assert.equal(ns.starType(ns.DEFAULT_STAR_TYPE).id, 'normal');

    // 四芒必须伸出白芯之外才看得见（starCore 是 32px 纹理 ⇒ 半径 16），且整条落在 72 的星框里
    assert.equal(CONFIG.STAR_GLINT_ARM, 34);
    assert.equal(CONFIG.STAR_GLINT_WIDTH, 2);
    assert.equal(CONFIG.STAR_GLINT_ALPHA, 0.5);
    assert.ok(CONFIG.STAR_GLINT_ARM > 16, '芒整段埋在白芯底下');
    assert.ok(CONFIG.STAR_GLINT_ARM <= CONFIG.STAR_SIZE / 2, '芒伸出星框被裁掉了');

    // 光柱与冲击波同一条硬约束：显示尺寸 × 最大 scale 不超过源纹理（harness/architecture.md 的"只缩不放"）
    assert.ok(CONFIG.FX_PILLAR_HEIGHT * CONFIG.FX_PILLAR_SCALE_TO <= CONFIG.FX_PILLAR_SOURCE_H);
    assert.ok(CONFIG.FX_PILLAR_WIDTH <= CONFIG.FX_PILLAR_SOURCE_W);
    assert.ok(CONFIG.FX_PILLAR_SCALE_FROM < CONFIG.FX_PILLAR_SCALE_TO);
    assert.ok(CONFIG.FX_PILLAR_SCALE_TO <= 1, '长过源纹理就是放大重采样，软渐变照样发虚');
    assert.ok(CONFIG.FX_PILLAR_SQUEEZE > 0 && CONFIG.FX_PILLAR_SQUEEZE < 1, '不收窄就是一块慢慢消失的矩形');
    assert.ok(CONFIG.FX_PILLAR_ALPHA > 0 && CONFIG.FX_PILLAR_ALPHA <= 1);
    // 比白环活得久才像"一道光留在场上"，但短过飘分，不然连打时满屏都是柱子
    assert.ok(CONFIG.FX_PILLAR_MS > CONFIG.FX_RING_MS && CONFIG.FX_PILLAR_MS < CONFIG.FX_SCORE_MS);

    // 池按"全金连打"的保守上界算：5e 后同屏特殊星 ≤2，这个上界只会更宽裕
    for (const level of ns.LEVELS) {
        const fastest = level.spawnInterval * CONFIG.CLIMB.intervalFloor;
        const demand = Math.ceil(CONFIG.FX_PILLAR_MS / fastest);
        assert.ok(demand <= CONFIG.FX_PILLAR_POOL_SIZE, 'Lv' + level.id + ' 全金要 ' + demand + ' 道光柱');
    }

    // 3b 的光尾间隔按"实际速度"判档而不是按档位 id：Lv3 的金色星（135 × 1.3 = 175.5）恰好跨过
    // TRAIL_FAST_SPEED，于是同屏里金色星拖 25ms 的密尾、普通星拖 40ms 的疏尾，一行代码都不用改。
    // 代价是残影需求上升，所以顺手确认"全金 + 爬升封顶"这个极端仍不超过 60 节的池
    assert.ok(ns.levelById(3).speed * gold.speedMul >= CONFIG.TRAIL_FAST_SPEED, 'Lv3 的金色星没跨过短间隔门槛');
    assert.ok(ns.levelById(2).speed * gold.speedMul < CONFIG.TRAIL_FAST_SPEED, 'Lv2 的金色星在基准速度下就切了档');
    for (const level of ns.LEVELS) {
        const speed = level.speed * CONFIG.CLIMB.speedCap * gold.speedMul;
        const gap = speed >= CONFIG.TRAIL_FAST_SPEED ? CONFIG.TRAIL_FAST_INTERVAL_MS : CONFIG.TRAIL_INTERVAL_MS;
        const travel = CONFIG.HORIZON_Y - CONFIG.SPAWN_Y;
        const onScreen = Math.min(level.maxOnScreen,
            Math.ceil(travel / speed / (level.spawnInterval * CONFIG.CLIMB.intervalFloor / 1000)));
        const demand = onScreen * Math.ceil(CONFIG.TRAIL_LIFE_MS / gap);
        assert.ok(demand <= CONFIG.TRAIL_POOL_SIZE, 'Lv' + level.id + ' 全金 + 爬升封顶要 ' + demand + ' 节残影');
    }
});

// 黑洞的造型与吸入特效是渲染层（不测），但行为契约（harness/gameplay.md）与误敲反馈的参数写错了
// 只会"看着没生效"或惩罚轻重颠倒：误敲必须是全局最重的反馈，落地必须零惩罚
test('黑洞表：逐格对齐 harness/gameplay.md、误敲反馈比坠毁重一档、吸入池撑住三场并发、提示只一次', function () {
    const voidType = ns.starType('void');
    assert.equal(voidType.name, '黑洞');
    assert.equal(voidType.weight, 5);
    assert.equal(voidType.speedMul, 1, '黑洞是标准下落，不快也不慢');
    assert.equal(voidType.bonus, 0);
    assert.deepEqual(Array.from(voidType.colors), [PALETTE.voidCore]);
    assert.ok(voidType.hazard, '没有 hazard 标志判定就不会分流，敲它变成普通命中');
    assert.ok(voidType.disk, '没有 disk 标志就还是五角星造型，"靠形状辨识"不成立');
    assert.ok(!voidType.glint && !voidType.pillar && !voidType.pair);
    assert.ok(!ns.starType('normal').hazard && !ns.starType('gold').hazard && !ns.starType('double').hazard);

    // 误敲四件反馈的参数：震屏比坠毁（120ms / 0.006）更长更强，zoom 向中心缩再回弹，
    // 黑闪有峰值且不超过 1。zoom 基准在 GameScene 里乘 RENDER_SCALE，表里只存相对倍率
    assert.equal(CONFIG.VOID_SHAKE_MS, 250);
    assert.equal(CONFIG.VOID_SHAKE, 0.012);
    assert.ok(CONFIG.VOID_SHAKE_MS > CONFIG.CRASH_SHAKE_MS);
    assert.ok(CONFIG.VOID_SHAKE > CONFIG.CRASH_SHAKE);
    assert.equal(CONFIG.VOID_ZOOM, 1.06);
    assert.ok(CONFIG.VOID_ZOOM > 1);
    assert.equal(CONFIG.VOID_ZOOM_MS, 180);
    assert.equal(CONFIG.VOID_FLASH_MS, 120);
    assert.ok(CONFIG.VOID_FLASH_ALPHA > 0 && CONFIG.VOID_FLASH_ALPHA <= 1);

    // 吸入粒子：寿命夹在白环与飘分之间（同光柱的纪律），起始半径在星框之外才像"从四周收拢"，
    // 显示尺寸不超过 dot 源纹理 16px（只缩不放）；旋入是螺线不是直线，spin 必须为正
    assert.equal(CONFIG.FX_VOID_COUNT, 16);
    assert.equal(CONFIG.FX_VOID_MS, 500);
    assert.ok(CONFIG.FX_VOID_MS > CONFIG.FX_RING_MS && CONFIG.FX_VOID_MS < CONFIG.FX_SCORE_MS);
    assert.ok(CONFIG.FX_VOID_RADIUS > CONFIG.STAR_SIZE / 2);
    assert.ok(CONFIG.FX_VOID_SIZE <= 16);
    assert.ok(CONFIG.FX_VOID_SPIN > 0);
    // 按爬升封顶的生成间隔连敲算，500ms 寿命里最多叠三场，池要撑住这个保守上界
    // 不抢正在收拢的粒子（5e 后同屏特殊星 ≤2，实际只会更宽裕；同光柱的池账目判据）
    for (const level of ns.LEVELS) {
        const fastest = level.spawnInterval * CONFIG.CLIMB.intervalFloor;
        const demand = Math.ceil(CONFIG.FX_VOID_MS / fastest) * CONFIG.FX_VOID_COUNT;
        assert.ok(demand <= CONFIG.FX_VOID_POOL_SIZE, 'Lv' + level.id + ' 全黑洞连敲要 ' + demand + ' 颗粒子');
    }

    // 连续自转要"缓慢"：一整圈不短于 4s，与五角星的 ±5° 摆动（周期约 4.7s）是两种运动
    assert.ok(CONFIG.VOID_SPIN_RATE > 0);
    assert.ok(2 * Math.PI / CONFIG.VOID_SPIN_RATE >= 4);

    // 一次性提示：淡入淡出短于停留，位置在顶条裙边之下、地平线之上
    assert.ok(CONFIG.VOID_HINT_FADE_MS > 0 && CONFIG.VOID_HINT_FADE_MS < CONFIG.VOID_HINT_MS);
    assert.ok(CONFIG.VOID_HINT_Y > CONFIG.HUD_BAR_HEIGHT + CONFIG.HUD_BAR_SKIRT);
    assert.ok(CONFIG.VOID_HINT_Y < CONFIG.HORIZON_Y);
});

// 冰晶的造型与全屏冷蓝是渲染层（不测），但行为契约（harness/gameplay.md）与减速参数写错了只会"看着没生效"
// 或攒成永久减速：×0.5 必须是每帧现读的全局倍率而不是它自己的 speedMul，计时器必须重置不叠加
test('冰晶表：逐格对齐 harness/gameplay.md、减速是全局倍率不是自己的 speedMul、4 秒到点三项都落尽', function () {
    const ice = ns.starType('ice');
    assert.equal(ice.name, '冰晶星');
    assert.equal(ice.weight, 5);
    assert.equal(ice.bonus, 20);
    // 设计（harness/gameplay.md）：冰晶星自己是标准下落。×0.5 是它命中之后给**全场**的，写进 speedMul 就成了
    // "这颗星自己慢"，验收第一条（含减速开始后新生成的星都变慢）直接不成立
    assert.equal(ice.speedMul, 1);
    assert.deepEqual(Array.from(ice.colors), [PALETTE.ice]);
    assert.ok(ice.chill, '没有 chill 标志，命中就不会触发全局减速');
    assert.ok(!ice.hazard, '冰晶星是能敲的，带上 hazard 就成了第二个黑洞');
    assert.ok(!ice.glint && !ice.pillar && !ice.disk && !ice.pair);
    assert.ok(!ns.starType('normal').chill && !ns.starType('gold').chill &&
        !ns.starType('void').chill && !ns.starType('double').chill);

    // 造型走类型表的纹理键，不再按标志分派：六角冰晶与吸积盘都不是五角星换个 tint 能表达的。
    // 普通星与金色星共用五角星（金色靠四芒 + 恒金区分），另两张各自独占
    assert.equal(ns.starType('normal').texture, 'starHi');
    assert.equal(ns.starType('gold').texture, 'starHi');
    assert.equal(ice.texture, 'iceStar');
    assert.equal(ns.starType('void').texture, 'voidStar');
    assert.equal(new Set(Array.from(ns.STAR_TYPES, (type) => type.texture)).size, 3);

    // 全屏 4 秒 + ×0.5 + 冷蓝 α0.15（harness/gameplay.md 与 ui.md 的三个数字）
    assert.equal(CONFIG.ICE_MS, 4000);
    assert.equal(CONFIG.ICE_SLOW, 0.5);
    assert.equal(CONFIG.ICE_ALPHA, 0.15);
    assert.ok(CONFIG.ICE_SLOW > 0 && CONFIG.ICE_SLOW < 1, '倍率不小于 1 就不叫减速');
    // 淡入淡出各占一段，合起来必须短于总时长的一半，否则 4 秒里大半在渐变、没有稳定的减速窗口
    assert.ok(CONFIG.ICE_FADE_MS > 0 && CONFIG.ICE_FADE_MS * 2 < CONFIG.ICE_MS);

    // "全屏"包括顶条：冷蓝层压在 HUD 之上（同 5b 的黑闪）；飘落的冰晶是氛围，
    // 压在真星之上、HUD 之下，不能挡住分数与生命
    assert.ok(ns.DEPTH.overlay > ns.DEPTH.hud);
    assert.ok(ns.DEPTH.star < ns.DEPTH.particle && ns.DEPTH.particle < ns.DEPTH.hud);

    // 池 = 并发峰值（寿命 ÷ 间隔），满了抢最旧，"建 N"才恒定（同光柱 / 吸入的池账目判据）
    assert.equal(CONFIG.FX_ICE_COUNT, Math.ceil(CONFIG.FX_ICE_MS / CONFIG.FX_ICE_INTERVAL_MS));
    assert.ok(CONFIG.FX_ICE_INTERVAL_MS > 0 && CONFIG.FX_ICE_COUNT > 1);
    // 一片的寿命短于全屏时长：一场里它就落到稳态而不是攒到下一场，到点溶尽也不留尾巴
    assert.ok(CONFIG.FX_ICE_MS < CONFIG.ICE_MS);
    // 显示尺寸不超过源纹理（harness/architecture.md 的"只缩不放"），且必须明显小于星体——
    // 一样大的话飘落的冰晶就成了"另一批可以敲的星"
    assert.ok(CONFIG.FX_ICE_SIZE <= CONFIG.STAR_SIZE * CONFIG.STAR_SUPERSAMPLE);
    assert.ok(CONFIG.FX_ICE_SIZE < CONFIG.STAR_SIZE / 2);
    assert.ok(CONFIG.FX_ICE_SPEED_MIN > 0 && CONFIG.FX_ICE_SPEED_MIN < CONFIG.FX_ICE_SPEED_MAX);
    // "缓慢飘落"：一片整场走的距离比星屑雨最慢那条还短得多
    assert.ok(CONFIG.FX_ICE_SPEED_MAX * CONFIG.FX_ICE_MS / 1000 <
        CONFIG.FX_RAIN_SPEED_MIN * CONFIG.FX_RAIN_MS / 1000, '比星屑雨还快就不叫飘落');
    assert.ok(CONFIG.FX_ICE_ALPHA > 0 && CONFIG.FX_ICE_ALPHA < 1);
});

// 双星的造型、连线与那段过渡都是渲染层（不测），但行为契约（harness/gameplay.md）与几何表写错了
// 只会"看着没生效"或读不出顺序：两颗必须一大一小、连线缩短后仍要露得出来、生成边距必须容得下整对
test('双星表：逐格对齐 harness/gameplay.md、顺序靠大小读、连线缩短后仍露出来、生成边距容得下整对', function () {
    const pair = ns.starType('double');
    assert.equal(pair.name, '双星');
    assert.equal(pair.weight, 2);
    assert.equal(pair.speedMul, 1, '双星是标准下落，不快也不慢');
    assert.equal(pair.bonus, 30);
    assert.ok(pair.pair, '没有 pair 标志生成侧只给一个字母、判定也不会分流');
    assert.ok(!pair.hazard && !pair.disk && !pair.chill && !pair.glint && !pair.pillar);
    // 颜色沿用普通星那五色：身份靠形状不靠颜色，金色留给金色星；一对两颗同色才读成一个整体
    assert.deepEqual(Array.from(pair.colors), Array.from(ns.starType('normal').colors));
    assert.ok(!pair.colors.includes(PALETTE.gold));
    // 造型仍是五角星（两颗小的 + 连线 + 箭头就是它的形状通道），不需要第四张纹理
    assert.equal(pair.texture, 'starHi');

    // 仅 Lv3+（harness/gameplay.md 难度表）
    assert.ok(!ns.levelById(1).specials.includes('double'));
    assert.ok(!ns.levelById(2).specials.includes('double'));
    for (const id of [3, 4, 5]) { assert.ok(ns.levelById(id).specials.includes('double'), 'Lv' + id); }

    // 顺序只靠大小区分（色觉友好）：待敲那颗大、还没轮到那颗小，两颗都比常规星小（"两颗小星"）
    assert.ok(CONFIG.PAIR_TAIL_SCALE < CONFIG.PAIR_LEAD_SCALE, '两颗一样大就读不出先敲哪颗');
    assert.ok(CONFIG.PAIR_LEAD_SCALE < 1 && CONFIG.PAIR_TAIL_SCALE > 0);
    // 首颗敲掉后：变暗（仍认得出自己敲过哪颗）、间距收短（连线因此缩短）、第二颗放大到与首颗同级
    assert.ok(CONFIG.PAIR_DIM > 0 && CONFIG.PAIR_DIM < 0.5, '暗到看不见就不知道自己敲过哪颗了');
    assert.ok(CONFIG.PAIR_CONTRACT > 0 && CONFIG.PAIR_CONTRACT < 1);
    // 收短之后两颗不能叠死：中心距仍要大于两颗的直径之和的一半，连线才还露得出来
    const body = CONFIG.STAR_SIZE * CONFIG.PAIR_LEAD_SCALE;
    assert.ok(CONFIG.PAIR_GAP > body, '两颗星一开始就叠在一起');
    assert.ok(CONFIG.PAIR_GAP * CONFIG.PAIR_CONTRACT > body, '连线缩短后整个被两颗星盖住了');
    // 过渡要看得见又不拖沓：比闪白长、比飘分短
    assert.ok(CONFIG.PAIR_ARM_MS > CONFIG.FX_FLASH_MS && CONFIG.PAIR_ARM_MS < CONFIG.FX_SCORE_MS);
    assert.ok(CONFIG.PAIR_LINK_WIDTH > 0 && CONFIG.PAIR_LINK_ALPHA > 0 && CONFIG.PAIR_LINK_ALPHA <= 1);
    assert.ok(CONFIG.PAIR_CHEVRON > 0 && CONFIG.PAIR_CHEVRON < CONFIG.PAIR_GAP / 2);

    // 生成侧要的半宽必须真容得下整对（间距一半 + 待敲那颗的半径），边距内缩后整对才不出画布
    const extra = CONFIG.PAIR_SPAN - CONFIG.STAR_SIZE / 2;
    assert.ok(extra > 0);
    assert.ok(CONFIG.PAIR_SPAN >= CONFIG.PAIR_GAP / 2 + body / 2, 'PAIR_SPAN 装不下整对');
    assert.ok(CONFIG.SPAWN_MARGIN + extra >= CONFIG.PAIR_SPAN, '最靠边时整对会挂在画布外');
    assert.ok((CONFIG.SPAWN_MARGIN + extra) * 2 < CONFIG.WIDTH, '内缩之后没有可用的生成区间了');

    // 字母跟着节点同比缩（harness/ui.md 如实记的那档代价）：待敲那颗不小于 24px、
    // 还没轮到的那颗不小于 18px，否则把 PAIR_LEAD_SCALE 改小就会静默读不清（Lv3 起才有双星）
    for (const id of [3, 4, 5]) {
        const level = ns.levelById(id);
        assert.ok(level.fontSize * CONFIG.PAIR_LEAD_SCALE >= 24, 'Lv' + id + ' 待敲那颗的字母');
        assert.ok(level.fontSize * CONFIG.PAIR_TAIL_SCALE >= 18, 'Lv' + id + ' 还没轮到那颗的字母');
    }

    // 一次消除发两份闪白与两簇星屑（轮到那颗 + 已敲暗那颗），敲第一颗还另发一份字母：
    // 连打双星时这两个池的需求按 ×2 算（同 5a 光柱 / 5b 吸入的池账目判据）。
    // 注意"整屏全是双星同时清空"是保守上界（5e 后同屏特殊星 ≤2，造不出这个极端），
    // 星屑真到那份上会被 maxAliveParticles 掐掉几颗
    for (const level of ns.LEVELS) {
        const fastest = level.spawnInterval * CONFIG.CLIMB.intervalFloor;
        assert.ok(2 * Math.ceil(CONFIG.FX_FLASH_MS / fastest) <= CONFIG.FX_FLASH_POOL_SIZE,
            'Lv' + level.id + ' 连打双星的闪白');
        assert.ok(2 * Math.ceil(CONFIG.FX_LETTER_MS / fastest) <= CONFIG.FX_LETTER_POOL_SIZE,
            'Lv' + level.id + ' 连打双星的字母');
        assert.ok(2 * CONFIG.FX_SPARK_MAX * Math.ceil(CONFIG.FX_SPARK_LIFE_MAX / fastest) <= CONFIG.FX_SPARK_MAX_ALIVE,
            'Lv' + level.id + ' 连打双星的星屑');
    }
});
