(function (ns) {
    'use strict';

    const CONFIG = ns.CONFIG;
    const PALETTE = ns.PALETTE;
    const DEPTH = ns.DEPTH;
    const MOTION = ns.MOTION;
    const objects = ns.objects = ns.objects || {};
    const ui = ns.utils.ui;

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    // 顶条上端多铺出去的那一截：进场上浮（utils.riseIn，GameScene 给 distance 10）会把整条 HUD
    // 往下拽，顶条要是正好从 y=0 起，那 380ms 里屏幕最上面就露出一条没有顶条的夜空
    const RISE_PAD = 16;

    // 局内顶条（harness/gameplay.md、harness/ui.md）：类型 · 模式 · 方向 · 速度 / 当前长度（大字）·
    // 第几关 / 进度点 + 暂停入口。类型 / 模式 / 方向读开局那一次快照（AGENTS 界面纪律 1），局内不回读设置；
    // 速度那一段例外，它是 sync 传进来的局内活值（休闲里程碑，harness/ui.md）。
    //
    // 横屏 HUD 搬进左列（4d，harness/ui.md）：场景给 colW 时走三行排布——读数+暂停 / 长度大字+进度点 /
    // 关次+计数。两行顶条在横屏吃掉一百多 px 高度，选牌器最小框高 276 会被裁掉底行；
    // 搬进左列后玩法区吃满上下留白之间的全高。竖屏不给 colW，仍是全宽顶条两行，原样不动。
    //
    // 1i 起物件常驻：顶条一次建好，sync(opts) 全量更新文字与进度点（harness/ui.md）。
    // 进度点是一个 Graphics 整层重画——重画的是内容不是物件，与"销毁重建"是两回事。
    // 返回 { container, height, sync }，height 是从 view.gutter 起占掉的高度
    objects.hud = function (scene, opts) {
        const view = opts.view;
        const gutter = view.gutter;
        const wide = opts.colW != null;
        const right = wide ? gutter + opts.colW : view.w - gutter;
        const container = scene.add.container(0, 0).setDepth(DEPTH.hud);

        // 暂停按钮先建：第一行的读数要按它剩下的宽度截断。
        // 它是局内唯一的常驻指针入口——呈现阶段不给任何玩法入口，但"任何时刻可暂停"要成立，
        // 所以它是手机上到达暂停的唯一路径，尺寸按触控下限给（harness/requirements.md 4d）
        const pauseH = clamp(Math.round(view.unit * 1.8), CONFIG.TOUCH_TARGET, 52);
        const pause = ui.chip(scene, {
            x: 0, y: 0, label: '暂停', height: pauseH, padX: 14, fontSize: '13px',
            onSelect: opts.onPause
        });

        const rowY = gutter + Math.round(pauseH / 2);
        pause.setPosition(right - pause.width / 2, rowY);

        const readout = ui.text(scene, gutter, rowY, '', {
            fontSize: '11px',
            fontFamily: CONFIG.MONO,
            color: PALETTE.textFaint
        }).setOrigin(0, 0.5);

        // 长度大字是顶条的主角（harness/ui.md）：序列多长一眼可读，不写进句子里
        const bigSize = clamp(Math.round(view.unit * 2.4), 30, 46);
        const row2Y = rowY + Math.round(pauseH / 2) + Math.round(view.unit * 0.45) + Math.round(bigSize / 2);
        const big = ui.text(scene, gutter, row2Y, '', {
            fontSize: bigSize + 'px',
            fontStyle: '700'
        }).setOrigin(0, 0.5);
        // 横屏第三行放关次（左）与计数（右），大字独占第二行、进度点右对齐在第二行——
        // 窄左列里大字 + 关次 + 计数挤一行会互相压字。竖屏关次仍跟在大字右边、计数在第二行右端
        const row3Y = row2Y + Math.round(bigSize / 2) + Math.round(view.unit * 0.35) + 6;
        const roundText = ui.text(scene, gutter, wide ? row3Y : row2Y + Math.round(bigSize * 0.22), '', {
            fontSize: '11px',
            fontFamily: CONFIG.MONO,
            color: PALETTE.textFaint
        }).setOrigin(0, 0.5);

        // 进度点 + "已输入 n / 总长 m"。点错的那一位标红，其余只说进度、不给内容提示
        const count = ui.text(scene, right, wide ? row3Y : row2Y, '', {
            fontSize: '11px',
            fontFamily: CONFIG.MONO,
            color: PALETTE.textDim
        }).setOrigin(1, 0.5);
        const dots = scene.add.graphics();

        container.add([pause, readout, big, roundText, count, dots]);
        const height = (wide ? row3Y + 6 : row2Y + Math.round(bigSize / 2)) +
            Math.round(view.unit * 0.4) - gutter;

        // 顶条（harness/ui.md 材质那条）：一张竖向渐变纹理垫在全部读数底下，软裙起点一道强调细线——
        // 仪表层与玩法区就此分开；硬底边会把它读成一块贴上去的挡板，软裙才是"浮在一层玻璃上"。
        // **只竖屏给**：横屏 HUD 在左列、与玩法区并排（4d），全宽顶条会压住玩法区上沿
        //（选牌器的已选序列条首当其冲），而那一侧也没有"从条下面滑出去"的物件
        if (!wide) {
            // 不透明段正好盖住 HUD 自己占的那块（从 gutter 起算的 height），软裙长在它下面：
            // 纹理底部 HUD_BAR_SKIRT 那一段是渐隐的，所以不透明段高 = 整条高 × (1 - skirt)。
            // 上端多铺 RISE_PAD、左右各多铺一圈 overscan（与 Backdrop 同一条理由）：进场上浮
            // 把整条往下拽 10px（utils.riseIn），纯尺寸抖动只把画布跟上视口、不重排场景——
            // 两种情况都会在屏幕边上露出一条没有顶条的夜空
            const opaque = gutter + height;
            const overscan = Math.round(Math.max(view.w, view.h) * 0.12);
            const barW = view.w + overscan;
            const barH = Math.round((opaque + RISE_PAD) / (1 - CONFIG.HUD_BAR_SKIRT));
            const bar = scene.add.image(view.w / 2, barH / 2 - RISE_PAD, 'hudBar')
                .setDisplaySize(barW, barH);
            const hairline = scene.add.graphics()
                .lineStyle(1, ns.tint(PALETTE.dominantSoft), 0.22)
                .lineBetween(-overscan / 2, opaque + 0.5, barW - overscan / 2, opaque + 0.5);
            container.addAt(bar, 0);
            container.addAt(hairline, 1);
        }

        const avail = right - pause.width - 14 - gutter;
        // 减少动效（4b，harness/ui.md）：长度大字的滚动与弹一下砍掉、直接落值——
        // 数值本身是信息，滚过去只是装饰
        const reduced = ns.utils.reducedMotion();
        let shownLength = null;
        let roll = null;

        function sync(o) {
            const run = o.run;
            const round = o.round;

            // 窄屏放不下四段读数就砍尾巴（先砍速度档、再砍方向）：撞上暂停按钮比少一段读数难读。
            // 横屏窄左列可以一路砍到只剩类型一段（4d，harness/ui.md）——方向还有 recall 短提示兜底。
            // 速度读 o.speed 而不是 run.speed：那是里程碑之后的活值（session.speedNow），
            // 数字变小本身就是"提速了"的可见证据（harness/ui.md）。run.speed 是开局那一档，归结算当记录身份
            const parts = [run.type.name, run.mode.name, run.direction.name, '每项 ' + o.speed.show + 'ms'];
            readout.setText(parts.join(' · '));
            while (readout.width > avail && parts.length > 1) {
                parts.pop();
                readout.setText(parts.join(' · '));
            }

            // 换关长度 +1：大字滚动到新值再弹一下（harness/ui.md）。滚动是 transient 动效，
            // 目标值仍由 round.length 全量推导；restart 后 shownLength 为 null，直接落值不滚
            if (!reduced && shownLength !== null && shownLength !== round.length) {
                if (roll) { roll.stop(); }
                big.setText(String(shownLength));
                roll = scene.tweens.addCounter({
                    from: shownLength, to: round.length,
                    duration: MOTION.count, ease: 'Cubic.easeOut',
                    onUpdate: function (tween) {
                        big.setText(String(Math.round(tween.getValue())));
                        if (!wide) { roundText.setX(gutter + big.width + 10); }
                    },
                    onComplete: function () { roll = null; }
                });
                scene.tweens.killTweensOf(big);
                big.setScale(1.12);
                scene.tweens.add({ targets: big, scaleX: 1, scaleY: 1, duration: 180, ease: 'Back.easeOut' });
            } else {
                big.setText(String(round.length));
            }
            shownLength = round.length;

            roundText.setText('第 ' + round.index + ' 关');
            if (!wide) { roundText.setX(gutter + big.width + 10); }
            count.setText(o.step + ' / ' + round.length);
            // 横屏窄左列：关次与计数放不下同一行时关次让位（4d，harness/ui.md）——
            // 关次在暂停与结算里仍有，计数是局内进度读数不能让
            roundText.setVisible(!wide || roundText.width + 10 + count.width <= opts.colW);

            // 序列长了点就缩小、再长就只留计数：点挤成一团就数不清是第几位了。
            // 进度点可关（4c，设置页开关）：读开局快照（纪律 1），关时只砍圆点——
            // "已输入 n/m"计数保留，错处由底部读数与危险色表达（harness/ui.md）
            dots.clear();
            if (run.settings.progressDots) {
                const many = round.length > 12;
                const radius = many ? 3 : 4;
                const pitch = many ? 9 : 12;
                const dotsWidth = round.length * pitch - (pitch - radius * 2);
                // 竖屏：计数右对齐在第二行右端，点排在它左边、大字与关次右边。
                // 横屏：计数在第三行，第二行右端整段让给点（左起大字右边）
                const dotsRight = wide ? right : count.x - count.width - 10;
                const dotsLeft = wide ? gutter + big.width + 12
                    : gutter + big.width + 10 + roundText.width + 12;
                if (dotsWidth <= dotsRight - dotsLeft) {
                    for (let i = 0; i < round.length; i += 1) {
                        const cx = dotsRight - dotsWidth + radius + i * pitch;
                        if (i === o.badAt) {
                            dots.fillStyle(ns.tint(PALETTE.danger), 1);
                            dots.fillCircle(cx, row2Y, radius + 1);
                        } else if (i < o.step) {
                            dots.fillStyle(ns.tint(PALETTE.dominantSoft), 0.95);
                            dots.fillCircle(cx, row2Y, radius);
                        } else {
                            dots.fillStyle(ns.tint(PALETTE.surfaceEdge), 0.9);
                            dots.fillCircle(cx, row2Y, radius);
                        }
                    }
                }
            }
        }

        return { container: container, height: height, sync: sync };
    };
})(window.SequenceMemory = window.SequenceMemory || {});