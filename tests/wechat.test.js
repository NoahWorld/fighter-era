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

async function simulateWechatApi(options = {}) {
  const handlers = {};
  const modals = [];
  const toasts = [];
  const storage = options.storage || new Map();
  const readFailures = options.readFailures || new Set();
  const writeFailures = options.writeFailures || new Set();
  const writes = [];
  const images = [];
  const loadingMessages = [];
  const logs = [];
  const packageRequests = [];
  const timers = new Map();
  let timerId = 0;
  const info = { windowWidth: 375, windowHeight: 812, pixelRatio: 3 };
  let queuedFrame = null;
  let frameId = 0;
  const ctx = {};
  for (const method of [
    'save', 'restore', 'translate', 'scale', 'rotate', 'setTransform',
    'fillRect', 'drawImage', 'beginPath', 'moveTo', 'lineTo',
    'quadraticCurveTo', 'bezierCurveTo', 'closePath', 'fill', 'stroke', 'arc', 'rect', 'clip'
  ]) ctx[method] = () => {};
  ctx.fillText = message => loadingMessages.push(message);
  ctx.createLinearGradient = ctx.createRadialGradient = () => ({ addColorStop() {} });
  const canvas = { getContext: type => { assert.equal(type, '2d'); return ctx; } };
  const wx = {
    createCanvas: () => canvas,
    loadSubpackage: request => {
      const packageRequest = { ...request, progress: null };
      packageRequests.push(packageRequest);
      return { onProgressUpdate: callback => { packageRequest.progress = callback; } };
    },
    createImage: () => {
      const image = {
        width: 0, height: 0, naturalWidth: 0, naturalHeight: 0, complete: false,
        onload: null, onerror: null,
        decode: async () => {
          if (!image.complete || !image.width) throw new Error('Image is not decoded: ' + image.src);
        }
      };
      let source = '';
      Object.defineProperty(image, 'src', {
        get: () => source,
        set: value => {
          assert.equal(typeof image.onload, 'function', 'load handlers must be registered before assigning a resource');
          assert.equal(typeof image.onerror, 'function', 'failure handlers must be registered before assigning a resource');
          source = value;
          images.push(image);
        }
      });
      return image;
    },
    getWindowInfo: () => info,
    getStorageSync: key => {
      if (readFailures.has(key)) throw new Error('Simulated storage read failure: ' + key);
      return storage.has(key) ? structuredClone(storage.get(key)) : '';
    },
    setStorageSync: (key, value) => {
      const saved = structuredClone(value);
      writes.push({ key, value: saved });
      if (writeFailures.has(key)) throw new Error('Simulated storage write failure: ' + key);
      storage.set(key, saved);
    },
    showToast: options => toasts.push(options),
    showModal: options => modals.push(options)
  };
  if (options.missingSubpackageApi) delete wx.loadSubpackage;
  for (const name of ['Error', 'Hide', 'Show', 'WindowResize', 'TouchStart', 'TouchMove', 'TouchEnd', 'TouchCancel']) {
    wx['on' + name] = callback => { handlers[name] = callback; };
  }
  const sandbox = {
    wx, GameGlobal: {}, require: createRequire(entry),
    console: { info: (...args) => logs.push(args), warn() {}, error() {} },
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    requestAnimationFrame: callback => { queuedFrame = callback; return ++frameId; },
    cancelAnimationFrame: () => { queuedFrame = null; }
  };
  vm.runInNewContext(fs.readFileSync(entry, 'utf8'), sandbox, { filename: entry });
  assert.ok(sandbox.GameGlobal.fighterEra, 'the real 战机时代 entry must load its shared modules');
  if (!options.missingSubpackageApi) assert.equal(modals.length, 0, 'entry initialization must not fail');
  const { game, diagnostics } = sandbox.GameGlobal.fighterEra;

  async function completePackage() {
    assert.equal(packageRequests.length, 1, 'exactly one expansion package must be requested');
    assert.equal(packageRequests[0].name, 'fleet-assets');
    packageRequests[0].success();
    await new Promise(resolve => setImmediate(resolve));
  }
  async function failPackage(errMsg) {
    assert.equal(packageRequests.length, 1);
    packageRequests[0].fail({ errMsg });
    await new Promise(resolve => setImmediate(resolve));
  }
  async function expirePackage() {
    const timer = [...timers.values()].find(item => item.delay === 30000);
    assert.ok(timer, 'expansion package loading must have a 30 second timeout');
    timer.callback();
    await new Promise(resolve => setImmediate(resolve));
  }
  if (options.autoPackage !== false && !options.missingSubpackageApi) await completePackage();

  async function loadImages(failedPath) {
    const dimensions = {
      'assets/player.png': [1122, 1402], 'assets/enemies.png': [1122, 1402],
      'assets/warships.png': [1254, 1254], 'assets/projectiles.png': [1448, 1086],
      'assets/expansion/enemy-variants.png': [1122, 1402], 'assets/expansion/fleet.png': [1122, 1402]
    };
    assert.equal(images.length, 6, 'all six required atlases must be requested');
    for (const image of images) {
      if (image.complete) continue;
      image.complete = true;
      if (image.src === failedPath) image.onerror(new Error('Simulated image load failure: ' + image.src));
      else {
        const size = dimensions[image.src];
        assert.ok(size, 'unexpected asset path: ' + image.src);
        [image.width, image.height] = size;
        [image.naturalWidth, image.naturalHeight] = size;
        image.onload();
      }
    }
    await new Promise(resolve => setImmediate(resolve));
  }

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
    const button = sandbox.GameGlobal.fighterEra.renderer.getButtons(game).find(item => item.id === id);
    assert.ok(button, 'expected a visible ' + id + ' button');
    touch('TouchStart', button.x + button.w / 2, button.y + button.h / 2);
  }
  function release() { touch('TouchEnd', 100, 500); }
  if (options.autoLoad !== false) {
    await loadImages();
    assert.equal(modals.length, 0, modals.map(modal => modal.content).join('\n'));
    assert.equal(sandbox.GameGlobal.fighterEra.ready, true, 'initialization must wait for decoded images');
  }
  return { game, frame, touch, press, release, handlers, canvas, diagnostics, toasts, storage, writes, images, modals, loadingMessages, loadImages, logs, packageRequests, completePackage, failPackage, expirePackage,
    get ready() { return sandbox.GameGlobal.fighterEra.ready; },
    get hasFrame() { return queuedFrame !== null; }
  };
}

// Existing combat tests start after the independently tested launch sequence.
function finishLaunch(game) {
  for (let i = 0; i < 12; i++) game.update(0.25);
  game.update(0.2);
  assert.equal(game.state, 'playing');
  assert.equal(game.totalTime, 0, 'launching cannot advance combat time');
}

test('WeChat API simulation: 10 FPS and 4 FPS preserve one second of gameplay', async () => {
  for (const frameMilliseconds of [100, 250]) {
    const app = await simulateWechatApi();
    app.frame(0);
    app.press('start');
    finishLaunch(app.game);
    app.release();
    for (let timestamp = frameMilliseconds; timestamp <= 1000; timestamp += frameMilliseconds) app.frame(timestamp);
    assert.equal(app.game.state, 'playing');
    assert.ok(Math.abs(app.game.totalTime - 1) < 1e-8, frameMilliseconds + ' ms frames must not slow simulation time');
    assert.ok(app.game.playerBullets.length > 0, 'automatic fire must work through the platform entry');
    assert.equal(app.diagnostics.length, 0);
  }
});

test('WeChat API simulation: scaled touch, button contact, and background lifecycle', async () => {
  const app = await simulateWechatApi();
  assert.equal(app.canvas.width, 1125);
  assert.equal(app.canvas.height, 2436);
  app.frame(0);
  app.press('start');
  finishLaunch(app.game);
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

test('WeChat API simulation: unexpected gaps over 250 ms pause visibly without advancing combat', async () => {
  const app = await simulateWechatApi();
  app.frame(0);
  app.press('start');
  finishLaunch(app.game);
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

test('WeChat API simulation: experience saves immediately and restores ship growth after reload', async () => {
  const storage = new Map([
    ['fighter-era.profile', { version: 1, totalXp: 59 }],
    ['neon-wing.best-score', 200]
  ]);
  const app = await simulateWechatApi({ storage });
  assert.equal(app.game.getProfile().totalXp, 59);
  assert.equal(app.game.bestScore, 200);
  app.press('start');
  finishLaunch(app.game);
  app.release();
  app.game.addExperience(1);
  assert.deepEqual(storage.get('fighter-era.profile'), { version: 1, totalXp: 60 }, 'the progression event must persist without waiting for an animation frame');
  assert.equal(app.game.player.shipLevel, 2);
  app.game.addExperience(105);
  assert.deepEqual(storage.get('fighter-era.profile'), { version: 1, totalXp: 165 });
  assert.equal(app.writes.filter(write => write.key === 'fighter-era.profile').length, 2);
  app.game.home();
  app.game.start();
  assert.equal(app.game.getProfile().totalXp, 165);
  app.frame(0);
  assert.equal(app.diagnostics.length, 0);

  const reloaded = await simulateWechatApi({ storage });
  assert.equal(reloaded.game.progression.level, 3);
  assert.equal(reloaded.game.progression.tier, 2);
  assert.equal(reloaded.game.progression.xp, 5);
  assert.equal(reloaded.game.player.shipLevel, 3);
  assert.equal(reloaded.game.getProfile().totalXp, 165);
});

test('WeChat API simulation: corrupt profiles warn visibly and are never overwritten by new progress', async () => {
  for (const corrupted of [
    { version: 2, totalXp: 60 }, { version: 1, totalXp: -1 },
    { version: 1, totalXp: Number.MAX_SAFE_INTEGER + 1 }, '{broken-json', null
  ]) {
    const storage = new Map([['fighter-era.profile', corrupted]]);
    const app = await simulateWechatApi({ storage });
    assert.ok(app.toasts.length > 0, 'corruption must be visible to the player');
    assert.ok(app.diagnostics.length > 0, 'corruption must leave diagnostic evidence');
    assert.equal(app.game.getProfile().totalXp, 0, 'invalid persisted values cannot enter the simulation');
    app.game.start();
    app.game.addExperience(10);
    app.frame(0);
    assert.deepEqual(storage.get('fighter-era.profile'), corrupted);
    assert.equal(app.writes.filter(write => write.key === 'fighter-era.profile').length, 0);
  }
});

test('WeChat API simulation: failed profile writes warn once and retain the old record', async () => {
  const storage = new Map([['fighter-era.profile', { version: 1, totalXp: 59 }]]);
  const writeFailures = new Set(['fighter-era.profile']);
  const app = await simulateWechatApi({ storage, writeFailures });
  app.game.start();
  app.game.addExperience(1);
  assert.equal(app.game.getProfile().totalXp, 60, 'a storage failure must not undo earned session progress');
  assert.deepEqual(storage.get('fighter-era.profile'), { version: 1, totalXp: 59 });
  assert.ok(app.toasts.length > 0);
  assert.ok(app.diagnostics.some(item => String(item.detail).includes('Simulated storage write failure')));
  const warningCount = app.toasts.length;
  writeFailures.delete('fighter-era.profile');
  app.game.addExperience(1);
  app.frame(0);
  assert.equal(app.writes.filter(write => write.key === 'fighter-era.profile').length, 1, 'the failed profile key remains disabled for this session');
  assert.equal(app.toasts.length, warningCount);
  assert.deepEqual(storage.get('fighter-era.profile'), { version: 1, totalXp: 59 });

  app.game.score = 500;
  app.game.finish('gameover');
  assert.equal(storage.get('neon-wing.best-score'), 500, 'an independent healthy record must still save immediately');
});

test('WeChat API simulation: an unreadable profile is preserved while other storage keys remain usable', async () => {
  const saved = { version: 1, totalXp: 700 };
  const storage = new Map([['fighter-era.profile', saved], ['neon-wing.best-score', 200]]);
  const app = await simulateWechatApi({ storage, readFailures: new Set(['fighter-era.profile']) });
  assert.equal(app.game.bestScore, 200);
  assert.ok(app.toasts.length > 0);
  assert.ok(app.diagnostics.some(item => String(item.detail).includes('Simulated storage read failure')));
  app.game.start();
  app.game.addExperience(60);
  app.game.score = 700;
  app.game.finish('gameover');
  assert.deepEqual(storage.get('fighter-era.profile'), saved);
  assert.equal(app.writes.filter(write => write.key === 'fighter-era.profile').length, 0);
  assert.equal(storage.get('neon-wing.best-score'), 700);
});


test('WeChat API simulation: loading blocks play and background completion waits for foreground', async () => {
  const app = await simulateWechatApi({ autoLoad: false });
  assert.equal(app.ready, false);
  assert.equal(app.hasFrame, false, 'the combat loop cannot start while required images are unavailable');
  assert.ok(app.loadingMessages.some(message => message.includes('正在加载')));
  app.touch('TouchStart', 200, 590);
  app.touch('TouchMove', 220, 500);
  app.release();
  assert.equal(app.game.state, 'menu', 'early touches must not start combat');
  app.handlers.WindowResize();
  app.handlers.Hide();
  await app.loadImages();
  assert.equal(app.ready, true);
  assert.equal(app.hasFrame, false, 'finishing a load in the background must not start the loop');
  app.handlers.Show();
  assert.equal(app.hasFrame, true);
  app.frame(0);
  app.press('start');
  finishLaunch(app.game);
  app.release();
  assert.equal(app.game.state, 'playing');
});

test('WeChat API simulation: a required image failure stops initialization and play visibly', async () => {
  const app = await simulateWechatApi({ autoLoad: false });
  await app.loadImages('assets/enemies.png');
  assert.equal(app.ready, false);
  assert.equal(app.hasFrame, false);
  assert.equal(app.modals.length, 1, 'image failure must be visible to the player');
  assert.match(app.modals[0].content, /assets\/enemies\.png/, 'the failed resource path must be present');
  app.touch('TouchStart', 200, 590);
  app.handlers.Hide();
  app.handlers.Show();
  assert.equal(app.game.state, 'menu');
  assert.equal(app.hasFrame, false, 'foregrounding cannot resume a failed initialization');
});

test('WeChat API simulation: subpackage progress is visible and decoding cannot begin before package success', async () => {
  const app = await simulateWechatApi({ autoPackage: false, autoLoad: false });
  assert.equal(app.packageRequests.length, 1);
  assert.equal(app.packageRequests[0].name, 'fleet-assets');
  assert.equal(app.images.length, 0, 'images cannot be created before the resource subpackage arrives');
  assert.equal(app.ready, false);
  assert.equal(app.hasFrame, false);
  app.packageRequests[0].progress({ progress: 41, totalBytesWritten: 41, totalBytesExpectedToWrite: 100 });
  assert.ok(app.loadingMessages.includes('正在加载扩展舰队资源 41%'));
  app.touch('TouchStart', 200, 590);
  app.release();
  assert.equal(app.game.state, 'menu');
  await app.completePackage();
  assert.equal(app.images.length, 6);
  assert.equal(app.ready, false, 'successful subpackage loading does not substitute for PNG decoding');
  await app.loadImages();
  assert.equal(app.ready, true);
  assert.equal(app.hasFrame, true);
});

test('WeChat API simulation: subpackage failure identifies the package and preserves the original cause', async () => {
  const app = await simulateWechatApi({ autoPackage: false, autoLoad: false });
  await app.failPackage('loadSubpackage:fail simulated download failure');
  assert.equal(app.images.length, 0);
  assert.equal(app.ready, false);
  assert.equal(app.hasFrame, false);
  assert.equal(app.modals.length, 1);
  assert.match(app.modals[0].content, /fleet-assets.*simulated download failure/);
  await app.completePackage();
  assert.equal(app.images.length, 0, 'late success cannot revive a failed package initialization');
  app.handlers.Show();
  assert.equal(app.hasFrame, false);
});

test('WeChat API simulation: stalled subpackage loading stops after a bounded timeout', async () => {
  const app = await simulateWechatApi({ autoPackage: false, autoLoad: false });
  await app.expirePackage();
  assert.equal(app.modals.length, 1);
  assert.match(app.modals[0].content, /fleet-assets.*加载超时.*30000ms/);
  assert.equal(app.images.length, 0);
  assert.equal(app.ready, false);
  assert.equal(app.hasFrame, false);
  await app.completePackage();
  assert.equal(app.images.length, 0);
});

test('WeChat API simulation: an unsupported subpackage API is fatal before any PNG request', async () => {
  const app = await simulateWechatApi({ missingSubpackageApi: true, autoLoad: false });
  assert.equal(app.packageRequests.length, 0);
  assert.equal(app.images.length, 0);
  assert.equal(app.modals.length, 1);
  assert.match(app.modals[0].content, /缺少 wx\.loadSubpackage.*fleet-assets/);
  assert.equal(app.ready, false);
  assert.equal(app.hasFrame, false);
});

test('WeChat API simulation: invalid package progress stops initialization with diagnostic context', async () => {
  const app = await simulateWechatApi({ autoPackage: false, autoLoad: false });
  app.packageRequests[0].progress({ progress: NaN });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.modals.length, 1);
  assert.match(app.modals[0].content, /fleet-assets.*无效进度.*NaN/);
  assert.equal(app.images.length, 0);
  assert.equal(app.ready, false);
});

test('WeChat API simulation: a fatal runtime error during loading cannot be undone by late image completion', async () => {
  const app = await simulateWechatApi({ autoLoad: false });
  app.handlers.Error('Simulated initialization error');
  await app.loadImages();
  assert.equal(app.modals.length, 1);
  assert.equal(app.ready, false);
  assert.equal(app.hasFrame, false);
  app.handlers.Show();
  assert.equal(app.hasFrame, false);
});

test('WeChat API simulation: launch animation blocks combat and resumes from background at the same instant', async () => {
  const app = await simulateWechatApi();
  app.frame(0);
  app.press('start');
  app.release();
  assert.equal(app.game.state, 'launching');
  app.frame(200);
  const elapsed = app.game.cinematicTime;
  const position = { x: app.game.player.x, y: app.game.player.y };
  app.touch('TouchStart', 100, 500);
  app.touch('TouchMove', 160, 400);
  app.release();
  assert.deepEqual({ x: app.game.player.x, y: app.game.player.y }, position);
  assert.equal(app.game.totalTime, 0);
  assert.equal(app.game.playerBullets.length, 0);
  app.handlers.Hide();
  assert.equal(app.game.state, 'paused');
  assert.equal(app.game.pausedFrom, 'launching');
  app.handlers.Show();
  app.frame(50000);
  assert.equal(app.game.cinematicTime, elapsed);
  app.press('resume');
  app.release();
  app.frame(51000);
  assert.equal(app.game.state, 'launching');
  assert.equal(app.game.cinematicTime, elapsed);
  for (let timestamp = 51200; timestamp <= 54000; timestamp += 200) app.frame(timestamp);
  assert.equal(app.game.state, 'playing');
  assert.equal(app.game.totalTime, 0);
  assert.equal(app.game.playerBullets.length, 0);
  app.frame(54100);
  assert.ok(app.game.playerBullets.length > 0);
  assert.equal(app.diagnostics.length, 0);
});

test('WeChat API simulation: ejection pauses safely and delays result persistence until animation ends', async () => {
  const app = await simulateWechatApi();
  app.press('start');
  app.release();
  finishLaunch(app.game);
  app.frame(0);
  app.game.player.hp = 1;
  app.game.player.invincible = 0;
  app.game.score = 875;
  app.game.enemyBullets.push({ x: app.game.player.x, y: app.game.player.y, vx: 0, vy: 0, r: 4 });
  app.frame(100);
  assert.equal(app.game.state, 'ejecting');
  assert.equal(app.storage.has('neon-wing.best-score'), false);
  app.frame(200);
  const elapsed = app.game.cinematicTime;
  app.frame(600);
  assert.equal(app.game.state, 'paused');
  assert.equal(app.game.pausedFrom, 'ejecting');
  assert.equal(app.game.cinematicTime, elapsed);
  assert.equal(app.diagnostics.length, 1);
  app.press('resume');
  app.release();
  app.frame(1000);
  assert.equal(app.game.state, 'ejecting');
  for (let timestamp = 1250; timestamp <= 3500; timestamp += 250) app.frame(timestamp);
  assert.equal(app.game.state, 'gameover');
  assert.equal(app.storage.get('neon-wing.best-score'), 875);
  app.frame(3600);
  assert.equal(app.writes.filter(write => write.key === 'neon-wing.best-score').length, 1);
  app.press('restart');
  app.release();
  assert.equal(app.game.state, 'launching');
  assert.equal(app.game.cinematicTime, 0);
});

test('WeChat API simulation: support touch fires allies, locks the contact, and freezes in background', async () => {
  const app = await simulateWechatApi();
  app.press('start');
  app.release();
  finishLaunch(app.game);
  app.frame(0);
  const position = { x: app.game.player.x, y: app.game.player.y };
  app.press('support');
  assert.equal(app.game.supportCharges, 0);
  assert.equal(app.game.allies.length, 2);
  app.touch('TouchMove', 120, 270);
  assert.deepEqual({ x: app.game.player.x, y: app.game.player.y }, position, 'the ability contact cannot drag the player');
  app.press('bomb');
  assert.equal(app.game.bombCharges, 1, 'the active touch cannot trigger a second button');
  app.release();
  for (let timestamp = 100; timestamp <= 1000; timestamp += 100) app.frame(timestamp);
  assert.ok(app.game.playerBullets.some(bullet => bullet.source === 'support'), 'allies shoot through the real platform loop');
  const remaining = app.game.supportTime;
  app.handlers.Hide();
  app.handlers.Show();
  app.frame(20000);
  assert.equal(app.game.supportTime, remaining, 'backgrounding freezes the support clock');
  app.press('resume');
  app.release();
  app.frame(20100);
  app.frame(20200);
  assert.ok(app.game.supportTime < remaining);
  assert.ok(app.logs.some(([name, detail]) => name === '[Fighter Era / ability]' && detail.payload.type === 'support'));
});

test('WeChat API simulation: bomb clears enemies, preserves loot, and persists earned experience immediately', async () => {
  const app = await simulateWechatApi();
  app.press('start');
  app.release();
  finishLaunch(app.game);
  app.frame(0);
  app.game.spawnWave();
  app.game.enemies.forEach((enemy, i) => { enemy.y = 100 + i * 45; });
  const expectedKills = app.game.enemies.length;
  const repair = { x: 40, y: 160, r: 12, type: 'repair', t: 0 };
  const power = { x: 330, y: 230, r: 12, type: 'power', t: 0 };
  app.game.pickups.push(repair, power);
  app.game.enemyBullets.push({ x: 150, y: 400, vx: 0, vy: 140, r: 4 });
  app.press('bomb');
  app.release();
  assert.equal(app.game.bombCharges, 0);
  assert.equal(app.game.kills, expectedKills);
  assert.equal(app.game.enemies.length, 0);
  assert.equal(app.game.enemyBullets.length, 0);
  assert.ok(app.game.pickups.includes(repair) && app.game.pickups.includes(power));
  assert.ok(app.storage.get('fighter-era.profile').totalXp > 0, 'bomb rewards must save on the progression event');
  const score = app.game.score;
  const writes = app.writes.length;
  app.press('bomb');
  app.touch('TouchMove', 100, 100);
  app.release();
  assert.equal(app.game.score, score, 'disabled bomb cannot award twice');
  assert.equal(app.writes.length, writes);
  assert.equal(app.game.player.y, 596, 'a disabled ability button also consumes its touch');
  assert.ok(app.logs.some(([name, detail]) => name === '[Fighter Era / control]' && detail.button === 'bomb' && detail.disabled));
  app.frame(100);
  assert.equal(app.diagnostics.length, 0);
});

test('WeChat API simulation: ability controls only exist during combat and replenish after a BOSS', async () => {
  const app = await simulateWechatApi();
  app.press('start');
  app.release();
  // Side buttons have not yet appeared during the boarding animation.
  app.touch('TouchStart', 370, 540);
  app.release();
  assert.equal(app.game.bombCharges, 1);
  assert.equal(app.game.supportCharges, 1);
  finishLaunch(app.game);
  app.press('support');
  app.release();
  app.game.spawnBoss();
  const boss = app.game.enemies.find(enemy => enemy.type === 'boss');
  boss.y = 150;
  app.press('bomb');
  app.release();
  assert.equal(app.game.state, 'upgrade');
  assert.equal(app.game.bombCharges, 0);
  app.press('upgrade:spread');
  app.release();
  assert.equal(app.game.stage, 1);
  assert.equal(app.game.state, 'playing');
  assert.equal(app.game.supportCharges, 1);
  assert.equal(app.game.bombCharges, 1);
  app.press('support');
  app.release();
  assert.equal(app.game.allies.length, 2);
  app.frame(0);
  assert.equal(app.diagnostics.length, 0);
});
