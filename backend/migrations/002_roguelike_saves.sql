-- Version 1 checkpoints allowed continuation after defeat and carried permanent XP.
-- They cannot establish a living version 2 run. Preserve identities, inventory,
-- completed-run history, best scores and highest stages while resetting strength.
UPDATE player_saves
SET total_xp = 0, checkpoint = NULL, revision = revision + 1, updated_at = now()
WHERE total_xp <> 0 OR checkpoint IS NOT NULL;

-- Retire old active run IDs as well: a fabricated version 2 checkpoint must not
-- let an earlier process revive a pre-migration attempt.
UPDATE game_runs SET status = 'defeated', updated_at = now() WHERE status = 'active';
