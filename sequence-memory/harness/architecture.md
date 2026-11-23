# 架构与约束

> 文件组织、分层红线、仍然有效的技术定案、已知坑。**只记约束与"为什么"，具体实现以代码为准。** 工程纪律（测试/验证边界/依赖/提交）见 `../AGENTS.md`。

## 技术定案（约束，不是待选方案）

- **Phaser 3（CDN）+ canvas**，照搬同仓库 shooting-stars 的场景架构与界面契约。代价：1.2MB CDN、splash/watchdog/fatal 三层兜底、"离线可玩"卖点作废（9 的 SW 补回）、canvas 文字不可选中读屏器读不到。**除此引擎外不自主引新依赖，要先问。**
- **音效 Web Audio 现场合成**，Phaser 声音管理器关掉（`audio: { noAudio: true }`），零素材零请求。
- **曲线手绘折线**（5c，`objects/Chart.js`），不引图表库。**横轴是固定的 `HISTORY_LIMIT` 个槽位、从左端起**：比例尺不随局数变，不满 20 局时曲线往右长、满 20 之后每来一局整条左移一格（需求 5c 的"曲线正确增长"与"超 20 局左滚"就是这一条）。纵轴 0 起，顶就是"最近局最高 / 历史最高"较大者**本身**（不取整：顶上那个数字得是玩家真打出过的成绩），中间刻度按 1 / 2 / 5 的十倍进位挑、一格不足 14px 只留两端；历史最高是虚线参考线 + 数字标签。
- **常模参照走正态 z 分数**（5d，`systems/Norms.js`），不引数学库也不查表：分布函数用 Zelen & Severo 多项式近似（A&S 26.2.17，|误差| < 1e-7），七行换来的是"报一个整数百分位"用不完的精度，而查表要几百个数还得插值。**`sd` 缺失（null）就是"这一格没有常模"**（返回 null、界面不给百分位）——只有均值算不出 z，编一个离散度比不给百分位更糟。百分位两端夹在 1 / 99（"第 100 百分位"等于说比所有人都强，这份近似数据撑不起那句话）；`score ≤ 0` 视同没有成绩（与 `bestOf` / 卡片"–"同一份口径）。无常模的类型改"历史第几好"（`rankIn`：并列取较好名次，不足两局返回 null）。**两种参照都是派生值不进存档**：由 best / score 现算，存下来就会在常模数据改了之后与档案里的旧值各说各话。
- **单页多 Scene**（八个：Boot/Menu/Records/Settings/HowTo/Game/Pause/GameOver）。DOM 只剩 #game-container + splash + fatal。**场景间不传 data，跨屏状态全走 systems**（data 是一次性消息，转屏 restart 重放会冲掉玩家后来的选择）。Pause 是覆盖层（launch + pause），其余整页替换，切换走 fadeTo。
- **玩法输入只支持点按**；桌面导航快捷键做但排最后（8d），**8d 前所有场景纯指针可走通**。
- **尺寸模型**：`Scale.NONE` + zoom=1/S（不用 RESIZE——它把 backing store 钉死在 CSS 像素，retina 发糊）。世界坐标 = 视口 CSS 像素，**场景禁止写死像素常量**，一律从 layout.js 的 {w,h,cx,cy,gutter,unit,isPortrait} 推。超采样靠 display.js（backing store = CSS×S，camera setZoom(S)，文字 setResolution(S)）。
- **尺寸变化 → 同一份 data scene.restart()**；GameScene.create() 必须是 session 状态的纯函数（局内状态全在 systems/session.js，不在场景）。debounce + 门槛（方向翻转 / 宽高比差 / 边长差，数值在 CONFIG）才 restart，纯高度抖动只更新 layout；背景留 overscan 余量。
- **中文换行**：`wordWrap.useAdvancedWrap: true`（Phaser 按空格分词，中文默认不换行），收进 ui.text 默认值一处生效。
- **本地存储（5a）**：`systems/Storage` 是边界服务（构造参数注入后端，probe 真写一次再删判隐私模式——判"对象存在"不够），cache-first：写盘失败后本会话以内存那份为准，不回头读旧值。`systems/ScoreKeeper` 是记录层：一份存档（'records'）装全部组合，**组合键 = 类型 × 模式 × 方向 × 速度档，合法键集收敛到 TYPES × PRESETS（12 个）**——Setup.normalize 保证开局永远落在胶囊上，PRESETS 没覆盖的组合不产生记录。每组合六字段：best / bestAt / errors / ms / taps / runs（最近 HISTORY_LIMIT 局，每局 {score, at}）；errors / ms / taps 累计供 tie-break（平均复现用时 = ms / taps）。读值按键型校验，未知键与坏记录趁落盘清掉。**记录页要的"读 + 分组 + tie-break 排序"全收在 `typeBoard(typeId)` 一处**（5b）：一次读整份 map、按 `MODES.ranked` 分冲榜 / 休闲两组、冲榜组按 最高 desc → 总错次 asc → 平均复现用时 asc 排（`avg` 用 `taps > 0 ? ms / taps : null`，比较时 null 当 +∞——comparator 出 NaN 会让排序未定义），交出去的是数字不是字符串（措辞与日期格式化归场景），无记录的档也留在结果里排最后。**5c 起它连 `runs` 一起交出去**（曲线素材，按下棋先后排、上限 `HISTORY_LIMIT`，没玩过的档是空数组），记录页因此仍然只有这一个读口径、不为曲线另走一次盘；`historyOf` 随之删掉——无人调用的第二条读口径留着就会漂。**5d 起它还交每档的常模百分位**（`percentile`：只给冲榜档，休闲与无常模的类型是 null，卡片那一句整句不画），百分位由 `best` 现算不进存档。**提交只在 GameScene.proceed 的 session.finish() 之后一次**，结果（previous / isRecord / percentile / rank / rankTotal）冻进结算快照——结算屏 create 随转屏 restart 重放，放那里会重复记账；结算读活值则已含本局，破纪录永远亮不起来。Prefs 读写同走 Storage（探测口径统一，存储键名不变）。
- **桌面安装（9）**：每 toy 一份 manifest + sw.js，**作用域锁死本目录**（博客页永不被接管）；SW 运行时缓存不写预缓存清单，**必须含 Phaser CDN 响应**；注册按协议守卫。图标自有 PNG（192/512/maskable + apple-touch-icon）。
- **file:// 双击联网时可玩**（断网打不开是 CDN 的已知代价）。
- **减少动效是系统偏好不是设置**（4b）：`utils.reducedMotion()` 现读 `matchMedia('(prefers-reduced-motion: reduce)')`（try/catch，读不到回落"不减"），物件在构建时读一次，场景 create / 转屏 restart 重读 = 免费跟随系统切换。**不进 Prefs、不进开局快照、不进组合键**——它没有"局中改不了"的问题，因为它压根不是玩家偏好。砍 / 留清单在 harness/ui.md：砍装饰性运动，保留亮起 / 遮罩 / 变色 / 翻牌 / 按下缩放等信息性动画，波浪与逐格示意的行进降级成同时亮（信息不能砍）。

## 分层红线

`src/systems/` **不引用 Phaser、DOM、scenes/objects/utils**——纯逻辑全部能在 Node 里测。渲染与交互放 scenes/objects/utils，永不进 tests/load.mjs 的 FILES。**session.js 归 systems 是功能前提**（转屏 restart，状态长在场景里就丢局）。Audio.js / Prefs.js / Storage.js 是浏览器边界服务（API 惰性取 + try/catch，Node 加载与隐私模式都不抛异常），进 FILES；Storage 的外部依赖走构造参数注入（`new Storage(fakeBackend)`），探测与兜底可测，Prefs / Audio 的浏览器行为不测。

## 文件组织（现状）

```
index.html          # Phaser CDN + 三层兜底 + 按序 loader（CSS 内联）
src/
  config.js         # 全部数据表与常量（见下）
  main.js           # 启动 + iOS 音频解锁监听
  systems/          # 纯逻辑：SequenceGenerator / Judge / Storage / Norms / ScoreKeeper / Prefs / Setup / session / Audio
  utils/            # display / layout / tween / ui
  objects/          # Backdrop / HUD / Symbols / Stage / Board / Cards / Effects / Chart
  scenes/           # 八个场景
tests/              # load.mjs（node:vm 假 window + 最小 Phaser stub）+ *.test.mjs
```

待建：manifest/sw.js/icons（9）。**阶段 9 三件不进 loader。** Norms 已随 5d 落地（systems，两处 loader 都登记在 ScoreKeeper 之前——提交时要调它）；`content/tips.js` 随技巧库删除不再待建（`gameplay.md` 末节）。"玩法"页已随 7 落地：场景改名 **HowToScene**（Tutorial 暗示可玩教学关，已改判取消，名字跟着改），**scaffold.js 整体删除**（最后一个占位调用方消失），index.html loader 与 main.js 场景表同步。

**loader 同源同序**：index.html loader 与 tests/load.mjs 的 FILES 一致，但 FILES 只取 config.js / systems/。新增纯逻辑模块两处都加。

## config 数据表指南

全部数据表与常量集中在 config.js（TYPES/MODES/DIRECTIONS/SPEEDS/PRESETS/BOARDS/CARDS/PALETTE/MOTION/FEEDBACK 等，以代码为准）。

- **加类型 = 往数据表添行 + 画法**，逻辑层零改动；**可用性归 ROADMAP**，界面不判断实现进度。
- **类型分支只准出现在画法与 Board 那一个分派处**；场景与状态机不认类型。Board 三份实现（gridBoard/streamBoard/cardPicker）共用返回契约 {container,sync,tick,center,cue,wave}，分派呈现形态在先（TYPES.stage）。
- 牌面画法四处共用 Cards.faceKit（face/中央呈现台/点数格/序列条），不会漂移；**分档只按牌宽**（full/mini），调用点不选档。full 档的点位建满 10 颗常驻，paint 里按点数摆位置与开关——换项不重建物件那条纪律在牌面上同样成立。
- **里程碑提速是 config 里的一个纯函数**（`milestoneSpeed(开局档, 当前长度) → {tier, show, gap}`），数据（SPEED_MILESTONES / 比例 / 下限）与算法放在一起：呈现节拍、HUD、暂停三处都从 session 的 `speedNow()` 取它，不会各算一套。它是**派生值不是设置**，所以不进开局快照、不进组合键。**只有休闲应用里程碑**（MODES.milestones）：冲榜与挑战的 speedNow 原样返回开局那一档（tier 0），局内不提速。
- **倒序只改判定侧的期望顺序**（3c）：Judge 按 direction 反转 expected，生成器永远给正序、呈现层不认方向。compare / wrongAt / 结算逐位回放全按**复现顺序**对齐；快照里的 sequence 仍是呈现顺序（那是"播了什么"，rows 才是"该怎么点"）。速度由玩法档决定不是自由选项：normalize 按 模式×方向 在 PRESETS 里找档取它的速度，组合没有档就把方向回落到该模式的档——草稿永远正好落在一个胶囊上。
- **起始长度是离散三档数据表**（4c，config.START_LENGTHS = [2, 3, 4]）：上限低于第一个里程碑 5——起始 ≥5 开局第一关就跨档提速，"提速被看见"失效。它归 Prefs 不归玩法档（不进组合键，休闲成绩不混排行）；冲榜与挑战的锁定在 Setup.snapshot（见下条），不在表里也不在生成器里。
- **全局偏好归 systems/Prefs**（4a 声音两开关，4c 补齐四键）：sound / colorTones / progressDots 布尔 + startLength 数值，本地持久化（5a 起读写走 systems.Storage，探测口径统一），读值按键型校验（布尔只认布尔，startLength 只认 config.START_LENGTHS 表内值）、写不进退回内存。Setup.snapshot 把 Prefs 合并进开局快照，**冲榜与挑战的 startLength 在 snapshot 一处锁回 2**（MODES.ranked，记录可比；休闲读偏好）——生成器不认模式，锁定不下沉。Audio 局内（session.active）只读那份快照、局外读 Prefs；HUD 的进度点门控同样只读快照（run.settings.progressDots）——纪律 1 的"局内不回读全局设置"对四项偏好都成立，开关入口因此只在开局前（4c 起在设置页）。四色音高是 config.COLOR_TONES 数据表（与 COLORS 同序），Audio 在 lit / ok 两处按它定音高，开关与音高数据都不进场景。
- **常模是一张按 类型 × 方向 索引的表**（`NORMS`，5d）：每格 `{mean, sd, source}`，**`sd` 为 null 就是"这一格没有常模"**（`Norms` 认不出来、界面不给百分位）。`source` 只给开发者看、不上屏幕（与 ROADMAP 里的阶段号同一条纪律）；上屏幕的是三句标注 `NORMS_NOTE` / `NORMS_NOTE_BEST` / `NORMS_NOTE_SHORT`（近似 + 常模听觉 / 本作视觉差异，记录页那句另说清"按最好一局算偏高"）。数字的离散度文献没直接给，取的是近似值（注释里写着取值理由）——**改这个数就是改所有百分位，动它之前先读 `gameplay.md` 难度节那三笔账**。加一格常模 = 往表里填一行，逻辑层与界面都不用改。

## 已知坑（代码表达不出的"为什么"）

- **camera 居中写显式 scrollX/Y，不用 centerOn**：midPoint 下一帧才更新，转屏后首次 create 拿旧尺寸把画面推出视口。
- **scroll 是布局基准 → 不用 camera.shake**：抖玩法区容器 x，抖完显式归零（浮点尾差不归零会永久偏出基准）。
- **alpha 恰为 0 的物件不可点**（Phaser willRender 跳过）：淡入按钮先把 alpha 抬到 0.02 再 tween。
- **addCounter 只收一个 config 对象**（{from,to,...}），传两个参数会把 0 当 config、真配置丢弃。
- **带 delay 的 tween 在延迟走完才取起始值**：挂之前显式 setScale(1)，否则 yoyo 把"弹到一半"当静止态。
- **ui.button hitArea 用 (0,0,w,h)**：Container 命中测试先加 displayOrigin，居中坐标只有左上 1/4 可点。Container 要 setSize 才有宽度。
- **节拍走 update() 累加时钟不用 scene.time 定时器**：paused 场景 update 不推进，暂停自动冻住；场景事件跨 restart 会累积，能不用就不用。
- **重开本局用对象身份当信号**（session.start 换整份状态对象，GameScene 认出对象变了就重画），不用事件。
- **呈现期喂复现层替身 view {lit:null, veil:true, interactive:false}**：遮罩要在棋盘露出之前就位，否则 hidden 那拍先闪出格子；仍是全量推导。首次同步用 fresh/immediate 旗直接落位。
- **呈现台的尺寸由场景传可用矩形**：Stage 自己只拿得到视口，HUD / 短提示 / 状态行 / 按钮的内扣只有 GameScene 算得出来。传的是**可用矩形**不是 fitBoard 之后的面板尺寸（面板是装不下才缩的，呈现不继承那个缩放）；横屏传面板宽而不是列宽——面板右对齐，给列宽会把中央大牌推出屏幕右边。
- **192px 纹理非 POT**：Phaser 3.90 只有 POT 才 generateMipmap，WebGL 下小尺寸走无 mipmap 的 LINEAR 缩小（可读性问题见 requirements）。
- **Graphics 的 `fillGradientStyle` 在圆角矩形上是坏的**（Phaser 3.90，读 dist 源码确认）：四角色只在 `fillRect` 上映到真四角；走 `fillPath` 的形状（`fillRoundedRect` 就是）被 earcut 切成三角形之后，`batchFillPath` 给每个三角形贴的是 TL / TR / BL 三个角色、按三角形自己的顶点序（连 BR 都不读），一块板子于是变成按三角形分块的色斑 + 对角接缝。Canvas 渲染器更干脆：`GRADIENT_FILL_STYLE` 整条跳过（只把游标推过去），前面没有 `fillStyle` 就会拿上一条命令的颜色来填（多半是白）。所以"上亮下暗"的材质走 `ui.slab` 的两道**部分路径描边**（只描圆角矩形的上缘 / 下缘，harness/ui.md 材质那条）；真渐变只用在烤成纹理的地方（`sky` / `hudBar` 是 image，不经三角化）。
- **星点用固定种子 LCG 不用 Math.random**：否则每次转屏换一张星空。
- **换纹理后要再给一次 setDisplaySize**（scale 是数值，纹理换了显示尺寸跟着变）。
- **同一局的 ms 读数 HUD 与结算可以不同**：HUD / 暂停读 `session.speedNow()`（里程碑之后的活值），结算读冻结快照里的那一档（组合键身份）。看着像不一致，是有意的，别"修好"它（harness/ui.md）。
- **结算的历史最高读终局冻进的提交结果（last.record），不读 ScoreKeeper 活值**：提交在进结算屏之前发生，活值已含本局，`score > best` 永远不成立、NEW RECORD 永远不亮。首页的 bestOf 读活值是对的（它在开局前显示）。最高为 0 两屏都视同没有记录（显示"–"），口径只此一份。**5d 的参照行同理**：percentile / rank / rankTotal 也在那一次提交里算完冻进 `last.record`，结算不现读盘（现读的话"历史第几好"会跟着后来的局漂，而 best 那三件已经说过为什么不行）；`rank` 里本来就该含本局——提交时 runs 已经 push 过它。
- **记录页的当前类型与选中的卡都存场景实例字段，不传 data、也不回写 `Setup.draft`**（5b 的类型，5c 的档）：转屏 restart 会把 `settings.data` 原样重放（见 `display.js` 的 relayout），data 里带"进页时那一份选择"就会冲掉玩家后来点的类型与卡片——与 PauseScene 从 session 现读同一条理由。场景实例跨 restart 复用（PauseScene 的 `_smFading` 复位是同一条先例），所以实例字段既保住选择又不需要 data；`create()` 里只在字段为空时从草稿播种一次（类型播 `draft.type`，档播 `draft` 的 模式 × 方向 × 速度 命中的那个 PRESETS 项）。**不回写草稿**：看记录不该偷偷改掉下一局的组合。认下的代价：离开记录页再进来停在上次看的那一类型、那一张卡——要"每次进来都回到草稿那一份"就得区分"进入 vs 转屏 restart"，而那只能靠 data，正是要避开的坑。
- **记录页的曲线高度先从预算里划出来，卡片再拿剩下的跑降级阶梯**（5c）：反过来的话（卡片先吃满、曲线拿剩的），320×568 这类小屏上明明把数字降一级字号就放得下的曲线会被整块砍掉。所以 `buildBoard` 先按"日期砍掉 + 数字压到 18px 下限"量一次卡片的最小总高，剩下的才决定曲线给不给、给多少，最后卡片在扣掉曲线之后的预算里跑阶梯。横屏不走这一步：曲线归左列、右列只有卡片（`withChart` 为假），两列各有各的预算。
- **曲线块的"最小高度"不是一个常量**（5c，`objects.chartFit(view)`）：块高 = 内扣 ×2 + 标题行 + 缝 + 图位，前三项都从 `unit` 推。写死一个 76 当下限的话，unit 44 上光内扣就吃掉 48、图位只剩几 px（画出来是一条挤在标题下的横线）。所以下限与目标值都由 `chartFit` 从图位的上下限（30 / 96）反推出来，场景算预算与 Chart 摆图共用这一份口径（unit 18 → 最小 71 / 目标 88，unit 44 → 最小 106 / 目标 172）。
- **可选卡的命中区是一个同尺寸的空 Container**（5c，`ui.card` 给了 `onSelect` 时）：全项目的 hitArea 约定是 Container 的 `(0,0,w,h)`（判定时 Phaser 先加 displayOrigin，见上面那条），卡片本体那张 Graphics 要沿用就得另算一套偏移；空 Container 不渲染、只吃指针，hover / 选中重画的仍是那张 Graphics。
- **记录页的常模句挂在卡的第二行末尾，不新开一行**（5d）：卡仍然是两行（5b 的不变量没破），常模句与达成日期 / 总错次 / 平均复现是同一类小字读数；顺带也便宜一点——新开一行是每张卡固定 +19px，挂在行里只在把第二行挤成第三行时 +15px，砍它的时候是缩短一个字符串、第二行立刻收回去。最紧的横屏右列（480×320 只有 222px 宽、预算 223）三张卡按最小排布就要 211，两种做法在那一档都被阶梯砍掉。阶梯把它排在**字号之后**（第三级）：字号是卡的门面、常模那句是近似参照，先动呈现再砍信息（1m 那条"信息一条不砍，砍的只是重复句子"）。曲线占位仍按"三级旋钮全关"量卡片最小总高，5c 那条不变量（卡片在全最小排布下一定装得下剩下的预算）一个字没动。
- **页脚的常模标注跟着"这一页有没有常模"走，不跟着降级阶梯走**（5d）：反过来（卡上还留着常模句才给标注）会成循环——阶梯要先量页脚的高度才知道卡片有多少预算，页脚又要等阶梯的结果。认下的代价：最紧的排布上可能出现"标注在、常模句被砍了"。页脚是量出来的，所以多一句话在竖屏只是多一行、在横屏左列从曲线预算里扣（按 11px 行高估过：480×320 的曲线块高 88 → 87 上下、320×568 的 88 → 78 上下，都还在最小块高 71 之上，一块图都没丢）。
- **normalize 的回落必须是"本组默认档"，不是"表里第一个已实现项"**：放开休闲之前这条差别被 `speedLocked` 掩盖（模式回落到冲榜，速度顺带被锁回默认）；放开之后模式回落到 `MODES[0]` = 休闲、它不锁速度，速度若跟着回落到 `SPEEDS[0]` = 慢，默认草稿就成了"休闲 · 慢"、一个胶囊都不高亮。3c 起速度不再自由回落而是从 PRESETS 取（见上条定案），"草稿落在胶囊之外"这类坑在结构上消失；type 等其余键的回落仍认默认档。setup.test.mjs 有一条专门钉"默认草稿正好选中 PRESETS 的第一项"。