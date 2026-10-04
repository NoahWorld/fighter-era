'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, WIDTH, STAGES, WEAPONS, LIMITS, validateCheckpoint } = require('../src/engine.js');

const STEP = 1 / 120;
function advance(game, seconds, frame = STEP) {
  const frames = Math.floor(seconds / frame);
  for (let i = 0; i < frames; i++) game.update(frame);
  const remainder = seconds - frames * frame;
  if (remainder > 1e-6) game.update(remainder);
}
function quiet() {
  const game = new Game({ seed: 482 });
  game.start();
  advance(game, game.launchDuration);
  game.nextWave = 10000;
  silence(game);
  return game;
}
function silence(game) {
  game.fireTimer = 10000;
  game.specialFireTimers = { laser: 10000, homing: 10000, explosive: 10000 };
}
function equip(game, kind, rank = 1) {
  game.addExperience(9900);
  game.player.weapons = Object.freeze({ ...game.player.weapons, [kind]: rank });
  game.player.weapon = kind;
}
function target(game, x, y, hp = 100) {
  game.spawnWave();
  const enemy = game.enemies[game.enemies.length - 1];
  Object.assign(enemy, { x, baseX: x, y, hp, maxHp: hp, speed: 0, sway: 0, fireTimer: 10000 });
  return enemy;
}
function collect(game, weapon) {
  game.pickups.push({ x: game.player.x, y: game.player.y, r: 12, t: 0, type: 'weapon', weapon });
  game.update(STEP);
}
function assertBounds(game) {
  for (const name of ['playerBullets', 'enemyBullets', 'weaponEffects', 'pickups', 'enemies', 'particles']) {
    const limit = name === 'weaponEffects' ? LIMITS.effects : LIMITS[name];
    assert.ok(game[name].length <= limit, name + ' limit at stage ' + game.stage);
  }
  assert.ok(game.playerBeams.length <= LIMITS.beams);
  assert.ok(game.enemyBeams.length <= LIMITS.beams);
  for (const bullet of [...game.playerBullets, ...game.enemyBullets]) {
    assert.ok([bullet.x, bullet.y, bullet.vx, bullet.vy, bullet.r].every(Number.isFinite));
  }
}

test('pickups acquire and reinforce a stacked loadout, with reserved weapons enabled by mount slots', () => {
  const game = quiet();
  collect(game, 'laser');
  collect(game, 'homing');
  collect(game, 'explosive');
  assert.deepEqual(game.getActiveWeapons(), ['gun']);
  assert.throws(() => game.shoot('laser'), /not mounted/);
  game.addExperience(300);
  assert.deepEqual(game.getActiveWeapons(), ['gun', 'laser']);
  game.addExperience(3200);
  assert.deepEqual(game.getActiveWeapons(), ['gun', 'laser', 'homing']);
  game.addExperience(6400);
  assert.deepEqual(game.getActiveWeapons(), WEAPONS);
  const first = game.player.weapons;
  const initialDamage = game.getCombatStats().damage;
  collect(game, 'gun');
  assert.ok(game.getCombatStats().damage > initialDamage);
  assert.equal(first.gun, 1, 'earlier loadout snapshots stay immutable');
  for (let repeat = 0; repeat < 7; repeat++) collect(game, 'laser');
  assert.equal(game.player.weapons.laser, 5);
  assert.equal(game.player.weapon, 'laser', 'last pickup does not suppress any other gun');
  assert.deepEqual(game.getActiveWeapons(), WEAPONS);
  assert.deepEqual(game.getCheckpoint().player.weapons, game.player.weapons);
  assert.equal(Object.isFrozen(game.player.weapons), true);
  game.captureCheckpoint();
  const restored = new Game({ profile: game.getProfile(), checkpoint: game.getCheckpoint() });
  restored.continueRun();
  assert.deepEqual(restored.player.weapons, game.player.weapons);
  assert.deepEqual(restored.getActiveWeapons(), WEAPONS);
  assert.equal(restored.player.weapon, 'laser');
});

test('legacy exact v2 saves explicitly resume the original gun and unknown weapon data fails', () => {
  const game = quiet();
  const checkpoint = game.getCheckpoint();
  const legacy = { ...checkpoint, player: { hp: 5, maxHp: 5, weaponLevel: 2 } };
  assert.equal(validateCheckpoint(legacy).player.weapon, 'gun');
  const restored = new Game({ profile: game.getProfile(), checkpoint: legacy });
  restored.continueRun();
  assert.equal(restored.player.weapon, 'gun');
  assert.equal(restored.player.weaponLevel, 2);
  for (const weapon of ['', null, 1, 'beam', 'paid-laser']) {
    assert.throws(() => validateCheckpoint({ ...checkpoint, player: { ...checkpoint.player, weapon } }), /checkpoint player weapon/);
  }
  assert.throws(() => validateCheckpoint({ ...checkpoint, player: { ...checkpoint.player, weaponTime: 12 } }), /checkpoint player/);
});

test('natural loot spaces reinforcement at increasing kill milestones while retaining the weapon cycle', () => {
  const game = quiet();
  for (let kill = 0; kill < 80; kill++) {
    const enemy = target(game, 200, 160, 1);
    game.destroyEnemy(enemy);
    game.enemies = [];
  }
  assert.deepEqual(game.pickups.map(pickup => pickup.weapon || pickup.type), ['laser', 'homing', 'explosive', 'gun', 'repair']);
});

test('laser pierces aligned enemies with continuous damage and misses a target outside its width', () => {
  const game = quiet();
  const near = target(game, game.player.x, 380);
  const far = target(game, game.player.x, 210);
  const outside = target(game, game.player.x + 80, 300);
  game.enemies = [near, far, outside];
  equip(game, 'laser');
  game.shoot('laser');
  advance(game, 0.1);
  assert.ok(near.hp < 100 && far.hp < 100);
  assert.ok(Math.abs(near.hp - far.hp) < 1e-8, 'a nearer body does not swallow the penetrating beam');
  assert.equal(outside.hp, 100);
  const halfwayHp = near.hp;
  advance(game, 0.15);
  assert.ok(near.hp < halfwayHp);
  assert.equal(game.playerBeams.length, 0, 'laser rays retire after their short pulse');
});

test('gun, laser and blast damage share the same visible entry boundary for fighters and bosses', () => {
  for (const type of ['scout', 'boss']) {
    for (const weapon of ['gun', 'laser', 'explosive']) {
      const game = quiet();
      let enemy;
      if (type === 'boss') { game.spawnBoss(); enemy = game.enemies[0]; }
      else enemy = target(game, game.player.x, 0);
      game.enemies = [enemy];
      enemy.hp = enemy.maxHp = 10000;
      enemy.y = type === 'boss' ? 158 : enemy.r - 2;
      enemy.speed = 0; enemy.sway = 0;
      const entrance = type === 'boss' ? 160 : enemy.r;
      if (weapon === 'laser') {
        equip(game, 'laser'); game.shoot('laser');
      } else if (weapon === 'explosive') {
        game.explodePlayerBullet({ x: enemy.x, y: enemy.y, damage: 20, blastRadius: 80 });
      } else {
        game.playerBullets.push({ x: enemy.x, y: enemy.y, vx: 0, vy: 0, r: 4, damage: 20, kind: 'gun' });
      }
      game.update(STEP);
      assert.equal(enemy.hp, 10000, type + ' is not damaged during entry by ' + weapon);
      enemy.y = entrance;
      if (weapon === 'explosive') game.explodePlayerBullet({ x: enemy.x, y: enemy.y, damage: 20, blastRadius: 80 });
      if (weapon === 'gun') Object.assign(game.playerBullets[0], { x: enemy.x, y: enemy.y });
      game.update(STEP);
      assert.ok(enemy.hp < 10000, type + ' can be attacked after entry by ' + weapon);
    }
  }
});

test('homing missiles release an ineligible target and acquire it only after visible entry', () => {
  const game = quiet();
  const enemy = target(game, game.player.x + 75, -5);
  game.enemies = [enemy]; enemy.speed = 0; enemy.sway = 0;
  equip(game, 'homing'); game.shoot('homing');
  game.playerBullets[0].targetId = enemy.id;
  game.update(STEP);
  assert.ok(game.playerBullets.every(bullet => bullet.targetId === null));
  enemy.y = enemy.r;
  game.update(STEP);
  assert.ok(game.playerBullets.every(bullet => bullet.targetId === enemy.id));
});

test('boss approach freezes hostile attacks until the warning entrance has completed', () => {
  const game = quiet();
  game.spawnBoss();
  const boss = game.enemies[0];
  const initialTimer = boss.fireTimer;
  advance(game, 2.6);
  assert.ok(boss.y < 160);
  assert.equal(boss.hp, boss.maxHp);
  assert.equal(boss.fireTimer, initialTimer);
  assert.equal(boss.volley, 0);
  assert.equal(game.enemyBullets.length, 0);
  advance(game, 0.9);
  assert.equal(boss.y, 160);
  assert.ok(boss.volley > 0, 'the boss begins its real attack cycle shortly after arrival');
});

test('homing missiles steer toward a displaced target, preserve speed and hit without moving the pilot', () => {
  const game = quiet();
  const enemy = target(game, game.player.x + 92, 320, 30);
  game.enemies = [enemy];
  equip(game, 'homing');
  game.shoot('homing');
  const missile = game.playerBullets[1];
  const speed = Math.hypot(missile.vx, missile.vy);
  const initialDirection = Math.atan2(missile.vy, missile.vx);
  game.update(STEP);
  assert.ok(Math.atan2(missile.vy, missile.vx) > initialDirection);
  assert.ok(Math.abs(Math.hypot(missile.vx, missile.vy) - speed) < 1e-8);
  advance(game, 1);
  assert.ok(enemy.hp < 30, 'the displaced target receives real missile damage');
  assert.equal(game.player.x, WIDTH / 2);
  game.enemies = [];
  advance(game, 4);
  assert.equal(game.playerBullets.length, 0, 'untargeted or circling missiles cannot remain forever');
});

test('an explosive projectile damages several nearby targets once and leaves a distant target intact', () => {
  const game = quiet();
  const hit = target(game, 180, 300);
  const nearby = target(game, 230, 300);
  const outside = target(game, 335, 300);
  game.enemies = [hit, nearby, outside];
  equip(game, 'explosive');
  game.shoot('explosive');
  const shell = game.playerBullets[0];
  Object.assign(shell, { x: hit.x, y: hit.y, vx: 0, vy: 0 });
  game.update(STEP);
  assert.ok(hit.hp < 100 && nearby.hp < 100);
  assert.equal(outside.hp, 100);
  assert.equal(game.playerBullets.length, 0);
  assert.equal(game.weaponEffects.length, 1);
  const after = [hit.hp, nearby.hp];
  game.update(STEP);
  assert.deepEqual([hit.hp, nearby.hp], after, 'the visual shockwave does not award a second hit');
});

test('fighters, warships, planetary cannons and bosses rotate through real hostile weapon modes', () => {
  for (const type of ['scout', 'striker', 'warship', 'planet', 'boss']) {
    const game = quiet();
    let enemy;
    if (type === 'boss') { game.spawnBoss(); enemy = game.enemies[0]; }
    else {
      for (let wave = 0; wave < 4; wave++) { game.wave = wave; game.spawnWave(); }
      enemy = game.enemies.find(item => item.type === type);
    }
    assert.ok(enemy, type);
    Object.assign(enemy, { y: 160, weaponIndex: 0, volley: 0 });
    const observed = [];
    for (let volley = 0; volley < 8; volley++) {
      game.enemyBullets = [];
      game.enemyBeams = [];
      game.enemyShoot(enemy);
      observed.push(enemy.lastWeapon);
      if (enemy.lastWeapon === 'laser') {
        assert.equal(game.enemyBullets.length, 0);
        assert.ok(game.enemyBeams.length > 0);
        assert.ok(game.enemyBeams.every(beam => beam.warning === 0.9 && beam.duration === 0.26));
      } else if (enemy.lastWeapon !== 'gun') {
        assert.ok(game.enemyBullets.every(bullet => bullet.kind === enemy.lastWeapon));
        assert.ok(game.enemyBullets.length <= 2, 'special weapons trade volume for their actual effect');
      }
    }
    assert.deepEqual(observed, ['gun', 'gun', 'laser', 'laser', 'homing', 'homing', 'explosive', 'explosive']);
  }
});

test('enemy lasers lock their warning ray, give time to dodge, and only hurt after warning', () => {
  for (const dodge of [false, true]) {
    const game = quiet();
    const enemy = target(game, game.player.x, 160);
    Object.assign(enemy, { weaponIndex: 1, volley: 0 });
    game.enemies = [enemy];
    game.player.invincible = 0;
    game.enemyShoot(enemy);
    const beam = game.enemyBeams[0];
    const locked = { x: beam.x, y: beam.y, angle: beam.angle };
    advance(game, 0.85);
    assert.equal(game.player.hp, 5);
    if (dodge) game.moveBy(90, 0);
    advance(game, 0.15);
    assert.deepEqual({ x: beam.x, y: beam.y, angle: beam.angle }, locked);
    assert.equal(game.player.hp, dodge ? 5 : 4);
    advance(game, 0.25);
    assert.equal(game.enemyBeams.length, 0);
  }
});

test('hostile homing stops steering after its short tracking window and explosive shells burst into bounded shards', () => {
  const game = quiet();
  game.makeBullet(200, 130, Math.PI / 2, 150, 6, 'homing', { trackTime: 0.7, turnRate: 0.75 });
  const missile = game.enemyBullets[0];
  game.moveBy(100, 0);
  advance(game, 0.8);
  assert.equal(missile.trackTime, 0);
  const velocity = [missile.vx, missile.vy];
  game.moveBy(-200, 0);
  advance(game, 0.1);
  assert.deepEqual([missile.vx, missile.vy], velocity);
  game.enemyBullets = [];
  game.makeBullet(200, 130, Math.PI / 2, 100, 8, 'explosive', { fuse: 0.2 });
  advance(game, 0.25);
  assert.equal(game.enemyBullets.length, 7);
  assert.ok(game.enemyBullets.every(bullet => bullet.kind === 'orb' && Math.abs(Math.hypot(bullet.vx, bullet.vy) - 115) < 1e-8));
  assert.equal(game.weaponEffects.length, 1);
});

test('pause freezes both beams, tracking, fuses, effects and weapon pickup state exactly', () => {
  const game = quiet();
  const enemy = target(game, 200, 160);
  Object.assign(enemy, { weaponIndex: 1, volley: 0 });
  game.enemies = [enemy];
  equip(game, 'laser');
  game.shoot('laser');
  game.enemyShoot(enemy);
  game.makeBullet(100, 160, Math.PI / 2, 100, 8, 'explosive', { fuse: 1.6 });
  game.makeBullet(140, 160, Math.PI / 2, 100, 6, 'homing', { trackTime: 0.7, turnRate: 0.75 });
  game.weaponExplosion(250, 350, 75, '#ffffff');
  game.pickups.push({ x: game.player.x, y: game.player.y, r: 12, t: 0, type: 'weapon', weapon: 'explosive' });
  game.pause();
  const paused = JSON.stringify(game);
  advance(game, 5, 0.25);
  assert.equal(JSON.stringify(game), paused);
  game.resume();
  game.update(STEP);
  assert.equal(game.player.weapon, 'explosive');
  assert.ok(game.enemyBeams[0].t > 0);
});

test('consumed free charges survive manual stage preparation, upgrade reload, home and every following stage', () => {
  const game = quiet();
  game.callSupport();
  game.useBomb();
  game.prepareStage();
  assert.equal(game.callSupport(), false);
  assert.equal(game.useBomb(), false);
  game.spawnBoss();
  game.destroyEnemy(game.enemies[0]);
  const recovered = new Game({ profile: game.getProfile(), checkpoint: game.getCheckpoint() });
  recovered.continueRun();
  assert.equal(recovered.state, 'upgrade');
  recovered.chooseUpgrade('spread');
  assert.deepEqual(recovered.getCheckpoint().freeCharges, { bomb: 0, support: 0 });
  recovered.home();
  recovered.continueRun();
  advance(recovered, recovered.launchDuration);
  assert.equal(recovered.callSupport(), false);
  assert.equal(recovered.useBomb(), false);
  recovered.start();
  assert.deepEqual(recovered.getCheckpoint().freeCharges, { bomb: 1, support: 1 });
});

test('death removes weapon state, effects, ammunition and continuation before the ejection event', () => {
  const game = quiet();
  collect(game, 'laser');
  game.shoot();
  game.weaponExplosion(200, 200, 80, '#ffffff');
  game.pickups.push({ x: 200, y: 200, r: 12, t: 0, type: 'weapon', weapon: 'homing' });
  game.player.hp = 1;
  game.player.invincible = 0;
  game.hurt();
  assert.equal(game.state, 'ejecting');
  assert.equal(game.player.weapon, 'gun');
  assert.deepEqual(game.player.weapons, { gun: 1, laser: 0, homing: 0, explosive: 0 });
  assert.equal(game.getCheckpoint(), null);
  for (const name of ['playerBullets', 'enemyBullets', 'playerBeams', 'enemyBeams', 'weaponEffects', 'pickups']) assert.equal(game[name].length, 0, name);
  assert.deepEqual([game.bombCharges, game.supportCharges], [0, 0]);
  advance(game, game.ejectionDuration);
  assert.equal(game.continueRun(), false);
  game.start();
  assert.equal(game.player.weapon, 'gun');
  assert.deepEqual([game.bombCharges, game.supportCharges], [1, 1]);
});

test('all 100 stages sustain all stacked max-rank weapons within fixed memory limits and retire hazards', () => {
  const game = quiet();
  for (let stage = 0; stage < STAGES.length; stage++) {
    game.stage = stage;
    game.prepareStage();
    game.player.invincible = 10000;
    game.player.shipLevel = 20;
    game.player.weapons = Object.freeze({ gun: 5, laser: 5, homing: 5, explosive: 5 });
    game.player.weaponLevel = 3;
    game.fireInterval = game.minFireInterval;
    for (let wave = 0; wave < 4; wave++) { game.wave = wave; game.spawnWave(); }
    for (const enemy of game.enemies) { enemy.y = 140; enemy.fireTimer = 0; enemy.hp = 100000; }
    game.nextWave = 10000;
    for (let frame = 0; frame < 16; frame++) { game.update(0.25); assertBounds(game); }
    game.enemies = [];
    silence(game);
    game.playerBeams = [];
    advance(game, 8, 0.25);
    assert.equal(game.enemyBullets.length, 0, 'stage ' + stage + ' retires hostile hazards');
    assert.equal(game.enemyBeams.length, 0);
    assert.equal(game.playerBullets.length, 0);
    assert.equal(game.weaponEffects.length, 0);
  }
});

test('fixed simulation steps reproduce laser and homing combat at high and low display frame rates', () => {
  for (const weapon of ['laser', 'homing', 'explosive']) {
    const fast = quiet(), slow = quiet();
    for (const game of [fast, slow]) {
      const enemy = target(game, game.player.x + (weapon === 'laser' ? 0 : 55), 250, 1000);
      game.enemies = [enemy];
      equip(game, weapon);
      game.fireTimer = 0;
      game.specialFireTimers[weapon] = 0;
    }
    advance(fast, 2, STEP);
    advance(slow, 2, 0.25);
    assert.deepEqual(JSON.parse(JSON.stringify(fast)), JSON.parse(JSON.stringify(slow)), weapon);
  }
});

test('each mounted weapon fires on its independent cadence while the base gun is always retained', () => {
  const game = quiet();
  game.addExperience(9900);
  for (const weapon of ['laser', 'homing', 'explosive']) collect(game, weapon);
  game.playerBullets = [];
  game.playerBeams = [];
  game.fireTimer = 0;
  game.specialFireTimers = { laser: 0, homing: 0, explosive: 0 };
  const counts = { gun: 0, laser: 0, homing: 0, explosive: 0 };
  game.onEvent = (event, payload) => { if (event === 'shot') counts[payload.weapon]++; };
  advance(game, 4);
  for (const weapon of WEAPONS) {
    assert.equal(counts[weapon], Math.ceil(4 / game.weaponFireInterval(weapon)), weapon + ' has an independent firing clock');
  }
  assert.ok(counts.gun > counts.laser && counts.laser > counts.homing && counts.homing > counts.explosive);
  assert.ok(game.playerBullets.some(bullet => bullet.kind === 'gun'));
  const clocks = { gun: game.fireTimer, ...game.specialFireTimers };
  collect(game, 'homing');
  assert.ok(game.fireTimer < clocks.gun, 'pickup advances rather than restarts the gun clock');
  assert.ok(game.specialFireTimers.laser < clocks.laser, 'unrelated beams keep their cadence');
});

test('repeat pickups strengthen only their own weapon and do not delete an existing beam', () => {
  const game = quiet();
  game.addExperience(9900);
  for (const weapon of ['laser', 'homing', 'explosive']) collect(game, weapon);
  game.shoot('laser');
  const beam = game.playerBeams[0];
  const priorLaserDamage = beam.damagePerSecond;
  const oldRanks = game.player.weapons;
  game.shoot('homing');
  const oldHomingDamage = game.playerBullets[0].damage;
  const oldHomingInterval = game.weaponFireInterval('homing');
  collect(game, 'homing');
  assert.ok(game.playerBeams.includes(beam), 'picking up a missile does not cancel an active laser');
  assert.deepEqual(oldRanks, { gun: 1, laser: 1, homing: 1, explosive: 1 });
  game.playerBullets = [];
  game.shoot('homing');
  assert.ok(game.playerBullets[0].damage > oldHomingDamage);
  assert.ok(game.weaponFireInterval('homing') < oldHomingInterval);
  game.shoot('laser');
  assert.equal(game.playerBeams.at(-1).damagePerSecond, priorLaserDamage);
  collect(game, 'gun');
  game.shoot('laser');
  assert.equal(game.playerBeams.at(-1).damagePerSecond, priorLaserDamage, 'a gun rank does not silently rank up the laser');
});

test('all twenty levels use the shared appearance and cap while level and late stages improve real firepower', () => {
  const { getPlayerModel } = require('../src/aircraft.js');
  const game = quiet();
  let previousStats = game.getCombatStats();
  for (let level = 2; level <= 20; level++) {
    const threshold = 100 * (level - 1) ** 2 + 200 * (level - 1);
    game.addExperience(threshold - game.profile.totalXp);
    assert.equal(game.progression.level, level);
    assert.strictEqual(game.player.appearance, getPlayerModel(level).appearance);
    assert.equal(game.progression.title, getPlayerModel(level).title);
    const stats = game.getCombatStats();
    assert.ok(stats.damage > previousStats.damage);
    assert.ok(stats.fireInterval < previousStats.fireInterval);
    game.playerBullets = [];
    game.shoot();
    assert.equal(game.playerBullets[0].damage, stats.damage);
    previousStats = stats;
  }
  game.addExperience(100000);
  assert.equal(game.progression.level, 20);
  assert.equal(game.progression.xp, 0);
  assert.equal(game.progression.nextXp, 0);
  assert.equal(game.player.shipLevel, 20);
  assert.equal(game.getCombatStats().damage, previousStats.damage, 'experience above max level does not invent another aircraft');
  let previousDamage = previousStats.damage;
  let previousInterval = previousStats.fireInterval;
  for (let stage = 1; stage < STAGES.length; stage++) {
    game.stage = stage;
    game.prepareStage();
    const stats = game.getCombatStats();
    assert.ok(stats.damage > previousDamage, 'damage still grows at stage ' + (stage + 1));
    assert.ok(stats.fireInterval < previousInterval, 'fire rate still grows at stage ' + (stage + 1));
    game.shoot();
    assert.equal(game.playerBullets[0].damage, stats.damage);
    previousDamage = stats.damage;
    previousInterval = stats.fireInterval;
  }
  assert.equal(game.fireInterval, 0.16, 'derived stage fire rate does not mutate the saved baseline');
});

test('actual high-level auto fire produces more shots and damage than the original aircraft', () => {
  const fresh = quiet(), grown = quiet();
  grown.addExperience(39900);
  grown.stage = 99;
  grown.prepareStage();
  for (const game of [fresh, grown]) {
    game.nextWave = 10000;
    game.fireTimer = 0;
    game.onEvent = event => { if (event === 'shot') game.recordedShots++; };
    game.recordedShots = 0;
    advance(game, 2);
  }
  assert.ok(grown.recordedShots > fresh.recordedShots);
  assert.ok(grown.playerBullets[0].damage > fresh.playerBullets[0].damage * 6);
});

test('all four stacked weapons reproduce the same combat at 120 FPS and 4 FPS', () => {
  const fast = quiet(), slow = quiet();
  for (const game of [fast, slow]) {
    game.addExperience(39900);
    game.stage = 98;
    game.prepareStage();
    game.nextWave = 10000;
    game.fireInterval = game.minFireInterval;
    game.player.weaponLevel = 3;
    game.player.weapons = Object.freeze({ gun: 5, laser: 5, homing: 5, explosive: 5 });
    const enemy = target(game, game.player.x + 35, 250, 100000);
    game.enemies = [enemy];
  }
  advance(fast, 5, STEP);
  advance(slow, 5, 0.25);
  assert.deepEqual(JSON.parse(JSON.stringify(fast)), JSON.parse(JSON.stringify(slow)));
  assertBounds(fast);
});

test('late bosses have a practical kill time with acquired weapons and repeat ranks increase actual damage output', t => {
  const times = [];
  for (const stage of [79, 89, 98, 99]) {
    const buildTimes = [];
    for (const rank of [1, 5]) {
      const game = quiet();
      game.addExperience(39900);
      game.stage = stage;
      game.prepareStage();
      game.nextWave = 10000;
      game.player.invincible = 10000;
      game.player.weaponLevel = 3;
      game.player.weapons = Object.freeze({ gun: rank, laser: rank, homing: rank, explosive: rank });
      game.fireInterval = game.minFireInterval;
      game.spawnBoss();
      const boss = game.enemies[0];
      boss.y = 160;
      boss.fireTimer = 10000;
      let elapsed = 0;
      // Track a moving boss without dodging to measure combat output directly;
      // this deliberately excludes survival skill from the damage benchmark.
      while (game.state === 'playing' && elapsed < 40) {
        game.player.x = boss.x;
        game.update(STEP);
        elapsed += STEP;
        assertBounds(game);
      }
      assert.equal(boss.destroyed, true, 'stage ' + (stage + 1) + ' must not stall at the level cap');
      assert.ok(elapsed >= 8 && elapsed < (rank === 1 ? 30 : 20), 'stage ' + (stage + 1) + ' rank ' + rank + ' kill time: ' + elapsed);
      buildTimes.push(elapsed);
    }
    assert.ok(buildTimes[1] < buildTimes[0] * 0.7, 'repeated drops materially improve the late boss fight');
    times.push({ stage: stage + 1, firstRankSeconds: +buildTimes[0].toFixed(2), fifthRankSeconds: +buildTimes[1].toFixed(2) });
  }
  t.diagnostic(JSON.stringify(times));
});
