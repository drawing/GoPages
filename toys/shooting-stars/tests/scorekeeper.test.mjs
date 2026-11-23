import test from 'node:test';
import assert from 'node:assert/strict';

import { load } from './load.mjs';

const ns = load();
const CONFIG = ns.CONFIG;
const ScoreKeeper = ns.systems.ScoreKeeper;

function run(lives) {
    return new ScoreKeeper({ lives: lives == null ? 4 : lives });
}

test('loader：ScoreKeeper 与 SpawnDirector 同层装配，且不引用 Phaser', function () {
    assert.equal(typeof ScoreKeeper, 'function');
    assert.equal(typeof ns.systems.SpawnDirector, 'function');
});

test('紧迫奖励：画布三等分，上/中/下分别 +0/+5/+10', function () {
    const third = CONFIG.HEIGHT / CONFIG.URGENCY_BONUS.length;
    assert.equal(run().hit(-48), 10);                  // 生成线在画布外，仍算上段
    assert.equal(run().hit(third - 1), 10);
    assert.equal(run().hit(third), 15);
    assert.equal(run().hit(third * 2 - 1), 15);
    assert.equal(run().hit(third * 2), 20);
    assert.equal(run().hit(CONFIG.HORIZON_Y), 20);
});

test('连击倍率五档：先加连击再取倍率，第 5 次命中就吃 1.5×', function () {
    const tiers = [[0, 1], [4, 1], [5, 1.5], [9, 1.5], [10, 2], [19, 2], [20, 3], [39, 3], [40, 4], [999, 4]];
    for (const [combo, multiplier] of tiers) {
        assert.equal(ScoreKeeper.multiplierFor(combo), multiplier, 'combo ' + combo);
    }
    assert.equal(ScoreKeeper.tierIndex(0), 0);
    assert.equal(ScoreKeeper.tierIndex(40), CONFIG.COMBO_TIERS.length - 1);

    const keeper = run();
    for (let i = 0; i < 4; i++) { assert.equal(keeper.hit(0), 10); }
    assert.equal(keeper.hit(0), 15);
    assert.equal(keeper.multiplier(), 1.5);
    // (10 + 5) × 1.5 = 22.5，得分必须是整数
    assert.equal(keeper.hit(CONFIG.HEIGHT / 3), 23);
    assert.equal(keeper.score, 78);
    assert.equal(keeper.maxCombo, 6);
});

// 得分公式（harness/gameplay.md）的第三项：5a 起 GameScene 把类型表里的 bonus 喂进来，金色星那 +50 一样吃连击倍率
test('类型奖励：+50 与紧迫奖励并列进底分再乘倍率，缺参的调用点不受影响', function () {
    const bonus = ns.starType('gold').bonus;
    assert.equal(run().hit(0, bonus), 60);                    // 上段无紧迫奖励：10 + 0 + 50
    assert.equal(run().hit(CONFIG.HORIZON_Y, bonus), 70);     // 下段：10 + 10 + 50
    assert.equal(run().hit(0), 10, '不传 bonus 时必须是普通星那一档');

    const keeper = run();
    for (let i = 0; i < 4; i++) { assert.equal(keeper.hit(0, bonus), 60); }
    assert.equal(keeper.hit(0, bonus), 90);                   // 第 5 击吃 1.5×：60 × 1.5
    assert.equal(keeper.score, 330);
});

test('按错与坠毁都断连击，按错不扣分也不扣命', function () {
    const keeper = run(4);
    keeper.hit(500);
    keeper.hit(500);
    const before = keeper.score;

    keeper.miss();
    assert.equal(keeper.combo, 0);
    assert.equal(keeper.score, before);
    assert.equal(keeper.lives, 4);

    keeper.hit(500);
    assert.equal(keeper.crash(), false);
    assert.equal(keeper.combo, 0);
    assert.equal(keeper.lives, 3);
    assert.equal(keeper.maxCombo, 2);
});

test('生命归零：只有致命那一次 crash 返回 true', function () {
    const keeper = run(2);
    assert.equal(keeper.crash(), false);
    assert.equal(keeper.crash(), true);
    assert.equal(keeper.lives, 0);
});

// 6c 严格模式：按错另扣一次基础分，扣到 0 为止不为负。罚分不吃倍率——
// 连击攒到多高，按错那一下都只扣表里那个数；返回实扣量供判定读数显示
test('严格模式：按错扣一次基础分、不吃倍率、扣到 0 为止，返回实扣量', function () {
    const keeper = new ScoreKeeper({ lives: 4, strict: true });
    keeper.hit(500);
    keeper.hit(500);
    assert.equal(keeper.score, 40);

    assert.equal(keeper.miss(), CONFIG.STRICT_MISS_PENALTY);
    assert.equal(keeper.score, 40 - CONFIG.STRICT_MISS_PENALTY);
    assert.equal(keeper.combo, 0);
    assert.equal(keeper.misses, 1);
    assert.equal(keeper.lives, 4, '严格模式也不扣命');

    // 连击攒高后按错仍只扣那个数（罚分不乘倍率）
    for (let i = 0; i < 10; i++) { keeper.hit(0); }
    const before = keeper.score;
    keeper.miss();
    assert.equal(keeper.score, before - CONFIG.STRICT_MISS_PENALTY);

    // 分数不够扣时扣到 0 为止，不倒欠；0 分再按错实扣 0
    const poor = new ScoreKeeper({ lives: 4, strict: true });
    poor.hit(-48);
    assert.equal(poor.score, CONFIG.SCORE_BASE);
    assert.equal(poor.miss(), CONFIG.SCORE_BASE);
    assert.equal(poor.score, 0);
    assert.equal(poor.miss(), 0);
    assert.equal(poor.score, 0);
});

test('严格模式：误敲黑洞与无匹配同罚，坠毁不罚；默认模式 miss 返回 0 且分数不动', function () {
    const keeper = new ScoreKeeper({ lives: 4, strict: true });
    keeper.hit(500);
    keeper.hit(500);

    assert.equal(keeper.voidStrike(), false);
    assert.equal(keeper.score, 40 - CONFIG.STRICT_MISS_PENALTY);
    assert.equal(keeper.lives, 3);
    assert.equal(keeper.misses, 1);
    assert.equal(keeper.crashes, 0);
    assert.equal(keeper.accuracy(), 2 / 3 * 100, '罚分不改准确率口径');

    const before = keeper.score;
    assert.equal(keeper.crash(), false);
    assert.equal(keeper.score, before, '坠毁已经扣命，不再叠罚');
    assert.equal(keeper.lives, 2);

    const casual = run(4);
    casual.hit(500);
    assert.equal(casual.miss(), 0);
    assert.equal(casual.score, 20);
});

// 5b 误敲黑洞：扣命 + 断连击 + 记一次失误，但不算坠毁——它没落下去，是玩家敲错了对象。
// 准确率按设计的分母（击落 + 失误 + 坠毁，harness/gameplay.md）自然吃到这一次
test('误敲黑洞：命 −1、连击断、失误 +1，坠毁与分数不动，只有致命那一次返回 true', function () {
    const keeper = run(4);
    keeper.hit(500);
    keeper.hit(500);
    const score = keeper.score;

    assert.equal(keeper.voidStrike(), false);
    assert.equal(keeper.lives, 3);
    assert.equal(keeper.combo, 0);
    assert.equal(keeper.misses, 1);
    assert.equal(keeper.crashes, 0);
    assert.equal(keeper.hits, 2);
    assert.equal(keeper.score, score);
    assert.equal(keeper.maxCombo, 2);
    assert.equal(keeper.accuracy(), 2 / 3 * 100);

    keeper.hit(500);
    assert.equal(keeper.voidStrike(), false);
    assert.equal(keeper.voidStrike(), false);
    assert.equal(keeper.voidStrike(), true);
    assert.equal(keeper.lives, 0);
    assert.equal(keeper.crashes, 0);
});

test('准确率与手速：算法对得上 harness/gameplay.md，开局第一帧不除零', function () {
    const fresh = run();
    assert.equal(fresh.accuracy(), 0);
    assert.equal(fresh.speed(), 0);

    const keeper = run(4);
    keeper.hit(100);
    keeper.hit(100);
    keeper.hit(100);
    keeper.miss();
    keeper.tick(30);
    assert.equal(keeper.accuracy(), 75);   // 3 ÷ (3 + 1 + 0)
    assert.equal(keeper.speed(), 6);       // 3 ÷ 30 × 60
});

// 结算页按前八项取值，改键名会让 GameOverScene 静默显示 "—"；后三项供暂停面板渲染
test('stats 交出结算八项 + 暂停三项，全是数字', function () {
    const keeper = run(4);
    keeper.hit(500);
    keeper.miss();
    keeper.tick(12);

    const stats = keeper.stats();
    const keys = ['score', 'hits', 'misses', 'crashes', 'accuracy', 'maxCombo', 'speed', 'elapsed',
        'combo', 'multiplier', 'lives'];
    for (const key of keys) {
        assert.equal(typeof stats[key], 'number', key);
    }
    assert.equal(stats.score, keeper.score);
    assert.equal(stats.elapsed, 12);
    assert.equal(stats.combo, 0);
    assert.equal(stats.multiplier, 1);
    assert.equal(stats.lives, 4);
});

// 星屑雨的触发条件是"比上次读到的多"，所以这个计数必须单调、且只在跨档那一下变
test('里程碑计数：每跨一个 500 分涨一次，按错与坠毁都不会让它退回去重撒', function () {
    const keeper = run(4);
    assert.equal(keeper.milestones(), 0);

    let last = 0;
    while (keeper.score < CONFIG.SCORE_MILESTONE * 2) {
        keeper.hit(CONFIG.HEIGHT - 1);
        const now = keeper.milestones();
        assert.equal(now, Math.floor(keeper.score / CONFIG.SCORE_MILESTONE));
        assert.ok(now >= last, '里程碑退回去了');
        last = now;
    }
    assert.equal(last, 2);
    assert.equal(keeper.milestones(), 2, '重复读不能涨');

    keeper.miss();
    keeper.crash();
    assert.equal(keeper.milestones(), 2);
});

// GameScene 一次命中只撒一场雨，靠的就是"单发得分跨不过一整档"
test('单发最高得分小于一档里程碑，一次命中不可能跨两档', function () {
    const top = CONFIG.COMBO_TIERS[CONFIG.COMBO_TIERS.length - 1].multiplier;
    // 5a 起类型奖励也算进单发（金色星 +50），取表里最大的一项；5b–5d 加行后这条自动跟着收紧
    const bonus = Math.max(...Array.from(ns.STAR_TYPES, (type) => type.bonus));
    const maxGain = (CONFIG.SCORE_BASE + Math.max(...CONFIG.URGENCY_BONUS) + bonus) * top;
    assert.ok(maxGain < CONFIG.SCORE_MILESTONE, '单发 ' + maxGain + ' 分就能跨档，雨会漏撒');
});

// 暂停面板与结算页都拿这份对象渲染，交出去之后 keeper 再变也不能回写
test('stats 是快照：暂停后 keeper 继续变化不影响已交出的那份', function () {
    const keeper = run(4);
    keeper.hit(500);
    keeper.hit(500);
    const snapshot = keeper.stats();

    keeper.hit(500);
    keeper.crash();

    assert.equal(snapshot.score, 40);
    assert.equal(snapshot.combo, 2);
    assert.equal(snapshot.lives, 4);
    assert.equal(keeper.score, 60);
    assert.equal(keeper.lives, 3);
});
