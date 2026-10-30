// ============================================================
// js/audio.js — WebAudio 音效管理器
// ============================================================

import { readMuteState, writeMuteState } from './config.js';

export class AudioManager {
  constructor() {
    this.ctx = null; this.master = null; this.ready = false;
    this.muted = readMuteState();
    this.engineNodes = null; this.noiseBuffer = null; this._lastShootTime = 0;
  }
  init() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { this.ctx = new AC(); } catch (e) { return; }
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.34;
    this.master.connect(this.ctx.destination);
    const len = Math.floor(this.ctx.sampleRate * 2);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf; this.ready = true;
  }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); }
  setMuted(m) {
    this.muted = m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.34, this.ctx.currentTime, 0.03);
    }
    writeMuteState(m);
  }
  _noise(loop = false) {
    const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuffer; s.loop = loop; return s;
  }
  shoot(vol = 1) {
    if (!this.ready || this.muted) return;
    const now = performance.now();
    if (now - this._lastShootTime < 40) return;
    this._lastShootTime = now;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(190, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.26);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.55 * vol, t);
    og.gain.exponentialRampToValueAtTime(0.0008, t + 0.3);
    osc.connect(og).connect(this.master);
    osc.start(t); osc.stop(t + 0.32);
    const n = this._noise();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1400, t);
    bp.frequency.exponentialRampToValueAtTime(320, t + 0.16);
    bp.Q.value = 0.7;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.5 * vol, t);
    ng.gain.exponentialRampToValueAtTime(0.0008, t + 0.2);
    n.connect(bp).connect(ng).connect(this.master);
    n.start(t); n.stop(t + 0.22);
  }
  explosion(vol = 1, size = 1) {
    if (!this.ready || this.muted) return;
    const t = this.ctx.currentTime;
    const dur = 0.5 + size * 0.5;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(90 * size, t);
    osc.frequency.exponentialRampToValueAtTime(24, t + dur);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.75 * vol, t);
    og.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    osc.connect(og).connect(this.master);
    osc.start(t); osc.stop(t + dur + 0.05);
    const n = this._noise();
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2600 * size, t);
    lp.frequency.exponentialRampToValueAtTime(140, t + dur * 0.8);
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.6 * vol, t);
    ng.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    n.connect(lp).connect(ng).connect(this.master);
    n.start(t); n.stop(t + dur + 0.05);
  }
  hit() {
    if (!this.ready || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.exponentialRampToValueAtTime(220, t + 0.09);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.12);
    osc.connect(g).connect(this.master);
    osc.start(t); osc.stop(t + 0.14);
  }
  crack() {
    if (!this.ready || this.muted) return;
    const t = this.ctx.currentTime;
    const n = this._noise();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(600, t);
    bp.frequency.exponentialRampToValueAtTime(200, t + 0.15);
    bp.Q.value = 1.2;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.18);
    n.connect(bp).connect(g).connect(this.master);
    n.start(t); n.stop(t + 0.2);
  }
  minePlace() {
    if (!this.ready || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(320, t);
    osc.frequency.exponentialRampToValueAtTime(120, t + 0.14);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.2, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.18);
    osc.connect(g).connect(this.master);
    osc.start(t); osc.stop(t + 0.2);
  }
  mineBoom() {
    if (!this.ready || this.muted) return;
    const t = this.ctx.currentTime;
    const dur = 1.0;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(28, t + dur);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.9, t);
    og.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    osc.connect(og).connect(this.master);
    osc.start(t); osc.stop(t + dur + 0.05);
    const n = this._noise();
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3200, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + dur * 0.9);
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.75, t);
    ng.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    n.connect(lp).connect(ng).connect(this.master);
    n.start(t); n.stop(t + dur + 0.05);
  }
  ultimate() {
    if (!this.ready || this.muted) return;
    const t = this.ctx.currentTime;
    const dur = 2.0;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(60, t);
    osc.frequency.exponentialRampToValueAtTime(20, t + dur);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.9, t);
    og.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    osc.connect(og).connect(this.master);
    osc.start(t); osc.stop(t + dur + 0.05);
    const n = this._noise();
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(4000, t);
    lp.frequency.exponentialRampToValueAtTime(80, t + dur);
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.8, t);
    ng.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    n.connect(lp).connect(ng).connect(this.master);
    n.start(t); n.stop(t + dur + 0.05);
  }
  engineStart() {
    if (!this.ready || this.engineNodes) return;
    const t = this.ctx.currentTime;
    const o1 = this.ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 42;
    const o2 = this.ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 26;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 360; lp.Q.value = 1.6;
    const g = this.ctx.createGain(); g.gain.value = 0;
    o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(this.master);
    o1.start(t); o2.start(t);
    this.engineNodes = { o1, o2, lp, g };
  }
  engineUpdate(ratio, moving) {
    if (!this.engineNodes || !this.ready) return;
    const t = this.ctx.currentTime;
    const base = 38 + ratio * 62;
    this.engineNodes.o1.frequency.setTargetAtTime(base, t, 0.12);
    this.engineNodes.o2.frequency.setTargetAtTime(base * 0.58, t, 0.12);
    this.engineNodes.lp.frequency.setTargetAtTime(300 + ratio * 700, t, 0.15);
    this.engineNodes.g.gain.setTargetAtTime(this.muted ? 0 : (0.035 + ratio * 0.075), t, 0.2);
  }
  engineStop() {
    if (!this.engineNodes) return;
    try { this.engineNodes.o1.stop(); this.engineNodes.o2.stop(); } catch (e) {}
    this.engineNodes = null;
  }
}