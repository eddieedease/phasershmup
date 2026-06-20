// DoDonClone — full featured shmup

const W = 480;
const H = 640;

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
    texture: 'ship_0000',
    fireRate: 90,
    fire(scene, px, py, lvl) {
      const spread = Math.min(lvl, 4);
      const angles = [];
      for (let i = 0; i <= spread; i++) angles.push(-spread * 8 + i * 16);
      angles.forEach(ang => spawnPlayerBullet(scene, px, py, ang - 90, 620));
    },
    laser(scene, px, py, dmg) { spawnLaser(scene, px, py, 0, dmg || 2); }
  },
  {
    name: 'THUNDERBOLT',
    desc: 'Fast · Side cannons + forward burst',
    color: 0xffaa00,
    speed: 310,
    focusSpeed: 140,
    texture: 'ship_0003',
    fireRate: 60,
    fire(scene, px, py, lvl) {
      spawnPlayerBullet(scene, px, py, -90, 700);
      if (lvl >= 1) { spawnPlayerBullet(scene, px - 8, py + 4, -90, 650); spawnPlayerBullet(scene, px + 8, py + 4, -90, 650); }
      if (lvl >= 2) { spawnPlayerBullet(scene, px - 16, py + 8, -80, 600); spawnPlayerBullet(scene, px + 16, py + 8, -100, 600); }
      if (lvl >= 3) { spawnPlayerBullet(scene, px - 22, py + 10, -75, 580); spawnPlayerBullet(scene, px + 22, py + 10, -105, 580); }
    },
    laser(scene, px, py, dmg) {
      spawnLaser(scene, px - 10, py, 0, dmg || 2);
      spawnLaser(scene, px + 10, py, 0, dmg || 2);
    }
  },
  {
    name: 'DEVASTATOR',
    desc: 'Heavy · Powerful slow spread',
    color: 0xff4466,
    speed: 180,
    focusSpeed: 80,
    texture: 'ship_0001',
    fireRate: 140,
    fire(scene, px, py, lvl) {
      const count = 3 + lvl * 2;
      for (let i = 0; i < count; i++) {
        const ang = -90 - (count - 1) * 10 + i * 20;
        const b = spawnPlayerBullet(scene, px, py, ang, 500);
        b.setScale(1.6);
        b.damage = 2;
      }
    },
    laser(scene, px, py, dmg) {
      spawnLaser(scene, px, py, 0, (dmg || 2) + 1);
      spawnLaser(scene, px - 12, py + 6, -5, dmg || 2);
      spawnLaser(scene, px + 12, py + 6, 5, dmg || 2);
    }
  }
];

// ─── Utility ──────────────────────────────────────────────────────────────────

function spawnPlayerBullet(scene, x, y, angleDeg, speed) {
  const rad = Phaser.Math.DegToRad(angleDeg);
  const b = scene.playerBullets.create(x, y, 'bullet_p');
  b.setDepth(8);
  b.damage = 1;
  b.setVelocity(Math.cos(rad) * speed, Math.sin(rad) * speed);
  b.body.allowGravity = false;
  return b;
}

function spawnLaser(scene, x, y, angleDeg, damage) {
  const rad = Phaser.Math.DegToRad(angleDeg - 90);
  const b = scene.laserGroup.create(x, y, 'laser_bullet');
  b.setDepth(8);
  b.damage = damage;
  b.setVelocity(Math.cos(rad) * 900, Math.sin(rad) * 900);
  b.body.allowGravity = false;
  return b;
}

function spawnEnemy(scene, x, y, cfg) {
  const e = scene.enemies.create(x, y, cfg.texture || 'ship_0012');
  e.setDepth(7);
  e.setFlipY(true);   // grey sprites face up by default; flip to face player
  e.setScale(cfg.scale || 1.5);
  e.hp      = cfg.hp     || 3;
  e.points  = cfg.points || 100;
  e.explodeSize = cfg.explodeSize || 'small';
  e.body.allowGravity = false;
  e.body.setSize(20, 20, true); // smaller than the 32×32 sprite for fair hitboxes
  e.setVelocity(cfg.vx || 0, cfg.vy || 60);
  if (cfg.tint) e.setTint(cfg.tint);
  if (cfg.scale) e.setScale(cfg.scale);

  if (cfg.pattern) {
    scene.time.addEvent({
      delay: cfg.patternDelay || 1200,
      startAt: cfg.firstDelay || 600,
      loop: true,
      callback: () => { if (e.active) cfg.pattern(scene, e); }
    });
  }
  if (cfg.move) cfg.move(scene, e);
  return e;
}

function fireBullet(scene, x, y, angle, speed, tint, scale) {
  const rad = Phaser.Math.DegToRad(angle);
  const b = scene.enemyBullets.create(x, y, 'bullet_e');
  b.setDepth(6);
  b.setTint(tint || 0xff3300);
  if (scale) b.setScale(scale);
  b.setVelocity(Math.cos(rad) * speed, Math.sin(rad) * speed);
  b.body.allowGravity = false;
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
    for (let i = 0; i < 3; i++) fireBullet(s, e.x, e.y, e._sa + i * 120, 170, 0xaa00ff);
  },
  vShape(s, e) {
    for (let i = 0; i < 5; i++) {
      fireBullet(s, e.x, e.y, 80 + i * 8, 210, 0x00aaff);
      fireBullet(s, e.x, e.y, 100 - i * 8, 210, 0x00aaff);
    }
  },
  crossAim(s, e) {
    aimAtPlayer(s, e, 200, 0, 1);
    fireBullet(s, e.x, e.y, 0, 160, 0xff8800);
    fireBullet(s, e.x, e.y, 90, 160, 0xff8800);
    fireBullet(s, e.x, e.y, 180, 160, 0xff8800);
    fireBullet(s, e.x, e.y, 270, 160, 0xff8800);
  }
};

// ─── Level definitions ────────────────────────────────────────────────────────
const LEVELS = [
  // LEVEL 1
  {
    title: 'SECTOR 1',
    bgTint: 0x000011,
    nebulaTint: null,
    overlayColor: 0x000033, overlayAlpha: 0,
    waves: [
      // 1 — intro trickle, slow aimed shots
      s => {
        for (let i = 0; i < 5; i++) s.queueSpawn(i * 380, () => {
          spawnEnemy(s, Phaser.Math.Between(60, W-60), -30, { hp:2, points:100, vy:75, pattern:P.aimed1, patternDelay:1800 });
        });
      },
      // 2 — pairs from sides
      s => {
        for (let i = 0; i < 4; i++) s.queueSpawn(i * 420, () => {
          spawnEnemy(s, 70,   -30, { hp:3, points:120, vx:30, vy:65, pattern:P.aimed1, patternDelay:1400 });
          spawnEnemy(s, W-70, -30, { hp:3, points:120, vx:-30, vy:65, pattern:P.aimed1, patternDelay:1400 });
        });
      },
      // 3 — diagonal sweep left-to-right
      s => {
        for (let i = 0; i < 6; i++) s.queueSpawn(i * 300, () => {
          spawnEnemy(s, 60 + i * 60, -30, { hp:2, points:110, vx:25, vy:80, pattern:P.aimed1, patternDelay:1500 });
        });
      },
      // 4 — first armoured ships with radial bursts
      s => {
        for (let i = 0; i < 3; i++) s.queueSpawn(i * 650, () => {
          spawnEnemy(s, 110 + i*130, -40, { texture:'ship_0015', hp:5, points:250, vy:48, pattern:P.radial8, patternDelay:1400 });
        });
      },
      // 5 — fast aimed trio + flankers
      s => {
        for (let i = 0; i < 5; i++) s.queueSpawn(i * 300, () => {
          spawnEnemy(s, Phaser.Math.Between(60, W-60), -30, { hp:3, points:150, vy:95, pattern:P.aimed3, patternDelay:1200 });
        });
        s.queueSpawn(800, () => {
          spawnEnemy(s, 60,   -30, { hp:4, points:180, vx:40, vy:60, pattern:P.aimed1, patternDelay:1100 });
          spawnEnemy(s, W-60, -30, { hp:4, points:180, vx:-40, vy:60, pattern:P.aimed1, patternDelay:1100 });
        });
      },
      // 6 — v-shape spread swarm
      s => {
        for (let i = 0; i < 7; i++) s.queueSpawn(i * 260, () => {
          spawnEnemy(s, Phaser.Math.Between(60, W-60), -30, { hp:3, points:140, vy:90, pattern:P.vShape, patternDelay:1200 });
        });
      },
      // 7 — side-weaving pairs + radial centre
      s => {
        for (let i = 0; i < 4; i++) s.queueSpawn(i * 450, () => {
          spawnEnemy(s, 60,   -30, { hp:3, points:130, vx:50, vy:70, pattern:P.aimed1, patternDelay:1100 });
          spawnEnemy(s, W-60, -30, { hp:3, points:130, vx:-50, vy:70, pattern:P.aimed1, patternDelay:1100 });
        });
        s.queueSpawn(600, () => {
          spawnEnemy(s, W/2, -40, { texture:'ship_0015', hp:6, points:300, vy:44, pattern:P.radial8, patternDelay:1300 });
        });
      },
      // 8 — miniboss warmup: two heavy ships
      s => {
        s.queueSpawn(0, () => {
          spawnEnemy(s, W*0.3, -50, { texture:'ship_0015', hp:8, points:400, vy:40, pattern:P.doubleRadial, patternDelay:1100 });
        });
        s.queueSpawn(600, () => {
          spawnEnemy(s, W*0.7, -50, { texture:'ship_0015', hp:8, points:400, vy:40, pattern:P.doubleRadial, patternDelay:1100 });
        });
      },
    ],
    boss: s => spawnBoss(s, {
      hp: 300, points: 5000,
      patterns: [P.doubleRadial, P.aimed3],
      patternDelay: 1000,
      move: 'sine'
    })
  },

  // LEVEL 2
  {
    title: 'NEBULA CROSS',
    bgTint: 0x000820,
    nebulaTint: 0x88bbff,
    overlayColor: 0x0044cc, overlayAlpha: 0.28,
    waves: [
      // 1 — fast aimed triple
      s => {
        for (let i = 0; i < 6; i++) s.queueSpawn(i * 280, () => {
          spawnEnemy(s, Phaser.Math.Between(60, W-60), -30, { hp:3, points:150, vy:90, pattern:P.aimed3, patternDelay:1200 });
        });
      },
      // 2 — v-shape flankers
      s => {
        for (let i = 0; i < 5; i++) s.queueSpawn(i * 320, () => {
          spawnEnemy(s, Phaser.Math.Between(60, W-60), -30, { hp:3, points:160, vy:80, pattern:P.vShape, patternDelay:1300 });
        });
      },
      // 3 — radial armoured column
      s => {
        for (let i = 0; i < 4; i++) s.queueSpawn(i * 520, () => {
          spawnEnemy(s, 80 + i*107, -30, { texture:'ship_0015', hp:6, points:300, vy:42, pattern:P.radial8, patternDelay:1200 });
        });
      },
      // 4 — cross-fire side pairs + aimed centre
      s => {
        for (let i = 0; i < 3; i++) s.queueSpawn(i * 500, () => {
          spawnEnemy(s, 70,   -30, { hp:4, points:180, vx:35, vy:70, pattern:P.aimed3, patternDelay:1100 });
          spawnEnemy(s, W-70, -30, { hp:4, points:180, vx:-35, vy:70, pattern:P.aimed3, patternDelay:1100 });
        });
        for (let i = 0; i < 4; i++) s.queueSpawn(200 + i * 350, () => {
          spawnEnemy(s, Phaser.Math.Between(100, W-100), -30, { hp:3, points:150, vy:85, pattern:P.aimed1, patternDelay:1000 });
        });
      },
      // 5 — spiral column
      s => {
        for (let i = 0; i < 3; i++) s.queueSpawn(i * 700, () => {
          spawnEnemy(s, 80 + i*160, -40, { texture:'ship_0015', hp:7, points:350, vy:35, pattern:P.spiral, patternDelay:220 });
        });
      },
      // 6 — dense swarm
      s => {
        for (let i = 0; i < 10; i++) s.queueSpawn(i * 180, () => {
          spawnEnemy(s, Phaser.Math.Between(60, W-60), -30, { hp:3, points:150, vy:100, pattern:P.aimed3, patternDelay:1100 });
        });
      },
      // 7 — double radial heavies + aimed chaff
      s => {
        for (let i = 0; i < 3; i++) s.queueSpawn(i * 600, () => {
          spawnEnemy(s, 100 + i*140, -45, { texture:'ship_0015', hp:9, points:450, vy:38, pattern:P.doubleRadial, patternDelay:1000 });
        });
        for (let i = 0; i < 4; i++) s.queueSpawn(300 + i * 300, () => {
          spawnEnemy(s, Phaser.Math.Between(60, W-60), -30, { hp:3, points:150, vy:90, pattern:P.aimed3, patternDelay:1100 });
        });
      },
      // 8 — crossfire wall
      s => {
        for (let i = 0; i < 5; i++) s.queueSpawn(i * 350, () => {
          spawnEnemy(s, 60,   -30, { texture:'ship_0015', hp:7, points:350, vx:40, vy:55, pattern:P.crossAim, patternDelay:1000 });
          spawnEnemy(s, W-60, -30, { texture:'ship_0015', hp:7, points:350, vx:-40, vy:55, pattern:P.crossAim, patternDelay:1000 });
        });
      },
      // 9 — spiral carpet + fast aimed
      s => {
        for (let i = 0; i < 4; i++) s.queueSpawn(i * 550, () => {
          spawnEnemy(s, 90 + i*100, -40, { texture:'ship_0015', hp:8, points:400, vy:36, pattern:P.spiral, patternDelay:200 });
        });
        for (let i = 0; i < 6; i++) s.queueSpawn(150 + i * 250, () => {
          spawnEnemy(s, Phaser.Math.Between(60, W-60), -30, { hp:3, points:150, vy:100, pattern:P.aimed3, patternDelay:1000 });
        });
      },
    ],
    boss: s => spawnBoss(s, {
      hp: 550, points: 9000,
      patterns: [P.radial12, P.aimed5, P.spiral],
      patternDelay: 900,
      move: 'figure8'
    })
  },

  // LEVEL 3
  {
    title: 'VOID GATE',
    bgTint: 0x100008,
    nebulaTint: 0xff6688,
    overlayColor: 0x880011, overlayAlpha: 0.32,
    waves: [
      // 1 — fast aimed swarm
      s => {
        for (let i = 0; i < 8; i++) s.queueSpawn(i * 220, () => {
          spawnEnemy(s, Phaser.Math.Between(60, W-60), -30, { hp:3, points:180, vy:100, pattern:P.aimed3, patternDelay:1000 });
        });
      },
      // 2 — side cross-aim pairs
      s => {
        for (let i = 0; i < 4; i++) s.queueSpawn(i * 420, () => {
          spawnEnemy(s, 70,   -30, { hp:4, points:220, vx:40, vy:65, pattern:P.crossAim, patternDelay:1100 });
          spawnEnemy(s, W-70, -30, { hp:4, points:220, vx:-40, vy:65, pattern:P.crossAim, patternDelay:1100 });
        });
      },
      // 3 — radial column + aimed flankers
      s => {
        for (let i = 0; i < 5; i++) s.queueSpawn(i * 380, () => {
          spawnEnemy(s, Phaser.Math.Between(60, W-60), -30, { hp:4, points:200, vy:75, pattern:P.radial8, patternDelay:1000 });
        });
      },
      // 4 — spiral heavies + chaff
      s => {
        for (let i = 0; i < 4; i++) s.queueSpawn(i * 550, () => {
          spawnEnemy(s, 80 + i*120, -40, { texture:'ship_0015', hp:8, points:400, vx:20*((i%2)*2-1), vy:55, pattern:P.spiral, patternDelay:200 });
        });
        for (let i = 0; i < 5; i++) s.queueSpawn(200 + i * 280, () => {
          spawnEnemy(s, Phaser.Math.Between(60, W-60), -30, { hp:3, points:180, vy:95, pattern:P.aimed3, patternDelay:950 });
        });
      },
      // 5 — cross-fire crosshatch
      s => {
        for (let i = 0; i < 4; i++) s.queueSpawn(i * 400, () => {
          spawnEnemy(s, 70,   -30, { texture:'ship_0015', hp:8, points:400, vx:40, vy:60, pattern:P.crossAim, patternDelay:1000 });
          spawnEnemy(s, W-70, -30, { texture:'ship_0015', hp:8, points:400, vx:-40, vy:60, pattern:P.crossAim, patternDelay:1000 });
        });
      },
      // 6 — dense aimed + centre radial-12
      s => {
        for (let i = 0; i < 7; i++) s.queueSpawn(i * 200, () => {
          spawnEnemy(s, Phaser.Math.Between(60, W-60), -30, { hp:4, points:200, vy:105, pattern:P.aimed5, patternDelay:950 });
        });
        s.queueSpawn(1000, () => {
          spawnEnemy(s, W/2, -50, { texture:'ship_0015', hp:14, points:700, vy:32, pattern:P.radial12, patternDelay:850 });
        });
      },
      // 7 — double radial heavies wall
      s => {
        for (let i = 0; i < 4; i++) s.queueSpawn(i * 500, () => {
          spawnEnemy(s, 70 + i*115, -45, { texture:'ship_0015', hp:10, points:500, vy:40, pattern:P.doubleRadial, patternDelay:900 });
        });
      },
      // 8 — everything at once
      s => {
        for (let i = 0; i < 6; i++) s.queueSpawn(i * 240, () => {
          spawnEnemy(s, Phaser.Math.Between(60, W-60), -30, { hp:4, points:200, vy:110, pattern:P.aimed5, patternDelay:900 });
        });
        for (let i = 0; i < 3; i++) s.queueSpawn(400 + i * 600, () => {
          spawnEnemy(s, 90 + i*150, -45, { texture:'ship_0015', hp:10, points:500, vy:40, pattern:P.crossAim, patternDelay:950 });
        });
      },
      // 9 — radial-16 wall
      s => {
        for (let i = 0; i < 5; i++) s.queueSpawn(i * 420, () => {
          spawnEnemy(s, 70 + i*85, -45, { texture:'ship_0015', hp:11, points:550, vy:38, pattern:P.radial16, patternDelay:850 });
        });
      },
      // 10 — absolute hell: aimed-5 swarm + double-radial heavies
      s => {
        for (let i = 0; i < 9; i++) s.queueSpawn(i * 170, () => {
          spawnEnemy(s, Phaser.Math.Between(60, W-60), -30, { hp:4, points:200, vy:115, pattern:P.aimed5, patternDelay:850 });
        });
        for (let i = 0; i < 3; i++) s.queueSpawn(800 + i * 500, () => {
          spawnEnemy(s, 100 + i*140, -50, { texture:'ship_0015', hp:12, points:600, vy:36, pattern:P.doubleRadial, patternDelay:800 });
        });
      },
    ],
    boss: s => spawnBoss(s, {
      hp: 900, points: 16000,
      patterns: [P.radial16, P.doubleRadial, P.aimed5, P.crossAim],
      patternDelay: 750,
      move: 'aggressive'
    })
  }
];

// ─── Boss spawner ─────────────────────────────────────────────────────────────
function spawnBoss(scene, cfg) {
  const boss = scene.enemies.create(W/2, -80, 'ship_0022');
  boss.setDepth(7).setScale(3.2).setFlipY(true);
  boss.hp      = cfg.hp;
  boss.maxHp   = cfg.hp;
  boss.points  = cfg.points;
  boss.explodeSize = 'large';
  boss.isBoss  = true;
  boss.invulnerable = true; // immune during entry
  boss.body.allowGravity = false;
  boss.setVelocityY(50);

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
    scene.tweens.add({ targets: boss, x: W-80, duration: 2200, ease:'Sine.easeInOut', yoyo:true, repeat:-1 });
  } else if (style === 'figure8') {
    scene.tweens.add({ targets: boss, x: W-80, y: 140, duration: 2000, ease:'Sine.easeInOut', yoyo:true, repeat:-1 });
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
  }
}

// ─── Power-up types ───────────────────────────────────────────────────────────
const POWERUP_TYPES       = ['power', 'power', 'power', 'power', 'bomb'];         // regular enemies
const POWERUP_TYPES_HEAVY = ['power', 'power', 'power', 'bomb',  'power', 'life']; // armoured/boss

function spawnPowerup(scene, x, heavy = false) {
  const pool = heavy ? POWERUP_TYPES_HEAVY : POWERUP_TYPES;
  const type = Phaser.Utils.Array.GetRandom(pool);
  const key = type === 'life' ? 'pu_life' : type === 'bomb' ? 'pu_bomb' : 'pu_power';
  // Drift in from the top at a random x, slow fall
  const spawnX = x !== undefined ? Phaser.Math.Clamp(x, 24, W - 24) : Phaser.Math.Between(24, W - 24);
  const pu = scene.powerups.create(spawnX, -16, key);
  pu.setDepth(9);
  pu.puType = type;
  pu.body.allowGravity = false;
  pu.setVelocityY(38);
  // Gentle bob layered on top of the slow drift
  scene.tweens.add({ targets: pu, x: spawnX + Phaser.Math.Between(-12, 12), duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  return pu;
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
    // Enemy ships — grey sprites
    ['0012','0015','0019','0022'].forEach(n =>
      this.load.image(`ship_${n}`, `assets/Ships/ship_${n}.png`)
    );
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
    State.loadScores();
    this.scene.start('Title');
  }
}

// ── Title Screen ──────────────────────────────────────────────────────────────
class TitleScene extends Phaser.Scene {
  constructor() { super('Title'); }

  create() {
    const W = this.scale.width, H = this.scale.height;
    playMusic(this, 'music_main', 0.55);

    // Scrolling star background
    this.bg = this.add.tileSprite(W/2, H/2, W, H, 'bg_stars').setDepth(0).setTileScale(1.6);
    this.add.tileSprite(W/2, H/2, W, H, 'bg_nebula').setDepth(1).setAlpha(0.5).setTileScale(1.6);

    // Decorative lines under the logo
    const gfx = this.add.graphics().setDepth(3);
    const lineY = H / 2 + 20;
    gfx.lineStyle(2, 0x00eeff, 0.7);
    gfx.beginPath(); gfx.moveTo(W*0.12, lineY); gfx.lineTo(W*0.88, lineY); gfx.strokePath();
    gfx.lineStyle(1, 0x00eeff, 0.2);
    gfx.beginPath(); gfx.moveTo(W*0.06, lineY + 5); gfx.lineTo(W*0.94, lineY + 5); gfx.strokePath();

    // "EA" in gold
    this.add.text(W/2, H/2 - 16, 'EA', {
      font: 'bold 72px monospace', fill: '#ffcc00',
      stroke: '#996600', strokeThickness: 5,
    }).setOrigin(1, 0.5).setDepth(4);

    // "ser" in white (directly right of EA — same baseline)
    this.add.text(W/2, H/2 - 16, 'ser', {
      font: 'bold 72px monospace', fill: '#ffffff',
      stroke: '#335566', strokeThickness: 3,
    }).setOrigin(0, 0.5).setDepth(4);

    // Subtitle tagline
    this.add.text(W/2, H/2 + 36, 'G A L A C T I C   A S S A U L T', {
      font: '8px monospace', fill: '#7799bb',
    }).setOrigin(0.5).setDepth(4);

    // Blinking PRESS Z prompt
    this.pressZ = this.add.text(W/2, H * 0.72, 'PRESS  Z  TO  START', {
      font: '13px monospace', fill: '#ffffff',
    }).setOrigin(0.5).setDepth(4);
    this.tweens.add({ targets: this.pressZ, alpha: 0, duration: 540, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    // Controls hint at bottom
    this.add.text(W/2, H - 18, 'Z SHOOT · X SLOW+LASER · M MUTE', {
      font: '7px monospace', fill: '#334455',
    }).setOrigin(0.5).setDepth(4);

    // Mute
    this.muteTxt = this.add.text(W - 8, 8, '', { font: '11px monospace', fill: '#888' })
      .setOrigin(1, 0).setDepth(5);
    this.input.keyboard.on('keydown-M', () => {
      this.sound.mute = !this.sound.mute;
      this.muteTxt.setText(this.sound.mute ? '🔇 M' : '');
    });

    // Fullscreen button
    const fsbg = this.add.rectangle(W/2, H * 0.86, 130, 22, 0x002233, 0.85).setDepth(4).setInteractive({ useHandCursor: true });
    const fstxt = this.add.text(W/2, H * 0.86, '⛶  FULLSCREEN', { font: '9px monospace', fill: '#44ccff' }).setOrigin(0.5).setDepth(5);
    const toggleFS = () => {
      if (this.scale.isFullscreen) this.scale.stopFullscreen();
      else this.scale.startFullscreen();
    };
    fsbg.on('pointerdown', toggleFS);
    fsbg.on('pointerover',  () => fstxt.setStyle({ fill: '#ffffff' }));
    fsbg.on('pointerout',   () => fstxt.setStyle({ fill: '#44ccff' }));
    this.input.keyboard.on('keydown-F', toggleFS);

    // Z → Ship Select with fade
    this.input.keyboard.once('keydown-Z', () => {
      this.cameras.main.fadeOut(220, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('ShipSelect'));
    });

    this.cameras.main.fadeIn(400, 0, 0, 0);
  }

  update() {
    this.bg.tilePositionY -= 0.6;
  }
}

// ── Ship Select ───────────────────────────────────────────────────────────────
class ShipSelectScene extends Phaser.Scene {
  constructor() { super('ShipSelect'); }

  create() {
    this.sel = State.ship || 0;
    playMusic(this, 'music_main');

    this.add.tileSprite(0, 0, W, H, 'bg_stars') .setOrigin(0,0).setDepth(0);
    this.add.tileSprite(0, 0, W, H, 'bg_nebula').setOrigin(0,0).setDepth(1).setAlpha(0.4);

    this.add.text(W/2, 52, 'SELECT YOUR SHIP', { font:'20px monospace', fill:'#fff' }).setOrigin(0.5).setDepth(5);

    // Control hint boxes
    const controls = [
      { key: '◀ ▶', label: 'MOVE' },
      { key: 'Z',   label: 'START / SHOOT' },
      { key: 'X',   label: 'SLOW + LASER' },
      { key: 'M',   label: 'MUTE' },
      { key: 'F',   label: 'FULLSCREEN' },
    ];
    const totalW = controls.length * 80 + (controls.length - 1) * 6;
    let cx = W / 2 - totalW / 2;
    const gy = this.add.graphics().setDepth(5);
    controls.forEach(c => {
      const bx = cx + 40;
      gy.fillStyle(0x0a0a1a, 1);
      gy.fillRoundedRect(cx, 74, 80, 32, 4);
      gy.lineStyle(1, 0x2244aa, 1);
      gy.strokeRoundedRect(cx, 74, 80, 32, 4);
      this.add.text(bx, 82, c.key,   { font: 'bold 9px monospace', fill: '#88ccff' }).setOrigin(0.5, 0).setDepth(6);
      this.add.text(bx, 93, c.label, { font: '7px monospace',      fill: '#556677' }).setOrigin(0.5, 0).setDepth(6);
      cx += 86;
    });
    this.muteLabel = this.add.text(W-8, 8, '', { font:'11px monospace', fill:'#888' }).setOrigin(1,0).setDepth(5);
    this.input.keyboard.on('keydown-M', () => {
      this.sound.mute = !this.sound.mute;
      this.muteLabel.setText(this.sound.mute ? '🔇 M' : '');
    });

    this.cards = SHIPS.map((ship, i) => this.makeCard(ship, i));
    this.highlight();

    this.input.keyboard.on('keydown-LEFT',  () => { this.sel = (this.sel + SHIPS.length - 1) % SHIPS.length; this.highlight(); });
    this.input.keyboard.on('keydown-RIGHT', () => { this.sel = (this.sel + 1) % SHIPS.length; this.highlight(); });
    this.input.keyboard.on('keydown-Z', () => {
      State.ship = this.sel;
      State.score = 0; State.level = 1; State.lives = 3; State.powerLevel = 0; State.subPower = 0;
      this.scene.start('Game');
    });
    this.input.keyboard.on('keydown-H', () => this.scene.start('Highscore'));

    this.add.text(W/2, H - 20, 'H — HIGHSCORES', { font:'11px monospace', fill:'#555' }).setOrigin(0.5).setDepth(5);
  }

  makeCard(ship, i) {
    const cx = 80 + i * 160;
    const cy = 320;
    const bg = this.add.rectangle(cx, cy, 130, 220, 0x111122).setDepth(3).setStrokeStyle(1, 0x334466);
    const sprite = this.add.image(cx, cy - 60, ship.texture).setDepth(4).setScale(2);
    const name = this.add.text(cx, cy + 20, ship.name, { font:'11px monospace', fill:'#fff' }).setOrigin(0.5).setDepth(4);
    const desc = this.add.text(cx, cy + 42, ship.desc, { font:'9px monospace', fill:'#aaa', wordWrap:{width:120} }).setOrigin(0.5).setDepth(4);
    return { bg, sprite, name, desc };
  }

  highlight() {
    SHIPS.forEach((_, i) => {
      const c = this.cards[i];
      const active = i === this.sel;
      c.bg.setFillStyle(active ? 0x1a1a44 : 0x111122);
      c.bg.setStrokeStyle(active ? 2 : 1, active ? 0x88aaff : 0x334466);
      c.sprite.setTint(active ? SHIPS[i].color : 0x666666);
      c.name.setFill(active ? '#fff' : '#666');
      c.desc.setFill(active ? '#ccc' : '#444');
    });
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
    const levelTrack = `music_level${Math.min(State.level, 3)}`;
    playMusic(this, levelTrack);
    this.ship      = SHIPS[State.ship];

    // Background — zoomed in (tileScale) so seams stay off-screen; Y-scroll only
    this.bgStars  = this.add.tileSprite(W/2, H/2, W, H, 'bg_stars')
      .setDepth(0).setTileScale(1.6);
    this.bgNebula = this.add.tileSprite(W/2, H/2, W, H, 'bg_nebula')
      .setDepth(1).setAlpha(0.6).setTileScale(1.6);
    if (this.levelDef.nebulaTint) this.bgNebula.setTint(this.levelDef.nebulaTint);
    // Fine star overlay
    this.stars3 = this.add.tileSprite(0, 0, W, H, 'stars3').setOrigin(0,0).setDepth(2);
    // Per-level colour wash — makes each level visually distinct
    if (this.levelDef.overlayAlpha > 0) {
      this.add.rectangle(0, 0, W, H, this.levelDef.overlayColor, this.levelDef.overlayAlpha)
        .setOrigin(0, 0).setDepth(2.5);
    }

    // Groups
    this.playerBullets = this.physics.add.group();
    this.laserGroup    = this.physics.add.group();
    this.enemies       = this.physics.add.group();
    this.enemyBullets  = this.physics.add.group();
    this.powerups      = this.physics.add.group();

    // Player
    this.player = this.physics.add.sprite(W/2, H - 80, this.ship.texture).setDepth(10).setScale(2);
    this.player.setCollideWorldBounds(true);
    this.player.body.setSize(4, 4, true);

    this.hitbox = this.add.image(W/2, H - 80, 'hitbox').setDepth(11).setAlpha(0);
    this.laserBeam = this.add.graphics().setDepth(9);

    // Input
    this.cursors  = this.input.keyboard.createCursorKeys();
    this.fireKey  = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Z);
    this.focusKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.X);
    this.input.keyboard.on('keydown-M', () => {
      this.sound.mute = !this.sound.mute;
      this.updateMuteLabel();
    });

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

    this.bgStars.tilePositionY  -= 0.25;
    this.bgNebula.tilePositionY -= 0.08;
    this.stars3.tilePositionY   -= 2.5;

    // Wave progression — guarded by wavesEnabled so the level banner
    // can't race with the first spawnWave call
    this.waveTimer += delta;
    if (this.wavesEnabled && !this.bossActive &&
        this.pendingSpawns === 0 &&
        this.enemies.countActive(true) === 0 && this.waveTimer > 1500) {
      this.spawnWave();
    }

    // Boss HP bar update
    if (this.bossActive) {
      const boss = this.enemies.getChildren().find(e => e.isBoss && e.active);
      if (boss) this.drawBossHP(boss);
      else { this.bossActive = false; this.bossHPBar.clear(); this.bossHPLabel.setText(''); }
    }

    this.scoreTxt.setText('SCORE ' + State.score);

    // Cleanup off-screen projectiles
    for (const b of this.playerBullets.getChildren())
      if (b.y < -20 || b.x < -20 || b.x > W+20) b.destroy();
    for (const b of this.laserGroup.getChildren())
      if (b.y < -20) b.destroy();
    for (const b of this.enemyBullets.getChildren())
      if (b.y > H+20 || b.x < -40 || b.x > W+40) b.destroy();
    for (const e of this.enemies.getChildren()) {
      if (e.y > H+80 || e.x < -100 || e.x > W+100) { e.destroy(); continue; }
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

    const focused = this.focusKey.isDown;
    const spd = focused ? this.ship.focusSpeed : this.ship.speed;
    const vx = (this.cursors.left.isDown ? -1 : this.cursors.right.isDown ? 1 : 0) * spd;
    const vy = (this.cursors.up.isDown   ? -1 : this.cursors.down.isDown  ? 1 : 0) * spd;
    this.player.setVelocity(vx, vy);

    this.hitbox.setPosition(this.player.x, this.player.y).setAlpha(focused ? 1 : 0);
    this.modeTxt.setText(focused ? 'FOCUS' : 'AUTO');

    // Shooting
    this.shotCooldown  = Math.max(0, this.shotCooldown - delta);
    this.laserCooldown = Math.max(0, this.laserCooldown - delta);
    this.laserBeam.clear();

    if (this.fireKey.isDown) {
      if (focused) { this.doLaser(); }
      else         { this.doShot();  }
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

    const px = this.player.x, py = this.player.y;
    const pl = State.powerLevel; // 0-4

    // Beam grows in 5 phases with power level
    const coreW  = 4  + pl * 3;          // 4 → 16 px
    const glowW  = 12 + pl * 6;          // 12 → 36 px
    const coreCol = pl >= 3 ? 0xff4400 : pl >= 2 ? 0xff8800 : 0xffdd00;
    const glowCol = pl >= 3 ? 0xff0000 : pl >= 2 ? 0xff4400 : 0xff8800;
    const damage  = 2 + Math.floor(pl / 2); // 2, 2, 3, 3, 4

    this.laserBeam.lineStyle(coreW, coreCol, 1);
    this.laserBeam.beginPath(); this.laserBeam.moveTo(px, py - 12); this.laserBeam.lineTo(px, 0); this.laserBeam.strokePath();
    this.laserBeam.lineStyle(glowW, glowCol, 0.3);
    this.laserBeam.beginPath(); this.laserBeam.moveTo(px, py - 12); this.laserBeam.lineTo(px, 0); this.laserBeam.strokePath();

    this.ship.laser(this, px, py, damage);
  }

  // ── Collisions ────────────────────────────────────────────────────────────

  hitEnemy(bullet, enemy) {
    if (enemy.invulnerable) { bullet.destroy(); return; }
    const dmg = bullet.damage || 1;
    enemy.hp -= dmg;
    bullet.destroy();

    if (enemy.hp <= 0) {
      State.score += enemy.points || 100;
      const ex = enemy.x, ey = enemy.y, sz = enemy.explodeSize || 'small';
      const wasBoss = enemy.isBoss;
      enemy.destroy();
      this.spawnExplosion(ex, ey, sz);
      if (wasBoss) {
        this.sound.play('sfx_bossdead', { volume: 0.9 });
        this.time.delayedCall(600, () => this.levelComplete());
      }
      // Chance to drop power-up
      const isHeavy = wasBoss || (enemy.texture && enemy.texture.key === 'ship_0015');
      if (Phaser.Math.Between(1, 100) <= (wasBoss ? 100 : isHeavy ? 40 : 15)) {
        spawnPowerup(this, ex, isHeavy);
      }
    } else {
      this.sound.play('sfx_enemyhit', { volume: 0.35 });
      // Kill stacked tweens & reset alpha before flashing — prevents boss getting stuck transparent
      this.tweens.killTweensOf(enemy);
      enemy.setAlpha(1);
      this.tweens.add({ targets: enemy, alpha: 0.35, duration: 45, yoyo: true });
    }
  }

  hitPlayer(obj, player) {
    if (this.invincible > 0) return;
    if (this.enemyBullets.contains(obj)) obj.destroy();
    this.lives--;
    State.lives = this.lives;
    this.livesTxt.setText('♥'.repeat(Math.max(0, this.lives)));
    this.invincible = 2500;

    // Dramatic hit feedback
    this.sound.play('sfx_hit', { volume: 0.7 });
    this.cameras.main.shake(280, 0.018);
    this.cameras.main.flash(180, 255, 30, 30);
    this.flashText(player.x, player.y - 30, '-1 LIFE', '#f00');

    // Red tint + rapid flash during invincibility
    // Red flash overlay (tint via sprite not available with custom renderCanvas)
    const flashRect = this.add.rectangle(player.x, player.y, 68, 68, 0xff2222, 0.65).setDepth(12);
    this.tweens.add({ targets: flashRect, alpha: 0, duration: 320, onComplete: () => flashRect.destroy() });
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
      if (State.powerLevel < 4) {
        State.subPower++;
        if (State.subPower >= 4) {
          State.subPower = 0;
          State.powerLevel = Math.min(State.powerLevel + 1, 4);
          this.flashText(px, py - 20, 'POWER UP!', '#ff0');
          this.cameras.main.flash(120, 255, 220, 0, false, null, null, 0.35);
        } else {
          this.flashText(px, py - 20, `PWR ${State.subPower}/4`, '#ffaa00');
        }
      } else {
        this.flashText(px, py - 20, 'MAX POWER', '#ff4400');
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
      this.enemyBullets.getChildren().slice().forEach(b => b.destroy());
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

    // Show STAGE CLEAR / VICTORY banner, then count down 5→0 before moving on
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

  spawnExplosion(x, y, size) {
    const count = size === 'large' ? 20 : size === 'medium' ? 12 : 7;
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
    this.add.tileSprite(0, 0, W, H, 'bg_stars') .setOrigin(0,0);
    this.add.tileSprite(0, 0, W, H, 'bg_nebula').setOrigin(0,0).setAlpha(0.4);

    const victory = data && data.victory;
    this.add.text(W/2, 120, victory ? 'MISSION COMPLETE' : 'GAME OVER',
      { font:'28px monospace', fill: victory ? '#ff0' : '#f00' }).setOrigin(0.5);
    this.add.text(W/2, 170, 'SCORE ' + State.score,
      { font:'20px monospace', fill:'#fff' }).setOrigin(0.5);
    this.add.text(W/2, 200, 'LEVEL ' + State.level,
      { font:'14px monospace', fill:'#aaa' }).setOrigin(0.5);

    // Name entry — 3 separate letter slots at known pixel positions
    this.add.text(W/2, 260, 'ENTER NAME (3 CHARS)', { font:'12px monospace', fill:'#888' }).setOrigin(0.5);
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

    this.add.text(W/2, 360, '↑↓ CHANGE  ←→ MOVE  Z SAVE',
      { font:'10px monospace', fill:'#666' }).setOrigin(0.5);

    const cur = this.input.keyboard.createCursorKeys();
    const z   = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Z);

    cur.up.on('down',    () => { this.nameChars[this.nameCursor] = String.fromCharCode((this.nameChars[this.nameCursor].charCodeAt(0) - 65 + 1)  % 26 + 65); this.refreshName(); });
    cur.down.on('down',  () => { this.nameChars[this.nameCursor] = String.fromCharCode((this.nameChars[this.nameCursor].charCodeAt(0) - 65 + 25) % 26 + 65); this.refreshName(); });
    cur.right.on('down', () => { if (this.nameCursor < 2) { this.nameCursor++; this.refreshName(); } });
    cur.left.on('down',  () => { if (this.nameCursor > 0) { this.nameCursor--; this.refreshName(); } });
    z.on('down', () => {
      State.saveScore(this.nameChars.join(''), State.score, State.level);
      this.scene.start('Highscore');
    });
  }

  refreshName() {
    this.letterTxts.forEach((t, i) => {
      t.setText(this.nameChars[i]);
      t.setFill(i === this.nameCursor ? '#ff0' : '#fff');
    });
    this.cursorBar.setX(this.slotX[this.nameCursor]);
  }
}

// ── Highscore ─────────────────────────────────────────────────────────────────
class HighscoreScene extends Phaser.Scene {
  constructor() { super('Highscore'); }

  create() {
    this.add.tileSprite(0, 0, W, H, 'bg_stars') .setOrigin(0,0);
    this.add.tileSprite(0, 0, W, H, 'bg_nebula').setOrigin(0,0).setAlpha(0.4);

    this.add.text(W/2, 50, 'HIGH SCORES', { font:'24px monospace', fill:'#ff0' }).setOrigin(0.5);

    State.loadScores();
    const list = State.scores;
    if (list.length === 0) {
      this.add.text(W/2, 200, 'NO SCORES YET', { font:'14px monospace', fill:'#555' }).setOrigin(0.5);
    } else {
      list.forEach((s, i) => {
        const y = 110 + i * 38;
        const col = i === 0 ? '#ff0' : i < 3 ? '#fff' : '#888';
        this.add.text(60,   y, `${i+1}.`, { font:'14px monospace', fill:col });
        this.add.text(90,   y, s.name,    { font:'14px monospace', fill:col });
        this.add.text(W/2,  y, String(s.score).padStart(8, '0'), { font:'14px monospace', fill:col }).setOrigin(0.5, 0);
        this.add.text(W-50, y, 'LV'+s.level, { font:'12px monospace', fill:'#666' }).setOrigin(1, 0);
      });
    }

    this.add.text(W/2, H - 56, '😢  Too bad! Local highscores only.', { font:'8px monospace', fill:'#445566' }).setOrigin(0.5);
    this.add.text(W/2, H - 40, 'Z — PLAY AGAIN', { font:'13px monospace', fill:'#aaa' }).setOrigin(0.5);
    this.input.keyboard.once('keydown-Z', () => this.scene.start('ShipSelect'));
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

  // Stars
  makeStar(g, scene, 'stars1', 80, 1);
  makeStar(g, scene, 'stars2', 50, 1.5);
  makeStar(g, scene, 'stars3', 25, 2.5);

  g.destroy();
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
  type: Phaser.CANVAS,
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
  physics: {
    default: 'arcade',
    arcade: { gravity: { y:0 }, debug: false }
  },
  scene: [BootScene, TitleScene, ShipSelectScene, GameScene, GameOverScene, HighscoreScene]
};

new Phaser.Game(config);
