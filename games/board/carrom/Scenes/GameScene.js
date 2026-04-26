class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');

    // Flags / core state
    this._ready = false;           // becomes true after assets load + world build
    this.cfg = null;

    // Gameplay state
    this.turn = 'player';          // 'player' (bottom) | 'bot' (top)
    this.striker = null;
    this.coins = null;
    this.whites = null;
    this.blacks = null;
    this.queen = null;
    this.pockets = [];             // [{pos: Vector2, r: number}]
    this.scores = { player: 0, bot: 0 };

    // UI
    this.ui = { scoreText: null, turnText: null };

    // Input helpers
    this.inputState = {
      pointerDown: false,
      downPos: new Phaser.Math.Vector2(),
      curPos: new Phaser.Math.Vector2()
    };

    // Audio
    this.sfx = {};
    this.bgm = null;
    this.FX_ENABLED = false; // Turn off visuals that could resemble coins

    // Canvas size (portrait)
    this.W = 1080;
    this.H = 1920;

    // Shot tuning (overridden by config.gameplay)
    this.shotPowerCap = 520; // max pull distance contributing to power
    this.shotPowerScale = 20;  // multiplier from pull to velocity

    this.shooting = false;
    this.canShoot = false;
    this.turnSettling = false;

    // Enhancement tracking
    this.enhancementActive = true;
    this.activeEffects = new Set();
    this.activeTweens = new Set();
    this.activeParticles = new Set();
    this.enhancementsInitialized = false;
    this.effectCount = 0;
    this.maxEffects = 50;

    // Enhancement elements
    this.pocketGlows = [];
    this.boardGlow = null;
    this.coinGlows = new Map();
    this.strikerTrail = null;
  }

  preload() {
    // Stage 1: load config.json
    const bust = Date.now();
    this.load.json('cfg', `./config.json?v=${bust}`);

    // When config is in cache, queue *all* assets described by it
    this.load.once('complete', () => {
      const cfg = this.cache.json.get('cfg') || {};
      this.registry.set('cfg', cfg);

      // Images: accept images1, images2, and ui blocks
      const addImages = (obj) => {
        if (!obj) return;
        Object.keys(obj).forEach((k) => this.load.image(k, obj[k]));
      };
      addImages(cfg.images1);
      addImages(cfg.images2);
      addImages(cfg.ui); // includes striker, coinWhite, coinBlack, coinQueen, buttons, etc.

      // Spritesheets
      const sheets = cfg.spritesheets || {};
      Object.keys(sheets).forEach((key) => {
        const s = sheets[key];
        this.load.spritesheet(key, s.url, { frameWidth: s.frameWidth, frameHeight: s.frameHeight });
      });

      // Audio
      const aud = cfg.audio || {};
      Object.keys(aud).forEach((k) => this.load.audio(k, aud[k]));

      // Stage 2: start the actual asset load
      this.load.start();
    });
  }

  create() {
    this._bootstrapConfigAndAssets();
    this._buildWorld();
    this.setupEnhancements();
    this._ready = true;
  }

  update() {
    if (!this._ready) return;

    // Auto-sleep tiny velocities
    this._applyAutoSleep();

    const moving = this._anyMoving();
    if (!moving && this.turnSettling) {
      this.turnSettling = false;
      this._handleTurnEnd();
    }

    if (this.turn === 'bot' && !moving && !this.shooting) {
      this.time.delayedCall(400, () => this._botShoot(), [], this);
    }

    if (this.turn === 'player' && !this.shooting && this.canShoot) {
      this._lockStrikerToBaseline('player');
    } else if (this.turn === 'bot' && !this.shooting && this.canShoot) {
      this._lockStrikerToBaseline('bot');
    }

    // Performance monitoring
    this.monitorPerformance();
  }

  // Enhancement System
  setupEnhancements() {
    if (this.enhancementsInitialized) return;

    this.safeEnhance(() => {
      this.createEffectSystems();
      this.enhanceInteractions();
      this.setupParticleSystems();
      this.createAmbientEffects();
      this.enhancementsInitialized = true;
    });
  }

  safeEnhance(effectFunction, fallbackFunction = () => { }) {
    try {
      effectFunction.call(this);
    } catch (error) {
      console.warn('Enhancement failed safely:', error);
      fallbackFunction.call(this);
    }
  }

  createEffectSystems() {
    if (!this.FX_ENABLED) return;
    // Create glow effects for pockets
    this.pockets.forEach((pocket, index) => {
      const glow = this.add.circle(pocket.pos.x, pocket.pos.y, pocket.r * 1.5, 0x00ff88, 0.0);
      glow.setDepth(1);
      this.pocketGlows[index] = glow;
    });

    // Create board ambient glow
    const b = this.physics.world.bounds;
    this.boardGlow = this.add.circle(b.centerX, b.centerY, 150, 0x4a90e2, 0.0);
    this.boardGlow.setDepth(1);
    this.animateBoardGlow();
  }

  animateBoardGlow() {
    if (!this.FX_ENABLED) return;
    this.safeEnhance(() => {
      const tween = this.tweens.add({
        targets: this.boardGlow,
        alpha: 0.12,
        scaleX: 1.1,
        scaleY: 1.1,
        duration: 3000,
        ease: 'Sine.easeInOut',
        yoyo: true,
        repeat: -1
      });
      this.activeTweens.add(tween);
    });
  }

  enhanceInteractions() {
    // Store original states for all sprites
    this.coins.getChildren().forEach(coin => this.preserveOriginalState(coin));
    if (this.striker) this.preserveOriginalState(this.striker);
  }

  setupParticleSystems() {
    // We'll create particles dynamically to avoid asset dependencies
  }

  createAmbientEffects() {
    if (!this.FX_ENABLED) return;
    this.safeEnhance(() => {
      // Subtle floating particles around the board
      this.time.addEvent({
        delay: 2000,
        callback: this.createFloatingParticle,
        callbackScope: this,
        loop: true
      });
    });
  }

  createFloatingParticle() {
    if (!this.FX_ENABLED) return;
    if (this.effectCount > this.maxEffects) return;

    this.safeEnhance(() => {
      const b = this.physics.world.bounds;
      const x = Phaser.Math.Between(b.x, b.x + b.width);
      const y = Phaser.Math.Between(b.y, b.y + b.height);

      const particle = this.add.circle(x, y, 2, 0xffffff, 0.3);
      particle.setDepth(0);
      this.activeEffects.add(particle);
      this.effectCount++;

      const tween = this.tweens.add({
        targets: particle,
        y: y - 100,
        alpha: 0,
        duration: 4000 + Phaser.Math.Between(0, 2000),
        ease: 'Power1',
        onComplete: () => {
          particle.destroy();
          this.activeEffects.delete(particle);
          this.effectCount--;
        }
      });
      this.activeTweens.add(tween);
    });
  }

  preserveOriginalState(sprite) {
    if (!sprite.originalScale) {
      sprite.originalScale = sprite.scaleX;
    }
    if (!sprite.originalAlpha) {
      sprite.originalAlpha = sprite.alpha;
    }
    if (!sprite.originalTint) {
      sprite.originalTint = sprite.tint;
    }
  }

  monitorPerformance() {
    if (this.game.loop.actualFps < 45 && this.enhancementActive) {
      this.reduceEffects();
    }
  }

  reduceEffects() {
    this.safeEnhance(() => {
      // Reduce particle count
      this.maxEffects = Math.max(20, this.maxEffects - 10);

      // Clear some active effects
      let removed = 0;
      this.activeEffects.forEach(effect => {
        if (removed < 10 && effect && effect.destroy) {
          effect.destroy();
          this.activeEffects.delete(effect);
          removed++;
        }
      });
    });
  }

  createExplosionEffect(x, y, color = 0xffffff) {
    if (!this.FX_ENABLED) return;
    if (this.effectCount > this.maxEffects) return;

    this.safeEnhance(() => {
      // Create multiple particles for explosion (non-circular to avoid coin resemblance)
      for (let i = 0; i < 8; i++) {
        const particle = this.add.star(x, y, 4, 3, 6, color, 0.8); // Use star shape
        particle.setDepth(5);
        this.activeEffects.add(particle);
        this.effectCount++;

        const angle = (i / 8) * Math.PI * 2;
        const distance = Phaser.Math.Between(30, 80);
        const targetX = x + Math.cos(angle) * distance;
        const targetY = y + Math.sin(angle) * distance;

        const tween = this.tweens.add({
          targets: particle,
          x: targetX,
          y: targetY,
          alpha: 0,
          scaleX: 0.1,
          scaleY: 0.1,
          duration: 500 + Phaser.Math.Between(0, 300),
          ease: 'Power2',
          onComplete: () => {
            particle.destroy();
            this.activeEffects.delete(particle);
            this.effectCount--;
          }
        });
        this.activeTweens.add(tween);
      }
    });
  }

  createCollectionEffect(sprite) {
    if (!this.FX_ENABLED) return;
    if (this.effectCount > this.maxEffects) return;

    this.safeEnhance(() => {
      // Sparkle effect (using stars to avoid coin resemblance)
      for (let i = 0; i < 6; i++) {
        const sparkle = this.add.star(
          sprite.x + Phaser.Math.Between(-20, 20),
          sprite.y + Phaser.Math.Between(-20, 20),
          4, 2, 5, 0xffd700, 0.9
        );
        sparkle.setDepth(4);
        this.activeEffects.add(sparkle);
        this.effectCount++;

        const tween = this.tweens.add({
          targets: sparkle,
          scaleX: 0,
          scaleY: 0,
          alpha: 0,
          duration: 400,
          delay: i * 50,
          ease: 'Power2',
          onComplete: () => {
            sparkle.destroy();
            this.activeEffects.delete(sparkle);
            this.effectCount--;
          }
        });
        this.activeTweens.add(tween);
      }

      // Score popup
      const scoreText = this.add.text(sprite.x, sprite.y - 30, '+1', {
        fontSize: '32px',
        fill: '#ffff00',
        stroke: '#000000',
        strokeThickness: 2
      });
      scoreText.setDepth(6);
      this.activeEffects.add(scoreText);

      const tween = this.tweens.add({
        targets: scoreText,
        y: scoreText.y - 60,
        alpha: 0,
        duration: 1000,
        ease: 'Power2',
        onComplete: () => {
          scoreText.destroy();
          this.activeEffects.delete(scoreText);
        }
      });
      this.activeTweens.add(tween);
    });
  }

  createHitEffect(sprite) {
    if (!this.FX_ENABLED) return;
    this.safeEnhance(() => {
      const originalTint = sprite.tint;
      sprite.setTint(0xffffff);

      const tween = this.tweens.add({
        targets: sprite,
        alpha: 0.7,
        duration: 80,
        yoyo: true,
        onComplete: () => {
          sprite.setTint(originalTint);
          sprite.setAlpha(1);
        }
      });
      this.activeTweens.add(tween);
    });
  }

  addScreenShake(intensity = 4) {
    this.safeEnhance(() => {
      this.cameras.main.shake(150, intensity);
    });
  }

  enhanceStrikerMovement(striker) {
    if (!this.FX_ENABLED) return;
    if (!striker || !striker.body) return;

    this.safeEnhance(() => {
      const speed = Math.sqrt(striker.body.velocity.x ** 2 + striker.body.velocity.y ** 2);
      if (speed > 100) {
        // Create trail effect (non-circular to avoid coin resemblance)
        const trail = this.add.star(striker.x, striker.y, 4, 3, 6, 0x4a90e2, 0.4);
        trail.setDepth(1);
        this.activeEffects.add(trail);
        this.effectCount++;

        const tween = this.tweens.add({
          targets: trail,
          scaleX: 0.1,
          scaleY: 0.1,
          alpha: 0,
          duration: 300,
          ease: 'Power2',
          onComplete: () => {
            trail.destroy();
            this.activeEffects.delete(trail);
            this.effectCount--;
          }
        });
        this.activeTweens.add(tween);
      }
    });
  }

  animatePocketGlow(pocketIndex, active = true) {
    if (!this.FX_ENABLED) return;
    if (!this.pocketGlows[pocketIndex]) return;

    this.safeEnhance(() => {
      const glow = this.pocketGlows[pocketIndex];

      if (active) {
        const tween = this.tweens.add({
          targets: glow,
          alpha: 0.4,
          scaleX: 1.2,
          scaleY: 1.2,
          duration: 500,
          ease: 'Power2'
        });
        this.activeTweens.add(tween);
      } else {
        const tween = this.tweens.add({
          targets: glow,
          alpha: 0,
          scaleX: 1,
          scaleY: 1,
          duration: 300,
          ease: 'Power2'
        });
        this.activeTweens.add(tween);
      }
    });
  }

  enhanceUIUpdate(scoreChange) {
    this.safeEnhance(() => {
      if (scoreChange && this.ui.scoreText) {
        const tween = this.tweens.add({
          targets: this.ui.scoreText,
          scaleX: 1.1,
          scaleY: 1.1,
          duration: 200,
          yoyo: true,
          ease: 'Power2'
        });
        this.activeTweens.add(tween);
      }
    });
  }

  enhanceTurnTransition() {
    this.safeEnhance(() => {
      if (this.ui.turnText) {
        const tween = this.tweens.add({
          targets: this.ui.turnText,
          alpha: 0.5,
          scaleX: 0.9,
          scaleY: 0.9,
          duration: 300,
          yoyo: true,
          ease: 'Power2'
        });
        this.activeTweens.add(tween);
      }

      const color = this.turn === 'player' ? 0x00ff88 : 0xff6b6b;
      if (this.boardGlow) {
        const tween = this.tweens.add({
          targets: this.boardGlow,
          alpha: 0.2,
          duration: 500,
          ease: 'Power2',
          onStart: () => {
            this.boardGlow.fillColor = color;
          }
        });
        this.activeTweens.add(tween);
      }
    });
  }

  cleanupAllEnhancements() {
    this.safeEnhance(() => {
      this.tweens.killAll();
      this.activeEffects.forEach(effect => {
        if (effect && effect.destroy) {
          effect.destroy();
        }
      });
      this.time.removeAllEvents();
      this.enhancementActive = true;
      this.effectCount = 0;
      this.activeEffects.clear();
      this.activeTweens.clear();
      this.activeParticles.clear();
      this.resetEnhancedObjects();
    });
  }

  resetEnhancedObjects() {
    this.safeEnhance(() => {
      this.children.list.forEach(child => {
        if (child.originalScale && child.setScale) {
          child.setScale(child.originalScale);
        }
        if (child.originalAlpha && child.setAlpha) {
          child.setAlpha(child.originalAlpha);
        }
        if (child.originalTint && child.setTint) {
          child.setTint(child.originalTint);
        }
      });
    });
  }

  _bootstrapConfigAndAssets() {
    let cfg = this.registry.get('cfg') || this.cache.json.get('cfg') || {};
    this.registry.set('cfg', cfg);
    this.cfg = cfg;

    const g = this.cfg.gameplay || {};
    if (g.strikerPowerCap != null) this.shotPowerCap = g.strikerPowerCap;
    if (g.strikerPowerScale != null) this.shotPowerScale = g.strikerPowerScale;
  }

  _buildWorld() {
    const g = this.cfg.gameplay || {};
    const aud = this.cfg.audio || {};

    this.W = 1080;
    this.H = 1920;
    this.cameras.main.setBackgroundColor('#0b0b0b');

    const bg = this.add.image(this.W / 2, this.H / 2, 'background');
    bg.setDisplaySize(this.W, this.H);
    const carrom_board = this.add.image(this.W / 2, this.H / 2, 'carrom_board');
    carrom_board.setScale(1.35);

    const boardWidth = this.W - 180;
    const boardLeft = 90;
    const boardTop = (this.H - boardWidth) / 2;
    this.physics.world.setBounds(boardLeft, boardTop, boardWidth, boardWidth);

    this._drawBoardFrame();

    const pocketRadius = g.pocketRadius || 38;
    const pocketInset = g.pocketInset || 8;
    const b = this.physics.world.bounds;
    const corners = [
      new Phaser.Math.Vector2(b.x + pocketInset, b.y + pocketInset),
      new Phaser.Math.Vector2(b.x + b.width - pocketInset, b.y + pocketInset),
      new Phaser.Math.Vector2(b.x + pocketInset, b.y + b.height - pocketInset),
      new Phaser.Math.Vector2(b.x + b.width - pocketInset, b.y + b.height - pocketInset),
    ];
    this.pockets = corners.map(p => ({ pos: p, r: pocketRadius }));
    this._drawPocketRings();

    this.coins = this.add.group();
    this.whites = this.add.group();
    this.blacks = this.add.group();

    const coinSize = g.coinSize || 56;
    const strikerSize = g.strikerSize || coinSize;

    const layout = this._getCarromCoinLayout();
    layout.whites.forEach(pt => {
      const c = this._makeCoin(pt.x, pt.y, 'coinWhite', coinSize);
      c.setData('owner', 'player');
      this.whites.add(c); this.coins.add(c);
    });
    layout.blacks.forEach(pt => {
      const c = this._makeCoin(pt.x, pt.y, 'coinBlack', coinSize);
      c.setData('owner', 'bot');
      this.blacks.add(c); this.coins.add(c);
    });
    this.queen = this._makeCoin(layout.queen.x, layout.queen.y, 'coinQueen', coinSize);
    this.queen.setData('owner', 'queen');
    this.coins.add(this.queen);

    this.striker = this._makeStriker(b.centerX, b.y + b.height + 60, 'striker', strikerSize);
    this._prepareStrikerForPlacement('player');

    this.children.list
      .filter(o => o !== this.striker && o?.texture?.key === 'striker')
      .forEach(o => o.destroy());

    this._setupInterCollisions();

    this.aimLine = this.add.graphics();
    this.powerArrow = this.add.graphics();
    this._setupInput();

    const txt = this.cfg.texts || {};
    const scoreLabel = txt.score_label || 'Score: ';
    this.ui.scoreText = this.add.text(40, 40, `${scoreLabel}You ${this.scores.player} - Bot ${this.scores.bot}`, {
      fontFamily: (this.cfg.font && this.cfg.font.family) || 'sans-serif',
      fontSize: '42px',
      color: '#ffffff'
    });
    this.ui.turnText = this.add.text(40, 100, `Turn: Player (Bottom)`, {
      fontFamily: (this.cfg.font && this.cfg.font.family) || 'sans-serif',
      fontSize: '36px',
      color: '#dddddd'
    });

    if (aud.bgm) {
      this.bgm = this.sound.add('bgm', { loop: true, volume: 0.35 });
      this.bgm.play();
    }
    this.sfx.jump = aud.jump ? this.sound.add('jump', { volume: 0.6 }) : null;
    this.sfx.hit = aud.hit ? this.sound.add('hit', { volume: 0.45 }) : null;
    this.sfx.collect = aud.collect ? this.sound.add('collect', { volume: 0.7 }) : null;

    this.turn = 'player';
    this.canShoot = true;
    this._updateTurnUI();
  }

  _drawBoardFrame() {
    const g = this.add.graphics();
    const b = this.physics.world.bounds;

    g.lineStyle(6, 0x5c3a1b, 1);
    g.strokeRoundedRect(b.x - 8, b.y - 8, b.width + 16, b.height + 16, 18);

    g.lineStyle(8, 0xd7b790, 1);
    g.strokeRect(b.x, b.y, b.width, b.height);

    g.lineStyle(5, 0xdeb887, 1);
    g.strokeCircle(b.centerX, b.centerY, 120);

    g.lineStyle(3, 0xcaa77a, 0.9);
    g.strokeLineShape(new Phaser.Geom.Line(b.x, b.y - 60, b.x + b.width, b.y - 60));
    g.strokeLineShape(new Phaser.Geom.Line(b.x, b.y + b.height + 60, b.x + b.width, b.y + b.height + 60));
  }

  _drawPocketRings() {
    const g = this.add.graphics();
    g.lineStyle(4, 0x9a6b3a, 1);
    const pocketR = (this.cfg.gameplay && this.cfg.gameplay.pocketRadius) || 38;
    this.pockets.forEach(p => g.strokeCircle(p.pos.x, p.pos.y, pocketR * 2));
  }

  _getCarromCoinLayout() {
    const b = this.physics.world.bounds;
    const cx = b.centerX;
    const cy = b.centerY;
    const ring1 = 80;
    const ring2 = 150;

    const angles = [0, 60, 120, 180, 240, 300];
    const whites = angles.map(a => {
      const r = Phaser.Math.DegToRad(a);
      return { x: cx + Math.cos(r) * ring1, y: cy + Math.sin(r) * ring1 };
    });
    const blacks = angles.map(a => {
      const r = Phaser.Math.DegToRad(a + 30);
      return { x: cx + Math.cos(r) * ring2, y: cy + Math.sin(r) * ring2 };
    });

    return { whites, blacks, queen: { x: cx, y: cy } };
  }

  _makeCoin(x, y, key, displaySize) {
    // Ensure no existing sprites with the same key remain
    this.children.list
      .filter(o => o?.texture?.key === key && o.active)
      .forEach(o => {
        if (o !== this.striker && !this.coins.getChildren().includes(o)) {
          o.destroy();
        }
      });

    const sp = this.add.sprite(x, y, key);
    sp.setDisplaySize(displaySize, displaySize);
    this.physics.add.existing(sp);

    const r = displaySize / 2;
    sp.body.setCircle(r, (sp.displayWidth / 2) - r, (sp.displayHeight / 2) - r);

    sp.body.setBounce(0.45);
    sp.body.setCollideWorldBounds(true);
    sp.body.setDamping(true);
    sp.body.setDrag(0.90, 0.90);
    sp.body.setMaxVelocity(1600, 1600);
    sp.setDepth(2);
    return sp;
  }

  _makeStriker(x, y, key, displaySize) {
    // Clean up any stray striker sprites
    this.children.list
      .filter(o => o?.texture?.key === key && o !== this.striker)
      .forEach(o => o.destroy());

    const sp1 = this.add.sprite(x, y, key);
    sp1.setDisplaySize(displaySize / 2, displaySize / 2);
    this.physics.add.existing(sp1);

    const r = (displaySize / 2) / 2;
    sp1.body.setCircle(r, (sp1.displayWidth / 2) - r, (sp1.displayHeight / 2) - r);

    sp1.body.setBounce(0.45);
    sp1.body.setCollideWorldBounds(true);
    sp1.body.setDamping(true);
    sp1.body.setDrag(0.82, 0.82);
    sp1.body.setMaxVelocity(6000, 6000);
    sp1.setDepth(3);

    this.safeEnhance(() => {
      const glow = this.add.circle(x, y, (sp1.displayWidth) * 0.7, 0x4a90e2, 0);
      glow.setDepth(0);
      glow.setBlendMode(Phaser.BlendModes.ADD);
      glow.setVisible(false);
      sp1.strikerGlow = glow;
      if (!this.FX_ENABLED) {
        glow.visible = false;
        glow.alpha = 0;
      }
    });

    return sp1;
  }

  _setupInterCollisions() {
    this.physics.add.collider(this.striker, this.coins.getChildren(), (striker, coin) => {
      if (this.sfx.hit) this.sfx.hit.play();
      this.createHitEffect(coin);
      this.enhanceStrikerMovement(striker);
    });

    this.physics.add.collider(this.coins, this.coins, (coin1, coin2) => {
      if (this.sfx.hit) this.sfx.hit.play();
      this.createHitEffect(coin1);
      this.createHitEffect(coin2);
    });
  }

  _setupInput() {
    this.input.on('pointerdown', (p) => {
      if (this.turn !== 'player' || !this.canShoot || this.shooting) return;
      this.inputState.pointerDown = true;
      this.inputState.downPos.set(p.worldX, p.worldY);
      this.inputState.curPos.set(p.worldX, p.worldY);

      this.safeEnhance(() => {
        if (this.striker && this.striker.strikerGlow) {
          this.striker.strikerGlow.setVisible(true);
          const tween = this.tweens.add({
            targets: this.striker.strikerGlow,
            alpha: 0.3,
            scaleX: 1.2,
            scaleY: 1.2,
            duration: 200,
            ease: 'Power2'
          });
          this.activeTweens.add(tween);
        }
      });
    });

    this.input.on('pointermove', (p) => {
      if (!this.inputState.pointerDown || this.shooting || this.turn !== 'player') return;
      this.inputState.curPos.set(p.worldX, p.worldY);

      const distY = Math.abs(p.worldY - this.striker.y);
      if (distY < 80 && this.canShoot) {
        const bx = this.physics.world.bounds.x;
        const bw = this.physics.world.bounds.width;
        this.striker.x = Phaser.Math.Clamp(p.worldX, bx + 90, bx + bw - 90);

        this.safeEnhance(() => {
          if (this.striker.strikerGlow) {
            this.striker.strikerGlow.x = this.striker.x;
            this.striker.strikerGlow.y = this.striker.y;
          }
        });

        this._clearAim();
      } else {
        this._drawAim(this.striker, this.inputState.downPos, this.inputState.curPos);

        this.safeEnhance(() => {
          this.pockets.forEach((pocket, index) => {
            const dist = Phaser.Math.Distance.Between(p.worldX, p.worldY, pocket.pos.x, pocket.pos.y);
            if (dist < 150) {
              this.animatePocketGlow(index, true);
            } else {
              this.animatePocketGlow(index, false);
            }
          });
        });
      }
    });

    this.input.on('pointerup', (p) => {
      if (!this.inputState.pointerDown || this.shooting || this.turn !== 'player') return;
      this.inputState.pointerDown = false;

      this.safeEnhance(() => {
        if (this.FX_ENABLED && this.striker?.strikerGlow) {
          const tween = this.tweens.add({
            targets: this.striker.strikerGlow,
            alpha: 0,
            scaleX: 1,
            scaleY: 1,
            duration: 300,
            ease: 'Power2',
            onComplete: () => {
              if (this.striker?.strikerGlow) this.striker.strikerGlow.setVisible(false);
            }
          });
          this.activeTweens.add(tween);
        }

        this.pockets.forEach((_, index) => {
          this.animatePocketGlow(index, false);
        });
      });

      const pullVec = new Phaser.Math.Vector2(this.striker.x - p.worldX, this.striker.y - p.worldY);
      const powerMag = pullVec.length();
      this._clearAim();
      if (!this.canShoot || powerMag < 10) return;

      pullVec.normalize();
      const velocity = pullVec.scale(Math.min(powerMag, this.shotPowerCap) * this.shotPowerScale);
      this._shootStriker(velocity);
    });
  }

  _drawAim(striker, _down, curPos) {
    this.aimLine.clear();
    this.powerArrow.clear();

    const dir = new Phaser.Math.Vector2(striker.x - curPos.x, striker.y - curPos.y);
    const len = Phaser.Math.Clamp(dir.length(), 0, this.shotPowerCap);
    if (len < 1) return;
    dir.normalize();

    this.safeEnhance(() => {
      this.aimLine.lineStyle(6, 0xffffff, 0.8);
      this.aimLine.beginPath();
      this.aimLine.moveTo(striker.x, striker.y);
      this.aimLine.lineTo(striker.x + dir.x * len, striker.y + dir.y * len);
      this.aimLine.strokePath();

      const powerRatio = len / this.shotPowerCap;
      const powerColor = powerRatio > 0.7 ? 0xff4444 : powerRatio > 0.4 ? 0xffaa00 : 0x44ff44;

      this.aimLine.lineStyle(3, powerColor, 0.9);
      this.aimLine.beginPath();
      this.aimLine.moveTo(striker.x, striker.y);
      this.aimLine.lineTo(striker.x + dir.x * len * 0.8, striker.y + dir.y * len * 0.8);
      this.aimLine.strokePath();
    }, () => {
      this.aimLine.lineStyle(6, 0xffffff, 0.7);
      this.aimLine.beginPath();
      this.aimLine.moveTo(striker.x, striker.y);
      this.aimLine.lineTo(striker.x + dir.x * len, striker.y + dir.y * len);
      this.aimLine.strokePath();
    });

    const head = dir.clone().normalize().scale(36);
    const left = new Phaser.Math.Vector2(-dir.y, dir.x).scale(16);
    const right = new Phaser.Math.Vector2(dir.y, -dir.x).scale(16);

    this.powerArrow.fillStyle(0xffd166, 0.9);
    this.powerArrow.beginPath();
    const tip = new Phaser.Math.Vector2(striker.x + dir.x * len, striker.y + dir.y * len);
    this.powerArrow.moveTo(tip.x, tip.y);
    this.powerArrow.lineTo(tip.x - head.x + left.x, tip.y - head.y + left.y);
    this.powerArrow.lineTo(tip.x - head.x + right.x, tip.y - head.y + right.y);
    this.powerArrow.closePath();
    this.powerArrow.fill();
  }

  _clearAim() {
    if (this.aimLine) this.aimLine.clear();
    if (this.powerArrow) this.powerArrow.clear();
  }

  _shootStriker(velocity) {
    if (this.sfx.jump) this.sfx.jump.play();
    this.canShoot = false;
    this.shooting = true;

    if (this.striker?.strikerGlow) {
      this.striker.strikerGlow.setVisible(false);
      this.striker.strikerGlow.alpha = 0;
    }

    this.striker.body.moves = true;
    this._setVelocity(this.striker, velocity.x, velocity.y);

    this.time.delayedCall(120, () => {
      this.events.off('update', this._pocketCheck, this);
      this.events.on('update', this._pocketCheck, this);
      this.events.off('update', this._enhancedUpdate, this);
      this.events.on('update', this._enhancedUpdate, this);
    });
  }

  _enhancedUpdate() {
    this.safeEnhance(() => {
      if (this.striker.active && this.striker.body) {
        this.enhanceStrikerMovement(this.striker);
      }

      if (this.striker.strikerGlow) {
        this.striker.strikerGlow.x = this.striker.x;
        this.striker.strikerGlow.y = this.striker.y;
      }
    });
  }

  _pocketCheck() {
    if (this.striker.active && this._inAnyPocket(this.striker)) {
      if (this.turn === 'player') this.scores.player = Math.max(0, this.scores.player - 1);
      else this.scores.bot = Math.max(0, this.scores.bot - 1);

      this.safeEnhance(() => {
        this.createExplosionEffect(this.striker.x, this.striker.y, 0xff4444);
      });

      this._sinkSprite(this.striker, false);
    }

    this.coins.getChildren().forEach(sp => {
      if (!sp.active) return;
      if (this._inAnyPocket(sp)) {
        const owner = sp.getData('owner');
        if (this.sfx.collect) this.sfx.collect.play();

        this.createCollectionEffect(sp);

        if (owner === 'player') this.scores.player += 1;
        else if (owner === 'bot') this.scores.bot += 1;
        else if (owner === 'queen') {
          this.scores[this.turn === 'player' ? 'player' : 'bot'] += 3;
          this.safeEnhance(() => {
            this.createExplosionEffect(sp.x, sp.y, 0xffd700);
          });
        }
        this._sinkSprite(sp, true);
      }
    });

    if (!this._anyMoving()) {
      this.events.off('update', this._pocketCheck, this);
      this.events.off('update', this._enhancedUpdate, this);
      this.turnSettling = true;
    }
  }

  _sinkSprite(sp, isCoin) {
    this.safeEnhance(() => {
      const tween = this.tweens.add({
        targets: sp,
        alpha: 0,
        rotation: sp.rotation + Math.PI * 2,
        duration: 300,
        ease: 'Power2.easeIn',
        onComplete: () => {
          if (isCoin) this._disableSprite(sp);
          else this._disableSprite(this.striker);
        }
      });
      this.activeTweens.add(tween);
    }, () => {
      this.tweens.add({
        targets: sp,
        alpha: 0,
        duration: 180,
        onComplete: () => {
          if (isCoin) this._disableSprite(sp);
          else this._disableSprite(this.striker);
        }
      });
    });
  }

  _inAnyPocket(sp) {
    const p = new Phaser.Math.Vector2(sp.x, sp.y);
    for (const pk of this.pockets) {
      if (Phaser.Math.Distance.BetweenPoints(p, pk.pos) <= pk.r) return true;
    }
    return false;
  }

  _handleTurnEnd() {
    const oldScore = { ...this.scores };
    this._updateScoreUI();

    const scoreChanged = oldScore.player !== this.scores.player || oldScore.bot !== this.scores.bot;
    this.enhanceUIUpdate(scoreChanged);

    const whitesLeft = this.whites.getChildren().filter(c => c.active).length;
    const blacksLeft = this.blacks.getChildren().filter(c => c.active).length;
    const coinsLeft = this.coins.getChildren().filter(c => c.active).length;

    if (whitesLeft === 0 || blacksLeft === 0 || coinsLeft === 0) {
      if (this.bgm) this.bgm.stop();
      if (this.scores.player > this.scores.bot) {
        this.scene.start('WinScene', { playerScore: this.scores.player, botScore: this.scores.bot });
      } else if (this.scores.bot > this.scores.player) {
        this.scene.start('GameOverScene', { playerScore: this.scores.player, botScore: this.scores.bot });
      } else {
        this.scene.start('GameOverScene', { playerScore: this.scores.player, botScore: this.scores.bot, tie: true });
      }
      return;
    }

    this.shooting = false;
    this.canShoot = true;

    if (this.turn === 'player') {
      this.turn = 'bot';
      this._prepareStrikerForPlacement('bot');
    } else {
      this.turn = 'player';
      this._prepareStrikerForPlacement('player');
    }

    this._updateTurnUI();
    this.enhanceTurnTransition();
  }

  _updateScoreUI() {
    const txt = (this.cfg.texts && this.cfg.texts.score_label) || 'Score: ';
    this.ui.scoreText.setText(`${txt}You ${this.scores.player} - Bot ${this.scores.bot}`);
  }

  _updateTurnUI() {
    const side = this.turn === 'player' ? 'Player (Bottom)' : 'Bot (Top)';
    this.ui.turnText.setText(`Turn: ${side}`);
  }

  _prepareStrikerForPlacement(side) {
    const b = this.physics.world.bounds;
    const y = side === 'player' ? (b.y + b.height + 60) : (b.y - 60);
    const x = b.centerX;

    this.tweens.killTweensOf(this.striker);

    this._enableSprite(this.striker, x, y);
    this._setVelocity(this.striker, 0, 0);
    this.striker.body.moves = false;
    this._lockStrikerToBaseline(side);
    this._clearAim();

    this.safeEnhance(() => {
      if (this.striker.strikerGlow) {
        this.striker.strikerGlow.x = x;
        this.striker.strikerGlow.y = y;
      }

      this.striker.setAlpha(0.5);
      const tween = this.tweens.add({
        targets: this.striker,
        alpha: 1,
        duration: 400,
        ease: 'Power2'
      });
      this.activeTweens.add(tween);
    });
  }

  _lockStrikerToBaseline(side) {
    const b = this.physics.world.bounds;
    const pad = 90;
    this.striker.y = (side === 'player') ? (b.y + b.height + 30) : (b.y - 30);
    this.striker.x = Phaser.Math.Clamp(this.striker.x, b.x + pad, b.x + b.width - pad);

    this.safeEnhance(() => {
      if (this.striker.strikerGlow) {
        this.striker.strikerGlow.x = this.striker.x;
        this.striker.strikerGlow.y = this.striker.y;
      }
    });
  }

  _botShoot() {
    if (this.turn !== 'bot' || !this.canShoot || this.shooting) return;

    const blacksAlive = this.blacks.getChildren().filter(c => c.active);
    const target = this._chooseBotTarget(blacksAlive);
    const b = this.physics.world.bounds;

    const sx = Phaser.Math.Clamp(target ? target.x : b.centerX, b.x + 100, b.x + b.width - 100);
    this._enableSprite(this.striker, sx, b.y - 60);
    this.striker.body.moves = false;
    this._lockStrikerToBaseline('bot');

    this.safeEnhance(() => {
      if (this.striker.strikerGlow) {
        const tween = this.tweens.add({
          targets: this.striker.strikerGlow,
          alpha: 0.4,
          scaleX: 1.3,
          scaleY: 1.3,
          duration: 800,
          ease: 'Power2'
        });
        this.activeTweens.add(tween);
      }

      if (target) {
        const targetIndicator = this.add.circle(target.x, target.y, 30, 0xff6b6b, 0.3);
        targetIndicator.setDepth(4);
        this.activeEffects.add(targetIndicator);

        const tween = this.tweens.add({
          targets: targetIndicator,
          scaleX: 1.5,
          scaleY: 1.5,
          alpha: 0,
          duration: 800,
          ease: 'Power2',
          onComplete: () => {
            targetIndicator.destroy();
            this.activeEffects.delete(targetIndicator);
          }
        });
        this.activeTweens.add(tween);
      }
    });

    let shotVec;
    if (target) {
      const pk = this._nearestPocket(target.x, target.y);
      const dirToTarget = new Phaser.Math.Vector2(target.x - this.striker.x, target.y - this.striker.y).normalize();
      const dirTargetToPocket = new Phaser.Math.Vector2(pk.pos.x - target.x, pk.pos.y - target.y).normalize();
      const aim = dirToTarget.scale(0.55).add(dirTargetToPocket.scale(0.45)).normalize();
      shotVec = aim.scale(this.shotPowerCap * this.shotPowerScale * 0.9);
    } else {
      shotVec = new Phaser.Math.Vector2(Phaser.Math.Between(-1, 1), Phaser.Math.Between(0, 1)).normalize()
        .scale(this.shotPowerCap * this.shotPowerScale * 0.8);
    }

    this.time.delayedCall(400, () => {
      this.shooting = true;
      this.canShoot = false;
      if (this.sfx.jump) this.sfx.jump.play();

      this.safeEnhance(() => {
        this.createExplosionEffect(this.striker.x, this.striker.y, 0xff6b6b);

        if (this.striker.strikerGlow) {
          const tween = this.tweens.add({
            targets: this.striker.strikerGlow,
            alpha: 0,
            scaleX: 1,
            scaleY: 1,
            duration: 300,
            ease: 'Power2'
          });
          this.activeTweens.add(tween);
        }
      });

      this.striker.body.moves = true;
      this._setVelocity(this.striker, shotVec.x, shotVec.y);
      this.events.off('update', this._pocketCheck, this);
      this.events.on('update', this._pocketCheck, this);
      this.events.off('update', this._enhancedUpdate, this);
      this.events.on('update', this._enhancedUpdate, this);
    });
  }

  _chooseBotTarget(blacksAlive) {
    if (blacksAlive.length === 0) return null;
    const b = this.physics.world.bounds;
    const center = new Phaser.Math.Vector2(b.centerX, b.centerY);
    let best = null, bestDist = Number.MAX_VALUE;
    blacksAlive.forEach(c => {
      const d = Phaser.Math.Distance.Between(c.x, c.y, center.x, center.y);
      if (d < bestDist) { best = c; bestDist = d; }
    });
    return best;
  }

  _nearestPocket(x, y) {
    let best = this.pockets[0];
    let bestD = Number.MAX_VALUE;
    this.pockets.forEach(p => {
      const d = Phaser.Math.Distance.Between(x, y, p.pos.x, p.pos.y);
      if (d < bestD) { best = p; bestD = d; }
    });
    return best;
  }

  _applyAutoSleep() {
    const vth = 18;
    const zero = (body) => {
      if (!body || !body.enable) return;
      if (Math.abs(body.velocity.x) < vth) body.velocity.x = 0;
      if (Math.abs(body.velocity.y) < vth) body.velocity.y = 0;
    };

    if (this.striker?.body) zero(this.striker.body);
    for (const sp of this.coins.getChildren()) {
      if (sp?.body) zero(sp.body);
    }
  }

  _anyMoving() {
    const threshold = 10;
    if (this.striker.active && this.striker.body.enable) {
      if (Math.abs(this.striker.body.velocity.x) > threshold || Math.abs(this.striker.body.velocity.y) > threshold)
        return true;
    }
    for (const sp of this.coins.getChildren()) {
      if (!sp.active || !sp.body?.enable) continue;
      if (Math.abs(sp.body.velocity.x) > threshold || Math.abs(sp.body.velocity.y) > threshold)
        return true;
    }
    return false;
  }

  _disableSprite(sp) {
    if (!sp || !sp.body) return;
    sp.setActive(false).setVisible(false);
    sp.body.enable = false;
    this._setVelocity(sp, 0, 0);

    this.safeEnhance(() => {
      if (sp.strikerGlow) {
        sp.strikerGlow.setVisible(false);
      }
    });
  }

  _enableSprite(sp, x, y) {
    if (!sp || !sp.body) return;
    sp.setActive(true).setVisible(true);

    sp.setAlpha(1);
    sp.x = x; sp.y = y;
    sp.body.reset(x, y);
    sp.body.enable = true;

    this.safeEnhance(() => {
      if (sp.strikerGlow) {
        sp.strikerGlow.setVisible(false);
        sp.strikerGlow.x = x;
        sp.strikerGlow.y = y;
        sp.strikerGlow.alpha = 0;
      }
    });
  }

  _setVelocity(sp, vx, vy) {
    if (!sp?.body) return;
    sp.body.setVelocity(vx, vy);
    sp.body.setAngularVelocity(0);
  }

  shutdown() {
    this.events.off('update', this._pocketCheck, this);
    this.events.off('update', this._enhancedUpdate, this);
    if (this.bgm) this.bgm.stop();

    this.enhancementsInitialized = false;
    this.cleanupAllEnhancements();
  }

  destroy() {
    this.shutdown();
  }
}