// ============================================================
// js/noise.js — 柏林噪声 + 地形高度系统
// ============================================================

export class PerlinNoise {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.p = new Uint8Array(512);
    this.perm = new Uint8Array(256);
    for (let i = 0; i < 256; i++) this.perm[i] = i;
    let s = this.seed || 1;
    const rnd = () => {
      s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
      return s / 0xFFFFFFFF;
    };
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = this.perm[i]; this.perm[i] = this.perm[j]; this.perm[j] = t;
    }
    for (let i = 0; i < 512; i++) this.p[i] = this.perm[i & 255];
  }
  fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  lerp(a, b, t) { return a + (b - a) * t; }
  grad(hash, x, y, z) {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }
  noise3D(x, y, z) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
    const u = this.fade(x), v = this.fade(y), w = this.fade(z);
    const p = this.p;
    const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z;
    const B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
    return this.lerp(
      this.lerp(
        this.lerp(this.grad(p[AA], x, y, z), this.grad(p[BA], x - 1, y, z), u),
        this.lerp(this.grad(p[AB], x, y - 1, z), this.grad(p[BB], x - 1, y - 1, z), u), v),
      this.lerp(
        this.lerp(this.grad(p[AA + 1], x, y, z - 1), this.grad(p[BA + 1], x - 1, y, z - 1), u),
        this.lerp(this.grad(p[AB + 1], x, y - 1, z - 1), this.grad(p[BB + 1], x - 1, y - 1, z - 1), u), v), w);
  }
  noise2D(x, y) { return this.noise3D(x, y, 0); }
  fbm(x, y, octaves = 4, lacunarity = 2.0, gain = 0.5) {
    let sum = 0, amp = 1, freq = 1, max = 0;
    for (let i = 0; i < octaves; i++) {
      sum += this.noise2D(x * freq, y * freq) * amp;
      max += amp; amp *= gain; freq *= lacunarity;
    }
    return sum / max;
  }
}

export const TerrainSystem = {
  mode: 'wave', perlin: null, seed: 0,
  wavePerlin: new PerlinNoise(123456),
  sharedSeed: null,
  _heightCache: new Map(),
  init(mode, seed = null) {
    this.mode = mode;
    this._heightCache.clear();
    if (mode === 'adventure' || mode === 'multi') {
      this.seed = seed !== null ? seed : Math.floor(Math.random() * 0xFFFFFFFF);
      this.sharedSeed = this.seed;
      this.perlin = new PerlinNoise(this.seed);
    } else {
      this.perlin = null;
    }
  },
  getAdventureHeight(x, z) {
    if (!this.perlin) return 0;
    const base = this.perlin.fbm(x * 0.008, z * 0.008, 3, 2.0, 0.5) * 6.0;
    const detail = this.perlin.fbm(x * 0.04, z * 0.04, 2, 2.0, 0.5) * 1.2;
    return base + detail;
  },
  getWaveHeight(x, z) {
    const base = this.wavePerlin.fbm(x * 0.014, z * 0.014, 3, 2.0, 0.5) * 3.2;
    const detail = this.wavePerlin.fbm(x * 0.06, z * 0.06, 2, 2.0, 0.5) * 0.8;
    return base + detail;
  },
  getHeight(x, z) {
    const key = (Math.round(x * 2) << 16) ^ (Math.round(z * 2) & 0xFFFF);
    const cached = this._heightCache.get(key);
    if (cached !== undefined) return cached;
    let h;
    if (this.mode === 'adventure' || this.mode === 'multi') h = this.getAdventureHeight(x, z);
    else h = this.getWaveHeight(x, z);
    if (this._heightCache.size > 20000) this._heightCache.clear();
    this._heightCache.set(key, h);
    return h;
  }
};

export function getTerrainHeight(x, z) { return TerrainSystem.getHeight(x, z); }