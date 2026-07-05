// DoDonClone — full featured shmup

const W = 480;
const H = 640;
const VERSION = 'V0.8';

// ─── Shared state across scenes ───────────────────────────────────────────────
const State = {
  ship: 0,          // chosen ship index
  score: 0,
  level: 1,
  lives: 3,
  powerLevel: 0,    // 0-4 actual power tier
  subPower: 0,      // 0-3 pickups within current tier before leveling up
  scores: [],       // highscore list [{name, score, level}]

  loadScores() {
    try { this.scores = JSON.parse(localStorage.getItem('ddc_scores') || '[]'); } catch(e) { this.scores = []; }
  },
  saveScore(name, score, level) {
    this.scores.push({ name, score, level });
    this.scores.sort((a, b) => b.score - a.score);
    this.scores = this.scores.slice(0, 10);
    localStorage.setItem('ddc_scores', JSON.stringify(this.scores));
  }
};

// ─── Music helper ─────────────────────────────────────────────────────────────
let _music = null;
function playMusic(scene, key, volume = 0.55) {
  if (_music) { _music.stop(); _music.destroy(); _music = null; }
  if (!key) return;
  _music = scene.sound.add(key, { loop: true, volume });
  _music.play();
}

// ─── Ship definitions ─────────────────────────────────────────────────────────
const SHIPS = [
  {
    name: 'VALKYRIE',
    desc: 'Balanced · Triple spread shot',
    color: 0x4488ff,
    speed: 240,
    focusSpeed: 110,
    power: 0.65,      // relative damage output — shown as the PWR bar on ship select
    texture: 'pship_valkyrie',
    centerFrame: 2,   // strip5: hard-left, left, center, right, hard-right
    bank: true,
    scale: 3,
    fireRate: 65,
    fire(scene, px, py, lvl) {
      const spread = Math.min(lvl + 1, 4); // 2–5 bullets
      const angles = [];
      for (let i = 0; i <= spread; i++) angles.push(-spread * 8 + i * 16);
      // damage 2 per bullet — spread means not all hit one target, so effective DPS is balanced
      angles.forEach(ang => { const b = spawnPlayerBullet(scene, px, py, ang - 90, 650); if (b) b.damage = 2; });
    },
    laser(scene, px, py, dmg) { spawnLaser(scene, px, py, 0, dmg); }
  },
  {
    name: 'THUNDERBOLT',
    desc: 'Fast · Forward burst',
    color: 0xffaa00,
    speed: 310,
    focusSpeed: 140,
    power: 0.5,
    texture: 'pship_thunder',
    centerFrame: 2,
    bank: true,
    scale: 2.5,
    fireRate: 60,
    fire(scene, px, py, lvl) {
      // Centre shot hits hard so the base weapon stays viable against late-game
      // boss health pools even after dying back to power level 0
      const c = spawnPlayerBullet(scene, px, py, -90, 700);
      if (c) c.damage = 3;
      if (lvl >= 1) { spawnPlayerBullet(scene, px - 8, py + 4, -90, 650); spawnPlayerBullet(scene, px + 8, py + 4, -90, 650); }
      if (lvl >= 2) { spawnPlayerBullet(scene, px - 16, py + 8, -80, 600); spawnPlayerBullet(scene, px + 16, py + 8, -100, 600); }
      if (lvl >= 3) { spawnPlayerBullet(scene, px - 22, py + 10, -75, 580); spawnPlayerBullet(scene, px + 22, py + 10, -105, 580); }
    },
    laser(scene, px, py, dmg) {
      // Two beams split the damage budget so total ≈ same as Valkyrie
      const half = Math.ceil(dmg / 2);
      spawnLaser(scene, px - 10, py, 0, half);
      spawnLaser(scene, px + 10, py, 0, half);
    }
  },
  {
    name: 'DEVASTATOR',
    desc: 'Heavy · Powerful slow spread',
    color: 0xff4466,
    speed: 180,
    focusSpeed: 80,
    power: 0.85,
    texture: 'nship_5',   // big 128px heavy cruiser — fits the tank role
    centerFrame: 0,
    bank: false,
    scale: 0.5,
    fireRate: 170,   // was 140 — heavy shells hit hard, so the volley cadence pays for it
    fire(scene, px, py, lvl) {
      const count = 3 + lvl * 2;
      for (let i = 0; i < count; i++) {
        const ang = -90 - (count - 1) * 10 + i * 20;
        const b = spawnPlayerBullet(scene, px, py, ang, 500);
        b.setScale(3); // heavy shells — chunkier than the standard 2x
        b.damage = 3;  // heavy-class damage keeps base shot viable vs late bosses
      }
    },
    laser(scene, px, py, dmg) {
      // Three beams split the budget — centre gets slightly more, fits the heavy role
      const third = Math.max(1, Math.floor(dmg / 3));
      spawnLaser(scene, px, py, 0, third + 1);
      spawnLaser(scene, px - 12, py + 6, -5, third);
      spawnLaser(scene, px + 12, py + 6, 5, third);
    }
  }
];

// ─── Utility ──────────────────────────────────────────────────────────────────

function spawnPlayerBullet(scene, x, y, angleDeg, speed) {
  const rad = Phaser.Math.DegToRad(angleDeg);
  // Bullet art grows with power tier: 0-1 → thin, 2-3 → medium, 4 → wide
  const tier = State.powerLevel >= 4 ? 2 : State.powerLevel >= 2 ? 1 : 0;
  const key = 'pbullet' + tier;
  const b = scene.playerBullets.get(x, y, key);
  if (!b) return null;
  if (b.texture.key !== key) b.setTexture(key, 0);
  b.setActive(true).setVisible(true).setPosition(x, y).setScale(2).setAlpha(1);
  b.setRotation(rad + Math.PI / 2); // art points up; align with travel direction
  b.damage = 1;
  b.body.reset(x, y);
  // generous hitbox — thin art shouldn't mean stingy hits (source px, scaled by 2)
  b.body.setSize(b.width + 4, b.height, true);
  b.setVelocity(Math.cos(rad) * speed, Math.sin(rad) * speed);
  return b;
}

function spawnLaser(scene, x, y, angleDeg, damage) {
  const rad = Phaser.Math.DegToRad(angleDeg - 90);
  const b = scene.laserGroup.get(x, y, 'laser_bullet');
  if (!b) return null;
  b.setActive(true).setVisible(true).setPosition(x, y).setAlpha(1);
  b.damage = damage;
  b.body.reset(x, y);
  b.setVelocity(Math.cos(rad) * 900, Math.sin(rad) * 900);
  return b;
}

// Fixed tint per sprite — gives each ship its own colour identity regardless of level
const ENEMY_TINT = {
  'ship_0012': 0x44ffff,   // cyan — fast scout
  'ship_0013': 0xaaff44,   // lime — light fighter
  'ship_0014': 0xff8844,   // orange — mid fighter
  'ship_0015': 0xff3333,   // red — armoured
  'ship_0016': 0xffff44,   // yellow — patrol
  'ship_0017': 0xff44ff,   // magenta — void runner
  'ship_0018': 0x44ff99,   // mint — assault
  'ship_0019': 0xff6600,   // deep orange — heavy
  'ship_0020': 0xff2288,   // hot pink — elite
  'ship_0021': 0x9955ff,   // purple — champion
  'ship_0022': 0xffdd00,   // gold — boss
  'ship_0023': 0xff0044,   // crimson — apex boss
};

// Mixed-resolution art: normalize scale/hitbox per texture family so cfg.scale
// keeps meaning the same world size regardless of source art.
// factor: applied to cfg.scale · body: source-px hitbox ·
// faceUp: art drawn nose-up (needs flipY as an enemy) · tintable: flat art that takes ENEMY_TINT
function texInfo(tex) {
  if (tex.startsWith('nship_')) return { factor: 0.32, body: 62, faceUp: true,  tintable: false };
  if (tex.startsWith('eship_')) return { factor: 0.47, body: 40, faceUp: false, tintable: false };
  return { factor: 1, body: 20, faceUp: true, tintable: true };
}
function isNship(tex) { return tex.startsWith('nship_'); }

function spawnEnemy(scene, x, y, cfg) {
  let tex = cfg.texture;
  let isArmored = false;
  if (!tex) {
    tex = Phaser.Utils.Array.GetRandom(scene.levelEnemyTextures || ['ship_0012']);
  } else if (tex === 'ship_0015') {
    tex = Phaser.Utils.Array.GetRandom(scene.levelArmoredTextures || ['ship_0015']);
    isArmored = true;
  }
  const info = texInfo(tex);
  const e = scene.enemies.create(x, y, tex);
  e.setDepth(7);
  e.setFlipY(info.faceUp);
  e.setScale((cfg.scale || 1.5) * info.factor);
  e.hp      = cfg.hp     || 3;
  // Heavies should feel tanky: armored soak ×1.5, hand-placed big-art elites ×1.4.
  // (Single tuning point — wave definitions keep their readable base hp values.)
  if (isArmored) e.hp = Math.ceil(e.hp * 1.5);
  else if (info.factor !== 1) e.hp = Math.ceil(e.hp * 1.4);
  e.points  = cfg.points || 100;
  e.explodeSize = cfg.explodeSize || 'small';
  e.body.allowGravity = false;
  e.body.setSize(info.body, info.body, true); // source px — ~same world hitbox across art
  e.isArmored = isArmored;
  e.setVelocity(cfg.vx || 0, cfg.vy || 60);
  // fully-coloured art is never tinted
  const tint = info.tintable ? (cfg.tint || ENEMY_TINT[tex]) : null;
  if (tint) e.setTint(tint);

  if (cfg.pattern) {
    scene.time.addEvent({
      delay: cfg.patternDelay || 1200,
      // Fire soon after spawning — a hair after they're on-screen — so a
      // quick kill doesn't silently erase them before they ever fire a shot
      startAt: cfg.firstDelay || 300,
      loop: true,
      callback: () => { if (e.active) cfg.pattern(scene, e); }
    });
  }
  if (cfg.move) cfg.move(scene, e);
  return e;
}

function fireBullet(scene, x, y, angle, speed, tint, scale) {
  const rad = Phaser.Math.DegToRad(angle);
  // Animated pack bullets: pink/purple for standard shots, red/orange for heavies.
  // tint param kept for API compat but unused — the art carries the colour now.
  const s = scale || 1;
  const key = s >= 1.2 ? 'ebullet_big' : 'ebullet_med';
  const b = scene.enemyBullets.get(x, y, key);
  if (!b) return null;
  if (b.texture.key !== key) b.setTexture(key, 0);
  b.setActive(true).setVisible(true).setPosition(x, y).setScale(s * 1.3).setAlpha(1);
  b.clearTint();
  b.play(key + '_anim');
  b.body.reset(x, y);
  b.body.setSize(8, 8, true); // forgiving hitbox well inside the art
  b.setVelocity(Math.cos(rad) * speed, Math.sin(rad) * speed);
  return b;
}

function aimAtPlayer(scene, enemy, speed, spreadDeg, count) {
  if (!scene.player || !scene.player.active) return;
  const dx = scene.player.x - enemy.x;
  const dy = scene.player.y - enemy.y;
  const base = Phaser.Math.RadToDeg(Math.atan2(dy, dx));
  const step = count > 1 ? spreadDeg / (count - 1) : 0;
  for (let i = 0; i < count; i++) fireBullet(scene, enemy.x, enemy.y, base - spreadDeg / 2 + step * i, speed);
}

function radialBurst(scene, enemy, count, speed, tint, offset) {
  for (let i = 0; i < count; i++) fireBullet(scene, enemy.x, enemy.y, (360 / count) * i + (offset || 0), speed, tint);
}

// ─── Bullet Patterns ──────────────────────────────────────────────────────────
const P = {
  aimed1:  (s, e) => aimAtPlayer(s, e, 180, 0, 1),
  aimed3:  (s, e) => aimAtPlayer(s, e, 190, 30, 3),
  aimed5:  (s, e) => aimAtPlayer(s, e, 200, 40, 5),
  radial8: (s, e) => radialBurst(s, e, 8,  160, 0xff3300),
  radial12:(s, e) => radialBurst(s, e, 12, 180, 0xff6600),
  radial16:(s, e) => radialBurst(s, e, 16, 200, 0xffaa00),
  doubleRadial(s, e) {
    radialBurst(s, e, 8, 150, 0xff3300);
    s.time.delayedCall(180, () => { if (e.active) radialBurst(s, e, 8, 150, 0xff6600, 22.5); });
  },
  spiral(s, e) {
    e._sa = (e._sa || 0) + 25;
    for (let i = 0; i < 3; i++) fireBullet(s, e.x, e.y, e._sa + i * 120, 170);
  },
  vShape(s, e) {
    for (let i = 0; i < 5; i++) {
      fireBullet(s, e.x, e.y, 80 + i * 8, 210);
      fireBullet(s, e.x, e.y, 100 - i * 8, 210);
    }
  },
  crossAim(s, e) {
    aimAtPlayer(s, e, 200, 0, 1);
    fireBullet(s, e.x, e.y, 0, 160);
    fireBullet(s, e.x, e.y, 90, 160);
    fireBullet(s, e.x, e.y, 180, 160);
    fireBullet(s, e.x, e.y, 270, 160);
  },
  // New patterns for levels 4 & 5
  aimed7:  (s, e) => aimAtPlayer(s, e, 210, 54, 7),
  slowRing: (s, e) => radialBurst(s, e, 16, 95),   // slow wall — forces precise dodging
  pincer(s, e) {                                    // two aimed fans from opposite sides
    aimAtPlayer(s, e, 185, 20, 3);
    s.time.delayedCall(200, () => { if (e.active) aimAtPlayer(s, e, 185, 20, 3); });
  },
  curtain(s, e) {                                   // horizontal sweep of bullets
    for (let i = 0; i < 9; i++) fireBullet(s, 30 + i * 52, e.y, 90, 150, null, 1.2);
  },
  dualSpiral(s, e) {
    e._sa = (e._sa || 0) + 18;
    for (let i = 0; i < 4; i++) fireBullet(s, e.x, e.y, e._sa + i * 90, 175);
    for (let i = 0; i < 4; i++) fireBullet(s, e.x, e.y, e._sa + 45 + i * 90, 130);
  },
  // ── Stage-extension patterns ──
  aimedBig(s, e) {                                  // single heavy slow shell (big red/orange bullet)
    if (!s.player || !s.player.active) return;
    const a = Phaser.Math.RadToDeg(Math.atan2(s.player.y - e.y, s.player.x - e.x));
    fireBullet(s, e.x, e.y, a, 120, null, 1.5);
  },
  doubleTap(s, e) {                                 // two quick aimed shots
    aimAtPlayer(s, e, 200, 0, 1);
    s.time.delayedCall(140, () => { if (e.active) aimAtPlayer(s, e, 200, 0, 1); });
  },
  arcRain(s, e) {                                   // downward fan — walk out of the arc
    for (let i = 0; i < 5; i++) fireBullet(s, e.x, e.y, 50 + i * 20, 170);
  },
  flower(s, e) {                                    // slow rotating 6-arm bloom
    e._fa = (e._fa || 0) + 13;
    for (let i = 0; i < 6; i++) fireBullet(s, e.x, e.y, e._fa + i * 60, 120);
  },
  sideWalls(s, e) {                                 // angled walls from both flanks, centre gap
    for (let i = 0; i < 4; i++) {
      fireBullet(s, e.x - 14, e.y, 155 + i * 10, 150);
      fireBullet(s, e.x + 14, e.y, 25 - i * 10, 150);
    }
  },
  // ── Director's-cut patterns (stage length update) ──
  sweepFan(s, e) {                                  // 3-shot fan that sweeps side to side per volley
    e._sw = (e._sw === undefined ? -30 : e._sw + 15);
    if (e._sw > 30) e._sw = -30;
    for (let i = 0; i < 3; i++) fireBullet(s, e.x, e.y, 90 + e._sw + (i - 1) * 12, 180);
  },
  rain(s, e) {                                      // lazy jittered drizzle straight down
    for (let i = 0; i < 3; i++)
      fireBullet(s, e.x + Phaser.Math.Between(-22, 22), e.y, 90 + Phaser.Math.Between(-8, 8), Phaser.Math.Between(120, 190));
  },
  xCross(s, e) {                                    // diagonal X, then a delayed + volley filling the gaps
    for (let i = 0; i < 4; i++) fireBullet(s, e.x, e.y, 45 + i * 90, 170);
    s.time.delayedCall(220, () => { if (e.active) for (let i = 0; i < 4; i++) fireBullet(s, e.x, e.y, i * 90, 170); });
  },
  snake(s, e) {                                     // two weaving arms — hypnotic sine curtain
    e._sn = (e._sn || 0) + 31;
    fireBullet(s, e.x, e.y, 90 + Math.sin(e._sn / 40) * 50, 160);
    fireBullet(s, e.x, e.y, 90 - Math.sin(e._sn / 40) * 50, 160);
  },
  ringGap(s, e) {                                   // slow ring with a safe gap on the player's side
    if (!s.player || !s.player.active) return;
    const pa = Phaser.Math.RadToDeg(Math.atan2(s.player.y - e.y, s.player.x - e.x));
    for (let i = 0; i < 18; i++) {
      const a = i * 20;
      if (Math.abs(Phaser.Math.Angle.ShortestBetween(a, pa)) > 32) fireBullet(s, e.x, e.y, a, 135);
    }
  }
};

// ─── Movement styles ─────────────────────────────────────────────────────────
// Factories returning cfg.move callbacks — vary how enemies traverse the screen
const M = {
  zigzag: (amp = 70, dur = 800) => (s, e) => {
    s.tweens.add({ targets: e, x: e.x + amp, duration: dur, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  },
  // Dive in, hold position while firing, then leave down the screen
  brake: (stopY = 150, holdMs = 4000) => (s, e) => {
    const iv = s.time.addEvent({ delay: 50, loop: true, callback: () => {
      if (!e.active) { iv.remove(); return; }
      if (e.y >= stopY) {
        iv.remove();
        e.setVelocityY(0);
        s.time.delayedCall(holdMs, () => { if (e.active) e.setVelocityY(130); });
      }
    }});
  },
  // Drift across the full screen width while descending slowly
  sweep: (dir = 1, speed = 90) => (s, e) => {
    e.setVelocityX(dir * speed);
  },
  // Cruise briefly, then lunge down the player's column
  dive: (delayMs = 900) => (s, e) => {
    s.time.delayedCall(delayMs, () => {
      if (!e.active || !s.player || !s.player.active) return;
      s.tweens.add({ targets: e, x: s.player.x, duration: 450, ease: 'Power2' });
      e.setVelocityY(240);
    });
  }
};

// ─── Level definitions ────────────────────────────────────────────────────────
const LEVELS = [
  // LEVEL 1 — SECTOR 1 (intro, very gentle)
  {
    title: 'SECTOR 1',
    bg: { stars: true, layers: [
      { key:'bg_space1', anim:'bg_space1_anim', scale:1.2, speed:16, loop:'wrap', depth:0 },
    ]},
    enemyTextures: ['ship_0012', 'ship_0013'],
    armoredTextures: ['nship_1', 'nship_2'],
    bossTexture: 'nship_6',
    enemyTint: 0xff8844,      // orange — sector 1
    armoredTint: 0xff5500,
    bossTint: 0xffaa66,
    waves: [
      // 1 — single-file trickle, very slow shots
      s => {
        for (let i = 0; i < 4; i++) s.queueSpawn(i * 500, () => {
          spawnEnemy(s, Phaser.Math.Between(80, W-80), -30, { hp:1, points:100, vy:55, pattern:P.aimed1, patternDelay:2400 });
        });
      },
      // 2 — gentle pairs from sides
      s => {
        for (let i = 0; i < 3; i++) s.queueSpawn(i * 600, () => {
          spawnEnemy(s, 80,   -30, { hp:1, points:100, vx:20, vy:55, pattern:P.aimed1, patternDelay:2200 });
          spawnEnemy(s, W-80, -30, { hp:1, points:100, vx:-20, vy:55, pattern:P.aimed1, patternDelay:2200 });
        });
      },
      // 3 — slow diagonal sweep
      s => {
        for (let i = 0; i < 5; i++) s.queueSpawn(i * 380, () => {
          spawnEnemy(s, 60 + i*72, -30, { hp:2, points:110, vx:18, vy:60, pattern:P.aimed1, patternDelay:2000 });
        });
      },
      // 4 — first heavier ships, large patternDelay
      s => {
        for (let i = 0; i < 2; i++) s.queueSpawn(i * 900, () => {
          spawnEnemy(s, 130 + i*220, -40, { texture:'ship_0015', hp:4, points:200, vy:40, pattern:P.radial8, patternDelay:2000 });
        });
      },
      // 5 — aimed trio, still slow
      s => {
        for (let i = 0; i < 4; i++) s.queueSpawn(i * 420, () => {
          spawnEnemy(s, Phaser.Math.Between(70, W-70), -30, { hp:2, points:120, vy:65, pattern:P.aimed1, patternDelay:1900 });
        });
      },
      // 6 — weaving pairs + one radial in centre
      s => {
        for (let i = 0; i < 3; i++) s.queueSpawn(i * 500, () => {
          spawnEnemy(s, 70,   -30, { hp:2, points:120, vx:30, vy:60, pattern:P.aimed1, patternDelay:1800 });
          spawnEnemy(s, W-70, -30, { hp:2, points:120, vx:-30, vy:60, pattern:P.aimed1, patternDelay:1800 });
        });
        s.queueSpawn(800, () => {
          spawnEnemy(s, W/2, -40, { texture:'ship_0015', hp:5, points:250, vy:38, pattern:P.radial8, patternDelay:1800 });
        });
      },
      // 7 — slightly faster swarm
      s => {
        for (let i = 0; i < 5; i++) s.queueSpawn(i * 350, () => {
          spawnEnemy(s, Phaser.Math.Between(70, W-70), -30, { hp:2, points:120, vy:70, pattern:P.aimed1, patternDelay:1700 });
        });
      },
      // 8 — single heavy
      s => {
        s.queueSpawn(0, () => {
          spawnEnemy(s, W/2, -50, { texture:'ship_0015', hp:7, points:350, vy:36, pattern:P.doubleRadial, patternDelay:1600 });
        });
      },
      // 9 — zigzag scouts, double-tap shots
      s => {
        for (let i = 0; i < 4; i++) s.queueSpawn(i * 480, () => {
          spawnEnemy(s, 90 + i*100, -30, { hp:2, points:130, vy:58, pattern:P.doubleTap, patternDelay:2100, move: M.zigzag(70, 950) });
        });
      },
      // 10 — first elite: dives in, holds, blooms a flower
      s => {
        s.queueSpawn(0, () => {
          spawnEnemy(s, W/2, -40, { texture:'nship_16', hp:6, points:400, vy:70, pattern:P.flower, patternDelay:1100, move: M.brake(140, 4200) });
        });
        for (let i = 0; i < 3; i++) s.queueSpawn(700 + i*500, () => {
          spawnEnemy(s, Phaser.Math.Between(70, W-70), -30, { hp:2, points:120, vy:62, pattern:P.aimed1, patternDelay:2000 });
        });
      },
      // 11 — arc-rain line — walk out of the arcs
      s => {
        for (let i = 0; i < 4; i++) s.queueSpawn(i * 520, () => {
          spawnEnemy(s, 80 + i*106, -30, { hp:2, points:130, vy:55, pattern:P.arcRain, patternDelay:2000 });
        });
      },
      // 12 — heavy shell lobbers flanking + centre chaff
      s => {
        s.queueSpawn(0,   () => spawnEnemy(s, 90,   -40, { texture:'ship_0015', hp:5, points:280, vy:38, pattern:P.aimedBig, patternDelay:1500 }));
        s.queueSpawn(400, () => spawnEnemy(s, W-90, -40, { texture:'ship_0015', hp:5, points:280, vy:38, pattern:P.aimedBig, patternDelay:1500 }));
        for (let i = 0; i < 3; i++) s.queueSpawn(600 + i*450, () => {
          spawnEnemy(s, Phaser.Math.Between(70, W-70), -30, { hp:2, points:120, vy:66, pattern:P.aimed1, patternDelay:1900 });
        });
      },
      // 13 — pre-boss: elite pair + swarm
      s => {
        s.queueSpawn(0,   () => spawnEnemy(s, W*0.3, -40, { texture:'nship_16', hp:7, points:450, vy:60, pattern:P.flower, patternDelay:1100, move: M.brake(120, 5000) }));
        s.queueSpawn(500, () => spawnEnemy(s, W*0.7, -40, { texture:'nship_16', hp:7, points:450, vy:60, pattern:P.doubleTap, patternDelay:1400, move: M.brake(180, 5000) }));
        for (let i = 0; i < 4; i++) s.queueSpawn(900 + i*380, () => {
          spawnEnemy(s, Phaser.Math.Between(70, W-70), -30, { hp:2, points:130, vy:70, pattern:P.aimed1, patternDelay:1800 });
        });
      },
      // 14 — breather: lazy drizzle line
      s => {
        for (let i = 0; i < 4; i++) s.queueSpawn(i * 550, () => {
          spawnEnemy(s, 80 + i*106, -30, { hp:2, points:120, vy:52, pattern:P.rain, patternDelay:1900 });
        });
      },
      // 15 — sweeping fans crossing the screen
      s => {
        for (let i = 0; i < 3; i++) s.queueSpawn(i * 700, () => {
          spawnEnemy(s, -30, -20 - i*10, { hp:3, points:150, vy:38, pattern:P.sweepFan, patternDelay:1500, move: M.sweep(1, 85) });
          spawnEnemy(s, W+30, -20 - i*10, { hp:3, points:150, vy:38, pattern:P.sweepFan, patternDelay:1500, move: M.sweep(-1, 85) });
        });
      },
      // 16 — snake weaver elite holds centre
      s => {
        s.queueSpawn(0, () => {
          spawnEnemy(s, W/2, -40, { texture:'nship_9', hp:7, points:450, vy:65, pattern:P.snake, patternDelay:420, move: M.brake(150, 4600) });
        });
        for (let i = 0; i < 3; i++) s.queueSpawn(800 + i*500, () => {
          spawnEnemy(s, Phaser.Math.Between(70, W-70), -30, { hp:2, points:120, vy:60, pattern:P.aimed1, patternDelay:2000 });
        });
      },
      // 17 — divers! cruise then lunge down your column
      s => {
        for (let i = 0; i < 5; i++) s.queueSpawn(i * 600, () => {
          spawnEnemy(s, 80 + i*80, -30, { hp:2, points:140, vy:46, pattern:P.aimed1, patternDelay:2200, move: M.dive(1100) });
        });
      },
      // 18 — X-cross heavies flanking + chaff
      s => {
        s.queueSpawn(0,   () => spawnEnemy(s, 110,   -40, { texture:'ship_0015', hp:6, points:320, vy:36, pattern:P.xCross, patternDelay:1700 }));
        s.queueSpawn(600, () => spawnEnemy(s, W-110, -40, { texture:'ship_0015', hp:6, points:320, vy:36, pattern:P.xCross, patternDelay:1700 }));
        for (let i = 0; i < 3; i++) s.queueSpawn(400 + i*500, () => {
          spawnEnemy(s, Phaser.Math.Between(70, W-70), -30, { hp:2, points:120, vy:64, pattern:P.aimed1, patternDelay:1900 });
        });
      },
      // 19 — breather: zigzag scouts
      s => {
        for (let i = 0; i < 4; i++) s.queueSpawn(i * 500, () => {
          spawnEnemy(s, 90 + i*100, -30, { hp:2, points:130, vy:56, pattern:P.rain, patternDelay:2100, move: M.zigzag(80, 1000) });
        });
      },
      // 20 — first ring-gap: read the gap, sit in it
      s => {
        s.queueSpawn(0, () => {
          spawnEnemy(s, W/2, -40, { texture:'nship_16', hp:7, points:450, vy:60, pattern:P.ringGap, patternDelay:1900, move: M.brake(160, 5000) });
        });
        for (let i = 0; i < 2; i++) s.queueSpawn(900 + i*700, () => {
          spawnEnemy(s, 120 + i*240, -30, { hp:2, points:130, vy:58, pattern:P.doubleTap, patternDelay:2000 });
        });
      },
      // 21 — sweeping fans + drizzle mix
      s => {
        for (let i = 0; i < 2; i++) s.queueSpawn(i * 800, () => {
          spawnEnemy(s, -30, -20, { hp:3, points:150, vy:40, pattern:P.snake, patternDelay:520, move: M.sweep(1, 95) });
          spawnEnemy(s, W+30, -30, { hp:3, points:150, vy:40, pattern:P.rain, patternDelay:1700, move: M.sweep(-1, 95) });
        });
        for (let i = 0; i < 3; i++) s.queueSpawn(400 + i*450, () => {
          spawnEnemy(s, Phaser.Math.Between(70, W-70), -30, { hp:2, points:120, vy:66, pattern:P.aimed1, patternDelay:1900 });
        });
      },
      // 22 — elite trio: snake, flower, ring-gap
      s => {
        s.queueSpawn(0,    () => spawnEnemy(s, W*0.5,  -40, { texture:'nship_9',  hp:8, points:500, vy:60, pattern:P.snake,   patternDelay:420,  move: M.brake(120, 5200) }));
        s.queueSpawn(700,  () => spawnEnemy(s, W*0.25, -40, { texture:'nship_16', hp:8, points:500, vy:60, pattern:P.flower,  patternDelay:1200, move: M.brake(170, 5200) }));
        s.queueSpawn(1400, () => spawnEnemy(s, W*0.75, -40, { texture:'nship_16', hp:8, points:500, vy:60, pattern:P.ringGap, patternDelay:2000, move: M.brake(210, 5200) }));
      },
      // 23 — final ramp: divers + heavy shells
      s => {
        for (let i = 0; i < 4; i++) s.queueSpawn(i * 450, () => {
          spawnEnemy(s, 80 + i*106, -30, { hp:3, points:150, vy:50, pattern:P.aimed1, patternDelay:1800, move: M.dive(1000) });
        });
        s.queueSpawn(900,  () => spawnEnemy(s, 130,   -45, { texture:'ship_0015', hp:6, points:350, vy:34, pattern:P.aimedBig, patternDelay:1500 }));
        s.queueSpawn(1400, () => spawnEnemy(s, W-130, -45, { texture:'ship_0015', hp:6, points:350, vy:34, pattern:P.aimedBig, patternDelay:1500 }));
      },
    ],
    boss: s => spawnBoss(s, {
      texture: 'boss_space1', anim: 'boss_space1_anim', scale: 1.4, flip: true, hitbox: 60, // art faces up — flip to dive at player
      hp: 280, points: 5000,
      patterns: [P.radial8, P.aimed3],
      patternDelay: 1200,
      move: 'roam'
    })
  },

  // LEVEL 2 — NEBULA CROSS (slightly harder, new players still comfortable)
  {
    title: 'NEBULA CROSS',
    bg: { stars: true, layers: [
      { key:'bg_space2_far',    anim:'bg_space2_far_anim', scale:1.2, speed:10, loop:'wrap',  depth:0 },
      { key:'bg_space2_ground', scale:1.2, speed:30, loop:'clamp', depth:1 },
    ]},
    enemyTextures: ['ship_0016', 'ship_0013'],
    armoredTextures: ['eship_orange', 'nship_3'], // orange moth debuts here
    enemyTint: 0x00ffcc,      // teal/mint — nebula cross
    armoredTint: 0x00ddaa,
    bossTint: 0x44ffdd,
    waves: [
      // 1 — aimed1 opener, moderate speed
      s => {
        for (let i = 0; i < 5; i++) s.queueSpawn(i * 380, () => {
          spawnEnemy(s, Phaser.Math.Between(70, W-70), -30, { hp:2, points:130, vy:70, pattern:P.aimed1, patternDelay:1800 });
        });
      },
      // 2 — side pairs, aimed1
      s => {
        for (let i = 0; i < 3; i++) s.queueSpawn(i * 550, () => {
          spawnEnemy(s, 70,   -30, { hp:2, points:130, vx:28, vy:65, pattern:P.aimed1, patternDelay:1600 });
          spawnEnemy(s, W-70, -30, { hp:2, points:130, vx:-28, vy:65, pattern:P.aimed1, patternDelay:1600 });
        });
      },
      // 3 — first aimed3 — introduce spread shots
      s => {
        for (let i = 0; i < 4; i++) s.queueSpawn(i * 420, () => {
          spawnEnemy(s, Phaser.Math.Between(70, W-70), -30, { hp:2, points:140, vy:70, pattern:P.aimed3, patternDelay:1800 });
        });
      },
      // 4 — radial column, slow
      s => {
        for (let i = 0; i < 3; i++) s.queueSpawn(i * 650, () => {
          spawnEnemy(s, 100 + i*140, -40, { texture:'ship_0015', hp:5, points:260, vy:40, pattern:P.radial8, patternDelay:1600 });
        });
      },
      // 5 — vShape intro — first time player sees spread
      s => {
        for (let i = 0; i < 4; i++) s.queueSpawn(i * 450, () => {
          spawnEnemy(s, Phaser.Math.Between(70, W-70), -30, { hp:2, points:140, vy:65, pattern:P.vShape, patternDelay:1800 });
        });
      },
      // 6 — mixed aimed1 + aimed3
      s => {
        for (let i = 0; i < 6; i++) s.queueSpawn(i * 300, () => {
          spawnEnemy(s, Phaser.Math.Between(70, W-70), -30, { hp:2, points:140, vy:75, pattern: i%2===0 ? P.aimed1 : P.aimed3, patternDelay:1600 });
        });
      },
      // 7 — double radial heavies
      s => {
        for (let i = 0; i < 3; i++) s.queueSpawn(i * 700, () => {
          spawnEnemy(s, 100 + i*140, -45, { texture:'ship_0015', hp:7, points:350, vy:36, pattern:P.doubleRadial, patternDelay:1400 });
        });
      },
      // 8 — side weave + aimed3 swarm
      s => {
        for (let i = 0; i < 3; i++) s.queueSpawn(i * 500, () => {
          spawnEnemy(s, 70,   -30, { hp:3, points:150, vx:35, vy:65, pattern:P.aimed3, patternDelay:1400 });
          spawnEnemy(s, W-70, -30, { hp:3, points:150, vx:-35, vy:65, pattern:P.aimed3, patternDelay:1400 });
        });
        for (let i = 0; i < 4; i++) s.queueSpawn(300 + i*320, () => {
          spawnEnemy(s, Phaser.Math.Between(70, W-70), -30, { hp:2, points:130, vy:75, pattern:P.aimed1, patternDelay:1700 });
        });
      },
      // 9 — spiral heavies + aimed chaff
      s => {
        for (let i = 0; i < 3; i++) s.queueSpawn(i * 650, () => {
          spawnEnemy(s, 90 + i*150, -40, { texture:'ship_0015', hp:8, points:400, vy:34, pattern:P.spiral, patternDelay:240 });
        });
        for (let i = 0; i < 4; i++) s.queueSpawn(200 + i*300, () => {
          spawnEnemy(s, Phaser.Math.Between(70, W-70), -30, { hp:2, points:130, vy:75, pattern:P.aimed3, patternDelay:1500 });
        });
      },
      // NEW 10 — zigzag weavers with double-tap
      s => {
        for (let i = 0; i < 5; i++) s.queueSpawn(i * 400, () => {
          spawnEnemy(s, 80 + i*80, -30, { hp:3, points:160, vy:62, pattern:P.doubleTap, patternDelay:1700, move: M.zigzag(80, 850) });
        });
      },
      // NEW 11 — elite holds centre with flower + side chaff
      s => {
        s.queueSpawn(0, () => {
          spawnEnemy(s, W/2, -40, { texture:'nship_19', hp:8, points:500, vy:65, pattern:P.flower, patternDelay:950, move: M.brake(150, 4500) });
        });
        for (let i = 0; i < 3; i++) s.queueSpawn(500 + i*450, () => {
          spawnEnemy(s, 70,   -30, { hp:2, points:140, vx:30, vy:68, pattern:P.aimed1, patternDelay:1700 });
          spawnEnemy(s, W-70, -30, { hp:2, points:140, vx:-30, vy:68, pattern:P.aimed1, patternDelay:1700 });
        });
      },
      // NEW 12 — arc-rain sweep + heavy shell lobber
      s => {
        for (let i = 0; i < 5; i++) s.queueSpawn(i * 380, () => {
          spawnEnemy(s, 70 + i*85, -30, { hp:3, points:150, vy:60, pattern:P.arcRain, patternDelay:1800 });
        });
        s.queueSpawn(900, () => {
          spawnEnemy(s, W/2, -45, { texture:'ship_0015', hp:6, points:320, vy:36, pattern:P.aimedBig, patternDelay:1300 });
        });
      },
      // NEW 13 — side-wall bombers force centre play
      s => {
        for (let i = 0; i < 3; i++) s.queueSpawn(i * 700, () => {
          spawnEnemy(s, Phaser.Math.Between(120, W-120), -35, { hp:4, points:220, vy:52, pattern:P.sideWalls, patternDelay:1600 });
        });
      },
      // NEW 14 — pre-boss: two elites braking at different heights + swarm
      s => {
        s.queueSpawn(0,   () => spawnEnemy(s, W*0.28, -40, { texture:'nship_19', hp:9, points:550, vy:60, pattern:P.flower,    patternDelay:1000, move: M.brake(130, 5200) }));
        s.queueSpawn(600, () => spawnEnemy(s, W*0.72, -40, { texture:'nship_19', hp:9, points:550, vy:60, pattern:P.doubleTap, patternDelay:1200, move: M.brake(190, 5200) }));
        for (let i = 0; i < 5; i++) s.queueSpawn(1000 + i*320, () => {
          spawnEnemy(s, Phaser.Math.Between(70, W-70), -30, { hp:2, points:140, vy:75, pattern:P.aimed3, patternDelay:1700 });
        });
      },
      // NEW 15 — snake weavers crossing from both sides
      s => {
        for (let i = 0; i < 3; i++) s.queueSpawn(i * 650, () => {
          spawnEnemy(s, -30, -20 - i*12, { hp:3, points:160, vy:42, pattern:P.snake, patternDelay:460, move: M.sweep(1, 95) });
          spawnEnemy(s, W+30, -20 - i*12, { hp:3, points:160, vy:42, pattern:P.snake, patternDelay:460, move: M.sweep(-1, 95) });
        });
      },
      // NEW 16 — breather: drizzle + zigzag
      s => {
        for (let i = 0; i < 5; i++) s.queueSpawn(i * 420, () => {
          spawnEnemy(s, 80 + i*80, -30, { hp:2, points:140, vy:58, pattern:P.rain, patternDelay:1800, move: M.zigzag(70, 900) });
        });
      },
      // NEW 17 — ring-gap elite + diver escorts
      s => {
        s.queueSpawn(0, () => {
          spawnEnemy(s, W/2, -40, { texture:'nship_6', hp:9, points:550, vy:62, pattern:P.ringGap, patternDelay:1700, move: M.brake(150, 5000) });
        });
        for (let i = 0; i < 4; i++) s.queueSpawn(700 + i*500, () => {
          spawnEnemy(s, 90 + i*100, -30, { hp:2, points:140, vy:50, pattern:P.aimed1, patternDelay:1900, move: M.dive(1000) });
        });
      },
      // NEW 18 — sweeping fans + X-cross centre heavy
      s => {
        for (let i = 0; i < 4; i++) s.queueSpawn(i * 420, () => {
          spawnEnemy(s, 80 + i*106, -30, { hp:3, points:160, vy:60, pattern:P.sweepFan, patternDelay:1400 });
        });
        s.queueSpawn(1000, () => {
          spawnEnemy(s, W/2, -45, { texture:'ship_0015', hp:7, points:380, vy:34, pattern:P.xCross, patternDelay:1500 });
        });
      },
      // NEW 19 — divers en masse
      s => {
        for (let i = 0; i < 6; i++) s.queueSpawn(i * 480, () => {
          spawnEnemy(s, 70 + i*68, -30, { hp:3, points:160, vy:48, pattern:P.doubleTap, patternDelay:1700, move: M.dive(900) });
        });
      },
      // NEW 20 — breather: gentle aimed pairs
      s => {
        for (let i = 0; i < 3; i++) s.queueSpawn(i * 600, () => {
          spawnEnemy(s, 80,   -30, { hp:2, points:140, vx:26, vy:60, pattern:P.aimed1, patternDelay:1800 });
          spawnEnemy(s, W-80, -30, { hp:2, points:140, vx:-26, vy:60, pattern:P.aimed1, patternDelay:1800 });
        });
      },
      // NEW 21 — snake elite + sweeping fan flankers
      s => {
        s.queueSpawn(0, () => {
          spawnEnemy(s, W/2, -40, { texture:'nship_6', hp:9, points:550, vy:62, pattern:P.snake, patternDelay:380, move: M.brake(130, 5000) });
        });
        for (let i = 0; i < 2; i++) s.queueSpawn(600 + i*700, () => {
          spawnEnemy(s, -30, -20, { hp:3, points:160, vy:44, pattern:P.sweepFan, patternDelay:1400, move: M.sweep(1, 100) });
          spawnEnemy(s, W+30, -30, { hp:3, points:160, vy:44, pattern:P.sweepFan, patternDelay:1400, move: M.sweep(-1, 100) });
        });
      },
      // NEW 22 — X-cross wall
      s => {
        for (let i = 0; i < 3; i++) s.queueSpawn(i * 550, () => {
          spawnEnemy(s, 100 + i*140, -45, { texture:'ship_0015', hp:7, points:380, vy:38, pattern:P.xCross, patternDelay:1450 });
        });
        for (let i = 0; i < 3; i++) s.queueSpawn(300 + i*500, () => {
          spawnEnemy(s, Phaser.Math.Between(70, W-70), -30, { hp:2, points:140, vy:70, pattern:P.rain, patternDelay:1700 });
        });
      },
      // NEW 23 — ring-gap pair at staggered heights
      s => {
        s.queueSpawn(0,   () => spawnEnemy(s, W*0.3, -40, { texture:'nship_19', hp:9, points:550, vy:60, pattern:P.ringGap, patternDelay:1800, move: M.brake(130, 5200) }));
        s.queueSpawn(800, () => spawnEnemy(s, W*0.7, -40, { texture:'nship_19', hp:9, points:550, vy:60, pattern:P.ringGap, patternDelay:1800, move: M.brake(200, 5200) }));
        for (let i = 0; i < 3; i++) s.queueSpawn(1200 + i*400, () => {
          spawnEnemy(s, Phaser.Math.Between(70, W-70), -30, { hp:2, points:140, vy:72, pattern:P.aimed3, patternDelay:1700 });
        });
      },
      // NEW 24 — pre-boss crescendo: divers + snake sweepers + heavy
      s => {
        for (let i = 0; i < 4; i++) s.queueSpawn(i * 420, () => {
          spawnEnemy(s, 80 + i*106, -30, { hp:3, points:160, vy:52, pattern:P.aimed3, patternDelay:1600, move: M.dive(1100) });
        });
        s.queueSpawn(800,  () => spawnEnemy(s, -30, -20, { hp:4, points:180, vy:40, pattern:P.snake, patternDelay:430, move: M.sweep(1, 90) }));
        s.queueSpawn(1300, () => spawnEnemy(s, W/2, -45, { texture:'ship_0015', hp:8, points:420, vy:34, pattern:P.aimedBig, patternDelay:1300 }));
      },
    ],
    boss: s => spawnBoss(s, {
      // 3-part moth carrier: body + left/right gun pods drawn on matching canvases
      texture: 'eboss_body', flip: false, scale: 1.6, hitbox: 60,
      overlays: [{ key: 'eboss_lgun' }, { key: 'eboss_rgun' }],
      hp: 500, points: 9000,
      patterns: [P.radial8, P.aimed3, P.spiral],
      patternDelay: 1000,
      move: 'roam'
    })
  },

  // LEVEL 3
  {
    title: 'VOID GATE',
    bg: { dim: 0.35, layers: [
      { key:'bg_industy', scale:2, speed:32, loop:'clamp', depth:0 },
    ]},
    enemyTextures: ['ship_0017', 'ship_0018'],
    armoredTextures: ['nship_10', 'nship_12'],
    bossTexture: 'nship_17',
    enemyTint: 0xff2266,      // hot pink/magenta — void gate
    armoredTint: 0xdd0044,
    bossTint: 0xff44aa,
    overlayColor: 0x880011, overlayAlpha: 0.32,
    // Difficulty pass: VOID GATE was a brick wall for new players — fewer and
    // slower spawns, gentler patterns, more space between volleys
    waves: [
      // 1 — aimed swarm (was 8 fast, now 6 calmer)
      s => {
        for (let i = 0; i < 6; i++) s.queueSpawn(i * 300, () => {
          spawnEnemy(s, Phaser.Math.Between(60, W-60), -30, { hp:3, points:180, vy:85, pattern:P.aimed3, patternDelay:1300 });
        });
      },
      // 2 — side cross-aim pairs
      s => {
        for (let i = 0; i < 3; i++) s.queueSpawn(i * 500, () => {
          spawnEnemy(s, 70,   -30, { hp:4, points:220, vx:35, vy:62, pattern:P.crossAim, patternDelay:1400 });
          spawnEnemy(s, W-70, -30, { hp:4, points:220, vx:-35, vy:62, pattern:P.crossAim, patternDelay:1400 });
        });
      },
      // 3 — radial column
      s => {
        for (let i = 0; i < 4; i++) s.queueSpawn(i * 450, () => {
          spawnEnemy(s, Phaser.Math.Between(60, W-60), -30, { hp:4, points:200, vy:70, pattern:P.radial8, patternDelay:1400 });
        });
      },
      // 4 — zigzag scouts with double-tap (new pattern, breather wave)
      s => {
        for (let i = 0; i < 5; i++) s.queueSpawn(i * 420, () => {
          spawnEnemy(s, 80 + i*80, -30, { hp:3, points:180, vy:65, pattern:P.doubleTap, patternDelay:1600, move: M.zigzag(75, 900) });
        });
      },
      // 5 — spiral heavies + chaff (spirals much slower than before)
      s => {
        for (let i = 0; i < 3; i++) s.queueSpawn(i * 650, () => {
          spawnEnemy(s, 100 + i*140, -40, { texture:'ship_0015', hp:6, points:400, vx:18*((i%2)*2-1), vy:50, pattern:P.spiral, patternDelay:340 });
        });
        for (let i = 0; i < 4; i++) s.queueSpawn(300 + i * 350, () => {
          spawnEnemy(s, Phaser.Math.Between(60, W-60), -30, { hp:3, points:180, vy:80, pattern:P.aimed3, patternDelay:1250 });
        });
      },
      // 6 — cross-fire pairs (fewer, softer)
      s => {
        for (let i = 0; i < 3; i++) s.queueSpawn(i * 500, () => {
          spawnEnemy(s, 70,   -30, { texture:'ship_0015', hp:7, points:400, vx:35, vy:56, pattern:P.crossAim, patternDelay:1300 });
          spawnEnemy(s, W-70, -30, { texture:'ship_0015', hp:7, points:400, vx:-35, vy:56, pattern:P.crossAim, patternDelay:1300 });
        });
      },
      // 7 — elite bloom: holds centre with flower + arc-rain escorts
      s => {
        s.queueSpawn(0, () => {
          spawnEnemy(s, W/2, -40, { texture:'nship_23', hp:9, points:550, vy:60, pattern:P.flower, patternDelay:1000, move: M.brake(150, 4800) });
        });
        for (let i = 0; i < 3; i++) s.queueSpawn(600 + i*500, () => {
          spawnEnemy(s, 90 + i*150, -30, { hp:3, points:180, vy:62, pattern:P.arcRain, patternDelay:1700 });
        });
      },
      // 8 — aimed swarm + centre radial (radial hp trimmed)
      s => {
        for (let i = 0; i < 6; i++) s.queueSpawn(i * 280, () => {
          spawnEnemy(s, Phaser.Math.Between(60, W-60), -30, { hp:4, points:200, vy:95, pattern:P.aimed3, patternDelay:1200 });
        });
        s.queueSpawn(1100, () => {
          spawnEnemy(s, W/2, -50, { texture:'ship_0015', hp:10, points:700, vy:32, pattern:P.radial12, patternDelay:1100 });
        });
      },
      // 9 — double radial heavies (3 instead of 4, slower cycle)
      s => {
        for (let i = 0; i < 3; i++) s.queueSpawn(i * 600, () => {
          spawnEnemy(s, 100 + i*140, -45, { texture:'ship_0015', hp:8, points:500, vy:38, pattern:P.doubleRadial, patternDelay:1200 });
        });
      },
      // 10 — heavy shell lobbers + zigzag chaff
      s => {
        s.queueSpawn(0,   () => spawnEnemy(s, 100,   -40, { texture:'ship_0015', hp:7, points:400, vy:36, pattern:P.aimedBig, patternDelay:1400 }));
        s.queueSpawn(500, () => spawnEnemy(s, W-100, -40, { texture:'ship_0015', hp:7, points:400, vy:36, pattern:P.aimedBig, patternDelay:1400 }));
        for (let i = 0; i < 4; i++) s.queueSpawn(700 + i*400, () => {
          spawnEnemy(s, 90 + i*100, -30, { hp:3, points:180, vy:70, pattern:P.aimed1, patternDelay:1500, move: M.zigzag(60, 800) });
        });
      },
      // 11 — mixed volley (was "absolute hell", now merely spicy)
      s => {
        for (let i = 0; i < 6; i++) s.queueSpawn(i * 260, () => {
          spawnEnemy(s, Phaser.Math.Between(60, W-60), -30, { hp:4, points:200, vy:100, pattern:P.aimed3, patternDelay:1100 });
        });
        for (let i = 0; i < 2; i++) s.queueSpawn(700 + i * 700, () => {
          spawnEnemy(s, 140 + i*200, -50, { texture:'ship_0015', hp:9, points:600, vy:36, pattern:P.doubleRadial, patternDelay:1150 });
        });
      },
      // 12 — pre-boss: elite pair + side-wall bomber
      s => {
        s.queueSpawn(0,   () => spawnEnemy(s, W*0.3, -40, { texture:'nship_23', hp:10, points:600, vy:58, pattern:P.flower,    patternDelay:1000, move: M.brake(130, 5200) }));
        s.queueSpawn(600, () => spawnEnemy(s, W*0.7, -40, { texture:'nship_23', hp:10, points:600, vy:58, pattern:P.doubleTap, patternDelay:1250, move: M.brake(185, 5200) }));
        s.queueSpawn(1200, () => spawnEnemy(s, W/2, -35, { hp:5, points:260, vy:50, pattern:P.sideWalls, patternDelay:1500 }));
      },
      // 13 — breather: drizzle line
      s => {
        for (let i = 0; i < 5; i++) s.queueSpawn(i * 450, () => {
          spawnEnemy(s, 70 + i*85, -30, { hp:3, points:180, vy:58, pattern:P.rain, patternDelay:1600 });
        });
      },
      // 14 — sweeping snakes cross the corridor
      s => {
        for (let i = 0; i < 3; i++) s.queueSpawn(i * 600, () => {
          spawnEnemy(s, -30, -20 - i*10, { hp:4, points:200, vy:42, pattern:P.snake, patternDelay:440, move: M.sweep(1, 95) });
          spawnEnemy(s, W+30, -20 - i*10, { hp:4, points:200, vy:42, pattern:P.snake, patternDelay:440, move: M.sweep(-1, 95) });
        });
      },
      // 15 — ring-gap elite anchor + zigzag chaff
      s => {
        s.queueSpawn(0, () => {
          spawnEnemy(s, W/2, -40, { texture:'nship_17', hp:10, points:600, vy:60, pattern:P.ringGap, patternDelay:1700, move: M.brake(150, 5000) });
        });
        for (let i = 0; i < 4; i++) s.queueSpawn(700 + i*450, () => {
          spawnEnemy(s, 90 + i*100, -30, { hp:3, points:180, vy:62, pattern:P.aimed1, patternDelay:1500, move: M.zigzag(70, 850) });
        });
      },
      // 16 — divers between X-cross flankers
      s => {
        s.queueSpawn(0,    () => spawnEnemy(s, 110,   -45, { texture:'ship_0015', hp:7, points:400, vy:36, pattern:P.xCross, patternDelay:1500 }));
        s.queueSpawn(500,  () => spawnEnemy(s, W-110, -45, { texture:'ship_0015', hp:7, points:400, vy:36, pattern:P.xCross, patternDelay:1500 }));
        for (let i = 0; i < 4; i++) s.queueSpawn(700 + i*480, () => {
          spawnEnemy(s, 80 + i*106, -30, { hp:3, points:180, vy:50, pattern:P.aimed1, patternDelay:1600, move: M.dive(1000) });
        });
      },
      // 17 — sweep-fan column
      s => {
        for (let i = 0; i < 5; i++) s.queueSpawn(i * 420, () => {
          spawnEnemy(s, Phaser.Math.Between(70, W-70), -30, { hp:4, points:200, vy:62, pattern:P.sweepFan, patternDelay:1350 });
        });
      },
      // 18 — breather: gentle aimed pairs
      s => {
        for (let i = 0; i < 3; i++) s.queueSpawn(i * 550, () => {
          spawnEnemy(s, 80,   -30, { hp:3, points:180, vx:28, vy:60, pattern:P.aimed1, patternDelay:1600 });
          spawnEnemy(s, W-80, -30, { hp:3, points:180, vx:-28, vy:60, pattern:P.aimed1, patternDelay:1600 });
        });
      },
      // 19 — snake elite duo
      s => {
        s.queueSpawn(0,   () => spawnEnemy(s, W*0.3, -40, { texture:'nship_17', hp:10, points:600, vy:58, pattern:P.snake,  patternDelay:400,  move: M.brake(130, 5200) }));
        s.queueSpawn(800, () => spawnEnemy(s, W*0.7, -40, { texture:'nship_23', hp:10, points:600, vy:58, pattern:P.flower, patternDelay:1050, move: M.brake(190, 5200) }));
      },
      // 20 — heavy shells + sweeping drizzle
      s => {
        for (let i = 0; i < 2; i++) s.queueSpawn(i * 700, () => {
          spawnEnemy(s, 120 + i*240, -45, { texture:'ship_0015', hp:8, points:450, vy:34, pattern:P.aimedBig, patternDelay:1300 });
        });
        for (let i = 0; i < 3; i++) s.queueSpawn(400 + i*500, () => {
          spawnEnemy(s, -30, -20, { hp:3, points:180, vy:44, pattern:P.rain, patternDelay:1500, move: M.sweep(1, 100) });
        });
      },
      // 21 — diver storm
      s => {
        for (let i = 0; i < 6; i++) s.queueSpawn(i * 420, () => {
          spawnEnemy(s, 70 + i*68, -30, { hp:3, points:180, vy:52, pattern:P.doubleTap, patternDelay:1500, move: M.dive(950) });
        });
      },
      // 22 — pre-boss: ring-gap + X-cross + chaff crescendo
      s => {
        s.queueSpawn(0, () => {
          spawnEnemy(s, W/2, -40, { texture:'nship_17', hp:11, points:650, vy:56, pattern:P.ringGap, patternDelay:1600, move: M.brake(140, 5500) });
        });
        s.queueSpawn(800, () => {
          spawnEnemy(s, W/2, -45, { texture:'ship_0015', hp:8, points:450, vy:40, pattern:P.xCross, patternDelay:1450 });
        });
        for (let i = 0; i < 4; i++) s.queueSpawn(1100 + i*380, () => {
          spawnEnemy(s, Phaser.Math.Between(60, W-60), -30, { hp:3, points:180, vy:85, pattern:P.aimed3, patternDelay:1300 });
        });
      },
    ],
    boss: s => spawnBoss(s, {
      texture: 'boss_train', scale: 2, flip: false, hitbox: 60, // industrial bunker fits VOID GATE
      overlay: { key: 'boss_train_head', dy: -13, scale: 1 }, // turret head plugs the base's open hole
      hp: 900, points: 16000,
      patterns: [P.radial12, P.doubleRadial, P.aimed3, P.crossAim],
      patternDelay: 950,
      move: 'aggressive'
    })
  },

  // LEVEL 4 — CORONA BREACH (toxic green)
  {
    title: 'CORONA BREACH',
    bg: { dim: 0.22, layers: [
      { key:'bg_seaice', anim:'bg_seaice_anim', scale:2, speed:32, loop:'clamp', depth:0 },
    ]},
    enemyTextures: ['ship_0019', 'ship_0020'],
    armoredTextures: ['eship_yellow', 'nship_15'], // yellow moth joins the ice stage
    enemyTint: 0x44ff00,      // lime green — corona breach
    armoredTint: 0x22cc00,
    bossTint: 0x88ff44,
    music: 'music_level1',
    waves: [
      // 1 — slow ring openers — player must weave through
      s => {
        for (let i = 0; i < 5; i++) s.queueSpawn(i * 380, () => {
          spawnEnemy(s, Phaser.Math.Between(60, W-60), -30, { hp:4, points:200, vy:60, pattern:P.slowRing, patternDelay:1400 });
        });
      },
      // 2 — pincer pairs
      s => {
        for (let i = 0; i < 5; i++) s.queueSpawn(i * 360, () => {
          spawnEnemy(s, 70,   -30, { hp:5, points:250, vx:35, vy:65, pattern:P.pincer, patternDelay:1100 });
          spawnEnemy(s, W-70, -30, { hp:5, points:250, vx:-35, vy:65, pattern:P.pincer, patternDelay:1100 });
        });
      },
      // 3 — curtain + aimed chaff
      s => {
        s.queueSpawn(0, () => {
          spawnEnemy(s, W/2, -40, { texture:'ship_0015', hp:10, points:500, vy:30, pattern:P.curtain, patternDelay:1600 });
        });
        for (let i = 0; i < 6; i++) s.queueSpawn(300 + i * 280, () => {
          spawnEnemy(s, Phaser.Math.Between(60, W-60), -30, { hp:4, points:200, vy:95, pattern:P.aimed3, patternDelay:950 });
        });
      },
      // 4 — dual-spiral heavies
      s => {
        for (let i = 0; i < 4; i++) s.queueSpawn(i * 550, () => {
          spawnEnemy(s, 80 + i*110, -40, { texture:'ship_0015', hp:10, points:500, vy:44, pattern:P.dualSpiral, patternDelay:220 });
        });
      },
      // 5 — aimed-7 swarm
      s => {
        for (let i = 0; i < 7; i++) s.queueSpawn(i * 240, () => {
          spawnEnemy(s, Phaser.Math.Between(60, W-60), -30, { hp:4, points:220, vy:100, pattern:P.aimed7, patternDelay:1050 });
        });
      },
      // 6 — slow rings + dual spiral wall
      s => {
        for (let i = 0; i < 5; i++) s.queueSpawn(i * 430, () => {
          spawnEnemy(s, 70 + i*90, -45, { texture:'ship_0015', hp:11, points:550, vy:38, pattern:P.slowRing, patternDelay:1200 });
        });
      },
      // 7 — curtain spam
      s => {
        for (let i = 0; i < 3; i++) s.queueSpawn(i * 900, () => {
          spawnEnemy(s, W*0.25, -40, { texture:'ship_0015', hp:9, points:450, vy:35, pattern:P.curtain, patternDelay:1500 });
          spawnEnemy(s, W*0.75, -40, { texture:'ship_0015', hp:9, points:450, vy:35, pattern:P.dualSpiral, patternDelay:240 });
        });
      },
      // 8 — pincer + slow ring mix
      s => {
        for (let i = 0; i < 8; i++) s.queueSpawn(i * 200, () => {
          spawnEnemy(s, Phaser.Math.Between(60, W-60), -30, { hp:4, points:200, vy:105, pattern:(i%2===0?P.pincer:P.slowRing), patternDelay:1100 });
        });
      },
      // 9 — aimed-7 + dual spiral finale
      s => {
        for (let i = 0; i < 6; i++) s.queueSpawn(i * 220, () => {
          spawnEnemy(s, Phaser.Math.Between(60, W-60), -30, { hp:5, points:250, vy:110, pattern:P.aimed7, patternDelay:950 });
        });
        for (let i = 0; i < 3; i++) s.queueSpawn(600 + i*500, () => {
          spawnEnemy(s, 100+i*140, -45, { texture:'ship_0015', hp:12, points:600, vy:38, pattern:P.dualSpiral, patternDelay:200 });
        });
      },
      // 10 — all together now
      s => {
        for (let i = 0; i < 8; i++) s.queueSpawn(i * 180, () => {
          spawnEnemy(s, Phaser.Math.Between(60, W-60), -30, { hp:5, points:250, vy:115, pattern:P.aimed7, patternDelay:900 });
        });
        for (let i = 0; i < 3; i++) s.queueSpawn(500 + i*550, () => {
          spawnEnemy(s, 90+i*150, -50, { texture:'ship_0015', hp:13, points:650, vy:36, pattern:P.curtain, patternDelay:1400 });
        });
        s.queueSpawn(2200, () => {
          spawnEnemy(s, W/2, -50, { texture:'ship_0015', hp:14, points:700, vy:30, pattern:P.slowRing, patternDelay:1100 });
        });
      },
      // NEW — zigzag double-tap squad
      s => {
        for (let i = 0; i < 5; i++) s.queueSpawn(i * 380, () => {
          spawnEnemy(s, 80 + i*80, -30, { hp:4, points:220, vy:70, pattern:P.doubleTap, patternDelay:1300, move: M.zigzag(85, 800) });
        });
      },
      // NEW — elite flower anchor + arc-rain escorts
      s => {
        s.queueSpawn(0, () => {
          spawnEnemy(s, W/2, -40, { texture:'nship_25', hp:12, points:700, vy:60, pattern:P.flower, patternDelay:850, move: M.brake(150, 5000) });
        });
        for (let i = 0; i < 4; i++) s.queueSpawn(500 + i*420, () => {
          spawnEnemy(s, 80 + i*105, -30, { hp:4, points:220, vy:66, pattern:P.arcRain, patternDelay:1400 });
        });
      },
      // NEW — side-wall bombers force lane changes
      s => {
        for (let i = 0; i < 4; i++) s.queueSpawn(i * 600, () => {
          spawnEnemy(s, Phaser.Math.Between(110, W-110), -35, { hp:5, points:280, vy:54, pattern:P.sideWalls, patternDelay:1300 });
        });
      },
      // NEW — heavy shell wall + weaving chaff
      s => {
        for (let i = 0; i < 3; i++) s.queueSpawn(i * 550, () => {
          spawnEnemy(s, 100 + i*140, -40, { texture:'ship_0015', hp:9, points:500, vy:38, pattern:P.aimedBig, patternDelay:1200 });
        });
        for (let i = 0; i < 4; i++) s.queueSpawn(400 + i*350, () => {
          spawnEnemy(s, Phaser.Math.Between(70, W-70), -30, { hp:4, points:220, vy:78, pattern:P.aimed3, patternDelay:1300, move: M.zigzag(60, 750) });
        });
      },
      // NEW — pre-boss: twin elites + ring heavies
      s => {
        s.queueSpawn(0,   () => spawnEnemy(s, W*0.28, -40, { texture:'nship_25', hp:13, points:750, vy:58, pattern:P.flower,   patternDelay:850, move: M.brake(130, 5500) }));
        s.queueSpawn(600, () => spawnEnemy(s, W*0.72, -40, { texture:'nship_25', hp:13, points:750, vy:58, pattern:P.sideWalls, patternDelay:1250, move: M.brake(185, 5500) }));
        for (let i = 0; i < 2; i++) s.queueSpawn(1100 + i*650, () => {
          spawnEnemy(s, 150 + i*180, -45, { texture:'ship_0015', hp:9, points:500, vy:40, pattern:P.slowRing, patternDelay:1300 });
        });
      },
      // NEW — snake sweepers, three ranks
      s => {
        for (let i = 0; i < 3; i++) s.queueSpawn(i * 550, () => {
          spawnEnemy(s, -30, -20 - i*12, { hp:4, points:220, vy:46, pattern:P.snake, patternDelay:400, move: M.sweep(1, 105) });
          spawnEnemy(s, W+30, -20 - i*12, { hp:4, points:220, vy:46, pattern:P.snake, patternDelay:400, move: M.sweep(-1, 105) });
        });
      },
      // NEW — breather: drizzle + zigzag
      s => {
        for (let i = 0; i < 5; i++) s.queueSpawn(i * 400, () => {
          spawnEnemy(s, 80 + i*80, -30, { hp:3, points:200, vy:60, pattern:P.rain, patternDelay:1500, move: M.zigzag(80, 850) });
        });
      },
      // NEW — ring-gap elite + diver escorts
      s => {
        s.queueSpawn(0, () => {
          spawnEnemy(s, W/2, -40, { texture:'nship_25', hp:13, points:750, vy:60, pattern:P.ringGap, patternDelay:1500, move: M.brake(150, 5200) });
        });
        for (let i = 0; i < 5; i++) s.queueSpawn(600 + i*420, () => {
          spawnEnemy(s, 80 + i*80, -30, { hp:4, points:220, vy:52, pattern:P.aimed3, patternDelay:1400, move: M.dive(950) });
        });
      },
      // NEW — X-cross wall + sweep-fan chaff
      s => {
        for (let i = 0; i < 3; i++) s.queueSpawn(i * 550, () => {
          spawnEnemy(s, 100 + i*140, -45, { texture:'ship_0015', hp:9, points:500, vy:38, pattern:P.xCross, patternDelay:1350 });
        });
        for (let i = 0; i < 4; i++) s.queueSpawn(300 + i*420, () => {
          spawnEnemy(s, Phaser.Math.Between(70, W-70), -30, { hp:4, points:220, vy:68, pattern:P.sweepFan, patternDelay:1250 });
        });
      },
      // NEW — diver squadron with heavy anchor
      s => {
        for (let i = 0; i < 6; i++) s.queueSpawn(i * 380, () => {
          spawnEnemy(s, 70 + i*68, -30, { hp:4, points:220, vy:54, pattern:P.doubleTap, patternDelay:1350, move: M.dive(900) });
        });
        s.queueSpawn(1400, () => {
          spawnEnemy(s, W/2, -45, { texture:'ship_0015', hp:10, points:550, vy:34, pattern:P.aimedBig, patternDelay:1150 });
        });
      },
      // NEW — breather: aimed pairs drifting
      s => {
        for (let i = 0; i < 3; i++) s.queueSpawn(i * 550, () => {
          spawnEnemy(s, 80,   -30, { hp:3, points:200, vx:30, vy:62, pattern:P.aimed1, patternDelay:1500 });
          spawnEnemy(s, W-80, -30, { hp:3, points:200, vx:-30, vy:62, pattern:P.aimed1, patternDelay:1500 });
        });
      },
      // NEW — snake + flower elite pair, staggered
      s => {
        s.queueSpawn(0,   () => spawnEnemy(s, W*0.3, -40, { texture:'nship_23', hp:13, points:750, vy:58, pattern:P.snake,  patternDelay:380, move: M.brake(130, 5400) }));
        s.queueSpawn(800, () => spawnEnemy(s, W*0.7, -40, { texture:'nship_25', hp:13, points:750, vy:58, pattern:P.flower, patternDelay:900, move: M.brake(195, 5400) }));
        for (let i = 0; i < 3; i++) s.queueSpawn(1300 + i*420, () => {
          spawnEnemy(s, Phaser.Math.Between(70, W-70), -30, { hp:4, points:220, vy:74, pattern:P.rain, patternDelay:1350 });
        });
      },
      // NEW — sweeping fans converge + ring heavies
      s => {
        for (let i = 0; i < 2; i++) s.queueSpawn(i * 650, () => {
          spawnEnemy(s, -30, -20, { hp:4, points:220, vy:46, pattern:P.sweepFan, patternDelay:1250, move: M.sweep(1, 110) });
          spawnEnemy(s, W+30, -30, { hp:4, points:220, vy:46, pattern:P.sweepFan, patternDelay:1250, move: M.sweep(-1, 110) });
        });
        s.queueSpawn(1200, () => {
          spawnEnemy(s, W/2, -45, { texture:'ship_0015', hp:10, points:550, vy:36, pattern:P.slowRing, patternDelay:1250 });
        });
      },
      // NEW — X-cross + ring-gap chess match
      s => {
        s.queueSpawn(0,   () => spawnEnemy(s, W*0.35, -40, { texture:'nship_25', hp:13, points:750, vy:56, pattern:P.ringGap, patternDelay:1500, move: M.brake(140, 5200) }));
        s.queueSpawn(700, () => spawnEnemy(s, W*0.65, -45, { texture:'ship_0015', hp:10, points:550, vy:36, pattern:P.xCross, patternDelay:1300 }));
        for (let i = 0; i < 3; i++) s.queueSpawn(1100 + i*400, () => {
          spawnEnemy(s, Phaser.Math.Between(70, W-70), -30, { hp:4, points:220, vy:78, pattern:P.aimed3, patternDelay:1300 });
        });
      },
      // NEW — pre-boss surge: divers + snakes + shells
      s => {
        for (let i = 0; i < 5; i++) s.queueSpawn(i * 360, () => {
          spawnEnemy(s, 75 + i*82, -30, { hp:4, points:220, vy:56, pattern:P.aimed3, patternDelay:1300, move: M.dive(1000) });
        });
        s.queueSpawn(900,  () => spawnEnemy(s, -30, -20, { hp:5, points:240, vy:44, pattern:P.snake, patternDelay:390, move: M.sweep(1, 100) }));
        s.queueSpawn(1200, () => spawnEnemy(s, W+30, -30, { hp:5, points:240, vy:44, pattern:P.snake, patternDelay:390, move: M.sweep(-1, 100) }));
        s.queueSpawn(1700, () => spawnEnemy(s, W/2, -45, { texture:'ship_0015', hp:11, points:600, vy:34, pattern:P.aimedBig, patternDelay:1100 }));
      },
    ],
    boss: s => spawnBoss(s, {
      texture: 'boss_sub', anim: 'boss_sub_anim', scale: 0.75, flip: false, hitbox: 75,
      hp: 1300, points: 22000,
      patterns: [P.dualSpiral, P.slowRing, P.aimed7, P.curtain],
      patternDelay: 700,
      move: 'figure8'
    })
  },

  // LEVEL 5 — APEX (inferno gold — final stage)
  {
    title: 'APEX',
    // All three Nucleo layers share the same length and scroll in sync (per the pack's LEEME note)
    bg: { dim: 0.3, layers: [
      { key:'bg_nucleo0', scale:2, speed:34, loop:'clamp', depth:0 },
      { key:'bg_nucleo1', scale:2, speed:34, loop:'clamp', depth:0.5 },
      { key:'bg_nucleo2', anim:'bg_nucleo2_anim', scale:2, speed:34, loop:'clamp', depth:1 },
    ]},
    enemyTextures: ['ship_0020', 'ship_0021'],
    armoredTextures: ['nship_22', 'nship_24'],
    bossTexture: 'nship_21',
    enemyTint: 0xffee00,      // pure gold — apex
    armoredTint: 0xffbb00,
    bossTint: 0xffdd44,
    music: 'music_level2',
    waves: [
      // 1 — dense aimed-7 opener
      s => {
        for (let i = 0; i < 9; i++) s.queueSpawn(i * 180, () => {
          spawnEnemy(s, Phaser.Math.Between(60, W-60), -30, { hp:5, points:280, vy:110, pattern:P.aimed7, patternDelay:950 });
        });
      },
      // 2 — curtain wall from sides
      s => {
        for (let i = 0; i < 5; i++) s.queueSpawn(i * 350, () => {
          spawnEnemy(s, 70,   -30, { hp:6, points:300, vx:40, vy:70, pattern:P.curtain, patternDelay:1300 });
          spawnEnemy(s, W-70, -30, { hp:6, points:300, vx:-40, vy:70, pattern:P.dualSpiral, patternDelay:230 });
        });
      },
      // 3 — slow ring maze
      s => {
        for (let i = 0; i < 7; i++) s.queueSpawn(i * 320, () => {
          spawnEnemy(s, Phaser.Math.Between(60, W-60), -30, { hp:5, points:260, vy:70, pattern:P.slowRing, patternDelay:1100 });
        });
      },
      // 4 — dual-spiral wall
      s => {
        for (let i = 0; i < 5; i++) s.queueSpawn(i * 480, () => {
          spawnEnemy(s, 70 + i*90, -45, { texture:'ship_0015', hp:14, points:700, vy:42, pattern:P.dualSpiral, patternDelay:185 });
        });
      },
      // 5 — pincer + aimed-7 + curtain chaos
      s => {
        for (let i = 0; i < 6; i++) s.queueSpawn(i * 250, () => {
          spawnEnemy(s, Phaser.Math.Between(60, W-60), -30, { hp:5, points:280, vy:105, pattern:P.pincer, patternDelay:950 });
        });
        for (let i = 0; i < 3; i++) s.queueSpawn(800 + i*500, () => {
          spawnEnemy(s, 90+i*150, -45, { texture:'ship_0015', hp:14, points:700, vy:38, pattern:P.curtain, patternDelay:1300 });
        });
      },
      // 6 — double radial + aimed-7 blitz
      s => {
        for (let i = 0; i < 8; i++) s.queueSpawn(i * 200, () => {
          spawnEnemy(s, Phaser.Math.Between(60, W-60), -30, { hp:5, points:280, vy:115, pattern:P.aimed7, patternDelay:900 });
        });
        for (let i = 0; i < 4; i++) s.queueSpawn(500 + i*480, () => {
          spawnEnemy(s, 70+i*115, -45, { texture:'ship_0015', hp:12, points:600, vy:40, pattern:P.doubleRadial, patternDelay:850 });
        });
      },
      // 7 — slow ring + curtain from all angles
      s => {
        for (let i = 0; i < 6; i++) s.queueSpawn(i * 350, () => {
          spawnEnemy(s, 60+i*75, -45, { texture:'ship_0015', hp:13, points:650, vy:36, pattern:P.slowRing, patternDelay:1000 });
        });
        for (let i = 0; i < 4; i++) s.queueSpawn(200+i*600, () => {
          spawnEnemy(s, Phaser.Math.Between(60, W-60), -30, { hp:5, points:260, vy:120, pattern:P.aimed7, patternDelay:850 });
        });
      },
      // 8 — mini-boss squad: three heavies simultaneously
      s => {
        s.queueSpawn(0, () => spawnEnemy(s, W*0.2, -50, { texture:'ship_0015', hp:18, points:900, vy:32, pattern:P.dualSpiral, patternDelay:180 }));
        s.queueSpawn(0, () => spawnEnemy(s, W*0.5, -50, { texture:'ship_0015', hp:18, points:900, vy:32, pattern:P.slowRing, patternDelay:1000 }));
        s.queueSpawn(0, () => spawnEnemy(s, W*0.8, -50, { texture:'ship_0015', hp:18, points:900, vy:32, pattern:P.dualSpiral, patternDelay:180 }));
      },
      // 9 — curtain + pincer hell
      s => {
        for (let i = 0; i < 5; i++) s.queueSpawn(i * 280, () => {
          spawnEnemy(s, 70,   -30, { hp:6, points:300, vx:40, vy:75, pattern:P.pincer, patternDelay:900 });
          spawnEnemy(s, W-70, -30, { hp:6, points:300, vx:-40, vy:75, pattern:P.curtain, patternDelay:1200 });
        });
        for (let i = 0; i < 5; i++) s.queueSpawn(400+i*240, () => {
          spawnEnemy(s, Phaser.Math.Between(60, W-60), -30, { hp:5, points:280, vy:115, pattern:P.aimed7, patternDelay:880 });
        });
      },
      // 10 — FINAL HELL: everything
      s => {
        for (let i = 0; i < 10; i++) s.queueSpawn(i * 150, () => {
          spawnEnemy(s, Phaser.Math.Between(60, W-60), -30, { hp:5, points:280, vy:120, pattern:P.aimed7, patternDelay:850 });
        });
        for (let i = 0; i < 4; i++) s.queueSpawn(400+i*500, () => {
          spawnEnemy(s, 70+i*115, -50, { texture:'ship_0015', hp:15, points:750, vy:35, pattern:P.dualSpiral, patternDelay:175 });
        });
        for (let i = 0; i < 3; i++) s.queueSpawn(1000+i*700, () => {
          spawnEnemy(s, 90+i*150, -50, { texture:'ship_0015', hp:14, points:700, vy:32, pattern:P.slowRing, patternDelay:950 });
        });
      },
      // NEW — veteran elites return: flower + double-tap pincer
      s => {
        s.queueSpawn(0,   () => spawnEnemy(s, W*0.25, -40, { texture:'nship_16', hp:13, points:750, vy:62, pattern:P.flower,    patternDelay:800, move: M.brake(140, 5000) }));
        s.queueSpawn(400, () => spawnEnemy(s, W*0.75, -40, { texture:'nship_19', hp:13, points:750, vy:62, pattern:P.doubleTap, patternDelay:1000, move: M.brake(160, 5000) }));
        for (let i = 0; i < 4; i++) s.queueSpawn(800 + i*300, () => {
          spawnEnemy(s, Phaser.Math.Between(70, W-70), -30, { hp:4, points:240, vy:85, pattern:P.aimed3, patternDelay:1200 });
        });
      },
      // NEW — arc-rain curtain across the whole width
      s => {
        for (let i = 0; i < 6; i++) s.queueSpawn(i * 320, () => {
          spawnEnemy(s, 60 + i*72, -30, { hp:4, points:240, vy:64, pattern:P.arcRain, patternDelay:1250 });
        });
      },
      // NEW — heavy shells + side-wall bombers together
      s => {
        for (let i = 0; i < 2; i++) s.queueSpawn(i * 600, () => {
          spawnEnemy(s, 110 + i*260, -40, { texture:'ship_0015', hp:11, points:600, vy:36, pattern:P.aimedBig, patternDelay:1100 });
        });
        for (let i = 0; i < 3; i++) s.queueSpawn(400 + i*550, () => {
          spawnEnemy(s, Phaser.Math.Between(110, W-110), -35, { hp:5, points:300, vy:56, pattern:P.sideWalls, patternDelay:1200 });
        });
      },
      // NEW — zigzag storm
      s => {
        for (let i = 0; i < 7; i++) s.queueSpawn(i * 280, () => {
          spawnEnemy(s, 70 + i*56, -30, { hp:4, points:240, vy:80, pattern:P.doubleTap, patternDelay:1150, move: M.zigzag(90, 700) });
        });
      },
      // NEW — final gauntlet: elite trio staggered
      s => {
        s.queueSpawn(0,    () => spawnEnemy(s, W*0.5,  -40, { texture:'nship_19', hp:14, points:800, vy:58, pattern:P.flower,    patternDelay:800,  move: M.brake(120, 6000) }));
        s.queueSpawn(700,  () => spawnEnemy(s, W*0.25, -40, { texture:'nship_16', hp:14, points:800, vy:58, pattern:P.sideWalls, patternDelay:1150, move: M.brake(170, 6000) }));
        s.queueSpawn(1400, () => spawnEnemy(s, W*0.75, -40, { texture:'nship_16', hp:14, points:800, vy:58, pattern:P.doubleTap, patternDelay:950,  move: M.brake(210, 6000) }));
      },
      // NEW — snake sweeper matrix
      s => {
        for (let i = 0; i < 4; i++) s.queueSpawn(i * 480, () => {
          spawnEnemy(s, -30, -20 - i*10, { hp:5, points:260, vy:48, pattern:P.snake, patternDelay:360, move: M.sweep(1, 115) });
          spawnEnemy(s, W+30, -20 - i*10, { hp:5, points:260, vy:48, pattern:P.snake, patternDelay:360, move: M.sweep(-1, 115) });
        });
      },
      // NEW — breather: drizzle field
      s => {
        for (let i = 0; i < 6; i++) s.queueSpawn(i * 350, () => {
          spawnEnemy(s, 60 + i*72, -30, { hp:4, points:240, vy:64, pattern:P.rain, patternDelay:1300, move: M.zigzag(70, 800) });
        });
      },
      // NEW — twin ring-gap veterans
      s => {
        s.queueSpawn(0,   () => spawnEnemy(s, W*0.3, -40, { texture:'nship_6',  hp:15, points:850, vy:58, pattern:P.ringGap, patternDelay:1400, move: M.brake(130, 5600) }));
        s.queueSpawn(700, () => spawnEnemy(s, W*0.7, -40, { texture:'nship_17', hp:15, points:850, vy:58, pattern:P.ringGap, patternDelay:1400, move: M.brake(200, 5600) }));
        for (let i = 0; i < 4; i++) s.queueSpawn(1100 + i*360, () => {
          spawnEnemy(s, Phaser.Math.Between(70, W-70), -30, { hp:4, points:240, vy:80, pattern:P.aimed3, patternDelay:1200 });
        });
      },
      // NEW — X-cross heavy wall + sweep-fan rain
      s => {
        for (let i = 0; i < 3; i++) s.queueSpawn(i * 500, () => {
          spawnEnemy(s, 100 + i*140, -45, { texture:'ship_0015', hp:11, points:600, vy:38, pattern:P.xCross, patternDelay:1200 });
        });
        for (let i = 0; i < 5; i++) s.queueSpawn(300 + i*380, () => {
          spawnEnemy(s, Phaser.Math.Between(60, W-60), -30, { hp:4, points:240, vy:72, pattern:P.sweepFan, patternDelay:1150 });
        });
      },
      // NEW — dive blitz
      s => {
        for (let i = 0; i < 7; i++) s.queueSpawn(i * 340, () => {
          spawnEnemy(s, 65 + i*58, -30, { hp:4, points:240, vy:58, pattern:P.doubleTap, patternDelay:1250, move: M.dive(850) });
        });
      },
      // NEW — breather: drifting pairs
      s => {
        for (let i = 0; i < 3; i++) s.queueSpawn(i * 500, () => {
          spawnEnemy(s, 80,   -30, { hp:4, points:240, vx:32, vy:64, pattern:P.aimed1, patternDelay:1400 });
          spawnEnemy(s, W-80, -30, { hp:4, points:240, vx:-32, vy:64, pattern:P.aimed1, patternDelay:1400 });
        });
      },
      // NEW — snake elite + X-cross flankers
      s => {
        s.queueSpawn(0, () => {
          spawnEnemy(s, W/2, -40, { texture:'nship_9', hp:16, points:900, vy:56, pattern:P.snake, patternDelay:340, move: M.brake(140, 5600) });
        });
        s.queueSpawn(700,  () => spawnEnemy(s, 110,   -45, { texture:'ship_0015', hp:11, points:600, vy:36, pattern:P.xCross, patternDelay:1200 }));
        s.queueSpawn(1100, () => spawnEnemy(s, W-110, -45, { texture:'ship_0015', hp:11, points:600, vy:36, pattern:P.xCross, patternDelay:1200 }));
      },
      // NEW — everything sweeps: fans + snakes + drizzle
      s => {
        for (let i = 0; i < 2; i++) s.queueSpawn(i * 600, () => {
          spawnEnemy(s, -30, -20, { hp:5, points:260, vy:48, pattern:P.sweepFan, patternDelay:1100, move: M.sweep(1, 120) });
          spawnEnemy(s, W+30, -30, { hp:5, points:260, vy:48, pattern:P.snake, patternDelay:360, move: M.sweep(-1, 120) });
        });
        for (let i = 0; i < 4; i++) s.queueSpawn(400 + i*360, () => {
          spawnEnemy(s, Phaser.Math.Between(60, W-60), -30, { hp:4, points:240, vy:84, pattern:P.rain, patternDelay:1200 });
        });
      },
      // NEW — heavy artillery line + ring-gap centre
      s => {
        s.queueSpawn(0, () => {
          spawnEnemy(s, W/2, -40, { texture:'nship_21', hp:16, points:900, vy:54, pattern:P.ringGap, patternDelay:1350, move: M.brake(150, 5600) });
        });
        for (let i = 0; i < 3; i++) s.queueSpawn(600 + i*550, () => {
          spawnEnemy(s, 90 + i*150, -45, { texture:'ship_0015', hp:12, points:650, vy:34, pattern:P.aimedBig, patternDelay:1000 });
        });
      },
      // NEW — final gauntlet II: veteran trio + dive swarm
      s => {
        s.queueSpawn(0,    () => spawnEnemy(s, W*0.5,  -40, { texture:'nship_6',  hp:17, points:950, vy:54, pattern:P.snake,   patternDelay:340,  move: M.brake(120, 6000) }));
        s.queueSpawn(800,  () => spawnEnemy(s, W*0.25, -40, { texture:'nship_17', hp:17, points:950, vy:54, pattern:P.ringGap, patternDelay:1300, move: M.brake(175, 6000) }));
        s.queueSpawn(1600, () => spawnEnemy(s, W*0.75, -40, { texture:'nship_9',  hp:17, points:950, vy:54, pattern:P.flower,  patternDelay:800,  move: M.brake(215, 6000) }));
        for (let i = 0; i < 5; i++) s.queueSpawn(2000 + i*320, () => {
          spawnEnemy(s, 70 + i*85, -30, { hp:4, points:240, vy:60, pattern:P.aimed3, patternDelay:1200, move: M.dive(900) });
        });
      },
    ],
    boss: s => spawnBoss(s, {
      hp: 1800, points: 30000,
      patterns: [P.dualSpiral, P.slowRing, P.aimed7, P.curtain, P.doubleRadial, P.crossAim],
      patternDelay: 600,
      move: 'aggressive'
    })
  }
];

// ─── Boss spawner ─────────────────────────────────────────────────────────────
function spawnBoss(scene, cfg) {
  const bossTex = cfg.texture || scene.levelBossTexture || 'ship_0022';
  const big = isNship(bossTex);
  const scale = cfg.scale || (big ? 0.95 : 3.2); // 32px art needs 3.2x; 128px art 0.95
  const boss = scene.enemies.create(W/2, -80, bossTex);
  boss.setDepth(7).setScale(scale);
  // Old/nship art faces up and needs flipping; stage-kit bosses are drawn facing the player
  boss.setFlipY(cfg.flip !== undefined ? cfg.flip : true);
  if (cfg.anim) boss.play(cfg.anim);
  const bossTint = (big || cfg.anim || cfg.flip === false) ? null : ENEMY_TINT[bossTex];
  if (bossTint) boss.setTint(bossTint);
  boss.hp      = cfg.hp;
  boss.maxHp   = cfg.hp;
  boss.points  = cfg.points;
  boss.explodeSize = 'large';
  boss.isBoss  = true;
  boss.invulnerable = true; // immune during entry
  boss.body.allowGravity = false;
  // setSize params are in SOURCE (unscaled) pixels — Phaser multiplies by scaleX internally.
  const hb = (cfg.hitbox || 50) / scale;
  boss.body.setSize(hb, hb, true);
  // Optional overlay parts that track the boss — for multi-part boss kits
  // (train bunker's turret head, the moth carrier's left/right gun pods, …)
  const overlayCfgs = cfg.overlays || (cfg.overlay ? [cfg.overlay] : []);
  if (overlayCfgs.length) {
    boss._parts = overlayCfgs.map(o => {
      const ov = scene.add.image(boss.x, boss.y, o.key).setDepth(8).setScale(scale * (o.scale || 1));
      ov.setFlipY(boss.flipY);
      ov._dx = (o.dx || 0) * scale;
      ov._dy = (o.dy || 0) * scale;
      return ov;
    });
  }

  // Size-aware entry: start fully above the screen, end with the boss ~35% of
  // its own height into view over the fixed 2.6s entry window
  const bh = boss.displayHeight;
  boss.y = -(bh / 2) - 20;
  boss.setVelocityY(((bh * 0.85) + 40) / 2.6);

  // Stop dropping and start pattern after entering screen
  scene.time.delayedCall(2600, () => {
    if (!boss.active) return;
    boss.setVelocityY(0);
    boss.invulnerable = false;
    scene.bossActive = true;
    scene.showBossHUD(boss);
    playMusic(scene, 'music_boss', 0.65);
    startBossMove(scene, boss, cfg.move);

    let pi = 0;
    scene.time.addEvent({
      delay: cfg.patternDelay,
      loop: true,
      callback: () => {
        if (!boss.active) return;
        cfg.patterns[pi % cfg.patterns.length](scene, boss);
        pi++;
      }
    });
    // Aimed burst every 1.8s
    scene.time.addEvent({
      delay: 1800, loop: true,
      callback: () => { if (boss.active) P.aimed3(scene, boss); }
    });
  });

  return boss;
}

function startBossMove(scene, boss, style) {
  if (style === 'sine') {
    // Slide to left edge first, then begin full-width sweep
    scene.tweens.add({ targets: boss, x: 80, duration: 450, ease: 'Sine.easeInOut', onComplete: () => {
      scene.tweens.add({ targets: boss, x: W-80, duration: 2200, ease:'Sine.easeInOut', yoyo:true, repeat:-1 });
    }});
  } else if (style === 'figure8') {
    scene.tweens.add({ targets: boss, x: 80, duration: 450, ease: 'Sine.easeInOut', onComplete: () => {
      scene.tweens.add({ targets: boss, x: W-80, y: 140, duration: 2000, ease:'Sine.easeInOut', yoyo:true, repeat:-1 });
    }});
    scene.time.delayedCall(1000, () => {
      scene.tweens.add({ targets: boss, y: 220, duration: 1800, ease:'Sine.easeInOut', yoyo:true, repeat:-1 });
    });
  } else if (style === 'aggressive') {
    const charge = () => {
      if (!boss.active) return;
      if (scene.player && scene.player.active) {
        scene.tweens.add({
          targets: boss, x: scene.player.x,
          duration: 800, ease: 'Power2',
          onComplete: () => {
            scene.tweens.add({ targets: boss, x: W/2, duration: 600, ease:'Bounce.easeOut', onComplete: charge });
          }
        });
      } else { scene.time.delayedCall(1000, charge); }
    };
    scene.time.delayedCall(500, charge);
  } else if (style === 'roam') {
    // Random waypoint roaming; at < 50% HP intervals shorten and player charges appear
    const nextWaypoint = () => {
      if (!boss.active) return;
      const enraged = boss.hp != null && boss.maxHp != null && boss.hp / boss.maxHp < 0.5;
      const tx = Phaser.Math.Between(70, W - 70);
      const ty = Phaser.Math.Between(60, 200);
      const dur = enraged ? Phaser.Math.Between(600, 1100) : Phaser.Math.Between(900, 1700);
      scene.tweens.add({
        targets: boss, x: tx, y: ty, duration: dur, ease: enraged ? 'Power2' : 'Sine.easeInOut',
        onComplete: () => scene.time.delayedCall(Phaser.Math.Between(150, 500), nextWaypoint)
      });
      if (enraged && scene.player && scene.player.active && Math.random() < 0.35) {
        scene.time.delayedCall(80, () => {
          if (!boss.active) return;
          // Only kill move tweens, preserve any flash tween
          if (boss._moveTween) { boss._moveTween.stop(); boss._moveTween = null; }
          boss._moveTween = scene.tweens.add({ targets: boss, x: scene.player.x, duration: 380, ease: 'Power3',
            onComplete: () => { boss._moveTween = null; nextWaypoint(); } });
        });
      }
    };
    scene.tweens.add({ targets: boss, x: Phaser.Math.Between(80, W-80), duration: 550, ease: 'Sine.easeInOut',
      onComplete: nextWaypoint });
  }
}

// ─── Scrolling stage backgrounds ──────────────────────────────────────────────
// Each level defines bg.layers: tall artwork scrolled bottom→top over the level.
// loop:'wrap' leapfrogs two copies forever; loop:'clamp' holds at the artwork's end.
function makeScrollLayer(scene, cfg) {
  const scale = cfg.scale || 1;
  const srcFrame = scene.textures.get(cfg.key).get(0);
  const h = srcFrame.height * scale;
  const mkSprite = () => {
    const s = scene.add.sprite(W / 2, 0, cfg.key, 0)
      .setOrigin(0.5, 0).setScale(scale)
      .setDepth(cfg.depth || 0).setAlpha(cfg.alpha != null ? cfg.alpha : 1);
    if (cfg.anim) s.play(cfg.anim);
    return s;
  };
  const a = mkSprite();
  a.y = H - h; // artwork bottom = level start
  let b = null;
  if (cfg.loop === 'wrap') { b = mkSprite(); b.y = a.y - h; }
  return { a, b, h, speed: cfg.speed || 20, loop: cfg.loop || 'clamp' };
}

function updateScrollLayers(scene, delta) {
  const dt = delta / 1000;
  for (const L of scene.bgLayers) {
    if (L.loop === 'wrap') {
      L.a.y += L.speed * dt;
      L.b.y += L.speed * dt;
      if (L.a.y >= H) L.a.y = L.b.y - L.h;
      if (L.b.y >= H) L.b.y = L.a.y - L.h;
    } else {
      L.a.y = Math.min(L.a.y + L.speed * dt, 0);
    }
  }
}

// ─── Power-up types ───────────────────────────────────────────────────────────
const POWERUP_TYPES       = ['power', 'power', 'power', 'power', 'bomb'];
const POWERUP_TYPES_HEAVY = ['power', 'power', 'power', 'bomb',  'power', 'life'];
// Per-level drop budget — early stages are lean (no bombs at all in stage 1),
// later stages keep the full economy that the harder waves are tuned around
function puBudget(level) {
  if (level === 1) return { power: 4, bomb: 0, life: 0 };
  if (level === 2) return { power: 6, bomb: 2, life: 1 };
  return { power: 8, bomb: 3, life: 1 };
}

// Drops appear where the enemy died and tumble down from there
function spawnPowerup(scene, x, y, heavy = false) {
  const d = scene.puDropped;
  const budget = puBudget(State.level);
  // Pace drops across the whole level instead of the kill-rush at the start:
  // ration the total budget by how far into the level's waves we've gotten,
  // so a fast early clear can't blow through the whole budget in 10 seconds.
  if (d) {
    const totalBudget = budget.power + budget.bomb + budget.life;
    const totalDropped = (d.power || 0) + (d.bomb || 0) + (d.life || 0);
    const totalWaves = (scene.levelDef && scene.levelDef.waves.length) || 1;
    const progress = Math.min(1, (scene.waveIdx || 0) / totalWaves);
    const allowedSoFar = Math.ceil(totalBudget * progress);
    if (totalDropped >= allowedSoFar) return null; // ahead of schedule — wait for more level progress
  }

  const pool = heavy ? POWERUP_TYPES_HEAVY : POWERUP_TYPES;
  let type = Phaser.Utils.Array.GetRandom(pool);
  // Enforce budget: if this type is capped, try alternatives in priority order
  if (d) {
    const order = ['power', 'bomb', 'life'];
    if ((d[type] || 0) >= budget[type]) {
      type = order.find(t => (d[t] || 0) < budget[t]);
      if (!type) return null; // all budgets exhausted — no drop
    }
    d[type] = (d[type] || 0) + 1;
  }
  // Spinning gems: yellow = power, pink = life, cyan = bomb
  const key = type === 'life' ? 'gem_life' : type === 'bomb' ? 'gem_bomb' : 'gem_power';
  const spawnX = x !== undefined ? Phaser.Math.Clamp(x, 24, W - 24) : Phaser.Math.Between(24, W - 24);
  const spawnY = y !== undefined ? Math.max(y, -16) : -16;
  const pu = scene.powerups.create(spawnX, spawnY, key);
  pu.setDepth(9).setScale(2);
  pu.play(key + '_anim');
  pu.puType = type;
  pu.body.allowGravity = false;
  pu.setVelocityY(38);
  // Gentle bob layered on top of the slow drift
  scene.tweens.add({ targets: pu, x: spawnX + Phaser.Math.Between(-12, 12), duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  return pu;
}

// ─── Gamepad menu navigation ─────────────────────────────────────────────────
// Edge-triggered with hold-repeat: fires once when a button/direction is first
// pressed, then (optionally) repeats while held. Much less twitchy than a plain
// cooldown, and a button still held from the previous screen never auto-fires.
function padNavStep(store, key, isDown, delta, holdDelay = 450, repeatRate = 0) {
  const s = store[key] || (store[key] = { t: -1 });
  if (!isDown) { s.t = -1; return false; }
  if (s.t < 0) { s.t = 0; return true; } // rising edge
  s.t += delta;
  if (repeatRate > 0 && s.t >= holdDelay) { s.t = holdDelay - repeatRate; return true; }
  return false;
}

// ─── Menu UI helpers ──────────────────────────────────────────────────────────
// Shared animated backdrop for Title / Ship Select — the gorgeous Space Stage 1
// art slowly drifting, darkened with a vignette so foreground UI stays readable.
function addMenuBackground(scene) {
  scene.bgLayers = [];
  scene.bgLayers.push(makeScrollLayer(scene, { key:'bg_space1', anim:'bg_space1_anim', scale:1.25, speed:18, loop:'wrap', depth:0 }));
  scene.add.rectangle(0, 0, W, H, 0x05010f, 0.55).setOrigin(0, 0).setDepth(1);
  scene.menuStars = scene.add.tileSprite(0, 0, W, H, 'stars3').setOrigin(0, 0).setDepth(2).setAlpha(0.5);
}

function updateMenuBackground(scene, delta) {
  updateScrollLayers(scene, delta);
  if (scene.menuStars) scene.menuStars.tilePositionY -= 1.2;
}

// Layered glowing "Easing" wordmark inside a container so it can be pulsed/scaled.
// Split point: gold "E" + white "asing", joined at the container origin.
function drawLogo(scene, cx, cy) {
  const cont = scene.add.container(cx, cy).setDepth(6);
  const f = 'bold 76px monospace';
  const parts = [
    // drop shadow
    scene.add.text(3, 5, 'E',     { font:f, fill:'#000000' }).setOrigin(1, 0.5).setAlpha(0.5),
    scene.add.text(3, 5, 'asing', { font:f, fill:'#000000' }).setOrigin(0, 0.5).setAlpha(0.5),
    // cyan bloom
    scene.add.text(0, 0, 'E',     { font:f, fill:'#ffcc00', stroke:'#00eeff', strokeThickness:11 }).setOrigin(1, 0.5).setAlpha(0.16),
    scene.add.text(0, 0, 'asing', { font:f, fill:'#ffffff', stroke:'#00eeff', strokeThickness:11 }).setOrigin(0, 0.5).setAlpha(0.16),
    // main fill
    scene.add.text(0, 0, 'E',     { font:f, fill:'#ffd21e', stroke:'#7a5200', strokeThickness:5 }).setOrigin(1, 0.5),
    scene.add.text(0, 0, 'asing', { font:f, fill:'#ffffff', stroke:'#1a4a63', strokeThickness:4 }).setOrigin(0, 0.5),
  ];
  // Re-centre: "E" hangs left of the join, "asing" extends right — shift so the
  // whole wordmark is balanced around the container origin
  const dx = (parts[4].width - parts[5].width) / 2;
  parts.forEach(p => p.x += dx);
  cont.add(parts);
  return cont;
}

// Bottom-corner version + credit strip shared by both menus
function addMenuFooter(scene) {
  scene.add.text(8, H - 12, VERSION, { font:'10px monospace', fill:'#5577aa' }).setOrigin(0, 0.5).setDepth(6);
  scene.add.text(W - 8, H - 12, 'Made by EDease', { font:'10px monospace', fill:'#7788aa' }).setOrigin(1, 0.5).setDepth(6);
}

// Toggle fullscreen defensively. Embedded/sandboxed contexts (e.g. an iframe
// without allow="fullscreen") both throw synchronously AND reject the request
// promise, so we feature-detect first and also guard the call.
function toggleFullscreen(scene) {
  if (scene.scale.isFullscreen) { try { scene.scale.stopFullscreen(); } catch (e) {} return; }
  if (typeof document !== 'undefined' && document.fullscreenEnabled === false) return; // not permitted here
  try { scene.scale.startFullscreen(); } catch (e) { /* ignore */ }
}

// F toggles fullscreen — needed on every screen now the mouse cursor is hidden
function addFullscreenKey(scene) {
  scene.input.keyboard.on('keydown-F', () => toggleFullscreen(scene));
}

// ─── SCENES ───────────────────────────────────────────────────────────────────

// ── Boot ──────────────────────────────────────────────────────────────────────
class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }

  preload() {
    this.load.image('bg_stars',  'assets/bg2.jpg');
    this.load.image('bg_nebula', 'assets/bg1.png');
    // Player ships — coloured sprites (0000=cyan, 0001=orange, 0003=yellow)
    ['0000','0001','0003'].forEach(n =>
      this.load.image(`ship_${n}`, `assets/Ships/ship_${n}.png`)
    );
    // Enemy ships
    ['0012','0013','0014','0015','0016','0017','0018','0019','0020','0021','0022','0023'].forEach(n =>
      this.load.image(`ship_${n}`, `assets/Ships/ship_${n}.png`)
    );
    // New player ships — 5-frame bank strips (hard left … center … hard right)
    this.load.spritesheet('pship_valkyrie', 'assets/Ships/newplayership/PlayerShip_strip5.png', { frameWidth: 20, frameHeight: 19 });
    this.load.spritesheet('pship_thunder',  'assets/Ships/newplayership/New_Ship_strip5.png',   { frameWidth: 19, frameHeight: 27 });
    this.load.spritesheet('pship_death',    'assets/Ships/newplayership/Death_Explosion_strip38.png', { frameWidth: 80, frameHeight: 79 });
    // Big 128px ships — enemy heavies, bosses, and the Devastator player ship
    [1,2,3,4,5,6,9,10,12,14,15,16,17,19,20,21,22,23,24,25].forEach(n =>
      this.load.image(`nship_${n}`, `assets/Ships/new/ship-1 (${n}).png`)
    );
    // Moth-style enemy ships + 3-part composite boss kit (guns overlay the body)
    this.load.image('eship_orange', 'assets/Ships/enemy/0Orange.png');
    this.load.image('eship_yellow', 'assets/Ships/enemy/0Yellow.png');
    this.load.image('eboss_body',   'assets/Ships/enemy/Body.png');
    this.load.image('eboss_lgun',   'assets/Ships/enemy/LGun.png');
    this.load.image('eboss_rgun',   'assets/Ships/enemy/RGun.png');
    // Bullets
    this.load.spritesheet('pbullet0', 'assets/Bullet Pack/Player Bullets/New_P1Bullet_Cian_lvl0_strip2.png', { frameWidth: 2,  frameHeight: 21 });
    this.load.spritesheet('pbullet1', 'assets/Bullet Pack/Player Bullets/New_P1Bullet_Cian_lvl1_strip2.png', { frameWidth: 4,  frameHeight: 21 });
    this.load.spritesheet('pbullet2', 'assets/Bullet Pack/Player Bullets/New_P1Bullet_Cian_lvl2_strip2.png', { frameWidth: 8,  frameHeight: 22 });
    this.load.spritesheet('ebullet_med', 'assets/Bullet Pack/Bullet Pack/Medium_Pink_Purple.png',            { frameWidth: 17, frameHeight: 17 });
    this.load.spritesheet('ebullet_big', 'assets/Bullet Pack/Bullet Pack/Massive_Red_Orange_Yellow.png',     { frameWidth: 13, frameHeight: 13 });
    // Explosions
    this.load.spritesheet('exp_back', 'assets/Bullet Pack/Update/Explosions/Exp_Back_strip15.png',    { frameWidth: 48,  frameHeight: 35 });
    this.load.spritesheet('exp_top',  'assets/Bullet Pack/Update/Explosions/Exp_Top_strip16.png',     { frameWidth: 52,  frameHeight: 32 });
    this.load.spritesheet('exp_mid',  'assets/Bullet Pack/Update/Explosions/New_expmid_strip28.png',  { frameWidth: 100, frameHeight: 100 });
    this.load.spritesheet('exp_wave', 'assets/Bullet Pack/Update/Explosions/New_wave_Strip10.png',    { frameWidth: 128, frameHeight: 128 });
    // Power-up gems
    this.load.spritesheet('gem_power', 'assets/Bullet Pack/Update/Misc/Yellow_Gem_strip9-sheet.png', { frameWidth: 15, frameHeight: 15 });
    this.load.spritesheet('gem_life',  'assets/Bullet Pack/Update/Misc/Pink_Gem_strip9.png',         { frameWidth: 15, frameHeight: 15 });
    this.load.spritesheet('gem_bomb',  'assets/Bullet Pack/Update/Misc/Cian_Gem_strip9-sheet.png',   { frameWidth: 15, frameHeight: 15 });
    // Advanced boss sprites from the stage kits
    this.load.spritesheet('boss_space1', 'assets/Backgrounds/Space Stage 1/Boss/Midboss_Base_Strip3.png', { frameWidth: 156, frameHeight: 96 });
    this.load.spritesheet('boss_sub',    'assets/Backgrounds/Sea Ice Stage/Boss/SubMarine_strip4_loopit in ping pong mode.png', { frameWidth: 137, frameHeight: 321 });
    this.load.image('boss_train',        'assets/Backgrounds/Train Stage/Mid Boss/MidBoss_Base.png');
    this.load.image('boss_train_head',   'assets/Backgrounds/Train Stage/Mid Boss/MidBoss_Head.png');
    // Stage backgrounds — long vertical scrolls, some animated (strips)
    this.load.spritesheet('bg_space1',     'assets/Backgrounds/Space Stage 1/SpaceStage1_strip4.png',              { frameWidth: 400, frameHeight: 2098 });
    this.load.spritesheet('bg_space2_far', 'assets/Backgrounds/Space Stage 2/Layer0_Space_Stage_strip5.png',       { frameWidth: 400, frameHeight: 4110 });
    this.load.image('bg_space2_ground',    'assets/Backgrounds/Space Stage 2/Layer2_Space_stage.PNG');
    this.load.image('bg_industy',          'assets/Backgrounds/Industy/BG.png');
    this.load.spritesheet('bg_seaice',     'assets/Backgrounds/Sea Ice Stage/BG/Stage_Base_strip3.png',            { frameWidth: 240, frameHeight: 2441 });
    this.load.image('bg_nucleo0',          'assets/Backgrounds/Nucleo Stage/BG/Stage_BG_Layer0.png');
    this.load.image('bg_nucleo1',          'assets/Backgrounds/Nucleo Stage/BG/Stage_BG_Layer1.png');
    this.load.spritesheet('bg_nucleo2',    'assets/Backgrounds/Nucleo Stage/BG/Stage_BG_Layer2_strip6.png',        { frameWidth: 240, frameHeight: 5265 });
    // Music
    // Sound effects
    this.load.audio('sfx_shot',       'assets/Audio/effects/playershot.wav');
    this.load.audio('sfx_hit',        'assets/Audio/effects/playerhit.wav');
    this.load.audio('sfx_bomb',       'assets/Audio/effects/bomb.wav');
    this.load.audio('sfx_powerup',    'assets/Audio/effects/power up.wav');
    this.load.audio('sfx_enemyhit',   'assets/Audio/effects/enemyhit.wav');
    this.load.audio('sfx_bossdead',   'assets/Audio/effects/destroy boss.wav');
    // Music
    this.load.audio('music_main',   'assets/Audio/levelbm/maintheme.ogg');
    this.load.audio('music_level1', 'assets/Audio/levelbm/level1.ogg');
    this.load.audio('music_level2', 'assets/Audio/levelbm/level2.ogg');
    this.load.audio('music_level3', 'assets/Audio/levelbm/level3.ogg');
    this.load.audio('music_boss',   'assets/Audio/levelbm/boss.ogg');
  }

  create() {
    makeTextures(this);
    makeAnims(this);
    State.loadScores();
    if (window._preloaderDone) window._preloaderDone();
    this.scene.start('Title');
  }
}

// ── Title Screen ──────────────────────────────────────────────────────────────
class TitleScene extends Phaser.Scene {
  constructor() { super('Title'); }

  create() {
    const W = this.scale.width, H = this.scale.height;
    playMusic(this, 'music_main', 0.55);

    // Animated space backdrop
    addMenuBackground(this);

    // Glowing wordmark with a gentle breathing pulse
    const logoY = H * 0.28;
    const logo = drawLogo(this, W/2, logoY);
    this.tweens.add({ targets: logo, scale: { from: 1, to: 1.04 }, duration: 1700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    // Decorative lines + tagline under the logo
    const gfx = this.add.graphics().setDepth(5);
    const lineY = logoY + 46;
    gfx.lineStyle(2, 0x00eeff, 0.8);
    gfx.beginPath(); gfx.moveTo(W*0.16, lineY); gfx.lineTo(W*0.84, lineY); gfx.strokePath();
    gfx.lineStyle(1, 0x00eeff, 0.25);
    gfx.beginPath(); gfx.moveTo(W*0.08, lineY + 5); gfx.lineTo(W*0.92, lineY + 5); gfx.strokePath();
    this.add.text(W/2, lineY + 24, 'G A L A C T I C   A S S A U L T', {
      font: '12px monospace', fill: '#9fd6ff',
    }).setOrigin(0.5).setDepth(5);

    // Hovering hero ship — the Valkyrie, banking gently
    const hero = this.add.sprite(W/2, H * 0.55, 'pship_valkyrie', 2).setDepth(5).setScale(3.6);
    this.tweens.add({ targets: hero, y: hero.y - 12, duration: 1500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    // engine glow beneath the ship
    const glow = this.add.ellipse(W/2, H * 0.55 + 26, 22, 40, 0x33ccff, 0.4).setDepth(4);
    this.tweens.add({ targets: glow, scaleY: 0.6, alpha: 0.7, duration: 220, yoyo: true, repeat: -1 });
    hero.on('destroy', () => this.tweens.killTweensOf(glow));

    // Framed PRESS Z prompt
    const pzY = H * 0.71;
    this.add.rectangle(W/2, pzY, 244, 40, 0x001426, 0.55).setStrokeStyle(1, 0x33bbff, 0.7).setDepth(4);
    this.pressZ = this.add.text(W/2, pzY, 'PRESS  Z  TO  START', {
      font: '16px monospace', fill: '#ffffff', stroke: '#003355', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(5);
    this.tweens.add({ targets: this.pressZ, alpha: 0.25, duration: 620, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    // Controls hint
    this.add.text(W/2, H - 42, 'Z SHOOT   ·   X SLOW+LASER   ·   M MUTE   ·   F FULLSCREEN', {
      font: '10px monospace', fill: '#7089a3',
    }).setOrigin(0.5).setDepth(6);

    addMenuFooter(this);

    // Mute
    this.muteTxt = this.add.text(W - 8, 8, '', { font: '11px monospace', fill: '#888' })
      .setOrigin(1, 0).setDepth(6);
    this.input.keyboard.on('keydown-M', () => {
      this.sound.mute = !this.sound.mute;
      this.muteTxt.setText(this.sound.mute ? '🔇 M' : '');
    });

    // Fullscreen button — labelled with the key since the mouse cursor is hidden
    const fsbg = this.add.rectangle(W/2, H * 0.80, 210, 24, 0x002233, 0.85).setDepth(5)
      .setStrokeStyle(1, 0x2277aa, 0.8).setInteractive({ useHandCursor: true });
    const fstxt = this.add.text(W/2, H * 0.80, '⛶  PRESS  F  FOR  FULLSCREEN', { font: '9px monospace', fill: '#44ccff' }).setOrigin(0.5).setDepth(6);
    const toggleFS = () => toggleFullscreen(this);
    fsbg.on('pointerdown', toggleFS);
    fsbg.on('pointerover',  () => fstxt.setStyle({ fill: '#ffffff' }));
    fsbg.on('pointerout',   () => fstxt.setStyle({ fill: '#44ccff' }));
    this.input.keyboard.on('keydown-F', toggleFS);

    // Z / tap / gamepad → Ship Select with fade
    this._gone = false;
    this.goToSelect = () => {
      if (this._gone) return;
      this._gone = true;
      this.cameras.main.fadeOut(220, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('ShipSelect'));
    };
    this.input.keyboard.once('keydown-Z', this.goToSelect);
    this.input.once('pointerdown', this.goToSelect);

    this.cameras.main.fadeIn(400, 0, 0, 0);
  }

  update(time, delta) {
    updateMenuBackground(this, delta);
    // Gamepad: any face button advances past title
    if (!this._gone && this.input.gamepad.total > 0) {
      const pad = this.input.gamepad.getPad(0);
      if (pad && (pad.A || pad.B || pad.X || pad.Y || pad.start)) this.goToSelect();
    }
  }
}

// ── Ship Select ───────────────────────────────────────────────────────────────
class ShipSelectScene extends Phaser.Scene {
  constructor() { super('ShipSelect'); }

  create() {
    this.sel = State.ship || 0;
    playMusic(this, 'music_main');

    addMenuBackground(this);

    this.add.text(W/2, 42, 'SELECT YOUR SHIP', {
      font:'20px monospace', fill:'#fff', stroke:'#003355', strokeThickness:3,
    }).setOrigin(0.5).setDepth(5);

    // "Playable with controller!" badge — drawn gamepad glyph + pulsing pill
    this.makeControllerBadge(W/2, 72);

    // Control hint boxes
    const controls = [
      { key: '◀ ▶', label: 'MOVE' },
      { key: 'Z',   label: 'START / SHOOT' },
      { key: 'X',   label: 'SLOW + LASER' },
      { key: 'M',   label: 'MUTE' },
      { key: 'F',   label: 'FULLSCREEN' },
    ];
    const boxW = 80, gap = 6;
    const totalW = controls.length * boxW + (controls.length - 1) * gap;
    let cx = W / 2 - totalW / 2;
    const gy = this.add.graphics().setDepth(5);
    controls.forEach(c => {
      const bx = cx + boxW / 2;
      gy.fillStyle(0x0a1024, 0.85);
      gy.fillRoundedRect(cx, 96, boxW, 32, 4);
      gy.lineStyle(1, 0x2a4a8a, 1);
      gy.strokeRoundedRect(cx, 96, boxW, 32, 4);
      this.add.text(bx, 104, c.key,   { font: 'bold 9px monospace', fill: '#88ccff' }).setOrigin(0.5, 0).setDepth(6);
      this.add.text(bx, 115, c.label, { font: '7px monospace',      fill: '#66809a' }).setOrigin(0.5, 0).setDepth(6);
      cx += boxW + gap;
    });
    this.muteLabel = this.add.text(W-8, 8, '', { font:'11px monospace', fill:'#888' }).setOrigin(1,0).setDepth(6);
    this.input.keyboard.on('keydown-M', () => {
      this.sound.mute = !this.sound.mute;
      this.muteLabel.setText(this.sound.mute ? '🔇 M' : '');
    });
    addFullscreenKey(this);

    this.add.text(W/2, 150, 'Slow down to evade more intense patterns!', { font:'10px monospace', fill:'#88aacc' }).setOrigin(0.5, 0).setDepth(5);

    this.cards = SHIPS.map((ship, i) => this.makeCard(ship, i));
    this.highlight();

    const startGame = () => {
      State.ship = this.sel; State.score = 0; State.level = 1;
      State.lives = 3; State.powerLevel = 0; State.subPower = 0;
      this.scene.start('Game');
    };
    this.input.keyboard.on('keydown-LEFT',  () => { this.sel = (this.sel + SHIPS.length - 1) % SHIPS.length; this.highlight(); });
    this.input.keyboard.on('keydown-RIGHT', () => { this.sel = (this.sel + 1) % SHIPS.length; this.highlight(); });
    this.input.keyboard.on('keydown-Z', startGame);
    this.input.keyboard.on('keydown-H', () => this.scene.start('Highscore'));

    // Mobile: tap left/right thirds to change ship, tap centre third to start
    this.input.on('pointerdown', pointer => {
      if (pointer.x < W / 3)      { this.sel = (this.sel + SHIPS.length - 1) % SHIPS.length; this.highlight(); }
      else if (pointer.x > W * 2/3) { this.sel = (this.sel + 1) % SHIPS.length; this.highlight(); }
      else                           { startGame(); }
    });

    // Show tap hint on mobile
    if (window.matchMedia('(pointer: coarse)').matches) {
      this.add.text(W/2, H - 44, '◀ TAP LEFT/RIGHT TO CHANGE  ·  TAP CENTRE TO START ▶', { font:'7px monospace', fill:'#66809a' }).setOrigin(0.5).setDepth(6);
    }

    this.add.text(W/2, H - 28, 'H — HIGHSCORES', { font:'11px monospace', fill:'#8899bb' }).setOrigin(0.5).setDepth(6);
    addMenuFooter(this);
  }

  // Draws a small controller icon + "PLAYABLE WITH CONTROLLER!" in a pulsing pill
  makeControllerBadge(x, y) {
    const badge = this.add.container(x, y).setDepth(6);
    const label = this.add.text(0, 0, 'PLAYABLE WITH CONTROLLER!', { font:'bold 9px monospace', fill:'#7dffce' }).setOrigin(0, 0.5);
    const iconW = 20;
    const contentW = iconW + label.width;
    label.x = -contentW / 2 + iconW;
    const iconX = -contentW / 2 + 9;
    const ic = this.add.graphics();
    ic.fillStyle(0x7dffce, 1); ic.fillRoundedRect(iconX - 8, -4, 16, 8, 3); // pad body
    ic.fillStyle(0x0a2a1e, 1);
    ic.fillRect(iconX - 5, -0.5, 3, 1); ic.fillRect(iconX - 4, -1.5, 1, 3);  // d-pad
    ic.fillCircle(iconX + 4, -1, 1); ic.fillCircle(iconX + 6, 1, 1);          // buttons
    const bbg = this.add.rectangle(0, 0, contentW + 22, 20, 0x0a2a1e, 0.85).setStrokeStyle(1, 0x33cc88, 0.9);
    badge.add([bbg, ic, label]);
    this.tweens.add({ targets: badge, scale: { from: 1, to: 1.05 }, duration: 950, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }

  makeCard(ship, i) {
    const cx = 80 + i * 160, cy = 312;
    const cont = this.add.container(cx, cy).setDepth(3);
    const bg = this.add.rectangle(0, 0, 132, 238, 0x0c0c1e, 0.9).setStrokeStyle(1, 0x334466);
    const sprite = this.add.image(0, -80, ship.texture, ship.centerFrame || 0);
    sprite.setScale(60 / Math.max(sprite.width, sprite.height)); // normalize across mixed art sizes
    const name = this.add.text(0, -32, ship.name, { font:'bold 12px monospace', fill:'#fff' }).setOrigin(0.5);
    const descLines = ship.desc.split('·').map(s => '· ' + s.trim()).join('\n');
    const desc = this.add.text(0, -14, descLines, { font:'8px monospace', fill:'#aab', align:'center' }).setOrigin(0.5, 0);

    // Stat bars — SPD normalized across the ship roster, PWR from ship.power
    const extras = [];
    const mkBar = (by, barLabel, frac, color) => {
      const lbl = this.add.text(-54, by, barLabel, { font:'7px monospace', fill:'#8fa3bb' }).setOrigin(0, 0.5);
      const g = this.add.graphics();
      const bx = -28, bw = 78, bh = 6;
      g.fillStyle(0x000000, 0.55); g.fillRect(bx, by - bh/2, bw, bh);
      g.fillStyle(color, 1);       g.fillRect(bx, by - bh/2, bw * frac, bh);
      g.lineStyle(1, 0x33507a, 1); g.strokeRect(bx, by - bh/2, bw, bh);
      extras.push(lbl, g);
    };
    const spdFrac = Phaser.Math.Clamp((ship.speed - 160) / 170, 0.12, 1);
    mkBar(66, 'SPD', spdFrac, 0x44ccff);
    mkBar(84, 'PWR', Phaser.Math.Clamp(ship.power || 0.5, 0.12, 1), 0xffaa33);

    cont.add([bg, sprite, name, desc, ...extras]);
    return { cont, bg, sprite, name };
  }

  highlight() {
    SHIPS.forEach((_, i) => {
      const c = this.cards[i];
      const active = i === this.sel;
      c.bg.setFillStyle(active ? 0x16183c : 0x0c0c1e, active ? 0.95 : 0.85);
      c.bg.setStrokeStyle(active ? 2 : 1, active ? 0x88ccff : 0x334466);
      c.sprite.setAlpha(active ? 1 : 0.45);
      c.name.setColor(active ? '#ffffff' : '#667799');
      c.cont.setScale(active ? 1.06 : 0.95).setDepth(active ? 5 : 3);
    });
  }

  update(time, delta) {
    updateMenuBackground(this, delta);
    if (this.input.gamepad.total === 0) return;
    const pad = this.input.gamepad.getPad(0);
    if (!pad) return;
    if (!this._nav) this._nav = {};
    const left    = padNavStep(this._nav, 'left',  pad.left  || pad.leftStick.x < -0.5, delta, 450, 250);
    const right   = padNavStep(this._nav, 'right', pad.right || pad.leftStick.x >  0.5, delta, 450, 250);
    const confirm = padNavStep(this._nav, 'A',     pad.A || pad.start, delta); // edge only, no repeat
    // First frame just records buttons already held (e.g. A from the title screen)
    if (!this._navSeeded) { this._navSeeded = true; return; }
    if (left)  { this.sel = (this.sel + SHIPS.length - 1) % SHIPS.length; this.highlight(); }
    if (right) { this.sel = (this.sel + 1) % SHIPS.length; this.highlight(); }
    if (confirm) {
      State.ship = this.sel; State.score = 0; State.level = 1;
      State.lives = 3; State.powerLevel = 0; State.subPower = 0;
      this.scene.start('Game');
    }
  }
}

// ── Game ──────────────────────────────────────────────────────────────────────
class GameScene extends Phaser.Scene {
  constructor() { super('Game'); }

  create() {
    this.gameOver     = false;
    this.bossActive    = false;
    this.bossTriggered = false;
    this.wavesEnabled  = false; // held until level banner finishes
    this.pendingSpawns = 0;     // incremented per queued spawn, decremented on fire
    this.invincible   = 0;
    this.lives        = State.lives;
    this.shotCooldown  = 0;
    this.laserCooldown = 0;
    this.waveIdx   = 0;
    this.waveTimer = 0;
    this.levelDef  = LEVELS[(State.level - 1) % LEVELS.length];
    const levelTrack = this.levelDef.music || `music_level${Math.min(State.level, 3)}`;
    playMusic(this, levelTrack);
    this.ship      = SHIPS[State.ship];
    // Per-level texture pools for variety
    this.levelEnemyTextures   = this.levelDef.enemyTextures   || ['ship_0012'];
    this.levelArmoredTextures = this.levelDef.armoredTextures || ['ship_0015'];
    this.levelBossTexture     = this.levelDef.bossTexture     || 'ship_0022';
    // Powerup budget for this level — caps total drops
    this.puDropped = { power: 0, bomb: 0, life: 0 };

    // Background — dedicated scrolling stage art per level, with the old
    // starfield as fallback for any level without a bg definition
    this.bgLayers = [];
    this.bgStars = this.bgNebula = this.stars3 = null;
    if (this.levelDef.bg) {
      for (const layerCfg of this.levelDef.bg.layers)
        this.bgLayers.push(makeScrollLayer(this, layerCfg));
      if (this.levelDef.bg.stars) // fine star sparkle on top of space stages
        this.stars3 = this.add.tileSprite(0, 0, W, H, 'stars3').setOrigin(0,0).setDepth(2).setAlpha(0.6);
      if (this.levelDef.bg.dim) // darken bright ground stages so bullets stay readable
        this.add.rectangle(0, 0, W, H, 0x000010, this.levelDef.bg.dim).setOrigin(0, 0).setDepth(2.5);
    } else {
      this.bgStars  = this.add.tileSprite(W/2, H/2, W, H, 'bg_stars')
        .setDepth(0).setTileScale(1.6);
      this.bgNebula = this.add.tileSprite(W/2, H/2, W, H, 'bg_nebula')
        .setDepth(1).setAlpha(0.6).setTileScale(1.6);
      if (this.levelDef.nebulaTint) this.bgNebula.setTint(this.levelDef.nebulaTint);
      this.stars3 = this.add.tileSprite(0, 0, W, H, 'stars3').setOrigin(0,0).setDepth(2);
      // Per-level colour wash — makes each level visually distinct
      if (this.levelDef.overlayAlpha > 0) {
        this.add.rectangle(0, 0, W, H, this.levelDef.overlayColor, this.levelDef.overlayAlpha)
          .setOrigin(0, 0).setDepth(2.5);
      }
    }

    // Groups — bullet groups use pools so we recycle instead of allocate
    this.playerBullets = this.physics.add.group({
      maxSize: 200, classType: Phaser.Physics.Arcade.Image,
      createCallback: o => { o.body.allowGravity = false; o.setDepth(8); }
    });
    this.laserGroup = this.physics.add.group({
      maxSize: 60, classType: Phaser.Physics.Arcade.Image,
      createCallback: o => { o.body.allowGravity = false; o.setDepth(8); }
    });
    this.enemies       = this.physics.add.group();
    this.enemyBullets  = this.physics.add.group({
      maxSize: 400, classType: Phaser.Physics.Arcade.Sprite, // Sprite so bullets can play strip animations
      createCallback: o => { o.body.allowGravity = false; o.setDepth(6); }
    });
    this.powerups      = this.physics.add.group();

    // Player
    const pscale = this.ship.scale || 2;
    this.player = this.physics.add.sprite(W/2, H - 80, this.ship.texture, this.ship.centerFrame || 0)
      .setDepth(10).setScale(pscale);
    this.player.setCollideWorldBounds(true);
    // setSize is in source pixels — divide by scale so the world hitbox stays ~8px
    this.player.body.setSize(8 / pscale, 8 / pscale, true);
    this._bankDir = 0; this._prevBankDir = 0; this._bankT = 0;

    this.hitbox = this.add.image(W/2, H - 80, 'hitbox').setDepth(11).setAlpha(0);
    this.laserBeam = this.add.graphics().setDepth(9);
    // Thruster flame — sits behind the ship, grows when pushing forward
    this.thruster = this.add.image(W/2, H - 80, 'flame').setOrigin(0.5, 0)
      .setDepth(9.5).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.9);
    this._thrustLen = 1;

    // Input
    this.cursors  = this.input.keyboard.createCursorKeys();
    this.fireKey  = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Z);
    this.focusKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.X);

    // Gamepad
    this.gamepad = null;
    // 'connected' fires for new pads; for already-connected pads grab them in update
    this.input.gamepad.on('connected', pad => { this.gamepad = pad; });

    // Touch controls — only on mobile
    this.touchShoot = false;
    this.touchFocus = false;
    this.joyPointer = null; // set up properly inside the isMobile block below
    // coarse pointer = touchscreen; fine pointer = mouse (desktop)
    const isMobile = window.matchMedia('(pointer: coarse)').matches;
    if (isMobile) {
      this.input.addPointer(2);
      // Button geometry
      const btnW = 100, btnH = 64, pad = 14;
      const shootX = W - btnW/2 - pad, shootY = H - btnH/2 - pad;
      const laserX = W - btnW/2 - pad, laserY = shootY - btnH - 10;
      this.shootZone = new Phaser.Geom.Rectangle(shootX - btnW/2, shootY - btnH/2, btnW, btnH);
      this.laserZone = new Phaser.Geom.Rectangle(laserX - btnW/2, laserY - btnH/2, btnW, btnH);
      const g = this.add.graphics().setDepth(28);
      // Shoot button
      g.fillStyle(0xff4400, 0.4); g.fillRoundedRect(this.shootZone.x, this.shootZone.y, btnW, btnH, 10);
      g.lineStyle(2, 0xff8800, 0.9); g.strokeRoundedRect(this.shootZone.x, this.shootZone.y, btnW, btnH, 10);
      this.add.text(shootX, shootY, 'SHOOT', { font: 'bold 14px monospace', fill: '#ffcc88' }).setOrigin(0.5).setDepth(29);
      // Laser button
      g.fillStyle(0x0055ff, 0.4); g.fillRoundedRect(this.laserZone.x, this.laserZone.y, btnW, btnH, 10);
      g.lineStyle(2, 0x4499ff, 0.9); g.strokeRoundedRect(this.laserZone.x, this.laserZone.y, btnW, btnH, 10);
      this.add.text(laserX, laserY, 'LASER', { font: 'bold 14px monospace', fill: '#88ccff' }).setOrigin(0.5).setDepth(29);

      // Fixed virtual joystick (bottom-left) — analog stick anchored to one spot,
      // instead of the ship chasing the raw finger position anywhere on screen
      const joyR = 54, joyKnobR = 22;
      this.joyRadius = joyR;
      this.joyCenter = { x: joyR + pad + 6, y: H - joyR - pad - 6 };
      this.joyPointer = null;
      this.touchDirX = 0;
      this.touchDirY = 0;
      g.fillStyle(0x0a1a33, 0.45); g.fillCircle(this.joyCenter.x, this.joyCenter.y, joyR);
      g.lineStyle(2, 0x4499ff, 0.8); g.strokeCircle(this.joyCenter.x, this.joyCenter.y, joyR);
      this.joyKnob = this.add.circle(this.joyCenter.x, this.joyCenter.y, joyKnobR, 0x66bbff, 0.55)
        .setDepth(29).setStrokeStyle(2, 0xaaddff, 0.9);

      const joyCatchR = joyR * 1.4; // slightly generous so a stray tap near the edge still engages
      this.input.on('pointerdown', p => {
        if (this.joyPointer === null && Phaser.Math.Distance.Between(p.x, p.y, this.joyCenter.x, this.joyCenter.y) <= joyCatchR) {
          this.joyPointer = p;
        }
      });
      const releaseJoy = p => {
        if (p === this.joyPointer) {
          this.joyPointer = null;
          this.touchDirX = 0; this.touchDirY = 0;
          this.joyKnob.setPosition(this.joyCenter.x, this.joyCenter.y);
        }
      };
      this.input.on('pointerup', releaseJoy);
      this.input.on('pointerupoutside', releaseJoy);
    }
    this.input.keyboard.on('keydown-M', () => {
      this.sound.mute = !this.sound.mute;
      this.updateMuteLabel();
    });
    addFullscreenKey(this);

    // Collisions — power-ups use manual distance check in update (avoids physics callback corruption)
    const ba = (a, b) => a.active && b.active;
    this.physics.add.overlap(this.playerBullets, this.enemies,  this.hitEnemy,  ba, this);
    this.physics.add.overlap(this.laserGroup,    this.enemies,  this.hitEnemy,  ba, this);
    this.physics.add.overlap(this.enemyBullets,  this.player,   this.hitPlayer, ba, this);
    this.physics.add.overlap(this.enemies,        this.player,   this.hitPlayer, ba, this);

    // HUD
    this.scoreTxt  = this.add.text(8,  8,  'SCORE 0',        { font:'13px monospace', fill:'#fff' }).setDepth(20);
    this.livesTxt  = this.add.text(8,  26, '♥♥♥',            { font:'13px monospace', fill:'#f55' }).setDepth(20);
    this.levelTxt  = this.add.text(W/2, 8, 'LV 1',           { font:'13px monospace', fill:'#aaa' }).setOrigin(0.5,0).setDepth(20);
    this.modeTxt   = this.add.text(W-8, 8, 'AUTO',           { font:'13px monospace', fill:'#4af' }).setOrigin(1,0).setDepth(20);
    this.muteTxt   = this.add.text(W-8, 24, '',              { font:'11px monospace', fill:'#888' }).setOrigin(1,0).setDepth(20);
    this.updateMuteLabel();
    this.powerBar  = this.add.graphics().setDepth(20);
    this.bossHPBar = this.add.graphics().setDepth(20);
    this.bossHPLabel = this.add.text(W/2, H-28, '', { font:'11px monospace', fill:'#f8f' }).setOrigin(0.5,0).setDepth(20);

    this.updateHUD();

    // Show level title banner, enable waves only after it finishes
    this.showBanner(`LEVEL ${State.level}  ${this.levelDef.title}`, '#fff', () => {
      this.wavesEnabled = true;
      this.spawnWave();
    });
  }

  update(time, delta) {
    if (this.gameOver) return;
    this.invincible = Math.max(0, this.invincible - delta);

    updateScrollLayers(this, delta);
    if (this.bgStars)  this.bgStars.tilePositionY  -= 0.25;
    if (this.bgNebula) this.bgNebula.tilePositionY -= 0.08;
    if (this.stars3)   this.stars3.tilePositionY   -= 2.5;

    // Wave progression — guarded by wavesEnabled so the level banner
    // can't race with the first spawnWave call
    this.waveTimer += delta;
    // Short gap so clearing a wave quickly (easy on early levels) doesn't
    // leave the field empty for seconds before the next one shows up
    if (this.wavesEnabled && !this.bossActive &&
        this.pendingSpawns === 0 &&
        this.enemies.countActive(true) === 0 && this.waveTimer > 800) {
      this.spawnWave();
    }

    // Boss HP bar update
    if (this.bossActive) {
      const boss = this.enemies.getChildren().find(e => e.isBoss && e.active);
      if (boss) this.drawBossHP(boss);
      else { this.bossActive = false; this.bossHPBar.clear(); this.bossHPLabel.setText(''); }
    }

    this.scoreTxt.setText('SCORE ' + State.score);

    // Cleanup off-screen projectiles — deactivate back into pool.
    // Player bullets flicker between their 2 strip frames; enemy bullets are self-animated.
    const flashOn = (this.time.now % 160) < 80;
    for (const b of this.playerBullets.getChildren()) {
      if (!b.active) continue;
      if (b.y < -30 || b.x < -30 || b.x > W+30) { b.setActive(false).setVisible(false); continue; }
      b.setFrame(flashOn ? 1 : 0);
    }
    for (const b of this.laserGroup.getChildren())
      if (b.active && b.y < -20) b.setActive(false).setVisible(false);
    for (const b of this.enemyBullets.getChildren()) {
      if (!b.active) continue;
      if (b.y > H+20 || b.x < -40 || b.x > W+40) { b.setActive(false).setVisible(false); b.anims.stop(); }
    }
    for (const e of this.enemies.getChildren()) {
      if (e.y > H+80 || e.x < -100 || e.x > W+100) { if (e._parts) e._parts.forEach(p => p.destroy()); e.destroy(); continue; }
      // Keep any multi-part overlays glued to their boss
      if (e._parts) e._parts.forEach(p => p.setPosition(e.x + p._dx, e.y + p._dy).setRotation(e.rotation));
      // Rotate nose toward player (sprite faces down at rotation=0 due to flipY)
      if (!e.isBoss && this.player && this.player.active) {
        const targetRot = Phaser.Math.Angle.Between(e.x, e.y, this.player.x, this.player.y) - Math.PI / 2;
        e.rotation = Phaser.Math.Angle.RotateTo(e.rotation, targetRot, 0.06);
      }
    }
    for (const p of this.powerups.getChildren())
      if (p.y > H+30) p.destroy();

    // Power-up collection: manual distance check, no physics callback
    if (this.player && this.player.active) {
      for (const pu of this.powerups.getChildren()) {
        if (!pu.active) continue;
        if (Phaser.Math.Distance.Between(this.player.x, this.player.y, pu.x, pu.y) < 22) {
          this.collectPU(pu);
        }
      }
    }

    if (!this.player || !this.player.active || !this.player.body) return;

    // ── Touch pointer scan ────────────────────────────────────────────────
    this.touchShoot = false;
    this.touchFocus = false;
    if (this.shootZone) {
      const ptrs = [this.input.pointer1, this.input.pointer2, this.input.pointer3];
      for (const p of ptrs) {
        if (!p.isDown) continue;
        if (this.shootZone.contains(p.x, p.y)) { this.touchShoot = true; }
        else if (this.laserZone.contains(p.x, p.y)) { this.touchFocus = true; }
      }
      // Fixed virtual joystick — direction + magnitude from the drag offset
      // relative to its anchored centre, not the finger's absolute position
      if (this.joyPointer && this.joyPointer.isDown) {
        const dx = this.joyPointer.x - this.joyCenter.x;
        const dy = this.joyPointer.y - this.joyCenter.y;
        const dist = Math.hypot(dx, dy);
        const clamped = Math.min(dist, this.joyRadius);
        const ang = Math.atan2(dy, dx);
        this.joyKnob.setPosition(this.joyCenter.x + Math.cos(ang) * clamped, this.joyCenter.y + Math.sin(ang) * clamped);
        const dead = 10;
        if (dist > dead) {
          const mag = Math.min(1, (dist - dead) / (this.joyRadius - dead));
          this.touchDirX = Math.cos(ang) * mag;
          this.touchDirY = Math.sin(ang) * mag;
        } else {
          this.touchDirX = 0; this.touchDirY = 0;
        }
      }
    }

    // ── Gamepad ───────────────────────────────────────────────────────────
    // Pick up pads that were already connected before the scene loaded
    if (!this.gamepad && this.input.gamepad.total > 0) this.gamepad = this.input.gamepad.getPad(0);
    const pad = this.gamepad && this.gamepad.connected ? this.gamepad : null;

    // ── Movement ──────────────────────────────────────────────────────────
    // Anything that fires the laser also slows you down — including pad B
    const focused = this.focusKey.isDown || this.touchFocus || (pad && (pad.R2 > 0.3 || pad.B));
    const spd = focused ? this.ship.focusSpeed : this.ship.speed;

    let mvx = (this.cursors.left.isDown ? -1 : this.cursors.right.isDown ? 1 : 0);
    let mvy = (this.cursors.up.isDown   ? -1 : this.cursors.down.isDown  ? 1 : 0);

    if (pad) {
      const ax = pad.leftStick.x, ay = pad.leftStick.y;
      if (Math.abs(ax) > 0.12) mvx = ax;
      else if (pad.left) mvx = -1; else if (pad.right) mvx = 1;
      if (Math.abs(ay) > 0.12) mvy = ay;
      else if (pad.up) mvy = -1; else if (pad.down) mvy = 1;
    }

    if (this.joyPointer && this.joyPointer.isDown) {
      mvx = this.touchDirX;
      mvy = this.touchDirY;
    }

    this.player.setVelocity(mvx * spd, mvy * spd);

    // Bank tilt — slight tilt immediately, hard tilt after holding a direction
    if (this.ship.bank) {
      this._bankDir = mvx < -0.3 ? -1 : mvx > 0.3 ? 1 : 0;
      this._bankT = this._bankDir === this._prevBankDir ? this._bankT + delta : 0;
      this._prevBankDir = this._bankDir;
      let f = 2;
      if (this._bankDir < 0) f = this._bankT > 160 ? 0 : 1;
      else if (this._bankDir > 0) f = this._bankT > 160 ? 4 : 3;
      this.player.setFrame(f);
    }

    this.hitbox.setPosition(this.player.x, this.player.y).setAlpha(focused ? 1 : 0);
    this.modeTxt.setText(focused ? 'FOCUS' : 'AUTO');

    // Thruster: long when pushing forward, short when braking, flickering always
    const thrustTarget = mvy < -0.3 ? 1.8 : mvy > 0.3 ? 0.5 : 1.0;
    this._thrustLen = Phaser.Math.Linear(this._thrustLen, thrustTarget, 0.18);
    this.thruster
      .setPosition(this.player.x, this.player.y + this.player.displayHeight / 2 - 4)
      .setScale(1.1, this._thrustLen * (0.85 + Math.random() * 0.3))
      .setAlpha((focused ? 0.55 : 0.95) * this.player.alpha);

    // ── Shooting ──────────────────────────────────────────────────────────
    this.shotCooldown  = Math.max(0, this.shotCooldown - delta);
    this.laserCooldown = Math.max(0, this.laserCooldown - delta);
    this.laserBeam.clear();

    // X (focus key) alone fires laser — no need to hold Z simultaneously.
    // focused already covers keyboard X, touch, R2 and pad B.
    if (focused) {
      this.doLaser();
      this.drawLaserBeam();
    } else if (this.fireKey.isDown || this.touchShoot || (pad && pad.A)) {
      this.doShot();
    }
  }

  // ── Fire ──────────────────────────────────────────────────────────────────

  doShot() {
    if (this.shotCooldown > 0) return;
    this.shotCooldown = this.ship.fireRate;
    this.sound.play('sfx_shot', { volume: 0.4 });
    this.ship.fire(this, this.player.x, this.player.y, State.powerLevel);
  }

  doLaser() {
    if (this.laserCooldown > 0) return;
    this.laserCooldown = 48;
    this.sound.play('sfx_shot', { volume: 0.18 });
    const damage = 2 + Math.floor(State.powerLevel / 2); // 2, 2, 3, 3, 4
    this.ship.laser(this, this.player.x, this.player.y, damage);
  }

  // Beam visual, drawn EVERY frame while the laser is held (damage still ticks
  // on the 48ms cooldown) — steady and bright instead of the old 1-in-3-frames flicker
  drawLaserBeam() {
    const px = this.player.x, py = this.player.y;
    const pl = State.powerLevel; // 0-4
    const coreW  = 5  + pl * 3;          // 5 → 17 px
    const glowW  = 14 + pl * 7;          // 14 → 42 px
    const glowCol = pl >= 3 ? 0xff2200 : pl >= 2 ? 0xff7700 : 0xffbb00;
    // outer glow → coloured mid → white-hot core
    this.laserBeam.lineStyle(glowW, glowCol, 0.35);
    this.laserBeam.beginPath(); this.laserBeam.moveTo(px, py - 12); this.laserBeam.lineTo(px, 0); this.laserBeam.strokePath();
    this.laserBeam.lineStyle(coreW, glowCol, 0.9);
    this.laserBeam.beginPath(); this.laserBeam.moveTo(px, py - 12); this.laserBeam.lineTo(px, 0); this.laserBeam.strokePath();
    this.laserBeam.lineStyle(Math.max(2, coreW - 3), 0xffffff, 1);
    this.laserBeam.beginPath(); this.laserBeam.moveTo(px, py - 12); this.laserBeam.lineTo(px, 0); this.laserBeam.strokePath();
    // muzzle flare at the ship's nose, gently pulsing
    const flare = 6 + pl * 2 + Math.sin(this.time.now / 40) * 2;
    this.laserBeam.fillStyle(0xffffff, 0.9);
    this.laserBeam.fillCircle(px, py - 14, flare * 0.5);
    this.laserBeam.fillStyle(glowCol, 0.4);
    this.laserBeam.fillCircle(px, py - 14, flare);
  }

  // ── Collisions ────────────────────────────────────────────────────────────

  hitEnemy(bullet, enemy) {
    if (enemy.invulnerable) { bullet.setActive(false).setVisible(false); return; }
    const dmg = bullet.damage || 1;
    enemy.hp -= dmg;
    bullet.setActive(false).setVisible(false);

    if (enemy.hp <= 0) {
      State.score += enemy.points || 100;
      const ex = enemy.x, ey = enemy.y, sz = enemy.explodeSize || 'small';
      const wasBoss = enemy.isBoss;
      const isHeavy = wasBoss || enemy.isArmored; // read before destroy()
      if (enemy._parts) enemy._parts.forEach(p => p.destroy());
      enemy.destroy();
      this.spawnExplosion(ex, ey, sz);
      // Kill pop — weak enemies die on the first hit and never reach the
      // survive-branch hit sound, so give the kill itself audio feedback
      // (same throttle as the hit thud, pitched brighter)
      const killNow = this.time.now;
      if (!this.lastEnemyHitSoundAt || killNow - this.lastEnemyHitSoundAt > 70) {
        this.lastEnemyHitSoundAt = killNow;
        this.sound.play('sfx_enemyhit', { volume: 0.65, rate: 1.15 });
      }
      if (wasBoss) {
        this.sound.play('sfx_bossdead', { volume: 0.9 });
        this.time.delayedCall(600, () => this.levelComplete());
      }
      // Chance to drop power-up
      if (Phaser.Math.Between(1, 100) <= (wasBoss ? 100 : isHeavy ? 40 : 15)) {
        spawnPowerup(this, ex, ey, isHeavy);
      }
    } else {
      // Throttle: rapid-fire weapons (laser) can trigger many overlaps per frame,
      // which stacks overlapping instances of this sound and muffles everything else.
      const now = this.time.now;
      if (!this.lastEnemyHitSoundAt || now - this.lastEnemyHitSoundAt > 70) {
        this.lastEnemyHitSoundAt = now;
        this.sound.play('sfx_enemyhit', { volume: 0.7, rate: 0.85 });
      }
      this.cameras.main.shake(55, 0.004);
      // Only kill the previous flash tween, not movement tweens
      if (enemy._flashTween) { enemy._flashTween.destroy(); enemy._flashTween = null; }
      enemy.setAlpha(1);
      enemy._flashTween = this.tweens.add({ targets: enemy, alpha: 0.35, duration: 45, yoyo: true });
    }
  }

  hitPlayer(obj, player) {
    if (this.invincible > 0) return;
    if (this.enemyBullets.contains(obj)) obj.setActive(false).setVisible(false);
    this.lives--;
    State.lives = this.lives;
    this.livesTxt.setText('♥'.repeat(Math.max(0, this.lives)));
    this.invincible = 2500;
    // Drop one power tier on death
    if (State.powerLevel > 0) {
      State.powerLevel--;
      State.subPower = 0;
    } else {
      State.subPower = Math.max(0, State.subPower - 1);
    }
    this.flashText(this.player.x, this.player.y - 45, '-POWER', '#ff6600');
    this.drawPowerBar();

    // Dramatic hit feedback
    this.sound.play('sfx_hit', { volume: 0.7 });
    this.cameras.main.shake(280, 0.018);
    this.cameras.main.flash(180, 255, 30, 30);
    this.flashText(player.x, player.y - 30, '-1 LIFE', '#f00');

    // Big death explosion animation at the hit position
    const boom = this.add.sprite(player.x, player.y, 'pship_death').setDepth(15).setScale(1.2);
    boom.play('pdeath_anim');
    boom.once('animationcomplete', () => boom.destroy());
    this.tweens.add({
      targets: this.player, alpha: 0.15, duration: 80, yoyo: true, repeat: 14,
      onComplete: () => this.player.setAlpha(1)
    });

    if (this.lives <= 0) this.doGameOver();
  }

  collectPU(pu) {
    const type = pu.puType;
    const px = this.player.x, py = this.player.y;
    pu.destroy(); // safe — called from update, not from a physics callback

    if (type === 'power') {
      this.sound.play('sfx_powerup', { volume: 0.6 });
      // Per-stage power ceiling: stage 1 caps at level 1, stage 2 at level 3,
      // from stage 3 the full ladder is open — keeps early stages honest
      const cap = State.level === 1 ? 1 : State.level === 2 ? 3 : 4;
      if (State.powerLevel < cap) {
        State.subPower++;
        if (State.subPower >= 4) {
          State.subPower = 0;
          State.powerLevel = Math.min(State.powerLevel + 1, cap);
          this.flashText(px, py - 20, 'POWER UP!', '#ff0');
          this.cameras.main.flash(120, 255, 220, 0, false, null, null, 0.35);
        } else {
          this.flashText(px, py - 20, `PWR ${State.subPower}/4`, '#ffaa00');
        }
      } else {
        State.score += 500; // capped for this stage — convert to points
        this.flashText(px, py - 20, 'MAX +500', '#ff4400');
      }
    } else if (type === 'life') {
      this.lives = Math.min(this.lives + 1, 5);
      State.lives = this.lives;
      this.sound.play('sfx_powerup', { volume: 0.6 });
      this.flashText(px, py - 20, '1UP!', '#0f0');
    } else if (type === 'bomb') {
      this.sound.play('sfx_bomb', { volume: 0.8 });
      this.flashText(px, py - 20, 'BOMB!', '#0ff');
      this.cameras.main.flash(300, 100, 200, 255);
      this.enemyBullets.getChildren().forEach(b => b.setActive(false).setVisible(false));
      this.enemies.getChildren().slice().forEach(e => {
        if (!e.isBoss) { State.score += e.points || 100; this.spawnExplosion(e.x, e.y, 'small'); e.destroy(); }
        else { e.hp = Math.max(1, e.hp - 30); }
      });
      // Reset pending counter so the wave check re-evaluates immediately
      this.pendingSpawns = 0;
    }
    this.updateHUD();
  }

  // ── Level flow ────────────────────────────────────────────────────────────

  // Queue a spawn with precise tracking so the wave check never fires early
  queueSpawn(delay, fn) {
    this.pendingSpawns++;
    this.time.delayedCall(delay, () => {
      this.pendingSpawns = Math.max(0, this.pendingSpawns - 1);
      fn();
    });
  }

  spawnWave() {
    this.waveTimer = 0;

    const waves = this.levelDef.waves;

    if (this.waveIdx < waves.length) {
      waves[this.waveIdx++].call(null, this);
    } else if (!this.bossTriggered) {
      this.bossTriggered = true;
      this.showBanner('⚠ BOSS INCOMING', '#f8f', () => {
        this.levelDef.boss(this);
      });
    }
  }

  levelComplete() {
    this.bossActive = false;
    this.bossHPBar.clear();
    this.bossHPLabel.setText('');
    State.score += State.level * 1000; // level bonus

    const isVictory = State.level >= LEVELS.length;

    // A quick celebratory "NICE!" punch-in first, then the usual
    // STAGE CLEAR / VICTORY banner, then count down 5→0 before moving on
    this.showNiceBanner(() => this.showStageClearBanner(isVictory));
  }

  showStageClearBanner(isVictory) {
    this.showBanner(isVictory ? 'VICTORY!' : 'STAGE CLEAR!', isVictory ? '#ff0' : '#0f0', () => {
      let count = 5;
      const cd = this.add.text(W / 2, H / 2 + 30, `NEXT STAGE IN  ${count}`, {
        font: '14px monospace', fill: '#ffffff',
      }).setOrigin(0.5).setDepth(30);

      const tick = this.time.addEvent({
        delay: 1000, repeat: 4,
        callback: () => {
          count--;
          if (count > 0) {
            cd.setText(`NEXT STAGE IN  ${count}`);
          } else {
            cd.destroy();
            tick.remove();
            if (isVictory) {
              this.doGameOver(true);
            } else {
              State.level++;
              this.scene.restart();
            }
          }
        }
      });
    });
  }

  doGameOver(victory = false) {
    this.gameOver = true;
    playMusic(this, null);
    if (!victory) this.spawnExplosion(this.player.x, this.player.y, 'large');
    this.player.setVisible(false);

    this.time.delayedCall(700, () => {
      this.scene.start('GameOver', { victory });
    });
  }

  // ── HUD helpers ───────────────────────────────────────────────────────────

  updateHUD() {
    this.livesTxt.setText('♥'.repeat(Math.max(0, this.lives)));
    this.levelTxt.setText('LV ' + State.level);
    this.drawPowerBar();
  }

  drawPowerBar() {
    this.powerBar.clear();
    const x = 8, y = H - 18, w = 80, h = 6;
    const segW = w / 4;
    // Background
    this.powerBar.fillStyle(0x222233);
    this.powerBar.fillRect(x, y, w, h);
    // Filled tier segments
    for (let i = 0; i < State.powerLevel; i++) {
      this.powerBar.fillStyle(0xffcc00);
      this.powerBar.fillRect(x + i * segW + 1, y + 1, segW - 2, h - 2);
    }
    // Partial fill for current tier (sub-meter)
    if (State.powerLevel < 4 && State.subPower > 0) {
      this.powerBar.fillStyle(0xff8800);
      this.powerBar.fillRect(x + State.powerLevel * segW + 1, y + 1, (State.subPower / 4) * segW - 2, h - 2);
    }
    // Segment dividers
    this.powerBar.lineStyle(1, 0x556688);
    for (let i = 1; i < 4; i++) {
      this.powerBar.beginPath();
      this.powerBar.moveTo(x + i * segW, y);
      this.powerBar.lineTo(x + i * segW, y + h);
      this.powerBar.strokePath();
    }
    this.powerBar.lineStyle(1, 0x8888aa);
    this.powerBar.strokeRect(x, y, w, h);
  }

  showBossHUD(boss) {
    this.bossHPLabel.setText('BOSS');
    this.drawBossHP(boss);
  }

  drawBossHP(boss) {
    this.bossHPBar.clear();
    const x = 80, y = H - 18, w = W - 100, h = 6;
    this.bossHPBar.fillStyle(0x330011);
    this.bossHPBar.fillRect(x, y, w, h);
    this.bossHPBar.fillStyle(0xff2255);
    this.bossHPBar.fillRect(x, y, Math.max(0, (boss.hp / boss.maxHp)) * w, h);
    this.bossHPBar.lineStyle(1, 0x8888aa);
    this.bossHPBar.strokeRect(x, y, w, h);
  }

  updateMuteLabel() {
    if (this.muteTxt) this.muteTxt.setText(this.sound.mute ? '🔇 M' : '');
  }

  // Quick celebratory punch-in shown right as a stage is cleared, before the
  // STAGE CLEAR / VICTORY banner — a small extra beat of reward for the kill
  showNiceBanner(cb) {
    const cx = W / 2, cy = H / 2 - 70;
    this.sound.play('sfx_powerup', { volume: 0.7, rate: 1.15 });
    this.cameras.main.flash(160, 255, 255, 200, false, null, null, 0.25);

    // Sparkle burst radiating out from the text
    for (let i = 0; i < 14; i++) {
      const ang = (Math.PI * 2 / 14) * i;
      const p = this.add.image(cx, cy, 'particle').setDepth(30)
        .setTint(Phaser.Utils.Array.GetRandom([0x00ff88, 0xffff00, 0xff66ff, 0xffffff])).setScale(1.3);
      this.tweens.add({
        targets: p, x: cx + Math.cos(ang) * 100, y: cy + Math.sin(ang) * 100,
        alpha: 0, scale: 0, duration: 650, ease: 'Cubic.easeOut', onComplete: () => p.destroy()
      });
    }

    const t = this.add.text(cx, cy, 'NICE!', {
      font: 'bold 48px monospace', fill: '#00ff88', stroke: '#003322', strokeThickness: 8,
    }).setOrigin(0.5).setDepth(31).setScale(0.2).setAlpha(0);

    this.tweens.add({
      targets: t, scale: 1, alpha: 1, duration: 260, ease: 'Back.easeOut',
      onComplete: () => {
        this.tweens.add({
          targets: t, scale: 1.12, duration: 220, yoyo: true, ease: 'Sine.easeInOut',
          onComplete: () => {
            this.time.delayedCall(300, () => {
              this.tweens.add({
                targets: t, alpha: 0, y: cy - 20, duration: 250,
                onComplete: () => { t.destroy(); if (cb) cb(); }
              });
            });
          }
        });
      }
    });
  }

  showBanner(text, color, cb) {
    const t = this.add.text(W/2, H/2, text, { font:'28px monospace', fill: color })
      .setOrigin(0.5).setDepth(30).setAlpha(0);
    this.tweens.add({ targets: t, alpha: 1, duration: 300, yoyo: false, onComplete: () => {
      this.time.delayedCall(1200, () => {
        this.tweens.add({ targets: t, alpha: 0, duration: 300, onComplete: () => { t.destroy(); if (cb) cb(); }});
      });
    }});
  }

  flashText(x, y, msg, color) {
    const t = this.add.text(x, y, msg, { font:'12px monospace', fill: color }).setOrigin(0.5).setDepth(25);
    this.tweens.add({ targets: t, y: y - 30, alpha: 0, duration: 700, onComplete: () => t.destroy() });
  }

  // ── Explosions ────────────────────────────────────────────────────────────

  // Plays an explosion strip once, offset+delayed, then cleans up
  playExpAnim(x, y, anim, scale, delay = 0, depth = 12) {
    this.time.delayedCall(delay, () => {
      const s = this.add.sprite(x, y, 'exp_top').setDepth(depth).setScale(scale);
      s.play(anim);
      s.once('animationcomplete', () => s.destroy());
    });
  }

  spawnExplosion(x, y, size) {
    // Layered anim explosions — pack author's tip: a few dark ones offset
    // in different directions with one brighter on top
    if (size === 'small') {
      this.playExpAnim(x, y, 'exp_top_anim', 1);
    } else if (size === 'medium') {
      for (let i = 0; i < 2; i++)
        this.playExpAnim(x + Phaser.Math.Between(-14, 14), y + Phaser.Math.Between(-14, 14), 'exp_back_anim', 1.3, i * 70);
      this.playExpAnim(x, y, 'exp_top_anim', 1.3, 90, 13);
    } else {
      this.playExpAnim(x, y, 'exp_wave_anim', 1.5, 0, 11);
      for (let i = 0; i < 3; i++)
        this.playExpAnim(x + Phaser.Math.Between(-26, 26), y + Phaser.Math.Between(-26, 26), 'exp_mid_anim',
          Phaser.Math.FloatBetween(1.0, 1.5), i * 90, 12);
      this.playExpAnim(x, y, 'exp_top_anim', 1.8, 140, 13);
    }
    // Spark particles as garnish on top of the anims
    const count = size === 'large' ? 14 : size === 'medium' ? 8 : 5;
    const maxSpd = size === 'large' ? 220 : size === 'medium' ? 140 : 90;
    for (let i = 0; i < count; i++) {
      const ang  = Math.random() * Math.PI * 2;
      const spd  = Phaser.Math.Between(20, maxSpd);
      const p    = this.add.image(x, y, 'particle').setDepth(12).setScale(Phaser.Math.FloatBetween(0.4, size === 'large' ? 2 : 1.2));
      p.setTint(Phaser.Utils.Array.GetRandom([0xff6600, 0xffaa00, 0xffff00, 0xffffff, 0xff3300]));
      this.tweens.add({
        targets: p, x: x + Math.cos(ang) * spd, y: y + Math.sin(ang) * spd,
        alpha: 0, scaleX: 0, scaleY: 0,
        duration: Phaser.Math.Between(180, size === 'large' ? 600 : 380),
        onComplete: () => p.destroy()
      });
    }
    if (size === 'large') this.cameras.main.shake(200, 0.012);
  }
}

// ── Game Over / Victory ───────────────────────────────────────────────────────
class GameOverScene extends Phaser.Scene {
  constructor() { super('GameOver'); }

  create(data) {
    addMenuBackground(this);

    const victory = data && data.victory;
    this.add.text(W/2, 120, victory ? 'MISSION COMPLETE' : 'GAME OVER',
      { font:'28px monospace', fill: victory ? '#ff0' : '#f00', stroke:'#000', strokeThickness:4 }).setOrigin(0.5).setDepth(5);
    this.add.text(W/2, 170, 'SCORE ' + State.score,
      { font:'20px monospace', fill:'#fff' }).setOrigin(0.5).setDepth(5);
    this.add.text(W/2, 200, 'LEVEL ' + State.level,
      { font:'14px monospace', fill:'#aaa' }).setOrigin(0.5).setDepth(5);

    // Name entry — 3 separate letter slots at known pixel positions
    this.add.text(W/2, 260, 'ENTER NAME (3 CHARS)', { font:'12px monospace', fill:'#888' }).setOrigin(0.5).setDepth(5);
    this.nameChars  = ['A', 'A', 'A'];
    this.nameCursor = 0;

    const SLOT_W  = 32; // px between slots
    const SLOTS_X = [W/2 - SLOT_W, W/2, W/2 + SLOT_W];
    const LETTER_Y = 290;

    this.letterTxts = SLOTS_X.map((x, i) =>
      this.add.text(x, LETTER_Y, 'A', { font:'24px monospace', fill:'#fff' }).setOrigin(0.5, 0).setDepth(30)
    );
    // Cursor bar sits just below the letters
    this.cursorBar = this.add.rectangle(SLOTS_X[0], LETTER_Y + 30, SLOT_W - 4, 3, 0xffffff).setDepth(30);
    this.slotX = SLOTS_X;

    this.add.text(W/2, 360, '↑↓ CHANGE   ←→ MOVE   Z / (A) SAVE   F FULLSCREEN',
      { font:'10px monospace', fill:'#8090a5' }).setOrigin(0.5).setDepth(5);

    const cur = this.input.keyboard.createCursorKeys();
    const z   = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Z);

    cur.up.on('down',    () => this.bumpLetter(1));
    cur.down.on('down',  () => this.bumpLetter(25));
    cur.right.on('down', () => this.moveCursor(1));
    cur.left.on('down',  () => this.moveCursor(-1));
    z.on('down', () => this.saveName());

    addFullscreenKey(this);

    // Gamepad
    this.gamepad = null;
    this.input.gamepad.on('connected', pad => { this.gamepad = pad; });
    this._padCool = 0;
  }

  bumpLetter(delta) {
    this.nameChars[this.nameCursor] = String.fromCharCode((this.nameChars[this.nameCursor].charCodeAt(0) - 65 + delta) % 26 + 65);
    this.refreshName();
  }

  moveCursor(dir) {
    const next = this.nameCursor + dir;
    if (next >= 0 && next <= 2) { this.nameCursor = next; this.refreshName(); }
  }

  saveName() {
    State.saveScore(this.nameChars.join(''), State.score, State.level);
    this.scene.start('Highscore');
  }

  refreshName() {
    this.letterTxts.forEach((t, i) => {
      t.setText(this.nameChars[i]);
      t.setFill(i === this.nameCursor ? '#ff0' : '#fff');
    });
    this.cursorBar.setX(this.slotX[this.nameCursor]);
  }

  update(time, delta) {
    updateMenuBackground(this, delta);
    if (!this.gamepad && this.input.gamepad.total > 0) this.gamepad = this.input.gamepad.getPad(0);
    const pad = this.gamepad && this.gamepad.connected ? this.gamepad : null;
    if (!pad) return;
    if (!this._nav) this._nav = {};
    const up      = padNavStep(this._nav, 'up',    pad.up    || pad.leftStick.y < -0.5, delta, 450, 200);
    const down    = padNavStep(this._nav, 'down',  pad.down  || pad.leftStick.y >  0.5, delta, 450, 200);
    const left    = padNavStep(this._nav, 'left',  pad.left  || pad.leftStick.x < -0.5, delta, 450, 250);
    const right   = padNavStep(this._nav, 'right', pad.right || pad.leftStick.x >  0.5, delta, 450, 250);
    const confirm = padNavStep(this._nav, 'A',     pad.A || pad.start, delta); // edge only
    // First frame just records buttons still held from the run that just ended
    if (!this._navSeeded) { this._navSeeded = true; return; }
    if (up)    this.bumpLetter(1);
    if (down)  this.bumpLetter(25);
    if (left)  this.moveCursor(-1);
    if (right) this.moveCursor(1);
    if (confirm) this.saveName();
  }
}

// ── Highscore ─────────────────────────────────────────────────────────────────
class HighscoreScene extends Phaser.Scene {
  constructor() { super('Highscore'); }

  create() {
    playMusic(this, 'music_main', 0.55);
    addMenuBackground(this);
    addFullscreenKey(this);

    this.add.text(W/2, 48, 'HIGH SCORES', {
      font:'26px monospace', fill:'#ffd21e', stroke:'#7a5200', strokeThickness:4,
    }).setOrigin(0.5).setDepth(5);
    // Decorative underline to echo the title screen
    const gfx = this.add.graphics().setDepth(5);
    gfx.lineStyle(2, 0x00eeff, 0.7);
    gfx.beginPath(); gfx.moveTo(W*0.2, 72); gfx.lineTo(W*0.8, 72); gfx.strokePath();

    State.loadScores();
    const list = State.scores;

    // Framed panel behind the list for readability over the busy backdrop
    const panelTop = 92, rowH = 38;
    const rows = Math.max(list.length, 1);
    const panelH = rows * rowH + 24;
    this.add.rectangle(W/2, panelTop + panelH/2, W - 56, panelH, 0x0a0e22, 0.72)
      .setStrokeStyle(1, 0x2a4a8a, 0.9).setDepth(3);

    if (list.length === 0) {
      this.add.text(W/2, panelTop + panelH/2, 'NO SCORES YET', { font:'14px monospace', fill:'#667799' }).setOrigin(0.5).setDepth(5);
    } else {
      list.forEach((s, i) => {
        const y = panelTop + 20 + i * rowH;
        const col = i === 0 ? '#ffd21e' : i < 3 ? '#ffffff' : '#8fa3bb';
        // subtle highlight bar behind the top score
        if (i === 0) this.add.rectangle(W/2, y + 6, W - 72, 26, 0xffd21e, 0.08).setDepth(3.5);
        this.add.text(52,   y, `${i+1}.`, { font:'bold 14px monospace', fill:col }).setDepth(5);
        this.add.text(84,   y, s.name,    { font:'bold 14px monospace', fill:col }).setDepth(5);
        this.add.text(W/2 + 20, y, String(s.score).padStart(8, '0'), { font:'14px monospace', fill:col }).setOrigin(0.5, 0).setDepth(5);
        this.add.text(W-52, y, 'LV'+s.level, { font:'12px monospace', fill:'#66809a' }).setOrigin(1, 0).setDepth(5);
      });
    }

    this.add.text(W/2, H - 78, 'Local highscores only — beat your own best!', { font:'8px monospace', fill:'#556680' }).setOrigin(0.5).setDepth(6);

    // Framed PLAY AGAIN prompt, echoing the title screen's PRESS Z box
    const pzY = H - 52;
    this.add.rectangle(W/2, pzY, 260, 34, 0x001426, 0.55).setStrokeStyle(1, 0x33bbff, 0.7).setDepth(4);
    const prompt = this.add.text(W/2, pzY, 'Z / (A) — PLAY AGAIN', { font:'13px monospace', fill:'#ffffff' }).setOrigin(0.5).setDepth(5);
    this.tweens.add({ targets: prompt, alpha: 0.35, duration: 620, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    this.add.text(W/2, H - 30, 'F — FULLSCREEN', { font:'9px monospace', fill:'#556680' }).setOrigin(0.5).setDepth(6);
    addMenuFooter(this);

    this._replay = () => this.scene.start('ShipSelect');
    this.input.keyboard.once('keydown-Z', this._replay);
    // Ignore input briefly so the confirm press that opened this screen (keyboard
    // or gamepad) doesn't instantly skip it; then accept keyboard/pad/tap.
    this._armTime = 0;
    this.time.delayedCall(400, () => this.input.once('pointerdown', this._replay));
  }

  update(time, delta) {
    updateMenuBackground(this, delta);
    this._armTime += delta;
    if (this._armTime < 400) return;
    if (this.input.gamepad.total > 0) {
      const pad = this.input.gamepad.getPad(0);
      if (pad && (pad.A || pad.B || pad.X || pad.Y || pad.start)) this._replay();
    }
  }
}

// ─── Texture Generation ───────────────────────────────────────────────────────
function makeTextures(scene) {
  const g = scene.make.graphics({ x:0, y:0, add:false });

  // Player ships are now loaded from assets/Ships/ — no procedural generation needed

  // Hitbox
  g.clear(); g.fillStyle(0xffffff); g.fillCircle(4,4,2);
  g.generateTexture('hitbox', 8, 8);

  // Player bullet
  g.clear(); g.fillStyle(0x00ffff); g.fillRect(0,0,4,12); g.fillStyle(0xffffff); g.fillRect(1,0,2,4);
  g.generateTexture('bullet_p', 4, 12);

  // Laser bullet (invisible hitbox)
  g.clear(); g.fillStyle(0xffff00, 0.01); g.fillRect(0,0,6,6);
  g.generateTexture('laser_bullet', 6, 6);

  // Enemy bullet
  g.clear(); g.fillStyle(0xff3300); g.fillCircle(4,4,4); g.fillStyle(0xff9900,0.7); g.fillCircle(4,4,2);
  g.generateTexture('bullet_e', 8, 8);

  // Enemy ships are now loaded from assets/Ships/ — no procedural generation needed

  // Power-up: power (yellow diamond)
  g.clear(); g.fillStyle(0xffcc00);
  g.fillTriangle(12,2, 22,12, 12,22); g.fillTriangle(12,2, 2,12, 12,22);
  g.fillStyle(0xff8800); g.fillCircle(12,12,4);
  g.generateTexture('pu_power', 24, 24);

  // Power-up: life (green circle + cross)
  g.clear(); g.fillStyle(0x00ff88); g.fillCircle(12,12,10);
  g.fillStyle(0xffffff); g.fillRect(8,10,8,4); g.fillRect(10,8,4,8);
  g.generateTexture('pu_life', 24, 24);

  // Power-up: bomb (cyan circle + X)
  g.clear(); g.fillStyle(0x00ddff); g.fillCircle(12,12,10);
  g.fillStyle(0xffffff);
  g.fillRect(7,10,10,4);
  g.fillRect(10,7,4,10);
  g.generateTexture('pu_bomb', 24, 24);

  // Particle
  g.clear(); g.fillStyle(0xffffff); g.fillCircle(4,4,4);
  g.generateTexture('particle', 8, 8);

  // Thruster flame — layered teardrop pointing down (scaled/flickered at runtime)
  g.clear();
  g.fillStyle(0xff5500, 0.85); g.fillTriangle(0, 0, 12, 0, 6, 22);
  g.fillStyle(0xffaa00, 0.95); g.fillTriangle(2, 0, 10, 0, 6, 16);
  g.fillStyle(0xffee99, 1);    g.fillTriangle(4, 0, 8, 0, 6, 10);
  g.generateTexture('flame', 12, 22);

  // Stars
  makeStar(g, scene, 'stars1', 80, 1);
  makeStar(g, scene, 'stars2', 50, 1.5);
  makeStar(g, scene, 'stars3', 25, 2.5);

  g.destroy();
}

// Global animations from the new sprite strips — created once at boot
function makeAnims(scene) {
  const mk = (key, tex, end, fps, repeat = -1) =>
    scene.anims.create({ key, frames: scene.anims.generateFrameNumbers(tex, { start: 0, end }), frameRate: fps, repeat });

  // Bullets — pack author's tip: fast bullets get slow animation
  mk('ebullet_med_anim', 'ebullet_med', 17, 10);
  mk('ebullet_big_anim', 'ebullet_big', 5,  8);
  // Explosions (play once)
  mk('exp_back_anim', 'exp_back', 14, 22, 0);
  mk('exp_top_anim',  'exp_top',  15, 24, 0);
  mk('exp_mid_anim',  'exp_mid',  27, 30, 0);
  mk('exp_wave_anim', 'exp_wave', 9,  24, 0);
  mk('pdeath_anim',   'pship_death', 37, 28, 0);
  // Bosses
  mk('boss_space1_anim', 'boss_space1', 2, 6);
  scene.anims.create({ // pack note: "loop it in ping pong mode"
    key: 'boss_sub_anim',
    frames: scene.anims.generateFrameNumbers('boss_sub', { start: 0, end: 3 }),
    frameRate: 6, repeat: -1, yoyo: true
  });
  // Spinning power-up gems
  mk('gem_power_anim', 'gem_power', 8, 10);
  mk('gem_life_anim',  'gem_life',  8, 10);
  mk('gem_bomb_anim',  'gem_bomb',  8, 10);
  // Animated stage backgrounds (subtle twinkle/shimmer loops)
  mk('bg_space1_anim',     'bg_space1',     3, 5);
  mk('bg_space2_far_anim', 'bg_space2_far', 4, 5);
  mk('bg_seaice_anim',     'bg_seaice',     2, 4);
  mk('bg_nucleo2_anim',    'bg_nucleo2',    5, 6);
}

function makeStar(g, scene, key, count, size) {
  g.clear();
  for (let i = 0; i < count; i++) {
    g.fillStyle(0xffffff, Phaser.Math.FloatBetween(0.3, 1));
    g.fillRect(Phaser.Math.Between(0, W-1), Phaser.Math.Between(0, H-1), size, size);
  }
  g.generateTexture(key, W, H);
}

// ─── Phaser config ────────────────────────────────────────────────────────────
const config = {
  type: Phaser.AUTO,
  width: W,
  height: H,
  backgroundColor: '#000011',
  pixelArt: true,
  roundPixels: true,
  parent: 'game',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  input: {
    gamepad: true
  },
  physics: {
    default: 'arcade',
    arcade: { gravity: { y:0 }, debug: false }
  },
  scene: [BootScene, TitleScene, ShipSelectScene, GameScene, GameOverScene, HighscoreScene]
};

window.game = new Phaser.Game(config); // exposed for debugging
window.GameState = State;
window.GameLevels = LEVELS;
