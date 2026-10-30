// ============================================================
// js/entities/mine.js — 地雷实体
// ============================================================

import * as THREE from 'three';
import { MINE_DAMAGE, MINE_LIFE, MINE_TRIGGER_R } from '../config.js';
import { getTerrainHeight } from '../noise.js';
import { SHARED_GEO } from '../geometries.js';

export class Mine {
  constructor(game, pos, owner) {
    this.game = game; this.owner = owner;
    this.damage = MINE_DAMAGE; this.life = MINE_LIFE; this.dead = false;
    this.armDelay = 0.8; this.triggerR = MINE_TRIGGER_R;
    const g = new THREE.Group();
    g.position.copy(pos);
    g.position.y = getTerrainHeight(pos.x, pos.z) + 0.15;
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.5, metalness: 0.8 });
    const body = new THREE.Mesh(SHARED_GEO.mineBody, bodyMat);
    body.receiveShadow = false;
    g.add(body);
    const ledMat = new THREE.MeshBasicMaterial({ color: 0xff2200 });
    this.led = new THREE.Mesh(SHARED_GEO.mineLed, ledMat);
    this.led.position.y = 0.2;
    g.add(this.led); this.ledMat = ledMat;
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xff3300, transparent: true, opacity: 0.15,
      side: THREE.DoubleSide, depthWrite: false,
    });
    this.ring = new THREE.Mesh(SHARED_GEO.mineRing, ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.02;
    g.add(this.ring); this.ringMat = ringMat;
    this.group = g; game.scene.add(g);
  }
  update(dt) {
    if (this.dead) return;
    if (this.armDelay > 0) {
      this.armDelay -= dt;
      const blink = (Math.sin(performance.now() * 0.008) + 1) * 0.5;
      this.ledMat.color.setRGB(1, blink * 0.6, 0);
      this.ringMat.opacity = 0.08; return;
    }
    const blink = (Math.sin(performance.now() * 0.02) + 1) * 0.5;
    this.ledMat.color.setRGB(1, blink * 0.2, 0);
    this.ringMat.opacity = 0.15 + blink * 0.12;
    this.life -= dt;
    if (this.life <= 0) { this.explode(false); return; }
    const tanks = this.game.tanks;
    for (let i = 0; i < tanks.length; i++) {
      const t = tanks[i];
      if (t.dead) continue;
      if (t.team === 'player' || t.team === 'remote_player') continue;
      const dx = t.group.position.x - this.group.position.x;
      const dz = t.group.position.z - this.group.position.z;
      if (dx * dx + dz * dz < this.triggerR * this.triggerR) {
        t.takeDamage(this.damage, this.owner);
        this.explode(true); return;
      }
    }
  }
  explode(triggered) {
    if (this.dead) return;
    this.dead = true;
    const p = this.group.position.clone(); p.y += 0.5;
    const P = this.game.particles;
    P.spawn(p, 18, { speed: 22, mat: 'fire', life: 1.0, gravity: 16, size: 1.6 });
    P.spawn(p, 14, { speed: 16, mat: 'fire2', life: 1.3, gravity: 12, size: 1.9 });
    P.spawn(p, 10, { speed: 11, mat: 'smoke', life: 2.2, gravity: -3, size: 2.4 });
    P.spawn(p, 10, { speed: 26, mat: 'spark', life: 0.8, gravity: 22, size: 1.1 });
    P.spawn(p, 10, { speed: 13, mat: 'dirt', life: 1.1, gravity: 20, size: 1.4 });
    this.game.audio.mineBoom();
    this.game.addScorch(p.x, p.z, 2.5);
  }
  dispose() {
    this.game.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.isMesh) {
        if (o.material && o.material.dispose) o.material.dispose();
      }
    });
  }
}