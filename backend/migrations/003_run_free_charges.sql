-- Free abilities now belong to a whole roguelike run, not an individual stage.
-- Older rows have no recorded remaining count. Their explicit compatibility
-- baseline is one; the first new save persists its remaining count and every
-- later mutation for that run ID may only keep or reduce it.
ALTER TABLE game_runs
  ADD COLUMN free_bomb_charges smallint NOT NULL DEFAULT 1 CHECK (free_bomb_charges BETWEEN 0 AND 1),
  ADD COLUMN free_support_charges smallint NOT NULL DEFAULT 1 CHECK (free_support_charges BETWEEN 0 AND 1);
