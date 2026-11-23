# viewport-check — 移动端排布量测（仅用户明确要求时才跑）

用 agent-browser 打开真页面、按视口矩阵量场景树几何，出"谁对谁错"的报表。**不是 `node --test` 的一部分**：文件名不匹配测试发现规则，`node --test` 不会跑到这里；AI 也不得自主运行本目录任何脚本——只有用户在会话里明确说"跑一下视口量测 / 打开浏览器测"时才执行（见 `../AGENTS.md` 验证边界一节的用户指令例外）。

## 前置

- 本机有 `agent-browser`（Playwright 封装的 CLI）
- 页面已可访问，默认 `http://localhost:1313/toys/sequence-memory/`（hugo server），`SM_URL` 可覆盖
- 产物（raw.json / report.md / shots/）默认写 `/tmp/sm-4d`，`SM_OUT` 可覆盖——**不进仓库**

## 用法

```bash
node viewport-check/collect.mjs --smoke              # 4 个用例校准工具；改过脚本先跑这个
node viewport-check/collect.mjs                      # 全量 98 用例，约 7 分钟
node viewport-check/collect.mjs --filter=recall-card # 只跑 id 含该串的用例
node viewport-check/report.mjs                       # 读 raw.json 出 report.md，不碰浏览器
node viewport-check/shoot.mjs <用例id>...            # 复现某用例并截图，目视核实违约项
node viewport-check/inspect.mjs <用例id>             # 离线打印该用例全部对象几何，分辨真违约与规则误判
```

## 三趟走法

1. `--smoke` 校准：确认 bounds 坐标系是 CSS 像素、截图与数字互相印证，再放全量。
2. 全量采集：**只量不修**，一条代码都不改。
3. 按 report.md 第二节"根因聚类"分批修；每批修完重跑全量——量测便宜，全量回归比"只回归本场景"省心也更安全。

## 判据与已知口径

- **T 触控 ≥44px**：读实际 hitArea。置灰按钮压根不挂 input（`utils/ui.js`），天然不在检查面里。
- **B 零裁切**：只查文本与可点区；可点区用 hitArea 的世界矩形，**不用容器包围盒**——容器盒会被装饰光晕撑大（334 的盒包着 159 的判定区）。
- **O 重叠**：只算"文本×可点"与"可点×可点"。文本×文本的包围盒含行高内边距，相贴不等于字形相撞，归报表第五节目视。
- **拍板接受项不报违约**：320 宽竖屏两侧各出 6px（选牌器 min 332 是触控硬底）；窄于 480 的横屏（420×280 用例）只记录不判。
- **装饰出血**（呈现台光晕、背景）归报表第六节，只计数。
- 报表里的 FAIL **不等于产品 bug**：先 `inspect.mjs` 看对象是谁、`shoot.mjs` 目视核实，再动代码。

## 踩过的坑（改脚本前先看）

- 驱动切屏必须先停掉其它活跃场景：`scene.start` 只停调用者，不停旧场景会串台（SettingsScene 曾从第二个视口挂到最后一个用例，制造了几十个假违约）。
- 结算局必须造"中间点错"的真局：全点对会让 `GameOverScene` 读 `rows[null].expected` 抛异常、场景卡死在 CREATING。
- 空场景列表 = create 抛异常、画面没建起来，必须硬失败，绝不能判 PASS（曾有过假绿）。
- 页面报错自己挂 `window.onerror` 钩子按用例归属；CLI 的 errors 缓冲跨用例清不干净，会把上一个用例的异常算到下一个头上。
- 首页标题四个字在做浮动动画，≤6px 的漂移按装饰处理，不算"没 settle"；只有超过幅度或节点增删才重试。
