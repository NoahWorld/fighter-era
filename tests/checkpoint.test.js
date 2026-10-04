'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, validateCheckpoint } = require('../src/engine.js');
const { Renderer } = require('../src/renderer.js');

function advance(game, duration) {
  for (let elapsed = 0; elapsed < duration; elapsed += 0.1) game.update(Math.min(0.1, duration - elapsed));
}
function playing(options) { const game = new Game(options); game.start(); advance(game, game.launchDuration); return game; }
function defeatBoss(game) { game.spawnBoss(); const boss = game.enemies.find(enemy => enemy.type === 'boss'); game.destroyEnemy(boss); }

test('checkpoint loadouts explicitly migrate published v2 shapes and reject partial or inconsistent new shapes', () => {
  const game = playing();
  const checkpoint = game.getCheckpoint();
  const stats = { hp: 5, maxHp: 5, weaponLevel: 2 };
  const gun = validateCheckpoint({ ...checkpoint, player: stats });
  assert.deepEqual(gun.player, { ...stats, weapon: 'gun', weapons: { gun: 1, laser: 0, homing: 0, explosive: 0 } });
  for (const weapon of ['laser', 'homing', 'explosive']) {
    const migrated = validateCheckpoint({ ...checkpoint, player: { ...stats, weapon } });
    assert.deepEqual(migrated.player.weapons, { gun: 1, laser: 0, homing: 0, explosive: 0, [weapon]: 1 });
    assert.equal(migrated.player.weapon, weapon);
  }
  const weapons = { gun: 2, laser: 3, homing: 4, explosive: 5 };
  const player = { ...stats, weapon: 'homing', weapons };
  const validated = validateCheckpoint({ ...checkpoint, player });
  weapons.laser = 0;
  assert.equal(validated.player.weapons.laser, 3, 'validation owns a copy of every weapon rank');
  assert.equal(Object.isFrozen(validated.player.weapons), true);
  for (const malformed of [
    { ...player, weapon: 'laser' },
    { ...stats, weapons },
    { ...player, unknown: true },
    { ...player, weapons: { gun: 1, laser: 1, homing: 1 } },
    { ...player, weapons: { ...weapons, spread: 1 } },
    ...[0, 6, 1.5, null, '2', NaN].map(gun => ({ ...player, weapons: { ...weapons, gun } })),
    ...[-1, 6, 0.5, null, '2', NaN].map(homing => ({ ...player, weapons: { ...weapons, homing } }))
  ]) assert.throws(() => validateCheckpoint({ ...checkpoint, player: malformed }), /checkpoint player/);
});

test('acquisition persists one immutable loadout boundary atomically and continuation cannot duplicate rank or grant a free skill', () => {
  const game = playing();
  game.callSupport();
  game.useBomb();
  game.addExperience(9900);
  game.captureCheckpoint();
  const initial = game.savedCheckpoint;
  const events = [];
  game.onEvent = (event, payload) => {
    if (event === 'checkpoint') {
      assert.deepEqual(payload.checkpoint.player.weapons, game.player.weapons);
      assert.equal(payload.checkpoint.player.weapon, game.player.weapon);
      events.push(payload.checkpoint);
    }
  };
  game.acquireWeapon('laser');
  game.acquireWeapon('laser');
  assert.equal(events.length, 2);
  assert.equal(initial.player.weapons.laser, 0);
  assert.equal(game.savedCheckpoint.player.weapons.laser, 2);
  assert.equal(Object.isFrozen(game.savedCheckpoint.player.weapons), true);
  assert.throws(() => { game.savedCheckpoint.player.weapons.laser = 5; }, TypeError);
  const ranks = game.player.weapons;
  const saved = game.savedCheckpoint;
  assert.throws(() => game.acquireWeapon('invalid'), /Unknown pickup weapon/);
  assert.strictEqual(game.player.weapons, ranks);
  assert.strictEqual(game.savedCheckpoint, saved);
  const restored = new Game({ profile: game.getProfile(), checkpoint: game.getCheckpoint() });
  restored.continueRun();
  advance(restored, restored.launchDuration);
  assert.deepEqual(restored.player.weapons, ranks);
  assert.equal(Object.isFrozen(restored.player.weapons), true);
  assert.deepEqual(restored.getActiveWeapons(), ['gun', 'laser']);
  assert.equal(restored.callSupport(), false);
  assert.equal(restored.useBomb(), false);
  defeatBoss(restored);
  restored.chooseUpgrade('rapid');
  assert.equal(restored.getCheckpoint().player.weapons.laser, 2);
  assert.deepEqual(restored.getCheckpoint().freeCharges, { bomb: 0, support: 0 });
  assert.equal(restored.getCheckpoint().fireInterval, restored.fireInterval, 'only the base interval is serialized');
  assert.ok(restored.getCombatStats().fireInterval < restored.fireInterval);
});

test('a recovered interrupted stage starts its waves again using saved stage-boundary stats', () => {
  const game = playing({ seed: -24 });
  defeatBoss(game);
  game.chooseUpgrade('repair');
  const boundary = game.getCheckpoint();
  assert.equal(boundary.stage, 1);
  assert.equal(boundary.phase, 'stage');
  assert.equal(boundary.seed, (-24) >>> 0);
  assert.equal(boundary.player.maxHp, 6);
  advance(game, 4);
  game.player.hp = 2;
  game.score += 800;
  game.kills += 8;
  game.player.weaponLevel = 3;
  game.enemyBullets.push({ x: 123, y: 456, vx: 0, vy: 100, r: 3 });
  const recovered = new Game({ profile: game.getProfile(), checkpoint: game.getCheckpoint() });
  assert.equal(recovered.continueRun(), true);
  assert.equal(recovered.state, 'launching');
  assert.equal(recovered.stage, 1);
  assert.equal(recovered.stageTime, 0);
  assert.equal(recovered.wave, 0);
  assert.equal(recovered.score, boundary.score);
  assert.equal(recovered.kills, boundary.kills);
  assert.equal(recovered.totalTime, boundary.totalTime);
  assert.equal(recovered.player.hp, boundary.player.hp);
  assert.equal(recovered.player.maxHp, boundary.player.maxHp);
  assert.equal(recovered.player.weaponLevel, boundary.player.weaponLevel);
  assert.deepEqual(recovered.enemyBullets, []);
  assert.deepEqual(recovered.enemies, []);
  assert.equal(recovered.progression.totalXp, boundary.totalXp, 'unfinished stage experience rolls back with the stage');
  advance(recovered, recovered.launchDuration);
  assert.equal(recovered.state, 'playing');
  assert.equal(recovered.nextWave, 1.2);
});

test('continuation retains the next reinforcement boundary and cannot reset increasing drop gaps', () => {
  const game = playing();
  // A stage-boundary fixture immediately before the first published drop.
  game.kills = 11;
  game.captureCheckpoint();
  const resumed = new Game({ profile: game.getProfile(), checkpoint: game.getCheckpoint() });
  resumed.continueRun();
  advance(resumed, resumed.launchDuration);
  const defeatScout = current => {
    current.wave = 0;
    current.spawnWave();
    const scout = current.enemies.find(enemy => enemy.type === 'scout');
    assert.ok(scout, 'the ordinary wave must generate a scout');
    current.enemies = [scout];
    current.destroyEnemy(scout);
    current.enemies = [];
  };
  defeatScout(resumed);
  assert.equal(resumed.kills, 12);
  assert.deepEqual(resumed.pickups.map(pickup => pickup.weapon), ['laser']);
  resumed.captureCheckpoint();
  const again = new Game({ profile: resumed.getProfile(), checkpoint: resumed.getCheckpoint() });
  again.continueRun();
  advance(again, again.launchDuration);
  for (let kills = 13; kills <= 25; kills++) defeatScout(again);
  assert.equal(again.pickups.length, 0, 'resuming at twelve kills must not repeat the first reward or shorten the next gap');
  defeatScout(again);
  assert.equal(again.kills, 26);
  assert.deepEqual(again.pickups.map(pickup => pickup.weapon), ['homing']);
});

test('spent free abilities stay spent after surviving reload while death removes continuation', () => {
  const events = [];
  const game = playing({ onEvent: (name, payload) => { if (name === 'checkpoint') events.push(payload.checkpoint); } });
  assert.equal(game.callSupport(), true);
  assert.equal(game.useBomb(), true);
  assert.deepEqual(game.getCheckpoint().freeCharges, { bomb: 0, support: 0 });
  assert.equal(events.length, 3, 'new run and each free consumption publish durable checkpoint updates');
  const reloaded = new Game({ profile: game.getProfile(), checkpoint: game.getCheckpoint() });
  reloaded.continueRun();
  advance(reloaded, reloaded.launchDuration);
  assert.equal(reloaded.callSupport(), false);
  assert.equal(reloaded.useBomb(), false);
  defeatBoss(reloaded);
  reloaded.chooseUpgrade('spread');
  assert.deepEqual(reloaded.getCheckpoint().freeCharges, { bomb: 0, support: 0 });
  reloaded.player.hp = 1;
  reloaded.player.invincible = 0;
  reloaded.hurt();
  assert.equal(reloaded.state, 'ejecting');
  assert.equal(reloaded.getCheckpoint(), null, 'death clears continuation before the ejection animation');
  assert.deepEqual(reloaded.getProfile(), { version: 2, totalXp: 0 });
  advance(reloaded, reloaded.ejectionDuration);
  assert.equal(reloaded.continueRun(), false);
});

test('a boss-complete checkpoint resumes upgrade selection without awarding the boss again', () => {
  const game = playing();
  defeatBoss(game);
  const checkpoint = game.getCheckpoint();
  assert.equal(checkpoint.phase, 'upgrade');
  const events = [];
  const recovered = new Game({ profile: game.getProfile(), checkpoint, onEvent: (name, payload) => events.push({ name, payload }) });
  recovered.continueRun();
  assert.equal(recovered.state, 'upgrade');
  assert.equal(recovered.score, game.score);
  assert.equal(recovered.kills, game.kills);
  assert.deepEqual(recovered.getProfile(), game.getProfile());
  assert.equal(events.some(event => event.name === 'boss'), false);
  assert.deepEqual(events.filter(event => event.name === 'progression').map(event => event.payload), [game.getProfile()], 'resume publishes canonical boundary growth without awarding anything');
  assert.deepEqual(recovered.enemies, []);
  recovered.chooseUpgrade('rapid');
  assert.equal(recovered.stage, 1);
  assert.equal(recovered.fireInterval, 0.16 * 0.92);
  assert.equal(recovered.getCheckpoint().phase, 'stage');
  assert.equal(recovered.getCheckpoint().fireInterval, recovered.fireInterval);
});

test('home keeps continuation, a new run replaces it, and final victory removes it', () => {
  const game = playing();
  defeatBoss(game);
  game.chooseUpgrade('spread');
  const checkpoint = game.getCheckpoint();
  game.home();
  assert.deepEqual(game.getCheckpoint(), checkpoint);
  assert.equal(game.state, 'menu');
  game.start();
  assert.equal(game.getCheckpoint().stage, 0);
  assert.equal(game.getCheckpoint().score, 0);
  advance(game, game.launchDuration);
  for (let stage = 0; stage < game.stageCount; stage++) {
    defeatBoss(game);
    if (stage < game.stageCount - 1) game.chooseUpgrade('rapid');
  }
  assert.equal(game.state, 'victory');
  assert.equal(game.getCheckpoint(), null);
  assert.equal(game.continueRun(), false);
});

test('checkpoint validation rejects malformed or impossible saves without overwriting the previous one', () => {
  const game = playing();
  const valid = game.getCheckpoint();
  game.home();
  const invalids = [undefined, {}, { ...valid, version: 1 }, { ...valid, stage: 100 }, { ...valid, seed: -1 },
    { ...valid, randomState: 0x100000000 }, { ...valid, phase: 'paused' }, { ...valid, phase: 'upgrade', stage: 99 },
    { ...valid, score: NaN }, { ...valid, score: 0.1 }, { ...valid, kills: -1 }, { ...valid, entityId: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, totalXp: -1 }, { ...valid, totalXp: 0.1 }, { ...valid, totalXp: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, totalTime: Infinity }, { ...valid, totalTime: -1 }, { ...valid, fireInterval: 0.01 },
    { ...valid, damageBonus: 50 }, { ...valid, player: { ...valid.player, hp: 0 } },
    { ...valid, player: { ...valid.player, hp: valid.player.maxHp + 1 } },
    { ...valid, player: { ...valid.player, weaponLevel: 4 } }, { ...valid, freeCharges: { bomb: 2, support: 1 } },
    { ...valid, freeCharges: { bomb: 1 } }, { ...valid, player: { ...valid.player, x: 10 } }, { ...valid, hidden: true }];
  for (const invalid of invalids) {
    assert.throws(() => game.setSavedCheckpoint(invalid), /checkpoint/);
    assert.deepEqual(game.getCheckpoint(), valid);
  }
  const baselineAhead = { ...valid, runStartXp: 9999 };
  assert.throws(() => game.setSavedCheckpoint(baselineAhead), /experience baseline/);
  assert.equal(game.state, 'menu');
  game.setSavedCheckpoint(null);
  assert.equal(game.continueRun(), false);
});

test('checkpoint and account inventory snapshots have independent ownership and active saves cannot be replaced', () => {
  const game = playing();
  const snapshot = game.getCheckpoint();
  snapshot.player.hp = 1;
  snapshot.freeCharges.bomb = 0;
  assert.equal(game.getCheckpoint().player.hp, 5);
  assert.equal(game.getCheckpoint().freeCharges.bomb, 1);
  assert.ok(Object.isFrozen(game.savedCheckpoint));
  assert.ok(Object.isFrozen(game.savedCheckpoint.player));
  assert.throws(() => game.setSavedCheckpoint(null), /active run/);
  const inventory = { bomb: 2, support: 3 };
  game.setInventory(inventory);
  inventory.bomb = 99;
  assert.equal(game.inventory.bomb, 2);
  assert.ok(Object.isFrozen(game.inventory));
  for (const invalid of [{ bomb: -1, support: 0 }, { bomb: 1.1, support: 0 }, { bomb: 0 }, { bomb: 0, support: 0, coins: 10 }]) {
    assert.throws(() => game.setInventory(invalid), /inventory/);
    assert.deepEqual(game.inventory, { bomb: 2, support: 3 });
  }
  assert.deepEqual(validateCheckpoint(game.getCheckpoint()), game.getCheckpoint());
});

test('free skill use leaves account inventory unchanged and explicit inventory use survives new stages', () => {
  const events = [];
  const game = playing({ onEvent: (name, payload) => { if (name === 'ability') events.push(payload); } });
  game.setInventory({ bomb: 3, support: 2 });
  assert.equal(game.useBomb(), true);
  assert.equal(game.inventory.bomb, 3);
  assert.equal(game.bombCharges, 0);
  assert.equal(game.useBomb('inventory'), false, 'active animation rejects a second consumption');
  advance(game, 1);
  assert.equal(game.useBomb('inventory'), true);
  assert.equal(game.inventory.bomb, 2);
  assert.equal(game.bombCharges, 0);
  assert.equal(events.findLast(event => event.type === 'bomb').source, 'inventory');
  advance(game, 1);
  assert.equal(game.callSupport(), true);
  assert.equal(game.inventory.support, 2);
  assert.equal(game.callSupport('inventory'), false);
  advance(game, 8);
  assert.equal(game.callSupport('inventory'), true);
  assert.equal(game.inventory.support, 1);
  assert.throws(() => game.useBomb('unknown'), /ability source/);
  defeatBoss(game);
  game.chooseUpgrade('spread');
  assert.deepEqual(game.inventory, { bomb: 2, support: 1 });
  assert.deepEqual(game.getCheckpoint().freeCharges, { bomb: 0, support: 0 });
  game.start();
  assert.deepEqual(game.inventory, { bomb: 2, support: 1 });
});

test('fatal damage atomically removes all run growth before any persistence event and cannot be revived locally', () => {
  const persisted = [];
  let game;
  game = playing({ onEvent: (name, payload) => {
    if (['progression', 'checkpoint', 'state'].includes(name)) persisted.push({ name, payload, profile: game ? game.getProfile() : null, checkpoint: game ? game.getCheckpoint() : null, bestScore: game ? game.bestScore : null });
  } });
  game.addExperience(3500);
  defeatBoss(game);
  game.chooseUpgrade('repair');
  const oldCheckpoint = game.getCheckpoint();
  game.player.weaponLevel = 3;
  game.damageBonus = 4;
  game.fireInterval = 0.07;
  game.player.hp = 1;
  game.player.invincible = 0;
  persisted.length = 0;
  game.hurt();
  assert.equal(game.state, 'ejecting');
  assert.equal(game.getCheckpoint(), null);
  assert.deepEqual(game.getProfile(), { version: 2, totalXp: 0 });
  assert.equal(game.progression.level, 1);
  assert.equal(game.resultProgression.totalXp, 3620);
  assert.equal(game.player.maxHp, 5);
  assert.equal(game.player.shipLevel, 1);
  assert.equal(game.player.weaponLevel, 1);
  assert.equal(game.damageBonus, 0);
  assert.equal(game.fireInterval, 0.16);
  assert.equal(game.bestScore, game.score, 'the fatal hit settles the highest score before the animation');
  assert.equal(persisted.length, 3);
  for (const event of persisted) {
    assert.deepEqual(event.profile, { version: 2, totalXp: 0 });
    assert.equal(event.checkpoint, null, 'no observer sees zero XP paired with a resumable checkpoint');
    assert.equal(event.bestScore, game.score, 'every terminal observer sees the completed score');
  }
  assert.deepEqual(persisted.find(event => event.name === 'checkpoint').payload, { checkpoint: null, reason: 'defeated' });
  advance(game, game.ejectionDuration);
  assert.equal(game.continueRun(), false);
  assert.throws(() => game.setSavedCheckpoint(oldCheckpoint), /verified revival/);
  game.home();
  assert.equal(game.continueRun(), false);
  game.start();
  assert.equal(game.stage, 0);
  assert.equal(game.player.hp, 5);
  assert.equal(game.getCheckpoint().totalXp, 0);
});

test('continuation buttons stay within the screen, do not overlap, and inventory affects skill availability', () => {
  const game = playing();
  game.home();
  const renderer = Object.create(Renderer.prototype);
  renderer.rewardOffer = null;
  for (const state of ['menu', 'gameover']) {
    game.state = state;
    const buttons = renderer.getButtons(game);
    assert.equal(buttons.some(button => button.id === 'continue'), state === 'menu', 'defeat never offers an unverified continuation');
    for (let i = 0; i < buttons.length; i++) {
      assert.ok(buttons[i].y + buttons[i].h <= 720);
      for (let j = 0; j < i; j++) assert.ok(buttons[i].y >= buttons[j].y + buttons[j].h);
    }
  }
  game.state = 'playing';
  game.bombCharges = 0;
  game.supportCharges = 0;
  assert.ok(renderer.abilityButtons(game).every(button => !button.disabled), 'spent skills must still open the advertised acquisition panel');
  game.setInventory({ bomb: 2, support: 1 });
  assert.ok(renderer.abilityButtons(game).every(button => !button.disabled));
  assert.equal(renderer.abilityButtons(game).find(button => button.id === 'bomb').status, '余量 2');
});
