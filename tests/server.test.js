'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');

async function availablePort() {
  const reservation = net.createServer();
  await new Promise((resolve, reject) => {
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', resolve);
  });
  const port = reservation.address().port;
  await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  return port;
}

function request(port, resource, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: resource, method }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('public site serves the tool homepage and game routes without exposing private files or traversal', { timeout: 10000 }, async t => {
  const port = await availablePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root, env: { ...process.env, HOST: '0.0.0.0', PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe']
  });
  let diagnostic = '';
  child.stderr.on('data', chunk => { diagnostic += chunk.toString(); });
  t.after(async () => {
    if (child.exitCode === null) {
      const stopped = new Promise(resolve => child.once('exit', resolve));
      child.kill();
      await stopped;
    }
  });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => reject(new Error(`Static server exited before ready (${code}): ${diagnostic}`)));
    child.stdout.on('data', chunk => { if (chunk.toString().includes('Fighter Era ready:')) resolve(); });
  });
  const page = await request(port, '/');
  assert.equal(page.status, 200);
  assert.match(page.body.toString(), /字数统计/);
  assert.doesNotMatch(page.body.toString(), /game-canvas|src\/browser\.js/);
  assert.equal(page.headers['x-content-type-options'], 'nosniff');
  for (const route of ['/game', '/game/', '/game?source=playtest']) {
    const game = await request(port, route);
    assert.equal(game.status, 200, route);
    assert.match(game.body.toString(), /战机时代/);
    assert.match(game.body.toString(), /<base href="\/">/);
    assert.match(game.body.toString(), /src="\/src\/browser\.js"/);
    assert.match(game.body.toString(), /href="\/style\.css"/);
  }
  assert.equal((await request(port, '/game', 'HEAD')).body.length, 0);
  assert.equal((await request(port, '/game', 'POST')).status, 405);
  assert.equal((await request(port, '/game/unknown')).status, 404);
  for (const resource of ['/src/aircraft.js', '/src/engine.js', '/src/browser.js', '/assets/player.png', '/assets/expansion/fleet.png']) {
    const result = await request(port, resource);
    assert.equal(result.status, 200, resource);
    assert.ok(result.body.length > 0, resource);
  }
  for (const resource of ['/backend/.env', '/deploy/.env', '/backend/src/store.js', '/.git/config', '/SOURCE_COMMIT', '/backups/example.dump']) {
    assert.equal((await request(port, resource)).status, 404, resource);
  }
  for (const resource of ['/../backend/.env', '/%2e%2e/backend/.env', '/%00', '/src%5cengine.js']) {
    assert.equal((await request(port, resource)).status, 403, resource);
  }
  assert.equal((await request(port, '/%zz')).status, 400);
  assert.equal((await request(port, '/', 'POST')).status, 405);
  assert.equal((await request(port, '/', 'HEAD')).body.length, 0);
});

test('static server rejects an invalid bind address instead of silently changing it', () => {
  const child = spawnSync(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, HOST: 'unexpected-host' }, encoding: 'utf8' });
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /Invalid HOST/);
});
