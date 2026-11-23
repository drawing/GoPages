// 全局配置
const CFG = {
  BASE_TILE: 48,      // 数值基准 tile（射程/速度等按此设计）
  TILE: 72,           // 实际 tile，放大 1.5 倍
  MAP_COLS: 13,
  MAP_ROWS: 10,
  MAP_W: 13 * 72,     // 936
  MAP_H: 10 * 72,     // 720
  UI_W: 344,
  GAME_W: 13 * 72 + 344, // 1280（设计/世界坐标）
  GAME_H: 10 * 72,       // 720（设计/世界坐标）
};
// 像素类数值（射程/速度/弹速/溅射）的统一缩放因子，保证放大 tile 后手感不变
CFG.TS = CFG.TILE / CFG.BASE_TILE; // 1.5

// ===== 高清渲染（Retina 适配）=====
// RS = 内部渲染倍率。canvas 缓冲 = 设计尺寸 × RS，再经相机 zoom=RS 映射回设计坐标，
// 这样世界坐标(0~GAME_W)完全不变，但渲染密度翻倍，文字/图形在高分屏上清晰。
CFG.RS = 2;
CFG.IS = 1 / CFG.RS;              // 贴图精灵的补偿缩放（贴图按 RS 倍生成，精灵缩回 1/RS）
CFG.RENDER_W = CFG.GAME_W * CFG.RS; // 2560 实际 canvas 缓冲宽
CFG.RENDER_H = CFG.GAME_H * CFG.RS; // 1440 实际 canvas 缓冲高

// 颜色（卡通手绘调色板）
const PALETTE = {
  grass1: 0x8dc96a,
  grass2: 0x7ab85a,
  path:   0xd9b98a,
  pathEdge: 0xa67c52,
  buildable: 0xf5e9c9,
  buildableHover: 0xffd97a,
  ink:    0x2b1e14,
  panel:  0x3a2b46,
  panelLight: 0x5a4266,
  gold:   0xffc94a,
  hp:     0xe0554a,
  hpBg:   0x4a2020,
  disabled: 0x6a6272,
};
