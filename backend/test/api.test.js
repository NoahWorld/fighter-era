import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/app.js';
import { createWechatClient } from '../src/wechat.js';
import { ApiError } from '../src/errors.js';

const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://test:test@localhost/fighter_era_test', WECHAT_APP_ID: 'wxbc890abdf12df15b' });
const stubStore = {
  health: async () => {},
  authenticate: async () => { throw new ApiError(401, 'UNAUTHORIZED', 'Login required'); },
  getAccount: async () => { throw new Error('Unexpected getAccount'); }
};

test('configuration fails clearly without database or malformed environment values', () => {
  assert.throws(() => loadConfig({}), /DATABASE_URL is required/);
  assert.throws(() => loadConfig({ DATABASE_URL: 'secret-password-value' }), error => !error.message.includes('secret-password-value') && /valid PostgreSQL URL/.test(error.message));
  assert.throws(() => loadConfig({ DATABASE_URL: config.databaseUrl, PORT: '4317garbage' }), /PORT/);
  assert.throws(() => loadConfig({ DATABASE_URL: config.databaseUrl, WECHAT_APP_SECRET: 'value' }), /WECHAT_APP_ID/);
});

test('readiness truthfully distinguishes healthy database from pending WeChat configuration', async () => {
  const app = await buildApp({ config, store: stubStore, logger: false });
  try {
    assert.deepEqual((await app.inject('/health/live')).json(), { status: 'alive' });
    const ready = await app.inject('/health/ready');
    assert.equal(ready.statusCode, 200);
    assert.deepEqual(ready.json(), { status: 'ready', database: 'ready', wechat: 'pending_configuration', payment: 'not_enabled', advertising: 'not_enabled' });
    const login = await app.inject({ method: 'POST', url: '/v1/auth/wechat', payload: { code: 'code' } });
    assert.equal(login.statusCode, 503);
    assert.equal(login.json().error.code, 'WECHAT_NOT_CONFIGURED');
    assert.equal(typeof login.json().requestId, 'string');
  } finally { await app.close(); }
});

test('unavailable database returns a visible readiness failure', async () => {
  const app = await buildApp({ config, store: { ...stubStore, health: async () => { throw new Error('Connection refused'); } }, logger: false });
  try {
    const response = await app.inject('/health/ready');
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().database, 'unavailable');
  } finally { await app.close(); }
});

test('HTTP schemas reject extra properties, coercion and client identity claims', async () => {
  const app = await buildApp({ config, store: stubStore, logger: false });
  try {
    for (const payload of [{ code: 42 }, { code: 'code', openid: 'forged' }, { code: '' }]) {
      const response = await app.inject({ method: 'POST', url: '/v1/auth/wechat', payload });
      assert.equal(response.statusCode, 400);
      assert.equal(response.json().error.code, 'INVALID_REQUEST');
    }
    const unauthorized = await app.inject('/v1/me');
    assert.equal(unauthorized.statusCode, 401);
    const grant = await app.inject({ method: 'POST', url: '/v1/inventory/grant', payload: { item: 'bomb', quantity: 100 } });
    assert.equal(grant.statusCode, 404);
    const devLogin = await app.inject({ method: 'POST', url: '/v1/auth/dev', payload: {} });
    assert.equal(devLogin.statusCode, 404);
  } finally { await app.close(); }
});

test('login exchanges only official code credentials and never forwards session_key', async () => {
  const configured = { ...config, appSecret: 'private-secret' };
  let called;
  const client = createWechatClient(configured, async (url, options) => {
    called = { url, options };
    return { ok: true, json: async () => ({ openid: 'real-wechat-openid', session_key: 'private-session-key' }) };
  });
  assert.deepEqual(await client.exchangeCode('temporary-code'), { openid: 'real-wechat-openid' });
  assert.equal(called.url.origin, 'https://api.weixin.qq.com');
  assert.equal(called.url.pathname, '/sns/jscode2session');
  assert.equal(called.url.searchParams.get('grant_type'), 'authorization_code');
  assert.equal(called.url.searchParams.get('appid'), configured.appId);
  assert.equal(called.url.searchParams.get('secret'), configured.appSecret);
  assert.equal(called.options.redirect, 'error');
  assert.ok(called.options.signal instanceof AbortSignal);
});

test('WeChat upstream failures retain useful codes without leaking credential-bearing errors', async () => {
  const configured = { ...config, appSecret: 'private-secret' };
  const network = createWechatClient(configured, async () => { throw new Error('https://upstream/?secret=private-secret&code=sensitive-code'); });
  await assert.rejects(network.exchangeCode('code'), error => error.code === 'WECHAT_UNAVAILABLE' && !error.message.includes('private-secret') && error.details.upstreamFailure === 'network');
  const rejected = createWechatClient(configured, async () => ({ ok: true, json: async () => ({ errcode: 40163, errmsg: 'code used' }) }));
  await assert.rejects(rejected.exchangeCode('code'), error => error.statusCode === 401 && error.details.upstreamCode === 40163);
  const malformed = createWechatClient(configured, async () => ({ ok: true, json: async () => ({ openid: 'id' }) }));
  await assert.rejects(malformed.exchangeCode('code'), error => error.code === 'WECHAT_INVALID_RESPONSE');
});

test('login rate limit produces explicit error and retry header', async () => {
  const app = await buildApp({ config, store: stubStore, logger: false });
  try {
    let response;
    for (let index = 0; index < 21; index++) response = await app.inject({ method: 'POST', url: '/v1/auth/wechat', payload: { code: 'code' } });
    assert.equal(response.statusCode, 429);
    assert.equal(response.json().error.code, 'RATE_LIMITED');
    assert.ok(response.headers['retry-after']);
  } finally { await app.close(); }
});
