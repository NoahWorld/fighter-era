const object = (properties, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required });
const int = (maximum, minimum = 0) => ({ type: 'integer', minimum, maximum });
export const uuid = { type: 'string', format: 'uuid' };
export const profile = object({ version: { const: 2 }, totalXp: int(100000000) });
const weaponNames = ['gun', 'laser', 'homing', 'explosive'];
const playerStats = { hp: int(10000, 1), maxHp: int(10000, 1), weaponLevel: int(3, 1) };
// Accept only the two exact legacy player shapes or a complete stacked loadout.
// The active weapon must be owned; normalization belongs to the shared engine
// validator so HTTP validation never mutates a request's idempotency identity.
const checkpointPlayer = { oneOf: [
  object(playerStats),
  object({ ...playerStats, weapon: { enum: weaponNames } }),
  ...weaponNames.map(weapon => object({
    ...playerStats,
    weapon: { const: weapon },
    weapons: object(Object.fromEntries(weaponNames.map(kind => [kind, int(5, kind === 'gun' || kind === weapon ? 1 : 0)])))
  }))
] };
export const checkpoint = {
  anyOf: [
    { type: 'null' },
    object({
      version: { const: 2 },
      phase: { enum: ['stage', 'upgrade'] },
      stage: int(99),
      seed: int(4294967295),
      randomState: int(4294967295),
      entityId: int(1000000000),
      totalTime: { type: 'number', minimum: 0, maximum: 1000000000 },
      score: int(1000000000),
      kills: int(1000000),
      runStartXp: { const: 0 },
      totalXp: int(100000000),
      player: checkpointPlayer,
      fireInterval: { type: 'number', minimum: 0.07, maximum: 0.16 },
      damageBonus: { type: 'number', minimum: 0, maximum: 40 },
      freeCharges: object({ bomb: int(1), support: int(1) })
    })
  ]
};
export const loginBody = object({ code: { type: 'string', minLength: 1, maxLength: 256 } });
export const run = object({ id: uuid, stage: int(99), score: int(1000000000), kills: int(1000000), status: { enum: ['active', 'defeated', 'victory'] } });
export const saveBody = object({
  mutationId: uuid,
  expectedRevision: int(2147483646),
  profile,
  bestScore: int(1000000000),
  highestClearedStage: int(100),
  checkpoint,
  run,
  stageResults: { type: 'array', maxItems: 100, items: object({ stage: int(100, 1), score: int(1000000000), kills: int(1000000) }) }
});
export const importBody = object({ mutationId: uuid, profile, bestScore: int(1000000000), checkpoint });
export const consumeBody = object({ mutationId: uuid, item: { enum: ['bomb', 'support'] } });
