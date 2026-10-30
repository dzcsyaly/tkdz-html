// ============================================================
// js/config.js — 全局常量、URL 参数、工具函数
// ============================================================

export const urlParams = new URLSearchParams(window.location.search);
export const SPLIT_INDEX = parseInt(urlParams.get('split') || '-1');
export const SPLIT_TOTAL = parseInt(urlParams.get('splitTotal') || '0');
export const IS_SPLIT_INSTANCE = SPLIT_INDEX >= 0 && SPLIT_TOTAL > 0;
export const LOW_QUALITY = urlParams.get('lowQuality') === '1';
export const SPLIT_ROOM_KEY = 'tank3d_split_room_code';
export const SPLIT_HOST_TIME_KEY = 'tank3d_split_host_time';
export const MUTE_KEY = 'tank3d_muted';

// ============ 世界常量 ============
export const WAVE_WORLD_SIZE = 600;
export const WAVE_HALF_WORLD = WAVE_WORLD_SIZE / 2;
export const WAVE_WORLD_LIMIT = WAVE_HALF_WORLD - 15;
export const ADV_TERRAIN_SIZE = 900;
export const ADV_TERRAIN_SEG = LOW_QUALITY ? 64 : 80;
export const ADV_RECENTER_THRESHOLD = 120;
export const ADV_SPAWN_RADIUS = 180;
export const ADV_SPAWN_MIN = 60;
export const ADV_MAX_ENEMIES = LOW_QUALITY ? 40 : 80;
export const ADV_POINT_CHECK_R = 8;
export const ADV_OBSTACLE_TARGET = LOW_QUALITY ? 30 : 60;
export const ADV_OBSTACLE_SPAWN_INTERVAL = 0.7;

// ============ 单位数值 ============
export const PLAYER_MAX_HP = 10000;
export const ENEMY_MAX_HP = 10000;
export const PLAYER_DAMAGE = 40 * 9e13;
export const ENEMY_DAMAGE = 1;
export const PLAYER_FIRE_CD = 0.18 / (1 + 999999 / 100);
export const ENEMY_FIRE_CD = 0.85;
export const PLAYER_SPEED = 15 * (1 + 300 / 100);
export const ENEMY_SPEED = 9.5;
export const SHELL_SPEED = 140;
export const SHELL_LIFE = 5.0;
export const TANK_HIT_RADIUS = 1.85;
export const TANK_HIT_CENTER_Y = 1.15;
export const CAM_DIST = 11.5;
export const CAM_HEIGHT = 7.2;
export const CAM_LOOK_AHEAD = 5.5;
export const MAX_ENEMIES = 8;
export const EXTRA_ENEMIES = 20;
export const TOTAL_ENEMY_CAP = Math.floor((MAX_ENEMIES + EXTRA_ENEMIES) * 3);
export const MINE_COOLDOWN = 2.5;
export const MINE_TRIGGER_R = 2.2;
export const MINE_DAMAGE = 40 * 9e13;
export const MINE_LIFE = 30;
export const MAX_MINES = 15;
export const OBSTACLE_HP = 3;
export const OBSTACLE_TARGET = 180;
export const ULT_COOLDOWN = 3.0;
export const CLIMB_SPEED = 25;
export const NET_SEND_INTERVAL = 0.06;
export const NET_ENEMY_SYNC_INTERVAL = 0.12;
export const NET_PLAYER_SYNC_INTERVAL = 0.08;
export const MAX_PLAYERS = 8;
export const PIXEL_RATIO_MAX = LOW_QUALITY ? 0.85 : 1.1;
export const PARTICLES_TOTAL = LOW_QUALITY ? 80 : 160;
export const MAX_FPS = 90;

// ============ 玩家配色 ============
export const PLAYER_COLORS = [
  { body: 0x3f7d3f, accent: 0x66ccff, name: '绿' },
  { body: 0x2f5a8a, accent: 0x88ddff, name: '蓝' },
  { body: 0x8a3a3a, accent: 0xff8888, name: '红' },
  { body: 0x6a3a8a, accent: 0xddaaff, name: '紫' },
  { body: 0x8a6a2a, accent: 0xffcc66, name: '橙' },
  { body: 0x2a7a7a, accent: 0x88ffee, name: '青' },
  { body: 0x8a3a6a, accent: 0xff88cc, name: '粉' },
  { body: 0x5a8a2a, accent: 0xccff88, name: '黄绿' },
];

// ============ 工具函数 ============
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));

export function moveTowards(cur, tar, maxDelta) {
  const d = tar - cur;
  if (Math.abs(d) <= maxDelta) return tar;
  return cur + Math.sign(d) * maxDelta;
}

export function normalizeAngle(a) {
  a = a % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function angleDiff(a, b) { return normalizeAngle(a - b); }

// ============ 静音状态读写 ============
export function readMuteState() {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { return false; }
}
export function writeMuteState(m) {
  try { localStorage.setItem(MUTE_KEY, m ? '1' : '0'); } catch (e) {}
}

// ============ 房间码生成 ============
export function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}