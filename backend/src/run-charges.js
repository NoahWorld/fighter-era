import { ApiError } from './errors.js';

export function nextRunFreeCharges(previousRun, checkpoint, savedCheckpoint, initialStage) {
  // A resumed later-stage attempt has a new ID but inherits the surviving
  // boundary. A genuine new first-stage run receives its own pair of charges.
  const baseline = previousRun
    ? { bomb: previousRun.free_bomb_charges, support: previousRun.free_support_charges }
    : savedCheckpoint && initialStage > 0 ? savedCheckpoint.freeCharges : { bomb: 1, support: 1 };
  for (const item of ['bomb', 'support']) {
    if (![0, 1].includes(baseline[item])) throw new TypeError('Invalid persisted free charge for ' + item + '; apply migration 003_run_free_charges.sql');
    if (checkpoint && checkpoint.freeCharges[item] > baseline[item]) {
      throw new ApiError(400, 'FREE_CHARGES_RESTORED', '同一对局或续关不能恢复已消耗的免费道具', { item, remaining: baseline[item], requested: checkpoint.freeCharges[item] });
    }
  }
  return checkpoint ? { ...checkpoint.freeCharges } : { ...baseline };
}
