(function (ns) {
    'use strict';

    const systems = ns.systems = ns.systems || {};

    // 标准正态分布函数的多项式近似（Zelen & Severo 1964，即 Abramowitz & Stegun 26.2.17），
    // |误差| < 1e-7——比"报一个整数百分位"精确五个数量级。不引数学库（AGENTS 依赖默认值），
    // 也不存查表：表要几百个数还得插值，这七行是同一份精度
    const CDF_COEFFS = [0.319381530, -0.356563782, 1.781477937, -1.821255978, 1.330274429];

    function normalCdf(z) {
        const x = Math.abs(z);
        const t = 1 / (1 + 0.2316419 * x);
        const density = Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
        let poly = 0;
        for (let i = CDF_COEFFS.length - 1; i >= 0; i -= 1) { poly = (poly + CDF_COEFFS[i]) * t; }
        const upper = 1 - density * poly;
        // 近似式只在 x ≥ 0 上成立，负半轴靠对称性折过来
        return z >= 0 ? upper : 1 - upper;
    }

    // 这一 类型 × 方向 有没有可用常模。**sd 缺失（null）就是没有**（config NORMS 的定案）：
    // 只有均值算不出 z，编一个离散度比不给百分位更糟。交出去的是 config 里那一份（只读）
    function normOf(typeId, directionId) {
        const table = ns.NORMS[ns.typeById(typeId).id];
        if (!table) { return null; }
        const norm = table[ns.directionById(directionId).id];
        return norm && typeof norm.mean === 'number' && norm.sd > 0 ? norm : null;
    }

    // 百分位 = 1–99 的整数，正态 z 分数换算（harness/requirements.md #5）。
    // score ≤ 0 视同没有成绩（与 bestOf / 卡片"–"同一份口径），不给百分位。
    // 两端夹住：说"第 100 百分位"等于说比所有人都强，这份近似数据撑不起那句话，说"第 0"同理。
    // 天花板效应认下、不另做映射（harness/gameplay.md 难度节）
    function percentile(typeId, directionId, score) {
        const norm = normOf(typeId, directionId);
        if (!norm || !(score > 0)) { return null; }
        const z = (score - norm.mean) / norm.sd;
        return Math.min(99, Math.max(1, Math.round(normalCdf(z) * 100)));
    }

    // 无常模的类型（颜色 / 扑克）改"历史第几好"：在这一份成绩里排第几，**并列取较好的名次**
    //（两个 7 都是第 1 好，与竞赛名次同一条口径）。少于两局返回 null——只有一局时"第 1 好"
    // 不是信息，是新玩家的第一局；score ≤ 0 同理。scores 是数字数组，谁的历史由调用方决定
    function rankIn(score, scores) {
        if (!(score > 0) || !scores || scores.length < 2) { return null; }
        let better = 0;
        scores.forEach(function (value) {
            if (value > score) { better += 1; }
        });
        return better + 1;
    }

    // 常模参照（5d）。两种参照收在同一处，因为它们是同一个位置上的同一句话：有公开常模的
    // 类型查百分位，没有的改跟自己比。纯逻辑不碰 Phaser / DOM（AGENTS 分层红线），
    // 交出去的是数字不是字符串——措辞与格式化归场景（5b 的口径）
    systems.Norms = {
        normalCdf: normalCdf,
        normOf: normOf,
        percentile: percentile,
        rankIn: rankIn
    };
})(window.SequenceMemory = window.SequenceMemory || {});
