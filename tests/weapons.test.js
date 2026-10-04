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
  game.fireTimer = 10000;
  return game;
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

test('weapon pickups replace the gun with four real fire modes and persist the acquired choice', () => {
  const game = quiet();
  for (const weapon of WEAPONS) {
    collect(game, weapon);
    assert.equal(game.player.weapon, weapon);
    assert.equal(game.getCheckpoint().player.weapon, weapon);
    assert.equal(game.pickups.length, 0);
    game.playerBullets = [];
    game.playerBeams = [];
    game.shoot();
    if (weapon === 'laser') {
      assert.equal(game.playerBullets.length, 0, 'a laser is a continuous collision ray rather than a recolored bullet');
      assert.equal(game.playerBeams.length, 1);
      assert.equal(game.playerBeams[0].warning, 0);
    } else {
      assert.equal(game.playerBeams.length, 0);
      assert.ok(game.playerBullets.every(bullet => bullet.kind === weapon));
      assert.equal(game.playerBullets.length, weapon === 'explosive' ? 1 : 2);
    }
    game.fireTimer = 10000;
  }
  const restored = new Game({ profile: game.getProfile(), checkpoint: game.getCheckpoint() });
  restored.continueRun();
  assert.equal(restored.player.weapon, game.player.weapon);
  assert.equal(restored.player.weaponLevel, game.player.weaponLevel);
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

test('natural five-kill loot cycles laser, homing, explosive, gun and repair', () => {
  const game = quiet();
  for (let kill = 0; kill < 25; kill++) {
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
  game.player.weapon = 'laser';
  game.shoot();
  advance(game, 0.1);
  assert.ok(near.hp < 100 && far.hp < 100);
  assert.ok(Math.abs(near.hp - far.hp) < 1e-8, 'a nearer body does not swallow the penetrating beam');
  assert.equal(outside.hp, 100);
  const halfwayHp = near.hp;
  advance(game, 0.15);
  assert.ok(near.hp < halfwayHp);
  assert.equal(game.playerBeams.length, 0, 'laser rays retire after their short pulse');
});

test('homing missiles steer toward a displaced target, preserve speed and hit without moving the pilot', () => {
  const game = quiet();
  const enemy = target(game, game.player.x + 92, 320, 30);
  game.enemies = [enemy];
  game.player.weapon = 'homing';
  game.shoot();
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
  game.player.weapon = 'explosive';
  game.shoot();
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
  game.player.weapon = 'laser';
  game.shoot();
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
  assert.equal(game.getCheckpoint(), null);
  for (const name of ['playerBullets', 'enemyBullets', 'playerBeams', 'enemyBeams', 'weaponEffects', 'pickups']) assert.equal(game[name].length, 0, name);
  assert.deepEqual([game.bombCharges, game.supportCharges], [0, 0]);
  advance(game, game.ejectionDuration);
  assert.equal(game.continueRun(), false);
  game.start();
  assert.equal(game.player.weapon, 'gun');
  assert.deepEqual([game.bombCharges, game.supportCharges], [1, 1]);
});

test('all 100 stages sustain all weapon modes within fixed memory limits and retire hazards', () => {
  const game = quiet();
  for (let stage = 0; stage < STAGES.length; stage++) {
    game.stage = stage;
    game.prepareStage();
    game.player.invincible = 10000;
    game.player.weapon = WEAPONS[stage % WEAPONS.length];
    game.fireInterval = game.minFireInterval;
    for (let wave = 0; wave < 4; wave++) { game.wave = wave; game.spawnWave(); }
    for (const enemy of game.enemies) { enemy.y = 140; enemy.fireTimer = 0; enemy.hp = 100000; }
    game.nextWave = 10000;
    for (let frame = 0; frame < 16; frame++) { game.update(0.25); assertBounds(game); }
    game.enemies = [];
    game.fireTimer = 10000;
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
      game.player.weapon = weapon;
      game.fireTimer = 0;
    }
    advance(fast, 2, STEP);
    advance(slow, 2, 0.25);
    assert.deepEqual(JSON.parse(JSON.stringify(fast)), JSON.parse(JSON.stringify(slow)), weapon);
  }
});
