(function (ns) {
    'use strict';

    const CONFIG = ns.CONFIG;
    const utils = ns.utils = ns.utils || {};
    const letters = utils.letters = {};

    // 标准指法：左手 qwert/asdfg/zxcvb + 12345，右手其余。Lv1 的 ';' 与 Lv5 的符号都在右手
    const LEFT_HAND = 'qwertasdfgzxcvb12345';
    const RIGHT_HAND = 'yuiophjkl;nm,./67890-=[]\'';

    const HAND = {};
    for (const key of LEFT_HAND) { HAND[key] = 'L'; }
    for (const key of RIGHT_HAND) { HAND[key] = 'R'; }

    // 英文字母使用频率（%），只覆盖 a–z
    const FREQUENCY = {
        a: 8.167, b: 1.492, c: 2.782, d: 4.253, e: 12.702, f: 2.228, g: 2.015,
        h: 6.094, i: 6.966, j: 0.153, k: 0.772, l: 4.025, m: 2.406, n: 6.749,
        o: 7.507, p: 1.929, q: 0.095, r: 5.987, s: 6.327, t: 9.056, u: 2.758,
        v: 0.978, w: 2.360, x: 0.150, y: 1.974, z: 0.074
    };

    // 数字与符号没有"英文频率"可言，给一档中低频的平权，免得 Lv4/Lv5 里它们盖过字母
    const DIGIT_WEIGHT = 2.2;
    const SYMBOL_WEIGHT = 1.4;

    function weightOf(key) {
        if (FREQUENCY[key] != null) { return FREQUENCY[key]; }
        return key >= '0' && key <= '9' ? DIGIT_WEIGHT : SYMBOL_WEIGHT;
    }

    function weightedPick(list) {
        let total = 0;
        for (const key of list) { total += weightOf(key); }
        let roll = Math.random() * total;
        for (const key of list) {
            roll -= weightOf(key);
            if (roll < 0) { return key; }
        }
        return list[list.length - 1];
    }

    letters.handOf = function (key) {
        return HAND[key] || null;
    };

    letters.weightOf = weightOf;

    // state: { last: 上一次生成的字母, onScreen: 当前在场字母数组, exclude: 绝对不挑的字母数组 }
    // 无候选可用时返回 null，由调用方跳过这次生成，不放宽硬约束
    letters.pickLetter = function (pool, state) {
        const last = state && state.last;
        const onScreen = (state && state.onScreen) || [];
        const exclude = (state && state.exclude) || [];
        const counts = {};
        for (const key of onScreen) { counts[key] = (counts[key] || 0) + 1; }

        const candidates = [];
        for (const key of pool) {
            if (key === last) { continue; }
            if ((counts[key] || 0) >= CONFIG.LETTER_MAX_SAME) { continue; }
            if (exclude.includes(key)) { continue; }
            candidates.push(key);
        }
        if (!candidates.length) { return null; }

        const lastHand = last ? HAND[last] : null;
        if (!lastHand) { return weightedPick(candidates); }

        const same = [];
        const other = [];
        for (const key of candidates) {
            (HAND[key] === lastHand ? same : other).push(key);
        }
        if (!same.length) { return weightedPick(other); }
        if (!other.length) { return weightedPick(same); }
        // 先按 40% 掷同手/异手，再在手内做频率加权：这样同手比例恰好是 40%，
        // 用"给同手候选乘一个系数"的单次加权做不到这一点（比例会随字母池构成漂移）
        return weightedPick(Math.random() < CONFIG.LETTER_SAME_HAND ? same : other);
    };

    // 判定只认物理键位：event.key 会被 Caps Lock、Shift 和输入法改写，event.code 不会。
    // 用 null 原型，免得 'constructor' 这类键名从 Object.prototype 上取到东西
    const CODE_TO_LETTER = Object.create(null);
    for (let i = 0; i < 26; i++) {
        const upper = String.fromCharCode(65 + i);
        CODE_TO_LETTER['Key' + upper] = upper.toLowerCase();
    }
    for (let i = 0; i <= 9; i++) {
        CODE_TO_LETTER['Digit' + i] = String(i);
    }
    // Lv4 的数字池与 Lv5 的符号池要用。存的是不带 Shift 的字符：Shift 改字形不改键位
    Object.assign(CODE_TO_LETTER, {
        Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Quote: "'",
        Semicolon: ';', Comma: ',', Period: '.', Slash: '/'
    });

    // Esc / Enter / 方向键 / 修饰键一律 null，调用方据此把它们排除在失误统计之外
    letters.codeToLetter = function (code) {
        return CODE_TO_LETTER[code] || null;
    };

    // 判定与视觉辅助共用这一份"最低匹配"，1c 的键盘判定直接调它，避免两边算不一致。
    // 9g 起按 `star.nextKeys`（当前待敲键的**集合**）匹配而不是 `star.letter` 单值——
    // 多音字星任一读音都算对，所以它对每个候选键都是目标。单键星 / 单读音星的集合只有一个
    // 元素，逐字退化成原来那句 `star.letter === key`
    letters.lowestMatch = function (stars, key) {
        let target = null;
        for (const star of stars) {
            if (star.nextKeys.indexOf(key) === -1) { continue; }
            if (!target || star.y > target.y) { target = star; }
        }
        return target;
    };

    // 触屏降级（6e）：点列里取半径内圆心最近的那个点（边界含），没有则 null。
    // 点由调用方摊平（GameScene 把每颗星的可见星位摊成 {x, y, letter}），这里不认识 Star——
    // 命中点的字母喂进与键盘同一份 judge()，最低优先消歧因此一行不用改
    letters.tapMatch = function (points, x, y, radius) {
        let best = null;
        let bestDist = radius * radius;
        for (const point of points) {
            const dx = point.x - x;
            const dy = point.y - y;
            const dist = dx * dx + dy * dy;
            if (dist <= bestDist) {
                bestDist = dist;
                best = point;
            }
        }
        return best;
    };

    // 同屏出现重复字母时，最低那颗亮白色描边脉冲；命中目标就是它。
    // **9g 的保守口径**：多音字星有多个候选键，可能只对其中一个是最低（「行」x/h 在上、「好」h
    // 在下 ⇒ 敲 h 掉「好」、敲 x 掉「行」），单个布尔表达不了"对哪个键最低"。所以只在
    // 「对自己**每个**候选键都是最低」且「至少一个候选键与别的星共享」时才亮——它会少亮
    // （上例「行」不亮，尽管敲 x 确实掉它），但绝不撒谎；反过来"对任一候选键最低就亮"会让
    // 两颗同时亮，那是在说"两颗都会掉"。少亮的那颗本来也没有歧义（x 只有它一个），不需要圈。
    // 单键星逐字退化成原来那句：counts[letter] > 1 且我是最低
    letters.markTargets = function (stars) {
        for (const star of stars) {
            let shared = false;
            let lowestForAll = true;
            for (const key of star.nextKeys) {
                if (letters.lowestMatch(stars, key) !== star) {
                    lowestForAll = false;
                    break;
                }
                for (const other of stars) {
                    if (other !== star && other.nextKeys.indexOf(key) !== -1) {
                        shared = true;
                        break;
                    }
                }
            }
            star.setPulse(shared && lowestForAll);
        }
    };
})(window.ShootingStars = window.ShootingStars || {});