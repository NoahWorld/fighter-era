const test = require('node:test');
const assert = require('node:assert/strict');
const { CloudSave, CloudSaveError, STORAGE_KEY } = require('../src/cloud-save.js');

const copy = value => JSON.parse(JSON.stringify(value));
function initialAccount(id = 'pilot-a') {
  return { user: { id }, revision: 0, profile: { version: 1, totalXp: 0 }, bestScore: 0,
    highestClearedStage: 0, checkpoint: null, inventory: { bomb: 2, support: 1 }, migrationAllowed: true };
}
function runSnapshot(xp = 12, overrides = {}) {
  return Object.assign({ profile: { version: 1, totalXp: xp }, bestScore: 20, highestClearedStage: 0,
    checkpoint: null, run: { id: 'run-a', stage: 0, score: 20, kills: 2, status: 'active' }, stageResults: [] }, overrides);
}
function apiError(status, code) {
  return Object.assign(new Error(code), { status, details: { error: { code, message: code, currentRevision: 8 } } });
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function fixture(options = {}) {
  const memory = options.memory || new Map();
  const statuses = [];
  const calls = [];
  const accepted = [];
  const mutations = new Map();
  const consumptions = new Map();
  const accounts = new Map([['pilot-a', initialAccount()], ['pilot-b', initialAccount('pilot-b')]]);
  let currentUser = 'pilot-a';
  let nextId = 0;
  let writeFailure = false;
  let interceptor = null;
  const storage = {
    get: key => memory.has(key) ? copy(memory.get(key)) : undefined,
    set: (key, value) => {
      if (writeFailure) throw new Error('disk full');
      memory.set(key, copy(value));
    }
  };
  const transport = async request => {
    calls.push(copy(request));
    if (interceptor) await interceptor(request);
    if (request.path === '/v1/auth/wechat') {
      currentUser = request.body.code === 'code-b' ? 'pilot-b' : 'pilot-a';
      return { token: 'session-' + currentUser, account: copy(accounts.get(currentUser)) };
    }
    const authenticated = String(request.token).replace('session-', '');
    const account = accounts.get(authenticated);
    assert.ok(account, 'authenticated requests carry the in-memory token');
    if (request.path === '/v1/me') return copy(account);
    if (request.path === '/v1/inventory/consume') {
      const { item, mutationId } = request.body;
      const key = authenticated + ':' + mutationId;
      if (consumptions.has(key)) return copy(consumptions.get(key));
      if (account.inventory[item] < 1) throw apiError(409, 'INSUFFICIENT_INVENTORY');
      account.inventory[item]--;
      const result = { inventory: copy(account.inventory), mutationId };
      consumptions.set(key, result);
      return copy(result);
    }
    if (['/v1/me/save', '/v1/me/import'].includes(request.path)) {
      const { mutationId } = request.body;
      const key = authenticated + ':' + mutationId;
      if (!mutations.has(key)) {
        if (request.path.endsWith('/import') && !account.migrationAllowed) throw apiError(409, 'IMPORT_NOT_ALLOWED');
        if (request.path.endsWith('/save') && request.body.expectedRevision !== account.revision) throw apiError(409, 'REVISION_CONFLICT');
        mutations.set(key, copy(request.body));
        accepted.push(copy(request.body));
        account.profile = copy(request.body.profile);
        account.bestScore = Math.max(account.bestScore, request.body.bestScore);
        account.checkpoint = copy(request.body.checkpoint);
        if (request.path.endsWith('/save')) account.highestClearedStage = Math.max(account.highestClearedStage, request.body.highestClearedStage);
        account.migrationAllowed = false;
        account.revision++;
      }
      const result = { account: copy(account), mutationId };
      if (options.afterCommit) await options.afterCommit(request, result);
      return result;
    }
    throw new Error('Unexpected API path ' + request.path);
  };
  const create = () => new CloudSave({ transport, storage, uuid: () => 'mutation-' + (++nextId), onStatus: status => statuses.push(status) });
  return { create, memory, statuses, calls, accepted, accounts, transport, storage,
    intercept: handler => { interceptor = handler; }, failWrites: () => { writeFailure = true; } };
}

test('login reads the account and never persists authentication tokens', async () => {
  const f = fixture();
  const cloud = f.create();
  const account = await cloud.login('code-a');
  assert.equal(account.user.id, 'pilot-a');
  assert.deepEqual(f.calls.map(call => call.path), ['/v1/auth/wechat', '/v1/me']);
  cloud.enqueue(runSnapshot());
  assert.equal(JSON.stringify(f.memory.get(STORAGE_KEY)).includes('session-pilot-a'), false);
  account.profile.totalXp = 999;
  assert.equal(cloud.getAccount().profile.totalXp, 0);
});

test('network failure retains the exact mutation for retry and reports retry counts', async () => {
  const f = fixture();
  const cloud = f.create();
  await cloud.login('code-a');
  cloud.enqueue(runSnapshot());
  let fail = true;
  f.intercept(request => { if (request.path === '/v1/me/save' && fail) { fail = false; throw new Error('connection lost'); } });
  await assert.rejects(cloud.flush(), error => error.code === 'NETWORK_ERROR' && error.retry === 1);
  const first = copy(f.calls.at(-1).body);
  assert.equal(cloud.getStatus().state, 'error');
  assert.match(cloud.getStatus().message, /网络异常.*重试次数 1/);
  await cloud.flush();
  assert.deepEqual(f.calls.at(-1).body, first);
  assert.equal(f.accepted.length, 1);
  assert.equal(cloud.getStatus().state, 'synced');
});

test('a lost save response survives reload and cannot double apply experience', async () => {
  let lost = true;
  const f = fixture({ afterCommit: () => { if (lost) { lost = false; throw new Error('response lost after commit'); } } });
  const cloud = f.create();
  await cloud.login('code-a');
  cloud.enqueue(runSnapshot(24));
  await assert.rejects(cloud.flush());
  const body = copy(f.calls.at(-1).body);
  const reloaded = f.create();
  await reloaded.login('code-a');
  await reloaded.flush();
  assert.deepEqual(f.calls.at(-1).body, body);
  assert.equal(f.accepted.length, 1);
  assert.equal(reloaded.getAccount().profile.totalXp, 24);
  assert.equal(f.memory.get(STORAGE_KEY).pending, null);
});

test('concurrent flushes share one request; newer gameplay snapshots retain order', async () => {
  const f = fixture();
  const cloud = f.create();
  await cloud.login('code-a');
  const gate = deferred();
  let first = true;
  f.intercept(request => { if (request.path === '/v1/me/save' && first) { first = false; return gate.promise; } });
  cloud.enqueue(runSnapshot(12));
  const running = cloud.flush();
  assert.equal(cloud.flush(), running);
  cloud.enqueue(runSnapshot(36));
  cloud.enqueue(runSnapshot(48));
  assert.equal(f.memory.get(STORAGE_KEY).queue.length, 1);
  gate.resolve();
  await running;
  assert.deepEqual(f.accepted.map(item => item.profile.totalXp), [12, 48]);
  assert.deepEqual(f.accepted.map(item => item.expectedRevision), [0, 1]);
});

test('revision conflicts preserve records and stop subsequent automatic uploads', async () => {
  const f = fixture();
  const cloud = f.create();
  await cloud.login('code-a');
  cloud.enqueue(runSnapshot());
  f.intercept(request => { if (request.path === '/v1/me/save') throw apiError(409, 'REVISION_CONFLICT'); });
  await assert.rejects(cloud.flush(), error => error.status === 409);
  assert.equal(cloud.getStatus().state, 'conflict');
  const requests = f.calls.length;
  await assert.rejects(cloud.flush(), error => error.code === 'SYNC_CONFLICT');
  assert.equal(f.calls.length, requests);
  assert.ok(f.memory.get(STORAGE_KEY).pending);
  const reloaded = f.create();
  await reloaded.login('code-a');
  await assert.rejects(reloaded.flush(), error => error.code === 'SYNC_CONFLICT');
});

test('pending records cannot be sent under a different WeChat account', async () => {
  const f = fixture();
  const cloud = f.create();
  await cloud.login('code-a');
  cloud.enqueue(runSnapshot());
  const reloaded = f.create();
  await reloaded.login('code-b');
  assert.equal(reloaded.getStatus().state, 'conflict');
  assert.equal(reloaded.getPendingSnapshot(), null);
  await assert.rejects(reloaded.flush(), error => error.code === 'SYNC_CONFLICT');
  assert.equal(f.calls.filter(call => call.path === '/v1/me/save').length, 0);
  assert.equal(f.memory.get(STORAGE_KEY).accountId, 'pilot-a');
});

test('local migration reuses its persisted ID after a committed response is lost', async () => {
  let lost = true;
  const f = fixture({ afterCommit: () => { if (lost) { lost = false; throw new Error('migration response lost'); } } });
  const cloud = f.create();
  await cloud.login('code-a');
  const local = { profile: { version: 1, totalXp: 80 }, bestScore: 456, checkpoint: null };
  await assert.rejects(cloud.importLocal(local));
  const original = copy(f.calls.at(-1).body);
  const reloaded = f.create();
  await reloaded.login('code-a');
  assert.equal(reloaded.getAccount().migrationAllowed, false);
  await reloaded.importLocal(local);
  assert.deepEqual(f.calls.at(-1).body, original);
  assert.equal(f.accepted.length, 1);
  assert.equal(reloaded.getAccount().profile.totalXp, 80);
  await assert.rejects(reloaded.importLocal(local), error => error.code === 'IMPORT_NOT_ALLOWED');
});

test('storage write failure inhibits network requests and never reports cloud success', async () => {
  const f = fixture();
  const cloud = f.create();
  await cloud.login('code-a');
  cloud.enqueue(runSnapshot());
  f.failWrites();
  await assert.rejects(cloud.flush(), error => error.code === 'OUTBOX_WRITE_FAILED');
  assert.equal(f.calls.filter(call => call.path === '/v1/me/save').length, 0);
  assert.equal(cloud.getStatus().state, 'error');
  await assert.rejects(cloud.flush(), error => error.code === 'OUTBOX_WRITE_FAILED');
});

test('corrupted outbox fails visibly without overwriting its original content', () => {
  const memory = new Map([[STORAGE_KEY, { version: 99, secretEvidence: 'preserve me' }]]);
  const f = fixture({ memory });
  assert.throws(() => f.create(), error => error instanceof CloudSaveError && error.code === 'OUTBOX_READ_FAILED');
  assert.deepEqual(memory.get(STORAGE_KEY), { version: 99, secretEvidence: 'preserve me' });
});

test('inventory response loss retries the same request; confirmed receipts need explicit acknowledgement', async () => {
  const f = fixture();
  const originalTransport = f.transport;
  let lost = true;
  const transport = async request => {
    const response = await originalTransport(request);
    if (request.path === '/v1/inventory/consume' && lost) { lost = false; throw new Error('inventory response lost'); }
    return response;
  };
  let next = 0;
  const create = () => new CloudSave({ transport, storage: f.storage, uuid: () => 'item-' + (++next) });
  const cloud = create();
  await cloud.login('code-a');
  await assert.rejects(cloud.consume('bomb'));
  const intent = cloud.getPendingConsumption();
  const reloaded = create();
  await reloaded.login('code-a');
  const response = await reloaded.retryConsumption();
  assert.equal(response.mutationId, intent.mutationId);
  assert.equal(response.inventory.bomb, 1);
  assert.equal(reloaded.getPendingConsumption().state, 'confirmed');
  const requestCount = f.calls.length;
  assert.deepEqual(await reloaded.retryConsumption(), response);
  assert.equal(f.calls.length, requestCount);
  assert.throws(() => reloaded.acknowledgeConsumption('wrong-id'), /对应道具操作/);
  reloaded.acknowledgeConsumption(response.mutationId);
  assert.equal(reloaded.getPendingConsumption(), null);
});

test('definitive item shortages do not freeze cloud progression or retain a false debit', async () => {
  const f = fixture();
  f.accounts.get('pilot-a').inventory.bomb = 0;
  const cloud = f.create();
  await cloud.login('code-a');
  await assert.rejects(cloud.consume('bomb'), error => error.status === 409);
  assert.equal(cloud.getPendingConsumption(), null);
  cloud.enqueue(runSnapshot());
  await cloud.flush();
  assert.equal(cloud.getStatus().state, 'synced');
});

test('offline consecutive runs preserve both terminal records in FIFO order across reload', async () => {
  const f = fixture();
  const cloud = f.create();
  await cloud.login('code-a');
  const first = runSnapshot(18);
  cloud.enqueue(first);
  f.intercept(request => { if (request.path === '/v1/me/save') throw new Error('offline'); });
  await assert.rejects(cloud.flush());
  cloud.enqueue(runSnapshot(30, { run: { ...first.run, status: 'defeated' } }));
  const second = runSnapshot(42, { run: { ...first.run, id: 'run-b' } });
  cloud.enqueue(second);
  cloud.enqueue(runSnapshot(54, { run: { ...second.run, status: 'defeated' } }));
  assert.equal(f.memory.get(STORAGE_KEY).queue.length, 2);
  f.intercept(null);
  const reloaded = f.create();
  await reloaded.login('code-a');
  await reloaded.flush();
  assert.deepEqual(f.accepted.map(item => [item.run.id, item.run.status]), [
    ['run-a', 'active'], ['run-a', 'defeated'], ['run-b', 'defeated']
  ]);
  assert.deepEqual(f.accepted.map(item => item.expectedRevision), [0, 1, 2]);
  assert.equal(reloaded.getAccount().profile.totalXp, 54);
});

test('coalescing preserves completed-stage evidence and uses one result per stage', async () => {
  const f = fixture();
  const cloud = f.create();
  await cloud.login('code-a');
  cloud.enqueue(runSnapshot(12, { highestClearedStage: 1, stageResults: [{ stage: 1, score: 10, kills: 1 }] }));
  cloud.enqueue(runSnapshot(24, { highestClearedStage: 2, stageResults: [{ stage: 1, score: 10, kills: 1 }, { stage: 2, score: 20, kills: 2 }] }));
  cloud.enqueue(runSnapshot(30, { highestClearedStage: 2, stageResults: [] }));
  await cloud.flush();
  assert.deepEqual(f.accepted[0].stageResults.map(result => result.stage), [1, 2]);
});

test('queue capacity is explicit and preserves all accepted local records', async () => {
  const f = fixture();
  const cloud = f.create();
  await cloud.login('code-a');
  for (let i = 0; i < 100; i++) cloud.enqueue(runSnapshot(12 + i, { run: { id: 'run-' + i, stage: 0, score: 20, kills: 2, status: 'defeated' } }));
  assert.throws(() => cloud.enqueue(runSnapshot(112, { run: { id: 'overflow', stage: 0, score: 20, kills: 2, status: 'active' } })), error => error.code === 'OUTBOX_FULL');
  assert.equal(f.memory.get(STORAGE_KEY).queue.length, 100);
});

test('invalid server responses remain pending and report protocol errors', async () => {
  const f = fixture();
  const cloud = new CloudSave({ storage: f.storage, uuid: () => 'invalid-response', transport: async request => {
    const response = await f.transport(request);
    return request.path === '/v1/me/save' ? { ...response, mutationId: 'wrong-id' } : response;
  } });
  await cloud.login('code-a');
  cloud.enqueue(runSnapshot());
  await assert.rejects(cloud.flush(), error => error.code === 'INVALID_RESPONSE');
  assert.equal(cloud.getStatus().state, 'error');
  assert.ok(f.memory.get(STORAGE_KEY).pending);
  assert.doesNotMatch(cloud.getStatus().message, /网络异常/);
});

test('snapshot validation rejects NaN and cycles before altering durable state', async () => {
  const f = fixture();
  const cloud = f.create();
  await cloud.login('code-a');
  assert.throws(() => cloud.enqueue(runSnapshot(NaN)), /finite numbers/);
  const cyclic = runSnapshot();
  cyclic.checkpoint = cyclic;
  assert.throws(() => cloud.enqueue(cyclic), /cycles/);
  assert.equal(f.memory.has(STORAGE_KEY), false);
});
