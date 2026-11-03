// ============================================================
// js/config.js — 全局常量、URL 参数、工具函数、模组配置覆盖
// ============================================================

export const urlParams = new URLSearchParams(window.location.search);
export const SPLIT_INDEX = parseInt(urlParams.get('split') || '-1');
export const SPLIT_TOTAL = parseInt(urlParams.get('splitTotal') || '0');
export const IS_SPLIT_INSTANCE = SPLIT_INDEX >= 0 && SPLIT_TOTAL > 0;
export const LOW_QUALITY = urlParams.get('lowQuality') === '1';
export const SPLIT_ROOM_KEY = 'tank3d_split_room_code';
export const SPLIT_HOST_TIME_KEY = 'tank3d_split_host_time';
export const MUTE_KEY = 'tank3d_muted';

// ============ 世界常量（可被模组覆盖） ============
export let WAVE_WORLD_SIZE = 600;
export let WAVE_HALF_WORLD = WAVE_WORLD_SIZE / 2;
export let WAVE_WORLD_LIMIT = WAVE_HALF_WORLD - 15;
export let ADV_TERRAIN_SIZE = 900;
export let ADV_TERRAIN_SEG = LOW_QUALITY ? 64 : 80;
export let ADV_RECENTER_THRESHOLD = 120;
export let ADV_SPAWN_RADIUS = 180;
export let ADV_SPAWN_MIN = 60;
export let ADV_MAX_ENEMIES = LOW_QUALITY ? 40 : 80;
export let ADV_POINT_CHECK_R = 8;
export let ADV_OBSTACLE_TARGET = LOW_QUALITY ? 30 : 60;
export let ADV_OBSTACLE_SPAWN_INTERVAL = 0.7;

// ============ 单位数值（可被模组覆盖） ============
export let PLAYER_MAX_HP = 10000;
export let ENEMY_MAX_HP = 10000;
export let PLAYER_DAMAGE = 40 * 9e13;
export let ENEMY_DAMAGE = 1;
export let PLAYER_FIRE_CD = 0.18 / (1 + 999999 / 100);
export let ENEMY_FIRE_CD = 0.85;
export let PLAYER_SPEED = 15 * (1 + 300 / 100);
export let ENEMY_SPEED = 9.5;
export let SHELL_SPEED = 140;
export let SHELL_LIFE = 5.0;
export let TANK_HIT_RADIUS = 1.85;
export let TANK_HIT_CENTER_Y = 1.15;
export let CAM_DIST = 11.5;
export let CAM_HEIGHT = 7.2;
export let CAM_LOOK_AHEAD = 5.5;
export let MAX_ENEMIES = 8;
export let EXTRA_ENEMIES = 20;
export let TOTAL_ENEMY_CAP = Math.floor((MAX_ENEMIES + EXTRA_ENEMIES) * 3);
export let MINE_COOLDOWN = 2.5;
export let MINE_TRIGGER_R = 2.2;
export let MINE_DAMAGE = 40 * 9e13;
export let MINE_LIFE = 30;
export let MAX_MINES = 15;
export let OBSTACLE_HP = 3;
export let OBSTACLE_TARGET = 180;
export let ULT_COOLDOWN = 3.0;
export let CLIMB_SPEED = 25;
export let NET_SEND_INTERVAL = 0.06;
export let NET_ENEMY_SYNC_INTERVAL = 0.12;
export let NET_PLAYER_SYNC_INTERVAL = 0.08;
export let MAX_PLAYERS = 8;
export let PIXEL_RATIO_MAX = LOW_QUALITY ? 0.85 : 1.1;
export let PARTICLES_TOTAL = LOW_QUALITY ? 80 : 160;
export let MAX_FPS = 90;

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

export function readMuteState() {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { return false; }
}
export function writeMuteState(m) {
  try { localStorage.setItem(MUTE_KEY, m ? '1' : '0'); } catch (e) {}
}

export function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// ============================================================
// 模组配置覆盖系统
// ============================================================

const OVERRIDABLE_KEYS = new Set([
  'WAVE_WORLD_SIZE',
  'ADV_TERRAIN_SIZE', 'ADV_TERRAIN_SEG', 'ADV_RECENTER_THRESHOLD',
  'ADV_SPAWN_RADIUS', 'ADV_SPAWN_MIN', 'ADV_MAX_ENEMIES', 'ADV_POINT_CHECK_R',
  'ADV_OBSTACLE_TARGET', 'ADV_OBSTACLE_SPAWN_INTERVAL',
  'PLAYER_MAX_HP', 'ENEMY_MAX_HP', 'PLAYER_DAMAGE', 'ENEMY_DAMAGE',
  'PLAYER_FIRE_CD', 'ENEMY_FIRE_CD', 'PLAYER_SPEED', 'ENEMY_SPEED',
  'SHELL_SPEED', 'SHELL_LIFE', 'TANK_HIT_RADIUS', 'TANK_HIT_CENTER_Y',
  'CAM_DIST', 'CAM_HEIGHT', 'CAM_LOOK_AHEAD',
  'MAX_ENEMIES', 'EXTRA_ENEMIES',
  'MINE_COOLDOWN', 'MINE_TRIGGER_R', 'MINE_DAMAGE', 'MINE_LIFE', 'MAX_MINES',
  'OBSTACLE_HP', 'OBSTACLE_TARGET',
  'ULT_COOLDOWN', 'CLIMB_SPEED',
  'NET_SEND_INTERVAL', 'NET_ENEMY_SYNC_INTERVAL', 'NET_PLAYER_SYNC_INTERVAL', 'MAX_PLAYERS',
  'PIXEL_RATIO_MAX', 'PARTICLES_TOTAL', 'MAX_FPS',
]);

function _rebuildDerived() {
  WAVE_HALF_WORLD = WAVE_WORLD_SIZE / 2;
  WAVE_WORLD_LIMIT = WAVE_HALF_WORLD - 15;
  TOTAL_ENEMY_CAP = Math.floor((MAX_ENEMIES + EXTRA_ENEMIES) * 3);
}

export function setConfigValue(key, value) {
  if (!OVERRIDABLE_KEYS.has(key)) return false;
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  switch (key) {
    case 'WAVE_WORLD_SIZE': WAVE_WORLD_SIZE = value; break;
    case 'ADV_TERRAIN_SIZE': ADV_TERRAIN_SIZE = value; break;
    case 'ADV_TERRAIN_SEG': ADV_TERRAIN_SEG = value; break;
    case 'ADV_RECENTER_THRESHOLD': ADV_RECENTER_THRESHOLD = value; break;
    case 'ADV_SPAWN_RADIUS': ADV_SPAWN_RADIUS = value; break;
    case 'ADV_SPAWN_MIN': ADV_SPAWN_MIN = value; break;
    case 'ADV_MAX_ENEMIES': ADV_MAX_ENEMIES = value; break;
    case 'ADV_POINT_CHECK_R': ADV_POINT_CHECK_R = value; break;
    case 'ADV_OBSTACLE_TARGET': ADV_OBSTACLE_TARGET = value; break;
    case 'ADV_OBSTACLE_SPAWN_INTERVAL': ADV_OBSTACLE_SPAWN_INTERVAL = value; break;
    case 'PLAYER_MAX_HP': PLAYER_MAX_HP = value; break;
    case 'ENEMY_MAX_HP': ENEMY_MAX_HP = value; break;
    case 'PLAYER_DAMAGE': PLAYER_DAMAGE = value; break;
    case 'ENEMY_DAMAGE': ENEMY_DAMAGE = value; break;
    case 'PLAYER_FIRE_CD': PLAYER_FIRE_CD = value; break;
    case 'ENEMY_FIRE_CD': ENEMY_FIRE_CD = value; break;
    case 'PLAYER_SPEED': PLAYER_SPEED = value; break;
    case 'ENEMY_SPEED': ENEMY_SPEED = value; break;
    case 'SHELL_SPEED': SHELL_SPEED = value; break;
    case 'SHELL_LIFE': SHELL_LIFE = value; break;
    case 'TANK_HIT_RADIUS': TANK_HIT_RADIUS = value; break;
    case 'TANK_HIT_CENTER_Y': TANK_HIT_CENTER_Y = value; break;
    case 'CAM_DIST': CAM_DIST = value; break;
    case 'CAM_HEIGHT': CAM_HEIGHT = value; break;
    case 'CAM_LOOK_AHEAD': CAM_LOOK_AHEAD = value; break;
    case 'MAX_ENEMIES': MAX_ENEMIES = value; break;
    case 'EXTRA_ENEMIES': EXTRA_ENEMIES = value; break;
    case 'MINE_COOLDOWN': MINE_COOLDOWN = value; break;
    case 'MINE_TRIGGER_R': MINE_TRIGGER_R = value; break;
    case 'MINE_DAMAGE': MINE_DAMAGE = value; break;
    case 'MINE_LIFE': MINE_LIFE = value; break;
    case 'MAX_MINES': MAX_MINES = value; break;
    case 'OBSTACLE_HP': OBSTACLE_HP = value; break;
    case 'OBSTACLE_TARGET': OBSTACLE_TARGET = value; break;
    case 'ULT_COOLDOWN': ULT_COOLDOWN = value; break;
    case 'CLIMB_SPEED': CLIMB_SPEED = value; break;
    case 'NET_SEND_INTERVAL': NET_SEND_INTERVAL = value; break;
    case 'NET_ENEMY_SYNC_INTERVAL': NET_ENEMY_SYNC_INTERVAL = value; break;
    case 'NET_PLAYER_SYNC_INTERVAL': NET_PLAYER_SYNC_INTERVAL = value; break;
    case 'MAX_PLAYERS': MAX_PLAYERS = value; break;
    case 'PIXEL_RATIO_MAX': PIXEL_RATIO_MAX = value; break;
    case 'PARTICLES_TOTAL': PARTICLES_TOTAL = value; break;
    case 'MAX_FPS': MAX_FPS = value; break;
    default: return false;
  }
  _rebuildDerived();
  return true;
}

export function applyConfigOverrides(overrides) {
  if (!overrides || typeof overrides !== 'object') return [];
  const applied = [];
  for (const [key, value] of Object.entries(overrides)) {
    if (setConfigValue(key, value)) applied.push(key);
    else console.warn(`[Config] 跳过未知或无效配置项: ${key}`);
  }
  return applied;
}