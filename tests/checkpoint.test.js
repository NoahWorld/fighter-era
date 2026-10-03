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
  const recovered = new Game({ profile: game.getProfile() });
  recovered.setSavedCheckpoint(game.getCheckpoint());
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
  assert.equal(recovered.progression.totalXp, game.progression.totalXp);
  advance(recovered, recovered.launchDuration);
  assert.equal(recovered.state, 'playing');
  assert.equal(recovered.nextWave, 1.2);
});

test('spent free abilities stay spent after defeat or reload while a new stage replenishes them', () => {
  const events = [];
  const game = playing({ onEvent: (name, payload) => { if (name === 'checkpoint') events.push(payload.checkpoint); } });
  assert.equal(game.callSupport(), true);
  assert.equal(game.useBomb(), true);
  assert.deepEqual(game.getCheckpoint().freeCharges, { bomb: 0, support: 0 });
  assert.equal(events.length, 3, 'new run and each free consumption publish durable checkpoint updates');
  game.player.hp = 1;
  game.player.invincible = 0;
  game.hurt();
  advance(game, game.ejectionDuration);
  assert.equal(game.state, 'gameover');
  assert.ok(game.getCheckpoint().player.hp > 0, 'defeat cannot overwrite the usable stage-start health');
  const reloaded = new Game({ profile: game.getProfile() });
  reloaded.restoreCheckpoint(game.getCheckpoint());
  advance(reloaded, reloaded.launchDuration);
  assert.equal(reloaded.callSupport(), false);
  assert.equal(reloaded.useBomb(), false);
  defeatBoss(reloaded);
  reloaded.chooseUpgrade('spread');
  assert.deepEqual(reloaded.getCheckpoint().freeCharges, { bomb: 1, support: 1 });
});

test('a boss-complete checkpoint resumes upgrade selection without awarding the boss again', () => {
  const game = playing();
  defeatBoss(game);
  const checkpoint = game.getCheckpoint();
  assert.equal(checkpoint.phase, 'upgrade');
  const events = [];
  const recovered = new Game({ profile: game.getProfile(), onEvent: (name, payload) => events.push({ name, payload }) });
  recovered.restoreCheckpoint(checkpoint);
  assert.equal(recovered.state, 'upgrade');
  assert.equal(recovered.score, game.score);
  assert.equal(recovered.kills, game.kills);
  assert.deepEqual(recovered.getProfile(), game.getProfile());
  assert.equal(events.some(event => event.name === 'boss' || event.name === 'progression'), false);
  assert.deepEqual(recovered.enemies, []);
  recovered.chooseUpgrade('rapid');
  assert.equal(recovered.stage, 1);
  assert.equal(recovered.fireInterval, 0.16 * 0.8);
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
  const invalids = [undefined, {}, { ...valid, version: 2 }, { ...valid, stage: 100 }, { ...valid, seed: -1 },
    { ...valid, randomState: 0x100000000 }, { ...valid, phase: 'paused' }, { ...valid, phase: 'upgrade', stage: 99 },
    { ...valid, score: NaN }, { ...valid, score: 0.1 }, { ...valid, kills: -1 }, { ...valid, entityId: Number.MAX_SAFE_INTEGER + 1 },
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
  game.setSavedCheckpoint(baselineAhead);
  assert.throws(() => game.continueRun(), /experience baseline/);
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
  assert.deepEqual(game.getCheckpoint().freeCharges, { bomb: 1, support: 1 });
  game.start();
  assert.deepEqual(game.inventory, { bomb: 2, support: 1 });
});

test('continuation buttons stay within the screen, do not overlap, and inventory affects skill availability', () => {
  const game = playing();
  game.home();
  const renderer = Object.create(Renderer.prototype);
  for (const state of ['menu', 'gameover']) {
    game.state = state;
    const buttons = renderer.getButtons(game);
    assert.ok(buttons.some(button => button.id === 'continue'));
    for (let i = 0; i < buttons.length; i++) {
      assert.ok(buttons[i].y + buttons[i].h <= 720);
      for (let j = 0; j < i; j++) assert.ok(buttons[i].y >= buttons[j].y + buttons[j].h);
    }
  }
  game.state = 'playing';
  game.bombCharges = 0;
  game.supportCharges = 0;
  assert.ok(renderer.abilityButtons(game).every(button => button.disabled));
  game.setInventory({ bomb: 2, support: 1 });
  assert.ok(renderer.abilityButtons(game).every(button => !button.disabled));
  assert.equal(renderer.abilityButtons(game).find(button => button.id === 'bomb').status, '余量 2');
});
