// GameScene: 主游戏场景（地图、塔、敌人、战斗）
class GameScene extends Phaser.Scene {
  constructor() { super('Game'); }

  create() {
    // 高清渲染：相机 zoom=RS，把世界坐标(0~GAME_W)放大填满 RS 倍的 canvas 缓冲
    // 必须 setOrigin(0,0)：否则 zoom 以视口中心为锚点，会导致可视世界偏移、地图跑出屏幕
    this.cameras.main.setOrigin(0, 0);
    this.cameras.main.setZoom(CFG.RS);
    this.cameras.main.setScroll(0, 0);

    // 状态
    this.state = {
      gold: 120,
      hp: 20,
      baseHp: 20,
      baseLevel: 1,
      wave: 0,
      waveActive: false,
      interWave: true,
      gameOver: false,
      paused: false,
      userPaused: false, // 玩家手动暂停（区别于天赋选择的临时暂停）
      mods: {
        dmgMul: 1, rateMul: 1, rangeMul: 1,
        goldMul: 1, extraDrop: 0, mergeJump: 0,
        frostSlow: 0.45, regen: 0, splashAll: 0, crit: 0,
      },
      talents: [],
    };

    // 生成地图
    this.mapData = MapGen.generate(CFG.MAP_COLS, CFG.MAP_ROWS);
    this.pathPx = MapGen.pathToPixels(this.mapData.path, CFG.TILE);

    // 图层容器
    this.mapLayer = this.add.container(0, 0);
    this.decoLayer = this.add.container(0, 0);
    this.towerLayer = this.add.container(0, 0);
    this.enemyLayer = this.add.container(0, 0);
    this.projLayer = this.add.container(0, 0);
    this.fxLayer = this.add.container(0, 0);

    this._drawMap();

    // 塔数据（网格索引 -> tower 对象）
    this.towers = {}; // key "x,y"
    this.towerList = [];
    this.enemies = [];
    this.projectiles = [];

    // 掉落塔池（等待玩家放置）
    this.pendingDrops = [];

    // 开局赠送 3 个随机塔，保证第一波有得放
    for (let i = 0; i < 3; i++) this._rollDrop();

    // 输入
    this.input.on('pointerdown', (p) => this._onPointerDown(p));
    this.input.on('pointermove', (p) => this._onPointerMove(p));

    // 拖拽状态
    this.dragging = null;

    // UI 场景
    this.scene.launch('UI', { game: this });

    // 波次调度
    this.time.delayedCall(1500, () => this.startNextWave());

    // 每帧逻辑
    this.events.on('update', (time, delta) => this._update(time, delta / 1000));
  }

  // ============ 地图绘制 ============
  _drawMap() {
    const T = CFG.TILE;
    const { grid, cols, rows } = this.mapData;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const v = grid[y][x];
        let key = 'tile_grass';
        if (v === 1) key = 'tile_path';
        else if (v === 2) key = 'tile_buildable';
        else if (v === 3) {
          const r = Math.random();
          key = r < 0.5 ? 'deco_tree' : (r < 0.85 ? 'deco_rock' : 'deco_flower');
        }
        const img = this.add.image(x * T + T/2, y * T + T/2, key);
        img.setScale(CFG.IS); // 贴图按 RS 倍生成，缩回设计尺寸
        if (v === 2) {
          img.setData('buildable', true);
          img.setData('gx', x);
          img.setData('gy', y);
          img.setInteractive({ useHandCursor: true });
          // 悬停高亮：鼠标移到可建造格时切换贴图，移开还原
          img.on('pointerover', () => {
            const k = `${x},${y}`;
            if (!this.towers[k]) img.setTexture('tile_buildable_hover');
          });
          img.on('pointerout', () => {
            img.setTexture('tile_buildable');
          });
        }
        this.mapLayer.add(img);
      }
    }

    // 起点/终点标记
    const s = this.mapData.start, e = this.mapData.end;
    const TS = CFG.TS;
    const portal1 = this.add.graphics();
    portal1.fillStyle(0x6b3ad9, 0.9);
    portal1.fillEllipse(s.x * T + T/2, s.y * T + T/2, 34 * TS, 44 * TS);
    portal1.lineStyle(3, PALETTE.ink, 1);
    portal1.strokeEllipse(s.x * T + T/2, s.y * T + T/2, 34 * TS, 44 * TS);
    portal1.fillStyle(0xc9a0ff, 0.7);
    portal1.fillEllipse(s.x * T + T/2, s.y * T + T/2, 18 * TS, 26 * TS);
    this.decoLayer.add(portal1);

    // 基地（终点）—— 放大 + 可点击升级 + 血条
    const bx = e.x * T + T/2, by = e.y * T + T/2;
    this.baseSprite = { x: bx, y: by };
    this.baseGrid = { x: e.x, y: e.y }; // 记录基地网格坐标，供点击判定
    this.baseGfx = this.add.graphics();
    this.decoLayer.add(this.baseGfx);
    this._drawBase();

    // 基地血条（独立对象，随 hp 更新）
    this.baseBarW = 56;
    this.baseHpBg = this.add.rectangle(bx, by - 46, this.baseBarW, 8, PALETTE.hpBg).setDepth(8);
    this.baseHpBg.setStrokeStyle(2, PALETTE.ink, 0.9);
    this.baseHpFg = this.add.rectangle(bx - this.baseBarW/2, by - 46, this.baseBarW, 8, PALETTE.hp).setOrigin(0, 0.5).setDepth(9);
    this.decoLayer.add(this.baseHpBg);
    this.decoLayer.add(this.baseHpFg);

    // 基地可点击区域（覆盖整个基地）
    this.baseZone = this.add.zone(bx, by, 60, 60).setDepth(10);
    this.baseZone.setInteractive({ useHandCursor: true });
    this.baseZone.on('pointerover', () => { this.baseZone.setData('hover', true); this._drawBase(); });
    this.baseZone.on('pointerout', () => { this.baseZone.setData('hover', false); this._drawBase(); });
    this.baseZone.on('pointerdown', () => { this.events.emit('base-selected'); });
    this.decoLayer.add(this.baseZone);
  }

  // 绘制基地（随等级变化外观 + 悬停高亮）
  _drawBase() {
    const g = this.baseGfx;
    if (!g) return;
    g.clear();
    const bx = this.baseSprite.x, by = this.baseSprite.y;
    const lvl = this.state.baseLevel || 1;
    const hover = this.baseZone && this.baseZone.getData('hover');
    const sc = 1 + (lvl - 1) * 0.12; // 等级越高基地越大

    if (hover) {
      g.fillStyle(PALETTE.gold, 0.25);
      g.fillCircle(bx, by, 40 * sc);
    }

    g.fillStyle(0xd9a86b, 1);
    g.fillRoundedRect(bx - 26 * sc, by - 22 * sc, 52 * sc, 44 * sc, 5);
    g.lineStyle(3, PALETTE.ink, 1);
    g.strokeRoundedRect(bx - 26 * sc, by - 22 * sc, 52 * sc, 44 * sc, 5);
    g.fillStyle(0xa83a3a, 1);
    g.fillTriangle(bx - 31 * sc, by - 20 * sc, bx + 31 * sc, by - 20 * sc, bx, by - 44 * sc);
    g.lineStyle(3, PALETTE.ink, 1);
    g.strokeTriangle(bx - 31 * sc, by - 20 * sc, bx + 31 * sc, by - 20 * sc, bx, by - 44 * sc);
    g.fillStyle(0x4a2a1a, 1);
    g.fillRoundedRect(bx - 8 * sc, by - 4 * sc, 16 * sc, 26 * sc, 3);
    g.fillStyle(0xfff2b0, 1);
    g.fillCircle(bx - 15 * sc, by - 9 * sc, 3.5 * sc);
    g.fillCircle(bx + 15 * sc, by - 9 * sc, 3.5 * sc);

    // 等级标记：屋顶上的星星
    for (let i = 0; i < lvl; i++) {
      const sx = bx - (lvl - 1) * 8 + i * 16;
      const sy = by - 50 * sc;
      g.fillStyle(PALETTE.gold, 1);
      g.fillCircle(sx, sy, 4);
      g.lineStyle(1.5, PALETTE.ink, 0.85);
      g.strokeCircle(sx, sy, 4);
    }
  }

  // 更新基地血条
  _updateBaseBar() {
    if (!this.baseHpFg) return;
    const ratio = Math.max(0, this.state.hp / this.state.baseHp);
    this.baseHpFg.width = this.baseBarW * ratio;
    this.baseHpFg.fillColor = ratio > 0.5 ? PALETTE.hp : (ratio > 0.25 ? 0xe89a3f : 0xff3a2a);
  }

  // ============ 波次 ============
  startNextWave() {
    if (this.state.gameOver) return;
    this.state.wave++;
    this.state.waveActive = true;
    this.state.interWave = false;

    if (this.state.mods.regen > 0) {
      this.state.hp = Math.min(this.state.baseHp, this.state.hp + this.state.mods.regen);
    }

    const waveDef = makeWave(this.state.wave);
    this.waveQueue = [];
    for (const group of waveDef) {
      for (let i = 0; i < group.count; i++) {
        this.waveQueue.push({
          type: group.type,
          at: (group.delay || 0) + i * group.gap,
          hpMul: group.hpMul,
          speedMul: group.speedMul,
        });
      }
    }
    this.waveQueue.sort((a, b) => a.at - b.at);
    this.waveStart = this.time.now;

    this.events.emit('wave-start', this.state.wave);
  }

  _spawnFromQueue() {
    const now = this.time.now;
    const elapsed = (now - this.waveStart) / 1000;
    while (this.waveQueue.length && this.waveQueue[0].at <= elapsed) {
      const item = this.waveQueue.shift();
      this._spawnEnemy(item.type, item.hpMul, item.speedMul);
    }
    if (this.waveQueue.length === 0 && this.enemies.length === 0 && this.state.waveActive) {
      this._endWave();
    }
  }

  _endWave() {
    this.state.waveActive = false;
    this.state.interWave = true;
    const dropCount = 2 + this.state.mods.extraDrop + (this.state.wave % 3 === 0 ? 1 : 0);
    for (let i = 0; i < dropCount; i++) {
      this._rollDrop();
    }
    if (this.state.wave % 3 === 0) {
      this.events.emit('offer-talent');
    }
    this.events.emit('wave-end', this.state.wave);
    // 4 秒后自动开下一波（若正卡在天赋选择/暂停则顺延）
    const scheduleNext = () => {
      if (this.state.gameOver) return;
      if (this.state.paused) {
        this.time.delayedCall(500, scheduleNext);
        return;
      }
      this.startNextWave();
    };
    this.time.delayedCall(4000, scheduleNext);
  }

  _rollDrop() {
    const type = TOWER_KEYS[Math.floor(Math.random() * TOWER_KEYS.length)];
    let star = 1;
    const r = Math.random();
    if (r > 0.92) star = 3;
    else if (r > 0.65) star = 2;
    this.pendingDrops.push({ type, star, id: Math.random().toString(36).slice(2) });
    this.events.emit('drops-updated', this.pendingDrops);
  }

  _spawnEnemy(type, hpMul, speedMul) {
    const def = ENEMY_TYPES[type];
    const start = this.pathPx[0];
    const spr = this.add.image(start.x, start.y, `enemy_${type}`);
    spr.setDepth(5);
    this.enemyLayer.add(spr);

    const hp = Math.round(def.hp * hpMul);
    const barW = def.size * 2;
    const hpBg = this.add.rectangle(start.x, start.y - def.size - 9, barW, 5, PALETTE.hpBg).setDepth(6);
    hpBg.setStrokeStyle(1, PALETTE.ink, 0.8);
    const hpFg = this.add.rectangle(start.x - barW/2, start.y - def.size - 9, barW, 5, PALETTE.hp).setOrigin(0, 0.5).setDepth(7);
    this.enemyLayer.add(hpBg);
    this.enemyLayer.add(hpFg);

    const enemy = {
      type, def, spr, hpBg, hpFg, barW,
      hp, maxHp: hp,
      speed: def.speed * speedMul,
      baseSpeed: def.speed * speedMul,
      pathIdx: 0,
      x: start.x, y: start.y,
      slowUntil: 0, slowFactor: 1,
      dot: null,
      gold: Math.round(def.gold * this.state.mods.goldMul),
      dead: false,
      flying: !!def.flying,
      armor: def.armor || 0,
    };

    spr.setScale(0.3 * CFG.IS);
    this.tweens.add({ targets: spr, scaleX: CFG.IS, scaleY: CFG.IS, duration: 250, ease: 'Back.Out' });

    this.enemies.push(enemy);
  }

  // ============ 塔 ============
  placeTower(gx, gy, type, star) {
    const key = `${gx},${gy}`;
    if (this.towers[key]) return false;
    const T = CFG.TILE;
    const spr = this.add.image(gx * T + T/2, gy * T + T/2, `tower_${type}_${star}`);
    spr.setDepth(4);
    spr.setData('gx', gx); spr.setData('gy', gy);
    this.towerLayer.add(spr);

    spr.setScale(0.3 * CFG.IS);
    this.tweens.add({ targets: spr, scaleX: CFG.IS, scaleY: CFG.IS, duration: 300, ease: 'Back.Out' });

    const def = TOWER_TYPES[type];
    const tower = {
      gx, gy, type, star, spr, def,
      x: spr.x, y: spr.y,
      cooldown: 0,
      target: null,
    };
    this.towers[key] = tower;
    this.towerList.push(tower);
    this._recalcAuras();
    return true;
  }

  upgradeTower(tower, newStar) {
    tower.star = newStar;
    tower.spr.setTexture(`tower_${tower.type}_${newStar}`);
    const flash = this.add.circle(tower.x, tower.y, 30, PALETTE.gold, 0.6);
    this.fxLayer.add(flash);
    this.tweens.add({
      targets: flash, scale: 2, alpha: 0, duration: 500,
      onComplete: () => flash.destroy()
    });
    this._recalcAuras();
  }

  sellTower(tower) {
    const key = `${tower.gx},${tower.gy}`;
    delete this.towers[key];
    this.towerList = this.towerList.filter(t => t !== tower);
    const refund = Math.round(this._towerValue(tower) * 0.6);
    this.state.gold += refund;
    this.events.emit('gold-changed', this.state.gold);
    this.tweens.add({
      targets: tower.spr, scale: 0, alpha: 0, duration: 250,
      onComplete: () => tower.spr.destroy()
    });
    this._recalcAuras();
  }

  _towerValue(tower) {
    return 30 * Math.pow(2.2, tower.star - 1);
  }

  // ============ 大本营升级 ============
  baseUpgradeCost() {
    const lvl = this.state.baseLevel;
    return Math.round(80 * Math.pow(1.7, lvl - 1));
  }

  canUpgradeBase() {
    return this.state.baseLevel < 5;
  }

  upgradeBase() {
    if (!this.canUpgradeBase()) return false;
    const cost = this.baseUpgradeCost();
    if (this.state.gold < cost) return false;
    this.state.gold -= cost;
    this.state.baseLevel++;
    this.state.baseHp += 10;
    this.state.hp = this.state.baseHp;
    this.state.mods.goldMul *= 1.1;
    this.events.emit('gold-changed', this.state.gold);
    this.events.emit('hp-changed', this.state.hp);
    this._drawBase();
    this._updateBaseBar();
    const flash = this.add.circle(this.baseSprite.x, this.baseSprite.y, 30, PALETTE.gold, 0.7);
    this.fxLayer.add(flash);
    this.tweens.add({ targets: flash, scale: 2.5, alpha: 0, duration: 600, onComplete: () => flash.destroy() });
    this._showFloatText(this.baseSprite.x, this.baseSprite.y - 50, `基地 Lv.${this.state.baseLevel}!`, PALETTE.gold);
    return true;
  }

  _recalcAuras() {
    for (const t of this.towerList) {
      t.auraDmg = 1;
      t.auraRate = 1;
    }
    for (const t of this.towerList) {
      if (t.type !== 'buff') continue;
      const mul = STAR_MUL[t.star];
      const range = t.def.range * mul.range * this.state.mods.rangeMul;
      const aura = t.def.aura;
      for (const other of this.towerList) {
        if (other === t) continue;
        const d = Phaser.Math.Distance.Between(t.x, t.y, other.x, other.y);
        if (d <= range) {
          other.auraDmg *= aura.dmgMul;
          other.auraRate *= aura.rateMul;
        }
      }
    }
  }

  // ============ 输入 ============
  _onPointerDown(p) {
    if (this.state.gameOver) return;
    // 相机 zoom=RS 后，p.x/p.y 是缓冲空间坐标，须用 worldX/worldY 取世界坐标
    const wx = p.worldX, wy = p.worldY;
    if (wx >= CFG.MAP_W) return;

    if (this.selectedDrop) {
      const gx = Math.floor(wx / CFG.TILE);
      const gy = Math.floor(wy / CFG.TILE);
      const key = `${gx},${gy}`;
      const drop = this.selectedDrop;

      // 情况 A：点到已有塔 → 尝试合成（同类型同星级）
      const existing = this.towers[key];
      if (existing) {
        if (existing.type === drop.type && existing.star === drop.star && existing.star < 4) {
          let newStar = existing.star + 1;
          if (this.state.mods.mergeJump > 0 && Math.random() < this.state.mods.mergeJump && newStar < 4) {
            newStar = Math.min(4, newStar + 1);
            this._showFloatText(existing.x, existing.y - 40, '大成功!', PALETTE.gold);
          }
          this.upgradeTower(existing, newStar);
          this._consumeDrop(drop);
          return;
        } else {
          this.events.emit('hint', existing.star >= 4 ? '已满星，无法合成' : '类型或星级不同，无法合成');
          return;
        }
      }

      // 情况 B：点到可建造空地 → 放置
      if (this.mapData.buildable.has(key)) {
        this.placeTower(gx, gy, drop.type, drop.star);
        this._consumeDrop(drop);
      }
      return;
    }

    // 点击已有塔：选中显示信息
    const gx = Math.floor(wx / CFG.TILE);
    const gy = Math.floor(wy / CFG.TILE);
    const key = `${gx},${gy}`;
    // 点击基地格：交给基地 zone 处理，不覆盖基地面板
    if (this.baseGrid && gx === this.baseGrid.x && gy === this.baseGrid.y) {
      return;
    }
    if (this.towers[key]) {
      this.events.emit('tower-selected', this.towers[key]);
    } else {
      this.events.emit('tower-selected', null);
    }
  }

  _onPointerMove(p) {
    const wx = p.worldX, wy = p.worldY;
    if (wx >= CFG.MAP_W) { this._clearGhost(); return; }
    if (!this.selectedDrop) { this._clearGhost(); return; }
    const gx = Math.floor(wx / CFG.TILE);
    const gy = Math.floor(wy / CFG.TILE);
    const key = `${gx},${gy}`;
    const T = CFG.TILE;
    if (!this.ghost) {
      this.ghost = this.add.image(0, 0, `tower_${this.selectedDrop.type}_${this.selectedDrop.star}`);
      this.ghost.setScale(CFG.IS);
      this.ghost.setAlpha(0.6);
      this.ghost.setDepth(10);
      this.ghostRange = this.add.circle(0, 0, 100, 0xffffff, 0.1);
      this.ghostRange.setStrokeStyle(2, 0xffffff, 0.5);
      this.ghostRange.setDepth(9);
    }
    this.ghost.setTexture(`tower_${this.selectedDrop.type}_${this.selectedDrop.star}`);
    this.ghost.setPosition(gx * T + T/2, gy * T + T/2);
    this.ghostRange.setPosition(gx * T + T/2, gy * T + T/2);
    const def = TOWER_TYPES[this.selectedDrop.type];
    const mul = STAR_MUL[this.selectedDrop.star];
    const range = def.range * mul.range * this.state.mods.rangeMul;
    this.ghostRange.setRadius(range);

    const existing = this.towers[key];
    let ok, tintColor;
    if (existing) {
      const canMerge = existing.type === this.selectedDrop.type
        && existing.star === this.selectedDrop.star
        && existing.star < 4;
      ok = canMerge;
      tintColor = canMerge ? PALETTE.gold : 0xff6b6b;
      this.ghost.setAlpha(canMerge ? 0.4 : 0.6);
    } else {
      ok = this.mapData.buildable.has(key);
      tintColor = ok ? 0xffffff : 0xff6b6b;
      this.ghost.setAlpha(0.6);
    }
    this.ghost.setTint(tintColor);
    this.ghostRange.setStrokeStyle(2, ok ? 0xffffff : 0xff6b6b, 0.6);
  }

  _clearGhost() {
    if (this.ghost) { this.ghost.destroy(); this.ghost = null; }
    if (this.ghostRange) { this.ghostRange.destroy(); this.ghostRange = null; }
  }

  selectDrop(drop) {
    this.selectedDrop = drop;
    this.events.emit('drop-selected', drop);
  }

  _consumeDrop(drop) {
    this.pendingDrops = this.pendingDrops.filter(d => d.id !== drop.id);
    this.events.emit('drops-updated', this.pendingDrops);
    this.selectedDrop = null;
    this.events.emit('drop-selected', null);
    this._clearGhost();
  }

  // ============ 主循环 ============
  _update(time, dt) {
    this._updateBaseBar();
    if (this.state.gameOver || this.state.paused) return;

    if (this.state.waveActive) this._spawnFromQueue();

    // 敌人移动
    for (const e of this.enemies) {
      if (e.dead) continue;
      let speed = e.baseSpeed;
      if (time < e.slowUntil) speed *= e.slowFactor;
      // DOT
      if (e.dot && time >= e.dot.nextTick) {
        e.hp -= e.dot.dmg;
        e.dot.nextTick = time + e.dot.tick * 1000;
        if (e.dot.nextTick > time + e.dot.dur * 1000) e.dot = null;
        this._showFloatText(e.spr.x, e.spr.y - 20, `-${e.dot.dmg}`, 0xc9a0ff);
        if (e.hp <= 0) { this._killEnemy(e); continue; }
      }
      const target = this.pathPx[e.pathIdx + 1];
      if (!target) {
        this._enemyReachBase(e);
        continue;
      }
      const dx = target.x - e.x, dy = target.y - e.y;
      const dist = Math.hypot(dx, dy);
      const step = speed * dt;
      if (step >= dist) {
        e.x = target.x; e.y = target.y;
        e.pathIdx++;
      } else {
        e.x += dx / dist * step;
        e.y += dy / dist * step;
      }
      e.spr.setPosition(e.x, e.y);
      e.hpBg.setPosition(e.x, e.y - e.def.size - 9);
      e.hpFg.setPosition(e.x - e.barW/2, e.y - e.def.size - 9);
      if (dx < 0) e.spr.setFlipX(true);
      else if (dx > 0) e.spr.setFlipX(false);
      const ratio = Math.max(0, e.hp / e.maxHp);
      e.hpFg.width = e.barW * ratio;
      if (e.flying) {
        e.spr.y += Math.sin(time / 200 + e.pathIdx) * 3;
      }
    }

    // 塔攻击
    for (const t of this.towerList) {
      if (t.type === 'buff') continue;
      t.cooldown -= dt;
      if (t.cooldown > 0) continue;
      const mul = STAR_MUL[t.star];
      const range = t.def.range * mul.range * this.state.mods.rangeMul;
      let best = null, bestIdx = -1;
      for (const e of this.enemies) {
        if (e.dead) continue;
        const d = Phaser.Math.Distance.Between(t.x, t.y, e.x, e.y);
        if (d <= range && e.pathIdx > bestIdx) {
          best = e; bestIdx = e.pathIdx;
        }
      }
      if (best) {
        this._fire(t, best, mul);
        t.cooldown = t.def.fireRate * mul.rate * this.state.mods.rateMul * (t.auraRate || 1);
      }
    }

    // 弹丸
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      if (!p.target || p.target.dead) {
        if (p.lastX !== undefined) {
          const dx = p.lastX - p.spr.x, dy = p.lastY - p.spr.y;
          const d = Math.hypot(dx, dy);
          if (d < 8) { p.spr.destroy(); this.projectiles.splice(i, 1); continue; }
          p.spr.x += dx / d * p.speed * dt;
          p.spr.y += dy / d * p.speed * dt;
        } else {
          p.spr.destroy(); this.projectiles.splice(i, 1);
        }
        continue;
      }
      p.lastX = p.target.x; p.lastY = p.target.y;
      const dx = p.target.x - p.spr.x, dy = p.target.y - p.spr.y;
      const d = Math.hypot(dx, dy);
      const step = p.speed * dt;
      if (step >= d) {
        this._projectileHit(p);
        p.spr.destroy();
        this.projectiles.splice(i, 1);
      } else {
        p.spr.x += dx / d * step;
        p.spr.y += dy / d * step;
        p.spr.rotation = Math.atan2(dy, dx);
      }
    }

    this.enemies = this.enemies.filter(e => !e.dead);
  }

  _fire(tower, target, mul) {
    const def = tower.def;
    const dmg = def.dmg * mul.dmg * this.state.mods.dmgMul * (tower.auraDmg || 1);

    if (tower.type === 'zap') {
      this._chainLightning(tower, target, dmg, def.chain, def.chainRange);
      return;
    }

    const spr = this.add.image(tower.x, tower.y - 10, 'proj');
    spr.setTint(def.projColor || 0xffffff);
    spr.setDepth(6);
    spr.setScale((tower.star * 0.25 + 0.6) * CFG.IS);
    this.projLayer.add(spr);
    this.projectiles.push({
      spr, target, speed: def.projSpeed,
      dmg, tower,
      splash: def.splash || this.state.mods.splashAll || 0,
      slow: def.slow, slowDur: def.slowDur,
      dot: def.dot,
    });

    const flash = this.add.circle(tower.x, tower.y - 10, 8, 0xfff2b0, 0.8);
    this.fxLayer.add(flash);
    this.tweens.add({ targets: flash, scale: 2, alpha: 0, duration: 200, onComplete: () => flash.destroy() });
  }

  _chainLightning(tower, firstTarget, dmg, chainCount, chainRange) {
    const hit = [firstTarget];
    let current = firstTarget;
    let prev = { x: tower.x, y: tower.y - 10 };
    const segments = [];
    for (let i = 0; i < chainCount; i++) {
      segments.push({ from: prev, to: { x: current.x, y: current.y } });
      this._damageEnemy(current, dmg * Math.pow(0.75, i), tower);
      prev = { x: current.x, y: current.y };
      let next = null, nd = chainRange;
      for (const e of this.enemies) {
        if (e.dead || hit.includes(e)) continue;
        const d = Phaser.Math.Distance.Between(prev.x, prev.y, e.x, e.y);
        if (d < nd) { nd = d; next = e; }
      }
      if (!next) break;
      hit.push(next);
      current = next;
    }
    for (const seg of segments) {
      const g = this.add.graphics();
      g.lineStyle(3, 0xfff24a, 1);
      g.beginPath();
      g.moveTo(seg.from.x, seg.from.y);
      const steps = 5;
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const x = seg.from.x + (seg.to.x - seg.from.x) * t + (Math.random() - 0.5) * 12;
        const y = seg.from.y + (seg.to.y - seg.from.y) * t + (Math.random() - 0.5) * 12;
        g.lineTo(x, y);
      }
      g.lineTo(seg.to.x, seg.to.y);
      g.strokePath();
      g.lineStyle(1.5, 0xffffff, 0.9);
      g.strokePath();
      this.fxLayer.add(g);
      this.tweens.add({ targets: g, alpha: 0, duration: 250, onComplete: () => g.destroy() });
    }
  }

  _projectileHit(p) {
    const target = p.target;
    if (target && !target.dead) {
      this._damageEnemy(target, p.dmg, p.tower);
      if (p.slow) {
        target.slowUntil = this.time.now + p.slowDur * 1000;
        target.slowFactor = 1 - Math.min(0.85, p.slow + (this.state.mods.frostSlow - 0.45));
        target.spr.setTint(0xa0e0ff);
        this.time.delayedCall(p.slowDur * 1000, () => {
          if (!target.dead) target.spr.clearTint();
        });
      }
      if (p.dot) {
        target.dot = {
          dmg: p.dot.dmg * STAR_MUL[p.tower.star].dmg * this.state.mods.dmgMul,
          dur: p.dot.dur, tick: p.dot.tick,
          nextTick: this.time.now + p.dot.tick * 1000,
        };
      }
    }
    if (p.splash > 0) {
      const cx = p.spr.x, cy = p.spr.y;
      for (const e of this.enemies) {
        if (e.dead || e === target) continue;
        const d = Phaser.Math.Distance.Between(cx, cy, e.x, e.y);
        if (d <= p.splash) {
          this._damageEnemy(e, p.dmg * 0.6, p.tower);
        }
      }
      const boom = this.add.circle(cx, cy, p.splash * 0.3, 0xff9a4a, 0.7);
      this.fxLayer.add(boom);
      this.tweens.add({
        targets: boom, scale: p.splash / 15, alpha: 0, duration: 350,
        onComplete: () => boom.destroy()
      });
    }
    const hit = this.add.circle(p.spr.x, p.spr.y, 6, 0xffffff, 0.8);
    this.fxLayer.add(hit);
    this.tweens.add({ targets: hit, scale: 2.5, alpha: 0, duration: 200, onComplete: () => hit.destroy() });
  }

  _damageEnemy(e, dmg, sourceTower) {
    if (e.dead) return;
    if (this.state.mods.crit > 0 && Math.random() < this.state.mods.crit) {
      dmg *= 2;
      this._showFloatText(e.x, e.y - 24, '暴击!', PALETTE.gold);
    }
    dmg *= (1 - (e.armor || 0));
    dmg = Math.max(1, Math.round(dmg));
    e.hp -= dmg;
    this._showFloatText(e.x + (Math.random() - 0.5) * 10, e.y - 16, `-${dmg}`, 0xffffff);
    if (e.hp <= 0) this._killEnemy(e);
  }

  _killEnemy(e) {
    if (e.dead) return;
    e.dead = true;
    this.state.gold += e.gold;
    this.events.emit('gold-changed', this.state.gold);
    this._showFloatText(e.x, e.y - 20, `+${e.gold}`, PALETTE.gold);
    const puff = this.add.circle(e.x, e.y, e.def.size, e.def.color, 0.8);
    this.fxLayer.add(puff);
    this.tweens.add({
      targets: puff, scale: 2.2, alpha: 0, duration: 350,
      onComplete: () => puff.destroy()
    });
    this.tweens.add({
      targets: e.spr, scale: 0, alpha: 0, angle: 180, duration: 300,
      onComplete: () => e.spr.destroy()
    });
    if (e.hpBg) e.hpBg.destroy();
    if (e.hpFg) e.hpFg.destroy();
  }

  _enemyReachBase(e) {
    if (e.dead) return;
    e.dead = true;
    const dmg = e.type === 'boss' ? 5 : 1;
    this.state.hp -= dmg;
    this.events.emit('hp-changed', this.state.hp);
    const flash = this.add.circle(this.baseSprite.x, this.baseSprite.y, 40, 0xff2a2a, 0.6);
    this.fxLayer.add(flash);
    this.tweens.add({ targets: flash, scale: 2, alpha: 0, duration: 500, onComplete: () => flash.destroy() });
    this.cameras.main.shake(200, 0.005);
    e.spr.destroy();
    if (e.hpBg) e.hpBg.destroy();
    if (e.hpFg) e.hpFg.destroy();
    if (this.state.hp <= 0) this._gameOver();
  }

  _showFloatText(x, y, text, color) {
    const t = this.add.text(x, y, text, {
      fontFamily: 'PingFang SC, sans-serif',
      fontSize: '14px',
      fontStyle: 'bold',
      color: '#' + color.toString(16).padStart(6, '0'),
      stroke: '#2b1e14',
      strokeThickness: 3,
      resolution: CFG.RS,
    }).setOrigin(0.5).setDepth(20);
    this.fxLayer.add(t);
    this.tweens.add({
      targets: t, y: y - 30, alpha: 0, duration: 800,
      onComplete: () => t.destroy()
    });
  }

  _gameOver() {
    this.state.gameOver = true;
    this.events.emit('game-over', { wave: this.state.wave, talents: this.state.talents });
  }

  applyTalent(talent) {
    talent.apply(this.state);
    this.state.talents.push(talent);
    this._recalcAuras();
    this.events.emit('talent-applied', talent);
  }

  restart() {
    this.scene.stop('UI');
    this.scene.restart();
  }
}
