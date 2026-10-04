import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const { validateCheckpoint } = createRequire(import.meta.url)('../../src/engine.js');

const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://test:test@localhost/fighter_era_test' });
const checkpoint = () => ({ version: 2, totalXp: 0, phase: 'stage', stage: 0, seed: 123, randomState: 123, entityId: 0, totalTime: 0, score: 0, kills: 0, runStartXp: 0, player: { hp: 5, maxHp: 5, weaponLevel: 1 }, fireInterval: 0.16, damageBonus: 0, freeCharges: { bomb: 1, support: 1 } });
const importBody = saved => ({ mutationId: randomUUID(), profile: { version: 2, totalXp: 0 }, bestScore: 0, checkpoint: saved });
const saveBody = saved => ({ ...importBody(saved), expectedRevision: 0, highestClearedStage: 0, run: { id: randomUUID(), stage: 0, score: 0, kills: 0, status: 'active' }, stageResults: [] });
const weapons = () => ({ gun: 1, laser: 1, homing: 1, explosive: 1 });
const stackedPlayer = () => ({ ...checkpoint().player, weapon: 'explosive', weapons: weapons() });

async function contractApp() {
  const calls = [];
  const write = async (_userId, body) => {
    calls.push(body);
    return { account: { revision: 1 }, mutationId: body.mutationId };
  };
  return { calls, app: await buildApp({ config, logger: false, store: { authenticate: async () => 'authenticated-user', save: write, importSave: write } }) };
}
const headers = { authorization: 'Bearer test-token' };

test('save and import HTTP contracts accept exact legacy v2 shapes and all four stacked weapon types', async () => {
  const { app, calls } = await contractApp();
  try {
    const validPlayers = [checkpoint().player,
      ...['gun', 'laser', 'homing', 'explosive'].map(weapon => ({ ...checkpoint().player, weapon })),
      ...['gun', 'laser', 'homing', 'explosive'].map(weapon => ({ ...stackedPlayer(), weapon })),
      { ...stackedPlayer(), weapon: 'gun', weapons: { gun: 1, laser: 0, homing: 0, explosive: 0 } },
      { ...stackedPlayer(), weaponLevel: 3, weapons: { gun: 5, laser: 5, homing: 5, explosive: 5 } }
    ];
    for (const player of validPlayers) {
      const saved = { ...checkpoint(), player };
      for (const [method, url, body] of [['PUT', '/v1/me/save', saveBody(saved)], ['POST', '/v1/me/import', importBody(saved)]]) {
        const response = await app.inject({ method, url, headers, payload: body });
        assert.equal(response.statusCode, 200, JSON.stringify(player) + ': ' + response.body);
        assert.deepEqual(calls.at(-1).checkpoint, saved);
      }
    }
    assert.equal(calls.length, validPlayers.length * 2);
  } finally { await app.close(); }
});

test('stacked weapon schema rejects incomplete, unknown, invalid and unowned loadouts before persistence', async () => {
  const { app, calls } = await contractApp();
  try {
    const invalidChanges = [
      { weapon: 'nuclear' }, { weapon: null }, { weapon: 2 },
      { weapon: 'laser', ammo: 999 }, { weaponLevel: 4 }, { hp: '5' },
      { weaponLevel: 0 }, { weapon: 'gun', verifiedAdvertisement: true },
      { weapons: null }, { weapons: [] }, { weapons: 'all' },
      { weapons: { gun: 1, laser: 1, homing: 1 } },
      { weapons: { ...weapons(), nuclear: 1 } },
      { weapons: { ...weapons(), gun: 0 } },
      { weapons: { ...weapons(), laser: -1 } },
      { weapons: { ...weapons(), laser: 1.5 } },
      { weapons: { ...weapons(), homing: '1' } },
      { weapons: { ...weapons(), explosive: 6 } },
      { weapons: { ...weapons(), laser: NaN } },
      { weapons: { ...weapons(), homing: Infinity } },
      { weapon: 'laser', weapons: { ...weapons(), laser: 0 } },
      { weapon: 'homing', weapons: { ...weapons(), homing: 0 } },
      { weapon: 'explosive', weapons: { ...weapons(), explosive: 0 } }
    ];
    const invalidPlayers = invalidChanges.map(change => ({ ...stackedPlayer(), ...change }));
    const noActiveWeapon = stackedPlayer(); delete noActiveWeapon.weapon;
    const noWeaponLevel = stackedPlayer(); delete noWeaponLevel.weaponLevel;
    const noHp = stackedPlayer(); delete noHp.hp;
    invalidPlayers.push(noActiveWeapon, noWeaponLevel, noHp,
      { ...checkpoint().player, weapon: 'nuclear' },
      { ...checkpoint().player, ammo: 999 },
      { ...checkpoint().player, weapon: 'gun', ammo: 999 },
      [], null);
    for (const player of invalidPlayers) {
      const saved = { ...checkpoint(), player };
      for (const [method, url, body] of [['PUT', '/v1/me/save', saveBody(saved)], ['POST', '/v1/me/import', importBody(saved)]]) {
        const response = await app.inject({ method, url, headers, payload: body });
        assert.equal(response.statusCode, 400, JSON.stringify(player));
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

test('shared persistence validator normalizes exact legacy shapes without changing request identity or aliasing weapons', () => {
  for (const weapon of [undefined, 'gun', 'laser', 'homing', 'explosive']) {
    const saved = checkpoint();
    if (weapon !== undefined) saved.player.weapon = weapon;
    const before = structuredClone(saved);
    const normalized = validateCheckpoint(saved);
    const expectedWeapons = { gun: 1, laser: 0, homing: 0, explosive: 0 };
    if (weapon !== undefined) expectedWeapons[weapon] = 1;
    assert.deepEqual(normalized.player, { ...checkpoint().player, weapon: weapon || 'gun', weapons: expectedWeapons });
    assert.deepEqual(saved, before, 'legacy normalization must not mutate the hashed request');
    assert.notEqual(normalized.player, saved.player);
  }
  const saved = { ...checkpoint(), player: stackedPlayer() };
  const before = structuredClone(saved);
  const normalized = validateCheckpoint(saved);
  assert.deepEqual(normalized, before);
  assert.notEqual(normalized.player.weapons, saved.player.weapons);
  saved.player.weapons.laser = 5;
  assert.equal(normalized.player.weapons.laser, 1, 'caller mutation cannot alter normalized persistence data');
  for (const invalid of [NaN, Infinity, -1, 0.5, 6]) {
    assert.throws(() => validateCheckpoint({ ...checkpoint(), player: { ...stackedPlayer(), weapons: { ...weapons(), laser: invalid } } }));
  }
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
