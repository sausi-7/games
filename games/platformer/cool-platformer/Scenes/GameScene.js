class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');

    // Core state
    this.cfg = null;
    this.W = 1920;
    this.H = 1080;

    // Entities
    this.feather = null;
    this.nest = null;
    this.walls = null;
    this.spikes = null;
    this.rotors = null;
    this.fans = null;

    // UI
    this.ui = { timerText: null };

    // Input
    this.cursors = null;
    this.mobile = { left: null, right: null, action: null };
    this.inputs = { left: false, right: false, up: false };

    // Audio
    this.sfx = { collect: null, hit: null, win: null, gameover: null };
    this.bgm = null;

    // Timer / difficulty
    this.timeLeft = 0; // seconds
    this._ended = false;

    // FX handles
    // FX handles (emitter-free)
    this.fx = {
      trailTimer: null,        // Phaser.Time.TimerEvent while fan push is active
      trailOn: false,
      dotKeyWhite: '_fx_white',
      dotKeyYellow: '_fx_yellow',
      dotKeyRed: '_fx_red',
      poolWhite: [],
      poolYellow: [],
      poolRed: []
    };

  }

  init() {
    // Reset per-run state so Replay starts fresh
    this._ended = false;
    this.timeLeft = 0;

    // Clear input flags and button refs
    this.inputs = { left: false, right: false, up: false };
    this.cursors = null;
    this.mobile = { left: null, right: null, action: null };

    // Ensure systems are enabled if a prior scene paused them
    if (this.input) this.input.enabled = true;
    if (this.physics && this.physics.world) this.physics.world.timeScale = 1;

    // Make sure cfg is available early (preload will self-heal if missing)
    this.cfg = this.registry.get('cfg') || null;

    // Stop any lingering audio from the previous run
    if (this.sound) this.sound.stopAll();
  }

  preload() {
    // Try to get cfg from registry
    this.cfg = this.registry.get('cfg');

    // If cfg missing or malformed, self-load it
    if (!this.cfg || typeof this.cfg !== 'object' || !this.cfg.images1) {
      this.load.json('cfg_json_autoload', 'config.json');
    }
    if (!this.cfg || typeof this.cfg !== 'object' || !this.cfg.images2) {
      this.load.json('cfg_json_autoload', 'config.json');
    }
    if (!this.cfg || typeof this.cfg !== 'object' || !this.cfg.ui) {
      this.load.json('cfg_json_autoload', 'config.json');
    }

    this.load.once('complete', () => {
      if (!this.cfg || !this.cfg.images) {
        const auto = this.cache.json.get('cfg_json_autoload');
        if (auto) {
          this.registry.set('cfg', auto);
          this.cfg = auto;
        }
      }

      // Now that cfg is guaranteed, enqueue assets
      const images = (this.cfg && this.cfg.images) || {};
      Object.entries(images).forEach(([key, url]) => {
        if (url && !this.textures.exists(key)) this.load.image(key, url);
      });

      const sheets = (this.cfg && this.cfg.spritesheets) || {};
      Object.entries(sheets).forEach(([key, s]) => {
        if (s && s.url && !this.textures.exists(key)) {
          this.load.spritesheet(key, s.url, {
            frameWidth: s.frameWidth,
            frameHeight: s.frameHeight,
            endFrame: s.frames || -1,
          });
        }
      });

      const audio = (this.cfg && this.cfg.audio) || {};
      Object.entries(audio).forEach(([key, url]) => {
        if (url && !this.cache.audio.exists(key)) this.load.audio(key, url);
      });

      // If we queued anything, load it now; otherwise continue to create()
      if (this.load.totalToLoad > 0) this.load.start();
    });

    // Kick the first (possibly empty) load to trigger the 'complete' above
    this.load.start();
  }

  create() {
    // Allow multi-touch for on-screen buttons
    this.input.addPointer(3);

    const gp = this.cfg.gameplay || {};
    const img = this.cfg.images2 || {};
    const aud = this.cfg.audio || {};
    const texts = (this.cfg.texts || {});

    const screenW = this.sys.game.config.width || this.W;
    const screenH = this.sys.game.config.height || this.H;

    // Safety: make sure nothing is paused from previous scene
    this.input.enabled = true;
    this.physics.world.timeScale = 1;

    // Physics world
    this.physics.world.setBounds(0, 0, screenW, screenH);
    this.add.zone(screenW / 2, screenH / 2, screenW, screenH).setOrigin(0.5);

    // Background (optional)
    if (img.background) {
      const bg = this.add.image(screenW / 2, screenH / 2, 'background');
      bg.setDisplaySize(screenW, screenH);
      bg.setDepth(-100);
    }

    // Groups
    this.walls = this.add.group(); // visuals only
    this.spikes = this.physics.add.staticGroup();
    this.rotors = this.physics.add.group({ immovable: true, allowGravity: false });
    this.fans = this.add.group(); // fan icons + fan zones

    // Level layout — IMPORTANT: pass KEYS (not URLs)
    this._buildLevel(screenW, screenH);

    // Feather (player)
    const pW = gp.playerWidth ?? gp.playerSize ?? 72;
    const pH = gp.playerHeight ?? gp.playerSize ?? 72;
    this.feather = this.add.sprite(160, screenH - 160, 'player');
    this.feather.setDisplaySize(pW, pH);
    this.physics.add.existing(this.feather);
    this.feather.body.setCollideWorldBounds(true);
    this.feather.body.setAllowGravity(false);
    this.feather.body.setDrag(220, 220);
    this.feather.body.setMaxVelocity(500, 500);
    this._setBodySizeToDisplay(this.feather);

    // (Your custom override hitbox—keeping as-is)
    this.feather.body.setSize(330, 700);
    this.feather.body.setOffset(10, 10);

    // Nest (goal)
    this.nest = this.add.sprite(screenW - 170, 140, 'nest');
    this.nest.setDisplaySize(96, 96);
    this.physics.add.existing(this.nest, true);
    this._setBodySizeToDisplay(this.nest);

    // Colliders & overlaps
    this.physics.add.collider(this.feather, this._platforms);
    this.physics.add.overlap(this.feather, this.spikes, () => this._gameOver(), null, this);
    this.physics.add.overlap(this.feather, this.rotors, () => this._gameOver(), null, this);
    this.physics.add.overlap(this.feather, this.nest, () => this._win(), null, this);

    // Inputs
    this.cursors = this.input.keyboard.createCursorKeys();
    this._makeMobileButtons(); // now uses keys directly ('left','right','action')

    // UI
    this.timeLeft = gp.timerSeconds || 60;
    const label = (texts.score_label || 'Time Left: ');
    this.ui.timerText = this.add.text(screenW / 2, 40, `${label}${this.timeLeft}`, {
      fontFamily: (this.cfg.font && this.cfg.font.family) || 'Outfit',
      fontSize: '38px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 4,
    }).setOrigin(0.5, 0);

    // Audio init
    if (aud.collect) this.sfx.collect = this.sound.add('collect', { volume: 0.7 });
    if (aud.hit) this.sfx.hit = this.sound.add('hit', { volume: 0.8 });
    if (aud.win) this.sfx.win = this.sound.add('win', { volume: 0.9 });
    if (aud.gameover) this.sfx.gameover = this.sound.add('gameover', { volume: 0.9 });
    if (aud.bgm) {
      this.bgm = this.sound.add('bgm', { loop: true, volume: 0.4 });
      this.bgm.play();
    }

    // --- FX bootstrap ---
    this._initFX();

    // Countdown timer
    this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        if (this._ended) return;
        this.timeLeft = Math.max(0, this.timeLeft - 1);
        this.ui.timerText.setText(`${label}${this.timeLeft}`);
        if (this.timeLeft <= 0) this._gameOver();
      },
    });
  }

  update(_, dt) {
    if (this._ended || !this.feather) return;

    const gp = this.cfg.gameplay || {};
    const speed = gp.playerSpeed || 240;

    // Read keyboard states into locals (do not overwrite touch flags)
    const kLeft = !!this.cursors.left?.isDown;
    const kRight = !!this.cursors.right?.isDown;
    const kUp = !!this.cursors.up?.isDown;
    const kDown = !!this.cursors.down?.isDown;

    // Effective inputs = keyboard OR touch buttons
    const leftHeld = kLeft || this.inputs.left;
    const rightHeld = kRight || this.inputs.right;
    const upHeld = kUp || this.inputs.up;

    // Apply wind-burst impulses (small constant accelerations)
    if (leftHeld) this.feather.body.velocity.x -= (speed * dt / 1000) * 3.2;
    if (rightHeld) this.feather.body.velocity.x += (speed * dt / 1000) * 3.2;
    if (upHeld) this.feather.body.velocity.y -= (speed * dt / 1000) * 3.2;

    // Optional brake (DOWN key)
    if (kDown) this.feather.body.velocity.scale(0.96);

    // Fans & rotors
    this._applyFanForces(dt);
    this._spinRotors(dt);
  }

  // ------- LEVEL BUILDERS -------

  _buildLevel(W, H) {
    // Use KEYS that match what we loaded in preload()
    const PLATFORM = 'platform';
    const PLATFORM2 = 'platform2';
    const SPIKE = 'spike';
    const ROTOR = 'enemy';
    const FAN = 'fan';
    const gp = this.cfg.gameplay || {};
    const rCfg = gp.rotors || []; // e.g., [{w:90,h:90},{w:70,h:70},{w:110,h:110}]

    this._platforms = this.physics.add.staticGroup();

    // Outer frame
    this._addPlatform(W / 2, H - 20, W - 80, 32, PLATFORM);
    this._addPlatform(W / 2, 20, W - 80, 32, PLATFORM);
    this._addPlatform(20, H / 2, 32, H - 80, PLATFORM);
    this._addPlatform(W - 20, H / 2, 32, H - 80, PLATFORM);

    // Inner walls (simple zig path)
    this._addPlatform(W * 0.50, H * 0.75, W * 0.60, 24, PLATFORM2);
    this._addPlatform(W * 0.25, H * 0.55, W * 0.50, 24, PLATFORM2);
    this._addPlatform(W * 0.65, H * 0.40, W * 0.50, 24, PLATFORM2);
    this._addPlatform(W * 0.40, H * 0.25, W * 0.55, 24, PLATFORM2);
    // Safety ledge under the nest
    this._addPlatform(W - 170, 290, 260, 24, 'platform2');

    // Hazards
    this._addSpikeRow(W * 0.50, H * 0.72, 6, SPIKE);
    this._addSpikeRow(W * 0.20, H * 0.52, 5, SPIKE);
    this._addSpikeRow(W * 0.75, H * 0.37, 5, SPIKE);

    // Rotors
    const r0 = rCfg[0] || {};
    const r1 = rCfg[1] || {};
    const r2 = rCfg[2] || {};
    this._addRotor(W * 0.75, H * 0.72, ROTOR, r0.w, r0.h);
    this._addRotor(W * 0.40, H * 0.52, ROTOR, r1.w, r1.h);
    this._addRotor(W * 0.60, H * 0.28, ROTOR, r2.w, r2.h);

    // Fans (directional pushers)
    this._addFan(W * 0.32, H * 0.80, 160, 140, 0, FAN);     // push right
    this._addFan(W * 0.86, H * 0.60, 160, 140, -90, FAN);   // push up
    this._addFan(W * 0.70, H * 0.33, 180, 160, 180, FAN);   // push left
    this._addFan(W * 0.48, H * 0.18, 120, 120, -90, FAN);   // push up (narrow)
  }

  _addPlatform(x, y, w, h, key) {
    const s = this.add.sprite(x, y, key);
    s.setDisplaySize(w, h);
    s.setDepth(-1);
    this._setBodyStaticToSprite(s);
    this._platforms.add(s);
  }

  _addSpikeRow(cx, cy, count, key) {
    const sz = (this.cfg.gameplay?.spikeSize) || 48;
    const gap = sz * 1.1;
    const startX = cx - ((count - 1) * gap) / 2;

    for (let i = 0; i < count; i++) {
      const sp = this.spikes.create(startX + i * gap, cy, key);
      sp.setDisplaySize(sz, sz);
      sp.refreshBody();         // important for static body
      sp.body.setSize(sz, sz);
    }
  }

  _addRotor(x, y, key, w, h) {
    const gw = this.cfg.gameplay || {};
    const rW = (w ?? gw.rotorWidth ?? gw.rotorSize ?? 82);
    const rH = (h ?? gw.rotorHeight ?? gw.rotorSize ?? 82);

    const rot = this.rotors.create(x, y, key);
    rot.setDisplaySize(rW, rH);
    rot.setImmovable(true);
    rot.body.allowGravity = false;

    // Manual hitbox (custom tuning kept from your code)
    rot.body.setSize(rW * 1.1, rH * 2.2);
    rot.body.setOffset(rW * 0.2, rH * 0.2);
    rot.setData('baseSpeed', (gw.rotorSpeed) || 100); // deg/sec
  }

  _addFan(x, y, w, h, angleDeg, key) {
    const fan = this.add.sprite(x, y, key);
    fan.setDisplaySize(80, 80);
    fan.setAngle(angleDeg);

    // Invisible push zone
    const zone = this.add.zone(x, y, w, h);
    this.physics.add.existing(zone, false);
    zone.body.setAllowGravity(false);
    zone.body.moves = false;
    zone.setData('angle', angleDeg);
    zone.setData('power', (this.cfg.gameplay?.fanStrength) || 140);

    this.fans.add(fan);
    this.fans.add(zone);
  }

  // ------- RUNTIME HELPERS -------

  _applyFanForces(dt) {
    const list = this.fans.getChildren();
    if (!list || list.length === 0) return;
    const feather = this.feather;

    const difficultyBoost = Phaser.Math.Linear(
      1.0,
      1.5,
      1 - (this.timeLeft / (this.cfg.gameplay?.timerSeconds || 60))
    );

    let anyInside = false;

    for (const obj of list) {
      if (!obj.body) continue; // only zones have bodies

      const b = obj.body;
      const inside =
        feather.x > b.left && feather.x < b.right &&
        feather.y > b.top && feather.y < b.bottom;

      if (inside) {
        anyInside = true;
        const power = (obj.getData('power') || 140) * difficultyBoost;
        const angleDeg = obj.getData('angle') || 0;
        const rad = Phaser.Math.DegToRad(angleDeg);
        const ax = Math.cos(rad) * power * (dt / 1000) * 120;
        const ay = Math.sin(rad) * power * (dt / 1000) * 120;
        feather.body.velocity.x += ax;
        feather.body.velocity.y += ay;
      }
    }

    // ---- Fan push FX (trail while inside any fan) ----
    // When inside any fan zone:
    // ---- Fan push FX (trail while inside any fan) ----
    if (anyInside && !this.fx.trailOn) {
      this.fx.trailOn = true;
      this.cameras.main.shake(100, 0.002);
      // Emit small trail dots at ~25 FPS-ish (every 40ms)
      this.fx.trailTimer = this.time.addEvent({
        delay: 40,
        loop: true,
        callback: () => {
          if (!this.feather || !this.feather.active) return;
          // 2 dots per tick for density similar to a low-intensity emitter
          this._spawnTrailDot(this.feather.x, this.feather.y);
          this._spawnTrailDot(this.feather.x, this.feather.y);
        }
      });
    } else if (!anyInside && this.fx.trailOn) {
      this.fx.trailOn = false;
      if (this.fx.trailTimer) { this.fx.trailTimer.remove(); this.fx.trailTimer = null; }
    }


  }

  _spinRotors(dt) {
    const list = this.rotors.getChildren();
    if (!list) return;

    const pct = 1 - (this.timeLeft / (this.cfg.gameplay?.timerSeconds || 60));
    const mul = Phaser.Math.Linear(1.0, 1.6, pct);

    for (const r of list) {
      const base = r.getData('baseSpeed') || 100;
      r.angle += base * mul * (dt / 1000);
    }
  }

  // ------- INPUT: MOBILE BUTTONS -------

  _makeMobileButtons() {
    // Exact keys as loaded in config.images
    const LEFT_KEY = 'left';
    const RIGHT_KEY = 'right';
    const ACTION_KEY = 'action';

    const W = this.sys.game.config.width;
    const H = this.sys.game.config.height;

    const y = H - 100;     // 100px from bottom in scene pixels
    const leftX = 160;
    const rightX = 490;
    const actionX = W - 160;

    const mkBtn = (x, y, key, onDown, onUp) => {
      const s = this.add.sprite(x, y, key).setInteractive({ useHandCursor: true });
      s.setDisplaySize(120, 120);
      s.on('pointerdown', () => { s.setScale(0.92); s.setAlpha(0.85); onDown && onDown(); });
      s.on('pointerup', () => { s.setScale(0.8); s.setAlpha(1.0); onUp && onUp(); });
      s.on('pointerout', () => { s.setScale(0.8); s.setAlpha(1.0); onUp && onUp(); });
      s.on('pointerupoutside', () => { s.setScale(0.8); s.setAlpha(1.0); onUp && onUp(); });
      s.setScrollFactor(0);
      s.setDepth(1000);
      return s;
    };

    this.mobile.left = mkBtn(leftX, y, LEFT_KEY, () => this.inputs.left = true, () => this.inputs.left = false);
    this.mobile.right = mkBtn(rightX, y, RIGHT_KEY, () => this.inputs.right = true, () => this.inputs.right = false);
    this.mobile.action = mkBtn(actionX, y, ACTION_KEY, () => this.inputs.up = true, () => this.inputs.up = false);
  }

  // ------- END CONDITIONS (with FX) -------

  _win() {
    if (this._ended) return;
    this._ended = true;

    // Audio
    if (this.sfx.win) this.sfx.win.play();

    // FX: flash + golden burst at nest, slight slow-mo feel
    try {
      const cam = this.cameras.main;
      cam.flash(250, 255, 255, 255, false);
      this._burstAt(this.nest.x, this.nest.y, 'yellow');
      this.tweens.add({
        targets: cam,
        zoom: cam.zoom * 1.05,
        duration: 250,
        yoyo: true,
        onComplete: () => (cam.zoom = 1),
      });
    } catch (e) { }

    this._cleanupAudioLater();
    // small delay so FX are visible
    this.time.delayedCall(550, () => this.scene.start('WinScene'));
  }

  _gameOver() {
    if (this._ended) return;
    this._ended = true;

    // Audio
    if (this.sfx.hit) this.sfx.hit.play();
    if (this.sfx.gameover) this.sfx.gameover.play();

    // FX: shake + red burst at feather + brief tint
    try {
      const cam = this.cameras.main;
      cam.shake(300, 0.01);
      this._burstAt(this.feather.x, this.feather.y, 'red');
      this.tweens.add({
        targets: this.feather,
        angle: { from: 0, to: 25 },
        alpha: { from: 1, to: 0.2 },
        duration: 280,
        ease: 'Quad.easeOut',
      });
    } catch (e) { }

    this._cleanupAudioLater();
    // small delay so FX are visible
    this.time.delayedCall(550, () => this.scene.start('GameOverScene'));
  }

  _cleanupAudioLater() {
    this.time.delayedCall(350, () => {
      if (this.bgm && this.bgm.isPlaying) this.bgm.stop();
    });
  }

  // ------- UTILITIES -------

  _setBodySizeToDisplay(sprite) {
    const bw = sprite.displayWidth;
    const bh = sprite.displayHeight;
    if (sprite.body && sprite.body.setSize) {
      sprite.body.setSize(bw, bh, true);
    } else if (sprite.body && sprite.body.updateFromGameObject) {
      sprite.body.updateFromGameObject();
    }
  }

  _setBodyStaticToSprite(sprite) {
    this.physics.add.existing(sprite, true); // static body
    if (sprite.body.setSize) {
      sprite.body.setSize(sprite.displayWidth, sprite.displayHeight, true);
    }
    if (sprite.body.updateFromGameObject) {
      sprite.body.updateFromGameObject();
    }
  }

  // ===== FX HELPERS =====

  _initFX() {
    this._ensureCircleTex(this.fx.dotKeyWhite, 0xffffff);
    this._ensureCircleTex(this.fx.dotKeyYellow, 0xffd54f);
    this._ensureCircleTex(this.fx.dotKeyRed, 0xff5252);

    // Prewarm small pools to avoid hitches
    for (let i = 0; i < 32; i++) this.fx.poolWhite.push(this._makeDot(this.fx.dotKeyWhite));
    for (let i = 0; i < 32; i++) this.fx.poolYellow.push(this._makeDot(this.fx.dotKeyYellow));
    for (let i = 0; i < 32; i++) this.fx.poolRed.push(this._makeDot(this.fx.dotKeyRed));
  }


  _ensureCircleTex(key, color) {
    if (this.textures.exists(key)) return;
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(color, 1);
    g.fillCircle(8, 8, 8);
    g.generateTexture(key, 16, 16);
    g.destroy();
  }

  _burstAt(x, y, which = 'yellow') {
    let pm = this.fx.particlesYellow;
    if (which === 'red') pm = this.fx.particlesRed;
    if (which === 'white') pm = this.fx.particlesWhite;
    if (!pm) return;

    const emitter = this._addEmitter(pm, {
      on: false,
      emitting: false,
      speed: { min: 80, max: 220 },
      lifespan: { min: 350, max: 800 },
      quantity: 48,
      scale: { start: 0.9, end: 0 },
      alpha: { start: 1, end: 0 },
      angle: { min: 0, max: 360 },
      rotate: { min: -90, max: 90 },
      gravityY: 0,
      blendMode: 'ADD'
    });

    if (!emitter) return;

    // Prefer explode; fall back to emitParticleAt if needed
    if (typeof emitter.explode === 'function') {
      emitter.explode(48, x, y);
    } else if (typeof pm.emitParticleAt === 'function') {
      pm.emitParticleAt(x, y, 48);
    } else {
      // Minimal fallback: briefly start/stop at the spot
      pm.setPosition(x, y);
      this._emitterStart(emitter);
      this.time.delayedCall(10, () => this._emitterStop(emitter));
    }

    // Best-effort clean-up
    this.time.delayedCall(1000, () => {
      if (pm.emitters && pm.emitters.remove) pm.emitters.remove(emitter);
      else if (typeof emitter.remove === 'function') emitter.remove();
      else this._emitterStop(emitter);
    });
  }

  // ---- Particle API shims (work across Phaser 3 variants) ----
  _addEmitter(manager, config = {}) {
    // Newer Phaser: addEmitter
    if (manager && typeof manager.addEmitter === 'function') {
      return manager.addEmitter(config);
    }
    // Older Phaser: createEmitter
    if (manager && typeof manager.createEmitter === 'function') {
      return manager.createEmitter(config);
    }
    // Fallback (construct manually)
    try {
      const E = Phaser.GameObjects.Particles.ParticleEmitter;
      const emitter = new E(manager, config);
      if (manager.emitters && manager.emitters.add) manager.emitters.add(emitter);
      return emitter;
    } catch (e) {
      console.warn('Emitter creation failed:', e);
      return null;
    }
  }

  _emitterStart(emitter) {
    if (!emitter) return;
    if (typeof emitter.start === 'function') emitter.start();
    else {
      // Support both 'on' and 'emitting' flags used across versions
      if ('on' in emitter) emitter.on = true;
      if ('emitting' in emitter) emitter.emitting = true;
    }
  }

  _emitterStop(emitter) {
    if (!emitter) return;
    if (typeof emitter.stop === 'function') emitter.stop();
    else {
      if ('on' in emitter) emitter.on = false;
      if ('emitting' in emitter) emitter.emitting = false;
    }
  }

  _emitterFollow(emitter, target) {
    if (!emitter) return;
    if (typeof emitter.startFollow === 'function') {
      emitter.startFollow(target);
    } else {
      // Fallbacks used by different Phaser builds
      emitter.follow = target;
      if (emitter.manager && typeof emitter.manager.setPosition === 'function') {
        // Keep the manager near the target if follow isn't supported
        this.events.on('update', () => {
          if (!target || !target.active) return;
          emitter.manager.setPosition(target.x, target.y);
        });
      }
    }
  }

  _makeDot(key) {
    const s = this.add.image(-1000, -1000, key);
    s.setDepth(999);          // on top of gameplay
    s.setActive(false).setVisible(false);
    return s;
  }

  _getDot(key) {
    const pool = (key === this.fx.dotKeyWhite) ? this.fx.poolWhite
      : (key === this.fx.dotKeyYellow) ? this.fx.poolYellow
        : this.fx.poolRed;
    return pool.length ? pool.pop() : this._makeDot(key);
  }

  _recycleDot(s) {
    s.setActive(false).setVisible(false);
    // push back into the right pool
    const key = s.texture.key;
    if (key === this.fx.dotKeyWhite) this.fx.poolWhite.push(s);
    else if (key === this.fx.dotKeyYellow) this.fx.poolYellow.push(s);
    else this.fx.poolRed.push(s);
  }

  _spawnTrailDot(x, y) {
    const s = this._getDot(this.fx.dotKeyWhite);
    const life = Phaser.Math.Between(250, 380);
    const scaleStart = 0.55;
    s.setPosition(x, y).setScale(scaleStart).setAlpha(0.7);
    s.setActive(true).setVisible(true);

    // Drift a tiny bit
    const driftAng = Phaser.Math.FloatBetween(0, Math.PI * 2);
    const drift = Phaser.Math.FloatBetween(6, 22);
    const tx = x + Math.cos(driftAng) * drift;
    const ty = y + Math.sin(driftAng) * drift;

    this.tweens.add({
      targets: s,
      x: tx, y: ty,
      alpha: 0,
      scale: 0,
      duration: life,
      ease: 'Quad.easeOut',
      onComplete: () => this._recycleDot(s)
    });
  }

  _burstAt(x, y, which = 'yellow') {
    const key = which === 'red' ? this.fx.dotKeyRed
      : which === 'white' ? this.fx.dotKeyWhite
        : this.fx.dotKeyYellow;

    const count = 48;
    for (let i = 0; i < count; i++) {
      const s = this._getDot(key);
      const life = Phaser.Math.Between(350, 800);
      const ang = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const spd = Phaser.Math.FloatBetween(80, 220);
      const tx = x + Math.cos(ang) * spd * (life / 1000);
      const ty = y + Math.sin(ang) * spd * (life / 1000);

      s.setPosition(x, y).setAlpha(1).setScale(0.9).setActive(true).setVisible(true);
      this.tweens.add({
        targets: s,
        x: tx, y: ty,
        alpha: 0,
        scale: 0,
        duration: life,
        ease: 'Cubic.easeOut',
        onComplete: () => this._recycleDot(s)
      });
    }
  }

  _ensureCircleTex(key, color) {
    if (this.textures.exists(key)) return;
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(color, 1);
    g.fillCircle(8, 8, 8);
    g.generateTexture(key, 16, 16);
    g.destroy();
  }


}
