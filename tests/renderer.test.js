'use strict';

// These recording-Canvas checks verify shared drawing contracts, not rendered
// pixels or physical-device performance. Visual QA uses the actual renderer.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, STAGES } = require('../src/engine.js');
const { Renderer } = require('../src/renderer.js');
const { manifest, frames } = require('../src/assets.js');
const { PLAYER_MODELS, ENEMY_MODELS, getPlayerModel } = require('../src/aircraft.js');

function recordingRenderer() {
  const calls = { text: [], images: [], rotations: [], fills: [], geometry: [] };
  const ctx = {};
  for (const method of ['save', 'restore', 'translate', 'scale', 'beginPath', 'moveTo', 'lineTo',
    'quadraticCurveTo', 'bezierCurveTo', 'closePath', 'fill', 'stroke', 'arc', 'rect', 'clip']) ctx[method] = () => {};
  for (const method of ['moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo', 'arc', 'rect']) {
    ctx[method] = (...args) => calls.geometry.push([method, ...args]);
  }
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
    hit: 0, appearance: { sheet: 'fleet', index: 5, rotation: Math.PI / 2, variant: 0 } };
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
  assert.throws(() => renderer.enemy({ id: 71, type: 'scout', appearance: { sheet: 'enemyVariants', index: 10, rotation: Math.PI, variant: 0 } }, 0), /enemyVariants\[10\].*id=71/);
  assert.throws(() => renderer.enemy({ id: 72, type: 'scout' }, 0), /Invalid enemy appearance.*id=72/);
  const game = new Game();
  game.stageConfig = { ...game.stageConfig, chapter: 10 };
  assert.throws(() => renderer.draw(game, 0), /Unknown background chapter: 10; stage=0/);
});

test('defeat shows the ended run growth and pending verified revival without a free continue button', () => {
  const { renderer, calls } = recordingRenderer();
  const game = new Game();
  game.start();
  for (let remaining = game.launchDuration; remaining > 1e-8; remaining -= 0.1) game.update(Math.min(0.1, remaining));
  game.addExperience(160);
  game.player.invincible = 0;
  game.player.hp = 1;
  game.hurt();
  renderer.draw(game, 0);
  assert.ok(calls.images.some(call => call[0].name === 'player' && call[1] === frames.player[2].x && call[2] === frames.player[2].y), 'the death animation keeps the destroyed ship appearance');
  for (let remaining = game.ejectionDuration; remaining > 1e-8; remaining -= 0.1) game.update(Math.min(0.1, remaining));
  renderer.draw(game, 0);
  assert.ok(calls.text.some(([value]) => value === '本局成长  ·  Lv.3 破晓'));
  assert.ok(calls.text.some(([value]) => value === '本局获得 160 XP · 下局重新成长'));
  assert.ok(calls.text.some(([value]) => value === '广告 / 充值复活待开放'));
  assert.ok(calls.text.some(([value]) => value === '本局成长已重置 · 再次出击从第 1 关开始'));
  assert.ok(renderer.getButtons(game).every(button => button.id !== 'continue'));
  assert.equal(game.progression.level, 1);
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

test('every catalog level has a distinct shared sprite or attachment outline', () => {
  const { renderer, calls } = recordingRenderer();
  for (const [family, models] of Object.entries({ player: PLAYER_MODELS, fighter: ENEMY_MODELS.fighters, warship: ENEMY_MODELS.warships })) {
    const silhouettes = new Set();
    for (const model of models) {
      calls.images.length = 0; calls.geometry.length = 0;
      renderer.airframe(model.appearance, 90, 0);
      const signature = JSON.stringify({ images: calls.images.map(([image, ...bounds]) => [image.name, ...bounds]), geometry: calls.geometry });
      silhouettes.add(signature);
      assert.ok(calls.geometry.flatMap(call => call.slice(1)).every(Number.isFinite), family + ' Lv.' + model.level + ' has finite geometry');
      assert.ok(calls.geometry.length < 180, 'attachment drawing remains bounded');
    }
    assert.equal(silhouettes.size, 20, family + ' must not reuse a level appearance unchanged');
  }
  assert.throws(() => renderer.aircraft(0, 0, 1, 0, false, 1, 21), /from 1 to 20/);
  assert.throws(() => renderer.airframe({ ...getPlayerModel(11).appearance, variant: 11 }, 75, 0), /silhouette module/);
});

test('the catalog pages browse all 60 models without changing the run, inventory, or saved checkpoint', () => {
  const { renderer, calls } = recordingRenderer();
  const game = new Game();
  game.start(); game.home();
  const original = JSON.stringify(game);
  const checkpoint = game.savedCheckpoint;
  assert.ok(renderer.getButtons(game).some(button => button.id === 'hangar'));
  renderer.showHangar();
  for (const category of ['player', 'enemy', 'warship']) {
    assert.equal(renderer.handleHangarAction('hangar:tab:' + category), true);
    const visited = new Set();
    for (let page = 0; page < 5; page++) {
      const buttons = renderer.getButtons(game);
      for (const button of buttons.filter(item => item.id.startsWith('hangar:model:'))) {
        visited.add(Number(button.id.slice('hangar:model:'.length)));
        assert.equal(renderer.handleHangarAction(button.id), true);
        renderer.draw(game, 1);
      }
      assert.equal(buttons.find(button => button.id === 'hangar:prev').disabled, page === 0);
      assert.equal(buttons.find(button => button.id === 'hangar:next').disabled, page === 4);
      renderer.handleHangarAction('hangar:next');
    }
    assert.equal(visited.size, 20);
  }
  assert.ok(calls.text.some(([value]) => value === '只查看外形 · 不影响出击战机'));
  assert.equal(renderer.handleHangarAction('start'), false, 'browsing cannot trigger combat actions');
  assert.equal(JSON.stringify(game), original);
  assert.equal(game.savedCheckpoint, checkpoint);
  assert.equal(renderer.handleHangarAction('hangar:close'), true);
  assert.equal(renderer.hangar, null);
  assert.equal(renderer.handleHangarAction('hangar:close'), false);
  game.state = 'playing';
  assert.ok(renderer.getButtons(game).every(button => button.id !== 'hangar'), 'combat has no catalog entry');
});

test('battle, launch, ejection, and archive all draw the same level-20 silhouette', () => {
  const { renderer } = recordingRenderer();
  const game = new Game();
  game.addExperience(1000000);
  const appearance = getPlayerModel(20).appearance;
  const drawn = [];
  renderer.airframe = descriptor => drawn.push(descriptor);
  renderer.menu(game, 0);
  game.state = 'playing'; renderer.world(game, 0);
  game.cinematicTime = 0.5; renderer.launchScene(game);
  game.resultProgression = { ...game.progression }; renderer.ejectionScene(game);
  renderer.showHangar(); renderer.handleHangarAction('hangar:model:20'); renderer.hangarScene(0);
  assert.ok(drawn.length >= 5);
  assert.ok(drawn.slice(0, 4).every(descriptor => descriptor === appearance), 'menu, battle, launch and ejection share the exact descriptor');
  assert.equal(drawn.filter(descriptor => descriptor === appearance).length, 6);
});

test('MAX experience and stacked weapon HUD show mounted ranks and reserves with finite bars', () => {
  const { renderer, calls } = recordingRenderer();
  const game = new Game();
  game.addExperience(1000000);
  renderer.menu(game, 0);
  assert.ok(calls.text.some(([value]) => value === 'MAX · 已满级'));
  renderer.hud(game);
  assert.ok(calls.text.some(([value]) => value === 'MAX'));
  assert.ok(calls.geometry.flatMap(call => call.slice(1)).every(Number.isFinite));
  const earlyGame = new Game(); earlyGame.addExperience(60); // Level 2 has two mounting positions.
  earlyGame.player.weapons = Object.freeze({ gun: 3, laser: 2, homing: 4, explosive: 1 });
  calls.text.length = 0; renderer.hud(earlyGame);
  for (const label of ['挂载 2/2', '机炮3', '光柱2', '追踪4储', '爆炸1储']) {
    assert.ok(calls.text.some(([value]) => value === label), 'HUD displays ' + label);
  }
  assert.throws(() => renderer.experienceRatio({ level: 2, xp: 10, nextXp: 0 }), /Invalid experience bar/);
});
