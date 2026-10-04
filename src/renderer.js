(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./aircraft.js'));
  else root.ShooterRenderer = factory(root.ShooterAircraft);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Aircraft) {
  'use strict';

  if (!Aircraft || typeof Aircraft.getPlayerModel !== 'function') throw new Error('Renderer requires the shared aircraft catalog');

  const W = 405;
  const H = 720;
  const C = {
    bg: '#050b18', panel: '#101e31', line: '#34445b', text: '#eff4ff',
    muted: '#7e91b0', gold: '#e8c182', blue: '#70c8ff', mint: '#a8e8f5',
    cyan: '#70c8ff', orange: '#ff8e69',
  };
  const clamp01 = value => Math.max(0, Math.min(1, value));
  const smooth = value => { const t = clamp01(value); return t * t * (3 - 2 * t); };
  const FONT = '"PingFang SC", "Microsoft YaHei", -apple-system, sans-serif';
  const WEAPONS = Aircraft.WEAPON_INFO;
  const HANGAR_CATEGORIES = Object.freeze({ player: '我方战机', enemy: '敌方战机', warship: '敌方战舰' });
  const HANGAR_PAGE_SIZE = 4;
  const LANDSCAPES = Object.freeze(['航道光带', '星环边界', '陨石长河', '轨道遗迹', '星港网格',
    '双星回廊', '星云裂隙', '螺旋星系', '冰晶星海', '恒星风暴']);
  const SECTORS = [
    {
      sky: '#060d1d', mist: '#466ea7', star: '#a9d6f4', accent: '#dbcaab',
      planet: ['#101d36', '#193655', '#254967', '#315e7a'], rim: '#76aec4',
      band: '#8bbfc5', moon: '#26394c', x: 382, y: 228, radius: 126, ring: false,
    },
    {
      sky: '#100c24', mist: '#855298', star: '#c8b7f2', accent: '#a8dfeb',
      planet: ['#201d42', '#43345f', '#685071', '#876982'], rim: '#c69fca',
      band: '#d4abbe', moon: '#414369', x: 76, y: 204, radius: 100, ring: true,
    },
    {
      sky: '#180d1b', mist: '#a65446', star: '#e7b7a0', accent: '#e3d4b1',
      planet: ['#301929', '#583039', '#814341', '#a75c4a'], rim: '#d8a078',
      band: '#edb277', moon: '#51353e', x: 353, y: 249, radius: 145, ring: false,
    },
    {
      sky: '#061b21', mist: '#438c89', star: '#aadcd4', accent: '#ecd3a1',
      planet: ['#112b32', '#1d4547', '#306261', '#477c71'], rim: '#83c8b0',
      band: '#a1d1b8', moon: '#23474c', x: 34, y: 253, radius: 120, ring: true,
    },
    {
      sky: '#111628', mist: '#7189b2', star: '#c7e4f5', accent: '#a5b9ed',
      planet: ['#233249', '#3b5067', '#587189', '#7593a3'], rim: '#b0d8dc',
      band: '#cee5e8', moon: '#3c526b', x: 383, y: 186, radius: 114, ring: false,
    },
    {
      sky: '#24101f', mist: '#a85077', star: '#e7baca', accent: '#b1cbee',
      planet: ['#402138', '#65364d', '#864c62', '#a66b7e'], rim: '#d2a3b3',
      band: '#e2bdcc', moon: '#573047', x: 59, y: 239, radius: 131, ring: true,
    },
    {
      sky: '#191713', mist: '#9c8850', star: '#e6d7b6', accent: '#b3d9ed',
      planet: ['#383024', '#5d5039', '#837055', '#a78e65'], rim: '#d1b887',
      band: '#e0ce9f', moon: '#534a36', x: 362, y: 213, radius: 137, ring: false,
    },
    {
      sky: '#110f29', mist: '#645cba', star: '#c9c1f2', accent: '#edb7b9',
      planet: ['#252344', '#424067', '#62608c', '#7d79aa'], rim: '#b7afd9',
      band: '#cdc1e2', moon: '#3c385d', x: 40, y: 185, radius: 110, ring: true,
    },
    {
      sky: '#081b29', mist: '#467eaa', star: '#b1dcee', accent: '#ddaab7',
      planet: ['#183447', '#28556c', '#3b7990', '#5897a3'], rim: '#8fcdd5',
      band: '#bee0df', moon: '#244c62', x: 379, y: 268, radius: 128, ring: true,
    },
    {
      sky: '#210e16', mist: '#a04d4c', star: '#efb8a6', accent: '#e5cd8d',
      planet: ['#3d2029', '#683039', '#914746', '#b5634e'], rim: '#e0a178',
      band: '#ebba81', moon: '#55313d', x: 42, y: 233, radius: 152, ring: false,
    },
  ];

  function roundPath(ctx, x, y, w, h, radius) {
    const r = Math.min(radius, w / 2, h / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }

  function polygon(ctx, points, fill, stroke) {
    ctx.beginPath(); ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i][0], points[i][1]);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
  }

  class Renderer {
    constructor(ctx, assets) {
      if (!ctx || typeof ctx.fillRect !== 'function') throw new TypeError('Renderer requires a Canvas 2D context');
      if (!assets || !assets.images || !assets.frames) throw new TypeError('Renderer requires loaded sprite assets');
      for (const [sheet, count] of [['player', 10], ['enemies', 8], ['warships', 4], ['enemyVariants', 10], ['fleet', 10]]) {
        if (!assets.images[sheet]) throw new Error('Missing loaded sprite sheet: ' + sheet);
        if (!Array.isArray(assets.frames[sheet]) || assets.frames[sheet].length !== count) {
          throw new Error('Sprite sheet ' + sheet + ' requires exactly ' + count + ' frames');
        }
      }
      if (!assets.images.projectiles || !assets.frames.projectiles) throw new Error('Missing loaded sprite sheet: projectiles');
      const projectileNames = ['round', 'heavy', 'twin', 'shard', 'energy', 'missile', 'rocket', 'beam', 'enemyBolt', 'plasma', 'enemyBeam', 'mine'];
      for (const name of projectileNames) {
        if (!assets.frames.projectiles[name]) throw new Error('Missing projectile sprite: ' + name);
      }
      for (const [sheet, frames] of Object.entries(assets.frames)) {
        for (const [name, frame] of Object.entries(frames)) {
          if (!frame || !Number.isFinite(frame.x) || !Number.isFinite(frame.y) || !Number.isFinite(frame.w) || !Number.isFinite(frame.h)
            || frame.x < 0 || frame.y < 0 || frame.w <= 0 || frame.h <= 0) {
            throw new Error('Invalid sprite bounds: ' + sheet + '.' + name);
          }
          if (frame.regions !== undefined) {
            if (!Array.isArray(frame.regions) || frame.regions.length === 0) throw new Error('Invalid sprite regions: ' + sheet + '.' + name);
            for (let i = 0; i < frame.regions.length; i += 1) {
              const region = frame.regions[i];
              if (!region || ![region.x, region.y, region.w, region.h].every(Number.isInteger)
                || region.w <= 0 || region.h <= 0 || region.x < frame.x || region.y < frame.y
                || region.x + region.w > frame.x + frame.w || region.y + region.h > frame.y + frame.h) {
                throw new Error('Invalid sprite region: ' + sheet + '.' + name + '[' + i + ']');
              }
              for (let j = 0; j < i; j += 1) {
                const previous = frame.regions[j];
                if (region.x < previous.x + previous.w && region.x + region.w > previous.x
                  && region.y < previous.y + previous.h && region.y + region.h > previous.y) {
                  throw new Error('Overlapping sprite regions: ' + sheet + '.' + name);
                }
              }
            }
          }
        }
      }
      this.ctx = ctx;
      this.assets = assets;
      this.stars = Array.from({ length: 84 }, (_, i) => ({
        x: (i * 127.13 + 41) % W, y: (i * 179.79 + 19) % H,
        speed: 9 + (i % 3) * 9, size: i % 17 === 0 ? 1.3 : 0.5 + (i % 3) * 0.2,
        alpha: 0.24 + (i % 7) * 0.065, accent: i % 9 === 0, cross: i % 28 === 0,
      }));
      this.nebulae = [
        { x: 344, y: 135, radius: 319, flatten: 0.59, angle: -0.48 },
        { x: 22, y: 664, radius: 268, flatten: 0.72, angle: -0.48 },
      ];
      this.terrain = Array.from({ length: 6 }, (_, i) => ({
        x: Math.cos(i * 2.4) * (0.24 + (i % 3) * 0.2),
        y: Math.sin(i * 2.4) * (0.2 + (i % 3) * 0.16), r: 0.04 + (i % 3) * 0.027,
      }));
      this.backgroundClock = { source: null, previous: 0, elapsed: 0 };
      this.backgroundShapes = Object.freeze(Array.from({ length: 18 }, (_, i) => {
        const radius = 6 + (i * 7) % 16;
        return Object.freeze({ x: (i * 127 + 17) % W, y: (i * 163 + 41) % H, radius,
          angle: (i * 2.399) % (Math.PI * 2),
          points: Object.freeze(Array.from({ length: 6 }, (_, point) => {
            const a = point * Math.PI / 3;
            const extent = radius * (0.72 + ((point + i) % 3) * 0.13);
            return Object.freeze([Math.cos(a) * extent, Math.sin(a) * extent]);
          })) });
      }));
      this.spiralArms = Object.freeze(Array.from({ length: 4 }, (_, arm) => Object.freeze(
        Array.from({ length: 25 }, (_, i) => {
          const angle = arm * Math.PI / 2 + i * 0.14; const radius = 12 + i * 7.5;
          return Object.freeze([Math.cos(angle) * radius, Math.sin(angle) * radius * 0.68]);
        }))));
      // All 100 layouts are made once. Changing a level selects fixed geometry;
      // scrolling changes coordinates only, without textures, gradients or blur.
      this.backgrounds = Array.from({ length: 100 }, (_, stage) => {
        const chapter = Math.floor(stage / 10); const variant = stage % 10;
        return Object.freeze({
          chapter, variant, name: LANDSCAPES[chapter], angle: (variant - 4.5) * 0.09,
          center: 85 + ((variant * 73 + chapter * 41) % 235),
          planetX: variant % 2 ? 375 - variant * 5 : 25 + variant * 5,
          planetY: 95 + (variant * 61) % 250, radiusScale: 0.66 + variant * 0.039,
          offsetX: variant * 47 + chapter * 29, offsetY: variant * 53,
        });
      });
      this.rewardOffer = null;
      this.hangar = null;
    }

    text(value, x, y, size, color, weight, align) {
      const ctx = this.ctx;
      ctx.fillStyle = color || C.text;
      ctx.font = (weight || '400') + ' ' + size + 'px ' + FONT;
      ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(String(value), x, y);
    }

    box(x, y, w, h, fill, stroke, radius) {
      const ctx = this.ctx;
      roundPath(ctx, x, y, w, h, radius === undefined ? 12 : radius);
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
    }

    line(x1, y1, x2, y2, color, width) {
      const ctx = this.ctx;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      ctx.strokeStyle = color; ctx.lineWidth = width || 1; ctx.stroke();
    }

    circle(x, y, r, fill, stroke, width) {
      const ctx = this.ctx;
      ctx.beginPath(); ctx.arc(x, y, Math.max(0, r), 0, Math.PI * 2);
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width || 1; ctx.stroke(); }
    }

    glow(x, y, r, center, edge) {
      const ctx = this.ctx;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, center); g.addColorStop(1, edge || 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }

    pauseButton() { return { id: 'pause', label: '暂停', x: 8, y: 10, w: 44, h: 44, disabled: false }; }

    abilityButtons(game) {
      const supportBalance = game.supportCharges + game.inventory.support;
      const bombBalance = game.bombCharges + game.inventory.bomb;
      return [
        { id: 'support', label: supportBalance === 0 ? '获取救援' : '救援', x: 347, y: 480, w: 50, h: 56,
          disabled: game.supportTime > 0,
          active: game.supportTime > 0, status: game.supportTime > 0 ? '作战 ' + Math.ceil(game.supportTime) + 's' : supportBalance === 0 ? '广告 / 充值' : '余量 ' + supportBalance },
        { id: 'bomb', label: bombBalance === 0 ? '获取炸弹' : '轰炸弹', x: 347, y: 548, w: 50, h: 56,
          disabled: game.bombTime > 0,
          active: game.bombTime > 0, status: game.bombTime > 0 ? '清空空域' : bombBalance === 0 ? '广告 / 充值' : '余量 ' + bombBalance },
      ];
    }

    getButtons(game) {
      if (this.hangar) return this.hangarButtons();
      if (this.rewardOffer) return this.rewardButtons();
      return this.getSceneButtons(game);
    }

    showHangar() { this.hangar = { category: 'player', page: 0, selectedLevel: 1 }; }

    hideHangar() { this.hangar = null; }

    hangarModels() {
      if (!this.hangar || !Object.prototype.hasOwnProperty.call(HANGAR_CATEGORIES, this.hangar.category)
        || !Number.isInteger(this.hangar.page) || this.hangar.page < 0 || this.hangar.page >= 5
        || !Number.isInteger(this.hangar.selectedLevel) || this.hangar.selectedLevel < 1 || this.hangar.selectedLevel > Aircraft.MAX_AIRCRAFT_LEVEL) {
        throw new RangeError('Invalid aircraft catalog view state');
      }
      return this.hangar.category === 'player' ? Aircraft.PLAYER_MODELS
        : this.hangar.category === 'enemy' ? Aircraft.ENEMY_MODELS.fighters : Aircraft.ENEMY_MODELS.warships;
    }

    handleHangarAction(id) {
      if (!this.hangar) return false;
      if (typeof id !== 'string') throw new TypeError('Aircraft catalog action must be a string');
      const models = this.hangarModels();
      if (id === 'hangar:close') { this.hideHangar(); return true; }
      if (id.startsWith('hangar:tab:')) {
        const category = id.slice('hangar:tab:'.length);
        if (!Object.prototype.hasOwnProperty.call(HANGAR_CATEGORIES, category)) throw new RangeError('Unknown aircraft catalog category: ' + category);
        this.hangar = { category, page: 0, selectedLevel: 1 };
        return true;
      }
      if (id === 'hangar:prev' || id === 'hangar:next') {
        const page = this.hangar.page + (id === 'hangar:next' ? 1 : -1);
        if (page >= 0 && page < models.length / HANGAR_PAGE_SIZE) {
          this.hangar.page = page; this.hangar.selectedLevel = page * HANGAR_PAGE_SIZE + 1;
        }
        return true;
      }
      if (id.startsWith('hangar:model:')) {
        const level = Number(id.slice('hangar:model:'.length));
        Aircraft.getPlayerModel(level);
        this.hangar.selectedLevel = level; this.hangar.page = Math.floor((level - 1) / HANGAR_PAGE_SIZE);
        return true;
      }
      return false;
    }

    hangarButtons() {
      const models = this.hangarModels();
      return [
        ...Object.entries(HANGAR_CATEGORIES).map(([category, label], index) => ({
          id: 'hangar:tab:' + category, label, x: 24 + index * 121, y: 112, w: 115, h: 38,
          active: this.hangar.category === category, disabled: false,
        })),
        ...models.slice(this.hangar.page * HANGAR_PAGE_SIZE, (this.hangar.page + 1) * HANGAR_PAGE_SIZE).map((model, index) => ({
          id: 'hangar:model:' + model.level, label: 'Lv.' + model.level + ' ' + model.title,
          x: 24 + (index % 2) * 185, y: 166 + Math.floor(index / 2) * 154, w: 172, h: 142,
          active: model.level === this.hangar.selectedLevel, disabled: false,
        })),
        { id: 'hangar:prev', label: '上一页', x: 24, y: 481, w: 99, h: 34, disabled: this.hangar.page === 0 },
        { id: 'hangar:next', label: '下一页', x: 282, y: 481, w: 99, h: 34, disabled: this.hangar.page === 4 },
        { id: 'hangar:close', label: '返回首页', x: 24, y: 674, w: 357, h: 40, disabled: false },
      ];
    }

    hangarThumbnail(model, x, y, extent, time) {
      const frame = this.appearanceFrame(model.appearance);
      const moduleScale = model.appearance.variant > 0 ? 1.65 : 1;
      const width = frame.w * Math.min(extent / (frame.w * moduleScale), extent / (frame.h * moduleScale));
      this.ctx.save(); this.ctx.translate(x, y);
      this.airframe(model.appearance, width, time);
      this.ctx.restore();
    }

    hangarScene(time) {
      const models = this.hangarModels();
      const view = this.hangar;
      const hostile = view.category !== 'player';
      const accent = hostile ? '#ffa18c' : C.gold;
      this.ctx.fillStyle = 'rgba(4,11,24,0.94)'; this.ctx.fillRect(0, 0, W, H);
      this.text('战机图鉴', 24, 38, 25, C.text, '600');
      this.text('A I R C R A F T   A R C H I V E', 24, 65, 8, accent, '500');
      this.text('外形与挂载预览 · 战机在本局战斗中自动成长', 24, 91, 10, '#8da2bd');
      const buttons = this.hangarButtons();
      for (const button of buttons.filter(item => item.id.startsWith('hangar:tab:'))) {
        this.box(button.x, button.y, button.w, button.h, button.active ? '#273348' : '#111e31', button.active ? accent : '#35445c', 8);
        this.text(button.label, button.x + button.w / 2, button.y + button.h / 2, 11, button.active ? C.text : '#8399b5', '500', 'center');
      }
      for (const button of buttons.filter(item => item.id.startsWith('hangar:model:'))) {
        const model = models[Number(button.id.slice('hangar:model:'.length)) - 1];
        this.box(button.x, button.y, button.w, button.h, button.active ? '#1b2c42' : '#0e1a2a', button.active ? accent : '#2b3b52', 10);
        this.text(model.code, button.x + 11, button.y + 16, 7, '#7b92ad', '500');
        this.hangarThumbnail(model, button.x + button.w / 2, button.y + 65, 82, time);
        this.text(button.label, button.x + button.w / 2, button.y + 112, 11, button.active ? '#f3d9ad' : '#c7d6e8', '500', 'center');
        this.text(model.mountSlots + ' 个挂载位', button.x + button.w / 2, button.y + 130, 8, '#8197b3', '400', 'center');
      }
      for (const button of buttons.filter(item => ['hangar:prev', 'hangar:next'].includes(item.id))) {
        this.box(button.x, button.y, button.w, button.h, '#132136', '#30425a', 7);
        this.text(button.label, button.x + button.w / 2, button.y + button.h / 2, 10, button.disabled ? '#3e526d' : '#b4c7e0', '500', 'center');
      }
      this.text((view.page + 1) + ' / 5', W / 2, 498, 11, '#c7d4e6', '500', 'center');
      const model = models[view.selectedLevel - 1];
      this.box(24, 530, 357, 128, '#122238', '#35465f', 10);
      this.hangarThumbnail(model, 76, 590, 83, time);
      this.text('Lv.' + model.level + '  ' + model.title, 129, 551, 16, C.text, '600');
      this.text(model.code + ' · ' + model.mountSlots + ' 个挂载位', 129, 575, 10, accent, '500');
      this.text('可挂载：' + model.weaponTypes.map(type => WEAPONS[type].label).join(' / '), 129, 599, 8, '#a9bbd3');
      this.text(model.level === 1 ? '升级到 Lv.2，开启特殊武器挂载' : '机炮常驻 · 特殊武器并行作战', 129, 621, 9, '#829ab7');
      this.text('只查看外形 · 不影响出击战机', 129, 642, 8, '#6e87a5');
      this.button(buttons.find(item => item.id === 'hangar:close'), true);
    }

    showRewardOffer(item) {
      if (!['bomb', 'support', 'revive'].includes(item)) throw new RangeError('Unknown reward offer: ' + item);
      this.rewardOffer = item;
    }

    hideRewardOffer() { this.rewardOffer = null; }

    rewardButtons() {
      return [
        { id: 'reward:ad', label: '观看广告 · 待开通', x: 51, y: 385, w: 303, h: 49, disabled: true },
        { id: 'reward:purchase', label: '充值获取 · 待开通', x: 51, y: 448, w: 303, h: 49, disabled: true },
        { id: 'reward:close', label: '返回', x: 51, y: 516, w: 303, h: 43, disabled: false },
      ];
    }

    getSceneButtons(game) {
      switch (game.state) {
        case 'menu': return game.savedCheckpoint ? [
          { id: 'hangar', label: '战机图鉴 · 20 级形态', x: 34, y: 463, w: 337, h: 45, disabled: false },
          { id: 'continue', label: game.savedCheckpoint.phase === 'upgrade' ? '继续选择过关补给' : '继续第 ' + (game.savedCheckpoint.stage + 1) + ' 关', x: 34, y: 558, w: 337, h: 45, disabled: false },
          { id: 'start', label: '驾驶战机重新出击', x: 34, y: 614, w: 337, h: 49, disabled: false },
        ] : [
          { id: 'hangar', label: '战机图鉴 · 20 级形态', x: 34, y: 463, w: 337, h: 45, disabled: false },
          { id: 'start', label: '驾驶战机出击', x: 34, y: 567, w: 337, h: 57, disabled: false },
        ];
        case 'launching':
        case 'ejecting': return [this.pauseButton()];
        case 'playing': return [this.pauseButton(), ...this.abilityButtons(game)];
        case 'paused': return [
          { id: 'resume', label: '继续出击', x: 53, y: 403, w: 299, h: 54, disabled: false },
          { id: 'home', label: '返回首页', x: 53, y: 470, w: 299, h: 47, disabled: false },
        ];
        case 'upgrade': return game.upgradeOptions.map((option, i) => ({
          id: 'upgrade:' + option.id, label: option.title, x: 29, y: 283 + i * 86, w: 347, h: 74, disabled: false,
        }));
        case 'gameover': return [
          { id: 'revive', label: '原地复活 · 广告 / 充值', x: 53, y: 454, w: 299, h: 41, disabled: false },
          { id: 'restart', label: '重新出击', x: 53, y: 508, w: 299, h: 48, disabled: false },
          { id: 'home', label: '返回首页', x: 53, y: 569, w: 299, h: 43, disabled: false },
        ];
        case 'victory': return [
          { id: 'restart', label: game.state === 'victory' ? '再次出击' : '重新出击', x: 53, y: 458, w: 299, h: 54, disabled: false },
          { id: 'home', label: '返回首页', x: 53, y: 525, w: 299, h: 47, disabled: false },
        ];
        default: throw new Error('Unknown render state: ' + game.state);
      }
    }

    draw(game, timeSeconds) {
      if (!Number.isFinite(timeSeconds)) throw new TypeError('Renderer.draw requires a finite timeSeconds');
      const ctx = this.ctx;
      const time = game.state === 'menu' ? timeSeconds : game.totalTime;
      const scene = game.state === 'paused' ? game.pausedFrom : game.state;
      ctx.save();
      this.background(game, this.backgroundTime(game, timeSeconds));
      if (this.hangar) { this.hangarScene(timeSeconds); ctx.restore(); return; }
      if (game.state === 'menu') this.menu(game, timeSeconds);
      else if (scene === 'launching' || scene === 'ejecting') {
        if (scene === 'launching') this.launchScene(game);
        else { this.world(game, time, false); this.ejectionScene(game); this.hud(game); }
        if (game.state === 'paused') this.overlay(game);
        else if (scene === 'launching') this.button(this.pauseButton());
      } else {
        ctx.save();
        if (game.state === 'playing' && game.shake > 0) ctx.translate(Math.sin(timeSeconds * 119) * game.shake, Math.cos(timeSeconds * 137) * game.shake * 0.6);
        this.world(game, time); ctx.restore();
        if (game.bombTime > 0) this.bombWave(game);
        this.hud(game);
        if (game.state === 'playing') this.playingLabels(game);
        else this.overlay(game);
        if (game.state === 'playing' && game.damageFlash > 0) {
          ctx.fillStyle = 'rgba(255, 91, 69, ' + Math.min(0.22, game.damageFlash * 0.6) + ')';
          ctx.fillRect(0, 0, W, H);
        }
      }
      if (this.rewardOffer) this.rewardPanel();
      ctx.restore();
    }

    rewardPanel() {
      const item = this.rewardOffer;
      const title = item === 'revive' ? '原地复活' : item === 'support' ? '获取救援' : '获取轰炸弹';
      const ctx = this.ctx;
      ctx.fillStyle = 'rgba(2,7,17,0.9)'; ctx.fillRect(0, 0, W, H);
      this.box(29, 177, 347, 410, '#101d30', '#526178', 18);
      this.text('补 给 通 道', W / 2, 218, 9, C.gold, '500', 'center');
      this.text(title, W / 2, 253, 26, C.text, '600', 'center');
      this.text(item === 'revive' ? '死亡后本局成长已清空' : '本局免费次数已用尽', W / 2, 294, 12, '#a6b8cf', '500', 'center');
      this.text(item === 'revive' ? '原地续战需广告奖励或充值资格' : '救援和轰炸弹每局各免费一次', W / 2, 320, 11, '#c9b590', '400', 'center');
      this.text(item === 'revive' ? '广告与充值尚未接入，暂不能复活' : '追加道具需广告或充值，通道待开通', W / 2, 345, 10, '#8d9fb9', '400', 'center');
      for (const button of this.rewardButtons()) this.button(button, true);
    }

    pilot(x, y, scale, time, pose, alpha) {
      const ctx = this.ctx;
      const running = pose === 'run';
      const swing = running ? Math.sin(time * 23) : 0;
      ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale); ctx.globalAlpha = alpha;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (running) ctx.rotate(0.12);
      this.box(-9, -16, 7, 14, '#445d76', '#adc6d9', 2);
      const knee = swing * 6;
      this.line(-3, -3, -4 + knee, 5, '#738a9b', 5);
      this.line(-4 + knee, 5, -6 - knee, 12, '#adc4ce', 4.5);
      this.box(-9 - knee, 10, 8, 4, '#142a40', '#688b9f', 1.5);
      this.line(3, -3, 4 - knee, 5, '#d6e1dd', 5);
      this.line(4 - knee, 5, 6 + knee, 12, '#f3f2df', 4.5);
      this.box(3 + knee, 10, 8, 4, '#193349', '#adc9d3', 1.5);
      const suit = ctx.createLinearGradient(-5, -19, 6, 0);
      suit.addColorStop(0, '#f1f0df'); suit.addColorStop(0.55, '#c5d8dd'); suit.addColorStop(1, '#7c9cac');
      this.box(-6, -19, 12, 18, suit, '#e0edf0', 3);
      this.line(-5, -5, 5, -5, '#425a70', 2);
      this.box(-3, -15, 6, 6, '#224861', '#7ebcd2', 1.5);
      this.circle(0.5, -12, 1, '#99efff');
      const raised = pose === 'eject' || pose === 'jump';
      this.line(-5, -16, -10 - swing * 3, raised ? -21 : -9 - swing * 4, '#a4bbc6', 4);
      this.line(-10 - swing * 3, raised ? -21 : -9 - swing * 4, -12, raised ? -27 : -3 - swing * 5, '#e1e7dc', 3.5);
      this.line(5, -16, 10 + swing * 3, raised ? -21 : -9 + swing * 4, '#f1efdc', 4);
      this.line(10 + swing * 3, raised ? -21 : -9 + swing * 4, 12, raised ? -27 : -3 + swing * 5, '#d7e5de', 3.5);
      this.circle(0, -25, 8, '#dce8e8', '#7696af', 1.2);
      this.box(-6, -29, 13, 8, '#123b59', '#7ac9eb', 3.5);
      this.line(-3.5, -27, 3.5, -27, '#9aefff', 1.2);
      this.box(-2, -34, 4, 3, '#c9a466', null, 1);
      this.circle(-7, -24, 2, '#49677a');
      ctx.restore();
    }

    launchScene(game) {
      const t = game.cinematicTime;
      const duration = game.launchDuration;
      if (!Number.isFinite(t) || t < 0 || !Number.isFinite(duration) || duration <= 1.8) throw new RangeError('Invalid launch animation clock');
      const ctx = this.ctx;
      const lift = smooth((t - 1.8) / (duration - 1.8));
      const deckFade = 1 - smooth((lift - 0.36) / 0.64);
      const model = Aircraft.getPlayerModel(game.progression.level);
      const appearance = model.appearance.index;
      const frame = this.appearanceFrame(model.appearance);
      const localWidth = 75 + appearance * 0.65;
      const localHeight = localWidth * frame.h / frame.w;
      const cockpitY = -localHeight * (0.15 - appearance * 0.006);
      const shipX = W / 2 + (game.player.x - W / 2) * lift;
      const shipY = 426 + (game.player.y - 426) * lift;
      const shipScale = 1.8 - lift;
      ctx.save(); ctx.translate(0, lift * 610); ctx.globalAlpha = deckFade;
      const deck = ctx.createLinearGradient(0, 272, 0, H);
      deck.addColorStop(0, '#263c50'); deck.addColorStop(0.34, '#182c3e'); deck.addColorStop(1, '#0b182b');
      polygon(ctx, [[76, 276], [329, 276], [430, 720], [-25, 720]], deck, '#526c82');
      polygon(ctx, [[91, 289], [314, 289], [382, 683], [23, 683]], '#13273a', '#365167');
      for (let i = 0; i < 6; i += 1) {
        const y = 310 + i * 64;
        this.line(73 - i * 10, y, 332 + i * 10, y, '#294459', 1);
        this.box(66 - i * 10, y - 2, 5, 13, '#83d8e8', null, 1);
        this.box(334 + i * 10, y - 2, 5, 13, '#83d8e8', null, 1);
      }
      this.line(117, 299, 69, 674, '#567186', 1);
      this.line(288, 299, 336, 674, '#567186', 1);
      ctx.save(); ctx.translate(W / 2, 457); ctx.scale(1, 0.57);
      this.circle(0, 0, 104, '#19354a', '#7596a4', 1.8);
      this.circle(0, 0, 94, null, '#314f63', 7);
      this.circle(0, 0, 84, null, '#b39b6c', 1); ctx.restore();
      for (const side of [-1, 1]) {
        this.line(W / 2 + side * 87, 425, W / 2 + side * 99, 446, '#e0bf80', 3);
        this.line(W / 2 + side * 99, 446, W / 2 + side * 89, 467, '#e0bf80', 3);
      }
      this.text('01', W / 2, 561, 42, '#2c4b61', '600', 'center');
      this.text('星 港 发 射 区', W / 2, 616, 10, '#849daa', '500', 'center');
      for (let i = 0; i < 4; i += 1) this.box(187, 298 + i * 18, 31, 3, '#ab965e', null, 1);
      ctx.restore();
      if (lift > 0) {
        const thrust = Math.sin(lift * Math.PI);
        const tail = shipY + localHeight * shipScale * 0.34;
        const flame = ctx.createLinearGradient(0, tail, 0, tail + 30 + thrust * 85);
        flame.addColorStop(0, 'rgba(211,250,255,' + thrust * 0.85 + ')');
        flame.addColorStop(0.23, 'rgba(58,189,255,' + thrust * 0.63 + ')');
        flame.addColorStop(1, 'rgba(37,113,246,0)');
        polygon(ctx, [[shipX - 9, tail], [shipX, tail + 35 + thrust * 80], [shipX + 9, tail]], flame);
        this.glow(shipX, tail + 8, 28 + thrust * 16, 'rgba(67,193,255,' + thrust * 0.24 + ')');
      }
      this.aircraft(shipX, shipY, shipScale, t, false, 1, game.progression.level);
      if (t < 2.05) {
        const closed = smooth((t - 1.65) / 0.38);
        ctx.save(); ctx.translate(shipX, shipY); ctx.scale(shipScale, shipScale);
        this.box(-5.8, cockpitY - 8, 11.6, 17, '#081b2b', '#adc7d4', 5);
        ctx.save(); ctx.translate((1 - closed) * 15, -(1 - closed) * 5);
        const glass = ctx.createLinearGradient(-5, cockpitY - 8, 5, cockpitY + 8);
        glass.addColorStop(0, '#97e6f3'); glass.addColorStop(0.28, '#2f89b1'); glass.addColorStop(1, '#103852');
        this.box(-5, cockpitY - 8, 10, 16, glass, '#c6e3e7', 5);
        this.line(-2.5, cockpitY - 4, -2.5, cockpitY + 3, '#a7eff5', 0.8);
        ctx.restore(); ctx.restore();
      }
      if (t < 1.1) {
        const run = clamp01(t / 1.1);
        const x = 61 + 105 * run;
        const y = 556 - 93 * run - Math.abs(Math.sin(t * 23)) * 2;
        ctx.save(); ctx.globalAlpha = 0.3; ctx.translate(x, y + 13); ctx.scale(1, 0.3); this.circle(0, 0, 14, '#000711'); ctx.restore();
        this.pilot(x, y, 0.94, t, 'run', 1);
      } else if (t < 1.8) {
        const jump = clamp01((t - 1.1) / 0.7);
        const x = 166 + (shipX - 166) * jump;
        const y = 463 + (shipY + cockpitY * shipScale + 6 - 463) * jump - Math.sin(jump * Math.PI) * 48;
        this.pilot(x, y, 0.94 - smooth(jump) * 0.49, t, 'jump', 1 - smooth((jump - 0.78) / 0.22));
      }
      const title = t < 1.1 ? '准备出击' : t < 1.8 ? '飞行员就位' : '起飞';
      const subtitle = t < 1.1 ? '奔赴座舱，群星正等待你的到来' : t < 1.8 ? '座舱锁定 · 航行系统就绪' : '离开星港 · 前往作战空域';
      ctx.save(); ctx.globalAlpha = 1 - smooth((lift - 0.75) / 0.25);
      this.text('F L I G H T   S E Q U E N C E', W / 2, 104, 9, C.gold, '500', 'center');
      this.text(title, W / 2, 143, 29, '#edf4fc', '600', 'center');
      this.text(subtitle, W / 2, 179, 11, '#9bb3ca', '400', 'center');
      this.text(game.progression.title + '  /  LV. ' + game.progression.level, W / 2, 221, 10, '#b9d2e4', '500', 'center');
      const step = t < 1.1 ? 0 : t < 1.8 ? 1 : 2;
      ['登机', '座舱锁定', '发射'].forEach((label, i) => {
        const x = 100 + i * 102.5;
        this.box(x - 31, 660, 62, 2, i <= step ? '#b9a16e' : '#263b51', null, 1);
        this.text(label, x, 678, 9, i === step ? '#e8cf9a' : '#7590a7', '500', 'center');
      });
      ctx.restore();
    }

    ejectionScene(game) {
      const t = game.cinematicTime;
      if (!Number.isFinite(t) || t < 0 || !Number.isFinite(game.ejectionDuration) || game.ejectionDuration <= 0) throw new RangeError('Invalid ejection animation clock');
      const ctx = this.ctx;
      const p = game.player;
      ctx.fillStyle = 'rgba(3,10,21,0.28)'; ctx.fillRect(0, 0, W, H);
      const model = Aircraft.getPlayerModel((game.resultProgression || game.progression).level);
      const wreckFade = 1 - smooth((t - 0.7) / 1.1);
      if (wreckFade > 0) {
        ctx.save(); ctx.translate(p.x + Math.sin(t * 6) * 2, p.y + t * 28); ctx.rotate(t * 0.2); ctx.globalAlpha = wreckFade;
        this.airframe(model.appearance, (75 + model.appearance.index * 0.65) * 0.8, t);
        this.glow(0, 2, 29, 'rgba(255,124,62,' + Math.max(0, 0.46 - t * 0.23) + ')');
        this.line(-17, -2, 9, 8, '#ffb57b', 1.5);
        this.line(9, 8, 13, 23, '#6e392f', 2);
        ctx.restore();
      }
      for (let i = 0; i < 7; i += 1) {
        const age = clamp01((t - i * 0.055) / 1.8);
        if (age <= 0 || age >= 1) continue;
        const x = p.x + Math.sin(i * 2.4) * (10 + age * 35);
        const y = p.y + 9 + t * 17 - age * 45 + i * 3;
        this.circle(x, y, 4 + age * 17, 'rgba(81,91,106,' + (1 - age) * 0.3 + ')');
      }
      const travel = smooth(t / 0.9);
      const direction = p.x > W / 2 ? -1 : 1;
      const targetX = Math.max(82, Math.min(W - 82, p.x + direction * 88));
      const targetY = Math.max(218, Math.min(504, p.y - 112));
      const px = p.x + (targetX - p.x) * travel + Math.sin(t * 3) * Math.max(0, t - 0.9) * 2;
      const py = p.y - 8 + (targetY - p.y + 8) * travel - Math.sin(travel * Math.PI) * 45 + Math.max(0, t - 0.9) * 8;
      if (t < 0.72) {
        this.glow(px, py + 19, 19, 'rgba(145,218,255,' + (1 - t / 0.72) * 0.3 + ')');
        this.line(px, py + 13, px - direction * 5, py + 24, '#b9efff', 2);
      }
      const canopy = smooth((t - 0.48) / 0.56);
      if (canopy > 0) {
        ctx.save(); ctx.translate(px, py - 37); ctx.scale(canopy, canopy);
        ctx.beginPath(); ctx.moveTo(-39, 0); ctx.bezierCurveTo(-38, -46, 38, -46, 39, 0);
        ctx.quadraticCurveTo(27, -8, 20, 0); ctx.quadraticCurveTo(10, -8, 0, 0);
        ctx.quadraticCurveTo(-10, -8, -20, 0); ctx.quadraticCurveTo(-28, -8, -39, 0); ctx.closePath();
        const cloth = ctx.createLinearGradient(0, -35, 0, 2);
        cloth.addColorStop(0, '#d4eef1'); cloth.addColorStop(0.45, '#65b6d5'); cloth.addColorStop(1, '#254d75');
        ctx.fillStyle = cloth; ctx.fill(); ctx.strokeStyle = '#bddde5'; ctx.lineWidth = 1.3; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, -34); ctx.quadraticCurveTo(-22, -28, -20, 0); ctx.moveTo(0, -34); ctx.quadraticCurveTo(22, -28, 20, 0); ctx.strokeStyle = '#e0c58e'; ctx.lineWidth = 1.2; ctx.stroke();
        [-39, -20, 20, 39].forEach(x => this.line(x, 0, x < 0 ? -10 : 10, 28, 'rgba(213,237,244,0.85)', 0.9));
        this.circle(0, -19, 5, '#214362', '#dfce9e', 1);
        this.line(-2, -19, 2, -19, '#dcefed', 1.2); this.line(0, -21, 0, -17, '#dcefed', 1.2);
        ctx.restore();
      }
      this.pilot(px, py, 0.91, t, 'eject', 1);
      const safe = t >= 1.55;
      this.text(safe ? '飞行员已安全撤离' : '装甲失效 · 紧急弹射', W / 2, 129, 22, safe ? '#d4f1eb' : '#ffcfb3', '600', 'center');
      this.text(safe ? '救援信标已启动，准备返回机库' : '保持冷静，救生系统已启动', W / 2, 162, 11, '#a2b9cf', '400', 'center');
      this.box(143, 188, 119, 2, '#2b4055', null, 1);
      this.box(143, 188, 119 * clamp01(t / 1.55), 2, safe ? '#91cfbf' : '#d9aa79', null, 1);
    }

    backgroundTime(game, renderTime) {
      const scene = game.state === 'paused' ? game.pausedFrom : game.state;
      const source = scene === 'menu' ? 'menu' : scene === 'launching' ? 'launch' : 'combat';
      const value = source === 'menu' ? renderTime : source === 'launch' ? game.cinematicTime : game.totalTime;
      if (!Number.isFinite(value) || value < 0) throw new RangeError('Invalid background clock: ' + source);
      const clock = this.backgroundClock;
      // Accumulate only the active simulation clock; changing scenes never jumps the star field.
      if (clock.source === null) clock.elapsed = source === 'menu' ? 0 : value;
      else if (clock.source === source && value >= clock.previous) clock.elapsed += value - clock.previous;
      clock.source = source; clock.previous = value;
      return clock.elapsed;
    }

    background(game, time) {
      if (!Number.isInteger(game.stageCount) || game.stageCount <= 0 || !Number.isInteger(game.stage) || game.stage < 0 || game.stage >= game.stageCount) {
        throw new RangeError('Unknown background stage: ' + game.stage + '/' + game.stageCount);
      }
      const chapter = game.stageConfig && game.stageConfig.chapter;
      if (!Number.isInteger(chapter) || chapter < 0 || chapter >= SECTORS.length) throw new RangeError('Unknown background chapter: ' + chapter + '; stage=' + game.stage);
      const ctx = this.ctx;
      const layout = this.backgrounds[game.state === 'menu' ? 0 : game.stage];
      if (!layout) throw new RangeError('Missing background layout for stage: ' + game.stage);
      const sector = SECTORS[game.state === 'menu' ? 0 : chapter];
      ctx.fillStyle = sector.sky; ctx.fillRect(0, 0, W, H);
      // Each finite layer wraps only after its entire extent has left the screen.
      // All coordinates and paint colors are reused: no textures, blur filters or per-frame gradients.
      for (const nebula of this.nebulae) {
        const margin = nebula.radius;
        const y = (nebula.y + layout.offsetY + time * 4 + margin) % (H + margin * 2) - margin;
        ctx.save(); ctx.translate(nebula.x, y); ctx.rotate(nebula.angle + layout.angle); ctx.scale(1, nebula.flatten);
        ctx.globalAlpha = 0.023;
        for (let i = 0; i < 6; i += 1) this.circle(-i * 7, i * 3, nebula.radius * (1 - i * 0.095), sector.mist);
        ctx.restore();
      }
      this.landscape(layout, sector, time);
      const radius = sector.radius * layout.radiusScale;
      const margin = radius * (sector.ring ? 1.75 : 1.08);
      const y = (layout.planetY + time * 7 + margin) % (H + margin * 2) - margin;
      ctx.save(); ctx.globalAlpha = game.state === 'menu' ? 0.64 : 0.47;
      this.distantPlanet(layout.planetX, y, radius, sector);
      ctx.restore();
      const moonY = (586 + layout.offsetY + time * 5.5 + 48) % (H + 96) - 48;
      const moonX = layout.planetX < W / 2 ? 363 : 16;
      ctx.save(); ctx.globalAlpha = 0.34;
      this.circle(moonX, moonY, 43, sector.moon);
      ctx.beginPath(); ctx.arc(moonX, moonY, 43, 0, Math.PI * 2); ctx.clip();
      this.circle(moonX + 17, moonY + 7, 38, sector.sky);
      this.circle(moonX - 14, moonY - 12, 5, sector.sky);
      this.circle(moonX - 18, moonY + 9, 3, sector.sky);
      ctx.restore();
      for (const star of this.stars) {
        const starY = (star.y + layout.offsetY + time * star.speed + 4) % (H + 8) - 4;
        const starX = (star.x + layout.offsetX) % W;
        ctx.globalAlpha = star.alpha;
        ctx.fillStyle = star.accent ? sector.accent : sector.star;
        ctx.fillRect(starX, starY, star.size, star.size);
        if (star.cross) {
          ctx.globalAlpha = star.alpha * 0.42;
          this.line(starX - 3, starY, starX + 3.5, starY, sector.star, 0.6);
          this.line(starX, starY - 3, starX, starY + 3.5, sector.star, 0.6);
        }
      }
      ctx.globalAlpha = 1;
    }

    landscape(layout, sector, time) {
      const ctx = this.ctx; const v = layout.variant;
      ctx.save();
      if (layout.chapter === 0) {
        // Navigation trails remain recognizable even in the first ten levels.
        ctx.globalAlpha = 0.14;
        for (let i = 0; i < 4; i += 1) {
          const x = 42 + i * 103 + layout.angle * 95;
          this.line(x - 85, -30, x + 95, H + 30, sector.mist, 15 + (v % 3) * 4);
          this.line(x - 76, -30, x + 104, H + 30, sector.star, 0.75);
          const y = (i * 189 + layout.offsetY + time * 18) % (H + 44) - 22;
          this.line(x - 9 + y * 0.24, y, x + 9 + y * 0.24, y, sector.star, 1.6);
        }
      } else if (layout.chapter === 1) {
        ctx.globalAlpha = 0.16;
        for (let i = 0; i < 3; i += 1) {
          const y = (i * 300 + layout.offsetY + time * 10 + 300) % (H + 600) - 300;
          ctx.save(); ctx.translate(layout.center, y); ctx.rotate(-0.6 + layout.angle); ctx.scale(1, 0.4);
          this.circle(0, 0, 190 + i * 18 + v * 4, null, sector.mist, 16);
          this.circle(0, 0, 183 + i * 18 + v * 4, null, sector.star, 1);
          ctx.restore();
        }
      } else if (layout.chapter === 2 || layout.chapter === 8) {
        const ice = layout.chapter === 8;
        const count = 12 + v % 7;
        for (let i = 0; i < count; i += 1) {
          const object = this.backgroundShapes[i];
          const x = (object.x + layout.offsetX) % W;
          const y = (object.y + layout.offsetY + time * (8 + i % 3 * 3) + 45) % (H + 90) - 45;
          ctx.save(); ctx.translate(x, y); ctx.rotate(object.angle + layout.angle);
          ctx.globalAlpha = ice ? 0.25 : 0.35;
          if (ice) {
            ctx.scale(0.76 + v * 0.025, 1.7);
            ctx.beginPath(); ctx.moveTo(0, -object.radius); ctx.lineTo(object.radius * 0.5, 0);
            ctx.lineTo(0, object.radius); ctx.lineTo(-object.radius * 0.5, 0); ctx.closePath();
            ctx.fillStyle = sector.mist; ctx.fill(); ctx.strokeStyle = sector.star; ctx.lineWidth = 0.8; ctx.stroke();
            this.line(0, -object.radius, 0, object.radius, sector.star, 0.7);
          } else {
            polygon(ctx, object.points, sector.moon, sector.rim);
            this.circle(-object.radius * 0.25, -object.radius * 0.15, object.radius * 0.27, sector.sky);
          }
          ctx.restore();
        }
      } else if (layout.chapter === 3) {
        ctx.globalAlpha = 0.19;
        for (let i = 0; i < 4; i += 1) {
          const radius = 65 + i * 24 + v * 2;
          const y = (i * 226 + layout.offsetY + time * 9 + radius) % (H + radius * 2) - radius;
          const x = i % 2 ? W - layout.center : layout.center;
          ctx.beginPath(); ctx.arc(x, y, radius, layout.angle, Math.PI * 1.68 + layout.angle);
          ctx.strokeStyle = sector.star; ctx.lineWidth = 1.3; ctx.stroke();
          ctx.beginPath(); ctx.arc(x, y, radius - 11, Math.PI * 0.8, Math.PI * 1.6);
          ctx.strokeStyle = sector.mist; ctx.lineWidth = 5; ctx.stroke();
          this.box(x + radius - 7, y - 8, 14, 16, sector.moon, sector.star, 1);
          this.line(x + radius - 15, y, x + radius + 15, y, sector.star, 1);
        }
      } else if (layout.chapter === 4) {
        ctx.globalAlpha = 0.15;
        const gap = 65 + (v % 4) * 9; const offset = (time * 12 + layout.offsetY) % gap;
        for (let y = offset - gap; y <= H + gap; y += gap) this.line(0, y, W, y + 18 + v * 2, sector.star, 0.75);
        for (let x = -H; x < W; x += gap) this.line(x + offset * 0.4, 0, x + H * 0.43 + offset * 0.4, H, sector.mist, 1.2);
        for (let i = 0; i < 4; i += 1) {
          const y = (i * 230 + time * 12 + layout.offsetY + 28) % (H + 56) - 28;
          this.box((i * 137 + layout.offsetX) % W - 20, y, 41, 19, sector.moon, sector.star, 1);
        }
      } else if (layout.chapter === 5) {
        const y = (178 + layout.offsetY + time * 7 + 175) % (H + 350) - 175;
        ctx.save(); ctx.translate(layout.center, y); ctx.rotate(layout.angle);
        ctx.globalAlpha = 0.13;
        for (let i = 0; i < 4; i += 1) {
          this.circle(-75, -45, 98 - i * 17, sector.mist);
          this.circle(88, 52, 68 - i * 10, sector.accent);
        }
        ctx.globalAlpha = 0.23;
        this.circle(-75, -45, 21, sector.star); this.circle(88, 52, 15, sector.accent);
        ctx.save(); ctx.scale(1, 0.47); this.circle(0, 0, 183 + v * 3, null, sector.rim, 1); ctx.restore();
        ctx.restore();
      } else if (layout.chapter === 6) {
        ctx.globalAlpha = 0.11;
        const offset = (layout.offsetY + time * 9) % H;
        for (let i = 0; i < 5; i += 1) {
          const x = 32 + i * 89 + layout.angle * 55;
          for (let tile = -1; tile <= 0; tile += 1) {
            const y = offset + tile * H;
            ctx.beginPath(); ctx.moveTo(x - 50, y);
            ctx.bezierCurveTo(x + 90, y + H / 3, x - 190, y + H * 2 / 3, x - 50, y + H);
            ctx.strokeStyle = sector.mist; ctx.lineWidth = 26 + v % 3 * 4; ctx.stroke();
            ctx.strokeStyle = sector.star; ctx.lineWidth = 1; ctx.stroke();
          }
        }
      } else if (layout.chapter === 7) {
        const y = (282 + layout.offsetY + time * 8 + 270) % (H + 540) - 270;
        ctx.save(); ctx.translate(layout.center, y); ctx.rotate(layout.angle + v * 0.15);
        ctx.scale(1 + v * 0.025, 1 + v * 0.025); ctx.globalAlpha = 0.19;
        for (const arm of this.spiralArms) {
          ctx.beginPath(); ctx.moveTo(arm[0][0], arm[0][1]);
          for (let i = 1; i < arm.length; i += 1) ctx.lineTo(arm[i][0], arm[i][1]);
          ctx.strokeStyle = sector.mist; ctx.lineWidth = 13; ctx.stroke();
          ctx.strokeStyle = sector.star; ctx.lineWidth = 1; ctx.stroke();
          for (let i = 4; i < arm.length; i += 5) this.circle(arm[i][0], arm[i][1], 1.7, sector.accent);
        }
        this.circle(0, 0, 25, sector.mist); this.circle(0, 0, 7, sector.star);
        ctx.restore();
      } else if (layout.chapter === 9) {
        ctx.globalAlpha = 0.16;
        const offset = (time * 17 + layout.offsetY) % 210;
        for (let i = 0; i < 7; i += 1) {
          const y = -240 + i * 210 + offset;
          ctx.beginPath(); ctx.moveTo(-25, y + 20); ctx.bezierCurveTo(155, y - 63 - v * 3, 244, y + 73, W + 30, y - 41);
          ctx.strokeStyle = sector.mist; ctx.lineWidth = 23; ctx.stroke();
          ctx.strokeStyle = sector.accent; ctx.lineWidth = 1.1; ctx.stroke();
        }
        ctx.globalAlpha = 0.23;
        const sunY = (135 + layout.offsetY + time * 7 + 32) % (H + 64) - 32;
        this.circle(layout.center, sunY, 20 + v, sector.mist);
        this.circle(layout.center, sunY, 10 + v * 0.3, sector.accent);
      } else throw new RangeError('Unknown landscape chapter: ' + layout.chapter);
      ctx.restore();
    }

    distantPlanet(x, y, radius, sector) {
      const ctx = this.ctx;
      ctx.save(); ctx.translate(x, y); ctx.scale(radius, radius);
      if (sector.ring) {
        ctx.save(); ctx.rotate(-0.38); ctx.scale(1, 0.32);
        this.circle(0, 0, 1.51, null, '#554467', 0.18);
        this.circle(0, 0, 1.65, null, '#98819d', 0.025);
        this.circle(0, 0, 1.35, null, '#90748e', 0.045);
        ctx.restore();
      }
      this.circle(0, 0, 1, sector.planet[0]);
      ctx.save(); ctx.beginPath(); ctx.arc(0, 0, 0.998, 0, Math.PI * 2); ctx.clip();
      for (let i = 1; i < 4; i += 1) this.circle(-i * 0.105, -i * 0.075, 1.02 - i * 0.09, sector.planet[i]);
      ctx.globalAlpha *= 0.35;
      for (let i = 0; i < 5; i += 1) {
        const bandY = -0.7 + i * 0.3;
        ctx.beginPath(); ctx.moveTo(-1, bandY);
        ctx.bezierCurveTo(-0.15, bandY + 0.29, 0.28, bandY - 0.04, 1, bandY + 0.27);
        ctx.strokeStyle = sector.band; ctx.lineWidth = i % 2 === 0 ? 0.026 : 0.064; ctx.stroke();
      }
      for (const crater of this.terrain) this.circle(crater.x, crater.y, crater.r, sector.planet[0], sector.rim, 0.005);
      ctx.restore();
      ctx.beginPath(); ctx.arc(0, 0, 1, Math.PI * 0.84, Math.PI * 1.65);
      ctx.strokeStyle = sector.rim; ctx.lineWidth = 0.008; ctx.stroke();
      if (sector.ring) {
        ctx.save(); ctx.rotate(-0.38); ctx.scale(1, 0.32);
        ctx.beginPath(); ctx.arc(0, 0, 1.51, 0, Math.PI);
        ctx.strokeStyle = '#8f799b'; ctx.lineWidth = 0.11; ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, 1.64, 0, Math.PI);
        ctx.strokeStyle = '#b8a3b4'; ctx.lineWidth = 0.018; ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
    }

    planetSurface(x, y, radius, kind, phase) {
      const ctx = this.ctx;
      const colors = kind === 'hostile' ? ['#df9a68', '#964631', '#351d27', '#140e1b']
        : kind === 'gray' ? ['#8695ab', '#495367', '#1c2437', '#090f20']
          : ['#78a7cc', '#34557e', '#162e53', '#070e23'];
      this.glow(x - radius * 0.3, y - radius * 0.25, radius * 1.07,
        kind === 'hostile' ? 'rgba(253,108,48,0.14)' : 'rgba(111,177,232,0.09)');
      const surface = ctx.createRadialGradient(x - radius * 0.49, y - radius * 0.5, radius * 0.06, x + radius * 0.15, y + radius * 0.1, radius * 1.18);
      surface.addColorStop(0, colors[0]); surface.addColorStop(0.37, colors[1]); surface.addColorStop(0.72, colors[2]); surface.addColorStop(1, colors[3]);
      this.circle(x, y, radius, surface);
      ctx.save(); ctx.beginPath(); ctx.arc(x, y, radius - 0.5, 0, Math.PI * 2); ctx.clip();
      for (let i = 0; i < 8; i += 1) {
        const cy = y - radius + i * radius * 0.29;
        ctx.beginPath(); ctx.moveTo(x - radius, cy);
        ctx.bezierCurveTo(x - radius * 0.1, cy + radius * 0.26, x + radius * 0.34, cy - radius * 0.14, x + radius, cy + radius * 0.28);
        ctx.strokeStyle = i % 2 === 0 ? 'rgba(199,211,239,0.09)' : 'rgba(4,13,38,0.2)';
        ctx.lineWidth = radius * (i % 2 === 0 ? 0.035 : 0.075); ctx.stroke();
      }
      for (let i = 0; i < 11; i += 1) {
        const a = i * 2.4 + phase;
        const distance = radius * (0.24 + (i % 4) * 0.18);
        const cx = x + Math.cos(a) * distance;
        const cy = y + Math.sin(a) * distance * 0.87;
        const r = radius * (0.04 + (i % 3) * 0.029);
        this.circle(cx, cy, r, 'rgba(1,8,21,0.16)', 'rgba(214,211,193,0.06)', 0.7);
      }
      const shadow = ctx.createLinearGradient(x - radius, y - radius, x + radius * 0.85, y + radius * 0.4);
      shadow.addColorStop(0, 'rgba(0,0,0,0)'); shadow.addColorStop(0.53, 'rgba(1,6,18,0.03)'); shadow.addColorStop(1, 'rgba(1,4,13,0.86)');
      ctx.fillStyle = shadow; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      ctx.restore();
      ctx.beginPath(); ctx.arc(x, y, radius, Math.PI * 0.83, Math.PI * 1.63);
      ctx.strokeStyle = kind === 'hostile' ? 'rgba(255,197,130,0.53)' : 'rgba(173,212,250,0.34)'; ctx.lineWidth = 1; ctx.stroke();
    }

    sprite(sheet, frame, width) {
      const height = width * frame.h / frame.w;
      if (frame.regions) {
        const scale = width / frame.w;
        for (const region of frame.regions) {
          this.ctx.drawImage(this.assets.images[sheet], region.x, region.y, region.w, region.h,
            -width / 2 + (region.x - frame.x) * scale, -height / 2 + (region.y - frame.y) * scale,
            region.w * scale, region.h * scale);
        }
        return;
      }
      this.ctx.drawImage(this.assets.images[sheet], frame.x, frame.y, frame.w, frame.h,
        -width / 2, -height / 2, width, height);
    }

    appearanceFrame(appearance) {
      if (!appearance || !['player', 'enemies', 'warships', 'enemyVariants', 'fleet'].includes(appearance.sheet)
        || !Number.isInteger(appearance.index) || !Number.isFinite(appearance.rotation) || !Number.isInteger(appearance.variant)) {
        throw new TypeError('Invalid aircraft appearance descriptor');
      }
      const maxVariant = appearance.sheet === 'player' ? 10 : appearance.sheet === 'fleet' ? 6 : 2;
      if (appearance.variant < 0 || appearance.variant > maxVariant) throw new RangeError('Unknown aircraft silhouette module: ' + appearance.sheet + '/' + appearance.variant);
      const frame = this.assets.frames[appearance.sheet][appearance.index];
      if (!frame) throw new RangeError('Unknown aircraft sprite: ' + appearance.sheet + '[' + appearance.index + ']');
      return frame;
    }

    airframe(appearance, width, time) {
      const frame = this.appearanceFrame(appearance);
      if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(time)) throw new RangeError('Aircraft drawing requires a positive width and finite clock');
      const ctx = this.ctx;
      const height = width * frame.h / frame.w;
      const sideways = appearance.sheet === 'fleet';
      const hostile = appearance.sheet !== 'player';
      ctx.save(); ctx.rotate(appearance.rotation);
      if (appearance.variant > 0) {
        ctx.save();
        if (sideways) ctx.rotate(Math.PI / 2);
        ctx.scale((sideways ? height : width) / 100, (sideways ? width : height) / 125);
        this.airframeModules(appearance.sheet, appearance.variant);
        ctx.restore();
      }
      this.glow(sideways ? -width * 0.37 : 0, sideways ? 0 : height * 0.37,
        Math.min(18, width * 0.14), hostile ? 'rgba(255,85,31,0.19)' : 'rgba(40,172,255,0.25)');
      this.sprite(appearance.sheet, frame, width);
      ctx.restore();
    }

    airframeModules(sheet, variant) {
      // Small geometric attachments reuse decoded sprites. They change the
      // outline at all scales and use the same path in the archive and battle.
      const ctx = this.ctx;
      const hostile = sheet !== 'player';
      const metal = hostile ? '#343840' : '#566777';
      const dark = hostile ? '#171d28' : '#1d2a38';
      const face = hostile ? '#51535b' : '#8c9cac';
      const edge = hostile ? '#87767b' : '#b1c1d0';
      const accent = hostile ? '#ff5b43' : '#54d5ff';
      const kind = sheet === 'fleet' ? [0, 3, 5, 4, 9, 6, 10][variant]
        : hostile ? (variant === 1 ? 5 : 8) : variant;
      ctx.scale(0.9, 0.93);
      ctx.lineWidth = 0.8;
      const wings = points => {
        for (const side of [-1, 1]) {
          ctx.beginPath();
          points.forEach(([x, y], index) => { if (index === 0) ctx.moveTo(x * side, y); else ctx.lineTo(x * side, y); });
          ctx.closePath(); ctx.fillStyle = metal; ctx.fill(); ctx.strokeStyle = edge; ctx.stroke();
          const start = points[0], end = points[1], tip = points[2], rear = points[points.length - 1];
          const hingeX = (start[0] + rear[0]) / 2, hingeY = (start[1] + rear[1]) / 2;
          // Separate flat metal faces and recessed seams match the sprite's
          // panel language without per-frame textures or blurred shading.
          ctx.beginPath(); ctx.moveTo(start[0] * side, start[1]); ctx.lineTo(end[0] * side, end[1]);
          ctx.lineTo(hingeX * side, hingeY); ctx.closePath(); ctx.fillStyle = face; ctx.fill();
          ctx.beginPath(); ctx.moveTo(hingeX * side, hingeY); ctx.lineTo(tip[0] * side, tip[1]);
          ctx.lineTo(rear[0] * side, rear[1]); ctx.closePath(); ctx.fillStyle = dark; ctx.fill();
          this.line(hingeX * side, hingeY, tip[0] * side, tip[1], '#0e1824', 1);
          this.line(start[0] * side, start[1], rear[0] * side, rear[1], dark, 2);
          this.line((start[0] + 3) * side, start[1] + 2, (end[0] - 4) * side, end[1] + 3, accent, 1.1);
          const insetX = (end[0] * 0.58 + hingeX * 0.42) * side;
          const insetY = end[1] * 0.58 + hingeY * 0.42;
          this.line(insetX, insetY - 2, insetX - side * 7, insetY + 2, dark, 1.1);
          this.line(insetX, insetY + 2, insetX - side * 7, insetY + 6, dark, 1.1);
        }
      };
      const pod = (x, y, w, h) => {
        polygon(ctx, [[x, y - h / 2], [x + w / 2, y - h / 2 + 8], [x + w / 2, y + h / 2 - 5],
          [x, y + h / 2], [x - w / 2, y + h / 2 - 5], [x - w / 2, y - h / 2 + 8]], dark, edge);
        polygon(ctx, [[x - w * 0.32, y - h / 2 + 9], [x, y - h / 2 + 4],
          [x, y + h / 2 - 9], [x - w * 0.32, y + h / 2 - 13]], metal);
        this.line(x - w * 0.32, y - h / 2 + 10, x - w * 0.32, y + h / 2 - 14, face, 0.7);
        this.line(x, y - h / 2 + 9, x, y + h / 2 - 8, accent, 1.2);
        this.line(x - w * 0.4, y + h * 0.15, x + w * 0.4, y + h * 0.15, '#0e1824', 1.2);
        polygon(ctx, [[x - w * 0.23, y + h / 2 - 3], [x, y + h / 2 + 7], [x + w * 0.23, y + h / 2 - 3]], accent);
      };
      switch (kind) {
        case 1: // Forward canards make a wide, pointed shoulder.
          wings([[15, -30], [66, -53], [55, -23], [22, -6]]);
          break;
        case 2: // Two long wingtip fins.
          wings([[27, -6], [65, -28], [57, 51], [36, 30]]);
          for (const side of [-1, 1]) pod(side * 57, -13, 9, 56);
          break;
        case 3: // Four separated propulsion pods.
          wings([[20, 8], [65, 17], [63, 35], [16, 27]]);
          for (const side of [-1, 1]) { pod(side * 49, 20, 15, 57); pod(side * 67, 29, 10, 38); }
          break;
        case 4: // An orbital collar extends beyond both wings.
          ctx.save(); ctx.scale(1, 0.62);
          this.circle(0, 5, 66, null, dark, 9);
          this.circle(0, 5, 66, null, edge, 1);
          this.circle(0, 5, 61, null, accent, 1.7); ctx.restore();
          wings([[20, 0], [64, -12], [64, 15], [19, 23]]);
          break;
        case 5: // Twin lances project well ahead of the main wings.
          wings([[16, -20], [52, -63], [61, 29], [35, 43]]);
          for (const side of [-1, 1]) pod(side * 53, -21, 12, 74);
          break;
        case 6: // Rear engine banks with a broad horizontal tail.
          wings([[19, 16], [72, 30], [63, 58], [15, 39]]);
          for (const side of [-1, 1]) { pod(side * 39, 46, 17, 36); pod(side * 59, 47, 14, 29); }
          break;
        case 7: // Three stepped blades on each wing.
          wings([[22, -23], [66, -38], [51, -8], [71, -1], [52, 18], [66, 38], [24, 30]]);
          break;
        case 8: // A large delta wing and two rear stabilisers.
          wings([[12, -51], [74, 42], [46, 32], [35, 58], [18, 26]]);
          for (const side of [-1, 1]) this.line(side * 34, 4, side * 60, 33, accent, 2);
          break;
        case 9: // Long parallel booms leave a recognisable open middle.
          wings([[22, -9], [59, -19], [59, 28], [22, 31]]);
          for (const side of [-1, 1]) pod(side * 58, 7, 15, 103);
          break;
        case 10: // Swept crescent wings with four forward and rear pods.
          wings([[15, -26], [51, -67], [76, -43], [64, -5], [76, 29], [45, 55], [24, 31]]);
          for (const side of [-1, 1]) { pod(side * 57, -30, 12, 33); pod(side * 48, 41, 15, 37); }
          break;
        default: throw new RangeError('No aircraft silhouette geometry for ' + sheet + '/' + variant);
      }
    }

    aircraft(x, y, scale, time, shield, alpha, level) {
      const model = Aircraft.getPlayerModel(level);
      const ctx = this.ctx;
      const width = 75 + model.appearance.index * 0.65;
      ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale); ctx.globalAlpha = alpha;
      if (shield) {
        this.glow(0, 0, width * 0.69, 'rgba(98,192,255,0.12)');
        this.circle(0, 0, width * 0.62 + Math.sin(time * 4) * 1.5, null, 'rgba(127,200,255,0.58)', 0.9);
      }
      this.airframe(model.appearance, width, time);
      ctx.restore();
    }

    enemy(enemy, time) {
      if (enemy.type === 'planet') { this.hostilePlanet(enemy, time); return; }
      const ctx = this.ctx;
      const large = enemy.type === 'warship' || enemy.type === 'boss';
      if (!['scout', 'striker', 'warship', 'boss'].includes(enemy.type)) throw new Error('No sprite assigned to enemy type: ' + enemy.type);
      const appearance = enemy.appearance;
      if (!appearance || !['enemies', 'warships', 'enemyVariants', 'fleet'].includes(appearance.sheet)
        || !Number.isInteger(appearance.index) || !Number.isFinite(appearance.rotation) || !Number.isInteger(appearance.variant)) {
        throw new Error('Invalid enemy appearance: type=' + enemy.type + '; id=' + enemy.id);
      }
      const sheet = appearance.sheet;
      const frame = this.assets.frames[sheet][appearance.index];
      if (!frame) throw new RangeError('Unknown enemy sprite: ' + sheet + '[' + appearance.index + ']; id=' + enemy.id);
      const extent = enemy.r * (enemy.type === 'boss' ? 3.05 : 2.95);
      const ratio = Math.min(extent / frame.w, extent / frame.h);
      const width = frame.w * ratio;
      const height = frame.h * ratio;
      const sideways = sheet === 'fleet';
      const screenHeight = (sideways ? width : height) * (appearance.variant > 0 ? 1.4 : 1);
      ctx.save(); ctx.translate(enemy.x, enemy.y);
      this.airframe(appearance, width, time);
      if (enemy.hit > 0) {
        this.glow(0, 0, enemy.r * 0.73, 'rgba(255,240,201,0.5)');
        this.line(-8, -4, 7, 6, '#fff0d0', 1.1);
      }
      ctx.restore();
      if (large || enemy.hp < enemy.maxHp) this.enemyHealth(enemy, enemy.type === 'boss' ? 90 : 42, screenHeight / 2 + 8);
    }

    enemyHealth(enemy, width, topOffset) {
      const x = enemy.x - width / 2;
      const y = enemy.y - (topOffset === undefined ? enemy.r + 12 : topOffset);
      this.box(x, y, width, 2.5, '#392b39', null, 1);
      this.box(x, y, width * Math.max(0, enemy.hp / enemy.maxHp), 2.5, '#df946f', null, 1);
      if (enemy.type === 'boss') this.text(enemy.form === 'fighter' ? '王牌战机' : '敌方旗舰', enemy.x, y - 9, 8, '#e2b395', '500', 'center');
    }

    hostilePlanet(enemy, time) {
      const ctx = this.ctx;
      const charge = Math.max(0, Math.min(1, enemy.charge));
      const angle = enemy.aimAngle;
      const r = enemy.r;
      if (charge > 0.03) {
        ctx.save(); ctx.globalAlpha = charge * 0.53;
        this.line(enemy.x, enemy.y, enemy.x + Math.cos(angle) * 850, enemy.y + Math.sin(angle) * 850, '#ff8b68', 1);
        ctx.restore();
      }
      this.planetSurface(enemy.x, enemy.y, r, 'hostile', enemy.t * 0.05);
      ctx.save(); ctx.translate(enemy.x, enemy.y);
      ctx.save(); ctx.rotate(-0.35); ctx.scale(1, 0.46);
      this.circle(0, 0, r + 12, null, '#716477', 2);
      this.circle(0, 0, r + 15, null, 'rgba(193,147,113,0.55)', 0.8);
      ctx.restore();
      const satelliteAngle = enemy.t * 0.47;
      const sx = Math.cos(satelliteAngle) * (r + 12);
      const sy = Math.sin(satelliteAngle) * (r + 12) * 0.46;
      this.box(sx - 5, sy - 4, 10, 8, '#a8a0a0', '#e4b589', 1.5);
      this.line(sx - 12, sy, sx + 12, sy, '#668da8', 2.5);
      ctx.save(); ctx.rotate(angle);
      this.box(7, -8, r - 3, 16, '#4b4458', '#ae9a9e', 3);
      this.box(r - 5, -4, 19, 8, '#25253b', '#d6aaa1', 1.5);
      this.line(15, -5, r - 9, -5, '#dec08e', 1);
      this.glow(r + 13, 0, 11 + charge * 12, 'rgba(255,108,62,' + (0.23 + charge * 0.58) + ')');
      this.circle(r + 12, 0, 2 + charge * 3.3, '#ffe2a7');
      ctx.restore();
      this.circle(0, 0, 10, '#27324a', '#ad9691');
      this.circle(0, 0, 5, charge > 0.2 ? '#ef9a70' : '#bd845e', '#ffcfa0');
      if (enemy.hit > 0) this.glow(-r * 0.3, -r * 0.25, r * 0.9, 'rgba(255,232,173,0.35)');
      ctx.restore();
      this.enemyHealth(enemy, 64);
      if (charge > 0.08) {
        this.text('轨道炮蓄能', enemy.x, enemy.y + r + 25, 8, '#e5a082', '500', 'center');
        this.box(enemy.x - 20, enemy.y + r + 34, 40, 2, '#4d3240', null, 1);
        this.box(enemy.x - 20, enemy.y + r + 34, 40 * charge, 2, '#ffac79', null, 1);
      }
    }

    world(game, time, showPlayer = true) {
      const ctx = this.ctx;
      game.pickups.forEach(p => this.pickup(p));
      game.playerBeams.forEach(beam => this.beam(beam, false));
      game.playerBullets.forEach(b => {
        const weapon = game.player.weaponLevel;
        const support = b.source === 'support';
        const descriptor = WEAPONS[b.kind];
        if (!descriptor || b.kind === 'laser') throw new RangeError('Unknown player projectile kind: ' + b.kind);
        const name = support ? 'energy' : b.kind === 'gun' ? (weapon >= 2 && b.r >= 5 ? 'heavy' : b.vx !== 0 ? 'shard' : 'round') : descriptor.sprite;
        const frame = this.assets.frames.projectiles[name];
        const width = b.r * (b.kind === 'explosive' ? 2.9 : b.kind === 'homing' ? 2.4 : 2);
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(Math.atan2(b.vx, -b.vy));
        if (support) this.line(0, 4, 0, 13, 'rgba(127,239,220,0.42)', 1.2);
        if (b.kind === 'homing') { this.line(0, 6, 0, 25, '#b794ea', 1.5); this.line(-3, 13, 3, 13, '#d7bbff', 1); }
        if (b.kind === 'explosive') { this.circle(0, 0, b.r * 1.75, null, '#ffb273', 1.2); this.line(0, 8, 0, 19, '#ffb273', 2.3); }
        this.sprite('projectiles', frame, width);
        ctx.restore();
      });
      game.enemies.forEach(e => this.enemy(e, time));
      for (const ally of game.allies) {
        this.aircraft(ally.x, ally.y, 0.58, time, false, 0.94, ally.shipLevel);
        this.line(ally.x - 11, ally.y + 28, ally.x - 5, ally.y + 31, '#83d8cb', 1);
        this.line(ally.x + 11, ally.y + 28, ally.x + 5, ally.y + 31, '#83d8cb', 1);
        this.text(ally.side < 0 ? '援 01' : '援 02', ally.x, ally.y + 38, 6.5, '#9cdbd1', '500', 'center');
      }
      const p = game.player;
      if (showPlayer && p.hp > 0) this.aircraft(p.x, p.y, 0.8, time, p.shield > 0,
        p.invincible > 0 && Math.sin(time * 40) > 0.3 ? 0.4 : 1, game.progression.level);
      game.enemyBeams.forEach(beam => this.beam(beam, true));
      game.enemyBullets.forEach(b => {
        if (!['orb', 'plasma', 'bolt', 'homing', 'explosive'].includes(b.kind)) throw new RangeError('Unknown enemy projectile kind: ' + b.kind);
        const name = b.kind === 'plasma' || b.kind === 'explosive' ? 'plasma' : b.kind === 'bolt' || b.kind === 'homing' ? 'enemyBeam' : 'enemyBolt';
        const frame = this.assets.frames.projectiles[name];
        const width = b.r * (b.kind === 'plasma' || b.kind === 'explosive' ? 2.65 : 2.05);
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(Math.atan2(b.vx, -b.vy));
        if (b.kind === 'plasma') this.glow(0, 0, b.r * 1.9, 'rgba(255,101,49,0.2)');
        if (b.kind === 'homing') {
          this.line(0, 6, 0, 25, '#ed8267', 1.3);
          this.line(-5, 7, -2, 3, '#ffb297', 1.4); this.line(5, 7, 2, 3, '#ffb297', 1.4);
        }
        if (b.kind === 'explosive') this.circle(0, 0, b.r * 1.8, null, '#ffb376', 1.2);
        this.sprite('projectiles', frame, width);
        ctx.restore();
      });
      for (const effect of game.weaponEffects) {
        if (effect.kind !== 'explosion') throw new RangeError('Unknown weapon effect kind: ' + effect.kind);
        const fade = clamp01(effect.life / effect.maxLife); const radius = effect.r * (1.1 - fade * 0.7);
        ctx.save(); ctx.globalAlpha = fade * 0.65;
        this.circle(effect.x, effect.y, radius, null, effect.color, 2.5);
        ctx.globalAlpha = fade * 0.16; this.circle(effect.x, effect.y, radius * 0.8, effect.color);
        ctx.restore();
      }
      game.particles.forEach(particle => {
        ctx.globalAlpha = Math.max(0, particle.life / particle.maxLife);
        this.circle(particle.x, particle.y, Math.max(0.1, particle.r), particle.color);
      });
      ctx.globalAlpha = 1;
    }

    pickup(p) {
      const ctx = this.ctx; const weapon = p.type === 'weapon' ? WEAPONS[p.weapon] : null;
      if (p.type === 'weapon' && !weapon) throw new RangeError('Unknown weapon pickup: ' + p.weapon);
      if (!['repair', 'power', 'weapon'].includes(p.type)) throw new RangeError('Unknown pickup type: ' + p.type);
      const color = weapon ? weapon.color : p.type === 'repair' ? '#90e3d1' : C.gold;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.sin(p.t * 3) * 0.12);
      this.circle(0, 0, 17, '#102035', color, 1);
      if (p.type === 'repair') { this.line(-6, 0, 6, 0, color, 2.5); this.line(0, -6, 0, 6, color, 2.5); }
      else if (weapon) {
        if (p.weapon === 'laser') { this.line(0, -11, 0, 11, color, 6); this.line(0, -11, 0, 11, '#e9fbff', 2); }
        else if (p.weapon === 'homing') {
          polygon(ctx, [[0, -10], [4, -3], [3, 8], [-3, 8], [-4, -3]], color);
          this.line(-8, 7, -4, 2, color, 1); this.line(8, 7, 4, 2, color, 1);
        } else if (p.weapon === 'explosive') { this.circle(0, 0, 7, color); this.circle(0, 0, 11, null, color, 1); this.circle(0, 0, 3, '#fff0d3'); }
        else { this.line(-4, -8, -4, 8, color, 3); this.line(4, -8, 4, 8, color, 3); }
      } else polygon(ctx, [[1, -7], [-5, 1], [0, 1], [-1, 7], [5, -1], [0, -1]], color);
      ctx.restore();
      if (weapon) this.text(weapon.label, p.x, p.y + 25, 9, color, '600', 'center');
    }

    beam(beam, hostile) {
      if (![beam.x, beam.y, beam.angle, beam.length, beam.width, beam.t, beam.warning, beam.duration].every(Number.isFinite)
        || beam.length <= 0 || beam.width <= 0 || beam.warning < 0 || beam.duration <= 0) throw new RangeError('Invalid ' + (hostile ? 'enemy' : 'player') + ' beam geometry');
      const ctx = this.ctx; const warning = beam.t < beam.warning;
      const ex = beam.x + Math.cos(beam.angle) * beam.length;
      const ey = beam.y + Math.sin(beam.angle) * beam.length;
      ctx.save();
      if (warning) {
        ctx.globalAlpha = 0.6;
        this.line(beam.x, beam.y, ex, ey, '#f18671', 0.8);
        this.circle(beam.x, beam.y, 7, null, '#ffb9a1', 1.2);
        this.text('光束锁定', beam.x, beam.y - 15, 8, '#ffb9a1', '500', 'center');
      } else {
        const color = hostile ? '#ff694d' : '#51d4ef'; const core = hostile ? '#ffe6c0' : '#e7fbff';
        ctx.globalAlpha = 0.22;
        this.line(beam.x, beam.y, ex, ey, color, beam.width + 8);
        ctx.globalAlpha = 0.87;
        this.line(beam.x, beam.y, ex, ey, color, beam.width);
        this.line(beam.x, beam.y, ex, ey, core, Math.max(1.5, beam.width * 0.32));
        this.circle(beam.x, beam.y, beam.width * 0.52, core);
      }
      ctx.restore();
    }

    bombWave(game) {
      if (!Number.isFinite(game.bombDuration) || game.bombDuration <= 0
        || !Number.isFinite(game.bombTime) || game.bombTime < 0 || game.bombTime > game.bombDuration) {
        throw new RangeError('Invalid bomb effect clock');
      }
      const ctx = this.ctx;
      const progress = 1 - game.bombTime / game.bombDuration;
      const fade = Math.pow(1 - progress, 1.25);
      const radius = 20 + Math.pow(progress, 0.7) * 620;
      const cx = W / 2; const cy = H * 0.46;
      ctx.save();
      ctx.globalAlpha = fade * 0.045; ctx.fillStyle = '#ffe0ae'; ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = fade * 0.16;
      this.circle(cx, cy, radius * 0.91, null, '#f1c586', 10 - progress * 7);
      ctx.globalAlpha = fade * 0.72;
      this.circle(cx, cy, radius, null, '#ffe6bd', 2.5 - progress);
      ctx.globalAlpha = fade * 0.28;
      this.circle(cx, cy, radius * 0.67, null, '#8bd5ec', 1);
      for (let i = 0; i < 10; i += 1) {
        const angle = i * Math.PI / 5;
        const inner = radius + 8; const outer = radius + 15 + progress * 12;
        this.line(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner,
          cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer, '#e7c68e', 1);
      }
      ctx.globalAlpha = Math.min(1, fade * 2);
      this.box(111, 181, 183, 26, 'rgba(20,22,34,0.74)', 'rgba(237,198,144,0.28)', 13);
      this.text('轰炸弹 · 空域已清除', W / 2, 194, 10.5, '#f6d7a6', '500', 'center');
      ctx.restore();
    }

    button(button, secondary) {
      const ctx = this.ctx;
      if (button.disabled && button.id.startsWith('reward:')) {
        this.box(button.x, button.y, button.w, button.h, '#18263b', '#35445b', 10);
        this.text(button.label, button.x + button.w / 2, button.y + button.h / 2, 13, '#7c8fa9', '500', 'center');
        return;
      }
      if (button.id === 'pause') {
        this.box(button.x, button.y, button.w, button.h, 'rgba(8,18,35,0.38)', 'rgba(167,192,223,0.18)', 12);
        ctx.fillStyle = '#b0c3da';
        const cx = button.x + button.w / 2; const cy = button.y + button.h / 2;
        ctx.fillRect(cx - 5, cy - 6, 2.5, 12); ctx.fillRect(cx + 2.5, cy - 6, 2.5, 12);
        return;
      }
      if (button.id === 'support' || button.id === 'bomb') {
        const support = button.id === 'support';
        const available = !button.disabled || button.active;
        const color = available ? support ? '#a2e4d7' : '#e6c58e' : '#617284';
        this.box(button.x, button.y, button.w, button.h, 'rgba(8,18,32,0.72)',
          available ? support ? 'rgba(137,214,200,0.42)' : 'rgba(223,190,133,0.42)' : 'rgba(123,146,174,0.19)', 10);
        const cx = button.x + button.w / 2; const cy = button.y + 13;
        if (support) {
          polygon(ctx, [[cx, cy - 7], [cx - 5, cy + 4], [cx, cy + 2], [cx + 5, cy + 4]], color);
          this.line(cx - 12, cy + 5, cx - 8, cy - 2, color, 1.4);
          this.line(cx + 12, cy + 5, cx + 8, cy - 2, color, 1.4);
          this.line(cx - 13, cy + 5, cx - 7, cy + 5, color, 1.2);
          this.line(cx + 13, cy + 5, cx + 7, cy + 5, color, 1.2);
        } else {
          this.circle(cx, cy, 5, null, color, 1.3);
          this.circle(cx, cy, 1.8, color);
          for (let i = 0; i < 4; i += 1) {
            const angle = i * Math.PI / 2;
            this.line(cx + Math.cos(angle) * 7, cy + Math.sin(angle) * 7,
              cx + Math.cos(angle) * 10, cy + Math.sin(angle) * 10, color, 1.2);
          }
        }
        this.text(button.label, cx, button.y + 31, 10, color, '500', 'center');
        this.text(button.status, cx, button.y + 45, 7.5, available ? '#a1b6ca' : '#53687f', '400', 'center');
        if (button.active) this.circle(button.x + 41, button.y + 8, 2, support ? '#a2e4d7' : '#e6c58e');
        return;
      }
      const fill = ctx.createLinearGradient(button.x, button.y, button.x, button.y + button.h);
      fill.addColorStop(0, secondary ? '#18283d' : '#f1d299');
      fill.addColorStop(1, secondary ? '#111f32' : '#cfa666');
      this.box(button.x, button.y, button.w, button.h, fill, secondary ? '#334860' : '#f7dfb4', 10);
      this.text(button.label, button.x + button.w / 2, button.y + button.h / 2, 16, secondary ? '#b7c7dc' : '#2b2e39', '600', 'center');
      if (!secondary) {
        const x = button.x + button.w - 30; const y = button.y + button.h / 2;
        this.line(x - 6, y, x + 5, y, '#554935', 1.6);
        this.line(x + 1, y - 4, x + 5, y, '#554935', 1.6);
        this.line(x + 1, y + 4, x + 5, y, '#554935', 1.6);
      }
    }

    menu(game, time) {
      const ctx = this.ctx;
      const p = game.progression;
      const model = Aircraft.getPlayerModel(p.level);
      polygon(ctx, [[29, 28], [36, 42], [29, 38], [22, 42]], C.gold);
      this.text('F / E', 46, 35, 11, '#c9d3e4', '600');
      this.text('ORBITAL FIGHTER COMMAND', 376, 35, 7, '#6f85a3', '500', 'right');
      this.text('战机时代', W / 2, 102, 43, '#edf3fb', '600', 'center');
      this.text('F I G H T E R   E R A', W / 2, 142, 11, '#b9a37f', '500', 'center');
      this.text('群星为战场，你是最后的防线', W / 2, 177, 11, '#8396b4', '400', 'center');
      this.text(game.stageCount + ' 关远征  ·  10 大星域', W / 2, 199, 9, '#b29a79', '500', 'center');
      this.glow(W / 2, 317, 132, 'rgba(77,144,223,0.17)');
      ctx.save(); ctx.translate(W / 2, 350); ctx.scale(1, 0.32);
      this.circle(0, 0, 116, null, 'rgba(115,153,194,0.18)', 1);
      this.circle(0, 0, 106, null, 'rgba(115,153,194,0.07)', 1); ctx.restore();
      this.aircraft(W / 2, 298 + Math.sin(time * 1.5) * 3, 2.15, time, false, 1, p.level);
      this.line(41, 284, 77, 284, '#47566d', 0.7);
      this.text('MARK ' + String(p.level).padStart(2, '0'), 37, 269, 8, '#9eaeC3', '500');
      this.text(p.level < 3 ? '离子推进引擎' : '双核离子引擎', 365, 359, 8, '#758cab', '400', 'right');
      this.line(320, 343, 365, 343, '#47566d', 0.7);
      this.text(p.title, W / 2, 410, 20, '#e1e7ef', '500', 'center');
      this.text('LV. ' + p.level + '  /  ' + model.code, W / 2, 435, 9, C.gold, '500', 'center');
      this.text('本局成长 · 失败后重置', 34, 528, 9, '#7c92ae');
      this.text(p.level === Aircraft.MAX_AIRCRAFT_LEVEL ? 'MAX · 已满级' : p.xp + ' / ' + p.nextXp, 371, 528, 9, '#a5b5ca', '500', 'right');
      this.box(34, 544, 337, 3, '#25344a', null, 1.5);
      this.box(34, 544, 337 * this.experienceRatio(p), 3, C.gold, null, 1.5);
      this.getSceneButtons(game).forEach(button => this.button(button, button.id === 'hangar' || button.id === 'start' && Boolean(game.savedCheckpoint)));
      this.text('单指拖动  ·  自动开火  ·  击落敌机升级', W / 2, game.savedCheckpoint ? 678 : 648, 10, '#8295af', '400', 'center');
      this.line(34, game.savedCheckpoint ? 693 : 674, 371, game.savedCheckpoint ? 693 : 674, '#1d2d44');
      this.text('最高纪录', 34, game.savedCheckpoint ? 709 : 694, 9, '#697f9c');
      this.text(String(game.bestScore).padStart(6, '0'), 371, game.savedCheckpoint ? 709 : 694, 12, '#b8c7dc', '500', 'right');
    }

    experienceRatio(progression) {
      Aircraft.getPlayerModel(progression.level);
      if (progression.level === Aircraft.MAX_AIRCRAFT_LEVEL) return 1;
      if (!Number.isFinite(progression.xp) || progression.xp < 0 || !Number.isFinite(progression.nextXp) || progression.nextXp <= 0) {
        throw new RangeError('Invalid experience bar: level=' + progression.level + '; xp=' + progression.xp + '; nextXp=' + progression.nextXp);
      }
      return clamp01(progression.xp / progression.nextXp);
    }

    hud(game) {
      const p = game.progression;
      this.button(this.pauseButton());
      if (game.state === 'playing') for (const button of this.abilityButtons(game)) this.button(button);
      this.text('等级', 22, 77, 8, '#8aa2c0', '500', 'center');
      this.text(p.level, 22, 96, 17, '#dce9fb', '600', 'center');
      this.box(10, 113, 24, 3, '#25334a', null, 1.5);
      const experience = this.experienceRatio(p);
      if (experience > 0) this.box(10, 113, 24 * experience, 3, '#d4b174', null, 1.5);
      if (p.level === Aircraft.MAX_AIRCRAFT_LEVEL) this.text('满级', 22, 127, 7, '#d4b174', '500', 'center');
      this.text('生命', 22, 146, 8, '#8aa2c0', '500', 'center');
      if (!Number.isSafeInteger(game.player.hp) || !Number.isSafeInteger(game.player.maxHp)
        || game.player.maxHp < 1 || game.player.hp < 0 || game.player.hp > game.player.maxHp) {
        throw new RangeError('Invalid HUD health: hp=' + game.player.hp + '; maxHp=' + game.player.maxHp);
      }
      const healthLabel = game.player.hp + '/' + game.player.maxHp;
      const health = clamp01(game.player.hp / game.player.maxHp);
      const healthColor = health <= 0.3 ? '#ee9b82' : '#99cce2';
      this.text(healthLabel, 22, 162, Math.min(9, 40 / healthLabel.length), healthColor, '500', 'center');
      this.box(18, 174, 8, 50, '#233145', null, 3);
      if (health > 0) this.box(18, 224 - 50 * health, 8, 50 * health, healthColor, null, 3);
      this.text(String(game.score).padStart(6, '0'), 387, 80, 12, '#a4b8d2', '500', 'right');
      this.text(this.backgrounds[game.stage].name, 387, 99, 8, '#7992ac', '400', 'right');
      this.text(game.stageName + '  ' + (game.stage + 1) + '/' + game.stageCount, 383, 687, 9, '#8195b0', '400', 'right');
      this.box(333, 700, 50, 2, '#273044', null, 1);
      this.box(333, 700, 50 * Math.max(0, Math.min(1, game.progress)), 2, '#91accc', null, 1);
    }

    bossWarning(game) {
      const duration = game.bossWarningDuration;
      const remaining = game.bossWarningTime;
      if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(remaining) || remaining < 0 || remaining > duration) {
        throw new RangeError('Boss warning requires a valid duration and remaining time');
      }
      const ctx = this.ctx;
      const progress = (duration - remaining) / duration;
      // Three smooth pulses over the warning window; never use a hard on/off flash.
      const pulse = Math.pow(Math.sin(progress * Math.PI * 3), 2);
      ctx.save();
      ctx.fillStyle = 'rgba(255,57,36,' + pulse * 0.025 + ')';
      ctx.fillRect(0, 0, W, H);
      const sides = ctx.createLinearGradient(0, 0, W, 0);
      sides.addColorStop(0, 'rgba(255,64,39,' + pulse * 0.16 + ')');
      sides.addColorStop(0.14, 'rgba(255,64,39,0)');
      sides.addColorStop(0.86, 'rgba(255,64,39,0)');
      sides.addColorStop(1, 'rgba(255,64,39,' + pulse * 0.16 + ')');
      ctx.fillStyle = sides; ctx.fillRect(0, 0, W, H);
      const ends = ctx.createLinearGradient(0, 0, 0, H);
      ends.addColorStop(0, 'rgba(255,64,39,' + pulse * 0.1 + ')');
      ends.addColorStop(0.1, 'rgba(255,64,39,0)');
      ends.addColorStop(0.9, 'rgba(255,64,39,0)');
      ends.addColorStop(1, 'rgba(255,64,39,' + pulse * 0.1 + ')');
      ctx.fillStyle = ends; ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = Math.min(1, remaining / 0.24);
      ctx.shadowColor = 'rgba(2,6,15,0.9)'; ctx.shadowBlur = 7;
      this.text('危 险 警 报', W / 2, 225, 10, '#ffbca4', '600', 'center');
      this.text('BOSS 出现', W / 2, 255, 28, '#ffe1d5', '700', 'center');
      this.text((game.stageConfig.bossForm === 'fighter' ? '敌方王牌战机接近' : '敌方旗舰接近') + ' · 注意躲避弹幕', W / 2, 286, 11, '#e8b1a0', '500', 'center');
      ctx.shadowBlur = 0;
      this.line(73, 254, 101, 254, '#e68169', 1.5);
      this.line(304, 254, 332, 254, '#e68169', 1.5);
      ctx.restore();
    }

    playingLabels(game) {
      if (game.bossWarningTime > 0) { this.bossWarning(game); return; }
      if (game.stageTime < 5 && game.stage === 0) this.text('单指拖动战机 · 自动开火', W / 2, 665, 10, '#8b9fb9', '400', 'center');
      if (game.levelUpTime > 0) {
        const ctx = this.ctx; ctx.save(); ctx.globalAlpha = Math.min(1, game.levelUpTime * 1.5);
        this.text('战机升级', W / 2, 241, 9, C.gold, '500', 'center');
        this.text('Lv.' + game.progression.level + '  ' + game.progression.title, W / 2, 268, 22, '#edf4ff', '600', 'center');
        this.line(141, 291, 264, 291, '#b29465', 0.7); ctx.restore();
      } else if (game.banner && game.bannerTime > 0) {
        const ctx = this.ctx; ctx.save(); ctx.globalAlpha = Math.min(1, game.bannerTime * 2);
        this.text('MISSION ' + String(game.stage + 1).padStart(3, '0'), W / 2, 244, 8, C.gold, '500', 'center');
        this.text(game.banner, W / 2, 270, 18, '#d9e4f4', '500', 'center');
        ctx.restore();
      }
    }

    overlay(game) {
      const ctx = this.ctx;
      ctx.fillStyle = 'rgba(3,8,20,0.84)'; ctx.fillRect(0, 0, W, H);
      if (game.state === 'upgrade') { this.upgrade(game); return; }
      const paused = game.state === 'paused';
      const victory = game.state === 'victory';
      const y = paused ? 188 : 133;
      this.box(28, y, 349, paused ? 353 : victory ? 463 : 500, '#101d30', '#35475f', 18);
      this.line(56, y + 1, 349, y + 1, '#9a815c', 1);
      const accent = victory ? C.gold : paused ? C.blue : '#e5ab87';
      this.circle(W / 2, y + 60, 26, '#1b2a40', '#3c5069');
      if (paused) {
        ctx.fillStyle = accent; ctx.fillRect(193, y + 49, 5, 22); ctx.fillRect(207, y + 49, 5, 22);
      } else if (victory) {
        this.line(191, y + 60, 200, y + 69, accent, 3);
        this.line(200, y + 69, 216, y + 51, accent, 3);
      } else {
        polygon(ctx, [[202.5, y + 44], [217.5, y + 72], [187.5, y + 72]], null, accent);
        this.line(202.5, y + 52, 202.5, y + 61, accent, 2);
        ctx.fillStyle = accent; ctx.fillRect(201.5, y + 65, 2, 2);
      }
      this.text(paused ? '战机待命' : victory ? '最终 BOSS 已击败' : '我方战机已被击败', W / 2, y + 108, 25, C.text, '600', 'center');
      this.text(paused ? '准备好，继续穿越星海。' : victory ? game.stageCount + ' 关全部突破，群星见证你的航迹。' : '本局成长已重置 · 再次出击从第 1 关开始', W / 2, y + 143, 11, '#91a3bd', '400', 'center');
      if (paused) {
        this.text('当前武器', W / 2, y + 163, 8, '#839ab8', '500', 'center');
        const mounted = game.getActiveWeapons();
        let index = 0;
        for (const [type, weapon] of Object.entries(WEAPONS)) {
          const rank = game.player.weapons[type];
          if (!Number.isInteger(rank) || rank < (type === 'gun' ? 1 : 0) || rank > weapon.maxLevel) {
            throw new RangeError('Invalid paused weapon rank: ' + type + '=' + rank);
          }
          if (rank === 0) continue;
          const active = mounted.includes(type);
          this.text(weapon.label + ' ' + rank + '级' + (active ? '' : ' · 待挂载'),
            63 + index % 2 * 149, y + 184 + Math.floor(index / 2) * 18, 9,
            active ? weapon.color : '#879ab6', '500');
          index++;
        }
      } else {
        this.text(String(game.score).padStart(6, '0'), W / 2, 327, 42, accent, '500', 'center');
        this.text('击落 ' + game.kills + ' 架  /  抵达第 ' + (game.stage + 1) + ' 关', W / 2, 365, 10, '#8c9fb9', '400', 'center');
        const result = game.resultProgression || game.progression;
        this.text('本局成长  ·  Lv.' + result.level + ' ' + result.title, W / 2, 401, 12, '#d9c093', '500', 'center');
        this.text('本局获得 ' + result.totalXp + ' XP · 下局重新成长', W / 2, 421, 9, '#879bb7', '400', 'center');
        if (!victory) this.text('广告 / 充值复活待开放', W / 2, 441, 9, '#879bb7', '400', 'center');
      }
      this.getSceneButtons(game).forEach(button => this.button(button, button.id === 'home' || button.id === 'revive' || button.id === 'restart' && Boolean(game.savedCheckpoint)));
    }

    upgrade(game) {
      const ctx = this.ctx;
      this.text('S E C T O R   C L E A R', W / 2, 159, 10, C.gold, '500', 'center');
      this.text('BOSS 已击败', W / 2, 202, 25, C.text, '600', 'center');
      this.text('第 ' + (game.stage + 1) + '/' + game.stageCount + ' 关完成 · 选择补给，继续突围', W / 2, 240, 11, '#8fA2bd', '400', 'center');
      const buttons = this.getSceneButtons(game);
      buttons.forEach((button, index) => {
        const option = game.upgradeOptions[index];
        const color = option.id === 'spread' ? C.blue : option.id === 'rapid' ? C.gold : '#a5ded1';
        this.box(button.x, button.y, button.w, button.h, '#142238', '#394d67', 12);
        this.box(button.x + 15, button.y + 15, 43, 44, '#20334c', null, 9);
        const ix = button.x + 37; const iy = button.y + 37;
        if (option.id === 'spread') {
          this.line(ix, iy + 10, ix, iy - 11, color, 2);
          this.line(ix - 6, iy + 8, ix - 10, iy - 8, color, 2);
          this.line(ix + 6, iy + 8, ix + 10, iy - 8, color, 2);
        } else if (option.id === 'rapid') {
          polygon(ctx, [[ix + 3, iy - 13], [ix - 10, iy + 3], [ix - 1, iy + 3], [ix - 3, iy + 13], [ix + 10, iy - 3], [ix + 1, iy - 3]], color);
        } else {
          this.line(ix - 10, iy, ix + 10, iy, color, 4);
          this.line(ix, iy - 10, ix, iy + 10, color, 4);
        }
        this.text(option.title, button.x + 74, button.y + 25, 15, C.text, '600');
        this.text(option.description, button.x + 74, button.y + 49, 10.5, '#8fa6c2');
        this.line(button.x + button.w - 22, button.y + 33, button.x + button.w - 18, button.y + 37, '#93adcb', 1.5);
        this.line(button.x + button.w - 18, button.y + 37, button.x + button.w - 22, button.y + 41, '#93adcb', 1.5);
      });
      this.text('本局成长 Lv.' + game.progression.level + ' · ' + game.progression.title, W / 2, 588, 11, '#b8a17d', '400', 'center');
    }
  }

  return { Renderer, palette: C };
});
