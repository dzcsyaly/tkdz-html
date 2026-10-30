// ============================================================
// js/entities/shell.js — 炮弹实体
// ============================================================

import * as THREE from 'three';
import { SHELL_SPEED, SHELL_LIFE, WAVE_HALF_WORLD, clamp } from '../config.js';
import { getTerrainHeight } from '../noise.js';
import { segmentAABB, segmentSphere } from '../collision.js';
import { GEO, getPlayerShellMats, SHELL_MATS } from '../geometries.js';

export class Shell {
  constructor(game, pos, dir, owner) {
    this.game = game; this.owner = owner; this.team = owner.team;
    this.damage = owner.damage; this.speed = SHELL_SPEED;
    this.dir = dir.clone().normalize(); this.life = SHELL_LIFE; this.dead = false;
    let mats;
    if (this.team === 'player') {
      const c = owner.shellColor || 0xffe066;
      mats = getPlayerShellMats(c);
    } else if (this.team === 'remote_player') {
      const c = owner.shellColor || 0x88ddff;
      mats = getPlayerShellMats(c);
    } else {
      mats = SHELL_MATS.enemy;
    }
    this.mesh = new THREE.Mesh(GEO.shellBody, mats.body);
    this.mesh.position.copy(pos); this.mesh.frustumCulled = false;
    this.glow = new THREE.Mesh(GEO.shellGlow, mats.glow);
    this.glow.frustumCulled = false; this.mesh.add(this.glow);
    this.prevPos = pos.clone();
    game.scene.add(this.mesh);
  }
  update(dt) {
    if (this.dead) return;
    const prev = this.prevPos.copy(this.mesh.position);
    const next = this.mesh.position.clone().addScaledVector(this.dir, this.speed * dt);
    let bestT = Infinity; let hit = null;
    const terrainY = getTerrainHeight(next.x, next.z);
    if (next.y <= terrainY + 0.12) {
      const denom = next.y - prev.y;
      if (Math.abs(denom) > 1e-9) {
        const t = (terrainY + 0.12 - prev.y) / denom;
        if (t >= 0 && t <= 1 && t < bestT) { bestT = t; hit = { type: 'ground' }; }
      }
    }
    const obstacles = this.game.obstacles;
    for (let i = 0; i < obstacles.length; i++) {
      const ob = obstacles[i];
      if (ob.dead) continue;
      const t = segmentAABB(prev, next, ob.min, ob.max);
      if (t !== null && t < bestT) { bestT = t; hit = { type: 'obstacle', obstacle: ob }; }
    }
    const tanks = this.game.tanks;
    for (let i = 0; i < tanks.length; i++) {
      const tank = tanks[i];
      if (tank === this.owner) continue;
      if (tank.dead) continue;
      if (this.team === 'remote_player' && tank.team === 'player') continue;
      if (this.team === 'player' && tank.team === 'player') continue;
      if (this.team === 'enemy' && tank.team === 'enemy') continue;
      const t = segmentSphere(prev, next, tank.hitCenter, tank.hitRadius);
      if (t !== null && t < bestT) { bestT = t; hit = { type: 'tank', tank }; }
    }
    if (this.game.mode === 'wave') {
      if (Math.abs(next.x) > WAVE_HALF_WORLD + 2 || Math.abs(next.z) > WAVE_HALF_WORLD + 2) { this.kill(); return; }
    }
    if (hit) {
      const impact = prev.clone().lerp(next, clamp(bestT, 0, 1));
      this.mesh.position.copy(impact);
      this.onImpact(hit, impact); return;
    }
    this.mesh.position.copy(next);
    this.life -= dt;
    if (this.life <= 0) this.kill();
  }
  onImpact(hit, pos) {
    const P = this.game.particles;
    if (hit.type === 'tank') {
      const tank = hit.tank;
      if (tank.team === 'remote_player') {
        if (this.game.network && this.game.network.connected) {
          this.game.network.sendPlayerHit(tank._netPlayerId, this.damage);
        }
        P.spawn(pos, 14, { speed: 16, mat: 'spark', life: 0.6, gravity: 14, size: 1.0 });
        P.spawn(pos, 8, { speed: 9, mat: 'fire2', life: 0.6, gravity: 8, size: 1.3 });
        this.game.audio.hit();
      } else {
        const isClient = this.game.network && !this.game.network.isHost && this.game.network.connected;
        const isSyncedEnemy = tank.team === 'enemy' && tank._isRemoteSynced && tank._netId !== undefined;
        if (isClient && isSyncedEnemy) {
          this.game.network.sendEnemyHit(tank._netId, this.damage);
          P.spawn(pos, 12, { speed: 15, mat: 'spark', life: 0.55, gravity: 14, size: 0.9 });
          P.spawn(pos, 8, { speed: 9, mat: 'fire2', life: 0.55, gravity: 8, size: 1.3 });
          this.game.audio.hit();
          tank.hp = 0;
          tank.die();
        } else {
          tank.takeDamage(this.damage, this.owner);
          P.spawn(pos, 12, { speed: 15, mat: 'spark', life: 0.55, gravity: 14, size: 0.9 });
          P.spawn(pos, 8, { speed: 9, mat: 'fire2', life: 0.55, gravity: 8, size: 1.3 });
          P.spawn(pos, 8, { speed: 7, mat: 'smoke', life: 1.3, gravity: -3, size: 1.6 });
          this.game.audio.hit();
        }
      }
    } else if (hit.type === 'obstacle') {
      hit.obstacle.takeDamage(this.damage, this.owner);
    } else if (hit.type === 'ground') {
      P.spawn(pos, 12, { speed: 10, mat: 'dirt', life: 0.9, gravity: 18, size: 1.2 });
      P.spawn(pos, 8, { speed: 6, mat: 'smoke', life: 1.2, gravity: -2, size: 1.5 });
      P.spawn(pos, 8, { speed: 11, mat: 'fire2', life: 0.35, gravity: 10, size: 1.0 });
    } else {
      P.spawn(pos, 12, { speed: 12, mat: 'spark', life: 0.5, gravity: 15, size: 0.9 });
      P.spawn(pos, 8, { speed: 7, mat: 'smoke', life: 1.1, gravity: -2, size: 1.4 });
    }
    this.kill();
  }
  kill() { if (this.dead) return; this.dead = true; }
  dispose() { this.game.scene.remove(this.mesh); }
}