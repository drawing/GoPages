import test from 'node:test';
import assert from 'node:assert/strict';

import { load } from './load.mjs';

const ns = load();
const SpawnDirector = ns.systems.SpawnDirector;

// 最小鸭子类型池：只实现 director 用到的 active / acquire。
// 假星一律放在半空（y=300），生成瞬间的防重叠判定就不会因为随机落点让测试时好时坏。
// level 只为单元方案传（9e）：星体 96 比常规星宽出来的那截半宽要算进 spanExtra；
// 缺参时 body 就是常规 72，非双星的 spanExtra 仍是 0——键位方案的假星与 9d 之前逐字相同
function fakePool(level) {
    const body = level && level.units ? level.units.body : ns.CONFIG.STAR_SIZE;
    const sequence = ns.utils.sequence;
    return {
        active: [],
        // acquire 收的是**键序内容**（键位方案一串键：单颗星一个、双星两个 5d；单元方案一组读音，
        // 单读音字一条、多音字多条 9g）与显示面（9e 的第 5 参，缺参 = 星面就是键本身）。
        // 假星走**真的** sequence 引擎派生 nextKeys / letter / pending，与 Star.syncKeys 同一份口径
        // ——生成侧数同屏名额读的就是 nextKeys，假星自己算一套的话这条契约等于没测
        acquire: function (keys, x, speed, spec, face) {
            const seq = sequence.create(keys);
            const nextKeys = Array.from(sequence.nextKeys(seq));
            const star = {
                seq: seq,
                // 双星那两个字母（键位方案那条路）：验"一对不会同字母"与"last 记的是第二颗"用它
                letters: Array.from(seq.paths[0]),
                nextKeys: nextKeys,
                letter: nextKeys[0] || '',
                pending: sequence.pendingKey(seq),
                face: face || null,
                x: x,
                y: 300,
                speed: speed,
                typeSpec: spec,
                spanExtra: spec.pair
                    ? ns.CONFIG.PAIR_SPAN - ns.CONFIG.STAR_SIZE / 2
                    : (body - ns.CONFIG.STAR_SIZE) / 2
            };
            this.active.push(star);
            return star;
        }
    };
}

// 5e 加权生成后没有 forceType 了：要稳定遇到某一类，用"只开这一类 + 大加倍"的档位变体
// 把它变成大概率（specialBoost 50 时至少 55%），再循环生成到遇见为止。
// 变体是测试自己构造的局部对象，不碰共享的 LEVELS 条目
function typeLevel(id, baseId) {
    return Object.assign({}, ns.levelFor('standard',baseId || 3), { specials: [id], specialBoost: 50 });
}

function spawnType(director, id) {
    for (let i = 0; i < 200; i++) {
        director.pool.active.length = 0;
        const star = director.spawn();
        if (star && star.typeSpec.id === id) { return star; }
    }
    assert.fail('200 次生成没遇到 ' + id);
}

test('速度与生成间隔读表：把 speed 改成 300 立刻生效，不用动逻辑', function () {
    const pool = fakePool();
    const level = Object.assign({}, ns.levelFor('standard',1), { speed: 300, spawnInterval: 100 });
    const director = new SpawnDirector(pool, level);

    assert.equal(director.update(0.05), null);
    const star = director.update(0.05);
    assert.ok(star);
    assert.equal(star.speed, 300);

    const master = new SpawnDirector(fakePool(), ns.levelFor('standard',5));
    const fast = master.spawn();
    assert.equal(fast.speed, 225 * fast.typeSpec.speedMul);
});

test('同屏上限读表：满了就跳过这一次生成，不越界', function () {
    const pool = fakePool();
    const director = new SpawnDirector(pool, Object.assign({}, ns.levelFor('standard',5), { maxOnScreen: 2 }));

    assert.ok(director.spawn());
    assert.ok(director.spawn());
    assert.equal(director.spawn(), null);
    assert.equal(pool.active.length, 2);
    assert.equal(director.stats().cap, 1);
});

test('字母池读表：五档各生成 120 颗，没有一颗出池，也没有哪档卡死', function () {
    for (const tier of ns.LEVELS) {
        const level = ns.levelFor('standard', tier.id);
        const pool = fakePool();
        const director = new SpawnDirector(pool, Object.assign({}, level, { maxOnScreen: 1 }));
        for (let i = 0; i < 120; i++) {
            const star = director.spawn();
            assert.ok(star, 'Lv' + level.id + ' 第 ' + i + ' 次生成被卡住');
            assert.ok(level.pool.includes(star.letter), 'Lv' + level.id + ' 出了池外的 ' + star.letter);
            pool.active.length = 0;
        }
        assert.equal(director.stats().spawned, 120);
    }
});

// 2c 爬升曲线：CONFIG.CLIMB 是全局一条，闯关不爬升，无尽按级数算闭式幂并封顶。
// 5e 起生成类型是随机的，速度断言一律乘上那颗星自己的 speedMul，不预设它是普通星
test('闯关模式完全不爬升：50 次击落后速度与间隔仍是表值', function () {
    const level = ns.levelFor('standard',3);
    const director = new SpawnDirector(fakePool(), level, { climb: false });
    for (let i = 0; i < 50; i++) { assert.equal(director.registerHit(), null); }

    const progress = director.progress();
    assert.equal(progress.stage, 0);
    assert.equal(progress.speedRatio, 1);
    assert.equal(progress.intervalRatio, 1);
    const star = director.spawn();
    assert.equal(star.speed, level.speed * star.typeSpec.speedMul);
});

test('无尽模式每 15 次击落爬一级：下落 ×1.06、间隔 ×0.95，已在场的星同步提速', function () {
    const climb = ns.CONFIG.CLIMB;
    const level = ns.levelFor('standard',3);
    const director = new SpawnDirector(fakePool(), level, { climb: true });
    const flying = director.spawn();

    for (let i = 1; i < climb.every; i++) { assert.equal(director.registerHit(), null); }
    assert.equal(director.registerHit(), 1);

    const progress = director.progress();
    assert.equal(progress.stage, 1);
    assert.equal(progress.sinceClimb, 0);
    assert.ok(Math.abs(progress.speedRatio - climb.speedMul) < 1e-12);
    assert.ok(Math.abs(progress.intervalRatio - climb.intervalMul) < 1e-12);
    assert.ok(Math.abs(flying.speed - level.speed * climb.speedMul * flying.typeSpec.speedMul) < 1e-9,
        '已在场的星没跟着提速');
    const next = director.spawn();
    assert.ok(Math.abs(next.speed - level.speed * climb.speedMul * next.typeSpec.speedMul) < 1e-9);
});

test('生成节奏读爬升后的间隔：Lv3 的 1050ms 收到 997.5ms 才吐下一颗', function () {
    const climb = ns.CONFIG.CLIMB;
    const level = ns.levelFor('standard',3);
    const director = new SpawnDirector(fakePool(), level, { climb: true });
    for (let i = 0; i < climb.every; i++) { director.registerHit(); }

    const interval = level.spawnInterval * climb.intervalMul;
    assert.ok(Math.abs(director.progress().intervalRatio - climb.intervalMul) < 1e-12);
    assert.equal(director.update(interval / 1000 - 0.002), null);
    assert.ok(director.update(0.003));
});

// LEVELS 是所有方案共用的共享条目，director 就地改它会让菜单预览与下一局静默变难。
// 9a 起 director 拿到的是 levelFor 合成的本局对象，共享表更不该被碰到——两条都守
test('封顶：爬到 60 级后速度不超过 1.8×、间隔不低于 0.4×，且共享 LEVELS 表没被改掉', function () {
    const climb = ns.CONFIG.CLIMB;
    const tier = ns.levelById(5);
    const level = ns.levelFor('standard', 5);
    const tableSpeed = tier.speed;
    const tableInterval = tier.spawnInterval;
    const director = new SpawnDirector(fakePool(), level, { climb: true });

    for (let i = 0; i < climb.every * 60; i++) { director.registerHit(); }
    const progress = director.progress();
    assert.equal(progress.stage, 60);
    assert.ok(progress.capped);
    assert.equal(progress.speedRatio, climb.speedCap);
    assert.equal(progress.intervalRatio, climb.intervalFloor);
    const star = director.spawn();
    assert.ok(Math.abs(star.speed - tableSpeed * climb.speedCap * star.typeSpec.speedMul) < 1e-9);

    for (let i = 0; i < climb.every; i++) { director.registerHit(); }
    assert.equal(director.progress().stage, 61);
    assert.equal(director.progress().speedRatio, climb.speedCap, '封顶后速度还在长');
    assert.equal(level.speed, tableSpeed);
    assert.equal(level.spawnInterval, tableInterval);
    assert.equal(tier.speed, tableSpeed);
    assert.equal(tier.spawnInterval, tableInterval);
});

// 5e 加权生成：类型按 STAR_TYPES 权重 × LEVELS 开关抽（pickStarType），
// 生成侧把那一行原样交给星，速度 = 档速 × speedMul，爬升叠在其上
test('类型读表：五类各自的速度 = 档速 × speedMul，类型行原样交给星，爬升叠在类型倍率之上', function () {
    const level = ns.levelFor('standard',3);
    for (const type of ns.STAR_TYPES) {
        const director = new SpawnDirector(fakePool(), typeLevel(type.id));
        const star = spawnType(director, type.id);
        assert.equal(star.typeSpec, type, '星没拿到类型表那一行');
        assert.equal(star.speed, level.speed * type.speedMul);
    }
    // 黑洞与冰晶都是标准下落（harness/gameplay.md）：能不能敲 / 命中后给全场减速
    // 由那一行的 hazard / chill 标志在判定侧读，生成侧不参与
    assert.ok(ns.starType('void').hazard);
    assert.ok(ns.starType('ice').chill);

    // 爬升乘在 speedMul 之上（2c 的 applyStage 就地乘 star.speed），两条倍率叠着走而不是互相覆盖
    const climb = ns.CONFIG.CLIMB;
    const gold = ns.starType('gold');
    const climbing = new SpawnDirector(fakePool(), typeLevel('gold'), { climb: true });
    for (let i = 0; i < climb.every; i++) { climbing.registerHit(); }
    const climbed = spawnType(climbing, 'gold');
    assert.ok(Math.abs(climbed.speed - level.speed * climb.speedMul * gold.speedMul) < 1e-9);
});

test('加权生成读难度开关：Lv1 只有普通星，Lv2 只出金+冰，Lv3+ 四类特殊星都出得来', function () {
    const rolls = Array.from({ length: 1000 }, (_, i) => i / 1000);
    for (const roll of rolls) {
        assert.equal(ns.pickStarType(ns.levelFor('standard',1), 0, roll).id, 'normal', 'Lv1 出了特殊星');
        const two = ns.pickStarType(ns.levelFor('standard',2), 0, roll).id;
        assert.ok(['normal', 'gold', 'ice'].includes(two), 'Lv2 出了 ' + two);
    }
    const seen2 = new Set(rolls.map((roll) => ns.pickStarType(ns.levelFor('standard',2), 0, roll).id));
    assert.deepEqual(Array.from(seen2).sort(), ['gold', 'ice', 'normal']);
    const seen3 = new Set(rolls.map((roll) => ns.pickStarType(ns.levelFor('standard',3), 0, roll).id));
    assert.deepEqual(Array.from(seen3).sort(), ['double', 'gold', 'ice', 'normal', 'void']);
});

// 均匀扫一遍 [0,1) 就是精确的分布验证（不靠随机样本手感）：
// 每一类占到的格数必须等于它的权重份额，误差只允许来自区间端点
test('权重分布逐格对齐类型表：Lv3 按 82/6/5/5/2，Lv5 特殊星加倍、普通星不加倍', function () {
    const N = 10000;
    for (const id of [3, 5]) {
        const level = ns.levelFor('standard',id);
        const weightOf = (type) => type.id === 'normal'
            ? type.weight
            : (level.specials.includes(type.id) ? type.weight * level.specialBoost : 0);
        const total = ns.STAR_TYPES.reduce((sum, type) => sum + weightOf(type), 0);

        const counts = {};
        for (let i = 0; i < N; i++) {
            const type = ns.pickStarType(level, 0, i / N);
            counts[type.id] = (counts[type.id] || 0) + 1;
        }
        for (const type of ns.STAR_TYPES) {
            const expected = weightOf(type) / total * N;
            const actual = counts[type.id] || 0;
            assert.ok(Math.abs(actual - expected) <= 2,
                'Lv' + id + ' 的 ' + type.id + ' 占 ' + actual + ' 格，权重份额应是 ' + expected.toFixed(1));
        }
    }
});

test('同屏特殊星 ≤2：配额满回落普通星，双星只算一个名额，整局任何时刻不超', function () {
    const level = ns.levelFor('standard',5);
    // 配额满时任何 roll 都是普通星——回落而不是跳过，这一拍照常生成
    for (let i = 0; i < 100; i++) {
        assert.equal(ns.pickStarType(level, 2, i / 100).id, 'normal');
    }

    // 双星 + 金色 = 两个名额（双星是一个整体）：下一颗必是普通星
    const director = new SpawnDirector(fakePool(), level);
    director.pool.active.push(
        { letter: 'a', pending: 'b', x: 200, y: 300, spanExtra: 0, typeSpec: ns.starType('double') },
        { letter: 'c', pending: null, x: 500, y: 300, spanExtra: 0, typeSpec: ns.starType('gold') }
    );
    const next = director.spawn();
    assert.ok(next);
    assert.equal(next.typeSpec.id, 'normal', '配额满了还出特殊星');

    // 整局模拟：星不落走、满了挤掉最旧，特殊星数任何时刻不超 2，且真的到过 2
    const live = new SpawnDirector(fakePool(), level);
    let peak = 0;
    for (let i = 0; i < 300; i++) {
        if (live.pool.active.length >= level.maxOnScreen) { live.pool.active.shift(); }
        live.spawn();
        const specials = live.pool.active.filter((star) => star.typeSpec.id !== 'normal').length;
        peak = Math.max(peak, specials);
        assert.ok(specials <= 2, '第 ' + i + ' 拍同屏特殊星 ' + specials + ' 颗');
    }
    assert.equal(peak, 2, '300 拍里特殊星从没到过 2，上限断言等于没跑');
});

test('整局模拟：Lv1 五百颗零特殊星，Lv3 自然生成四类特殊星都遇得到', function () {
    const one = new SpawnDirector(fakePool(), ns.levelFor('standard',1));
    for (let i = 0; i < 500; i++) {
        one.pool.active.length = 0;
        assert.equal(one.spawn().typeSpec.id, 'normal', 'Lv1 第 ' + i + ' 颗出了特殊星');
    }

    const three = new SpawnDirector(fakePool(), ns.levelFor('standard',3));
    const seen = new Set();
    for (let i = 0; i < 3000 && seen.size < ns.STAR_TYPES.length; i++) {
        three.pool.active.length = 0;
        const star = three.spawn();
        if (star) { seen.add(star.typeSpec.id); }
    }
    assert.deepEqual(Array.from(seen).sort(), ['double', 'gold', 'ice', 'normal', 'void']);
});

// 5d 的双星：一对是"一次生成拿两个字母"，生成侧只多认一个 pair 标志（harness/architecture.md）
test('双星生成：两个不同字母都在池内、标准下落、整对内缩进画布、last 记的是第二颗', function () {
    const CONFIG = ns.CONFIG;
    const level = ns.levelFor('standard',3);
    const spec = ns.starType('double');
    const director = new SpawnDirector(fakePool(), typeLevel('double'));

    let lastPair = null;
    for (let i = 0; i < 60; i++) {
        const star = spawnType(director, 'double');
        assert.equal(star.typeSpec, spec, '星没拿到类型表那一行');
        assert.equal(star.letters.length, 2, '一对只拿到一个字母');
        assert.notEqual(star.letters[0], star.letters[1], '两颗同字母，"按顺序"就没意义了');
        for (const letter of star.letters) { assert.ok(level.pool.includes(letter), '出了池外的 ' + letter); }
        // 判定只读 letter：它必须是先敲那颗，还没轮到的那颗挂在 pending 上
        assert.equal(star.letter, star.letters[0]);
        assert.equal(star.pending, star.letters[1]);
        assert.equal(star.speed, level.speed, '双星是标准下落，speedMul 必须是 1');
        // 边距按半宽内缩，整对（含两颗各自的半径）才落在画布内，字母不会被切掉
        assert.ok(Math.abs(star.x - CONFIG.WIDTH / 2) <= CONFIG.WIDTH / 2 - CONFIG.PAIR_SPAN,
            'x=' + star.x + ' 时有节点挂在画布外');
        lastPair = star;
    }

    // "不连续重复"跨一对也成立：this.last 记的是第二颗，下一颗不会紧接着重复它
    const next = director.spawn();
    assert.ok(next);
    assert.notEqual(next.letters[0], lastPair.letters[1]);
});

test('双星的横向间隔按半宽加宽：紧挨着另一对时不会压在它身上', function () {
    const CONFIG = ns.CONFIG;
    const extra = CONFIG.PAIR_SPAN - CONFIG.STAR_SIZE / 2;
    const director = new SpawnDirector(fakePool(), typeLevel('double', 5));
    // 一对双星停在生成线上（y = SPAWN_Y）才算邻居：防重叠只看这一条带子里的星
    const blocker = { letter: 'a', pending: 'b', x: CONFIG.WIDTH / 2, y: CONFIG.SPAWN_Y, spanExtra: extra };
    const need = CONFIG.SPAWN_GAP_X + extra * 2;

    let pairs = 0;
    for (let i = 0; i < 40; i++) {
        director.pool.active.length = 0;
        director.pool.active.push(blocker);
        const star = director.spawn();
        // 8 次重采样都撞车就跳过这一拍（overlap 计数），跳过不算失败
        if (!star || !star.typeSpec.pair) { continue; }
        pairs++;
        assert.ok(Math.abs(star.x - blocker.x) >= need, 'x=' + star.x + ' 与场上那对挨得太近');
    }
    assert.ok(pairs > 0, '一对双星都没生成出来，上面那条断言等于没跑');
});

test('双星还没轮到的那颗也占字母位：同屏同字母 ≤2 是给它一起算的', function () {
    const level = Object.assign({}, ns.levelFor('standard',1), { pool: 'ab', maxOnScreen: 8 });
    const director = new SpawnDirector(fakePool(), level);
    director.pool.active.push(
        { letter: 'a', pending: null, x: 100, y: 300, spanExtra: 0 },
        { letter: 'a', pending: null, x: 300, y: 300, spanExtra: 0 },
        { letter: 'b', pending: 'b', x: 500, y: 300, spanExtra: 0 }
    );

    // 两个 a 已满、b 一个在场另一个挂在一对双星上：候选清空就整拍跳过，不放宽硬约束
    assert.equal(director.spawn(), null, 'pending 没被算进去就会再生出一个 b');
    assert.equal(director.stats().letter, 1);

    // 把那个 pending 摘掉立刻有候选，证明卡的确实是它
    director.pool.active[2].pending = null;
    assert.equal(director.spawn().letter, 'b');
});

test('双星挑不出第二个字母就整对放弃，不退化成单颗星', function () {
    // 池里只有一个字母：第一颗挑得到、第二颗必然撞"不连续重复"，于是一对生不出来
    const solo = new SpawnDirector(fakePool(), Object.assign({}, ns.levelFor('standard',3), { pool: 'a' }));
    assert.equal(solo.pickLetters(ns.starType('double'), []), null);

    // 两个 a 已满屏：第一颗只能挑 b，第二颗既不能重复 b 也没有别的 a 可挑
    const pair = new SpawnDirector(fakePool(), Object.assign({}, ns.levelFor('standard',3), { pool: 'ab' }));
    const active = [
        { letter: 'a', pending: null },
        { letter: 'a', pending: null }
    ];
    assert.equal(pair.pickLetters(ns.starType('double'), active), null);
    // 单颗星不受这条约束：同一局面挑得到 b。spawn 对 null 的处理两类共用一条路
    // （整拍跳过、不 acquire），上面 pending 那条测试守着
    assert.deepEqual(Array.from(pair.pickLetters(ns.starType('normal'), active)), ['b']);
});

// 黑洞字母隔离：黑洞与非黑洞不共享字母，消除"按了扣命、不按也扣命"的无解陷阱
test('黑洞字母隔离：生成黑洞时排除非黑洞字母，生成非黑洞时排除黑洞字母', function () {
    const level = Object.assign({}, ns.levelFor('standard',3), { pool: 'abcde', maxOnScreen: 8 });
    const director = new SpawnDirector(fakePool(), level);
    const voidSpec = ns.starType('void');
    const normalSpec = ns.starType('normal');

    // 场上有普通星 a, b：黑洞只能挑 c/d/e
    const normals = [
        { letter: 'a', pending: null, typeSpec: normalSpec },
        { letter: 'b', pending: null, typeSpec: normalSpec }
    ];
    for (let i = 0; i < 100; i++) {
        const picked = director.pickLetters(voidSpec, normals);
        assert.ok(picked, '候选没被清空不该返回 null');
        assert.ok(!['a', 'b'].includes(picked[0]), '黑洞挑到了非黑洞的字母 ' + picked[0]);
    }

    // 场上有黑洞 c：普通星只能挑 a/b/d/e
    const voids = [{ letter: 'c', pending: null, typeSpec: voidSpec }];
    for (let i = 0; i < 100; i++) {
        const picked = director.pickLetters(normalSpec, voids);
        assert.ok(picked);
        assert.notEqual(picked[0], 'c', '普通星挑到了黑洞的字母');
    }

    // 双星的 pending 也参与隔离：黑洞不能挑到双星还没轮到的那颗字母
    const pairActive = [{ letter: 'd', pending: 'e', typeSpec: ns.starType('double') }];
    for (let i = 0; i < 100; i++) {
        const picked = director.pickLetters(voidSpec, pairActive);
        assert.ok(picked);
        assert.ok(!['d', 'e'].includes(picked[0]), '黑洞挑到了双星的字母 ' + picked[0]);
    }

    // 排除集清空候选时整拍跳过（不放宽）：池只有 a，非黑洞占了 a，黑洞挑不到任何字母
    const tight = Object.assign({}, ns.levelFor('standard',3), { pool: 'a' });
    const tightDir = new SpawnDirector(fakePool(), tight);
    const blocked = [{ letter: 'a', pending: null, typeSpec: normalSpec }];
    assert.equal(tightDir.pickLetters(voidSpec, blocked), null);
    // 反过来：池只有 b，黑洞占了 b，普通星也挑不到
    const tight2 = Object.assign({}, ns.levelFor('standard',3), { pool: 'b' });
    const tightDir2 = new SpawnDirector(fakePool(), tight2);
    const blocked2 = [{ letter: 'b', pending: null, typeSpec: voidSpec }];
    assert.equal(tightDir2.pickLetters(normalSpec, blocked2), null);
});

test('黑洞字母隔离整局模拟：Lv3 三百拍里黑洞与非黑洞从不共享字母', function () {
    const level = ns.levelFor('standard',3);
    const director = new SpawnDirector(fakePool(), level);
    let voidSeen = 0;
    for (let i = 0; i < 300; i++) {
        if (director.pool.active.length >= level.maxOnScreen) { director.pool.active.shift(); }
        const star = director.spawn();
        if (!star) { continue; }
        const active = director.pool.active;
        const isVoid = star.typeSpec.hazard;
        if (isVoid) { voidSeen++; }
        for (const other of active) {
            if (other === star) { continue; }
            const otherVoid = other.typeSpec && other.typeSpec.hazard;
            if (isVoid === otherVoid) { continue; }
            const letters1 = [star.letter, star.pending].filter(Boolean);
            const letters2 = [other.letter, other.pending].filter(Boolean);
            for (const l1 of letters1) {
                assert.ok(!letters2.includes(l1),
                    '第 ' + i + ' 拍黑洞与非黑洞共享字母 ' + l1);
            }
        }
    }
    assert.ok(voidSeen > 0, '三百拍没遇到黑洞，隔离断言等于没跑');
});

// 9c 专练方案：内容池换掉后生成侧一行不改。字母专练大师档也不出数字符号；
// 数字 / 符号专练在 Lv3（有黑洞）整局池内生成，窄池下黑洞隔离仍成立、不卡死；
// 入门档即出对应内容——不必开大师速度
test('专练方案整局模拟：池内生成、窄池黑洞隔离仍成立，数字符号入门档就出对应内容', function () {
    for (const [schemeId, levelId] of [['letters', 5], ['digits', 3], ['symbols', 3]]) {
        const level = ns.levelFor(schemeId, levelId);
        const director = new SpawnDirector(fakePool(), level);
        let voidSeen = 0;
        let spawned = 0;
        for (let i = 0; i < 300; i++) {
            if (director.pool.active.length >= level.maxOnScreen) { director.pool.active.shift(); }
            const star = director.spawn();
            if (!star) { continue; }
            spawned++;
            const mine = [star.letter, star.pending].filter(Boolean);
            for (const ch of mine) {
                assert.ok(level.pool.includes(ch), schemeId + ' 第 ' + i + ' 拍出了池外的 ' + ch);
            }
            const isVoid = star.typeSpec.hazard;
            if (isVoid) { voidSeen++; }
            for (const other of director.pool.active) {
                if (other === star) { continue; }
                const otherVoid = other.typeSpec && other.typeSpec.hazard;
                if (isVoid === otherVoid) { continue; }
                const theirs = [other.letter, other.pending].filter(Boolean);
                for (const ch of mine) {
                    assert.ok(!theirs.includes(ch), schemeId + ' 第 ' + i + ' 拍黑洞与非黑洞共享字母 ' + ch);
                }
            }
        }
        assert.ok(voidSeen > 0, schemeId + ' 三百拍没遇到黑洞，隔离断言等于没跑');
        assert.ok(spawned > 200, schemeId + ' 窄池卡死：三百拍只生成 ' + spawned + ' 颗');
    }

    // 入门档（无特殊星）即出对应内容：五档共享的物理没变，池从第一档就是数字 / 符号
    for (const schemeId of ['digits', 'symbols']) {
        const level = ns.levelFor(schemeId, 1);
        const director = new SpawnDirector(fakePool(), Object.assign({}, level, { maxOnScreen: 1 }));
        for (let i = 0; i < 120; i++) {
            const star = director.spawn();
            assert.ok(star, schemeId + ' Lv1 第 ' + i + ' 次生成被卡住');
            assert.ok(level.pool.includes(star.letter), schemeId + ' Lv1 出了池外的 ' + star.letter);
            director.pool.active.length = 0;
        }
    }
});

// 9d 双星门禁落到生成侧：专练方案 Lv3+ 整局不出双星（levelFor 已滤掉），标准方案同档仍出得来。
// 生成流程一行没改，门禁全在合成档位的 specials——这条守住"仅标准方案使用"
test('双星门禁：专练 Lv3+ 三百拍零双星，标准方案同档仍出双星', function () {
    for (const id of ['letters', 'digits', 'symbols']) {
        const director = new SpawnDirector(fakePool(), ns.levelFor(id, 3));
        for (let i = 0; i < 300; i++) {
            director.pool.active.length = 0;
            const star = director.spawn();
            if (star) { assert.notEqual(star.typeSpec.id, 'double', id + ' 第 ' + i + ' 拍出了双星'); }
        }
    }
    const standard = new SpawnDirector(fakePool(), typeLevel('double'));
    assert.ok(spawnType(standard, 'double'), '标准方案该出双星');
});

// 9e 单元方案：生成侧从「挑字母」换成「挑一个单元」，pickLetters 一行没改。
// 内容层的契约全在这条里：显示面在本档字表内、键序是它的读音（9g-1 起多音字带**一组**）、
// "不连续重复"记的是显示面、同屏每个候选键 ≤2、类型只有金 / 冰（unit 门禁）
test('单元方案整局模拟：显示面在字表内、每条读音全 a–z、不连续重复同字、同屏候选键 ≤2、不出黑洞与双星', function () {
    for (const levelId of [1, 3, 5]) {
        const level = ns.levelFor('hanzi', levelId);
        const byFace = new Map(Array.from(level.units.list, (unit) => [unit.face, unit]));
        const director = new SpawnDirector(fakePool(level), level);
        let spawned = 0;
        let polyphones = 0;
        let previous = null;
        for (let i = 0; i < 300; i++) {
            if (director.pool.active.length >= level.maxOnScreen) { director.pool.active.shift(); }
            const star = director.spawn();
            if (!star) { continue; }
            spawned++;
            const unit = byFace.get(star.face);
            assert.ok(unit, 'hanzi Lv' + levelId + ' 第 ' + i + ' 拍出了字表外的 ' + star.face);
            assert.notEqual(star.face, previous, 'hanzi Lv' + levelId + ' 连着出了同一个字 ' + star.face);
            assert.ok(['normal', 'gold', 'ice'].includes(star.typeSpec.id),
                'hanzi Lv' + levelId + ' 第 ' + i + ' 拍出了 ' + star.typeSpec.id);
            // 生成的星要带上这个字的**全部**读音（9g-1 多音字任一读音都算对）
            assert.equal(star.seq.paths.length, unit.readings.length,
                star.face + ' 只带上了 ' + star.seq.paths.length + ' 条读音');
            for (const reading of star.seq.paths) {
                // 单元星至少两键：单键特例没有进度可显示，也就不是序列星
                assert.ok(reading.length >= 2, 'hanzi Lv' + levelId + ' 出了单键单元 ' + star.face);
                for (const key of reading) {
                    assert.ok(key >= 'a' && key <= 'z',
                        'hanzi Lv' + levelId + ' 键序里有 a–z 之外的 ' + key);
                }
            }
            if (star.seq.paths.length > 1) { polyphones++; }
            // 判定与白圈只读 nextKeys：刚生成时就是这个字每条读音的首键（去重、按读音表顺序）。
            // letter 是规范键，触屏摊平与快照读它
            const firsts = [];
            for (const reading of unit.readings) {
                if (!firsts.includes(reading[0])) { firsts.push(reading[0]); }
            }
            assert.deepEqual(star.nextKeys, firsts, star.face + ' 的待敲键集合');
            assert.equal(star.letter, star.nextKeys[0], 'letter 是规范键 = 集合第一个');
            // 同屏「待敲键」≤2 按**每个**候选键算：多音字占它每个首键的名额，
            // 只数规范键会让白圈在两个都接受该键的星之间撒谎。后续键仍不数（藏在显示面里）
            for (const key of star.nextKeys) {
                const same = director.pool.active.filter((other) => other.nextKeys.includes(key)).length;
                assert.ok(same <= ns.CONFIG.LETTER_MAX_SAME,
                    'hanzi Lv' + levelId + ' 第 ' + i + ' 拍同屏候选键 ' + key + ' 有 ' + same + ' 颗');
            }
            previous = star.face;
        }
        assert.ok(spawned > 200, 'hanzi Lv' + levelId + ' 卡死：三百拍只生成 ' + spawned + ' 颗');
        // 反向保险：三百拍里一个多音字都没遇到的话，上面那几条多读音断言等于没跑
        assert.ok(polyphones > 0, 'hanzi Lv' + levelId + ' 三百拍没遇到多音字，多读音那条路没被压到');
        assert.equal(director.last, previous, '"不连续重复"该记显示面，不是键序的末键');
    }
});

// 9f 双拼方案整局模拟：与汉字方案同一条生成路（pickUnit），只是键序恒 2 键。
// 显示面在字表内、键序恒 2 键全 a–z、不连续重复同字、同屏候选键 ≤2、只出金 / 冰（unit 门禁）。
// 内容串里一个多音字都没有 ⇒ 每颗星只有一条读音（9g-1 因此不用 bump flypy 的版本）
test('双拼方案整局模拟：键序恒 2 键全 a–z、显示面在字表内、不连续重复、同屏候选键 ≤2、不出黑洞双星', function () {
    for (const levelId of [1, 3, 5]) {
        const level = ns.levelFor('flypy', levelId);
        const faces = new Set(level.units.list.map((unit) => unit.face));
        const director = new SpawnDirector(fakePool(level), level);
        let spawned = 0;
        let previous = null;
        for (let i = 0; i < 300; i++) {
            if (director.pool.active.length >= level.maxOnScreen) { director.pool.active.shift(); }
            const star = director.spawn();
            if (!star) { continue; }
            spawned++;
            assert.ok(faces.has(star.face), 'flypy Lv' + levelId + ' 第 ' + i + ' 拍出了字表外的 ' + star.face);
            assert.notEqual(star.face, previous, 'flypy Lv' + levelId + ' 连着出了同一个字 ' + star.face);
            assert.ok(['normal', 'gold', 'ice'].includes(star.typeSpec.id),
                'flypy Lv' + levelId + ' 第 ' + i + ' 拍出了 ' + star.typeSpec.id);
            assert.equal(star.seq.paths.length, 1, 'flypy 的内容里没有多音字，每颗星只该有一条读音');
            assert.equal(star.letters.length, 2, 'flypy Lv' + levelId + ' 的双拼键序应当恒 2 键');
            for (const key of star.letters) {
                assert.ok(key >= 'a' && key <= 'z', 'flypy Lv' + levelId + ' 键序里有 a–z 之外的 ' + key);
            }
            assert.deepEqual(star.nextKeys, [star.letters[0]], '单读音星的候选键就是它的首键');
            assert.equal(star.letter, star.letters[0]);
            const same = director.pool.active.filter((other) => other.nextKeys.includes(star.letter)).length;
            assert.ok(same <= ns.CONFIG.LETTER_MAX_SAME,
                'flypy Lv' + levelId + ' 第 ' + i + ' 拍同屏首键 ' + star.letter + ' 有 ' + same + ' 颗');
            previous = star.face;
        }
        assert.ok(spawned > 200, 'flypy Lv' + levelId + ' 卡死：三百拍只生成 ' + spawned + ' 颗');
        assert.equal(director.last, previous, '"不连续重复"该记显示面');
    }
});

// 星体从 72 长到 96（9e）：生成边距与横向间隔都按多出来的那截半宽走，与双星的 PAIR_SPAN
// 内缩同一条纪律。漏了它，星体挂在画布外读不到字，或者压在生成线上的邻星身上
test('大星体的生成边距与横向间隔：96 的星体不出画布，也不压在生成线上的邻星身上', function () {
    const CONFIG = ns.CONFIG;
    const level = ns.levelFor('hanzi', 3);
    const extra = (level.units.body - CONFIG.STAR_SIZE) / 2;
    assert.ok(extra > 0, '单元方案的星体没比常规星宽，这条断言等于没跑');
    const director = new SpawnDirector(fakePool(level), level);
    // 邻星停在生成线上（y = SPAWN_Y）才算邻居：防重叠只看这一条带子里的星。
    // nextKeys 是单元方案生成侧数同屏名额读的那一份，手搭的假星也得给
    const blocker = {
        letter: 'y', nextKeys: ['y'], pending: null, face: '一',
        x: CONFIG.WIDTH / 2, y: CONFIG.SPAWN_Y, spanExtra: extra
    };
    const need = CONFIG.SPAWN_GAP_X + extra * 2;
    const edge = CONFIG.WIDTH / 2 - (CONFIG.SPAWN_MARGIN + extra);

    let stars = 0;
    for (let i = 0; i < 60; i++) {
        director.pool.active.length = 0;
        director.pool.active.push(blocker);
        const star = director.spawn();
        // 8 次重采样都撞车就跳过这一拍（overlap 计数），跳过不算失败
        if (!star) { continue; }
        stars++;
        assert.ok(Math.abs(star.x - blocker.x) >= need, 'x=' + star.x + ' 与生成线上那颗挨得太近');
        assert.ok(Math.abs(star.x - CONFIG.WIDTH / 2) <= edge, 'x=' + star.x + ' 时星体挂在画布外');
    }
    assert.ok(stars > 0, '一颗都没生成出来，上面两条断言等于没跑');
});