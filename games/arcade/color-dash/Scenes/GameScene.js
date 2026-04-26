
class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');

    // Gameplay state
    this.cfg = null;
    this.W = 1080;
    this.H = 1920;

    this.lanes = [];
    this.player = null;
    this.playerLaneIndex = 1; // center lane by default
    this.playerColor = 'blue'; // default; can be changed by config

    this.score = 0;
    this.timeLeft = 0;
    this.distanceAccum = 0;

    this.speed = 400; // will read from cfg.gameplay.playerSpeed
    this.spawnTimers = { barriers: null, orbs: null, speedUp: null };
    this.groups = { barriers: null, orbs: null };

    this.ui = { scoreText: null, timerText: null, colorText: null };

    this.sfx = { bgm: null, orb: null, hit: null };

    this.mobile = {
      left: null,
      right: null,
      action: null,
    };

    this.colors = {
      red: 0xff4d5a,
      blue: 0x4db2ff,
      yellow: 0xffd24d
    };

    this.gameOver = false;
  }

  // ---------------------------
  // Preload: load assets from config if present, otherwise fallback later
  // ---------------------------
  // ---------------------------
  // Preload: load assets from config (ui + images2) with guards
  // ---------------------------
  preload() {
    const cfg = this.registry.get('cfg') || {};
    this.cfg = cfg;

    const loadImage = (key, url) => {
      if (!url || typeof url !== 'string') return;
      // Avoid duplicate texture keys being queued
      if (!this.textures.exists(key)) this.load.image(key, url);
    };

    const loadAllImagesFrom = (obj) => {
      if (!obj || typeof obj !== 'object') return;
      for (const [key, val] of Object.entries(obj)) {
        // Only load plain string paths; ignore nested objects
        if (typeof val === 'string') loadImage(key, val);
      }
    };

    const loadSpritesheet = (key, def) => {
      if (!def || !def.url) return;
      if (!this.textures.exists(key)) {
        this.load.spritesheet(key, def.url, {
          frameWidth: def.frameWidth,
          frameHeight: def.frameHeight,
          endFrame: (def.frames ?? 0) > 0 ? def.frames - 1 : undefined
        });
      }
    };

    const loadAudio = (key, url) => {
      if (!url || typeof url !== 'string') return;
      this.load.audio(key, url);
    };

    // ✅ Images from BOTH places
    loadAllImagesFrom(cfg.ui);        // e.g. lane, left, right, action, orbs, barriers, overlays...
    loadAllImagesFrom(cfg.images2);   // e.g. background

    // Spritesheets
    const sheets = cfg.spritesheets || {};
    if (sheets.player_colors) loadSpritesheet('player_colors', sheets.player_colors);

    // Audio
    const audio = cfg.audio || {};
    loadAudio('bgm', audio.bgm);
    loadAudio('orb', audio.orb);
    loadAudio('hit', audio.hit);
  }


  // ---------------------------
  // Create: build world, player, groups, controls, timers
  // ---------------------------
  create() {
    this.cfg = this.registry.get('cfg') || {};
    const gp = this.cfg.gameplay || {};
    const texts = this.cfg.texts || {};

    // Size
    const gameCfg = (this.sys.config || this.sys.game.config || {});
    this.W = gameCfg.width || 1080;
    this.H = gameCfg.height || 1920;

    // Orientation expectation (portrait)
    // Background / lanes
    this._createBackground();
    this._createLanes();

    // Physics groups
    this.groups.barriers = this.physics.add.group({ immovable: true, allowGravity: false });
    this.groups.orbs = this.physics.add.group({ immovable: true, allowGravity: false });

    // Player
    this.playerLaneIndex = Math.min(Math.max(0, Math.floor((gp.laneStartIndex ?? 1))), (gp.laneCount ?? 3) - 1);
    this.playerColor = gp.startColor || 'blue';
    this._createPlayer();

    // Speeds & timers
    this.speed = gp.playerSpeed ?? 400;
    this.timeLeft = Number.isFinite(gp.timerSeconds) ? gp.timerSeconds : null;
    this.score = 0;
    this.distanceAccum = 0;

    // Overlaps (we use overlap, not collide, so barriers don't physically block)
    this.physics.add.overlap(this.player, this.groups.orbs, this._onOrbOverlap, null, this);
    this.physics.add.overlap(this.player, this.groups.barriers, this._onBarrierOverlap, null, this);

    // UI (gameplay only)
    const label = texts.score_label || 'Score';
    this.ui.scoreText = this.add.text(this.W - 24, 24, `${label}: 0`, {
      fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Arial',
      fontSize: '36px',
      color: '#ffffff'
    }).setOrigin(1, 0).setDepth(1000);

    this.ui.timerText = this.add.text(24, 24, this.timeLeft !== null ? this._fmtTime(this.timeLeft) : '∞', {
      fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Arial',
      fontSize: '36px',
      color: '#ffffff'
    }).setOrigin(0, 0).setDepth(1000);

    this.ui.colorText = this.add.text(this.W * 0.5, 24, this._colorLabel(this.playerColor), {
      fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Arial',
      fontSize: '36px',
      color: '#ffffff'
    }).setOrigin(0.5, 0).setDepth(1000);

    // Controls
    this._setupKeyboard();
    this._setupMobileButtons();

    // Spawning
    this._startSpawners();

    // Music
    this._setupAudio();

    // Cleanup flags
    this.gameOver = false;
  }

  // ---------------------------
  // Update: per-frame logic
  // ---------------------------
  update(time, delta) {
    if (this.gameOver) return;

    const dt = delta / 1000;

    // --- Existing code for scoring & timer ---
    const dps = (this.cfg.gameplay?.distanceScorePerSecond ?? 5);
    this.distanceAccum += dps * dt;
    if (this.distanceAccum >= 1) {
      const whole = Math.floor(this.distanceAccum);
      this.score += whole;
      this.distanceAccum -= whole;
      this._refreshScore();
    }

    // --- Timer code ---
    if (this.timeLeft !== null) {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this._refreshTimer();
        this._win();
        return;
      }
      if (Math.floor(this.timeLeft * 10) % 5 === 0) this._refreshTimer();
    }

    // --- 🔥 NEW: gradual speed increase ---
    const gp = this.cfg.gameplay || {};
    const maxSpeed = gp.maxSpeed ?? 1000;
    const accel = gp.speedAcceleration ?? 2; // how many units per second
    this.speed = Math.min(maxSpeed, this.speed + accel * dt);

    // --- Apply velocity to active objects ---
    const v = this.speed;
    this.groups.barriers.children.iterate(b => { if (b) b.setVelocityY(v); });
    this.groups.orbs.children.iterate(o => { if (o) o.setVelocityY(v); });

    // --- Cleanup ---
    const killY = this.H + 100;
    this.groups.barriers.children.iterate(b => {
      if (b && b.y > killY) b.destroy();
    });
    this.groups.orbs.children.iterate(o => {
      if (o && o.y > killY) o.destroy();
    });
  }


  // ============================================================
  // World & Visuals
  // ============================================================
  _createBackground() {
    // Try to use texture; fallback to flat color
    if (this.textures.exists('background')) {
      const bg = this.add.image(this.W * 0.5, this.H * 0.5, 'background').setDepth(-100);
      const scaleX = this.W / bg.width;
      const scaleY = this.H / bg.height;
      const scale = Math.max(scaleX, scaleY);
      bg.setScale(scale);
    } else {
      // Fallback
      const rect = this.add.rectangle(this.W * 0.5, this.H * 0.5, this.W, this.H, 0x0b0f1a).setDepth(-100);
      rect.setStrokeStyle(0);
      console.warn('[Color Dash] Missing background asset, using fallback color.');
    }
  }

  _createLanes() {
    const laneCount = Math.max(1, this.cfg.gameplay?.laneCount ?? 3);
    this.lanes = [];
    for (let i = 0; i < laneCount; i++) {
      const x = this._laneX(i, laneCount);
      // Decorative lane markers if provided
      if (this.textures.exists('lane')) {
        const line = this.add.image(x, this.H * 0.5, 'lane').setDepth(-50);
        const scaleY = this.H / line.height;
        line.setScale(1, Math.max(1, scaleY));
        line.setAlpha(0.35);
      } else {
        // fallback thin line
        const line = this.add.rectangle(x, this.H * 0.5, 6, this.H, 0xffffff).setAlpha(0.08).setDepth(-50);
        line.isFallback = true;
      }
      this.lanes.push(x);
    }
  }

  _laneX(i, laneCount) {
    // Centered spacing (N lanes -> split evenly across width)
    return (this.W * (i + 1)) / (laneCount + 1);
  }

  // ============================================================
  // Player
  // ============================================================
  _createPlayer() {
    const laneCount = Math.max(1, this.cfg.gameplay?.laneCount ?? 3);
    this.playerLaneIndex = Phaser.Math.Clamp(this.playerLaneIndex, 0, laneCount - 1);
    const x = this._laneX(this.playerLaneIndex, laneCount);
    const y = this.H * 0.8;

    // Try spritesheet animation; otherwise fallback circle
    if (this.textures.exists('player_colors')) {
      this.player = this.physics.add.sprite(x, y, 'player_colors', 0);
      this.player.setImmovable(true);
      this.player.setCollideWorldBounds(true);
      this._buildPlayerAnimations();
      this._applyPlayerColor(this.playerColor);
    } else {
      // Fallback: simple colored circle using Graphics texture
      const gfxKey = 'player_fallback';
      if (!this.textures.exists(gfxKey)) {
        const g = this.make.graphics({ x: 0, y: 0, add: false });
        g.fillStyle(0xffffff, 1);
        g.fillCircle(32, 32, 28);
        g.generateTexture(gfxKey, 64, 64);
        g.destroy();
      }
      this.player = this.physics.add.image(x, y, gfxKey);
      this.player.setImmovable(true);
      this.player.setCollideWorldBounds(true);
      this.player.setTint(this.colors[this.playerColor] ?? 0xcccccc);
    }
  }

  _buildPlayerAnimations() {
    // Assume spritesheet arranged by color groups (3 frames per color: red[0..2], blue[3..5], yellow[6..8])
    const makeAnim = (key, start, end) => {
      if (this.anims.exists(key)) return;
      this.anims.create({ key, frames: this.anims.generateFrameNumbers('player_colors', { start, end }), frameRate: 10, repeat: -1 });
    };
    makeAnim('idle_red', 0, 2);
    makeAnim('idle_blue', 3, 5);
    makeAnim('idle_yellow', 6, 8);
  }

  _applyPlayerColor(colorName) {
    this.playerColor = colorName;
    if (this.textures.exists('player_colors')) {
      const key = `idle_${colorName}`;
      if (this.anims.exists(key)) this.player.play(key);
    } else {
      this.player.setTint(this.colors[colorName] ?? 0xffffff);
    }
    if (this.ui.colorText) this.ui.colorText.setText(this._colorLabel(colorName));
  }

  // ============================================================
  // Spawning & Difficulty
  // ============================================================
  _startSpawners() {
    const gp = this.cfg.gameplay || {};
    const orbRate = gp.orbSpawnRate ?? 3000;
    const barrierRate = gp.barrierSpawnRate ?? 2000;

    this._restartTimer('orbs', orbRate, () => this._spawnOrb());
    this._restartTimer('barriers', barrierRate, () => this._spawnBarrier());

    const incInterval = gp.speedIncreaseInterval ?? 20000;
    if (incInterval > 0) {
      this._restartTimer('speedUp', incInterval, () => this._increaseDifficulty(), true);
    }
  }

  _increaseDifficulty() {
    const gp = this.cfg.gameplay || {};
    const add = gp.speedIncreaseAmount ?? 50;
    const maxSpeed = gp.maxSpeed ?? 1000;
    this.speed = Math.min(maxSpeed, this.speed + add);

    // Optionally tighten spawn rates over time
    const minBarrier = gp.minBarrierSpawnRate ?? 900;
    const minOrb = gp.minOrbSpawnRate ?? 1200;

    const newBarrier = Math.max(minBarrier, (this.spawnTimers.barriers?.delay ?? 2000) - (gp.spawnTightenStep ?? 150));
    const newOrb = Math.max(minOrb, (this.spawnTimers.orbs?.delay ?? 3000) - (gp.spawnTightenStep ?? 150));

    this._restartTimer('barriers', newBarrier, () => this._spawnBarrier());
    this._restartTimer('orbs', newOrb, () => this._spawnOrb());
  }

  _restartTimer(which, delay, cb, loop = true) {
    if (this.spawnTimers[which]) this.spawnTimers[which].remove(false);
    this.spawnTimers[which] = this.time.addEvent({ delay, callback: cb, callbackScope: this, loop });
    this.spawnTimers[which].delay = delay; // track for difficulty tightening
  }

  _spawnBarrier() {
    const laneCount = Math.max(1, this.cfg.gameplay?.laneCount ?? 3);
    const laneIndex = Phaser.Math.Between(0, laneCount - 1);
    const x = this._laneX(laneIndex, laneCount);
    const y = -60;

    // Pick a color
    const colors = ['red', 'blue', 'yellow'];
    const colorName = colors[Phaser.Math.Between(0, colors.length - 1)];
    const key = `barrier_${colorName}`;

    let sprite;
    if (this.textures.exists(key)) {
      sprite = this.physics.add.image(x, y, key);
    } else {
      // Fallback barrier rectangle texture
      const texKey = `bar_fallback_${colorName}`;
      if (!this.textures.exists(texKey)) {
        const g = this.make.graphics({ add: false });
        g.fillStyle(this.colors[colorName] ?? 0xffffff, 1);
        g.fillRoundedRect(0, 0, 160, 36, 10);
        g.generateTexture(texKey, 160, 36);
        g.destroy();
      }
      sprite = this.physics.add.image(x, y, texKey);
    }

    sprite.setData('colorName', colorName);
    sprite.setVelocityY(this.speed);
    sprite.setImmovable(true);
    sprite.setDepth(10);

    // Cap on-screen count to avoid clutter
    const maxBarriers = this.cfg.gameplay?.maxBarriers ?? 10;
    if (this.groups.barriers.getLength() >= maxBarriers) {
      // remove oldest
      const first = this.groups.barriers.getFirstAlive();
      if (first) first.destroy();
    }

    this.groups.barriers.add(sprite);
  }

  _spawnOrb() {
    const laneCount = Math.max(1, this.cfg.gameplay?.laneCount ?? 3);
    const laneIndex = Phaser.Math.Between(0, laneCount - 1);
    const x = this._laneX(laneIndex, laneCount);
    const y = -60;

    const colors = ['red', 'blue', 'yellow'];
    const colorName = colors[Phaser.Math.Between(0, colors.length - 1)];
    const key = `orb_${colorName}`;

    let sprite;
    if (this.textures.exists(key)) {
      sprite = this.physics.add.image(x, y, key);
    } else {
      // Fallback orb circle
      const texKey = `orb_fallback_${colorName}`;
      if (!this.textures.exists(texKey)) {
        const g = this.make.graphics({ add: false });
        g.fillStyle(this.colors[colorName] ?? 0xffffff, 1);
        g.fillCircle(24, 24, 22);
        g.generateTexture(texKey, 48, 48);
        g.destroy();
      }
      sprite = this.physics.add.image(x, y, texKey);
    }

    sprite.setData('colorName', colorName);
    sprite.setVelocityY(this.speed);
    sprite.setImmovable(true);
    sprite.setDepth(12);

    // Cap orbs
    const maxOrbs = this.cfg.gameplay?.maxOrbs ?? 7;
    if (this.groups.orbs.getLength() >= maxOrbs) {
      const first = this.groups.orbs.getFirstAlive();
      if (first) first.destroy();
    }

    this.groups.orbs.add(sprite);
  }

  // ============================================================
  // Collisions
  // ============================================================
  _onOrbOverlap(player, orb) {
    if (!orb.active) return;
    const color = orb.getData('colorName');
    this._applyPlayerColor(color);
    orb.destroy();

    // Score bonus
    this.score += (this.cfg.gameplay?.orbScore ?? 25);
    this._refreshScore();

    if (this.sfx.orb) this.sfx.orb.play({ volume: 0.85 });
  }

  _onBarrierOverlap(player, barrier) {
    if (!barrier.active) return;
    const color = barrier.getData('colorName');

    // Any correct match -> destroy barrier + award score
    if (color === this.playerColor) {
      if (barrier.active) barrier.destroy(); // prevent multi-tick double score

      // Score: prefer a dedicated match value, fall back to your older keys
      const add =
        (this.cfg.gameplay?.matchDestroyScore ??
          this.cfg.gameplay?.redDestroyScore ??           // backward compatible
          this.cfg.gameplay?.barrierPassScore ?? 20);      // final fallback

      this.score += add;
      this._refreshScore();
      return;
    }

    // Mismatch -> game over
    if (this.sfx.hit) this.sfx.hit.play({ volume: 1 });
    this._lose();
  }



  // ============================================================
  // Controls
  // ============================================================
  _setupKeyboard() {
    this.input.keyboard.on('keydown-LEFT', () => this._laneLeft());
    this.input.keyboard.on('keydown-A', () => this._laneLeft());

    this.input.keyboard.on('keydown-RIGHT', () => this._laneRight());
    this.input.keyboard.on('keydown-D', () => this._laneRight());

    // Optional action (color cycle) if enabled in config
    this.input.keyboard.on('keydown-SPACE', () => this._tryAction());
  }

  _setupMobileButtons() {
    // Positions per standard
    const y = this.H - 100;
    const leftX = 160;
    const rightX = 490;
    const actionX = this.W - 160;

    this.mobile.left = this._makeButton(leftX, y - 20, 'left', 0x4d79ff);
    this.mobile.right = this._makeButton(rightX + 450, y - 20, 'right', 0x4dff79);

    this.mobile.left.on('pointerdown', () => { this.mobile.left.setScale(0.92).setAlpha(0.8); this._laneLeft(); });
    this.mobile.left.on('pointerup', () => this.mobile.left.setScale(1).setAlpha(1));
    this.mobile.left.on('pointerout', () => this.mobile.left.setScale(1).setAlpha(1));

    this.mobile.right.on('pointerdown', () => { this.mobile.right.setScale(0.92).setAlpha(0.8); this._laneRight(); });
    this.mobile.right.on('pointerup', () => this.mobile.right.setScale(1).setAlpha(1));
    this.mobile.right.on('pointerout', () => this.mobile.right.setScale(1).setAlpha(1));

    // Optional action button
    const hasAction = !!this.cfg.gameplay?.useActionSwapColor;
    if (hasAction) {
      this.mobile.action = this._makeButton(actionX, y, 'action', 0xffd24d);
      this.mobile.action.on('pointerdown', () => { this.mobile.action.setScale(0.92).setAlpha(0.8); this._tryAction(); });
      this.mobile.action.on('pointerup', () => this.mobile.action.setScale(1).setAlpha(1));
      this.mobile.action.on('pointerout', () => this.mobile.action.setScale(1).setAlpha(1));
    }
  }

  _makeButton(x, y, key, fallbackTint) {
    let btn;
    if (this.textures.exists(key)) {
      btn = this.add.image(x, y, key).setInteractive({ useHandCursor: true });
    } else {
      // Fallback round button
      const texKey = `btn_${key}_fallback`;
      if (!this.textures.exists(texKey)) {
        const g = this.make.graphics({ add: false });
        g.fillStyle(fallbackTint, 1);
        g.fillCircle(44, 44, 44);
        g.generateTexture(texKey, 88, 88);
        g.destroy();
      }
      btn = this.add.image(x, y, texKey).setInteractive({ useHandCursor: true });
      console.warn(`[Color Dash] Missing button image "${key}", using fallback.`);
    }
    btn.setDepth(1001).setScrollFactor(0);
    return btn;
  }

  _laneLeft() {
    const laneCount = Math.max(1, this.cfg.gameplay?.laneCount ?? 3);
    if (this.playerLaneIndex <= 0) return;
    this.playerLaneIndex--;
    const nx = this._laneX(this.playerLaneIndex, laneCount);
    this.tweens.add({ targets: this.player, x: nx, duration: 120, ease: 'Quad.easeOut' });
  }

  _laneRight() {
    const laneCount = Math.max(1, this.cfg.gameplay?.laneCount ?? 3);
    if (this.playerLaneIndex >= laneCount - 1) return;
    this.playerLaneIndex++;
    const nx = this._laneX(this.playerLaneIndex, laneCount);
    this.tweens.add({ targets: this.player, x: nx, duration: 120, ease: 'Quad.easeOut' });
  }

  _tryAction() {
    // Optional "cycle color" action (off by default). Cooldown applies.
    const gp = this.cfg.gameplay || {};
    if (!gp.useActionSwapColor) return;

    const now = this.time.now;
    const cd = gp.actionCooldownMs ?? 1200;
    if (this._lastActionAt && now - this._lastActionAt < cd) return;

    const order = ['red', 'blue', 'yellow'];
    const idx = order.indexOf(this.playerColor);
    const next = order[(idx + 1) % order.length];
    this._applyPlayerColor(next);
    this._lastActionAt = now;
  }

  // ============================================================
  // UI Helpers
  // ============================================================
  _refreshScore() {
    const label = (this.cfg.texts?.score_label) || 'Score';
    if (this.ui.scoreText) this.ui.scoreText.setText(`${label}: ${this.score}`);
  }

  _refreshTimer() {
    if (!this.ui.timerText) return;
    this.ui.timerText.setText(this.timeLeft !== null ? this._fmtTime(this.timeLeft) : '∞');
  }

  _fmtTime(s) {
    const sec = Math.max(0, Math.ceil(s));
    const mm = Math.floor(sec / 60).toString().padStart(2, '0');
    const ss = (sec % 60).toString().padStart(2, '0');
    return `${mm}:${ss}`;
  }

  _colorLabel(name) {
    return `Color: ${name.toUpperCase()}`;
  }

  // ============================================================
  // Audio
  // ============================================================
  _setupAudio() {
    const a = this.cfg.audio || {};
    if (a.bgm && this.sound.locked === false) {
      this.sfx.bgm = this.sound.add('bgm', { loop: true, volume: 0.5 });
      this.sfx.bgm.play();
    } else if (a.bgm) {
      // On mobile, wait for first user interaction
      this.sound.once(Phaser.Sound.Events.UNLOCKED, () => {
        this.sfx.bgm = this.sound.add('bgm', { loop: true, volume: 0.5 });
        this.sfx.bgm.play();
      });
    }
    if (a.orb) this.sfx.orb = this.sound.add('orb');
    if (a.hit) this.sfx.hit = this.sound.add('hit');
  }

  // ============================================================
  // End States
  // ============================================================
  _win() {
    if (this.gameOver) return;
    this.gameOver = true;
    this._teardown();
    // Hand off to Win scene (handled elsewhere)
    this.scene.start('WinScene', { score: this.score, mode: 'timer' });
  }

  _lose() {
    if (this.gameOver) return;
    this.gameOver = true;
    this._teardown();
    // Hand off to GameOver scene (handled elsewhere)
    this.scene.start('GameOverScene', { score: this.score, reason: 'color_mismatch' });
  }

  _teardown() {
    // Stop timers
    Object.values(this.spawnTimers).forEach(t => t && t.remove(false));
    this.spawnTimers = { barriers: null, orbs: null, speedUp: null };

    // Stop music
    if (this.sfx.bgm && this.sfx.bgm.isPlaying) this.sfx.bgm.stop();
  }
}

// export default GameScene;
