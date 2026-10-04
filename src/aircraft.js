(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ShooterAircraft = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_AIRCRAFT_LEVEL = 20;
  const WEAPON_INFO = Object.freeze({
    gun: Object.freeze({ label: '机炮', color: '#e8c182', sprite: 'round', description: '始终挂载的基础机炮', maxLevel: 5 }),
    laser: Object.freeze({ label: '光柱', color: '#8be8ff', sprite: 'beam', description: '持续穿透多个目标', maxLevel: 5 }),
    homing: Object.freeze({ label: '追踪弹', color: '#d5afff', sprite: 'missile', description: '有限转向追踪敌人', maxLevel: 5 }),
    explosive: Object.freeze({ label: '爆炸弹', color: '#ffbf81', sprite: 'rocket', description: '命中造成范围伤害', maxLevel: 5 }),
  });
  const WEAPON_TYPES = Object.freeze(Object.keys(WEAPON_INFO));
  const BASIC_WEAPONS = Object.freeze(['gun']);
  const PLAYER_NAMES = ['游隼', '银翼', '破晓', '流星', '远征', '雷霆', '猎光', '苍穹', '极光', '星曜',
    '棱翼', '双锋', '巡猎', '光环', '天矛', '重隼', '风暴', '天幕', '星舰', '寰宇'];
  const FIGHTER_NAMES = ['赤隼', '红刃', '烈焰', '黑锋', '赤牙', '獠牙', '熔岩', '铁幕', '夜枭', '赤环',
    '重锤', '蝠翼', '怒炮', '蜂群', '蛇影', '红莲', '魔翼', '灾星', '炎矛', '末日'];
  const WARSHIP_NAMES = ['巡逻艇', '突击舰', '载机舰', '重巡舰', '先锋舰', '环形舰', '导弹舰', '刃翼舰', '堡垒舰', '机库舰',
    '长矛舰', '核心舰', '猎杀舰', '泰坦舰', '侧翼舰', '炮塔舰', '轨道舰', '攻城舰', '母舰', '红色方舟'];

  function model(level, title, prefix, sheet, index, rotation, variant) {
    return Object.freeze({
      level, title, code: prefix + '-' + String(level).padStart(2, '0'),
      mountSlots: level === 1 ? 1 : level < 6 ? 2 : level < 10 ? 3 : 4,
      weaponTypes: level === 1 ? BASIC_WEAPONS : WEAPON_TYPES,
      appearance: Object.freeze({ sheet, index, rotation, variant }),
    });
  }
  const PLAYER_MODELS = Object.freeze(PLAYER_NAMES.map((title, index) => model(index + 1, title, 'FE', 'player', index % 10, 0, Math.floor(index / 10) * (index % 10 + 1))));
  const fighters = Object.freeze(FIGHTER_NAMES.map((title, index) => {
    const sheet = index < 8 ? 'enemies' : 'enemyVariants';
    const frame = index < 8 ? index : index < 18 ? index - 8 : index === 18 ? 4 : 9;
    return model(index + 1, title, 'EF', sheet, frame, Math.PI, index < 18 ? 0 : index - 17);
  }));
  const warshipFrames = [0, 2, 4, 6, 8, 9];
  const warships = Object.freeze(WARSHIP_NAMES.map((title, index) => {
    const sheet = index < 4 ? 'warships' : 'fleet';
    const frame = index < 4 ? index : index < 14 ? index - 4 : warshipFrames[index - 14];
    return model(index + 1, title, 'EW', sheet, frame, sheet === 'fleet' ? Math.PI / 2 : Math.PI, index < 14 ? 0 : index - 13);
  }));
  const ENEMY_MODELS = Object.freeze({ fighters, warships });

  function validateLevel(level) {
    if (!Number.isInteger(level) || level < 1 || level > MAX_AIRCRAFT_LEVEL) throw new RangeError('Aircraft level must be an integer from 1 to ' + MAX_AIRCRAFT_LEVEL + ': ' + level);
  }
  function getPlayerModel(level) { validateLevel(level); return PLAYER_MODELS[level - 1]; }
  function getEnemyModel(level, form = 'fighter') {
    validateLevel(level);
    if (!['fighter', 'warship'].includes(form)) throw new RangeError('Unknown enemy aircraft form: ' + form);
    return (form === 'fighter' ? fighters : warships)[level - 1];
  }

  return { MAX_AIRCRAFT_LEVEL, PLAYER_MODELS, ENEMY_MODELS, getPlayerModel, getEnemyModel, WEAPON_INFO };
});
