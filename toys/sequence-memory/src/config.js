(function (ns) {
    'use strict';

    // 颜色值只在这里写一遍（原来在 style.css，随 1e 一起删）。
    // 四个信号色一个没换——它们是玩法核心，harness/gameplay.md 明写"选色避开红 / 绿对"；
    // 换掉的只有背景与面板层，改用 shooting-stars 那套夜空渐变 + surface / overlay / scrim（harness/requirements.mdT1）
    const PALETTE = {
        skyTop: '#080b16',
        skyNight: '#141a2e',
        skyDusk: '#1c2440',
        skyGlow: '#5a4bff',
        // 远楼剪影阁楼的拱门与窗灯（Backdrop）：暖白极暗点缀，不是信号色、不眨
        windowLight: '#ffd9a0',

        blue: '#4c8dff',
        amber: '#ffb020',
        magenta: '#ff4d94',
        teal: '#2ee6c5',

        dominant: '#5a4bff',
        dominantSoft: '#8b7bff',

        text: '#eaeeff',
        textDim: '#a8b2d8',
        textFaint: '#7b87b0',

        surface: '#141a2e',
        surfaceEdge: '#2b3557',
        overlay: '#0d1222',
        scrim: '#04060e',

        // 扑克牌面（2c）：纸白牌面 + 红黑两色墨。红不用 danger——那是"点错了"的判定色，
        // 牌面的红是身份色，两者撞在一起会让玩家以为红牌都点错了（harness/ui.md）
        cardPaper: '#eef1fb',
        cardEdge: '#b6c0e0',
        cardRed: '#d92b45',
        cardInk: '#1c2338',
        // 牌背（2d）：深紫底，与纸白牌面一眼可分，也不和夜空背景混在一起
        cardBack: '#2b3363',

        success: '#2ee6c5',
        warning: '#ffb020',
        danger: '#ff5470',
        info: '#4c8dff'
    };

    const CONFIG = {
        FONT: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, -apple-system, "Segoe UI", sans-serif',
        MONO: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        FADE_MS: 220,

        // 超采样：backing store = CSS 尺寸 × S，camera zoom S，于是布局空间恒等于 CSS 像素（harness/requirements.mdT9）。
        // 纹理按同一倍数烤，任何 DPR 下都只缩不放，所以 resize 时不需要重烤
        RENDER_SCALE_MAX: 3,
        TEXTURE_SUPERSAMPLE: 3,
        GLYPH_SIZE: 64,

        // 局内顶条底缘那段软裙占纹理高度的比例（harness/ui.md 材质那条）：烤纹理与摆细线共用这一份，
        // 两边各算一套的话细线就会离开软裙起点。0.34 = 不透明段占 2/3，裙占 1/3
        HUD_BAR_SKIRT: 0.34,

        // 触控目标下限（harness/requirements.md 4d），布局与构件都拿它当最小尺寸
        TOUCH_TARGET: 44,

        // 响应式布局的推导参数：场景里禁止写死像素常量，一律从 utils/layout.js 返回的结构里取。
        // gutter 是左右留白，unit 是间距 / 字号的基准格，两者都按短边推、再夹进上下限
        GUTTER: { ratio: 0.07, min: 16, max: 44 },
        UNIT: { divisor: 18, min: 18, max: 44 },

        // 尺寸变化怎么活下来（harness/requirements.mdT9.1 与第三节 #16）：debounce 之后先无条件把画布与 camera 跟上视口
        // （不溢出、不留黑边），但只有方向翻转、或宽高比 / 尺寸跨过阈值才 restart 场景重排。
        // 手机地址栏收放只改高度（390×844 → 390×914 约 8%，宽高比只差 0.035），两个阈值都拦得住
        RESIZE_DEBOUNCE_MS: 140,
        RESTART_ASPECT_EPSILON: 0.12,
        RESTART_SIZE_EPSILON: 0.14
    };

    // 层序每一层都有名字：调用点不写 DEPTH.hud - 1 这类算式，插一层只在表里挑空位
    const DEPTH = {
        backdrop: 0,
        board: 10,
        fx: 20,
        hud: 30,
        overlay: 40,
        panel: 41
    };

    // 八个场景（harness/requirements.mdT5，1l 起删掉 Setup）：呈现与复现是 GameScene 内的两段状态，不再是两屏；
    // Boot 烤纹理，Pause 是覆盖层（scene.launch + scene.pause）
    const SCENES = {
        BOOT: 'BootScene',
        MENU: 'MenuScene',
        RECORDS: 'RecordsScene',
        SETTINGS: 'SettingsScene',
        HOW_TO: 'HowToScene',
        GAME: 'GameScene',
        PAUSE: 'PauseScene',
        GAME_OVER: 'GameOverScene'
    };

    // 数组顺序就是复现棋盘四象限的固定位置。每个色块另配一个固定形状（圆 / 方 / 三角 / 菱）：
    // 2e 起颜色走 stream 呈现（符号在中央闪现，位置恒定），"靠哪个位置亮"这条冗余在呈现端
    // 没有了，色觉兼容只剩形状一条。形状因此是常驻冗余，不是某个模式的开关——4b 定案不设色盲
    // 开关（开关打开后画面没有可见变化），也不在色块上印文字（印了会把视觉身份任务降级成
    // 可默念的命名任务），理由见 harness/requirements.md 与 harness/gameplay.md。
    // 形状纹理在 BootScene 里烤成白色 glyph-*，显示时按 hex tint
    const COLORS = [
        { id: 'blue', name: '蓝', shape: 'circle', shapeName: '圆形', hex: PALETTE.blue },
        { id: 'amber', name: '琥珀', shape: 'square', shapeName: '方形', hex: PALETTE.amber },
        { id: 'magenta', name: '品红', shape: 'triangle', shapeName: '三角', hex: PALETTE.magenta },
        { id: 'teal', name: '青', shape: 'diamond', shapeName: '菱形', hex: PALETTE.teal }
    ];

    // 颜色四音调（4a，harness/ui.md 声音节）：一色一个固定音高，顺序与 COLORS 一一对应。
    // E4–G4–A4–C5 四个音彼此是全音 / 小三度间隔，哼得出、分得开，也不与点错低鸣（160Hz）撞区。
    // 开关（Prefs.colorTones）默认关：开时颜色类型的呈现亮起与点对都按这张表定音高，
    // 关时回落各自的中性音。音高是数据不是算法，与 COLORS 放在一起，加颜色只添一行
    const COLOR_TONES = [329.63, 392.00, 440.00, 523.25];

    // 四种类型共用一条判定路径：数字类型改成点按 0–9 键盘之后，"打字类"这条支线不存在了
    // （harness/gameplay.md）。
    // unique = 序列无放回抽取（harness/gameplay.md）：扑克"选过的置灰不可再选"，允许重复会把
    // 同一张牌的第二次出现锁死，关卡无解；另三种类型允许相邻重复（Simon 惯例）
    //
    // stage = 呈现形态（harness/requirements.md2e–2g：颜色 2e、数字 2f、扑克 2g 均已改 stream）。判据：**测哪条通道，取决于呈现时
    // 哪个维度在变、哪个维度不变。** 呈现与复现共用同一张棋盘时，"哪一格亮了"与"亮的是什么"
    // 是同一个信息，玩家永远挑成本最低的位置通道，四种类型于是塌成同一款"棋盘多大"的空间广度
    // 游戏（4 / 9 / 10 / 52 格），channel 那一列成了装饰。
    //   stream = 符号在屏幕中央逐个闪现、位置恒定，复现才把棋盘发下来 → 只能记身份；
    //   board  = 呈现就在棋盘上点亮格子 → 测空间广度。位置类型必须是 board：
    //            位置就是它呈现的内容本身，搬到中央就没有内容了。
    // 形态与判定 / 计分 / 存档 schema 无关：序列仍然是符号下标的数组，改的只是呈现层
    const TYPES = [
        { id: 'color', name: '颜色', symbols: 4, input: 'tap', channel: '视觉', stage: 'stream' },
        { id: 'position', name: '位置', symbols: 9, input: 'tap', channel: '视空间', stage: 'board' },
        { id: 'digit', name: '数字', symbols: 10, input: 'tap', channel: '语音回路', stage: 'stream' },
        { id: 'card', name: '扑克', symbols: 52, input: 'tap', channel: '语义编码', unique: true, stage: 'stream' }
    ];

    // 九宫格的九个方位名，行优先（harness/gameplay.md：位置类型是 3×3 九宫格）。
    // 名字只在结算的诊断行里出现，格子上不印——印了就把"最纯的视空间广度"
    // 变成可以默念的任务（harness/ui.md）
    const CELLS = ['左上', '中上', '右上', '左中', '正中', '右中', '左下', '中下', '右下'];

    // 一副牌（2c）：花色外层、点数内层，所以下标 = 花色 × 13 + 点数。
    // SYMBOLS.card（诊断行的说法）与 BOARDS.card（怎么排）都从这张表推，
    // 牌面画法（objects/Cards.js）也读它——数据在 config、画法在 objects，与 2a 的分层一致。
    // 红黑是花色自带的属性，不是 52 张各写一遍；花色名用"红桃 / 方块"而不是"红心 / 方片"，
    // 与中文牌桌的通行说法一致
    const SUITS = [
        { id: 'spade', name: '黑桃', red: false },
        { id: 'heart', name: '红桃', red: true },
        { id: 'club', name: '梅花', red: false },
        { id: 'diamond', name: '方块', red: true }
    ];

    const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

    const CARDS = [];
    SUITS.forEach(function (suit) {
        RANKS.forEach(function (rank) {
            CARDS.push({
                id: suit.id + '-' + rank,
                suit: suit.id,
                rank: rank,
                name: suit.name + ' ' + rank,
                red: suit.red
            });
        });
    });

    // 每种类型的符号表：符号一律是 0..symbols-1 的下标（SequenceGenerator 的约定），
    // 这张表把下标翻译成玩家可读的名字与画面上的样子。name 给结算的诊断行，
    // hex 是那一格的强调色（亮起层 / 柔光 / 涟漪），glyph 是常驻标记的纹理名，null = 这一类不画标记。
    // 画法归 objects/Symbols.js，逻辑层只给数据（AGENTS 分层红线）
    const SYMBOLS = {
        color: COLORS.map(function (color) {
            return { name: color.name + '（' + color.shapeName + '）', hex: color.hex, glyph: color.shape };
        }),
        // 九格同色、不带标记：颜色在位置类型里信息量为零，一格一色等于制造干扰（harness/ui.md）
        position: CELLS.map(function (name) {
            return { name: name, hex: PALETTE.dominantSoft, glyph: null };
        }),
        // 十键同色、数字本身就是常驻标记：数字是这一格的身份，一格一色同样是制造干扰，
        // 判据与位置九格同色同源（harness/ui.md）。名字就是数字本身，诊断行读作"该点 3，你点了 7"
        digit: Array.from({ length: 10 }, function (_, d) {
            return { name: String(d), hex: PALETTE.dominantSoft, glyph: 'digit-' + d };
        }),
        // 扑克 52 张同强调色：牌的身份印在牌面上（点数 + 花色），一格一色同样是制造干扰，
        // 判据与位置九格同色、数字十键同色同源（harness/ui.md）。glyph 为 null——牌面不是单张标记纹理，
        // 画法走 objects/Cards.js；card 字段把整张牌的数据带给画法层（迷你回放格也读它）
        card: CARDS.map(function (card) {
            return { name: card.name, hex: PALETTE.dominantSoft, glyph: null, card: card };
        })
    };

    // 玩法区的排布（harness/requirements.md2a 的 Board 抽象）：类型只给"几行几列 + 最小边长"，
    // 呈现与复现的节奏全在 objects/Board.js 一处实现，四种类型共用这一份（harness/ui.md）。
    // 方阵格子的 min 由触控下限推出来（每格 ≥ CONFIG.TOUCH_TARGET），不在场景里各算一套。
    // 排布允许有空格：slots 给"符号下标 → 格子位置（行优先）"的映射，缺省就是下标本人。
    // 数字是电话键盘（harness/ui.md）：1–9 占上三行，0 在末行正中，末行两角留空。
    // 扑克不是方阵而是两步选牌器（2h，取代 2d 的 52 张牌堆）：kind: 'picker' 让 Stage 走翻牌呈现、
    // streamBoard 选 cardPicker 做复现层。cols × rows 排的是**当前花色的 13 个点数**（7 + 6，
    // 末行末列留空），不是 52 张牌——花色是 tab 那一层导航，不占格子。
    // 点数格是 5:7 的迷你牌面，min 是"每格宽 ≥44px"所需的玩法区宽（7 × 44 + 6 缝 × 4）：
    // 2d 给牌堆开的触控豁免随 52 张网格一起作废（harness/ui.md）
    const BOARDS = {
        color: { cols: 2, rows: 2, min: 140 },
        position: { cols: 3, rows: 3, min: 150 },
        digit: { cols: 3, rows: 4, min: 150, slots: [10, 0, 1, 2, 3, 4, 5, 6, 7, 8] },
        card: { kind: 'picker', cols: 7, rows: 2, min: 7 * CONFIG.TOUCH_TARGET + 6 * 4 }
    };

    // 两种流派的规则全在这里，Judge / SequenceGenerator 读表，不写 if (mode === ...)。
    // 判定两模式同为即点即判：退格 / 整条判定 / 容错评估过不做（harness/requirements.md 3b），
    // 错了再来一局就好，不必在同一局上死磕。
    // milestones = 局内要不要按长度提速（harness/gameplay.md 休闲里程碑）：只有休闲有，
    // 冲榜与挑战开局那一档就是全程那一档。速度档本身由玩法档决定（PRESETS），不是自由选项
    const MODES = [
        {
            id: 'leisure', name: '休闲', generate: 'append', judge: 'instant',
            undo: false, retries: 0, milestones: true, ranked: false
        },
        {
            id: 'ranked', name: '冲榜', generate: 'fresh', judge: 'instant',
            undo: false, retries: 0, milestones: false, ranked: true
        }
    ];

    // 复现方向（harness/gameplay.md 倒序）：呈现永远正序，倒序反的是判定侧的期望顺序
    //（Judge 读它），生成器与呈现层不认方向。倒序只通过挑战档提供，不进休闲
    const DIRECTIONS = [
        { id: 'forward', name: '正序' },
        { id: 'backward', name: '倒序' }
    ];

    // 离散三档而不是连续滑块：连续值会把记录的组合键碎成无数份（harness/requirements.md第三节 #1）
    const SPEEDS = [
        { id: 'slow', name: '慢', show: 1000, gap: 400 },
        { id: 'normal', name: '默认', show: 700, gap: 300 },
        { id: 'fast', name: '快', show: 400, gap: 200 }
    ];

    const SPEED_RANGE = { min: 300, max: 1500 };

    // 呈现节拍里不属于速度档的两拍：首项前让入场动画走完，末项后留一拍再遮，
    // 否则最后一闪会被遮罩吃掉。速度档只管 show / gap，这两个值不随档位变
    const PLAYBACK = { lead: 620, tail: 420 };

    // 复现阶段的反馈节拍，与呈现速度档无关：跟手的那一闪不该随档位忽快忽慢。
    // clear / fail 是自动切屏前的停顿，留出感知时间，玩家也能自己点按钮提前走
    const FEEDBACK = { tap: 260, clear: 640, fail: 900 };

    // 动效时长（harness/ui.md 的设计值，单位 ms）：节拍仍走 update() 累加时钟，
    // 这些只是 tween 的时长，不是定时器。hitStop 例外——它是 fail 节拍的推迟量（harness/ui.md）
    const MOTION = {
        litIn: 80,      // 呈现亮起：柔光淡入
        litOut: 180,    // 呈现熄灭：柔光淡出留余晖，不是瞬间消失
        pop: 200,       // 亮起弹一下 1→1.08→1
        press: 70,      // 按下缩到 0.94
        veilIn: 220,    // 遮罩淡入
        veilOut: 200,   // 遮罩淡出
        hint: 140,      // 短提示换文案
        action: 150,    // 动作按钮出现 / 收起
        flash: 170,     // 点错全屏红闪
        shake: 240,     // 点错玩法区左右抖两来回
        hitStop: 120,   // 点错后 fail 节拍推迟约 120ms 再挂，暂停照样冻得住
        ripple: 300,    // 点对涟漪环扩散
        wave: 70,       // 全对波浪 / 复现示意的逐格间隔
        count: 620,     // 长度大字滚动 +1（与结算大字同一个设计值）
        flip: 90,       // 扑克翻牌半程：scaleX 1→0 换面 →0→1，全程 180ms（harness/ui.md，2g 中央呈现）
        tab: 150        // 切花色 tab：13 个点数格整组换面的挤压动画（harness/ui.md，2h）
    };

    // 反馈的幅度参数（harness/ui.md）：时长在 MOTION，这里只放"多少 / 多大"。
    // 粒子数 12–20 颗、抖动 ±6px 都是契约里的设计值（4a 逐行核对过，不改）。
    // 涟漪从色块边缘起扩（环纹理半径 ≈ 显示边长 0.44，1.1 倍时正好贴着块沿）：
    // 从块内起扩的话大半寿命压在亮底上，白环看不见
    const FX = {
        shakeAmp: 6,
        rippleFrom: 1.1,
        rippleTo: 2.0,
        sparkCount: [12, 20],
        sparkSpeed: [60, 240],
        sparkGravity: 320,
        sparkLife: [420, 700]
    };

    // 休闲模式的速度里程碑（harness/gameplay.md）：按**当前序列长度**算，长度到 5 / 9 / 13 各提一档。
    // 不是"本局累计呈现项数"——那样第 2 关就到 5、第 3 关到 9，几乎开局顶满，里程碑失去意义。
    //
    // 提速走自己的台阶（MILESTONE_RATIO）而不占 SPEEDS 的档：SPEEDS 只有 慢/默认/快 三档、
    // 开局是默认，往上只剩一格，装不下三个里程碑。组合键记的是**开局选的那一档**，
    // 局内提速不进键，所以按比例走不违背"速度离散不连续"（harness/requirements.md 未决 #1）。
    // 下限 SPEED_RANGE.min：任何开局档提到底也不会低于它（快档当起点时第三个里程碑就落在这条下限上）。
    // 函数本身不认模式；session.speedNow 只给休闲应用里程碑（MODES.milestones），冲榜与挑战原样返回开局档
    const SPEED_MILESTONES = [5, 9, 13];
    const MILESTONE_RATIO = 0.8;

    const START_LENGTH = 2;
    // 起始长度的可调档（4c，harness/gameplay.md 设置项）：仅休闲生效，冲榜与挑战在
    // Setup.snapshot 锁回 START_LENGTH（记录可比）。上限低于第一个里程碑 5——
    // 起始 ≥5 开局第一关就跨档提速，"提速必须被看见"在开局那一关失效（没有"变快之前"可比）。
    // 离散三档与 SPEEDS 同一条取舍；它不进组合键（休闲成绩单独一栏不混排行）
    const START_LENGTHS = [2, 3, 4];
    const HISTORY_LIMIT = 20;
    const STORAGE_NS = 'toys.sequence-memory';

    // 常模只作近似参照（5d：systems/Norms 按正态 z 分数换算成百分位）。
    // **sd 缺失（null）就是"这一格没有常模"**：Norms 认不出来、界面不给百分位——不编数据比编错数据好，
    // 颜色与扑克压根没有公开常模（它们落回"历史第几好"，harness/gameplay.md）。
    // 数字的均值是"7 ± 2"那个传统读数，**离散度文献没直接给**：取公开样本里常见的 1.5
    //（各样本落在 1.2–1.5），比上沿所以百分位偏保守。天花板效应认下、不另做映射（harness/requirements.md #5）：
    // 常模测单次广度、本作测"打到打不动为止"，高分段一律压在第 99 百分位
    const NORMS = {
        color: null,
        position: {
            forward: { mean: 6.11, sd: 0.80, source: 'eCorsi 2014，年轻人正序' },
            backward: { mean: 5.29, sd: 1.20, source: 'eCorsi 2014，年轻人倒序' }
        },
        digit: {
            forward: { mean: 7, sd: 1.5, source: '健康成人数字广度正序约 7；离散度按公开样本常见区间取 1.5' },
            backward: { mean: 5, sd: 1.5, source: '健康成人数字广度倒序约 5；离散度同上' }
        },
        card: null
    };

    // 百分位的标注（harness/gameplay.md 措辞红线：必须与百分位同屏，窄列换短版但不许整句砍掉）。
    // 三句的分工：NORMS_NOTE 给结算（按这一局算），NORMS_NOTE_BEST 给记录页（按最好一局算，偏高要说出口），
    // NORMS_NOTE_SHORT 给窄列（width < 300，与记录页 LEAD / LEAD_SHORT、卡片达成日期同一个阈值）
    const NORMS_NOTE = '常模多为听觉呈现、本作是视觉呈现，百分位只是近似参照，不是测量结论。';
    const NORMS_NOTE_BEST = '常模多为听觉呈现、本作是视觉呈现，百分位只是近似参照；这里按你最好的一局算，比常模的单次成绩偏高。';
    const NORMS_NOTE_SHORT = '常模听觉、本作视觉，百分位近似。';

    const DEFAULT_TYPE = 'color';
    const DEFAULT_MODE = 'leisure';
    const DEFAULT_DIRECTION = 'forward';
    const DEFAULT_SPEED = 'normal';

    // 四个键的默认档按组名索引，给 Setup.normalize 当回落目标（harness/architecture.md 已知坑）。
    // 回落不能是"表里第一个已实现项"：休闲放开之后，模式回落到 MODES[0] = 休闲，
    // 速度若跟着回落到 SPEEDS[0] = 慢，默认草稿成了"休闲 · 慢"、一个胶囊都不高亮。
    // 3c 起速度从 PRESETS 取（玩法档决定速度），这类坑在结构上消失；其余键的回落仍认默认档
    const DEFAULTS = {
        type: DEFAULT_TYPE,
        mode: DEFAULT_MODE,
        direction: DEFAULT_DIRECTION,
        speed: DEFAULT_SPEED
    };

    // 每个选项的实现状态：true = 玩家现在就能选到它，字符串 = 哪一阶段接入（字符串只给开发者看，不上屏幕）。
    // 首页据此置灰未实现的类型行，并过滤玩法档（三项全 true 这一档才出现）；子阶段落地时改成 true。
    // 每组至少留一个 true，否则 normalize 无从回落。
    //
    // ROADMAP 只管"选不选得到"：休闲在 3a 放开即完整（累积追加 + 里程碑提速 + 即点即判），
    // 退格 / 容错评估过不做（harness/requirements.md 3b）；倒序在 3c 放开，只通过挑战档提供
    const ROADMAP = {
        type: { color: true, position: true, digit: true, card: true },
        mode: { leisure: true, ranked: true },
        direction: { forward: true, backward: true },
        speed: { slow: true, normal: true, fast: true }
    };

    // 置灰记号（harness/ui.md）：只剩"未开放"一种，只用在首页未开放的类型行上（记录 / 设置入口都已转活）。
    // "锁"随选设置屏的速度档一起退出了玩家链路（harness/requirements.md）；阶段号仍只留在 ROADMAP 与 harness
    const MARKS = { pending: '未开放' };

    // 玩法档：模式 × 方向 × 速度 的命名组合，来源是 harness/gameplay.md 的阶梯定位表（harness/requirements.md）。
    // 类型不打包进来——类型是"玩哪个游戏"，留在首页主菜单当难度阶梯。
    // 三项在 ROADMAP 里全开放，这一档才出现（Setup.presets 过滤）；没开放的档不画，也不置灰。
    // **数组顺序就是首页胶囊的顺序，默认档排最左**（DEFAULT_MODE = leisure）：默认选中的胶囊不在最左，
    // 看着像"选了第二个"而不是"这就是默认"。
    // **速度由档决定，不是自由选项**（3c 拍板）：冲榜正序锁默认档为了记录可比；
    // 挑战（冲榜 · 倒序）自带快档——组合键本来就含速度档，可比从来都是同组合内可比，
    // 挑战记录只跟挑战比，锁速纪律只约束冲榜本档。Setup.normalize 按 模式×方向 找档取速度
    const PRESETS = [
        { id: 'leisure', name: '休闲', mode: 'leisure', direction: 'forward', speed: 'normal' },
        { id: 'ranked', name: '冲榜', mode: 'ranked', direction: 'forward', speed: 'normal' },
        { id: 'challenge', name: '挑战', mode: 'ranked', direction: 'backward', speed: 'fast' }
    ];

    // 四个选项键与它们的取值表，normalize 靠它遍历归一（harness/requirements.md 起不再驱动界面）
    const OPTION_GROUPS = [
        { key: 'type', table: TYPES },
        { key: 'mode', table: MODES },
        { key: 'direction', table: DIRECTIONS },
        { key: 'speed', table: SPEEDS }
    ];

    function finder(table, fallbackId) {
        const fallback = table.find(function (item) { return item.id === fallbackId; });
        // 缺参与未知 id 都回落到默认档，不是 table[0]——那会让漏传参数的调用静默换档
        return function (id) {
            return table.find(function (item) { return item.id === id; }) || fallback;
        };
    }

    ns.PALETTE = PALETTE;
    ns.CONFIG = CONFIG;
    ns.DEPTH = DEPTH;
    ns.SCENES = SCENES;
    ns.COLORS = COLORS;
    ns.COLOR_TONES = COLOR_TONES;
    ns.TYPES = TYPES;
    ns.SYMBOLS = SYMBOLS;
    ns.BOARDS = BOARDS;
    ns.SUITS = SUITS;
    ns.RANKS = RANKS;
    ns.CARDS = CARDS;
    ns.MODES = MODES;
    ns.DIRECTIONS = DIRECTIONS;
    ns.SPEEDS = SPEEDS;
    ns.SPEED_RANGE = SPEED_RANGE;
    ns.ROADMAP = ROADMAP;
    ns.MARKS = MARKS;
    ns.PRESETS = PRESETS;
    ns.OPTION_GROUPS = OPTION_GROUPS;
    ns.PLAYBACK = PLAYBACK;
    ns.FEEDBACK = FEEDBACK;
    ns.MOTION = MOTION;
    ns.FX = FX;
    ns.SPEED_MILESTONES = SPEED_MILESTONES;
    ns.MILESTONE_RATIO = MILESTONE_RATIO;
    ns.DEFAULTS = DEFAULTS;
    ns.START_LENGTH = START_LENGTH;
    ns.START_LENGTHS = START_LENGTHS;
    ns.HISTORY_LIMIT = HISTORY_LIMIT;
    ns.STORAGE_NS = STORAGE_NS;
    ns.NORMS = NORMS;
    ns.NORMS_NOTE = NORMS_NOTE;
    ns.NORMS_NOTE_BEST = NORMS_NOTE_BEST;
    ns.NORMS_NOTE_SHORT = NORMS_NOTE_SHORT;

    ns.tint = function (hex) {
        return parseInt(hex.slice(1), 16);
    };

    // 把符号说成玩家可读的话只此一处：结算的诊断行与回放格都调它，不在各场景里各拼一遍
    ns.symbolName = function (typeId, index) {
        return SYMBOLS[typeId][index].name;
    };

    // 里程碑之后的实际节拍（harness/gameplay.md）：tier = 当前长度已经跨过几个里程碑，
    // show / gap 各乘 tier 次 MILESTONE_RATIO，show 落到 SPEED_RANGE.min 为止。
    // 纯函数、每次返回新对象：呈现节拍（GameScene.arm）与读数（HUD / 暂停）都从这里取，不会各算一套。
    // 开局选的那一档原样留在快照里当记录身份（组合键），这里给的是"现在多快"
    ns.milestoneSpeed = function (speed, length) {
        let tier = 0;
        SPEED_MILESTONES.forEach(function (at) {
            if (length >= at) { tier += 1; }
        });
        const scale = Math.pow(MILESTONE_RATIO, tier);
        return {
            tier: tier,
            show: Math.max(SPEED_RANGE.min, Math.round(speed.show * scale)),
            gap: Math.round(speed.gap * scale)
        };
    };

    ns.typeById = finder(TYPES, DEFAULT_TYPE);
    ns.modeById = finder(MODES, DEFAULT_MODE);
    ns.directionById = finder(DIRECTIONS, DEFAULT_DIRECTION);
    ns.speedById = finder(SPEEDS, DEFAULT_SPEED);

    // 每次返回新对象：开局读一次快照（AGENTS 界面纪律 1），快照不能和全局默认共用引用
    ns.defaultSettings = function () {
        return {
            type: DEFAULT_TYPE,
            mode: DEFAULT_MODE,
            direction: DEFAULT_DIRECTION,
            speed: DEFAULT_SPEED,
            startLength: START_LENGTH,
            sound: true,
            colorTones: false,
            progressDots: true
        };
    };
})(window.SequenceMemory = window.SequenceMemory || {});
