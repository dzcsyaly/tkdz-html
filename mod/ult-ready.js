// 官方模组：大招常驻
// 展示钩子用法（onUpdate 每帧清空冷却）

export default {
  id: 'ult-ready',
  name: '大招常驻',
  version: '1.0.0',
  description: '大招冷却永远为 0，想清几次清几次。',
  author: '官方',

  onInit(game) {
    console.log('[大招常驻] 已启用');
  },

  onUpdate(game, dt) {
    if (game.player && game.ultCooldown > 0) {
      game.ultCooldown = 0;
    }
  },
};