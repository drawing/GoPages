import test from 'node:test';
import assert from 'node:assert/strict';

import { load } from './load.mjs';

// 6d 的挂起恢复状态机（声音合成不进测试，AGENTS 验证边界；这里只验恢复的门控逻辑）。
// 假 AudioContext 鸭子类型：state + resume()，与真 API 的最小接触面一致
function fakeAC(initial) {
    return class {
        constructor() {
            this.state = initial;
            this.resumes = 0;
            this.destination = {};
        }
        createGain() {
            return { gain: { value: 0 }, connect() {} };
        }
        resume() {
            this.resumes++;
            this.state = 'running';
        }
    };
}

test('手势之前不建 ctx：resume 空转，unlock 才建并恢复', function () {
    const local = load({ AudioContext: fakeAC('suspended') });
    const audio = new local.systems.AudioSys();
    audio.resume();
    assert.equal(audio.ctx, null, '没手势不该建 ctx（自动播放警告那条坑）');
    audio.unlock();
    assert.ok(audio.ctx);
    assert.equal(audio.ctx.resumes, 1);
    assert.equal(audio.ctx.state, 'running');
});

test('挂起恢复：suspended / interrupted 都 resume，running / closed 不动', function () {
    const local = load({ AudioContext: fakeAC('suspended') });
    const audio = new local.systems.AudioSys();
    audio.unlock();
    const ctx = audio.ctx;

    for (const state of ['suspended', 'interrupted']) {
        ctx.state = state;
        const before = ctx.resumes;
        audio.resume();
        assert.equal(ctx.resumes, before + 1, state + ' 应当 resume');
        assert.equal(ctx.state, 'running');
    }

    const before = ctx.resumes;
    audio.resume();
    assert.equal(ctx.resumes, before, 'running 不重复 resume');

    ctx.state = 'closed';
    audio.resume();
    assert.equal(ctx.resumes, before, 'closed 不 resume（会抛异常）');
});