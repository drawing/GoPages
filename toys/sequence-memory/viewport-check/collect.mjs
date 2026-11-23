#!/usr/bin/env node
// 仅当用户明确要求时才运行（AGENTS.md"验证边界"一节的用户指令例外），AI 不得自主启动。
// 4d 移动端适配全量量测：驱动 agent-browser 遍历矩阵，把每个画面的场景树几何落成 raw.json。
// 只量不判——判定在 report.mjs 里，改规则不用重跑浏览器。
// 放仓库外（AGENTS.md：浏览器脚本一律不进 tests/）。
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { driveJs, phaseJs, MEASURE_JS, HEALTH_JS } from './drive.mjs';

const URL = process.env.SM_URL || 'http://localhost:1313/toys/sequence-memory/';
const OUT = process.env.SM_OUT || '/tmp/sm-4d';
const SMOKE = process.argv.includes('--smoke');
const argOf = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const FILTER = argOf('filter', '');
const SHOTS = argOf('shots', 'none');

mkdirSync(OUT, { recursive: true });
mkdirSync(`${OUT}/shots`, { recursive: true });

// ---------------------------------------------------------------- 矩阵

const VIEWPORTS = [
  { id: '390x844', w: 390, h: 844, s: 3 },
  { id: '320x568', w: 320, h: 568, s: 2 },
  { id: '844x390', w: 844, h: 390, s: 3 },
  { id: '568x320', w: 568, h: 320, s: 2 },
  { id: '480x320', w: 480, h: 320, s: 2 },
  // 窄于 480 的横屏：requirements 4d 明写"不保证"，量它是为了把已知项钉成数字，不算违约
  { id: '420x280', w: 420, h: 280, s: 2, knownNarrow: true },
];

const TYPES = ['color', 'position', 'digit', 'card'];

function buildCases() {
  const cases = [];
  const push = (o) => cases.push(o);

  for (const v of VIEWPORTS) {
    push({ id: `menu-${v.id}`, screen: 'menu', vp: v });
    push({ id: `settings-${v.id}`, screen: 'settings', vp: v });
    push({ id: `pause-${v.id}`, screen: 'pause', vp: v, type: 'color', mode: 'leisure', dir: 'forward' });
  }

  for (const v of VIEWPORTS) {
    for (const t of TYPES) {
      push({ id: `game-present-${t}-${v.id}`, screen: 'game', phase: 'present', vp: v, type: t, mode: 'leisure', dir: 'forward' });
      push({ id: `game-recall-${t}-${v.id}`, screen: 'game', phase: 'recall', vp: v, type: t, mode: 'leisure', dir: 'forward' });
      push({ id: `over13-${t}-${v.id}`, screen: 'over', vp: v, type: t, mode: 'leisure', dir: 'forward', length: 13 });
    }
  }

  // 倒序不改排布（只改读数文案与判定顺序），抽最紧的两个视口验读数不溢出
  for (const v of VIEWPORTS.filter((x) => x.id === '480x320' || x.id === '320x568')) {
    for (const t of TYPES) {
      push({ id: `game-recall-bw-${t}-${v.id}`, screen: 'game', phase: 'recall', vp: v, type: t, mode: 'ranked', dir: 'backward' });
    }
  }

  if (SMOKE) {
    const want = ['menu-844x390', 'game-recall-card-844x390', 'game-recall-card-390x844', 'over13-color-480x320'];
    return cases.filter((c) => want.includes(c.id));
  }
  return FILTER ? cases.filter((c) => c.id.includes(FILTER)) : cases;
}

// ---------------------------------------------------------------- agent-browser 封装

function ab(args, timeout = 60000) {
  const out = execFileSync('agent-browser', args, { encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 });
  return out;
}

function evalJs(js) {
  const raw = ab(['eval', js, '--json']);
  const parsed = JSON.parse(raw);
  if (!parsed.success) throw new Error(`eval failed: ${JSON.stringify(parsed.error || parsed).slice(0, 300)}`);
  return parsed.data && parsed.data.result;
}

const wait = (ms) => ab(['wait', String(ms)]);

// ---------------------------------------------------------------- 浏览器侧脚本
// driveJs / phaseJs / MEASURE_JS / HEALTH_JS 都在 drive.mjs，与 shoot.mjs 共用同一份，避免两边漂移

// ---------------------------------------------------------------- 稳定性自检

// 逐节点比两次量测。只有 bounds / hitArea 变了才算几何在动——alpha 变化是呼吸 / 闪烁这类
// 装饰动画，不改排布，单独记一类。返回结构化差值，由调用方按幅度分级
function maxDelta(u, v) {
  const au = Array.isArray(u), av = Array.isArray(v);
  if (!au && !av) return 0; // 两边都没有这个字段 = 没变化（不是 Infinity，否则每个无 hitArea 的节点都被判成在动）
  if (!au || !av || u.length !== v.length) return Infinity;
  let m = 0;
  for (let i = 0; i < u.length; i++) m = Math.max(m, Math.abs(u[i] - v[i]));
  return Math.round(m * 10) / 10;
}

function diffTrees(a, b, path, out) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i], y = b[i];
    const ref = x || y;
    const p = `${path}/${i}:${ref.s ? `"${ref.s}"` : ref.t}`;
    if (!x || !y) { out.geom.push({ p, kind: '增删', d: Infinity }); continue; }
    const d = maxDelta(x.b, y.b);
    if (d > 0) out.geom.push({ p, kind: 'move', d });
    else {
      const dh = maxDelta(x.hit, y.hit);
      if (dh > 0) out.geom.push({ p, kind: 'hit', d: dh });
    }
    if (x.a !== y.a) out.alpha.push({ p, d: Math.round(Math.abs(x.a - y.a) * 100) / 100 });
    if (x.k && y.k) diffTrees(x.k, y.k, p, out);
    else if (!!x.k !== !!y.k) out.geom.push({ p, kind: '子树增删', d: Infinity });
  }
  return out;
}

function diffScenes(m1, m2) {
  const out = { geom: [], alpha: [] };
  const n = Math.max(m1.scenes.length, m2.scenes.length);
  for (let s = 0; s < n; s++) {
    const A = m1.scenes[s], B = m2.scenes[s];
    if (!A || !B || A.key !== B.key) { out.geom.push({ p: `场景 ${(A || B || {}).key}`, kind: '增删', d: Infinity }); continue; }
    diffTrees(A.tree, B.tree, A.key, out);
  }
  return out;
}

// 首页标题四个字各在一个 Container 里做浮动，永远不会静；≤6px 的漂移当装饰动画收下，
// 只有超过这个幅度或节点增删才算"没 settle"（那种数字不可信）
const DECOR_MAX = 6;

// 错误归属自己挂钩子，不用 CLI 的 errors 缓冲——那个跨用例清不干净，
// 会把上一个用例抛的异常算到下一个用例头上，四个用例一起假失败
const HOOK_JS = `(function(){
  if (!window.__smErr) {
    window.__smErr = [];
    window.addEventListener('error', function (e) {
      window.__smErr.push((((e.message || '(无消息)') + ' @' + String(e.filename || '').split('/').slice(-1)[0] + ':' + e.lineno + ':' + e.colno)).slice(0, 240));
    });
    window.addEventListener('unhandledrejection', function (e) {
      window.__smErr.push(('promise: ' + ((e.reason && e.reason.message) || e.reason)).slice(0, 240));
    });
  }
  return window.__smErr.length;
})()`;

function resetErrors() {
  evalJs(HOOK_JS);
  evalJs('(function(){ window.__smErr = []; return 0; })()');
}

function pageErrors() {
  try {
    const list = evalJs('(function(){ return window.__smErr ? window.__smErr.slice() : ["错误钩子丢了（页面可能重载过）"]; })()');
    return Array.isArray(list) ? list : [String(list)];
  } catch (e) {
    return [`<读 __smErr 失败: ${String(e.message).slice(0, 80)}>`];
  }
}

// ---------------------------------------------------------------- 主循环

const cases = buildCases();
const results = [];
let lastVp = null;

console.log(`目标 ${URL}`);
console.log(`用例 ${cases.length} 个（${SMOKE ? '烟测子集' : '全量'}），截图 ${SHOTS}`);

ab(['open', URL]);
wait(2500);

for (let i = 0; i < cases.length; i++) {
  const c = cases[i];
  const rec = { id: c.id, screen: c.screen, phase: c.phase || null, type: c.type || null, dir: c.dir || null, vp: c.vp, knownNarrow: !!c.vp.knownNarrow };
  const t0 = Date.now();
  try {
    if (!lastVp || lastVp.id !== c.vp.id) {
      ab(['set', 'viewport', String(c.vp.w), String(c.vp.h), String(c.vp.s)]);
      wait(400); // display.js 的 debounce 是 140ms，留余量让 relayout / restart 落地
      lastVp = c.vp;
    }
    let health = 'ok';
    try { health = evalJs(HEALTH_JS); } catch (e) { health = 'nogame'; }
    if (health !== 'ok') {
      rec.reloaded = true;
      ab(['reload']);
      wait(2800);
      ab(['set', 'viewport', String(c.vp.w), String(c.vp.h), String(c.vp.s)]);
      wait(500);
    }
    resetErrors();
    rec.drive = evalJs(driveJs(c));
    wait(850);
    rec.phaseStep = evalJs(phaseJs(c));
    wait(c.screen === 'game' && c.phase === 'recall' ? 850 : 500);
    rec.m = evalJs(MEASURE_JS);
    // 连续两次量到同样的 bounds / hit（或只差装饰级漂移）才算 settle，最多重试 4 轮
    for (let attempt = 1; ; attempt++) {
      const m2 = evalJs(MEASURE_JS);
      const d = diffScenes(rec.m, m2);
      const hard = d.geom.filter((g) => g.d > DECOR_MAX);
      if (hard.length === 0) {
        rec.unstable = false;
        rec.decor = d.geom.length;
        rec.drift = d.geom.reduce((m, g) => Math.max(m, g.d === Infinity ? 0 : g.d), 0);
        rec.alphaMotion = d.alpha.length;
        break;
      }
      if (attempt >= 4) {
        rec.unstable = true;
        rec.drift = 0;
        rec.motion = hard.slice(0, 10).map((g) => `${g.p} [${g.kind}] Δ${g.d}`);
        break;
      }
      rec.m = m2;
      wait(600);
    }
    rec.pageErrors = pageErrors();
    // 空场景列表以前会被判成 PASS（什么都没量到 = 没有违约），这是假绿，必须硬失败
    if (!rec.m.scenes.length) throw new Error('没有活跃场景：create 可能抛异常，画面根本没建起来');
    if (rec.pageErrors.length) throw new Error(`页面报错 ${rec.pageErrors.length} 条：${rec.pageErrors[0]}`);
    rec.ms = Date.now() - t0;
    rec.ok = true;
  } catch (e) {
    rec.ok = false;
    rec.error = String(e.message || e).slice(0, 500);
    rec.ms = Date.now() - t0;
  }
  results.push(rec);
  const flag = rec.ok ? (rec.unstable ? '△' : '·') : '✗';
  console.log(`[${String(i + 1).padStart(3)}/${cases.length}] ${flag} ${c.id.padEnd(38)} ${rec.ms}ms${rec.ok ? '' : '  ' + rec.error}`);
  if (rec.unstable) (rec.motion || []).forEach((s) => console.log(`        动: ${s}`));
  writeFileSync(`${OUT}/raw.json`, JSON.stringify({ url: URL, generatedAt: new Date().toISOString(), results }, null, 1));
}

// 截图另跑一趟：只对失败或指定用例，避免拖慢采集
if (SHOTS !== 'none') {
  console.log('\n截图（' + SHOTS + '）…');
  for (const rec of results) {
    if (!rec.ok) continue;
    if (SHOTS === 'fail') {
      // 采集阶段还不知道判定结果，fail 模式统一留给 report.mjs 之后的 shoot.mjs
      continue;
    }
    ab(['set', 'viewport', String(rec.vp.w), String(rec.vp.h), String(rec.vp.s)]);
    wait(350);
    evalJs(driveJs(rec));
    wait(850);
    evalJs(phaseJs(rec));
    wait(700);
    ab(['screenshot', `${OUT}/shots/${rec.id}.png`]);
    console.log('  ' + rec.id);
  }
}

const okN = results.filter((r) => r.ok).length;
console.log(`\n采集完成：${okN}/${results.length} 成功，原始数据 ${OUT}/raw.json`);
const unstable = results.filter((r) => r.unstable).map((r) => r.id);
if (unstable.length) console.log('几何不稳定（tween 未 settle，数字存疑）：' + unstable.join(', '));
