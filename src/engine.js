(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shooter = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const WIDTH = 405;
  const HEIGHT = 720;
  const MAX_PARTICLES = 320;
  const MIN_FIRE_INTERVAL = 0.07;
  const CHAPTERS = Object.freeze([
    '星港边境', '碎星航道', '赤焰星云', '环星禁区', '幽蓝星河',
    '暗影星带', '恒星熔炉', '极光星域', '虚空裂隙', '核心决战'
  ]);
  // One hundred missions share bounded combat rules. Late missions change
  // formations and attacks without producing ever faster bullets or fire loops.
  const STAGES = Object.freeze(Array.from({ length: 100 }, (_, index) => {
    const chapter = Math.floor(index / 10);
    const mission = index % 10 + 1;
    const lateProgress = Math.max(0, index - 2) / 97;
    const earlyNames = ['星港外围', '碎星航道', '核心防线'];
    return Object.freeze({
      chapter, chapterName: CHAPTERS[chapter], mission,
      name: index < 3 ? earlyNames[index] : CHAPTERS[chapter] + ' · ' + String(mission).padStart(2, '0'),
      waves: index < 3 ? 7 + index : 7 + (chapter + mission - 1) % 4,
      interval: index < 3 ? 4.2 - index * 0.2 : 3.8 - lateProgress * 0.8,
      bossHp: index < 3 ? 170 + index * 90 : Math.round(350 + 55 * Math.sqrt(index - 2)),
      bossForm: index % 2 === 0 ? 'warship' : 'fighter',
      bossSkin: (chapter + Math.floor((mission - 1) / 2)) % 10,
      bossPattern: index < 3 ? 0 : (chapter + mission - 1) % 3,
      wavePattern: index < 3 ? 0 : index % 4,
      formation: index < 3 ? 0 : (chapter + mission - 1) % 3,
      hpBoost: index < 3 ? index : 2 + 10 * Math.sqrt(lateProgress),
      speedBoost: index < 3 ? index * 8 : 16 + 40 * lateProgress,
      bulletSpeedBoost: index < 3 ? index * 15 : 30 + 77 * lateProgress,
      fighterFireInterval: index < 3 ? 2.2 - index * 0.2 : 1.8 - 0.55 * lateProgress,
      warshipFireInterval: 2.7 - 0.5 * lateProgress,
      planetFireInterval: Math.max(3.2, 3.8 - 0.6 * lateProgress),
      bossFireInterval: 1.12 - 0.2 * lateProgress,
      bossRageInterval: 0.76 - 0.08 * lateProgress
    });
  }));
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const collides = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 < (a.r + b.r) ** 2;
  const experienceForLevel = level => 20 * (level - 1) ** 2 + 40 * (level - 1);
  const MODELS = [
    { level: 1, title: '游隼' }, { level: 3, title: '破晓' },
    { level: 6, title: '雷霆' }, { level: 10, title: '星曜' }
  ];
  function progressionFor(totalXp) {
    const level = Math.floor(Math.sqrt(1 + totalXp / 20));
    const modelIndex = MODELS.reduce((found, model, i) => level >= model.level ? i : found, 0);
    return { totalXp, level, xp: totalXp - experienceForLevel(level),
      nextXp: experienceForLevel(level + 1) - experienceForLevel(level),
      tier: modelIndex + 1, title: MODELS[modelIndex].title };
  }

  function exactKeys(value, keys, context) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length !== keys.length || !keys.every(key => Object.prototype.hasOwnProperty.call(value, key))) {
      throw new TypeError('Invalid ' + context + ': expected fields ' + keys.join(', '));
    }
  }
  // Shared by the clients and service so saved combat rules cannot drift.
  function validateCheckpoint(value) {
    if (value === null) return null;
    exactKeys(value, ['version', 'phase', 'stage', 'seed', 'randomState', 'entityId', 'totalTime', 'score', 'kills', 'runStartXp', 'totalXp', 'player', 'fireInterval', 'damageBonus', 'freeCharges'], 'checkpoint');
    exactKeys(value.player, ['hp', 'maxHp', 'weaponLevel'], 'checkpoint player');
    exactKeys(value.freeCharges, ['bomb', 'support'], 'checkpoint freeCharges');
    if (value.version !== 2 || !['stage', 'upgrade'].includes(value.phase)
      || !Number.isInteger(value.stage) || value.stage < 0 || value.stage >= STAGES.length
      || (value.phase === 'upgrade' && value.stage === STAGES.length - 1)) throw new RangeError('Invalid checkpoint version, phase or stage');
    for (const field of ['seed', 'randomState']) {
      if (!Number.isInteger(value[field]) || value[field] < 0 || value[field] > 0xffffffff) throw new RangeError('Invalid checkpoint ' + field + ': expected uint32');
    }
    for (const field of ['entityId', 'score', 'kills', 'runStartXp', 'totalXp']) {
      if (!Number.isSafeInteger(value[field]) || value[field] < 0) throw new RangeError('Invalid checkpoint ' + field + ': expected non-negative safe integer');
    }
    if (value.runStartXp !== 0) throw new RangeError('Invalid checkpoint experience baseline: roguelike runs start at zero');
    if (!Number.isFinite(value.totalTime) || value.totalTime < 0 || value.totalTime > 1e9) throw new RangeError('Invalid checkpoint totalTime');
    if (!Number.isSafeInteger(value.player.hp) || !Number.isSafeInteger(value.player.maxHp)
      || value.player.hp < 1 || value.player.maxHp < value.player.hp
      || !Number.isInteger(value.player.weaponLevel) || value.player.weaponLevel < 1 || value.player.weaponLevel > 3) throw new RangeError('Invalid checkpoint player stats');
    if (!Number.isFinite(value.fireInterval) || value.fireInterval < MIN_FIRE_INTERVAL || value.fireInterval > 0.16
      || !Number.isFinite(value.damageBonus) || value.damageBonus < 0 || value.damageBonus > 40) throw new RangeError('Invalid checkpoint weapon stats');
    for (const item of ['bomb', 'support']) {
      if (![0, 1].includes(value.freeCharges[item])) throw new RangeError('Invalid checkpoint free charge: ' + item);
    }
    return { version: 2, phase: value.phase, stage: value.stage, seed: value.seed, randomState: value.randomState,
      entityId: value.entityId, totalTime: value.totalTime, score: value.score, kills: value.kills, runStartXp: value.runStartXp, totalXp: value.totalXp,
      player: { ...value.player }, fireInterval: value.fireInterval, damageBonus: value.damageBonus, freeCharges: { ...value.freeCharges } };
  }

  class Game {
    constructor(options = {}) {
      if (options.onEvent !== undefined && typeof options.onEvent !== 'function') throw new TypeError('Game onEvent must be a function');
      this.onEvent = options.onEvent;
      this.bestScore = options.bestScore === undefined ? 0 : options.bestScore;
      if (!Number.isFinite(this.bestScore) || this.bestScore < 0) throw new TypeError('Game bestScore must be a non-negative number');
      this.seed = options.seed === undefined ? 73 : options.seed;
      if (!Number.isInteger(this.seed)) throw new TypeError('Game seed must be an integer');
      const profile = options.profile === undefined ? { version: 2, totalXp: 0 } : options.profile;
      if (!profile || profile.version !== 2 || !Number.isSafeInteger(profile.totalXp) || profile.totalXp < 0) throw new TypeError('Invalid game profile: expected version 2 and non-negative safe integer totalXp');
      const checkpoint = validateCheckpoint(options.checkpoint === undefined ? null : options.checkpoint);
      if (checkpoint && checkpoint.totalXp > profile.totalXp) throw new RangeError('Checkpoint experience exceeds the player profile');
      // Experience belongs to a surviving run. An orphaned profile must never
      // equip a new pilot or revive an old run when there is no continuation.
      this.profile = { version: 2, totalXp: checkpoint ? checkpoint.totalXp : 0 };
      this.stageCount = STAGES.length;
      this.minFireInterval = MIN_FIRE_INTERVAL;
      this.progression = progressionFor(this.profile.totalXp);
      this._savedCheckpoint = null;
      this.inventory = Object.freeze({ bomb: 0, support: 0 });
      this.state = 'menu';
      this.resetRun();
      this.storeCheckpoint(checkpoint, false);
    }

    emit(name, payload = {}) { if (this.onEvent) this.onEvent(name, payload); }
    getProfile() { return { ...this.profile }; }
    get savedCheckpoint() { return this._savedCheckpoint; }
    getCheckpoint() { return validateCheckpoint(this._savedCheckpoint); }
    storeCheckpoint(value, emit) {
      const checkpoint = validateCheckpoint(value);
      if (checkpoint) { Object.freeze(checkpoint.player); Object.freeze(checkpoint.freeCharges); Object.freeze(checkpoint); }
      this._savedCheckpoint = checkpoint;
      if (emit) this.emit('checkpoint', { checkpoint: this.getCheckpoint() });
    }
    setSavedCheckpoint(value) {
      if (!['menu', 'gameover', 'victory'].includes(this.state)) throw new Error('Cannot replace a checkpoint during an active run');
      const checkpoint = validateCheckpoint(value);
      if (checkpoint && this.state !== 'menu') throw new Error('A finished run cannot receive a continuation without verified revival');
      this.storeCheckpoint(checkpoint, false);
      this.setRunExperience(checkpoint ? checkpoint.totalXp : 0);
      this.resetRun();
    }
    captureCheckpoint(phase = 'stage', emit = true) {
      this.storeCheckpoint({ version: 2, phase, stage: this.stage, seed: this.seed >>> 0, randomState: this.randomState,
        entityId: this.id, totalTime: this.totalTime, score: this.score, kills: this.kills, runStartXp: this.runStartXp, totalXp: this.profile.totalXp,
        player: { hp: this.player.hp, maxHp: this.player.maxHp, weaponLevel: this.player.weaponLevel },
        fireInterval: this.fireInterval, damageBonus: this.damageBonus,
        freeCharges: { bomb: this.bombCharges, support: this.supportCharges } }, emit);
    }
    updateCheckpointCharges() {
      if (!this._savedCheckpoint || this._savedCheckpoint.phase !== 'stage') throw new Error('No stage checkpoint for ability consumption');
      this.storeCheckpoint({ ...this._savedCheckpoint, freeCharges: { bomb: this.bombCharges, support: this.supportCharges } }, true);
    }
    setInventory(value) {
      exactKeys(value, ['bomb', 'support'], 'inventory');
      for (const item of ['bomb', 'support']) {
        if (!Number.isSafeInteger(value[item]) || value[item] < 0) throw new RangeError('Invalid inventory balance: ' + item);
      }
      this.inventory = Object.freeze({ ...value });
    }
    abilityAvailable(type, source) {
      if (!['free', 'inventory'].includes(source)) throw new RangeError('Unknown ability source: ' + source);
      if (this.state !== 'playing') return false;
      return source === 'free' ? this[type + 'Charges'] > 0 : this.inventory[type] > 0;
    }
    consumeAbility(type, source) {
      if (source === 'free') { this[type + 'Charges']--; this.updateCheckpointCharges(); }
      else this.setInventory({ ...this.inventory, [type]: this.inventory[type] - 1 });
    }
    continueRun() {
      if (this.state !== 'menu' || !this._savedCheckpoint) return false;
      const checkpoint = this.getCheckpoint();
      this.setRunExperience(checkpoint.totalXp);
      this.resetRun();
      this.seed = checkpoint.seed;
      this.randomState = checkpoint.randomState;
      this.id = checkpoint.entityId;
      this.stage = checkpoint.stage;
      this.totalTime = checkpoint.totalTime;
      this.score = checkpoint.score;
      this.kills = checkpoint.kills;
      this.runStartXp = checkpoint.runStartXp;
      Object.assign(this.player, checkpoint.player);
      this.fireInterval = checkpoint.fireInterval;
      this.damageBonus = checkpoint.damageBonus;
      if (this.fireInterval === MIN_FIRE_INTERVAL) this.upgradeOptions.find(option => option.id === 'rapid').description = '射速已达上限 · 单发伤害 +0.4';
      this.prepareStage();
      this.supportCharges = checkpoint.freeCharges.support;
      this.bombCharges = checkpoint.freeCharges.bomb;
      this.emit('progression', this.getProfile());
      this.storeCheckpoint(checkpoint, true);
      if (checkpoint.phase === 'upgrade') { this.bossSpawned = true; this.progress = 1; this.setState('upgrade'); }
      else { this.setState('launching'); this.emit('cinematic', { phase: 'launch', stage: this.stage }); }
      return true;
    }
    restoreCheckpoint(value) { this.setSavedCheckpoint(value); return this.continueRun(); }
    setRunExperience(totalXp) {
      this.profile = { version: 2, totalXp };
      this.progression = progressionFor(totalXp);
    }
    clearRunGrowth() {
      this.setRunExperience(0);
      this.player.shipLevel = 1;
      this.player.tier = 1;
      this.player.maxHp = 5;
      this.player.weaponLevel = 1;
      this.fireInterval = 0.16;
      this.damageBonus = 0;
      this.levelUpTime = 0;
    }
    addExperience(amount) {
      if (!Number.isSafeInteger(amount) || amount <= 0 || !Number.isSafeInteger(this.profile.totalXp + amount)) throw new RangeError('Experience amount and total must be positive safe integers');
      const previousLevel = this.progression.level;
      this.profile.totalXp += amount;
      this.progression = progressionFor(this.profile.totalXp);
      const { level, tier } = this.progression;
      this.player.shipLevel = level;
      this.player.tier = tier;
      if (level > previousLevel) {
        this.player.maxHp += Math.floor((level - 1) / 5) - Math.floor((previousLevel - 1) / 5);
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + 1);
        this.levelUpTime = 2.3;
        this.burst(this.player.x, this.player.y, '#8cdbff', 22);
        this.emit('levelup', { previousLevel, level, tier, title: this.progression.title });
      }
      this.emit('progression', this.getProfile());
    }
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
      this.levelUpTime = 0;
      this.bossWarningDuration = 2.4;
      this.launchDuration = 3.2;
      this.ejectionDuration = 2.6;
      this.supportDuration = 8;
      this.bombDuration = 0.9;
      this.cinematicTime = 0;
      this.pausedFrom = null;
      this.runStartXp = 0;
      this.resultProgression = null;
      const maxHp = 5 + Math.floor((this.progression.level - 1) / 5);
      this.player = { x: WIDTH / 2, y: 596, r: 7, hp: maxHp, maxHp, invincible: 0, weaponLevel: 1, shield: 0,
        shipLevel: this.progression.level, tier: this.progression.tier };
      this.particles = [];
      this.upgradeOptions = [
        { id: 'spread', title: '扩散火力', description: '增加侧翼弹道 · 满级后提升伤害' },
        { id: 'rapid', title: '极速机炮', description: '射速提升 25% · 上限后单发伤害 +0.4' },
        { id: 'repair', title: '装甲补给', description: '恢复 3 格装甲 · 上限增加 1 格' }
      ];
      this.damageBonus = 0;
      this.prepareStage();
    }
    prepareStage() {
      if (!Number.isInteger(this.stage) || this.stage < 0 || this.stage >= STAGES.length) throw new RangeError('Unknown stage index: ' + this.stage);
      const stage = STAGES[this.stage];
      this.stageConfig = stage;
      this.stageName = stage.name;
      this.stageTime = 0;
      this.wave = 0;
      this.waveCount = stage.waves;
      this.progress = 0;
      this.nextWave = 1.2;
      this.bossSpawned = false;
      this.bossWarningTime = 0;
      this.supportCharges = 1;
      this.bombCharges = 1;
      this.supportTime = 0;
      this.bombTime = 0;
      this.allies = [];
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
      this.setRunExperience(0);
      this.resetRun();
      this.captureCheckpoint('stage', false);
      this.emit('progression', this.getProfile());
      this.emit('checkpoint', { checkpoint: this.getCheckpoint() });
      this.setState('launching');
      this.emit('cinematic', { phase: 'launch', stage: this.stage });
    }
    home() {
      this.setRunExperience(this._savedCheckpoint ? this._savedCheckpoint.totalXp : 0);
      this.resetRun();
      this.setState('menu');
      this.emit('progression', this.getProfile());
    }
    isActive() { return this.state === 'playing' || this.state === 'launching' || this.state === 'ejecting'; }
    pause() {
      if (!this.isActive()) return;
      this.pausedFrom = this.state;
      this.setState('paused');
    }
    resume() {
      if (this.state !== 'paused') return;
      const state = this.pausedFrom;
      this.pausedFrom = null;
      this.setState(state);
    }
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
      if (!Number.isInteger(this.stage) || this.stage < 0 || this.stage >= STAGES.length - 1) throw new RangeError('No upgrade transition after stage index: ' + this.stage);
      if (id === 'spread') {
        if (this.player.weaponLevel < 3) this.player.weaponLevel++;
        else this.damageBonus += 0.4;
      } else if (id === 'rapid') {
        if (this.fireInterval > MIN_FIRE_INTERVAL) this.fireInterval = Math.max(MIN_FIRE_INTERVAL, this.fireInterval * 0.8);
        else this.damageBonus += 0.4;
        if (this.fireInterval === MIN_FIRE_INTERVAL) upgrade.description = '射速已达上限 · 单发伤害 +0.4';
      }
      else {
        this.player.maxHp++;
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + 3);
      }
      this.lastUpgrade = upgrade.title;
      this.stage++;
      this.prepareStage();
      this.captureCheckpoint();
      this.setState('playing');
      this.emit('upgrade', { id });
      this.emit('stage', { stage: this.stage, name: this.stageName });
    }

    callSupport(source = 'free') {
      if (!this.abilityAvailable('support', source) || this.supportTime > 0) return false;
      this.consumeAbility('support', source);
      this.supportTime = this.supportDuration;
      this.allies = [-1, 1].map(side => ({ side, x: clamp(this.player.x + side * 58, 24, WIDTH - 24),
        y: HEIGHT + 70, r: 14, shipLevel: this.player.shipLevel, fireTimer: 0 }));
      this.emit('ability', { type: 'support', phase: 'called', stage: this.stage, charges: this.supportCharges,
        ...(source === 'inventory' ? { source } : {}) });
      return true;
    }
    endSupport(reason) {
      if (this.allies.length === 0) return;
      this.supportTime = 0;
      this.allies = [];
      this.emit('ability', { type: 'support', phase: 'ended', stage: this.stage, reason });
    }
    tickSupport(dt) {
      if (this.supportTime <= 0) return;
      this.supportTime = Math.max(0, this.supportTime - dt);
      if (this.supportTime < 1e-9) { this.endSupport('expired'); return; }
      const elapsed = this.supportDuration - this.supportTime;
      const smooth = value => value * value * (3 - 2 * value);
      const entry = smooth(clamp(elapsed / 0.65, 0, 1));
      const exit = smooth(clamp((0.8 - this.supportTime) / 0.8, 0, 1));
      for (const ally of this.allies) {
        ally.x = clamp(this.player.x + ally.side * 58, 24, WIDTH - 24) + ally.side * exit * 90;
        // Form up ahead of the pilot so both wings remain visible at the lower
        // boundary and stay separated even when an outer wing reaches an edge.
        const formationY = clamp(this.player.y - 64, 40, HEIGHT - 110);
        ally.y = (HEIGHT + 70) * (1 - entry) + formationY * entry - exit * (HEIGHT + 180);
        if (elapsed < 0.65 || this.supportTime <= 0.8) continue;
        ally.fireTimer -= dt;
        if (ally.fireTimer <= 0) {
          const damage = (1 + (ally.shipLevel - 1) * 0.06 + this.damageBonus) * 0.9;
          this.playerBullets.push({ x: ally.x, y: ally.y - 23, vx: 0, vy: -700, r: 3.5, damage, source: 'support' });
          ally.fireTimer += 0.22;
        }
      }
    }
    useBomb(source = 'free') {
      if (!this.abilityAvailable('bomb', source) || this.bombTime > 0) return false;
      this.consumeAbility('bomb', source);
      this.bombTime = this.bombDuration;
      const targets = this.enemies.filter(enemy => enemy.hp > 0 && !enemy.destroyed &&
        enemy.x + enemy.r >= 0 && enemy.x - enemy.r <= WIDTH && enemy.y + enemy.r >= 0 && enemy.y - enemy.r <= HEIGHT)
        .sort((a, b) => Number(a.type === 'boss') - Number(b.type === 'boss'));
      const clearedBullets = this.enemyBullets.length;
      this.enemyBullets = [];
      this.emit('ability', { type: 'bomb', phase: 'detonated', stage: this.stage,
        charges: this.bombCharges, enemies: targets.length, clearedBullets,
        ...(source === 'inventory' ? { source } : {}) });
      // Award every visible enemy before a boss can trigger stage settlement.
      for (const enemy of targets) { enemy.hp = 0; this.destroyEnemy(enemy); }
      this.enemies = this.enemies.filter(enemy => enemy.hp > 0 && !enemy.destroyed);
      return true;
    }

    update(dt) {
      if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Game update dt must be a finite non-negative number');
      if (dt > 0.25) throw new RangeError('Game update dt exceeds 250 ms; reset the platform frame clock on resume');
      // The detonation flash must finish even when its boss kill opens results.
      // This presentation clock does not advance combat in an inactive state.
      if (this.state !== 'paused' && this.bombTime > 0) this.bombTime = Math.max(0, this.bombTime - dt);
      if (!this.isActive()) return;
      const frameState = this.state;
      let remaining = dt;
      // A transition ends this frame: the final cinematic frame must not also
      // shoot, and the fatal hit must begin ejection at its first animation frame.
      while (remaining > 0.000001 && this.state === frameState) {
        const step = Math.min(1 / 120, remaining);
        if (frameState === 'playing') this.tick(step);
        else this.tickCinematic(step);
        remaining -= step;
      }
    }

    tickCinematic(dt) {
      const launching = this.state === 'launching';
      const duration = launching ? this.launchDuration : this.ejectionDuration;
      this.cinematicTime = Math.min(duration, this.cinematicTime + dt);
      if (this.cinematicTime < duration - 1e-9) return;
      this.cinematicTime = duration;
      if (launching) {
        this.setState('playing');
        this.emit('stage', { stage: this.stage, name: this.stageName });
      } else this.finish('gameover');
    }

    tick(dt) {
      const config = STAGES[this.stage];
      this.totalTime += dt;
      this.stageTime += dt;
      this.bannerTime = Math.max(0, this.bannerTime - dt);
      this.bossWarningTime = Math.max(0, this.bossWarningTime - dt);
      this.levelUpTime = Math.max(0, this.levelUpTime - dt);
      this.player.invincible = Math.max(0, this.player.invincible - dt);
      this.shake = Math.max(0, this.shake - dt * 30);
      this.damageFlash = Math.max(0, this.damageFlash - dt * 3);
      this.tickSupport(dt);
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
          const motion = [[0.64, 114], [0.53, 104], [0.78, 95]][enemy.pattern];
          enemy.x = WIDTH / 2 + Math.sin(enemy.t * motion[0]) * motion[1];
        } else if (enemy.type === 'planet') {
          enemy.y = Math.min(124, enemy.y + enemy.speed * dt);
        } else if (enemy.type === 'warship' && enemy.y >= 190 && enemy.holdTime < 5) {
          enemy.holdTime += dt;
          enemy.x = enemy.baseX + Math.sin(enemy.t * .65) * 30;
        } else {
          enemy.y += enemy.speed * dt;
          enemy.x = clamp(enemy.baseX + Math.sin(enemy.t * enemy.swayRate + enemy.phase) * enemy.sway, enemy.r, WIDTH - enemy.r);
        }
        if (enemy.type === 'planet' && enemy.y < 124) continue;
        enemy.fireTimer -= dt;
        if (enemy.type === 'planet') {
          if (enemy.fireTimer <= .9 && !enemy.aimLocked) {
            enemy.aimAngle = Math.atan2(this.player.y - enemy.y, this.player.x - enemy.x);
            enemy.aimLocked = true;
          }
          enemy.charge = clamp(1 - enemy.fireTimer / .9, 0, 1);
        }
        if (enemy.fireTimer <= 0 && enemy.y > 62 && enemy.y < 530) {
          this.enemyShoot(enemy);
          enemy.fireTimer = enemy.type === 'boss' ? (enemy.hp < enemy.maxHp / 2 ? config.bossRageInterval : config.bossFireInterval)
            : enemy.type === 'planet' ? config.planetFireInterval
              : enemy.type === 'warship' ? config.warshipFireInterval : config.fighterFireInterval;
          if (enemy.type === 'planet') { enemy.aimLocked = false; enemy.charge = 0; }
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
      if (this.state !== 'playing') return;
      const player = this.player;
      const damage = 1 + (player.shipLevel - 1) * .06 + this.damageBonus;
      for (const x of [-7, 7]) this.playerBullets.push({ x: player.x + x, y: player.y - 25, vx: 0, vy: -650, r: 4, damage });
      if (player.weaponLevel >= 2) {
        for (const side of [-1, 1]) this.playerBullets.push({ x: player.x + side * 17, y: player.y - 9, vx: side * 96, vy: -625, r: 3.5, damage: damage * 0.75 });
      }
      if (player.weaponLevel >= 3) this.playerBullets.push({ x: player.x, y: player.y - 33, vx: 0, vy: -740, r: 5, damage: damage * 1.3 });
      this.emit('shot', { x: player.x, y: player.y });
    }
    spawnWave() {
      const config = this.stageConfig;
      const wave = this.wave;
      const special = (wave + config.wavePattern) % 4;
      const count = special >= 2 ? 3 : 5;
      for (let i = 0; i < count; i++) {
        const type = special === 2 ? (i === 1 ? 'warship' : 'striker') : special === 3 ? (i === 1 ? 'planet' : 'scout') : ((wave + i + this.stage) % 4 === 3 ? 'striker' : 'scout');
        const x = type === 'planet' ? (wave % 8 === 3 ? 118 : 287) : 49 + i * ((WIDTH - 98) / (count - 1));
        const stagger = config.formation === 1 ? (count - 1 - i) * 28 : config.formation === 2 ? i % 2 * 55 : wave % 2 === 0 ? Math.abs(i - (count - 1) / 2) * 35 : i * 30;
        const y = -40 - stagger;
        const baseHp = { scout: 3, striker: 7, warship: 24, planet: 32 }[type];
        const hp = Math.round(baseHp + config.hpBoost * (type === 'warship' || type === 'planet' ? 6 : 1));
        const skin = (config.chapter + config.mission + wave + i) % 10;
        const appearance = type === 'planet' ? undefined : type === 'warship'
          ? (this.stage < 3 ? { sheet: 'warships', index: (wave + this.stage) % 4, rotation: Math.PI }
            : { sheet: 'fleet', index: skin, rotation: Math.PI / 2 })
          : (this.stage < 3 ? { sheet: 'enemies', index: (wave + i + this.stage) % 8, rotation: Math.PI }
            : { sheet: 'enemyVariants', index: skin, rotation: Math.PI });
        this.enemies.push({
          id: ++this.id, type, x, y, baseX: x, r: { scout: 17, striker: 22, warship: 34, planet: 43 }[type],
          hp, maxHp: hp, speed: ({ scout: 87, striker: 62, warship: 42, planet: 62 }[type]) + config.speedBoost,
          appearance: appearance && Object.freeze(appearance),
          t: 0, hit: 0, phase: i * 0.7, sway: type === 'warship' ? 16 : type === 'planet' ? 0 : config.formation === 2 ? 34 : 26,
          swayRate: config.formation === 1 ? 0.95 : 1.3,
          holdTime: 0, charge: 0, aimAngle: Math.PI / 2, aimLocked: false,
          fireTimer: type === 'planet' ? 2.1 : 1.7 + this.random() * 1.4
        });
      }
    }
    spawnBoss() {
      this.bossSpawned = true;
      const config = this.stageConfig;
      const hp = config.bossHp;
      const appearance = Object.freeze(config.bossForm === 'fighter'
        ? { sheet: 'enemyVariants', index: config.bossSkin, rotation: Math.PI }
        : { sheet: 'fleet', index: config.bossSkin, rotation: Math.PI / 2 });
      const boss = { id: ++this.id, type: 'boss', form: config.bossForm, appearance, pattern: config.bossPattern,
        x: WIDTH / 2, y: -70, r: 56, hp, maxHp: hp, t: 0, hit: 0, fireTimer: 2.8, volley: 0 };
      this.enemies.push(boss);
      this.banner = '';
      this.bannerTime = 0;
      this.bossWarningTime = this.bossWarningDuration;
      this.enemyBullets = [];
      this.emit('boss', { phase: 'appeared', stage: this.stage, enemyId: boss.id });
      this.emit('stage', { stage: this.stage, boss: true });
    }
    enemyShoot(enemy) {
      const config = this.stageConfig;
      const angle = Math.atan2(this.player.y - enemy.y, this.player.x - enemy.x);
      const speed = enemy.type === 'boss' ? 170 + config.bulletSpeedBoost * 14 / 15 : 143 + config.bulletSpeedBoost;
      if (enemy.type === 'scout') {
        this.makeBullet(enemy.x, enemy.y + enemy.r, angle, speed, 5);
      } else if (enemy.type === 'planet') {
        const aim = enemy.aimAngle;
        const muzzleX = enemy.x + Math.cos(aim) * 44;
        const muzzleY = enemy.y + Math.sin(aim) * 44;
        for (const offset of [-.36, -.18, 0, .18, .36]) this.makeBullet(muzzleX, muzzleY, aim + offset, 130 + config.bulletSpeedBoost * 0.8, offset === 0 ? 8 : 6.5, 'plasma');
        this.emit('cannon', { x: enemy.x, y: enemy.y, type: 'planet' });
      } else if (enemy.type === 'warship') {
        for (const x of [-25, 25]) for (const offset of [-.2, 0, .2]) this.makeBullet(enemy.x + x, enemy.y + 36, angle + offset, speed, 5.5, 'bolt');
      } else if (enemy.type !== 'boss') {
        for (const offset of [-0.1, 0.1]) this.makeBullet(enemy.x, enemy.y + enemy.r, angle + offset, speed, 5.5);
      } else {
        enemy.volley++;
        const rage = enemy.hp < enemy.maxHp * 0.5;
        if (enemy.pattern === 0) {
          const count = rage ? 9 : 7;
          for (let i = 0; i < count; i++) this.makeBullet(enemy.x, enemy.y + 42, Math.PI / 2 + (i - (count - 1) / 2) * 0.19 + Math.sin(enemy.volley) * 0.12, speed, 6, 'bolt');
          if (enemy.volley % 2 === 0) for (const x of [-43, 43]) this.makeBullet(enemy.x + x, enemy.y + 22, angle, speed + 40, 5, 'bolt');
        } else if (enemy.pattern === 1) {
          const offsets = rage ? [-0.24, -0.12, 0, 0.12, 0.24] : [-0.16, 0, 0.16];
          for (const x of [-37, 37]) for (const offset of offsets) this.makeBullet(enemy.x + x, enemy.y + 32, angle + offset, speed, 5.5, 'bolt');
          if (enemy.volley % 3 === 0) for (const offset of [-0.45, 0, 0.45]) this.makeBullet(enemy.x, enemy.y + 44, Math.PI / 2 + offset, speed - 20, 7, 'plasma');
        } else if (enemy.pattern === 2) {
          const count = rage ? 10 : 8;
          const sweep = Math.sin(enemy.volley * 0.7) * 0.23;
          for (let i = 0; i < count; i++) this.makeBullet(enemy.x, enemy.y + 42, Math.PI / 2 + (i - (count - 1) / 2) * 0.21 + sweep, speed, 5.5, 'bolt');
          if (enemy.volley % 2 === 0) for (const offset of [-0.09, 0, 0.09]) this.makeBullet(enemy.x, enemy.y + 28, angle + offset, speed + 30, 5, 'bolt');
        } else throw new RangeError('Unknown boss attack pattern: ' + enemy.pattern);
      }
    }
    makeBullet(x, y, angle, speed, r, kind = 'orb') { this.enemyBullets.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, r, kind }); }
    burst(x, y, color, count, lifetime = 0.65) {
      const particleCount = Math.min(count, MAX_PARTICLES);
      const overflow = this.particles.length + particleCount - MAX_PARTICLES;
      if (overflow > 0) this.particles.splice(0, overflow);
      for (let i = 0; i < particleCount; i++) {
        const angle = this.random() * Math.PI * 2;
        const speed = 25 + this.random() * 145;
        const life = lifetime * (0.5 + this.random() * 0.5);
        this.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life, maxLife: life, r: 1.5 + this.random() * 3, color });
      }
    }
    destroyEnemy(enemy) {
      if (enemy.destroyed) return;
      enemy.destroyed = true;
      this.kills++;
      this.score += enemy.type === 'boss' ? 2000 * (this.stage + 1) : { scout: 80, striker: 140, warship: 300, planet: 450 }[enemy.type];
      this.addExperience({ scout: 10, striker: 16, warship: 40, planet: 60, boss: 120 }[enemy.type]);
      this.shake = enemy.type === 'boss' ? 12 : enemy.type === 'warship' || enemy.type === 'planet' ? 4 : 1.6;
      this.burst(enemy.x, enemy.y, enemy.type === 'planet' ? '#df9aff' : '#ffbd6c', enemy.type === 'boss' ? 70 : enemy.type === 'planet' ? 38 : 18);
      this.emit('explosion', { x: enemy.x, y: enemy.y, boss: enemy.type === 'boss' });
      if (enemy.type === 'boss') {
        this.bossWarningTime = 0;
        this.endSupport('stage-complete');
        this.enemies = this.enemies.filter(item => item !== enemy && item.hp > 0 && !item.destroyed);
        this.enemyBullets = [];
        this.playerBullets = [];
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + 1);
        this.emit('boss', { phase: 'defeated', stage: this.stage, enemyId: enemy.id });
        if (this.stage === STAGES.length - 1) this.finish('victory');
        else { this.captureCheckpoint('upgrade'); this.setState('upgrade'); }
      } else if (this.kills % 5 === 0) {
        this.pickups.push({ x: enemy.x, y: enemy.y, r: 12, type: this.kills % 10 === 0 ? 'repair' : 'power', t: 0 });
      }
    }
    hurt() {
      if (this.state !== 'playing' || this.player.invincible > 0) return;
      this.player.hp--;
      this.player.invincible = 1.5;
      this.damageFlash = 0.65;
      this.shake = 8;
      this.burst(this.player.x, this.player.y, '#9afbe1', 18);
      this.emit('hurt', { hp: this.player.hp });
      if (this.player.hp <= 0) {
        this.endSupport('player-defeated');
        this.resultProgression = Object.freeze({ ...this.progression });
        this.storeCheckpoint(null, false);
        this.clearRunGrowth();
        this.bestScore = Math.max(this.bestScore, this.score);
        this.cinematicTime = 0;
        this.bossWarningTime = 0;
        this.setState('ejecting');
        this.emit('progression', this.getProfile());
        this.emit('checkpoint', { checkpoint: null, reason: 'defeated' });
        this.emit('cinematic', { phase: 'eject', stage: this.stage });
      }
    }
    finish(state) {
      this.bossWarningTime = 0;
      if (state === 'victory') {
        this.resultProgression = Object.freeze({ ...this.progression });
        this.storeCheckpoint(null, false);
        this.clearRunGrowth();
      }
      this.bestScore = Math.max(this.bestScore, this.score);
      this.setState(state);
      if (state === 'victory') {
        this.emit('progression', this.getProfile());
        this.emit('checkpoint', { checkpoint: null, reason: 'victory' });
      }
      this.emit(state, { score: this.score, stage: this.stage, kills: this.kills });
    }
  }
  return { Game, WIDTH, HEIGHT, STAGES, validateCheckpoint };
});
