# AGENTS.md — shooting-stars

**开发上下文在 `harness/` 目录**（面向 AI、配合代码阅读，只保留粗线条，细节以代码为准）。下次开发直接从 harness 读取：`harness/README.md` 是入口与读取顺序，`requirements.md` 需求与进度（做什么、做到哪了、下一步、验收点、未决问题），`gameplay.md` 玩法规则，`ui.md` UI 原则与设计，`architecture.md` 文件组织 / 分层 / 技术定案 / 已知坑。**改玩法先改 `harness/gameplay.md`，改外观与交互先改 `harness/ui.md`，再动代码**；需求先行、实现时再设计，不提前定死"怎么做"（维护规则见 harness/README）。本文件只管工程纪律。

注意 `static/` 会被 Hugo 原样拷进 `public/` 发布，harness 与本文件上线后都是公开可读的。

## 测试

所有测试统一放 `tests/`，只此一处，命名 `<模块>.test.mjs`。无依赖、无 package.json，用 `node:test` + `node:assert/strict`。

```bash
node --test                        # 在本目录跑，自动发现 tests/*.test.mjs
node --test tests/letters.test.mjs # 单文件
```

别写 `node --test tests/`：本机 node 会把目录当模块路径解析，报 MODULE_NOT_FOUND。

### 怎么加载被测代码

源文件是 IIFE 挂 `window.ShootingStars`，不是 ESM，不能直接 import。`tests/load.mjs` 用 `node:vm` 造假 window（`devicePixelRatio` / `innerWidth` / `innerHeight`）+ 最小 Phaser stub，按序执行源文件后返回命名空间：

```js
import { load } from './load.mjs';
const ns = load();   // ns.CONFIG、ns.RENDER_SCALE、ns.utils.letters、ns.systems.SpawnDirector
```

- `load.mjs` 的 `FILES` 与 index.html 的 loader **同源同序，但只取到 `systems/`**：objects / scenes / main 要真 Phaser 与 canvas，在 Node 里跑没有意义。
- 新增纯逻辑模块：index.html loader 与 `FILES` 两处都加，顺序保持一致。渲染层文件永不进 `FILES`。
- stub 只补到"加载期不抛异常"为止（如 tween.js 顶层就要解析颜色）。缺什么补什么，不实现 Phaser 行为。
- 被测函数的依赖用最小鸭子类型假对象传入（如 `{ letter, y, setPulse }`），不 new 真 Star / Scene。

### 写什么

最小化的核心结构测试：只验易错点和核心不变量，不覆盖每个分支与细节。

只给纯逻辑模块写——不引用 Phaser、能在 Node 里直接加载的那些：letters / SpawnDirector，以及后续的 ScoreKeeper / Storage / codeToLetter / 爬升曲线。

### 不写什么

- 不启浏览器、不起 http server、不写 CDP / headless 脚本。
- 不断言实现细节：`Math.random` 调用次数、内部字段名、DOM、像素坐标、时序。
- 渲染相关一律不测：场景、Tween、粒子、光尾、HUD 布局、手感、帧率、视觉效果——由人打开页面点。

### 红线

`tests/` 下任何文件都**不得**加进 `index.html` 的 loader，它只在 Node 里跑。

`static/` 被 Hugo 原样拷贝发布，所以 tests 会随站点上线、外人可见，但对页面运行没有任何影响。