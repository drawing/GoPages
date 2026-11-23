#!/usr/bin/env node
// 仅当用户明确要求时才运行（AGENTS.md"验证边界"一节的用户指令例外），AI 不得自主启动。
// 离线查看某个用例的违约对象到底是谁：带祖先路径与 bounds，用来判断是真违约还是规则误判
import { readFileSync } from 'node:fs';

const OUT = process.env.SM_OUT || '/tmp/sm-4d';
const raw = JSON.parse(readFileSync(`${OUT}/raw.json`, 'utf8'));
const id = process.argv[2];
const rec = raw.results.find((r) => r.id === id);
if (!rec) { console.log('没有这个用例'); process.exit(1); }

console.log(`${rec.id}  视口 ${rec.vp.w}x${rec.vp.h}  dpr=${rec.m.dpr} rs=${rec.m.rs}`);
for (const sc of rec.m.scenes) {
  const { w, h } = { w: sc.view.w, h: sc.view.h };
  console.log(`\n=== ${sc.key}  view ${w}x${h} gutter=${sc.view.gutter} portrait=${sc.view.isPortrait}`);
  (function walk(list, path, labels) {
    list.forEach((n, i) => {
      const p = `${path}/${i}`;
      const myLabel = n.s ? `"${n.s}"` : null;
      const chain = myLabel ? [...labels, myLabel] : labels;
      const b = n.b ? n.b.map((x) => Math.round(x)).join(',') : 'null';
      const out = n.b ? Math.max(-n.b[0], -n.b[1], n.b[0] + n.b[2] - w, n.b[1] + n.b[3] - h) : -1;
      const tag = [];
      if (n.hit) tag.push(`hit=${n.hit[0]}x${n.hit[1]}${n.hit[2] ? '' : '(关)'}`);
      if (out > 1) tag.push(`出界${Math.round(out)}`);
      if (n.a !== undefined && n.a < 0.99) tag.push(`alpha=${n.a}`);
      if (n.v === false) tag.push('不可见');
      if (tag.length || myLabel) {
        console.log(`  ${p} ${n.t} b=[${b}] ${tag.join(' ')}  祖先=${chain.join('>') || '(顶层)'}`);
      }
      if (n.k) walk(n.k, p, chain);
    });
  })(sc.tree, sc.key, []);
}
