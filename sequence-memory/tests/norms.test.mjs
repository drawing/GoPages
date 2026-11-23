import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const ns = load();
const Norms = ns.systems.Norms;

// 换算的全部精度都在分布函数上：先钉它，再钉由它推出来的百分位
test('正态分布函数：0 处 0.5、±1.96 处 2.5% / 97.5%、两侧对称且单调', () => {
    const cdf = Norms.normalCdf;
    assert.ok(Math.abs(cdf(0) - 0.5) < 1e-6);
    assert.ok(Math.abs(cdf(1) - 0.8413) < 1e-3);
    assert.ok(Math.abs(cdf(1.96) - 0.975) < 1e-3);
    assert.ok(Math.abs(cdf(-1.96) - 0.025) < 1e-3);
    for (const z of [-3, -1.5, -0.4, 0.4, 1.5, 3]) {
        assert.ok(Math.abs(cdf(z) + cdf(-z) - 1) < 1e-6, `对称性 z=${z}`);
        assert.ok(cdf(z) < cdf(z + 0.25), `单调 z=${z}`);
        assert.ok(cdf(z) > 0 && cdf(z) < 1);
    }
});

// 5d 的验收点：数字 6–7 要落在合理区间（不是 1 也不是 99），换算才对得上常模
test('数字 6–7 落在合理区间：均值处正好第 50，倒序按倒序那一格常模算', () => {
    const forward = (score) => Norms.percentile('digit', 'forward', score);
    const backward = (score) => Norms.percentile('digit', 'backward', score);

    assert.equal(forward(7), 50);                 // 常模均值本身就是中位数
    assert.ok(forward(6) >= 20 && forward(6) <= 35, `数字正序 6 → ${forward(6)}`);
    assert.ok(forward(8) >= 65 && forward(8) <= 80, `数字正序 8 → ${forward(8)}`);
    assert.equal(backward(5), 50);
    assert.ok(backward(6) >= 65 && backward(6) <= 80, `数字倒序 6 → ${backward(6)}`);

    // 同一个分数在倒序常模下更高：倒序均值低 2 项，挑战档读的必须是这一份
    assert.ok(backward(6) > forward(6));

    // 单调：分数越高百分位越高，不允许倒挂（近似式的多项式尾巴不能有起伏）
    let previous = 0;
    for (let score = 2; score <= 14; score += 1) {
        const value = forward(score);
        assert.ok(value >= previous, `单调性 score=${score}`);
        previous = value;
    }
});

test('两端夹在 1 / 99：天花板效应认下，不说"第 100 百分位"', () => {
    assert.equal(Norms.percentile('digit', 'forward', 40), 99);
    assert.equal(Norms.percentile('position', 'forward', 1), 1);
    // eCorsi 正序均值 6.11、标准差 0.80：6 项就在中位数下面一点，不是"垫底"也不是"拔尖"
    const six = Norms.percentile('position', 'forward', 6);
    assert.ok(six >= 40 && six <= 50, `位置正序 6 → ${six}`);
    assert.ok(Norms.percentile('position', 'forward', 7) >= 80);
});

test('没有常模的一律 null：颜色 / 扑克、0 分、未知 id 各自回落默认档', () => {
    assert.equal(Norms.normOf('color', 'forward'), null);
    assert.equal(Norms.normOf('card', 'backward'), null);
    assert.equal(Norms.percentile('color', 'forward', 8), null);
    assert.equal(Norms.percentile('card', 'forward', 5), null);

    // 0 分是"没有成绩"（与 bestOf / 卡片"–"同一份口径），不是"垫底"
    assert.equal(Norms.percentile('digit', 'forward', 0), null);
    assert.equal(Norms.percentile('digit', 'forward', -3), null);

    // 未知 id 走 finder 语义回落：type 回落到颜色（无常模），direction 回落到正序
    assert.equal(Norms.percentile('nope', 'forward', 7), null);
    assert.equal(Norms.percentile('digit', 'nope', 7), 50);
    assert.equal(Norms.normOf('digit', 'forward').mean, ns.NORMS.digit.forward.mean);
});

test('历史第几好：并列取较好名次，不足两局 / 0 分不给', () => {
    assert.equal(Norms.rankIn(7, [5, 7, 6]), 1);
    assert.equal(Norms.rankIn(6, [5, 7, 6]), 2);
    assert.equal(Norms.rankIn(5, [5, 7, 6]), 3);
    assert.equal(Norms.rankIn(7, [7, 7, 7]), 1);      // 并列最高都是"第 1 好"
    assert.equal(Norms.rankIn(9, [5, 7, 6, 9]), 1);   // 新高分排第一
    assert.equal(Norms.rankIn(4, [5, 7, 6]), 4);      // 比全部差 = 名次在末尾
    assert.equal(Norms.rankIn(7, [7]), null);         // 只有一局："第 1 好"不是信息
    assert.equal(Norms.rankIn(7, []), null);
    assert.equal(Norms.rankIn(0, [0, 5]), null);      // 0 分没有成绩可比
});
