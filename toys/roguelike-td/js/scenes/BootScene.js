// BootScene: 程序化生成卡通手绘风格贴图（高清 2x）
class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }

  create() {
    this.genGrassTile();
    this.genBuildableTile();
    this.genDecoTiles();
    this.genTowers();
    this.genEnemies();
    this.genProjectiles();
    this.genUI();
    this.scene.start('Game');
  }

  // 统一贴图生成：按 RS 倍生成高清纹理（绘制用设计坐标，生成前放大 RS 倍）
  // 配合精灵 setScale(CFG.IS) 显示回设计尺寸，实现 Retina 级清晰度
  _gen(g, key, w, h) {
    g.scaleX = CFG.RS;
    g.scaleY = CFG.RS;
    g.generateTexture(key, w * CFG.RS, h * CFG.RS);
    g.destroy();
  }

  genGrassTile() {
    const T = CFG.TILE;
    const g = this.make.graphics({ add: false });
    g.fillStyle(PALETTE.grass1, 1);
    g.fillRect(0, 0, T, T);
    for (let i = 0; i < 14; i++) {
      const x = Math.random() * T, y = Math.random() * T;
      g.fillStyle(Math.random() < 0.5 ? PALETTE.grass2 : 0xa3d97a, 0.7);
      g.fillCircle(x, y, 1 + Math.random() * 2);
    }
    for (let i = 0; i < 5; i++) {
      const x = Math.random() * T, y = Math.random() * T;
      g.lineStyle(1.5, 0x4a7a2a, 0.8);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (Math.random() - 0.5) * 3, y - 4 - Math.random() * 3);
      g.strokePath();
    }
    this._gen(g, 'tile_grass', T, T);
  }

  genBuildableTile() {
    const T = CFG.TILE;
    const g = this.make.graphics({ add: false });
    g.fillStyle(PALETTE.grass1, 1);
    g.fillRect(0, 0, T, T);
    for (let i = 0; i < 10; i++) {
      const x = Math.random() * T, y = Math.random() * T;
      g.fillStyle(PALETTE.grass2, 0.6);
      g.fillCircle(x, y, 1 + Math.random() * 2);
    }
    // 虚线方框提示可建造
    g.lineStyle(2, PALETTE.buildable, 0.55);
    const pad = 6;
    const dashLen = 6, gapLen = 4;
    for (let x = pad; x < T - pad; x += dashLen + gapLen) {
      g.lineBetween(x, pad, Math.min(x + dashLen, T - pad), pad);
    }
    for (let x = pad; x < T - pad; x += dashLen + gapLen) {
      g.lineBetween(x, T - pad, Math.min(x + dashLen, T - pad), T - pad);
    }
    for (let y = pad; y < T - pad; y += dashLen + gapLen) {
      g.lineBetween(pad, y, pad, Math.min(y + dashLen, T - pad));
    }
    for (let y = pad; y < T - pad; y += dashLen + gapLen) {
      g.lineBetween(T - pad, y, T - pad, Math.min(y + dashLen, T - pad));
    }
    this._gen(g, 'tile_buildable', T, T);

    // hover 版本
    const g2 = this.make.graphics({ add: false });
    g2.fillStyle(PALETTE.grass1, 1);
    g2.fillRect(0, 0, T, T);
    g2.fillStyle(PALETTE.buildableHover, 0.35);
    g2.fillRect(0, 0, T, T);
    g2.lineStyle(3, PALETTE.gold, 0.9);
    g2.strokeRoundedRect(3, 3, T - 6, T - 6, 6);
    this._gen(g2, 'tile_buildable_hover', T, T);
  }

  genDecoTiles() {
    const T = CFG.TILE;
    // 树
    const g = this.make.graphics({ add: false });
    g.fillStyle(PALETTE.grass1, 1); g.fillRect(0, 0, T, T);
    for (let i = 0; i < 8; i++) {
      g.fillStyle(PALETTE.grass2, 0.6);
      g.fillCircle(Math.random() * T, Math.random() * T, 1 + Math.random() * 2);
    }
    g.fillStyle(0x6b4a2a, 1);
    g.fillRect(T/2 - 3, T/2 + 4, 6, 12);
    g.lineStyle(1.5, PALETTE.ink, 0.8);
    g.strokeRect(T/2 - 3, T/2 + 4, 6, 12);
    g.fillStyle(0x4a8a3a, 1);
    g.fillCircle(T/2, T/2 - 2, 13);
    g.fillCircle(T/2 - 8, T/2 + 2, 9);
    g.fillCircle(T/2 + 8, T/2 + 2, 9);
    g.lineStyle(2, PALETTE.ink, 0.85);
    g.strokeCircle(T/2, T/2 - 2, 13);
    g.strokeCircle(T/2 - 8, T/2 + 2, 9);
    g.strokeCircle(T/2 + 8, T/2 + 2, 9);
    g.fillStyle(0x8dc96a, 0.7);
    g.fillCircle(T/2 - 4, T/2 - 6, 4);
    this._gen(g, 'deco_tree', T, T);

    // 石头
    const g2 = this.make.graphics({ add: false });
    g2.fillStyle(PALETTE.grass1, 1); g2.fillRect(0, 0, T, T);
    for (let i = 0; i < 8; i++) {
      g2.fillStyle(PALETTE.grass2, 0.6);
      g2.fillCircle(Math.random() * T, Math.random() * T, 1 + Math.random() * 2);
    }
    g2.fillStyle(0x9a9088, 1);
    g2.beginPath();
    g2.moveTo(T/2 - 12, T/2 + 8);
    g2.lineTo(T/2 - 8, T/2 - 6);
    g2.lineTo(T/2 + 4, T/2 - 10);
    g2.lineTo(T/2 + 12, T/2 + 2);
    g2.lineTo(T/2 + 8, T/2 + 10);
    g2.closePath();
    g2.fillPath();
    g2.lineStyle(2, PALETTE.ink, 0.85);
    g2.strokePath();
    g2.fillStyle(0xc9beb0, 0.7);
    g2.fillCircle(T/2 - 3, T/2 - 3, 3);
    this._gen(g2, 'deco_rock', T, T);

    // 花
    const g3 = this.make.graphics({ add: false });
    g3.fillStyle(PALETTE.grass1, 1); g3.fillRect(0, 0, T, T);
    for (let i = 0; i < 8; i++) {
      g3.fillStyle(PALETTE.grass2, 0.6);
      g3.fillCircle(Math.random() * T, Math.random() * T, 1 + Math.random() * 2);
    }
    const colors = [0xff8ab5, 0xffd94a, 0xc9a0ff, 0xff9a6b];
    for (let i = 0; i < 3; i++) {
      const x = 10 + Math.random() * (T - 20);
      const y = 10 + Math.random() * (T - 20);
      const c = colors[Math.floor(Math.random() * colors.length)];
      g3.fillStyle(c, 1);
      for (let a = 0; a < 5; a++) {
        const ang = (a / 5) * Math.PI * 2;
        g3.fillCircle(x + Math.cos(ang) * 3, y + Math.sin(ang) * 3, 2.5);
      }
      g3.fillStyle(0xfff2b0, 1);
      g3.fillCircle(x, y, 2);
    }
    this._gen(g3, 'deco_flower', T, T);
  }

  genTowers() {
    for (const key of TOWER_KEYS) {
      const t = TOWER_TYPES[key];
      for (let star = 1; star <= 4; star++) {
        this._genTowerSprite(key, t, star);
      }
    }
  }

  _genTowerSprite(key, t, star) {
    const S = 66;
    const g = this.make.graphics({ add: false });
    // 底座
    g.fillStyle(0x6b4a2a, 1);
    g.fillRoundedRect(S/2 - 21, S - 18, 42, 12, 4);
    g.lineStyle(3, PALETTE.ink, 0.9);
    g.strokeRoundedRect(S/2 - 21, S - 18, 42, 12, 4);

    // 塔身（随星级变高变华丽）
    const bodyH = 24 + star * 4;
    const bodyW = 27 + star;
    g.fillStyle(t.color, 1);
    g.fillRoundedRect(S/2 - bodyW/2, S - 18 - bodyH, bodyW, bodyH, 6);
    g.lineStyle(3, PALETTE.ink, 0.9);
    g.strokeRoundedRect(S/2 - bodyW/2, S - 18 - bodyH, bodyW, bodyH, 6);

    // 高光
    g.fillStyle(0xffffff, 0.25);
    g.fillRoundedRect(S/2 - bodyW/2 + 4, S - 18 - bodyH + 4, 6, bodyH - 8, 3);

    // 顶部装饰随类型不同
    const topY = S - 18 - bodyH;
    if (key === 'arrow') {
      g.fillStyle(t.accent, 1);
      g.fillTriangle(S/2 - bodyW/2 - 3, topY, S/2 + bodyW/2 + 3, topY, S/2, topY - 15 - star);
      g.lineStyle(3, PALETTE.ink, 0.9);
      g.strokeTriangle(S/2 - bodyW/2 - 3, topY, S/2 + bodyW/2 + 3, topY, S/2, topY - 15 - star);
    } else if (key === 'cannon') {
      g.fillStyle(t.accent, 1);
      g.fillCircle(S/2, topY - 3, 12 + star);
      g.lineStyle(3, PALETTE.ink, 0.9);
      g.strokeCircle(S/2, topY - 3, 12 + star);
      g.fillStyle(0x2b1e14, 1);
      g.fillCircle(S/2, topY - 3, 6);
    } else if (key === 'frost') {
      g.fillStyle(0xffffff, 0.9);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        g.fillTriangle(S/2, topY - 6,
          S/2 + Math.cos(a) * (9 + star), topY - 6 + Math.sin(a) * (9 + star),
          S/2 + Math.cos(a + 0.3) * (4 + star), topY - 6 + Math.sin(a + 0.3) * (4 + star));
      }
      g.fillStyle(t.accent, 1);
      g.fillCircle(S/2, topY - 6, 4 + star * 0.5);
    } else if (key === 'zap') {
      g.fillStyle(0xfff2b0, 1);
      g.fillCircle(S/2, topY - 6, 10 + star);
      g.lineStyle(3, PALETTE.ink, 0.9);
      g.strokeCircle(S/2, topY - 6, 10 + star);
      g.fillStyle(t.accent, 1);
      g.beginPath();
      g.moveTo(S/2 - 4, topY - 12);
      g.lineTo(S/2 + 3, topY - 6);
      g.lineTo(S/2 - 1, topY - 4);
      g.lineTo(S/2 + 4, topY);
      g.lineTo(S/2 - 3, topY - 1);
      g.closePath();
      g.fillPath();
    } else if (key === 'venom') {
      g.fillStyle(t.accent, 1);
      g.fillCircle(S/2, topY - 4, 10 + star);
      g.lineStyle(3, PALETTE.ink, 0.9);
      g.strokeCircle(S/2, topY - 4, 10 + star);
      g.fillStyle(0xc9ff8a, 0.9);
      g.fillCircle(S/2 - 3, topY - 7, 4);
      g.fillStyle(0xc9ff8a, 0.7);
      g.fillCircle(S/2 + 6, topY - 12 - star, 3);
    } else if (key === 'buff') {
      g.fillStyle(0x6b4a2a, 1);
      g.fillRect(S/2 - 1, topY - 21 - star * 3, 3, 21 + star * 3);
      g.fillStyle(t.color, 1);
      g.fillTriangle(S/2 + 2, topY - 21 - star * 3, S/2 + 21 + star, topY - 15 - star * 3, S/2 + 2, topY - 9 - star * 3);
      g.lineStyle(2, PALETTE.ink, 0.9);
      g.strokeTriangle(S/2 + 2, topY - 21 - star * 3, S/2 + 21 + star, topY - 15 - star * 3, S/2 + 2, topY - 9 - star * 3);
    }

    // 星级标记（底部小星星）
    for (let i = 0; i < star; i++) {
      const sx = S/2 - (star - 1) * 7 + i * 14;
      const sy = S - 6;
      g.fillStyle(PALETTE.gold, 1);
      g.fillCircle(sx, sy, 3.5);
      g.lineStyle(1.5, PALETTE.ink, 0.8);
      g.strokeCircle(sx, sy, 3.5);
    }

    this._gen(g, `tower_${key}_${star}`, S, S);
  }

  genEnemies() {
    for (const key of Object.keys(ENEMY_TYPES)) {
      const e = ENEMY_TYPES[key];
      const S = e.size * 2 + 12;
      const g = this.make.graphics({ add: false });
      const cx = S / 2, cy = S / 2;

      if (e.shape === 'blob') {
        g.fillStyle(e.color, 1);
        g.fillCircle(cx, cy + 2, e.size);
        g.lineStyle(2.5, PALETTE.ink, 0.9);
        g.strokeCircle(cx, cy + 2, e.size);
        g.fillStyle(0xffffff, 0.5);
        g.fillCircle(cx - e.size * 0.35, cy - e.size * 0.3, e.size * 0.25);
        g.fillStyle(0xffffff, 1);
        g.fillCircle(cx - 4, cy, 3);
        g.fillCircle(cx + 4, cy, 3);
        g.fillStyle(PALETTE.ink, 1);
        g.fillCircle(cx - 4, cy + 1, 1.5);
        g.fillCircle(cx + 4, cy + 1, 1.5);
      } else if (e.shape === 'wing') {
        g.fillStyle(e.color, 1);
        g.fillEllipse(cx, cy, e.size * 0.9, e.size * 1.2);
        g.lineStyle(2, PALETTE.ink, 0.9);
        g.strokeEllipse(cx, cy, e.size * 0.9, e.size * 1.2);
        g.fillStyle(e.accent, 1);
        g.fillTriangle(cx - 3, cy - 2, cx - e.size - 4, cy - 6, cx - e.size - 2, cy + 4);
        g.fillTriangle(cx + 3, cy - 2, cx + e.size + 4, cy - 6, cx + e.size + 2, cy + 4);
        g.lineStyle(1.5, PALETTE.ink, 0.9);
        g.strokeTriangle(cx - 3, cy - 2, cx - e.size - 4, cy - 6, cx - e.size - 2, cy + 4);
        g.strokeTriangle(cx + 3, cy - 2, cx + e.size + 4, cy - 6, cx + e.size + 2, cy + 4);
        g.fillStyle(0xffe04a, 1);
        g.fillCircle(cx - 3, cy - 2, 2);
        g.fillCircle(cx + 3, cy - 2, 2);
        g.fillStyle(PALETTE.ink, 1);
        g.fillCircle(cx - 3, cy - 2, 1);
        g.fillCircle(cx + 3, cy - 2, 1);
      } else if (e.shape === 'block') {
        g.fillStyle(e.color, 1);
        g.fillRoundedRect(cx - e.size, cy - e.size, e.size * 2, e.size * 2, 4);
        g.lineStyle(2.5, PALETTE.ink, 0.9);
        g.strokeRoundedRect(cx - e.size, cy - e.size, e.size * 2, e.size * 2, 4);
        g.lineStyle(1.5, e.accent, 0.9);
        g.lineBetween(cx - e.size + 3, cy - 4, cx - 2, cy + 2);
        g.lineBetween(cx - 2, cy + 2, cx + 6, cy - 3);
        g.fillStyle(0xff9a4a, 1);
        g.fillCircle(cx - 6, cy - 4, 3);
        g.fillCircle(cx + 6, cy - 4, 3);
        g.fillStyle(PALETTE.ink, 1);
        g.fillCircle(cx - 6, cy - 4, 1.5);
        g.fillCircle(cx + 6, cy - 4, 1.5);
      } else if (e.shape === 'horn') {
        g.fillStyle(e.color, 1);
        g.fillCircle(cx, cy + 2, e.size);
        g.lineStyle(2.5, PALETTE.ink, 0.9);
        g.strokeCircle(cx, cy + 2, e.size);
        g.fillStyle(0xfff2b0, 1);
        g.fillTriangle(cx - e.size * 0.7, cy - e.size * 0.4, cx - e.size * 0.4, cy - e.size * 1.3, cx - e.size * 0.2, cy - e.size * 0.5);
        g.fillTriangle(cx + e.size * 0.7, cy - e.size * 0.4, cx + e.size * 0.4, cy - e.size * 1.3, cx + e.size * 0.2, cy - e.size * 0.5);
        g.lineStyle(1.5, PALETTE.ink, 0.9);
        g.strokeTriangle(cx - e.size * 0.7, cy - e.size * 0.4, cx - e.size * 0.4, cy - e.size * 1.3, cx - e.size * 0.2, cy - e.size * 0.5);
        g.strokeTriangle(cx + e.size * 0.7, cy - e.size * 0.4, cx + e.size * 0.4, cy - e.size * 1.3, cx + e.size * 0.2, cy - e.size * 0.5);
        g.fillStyle(0xfff24a, 1);
        g.fillCircle(cx - 4, cy, 3);
        g.fillCircle(cx + 4, cy, 3);
        g.fillStyle(PALETTE.ink, 1);
        g.fillCircle(cx - 4, cy + 1, 1.5);
        g.fillCircle(cx + 4, cy + 1, 1.5);
        g.lineStyle(1.5, PALETTE.ink, 0.9);
        g.lineBetween(cx - 4, cy + 7, cx + 4, cy + 7);
      } else if (e.shape === 'boss') {
        g.fillStyle(e.color, 1);
        g.beginPath();
        const pts = 8;
        for (let i = 0; i < pts; i++) {
          const a = (i / pts) * Math.PI * 2;
          const r = e.size * (i % 2 === 0 ? 1 : 0.85);
          const x = cx + Math.cos(a) * r;
          const y = cy + Math.sin(a) * r;
          if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.closePath();
        g.fillPath();
        g.lineStyle(3, PALETTE.ink, 0.95);
        g.strokePath();
        g.fillStyle(PALETTE.gold, 1);
        g.fillTriangle(cx - 12, cy - e.size + 2, cx - 6, cy - e.size - 10, cx, cy - e.size + 2);
        g.fillTriangle(cx - 2, cy - e.size + 2, cx + 4, cy - e.size - 12, cx + 10, cy - e.size + 2);
        g.fillTriangle(cx + 8, cy - e.size + 2, cx + 14, cy - e.size - 8, cx + 18, cy - e.size + 2);
        g.lineStyle(2, PALETTE.ink, 0.9);
        g.strokeTriangle(cx - 12, cy - e.size + 2, cx - 6, cy - e.size - 10, cx, cy - e.size + 2);
        g.strokeTriangle(cx - 2, cy - e.size + 2, cx + 4, cy - e.size - 12, cx + 10, cy - e.size + 2);
        g.strokeTriangle(cx + 8, cy - e.size + 2, cx + 14, cy - e.size - 8, cx + 18, cy - e.size + 2);
        g.fillStyle(0xff2a2a, 1);
        g.fillCircle(cx - 8, cy - 2, 5);
        g.fillCircle(cx + 8, cy - 2, 5);
        g.fillStyle(0xfff24a, 1);
        g.fillCircle(cx - 8, cy - 2, 2);
        g.fillCircle(cx + 8, cy - 2, 2);
        g.fillStyle(PALETTE.ink, 1);
        g.fillRect(cx - 10, cy + 8, 20, 4);
        g.fillStyle(0xffffff, 1);
        for (let i = 0; i < 4; i++) {
          g.fillTriangle(cx - 9 + i * 5, cy + 8, cx - 6 + i * 5, cy + 12, cx - 4 + i * 5, cy + 8);
        }
      }

      this._gen(g, `enemy_${key}`, S, S);
    }
  }

  genProjectiles() {
    const g = this.make.graphics({ add: false });
    g.fillStyle(0xffffff, 1);
    g.fillCircle(6, 6, 5);
    g.lineStyle(1.5, PALETTE.ink, 0.7);
    g.strokeCircle(6, 6, 5);
    this._gen(g, 'proj', 12, 12);

    // 粒子（命中火花/死亡爆裂/合成金光）
    const g2 = this.make.graphics({ add: false });
    g2.fillStyle(0xffffff, 1);
    g2.fillCircle(4, 4, 4);
    this._gen(g2, 'spark', 8, 8);
  }

  genUI() {
    // 心形图标（基地生命）
    const g = this.make.graphics({ add: false });
    g.fillStyle(PALETTE.hp, 1);
    g.fillCircle(7, 7, 5);
    g.fillCircle(15, 7, 5);
    g.fillTriangle(3, 9, 19, 9, 11, 20);
    g.lineStyle(1.5, PALETTE.ink, 0.8);
    g.strokeCircle(7, 7, 5);
    g.strokeCircle(15, 7, 5);
    this._gen(g, 'icon_heart', 22, 22);

    // 金币
    const g2 = this.make.graphics({ add: false });
    g2.fillStyle(PALETTE.gold, 1);
    g2.fillCircle(10, 10, 8);
    g2.lineStyle(2, PALETTE.ink, 0.85);
    g2.strokeCircle(10, 10, 8);
    g2.fillStyle(0xffe89a, 1);
    g2.fillCircle(8, 8, 3);
    this._gen(g2, 'icon_gold', 20, 20);
  }
}
