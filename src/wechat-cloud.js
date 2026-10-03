'use strict';
const { CloudSave } = require('./cloud-save.js');
const config = require('./cloud-config.js');
const META_KEY = 'fighter-era.cloud-context';
function uuid() {
  // These IDs deduplicate requests; they are never authentication credentials.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, letter => {
    const n = Math.floor(Math.random() * 16);
    return (letter === 'x' ? n : (n & 3) | 8).toString(16);
  });
}
class WechatCloud {
  constructor(wxApi, onStatus) {
    this.wx = wxApi;
    this.configured = Boolean(config.apiBase);
    this.onStatus = onStatus;
    this.game = null;
    this.client = null;
    this.account = null;
    this.context = null;
    this.dirty = false;
    this.clock = 0;
    this.working = false;
    this.usingInventory = false;
    this.running = false;
    this.status = { state: 'pending-config', message: '云存档待配置 · 当前仅本机保存', retry: 0 };
    this.publish(this.status);
  }
  publish(status) { this.status = status; this.onStatus(status); }
  async prepare(local) {
    if (!config.apiBase) return null;
    if (!/^https:\/\/[^/?#]+(?:\/[^?#]*)?$/.test(config.apiBase)) throw new Error('云存档地址必须是已配置的 HTTPS 域名。');
    const storedValue = this.wx.getStorageSync(META_KEY);
    const stored = storedValue === '' ? null : storedValue;
    if (stored !== null && (!stored || stored.version !== 1 || typeof stored.userId !== 'string' || !stored.userId || typeof stored.runId !== 'string' || !stored.runId || !Array.isArray(stored.stageResults) || !Number.isInteger(stored.highestClearedStage) || stored.highestClearedStage < 0 || stored.highestClearedStage > 100)) {
      throw new Error('云存档上下文损坏，原记录保留，请检查本地存储。');
    }
    this.client = new CloudSave({
      uuid,
      storage: { get: key => { const value = this.wx.getStorageSync(key); return value === '' ? null : value; }, set: (key, value) => this.wx.setStorageSync(key, value) },
      onStatus: status => this.publish(status),
      transport: request => new Promise((resolve, reject) => {
        this.wx.request({ url: config.apiBase.replace(/\/$/, '') + request.path, method: request.method,
          data: request.body, timeout: 12000,
          header: { 'Content-Type': 'application/json', ...(request.token ? { Authorization: 'Bearer ' + request.token } : {}) },
          success: result => {
            if (!result || !Number.isInteger(result.statusCode)) { reject(new Error('服务器返回无效响应状态。')); return; }
            if (result.statusCode < 200 || result.statusCode >= 300) {
              const detail = result.data && result.data.error;
              const error = new Error(detail && detail.message ? detail.message : `云请求失败：HTTP ${result.statusCode}`);
              error.status = result.statusCode; error.statusCode = result.statusCode; error.code = detail && detail.code;
              error.body = result.data; error.details = result.data; reject(error);
            } else resolve(result.data);
          },
          fail: detail => { const error = new Error('网络请求失败：' + detail.errMsg); error.code = 'NETWORK_ERROR'; reject(error); }
        });
      })
    });
    // Only an unbound local save can migrate. A cloud mirror may be partially
    // written after an interrupted startup, so an existing identity must never
    // qualify for another local import, even when the same player logs in.
    const canImportLocal = stored === null && this.client.getStoredAccountId() === null;
    const code = await new Promise((resolve, reject) => this.wx.login({ timeout: 12000,
      success: result => result.code ? resolve(result.code) : reject(new Error('微信登录未返回 code。')),
      fail: result => reject(new Error('微信登录失败：' + result.errMsg))
    }));
    await this.client.login(code);
    await this.client.flush();
    let account = this.client.getAccount();
    if (canImportLocal && account.migrationAllowed && (local.profile.totalXp > 0 || local.bestScore > 0 || local.checkpoint)) {
      account = await this.client.importLocal(local);
    }
    this.context = stored && stored.userId === account.user.id && account.checkpoint ? stored : {
      version: 1, userId: account.user.id, runId: uuid(), highestClearedStage: account.highestClearedStage, stageResults: []
    };
    this.context.highestClearedStage = Math.max(this.context.highestClearedStage, account.highestClearedStage);
    // Bind the local mirror before the entry point writes the server's save.
    // A failed write aborts startup instead of leaving an unowned cloud mirror.
    this.persistContext();
    this.account = account;
    return account;
  }
  bind(game) {
    this.game = game;
    if (this.account) game.setInventory(this.account.inventory);
    if (this.client && this.client.getPendingConsumption()) {
      this.publish({ state: 'error', message: '存在未确认的道具使用记录，请保留存档并联系处理', retry: 0 });
    }
  }
  beginRun(continuing) {
    if (!this.account) return;
    if (this.running) this.flushOnHide();
    // A continuation replays a stage boundary, so it is a new attempt too.
    // The previous attempt's terminal record must remain immutable.
    this.context.runId = uuid(); this.context.stageResults = [];
    this.context.status = 'active'; this.running = true;
    this.persistContext();
  }
  endRun() { this.flushOnHide(); this.running = false; this.dirty = false; }
  persistContext() { this.wx.setStorageSync(META_KEY, this.context); }
  snapshot() {
    const game = this.game;
    return { profile: game.getProfile(), bestScore: game.bestScore,
      highestClearedStage: this.context.highestClearedStage, checkpoint: game.getCheckpoint(),
      run: { id: this.context.runId, stage: game.stage, score: game.score, kills: game.kills,
        status: this.context.status },
      stageResults: this.context.stageResults.slice() };
  }
  event(name, payload) {
    if (!this.account || !this.game || !this.running) return;
    if (name === 'boss' && payload.phase === 'defeated') {
      const stage = payload.stage + 1;
      this.context.highestClearedStage = Math.max(this.context.highestClearedStage, stage);
      if (!this.context.stageResults.some(result => result.stage === stage)) this.context.stageResults.push({ stage, score: this.game.score, kills: this.game.kills });
      this.persistContext();
    }
    if (['progression', 'checkpoint', 'gameover', 'victory'].includes(name)) this.dirty = true;
    if (name === 'gameover' || name === 'victory') {
      this.context.status = name === 'victory' ? 'victory' : 'defeated';
      this.persistContext();
      // Persist synchronously: a player may start the next run before a
      // deferred network task executes, and that must not replace results.
      this.client.enqueue(this.snapshot()); this.dirty = false; this.running = false;
    } else if (name === 'checkpoint' || name === 'progression') {
      // The process can stop while a previous request is in flight. Store
      // every boundary now, before the asynchronous sender becomes available.
      this.client.enqueue(this.snapshot()); this.dirty = false;
    }
    if (['checkpoint', 'gameover', 'victory'].includes(name)) this.flushSoon();
  }
  tick(dt) { this.clock += dt; if (this.clock >= 10) { this.clock = 0; this.flushSoon(); } }
  flushSoon() {
    if (!this.account || !this.game || this.working) return;
    this.working = true;
    // Defers until all synchronous engine events at a boundary have settled.
    Promise.resolve().then(async () => {
      if (this.dirty && this.running) { this.client.enqueue(this.snapshot()); this.dirty = false; }
      await this.client.flush();
    }).catch(error => {
      console.error('[Fighter Era / cloud-sync]', { code: error.code, message: error.message, stage: this.game.stage });
      if (!['error', 'conflict'].includes(this.status.state)) this.publish({ state: 'error', message: '云同步失败：' + error.message, retry: this.status.retry || 1 });
    }).finally(() => { this.working = false; });
  }
  flushOnHide() {
    if (!this.account || !this.game) return;
    // Persist before starting asynchronous work; WeChat may stop it on hide.
    if (this.running) { this.client.enqueue(this.snapshot()); this.dirty = false; }
    this.flushSoon();
  }
  async useInventory(item) {
    if (!this.account || !this.game || this.game.state !== 'playing' || this.working) return false;
    if (this.client.getPendingConsumption()) {
      this.publish({ state: 'error', message: '上次道具使用仍待确认，不能重复使用', retry: this.status.retry || 1 });
      return false;
    }
    const game = this.game;
    if (item === 'support' && game.supportTime > 0 || item === 'bomb' && game.bombTime > 0) return false;
    this.working = true;
    this.usingInventory = true;
    game.pause();
    try {
      const receipt = await this.client.consume(item);
      if (game.state !== 'paused' || game.pausedFrom !== 'playing') throw new Error('道具已扣除，但游戏状态发生变化，使用记录已保留。');
      game.setInventory({ ...receipt.inventory, [item]: receipt.inventory[item] + 1 });
      game.resume();
      const applied = item === 'bomb' ? game.useBomb('inventory') : game.callSupport('inventory');
      if (!applied) throw new Error('服务器已扣除道具，但战斗未能使用，使用记录已保留。');
      game.setInventory(receipt.inventory);
      this.client.acknowledgeConsumption(receipt.mutationId);
      return true;
    } catch (error) {
      console.error('[Fighter Era / inventory]', { item, code: error.code, message: error.message });
      this.publish({ state: 'error', message: '道具使用待确认：' + error.message, retry: this.status.retry || 1 });
      return false;
    } finally { this.working = false; this.usingInventory = false; }
  }
}
module.exports = { WechatCloud };
