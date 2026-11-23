(function (ns) {
    'use strict';

    const CONFIG = ns.CONFIG;
    const DEPTH = ns.DEPTH;
    const objects = ns.objects = ns.objects || {};

    // 残影池（harness/ui.md），独立于星星池：60 节一次建好，之后只借还，运行期不再 new。
    // 淡出由 update(dt) 推而不是每节挂一条 Tween：与 Star 的弹入 / 自转 / 脉冲同理，
    // 吃的是同一道 clamp 后的 dt，暂停与切标签页时自动停住、恢复后接着淡
    class TrailPool {
        constructor(scene, options) {
            const opts = options || {};
            this.size = opts.size || CONFIG.TRAIL_POOL_SIZE;
            this.created = 0;
            this.free = [];
            this.active = [];
            this.boost = false;

            for (let i = 0; i < this.size; i++) {
                this.created++;
                // 用 star 不用 starHi：后者主体是灰阶渐变，tint 后中心压暗，而残影没有
                // starCore 那层白芯兜底，每节中间会留一个暗洞。光尾本就是软的，不需要超采样
                const shape = scene.add.image(0, 0, 'star').setDisplaySize(CONFIG.STAR_SIZE, CONFIG.STAR_SIZE);
                const core = scene.add.image(0, 0, 'starCore').setVisible(false);
                const view = scene.add.container(0, 0, [shape, core])
                    .setDepth(DEPTH.trail)
                    .setActive(false)
                    .setVisible(false);
                this.free.push({ view: view, shape: shape, core: core, age: 0, alpha: 0 });
            }
        }

        // 连击倍率跨到 3.0× 时由 GameScene 每帧喂进来。只影响之后生成的残影，
        // 已在场的那些 300ms 内自然换完，所以整条光尾是渐变亮起来的，不会闪一下
        setBoost(on) {
            this.boost = !!on;
            return this;
        }

        emit(x, y, color, rotation) {
            let ghost = this.free.pop();
            if (ghost) {
                this.active.push(ghost);
            } else {
                // 池满就抢最旧那节：寿命一律 300ms，所以 active[0] 恒是最旧的，
                // 它的 α 已接近 0，抢过来比让新光尾断一节划算。无尽爬升到 1.8× 时
                // 理论需求会超过 60，靠这一手保证总数与累计创建数恒定、且不动态扩容
                ghost = this.active.shift();
                this.active.push(ghost);
            }
            ghost.age = 0;
            ghost.alpha = this.boost ? CONFIG.TRAIL_ALPHA_BOOST : CONFIG.TRAIL_ALPHA;
            ghost.shape.setTint(ns.tint(color));
            ghost.core.setVisible(this.boost);
            // 残影跟着星体一起转那 ±5°，才是"同一个物体的残影"而不是另画一颗星
            ghost.view.setPosition(x, y)
                .setRotation(rotation)
                .setScale(CONFIG.TRAIL_SCALE_FROM)
                .setAlpha(ghost.alpha)
                .setActive(true)
                .setVisible(true);
            return ghost;
        }

        update(dt) {
            const ms = dt * 1000;
            const from = CONFIG.TRAIL_SCALE_FROM;
            const span = CONFIG.TRAIL_SCALE_TO - from;
            const active = this.active;
            for (let i = active.length - 1; i >= 0; i--) {
                const ghost = active[i];
                ghost.age += ms;
                const t = ghost.age / CONFIG.TRAIL_LIFE_MS;
                if (t >= 1) {
                    active.splice(i, 1);
                    ghost.view.setActive(false).setVisible(false);
                    this.free.push(ghost);
                    continue;
                }
                ghost.view.setAlpha(ghost.alpha * (1 - t)).setScale(from + span * t);
            }
        }

        stats() {
            return { active: this.active.length, free: this.free.length, created: this.created };
        }
    }

    objects.TrailPool = TrailPool;
})(window.ShootingStars = window.ShootingStars || {});