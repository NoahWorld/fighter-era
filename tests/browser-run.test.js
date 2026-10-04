'use strict';

// Exercise the real browser entry and engine with a simulated DOM/storage.
// Pixel rendering and actual browser compatibility require separate UI checks.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Shooter = require('../src/engine.js');
const ShooterRenderer = require('../src/renderer.js');
const { manifest, frames } = require('../src/assets.js');
const RUN_KEY = 'fighter-era.run.v2';

async function browser(storage = new Map()) {
  const warnings = [], alerts = [];
  const handlers = {};
  let queuedFrame;
  class Node {
    constructor() {
      this.children = []; this.dataset = {}; this.style = {}; this.handlers = {};
      this.classList = { toggle() {} }; this.isConnected = true;
    }
    addEventListener(name, callback) { this.handlers[name] = callback; }
    setAttribute() {}
    contains(node) { return this.children.includes(node); }
    insertBefore(node, before) {
      if (node.parentElement) node.remove();
      const index = before ? this.children.indexOf(before) : this.children.length;
      this.children.splice(index, 0, node); node.parentElement = this;
    }
    remove() {
      this.isConnected = false;
      if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
    }
    replaceChildren() { for (const child of [...this.children]) child.remove(); }
  }
  const ids = new Map(['game-canvas', 'game-buttons', 'diagnostics', 'sound-toggle', 'asset-loading',
    'pilot-level', 'pilot-title', 'pilot-xp', 'pilot-progress', 'run-rules-note'].map(id => [id, new Node()]));
  const canvas = ids.get('game-canvas');
  canvas.getContext = () => ({ fillRect() {} });
  canvas.getBoundingClientRect = () => ({ width: 405, height: 720, left: 0, top: 0 });
  ids.get('pilot-progress').parentElement = new Node();
  const document = { getElementById: id => ids.get(id), querySelectorAll: () => [],
    createElement: () => new Node(), addEventListener() {}, activeElement: null };
  const window = { Shooter, ShooterRenderer, ShooterAssets: {
    loadAssets: async () => ({ frames, images: Object.fromEntries(Object.keys(manifest).map(key => [key, {}])) })
  }, addEventListener: (name, callback) => { handlers[name] = callback; }, devicePixelRatio: 1, alert: value => alerts.push(value) };
  const localStorage = { getItem: key => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, value) };
  await vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/browser.js'), 'utf8'), {
    window, document, localStorage, Image: class {}, requestAnimationFrame: callback => { queuedFrame = callback; return 1; },
    cancelAnimationFrame() {}, console: { info() {}, warn: (...args) => warnings.push(args), error: (...args) => warnings.push(args) }
  });
  assert.equal(alerts.length, 0, alerts.join('\n'));
  assert.ok(window.fighterEra);
  // Input/storage integration is tested here; renderer pixels are checked separately.
  window.fighterEra.renderer.ctx.setTransform = () => {};
  window.fighterEra.renderer.draw = () => {};
  function frame(timestamp) { queuedFrame(timestamp); assert.equal(alerts.length, 0, alerts.join('\n')); }
  function press(id) {
    const button = ids.get('game-buttons').children.find(item => item.dataset.buttonId === id);
    assert.ok(button, 'expected a visible ' + id + ' button');
    assert.equal(button.disabled, false, id + ' must be enabled');
    button.handlers.click({ detail: 0, stopPropagation() {} });
  }
  function key(value) { handlers.keydown({ key: value, repeat: false, preventDefault() {} }); }
  return { ...window.fighterEra, ids, warnings, storage, handlers, frame, press, key };
}

function aliveRecord(totalXp) {
  const game = new Shooter.Game(); game.start();
  const checkpoint = game.getCheckpoint(); checkpoint.totalXp = totalXp;
  return JSON.stringify({ version: 2, profile: { version: 2, totalXp }, checkpoint });
}

function launch(game) { for (let i = 0; i < 16; i++) game.update(.2); }

test('browser hangar browses all three catalogs without changing a living run or enabling selection', async () => {
  const app = await browser(new Map([[RUN_KEY, aliveRecord(805)]]));
  const checkpoint = app.game.getCheckpoint();
  const saved = app.storage.get(RUN_KEY);
  app.press('hangar');
  for (const category of ['player', 'enemy', 'warship']) {
    app.press('hangar:tab:' + category);
    while (!app.ids.get('game-buttons').children.some(node => node.dataset.buttonId === 'hangar:model:20')) app.press('hangar:next');
    app.press('hangar:model:20');
    assert.equal(app.game.state, 'menu');
    assert.deepEqual(app.game.getCheckpoint(), checkpoint);
    assert.equal(app.game.progression.level, 3);
    assert.equal(app.storage.get(RUN_KEY), saved);
    assert.ok(!app.ids.get('game-buttons').children.some(node => ['start', 'continue', 'support', 'bomb'].includes(node.dataset.buttonId)));
  }
  app.key('r'); app.key('b'); app.key('p'); app.key('Enter');
  assert.equal(app.game.state, 'menu');
  assert.ok(app.renderer.hangar);
  app.key('Escape');
  assert.equal(app.renderer.hangar, null);
  app.press('continue'); launch(app.game);
  assert.equal(app.game.progression.level, 3);
  assert.equal(app.game.stage, checkpoint.stage);
  assert.equal(app.game.player.weapon, checkpoint.player.weapon);
});

test('browser catalog viewing does not unlock a selected level for a new sortie', async () => {
  const app = await browser();
  app.press('hangar');
  while (!app.ids.get('game-buttons').children.some(node => node.dataset.buttonId === 'hangar:model:20')) app.press('hangar:next');
  app.press('hangar:model:20'); app.press('hangar:close'); app.press('start');
  assert.equal(app.game.progression.level, 1);
  assert.equal(app.game.stage, 0);
  assert.deepEqual(app.game.getActiveWeapons(), ['gun']);
  assert.equal(app.game.bombCharges, 1);
  assert.equal(app.game.supportCharges, 1);
});

test('browser entry ignores legacy permanent growth and retains only historical best scores', async () => {
  const storage = new Map([['fighter-era.profile', '{"version":1,"totalXp":700}'],
    ['fighter-era.checkpoint', '{"version":1,"stage":30}'], ['neon-wing.best-score', '2100']]);
  const app = await browser(storage);
  assert.equal(app.game.progression.level, 1);
  assert.equal(app.game.getCheckpoint(), null);
  assert.equal(app.game.bestScore, 2100);
  assert.match(app.ids.get('run-rules-note').textContent, /旧版永久成长与续关不再使用/);
  assert.equal(storage.get('fighter-era.profile'), '{"version":1,"totalXp":700}');
  assert.deepEqual(JSON.parse(storage.get(RUN_KEY)), { version: 2, profile: { version: 2, totalXp: 0 }, checkpoint: null });
});

test('browser death saves a zero-growth tombstone before ejection and reload cannot continue', async () => {
  const storage = new Map([[RUN_KEY, aliveRecord(805)], ['neon-wing.best-score', '2100']]);
  const app = await browser(storage);
  assert.equal(app.game.progression.level, 3);
  assert.equal(app.game.continueRun(), true); launch(app.game);
  app.game.player.hp = 1; app.game.player.invincible = 0; app.game.hurt();
  assert.equal(app.game.state, 'ejecting');
  assert.equal(app.ids.get('pilot-level').textContent, '01');
  assert.deepEqual(JSON.parse(storage.get(RUN_KEY)), { version: 2, profile: { version: 2, totalXp: 0 }, checkpoint: null });
  const reloaded = await browser(storage);
  assert.equal(reloaded.game.continueRun(), false);
  assert.equal(reloaded.game.progression.level, 1);
  assert.equal(reloaded.game.bestScore, 2100);
});

test('browser victory clears the run before immediate restart and preserves historical score', async () => {
  const storage = new Map([[RUN_KEY, aliveRecord(805)]]);
  const app = await browser(storage);
  app.game.continueRun(); launch(app.game);
  app.game.score = 875; app.game.finish('victory');
  assert.deepEqual(JSON.parse(storage.get(RUN_KEY)), { version: 2, profile: { version: 2, totalXp: 0 }, checkpoint: null });
  assert.equal((await browser(storage)).game.continueRun(), false);
  app.game.start();
  const saved = JSON.parse(storage.get(RUN_KEY));
  assert.equal(saved.profile.totalXp, 0);
  assert.equal(saved.checkpoint.stage, 0);
  const reloaded = await browser(storage);
  assert.equal(reloaded.game.progression.level, 1);
  assert.equal(reloaded.game.bestScore, 875);
});

test('browser corrupt run storage stays intact and its failure remains visible', async () => {
  const bad = '{"version":2,"profile":{"version":2,"totalXp":100},"checkpoint":null}';
  const storage = new Map([[RUN_KEY, bad]]);
  const app = await browser(storage);
  assert.equal(app.game.getCheckpoint(), null);
  assert.ok(app.diagnostics.has('run-storage'));
  assert.equal(app.ids.get('diagnostics').hidden, false);
  assert.ok(app.warnings.length);
  app.game.start(); app.game.addExperience(60);
  assert.equal(storage.get(RUN_KEY), bad);
});

test('browser empty consumables offer only unavailable rewards and cannot grant extra use', async () => {
  const app = await browser();
  app.press('start'); launch(app.game); app.frame(0);
  app.press('bomb');
  for (let i = 0; i < 5; i++) app.game.update(.2);
  app.frame(100);
  assert.equal(app.game.bombCharges, 0);
  app.press('bomb');
  assert.equal(app.game.state, 'paused');
  const buttons = app.ids.get('game-buttons').children;
  assert.equal(buttons.find(item => item.dataset.buttonId === 'reward:ad').disabled, true);
  assert.equal(buttons.find(item => item.dataset.buttonId === 'reward:purchase').disabled, true);
  app.key('p'); app.key('b'); app.frame(200);
  assert.equal(app.game.state, 'paused', 'keyboard cannot resume underneath the offer');
  assert.equal(app.game.bombCharges, 0);
  app.press('reward:close');
  assert.equal(app.game.state, 'playing');
  assert.equal(app.game.bombCharges, 0);
});

test('browser reward offers respect background pause and never resurrect a defeated run', async () => {
  const app = await browser();
  app.press('start'); launch(app.game); app.frame(0);
  app.game.supportCharges = 0;
  app.key('r');
  assert.equal(app.game.state, 'paused');
  app.handlers.blur(); app.press('reward:close');
  assert.equal(app.game.state, 'paused', 'closing after blur requires explicit resume');
  app.press('resume');
  app.game.player.hp = 1; app.game.player.invincible = 0; app.game.hurt();
  for (let i = 0; i < 13; i++) app.game.update(.2);
  app.frame(100);
  assert.equal(app.game.state, 'gameover');
  app.press('revive'); app.press('reward:close');
  assert.equal(app.game.state, 'gameover');
  assert.equal(app.game.progression.level, 1);
  assert.equal(app.game.getCheckpoint(), null);
  assert.equal(app.game.continueRun(), false);
});
