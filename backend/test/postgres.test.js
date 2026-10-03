import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createStore } from '../src/store.js';
import { loadConfig } from '../src/config.js';
import { migrate } from '../src/migrate.js';
import { buildApp } from '../src/app.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const skip = !databaseUrl && 'TEST_DATABASE_URL is not configured; real PostgreSQL integration must run separately';
let pool, store, app;
const seedCheckpoint = () => ({ version: 1, phase: 'stage', stage: 0, seed: 123, randomState: 123, entityId: 0, totalTime: 0, score: 0, kills: 0, runStartXp: 0, player: { hp: 5, maxHp: 5, weaponLevel: 1 }, fireInterval: 0.16, damageBonus: 0, freeCharges: { bomb: 1, support: 1 } });
const saveBody = (revision, overrides = {}) => ({ mutationId: randomUUID(), expectedRevision: revision, profile: { version: 1, totalXp: 10 }, bestScore: 100, highestClearedStage: 0, checkpoint: seedCheckpoint(), run: { id: randomUUID(), stage: 0, score: 100, kills: 1, status: 'active' }, stageResults: [], ...overrides });
const account = async () => store.createSession('test-openid-' + randomUUID());

test.before(async () => {
  if (!databaseUrl) return;
  const parsed = new URL(databaseUrl);
  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  assert.match(databaseName, /_test$/, 'Integration tests must use a separate database ending in _test');
  const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: databaseUrl, WECHAT_APP_ID: 'wxbc890abdf12df15b', WECHAT_APP_SECRET: 'test-secret' });
  pool = new pg.Pool({ connectionString: databaseUrl, max: 8, connectionTimeoutMillis: 5000 });
  assert.equal((await pool.query('SELECT current_database() AS name')).rows[0].name, databaseName);
  await migrate(pool, () => {});
  store = createStore(pool, config);
  app = await buildApp({ config, pool, store, wechat: { exchangeCode: async code => ({ openid: 'test-auth-' + code }) }, logger: false });
});
test.after(async () => {
  if (app) await app.close();
  if (pool) await pool.end();
});

test('PostgreSQL migrations are repeatable and create healthy schema', { skip }, async () => {
  await migrate(pool, () => {});
  await store.health();
  assert.equal((await app.inject('/health/ready')).statusCode, 200);
});

test('WeChat identity is stable, session is opaque and database stores only token hash', { skip }, async () => {
  const login = await account();
  const second = await store.createSession((await pool.query('SELECT wechat_openid FROM users WHERE id=$1', [login.account.user.id])).rows[0].wechat_openid);
  assert.equal(second.account.user.id, login.account.user.id);
  assert.notEqual(second.token, login.token);
  assert.equal(await store.authenticate(login.token), login.account.user.id);
  const hashes = (await pool.query('SELECT token_hash FROM sessions WHERE user_id=$1', [login.account.user.id])).rows;
  assert.ok(hashes.every(row => row.token_hash.length === 64 && row.token_hash !== login.token));
  await pool.query('UPDATE sessions SET expires_at=now()-interval \'1 second\' WHERE user_id=$1', [login.account.user.id]);
  await assert.rejects(store.authenticate(login.token), error => error.statusCode === 401);
});

test('first local import is once only and retry after lost response is idempotent', { skip }, async () => {
  const { account: user } = await account();
  const body = { mutationId: randomUUID(), profile: { version: 1, totalXp: 150 }, bestScore: 900, checkpoint: seedCheckpoint() };
  const imported = await store.importSave(user.user.id, body);
  assert.equal(imported.account.revision, 1);
  assert.equal(imported.account.profile.totalXp, 150);
  assert.equal(imported.account.migrationAllowed, false);
  assert.deepEqual(await store.importSave(user.user.id, body), imported);
  await assert.rejects(store.importSave(user.user.id, { ...body, mutationId: randomUUID() }), error => error.code === 'IMPORT_NOT_ALLOWED');
  await assert.rejects(store.importSave(user.user.id, { ...body, bestScore: 901 }), error => error.code === 'MUTATION_REUSED');
});

test('save mutation replay precedes revision checks, property order does not affect identity', { skip }, async () => {
  const { account: user } = await account();
  const body = saveBody(0);
  const result = await store.save(user.user.id, body);
  assert.equal(result.account.revision, 1);
  assert.deepEqual(await store.save(user.user.id, Object.fromEntries(Object.entries(body).reverse())), result);
  await assert.rejects(store.save(user.user.id, { ...body, bestScore: 101 }), error => error.code === 'MUTATION_REUSED');
});

test('concurrent cloud saves allow one revision winner and expose a conflict', { skip }, async () => {
  const { account: user } = await account();
  const outcomes = await Promise.allSettled([store.save(user.user.id, saveBody(0)), store.save(user.user.id, saveBody(0))]);
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find(item => item.status === 'rejected').reason.code, 'SAVE_CONFLICT');
  assert.equal((await store.getAccount(user.user.id)).revision, 1);
});

test('stage clears count once per run across different save mutations', { skip }, async () => {
  const { account: user } = await account();
  const checkpoint = { ...seedCheckpoint(), phase: 'upgrade', score: 100, kills: 1 };
  const body = saveBody(0, { checkpoint, highestClearedStage: 1, stageResults: [{ stage: 1, score: 100, kills: 1 }] });
  await store.save(user.user.id, body);
  await store.save(user.user.id, { ...body, mutationId: randomUUID(), expectedRevision: 1 });
  const record = (await pool.query('SELECT clear_count,best_score FROM stage_records WHERE user_id=$1 AND stage=1', [user.user.id])).rows[0];
  assert.equal(record.clear_count, 1);
  assert.equal(Number(record.best_score), 100);
});

test('invalid checkpoint or missing stage evidence rolls back every update', { skip }, async () => {
  const { account: user } = await account();
  await assert.rejects(store.save(user.user.id, saveBody(0, { checkpoint: { ...seedCheckpoint(), player: { hp: 10, maxHp: 5, weaponLevel: 1 } } })), error => error.code === 'INVALID_CHECKPOINT');
  await assert.rejects(store.save(user.user.id, saveBody(0, { highestClearedStage: 100 })), error => error.code === 'INVALID_STAGE_PROGRESS');
  assert.equal((await store.getAccount(user.user.id)).revision, 0);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM game_runs WHERE user_id=$1', [user.user.id])).rows[0].count, 0);
});

test('server rejects skipped stage clears and arbitrary new-run stage selection', { skip }, async () => {
  const { account: user } = await account();
  const skipped = saveBody(0, { checkpoint: null, highestClearedStage: 100, run: { id: randomUUID(), stage: 99, score: 100, kills: 1, status: 'victory' }, stageResults: [{ stage: 100, score: 100, kills: 1 }] });
  await assert.rejects(store.save(user.user.id, skipped), error => error.code === 'INVALID_RUN_START');
  const body = saveBody(0);
  await store.save(user.user.id, body);
  const next = { ...body, mutationId: randomUUID(), expectedRevision: 1, checkpoint: null, run: { ...body.run, stage: 2 }, highestClearedStage: 3, stageResults: [{ stage: 1, score: 100, kills: 1 }, { stage: 3, score: 100, kills: 1 }] };
  await assert.rejects(store.save(user.user.id, next), error => error.code === 'INVALID_STAGE_PROGRESS');
});

test('terminal run cannot return to active state and progression never decreases', { skip }, async () => {
  const { account: user } = await account();
  const body = saveBody(0, { checkpoint: null });
  body.run.status = 'defeated';
  await store.save(user.user.id, body);
  await assert.rejects(store.save(user.user.id, { ...body, mutationId: randomUUID(), expectedRevision: 1, run: { ...body.run, status: 'active' } }), error => error.code === 'INVALID_RUN_TRANSITION');
  await assert.rejects(store.save(user.user.id, saveBody(1, { profile: { version: 1, totalXp: 1 } })), error => error.code === 'PROGRESSION_DECREASE');
});

test('defeat preserves a valid stage-start checkpoint and continuation creates a new run', { skip }, async () => {
  const { account: user } = await account();
  const checkpoint = { ...seedCheckpoint(), freeCharges: { bomb: 0, support: 1 } };
  const defeated = saveBody(0, { checkpoint });
  defeated.run.status = 'defeated';
  const result = await store.save(user.user.id, defeated);
  assert.deepEqual(result.account.checkpoint, checkpoint);
  const continued = saveBody(1, { profile: { version: 1, totalXp: 10 }, checkpoint, run: { id: randomUUID(), stage: 0, score: 0, kills: 0, status: 'active' } });
  const resumed = await store.save(user.user.id, continued);
  assert.equal(resumed.account.revision, 2);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM game_runs WHERE user_id=$1', [user.user.id])).rows[0].count, 2);
});

test('restored upgrade panel allows a new attempt then advances without rewarding the old boss twice', { skip }, async () => {
  const { account: user } = await account();
  const checkpoint = { ...seedCheckpoint(), phase: 'upgrade', stage: 1, score: 100, kills: 1 };
  await store.importSave(user.user.id, { mutationId: randomUUID(), profile: { version: 1, totalXp: 100 }, bestScore: 100, checkpoint });
  const body = saveBody(1, { profile: { version: 1, totalXp: 100 }, highestClearedStage: 2, checkpoint, run: { id: randomUUID(), stage: 1, score: 100, kills: 1, status: 'active' } });
  await store.save(user.user.id, body);
  await store.save(user.user.id, { ...body, mutationId: randomUUID(), expectedRevision: 2, checkpoint: { ...checkpoint, phase: 'stage', stage: 2 }, run: { ...body.run, stage: 2 } });
  assert.equal((await store.getAccount(user.user.id)).checkpoint.stage, 2);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM stage_records WHERE user_id=$1', [user.user.id])).rows[0].count, 0);
});

test('a fresh run may clear stage one again after an earlier upgrade checkpoint', { skip }, async () => {
  const { account: user } = await account();
  const checkpoint = { ...seedCheckpoint(), phase: 'upgrade', score: 100, kills: 1 };
  await store.importSave(user.user.id, { mutationId: randomUUID(), profile: { version: 1, totalXp: 100 }, bestScore: 100, checkpoint });
  await store.save(user.user.id, saveBody(1, { profile: { version: 1, totalXp: 110 }, highestClearedStage: 1, checkpoint, stageResults: [{ stage: 1, score: 100, kills: 1 }] }));
  assert.equal((await pool.query('SELECT clear_count FROM stage_records WHERE user_id=$1 AND stage=1', [user.user.id])).rows[0].clear_count, 1);
});

test('inventory grants are transactionally deduplicated and reject conflicting delivery', { skip }, async () => {
  const { account: user } = await account();
  const grant = { userId: user.user.id, item: 'bomb', quantity: 2, source: 'purchase', sourceId: randomUUID() };
  const results = await Promise.all([store.grantInventory(grant), store.grantInventory(grant)]);
  assert.equal(results.filter(result => result.duplicate).length, 1);
  assert.equal((await store.getAccount(user.user.id)).inventory.bomb, 2);
  await assert.rejects(store.grantInventory({ ...grant, quantity: 3 }), error => error.code === 'GRANT_REUSED');
});

test('concurrent inventory deductions never overspend or change save revision', { skip }, async () => {
  const { account: user } = await account();
  await store.grantInventory({ userId: user.user.id, item: 'bomb', quantity: 2, source: 'operator', sourceId: randomUUID() });
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => store.consume(user.user.id, { mutationId: randomUUID(), item: 'bomb' })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 2);
  assert.ok(results.filter(result => result.status === 'rejected').every(result => result.reason.code === 'INSUFFICIENT_INVENTORY'));
  const saved = await store.getAccount(user.user.id);
  assert.deepEqual(saved.inventory, { bomb: 0, support: 0 });
  assert.equal(saved.revision, 0);
  const ledger = (await pool.query('SELECT sum(delta)::int AS balance FROM inventory_ledger WHERE user_id=$1 AND item=\'bomb\'', [user.user.id])).rows[0];
  assert.equal(ledger.balance, 0);
});

test('inventory retry consumes exactly once and mutation reuse is explicit', { skip }, async () => {
  const { account: user } = await account();
  await store.grantInventory({ userId: user.user.id, item: 'support', quantity: 1, source: 'advertisement', sourceId: randomUUID() });
  const body = { mutationId: randomUUID(), item: 'support' };
  const response = await store.consume(user.user.id, body);
  assert.deepEqual(await store.consume(user.user.id, body), response);
  await assert.rejects(store.consume(user.user.id, { ...body, item: 'bomb' }), error => error.code === 'MUTATION_REUSED');
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM inventory_ledger WHERE user_id=$1 AND source='consume'", [user.user.id])).rows[0].count, 1);
});

test('protected HTTP account reads never accept another user identity', { skip }, async () => {
  const first = await account();
  const second = await account();
  await store.importSave(second.account.user.id, { mutationId: randomUUID(), profile: { version: 1, totalXp: 200 }, bestScore: 300, checkpoint: null });
  const response = await app.inject({ method: 'GET', url: '/v1/me?userId=' + second.account.user.id, headers: { authorization: 'Bearer ' + first.token } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().user.id, first.account.user.id);
  assert.equal(response.json().profile.totalXp, 0);
  const forged = await app.inject({ method: 'POST', url: '/v1/me/import', headers: { authorization: 'Bearer ' + first.token }, payload: { mutationId: randomUUID(), userId: second.account.user.id, profile: { version: 1, totalXp: 200 }, bestScore: 0, checkpoint: null } });
  assert.equal(forged.statusCode, 400);
});
