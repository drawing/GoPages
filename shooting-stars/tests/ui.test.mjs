import test from 'node:test';
import assert from 'node:assert/strict';

import { load } from './load.mjs';

// 易混字形（8，harness/ui.md）：数字走等宽字体拿斜杠零，字母留在正文字体。
// 两边不能都换成等宽——那只是"两个等宽字体"，类别级线索就没了
const ns = load();
const ui = ns.utils.ui;

test('glyphFamily：十个数字全走等宽字体', function () {
    for (const digit of '0123456789') {
        assert.equal(ui.glyphFamily(digit), ns.CONFIG.MONO);
    }
    assert.notEqual(ns.CONFIG.MONO, ns.CONFIG.FONT);
});

test('glyphFamily：字母与符号仍走正文字体（含与数字易混的那几个）', function () {
    for (const ch of ['o', 'l', 'i', 'z', 's', 'b', 'g', 'q', 'a', 'y']) {
        assert.equal(ui.glyphFamily(ch), ns.CONFIG.FONT);
    }
    // Lv5 符号档：符号的问题是太小不是混淆，不在这次改动里
    for (const ch of ['-', '=', '[', ']', "'", ',', '.', '/', ';']) {
        assert.equal(ui.glyphFamily(ch), ns.CONFIG.FONT);
    }
});
