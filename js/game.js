// ============================================================
// js/game.js — Game 主类（世界 / 循环 / HUD / 分屏 / 网络回调）
// ============================================================

import * as THREE from 'three';
import {
  SPLIT_INDEX, SPLIT_TOTAL, IS_SPLIT_INSTANCE, LOW_QUALITY,
  SPLIT_ROOM_KEY, SPLIT_HOST_TIME_KEY,
  WAVE_WORLD_SIZE, WAVE_HALF_WORLD, WAVE_WORLD_LIMIT,
  ADV_TERRAIN_SIZE, ADV_TERRAIN_SEG, ADV_RECENTER_THRESHOLD,
  ADV_SPAWN_RADIUS, ADV_SPAWN_MIN, ADV_MAX_ENEMIES, ADV_POINT_CHECK_R,
  ADV_OBSTACLE_TARGET, ADV_OBSTACLE_SPAWN_INTERVAL,
  SHELL_SPEED, SHELL_LIFE,
  CAM_DIST, CAM_HEIGHT, CAM_LOOK_AHEAD,
  MAX_ENEMIES, EXTRA_ENEMIES, TOTAL_ENEMY_CAP,
  MINE_COOLDOWN, MINE_TRIGGER_R, MINE_DAMAGE, MINE_LIFE, MAX_MINES,
  OBSTACLE_HP, OBSTACLE_TARGET, ULT_COOLDOWN,
  PIXEL_RATIO_MAX, MAX_FPS,
  PLAYER_COLORS,
  clamp, rand, randInt, moveTowards, normalizeAngle, angleDiff,
} from './config.js';
import { TerrainSystem, getTerrainHeight } from './noise.js';
import { Particles } from './particles.js';
import { AudioManager } from './audio.js';
import { NetworkManager } from './network.js';
import { Tank } from './entities/tank.js';
import { Shell } from './entities/shell.js';
import { Obstacle } from './entities/obstacle.js';
import { Mine } from './entities/mine.js';

export class Game {
  constructor() {
    this.state = 'menu';
    this.mode = 'wave';
    this.clock = new THREE.Clock();
    this.shells = []; this.enemies = []; this.tanks = [];
    this.obstacles = []; this.scorches = []; this.mines = [];
    this.score = 0; this.wave = 0;
    this.wavePending = false; this.waveTimer = 0;
    this.mineCooldown = 0; this.ultCooldown = 0;
    this.firstPerson = true;
    this.terrainCenterX = 0; this.terrainCenterZ = 0;
    this.advSpawnTimer = 0; this.advSpawnInterval = 0.5;
    this.advObstacleSpawnTimer = 0;
    this.network = null;
    this.remotePlayers = new Map();
    this.remoteEnemyNextId = 0;
    this.hostLobbyPlayers = new Map();
    this.audio = new AudioManager();
    this.input = {
      forward: false, backward: false, left: false, right: false,
      fire: false, mine: false, ult: false, aimX: 0, aimY: 0,
    };
    this._fpsAccum = 0; this._fpsFrames = 0; this._fps = 0;
    this.splitAutoRoom = false;
    this.splitAutoStartTimer = 0;
    this._splitRetryAborted = false;
    this._lastFrameTime = 0;
    this._frameInterval = 1000 / MAX_FPS;

    if (IS_SPLIT_INSTANCE) this._applySplitInstanceMode();

    this.initRenderer();
    this.initScene();
    this.initWorld();
    this.initInput();
    this.initTouchControls();
    this.initUI();

    this.renderer.setAnimationLoop((ts) => this.tick(ts));
    window.__gameStarted = true;
    const loading = document.getElementById('loading');
    if (loading) loading.classList.add('hidden');

    if (IS_SPLIT_INSTANCE) {
      setTimeout(() => this._startSplitAutoRoom(), 300);
    }
  }

  _applySplitInstanceMode() {
    const screens = ['menuScreen', 'multiLobby', 'hostWait', 'joinInput', 'pauseScreen', 'overScreen', 'splitMenuScreen'];
    for (const id of screens) {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    }
    const hint = document.getElementById('hint');
    if (hint) hint.style.display = 'none';
    const viewHint = document.getElementById('viewHint');
    if (viewHint) viewHint.style.display = 'none';
  }

  async _startSplitAutoRoom() {
    this.audio.init(); this.audio.resume();
    this.splitAutoRoom = true;

    if (SPLIT_INDEX === 0) {
      await this._hostCreateRoomWithRetry();
    } else {
      await this._clientJoinRoomWithRetry();
    }
  }

  async _hostCreateRoomWithRetry() {
    for (let attempt = 1; attempt <= 5; attempt++) {
      if (this._splitRetryAborted) return;
      try {
        try {
          localStorage.removeItem(SPLIT_ROOM_KEY);
          localStorage.removeItem(SPLIT_HOST_TIME_KEY);
        } catch (e) {}

        if (this.network) {
          try { this.network.disconnect(); } catch (e) {}
          this.network = null;
        }

        this.showBanner(`创建房间中... (${attempt}/5)`);
        this.network = new NetworkManager(this);
        const code = await this.network.createRoom();
        localStorage.setItem(SPLIT_ROOM_KEY, code);
        localStorage.setItem(SPLIT_HOST_TIME_KEY, String(Date.now()));

        this.showBanner(`房主已创建房间 ${code}`);
        this.splitAutoStartTimer = 8.0;
        this.hostLobbyPlayers.set(0, 0);
        return;
      } catch (err) {
        console.error(`分屏房主创建房间失败（第 ${attempt}/5 次）:`, err);
        if (attempt >= 5) {
          this.showBanner('创建房间失败，请刷新页面');
          return;
        }
        this.showBanner(`创建失败，2秒后重试 (${attempt}/5)`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  async _clientJoinRoomWithRetry() {
    let code = null;
    const waitStart = Date.now();
    while (Date.now() - waitStart < 15000) {
      if (this._splitRetryAborted) return;
      try { code = localStorage.getItem(SPLIT_ROOM_KEY); } catch (e) { code = null; }
      if (code && code.length === 6) break;
      await new Promise(r => setTimeout(r, 100));
    }

    if (!code || code.length !== 6) {
      this.showBanner('无法获取房间码');
      return;
    }

    await new Promise(r => setTimeout(r, 200 + SPLIT_INDEX * 150));

    for (let attempt = 1; attempt <= 5; attempt++) {
      if (this._splitRetryAborted) return;
      try {
        let latestCode = null;
        try { latestCode = localStorage.getItem(SPLIT_ROOM_KEY); } catch (e) {}
        if (!latestCode || latestCode.length !== 6) {
          throw new Error('房间码丢失');
        }

        if (this.network) {
          try { this.network.disconnect(); } catch (e) {}
          this.network = null;
        }

        this.showBanner(`加入房间中... (${attempt}/5)`);
        this.network = new NetworkManager(this);
        await this.network.joinRoom(latestCode);
        this.showBanner(`已加入房间 ${latestCode}`);
        return;
      } catch (err) {
        console.error(`分屏客机加入失败（第 ${attempt}/5 次）:`, err);
        if (attempt >= 5) {
          this.showBanner('加入房间失败，请刷新页面');
          return;
        }
        this.showBanner(`加入失败，2秒后重试 (${attempt}/5)`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  _checkSplitStart(dt) {
    if (!this.splitAutoRoom || SPLIT_INDEX !== 0) return;
    if (!this.network || !this.network.isHost) return;
    if (this.state === 'playing') return;

    if (this.splitAutoStartTimer > 0) {
      this.splitAutoStartTimer -= dt;
    }

    const allJoined = this.hostLobbyPlayers.size >= SPLIT_TOTAL;
    const timeout = this.splitAutoStartTimer <= 0;

    if (allJoined || timeout) {
      setTimeout(() => {
        if (this.state !== 'playing' && this.network && this.network.isHost) {
          this.startMultiGame(this.network.sharedSeed, 0, 0, true);
        }
      }, 400);
      this.splitAutoStartTimer = 9999;
    }
  }

  initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, PIXEL_RATIO_MAX));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = false;
    this.renderer.shadowMap.type = THREE.BasicShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ReinhardToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.sortObjects = true;
    document.body.appendChild(this.renderer.domElement);
  }

  initScene() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xb8d4e8, 100, 500);
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.2, 1800);
    this.camera.position.set(0, CAM_HEIGHT, -CAM_DIST);
    this.camLook = new THREE.Vector3(0, 1.6, 0);
    this.camera.lookAt(this.camLook);
    const skyGeo = new THREE.SphereGeometry(1200, 16, 8);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x1a3a6e) },
        midColor: { value: new THREE.Color(0x6a9ec8) },
        bottomColor: { value: new THREE.Color(0xd8e8f0) },
        offset: { value: 80 }, exponent: { value: 0.65 },
      },
      vertexShader: `varying vec3 vWorldPos;
        void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);}`,
      fragmentShader: `uniform vec3 topColor; uniform vec3 midColor; uniform vec3 bottomColor;
        uniform float offset; uniform float exponent; varying vec3 vWorldPos;
        void main(){ float h = normalize(vWorldPos + vec3(0.0,offset,0.0)).y;
        float t = pow(max(h,0.0),exponent);
        vec3 col = mix(bottomColor, midColor, smoothstep(0.0,0.5,t));
        col = mix(col, topColor, smoothstep(0.5,1.0,t));
        gl_FragColor = vec4(col,1.0);}`,
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.frustumCulled = false;
    this.scene.add(sky);
    this.scene.add(new THREE.HemisphereLight(0xd0e8f8, 0x4a5a3a, 1.2));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const sun = new THREE.DirectionalLight(0xfff4e0, 2.0);
    sun.position.set(100, 150, 80);
    sun.castShadow = false;
    sun.target.position.set(0, 0, 0);
    this.scene.add(sun); this.scene.add(sun.target);
    this.sun = sun;
    const fill = new THREE.DirectionalLight(0x88aaff, 0.5);
    fill.position.set(-100, 80, -120);
    this.scene.add(fill);
  }

  initWorld() {
    TerrainSystem.init('wave');
    this.buildTerrain('wave');
    this.particles = new Particles(this.scene);
  }

  buildTerrain(mode) {
    if (this.ground) {
      this.scene.remove(this.ground);
      this.ground.geometry.dispose();
      this.ground.material.dispose();
      this.ground = null;
    }
    if (this.walls) {
      for (const w of this.walls) {
        this.scene.remove(w); w.geometry.dispose(); w.material.dispose();
      }
      this.walls = null;
    }
    const isAdv = mode === 'adventure' || mode === 'multi';
    const size = isAdv ? ADV_TERRAIN_SIZE : WAVE_WORLD_SIZE;
    const seg = isAdv ? ADV_TERRAIN_SEG : (LOW_QUALITY ? 48 : 64);
    const terrainGeo = new THREE.PlaneGeometry(size, size, seg, seg);
    const posAttr = terrainGeo.attributes.position;
    const centerX = isAdv ? this.terrainCenterX : 0;
    const centerZ = isAdv ? this.terrainCenterZ : 0;
    for (let i = 0; i < posAttr.count; i++) {
      const lx = posAttr.getX(i), lz = -posAttr.getY(i);
      const wx = lx + centerX, wz = lz + centerZ;
      posAttr.setZ(i, getTerrainHeight(wx, wz));
    }
    terrainGeo.computeVertexNormals();
    const groundTex = this.makeGroundTexture(isAdv);
    const groundMat = new THREE.MeshStandardMaterial({
      map: groundTex, roughness: 1.0, metalness: 0.0,
    });
    const terrain = new THREE.Mesh(terrainGeo, groundMat);
    terrain.rotation.x = -Math.PI / 2;
    terrain.position.x = centerX; terrain.position.z = centerZ;
    terrain.receiveShadow = false;
    this.scene.add(terrain);
    this.ground = terrain;
    if (!isAdv) {
      const wallMat = new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.9, metalness: 0.1 });
      const wallH = 5.0, wallT = 3.0, half = WAVE_HALF_WORLD;
      const defs = [
        { x: 0, z: -half, w: WAVE_WORLD_SIZE + wallT, d: wallT },
        { x: 0, z: half, w: WAVE_WORLD_SIZE + wallT, d: wallT },
        { x: -half, z: 0, w: wallT, d: WAVE_WORLD_SIZE + wallT },
        { x: half, z: 0, w: wallT, d: WAVE_WORLD_SIZE + wallT },
      ];
      this.walls = [];
      for (const w of defs) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w.w, wallH, w.d), wallMat);
        mesh.position.set(w.x, wallH / 2 - 2, w.z);
        this.scene.add(mesh);
        this.walls.push(mesh);
      }
    }
    this.scene.fog = new THREE.Fog(0xb8d4e8, isAdv ? 180 : 100, isAdv ? 500 : 450);
  }

  makeGroundTexture(isAdv) {
    const S = LOW_QUALITY ? 128 : 256;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d');
    ctx.fillStyle = isAdv ? '#4a6b3a' : '#4c6b3c';
    ctx.fillRect(0, 0, S, S);
    const iter1 = LOW_QUALITY ? 20 : 40;
    for (let i = 0; i < iter1; i++) {
      const x = Math.random() * S, y = Math.random() * S, r = rand(8, 30);
      const g = Math.random();
      ctx.fillStyle = `rgba(${(58 + g * 46) | 0},${(84 + g * 52) | 0},${(48 + g * 34) | 0},0.4)`;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    const iter2 = LOW_QUALITY ? 1000 : 2500;
    for (let i = 0; i < iter2; i++) {
      const x = Math.random() * S, y = Math.random() * S, g = Math.random();
      ctx.fillStyle = `rgba(${(40 + g * 70) | 0},${(70 + g * 76) | 0},${(34 + g * 56) | 0},0.5)`;
      const s = 1 + Math.random() * 2.0;
      ctx.fillRect(x, y, s, s);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(isAdv ? 20 : 16, isAdv ? 20 : 16);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 1;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  }

  buildObstaclesWave() {
    const palette = [0x8d8577, 0x9a8f7e, 0x7b7368, 0xa39a8a, 0x6f7a6a, 0x88817a, 0x97907f, 0x7d8580];
    const placed = [];
    const TARGET = LOW_QUALITY ? Math.floor(OBSTACLE_TARGET * 0.5) : OBSTACLE_TARGET;
    for (let tries = 0; tries < 4000 && placed.length < TARGET; tries++) {
      const w = rand(2.5, 7.0), d = rand(2.5, 7.0), h = rand(2.0, 5.0);
      const x = rand(-WAVE_HALF_WORLD + 15, WAVE_HALF_WORLD - 15);
      const z = rand(-WAVE_HALF_WORLD + 15, WAVE_HALF_WORLD - 15);
      if (Math.hypot(x, z) < 12) continue;
      let ok = true;
      for (const p of placed) {
        if (x - w/2 - 2.5 < p.x + p.w/2 && x + w/2 + 2.5 > p.x - p.w/2 &&
            z - d/2 - 2.5 < p.z + p.d/2 && z + d/2 + 2.5 > p.z - p.d/2) { ok = false; break; }
      }
      if (!ok) continue;
      placed.push({ x, z, w, d, h });
    }
    for (const p of placed) {
      const color = palette[randInt(0, palette.length - 1)];
      this.obstacles.push(new Obstacle(this, { x: p.x, z: p.z, w: p.w, d: p.d, h: p.h, color, hp: OBSTACLE_HP }));
    }
  }

  updateAdventureObstacleSpawner(dt) {
    if (!this.player || this.player.dead) return;
    if (this.obstacles.length >= ADV_OBSTACLE_TARGET) return;
    this.advObstacleSpawnTimer -= dt;
    if (this.advObstacleSpawnTimer > 0) return;
    this.advObstacleSpawnTimer = ADV_OBSTACLE_SPAWN_INTERVAL;
    const px = this.player.group.position.x;
    const pz = this.player.group.position.z;
    const palette = [0x8d8577, 0x9a8f7e, 0x7b7368, 0xa39a8a, 0x6f7a6a, 0x88817a, 0x97907f, 0x7d8580];
    for (let attempt = 0; attempt < 3; attempt++) {
      if (this.obstacles.length >= ADV_OBSTACLE_TARGET) break;
      const angle = rand(0, Math.PI * 2);
      const dist = rand(ADV_SPAWN_MIN, ADV_SPAWN_RADIUS);
      let x = px + Math.cos(angle) * dist;
      let z = pz + Math.sin(angle) * dist;
      let hasOtherPoint = false;
      for (const ob of this.obstacles) {
        if (ob.dead) continue;
        const dx = ob.mesh.position.x - x, dz = ob.mesh.position.z - z;
        if (dx * dx + dz * dz < ADV_POINT_CHECK_R * ADV_POINT_CHECK_R) { hasOtherPoint = true; break; }
      }
      if (hasOtherPoint) continue;
      const walkSteps = randInt(1, 4);
      for (let s = 0; s < walkSteps; s++) { x += rand(-4, 4); z += rand(-4, 4); }
      const newDist = Math.hypot(x - px, z - pz);
      if (newDist > ADV_SPAWN_RADIUS || newDist < ADV_SPAWN_MIN - 10) continue;
      const w = rand(2.5, 6.5), d = rand(2.5, 6.5), h = rand(2.0, 5.0);
      const color = palette[randInt(0, palette.length - 1)];
      this.obstacles.push(new Obstacle(this, { x, z, w, d, h, color, hp: OBSTACLE_HP }));
    }
  }

  updateAdventureObstacleCleanup() {
    if (!this.player) return;
    const px = this.player.group.position.x;
    const pz = this.player.group.position.z;
    const limitSq = ADV_SPAWN_RADIUS * ADV_SPAWN_RADIUS;
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const ob = this.obstacles[i];
      if (ob.dead) continue;
      const dx = ob.mesh.position.x - px, dz = ob.mesh.position.z - pz;
      if (dx * dx + dz * dz > limitSq) { ob.dispose(); this.obstacles.splice(i, 1); }
    }
  }

  buildObstacles() {
    if (this.mode === 'adventure' || this.mode === 'multi') {
      for (let i = 0; i < 30; i++) this.updateAdventureObstacleSpawner(1.0);
    } else this.buildObstaclesWave();
  }

  isBlocked(x, z, pad = 3) {
    for (const ob of this.obstacles) {
      if (ob.dead) continue;
      if (x > ob.min.x - pad && x < ob.max.x + pad && z > ob.min.z - pad && z < ob.max.z + pad) return true;
    }
    return false;
  }

  addScorch(x, z, radius = null) {
    const r = radius || rand(1.6, 2.4);
    const geo = new THREE.CircleGeometry(r, 8);
    const mat = new THREE.MeshBasicMaterial({ color: 0x1a1a18, transparent: true, opacity: 0.55, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, getTerrainHeight(x, z) + 0.03, z);
    this.scene.add(mesh);
    this.scorches.push({ mesh, life: 12, maxOpacity: 0.55 });
    if (this.scorches.length > 25) {
      const old = this.scorches.shift();
      this.scene.remove(old.mesh);
      old.mesh.geometry.dispose(); old.mesh.material.dispose();
    }
  }

  createPlayer(colorIdx = 0) {
    const colors = PLAYER_COLORS[colorIdx % PLAYER_COLORS.length];
    const p = new Tank(this, {
      position: new THREE.Vector3(0, 0, 0),
      color: colors.body, accent: colors.accent, team: 'player', yaw: 0,
      netPlayerId: colorIdx === 0 ? 0 : this.network ? this.network.myPlayerId : 0,
    });
    this.player = p;
    this.tanks.push(p);
    p.group.visible = !this.firstPerson;
    return p;
  }

  createRemotePlayer(pid, colorIdx) {
    const colors = PLAYER_COLORS[colorIdx % PLAYER_COLORS.length];
    const rp = new Tank(this, {
      position: new THREE.Vector3(rand(-30, 30), 0, rand(-30, 30)),
      color: colors.body, accent: colors.accent, team: 'remote_player', yaw: 0,
      netPlayerId: pid,
    });
    this.remotePlayers.set(pid, rp);
    this.tanks.push(rp);
    return rp;
  }

  removeRemotePlayer(pid) {
    const rp = this.remotePlayers.get(pid);
    if (!rp) return;
    rp.dispose();
    const ti = this.tanks.indexOf(rp);
    if (ti >= 0) this.tanks.splice(ti, 1);
    this.remotePlayers.delete(pid);
  }

  placeMine() {
    if (!this.player || this.player.dead) return false;
    if (this.mineCooldown > 0) return false;
    if (this.mines.length >= MAX_MINES) { const old = this.mines.shift(); old.dispose(); }
    const pos = this.player.group.position.clone();
    pos.y = 0;
    for (const m of this.mines) {
      if (m.dead) continue;
      const dx = m.group.position.x - pos.x, dz = m.group.position.z - pos.z;
      if (dx * dx + dz * dz < 3) return false;
    }
    const mine = new Mine(this, pos, this.player);
    this.mines.push(mine);
    this.mineCooldown = MINE_COOLDOWN;
    this.audio.minePlace();
    this.particles.spawn(
      new THREE.Vector3(pos.x, getTerrainHeight(pos.x, pos.z) + 0.3, pos.z),
      6, { speed: 4, mat: 'dirt', life: 0.7, gravity: 18, size: 0.85 });
    return true;
  }

  useUltimate() {
    if (!this.player || this.player.dead) return false;
    if (this.ultCooldown > 0) return false;
    this.ultCooldown = ULT_COOLDOWN;
    this.audio.ultimate();
    const myPos = this.player.group.position;
    const flash = this.el.flash;
    if (flash) {
      flash.style.transition = 'opacity 0.05s';
      flash.style.background = 'radial-gradient(ellipse at center, rgba(255,255,255,0.9) 0%, rgba(255,200,50,0.6) 100%)';
      flash.style.opacity = '1';
      setTimeout(() => {
        flash.style.transition = 'opacity 0.8s'; flash.style.opacity = '0';
        setTimeout(() => { flash.style.background = 'radial-gradient(ellipse at center, rgba(255,0,0,0) 35%, rgba(255,0,0,.65) 100%)'; }, 800);
      }, 60);
    }
    let killed = 0;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.dead) continue;
      e.takeDamage(e.maxHp, this.player); killed++;
    }
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const ob = this.obstacles[i];
      if (ob.dead) continue;
      ob.takeDamage(999, this.player);
    }
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i];
      if (!m.dead) m.explode(false);
    }
    this.particles.spawn(new THREE.Vector3(myPos.x, myPos.y + 2, myPos.z), 30,
      { speed: 45, mat: 'fire', life: 1.6, gravity: 8, size: 2.8 });
    this.particles.spawn(new THREE.Vector3(myPos.x, myPos.y + 2, myPos.z), 20,
      { speed: 35, mat: 'spark', life: 1.1, gravity: 12, size: 1.7 });
    this.showBanner(`清图！消灭 ${killed} 个敌人`);
    return true;
  }

  spawnWave(n) {
    const baseCount = 3 + Math.floor(n * 1.1);
    const count = Math.min(Math.floor((baseCount + EXTRA_ENEMIES) * 3), TOTAL_ENEMY_CAP);
    const colors = [0x8a3a2a, 0x7a5a2a, 0x6a3a4a, 0x5a4a2a, 0x8a6a3a, 0x6a2a2a];
    for (let i = 0; i < count; i++) {
      const pos = this.findSpawnPointWave();
      const color = colors[randInt(0, colors.length - 1)];
      const dirX = this.player.group.position.x - pos.x;
      const dirZ = this.player.group.position.z - pos.z;
      const yaw = Math.atan2(dirX, dirZ) + rand(-0.4, 0.4);
      const enemy = new Tank(this, { position: pos, color, accent: 0xff4422, team: 'enemy', yaw });
      if (this.network && this.network.isHost) {
        enemy._netId = this.remoteEnemyNextId++;
        enemy._netColor = color;
      }
      this.enemies.push(enemy);
      this.tanks.push(enemy);
    }
    this.showBanner(`第 ${n} 波 · ${count} 敌`);
    this.updateHUD();
  }

  findSpawnPointWave() {
    for (let i = 0; i < 120; i++) {
      const x = rand(-WAVE_WORLD_LIMIT + 5, WAVE_WORLD_LIMIT - 5);
      const z = rand(-WAVE_WORLD_LIMIT + 5, WAVE_WORLD_LIMIT - 5);
      const distToPlayer = Math.hypot(x - this.player.group.position.x, z - this.player.group.position.z);
      if (distToPlayer < 30) continue;
      if (this.isBlocked(x, z, 3)) continue;
      let tooClose = false;
      for (const e of this.enemies) {
        if (Math.hypot(x - e.group.position.x, z - e.group.position.z) < 5) { tooClose = true; break; }
      }
      if (tooClose) continue;
      return new THREE.Vector3(x, 0, z);
    }
    return new THREE.Vector3(rand(-WAVE_WORLD_LIMIT + 5, WAVE_WORLD_LIMIT - 5), 0,
      rand(-WAVE_WORLD_LIMIT + 5, WAVE_WORLD_LIMIT - 5));
  }

  updateAdventureSpawner(dt) {
    const playerTanks = [];
    if (this.player && !this.player.dead) playerTanks.push(this.player);
    for (const rp of this.remotePlayers.values()) {
      if (rp && !rp.dead) playerTanks.push(rp);
    }
    if (playerTanks.length === 0) return;

    if (this.enemies.length >= ADV_MAX_ENEMIES) return;
    this.advSpawnTimer -= dt;
    if (this.advSpawnTimer > 0) return;
    this.advSpawnTimer = this.advSpawnInterval;

    const perPlayerCap = Math.max(20, Math.ceil(ADV_MAX_ENEMIES / playerTanks.length));
    const checkRadiusSq = ADV_SPAWN_RADIUS * ADV_SPAWN_RADIUS;

    for (let attempt = 0; attempt < 3; attempt++) {
      if (this.enemies.length >= ADV_MAX_ENEMIES) break;

      const refPlayer = playerTanks[Math.floor(Math.random() * playerTanks.length)];
      const px = refPlayer.group.position.x;
      const pz = refPlayer.group.position.z;

      let nearbyEnemies = 0;
      for (const e of this.enemies) {
        if (e.dead) continue;
        const dx = e.group.position.x - px;
        const dz = e.group.position.z - pz;
        if (dx * dx + dz * dz < checkRadiusSq) nearbyEnemies++;
      }
      if (nearbyEnemies >= perPlayerCap) continue;

      const angle = rand(0, Math.PI * 2);
      const dist = rand(ADV_SPAWN_MIN, ADV_SPAWN_RADIUS);
      let x = px + Math.cos(angle) * dist;
      let z = pz + Math.sin(angle) * dist;

      let hasOtherPoint = false;
      for (const e of this.enemies) {
        if (e.dead) continue;
        const dx = e.group.position.x - x;
        const dz = e.group.position.z - z;
        if (dx * dx + dz * dz < ADV_POINT_CHECK_R * ADV_POINT_CHECK_R) { hasOtherPoint = true; break; }
      }
      if (hasOtherPoint) continue;

      const walkSteps = randInt(1, 4);
      for (let s = 0; s < walkSteps; s++) { x += rand(-4, 4); z += rand(-4, 4); }

      const newDist = Math.hypot(x - px, z - pz);
      if (newDist > ADV_SPAWN_RADIUS) continue;

      const colors = [0x8a3a2a, 0x7a5a2a, 0x6a3a4a, 0x5a4a2a, 0x8a6a3a, 0x6a2a2a];
      const color = colors[randInt(0, colors.length - 1)];
      const yaw = Math.atan2(px - x, pz - z) + rand(-0.4, 0.4);
      const enemy = new Tank(this, { position: new THREE.Vector3(x, 0, z), color, accent: 0xff4422, team: 'enemy', yaw });
      if (this.network && this.network.isHost) {
        enemy._netId = this.remoteEnemyNextId++;
        enemy._netColor = color;
      }
      this.enemies.push(enemy);
      this.tanks.push(enemy);
    }
  }

  updateAdventureCleanup() {
    if (!this.player) return;
    const px = this.player.group.position.x, pz = this.player.group.position.z;
    const limitSq = ADV_SPAWN_RADIUS * ADV_SPAWN_RADIUS;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.dead) {
        this.enemies.splice(i, 1);
        const ti = this.tanks.indexOf(e);
        if (ti >= 0) this.tanks.splice(ti, 1);
        continue;
      }
      const dx = e.group.position.x - px, dz = e.group.position.z - pz;
      if (dx * dx + dz * dz > limitSq) {
        e.group.visible = false; e.dead = true;
        this.scene.remove(e.group);
        this.enemies.splice(i, 1);
        const ti = this.tanks.indexOf(e);
        if (ti >= 0) this.tanks.splice(ti, 1);
      }
    }
  }

  updateAdventureTerrain() {
    if (!this.player) return;
    const px = this.player.group.position.x, pz = this.player.group.position.z;
    const dx = px - this.terrainCenterX, dz = pz - this.terrainCenterZ;
    if (dx * dx + dz * dz > ADV_RECENTER_THRESHOLD * ADV_RECENTER_THRESHOLD) {
      this.terrainCenterX = px;
      this.terrainCenterZ = pz;
      this.buildTerrain('adventure');
    }
  }

  syncRemoteEnemies() {
    if (!this.network || !this.network.remoteEnemyData) return;
    const data = this.network.remoteEnemyData;
    const pendingKills = this.network._clientPendingKills;
    const now = performance.now();
    const seen = new Set();
    const colors = [0x8a3a2a, 0x7a5a2a, 0x6a3a4a, 0x5a4a2a, 0x8a6a3a, 0x6a2a2a];

    // 1) 先按超时规则剔除过期预测击杀，让主机状态重新接管
    if (pendingKills.size > 0) {
      for (const [id, t] of pendingKills) {
        if (now - t > 3000) pendingKills.delete(id);
      }
    }

    // 2) 处理主机广播
    for (const item of data) {
      seen.add(item.id);
      // 本地预测击杀未确认：忽略主机的"还活着"状态
      if (pendingKills.has(item.id)) continue;

      let enemy = this.enemies.find(e => e._netId === item.id);
      if (!enemy) {
        enemy = new Tank(this, {
          position: new THREE.Vector3(item.x, 0, item.z),
          color: item.color || colors[randInt(0, colors.length - 1)],
          accent: 0xff4422, team: 'enemy', yaw: item.yaw || 0,
        });
        enemy._netId = item.id; enemy._netColor = item.color;
        enemy._isRemoteSynced = true;
        this.enemies.push(enemy); this.tanks.push(enemy);
      }
      enemy.group.position.x = item.x;
      enemy.group.position.z = item.z;
      enemy.group.position.y = getTerrainHeight(item.x, item.z);
      enemy.yaw = item.yaw;
      enemy.turretYaw = item.turretYaw || 0;
      enemy.group.rotation.y = item.yaw;
      enemy.turret.rotation.y = enemy.turretYaw;
      if (enemy.hp !== item.hp) enemy.hp = item.hp;
    }

    // 3) 主机已不广播的本地 synced 敌人 = 主机确认死亡
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e._isRemoteSynced && !seen.has(e._netId)) {
        if (pendingKills.has(e._netId)) pendingKills.delete(e._netId);
        e.group.visible = false; e.dead = true;
        this.scene.remove(e.group);
        this.enemies.splice(i, 1);
        const ti = this.tanks.indexOf(e);
        if (ti >= 0) this.tanks.splice(ti, 1);
      }
    }
  }

  syncRemotePlayers() {
    if (!this.network) return;
    const states = this.network.remotePlayersData;
    const seen = new Set();
    for (const [pid, state] of states) {
      if (pid === this.network.myPlayerId) continue;
      seen.add(pid);
      let rp = this.remotePlayers.get(pid);
      if (!rp) {
        let colorIdx = pid % PLAYER_COLORS.length;
        if (this.network.isHost) {
          const entry = this.network.conns.find(c => c.playerId === pid);
          if (entry) colorIdx = entry.colorIdx;
        } else if (state.colorIdx !== undefined) colorIdx = state.colorIdx;
        rp = this.createRemotePlayer(pid, colorIdx);
      }
      rp.applyRemoteState(state.x, state.z, state.yaw, state.turretYaw, state.hp);
    }
    const toRemove = [];
    for (const [pid] of this.remotePlayers) { if (!seen.has(pid)) toRemove.push(pid); }
    for (const pid of toRemove) this.removeRemotePlayer(pid);
  }

  initInput() {
    const self = this;
    window.addEventListener('keydown', (e) => {
      switch (e.code) {
        case 'KeyW': case 'ArrowUp': self.input.forward = true; e.preventDefault(); break;
        case 'KeyS': case 'ArrowDown': self.input.backward = true; e.preventDefault(); break;
        case 'KeyA': case 'ArrowLeft': self.input.left = true; e.preventDefault(); break;
        case 'KeyD': case 'ArrowRight': self.input.right = true; e.preventDefault(); break;
        case 'Space': self.input.fire = true; e.preventDefault(); break;
        case 'KeyE': self.input.mine = true; self.tryPlaceMine(); e.preventDefault(); break;
        case 'KeyQ': self.input.ult = true; self.tryUseUltimate(); e.preventDefault(); break;
        case 'KeyV': self.toggleView(); e.preventDefault(); break;
        case 'KeyP': case 'Escape': self.togglePause(); e.preventDefault(); break;
        case 'KeyR': if (self.state !== 'menu') self.restart(); e.preventDefault(); break;
        case 'KeyM': self.toggleMute(); e.preventDefault(); break;
      }
    }, { passive: false });
    window.addEventListener('keyup', (e) => {
      switch (e.code) {
        case 'KeyW': case 'ArrowUp': self.input.forward = false; break;
        case 'KeyS': case 'ArrowDown': self.input.backward = false; break;
        case 'KeyA': case 'ArrowLeft': self.input.left = false; break;
        case 'KeyD': case 'ArrowRight': self.input.right = false; break;
        case 'Space': self.input.fire = false; break;
        case 'KeyE': self.input.mine = false; break;
        case 'KeyQ': self.input.ult = false; break;
      }
    });
    window.addEventListener('pointermove', (e) => {
      if (e.target && e.target.closest && e.target.closest('#touchControls')) return;
      self.input.aimX = (e.clientX / window.innerWidth) * 2 - 1;
      self.input.aimY = -(e.clientY / window.innerHeight) * 2 + 1;
      const ch = document.getElementById('crosshair');
      if (ch) { ch.style.left = e.clientX + 'px'; ch.style.top = e.clientY + 'px'; }
    });
    window.addEventListener('pointerdown', (e) => {
      if (e.target && e.target.closest && e.target.closest('#touchControls')) return;
      if (e.button === 0) { self.input.fire = true; self.audio.resume(); }
    });
    window.addEventListener('pointerup', (e) => {
      if (e.target && e.target.closest && e.target.closest('#touchControls')) return;
      if (e.button === 0) self.input.fire = false;
    });
    window.addEventListener('blur', () => {
      self.input.forward = false; self.input.backward = false;
      self.input.left = false; self.input.right = false;
      self.input.fire = false; self.input.mine = false; self.input.ult = false;
      if (self.state === 'playing' && !IS_SPLIT_INSTANCE) self.togglePause();
    });
    window.addEventListener('resize', () => {
      self.camera.aspect = window.innerWidth / window.innerHeight;
      self.camera.updateProjectionMatrix();
      self.renderer.setSize(window.innerWidth, window.innerHeight);
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  initTouchControls() {
    const self = this;
    const tc = document.getElementById('touchControls');
    if (tc) {
      tc.addEventListener('pointerdown', (e) => e.stopPropagation());
      tc.addEventListener('pointerup', (e) => e.stopPropagation());
      tc.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: false });
      tc.addEventListener('touchend', (e) => e.stopPropagation(), { passive: false });
    }
    function bindHold(el, onPress, onRelease) {
      if (!el) return;
      let active = false, pointerId = null;
      const press = (e) => {
        e.preventDefault(); e.stopPropagation();
        if (active) return;
        active = true; pointerId = e.pointerId;
        el.classList.add('active');
        try { el.setPointerCapture(e.pointerId); } catch (err) {}
        self.audio.resume(); onPress && onPress();
      };
      const release = (e) => {
        if (!active) return;
        if (pointerId !== null && e.pointerId !== undefined && e.pointerId !== pointerId) return;
        e.preventDefault(); e.stopPropagation();
        active = false; pointerId = null;
        el.classList.remove('active'); onRelease && onRelease();
      };
      el.addEventListener('pointerdown', press);
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
      el.addEventListener('pointerleave', (e) => {
        if (e.pointerType === 'mouse' && active) {
          active = false; pointerId = null;
          el.classList.remove('active'); onRelease && onRelease();
        }
      });
      el.addEventListener('touchstart', (e) => { e.preventDefault(); }, { passive: false });
    }
    function bindTap(el, onTap) {
      if (!el) return;
      let fired = false;
      const handler = (e) => {
        e.preventDefault(); e.stopPropagation();
        if (fired) return;
        fired = true;
        setTimeout(() => { fired = false; }, 120);
        el.classList.add('active');
        setTimeout(() => el.classList.remove('active'), 140);
        self.audio.resume(); onTap && onTap();
      };
      el.addEventListener('pointerdown', handler);
      el.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); }, { passive: false });
    }
    bindHold(document.getElementById('btnUp'), () => { self.input.forward = true; }, () => { self.input.forward = false; });
    bindHold(document.getElementById('btnDown'), () => { self.input.backward = true; }, () => { self.input.backward = false; });
    bindHold(document.getElementById('btnLeft'), () => { self.input.left = true; }, () => { self.input.left = false; });
    bindHold(document.getElementById('btnRight'), () => { self.input.right = true; }, () => { self.input.right = false; });
    bindHold(document.getElementById('btnFire'), () => { self.input.fire = true; }, () => { self.input.fire = false; });
    bindTap(document.getElementById('btnMine'), () => { self.tryPlaceMine(); });
    bindTap(document.getElementById('btnUlt'), () => { self.tryUseUltimate(); });
    bindTap(document.getElementById('btnView'), () => { self.toggleView(); });
    bindTap(document.getElementById('btnPauseTouch'), () => {
      if (self.state === 'playing' || self.state === 'paused') self.togglePause();
    });
  }

  toggleView() {
    this.firstPerson = !this.firstPerson;
    if (this.player && !this.player.dead) this.player.group.visible = !this.firstPerson;
    const vh = document.getElementById('viewHint');
    if (vh) vh.textContent = this.firstPerson ? '视角：第一人称 [V]' : '视角：第三人称 [V]';
  }
  tryPlaceMine() { if (this.state === 'playing') this.placeMine(); }
  tryUseUltimate() { if (this.state === 'playing') this.useUltimate(); }

  updateMuteButtons() {
    const m = this.audio.muted;
    const icon = m ? '🔇' : '🔊';
    const menuBtn = document.getElementById('btnMuteMenu');
    if (menuBtn) {
      const ic = menuBtn.querySelector('.mIcon');
      const tx = menuBtn.querySelector('.mText');
      if (ic) ic.textContent = icon;
      if (tx) tx.textContent = m ? '音效已静音 · 点击开启' : '音效已开启 · 点击静音';
      menuBtn.classList.toggle('muted', m);
    }
    const splitBtn = document.getElementById('btnMuteSplitMenu');
    if (splitBtn) {
      const ic = splitBtn.querySelector('.mIcon');
      const tx = splitBtn.querySelector('.mText');
      if (ic) ic.textContent = icon;
      if (tx) tx.textContent = m ? '音效已静音 · 点击开启' : '音效已开启 · 点击静音';
      splitBtn.classList.toggle('muted', m);
    }
    const splitBarBtn = document.getElementById('splitBtnMute');
    if (splitBarBtn) {
      splitBarBtn.textContent = m ? '🔇 已静音' : '🔊 音效开';
    }
  }

  initUI() {
    const self = this;
    this.el = {
      healthFill: document.getElementById('healthFill'),
      healthText: document.getElementById('healthText'),
      score: document.getElementById('uiScore'),
      wave: document.getElementById('uiWave'),
      waveLabel: document.getElementById('uiWaveLabel'),
      enemies: document.getElementById('uiEnemies'),
      banner: document.getElementById('waveBanner'),
      flash: document.getElementById('damageFlash'),
      fps: document.getElementById('fps'),
      crosshair: document.getElementById('crosshair'),
      menu: document.getElementById('menuScreen'),
      pause: document.getElementById('pauseScreen'),
      over: document.getElementById('overScreen'),
      overStats: document.getElementById('overStats'),
      mineCdFill: document.getElementById('mineCdFill'),
      mineLabel: document.getElementById('mineLabel'),
      ultCdFill: document.getElementById('ultCdFill'),
      ultLabel: document.getElementById('ultLabel'),
      advInfo: document.getElementById('advInfo'),
      advPoints: document.getElementById('advPoints'),
      netInfo: document.getElementById('netInfo'),
      netStatus: document.getElementById('netStatus'),
      netRole: document.getElementById('netRole'),
      netRoom: document.getElementById('netRoom'),
      netPlayerCount: document.getElementById('netPlayerCount'),
      netPlayerList: document.getElementById('netPlayerList'),
      multiLobby: document.getElementById('multiLobby'),
      hostWait: document.getElementById('hostWait'),
      joinInput: document.getElementById('joinInput'),
      roomCodeDisplay: document.getElementById('roomCodeDisplay'),
      hostStatus: document.getElementById('hostStatus'),
      roomCodeInput: document.getElementById('roomCodeInput'),
      joinStatus: document.getElementById('joinStatus'),
      connectedPlayersList: document.getElementById('connectedPlayersList'),
      splitMenu: document.getElementById('splitMenuScreen'),
    };

    const btnMuteMenu = document.getElementById('btnMuteMenu');
    if (btnMuteMenu) {
      btnMuteMenu.addEventListener('click', () => {
        self.audio.init();
        self.audio.resume();
        self.toggleMute();
        self.updateMuteButtons();
      });
    }
    const btnMuteSplitMenu = document.getElementById('btnMuteSplitMenu');
    if (btnMuteSplitMenu) {
      btnMuteSplitMenu.addEventListener('click', () => {
        self.audio.init();
        self.audio.resume();
        self.toggleMute();
        self.updateMuteButtons();
      });
    }
    const splitBtnMute = document.getElementById('splitBtnMute');
    if (splitBtnMute) {
      splitBtnMute.addEventListener('click', () => {
        self.audio.init();
        self.audio.resume();
        self.toggleMute();
        self.updateMuteButtons();
        try {
          const iframes = document.querySelectorAll('#splitGrid iframe');
          for (const f of iframes) {
            try { f.contentWindow.postMessage({ type: 'set_mute', muted: self.audio.muted }, '*'); } catch (e) {}
          }
        } catch (e) {}
      });
    }

    window.addEventListener('message', (e) => {
      if (e && e.data && e.data.type === 'set_mute') {
        self.audio.init();
        self.audio.muted = !!e.data.muted;
        writeMuteStateLocal(self.audio.muted);
        if (self.audio.master && self.audio.ctx) {
          self.audio.master.gain.setTargetAtTime(self.audio.muted ? 0 : 0.34, self.audio.ctx.currentTime, 0.03);
        }
      }
    });

    document.getElementById('btnModeWave').addEventListener('click', () => {
      self.audio.init(); self.audio.resume(); self.startGame('wave');
    });
    document.getElementById('btnModeAdventure').addEventListener('click', () => {
      self.audio.init(); self.audio.resume(); self.startGame('adventure');
    });
    document.getElementById('btnModeMulti').addEventListener('click', () => {
      self.audio.init(); self.audio.resume();
      self.el.menu.classList.add('hidden');
      self.el.multiLobby.classList.remove('hidden');
    });
    document.getElementById('btnModeSplit').addEventListener('click', () => {
      self.audio.init(); self.audio.resume();
      self.el.menu.classList.add('hidden');
      self.el.splitMenu.classList.remove('hidden');
      self.updateMuteButtons();
    });
    document.getElementById('btnSplitBack').addEventListener('click', () => {
      self.el.splitMenu.classList.add('hidden');
      self.el.menu.classList.remove('hidden');
    });
    document.querySelectorAll('#splitMenuScreen [data-split]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const count = parseInt(btn.getAttribute('data-count'));
        self.launchSplitMode(count);
      });
    });
    document.getElementById('btnCreateRoom').addEventListener('click', () => self.hostCreateRoom());
    document.getElementById('btnJoinRoom').addEventListener('click', () => {
      self.el.multiLobby.classList.add('hidden');
      self.el.joinInput.classList.remove('hidden');
      setTimeout(() => self.el.roomCodeInput.focus(), 100);
    });
    document.getElementById('btnBackMenu').addEventListener('click', () => {
      self.el.multiLobby.classList.add('hidden');
      self.el.menu.classList.remove('hidden');
    });
    document.getElementById('btnCancelHost').addEventListener('click', () => {
      if (self.network) { self.network.disconnect(); self.network = null; }
      self.el.hostWait.classList.add('hidden');
      self.el.multiLobby.classList.remove('hidden');
      self.hostLobbyPlayers.clear();
    });
    document.getElementById('btnCancelJoin').addEventListener('click', () => {
      self.el.joinInput.classList.add('hidden');
      self.el.multiLobby.classList.remove('hidden');
    });
    document.getElementById('btnStartMultiGame').addEventListener('click', () => {
      if (self.network && self.network.isHost) {
        self.el.hostWait.classList.add('hidden');
        self.startMultiGame(self.network.sharedSeed, 0, 0, true);
      }
    });
    document.getElementById('btnConnect').addEventListener('click', () => self.joinExistingRoom());
    self.el.roomCodeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') self.joinExistingRoom();
    });
    document.getElementById('btnResume').addEventListener('click', () => self.togglePause());
    document.getElementById('btnRestart1').addEventListener('click', () => self.restart());
    document.getElementById('btnRestart2').addEventListener('click', () => self.restart());
    document.getElementById('btnMenu1').addEventListener('click', () => self.backToMenu());
    document.getElementById('btnMenu2').addEventListener('click', () => self.backToMenu());
    document.getElementById('splitBtnExit').addEventListener('click', () => this.exitSplitMode());
    document.getElementById('splitBtnFullscreen').addEventListener('click', () => {
      const el = document.getElementById('splitOverlay');
      if (!document.fullscreenElement) {
        if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
      } else {
        if (document.exitFullscreen) document.exitFullscreen();
      }
    });

    this.updateMuteButtons();
  }

  launchSplitMode(count) {
    const overlay = document.getElementById('splitOverlay');
    const grid = document.getElementById('splitGrid');
    const title = document.getElementById('splitTitle');

    grid.innerHTML = '';
    try {
      localStorage.removeItem(SPLIT_ROOM_KEY);
      localStorage.removeItem(SPLIT_HOST_TIME_KEY);
    } catch (e) {}

    grid.className = 'grid-' + count;

    const lowQuality = count >= 4;
    title.textContent = `分屏模式 · ${count} 个实例 · 同一房间 · 从左到右排列`;

    const baseUrl = window.location.origin + window.location.pathname;
    for (let i = 0; i < count; i++) {
      const iframe = document.createElement('iframe');
      const params = new URLSearchParams();
      params.set('split', String(i));
      params.set('splitTotal', String(count));
      if (lowQuality) params.set('lowQuality', '1');
      iframe.src = baseUrl + '?' + params.toString();
      iframe.allow = 'autoplay; fullscreen';
      iframe.setAttribute('scrolling', 'no');
      grid.appendChild(iframe);
    }

    overlay.classList.add('show');
    this.el.splitMenu.classList.add('hidden');
  }

  exitSplitMode() {
    this._splitRetryAborted = true;
    const overlay = document.getElementById('splitOverlay');
    const grid = document.getElementById('splitGrid');
    grid.innerHTML = '';
    overlay.classList.remove('show');
    try {
      localStorage.removeItem(SPLIT_ROOM_KEY);
      localStorage.removeItem(SPLIT_HOST_TIME_KEY);
    } catch (e) {}
    this.el.menu.classList.remove('hidden');
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
  }

  async hostCreateRoom() {
    this.el.multiLobby.classList.add('hidden');
    this.el.hostWait.classList.remove('hidden');
    this.el.hostStatus.textContent = '正在创建房间…';
    this.el.roomCodeDisplay.textContent = '------';
    this.hostLobbyPlayers.clear();
    this.updateHostPlayerList();
    try {
      this.network = new NetworkManager(this);
      const code = await this.network.createRoom();
      this.el.roomCodeDisplay.textContent = code;
      this.el.hostStatus.textContent = '等待其他玩家加入…';
      this.hostLobbyPlayers.set(0, 0);
      this.updateHostPlayerList();
    } catch (err) {
      this.el.hostStatus.textContent = '创建失败: ' + (err.message || err);
    }
  }

  async joinExistingRoom() {
    const code = (this.el.roomCodeInput.value || '').trim().toUpperCase();
    if (code.length !== 6) { this.el.joinStatus.textContent = '请输入 6 位房间码'; return; }
    this.el.joinStatus.textContent = '正在连接…';
    try {
      this.network = new NetworkManager(this);
      await this.network.joinRoom(code);
      this.el.joinStatus.textContent = '已连接！等待房主开始游戏…';
    } catch (err) {
      this.el.joinStatus.textContent = '连接失败: ' + (err.message || err);
    }
  }

  onMultiPlayerJoined(pid, colorIdx) {
    this.hostLobbyPlayers.set(pid, colorIdx);
    this.updateHostPlayerList();
    if (this.state === 'playing' && this.mode === 'multi') {
      if (!this.remotePlayers.has(pid)) this.createRemotePlayer(pid, colorIdx);
    }
  }
  onMultiPlayerLeft(pid) {
    this.hostLobbyPlayers.delete(pid);
    this.updateHostPlayerList();
    if (this.mode === 'multi') this.removeRemotePlayer(pid);
  }

  updateHostPlayerList() {
    const list = this.el.connectedPlayersList;
    if (!list) return;
    list.innerHTML = '';
    const all = new Map();
    all.set(0, 0);
    for (const [pid, cIdx] of this.hostLobbyPlayers) all.set(pid, cIdx);
    for (const [pid, cIdx] of all) {
      const colors = PLAYER_COLORS[cIdx % PLAYER_COLORS.length];
      const row = document.createElement('div');
      row.className = 'pitem';
      row.innerHTML = `<span class="dot" style="background:#${colors.accent.toString(16).padStart(6, '0')};box-shadow:0 0 6px #${colors.accent.toString(16).padStart(6, '0')}"></span>
        <span class="pname">玩家 ${pid === 0 ? '(房主)' : pid}</span>
        <span class="ptag">${colors.name}</span>`;
      list.appendChild(row);
    }
  }

  onNetworkConnected() {}
  onNetworkDisconnected() {
    this.showBanner('与主机断开连接');
    if (this.el.netStatus) this.el.netStatus.classList.remove('on');
  }

  // ===== 新增 =====
  onReconnectSuccess() {
    this.showBanner('重新连接成功');
    if (this.el.netStatus) this.el.netStatus.classList.add('on');
  }

  onReconnectFailed() {
    this.showBanner('重连失败 · 即将返回菜单');
    if (this.el.netStatus) this.el.netStatus.classList.remove('on');
    setTimeout(() => {
      if (this.state === 'playing' || this.state === 'paused') {
        this.backToMenu();
      }
    }, 2500);
  }

  startMultiGame(seed, myPlayerId, myColorIdx, isHost) {
    this.mode = 'multi';
    TerrainSystem.init('multi', seed);
    this.resetWorld();
    if (this.player) {
      this.player.dispose();
      const ti = this.tanks.indexOf(this.player);
      if (ti >= 0) this.tanks.splice(ti, 1);
      this.player = null;
    }
    this.createPlayer(myColorIdx);
    if (this.network) {
      this.network.myPlayerId = myPlayerId;
      this.network._clientPendingKills.clear();   // ← 新增：世界重建时清空预测击杀
    }
    this.state = 'playing';
    this.el.menu.classList.add('hidden');
    this.el.multiLobby.classList.add('hidden');
    this.el.hostWait.classList.add('hidden');
    this.el.joinInput.classList.add('hidden');
    this.el.over.classList.add('hidden');
    this.el.pause.classList.add('hidden');
    this.el.crosshair.style.opacity = '1';
    this.el.netInfo.classList.add('show');
    this.el.netStatus.classList.add('on');
    this.el.netRole.textContent = isHost ? '房主' : '玩家 ' + myPlayerId;
    this.el.netRoom.textContent = this.network ? this.network.roomCode : '------';
    this.audio.init(); this.audio.resume(); this.audio.engineStart();
    this.wave = 0; this.wavePending = false; this.waveTimer = 0;
    this.advSpawnTimer = 0; this.advObstacleSpawnTimer = 0;
    if (isHost) { for (let i = 0; i < 30; i++) this.updateAdventureSpawner(0.5); }
    this.showBanner(isHost ? '多人模式 · 房主' : '多人模式 · 玩家 ' + myPlayerId);
    this.clock.getDelta();
    this.updateHUD();
  }

  backToMenu() {
    this.audio.engineStop();
    if (this.network) { this.network.disconnect(); this.network = null; }
    this.resetWorld();
    this.hostLobbyPlayers.clear();
    this.state = 'menu'; this.mode = 'wave';
    this.el.menu.classList.remove('hidden');
    this.el.over.classList.add('hidden');
    this.el.pause.classList.add('hidden');
    this.el.multiLobby.classList.add('hidden');
    this.el.hostWait.classList.add('hidden');
    this.el.joinInput.classList.add('hidden');
    this.el.splitMenu.classList.add('hidden');
    this.el.netInfo.classList.remove('show');
    this.el.crosshair.style.opacity = '0.3';
    TerrainSystem.init('wave');
    this.buildTerrain('wave');
    this.particles = this.particles || new Particles(this.scene);
    this.camera.position.set(0, CAM_HEIGHT, -CAM_DIST);
    this.camLook.set(0, 1.6, 0);
    this.camera.lookAt(this.camLook);
    this.updateHUD();
  }

  resetWorld() {
    for (const s of this.shells) s.dispose();
    this.shells.length = 0;
    for (const m of this.mines) m.dispose();
    this.mines.length = 0;
    this.mineCooldown = 0; this.ultCooldown = 0;
    for (const ob of this.obstacles) ob.dispose();
    this.obstacles.length = 0;
    for (const t of this.tanks) t.dispose();
    this.tanks.length = 0;
    this.enemies.length = 0;
    this.player = null;
    this.remotePlayers.clear();
    if (this.particles) this.particles.clear();
    for (const s of this.scorches) {
      this.scene.remove(s.mesh); s.mesh.geometry.dispose(); s.mesh.material.dispose();
    }
    this.scorches.length = 0;
    this.score = 0;
    this.input.fire = false; this.input.mine = false; this.input.ult = false;
    this.input.forward = false; this.input.backward = false;
    this.input.left = false; this.input.right = false;
    this.terrainCenterX = 0; this.terrainCenterZ = 0;
    this.advObstacleSpawnTimer = 0;
    this.remoteEnemyNextId = 0;
    TerrainSystem._heightCache.clear();
    this.buildTerrain(this.mode);
    this.createPlayer(0);
    this.buildObstacles();
    this.camera.position.set(0, CAM_HEIGHT, -CAM_DIST);
    this.camLook.set(0, 1.6, 0);
    this.camera.lookAt(this.camLook);
    this.updateHUD();
  }

  restart() {
    this.audio.engineStop();
    if (this.mode === 'multi' && this.network) {
      this.startMultiGame(this.network.sharedSeed, this.network.myPlayerId,
        this.network.isHost ? 0 : (this.network.myPlayerId % PLAYER_COLORS.length),
        this.network.isHost);
    } else this.startGame(this.mode);
    this.showBanner('战斗开始');
  }

  togglePause() {
    if (this.state === 'playing') {
      this.state = 'paused';
      this.el.pause.classList.remove('hidden');
      this.el.crosshair.style.opacity = '0.2';
      this.audio.engineUpdate(0, false);
      this.input.forward = false; this.input.backward = false;
      this.input.left = false; this.input.right = false;
      this.input.fire = false;
    } else if (this.state === 'paused') {
      this.state = 'playing';
      this.el.pause.classList.add('hidden');
      this.el.crosshair.style.opacity = '1';
      this.clock.getDelta();
    }
  }

  toggleMute() {
    this.audio.setMuted(!this.audio.muted);
    this.updateMuteButtons();
  }

  gameOver() {
    if (this.state === 'over') return;
    this.state = 'over';
    this.audio.engineStop();
    this.el.crosshair.style.opacity = '0.15';
    let stats;
    if (this.mode === 'multi') {
      stats = `多人模式 · 你被击毁了<br>最终得分：<b style="color:#ffcc33">${this.score}</b>`;
    } else if (this.mode === 'adventure') {
      stats = `冒险模式 · 消灭 ${Math.floor(this.score / 100)} 敌<br>最终得分：<b style="color:#ffcc33">${this.score}</b>`;
    } else {
      const survived = Math.max(1, this.wave);
      stats = `你坚守到了第 <b style="color:#ffcc33">${survived}</b> 波<br>最终得分：<b style="color:#ffcc33">${this.score}</b>`;
    }
    this.el.overStats.innerHTML = stats;
    if (IS_SPLIT_INSTANCE) {
      this.showBanner('被击毁 · 即将重开');
      setTimeout(() => {
        if (this.state === 'over') {
          if (this.mode === 'multi' && this.network && this.network.connected) {
            if (this.player) {
              this.player.dead = false;
              this.player.hp = this.player.maxHp;
              this.player.group.visible = !this.firstPerson;
            }
            this.state = 'playing';
            this.el.crosshair.style.opacity = '1';
          } else {
            this.restart();
          }
        }
      }, 2500);
    } else {
      this.el.over.classList.remove('hidden');
    }
  }

  tick(timestamp) {
    const now = timestamp || performance.now();
    const elapsed = now - this._lastFrameTime;
    if (elapsed < this._frameInterval) return;
    this._lastFrameTime = now - (elapsed % this._frameInterval);

    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.update(dt);
    this.renderer.render(this.scene, this.camera);

    this._fpsAccum += dt; this._fpsFrames++;
    if (this._fpsAccum >= 0.5) {
      this._fps = Math.round(this._fpsFrames / this._fpsAccum);
      this._fpsAccum = 0; this._fpsFrames = 0;
      if (this.el.fps) this.el.fps.textContent = `${this._fps} FPS`;
    }
  }

  update(dt) {
    if (IS_SPLIT_INSTANCE) this._checkSplitStart(dt);

    for (let i = this.scorches.length - 1; i >= 0; i--) {
      const s = this.scorches[i]; s.life -= dt;
      if (s.life <= 0) {
        this.scene.remove(s.mesh); s.mesh.geometry.dispose(); s.mesh.material.dispose();
        this.scorches.splice(i, 1);
      } else if (s.life < 3) s.mesh.material.opacity = s.maxOpacity * (s.life / 3);
    }
    if (this.state === 'playing') {
      if (this.mineCooldown > 0) { this.mineCooldown -= dt; if (this.mineCooldown < 0) this.mineCooldown = 0; }
      if (this.ultCooldown > 0) { this.ultCooldown -= dt; if (this.ultCooldown < 0) this.ultCooldown = 0; }
      this.updatePlayer(dt);
      this.updateEnemies(dt);
      this.updateMines(dt);
      this.updateObstacles(dt);
      this.updateShells(dt);
      if (this.mode === 'wave') this.updateSpawner(dt);
      else if (this.mode === 'adventure') {
        this.updateAdventureSpawner(dt);
        this.updateAdventureCleanup();
        this.updateAdventureObstacleSpawner(dt);
        this.updateAdventureObstacleCleanup();
        this.updateAdventureTerrain();
      } else if (this.mode === 'multi') {
        if (this.network) {
          this.network.update(dt);
          this.syncRemotePlayers();
          for (const ev of this.network._pendingFireEvents) {
            const colors = PLAYER_COLORS[(ev.colorIdx || 0) % PLAYER_COLORS.length];
            const fakeOwner = { team: 'remote_player', damage: 0, shellColor: colors.accent };
            const shell = new Shell(this, ev.pos, ev.dir, fakeOwner);
            shell.speed = SHELL_SPEED;
            this.addShell(shell);
          }
          this.network._pendingFireEvents.length = 0;
          if (!this.network.isHost) this.syncRemoteEnemies();
        }
        if (this.network && this.network.isHost) {
          this.updateAdventureSpawner(dt);
          this.updateAdventureCleanup();
          this.updateAdventureObstacleSpawner(dt);
          this.updateAdventureObstacleCleanup();
          this.updateAdventureTerrain();
        }
      }
      this.updateCollisions();
      this.particles.update(dt);
      this.updateCamera(dt);
      this.updateEngineSound(dt);
      this.updateHUD();
    } else if (this.state === 'over') {
      this.updateShells(dt);
      this.particles.update(dt);
      this.updateCamera(dt);
    } else if (this.state === 'menu') {
      this.updateCamera(dt);
      this.particles.update(dt);
    }
  }

  updatePlayer(dt) {
    const p = this.player;
    if (!p || p.dead) return;
    p.updatePlayer(dt, this.input);
    if (this.input.fire && p.cooldown <= 0) p.fire();
  }
  updateEnemies(dt) {
    const pendingKills = this.network ? this.network._clientPendingKills : null;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (!e._isRemoteSynced) e.updateAI(dt);
      if (e.dead) {
        // 客机预测击杀的敌人：暂不从列表移除，等主机广播确认
        // （避免 syncRemoteEnemies 每帧把"死"的敌人当成新敌人重建 → 复活闪烁）
        if (pendingKills && e._isRemoteSynced && pendingKills.has(e._netId)) {
          continue;
        }
        this.enemies.splice(i, 1);
        const ti = this.tanks.indexOf(e);
        if (ti >= 0) this.tanks.splice(ti, 1);
      }
    }
  }
  updateMines(dt) {
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i]; m.update(dt);
      if (m.dead) { m.dispose(); this.mines.splice(i, 1); }
    }
  }
  updateObstacles(dt) {
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const ob = this.obstacles[i]; ob.update(dt);
      if (ob.dead) this.obstacles.splice(i, 1);
    }
  }
  updateShells(dt) {
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i]; s.update(dt);
      if (s.dead) { s.dispose(); this.shells.splice(i, 1); }
    }
  }
  addShell(shell) { this.shells.push(shell); }
  updateCollisions() {
    for (let i = 0; i < this.tanks.length; i++) {
      const t = this.tanks[i];
      if (t.team === 'player' || t.team === 'enemy') t.resolveCollisions();
    }
  }
  updateSpawner(dt) {
    if (this.enemies.length === 0 && !this.wavePending) {
      this.wavePending = true; this.waveTimer = 2.0;
    }
    if (this.wavePending) {
      this.waveTimer -= dt;
      if (this.waveTimer <= 0) {
        this.wavePending = false; this.wave++;
        this.spawnWave(this.wave);
      }
    }
  }

  updateCamera(dt) {
    const p = this.player;
    if (this.firstPerson && p && !p.dead) {
      p.group.visible = false;
      const tankYaw = p.yaw;
      p.group.updateMatrixWorld(true);
      const turretWorldPos = new THREE.Vector3();
      p.turret.getWorldPosition(turretWorldPos);
      let camYaw = tankYaw;
      if (this.mode === 'adventure' || this.mode === 'multi') camYaw = normalizeAngle(tankYaw + p.turretYaw);
      const camOffsetBack = 0.35, camHeight = 1.05;
      const camX = turretWorldPos.x - Math.sin(camYaw) * camOffsetBack;
      const camZ = turretWorldPos.z - Math.cos(camYaw) * camOffsetBack;
      const camY = turretWorldPos.y + camHeight;
      const targetCamPos = new THREE.Vector3(camX, camY, camZ);
      const k = 1 - Math.exp(-30.0 * dt);
      this.camera.position.lerp(targetCamPos, k);
      const lookAt = new THREE.Vector3(
        turretWorldPos.x + Math.sin(camYaw) * 60,
        turretWorldPos.y + 0.5,
        turretWorldPos.z + Math.cos(camYaw) * 60);
      this.camLook.lerp(lookAt, k);
      this.camera.lookAt(this.camLook);
    } else if (!this.firstPerson && p && !p.dead) {
      p.group.visible = true;
      const yaw = p.yaw;
      const backX = -Math.sin(yaw), backZ = -Math.cos(yaw);
      const targetPos = new THREE.Vector3(
        p.group.position.x + backX * CAM_DIST,
        p.group.position.y + CAM_HEIGHT,
        p.group.position.z + backZ * CAM_DIST);
      const lookTarget = new THREE.Vector3(
        p.group.position.x + Math.sin(yaw) * CAM_LOOK_AHEAD,
        p.group.position.y + 1.7,
        p.group.position.z + Math.cos(yaw) * CAM_LOOK_AHEAD);
      const k = 1 - Math.exp(-11.0 * dt);
      this.camera.position.lerp(targetPos, k);
      this.camLook.lerp(lookTarget, k);
      this.camera.lookAt(this.camLook);
    } else if (p && p.dead) {
      const target = new THREE.Vector3(p.group.position.x, p.group.position.y + 15, p.group.position.z + 12);
      const k = 1 - Math.exp(-2.2 * dt);
      this.camera.position.lerp(target, k);
      this.camLook.lerp(new THREE.Vector3(p.group.position.x, 1, p.group.position.z), k);
      this.camera.lookAt(this.camLook);
    } else {
      const t = performance.now() * 0.00016;
      const r = 40;
      this.camera.position.set(Math.cos(t) * r, 20, Math.sin(t) * r);
      this.camera.lookAt(0, 1.5, 0);
      this.camLook.set(0, 1.5, 0);
    }
  }

  updateEngineSound(dt) {
    if (!this.player) return;
    const p = this.player;
    if (p.dead) return;
    const ratio = clamp(Math.abs(p.speed) / p.maxSpeed, 0, 1);
    this.audio.engineUpdate(ratio, Math.abs(p.speed) > 0.5);
  }

  onTankHit(tank, dmg, source) {
    if (tank.isPlayer) {
      const flash = this.el.flash;
      if (flash) {
        flash.style.transition = 'opacity 0.05s';
        flash.style.background = 'radial-gradient(ellipse at center, rgba(255,0,0,0) 35%, rgba(255,0,0,.65) 100%)';
        flash.style.opacity = '0.85';
        setTimeout(() => {
          flash.style.transition = 'opacity 0.4s'; flash.style.opacity = '0';
        }, 55);
      }
    }
  }

  onTankDeath(tank) {
    if (tank.isPlayer) this.gameOver();
    else if (tank.team === 'enemy') { this.score += 100; this.updateHUD(); }
    else if (tank.team === 'remote_player') { this.score += 500; this.updateHUD(); }
  }

  updateHUD() {
    if (!this.player) return;
    const hpRatio = clamp(this.player.hp / this.player.maxHp, 0, 1);
    const fill = this.el.healthFill;
    if (fill) {
      fill.style.width = (hpRatio * 100) + '%';
      fill.style.background = hpRatio > 0.6
        ? 'linear-gradient(90deg,#22c55e,#4ade80)'
        : hpRatio > 0.3
          ? 'linear-gradient(90deg,#f59e0b,#fbbf24)'
          : 'linear-gradient(90deg,#dc2626,#ef4444)';
    }
    if (this.el.healthText) this.el.healthText.textContent = `${Math.ceil(this.player.hp)} / ${this.player.maxHp}`;
    if (this.el.score) this.el.score.textContent = this.score;
    if (this.el.wave) {
      if (this.mode === 'adventure' || this.mode === 'multi') {
        this.el.wave.textContent = '∞';
        if (this.el.waveLabel) this.el.waveLabel.textContent = '模式';
      } else {
        this.el.wave.textContent = Math.max(1, this.wave);
        if (this.el.waveLabel) this.el.waveLabel.textContent = '波次';
      }
    }
    if (this.el.enemies) this.el.enemies.textContent = this.enemies.length;
    if (this.el.mineCdFill) {
      const ratio = this.mineCooldown <= 0 ? 1 : 1 - this.mineCooldown / MINE_COOLDOWN;
      this.el.mineCdFill.style.width = (ratio * 100) + '%';
      this.el.mineCdFill.style.background = this.mineCooldown <= 0
        ? 'linear-gradient(90deg,#66ccff,#44aaff)'
        : 'linear-gradient(90deg,#ffaa22,#ff6600)';
    }
    if (this.el.mineLabel) {
      this.el.mineLabel.textContent = this.mineCooldown <= 0
        ? `地雷 [E] · 可埋设 (${this.mines.length}/${MAX_MINES})`
        : `地雷 [E] · 冷却中`;
    }
    if (this.el.ultCdFill) {
      const ratio = this.ultCooldown <= 0 ? 1 : 1 - this.ultCooldown / ULT_COOLDOWN;
      this.el.ultCdFill.style.width = (ratio * 100) + '%';
    }
    if (this.el.ultLabel) {
      this.el.ultLabel.textContent = this.ultCooldown <= 0
        ? '大招 [Q] · 就绪！'
        : `大招 [Q] · 冷却 ${this.ultCooldown.toFixed(1)}s`;
    }
    if (this.el.advInfo) {
      if (this.mode === 'adventure') this.el.advInfo.classList.add('show');
      else this.el.advInfo.classList.remove('show');
    }
    if (this.el.advPoints) this.el.advPoints.textContent = this.enemies.length;

    if ((this.mode === 'multi' || IS_SPLIT_INSTANCE) && this.network) {
      const total = this.network.getPlayerCount();
      if (this.el.netPlayerCount) this.el.netPlayerCount.textContent = total;
      if (this.el.netInfo && !this.el.netInfo.classList.contains('show')) {
        this.el.netInfo.classList.add('show');
      }
      if (this.el.netRoom && this.network.roomCode) this.el.netRoom.textContent = this.network.roomCode;
      if (this.el.netStatus) this.el.netStatus.classList.add('on');
      if (this.el.netRole) {
        if (this.network.isHost) this.el.netRole.textContent = '房主';
        else this.el.netRole.textContent = '玩家 ' + this.network.myPlayerId;
      }
      if (this.el.netPlayerList) {
        this.el.netPlayerList.innerHTML = '';
        const myColorIdx = this.network.isHost ? 0 : (this.network.myPlayerId % PLAYER_COLORS.length);
        const myColors = PLAYER_COLORS[myColorIdx];
        const myRow = document.createElement('div');
        myRow.className = 'pRow';
        myRow.innerHTML = `<span class="dot" style="background:#${myColors.accent.toString(16).padStart(6, '0')}"></span>
          <span>我${this.network.isHost ? ' (房主)' : ' #' + this.network.myPlayerId}</span>`;
        this.el.netPlayerList.appendChild(myRow);
        for (const [pid] of this.remotePlayers) {
          let colorIdx = pid % PLAYER_COLORS.length;
          if (this.network.isHost) {
            const entry = this.network.conns.find(c => c.playerId === pid);
            if (entry) colorIdx = entry.colorIdx;
          } else {
            const st = this.network.remotePlayersData.get(pid);
            if (st && st.colorIdx !== undefined) colorIdx = st.colorIdx;
          }
          const colors = PLAYER_COLORS[colorIdx];
          const row = document.createElement('div');
          row.className = 'pRow';
          row.innerHTML = `<span class="dot" style="background:#${colors.accent.toString(16).padStart(6, '0')}"></span>
            <span>玩家 #${pid}</span>`;
          this.el.netPlayerList.appendChild(row);
        }
      }
    }

    const btnMine = document.getElementById('btnMine');
    if (btnMine) {
      if (this.mineCooldown > 0) btnMine.classList.add('disabled');
      else btnMine.classList.remove('disabled');
    }
    const btnUlt = document.getElementById('btnUlt');
    if (btnUlt) {
      if (this.ultCooldown > 0) btnUlt.classList.add('disabled');
      else btnUlt.classList.remove('disabled');
    }
  }

  startGame(mode) {
    this.mode = mode || this.mode;
    TerrainSystem.init(this.mode);
    this.resetWorld();
    this.state = 'playing';
    this.el.menu.classList.add('hidden');
    this.el.over.classList.add('hidden');
    this.el.pause.classList.add('hidden');
    this.el.crosshair.style.opacity = '1';
    this.el.netInfo.classList.remove('show');
    this.audio.init(); this.audio.resume(); this.audio.engineStart();
    this.wave = 0; this.wavePending = false; this.waveTimer = 0;
    this.advSpawnTimer = 0; this.advObstacleSpawnTimer = 0;
    if (this.mode === 'wave') {
      this.wave = 1;
      this.spawnWave(1);
    } else {
      for (let i = 0; i < 40; i++) this.updateAdventureSpawner(0.5);
      this.showBanner(IS_SPLIT_INSTANCE ? `玩家 ${SPLIT_INDEX + 1} 开始` : '冒险开始');
    }
    this.clock.getDelta();
  }

  showBanner(text) {
    const b = this.el.banner;
    if (!b) return;
    b.textContent = text;
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
  }
}

// 本地静音写入（避免从 config 再 import，保持原逻辑清晰）
function writeMuteStateLocal(m) {
  try { localStorage.setItem('tank3d_muted', m ? '1' : '0'); } catch (e) {}
}