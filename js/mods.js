// ============================================================
// js/mods.js — 模组管理器
// ============================================================
//
// 模组文件格式（ES Module）：
//   export default {
//     id: 'my-mod',
//     name: '我的模组',
//     version: '1.0.0',
//     description: '...',
//     author: '...',
//     config: { PLAYER_SPEED: 80 },
//     onInit(game) {},
//     onUpdate(game, dt) {},
//     onPlayerFire(game, tank, shell) {},
//     onTankHit(game, tank, dmg, source) {},
//     onTankDeath(game, tank) {},
//     onEnemySpawn(game, enemy) {},
//   };

import { applyConfigOverrides } from './config.js';

export class ModManager {
  constructor(game) {
    this.game = game;
    this.loaded = new Map();
    this.manifest = [];
    this._hooks = {
      onInit: [],
      onUpdate: [],
      onPlayerFire: [],
      onTankHit: [],
      onTankDeath: [],
      onEnemySpawn: [],
    };
    this._onChange = null;
  }

  onChange(cb) { this._onChange = cb; }
  _notify() {
    if (this._onChange) {
      try { this._onChange(); } catch (e) { console.error(e); }
    }
  }

  // ---------- 官方模组列表 ----------
  async loadOfficialList() {
    try {
      const res = await fetch('mod/index.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this.manifest = Array.isArray(data) ? data : [];
    } catch (e) {
      console.warn('[Mods] 官方模组列表加载失败:', e);
      this.manifest = [];
    }
    this._notify();
    return this.manifest;
  }

  // ---------- 从 URL 加载（官方） ----------
  async enableFromUrl(url, meta = {}) {
    const id = meta.id || url;
    if (this.loaded.has(id)) {
      throw new Error(`模组 ${id} 已加载`);
    }
    const cacheBust = (url.includes('?') ? '&' : '?') + 't=' + Date.now();
    const module = await import(/* @vite-ignore */ url + cacheBust);
    return this._activate(module, {
      id,
      name: meta.name || id,
      source: url,
    });
  }

  // ---------- 从本地文件加载 ----------
  async enableFromFile(file) {
    const text = await file.text();
    const blob = new Blob([text], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    try {
      const module = await import(/* @vite-ignore */ url);
      const def = module.default || {};
      const id = def.id || file.name.replace(/\.js$/i, '');
      return this._activate(module, {
        id,
        name: def.name || file.name,
        source: '(本地) ' + file.name,
      });
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
  }

  // ---------- 激活 ----------
  _activate(module, meta) {
    const def = module.default || {};
    if (this.loaded.has(meta.id)) {
      throw new Error(`模组 ${meta.id} 已存在`);
    }

    const entry = {
      id: meta.id,
      name: def.name || meta.name || meta.id,
      version: def.version || '0.0.0',
      description: def.description || '',
      author: def.author || '',
      source: meta.source,
      config: def.config || null,
      hooks: {
        onInit: def.onInit,
        onUpdate: def.onUpdate,
        onPlayerFire: def.onPlayerFire,
        onTankHit: def.onTankHit,
        onTankDeath: def.onTankDeath,
        onEnemySpawn: def.onEnemySpawn,
      },
    };

    if (entry.config && typeof entry.config === 'object') {
      try {
        const applied = applyConfigOverrides(entry.config);
        entry._appliedConfig = applied;
        console.log(`[Mods] ${entry.name} 覆盖配置:`, applied.join(', ') || '(无)');
      } catch (e) {
        console.error(`[Mods] ${entry.name} 配置应用失败:`, e);
      }
    }

    for (const [k, fn] of Object.entries(entry.hooks)) {
      if (typeof fn === 'function') this._hooks[k].push(fn);
    }

    if (typeof entry.hooks.onInit === 'function') {
      try { entry.hooks.onInit(this.game); }
      catch (e) { console.error(`[Mods] ${entry.name} onInit 出错:`, e); }
    }

    this.loaded.set(entry.id, entry);
    this._notify();
    return entry;
  }

  // ---------- 禁用 ----------
  disable(id) {
    const entry = this.loaded.get(id);
    if (!entry) return;
    for (const [k, fn] of Object.entries(entry.hooks)) {
      if (typeof fn === 'function') {
        const arr = this._hooks[k];
        const idx = arr.indexOf(fn);
        if (idx >= 0) arr.splice(idx, 1);
      }
    }
    this.loaded.delete(id);
    console.log(`[Mods] 已禁用 ${entry.name}（配置覆盖需重开一局或刷新才能完全恢复）`);
    this._notify();
  }

  // ---------- 触发钩子 ----------
  fire(hookName, ...args) {
    const arr = this._hooks[hookName];
    if (!arr || arr.length === 0) return;
    for (const fn of arr) {
      try { fn(this.game, ...args); }
      catch (e) { console.error(`[Mods] ${hookName} 出错:`, e); }
    }
  }

  isEnabled(id) { return this.loaded.has(id); }
}