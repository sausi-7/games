class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');

    // runtime refs
    this.cfg = null;
    this.player = null;
    this.spikes = null;
    this.stars = null;

    this.bgFar = null;
    this.bgNear = null;

    // world pacing
    this.scrollSpeed = 320;
    this.spawnStep = 84;

    this._enhancementsHooked = false;
    // UI
    this.hud = { score: 0, scoreText: null, bar: null, barFill: null, targetText: null };

    // state
    this._gp = null;
    this._gameOver = false;

    // input
    this.keys = null;
    this.pointer = null;

    // spawn
    this.rowsSpawned = 0;
    this.rowsToFinish = 120;
    this.spawnEvent = null;

    // timing (kept only to report timePlayed in payload; not shown as a timer)
    this._elapsed = 0;

    this._corridorCenterY = undefined;

    // wave passage tracking
    this.waveColumns = []; // array of {x, topY, botY, passed} objects
    this.lastPlayerX = 0;

    // target score
    this.targetPoints = 30; // default; can be overridden by cfg.gameplay.targetScore

    // --- Enhancement bookkeeping (Sausi_Dev enhancements) ---
    this.enhancementActive = true;
    this.effectCount = 0;
    this.maxEffects = 60; // conservative default
    this.activeEffects = new Set();
    this.activeTweens = new Set();
    this.activeParticles = new Set();
    this._perfThrottle = false;
  }

  // ------------------ PRELOAD ------------------
  preload() {
    this.cfg = this.registry.get('cfg') || {};

    const img = this.cfg.images1 || {};
    const images2 = this.cfg.images2 || {};
    const ui = this.cfg.ui || {};
    const aud = this.cfg.audio || {};
    const ss = this.cfg.spritesheets || {};
    const font = this.cfg.font || {};

    try {
      if (font.family && font.url && typeof window !== 'undefined' && window.loadFont) {
        window.loadFont(font.family, font.url);
      }
    } catch { }

    Object.entries(img).forEach(([key, url]) => {
      if (typeof url === 'string' && url.endsWith('.png')) this.load.image(key, url);
    });
    Object.entries(images2).forEach(([key, url]) => {
      if (typeof url === 'string' && url.endsWith('.png')) this.load.image(key, url);
    });
    Object.entries(ui).forEach(([key, url]) => {
      if (typeof url === 'string' && url.endsWith('.png')) this.load.image(key, url);
    });

    // images
    if (img.background) this.load.image('background', img.background);
    if (img.player) this.load.image('player', img.player);
    if (img.enemy) this.load.image('spike', img.enemy);
    if (img.collectible) this.load.image('star', img.collectible);
    if (img.platform) this.load.image('platform', img.platform);

    // required by other scenes (not used directly here)
    ['htpbox', 'ovrbox', 'replay', 'lvl_replay', 'lvlbox', 'next', 'playbtn', 'left', 'right', 'action'].forEach(k => {
      if (img[k]) this.load.image(k, img[k]);
    });

    // spritesheets (optional)
    for (const [key, meta] of Object.entries(ss)) {
      if (meta?.url && meta.frameWidth && meta.frameHeight) {
        this.load.spritesheet(key, meta.url, { frameWidth: meta.frameWidth, frameHeight: meta.frameHeight });
      }
    }

    // audio
    if (aud.bgm) this.load.audio('bgm', aud.bgm);
    if (aud.collect) this.load.audio('collect', aud.collect);
    if (aud.hit) this.load.audio('hit', aud.hit);
    if (aud.win) this.load.audio('win', aud.win);

    this.load.on('loaderror', f => console.warn('[SpaceWaves] Failed to load:', f?.key, f?.src));
  }

  // ------------------ CREATE ------------------
  create() {
    const W = (this.sys.game.config.width | 0) || 1080;
    const H = (this.sys.game.config.height | 0) || 1920;


    this.cleanupEffects();
    this.effectCount = 0;
    this._perfThrottle = false;
    this.activeEffects = new Set();
    this.activeTweens = new Set();
    this.activeParticles = new Set();

    // --- reset gameplay progression so replay starts EASY again ---
    this.rowsSpawned = 0;
    this.rowsToFinish = 120;           // will be recomputed below from gp.levelLength
    this._corridorCenterY = undefined; // force fresh corridor curve
    this.waveColumns = [];             // clear old wave tracking
    this.lastPlayerX = 0;

    // --- HARD RESET: tolerate restarts from Win/GameOver without changing them ---
    this.input.enabled = true;
    if (this.physics && this.physics.world) this.physics.world.resume();
    if (this.time) this.time.timeScale = 1;
    if (this.tweens) this.tweens.timeScale = 1;
    ['WinScene', 'GameOverScene'].forEach(k => { if (this.scene.isActive(k)) this.scene.stop(k); });

    // Gameplay tuning
    const gp = Object.assign({
      speed: 320,
      speedRampTo: 400,
      gravityY: 1000,
      holdAccel: 2600,
      maxRise: 420,
      maxFall: 620,
      levelLength: 9000,
      // BIGGER GAP = MORE SPACE BETWEEN SPIKES
      gapHeight: 500,      // was 380
      minGapHeight: 420,   // was 280; keep close to gapHeight if you don't want it to get too hard
      spikeSize: 48,
      starEveryN: 7,
      playerSize: { w: 72, h: 48 },
      targetScore: (this.cfg.gameplay?.targetScore ?? 30)
    }, (this.cfg.gameplay || {}));
    this._gp = gp;

    // set target from cfg if provided
    this.targetPoints = Math.max(1, gp.targetScore | 0);

    this.scrollSpeed = gp.speed;
    this.rowsToFinish = Math.max(40, Math.floor(gp.levelLength / this.spawnStep));
    this._elapsed = 0;
    this._gameOver = false;

    // Initialize wave tracking
    this.waveColumns = [];
    this.lastPlayerX = 0;

    // fallbacks
    this.ensureRectTexture('fallback_rect_64', 64, 64, 0x6655ff);
    this.ensureTriTexture('fallback_tri_48', 48, 48, 0xffd200);
    this.ensureStarTexture('fallback_star_36', 36, 36, 0xffee88);

    // background
    if (this.textures.exists('background')) {
      this.bgFar = this.add.tileSprite(W * 0.5, H * 0.5, W, H, 'background');
      // this.bgNear = this.add.tileSprite(W * 0.5, H * 0.5, W, H, 'background').setAlpha(0.35).setTint(0x3b1976);
    } else {
      this.add.rectangle(W / 2, H / 2, W, H, 0x200044);
    }

    // groups
    this.spikes = this.physics.add.group({ immovable: true, allowGravity: false });
    this.stars = this.physics.add.group({ immovable: true, allowGravity: false });

    // player
    const playerKey = this.textures.exists('player') ? 'player' : 'fallback_rect_64';
    this.player = this.physics.add.sprite(W * 0.25, H * 0.5, playerKey);
    // this.player.setDisplaySize(gp.playerSize.w + 50, gp.playerSize.h + 50);
    this.player.body.setAllowGravity(true);
    this.player.setCollideWorldBounds(true);
    this.player.body.setGravityY(gp.gravityY);
    // this.player.body.setSize(gp.playerSize.w * 1.7, gp.playerSize.h * 2);
    // this.player.body.setOffset(gp.playerSize.w * 0.15, gp.playerSize.h * 0.15);


    this.lastPlayerX = this.player.x;

    // input
    this.pointer = this.input.activePointer;
    this.keys = this.input.keyboard.addKeys({
      space: Phaser.Input.Keyboard.KeyCodes.SPACE,
      w: Phaser.Input.Keyboard.KeyCodes.W,
      up: Phaser.Input.Keyboard.KeyCodes.UP
    });

    // collisions
    this.physics.add.overlap(this.player, this.spikes, () => this.onCrash(), null, this);
    this.physics.add.overlap(this.player, this.stars, (_, star) => this.onCollect(star), null, this);

    // HUD
    this.scorebar = this.add.image(180, 70, 'scorebar')
    this.hud.score = 0;
    this.hud.scoreText = this.add.text(55, 40, `${(this.cfg.texts?.score_label ?? 'Score: ')}0`, {
      fontFamily: (this.cfg.font?.family || 'Arial'),
      fontSize: '52px',
      color: '#000000ff'
    }).setDepth(50);

    this.hud.bar = this.add.rectangle(W / 2, 44, Math.min(560, W * 0.7), 16, 0x3d2a66).setOrigin(0.5).setDepth(50);
    this.hud.barFill = this.add.rectangle(this.hud.bar.x - this.hud.bar.width / 2, this.hud.bar.y, 4, 10, 0xffd200)
      .setOrigin(0, 0.5).setDepth(51);

    // Replaces the old timer with a static target label
    this.scorebar1 = this.add.image(1750, 70, 'scorebar')
    this.hud.targetText = this.add.text(W - 50, 40, `Target: ${this.targetPoints}`, {
      fontFamily: (this.cfg.font?.family || 'Arial'),
      fontSize: '52px',
      color: '#0a0a0aff',
      align: 'right'
    }).setOrigin(1, 0).setDepth(50);

    // audio
    this.sfx = {
      collect: this.cache.audio.exists('collect') ? this.sound.add('collect', { volume: 0.7 }) : null,
      hit: this.cache.audio.exists('hit') ? this.sound.add('hit', { volume: 0.9 }) : null,
      win: this.cache.audio.exists('win') ? this.sound.add('win', { volume: 0.9 }) : null
    };
    if (this.cache.audio.exists('bgm')) {
      this.bgm = this.sound.add('bgm', { loop: true, volume: 0.45 });
      this.bgm.play();
    }

    // immediate visible rows
    for (let i = 0; i < 8; i++) {
      const x = W - 220 + i * this.spawnStep;
      this.spawnWaveRow(x, H, gp, i < 3);
      if (i % Math.max(1, gp.starEveryN) === 0) this.placeStar(x + 10, H * 0.5);
      this.rowsSpawned++;
    }

    // timed spawner
    this.spawnEvent = this.time.addEvent({
      delay: 230,
      loop: true,
      callback: () => {
        const x = this.sys.game.config.width + 60;
        this.spawnWaveRow(x, this.sys.game.config.height, gp, false);

        if (this.rowsSpawned % Math.max(1, gp.starEveryN) === 0) {
          this.placeStar(x + 10, this._corridorCenterY || (this.sys.game.config.height * 0.5));
        }

        this.rowsSpawned++;
      }
    });

    // hint
    const hint = this.add.text(W / 2, H * 0.86, 'Hold to rise • Release to fall • Stay in the passage!', {
      fontFamily: (this.cfg.font?.family || 'Arial'),
      fontSize: '32px',
      color: '#ffffff'
    }).setOrigin(0.5).setAlpha(0.95);
    this.tweens.add({ targets: hint, alpha: 0, duration: 1600, delay: 1000, onComplete: () => hint.destroy() });

    // --- Setup visual enhancements (non-destructive) ---
    try {
      this.setupEnhancements();
    } catch (e) {
      console.warn('Enhancement setup failed safely:', e);
    }
  }

  // ------------------ UPDATE ------------------
  update(_, deltaMs) {
    if (this._gameOver) return;

    const dt = Math.max(0.016, deltaMs / 1000);
    const gp = this._gp;
    const H = this.sys.game.config.height;

    // track playtime for payload only
    this._elapsed += dt;

    // Check if player hit the bottom
    if (this.player.y >= H - 20) {
      this.onCrash();
      return;
    }

    // hold-to-rise
    let vy = this.player.body.velocity.y;
    const holding =
      (this.pointer && this.pointer.isDown) ||
      (this.keys.space && this.keys.space.isDown) ||
      (this.keys.w && this.keys.w.isDown) ||
      (this.keys.up && this.keys.up.isDown);

    if (holding) { vy -= gp.holdAccel * dt; vy = Math.max(vy, -gp.maxRise); }
    vy = Math.min(vy, gp.maxFall);
    this.player.setVelocityY(vy);
    this.player.setAngle(Phaser.Math.Clamp(vy * 0.06, -30, 30));

    // horizontal scroll
    this.scrollSpeed = Phaser.Math.Linear(this.scrollSpeed, gp.speedRampTo || gp.speed, 0.06 * dt * 60);
    const move = this.scrollSpeed * dt;

    if (this.bgFar) this.bgFar.tilePositionX += move * 0.3;
    // if (this.bgNear) this.bgNear.tilePositionX += move * 0.55;

    this.shiftGroup(this.spikes, -move);
    this.shiftGroup(this.stars, -move);

    // Update wave columns positions
    this.waveColumns.forEach(wave => wave.x -= move);

    this.cullGroup(this.spikes, -160);
    this.cullGroup(this.stars, -160);

    // Check wave passage
    this.checkWavePassage();

    // Clean up old wave columns
    this.waveColumns = this.waveColumns.filter(wave => wave.x > -200);

    // progress bar
    const p = Phaser.Math.Clamp(this.rowsSpawned / Math.max(1, (this.rowsToFinish + 8)), 0, 1);
    const fullW = this.hud.bar.width - 8;
    this.hud.barFill.width = 4 + fullW * p;

    // performance monitor (enhancement)
    try { this.monitorPerformance(); } catch (e) { /* degrade silently */ }

    this.lastPlayerX = this.player.x;
  }

  // ------------------ WAVE PASSAGE CHECKING ------------------
  checkWavePassage() {
    const playerX = this.player.x;
    const playerY = this.player.y;
    const playerRadius = Math.max(this._gp.playerSize.w, this._gp.playerSize.h) * 0.4;

    for (let wave of this.waveColumns) {
      if (!wave.passed && wave.x < playerX && playerX > this.lastPlayerX) {
        const inGap = playerY > (wave.topY + playerRadius) && playerY < (wave.botY - playerRadius);
        if (!inGap) {
          this.onCrash();
          return;
        } else {
          wave.passed = true;
        }
      }
    }
  }

  // ------------------ COLLISIONS / ENDINGS ------------------
  onCrash() {
    if (this._gameOver) return;
    this._gameOver = true;

    this.sfx.hit && this.sfx.hit.play();
    this.makeShockwave(this.player.x, this.player.y);

    const payload = { score: this.hud.score, timePlayed: Math.floor(this._elapsed) };
    this.haltWorld();
    this.scene.start('GameOverScene', payload);
  }

  onCollect(star) {
    if (!star?.active) return;
    star.disableBody(true, true);
    star.destroy();

    this.hud.score += 1;
    this.sfx.collect && this.sfx.collect.play();
    this.makeSpark(star.x, star.y);
    this.hud.scoreText.setText(`${(this.cfg.texts?.score_label ?? 'Score: ')}${this.hud.score}`);

    // WIN when reaching target points
    if (this.hud.score >= this.targetPoints) {
      this.onWin();
    }
  }

  onWin() {
    if (this._gameOver) return;
    this._gameOver = true;

    this.sfx.win && this.sfx.win.play();
    const payload = { score: this.hud.score, timePlayed: Math.floor(this._elapsed) };
    this.haltWorld();
    this.scene.start('WinScene', payload);
  }

  // -------- Robust end-of-level stopper (scene-local only) --------
  haltWorld() {
    if (this.bgm && this.bgm.isPlaying) { try { this.bgm.stop(); } catch { } }
    if (this.spawnEvent) { try { this.spawnEvent.remove(false); } catch { }; this.spawnEvent = null; }
    if (this._levelEndCall && !this._levelEndCall.hasDispatched) { // _levelEndCall no longer used; keep safe guard
      try { this._levelEndCall.remove(false); } catch { }
      this._levelEndCall = null;
    }
    try { this.physics.world.pause(); } catch { }
    try { this.tweens.killAll(); } catch { }
    try { this.time.removeAllEvents(); } catch { }

    this.cleanupEffects();
  }

  // ------------------ HELPERS ------------------
  shiftGroup(group, dx) { group.children.each(child => { child.x += dx; }); }

  cullGroup(group, leftBoundX) {
    group.children.each(child => {
      if (child.active && child.x < leftBoundX) group.remove(child, true, true);
    });
  }

  // ---- VFX helpers (original) ----
  makeShockwave(x, y) {
    const g = this.add.graphics();
    g.lineStyle(3, 0xffd200, 1);
    const circle = { r: 8 };
    const tw = this.tweens.add({
      targets: circle,
      r: 60,
      duration: 240,
      onUpdate: () => {
        g.clear();
        g.lineStyle(3, 0xffd200, 0.85);
        g.strokeCircle(x, y, circle.r);
      },
      onComplete: () => g.destroy()
    });
    this.activeTweens.add(tw);
  }

  makeSpark(x, y) {
    const g = this.add.graphics({ x, y });
    g.fillStyle(0xfff1a8, 1);
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI * 2 / 6) * i;
      g.fillCircle(Math.cos(a) * 6, Math.sin(a) * 6, 2.6);
    }
    const tw = this.tweens.add({ targets: g, alpha: 0, duration: 220, onComplete: () => g.destroy() });
    this.activeTweens.add(tw);
  }

  // ------------------ SPAWNING ------------------
  spawnWaveRow(worldX, H, gp, easy) {
    if (this._corridorCenterY === undefined) this._corridorCenterY = H * 0.5;

    if (this.rowsSpawned < 5) {
      this._corridorCenterY = H * 0.5;
    } else {
      const t = this.rowsSpawned * 0.08;
      const desired = H * (0.4 + 0.25 * Math.sin(t));
      this._corridorCenterY = Phaser.Math.Linear(this._corridorCenterY, desired, easy ? 0.08 : 0.12);
    }

    const diffRatio = Phaser.Math.Clamp(this.rowsSpawned / Math.max(1, this.rowsToFinish), 0, 1);
    const gap = Phaser.Math.Linear(gp.gapHeight, gp.minGapHeight, diffRatio);

    const topY = this._corridorCenterY - gap * 0.5;
    const botY = this._corridorCenterY + gap * 0.5;

    this.waveColumns.push({ x: worldX, topY, botY, passed: false });

    this.placeSpike(worldX, topY - gp.spikeSize * 0.52, true, gp);
    this.placeSpike(worldX, botY + gp.spikeSize * 0.52, false, gp);
  }

  placeSpike(x, y, flipDown, gp) {
    const key = this.textures.exists('spike') ? 'spike' : 'fallback_tri_48';
    const s = this.spikes.get(x, y, key) || this.spikes.create(x, y, key);
    s.setActive(true).setVisible(true).setImmovable(true).setDepth(5);
    s.setDisplaySize(gp.spikeSize, gp.spikeSize);
    s.body.setAllowGravity(false);
    s.setAngle(flipDown ? 180 : 0);

    // enhancement: subtle spawn pop
    try {
      this.safeEnhance(() => {
        const origScaleX = s.scaleX || 1;
        const origScaleY = s.scaleY || 1;
        s.setScale(0.01, 0.01);
        const tw = this.tweens.add({
          targets: s,
          scaleX: origScaleX,
          scaleY: origScaleY,
          duration: 260,
          ease: 'Back.easeOut',
          onComplete: () => { s.setScale(origScaleX, origScaleY); }
        });
        this.activeTweens.add(tw);
      }, () => { /* fallback: do nothing */ });
    } catch (e) { /* silent */ }
  }

  placeStar(x, y) {
    const key = this.textures.exists('star') ? 'star' : 'fallback_star_36';
    const st = this.stars.get(x, y, key) || this.stars.create(x, y, key);
    st.setActive(true).setVisible(true).setDepth(4);
    st.setDisplaySize(66, 66);
    st.body.setAllowGravity(false);

    // enhancement: gentle float & pulse
    try {
      this.safeEnhance(() => {
        const baseY = st.y;
        const floatTw = this.tweens.add({
          targets: st,
          y: baseY - 8,
          yoyo: true,
          repeat: -1,
          duration: 900 + Math.random() * 400,
          ease: 'Sine.easeInOut'
        });
        const pulseTw = this.tweens.add({
          targets: st,
          scaleX: 1.08,
          scaleY: 1.08,
          yoyo: true,
          repeat: -1,
          duration: 800,
          ease: 'Sine.easeInOut'
        });
        this.activeTweens.add(floatTw);
        this.activeTweens.add(pulseTw);
      });
    } catch (e) { /* degrade gracefully */ }
  }

  // ------------------ FALLBACKS ------------------
  ensureRectTexture(key, w, h, color) {
    if (this.textures.exists(key)) return;
    const g = this.make.graphics({ add: false });
    g.fillStyle(color, 1); g.fillRoundedRect(0, 0, w, h, 10); g.generateTexture(key, w, h); g.destroy();
  }
  ensureTriTexture(key, w, h, color) {
    if (this.textures.exists(key)) return;
    const g = this.make.graphics({ add: false });
    g.fillStyle(color, 1);
    g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w, h); g.lineTo(0, h); g.closePath(); g.fillPath();
    g.generateTexture(key, w, h); g.destroy();
  }
  ensureStarTexture(key, w, h, color) {
    if (this.textures.exists(key)) return;
    const g = this.make.graphics({ add: false });
    g.fillStyle(color, 1);
    const cx = w / 2, cy = h / 2, R = w / 2, r = R * 0.45;
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const ang = -Math.PI / 2 + i * (Math.PI / 5);
      const rad = (i % 2 === 0) ? R : r;
      const x = cx + Math.cos(ang) * rad;
      const y = cy + Math.sin(ang) * rad;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath(); g.fillPath();
    g.generateTexture(key, w, h); g.destroy();
  }

  // ------------------ Sausi_Dev Enhancement Framework ------------------
  safeEnhance(fn, fallback = () => { }) {
    try {
      if (!this.enhancementActive) return;
      // throttle if too many effects
      if (this.effectCount > this.maxEffects) return;
      this.effectCount++;
      const res = fn.call(this);
      // allow effectCount to decrement when possible
      this.time.delayedCall(800, () => { this.effectCount = Math.max(0, this.effectCount - 1); });
      return res;
    } catch (error) {
      console.warn('Enhancement failed safely:', error);
      try { fallback.call(this); } catch (e) { /* ignore */ }
    }
  }

  monitorPerformance() {
    try {
      if (!this.enhancementActive) return;
      const fps = (this.game && this.game.loop) ? this.game.loop.actualFps : 60;
      if (fps && fps < 45 && !this._perfThrottle) {
        this._perfThrottle = true;
        // reduce particle frequency and stop non-essential tweens
        this.activeTweens.forEach(t => { try { t.pause && t.pause(); } catch { } });
        // after 2s try to resume
        this.time.delayedCall(2000, () => { this._perfThrottle = false; this.activeTweens.forEach(t => { try { t.resume && t.resume(); } catch { } }); });
      }
    } catch (e) { /* degrade silently */ }
  }

  cleanupEffects() {
    try {
      this.activeParticles.forEach(p => { try { p.destroy && p.destroy(); } catch { } });
      this.activeTweens.forEach(t => { try { t.stop && t.stop(); } catch { } });
      this.activeEffects.forEach(e => { try { e.destroy && e.destroy(); } catch { } });
      this.activeParticles.clear(); this.activeTweens.clear(); this.activeEffects.clear();
    } catch (e) { /* ignore */ }
  }

  addScreenShake(intensity = 0.006, duration = 150) {
    try {
      this.safeEnhance(() => {
        this.cameras.main.shake(duration, intensity);
      });
    } catch (e) { /* ignore */ }
  }

  createCollectionEffect(x, y) {
    this.safeEnhance(() => {
      const tex = this.textures.exists('star') ? 'star' : 'fallback_star_36';
      const p = this.add.particles(tex);
      const emitter = p.createEmitter({
        x, y,
        speed: { min: 80, max: 180 },
        lifespan: 400,
        gravityY: 200,
        scale: { start: 0.6, end: 0.1 },
        quantity: 6
      });
      this.activeParticles.add(p);
      this.time.delayedCall(450, () => { try { emitter.stop(); p.destroy(); this.activeParticles.delete(p); } catch { } });
    });
  }

  createHitEffect(x, y) {
    this.safeEnhance(() => {
      const tex = this.textures.exists('spike') ? 'spike' : 'fallback_tri_48';
      const p = this.add.particles(tex);
      const emitter = p.createEmitter({
        x, y,
        speed: { min: 120, max: 260 },
        lifespan: 420,
        scale: { start: 0.6, end: 0.05 },
        angle: { min: 0, max: 360 },
        quantity: 8
      });
      this.activeParticles.add(p);
      this.time.delayedCall(500, () => { try { emitter.stop(); p.destroy(); this.activeParticles.delete(p); } catch { } });
    });
  }

  // ------------------ Enhancement wiring ------------------
  setupEnhancements() {

    if (this._enhancementsHooked) return;  // don't wrap twice
    this._enhancementsHooked = true;
    // Hook into spawn functions by wrapping them (non-destructive)
    try {
      const origPlaceSpike = this.placeSpike.bind(this);
      this.placeSpike = (x, y, flipDown, gp) => {
        const s = origPlaceSpike(x, y, flipDown, gp);
        // placeSpike already returns undefined; we enhanced inside original to animate
        return s;
      };

      const origPlaceStar = this.placeStar.bind(this);
      this.placeStar = (x, y) => {
        const st = origPlaceStar(x, y);
        // additionally attach a small pickup hint tween when star is created
        try {
          this.safeEnhance(() => {
            const hint = this.add.circle(x, y, 2, 0xfff1a8, 0.9).setDepth(6);
            const tw = this.tweens.add({ targets: hint, y: y - 18, alpha: 0, duration: 700, ease: 'Power2', onComplete: () => hint.destroy() });
            this.activeTweens.add(tw);
          });
        } catch (e) { }
        return st;
      };

      // Wrap onCrash to add screen shake and hit effect visually (safe)
      const origOnCrash = this.onCrash.bind(this);
      this.onCrash = () => {
        this.safeEnhance(() => {
          this.addScreenShake(0.01, 220);
          this.createHitEffect(this.player.x, this.player.y);
        });
        return origOnCrash();
      };

      // Wrap onCollect to add collection particle effect near player
      const origOnCollect = this.onCollect.bind(this);
      this.onCollect = (star) => {
        // call original first to preserve exact logic order
        const res = origOnCollect(star);
        try {
          this.safeEnhance(() => {
            const x = (star && star.x) || this.player.x;
            const y = (star && star.y) || this.player.y;
            this.createCollectionEffect(x, y);
            // small score popup
            const scorePop = this.add.text(this.player.x, this.player.y - 40, '+1', { fontSize: '28px', fontFamily: (this.cfg.font?.family || 'Arial'), color: '#fff3b0' }).setOrigin(0.5).setDepth(60);
            const tw = this.tweens.add({ targets: scorePop, y: scorePop.y - 40, alpha: 0, duration: 700, ease: 'Power2', onComplete: () => scorePop.destroy() });
            this.activeTweens.add(tw);
          });
        } catch (e) { /* ignore */ }
        return res;
      };

      // Hook into SFX objects if present to attach visual sync
      try {
        ['collect', 'hit', 'win'].forEach(k => {
          const sfxObj = this.sfx && this.sfx[k];
          if (sfxObj && typeof sfxObj.play === 'function') {
            const origPlay = sfxObj.play.bind(sfxObj);
            sfxObj.play = (config) => {
              const res = origPlay(config);
              // visual hooks
              this.safeEnhance(() => {
                if (k === 'collect') this.createCollectionEffect(this.player.x, this.player.y - 10);
                if (k === 'hit') this.createHitEffect(this.player.x, this.player.y);
                if (k === 'win') { this.addScreenShake(0.012, 260); }
              });
              return res;
            };
          }
        });
      } catch (e) { /* ignore */ }

      // Ensure cleanup when scene shuts down
      this.events.on('shutdown', () => { try { this.cleanupEffects(); } catch (e) { } });
      this.events.on('destroy', () => { try { this.cleanupEffects(); } catch (e) { } });

    } catch (e) {
      console.warn('setupEnhancements failed:', e);
    }
  }
}
