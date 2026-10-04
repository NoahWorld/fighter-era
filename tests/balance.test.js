'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, WIDTH, HEIGHT, STAGES, LIMITS } = require('../src/engine.js');

const STEP = 1 / 120;
const TRACKING_SPEED = 360;
const ARRAY_LIMITS = { ...LIMITS, playerBeams: LIMITS.beams, enemyBeams: LIMITS.beams };
delete ARRAY_LIMITS.beams;
ARRAY_LIMITS.weaponEffects = ARRAY_LIMITS.effects;
delete ARRAY_LIMITS.effects;

// This measures damage and reward pacing, not a player's survival skill.
// Enemy waves, movement, attacks, pickups, experience, and upgrades are real;
// only damage received is disabled. The controller moves horizontally at a
// finite speed and never creates targets, grants weapons, or clears enemies.
function playCampaign(build, stageCount) {
  const game = new Game({ seed: 482 });
  const results = [];
  const levelUps = [];
  const peaks = Object.fromEntries(Object.keys(ARRAY_LIMITS).map(name => [name, 0]));
  let bossFight = null;
  let earlyKills = 0;

  const destroyEnemy = game.destroyEnemy.bind(game);
  game.destroyEnemy = enemy => {
    if (enemy.y < enemy.r || enemy.y - enemy.r >= HEIGHT || enemy.x < enemy.r || enemy.x > WIDTH - enemy.r
      || (enemy.type === 'boss' && enemy.y < 160)) earlyKills++;
    destroyEnemy(enemy);
  };
  const enemyShoot = game.enemyShoot.bind(game);
  game.enemyShoot = enemy => {
    if (enemy.type === 'boss') bossFight.volleys++;
    enemyShoot(enemy);
  };
  game.onEvent = (name, event) => {
    if (name === 'levelup') levelUps.push({ level: event.level, stage: game.stage + 1 });
    if (name === 'boss' && event.phase === 'appeared') {
      bossFight = { start: game.totalTime, entered: null, volleys: 0 };
    }
    if (name === 'boss' && event.phase === 'defeated') {
      assert.notEqual(bossFight.entered, null, 'the boss must enter before defeat');
      results.push({ stage: game.stage + 1, level: game.progression.level,
        seconds: game.totalTime - bossFight.start, activeSeconds: game.totalTime - bossFight.entered,
        volleys: bossFight.volleys, ranks: { ...game.player.weapons } });
    }
  };

  game.start();
  assert.equal(game.progression.level, 1);
  assert.deepEqual(game.player.weapons, { gun: 1, laser: 0, homing: 0, explosive: 0 });
  const frameLimit = Math.ceil(stageCount * 200 / STEP);
  for (let frame = 0; frame < frameLimit; frame++) {
    if (results.length === stageCount) break;
    if (game.state === 'upgrade') {
      const upgrade = build === 'balanced' ? ['spread', 'rapid', 'repair'][game.stage % 3] : build;
      game.chooseUpgrade(upgrade);
    }
    if (game.state === 'playing') {
      game.player.invincible = 60;
      let target = game.enemies.find(enemy => enemy.type === 'boss' && enemy.hp > 0);
      if (target && target.y >= 160 && bossFight.entered === null) bossFight.entered = game.totalTime;
      if (!target) {
        target = game.pickups.find(pickup => !pickup.collected && pickup.y > 300);
        if (!target) {
          for (const enemy of game.enemies) {
            if (enemy.hp > 0 && enemy.y > 40 && (!target || enemy.y > target.y)) target = enemy;
          }
        }
      }
      if (target) game.moveBy(Math.max(-TRACKING_SPEED * STEP, Math.min(TRACKING_SPEED * STEP, target.x - game.player.x)), 0);
    }
    game.update(STEP);
    for (const name of Object.keys(peaks)) peaks[name] = Math.max(peaks[name], game[name].length);
    assert.ok(game.stageTime < 200, build + ' stalled at stage ' + (game.stage + 1));
  }
  assert.equal(results.length, stageCount, build + ' must finish every naturally scheduled mission');
  assert.equal(earlyKills, 0, 'enemies must remain alive until their entry is complete');
  for (const [name, peak] of Object.entries(peaks)) assert.ok(peak <= ARRAY_LIMITS[name], name + ' exceeded its fixed budget: ' + peak);
  return { game, results, levelUps, peaks };
}

function checkOpening(campaign) {
  const first = campaign.results[0];
  assert.ok(first.seconds >= 10 && first.seconds < 30, 'opening boss time: ' + first.seconds);
  assert.ok(first.volleys >= 3, 'the opening boss must demonstrate multiple attacks');
  assert.ok(first.level >= 2 && first.level <= 3, 'the first mission should introduce growth without rushing through models');
  const firstUpgrade = campaign.levelUps.find(event => event.level === 2);
  assert.equal(firstUpgrade.stage, 1, 'the first new aircraft should arrive during the opening mission');
  // Offensive builds may beat bosses faster; every opening boss still needs
  // enough actual combat time and attacks to prevent the reported two-second kills.
  for (const fight of campaign.results.slice(1, 10)) {
    assert.ok(fight.activeSeconds >= 4, 'early upgraded boss at stage ' + fight.stage + ' dies too quickly: ' + fight.activeSeconds);
    assert.ok(fight.volleys >= 3, 'early boss at stage ' + fight.stage + ' needs room to attack');
  }
  assert.ok(campaign.results[9].level <= 9, 'ten missions must not reach the model cap');
}

test('natural first-ten missions keep spread and mixed upgrades from rushing enemy, boss, and experience growth', t => {
  const summary = [];
  for (const build of ['spread', 'balanced']) {
    const campaign = playCampaign(build, 10);
    checkOpening(campaign);
    summary.push({ build, firstBossSeconds: +campaign.results[0].seconds.toFixed(2),
      tenthBossSeconds: +campaign.results[9].seconds.toFixed(2),
      earliestBossActiveSeconds: +Math.min(...campaign.results.map(fight => fight.activeSeconds)).toFixed(2),
      tenthMissionLevel: campaign.results[9].level });
  }
  t.diagnostic(JSON.stringify(summary));
});

test('a natural rapid-upgrade expedition completes all 100 missions within bounded combat budgets and reaches level 20 late', t => {
  const campaign = playCampaign('rapid', STAGES.length);
  checkOpening(campaign);
  assert.equal(campaign.game.state, 'victory');
  const level20 = campaign.levelUps.find(event => event.level === 20);
  assert.ok(level20 && level20.stage >= 50 && level20.stage < 100, 'level 20 should arrive in the latter half of the expedition');
  for (const fight of campaign.results) {
    assert.ok(fight.seconds < 40, 'stage ' + fight.stage + ' must not stall after level or weapon caps');
    assert.ok(fight.volleys >= 3, 'stage ' + fight.stage + ' must survive long enough to demonstrate attacks');
  }
  t.diagnostic(JSON.stringify({ firstBossSeconds: +campaign.results[0].seconds.toFixed(2),
    tenthBossSeconds: +campaign.results[9].seconds.toFixed(2), finalBossSeconds: +campaign.results[99].seconds.toFixed(2),
    level20Stage: level20.stage, peaks: campaign.peaks }));
});
