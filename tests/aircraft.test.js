'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { MAX_AIRCRAFT_LEVEL, PLAYER_MODELS, ENEMY_MODELS, getPlayerModel, getEnemyModel, WEAPON_INFO } = require('../src/aircraft.js');
const { frames } = require('../src/assets.js');

test('the shared catalog describes 20 distinct levels for each aircraft family and real sprite frames', () => {
  assert.equal(MAX_AIRCRAFT_LEVEL, 20);
  for (const models of [PLAYER_MODELS, ENEMY_MODELS.fighters, ENEMY_MODELS.warships]) {
    assert.equal(models.length, MAX_AIRCRAFT_LEVEL);
    assert.ok(Object.isFrozen(models));
    assert.equal(new Set(models.map(model => JSON.stringify(model.appearance))).size, MAX_AIRCRAFT_LEVEL);
    assert.equal(new Set(models.map(model => model.title)).size, MAX_AIRCRAFT_LEVEL);
    models.forEach((model, index) => {
      assert.equal(model.level, index + 1);
      assert.ok(Object.isFrozen(model) && Object.isFrozen(model.appearance) && Object.isFrozen(model.weaponTypes));
      assert.ok(frames[model.appearance.sheet][model.appearance.index], model.code + ' references an actual sprite');
      assert.ok(Number.isFinite(model.appearance.rotation));
      assert.equal(model.mountSlots, model.level === 1 ? 1 : model.level < 6 ? 2 : model.level < 10 ? 3 : 4);
      assert.deepEqual(model.weaponTypes, model.level === 1 ? ['gun'] : ['gun', 'laser', 'homing', 'explosive']);
    });
  }
  assert.deepEqual(PLAYER_MODELS.slice(0, 10).map(model => model.appearance.index), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(PLAYER_MODELS.slice(10).map(model => model.appearance.variant), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(ENEMY_MODELS.fighters.filter(model => model.appearance.variant > 0).length, 2);
  assert.equal(ENEMY_MODELS.warships.filter(model => model.appearance.variant > 0).length, 6);
});

test('catalog access preserves identity and rejects invalid levels or forms instead of masking them', () => {
  for (let level = 1; level <= MAX_AIRCRAFT_LEVEL; level++) {
    assert.equal(getPlayerModel(level), PLAYER_MODELS[level - 1]);
    assert.equal(getEnemyModel(level), ENEMY_MODELS.fighters[level - 1]);
    assert.equal(getEnemyModel(level, 'warship'), ENEMY_MODELS.warships[level - 1]);
  }
  for (const value of [-1, 0, 1.5, 21, NaN, Infinity, '2', null, undefined]) {
    assert.throws(() => getPlayerModel(value), /Aircraft level/);
    assert.throws(() => getEnemyModel(value), /Aircraft level/);
  }
  assert.throws(() => getEnemyModel(1, 'planet'), /Unknown enemy aircraft form: planet/);
  assert.throws(() => { PLAYER_MODELS[0].mountSlots = 99; }, TypeError);
  assert.throws(() => { PLAYER_MODELS[10].appearance.variant = 0; }, TypeError);
  assert.deepEqual(Object.keys(WEAPON_INFO), ['gun', 'laser', 'homing', 'explosive']);
  for (const descriptor of Object.values(WEAPON_INFO)) {
    assert.equal(descriptor.maxLevel, 5);
    assert.ok(Object.isFrozen(descriptor));
  }
});

test('the same UMD catalog loads as a browser global before engine and renderer', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/aircraft.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/engine.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer.js'), 'utf8'), context);
  assert.equal(context.ShooterAircraft.getPlayerModel(20).appearance.variant, 10);
  assert.equal(typeof context.Shooter.Game, 'function');
  assert.equal(typeof context.ShooterRenderer.Renderer, 'function');
  assert.throws(() => vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer.js'), 'utf8'), {}), /requires the shared aircraft catalog/);
});
