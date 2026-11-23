// 塔/敌人/天赋/波次数据定义

const TOWER_TYPES = {
  arrow: {
    name: '箭塔',
    color: 0x6bbf59,
    accent: 0x2d5a2d,
    dmg: 12,
    range: 130,
    fireRate: 0.55, // 秒/发
    projSpeed: 480,
    projColor: 0xfff2b0,
    desc: '单体快速，克飞行',
  },
  cannon: {
    name: '炮塔',
    color: 0xd97b3f,
    accent: 0x6b3410,
    dmg: 26,
    range: 110,
    fireRate: 1.4,
    projSpeed: 300,
    projColor: 0x3a2b1a,
    splash: 55,
    desc: '范围伤害，克密集',
  },
  frost: {
    name: '冰塔',
    color: 0x6ec8e8,
    accent: 0x1f5a7a,
    dmg: 6,
    range: 120,
    fireRate: 0.9,
    projSpeed: 380,
    projColor: 0xc9f0ff,
    slow: 0.45, slowDur: 1.6,
    desc: '减速控制',
  },
  zap: {
    name: '电塔',
    color: 0xf2d544,
    accent: 0x7a5a10,
    dmg: 14,
    range: 115,
    fireRate: 0.8,
    chain: 3,
    chainRange: 90,
    desc: '链式弹射',
  },
  venom: {
    name: '毒塔',
    color: 0xa86bd9,
    accent: 0x4a1f7a,
    dmg: 8,
    range: 125,
    fireRate: 1.1,
    projSpeed: 340,
    projColor: 0xc9a0ff,
    dot: { dmg: 6, dur: 3.0, tick: 0.5 },
    desc: 'DOT，克高血',
  },
  buff: {
    name: '战旗',
    color: 0xe85d75,
    accent: 0x7a1f2d,
    dmg: 0,
    range: 100,
    fireRate: 0,
    aura: { dmgMul: 1.25, rateMul: 0.85 },
    desc: '增益周围塔',
  },
};

const TOWER_KEYS = Object.keys(TOWER_TYPES);

// 星级倍率
const STAR_MUL = {
  1: { dmg: 1.0, range: 1.0, rate: 1.0 },
  2: { dmg: 1.7, range: 1.1, rate: 0.9 },
  3: { dmg: 2.9, range: 1.2, rate: 0.8 },
  4: { dmg: 5.0, range: 1.3, rate: 0.7 },
};

// 敌人类型（size 为纯视觉尺寸，已按 1.5 倍放大以匹配 72px tile）
const ENEMY_TYPES = {
  slime: {
    name: '史莱姆', color: 0x7ad97a, accent: 0x2d6b2d,
    hp: 30, speed: 55, gold: 6, size: 24, shape: 'blob',
  },
  bat: {
    name: '蝙蝠', color: 0x9a6bd9, accent: 0x3a1f6b,
    hp: 22, speed: 90, gold: 8, size: 21, shape: 'wing',
    flying: true,
  },
  golem: {
    name: '石魔', color: 0xa89078, accent: 0x4a3a2a,
    hp: 110, speed: 38, gold: 18, size: 32, shape: 'block',
    armor: 0.25,
  },
  imp: {
    name: '小恶魔', color: 0xe85d5d, accent: 0x6b1f1f,
    hp: 45, speed: 78, gold: 10, size: 22, shape: 'horn',
  },
  boss: {
    name: 'BOSS', color: 0xff9a3f, accent: 0x7a3a10,
    hp: 900, speed: 32, gold: 120, size: 44, shape: 'boss',
    armor: 0.35,
  },
};

// 波次词缀（非 Boss 波概率出现，改变本波敌人属性）
const WAVE_AFFIXES = [
  { id: 'swift',  name: '疾行', desc: '敌人速度 +35%',        speedMul: 1.35 },
  { id: 'armor',  name: '坚甲', desc: '敌人护甲 +20%',        armorAdd: 0.2 },
  { id: 'swarm',  name: '蜂群', desc: '数量 x1.8，生命 -40%', countMul: 1.8, hpMul: 0.6 },
  { id: 'regen',  name: '再生', desc: '敌人每秒回复 3% 生命', regen: 0.03 },
  { id: 'bounty', name: '赏金', desc: '金币掉落 x2',          goldMul: 2 },
];

// 稀有度（weight 为三选一抽取权重）
const RARITY = {
  common: { name: '普通', color: 0x8fd98f, weight: 60 },
  rare:   { name: '稀有', color: 0x6ec8e8, weight: 30 },
  epic:   { name: '史诗', color: 0xc9a0ff, weight: 10 },
};

// 天赋池（stack: true 表示可重复获取叠加）
const TALENTS = [
  { id: 'dmg_all',     name: '锋利箭头', icon: '⚔', rarity: 'common', stack: true,  desc: '所有塔伤害 +20%',            apply: s => s.mods.dmgMul *= 1.2 },
  { id: 'rate_all',    name: '急速装填', icon: '⚡', rarity: 'common', stack: true,  desc: '所有塔攻速 +15%',            apply: s => s.mods.rateMul *= 0.85 },
  { id: 'range_all',   name: '鹰眼',     icon: '◎', rarity: 'common', stack: true,  desc: '所有塔射程 +15%',            apply: s => s.mods.rangeMul *= 1.15 },
  { id: 'gold_boost',  name: '点金手',   icon: '◈', rarity: 'common', stack: true,  desc: '金币掉落 +40%',              apply: s => s.mods.goldMul *= 1.4 },
  { id: 'hp_regen',    name: '城墙加固', icon: '♥', rarity: 'common', stack: true,  desc: '基地生命 +5 且每波回 1',     apply: s => { s.baseHp += 5; s.hp = Math.min(s.baseHp, s.hp + 5); s.mods.regen += 1; } },
  { id: 'treasure',    name: '开局宝库', icon: '★', rarity: 'common', stack: true,  desc: '立即获得 150 金币',          apply: s => { s.gold += 150; } },
  { id: 'repair',      name: '应急修补', icon: '✚', rarity: 'common', stack: true,  desc: '立即回复 8 点基地生命',      apply: s => { s.hp = Math.min(s.baseHp, s.hp + 8); } },
  { id: 'frost_boost', name: '极寒',     icon: '❄', rarity: 'rare',   stack: true,  desc: '冰塔减速效果 +15%',          apply: s => s.mods.frostSlow += 0.15 },
  { id: 'frost_dur',   name: '深寒',     icon: '◇', rarity: 'rare',   stack: true,  desc: '冰塔减速持续 +0.8 秒',       apply: s => s.mods.frostDur += 0.8 },
  { id: 'drop_extra',  name: '幸运',     icon: '☘', rarity: 'rare',   stack: true,  desc: '每波额外掉 1 个塔',          apply: s => s.mods.extraDrop += 1 },
  { id: 'splash_all',  name: '爆炸专家', icon: '☀', rarity: 'rare',   stack: false, desc: '所有塔获得小范围溅射',       apply: s => { s.mods.splashAll = 30; } },
  { id: 'crit',        name: '会心一击', icon: '✦', rarity: 'rare',   stack: true,  desc: '20% 概率暴击 x2（可叠加）',  apply: s => { s.mods.crit = Math.min(0.6, s.mods.crit + 0.2); } },
  { id: 'chain_plus',  name: '连锁闪电', icon: '⚡', rarity: 'rare',   stack: true,  desc: '电塔弹射次数 +2',            apply: s => s.mods.chainBonus += 2 },
  { id: 'venom_boost', name: '剧毒',     icon: '♣', rarity: 'rare',   stack: true,  desc: '毒塔持续伤害 +50%',          apply: s => s.mods.dotMul *= 1.5 },
  { id: 'cannon_boost',name: '重炮',     icon: '●', rarity: 'rare',   stack: true,  desc: '炮塔溅射范围 +40%',          apply: s => s.mods.cannonSplashMul *= 1.4 },
  { id: 'aura_expand', name: '军旗扩张', icon: '⚑', rarity: 'rare',   stack: true,  desc: '战旗增益范围 +30%',          apply: s => s.mods.auraRangeMul *= 1.3 },
  { id: 'discount',    name: '折扣商店', icon: '◆', rarity: 'rare',   stack: true,  desc: '塔升级费用 -20%',            apply: s => s.mods.upCostMul *= 0.8 },
  { id: 'elite_hunter',name: '精英猎手', icon: '◎', rarity: 'rare',   stack: true,  desc: '对精英与 BOSS 伤害 +30%',    apply: s => s.mods.eliteDmgMul *= 1.3 },
  { id: 'greed',       name: '贪婪',     icon: '♦', rarity: 'rare',   stack: true,  desc: '金币 +60%，但升级费用 +25%', apply: s => { s.mods.goldMul *= 1.6; s.mods.upCostMul *= 1.25; } },
  { id: 'merge_up',    name: '炼金术',   icon: '✧', rarity: 'epic',   stack: false, desc: '合成 25% 概率跳升 2 星',     apply: s => { s.mods.mergeJump = 0.25; } },
  { id: 'arrow_double',name: '箭雨',     icon: '➤', rarity: 'epic',   stack: true,  desc: '箭塔 25% 概率追加一箭',      apply: s => { s.mods.arrowDouble = Math.min(0.75, s.mods.arrowDouble + 0.25); } },
  { id: 'kill_heal',   name: '嗜血',     icon: '♥', rarity: 'epic',   stack: true,  desc: '每击杀 8 个敌人回复 1 生命', apply: s => s.mods.killHeal += 1 },
  { id: 'loot_luck',   name: '幸运星',   icon: '☆', rarity: 'epic',   stack: true,  desc: '战利品高星概率大幅提升',     apply: s => s.mods.lootLuck += 0.1 },
  { id: 'glass_cannon',name: '玻璃大炮', icon: '☠', rarity: 'epic',   stack: true,  desc: '伤害 +35%，但基地生命上限 -5', apply: s => { s.mods.dmgMul *= 1.35; s.baseHp = Math.max(5, s.baseHp - 5); s.hp = Math.min(s.hp, s.baseHp); } },
];

// 波次生成：返回 { list, affix, eliteCount, boss }
function makeWave(n) {
  const list = [];
  const base = 4 + Math.floor(n * 1.6);
  let hpMul = 1 + (n - 1) * 0.28;
  let speedMul = 1 + (n - 1) * 0.03;
  const boss = n % 5 === 0;

  let affix = null;
  if (!boss && n >= 3 && Math.random() < 0.45) {
    affix = WAVE_AFFIXES[Math.floor(Math.random() * WAVE_AFFIXES.length)];
    hpMul *= affix.hpMul || 1;
    speedMul *= affix.speedMul || 1;
  }
  const countMul = affix && affix.countMul ? affix.countMul : 1;

  if (boss) {
    list.push({ type: 'boss', count: 1 + Math.floor(n / 10), gap: 1.6, hpMul: hpMul * 0.9, speedMul });
    list.push({ type: 'imp', count: Math.floor(base * 0.6), gap: 0.5, hpMul, speedMul, delay: 2 });
  } else {
    const pool = ['slime'];
    if (n >= 2) pool.push('bat');
    if (n >= 3) pool.push('imp');
    if (n >= 4) pool.push('golem');
    const type = pool[Math.floor(Math.random() * pool.length)];
    list.push({ type, count: Math.max(1, Math.round(base * countMul)), gap: 0.55 + Math.random() * 0.3, hpMul, speedMul });
    if (n >= 3 && Math.random() < 0.5) {
      const t2 = pool[Math.floor(Math.random() * pool.length)];
      list.push({ type: t2, count: Math.max(1, Math.round(base * 0.5 * countMul)), gap: 0.4, hpMul, speedMul, delay: base * 0.4 });
    }
  }

  let eliteCount = 0;
  if (!boss && n >= 4 && Math.random() < 0.55) eliteCount = n >= 9 ? 2 : 1;

  return { list, affix, eliteCount, boss };
}

// ===== 像素数值统一缩放 =====
// tile 从 48 放大到 72（1.5 倍），射程/速度/弹速/溅射等"像素类"数值同步放大，
// 保证覆盖格数、过图时间等手感完全不变，只是视觉更大。
(function scalePixelValues() {
  const TS = CFG.TS;
  for (const k of Object.keys(TOWER_TYPES)) {
    const t = TOWER_TYPES[k];
    if (t.range) t.range *= TS;
    if (t.projSpeed) t.projSpeed *= TS;
    if (t.splash) t.splash *= TS;
    if (t.chainRange) t.chainRange *= TS;
  }
  for (const k of Object.keys(ENEMY_TYPES)) {
    const e = ENEMY_TYPES[k];
    if (e.speed) e.speed *= TS;
  }
  // 天赋里的固定像素值（溅射）也缩放
  const splashTalent = TALENTS.find(t => t.id === 'splash_all');
  if (splashTalent) {
    splashTalent.apply = s => { s.mods.splashAll = 30 * TS; };
  }
})();