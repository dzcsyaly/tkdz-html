// ============================================================
// js/main.js — 入口：实例化 Game + 死亡钩子 + 加载超时检测
// ============================================================

import { Game } from './game.js';
import { Tank } from './entities/tank.js';

let game = null;

try {
  game = new Game();
  const origDie = Tank.prototype.die;
  Tank.prototype.die = function () {
    const wasDead = this.dead;
    origDie.call(this);
    if (!wasDead && game) game.onTankDeath(this);
  };
  window.__game = game;
} catch (err) {
  console.error(err);
  const loading = document.getElementById('loading');
  if (loading) {
    loading.innerHTML =
      '<div style="color:#ff6666;font-size:15px;line-height:2;text-align:center;padding:20px;">' +
      '初始化失败<br><span style="font-size:12px;opacity:.7">' + String(err && err.message || err) + '</span></div>';
  }
}

setTimeout(() => {
  if (!window.__gameStarted) {
    const lt = document.getElementById('loadingText');
    if (lt) {
      lt.innerHTML = '加载超时<br><span style="font-size:12px;opacity:.7">请检查网络（需要访问 unpkg.com 获取 Three.js 和 PeerJS）</span>';
    }
  }
}, 12000);