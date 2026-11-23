(function (ns) {
    'use strict';

    const CONFIG = ns.CONFIG;
    const PALETTE = ns.PALETTE;
    const DEPTH = ns.DEPTH;
    const objects = ns.objects = ns.objects || {};
    const ui = ns.utils.ui;

    const CX = CONFIG.WIDTH / 2;
    const CY = CONFIG.HEIGHT / 2;
    const BUFFER_MS = CONFIG.COUNTDOWN_STEPS * CONFIG.COUNTDOWN_STEP_MS;

    // 开局倒计时（harness/ui.md）：GameScene 已建好但生成器未启动，3-2-1 每秒一个，GO! 那一刻交还控制权。
    // 一条 tween 都不挂、也不用 delayedCall：整条时序吃 GameScene 传下来的 clamp 后 dt，
    // 于是"画面走到哪"与"生成器何时启动"永远是同一个时钟，暂停与切标签页也一起停住
    class Countdown {
        constructor(scene, options) {
            const opts = options || {};
            this.scene = scene;
            this.effects = opts.effects;
            this.onGo = opts.onGo;
            this.audio = ns.systems.audio();
            this.age = 0;
            this.index = -1;
            this.started = false;
            this.done = false;

            this.scrim = scene.add.rectangle(CX, CY, CONFIG.WIDTH, CONFIG.HEIGHT,
                ns.tint(PALETTE.scrim), CONFIG.COUNTDOWN_SCRIM).setDepth(DEPTH.overlay);

            this.digit = ui.text(scene, CX, CY, '', {
                fontSize: CONFIG.COUNTDOWN_SIZE + 'px',
                fontStyle: '700',
                fontFamily: CONFIG.MONO,
                resolution: ns.RENDER_SCALE * CONFIG.COUNTDOWN_SCALE_FROM
            }).setDepth(DEPTH.panel);

            this.go = ui.text(scene, CX, CY, 'GO!', {
                fontSize: CONFIG.COUNTDOWN_GO_SIZE + 'px',
                fontStyle: '800',
                letterSpacing: 6,
                color: PALETTE.gold,
                resolution: ns.RENDER_SCALE * CONFIG.COUNTDOWN_GO_SCALE_TO
            }).setDepth(DEPTH.panel).setVisible(false);

            this.info = this.buildInfo(opts.level, opts.mode, opts.scheme);
            this.showDigit(0);
        }

        // 本局信息条：方案 / 档位 / 模式 / 生命全部来自开局传进来的那份选择，不另读一份状态。
        // 方案名写在这里（9b）：倒计时是"确认自己选了什么"的那一眼，多方案时不能只看见档位
        buildInfo(level, mode, scheme) {
            const scene = this.scene;
            const text = ui.text(scene, 0, 0, ns.schemeById(scheme).name + '方案 · Lv' + level.id + ' ' + level.name +
                ' · ' + ns.modeById(mode).name + ' · 生命 ' + level.lives, {
                fontSize: '15px',
                fontStyle: '600',
                letterSpacing: 1
            });
            const width = text.width + 52;
            const height = 36;
            const band = scene.add.graphics();
            band.fillStyle(ns.tint(PALETTE.overlay), 0.94);
            band.fillRoundedRect(-width / 2, -height / 2, width, height, height / 2);
            band.lineStyle(1, ns.tint(level.accent), 0.55);
            band.strokeRoundedRect(-width / 2, -height / 2, width, height, height / 2);
            return scene.add.container(CX, CONFIG.COUNTDOWN_INFO_Y, [band, text])
                .setDepth(DEPTH.panel)
                .setAlpha(0);
        }

        // 数字换的时候响一声（6b）：3-2-1 一步一音上行，音高读的就是这一步。
        // 构造函数里那次 showDigit(0) 也算——第一声落在倒计时开头，不是等第一秒走完才响
        showDigit(index) {
            this.index = index;
            this.digit.setText(String(CONFIG.COUNTDOWN_STEPS - index))
                .setScale(CONFIG.COUNTDOWN_SCALE_FROM)
                .setAlpha(1);
            this.audio.play('count', { step: index });
        }

        // 距 GO! 还有几秒，只给 GameScene 的 ?debug=1 读数用
        left() {
            return Math.max(0, BUFFER_MS - this.age) / 1000;
        }

        update(dt) {
            if (this.done) { return; }
            this.age += dt * 1000;

            if (this.age < BUFFER_MS) {
                const index = Math.floor(this.age / CONFIG.COUNTDOWN_STEP_MS);
                if (index !== this.index) { this.showDigit(index); }
                const t = (this.age - index * CONFIG.COUNTDOWN_STEP_MS) / CONFIG.COUNTDOWN_STEP_MS;
                const ease = Phaser.Math.Easing.Cubic.Out(t);
                this.digit.setScale(CONFIG.COUNTDOWN_SCALE_FROM +
                    (CONFIG.COUNTDOWN_SCALE_TO - CONFIG.COUNTDOWN_SCALE_FROM) * ease)
                    .setAlpha(1 - t);
                this.info.setAlpha(Math.min(1, this.age / CONFIG.COUNTDOWN_INFO_IN_MS));
                return;
            }

            if (!this.started) { this.beginGo(); }
            const age = this.age - BUFFER_MS;
            if (age >= CONFIG.COUNTDOWN_GO_MS) { this.finish(); return; }

            const pop = Math.min(1, age / CONFIG.COUNTDOWN_GO_POP_MS);
            const fade = Math.max(0, age - CONFIG.COUNTDOWN_GO_POP_MS) /
                (CONFIG.COUNTDOWN_GO_MS - CONFIG.COUNTDOWN_GO_POP_MS);
            this.go.setScale(CONFIG.COUNTDOWN_GO_SCALE_FROM +
                (CONFIG.COUNTDOWN_GO_SCALE_TO - CONFIG.COUNTDOWN_GO_SCALE_FROM) * Phaser.Math.Easing.Cubic.Out(pop))
                .setAlpha(1 - fade);

            // 遮罩与信息条一起淡出，白环在它们下面荡开
            const veil = 1 - Phaser.Math.Easing.Quadratic.Out(Math.min(1, age / CONFIG.COUNTDOWN_FADE_MS));
            this.scrim.fillAlpha = CONFIG.COUNTDOWN_SCRIM * veil;
            this.info.setAlpha(veil);
        }

        // GO! 与生成器启动是同一帧：白环复用 3c 的冲击波（白色那层），不另烤纹理。
        // 声音从 3-2-1 的最后一格再往上扫一个八度，与那三步是同一段旋律的收束
        beginGo() {
            this.started = true;
            this.digit.setVisible(false);
            this.go.setVisible(true);
            this.audio.play('go');
            this.effects.emitRing({ x: CX, y: CY, color: PALETTE.starlight });
            if (this.onGo) { this.onGo(); }
        }

        // 数字与 GO 是两张大字号高分辨率纹理，一局只用一次，走完就释放而不是藏在场上
        finish() {
            this.done = true;
            [this.scrim, this.digit, this.go, this.info].forEach(function (object) { object.destroy(); });
        }
    }

    objects.Countdown = Countdown;
})(window.ShootingStars = window.ShootingStars || {});