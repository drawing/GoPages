(function (ns) {
    'use strict';

    const CONFIG = ns.CONFIG;
    const PALETTE = ns.PALETTE;
    const DEPTH = ns.DEPTH;
    const utils = ns.utils = ns.utils || {};
    const SCRIM = Phaser.Display.Color.HexStringToColor(PALETTE.scrim);

    // 减少动效的门控读取口（6c 设置开关，6d 并系统偏好）：生效值 = 设置活值 ∨ 系统偏好，
    // 触发点每次现查——设置切了立即生效，系统偏好切了也立即跟上，都不用重开
    let motionQuery;
    // 只给设置面板标注"跟随系统"用，门控一律走下面的 reducedMotion()
    utils.systemReducedMotion = function () {
        // MediaQueryList 建一次复用（Backdrop 每帧都问，现造会攒 GC），matches 每次现读——
        // 系统切换时它自己更新。try/catch 包严：老浏览器 / Node 假 window 没有 matchMedia 当"不减"
        if (motionQuery === undefined) {
            motionQuery = null;
            try {
                if (typeof window.matchMedia === 'function') {
                    motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
                }
            } catch (err) { /* 当没有系统偏好 */ }
        }
        return !!(motionQuery && motionQuery.matches);
    };

    utils.reducedMotion = function () {
        return ns.systems.settings().reducedMotion || utils.systemReducedMotion();
    };

    utils.fadeTo = function (scene, key, data) {
        if (scene._ssFading) { return; }
        scene._ssFading = true;
        scene.input.enabled = false;
        const camera = scene.cameras.main;
        camera.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, function () {
            scene.scene.start(key, data);
        });
        camera.fadeOut(CONFIG.FADE_MS, SCRIM.red, SCRIM.green, SCRIM.blue);
    };

    utils.fadeIn = function (scene) {
        scene._ssFading = false;
        scene.input.enabled = true;
        scene.cameras.main.fadeIn(CONFIG.FADE_MS, SCRIM.red, SCRIM.green, SCRIM.blue);
    };

    utils.bindKeys = function (scene, handler) {
        scene.input.keyboard.on('keydown', function (event) {
            if (event.repeat || scene._ssFading || scene.scene.isPaused()) { return; }
            handler(event);
        });
    };

    utils.riseIn = function (scene, targets, options) {
        const opts = options || {};
        const list = [].concat(targets);
        const distance = opts.distance == null ? 14 : opts.distance;
        const alpha = opts.alpha == null ? 1 : opts.alpha;
        list.forEach(function (target, index) {
            const y = target.y;
            target.setY(y + distance).setAlpha(0);
            scene.tweens.add({
                targets: target,
                y: y,
                alpha: alpha,
                duration: opts.duration || 380,
                delay: (opts.delay || 0) + index * (opts.stagger || 0),
                ease: 'Cubic.easeOut'
            });
        });
    };

    // 4b 的菜单入场：从左侧滑入，与 riseIn 同形（距离 / 间隔 / 目标 alpha 可配）
    utils.slideIn = function (scene, targets, options) {
        const opts = options || {};
        const list = [].concat(targets);
        const distance = opts.distance == null ? 36 : opts.distance;
        const alpha = opts.alpha == null ? 1 : opts.alpha;
        list.forEach(function (target, index) {
            const x = target.x;
            target.setX(x - distance).setAlpha(0);
            scene.tweens.add({
                targets: target,
                x: x,
                alpha: alpha,
                duration: opts.duration || 380,
                delay: (opts.delay || 0) + index * (opts.stagger || 0),
                ease: 'Cubic.easeOut'
            });
        });
    };

    // 流星划落（harness/ui.md）：4b 的标题与 4e 的 GAME OVER 共用这一份，只读 scene 的 add / tweens / events，
    // 不依赖任何场景私有状态。位移是一条 Quad.easeIn tween（模拟重力加速）；光尾的发射与淡出
    // 由 update 事件拿 clamp 后的 dt 推——与 Star / TrailPool 同一道闸，暂停与切标签页自动停住。
    // opts.tone 是落地那一声的事件名（6b 的标题上行音阶）：一字一音，step 就是落定的次序；
    // 不传就不出声——GAME OVER 复用同一份划落，那一下是静的
    utils.meteorIn = function (scene, targets, options) {
        const opts = options || {};
        const list = [].concat(targets);
        const stagger = opts.stagger == null ? CONFIG.METEOR_STAGGER_MS : opts.stagger;
        const colors = opts.colors || [];
        const fallback = opts.color || PALETTE.starlight;
        // 每次调用建一个池 + 一个发射器：入场动画是场景级一次性的，随场景 shutdown 统一销毁，
        // 不进运行期借还账目；池满抢最旧是 TrailPool 自己的策略
        const trail = new ns.objects.TrailPool(scene, { size: CONFIG.METEOR_TRAIL_SIZE });
        const sparks = scene.add.particles(0, 0, 'spark', {
            emitting: false,
            frequency: -1,
            reserve: CONFIG.METEOR_SPARKS * list.length,
            maxAliveParticles: CONFIG.METEOR_SPARKS * list.length,
            blendMode: 'ADD',
            speed: { min: CONFIG.FX_SPARK_SPEED_MIN, max: CONFIG.FX_SPARK_SPEED_MAX },
            gravityY: CONFIG.FX_SPARK_GRAVITY,
            lifespan: { min: CONFIG.FX_SPARK_LIFE_MIN, max: CONFIG.FX_SPARK_LIFE_MAX },
            scale: { start: CONFIG.FX_SPARK_SCALE_FROM, end: CONFIG.FX_SPARK_SCALE_TO },
            alpha: { start: 1, end: 0 }
        }).setDepth(DEPTH.particle);

        function land(meteor, index) {
            meteor.landed = true;
            const target = meteor.target;
            const baseX = target.scaleX;
            const baseY = target.scaleY;
            const seg = CONFIG.METEOR_SQUASH_MS / 3;
            flashWhite(scene, target);
            // scaleY 1 → 0.72 → 1.08 → 1，scaleX 取倒数补偿（面积守恒）。三段链式 tween，
            // 末段精确落回基值——文字是预栅格化纹理，停在 1.001 也会一直重采样
            scene.tweens.add({
                targets: target,
                scaleY: baseY * CONFIG.METEOR_SQUASH_DOWN,
                scaleX: baseX / CONFIG.METEOR_SQUASH_DOWN,
                duration: seg,
                ease: 'Quad.easeOut',
                onComplete: function () {
                    scene.tweens.add({
                        targets: target,
                        scaleY: baseY * CONFIG.METEOR_SQUASH_UP,
                        scaleX: baseX / CONFIG.METEOR_SQUASH_UP,
                        duration: seg,
                        ease: 'Quad.easeInOut',
                        onComplete: function () {
                            scene.tweens.add({ targets: target, scaleY: baseY, scaleX: baseX, duration: seg, ease: 'Quad.easeOut' });
                        }
                    });
                }
            });
            sparks.setParticleTint(ns.tint(meteor.color));
            sparks.emitParticleAt(meteor.homeX, meteor.homeY, CONFIG.METEOR_SPARKS);
            if (opts.tone) { ns.systems.audio().play(opts.tone, { step: index }); }
            if (opts.onLand) { opts.onLand(index); }
        }

        const meteors = list.map(function (target, index) {
            const meteor = {
                target: target,
                homeX: target.x,
                homeY: target.y,
                color: colors[index] || fallback,
                flying: false,
                landed: false,
                clock: 0
            };
            target.setPosition(meteor.homeX + CONFIG.METEOR_FROM_X, CONFIG.METEOR_FROM_Y).setAlpha(1);
            scene.tweens.add({
                targets: target,
                x: meteor.homeX,
                y: meteor.homeY,
                duration: CONFIG.METEOR_FALL_MS,
                delay: (opts.delay || 0) + index * stagger,
                ease: 'Quad.easeIn',
                onStart: function () { meteor.flying = true; },
                onComplete: function () { land(meteor, index); }
            });
            return meteor;
        });

        function frame(time, delta) {
            const dt = Math.min(delta, CONFIG.DELTA_MAX) / 1000;
            trail.update(dt);
            for (const meteor of meteors) {
                if (!meteor.flying || meteor.landed) { continue; }
                meteor.clock += dt * 1000;
                if (meteor.clock >= CONFIG.METEOR_TRAIL_GAP_MS) {
                    // 一帧最多一节，欠账不补发（同 Star）：低帧率下宁可少拖几节
                    meteor.clock = 0;
                    trail.emit(meteor.target.x, meteor.target.y, meteor.color, 0);
                }
            }
            if (meteors.every(function (m) { return m.landed; }) &&
                trail.stats().active === 0 && sparks.getAliveParticleCount() === 0) {
                scene.events.off('update', frame);
            }
        }
        scene.events.on('update', frame);
        // shutdown 不清 events 监听，显式摘掉 update 钩子，否则二次进场景会留一个指向已销毁对象的旧钩子
        scene.events.once(Phaser.Scenes.Events.SHUTDOWN, function () {
            scene.events.off('update', frame);
        });
    };

    // 闪白叠一份白色文字拷贝而不是 tintFill：tint 是 WebGL only（Canvas 直接忽略），
    // 且 tintFill 只能硬切、做不出 α 1 → 0。拷贝进原文字所在容器，位置层序与压扁都跟着本体走
    function flashWhite(scene, target) {
        const texts = [];
        (function walk(node) {
            if (node.type === 'Text') { texts.push(node); }
            else if (node.list) { node.list.forEach(walk); }
        })(target);
        texts.forEach(function (node) {
            const copy = scene.add.text(node.x, node.y, node.text, node.style)
                .setOrigin(node.originX, node.originY)
                .setDepth(node.depth)
                .setColor(PALETTE.starlight)
                .setStroke(PALETTE.starlight, node.style.strokeThickness || 0)
                // 3.90 的 Text 没有 disableShadow()，调它会在第一次落地抛 TypeError 打断主循环
                .setShadow(0, 0, '#000', 0, false, false);
            if (node.parentContainer) { node.parentContainer.add(copy); }
            scene.tweens.add({
                targets: copy,
                alpha: 0,
                duration: CONFIG.METEOR_FLASH_MS,
                onComplete: function () { copy.destroy(); }
            });
        });
    }
})(window.ShootingStars = window.ShootingStars || {});