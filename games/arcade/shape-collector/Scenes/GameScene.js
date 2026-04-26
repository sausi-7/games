class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');

    // Runtime state
    this._score = 0;
    this._lives = 3;
    this._timeLeft = 60;
    this._finished = false;
    // inside constructor
    this._facingRight = true;

    this._spawnTimer = null;
    this._targetTimer = null;
    this._bgm = null;

    this._targetShapeKey = null;  // 'shape_circle ' etc.
    this._shapesCfg = [];         // [{key:'shape_circle', name:'CIRCLE'}, ...]
  }

  preload() {
    // Get config (registry is filled by your Boot scene)
    const cfg = this.registry.get('cfg') || {};

    // Font (optional)
    if (cfg.font && cfg.font.url && cfg.font.family) {
      const font = new FontFace(cfg.font.family, `url(${cfg.font.url})`);
      font.load().then(f => document.fonts.add(f)).catch(() => { });
    }

    // IMAGES
    if (cfg.images1) {
      for (const [key, url] of Object.entries(cfg.images1)) {
        this.load.image(key, url);
      }
    }
    if (cfg.images2) {
      for (const [key, url] of Object.entries(cfg.images2)) {
        this.load.image(key, url);
      }
    }
    if (cfg.ui) {
      for (const [key, url] of Object.entries(cfg.ui)) {
        this.load.image(key, url);
      }
    }

    // SPRITESHEETS (not required here, but supported)
    if (cfg.spritesheets) {
      for (const [key, spec] of Object.entries(cfg.spritesheets)) {
        this.load.spritesheet(key, spec.url, {
          frameWidth: spec.frameWidth,
          frameHeight: spec.frameHeight
        });
      }
    }

    // AUDIO
    if (cfg.audio) {
      for (const [key, url] of Object.entries(cfg.audio)) {
        this.load.audio(key, url);
      }
    }
  }

  create() {
    const cfg = this.registry.get('cfg') || {};
    const G = cfg.gameplay || {};

    // RESET runtime state on each create (important for replay)
    this._score = 0;
    this._finished = false;
    this._spawnTimer = null;
    this._targetTimer = null;
    this._targetShapeKey = null;

    // Hitbox scales (fallbacks if not in config)
    this._hbPlayerX = G.hitboxScalePlayer?.x ?? 1.15;
    this._hbPlayerY = G.hitboxScalePlayer?.y ?? 1.10;
    this._hbShapeX = G.hitboxScaleShape?.x ?? 1.25;
    this._hbShapeY = G.hitboxScaleShape?.y ?? 1.25;


    // Cache gameplay params
    this._timeLeft = G.timerSeconds ?? 60;
    this._targetScore = G.targetScore ?? 20;
    this._lives = G.playerLives ?? 3;
    this._playerSpeed = G.playerSpeed ?? 300;
    this._spawnRate = G.spawnRate ?? 800;
    this._targetChangeSeconds = G.targetChangeSeconds ?? 5;

    // Reset elapsed time tracker
    this.registry.set('elapsed_ms', 0);

    // Build shape list from config images
    this._shapesCfg = [
      { key: 'shape_circle', name: 'CIRCLE' },
      { key: 'shape_square', name: 'SQUARE' },
      { key: 'shape_triangle', name: 'TRIANGLE' },
      { key: 'shape_star', name: 'STAR' },
      { key: 'shape_hex', name: 'HEX' }
    ].filter(s => !!(cfg.images1 && cfg.images1[s.key]));

    // World/bounds
    const width = this.sys.game.config.width;
    const height = this.sys.game.config.height;

    // Background (optional)
    if (cfg.images2 && cfg.images2.background) {
      const bg = this.add.image(width / 2, height / 2, 'background');
      bg.setDisplaySize(width, height);
      bg.setDepth(-100);
    }

    // Physics system
    this.physics.world.setBounds(0, 0, width, height);

    // Groups
    this.shapeGroup = this.physics.add.group({ collideWorldBounds: false });

    // Ground (invisible collider)
    this.ground = this.add.image(width / 2, height - 10, 'platform');
    this.ground.setDisplaySize(width, 40).setAlpha(0);
    this.physics.add.existing(this.ground, true);
    this.ground.body.setSize(width, 40);

    // Player (catcher) — left/right only
    this.player = this.add.image(width / 2, height - 200, 'player');
    this.player.setDisplaySize(160, 120);
    this.physics.add.existing(this.player);
    this.player.body.setCollideWorldBounds(true);
    this.player.body.setAllowGravity(false); // ← no vertical gravity
    this.player.body.setImmovable(true);     // ← ignore external pushes
    this._setBodyByDisplay(this.player, this._hbPlayerX, this._hbPlayerY);

    if (this.player.setFlipX) this.player.setFlipX(false);
    this._facingRight = true

    // UI
    const labelScore = (cfg.texts && cfg.texts.score_label) ? cfg.texts.score_label : 'Score: ';
    this.scoreText = this.add.text(24, 24, `${labelScore}0`, {
      fontFamily: (cfg.font && cfg.font.family) ? cfg.font.family : 'Arial',
      fontSize: '42px',
      color: '#ffffff'
    }).setOrigin(0, 0);

    this.timerText = this.add.text(width - 24, 24, `${this._timeLeft}s`, {
      fontFamily: (cfg.font && cfg.font.family) ? cfg.font.family : 'Arial',
      fontSize: '42px',
      color: '#ffffff'
    }).setOrigin(1, 0);

    this.livesText = this.add.text(24, 86, `♥ ${this._lives}`, {
      fontFamily: (cfg.font && cfg.font.family) ? cfg.font.family : 'Arial',
      fontSize: '38px',
      color: '#ff6666'
    }).setOrigin(0, 0);

    this.targetText = this.add.text(width / 2, 24, 'Collect: —', {
      fontFamily: (cfg.font && cfg.font.family) ? cfg.font.family : 'Arial',
      fontSize: '48px',
      color: '#ffff66'
    }).setOrigin(0.5, 0);

    // Input (keyboard)
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keyA = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.keyD = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);

    // Mobile controls
    this._createMobileButtons(cfg);

    // Collisions/overlaps
    this.physics.add.overlap(this.player, this.shapeGroup, (player, shape) => {
      this._onPlayerCatch(shape);
    });
    this.physics.add.overlap(this.ground, this.shapeGroup, (ground, shape) => {
      shape.destroy();
    });

    // Timers
    this._startTimers();

    // Audio
    if (cfg.audio && cfg.audio.bgm) {
      this._bgm = this.sound.add('bgm', { loop: true, volume: 0.6 });
      this._bgm.play();
    }
  }

  update() {
    if (this._finished) return;

    const speed = this._currentSpeed();
    let vx = 0;

    // Keyboard + mobile move (X only)
    if (this.cursors.left.isDown || this.keyA.isDown || this._mobileLeftPressed) {
      vx = -speed;
    } else if (this.cursors.right.isDown || this.keyD.isDown || this._mobileRightPressed) {
      vx = speed;
    }
    this.player.body.setVelocityX(vx);

    // Y stays fixed without forcing position each frame
    this.player.body.setVelocityY(0);

    if (this.player.setFlipX) {
      if (vx < 0 && this._facingRight) {
        this.player.setFlipX(true);
        this._facingRight = false;
      } else if (vx > 0 && !this._facingRight) {
        this.player.setFlipX(false);
        this._facingRight = true;
      }
    }


    // Cleanup off-screen shapes
    this.shapeGroup.children.each(s => {
      if (!s.active) return;
      if (s.y > this.sys.game.config.height + 100) s.destroy();
    });
  }

  // -----------------------
  // Helpers & Systems
  // -----------------------

  _startTimers() {
    // Spawn shapes
    this._spawnTimer = this.time.addEvent({
      delay: this._spawnRate,
      loop: true,
      callback: () => this._spawnShape()
    });

    // Target changing
    this._chooseNewTarget();
    this._targetTimer = this.time.addEvent({
      delay: this._targetChangeSeconds * 1000,
      loop: true,
      callback: () => this._chooseNewTarget()
    });

    // Countdown
    this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        if (this._finished) return;
        this._timeLeft = Math.max(0, this._timeLeft - 1);
        this.timerText.setText(`${this._timeLeft}s`);
        if (this._timeLeft <= 0) this._onLose('time');
      }
    });
  }

  _chooseNewTarget() {
    if (!this._shapesCfg.length) return;
    const pick = Phaser.Utils.Array.GetRandom(this._shapesCfg);
    this._targetShapeKey = pick.key;
    this.targetText.setText(`Collect: ${pick.name}`);
  }

  _spawnShape() {
    if (this._finished) return;
    if (!this._shapesCfg.length) return;

    const width = this.sys.game.config.width;

    // Random shape (can be target or not)
    const choice = Phaser.Utils.Array.GetRandom(this._shapesCfg);

    let x = Phaser.Math.Between(64, width - 64);
    const y = -60;

    // Keep new spawns from being right above the player (feels fairer)
    const px = this.player.x;
    if (Math.abs(x - px) < 80) x += (x < px ? -100 : 100);
    x = Phaser.Math.Clamp(x, 64, width - 64);

    const shape = this.add.image(x, y, choice.key);
    shape.setDisplaySize(96, 96);
    this.physics.add.existing(shape);
    this._setBodyByDisplay(shape, this._hbShapeX, this._hbShapeY);

    shape.body.setAllowGravity(false);

    // Fall speed scales with elapsed time (mild difficulty curve)
    const elapsed = (this.registry.get('elapsed_ms') || 0);
    const speedBoost = Math.min(350, Math.floor((elapsed / 1000) * 2)); // +2 px/s per sec, capped
    const baseVy = Phaser.Math.Between(220, 340) + speedBoost;

    shape.body.setVelocity(0, baseVy);
    shape.setData('shapeKey', choice.key);

    this.shapeGroup.add(shape);

    // Track elapsed
    this.registry.set('elapsed_ms', elapsed + this._spawnRate);
  }

  _onPlayerCatch(shape) {
    const cfg = this.registry.get('cfg') || {};
    if (!shape || !shape.active) return;

    const gotKey = shape.getData('shapeKey');
    const isCorrect = (gotKey === this._targetShapeKey);

    if (isCorrect) {
      this._score += 1;
      this.scoreText.setText(`${(cfg.texts?.score_label || 'Score: ')}${this._score}`);
      if (cfg.audio && cfg.audio.collect) this.sound.play('collect', { volume: 0.9 });
      this._pulse(this.player);
      shape.destroy();

      if (this._score >= this._targetScore) this._onWin();
    } else {
      // Wrong catch
      this._lives = Math.max(0, this._lives - 1);
      this.livesText.setText(`♥ ${this._lives}`);
      if (cfg.audio && cfg.audio.hit) this.sound.play('hit', { volume: 0.9 });
      this._flashRed(this.player);
      shape.destroy();

      if (this._lives <= 0) this._onLose('lives');
    }
  }

  _onWin() {
    if (this._finished) return;
    this._finished = true;

    const cfg = this.registry.get('cfg') || {};
    if (cfg.audio && cfg.audio.win) this.sound.play('win', { volume: 1.0 });
    if (this._bgm) this._bgm.stop();

    // Stop spawns
    if (this._spawnTimer) this._spawnTimer.remove(false);
    if (this._targetTimer) this._targetTimer.remove(false);

    // Emit for listeners
    this.game.events.emit('game_win', { score: this._score, timeLeft: this._timeLeft });

    // Auto transition if scene exists
    if (this.scene.get('WinScene')) this.scene.start('WinScene');
  }

  _onLose(reason) {
    if (this._finished) return;
    this._finished = true;

    const cfg = this.registry.get('cfg') || {};
    if (cfg.audio && cfg.audio.gameover) this.sound.play('gameover', { volume: 1.0 });
    if (this._bgm) this._bgm.stop();

    if (this._spawnTimer) this._spawnTimer.remove(false);
    if (this._targetTimer) this._targetTimer.remove(false);

    this.game.events.emit('game_over', { score: this._score, reason });

    // Auto transition if scene exists
    if (this.scene.get('GameOverScene')) this.scene.start('GameOverScene');
  }

  _currentSpeed() {
    // Optional dash when the action button is held
    const dash = this._mobileActionPressed ? 1.5 : 1.0;
    return this._playerSpeed * dash;
  }

  _pulse(target) {
    this.sys.tweens.add({
      targets: target,
      scaleX: target.scaleX * 1.08,
      scaleY: target.scaleY * 1.08,
      duration: 120,
      yoyo: true
    });
  }

  _flashRed(target) {
    const tint = 0xff4444;
    target.setTint(tint);
    this.time.delayedCall(160, () => target.clearTint());
  }


  // Replaces _matchBodyToDisplay
  _setBodyByDisplay(go, sx = 1.0, sy = 1.0) {
    // Size body as a multiple of what's actually on-screen
    const w = go.displayWidth * sx;
    const h = go.displayHeight * sy;

    // setSize(width, height, true) recenters the body automatically
    go.body.setSize(w, h, true);
  }


  _createMobileButtons(cfg) {
    const width = this.sys.game.config.width;
    const height = this.sys.game.config.height;

    // Positions (portrait standard)
    const leftX = 160;
    const rightX = 490;
    const actionX = width - 160;
    const btnY = height - 100;

    // Flags
    this._mobileLeftPressed = false;
    this._mobileRightPressed = false;
    this._mobileActionPressed = false;

    // Left
    this.leftBtn = this.add.image(leftX, btnY, 'left').setInteractive({ useHandCursor: true });
    this.leftBtn.setDisplaySize(140, 140).setAlpha(0.8);
    this.leftBtn.on('pointerdown', () => { this._mobileLeftPressed = true; this._btnDownFX(this.leftBtn); });
    this.leftBtn.on('pointerup', () => { this._mobileLeftPressed = false; this._btnUpFX(this.leftBtn); });
    this.leftBtn.on('pointerout', () => { this._mobileLeftPressed = false; this._btnUpFX(this.leftBtn); });

    // Right
    this.rightBtn = this.add.image(rightX + 390, btnY, 'right').setInteractive({ useHandCursor: true });
    this.rightBtn.setDisplaySize(140, 140).setAlpha(0.8);
    this.rightBtn.on('pointerdown', () => { this._mobileRightPressed = true; this._btnDownFX(this.rightBtn); });
    this.rightBtn.on('pointerup', () => { this._mobileRightPressed = false; this._btnUpFX(this.rightBtn); });
    this.rightBtn.on('pointerout', () => { this._mobileRightPressed = false; this._btnUpFX(this.rightBtn); });

    // Action (optional dash)
    // this.actionBtn = this.add.image(actionX, btnY, 'action').setInteractive({ useHandCursor: true });
    // this.actionBtn.setDisplaySize(160, 160).setAlpha(0.8);
    // this.actionBtn.on('pointerdown', () => { this._mobileActionPressed = true; this._btnDownFX(this.actionBtn); });
    // this.actionBtn.on('pointerup', () => { this._mobileActionPressed = false; this._btnUpFX(this.actionBtn); });
    // this.actionBtn.on('pointerout', () => { this._mobileActionPressed = false; this._btnUpFX(this.actionBtn); });

    // Keep buttons above gameplay
    this.leftBtn.setDepth(1000);
    this.rightBtn.setDepth(1000);
    // this.actionBtn.setDepth(1000);
  }

  _btnDownFX(btn) {
    this.sys.tweens.add({ targets: btn, alpha: 1.0, scale: btn.scale * 0.96, duration: 70 });
  }

  _btnUpFX(btn) {
    this.sys.tweens.add({ targets: btn, alpha: 0.8, scale: 1.0, duration: 80 });
  }
}