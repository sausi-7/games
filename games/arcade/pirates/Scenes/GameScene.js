class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');

    // Runtime state
    this._timeLeft = 0;
    this._score = 0;
    this._kills = 0;
    this._finished = false;

    // Refs
    this.player = null;
    this.platforms = null;
    this.enemies = null;
    this.coins = null;
    this.playerBullets = null;
    this.enemyBullets = null;

    // UI
    this.scoreText = null;
    this.timerText = null;
    this.healthText = null;

    // Inputs (keyboard kept for desktop testing)
    this.cursors = null;
    this.keyShoot = null;
    this.keyJump = null; // unused now (kept to avoid breaking loaders that bind SPACE)

    // Mobile flags
    this.touchAction = false; // Action = SHOOT (button stays)
    this.mobileButtons = {};

    // Damage cooldown (i-frames)
    this._lastHurtAt = -9999;
    this._iFrameMs = 350; // can be overridden from cfg.gameplay.iFrameMs

    // Joystick state
    this.joy = {
      base: null,
      thumb: null,
      pointerId: null,
      centerX: 0,
      centerY: 0,
      radius: 90,
      dead: 12,
      active: false,
      vecX: 0,
      vecY: 0
    };

    this.maxEnemies = 2;


  }

  // ---- Visual Theme ----
  _getTheme() {
    return {
      fontFamily: (this.registry.get('cfg')?.font?.family || 'Arial Black, Arial, sans-serif'),
      colors: {
        uiText: '#ffffff',
        uiGlow: '#00e0ff',
        score: '#ffd54a',
        hp: '#ff4d6d',
        timerHi: '#020504ff',
        timerLo: '#020101ff'
      }
    };
  }

  // Pretty text with stroke + glow shadow
  // _makeUIText(x, y, text, style = {}) {
  //   const { fontFamily, colors } = this._getTheme();
  //   const t = this.add.text(x, y, text, {
  //     fontFamily,
  //     fontSize: style.fontSize || '32px',
  //     color: style.color || colors.uiText,
  //     align: style.align || 'left'
  //   }).setDepth(style.depth ?? 1000);

  //   t.setStroke(style.strokeColor || '#000000', style.strokeThickness ?? 6);
  //   t.setShadow(0, 0, style.shadowColor || colors.uiGlow, style.shadowBlur ?? 12, true, true);
  //   if (style.originCenter) t.setOrigin(0.5, 0);
  //   return t;
  // }

  // Rounded UI panel (for HUD background)
  _makeUIPanel(x, y, w, h, alpha = 0.25, depth = 999) {
    const g = this.add.graphics().setDepth(depth).setScrollFactor(0).setAlpha(alpha);
    g.fillStyle(0x000000, 1);
    g.fillRoundedRect(x, y, w, h, 14);
    g.lineStyle(2, 0xffffff, 0.2);
    g.strokeRoundedRect(x, y, w, h, 14);
    return g;
  }

  _getActiveEnemyCount() {
    return this.enemies ? this.enemies.countActive(true) : 0;
  }


  // Tiny popup numbers / labels (score, hits)
  _popupText(x, y, txt, color = '#ffffff') {
    const { fontFamily } = this._getTheme();
    const t = this.add.text(x, y, txt, {
      fontFamily,
      fontSize: '24px',
      color
    }).setDepth(2000).setStroke('#000', 4).setShadow(0, 0, '#000000', 8, true, true);

    this.tweens.add({
      targets: t,
      y: y - 28,
      alpha: 0,
      duration: 600,
      ease: 'Quad.easeOut',
      onComplete: () => t.destroy()
    });
  }


  preload() {
    const cfg = this.registry.get('cfg') || {};
    const images = cfg.images1 || {};
    const images2 = cfg.images2 || {};
    const ui = cfg.ui || {};
    const audio = cfg.audio || {};
    const spritesheets = cfg.spritesheets || {};
    const font = cfg.font;

    // Optional webfont
    if (font && font.url && font.family) {
      try {
        const webFont = new FontFace(font.family, `url(${font.url})`);
        webFont.load().then(f => document.fonts.add(f)).catch(() => { });
      } catch (e) { }
    }

    // IMAGES
    for (const [key, url] of Object.entries(images)) {
      this.load.image(key, url);
    }

    for (const [key, url] of Object.entries(images2)) {
      this.load.image(key, url);
    }

    for (const [key, url] of Object.entries(ui)) {
      this.load.image(key, url);
    }

    // SPRITESHEETS (optional)
    for (const [key, meta] of Object.entries(spritesheets)) {
      if (meta && meta.url && meta.frameWidth && meta.frameHeight) {
        this.load.spritesheet(key, meta.url, {
          frameWidth: meta.frameWidth,
          frameHeight: meta.frameHeight
        });
      }
    }

    // AUDIO
    for (const [key, url] of Object.entries(audio)) {
      this.load.audio(key, url);
    }
  }

  create() {
    const cfg = this.registry.get('cfg') || {};
    const G = cfg.gameplay || {};
    // Fixed fire delay (ms). Can override via config.gameplay.enemyShootDelayMs
    const fireDelay = Number.isFinite(G.enemyShootDelayMs) ? G.enemyShootDelayMs : 900;
    this._enemyShootMin = fireDelay;
    this._enemyShootMax = fireDelay;

    const images = cfg.images1 || {};
    const images2 = cfg.images2 || {};
    const texts = cfg.texts || {};

    // Slower fire cadence (overridable from config)
    this._enemyShootMin = Number.isFinite(G.enemyShootMin) ? G.enemyShootMin : 2600; // ms
    this._enemyShootMax = Number.isFinite(G.enemyShootMax) ? G.enemyShootMax : 4200; // ms


    // --- World setup ---
    const W = this.scale.width;
    const H = this.scale.height;
    this.physics.world.setBounds(0, 0, W, H);
    this.physics.world.gravity.y = 0; // top-down movement


    this.input.addPointer(3);
    // Background (if provided)
    if (images2.background) {
      const bg = this.add.image(W / 2, H / 2, 'background');
      bg.setDisplaySize(W, H);
    }

    // State init
    this._timeLeft = G.timerSeconds ?? 60;
    this._score = 0;
    this._kills = 0;
    this._finished = false;

    this._targetKills = 2;

    // Allow i-frame override from config
    if (Number.isFinite(G.iFrameMs)) this._iFrameMs = G.iFrameMs;

    // --- Groups ---
    this.platforms = this.physics.add.staticGroup();
    this.enemies = this.physics.add.group();
    this.coins = this.physics.add.group();
    this.playerBullets = this.physics.add.group({ classType: Phaser.Physics.Arcade.Image, runChildUpdate: false });
    this.enemyBullets = this.physics.add.group({ classType: Phaser.Physics.Arcade.Image, runChildUpdate: false });

    // --- Create static obstacles (airship decks still used as blockers) ---
    const deckH = 40;
    this._spawnInitialDecks(deckH);

    // --- Player ---
    if (!images.player) {
      console.warn('[GameScene] Missing images.player in config.json');
    }
    this.player = this.physics.add.sprite(200, H - 200, 'player');
    if (this.player) {
      // this._setDisplayAndBody(this.player, 280, 180, true);
      this._applyPlayerBodyFromConfig();
      this.player.setCollideWorldBounds(true);
      this.player.setDamping(true).setDrag(800).setMaxVelocity(G.playerSpeed ?? 300);

      // robust HP init
      const startHP = Number.isFinite(G.playerHealth) ? G.playerHealth : 3;
      this.player.health = Math.max(0, startHP);

      this.player.lastShotAt = 0;
      this.player.shootCooldown = G.playerShootCooldownMs ?? 250;
      this.player.moveSpeed = G.playerSpeed ?? 300;

      // ✅ breathing effect (looping 0.5 ↔ 0.8)
      this._addBreathingEffect(this.player, 0.3, 0.4, 800);

    }

    // --- Enemy + Hazard Timers ---
    this.enemySpawnTimer = this.time.addEvent({
      delay: G.enemySpawnRate ?? 2500,
      loop: true,
      callback: () => {
        if (this._getActiveEnemyCount() < this.maxEnemies) this._spawnEnemy();
      }
    });

    // this.player = this.physics.add.sprite(200, H - 200, 'player');
    // if (this.player) {
    //   this._setDisplayAndBody(this.player, 150, 150, true);
    //   this._applyPlayerBodyFromConfig();
    //   this.player.setCollideWorldBounds(true);
    //   this.player.setDamping(true).setDrag(800).setMaxVelocity(G.playerSpeed ?? 300);
    //   const startHP = Number.isFinite(G.playerHealth) ? G.playerHealth : 3;
    //   this.player.health = Math.max(0, startHP);
    //   this.player.lastShotAt = 0;
    //   this.player.shootCooldown = G.playerShootCooldownMs ?? 250;
    //   this.player.moveSpeed = G.playerSpeed ?? 300;

    //   // ✅ breathing effect
    //   this._addBreathingEffect(this.player, 1, 0.5, 800);
    // }



    this.cannonballTimer = this.time.addEvent({
      delay: G.cannonballRate ?? 1800,
      loop: true,
      // callback: () => this._spawnCannonball()
    });

    this.coinTimer = this.time.addEvent({
      delay: G.coinSpawnRate ?? 2000,
      loop: true,
      callback: () => this._spawnCoin()
    });

    // --- Collisions ---
    if (this.player && this.platforms) this.physics.add.collider(this.player, this.platforms);
    if (this.enemies && this.platforms) this.physics.add.collider(this.enemies, this.platforms);

    if (this.playerBullets && this.enemies) {
      this.physics.add.overlap(this.playerBullets, this.enemies, (bullet, enemy) => {
        if (bullet && enemy) {
          bullet.destroy();
          this._damageEnemy(enemy, 1);
        }
      });
    }

    if (this.enemyBullets && this.player) {
      // Destroy projectile first so it cannot stack; damage call is i-frame gated
      // Use process callback to gate by i-frames and object state
      this.physics.add.overlap(
        this.player,            // keep player first
        this.enemyBullets,      // then projectiles
        this._onProjectileHitPlayer,        // collideCallback
        this._shouldProjectileHitPlayer,    // processCallback (returns true/false)
        this
      );

    }

    if (this.player && this.enemies) {
      this.physics.add.overlap(this.player, this.enemies, (player, enemy) => {
        if (player && enemy && enemy.active) {
          this._hurtPlayer(1);
        }
      });
    }
    if (this.player && this.coins) {
      this.physics.add.overlap(this.player, this.coins, (pl, coin) => {
        if (coin) this._collectCoin(coin);
      });
    }

    // --- Inputs (keyboard fallback for desktop) ---
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keyShoot = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.CTRL);

    // --- Mobile: Virtual Joystick + Action (shoot) ---
    this._createJoystickControls();      // joystick (all-direction movement)
    this._createActionButtonOnly();      // only the shoot button

    // --- UI (gameplay only) ---
    // UI panels (subtle backgrounds)
    this._makeUIPanel(12, 12, 260, 56, 0);              // left panel (score)
    this._makeUIPanel(W / 2 - 110, 12, 220, 56, 0);       // center panel (timer)
    this._makeUIPanel(W - 272, 12, 260, 56, 0);         // right panel (hp)

    this.add.image(150, 50, 'scoreback').setScrollFactor(0).setScale(0.8);
    this.add.image(850, 50, 'scoreback').setScrollFactor(0).setScale(0.8);
    this.add.image(1750, 50, 'scoreback').setScrollFactor(0).setScale(0.8);

    // Styled labels
    const labelScore = (texts.score_label ?? 'Score: ');
    this.scoreText = this.add.text(80, 22, `${labelScore}0`, {
      fontFamily: this._getTheme().fontFamily,
      fontSize: '39px',
      fill: '#000000ff'


    });

    this.timerText = this.add.text(W / 2 - 110, 22, this._formatTime(this._timeLeft), {
      fontFamily: this._getTheme().fontFamily,
      fontSize: '39px',
      fill: '#000000ff'
    });

    this.add.text(W / 2 - 165, 22, 'Time:', {
      fontFamily: this._getTheme().fontFamily,
      fontSize: '39px',
      fill: '#000000ff'
    }).setOrigin(0.5, 0).setScrollFactor(0);

    this.healthText = this.add.text(W - 150, 22, `Lives: ${this.player ? this.player.health : 0}`, {
      fontFamily: this._getTheme().fontFamily,
      fontSize: '39px',
      fill: '#000000ff'
    }).setOrigin(1, 0);

    // Nice vignette
    // this._addVignette();


    // --- Timer countdown ---
    // --- Timer countdown ---
    this.clockEvent = this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        if (this._finished) return;

        this._timeLeft--;
        if (this.timerText) {
          this.timerText.setText(this._formatTime(this._timeLeft));

          if (this._timeLeft <= 10) {
            const { colors } = this._getTheme();
            this.timerText.setColor(colors.timerLo);
            // pulse once each second under 10s
            this.tweens.add({
              targets: this.timerText,
              scaleX: 1.15, scaleY: 1.15,
              yoyo: true, repeat: 0, duration: 120, ease: 'Quad.easeOut'
            });
          } else {
            const { colors } = this._getTheme();
            this.timerText.setColor(colors.timerHi);
          }
        }

        if (this._timeLeft <= 0) this._onTimeUp();
      }
    });


    // --- BGM ---
    if (cfg.audio?.bgm) {
      this.bgm = this.sound.add('bgm', { loop: true, volume: G.bgmVolume ?? 0.4 });
      this.bgm && this.bgm.play();
    }
  }

  _shouldProjectileHitPlayer(player, proj) {
    // Hard guards
    if (!player || !proj || this._finished) return false;
    if (!player.active || !proj.active) return false;
    if (!proj.body || !proj.body.enable) return false;

    // Respect i-frames BEFORE running collideCallback
    const now = this.time?.now ?? performance.now();
    const iFrame = this._iFrameMs || 350;
    const last = this._lastHurtAt || -9999;
    if (now - last < iFrame) return false;

    // Optional: prevent double-processing on same proj
    if (proj.getData && proj.getData('hitOnce')) return false;

    return true; // allow _onProjectileHitPlayer to run
  }

  _onProjectileHitPlayer(player, proj) {
    // Mark + hard-disable projectile immediately so Arcade can't re-trigger
    if (proj?.setData) proj.setData('hitOnce', true);

    if (proj?.body) proj.body.enable = false;
    if (proj?.setActive) proj.setActive(false);
    if (proj?.setVisible) proj.setVisible(false);

    // Destroy on next tick to avoid re-entrancy in some Phaser builds
    this.time.delayedCall(0, () => { if (proj?.scene) proj.destroy(); });

    // Now apply damage (this already has i-frame & death logic)
    this._hurtPlayer(1);
  }


  update(time, delta) {
    if (this._finished) return;

    const W = this.scale.width;
    const H = this.scale.height;

    // ---- Player movement via Joystick or Keyboard fallback ----
    if (this.player && this.player.body && this.player.active) {
      // Update joystick vector (if active)
      this._updateJoystickVector();

      let vx = 0, vy = 0;

      // Joystick has priority on mobile
      if (this.joy.active) {
        const spd = this.player.moveSpeed;
        vx = this.joy.vecX * spd;
        vy = this.joy.vecY * spd;
      } else {
        // Keyboard fallback for desktop testing
        const up = this.cursors?.up?.isDown;
        const down = this.cursors?.down?.isDown;
        const left = this.cursors?.left?.isDown;
        const right = this.cursors?.right?.isDown;

        if (left) vx -= this.player.moveSpeed;
        if (right) vx += this.player.moveSpeed;
        if (up) vy -= this.player.moveSpeed;
        if (down) vy += this.player.moveSpeed;
      }

      this.player.setVelocity(vx, vy);

      // Face direction horizontally only (optional)
      if (vx < 0) this.player.setFlipX(true);
      else if (vx > 0) this.player.setFlipX(false);

      // Shoot (keyboard or mobile action)
      if ((this.keyShoot && this.keyShoot.isDown) || this.touchAction) this._tryShoot(time);
    }

    // Cleanup off-screen projectiles and coins
    this._cleanupGroup(this.playerBullets, W, H);
    this._cleanupGroup(this.enemyBullets, W, H);
    this._cleanupGroup(this.coins, W, H);

    // Enemy shooting + cleanup
    if (this.enemies) {
      this.enemies.children.iterate((e) => {
        if (!e || !e.body || !e.active) return;
        if (e.nextShootAt == null) {
          e.nextShootAt = (this.time?.now ?? performance.now()) + this._enemyShootMin;
        }

        if (time >= e.nextShootAt) {
          this._enemyShoot(e);
          e.nextShootAt = time + Phaser.Math.Between(this._enemyShootMin, this._enemyShootMax);
        }

      });
    }
  }

  // ----------------------
  // Helpers and Systems
  // ----------------------

  _spawnInitialDecks(deckH) {

  }

  _spawnEnemy() {
    if (this._getActiveEnemyCount() >= this.maxEnemies) return;

    const W = this.scale.width;
    const H = this.scale.height;

    const enemy = this.enemies?.create(
      Phaser.Math.Between(W * 0.55, W - 60),
      Phaser.Math.Between(H * 0.20, H * 0.85),
      'enemy'
    );
    if (!enemy) {
      console.warn('[GameScene] Enemy sprite creation failed (check images.enemy key)');
      return;
    }

    this._setDisplayAndBody(enemy, 150, 150, false);
    this._applyEnemyBodyFromConfig(enemy);
    enemy.health = 1;
    enemy.setCollideWorldBounds(true);
    enemy.nextShootAt = (this.time?.now ?? performance.now()) + this._enemyShootMin;

    // ✅ add breathing after sizing
    this._addBreathingEffect(enemy, 0.5, 0.8, 900);
  }




  _spawnCoin() {
    const W = this.scale.width;
    const H = this.scale.height;

    // Spawn at a random horizontal (X) position, slightly above the screen (Y = -40)
    const coin = this.coins?.create(
      Phaser.Math.Between(W * 0.1, W * 0.9),
      -40,
      'collectible'
    );

    if (!coin) {
      console.warn('[GameScene] Coin creation failed (check images.collectible key)');
      return;
    }

    // Keep same display size/physics settings
    this._setDisplayAndBody(coin, 100, 100, false);

    // Make it fall down with a vertical velocity
    if (coin.body) coin.setVelocityY(200); // adjust speed as needed
  }


  _enemyShoot(enemy) {
    if (!enemy || !enemy.active) return;

    // enemies use 'bullet1'
    const hasEnemyBullet = !!(this.registry.get('cfg')?.images1?.bullet1);
    const key = hasEnemyBullet ? 'bullet1' : null;

    if (!key) {
      console.warn('[GameScene] images.bullet1 missing in config; enemy will not shoot.');
      return;
    }

    const proj = this.enemyBullets?.create(enemy.x - 20, enemy.y, key);
    if (!proj) return;

    // tune size if needed
    this._setDisplayAndBody(proj, 50, 50, false);

    const vx = Phaser.Math.Between(-220, -160);
    const vy = Phaser.Math.Between(-40, 40);
    if (proj.body) proj.setVelocity(vx, vy);
  }


  _tryShoot(now) {
    if (!this.player || !this.player.active) return;
    if (now - (this.player.lastShotAt || 0) < (this.player.shootCooldown || 0)) return;

    // player uses 'bullet'
    const hasBullet = !!(this.registry.get('cfg')?.images1?.bullet);
    if (!hasBullet) {
      console.warn('[GameScene] images.bullet missing in config; player cannot shoot.');
      return;
    }

    const dir = this.player.flipX ? -1 : 1;
    const bullet = this.playerBullets?.create(this.player.x + dir * 30, this.player.y - 6, 'bullet');
    if (!bullet) return;

    // tune size if needed
    this._setDisplayAndBody(bullet, 50, 50, false);
    if (bullet.body) bullet.setVelocity(520 * dir, 0);

    this.player.lastShotAt = now;
    this._playSfx('attack');
  }


  _collectCoin(coin) {
    coin?.destroy();
    this._score += 10;
    this._updateScore();
    this._playSfx('collect');

    // popup at coin position
    this._popupText(coin?.x ?? this.player.x, coin?.y ?? this.player.y, '+10', this._getTheme().colors.score);
  }


  _damageEnemy(enemy, dmg) {
    if (!enemy || !enemy.active) return;
    enemy.health = (enemy.health ?? 1) - dmg;
    if (enemy.health <= 0) {
      this._kills += 1;
      this._score += 5;
      this._updateScore();
      this._popupText(enemy.x, enemy.y - 20, 'KO!', '#ffea00');
      enemy.destroy();
      this.cameras.main.flash(80, 255, 235, 120);
      this._playSfx('destroy');

      // 👇 immediate refill if we're below the cap
      const respawnDelay = this.registry.get('cfg')?.gameplay?.enemyRespawnDelay ?? 200;
      this.time.delayedCall(respawnDelay, () => {
        if (!this._finished && this._getActiveEnemyCount() < this.maxEnemies) {
          this._spawnEnemy();
        }
      });

      if (this._kills >= this._targetKills) this._win();


    }
  }


  _hurtPlayer(dmg) {
    if (this._finished || !this.player || !this.player.active) return;

    this.cameras.main.shake(120, 0.004);
    this.cameras.main.flash(100, 255, 64, 64); // reddish flash

    // Already dead? Ignore
    if ((this.player.health ?? 0) <= 0) return;

    const now = this.time?.now ?? performance.now();
    if (now - (this._lastHurtAt || -9999) < (this._iFrameMs || 350)) {
      return; // Invulnerable window
    }
    this._lastHurtAt = now;

    const cur = Number.isFinite(this.player.health) ? this.player.health : 1;
    const amount = Number.isFinite(dmg) ? dmg : 1;

    this.player.health = Math.max(0, cur - amount);
    this.healthText && this.healthText.setText(`Lives: ${this.player.health}`);
    this._playSfx('hit');

    // Tiny blink feedback
    this.player.setAlpha(0.5);
    this.time.delayedCall(120, () => this.player && this.player.active && this.player.setAlpha(1));

    if (this.player.health <= 0) {
      this._gameOver();
    }
  }

  _onTimeUp() {
    if (this._finished) return; // guard
    this._win();                // always win when timer hits 0
  }


  _win() {
    if (this._finished) return;
    this._finished = true;
    // this._playSfx('win');
    this._cleanupTimers();

    const result = { win: true, score: this._score, kills: this._kills, timeLeft: this._timeLeft };
    this.registry.set('last_result', result);
    this.events.emit('game-finished', { win: true });

    this._transitionToScene('WinScene', result);
  }

  _gameOver() {
    if (this._finished) return;
    this._finished = true;
    // this._playSfx('lose');

    // Optional death tween stays (purely visual)
    if (this.player && this.player.active) {
      this.tweens.add({
        targets: this.player,
        alpha: 0,
        duration: 500,
        ease: 'Power2'
      });
    }

    const result = { win: false, score: this._score, kills: this._kills, timeLeft: this._timeLeft };
    this._cleanupTimers();
    this.registry.set('last_result', result);
    this.events.emit('game-finished', { win: false });

    this._transitionToScene('GameOverScene', result);
  }


  _cleanupTimers() {
    [this.enemySpawnTimer, this.cannonballTimer, this.coinTimer, this.clockEvent].forEach(t => t && t.remove(false));
    this.enemySpawnTimer = this.cannonballTimer = this.coinTimer = this.clockEvent = null;
    if (this.bgm) { this.bgm.stop(); this.bgm.destroy(); this.bgm = null; }
  }

  _transitionToScene(targetSceneKey, payload = {}) {
    if (this._transitioning) return;           // guard against double-calls
    this._transitioning = true;

    // stop timers, music, inputs
    this._cleanupTimers();
    this.input?.keyboard?.enabled && (this.input.keyboard.enabled = false);

    const cam = this.cameras.main;
    cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start(targetSceneKey, payload);
    });
    cam.fadeOut(400, 0, 0, 0);
  }


  // ----------------------
  //  Joystick + Action Button
  // ----------------------

  _createJoystickControls() {
    // Drawn joystick (no assets)
    const base = this.add.graphics().setScrollFactor(0).setDepth(2000).setAlpha(0.35);
    const thumb = this.add.graphics().setScrollFactor(0).setDepth(2001).setAlpha(0.9);

    this.joy.base = base;
    this.joy.thumb = thumb;

    // initial center
    this.joy.centerX = 140;
    this.joy.centerY = this.scale.height - 140;

    const drawBase = () => {
      const cx = this.joy.centerX, cy = this.joy.centerY;
      base.clear();
      base.fillStyle(0x000000, 0.35);
      base.fillCircle(cx, cy, this.joy.radius + 14);
      base.lineStyle(2, 0xffffff, 0.5);
      base.strokeCircle(cx, cy, this.joy.radius + 14);
    };
    const drawThumb = (x, y) => {
      thumb.clear();
      thumb.fillStyle(0xffffff, 0.85);
      thumb.fillCircle(x, y, 22);
      thumb.lineStyle(2, 0x000000, 0.6);
      thumb.strokeCircle(x, y, 22);
    };

    drawBase();
    drawThumb(this.joy.centerX, this.joy.centerY);

    // Pointer handling (use live centers and live height to avoid stale closures)
    this.input.on('pointerdown', (p) => {
      const cx = this.joy.centerX, cy = this.joy.centerY;
      const dx = p.x - cx, dy = p.y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const near = dist <= (this.joy.radius + 60) && p.y >= (this.scale.height * 0.55); // bottom half preference
      if (near && this.joy.pointerId === null) {
        this.joy.pointerId = p.id;
        this.joy.active = true;
        this._updateThumb(p.x, p.y, drawThumb);
      }
    });

    this.input.on('pointermove', (p) => {
      if (this.joy.pointerId === p.id && this.joy.active) {
        this._updateThumb(p.x, p.y, drawThumb);
      }
    });

    this.input.on('pointerup', (p) => {
      if (this.joy.pointerId === p.id) {
        this.joy.pointerId = null;
        this.joy.active = false;
        this.joy.vecX = 0;
        this.joy.vecY = 0;
        drawThumb(this.joy.centerX, this.joy.centerY);
      }
    });

    // Keep joystick pinned on resize
    this.scale.on('resize', ({ width, height }) => {
      this.joy.centerX = 140;
      this.joy.centerY = height - 140;
      drawBase();
      drawThumb(this.joy.centerX, this.joy.centerY);
    });
  }

  _updateThumb(px, py, drawThumb) {
    const cx = this.joy.centerX, cy = this.joy.centerY;
    const dx = px - cx, dy = py - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const r = this.joy.radius;

    let nx = 0, ny = 0, tx = cx, ty = cy;

    if (dist > this.joy.dead) {
      const clamped = Math.min(dist, r);
      const ang = Math.atan2(dy, dx);
      nx = Math.cos(ang) * (clamped / r);
      ny = Math.sin(ang) * (clamped / r);
      tx = cx + Math.cos(ang) * clamped;
      ty = cy + Math.sin(ang) * clamped;
    }

    this.joy.vecX = nx;
    this.joy.vecY = ny;
    drawThumb(tx, ty);
  }

  _updateJoystickVector() {
    // reserved for future smoothing/filters
  }

  _createActionButtonOnly() {
    const cfg = this.registry.get('cfg') || {};
    const images = cfg.ui || {};

    // Keep only the action (shoot) button on the right
    if (!images.action) return;

    const mkBtn = (x, y, key, downFn, upFn) => {
      const b = this.add.image(x, y, key).setScrollFactor(0).setDepth(2000).setInteractive({ useHandCursor: true });
      b.setDisplaySize(110, 110);
      b.on('pointerdown', () => { b.setScale(0.95).setAlpha(0.8); downFn(); });
      b.on('pointerup', () => { b.setScale(1).setAlpha(1); upFn(); });
      b.on('pointerout', () => { b.setScale(1).setAlpha(1); upFn(); });
      return b;
    };

    this.mobileButtons.action = mkBtn(this.scale.width - 200, this.scale.height - 150, 'action',
      () => this.touchAction = true,
      () => this.touchAction = false
    );

    // Keep button pinned on resize
    this.scale.on('resize', ({ width, height }) => {
      if (this.mobileButtons.action) this.mobileButtons.action.setPosition(width - 160, height - 100);
    });
  }

  // ----------------------
  // Shared helpers
  // ----------------------

  _setDisplayAndBody(obj, w, h, isPlayer) {
    if (!obj) return;
    obj.setDisplaySize(w, h);
    if (!obj.body) this.physics.add.existing(obj);
    obj.body && obj.body.setSize(w, h);
    if (isPlayer && obj.body) obj.body.setOffset(0, 0);
  }

  _addBreathingEffect(target, minScale = 0.5, maxScale = 0.8, duration = 800) {
    if (!target || target.getData?.('breathing')) return;
    target.setData && target.setData('breathing', true);

    // start at min, tween to max, yoyo forever
    target.setScale(minScale);
    this.tweens.add({
      targets: target,
      scaleX: maxScale,
      scaleY: maxScale,
      duration,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });
  }


  _cleanupGroup(group, W, H) {
    if (!group) return;
    group.children.iterate((o) => {
      if (!o) return;
      if (o.x < -80 || o.x > W + 80 || o.y < -120 || o.y > H + 120) o.destroy();
    });
  }

  _applyEnemyBodyFromConfig(enemy) {
    if (!enemy || !enemy.body) return;
    const G = (this.registry.get('cfg')?.gameplay) || {};
    const b = (G.enemyBody || {}); // { width, height, offsetX, offsetY }

    const w = Number.isFinite(b.width) ? b.width : enemy.displayWidth;
    const h = Number.isFinite(b.height) ? b.height : enemy.displayHeight;
    enemy.body.setSize(w, h);

    const ox = Number.isFinite(b.offsetX) ? b.offsetX : 0;
    const oy = Number.isFinite(b.offsetY) ? b.offsetY : 0;
    enemy.body.setOffset(ox, oy);
  }


  _applyPlayerBodyFromConfig() {
    if (!this.player || !this.player.body) return;
    const G = (this.registry.get('cfg')?.gameplay) || {};
    const b = G.playerBody || {}; // { width, height, offsetX, offsetY }

    const w = Number.isFinite(b.width) ? b.width : this.player.displayWidth;
    const h = Number.isFinite(b.height) ? b.height : this.player.displayHeight;
    this.player.body.setSize(w, h);

    const ox = Number.isFinite(b.offsetX) ? b.offsetX : 0;
    const oy = Number.isFinite(b.offsetY) ? b.offsetY : 0;
    this.player.body.setOffset(ox, oy);
  }


  _formatTime(t) {
    const m = Math.floor(t / 60).toString().padStart(2, '0');
    const s = Math.floor(t % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  _updateScore() {
    const cfg = this.registry.get('cfg') || {};
    const texts = cfg.texts || {};
    const labelScore = (texts.score_label ?? 'Score: ');
    if (this.scoreText) this.scoreText.setText(labelScore + this._score);
  }

  _playSfx(which) {
    const map = {
      attack: 'attack',
      collect: 'collect',
      hit: 'hit',
      destroy: 'destroy',
      // win: 'win',
      // lose: 'lose',
      jump: 'jump'
    };
    const key = map[which];
    if (key) {
      try { this.sound.play(key, { volume: (this.registry.get('cfg')?.gameplay?.sfxVolume ?? 0.6) }); } catch (e) { }
    }
  }
}