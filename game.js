'use strict';

// WeChat Mini Game entry. The browser entry lives in src/browser.js.
const { Game, WIDTH, HEIGHT } = require('./src/engine.js');
const { Renderer } = require('./src/renderer.js');
const canvas = wx.createCanvas();
const ctx = canvas.getContext('2d');
let game;
let renderer;
let frameId = null;
let stopped = false;
let previousTime = null;
let touchSession = null;
let viewport;
let storageAvailable = true;
let savedBestScore = 0;
const diagnostics = [];

function report(message, error) {
  diagnostics.push({ message, detail: error && error.message });
  console.warn('[Neon Wing / WeChat]', message, error || '');
  wx.showToast({ title: message, icon: 'none', duration: 3500, fail: failure => console.error('[Neon Wing] Diagnostic toast failed', failure) });
}

function fatal(error) {
  if (stopped) return;
  stopped = true;
  if (frameId !== null) cancelAnimationFrame(frameId);
  touchSession = null;
  console.error('[Neon Wing] Fatal WeChat runtime error', { state: game && game.state, stage: game && game.stage, score: game && game.score, error });
  wx.showModal({ title: '游戏已停止', content: `${error.message || String(error)}\n请查看开发者工具日志。`, showCancel: false, fail: failure => console.error('[Neon Wing] Error modal failed', failure) });
}

function resize() {
  const info = wx.getWindowInfo();
  const { windowWidth, windowHeight, pixelRatio } = info;
  if (![windowWidth, windowHeight, pixelRatio].every(value => Number.isFinite(value) && value > 0)) throw new Error('微信返回了无效的窗口尺寸。');
  const scale = Math.min(windowWidth / WIDTH, windowHeight / HEIGHT);
  viewport = { width: windowWidth, height: windowHeight, dpr: pixelRatio, scale, x: (windowWidth - WIDTH * scale) / 2, y: (windowHeight - HEIGHT * scale) / 2 };
  canvas.width = Math.round(windowWidth * pixelRatio);
  canvas.height = Math.round(windowHeight * pixelRatio);
  touchSession = null;
}

function pointFor(touch) {
  if (!Number.isFinite(touch.clientX) || !Number.isFinite(touch.clientY)) throw new Error('微信触摸事件缺少有效 clientX / clientY。');
  return { x: (touch.clientX - viewport.x) / viewport.scale, y: (touch.clientY - viewport.y) / viewport.scale };
}

function activate(id) {
  if (id === 'start' || id === 'restart') game.start();
  else if (id === 'pause') game.pause();
  else if (id === 'resume') { previousTime = null; game.resume(); }
  else if (id === 'home') game.home();
  else if (id.startsWith('upgrade:')) game.chooseUpgrade(id.slice(8));
  else throw new Error(`未知微信界面按钮：${id}`);
}

function suspend() {
  touchSession = null;
  previousTime = null;
  if (game.state === 'playing') game.pause();
}

function frame(timestamp) {
  if (stopped) return;
  try {
    let dt = previousTime === null ? 0 : (timestamp - previousTime) / 1000;
    if (!Number.isFinite(dt) || dt < 0) throw new Error(`无效的动画帧间隔：${dt} 秒`);
    previousTime = timestamp;
    if (dt > .25) {
      const wasPlaying = game.state === 'playing';
      suspend();
      report(wasPlaying ? '画面停顿超过 0.25 秒，已暂停' : '画面停顿超过 0.25 秒，计时已重置', new Error(`Frame gap ${dt.toFixed(3)} s; state=${game.state}; stage=${game.stage}`));
      dt = 0;
    }
    game.update(dt);
    if (game.state !== 'playing' && touchSession && touchSession.mode === 'drag') touchSession = null;
    if (game.bestScore > savedBestScore) {
      savedBestScore = game.bestScore;
      if (storageAvailable) {
        try { wx.setStorageSync('neon-wing.best-score', savedBestScore); }
        catch (error) { storageAvailable = false; report('最高分保存失败，详情见日志', error); }
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#060d19';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(viewport.dpr * viewport.scale, 0, 0, viewport.dpr * viewport.scale, viewport.x * viewport.dpr, viewport.y * viewport.dpr);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, WIDTH, HEIGHT);
    ctx.clip();
    renderer.draw(game, timestamp / 1000);
    ctx.restore();
    frameId = requestAnimationFrame(frame);
  } catch (error) { fatal(error); }
}

try {
  if (!ctx) throw new Error('微信无法创建 Canvas 2D 绘图上下文。');
  if (typeof requestAnimationFrame !== 'function' || typeof cancelAnimationFrame !== 'function') throw new Error('当前微信运行环境缺少动画帧 API。');
  let bestScore = 0;
  try {
    const stored = wx.getStorageSync('neon-wing.best-score');
    if (stored !== '') {
      const value = Number(stored);
      if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) throw new Error(`无效的最高分记录：${stored}`);
      bestScore = value;
    }
  } catch (error) { storageAvailable = false; report('本地纪录读取失败，详情见日志', error); }
  savedBestScore = bestScore;
  const loggedEvents = new Set(['state', 'stage', 'upgrade', 'gameover', 'victory']);
  game = new Game({ bestScore, onEvent: (name, payload) => {
    if (loggedEvents.has(name)) console.info(`[Neon Wing / ${name}]`, { state: game && game.state, stage: game && game.stage, score: game && game.score, payload });
  } });
  renderer = new Renderer(ctx);
  GameGlobal.neonWing = { game, renderer, diagnostics };
  resize();
  wx.onError(message => fatal(new Error(message)));
  wx.onHide(suspend);
  wx.onShow(() => { previousTime = null; });
  wx.onWindowResize(() => { try { suspend(); resize(); } catch (error) { fatal(error); } });

  wx.onTouchStart(event => {
    if (stopped || touchSession || !event.changedTouches.length) return;
    try {
      const touch = event.changedTouches[0];
      const point = pointFor(touch);
      if (point.x < 0 || point.x > WIDTH || point.y < 0 || point.y > HEIGHT) return;
      const button = renderer.getButtons(game).find(item => point.x >= item.x && point.x <= item.x + item.w && point.y >= item.y && point.y <= item.y + item.h);
      // Keep this contact locked until release; a button press must never turn into a drag.
      touchSession = { id: touch.identifier, mode: button ? 'button' : 'drag', x: point.x, y: point.y };
      if (button) activate(button.id);
      else if (game.state !== 'playing') touchSession.mode = 'idle';
    } catch (error) { fatal(error); }
  });
  wx.onTouchMove(event => {
    if (stopped || !touchSession || touchSession.mode !== 'drag') return;
    try {
      const touch = event.changedTouches.find(item => item.identifier === touchSession.id);
      if (!touch) return;
      const point = pointFor(touch);
      if (game.state === 'playing') game.moveBy(point.x - touchSession.x, point.y - touchSession.y);
      touchSession.x = point.x;
      touchSession.y = point.y;
    } catch (error) { fatal(error); }
  });
  function release(event) {
    if (touchSession && event.changedTouches.some(touch => touch.identifier === touchSession.id)) touchSession = null;
  }
  wx.onTouchEnd(release);
  wx.onTouchCancel(() => { touchSession = null; });
  frameId = requestAnimationFrame(frame);
} catch (error) { fatal(error); }
