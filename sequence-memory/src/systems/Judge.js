(function (ns) {
    'use strict';

    const systems = ns.systems = ns.systems || {};

    // 两模式同走即点即判：每点一次立刻出结论，错的那一下就是本局终点（harness/gameplay.md）。
    // 退格 / 整条判定 / 容错评估过不做（harness/requirements.md 3b），以后真有诉求再开阶段。
    // 倒序（3c）只改这里的期望顺序：呈现仍正序（生成器永远给正序），复现从最后一项点起。
    // compare / wrongAt 随之按复现顺序对齐——结算逐位回放画的就是"该怎么点"，不是"播了什么"
    systems.Judge = {
        create: function (opts) {
            const expected = opts.sequence.slice();
            if (opts.direction === 'backward') { expected.reverse(); }
            const inputs = [];
            let wrongAt = null;

            function cleared() { return wrongAt === null && inputs.length === expected.length; }
            function failed() { return wrongAt !== null; }

            return {
                // 判定已定之后返回 null：连点的那几下不算数，也不覆盖已经定下的结论
                tap: function (symbol) {
                    if (cleared() || failed()) { return null; }
                    const at = inputs.length;
                    inputs.push(symbol);
                    if (symbol !== expected[at]) { wrongAt = at; }
                    return {
                        ok: !failed(),
                        step: inputs.length,
                        cleared: cleared(),
                        failed: failed()
                    };
                },
                // 一律给拷贝：界面拿到的输入被改动也不会污染判定基准与结算对照
                inputs: function () { return inputs.slice(); },
                // 逐位对照按位置对齐，长度以正确序列为准。冲榜出错即停，错处之后没有输入，
                // 这些位是 missed 而不是 bad——把"没点到"画成"点错了"会冤枉玩家
                compare: function () {
                    return expected.map(function (symbol, at) {
                        const entered = at < inputs.length;
                        const actual = entered ? inputs[at] : null;
                        return {
                            at: at,
                            expected: symbol,
                            actual: actual,
                            state: !entered ? 'missed' : (actual === symbol ? 'ok' : 'bad')
                        };
                    });
                },
                step: function () { return inputs.length; },
                wrongAt: function () { return wrongAt; },
                cleared: cleared,
                failed: failed,
                settled: function () { return cleared() || failed(); }
            };
        }
    };
})(window.SequenceMemory = window.SequenceMemory || {});