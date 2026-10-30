// ============================================================
// js/entities/obstacle.js — 障碍物实体
// ============================================================

import * as THREE from 'three';
import { OBSTACLE_HP, rand } from '../config.js';
import { getTerrainHeight } from '../noise.js';
import { SHARED_GEO } from '../geometries.js';

export class Obstacle {
  constructor(game, cfg) {
    this.game = game; this.dead = false;
    this.hp = cfg.hp !== undefined ? cfg.hp : OBSTACLE_HP;
    this.maxHp = this.hp;
    this.w = cfg.w; this.d = cfg.d; this.h = cfg.h; this.color = cfg.color;
    const baseY = getTerrainHeight(cfg.x, cfg.z);
    this.baseY = baseY;
    this.min = new THREE.Vector3(cfg.x - this.w / 2, baseY, cfg.z - this.d / 2);
    this.max = new THREE.Vector3(cfg.x + this.w / 2, baseY + this.h, cfg.z + this.d / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: this.color, roughness: 0.9, metalness: 0.1,
    });
    this.mesh = new THREE.Mesh(SHARED_GEO.obstacleBox, mat);
    this.mesh.scale.set(this.w, this.h, this.d);
    this.mesh.position.set(cfg.x, baseY + this.h / 2, cfg.z);
    this.mesh.receiveShadow = false;
    game.scene.add(this.mesh);
    const capMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.color).multiplyScalar(0.65), roughness: 0.95, metalness: 0.1,
    });
    this.cap = new THREE.Mesh(SHARED_GEO.obstacleCap, capMat);
    this.cap.scale.set(this.w + 0.4, 0.35, this.d + 0.4);
    this.cap.position.set(cfg.x, baseY + this.h + 0.16, cfg.z);
    this.cap.receiveShadow = false;
    game.scene.add(this.cap);
    this.flashTimer = 0;
  }
  takeDamage(dmg, source) {
    if (this.dead) return;
    this.hp -= 1;
    this.flashTimer = 0.12;
    if (this.mesh.material) {
      this.mesh.material.emissive = new THREE.Color(0xffffff);
      this.mesh.material.emissiveIntensity = 1.0;
    }
    const p = new THREE.Vector3(
      this.mesh.position.x + rand(-this.w * 0.4, this.w * 0.4),
      this.baseY + rand(0.4, this.h),
      this.mesh.position.z + rand(-this.d * 0.4, this.d * 0.4)
    );
    const P = this.game.particles;
    P.spawn(p, 6, { speed: 9, mat: 'debris', life: 0.7, gravity: 18, size: 0.75 });
    P.spawn(p, 4, { speed: 5, mat: 'smoke', life: 0.9, gravity: -2, size: 1.1 });
    P.spawn(p, 4, { speed: 11, mat: 'spark', life: 0.4, gravity: 15, size: 0.65 });
    this.game.audio.crack();
    if (this.hp <= 0) this.destroy();
  }
  destroy() {
    if (this.dead) return;
    this.dead = true;
    const p = new THREE.Vector3(this.mesh.position.x, this.baseY + this.h * 0.5, this.mesh.position.z);
    const P = this.game.particles;
    P.spawn(p, 18, { speed: 22, mat: 'fire', life: 1.1, gravity: 16, size: 1.7 });
    P.spawn(p, 12, { speed: 17, mat: 'fire2', life: 1.4, gravity: 12, size: 2.1 });
    P.spawn(p, 10, { speed: 12, mat: 'smoke', life: 2.4, gravity: -3, size: 2.6 });
    P.spawn(p, 10, { speed: 26, mat: 'spark', life: 0.9, gravity: 22, size: 1.2 });
    P.spawn(p, 14, { speed: 18, mat: 'debris', life: 1.8, gravity: 22, size: 1.3 });
    this.game.audio.explosion(1, 1.6);
    this.game.scene.remove(this.mesh);
    this.game.scene.remove(this.cap);
    this.mesh.material.dispose();
    this.cap.material.dispose();
    this.game.addScorch(p.x, p.z, this.w * 0.8);
  }
  update(dt) {
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0 && this.mesh.material) {
        this.mesh.material.emissiveIntensity = 0;
        this.mesh.material.emissive = new THREE.Color(0x000000);
      }
    }
  }
  dispose() {
    if (this.dead) return;
    this.game.scene.remove(this.mesh);
    this.game.scene.remove(this.cap);
    this.mesh.material.dispose();
    this.cap.material.dispose();
  }
}