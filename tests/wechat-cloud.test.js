'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Game } = require('../src/engine.js');
const { CloudSave, STORAGE_KEY } = require('../src/cloud-save.js');

const copy = value => JSON.parse(JSON.stringify(value));
const root = path.resolve(__dirname, '..');
const META_KEY = 'fighter-era.cloud-context';

function loadBridge(apiBase = '', logs = []) {
  // Compile the real bridge in this realm so its plain-object snapshots retain
  // the same JSON prototype as the actual CloudSave module.
  const filename = path.join(root, 'src/wechat-cloud.js');
  const compiled = vm.runInThisContext('(function(require,module,exports,console){\n' + fs.readFileSync(filename, 'utf8') + '\n})', { filename });
  const module = { exports: {} };
  compiled(id => id === './cloud-config.js' ? { apiBase } : require(path.resolve(root, 'src', id)), module, module.exports,
    { error: (...values) => logs.push(values), info: (...values) => logs.push(values) });
  return module.exports.WechatCloud;
}
function account() {
  return { user: { id: 'pilot-a' }, revision: 0, profile: { version: 1, totalXp: 0 }, bestScore: 0,
    highestClearedStage: 0, checkpoint: null, inventory: { bomb: 2, support: 2 }, migrationAllowed: true };
}
function wxFixture() {
  const memory = new Map();
  const calls = { login: [], requests: [] };
  const wx = {
    getStorageSync: key => memory.has(key) ? copy(memory.get(key)) : '',
    setStorageSync: (key, value) => memory.set(key, copy(value)),
    login: options => { calls.login.push(options); options.success({ code: 'wechat-code' }); },
    request: options => { calls.requests.push(options); throw new Error('Unexpected external request in this test'); }
  };
  return { wx, memory, calls };
}
function configuredFixture(serverAccount = account()) {
  const w = wxFixture();
  const statuses = [];
  let server = copy(serverAccount);
  w.wx.request = options => {
    w.calls.requests.push(options);
    if (options.url.endsWith('/v1/auth/wechat')) {
      options.success({ statusCode: 200, data: { token: 'session-' + server.user.id, account: copy(server) } });
    } else if (options.url.endsWith('/v1/me')) {
      options.success({ statusCode: 200, data: copy(server) });
    } else if (options.url.endsWith('/v1/me/import')) {
      Object.assign(server, { profile: copy(options.data.profile), bestScore: options.data.bestScore,
        checkpoint: copy(options.data.checkpoint), revision: server.revision + 1, migrationAllowed: false });
      options.success({ statusCode: 200, data: { account: copy(server), mutationId: options.data.mutationId } });
    } else throw new Error('Unexpected cloud endpoint ' + options.url);
  };
  const createBridge = () => new (loadBridge('https://game.example.test'))(w.wx, status => statuses.push(status));
  return { ...w, statuses, createBridge, setServer: value => { server = copy(value); } };
}
function nonemptyLocal() {
  const previous = new Game({ profile: { version: 1, totalXp: 700 } });
  previous.start();
  return { profile: previous.getProfile(), bestScore: 2300, checkpoint: previous.getCheckpoint() };
}
function fixture() {
  const w = wxFixture();
  const statuses = [];
  const logs = [];
  const bridge = new (loadBridge('', logs))(w.wx, status => statuses.push(status));
  const enqueued = [];
  const consumed = [];
  const acknowledgements = [];
  let flushes = 0;
  let pending = null;
  bridge.account = account();
  bridge.context = { version: 1, userId: 'pilot-a', runId: 'before-start', highestClearedStage: 0, stageResults: [], status: 'active' };
  bridge.client = {
    enqueue: snapshot => enqueued.push(copy(snapshot)),
    flush: async () => { flushes++; },
    getPendingConsumption: () => pending,
    consume: async item => {
      consumed.push(item);
      bridge.account.inventory[item]--;
      pending = { item, mutationId: 'inventory-' + consumed.length, state: 'confirmed' };
      return { inventory: copy(bridge.account.inventory), mutationId: pending.mutationId };
    },
    acknowledgeConsumption: id => { acknowledgements.push(id); pending = null; }
  };
  const observations = [];
  let game;
  game = new Game({ onEvent: (name, payload) => {
    observations.push({ name, payload: copy(payload), state: game && game.state });
    bridge.event(name, payload);
  } });
  bridge.bind(game);
  return { ...w, bridge, game, statuses, logs, enqueued, consumed, acknowledgements, observations,
    flushCount: () => flushes, setPending: value => { pending = value; } };
}
function advance(game, seconds) {
  const frame = 1 / 120;
  const frames = Math.floor(seconds / frame);
  for (let i = 0; i < frames; i++) game.update(frame);
  const rest = seconds - frames * frame;
  if (rest > 1e-6) game.update(rest);
}
function start(f) {
  f.bridge.beginRun(false);
  f.game.start();
  advance(f.game, f.game.launchDuration);
  f.game.nextWave = 1000;
  assert.equal(f.game.state, 'playing');
}
function defeat(f, score = 800) {
  f.game.score = score;
  f.game.player.hp = 1;
  f.game.player.invincible = 0;
  f.game.enemyBullets.push({ x: f.game.player.x, y: f.game.player.y, vx: 0, vy: 0, r: 4, damage: 1 });
  f.game.update(1 / 120);
  assert.equal(f.game.state, 'ejecting');
  advance(f.game, f.game.ejectionDuration);
  assert.equal(f.game.state, 'gameover');
}
const settle = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
async function durableFixture() {
  const f = fixture();
  const server = account();
  const requests = [];
  const accepted = [];
  const gate = deferred();
  let saveCount = 0;
  let mutationCount = 0;
  const options = {
    storage: { get: key => f.wx.getStorageSync(key), set: (key, value) => f.wx.setStorageSync(key, value) },
    uuid: () => 'durable-mutation-' + (++mutationCount),
    transport: async request => {
      requests.push(copy(request));
      if (request.path === '/v1/auth/wechat') return { token: 'memory-only-session', account: copy(server) };
      if (request.path === '/v1/me') return copy(server);
      assert.equal(request.path, '/v1/me/save');
      if (++saveCount === 1) await gate.promise;
      assert.equal(request.body.expectedRevision, server.revision);
      accepted.push(copy(request.body));
      Object.assign(server, { profile: copy(request.body.profile), bestScore: request.body.bestScore,
        highestClearedStage: request.body.highestClearedStage, checkpoint: copy(request.body.checkpoint),
        revision: server.revision + 1, migrationAllowed: false });
      return { account: copy(server), mutationId: request.body.mutationId };
    }
  };
  f.bridge.client = new CloudSave(options);
  f.bridge.account = await f.bridge.client.login('wechat-code');
  return { ...f, requests, accepted, gate, createClient: () => new CloudSave(options) };
}
function loadActivate(game, bridge) {
  const source = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
  const from = source.indexOf('function activate(id) {');
  const to = source.indexOf('\nfunction suspend()', from);
  assert.ok(from >= 0 && to > from, 'actual WeChat input handler is present');
  const compiled = vm.runInThisContext('(function(game,cloud){ let ready=true,stopped=false,previousTime=null;\n' + source.slice(from, to) + '\nreturn activate;})', { filename: 'game.js:activate' });
  return compiled(game, bridge);
}

test('unconfigured cloud performs no login or request and announces local-only storage', async () => {
  const w = wxFixture();
  const statuses = [];
  const bridge = new (loadBridge())(w.wx, status => statuses.push(status));
  assert.equal(await bridge.prepare({ profile: { version: 1, totalXp: 0 }, bestScore: 0, checkpoint: null }), null);
  assert.equal(bridge.configured, false);
  assert.equal(bridge.client, null);
  assert.equal(w.calls.login.length, 0);
  assert.equal(w.calls.requests.length, 0);
  assert.equal(statuses.at(-1).state, 'pending-config');
  assert.match(statuses.at(-1).message, /仅本机保存/);
});

test('configured bridge passes wx login code and memory token through the real CloudSave client', async () => {
  const w = wxFixture();
  const serverAccount = account();
  w.wx.request = options => {
    w.calls.requests.push(options);
    if (options.url.endsWith('/v1/auth/wechat')) {
      assert.deepEqual(options.data, { code: 'wechat-code' });
      assert.equal(options.header.Authorization, undefined);
      options.success({ statusCode: 200, data: { token: 'server-session-token', account: serverAccount } });
    } else if (options.url.endsWith('/v1/me')) {
      assert.equal(options.header.Authorization, 'Bearer server-session-token');
      options.success({ statusCode: 200, data: copy(serverAccount) });
    } else throw new Error('Unexpected cloud endpoint ' + options.url);
  };
  const bridge = new (loadBridge('https://game.example.test'))(w.wx, () => {});
  const result = await bridge.prepare({ profile: { version: 1, totalXp: 0 }, bestScore: 0, checkpoint: null });
  assert.equal(result.user.id, 'pilot-a');
  assert.equal(w.calls.login.length, 1);
  assert.equal(w.calls.requests.length, 2);
  assert.equal(JSON.stringify([...w.memory.values()]).includes('server-session-token'), false);
});

test('local records owned by another META account are never imported into a new empty account', async () => {
  const emptyB = account();
  emptyB.user.id = 'pilot-b';
  const f = configuredFixture(emptyB);
  const local = nonemptyLocal();
  f.memory.set(META_KEY, { version: 1, userId: 'pilot-a', runId: 'preceding-a-run', highestClearedStage: 0, stageResults: [] });
  f.memory.set('fighter-era.profile', copy(local.profile));
  f.memory.set('neon-wing.best-score', local.bestScore);
  f.memory.set('fighter-era.checkpoint', copy(local.checkpoint));
  const bridge = f.createBridge();
  const result = await bridge.prepare(local);
  assert.equal(f.calls.requests.some(request => request.url.endsWith('/import')), false);
  assert.deepEqual(result, emptyB, 'account B keeps its own empty server record');
  assert.equal(f.memory.get(META_KEY).userId, 'pilot-b');
  assert.deepEqual(f.memory.get('fighter-era.profile'), local.profile, 'prepare binds ownership before the entry replaces the local mirror');
  assert.equal(f.memory.get('neon-wing.best-score'), local.bestScore);
  assert.deepEqual(f.memory.get('fighter-era.checkpoint'), local.checkpoint);
});

test('an idle outbox retains account ownership and prevents cross-account import even without META', async () => {
  const f = configuredFixture();
  const local = nonemptyLocal();
  const first = f.createBridge();
  await first.prepare(local);
  const stored = copy(f.memory.get(STORAGE_KEY));
  assert.equal(stored.accountId, 'pilot-a');
  assert.equal(stored.pending, null);
  assert.deepEqual(stored.queue, []);
  assert.equal(f.calls.requests.filter(request => request.url.endsWith('/import')).length, 1);
  f.memory.delete(META_KEY);
  const emptyB = account();
  emptyB.user.id = 'pilot-b';
  f.setServer(emptyB);
  const switched = f.createBridge();
  const result = await switched.prepare(local);
  assert.equal(f.calls.requests.filter(request => request.url.endsWith('/import')).length, 1, 'switching account must not import the previous mirror');
  assert.deepEqual(result, emptyB);
  assert.equal(f.memory.get(META_KEY).userId, 'pilot-b');
});

test('a completely unbound local record can migrate on the first account login', async () => {
  const f = configuredFixture();
  const local = nonemptyLocal();
  assert.equal(f.memory.has(META_KEY), false);
  assert.equal(f.memory.has(STORAGE_KEY), false);
  const bridge = f.createBridge();
  const result = await bridge.prepare(local);
  const imports = f.calls.requests.filter(request => request.url.endsWith('/import'));
  assert.equal(imports.length, 1);
  assert.deepEqual(imports[0].data.profile, local.profile);
  assert.deepEqual(imports[0].data.checkpoint, local.checkpoint);
  assert.equal(imports[0].data.bestScore, local.bestScore);
  assert.deepEqual(result.profile, local.profile);
  assert.deepEqual(result.checkpoint, local.checkpoint);
  assert.equal(result.revision, 1);
  assert.equal(f.memory.get(STORAGE_KEY).pending, null);
  assert.equal(f.memory.get(STORAGE_KEY).accountId, result.user.id);
});

test('successful first prepare persists the account identity before returning the server record', async () => {
  const f = configuredFixture();
  const bridge = f.createBridge();
  const result = await bridge.prepare({ profile: { version: 1, totalXp: 0 }, bestScore: 0, checkpoint: null });
  const context = f.memory.get(META_KEY);
  assert.equal(context.version, 1);
  assert.equal(context.userId, result.user.id);
  assert.match(context.runId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(bridge.account.user.id, context.userId);
  assert.deepEqual(context.stageResults, []);
});

test('account identity persistence failure rejects prepare instead of claiming successful initialization', async () => {
  const f = configuredFixture();
  const originalSet = f.wx.setStorageSync;
  f.wx.setStorageSync = (key, value) => {
    if (key === META_KEY) throw new Error('Simulated account identity storage failure');
    originalSet(key, value);
  };
  const bridge = f.createBridge();
  await assert.rejects(bridge.prepare({ profile: { version: 1, totalXp: 0 }, bestScore: 0, checkpoint: null }), /Simulated account identity storage failure/);
  assert.equal(f.memory.has(META_KEY), false);
  assert.equal(bridge.account, null, 'a failed ownership binding must not expose a prepared account');
  assert.equal(f.calls.requests.filter(request => request.url.endsWith('/import')).length, 0);
});

test('a non-HTTPS cloud address fails before requesting WeChat login', async () => {
  const w = wxFixture();
  const bridge = new (loadBridge('http://game.example.test'))(w.wx, () => {});
  await assert.rejects(bridge.prepare({ profile: { version: 1, totalXp: 0 }, bestScore: 0, checkpoint: null }), /HTTPS/);
  assert.equal(w.calls.login.length, 0);
  assert.equal(w.calls.requests.length, 0);
});

test('real defeat is queued synchronously and immediate restart retains the preceding terminal result', async () => {
  const f = fixture();
  start(f);
  const oldId = f.bridge.context.runId;
  defeat(f);
  const terminal = f.enqueued.at(-1);
  assert.deepEqual({ id: terminal.run.id, status: terminal.run.status, score: terminal.run.score }, { id: oldId, status: 'defeated', score: 800 });
  assert.equal(f.flushCount(), 0, 'terminal record is durable before any deferred task runs');
  f.bridge.beginRun(false);
  f.game.start();
  const newId = f.bridge.context.runId;
  assert.notEqual(newId, oldId);
  assert.equal(terminal.run.status, 'defeated');
  await settle();
  assert.equal(f.enqueued.at(-1).run.id, newId);
  assert.equal(f.enqueued.at(-1).run.status, 'active');
  assert.equal(f.enqueued.at(-1).run.score, 0);
});

test('start checkpoint emitted while engine still says gameover remains an active new attempt', async () => {
  const f = fixture();
  start(f);
  defeat(f);
  await settle();
  const count = f.observations.length;
  f.bridge.beginRun(false);
  f.game.start();
  const firstCheckpoint = f.observations.slice(count).find(item => item.name === 'checkpoint');
  assert.equal(firstCheckpoint.state, 'gameover', 'exercise the actual event order that previously caused terminal misclassification');
  await settle();
  assert.equal(f.enqueued.at(-1).run.status, 'active');
  assert.equal(f.enqueued.at(-1).checkpoint.phase, 'stage');
});

test('every continuation receives a fresh run ID instead of modifying the defeated attempt', async () => {
  const f = fixture();
  start(f);
  defeat(f);
  const defeatedId = f.bridge.context.runId;
  f.bridge.beginRun(true);
  assert.equal(f.game.continueRun(), true);
  const resumedId = f.bridge.context.runId;
  assert.notEqual(resumedId, defeatedId);
  await settle();
  assert.equal(f.enqueued.at(-1).run.id, resumedId);
  assert.equal(f.enqueued.at(-1).run.status, 'active');
  assert.equal(f.enqueued.find(item => item.run.id === defeatedId && item.run.status === 'defeated').run.status, 'defeated');
  f.bridge.beginRun(true);
  assert.notEqual(f.bridge.context.runId, resumedId);
});

test('home and background after defeat cannot change the terminal record', async () => {
  const f = fixture();
  start(f);
  defeat(f, 912);
  await settle();
  const terminal = copy(f.enqueued.at(-1));
  const count = f.enqueued.length;
  f.game.home();
  assert.equal(f.game.score, 0);
  f.bridge.flushOnHide();
  await settle();
  assert.equal(f.enqueued.length, count);
  assert.deepEqual(f.enqueued.at(-1), terminal);
  assert.equal(f.bridge.running, false);
});

test('active return to the hangar saves before the engine resets and background cannot regress that run', async () => {
  const f = fixture();
  const activate = loadActivate(f.game, f.bridge);
  activate('start');
  advance(f.game, f.game.launchDuration);
  f.game.nextWave = 1000;
  await settle();
  const runId = f.bridge.context.runId;
  f.game.score = 640;
  f.game.kills = 8;
  activate('home');
  const saved = copy(f.enqueued.at(-1));
  assert.equal(saved.run.id, runId);
  assert.equal(saved.run.score, 640);
  assert.equal(saved.run.kills, 8);
  assert.equal(f.game.state, 'menu');
  assert.equal(f.game.score, 0);
  assert.equal(f.bridge.running, false);
  const count = f.enqueued.length;
  f.bridge.flushOnHide();
  f.bridge.tick(10);
  await settle();
  assert.equal(f.enqueued.length, count);
  assert.deepEqual(f.enqueued.at(-1), saved);
});

test('checkpoint changes persist in the real outbox while an earlier save request is still in flight', async () => {
  const f = await durableFixture();
  start(f);
  await settle();
  assert.equal(f.bridge.working, true);
  assert.equal(f.requests.filter(request => request.path.endsWith('/save')).length, 1);
  const pending = copy(f.memory.get(STORAGE_KEY).pending);
  assert.equal(pending.body.checkpoint.freeCharges.support, 1);
  assert.equal(f.game.callSupport(), true);
  const persisted = copy(f.memory.get(STORAGE_KEY));
  assert.deepEqual(persisted.pending, pending, 'an in-flight mutation stays immutable');
  assert.equal(persisted.queue.length, 1);
  assert.equal(persisted.queue[0].checkpoint.freeCharges.support, 0);
  assert.equal(f.requests.filter(request => request.path.endsWith('/save')).length, 1);
  const reloaded = f.createClient();
  await reloaded.login('wechat-code');
  assert.equal(reloaded.getPendingSnapshot().checkpoint.freeCharges.support, 0, 'the consumed free charge survives process reload');
  f.gate.resolve();
  await settle();
  assert.equal(f.accepted.at(-1).checkpoint.freeCharges.support, 0);
  assert.equal(f.memory.get(STORAGE_KEY).queue.length, 0);
});

test('ordinary experience is durable during a request and terminal coalescing retains consecutive attempts', async () => {
  const f = await durableFixture();
  start(f);
  await settle();
  const oldId = f.bridge.context.runId;
  f.game.destroyEnemy({ type: 'scout', id: 500, x: 80, y: 130, hp: 1 });
  const afterKill = f.memory.get(STORAGE_KEY);
  assert.equal(afterKill.queue.length, 1);
  assert.equal(afterKill.queue[0].profile.totalXp, 10);
  assert.equal(afterKill.queue[0].run.score, 80);
  assert.equal(f.requests.filter(request => request.path.endsWith('/save')).length, 1, 'ordinary XP does not start another request');
  const reloaded = f.createClient();
  await reloaded.login('wechat-code');
  assert.equal(reloaded.getPendingSnapshot().profile.totalXp, 10);
  defeat(f, 880);
  const terminal = copy(f.memory.get(STORAGE_KEY).queue[0]);
  assert.equal(terminal.run.status, 'defeated');
  assert.equal(terminal.run.id, oldId);
  assert.equal(terminal.profile.totalXp, 10);
  f.bridge.beginRun(false);
  f.game.start();
  const newId = f.bridge.context.runId;
  const queued = copy(f.memory.get(STORAGE_KEY).queue);
  assert.equal(queued.length, 2);
  assert.deepEqual(queued[0], terminal, 'new attempt cannot replace the preceding terminal record');
  assert.equal(queued[1].run.id, newId);
  assert.equal(queued[1].run.status, 'active');
  f.gate.resolve();
  await settle();
  assert.deepEqual(f.accepted.map(body => body.run.status), ['active', 'defeated', 'active']);
  assert.deepEqual(f.accepted.map(body => body.expectedRevision), [0, 1, 2]);
  assert.equal(f.accepted[1].run.score, 880);
  assert.equal(f.accepted[1].profile.totalXp, 10);
  assert.equal(f.accepted[2].run.id, newId);
  assert.equal(f.memory.get(STORAGE_KEY).pending, null);
  assert.equal(f.memory.get(STORAGE_KEY).queue.length, 0);
});

test('actual WeChat buttons use each free stage ability without calling paid inventory', async () => {
  const f = fixture();
  const activate = loadActivate(f.game, f.bridge);
  activate('start');
  advance(f.game, f.game.launchDuration);
  f.game.nextWave = 1000;
  await settle();
  activate('support');
  activate('bomb');
  assert.equal(f.game.supportCharges, 0);
  assert.equal(f.game.bombCharges, 0);
  assert.equal(f.game.allies.length, 2);
  assert.equal(f.consumed.length, 0);
  assert.deepEqual(f.game.inventory, { bomb: 2, support: 2 });
  await settle();
});

test('paid item applies only after confirmation and preserves the already-spent free charge', async () => {
  const f = fixture();
  start(f);
  await settle();
  assert.equal(f.game.useBomb(), true);
  advance(f.game, f.game.bombDuration + 1 / 120);
  await settle();
  assert.equal(await f.bridge.useInventory('bomb'), true);
  assert.deepEqual(f.consumed, ['bomb']);
  assert.equal(f.game.state, 'playing');
  assert.equal(f.game.bombCharges, 0);
  assert.equal(f.game.inventory.bomb, 1);
  assert.deepEqual(f.acknowledgements, ['inventory-1']);
  await settle();
});

test('unresolved inventory intent prevents duplicate consumption with an explicit status', async () => {
  const f = fixture();
  start(f);
  await settle();
  f.setPending({ item: 'bomb', mutationId: 'uncertain-item', state: 'pending' });
  assert.equal(await f.bridge.useInventory('bomb'), false);
  assert.equal(f.consumed.length, 0);
  assert.equal(f.game.state, 'playing');
  assert.equal(f.statuses.at(-1).state, 'error');
  assert.match(f.statuses.at(-1).message, /上次道具使用仍待确认/);
});

test('stage clear evidence follows the actual BOSS event and appears in the next checkpoint', async () => {
  const f = fixture();
  start(f);
  await settle();
  f.game.spawnBoss();
  const boss = f.game.enemies.find(enemy => enemy.type === 'boss');
  boss.y = 160;
  assert.equal(f.game.useBomb(), true);
  assert.equal(f.game.state, 'upgrade');
  await settle();
  const saved = f.enqueued.at(-1);
  assert.equal(saved.highestClearedStage, 1);
  assert.deepEqual(saved.stageResults, [{ stage: 1, score: 2000, kills: 1 }]);
  assert.equal(saved.checkpoint.phase, 'upgrade');
  assert.equal(f.memory.get(META_KEY).highestClearedStage, 1);
});
