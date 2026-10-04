import test from 'node:test';
import assert from 'node:assert/strict';
import { nextRunFreeCharges } from '../src/run-charges.js';

const run = (bomb, support) => ({ free_bomb_charges: bomb, free_support_charges: support });
const checkpoint = (bomb, support) => ({ freeCharges: { bomb, support } });
const rejectsRefill = (previous, requested, saved = null, stage = 0) => assert.throws(
  () => nextRunFreeCharges(previous, requested, saved, stage),
  error => error.code === 'FREE_CHARGES_RESTORED' && error.statusCode === 400
);

test('same run charges can decrease independently but never refill at any stage', () => {
  assert.deepEqual(nextRunFreeCharges(run(1, 1), checkpoint(0, 1), null, 0), { bomb: 0, support: 1 });
  assert.deepEqual(nextRunFreeCharges(run(0, 1), checkpoint(0, 0), null, 73), { bomb: 0, support: 0 });
  rejectsRefill(run(0, 1), checkpoint(1, 1), null, 1);
  rejectsRefill(run(1, 0), checkpoint(1, 1), null, 99);
});

test('an old living run keeps its own consumed charges after another run becomes current', () => {
  const currentFreshRun = checkpoint(1, 1);
  rejectsRefill(run(0, 0), checkpoint(1, 0), currentFreshRun, 0);
  rejectsRefill(run(0, 0), checkpoint(0, 1), currentFreshRun, 7);
  assert.deepEqual(nextRunFreeCharges(run(0, 0), checkpoint(0, 0), currentFreshRun, 7), { bomb: 0, support: 0 });
});

test('later-stage continuation inherits the living boundary while genuine first-stage runs start full', () => {
  const saved = checkpoint(0, 1);
  rejectsRefill(null, checkpoint(1, 1), saved, 1);
  assert.deepEqual(nextRunFreeCharges(null, checkpoint(0, 1), saved, 99), { bomb: 0, support: 1 });
  assert.deepEqual(nextRunFreeCharges(null, checkpoint(1, 1), saved, 0), { bomb: 1, support: 1 });
  assert.deepEqual(nextRunFreeCharges(null, checkpoint(1, 1), null, 0), { bomb: 1, support: 1 });
});

test('historical migration baseline is accepted once and then the persisted remainder is binding', () => {
  const historical = run(1, 1);
  const firstRemainder = nextRunFreeCharges(historical, checkpoint(0, 1), null, 20);
  assert.deepEqual(firstRemainder, { bomb: 0, support: 1 });
  rejectsRefill(run(firstRemainder.bomb, firstRemainder.support), checkpoint(1, 1), null, 21);
});

test('terminal saves retain consumed-charge evidence and returned values are independent copies', () => {
  assert.deepEqual(nextRunFreeCharges(run(0, 1), null, checkpoint(1, 1), 0), { bomb: 0, support: 1 });
  const value = checkpoint(0, 1);
  const result = nextRunFreeCharges(run(1, 1), value, null, 0);
  result.support = 0;
  assert.deepEqual(value.freeCharges, { bomb: 0, support: 1 });
});

test('missing or corrupt persisted counts fail visibly instead of resetting charges', () => {
  for (const value of [undefined, null, -1, 2, '0', NaN]) {
    assert.throws(() => nextRunFreeCharges(run(value, 1), checkpoint(0, 1), null, 0), /Invalid persisted free charge for bomb; apply migration 003/);
  }
});
