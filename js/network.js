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
      this.peer.on('open', () => {
        const conn = this.peer.connect('tank3d-' + code, { reliable: true });
        this.conn = conn;
        if (!conn) { reject(new Error('无法连接')); return; }
        const timeout = setTimeout(() => reject(new Error('连接超时')), 8000);
        conn.on('open', () => {
          clearTimeout(timeout);
          this.connected = true;
          this._setupClientConnection();
          resolve();
        });
        conn.on('data', (data) => this._handleClientData(data));
        conn.on('error', (err) => { clearTimeout(timeout); reject(err); });
      });
      this.peer.on('error', (err) => reject(err));
    });
  }

  _setupClientConnection() {
    const conn = this.conn;
    if (!conn) return;
    conn.on('close', () => { this.connected = false; this.game.onNetworkDisconnected(); });
    conn.on('error', () => { this.connected = false; this.game.onNetworkDisconnected(); });
  }

  _handleClientData(data) {
    if (!data || !data.type) return;
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
    if (this.isHost) {
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
      this.sendAccum += dt;
      if (this.sendAccum >= NET_SEND_INTERVAL) {
        this.sendAccum = 0;
        this._sendStateNow();
      }
    }
    const now = performance.now();
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

  disconnect() {
    try {
      if (this.conn) this.conn.close();
      for (const entry of this.conns) { if (entry.conn) entry.conn.close(); }
      if (this.peer) this.peer.destroy();
    } catch (e) {}
    this.conn = null; this.conns = []; this.peer = null;
    this.connected = false;
  }
}