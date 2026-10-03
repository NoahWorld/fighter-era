'use strict';

// WeChat API simulation only. Canvas calls are stubs, so these tests do not
// verify WeChat developer-tool compatibility, real-device behavior, or pixels.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const entry = path.resolve(__dirname, '../game.js');

function simulateWechatApi() {
  const handlers = {};
  const modals = [];
  const toasts = [];
  const info = { windowWidth: 375, windowHeight: 812, pixelRatio: 3 };
  let queuedFrame = null;
  let frameId = 0;
  const ctx = {};
  for (const method of [
    'save', 'restore', 'translate', 'scale', 'rotate', 'setTransform',
    'fillRect', 'fillText', 'beginPath', 'moveTo', 'lineTo',
    'quadraticCurveTo', 'closePath', 'fill', 'stroke', 'arc', 'rect', 'clip'
  ]) ctx[method] = () => {};
  ctx.createLinearGradient = ctx.createRadialGradient = () => ({ addColorStop() {} });
  const canvas = { getContext: type => { assert.equal(type, '2d'); return ctx; } };
  const wx = {
    createCanvas: () => canvas,
    getWindowInfo: () => info,
    getStorageSync: () => '',
    setStorageSync() {},
    showToast: options => toasts.push(options),
    showModal: options => modals.push(options)
  };
  for (const name of ['Error', 'Hide', 'Show', 'WindowResize', 'TouchStart', 'TouchMove', 'TouchEnd', 'TouchCancel']) {
    wx['on' + name] = callback => { handlers[name] = callback; };
  }
  const sandbox = {
    wx, GameGlobal: {}, require: createRequire(entry),
    console: { info() {}, warn() {}, error() {} },
    requestAnimationFrame: callback => { queuedFrame = callback; return ++frameId; },
    cancelAnimationFrame: () => { queuedFrame = null; }
  };
  vm.runInNewContext(fs.readFileSync(entry, 'utf8'), sandbox, { filename: entry });
  assert.ok(sandbox.GameGlobal.neonWing, 'the real entry must load its shared modules');
  assert.equal(modals.length, 0, 'entry initialization must not fail');
  const { game, renderer, diagnostics } = sandbox.GameGlobal.neonWing;

  function frame(timestamp) {
    assert.equal(typeof queuedFrame, 'function', 'the animation loop must remain scheduled');
    const callback = queuedFrame;
    queuedFrame = null;
    callback(timestamp);
    assert.equal(modals.length, 0, modals.map(modal => modal.content).join('\n'));
  }
  function touch(name, x, y, identifier = 1) {
    const scale = Math.min(info.windowWidth / 405, info.windowHeight / 720);
    handlers[name]({ changedTouches: [{
      identifier,
      clientX: (info.windowWidth - 405 * scale) / 2 + x * scale,
      clientY: (info.windowHeight - 720 * scale) / 2 + y * scale
    }] });
  }
  function press(id) {
    const button = renderer.getButtons(game).find(item => item.id === id);
    assert.ok(button, 'expected a visible ' + id + ' button');
    touch('TouchStart', button.x + button.w / 2, button.y + button.h / 2);
  }
  function release() { touch('TouchEnd', 100, 500); }
  return { game, frame, touch, press, release, handlers, canvas, diagnostics, toasts };
}

test('WeChat API simulation: 10 FPS and 4 FPS preserve one second of gameplay', () => {
  for (const frameMilliseconds of [100, 250]) {
    const app = simulateWechatApi();
    app.frame(0);
    app.press('start');
    app.release();
    for (let timestamp = frameMilliseconds; timestamp <= 1000; timestamp += frameMilliseconds) app.frame(timestamp);
    assert.equal(app.game.state, 'playing');
    assert.ok(Math.abs(app.game.totalTime - 1) < 1e-8, frameMilliseconds + ' ms frames must not slow simulation time');
    assert.ok(app.game.playerBullets.length > 0, 'automatic fire must work through the platform entry');
    assert.equal(app.diagnostics.length, 0);
  }
});

test('WeChat API simulation: scaled touch, button contact, and background lifecycle', () => {
  const app = simulateWechatApi();
  assert.equal(app.canvas.width, 1125);
  assert.equal(app.canvas.height, 2436);
  app.frame(0);
  app.press('start');
  assert.equal(app.game.state, 'playing');
  const origin = { x: app.game.player.x, y: app.game.player.y };
  app.touch('TouchMove', 100, 300);
  assert.equal(app.game.player.x, origin.x, 'the start button contact must not become a drag');
  assert.equal(app.game.player.y, origin.y);
  app.release();

  app.touch('TouchStart', 100, 500);
  app.touch('TouchMove', 300, 300, 2);
  assert.equal(app.game.player.x, origin.x, 'another finger must not take over the active drag');
  app.touch('TouchMove', 130, 480);
  assert.ok(Math.abs(app.game.player.x - origin.x - 30) < 1e-8);
  assert.ok(Math.abs(app.game.player.y - origin.y + 20) < 1e-8);
  app.frame(100);

  app.handlers.Hide();
  assert.equal(app.game.state, 'paused');
  const pausedTime = app.game.totalTime;
  app.handlers.Show();
  app.frame(100000);
  assert.equal(app.game.state, 'paused', 'foregrounding must wait for an explicit resume');
  assert.equal(app.game.totalTime, pausedTime);
  assert.equal(app.diagnostics.length, 0, 'a known background gap must not be treated as a frame failure');
  app.press('resume');
  app.release();
  app.frame(101000);
  assert.equal(app.game.totalTime, pausedTime, 'resume resets the frame clock');
  app.frame(101100);
  assert.ok(Math.abs(app.game.totalTime - pausedTime - 0.1) < 1e-8);

  app.press('pause');
  app.release();
  assert.equal(app.game.state, 'paused');
  const manuallyPausedTime = app.game.totalTime;
  app.frame(101200);
  assert.equal(app.game.totalTime, manuallyPausedTime);
});

test('WeChat API simulation: unexpected gaps over 250 ms pause visibly without advancing combat', () => {
  const app = simulateWechatApi();
  app.frame(0);
  app.press('start');
  app.release();
  app.frame(100);
  const beforeGap = app.game.totalTime;
  app.frame(500);
  assert.equal(app.game.state, 'paused');
  assert.equal(app.game.totalTime, beforeGap, 'a rejected frame must not partly advance combat');
  assert.ok(app.diagnostics.length > 0, 'the gap must leave diagnostic evidence');
  assert.ok(app.toasts.length > 0, 'the user must be told why play paused');

  app.press('resume');
  app.release();
  app.frame(2000);
  assert.equal(app.game.state, 'playing');
  assert.equal(app.game.totalTime, beforeGap);
  app.frame(2100);
  assert.ok(Math.abs(app.game.totalTime - beforeGap - 0.1) < 1e-8);
});
