'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, WIDTH, HEIGHT, STAGES } = require('../src/engine.js');

const STEP = 1 / 120;

function started(options = {}) {
  const game = new Game(options);
  game.start();
  advance(game, game.launchDuration);
  assert.equal(game.state, 'playing');
  return game;
}

function snapshot(game) {
  // The callback is external observation, not simulation state.
  return JSON.parse(JSON.stringify(game));
}

function advance(game, seconds, frame = STEP) {
  const fullFrames = Math.floor(seconds / frame);
  for (let i = 0; i < fullFrames; i++) game.update(frame);
  const remainder = seconds - fullFrames * frame;
  if (remainder > 1e-6) game.update(remainder);
}

function bulletAt(target, damage = 1) {
  return { x: target.x, y: target.y, vx: 0, vy: 0, r: 4, damage };
}

function quietGame(options = {}) {
  const game = started(options);
  // Isolate a collision/pickup from naturally scheduled enemy waves.
  game.nextWave = 1000;
  return game;
}

test('every launch freezes combat until boarding and takeoff complete, then announces the stage once', () => {
  const events = [];
  const game = new Game({ onEvent: (name, payload) => events.push({ name, payload }) });
  assert.equal(game.isActive(), false);
  assert.equal(game.cinematicTime, 0);
  game.start();
  assert.equal(game.state, 'launching');
  assert.equal(game.isActive(), true);
  assert.equal(game.launchDuration, 3.2);
  assert.equal(game.ejectionDuration, 2.6);
  assert.deepEqual(events.filter(event => event.name === 'cinematic').map(event => event.payload), [{ phase: 'launch', stage: 0 }]);
  assert.equal(events.filter(event => event.name === 'stage').length, 0);

  // Overlapping live hazards and a scoring pickup prove the intro does not
  // process collisions, even if input or stale combat objects reach the engine.
  game.player.invincible = 0;
  game.player.weaponLevel = 3;
  game.enemyBullets.push(bulletAt(game.player));
  game.pickups.push({ x: game.player.x, y: game.player.y, r: 12, type: 'power', t: 0 });
  const before = snapshot(game);
  game.moveBy(100, -100);
  game.shoot();
  game.hurt();
  advance(game, 3, 0.25);
  assert.deepEqual({ ...snapshot(game), cinematicTime: 0 }, before);
  assert.equal(events.filter(event => ['stage', 'shot', 'hurt', 'pickup'].includes(event.name)).length, 0);
  assert.deepEqual(events.filter(event => event.name === 'progression').map(event => event.payload), [{ version: 2, totalXp: 0 }], 'new runs durably reset growth before launching');
  assert.ok(Math.abs(game.cinematicTime - 3) < 1e-8);

  game.update(0.2);
  assert.equal(game.state, 'playing');
  assert.equal(game.cinematicTime, game.launchDuration);
  assert.equal(game.totalTime, 0);
  assert.equal(game.stageTime, 0);
  assert.equal(game.wave, 0);
  assert.equal(game.enemies.length, 0);
  assert.equal(game.playerBullets.length, 0, 'takeoff must not shoot in its final frame');
  assert.deepEqual(events.filter(event => event.name === 'stage').map(event => event.payload), [{ stage: 0, name: STAGES[0].name }]);
  game.enemyBullets = [];
  game.pickups = [];
  game.update(STEP);
  assert.equal(events.filter(event => event.name === 'shot').length, 1);
  assert.ok(game.totalTime > 0);
});

test('lethal collision ejects the pilot while the battlefield freezes, then settles exactly once', () => {
  const events = [];
  const game = quietGame({ bestScore: 30, onEvent: (name, payload) => events.push({ name, payload }) });
  game.spawnWave();
  game.score = 800;
  game.player.hp = 1;
  game.player.invincible = 0;
  game.enemyBullets.push(bulletAt(game.player), bulletAt(game.player));
  game.update(STEP);
  assert.equal(game.state, 'ejecting');
  assert.equal(game.isActive(), true);
  assert.equal(game.player.hp, 0);
  assert.equal(game.cinematicTime, 0);
  assert.equal(game.bestScore, 800, 'the death boundary records the score even if ejection is interrupted');
  assert.deepEqual(events.filter(event => event.name === 'cinematic').map(event => event.payload), [
    { phase: 'launch', stage: 0 }, { phase: 'eject', stage: 0 }
  ]);
  assert.equal(events.filter(event => event.name === 'gameover').length, 0);

  // Remove immunity to verify stale repeated hits are rejected by the ejection
  // state itself, rather than incidentally by the ordinary invulnerability timer.
  game.player.invincible = 0;
  const frozen = snapshot(game);
  const eventCount = events.length;
  game.hurt();
  game.hurt();
  game.shoot();
  game.moveBy(-100, -100);
  advance(game, 2.59, 0.25);
  assert.deepEqual({ ...snapshot(game), cinematicTime: 0 }, frozen);
  assert.equal(events.length, eventCount);

  game.update(0.01);
  assert.equal(game.state, 'gameover');
  assert.equal(game.isActive(), false);
  assert.equal(game.cinematicTime, game.ejectionDuration);
  assert.equal(game.bestScore, 800);
  assert.deepEqual(events.filter(event => event.name === 'gameover').map(event => event.payload), [{ score: 800, stage: 0, kills: 0 }]);
  const settled = snapshot(game);
  advance(game, 5, 0.25);
  game.hurt();
  game.pause();
  game.resume();
  assert.deepEqual(snapshot(game), settled);
  assert.equal(events.filter(event => event.name === 'gameover').length, 1);
  assert.equal(events.filter(event => event.name === 'cinematic' && event.payload.phase === 'eject').length, 1);
});

test('both cinematics pause and resume at the same point without restarting their events', () => {
  for (const state of ['launching', 'ejecting']) {
    const events = [];
    const game = new Game({ onEvent: (name, payload) => events.push({ name, payload }) });
    game.start();
    if (state === 'ejecting') {
      advance(game, game.launchDuration);
      game.player.hp = 1;
      game.player.invincible = 0;
      game.enemyBullets.push(bulletAt(game.player));
      game.update(STEP);
    }
    advance(game, 0.5, 0.25);
    const before = snapshot(game);
    game.pause();
    assert.equal(game.pausedFrom, state);
    assert.equal(game.isActive(), false);
    const paused = snapshot(game);
    const eventCount = events.length;
    game.pause();
    advance(game, 4, 0.25);
    assert.deepEqual(snapshot(game), paused);
    assert.equal(events.length, eventCount);
    game.resume();
    assert.deepEqual(snapshot(game), before);
    assert.equal(game.isActive(), true);
    const duration = state === 'launching' ? game.launchDuration : game.ejectionDuration;
    advance(game, duration - 0.5);
    assert.equal(game.state, state === 'launching' ? 'playing' : 'gameover');
    assert.equal(game.cinematicTime, duration);
    assert.equal(events.filter(event => event.name === 'cinematic' && event.payload.phase === (state === 'launching' ? 'launch' : 'eject')).length, 1);
  }
});

test('restart and home discard paused cinematics without retaining dead or orphaned growth', () => {
  const events = [];
  const game = new Game({ profile: { version: 2, totalXp: 160 }, onEvent: (name, payload) => events.push({ name, payload }) });
  for (const state of ['launching', 'ejecting']) {
    game.start();
    if (state === 'ejecting') {
      advance(game, game.launchDuration);
      game.player.hp = 1;
      game.player.invincible = 0;
      game.enemyBullets.push(bulletAt(game.player));
      game.update(STEP);
    }
    game.update(0.25);
    game.pause();
    assert.equal(game.pausedFrom, state);
    game.start();
    assert.equal(game.state, 'launching');
    assert.equal(game.cinematicTime, 0);
    assert.equal(game.pausedFrom, null);
    assert.equal(game.totalTime, 0);
    assert.equal(game.player.hp, game.player.maxHp);
    assert.deepEqual(game.getProfile(), { version: 2, totalXp: 0 });
    game.update(0.25);
    game.pause();
    game.home();
    assert.equal(game.state, 'menu');
    assert.equal(game.cinematicTime, 0);
    assert.equal(game.pausedFrom, null);
    assert.equal(game.isActive(), false);
    game.resume();
    assert.equal(game.state, 'menu');
  }
  assert.equal(events.filter(event => event.name === 'cinematic' && event.payload.phase === 'launch').length, 4);
  assert.equal(events.filter(event => event.name === 'gameover').length, 0, 'abandoning ejection must not settle the discarded run later');
});

test('cinematic timing validates frame gaps and gives the final animation frame no combat time', () => {
  const game = new Game();
  game.start();
  const before = snapshot(game);
  for (const dt of [NaN, -1, Infinity, undefined]) assert.throws(() => game.update(dt), /finite non-negative number/);
  assert.throws(() => game.update(0.250001), /exceeds 250 ms/);
  game.update(0);
  assert.deepEqual(snapshot(game), before);
  advance(game, 3.1, 0.25);
  game.update(0.25);
  assert.equal(game.state, 'playing');
  assert.equal(game.totalTime, 0);
  assert.equal(game.stageTime, 0);
  assert.equal(game.playerBullets.length, 0);
  game.update(0.25);
  assert.ok(Math.abs(game.totalTime - 0.25) < 1e-8, 'the next combat frame must receive its full elapsed time');
});

test('automatic fire starts without movement and continues while the player stays still', () => {
  const shots = [];
  const game = started({ onEvent: (name, data) => { if (name === 'shot') shots.push(data); } });
  const origin = { x: game.player.x, y: game.player.y };

  game.update(STEP);
  assert.equal(shots.length, 1);
  assert.equal(game.playerBullets.length, 2);
  assert.ok(game.playerBullets.every(bullet => bullet.vy < 0 && bullet.y < origin.y));
  advance(game, 0.5);
  assert.ok(shots.length >= 4, 'a stationary player must keep shooting');
  assert.deepEqual({ x: game.player.x, y: game.player.y }, origin);
  assert.ok(shots.every(shot => shot.x === origin.x && shot.y === origin.y));
});

test('movement is relative, stays within every play boundary, and ignores inactive play', () => {
  const game = started();
  const origin = { x: game.player.x, y: game.player.y };
  game.moveBy(12, -18);
  game.moveBy(-3, 5);
  assert.equal(game.player.x, origin.x + 9);
  assert.equal(game.player.y, origin.y - 13);

  game.moveBy(-10000, -10000);
  assert.equal(game.player.x, 21);
  assert.equal(game.player.y, 104);
  game.moveBy(10000, 10000);
  assert.equal(game.player.x, WIDTH - 21);
  assert.equal(game.player.y, HEIGHT - 42);

  game.pause();
  const paused = snapshot(game);
  game.moveBy(-50, -50);
  assert.deepEqual(snapshot(game), paused);
  assert.throws(() => game.moveBy(NaN, 0), /Movement delta must be finite/);
  assert.throws(() => game.moveBy(0, Infinity), /Movement delta must be finite/);
});

test('pause freezes the entire simulation and resume continues it without resetting the run', () => {
  const events = [];
  const game = started({ onEvent: name => events.push(name) });
  advance(game, 2);
  assert.ok(game.enemies.length > 0);
  game.pause();
  const paused = snapshot(game);
  const eventCount = events.length;
  for (let i = 0; i < 12; i++) game.update(0.25);
  assert.deepEqual(snapshot(game), paused);
  assert.equal(events.length, eventCount);

  const enemy = game.enemies[0];
  const enemyY = enemy.y;
  game.resume();
  assert.equal(game.state, 'playing');
  assert.equal(game.totalTime, paused.totalTime);
  game.update(0.25);
  assert.ok(game.totalTime > paused.totalTime);
  assert.ok(enemy.y > enemyY);
  assert.equal(game.wave, paused.wave);
});

test('invalid time steps fail explicitly, including while paused, and zero is a no-op', () => {
  const game = started();
  const before = snapshot(game);
  game.update(0);
  assert.deepEqual(snapshot(game), before);
  for (const dt of [-0.001, NaN, Infinity, -Infinity, undefined, null, '0.016']) {
    assert.throws(() => game.update(dt), /finite non-negative number/);
  }
  assert.throws(() => game.update(0.250001), /exceeds 250 ms/);
  assert.doesNotThrow(() => game.update(0.25));
  game.pause();
  assert.throws(() => game.update(1), /exceeds 250 ms/);
});

test('overlapping hostile bullets cause one hit, then temporary immunity expires', () => {
  const hurts = [];
  const game = quietGame({ onEvent: (name, data) => { if (name === 'hurt') hurts.push(data.hp); } });
  game.player.invincible = 0;
  const initialHp = game.player.hp;
  game.enemyBullets.push(bulletAt(game.player), bulletAt(game.player));
  game.update(STEP);
  assert.equal(game.player.hp, initialHp - 1);
  assert.equal(game.enemyBullets.length, 0);
  assert.ok(game.player.invincible > 0);
  assert.deepEqual(hurts, [initialHp - 1]);

  game.enemyBullets.push(bulletAt(game.player));
  game.update(STEP);
  assert.equal(game.player.hp, initialHp - 1);
  advance(game, 1.6);
  assert.equal(game.player.invincible, 0);
  game.enemyBullets.push(bulletAt(game.player));
  game.update(STEP);
  assert.equal(game.player.hp, initialHp - 2);
  assert.deepEqual(hurts, [initialHp - 1, initialHp - 2]);
});

test('contact with an enemy damages the player and removes the colliding regular enemy', () => {
  const game = quietGame();
  game.spawnWave();
  const enemy = game.enemies[0];
  game.enemies = [enemy];
  Object.assign(enemy, {
    x: game.player.x, baseX: game.player.x, y: game.player.y,
    speed: 0, sway: 0, fireTimer: 100
  });
  game.player.invincible = 0;
  const initialHp = game.player.hp;
  game.update(STEP);
  assert.equal(game.player.hp, initialHp - 1);
  assert.equal(game.enemies.length, 0);
  assert.equal(game.kills, 0, 'contact destruction must not count as a shot-down enemy');
});

test('multiple shots hitting the same enemy award a kill and score only once', () => {
  const explosions = [];
  const game = quietGame({ onEvent: (name, data) => { if (name === 'explosion') explosions.push(data); } });
  game.spawnWave();
  const enemy = game.enemies[0];
  game.enemies = [enemy];
  Object.assign(enemy, { x: 150, baseX: 150, y: 250, hp: 1, speed: 0, sway: 0, fireTimer: 100 });
  game.playerBullets.push(bulletAt(enemy), bulletAt(enemy));
  game.update(STEP);
  assert.equal(game.kills, 1);
  assert.equal(game.score, 80);
  assert.equal(game.getProfile().totalXp, 10, 'the destroyed scout awards experience once');
  assert.equal(game.enemies.length, 0);
  assert.equal(explosions.length, 1);
  advance(game, 0.25);
  assert.equal(game.kills, 1);
  assert.equal(game.score, 80);
  assert.equal(game.getProfile().totalXp, 10);
  assert.equal(explosions.length, 1);
});

test('repair pickups heal once and cannot exceed maximum armor', () => {
  const pickups = [];
  const game = quietGame({ onEvent: (name, data) => { if (name === 'pickup') pickups.push(data.type); } });
  const collectRepair = () => {
    game.pickups.push({ x: game.player.x, y: game.player.y, r: 12, type: 'repair', t: 0 });
    game.update(STEP);
  };
  game.player.hp = game.player.maxHp - 1;
  collectRepair();
  assert.equal(game.player.hp, game.player.maxHp);
  assert.equal(game.pickups.length, 0);
  advance(game, 0.1);
  assert.deepEqual(pickups, ['repair']);
  collectRepair();
  assert.equal(game.player.hp, game.player.maxHp);
  assert.deepEqual(pickups, ['repair', 'repair']);
});

test('power pickups add usable firing lanes, cap weapon level, then award points', () => {
  const game = quietGame();
  const collectPower = () => {
    game.pickups.push({ x: game.player.x, y: game.player.y, r: 12, type: 'power', t: 0 });
    game.update(STEP);
  };
  collectPower();
  assert.equal(game.player.weaponLevel, 2);
  game.playerBullets = [];
  game.fireTimer = 0;
  game.update(STEP);
  assert.equal(game.playerBullets.length, 4);
  assert.ok(game.playerBullets.some(bullet => bullet.vx < 0));
  assert.ok(game.playerBullets.some(bullet => bullet.vx > 0));

  collectPower();
  assert.equal(game.player.weaponLevel, 3);
  game.playerBullets = [];
  game.fireTimer = 0;
  game.update(STEP);
  assert.equal(game.playerBullets.length, 5);
  const score = game.score;
  collectPower();
  assert.equal(game.player.weaponLevel, 3);
  assert.equal(game.score, score + 150);
});

test('the first wave follows its timer rather than appearing at startup', () => {
  const game = started();
  advance(game, 1.19);
  assert.equal(game.wave, 0);
  assert.equal(game.enemies.length, 0);
  game.update(0.02);
  assert.equal(game.wave, 1);
  assert.ok(game.enemies.length > 0);
  assert.ok(game.enemies.every(enemy => enemy.type !== 'boss'));
});

test('real wave scheduling reaches all 100 bosses, 99 upgrade screens, and final victory', () => {
  const transitions = [];
  const bossEvents = [];
  const bossLifecycle = [];
  const game = started({
    seed: 829,
    onEvent: (name, data) => {
      if (name === 'state') transitions.push(data.state);
      if (name === 'stage' && data.boss) bossEvents.push(data.stage);
      if (name === 'boss') bossLifecycle.push(data);
    }
  });
  let observedKills = 0;

  for (let stage = 0; stage < STAGES.length; stage++) {
    assert.equal(game.stage, stage);
    assert.equal(game.state, 'playing');
    assert.equal(game.wave, 0);
    assert.equal(game.bossSpawned, false);
    assert.equal(game.bossWarningTime, 0, 'each stage starts without a stale boss warning');
    const waves = new Set();
    const spawned = new Set();
    let bossCount = 0;

    // Lifecycle fixture, not a difficulty/playability test: retain real wave
    // timers and boss generation, grant immunity, and replace player aiming
    // with stationary test projectiles once each generated target is visible.
    game.player.invincible = 10000;
    game.fireTimer = 10000;
    for (let frame = 0; frame < 2000 && game.state === 'playing'; frame++) {
      if (game.wave > 0) waves.add(game.wave);
      game.playerBullets = [];
      game.playerBeams = [];
      game.pickups = [];
      game.fireTimer = 10000; // Loot must not re-enable autonomous aiming in this lifecycle fixture.
      for (const enemy of game.enemies) {
        if (!spawned.has(enemy.id)) {
          spawned.add(enemy.id);
          if (enemy.type === 'boss') {
            bossCount++;
            assert.equal(game.wave, STAGES[stage].waves, 'boss must wait for all waves');
            assert.ok(game.enemies.every(item => item.type === 'boss'), 'regular enemies must clear before the boss');
            assert.ok(game.bossWarningTime > 0 && game.bossWarningTime <= game.bossWarningDuration, 'the naturally spawned boss must activate its warning');
            assert.deepEqual(bossLifecycle.at(-1), { phase: 'appeared', stage, enemyId: enemy.id });
          }
        }
        if (enemy.y >= (enemy.type === 'boss' ? 160 : enemy.r) && enemy.x >= enemy.r && enemy.x <= WIDTH - enemy.r) {
          enemy.hp = 1;
          game.playerBullets.push(bulletAt(enemy));
        }
      }
      game.update(0.25);
    }

    assert.equal(waves.size, STAGES[stage].waves);
    assert.equal(bossCount, 1);
    assert.equal(game.state, stage === STAGES.length - 1 ? 'victory' : 'upgrade', 'stage must finish within the bounded simulation');
    assert.equal(game.enemies.length, 0);
    assert.equal(game.enemyBullets.length, 0);
    assert.equal(game.playerBullets.length, 0);
    assert.equal(game.bossWarningTime, 0, 'boss defeat clears the warning before upgrade or victory is shown');
    const stageBossEvents = bossLifecycle.filter(event => event.stage === stage);
    assert.deepEqual(stageBossEvents.map(event => event.phase), ['appeared', 'defeated']);
    assert.equal(stageBossEvents[0].enemyId, stageBossEvents[1].enemyId, 'appearance and defeat identify the same generated boss');
    observedKills += spawned.size;
    assert.equal(game.kills, observedKills);

    if (game.state === 'upgrade') {
      const before = snapshot(game);
      game.update(0.25);
      assert.deepEqual(snapshot(game), before, 'upgrade selection must freeze combat');
      game.chooseUpgrade(stage === 0 ? 'spread' : 'rapid');
      if (stage === 0) {
        if (before.player.weaponLevel === 3) assert.ok(game.damageBonus > before.damageBonus);
        else assert.equal(game.player.weaponLevel, before.player.weaponLevel + 1);
      } else assert.equal(game.player.weaponLevel, before.player.weaponLevel);
      assert.equal(game.player.x, WIDTH / 2);
      assert.equal(game.player.y, 596);
      if (stage === 1) assert.ok(game.fireInterval < 0.16);
    }
  }

  assert.deepEqual(bossEvents, Array.from({ length: 100 }, (_, index) => index));
  assert.equal(bossLifecycle.length, STAGES.length * 2, 'each stage has exactly one appearance and one defeat event');
  assert.deepEqual(transitions, ['launching', 'playing', ...Array.from({ length: 99 }, () => ['upgrade', 'playing']).flat(), 'victory']);
  assert.ok(game.score > 0);
  assert.equal(game.bestScore, game.score);
  const victory = snapshot(game);
  game.update(0.25);
  assert.deepEqual(snapshot(game), victory);
});

test('invalid upgrades fail without changing state, score, or the current stage', () => {
  const game = started();
  assert.throws(() => game.chooseUpgrade('spread'), /only available after completing a stage/);
  // Isolated menu fixture; the preceding integration test reaches it naturally.
  game.setState('upgrade');
  const before = snapshot(game);
  for (const id of ['unknown', '', undefined, null]) {
    assert.throws(() => game.chooseUpgrade(id), /Unknown upgrade/);
    assert.deepEqual(snapshot(game), before);
  }
});

test('repair upgrade increases armor capacity and heals by the advertised amount', () => {
  const game = started();
  game.player.hp = 1;
  game.setState('upgrade');
  game.chooseUpgrade('repair');
  assert.equal(game.player.maxHp, 6);
  assert.equal(game.player.hp, 4);
  assert.equal(game.stage, 1);
  assert.equal(game.state, 'playing');
});

test('lethal damage records the highest score immediately, shows results after ejection, and restart clears run growth', () => {
  const game = quietGame({ seed: 123, bestScore: 500 });
  game.addExperience(165);
  game.setState('upgrade');
  game.chooseUpgrade('rapid');
  game.score = 740;
  game.kills = 12;
  game.player.weaponLevel = 3;
  game.player.hp = 1;
  game.player.invincible = 0;
  game.enemyBullets.push(bulletAt(game.player));
  game.update(STEP);
  assert.equal(game.state, 'ejecting');
  assert.equal(game.bestScore, 740, 'the fatal hit records the completed score before ejection finishes');
  advance(game, game.ejectionDuration);
  assert.equal(game.state, 'gameover');
  assert.equal(game.player.hp, 0);
  assert.equal(game.bestScore, 740);
  const gameover = snapshot(game);
  game.update(0.25);
  assert.deepEqual(snapshot(game), gameover);

  const earnedProfile = game.getProfile();
  game.start();
  assert.equal(game.state, 'launching');
  advance(game, game.launchDuration);
  const fresh = started({ seed: 123, bestScore: 740, profile: earnedProfile });
  assert.deepEqual(snapshot(game), snapshot(fresh));
  game.score = 20;
  game.player.hp = 1;
  game.player.invincible = 0;
  game.enemyBullets.push(bulletAt(game.player));
  game.update(STEP);
  advance(game, game.ejectionDuration);
  assert.equal(game.state, 'gameover');
  assert.equal(game.bestScore, 740, 'a worse run must not replace the record');
});

test('a fixed seed reproduces waves and the same input replay', () => {
  const first = started({ seed: 913 });
  const replay = started({ seed: 913 });
  const different = started({ seed: 914 });
  for (const game of [first, replay, different]) advance(game, 1.25);
  assert.deepEqual(first.enemies, replay.enemies);
  assert.notDeepEqual(first.enemies, different.enemies, 'the seed must influence generated enemy behavior');
  for (let frame = 0; frame < 360; frame++) {
    const dx = frame % 60 < 30 ? 1 : -1;
    for (const game of [first, replay]) {
      game.moveBy(dx, 0);
      game.update(1 / 60);
    }
  }
  assert.deepEqual(snapshot(first), snapshot(replay));
});

test('4 FPS updates preserve gameplay outcomes and projectile motion through fixed substeps', () => {
  const slowEvents = [];
  const fastEvents = [];
  const slow = started({ seed: 512, onEvent: name => slowEvents.push(name) });
  const fast = started({ seed: 512, onEvent: name => fastEvents.push(name) });
  advance(slow, 12, 0.25);
  advance(fast, 12, STEP);
  assert.deepEqual(slowEvents, fastEvents);
  for (const key of ['state', 'wave', 'kills', 'score', 'randomState']) assert.equal(slow[key], fast[key], key);
  assert.equal(slow.player.hp, fast.player.hp);
  assert.ok(Math.abs(slow.totalTime - fast.totalTime) < 1e-8);
  for (const key of ['enemies', 'playerBullets', 'enemyBullets']) {
    assert.equal(slow[key].length, fast[key].length, key + ' count');
    for (let i = 0; i < slow[key].length; i++) {
      assert.ok(Math.abs(slow[key][i].x - fast[key][i].x) < 1e-7, key + ' x at ' + i);
      assert.ok(Math.abs(slow[key][i].y - fast[key][i].y) < 1e-7, key + ' y at ' + i);
    }
  }
});

test('pilot profiles validate their schema, numeric safety, and copy ownership', () => {
  assert.deepEqual(new Game().getProfile(), { version: 2, totalXp: 0 });
  for (const profile of [
    null, [], 'profile', {}, { version: 2 }, { totalXp: 0 },
    { version: 1, totalXp: 0 }, { version: '2', totalXp: 0 },
    ...[-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '60'].map(totalXp => ({ version: 2, totalXp }))
  ]) assert.throws(() => new Game({ profile }), undefined, 'invalid profile: ' + JSON.stringify(profile));

  const source = started();
  source.addExperience(301);
  source.captureCheckpoint();
  const input = { version: 2, totalXp: 301 };
  const game = new Game({ profile: input, checkpoint: source.getCheckpoint() });
  input.totalXp = 900;
  assert.equal(game.getProfile().totalXp, 301, 'caller mutation must not change the loaded profile');
  const exported = game.getProfile();
  exported.totalXp = 1000;
  assert.equal(game.getProfile().totalXp, 301, 'getProfile must return an independent value');
  assert.equal(game.progression.level, 2);
  assert.equal(game.progression.xp, 1);
  assert.equal(game.progression.nextXp, 500);
});

test('experience carries across boundaries and can unlock several ship levels in one award', () => {
  const events = [];
  const game = started({ onEvent: (name, payload) => events.push({ name, payload }) });
  game.addExperience(299);
  events.length = 0;
  game.addExperience(1);
  assert.equal(game.progression.level, 2);
  assert.equal(game.progression.xp, 0);
  assert.equal(game.progression.nextXp, 500);
  assert.equal(game.player.shipLevel, 2);
  game.addExperience(1205);
  assert.equal(game.progression.level, 4);
  assert.equal(game.progression.xp, 5);
  assert.equal(game.progression.nextXp, 900);
  assert.equal(game.progression.totalXp, 1505);
  assert.equal(game.getProfile().totalXp, 1505);
  assert.equal(game.player.shipLevel, 4);
  assert.equal(game.player.tier, 2);
  assert.equal(game.progression.title, '流星');
  assert.equal(events.filter(event => event.name === 'progression').length, 2);
  assert.ok(events.some(event => event.name === 'levelup'));
  const levelUpEvents = events.filter(event => event.name === 'levelup').length;
  game.addExperience(1);
  assert.equal(events.filter(event => event.name === 'progression').length, 3, 'every award must be observable for immediate persistence');
  assert.equal(events.filter(event => event.name === 'levelup').length, levelUpEvents, 'an award within the same level is not a level-up');
});

test('ship tier unlocks occur at the documented cumulative experience boundaries', () => {
  for (const [totalXp, level, tier, title] of [
    [0, 1, 1, '游隼'], [799, 2, 1, '银翼'], [800, 3, 2, '破晓'],
    [3499, 5, 2, '远征'], [3500, 6, 3, '雷霆'], [9899, 9, 3, '极光'], [9900, 10, 4, '星曜'],
    [39899, 19, 4, '星舰'], [39900, 20, 4, '寰宇']
  ]) {
    const game = started();
    if (totalXp > 0) game.addExperience(totalXp);
    assert.equal(game.progression.level, level, 'level for total experience ' + totalXp);
    assert.equal(game.progression.tier, tier);
    assert.equal(game.progression.title, title);
    assert.equal(game.player.shipLevel, level);
    assert.equal(game.player.tier, tier);
  }
});

test('clearing every first-mission target unlocks level two and only two unreinforced special weapons', () => {
  const game = quietGame();
  // Reward-budget fixture: all enemies are generated by the real first-stage
  // roster. Difficulty and actual firing are covered separately.
  for (let wave = 0; wave < game.waveCount; wave++) {
    game.wave = wave;
    game.spawnWave();
    for (const enemy of game.enemies) game.destroyEnemy(enemy);
    game.enemies = [];
  }
  game.spawnBoss();
  game.destroyEnemy(game.enemies[0]);
  assert.equal(game.state, 'upgrade');
  assert.equal(game.kills, 30);
  assert.equal(game.getProfile().totalXp, 568);
  assert.equal(game.progression.level, 2, 'even a perfect first stage cannot prematurely unlock three or four mount slots');
  assert.deepEqual(game.pickups.map(pickup => pickup.weapon), ['laser', 'homing']);
  assert.equal(game.getCombatStats().mountSlots, 2);
  assert.deepEqual(game.player.weapons, { gun: 1, laser: 0, homing: 0, explosive: 0 }, 'uncollected drops cannot automatically strengthen the player');
});

test('invalid experience awards and cumulative overflow fail without corrupting the profile', () => {
  const game = started();
  game.addExperience(60);
  const before = snapshot(game);
  for (const amount of [0, -1, 0.25, NaN, Infinity, '10', undefined, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => game.addExperience(amount));
    assert.deepEqual(snapshot(game), before);
  }
  assert.throws(() => game.addExperience(Number.MAX_SAFE_INTEGER), undefined, 'adding individually safe values must still check the sum');
  assert.deepEqual(snapshot(game), before);
});

test('surviving boundary growth resumes, while new runs and orphaned profiles start at level one', () => {
  const game = started();
  game.addExperience(1505);
  game.spawnBoss();
  game.destroyEnemy(game.enemies.find(enemy => enemy.type === 'boss'));
  game.chooseUpgrade('spread');
  const profile = game.getProfile();
  const checkpoint = game.getCheckpoint();
  assert.equal(game.runStartXp, 0);
  game.addExperience(16);
  game.home();
  assert.equal(game.state, 'menu');
  assert.deepEqual(game.getProfile(), profile, 'returning to the hangar rolls back unfinished stage XP together with waves');
  const reloaded = new Game({ profile, checkpoint });
  assert.deepEqual(reloaded.getProfile(), profile);
  assert.equal(reloaded.continueRun(), true);
  assert.equal(reloaded.player.shipLevel, 4);
  assert.equal(reloaded.stage, 1);
  reloaded.start();
  assert.equal(reloaded.runStartXp, 0);
  assert.deepEqual(reloaded.getProfile(), { version: 2, totalXp: 0 });
  assert.equal(reloaded.player.shipLevel, 1);
  assert.equal(reloaded.stage, 0);
  const orphaned = new Game({ profile });
  assert.deepEqual(orphaned.getProfile(), { version: 2, totalXp: 0 });
  assert.equal(orphaned.progression.level, 1);
  assert.equal(orphaned.continueRun(), false);
});

test('current run ship levels increase real projectile damage and stack with run upgrades', () => {
  const game = quietGame();
  game.addExperience(3500);
  game.update(STEP);
  assert.equal(game.player.shipLevel, 6);
  assert.equal(game.playerBullets.length, 2);
  assert.ok(game.playerBullets.every(bullet => Math.abs(bullet.damage - 1.6) < 1e-10));
  game.damageBonus = 0.4;
  game.playerBullets = [];
  game.fireTimer = 0;
  game.update(STEP);
  assert.ok(game.playerBullets.every(bullet => Math.abs(bullet.damage - 2) < 1e-10));
});

test('a level-up heals one armor, expands current run capacity, and a fresh run resets every strength upgrade', () => {
  const game = quietGame();
  game.addExperience(3499);
  game.setState('upgrade');
  game.chooseUpgrade('repair');
  assert.equal(game.player.maxHp, 6);
  game.player.hp = 2;
  game.addExperience(1);
  assert.equal(game.player.shipLevel, 6);
  assert.equal(game.player.maxHp, 7, 'current run growth stacks with the chosen armor upgrade');
  assert.equal(game.player.hp, 3);
  game.addExperience(1);
  assert.equal(game.player.hp, 3, 'ordinary experience gains must not repeatedly heal');
  game.start();
  assert.equal(game.player.maxHp, 5, 'restart removes all growth and armor upgrades');
  assert.equal(game.player.hp, 5);
});

function generatedEncounter(type, options = {}) {
  const game = quietGame(options);
  game.fireTimer = 10000;
  game.player.invincible = 10000;
  // Isolated combat fixture: select a real generated enemy without duplicating
  // its model or replacing its attack implementation.
  if (type === 'boss') game.spawnBoss();
  else {
    for (let wave = 0; wave < game.waveCount && !game.enemies.some(enemy => enemy.type === type); wave++) {
      game.wave = wave;
      game.spawnWave();
    }
  }
  const enemy = game.enemies.find(item => item.type === type);
  assert.ok(enemy, 'the wave generator must provide a ' + type);
  game.enemies = [enemy];
  return { game, enemy };
}

test('naturally scheduled waves contain fighters, warships, and planetary weapons', () => {
  const game = started();
  game.fireTimer = 10000;
  game.player.invincible = 10000;
  const roster = new Map();
  for (let frame = 0; frame < 120; frame++) {
    game.update(0.25);
    for (const enemy of game.enemies) roster.set(enemy.type, enemy.r);
  }
  assert.ok(roster.has('scout'));
  assert.ok(roster.has('striker'));
  assert.equal(roster.get('warship'), 34);
  assert.equal(roster.get('planet'), 43);
  assert.equal(roster.has('tank'), false, 'the warship replaces the old tank enemy');
});

test('planetary weapons enter position, telegraph a locked aim, then fire five plasma projectiles', () => {
  const { game, enemy } = generatedEncounter('planet');
  game.moveBy(-100, 0);
  const arrivalTimer = enemy.fireTimer;
  for (let frame = 0; frame < 2000 && enemy.y < 124; frame++) {
    game.update(STEP);
    assert.equal(game.enemyBullets.length, 0, 'the planetary weapon must not fire during entry');
    if (enemy.y < 124) {
      assert.equal(enemy.fireTimer, arrivalTimer, 'the charge timer starts only after arrival');
      assert.equal(enemy.charge, 0);
      assert.equal(enemy.aimLocked, false);
    }
  }
  assert.equal(enemy.y, 124, 'the planetary weapon must settle at its firing position');
  for (let frame = 0; frame < 1000 && !enemy.aimLocked; frame++) game.update(STEP);
  assert.equal(enemy.aimLocked, true);
  assert.ok(enemy.charge >= 0 && enemy.charge <= 1);
  assert.ok(enemy.fireTimer <= 0.9 && enemy.fireTimer > 0);
  const lockedAngle = enemy.aimAngle;
  assert.ok(Math.abs(lockedAngle - Math.atan2(game.player.y - enemy.y, game.player.x - enemy.x)) < 1e-8);
  game.moveBy(220, 0);
  assert.ok(Math.abs(lockedAngle - Math.atan2(game.player.y - enemy.y, game.player.x - enemy.x)) > 0.1);
  let maximumCharge = enemy.charge;
  for (let frame = 0; frame < 200 && game.enemyBullets.length === 0; frame++) {
    game.update(STEP);
    if (game.enemyBullets.length === 0) {
      assert.equal(enemy.aimAngle, lockedAngle, 'the warning must predict the shot even when the player moves');
      assert.ok(enemy.charge >= maximumCharge && enemy.charge <= 1);
      maximumCharge = enemy.charge;
    }
  }
  assert.ok(maximumCharge > 0.9, 'the warning should reach full charge before firing');
  assert.equal(game.enemyBullets.length, 5);
  assert.ok(game.enemyBullets.every(bullet => bullet.kind === 'plasma'));
  assert.ok(game.enemyBullets.every(bullet => Math.abs(Math.hypot(bullet.vx, bullet.vy) - 130) < 1e-8));
  const center = game.enemyBullets[2];
  assert.equal(center.r, 8);
  assert.ok(Math.abs(Math.atan2(center.vy, center.vx) - lockedAngle) < 1e-8);
  assert.equal(enemy.charge, 0);
  assert.equal(enemy.aimLocked, false);
  assert.ok(enemy.fireTimer > 3.7 && enemy.fireTimer <= 3.8);
});

test('warships fire paired three-shot guns while fighters use orb projectiles', () => {
  const { game, enemy } = generatedEncounter('warship');
  game.enemyShoot(enemy);
  assert.equal(game.enemyBullets.length, 6);
  assert.ok(game.enemyBullets.every(bullet => bullet.kind === 'bolt'));
  const guns = new Map();
  for (const bullet of game.enemyBullets) guns.set(bullet.x, (guns.get(bullet.x) || 0) + 1);
  assert.equal(guns.size, 2);
  assert.deepEqual([...guns.values()], [3, 3]);
  for (const type of ['scout', 'striker']) {
    const fighter = generatedEncounter(type);
    fighter.game.enemyShoot(fighter.enemy);
    assert.ok(fighter.game.enemyBullets.length > 0);
    assert.ok(fighter.game.enemyBullets.every(bullet => bullet.kind === 'orb'));
  }
});

test('every enemy class grants its documented experience exactly once through collision handling', () => {
  for (const [type, expectedXp] of [['scout', 10], ['striker', 16], ['warship', 40], ['planet', 60], ['boss', 120]]) {
    const { game, enemy } = generatedEncounter(type);
    Object.assign(enemy, { y: type === 'planet' ? 124 : 160, hp: 1, speed: 0, sway: 0, fireTimer: 100 });
    if (type === 'boss') enemy.x = WIDTH / 2;
    game.playerBullets.push(bulletAt(enemy), bulletAt(enemy));
    game.update(STEP);
    assert.equal(game.kills, 1, type);
    assert.equal(game.getProfile().totalXp, expectedXp, type);
    const afterKill = snapshot(game);
    game.destroyEnemy(enemy);
    assert.deepEqual(snapshot(game), afterKill, 'repeated destruction must be idempotent for ' + type);
    game.update(STEP);
    assert.equal(game.getProfile().totalXp, expectedXp, type + ' must not award twice');
  }
});

test('boss entry warning uses gameplay time, freezes on pause, and expires without retriggering', () => {
  const events = [];
  const { game, enemy } = generatedEncounter('boss', { onEvent: (name, payload) => events.push({ name, payload }) });
  assert.equal(game.bossWarningDuration, 2.4);
  assert.equal(game.bossWarningTime, game.bossWarningDuration);
  const appearance = { phase: 'appeared', stage: 0, enemyId: enemy.id };
  assert.deepEqual(events.filter(event => event.name === 'boss').map(event => event.payload), [appearance]);
  assert.ok(events.some(event => event.name === 'stage' && event.payload.boss), 'the original stage event remains available');

  advance(game, 0.5);
  assert.ok(Math.abs(game.bossWarningTime - 1.9) < 1e-8);
  game.pause();
  const pausedWarning = game.bossWarningTime;
  advance(game, 4);
  assert.equal(game.bossWarningTime, pausedWarning, 'time spent paused cannot consume the entry warning');
  game.resume();
  advance(game, 0.25);
  assert.ok(Math.abs(game.bossWarningTime - (pausedWarning - 0.25)) < 1e-8);
  advance(game, 2);
  assert.equal(game.bossWarningTime, 0);
  advance(game, 4);
  assert.equal(game.bossWarningTime, 0, 'the warning must stay finished while the boss remains alive');
  assert.equal(game.state, 'playing');
  assert.ok(game.enemies.includes(enemy) && enemy.hp > 0);
  assert.deepEqual(events.filter(event => event.name === 'boss').map(event => event.payload), [appearance]);
});

test('boss defeat through overlapping projectiles clears the warning and reports the kill once', () => {
  const lifecycle = [];
  const { game, enemy } = generatedEncounter('boss', { onEvent: (name, payload) => { if (name === 'boss') lifecycle.push(payload); } });
  Object.assign(enemy, { x: WIDTH / 2, y: 160, hp: 1, fireTimer: 100 });
  assert.ok(game.bossWarningTime > 0);
  game.playerBullets.push(bulletAt(enemy), bulletAt(enemy));
  game.update(STEP);
  assert.equal(game.state, 'upgrade');
  assert.equal(game.bossWarningTime, 0);
  assert.deepEqual(lifecycle, [
    { phase: 'appeared', stage: 0, enemyId: enemy.id },
    { phase: 'defeated', stage: 0, enemyId: enemy.id }
  ]);
  const afterKill = snapshot(game);
  game.destroyEnemy(enemy);
  game.destroyEnemy(enemy);
  game.update(0.25);
  assert.deepEqual(snapshot(game), afterKill);
  assert.equal(lifecycle.length, 2, 'repeated destruction cannot emit a second defeat');
  assert.equal(game.kills, 1);
  assert.equal(game.getProfile().totalXp, 120);
});

test('lethal hostile collision clears an active boss warning without announcing a boss defeat', () => {
  const events = [];
  const { game } = generatedEncounter('boss', { onEvent: (name, payload) => events.push({ name, payload }) });
  game.player.hp = 1;
  game.player.invincible = 0;
  game.enemyBullets.push(bulletAt(game.player));
  assert.ok(game.bossWarningTime > 0);
  game.update(STEP);
  assert.equal(game.player.hp, 0);
  assert.equal(game.state, 'ejecting');
  assert.equal(game.bossWarningTime, 0);
  assert.equal(events.filter(event => event.name === 'gameover').length, 0);
  advance(game, game.ejectionDuration);
  assert.equal(game.state, 'gameover');
  assert.equal(events.filter(event => event.name === 'gameover').length, 1);
  assert.equal(events.filter(event => event.name === 'boss' && event.payload.phase === 'defeated').length, 0);
  game.update(0.25);
  assert.equal(game.bossWarningTime, 0);
  assert.equal(events.filter(event => event.name === 'gameover').length, 1);
});

test('fresh menus, restarts, and stage preparation cannot retain a previous boss warning', () => {
  const initial = new Game();
  assert.equal(initial.bossWarningTime, 0);
  for (const action of ['start', 'home', 'prepareStage']) {
    const { game } = generatedEncounter('boss');
    assert.ok(game.bossWarningTime > 0);
    game[action]();
    assert.equal(game.bossWarningTime, 0, action);
    assert.equal(game.bossSpawned, false, action);
    assert.equal(game.enemies.length, 0, action);
  }
});

test('support flies into a separated formation and its own projectiles deal real damage and award kills', () => {
  const { game, enemy } = generatedEncounter('scout');
  Object.assign(enemy, { x: game.player.x - 58, baseX: game.player.x - 58, y: 300, speed: 0, sway: 0, fireTimer: 100 });
  const hp = enemy.hp;
  assert.equal(game.callSupport(), true);
  assert.equal(game.supportCharges, 0);
  assert.equal(game.supportDuration, 8);
  assert.equal(game.allies.length, 2);
  assert.ok(game.allies.every(ally => ally.y > HEIGHT));
  advance(game, 0.5);
  assert.ok(game.allies.every(ally => ally.y < HEIGHT + 70 && ally.y > game.player.y - 64));
  assert.equal(game.playerBullets.length, 0, 'support cannot shoot before arriving in formation');
  advance(game, 0.65);
  assert.ok(enemy.hp < hp && enemy.hp > 0, 'a support projectile must collide and reduce the generated scout health');
  assert.ok(game.playerBullets.length > 0);
  assert.ok(game.playerBullets.every(bullet => bullet.source === 'support'), 'the player gun is disabled in this fixture');
  for (let frame = 0; frame < 480 && game.kills === 0; frame++) game.update(STEP);
  assert.equal(game.kills, 1);
  assert.equal(game.score, 80);
  assert.equal(game.getProfile().totalXp, 10);

  for (const [dx, dy] of [[30, -20], [-10000, -10000], [10000, 10000]]) {
    game.moveBy(dx, dy);
    game.update(STEP);
    for (const ally of game.allies) {
      assert.equal(ally.y, Math.max(40, Math.min(HEIGHT - 110, game.player.y - 64)));
      assert.ok(Math.hypot(ally.x - game.player.x, ally.y - game.player.y) >= 64, 'friendly aircraft must not overlap the player at an edge');
      assert.ok(ally.x >= 24 && ally.x <= WIDTH - 24);
      assert.ok(ally.y >= 40 && ally.y <= HEIGHT - 110, 'both wings remain visible while the player hugs a boundary');
    }
  }
});

test('support freezes on pause, leaves naturally, and reports one end after eight gameplay seconds', () => {
  for (const frame of [STEP, 0.25]) {
    const events = [];
    const game = quietGame({ onEvent: (name, payload) => { if (name === 'ability') events.push(payload); } });
    game.fireTimer = 10000;
    assert.equal(game.callSupport(), true);
    assert.equal(game.callSupport(), false);
    advance(game, 2, frame);
    game.pause();
    const paused = snapshot(game);
    advance(game, 3, 0.25);
    assert.deepEqual(snapshot(game), paused);
    game.resume();
    advance(game, 5.2, frame);
    const formation = game.allies.map(ally => ({ ...ally }));
    assert.equal(formation.length, 2);
    advance(game, 0.4, frame);
    assert.ok(game.allies.every((ally, i) => ally.y < formation[i].y && Math.abs(ally.x - game.player.x) > Math.abs(formation[i].x - game.player.x)));
    assert.equal(events.filter(event => event.phase === 'ended').length, 0);
    advance(game, 0.4, frame);
    assert.equal(game.supportTime, 0);
    assert.deepEqual(game.allies, []);
    advance(game, 1, frame);
    assert.deepEqual(events, [
      { type: 'support', phase: 'called', stage: 0, charges: 0 },
      { type: 'support', phase: 'ended', stage: 0, reason: 'expired' }
    ]);
    assert.equal(game.callSupport(), false, 'expiry does not replenish the stage charge');
  }
});

test('a bomb clears only visible enemies and every hostile bullet while preserving upgrades, friendly support, and loot', () => {
  const events = [];
  const game = quietGame({ onEvent: (name, payload) => { if (name === 'ability') events.push(payload); } });
  for (let wave = 0; wave < 4; wave++) { game.wave = wave; game.spawnWave(); }
  const pool = game.enemies.slice();
  const take = type => pool.splice(pool.findIndex(enemy => enemy.type === type), 1)[0];
  const visible = ['scout', 'striker', 'warship', 'planet'].map((type, i) => Object.assign(take(type), { x: 60 + i * 85, y: 160 }));
  const partial = take('scout');
  Object.assign(partial, { x: 100, y: -partial.r / 2 });
  visible.push(partial);
  const outside = [take('scout'), take('scout'), take('scout'), take('scout')];
  Object.assign(outside[0], { x: -outside[0].r - 1, y: 100 });
  Object.assign(outside[1], { x: WIDTH + outside[1].r + 1, y: 100 });
  Object.assign(outside[2], { x: 100, y: -outside[2].r - 1 });
  Object.assign(outside[3], { x: 100, y: HEIGHT + outside[3].r + 1 });
  game.enemies = [...visible, ...outside];
  game.kills = 11; // The first bomb kill crosses the first, twelve-kill drop boundary.
  const pickup = { x: 40, y: 400, r: 12, type: 'repair', t: 0 };
  game.pickups.push(pickup);
  game.player.weaponLevel = 3;
  game.player.shield = 2;
  game.damageBonus = 0.4;
  game.fireInterval = 0.08;
  const friendlyBullet = bulletAt({ x: 80, y: 400 });
  game.playerBullets.push(friendlyBullet);
  game.enemyBullets.push(bulletAt(game.player), bulletAt({ x: -200, y: -200 }));
  game.callSupport();
  assert.equal(game.useBomb(), true);
  assert.equal(game.state, 'playing');
  assert.equal(game.bombCharges, 0);
  assert.equal(game.bombTime, game.bombDuration);
  assert.equal(game.bombDuration, 0.9);
  assert.deepEqual(game.enemies, outside);
  assert.ok(visible.every(enemy => enemy.hp === 0 && enemy.destroyed));
  assert.ok(outside.every(enemy => enemy.hp > 0 && !enemy.destroyed));
  assert.equal(game.enemyBullets.length, 0);
  assert.equal(game.kills, 16);
  assert.equal(game.score, 1050);
  assert.equal(game.getProfile().totalXp, 136);
  assert.equal(game.pickups[0], pickup);
  assert.equal(game.pickups.length, 2, 'existing loot and a newly dropped pickup must survive the blast');
  assert.equal(game.player.weaponLevel, 3);
  assert.equal(game.player.shield, 2);
  assert.equal(game.damageBonus, 0.4);
  assert.equal(game.fireInterval, 0.08);
  assert.ok(game.playerBullets.includes(friendlyBullet));
  assert.equal(game.allies.length, 2);
  assert.equal(game.supportTime, game.supportDuration);
  assert.deepEqual(events.at(-1), { type: 'bomb', phase: 'detonated', stage: 0, charges: 0, enemies: 5, clearedBullets: 2 });
  const after = snapshot(game);
  assert.equal(game.useBomb(), false);
  assert.deepEqual(snapshot(game), after);
  assert.equal(events.filter(event => event.type === 'bomb').length, 1);
});

test('bombs reward ordinary enemies before the boss, retain screen-external enemies, and finish their flash in results', () => {
  for (const result of ['upgrade', 'victory']) {
    const events = [];
    const game = quietGame({ onEvent: (name, payload) => events.push({ name, payload }) });
    if (result === 'victory') {
      for (let stage = 0; stage < STAGES.length - 1; stage++) {
        game.spawnBoss();
        game.enemies[0].y = 160;
        game.destroyEnemy(game.enemies[0]);
        game.chooseUpgrade('rapid');
      }
    }
    game.spawnBoss();
    const boss = game.enemies.find(enemy => enemy.type === 'boss');
    boss.y = 160;
    game.spawnWave();
    const scouts = game.enemies.filter(enemy => enemy.type === 'scout');
    const regular = scouts[0];
    const outside = scouts[1];
    Object.assign(regular, { x: 100, y: 250 });
    Object.assign(outside, { x: 100, y: -200 });
    game.enemies = [boss, regular, outside]; // Deliberately put the boss first.
    const pickup = { x: 40, y: 400, r: 12, type: 'power', t: 0 };
    game.pickups.push(pickup);
    const score = game.score;
    const xp = game.getProfile().totalXp;
    const kills = game.kills;
    const stage = game.stage;
    events.length = 0;
    game.callSupport();
    assert.equal(game.useBomb(), true);
    assert.equal(game.state, result);
    assert.equal(game.kills, kills + 2);
    assert.equal(game.score, score + 80 + 2000 * (stage + 1));
    assert.equal(game.getProfile().totalXp, result === 'victory' ? 0 : xp + 130);
    if (result === 'victory') assert.equal(game.resultProgression.totalXp, xp + 130, 'the completed run XP is a result statistic, not retained strength');
    assert.deepEqual(events.filter(event => event.name === 'explosion').map(event => event.payload.boss), [false, true]);
    assert.deepEqual(events.filter(event => event.name === 'boss').map(event => event.payload), [{ phase: 'defeated', stage, enemyId: boss.id }]);
    assert.ok(events.some(event => event.name === 'ability' && event.payload.reason === 'stage-complete'));
    assert.ok(game.pickups.includes(pickup));
    assert.deepEqual(game.enemies, [outside]);
    assert.equal(outside.destroyed, undefined);
    assert.equal(game.allies.length, 0);
    const before = snapshot(game);
    game.destroyEnemy(boss);
    game.destroyEnemy(regular);
    assert.equal(game.useBomb(), false);
    assert.deepEqual(snapshot(game), before);
    advance(game, 1, 0.25);
    assert.equal(game.bombTime, 0, 'a result screen must not hold a permanent explosion overlay');
    assert.deepEqual({ ...snapshot(game), bombTime: before.bombTime }, before, 'only the presentation timer may advance in results');
    assert.equal(events.filter(event => event.name === 'boss').length, 1);
    assert.equal(events.filter(event => event.name === 'state' && event.payload.state === result).length, 1);
  }
});

test('all 100 stage transitions retain spent run abilities and clear preceding stage effects', () => {
  const game = quietGame();
  for (let stage = 0; stage < STAGES.length; stage++) {
    assert.equal(game.supportCharges, stage === 0 ? 1 : 0);
    assert.equal(game.bombCharges, stage === 0 ? 1 : 0);
    assert.equal(game.supportTime, 0);
    assert.equal(game.bombTime, 0);
    assert.equal(game.callSupport(), stage === 0);
    game.spawnBoss();
    game.enemies[0].y = 160;
    assert.equal(game.useBomb(), stage === 0);
    if (stage > 0) game.destroyEnemy(game.enemies[0]);
    assert.equal(game.supportCharges, 0);
    assert.equal(game.bombCharges, 0);
    if (stage < STAGES.length - 1) {
      game.chooseUpgrade('spread');
      assert.equal(game.state, 'playing');
      assert.deepEqual(game.allies, []);
    } else assert.equal(game.state, 'victory');
  }
  game.start();
  assert.equal(game.state, 'launching');
  assert.equal(game.supportCharges, 1);
  assert.equal(game.bombCharges, 1);
  assert.equal(game.supportTime, 0);
  assert.equal(game.bombTime, 0);
  game.home();
  assert.equal(game.state, 'menu');
  assert.deepEqual(game.allies, []);
});

test('abilities refuse inactive states and spent charges without mutations, and bombs freeze on pause', () => {
  for (const state of ['menu', 'launching', 'paused', 'ejecting', 'upgrade', 'gameover', 'victory']) {
    const events = [];
    const game = new Game({ onEvent: (name, payload) => events.push({ name, payload }) });
    game.setState(state);
    const before = snapshot(game);
    const count = events.length;
    assert.equal(game.callSupport(), false, state);
    assert.equal(game.useBomb(), false, state);
    assert.deepEqual(snapshot(game), before, state);
    assert.equal(events.length, count);
  }
  const game = quietGame();
  game.callSupport();
  game.useBomb();
  const spent = snapshot(game);
  assert.equal(game.callSupport(), false);
  assert.equal(game.useBomb(), false);
  assert.deepEqual(snapshot(game), spent);
  game.pause();
  const paused = snapshot(game);
  advance(game, 2, 0.25);
  assert.deepEqual(snapshot(game), paused);
  game.resume();
  game.update(0.25);
  assert.ok(Math.abs(game.bombTime - 0.65) < 1e-8);
});

test('fatal collisions end active support once before ejection and restart restores its charge', () => {
  const events = [];
  const game = quietGame({ onEvent: (name, payload) => { if (name === 'ability') events.push(payload); } });
  game.callSupport();
  advance(game, 1);
  game.player.hp = 1;
  game.player.invincible = 0;
  game.enemyBullets.push(bulletAt(game.player));
  game.update(STEP);
  assert.equal(game.state, 'ejecting');
  assert.equal(game.supportTime, 0);
  assert.deepEqual(game.allies, []);
  assert.deepEqual(events.at(-1), { type: 'support', phase: 'ended', stage: 0, reason: 'player-defeated' });
  game.hurt();
  advance(game, game.ejectionDuration);
  assert.equal(events.filter(event => event.phase === 'ended').length, 1);
  game.start();
  assert.equal(game.supportCharges, 1);
  assert.equal(game.bombCharges, 1);
  assert.deepEqual(game.allies, []);
});

test('a large bomb chain keeps particle memory bounded while awarding every kill and preserving drops', () => {
  const game = quietGame();
  for (let wave = 0; wave < 20; wave++) { game.wave = wave % 4; game.spawnWave(); }
  for (const enemy of game.enemies) enemy.y = 200;
  const count = game.enemies.length;
  const xp = game.enemies.reduce((total, enemy) => total + ({ scout: 10, striker: 16, warship: 40, planet: 60 }[enemy.type]), 0);
  const score = game.enemies.reduce((total, enemy) => total + ({ scout: 80, striker: 140, warship: 300, planet: 450 }[enemy.type]), 0);
  assert.ok(count > 50);
  game.useBomb();
  assert.equal(game.kills, count);
  assert.equal(game.score, score);
  assert.equal(game.getProfile().totalXp, xp);
  assert.equal(game.enemies.length, 0);
  assert.equal(game.pickups.length, [12, 26, 42, 60, 80].filter(boundary => boundary <= count).length);
  assert.equal(game.particles.length, 320, 'large simultaneous explosions retain only the newest particles within the hard cap');
});

test('100 immutable missions cover ten chapters with bounded late combat and both boss forms', () => {
  const game = new Game();
  assert.equal(game.stageCount, 100);
  assert.equal(STAGES.length, 100);
  assert.equal(Object.isFrozen(STAGES), true);
  assert.equal(new Set(STAGES.map(stage => stage.name)).size, 100);
  const forms = new Set();
  const patterns = new Set();
  const skins = new Set();
  for (let index = 0; index < STAGES.length; index++) {
    const config = STAGES[index];
    assert.equal(Object.isFrozen(config), true);
    assert.equal(config.chapter, Math.floor(index / 10));
    assert.equal(config.mission, index % 10 + 1);
    assert.equal(typeof config.chapterName, 'string');
    assert.ok(config.chapterName.length > 0);
    assert.ok(config.waves >= 7 && config.waves <= 10);
    assert.ok(config.interval >= 3 && config.interval <= 4.2);
    assert.ok(config.bossHp >= 320 && config.bossHp <= 39000);
    if (index > 0) assert.ok(config.bossHp >= STAGES[index - 1].bossHp);
    assert.ok(config.hpBoost >= 1 && config.hpBoost <= 52.1);
    assert.ok(config.speedBoost >= 0 && config.speedBoost <= 56);
    assert.ok(config.bulletSpeedBoost >= 0 && config.bulletSpeedBoost <= 107);
    assert.ok(config.fighterFireInterval >= 1.25 && config.fighterFireInterval <= 2.2);
    assert.ok(config.warshipFireInterval >= 2.2 && config.planetFireInterval >= 3.2);
    assert.ok(config.bossFireInterval >= 0.92 && config.bossRageInterval >= 0.68);
    forms.add(config.bossForm);
    patterns.add(config.bossPattern);
    skins.add(config.bossSkin);
  }
  assert.deepEqual([...forms].sort(), ['fighter', 'warship']);
  assert.deepEqual([...patterns].sort(), [0, 1, 2]);
  assert.deepEqual([...skins].sort((a, b) => a - b), Array.from({ length: 10 }, (_, index) => index));
});

test('every generated sprite has an explicit valid sheet, skin, and downward orientation', () => {
  const game = started();
  const sheets = new Set();
  const newFighters = new Set();
  const newWarships = new Set();
  const frameCounts = { enemies: 8, warships: 4, enemyVariants: 10, fleet: 10 };
  for (let stage = 0; stage < STAGES.length; stage++) {
    game.stage = stage;
    game.prepareStage();
    assert.strictEqual(game.stageConfig, STAGES[stage]);
    for (let wave = 0; wave < game.waveCount; wave++) {
      game.wave = wave;
      game.spawnWave();
    }
    game.spawnBoss();
    for (const enemy of game.enemies) {
      if (enemy.type === 'planet') {
        assert.equal(enemy.appearance, undefined, 'planetary weapons use their procedural renderer');
        continue;
      }
      const form = enemy.type === 'boss' ? enemy.form : enemy.type === 'warship' ? 'warship' : 'fighter';
      assert.ok(enemy.level >= 1 && enemy.level <= 20);
      assert.deepEqual(enemy.appearance, require('../src/aircraft.js').getEnemyModel(enemy.level, form).appearance);
      const { sheet, index, rotation } = enemy.appearance;
      assert.equal(Object.isFrozen(enemy.appearance), true);
      assert.ok(Object.hasOwn(frameCounts, sheet), 'registered sprite sheet: ' + sheet);
      assert.ok(Number.isInteger(index) && index >= 0 && index < frameCounts[sheet]);
      assert.equal(rotation, sheet === 'fleet' ? Math.PI / 2 : Math.PI);
      sheets.add(sheet);
      if (sheet === 'enemyVariants') newFighters.add(index);
      if (sheet === 'fleet') newWarships.add(index);
      assert.ok(enemy.speed === undefined || enemy.speed <= 143);
      if (enemy.type === 'boss') assert.equal(enemy.form, STAGES[stage].bossForm);
    }
  }
  assert.deepEqual([...sheets].sort(), ['enemies', 'enemyVariants', 'fleet', 'warships']);
  assert.equal(newFighters.size, 10);
  assert.equal(newWarships.size, 10);
});

test('invalid stage indexes fail before stage preparation can reset the current battlefield', () => {
  const game = started();
  game.spawnWave();
  for (const invalid of [-1, 100, 0.5, NaN, Infinity, undefined, '1']) {
    game.stage = invalid;
    const before = snapshot(game);
    assert.throws(() => game.prepareStage(), /Unknown stage index/);
    assert.deepEqual(snapshot(game), before);
  }
  game.stage = 99;
  game.prepareStage();
  game.setState('upgrade');
  const before = snapshot(game);
  assert.throws(() => game.chooseUpgrade('rapid'), /No upgrade transition after stage index: 99/);
  assert.deepEqual(snapshot(game), before, 'a false upgrade state at the final stage cannot alter firing or advance to stage 101');
});

test('99 rapid upgrades reach an explicit fire-rate limit and then improve damage without growing projectile density', () => {
  const game = quietGame();
  const initialDamage = game.damageBonus;
  let cappedUpgrades = 0;
  for (let stage = 0; stage < 99; stage++) {
    const capped = game.fireInterval === game.minFireInterval;
    const beforeDamage = game.damageBonus;
    game.setState('upgrade');
    game.chooseUpgrade('rapid');
    assert.ok(game.fireInterval >= 0.07);
    if (stage < 9) assert.ok(game.fireInterval > game.minFireInterval, 'the first nine choices still offer gradual fire-rate growth');
    if (stage === 9) assert.equal(game.fireInterval, game.minFireInterval, 'the tenth choice reaches the base firing limit');
    if (capped) {
      cappedUpgrades++;
      assert.ok(Math.abs(game.damageBonus - beforeDamage - 0.2) < 1e-8);
    } else assert.equal(game.damageBonus, beforeDamage);
  }
  assert.equal(game.stage, 99);
  assert.equal(game.fireInterval, game.minFireInterval);
  assert.equal(game.fireInterval, 0.07);
  assert.equal(cappedUpgrades, 89);
  assert.ok(Math.abs(game.damageBonus - initialDamage - cappedUpgrades * 0.2) < 1e-8);
  assert.match(game.upgradeOptions.find(option => option.id === 'rapid').description, /射速已达上限.*伤害 \+0\.2/);
  game.player.weaponLevel = 3;
  game.nextWave = 1000;
  game.player.invincible = 10000;
  game.callSupport();
  let peak = 0;
  for (let frame = 0; frame < 40; frame++) {
    game.update(0.25);
    peak = Math.max(peak, game.playerBullets.length);
  }
  assert.ok(peak > 50, 'the test must exercise sustained maximum-rate five-lane shooting');
  assert.ok(peak <= 100, 'maximum-rate shooting and support naturally retire offscreen projectiles');
});

test('all three boss attacks and rage variants stay bounded while late battle projectiles retire naturally', () => {
  const patterns = new Map();
  for (let index = 90; index < STAGES.length; index++) if (!patterns.has(STAGES[index].bossPattern)) patterns.set(STAGES[index].bossPattern, index);
  const signatures = new Set();
  for (const [pattern, stage] of patterns) {
    const game = started();
    game.stage = stage;
    game.prepareStage();
    game.spawnBoss();
    const boss = game.enemies[0];
    boss.y = 160;
    boss.weaponIndex = 0;
    const counts = [];
    for (const rage of [false, true]) {
      boss.hp = boss.maxHp * (rage ? 0.4 : 0.8);
      boss.volley = 0;
      for (let volley = 0; volley < 2; volley++) {
        game.enemyBullets = [];
        game.enemyShoot(boss);
        counts.push(game.enemyBullets.length);
        assert.ok(game.enemyBullets.length >= 6 && game.enemyBullets.length <= 13);
        assert.ok(game.enemyBullets.every(bullet => Number.isFinite(bullet.vx) && Number.isFinite(bullet.vy) && Math.hypot(bullet.vx, bullet.vy) <= 310));
      }
    }
    signatures.add(counts.join(','));
    assert.equal(boss.pattern, pattern);
  }
  assert.equal(signatures.size, 3, 'the patterns must have distinct volleys rather than cosmetic names');
  for (const stage of [0, 2, 49, 97, 98, 99]) {
    const game = started();
    game.stage = stage;
    game.prepareStage();
    game.player.invincible = 10000;
    game.fireTimer = 10000;
    let peakEnemies = 0;
    let peakBullets = 0;
    for (let frame = 0; frame < 240; frame++) {
      game.update(0.25);
      peakEnemies = Math.max(peakEnemies, game.enemies.length);
      peakBullets = Math.max(peakBullets, game.enemyBullets.length);
    }
    game.enemies = [];
    game.wave = game.waveCount;
    game.update(0.25);
    const boss = game.enemies.find(enemy => enemy.type === 'boss');
    assert.ok(boss, 'the final naturally scheduled boss must still spawn');
    boss.hp = boss.maxHp * 0.4;
    for (let frame = 0; frame < 120; frame++) {
      game.update(0.25);
      peakBullets = Math.max(peakBullets, game.enemyBullets.length);
    }
    assert.equal(game.state, 'playing');
    assert.ok(peakEnemies <= 20, 'waiting out all waves retains a bounded on-screen enemy population');
    assert.ok(peakBullets <= 100, '90 seconds of uninterrupted enemy fire cannot accumulate offscreen projectiles');
  }
});
