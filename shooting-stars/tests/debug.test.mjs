import test from 'node:test';
import assert from 'node:assert/strict';

import { load } from './load.mjs';

// 开发读数开关是浏览器边界（同 touchDevice 一类）：location 读假 window 注入，
// 缺省什么都不补——"缺失 API 自己降级"本身就是契约（load.mjs 的约定）
test('debugMode：缺 location 或查询串为空时一律当关', function () {
    assert.equal(load().utils.debugMode(), false);
    assert.equal(load({ location: {} }).utils.debugMode(), false);
    assert.equal(load({ location: { search: '' } }).utils.debugMode(), false);
    assert.equal(load({ location: { search: '?foo=2' } }).utils.debugMode(), false);
});

test('debugMode：只认精确的 debug=1，位置不限', function () {
    assert.equal(load({ location: { search: '?debug=1' } }).utils.debugMode(), true);
    assert.equal(load({ location: { search: '?foo=2&debug=1' } }).utils.debugMode(), true);
    assert.equal(load({ location: { search: '?debug=1&foo=2' } }).utils.debugMode(), true);
    // debug=0 / debug=10 / xdebug=1 都不算：读数开关宁可不亮，不误亮
    assert.equal(load({ location: { search: '?debug=0' } }).utils.debugMode(), false);
    assert.equal(load({ location: { search: '?debug=10' } }).utils.debugMode(), false);
    assert.equal(load({ location: { search: '?xdebug=1' } }).utils.debugMode(), false);
});