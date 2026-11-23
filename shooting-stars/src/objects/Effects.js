(function (ns) {
    'use strict';

    const CONFIG = ns.CONFIG;
    const PALETTE = ns.PALETTE;
    const DEPTH = ns.DEPTH;
    const objects = ns.objects = ns.objects || {};
    const ui = ns.utils.ui;

    // 四个短命池共用一套借还：寿命按类型固定 ⇒ 队首恒是最旧那个 ⇒ 池满时 shift()
    // 抢过来重用最划算。命中特效不能像星星那样"池空就跳过"，少一件玩家立刻看得出来
    function makePool(size, factory) {
        const pool = { size: size, created: size, free: [], active: [] };
        for (let i = 0; i < size; i++) { pool.free.push(factory()); }
        return pool;
    }

    function take(pool) {
        let item = pool.free.pop();
        if (item) {
            pool.active.push(item);
        } else {
            item = pool.active.shift();
            pool.active.push(item);
        }
        item.age = 0;
        return item;
    }

    // 与 Star / TrailPool 同一套：只吃 clamp 后的 dt，一条 Tween 都不挂，
    // 暂停与切标签页时自动停住、恢复后接着走完
    function advance(pool, ms, life, apply) {
        const active = pool.active;
        for (let i = active.length - 1; i >= 0; i--) {
            const item = active[i];
            item.age += ms;
            const t = item.age / life;
            if (t >= 1) {
                active.splice(i, 1);
                item.view.setActive(false).setVisible(false);
                pool.free.push(item);
                continue;
            }
            apply(item, t);
        }
    }

    function poolStats(pool) {
        return { active: pool.active.length, free: pool.free.length, created: pool.created, size: pool.size };
    }

    // 命中五件套 + 类型专属件的统一入口（harness/ui.md）。GameScene 只在击落时调一次 burst()，
    // 五件恒齐发，第六件由 STAR_TYPES 那一行决定（5a 起：金色星的光柱、双星的第二颗爆开）。
    // 双星敲第一颗走 pairArm()，不是击落所以不给五件套（harness/ui.md 反馈契约）
    class Effects {
        constructor(scene, options) {
            const opts = options || {};
            this.scene = scene;
            this.level = opts.level;

            // 同在 20 层的几件靠创建顺序分先后：冰晶 → 光柱 → 吸入粒子 → 粒子 → 白环 → 字母 → 飘分。
            // 冰晶建在最前（它是一层氛围，压在全部庆祝件之下），光柱其次，于是它压在其余几件之下——
            // 它是一道背景光，冲击波要盖在它上面。闪白在 12 层，它顶替的是那颗真星的位置，
            // 压在场其余真星（11）之上
            this.ices = makePool(CONFIG.FX_ICE_COUNT, () => this.buildIce(scene));
            this.pillars = makePool(CONFIG.FX_PILLAR_POOL_SIZE, () => this.buildPillar(scene));
            this.voids = makePool(CONFIG.FX_VOID_POOL_SIZE, () => this.buildVoid(scene));
            this.buildSparks(scene);
            this.flash = makePool(CONFIG.FX_FLASH_POOL_SIZE, () => this.buildFlash(scene));
            this.rings = makePool(CONFIG.FX_RING_POOL_SIZE, () => this.buildRing(scene));
            this.letters = makePool(CONFIG.FX_LETTER_POOL_SIZE, () => this.buildLetter(scene));
            this.scores = makePool(CONFIG.FX_SCORE_POOL_SIZE, () => this.buildScore(scene));
            this.rain = makePool(CONFIG.FX_RAIN_COUNT, () => this.buildRain(scene));
            this.filter = null;

            // 5b 误敲黑洞的全屏黑闪：常驻一张矩形，透明度按剩余寿命线性落，不挂 tween。
            // fillAlpha 留默认 1——对象 alpha × fillAlpha 才是渲染值，建时填 0 这层就永远不可见
            // （3e 的压暗层踩过）。尺寸外扩 64px：震屏偏移最大约 10px，黑闪期间边缘不能露白
            this.voidFlashView = scene.add.rectangle(CONFIG.WIDTH / 2, CONFIG.HEIGHT / 2,
                CONFIG.WIDTH + 64, CONFIG.HEIGHT + 64, ns.tint(PALETTE.scrim))
                .setDepth(DEPTH.overlay)
                .setAlpha(0)
                .setVisible(false);
            this.voidFlashLeft = 0;

            // 5c 的冰晶全屏：冷蓝叠加层同样常驻一张矩形、同样在 overlay 40 层——"全屏"包括顶条，
            // 只盖玩法区会让那 4 秒看着像漏了一处。fillAlpha 留默认 1（3e 压暗层踩过的坑），
            // 尺寸外扩 64px（减速期间照样会坠毁、照样震屏，边缘不能露白）
            this.iceView = scene.add.rectangle(CONFIG.WIDTH / 2, CONFIG.HEIGHT / 2,
                CONFIG.WIDTH + 64, CONFIG.HEIGHT + 64, ns.tint(PALETTE.iceEdge))
                .setDepth(DEPTH.overlay)
                .setAlpha(0)
                .setVisible(false);
            // frost 是这一层的 0..1 的量：叠加层与冰晶共用它，重复命中时它已经是 1，
            // 所以第二颗冰晶不会让画面先亮回来再暗下去（计时器重置，画面不抖）
            this.frost = 0;
            this.iceClock = 0;
        }

        // 全场唯一一个发射器：每次命中只 setParticleTint + emitParticleAt，
        // reserve 先把粒子对象备齐，运行期不再 new（emitting:false 时 update 仍推进已发出的粒子）
        buildSparks(scene) {
            this.sparks = scene.add.particles(0, 0, 'spark', {
                emitting: false,
                frequency: -1,
                reserve: CONFIG.FX_SPARK_MAX_ALIVE,
                maxAliveParticles: CONFIG.FX_SPARK_MAX_ALIVE,
                blendMode: 'ADD',
                speed: { min: CONFIG.FX_SPARK_SPEED_MIN, max: CONFIG.FX_SPARK_SPEED_MAX },
                gravityY: CONFIG.FX_SPARK_GRAVITY,
                lifespan: { min: CONFIG.FX_SPARK_LIFE_MIN, max: CONFIG.FX_SPARK_LIFE_MAX },
                scale: { start: CONFIG.FX_SPARK_SCALE_FROM, end: CONFIG.FX_SPARK_SCALE_TO },
                alpha: { start: 1, end: 0 },
                // 每颗自己的起始角与转向：{start,end} 会让整簇同向同速转，看着像机械扇叶
                rotate: {
                    onEmit: function (particle) {
                        particle.spinFrom = Phaser.Math.Between(0, 359);
                        particle.spinTo = particle.spinFrom + Phaser.Math.Between(-CONFIG.FX_SPARK_SPIN, CONFIG.FX_SPARK_SPIN);
                        return particle.spinFrom;
                    },
                    onUpdate: function (particle, key, t) {
                        return particle.spinFrom + (particle.spinTo - particle.spinFrom) * t;
                    }
                }
            }).setDepth(DEPTH.particle);
        }

        // 5a 的金色星光柱：底端锚在命中点（origin 0.5,1），向上冲的一道软光带。
        // 源 64×256、显示 40×220，动画里 scale 最大只到 1（harness/architecture.md 的"只缩不放"），
        // 所以基准缩放是"显示尺寸 ÷ 源尺寸"这两个常数而不是 1，后面的 setScale 都乘在它上面
        buildPillar(scene) {
            const view = scene.add.image(0, 0, 'pillar')
                .setOrigin(0.5, 1)
                .setBlendMode(Phaser.BlendModes.ADD)
                .setDepth(DEPTH.particle)
                .setActive(false)
                .setVisible(false);
            return {
                view: view,
                age: 0,
                baseX: CONFIG.FX_PILLAR_WIDTH / CONFIG.FX_PILLAR_SOURCE_W,
                baseY: CONFIG.FX_PILLAR_HEIGHT / CONFIG.FX_PILLAR_SOURCE_H
            };
        }

        // 5b 的吸入粒子：复用 dot 那张 16px 软点，显示 12px（只缩不放）。
        // 不用星屑发射器——那套是向外炸开 + 重力下坠，吸入要的是向中心收拢，
        // 位移按 t 闭式算（同星屑雨），暂停与切标签页自动停住
        buildVoid(scene) {
            const view = scene.add.image(0, 0, 'dot')
                .setDisplaySize(CONFIG.FX_VOID_SIZE, CONFIG.FX_VOID_SIZE)
                .setBlendMode(Phaser.BlendModes.ADD)
                .setDepth(DEPTH.particle)
                .setActive(false)
                .setVisible(false);
            return { view: view, age: 0, cx: 0, cy: 0, angle: 0, radius: 0, base: CONFIG.FX_VOID_SIZE / 16 };
        }

        // 5c 的飘落冰晶：复用 iceStar 那张 216² 纹理缩到 18px（同吸入粒子复用 dot 的路数），
        // 不另烤一张小图。tint 建时给一次就够——它全程是同一个冰蓝，不像星屑那样跟着星色变。
        // 位移按 t 闭式算（同星屑雨），一条 Tween 都不挂，暂停与切标签页自动停住
        buildIce(scene) {
            const view = scene.add.image(0, 0, 'iceStar')
                .setDisplaySize(CONFIG.FX_ICE_SIZE, CONFIG.FX_ICE_SIZE)
                .setTint(ns.tint(PALETTE.ice))
                .setDepth(DEPTH.particle)
                .setActive(false)
                .setVisible(false);
            return { view: view, age: 0, fromX: 0, fromY: 0, speed: 0, drift: 0, spin: 0, rot: 0 };
        }

        // 爆开的是星体的一份拷贝，不是那颗真星：真星在 judge 里已经归还池，
        // 留在场多待 80ms 的话同字母的下一击会再命中它一次（重复计分）
        buildFlash(scene) {
            const size = CONFIG.STAR_SIZE;
            const halo = scene.add.image(0, 0, 'glow').setScale(CONFIG.STAR_HALO_SCALE).setAlpha(CONFIG.STAR_HALO_ALPHA);
            const shape = scene.add.image(0, 0, 'starHi').setDisplaySize(size, size);
            const core = scene.add.image(0, 0, 'starCore');
            // 四芒也要拷一份：少这一层的话金色星在死亡那一帧先丢掉高光再闪白，看着是"变了一下"
            const glint = scene.add.image(0, 0, 'starGlint').setDisplaySize(size, size).setVisible(false);
            const white = scene.add.image(0, 0, 'star').setDisplaySize(size, size).setBlendMode(Phaser.BlendModes.ADD);
            const view = scene.add.container(0, 0, [halo, shape, core, glint, white])
                .setDepth(DEPTH.flash)
                .setActive(false)
                .setVisible(false);
            return { view: view, halo: halo, shape: shape, core: core, glint: glint, white: white, age: 0, from: 1, haloFrom: CONFIG.STAR_HALO_ALPHA };
        }

        buildRing(scene) {
            const size = CONFIG.FX_RING_SIZE;
            const wave = scene.add.image(0, 0, 'shock').setDisplaySize(size, size).setBlendMode(Phaser.BlendModes.ADD);
            const core = scene.add.image(0, 0, 'shock').setDisplaySize(size, size).setBlendMode(Phaser.BlendModes.ADD);
            const view = scene.add.container(0, 0, [wave, core])
                .setDepth(DEPTH.particle)
                .setActive(false)
                .setVisible(false);
            return { view: view, wave: wave, core: core, age: 0 };
        }

        buildLetter(scene) {
            const level = this.level;
            // 飞散过程要放大到 1.8×，分辨率跟着抬到 1.8 倍才是全程只缩不放（harness/architecture.md 的硬约束）。
            // 字号与星面同一份（9e）：单元方案飘的是显示面（一个汉字），照档位拉丁字号烤会大一档、
            // 炸开那一下换脸；键位方案照旧读 level.fontSize
            const view = ui.text(scene, 0, 0, '', {
                fontSize: (level.units ? level.units.face : level.fontSize) + 'px',
                fontStyle: '700',
                color: PALETTE.letter,
                stroke: PALETTE.starlight,
                strokeThickness: level.stroke,
                resolution: ns.RENDER_SCALE * CONFIG.FX_LETTER_SCALE
            }).setDepth(DEPTH.particle).setActive(false).setVisible(false);
            return { view: view, age: 0, fromY: 0, from: 1, family: CONFIG.FONT };
        }

        buildScore(scene) {
            const view = ui.text(scene, 0, 0, '', {
                fontSize: CONFIG.FX_SCORE_SIZE_MIN + 'px',
                fontStyle: '700',
                fontFamily: CONFIG.MONO,
                color: PALETTE.starlight,
                stroke: PALETTE.skyTop,
                strokeThickness: 3
            }).setDepth(DEPTH.particle).setActive(false).setVisible(false);
            return { view: view, age: 0, fromY: 0, size: CONFIG.FX_SCORE_SIZE_MIN, gold: false };
        }

        // 里程碑星屑雨用的是 spark 那张四芒星，横向压到 0.13 就是一条细长星光，不新烤纹理
        buildRain(scene) {
            const view = scene.add.image(0, 0, 'spark')
                .setBlendMode(Phaser.BlendModes.ADD)
                .setScale(CONFIG.FX_RAIN_SCALE_X, CONFIG.FX_RAIN_SCALE_Y)
                .setDepth(DEPTH.particle)
                .setActive(false)
                .setVisible(false);
            return { view: view, age: 0, fromX: 0, fromY: 0, speed: 0, drift: 0, spin: 0, rot: 0 };
        }

        // info: { x, y, color, letter, face?, rotation, scale, size?, gained, tier, multiplier, type, spent? }
        // face 是显示面（9e，单元方案才有）：击落飘它、推进飘 letter；size 是星体显示尺寸，
        // 缺参一律当常规 72，所以键位方案的特效与 9d 之前逐字相同
        burst(info) {
            this.emitFlash(info);
            this.emitSparks(info);
            this.emitRing(info);
            this.emitLetter(info);
            this.emitScore(info);
            // 第六件看类型表：金色星是光柱，双星（5d）是"已经敲暗的那一颗跟着一起炸开"——
            // 两颗一起消除才是真的两颗（spent 由 Star.snapshot 附上，只有已敲过第一颗的双星才有）；
            // 冰晶星是全屏冷蓝（GameScene 起计时、updateIce 画），黑洞那件根本不走 burst
            const spec = ns.starType(info.type);
            if (spec.pillar) { this.emitPillar(info); }
            if (spec.pair && info.spent) {
                this.emitFlash(info.spent);
                this.emitSparks(info.spent);
            }
            return this;
        }

        // 键序推进一格（9d 双星首颗 / 9e 序列星每敲对一键）：那不是击落，只发字母那一件（第四件）——
        // 它说明"这个键吃掉了"，其余反馈全在星自己身上（双星首颗变暗 / 连线缩短 / 第二颗放大；
        // 单体序列星亮一格进度点）。飘的是**刚被吃掉的那一键**（快照在推进之前取）而不是显示面：
        // h-a-o 一键一个字上飘，玩家才看得见自己敲到第几键
        pairArm(info) {
            this.emitLetter(info, info.letter);
            return this;
        }

        emitFlash(info) {
            const item = take(this.flash);
            const tint = ns.tint(info.color);
            // 闪白顶替的就是那颗真星：拷贝建在 72 上，单元方案的星体是 96（9e），
            // 少乘这一档死亡那一帧会先跳一下大小再炸开
            item.from = (info.scale || 1) * (info.size || CONFIG.STAR_SIZE) / CONFIG.STAR_SIZE;
            // 光晕亮度跟着真星走：减速区里的星光晕是加亮的，拷贝按常态值起就会在死亡那一帧暗一下
            item.haloFrom = info.halo;
            item.shape.setTint(tint);
            item.halo.setTint(tint).setAlpha(item.haloFrom);
            item.core.setAlpha(1);
            item.shape.setAlpha(1);
            item.glint.setVisible(ns.starType(info.type).glint);
            item.white.setAlpha(CONFIG.FX_FLASH_ALPHA);
            item.view.setPosition(info.x, info.y)
                .setRotation(info.rotation || 0)
                .setScale(item.from)
                .setAlpha(1)
                .setActive(true)
                .setVisible(true);
        }

        // 光柱从命中点向上冲：长高（0.45 → 1）同时横向收窄（1 → 0.6），α 按 1-t² 落
        emitPillar(info) {
            const item = take(this.pillars);
            item.view.setTint(ns.tint(info.color))
                .setPosition(info.x, info.y)
                .setScale(item.baseX, item.baseY * CONFIG.FX_PILLAR_SCALE_FROM)
                .setAlpha(CONFIG.FX_PILLAR_ALPHA)
                .setActive(true)
                .setVisible(true);
        }

        // 5b 误敲黑洞的专属件：吸积盘粒子从命中点四周向中心旋入（第七件）。
        // 不走 burst()——五件套是"击落"的庆祝，黑洞是"被吸走"，方向与语义都相反
        voidStrike(info) {
            for (let i = 0; i < CONFIG.FX_VOID_COUNT; i++) {
                const item = take(this.voids);
                item.cx = info.x;
                item.cy = info.y;
                item.angle = Math.random() * Math.PI * 2;
                item.radius = CONFIG.FX_VOID_RADIUS * (0.7 + Math.random() * 0.5);
                // 紫橘两色交替，与吸积盘纹理同色；ADD 混合下深色核心位置会亮成一团再收尽。
                // scale 乘在基准（显示 ÷ 源）上，直接 setScale(1) 会放大回 16px 源尺寸（同光柱）
                item.view.setTint(ns.tint(i % 2 ? PALETTE.voidDiskIn : PALETTE.voidDiskOut))
                    .setScale(item.base)
                    .setAlpha(0)
                    .setActive(true)
                    .setVisible(true);
            }
            return this;
        }

        // 全屏黑闪 120ms：峰值 α 起、线性落到 0。与吸入粒子同一道 dt 闸
        voidFlash() {
            this.voidFlashLeft = CONFIG.VOID_FLASH_MS;
            this.voidFlashView.setAlpha(CONFIG.VOID_FLASH_ALPHA).setVisible(true);
            return this;
        }

        // 5c 的一片冰晶：出生点铺满整个玩法区（不只从顶上撒），"缓慢飘落"才是满屏陆续出现的
        // 一层氛围而不是一场雪。池满抢最旧由 take 兜，"建 16"恒定
        emitIce() {
            const item = take(this.ices);
            item.fromX = Phaser.Math.Between(16, CONFIG.WIDTH - 16);
            item.fromY = Phaser.Math.Between(-16, CONFIG.HORIZON_Y - 24);
            item.speed = Phaser.Math.Between(CONFIG.FX_ICE_SPEED_MIN, CONFIG.FX_ICE_SPEED_MAX);
            item.drift = Phaser.Math.Between(-CONFIG.FX_ICE_DRIFT, CONFIG.FX_ICE_DRIFT);
            item.spin = Phaser.Math.FloatBetween(-CONFIG.FX_ICE_SPIN, CONFIG.FX_ICE_SPIN);
            item.rot = Math.random() * Math.PI * 2;
            item.view.setPosition(item.fromX, item.fromY)
                .setRotation(item.rot)
                .setAlpha(0)
                .setActive(true)
                .setVisible(true);
        }

        // 冰晶全屏的画面那一半：frost 线性爬 400ms、到期线性落尽（精确归零，不留指数尾巴），
        // 叠加层与飘落冰晶共用它
        updateIce(ms) {
            const on = this.filter === 'ice';
            const target = on ? 1 : 0;
            if (this.frost !== target) {
                const step = ms / CONFIG.ICE_FADE_MS;
                const next = target > this.frost ? this.frost + step : this.frost - step;
                // 浮点累加会在端点留下 1e-16 级的残渣（24 帧各减 1/24 减不到 0），够近就直接落到
                // 端点：否则到期那一帧冷蓝层仍判成"看得见"、冰晶也要多飘一帧才被收回
                // （同 Backdrop.approach 对密度与紧迫度的取舍）
                this.frost = Math.abs(target - next) < 1e-6 ? target : Math.min(1, Math.max(0, next));
            }
            this.iceView.setAlpha(CONFIG.ICE_ALPHA * this.frost).setVisible(this.frost > 0);

            if (on) {
                this.iceClock += ms;
                if (this.iceClock >= CONFIG.FX_ICE_INTERVAL_MS) {
                    this.iceClock = 0;
                    this.emitIce();
                }
            } else {
                // 不在冰晶态就把发牌时钟归零：下一场从整拍开始，不因为攒着的余数一上来就连发
                this.iceClock = 0;
            }

            // 已在飘的那几片按自己的寿命走，α 乘全局 frost：到期时它们随叠加层一起溶掉，
            // 不做瞬灭（同 3e 装饰流星停发的取舍）
            const frost = this.frost;
            const span = CONFIG.FX_ICE_MS / 1000;
            advance(this.ices, ms, CONFIG.FX_ICE_MS, function (item, t) {
                item.view.setPosition(item.fromX + item.drift * span * t, item.fromY + item.speed * span * t)
                    .setRotation(item.rot + item.spin * span * t)
                    // 前 15% 淡入：满 α 凭空出现像屏幕脏了一块（同星屑雨）
                    .setAlpha(CONFIG.FX_ICE_ALPHA * frost * Math.min(1, t / 0.15) * (1 - t));
            });

            // 溶尽之后把还在寿命里的那几片一起收回：它们 α 已经是 0，留在 active 里只会让读数
            // 拖着"冰 N/16"最多 2.4s，看着像漏归还
            if (!on && this.frost === 0 && this.ices.active.length) {
                const active = this.ices.active;
                while (active.length) {
                    const item = active.pop();
                    item.view.setActive(false).setVisible(false);
                    this.ices.free.push(item);
                }
            }
        }

        emitSparks(info) {
            // tint 是 onEmit 求值的 op，所以只染这一簇，已在飞的粒子保持各自星色
            this.sparks.setParticleTint(ns.tint(info.color));
            this.sparks.emitParticleAt(info.x, info.y, Phaser.Math.Between(CONFIG.FX_SPARK_MIN, CONFIG.FX_SPARK_MAX));
        }

        emitRing(info) {
            const item = take(this.rings);
            item.wave.setTint(ns.tint(info.color)).setAlpha(CONFIG.FX_RING_ALPHA);
            item.core.setAlpha(CONFIG.FX_RING_ALPHA).setScale(1);
            item.view.setPosition(info.x, info.y)
                .setScale(CONFIG.FX_RING_SCALE_FROM)
                .setActive(true)
                .setVisible(true);
        }

        // glyph 缺省时飘**显示面**（9e：击落那一下飘的是"好"，不是最后一键"o"）；
        // 键位方案 face 为 null，逐字回落到 info.letter，与 9d 之前完全一致
        emitLetter(info, glyph) {
            const item = take(this.letters);
            const text = glyph || info.face || info.letter;
            item.from = info.scale || 1;
            item.fromY = info.y + CONFIG.LETTER_OFFSET_Y * item.from;
            // 与星面同一份字形（8）：数字走等宽、汉字天然落回正文字体，否则炸开那一下字形换脸。
            // 同样按记忆字段调，上飘字母池也是复用的
            const family = ui.glyphFamily(text);
            if (item.family !== family) { item.family = family; item.view.setFontFamily(family); }
            item.view.setText(text)
                .setPosition(info.x, item.fromY)
                .setScale(item.from)
                .setAlpha(1)
                .setActive(true)
                .setVisible(true);
        }

        emitScore(info) {
            const item = take(this.scores);
            const tiers = CONFIG.COMBO_TIERS.length - 1;
            const size = Math.round(CONFIG.FX_SCORE_SIZE_MIN +
                (CONFIG.FX_SCORE_SIZE_MAX - CONFIG.FX_SCORE_SIZE_MIN) * (tiers ? info.tier / tiers : 0));
            const gold = info.multiplier >= CONFIG.FX_SCORE_GOLD_AT;
            // 飘分与字母都从命中点上飘，错开到星体右侧才不叠字；贴右边缘时翻到左侧。
            // 偏移按星体尺寸同比（9e）：单元星是 96 的星体，仍按 34 挪就把飘分压进星面里了
            const offsetX = CONFIG.FX_SCORE_OFFSET_X * (info.size || CONFIG.STAR_SIZE) / CONFIG.STAR_SIZE;
            const right = info.x > CONFIG.WIDTH - CONFIG.FX_SCORE_EDGE;
            item.fromY = info.y + CONFIG.FX_SCORE_OFFSET_Y;
            // setFontSize / setColor 各自会重栅格化一次，档位没变就别重复烤同一张字
            if (item.size !== size) { item.size = size; item.view.setFontSize(size); }
            if (item.gold !== gold) { item.gold = gold; item.view.setColor(gold ? PALETTE.gold : PALETTE.starlight); }
            item.view.setText('+' + info.gained)
                .setOrigin(right ? 1 : 0, 0.5)
                .setPosition(info.x + (right ? -offsetX : offsetX), item.fromY)
                .setScale(1)
                .setAlpha(1)
                .setActive(true)
                .setVisible(true);
        }

        // 里程碑星屑雨（harness/ui.md）：一次撒满 30 条，出生点铺在画布上方 FX_RAIN_SPREAD 那一段里，
        // 整场雨便是陆续进场而不是一字排开。位移按 t 闭式算（同五件套），暂停时自动停住
        emitRain() {
            for (let i = 0; i < CONFIG.FX_RAIN_COUNT; i++) {
                const item = take(this.rain);
                const warm = Math.random() < 0.35;
                item.fromX = Phaser.Math.Between(16, CONFIG.WIDTH - 16);
                item.fromY = -Phaser.Math.Between(16, CONFIG.FX_RAIN_SPREAD);
                item.speed = Phaser.Math.Between(CONFIG.FX_RAIN_SPEED_MIN, CONFIG.FX_RAIN_SPEED_MAX);
                item.drift = Phaser.Math.Between(-CONFIG.FX_RAIN_DRIFT, CONFIG.FX_RAIN_DRIFT);
                item.spin = Phaser.Math.FloatBetween(-CONFIG.FX_RAIN_SPIN, CONFIG.FX_RAIN_SPIN);
                item.rot = Math.random() * Math.PI * 2;
                item.view.setTint(ns.tint(warm ? PALETTE.starlightWarm : PALETTE.starlight))
                    .setPosition(item.fromX, item.fromY)
                    .setRotation(item.rot)
                    .setAlpha(0)
                    .setActive(true)
                    .setVisible(true);
            }
            return this;
        }

        // 3e 留的口子，5c 接上：GameScene 每帧写一次（'ice' / null）——计时与减速在它那边，
        // 画面在这边。只有冷蓝叠加一层，不接 postFX.addColorMatrix().saturate(0.4)：
        // postFX 是 WebGL only，Canvas 渲染器下毫无反应，两套实现要各验一遍还会长得不一样，
        // 而 α0.15 的冷蓝已经把"全场冻住"说清楚了（同 3e 压暗层与 5b 黑闪的取舍）
        setGlobalFilter(name) {
            this.filter = name || null;
            return this;
        }

        update(dt) {
            const ms = dt * 1000;

            advance(this.flash, ms, CONFIG.FX_FLASH_MS, function (item, t) {
                // 主体跟着白叠加一起淡：只淡白层的话第 80ms 是硬切，星体凭空消失
                const fade = 1 - t;
                item.view.setScale(item.from * (1 + (CONFIG.FX_FLASH_SCALE - 1) * Phaser.Math.Easing.Quadratic.Out(t)));
                item.shape.setAlpha(fade);
                item.core.setAlpha(fade);
                item.halo.setAlpha(item.haloFrom * fade);
                item.white.setAlpha(CONFIG.FX_FLASH_ALPHA * fade);
            });

            advance(this.rings, ms, CONFIG.FX_RING_MS, function (item, t) {
                const ease = Phaser.Math.Easing.Quadratic.Out(t);
                item.view.setScale(CONFIG.FX_RING_SCALE_FROM + (CONFIG.FX_RING_SCALE_TO - CONFIG.FX_RING_SCALE_FROM) * ease);
                item.wave.setAlpha(CONFIG.FX_RING_ALPHA * (1 - t));
                // 白芯扩得慢、灭得早，所以环是"先白后星色"地荡开
                const coreT = Math.min(1, t / CONFIG.FX_RING_CORE_SPAN);
                item.core.setAlpha(CONFIG.FX_RING_ALPHA * (1 - coreT))
                    .setScale(1 + (CONFIG.FX_RING_CORE_SCALE - 1) * coreT);
            });

            advance(this.pillars, ms, CONFIG.FX_PILLAR_MS, function (item, t) {
                const ease = Phaser.Math.Easing.Cubic.Out(t);
                item.view.setScale(item.baseX * (1 + (CONFIG.FX_PILLAR_SQUEEZE - 1) * ease),
                    item.baseY * (CONFIG.FX_PILLAR_SCALE_FROM +
                        (CONFIG.FX_PILLAR_SCALE_TO - CONFIG.FX_PILLAR_SCALE_FROM) * ease))
                    .setAlpha(CONFIG.FX_PILLAR_ALPHA * (1 - t * t));
            });

            // 吸入：半径按 1-t² 加速收拢（越近中心越快，才是"被吸走"而不是匀速飘近），
            // 同时绕中心旋 FX_VOID_SPIN 弧度，轨迹是螺线；前 10% 淡入，末段随收拢淡尽
            advance(this.voids, ms, CONFIG.FX_VOID_MS, function (item, t) {
                const radius = item.radius * (1 - t * t);
                const angle = item.angle + CONFIG.FX_VOID_SPIN * t;
                item.view.setPosition(item.cx + Math.cos(angle) * radius, item.cy + Math.sin(angle) * radius)
                    .setScale(item.base * (1 - 0.8 * t))
                    .setAlpha(Math.min(1, t / 0.1) * (1 - t));
            });

            if (this.voidFlashLeft > 0) {
                this.voidFlashLeft -= ms;
                if (this.voidFlashLeft <= 0) {
                    this.voidFlashLeft = 0;
                    this.voidFlashView.setAlpha(0).setVisible(false);
                } else {
                    this.voidFlashView.setAlpha(CONFIG.VOID_FLASH_ALPHA * this.voidFlashLeft / CONFIG.VOID_FLASH_MS);
                }
            }

            this.updateIce(ms);

            advance(this.letters, ms, CONFIG.FX_LETTER_MS, function (item, t) {
                const ease = Phaser.Math.Easing.Cubic.Out(t);
                item.view.setY(item.fromY - CONFIG.FX_LETTER_RISE * ease)
                    .setScale(item.from * (1 + (CONFIG.FX_LETTER_SCALE - 1) * ease))
                    .setAlpha(1 - t);
            });

            advance(this.scores, ms, CONFIG.FX_SCORE_MS, function (item, t) {
                item.view.setY(item.fromY - CONFIG.FX_SCORE_RISE * Phaser.Math.Easing.Cubic.Out(t))
                    .setAlpha(1 - t * t);
            });

            const span = CONFIG.FX_RAIN_MS / 1000;
            advance(this.rain, ms, CONFIG.FX_RAIN_MS, function (item, t) {
                item.view.setX(item.fromX + item.drift * span * t)
                    .setY(item.fromY + item.speed * span * t)
                    .setRotation(item.rot + item.spin * span * t)
                    // 前 12% 淡入：一上来就是满 α 会像屏幕脏了一块，不像星光落下来
                    .setAlpha(CONFIG.FX_RAIN_ALPHA * Math.min(1, t / 0.12) * (1 - t * t));
            });
        }

        stats() {
            return {
                flash: poolStats(this.flash),
                ring: poolStats(this.rings),
                letter: poolStats(this.letters),
                score: poolStats(this.scores),
                pillar: poolStats(this.pillars),
                void: poolStats(this.voids),
                ice: poolStats(this.ices),
                rain: poolStats(this.rain),
                sparks: this.sparks.getAliveParticleCount(),
                emitters: 1,
                filter: this.filter,
                frost: this.frost
            };
        }
    }

    objects.Effects = Effects;
})(window.ShootingStars = window.ShootingStars || {});