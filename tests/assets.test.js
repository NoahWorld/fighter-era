'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { manifest, frames, loadAssets } = require('../src/assets.js');

function imageHarness() {
  const pending = [];
  const createImage = () => ({
    set src(src) {
      assert.equal(typeof this.onload, 'function');
      assert.equal(typeof this.onerror, 'function');
      const descriptor = Object.values(manifest).find(item => item.src === src);
      this.width = descriptor.width;
      this.height = descriptor.height;
      pending.push({ src, image: this });
    },
  });
  return { createImage, pending };
}

test('required atlas loading waits for every decoded image and retains the image objects', async () => {
  const harness = imageHarness();
  let ready = false;
  const result = loadAssets(harness.createImage).then(value => { ready = true; return value; });
  assert.equal(harness.pending.length, 6);
  harness.pending.slice(0, 5).forEach(item => item.image.onload());
  await Promise.resolve();
  assert.equal(ready, false);
  harness.pending[5].image.onload();
  const assets = await result;
  assert.equal(assets.images.player, harness.pending[0].image);
  assert.equal(assets.frames.player.length, 10);
  assert.equal(assets.frames.enemyVariants.length, 10);
  assert.equal(assets.frames.fleet.length, 10);
  for (const item of harness.pending) assert.equal(item.image.onload, null);
});

test('a failed atlas identifies its path instead of allowing a partially loaded game', async () => {
  const harness = imageHarness();
  const result = loadAssets(harness.createImage);
  harness.pending.slice(1).forEach(item => item.image.onload());
  harness.pending[0].image.onerror({ errMsg: 'file unavailable' });
  await assert.rejects(result, /assets\/player\.png.*file unavailable/);
});

test('wrong atlas dimensions are rejected before source rectangles can render corrupt sprites', async () => {
  const harness = imageHarness();
  const result = loadAssets(harness.createImage);
  harness.pending.slice(1).forEach(item => item.image.onload());
  harness.pending[0].image.width = 1;
  harness.pending[0].image.onload();
  await assert.rejects(result, /素材尺寸不符.*player\.png/);
});

test('a stalled decoder reports a bounded timeout with the missing atlas path', async () => {
  const harness = imageHarness();
  const result = loadAssets(harness.createImage, { timeoutMs: 10 });
  harness.pending.slice(1).forEach(item => item.image.onload());
  await assert.rejects(result, /加载超时.*player\.png/);
});

test('packaged PNG dimensions and all source rectangles agree with the atlas manifest', () => {
  for (const [name, item] of Object.entries(manifest)) {
    const bytes = fs.readFileSync(path.join(__dirname, '..', item.src));
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
    assert.equal(bytes.readUInt32BE(16), item.width);
    assert.equal(bytes.readUInt32BE(20), item.height);
    assert.equal(bytes[25], 6, 'atlases must preserve RGBA transparency');
    for (const rect of Object.values(frames[name])) {
      assert.ok([rect.x, rect.y, rect.w, rect.h].every(Number.isInteger));
      assert.ok(rect.x >= 0 && rect.y >= 0 && rect.w > 0 && rect.h > 0);
      assert.ok(rect.x + rect.w <= item.width && rect.y + rect.h <= item.height);
      if (rect.regions) {
        assert.ok(Object.isFrozen(rect.regions));
        for (const region of rect.regions) {
          assert.ok(Object.isFrozen(region));
          assert.ok([region.x, region.y, region.w, region.h].every(Number.isInteger));
          assert.ok(region.x >= rect.x && region.y >= rect.y && region.w > 0 && region.h > 0);
          assert.ok(region.x + region.w <= rect.x + rect.w && region.y + region.h <= rect.y + rect.h);
        }
        rect.regions.forEach((a, i) => rect.regions.slice(i + 1).forEach(b => {
          assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, 'source regions must not duplicate pixels');
        }));
      }
    }
  }
});

// Decode the actual packaged RGBA pixels using PNG's five standard row filters.
// This keeps sprite-boundary verification independent of browser canvas stubs.
function pngAlpha(bytes) {
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  assert.equal(bytes[24], 8, 'pixel QA expects 8-bit PNG samples');
  assert.equal(bytes[25], 6, 'pixel QA expects RGBA');
  assert.equal(bytes[28], 0, 'pixel QA expects non-interlaced PNG');
  const chunks = [];
  for (let cursor = 8; cursor < bytes.length;) {
    const length = bytes.readUInt32BE(cursor);
    if (bytes.subarray(cursor + 4, cursor + 8).toString() === 'IDAT') chunks.push(bytes.subarray(cursor + 8, cursor + 8 + length));
    cursor += length + 12;
  }
  const packed = zlib.inflateSync(Buffer.concat(chunks));
  const stride = width * 4;
  const decoded = new Uint8Array(stride * height);
  const alpha = new Uint8Array(width * height);
  function paeth(left, up, diagonal) {
    const p = left + up - diagonal;
    const a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - diagonal);
    return a <= b && a <= c ? left : b <= c ? up : diagonal;
  }
  for (let y = 0; y < height; y++) {
    const type = packed[y * (stride + 1)];
    assert.ok(type >= 0 && type <= 4, 'PNG filter must be supported');
    for (let x = 0; x < stride; x++) {
      const index = y * stride + x;
      const left = x >= 4 ? decoded[index - 4] : 0;
      const up = y > 0 ? decoded[index - stride] : 0;
      const diagonal = y > 0 && x >= 4 ? decoded[index - stride - 4] : 0;
      const predict = [0, left, up, Math.floor((left + up) / 2), paeth(left, up, diagonal)][type];
      decoded[index] = (packed[y * (stride + 1) + x + 1] + predict) & 255;
      if ((x & 3) === 3) alpha[y * width + (x >> 2)] = decoded[index];
    }
  }
  return { width, height, alpha };
}

function visibleBodies({ width, height, alpha }) {
  const visited = new Uint8Array(alpha.length);
  const queue = new Int32Array(alpha.length);
  const bodies = [];
  for (let origin = 0; origin < alpha.length; origin++) {
    if (visited[origin] || alpha[origin] <= 32) continue;
    let head = 0, tail = 1;
    queue[0] = origin;
    visited[origin] = 1;
    let left = width, top = height, right = -1, bottom = -1;
    while (head < tail) {
      const index = queue[head++], x = index % width, y = Math.floor(index / width);
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
      for (const neighbor of [x > 0 ? index - 1 : -1, x + 1 < width ? index + 1 : -1, y > 0 ? index - width : -1, y + 1 < height ? index + width : -1]) {
        if (neighbor >= 0 && !visited[neighbor] && alpha[neighbor] > 32) { visited[neighbor] = 1; queue[tail++] = neighbor; }
      }
    }
    if (tail > 500) bodies.push({ x: left, y: top, w: right - left + 1, h: bottom - top + 1, pixels: queue.slice(0, tail) });
  }
  return bodies;
}

test('new sprite regions retain each visible body and exclude neighboring atlas sprites', () => {
  for (const name of ['enemyVariants', 'fleet']) {
    const atlas = pngAlpha(fs.readFileSync(path.join(__dirname, '..', manifest[name].src)));
    const bodies = visibleBodies(atlas);
    assert.equal(bodies.length, 10, name + ' must contain ten distinct visible bodies');
    for (const frame of frames[name]) {
      const ownBody = bodies.find(body => body.x === frame.x + 2 && body.y === frame.y + 2 && body.w === frame.w - 4 && body.h === frame.h - 4);
      assert.ok(ownBody, name + ' frame must match its complete body bounds');
      const regions = frame.regions || [frame];
      assert.ok(regions.length <= 11, 'fixed source regions must retain a bounded draw count');
      function isCovered(pixel) {
        const x = pixel % atlas.width, y = Math.floor(pixel / atlas.width);
        return regions.some(region => x >= region.x && x < region.x + region.w && y >= region.y && y < region.y + region.h);
      }
      assert.ok(ownBody.pixels.every(isCovered), name + ' must not trim any visible body pixel');
      for (const body of bodies) {
        if (body !== ownBody) assert.ok(!body.pixels.some(isCovered), name + ' must not include another sprite tip or exhaust');
      }
    }
  }
});

test('WeChat packages keep the original atlas budget and isolate expansion resources', () => {
  const root = path.join(__dirname, '..');
  const configuration = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
  const gameConfiguration = JSON.parse(fs.readFileSync(path.join(root, 'game.json'), 'utf8'));
  const fleetPackage = gameConfiguration.subpackages.find(item => item.name === 'fleet-assets');
  assert.ok(fleetPackage);
  assert.equal(fleetPackage.root, 'assets/expansion/');
  assert.ok(fs.statSync(path.join(root, fleetPackage.root, 'game.js')).isFile(), 'resource subpackage requires an entry file');
  const ignored = configuration.packOptions.ignore;
  let mainBytes = 0, expansionBytes = 0;
  function walk(relative) {
    for (const item of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const file = path.posix.join(relative, item.name);
      if (ignored.some(rule => file === rule.value || rule.type === 'folder' && file.startsWith(rule.value + '/'))) continue;
      if (item.isDirectory()) walk(file);
      else if (file.startsWith(fleetPackage.root)) expansionBytes += fs.statSync(path.join(root, file)).size;
      else mainBytes += fs.statSync(path.join(root, file)).size;
    }
  }
  walk('');
  assert.ok(mainBytes < 4 * 1024 * 1024, `main package exceeds 4 MiB: ${mainBytes} bytes`);
  assert.ok(expansionBytes < 4 * 1024 * 1024, `expansion package exceeds 4 MiB: ${expansionBytes} bytes`);
  assert.ok(mainBytes + expansionBytes < 8 * 1024 * 1024, 'the two packages retain a bounded total resource budget');
  assert.ok(!fs.existsSync(path.join(root, 'assets/enemy-variants.png')) && !fs.existsSync(path.join(root, 'assets/fleet.png')), 'expansion images must not remain duplicated in the main package');
});
