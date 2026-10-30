// ============================================================
// js/entities/tank.js — 坦克实体（玩家 / 远程玩家 / 敌人通用）
// ============================================================

import * as THREE from 'three';
import {
  PLAYER_MAX_HP, ENEMY_MAX_HP, PLAYER_SPEED, ENEMY_SPEED,
  PLAYER_FIRE_CD, ENEMY_FIRE_CD, PLAYER_DAMAGE, ENEMY_DAMAGE,
  TANK_HIT_RADIUS, TANK_HIT_CENTER_Y, CLIMB_SPEED, WAVE_WORLD_LIMIT,
  clamp, rand, moveTowards, normalizeAngle, angleDiff,
} from '../config.js';
import { getTerrainHeight } from '../noise.js';
import { GEO } from '../geometries.js';
import { Shell } from './shell.js';

export class Tank {
  constructor(game, cfg) {
    this.game = game;
    this.team = cfg.team;
    this.isPlayer = this.team === 'player';
    this.isRemotePlayer = this.team === 'remote_player';
    this.isEnemy = this.team === 'enemy';
    this._netPlayerId = cfg.netPlayerId !== undefined ? cfg.netPlayerId : 0;
    this.shellColor = cfg.accent || 0x66ccff;
    this.maxHp = this.isPlayer ? PLAYER_MAX_HP : ENEMY_MAX_HP;
    this.hp = this.maxHp; this.dead = false;
    this.maxSpeed = this.isPlayer ? PLAYER_SPEED : ENEMY_SPEED;
    this.accel = this.isPlayer ? 70 : 16;
    this.brake = this.isPlayer ? 90 : 20;
    this.turnSpeed = this.isPlayer ? 3.5 : 2.0;
    this.turretSpeed = this.isPlayer
      ? (game.mode === 'adventure' || game.mode === 'multi' ? 8.0 : 0)
      : 2.6;
    this.fireCd = this.isPlayer ? PLAYER_FIRE_CD : ENEMY_FIRE_CD;
    this.damage = this.isPlayer ? PLAYER_DAMAGE : ENEMY_DAMAGE;
    this.hitRadius = TANK_HIT_RADIUS;
    this.speed = 0; this.yaw = cfg.yaw || 0; this.turretYaw = 0;
    this.cooldown = rand(0.3, 1.0); this.recoil = 0;
    this.groundY = 0; this.targetY = 0; this.onObstacle = null;
    this.patrolTarget = new THREE.Vector3(rand(-100, 100), 0, rand(-100, 100));
    this.patrolTimer = rand(2, 5);
    this.group = new THREE.Group();
    this.group.position.copy(cfg.position);
    this.group.position.y = getTerrainHeight(cfg.position.x, cfg.position.z);
    this.targetY = this.group.position.y;
    this.group.rotation.y = this.yaw;
    this._buildModel(cfg.color, cfg.accent);
    game.scene.add(this.group);
  }
  _buildModel(bodyColor, accentColor) {
    const matBody = new THREE.MeshStandardMaterial({
      color: bodyColor, roughness: 0.6, metalness: 0.4,
      emissive: new THREE.Color(bodyColor).multiplyScalar(0.04),
    });
    const matDark = new THREE.MeshStandardMaterial({ color: 0x1e2126, roughness: 0.8, metalness: 0.4 });
    const matTrack = new THREE.MeshStandardMaterial({ color: 0x0e1013, roughness: 0.98, metalness: 0.15 });
    const matAccent = new THREE.MeshStandardMaterial({
      color: accentColor, roughness: 0.35, metalness: 0.7,
      emissive: new THREE.Color(accentColor).multiplyScalar(0.4),
    });
    const BODY_Y = 0.85;
    const lower = new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.72, 3.9), matDark);
    lower.position.y = 0.56; lower.receiveShadow = false;
    this.group.add(lower);
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.86, 3.5), matBody);
    body.position.y = BODY_Y + 0.18; body.receiveShadow = false;
    this.group.add(body);
    const glacis = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.5, 1.1), matBody);
    glacis.position.set(0, BODY_Y - 0.12, 1.85);
    glacis.rotation.x = -0.55; glacis.receiveShadow = false;
    this.group.add(glacis);
    const rear = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.45, 0.55), matDark);
    rear.position.set(0, BODY_Y + 0.1, -2.0);
    this.group.add(rear);
    this.wheels = [];
    for (const sx of [-1, 1]) {
      const track = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.92, 4.05), matTrack);
      track.position.set(sx * 1.36, 0.58, 0);
      track.receiveShadow = false;
      this.group.add(track);
      for (let i = 0; i < 5; i++) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.66, 8), matDark);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(sx * 1.36, 0.5, -1.5 + i * 0.75);
        this.group.add(wheel); this.wheels.push(wheel);
      }
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 3.2), matAccent);
      stripe.position.set(sx * 1.68, 0.95, 0);
      this.group.add(stripe);
    }
    this.turret = new THREE.Group();
    this.turret.position.y = BODY_Y + 0.5;
    this.turret.rotation.y = 0;
    this.group.add(this.turret);
    const turretBase = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.15, 0.62, 12), matBody);
    turretBase.position.y = 0.3;
    turretBase.receiveShadow = false;
    this.turret.add(turretBase);
    const turretTop = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.42, 1.9), matBody);
    turretTop.position.set(0, 0.62, 0.08);
    turretTop.receiveShadow = false;
    this.turret.add(turretTop);
    const cupola = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.38, 0.3, 8), matDark);
    cupola.position.set(0.42, 0.9, -0.35);
    this.turret.add(cupola);
    const vision = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.1), matAccent);
    vision.position.set(0, 0.68, 0.95);
    this.turret.add(vision);
    this.barrelBaseZ = 1.55;
    this.barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.19, 2.9, 10), matDark);
    this.barrel.rotation.x = Math.PI / 2;
    this.barrel.position.set(0, 0.42, this.barrelBaseZ + 1.0);
    this.turret.add(this.barrel);
    const muzzleBrake = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.38, 10), matDark);
    muzzleBrake.rotation.x = Math.PI / 2;
    muzzleBrake.position.set(0, 0.42, this.barrelBaseZ + 2.32);
    this.turret.add(muzzleBrake);
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0.42, this.barrelBaseZ + 2.6);
    this.turret.add(this.muzzle);
    const lampMat = new THREE.MeshBasicMaterial({ color: accentColor });
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 5), lampMat);
    lamp.position.set(0, 0.92, 0.82);
    this.turret.add(lamp);
  }
  get hitCenter() {
    return new THREE.Vector3(this.group.position.x, this.group.position.y + TANK_HIT_CENTER_Y, this.group.position.z);
  }
  aimTurret(worldAngle, dt) {
    if (this.game.mode === 'wave' && !this.isRemotePlayer) {
      this.turretYaw = 0; this.turret.rotation.y = 0; return;
    }
    const target = normalizeAngle(worldAngle - this.yaw);
    const diff = angleDiff(target, this.turretYaw);
    const step = this.turretSpeed * dt;
    if (Math.abs(diff) <= step) this.turretYaw = target;
    else this.turretYaw = normalizeAngle(this.turretYaw + Math.sign(diff) * step);
    this.turret.rotation.y = this.turretYaw;
  }
  fire() {
    if (this.dead || this.cooldown > 0) return;
    this.cooldown = this.fireCd;
    this.group.updateMatrixWorld(true);
    const pos = new THREE.Vector3();
    this.muzzle.getWorldPosition(pos);
    const q = new THREE.Quaternion();
    this.muzzle.getWorldQuaternion(q);
    const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(q).normalize();
    if (!this.isPlayer) {
      const spread = 0.028;
      dir.x += rand(-spread, spread); dir.y += rand(-spread, spread) * 0.5; dir.z += rand(-spread, spread);
      dir.normalize();
    }
    this.game.addShell(new Shell(this.game, pos, dir, this));
    const P = this.game.particles;
    P.spawn(pos, 8, { speed: 15, mat: 'spark', life: 0.24, gravity: 6, size: 0.9, dir: dir.clone(), cone: 0.5, spread: 0.16 });
    P.spawn(pos, 6, { speed: 6, mat: 'smoke', life: 0.9, gravity: -2.5, size: 1.4, dir: dir.clone(), cone: 0.6, spread: 0.26 });
    P.spawn(pos, 4, { speed: 10, mat: 'fire', life: 0.2, gravity: 4, size: 1.2, dir: dir.clone(), cone: 0.4, spread: 0.22 });
    this.recoil = 0.42;
    this.game.audio.shoot(this.isPlayer ? 1 : 0.55);
    if (this.isPlayer && this.game.network && this.game.network.connected) {
      this.game.network.sendFire(pos, dir);
    }
  }
  takeDamage(dmg, source) {
    if (this.dead) return;
    this.hp -= dmg;
    this.game.onTankHit(this, dmg, source);
    if (this.hp <= 0) { this.hp = 0; this.die(); }
  }
  die() {
    if (this.dead) return;
    this.dead = true;
    const p = this.hitCenter;
    const P = this.game.particles;
    P.spawn(p, 20, { speed: 20, mat: 'fire', life: 0.95, gravity: 16, size: 1.5 });
    P.spawn(p, 14, { speed: 15, mat: 'fire2', life: 1.2, gravity: 12, size: 1.8 });
    P.spawn(p, 10, { speed: 11, mat: 'smoke', life: 2.1, gravity: -3, size: 2.2 });
    P.spawn(p, 10, { speed: 24, mat: 'spark', life: 0.8, gravity: 22, size: 1.1 });
    this.game.audio.explosion(1, 1.35);
    this.group.visible = false;
    this.game.addScorch(p.x, p.z, 2.0);
  }
  integrate(dt) {
    if (this.cooldown > 0) this.cooldown -= dt;
    const fx = Math.sin(this.yaw); const fz = Math.cos(this.yaw);
    this.group.position.x += fx * this.speed * dt;
    this.group.position.z += fz * this.speed * dt;
    if (this.game.mode === 'wave') {
      this.group.position.x = clamp(this.group.position.x, -WAVE_WORLD_LIMIT, WAVE_WORLD_LIMIT);
      this.group.position.z = clamp(this.group.position.z, -WAVE_WORLD_LIMIT, WAVE_WORLD_LIMIT);
    }
    this.group.rotation.y = this.yaw;
    this.turret.rotation.y = this.turretYaw;
    this.updateGroundHeight();
    const dy = this.targetY - this.group.position.y;
    if (Math.abs(dy) < 0.02) this.group.position.y = this.targetY;
    else {
      const climbRate = this.onObstacle ? CLIMB_SPEED : CLIMB_SPEED * 1.5;
      this.group.position.y = moveTowards(this.group.position.y, this.targetY, climbRate * dt);
    }
    if (this.recoil > 0) {
      this.recoil = Math.max(0, this.recoil - dt * 2.6);
      this.barrel.position.z = this.barrelBaseZ + 1.0 - this.recoil;
    } else this.barrel.position.z = this.barrelBaseZ + 1.0;
    const roll = this.speed * dt * 3.4;
    for (let i = 0; i < this.wheels.length; i++) this.wheels[i].rotation.x += roll;
  }
  updateGroundHeight() {
    const pos = this.group.position;
    const terrainY = getTerrainHeight(pos.x, pos.z);
    let bestY = terrainY; let bestOb = null;
    const obstacles = this.game.obstacles;
    for (let i = 0; i < obstacles.length; i++) {
      const ob = obstacles[i];
      if (ob.dead) continue;
      const pad = 0.3;
      if (pos.x > ob.min.x - pad && pos.x < ob.max.x + pad &&
          pos.z > ob.min.z - pad && pos.z < ob.max.z + pad) {
        const surfaceY = ob.max.y;
        if (surfaceY > bestY) { bestY = surfaceY; bestOb = ob; }
      }
    }
    this.targetY = bestY; this.onObstacle = bestOb;
  }
  updatePlayer(dt, input) {
    if (this.dead) return;
    let throttle = 0;
    if (input.forward) throttle += 1;
    if (input.backward) throttle -= 1;
    let steer = 0;
    if (input.left) steer += 1;
    if (input.right) steer -= 1;
    this.yaw += steer * this.turnSpeed * dt;
    this.yaw = normalizeAngle(this.yaw);
    const targetSpeed = throttle * this.maxSpeed * (throttle < 0 ? 0.62 : 1);
    const rate = (throttle !== 0 && Math.sign(throttle) !== Math.sign(this.speed) && this.speed !== 0)
      ? this.brake : (throttle !== 0 ? this.accel : this.brake);
    this.speed = moveTowards(this.speed, targetSpeed, rate * dt);
    this.integrate(dt);
  }
  updateAI(dt) {
    if (this.dead) return;
    const playerTanks = [];
    if (this.game.player && !this.game.player.dead) playerTanks.push(this.game.player);
    for (const rp of this.game.remotePlayers.values()) {
      if (rp && !rp.dead) playerTanks.push(rp);
    }
    const myPos = this.group.position;
    let throttle = 0, steer = 0;
    let targetPlayer = null, targetDist = Infinity;
    let targetDx = 0, targetDz = 0;
    for (const p of playerTanks) {
      const dx = p.group.position.x - myPos.x;
      const dz = p.group.position.z - myPos.z;
      const d = Math.hypot(dx, dz);
      if (d < targetDist) {
        targetDist = d; targetPlayer = p; targetDx = dx; targetDz = dz;
      }
    }
    if (targetPlayer && targetDist < 80) {
      const worldAngle = Math.atan2(targetDx, targetDz);
      const angDiff = angleDiff(worldAngle, this.yaw);
      if (this.game.mode === 'wave') {
        steer = clamp(angDiff * 2.2, -1, 1);
        if (Math.abs(angDiff) < 0.25) {
          if (targetDist > 22) throttle = 1;
          else if (targetDist < 12) throttle = -0.85;
          else throttle = 0;
        } else throttle = 0.2;
        if (Math.abs(angDiff) < 0.08 && targetDist < 55 && this.cooldown <= 0) this.fire();
      } else {
        this.aimTurret(worldAngle, dt);
        const aimWorld = normalizeAngle(this.yaw + this.turretYaw);
        const aimErr = Math.abs(angleDiff(worldAngle, aimWorld));
        if (targetDist > 18) throttle = 1;
        else if (targetDist < 10) throttle = -0.7;
        else throttle = 0;
        steer = clamp(angDiff * 0.6, -0.5, 0.5);
        if (aimErr < 0.1 && targetDist < 60 && this.cooldown <= 0) this.fire();
      }
    } else {
      this.patrolTimer -= dt;
      const distToTarget = Math.hypot(this.patrolTarget.x - myPos.x, this.patrolTarget.z - myPos.z);
      if (this.patrolTimer <= 0 || distToTarget < 5) {
        this.patrolTimer = rand(3.5, 7);
        this.patrolTarget.set(myPos.x + rand(-40, 40), 0, myPos.z + rand(-40, 40));
      }
      const pdx = this.patrolTarget.x - myPos.x;
      const pdz = this.patrolTarget.z - myPos.z;
      const pAngle = Math.atan2(pdx, pdz);
      const angDiff = angleDiff(pAngle, this.yaw);
      steer = clamp(angDiff * 1.7, -1, 1);
      throttle = Math.abs(angDiff) < 1.0 ? 0.62 : 0.2;
      if (this.game.mode === 'adventure' || this.game.mode === 'multi') {
        this.aimTurret(normalizeAngle(this.yaw), dt);
      }
    }
    this.yaw = normalizeAngle(this.yaw + steer * this.turnSpeed * dt);
    const targetSpeed = throttle * this.maxSpeed;
    const rate = (throttle !== 0 && Math.sign(throttle) !== Math.sign(this.speed) && this.speed !== 0)
      ? this.brake : (throttle !== 0 ? this.accel : this.brake);
    this.speed = moveTowards(this.speed, targetSpeed, rate * dt);
    this.integrate(dt);
  }
  applyRemoteState(x, z, yaw, turretYaw, hp) {
    if (hp > 0 && this.dead) { this.dead = false; this.group.visible = true; this.hp = hp; }
    if (hp <= 0) { if (!this.dead) this.die(); return; }
    this.group.position.x = x;
    this.group.position.z = z;
    this.group.position.y = getTerrainHeight(x, z);
    this.yaw = yaw; this.turretYaw = turretYaw;
    this.group.rotation.y = yaw;
    this.turret.rotation.y = turretYaw;
    this.hp = hp;
  }
  resolveCollisions() {
    if (this.dead) return;
    const pos = this.group.position;
    const r = TANK_HIT_RADIUS * 0.92;
    const obstacles = this.game.obstacles;
    for (let i = 0; i < obstacles.length; i++) {
      const ob = obstacles[i];
      if (ob.dead) continue;
      if (pos.y >= ob.max.y - 0.4) continue;
      const cx = clamp(pos.x, ob.min.x, ob.max.x);
      const cz = clamp(pos.z, ob.min.z, ob.max.z);
      let dx = pos.x - cx; let dz = pos.z - cz;
      const distSq = dx * dx + dz * dz;
      if (distSq < r * r) {
        if (distSq < 1e-8) {
          const toLeft = pos.x - ob.min.x, toRight = ob.max.x - pos.x;
          const toBack = pos.z - ob.min.z, toFront = ob.max.z - pos.z;
          const m = Math.min(toLeft, toRight, toBack, toFront);
          if (m === toLeft) pos.x = ob.min.x - r;
          else if (m === toRight) pos.x = ob.max.x + r;
          else if (m === toBack) pos.z = ob.min.z - r;
          else pos.z = ob.max.z + r;
        } else {
          const dist = Math.sqrt(distSq);
          const push = r - dist;
          pos.x += (dx / dist) * push;
          pos.z += (dz / dist) * push;
        }
      }
    }
    const tanks = this.game.tanks;
    for (let i = 0; i < tanks.length; i++) {
      const other = tanks[i];
      if (other === this || other.dead) continue;
      if (Math.abs(pos.y - other.group.position.y) > 2.0) continue;
      let dx = pos.x - other.group.position.x;
      let dz = pos.z - other.group.position.z;
      let d = Math.hypot(dx, dz);
      const minDist = r * 2;
      if (d < minDist) {
        if (d < 1e-5) { dx = rand(-1, 1); dz = rand(-1, 1); d = Math.hypot(dx, dz) || 1; }
        const push = (minDist - d) * 0.5;
        pos.x += (dx / d) * push; pos.z += (dz / d) * push;
        if (!other.dead && !other.isRemotePlayer) {
          other.group.position.x -= (dx / d) * push;
          other.group.position.z -= (dz / d) * push;
        }
      }
    }
    if (this.game.mode === 'wave') {
      pos.x = clamp(pos.x, -WAVE_WORLD_LIMIT, WAVE_WORLD_LIMIT);
      pos.z = clamp(pos.z, -WAVE_WORLD_LIMIT, WAVE_WORLD_LIMIT);
    }
  }
  dispose() {
    this.game.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.isMesh) {
        if (o.geometry && o.geometry !== GEO.shellBody && o.geometry !== GEO.shellGlow) o.geometry.dispose();
        if (o.material && o.material.dispose && !o.material.__shared) o.material.dispose();
      }
    });
  }
}