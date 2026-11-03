// 官方模组：疾风加速
// 通过 config 字段直接覆盖数值常量

export default {
  id: 'speed-boost',
  name: '疾风加速',
  version: '1.0.0',
  description: '玩家移动速度提升 50%，敌人移动速度不变。',
  author: '官方',

  config: {
    PLAYER_SPEED: 90,      // 默认 60 → 90
  },

  onInit(game) {
    console.log('[疾风加速] 模组已启用，玩家速度提升 50%');
  },
};