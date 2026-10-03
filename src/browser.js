(async function () {
  'use strict';

  const canvas = document.getElementById('game-canvas');
  const overlay = document.getElementById('game-buttons');
  const diagnosticBox = document.getElementById('diagnostics');
  const soundButton = document.getElementById('sound-toggle');
  const loadingBox = document.getElementById('asset-loading');
  const diagnostics = new Map();
  let frameId = 0;
  let stopped = false;
  let pointer = null;
  let game;
  let renderer;
  let lastFrame = null;
  let buttonSignature = '';
  let dpr = 1;
  const keys = new Set();

  function report(key, message, error) {
    diagnostics.set(key, message);
    diagnosticBox.hidden = false;
    diagnosticBox.textContent = Array.from(diagnostics.values()).join(' · ');
    console.warn(`[Fighter Era / ${key}] ${message}`, error || '');
  }

  function fatal(error) {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frameId);
    keys.clear();
    pointer = null;
    overlay.replaceChildren();
    soundButton.disabled = true;
    if (loadingBox.isConnected) loadingBox.textContent = '素材加载失败，请查看错误后刷新重试。';
    console.error('[Fighter Era] Fatal runtime error', { state: game && game.state, stage: game && game.stage, score: game && game.score, error });
    diagnosticBox.hidden = false;
    diagnosticBox.textContent = `游戏已停止：${error.message || String(error)}。请查看控制台错误后刷新重试。`;
    window.alert(diagnosticBox.textContent);
  }
  window.addEventListener('error', event => fatal(event.error || new Error(event.message || '资源加载失败')));
  window.addEventListener('unhandledrejection', event => fatal(event.reason instanceof Error ? event.reason : new Error(String(event.reason))));

  try {
    if (!window.Shooter || !window.ShooterRenderer || !window.ShooterAssets) throw new Error('游戏引擎、渲染器或素材模块未加载，请检查资源请求。');
    const { Game, WIDTH, HEIGHT } = window.Shooter;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('浏览器无法创建 Canvas 2D 绘图上下文。');
    const assets = await window.ShooterAssets.loadAssets(() => new Image());
    // A global error may have stopped initialization while images were loading.
    if (stopped) return;
    const profileKey = 'fighter-era.profile';
    // Keep the original score key so existing pilots retain their best run.
    const bestScoreKey = 'neon-wing.best-score';
    let bestScoreStorageAvailable = true;
    let profileStorageAvailable = true;
    let bestScore = 0;
    try {
      const stored = localStorage.getItem(bestScoreKey);
      if (stored !== null) {
        const value = Number(stored);
        if (stored.trim() === '' || !Number.isSafeInteger(value) || value < 0) throw new Error(`无效的最高分记录：${stored}`);
        bestScore = value;
      }
    } catch (error) {
      bestScoreStorageAvailable = false;
      report('score-storage', '最高分记录不可用，原记录不会被覆盖；本次最高分仅保留在当前页面。', error);
    }
    let savedBestScore = bestScore;
    let profile = { version: 1, totalXp: 0 };
    try {
      const stored = localStorage.getItem(profileKey);
      if (stored !== null) {
        const value = JSON.parse(stored);
        if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1 || !Number.isSafeInteger(value.totalXp) || value.totalXp < 0) {
          throw new Error('战机档案必须为 {version:1,totalXp:非负安全整数}。');
        }
        profile = { version: 1, totalXp: value.totalXp };
      }
    } catch (error) {
      profileStorageAvailable = false;
      report('profile-storage', '成长档案不可用，原存档不会被覆盖；本次从初始等级临时游玩，经验无法保存。', error);
    }

    function saveProfile() {
      if (!profileStorageAvailable) return;
      const snapshot = game.getProfile();
      try { localStorage.setItem(profileKey, JSON.stringify(snapshot)); }
      catch (error) {
        profileStorageAvailable = false;
        report('profile-storage', '成长档案保存失败；已获得的经验暂留在当前页面，关闭后可能丢失。', error);
      }
    }
    function saveBestScore() {
      if (game.bestScore <= savedBestScore) return;
      savedBestScore = game.bestScore;
      if (!bestScoreStorageAvailable) return;
      try { localStorage.setItem(bestScoreKey, String(savedBestScore)); }
      catch (error) {
        bestScoreStorageAvailable = false;
        report('score-storage', '最高分保存失败：本次成绩仅保留在当前页面。', error);
      }
    }

    function syncPilotBriefing() {
      const progression = game.progression;
      document.getElementById('pilot-level').textContent = String(progression.level).padStart(2, '0');
      document.getElementById('pilot-title').textContent = progression.title;
      document.getElementById('pilot-xp').textContent = `${progression.xp.toLocaleString('zh-CN')} / ${progression.nextXp.toLocaleString('zh-CN')} XP`;
      const percent = Math.min(100, progression.xp / progression.nextXp * 100);
      const progress = document.getElementById('pilot-progress');
      progress.style.width = `${percent}%`;
      progress.parentElement.setAttribute('aria-valuenow', String(Math.round(percent)));
      for (const tier of document.querySelectorAll('[data-min-level]')) {
        tier.classList.toggle('is-unlocked', progression.level >= Number(tier.dataset.minLevel));
      }
    }

    const audio = {
      context: null,
      enabled: false,
      lastShot: 0,
      lastHit: 0,
      async unlock() {
        if (!this.enabled) return;
        try {
          const Audio = window.AudioContext || window.webkitAudioContext;
          if (!Audio) throw new Error('此浏览器不支持 Web Audio');
          if (!this.context) this.context = new Audio();
          if (this.context.state === 'suspended') await this.context.resume();
          if (this.context.state !== 'running') throw new Error(`音频上下文状态：${this.context.state}`);
          if (diagnostics.delete('audio')) {
            diagnosticBox.textContent = Array.from(diagnostics.values()).join(' · ');
            diagnosticBox.hidden = diagnostics.size === 0;
          }
        } catch (error) {
          this.enabled = false;
          updateSoundButton();
          report('audio', '音效未能启动；游戏可继续，详情见控制台。', error);
        }
      },
      play(name) {
        if (!this.enabled || !this.context || this.context.state !== 'running') return;
        const tones = { shot: [620, 230, .045, .016], hit: [240, 80, .055, .025], explosion: [95, 24, .18, .05], hurt: [150, 40, .22, .065], pickup: [480, 960, .16, .045], upgrade: [480, 1200, .22, .05], levelup: [520, 1560, .42, .055], stage: [320, 800, .3, .045], victory: [440, 1320, .55, .05], gameover: [180, 35, .45, .045] };
        const tone = tones[name];
        if (!tone) return;
        const now = this.context.currentTime;
        if (name === 'shot' && now - this.lastShot < .085) return;
        if (name === 'shot') this.lastShot = now;
        if (name === 'hit' && now - this.lastHit < .055) return;
        if (name === 'hit') this.lastHit = now;
        const oscillator = this.context.createOscillator();
        const gain = this.context.createGain();
        oscillator.type = name === 'explosion' || name === 'hurt' ? 'sawtooth' : 'triangle';
        oscillator.frequency.setValueAtTime(tone[0], now);
        oscillator.frequency.exponentialRampToValueAtTime(tone[1], now + tone[2]);
        gain.gain.setValueAtTime(tone[3], now);
        gain.gain.exponentialRampToValueAtTime(.001, now + tone[2]);
        oscillator.connect(gain);
        gain.connect(this.context.destination);
        oscillator.start(now);
        oscillator.stop(now + tone[2]);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      }
    };
    function updateSoundButton() {
      soundButton.textContent = `音效 · ${audio.enabled ? '开' : '关'}`;
      soundButton.setAttribute('aria-pressed', String(audio.enabled));
      soundButton.setAttribute('aria-label', audio.enabled ? '关闭游戏音效' : '开启游戏音效');
    }
    soundButton.addEventListener('click', () => { audio.enabled = !audio.enabled; updateSoundButton(); void audio.unlock(); });
    updateSoundButton();
    const loggedEvents = new Set(['state', 'stage', 'boss', 'cinematic', 'ability', 'upgrade', 'levelup', 'gameover', 'victory']);
    game = new Game({ profile, bestScore, onEvent: (name, payload) => {
      if (name === 'progression') { saveProfile(); syncPilotBriefing(); }
      if (name === 'gameover' || name === 'victory') saveBestScore();
      try { audio.play(name); }
      catch (error) {
        audio.enabled = false;
        updateSoundButton();
        report('audio', '音效播放失败，已关闭音效；游戏可继续。', error);
      }
      if (loggedEvents.has(name)) console.info(`[Fighter Era / ${name}]`, { state: game && game.state, stage: game && game.stage, score: game && game.score, payload });
    } });
    renderer = new window.ShooterRenderer.Renderer(ctx, assets);
    window.fighterEra = { game, renderer, diagnostics };
    window.neonWing = window.fighterEra;
    syncPilotBriefing();

    function resize() {
      dpr = window.devicePixelRatio || 1;
      const bounds = canvas.getBoundingClientRect();
      canvas.width = Math.round(bounds.width * dpr);
      canvas.height = Math.round(bounds.height * dpr);
    }
    resize();
    window.addEventListener('resize', resize);

    function resetInput() {
      if (pointer && canvas.hasPointerCapture(pointer.id)) canvas.releasePointerCapture(pointer.id);
      pointer = null;
      keys.clear();
    }
    function suspend() {
      resetInput();
      game.pause();
      lastFrame = null;
      syncButtons();
    }
    window.addEventListener('blur', suspend);
    document.addEventListener('visibilitychange', () => { if (document.hidden) suspend(); });

    function activate(id) {
      if (stopped) return;
      if (id !== 'support' && id !== 'bomb') resetInput();
      void audio.unlock();
      if (id === 'start' || id === 'restart') game.start();
      else if (id === 'pause') game.pause();
      else if (id === 'resume') { lastFrame = null; game.resume(); }
      else if (id === 'home') game.home();
      else if (id === 'support') game.callSupport();
      else if (id === 'bomb') game.useBomb();
      else if (id.startsWith('upgrade:')) game.chooseUpgrade(id.slice('upgrade:'.length));
      else throw new Error(`未知按钮：${id}`);
      if (game.isActive() && diagnostics.delete('frame')) {
        diagnosticBox.textContent = Array.from(diagnostics.values()).join(' · ');
        diagnosticBox.hidden = diagnostics.size === 0;
      }
      syncButtons();
    }

    function syncButtons() {
      const buttons = renderer.getButtons(game);
      const signature = JSON.stringify(buttons);
      if (signature === buttonSignature) return;
      const hadFocus = overlay.contains(document.activeElement);
      const focusedId = hadFocus ? document.activeElement.dataset.buttonId : null;
      buttonSignature = signature;
      const existing = new Map(Array.from(overlay.children, button => [button.dataset.buttonId, button]));
      const activeIds = new Set(buttons.map(button => button.id));
      for (const [id, button] of existing) {
        if (!activeIds.has(id)) button.remove();
      }
      buttons.forEach((descriptor, index) => {
        let button = existing.get(descriptor.id);
        if (!button) {
          button = document.createElement('button');
          button.type = 'button';
          button.className = 'canvas-button';
          button.dataset.buttonId = descriptor.id;
          button.addEventListener('pointerdown', event => {
            event.stopPropagation();
            const rejected = pointer !== null || !event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0);
            button.dataset.rejectPointer = String(rejected);
            if (rejected) event.preventDefault();
            else keys.clear();
          });
          button.addEventListener('click', event => {
            event.stopPropagation();
            if (event.detail !== 0 && button.dataset.rejectPointer === 'true') return;
            activate(descriptor.id);
          });
        }
        button.disabled = Boolean(descriptor.disabled);
        if (button.textContent !== descriptor.label) button.textContent = descriptor.label;
        button.setAttribute('aria-label', descriptor.label);
        button.style.left = `${descriptor.x / WIDTH * 100}%`;
        button.style.top = `${descriptor.y / HEIGHT * 100}%`;
        button.style.width = `${descriptor.w / WIDTH * 100}%`;
        button.style.height = `${descriptor.h / HEIGHT * 100}%`;
        // Keep live contacts and focus attached while Canvas-only status text changes.
        if (overlay.children[index] !== button) overlay.insertBefore(button, overlay.children[index] || null);
      });
      if (hadFocus) {
        const available = Array.from(overlay.children).filter(button => !button.disabled);
        const matching = available.find(button => button.dataset.buttonId === focusedId);
        const next = matching || available[0];
        if (next && next !== document.activeElement) next.focus({ preventScroll: true });
      }
    }

    function logicalPoint(event) {
      const bounds = canvas.getBoundingClientRect();
      return { x: (event.clientX - bounds.left) * WIDTH / bounds.width, y: (event.clientY - bounds.top) * HEIGHT / bounds.height };
    }
    canvas.addEventListener('pointerdown', event => {
      if (stopped || pointer || !event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
      void audio.unlock();
      if (game.state !== 'playing') return;
      event.preventDefault();
      const point = logicalPoint(event);
      pointer = { id: event.pointerId, x: point.x, y: point.y };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', event => {
      if (!pointer || pointer.id !== event.pointerId) return;
      event.preventDefault();
      const point = logicalPoint(event);
      if (game.state === 'playing') game.moveBy(point.x - pointer.x, point.y - pointer.y);
      pointer.x = point.x;
      pointer.y = point.y;
    });
    function releasePointer(event) {
      if (!pointer || pointer.id !== event.pointerId) return;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      pointer = null;
    }
    canvas.addEventListener('pointerup', releasePointer);
    canvas.addEventListener('pointercancel', releasePointer);
    canvas.addEventListener('lostpointercapture', releasePointer);

    const movementKeys = new Set(['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'w', 'a', 's', 'd']);
    window.addEventListener('keydown', event => {
      if (stopped || event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (movementKeys.has(key) && game.state === 'playing') { event.preventDefault(); keys.add(key); void audio.unlock(); }
      if ((key === 'r' || key === 'b') && game.state === 'playing' && !event.repeat) {
        event.preventDefault();
        activate(key === 'r' ? 'support' : 'bomb');
      }
      if ((key === 'p' || key === 'escape') && !event.repeat) {
        if (game.isActive()) { event.preventDefault(); suspend(); }
        else if (game.state === 'paused') { event.preventDefault(); activate('resume'); }
      }
    });
    window.addEventListener('keyup', event => keys.delete(event.key.toLowerCase()));

    function frame(timestamp) {
      if (stopped) return;
      try {
        let dt = lastFrame === null ? 0 : (timestamp - lastFrame) / 1000;
        if (!Number.isFinite(dt) || dt < 0) throw new Error(`无效的动画帧间隔：${dt} 秒`);
        lastFrame = timestamp;
        if (dt > .25) {
          if (game.isActive()) {
            suspend();
            report('frame', `检测到 ${dt.toFixed(2)} 秒画面停顿，游戏已暂停，请手动继续。`, { elapsedSeconds: dt, state: game.state, stage: game.stage });
          } else lastFrame = null;
          dt = 0;
        }
        if (game.state === 'playing') {
          let dx = Number(keys.has('arrowright') || keys.has('d')) - Number(keys.has('arrowleft') || keys.has('a'));
          let dy = Number(keys.has('arrowdown') || keys.has('s')) - Number(keys.has('arrowup') || keys.has('w'));
          if (dx || dy) { const length = Math.hypot(dx, dy); game.moveBy(dx / length * 340 * dt, dy / length * 340 * dt); }
        }
        game.update(dt);
        if (game.state !== 'playing' && pointer) resetInput();
        ctx.setTransform(canvas.width / WIDTH, 0, 0, canvas.height / HEIGHT, 0, 0);
        renderer.draw(game, timestamp / 1000);
        syncButtons();
        frameId = requestAnimationFrame(frame);
      } catch (error) { fatal(error); }
    }
    syncButtons();
    loadingBox.remove();
    soundButton.disabled = false;
    frameId = requestAnimationFrame(frame);
  } catch (error) { fatal(error); }
})();
