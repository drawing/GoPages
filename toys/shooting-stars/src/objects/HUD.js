(function (ns) {
    'use strict';

    const CONFIG = ns.CONFIG;
    const PALETTE = ns.PALETTE;
    const DEPTH = ns.DEPTH;
    const objects = ns.objects = ns.objects || {};
    const ui = ns.utils.ui;

    // 顶条 52px、地平线 552，左下角常驻读数放在地平线下的地面带里（harness/ui.md）
    const BAR_HEIGHT = CONFIG.HUD_BAR_HEIGHT;
    const ROW_TOP = 18;
    const ROW_BOTTOM = 38;
    const GUTTER = 28;
    const RUN_STATS_Y = 561;
    // 轨道右沿 450，右边那行爬升读数最长约 280px（左沿 ≈ 492），两者不会打架
    const TRACK = { x: 150, y: 34, width: 300, height: 8 };
    const BANNER = { y: 150, width: 460, height: 52 };
    const LIFE_GAP = 24;
    const LIFE_SCALE = 0.3;
    // 倍率档的强调色，与光尾加亮 / 飘分转金共用 3× 那道金线
    const COMBO_COLORS = [PALETTE.hudMuted, PALETTE.info, PALETTE.success, PALETTE.gold, PALETTE.gold];

    // 顶条（harness/ui.md）：分数滚动、combo 弹跳、分格爬升条。生命碎裂在 3e，天空变暗在 Backdrop.setDanger
    class HUD {
        constructor(scene, options) {
            const opts = options || {};
            this.scene = scene;
            this.level = opts.level;
            this.mode = opts.mode;
            this.modeDef = ns.modeById(this.mode);
            this.accent = this.level.accent;
            this.lives = this.level.lives;
            this.combo = 0;
            this.tier = 0;
            // 滚动值与目标值分开存：连打时从"当前显示到哪儿"接着滚，而不是每击都从上一个目标重跳
            this.scoreRoll = { value: 0 };
            this.scoreTarget = 0;
            this.fillRoll = { value: 0 };
            this.fillTarget = 0;
            this.fillGold = false;

            this.buildBar();
            this.buildCombo();
            this.buildClimb();
            this.buildBanner();
            this.buildRunStats();
        }

        buildBar() {
            const scene = this.scene;
            const width = CONFIG.WIDTH;
            scene.add.image(0, 0, 'hudBar')
                .setOrigin(0)
                .setDisplaySize(width, BAR_HEIGHT + CONFIG.HUD_BAR_SKIRT)
                .setDepth(DEPTH.hud);
            // 下沿一条本档强调色的细线：顶条与游戏区的分界，也是这一局难度的颜色提示
            scene.add.rectangle(width / 2, BAR_HEIGHT, width, 1, ns.tint(this.accent), 0.5).setDepth(DEPTH.hud);

            ui.text(scene, GUTTER, ROW_TOP, 'SCORE', {
                fontSize: '11px',
                color: PALETTE.hudMuted,
                letterSpacing: 2
            }).setOrigin(0, 0.5).setDepth(DEPTH.hud);

            this.scoreText = ui.text(scene, GUTTER + 64, ROW_TOP, '0', {
                fontSize: '20px',
                fontStyle: '700',
                fontFamily: CONFIG.MONO
            }).setOrigin(0, 0.5).setDepth(DEPTH.hud);

            this.lifeIcons = [];
            for (let i = 0; i < this.level.lives; i++) {
                const icon = scene.add.image(width - GUTTER - i * LIFE_GAP, ROW_TOP, 'star')
                    .setScale(LIFE_SCALE)
                    .setTint(ns.tint(PALETTE.gold))
                    .setDepth(DEPTH.hud);
                // 抖动是"回到 baseX"的绝对位移，不是 '+='：连丢两条命才会各抖各的、不越推越歪
                icon.baseX = icon.x;
                this.lifeIcons.push(icon);
            }

            const levelText = ui.text(scene, GUTTER, ROW_BOTTOM, 'Lv' + this.level.id + ' ' + this.level.name, {
                fontSize: '12px',
                fontStyle: '600',
                color: this.accent
            }).setOrigin(0, 0.5).setDepth(DEPTH.hud);

            ui.text(scene, GUTTER + levelText.width + 8, ROW_BOTTOM, '· ' + this.modeDef.name, {
                fontSize: '12px',
                color: PALETTE.hudMuted
            }).setOrigin(0, 0.5).setDepth(DEPTH.hud);
        }

        // 三段文字 + 一层辉光收进一个 container：弹跳只 tween 这一个对象，整组一起缩放
        buildCombo() {
            const scene = this.scene;
            this.comboGlow = scene.add.image(0, 0, 'glow').setScale(1.15, 0.28).setAlpha(0);
            this.comboLabel = ui.text(scene, 0, 0, 'COMBO', {
                fontSize: '10px',
                color: PALETTE.hudMuted,
                letterSpacing: 2
            }).setOrigin(0, 0.5);
            this.comboMult = ui.text(scene, 0, 0, '×1', {
                fontSize: '19px',
                fontStyle: '700',
                fontFamily: CONFIG.MONO,
                color: PALETTE.hudMuted
            }).setOrigin(0, 0.5);
            this.comboCount = ui.text(scene, 0, 0, '(0)', {
                fontSize: '12px',
                fontFamily: CONFIG.MONO,
                color: PALETTE.hudMuted
            }).setOrigin(0, 0.5);

            this.comboBox = scene.add.container(CONFIG.WIDTH / 2, ROW_TOP,
                [this.comboGlow, this.comboLabel, this.comboMult, this.comboCount]).setDepth(DEPTH.hud);
            this.layoutCombo();
        }

        buildClimb() {
            const scene = this.scene;
            const climb = this.modeDef.climb;
            const radius = TRACK.height / 2;
            const track = scene.add.graphics().setDepth(DEPTH.hud);
            // 闯关模式没有进度可言，轨道留成一条暗色的"禁用"轨，不画刻度也不填充
            track.fillStyle(ns.tint(PALETTE.overlay), climb ? 0.85 : 0.5);
            track.fillRoundedRect(TRACK.x, TRACK.y, TRACK.width, TRACK.height, radius);
            track.lineStyle(1, ns.tint(PALETTE.surfaceEdge), climb ? 0.7 : 0.32);
            track.strokeRoundedRect(TRACK.x, TRACK.y, TRACK.width, TRACK.height, radius);

            // 轨道 → 填充 → 刻度三层：刻度压在最上，填满了也数得出这是第几格
            this.trackFill = scene.add.graphics().setDepth(DEPTH.hud);
            if (climb) {
                const ticks = scene.add.graphics().setDepth(DEPTH.hud);
                // 比轨道亮、比填充暗：空格子数得出还差几击，填满了也还看得出这是第几格
                ticks.fillStyle(ns.tint(PALETTE.surfaceEdge), 0.55);
                for (let i = 1; i < CONFIG.CLIMB.every; i++) {
                    ticks.fillRect(TRACK.x + TRACK.width * i / CONFIG.CLIMB.every, TRACK.y + 1.5, 1, TRACK.height - 3);
                }
            }

            this.climbText = ui.text(scene, CONFIG.WIDTH - GUTTER, ROW_BOTTOM, '', {
                fontSize: '11px',
                fontFamily: CONFIG.MONO,
                color: PALETTE.hudMuted
            }).setOrigin(1, 0.5).setDepth(DEPTH.hud).setAlpha(climb ? 0.8 : 0.6);
        }

        // 横幅整体收进一个 container：淡入淡出与缩放只 tween 这一个对象
        buildBanner() {
            const scene = this.scene;
            const band = scene.add.graphics();
            band.fillStyle(ns.tint(PALETTE.overlay), 0.86);
            band.fillRoundedRect(-BANNER.width / 2, -BANNER.height / 2, BANNER.width, BANNER.height, 10);
            band.lineStyle(1, ns.tint(PALETTE.gold), 0.34);
            band.strokeRoundedRect(-BANNER.width / 2, -BANNER.height / 2, BANNER.width, BANNER.height, 10);

            const title = ui.text(scene, 0, -8, 'LEVEL UP', {
                fontSize: '21px',
                fontStyle: '700',
                color: PALETTE.gold,
                letterSpacing: 6
            });
            this.bannerSub = ui.text(scene, 0, 14, '', {
                fontSize: '12px',
                fontFamily: CONFIG.MONO,
                color: PALETTE.hudMuted
            });

            this.banner = scene.add.container(CONFIG.WIDTH / 2, BANNER.y, [band, title, this.bannerSub])
                .setDepth(DEPTH.hud)
                .setAlpha(0)
                .setVisible(false);
        }

        // 左下角常驻这一行准确率与手速；?debug=1 的开发读数排在它下面（y=575 / 589，GameScene 建）
        buildRunStats() {
            this.runText = ui.text(this.scene, GUTTER, RUN_STATS_Y, '', {
                fontSize: '12px',
                fontFamily: CONFIG.MONO,
                color: PALETTE.hudMuted
            }).setOrigin(0, 0.5).setDepth(DEPTH.hud).setAlpha(0.9);
        }

        // setText 会比对新旧字符串，值没变时不重栅格化，所以这里不做差分：
        // 每次判定 / 坠毁与 250ms 定时器都全量刷一遍。progress 是 director.progress()
        sync(keeper, progress) {
            this.rollScore(keeper.score);
            this.setCombo(keeper.combo, keeper.multiplier(), keeper.tier());
            this.runText.setText('准确率 ' + keeper.accuracy().toFixed(1) + '% · 手速 ' + Math.round(keeper.speed()) + '/min');
            this.setLives(keeper.lives);
            this.drawClimb(progress);
        }

        // 5.7：分数 200ms 滚上去而不是直接赋值。滚动值就是屏幕上那个数，
        // 顶条与飘分短暂对不上是有意的——飘分给的是这一击的增量，顶条正在追
        rollScore(target) {
            if (target === this.scoreTarget) { return; }
            this.scoreTarget = target;
            const tweens = this.scene.tweens;
            tweens.killTweensOf(this.scoreRoll);
            tweens.add({
                targets: this.scoreRoll,
                value: target,
                duration: CONFIG.HUD_SCORE_ROLL_MS,
                ease: 'Cubic.easeOut',
                onUpdate: () => this.paintScore(),
                onComplete: () => {
                    this.scoreRoll.value = target;
                    this.paintScore();
                }
            });
        }

        paintScore() {
            this.scoreText.setText(String(this.shownScore()));
        }

        shownScore() {
            return Math.round(this.scoreRoll.value);
        }

        setCombo(combo, multiplier, tier) {
            const grew = combo > this.combo;
            const broke = this.combo > 0 && combo === 0;
            this.combo = combo;
            this.tier = tier;
            this.comboMult.setText('×' + multiplier);
            this.comboCount.setText('(' + combo + ')');
            this.layoutCombo();
            this.paintCombo();
            if (grew) { this.popCombo(); } else if (broke) { this.breakCombo(); }
        }

        // 倍率与连击数的字宽一直在变，每次重新居中：固定偏移会让整组左右抖
        layoutCombo() {
            const total = this.comboLabel.width + 8 + this.comboMult.width + 6 + this.comboCount.width;
            let x = -total / 2;
            this.comboLabel.setX(x);
            x += this.comboLabel.width + 8;
            this.comboMult.setX(x);
            this.comboCount.setX(x + this.comboMult.width + 6);
        }

        paintCombo() {
            const color = COMBO_COLORS[Math.min(this.tier, COMBO_COLORS.length - 1)];
            this.comboMult.setColor(color);
            this.comboCount.setColor(this.combo ? PALETTE.hudText : PALETTE.hudMuted);
            this.comboGlow.setTint(ns.tint(color));
            // 辉光跟着档位走，与光尾加亮同一条"越来越亮"的曲线；0 连击时完全熄灭
            this.comboGlow.setAlpha(this.combo ? 0.08 + 0.24 * this.tier / (COMBO_COLORS.length - 1) : 0);
        }

        // 5.7：每次 +1 弹一下（1 → 1.35 → 1，共 120ms）
        popCombo() {
            const box = this.comboBox;
            const cx = CONFIG.WIDTH / 2;
            this.scene.tweens.killTweensOf(box);
            // 断连击的横向抖动可能被打断，onComplete 不会跑：先归位再弹，否则整组越弹越偏、颜色也留在红上
            box.setX(cx).setScale(1);
            this.scene.tweens.add({
                targets: box,
                scale: CONFIG.HUD_COMBO_POP_SCALE,
                duration: CONFIG.HUD_COMBO_POP_MS / 2,
                yoyo: true,
                ease: 'Quad.easeOut',
                onComplete: function () { box.setScale(1); }
            });
        }

        // 连击断了：整组横向抖两下并短暂转红，结束时回到本档颜色
        breakCombo() {
            const box = this.comboBox;
            const cx = CONFIG.WIDTH / 2;
            this.scene.tweens.killTweensOf(box);
            box.setX(cx).setScale(1);
            this.comboMult.setColor(PALETTE.danger);
            this.scene.tweens.add({
                targets: box,
                x: cx + CONFIG.HUD_COMBO_BREAK_X,
                duration: CONFIG.HUD_COMBO_BREAK_MS / 4,
                yoyo: true,
                repeat: 1,
                ease: 'Sine.easeInOut',
                onComplete: () => {
                    box.setX(cx);
                    this.paintCombo();
                }
            });
        }

        // 进度条填的是"距下一级还差几次击落"，所以每击落一颗就推进一格（harness/gameplay.md）
        drawClimb(progress) {
            if (!this.modeDef.climb) {
                this.climbText.setText('闯关 · 难度恒定，不爬升');
                return;
            }
            if (!progress) { return; }

            this.fillGold = progress.capped;
            // 封顶后不再随 sinceClimb 循环，整条填满并转金
            this.rollFill(progress.capped ? 1 : progress.sinceClimb / progress.every);
            this.climbText.setText('爬升 +' + progress.stage +
                (progress.capped ? ' · 封顶' : ' · ' + progress.sinceClimb + '/' + progress.every) +
                ' · ' + HUD.ratioText(progress));
        }

        rollFill(target) {
            if (target === this.fillTarget) { return; }
            const tweens = this.scene.tweens;
            tweens.killTweensOf(this.fillRoll);
            this.fillTarget = target;
            // 爬升那一下 sinceClimb 归零：整条倒着流回去看着像掉了进度，直接归位重头填
            if (target < this.fillRoll.value) {
                this.fillRoll.value = target;
                this.drawFill();
                return;
            }
            tweens.add({
                targets: this.fillRoll,
                value: target,
                duration: CONFIG.HUD_CLIMB_MS,
                ease: 'Cubic.easeOut',
                onUpdate: () => this.drawFill(),
                onComplete: () => {
                    this.fillRoll.value = target;
                    this.drawFill();
                }
            });
        }

        drawFill() {
            const graphics = this.trackFill;
            graphics.clear();
            if (this.fillRoll.value <= 0) { return; }
            // 圆角矩形的宽度不能小于圆角直径，滚动刚开始那几帧的宽度会不足 8px
            const width = Math.max(TRACK.height, TRACK.width * this.fillRoll.value);
            const head = TRACK.x + width - TRACK.height / 2;
            graphics.fillStyle(ns.tint(this.fillGold ? PALETTE.gold : PALETTE.info), 0.95);
            graphics.fillRoundedRect(TRACK.x, TRACK.y, width, TRACK.height, TRACK.height / 2);
            // 上沿高光 + 头部亮点：填充读起来是"一条正在推进的光"，不是一块平色
            graphics.fillStyle(0xffffff, 0.22);
            graphics.fillRoundedRect(TRACK.x + 2, TRACK.y + 1.5, Math.max(1, width - 4), 2, 1);
            graphics.fillStyle(0xffffff, 0.85);
            graphics.fillCircle(head, TRACK.y + TRACK.height / 2, 2.2);
        }

        // 只在真爬升那一下调用。重复爬升要先停掉上一条 tween，否则两条抢同一个 alpha
        levelUp(progress) {
            if (!this.modeDef.climb) { return; }
            this.bannerSub.setText('第 ' + progress.stage + ' 级 · ' + HUD.ratioText(progress) +
                (progress.capped ? ' · 已封顶' : ''));
            this.scene.tweens.killTweensOf(this.banner);
            this.banner.setVisible(true).setAlpha(0).setScale(0.94);
            this.scene.tweens.add({
                targets: this.banner,
                alpha: 1,
                scaleX: 1,
                scaleY: 1,
                duration: 170,
                hold: 520,
                yoyo: true,
                ease: 'Cubic.easeOut',
                onComplete: () => this.banner.setVisible(false)
            });
        }

        static ratioText(progress) {
            return '下落 ' + progress.speedRatio.toFixed(2) + '× · 间隔 ' + progress.intervalRatio.toFixed(2) + '×';
        }

        // 只在真掉命那一下调用（sync 每次都喂，值没变直接返回）。生命不会回涨，所以只处理减少：
        // 丢的那颗炸开淡出，剩下的抖两下。图标炸完就 setVisible(false)，本局内不再复用
        setLives(lives) {
            if (lives === this.lives) { return; }
            for (let i = lives; i < this.lives; i++) { this.shatter(this.lifeIcons[i], i); }
            this.lives = lives;
            this.shakeLives();
        }

        // 5.7 写的是"星形炸成 5 个角"，那要五片碎屑各挂一条 tween；3e 先做整颗炸开 + 自转淡出，
        // 相邻两颗转向相反，看着是"崩开"而不是"一起飘走"
        shatter(icon, index) {
            if (!icon) { return; }
            const scene = this.scene;
            scene.tweens.killTweensOf(icon);
            icon.setVisible(true);
            scene.tweens.add({
                targets: icon,
                scale: CONFIG.LIFE_SHATTER_SCALE,
                alpha: 0,
                rotation: CONFIG.LIFE_SHATTER_SPIN * (index % 2 ? 1 : -1),
                duration: CONFIG.LIFE_SHATTER_MS,
                ease: 'Cubic.easeOut',
                onComplete: function () { icon.setVisible(false); }
            });
        }

        shakeLives() {
            const scene = this.scene;
            this.lifeIcons.forEach((icon, index) => {
                if (index >= this.lives) { return; }
                scene.tweens.killTweensOf(icon);
                // 上一次抖动被打断（连丢两条命）时 onComplete 不会跑，先归位再起新的
                icon.setX(icon.baseX);
                scene.tweens.add({
                    targets: icon,
                    x: icon.baseX + CONFIG.LIFE_SHAKE_X,
                    duration: CONFIG.LIFE_SHAKE_MS,
                    yoyo: true,
                    repeat: 1,
                    ease: 'Sine.easeInOut',
                    onComplete: function () { icon.setX(icon.baseX); }
                });
            });
        }
    }

    objects.HUD = HUD;
})(window.ShootingStars = window.ShootingStars || {});