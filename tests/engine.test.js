'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, WIDTH, HEIGHT, STAGES } = require('../src/engine.js');

const STEP = 1 / 120;

function started(options = {}) {
  const game = new Game(options);
  game.start();
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
  assert.equal(game.enemies.length, 0);
  assert.equal(explosions.length, 1);
  advance(game, 0.25);
  assert.equal(game.kills, 1);
  assert.equal(game.score, 80);
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

test('real wave scheduling reaches each boss, both upgrade screens, and final victory', () => {
  const transitions = [];
  const bossEvents = [];
  const game = started({
    seed: 829,
    onEvent: (name, data) => {
      if (name === 'state') transitions.push(data.state);
      if (name === 'stage' && data.boss) bossEvents.push(data.stage);
    }
  });
  let observedKills = 0;

  for (let stage = 0; stage < STAGES.length; stage++) {
    assert.equal(game.stage, stage);
    assert.equal(game.state, 'playing');
    assert.equal(game.wave, 0);
    assert.equal(game.bossSpawned, false);
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
      for (const enemy of game.enemies) {
        if (!spawned.has(enemy.id)) {
          spawned.add(enemy.id);
          if (enemy.type === 'boss') {
            bossCount++;
            assert.equal(game.wave, STAGES[stage].waves, 'boss must wait for all waves');
            assert.ok(game.enemies.every(item => item.type === 'boss'), 'regular enemies must clear before the boss');
          }
        }
        if (enemy.y >= 65) {
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

  assert.deepEqual(bossEvents, [0, 1, 2]);
  assert.deepEqual(transitions, ['playing', 'upgrade', 'playing', 'upgrade', 'playing', 'victory']);
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

test('lethal damage ends the run, and restart clears run state while preserving best score', () => {
  const game = quietGame({ seed: 123, bestScore: 500 });
  game.setState('upgrade');
  game.chooseUpgrade('rapid');
  game.score = 740;
  game.kills = 12;
  game.player.weaponLevel = 3;
  game.player.hp = 1;
  game.player.invincible = 0;
  game.enemyBullets.push(bulletAt(game.player));
  game.update(STEP);
  assert.equal(game.state, 'gameover');
  assert.equal(game.player.hp, 0);
  assert.equal(game.bestScore, 740);
  const gameover = snapshot(game);
  game.update(0.25);
  assert.deepEqual(snapshot(game), gameover);

  game.start();
  const fresh = started({ seed: 123, bestScore: 740 });
  assert.deepEqual(snapshot(game), snapshot(fresh));
  game.score = 20;
  game.player.hp = 1;
  game.player.invincible = 0;
  game.enemyBullets.push(bulletAt(game.player));
  game.update(STEP);
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
