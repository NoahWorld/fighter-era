CREATE TABLE users (
  id uuid PRIMARY KEY,
  wechat_app_id text NOT NULL,
  wechat_openid text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (wechat_app_id, wechat_openid)
);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE player_saves (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  total_xp bigint NOT NULL DEFAULT 0 CHECK (total_xp BETWEEN 0 AND 100000000),
  best_score bigint NOT NULL DEFAULT 0 CHECK (best_score BETWEEN 0 AND 1000000000),
  highest_cleared_stage integer NOT NULL DEFAULT 0 CHECK (highest_cleared_stage BETWEEN 0 AND 100),
  checkpoint jsonb,
  imported_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE save_mutations (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mutation_id uuid NOT NULL,
  request_hash text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, mutation_id)
);

CREATE TABLE game_runs (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  stage integer NOT NULL CHECK (stage BETWEEN 0 AND 99),
  score bigint NOT NULL CHECK (score BETWEEN 0 AND 1000000000),
  kills integer NOT NULL CHECK (kills BETWEEN 0 AND 1000000),
  status text NOT NULL CHECK (status IN ('active', 'defeated', 'victory')),
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);

CREATE TABLE stage_records (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stage integer NOT NULL CHECK (stage BETWEEN 1 AND 100),
  clear_count integer NOT NULL DEFAULT 0 CHECK (clear_count >= 0),
  best_score bigint NOT NULL DEFAULT 0 CHECK (best_score BETWEEN 0 AND 1000000000),
  first_cleared_at timestamptz NOT NULL DEFAULT now(),
  last_cleared_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, stage)
);

CREATE TABLE run_stage_clears (
  user_id uuid NOT NULL,
  run_id uuid NOT NULL,
  stage integer NOT NULL CHECK (stage BETWEEN 1 AND 100),
  score bigint NOT NULL,
  kills integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, run_id, stage),
  FOREIGN KEY (user_id, run_id) REFERENCES game_runs(user_id, id) ON DELETE CASCADE
);

CREATE TABLE inventories (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item text NOT NULL CHECK (item IN ('bomb', 'support')),
  balance integer NOT NULL DEFAULT 0 CHECK (balance BETWEEN 0 AND 1000000),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item)
);

CREATE TABLE inventory_ledger (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item text NOT NULL CHECK (item IN ('bomb', 'support')),
  delta integer NOT NULL CHECK (delta <> 0),
  balance_after integer NOT NULL CHECK (balance_after >= 0),
  source text NOT NULL CHECK (source IN ('purchase', 'advertisement', 'consume', 'refund', 'operator')),
  source_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, item, source, source_id)
);

CREATE TABLE inventory_mutations (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mutation_id uuid NOT NULL,
  request_hash text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, mutation_id)
);

CREATE TABLE payment_orders (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  product_snapshot jsonb NOT NULL,
  amount_minor integer NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL DEFAULT 'CNY',
  platform_transaction_id text UNIQUE,
  payment_status text NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'verified', 'failed', 'refunded')),
  delivery_status text NOT NULL DEFAULT 'pending' CHECK (delivery_status IN ('pending', 'delivered', 'reversed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE advertisement_rewards (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  ad_unit_id text NOT NULL,
  reward_snapshot jsonb NOT NULL,
  verification_status text NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'rejected')),
  granted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
