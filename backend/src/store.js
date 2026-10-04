import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { ApiError } from './errors.js';
import { nextRunFreeCharges } from './run-charges.js';
const { validateCheckpoint } = createRequire(import.meta.url)('../../src/engine.js');

const tokenHash = token => createHash('sha256').update(token).digest('hex');
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
const requestHash = body => createHash('sha256').update(canonical(body)).digest('hex');

async function transaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); }
    catch (rollbackError) { throw new AggregateError([error, rollbackError], 'Transaction failed and rollback failed'); }
    throw error;
  } finally {
    client.release();
  }
}

async function readAccount(client, userId, save) {
  const record = save || (await client.query('SELECT * FROM player_saves WHERE user_id=$1', [userId])).rows[0];
  if (!record) throw new ApiError(404, 'ACCOUNT_NOT_FOUND', '用户存档不存在');
  const rows = (await client.query('SELECT item,balance FROM inventories WHERE user_id=$1 ORDER BY item', [userId])).rows;
  if (rows.length !== 2) throw new Error('Account inventory initialization is incomplete');
  const inventory = Object.fromEntries(rows.map(row => [row.item, row.balance]));
  return {
    user: { id: userId },
    revision: record.revision,
    profile: { version: 2, totalXp: Number(record.total_xp) },
    bestScore: Number(record.best_score),
    highestClearedStage: record.highest_cleared_stage,
    checkpoint: validateCheckpoint(record.checkpoint),
    inventory,
    migrationAllowed: record.revision === 0 && record.imported_at === null
  };
}

async function previousMutation(client, table, userId, body) {
  const previous = (await client.query(`SELECT request_hash,response FROM ${table} WHERE user_id=$1 AND mutation_id=$2`, [userId, body.mutationId])).rows[0];
  if (!previous) return null;
  if (previous.request_hash !== requestHash(body)) throw new ApiError(409, 'MUTATION_REUSED', '相同请求编号不能用于不同内容');
  return previous.response;
}

function validateCheckpointRelations(value, totalXp) {
  if (value === null) return null;
  let checkpoint;
  try { checkpoint = validateCheckpoint(value); }
  catch (error) { throw new ApiError(400, 'INVALID_CHECKPOINT', error.message); }
  if (checkpoint.player.hp > checkpoint.player.maxHp) throw new ApiError(400, 'INVALID_CHECKPOINT', '续关生命值超过上限');
  if (checkpoint.runStartXp !== 0 || checkpoint.totalXp > totalXp) throw new ApiError(400, 'INVALID_CHECKPOINT', '肉鸽续关必须从零经验开局，边界经验不能超过当前经验');
  if (checkpoint.phase === 'upgrade' && checkpoint.stage === 99) throw new ApiError(400, 'INVALID_CHECKPOINT', '最后一关不能等待关卡升级');
  return checkpoint;
}

export function createStore(pool, config) {
  return {
    async health() {
      const result = await pool.query("SELECT version FROM schema_migrations WHERE version IN ('001_initial.sql','002_roguelike_saves.sql','003_run_free_charges.sql')");
      if (result.rowCount !== 3) throw new Error('Required database migrations 001_initial.sql, 002_roguelike_saves.sql and 003_run_free_charges.sql are missing');
    },
    async createSession(openid) {
      return transaction(pool, async client => {
        const user = (await client.query(`INSERT INTO users(id,wechat_app_id,wechat_openid) VALUES($1,$2,$3)
          ON CONFLICT(wechat_app_id,wechat_openid) DO UPDATE SET last_login_at=now() RETURNING id`, [randomUUID(), config.appId, openid])).rows[0];
        await client.query('INSERT INTO player_saves(user_id) VALUES($1) ON CONFLICT DO NOTHING', [user.id]);
        await client.query("INSERT INTO inventories(user_id,item) VALUES($1,'bomb'),($1,'support') ON CONFLICT DO NOTHING", [user.id]);
        const token = randomBytes(32).toString('base64url');
        await client.query('DELETE FROM sessions WHERE expires_at < now()');
        await client.query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+($3 * interval \'1 second\'))', [tokenHash(token), user.id, config.sessionTtlSeconds]);
        return { token, account: await readAccount(client, user.id) };
      });
    },
    async authenticate(token) {
      if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new ApiError(401, 'UNAUTHORIZED', '登录状态无效，请重新登录');
      const session = (await pool.query('SELECT user_id FROM sessions WHERE token_hash=$1 AND expires_at>now()', [tokenHash(token)])).rows[0];
      if (!session) throw new ApiError(401, 'UNAUTHORIZED', '登录状态已过期，请重新登录');
      return session.user_id;
    },
    async getAccount(userId) {
      return readAccount(pool, userId);
    },
    async importSave(userId, body) {
      return transaction(pool, async client => {
        const save = (await client.query('SELECT * FROM player_saves WHERE user_id=$1 FOR UPDATE', [userId])).rows[0];
        const duplicate = await previousMutation(client, 'save_mutations', userId, body);
        if (duplicate) return duplicate;
        if (save.revision !== 0 || save.imported_at !== null) throw new ApiError(409, 'IMPORT_NOT_ALLOWED', '已有云端存档，不能覆盖导入', { currentRevision: save.revision });
        if (body.profile.version !== 2) throw new ApiError(400, 'LEGACY_SAVE_REJECTED', '旧版永久经验存档不能导入肉鸽模式');
        if (body.checkpoint === null && body.profile.totalXp !== 0) throw new ApiError(400, 'INVALID_RUN_XP', '没有存活对局时经验必须为零');
        const checkpoint = validateCheckpointRelations(body.checkpoint, body.profile.totalXp);
        const highest = checkpoint ? checkpoint.stage + (checkpoint.phase === 'upgrade' ? 1 : 0) : 0;
        await client.query('UPDATE player_saves SET total_xp=$2,best_score=$3,checkpoint=$4,highest_cleared_stage=$5,revision=1,imported_at=now(),updated_at=now() WHERE user_id=$1', [userId, body.profile.totalXp, body.bestScore, checkpoint, highest]);
        const response = { account: await readAccount(client, userId), mutationId: body.mutationId };
        await client.query('INSERT INTO save_mutations(user_id,mutation_id,request_hash,response) VALUES($1,$2,$3,$4)', [userId, body.mutationId, requestHash(body), response]);
        return response;
      });
    },
    async save(userId, body) {
      return transaction(pool, async client => {
        const save = (await client.query('SELECT * FROM player_saves WHERE user_id=$1 FOR UPDATE', [userId])).rows[0];
        const duplicate = await previousMutation(client, 'save_mutations', userId, body);
        if (duplicate) return duplicate;
        if (save.revision !== body.expectedRevision) throw new ApiError(409, 'SAVE_CONFLICT', '其他设备已更新存档，请重新加载', { currentRevision: save.revision });
        if (body.profile.version !== 2) throw new ApiError(400, 'LEGACY_SAVE_REJECTED', '旧版永久经验存档不能写入肉鸽模式');
        const terminal = body.run.status !== 'active';
        if (terminal && (body.checkpoint !== null || body.profile.totalXp !== 0)) throw new ApiError(400, 'TERMINAL_SAVE_NOT_RESET', '对局结束后必须清空经验和续关记录');
        if (!terminal && body.checkpoint === null && body.profile.totalXp !== 0) throw new ApiError(400, 'INVALID_RUN_XP', '没有存活续关记录时经验必须为零');
        const checkpoint = validateCheckpointRelations(body.checkpoint, body.profile.totalXp);
        const savedCheckpoint = validateCheckpoint(save.checkpoint);
        const previousRun = (await client.query('SELECT * FROM game_runs WHERE user_id=$1 AND id=$2', [userId, body.run.id])).rows[0];
        if (previousRun && (previousRun.status !== 'active' || body.run.stage < previousRun.stage || body.run.score < Number(previousRun.score) || body.run.kills < previousRun.kills)) {
          throw new ApiError(409, 'INVALID_RUN_TRANSITION', '对局状态、分数和击杀数不能回退或重复结算');
        }
        if (previousRun && !terminal && body.profile.totalXp < Number(save.total_xp)) {
          const restoredBoundary = checkpoint && savedCheckpoint && canonical(checkpoint) === canonical(savedCheckpoint) && body.profile.totalXp === checkpoint.totalXp;
          if (!restoredBoundary) throw new ApiError(400, 'PROGRESSION_DECREASE', '同一存活对局经验减少只能恢复已保存的关卡边界');
        }
        const stages = body.stageResults.map(item => item.stage);
        if (new Set(stages).size !== stages.length) throw new ApiError(400, 'INVALID_STAGE_RESULTS', '单次提交不能重复关卡结算');
        for (const result of body.stageResults) {
          if (result.stage > body.run.stage + 1 || result.score > body.run.score || result.kills > body.run.kills) throw new ApiError(400, 'INVALID_STAGE_RESULTS', '关卡结算超过对局进度');
        }
        const knownStages = (await client.query('SELECT stage FROM run_stage_clears WHERE user_id=$1 AND run_id=$2 ORDER BY stage', [userId, body.run.id])).rows.map(item => item.stage);
        const initialStage = previousRun ? previousRun.stage : (stages.length ? Math.min(...stages) - 1 : body.run.stage);
        if (!previousRun && initialStage !== 0) {
          const resumeStage = savedCheckpoint && savedCheckpoint.stage;
          const afterUpgrade = savedCheckpoint && savedCheckpoint.phase === 'upgrade' && initialStage === resumeStage + 1;
          if (initialStage !== resumeStage && !afterUpgrade) throw new ApiError(400, 'INVALID_RUN_START', '新对局只能从第1关或已保存的续关位置开始');
        }
        const freeCharges = nextRunFreeCharges(previousRun, checkpoint, savedCheckpoint, initialStage);
        const newStages = stages.filter(stage => !knownStages.includes(stage)).sort((a, b) => a - b);
        // A restored upgrade panel already represents a defeated boss from the previous attempt.
        // It permits choosing the next stage without recording that boss as another clear.
        const clearedBaseline = savedCheckpoint && savedCheckpoint.phase === 'upgrade' && savedCheckpoint.stage === initialStage && !newStages.includes(initialStage + 1) ? initialStage + 1 : initialStage;
        let expectedClear = Math.max(clearedBaseline, ...knownStages) + 1;
        for (const stage of newStages) {
          if (stage !== expectedClear++) throw new ApiError(400, 'INVALID_STAGE_PROGRESS', '通关记录必须按对局关卡顺序提交');
        }
        if (body.run.stage > Math.max(clearedBaseline, ...knownStages, ...stages)) throw new ApiError(400, 'INVALID_STAGE_PROGRESS', '对局关卡前进缺少通关记录');
        const provenHighest = Math.max(save.highest_cleared_stage, ...stages);
        if (body.highestClearedStage > provenHighest) throw new ApiError(400, 'INVALID_STAGE_PROGRESS', '最高通关关卡缺少结算记录');
        if (body.run.stage > provenHighest) throw new ApiError(400, 'INVALID_STAGE_PROGRESS', '对局不能跳过尚未通关的关卡');
        if (checkpoint && (body.run.status === 'victory' || checkpoint.stage !== body.run.stage || checkpoint.score > body.run.score || checkpoint.kills > body.run.kills)) throw new ApiError(400, 'INVALID_CHECKPOINT', '续关记录与对局不一致');
        if (checkpoint && checkpoint.phase === 'upgrade' && !knownStages.includes(checkpoint.stage + 1) && !stages.includes(checkpoint.stage + 1)) {
          const restoredUpgrade = savedCheckpoint && savedCheckpoint.phase === 'upgrade' && canonical(checkpoint) === canonical(savedCheckpoint);
          if (!restoredUpgrade) throw new ApiError(400, 'INVALID_STAGE_PROGRESS', '升级续关点缺少该关通关记录或当前存活升级边界');
        }
        if (body.run.status === 'victory' && (body.run.stage !== 99 || !stages.includes(100))) throw new ApiError(400, 'INVALID_VICTORY', '最终胜利必须结算第100关');
        await client.query(`INSERT INTO game_runs(user_id,id,stage,score,kills,status,free_bomb_charges,free_support_charges) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
          ON CONFLICT(user_id,id) DO UPDATE SET stage=EXCLUDED.stage,score=EXCLUDED.score,kills=EXCLUDED.kills,status=EXCLUDED.status,free_bomb_charges=EXCLUDED.free_bomb_charges,free_support_charges=EXCLUDED.free_support_charges,updated_at=now()`, [userId, body.run.id, body.run.stage, body.run.score, body.run.kills, body.run.status, freeCharges.bomb, freeCharges.support]);
        for (const result of body.stageResults) {
          const clear = await client.query('INSERT INTO run_stage_clears(user_id,run_id,stage,score,kills) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING stage', [userId, body.run.id, result.stage, result.score, result.kills]);
          if (clear.rowCount) await client.query(`INSERT INTO stage_records(user_id,stage,clear_count,best_score) VALUES($1,$2,1,$3)
            ON CONFLICT(user_id,stage) DO UPDATE SET clear_count=stage_records.clear_count+1,best_score=GREATEST(stage_records.best_score,EXCLUDED.best_score),last_cleared_at=now()`, [userId, result.stage, result.score]);
        }
        await client.query('UPDATE player_saves SET total_xp=$2,best_score=GREATEST(best_score,$3),highest_cleared_stage=$4,checkpoint=$5,revision=revision+1,updated_at=now() WHERE user_id=$1', [userId, body.profile.totalXp, body.bestScore, provenHighest, checkpoint]);
        const response = { account: await readAccount(client, userId), mutationId: body.mutationId };
        await client.query('INSERT INTO save_mutations(user_id,mutation_id,request_hash,response) VALUES($1,$2,$3,$4)', [userId, body.mutationId, requestHash(body), response]);
        return response;
      });
    },
    async consume(userId, body) {
      return transaction(pool, async client => {
        // Always lock both rows in the same order, serializing duplicate requests across items as well.
        const rows = (await client.query('SELECT item,balance FROM inventories WHERE user_id=$1 ORDER BY item FOR UPDATE', [userId])).rows;
        if (rows.length !== 2) throw new Error('Account inventory initialization is incomplete');
        const duplicate = await previousMutation(client, 'inventory_mutations', userId, body);
        if (duplicate) return duplicate;
        const target = rows.find(row => row.item === body.item);
        if (!target || target.balance < 1) throw new ApiError(409, 'INSUFFICIENT_INVENTORY', '额外道具数量不足');
        const balance = target.balance - 1;
        await client.query('UPDATE inventories SET balance=$3,revision=revision+1,updated_at=now() WHERE user_id=$1 AND item=$2', [userId, body.item, balance]);
        await client.query('INSERT INTO inventory_ledger(id,user_id,item,delta,balance_after,source,source_id) VALUES($1,$2,$3,-1,$4,\'consume\',$5)', [randomUUID(), userId, body.item, balance, body.mutationId]);
        const inventory = Object.fromEntries(rows.map(row => [row.item, row.item === body.item ? balance : row.balance]));
        const response = { inventory, mutationId: body.mutationId };
        await client.query('INSERT INTO inventory_mutations(user_id,mutation_id,request_hash,response) VALUES($1,$2,$3,$4)', [userId, body.mutationId, requestHash(body), response]);
        return response;
      });
    },
    // Called only by future verified payment/ad delivery handlers or authorized maintenance code.
    // There is intentionally no HTTP grant route.
    async grantInventory({ userId, item, quantity, source, sourceId }) {
      if (!['bomb', 'support'].includes(item) || !Number.isInteger(quantity) || quantity < 1 || quantity > 10000 || !['purchase', 'advertisement', 'refund', 'operator'].includes(source) || typeof sourceId !== 'string' || sourceId.length < 1 || sourceId.length > 256) throw new TypeError('Invalid inventory grant');
      return transaction(pool, async client => {
        const row = (await client.query('SELECT balance FROM inventories WHERE user_id=$1 AND item=$2 FOR UPDATE', [userId, item])).rows[0];
        if (!row) throw new ApiError(404, 'ACCOUNT_NOT_FOUND', '道具账户不存在');
        const duplicate = (await client.query('SELECT delta,balance_after FROM inventory_ledger WHERE user_id=$1 AND item=$2 AND source=$3 AND source_id=$4', [userId, item, source, sourceId])).rows[0];
        if (duplicate) {
          if (duplicate.delta !== quantity) throw new ApiError(409, 'GRANT_REUSED', '奖励编号已用于不同数量');
          return { balanceAfter: duplicate.balance_after, duplicate: true };
        }
        if (row.balance + quantity > 1000000) throw new ApiError(409, 'INVENTORY_LIMIT', '道具数量达到上限');
        const balance = row.balance + quantity;
        await client.query('UPDATE inventories SET balance=$3,revision=revision+1,updated_at=now() WHERE user_id=$1 AND item=$2', [userId, item, balance]);
        await client.query('INSERT INTO inventory_ledger(id,user_id,item,delta,balance_after,source,source_id) VALUES($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), userId, item, quantity, balance, source, sourceId]);
        return { balanceAfter: balance, duplicate: false };
      });
    }
  };
}
