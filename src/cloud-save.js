(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ShooterCloud = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STORAGE_KEY = 'fighter-era.cloud-outbox';
  const LEGACY_STORAGE_KEY = 'fighter-era.cloud-outbox.legacy-v1';
  const SNAPSHOT_FIELDS = ['profile', 'bestScore', 'highestClearedStage', 'checkpoint', 'run', 'stageResults'];

  class CloudSaveError extends Error {
    constructor(code, message, details = {}) {
      super(message);
      this.name = 'CloudSaveError';
      this.code = code;
      Object.assign(this, details);
    }
  }

  function jsonCopy(value, path = 'value', seen = new Set()) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new TypeError(path + ' must contain finite numbers');
      return value;
    }
    if (!value || typeof value !== 'object' || seen.has(value)) throw new TypeError(path + ' must be JSON data without cycles');
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new TypeError(path + ' must be plain JSON data');
    seen.add(value);
    const copy = Array.isArray(value) ? [] : {};
    for (const key of Object.keys(value)) copy[key] = jsonCopy(value[key], path + '.' + key, seen);
    seen.delete(value);
    return copy;
  }
  function integer(value, path) {
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(path + ' must be a non-negative safe integer');
  }
  function identifier(value, path) {
    if (typeof value !== 'string' || value.length < 1 || value.length > 160) throw new TypeError(path + ' must be a non-empty identifier');
  }
  function profile(value, version = 2) {
    if (!value || value.version !== version) throw new TypeError('Cloud profile version must be ' + version);
    integer(value.totalXp, 'profile.totalXp');
  }
  function inventory(value) {
    if (!value || typeof value !== 'object') throw new TypeError('Cloud inventory is required');
    integer(value.bomb, 'inventory.bomb');
    integer(value.support, 'inventory.support');
  }
  function snapshot(value, version = 2) {
    const copy = jsonCopy(value, 'snapshot');
    if (!copy || Array.isArray(copy)) throw new TypeError('Cloud snapshot must be an object');
    for (const key of SNAPSHOT_FIELDS) if (!Object.prototype.hasOwnProperty.call(copy, key)) throw new TypeError('Cloud snapshot is missing ' + key);
    profile(copy.profile, version);
    integer(copy.bestScore, 'bestScore');
    integer(copy.highestClearedStage, 'highestClearedStage');
    if (copy.highestClearedStage > 100) throw new RangeError('highestClearedStage exceeds the campaign length');
    if (copy.checkpoint !== null && (typeof copy.checkpoint !== 'object' || Array.isArray(copy.checkpoint))) throw new TypeError('checkpoint must be an object or null');
    if (version === 2 && copy.checkpoint !== null && (copy.checkpoint.version !== 2 || !Number.isSafeInteger(copy.checkpoint.totalXp) || copy.checkpoint.totalXp < 0 || copy.checkpoint.totalXp > copy.profile.totalXp || copy.checkpoint.runStartXp !== 0)) throw new TypeError('Roguelike checkpoint requires version 2 and valid boundary XP');
    if (version === 2 && copy.checkpoint === null && copy.profile.totalXp !== 0) throw new TypeError('Roguelike XP requires a living checkpoint');
    if (version === 2 && copy.run && ['defeated', 'victory'].includes(copy.run.status) && (copy.checkpoint !== null || copy.profile.totalXp !== 0)) throw new TypeError('Ended roguelike runs must clear XP and checkpoint');
    if (copy.run !== null && (typeof copy.run !== 'object' || Array.isArray(copy.run))) throw new TypeError('run must be an object or null');
    if (!Array.isArray(copy.stageResults) || copy.stageResults.some(result => !result || typeof result !== 'object' || Array.isArray(result))) throw new TypeError('stageResults must be an array of objects');
    const selected = {};
    for (const key of SNAPSHOT_FIELDS) selected[key] = copy[key];
    return selected;
  }
  function account(value) {
    const copy = jsonCopy(value, 'account');
    if (!copy || !copy.user) throw new TypeError('Cloud account is missing user');
    identifier(copy.user.id, 'account.user.id');
    integer(copy.revision, 'account.revision');
    profile(copy.profile);
    integer(copy.bestScore, 'account.bestScore');
    integer(copy.highestClearedStage, 'account.highestClearedStage');
    if (copy.highestClearedStage > 100) throw new RangeError('Cloud account has an invalid cleared stage');
    if (copy.checkpoint !== null && (!copy.checkpoint || typeof copy.checkpoint !== 'object' || Array.isArray(copy.checkpoint))) throw new TypeError('Cloud account checkpoint must be an object or null');
    if (copy.checkpoint !== null && (copy.checkpoint.version !== 2 || !Number.isSafeInteger(copy.checkpoint.totalXp) || copy.checkpoint.totalXp < 0 || copy.checkpoint.totalXp > copy.profile.totalXp || copy.checkpoint.runStartXp !== 0)) throw new TypeError('Cloud account contains a legacy or invalid roguelike checkpoint');
    if (copy.checkpoint === null && copy.profile.totalXp !== 0) throw new TypeError('Cloud account without a living checkpoint must have zero XP');
    inventory(copy.inventory);
    if (typeof copy.migrationAllowed !== 'boolean') throw new TypeError('Cloud account migrationAllowed must be boolean');
    return copy;
  }
  function emptyOutbox() {
    return { version: 2, accountId: null, pending: null, queue: [], consumption: null, conflict: null };
  }
  function hasWork(box) { return !!(box.pending || box.queue.length || box.consumption); }
  function readOutbox(value) {
    if (value === undefined || value === null || value === '') return emptyOutbox();
    const box = jsonCopy(typeof value === 'string' ? JSON.parse(value) : value, 'outbox');
    if (!box || ![1, 2].includes(box.version)) throw new TypeError('Cloud outbox version must be 1 or 2');
    for (const key of ['accountId', 'pending', 'queue', 'consumption', 'conflict']) if (!Object.prototype.hasOwnProperty.call(box, key)) throw new TypeError('Cloud outbox is missing ' + key);
    if (!Array.isArray(box.queue) || box.queue.length > 100) throw new TypeError('Cloud outbox queue must contain at most 100 runs');
    if (box.accountId !== null) identifier(box.accountId, 'outbox.accountId');
    if (hasWork(box) && box.accountId === null) throw new TypeError('Cloud outbox work must belong to an account');
    if (box.pending !== null) {
      if (!box.pending || !['save', 'import'].includes(box.pending.kind)) throw new TypeError('Invalid cloud pending mutation kind');
      identifier(box.pending.body.mutationId, 'outbox.pending.mutationId');
      integer(box.pending.attempts, 'outbox.pending.attempts');
      if (box.pending.kind === 'save') {
        integer(box.pending.body.expectedRevision, 'outbox.pending.expectedRevision');
        snapshot(box.pending.body, box.version);
      } else {
        profile(box.pending.body.profile, box.version);
        integer(box.pending.body.bestScore, 'outbox.pending.bestScore');
        jsonCopy(box.pending.body.checkpoint, 'outbox.pending.checkpoint');
      }
    }
    for (const queued of box.queue) snapshot(queued, box.version);
    if (box.consumption !== null) {
      if (!box.consumption || !['bomb', 'support'].includes(box.consumption.item)) throw new TypeError('Invalid pending inventory item');
      identifier(box.consumption.mutationId, 'outbox.consumption.mutationId');
      integer(box.consumption.attempts, 'outbox.consumption.attempts');
      if (!['pending', 'confirmed'].includes(box.consumption.state)) throw new TypeError('Invalid pending inventory state');
      if (box.consumption.state === 'confirmed') inventory(box.consumption.result.inventory);
    }
    if (box.conflict !== null && (!box.conflict || typeof box.conflict.message !== 'string')) throw new TypeError('Invalid cloud conflict record');
    return box;
  }

  class CloudSave {
    constructor(options) {
      if (!options || typeof options.transport !== 'function' || typeof options.uuid !== 'function') throw new TypeError('CloudSave requires transport and uuid functions');
      if (!options.storage || typeof options.storage.get !== 'function' || typeof options.storage.set !== 'function') throw new TypeError('CloudSave requires synchronous storage get/set');
      if (options.onStatus !== undefined && typeof options.onStatus !== 'function') throw new TypeError('CloudSave onStatus must be a function');
      this.transport = options.transport;
      this.storage = options.storage;
      this.uuid = options.uuid;
      this.onStatus = options.onStatus;
      this._account = null;
      this._token = null;
      this._flushPromise = null;
      this._consumePromise = null;
      this._loginPromise = null;
      this._storageError = null;
      this._loginAttempts = 0;
      this._status = { state: 'pending', message: '等待微信登录', retry: 0 };
      try { this._box = readOutbox(this.storage.get(STORAGE_KEY)); }
      catch (cause) { throw new CloudSaveError('OUTBOX_READ_FAILED', '无法读取云存档待同步记录，已停止云同步以保护原数据', { cause }); }
      if (this._box.version === 1) {
        const legacy = this._box;
        const migrated = emptyOutbox();
        migrated.accountId = legacy.accountId; migrated.consumption = legacy.consumption;
        try {
          const archive = this.storage.get(LEGACY_STORAGE_KEY);
          if (archive !== undefined && archive !== null && archive !== '' && JSON.stringify(readOutbox(archive)) !== JSON.stringify(legacy)) throw new Error('Existing legacy archive differs from the pending version 1 outbox');
          this.storage.set(LEGACY_STORAGE_KEY, legacy);
          this.storage.set(STORAGE_KEY, migrated);
        } catch (cause) { throw new CloudSaveError('OUTBOX_MIGRATION_FAILED', '无法迁移旧版待同步记录，原记录保留，已停止启动', { cause }); }
        this._box = migrated;
        this._notify('pending', '肉鸽规则已更新：旧版经验和续关已归档，道具操作保留');
      }
    }
    _notify(state, message, extra = {}) {
      this._status = Object.assign({ state, message, retry: 0 }, extra);
      if (this.onStatus) this.onStatus(Object.assign({}, this._status));
    }
    _persist(next) {
      if (this._storageError) throw this._storageError;
      const copy = jsonCopy(next, 'outbox');
      try { this.storage.set(STORAGE_KEY, copy); }
      catch (cause) {
        this._storageError = new CloudSaveError('OUTBOX_WRITE_FAILED', '无法保存待同步记录，已停止云同步；本次变更尚未确认保存到云端', { cause });
        this._notify('error', this._storageError.message, { error: this._storageError });
        throw this._storageError;
      }
      this._box = copy;
    }
    _newId() { const id = this.uuid(); identifier(id, 'mutationId'); return id; }
    _requireAccount() {
      if (this._storageError) throw this._storageError;
      if (!this._account || !this._token) throw new CloudSaveError('LOGIN_REQUIRED', '尚未完成微信登录，无法同步云存档');
      if (this._box.conflict || (hasWork(this._box) && this._box.accountId !== this._account.user.id)) throw new CloudSaveError('SYNC_CONFLICT', this._box.conflict ? this._box.conflict.message : '待同步记录属于其他微信账号，已停止同步');
    }
    getAccount() { return this._account ? jsonCopy(this._account) : null; }
    getStoredAccountId() { return this._box.accountId; }
    getStatus() { return Object.assign({}, this._status); }
    getPendingSnapshot() {
      if (!this._account || this._box.accountId !== this._account.user.id) return null;
      if (this._box.queue.length) return jsonCopy(this._box.queue[this._box.queue.length - 1]);
      return this._box.pending && this._box.pending.kind === 'save' ? snapshot(this._box.pending.body) : null;
    }
    getPendingConsumption() {
      if (!this._box.consumption) return null;
      return Object.assign({ accountId: this._box.accountId }, jsonCopy(this._box.consumption));
    }
    async _request(method, path, body, token = this._token) {
      return this.transport({ method, path, body: body === undefined ? undefined : jsonCopy(body), token });
    }
    _failed(cause, context, retry, stopOnConflict = true) {
      if (cause instanceof CloudSaveError && cause.code === 'OUTBOX_WRITE_FAILED') return cause;
      const status = Number(cause && (cause.status || cause.statusCode)) || null;
      const details = cause && (cause.details || cause.response || cause.body);
      const apiError = details && details.error;
      const code = (cause && cause.code) || (apiError && apiError.code) || (status ? 'HTTP_ERROR' : 'NETWORK_ERROR');
      const message = status === 409 ? context + '发生冲突，已停止自动同步' : status ? context + '失败（HTTP ' + status + '）：' + (cause.message || code) : cause instanceof CloudSaveError ? context + '失败：' + cause.message : '🔴 网络异常／正在重连：' + context + '，重试次数 ' + retry;
      const error = new CloudSaveError(code, message, { cause, status, retry, details });
      if (status === 409 && stopOnConflict) {
        const next = jsonCopy(this._box);
        next.conflict = { code, message, currentRevision: apiError && Number.isSafeInteger(apiError.currentRevision) ? apiError.currentRevision : null };
        this._persist(next);
        this._notify('conflict', message, { retry, error });
      } else this._notify('error', message, { retry, error });
      return error;
    }
    login(code) {
      if (this._loginPromise) return this._loginPromise;
      identifier(code, 'WeChat login code');
      this._loginPromise = this._login(code).finally(() => { this._loginPromise = null; });
      return this._loginPromise;
    }
    async _login(code) {
      if (this._storageError) throw this._storageError;
      const active = [this._flushPromise, this._consumePromise].filter(Boolean);
      if (active.length) await Promise.allSettled(active);
      this._loginAttempts++;
      this._notify('connecting', '正在连接微信云存档', { retry: this._loginAttempts - 1 });
      try {
        const result = await this._request('POST', '/v1/auth/wechat', { code }, null);
        if (!result || typeof result.token !== 'string' || !result.token) throw new CloudSaveError('INVALID_RESPONSE', 'WeChat auth response is missing token');
        const response = await this._request('GET', '/v1/me', undefined, result.token);
        let current;
        try { current = account(response); }
        catch (cause) { throw new CloudSaveError('INVALID_RESPONSE', '微信账号响应格式不正确', { cause }); }
        this._account = current;
        this._token = result.token;
        this._loginAttempts = 0;
        if (hasWork(this._box) && this._box.accountId !== current.user.id) {
          this._notify('conflict', '待同步记录属于其他微信账号，已停止同步；原记录仍保留');
        } else if (this._box.conflict) this._notify('conflict', this._box.conflict.message);
        else this._notify(hasWork(this._box) ? 'pending' : 'synced', hasWork(this._box) ? '已登录，存在待确认的云端操作' : '已连接云存档');
        return this.getAccount();
      } catch (cause) { throw this._failed(cause, '微信登录', this._loginAttempts); }
    }
    enqueue(value) {
      this._requireAccount();
      const desired = snapshot(value);
      // A new checkpoint replaces the old one, but completed-stage records are
      // retained until a server response confirms their durable acceptance.
      const next = jsonCopy(this._box);
      const last = next.queue[next.queue.length - 1];
      const sameRun = last && (last.run ? desired.run && last.run.id === desired.run.id : !desired.run);
      if (sameRun) {
        if (['defeated', 'victory'].includes(last.run && last.run.status) && JSON.stringify(last) !== JSON.stringify(desired)) throw new CloudSaveError('TERMINAL_RUN_CHANGED', '已结算的一局记录不能再次修改');
        const results = new Map();
        for (const result of last.stageResults.concat(desired.stageResults)) results.set(result.stage, result);
        desired.stageResults = Array.from(results.values());
      }
      if (this._box.pending && this._box.pending.kind === 'save' && JSON.stringify(snapshot(this._box.pending.body)) === JSON.stringify(desired)) return;
      if (sameRun && JSON.stringify(last) === JSON.stringify(desired)) return;
      if (!sameRun && next.queue.length >= 100) throw new CloudSaveError('OUTBOX_FULL', '待同步游戏记录已达到 100 局，请先恢复网络同步；新增云记录尚未入队');
      next.accountId = this._account.user.id;
      if (sameRun) next.queue[next.queue.length - 1] = desired;
      else next.queue.push(desired);
      this._persist(next);
      this._notify('pending', '本机记录已进入待同步队列');
    }
    async importLocal(value) {
      this._requireAccount();
      if (this._box.pending && this._box.pending.kind === 'import') return this.flush();
      if (this._box.pending || this._box.queue.length) throw new CloudSaveError('PENDING_SAVE', '请先确认已有的待同步记录，再导入本机档案');
      if (!this._account.migrationAllowed) throw new CloudSaveError('IMPORT_NOT_ALLOWED', '此微信账号已有云存档，不能覆盖为本机档案');
      const body = jsonCopy(value, 'localImport');
      profile(body.profile);
      if (body.checkpoint === null && body.profile.totalXp !== 0) throw new TypeError('Local import without a living checkpoint must have zero XP');
      if (body.checkpoint !== null && (!body.checkpoint || body.checkpoint.version !== 2 || !Number.isSafeInteger(body.checkpoint.totalXp) || body.checkpoint.totalXp < 0 || body.checkpoint.totalXp > body.profile.totalXp || body.checkpoint.runStartXp !== 0)) throw new TypeError('Local import requires a version 2 living checkpoint');
      integer(body.bestScore, 'localImport.bestScore');
      if (!Object.prototype.hasOwnProperty.call(body, 'checkpoint')) throw new TypeError('Local import is missing checkpoint');
      const next = jsonCopy(this._box);
      next.accountId = this._account.user.id;
      next.pending = { kind: 'import', body: { mutationId: this._newId(), profile: body.profile, bestScore: body.bestScore, checkpoint: body.checkpoint }, attempts: 0 };
      this._persist(next);
      return this.flush();
    }
    flush() {
      if (this._flushPromise) return this._flushPromise;
      try { this._requireAccount(); } catch (error) { return Promise.reject(error); }
      this._flushPromise = this._flush().finally(() => { this._flushPromise = null; });
      return this._flushPromise;
    }
    async _flush() {
      const consumption = this._consumePromise;
      if (consumption) await Promise.allSettled([consumption]);
      while (this._box.pending || this._box.queue.length) {
        this._requireAccount();
        if (!this._box.pending) {
          const next = jsonCopy(this._box);
          next.pending = { kind: 'save', body: Object.assign({ mutationId: this._newId(), expectedRevision: this._account.revision }, next.queue.shift()), attempts: 0 };
          this._persist(next);
        }
        const attempt = jsonCopy(this._box);
        attempt.pending.attempts++;
        this._persist(attempt);
        const pending = this._box.pending;
        this._notify('connecting', pending.kind === 'import' ? '正在导入本机档案' : '正在同步云存档', { retry: pending.attempts - 1 });
        try {
          const result = await this._request(pending.kind === 'import' ? 'POST' : 'PUT', pending.kind === 'import' ? '/v1/me/import' : '/v1/me/save', pending.body);
          if (!result || result.mutationId !== pending.body.mutationId) throw new CloudSaveError('INVALID_RESPONSE', 'Cloud mutation response identifier does not match request');
          let current;
          try { current = account(result.account); }
          catch (cause) { throw new CloudSaveError('INVALID_RESPONSE', '云存档响应格式不正确', { cause }); }
          if (current.user.id !== this._account.user.id) throw new CloudSaveError('INVALID_RESPONSE', 'Cloud mutation response belongs to a different account');
          if (current.revision < this._account.revision) throw new CloudSaveError('INVALID_RESPONSE', 'Cloud mutation response has an older revision than the loaded account');
          const acknowledged = jsonCopy(this._box);
          acknowledged.pending = null;
          this._persist(acknowledged);
          this._account = current;
        } catch (cause) { throw this._failed(cause, pending.kind === 'import' ? '档案导入' : '云存档同步', pending.attempts); }
      }
      this._notify(this._box.consumption ? 'pending' : 'synced', this._box.consumption ? '存档已同步，道具操作仍待确认' : '云存档已同步');
      return this.getAccount();
    }
    consume(item, options = {}) {
      try {
        this._requireAccount();
        if (!['bomb', 'support'].includes(item)) throw new TypeError('Unknown inventory item: ' + item);
        if (this._box.consumption && (this._box.consumption.item !== item || (options.mutationId && options.mutationId !== this._box.consumption.mutationId))) throw new CloudSaveError('CONSUMPTION_PENDING', '上一次道具使用尚未确认，请先处理该操作');
        if (!this._box.consumption) {
          const next = jsonCopy(this._box);
          const id = options.mutationId === undefined ? this._newId() : options.mutationId;
          identifier(id, 'consumption.mutationId');
          next.accountId = this._account.user.id;
          next.consumption = { item, mutationId: id, attempts: 0, state: 'pending', result: null };
          this._persist(next);
        }
      } catch (error) { return Promise.reject(error); }
      return this.retryConsumption();
    }
    retryConsumption() {
      if (this._consumePromise) return this._consumePromise;
      try {
        this._requireAccount();
        if (!this._box.consumption) throw new CloudSaveError('NO_PENDING_CONSUMPTION', '没有待确认的道具操作');
        if (this._box.consumption.state === 'confirmed') return Promise.resolve(jsonCopy(this._box.consumption.result));
      } catch (error) { return Promise.reject(error); }
      this._consumePromise = this._consume().finally(() => { this._consumePromise = null; });
      return this._consumePromise;
    }
    async _consume() {
      const flush = this._flushPromise;
      if (flush) await Promise.allSettled([flush]);
      this._requireAccount();
      const next = jsonCopy(this._box);
      next.consumption.attempts++;
      this._persist(next);
      const pending = this._box.consumption;
      this._notify('connecting', '正在确认道具使用', { retry: pending.attempts - 1 });
      try {
        const result = await this._request('POST', '/v1/inventory/consume', { mutationId: pending.mutationId, item: pending.item });
        if (!result || result.mutationId !== pending.mutationId) throw new CloudSaveError('INVALID_RESPONSE', 'Inventory response identifier does not match request');
        try { inventory(result.inventory); }
        catch (cause) { throw new CloudSaveError('INVALID_RESPONSE', '道具库存响应格式不正确', { cause }); }
        const acknowledged = jsonCopy(this._box);
        acknowledged.consumption.state = 'confirmed';
        acknowledged.consumption.result = jsonCopy(result);
        this._persist(acknowledged);
        this._account.inventory = jsonCopy(result.inventory);
        this._notify('pending', '道具扣除已确认，等待本次游戏操作确认');
        return jsonCopy(result);
      } catch (cause) {
        const status = Number(cause && (cause.status || cause.statusCode));
        if ([400, 403, 404, 409, 422].includes(status)) {
          // A definitive server rejection did not consume an item. Unknown
          // network outcomes retain their request ID for safe reconciliation.
          const rejected = jsonCopy(this._box);
          rejected.consumption = null;
          this._persist(rejected);
        }
        throw this._failed(cause, '道具使用', pending.attempts, false);
      }
    }
    acknowledgeConsumption(mutationId) {
      this._requireAccount();
      if (!this._box.consumption || this._box.consumption.mutationId !== mutationId || this._box.consumption.state !== 'confirmed') throw new CloudSaveError('CONSUMPTION_NOT_CONFIRMED', '只能确认已收到服务器扣除结果的对应道具操作');
      const next = jsonCopy(this._box);
      next.consumption = null;
      this._persist(next);
      this._notify(this._box.pending || this._box.queue.length ? 'pending' : 'synced', this._box.pending || this._box.queue.length ? '道具使用已确认，存档等待同步' : '道具使用与云存档已确认');
    }
  }

  return { CloudSave, CloudSaveError, STORAGE_KEY, LEGACY_STORAGE_KEY };
});
