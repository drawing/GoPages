(function (ns) {
    'use strict';

    const CONFIG = ns.CONFIG;
    const PALETTE = ns.PALETTE;
    const DEPTH = ns.DEPTH;
    const objects = ns.objects = ns.objects || {};
    const ui = ns.utils.ui;

    // 一个"星位"= 一颗星身上的一套外观（halo / ring / shape / core / glint / label）装进一个子容器。
    // 单颗星只有 nodes[0]；双星（5d）多一个 nodes[1]，子容器就是"第二颗放大 / 首颗变暗"的落点——
    // 整组一起缩放，字母与白芯跟着星体同比（单独缩星体会让字母溢出星框），全程只缩不放
    class Star extends Phaser.GameObjects.Container {
        constructor(scene, level, trail) {
            super(scene, 0, CONFIG.SPAWN_Y);

            this.level = level;
            // 键序状态（9d，9g 起可带一组读音）：paths 是仍存活的读音、depth 指向下一个待敲键。
            // 普通字母星 = 单键特例，双星 = 两键特例，多音字单元星 = 多条 path。
            // 三个派生缓存：**nextKeys** 是当前待敲键的集合，判定与白圈只读它（letters.js 因此
            // 不必认识键序长度）；**letter** = nextKeys[0] 是规范键，触屏摊平 / 快照 / 读数 /
            // 双星星位索引读它；**pending** 是规范路径的再下一键，只给键位方案的生成侧数字母
            // （harness/architecture.md）
            this.seq = ns.utils.sequence.create([]);
            this.nextKeys = [];
            this.letter = '';
            this.pending = null;
            // 显示面与星体尺寸（9e）：face 为 null 就是键位方案，星面照旧 = 键本身；单元方案里
            // 它是一个汉字，键序藏在 seq 里、星面绝不显示（显示键 = 抄答案，训练价值归零）。
            // size 由方案决定（单元方案 96、其余 72），一局内恒定——"整体感从头到尾不破"
            this.face = null;
            this.size = CONFIG.STAR_SIZE;
            // 判定圈的显示缩放：圈的世界半径 = 星体尺寸的一半（72 → 36，与 9d 之前逐字相同）
            this.ringScale = CONFIG.STAR_SIZE / (CONFIG.RING_RADIUS * 2);
            this.speed = 0;
            // 这一帧真正用于位移的速度（speed × 减速区 × 冰晶），读数读它，位移读它，
            // 只有它含两条临时倍率；this.speed 始终只是"生成侧给的基准"，爬升才就地乘它
            this.fallSpeed = 0;
            this.baseX = 0;
            this.phase = 0;
            this.alive = false;
            this.bornAt = 0;
            this.age = 0;
            // targeted = 重复字母里最低那颗（敲这个字母掉的就是它，白脉冲）；
            // near = 进入下方 1/5 的减速区（快坠毁了，暖橘脉冲）。两个含义不能共用一种描边
            this.targeted = false;
            this.near = false;
            this.popping = false;
            // 5d 双星：pair = 这一轮是不是一对，armed = 第一颗敲掉了没，armT = 那段过渡的 0..1，
            // spanExtra = 比单颗星多出来的那截半宽（生成侧的横向间隔要把它算进去）
            this.pair = false;
            this.armed = false;
            this.armT = 0;
            this.spanExtra = 0;
            // 类型表的那一行（5a）：颜色、四芒显隐、速度系数、得分奖励、命中特效全从它读。
            // 不叫 type——GameObject.type 是 Phaser 用来分辨对象种类的字段（display.js 的
            // rescaleText 就靠它认 Text），占用它同 1a 把贴图叫 shape 不叫 body 一样是埋雷
            this.typeSpec = ns.starType(null);
            this.color = this.typeSpec.colors[0];
            this.trail = trail || null;
            this.trailClock = 0;

            this.nodes = [this.buildNode()];
            this.node = this.nodes[0];
            this.link = null;

            this.setDepth(DEPTH.star);
            this.setActive(false).setVisible(false);
            scene.add.existing(this);
        }

        buildNode() {
            const scene = this.scene;
            const level = this.level;
            // 9e 单元方案：星面是显示面（一个汉字）而不是字母，字号与位置读 levelFor 合成好的
            // 造型几何——进度点在星体最宽那一段、显示面在下方（harness/ui.md 单体序列星节）。
            // 键位方案照旧用档位字号 + 那 −2px（小写拉丁在 em 框里偏下才要补，汉字是居中的不吃它）。
            // 两者都只由 level 决定、一局内恒定，所以字号与位置建的时候就定死，paint 不再碰
            const art = level.units;
            const node = { letter: '', family: CONFIG.FONT, pips: null };
            node.halo = scene.add.image(0, 0, 'glow').setScale(CONFIG.STAR_HALO_SCALE).setAlpha(CONFIG.STAR_HALO_ALPHA);
            node.ring = scene.add.image(0, 0, 'ring').setAlpha(0).setVisible(false);
            // 不叫 body：Container.body 是 arcade 物理体的保留字段
            node.shape = scene.add.image(0, 0, 'starHi').setDisplaySize(CONFIG.STAR_SIZE, CONFIG.STAR_SIZE);
            node.core = scene.add.image(0, 0, 'starCore');
            // 四芒高光是白色、不 tint：Canvas 渲染器忽略 setTint（1a 起记过六次），金色星在
            // fallback 下会退化成白星，这层不 tint 的芒是那时唯一还分得出类型的东西
            node.glint = scene.add.image(0, 0, 'starGlint')
                .setDisplaySize(CONFIG.STAR_SIZE, CONFIG.STAR_SIZE)
                .setVisible(false);
            node.label = ui.text(scene, 0, art ? art.faceY : CONFIG.LETTER_OFFSET_Y, '', {
                fontSize: (art ? art.face : level.fontSize) + 'px',
                fontStyle: '700',
                color: PALETTE.letter,
                stroke: PALETTE.starlight,
                strokeThickness: level.stroke
            });
            node.view = scene.add.container(0, 0, [node.halo, node.ring, node.shape, node.core, node.glint, node.label]);
            this.add(node.view);
            return node;
        }

        // 双星的第二个星位与连线按需建一次，建过就常驻（同对象池纪律：换项只换状态，不销毁重建）——
        // Lv1–2 根本不出现双星，不给每颗池星都挂一份
        ensurePair() {
            if (this.nodes.length < 2) { this.nodes.push(this.buildNode()); }
            if (!this.link) {
                this.link = this.scene.add.graphics();
                // 连线插在两颗星之下：它画的是圆心到圆心，露出来的只有中间那一段
                this.addAt(this.link, 0);
            }
        }

        // 9e 单体序列星的进度点按需建一次，建过就常驻（同 ensurePair 的池纪律）：
        // 键位方案整局都走不到这里，不给 24 颗池星各挂一份 Graphics
        ensurePips(node) {
            if (!node.pips) {
                node.pips = this.scene.add.graphics();
                // 挂在星位容器的最上层：点要压在白芯之上，否则亮点落在白芯里就溶掉了。
                // 挂在 node.view 而不是 Star 容器，于是它跟星体同比缩放、也不跟贴图自转
                node.view.add(node.pips);
            }
            return node.pips;
        }

        // 进度反馈画在星体自己身上（harness/gameplay.md 键序判定节）：一排点 = 完整键序，
        // 亮几格 = 敲对了几键，点本身不透露是哪一键。只在 spawn / advance 重画，绝不每帧
        // （同双星连线那条纪律）。点是 Graphics 不烤纹理：2.2px 半径的圆是硬边，矢量跟着容器缩放不会糊
        drawPips() {
            const node = this.nodes[0];
            const art = this.level.units;
            if (!art) {
                if (node.pips) { node.pips.clear().setVisible(false); }
                return;
            }
            const pips = this.ensurePips(node);
            pips.clear();
            // 总格数 = 这个字的键数。多音字（9g）也只收各读音等长的，所以这个数唯一——
            // 多音字与单音字的点排画出来一模一样，9e 已验收的几何一行不动
            const total = ns.utils.sequence.total(this.seq);
            // 单键特例没有进度可显示（单元方案最短也是 2 键，这一支只是兜底）
            if (total < 2) { pips.setVisible(false); return; }
            pips.setVisible(true);
            const lit = this.seq.depth;
            // 整排居中：键序长度变了排布仍对称，2 键星的点是 6 键星的前缀——
            // 读起来是"同一颗星在长进度"，不是另一种星
            const from = -(total - 1) * art.pipPitch / 2;
            for (let i = 0; i < total; i++) {
                const x = from + i * art.pipPitch;
                const on = i < lit;
                // 暗点是"空插槽"，所以整排从头就看得见还剩几键；亮点大一档 + 深色描边——
                // 进度靠大小也读得出（色觉友好，同"类型靠形状辨识"那条纪律），描边是怕它落在白芯上溶掉。
                // 点不染星色也不用金：星色是类型 / 身份通道，金是金色星的身份色
                pips.fillStyle(ns.tint(on ? PALETTE.starlight : PALETTE.letter), on ? 1 : CONFIG.UNIT_PIP_DIM_ALPHA);
                pips.fillCircle(x, art.pipY, art.pipR * (on ? 1 : CONFIG.UNIT_PIP_DIM_SCALE));
                if (on) {
                    pips.lineStyle(CONFIG.UNIT_PIP_EDGE, ns.tint(PALETTE.letter), CONFIG.UNIT_PIP_EDGE_ALPHA);
                    pips.strokeCircle(x, art.pipY, art.pipR);
                }
            }
        }

        // keys 是这颗星的**键序内容**：键位方案是一串键（单颗星一个、双星两个，生成侧保证两个不同），
        // 单元方案是**一组读音**（9g 多音字任一读音都算对，单读音字就是一组里只有一条）——
        // sequence.create 按 Array.isArray(输入[0]) 分辨两种。face 是显示面（缺参 = 星面就是键本身）。
        // spec 是 STAR_TYPES 里的那一行（缺参回落普通星）。速度已经由生成侧乘过 speedMul：
        // 爬升（2c）就地乘 star.speed，两条倍率因此天然叠在一起，金色星爬升后仍是 1.3×
        spawn(keys, x, speed, spec, face) {
            this.typeSpec = ns.starType(spec && spec.id);
            this.pair = !!this.typeSpec.pair;
            if (this.pair) { this.ensurePair(); }
            // 星体尺寸从合成档位读（levelFor 已算好）：它是**方案**属性不是类型属性，
            // 类型表给不出它。判定圈跟着同比长——96 的星尖在 34.7，圈还停在 36 就会贴着星尖
            this.face = face || null;
            this.size = this.level.units ? this.level.units.body : CONFIG.STAR_SIZE;
            this.ringScale = this.size / (CONFIG.RING_RADIUS * 2);
            this.speed = speed;
            this.baseX = x;
            this.phase = Math.random() * Math.PI * 2;
            this.age = 0;
            this.trailClock = 0;
            this.alive = true;
            this.bornAt = this.scene.time.now;
            this.armed = false;
            this.armT = 0;
            this.spanExtra = this.pair ? CONFIG.PAIR_SPAN - CONFIG.STAR_SIZE / 2
                : (this.size - CONFIG.STAR_SIZE) / 2;
            // 星色从类型表取：普通星与双星都在五色里随机，金色星恒金——颜色是类型身份的一部分
            // （harness/ui.md）。一对两颗同色，才读得成一个整体
            const colors = this.typeSpec.colors;
            this.color = colors[Math.floor(Math.random() * colors.length)];

            const disk = !!this.typeSpec.disk;
            const tint = ns.tint(this.color);
            // 键序先建再 paint：单元方案的入参是**一组读音**不是键串，paint 要的是派生出来的
            // 规范键（双星则是它自己那条 path 上的两个键，两个星位各带一个）
            this.seq = ns.utils.sequence.create(keys);
            this.syncKeys();
            const pairKeys = this.pair ? this.seq.paths[0] : null;
            this.paint(this.nodes[0], pairKeys ? pairKeys[0] : this.letter, disk, tint, this.face);
            if (this.nodes[1]) {
                // 上一轮是双星、这一轮不是：第二个星位与连线都要收起来
                if (this.pair) { this.paint(this.nodes[1], pairKeys[1], disk, tint); }
                this.nodes[1].view.setVisible(this.pair);
            }
            if (this.link) { this.link.setVisible(this.pair); }
            this.node = this.nodes[0];
            // 每轮 spawn 都重画进度点：池星绝不能带着上一条命的进度上场
            this.drawPips();
            this.layout(1, 0);
            this.setPosition(x, CONFIG.SPAWN_Y);
            this.setPulse(false);
            this.popping = true;
            this.setScale(CONFIG.SPAWN_POP_FROM);
            this.setActive(true).setVisible(true);
            return this;
        }

        // 一个星位的全部外观从这里走：换字 / 换纹理 / 换色 / 换尺寸都是改这一份，双星的两个星位共用它，
        // 于是两颗不会画得不一样。
        // 黑洞的颜色已烤死在纹理里，不 tint（深色核心乘 tint 只会更黑）；白芯藏起来——
        // 它是"星星中心渐白"的那层，留在黑洞上就成了白心甜甜圈。
        // 造型纹理从类型表取（5c 起三张：五角星 / 六角冰晶 / 吸积盘），不按标志分派。
        // setTexture 会按新纹理重置尺寸，显示尺寸要重新压回 this.size。
        // letter 是这个星位的**键**（触屏摊平与命中快照读它），glyph 是显示的那个字形——
        // 缺参就是键本身（键位方案与双星），单元方案传进来的是一个汉字（9e）
        paint(node, letter, disk, tint, glyph) {
            node.letter = letter;
            // 星体 / 四芒 / 白芯 / 光晕一起同比：只长星体的话，96 的星上就是一颗小白点 + 短芒。
            // 一律走 setDisplaySize 不走星位容器 scale——display.js 的 rescaleText 会把文字的
            // resolution 补偿洗回基准，容器一放大字就糊（harness/architecture.md 已知坑）
            const size = this.size;
            const ratio = size / CONFIG.STAR_SIZE;
            node.shape.setTexture(this.typeSpec.texture).setDisplaySize(size, size);
            node.glint.setDisplaySize(size, size);
            node.core.setDisplaySize(CONFIG.STAR_CORE_SIZE * ratio, CONFIG.STAR_CORE_SIZE * ratio);
            if (disk) {
                node.shape.clearTint();
                // 光晕染吸积盘的内圈紫：深色核心贴着夜空背景几乎不可见，这圈紫光是轮廓的一部分
                node.halo.setTint(ns.tint(PALETTE.voidDiskIn));
            } else {
                node.shape.setTint(tint);
                node.halo.setTint(tint);
            }
            node.halo.setAlpha(CONFIG.STAR_HALO_ALPHA).setScale(CONFIG.STAR_HALO_SCALE * ratio);
            node.core.setVisible(!disk);
            node.glint.setVisible(this.typeSpec.glint);
            // 数字换等宽字体（8，harness/ui.md）；汉字天然落回正文字体（glyphFamily 是字符串比较）。
            // setFontFamily 会重栅格化整张文本纹理，池星是复用的，所以按 node.family 记忆只在
            // 字形类变化时调（同 Effects.emitScore 的 setFontSize 纪律）。字号与位置在建的时候就
            // 按 level.units 定死了，这里不碰——一局内恒定，碰一次就白栅格化一次
            const shown = glyph || letter;
            const family = ui.glyphFamily(shown);
            if (node.family !== family) { node.family = family; node.label.setFontFamily(family); }
            node.label.setText(shown);
            node.view.setAlpha(1);
        }

        // 双星的几何全由这两个量推：spread = 间距收到多少倍，arm = 首颗敲掉那段过渡的缓动量 0..1。
        // 单颗星也走这里（间距 0、缩放恒 1、透明度恒 1），于是"落定必须精确回到 1"这条纪律只有一处
        layout(spread, arm) {
            const pair = this.pair;
            const gap = pair ? CONFIG.PAIR_GAP * spread / 2 : 0;
            const lead = pair ? CONFIG.PAIR_LEAD_SCALE : 1;
            // 单颗星走 pair ? -gap : 0 而不是 -gap：0 取负是 -0，位置比较与 JSON 快照都会把它当成另一个值
            this.nodes[0].view.setX(pair ? -gap : 0)
                .setScale(lead)
                .setAlpha(pair ? 1 - (1 - CONFIG.PAIR_DIM) * arm : 1);
            const second = this.nodes[1];
            if (second) {
                second.view.setX(gap)
                    .setScale(pair ? CONFIG.PAIR_TAIL_SCALE + (lead - CONFIG.PAIR_TAIL_SCALE) * arm : 1)
                    .setAlpha(1);
            }
            if (pair) { this.drawLink(gap); }
        }

        // 连线 + 指向第二颗的箭头：顺序的形状通道（大那颗现在敲、箭头指着下一颗，harness/ui.md），
        // 色觉障碍下也读得出。硬边用 Graphics 不烤纹理，跟着容器缩放也不会糊；
        // 首颗敲掉后箭头就不画了——顺序已经走完，剩下的只是一段变短的连线
        drawLink(gap) {
            const link = this.link;
            link.clear();
            link.lineStyle(CONFIG.PAIR_LINK_WIDTH, ns.tint(this.color), CONFIG.PAIR_LINK_ALPHA);
            link.lineBetween(-gap, 0, gap, 0);
            if (this.armed) { return; }
            const chevron = CONFIG.PAIR_CHEVRON;
            const tip = gap - CONFIG.STAR_SIZE * CONFIG.PAIR_TAIL_SCALE / 2 - chevron / 2;
            link.lineBetween(tip - chevron, -chevron * 0.6, tip, 0);
            link.lineBetween(tip - chevron, chevron * 0.6, tip, 0);
        }

        // nextKeys / letter / pending 永远从键序状态派生：判定与白圈读 nextKeys（待敲键的集合，
        // 多音字星多于一个），触屏摊平 / 快照 / 读数 / 双星星位索引读 letter（规范键 = 集合第一个），
        // 键位方案的生成侧数同屏字母读 letter + pending。三个缓存只在 spawn / advance 时同步
        syncKeys() {
            this.nextKeys = ns.utils.sequence.nextKeys(this.seq);
            this.letter = this.nextKeys[0] || '';
            this.pending = ns.utils.sequence.pendingKey(this.seq);
        }

        // 敲对一键、推进键序（9d，双星首颗是两键特例；9g 起 key 是玩家真敲下的那一键，
        // 多音字星按它过滤存活读音——敲对第一键就锁定那条读音）。不计分不动连击，星留在场上。
        // nextKeys 换成了新的候选集，判定与白圈因此自动跟着走。
        // 双星另演首颗变暗 / 连线缩短 / 第二颗放大（过渡由 step 按闭式缓动推）；
        // 单体序列星（9e）只亮一格进度点，不走那段线连视觉
        advance(key) {
            ns.utils.sequence.advance(this.seq, key);
            this.syncKeys();
            this.armed = true;
            this.armT = 0;
            if (this.pair) {
                this.node = this.nodes[this.seq.depth];
                this.applyRing();
            } else {
                this.drawPips();
            }
            return this;
        }

        // 位移只由这里发生，且只接受已 clamp 的 dt：切标签页回来不会瞬移。
        // chill 是 5c 的冰晶全局减速，GameScene 每帧现读后传进来（没有减速时是 1）
        step(dt, chill) {
            this.age += dt;
            // 减速区（harness/gameplay.md）与 5c 的冰晶都只作用在这一帧的位移上，绝不写回 this.speed——
            // 爬升时 director 会就地乘它，写回就把两条临时减速攒成永久减速
            this.setNear(this.y >= CONFIG.NEAR_Y);
            this.fallSpeed = this.speed * (this.near ? CONFIG.NEAR_SPEED_MUL : 1) * chill;
            this.y += this.fallSpeed * dt;
            this.x = this.baseX + CONFIG.SWAY_AMP * Math.sin(this.age * CONFIG.SWAY_FREQ + this.phase);
            // 弹入与自转跟脉冲圈一样在 step 里算，不挂 Tween：池化对象每轮回收都要 kill，
            // 而这里天然跟着 clamp 后的 dt 走，暂停与切标签页时自动停住
            if (this.popping) {
                const t = this.age * 1000 / CONFIG.SPAWN_POP_MS;
                if (t >= 1) {
                    // 落定必须精确停在 1：字母是预栅格化纹理，停在 0.9998 也会一直被重采样
                    this.popping = false;
                    this.setScale(1);
                } else {
                    this.setScale(CONFIG.SPAWN_POP_FROM + (1 - CONFIG.SPAWN_POP_FROM) * Phaser.Math.Easing.Back.Out(t));
                }
            }
            // 双星敲掉第一颗那段过渡（变暗 / 连线缩短 / 第二颗放大）同一条纪律，只属于线连造型。
            // armT 到 1 就停手：Cubic.Out(1) 恰为 1，末态是表里的精确值，不留浮点残渣
            if (this.pair && this.armed && this.armT < 1) {
                this.armT = Math.min(1, this.armT + dt * 1000 / CONFIG.PAIR_ARM_MS);
                const ease = Phaser.Math.Easing.Cubic.Out(this.armT);
                this.layout(1 + (CONFIG.PAIR_CONTRACT - 1) * ease, ease);
            }
            // 只转星体贴图不转容器：字母是预栅格化纹理，跟着转 5° 就要斜向重采样，必然发虚。
            // 黑洞是连续自转（吸积盘在旋）而不是 ±5° 摆动，按 age 闭式算，同弹入与脉冲的纪律。
            // 双星的两个星位共用同一个 phase，两颗同步摆——它们是一个物体，不该各转各的
            const disk = this.typeSpec.disk;
            const spin = disk ? 0 : CONFIG.SPIN_AMP * Math.sin(this.age * CONFIG.SPIN_FREQ + this.phase);
            for (const node of this.nodes) {
                if (!node.view.visible) { continue; }
                if (disk) {
                    node.shape.rotation = this.phase + this.age * CONFIG.VOID_SPIN_RATE;
                } else {
                    node.shape.rotation = spin;
                    // 四芒跟着星体一起转，才是"同一颗星的高光"而不是叠在它上面的另一层
                    node.glint.rotation = spin;
                }
            }
            // 弹入那 240ms 不拖尾：星还没成形，且那几节残影会全堆在出生点上。
            // 黑洞也不拖：光尾是五角星纹理，拖在吸积盘后面像另一颗普通星的尾巴，
            // "没有尾"本身就是它与真星的又一条形状差异。
            // 双星只拖一条，从两颗中间发（this.x）：各拖一条会把 60 节的残影池顶穿，
            // 而居中那条恰好强化"这是一个整体"（harness/ui.md）
            if (this.trail && !this.popping && !disk) {
                this.trailClock += dt * 1000;
                const gap = this.speed >= CONFIG.TRAIL_FAST_SPEED ? CONFIG.TRAIL_FAST_INTERVAL_MS : CONFIG.TRAIL_INTERVAL_MS;
                if (this.trailClock >= gap) {
                    // 一帧最多一节：低帧率时宁可少拖几节，也不把欠账攒起来补发（补发只会更卡）
                    this.trailClock = 0;
                    this.trail.emit(this.x, this.y, this.color, this.node.shape.rotation);
                }
            }
            const ring = this.node.ring;
            if (ring.visible) {
                const wave = 0.5 + 0.5 * Math.sin(this.age * this.ringRate);
                ring.setAlpha(this.ringMin + (this.ringMax - this.ringMin) * wave);
                ring.setScale(this.ringBase * (1 + CONFIG.PULSE_SCALE * wave));
            }
        }

        // 同屏出现重复字母时，最低那颗亮白色描边脉冲；1c 的命中目标就是它
        setPulse(on) {
            if (this.targeted === on) { return; }
            this.targeted = on;
            this.applyRing();
        }

        // 减速区（harness/gameplay.md）。光晕同时加亮：即使描边被"我是命中目标"的白圈占了，
        // 紧迫度也还读得出来。双星两个星位的光晕一起加亮（已敲暗那颗的透明度压在它上面，仍是暗的）
        setNear(on) {
            if (this.near === on) { return; }
            this.near = on;
            const alpha = on ? CONFIG.NEAR_HALO_ALPHA : CONFIG.STAR_HALO_ALPHA;
            for (const node of this.nodes) { node.halo.setAlpha(alpha); }
            this.applyRing();
        }

        // 白 = 敲这个字母掉的就是它；暖橘 = 它快坠毁了。Canvas 渲染器忽略 setTint（1a 起记过三次），
        // 所以大小与频率也得分开，光靠颜色在 fallback 下读不出区别。
        // 双星只给"轮到敲的那一颗"上圈：还没轮到的那颗不参与判定，圈指着它就是撒谎
        applyRing() {
            const on = this.targeted || this.near;
            for (const node of this.nodes) {
                if (node === this.node && on) { continue; }
                node.ring.setVisible(false).setAlpha(0).setScale(1);
            }
            if (!on) { return; }
            const targeted = this.targeted;
            this.node.ring.setVisible(true).setTint(ns.tint(targeted ? PALETTE.starlight : PALETTE.horizon));
            this.ringRate = targeted ? CONFIG.PULSE_RATE : CONFIG.NEAR_PULSE_RATE;
            this.ringMin = targeted ? CONFIG.PULSE_ALPHA_MIN : CONFIG.NEAR_PULSE_ALPHA_MIN;
            this.ringMax = targeted ? CONFIG.PULSE_ALPHA_MAX : CONFIG.NEAR_PULSE_ALPHA_MAX;
            // 圈跟着星体同比长（9e）：世界半径恒为星体尺寸的一半，72 星体仍是 36
            this.ringBase = (targeted ? 1 : CONFIG.NEAR_PULSE_SCALE) * this.ringScale;
        }

        // 命中特效要的快照（harness/ui.md：爆开放的是拷贝，真星立刻归还池）。位置 / 颜色 / 字母 /
        // 自转角 / 缩放 / 光晕都在归还前取；双星取"轮到敲的那一颗"，另附已经敲暗的那一颗（spent），
        // 于是"两颗一起消除"由 Effects 的类型专属件补齐，GameScene 不必认识星位。
        // face 是显示面（9e）：击落那一下飘的是它（敲完「好」飘出"好"），推进那一下飘的才是键
        snapshot() {
            const info = this.shot(this.node);
            info.letter = this.letter;
            info.face = this.face;
            info.type = this.typeSpec.id;
            if (this.pair && this.armed) {
                info.spent = this.shot(this.nodes[0]);
                info.spent.type = info.type;
            }
            return info;
        }

        // scale 是 Star 容器（弹入）与星位子容器（双星的大小）两层的乘积：少乘一层，
        // 爆开的拷贝就比真星大一档（harness/architecture.md）。
        // size 是这颗星的星体显示尺寸（9e）：闪白顶替的就是那颗真星，尺寸对不上死亡那一帧会跳一下大小
        shot(node) {
            return {
                x: this.x + node.view.x,
                y: this.y,
                color: this.color,
                letter: node.letter,
                rotation: node.shape.rotation,
                scale: this.scaleX * node.view.scaleX,
                size: this.size,
                halo: node.halo.alpha
            };
        }

        despawn() {
            this.alive = false;
            this.face = null;
            this.setPulse(false);
            this.setNear(false);
            // 进度点清空并藏起来：池星复用，下一条命不能带着上一条的进度上场（同 nodes[1] / link 的收起）
            const pips = this.nodes[0].pips;
            if (pips) { pips.clear().setVisible(false); }
            this.setActive(false).setVisible(false);
        }
    }

    objects.Star = Star;
})(window.ShootingStars = window.ShootingStars || {});
