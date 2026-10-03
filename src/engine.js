(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shooter = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const WIDTH = 405;
  const HEIGHT = 720;
  const STAGES = [
    { name: '星港外围', waves: 7, interval: 4.2, bossHp: 170 },
    { name: '碎星航道', waves: 8, interval: 4.0, bossHp: 260 },
    { name: '核心防线', waves: 9, interval: 3.8, bossHp: 350 }
  ];
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const collides = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 < (a.r + b.r) ** 2;

  class Game {
    constructor(options = {}) {
      if (options.onEvent !== undefined && typeof options.onEvent !== 'function') throw new TypeError('Game onEvent must be a function');
      this.onEvent = options.onEvent;
      this.bestScore = options.bestScore === undefined ? 0 : options.bestScore;
      if (!Number.isFinite(this.bestScore) || this.bestScore < 0) throw new TypeError('Game bestScore must be a non-negative number');
      this.seed = options.seed === undefined ? 73 : options.seed;
      if (!Number.isInteger(this.seed)) throw new TypeError('Game seed must be an integer');
      this.state = 'menu';
      this.resetRun();
    }

    emit(name, payload = {}) { if (this.onEvent) this.onEvent(name, payload); }
    setState(state) { this.state = state; this.emit('state', { state, stage: this.stage }); }
    random() {
      this.randomState = (Math.imul(this.randomState, 1664525) + 1013904223) >>> 0;
      return this.randomState / 4294967296;
    }
    resetRun() {
      this.randomState = this.seed >>> 0;
      this.id = 0;
      this.stage = 0;
      this.totalTime = 0;
      this.score = 0;
      this.kills = 0;
      this.fireInterval = 0.16;
      this.fireTimer = 0;
      this.shake = 0;
      this.damageFlash = 0;
      this.lastUpgrade = '';
      this.player = { x: WIDTH / 2, y: 596, r: 7, hp: 5, maxHp: 5, invincible: 0, weaponLevel: 1, shield: 0 };
      this.particles = [];
      this.upgradeOptions = [
        { id: 'spread', title: '扩散火力', description: '增加侧翼弹道 · 满级后提升伤害' },
        { id: 'rapid', title: '极速机炮', description: '射击速度提升 25%' },
        { id: 'repair', title: '装甲补给', description: '恢复 3 格装甲 · 上限增加 1 格' }
      ];
      this.damageBonus = 0;
      this.prepareStage();
    }
    prepareStage() {
      const stage = STAGES[this.stage];
      if (!stage) throw new Error('Unknown stage index: ' + this.stage);
      this.stageName = stage.name;
      this.stageTime = 0;
      this.wave = 0;
      this.waveCount = stage.waves;
      this.progress = 0;
      this.nextWave = 1.2;
      this.bossSpawned = false;
      this.enemies = [];
      this.playerBullets = [];
      this.enemyBullets = [];
      this.pickups = [];
      this.fireTimer = 0;
      this.player.x = WIDTH / 2;
      this.player.y = 596;
      this.player.invincible = 1.6;
      this.banner = '第 ' + (this.stage + 1) + ' 关 · ' + this.stageName;
      this.bannerTime = 2.4;
    }
    start() {
      this.resetRun();
      this.setState('playing');
      this.emit('stage', { stage: this.stage, name: this.stageName });
    }
    home() { this.resetRun(); this.setState('menu'); }
    pause() { if (this.state === 'playing') this.setState('paused'); }
    resume() { if (this.state === 'paused') this.setState('playing'); }
    moveBy(dx, dy) {
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new TypeError('Movement delta must be finite');
      if (this.state !== 'playing') return;
      this.player.x = clamp(this.player.x + dx, 21, WIDTH - 21);
      this.player.y = clamp(this.player.y + dy, 104, HEIGHT - 42);
    }
    chooseUpgrade(id) {
      if (this.state !== 'upgrade') throw new Error('Upgrade is only available after completing a stage');
      const upgrade = this.upgradeOptions.find(item => item.id === id);
      if (!upgrade) throw new Error('Unknown upgrade: ' + id);
      if (id === 'spread') {
        if (this.player.weaponLevel < 3) this.player.weaponLevel++;
        else this.damageBonus += 0.4;
      } else if (id === 'rapid') this.fireInterval *= 0.8;
      else {
        this.player.maxHp++;
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + 3);
      }
      this.lastUpgrade = upgrade.title;
      this.stage++;
      this.prepareStage();
      this.setState('playing');
      this.emit('upgrade', { id });
      this.emit('stage', { stage: this.stage, name: this.stageName });
    }

    update(dt) {
      if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Game update dt must be a finite non-negative number');
      if (dt > 0.25) throw new RangeError('Game update dt exceeds 250 ms; reset the platform frame clock on resume');
      if (this.state !== 'playing') return;
      let remaining = dt;
      while (remaining > 0.000001 && this.state === 'playing') {
        const step = Math.min(1 / 120, remaining);
        this.tick(step);
        remaining -= step;
      }
    }

    tick(dt) {
      const config = STAGES[this.stage];
      this.totalTime += dt;
      this.stageTime += dt;
      this.bannerTime = Math.max(0, this.bannerTime - dt);
      this.player.invincible = Math.max(0, this.player.invincible - dt);
      this.shake = Math.max(0, this.shake - dt * 30);
      this.damageFlash = Math.max(0, this.damageFlash - dt * 3);
      this.fireTimer -= dt;
      if (this.fireTimer <= 0) { this.shoot(); this.fireTimer += this.fireInterval; }

      if (this.wave < this.waveCount && this.stageTime >= this.nextWave) {
        this.spawnWave();
        this.wave++;
        this.nextWave += config.interval;
      }
      if (this.wave === this.waveCount && !this.bossSpawned && this.enemies.length === 0) this.spawnBoss();
      this.progress = this.bossSpawned ? 1 : clamp(this.wave / this.waveCount, 0, 1);

      for (const enemy of this.enemies) {
        enemy.t += dt;
        enemy.hit = Math.max(0, enemy.hit - dt);
        if (enemy.type === 'boss') {
          enemy.y = Math.min(160, enemy.y + 85 * dt);
          enemy.x = WIDTH / 2 + Math.sin(enemy.t * 0.64) * 114;
        } else {
          enemy.y += enemy.speed * dt;
          enemy.x = clamp(enemy.baseX + Math.sin(enemy.t * enemy.swayRate + enemy.phase) * enemy.sway, enemy.r, WIDTH - enemy.r);
        }
        enemy.fireTimer -= dt;
        if (enemy.fireTimer <= 0 && enemy.y > 62 && enemy.y < 530) {
          this.enemyShoot(enemy);
          enemy.fireTimer = enemy.type === 'boss' ? (enemy.hp < enemy.maxHp / 2 ? 0.76 : 1.12) : 2.2 - this.stage * 0.2;
        }
      }
      for (const bullet of this.playerBullets) { bullet.x += bullet.vx * dt; bullet.y += bullet.vy * dt; }
      for (const bullet of this.enemyBullets) { bullet.x += bullet.vx * dt; bullet.y += bullet.vy * dt; }
      for (const particle of this.particles) {
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.vx *= 1 - dt * 1.7;
        particle.vy *= 1 - dt * 1.7;
        particle.life -= dt;
      }
      for (const pickup of this.pickups) {
        pickup.t += dt;
        pickup.y += 68 * dt;
        const d = Math.hypot(pickup.x - this.player.x, pickup.y - this.player.y);
        if (d < 105 && d > 0) {
          pickup.x += (this.player.x - pickup.x) / d * 170 * dt;
          pickup.y += (this.player.y - pickup.y) / d * 170 * dt;
        }
        if (collides({ ...this.player, r: 19 }, pickup)) {
          pickup.collected = true;
          if (pickup.type === 'repair') this.player.hp = Math.min(this.player.maxHp, this.player.hp + 1);
          else if (this.player.weaponLevel < 3) this.player.weaponLevel++;
          else this.score += 150;
          this.burst(pickup.x, pickup.y, '#75ffe1', 12);
          this.emit('pickup', { type: pickup.type });
        }
      }

      for (const bullet of this.playerBullets) {
        if (bullet.dead) continue;
        for (const enemy of this.enemies) {
          if (enemy.hp <= 0 || !collides(bullet, enemy)) continue;
          bullet.dead = true;
          enemy.hp -= bullet.damage;
          enemy.hit = 0.07;
          this.burst(bullet.x, bullet.y, '#96fff2', 2, 0.15);
          this.emit('hit', { x: enemy.x, y: enemy.y });
          if (enemy.hp <= 0) {
            this.destroyEnemy(enemy);
            if (this.state !== 'playing') return;
          }
          break;
        }
      }
      for (const bullet of this.enemyBullets) {
        if (collides(bullet, this.player)) { bullet.dead = true; this.hurt(); }
        if (this.state !== 'playing') return;
      }
      for (const enemy of this.enemies) {
        if (enemy.hp > 0 && collides(enemy, this.player)) {
          this.hurt();
          if (this.state !== 'playing') return;
          if (enemy.type !== 'boss') { enemy.hp = 0; this.burst(enemy.x, enemy.y, '#ffbd6c', 15); }
        }
      }
      this.enemies = this.enemies.filter(e => e.hp > 0 && e.y < HEIGHT + 70);
      this.playerBullets = this.playerBullets.filter(b => !b.dead && b.y > -25 && b.x > -20 && b.x < WIDTH + 20);
      this.enemyBullets = this.enemyBullets.filter(b => !b.dead && b.y < HEIGHT + 25 && b.y > -60 && b.x > -25 && b.x < WIDTH + 25);
      this.particles = this.particles.filter(p => p.life > 0);
      this.pickups = this.pickups.filter(p => !p.collected && p.y < HEIGHT + 25);
    }

    shoot() {
      const player = this.player;
      const damage = 1 + this.damageBonus;
      for (const x of [-7, 7]) this.playerBullets.push({ x: player.x + x, y: player.y - 25, vx: 0, vy: -650, r: 4, damage });
      if (player.weaponLevel >= 2) {
        for (const side of [-1, 1]) this.playerBullets.push({ x: player.x + side * 17, y: player.y - 9, vx: side * 96, vy: -625, r: 3.5, damage: damage * 0.75 });
      }
      if (player.weaponLevel >= 3) this.playerBullets.push({ x: player.x, y: player.y - 33, vx: 0, vy: -740, r: 5, damage: damage * 1.3 });
      this.emit('shot', { x: player.x, y: player.y });
    }
    spawnWave() {
      const wave = this.wave;
      const count = wave % 3 === 2 ? 3 : 5;
      for (let i = 0; i < count; i++) {
        const type = wave % 3 === 2 ? (i === 1 ? 'tank' : 'striker') : ((wave + i + this.stage) % 4 === 3 ? 'striker' : 'scout');
        const x = 49 + i * ((WIDTH - 98) / (count - 1));
        const y = -40 - (wave % 2 === 0 ? Math.abs(i - (count - 1) / 2) * 35 : i * 30);
        const hp = (type === 'tank' ? 16 : type === 'striker' ? 7 : 3) + this.stage * (type === 'tank' ? 3 : 1);
        this.enemies.push({
          id: ++this.id, type, x, y, baseX: x, r: type === 'tank' ? 29 : type === 'striker' ? 22 : 17,
          hp, maxHp: hp, speed: (type === 'tank' ? 42 : type === 'striker' ? 62 : 87) + this.stage * 8,
          t: 0, hit: 0, phase: i * 0.7, sway: type === 'tank' ? 16 : 26, swayRate: 1.3,
          fireTimer: 1.7 + this.random() * 1.4
        });
      }
    }
    spawnBoss() {
      this.bossSpawned = true;
      const hp = STAGES[this.stage].bossHp;
      this.enemies.push({ id: ++this.id, type: 'boss', x: WIDTH / 2, y: -70, r: 56, hp, maxHp: hp, t: 0, hit: 0, fireTimer: 2.8, volley: 0 });
      this.banner = '警戒 · 重型指挥机接近';
      this.bannerTime = 2.3;
      this.enemyBullets = [];
      this.emit('stage', { stage: this.stage, boss: true });
    }
    enemyShoot(enemy) {
      const angle = Math.atan2(this.player.y - enemy.y, this.player.x - enemy.x);
      const speed = enemy.type === 'boss' ? 170 + this.stage * 14 : 143 + this.stage * 15;
      if (enemy.type === 'scout') {
        this.makeBullet(enemy.x, enemy.y + enemy.r, angle, speed, 5);
      } else if (enemy.type !== 'boss') {
        const spread = enemy.type === 'tank' ? [-0.26, 0, 0.26] : [-0.1, 0.1];
        for (const offset of spread) this.makeBullet(enemy.x, enemy.y + enemy.r, angle + offset, speed, 5.5);
      } else {
        enemy.volley++;
        const rage = enemy.hp < enemy.maxHp * 0.5;
        const count = rage ? 9 : 7;
        for (let i = 0; i < count; i++) this.makeBullet(enemy.x, enemy.y + 42, Math.PI / 2 + (i - (count - 1) / 2) * 0.19 + Math.sin(enemy.volley) * 0.12, speed, 6);
        if (enemy.volley % 2 === 0) for (const x of [-43, 43]) this.makeBullet(enemy.x + x, enemy.y + 22, angle, speed + 40, 5);
      }
    }
    makeBullet(x, y, angle, speed, r) { this.enemyBullets.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, r }); }
    burst(x, y, color, count, lifetime = 0.65) {
      for (let i = 0; i < count; i++) {
        const angle = this.random() * Math.PI * 2;
        const speed = 25 + this.random() * 145;
        const life = lifetime * (0.5 + this.random() * 0.5);
        this.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life, maxLife: life, r: 1.5 + this.random() * 3, color });
      }
    }
    destroyEnemy(enemy) {
      this.kills++;
      this.score += enemy.type === 'boss' ? 2000 * (this.stage + 1) : enemy.type === 'tank' ? 220 : enemy.type === 'striker' ? 140 : 80;
      this.shake = enemy.type === 'boss' ? 12 : enemy.type === 'tank' ? 4 : 1.6;
      this.burst(enemy.x, enemy.y, '#ffbd6c', enemy.type === 'boss' ? 70 : 18);
      this.emit('explosion', { x: enemy.x, y: enemy.y, boss: enemy.type === 'boss' });
      if (enemy.type === 'boss') {
        this.enemies = [];
        this.enemyBullets = [];
        this.playerBullets = [];
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + 1);
        if (this.stage === STAGES.length - 1) this.finish('victory');
        else this.setState('upgrade');
      } else if (this.kills % 5 === 0) {
        this.pickups.push({ x: enemy.x, y: enemy.y, r: 12, type: this.kills % 10 === 0 ? 'repair' : 'power', t: 0 });
      }
    }
    hurt() {
      if (this.player.invincible > 0) return;
      this.player.hp--;
      this.player.invincible = 1.5;
      this.damageFlash = 0.65;
      this.shake = 8;
      this.burst(this.player.x, this.player.y, '#9afbe1', 18);
      this.emit('hurt', { hp: this.player.hp });
      if (this.player.hp <= 0) this.finish('gameover');
    }
    finish(state) {
      this.bestScore = Math.max(this.bestScore, this.score);
      this.setState(state);
      this.emit(state, { score: this.score, stage: this.stage, kills: this.kills });
    }
  }
  return { Game, WIDTH, HEIGHT, STAGES };
});
