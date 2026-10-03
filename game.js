'use strict';

// WeChat Mini Game entry. The browser entry lives in src/browser.js.
const { Game, WIDTH, HEIGHT } = require('./src/engine.js');
const { Renderer } = require('./src/renderer.js');
const { loadAssets } = require('./src/assets.js');
const canvas = wx.createCanvas();
const ctx = canvas.getContext('2d');
let game;
let renderer;
let frameId = null;
let stopped = false;
let ready = false;
let hidden = false;
let previousTime = null;
let touchSession = null;
let viewport;
let loadingMessage = '正在加载战机与弹药素材…';
const profileKey = 'fighter-era.profile';
const bestScoreKey = 'neon-wing.best-score';
let bestScoreStorageAvailable = true;
let profileStorageAvailable = true;
let savedBestScore = 0;
const diagnostics = [];

function report(message, error) {
  diagnostics.push({ message, detail: error && error.message });
  console.warn('[Fighter Era / WeChat]', message, error || '');
  wx.showToast({ title: message, icon: 'none', duration: 5000, fail: failure => console.error('[Fighter Era] Diagnostic toast failed', failure) });
}

function fatal(error) {
  if (stopped) return;
  stopped = true;
  if (frameId !== null) cancelAnimationFrame(frameId);
  touchSession = null;
  if (ctx && viewport) {
    try { drawLoading('素材或运行发生错误，游戏已停止'); }
    catch (displayError) { console.error('[Fighter Era] Cannot render fatal status', displayError); }
  }
  console.error('[Fighter Era] Fatal WeChat runtime error', { state: game && game.state, stage: game && game.stage, score: game && game.score, error });
  wx.showModal({ title: '游戏已停止', content: `${error.message || String(error)}\n请查看开发者工具日志。`, showCancel: false, fail: failure => console.error('[Fighter Era] Error modal failed', failure) });
}

function saveProfile() {
  if (!profileStorageAvailable) return;
  const snapshot = game.getProfile();
  try { wx.setStorageSync(profileKey, snapshot); }
  catch (error) { profileStorageAvailable = false; report('经验保存失败，本次成长仅暂存', error); }
}

function saveBestScore() {
  if (game.bestScore <= savedBestScore) return;
  savedBestScore = game.bestScore;
  if (!bestScoreStorageAvailable) return;
  try { wx.setStorageSync(bestScoreKey, savedBestScore); }
  catch (error) { bestScoreStorageAvailable = false; report('最高分保存失败，本次成绩仅暂存', error); }
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

function drawLoading(message = loadingMessage) {
  loadingMessage = message;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#06111e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
  ctx.fillStyle = '#b9dbed';
  ctx.font = '15px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(message, viewport.width / 2, viewport.height / 2);
}

function loadFleetPackage() {
  const name = 'fleet-assets';
  if (typeof wx.loadSubpackage !== 'function') throw new Error(`当前微信环境缺少 wx.loadSubpackage，无法加载资源分包 ${name}。`);
  drawLoading('正在加载扩展舰队资源…');
  console.info('[Fighter Era / assets]', { phase: 'package-loading', name });
  return new Promise((resolve, reject) => {
    let settled = false;
    let taskReady = false;
    let packageSucceeded = false;
    const timer = setTimeout(() => finish(new Error(`资源分包 ${name} 加载超时（30000ms）。`)), 30000);
    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else {
        console.info('[Fighter Era / assets]', { phase: 'package-loaded', name });
        resolve();
      }
    }
    try {
      const task = wx.loadSubpackage({ name,
        success: () => { packageSucceeded = true; if (taskReady) finish(); },
        fail: failure => finish(new Error(`资源分包 ${name} 加载失败：${failure && failure.errMsg ? failure.errMsg : String(failure)}`)),
      });
      if (!task || typeof task.onProgressUpdate !== 'function') throw new Error(`资源分包 ${name} 未返回有效 LoadSubpackageTask。`);
      task.onProgressUpdate(result => {
        if (settled || stopped) return;
        if (!result || !Number.isFinite(result.progress) || result.progress < 0 || result.progress > 100) {
          finish(new Error(`资源分包 ${name} 返回无效进度：${result && result.progress}`));
          return;
        }
        try { drawLoading(`正在加载扩展舰队资源 ${Math.round(result.progress)}%`); }
        catch (error) { finish(error); }
      });
      taskReady = true;
      if (packageSucceeded) finish();
    } catch (error) { finish(error); }
  });
}

function pointFor(touch) {
  if (!Number.isFinite(touch.clientX) || !Number.isFinite(touch.clientY)) throw new Error('微信触摸事件缺少有效 clientX / clientY。');
  return { x: (touch.clientX - viewport.x) / viewport.scale, y: (touch.clientY - viewport.y) / viewport.scale };
}

function activate(id) {
  if (!ready || stopped) return;
  if (id === 'start' || id === 'restart') game.start();
  else if (id === 'pause') game.pause();
  else if (id === 'resume') { previousTime = null; game.resume(); }
  else if (id === 'home') game.home();
  else if (id === 'support') game.callSupport();
  else if (id === 'bomb') game.useBomb();
  else if (id.startsWith('upgrade:')) game.chooseUpgrade(id.slice(8));
  else throw new Error(`未知微信界面按钮：${id}`);
}

function suspend() {
  touchSession = null;
  previousTime = null;
  if (game) game.pause();
}

function frame(timestamp) {
  if (stopped || !ready || hidden) return;
  try {
    let dt = previousTime === null ? 0 : (timestamp - previousTime) / 1000;
    if (!Number.isFinite(dt) || dt < 0) throw new Error(`无效的动画帧间隔：${dt} 秒`);
    previousTime = timestamp;
    if (dt > .25) {
      if (game.isActive()) {
        suspend();
        report('画面停顿超过 0.25 秒，已暂停', new Error(`Frame gap ${dt.toFixed(3)} s; state=${game.state}; stage=${game.stage}`));
      } else previousTime = null;
      dt = 0;
    }
    game.update(dt);
    if (game.state !== 'playing' && touchSession && touchSession.mode === 'drag') touchSession = null;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#060d19';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(viewport.dpr * viewport.scale, 0, 0, viewport.dpr * viewport.scale, viewport.x * viewport.dpr, viewport.y * viewport.dpr);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, WIDTH, HEIGHT);
    ctx.clip();
    renderer.draw(game, timestamp / 1000);
    if (!profileStorageAvailable || !bestScoreStorageAvailable) {
      ctx.fillStyle = '#201d22ed';
      ctx.fillRect(0, HEIGHT - 25, WIDTH, 25);
      ctx.fillStyle = '#e2bd87';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(!profileStorageAvailable ? '成长存档不可用 · 本次经验仅临时保留' : '最高分存储不可用 · 本次成绩仅临时保留', WIDTH / 2, HEIGHT - 12);
    }
    ctx.restore();
    frameId = requestAnimationFrame(frame);
  } catch (error) { fatal(error); }
}

async function initialize() {
  try {
    if (!ctx) throw new Error('微信无法创建 Canvas 2D 绘图上下文。');
    if (typeof requestAnimationFrame !== 'function' || typeof cancelAnimationFrame !== 'function') throw new Error('当前微信运行环境缺少动画帧 API。');
    let bestScore = 0;
    try {
      const stored = wx.getStorageSync(bestScoreKey);
      if (stored !== '') {
        const value = Number(stored);
        if (!Number.isSafeInteger(value) || value < 0) throw new Error(`无效的最高分记录：${stored}`);
        bestScore = value;
      }
    } catch (error) { bestScoreStorageAvailable = false; report('最高分读取失败，原记录不会覆盖', error); }
    savedBestScore = bestScore;
    let profile = { version: 1, totalXp: 0 };
    try {
      const value = wx.getStorageSync(profileKey);
      if (value !== '') {
        if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1 || !Number.isSafeInteger(value.totalXp) || value.totalXp < 0) {
          throw new Error('战机档案必须为 {version:1,totalXp:非负安全整数}。');
        }
        profile = { version: 1, totalXp: value.totalXp };
      }
    } catch (error) { profileStorageAvailable = false; report('档案不可用，原档保留，本次成长不保存', error); }
    const loggedEvents = new Set(['state', 'stage', 'boss', 'cinematic', 'ability', 'upgrade', 'levelup', 'gameover', 'victory']);
    game = new Game({ profile, bestScore, onEvent: (name, payload) => {
      if (name === 'progression') saveProfile();
      if (name === 'gameover' || name === 'victory') saveBestScore();
      if (loggedEvents.has(name)) console.info(`[Fighter Era / ${name}]`, { state: game && game.state, stage: game && game.stage, score: game && game.score, payload });
    } });
    GameGlobal.fighterEra = { game, renderer: null, diagnostics, ready: false };
    GameGlobal.neonWing = GameGlobal.fighterEra;
    resize();
    drawLoading();
    wx.onError(message => fatal(new Error(message)));
    wx.onHide(() => {
      hidden = true;
      suspend();
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = null;
    });
    wx.onShow(() => {
      hidden = false;
      previousTime = null;
      if (ready && !stopped && frameId === null) frameId = requestAnimationFrame(frame);
    });
    wx.onWindowResize(() => {
      if (stopped) return;
      try { suspend(); resize(); if (!ready && !stopped) drawLoading(); }
      catch (error) { fatal(error); }
    });

    wx.onTouchStart(event => {
      if (!ready || stopped || touchSession || !event.changedTouches.length) return;
      try {
        const touch = event.changedTouches[0];
        const point = pointFor(touch);
        if (point.x < 0 || point.x > WIDTH || point.y < 0 || point.y > HEIGHT) return;
        const button = renderer.getButtons(game).find(item => point.x >= item.x && point.x <= item.x + item.w && point.y >= item.y && point.y <= item.y + item.h);
        if (game.state !== 'playing' || button) console.info('[Fighter Era / control]', { state: game.state, button: button ? button.id : null, disabled: Boolean(button && button.disabled), point, viewport });
        // Keep this contact locked until release; a button press must never turn into a drag.
        touchSession = { id: touch.identifier, mode: button ? 'button' : 'drag', x: point.x, y: point.y };
        if (button && !button.disabled) activate(button.id);
        else if (game.state !== 'playing') touchSession.mode = 'idle';
      } catch (error) { fatal(error); }
    });
    wx.onTouchMove(event => {
      if (!ready || stopped || !touchSession || touchSession.mode !== 'drag') return;
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
    await loadFleetPackage();
    if (stopped) return;
    drawLoading('正在解码战机与弹药素材…');
    const assets = await loadAssets(() => wx.createImage());
    if (stopped) return;
    renderer = new Renderer(ctx, assets);
    ready = true;
    Object.assign(GameGlobal.fighterEra, { renderer, ready: true });
    previousTime = null;
    if (!hidden) frameId = requestAnimationFrame(frame);
  } catch (error) { fatal(error); }
}
void initialize();
