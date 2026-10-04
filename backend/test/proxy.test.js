import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/app.js';

const environment = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test:test@localhost/fighter_era_test',
  WECHAT_APP_ID: 'wxbc890abdf12df15b'
};
const gateway = '172.31.247.2';
const client = '198.51.100.20';
const store = { health: async () => {} };
const login = (remoteAddress, forwardedFor) => ({
  method: 'POST', url: '/v1/auth/wechat', remoteAddress,
  headers: { 'x-forwarded-for': forwardedFor }, payload: { code: 'code' }
});

test('proxy configuration defaults to direct mode and rejects invalid trust settings', () => {
  assert.equal(loadConfig(environment).trustProxyHops, 0);
  assert.equal(loadConfig({ ...environment, TRUST_PROXY_HOPS: '0' }).trustProxyHops, 0);
  const configured = loadConfig({ ...environment, TRUST_PROXY_HOPS: '1', TRUST_PROXY_ADDRESS: gateway });
  assert.equal(configured.trustProxyHops, 1);
  assert.equal(configured.trustProxyAddress, gateway);
  for (const value of ['', '2', '-1', '1.5', 'true', '1garbage', ' 1']) {
    assert.throws(() => loadConfig({ ...environment, TRUST_PROXY_HOPS: value, TRUST_PROXY_ADDRESS: gateway }), /TRUST_PROXY_HOPS/);
  }
  for (const value of [undefined, '', ' ', 'gateway', '172.31.247.0/29', '999.1.2.3', 'fe80::1%eth0']) {
    assert.throws(() => loadConfig({ ...environment, TRUST_PROXY_HOPS: '1', TRUST_PROXY_ADDRESS: value }), /TRUST_PROXY_ADDRESS/);
  }
  assert.throws(() => loadConfig({ ...environment, TRUST_PROXY_HOPS: '0', TRUST_PROXY_ADDRESS: 'invalid' }), /TRUST_PROXY_ADDRESS/);
});

test('direct mode ignores spoofed forwarded identities for client IP and login rate limiting', async t => {
  const app = await buildApp({ config: loadConfig(environment), store, logger: false });
  t.after(() => app.close());
  const seen = [];
  app.addHook('onRequest', async request => { seen.push(request.ip); });
  for (let index = 0; index < 21; index++) {
    const response = await app.inject(login(client, `203.0.113.${index + 1}`));
    assert.equal(response.statusCode, index < 20 ? 503 : 429);
  }
  assert.ok(seen.length > 0);
  assert.ok(seen.every(address => address === client));
});

test('a single verified gateway uses the last forwarded client and cannot rotate a forged prefix to bypass limits', async t => {
  const config = loadConfig({ ...environment, TRUST_PROXY_HOPS: '1', TRUST_PROXY_ADDRESS: gateway });
  const app = await buildApp({ config, store, logger: false });
  t.after(() => app.close());
  const seen = [];
  app.addHook('onRequest', async request => { seen.push(request.ip); });
  for (let index = 0; index < 21; index++) {
    const response = await app.inject(login(gateway, `203.0.113.${index + 1}, ${client}`));
    assert.equal(response.statusCode, index < 20 ? 503 : 429);
  }
  assert.ok(seen.length > 0);
  assert.ok(seen.every(address => address === client));
  const separateClient = await app.inject(login(gateway, '203.0.113.99, 198.51.100.21'));
  assert.equal(separateClient.statusCode, 503);
  assert.equal(separateClient.json().error.code, 'WECHAT_NOT_CONFIGURED');
  assert.equal(seen.at(-1), '198.51.100.21');
});

test('untrusted peers cannot use forwarded identities even when gateway trust is enabled', async t => {
  const config = loadConfig({ ...environment, TRUST_PROXY_HOPS: '1', TRUST_PROXY_ADDRESS: gateway });
  const app = await buildApp({ config, store, logger: false });
  t.after(() => app.close());
  const seen = [];
  app.addHook('onRequest', async request => { seen.push(request.ip); });
  const peer = '172.31.247.3';
  for (let index = 0; index < 21; index++) {
    const response = await app.inject(login(peer, `203.0.113.${index + 1}, ${client}`));
    assert.equal(response.statusCode, index < 20 ? 503 : 429);
  }
  assert.ok(seen.length > 0);
  assert.ok(seen.every(address => address === peer));
});

test('a forwarded gateway address does not extend trust beyond the immediate peer', async t => {
  const config = loadConfig({ ...environment, TRUST_PROXY_HOPS: '1', TRUST_PROXY_ADDRESS: gateway });
  const app = await buildApp({ config, store, logger: false });
  t.after(() => app.close());
  let seen;
  app.addHook('onRequest', async request => { seen = request.ip; });
  const response = await app.inject({
    url: '/health/live', remoteAddress: gateway,
    headers: { 'x-forwarded-for': `203.0.113.9, ${gateway}` }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(seen, gateway);
});

test('exact IPv6 and mapped IPv4 gateway peers are normalized while no-header health checks remain valid', async t => {
  const cases = [
    { trusted: gateway, peer: `::ffff:${gateway}` },
    { trusted: '::ffff:ac1f:f702', peer: gateway },
    { trusted: '2001:db8:0:0::2', peer: '2001:db8::2' }
  ];
  for (const { trusted, peer } of cases) {
    const config = loadConfig({ ...environment, TRUST_PROXY_HOPS: '1', TRUST_PROXY_ADDRESS: trusted });
    const app = await buildApp({ config, store, logger: false });
    t.after(() => app.close());
    const seen = [];
    app.addHook('onRequest', async request => { seen.push(request.ip); });
    const forwarded = await app.inject({ url: '/health/live', remoteAddress: peer, headers: { 'x-forwarded-for': `203.0.113.9, ${client}` } });
    assert.equal(forwarded.statusCode, 200);
    assert.equal(seen.at(-1), client);
    const direct = await app.inject({ url: '/health/live', remoteAddress: peer });
    assert.equal(direct.statusCode, 200);
    assert.equal(seen.at(-1), peer);
  }
});
