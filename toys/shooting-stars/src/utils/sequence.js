(function (ns) {
    'use strict';

    const utils = ns.utils = ns.utils || {};
    const sequence = utils.sequence = {};

    // 键序引擎（9d，harness/gameplay.md 键序判定节）：一颗星的内容 = 一串按键。
    // 普通字母星是单键特例，双星是两键特例，9e/9f 的序列星是多键单体。
    // **9g 起一颗星可以带一组读音**（多音字任一读音都算对，harness/gameplay.md 多音字节）：
    // 状态 = { paths, depth }——paths 是**仍然存活的那几条读音**，每敲对一键就按它过滤一次，
    // 于是"敲对第一键就锁定那条读音"是过滤的自然结果而不是额外规则；depth 是已敲对的键数。
    // 判定与白圈读 nextKeys（当前 depth 上的候选键集合），所以 letters.js 不必认识键序长度。
    // 收字只收**各读音等长**的多音字（config.test 逐字钉），于是 total 恒有定义、
    // isLast 的"某条路径到尽头"不会有歧义、进度点总数与单音字一模一样。纯逻辑，Node 可测。
    //
    // create 认两种入参：键位方案传一串键 ['h','a','o']（一条 path），
    // 单元方案传一组读音 [['x','i','n','g'], ['h','a','n','g']]（多条 path）
    sequence.create = function (content) {
        const paths = [];
        if (content && content.length && Array.isArray(content[0])) {
            for (const path of content) { paths.push(Array.prototype.slice.call(path)); }
        } else {
            paths.push(Array.prototype.slice.call(content || []));
        }
        return { paths: paths, depth: 0 };
    };

    // 当前待敲键的**集合**（去重，按读音表顺序）：单键星与单读音星只有一个元素，
    // 多音字星每条存活读音各给一个。判定（lowestMatch）与白圈（markTargets）都读它
    sequence.nextKeys = function (seq) {
        const keys = [];
        for (const path of seq.paths) {
            const key = path[seq.depth];
            if (key !== undefined && keys.indexOf(key) === -1) { keys.push(key); }
        }
        return keys;
    };

    // 再下一键：键位方案的生成侧数"同屏同字母"要把双星还没轮到那颗一起算，读数解释
    // "顺序敲错"也用它。多读音下取规范路径（paths[0]）的那一键——单元方案的生成侧只数
    // nextKeys（每个候选键都占名额），不读它
    sequence.pendingKey = function (seq) {
        const path = seq.paths[0];
        return path && seq.depth + 1 < path.length ? path[seq.depth + 1] : null;
    };

    // 敲完这一键是否就击落：**某条**存活读音到尽头了就算（最短匹配）。
    // 等长约束下所有存活路径同时到尽头，所以"某条"就是"每条"，不存在提前消除
    sequence.isLast = function (seq) {
        for (const path of seq.paths) {
            if (path.length === seq.depth + 1) { return true; }
        }
        return false;
    };

    // 进度点那一排的总格数（Star.drawPips 与 ?debug 读数读它）。等长约束下任取一条路径都对
    sequence.total = function (seq) {
        return seq.paths.length ? seq.paths[0].length : 0;
    };

    // 敲对一键：按这个键过滤存活读音，推进一格，返回是否敲完。只前进不回退——敲错由判定层
    // 走 miss 分支，绝不进这里。真收到不匹配的键就返回 false 且**不改状态**（判定层已先匹配过，
    // 走不到这一支；改了状态反而会把一颗好星弄坏）
    sequence.advance = function (seq, key) {
        const survivors = [];
        for (const path of seq.paths) {
            if (path[seq.depth] === key) { survivors.push(path); }
        }
        if (!survivors.length) { return false; }
        seq.paths = survivors;
        seq.depth += 1;
        return seq.depth >= seq.paths[0].length;
    };

    // 这个键是不是这颗星「还没轮到」的后续键（顺序错诊断用）：敲它等于无匹配记失误，
    // 但读数要说清是顺序问题而不是屏幕上没这个键。看**全部存活读音**、只看进度之后，敲过的不算
    sequence.isLaterKey = function (seq, key) {
        for (const path of seq.paths) {
            for (let i = seq.depth + 1; i < path.length; i++) {
                if (path[i] === key) { return true; }
            }
        }
        return false;
    };
})(window.ShootingStars = window.ShootingStars || {});
