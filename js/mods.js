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

import { applyConfigOverrides, IS_SPLIT_INSTANCE } from './config.js';

const SESSION_KEY = 'tank3d_active_mods';

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
    this._syncToSessionStorage();
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
    // 把相对路径解析成绝对 URL，避免 "Failed to resolve module specifier"
    const absUrl = new URL(url, document.baseURI).href;
    const cacheBust = (absUrl.includes('?') ? '&' : '?') + 't=' + Date.now();
    const module = await import(/* @vite-ignore */ absUrl + cacheBust);
    return this._activate(module, {
      id,
      name: meta.name || id,
      source: url,
      sourceType: 'url',
    });
  }

  // ---------- 从源码加载（本地文件 / 分屏 iframe 恢复共用） ----------
  async enableFromSourceCode(code, meta = {}) {
    const blob = new Blob([code], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    try {
      const module = await import(/* @vite-ignore */ url);
      const def = module.default || {};
      const id = def.id || meta.id || ('local-' + Date.now());
      return this._activate(module, {
        id,
        name: def.name || meta.name || id,
        source: meta.name || '(本地)',
        sourceType: 'local',
        code,
      });
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
  }

  // ---------- 从本地文件加载 ----------
  async enableFromFile(file) {
    const text = await file.text();
    const fallbackId = file.name.replace(/\.js$/i, '');
    return this.enableFromSourceCode(text, {
      id: fallbackId,
      name: file.name,
    });
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
      sourceType: meta.sourceType || 'url',
      code: meta.code || null,
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
    console.log(`[Mods] 已禁用 ${entry.name}（配置覆盖需刷新页面才能完全恢复）`);
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

  // ============================================================
  // sessionStorage 同步（分屏 iframe 通过它恢复模组）
  // ============================================================
  _syncToSessionStorage() {
    // 分屏 iframe 不回写：避免某个模组在 iframe 里加载失败时，
    // 用不完整的列表覆盖父窗口已保存的完整列表
    if (IS_SPLIT_INSTANCE) return;
    try {
      const list = [];
      for (const entry of this.loaded.values()) {
        list.push({
          id: entry.id,
          name: entry.name,
          source: entry.source,
          sourceType: entry.sourceType,
          code: entry.sourceType === 'local' ? entry.code : null,
        });
      }
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(list));
    } catch (e) {
      console.warn('[Mods] 同步到 sessionStorage 失败:', e);
    }
  }

  async loadFromSessionStorage() {
    let list = [];
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return 0;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed;
    } catch (e) {
      console.warn('[Mods] 读取 sessionStorage 失败:', e);
      return 0;
    }

    let count = 0;
    for (const item of list) {
      try {
        if (!item || !item.id || this.loaded.has(item.id)) continue;
        if (item.sourceType === 'url' && item.source) {
          await this.enableFromUrl(item.source, { id: item.id, name: item.name });
          count++;
        } else if (item.sourceType === 'local' && item.code) {
          await this.enableFromSourceCode(item.code, { id: item.id, name: item.name });
          count++;
        }
      } catch (e) {
        console.warn(`[Mods] 恢复模组 ${item.id} 失败:`, e);
      }
    }
    if (count > 0) console.log(`[Mods] 从会话恢复 ${count} 个模组`);
    return count;
  }

  // 工具：手动清空本会话的模组记录
  clearSessionStorage() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
  }
}