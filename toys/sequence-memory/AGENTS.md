# AGENTS.md — sequence-memory

**开发上下文在 `harness/` 目录**（面向 AI、配合代码阅读，只保留粗线条，细节以代码为准）。下次开发直接从 harness 读取：`harness/README.md` 是入口与读取顺序，`requirements.md` 需求与进度（做什么、做到哪了、下一步、验收点、未决问题），`gameplay.md` 玩法规则，`ui.md` UI 原则与设计，`architecture.md` 文件组织 / 分层 / 技术定案 / 已知坑。**改玩法先改 `harness/gameplay.md`，改外观与交互先改 `harness/ui.md`，再动代码**；需求先行、实现时再设计，不提前定死"怎么做"（维护规则见 harness/README）。本文件只管工程纪律。

注意 `static/` 会被 Hugo 原样拷进 `public/` 发布，harness 与本文件上线后都是公开可读的。

## 依赖：默认零依赖，这是给 AI 的默认值，不是工程红线

**本项目已经决定引入 Phaser 3（CDN）**，见 `harness/architecture.md`。所以"零依赖"在这里不再是现状，而是一条**默认值**：除已定案的那一个引擎依赖之外，不引别的框架、不引图表库、不引音频素材文件、不引图片素材文件（音效走 Web Audio 合成，牌面走程序化绘制）。

**这条约束的对象是"AI 不得自主引入依赖"，不是"本工程永久禁止依赖"。** 仓库根 `AGENTS.md` 对 `static/toys/` 的原话是"也可以用 CDN"，同仓库的 `shooting-stars` 就跑在 Phaser CDN 上。所以：

- 你自己判断需要某个**新**依赖时，**先问，不要直接加**。Phaser 那一条是用户拍板过的，不在此列。
- 用户明确拍板要用某个方案（包括引引擎、引 CDN）时照办，然后**回来把本节与 `harness/architecture.md` 的对应定案一起改掉**——文档必须跟实现一致，留一条已被推翻的"红线"会误导下一次判断。

引 CDN 的代价已经付出去了，别浪费它换来的体验：`harness/gameplay.md` 措辞红线的卖点从五条改成四条，**"离线可玩"不许再写**；splash / watchdog / fatal 三层兜底照抄 `shooting-stars`；阶段 9 的 service worker **必须把引擎响应也缓存进去**，那是把"离线可玩"补回来的唯一路径。

## 两条界面纪律

技术选型没有用响应式框架（改用 Phaser 之后依然如此——场景不是组件树），前提是靠这两条纪律消掉"设置改了但界面没跟上"这类 bug：

1. **设置只在开局读一次快照**，局内不再回读全局设置对象。
2. **进屏整块重画，局内物件常驻**：每个场景 `create()` 从零构建（转屏 restart 同样）；局内物件（色块、HUD、背景）建好之后常驻，状态变化走 tween，但每次同步仍从一个 `sync(view)` 入口**全量**由 session 推导目标状态，tween 只负责把物件动到目标。

**别引入"只更新我记得的那个对象"的写法**——那正是没有响应式框架时会漏更新的地方。纪律 2 保住的本意是：目标状态永远是 session 的纯函数，漏更新在结构上不会出现；放弃的只是"每次交互都销毁重建"这个 DOM 时代的手段——它让物件活不过一帧，tween 没有作用对象（完整表述见 `harness/ui.md` 两条界面纪律）。

第 2 条在改用 Phaser 之后多了一层用途：**它是"转屏不丢当前局"的实现前提**（`harness/architecture.md` 尺寸变化）。尺寸变化靠 `scene.restart()` 重排，只有 `create()` 是 `session` 状态的纯函数时，重启才等于免费重排而不是丢局。常驻物件随场景销毁，`create()` 从 session 重建，局不丢。

## 分层红线

`src/systems/` **不引用 Phaser、不引用 DOM、不引用 `src/scenes/` / `src/objects/` / `src/utils/`**。这条纪律换来的是"纯逻辑全部能在 Node 里直接测"。渲染与交互一律放 `scenes/` `objects/` `utils/`，永不进 `tests/load.mjs` 的 `FILES`。

局内状态机 `session.js` 归 `systems/`（它本来就不碰 DOM，迁移时从 `src/ui/` 挪进来）——**这不是归类洁癖，是功能前提**：转屏要 `scene.restart()`，状态如果长在场景里就会丢局。

## 验证边界：界面由人点，AI 不自主启浏览器（全会话红线，用户主动指令除外）

**不启浏览器、不起 http server、不写 CDP / headless / Playwright 脚本。** 这条约束的对象是 AI 在**任何会话、任何阶段的一切行为**，不是"不许写进 `tests/`"的局部规定；脚本放仓库外、用完即删、"只截图不写测试"都不豁免。曾有一次把它误读成测试目录的规定，起 headless Chrome 做"点一遍"验收，是违规操作，不要再犯。

**例外：用户主动要求时照办。** 上面这条红线约束的是 AI 的**自主决策**——不许自己判断"这里该验一下界面"就起浏览器、起 http server、写 headless 脚本。用户在会话里明确要求（"打开浏览器测一遍横屏竖屏""把这几个视口跑一下"）时，**用户指令的优先级高于本文件**，直接执行，不要反过来拿 AGENTS.md 去劝用户。别死板地只读限制条款：这条红线的用意是"不许 AI 自造验证手段、替人做界面判定"，不是禁止用户使用 AI 的浏览器能力。

例外之下仍有两点不变：界面验收的**最终判定权在人**（AI 报数字与截图，不自己宣布"验收通过"）；浏览器脚本**一律不进 `tests/`**（`node --test` 会去跑它）——用户拍板保留的那套量测脚本放 `viewport-check/`，见下节。

界面、动效、手感、移动端布局**一律由人打开页面点**来验收。AI 的自助验证只有 `node --test`（纯逻辑）与读代码；改动做完、测试全绿就停下来，把界面验收留给用户，拿不准就先问，不要自己造验证手段。

### 用户指令例外下的量测工具：`viewport-check/`

用户拍板保留的浏览器量测脚本在 `viewport-check/`（collect / report / shoot / inspect / drive 五个 `.mjs`，用法与判据见目录内 README）。**只有用户在会话里明确要求时才运行**——AI 不得自主启动，也不得把它接进任何自动流程（CI、hook、定时任务）。它不进 `tests/`：文件名不匹配 `node --test` 的发现规则，与本目录自动跑的纯逻辑用例物理隔离。

它产出的是**量测数字与截图，不是验收结论**：报表里的 FAIL 要先用 `inspect.mjs` 看违约对象是谁、`shoot.mjs` 目视核实，分辨真违约与规则误判之后才谈修；最终判定权在人。产物（raw.json / report.md / shots/）写临时目录，不进仓库。

## 测试

所有测试统一放 `tests/`，只此一处，命名 `<模块>.test.mjs`。无依赖、无 package.json，用 `node:test` + `node:assert/strict`。

```bash
node --test                          # 在本目录跑，自动发现 tests/*.test.mjs
node --test tests/judge.test.mjs     # 单文件
```

别写 `node --test tests/`：本机 node 会把目录当模块路径解析，报 MODULE_NOT_FOUND。

### 怎么加载被测代码

源文件是 IIFE 挂 `window.SequenceMemory`，不是 ESM，不能直接 import。`tests/load.mjs` 用 `node:vm` 造假 window，按序执行源文件后返回命名空间：

```js
import { load } from './load.mjs';
const ns = load();   // ns.CONFIG、ns.TYPES、ns.systems.SequenceGenerator、ns.systems.Judge …
```

- **与 `shooting-stars` 一致：`load.mjs` 要补一个最小 Phaser stub**，只补到"加载期不抛异常"为止，不实现 Phaser 行为。`Storage` 的外部依赖走构造参数传入（`new Storage(fakeBackend)`），不要在模块里直接读 `window.localStorage`。
- `load.mjs` 的 `FILES` 与 `index.html` 的 loader **同源同序，但只取 `config.js` / `systems/`**：`utils/` `objects/` `scenes/` 与 `main.js` 要真 Phaser 与 canvas，在 Node 里跑没有意义。
- 新增纯逻辑模块：`index.html` loader 与 `FILES` 两处都加，顺序保持一致。
- 被测函数的依赖用最小鸭子类型假对象传入，不 new 真的界面对象。

### 写什么

最小化的核心结构测试：只验易错点和核心不变量，不覆盖每个分支与细节。

只给纯逻辑模块写——序列生成（累积/独立/倒序）、判定（即点即判）、计分与 tie-break、常模百分位换算（5d，`systems/Norms`）、存储 schema 与读值校验。（技巧库不做，没有"结算按层推技巧"这套逻辑，也就没有它可测——见 `harness/gameplay.md` 末节。）

### 不写什么

- 浏览器 / http server / CDP / headless 脚本：见"验证边界"一节——AI 不得**自主**启浏览器（用户主动要求时是例外），但这类脚本一律不进 `tests/`：`node --test` 会去跑它，且 `static/` 随站点发布。放仓库外或临时目录。
- 不断言实现细节：`Math.random` 调用次数、内部字段名、DOM 结构、CSS 类名、时序。
- 界面与媒体一律不测：场景切换、canvas 牌面、翻牌动画、Web Audio、曲线绘制、移动端布局、手感、视觉效果——由人打开页面点。

### 红线

`tests/` 下任何文件都**不得**加进 `index.html` 的 loader，它只在 Node 里跑。

`static/` 被 Hugo 原样拷贝发布，所以 tests 会随站点上线、外人可见，但对页面运行没有任何影响。

## 文案红线

见 `harness/gameplay.md` 措辞红线，摘最硬的几条：

- **不写**"提升记忆力""变聪明""过目不忘""预防痴呆""延缓认知衰退"。
- **不给** IQ、脑龄、医学诊断。
- 进度曲线一律标注"**本游戏成绩**"，不做认知能力断言。
- 方法类文案只写"方法是什么、怎么用"，不写"用了能记住多少"（技巧库整页不做，这条管的是随手写的那几句）。

## 提交

中文 commit，沿用仓库惯例，带上阶段号：

```
sequence-memory 完成 1a：呈现阶段，颜色序列生成与 4 色块逐个高亮
```

一个子阶段一个 commit。**本节只规定 message 写法与粒度，不是提交授权：只有用户明确说提交时才 commit**，"实现某阶段"这类指令不包含提交。每步做完 `node --test` 全绿后停下来，界面由人打开页面点一遍验收（见"验证边界"）；验收通过、且用户指示提交，才提交。
