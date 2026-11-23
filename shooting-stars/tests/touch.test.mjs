import test from 'node:test';
import assert from 'node:assert/strict';

import { load } from './load.mjs';

// 触屏检测是浏览器边界（同 systemReducedMotion 一类）：信号读假 window 注入，
// 缺省什么都不补——"缺失 API 自己降级"本身就是契约（load.mjs 的约定）
test('touchDevice：没有任何触摸信号时当纯键盘设备', function () {
    assert.equal(load().utils.touchDevice(), false);
    assert.equal(load({ navigator: { maxTouchPoints: 0 } }).utils.touchDevice(), false);
});

test('touchDevice：maxTouchPoints > 0 或 ontouchstart 任一命中就是触屏', function () {
    assert.equal(load({ navigator: { maxTouchPoints: 5 } }).utils.touchDevice(), true);
    assert.equal(load({ ontouchstart: null }).utils.touchDevice(), true);
    // 老 iOS 没有 maxTouchPoints，ontouchstart 兜底；两个信号都有（触屏笔记本）也只算一次
    assert.equal(load({ navigator: { maxTouchPoints: 0 }, ontouchstart: null }).utils.touchDevice(), true);
    assert.equal(load({ navigator: { maxTouchPoints: 2 }, ontouchstart: null }).utils.touchDevice(), true);
});