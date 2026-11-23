// 游戏入口
const config = {
  type: Phaser.AUTO,
  // 内部渲染缓冲 = 设计尺寸 × RS（高清），再经相机 zoom=RS 映射回设计坐标
  width: CFG.RENDER_W,
  height: CFG.RENDER_H,
  parent: 'game-container',
  backgroundColor: '#1a1626',
  scene: [BootScene, GameScene, UIScene],
  physics: {
    default: 'arcade',
    arcade: { debug: false },
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  render: {
    antialias: true,
    pixelArt: false,
  },
};

const game = new Phaser.Game(config);
window.game = game; // 暴露便于调试
