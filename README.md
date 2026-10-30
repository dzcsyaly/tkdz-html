# 🎮 3D 坦克大战 · 高帧率版

> 基于 Three.js 构建的 3D 坦克射击游戏，支持波次、冒险、多人联机、分屏四种模式。

<p align="center">
  <a href="https://dzxcyaly.github.io/tkdz-html">
    <img src="https://img.shields.io/badge/▶_立即游玩-dzxcyaly.github.io/tkdz--html-ffcc33?style=for-the-badge" alt="Play Now">
  </a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Three.js-0.160.0-blue?logo=three.js" alt="Three.js">
  <img src="https://img.shields.io/badge/PeerJS-1.5.2-44ff88?logo=webrtc" alt="PeerJS">
  <img src="https://img.shields.io/badge/Platform-Web-orange?logo=googlechrome" alt="Web">
  <img src="https://img.shields.io/badge/Mobile-Supported-success?logo=android" alt="Mobile">
</p>

---

## 🚀 在线游玩

**👉 [https://dzxcyaly.github.io/tkdz-html](https://dzxcyaly.github.io/tkdz-html)**

无需安装，打开浏览器即玩。首次加载需要下载 Three.js 与 PeerJS（约 1.5 MB），请保持网络畅通。

---

## 🎯 游戏模式

### ⚔ 波次模式
固定大小的柏林噪声地形战场（600 × 600），逐波挑战不断增强的敌军。
每波敌人数量随波次递增，消灭所有敌人后自动进入下一波。
**适合单人流畅通关**。

### 🌍 冒险模式
无限延伸的随机种子柏林噪声世界，玩家走到哪，地图就生成到哪。
障碍物与敌人随玩家移动持续刷新，远处元素自动清理以节省性能。
**适合无尽探索与刷分**。

### 👥 多人模式
通过 PeerJS 创建房间，分享 6 位房间码邀请好友加入（最多 8 人）。
所有玩家共享同一个世界种子、同一张地图、同一批敌人。
**支持互相伤害**——小心你的队友。
房主为权威主机，负责敌人 AI 与状态同步。

### 🖥 分屏模式
单浏览器多实例，通过 `iframe` 并排显示 2 / 4 / 6 / 8 个玩家画面。
所有实例自动加入同一房间，从左向右排列，可接入多鼠标或多触摸设备。
**适合线下聚会、展会演示**。

---

## 🎮 操作说明

### 键盘（PC）

| 按键 | 功能 |
|---|---|
| `W` `A` `S` `D` / `↑` `↓` `←` `→` | 移动 / 转向 |
| `空格` / 鼠标左键 | 开火 |
| `E` | 埋设地雷 |
| `Q` | 释放大招（清图） |
| `V` | 切换第一/第三人称视角 |
| `P` / `Esc` | 暂停 |
| `R` | 重新开始 |
| `M` | 静音开关 |

### 触屏（移动端）

左侧虚拟方向键：**▲▼◀▶** 移动与转向
右侧虚拟按钮：
- 🔥 **开火** — 长按持续射击
- 💣 **地雷** — 冷却 2.5 秒
- ⚡ **大招** — 冷却 3 秒
- 👁 **视角** — 切换第一/第三人称
- ⏸ **暂停**

> 触屏布局自适应，横屏体验最佳。

---

## ✨ 特色功能

### 🎨 视觉
- **柏林噪声地形** — 起伏地形由 Perlin fBm 实时生成，非静态建模
- **动态天空盒** — 自定义 Shader 实现的渐变天穹（顶部深蓝 → 地平线乳白）
- **坦克精模** — 20+ 子部件：炮塔、履带、车轮、炮管、舱盖、装饰条纹
- **粒子系统** — 8 种材质（火焰 / 火花 / 烟雾 / 泥土 / 碎片…），最大 160 个粒子并发
- **燃烧痕迹** — 坦克与障碍物被摧毁后在地面留下焦痕，12 秒后淡出

### 🔊 音效（WebAudio 实时合成）
- 引擎音效随速度实时变调
- 射击 / 爆炸 / 命中 / 地雷引爆 / 大招音效
- 粒子级音量控制与位置感
- **静音状态持久化**（`localStorage`）

### 🕹 玩法
- **第一/第三人称视角自由切换**
- **地雷系统** — 铺设于脚下，敌我识别，2.2 半径触发
- **大招清图** — 范围内全体敌人 + 障碍物一次性摧毁，附白屏闪光
- **弹药轨迹碰撞** — 线段-球体 / 线段-AABB 精确碰撞检测
- **地形自适应** — 坦克爬坡、攀爬障碍物，速度与高度实时同步

### 🌐 网络
- **PeerJS / WebRTC** — 点对点联机，无需自建服务器
- **主机权威** — 房主负责敌人 AI 与状态广播，抗作弊
- **状态同步** — 玩家状态 8 Hz、敌人状态 8 Hz、开火事件即时广播
- **断线保护** — 超时自动断开，UI 状态重置
- **分屏容错** — 自动重试 5 次，失败则提示刷新

### ⚡ 性能
- **帧率上限 90 FPS** — 主动限制渲染频率，减少移动端发热
- **低质量模式** — 检测到分屏 ≥ 4 实例或 `?lowQuality=1` 时自动降级（减少 50% 障碍物 / 粒子、地形分段减半、像素比 ≤ 0.85）
- **几何体复用** — 共享 `BoxGeometry` / `SphereGeometry` / `CylinderGeometry`，降低 GC 压力
- **材质缓存** — 按颜色缓存炮弹材质，避免重复创建
- **高度缓存** — 地形高度查询 20000 条 LRU 缓存

---

## 🛠 技术栈

| 技术 | 版本 | 用途 |
|---|---|---|
| [Three.js](https://threejs.org/) | 0.160.0 | 3D 渲染 |
| [PeerJS](https://peerjs.com/) | 1.5.2 | WebRTC 点对点联机 |
| ES Modules | — | 原生模块化（14 个 JS 文件） |
| WebAudio API | — | 实时音效合成 |
| Canvas 2D | — | 程序化地面贴图 |
| localStorage | — | 静音状态、分屏房间码持久化 |

---

## 💻 本地运行

由于使用了 ES Modules，**必须通过 HTTP 服务器访问**（`file://` 会被浏览器 CORS 拦截）。

---

## 📜 许可证

本项目采用 **MIT License** 。你可以自由使用、修改、商用，保留版权声明即可。

---

## 🙏 致谢

· Three.js — 强大的 WebGL 引擎
· PeerJS — 极简的 WebRTC 封装
· unpkg — 免费的 npm CDN
· GitHub Pages — 静态托管

---

<p align="center">
  <b>⭐ 如果这个项目对你有帮助，请给个 Star ⭐</b><br>
  <a href="https://dzxcyaly.github.io/tkdz-html">🎮 立即游玩</a> ·
  <a href="https://github.com/dzxcyaly/tkdz-html/issues">🐛 报告问题</a>
</p>

---