(function (ns) {
    'use strict';

    const CONFIG = ns.CONFIG;
    const systems = ns.systems = ns.systems || {};

    // 得分、连击、生命与八项统计。不引用 Phaser，所以能在 Node 里直接加载验证
    class ScoreKeeper {
        constructor(options) {
            const opts = options || {};
            this.lives = opts.lives || 0;
            // 严格模式吃开局快照（6c）：设置入口只在菜单，一局之内规则恒定
            this.strict = !!opts.strict;
            this.score = 0;
            this.combo = 0;
            this.maxCombo = 0;
            this.hits = 0;
            this.misses = 0;
            this.crashes = 0;
            this.elapsed = 0;
        }

        // dt 由调用方 clamp 后传入：暂停时场景 update 不跑，切标签页回来也不会补上一大段时间
        tick(dt) {
            this.elapsed += dt;
        }

        // 先加连击再取倍率：第 5 次命中本身就吃 1.5×，HUD 的 "COMBO ×1.5 (5)" 与这一分同时出现
        hit(y, typeBonus) {
            this.combo++;
            if (this.combo > this.maxCombo) { this.maxCombo = this.combo; }
            this.hits++;
            const base = CONFIG.SCORE_BASE + ScoreKeeper.urgencyBonus(y) + (typeBonus || 0);
            const gained = Math.round(base * ScoreKeeper.multiplierFor(this.combo));
            this.score += gained;
            return gained;
        }

        // 按错断连击；严格模式另扣一次基础分（返回实扣量，0 = 没扣），默认不扣分
        miss() {
            this.misses++;
            this.combo = 0;
            return this.penalty();
        }

        // 坠毁断连击并扣一条命，返回本局是否到此为止。坠毁不是"按错"，严格模式也不罚分
        crash() {
            this.crashes++;
            this.combo = 0;
            this.lives--;
            return this.lives <= 0;
        }

        // 误敲黑洞（5b）：扣一条命 + 断连击 + 记一次失误，但不算坠毁——它没落下去，
        // 是玩家主动敲错了对象。准确率按设计的分母（击落 + 失误 + 坠毁，harness/gameplay.md）自然吃到这一次。
        // 它也是"按错"，严格模式与无匹配同罚（6c）
        voidStrike() {
            this.misses++;
            this.combo = 0;
            this.lives--;
            this.penalty();
            return this.lives <= 0;
        }

        // 罚分扣到 0 为止不为负：分数是"击落攒出来的"，不能倒欠
        penalty() {
            if (!this.strict || this.score <= 0) { return 0; }
            const lost = Math.min(CONFIG.STRICT_MISS_PENALTY, this.score);
            this.score -= lost;
            return lost;
        }

        accuracy() {
            const total = this.hits + this.misses + this.crashes;
            return total ? this.hits / total * 100 : 0;
        }

        // 字母/分钟。第一帧 elapsed 还是 0，不能除出 Infinity
        speed() {
            return this.elapsed > 0 ? this.hits / this.elapsed * 60 : 0;
        }

        multiplier() {
            return ScoreKeeper.multiplierFor(this.combo);
        }

        tier() {
            return ScoreKeeper.tierIndex(this.combo);
        }

        // "每 500 分里程碑"（harness/ui.md）。返回的是累计第几个里程碑而不是布尔：一次命中跨两档时
        // 调用方只看"比上次多"，撒雨就不会漏也不会重复
        milestones() {
            return Math.floor(this.score / CONFIG.SCORE_MILESTONE);
        }

        // 前八项是结算页的契约，GameOverScene 的 METRICS 按同名键取值，改键名要同步改那边；
        // 后三项是暂停面板要的即时状态。每次调用都是新对象，交出去之后 keeper 再变也回写不到它
        stats() {
            return {
                score: this.score,
                hits: this.hits,
                misses: this.misses,
                crashes: this.crashes,
                accuracy: this.accuracy(),
                maxCombo: this.maxCombo,
                speed: this.speed(),
                elapsed: this.elapsed,
                combo: this.combo,
                multiplier: this.multiplier(),
                lives: this.lives
            };
        }

        static tierIndex(combo) {
            const tiers = CONFIG.COMBO_TIERS;
            for (let i = tiers.length - 1; i >= 0; i--) {
                if (combo >= tiers[i].at) { return i; }
            }
            return 0;
        }

        static multiplierFor(combo) {
            return CONFIG.COMBO_TIERS[ScoreKeeper.tierIndex(combo)].multiplier;
        }

        static urgencyBonus(y) {
            const bonus = CONFIG.URGENCY_BONUS;
            const zone = Math.floor(y / (CONFIG.HEIGHT / bonus.length));
            return bonus[Math.min(bonus.length - 1, Math.max(0, zone))];
        }
    }

    systems.ScoreKeeper = ScoreKeeper;
})(window.ShootingStars = window.ShootingStars || {});
