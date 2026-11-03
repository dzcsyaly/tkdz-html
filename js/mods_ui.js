// ============================================================
// js/mods_ui.js — 模组管理面板 UI
// ============================================================

export class ModsUI {
  constructor(game) {
    this.game = game;
    this.mods = game.mods;
    this.activeTab = 'official';

    this.el = {
      panel: document.getElementById('modPanel'),
      content: document.getElementById('modContent'),
      openBtn: document.getElementById('btnOpenMods'),
      closeBtn: document.getElementById('btnCloseMods'),
      countBadge: document.getElementById('modCount'),
    };

    this._init();
    this.mods.onChange(() => {
      this._updateBadge();
      if (this.el.panel && !this.el.panel.classList.contains('hidden')) this.render();
    });
    this._updateBadge();
  }

  _init() {
    if (this.el.openBtn) {
      this.el.openBtn.addEventListener('click', () => this.open());
    }
    if (this.el.closeBtn) {
      this.el.closeBtn.addEventListener('click', () => this.close());
    }
    document.querySelectorAll('.modTab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.activeTab = tab.getAttribute('data-tab');
        document.querySelectorAll('.modTab').forEach(t =>
          t.classList.toggle('active', t === tab));
        this.render();
      });
    });
    if (this.el.panel) {
      this.el.panel.addEventListener('click', (e) => {
        if (e.target === this.el.panel) this.close();
      });
    }
  }

  async open() {
    if (!this.el.panel) return;
    this.el.panel.classList.remove('hidden');
    this.activeTab = 'official';
    document.querySelectorAll('.modTab').forEach(t =>
      t.classList.toggle('active', t.getAttribute('data-tab') === 'official'));
    await this.mods.loadOfficialList();
    this.render();
  }

  close() {
    if (this.el.panel) this.el.panel.classList.add('hidden');
  }

  render() {
    const c = this.el.content;
    if (!c) return;
    if (this.activeTab === 'official') this._renderOfficial(c);
    else if (this.activeTab === 'local') this._renderLocal(c);
    else if (this.activeTab === 'loaded') this._renderLoaded(c);
    this._updateBadge();
  }

  _renderOfficial(c) {
    if (this.mods.manifest.length === 0) {
      c.innerHTML = `<div class="modEmpty">
        未找到官方模组。<br>
        <span style="font-size:12px;opacity:.6">
          请确保项目根目录存在 <code>mod/index.json</code>（需通过 HTTP 服务器访问，不能直接双击 html）。
        </span>
      </div>`;
      return;
    }
    c.innerHTML = '';
    for (const item of this.mods.manifest) {
      const enabled = this.mods.isEnabled(item.id);
      const card = document.createElement('div');
      card.className = 'modCard';
      card.innerHTML = `
        <div class="modHeader">
          <div class="modTitle">${this._esc(item.name)}<span class="modVer">v${this._esc(item.version || '1.0.0')}</span></div>
          <div class="modAuthor">${this._esc(item.author || '')}</div>
        </div>
        <div class="modDesc">${this._esc(item.description || '')}</div>
        <div class="modActions">
          <button class="modBtn ${enabled ? 'danger' : ''}" data-action="${enabled ? 'disable' : 'enable'}">
            ${enabled ? '禁用' : '启用'}
          </button>
        </div>
      `;
      const btn = card.querySelector('button');
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          if (enabled) {
            this.mods.disable(item.id);
          } else {
            const url = 'mod/' + (item.file || `${item.id}.js`);
            await this.mods.enableFromUrl(url, { id: item.id, name: item.name });
          }
        } catch (err) {
          alert('操作失败: ' + (err.message || err));
          console.error(err);
        } finally {
          btn.disabled = false;
          this.render();
        }
      });
      c.appendChild(card);
    }
  }

  _renderLocal(c) {
    c.innerHTML = `
      <div class="modLocal">
        <p style="font-size:14px;line-height:1.8;opacity:.85;margin-bottom:16px;">
          选择一个本地 <code>.js</code> 模组文件。文件应默认导出以下结构的对象：
        </p>
        <pre class="modCode">export default {
  id: 'my-mod',
  name: '我的模组',
  version: '1.0.0',
  description: '示例模组',
  config: { PLAYER_SPEED: 80 },
  onInit(game) { console.log('加载完成'); }
};</pre>
        <button class="btn" id="btnPickFile">📁 选择本地文件</button>
        <input type="file" id="modFileInput" accept=".js,application/javascript" style="display:none">
        <div id="localStatus" class="statusMsg" style="margin-top:12px"></div>
      </div>
    `;
    const btn = c.querySelector('#btnPickFile');
    const input = c.querySelector('#modFileInput');
    const status = c.querySelector('#localStatus');
    btn.addEventListener('click', () => input.click());
    input.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      status.textContent = `加载中：${file.name}`;
      try {
        const entry = await this.mods.enableFromFile(file);
        status.textContent = `✅ 已启用：${entry.name}`;
        this.activeTab = 'loaded';
        document.querySelectorAll('.modTab').forEach(t =>
          t.classList.toggle('active', t.getAttribute('data-tab') === 'loaded'));
        setTimeout(() => this.render(), 300);
      } catch (err) {
        status.textContent = `❌ 加载失败：${err.message || err}`;
        console.error(err);
      }
    });
  }

  _renderLoaded(c) {
    if (this.mods.loaded.size === 0) {
      c.innerHTML = `<div class="modEmpty">尚未加载任何模组。</div>`;
      return;
    }
    c.innerHTML = '';
    for (const entry of this.mods.loaded.values()) {
      const card = document.createElement('div');
      card.className = 'modCard modCardLoaded';
      card.innerHTML = `
        <div class="modHeader">
          <div class="modTitle">✅ ${this._esc(entry.name)}<span class="modVer">v${this._esc(entry.version)}</span></div>
          <div class="modAuthor">${this._esc(entry.author || entry.source || '')}</div>
        </div>
        <div class="modDesc">${this._esc(entry.description || '')}</div>
        <div class="modActions">
          <button class="modBtn danger">禁用</button>
        </div>
      `;
      card.querySelector('button').addEventListener('click', () => {
        this.mods.disable(entry.id);
        this.render();
      });
      c.appendChild(card);
    }
  }

  _updateBadge() {
    if (!this.el.countBadge) return;
    const n = this.mods.loaded.size;
    this.el.countBadge.textContent = n > 0 ? String(n) : '';
    this.el.countBadge.style.display = n > 0 ? 'inline-block' : 'none';
  }

  _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}