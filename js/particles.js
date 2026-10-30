// ============================================================
// js/particles.js — 粒子特效池
// ============================================================

import * as THREE from 'three';
import { PARTICLES_TOTAL, rand } from './config.js';
import { getTerrainHeight } from './noise.js';

export class Particles {
  constructor(scene) {
    this.scene = scene;
    this.geo = new THREE.SphereGeometry(0.22, 5, 4);
    this.mats = {
      fire: new THREE.MeshBasicMaterial({ color: 0xff9a2e }),
      fire2: new THREE.MeshBasicMaterial({ color: 0xff4d1a }),
      smoke: new THREE.MeshBasicMaterial({ color: 0x606060 }),
      dark: new THREE.MeshBasicMaterial({ color: 0x2a2a2a }),
      dirt: new THREE.MeshBasicMaterial({ color: 0x7a6644 }),
      spark: new THREE.MeshBasicMaterial({ color: 0xffe98a }),
      debris: new THREE.MeshBasicMaterial({ color: 0x8a8275 }),
    };
    this.pool = []; this.alive = [];
    for (let i = 0; i < PARTICLES_TOTAL; i++) {
      const m = new THREE.Mesh(this.geo, this.mats.fire);
      m.visible = false; m.frustumCulled = false;
      m.userData.vel = new THREE.Vector3();
      m.userData.life = 0; m.userData.maxLife = 1;
      m.userData.gravity = 0; m.userData.size = 1; m.userData.spin = 0;
      scene.add(m); this.pool.push(m);
    }
  }
  spawn(pos, count, opt = {}) {
    const { speed = 9, mat = 'fire', life = 0.7, gravity = 18, size = 1, spread = 0.35, up = 1, dir = null, cone = 1 } = opt;
    const material = this.mats[mat] || this.mats.fire;
    for (let i = 0; i < count; i++) {
      const m = this.pool.pop(); if (!m) return;
      m.visible = true; m.material = material;
      m.position.set(pos.x + rand(-spread, spread), pos.y + rand(-spread, spread), pos.z + rand(-spread, spread));
      let vx, vy, vz;
      if (dir) { const r = () => rand(-cone, cone); vx = dir.x + r(); vy = dir.y + r(); vz = dir.z + r(); }
      else { vx = rand(-1, 1); vy = rand(-0.25, up); vz = rand(-1, 1); }
      const v = new THREE.Vector3(vx, vy, vz);
      if (v.lengthSq() < 1e-6) v.set(0, 1, 0);
      v.normalize().multiplyScalar(rand(speed * 0.35, speed));
      m.userData.vel.copy(v);
      m.userData.life = rand(life * 0.6, life * 1.25);
      m.userData.maxLife = m.userData.life;
      m.userData.gravity = gravity;
      m.userData.size = size * rand(0.65, 1.4);
      m.userData.spin = rand(-3, 3);
      m.scale.setScalar(m.userData.size);
      m.rotation.set(rand(0, 6.28), rand(0, 6.28), rand(0, 6.28));
      this.alive.push(m);
    }
  }
  update(dt) {
    for (let i = this.alive.length - 1; i >= 0; i--) {
      const m = this.alive[i]; const u = m.userData;
      u.life -= dt;
      if (u.life <= 0) { m.visible = false; this.alive.splice(i, 1); this.pool.push(m); continue; }
      u.vel.y -= u.gravity * dt;
      u.vel.multiplyScalar(1 - Math.min(dt * 1.6, 0.6));
      m.position.addScaledVector(u.vel, dt);
      const groundY = getTerrainHeight(m.position.x, m.position.z) + 0.06;
      if (m.position.y < groundY) {
        m.position.y = groundY; u.vel.y = Math.abs(u.vel.y) * 0.28;
        u.vel.x *= 0.72; u.vel.z *= 0.72;
      }
      const k = u.life / u.maxLife;
      m.scale.setScalar(u.size * (0.28 + k * 0.95));
      m.rotation.x += dt * u.spin;
      m.rotation.y += dt * u.spin * 0.8;
    }
  }
  clear() { while (this.alive.length) { const m = this.alive.pop(); m.visible = false; this.pool.push(m); } }
}