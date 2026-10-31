// ============================================================
// js/network.js — PeerJS 网络管理器（主机 + 客户端）
// ============================================================

import * as THREE from 'three';
import {
  MAX_PLAYERS, PLAYER_COLORS,
  NET_SEND_INTERVAL, NET_ENEMY_SYNC_INTERVAL, NET_PLAYER_SYNC_INTERVAL,
  generateRoomCode,
} from './config.js';
import { TerrainSystem } from './noise.js';

export class NetworkManager {
  constructor(game) {
    this.game = game;
    this.peer = null;
    this.conns = [];
    this.conn = null;
    this.isHost = false;
    this.myPlayerId = 0;
    this.roomCode = '';
    this.connected = false;
    this.nextPlayerId = 1;
    this.sharedSeed = 0;
    this.remotePlayersData = new Map();
    this.remoteEnemyData = [];
    this._pendingFireEvents = [];
    this.sendAccum = 0;
    this.enemySyncAccum = 0;
    this.hostPlayerSyncAccum = 0;

    // ===== 新增：网络健壮化状态 =====
    this._clientPendingKills = new Map();   // 客机预测击杀: enemyNetId -> 时间戳
    this._playerLastSeen = new Map();       // 主机记录每个玩家最后活动时间
    this._lastHostDataTime = 0;             // 客机记录最后一次收到主机数据的时间
    this._reconnecting = false;
    this._reconnectAttempts = 0;
    this._maxReconnectAttempts = 5;
    this._reconnectPermanentlyFailed = false;
    this._playerTimeoutMs = 15000;          // 主机：15 秒无数据踢出
    this._hostSilenceMs = 10000;            // 客机：10 秒无主机数据视为断线
    this._pendingKillTimeoutMs = 3000;      // 客机：3 秒未确认则回滚预测击杀
  }

  async _ensurePeerJS() {
    if (window.Peer) return window.Peer;
    for (let i = 0; i < 50; i++) {
      await new Promise(r => setTimeout(r, 100));
      if (window.Peer) return window.Peer;
    }
    throw new Error('PeerJS 加载失败');
  }

  async createRoom(forcedCode = null) {
    const Peer = await this._ensurePeerJS();
    const code = forcedCode || generateRoomCode();
    this.roomCode = code;
    this.isHost = true;
    this.myPlayerId = 0;
    this.sharedSeed = Math.floor(Math.random() * 0xFFFFFFFF);

    return new Promise((resolve, reject) => {
      let tried = false;
      const tryCreate = (c) => {
        try { this.peer = new Peer('tank3d-' + c); }
        catch (e) { reject(e); return; }
        this.peer.on('open', () => {
          this.roomCode = c;
          resolve(c);
        });
        this.peer.on('error', (err) => {
          if (err.type === 'unavailable-id' && !tried) {
            tried = true;
            const newCode = generateRoomCode();
            try {
              this.peer.destroy();
              tryCreate(newCode);
              this._setupHostListeners();
            } catch (e2) { reject(e2); }
          } else {
            reject(err);
          }
        });
      };
      tryCreate(code);
      this._setupHostListeners();
    });
  }

  _setupHostListeners() {
    if (!this.peer) return;
    this.peer.on('connection', (conn) => {
      if (this.conns.length >= MAX_PLAYERS - 1) {
        try { conn.close(); } catch (e) {}
        return;
      }
      const playerId = this.nextPlayerId++;
      const colorIdx = playerId % PLAYER_COLORS.length;
      const entry = { conn, playerId, colorIdx };
      this.conns.push(entry);

      conn.on('open', () => {
        try {
          conn.send({ type: 'init', seed: this.sharedSeed, playerId, colorIdx });
        } catch (e) {}
        this._broadcastExcept(playerId, { type: 'player_join', playerId, colorIdx });
        this.connected = true;
        if (this.game) this.game.onMultiPlayerJoined(playerId, colorIdx);
      });

      conn.on('data', (data) => this._handleHostData(data, entry));

      const onClose = () => {
        const idx = this.conns.indexOf(entry);
        if (idx >= 0) this.conns.splice(idx, 1);
        this.remotePlayersData.delete(playerId);
        this._playerLastSeen.delete(playerId);            // ← 新增
        this._broadcastExcept(playerId, { type: 'player_leave', playerId });
        if (this.game) this.game.onMultiPlayerLeft(playerId);
        if (this.conns.length === 0) this.connected = false;
      };
      conn.on('close', onClose);
      conn.on('error', onClose);
    });
  }

  _broadcast(msg, exceptPlayerId = -1) {
    for (const entry of this.conns) {
      if (entry.playerId === exceptPlayerId) continue;
      if (!entry.conn || !entry.conn.open) continue;
      try { entry.conn.send(msg); } catch (e) {}
    }
  }
  _broadcastExcept(exceptPlayerId, msg) { this._broadcast(msg, exceptPlayerId); }

  _handleHostData(data, entry) {
    if (!data || !data.type) return;
    this._playerLastSeen.set(entry.playerId, performance.now());   // ← 新增
    const pid = entry.playerId;
    switch (data.type) {
      case 'state':
        this.remotePlayersData.set(pid, {
          x: data.x, z: data.z, yaw: data.yaw,
          turretYaw: data.turretYaw, hp: data.hp, dead: data.dead,
          colorIdx: entry.colorIdx,
        });
        break;
      case 'fire':
        this._broadcastExcept(pid, {
          type: 'fire', playerId: pid,
          x: data.x, y: data.y, z: data.z,
          dx: data.dx, dy: data.dy, dz: data.dz,
          colorIdx: entry.colorIdx,
        });
        break;
      case 'hit_player':
        this._deliverHit(data.targetId, data.damage);
        break;
      case 'enemy_hit':
        {
          const enemy = this.game.enemies.find(e => e._netId === data.id);
          if (enemy && !enemy.dead) enemy.takeDamage(data.damage, null);
        }
        break;
    }
  }

  _deliverHit(targetId, damage) {
    if (targetId === 0) {
      if (this.game.player && !this.game.player.dead) {
        this.game.player.takeDamage(damage, null);
      }
      return;
    }
    const entry = this.conns.find(c => c.playerId === targetId);
    if (entry && entry.conn && entry.conn.open) {
      try { entry.conn.send({ type: 'hit_me', damage }); } catch (e) {}
    }
  }

  async joinRoom(code) {
    const Peer = await this._ensurePeerJS();
    this.roomCode = code;
    this.isHost = false;
    return new Promise((resolve, reject) => {
      try { this.peer = new Peer(); }
      catch (e) { reject(e); return; }

      // 超时清理：先销毁 peer，再 reject，避免半开连接泄漏
      const cleanupAndReject = (err) => {
        try { if (this.conn) this.conn.close(); } catch (e) {}
        try { if (this.peer) this.peer.destroy(); } catch (e) {}
        this.conn = null;
        this.peer = null;
        reject(err);
      };

      this.peer.on('open', () => {
        const conn = this.peer.connect('tank3d-' + code, { reliable: true });
        this.conn = conn;
        if (!conn) { cleanupAndReject(new Error('无法连接')); return; }

        const timeout = setTimeout(() => {
          cleanupAndReject(new Error('连接超时'));
        }, 8000);

        conn.on('open', () => {
          clearTimeout(timeout);
          this.connected = true;
          this._lastHostDataTime = performance.now();
          this._setupClientConnection();
          resolve();
        });
        conn.on('data', (data) => this._handleClientData(data));
        conn.on('error', (err) => {
          clearTimeout(timeout);
          cleanupAndReject(err);
        });
      });

      this.peer.on('error', (err) => {
        try { if (this.peer) this.peer.destroy(); } catch (e) {}
        this.peer = null;
        reject(err);
      });
    });
  }

  _setupClientConnection() {
    const conn = this.conn;
    if (!conn) return;
    const onDrop = () => {
      // 只处理"当前 conn"的断开，避免旧 conn 关闭误触发重连
      if (conn !== this.conn) return;
      if (this._reconnectPermanentlyFailed) return;
      const wasConnected = this.connected;
      this.connected = false;
      if (wasConnected && this.game) this.game.onNetworkDisconnected();
      if (!this._reconnecting) this._attemptReconnect();
    };
    conn.on('close', onDrop);
    conn.on('error', onDrop);
  }

  _handleClientData(data) {
    if (!data || !data.type) return;
    this._lastHostDataTime = performance.now();   // ← 新增
    switch (data.type) {
      case 'init':
        this.myPlayerId = data.playerId;
        this.sharedSeed = data.seed;
        TerrainSystem.init('multi', data.seed);
        this.game.startMultiGame(data.seed, data.playerId, data.colorIdx, false);
        break;
      case 'players':
        this.remotePlayersData.clear();
        for (const p of data.players) {
          if (p.id === this.myPlayerId) continue;
          this.remotePlayersData.set(p.id, p);
        }
        break;
      case 'enemies': this.remoteEnemyData = data.enemies || []; break;
      case 'fire':
        this._pendingFireEvents.push({
          playerId: data.playerId, colorIdx: data.colorIdx,
          pos: new THREE.Vector3(data.x, data.y, data.z),
          dir: new THREE.Vector3(data.dx, data.dy, data.dz),
          t: performance.now(),
        });
        break;
      case 'hit_me':
        if (this.game.player && !this.game.player.dead) {
          this.game.player.takeDamage(data.damage, null);
          this._sendStateNow();
        }
        break;
      case 'player_join': break;
      case 'player_leave': this.remotePlayersData.delete(data.playerId); break;
    }
  }

  update(dt) {
    if (!this.connected) return;
    const now = performance.now();

    if (this.isHost) {
      this._cleanupTimeoutPlayers(now);

      this.hostPlayerSyncAccum += dt;
      if (this.hostPlayerSyncAccum >= NET_PLAYER_SYNC_INTERVAL) {
        this.hostPlayerSyncAccum = 0;
        this._hostBroadcastPlayers();
      }
      this.enemySyncAccum += dt;
      if (this.enemySyncAccum >= NET_ENEMY_SYNC_INTERVAL) {
        this.enemySyncAccum = 0;
        this._hostBroadcastEnemies();
      }
    } else {
      // 客机：长时间收不到主机数据 → 视为断线
      if (this._lastHostDataTime > 0 && now - this._lastHostDataTime > this._hostSilenceMs) {
        this.connected = false;
        if (this.game) this.game.onNetworkDisconnected();
        this._lastHostDataTime = 0;
        if (!this._reconnecting && !this._reconnectPermanentlyFailed) {
          this._attemptReconnect();
        }
        return;
      }

      this.sendAccum += dt;
      if (this.sendAccum >= NET_SEND_INTERVAL) {
        this.sendAccum = 0;
        this._sendStateNow();
      }
    }

    this._pendingFireEvents = this._pendingFireEvents.filter(e => now - e.t < 200);
  }

  _hostBroadcastPlayers() {
    if (this.conns.length === 0) return;
    const players = [];
    const p = this.game.player;
    if (p) players.push({
      id: 0, x: p.group.position.x, z: p.group.position.z,
      yaw: p.yaw, turretYaw: p.turretYaw, hp: p.hp, dead: p.dead, colorIdx: 0,
    });
    for (const entry of this.conns) {
      const st = this.remotePlayersData.get(entry.playerId);
      if (st) players.push({
        id: entry.playerId, x: st.x, z: st.z, yaw: st.yaw, turretYaw: st.turretYaw,
        hp: st.hp, dead: st.dead, colorIdx: entry.colorIdx,
      });
    }
    const msg = { type: 'players', players };
    for (const entry of this.conns) {
      if (entry.conn && entry.conn.open) { try { entry.conn.send(msg); } catch (e) {} }
    }
  }

  _hostBroadcastEnemies() {
    if (this.conns.length === 0) return;
    const enemies = [];
    for (const e of this.game.enemies) {
      if (e.dead) continue;
      enemies.push({
        id: e._netId || 0,
        x: e.group.position.x, z: e.group.position.z,
        yaw: e.yaw, turretYaw: e.turretYaw,
        hp: e.hp, color: e._netColor || 0x8a3a2a,
      });
    }
    const msg = { type: 'enemies', enemies };
    for (const entry of this.conns) {
      if (entry.conn && entry.conn.open) { try { entry.conn.send(msg); } catch (e) {} }
    }
  }

  _sendStateNow() {
    if (!this.conn || !this.conn.open) return;
    const p = this.game.player; if (!p) return;
    try {
      this.conn.send({
        type: 'state', x: p.group.position.x, z: p.group.position.z,
        yaw: p.yaw, turretYaw: p.turretYaw, hp: p.hp, dead: p.dead,
      });
    } catch (e) {}
  }

  sendFire(pos, dir) {
    if (!this.connected) return;
    if (this.isHost) {
      this._broadcast({
        type: 'fire', playerId: 0,
        x: pos.x, y: pos.y, z: pos.z,
        dx: dir.x, dy: dir.y, dz: dir.z, colorIdx: 0,
      });
    } else if (this.conn && this.conn.open) {
      try {
        this.conn.send({
          type: 'fire', x: pos.x, y: pos.y, z: pos.z,
          dx: dir.x, dy: dir.y, dz: dir.z,
        });
      } catch (e) {}
    }
  }

  sendPlayerHit(targetId, damage) {
    if (!this.connected) return;
    if (this.isHost) this._deliverHit(targetId, damage);
    else if (this.conn && this.conn.open) {
      try { this.conn.send({ type: 'hit_player', targetId, damage }); } catch (e) {}
    }
  }

  sendEnemyHit(enemyId, damage) {
    if (!this.connected) return;
    if (this.isHost) {
      const enemy = this.game.enemies.find(e => e._netId === enemyId);
      if (enemy && !enemy.dead) enemy.takeDamage(damage, null);
    } else if (this.conn && this.conn.open) {
      try { this.conn.send({ type: 'enemy_hit', id: enemyId, damage }); } catch (e) {}
    }
  }

  getPlayerCount() { return this.isHost ? 1 + this.conns.length : this.remotePlayersData.size + 1; }
  
  /* ========== 新增：主机超时玩家清理 ========== */
  _cleanupTimeoutPlayers(now) {
    for (const entry of [...this.conns]) {
      const last = this._playerLastSeen.get(entry.playerId) || 0;
      if (now - last > this._playerTimeoutMs) {
        console.warn(`[Network] 玩家 ${entry.playerId} 超时无数据，踢出`);
        this._playerLastSeen.delete(entry.playerId);
        try { entry.conn.close(); } catch (e) {}
        // conn.on('close') 会触发 onClose 里剩下的清理（remotePlayersData 等）
      }
    }
  }

  /* ========== 新增：客机自动重连（指数退避） ========== */
  async _attemptReconnect() {
    if (this.isHost) return;
    if (this._reconnecting) return;
    if (!this.roomCode) return;
    if (this._reconnectPermanentlyFailed) return;

    if (this._reconnectAttempts >= this._maxReconnectAttempts) {
      this._reconnecting = false;
      this._reconnectPermanentlyFailed = true;
      if (this.game) this.game.onReconnectFailed();
      return;
    }

    this._reconnecting = true;
    this._reconnectAttempts++;

    const delay = Math.min(1000 * Math.pow(2, this._reconnectAttempts - 1), 8000);
    if (this.game) {
      this.game.showBanner(
        `连接断开 · ${(delay / 1000).toFixed(0)}秒后重连 (${this._reconnectAttempts}/${this._maxReconnectAttempts})`
      );
    }

    await new Promise(r => setTimeout(r, delay));

    // 清理旧连接（先置空 this.conn，避免旧 conn close 又触发重连）
    const oldConn = this.conn;
    const oldPeer = this.peer;
    this.conn = null;
    this.peer = null;
    if (oldConn) { try { oldConn.close(); } catch (e) {} }
    if (oldPeer) { try { oldPeer.destroy(); } catch (e) {} }

    try {
      await this.joinRoom(this.roomCode);
      // 成功：joinRoom 内部已置 connected=true，客机静默计时重置
      this._lastHostDataTime = performance.now();
      this._reconnecting = false;
      this._reconnectAttempts = 0;
      if (this.game) this.game.onReconnectSuccess();
    } catch (err) {
      console.warn('[Network] 重连失败：', err && err.message || err);
      this._reconnecting = false;
      this._attemptReconnect();
    }
  }

  /* ========== 新增：客机预测击杀接口 ========== */
  markClientKill(enemyNetId) {
    if (enemyNetId === undefined || enemyNetId === null) return;
    this._clientPendingKills.set(enemyNetId, performance.now());
  }

  isClientKillPending(enemyNetId) {
    return this._clientPendingKills.has(enemyNetId);
  }

  /* 主机确认死亡后由 game.syncRemoteEnemies 调用 */
  confirmClientKill(enemyNetId) {
    this._clientPendingKills.delete(enemyNetId);
  }

  /* 检查超时的预测击杀并回滚 */
  prunePendingKills(now) {
    if (this._clientPendingKills.size === 0) return;
    for (const [id, t] of this._clientPendingKills) {
      if (now - t > this._pendingKillTimeoutMs) {
        this._clientPendingKills.delete(id);
      }
    }
  }

  disconnect() {
    this._reconnecting = false;
    this._reconnectAttempts = 0;
    this._reconnectPermanentlyFailed = false;
    this._clientPendingKills.clear();
    this._playerLastSeen.clear();
    this._lastHostDataTime = 0;
    this._pendingFireEvents = [];

    try {
      if (this.conn) this.conn.close();
      for (const entry of this.conns) { if (entry.conn) entry.conn.close(); }
      if (this.peer) this.peer.destroy();
    } catch (e) {}
    this.conn = null; this.conns = []; this.peer = null;
    this.connected = false;
  }
}