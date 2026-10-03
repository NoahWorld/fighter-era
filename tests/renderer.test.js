'use strict';

// These recording-Canvas checks verify shared drawing contracts, not rendered
// pixels or physical-device performance. Visual QA uses the actual renderer.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, STAGES } = require('../src/engine.js');
const { Renderer } = require('../src/renderer.js');
const { manifest, frames } = require('../src/assets.js');

function recordingRenderer() {
  const calls = { text: [], images: [], rotations: [], fills: [] };
  const ctx = {};
  for (const method of ['save', 'restore', 'translate', 'scale', 'beginPath', 'moveTo', 'lineTo',
    'quadraticCurveTo', 'bezierCurveTo', 'closePath', 'fill', 'stroke', 'arc', 'rect', 'clip']) ctx[method] = () => {};
  ctx.fillText = (...args) => calls.text.push(args);
  ctx.drawImage = (...args) => calls.images.push(args);
  ctx.rotate = angle => calls.rotations.push(angle);
  ctx.fillRect = (...args) => calls.fills.push({ color: ctx.fillStyle, args });
  ctx.createLinearGradient = ctx.createRadialGradient = () => ({ addColorStop() {} });
  const images = Object.fromEntries(Object.entries(manifest).map(([name, descriptor]) => [name, { ...descriptor, name }]));
  return { renderer: new Renderer(ctx, { images, frames }), calls, images, ctx };
}

test('all 100 stage configurations draw their generated enemy and BOSS appearances', () => {
  const { renderer, calls } = recordingRenderer();
  const game = new Game();
  const stars = renderer.stars;
  const nebulae = renderer.nebulae;
  const terrain = renderer.terrain;
  const bossForms = new Set();
  const chapterSkies = new Set();
  const usedFrames = new Map([['enemyVariants', new Set()], ['fleet', new Set()]]);
  for (let stage = 0; stage < STAGES.length; stage++) {
    game.stage = stage;
    game.prepareStage();
    game.state = 'playing';
    game.spawnWave();
    game.spawnBoss();
    game.enemies.forEach((enemy, index) => { enemy.y = 115 + index * 65; });
    bossForms.add(game.enemies.find(enemy => enemy.type === 'boss').form);
    for (const enemy of game.enemies) {
      if (enemy.appearance && usedFrames.has(enemy.appearance.sheet)) usedFrames.get(enemy.appearance.sheet).add(enemy.appearance.index);
    }
    const firstFill = calls.fills.length;
    renderer.draw(game, stage);
    chapterSkies.add(calls.fills[firstFill].color);
    assert.ok(calls.text.some(([text]) => text.endsWith((stage + 1) + '/100')), 'HUD identifies stage ' + (stage + 1));
    assert.equal(renderer.stars, stars);
    assert.equal(renderer.nebulae, nebulae);
    assert.equal(renderer.terrain, terrain);
  }
  assert.deepEqual([...bossForms].sort(), ['fighter', 'warship']);
  assert.equal(chapterSkies.size, 10, 'each ten-level chapter has a distinct sky palette');
  for (const [sheet, indices] of usedFrames) assert.equal(indices.size, 10, sheet + ' uses all ten new silhouettes');
  assert.equal(stars.length, 84, 'the level expansion must not grow background objects');
  for (const [, ...dimensions] of calls.images) {
    assert.ok(dimensions.every(Number.isFinite), 'all source and destination coordinates are finite');
    assert.ok(dimensions[2] > 0 && dimensions[3] > 0 && dimensions[6] > 0 && dimensions[7] > 0);
  }
});

test('right-facing fleet sprites rotate downwards and place health above their rotated height', () => {
  const { renderer, calls } = recordingRenderer();
  const enemy = { id: 42, type: 'boss', form: 'warship', x: 202, y: 180, r: 56, hp: 30, maxHp: 100,
    hit: 0, appearance: { sheet: 'fleet', index: 5, rotation: Math.PI / 2 } };
  renderer.enemy(enemy, 0);
  assert.equal(calls.rotations.at(-1), Math.PI / 2);
  const frame = frames.fleet[5];
  const width = frame.w * Math.min(enemy.r * 3.05 / frame.w, enemy.r * 3.05 / frame.h);
  const label = calls.text.find(([value]) => value === '敌方旗舰');
  assert.ok(label);
  assert.ok(Math.abs(label[2] - (enemy.y - width / 2 - 17)) < 1e-8, 'health label clears the ship nose after rotation');
});

test('menu, mission 010 and final victory consistently show the expanded campaign', () => {
  const { renderer, calls } = recordingRenderer();
  const game = new Game();
  renderer.draw(game, 0);
  assert.ok(calls.text.some(([value]) => value === '100 关远征  ·  10 大星域'));
  game.stage = 9;
  game.prepareStage();
  game.state = 'playing';
  renderer.draw(game, 0);
  assert.ok(calls.text.some(([value]) => value === 'MISSION 010'));
  game.stage = 99;
  game.prepareStage();
  game.state = 'playing';
  game.spawnBoss();
  game.destroyEnemy(game.enemies.find(enemy => enemy.type === 'boss'));
  assert.equal(game.state, 'victory');
  renderer.draw(game, 1);
  assert.ok(calls.text.some(([value]) => value === '最终 BOSS 已击败'));
  assert.ok(calls.text.some(([value]) => value === '100 关全部突破，群星见证你的航迹。'));
});

test('missing atlases, unknown appearance indices and invalid chapters fail with context', () => {
  const { renderer, images, ctx } = recordingRenderer();
  const incomplete = { ...images };
  delete incomplete.fleet;
  assert.throws(() => new Renderer(ctx, { images: incomplete, frames }), /Missing loaded sprite sheet: fleet/);
  assert.throws(() => renderer.enemy({ id: 71, type: 'scout', appearance: { sheet: 'enemyVariants', index: 10, rotation: Math.PI } }, 0), /enemyVariants\[10\].*id=71/);
  assert.throws(() => renderer.enemy({ id: 72, type: 'scout' }, 0), /Invalid enemy appearance.*id=72/);
  const game = new Game();
  game.stageConfig = { ...game.stageConfig, chapter: 10 };
  assert.throws(() => renderer.draw(game, 0), /Unknown background chapter: 10; stage=0/);
});

test('segmented atlas regions retain common scale and exclude neighboring sprites', () => {
  const { renderer, calls, images, ctx } = recordingRenderer();
  const frame = { x: 10, y: 20, w: 100, h: 80,
    regions: [{ x: 10, y: 20, w: 100, h: 60 }, { x: 30, y: 80, w: 60, h: 20 }] };
  renderer.sprite('enemyVariants', frame, 50);
  assert.deepEqual(calls.images.map(call => call.slice(1)), [
    [10, 20, 100, 60, -25, -20, 50, 30],
    [30, 80, 60, 20, -15, 10, 30, 10],
  ]);
  const invalidRegions = { ...frames, enemyVariants: [...frames.enemyVariants] };
  invalidRegions.enemyVariants[0] = { ...frame, regions: [{ x: 10, y: 20, w: 101, h: 10 }] };
  assert.throws(() => new Renderer(ctx, { images, frames: invalidRegions }), /Invalid sprite region: enemyVariants.0\[0\]/);
  invalidRegions.enemyVariants[0] = { ...frame, regions: [frame, { x: 20, y: 30, w: 5, h: 5 }] };
  assert.throws(() => new Renderer(ctx, { images, frames: invalidRegions }), /Overlapping sprite regions: enemyVariants.0/);
});
