// 官方模组：地狱模式
// 多项数值调整

export default {
  id: 'hard-mode',
  name: '地狱模式',
  version: '1.0.0',
  description: '敌人血量翻倍，敌方伤害翻倍，玩家血量减半。',
  author: '官方',

  config: {
    PLAYER_MAX_HP: 5000,
    ENEMY_MAX_HP: 20000,
    ENEMY_DAMAGE: 2,
    ENEMY_FIRE_CD: 0.6,
    ENEMY_SPEED: 11,
  },

  onInit(game) {
    console.log('[地狱模式] 已启用：敌人更硬、更凶、更快');
  },
};