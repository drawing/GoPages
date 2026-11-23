# 架构与约束

> 文件组织、分层红线、仍然有效的技术定案、已知坑。**只记约束与"为什么"，具体实现以代码为准。** 工程纪律（测试 / 验证边界 / 依赖 / 提交）见 `../AGENTS.md`。

## 技术定案（约束，不是待选方案）

- **Phaser 3.90（jsdelivr CDN，SRI）+ 零二进制资源**：视觉全程序化烤纹理（CanvasTexture 2D context，不是 Graphics.generateTexture——圆角与径向渐变后者做不了），音效 Web Audio 合成（`audio: { noAudio: true }`）。**除此引擎外不自主引新依赖，要先问。**
- **classic script 按序加载，不用 ES modules**（`file://` 双击可玩，modules 被 CORS 拦）。index.html 末尾 loader 按 `config → utils → systems → objects → scenes → main` 插 script，全挂 `window.ShootingStars`。**新增文件必须登记进 loader 数组**，漏了静默不执行（表现为 ns.xxx is undefined）。
- **Scale.FIT + CENTER_BOTH，世界坐标恒 800×600**；DPR 补偿走 display.js：framebuffer 抬到设备像素量级（≤3×）+ camera zoom 锁回世界坐标。**三条硬约束**：文字 resolution = RENDER_SCALE（走 ui.text 默认值）；贴图超采样烤、显示只缩不放（含动画 scale 峰值）；zoomTo 目标必须乘 RENDER_SCALE 基准。验收读 `utils.upsampleRatio()`，1.00 = 像素级锐利。
- **下落不用物理引擎**：`y += speed × clamp(dt)` 纯函数，arcade 只给粒子重力。**delta 一律 clamp 50ms**，位移 / 生成 / 特效 / 倒计时共用同一道闸——切标签页回来不瞬移、暂停天然冻住。节奏用 update 累加时钟，不用 time.addEvent / delayedCall 做玩法时序（hit stop 的 timeScale 会拖慢定时器）。
- **场景间状态走 `scene.start(key, data)` + init**，无全局可变变量；转场统一 fadeTo（内部 stop 旧场景）。唯一例外是 Storage 单例——存档本身就是全局的。
- **localStorage 命名空间 `toys.shooting-stars.*`**（best / stats / settings / voidSeen / menu）；隐私模式探测必须真写一次再删（Safari 隐私模式对象存在但 setItem 抛异常），失败降级内存 cache，**读一律以 cache 为准**（写盘失败后读盘会读到旧值）。**settings 键唯一写者是 Settings（6c）**：volume / muted / reducedMotion / strict 四字段整份写，AudioSys 的音量/静音也委托它——两个写者各写各的字段会互相覆盖。**menu 键存菜单选择（9b）**：{ mode, scheme } 两字段，`Storage.selection()` 读时按 modeById / schemeById 校验（未知 id / 坏值回落默认），`saveSelection()` 写前归一，调用方只有 MenuScene——刷新保留所选玩法 × 方案，回菜单恢复上次选择。
- **最高分键 = 「方案@版本:档位-玩法」**（9a，如 `standard@1:3-endless`）：合法键集 `BEST_KEYS` 由 `SCHEMES × LEVELS × MODES` 生成（null 原型，`__proto__` 取不到真值）。**方案带版本是封印开关**：规则变更 bump version 后旧键落在合法集之外，bestMap 读不到 ⇒ 旧记录封存不混算（盘上仍留着，不删）。**旧键迁移一次性**：9a 之前的键是「档位-玩法」（无方案段），bestMap 读到就并进标准方案当前键并整份洗回盘（cache-first，写失败本会话仍以内存为准）；解析不出合法档位/玩法的当脏键丢。累计三项（stats）仍全局一份，不分方案。`submitRun(schemeId, levelId, modeId, stats)` 与 `bestKey(schemeId, levelId, modeId)` 都带方案首参。
- **开发读数只走 `?debug=1`**（7 定案）：`utils.debugMode()` 是浏览器边界检测（同 touchDevice 一类，缺 location 一律当关），GameScene 开局读一次。帧率 / 池统计 / 判定 / 特效 / 背景 / 氛围 / 可读性读数、参考线标签与结算页残留诊断都在它后面；参考线本体默认隐藏、`` ` `` 隐藏快捷键切换。3c 的 Effects.only 临时开关已删（五件套与类型专属件恒齐发），池 stats() 保留供读数与控制台。

## 分层红线

`src/systems/` 与 `utils/letters.js`、`utils/sequence.js` **不引用 Phaser / DOM / scenes / objects**——纯逻辑全部能在 Node 里测（letters / sequence / SpawnDirector / ScoreKeeper / Storage / Settings）。渲染与交互放 scenes / objects / utils，永不进 tests/load.mjs 的 FILES。一局的可变状态在 ScoreKeeper（含生命）与 scene data，不在渲染对象里；每颗星的键序进度是例外——它跟着星体走（`Star.seq`），但推进规则本身收在纯逻辑的 sequence 引擎里。

## 文件组织（现状）

```
index.html          # Phaser CDN + loader（CSS 内联）
src/
  config.js         # 全部数据表与常量（LEVELS/SCHEMES/MODES/类型表/字表 HANZI/COMBO_TIERS/CLIMB/PALETTE/DEPTH/各特效表）+ 数据旁的纯函数（pickStarType / pickUnit / unitArt / levelFor）
  main.js           # 启动 + 符号键 capture（Firefox 快速查找，标准与历史 keyCode 两套都收）
  systems/          # 纯逻辑：SpawnDirector / ScoreKeeper / Storage / Settings；AudioSys 是浏览器边界服务（同 Storage 一类）
  utils/            # display / letters / sequence（键序引擎，9d）/ tween（fadeTo/riseIn/slideIn/meteorIn）/ ui / touch（触屏检测）/ debug（?debug=1 读数开关）
  objects/          # Backdrop / Star / StarPool / TrailPool / Effects / HUD / Countdown
  scenes/           # Boot / Menu / Tutorial / Game / Pause / GameOver（六个，设置 / 模式 / 最高分都是菜单内模态不新增）
tests/              # load.mjs（node:vm 假 window + 最小 Phaser stub）+ *.test.mjs
```

AudioSys 已建（systems，6a 骨架 / 6b 全部事件）：与 Storage 同类的浏览器边界服务——浏览器 API 全部函数内惰性取，Node 加载不抛异常；单例走 `systems.audio()`。声音本身不进测试（AGENTS 验证边界）。**音量 / 静音自 6c 起委托 Settings**（getter 现读 + setVolume/setMuted 转发），settings 键由 Settings 整份写，AudioSys 不再自己 persist——菜单设置面板与 GameScene 读到的仍是同一份。**合成模型**：一个事件（`CONFIG.AUDIO` 的一行）= 一份共用参数 + 可选的 `voices` 分层，每层覆写自己要改的（`freq` 绝对音高 / `ratio` 相对根音 / `at` 起音偏移 / `dur` / `gain`）；`scale` + `opts.step` 是"按序取音高、超出表长封顶"的统一机制（连击音阶 / 倒计时 / 标题上行共用），所以"第 10 击起不再爬"是表规则不是某处的 if。料只有三种：振荡器（可 `glide` 滑音）、白噪声（`noise` + 低通扫频，缓冲建一次复用）、LFO（`tremolo` 加在包络那个 AudioParam 上）。**loader 同源同序**：index.html 与 tests/load.mjs 的 FILES 一致，但 FILES 只取 config / utils/letters / systems。

Settings（6c）：settings 键的唯一写者，四字段 volume / muted / reducedMotion / strict。读值只认合法类型（volume 是有限数字才收、clamp 0–1，其余三个布尔只认 `=== true`），旧版本 / 手改 / 坏 JSON 一律回落默认；set 只认这四个键，每次整份 persist。单例 `systems.settings()`，与 Storage 同一套路。减少动效的门控读取口 `utils.reducedMotion()` 现读**生效值 = 设置活值 ∨ 系统偏好**（6d 已并，调用点一行没动）；系统偏好那半是 `utils.systemReducedMotion()`——MediaQueryList 惰性建一次复用（Backdrop 每帧都问，不能每次现造）、`matches` 每次现读（系统切换立即跟上），try/catch 包严，无 matchMedia 当"系统不减"。它只供设置面板标注"跟随系统"，门控不直接读它。严格模式由 GameScene 开局喂进 ScoreKeeper（快照）。

## config 数据表指南

- **调手感 = 改表不改逻辑**：五档 / 模式 / 特殊星 / 倍率 / 爬升 / 特效参数全在 config.js，逻辑只读表。config.test 逐格守设计契约（harness/gameplay.md 的表），改到与契约不符就在测试里失败。
- **档位与方案拆分（9a）**：`LEVELS` 只管物理与高速可读性补偿（速度 / 间隔 / 上限 / 命 / 特殊星 / 字号 / 描边），五档共享；`SCHEMES` 是方案注册表，每个方案自带「档位 id → 内容池」梯度表与 `version`，标准方案内容表 = 拆分前现状。**加方案 = 添一行**（9b/9c/9f/9g 都注册到这里），流程不改。`levelFor(schemeId, levelId)` 合成「本局生效档位」= 档位物理 + 方案内容池，每次返回新对象（就地改不污染共享表）；下游（SpawnDirector / Star / Effects / HUD / 菜单预览）照旧读 `level.pool`，不认识方案。`schemeById` 与 `levelById` / `modeById` 同一套路：缺参与未知 id 回落默认方案。**9d 起 levelFor 还按方案的 `pair` 标志过滤 specials**：线连双星仅标准方案（`pair: true`）使用，专练与序列方案滤掉带 `pair` 标志的类型——过滤按类型表标志而不是硬编码 'double'，加类型不必改这里。菜单特殊星清单也读合成档位的 specials，与局内一致。
- **加特殊星 = 类型表添行 + 造型纹理 + 标志位**（hazard / disk / chill / glint / pillar / pair / unit / texture）+ 音效字段（sound / armSound，6b），流程只认标志与字段；判定分流与特效分派各一处，命中音也是读字段而不是按 id 分支。双星（pair）是唯一超出"填表"的一类：生成侧一次要挑两个字母、按它的半宽内缩边距，判定侧多一条"敲第一颗不是击落"的分流。**armSound 是键序推进那一声**（9e 起普通 / 金色 / 冰晶也填 `'arm'`——单元方案里它们都是多键星；黑洞恒 null，它不能敲永不推进），事件名从 `pair` 改成 `arm` 也是这个缘故。
- **加权选择在 config 的纯函数 pickStarType（数据与算法在一起）**：候选与加倍读 LEVELS（specials / specialBoost），权重读 STAR_TYPES，roll 由 SpawnDirector 喂 Math.random()——分布能在 Node 里逐格验证，不靠手感。同屏特殊星数由 SpawnDirector 现数 active 的 typeSpec（双星算一个），到上限回落普通星而不是跳过这一拍。菜单特殊星清单也读类型表的 name，不再有本地名字映射。**单元方案另走同款的纯函数 `pickUnit`（9e）**：roll 同样由调用方喂，只保留 `letters.pickLetter` 四条规则里对单元仍有意义的两条（不连续重复同一个字、同屏「下一个待敲键」≤ LETTER_MAX_SAME），**英文频率加权与 40% 异手交替是键层规则、单元层不套用**（理由见 gameplay.md 单元方案节），无候选返回 null 由调用方整拍跳过。
- **单元方案把「内容 + 造型」一起挂在合成档位上（9e）**：方案注册表加 `unit: true` 标志，`levelFor` 除了 pool / specials 还合成一个 `level.units = { list, body, face, faceY, pipY, pipR, pipPitch }`——`list` 是这一档的单元表（`{ face, keys, readings }`，由内容串逐字查字表得到；`keys` 是规范读音、`readings` 是全部读音的键序，9g），其余是星面与进度点的几何。**`if (level.units)` 是全项目唯一的形式判据**，为 null 就是键位方案，于是下游（Star / Effects / SpawnDirector / 菜单预览）照旧不认识方案。内容串仍是字符串（一串汉字，一个字一个单元），与键位方案的池串同构，所以 `level.pool` 语义不变、菜单预览与 ?debug 读数一行不改就能显示。造型常量与 `unitArt` / `unitFaceSize` 放在 config.js 而不是新拆一个纯模块，是因为 `levelFor` 要调它，而 config.js 是 loader 的第一个文件（那时 utils 还不存在）；顺带省下两处 loader 登记。
- **类型表的 `unit` 标志与 `pair` 门禁同构（9e）**：`levelFor` 过滤条件合成 `(scheme.pair || !type.pair) && (!scheme.unit || type.unit)`——黑洞与双星都是 `unit: false`（黑洞的理由见 gameplay.md 特殊星节：多键星上做不出完备的字母隔离，只排首键会造出"按对了却掉命"的陷阱）。单元方案 Lv3+ 因此只有金 / 冰两类。
- **双拼方案把「键序编码」也做成方案属性（9f）**：`SCHEMES` 行可带 `shuangpin: <map>`，`levelFor` 的单元分支据此选编码器——有 map 走 `encodeShuangpin(pinyin, map)`（恒 2 键），没有就 `pinyin.split('')`（汉字方案的全拼）。`unitsFor(chars, encode)` 因此泛化成第二参收一个 `pinyin → keys` 函数（缺省 split，汉字方案与既有单参调用逐字不变）。**9g 起字表的值可以是一组读音**（`行: ['xing', 'hang']`，单读音仍写字符串），`unitsFor` 逐读音编码产出 `readings`、`keys` 取第一条当规范读音；`pickUnit` 的同屏首键约束随之改成"这个字**每个**读音的首键都没满"（多音字占它每个候选键的名额，只查第一条会让白圈在两个都接受该键的星之间撒谎）。**编码器 `encodeShuangpin(syllable, map)` 的 map 是入参**：换自然码 / 微软双拼 = 另写一张 map 注册新方案，不改编码器也不改 flypy（验收"换映射 = 注册新方案"）。`FLYPY` 映射表与 `SYLLABLES`（412 个合法音节，剔除 lo）都在 config.js，覆盖与码字双射由 config.test 逐音节守。造型仍走 `unitArt`（汉字面单格），双拼不另立造型。
- **判定侧不认识键序长度（9d），但认识「待敲键集合」（9g）**：星体携带键序状态 `Star.seq = { paths, depth }`（纯逻辑的 `utils/sequence.js` 引擎）——`paths` 是**仍然存活的读音**（每敲对一键按它过滤一次），`depth` 是已敲对的键数。普通字母星与单读音单元星只有一条 path，多音字星（9g）有两条以上。派生缓存三个：`Star.nextKeys`（当前 depth 上所有存活路径的待敲键，去重）、`Star.letter`（= `nextKeys[0]`，**规范键**——触屏摊平 / 快照 / 读数 / 双星星位索引读它）、`Star.pending`（规范路径的再下一键，只给键位方案的生成侧数字母）。**9d 那条"letters.js 一行没改"到 9g 为止**：lowestMatch 改成按 `star.nextKeys` 集合匹配，markTargets 的脉冲改成保守口径（对自己每个候选键都是最低、且至少一个候选键与别人共享才亮，理由见 gameplay.md 多音字节）。白圈与命中仍是同一份计算，普通字母星 = 单键特例、双星 = 两键特例、单读音单元星 = 单路径特例。判定分流按 `sequence.isLast(seq)`（**某条**存活路径下一键即完成）而不是按类型 id：不是最后一键 ⇒ 推进（不计分不动连击），是最后一键 ⇒ 击落；敲错走 miss 分支、进度不回退。**收字只收各读音等长的多音字**，于是 `isLast` 不会有歧义（等长 ⇒ 不互为前缀 ⇒ 消除时机唯一）、进度点总数 = `sequence.total(seq)` 恒有定义。双星（pair）仍是唯一超出"填表"的类型：生成侧一次挑两个字母、按半宽内缩边距，视觉是线连两星位。**9e 起显示面与键序分离**：`Star.face` 是显示面（键位方案为 null，那时星面照旧就是键本身），所以触屏与击落上飘那一套不用认识键序；生成侧从 `pickUnit` 拿 `{ face, keys, readings }`，`StarPool.acquire` 与 `Star.spawn` 的首参是**键序内容**（键位方案一串键、单元方案一组读音，`sequence.create` 按 `Array.isArray(输入[0])` 分辨两种）。
- 缺参与未知 id 一律回落默认（levelById 回 Lv3 不是第一档、modeById / starType / schemeById 同理）。
- **严格模式罚分是 config 值**（STRICT_MISS_PENALTY = 一次基础分）：ScoreKeeper 只读表，miss / voidStrike 同罚、扣到 0 为止，crash 不罚。开关吃开局快照（GameScene create 时喂进 keeper），减少动效相反——触发点现读活值，立即生效。两种读取时机是刻意的：计分规则一局内必须恒定，动效降级要随时可切。
- **触屏判定不另开一套**（6e）：`letters.tapMatch` 是纯函数——鸭子类型 `{x, y, letter}` 点列里取半径内圆心最近者（半径也是入参，表值 CONFIG.TAP_RADIUS），不认识 Star。GameScene 把在场星的**可见星位**摊平成点列（双星两个星位各一个点，轮到敲的那颗取 star.letter、其余取 node.letter；多音字星因此只喂**规范读音**那一个键，9g），命中点的字母喂进同一份 judge()——lowestMatch / markTargets 一行没改，黑洞误敲与双星顺序错在触屏上原样成立，统计口径天然一致。检测 `utils.touchDevice()` 是浏览器边界（同 systemReducedMotion 一类）：maxTouchPoints ∨ ontouchstart，缺 API 当纯键盘，Node 里可注入假 window 测。

## 对象池纪律

- **星星池空跳过生成，不扩容**（少一颗星无感，扩容破坏"累计创建恒定"验收、带回 GC 尖峰）。
- **短命特效池（光尾 / 闪白 / 白环 / 字母 / 飘分 / 光柱 / 吸入 / 冰晶 / 星屑雨 / 装饰流星）满时抢最旧**：寿命固定 ⇒ active[0] 恒最旧 ⇒ 抢它最划算；跳过会让光尾断节、特效缺件玩家立刻看得见。**池大小 = 并发峰值**，按最快节奏算，写进测试。
- 粒子发射器单例 + emitParticleAt，不每次命中新建。池暴露只读 stats()（借出 / 池内 / 累计创建）供 ?debug=1 读数与控制台检查（7 保留）。
- 运行期动画优先在 step/update 里按闭式缓动推（吃 clamp dt，暂停自动停），少挂 Tween；HUD / 入场这类场景级动画才用 Tween，起新前 killTweensOf + 归位。

## 已知坑（代码表达不出的"为什么"）

- **全局倍率绝不写回 star.speed**：爬升就地乘这个字段，减速区 / 冰晶写回会攒成永久减速；临时倍率只作用当帧位移，实际速度另存 fallSpeed 供读数。爬升本身也只动派生字段，不污染共享表。
- **tint / setParticleTint / postFX 全是 WebGL only**（撞过六次）：Canvas 下退化。身份色烤死在纹理里（黑洞 / 冰晶描边）、辨识靠形状通道、全屏滤镜用 scrim 叠加。**7 定案（原未决 #3）**：保持 Phaser.AUTO，不为 Canvas 预烤六色纹理（不预支那份显存），接受 fallback 下星色 / 星屑退白——类型辨识有形状通道兜底，玩法完整。
- **Phaser 保留字段**：Container.body（物理体）、GameObject.type（display.js 靠它认 Text）——星体贴图叫 shape、类型行叫 typeSpec。
- **带文本的容器 scale 必须精确落回 1**：预栅格化纹理停在 1.001 也持续重采样发虚；带 delay 的 tween 延迟走完才取起始值，挂前显式 setScale。
- **双星的每个星位是子容器，它的 scale 与 Star 容器（弹入）的 scale 相乘**：字母 / 白芯 / 光晕必须跟着星体同比缩（单独缩星体会让字母溢出星框），给特效取快照时也要把两层乘起来，否则爆开的拷贝比真星大一档。连线是 Graphics（矢量），跟着容器缩放不会糊——这正是它不烤纹理的理由。
- **指数追赶 / 线性淡出要端点吸附**：渐近永远差 epsilon，浮点残渣会让"该收回"的物件多活一帧。
- **fillAlpha 留默认 1**：渲染是 alpha × fillAlpha，建矩形时传 fillAlpha 0 就永远不可见。
- **场景 shutdown 不清 events 监听**：挂过 update 钩子的（meteorIn）要显式摘；跨 restart 的监听会累积。**game.events 同理**：失焦自动暂停（6d）挂在 game.events 的 BLUR / HIDDEN 上，GameScene 在 SHUTDOWN 里显式 off——不摘的话回菜单再开局会攒出指向旧场景的回调。
- **codeToLetter 映射用 Object.create(null)**：普通对象把 constructor / toString 从原型链取成真值。
- **中文换行必须 wordWrap.useAdvancedWrap**：Phaser 按空格分词，中文整句单行捅穿卡片。
- **Text 没有 disableShadow**（3.90）：关阴影是 setShadow(0,0,'#000',0,false,false)；调不存在的方法会在 tween 回调里抛错打断主循环。
- **跨 realm 断言**：load.mjs 的 vm 数组 / 嵌套对象原型不同，deepStrictEqual 连原型比——Array.from 拷回本 realm，嵌套层单独展开。
- **暂停面板暗星用 tint 不用 alpha**：riseIn 会把 part 的 alpha 统一 tween 回 1。
- **AudioContext suspended 时 currentTime 不走**：排进去的音会在解锁那一刻挤着放，所以未 running 一律静默跳过；resume 必须在用户手势的同步调用栈里（main.js 的 capture 监听常驻不摘——iOS 切后台回来会重新 suspended，下一次点按顺手再解锁）。**手势之前连 ctx 都不建**（AudioSys.gestured）：建了也是 suspended、音一样放不出，还会在控制台留一条自动播放警告，而标题音阶恰好在刷新后第一次进菜单（还没有任何手势）就触发。并发上限按**层**算、丢最老时要 8ms 淡出再 stop，直接停会咔哒；`stop()` 早于该层的 `start()` 是合法的（等于取消一个还没出声的音符），被抢掉的排队层就是这么处理的。**挂起恢复（6d）**：回前台 visibilitychange 主动 resume 一次（仅已有过手势时，不伪造 gestured、不建 ctx——桌面浏览器切后台自动挂起，回来不该要求先点一下）；iOS 除 suspended 外还有 **interrupted**（来电 / 切后台），unlock 与 resume 凡非 running 非 closed 都 resume，不枚举状态名。
- **失焦自动暂停收 BLUR 与 HIDDEN 两条**（6d）：blur 是窗口失焦但仍可见（主循环还在跑），hidden 是切后台（Phaser 随即睡主循环）。launch / pause 是 queueOp，hidden 时排队的那一次在回来醒来的第一帧先于任何场景 update 落地（SceneManager 先 processQueue 再 step），不会先掉一帧的星；blur 时至多多走一帧，位移在 DELTA_MAX clamp 内。
- **UI 音只在 `ui.button` 的 activate 一处**（6b）：指针点击与键盘 Enter（menu.activate → flash）都经过它，所以不会各响一次。反过来，**绕开按钮的快捷键必须在自己的 handler 里补同一份事件名**（菜单 T/O/B/M、局内 Esc/`` ` ``/`\`、暂停 Esc/M、说明页 Esc、结算 R/E/M），否则点击有声、按键没声。要让动作本身出声的地方（设置面板的音量 / 静音：先改再响，面板自己演示自己）就给按钮显式 `sound: null`，不然会和动作各响一次。
- **场景级 pointerdown 与 ui.button 会收到同一次点击**（6e）：按钮激活在 pointerup，点星判定在 pointerdown，两者不互斥——点暂停按钮那一下也会进点星 handler。隔法是把地平线以下（按钮排所在的地面带）整个排除在点星判定之外，而不是去猜指针落在哪个按钮上。scene.input 的监听随场景 shutdown 一起清（InputPlugin 是场景自己的），不用像 game.events 那样显式摘。
- **字形家族 / 字号 / 颜色每次 set 都重栅格化整张文本纹理**（8）：星体字母与上飘字母都是池里复用的，所以 `node.family` / `item.family` 记住上一次的字形类，只在变化时调 setFontFamily（同 emitScore 的 setFontSize 纪律）。数字走 `CONFIG.MONO`（斜杠零）、字母走 `CONFIG.FONT`，映射收在 `ui.glyphFamily` 一处——两处渲染点必须读同一份，否则命中炸开那一下字形换脸。**MONO 栈的实际落点**：SF Mono 在 macOS 没全局注册（字体文件在 Terminal.app 私有目录，本机实测 AppKit 拿不到 SFMono-Bold），`ui-monospace` / `SFMono-Regular` 那两级大概率落空、实际渲染 Menlo；Windows 落 Consolas。两者都是斜杠零，所以验收就看局内 `0` 里有没有那道斜杠——没有就说明该平台 generic monospace 不给，得升级成自己烤字形纹理。
- **`display.js` 的 rescaleText 会把任何自定义 resolution 强设回 `RENDER_SCALE`**（9e 撞上）：它递归 `scene.children.list`（含 Container 的 list）按 `object.type === 'Text'` 认字，转屏 / DPR 变化时对活跃与暂停的场景各走一遍。所以"容器放大 k 倍 + 文字 resolution 补 k 倍"这条补偿活不过一次转屏——字立刻糊（上飘字母与倒计时数字今天乘了倍数，转屏后同样会被洗回基准，是既有的潜在问题）。**要给星体里的字放大只有一条路：改显示尺寸、不改容器 scale**，字号用世界 px、resolution 恒 `RENDER_SCALE`。
- **星体从 72 长到 96 的三笔账**（9e）：① `starCore` 只有 32 源，单元星按需放大到 42.7——它是软径向渐变、没有硬边可糊，记在案的例外；② `star`（72 源）**不重烤**，它有 6 个消费点（光尾 / 闪白 white 层 / HUD 与暂停的生命图标 / 说明页示意 / Boot logo），代价是单元星的光尾比星体窄一档（尾本来 0.85→0.5 渐缩，"大半藏在星体背后"是既有预期），以及闪白的 white 层在单元星上放大到约 1.8×（`item.from` 乘了 `size/72`，那层本来就是 72 源按 1:1 显示、再靠动画放大——ADD 混合的一团白没有可读细节，同样记在案）；③ `ring` **重烤到 128**（圈半径 36→48）——它是 2.5px 硬边、最经不起放大，而且只有一个消费点，72 星体因此从"放大 1.06"变成纯缩 0.75，比今天更锐。**重烤任何被多处消费的纹理之前先数消费点**：漏改一个就在已验收的画面上静默大三倍。**闪白的主形状层用的是 `starHi`（216 源），所以它跟着 `from` 长到 96 仍是缩**——`item.from` 那笔乘法只在这一层是干净的。
- **小鹤双拼的 o/uo 同键碰撞（9f）**：flypy 把韵母 o 与 uo 都映到 O 键，于是 `lo`(咯) 与 `luo`(罗) 都编码成 `lo`——这是该方案唯一的码字碰撞。`lo` 是边缘口语 particle 音节，从 `SYLLABLES` 剔除（同汉字方案不收 ü / 多音字的取舍），其余 412 个音节码字唯一。做自然码 / 微软等别的映射时同样要跑双射检查，别假设"两键编码天然单射"。
- **多音字"任一读音都算对"只在各读音等长时成立（9g）**：放开等长会同时捅出三个洞。① **消除时机不唯一**——`得` de / dei，敲完 d-e 时一条路已完整、另一条还差 i，`isLast` 得选"任一路完成就炸"（最短匹配），于是 dei 那条读音永远走不到；② **进度点总数没有定义**——画 2 个点则 dei 走不通，画 3 个点则星会在还剩一个暗点时炸开，玩家读成 bug（9e 那条"整排点从头就看得见还剩几键"的信息通道就废了）；③ **挑最短读音成了退化最优解**——一个单元恒一次击落、得分与键数无关，所以 `石` 永远走 shi(3) 不走 dan(4)，"击落/分"这个统计量量的是"你多会挑短音"而不是打字水平，那时第 9g 条"按键长计分"就从可选变成必须。等长一刀把三个洞全堵上（等长 ⇒ 不互为前缀 ⇒ ①②不成立；等长 ⇒ 没有短的可挑 ⇒ ③不成立），代价是 `会 / 得 / 石 / 大 / 车 / 还 / 没 / 六 / 给 / 似 / 宿 / 削` 这些常用多音字收不进来。config.test 逐字钉"各读音等长且两两不同"。
- **最低优先从单值匹配改成集合匹配后，脉冲必须走保守口径（9g）**：`markTargets` 原来的语义是"有重复键、且我是最低那颗"，一个布尔够用。多音字星的候选键可能只对其中一个是最低（「行」x/h 在上、「好」h 在下：敲 h 掉「好」、敲 x 掉「行」），单个布尔表达不了"对哪个键最低"。取"对自己**每个**候选键都是最低、且至少一个候选键与别人共享才亮"——它会少亮（上面那例「行」不亮，尽管敲 x 确实掉它），但绝不撒谎；反过来"对任一候选键最低就亮"会让两颗同时亮，那是在说"两颗都会掉"。少亮的那颗本来也没有歧义（x 只有它一个），不需要圈。
- **改名 / 删文件要 hugo --cleanDestinationDir**：否则 public/ 旧产物残留继续被发布（static 用不了 aliases）。