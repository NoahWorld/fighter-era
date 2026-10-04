import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://test:test@localhost/fighter_era_test' });
const checkpoint = () => ({ version: 2, totalXp: 0, phase: 'stage', stage: 0, seed: 123, randomState: 123, entityId: 0, totalTime: 0, score: 0, kills: 0, runStartXp: 0, player: { hp: 5, maxHp: 5, weaponLevel: 1 }, fireInterval: 0.16, damageBonus: 0, freeCharges: { bomb: 1, support: 1 } });
const importBody = saved => ({ mutationId: randomUUID(), profile: { version: 2, totalXp: 0 }, bestScore: 0, checkpoint: saved });
const saveBody = saved => ({ ...importBody(saved), expectedRevision: 0, highestClearedStage: 0, run: { id: randomUUID(), stage: 0, score: 0, kills: 0, status: 'active' }, stageResults: [] });

async function contractApp() {
  const calls = [];
  const write = async (_userId, body) => {
    calls.push(body);
    return { account: { revision: 1 }, mutationId: body.mutationId };
  };
  return { calls, app: await buildApp({ config, logger: false, store: { authenticate: async () => 'authenticated-user', save: write, importSave: write } }) };
}
const headers = { authorization: 'Bearer test-token' };

test('save and import HTTP contracts accept all selectable weapons and the exact legacy v2 player shape', async () => {
  const { app, calls } = await contractApp();
  try {
    for (const weapon of [undefined, 'gun', 'laser', 'homing', 'explosive']) {
      const saved = checkpoint();
      if (weapon !== undefined) saved.player.weapon = weapon;
      for (const [method, url, body] of [['PUT', '/v1/me/save', saveBody(saved)], ['POST', '/v1/me/import', importBody(saved)]]) {
        const response = await app.inject({ method, url, headers, payload: body });
        assert.equal(response.statusCode, 200, weapon + ': ' + response.body);
        assert.deepEqual(calls.at(-1).checkpoint, saved);
      }
    }
    assert.equal(calls.length, 10);
  } finally { await app.close(); }
});

test('weapon schema rejects malformed legacy shapes, unknown weapons and untrusted reward or inventory claims before persistence', async () => {
  const { app, calls } = await contractApp();
  try {
    const invalidPlayers = [
      { weapon: 'nuclear' }, { weapon: null }, { weapon: 2 },
      { weapon: 'laser', ammo: 999 }, { weaponLevel: 4 }, { hp: '5' },
      { weapon: 'gun', verifiedAdvertisement: true }
    ];
    for (const change of invalidPlayers) {
      const saved = checkpoint();
      Object.assign(saved.player, change);
      for (const [method, url, body] of [['PUT', '/v1/me/save', saveBody(saved)], ['POST', '/v1/me/import', importBody(saved)]]) {
        const response = await app.inject({ method, url, headers, payload: body });
        assert.equal(response.statusCode, 400, JSON.stringify(change));
        assert.equal(response.json().error.code, 'INVALID_REQUEST');
      }
    }
    for (const forged of [{ inventory: { bomb: 100 } }, { advertisementCompleted: true }, { paid: true }, { revivalAuthorized: true }]) {
      const response = await app.inject({ method: 'PUT', url: '/v1/me/save', headers, payload: { ...saveBody(checkpoint()), ...forged } });
      assert.equal(response.statusCode, 400);
      assert.equal(response.json().error.code, 'INVALID_REQUEST');
    }
    const incomplete = checkpoint();
    delete incomplete.player.weaponLevel;
    assert.equal((await app.inject({ method: 'PUT', url: '/v1/me/save', headers, payload: saveBody(incomplete) })).statusCode, 400);
    assert.equal(calls.length, 0);
  } finally { await app.close(); }
});

test('unconfigured advertising, payment and revival have no public reward route', async () => {
  const { app, calls } = await contractApp();
  try {
    for (const url of ['/v1/revive', '/v1/advertising/reward', '/v1/payments/reward', '/v1/inventory/grant']) {
      const response = await app.inject({ method: 'POST', url, headers, payload: { completed: true, checkpoint: checkpoint() } });
      assert.equal(response.statusCode, 404);
      assert.equal(response.json().error.code, 'NOT_FOUND');
    }
    assert.equal(calls.length, 0);
  } finally { await app.close(); }
});
