import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { createStore } from '../src/store.js';
import { loadConfig } from '../src/config.js';
import { migrate } from '../src/migrate.js';
import { buildApp } from '../src/app.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const skip = !databaseUrl && 'TEST_DATABASE_URL is not configured; real PostgreSQL integration must run separately';
let pool, store, app;
const seedCheckpoint = () => ({ version: 2, totalXp: 0, phase: 'stage', stage: 0, seed: 123, randomState: 123, entityId: 0, totalTime: 0, score: 0, kills: 0, runStartXp: 0, player: { hp: 5, maxHp: 5, weaponLevel: 1 }, fireInterval: 0.16, damageBonus: 0, freeCharges: { bomb: 1, support: 1 } });
const saveBody = (revision, overrides = {}) => ({ mutationId: randomUUID(), expectedRevision: revision, profile: { version: 2, totalXp: 10 }, bestScore: 100, highestClearedStage: 0, checkpoint: seedCheckpoint(), run: { id: randomUUID(), stage: 0, score: 100, kills: 1, status: 'active' }, stageResults: [], ...overrides });
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
  const body = { mutationId: randomUUID(), profile: { version: 2, totalXp: 150 }, bestScore: 900, checkpoint: seedCheckpoint() };
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
  const skipped = saveBody(0, { profile: { version: 2, totalXp: 0 }, checkpoint: null, highestClearedStage: 100, run: { id: randomUUID(), stage: 99, score: 100, kills: 1, status: 'victory' }, stageResults: [{ stage: 100, score: 100, kills: 1 }] });
  await assert.rejects(store.save(user.user.id, skipped), error => error.code === 'INVALID_RUN_START');
  const body = saveBody(0);
  await store.save(user.user.id, body);
  const next = { ...body, mutationId: randomUUID(), expectedRevision: 1, checkpoint: { ...body.checkpoint, stage: 2 }, run: { ...body.run, stage: 2 }, highestClearedStage: 3, stageResults: [{ stage: 1, score: 100, kills: 1 }, { stage: 3, score: 100, kills: 1 }] };
  await assert.rejects(store.save(user.user.id, next), error => error.code === 'INVALID_STAGE_PROGRESS');
});

test('terminal run cannot return to active and defeat clears XP/checkpoint atomically', { skip }, async () => {
  const { account: user } = await account();
  const active = saveBody(0);
  await store.save(user.user.id, active);
  const ended = { ...active, mutationId: randomUUID(), expectedRevision: 1, profile: { version: 2, totalXp: 0 }, checkpoint: null, run: { ...active.run, status: 'defeated' } };
  const result = await store.save(user.user.id, ended);
  assert.equal(result.account.profile.totalXp, 0);
  assert.equal(result.account.checkpoint, null);
  assert.equal(result.account.bestScore, 100);
  await assert.rejects(store.save(user.user.id, { ...ended, mutationId: randomUUID(), expectedRevision: 2, run: { ...ended.run, status: 'active' } }), error => error.code === 'INVALID_RUN_TRANSITION');
  const fresh = saveBody(2, { profile: { version: 2, totalXp: 0 }, run: { id: randomUUID(), stage: 0, score: 0, kills: 0, status: 'active' } });
  await store.save(user.user.id, fresh);
  assert.equal((await store.getAccount(user.user.id)).profile.totalXp, 0);
});

test('defeated run cannot preserve XP or a checkpoint and cannot resume a later stage', { skip }, async () => {
  const { account: user } = await account();
  const active = saveBody(0);
  await assert.rejects(store.save(user.user.id, { ...active, run: { ...active.run, status: 'defeated' } }), error => error.code === 'TERMINAL_SAVE_NOT_RESET');
  await assert.rejects(store.save(user.user.id, { ...active, checkpoint: null, run: { ...active.run, status: 'defeated' } }), error => error.code === 'TERMINAL_SAVE_NOT_RESET');
  const ended = { ...active, profile: { version: 2, totalXp: 0 }, checkpoint: null, run: { ...active.run, status: 'defeated' } };
  await store.save(user.user.id, ended);
  await assert.rejects(store.save(user.user.id, saveBody(1, { checkpoint: { ...seedCheckpoint(), stage: 1 }, run: { id: randomUUID(), stage: 1, score: 0, kills: 0, status: 'active' } })), error => error.code === 'INVALID_RUN_START');
  assert.equal((await store.getAccount(user.user.id)).revision, 1);
});

test('fresh runs may reset living XP but same run decrease requires the unchanged boundary', { skip }, async () => {
  const { account: user } = await account(); const active = saveBody(0);
  await store.save(user.user.id, active);
  await assert.rejects(store.save(user.user.id, { ...active, mutationId: randomUUID(), expectedRevision: 1, profile: { version: 2, totalXp: 1 } }), error => error.code === 'PROGRESSION_DECREASE');
  const fresh = saveBody(1, { profile: { version: 2, totalXp: 0 }, run: { id: randomUUID(), stage: 0, score: 0, kills: 0, status: 'active' } });
  await store.save(user.user.id, fresh);
  assert.equal((await store.getAccount(user.user.id)).profile.totalXp, 0);
});

test('restored upgrade panel allows a new attempt then advances without rewarding the old boss twice', { skip }, async () => {
  const { account: user } = await account();
  const checkpoint = { ...seedCheckpoint(), phase: 'upgrade', stage: 1, score: 100, kills: 1 };
  await store.importSave(user.user.id, { mutationId: randomUUID(), profile: { version: 2, totalXp: 100 }, bestScore: 100, checkpoint });
  const body = saveBody(1, { profile: { version: 2, totalXp: 100 }, highestClearedStage: 2, checkpoint, run: { id: randomUUID(), stage: 1, score: 100, kills: 1, status: 'active' } });
  await store.save(user.user.id, body);
  await store.save(user.user.id, { ...body, mutationId: randomUUID(), expectedRevision: 2, checkpoint: { ...checkpoint, phase: 'stage', stage: 2 }, run: { ...body.run, stage: 2 } });
  assert.equal((await store.getAccount(user.user.id)).checkpoint.stage, 2);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM stage_records WHERE user_id=$1', [user.user.id])).rows[0].count, 0);
});

test('a fresh run may clear stage one again after an earlier upgrade checkpoint', { skip }, async () => {
  const { account: user } = await account();
  const checkpoint = { ...seedCheckpoint(), phase: 'upgrade', score: 100, kills: 1 };
  await store.importSave(user.user.id, { mutationId: randomUUID(), profile: { version: 2, totalXp: 100 }, bestScore: 100, checkpoint });
  await store.save(user.user.id, saveBody(1, { profile: { version: 2, totalXp: 110 }, highestClearedStage: 1, checkpoint, stageResults: [{ stage: 1, score: 100, kills: 1 }] }));
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
  await store.importSave(second.account.user.id, { mutationId: randomUUID(), profile: { version: 2, totalXp: 0 }, bestScore: 300, checkpoint: null });
  const response = await app.inject({ method: 'GET', url: '/v1/me?userId=' + second.account.user.id, headers: { authorization: 'Bearer ' + first.token } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().user.id, first.account.user.id);
  assert.equal(response.json().profile.totalXp, 0);
  const forged = await app.inject({ method: 'POST', url: '/v1/me/import', headers: { authorization: 'Bearer ' + first.token }, payload: { mutationId: randomUUID(), userId: second.account.user.id, profile: { version: 2, totalXp: 200 }, bestScore: 0, checkpoint: null } });
  assert.equal(forged.statusCode, 400);
});


test('legacy import and XP without a living checkpoint are rejected', { skip }, async () => {
  const { account: user } = await account();
  await assert.rejects(store.importSave(user.user.id, { mutationId: randomUUID(), profile: { version: 1, totalXp: 30 }, bestScore: 50, checkpoint: null }), error => error.code === 'LEGACY_SAVE_REJECTED');
  await assert.rejects(store.importSave(user.user.id, { mutationId: randomUUID(), profile: { version: 2, totalXp: 30 }, bestScore: 50, checkpoint: null }), error => error.code === 'INVALID_RUN_XP');
  const body = saveBody(0, { profile: { version: 1, totalXp: 10 } });
  const response = await app.inject({ method: 'PUT', url: '/v1/me/save', headers: { authorization: 'Bearer ' + (await store.createSession('legacy-http-' + randomUUID())).token }, payload: body });
  assert.equal(response.statusCode, 400);
});

test('weapon checkpoints use the engine contract and normalize exact legacy v2 saves', { skip }, async () => {
  for (const weapon of ['gun', 'laser', 'homing', 'explosive']) {
    const { account: user } = await account();
    const checkpoint = seedCheckpoint(); checkpoint.player.weapon = weapon;
    const body = saveBody(0, { checkpoint });
    const result = await store.save(user.user.id, body);
    assert.equal(result.account.checkpoint.player.weapon, weapon);
    assert.equal((await pool.query('SELECT checkpoint FROM player_saves WHERE user_id=$1', [user.user.id])).rows[0].checkpoint.player.weapon, weapon);
  }
  const { account: user } = await account();
  const legacy = { mutationId: randomUUID(), profile: { version: 2, totalXp: 10 }, bestScore: 100, checkpoint: seedCheckpoint() };
  const imported = await store.importSave(user.user.id, legacy);
  assert.equal(imported.account.checkpoint.player.weapon, 'gun');
  assert.equal(Object.hasOwn(legacy.checkpoint.player, 'weapon'), false, 'normalizing must not change the request used for idempotency');
  assert.deepEqual(await store.importSave(user.user.id, legacy), imported);
  await assert.rejects(store.importSave(user.user.id, { ...legacy, checkpoint: imported.account.checkpoint }), error => error.code === 'MUTATION_REUSED');
  // Direct old v2 database records are normalized on read as well, not just at HTTP input.
  await pool.query('UPDATE player_saves SET checkpoint=$2 WHERE user_id=$1', [user.user.id, seedCheckpoint()]);
  assert.equal((await store.getAccount(user.user.id)).checkpoint.player.weapon, 'gun');
  for (const player of [{ ...seedCheckpoint().player, weapon: 'unknown' }, { ...seedCheckpoint().player, weapon: 'gun', ammo: 5 }]) {
    await assert.rejects(store.save(user.user.id, saveBody(1, { checkpoint: { ...seedCheckpoint(), player } })), error => error.code === 'INVALID_CHECKPOINT');
  }
  assert.equal((await store.getAccount(user.user.id)).revision, 1);
});

test('free charges persist across stages and cannot refill by switching back to an old run ID', { skip }, async () => {
  const { account: user } = await account();
  const active = saveBody(0, { checkpoint: { ...seedCheckpoint(), freeCharges: { bomb: 0, support: 1 } } });
  await store.save(user.user.id, active);
  const nextStage = { ...active, mutationId: randomUUID(), expectedRevision: 1, highestClearedStage: 1, checkpoint: { ...active.checkpoint, stage: 1, freeCharges: { bomb: 1, support: 1 } }, run: { ...active.run, stage: 1 }, stageResults: [{ stage: 1, score: 100, kills: 1 }] };
  await assert.rejects(store.save(user.user.id, nextStage), error => error.code === 'FREE_CHARGES_RESTORED');
  assert.equal((await store.getAccount(user.user.id)).revision, 1);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM run_stage_clears WHERE user_id=$1', [user.user.id])).rows[0].count, 0);
  const consumed = { ...nextStage, mutationId: randomUUID(), checkpoint: { ...nextStage.checkpoint, freeCharges: { bomb: 0, support: 0 } } };
  await store.save(user.user.id, consumed);
  assert.deepEqual((await pool.query('SELECT free_bomb_charges,free_support_charges FROM game_runs WHERE user_id=$1 AND id=$2', [user.user.id, active.run.id])).rows[0], { free_bomb_charges: 0, free_support_charges: 0 });
  const fresh = saveBody(2, { profile: { version: 2, totalXp: 0 }, run: { id: randomUUID(), stage: 0, score: 0, kills: 0, status: 'active' } });
  assert.deepEqual((await store.save(user.user.id, fresh)).account.checkpoint.freeCharges, { bomb: 1, support: 1 });
  const switchBack = { ...consumed, mutationId: randomUUID(), expectedRevision: 3, stageResults: [], checkpoint: { ...consumed.checkpoint, freeCharges: { bomb: 1, support: 0 } } };
  await assert.rejects(store.save(user.user.id, switchBack), error => error.code === 'FREE_CHARGES_RESTORED');
  assert.equal((await store.getAccount(user.user.id)).revision, 3);
  assert.deepEqual((await store.save(user.user.id, { ...switchBack, mutationId: randomUUID(), checkpoint: consumed.checkpoint })).account.checkpoint.freeCharges, { bomb: 0, support: 0 });
  assert.deepEqual((await store.getAccount(user.user.id)).inventory, { bomb: 0, support: 0 });
});

test('a later-stage continuation keeps spent charges but a fresh first-stage run gets its own charges', { skip }, async () => {
  const { account: user } = await account();
  const checkpoint = { ...seedCheckpoint(), stage: 4, freeCharges: { bomb: 0, support: 0 }, player: { ...seedCheckpoint().player, weapon: 'laser' } };
  await store.importSave(user.user.id, { mutationId: randomUUID(), profile: { version: 2, totalXp: 40 }, bestScore: 100, checkpoint });
  const resumed = saveBody(1, { profile: { version: 2, totalXp: 0 }, highestClearedStage: 4, checkpoint: { ...checkpoint, freeCharges: { bomb: 1, support: 0 } }, run: { id: randomUUID(), stage: 4, score: 100, kills: 1, status: 'active' } });
  await assert.rejects(store.save(user.user.id, resumed), error => error.code === 'FREE_CHARGES_RESTORED');
  assert.equal((await store.getAccount(user.user.id)).revision, 1);
  const result = await store.save(user.user.id, { ...resumed, mutationId: randomUUID(), checkpoint });
  assert.deepEqual(result.account.checkpoint.freeCharges, { bomb: 0, support: 0 });
  assert.equal(result.account.checkpoint.player.weapon, 'laser');
  const fresh = saveBody(2, { profile: { version: 2, totalXp: 0 }, run: { id: randomUUID(), stage: 0, score: 0, kills: 0, status: 'active' } });
  assert.deepEqual((await store.save(user.user.id, fresh)).account.checkpoint.freeCharges, { bomb: 1, support: 1 });
});

test('migration defaults are a historical starting point and first legal save binds the remaining charges', { skip }, async () => {
  const { account: user } = await account();
  const runId = randomUUID();
  // This is how a pre-003 run looks after the forward migration adds its default columns.
  await pool.query('INSERT INTO game_runs(user_id,id,stage,score,kills,status) VALUES($1,$2,0,0,0,\'active\')', [user.user.id, runId]);
  assert.deepEqual((await pool.query('SELECT free_bomb_charges,free_support_charges FROM game_runs WHERE user_id=$1 AND id=$2', [user.user.id, runId])).rows[0], { free_bomb_charges: 1, free_support_charges: 1 });
  const body = saveBody(0, { checkpoint: { ...seedCheckpoint(), freeCharges: { bomb: 0, support: 0 } }, run: { id: runId, stage: 0, score: 100, kills: 1, status: 'active' } });
  await store.save(user.user.id, body);
  assert.deepEqual((await pool.query('SELECT free_bomb_charges,free_support_charges FROM game_runs WHERE user_id=$1 AND id=$2', [user.user.id, runId])).rows[0], { free_bomb_charges: 0, free_support_charges: 0 });
  await assert.rejects(store.save(user.user.id, { ...body, mutationId: randomUUID(), expectedRevision: 1, checkpoint: seedCheckpoint() }), error => error.code === 'FREE_CHARGES_RESTORED');
});

test('death cannot preserve a checkpoint, reopen its ID or install an unproven upgrade under a new ID', { skip }, async () => {
  const { account: user } = await account();
  const active = saveBody(0, { checkpoint: { ...seedCheckpoint(), freeCharges: { bomb: 0, support: 0 } } });
  await store.save(user.user.id, active);
  await assert.rejects(store.save(user.user.id, { ...active, mutationId: randomUUID(), expectedRevision: 1, run: { ...active.run, status: 'defeated' } }), error => error.code === 'TERMINAL_SAVE_NOT_RESET');
  const ended = { ...active, mutationId: randomUUID(), expectedRevision: 1, profile: { version: 2, totalXp: 0 }, checkpoint: null, run: { ...active.run, status: 'defeated' } };
  const result = await store.save(user.user.id, ended);
  assert.equal(result.account.checkpoint, null); assert.equal(result.account.profile.totalXp, 0);
  assert.deepEqual((await pool.query('SELECT free_bomb_charges,free_support_charges FROM game_runs WHERE user_id=$1 AND id=$2', [user.user.id, active.run.id])).rows[0], { free_bomb_charges: 0, free_support_charges: 0 });
  await assert.rejects(store.save(user.user.id, { ...active, mutationId: randomUUID(), expectedRevision: 2 }), error => error.code === 'INVALID_RUN_TRANSITION');
  const forgedUpgrade = saveBody(2, { profile: { version: 2, totalXp: 0 }, checkpoint: { ...active.checkpoint, phase: 'upgrade' } });
  await assert.rejects(store.save(user.user.id, forgedUpgrade), error => error.code === 'INVALID_STAGE_PROGRESS');
  const forgedLaterStage = { ...forgedUpgrade, mutationId: randomUUID(), checkpoint: { ...active.checkpoint, stage: 1 }, run: { ...forgedUpgrade.run, stage: 1 } };
  await assert.rejects(store.save(user.user.id, forgedLaterStage), error => error.code === 'INVALID_RUN_START');
  assert.equal((await store.getAccount(user.user.id)).revision, 2);
});


test('forward roguelike migration resets legacy growth but retains identity, inventory and records', { skip }, async () => {
  const { account: user } = await account();
  const checkpoint = { ...seedCheckpoint(), phase: 'upgrade', score: 100, kills: 1 };
  const legacyRun = saveBody(0, { checkpoint, highestClearedStage: 1, stageResults: [{ stage: 1, score: 100, kills: 1 }] });
  await store.save(user.user.id, legacyRun);
  await store.grantInventory({ userId: user.user.id, item: 'support', quantity: 2, source: 'operator', sourceId: randomUUID() });
  await pool.query('UPDATE player_saves SET total_xp=900,checkpoint=$2 WHERE user_id=$1', [user.user.id, { ...checkpoint, version: 1 }]);
  await pool.query(await readFile(new URL('../migrations/002_roguelike_saves.sql', import.meta.url), 'utf8'));
  const migrated = await store.getAccount(user.user.id);
  assert.deepEqual(migrated.profile, { version: 2, totalXp: 0 });
  assert.equal(migrated.checkpoint, null);
  assert.equal(migrated.bestScore, 100); assert.equal(migrated.highestClearedStage, 1);
  assert.equal(migrated.inventory.support, 2); assert.equal(migrated.revision, 2);
  assert.equal((await pool.query('SELECT status FROM game_runs WHERE user_id=$1 AND id=$2', [user.user.id, legacyRun.run.id])).rows[0].status, 'defeated');
  await assert.rejects(store.save(user.user.id, { ...legacyRun, mutationId: randomUUID(), expectedRevision: 2 }), error => error.code === 'INVALID_RUN_TRANSITION');
  assert.equal((await pool.query('SELECT clear_count FROM stage_records WHERE user_id=$1 AND stage=1', [user.user.id])).rows[0].clear_count, 1);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM users WHERE id=$1', [user.user.id])).rows[0].count, 1);
});
