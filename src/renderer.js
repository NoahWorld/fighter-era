(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ShooterRenderer = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const W = 405;
  const H = 720;
  const C = {
    bg: '#07121f', panel: '#102535', line: '#244352', text: '#edfff9',
    muted: '#7797a6', mint: '#79f3c7', cyan: '#60dce8', orange: '#ff9369',
  };
  const FONT = '"PingFang SC", "Microsoft YaHei", -apple-system, sans-serif';

  function roundPath(ctx, x, y, w, h, radius) {
    const r = Math.min(radius, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function polygon(ctx, points, fill, stroke) {
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i][0], points[i][1]);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
  }

  class Renderer {
    constructor(ctx) {
      if (!ctx || typeof ctx.fillRect !== 'function') throw new TypeError('Renderer requires a Canvas 2D context');
      this.ctx = ctx;
      this.stars = Array.from({ length: 83 }, (_, i) => ({
        x: ((i * 127.13 + 41) % W), y: ((i * 179.79 + 19) % H),
        speed: 9 + (i % 5) * 8, size: i % 11 === 0 ? 1.6 : 0.7,
      }));
    }

    text(value, x, y, size, color, weight, align) {
      const ctx = this.ctx;
      ctx.fillStyle = color || C.text;
      ctx.font = (weight || '400') + ' ' + size + 'px ' + FONT;
      ctx.textAlign = align || 'left';
      ctx.textBaseline = 'middle';
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

    pauseButton() {
      return { id: 'pause', label: '暂停', x: 340, y: 16, w: 50, h: 50 };
    }

    getButtons(game) {
      switch (game.state) {
        case 'menu': return [{ id: 'start', label: '即刻起飞', x: 34, y: 567, w: 337, h: 57 }];
        case 'playing': return [this.pauseButton()];
        case 'paused': return [
          { id: 'resume', label: '继续航行', x: 53, y: 403, w: 299, h: 54 },
          { id: 'home', label: '返回机库', x: 53, y: 470, w: 299, h: 47 },
        ];
        case 'upgrade': return game.upgradeOptions.map((option, i) => ({
          id: 'upgrade:' + option.id, label: option.title, x: 29, y: 283 + i * 86, w: 347, h: 74,
        }));
        case 'gameover':
        case 'victory': return [
          { id: 'restart', label: game.state === 'victory' ? '再次出击' : '重新出击', x: 53, y: 458, w: 299, h: 54 },
          { id: 'home', label: '返回机库', x: 53, y: 525, w: 299, h: 47 },
        ];
        default: throw new Error('Unknown render state: ' + game.state);
      }
    }

    draw(game, timeSeconds) {
      if (!Number.isFinite(timeSeconds)) throw new TypeError('Renderer.draw requires a finite timeSeconds');
      const ctx = this.ctx;
      ctx.save();
      this.background(game, timeSeconds);
      if (game.state === 'menu') {
        this.menu(game, timeSeconds);
      } else {
        ctx.save();
        if (game.state === 'playing' && game.shake > 0) ctx.translate(Math.sin(timeSeconds * 119) * game.shake, Math.cos(timeSeconds * 137) * game.shake * 0.6);
        this.world(game, timeSeconds);
        ctx.restore();
        this.hud(game);
        if (game.state === 'playing') this.playingLabels(game, timeSeconds);
        else this.overlay(game, timeSeconds);
        if (game.state === 'playing' && game.damageFlash > 0) {
          ctx.fillStyle = 'rgba(255, 93, 81, ' + Math.min(0.25, game.damageFlash * 0.65) + ')';
          ctx.fillRect(0, 0, W, H);
        }
      }
      ctx.restore();
    }

    background(game, time) {
      const ctx = this.ctx;
      const gradient = ctx.createLinearGradient(0, 0, W, H);
      gradient.addColorStop(0, '#091b2b');
      gradient.addColorStop(0.5, '#081825');
      gradient.addColorStop(1, '#06121c');
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, W, H);
      const glow = ctx.createRadialGradient(310, 300, 0, 300, 310, 330);
      glow.addColorStop(0, 'rgba(31, 122, 125, 0.13)');
      glow.addColorStop(1, 'rgba(7, 18, 31, 0)');
      ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
      const running = game.state === 'playing' ? time : game.totalTime;
      const offset = (running * 34) % 92;
      ctx.lineWidth = 1;
      for (let x = -240; x < 700; x += 92) this.line(x, 0, x - 172, H, 'rgba(95, 158, 174, 0.035)');
      for (let y = offset - 92; y < H; y += 92) this.line(0, y, W, y + 37, 'rgba(95, 158, 174, 0.035)');
      this.stars.forEach((star, i) => {
        const y = (star.y + running * star.speed) % H;
        ctx.globalAlpha = 0.2 + (i % 7) * 0.065;
        ctx.fillStyle = i % 9 === 0 ? C.mint : '#b1cddd';
        ctx.fillRect(star.x, y, star.size, star.size + (game.state === 'playing' ? star.speed / 24 : 0));
      });
      ctx.globalAlpha = 1;
      this.line(18, 116, 18, 613, 'rgba(112, 200, 199, 0.09)');
      this.line(387, 116, 387, 613, 'rgba(112, 200, 199, 0.09)');
      for (let i = 0; i < 6; i += 1) {
        const y = 139 + i * 86;
        this.line(16, y, 22, y, 'rgba(112, 200, 199, 0.22)');
        this.line(383, y, 389, y, 'rgba(112, 200, 199, 0.22)');
      }
    }

    aircraft(x, y, scale, time, shield, alpha) {
      const ctx = this.ctx;
      ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale); ctx.globalAlpha = alpha;
      if (shield) {
        ctx.strokeStyle = 'rgba(122, 242, 206, 0.5)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(0, 0, 36, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = 'rgba(96, 220, 232, 0.06)'; ctx.fill();
      }
      const flame = 14 + Math.sin(time * 29) * 4;
      ctx.shadowColor = C.mint; ctx.shadowBlur = 14;
      polygon(ctx, [[-6, 21], [0, 21 + flame], [6, 21]], '#59eebc');
      polygon(ctx, [[-2.5, 21], [0, 30 + flame * 0.35], [2.5, 21]], '#effff4');
      ctx.shadowBlur = 0;
      polygon(ctx, [[0, -35], [-8, -11], [-30, 16], [-30, 24], [-9, 15], [-7, 26], [7, 26], [9, 15], [30, 24], [30, 16], [8, -11]], '#235966', '#6edfc6');
      polygon(ctx, [[0, -35], [-8, -11], [-9, 17], [0, 23]], '#8af4d0');
      polygon(ctx, [[0, -35], [8, -11], [9, 17], [0, 23]], '#48b7aa');
      polygon(ctx, [[-8, -9], [-27, 18], [-10, 11]], '#44999a');
      polygon(ctx, [[8, -9], [27, 18], [10, 11]], '#2b777f');
      polygon(ctx, [[0, -17], [-4, -5], [-3, 8], [3, 8], [4, -5]], '#102d43', '#b6ffdf');
      this.line(0, -13, 0, 3, '#5fcbcc', 1.2);
      this.line(-21, 10, -21, 18, '#d9ffdf', 1.5);
      this.line(21, 10, 21, 18, '#d9ffdf', 1.5);
      this.line(-6, 19, -6, 25, '#0c2430', 2);
      this.line(6, 19, 6, 25, '#0c2430', 2);
      ctx.restore();
    }

    enemy(enemy, time) {
      const ctx = this.ctx;
      ctx.save(); ctx.translate(enemy.x, enemy.y);
      const s = enemy.r / (enemy.type === 'boss' ? 61 : 21);
      ctx.scale(s, s);
      const hit = enemy.hit > 0;
      const body = hit ? '#fff1d3' : (enemy.type === 'tank' ? '#78575e' : '#944f52');
      const edge = hit ? '#ffffff' : '#f39985';
      ctx.lineWidth = 1;
      if (enemy.type === 'boss') {
        polygon(ctx, [[0, 51], [-16, 20], [-27, 9], [-63, 30], [-60, -17], [-44, -32], [-18, -22], [0, -43], [18, -22], [44, -32], [60, -17], [63, 30], [27, 9], [16, 20]], hit ? '#fff0d2' : '#573e55', edge);
        polygon(ctx, [[0, 42], [-15, 12], [-14, -15], [0, -32], [14, -15], [15, 12]], '#aa696b', '#eea49a');
        polygon(ctx, [[0, 21], [-7, 5], [0, -19], [7, 5]], '#ffc188');
        polygon(ctx, [[-21, -12], [-49, -22], [-51, 18], [-29, 3]], '#363e53', '#bf7d88');
        polygon(ctx, [[21, -12], [49, -22], [51, 18], [29, 3]], '#363e53', '#bf7d88');
        [-44, 44].forEach(gunX => {
          ctx.fillStyle = '#ffab78'; ctx.shadowBlur = 13; ctx.shadowColor = C.orange;
          ctx.fillRect(gunX - 3, 14, 6, 12); ctx.shadowBlur = 0;
        });
        this.line(-52, -13, -33, -7, '#e48d87', 2);
        this.line(52, -13, 33, -7, '#e48d87', 2);
      } else if (enemy.type === 'tank') {
        polygon(ctx, [[0, 27], [-10, 17], [-23, 17], [-25, -9], [-15, -21], [15, -21], [25, -9], [23, 17], [10, 17]], body, edge);
        polygon(ctx, [[0, 22], [-9, 9], [-8, -15], [8, -15], [9, 9]], '#b27d78');
        this.box(-4, -8, 8, 19, '#241c30', '#f0b78d', 3);
        this.line(-18, -8, -18, 11, '#e4a58f', 2);
        this.line(18, -8, 18, 11, '#e4a58f', 2);
      } else {
        const wide = enemy.type === 'striker' ? 26 : 21;
        polygon(ctx, [[0, 25], [-7, 7], [-wide, 3], [-wide + 4, -16], [-8, -6], [0, -17], [8, -6], [wide - 4, -16], [wide, 3], [7, 7]], body, edge);
        polygon(ctx, [[0, 23], [-5, 3], [0, -11], [5, 3]], '#f2a28c');
        polygon(ctx, [[0, 8], [-3, -1], [0, -7], [3, -1]], '#442c41');
        this.line(-wide + 6, -8, -wide + 5, 0, '#f9ba93', 1.5);
        this.line(wide - 6, -8, wide - 5, 0, '#f9ba93', 1.5);
      }
      ctx.restore();
      if (enemy.type !== 'boss' && enemy.hp < enemy.maxHp) {
        this.box(enemy.x - 17, enemy.y - enemy.r - 10, 34, 3, '#223c49', null, 1);
        this.box(enemy.x - 17, enemy.y - enemy.r - 10, 34 * Math.max(0, enemy.hp / enemy.maxHp), 3, C.orange, null, 1);
      }
    }

    world(game, time) {
      const ctx = this.ctx;
      game.pickups.forEach(p => {
        const color = p.type === 'repair' ? C.mint : '#fbd48e';
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.sin(p.t * 3) * 0.12);
        ctx.shadowBlur = 12; ctx.shadowColor = color;
        polygon(ctx, [[0, -13], [13, 0], [0, 13], [-13, 0]], '#193c40', color);
        ctx.shadowBlur = 0;
        if (p.type === 'repair') { this.line(-5, 0, 5, 0, color, 2); this.line(0, -5, 0, 5, color, 2); }
        else polygon(ctx, [[1, -7], [-5, 1], [0, 1], [-1, 7], [5, -1], [0, -1]], color);
        ctx.restore();
      });
      game.playerBullets.forEach(b => {
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(Math.atan2(b.vx, -b.vy));
        ctx.shadowBlur = 10; ctx.shadowColor = '#64f6d3';
        this.box(-b.r, -9, b.r * 2, 18, '#b8ffe5', null, b.r);
        ctx.shadowBlur = 0; this.box(-0.7, -9, 1.4, 14, '#ffffff', null, 0.7);
        ctx.restore();
      });
      game.enemies.forEach(e => this.enemy(e, time));
      const p = game.player;
      if (p.hp > 0) this.aircraft(p.x, p.y, 0.76, time, p.shield > 0, p.invincible > 0 && Math.sin(time * 40) > 0.3 ? 0.38 : 1);
      game.enemyBullets.forEach(b => {
        ctx.shadowBlur = 10; ctx.shadowColor = '#ff764a';
        ctx.fillStyle = '#ff875f'; ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 1, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0; ctx.fillStyle = '#ffe2b3'; ctx.beginPath(); ctx.arc(b.x, b.y, Math.max(1.3, b.r * 0.47), 0, Math.PI * 2); ctx.fill();
      });
      game.particles.forEach(particle => {
        ctx.globalAlpha = Math.max(0, particle.life / particle.maxLife);
        ctx.fillStyle = particle.color;
        ctx.beginPath(); ctx.arc(particle.x, particle.y, Math.max(0.1, particle.r), 0, Math.PI * 2); ctx.fill();
      });
      ctx.globalAlpha = 1;
    }

    button(button, secondary) {
      const ctx = this.ctx;
      if (button.id === 'pause') {
        this.box(button.x, button.y, button.w, button.h, '#142b3a', '#315160', 10);
        ctx.fillStyle = C.text;
        const centerX = button.x + button.w / 2;
        const centerY = button.y + button.h / 2;
        ctx.fillRect(centerX - 6, centerY - 7, 3, 14);
        ctx.fillRect(centerX + 3, centerY - 7, 3, 14);
        return;
      }
      this.box(button.x, button.y, button.w, button.h, secondary ? '#122b39' : C.mint, secondary ? '#31505e' : '#b2ffe0', 12);
      this.text(button.label, button.x + button.w / 2, button.y + button.h / 2, 16, secondary ? '#a8c3cd' : '#073c36', '600', 'center');
      if (!secondary) {
        const x = button.x + button.w - 30; const y = button.y + button.h / 2;
        this.line(x - 6, y, x + 5, y, '#165349', 1.7);
        this.line(x + 1, y - 4, x + 5, y, '#165349', 1.7);
        this.line(x + 1, y + 4, x + 5, y, '#165349', 1.7);
      }
    }

    menu(game, time) {
      const ctx = this.ctx;
      polygon(ctx, [[31, 31], [39, 46], [31, 42], [23, 46]], C.mint);
      this.text('N / W', 49, 39, 12, C.text, '600');
      this.text('飞行系统已就绪', 371, 39, 10, C.muted, '400', 'right');
      ctx.fillStyle = C.mint; ctx.beginPath(); ctx.arc(274, 39, 2.5, 0, Math.PI * 2); ctx.fill();
      this.text('S I N G L E   P I L O T   /   0 1', W / 2, 106, 10, C.mint, '500', 'center');
      this.text('霓虹航线', W / 2, 155, 45, '#ecfff6', '700', 'center');
      this.text('N E O N   W I N G', W / 2, 197, 15, '#90adb9', '400', 'center');
      this.text('穿过弹幕，飞向下一道光。', W / 2, 237, 12, '#88a6b2', '400', 'center');
      ctx.save(); ctx.translate(W / 2, 364);
      [83, 117].forEach((r, i) => {
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.strokeStyle = i ? 'rgba(95, 184, 179, 0.11)' : 'rgba(95, 184, 179, 0.19)'; ctx.lineWidth = 1; ctx.stroke();
      });
      ctx.rotate(time * 0.11); ctx.beginPath(); ctx.arc(0, 0, 117, 0.08, 0.64); ctx.strokeStyle = '#52968f'; ctx.lineWidth = 2; ctx.stroke();
      ctx.restore();
      const aura = ctx.createRadialGradient(202, 368, 10, 202, 368, 110);
      aura.addColorStop(0, 'rgba(84, 226, 194, 0.16)'); aura.addColorStop(1, 'rgba(84, 226, 194, 0)');
      ctx.fillStyle = aura; ctx.fillRect(77, 236, 250, 265);
      this.aircraft(W / 2, 358 + Math.sin(time * 1.6) * 5, 2.12, time, false, 1);
      this.line(60, 350, 109, 350, '#345768'); this.line(296, 385, 345, 385, '#345768');
      this.text('NW—01', 43, 337, 9, '#668a9b', '500');
      this.text('自动火控', 362, 403, 9, '#668a9b', '400', 'right');
      this.box(73, 505, 259, 34, 'rgba(20, 47, 61, 0.85)', '#294655', 17);
      this.line(93, 521, 107, 521, C.mint, 1.2);
      this.line(93, 521, 96, 518, C.mint, 1.2); this.line(107, 521, 104, 524, C.mint, 1.2);
      this.text('单指拖动 · 自动开火 · 三关突围', 120, 522, 11, '#b1cbd3');
      this.button(this.getButtons(game)[0]);
      this.text('最高纪录', 34, 653, 10, C.muted);
      this.text(String(game.bestScore).padStart(6, '0'), 371, 653, 15, '#ccdedf', '500', 'right');
      this.line(34, 676, 371, 676, '#203a49');
      this.text('ONE FINGER. ALL THE WAY.', W / 2, 696, 8, '#527181', '500', 'center');
    }

    hud(game) {
      const ctx = this.ctx;
      const gradient = ctx.createLinearGradient(0, 0, 0, 136);
      gradient.addColorStop(0, 'rgba(6, 19, 31, 0.99)');
      gradient.addColorStop(0.75, 'rgba(6, 19, 31, 0.93)');
      gradient.addColorStop(1, 'rgba(6, 19, 31, 0)');
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, W, 136);
      this.text('SECTOR 0' + (game.stage + 1), 25, 29, 9, C.mint, '600');
      this.text(game.stageName, 25, 52, 18, C.text, '600');
      this.text('SCORE', 327, 29, 8, C.muted, '500', 'right');
      this.text(String(game.score).padStart(6, '0'), 327, 51, 20, '#e2f7f1', '500', 'right');
      this.button(this.pauseButton());
      for (let i = 0; i < game.player.maxHp; i += 1) {
        const x = 25 + i * 18;
        polygon(ctx, [[x + 5, 87], [x, 81], [x, 77], [x + 3, 75], [x + 5, 78], [x + 7, 75], [x + 10, 77], [x + 10, 81]], i < game.player.hp ? C.mint : '#28424f');
      }
      this.text('火力 LV.' + game.player.weaponLevel, 380, 81, 10, '#8fbdc6', '500', 'right');
      this.box(25, 103, 355, 3, '#1c3544', null, 1.5);
      this.box(25, 103, 355 * Math.max(0, Math.min(1, game.progress)), 3, C.mint, null, 1.5);
      const boss = game.enemies.find(e => e.type === 'boss');
      if (boss) {
        this.text('BOSS / 重装巡航者', 25, 130, 9, C.orange, '600');
        this.box(25, 144, 355, 5, '#452f37', null, 2);
        this.box(25, 144, 355 * Math.max(0, boss.hp / boss.maxHp), 5, C.orange, null, 2);
      }
    }

    playingLabels(game, time) {
      this.text('拖动任意位置操控', W / 2, 685, 10, '#628695', '400', 'center');
      this.text('0' + (game.stage + 1) + ' / 03', 25, 684, 9, '#476875', '500');
      this.text('AUTO', 380, 684, 9, '#476875', '500', 'right');
      if (game.banner && game.bannerTime > 0) {
        const ctx = this.ctx; ctx.save(); ctx.globalAlpha = Math.min(1, game.bannerTime * 2);
        this.box(59, 199, 287, 62, 'rgba(12, 34, 47, 0.93)', '#345b67', 12);
        this.text(game.banner, W / 2, 231, 18, C.text, '600', 'center');
        ctx.restore();
      }
    }

    overlay(game, time) {
      const ctx = this.ctx;
      ctx.fillStyle = 'rgba(3, 12, 23, 0.79)'; ctx.fillRect(0, 0, W, H);
      if (game.state === 'upgrade') { this.upgrade(game); return; }
      const paused = game.state === 'paused';
      const victory = game.state === 'victory';
      const y = paused ? 188 : 149;
      this.box(28, y, 349, paused ? 353 : 447, '#102333', '#315061', 22);
      this.line(55, y + 1, 350, y + 1, victory ? '#79f3c7' : '#547b85', 1);
      const accent = victory ? C.mint : paused ? C.cyan : C.orange;
      ctx.beginPath(); ctx.arc(W / 2, y + 64, 26, 0, Math.PI * 2); ctx.fillStyle = '#193849'; ctx.fill();
      if (paused) {
        ctx.fillStyle = accent; ctx.fillRect(193, y + 53, 5, 22); ctx.fillRect(207, y + 53, 5, 22);
      } else if (victory) {
        this.line(191, y + 64, 200, y + 73, accent, 3);
        this.line(200, y + 73, 216, y + 55, accent, 3);
      } else {
        polygon(ctx, [[202.5, y + 49], [217.5, y + 76], [187.5, y + 76]], null, accent);
        this.line(202.5, y + 57, 202.5, y + 65, accent, 2);
        ctx.fillStyle = accent; ctx.fillRect(201.5, y + 69, 2, 2);
      }
      this.text(paused ? '航行已暂停' : victory ? '全域突围成功' : '本次航行结束', W / 2, y + 117, 26, C.text, '600', 'center');
      this.text(paused ? '深呼吸，下一道光就在前方。' : victory ? '三道防线，全部突破。漂亮的飞行！' : '调整航线，再来一次。', W / 2, y + 153, 12, '#8fadb9', '400', 'center');
      if (!paused) {
        this.text('本次得分', W / 2, 339, 10, '#7299a9', '400', 'center');
        this.text(String(game.score).padStart(6, '0'), W / 2, 378, 43, accent, '500', 'center');
        this.text('击落 ' + game.kills + ' 架  /  抵达第 ' + (game.stage + 1) + ' 关', W / 2, 421, 11, '#9cb8c3', '400', 'center');
      }
      this.getButtons(game).forEach(button => this.button(button, button.id === 'home'));
    }

    upgrade(game) {
      const ctx = this.ctx;
      this.text('S E C T O R   C L E A R', W / 2, 161, 10, C.mint, '600', 'center');
      this.text('给下一关，多一点火力', W / 2, 204, 25, C.text, '600', 'center');
      this.text('选择一项补给，即刻继续航行', W / 2, 241, 12, '#8eacb9', '400', 'center');
      const buttons = this.getButtons(game);
      buttons.forEach((button, index) => {
        const option = game.upgradeOptions[index];
        const color = option.id === 'spread' ? C.mint : option.id === 'rapid' ? '#f7ca82' : C.cyan;
        this.box(button.x, button.y, button.w, button.h, '#122a3b', '#375a68', 13);
        this.box(button.x + 15, button.y + 15, 43, 44, '#1b3e4b', null, 10);
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
        this.text(option.description, button.x + 74, button.y + 49, 11, '#8fafbc');
        this.line(button.x + button.w - 22, button.y + 33, button.x + button.w - 18, button.y + 37, '#99c5cc', 1.5);
        this.line(button.x + button.w - 18, button.y + 37, button.x + button.w - 22, button.y + 41, '#99c5cc', 1.5);
      });
      this.text('每次选择，都会改变你的航线。', W / 2, 588, 11, '#648b9c', '400', 'center');
    }
  }

  return { Renderer, palette: C };
});
