/* 基娜幸存者 — 割草肉鸽（survivor-like）
 *
 * 玩法：按住屏幕拖动移动，角色自动攻击最近的敌人。
 *      杀敌掉经验 → 升级 → 三选一强化。活满 5 分钟算赢。
 *
 * 素材：复用第一作《合成大基娜》的 11 张圆形人像精灵图，
 *      其中 lv08 当主角，其余 10 张当 10 种敌人（越靠后越强）。
 */
(function () {
  'use strict';

  /* ==================== 配置 ==================== */

  const ARENA = 1800;          // 竞技场边长（世界单位）
  const VIEW_W = 480;          // 画面可见宽度（世界单位），高度按屏幕比例算
  const GAME_LENGTH = 540;     // 活满这么久就胜利（秒）—— 9 分钟

  // BOSS 出现的时间点（秒）。每只都比上一只强很多。
  const BOSS_TIMES = [90, 180, 270, 360, 450, 520];
  const BOSS_SPRITE = 11;

  const PLAYER_R = 18;
  const PLAYER_SPEED = 178;
  const PLAYER_HP = 100;

  const MAX_HP_UP = 25;

  // 11 张图当敌人，lv10 留给主角所以跳过
  // 血量按「玩家基础 14 伤害」反推：早期 1~2 发一个，后期 3~5 发一个
  const ENEMY_TYPES = [
    { sprite: 1, r: 14, hp: 3, speed: 62, xp: 1, dmg: 12 },
    { sprite: 2, r: 15, hp: 5, speed: 66, xp: 1, dmg: 14 },
    { sprite: 3, r: 16, hp: 7, speed: 71, xp: 2, dmg: 17 },
    { sprite: 4, r: 17, hp: 10, speed: 75, xp: 2, dmg: 18 },
    { sprite: 5, r: 19, hp: 14, speed: 66, xp: 3, dmg: 23 },
    { sprite: 6, r: 21, hp: 21, speed: 60, xp: 4, dmg: 28 },
    { sprite: 7, r: 23, hp: 30, speed: 56, xp: 5, dmg: 32 },
    { sprite: 9, r: 29, hp: 60, speed: 49, xp: 9, dmg: 44 },
    { sprite: 8, r: 33, hp: 88, speed: 46, xp: 12, dmg: 53 },
    { sprite: 11, r: 40, hp: 150, speed: 42, xp: 20, dmg: 68 },
  ];

  const PLAYER_SPRITE = 10;

  const COLORS = {
    player: '#6ee7ff',
    bullet: '#ffe58a',
    xp: '#6ee7ff',
    enemyHit: '#ffffff',
  };

  /* ==================== 升级池 ==================== */

  const UPGRADES = [
    {
      id: 'dmg',
      icon: '⚔️',
      name: '锋利',
      max: 6,
      desc: (s) => `子弹伤害 +25%（当前 ${Math.round(s.damage)}）`,
      apply: (s) => { s.damage *= 1.25; },
    },
    {
      id: 'rate',
      icon: '⚡',
      name: '急速',
      max: 7,
      desc: (s) => `攻击速度 +14%（当前 ${(1 / s.fireCd).toFixed(1)} 发/秒）`,
      apply: (s) => { s.fireCd = Math.max(0.055, s.fireCd / 1.14); },
    },
    {
      id: 'multi',
      icon: '🎯',
      name: '弹幕',
      max: 4,
      desc: (s) => `同时攻击 +1 个目标（当前 ${s.projectiles}）`,
      apply: (s) => { s.projectiles += 1; },
    },
    {
      id: 'spd',
      icon: '👟',
      name: '疾行',
      max: 4,
      desc: (s) => `移动速度 +10%（当前 ${Math.round(s.speed)}）`,
      apply: (s) => { s.speed *= 1.1; },
    },
    {
      id: 'hp',
      icon: '❤️',
      name: '坚韧',
      max: 5,
      desc: (s) => `最大生命 +25，并回复 25（当前 ${Math.round(s.maxHp)}）`,
      apply: (s) => { s.maxHp += MAX_HP_UP; s.hp = Math.min(s.maxHp, s.hp + MAX_HP_UP); },
    },
    {
      id: 'pick',
      icon: '🧲',
      name: '磁力',
      max: 4,
      desc: (s) => `拾取范围 +55%（当前 ${Math.round(s.pickup)}）`,
      apply: (s) => { s.pickup *= 1.55; },
    },
    {
      id: 'pierce',
      icon: '🔱',
      name: '穿透',
      max: 4,
      desc: (s) => `子弹可多穿透 1 个敌人（当前 ${s.pierce}）`,
      apply: (s) => { s.pierce += 1; },
    },
    {
      id: 'orbit',
      icon: '🛰️',
      name: '环绕光球',
      max: 4,
      desc: (s) =>
        s.orbit > 0
          ? `环绕光球 +1（当前 ${s.orbit} 个，每个 ${Math.round(s.orbitDmg)} 伤害/秒）`
          : '获得 1 个环绕光球，贴身持续伤害',
      apply: (s) => {
        s.orbit += 1;
        s.orbitDmg = 10 + s.orbit * 9;
      },
    },
    {
      id: 'spread',
      icon: '🎇',
      name: '散射',
      max: 4,
      desc: (s) => `每次射击 +2 发扇形子弹（当前每次 ${1 + s.spread} 发）`,
      apply: (s) => { s.spread += 2; },
    },
    {
      id: 'nova',
      icon: '💥',
      name: '新星冲击',
      max: 4,
      desc: (s) =>
        s.novaLv > 0
          ? `新星更强（${Math.round(s.novaDmg)} 伤害 / 半径 ${Math.round(s.novaR)} / ${s.novaCd.toFixed(1)}s）`
          : '每 2.8 秒向四周炸开一圈冲击波',
      apply: (s) => {
        s.novaLv = (s.novaLv || 0) + 1;
        s.novaDmg = 22 * Math.pow(1.45, s.novaLv - 1);
        s.novaCd = Math.max(1.1, 2.8 * Math.pow(0.86, s.novaLv - 1));
        s.novaR = 140 + s.novaLv * 18;
        if (!s.novaT || s.novaT > 0.6) s.novaT = 0.6;
      },
    },
    {
      id: 'splash',
      icon: '💣',
      name: '爆裂弹',
      max: 4,
      desc: (s) =>
        s.splashLv > 0
          ? `子弹命中后炸开（半径 ${Math.round(s.splashR)} / ${Math.round(s.splashDmg)} 伤害）`
          : '子弹命中时炸开一圈，波及周围敌人',
      apply: (s) => {
        s.splashLv = (s.splashLv || 0) + 1;
        s.splashR = 46 + s.splashLv * 13;
        s.splashDmg = 8 + s.splashLv * 7;
      },
    },
    {
      id: 'homing',
      icon: '🧭',
      name: '追踪弹',
      max: 4,
      desc: (s) =>
        s.homingLv > 0
          ? `子弹会拐弯追敌（转向 ${s.homingPower.toFixed(1)} 弧度/秒）`
          : '子弹飞行中自动修正方向，追着敌人打',
      apply: (s) => {
        s.homingLv = (s.homingLv || 0) + 1;
        s.homingPower = 1.6 + s.homingLv * 0.95;
      },
    },
    {
      id: 'heal',
      icon: '🧪',
      name: '补给',
      max: 99,
      desc: (s) => `立即回复 45% 最大生命`,
      apply: (s) => { s.hp = Math.min(s.maxHp, s.hp + s.maxHp * 0.45); },
    },
  ];

  /* ==================== 联动效果 ==================== */
  // 两条属性都升满 → 自动解锁一条强力联动，打破「只堆数值」的单调感。
  const SYNERGIES = [
    // ── 总级数 4：最小的一档 ──
    {
      id: 'blastlink',
      icon: '🧨',
      name: '爆裂连锁',
      need: { splash: 2, spread: 2 },
      desc: '爆炸半径 +50%',
      apply: (s) => { s.splashR *= 1.5; },
    },
    // ── 总级数 8：中档 ──
    {
      id: 'railgun',
      icon: '🔫',
      name: '贯穿弹幕',
      need: { multi: 4, pierce: 4 },
      desc: '子弹不再有穿透上限',
      apply: (s) => { s.infinitePierce = true; },
    },
    {
      id: 'orbitnova',
      icon: '🌌',
      name: '星轨',
      need: { orbit: 4, nova: 4 },
      desc: '光球 +1 个，且光球伤害 +50%',
      apply: (s) => { s.orbit += 1; s.orbitDmg *= 1.5; },
    },
    {
      id: 'storm',
      icon: '🎆',
      name: '弹幕风暴',
      need: { spread: 4, multi: 4 },
      desc: '散射再 +2 发子弹',
      apply: (s) => { s.spread += 2; },
    },
    {
      id: 'judgement',
      icon: '☄️',
      name: '天罚',
      need: { nova: 4, homing: 4 },
      desc: '新星半径 +40%，伤害 +30%',
      apply: (s) => { s.novaR *= 1.4; s.novaDmg *= 1.3; },
    },
    // ── 总级数 9：偏高档 ──
    {
      id: 'lifesteal',
      icon: '🩸',
      name: '生命汲取',
      need: { hp: 5, pick: 4 },
      desc: '每次击杀回复 3 点生命',
      apply: (s) => { s.lifesteal = 3; },
    },
    // ── 总级数 10：高档 ──
    {
      id: 'doom',
      icon: '💀',
      name: '毁灭之雨',
      need: { dmg: 6, splash: 4 },
      desc: '爆炸伤害翻倍',
      apply: (s) => { s.splashDmg *= 2; },
    },
    // ── 总级数 13：最高档，效果最强 ──
    {
      id: 'gale',
      icon: '🌪️',
      name: '疾风连斩',
      need: { dmg: 6, rate: 7 },
      desc: '攻速额外 +60%',
      apply: (s) => { s.fireCd = Math.max(0.04, s.fireCd / 1.6); },
    },
  ];

  // 联动所需的总级数（用来排序和显示，越高的效果越强）
  const synergyTotal = (sy) => {
    let n = 0;
    for (const k in sy.need) n += sy.need[k];
    return n;
  };

  /* ==================== 状态 ==================== */

  const state = {
    phase: 'idle', // idle | playing | levelup | over | win
    t: 0,
    kills: 0,
    level: 1,
    xp: 0,
    xpNeed: 6,
    best: 0,

    player: null,
    enemies: [],
    bullets: [],
    gems: [],
    novas: [],
    bossRings: [],
    parts: [],
    floaters: [],

    spawnTimer: 0,
    fireTimer: 0,
    bossIdx: 0,
    bossNext: 90,
    nextId: 1,

    // 相机
    camX: ARENA / 2,
    camY: ARENA / 2,

    // 升级选择
    picks: [],
    // 已获得的升级层数
    taken: {},
    // 已解锁的联动
    synergies: {},
  };

  function makePlayer() {
    return {
      x: ARENA / 2,
      y: ARENA / 2,
      hp: PLAYER_HP,
      maxHp: PLAYER_HP,
      speed: PLAYER_SPEED,
      damage: 26,
      fireCd: 1 / 4.0,
      projectiles: 1,
      pierce: 0,
      pickup: 175,
      face: 0,
      hurtT: 0,
      // 新武器：环绕光球
      orbit: 0,
      orbitT: 0,
      orbitDmg: 0,
      // 新武器：散射（额外子弹数）
      spread: 0,
      // 新武器：新星冲击
      novaLv: 0,
      novaDmg: 0,
      novaCd: 2.8,
      novaR: 158,
      novaT: 0.6,
      // 新弹幕特效：爆裂弹
      splashLv: 0,
      splashR: 0,
      splashDmg: 0,
      // 新弹幕特效：追踪弹
      homingLv: 0,
      homingPower: 0,
      // 联动解锁后才会置位
      infinitePierce: false,
      lifesteal: 0,
    };
  }

  /* ==================== 音效 ==================== */

  const Sfx = {
    ac: null,
    on: true,
    _lastHit: 0,
    _lastKill: 0,

    ensure() {
      if (!this.ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        this.ac = new AC();
      }
      if (this.ac.state === 'suspended') this.ac.resume();
      return this.ac;
    },

    tone(freq, dur, type, vol, delay) {
      if (!this.on) return;
      const ac = this.ensure();
      if (!ac) return;
      const t0 = ac.currentTime + (delay || 0);
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(vol == null ? 0.12 : vol, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(ac.destination);
      o.start(t0);
      o.stop(t0 + dur + 0.02);
    },

    sweep(f0, f1, dur, type, vol, delay) {
      if (!this.on) return;
      const ac = this.ensure();
      if (!ac) return;
      const t0 = ac.currentTime + (delay || 0);
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(f0, t0);
      o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(vol == null ? 0.1 : vol, t0 + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(ac.destination);
      o.start(t0);
      o.stop(t0 + dur + 0.02);
    },

    shoot() {
      const ac = this.ensure();
      if (!ac) return;
      if (ac.currentTime - this._lastShoot < 0.05) return;
      this._lastShoot = ac.currentTime;
      this.sweep(880, 1250, 0.05, 'sine', 0.045);
    },
    hit() {
      const ac = this.ensure();
      if (!ac) return;
      if (ac.currentTime - this._lastHit < 0.045) return;
      this._lastHit = ac.currentTime;
      this.tone(1400, 0.03, 'sine', 0.035);
    },
    kill() {
      const ac = this.ensure();
      if (!ac) return;
      if (ac.currentTime - this._lastKill < 0.055) return;
      this._lastKill = ac.currentTime;
      this.sweep(560, 1300, 0.09, 'sine', 0.09);
    },
    hurt() {
      this.sweep(300, 150, 0.16, 'triangle', 0.16);
    },
    levelup() {
      [660, 880, 1170, 1560].forEach((f, i) => this.sweep(f, f * 1.5, 0.16, 'sine', 0.1, i * 0.07));
    },
    nova() {
      this.sweep(220, 90, 0.24, 'triangle', 0.13);
    },

    bossRing() {
      this.sweep(160, 60, 0.4, 'sawtooth', 0.11);
    },

    boom() {
      const ac = this.ensure();
      if (!ac) return;
      if (ac.currentTime - (this._lastBoom || 0) < 0.05) return;
      this._lastBoom = ac.currentTime;
      this.sweep(420, 130, 0.13, 'triangle', 0.09);
    },

    boss() {
      [180, 140, 110].forEach((f, i) => this.tone(f, 0.5, 'triangle', 0.17, i * 0.12));
    },

    // 联动解锁：一段上扬的闪光音
    synergy() {
      [880, 1170, 1560, 2090].forEach((f, i) => this.sweep(f, f * 1.6, 0.14, 'sine', 0.12, i * 0.055));
    },

    win() {
      [660, 880, 1100, 1320, 1760].forEach((f, i) => this.tone(f, 0.4, 'triangle', 0.15, i * 0.13));
    },
    over() {
      [440, 350, 262, 175].forEach((f, i) => this.tone(f, 0.34, 'sine', 0.14, i * 0.15));
    },
    toggle() {
      this.on = !this.on;
      if (this.on) this.sweep(760, 1180, 0.09, 'sine', 0.1);
      return this.on;
    },
    _lastShoot: 0,
  };

  /* ==================== 精灵图 ==================== */

  const sprites = new Array(12).fill(null);

  function loadSprites() {
    const jobs = [];
    for (let i = 1; i <= 11; i++) {
      jobs.push(
        new Promise((resolve) => {
          const img = new Image();
          img.onload = () => { sprites[i] = img; resolve(); };
          img.onerror = () => resolve();
          img.src = `assets/lv${String(i).padStart(2, '0')}.webp`;
        })
      );
    }
    return Promise.all(jobs);
  }

  /* ==================== 输入 ==================== */

  const input = { x: 0, y: 0, keys: {} };

  // 悬浮摇杆：按下的位置为原点，拖动方向就是移动方向
  const stick = { active: false, ox: 0, oy: 0, id: null, maxR: 62 };

  function onDown(e) {
    if (state.phase !== 'playing') return;
    stick.active = true;
    stick.id = e.pointerId;
    stick.ox = e.clientX;
    stick.oy = e.clientY;
    input.x = 0;
    input.y = 0;
    hideHintSoon();
    e.preventDefault();
  }

  function onMove(e) {
    if (!stick.active || e.pointerId !== stick.id) return;
    let dx = e.clientX - stick.ox;
    let dy = e.clientY - stick.oy;
    const d = Math.hypot(dx, dy);
    const m = Math.min(d, stick.maxR) / stick.maxR;
    if (d > 0.001) {
      input.x = (dx / d) * m;
      input.y = (dy / d) * m;
    }
    e.preventDefault();
  }

  function onUp(e) {
    if (e.pointerId !== stick.id) return;
    stick.active = false;
    stick.id = null;
    input.x = 0;
    input.y = 0;
    e.preventDefault();
  }

  function bindInput(cv) {
    cv.addEventListener('pointerdown', onDown, { passive: false });
    cv.addEventListener('pointermove', onMove, { passive: false });
    cv.addEventListener('pointerup', onUp, { passive: false });
    cv.addEventListener('pointercancel', onUp, { passive: false });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      input.keys[e.key.toLowerCase()] = true;
      if (e.key === ' ') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      input.keys[e.key.toLowerCase()] = false;
    });
  }

  // 键盘方向合并进 input
  function readKeys() {
    const k = input.keys;
    let kx = 0, ky = 0;
    if (k['a'] || k['arrowleft']) kx -= 1;
    if (k['d'] || k['arrowright']) kx += 1;
    if (k['w'] || k['arrowup']) ky -= 1;
    if (k['s'] || k['arrowdown']) ky += 1;
    if (kx || ky) {
      const d = Math.hypot(kx, ky);
      return { x: kx / d, y: ky / d };
    }
    return null;
  }

  /* ==================== 相机 / 视图 ==================== */

  const cv = document.getElementById('cv');
  const ctx = cv.getContext('2d');
  const view = { w: 0, h: 0, dpr: 1, scale: 1, viewH: 0 };

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    view.w = Math.max(1, window.innerWidth);
    view.h = Math.max(1, window.innerHeight);
    view.dpr = dpr;
    cv.width = Math.round(view.w * dpr);
    cv.height = Math.round(view.h * dpr);
    view.scale = view.w / VIEW_W;
    view.viewH = view.h / view.scale; // 可见的世界高度（随屏幕比例变化）
  }

  function updateCamera() {
    const halfW = VIEW_W / 2;
    const halfH = view.viewH / 2;
    const p = state.player;
    state.camX = clamp(p.x, Math.min(halfW, ARENA / 2), Math.max(ARENA - halfW, ARENA / 2));
    state.camY = clamp(p.y, Math.min(halfH, ARENA / 2), Math.max(ARENA - halfH, ARENA / 2));
  }

  /* ==================== 工具 ==================== */

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rand = (a, b) => a + Math.random() * (b - a);
  const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);

  function addFloater(x, y, text, color, size) {
    state.floaters.push({ x, y, text, color, size: size || 14, life: 1, vy: -38 });
  }

  function burst(x, y, color, n, spd, size) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(spd * 0.4, spd);
      state.parts.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 1,
        decay: rand(2, 3.4),
        r: rand(1.6, size || 3),
        color,
      });
    }
  }

  /* ==================== 游戏流程 ==================== */

  const elTime = document.getElementById('timeText');
  const elKill = document.getElementById('killText');
  const elLv = document.getElementById('lvText');
  const elXpFill = document.getElementById('xpFill');
  const elHpFill = document.getElementById('hpFill');
  const elHpText = document.getElementById('hpText');
  const elOverlay = document.getElementById('overlay');
  const elLevelup = document.getElementById('levelup');
  const elCards = document.getElementById('cards');
  const elStickHint = document.getElementById('stickHint');
  const elOvTitle = document.getElementById('ovTitle');
  const elOvSub = document.getElementById('ovSub');
  const elOvStats = document.getElementById('ovStats');
  const elOvBtn = document.getElementById('ovBtn');
  const elStTime = document.getElementById('stTime');
  const elStKills = document.getElementById('stKills');
  const elStBest = document.getElementById('stBest');
  const elLvUpNum = document.getElementById('lvUpNum');
  const elBossBar = document.getElementById('bossbar');
  const elBossFill = document.getElementById('bossFill');

  const BEST_KEY = 'jina2.best.v1';

  function fmtTime(s) {
    const m = Math.floor(s / 60);
    const ss = Math.floor(s % 60);
    return String(m).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
  }

  function resetGame() {
    state.phase = 'playing';
    state.t = 0;
    state.kills = 0;
    state.level = 1;
    state.xp = 0;
    state.xpNeed = 6;
    state.player = makePlayer();
    state.enemies.length = 0;
    state.bullets.length = 0;
    state.gems.length = 0;
    state.novas.length = 0;
    state.bossRings.length = 0;
    state.parts.length = 0;
    state.floaters.length = 0;
    state.spawnTimer = 0.4;
    state.bossIdx = 0;
    state.bossNext = 90;
    state.fireTimer = 0;
    state.nextId = 1;
    state.taken = {};
    state.synergies = {};
    state.camX = ARENA / 2;
    state.camY = ARENA / 2;
    input.x = 0;
    input.y = 0;
    syncHud();
  }

  function syncHud() {
    const p = state.player;
    elTime.textContent = fmtTime(state.t);
    elKill.textContent = '击杀 ' + state.kills;
    elLv.textContent = 'Lv.' + state.level;
    elXpFill.style.width = clamp((state.xp / state.xpNeed) * 100, 0, 100) + '%';
    if (p) {
      elHpFill.style.width = clamp((p.hp / p.maxHp) * 100, 0, 100) + '%';
      elHpText.textContent = Math.max(0, Math.ceil(p.hp)) + ' / ' + Math.round(p.maxHp);
    }
    // BOSS 血条：场上有 boss 时才显示
    let boss = null;
    for (const en of state.enemies) {
      if (en.isBoss) { boss = en; break; }
    }
    if (boss) {
      elBossBar.hidden = false;
      elBossFill.style.width = clamp((boss.hp / boss.maxHp) * 100, 0, 100) + '%';
    } else {
      elBossBar.hidden = true;
    }
  }

  let hintTimer = null;
  function hideHintSoon() {
    if (hintTimer) return;
    hintTimer = setTimeout(() => elStickHint.classList.add('hide'), 0);
  }

  /* ==================== 生成敌人 ==================== */

  function spawnEnemy() {
    const t = state.t;
    const maxIdx = Math.min(ENEMY_TYPES.length - 1, Math.floor(t / 45));
    const lo = Math.max(0, maxIdx - 2);
    const idx = lo + Math.floor(Math.random() * (maxIdx - lo + 1));
    const type = ENEMY_TYPES[idx];

    // 从玩家周围的环形区域外沿生成
    const p = state.player;
    const ang = rand(0, Math.PI * 2);
    const radius = Math.max(VIEW_W, view.viewH) * 0.62 + rand(20, 120);
    let x = p.x + Math.cos(ang) * radius;
    let y = p.y + Math.sin(ang) * radius;
    x = clamp(x, 30, ARENA - 30);
    y = clamp(y, 30, ARENA - 30);

    const hpScale = 1 + t / 480;
    state.enemies.push({
      id: state.nextId++,
      sprite: type.sprite,
      x, y,
      r: type.r,
      hp: type.hp * hpScale,
      maxHp: type.hp * hpScale,
      speed: type.speed,
      xp: type.xp,
      dmg: type.dmg,
      hitT: 0,
      knockX: 0,
      knockY: 0,
    });
  }

  // 在指定位置刷一只普通敌人（最终 BOSS 的技能「召唤」用）
  function spawnEnemyAround(x, y) {
    const t = state.t;
    const maxIdx = Math.min(ENEMY_TYPES.length - 1, Math.floor(t / 45));
    const lo = Math.max(0, maxIdx - 2);
    const idx = lo + Math.floor(Math.random() * (maxIdx - lo + 1));
    const type = ENEMY_TYPES[idx];
    const hpScale = 1 + t / 480;
    state.enemies.push({
      id: state.nextId++,
      sprite: type.sprite,
      x: clamp(x, 30, ARENA - 30),
      y: clamp(y, 30, ARENA - 30),
      r: type.r,
      hp: type.hp * hpScale,
      maxHp: type.hp * hpScale,
      speed: type.speed,
      xp: type.xp,
      dmg: type.dmg,
      hitT: 0,
      knockX: 0,
      knockY: 0,
    });
  }

  /* ==================== 更新 ==================== */

  // BOSS：体型大、血厚、伤害高、几乎不被击退，出现在屏幕外然后压过来
  function spawnBoss(index) {
    const p = state.player;
    const ang = rand(0, Math.PI * 2);
    const dist = Math.max(VIEW_W, view.viewH) * 0.78;
    const x = clamp(p.x + Math.cos(ang) * dist, 80, ARENA - 80);
    const y = clamp(p.y + Math.sin(ang) * dist, 80, ARENA - 80);

    const isFinal = index === BOSS_TIMES.length - 1;
    let hp = 620 * Math.pow(1.8, index);
    if (isFinal) hp *= 3; // 最终 BOSS 血量三倍
    state.enemies.push({
      id: state.nextId++,
      sprite: BOSS_SPRITE,
      x, y,
      r: 46 + index * 5,
      hp,
      maxHp: hp,
      speed: 38 + index * 4,
      xp: 60 + index * 40,
      dmg: 28 + index * 10,
      hitT: 0,
      knockX: 0,
      knockY: 0,
      isBoss: true,
      isFinal,
      skillT: isFinal ? 3.5 : 5.0,
    });
    showToast(isFinal ? '☠️ 最终 BOSS 出现！' : '⚠️ BOSS 出现！');
    Sfx.boss();
  }

  function update(dt) {
    if (state.phase !== 'playing') {
      stepParticles(dt);
      return;
    }

    state.t += dt;
    if (state.t >= GAME_LENGTH) {
      win();
      return;
    }

    const p = state.player;

    // --- 玩家移动 ---
    const kd = readKeys();
    const mx = kd ? kd.x : input.x;
    const my = kd ? kd.y : input.y;
    const mlen = Math.hypot(mx, my);
    if (mlen > 0.02) {
      const m = Math.min(1, mlen);
      p.x += (mx / mlen) * m * p.speed * dt;
      p.y += (my / mlen) * m * p.speed * dt;
      p.face = Math.atan2(my, mx);
    }
    p.x = clamp(p.x, p.r || PLAYER_R, ARENA - (p.r || PLAYER_R));
    p.y = clamp(p.y, p.r || PLAYER_R, ARENA - (p.r || PLAYER_R));
    if (p.hurtT > 0) p.hurtT -= dt;

    // --- 生成敌人 ---
    state.spawnTimer -= dt;
    if (state.spawnTimer <= 0) {
      const interval = Math.max(0.62, 1.55 - state.t * 0.0016);
      state.spawnTimer = interval;
      const count = 3 * (1 + Math.floor(state.t / 165)); // 刷怪频率约为原来的 3 倍
      for (let i = 0; i < count; i++) spawnEnemy();
    }

    // --- BOSS ---
    if (state.bossNext > 0 && state.t >= state.bossNext) {
      spawnBoss(state.bossIdx);
      state.bossIdx++;
      state.bossNext = state.bossIdx < BOSS_TIMES.length ? BOSS_TIMES[state.bossIdx] : 0;
    }

    // BOSS 技能：每隔几秒放一圈向外扩散的冲击波；最终 BOSS 还会召唤小怪
    for (const en of state.enemies) {
      if (!en.isBoss) continue;
      en.skillT -= dt;
      if (en.skillT > 0) continue;
      en.skillT = en.isFinal ? 3.2 : 5.0;
      state.bossRings.push({
        x: en.x,
        y: en.y,
        r: en.r,
        maxR: en.isFinal ? 460 : 320,
        dmg: en.dmg * 0.9,
        speed: en.isFinal ? 330 : 250,
        hit: false,
        life: 1,
      });
      Sfx.bossRing();
      if (en.isFinal) {
        // 最终 BOSS 一次召唤 4 只小怪
        for (let k = 0; k < 4; k++) {
          const a = rand(0, Math.PI * 2);
          const d = rand(50, 110);
          spawnEnemyAround(en.x + Math.cos(a) * d, en.y + Math.sin(a) * d);
        }
      }
    }

    // 冲击波环推进 + 判定玩家是否被扫到
    for (let i = state.bossRings.length - 1; i >= 0; i--) {
      const ring = state.bossRings[i];
      ring.r += ring.speed * dt;
      ring.life = 1 - ring.r / ring.maxR;
      if (!ring.hit) {
        const d = Math.hypot(p.x - ring.x, p.y - ring.y);
        // 只要玩家在环带附近就算被扫到
        if (Math.abs(d - ring.r) < 22 + PLAYER_R) {
          ring.hit = true;
          hurtPlayer(ring.dmg);
        }
      }
      if (ring.r >= ring.maxR) state.bossRings.splice(i, 1);
    }

    // --- 环绕光球（持续贴身伤害） ---
    if (p.orbit > 0) {
      p.orbitT += dt * 2.1;
      const R = 48;
      for (let i = 0; i < p.orbit; i++) {
        const a = p.orbitT + (i / p.orbit) * Math.PI * 2;
        const ox = p.x + Math.cos(a) * R;
        const oy = p.y + Math.sin(a) * R;
        for (let j = state.enemies.length - 1; j >= 0; j--) {
          const en = state.enemies[j];
          const rr = 11 + en.r;
          if (dist2(ox, oy, en.x, en.y) <= rr * rr) {
            damageEnemy(en, p.orbitDmg * dt, true);
          }
        }
      }
    }

    // --- 新星冲击（周期性范围伤害） ---
    if (p.novaLv > 0) {
      p.novaT -= dt;
      if (p.novaT <= 0) {
        p.novaT = p.novaCd;
        state.novas.push({ x: p.x, y: p.y, r: 20, maxR: p.novaR, life: 1 });
        for (let j = state.enemies.length - 1; j >= 0; j--) {
          const en = state.enemies[j];
          const d = Math.hypot(en.x - p.x, en.y - p.y);
          if (d <= p.novaR + en.r) damageEnemy(en, p.novaDmg);
        }
        Sfx.nova();
      }
    }

    // --- 自动攻击 ---
    state.fireTimer -= dt;
    if (state.fireTimer <= 0) {
      const targets = nearestEnemies(p.x, p.y, p.projectiles);
      if (targets.length) {
        state.fireTimer = p.fireCd;
        for (const en of targets) {
          fireAt(p, en);
        }
        Sfx.shoot();
      } else {
        state.fireTimer = 0.06; // 没敌人时快速重试
      }
    }

    // --- 子弹 ---
    for (let i = state.bullets.length - 1; i >= 0; i--) {
      const b = state.bullets[i];

      // 追踪弹：飞行中把速度方向朝最近敌人转
      if (b.homing > 0) {
        const tgt = nearestEnemyTo(b.x, b.y);
        if (tgt) {
          const want = Math.atan2(tgt.y - b.y, tgt.x - b.x);
          const cur = Math.atan2(b.vy, b.vx);
          let diff = want - cur;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          const step = Math.min(Math.abs(diff), b.homing * dt) * (diff < 0 ? -1 : 1);
          const na = cur + step;
          const sp = Math.hypot(b.vx, b.vy);
          b.vx = Math.cos(na) * sp;
          b.vy = Math.sin(na) * sp;
          b.homingLife = (b.homingLife || 0) + dt;
          if (b.homingLife > 1.2) b.homing = 0; // 追一会儿就不追了，避免无限绕圈
        }
      }

      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0 || b.x < -50 || b.y < -50 || b.x > ARENA + 50 || b.y > ARENA + 50) {
        state.bullets.splice(i, 1);
        continue;
      }
      // 撞敌人
      for (let j = state.enemies.length - 1; j >= 0; j--) {
        const en = state.enemies[j];
        if (b.hitIds.includes(en.id)) continue;
        const rr = b.r + en.r;
        if (dist2(b.x, b.y, en.x, en.y) <= rr * rr) {
          damageEnemy(en, b.damage);
          b.hitIds.push(en.id);
          burst(b.x, b.y, COLORS.bullet, 4, 120, 2);
          Sfx.hit();

          // 爆裂弹：命中点炸开，波及周围敌人（溅射伤害打折）
          if (b.splashR > 0) {
            for (const other of state.enemies) {
              if (other === en) continue;
              const srr = b.splashR + other.r;
              if (dist2(b.x, b.y, other.x, other.y) <= srr * srr) {
                damageEnemy(other, b.splashDmg, true);
              }
            }
            state.novas.push({ x: b.x, y: b.y, r: 8, maxR: b.splashR, life: 1, color: '#ff9c4a' });
            Sfx.boom();
          }

          if (b.hitIds.length > b.pierce) {
            state.bullets.splice(i, 1);
          }
          break;
        }
      }
    }

    // --- 敌人 ---
    for (let i = state.enemies.length - 1; i >= 0; i--) {
      const en = state.enemies[i];
      if (en.hitT > 0) en.hitT -= dt;

      // 追踪玩家
      let dx = p.x - en.x;
      let dy = p.y - en.y;
      const d = Math.hypot(dx, dy) || 1;
      en.x += (dx / d) * en.speed * dt;
      en.y += (dy / d) * en.speed * dt;

      // 击退
      if (en.knockX || en.knockY) {
        en.x += en.knockX * dt;
        en.y += en.knockY * dt;
        en.knockX *= 0.86;
        en.knockY *= 0.86;
        if (Math.hypot(en.knockX, en.knockY) < 4) { en.knockX = 0; en.knockY = 0; }
      }
      en.x = clamp(en.x, en.r, ARENA - en.r);
      en.y = clamp(en.y, en.r, ARENA - en.r);

      // 撞玩家
      const rr = en.r + PLAYER_R;
      if (dist2(en.x, en.y, p.x, p.y) <= rr * rr) {
        hurtPlayer(en.dmg);
        // 撞完弹开一点，避免每帧连续扣血
        en.knockX = -((dx / d) * 160);
        en.knockY = -((dy / d) * 160);
        en.x -= (dx / d) * 6;
        en.y -= (dy / d) * 6;
      }
    }

    // --- 经验宝石 ---
    for (let i = state.gems.length - 1; i >= 0; i--) {
      const g = state.gems[i];
      g.t += dt;
      const dx = p.x - g.x;
      const dy = p.y - g.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d < p.pickup) {
        // 被吸过来
        const pull = 420 * dt * (1 + (p.pickup - d) / p.pickup);
        g.x += (dx / d) * pull;
        g.y += (dy / d) * pull;
      }
      if (d < PLAYER_R + 8) {
        gainXp(g.value);
        state.gems.splice(i, 1);
      }
    }

    stepParticles(dt);
    updateCamera();
    syncHud();
  }

  function stepParticles(dt) {
    // 新星冲击波环
    for (let i = state.novas.length - 1; i >= 0; i--) {
      const n = state.novas[i];
      n.r += (n.maxR - n.r) * Math.min(1, dt * 7);
      n.life -= dt / 0.45;
      if (n.life <= 0) state.novas.splice(i, 1);
    }
    for (let i = state.parts.length - 1; i >= 0; i--) {
      const q = state.parts[i];
      q.vy += 260 * dt;
      q.vx *= 0.97;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.life -= q.decay * dt;
      if (q.life <= 0) state.parts.splice(i, 1);
    }
    for (let i = state.floaters.length - 1; i >= 0; i--) {
      const f = state.floaters[i];
      f.y += f.vy * dt;
      f.vy *= 0.93;
      f.life -= dt / 0.85;
      if (f.life <= 0) state.floaters.splice(i, 1);
    }
  }

  // 敌人是否在可见范围内（含一点外扩，避免边缘反复闪烁）
  function isOnScreen(en) {
    const halfW = VIEW_W / 2 + 20;
    const halfH = view.viewH / 2 + 20;
    return (
      en.x >= state.camX - halfW && en.x <= state.camX + halfW &&
      en.y >= state.camY - halfH && en.y <= state.camY + halfH
    );
  }

  // 只锁定「屏幕内」的敌人。
  // 之前是全场搜索，玩家会把屏幕外的敌人提前清掉，导致根本看不到怪就死了。
  function nearestEnemies(x, y, n) {
    const list = [];
    for (const en of state.enemies) {
      if (!isOnScreen(en)) continue;
      list.push({ en, d: dist2(x, y, en.x, en.y) });
    }
    list.sort((a, b) => a.d - b.d);
    return list.slice(0, n).map((o) => o.en);
  }

  function fireAt(p, en) {
    const base = Math.atan2(en.y - p.y, en.x - p.x);
    const total = 1 + p.spread;          // 散射等级越高子弹越多
    const gap = 0.14;                    // 相邻子弹的夹角
    for (let i = 0; i < total; i++) {
      const off = (i - (total - 1) / 2) * gap;
      const ang = base + off;
      state.bullets.push({
        x: p.x + Math.cos(ang) * 14,
        y: p.y + Math.sin(ang) * 14,
        vx: Math.cos(ang) * 560,
        vy: Math.sin(ang) * 560,
        r: 5.5,
        damage: p.damage,
        life: 1.6,
        pierce: p.infinitePierce ? 999 : p.pierce,
        hitIds: [],
        splashR: p.splashR,
        splashDmg: p.splashDmg,
        homing: p.homingPower,
      });
    }
  }

  // 找离某点最近的敌人（追踪弹用，不受屏幕限制）
  function nearestEnemyTo(x, y) {
    let best = null;
    let bd = Infinity;
    for (const en of state.enemies) {
      const d = dist2(x, y, en.x, en.y);
      if (d < bd) {
        bd = d;
        best = en;
      }
    }
    return best;
  }

  function damageEnemy(en, dmg, soft) {
    en.hp -= dmg;
    if (!soft) en.hitT = 0.09;
    const pushes = soft ? 0 : en.isBoss ? 6 : 90;
    const dx = en.x - state.player.x;
    const dy = en.y - state.player.y;
    const d = Math.hypot(dx, dy) || 1;
    en.knockX += (dx / d) * pushes;
    en.knockY += (dy / d) * pushes;

    if (en.hp <= 0) {
      const idx = state.enemies.indexOf(en);
      if (idx >= 0) state.enemies.splice(idx, 1);
      state.kills++;
      // 掉经验
      state.gems.push({ x: en.x, y: en.y, value: en.xp, t: 0 });
      burst(en.x, en.y, '#ff8fc0', 7, 190, 2.6);
      if (en.r >= 28) addFloater(en.x, en.y - en.r, '击杀', '#ffd24a', 12);
      Sfx.kill();

      // 联动「生命汲取」
      const p = state.player;
      if (p && p.lifesteal > 0 && p.hp < p.maxHp) {
        p.hp = Math.min(p.maxHp, p.hp + p.lifesteal);
        syncHud();
      }
    }
  }

  function hurtPlayer(dmg) {
    const p = state.player;
    if (p.hurtT > 0) return;
    p.hp -= dmg;
    p.hurtT = 0.18;
    Sfx.hurt();
    addFloater(p.x, p.y - 26, '-' + Math.round(dmg), '#ff5b7f', 15);
    burst(p.x, p.y, '#ff5b7f', 8, 160, 2.4);
    syncHud();
    if (p.hp <= 0) {
      p.hp = 0;
      gameOver();
    }
  }

  function gainXp(v) {
    state.xp += v;
    while (state.xp >= state.xpNeed) {
      state.xp -= state.xpNeed;
      state.level++;
      state.xpNeed = Math.round(4 + (state.level - 1) * 2.6);
      openLevelUp();
      break; // 一次只弹一层，剩下的下次继续
    }
    syncHud();
  }

  /* ==================== 升级三选一 ==================== */

  function availableUpgrades() {
    const out = [];
    for (const up of UPGRADES) {
      const took = state.taken[up.id] || 0;
      if (took >= up.max) continue;
      out.push(up);
    }
    return out;
  }

  function openLevelUp() {
    const pool = availableUpgrades();
    if (!pool.length) return;
    // 随机抽 3 个不重复的
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    state.picks = pool.slice(0, 3);
    state.phase = 'levelup';
    renderCards();
    elLvUpNum.textContent = 'Lv.' + state.level;
    elLevelup.classList.add('show');
    Sfx.levelup();
  }

  function renderCards() {
    elCards.innerHTML = '';
    const p = state.player;
    for (const up of state.picks) {
      const took = state.taken[up.id] || 0;
      const isNew = took === 0;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'card' + (isNew ? ' new' : '');
      btn.innerHTML =
        `<span class="ico">${up.icon}</span>` +
        `<span class="body">` +
        `<span class="name">${up.name}${isNew ? '<span class="tag">NEW</span>' : ''}</span>` +
        `<span class="desc">${up.desc(p)}</span>` +
        `</span>` +
        `<span class="lv">${up.max < 90 ? took + '/' + up.max : ''}</span>`;
      btn.addEventListener('click', () => chooseUpgrade(up));
      elCards.appendChild(btn);
    }
  }

  function chooseUpgrade(up) {
    up.apply(state.player);
    state.taken[up.id] = (state.taken[up.id] || 0) + 1;
    elLevelup.classList.remove('show');
    state.phase = 'playing';
    checkSynergies();
    syncHud();
  }

  // 每次选完升级都检查一次：有没有新条件满足的联动
  function checkSynergies() {
    for (const sy of SYNERGIES) {
      if (state.synergies[sy.id]) continue;
      let met = true;
      for (const k in sy.need) {
        if ((state.taken[k] || 0) < sy.need[k]) { met = false; break; }
      }
      if (!met) continue;
      state.synergies[sy.id] = true;
      sy.apply(state.player);
      showToast(sy.icon + ' 联动解锁：' + sy.name + '（总级数 ' + synergyTotal(sy) + '）　' + sy.desc);
      Sfx.synergy();
    }
  }

  let toastTimer = null;
  function showToast(text) {
    const el = document.getElementById('toast');
    el.textContent = text;
    el.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  /* ==================== 暂停 ==================== */

  const elPause = document.getElementById('pauseModal');
  const elPauseSub = document.getElementById('pauseSub');

  function pauseGame() {
    if (state.phase !== 'playing') return;
    state.phase = 'paused';
    elPauseSub.textContent = fmtTime(state.t) + '　击杀 ' + state.kills;
    elPause.classList.add('show');
    input.x = 0;
    input.y = 0;
  }

  function resumeGame() {
    if (state.phase !== 'paused') return;
    state.phase = 'playing';
    last = 0; // 避免暂停期间累积的时间一次性补上
    elPause.classList.remove('show');
  }

  /* ==================== 图鉴（升级 + 联动） ==================== */

  const elChart = document.getElementById('chartModal');
  const elChartBody = document.getElementById('chartBody');
  let chartPaused = false;

  // 升级 id -> 显示名，供联动条件显示用
  function upName(id) {
    for (const up of UPGRADES) if (up.id === id) return up.name;
    return id;
  }

  function buildChart() {
    const p = state.player;
    let html = '';

    html += `<h3>升级（${UPGRADES.length} 项）</h3>`;
    for (const up of UPGRADES) {
      const took = state.taken[up.id] || 0;
      const lvText = up.max > 90 ? '∞' : `${took}/${up.max}`;
      const done = up.max < 90 && took >= up.max;
      html +=
        `<div class="citem${done ? ' got' : ''}">` +
        `<span class="cico">${up.icon}</span>` +
        `<span class="cbody">` +
        `<span class="cname">${up.name}</span>` +
        `<span class="cdesc">${p ? up.desc(p) : ''}</span>` +
        `</span>` +
        `<span class="clv">${lvText}</span>` +
        `</div>`;
    }

    html += `<h3>联动（${SYNERGIES.length} 组 · 总级数越高越强）</h3>`;
    const sorted = SYNERGIES.slice().sort((a, b) => synergyTotal(a) - synergyTotal(b));
    for (const sy of sorted) {
      const got = !!state.synergies[sy.id];
      const total = synergyTotal(sy);
      const cond = Object.keys(sy.need)
        .map((k) => `${upName(k)} ${sy.need[k]}`)
        .join(' + ');
      html +=
        `<div class="citem${got ? ' got' : ''}">` +
        `<span class="cico">${sy.icon}</span>` +
        `<span class="cbody">` +
        `<span class="cname">${sy.name}${got ? ' ✓' : ''}</span>` +
        `<span class="cdesc">${sy.desc}</span><br>` +
        `<span class="cond">${cond}（共 ${total} 级）</span>` +
        `</span>` +
        `</div>`;
    }

    elChartBody.innerHTML = html;
  }

  function openChart() {
    if (state.phase === 'playing') {
      state.phase = 'paused';
      chartPaused = true;
    }
    buildChart();
    elChart.classList.add('show');
  }

  function closeChart() {
    elChart.classList.remove('show');
    if (chartPaused && state.phase === 'paused') {
      state.phase = 'playing';
      last = 0;
    }
    chartPaused = false;
  }

  /* ==================== 结束 ==================== */

  function saveBest() {
    if (state.t > state.best) {
      state.best = state.t;
      try { localStorage.setItem(BEST_KEY, String(state.best)); } catch (e) { /* 忽略 */ }
    }
  }

  function gameOver() {
    state.phase = 'over';
    saveBest();
    Sfx.over();
    showEnd('游戏结束', '再来一局');
  }

  function win() {
    state.phase = 'win';
    saveBest();
    Sfx.win();
    showEnd('撑过来了！', '再来一局');
  }

  function showEnd(title, btn) {
    elOvTitle.textContent = title;
    elOvSub.textContent = title === '撑过来了！' ? '活满 5 分钟，你赢了' : '再撑久一点就赢了';
    elOvStats.hidden = false;
    elStTime.textContent = fmtTime(state.t);
    elStKills.textContent = String(state.kills);
    elStBest.textContent = fmtTime(state.best);
    elOvBtn.textContent = btn;
    elOverlay.classList.add('show');
  }

  /* ==================== 渲染 ==================== */

  function render() {
    const { w, h, dpr, scale, viewH } = view;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // 背景
    ctx.fillStyle = '#12101c';
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.scale(scale, scale);
    // 世界原点 -> 屏幕：让相机中心落在屏幕中心
    ctx.translate(VIEW_W / 2 - state.camX, viewH / 2 - state.camY);

    drawGrid();
    drawArenaBorder();
    drawGems();
    drawEnemies();
    drawNovas();
    drawBossRings();
    drawBullets();
    drawPlayer();
    drawOrbs();
    drawParticles();
    drawFloaters();

    ctx.restore();

    drawVignette();
    drawJoystick();
  }

  function drawGrid() {
    const step = 120;
    const x0 = Math.floor((state.camX - VIEW_W) / step) * step;
    const y0 = Math.floor((state.camY - view.viewH) / step) * step;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.035)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = x0; x < state.camX + VIEW_W; x += step) {
      ctx.moveTo(x, state.camY - view.viewH);
      ctx.lineTo(x, state.camY + view.viewH);
    }
    for (let y = y0; y < state.camY + view.viewH; y += step) {
      ctx.moveTo(state.camX - VIEW_W, y);
      ctx.lineTo(state.camX + VIEW_W, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawArenaBorder() {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,122,184,0.35)';
    ctx.lineWidth = 4;
    ctx.strokeRect(0, 0, ARENA, ARENA);
    ctx.restore();
  }

  function drawPlayer() {
    const p = state.player;
    if (!p) return;
    const img = sprites[PLAYER_SPRITE];

    // 脚下光晕
    ctx.save();
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, PLAYER_R * 2.4);
    g.addColorStop(0, 'rgba(110,231,255,0.34)');
    g.addColorStop(1, 'rgba(110,231,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, PLAYER_R * 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 受伤闪白
    if (img) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.drawImage(img, -PLAYER_R, -PLAYER_R, PLAYER_R * 2, PLAYER_R * 2);
      if (p.hurtT > 0) {
        ctx.globalAlpha = 0.55 * (p.hurtT / 0.18);
        ctx.fillStyle = '#ff5b7f';
        ctx.beginPath();
        ctx.arc(0, 0, PLAYER_R, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // 青色描边，和敌人区分开
    ctx.save();
    ctx.strokeStyle = COLORS.player;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.arc(p.x, p.y, PLAYER_R - 1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // 环绕光球
  function drawOrbs() {
    const p = state.player;
    if (!p || p.orbit <= 0) return;
    const R = 48;
    ctx.save();
    for (let i = 0; i < p.orbit; i++) {
      const a = p.orbitT + (i / p.orbit) * Math.PI * 2;
      const ox = p.x + Math.cos(a) * R;
      const oy = p.y + Math.sin(a) * R;
      // 拖尾
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = '#6ee7ff';
      ctx.beginPath();
      ctx.arc(p.x + Math.cos(a - 0.35) * R, p.y + Math.sin(a - 0.35) * R, 5, 0, Math.PI * 2);
      ctx.fill();
      // 球体
      ctx.globalAlpha = 1;
      const g = ctx.createRadialGradient(ox, oy, 0, ox, oy, 13);
      g.addColorStop(0, 'rgba(200,250,255,1)');
      g.addColorStop(0.45, 'rgba(110,231,255,0.9)');
      g.addColorStop(1, 'rgba(110,231,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(ox, oy, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#eafcff';
      ctx.beginPath();
      ctx.arc(ox, oy, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // BOSS 的冲击波环（紫红色，比玩家的新星更粗，带危险感）
  function drawBossRings() {
    if (!state.bossRings.length) return;
    ctx.save();
    for (const ring of state.bossRings) {
      const a = Math.max(0, Math.min(1, ring.life));
      ctx.globalAlpha = 0.35 + 0.5 * a;
      ctx.strokeStyle = ring.hit ? '#ff8fa8' : '#c86bff';
      ctx.lineWidth = 6 + 8 * a;
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.1 + 0.08 * a;
      ctx.fillStyle = '#c86bff';
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // 新星冲击波环
  function drawNovas() {
    if (!state.novas.length) return;
    ctx.save();
    for (const n of state.novas) {
      const a = Math.max(0, n.life);
      ctx.globalAlpha = a * 0.75;
      ctx.strokeStyle = n.color || '#ffd24a';
      ctx.lineWidth = 3 + 6 * a;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = a * 0.16;
      ctx.fillStyle = n.color || '#ffd24a';
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawEnemies() {
    for (const en of state.enemies) {
      // BOSS 光晕：让人一眼分辨出这不是普通大怪
      if (en.isBoss) {
        const tt = state.t * 3;
        ctx.save();
        const gg = ctx.createRadialGradient(en.x, en.y, en.r * 0.6, en.x, en.y, en.r * 2.1);
        gg.addColorStop(0, `rgba(255,80,120,${(0.4 + 0.12 * Math.sin(tt)).toFixed(3)})`);
        gg.addColorStop(1, 'rgba(255,80,120,0)');
        ctx.fillStyle = gg;
        ctx.beginPath();
        ctx.arc(en.x, en.y, en.r * 2.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,210,74,0.9)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(en.x, en.y, en.r + 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      const img = sprites[en.sprite];
      if (img) {
        ctx.save();
        ctx.translate(en.x, en.y);
        ctx.drawImage(img, -en.r, -en.r, en.r * 2, en.r * 2);
        if (en.hitT > 0) {
          ctx.globalAlpha = Math.min(0.7, en.hitT / 0.09 * 0.7);
          ctx.fillStyle = '#fff';
          ctx.beginPath();
          ctx.arc(0, 0, en.r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
      // 血条（只给大怪显示）
      if (en.maxHp > 40 && en.hp < en.maxHp) {
        const wgt = en.r * 1.6;
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(en.x - wgt / 2, en.y - en.r - 9, wgt, 4.5);
        ctx.fillStyle = '#ff5b7f';
        ctx.fillRect(en.x - wgt / 2, en.y - en.r - 9, (wgt * en.hp) / en.maxHp, 4.5);
        ctx.restore();
      }
    }
  }

  function drawBullets() {
    ctx.save();
    ctx.fillStyle = COLORS.bullet;
    ctx.shadowColor = 'rgba(255,229,138,0.9)';
    ctx.shadowBlur = 10;
    for (const b of state.bullets) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawGems() {
    ctx.save();
    for (const g of state.gems) {
      const s = 4 + Math.min(4, g.value * 0.35);
      ctx.fillStyle = COLORS.xp;
      ctx.shadowColor = 'rgba(110,231,255,0.9)';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(g.x, g.y, s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawParticles() {
    ctx.save();
    for (const q of state.parts) {
      ctx.globalAlpha = Math.max(0, q.life);
      ctx.fillStyle = q.color;
      ctx.beginPath();
      ctx.arc(q.x, q.y, q.r * q.life, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawFloaters() {
    if (!state.floaters.length) return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of state.floaters) {
      ctx.globalAlpha = Math.min(1, f.life * 1.6);
      ctx.font = `800 ${f.size}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.65)';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawVignette() {
    const { w, h } = view;
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.max(w, h) * 0.72);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  // 可见摇杆（画在屏幕坐标上，不受相机影响）
  // 手感上是「点屏幕任意位置都能控」，但底座固定显示在左下，
  // 这样玩家一眼就知道要怎么操作。
  const STICK_UI = { x: 0, y: 0, r: 62 };

  function drawJoystick() {
    if (state.phase !== 'playing') return;
    const { w, h } = view;
    const cx = w / 2;
    const cy = h - 30 - STICK_UI.r;
    STICK_UI.x = cx;
    STICK_UI.y = cy;

    const active = stick.active;
    const R = STICK_UI.r;

    ctx.save();

    // 底座
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = active ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.06)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = active ? 'rgba(255,255,255,0.38)' : 'rgba(255,255,255,0.2)';
    ctx.stroke();

    // 外圈刻度（四个方向的小点）
    ctx.fillStyle = active ? 'rgba(255,255,255,0.42)' : 'rgba(255,255,255,0.22)';
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * (R - 9), cy + Math.sin(a) * (R - 9), 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // 摇杆头
    const kx = cx + input.x * R * 0.68;
    const ky = cy + input.y * R * 0.68;
    ctx.beginPath();
    ctx.arc(kx, ky, R * 0.4, 0, Math.PI * 2);
    ctx.fillStyle = active ? 'rgba(110,231,255,0.62)' : 'rgba(110,231,255,0.34)';
    ctx.fill();
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = active ? 'rgba(150,240,255,0.95)' : 'rgba(110,231,255,0.6)';
    ctx.stroke();

    // 中心小点
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fill();

    ctx.restore();
  }

  /* ==================== 主循环 ==================== */

  let last = 0;

  function loop(ts) {
    requestAnimationFrame(loop);
    if (!last) last = ts;
    let dt = (ts - last) / 1000;
    last = ts;
    if (dt > 0.05) dt = 0.05; // 切标签页回来别一次补太多

    update(dt);
    render();
  }

  /* ==================== 启动 ==================== */

  function boot() {
    resize();
    bindInput(cv);

    try {
      const b = Number(localStorage.getItem(BEST_KEY) || 0);
      if (isFinite(b)) state.best = b;
    } catch (e) { /* 忽略 */ }

    elOvBtn.addEventListener('click', () => {
      Sfx.ensure();
      elOverlay.classList.remove('show');
      elStickHint.classList.remove('hide');
      hintTimer = null;
      resetGame();
    });

    document.getElementById('btnSound').addEventListener('click', (ev) => {
      const on = Sfx.toggle();
      ev.currentTarget.textContent = on ? '🔊' : '🔇';
      ev.currentTarget.classList.toggle('off', !on);
    });

    // 暂停
    document.getElementById('btnPause').addEventListener('click', () => {
      if (state.phase === 'playing') pauseGame();
      else if (state.phase === 'paused') resumeGame();
    });
    document.getElementById('btnResume').addEventListener('click', resumeGame);
    document.getElementById('btnRestart2').addEventListener('click', () => {
      elPause.classList.remove('show');
      last = 0;
      resetGame();
    });

    // 图鉴
    document.getElementById('btnChart').addEventListener('click', openChart);
    document.getElementById('chartClose').addEventListener('click', closeChart);
    elChart.addEventListener('click', (e) => {
      if (e.target === elChart) closeChart();
    });

    // 切到后台自动暂停，别让玩家回来发现已经死了
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && state.phase === 'playing') pauseGame();
    });

    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', () => setTimeout(resize, 120));

    loadSprites().then(() => {
      requestAnimationFrame(loop);
    });
  }

  /* ==================== 无头测试钩子 ==================== */

  if (typeof window !== 'undefined' && window.__JINA2_TEST__) {
    window.__JINA2__ = {
      state, view, ARENA, VIEW_W, ENEMY_TYPES, UPGRADES, PLAYER_SPRITE,
      resetGame, update, render, resize, spawnEnemy, damageEnemy, gainXp,
      nearestEnemies, openLevelUp, chooseUpgrade, availableUpgrades,
      checkSynergies, SYNERGIES, isOnScreen, drawJoystick,
      spawnBoss, BOSS_TIMES, BOSS_SPRITE, GAME_LENGTH, fireAt,
      pauseGame, resumeGame, openChart, closeChart, buildChart, upName,
      stickUi: () => STICK_UI, elChartBody,
      setInput(x, y) { input.x = x; input.y = y; },
      gameOver, win, syncHud,
    };
  }

  boot();
})();























