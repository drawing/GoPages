// UIScene: 右侧面板（金币/生命/波次/待放置塔/天赋/塔信息/波次预告）
class UIScene extends Phaser.Scene {
  constructor() { super('UI'); }

  init(data) {
    this.game_ = data.game;
  }

  create() {
    // 高清渲染：相机 zoom=RS（与 GameScene 一致），setOrigin(0,0) 避免可视世界偏移
    this.cameras.main.setOrigin(0, 0);
    this.cameras.main.setZoom(CFG.RS);
    this.cameras.main.setScroll(0, 0);

    const X = CFG.MAP_W;
    const W = CFG.UI_W;
    const H = CFG.GAME_H;

    // 面板背景
    const bg = this.add.rectangle(X + W/2, H/2, W, H, PALETTE.panel);
    bg.setStrokeStyle(3, PALETTE.ink, 1);

    // 装饰边
    const deco = this.add.graphics();
    deco.lineStyle(2, PALETTE.panelLight, 1);
    deco.strokeRoundedRect(X + 6, 6, W - 12, H - 12, 8);

    // ===== 顶部：状态栏 =====
    let y = 24;
    this.txtWave = this._text(X + 20, y, '波次 0', 20, 0xffe89a, 'bold');
    this.txtWave.setOrigin(0, 0.5);

    // 加速按钮 + 暂停按钮（右上角）
    this.speedBtn = this._makeSpeedButton(X + W - 94, y);
    this.pauseBtn = this._makePauseButton(X + W - 52, y);

    y += 34;

    this.imgHeart = this.add.image(X + 26, y, 'icon_heart').setScale(CFG.IS);
    this.txtHp = this._text(X + 44, y, '20 / 20', 16, 0xffffff);
    this.txtHp.setOrigin(0, 0.5);

    this.imgGold = this.add.image(X + 160, y, 'icon_gold').setScale(CFG.IS);
    this.txtGold = this._text(X + 176, y, '120', 16, PALETTE.gold);
    this.txtGold.setOrigin(0, 0.5);

    y += 34;
    // 分隔线
    this._hr(X + 16, y, W - 32);
    y += 16;

    // ===== 待放置塔区 =====
    this._text(X + 20, y, '🎁 待放置（点击选中，再点地图）', 13, 0xc9b8e8).setOrigin(0, 0.5);
    y += 24;
    this.dropsStartY = y;
    this.dropSlots = [];
    // 3 列 × 2 行，_makeDropSlot 接收中心坐标
    const slotW = 88, slotH = 80, colGap = 100, rowGap = 88;
    const col0 = X + 20 + slotW/2;      // 第一列中心
    const row0 = y + slotH/2;           // 第一行中心
    for (let i = 0; i < 6; i++) {
      const cx = col0 + (i % 3) * colGap;
      const cy = row0 + Math.floor(i / 3) * rowGap;
      const slot = this._makeDropSlot(cx, cy);
      this.dropSlots.push(slot);
    }
    // 两行槽位共占 rowGap + slotH 高度（第二行中心在 row0+rowGap，底部再 +slotH/2）
    y += rowGap + slotH + 12;

    this._hr(X + 16, y, W - 32);
    y += 16;

    // ===== 塔信息区 =====
    this._text(X + 20, y, '🔍 塔信息', 13, 0xc9b8e8).setOrigin(0, 0.5);
    y += 22;
    this.towerInfoY = y;
    this.towerInfoContainer = this.add.container(X + 20, y);
    this.selectedTower = null;

    // ===== 底部：波次预告 / 提前开战 =====
    this._hr(X + 16, 540, W - 32);
    this.txtPreviewTitle = this._text(X + 20, 560, '下一波预告', 13, 0xc9b8e8);
    this.txtPreviewTitle.setOrigin(0, 0.5);
    this.txtPreviewComp = this._text(X + 20, 580, '', 12, 0xffffff);
    this.txtPreviewComp.setOrigin(0, 0);
    this.txtCountdown = this._text(X + 20, 636, '', 13, PALETTE.gold, 'bold');
    this.txtCountdown.setOrigin(0, 0.5);
    this.earlyBtn = this._makeButton(X + 20, 652, 170, 32, '提前开战 (+金币)', PALETTE.gold, () => {
      this.game_.callWaveEarly();
    }, false);

    // ===== 最底部：提示 =====
    this.txtHint = this._text(X + W/2, H - 18, '', 12, 0xa89ac8, 'normal', 'center');
    this.txtHint.setOrigin(0.5, 0.5);

    // ===== 遮罩层 =====
    this.talentOverlay = this.add.container(0, 0).setVisible(false).setDepth(100);
    this.lootOverlay = this.add.container(0, 0).setVisible(false).setDepth(110);
    this.gameOverOverlay = this.add.container(0, 0).setVisible(false).setDepth(200);
    this._overlayQueue = [];
    this.banner = null;

    // ===== 暂停遮罩（盖在地图上，UI 面板仍可见）=====
    this.pauseOverlay = this.add.container(0, 0).setVisible(false).setDepth(90);
    const pauseMask = this.add.rectangle(CFG.MAP_W/2, CFG.GAME_H/2, CFG.MAP_W, CFG.GAME_H, 0x000000, 0.45);
    this.pauseOverlay.add(pauseMask);
    const pauseTitle = this._text(CFG.MAP_W/2, CFG.GAME_H/2 - 14, '⏸ 已暂停', 40, PALETTE.gold, 'bold', 'center');
    pauseTitle.setOrigin(0.5);
    this.pauseOverlay.add(pauseTitle);
    const pauseSub = this._text(CFG.MAP_W/2, CFG.GAME_H/2 + 28, '按 P 键或点右上角按钮继续', 16, 0xffffff, 'normal', 'center');
    pauseSub.setOrigin(0.5);
    this.pauseOverlay.add(pauseSub);

    // 键盘快捷键：P/空格 暂停，F 加速
    this.input.keyboard.on('keydown-P', () => this.togglePause());
    this.input.keyboard.on('keydown-SPACE', () => this.togglePause());
    this.input.keyboard.on('keydown-F', () => this._toggleSpeed());

    // 事件监听（统一登记，场景关闭时全部解绑，避免 restart 后重复监听）
    this._handlers = [];
    this.events.once('shutdown', () => {
      for (const [name, fn] of this._handlers) this.game_.events.off(name, fn);
    });

    this._on('gold-changed', v => {
      this.txtGold.setText(v);
      // 金币变化时刷新当前选中面板，让升级按钮的置灰态实时更新
      if (this.selectedTower) this._showTowerInfo(this.selectedTower);
      else if (this.baseInfoShown) this._showBaseInfo();
    });
    this._on('hp-changed', v => this.txtHp.setText(`${Math.max(0, v)} / ${this.game_.state.baseHp}`));
    this._on('wave-start', info => {
      this.txtWave.setText(`波次 ${info.n}`);
      this.txtPreviewTitle.setText('当前波');
      this.txtPreviewComp.setText(this._previewText(this.game_.nextWaveDef));
      this._showWaveBanner(info);
    });
    this._on('wave-end', n => {
      this.txtHint.setText(`第 ${n} 波清空！选择战利品...`);
      this.txtPreviewTitle.setText('下一波预告');
      this.txtPreviewComp.setText(this._previewText(this.game_.nextWaveDef));
    });
    this._on('drops-updated', drops => this._refreshDrops(drops));
    this._on('drop-selected', drop => this._refreshDropHighlight(drop));
    this._on('tower-selected', t => { this.baseInfoShown = false; this._showTowerInfo(t); });
    this._on('base-selected', () => { this.baseInfoShown = true; this._showBaseInfo(); });
    this._on('offer-loot', opts => { this._overlayQueue.push({ kind: 'loot', opts }); this._pumpOverlays(); });
    this._on('offer-talent', () => { this._overlayQueue.push({ kind: 'talent' }); this._pumpOverlays(); });
    this._on('game-over', info => this._showGameOver(info));
    this._on('hint', msg => {
      this.txtHint.setText(msg);
      this.time.delayedCall(2000, () => {
        if (this.txtHint.text === msg) this.txtHint.setText('');
      });
    });

    // 拉取开局已有的掉落塔与初始状态
    this._refreshDrops(this.game_.pendingDrops);
    this.txtGold.setText(this.game_.state.gold);
    this.txtHp.setText(`${this.game_.state.hp} / ${this.game_.state.baseHp}`);
    this.txtPreviewComp.setText(this._previewText(this.game_.nextWaveDef));
  }

  update() {
    const g = this.game_;
    if (!g || !g.state || g.state.gameOver) return;
    if (g.state.interWave) {
      const secs = Math.max(0, Math.ceil((g.nextWaveAt - g.gameTime) / 1000));
      this.txtCountdown.setText(`${secs}s 后来袭`);
      this.earlyBtn.setAlpha(g.state.paused ? 0.4 : 1);
    } else {
      const left = g.enemies.length + (g.waveQueue ? g.waveQueue.length : 0);
      this.txtCountdown.setText(`剩余敌人 ${left}`);
      this.earlyBtn.setAlpha(0.4);
    }
  }

  _on(name, fn) {
    this.game_.events.on(name, fn);
    this._handlers.push([name, fn]);
  }

  _text(x, y, str, size, color, style, align) {
    const t = this.add.text(x, y, str, {
      fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif',
      fontSize: size + 'px',
      fontStyle: style || 'normal',
      color: '#' + color.toString(16).padStart(6, '0'),
      align: align || 'left',
      wordWrap: { width: CFG.UI_W - 40 },
      resolution: CFG.RS, // 字形按 RS 倍栅格化，匹配高清缓冲，避免文字模糊
    });
    return t;
  }

  _hr(x, y, w) {
    const g = this.add.graphics();
    g.lineStyle(1.5, PALETTE.panelLight, 1);
    g.lineBetween(x, y, x + w, y);
    g.fillStyle(PALETTE.gold, 0.7);
    g.fillCircle(x + w/2, y, 3);
  }

  // 波次组成预告文本
  _previewText(def) {
    if (!def) return '';
    const counts = {};
    for (const g of def.list) counts[g.type] = (counts[g.type] || 0) + g.count;
    let s = Object.entries(counts).map(([t, c]) => `${ENEMY_TYPES[t].name}×${c}`).join('  ');
    if (def.boss) s = 'BOSS 波！' + s;
    if (def.affix) s += `\n词缀「${def.affix.name}」${def.affix.desc}`;
    if (def.eliteCount) s += `\n混入 ${def.eliteCount} 个精英（金血条）`;
    return s;
  }

  // 波次横幅：地图中央大字滑入淡出
  _showWaveBanner(info) {
    if (this.banner) { this.banner.destroy(); this.banner = null; }
    const c = this.add.container(CFG.MAP_W/2, 190).setDepth(80);
    const title = this._text(0, 0, info.boss ? `第 ${info.n} 波 · BOSS` : `第 ${info.n} 波`, 44, PALETTE.gold, 'bold', 'center');
    title.setOrigin(0.5);
    title.setStroke('#2b1e14', 6);
    c.add(title);
    let sub = '';
    if (info.boss) sub = 'BOSS 半血后会狂暴加速！';
    else if (info.affix) sub = `词缀「${info.affix.name}」：${info.affix.desc}`;
    else if (info.eliteCount) sub = `精英 x${info.eliteCount} 混入敌群`;
    if (sub) {
      const st = this._text(0, 44, sub, 18, 0xffffff, 'bold', 'center');
      st.setOrigin(0.5);
      st.setStroke('#2b1e14', 4);
      c.add(st);
    }
    c.setAlpha(0);
    c.setScale(0.8);
    this.tweens.add({ targets: c, alpha: 1, scale: 1, duration: 250, ease: 'Back.Out' });
    this.time.delayedCall(1500, () => {
      this.tweens.add({
        targets: c, alpha: 0, y: 170, duration: 350,
        onComplete: () => { c.destroy(); if (this.banner === c) this.banner = null; }
      });
    });
    this.banner = c;
  }

  _makeDropSlot(cx, cy) {
    // cx,cy 为槽位中心。所有子元素以原点(0,0)为中心排布。
    // 关键：交互绑在 bg 矩形上而非 Container 上——Phaser Container 的 hitArea
    // 坐标系原点不在中心，会导致命中区偏移（表现为"只有上半截能 hover"）。
    // 普通 GameObject(bg) 的 hitTest 走标准世界坐标，覆盖整个视觉框，最可靠。
    const BW = 88, BH = 80;
    const container = this.add.container(cx, cy);
    const bg = this.add.rectangle(0, 0, BW, BH, PALETTE.panelLight, 0.6);
    bg.setStrokeStyle(2, PALETTE.ink, 0.8);
    container.add(bg);
    const spr = this.add.image(0, -10, '__WHITE');
    spr.setVisible(false);
    spr.setScale(0.82);
    container.add(spr);
    const label = this._text(0, 28, '', 11, 0xffffff, 'bold', 'center');
    label.setOrigin(0.5, 0.5);
    container.add(label);
    container.setSize(BW, BH);
    container.setData('bg', bg);
    container.setData('spr', spr);
    container.setData('label', label);
    container.setData('drop', null);
    container.setData('hover', false);
    // 交互绑在 bg 上，覆盖整个 88×80 视觉框
    bg.setInteractive({ useHandCursor: true });
    bg.on('pointerover', () => {
      container.setData('hover', true);
      this._applySlotVisual(container);
    });
    bg.on('pointerout', () => {
      container.setData('hover', false);
      this._applySlotVisual(container);
    });
    bg.on('pointerdown', () => {
      const d = container.getData('drop');
      if (!d) return;
      const sel = this.game_.selectedDrop;
      if (sel && sel.id === d.id) {
        this.game_.selectDrop(null);
      } else {
        this.game_.selectDrop(d);
      }
    });
    return container;
  }

  // 集中计算单个槽位的视觉状态：综合 有无塔 / 是否选中 / 是否悬停
  _applySlotVisual(slot) {
    const bg = slot.getData('bg');
    const d = slot.getData('drop');
    const sel = this.game_.selectedDrop;
    const hover = slot.getData('hover');
    const isSelected = d && sel && sel.id === d.id;
    if (!d) {
      bg.setFillStyle(PALETTE.panelLight, 0.3);
      bg.setStrokeStyle(2, PALETTE.ink, 0.8);
    } else if (isSelected) {
      bg.setFillStyle(PALETTE.gold, 0.6);
      bg.setStrokeStyle(3, PALETTE.gold, 1);
    } else if (hover) {
      bg.setFillStyle(PALETTE.buildableHover, 0.75);
      bg.setStrokeStyle(2, PALETTE.gold, 0.9);
    } else {
      bg.setFillStyle(PALETTE.panelLight, 0.6);
      bg.setStrokeStyle(2, PALETTE.ink, 0.8);
    }
  }

  _refreshDrops(drops) {
    for (let i = 0; i < this.dropSlots.length; i++) {
      const slot = this.dropSlots[i];
      const drop = drops[i];
      const spr = slot.getData('spr');
      const label = slot.getData('label');
      if (drop) {
        slot.setData('drop', drop);
        spr.setTexture(`tower_${drop.type}_${drop.star}`).setVisible(true).setScale(1.1 * CFG.IS);
        const def = TOWER_TYPES[drop.type];
        label.setText(`${def.name} ${'★'.repeat(drop.star)}`);
      } else {
        slot.setData('drop', null);
        spr.setVisible(false);
        label.setText('');
      }
      this._applySlotVisual(slot);
    }
  }

  _refreshDropHighlight(selected) {
    for (const slot of this.dropSlots) {
      this._applySlotVisual(slot);
    }
  }

  _showTowerInfo(tower) {
    this.towerInfoContainer.removeAll(true);
    this.selectedTower = tower;
    if (this.rangeCircle) { this.rangeCircle.destroy(); this.rangeCircle = null; }
    if (!tower) {
      const t = this._text(0, 0, '点击地图上的塔查看详情\n点击大本营可升级城墙', 12, 0xa89ac8);
      this.towerInfoContainer.add(t);
      return;
    }
    const def = TOWER_TYPES[tower.type];
    const mul = STAR_MUL[tower.star];
    const dmg = Math.round(def.dmg * mul.dmg * this.game_.state.mods.dmgMul * (tower.auraDmg || 1));
    const range = Math.round(def.range * mul.range * this.game_.state.mods.rangeMul);
    const rate = (def.fireRate * mul.rate * this.game_.state.mods.rateMul * (tower.auraRate || 1)).toFixed(2);

    // 图标
    const icon = this.add.image(24, 24, `tower_${tower.type}_${tower.star}`).setScale(1.1 * CFG.IS);
    this.towerInfoContainer.add(icon);

    const name = this._text(56, 8, `${def.name} ${'★'.repeat(tower.star)}`, 15, PALETTE.gold, 'bold');
    this.towerInfoContainer.add(name);
    const desc = this._text(56, 28, def.desc, 11, 0xc9b8e8);
    this.towerInfoContainer.add(desc);

    const stats = this._text(0, 56,
      `伤害: ${dmg}\n射程: ${range}\n攻速: ${rate}s/发`, 12, 0xffffff);
    this.towerInfoContainer.add(stats);

    // 按钮：升级（常驻，满级/金币不足则置灰）+ 出售（位置固定，避免误点）
    const maxed = tower.star >= 4;
    const upCost = maxed ? 0 : Math.round(this.game_._towerValue({ star: tower.star + 1 }) * 0.7 * this.game_.state.mods.upCostMul);
    const canAfford = this.game_.state.gold >= upCost;
    const upDisabled = maxed || !canAfford;
    const upLabel = maxed ? '已满级 ★4' : `升级 (${upCost}金)`;
    const upBtn = this._makeButton(0, 116, 130, 32, upLabel, PALETTE.gold, () => {
      if (this.game_.state.gold >= upCost) {
        this.game_.state.gold -= upCost;
        this.game_.events.emit('gold-changed', this.game_.state.gold);
        this.game_.upgradeTower(tower, tower.star + 1);
        this._showTowerInfo(tower);
      } else {
        this.txtHint.setText('金币不足！');
      }
    }, upDisabled);
    this.towerInfoContainer.add(upBtn);

    // 出售按钮始终固定在 x=140，不随升级按钮是否存在而移动
    const sellValue = Math.round(this.game_._towerValue(tower) * 0.6);
    const sellBtn = this._makeButton(140, 116, 130, 32, `出售 (+${sellValue})`, 0xe0554a, () => {
      this.game_.sellTower(tower);
      this._showTowerInfo(null);
    }, false);
    this.towerInfoContainer.add(sellBtn);

    // 显示射程圈
    if (this.rangeCircle) this.rangeCircle.destroy();
    this.rangeCircle = this.add.circle(tower.x, tower.y, range, 0xffffff, 0.08);
    this.rangeCircle.setStrokeStyle(2, 0xffffff, 0.5);
    this.rangeCircle.setDepth(3);
    this.game_.rangeCircle = this.rangeCircle;
  }

  // 大本营信息面板：显示等级、血量，提供升级按钮（满级/金币不足置灰）
  _showBaseInfo() {
    this.towerInfoContainer.removeAll(true);
    this.selectedTower = null;
    if (this.rangeCircle) { this.rangeCircle.destroy(); this.rangeCircle = null; }
    const st = this.game_.state;

    // 图标（画一个小房子）
    const icon = this.add.graphics();
    icon.fillStyle(0xd9a86b, 1);
    icon.fillRoundedRect(6, 14, 36, 30, 4);
    icon.lineStyle(2, PALETTE.ink, 1);
    icon.strokeRoundedRect(6, 14, 36, 30, 4);
    icon.fillStyle(0xa83a3a, 1);
    icon.fillTriangle(2, 16, 46, 16, 24, 0);
    icon.lineStyle(2, PALETTE.ink, 1);
    icon.strokeTriangle(2, 16, 46, 16, 24, 0);
    this.towerInfoContainer.add(icon);

    const name = this._text(56, 8, `大本营 Lv.${st.baseLevel}`, 15, PALETTE.gold, 'bold');
    this.towerInfoContainer.add(name);
    const desc = this._text(56, 28, '升级可提升生命上限并回满', 11, 0xc9b8e8);
    this.towerInfoContainer.add(desc);

    const stats = this._text(0, 56,
      `生命: ${Math.max(0, st.hp)} / ${st.baseHp}\n金币产出: x${st.mods.goldMul.toFixed(2)}`, 12, 0xffffff);
    this.towerInfoContainer.add(stats);

    // 升级按钮（常驻，满级/金币不足置灰）
    const maxed = !this.game_.canUpgradeBase();
    const cost = this.game_.baseUpgradeCost();
    const canAfford = st.gold >= cost;
    const disabled = maxed || !canAfford;
    const label = maxed ? '已满级 Lv.5' : `升级 (${cost}金)`;
    const upBtn = this._makeButton(0, 116, 130, 32, label, PALETTE.gold, () => {
      if (this.game_.upgradeBase()) {
        this._showBaseInfo();
      } else {
        this.txtHint.setText('金币不足！');
      }
    }, disabled);
    this.towerInfoContainer.add(upBtn);

    // 提示文字
    const hint = this._text(140, 116, maxed ? '城墙已坚不可摧' : `+10 生命上限\n金币产出 +10%`, 11, 0xa89ac8);
    hint.setWordWrapWidth(130);
    this.towerInfoContainer.add(hint);
  }

  // 加速按钮：×1 / ×2 切换
  _makeSpeedButton(cx, cy) {
    const S = 34;
    const c = this.add.container(cx, cy);
    const bg = this.add.rectangle(0, 0, S, S, PALETTE.panelLight, 0.9);
    bg.setStrokeStyle(2, PALETTE.gold, 0.8);
    c.add(bg);
    const label = this._text(0, 0, '×1', 15, PALETTE.gold, 'bold', 'center');
    label.setOrigin(0.5);
    c.add(label);
    c.setData('bg', bg);
    c.setData('label', label);
    bg.setInteractive({ useHandCursor: true });
    bg.on('pointerover', () => bg.setFillStyle(0x7a5a9a, 1));
    bg.on('pointerout', () => bg.setFillStyle(c.getData('label').text === '×2' ? 0x7a5a10 : PALETTE.panelLight, 0.9));
    bg.on('pointerdown', () => this._toggleSpeed());
    return c;
  }

  _toggleSpeed() {
    const v = this.game_.toggleSpeed();
    const label = this.speedBtn.getData('label');
    const bg = this.speedBtn.getData('bg');
    label.setText('×' + v);
    bg.setFillStyle(v === 2 ? 0x7a5a10 : PALETTE.panelLight, 0.9);
    this.txtHint.setText(v === 2 ? '已开启 2 倍速（F 键切换）' : '已恢复 1 倍速');
  }

  // 暂停按钮：右上角小方块，图标随状态切换（暂停/播放）
  _makePauseButton(cx, cy) {
    const S = 34;
    const c = this.add.container(cx, cy);
    const bg = this.add.rectangle(0, 0, S, S, PALETTE.panelLight, 0.9);
    bg.setStrokeStyle(2, PALETTE.gold, 0.8);
    c.add(bg);
    const icon = this.add.graphics();
    c.add(icon);
    c.setData('bg', bg);
    c.setData('icon', icon);
    this._drawPauseIcon(icon, false);
    bg.setInteractive({ useHandCursor: true });
    bg.on('pointerover', () => bg.setFillStyle(0x7a5a9a, 1));
    bg.on('pointerout', () => bg.setFillStyle(PALETTE.panelLight, 0.9));
    bg.on('pointerdown', () => this.togglePause());
    return c;
  }

  // 画暂停图标（两条竖杠）或播放图标（三角）
  _drawPauseIcon(g, paused) {
    g.clear();
    g.fillStyle(PALETTE.gold, 1);
    if (paused) {
      g.fillTriangle(-6, -8, -6, 8, 9, 0);
      g.lineStyle(1.5, PALETTE.ink, 0.8);
      g.strokeTriangle(-6, -8, -6, 8, 9, 0);
    } else {
      g.fillRect(-7, -8, 5, 16);
      g.fillRect(2, -8, 5, 16);
      g.lineStyle(1.5, PALETTE.ink, 0.8);
      g.strokeRect(-7, -8, 5, 16);
      g.strokeRect(2, -8, 5, 16);
    }
  }

  // 切换暂停
  togglePause() {
    const st = this.game_.state;
    if (st.gameOver) return;
    if (this.talentOverlay.visible || this.lootOverlay.visible) return;
    st.userPaused = !st.userPaused;
    st.paused = st.userPaused;
    this._drawPauseIcon(this.pauseBtn.getData('icon'), st.userPaused);
    this.pauseOverlay.setVisible(st.userPaused);
    if (st.userPaused) {
      this.txtHint.setText('已暂停（按 P 或点按钮继续）');
    } else {
      this.txtHint.setText('');
    }
  }

  _makeButton(x, y, w, h, label, color, onClick, disabled) {
    const c = this.add.container(x, y);
    const fillColor = disabled ? PALETTE.disabled : color;
    const bg = this.add.rectangle(w/2, h/2, w, h, fillColor, disabled ? 0.5 : 0.9);
    bg.setStrokeStyle(2, PALETTE.ink, disabled ? 0.5 : 1);
    c.add(bg);
    const t = this._text(w/2, h/2, label, 12, disabled ? 0xa89ac8 : PALETTE.ink, 'bold', 'center');
    t.setOrigin(0.5, 0.5);
    c.add(t);
    c.setSize(w, h);
    c.setData('disabled', !!disabled);
    if (!disabled) {
      // 交互绑在 bg 矩形上（避免 Container hitArea 坐标系偏移问题）
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerover', () => { bg.setFillStyle(color, 1); c.setScale(1.04); });
      bg.on('pointerout', () => { bg.setFillStyle(color, 0.9); c.setScale(1); });
      bg.on('pointerdown', onClick);
    } else {
      c.setAlpha(0.85);
    }
    return c;
  }

  // ===== 遮罩队列：战利品 → 天赋 依次弹出 =====
  _pumpOverlays() {
    if (this.talentOverlay.visible || this.lootOverlay.visible) return;
    const o = this._overlayQueue.shift();
    if (!o) return;
    if (o.kind === 'loot') this._showLootChoice(o.opts);
    else this._showTalentChoice();
  }

  _closeChoice() {
    // 恢复到玩家手动暂停状态（若之前没手动暂停则继续游戏）
    this.game_.state.paused = this.game_.state.userPaused;
    this._pumpOverlays();
  }

  // 战利品三选一
  _showLootChoice(options) {
    this.game_.state.paused = true;
    this.lootOverlay.removeAll(true);
    this.lootOverlay.setVisible(true);

    const mask = this.add.rectangle(CFG.GAME_W/2, CFG.GAME_H/2, CFG.GAME_W, CFG.GAME_H, 0x000000, 0.7);
    mask.setInteractive();
    this.lootOverlay.add(mask);

    const title = this._text(CFG.GAME_W/2, 100, '选择战利品', 32, PALETTE.gold, 'bold', 'center');
    title.setOrigin(0.5);
    this.lootOverlay.add(title);
    const sub = this._text(CFG.GAME_W/2, 140, '三选一放入待放置栏，不满意可花金币重掷', 14, 0xc9b8e8, 'normal', 'center');
    sub.setOrigin(0.5);
    this.lootOverlay.add(sub);

    const cardW = 220, cardH = 260, gap = 30;
    const totalW = cardW * 3 + gap * 2;
    const startX = (CFG.GAME_W - totalW) / 2;
    const cardY = 200;
    const starColor = { 1: 0x8fd98f, 2: 0x6ec8e8, 3: 0xc9a0ff };

    options.forEach((opt, i) => {
      const cx = startX + i * (cardW + gap);
      const card = this.add.container(cx, cardY);
      const def = TOWER_TYPES[opt.type];
      const color = starColor[opt.star];

      const bg = this.add.rectangle(cardW/2, cardH/2, cardW, cardH, PALETTE.panelLight, 1);
      bg.setStrokeStyle(3, color, 0.9);
      card.add(bg);

      const spr = this.add.image(cardW/2, 84, `tower_${opt.type}_${opt.star}`).setScale(1.7 * CFG.IS);
      card.add(spr);

      const name = this._text(cardW/2, 156, `${def.name} ${'★'.repeat(opt.star)}`, 20, color, 'bold', 'center');
      name.setOrigin(0.5);
      card.add(name);

      const desc = this._text(cardW/2, 190, def.desc, 14, 0xffffff, 'normal', 'center');
      desc.setOrigin(0.5, 0);
      desc.setWordWrapWidth(cardW - 30);
      card.add(desc);

      card.setSize(cardW, cardH);
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerover', () => { bg.setFillStyle(0x7a5a9a, 1); card.setScale(1.05); });
      bg.on('pointerout', () => { bg.setFillStyle(PALETTE.panelLight, 1); card.setScale(1); });
      bg.on('pointerdown', () => {
        this.game_.takeLoot(opt);
        this.lootOverlay.setVisible(false);
        this.txtHint.setText(`获得战利品：${def.name} ${'★'.repeat(opt.star)}`);
        this._closeChoice();
      });
      this.lootOverlay.add(card);
    });

    const rerollBtn = this._makeButton(CFG.GAME_W/2 - 80, 500, 160, 40, '重掷 (25金)', 0x6ec8e8, () => {
      const next = this.game_.rerollLoot();
      if (next) {
        this._showLootChoice(next);
      } else {
        this.txtHint.setText('金币不足，无法重掷！');
      }
    }, false);
    this.lootOverlay.add(rerollBtn);
  }

  _showTalentChoice() {
    this.game_.state.paused = true;
    this.talentOverlay.removeAll(true);
    this.talentOverlay.setVisible(true);

    const mask = this.add.rectangle(CFG.GAME_W/2, CFG.GAME_H/2, CFG.GAME_W, CFG.GAME_H, 0x000000, 0.7);
    mask.setInteractive();
    this.talentOverlay.add(mask);

    const title = this._text(CFG.GAME_W/2, 100, '✨ 选择天赋 ✨', 32, PALETTE.gold, 'bold', 'center');
    title.setOrigin(0.5);
    this.talentOverlay.add(title);

    const sub = this._text(CFG.GAME_W/2, 140, '三选一，本局永久生效', 14, 0xc9b8e8, 'normal', 'center');
    sub.setOrigin(0.5);
    this.talentOverlay.add(sub);

    // 按稀有度权重抽取 3 个不重复天赋（已拿过的不可叠加天赋不再出现）
    const taken = new Set(this.game_.state.talents.map(t => t.id));
    const bag = TALENTS.filter(t => t.stack || !taken.has(t.id));
    const picks = [];
    for (let i = 0; i < 3 && bag.length; i++) {
      const total = bag.reduce((s, t) => s + RARITY[t.rarity].weight, 0);
      let r = Math.random() * total;
      let idx = 0;
      for (let j = 0; j < bag.length; j++) {
        r -= RARITY[bag[j].rarity].weight;
        if (r <= 0) { idx = j; break; }
      }
      picks.push(bag.splice(idx, 1)[0]);
    }
    if (picks.length === 0) {
      this.talentOverlay.setVisible(false);
      this._closeChoice();
      return;
    }

    const cardW = 220, cardH = 260, gap = 30;
    const totalW = cardW * 3 + gap * 2;
    const startX = (CFG.GAME_W - totalW) / 2;
    const cardY = 200;

    picks.forEach((talent) => {
      const i = picks.indexOf(talent);
      const cx = startX + i * (cardW + gap);
      const card = this.add.container(cx, cardY);
      const rar = RARITY[talent.rarity];

      const bg = this.add.rectangle(cardW/2, cardH/2, cardW, cardH, PALETTE.panelLight, 1);
      bg.setStrokeStyle(3, rar.color, 0.9);
      card.add(bg);

      const rarLabel = this._text(cardW - 14, 16, rar.name, 12, rar.color, 'bold', 'right');
      rarLabel.setOrigin(1, 0.5);
      card.add(rarLabel);

      const icon = this.add.graphics();
      icon.fillStyle(rar.color, 1);
      icon.fillCircle(cardW/2, 66, 30);
      icon.lineStyle(3, PALETTE.ink, 1);
      icon.strokeCircle(cardW/2, 66, 30);
      card.add(icon);
      const sym = this._text(cardW/2, 66, talent.icon, 28, PALETTE.ink, 'bold', 'center');
      sym.setOrigin(0.5);
      card.add(sym);

      const name = this._text(cardW/2, 116, talent.name, 20, PALETTE.gold, 'bold', 'center');
      name.setOrigin(0.5);
      card.add(name);

      const desc = this._text(cardW/2, 152, talent.desc, 14, 0xffffff, 'normal', 'center');
      desc.setOrigin(0.5, 0);
      desc.setWordWrapWidth(cardW - 30);
      card.add(desc);

      card.setSize(cardW, cardH);
      // 交互绑在 bg 矩形上（避免 Container hitArea 坐标系偏移问题）
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerover', () => {
        bg.setFillStyle(0x7a5a9a, 1);
        card.setScale(1.05);
      });
      bg.on('pointerout', () => {
        bg.setFillStyle(PALETTE.panelLight, 1);
        card.setScale(1);
      });
      bg.on('pointerdown', () => {
        this.game_.applyTalent(talent);
        this.talentOverlay.setVisible(false);
        this.txtHint.setText(`获得天赋：${talent.name}`);
        this._closeChoice();
      });

      this.talentOverlay.add(card);
    });
  }

  _showGameOver(info) {
    this.gameOverOverlay.removeAll(true);
    this.gameOverOverlay.setVisible(true);

    const mask = this.add.rectangle(CFG.GAME_W/2, CFG.GAME_H/2, CFG.GAME_W, CFG.GAME_H, 0x000000, 0.85);
    this.gameOverOverlay.add(mask);

    const title = this._text(CFG.GAME_W/2, 180, '💀 基地陷落 💀', 48, 0xe0554a, 'bold', 'center');
    title.setOrigin(0.5);
    this.gameOverOverlay.add(title);

    const stats = this._text(CFG.GAME_W/2, 280,
      `坚持到第 ${info.wave} 波\n击杀 ${info.kills} 个敌人 · 获得 ${info.talents.length} 个天赋`, 20, 0xffffff, 'normal', 'center');
    stats.setOrigin(0.5);
    this.gameOverOverlay.add(stats);

    if (info.talents.length) {
      const tstr = info.talents.map(t => `· ${t.name}`).join('\n');
      const tl = this._text(CFG.GAME_W/2, 360, tstr, 14, PALETTE.gold, 'normal', 'center');
      tl.setOrigin(0.5, 0);
      this.gameOverOverlay.add(tl);
    }

    const btn = this._makeButton(CFG.GAME_W/2 - 80, 500, 160, 44, '再来一局', PALETTE.gold, () => {
      this.game_.restart();
    }, false);
    this.gameOverOverlay.add(btn);
  }
}