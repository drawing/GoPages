(function (ns) {
    'use strict';

    const PALETTE = {
        skyTop: '#070d24',
        skyNight: '#1b2a5e',
        skyDusk: '#5b3f7d',
        skyEmber: '#e8845c',
        ridge: '#1a1030',
        ridgeFar: '#2a1c47',
        treeline: '#0d0720',
        duskVeil: '#7c4dff',
        horizon: '#f6ad55',
        starlight: '#ffffff',
        starlightWarm: '#fde68a',
        starColors: ['#ffd700', '#f6ad55', '#fc8181', '#9ae6b4', '#63b3ed', '#b794f4'],
        gold: '#ffd700',
        ice: '#bee3f8',
        iceEdge: '#63b3ed',
        voidCore: '#0a0a12',
        voidDiskIn: '#805ad5',
        voidDiskOut: '#ed8936',
        letter: '#2d3748',
        hudBar: '#0f1b3d',
        hudText: '#ffffff',
        hudMuted: '#a9b6e8',
        surface: '#141d43',
        surfaceEdge: '#33427f',
        overlay: '#0b1230',
        scrim: '#05091c',
        success: '#9ae6b4',
        warning: '#f6ad55',
        danger: '#fc8181',
        info: '#63b3ed'
    };

    // 三张音阶表（6a/6b，harness/ui.md 声音节）。放在 PALETTE 旁边同一个理由：被下面那张 AUDIO 表
    // 的多行共用，写进行里就要抄几遍，抄出来的表迟早对不上
    // 命中音阶：A 大调五声音阶两个八度（440 = A4）。金色琶音与冰晶颤音也拿它当根音——
    // 特殊星同样吃"连击越高音越高"，专属的只是叠在上面的音色
    const HIT_SCALE = [440, 494, 554, 659, 740, 880, 988, 1109, 1319, 1480];
    // 倒计时 3-2-1：C 大三和弦上行（C5 E5 G5），GO 从最后一格 G5 再扫上一个八度
    const COUNT_SCALE = [523, 659, 784];
    // 标题四字落定：与命中音阶同族的上行四音（E5 F#5 A5 B5），一字一音
    const TITLE_SCALE = [659, 740, 880, 988];

    const CONFIG = {
        WIDTH: 800,
        HEIGHT: 600,
        SPAWN_Y: -48,
        HORIZON_Y: 552,
        DELTA_MAX: 50,
        FADE_MS: 220,
        BOOT_MIN_MS: 680,
        BOOT_STEP_MS: 105,
        STAR_SIZE: 72,
        // 下落的星星另烤一张 3× 超采样纹理（starHi）：camera zoom 把世界放大 RENDER_SCALE 倍，
        // 72px 的源要被放大重采样，圆角五角星的边缘就糊了。倍数对齐 display.js 的 MAX_SCALE，
        // 任何 DPR 下都只缩不放，所以不需要在 syncRenderScale 里重烤
        STAR_SUPERSAMPLE: 3,
        STAR_POOL_SIZE: 24,
        // 四芒高光（5a 的金色星专属，harness/ui.md）：横竖各一条 2px 白光、α0.5，每条从中心伸出 34。
        // 34 按"从中心算起"实现，不是"整条长 34"——整条 34（±17）会整段埋在 r=16 的白芯底下，
        // 5.3 要的"与普通星一眼能分"就没了。2px 硬边在 zoom 下最先糊，所以与 starHi 同倍数超采样
        STAR_GLINT_ARM: 34,
        STAR_GLINT_WIDTH: 2,
        STAR_GLINT_ALPHA: 0.5,
        // 光晕参数两处共用：命中闪白放的是星体拷贝，光晕对不上就会在死亡那一帧跳一下亮度
        STAR_HALO_SCALE: 0.66,
        STAR_HALO_ALPHA: 0.34,
        // 白芯的**显示**尺寸。纹理仍烤 32（软径向渐变没有硬边可糊，单元星按需放大到 42.7 是
        // 记在案的例外，harness/architecture.md 已知坑）；显式写出来是因为星体放大时白芯必须同比，
        // 否则 96 的星上就是一颗小白点。五个消费点里只有 Star 与命中闪白需要跟着星体尺寸走
        STAR_CORE_SIZE: 32,
        // 9e 单体序列星（harness/ui.md 单体序列星节）。星体从 72 长到 96 是几何裁决不是审美：
        // 五角星（外尖 26 / 内凹 13）的实心区最宽处在 y ≈ −8（半宽 ±24.7），y=+8 只剩 ±13.1、
        // y=+13 收成一点（底部那个 V 形缺口），竖向实心带总共 23.5px——Lv5 的汉字面（墨迹半高 11.2）
        // + 净空 + 一排点约 27px，72 装不下，穷举过没有任何排布能救。96 = 72 × 4/3，剪影自相似，
        // tint 边与白芯的比例和今天完全一致，"看上去还是同一颗星，只是大一档"。
        // 放大一律走 setDisplaySize 不走星位容器 scale：display.js 的 rescaleText 会把文字的
        // resolution 强设回 RENDER_SCALE，"容器放大 + resolution 补偿"活不过一次转屏
        UNIT_STAR_SIZE: 96,
        // 面字号 = 档位 fontSize × 这个比：汉字按面积读，34px 的拉丁字号照抄到汉字上会捅出白芯。
        // MIN 是可读性红线（原未决 #8 的定案），MAX 挡住低档位把字放到白芯外
        UNIT_FACE_RATIO: 0.66,
        UNIT_FACE_MIN: 18,
        UNIT_FACE_MAX: 26,
        // 汉字墨迹半高 ≈ 0.44 × 字号（em 的 88%），描边再向外扩 stroke/2——面位置由它推，
        // 保证墨迹底边不越星体底部那个缺口
        UNIT_FACE_INK: 0.44,
        // 显示面可用的横向预算（× 星体尺寸）：取墨迹底边那一段的实心宽，9f 的多格拉丁面靠它缩到 fit
        UNIT_FACE_BOX: 0.375,
        // 五角星剪影的两条比例（paintStar 的 outer 26 / inner 13 逐边求交得出）：
        // 底部 V 形缺口的顶点在 0.1806 × 尺寸处（显示面墨迹底不得越过它），
        // 进度点那一排（y = UNIT_PIP_Y × 尺寸）的实心半宽是 0.2512 × 尺寸
        UNIT_NOTCH_Y: 0.1806,
        UNIT_BAND_HALF: 0.2512,
        // 进度点：一排画在星体内部最宽那一段（显示面之上），敲对一键亮一格。
        // 点距 = 3 倍点径，相邻两点净空一个半径，亮暗才分得开
        UNIT_PIP_Y: -0.125,
        UNIT_PIP_R: 2.2,
        UNIT_PIP_PITCH: 6.6,
        UNIT_PIP_GAP: 2.5,
        // 暗点比亮点小一档 ⇒ 进度靠大小也读得出（色觉友好，同"类型靠形状辨识"那条纪律）
        UNIT_PIP_DIM_ALPHA: 0.55,
        UNIT_PIP_DIM_SCALE: 0.8,
        // 亮点必须带深色描边：它有一半概率落在白芯上，没描边就溶掉
        UNIT_PIP_EDGE: 1,
        UNIT_PIP_EDGE_ALPHA: 0.6,
        // 判定圈（白 / 暖橘）纹理烤到 128、圈半径 48：它是 2.5px 硬边、最经不起放大，
        // 而 96 星体的圈要长到世界半径 48 才留得出与今天同比例的净空。
        // 世界半径 = 星体尺寸的一半（72 → 36，与 9d 之前的值逐字相同；96 → 48），
        // 所以显示 scale = size / (RING_RADIUS × 2)：72 星体从"放大 1.06"变成纯缩 0.75，比原先更锐
        RING_BAKE: 128,
        RING_RADIUS: 48,
        SPAWN_MARGIN: 52,
        SWAY_AMP: 14,
        SWAY_FREQ: 1.15,
        // 出生弹入 0.2 → 1.08 → 1.0（Back.easeOut 的固有 10% 过冲），落定必须精确回到 1
        SPAWN_POP_MS: 240,
        SPAWN_POP_FROM: 0.2,
        // ±5° 缓慢自转，周期约 4.7s，只转星体贴图不转容器（字母保持正立才不发虚）
        SPIN_AMP: Math.PI / 36,
        SPIN_FREQ: 1.35,
        // 下落光尾（harness/ui.md）。间隔门槛取 Lv4 的基准速度：Lv1–3 每 40ms 拖一节、Lv4/Lv5 每 25ms，
        // 无尽爬升越过 175px/s 后自动切到短间隔，不用按档位 id 再判一次
        TRAIL_POOL_SIZE: 60,
        TRAIL_INTERVAL_MS: 40,
        TRAIL_FAST_INTERVAL_MS: 25,
        TRAIL_FAST_SPEED: 175,
        TRAIL_LIFE_MS: 300,
        TRAIL_ALPHA: 0.32,
        TRAIL_ALPHA_BOOST: 0.5,
        TRAIL_SCALE_FROM: 0.85,
        TRAIL_SCALE_TO: 0.5,
        // 加亮门槛是倍率不是连击数，取值必须是 COMBO_TIERS 里真实存在的一档
        TRAIL_BOOST_AT: 3,
        // 命中五件套（harness/ui.md）。四个短命池 + 一个粒子发射器单例，数字全在这里，Effects.js 不写死魔数
        FX_FLASH_MS: 80,
        FX_FLASH_SCALE: 1.35,
        FX_FLASH_ALPHA: 0.9,
        FX_FLASH_POOL_SIZE: 6,
        // 冲击波源纹理 256px、显示基准 96px：放大到 2.4× 是 230px，仍在源尺寸内（只缩不放）
        FX_SHOCK_SIZE: 256,
        FX_RING_MS: 250,
        FX_RING_SIZE: 96,
        FX_RING_SCALE_FROM: 0.3,
        FX_RING_SCALE_TO: 2.4,
        FX_RING_ALPHA: 0.9,
        // 白芯只活前 45% 的寿命、相对缩到 0.55，先白后星色，这是"白 → 星色渐变"的时间那一半
        FX_RING_CORE_SPAN: 0.45,
        FX_RING_CORE_SCALE: 0.55,
        FX_RING_POOL_SIZE: 6,
        FX_LETTER_MS: 320,
        FX_LETTER_SCALE: 1.8,
        FX_LETTER_RISE: 40,
        FX_LETTER_POOL_SIZE: 8,
        FX_SCORE_MS: 620,
        FX_SCORE_RISE: 50,
        FX_SCORE_SIZE_MIN: 16,
        FX_SCORE_SIZE_MAX: 26,
        // 与 TRAIL_BOOST_AT 同理：金色门槛必须是表里真有的倍率档
        FX_SCORE_GOLD_AT: 3,
        // 飘分挪到星体右侧，不然和同时上飘的字母叠在一起；贴右边缘时翻到左侧
        FX_SCORE_OFFSET_X: 34,
        FX_SCORE_OFFSET_Y: -6,
        FX_SCORE_EDGE: 96,
        FX_SCORE_POOL_SIZE: 8,
        FX_SPARK_MIN: 14,
        FX_SPARK_MAX: 20,
        FX_SPARK_SPEED_MIN: 100,
        FX_SPARK_SPEED_MAX: 260,
        FX_SPARK_GRAVITY: 180,
        FX_SPARK_LIFE_MIN: 500,
        FX_SPARK_LIFE_MAX: 900,
        FX_SPARK_SCALE_FROM: 0.26,
        FX_SPARK_SCALE_TO: 0.04,
        FX_SPARK_SPIN: 300,
        FX_SPARK_MAX_ALIVE: 240,
        // 5a 的类型专属命中件：金色星的一道光柱，底端锚在命中点、向上冲。软渐变没有硬边，
        // 不需要 starHi 那样的超采样；显示尺寸 × 最大 scale 不超过源纹理，仍是"只缩不放"
        FX_PILLAR_MS: 420,
        FX_PILLAR_SOURCE_W: 64,
        FX_PILLAR_SOURCE_H: 256,
        FX_PILLAR_WIDTH: 40,
        FX_PILLAR_HEIGHT: 220,
        FX_PILLAR_SCALE_FROM: 0.45,
        FX_PILLAR_SCALE_TO: 1,
        // 长高的同时横向收窄，才是"冲上去的一道光"而不是慢慢消失的一块矩形
        FX_PILLAR_SQUEEZE: 0.6,
        FX_PILLAR_ALPHA: 0.9,
        FX_PILLAR_POOL_SIZE: 4,
        // 5b 的黑洞。误敲是全局最重的反馈，震屏比坠毁（120ms / 0.006）重一档；
        // zoomTo 的基准是 RENDER_SCALE 而不是 1——display.js 用 camera zoom 锁世界坐标，
        // 直接 zoomTo(1.06) 会把 DPR 补偿整个撤掉（harness/architecture.md）
        VOID_SPIN_RATE: 0.9,
        VOID_ZOOM: 1.06,
        VOID_ZOOM_MS: 180,
        VOID_FLASH_MS: 120,
        VOID_FLASH_ALPHA: 0.85,
        VOID_SHAKE_MS: 250,
        VOID_SHAKE: 0.012,
        // 吸积盘粒子向中心收拢：16 颗一场、500ms 旋入。池 = 3 场并发的保守上界：按爬升封顶的
        // 248ms 一发连敲算，500ms 寿命里最多叠 3 场（5e 后同屏特殊星 ≤2，实际只会更宽裕）
        FX_VOID_COUNT: 16,
        FX_VOID_MS: 500,
        FX_VOID_RADIUS: 60,
        FX_VOID_SIZE: 12,
        FX_VOID_SPIN: 2.6,
        FX_VOID_POOL_SIZE: 48,
        // 真黑洞首次出现的一次性提示（harness/gameplay.md：做，横幅不做慢放）：
        // 写 toys.shooting-stars.voidSeen 之后不再触发
        VOID_HINT_MS: 2600,
        VOID_HINT_FADE_MS: 200,
        VOID_HINT_Y: 208,
        // 5c 的冰晶星。命中后全屏 4 秒：所有星下落 ×0.5 + 冷蓝叠加 + 冰晶飘落。
        // 减速是 GameScene 每帧现读的全局倍率，只作用在当帧位移上，绝不写回 star.speed——
        // 2c 的爬升就地乘那个字段，写回就把 4 秒减速攒成永久减速（同 4.3 减速区的纪律）。
        // 计时器只重置不叠加：连敲两颗冰晶仍是 4 秒，不是 8 秒、更不会 ×0.25
        ICE_MS: 4000,
        ICE_SLOW: 0.5,
        // 冷蓝叠加层 α0.15（harness/ui.md）。不接 postFX.addColorMatrix().saturate(0.4)：那是 WebGL only，
        // Canvas 渲染器下毫无反应，两套实现还要各验一遍——同 3e 压暗层与 5b 黑闪的取舍
        ICE_ALPHA: 0.15,
        // 叠加层与冰晶共用一个 0..1 的量，线性爬 400ms、到期线性落尽：精确归零，不留指数尾巴
        ICE_FADE_MS: 400,
        // 飘落的冰晶复用 iceStar 那张纹理缩到 18px（同 5b 吸入粒子复用 dot），不另烤一张。
        // 出生点铺满整个玩法区而不是只从顶上撒，"缓慢飘落"才是满屏陆续出现的一层氛围。
        // 池 = 并发峰值：2400ms 寿命 ÷ 150ms 一发 = 16 片，池满抢最旧（同光柱 / 吸入的池账目）
        FX_ICE_COUNT: 16,
        FX_ICE_MS: 2400,
        FX_ICE_INTERVAL_MS: 150,
        FX_ICE_SIZE: 18,
        FX_ICE_SPEED_MIN: 22,
        FX_ICE_SPEED_MAX: 46,
        FX_ICE_DRIFT: 18,
        FX_ICE_SPIN: 0.9,
        FX_ICE_ALPHA: 0.55,
        // 5d 的双星。一对 = 一个整体 = 一个同屏名额 / 一条命 / 一次击落（harness/gameplay.md），
        // 两个字母按顺序敲完才消除。节点比常规星小（"两颗小星"），字母与白芯跟着节点同比缩——
        // 单独缩星体会让字母溢出星框，所以每个星位是一个子容器（harness/architecture.md）
        PAIR_GAP: 92,
        PAIR_LEAD_SCALE: 0.86,
        PAIR_TAIL_SCALE: 0.64,
        // 顺序只靠形状与大小读（色觉友好，harness/ui.md）：大那颗现在敲，小那颗是下一颗，
        // 连线末端的箭头指向下一颗。首颗敲掉后变暗到 PAIR_DIM、间距收到 PAIR_CONTRACT（连线因此缩短）、
        // 第二颗放大到 PAIR_LEAD_SCALE，整段过渡在 step 里按闭式缓动推（不挂 Tween，暂停自动停）。
        // 收到 0.85 而不是更狠：两颗都放大到 0.86 后中心距必须仍大于两颗的半径之和，连线才还看得见
        PAIR_DIM: 0.3,
        PAIR_CONTRACT: 0.85,
        PAIR_ARM_MS: 220,
        PAIR_LINK_WIDTH: 2,
        PAIR_LINK_ALPHA: 0.6,
        PAIR_CHEVRON: 8,
        // 生成侧要的半宽（= PAIR_GAP/2 + STAR_SIZE × PAIR_LEAD_SCALE / 2 ≈ 77，取 78）：
        // 边距按它内缩、横向间隔按它比常规星多出来的那截加宽，否则左节点会挂在画布外或压在邻星上
        PAIR_SPAN: 78,
        // 背景六层（harness/ui.md）。星点按满连击密度一次建好，连击只改可见数量，运行期不再 new；
        // 紫幕是独立一层而不是给 sky 加 tint——tint 只会压暗，Canvas 渲染器还直接忽略它
        SKY_STAR_COUNT: 84,
        SKY_DENSITY_MAX: 1.6,
        SKY_VEIL_ALPHA: 0.34,
        SKY_EASE: 3,
        // 装饰流星必须与可交互星星五条差异全占：暗、小、快、斜、无字母。
        // 速度按"当前档星速 × 2"取，所以 Lv5 与无尽封顶后依然比真星快一倍
        DECOR_POOL_SIZE: 4,
        DECOR_ALPHA: 0.22,
        DECOR_SCALE: 0.5,
        DECOR_SPEED_MUL: 2,
        DECOR_ANGLE: 30,
        DECOR_GAP_MIN: 3000,
        DECOR_GAP_MAX: 7000,
        DECOR_TAIL: 130,
        DECOR_TAIL_WIDTH: 14,
        DECOR_MARGIN: 60,
        // 远山与树线是矢量剪影（Graphics），不 bake 纹理：camera zoom 下边缘天然锐利。
        // 树梢压在地平线之下——光带在 8 层、树在 5 层，越线就会被一条亮线横穿
        RIDGE_RISE: 84,
        TREELINE_BASE: 26,
        TREELINE_MIN: 15,
        TREELINE_MAX: 24,
        TREELINE_GAP: 30,
        // 有星进入下方 1/3 时地平线脉冲变亮，分界与 URGENCY 最高档同一条线（y=400）
        HORIZON_WARN_Y: 400,
        HORIZON_PULSE_RATE: 0.9,
        HORIZON_PULSE_FAST: 3.4,
        HORIZON_PULSE_ALPHA: 0.55,
        HORIZON_EASE: 8,
        // 全局氛围反馈（harness/ui.md）。震屏只给坠毁（黑洞误敲更重一档），普通命中一律不震
        CRASH_SHAKE_MS: 120,
        CRASH_SHAKE: 0.006,
        // 坠毁那一下地平线光带提到 α1 再落回。闪光只有 200ms，比 80ms 的批量 timer 长不了多少，
        // 所以它期间每帧重算（Backdrop.applyHorizon），常态仍是批量的
        HORIZON_FLASH_MS: 200,
        // 命中定格：门槛对齐 COMBO_TIERS 最高档的 at，倍率 <1 才是"凝一下"而不是加速
        HIT_STOP_COMBO: 40,
        HIT_STOP_MS: 60,
        HIT_STOP_SCALE: 0.35,
        // 里程碑星屑雨：30 条长条星光从顶部旋转下落。池 = 一次撒满的量，建 N 恒定
        FX_RAIN_COUNT: 30,
        FX_RAIN_MS: 1200,
        FX_RAIN_SPEED_MIN: 340,
        FX_RAIN_SPEED_MAX: 450,
        // 出生点铺在画布上方 200px 里，于是一整场雨是陆续进场而不是一字排开
        FX_RAIN_SPREAD: 200,
        FX_RAIN_DRIFT: 26,
        FX_RAIN_SPIN: 3.2,
        // 用 48px 的 spark 非等比拉成细长一条：横向 6px、纵向 25px，旋转时是"闪光"而不是"星形"
        FX_RAIN_SCALE_X: 0.13,
        FX_RAIN_SCALE_Y: 0.52,
        FX_RAIN_ALPHA: 0.7,
        // 最后一条命：scrim α0.25 盖住天空与远山 ⇒ 亮度约 0.75（设计要的是 ColorMatrix brightness，
        // postFX 是 WebGL only，Canvas 渲染器还忽略 tint，所以走独立一层）；地平线辉光常亮、装饰流星停发
        DANGER_DIM: 0.25,
        DANGER_GLOW: 0.6,
        // 压暗用比星点密度（SKY_EASE 3，约 2s 才拉满）快一倍的追赶：掉命那一下要在一秒内看得出天黑了
        DANGER_EASE: 6,
        // 最后一条命的心跳间隔（6b）：与压暗 / 辉光常亮同一份判据（lives ≤ 1），时钟在 GameScene.update 里
        // 吃 clamp 后的 ms 累加，所以暂停与切标签页时心跳跟着停——用 delayedCall 会在暂停里继续跳
        DANGER_HEART_MS: 720,
        // 生命图标：丢的那颗炸开淡出，剩下的抖两下
        LIFE_SHATTER_MS: 260,
        LIFE_SHATTER_SCALE: 0.46,
        LIFE_SHATTER_SPIN: 1.2,
        LIFE_SHAKE_X: 3,
        LIFE_SHAKE_MS: 70,
        // HUD 动效（harness/ui.md）：分数 200ms 滚到新值而不是跳变，combo 每 +1 弹一下（1 → 1.35 → 1，120ms）。
        // 顶条不透明度留给裙边：1a 实测整条半透明会让下落的星透上来糊住文字，
        // 所以文字所在的那 52px 接近实心，下沿再拖一段渐隐，星星是滑出去而不是被硬切
        HUD_BAR_HEIGHT: 52,
        HUD_BAR_SKIRT: 12,
        HUD_SCORE_ROLL_MS: 200,
        HUD_COMBO_POP_MS: 120,
        HUD_COMBO_POP_SCALE: 1.35,
        HUD_COMBO_BREAK_MS: 280,
        HUD_COMBO_BREAK_X: 6,
        HUD_CLIMB_MS: 180,
        // 标题流星划落（4a 的 meteorIn，harness/ui.md）：菜单标题与结算 GAME OVER 共用，数字全在这里。
        // 光尾间隔取高速档的 25ms：入场动画是一次性的，短间隔让尾迹更连贯；池满抢最旧由 TrailPool 自己兜
        METEOR_FROM_X: 120,
        METEOR_FROM_Y: -60,
        METEOR_FALL_MS: 420,
        METEOR_STAGGER_MS: 90,
        METEOR_FLASH_MS: 80,
        METEOR_SQUASH_MS: 180,
        METEOR_SQUASH_DOWN: 0.72,
        METEOR_SQUASH_UP: 1.08,
        METEOR_SPARKS: 8,
        METEOR_TRAIL_GAP_MS: 25,
        METEOR_TRAIL_SIZE: 60,
        // 菜单入场（4b，harness/ui.md）：标题全部落定 300ms 后副标题从下方 8px 浮起，
        // 五档与动作排依次从左侧滑入、间隔 60ms
        MENU_REVEAL_DELAY_MS: 300,
        MENU_SUBTITLE_RISE: 8,
        MENU_SLIDE_STAGGER_MS: 60,
        // 开局倒计时（4c，harness/ui.md）：难度确认后给 3 秒缓冲，生成器在 GO! 那一刻才启动。
        // 整条时序由 clamp 后的 dt 推（同 Star / Effects），暂停与切标签页自动停住。
        // 数字与 GO 都是大字号，resolution 按各自的最大放大倍数烤，全程只缩不放（harness/architecture.md 的硬约束）
        COUNTDOWN_STEPS: 3,
        COUNTDOWN_STEP_MS: 1000,
        COUNTDOWN_SCRIM: 0.35,
        COUNTDOWN_SIZE: 96,
        COUNTDOWN_SCALE_FROM: 2.2,
        COUNTDOWN_SCALE_TO: 1,
        COUNTDOWN_GO_SIZE: 72,
        COUNTDOWN_GO_SCALE_FROM: 0.6,
        COUNTDOWN_GO_SCALE_TO: 1.6,
        COUNTDOWN_GO_POP_MS: 180,
        COUNTDOWN_GO_MS: 520,
        // 遮罩淡出要短于白环寿命，否则复用 3c 的那圈冲击波全程被压暗
        COUNTDOWN_FADE_MS: 200,
        COUNTDOWN_INFO_IN_MS: 200,
        COUNTDOWN_INFO_Y: 96,
        // 结算逐条揭示（4e，harness/ui.md）：标题划落 → 分数滚动 → 七行统计滑入 → 破纪录行 → 三按钮。
        // 分数滚完恰好接统计、末行统计落定恰好接破纪录行，两条首尾相接写进了测试；
        // 按钮淡完（3200 + 200）不超过验收的 3.5s
        OVER_SCORE_DELAY_MS: 400,
        OVER_SCORE_ROLL_MS: 1000,
        OVER_STATS_DELAY_MS: 1400,
        OVER_STATS_STAGGER_MS: 180,
        OVER_STATS_SLIDE_MS: 320,
        OVER_RECORD_DELAY_MS: 2800,
        OVER_BUTTONS_DELAY_MS: 3200,
        OVER_FADE_MS: 200,
        // 高速可读性补偿（harness/gameplay.md）：进入下方 1/5 后速度 ×0.92，同时亮起暖色描边。
        // 暖橘脉冲与"重复字母里最低那颗"的白色脉冲是两回事，颜色 / 大小 / 频率三样都得分开，
        // 否则玩家读不出"哪颗会被我敲掉"。字号与描边分档在 LEVELS 里（2a 已落）
        NEAR_ZONE: 0.2,
        NEAR_Y: 480,
        NEAR_SPEED_MUL: 0.92,
        NEAR_PULSE_RATE: 9.5,
        NEAR_PULSE_ALPHA_MIN: 0.3,
        NEAR_PULSE_ALPHA_MAX: 0.9,
        NEAR_PULSE_SCALE: 1.08,
        NEAR_HALO_ALPHA: 0.62,
        // 小写字母在 em 框里偏下，文本框居中时字形会偏低，往上提一点才是视觉居中
        LETTER_OFFSET_Y: -2,
        LETTER_MAX_SAME: 2,
        LETTER_SAME_HAND: 0.4,
        SPAWN_GAP_X: 64,
        SPAWN_GAP_Y: 80,
        SPAWN_TRIES: 8,
        // 触屏热区半径（6e，世界坐标）：点星判定按"圆心距 ≤ 半径"取最近者。
        // 比星体半径 36 大一圈——手机 FIT 缩到约 0.5× 后仍有 ~30 CSS px 半径的指腹热区；
        // 重叠候选（双星两颗 / 邻星）由最近圆心消歧，判定本身仍是字母级最低优先
        TAP_RADIUS: 60,
        // 同屏特殊星上限（harness/gameplay.md）：双星算一个整体、占一个名额。
        // 配额满了这一颗回落普通星，不跳过这一拍——生成节奏不因特殊星配额断档
        SPECIAL_MAX_ON_SCREEN: 2,
        PULSE_RATE: 6.5,
        PULSE_ALPHA_MIN: 0.24,
        PULSE_ALPHA_MAX: 0.8,
        PULSE_SCALE: 0.06,
        SCORE_BASE: 10,
        // 严格模式（6c，harness/gameplay.md）：按错（无匹配 / 双星顺序错 / 误敲黑洞）另扣一次基础分，
        // 扣到 0 为止不为负；坠毁不罚（已扣命）。罚分不吃连击倍率，开关吃开局快照
        STRICT_MISS_PENALTY: 10,
        // 每攒够这么多分撒一场星屑雨。分数只增不减，所以"整除计数"天然单调、不会重复撒
        SCORE_MILESTONE: 500,
        // 命中位置按画布高度三等分：上段不奖、中段 +5、下段 +10。参考线 y=200 / 400 正好是分界
        URGENCY_BONUS: [0, 5, 10],
        COMBO_TIERS: [
            { at: 0, multiplier: 1 },
            { at: 5, multiplier: 1.5 },
            { at: 10, multiplier: 2 },
            { at: 20, multiplier: 3 },
            { at: 40, multiplier: 4 }
        ],
        // 爬升曲线是全局一条（harness/gameplay.md），不随档位变，所以不往五档里各抄一遍。2c 读它，闯关模式不爬升
        CLIMB: { every: 15, speedMul: 1.06, intervalMul: 0.95, speedCap: 1.8, intervalFloor: 0.4 },
        // 声音（6a 骨架 + 6b 全部事件，harness/ui.md 声音节）：Web Audio 现场合成的设计值，调音改这张表。
        // 一个事件 = 一份共用参数 + 可选的 voices 数组：每层覆写自己要改的字段，at 是相对事件起点的秒偏移；
        // 没有 voices 就是单音事件。层里 freq 是绝对音高、ratio 是相对根音的倍率，两个都不写就是根音本身。
        // scale 是"按 opts.step 取音高"的表（命中音阶 / 倒计时 / 标题上行共用这一条机制），
        // step 缺省 0、超出表长封顶——"第 10 击起音高不再爬"就是这条，不是哪里写了 if
        AUDIO: {
            defaultVolume: 0.8,
            volumeStep: 0.1,
            // 并发上限按**层**数算。8 是 6a 按"一个事件一个振荡器"定的；6b 起一个事件可以是多层
            // （金色琶音 4 层 / 黑洞 2 层 / 心跳 2 层 / UI 两音 2 层），照 8 会在连打时把琶音拦腰丢掉，
            // 所以放宽到 12。真到上限仍然丢最老——"连打不糊"那条纪律不变
            maxVoices: 12,
            attack: 0.006,
            // 包络走完后多留这么长再 stop（振荡器停在指数尾巴上才不咔哒）
            tail: 0.02,
            // 被并发上限抢掉的那一层用这么长快速淡出再停
            fade: 0.008,
            // 白噪声缓冲的秒数：建一次全程复用（黑洞吸入那层），每次现造一段 buffer 是白扔几百 KB
            noiseSeconds: 1,
            // 命中：第 n 击取 HIT_SCALE 的第 n-1 格（调用点传 step = combo - 1）
            hit: { type: 'triangle', dur: 0.14, gain: 0.4, scale: HIT_SCALE },
            // 按错：低音量短音，只说"这一下没吃掉"，不跟命中音抢
            miss: { type: 'sine', freq: 170, dur: 0.09, gain: 0.16 },
            // 坠毁：低频下滑
            crash: { type: 'sawtooth', freq: 220, glide: 55, dur: 0.4, gain: 0.5 },
            // 键序推进（6b 落地、9e 把事件名 pair 改成 arm）：双星第一颗与序列星每敲对一键共用这一声，
            // 说的是"这一键吃掉了，还剩几键"。它不是击落，所以不读连击音阶——音高固定才听得出
            // "这一下和普通命中不是一回事"。也不随进度上行：glide 是绝对目标频率，挂上音阶表后
            // 880→1320 的上挑会在高 step 退化成 1.2×，要真做得上行得先给合成引擎加一个相对滑音参数
            arm: { type: 'triangle', freq: 880, glide: 1320, dur: 0.09, gain: 0.2 },
            // 金色星：根音跟着连击走，上面叠一条大三和弦琶音（1 / 1.25 / 1.5 / 2）——"这一颗值钱"
            gold: { type: 'triangle', dur: 0.16, gain: 0.24, scale: HIT_SCALE,
                voices: [{ ratio: 1 }, { ratio: 1.25, at: 0.055 }, { ratio: 1.5, at: 0.11 }, { ratio: 2, at: 0.165 }] },
            // 冰晶星：根音同样跟连击。tremolo 是 LFO 加在包络那个 AudioParam 上（相加，不改包络形状），
            // 低八度那层慢颤是"冷"，高八度那层快颤是"冰凌"——两层颤率不同才不是简单的震音
            ice: { type: 'sine', dur: 0.5, gain: 0.24, scale: HIT_SCALE, tremolo: { rate: 14, depth: 0.6 },
                voices: [{ ratio: 1 },
                    { ratio: 2, type: 'triangle', dur: 0.34, gain: 0.1, tremolo: { rate: 19, depth: 0.7 } }] },
            // 黑洞误敲（全局最重的那一下）：白噪声被低通从亮扫到闷 = 吸进去，正弦低频跟着往下坠 = 被带走。
            // 不用 crash：坠毁是"星掉下去了"，误敲是"你伸手进了黑洞"，两件事必须听得出差别
            void: { dur: 0.55, gain: 0.5, voices: [
                { noise: { from: 2400, to: 90, q: 1.2 }, gain: 0.32 },
                { type: 'sine', freq: 130, glide: 34, gain: 0.5 }
            ] },
            // 倒计时与 GO：3-2-1 一步一音上行，GO 从最后一格再扫上一个八度，是同一段旋律的收束
            count: { type: 'sine', dur: 0.18, gain: 0.24, scale: COUNT_SCALE },
            go: { type: 'triangle', freq: 784, glide: 1568, dur: 0.32, gain: 0.28 },
            // 标题四字落定：一字一音，step 就是落定的顺序（meteorIn 的 tone 选项）
            title: { type: 'triangle', dur: 0.34, gain: 0.24, scale: TITLE_SCALE },
            // 最后一条命的心跳：两下低频（lub-dub），第二下轻一点短一点。间隔是 DANGER_HEART_MS
            heart: { type: 'triangle', freq: 72, dur: 0.2, gain: 0.45,
                voices: [{ ratio: 1 }, { ratio: 1, at: 0.19, dur: 0.17, gain: 0.3 }] },
            // UI 三声：移动 / 确认 / 返回。确认是上行两音、返回是下行两音——不看文字也分得出方向。
            // uiMove 很轻很短（选中项每换一格就响一次，重了就是噪音）
            uiMove: { type: 'sine', freq: 660, dur: 0.05, gain: 0.09 },
            uiOn: { type: 'triangle', dur: 0.09, gain: 0.15,
                voices: [{ freq: 784 }, { freq: 1175, at: 0.055 }] },
            uiBack: { type: 'sine', dur: 0.1, gain: 0.13,
                voices: [{ freq: 587 }, { freq: 392, at: 0.06 }] }
        },
        STORAGE_NS: 'toys.shooting-stars',
        FONT: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, -apple-system, "Segoe UI", sans-serif',
        MONO: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
    };

    // 3f 梳理后的完整层序，每一层都有名字：调用点不再写 DEPTH.hud - 1 这类算式，
    // 插一层只要在表里挑一个空位，不用去各文件里找谁减了 1
    const DEPTH = {
        sky: 0,
        dusk: 0.2,
        stars: 0.5,
        decor: 1,
        ridge: 2,
        ground: 5,
        // 最后一条命时的压暗层：盖住天空到远山，但留在光带（8）之下——"天空变暗"与"地平线辉光常亮"
        // 要同时成立，夹在中间是唯一位置；真星与 HUD 全在它之上，可读性不受影响
        dim: 7,
        horizon: 8,
        trail: 10,
        star: 11,
        // 命中闪白顶替的是那颗真星，必须压在场其余真星之上，又仍在粒子之下
        flash: 12,
        particle: 20,
        guide: 29,
        hud: 30,
        overlay: 40,
        panel: 41
    };

    const SCENES = {
        BOOT: 'BootScene',
        MENU: 'MenuScene',
        TUTORIAL: 'TutorialScene',
        GAME: 'GameScene',
        PAUSE: 'PauseScene',
        GAME_OVER: 'GameOverScene'
    };

    // 4.1 五档固定难度。9a 拆分后档位只管物理与高速可读性补偿（速度 / 间隔 / 上限 / 命 /
    // 特殊星开关与加倍 / 字号 / 描边），五档被所有方案共享；"出什么内容"（字母池）归各方案的
    // 内容梯度表（SCHEMES）。调手感 = 改这里，所有方案同步生效；调内容 = 改对应方案，不波及别的方案。
    // 游戏逻辑只读这张表，不动一行逻辑。accent 由凉到暖排，颜色本身就是一条难度梯度，
    // 菜单按钮与 HUD 顶条读同一份
    const HOME_LETTERS = 'asdfghjkl';
    const HOME_ROW = HOME_LETTERS + ';';
    const TOP_ROW = 'qwertyuiop';
    const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';
    const DIGITS = '0123456789';
    const SYMBOLS = "-=[]',./";
    // 符号专练的全池：八个符号 + 中排回来的 ';'。` 与 \ 是控制键（参考线 / 回菜单），
    // 必须留在所有方案的池外，所以物理符号键就这 9 个
    const SYMBOL_KEYS = SYMBOLS + ';';

    // 9e 单元方案的载体字表：一个字 = 一个单元（显示面就是这个字，键序 = 它的无调拼音逐字母）。
    // 值可以是**一个读音**（字符串）或**一组读音**（数组，9g 多音字）——多读音时玩家敲任一
    // 读音都能消除（harness/gameplay.md 多音字节）。收字三条硬约束：
    // ① 多音字只收**各读音等长**的（9g 放宽，9e 原来是"字母串相同才收"）——等长 ⇒ 不互为前缀
    //    ⇒ 消除时机唯一、进度点总数有定义、没有短读音可挑（三条理由全文见 gameplay.md / architecture.md
    //    已知坑）。所以 行 xing/hang ✅、长 chang/zhang ✅、地 di/de ✅；
    //    会 hui/kuai、得 de/dei、石 shi/dan、大 da/dai、车 che/ju、还 hai/huan、没 mei/mo、
    //    六 liu/lu、给 gei/ji、似 si/shi、宿 su/xiu、削 xue/xiao 一律**不等长，不收**
    // ② 不收 ü（女 nǚ / 绿 lǜ 的转写约定是 9g-3 的定案，现在收了就是让玩家猜；
    //    ju / qu / xu / yu 不在此列，它们的键盘形式本来就是 u）
    // ③ 键全在 a–z、不带调号、不带分隔符
    // 只有声调不同的（中 zhōng/zhòng、好 hǎo/hào）字母串本来就相同，写成一个字符串就够。
    // 查表的键恒是汉字，取不到 constructor / toString 一类原型真值，所以不需要 null 原型
    const HANZI = {
        // 分组按**键数**排，与下面那六个档位串一一对应（串里的字序才是出场顺序）
        // 2 键 = HANZI_2KEY
        一: 'yi', 二: 'er', 八: 'ba', 不: 'bu', 我: 'wo', 他: 'ta',
        你: 'ni', 马: 'ma', 米: 'mi', 日: 'ri', 土: 'tu', 五: 'wu', 爱: 'ai',
        // 9g 多音字（2 键）：的 de/dí/dì → {de, di}、地 dì/de、系 xì/jì、提 tí/dī
        的: ['de', 'di'], 地: ['di', 'de'], 系: ['xi', 'ji'], 提: ['ti', 'di'],
        // 3 键 = HANZI_3KEY_A（起步那一批）
        人: 'ren', 口: 'kou', 月: 'yue', 心: 'xin', 好: 'hao',
        花: 'hua', 白: 'bai', 走: 'zou', 家: 'jia', 高: 'gao', 学: 'xue',
        // 3 键 = HANZI_3KEY_B（第二批）
        门: 'men', 书: 'shu', 九: 'jiu', 十: 'shi', 下: 'xia', 牛: 'niu',
        飞: 'fei', 猫: 'mao', 狗: 'gou', 草: 'cao', 玩: 'wan',
        // 9g 多音字（3 键）：血 xuè/xiě、弹 dàn/tán、解 jiě/jiè/xiè → {jie, xie}、识 shí/zhì
        血: ['xue', 'xie'], 弹: ['dan', 'tan'], 解: ['jie', 'xie'], 识: ['shi', 'zhi'],
        // 4 键 = HANZI_4KEY
        山: 'shan', 水: 'shui', 手: 'shou', 电: 'dian', 鸟: 'niao', 羊: 'yang', 龙: 'long',
        明: 'ming', 春: 'chun', 冬: 'dong', 桥: 'qiao', 灯: 'deng', 听: 'ting', 笑: 'xiao',
        天: 'tian', 星: 'xing', 风: 'feng',
        // 9g 多音字（4 键）：行 xíng/háng、调 diào/tiáo、便 biàn/pián、谁 shéi/shuí、
        // 见 jiàn/xiàn、校 xiào/jiào
        行: ['xing', 'hang'], 调: ['diao', 'tiao'], 便: ['bian', 'pian'],
        谁: ['shei', 'shui'], 见: ['jian', 'xian'], 校: ['xiao', 'jiao'],
        // 5 键 = HANZI_5KEY
        光: 'guang', 想: 'xiang', 讲: 'jiang', 城: 'cheng', 生: 'sheng', 黄: 'huang',
        香: 'xiang', 凉: 'liang', 唱: 'chang', 上: 'shang', 中: 'zhong', 江: 'jiang',
        // 9g 多音字（5 键）：长 cháng/zhǎng、重 chóng/zhòng、传 chuán/zhuàn、
        // 盛 shèng/chéng、强 qiáng/qiǎng/jiàng → {qiang, jiang}
        长: ['chang', 'zhang'], 重: ['chong', 'zhong'], 传: ['chuan', 'zhuan'],
        盛: ['sheng', 'cheng'], 强: ['qiang', 'jiang'],
        // 6 键 = HANZI_6KEY：标准拼音里 6 个字母的音节只有 zhuang / chuang / shuang 三个，
        // 这一档就是它们能配的字（讲 jiang 与 江 jiang 同键序不是错：显示面不同，
        // 与键位方案里同屏两个 'a' 一样靠最低优先消歧）。这三个音节都没有等长的第二读音，
        // 所以 6 键档里一个多音字都没有
        装: 'zhuang', 庄: 'zhuang', 壮: 'zhuang', 状: 'zhuang',
        床: 'chuang', 窗: 'chuang', 创: 'chuang', 闯: 'chuang',
        双: 'shuang', 爽: 'shuang', 霜: 'shuang'
    };

    // 内容梯度按**键序长度**分档、逐档累加（与键位方案"中排 → +上排 → 全池"同一条套路）：
    // 9e 压测的是造型与判定，9g-1 只放宽了多音字、没换梯度轴，常用字 → 生僻字那条是 9g-2 的事。
    // 分档看的是**拼音字母数**不是音节数：天 tian / 星 xing / 风 feng 都是 4 键，爱 ai 只有 2 键。
    // 多音字按它那个恒定的键数入档（等长约束保证这个数唯一）。
    // 6 键音节在标准拼音里只有 zhuang / chuang / shuang 三个，所以那一档就是它们能配的字
    const HANZI_2KEY = '一二八不我他你马米日土五爱' + '的地系提';
    const HANZI_3KEY_A = '人口月心好花白走家高学';
    const HANZI_3KEY_B = '门书九十下牛飞猫狗草玩' + '血弹解识';
    const HANZI_4KEY = '山水手电鸟羊龙明春冬桥灯听笑天星风' + '行调便谁见校';
    const HANZI_5KEY = '光想讲城生黄香凉唱上中江' + '长重传盛强';
    const HANZI_6KEY = '装庄壮状床窗创闯双爽霜';
    // 逐档累加的五档内容（28 → 43 → 66 → 83 → 94 字）
    const HANZI_L1 = HANZI_2KEY + HANZI_3KEY_A;
    const HANZI_L2 = HANZI_L1 + HANZI_3KEY_B;
    const HANZI_L3 = HANZI_L2 + HANZI_4KEY;
    const HANZI_L4 = HANZI_L3 + HANZI_5KEY;
    const HANZI_L5 = HANZI_L4 + HANZI_6KEY;

    // 9f 小鹤双拼映射表（harness/gameplay.md 双拼方案节）：一个音节恒编码成两键 = 声母键 + 韵母键。
    // initials 只列需要改写键位的三个翘舌声母（zh→v / ch→i / sh→u），其余单字母声母照本键；
    // finals 是韵母 → 键位（含 iu/ui/un 一类缩写、ü 的键盘形式 v/ve、零声母音节查的整段韵母）。
    // 这张表定死、随方案带版本；换自然码 / 微软 = 另写一张 map 注册新方案，不改本表也不改编码器
    const FLYPY = {
        initials: { zh: 'v', ch: 'i', sh: 'u' },
        finals: {
            a: 'a', o: 'o', e: 'e', i: 'i', u: 'u', v: 'v',
            ai: 'd', ei: 'w', ao: 'c', ou: 'z',
            an: 'j', en: 'f', ang: 'h', eng: 'g', er: 'r',
            ong: 's', iong: 's',
            iu: 'q', ie: 'p', in: 'b', iao: 'n', ian: 'm', ing: 'k',
            ia: 'x', ua: 'x', iang: 'l', uang: 'l', uo: 'o', ui: 'v', un: 'y', uan: 'r',
            ve: 't', ue: 't', uai: 'k'
        }
    };

    // 全部合法拼音音节（键盘形式、无调号），按声母分组拼成——覆盖与码字双射由 config.test 逐音节守。
    // ü 在 l/n 后写 v（lv/nv/lve/nve），ju/qu/xu/yu 键盘形式本就用 u。
    // 剔除 lo（咯）：flypy 把 o 与 uo 都映到 O，lo 与 luo 同码 collision，lo 是边缘口语 particle 音节
    // （同汉字方案不收 ü / 多音字的取舍，harness/architecture.md 已知坑）。其余 412 个码字唯一
    const SYLLABLE_GROUPS = {
        '': 'a ai an ang ao e ei en eng er o ou',
        b: 'ba bai ban bang bao bei ben beng bi bian biao bie bin bing bo bu',
        p: 'pa pai pan pang pao pei pen peng pi pian piao pie pin ping po pou pu',
        m: 'ma mai man mang mao me mei men meng mi mian miao mie min ming miu mo mou mu',
        f: 'fa fan fang fei fen feng fo fou fu',
        d: 'da dai dan dang dao de dei den deng di dian diao die ding diu dong dou du duan dui dun duo',
        t: 'ta tai tan tang tao te tei teng ti tian tiao tie ting tong tou tu tuan tui tun tuo',
        n: 'na nai nan nang nao ne nei nen neng ni nian niang niao nie nin ning niu nong nou nu nuan nun nuo nv nve',
        l: 'la lai lan lang lao le lei leng li lia lian liang liao lie lin ling liu long lou lu luan lun luo lv lve',
        g: 'ga gai gan gang gao ge gei gen geng gong gou gu gua guai guan guang gui gun guo',
        k: 'ka kai kan kang kao ke kei ken keng kong kou ku kua kuai kuan kuang kui kun kuo',
        h: 'ha hai han hang hao he hei hen heng hong hou hu hua huai huan huang hui hun huo',
        j: 'ji jia jian jiang jiao jie jin jing jiong jiu ju juan jue jun',
        q: 'qi qia qian qiang qiao qie qin qing qiong qiu qu quan que qun',
        x: 'xi xia xian xiang xiao xie xin xing xiong xiu xu xuan xue xun',
        zh: 'zha zhai zhan zhang zhao zhe zhei zhen zheng zhi zhong zhou zhu zhua zhuai zhuan zhuang zhui zhun zhuo',
        ch: 'cha chai chan chang chao che chen cheng chi chong chou chu chua chuai chuan chuang chui chun chuo',
        sh: 'sha shai shan shang shao she shei shen sheng shi shou shu shua shuai shuan shuang shui shun shuo',
        r: 'ran rang rao re ren reng ri rong rou ru rua ruan rui run ruo',
        z: 'za zai zan zang zao ze zei zen zeng zi zong zou zu zuan zui zun zuo',
        c: 'ca cai can cang cao ce cei cen ceng ci cong cou cu cuan cui cun cuo',
        s: 'sa sai san sang sao se sei sen seng si song sou su suan sui sun suo',
        y: 'ya yan yang yao ye yi yin ying yo yong you yu yuan yue yun',
        w: 'wa wai wan wang wei wen weng wo wu'
    };
    const SYLLABLES = [];
    for (const group of Object.keys(SYLLABLE_GROUPS)) {
        for (const syllable of SYLLABLE_GROUPS[group].split(' ')) { SYLLABLES.push(syllable); }
    }

    // 9f 双拼方案的内容：复用汉字方案那张已 vetted 读音的字表（一个字一个单元，星面就是这个字），
    // 按**音节常用度**重排成五档累加串——双拼恒 2 键，按键序长度分档对它无意义（那是全拼汉字方案的口径）。
    // 键序 = 这个字拼音的小鹤双拼编码（恒 2 键），由 levelFor 经 encodeShuangpin 合成
    const FLYPY_L1 = '一不我你他人好中上天日月心口';
    const FLYPY_L2 = FLYPY_L1 + '山白手门水马米土五八二爱';
    const FLYPY_L3 = FLYPY_L2 + '走高家学花书九十下牛飞猫狗';
    const FLYPY_L4 = FLYPY_L3 + '草玩电鸟羊龙明春冬桥灯听笑星风';
    const FLYPY_L5 = FLYPY_L4 + '光想讲城生黄香凉唱江装庄壮状床窗创闯双爽霜';

    const LEVELS = [
        {
            id: 1,
            name: '入门',
            accent: PALETTE.starColors[3],
            speed: 70,
            spawnInterval: 1800,
            maxOnScreen: 4,
            lives: 5,
            fontSize: 28,
            stroke: 2,
            specials: [],
            specialBoost: 1
        },
        {
            id: 2,
            name: '轻松',
            accent: PALETTE.starColors[4],
            speed: 100,
            spawnInterval: 1400,
            maxOnScreen: 5,
            lives: 5,
            fontSize: 28,
            stroke: 2,
            specials: ['gold', 'ice'],
            specialBoost: 1
        },
        {
            id: 3,
            name: '标准',
            accent: PALETTE.starColors[0],
            speed: 135,
            spawnInterval: 1050,
            maxOnScreen: 7,
            lives: 4,
            fontSize: 30,
            stroke: 2,
            specials: ['gold', 'ice', 'void', 'double'],
            specialBoost: 1
        },
        {
            id: 4,
            name: '困难',
            accent: PALETTE.starColors[1],
            speed: 175,
            spawnInterval: 850,
            maxOnScreen: 7,
            lives: 3,
            fontSize: 32,
            stroke: 3,
            specials: ['gold', 'ice', 'void', 'double'],
            specialBoost: 1
        },
        {
            id: 5,
            name: '大师',
            accent: PALETTE.starColors[2],
            speed: 225,
            spawnInterval: 620,
            maxOnScreen: 8,
            lives: 3,
            fontSize: 34,
            stroke: 3,
            specials: ['gold', 'ice', 'void', 'double'],
            specialBoost: 2
        }
    ];

    // 两个模式开关（harness/gameplay.md）：菜单、HUD、暂停面板、结算页四处都要显示模式名，收进表里只写一遍。
    // climb 是给 2c 的：爬升曲线只有无尽走，闯关恒定
    const MODES = [
        { id: 'normal', name: '闯关', desc: '固定难度，不爬升，适合练键位', climb: false },
        { id: 'endless', name: '无尽', desc: '以选定难度为起点爬升', climb: true }
    ];

    const DEFAULT_LEVEL = 3;
    const DEFAULT_MODE = 'normal';
    const FALLBACK_LEVEL = LEVELS.find(function (level) { return level.id === DEFAULT_LEVEL; });
    const FALLBACK_MODE = MODES.find(function (mode) { return mode.id === DEFAULT_MODE; });

    // 9a 方案注册表：档位（LEVELS）管物理、五档共享，方案管"出什么内容"。每个方案自带
    // 「档位 id → 内容池」梯度表，标准方案的内容表 = 拆分前的现状（中排 → 全池），判定与计分一字不改。
    // version 是记录封印开关：内容表或判定规则变更时 +1，记录键含版本（Storage），旧版本记录
    // 自然落在合法键集之外被封存、不与新规则混算（harness/gameplay.md 计分与记录节）。
    // 加方案 = 添一行（9b 弹层注册、9c 字母/数字/符号专练、9f 双拼、9g 汉字连打都走这里），流程不改
    const SCHEMES = [
        {
            id: 'standard',
            name: '标准',
            version: 1,
            desc: '中排起步，逐档扩到全键盘',
            // pair = 这个方案用不用线连双星（9d）：仅标准方案 true。专练与单元方案
            // 用单体序列星（9e），不挂线连造型。levelFor 按它过滤 specials，流程不认识方案
            pair: true,
            // unit = 这个方案的内容是不是「一个字 / 一个音节 = 一个单元」（9e）：true 时 levelFor
            // 把内容串查成单元表、合成星面与进度点的造型几何（level.units），并滤掉
            // unit: false 的类型（黑洞与双星，理由见类型表那两行）
            unit: false,
            content: {
                1: HOME_ROW,
                2: HOME_ROW + TOP_ROW,
                3: ALPHABET,
                4: ALPHABET + DIGITS,
                // 45 键：26 字母 + 10 数字 + 8 符号 + 中排回来的 ';'（符号清单见 harness/gameplay.md）
                5: ALPHABET + DIGITS + SYMBOL_KEYS
            }
        },
        // 9c 专练方案：数字符号在入门档就出对应内容（不必开大师速度），档位只提速。
        // 字母专练任何档位不出数字符号——';' 虽在中排但属符号键，所以 Lv1 是中排字母 9 键；
        // Lv3 起封顶全小写。符号池只有 9 键（控制键 ` 与 \ 留在池外），比标准最小的 10 键还窄：
        // Lv3+ 黑洞隔离的排除集偶尔清空候选，pickLetter 返回 null 整拍跳过，不放宽硬约束
        {
            id: 'letters',
            name: '字母',
            version: 1,
            desc: '只出字母，逐档扩到全字母',
            pair: false,
            unit: false,
            content: {
                1: HOME_LETTERS,
                2: HOME_LETTERS + TOP_ROW,
                3: ALPHABET,
                4: ALPHABET,
                5: ALPHABET
            }
        },
        {
            id: 'digits',
            name: '数字',
            version: 1,
            desc: '十个数字，入门档就能练',
            pair: false,
            unit: false,
            content: { 1: DIGITS, 2: DIGITS, 3: DIGITS, 4: DIGITS, 5: DIGITS }
        },
        {
            id: 'symbols',
            name: '符号',
            version: 1,
            desc: '九个符号，入门档就能练',
            pair: false,
            unit: false,
            content: { 1: SYMBOL_KEYS, 2: SYMBOL_KEYS, 3: SYMBOL_KEYS, 4: SYMBOL_KEYS, 5: SYMBOL_KEYS }
        },
        // 9e 单元方案（汉字连打的载体）：一个星体装一个字，键序是它的无调拼音、藏在星体里，
        // 星面绝不显示键（显示键 = 抄答案，训练价值归零）。9g-1 起多音字**任一读音都算对**
        // （收字限制"各读音等长"，理由见字表与 harness/gameplay.md 多音字节）。
        // 内容串是一串汉字——一个字一个单元，与键位方案的池串同构，所以 level.pool 语义不变，
        // 菜单预览与 ?debug 读数一行不改就能显示"字表 28 · 一二八不…"。
        // **version 2（9g-1）**：内容表加了 19 个多音字、判定语义也跟着变（一颗星可由两条键序消除），
        // hanzi@1 的旧记录因此自然封存不混算（9a 的封印机制，盘上不删）
        {
            id: 'hanzi',
            name: '汉字',
            version: 2,
            desc: '一字一星，拼音连打',
            pair: false,
            unit: true,
            content: { 1: HANZI_L1, 2: HANZI_L2, 3: HANZI_L3, 4: HANZI_L4, 5: HANZI_L5 }
        },
        // 9f 小鹤双拼方案：一个星体装一个音节，键序 = 它拼音的双拼编码（恒 2 键），星面仍是汉字
        // （复用 9e 单体序列星造型，不另立造型——音节面撞面字号红线，取舍见 harness/gameplay.md）。
        // shuangpin 挂这张映射表：levelFor 据此选编码器，换自然码 / 微软 = 另写 map 注册新方案。
        // 内容复用汉字表按音节常用度分档（恒 2 键，不按键长分档），与汉字方案各记各的记录线。
        // **version 仍是 1（9g-1 没动它）**：双拼天然恒 2 键、等长约束自动满足，所以下面这串内容
        // 一个字都没改，而这串里没有任何多音字 ⇒ 每个单元仍只有一条读音 ⇒ 行为与 9f 逐字相同
        // （config.test 钉住"flypy 每单元 readings 恒 1 条"，那条断言就是它不用 bump 版本的理由）
        {
            id: 'flypy',
            name: '双拼',
            version: 1,
            desc: '小鹤双拼，两键一音节',
            pair: false,
            unit: true,
            shuangpin: FLYPY,
            content: { 1: FLYPY_L1, 2: FLYPY_L2, 3: FLYPY_L3, 4: FLYPY_L4, 5: FLYPY_L5 }
        }
    ];

    const DEFAULT_SCHEME = 'standard';
    const FALLBACK_SCHEME = SCHEMES.find(function (scheme) { return scheme.id === DEFAULT_SCHEME; });

    // 特殊星表（harness/gameplay.md）落成类型表（5a）：每一类是「造型 + 速度系数 + 得分 + 命中特效 + 命中音」
    // 五件一体，5b–5d 各往这张表加一行：金色星 / 黑洞 / 冰晶星三类真的做到了"流程不改"，
    // 双星（pair）是唯一例外——它一次生成要两个字母、判定多一条"敲第一颗不是击落"的分流。
    // weight 是生成权重（5e 已接入 pickStarType）：特殊星吃 LEVELS.specialBoost 加倍（Lv5 ×2）、
    // 普通星不加倍；候选由 LEVELS.specials 开关决定，同屏特殊星上限 SPECIAL_MAX_ON_SCREEN
    // sound 是这一类命中时的事件名（读 CONFIG.AUDIO），armSound 是**键序推进**那一声——双星第一颗 /
    // 序列星每敲对一键。9e 起普通 / 金色 / 冰晶三行也填上它（单元方案里这三类都是多键星，
    // 原先 null 意味着推进那一下完全静默）；黑洞恒 null，它不能敲、永远不会推进。
    // 判定路径只认这两个字段，不按 id 分支
    // colors 是这一类允许的星色：金色是金色星的身份色（harness/ui.md），普通星也能随机到金的话
    // "一眼能分"就没了。PALETTE.starColors 六色原样保留，菜单标题 / 五档 accent / 教学示意还在读它
    const NORMAL_COLORS = PALETTE.starColors.filter(function (color) { return color !== PALETTE.gold; });

    const STAR_TYPES = [
        {
            id: 'normal',
            name: '普通星',
            weight: 82,
            speedMul: 1,
            bonus: 0,
            sound: 'hit',
            armSound: 'arm',
            colors: NORMAL_COLORS,
            texture: 'starHi',
            glint: false,
            pillar: false,
            hazard: false,
            disk: false,
            chill: false,
            pair: false,
            unit: true
        },
        {
            id: 'gold',
            name: '金色星',
            weight: 6,
            speedMul: 1.3,
            bonus: 50,
            sound: 'gold',
            armSound: 'arm',
            colors: [PALETTE.gold],
            texture: 'starHi',
            glint: true,
            pillar: true,
            hazard: false,
            disk: false,
            chill: false,
            pair: false,
            unit: true
        },
        // chill = 命中后全屏 4 秒：所有星（含之后新生成的）下落 ×0.5 + 冷蓝叠加 + 冰晶飘落。
        // 减速不进 speedMul——speedMul 是这一类自己的下落速度，3.4 写的是"标准下落"；
        // 写进去就成了"这颗星自己慢"，全场减速那条验收直接不成立
        {
            id: 'ice',
            name: '冰晶星',
            weight: 5,
            speedMul: 1,
            bonus: 20,
            sound: 'ice',
            armSound: 'arm',
            colors: [PALETTE.ice],
            texture: 'iceStar',
            glint: false,
            pillar: false,
            hazard: false,
            disk: false,
            chill: true,
            pair: false,
            unit: true
        },
        // hazard = 不能敲：判定命中它走误敲分支（扣命），落到地平线反而无惩罚。
        // disk = 吸积盘那套行为（不 tint、白芯隐藏、连续自转、不拖光尾）——
        // 靠形状而不是颜色传达"不能碰"（harness/gameplay.md），色觉障碍下也分得出。
        // unit = false（9e）：黑洞只有一个"不能按的键"，装不进单元方案的显示面——
        // 它的字母隔离在多键星上也做不出完备保证（排全部剩余键 ⇒ 排除集饱和、黑洞生不出来；
        // 只排首键 ⇒ 单元星推进到与黑洞同键时"按对了却掉命"）。理由全文见 harness/gameplay.md 特殊星节
        {
            id: 'void',
            name: '黑洞',
            weight: 5,
            speedMul: 1,
            bonus: 0,
            sound: 'void',
            armSound: null,
            colors: [PALETTE.voidCore],
            texture: 'voidStar',
            glint: false,
            pillar: false,
            hazard: true,
            disk: true,
            chill: false,
            pair: false,
            unit: false
        },
        // pair = 一对两颗（5d）：一次生成拿两个字母、占一个同屏名额、坠毁只扣一条命、
        // 敲完只算一次击落。判定侧只认"轮到敲的那一颗"（Star.letter），还没轮到的那颗挂在 Star.pending，
        // 所以 lowestMatch / markTargets 一行没改（harness/architecture.md）。
        // 造型仍是五角星——两颗小的 + 连线 + 箭头，身份靠形状不靠颜色，颜色沿用普通星那五色
        // （金色是金色星的身份色，双星不能用；一对两颗同色才读得成一个整体）。
        // 敲完第二颗才算击落，所以 sound 是普通命中音；第一颗走 armSound 那一声轻的。
        // unit = false（9e）：双星是**线连**造型的两键特例，与单体序列星互斥——
        // 一个方案要么用线连（标准）、要么用单体（单元方案），两者永不同屏，
        // 所以推进音共用 'arm' 那一声也不会撞
        {
            id: 'double',
            name: '双星',
            weight: 2,
            speedMul: 1,
            bonus: 30,
            sound: 'hit',
            armSound: 'arm',
            colors: NORMAL_COLORS,
            texture: 'starHi',
            glint: false,
            pillar: false,
            hazard: false,
            disk: false,
            chill: false,
            pair: true,
            unit: false
        }
    ];

    const DEFAULT_STAR_TYPE = 'normal';
    const FALLBACK_STAR_TYPE = STAR_TYPES.find(function (type) { return type.id === DEFAULT_STAR_TYPE; });

    ns.PALETTE = PALETTE;
    ns.CONFIG = CONFIG;
    ns.DEPTH = DEPTH;
    ns.SCENES = SCENES;
    ns.LEVELS = LEVELS;
    ns.SCHEMES = SCHEMES;
    ns.FLYPY = FLYPY;
    ns.SYLLABLES = SYLLABLES;
    ns.MODES = MODES;
    ns.STAR_TYPES = STAR_TYPES;
    ns.DEFAULT_LEVEL = DEFAULT_LEVEL;
    ns.DEFAULT_MODE = DEFAULT_MODE;
    ns.DEFAULT_SCHEME = DEFAULT_SCHEME;
    ns.DEFAULT_STAR_TYPE = DEFAULT_STAR_TYPE;

    ns.tint = function (hex) {
        return parseInt(hex.slice(1), 16);
    };

    // 缺参与未知 id 都回落到默认档，不是 LEVELS[0]——那是入门档，会让漏传参数的场景静默变简单
    ns.levelById = function (id) {
        return LEVELS.find(function (level) { return level.id === id; }) || FALLBACK_LEVEL;
    };

    ns.modeById = function (id) {
        return MODES.find(function (mode) { return mode.id === id; }) || FALLBACK_MODE;
    };

    // 与 levelById / modeById 同一套路：缺参与未知 id 回落默认方案（标准），不是 SCHEMES[0] 的偶然顺序
    ns.schemeById = function (id) {
        return SCHEMES.find(function (scheme) { return scheme.id === id; }) || FALLBACK_SCHEME;
    };

    // 9f 双拼编码（纯函数，map 是入参）：一个音节 → 恒两键 [声母键, 韵母键]。
    // 切分：先查 zh/ch/sh 两字母声母，再查单字母声母，否则零声母。零声母统一走「首字母 + 韵母键」
    // （a→aa / ai→ad / er→er），无需特例。ü 的键盘形式 v/ve 与 iu/ui/un 缩写都在韵母表里直接覆盖。
    // 查不到韵母返回 null（配置错误暴露，不静默）；换自然码 / 微软 = 换 map，不改本函数
    ns.encodeShuangpin = function (syllable, map) {
        let initial;
        let final;
        const two = syllable.slice(0, 2);
        if (map.initials[two]) {
            initial = map.initials[two];
            final = syllable.slice(2);
        } else if ('bpmfdtnlgkhjqxrzcsyw'.includes(syllable[0])) {
            initial = syllable[0];
            final = syllable.slice(1);
        } else {
            // 零声母：首字母当声母键，整段音节当韵母查（a/o/e 单韵母查 finals[a/o/e] 得本键 → 双写）
            initial = syllable[0];
            final = syllable;
        }
        const finalKey = map.finals[final];
        if (!finalKey) { return null; }
        return [initial, finalKey];
    };

    // 9e 单元方案的内容串 → 单元表：每个字查一次字表，得到 { face, keys, readings }。
    // encode 是「拼音 → 键序」函数（9f 泛化）：缺省逐字母 split（汉字方案的全拼），
    // 双拼方案传 encodeShuangpin(py, map) 得恒 2 键。查不到字就是配置错误，直接抛出来比静默跳过好
    // ——静默跳过会让某一档悄悄少几个字没人发现，而 config.test 逐档遍历内容串会当场失败。
    // **9g 起字表的值可以是一组读音**：逐读音编码得到 readings（多音字任一读音都算对），
    // keys 取第一条当**规范读音**——菜单预览的"键序 a–b 键"、?debug 读数、触屏摊平都读它。
    // 单读音字的 readings 只有一个元素，全链路与 9f 之前逐字相同
    ns.unitsFor = function (chars, encode) {
        const toKeys = encode || function (pinyin) { return pinyin.split(''); };
        const list = [];
        for (const char of chars) {
            const entry = HANZI[char];
            if (!entry) { throw new Error('字表里没有这个字：' + char); }
            const spellings = Array.isArray(entry) ? entry : [entry];
            const readings = spellings.map(toKeys);
            list.push({ face: char, keys: readings[0], readings: readings });
        }
        return list;
    };

    // 星面字号（可读性红线，原未决 #8 的定案）：汉字按面积读，照抄档位的拉丁字号会捅出白芯，
    // 所以打折；MIN 是红线、MAX 挡住低档位把字放到白芯外。
    // cells = 显示面占几个字形格（汉字恒 1；9f 的音节面是 N）：多格面按格数缩到 fit，
    // 缩到红线就说明这一档的显示面塞不进 96 的星体——那是 9f 要做的决定（换汉字面或升级星体），
    // 这里如实给出撞了红线的字号，不假装塞得下
    ns.unitFaceSize = function (level, cells) {
        const base = Math.round(level.fontSize * CONFIG.UNIT_FACE_RATIO);
        const fit = Math.floor(CONFIG.UNIT_FACE_BOX * CONFIG.UNIT_STAR_SIZE / Math.max(1, cells || 1));
        return Math.max(CONFIG.UNIT_FACE_MIN, Math.min(base, CONFIG.UNIT_FACE_MAX, fit));
    };

    // 星面与进度点的几何（harness/ui.md 单体序列星节）。纯函数，config.test 像钉 LEVELS 那样逐格钉。
    // 排布是**点在上、显示面在下**：五角星实心区最宽的一段在 y ≈ −0.11 × 尺寸（半宽 ±0.34），
    // 越往下越窄、到 0.1806 × 尺寸处收成底部那个 V 形缺口，所以宽的那一排点必须放在上面。
    // 三条不变量（config.test 守）：面的墨迹底不越缺口、点排半宽不越该处实心半宽、点与字不叠
    ns.unitArt = function (level, cells) {
        const body = CONFIG.UNIT_STAR_SIZE;
        const face = ns.unitFaceSize(level, cells);
        // 墨迹半高 = 0.44 × 字号 + 描边一半（描边向外扩）
        const faceHalf = CONFIG.UNIT_FACE_INK * face + level.stroke / 2;
        const pipY = CONFIG.UNIT_PIP_Y * body;
        return {
            body: body,
            face: face,
            faceHalf: faceHalf,
            // 面的墨迹顶紧贴点排下沿 + 净空，于是"点 + 字"整组落在星体实心区里
            faceY: pipY + CONFIG.UNIT_PIP_R + CONFIG.UNIT_PIP_GAP + faceHalf,
            pipY: pipY,
            pipR: CONFIG.UNIT_PIP_R,
            pipPitch: CONFIG.UNIT_PIP_PITCH
        };
    };

    // 合成「本局生效档位」= 共享档位的物理 + 方案的内容（9a）+ 方案可用的特殊星（9d/9e）
    // + 单元方案的造型几何（9e）。下游（SpawnDirector / Star / Effects / HUD / 菜单预览）照旧读
    // level.pool / specials / units / fontSize / ...，不必认识方案——方案只在这一步把内容与造型接进来。
    // 每次返回新对象，调用方就地改也不会污染共享表。
    // 两道门禁都按类型表标志过滤、不硬编码 id：pair（线连双星仅标准方案）与
    // unit（黑洞与双星都装不进单体序列星，理由见类型表那两行）
    ns.levelFor = function (schemeId, levelId) {
        const scheme = ns.schemeById(schemeId);
        const level = ns.levelById(levelId);
        const specials = level.specials.filter(function (id) {
            const type = ns.starType(id);
            return (scheme.pair || !type.pair) && (!scheme.unit || type.unit);
        });
        const composed = Object.assign({}, level, {
            pool: scheme.content[level.id],
            specials: specials,
            // level.units 是全项目唯一的形式判据：null 就是键位方案，星面照旧就是键本身
            units: null
        });
        if (scheme.unit) {
            // 键序编码归方案（9f）：带 shuangpin 映射表的走双拼编码（恒 2 键），否则全拼逐字母。
            // 星面造型仍走 unitArt（汉字面单格），双拼不另立造型
            const encode = scheme.shuangpin
                ? function (pinyin) { return ns.encodeShuangpin(pinyin, scheme.shuangpin); }
                : null;
            composed.units = Object.assign({ list: ns.unitsFor(composed.pool, encode) }, ns.unitArt(level));
        }
        return composed;
    };

    // 与 levelById 同一套路：缺参与未知 id 都回落普通星。生成侧传 null 就是"这一颗不特殊"
    ns.starType = function (id) {
        return STAR_TYPES.find(function (type) { return type.id === id; }) || FALLBACK_STAR_TYPE;
    };

    // 5e 的加权生成（数据与算法在一起）：候选 = 普通星 + 本档 specials 开关里的类型，按表序排；
    // 特殊星权重吃 specialBoost，普通星不加倍。roll 是 [0,1) 的随机数由调用方喂——纯函数，
    // 分布能在 Node 里逐格验证。同屏特殊星到上限时回落普通星，不跳过这一拍
    ns.pickStarType = function (level, specialsOnScreen, roll) {
        const normal = FALLBACK_STAR_TYPE;
        if (specialsOnScreen >= CONFIG.SPECIAL_MAX_ON_SCREEN) { return normal; }
        const candidates = [normal];
        const weights = [normal.weight];
        let total = normal.weight;
        for (const type of STAR_TYPES) {
            if (type === normal || !level.specials.includes(type.id)) { continue; }
            candidates.push(type);
            const weight = type.weight * level.specialBoost;
            weights.push(weight);
            total += weight;
        }
        let cursor = roll * total;
        for (let i = 0; i < candidates.length; i++) {
            if (cursor < weights[i]) { return candidates[i]; }
            cursor -= weights[i];
        }
        // roll 贴 1 时的浮点兜底：走完累计仍没落进任何一段就取最后一类
        return candidates[candidates.length - 1];
    };

    // 9e 单元方案的挑选（与 pickStarType 同一条纪律：数据与算法在一起，roll 由调用方喂 Math.random()，
    // 分布在 Node 里可逐格验证）。只保留 letters.pickLetter 四条规则里对「单元」仍有意义的两条：
    // 不连续重复同一个显示面、同屏「下一个待敲键」≤ LETTER_MAX_SAME。待敲键是唯一会被敲到的
    // 那一键（lowestMatch 只认 star.nextKeys），所以按它算正是最低优先消歧的口径；后续键藏在
    // 显示面里、不参与判定，数它只会白白收紧生成（双星把还没轮到那颗计入，是因为那颗**看得见**）。
    // **9g 起多音字占它每个候选首键的名额**：任一读音都算对，所以只要有一个首键满了（或在排除集里）
    // 就不能出——只查第一条会让白圈在两个都接受该键的星之间撒谎。生成侧数 onScreen 时同样把
    // 每颗在场星的 nextKeys 全部计入，两边口径一致。
    // 英文频率加权与 40% 异手交替**不套用**——它们是键层的规则，套到汉字上只会把拼音首字母的
    // 英文频率伪装成字频（harness/gameplay.md 单元方案节）。单元层平权，与数字 / 符号专练同一口径。
    // 无候选可用时返回 null，由调用方跳过这次生成，不放宽硬约束
    ns.pickUnit = function (list, state, roll) {
        const last = state && state.last;
        const onScreen = (state && state.onScreen) || [];
        const exclude = (state && state.exclude) || [];
        const counts = {};
        for (const key of onScreen) { counts[key] = (counts[key] || 0) + 1; }

        const candidates = [];
        for (const unit of list) {
            if (unit.face === last) { continue; }
            const firsts = [];
            for (const reading of unit.readings) {
                if (firsts.indexOf(reading[0]) === -1) { firsts.push(reading[0]); }
            }
            let blocked = false;
            for (const key of firsts) {
                if ((counts[key] || 0) >= CONFIG.LETTER_MAX_SAME || exclude.indexOf(key) !== -1) {
                    blocked = true;
                    break;
                }
            }
            if (blocked) { continue; }
            candidates.push(unit);
        }
        if (!candidates.length) { return null; }
        // 平权：roll 落在第几段就取第几个（同 pickStarType 的浮点兜底，贴 1 时取最后一个）
        return candidates[Math.min(candidates.length - 1, Math.floor(roll * candidates.length))];
    };
})(window.ShootingStars = window.ShootingStars || {});