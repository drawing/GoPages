#!/usr/bin/env node
// 仅当用户明确要求时才运行（AGENTS.md"验证边界"一节的用户指令例外），AI 不得自主启动。
// 读 raw.json，出"谁对谁错"的报表。规则改动只动这个文件，不用重跑浏览器。
// 判据来自 requirements.md 4d 与 ui.md：触控 ≥44、零裁切、横屏左列与选牌器零重叠、320 竖屏溢出 6px 属已知接受项。
import { readFileSync, writeFileSync } from 'node:fs';

const OUT = process.env.SM_OUT || '/tmp/sm-4d';
const raw = JSON.parse(readFileSync(`${OUT}/raw.json`, 'utf8'));
const ONLY = (process.argv.find((a) => a.startsWith('--filter=')) || '').slice(9);

const TOUCH_MIN = 44;
const EPS = 0.5;

// ---------------------------------------------------------------- 展平

function labelOf(n) {
  if (n.s) return n.s;
  const kids = [];
  (function dig(x) {
    if (x.s) kids.push(x.s);
    (x.k || []).forEach(dig);
  })(n);
  return kids.length ? kids.slice(0, 2).join('/') : n.t;
}

// 展平成叶子清单：祖先不可见就整枝剪掉（Phaser Container visible=false 会连带子物体）。
// root = 顶层子树编号，用来排除"父子天然重叠"
function flatten(scene) {
  const leaves = [];
  const all = [];
  function walk(list, path, visible, rootIdx) {
    list.forEach((n, i) => {
      const vis = visible && n.v !== false && (n.a === undefined || n.a > 0.04);
      const p = `${path}/${i}`;
      const rec = { p, root: rootIdx, label: labelOf(n), t: n.t, b: n.b, hit: n.hit, hr: n.hr, vis, scene: scene.key };
      if (vis) {
        all.push(rec);
        if (n.b && !n.k) leaves.push(rec);
      }
      if (n.k) walk(n.k, p, vis, rootIdx);
    });
  }
  scene.tree.forEach((n, i) => walk([n], `${scene.key}`, true, i));
  return { leaves, all };
}

const contains = (b, w, h) => b[0] <= 0.5 && b[1] <= 0.5 && b[0] + b[2] >= w - 0.5 && b[1] + b[3] >= h - 0.5;
const intersects = (a, b) => {
  const x = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]));
  const y = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
  return x * y;
};

// ---------------------------------------------------------------- 逐用例判定

// 面板 = 可点对象里最大的近邻簇（棋盘 / 选牌器是一张格距几 px 的网）。
// 不聚类的话"暂停"（单枚、且比选牌器更靠左）和底部动作按钮会混进来，算出缝-55px 这种垃圾值
function clusterPanel(cells) {
  const gap = (a, b) => Math.max(
    a.b[0] - (b.b[0] + b.b[2]), b.b[0] - (a.b[0] + a.b[2]),
    a.b[1] - (b.b[1] + b.b[3]), b.b[1] - (a.b[1] + a.b[3]), 0
  );
  const used = new Array(cells.length).fill(false);
  const clusters = [];
  for (let i = 0; i < cells.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const stack = [i], cl = [];
    while (stack.length) {
      const j = stack.pop();
      cl.push(cells[j]);
      for (let k = 0; k < cells.length; k++) {
        if (!used[k] && gap(cells[j], cells[k]) <= 24) { used[k] = true; stack.push(k); }
      }
    }
    clusters.push(cl);
  }
  clusters.sort((a, b) => b.length - a.length);
  return clusters[0] && clusters[0].length >= 4 ? clusters[0] : [];
}

const verdicts = [];

for (const rec of raw.results) {
  if (ONLY && !rec.id.includes(ONLY)) continue;
  const v = {
    id: rec.id, screen: rec.screen, phase: rec.phase, type: rec.type, dir: rec.dir,
    vp: `${rec.vp.w}x${rec.vp.h}`, knownNarrow: rec.knownNarrow,
    touch: [], bounds: [], boundsAccepted: [], acceptMax: 0, overlap: [], overlapInfo: [], bleed: [], notes: [], ref: {},
  };
  if (!rec.ok) {
    v.verdict = 'ERROR';
    v.error = rec.error;
    if (rec.pageErrors && rec.pageErrors.length) v.notes = rec.pageErrors.slice();
    verdicts.push(v);
    continue;
  }
  if (rec.unstable) { v.verdict = 'UNSTABLE'; v.notes = Array.isArray(rec.motion) ? rec.motion.slice() : []; verdicts.push(v); continue; }

  const tol = Math.max(1, (rec.drift || 0) + EPS);
  if (rec.decor) v.ref.装饰漂移 = `${rec.decor} 节点 ≤${rec.drift}px`;

  for (const sc of rec.m.scenes) {
    const { w, h } = { w: sc.view.w, h: sc.view.h };
    const { leaves, all } = flatten(sc);

    // T：触控 ≥44（扑克无豁免）。只查真挂了 input 且 enabled 的——置灰按钮压根不挂 input（utils/ui.js）
    for (const n of all) {
      if (!n.hit || n.hit[2] === false) continue;
      if (n.hit[0] < TOUCH_MIN - EPS || n.hit[1] < TOUCH_MIN - EPS) {
        v.touch.push(`${sc.key} "${n.label}" ${n.hit[0]}x${n.hit[1]}`);
      }
    }

    // B：零裁切。只查"要读要点的对象"——文本，与真挂了 input 的可点区（用 hitArea 的世界矩形 hr，
    // 不是容器包围盒：容器盒会被装饰光晕撑大，334 的盒包着 159 的判定区，拿盒去比会满屏假违约）。
    // 整块铺满视口的是背景，按定义排除
    const contentGeom = [];
    for (const n of all) {
      if (n.t === 'Text' && n.b) contentGeom.push({ n, b: n.b });
      else if (n.hit && n.hit[2] !== false && n.hr) contentGeom.push({ n, b: n.hr });
    }
    for (const g of contentGeom) {
      const n = g.n, b = g.b;
      if (contains(b, w, h)) continue;
      const L = -b[0], T = -b[1], R = b[0] + b[2] - w, B = b[1] + b[3] - h;
      if (Math.max(L, T, R, B) > tol) {
        const side = [];
        if (L > tol) side.push(`左${L.toFixed(1)}`);
        if (T > tol) side.push(`上${T.toFixed(1)}`);
        if (R > tol) side.push(`右${R.toFixed(1)}`);
        if (B > tol) side.push(`下${B.toFixed(1)}`);
        const line = `${sc.key} "${n.label}" ${n.t} 出界 ${side.join(' ')}  b=${JSON.stringify(b)} 视口${w}x${h}`;
        // 320 宽竖屏两侧各出 6px 是 4d 拍板接受项（选牌器 min 332 是触控硬底，宁可溢出不缩）：
        // 只左右出界、且幅度在 8px 内的归接受项，其余（上下出界、超幅）仍是违约
        const accepted320 = rec.vp.w === 320 && sc.view.isPortrait && T <= tol && B <= tol && Math.max(L, R) <= 8;
        if (accepted320) {
          v.boundsAccepted.push(line);
          v.acceptMax = Math.max(v.acceptMax, Math.round(Math.max(L, R) * 10) / 10);
        } else {
          v.bounds.push(line);
        }
      }
    }

    // 装饰出血：非文本、不可点的叶子越界只记录不判违约（呈现台光晕、背景这类故意出血到视口外）
    for (const n of leaves) {
      if (n.t === 'Text' || (n.hit && n.hit[2] !== false)) continue;
      if (contains(n.b, w, h)) continue;
      const over = Math.max(-n.b[0], -n.b[1], n.b[0] + n.b[2] - w, n.b[1] + n.b[3] - h);
      if (over > tol) v.bleed.push(`${sc.key} "${n.label}" ${n.t} 出血 ${Math.round(over)}px b=${JSON.stringify(n.b)}`);
    }

    // O：不同顶层子树之间的内容重叠（文本 ∪ 可点物体）。横屏左列压到选牌器就是这一类。
    // 文本×文本单独归目视项：Phaser Text 的包围盒含行高内边距，上下相邻两行盒子相贴但字形没撞
    // （over13-color-480x320 截图核实过），硬判据只留"文本×可点"与"可点×可点"
    const content = contentGeom.map((g) => Object.assign({}, g.n, { b: g.b }));
    for (let i = 0; i < content.length; i++) {
      for (let j = i + 1; j < content.length; j++) {
        const A = content[i], B = content[j];
        if (A.root === B.root) continue; // 同一顶层子树 = 父子/兄弟，天然叠在一起
        const ow = Math.min(A.b[0] + A.b[2], B.b[0] + B.b[2]) - Math.max(A.b[0], B.b[0]);
        const oh = Math.min(A.b[1] + A.b[3], B.b[1] + B.b[3]) - Math.max(A.b[1], B.b[1]);
        if (ow <= 0 || oh <= 0) continue;
        const area = ow * oh, depth = Math.min(ow, oh);
        const line = `${sc.key} "${A.label}"(${A.t}) × "${B.label}"(${B.t}) 重叠 ${Math.round(area)}px² 深${depth.toFixed(1)}px`;
        if (A.t === 'Text' && B.t === 'Text') { v.overlapInfo.push(line); continue; }
        // 文本×可点：可点区是为触控放大到 44 的隐形矩形，文本行盒的行高内边距蹭上零点几 px 不算压到
        // （menu 的玩法档说明蹭胶囊 0.4px 就是这种）；真碰撞的深度是十几 px，用 6px 分开两者
        if (depth <= 6) continue;
        if (area <= 4) continue;
        v.overlap.push(line);
      }
    }

    // 参考数字：横屏左列右沿 / 玩法区左沿之间的缝（ui.md：左列宽 = 面板左沿再留一道缝）
    if (!sc.view.isPortrait && sc.key === 'GameScene') {
      const cells = clusterPanel(all.filter((n) => n.hit && n.hit[2] !== false && n.hr).map((n) => Object.assign({}, n, { b: n.hr })));
      if (cells.length) {
        const cellLeft = Math.min(...cells.map((n) => n.b[0]));
        const leftTexts = all.filter((n) => n.t === 'Text' && n.b && n.b[0] + n.b[2] <= cellLeft + 1);
        if (leftTexts.length) {
          const colRight = Math.max(...leftTexts.map((n) => n.b[0] + n.b[2]));
          v.ref.缝 = `左列右沿${colRight.toFixed(0)} 面板左沿${cellLeft.toFixed(0)} 缝${(cellLeft - colRight).toFixed(0)}px`;
        }
        const top = Math.min(...cells.map((n) => n.b[1])), bottom = Math.max(...cells.map((n) => n.b[1] + n.b[3]));
        v.ref.玩法区高 = `${(bottom - top).toFixed(0)}px / 可用${h - sc.view.gutter * 2}px`;
      }
    }
  }

  const bad = v.touch.length + v.bounds.length;
  // 两类拍板接受项不进违约：窄于 480 的横屏（4d 明写"不保证"），与 320 竖屏两侧各出 6px
  if (rec.knownNarrow) {
    v.verdict = 'KNOWN';
    v.notes.push(`窄横屏不保证（4d 拍板）：出界 ${v.bounds.length} 项、重叠 ${v.overlap.length} 项，仅作已知项记录`);
  } else if (rec.vp.w === 320 && sc_view_portrait(rec) && v.boundsAccepted.length && bad === 0 && v.overlap.length === 0) {
    v.verdict = 'KNOWN';
    v.notes.push(`320 竖屏两侧出界 ${v.boundsAccepted.length} 项、实测最大 ${v.acceptMax}px——4d 拍板"两侧各出 6px 接受"，数值对得上即不算违约`);
  } else if (bad === 0 && v.overlap.length === 0) {
    v.verdict = 'PASS';
  } else {
    v.verdict = 'FAIL';
  }
  verdicts.push(v);
}

function sc_view_portrait(rec) {
  return rec.m.scenes.some((s) => s.view.isPortrait);
}

// ---------------------------------------------------------------- 输出

const ORDER = { FAIL: 0, UNSTABLE: 1, ERROR: 2, KNOWN: 3, PASS: 4 };
verdicts.sort((a, b) => (ORDER[a.verdict] - ORDER[b.verdict]) || a.id.localeCompare(b.id));

const MARK = { PASS: '✅', FAIL: '❌', KNOWN: '⚠️ 已知', UNSTABLE: '△ 存疑', ERROR: '✗ 采集失败' };
const lines = [];
lines.push(`# 4d 全量量测报表`);
lines.push('');
lines.push(`采集时间 ${raw.generatedAt}｜目标 ${raw.url}｜用例 ${verdicts.length} 个`);
lines.push('');
const tally = {};
verdicts.forEach((v) => { tally[v.verdict] = (tally[v.verdict] || 0) + 1; });
lines.push(`**结论：${Object.keys(tally).map((k) => `${MARK[k]} ${k} ${tally[k]}`).join('｜')}**`);
lines.push('');
lines.push('判据：T = 触控 ≥44px（读实际 hitArea）｜B = 零裁切，只查文本与可点区（可点区用 hitArea 的世界矩形——容器包围盒会被装饰光晕撑大，334 的盒包着 159 的判定区）｜O = 不同顶层子树的内容重叠，只算"文本×可点"与"可点×可点"，且重叠深度 >6px（可点区是为触控放大到 44 的隐形矩形，文本行盒的行高内边距蹭上零点几 px 不算压到）；文本×文本包围盒含行高内边距，相贴不等于字形相撞，归第五节目视｜装饰出血（光晕 / 背景）归第六节，不判违约。');
lines.push('');

// 概览表
lines.push('## 一、逐用例结论');
lines.push('');
lines.push('| 结论 | 用例 | 屏幕/相位 | 视口 | T | B | O |');
lines.push('| --- | --- | --- | --- | --- | --- | --- |');
for (const v of verdicts) {
  lines.push(`| ${MARK[v.verdict]} | \`${v.id}\` | ${v.screen}${v.phase ? '/' + v.phase : ''}${v.type ? ' ' + v.type : ''}${v.dir === 'backward' ? ' 倒序' : ''} | ${v.vp} | ${v.touch.length || '—'} | ${v.bounds.length || '—'} | ${v.overlap.length || '—'} |`);
}
lines.push('');

// 按根因聚类：同一条违约出现在哪些用例，这是分批修的输入
lines.push('## 二、按根因聚类（分批修的输入）');
lines.push('');
const groups = new Map();
function addGroup(kind, sig, v) {
  const key = `${kind}||${sig}`;
  if (!groups.has(key)) groups.set(key, { kind, sig, cases: [] });
  groups.get(key).cases.push(`${v.id}(${v.vp})`);
}
for (const v of verdicts) {
  if (v.verdict === 'KNOWN') continue; // 已知项不进修复清单
  v.touch.forEach((t) => addGroup('T 触控<44', t.replace(/^[^ ]+ /, ''), v));
  v.bounds.forEach((b) => addGroup('B 出界', b.replace(/\s*b=.*$/, ''), v));
  v.overlap.forEach((o) => addGroup('O 重叠', o.replace(/^[^ ]+ /, '').replace(/重叠 \d+px²/, '重叠'), v));
}
const sorted = [...groups.values()].sort((a, b) => b.cases.length - a.cases.length || a.sig.localeCompare(b.sig));
if (!sorted.length) lines.push('（无违约项）');
sorted.forEach((g, i) => {
  lines.push(`### ${i + 1}. ${g.kind} — ${g.sig}`);
  lines.push('');
  lines.push(`影响 ${g.cases.length} 个用例：${g.cases.map((c) => '`' + c + '`').join('、')}`);
  lines.push('');
});

// 明细
lines.push('## 三、失败明细');
lines.push('');
for (const v of verdicts) {
  if (v.verdict === 'PASS') continue;
  lines.push(`### ${MARK[v.verdict]} \`${v.id}\` （${v.vp}）`);
  lines.push('');
  if (v.error) lines.push(`采集错误：${v.error}`);
  v.touch.forEach((x) => lines.push(`- **T** ${x}`));
  v.bounds.forEach((x) => lines.push(`- **B** ${x}`));
  v.boundsAccepted.forEach((x) => lines.push(`- **B(拍板接受)** ${x}`));
  v.overlap.forEach((x) => lines.push(`- **O** ${x}`));
  v.overlapInfo.forEach((x) => lines.push(`- 目视 ${x}`));
  if (v.bleed.length) lines.push(`- 装饰出血 ${v.bleed.length} 处（不判违约）：${v.bleed.slice(0, 3).join('；')}${v.bleed.length > 3 ? ' …' : ''}`);
  v.notes.forEach((x) => lines.push(`- 注：${x}`));
  const refs = Object.entries(v.ref || {});
  if (refs.length) lines.push(`- 参考：${refs.map(([k, x]) => `${k} ${x}`).join('；')}`);
  lines.push('');
}

// 参考数字单独一节，便于对着 ui.md 的定案核
lines.push('## 四、参考数字（不判对错，对着 ui.md 定案核）');
lines.push('');
lines.push('| 用例 | 视口 | 参考 |');
lines.push('| --- | --- | --- |');
for (const v of verdicts) {
  const refs = Object.entries(v.ref || {}).filter(([k]) => k !== '装饰漂移');
  if (refs.length) lines.push(`| \`${v.id}\` | ${v.vp} | ${refs.map(([k, x]) => `${k}：${x}`).join('；')} |`);
}
lines.push('');

// 文本相贴目视项：不判违约，但列出来给人扫一眼（包围盒含行高内边距，相贴不等于字形相撞）
lines.push('## 五、文本×文本包围盒相贴（目视项，不判违约）');
lines.push('');
const infoRows = verdicts.filter((v) => v.overlapInfo.length);
if (!infoRows.length) lines.push('（无）');
for (const v of infoRows) {
  lines.push(`- \`${v.id}\`（${v.vp}）：${v.overlapInfo.join('；')}`);
}
lines.push('');

// 装饰出血：光晕 / 背景这类故意画到视口外的对象，只计数不判违约
lines.push('## 六、装饰出血（不判违约，仅计数）');
lines.push('');
const bleedRows = verdicts.filter((v) => v.bleed.length);
if (!bleedRows.length) lines.push('（无）');
for (const v of bleedRows) lines.push(`- \`${v.id}\`（${v.vp}）：${v.bleed.length} 处`);
lines.push('');

const md = lines.join('\n');
writeFileSync(`${OUT}/report.md`, md);

// 控制台只打摘要
console.log(md.split('## 二、')[0]);
const g = md.split('## 二、按根因聚类（分批修的输入）')[1];
if (g) console.log('## 二、按根因聚类' + g.split('## 三、')[0].slice(0, 4000));
const five = md.split('## 五、')[1];
if (five && !five.startsWith('（无）')) console.log('## 五、' + five.slice(0, 2500));
console.log(`\n完整报表：${OUT}/report.md`);
