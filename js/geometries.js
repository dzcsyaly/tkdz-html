// ============================================================
// js/geometries.js — 共享几何体与材质缓存（Obstacle/Mine/Shell 共用）
// ============================================================

import * as THREE from 'three';

// Obstacle 与 Mine 共享的几何体
export const SHARED_GEO = {
  obstacleBox: new THREE.BoxGeometry(1, 1, 1),
  obstacleCap: new THREE.BoxGeometry(1, 1, 1),
  mineBody: new THREE.CylinderGeometry(0.55, 0.6, 0.3, 10),
  mineLed: new THREE.SphereGeometry(0.12, 6, 5),
  mineRing: new THREE.RingGeometry(1.87, 2.2, 16),
};

// Shell 几何体
export const GEO = {
  shellBody: new THREE.SphereGeometry(0.26, 6, 5),
  shellGlow: new THREE.SphereGeometry(0.6, 6, 5),
};

// 玩家炮弹材质按颜色缓存
export const playerShellMatCache = {};
export function getPlayerShellMats(color) {
  if (playerShellMatCache[color]) return playerShellMatCache[color];
  const mats = {
    body: new THREE.MeshStandardMaterial({
      color: color, roughness: 0.3, metalness: 0.9,
      emissive: new THREE.Color(color).multiplyScalar(0.6),
    }),
    glow: new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.4, depthWrite: false }),
  };
  playerShellMatCache[color] = mats;
  return mats;
}

// 敌军炮弹材质（单一共享）
export const SHELL_MATS = {
  enemy: {
    body: new THREE.MeshStandardMaterial({
      color: 0xff7744, roughness: 0.35, metalness: 0.85,
      emissive: new THREE.Color(0xff3300).multiplyScalar(0.6),
    }),
    glow: new THREE.MeshBasicMaterial({ color: 0xff3300, transparent: true, opacity: 0.4, depthWrite: false }),
  },
};