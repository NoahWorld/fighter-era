const object = (properties, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required });
const int = (maximum, minimum = 0) => ({ type: 'integer', minimum, maximum });
export const uuid = { type: 'string', format: 'uuid' };
export const profile = object({ version: { const: 2 }, totalXp: int(100000000) });
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
      // Version 2 predates selectable weapons. Only the exact legacy player
      // shape may omit weapon; the shared engine validator explicitly maps it
      // to gun rather than accepting malformed or unknown weapon values.
      player: object({ hp: int(10000, 1), maxHp: int(10000, 1), weaponLevel: int(3, 1), weapon: { enum: ['gun', 'laser', 'homing', 'explosive'] } }, ['hp', 'maxHp', 'weaponLevel']),
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
