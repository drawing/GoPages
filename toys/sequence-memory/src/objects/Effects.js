(function (ns) {
    'use strict';

    const PALETTE = ns.PALETTE;
    const DEPTH = ns.DEPTH;
    const MOTION = ns.MOTION;
    const FX = ns.FX;
    const objects = ns.objects = ns.objects || {};

    // 反馈特效（harness/ui.md 动效契约）：点对涟漪 / 点错抖动 / 全对粒子。视觉列在 1i–3c 逐行落地，
    // 4a 逐行核对无缺口；声音列（开关门控 / 四音调 / 预览）随 4a 补齐，在 systems/Audio。
    // 全部走 tween：paused 的场景 tween 不推进，暂停自动冻住；物件随场景销毁，不缓存跨局状态。
    // 抖动不用 camera.shake——它改 scrollX/Y，而本作的 scroll 是布局基准（1g 定案）：
    // 抖玩法区容器的 x，抖完归零。hit stop 不在这里，它是 GameScene 的 fail 节拍推迟量
    objects.effects = function (scene) {
        // 减少动效（4b，harness/ui.md）：涟漪 / 抖动 / 粒子三件全是装饰性运动，整组砍掉。
        // 点对 / 点错的信息由格子亮起 / 危险色 / 进度点承担，一条不丢；发射器也不建了
        if (ns.utils.reducedMotion()) {
            const noop = function () {};
            return { ripple: noop, shake: noop, burst: noop };
        }
        // 全场唯一一个发射器：每次全对只 emitParticleAt，emitting:false 时已发出的粒子仍走完。
        // tint 给数组 = 每颗随机取一色，一簇粒子自带四色（Phaser 的 EmitterOp 数组语义）
        const sparks = scene.add.particles(0, 0, 'spark', {
            emitting: false,
            speed: { min: FX.sparkSpeed[0], max: FX.sparkSpeed[1] },
            gravityY: FX.sparkGravity,
            lifespan: { min: FX.sparkLife[0], max: FX.sparkLife[1] },
            scale: { start: 1, end: 0 },
            alpha: { start: 1, end: 0 },
            blendMode: 'ADD',
            tint: ns.COLORS.map(function (color) { return ns.tint(color.hex); })
        }).setDepth(DEPTH.fx);

        // 点对：一圈涟漪环从色块上扩散出去。短命物件用完即毁——它不是常驻状态的一部分，
        // 是事件的一次性回响，不进 sync 的目标状态（harness/ui.md管的是状态，不是特效）
        function ripple(x, y, hex, size) {
            const ring = scene.add.image(x, y, 'ring')
                .setDisplaySize(size, size)
                .setTint(ns.tint(hex))
                .setDepth(DEPTH.fx)
                .setScale(FX.rippleFrom);
            scene.tweens.add({
                targets: ring, scale: FX.rippleTo, alpha: 0,
                duration: MOTION.ripple, ease: 'Quad.easeOut',
                onComplete: function () { ring.destroy(); }
            });
        }

        // 点错：±shakeAmp px 两来回，振幅随时间收敛。sin(t·4π) 正好两个完整周期，
        // onComplete 显式归零——浮点尾差不归零的话，玩法区会永久偏出布局基准几个像素
        function shake(target) {
            const baseX = target.x;
            const proxy = { t: 0 };
            scene.tweens.add({
                targets: proxy, t: 1, duration: MOTION.shake, ease: 'Linear',
                onUpdate: function () {
                    target.x = baseX + FX.shakeAmp * Math.sin(proxy.t * Math.PI * 4) * (1 - proxy.t);
                },
                onComplete: function () { target.x = baseX; }
            });
        }

        // 全对：一小簇四色粒子从玩法区中心爆开（12–20 颗，harness/ui.md）
        function burst(x, y) {
            sparks.emitParticleAt(x, y, Phaser.Math.Between(FX.sparkCount[0], FX.sparkCount[1]));
        }

        return { ripple: ripple, shake: shake, burst: burst };
    };
})(window.SequenceMemory = window.SequenceMemory || {});