#!/usr/bin/env node
// 仅当用户明确要求时才运行（AGENTS.md"验证边界"一节的用户指令例外），AI 不得自主启动。
// 按用例 id 重新驱动到那一屏并截图，用来核实 report.md 里的违约项（数字之外的目视复核）
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { driveJs, phaseJs, HEALTH_JS } from './drive.mjs';

const OUT = process.env.SM_OUT || '/tmp/sm-4d';
const raw = JSON.parse(readFileSync(`${OUT}/raw.json`, 'utf8'));
mkdirSync(`${OUT}/shots`, { recursive: true });

const ev = (js) => JSON.parse(execFileSync('agent-browser', ['eval', js, '--json'], { encoding: 'utf8', maxBuffer: 64e6 })).data.result;
const wait = (ms) => execFileSync('agent-browser', ['wait', String(ms)], { encoding: 'utf8' });

const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!ids.length) { console.log('用法: node shoot.mjs <用例id> [...]'); process.exit(1); }

for (const id of ids) {
  const rec = raw.results.find((r) => r.id === id);
  if (!rec) { console.log(`✗ raw.json 里没有 ${id}`); continue; }
  const c = {
    screen: rec.screen, phase: rec.phase, type: rec.type,
    mode: rec.dir === 'backward' ? 'ranked' : 'leisure', dir: rec.dir,
    length: rec.screen === 'over' ? 13 : 0,
  };
  execFileSync('agent-browser', ['set', 'viewport', String(rec.vp.w), String(rec.vp.h), String(rec.vp.s)], { encoding: 'utf8' });
  wait(500);
  let health = 'ok';
  try { health = ev(HEALTH_JS); } catch (e) { health = 'nogame'; }
  if (health !== 'ok') { execFileSync('agent-browser', ['reload'], { encoding: 'utf8' }); wait(2800); }
  ev(driveJs(c));
  wait(900);
  ev(phaseJs(c));
  wait(900);
  const p = `${OUT}/shots/${id}.png`;
  execFileSync('agent-browser', ['screenshot', p], { encoding: 'utf8' });
  console.log(`✓ ${id} → ${p}`);
}
