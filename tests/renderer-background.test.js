'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Game } = require('../src/engine.js');
const { Renderer } = require('../src/renderer.js');
const { manifest, frames } = require('../src/assets.js');

function canvasRecorder() {
  const operations = []; const stack = [];
  const ctx = { globalAlpha: 1, shadowBlur: 0, lineWidth: 1, filter: 'none' };
  for (const method of ['translate', 'rotate', 'scale', 'beginPath', 'moveTo', 'lineTo', 'quadraticCurveTo',
    'bezierCurveTo', 'closePath', 'arc', 'rect', 'clip', 'fill', 'stroke', 'fillRect', 'drawImage', 'fillText']) {
    ctx[method] = (...args) => operations.push({ method, args, color: method === 'stroke' ? ctx.strokeStyle : ctx.fillStyle, width: ctx.lineWidth });
  }
  ctx.save = () => stack.push({ globalAlpha: ctx.globalAlpha, shadowBlur: ctx.shadowBlur, lineWidth: ctx.lineWidth, filter: ctx.filter });
  ctx.restore = () => Object.assign(ctx, stack.pop());
  ctx.createLinearGradient = ctx.createRadialGradient = () => {
    operations.push({ method: 'gradient', args: [] });
    return { addColorStop() {} };
  };
  const images = Object.fromEntries(Object.entries(manifest).map(([name, description]) => [name, { ...description, name }]));
  const renderer = new Renderer(ctx, { images, frames });
  return { renderer, ctx, operations };
}

function geometry(operations) {
  return operations.filter(item => !['fill', 'stroke', 'fillText'].includes(item.method)).map(item => [item.method, ...item.args]);
}

test('100 levels select distinct shared-Canvas geometry, with ten different visual structures', () => {
  const { renderer, operations } = canvasRecorder(); const game = new Game();
  game.state = 'playing';
  const levels = new Set(); const structures = new Set();
  const chapterPalettes = Array.from({ length: 10 }, () => new Set());
  for (let stage = 0; stage < 100; stage += 1) {
    game.stage = stage; game.prepareStage(); operations.length = 0;
    renderer.background(game, 0);
    chapterPalettes[Math.floor(stage / 10)].add(operations[0].color);
    levels.add(JSON.stringify(geometry(operations)));
    if (stage % 10 === 0) structures.add(geometry(operations).map(item => item[0]).join(','));
  }
  assert.equal(levels.size, 100, 'even adjacent levels must differ without relying on colors');
  assert.equal(structures.size, 10, 'chapters must have different geometric structures, beyond their palettes');
  assert.ok(chapterPalettes.every(palette => palette.size === 1), 'geometry varies while each chapter retains its palette');
});

test('scrolling reuses bounded background objects without textures, gradients or blur', () => {
  const { renderer, ctx, operations } = canvasRecorder(); const game = new Game();
  game.state = 'playing';
  const references = [renderer.stars, renderer.nebulae, renderer.terrain, renderer.backgrounds, renderer.backgroundShapes, renderer.spiralArms];
  assert.equal(renderer.stars.length, 84);
  assert.equal(renderer.backgroundShapes.length, 18);
  assert.equal(renderer.spiralArms.length, 4);
  for (let stage = 0; stage < 100; stage += 1) {
    game.stage = stage; game.prepareStage(); operations.length = 0;
    renderer.background(game, 0); const initial = geometry(operations);
    operations.length = 0; renderer.background(game, 10.5);
    assert.notDeepEqual(geometry(operations), initial, 'level ' + (stage + 1) + ' scrolls');
    assert.equal(operations.some(item => ['gradient', 'drawImage'].includes(item.method)), false);
    assert.ok(operations.filter(item => item.method === 'stroke').length < 100, 'background draw work stays bounded');
    assert.equal(ctx.shadowBlur, 0); assert.equal(ctx.filter, 'none'); assert.equal(ctx.globalAlpha, 1);
    for (const operation of operations) for (const value of operation.args) {
      if (typeof value === 'number') assert.ok(Number.isFinite(value), 'finite background coordinates');
    }
  }
  assert.deepEqual([renderer.stars, renderer.nebulae, renderer.terrain, renderer.backgrounds, renderer.backgroundShapes, renderer.spiralArms], references);
});

test('reward offers isolate controls, keep unavailable integrations disabled and preserve the run', () => {
  const { renderer, operations } = canvasRecorder(); const game = new Game();
  game.state = 'playing'; game.bombCharges = 0; game.supportCharges = 0;
  assert.ok(renderer.abilityButtons(game).every(button => !button.disabled), 'exhausted skills still open the acquisition panel');
  assert.deepEqual(renderer.abilityButtons(game).map(button => button.label), ['获取救援', '获取炸弹']);
  const before = JSON.stringify(game);
  for (const item of ['bomb', 'support', 'revive']) {
    renderer.showRewardOffer(item);
    assert.deepEqual(renderer.getButtons(game).map(({ id, disabled }) => [id, disabled]), [
      ['reward:ad', true], ['reward:purchase', true], ['reward:close', false],
    ]);
    operations.length = 0; renderer.draw(game, 1);
    assert.ok(operations.some(operation => operation.method === 'fillText' && operation.args[0].includes('待开通')));
    renderer.hideRewardOffer();
  }
  // The renderer is not an authorization source and never restores lost growth.
  assert.equal(JSON.stringify(game), before);
  game.state = 'gameover';
  assert.ok(renderer.getButtons(game).some(button => button.id === 'revive'));
  assert.ok(renderer.getButtons(game).every(button => button.id !== 'continue'));
  assert.throws(() => renderer.showRewardOffer('free-revive'), /Unknown reward offer/);
});

test('weapon pickups identify their mode and player projectiles use distinct visible forms', () => {
  const { renderer, operations } = canvasRecorder(); const game = new Game();
  game.state = 'playing';
  game.pickups = ['gun', 'laser', 'homing', 'explosive'].map((weapon, i) => ({ type: 'weapon', weapon, x: 70 + i * 80, y: 330, r: 12, t: 0 }));
  game.playerBullets = ['gun', 'homing', 'explosive'].map((kind, i) => ({ kind, x: 70 + i * 90, y: 300, r: 5, vx: 0, vy: -500 }));
  game.playerBeams = [{ x: 220, y: 560, angle: -Math.PI / 2, length: 500, width: 11, t: 0.1, warning: 0, duration: 0.22 }];
  renderer.world(game, 0);
  const labels = operations.filter(item => item.method === 'fillText').map(item => item.args[0]);
  for (const label of ['机炮', '光柱', '追踪弹', '爆炸弹']) assert.ok(labels.includes(label));
  const projectileSources = operations.filter(item => item.method === 'drawImage' && item.args[0].name === 'projectiles');
  assert.equal(new Set(projectileSources.map(item => item.args.slice(1, 5).join(','))).size, 3);
  assert.ok(operations.some(item => item.method === 'stroke' && item.color === '#51d4ef' && item.width === 11));
});

test('enemy light columns telegraph before becoming solid red beams and reject bad geometry', () => {
  const { renderer, operations } = canvasRecorder();
  const beam = { x: 180, y: 150, angle: Math.PI / 2, length: 540, width: 12, t: 0.5, warning: 0.9, duration: 0.26 };
  renderer.beam(beam, true);
  assert.ok(operations.some(item => item.method === 'fillText' && item.args[0] === '光束锁定'));
  assert.equal(operations.some(item => item.method === 'stroke' && item.width === beam.width), false);
  operations.length = 0; renderer.beam({ ...beam, t: 1 }, true);
  assert.ok(operations.some(item => item.method === 'stroke' && item.color === '#ff694d' && item.width === beam.width));
  assert.ok(operations.some(item => item.method === 'lineTo' && Math.abs(item.args[0] - 180) < 1e-8 && item.args[1] === 690));
  assert.throws(() => renderer.beam({ ...beam, length: NaN }, true), /Invalid enemy beam geometry/);
  assert.throws(() => renderer.pickup({ type: 'weapon', weapon: 'unknown' }), /Unknown weapon pickup/);
});
