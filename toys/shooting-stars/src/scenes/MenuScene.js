(function (ns) {
    'use strict';

    const CONFIG = ns.CONFIG;
    const PALETTE = ns.PALETTE;
    const DEPTH = ns.DEPTH;
    const SCENES = ns.SCENES;
    const utils = ns.utils;
    const ui = utils.ui;

    const CX = CONFIG.WIDTH / 2;
    const TITLE = ['流', '星', '打', '字'];
    const TITLE_COLORS = [PALETTE.starColors[0], PALETTE.starColors[2], PALETTE.starColors[3], PALETTE.starColors[4]];
    const ACTION_Y = 512;
    // 单元方案（9e）的内容预览只给样本：字表长到 75 个字（汉字 Lv5）时整串铺出来 800px+，
    // 会捅穿这一行（左起 x=28，同一高度右边就是键位行）。样本 12 个字够看出"是什么字"，
    // 真正的难度读数是前面那两个数字
    const POOL_SAMPLE = 12;

    class MenuScene extends Phaser.Scene {
        constructor() {
            super(SCENES.MENU);
        }

        // 结算页"换个难度(E)"带着刚玩的那档 / 方案 / 玩法回来预选；其余入口读持久化的
        // 菜单选择（9b，menu 键），刷新与回菜单都恢复上次所选的玩法 × 方案
        init(data) {
            this.incoming = data || {};
            this.level = ns.levelById(this.incoming.levelId);
        }

        create() {
            utils.applyRenderScale(this);
            utils.fadeIn(this);
            this.store = ns.systems.storage();
            const saved = this.store.selection();
            this.mode = ns.modeById(this.incoming.mode || saved.mode);
            // 档位管物理、方案管内容（9a）：池预览与最高分都按当前方案读
            this.scheme = ns.schemeById(this.incoming.scheme || saved.scheme);
            this.backdrop = new ns.objects.Backdrop(this, { horizon: true });
            this.panel = null;

            this.buildTitle();

            // 副标题与所有读数行先建好藏起来，标题全部落定后由 revealMenu 统一放出
            this.saveLine = ui.text(this, 28, 30, '', {
                fontSize: '11px',
                fontFamily: CONFIG.MONO,
                color: PALETTE.hudMuted
            }).setOrigin(0, 0.5).setDepth(DEPTH.hud).setAlpha(0);
            this.syncSaveLine();

            this.subtitle = ui.text(this, CX, 202, '敲落每一颗星', {
                fontSize: '15px',
                color: PALETTE.hudMuted,
                letterSpacing: 8
            }).setDepth(DEPTH.hud).setAlpha(0);

            // ui.menu 构造时就会 select 一次并回调 onChange，说明文本要先建好
            this.levelLine = ui.text(this, CX, 480, '', {
                fontSize: '13px',
                color: PALETTE.hudMuted
            }).setDepth(DEPTH.hud).setAlpha(0);
            this.modeLine = ui.text(this, CX, 543, '', {
                fontSize: '12px',
                color: PALETTE.hudMuted
            }).setDepth(DEPTH.hud).setAlpha(0);

            const preview = { fontSize: '11px', fontFamily: CONFIG.MONO, color: PALETTE.hudMuted };
            this.paramLine = ui.text(this, 28, 566, '', preview).setOrigin(0, 0.5).setDepth(DEPTH.hud).setAlpha(0);
            this.poolLine = ui.text(this, 28, 584, '', preview).setOrigin(0, 0.5).setDepth(DEPTH.hud).setAlpha(0);

            this.keysLine = ui.text(this, CONFIG.WIDTH - 28, 578, '1–5 / ↑↓ 选档   M 模式   Enter 开始   T 说明', {
                fontSize: '12px',
                fontFamily: CONFIG.MONO,
                color: PALETTE.hudMuted
            }).setOrigin(1, 0.5).setDepth(DEPTH.hud).setAlpha(0);

            // 6e 触屏降级：提示条说清"需要键盘"与降级玩法，键位行换成触屏说明。
            // 入场部件 create 时就藏好（同其余读数行），revealMenu 统一放出。
            // 提示条写"下一个键"而不是"字母"（9e）：单元方案的星面上没有字母，
            // 而 ui.badge 的底衬是按建时文本量的、事后改不了字——这一条必须对两种方案都真。
            // 底部键位行能跟着换方案，那句在 setLevel 里按 level.units 改口
            this.touch = utils.touchDevice();
            this.touchHint = null;
            if (this.touch) {
                this.touchHint = ui.badge(this, CX, 66, '本游戏需要键盘 · 触屏降级：点星星 = 敲它的下一个键', PALETTE.warning)
                    .setDepth(DEPTH.hud).setAlpha(0);
            }

            // 先建五档再建动作排：syncSelection 要往五档按钮上刷当前选择的最高分
            this.buildLevels();
            this.buildActions();
        }

        // 五档就是五个按钮：选中即高亮，Enter / 点击带着当前模式进游戏（2b 定的"选档即开局"）
        buildLevels() {
            this.bests = this.store.bestMap();
            const items = ns.LEVELS.map((level) => ({
                level: level,
                label: 'Lv' + level.id + ' ' + level.name,
                meta: this.bestLabel(level.id),
                hint: String(level.id),
                accent: level.accent,
                onSelect: () => this.startGame(level.id)
            }));

            this.menu = ui.menu(this, items, {
                x: CX,
                y: 240,
                width: 360,
                height: 42,
                gap: 8,
                onChange: (item) => this.setLevel(item.level),
                onKey: (event, api) => this.onMenuKey(event, api)
            });
            this.menu.buttons.forEach((button) => button.setDepth(DEPTH.hud).setAlpha(0));
            this.menu.select(ns.LEVELS.indexOf(this.level));
        }

        // 9b：两个模式按钮收成一枚「模式」，标签直接写当前选择（玩法 × 方案在弹层里选）。
        // 五档按钮留在菜单、选档即开局不变
        buildActions() {
            const specs = [{
                label: '模式',
                hint: 'M',
                width: 210,
                accent: PALETTE.starColors[5],
                onSelect: () => this.openModePanel()
            }, {
                label: '玩法说明',
                hint: 'T',
                width: 136,
                accent: PALETTE.starColors[3],
                onSelect: () => this.openTutorial()
            }, {
                label: '设置',
                hint: 'O',
                width: 96,
                accent: PALETTE.info,
                onSelect: () => this.openSettings()
            }, {
                label: '最高分面板',
                hint: 'B',
                width: 150,
                accent: PALETTE.gold,
                onSelect: () => this.openScores()
            }];

            const gap = 14;
            const total = specs.reduce((sum, spec) => sum + spec.width, 0) + gap * (specs.length - 1);
            let left = (CONFIG.WIDTH - total) / 2;

            this.actions = specs.map((spec) => {
                const width = spec.width;
                const button = ui.button(this, {
                    x: left + width / 2,
                    y: ACTION_Y,
                    width: width,
                    height: 34,
                    fontSize: '14px',
                    padX: 16,
                    label: spec.label,
                    hint: spec.hint,
                    accent: spec.accent,
                    onSelect: spec.onSelect
                }).setDepth(DEPTH.hud).setAlpha(0);
                left += width + gap;
                return button;
            });
            this.modeButton = this.actions[0];
            this.syncSelection();
        }

        // 数字键 1–5 是五档按钮的快选，走 menu.select 而不是绕开高亮直接改状态（选中音在那边响）。
        // 下面这几条快捷键绕开了按钮，所以自己补一声：T / O / B / M 都是"确认打开"
        onMenuKey(event, api) {
            if (event.code.startsWith('Digit')) {
                const id = Number(event.code.slice(5));
                if (id >= 1 && id <= ns.LEVELS.length) { api.select(id - 1); }
                return;
            }
            const audio = ns.systems.audio();
            switch (event.code) {
                case 'KeyM':
                    audio.play('uiOn');
                    this.openModePanel();
                    break;
                case 'KeyT':
                    audio.play('uiOn');
                    this.openTutorial();
                    break;
                case 'KeyO':
                    audio.play('uiOn');
                    this.openSettings();
                    break;
                case 'KeyB':
                    audio.play('uiOn');
                    this.openScores();
                    break;
            }
        }

        setLevel(level) {
            this.level = level;
            const react = ((CONFIG.HORIZON_Y - CONFIG.SPAWN_Y) / level.speed).toFixed(1);
            // 特殊星清单读合成档位的 specials（9d）：与局内同一份 levelFor，线连双星仅标准方案，
            // 专练方案这里就不会列出双星。名字仍读类型表（5e 收编），加类型只添表行
            const composed = ns.levelFor(this.scheme.id, level.id);
            const specials = composed.specials.length
                ? composed.specials.map((id) => ns.starType(id).name).join(' / ') +
                    (level.specialBoost > 1 ? ' · 权重 ×' + level.specialBoost : '')
                : '无特殊星';

            this.levelLine.setText('反应窗口 ' + react + 's · 特殊星 ' + specials);
            this.paramLine.setText('Lv' + level.id + ' ' + level.name + ' · ' + level.speed + 'px/s · 间隔 ' +
                level.spawnInterval + 'ms · 上限 ' + level.maxOnScreen + ' · 命 ' + level.lives +
                ' · 字号 ' + level.fontSize + ' · 描边 ' + level.stroke);
            // 内容预览读当前方案的内容梯度表（9a）：档位只管物理，"出什么内容"归方案。
            // 单元方案（9e）这一行读字表并给键序长度范围——星面上不显示键，
            // 玩家只从这一行知道这一档要打几键；样本截断的理由见 POOL_SAMPLE
            const pool = composed.pool;
            if (composed.units) {
                const lengths = composed.units.list.map((unit) => unit.keys.length);
                this.poolLine.setText('字表 ' + pool.length + ' · 键序 ' + Math.min.apply(null, lengths) +
                    '–' + Math.max.apply(null, lengths) + ' 键 · ' +
                    pool.slice(0, POOL_SAMPLE) + (pool.length > POOL_SAMPLE ? '…' : ''));
            } else {
                this.poolLine.setText('池 ' + pool.length + ' · ' + pool);
            }
            // 触屏键位行（6e）按方案改口（9e）：单元方案的星面上没有字母，
            // "敲它的字母"对它是假话。判据仍是 level.units 那一条
            if (this.touch) {
                this.keysLine.setText(composed.units
                    ? '点星星 = 敲它的下一个键 · 白圈指着会掉的那颗'
                    : '点星星 = 敲它的字母 · 白圈指着会掉的那颗');
            }
        }

        // 玩法 / 方案改动都走这两处：持久化（9b，刷新保留）+ 菜单读数整排同步。
        // 弹层里选完不关面板，底下这些读数实时跟着换
        setMode(id) {
            this.mode = ns.modeById(id);
            this.store.saveSelection(this.mode.id, this.scheme.id);
            this.syncSelection();
        }

        setScheme(id) {
            this.scheme = ns.schemeById(id);
            this.store.saveSelection(this.mode.id, this.scheme.id);
            this.syncSelection();
        }

        syncSelection() {
            this.modeButton.setLabel('模式：' + this.scheme.name + ' · ' + this.mode.name);
            this.syncBests();
            // 池预览读当前方案的内容梯度表（9a）：换方案要整行换掉
            this.setLevel(this.level);
            // 无尽那条把爬升曲线（harness/gameplay.md）直接写在菜单上，数字全部读 CONFIG.CLIMB，调表这里跟着变
            this.modeLine.setText(this.scheme.name + '方案 · ' + this.mode.name + ' · ' + this.mode.desc + (this.mode.climb
                ? ' · 每 ' + CONFIG.CLIMB.every + ' 次击落：下落 ×' + CONFIG.CLIMB.speedMul +
                    '、间隔 ×' + CONFIG.CLIMB.intervalMul + '，封顶 ' + CONFIG.CLIMB.speedCap + '× / ' + CONFIG.CLIMB.intervalFloor + '×'
                : ''));
        }

        startGame(levelId) {
            utils.fadeTo(this, SCENES.GAME, { levelId: levelId, scheme: this.scheme.id, mode: this.mode.id, runIndex: 1 });
        }

        // 最高分按「方案 × 玩法 × 档位」分开记（9a），所以翻模式要把五档的读数整排换掉
        syncBests() {
            this.bests = this.store.bestMap();
            this.menu.buttons.forEach((button, index) => button.setMeta(this.bestLabel(ns.LEVELS[index].id)));
        }

        bestLabel(levelId) {
            const best = this.bests[ns.systems.Storage.bestKey(this.scheme.id, levelId, this.mode.id)] || 0;
            return best > 0 ? '最高 ' + best : '暂无记录';
        }

        // 存档不可用要说在明处：否则刷新后最高分清零会被当成 bug
        syncSaveLine() {
            if (!this.store.available) {
                this.saveLine.setColor(PALETTE.warning).setText('本地存档不可用 · 记录只在本页有效，刷新即清零');
                return;
            }
            const totals = this.store.totals();
            this.saveLine.setColor(PALETTE.hudMuted).setText('本地存档 · 累计 ' + totals.runs + ' 局 · 击落 ' +
                totals.hits + ' · 最高连击 ' + totals.maxCombo);
        }

        openTutorial() {
            utils.fadeTo(this, SCENES.TUTORIAL, { levelId: this.level.id });
        }

        // 9b：玩法 × 方案一个弹层搞定，交互与设置面板同款——↑↓ 换行循环、Enter / 空格确认、
        // 悬停同步选中行、Esc 关闭；选完不关弹层（可连续调），菜单标签 / 池预览 / 各档最高分
        // 在底下实时跟着换（setMode / setScheme 里同步 + 持久化）。方案节由 SCHEMES 注册表驱动：
        // 加方案 = 添表行，这里自动多一行。当前选择写进文字（"（当前）"）不只靠高亮，
        // 高亮留给键盘选中行——与设置面板同一条纪律
        openModePanel() {
            const audio = ns.systems.audio();
            // 9h：弹层只列基础方案（组合按 combo 标志过滤）——行数不变几何不动，
            // 字母 / 数字 / 符号三行是多选 toggle，其余行单选，互斥逻辑全在 toggleScheme
            const baseSchemes = ns.SCHEMES.filter((scheme) => !scheme.combo);
            let modeButtons = [];
            let schemeButtons = [];
            let rows = [];
            let current = 0;

            const sync = () => {
                modeButtons.forEach((entry) => {
                    entry.button.setLabel(entry.mode.name + '模式' +
                        (entry.mode.id === this.mode.id ? '（当前）' : ''));
                });
                const selected = this.scheme.combo ? this.scheme.id.split('+') : [this.scheme.id];
                schemeButtons.forEach((entry) => {
                    const id = entry.scheme.id;
                    const mark = ns.COMBO_MEMBERS.includes(id)
                        ? (selected.includes(id) ? '（已选）' : '')
                        : (id === this.scheme.id ? '（当前）' : '');
                    entry.button.setLabel(entry.scheme.name + '方案' + mark);
                });
            };
            const paint = () => {
                rows.forEach((row, index) => row.buttons.forEach((button) => button.setSelected(index === current)));
            };
            const select = (index) => {
                const next = ((index % rows.length) + rows.length) % rows.length;
                if (next === current) { return; }
                current = next;
                paint();
                audio.play('uiMove');
            };

            this.openPanel(() => {
                // 行数随注册表增长，几何按行数推：玩法节两行 + 方案节 N 行 + 关闭。
                // 行距不是常量——9e 起注册表里是五个方案（七行），恒 44 会把卡片底边推到 602
                // 捅穿画布（关闭按钮落在 566–606，被裁掉且点不到）。可用行高 = 画布高
                // − 底边余量 − 行块起点 − 行块之后那三段固定开销（方案节标题 30 / 提示到关闭 36 /
                // 关闭到卡片底边 30）；六行（9d 的四方案）算出 47 ⇒ 取上限 44，那一版逐像素不变
                const rowCount = ns.MODES.length + baseSchemes.length;
                const rowStep = Math.min(44,
                    Math.floor((CONFIG.HEIGHT - 8 - 212 - (30 + 36 + 30)) / rowCount));
                const rowHeight = Math.min(36, rowStep - 6);
                let y = 212;
                const modeYs = ns.MODES.map(() => { const at = y; y += rowStep; return at; });
                const schemeHeaderY = y;
                y += 30;
                const schemeYs = baseSchemes.map(() => { const at = y; y += rowStep; return at; });
                const hintY = y + 2;
                const closeY = y + 36;
                const cardTop = 124;
                const cardBottom = closeY + 30;

                const parts = [
                    ui.card(this, CX, (cardTop + cardBottom) / 2, 420, cardBottom - cardTop,
                        { fill: PALETTE.overlay, fillAlpha: 0.94 }),
                    ui.text(this, CX, 150, '模式', {
                        fontSize: '24px', fontStyle: '700', color: PALETTE.starColors[5], letterSpacing: 6
                    }),
                    ui.text(this, CX, 184, '玩法', { fontSize: '11px', color: PALETTE.hudMuted, letterSpacing: 2 })
                ];
                modeButtons = ns.MODES.map((mode, index) => {
                    const button = ui.button(this, {
                        x: CX, y: modeYs[index], width: 344, height: rowHeight,
                        label: '', fontSize: '15px',
                        accent: mode.climb ? PALETTE.starColors[5] : PALETTE.info,
                        onSelect: () => { this.setMode(mode.id); sync(); }
                    });
                    parts.push(button);
                    return { mode: mode, button: button };
                });
                parts.push(ui.text(this, CX, schemeHeaderY, '方案', {
                    fontSize: '11px', color: PALETTE.hudMuted, letterSpacing: 2
                }));
                schemeButtons = baseSchemes.map((scheme, index) => {
                    const button = ui.button(this, {
                        x: CX, y: schemeYs[index], width: 344, height: rowHeight,
                        label: '', fontSize: '15px', meta: scheme.desc, accent: PALETTE.gold,
                        onSelect: () => { this.setScheme(ns.toggleScheme(this.scheme.id, scheme.id)); sync(); }
                    });
                    parts.push(button);
                    return { scheme: scheme, button: button };
                });
                parts.push(ui.text(this, CX, hintY, '↑↓ 选择 · Enter 确认 · Esc 关闭', {
                    fontSize: '11px', fontFamily: CONFIG.MONO, color: PALETTE.hudMuted
                }));
                const closeButton = this.panelCloseButton(closeY);
                parts.push(closeButton);

                rows = modeButtons.concat(schemeButtons).map((entry) => ({
                    buttons: [entry.button], activate: () => entry.button.flash()
                })).concat([{ buttons: [closeButton], activate: () => closeButton.flash() }]);
                rows.forEach((row, index) => {
                    row.buttons.forEach((button) => button.on('pointerover', () => select(index)));
                });
                current = 0;
                paint();
                sync();
                return parts;
            }, (event) => {
                switch (event.code) {
                    case 'ArrowUp':
                        select(current - 1);
                        return true;
                    case 'ArrowDown':
                        select(current + 1);
                        return true;
                    case 'Enter':
                    case 'NumpadEnter':
                    case 'Space': {
                        const activate = rows[current].activate;
                        if (activate) { activate(); }
                        return true;
                    }
                }
                return false;
            });
        }

        buildTitle() {
            const spacing = 86;
            const startX = CX - spacing * (TITLE.length - 1) / 2;

            const glyphs = TITLE.map((char, index) => {
                const color = TITLE_COLORS[index];
                const x = startX + index * spacing;
                const y = 148;
                const glow = this.add.image(0, 4, 'glow').setTint(ns.tint(color)).setScale(1.15).setAlpha(0.4);
                const text = ui.text(this, 0, 0, char, {
                    fontSize: '62px',
                    fontStyle: '700',
                    color: color,
                    shadow: { offsetX: 0, offsetY: 4, color: PALETTE.skyTop, blur: 16, fill: true }
                });
                return this.add.container(x, y, [glow, text]).setDepth(DEPTH.hud);
            });

            let landed = 0;
            utils.meteorIn(this, glyphs, {
                colors: TITLE_COLORS,
                // 6b 的标题上行音阶：一字一音，音名与次序都由 meteorIn 按落定顺序喂进去
                tone: 'title',
                onLand: (index) => {
                    // 浮动从落地后才起，不与划落抢 y
                    this.tweens.add({
                        targets: glyphs[index],
                        y: glyphs[index].y - 5,
                        duration: 2300 + index * 220,
                        delay: CONFIG.METEOR_SQUASH_MS,
                        yoyo: true,
                        repeat: -1,
                        ease: 'Sine.easeInOut'
                    });
                    landed += 1;
                    if (landed === glyphs.length) {
                        this.time.delayedCall(CONFIG.MENU_REVEAL_DELAY_MS, () => this.revealMenu());
                    }
                }
            });
        }

        // 6.2：全部落定 300ms 后副标题浮起，五档与动作排依次从左侧滑入，读数行随后淡入
        revealMenu() {
            utils.riseIn(this, this.subtitle, { distance: CONFIG.MENU_SUBTITLE_RISE });
            const stagger = CONFIG.MENU_SLIDE_STAGGER_MS;
            utils.slideIn(this, this.menu.buttons, { delay: 140, stagger: stagger });
            const actionsDelay = 140 + this.menu.buttons.length * stagger + 80;
            utils.slideIn(this, this.actions, { delay: actionsDelay, stagger: stagger });
            const lines = [
                [this.levelLine, 1], [this.saveLine, 1], [this.modeLine, 0.75],
                [this.paramLine, 0.95], [this.poolLine, 0.7], [this.keysLine, 0.8]
            ];
            if (this.touchHint) { lines.push([this.touchHint, 1]); }
            lines.forEach(([target, alpha], index) => {
                this.tweens.add({ targets: target, alpha: alpha, duration: 380, delay: actionsDelay + index * 40 });
            });
        }

        // 6c：四开关齐了——音量 / 静音（AudioSys 委托 Settings）/ 减少动效 / 严格模式，全部持久化。
        // 键盘全程可达：↑↓ 换行、Enter / 空格切换选中行、←→ 音量（仅音量行）、M 全局静音、Esc 关闭；
        // 指针悬停同步选中行。行导航不另挂 bindKeys——openPanel 的 extraKeys 随面板关一起摘，
        // 反复开关不会攒监听（ui.menu 没有 destroy，用在这里会踩 shutdown 不清监听的坑）
        openSettings() {
            const audio = ns.systems.audio();
            const settings = ns.systems.settings();
            let muteButton = null;
            let motionButton = null;
            let strictButton = null;
            let volumeText = null;
            let rows = [];
            let current = 0;

            const sync = () => {
                muteButton.setLabel(audio.muted ? '静音：开' : '静音：关');
                volumeText.setText('音量 ' + Math.round(audio.volume * 100) + '%');
                // 6d：标签写生效值（设置 ∨ 系统偏好）。系统开着时拨到关也仍是开，
                // 标注"跟随系统"说清为什么关不掉，而不是让开关看起来失灵
                motionButton.setLabel('减少动效：' + (utils.reducedMotion() ? '开' : '关') +
                    (utils.systemReducedMotion() ? '（跟随系统）' : ''));
                strictButton.setLabel('严格模式：' + (settings.strict ? '开' : '关') +
                    ' · 按错 −' + CONFIG.STRICT_MISS_PENALTY + ' 分');
            };
            // 6b：音量 / 静音的音放在**改完之后**播，面板于是自己演示自己——按下静音那一下 play 直接被
            // muted 挡掉（静音就是静音，不该还响一声），解除静音才听得到确认音；音量步进那声轻音
            // 就是新音量下的响度。所以这三枚按钮都传 sound: null，不然会和这里各响一次
            const toggleMute = () => { audio.setMuted(!audio.muted); sync(); audio.play('uiOn'); };
            // 先乘 10 取整再除回：0.1 步长连按不攒浮点残渣（80% → 70.00000001% 这类读数）
            const stepVolume = (dir) => {
                audio.setVolume(Math.round((audio.volume + dir * CONFIG.AUDIO.volumeStep) * 10) / 10);
                sync();
                audio.play('uiMove');
            };
            // 这两个开关走按钮缺省确认音（activate 里响），动作本身不再补声
            const toggleMotion = () => { settings.set('reducedMotion', !settings.reducedMotion); sync(); };
            const toggleStrict = () => { settings.set('strict', !settings.strict); sync(); };

            const paint = () => {
                rows.forEach((row, index) => row.buttons.forEach((button) => button.setSelected(index === current)));
            };
            const select = (index) => {
                const next = ((index % rows.length) + rows.length) % rows.length;
                if (next === current) { return; }
                current = next;
                paint();
                audio.play('uiMove');
            };

            this.openPanel(() => {
                const parts = [
                    ui.card(this, CX, 300, 420, 332, { fill: PALETTE.overlay, fillAlpha: 0.94 }),
                    ui.text(this, CX, 158, '设置', {
                        fontSize: '24px', fontStyle: '700', color: PALETTE.info, letterSpacing: 6
                    })
                ];
                muteButton = ui.button(this, {
                    x: CX, y: 196, width: 344, height: 36,
                    label: '', hint: 'M', accent: PALETTE.info, sound: null, onSelect: toggleMute
                });
                parts.push(muteButton);
                const minusButton = ui.button(this, {
                    x: CX - 120, y: 242, width: 56, height: 36,
                    label: '−', accent: PALETTE.info, sound: null, onSelect: () => stepVolume(-1)
                });
                volumeText = ui.text(this, CX, 242, '', { fontSize: '15px', fontFamily: CONFIG.MONO });
                const plusButton = ui.button(this, {
                    x: CX + 120, y: 242, width: 56, height: 36,
                    label: '+', accent: PALETTE.info, sound: null, onSelect: () => stepVolume(1)
                });
                parts.push(minusButton, volumeText, plusButton);
                motionButton = ui.button(this, {
                    x: CX, y: 288, width: 344, height: 36,
                    label: '', accent: PALETTE.info, onSelect: toggleMotion
                });
                parts.push(motionButton);
                strictButton = ui.button(this, {
                    x: CX, y: 334, width: 344, height: 36,
                    label: '', accent: PALETTE.warning, onSelect: toggleStrict
                });
                parts.push(strictButton);
                parts.push(ui.text(this, CX, 372, '↑↓ 选择 · Enter 切换 · ←→ 音量 · M 静音 · Esc 关闭', {
                    fontSize: '11px', fontFamily: CONFIG.MONO, color: PALETTE.hudMuted
                }));
                const closeButton = this.panelCloseButton(414);
                parts.push(closeButton);

                // 音量行没有"切换"可言，Enter 落在它上面不动作，←→ 才是它的键
                rows = [
                    { buttons: [muteButton], activate: () => muteButton.flash() },
                    { buttons: [minusButton, plusButton], activate: null, volume: true },
                    { buttons: [motionButton], activate: () => motionButton.flash() },
                    { buttons: [strictButton], activate: () => strictButton.flash() },
                    { buttons: [closeButton], activate: () => closeButton.flash() }
                ];
                rows.forEach((row, index) => {
                    row.buttons.forEach((button) => button.on('pointerover', () => select(index)));
                });
                current = 0;
                paint();
                sync();
                return parts;
            }, (event) => {
                switch (event.code) {
                    case 'KeyM':
                        toggleMute();
                        return true;
                    case 'ArrowUp':
                        select(current - 1);
                        return true;
                    case 'ArrowDown':
                        select(current + 1);
                        return true;
                    case 'ArrowLeft':
                        if (rows[current].volume) { stepVolume(-1); }
                        return true;
                    case 'ArrowRight':
                        if (rows[current].volume) { stepVolume(1); }
                        return true;
                    case 'Enter':
                    case 'NumpadEnter':
                    case 'Space': {
                        const activate = rows[current].activate;
                        if (activate) { activate(); }
                        return true;
                    }
                }
                return false;
            });
        }

        // 9b：排行榜按方案分栏——顶部一排方案页签（注册表驱动，默认停在当前方案），
        // 栏内是该方案的「玩法 × 档位」记录表。跨方案分数不并列比较、不做归一化总榜：
        // 内容不同的方案分数没有可比性。页签点选 / 悬停 / ←→ 都走 setTab，选中项真的换了才响
        openScores() {
            // 9h：页签维持基础方案，组合不列（10 页签单行放不下，harness/ui.md 排行榜节）；
            // 组合记录不丢——菜单各档最高分与结算页按当前方案照常读组合记录线
            const schemes = ns.SCHEMES.filter((scheme) => !scheme.combo);
            let tab = Math.max(0, schemes.findIndex((scheme) => scheme.id === this.scheme.id));
            let setTab = () => {};

            this.openPanel(() => {
                const audio = ns.systems.audio();
                const bests = this.store.bestMap();
                const mono = { fontFamily: CONFIG.MONO };
                const parts = [
                    ui.card(this, CX, 300, 460, 408, { fill: PALETTE.overlay, fillAlpha: 0.94 }),
                    ui.text(this, CX, 132, '最高分', {
                        fontSize: '24px', fontStyle: '700', color: PALETTE.gold, letterSpacing: 6
                    }),
                    ui.text(this, CX, 160, '按方案分栏 · 栏内按 玩法 × 档位 分开记录', { fontSize: '12px', color: PALETTE.hudMuted })
                ];

                const tabWidth = Math.min(150, Math.floor((420 - 10 * (schemes.length - 1)) / schemes.length));
                const tabTotal = schemes.length * tabWidth + 10 * (schemes.length - 1);
                const tabButtons = schemes.map((scheme, index) => {
                    const button = ui.button(this, {
                        x: CX - tabTotal / 2 + tabWidth / 2 + index * (tabWidth + 10),
                        y: 192, width: tabWidth, height: 30,
                        label: scheme.name + '方案', fontSize: '13px', padX: 12,
                        accent: PALETTE.gold, sound: null,
                        onSelect: () => setTab(index)
                    });
                    button.on('pointerover', () => setTab(index));
                    parts.push(button);
                    return button;
                });

                parts.push(ui.text(this, 220, 226, '难度', { fontSize: '11px', color: PALETTE.hudMuted }).setOrigin(0, 0.5));
                const colX = [CX + 60, CX + 160];
                ns.MODES.forEach((mode, index) => {
                    parts.push(ui.text(this, colX[index], 226, mode.name, {
                        fontSize: '13px',
                        color: mode.id === this.mode.id ? PALETTE.gold : PALETTE.hudMuted
                    }));
                });
                const cells = ns.LEVELS.map((level, row) => {
                    const y = 256 + row * 32;
                    parts.push(ui.text(this, 220, y, 'Lv' + level.id + ' ' + level.name, {
                        fontSize: '14px', color: level.accent
                    }).setOrigin(0, 0.5));
                    return ns.MODES.map((mode, index) => {
                        const cell = ui.text(this, colX[index], y, '–', Object.assign({
                            fontSize: '15px', color: PALETTE.hudMuted
                        }, mono));
                        parts.push(cell);
                        return cell;
                    });
                });

                const totals = this.store.totals();
                parts.push(ui.text(this, CX, 408, '累计 ' + totals.runs + ' 局 · 击落 ' + totals.hits +
                    ' · 最高连击 ' + totals.maxCombo, Object.assign({ fontSize: '12px', color: PALETTE.hudMuted }, mono)));
                parts.push(ui.text(this, CX, 428, schemes.length > 1 ? '←→ 换方案 · Esc 关闭' : 'Esc 关闭', {
                    fontSize: '11px', fontFamily: CONFIG.MONO, color: PALETTE.hudMuted
                }));
                if (!this.store.available) {
                    parts.push(ui.text(this, CX, 446, '本地存档不可用 · 以上记录刷新即清零', {
                        fontSize: '12px', color: PALETTE.warning
                    }));
                }
                parts.push(this.panelCloseButton(472));

                const sync = () => {
                    tabButtons.forEach((button, index) => button.setSelected(index === tab));
                    const scheme = schemes[tab];
                    cells.forEach((rowCells, levelIndex) => rowCells.forEach((cell, modeIndex) => {
                        const best = bests[ns.systems.Storage.bestKey(scheme.id, ns.LEVELS[levelIndex].id, ns.MODES[modeIndex].id)] || 0;
                        cell.setText(best > 0 ? String(best) : '–')
                            .setColor(best > 0 ? PALETTE.hudText : PALETTE.hudMuted);
                    }));
                };
                setTab = (index) => {
                    const next = ((index % schemes.length) + schemes.length) % schemes.length;
                    if (next === tab) { return; }
                    tab = next;
                    sync();
                    audio.play('uiMove');
                };
                sync();
                return parts;
            }, (event) => {
                switch (event.code) {
                    case 'ArrowLeft':
                        setTab(tab - 1);
                        return true;
                    case 'ArrowRight':
                        setTab(tab + 1);
                        return true;
                }
                return false;
            });
        }

        panelCloseButton(y) {
            return ui.button(this, {
                x: CX, y: y, width: 344, height: 40,
                label: '关闭', hint: 'Esc', accent: PALETTE.info, sound: 'uiBack',
                onSelect: () => this.closePanel()
            });
        }

        // 模态面板：全屏遮罩挡住底下按钮的指针（topOnly），menu.setEnabled(false) 停掉键盘与 hover。
        // extraKeys 是面板自己的快捷键（设置面板的 M / ↑↓），返回 true 表示吃掉，不再走 Esc/Enter 关闭
        openPanel(build, extraKeys) {
            if (this.panel) { return; }
            this.menu.setEnabled(false);
            const scrim = this.add.rectangle(CX, CONFIG.HEIGHT / 2, CONFIG.WIDTH, CONFIG.HEIGHT, ns.tint(PALETTE.scrim), 0)
                .setDepth(DEPTH.overlay)
                .setInteractive();
            this.tweens.add({ targets: scrim, fillAlpha: 0.72, duration: 180, ease: 'Quad.easeOut' });
            const parts = build();
            const layer = this.add.container(0, 0, parts).setDepth(DEPTH.panel);
            utils.riseIn(this, parts, { stagger: 22, distance: 12, duration: 300 });
            const onKey = (event) => {
                if (event.repeat || this._ssFading) { return; }
                if (extraKeys && extraKeys(event)) { return; }
                if (event.code === 'Escape' || event.code === 'Enter' || event.code === 'NumpadEnter') {
                    // 走键盘关面板时按钮那一声（uiBack）响不到，这里补上，两条路径听起来一样
                    ns.systems.audio().play('uiBack');
                    this.closePanel();
                }
            };
            this.input.keyboard.on('keydown', onKey);
            this.panel = { scrim: scrim, layer: layer, onKey: onKey, closing: false };
        }

        closePanel() {
            const panel = this.panel;
            if (!panel || panel.closing) { return; }
            panel.closing = true;
            this.input.keyboard.off('keydown', panel.onKey);
            this.tweens.add({ targets: panel.layer, alpha: 0, duration: 150, ease: 'Quad.easeIn' });
            this.tweens.add({
                targets: panel.scrim,
                fillAlpha: 0,
                duration: 150,
                ease: 'Quad.easeIn',
                onComplete: () => {
                    panel.scrim.destroy();
                    panel.layer.destroy();
                    this.panel = null;
                    this.menu.setEnabled(true);
                }
            });
        }

        // 装饰流星的位移每帧推一次；星点闪烁与地平线脉冲在 Backdrop 自己的批量 timer 里
        update(time, delta) {
            this.backdrop.update(Math.min(delta, CONFIG.DELTA_MAX) / 1000);
        }
    }

    ns.scenes = ns.scenes || {};
    ns.scenes.MenuScene = MenuScene;
})(window.ShootingStars = window.ShootingStars || {});
