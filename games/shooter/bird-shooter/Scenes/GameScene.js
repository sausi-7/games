
class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');

    // Gameplay state
    this.player = null;
    this.cursors = null;
    this.keys = null;

    this.projectiles = null;
    this.shards = null;

    this.score = 0;
    this.damage = 0;
    // this.timeLeft = 0;

    this.spawnTimer = null;
    this.spawnRate = 1500;
    this.lastShotAt = 0;
    this.targetScore = 30;

    this.ui = {
      scoreText: null,
      // timerText: null,
      healthBarBg: null,
      healthBar: null,
      targetText: null
    };

    this.mobile = {
      left: null,
      right: null,
      action: null,
      isLeft: false,
      isRight: false,
      isAction: false
    };

    this.snd = {
      bgm: null,
      shoot: null,
      hit: null,
      dmg: null
    };

    // Layout
    this.W = 1080;
    this.H = 1920;
    this.groundY = 0; // computed in create

    // Sprite/anim flags
    this._isAnimatedBird = false;
    // …inside constructor, after this._isAnimatedBird = false;
    this.textStyle = null;
    this.fx = { sparks: null, smoke: null, debris: null };

    // inside constructor, after this.fx = ...
    this.ui.hp = {
      container: null,
      bg: null,
      fill: null,
      gloss: null,
      w: 0,
      h: 0,
      corner: 0,
      pct: 1,
      pulseTween: null
    };

  }

  /* ------------------------- HELPERS: COOL HP BAR ----------------------- */
  createHealthBar() {
    // Sizing
    const w = Math.max(360, this.W - 180);
    const h = 28;
    const corner = 14;

    // Container pinned to screen bottom
    const cx = this.W / 2;
    const cy = this.H - 80;

    const c = this.add.container(cx, cy).setDepth(20).setScrollFactor(0);

    // Background frame (dark with soft outer glow)
    const bg = this.add.graphics();
    bg.fillStyle(0x0d1826, 1);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, corner);
    // “Glow” by drawing thicker translucent strokes
    bg.lineStyle(6, 0x2a3d66, 0.45);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, corner);
    bg.lineStyle(2, 0x5c8dd9, 0.35);
    bg.strokeRoundedRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4, corner - 6);

    // Fill layer (we redraw this every update)
    const fill = this.add.graphics();

    // Gloss highlight (static thin white fade)
    const gloss = this.add.graphics();
    const glossH = Math.max(6, Math.floor(h * 0.35));
    gloss.fillStyle(0xffffff, 0.12);
    gloss.fillRoundedRect(-w / 2 + 6, -h / 2 + 2, w - 12, glossH, Math.max(2, corner - 10));

    c.add([bg, fill, gloss]);

    // Ticks every 10%
    const tickG = this.add.graphics();
    tickG.lineStyle(2, 0x28436e, 0.55);
    for (let i = 1; i < 10; i++) {
      const tx = -w / 2 + (w * i / 10);
      tickG.lineBetween(tx, -h / 2 + 3, tx, h / 2 - 3);
    }
    c.add(tickG);

    // Store
    this.ui.hp.container = c;
    this.ui.hp.bg = bg;
    this.ui.hp.fill = fill;
    this.ui.hp.gloss = gloss;
    this.ui.hp.w = w;
    this.ui.hp.h = h;
    this.ui.hp.corner = corner;
    this.ui.hp.pct = 1;

    // First draw
    this.drawHealthBar(1);
  }

  drawHealthBar(pct) {
    const { fill, w, h, corner } = this.ui.hp;
    if (!fill) return;

    // Clamp + clear
    pct = Phaser.Math.Clamp(pct, 0, 1);
    fill.clear();

    // Width of the current health
    const innerPad = 4;
    const barW = Math.max(0, (w - innerPad * 2) * pct);
    const x = -w / 2 + innerPad;
    const y = -h / 2 + innerPad;
    const rh = h - innerPad * 2;
    const rc = Math.max(2, corner - 6);

    if (barW <= 0) return;

    // Gradient fill (green -> yellow -> red)
    // We fake gradient by blending three bands for a soft neon feel
    const g1 = 0x41f37c; // green
    const g2 = 0xffe36a; // yellow
    const g3 = 0xff5a5a; // red

    const colA = Phaser.Display.Color.Interpolate.ColorWithColor(
      Phaser.Display.Color.ValueToColor(g1),
      Phaser.Display.Color.ValueToColor(g2),
      100, Math.floor((1 - Math.min(pct, 1)) * 60)
    );
    const colB = Phaser.Display.Color.Interpolate.ColorWithColor(
      Phaser.Display.Color.ValueToColor(g2),
      Phaser.Display.Color.ValueToColor(g3),
      100, Math.max(0, Math.floor((1 - pct) * 120) - 60)
    );
    const cTop = Phaser.Display.Color.GetColor(colA.r, colA.g, colA.b);
    const cBot = Phaser.Display.Color.GetColor(colB.r, colB.g, colB.b);

    // Top blend
    fill.fillStyle(cTop, 1);
    fill.fillRoundedRect(x, y, barW, rh * 0.55, rc);

    // Bottom blend
    fill.fillStyle(cBot, 1);
    fill.fillRoundedRect(x, y + rh * 0.45, barW, rh * 0.55, rc);

    // Inner border for crispness
    fill.lineStyle(2, 0xffffff, 0.08);
    fill.strokeRoundedRect(x + 1, y + 1, barW - 2, rh - 2, rc - 2);

    // Edge spark when losing health (tiny white cap)
    if (this._hpEdgeSparkX != null) {
      const sx = this._hpEdgeSparkX;
      fill.fillStyle(0xffffff, 0.6);
      fill.fillRect(sx - 2, y + 2, 4, rh - 4);
      this._hpEdgeSparkX = null;
    }
  }

  setHealthPct(targetPct, animate = true) {
    const cur = this.ui.hp.pct ?? 1;
    targetPct = Phaser.Math.Clamp(targetPct, 0, 1);
    this.ui.hp.pct = targetPct;

    // Pulse when low
    const low = targetPct <= 0.3;
    if (low && !this.ui.hp.pulseTween) {
      this.ui.hp.pulseTween = this.tweens.add({
        targets: this.ui.hp.container,
        scaleX: 1.03, scaleY: 1.03,
        yoyo: true, repeat: -1,
        duration: 420, ease: 'Sine.easeInOut'
      });
    } else if (!low && this.ui.hp.pulseTween) {
      this.ui.hp.pulseTween.stop(); this.ui.hp.pulseTween = null;
      this.ui.hp.container.setScale(1, 1);
    }

    // Edge spark position (at new bar edge)
    const { w } = this.ui.hp;
    const innerPad = 4;
    this._hpEdgeSparkX = -w / 2 + innerPad + (w - innerPad * 2) * targetPct;

    if (!animate) {
      this.drawHealthBar(targetPct);
      return;
    }

    // Smooth tween from current visual to target
    const tmp = { t: cur };
    this.tweens.add({
      targets: tmp,
      t: targetPct,
      duration: 280,
      ease: 'Cubic.easeOut',
      onUpdate: () => this.drawHealthBar(tmp.t)
    });
  }


  /* ------------------------ HELPERS: UI STYLES ------------------------- */
  makeGameTextStyle(fontFamily) {
    return {
      fontFamily,
      fontSize: '50px',
      color: '#070b0fff',


    };
  }

  pulseText(textObj) {
    if (!textObj) return;
    this.tweens.add({
      targets: textObj,
      scaleX: 1.06, scaleY: 1.06,
      duration: 100,
      yoyo: true,
      ease: 'Quad.easeOut'
    });
  }

  /* -------------------------- HELPERS: FX SETUP ------------------------ */
  setupFX() {
    const dot = this.ensureTexture('fx_dot', 6, 6, 0xffffff, 0x88aaff);
    const smoke = this.ensureTexture('fx_smoke', 12, 12, 0xaab6c8, 0x6b7d96);

    // In newer Phaser, this.add.particles(x, y, textureKey, config) -> ParticleEmitter
    this.fx.sparks = this.add.particles(0, 0, dot, {
      quantity: 0,                // we’ll trigger bursts manually
      on: false,                  // don't auto-emit
      lifespan: { min: 200, max: 450 },
      speed: { min: 120, max: 320 },
      angle: { min: 0, max: 360 },
      scale: { start: 1, end: 0 },
      alpha: { start: 1, end: 0 },
      blendMode: 'ADD',
      gravityY: 300
    });

    this.fx.smoke = this.add.particles(0, 0, smoke, {
      quantity: 0,
      on: false,
      lifespan: { min: 350, max: 700 },
      speed: { min: 40, max: 120 },
      angle: { min: -90, max: 270 },
      scale: { start: 1.0, end: 0.2 },
      alpha: { start: 0.8, end: 0 },
      gravityY: -80
    });
  }


  /* --------------------------- HELPERS: FX USE ------------------------- */
  burstSparks(x, y, count = 14) {
    this.fx.sparks?.explode(count, x, y);
  }

  puffSmoke(x, y, count = 8) {
    this.fx.smoke?.explode(count, x, y);
  }


  floatingText(x, y, msg = '+10') {
    const t = this.add.text(x, y, msg, {
      fontFamily: (this.registry.get('cfg')?.font?.family) || 'system-ui',
      fontSize: '32px',
      color: '#ffffff',
      stroke: '#172b4d',
      strokeThickness: 6,
      shadow: { color: '#6bf1ff', blur: 10, fill: true, stroke: true }
    }).setDepth(50).setOrigin(0.5);
    this.tweens.add({
      targets: t,
      y: y - 60, alpha: 0,
      duration: 700,
      ease: 'Cubic.easeOut',
      onComplete: () => t.destroy()
    });
  }

  ringWave(x, y, color = 0x79c6ff) {
    // quick expanding ring
    const g = this.add.graphics({ x: 0, y: 0 }).setDepth(9);
    let radius = 6;
    const steps = 16;
    const step = () => {
      g.clear();
      g.lineStyle(3, color, 1);
      g.strokeCircle(x, y, radius);
      radius += 8;
      if (radius > 8 * steps) {
        g.destroy();
      } else {
        this.time.delayedCall(16, step);
      }
    };
    step();
  }


  /* ----------------------------- PRELOAD ----------------------------- */

  preload() {
    const cfg = this.registry.get('cfg') || {};
    const { images1 = {}, images2 = {}, spritesheets = {}, audio = {}, font = {} } = cfg;

    const safeLoadImage = (key, url) => {
      if (!key || !url) return;
      if (!this.textures.exists(key)) this.load.image(key, url);
    };
    const safeLoadSheet = (key, obj) => {
      if (!key || !obj || !obj.url) return;
      if (!this.textures.exists(key)) {
        this.load.spritesheet(key, obj.url, {
          frameWidth: obj.frameWidth || 64,
          frameHeight: obj.frameHeight || 64,
          endFrame: (obj.frames || 0) - 1
        });
      }
    };
    const safeLoadAudio = (key, url) => {
      if (!key || !url) return;
      if (!this.cache.audio.exists(key)) this.load.audio(key, url);
    };

    // Images
    Object.entries(images1).forEach(([key, url]) => safeLoadImage(key, url));
    Object.entries(images2).forEach(([key, url]) => safeLoadImage(key, url));
    // Spritesheets
    Object.entries(spritesheets).forEach(([key, sheet]) => safeLoadSheet(key, sheet));
    // Audio
    Object.entries(audio).forEach(([key, url]) => safeLoadAudio(key, url));

    // Load font (non-blocking)
    if (font && font.family && font.url && 'FontFace' in window) {
      const ff = new FontFace(font.family, `url(${font.url})`);
      ff.load().then(loaded => document.fonts.add(loaded)).catch(() => { });
    }
  }

  /* ------------------------------ CREATE ----------------------------- */

  create() {
    // Pull cfg and core sizes
    const cfg = this.registry.get('cfg') || {};
    const gp = cfg.gameplay || {};
    const texts = cfg.texts || {};
    const cam = this.sys.cameras.main;
    const gameCfg = this.sys.game.config;

    // Orientation is portrait; read actual
    this.W = gameCfg.width || 1080;
    this.H = gameCfg.height || 1920;

    // Ground line above mobile controls; keep 200px clear
    this.groundY = this.H - 240;

    // Init state
    this.score = 0;
    this.damage = 0;
    // this.timeLeft = Math.max(0, gp.timerSeconds ?? 60);
    this.spawnRate = gp.spawnRateStart ?? 1500;
    this.lastShotAt = 0;
    this.targetScore = gp.targetScore ?? 30;

    if (cfg.orientation?.frame === 'landscape' && screen.orientation && screen.orientation.lock) {
      screen.orientation
        .lock('landscape-primary')
        .catch(err => console.warn('Orientation lock failed:', err));
    }

    // Physics world bounds (floor at groundY, ceiling at 0)
    this.physics.world.setBounds(0, 0, this.W, this.H);

    // Background
    const bgKey = this.ensureTexture('background', this.W, this.H, 0x13223a);
    this.add.image(this.W / 2, this.H / 2, bgKey).setDisplaySize(this.W, this.H).setDepth(-10);

    // Groups
    this.projectiles = this.physics.add.group({
      classType: Phaser.Physics.Arcade.Image,
      maxSize: 100,
      runChildUpdate: false
    });
    this.shards = this.physics.add.group({
      classType: Phaser.Physics.Arcade.Image,
      maxSize: gp.maxShards ?? 6,
      runChildUpdate: false
    });

    // Player
    // Player (static image)
    const playerKey = this.textures.exists('player')
      ? 'player'
      : this.ensureTexture('player', 64, 64, 0x4fe3ff, 0x0c1f2a);

    this.player = this.physics.add.sprite(this.W / 2, this.groundY - 80, playerKey)
      .setCollideWorldBounds(true)
      .setDepth(5)
      .setScale(0.4, 0.3);;

    // No animations for static image
    this._isAnimatedBird = false;
    this.player.flipX = false; // default facing right
    // default facing right

    // Player physics & constraints
    this.player.body.setAllowGravity(false);
    this.playerMinY = Math.max(0, this.groundY - 0.5 * this.H); // lock to bottom half region
    this.playerMaxY = this.groundY;

    // Controls
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys({
      A: Phaser.Input.Keyboard.KeyCodes.A,
      D: Phaser.Input.Keyboard.KeyCodes.D,
      SPACE: Phaser.Input.Keyboard.KeyCodes.SPACE
    });

    // Mobile controls
    this.createMobileControls(cfg);

    // Collisions
    this.physics.add.overlap(this.projectiles, this.shards, this.handleProjectileHitShard, null, this);

    // UI
    const fontFamily = (cfg.font && cfg.font.family) || 'system-ui, -apple-system, Segoe UI, Roboto, Arial';
    this.textStyle = this.makeGameTextStyle(fontFamily);

    this.add.image(200, 70, 'scoreback')

    // this.add.image(1000, 70, 'scoreback')

    this.add.image(1700, 70, 'scoreback')

    // Score (left)
    const label = texts.score_label ?? 'Score: ';
    this.ui.scoreText = this.add.text(80, 40, `${label}0`, this.textStyle)
      .setDepth(20);

    // Target (fixed position — centered at top)
    this.ui.targetText = this.add.text(
      this.W / 2 + 750, 40, `Target: ${this.targetScore}`, this.textStyle
    ).setOrigin(0.5, 0).setDepth(20);


    // Timer (right-aligned, same style)
    // this.ui.timerText = this.add.text(this.W - 150, 40, `Time: ${this.timeLeft}`, this.textStyle)
    //   .setOrigin(1, 0).setDepth(20);

    // Gentle idle glow pulse
    // this.tweens.add({
    //   targets: [this.ui.scoreText, this.ui.timerText, this.ui.targetText], // ← include target
    //   scaleX: 1.02, scaleY: 1.02,
    //   duration: 1800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
    // });
    // Health bar
    // Health bar (cool version)
    this.createHealthBar();

    this.updateHealthBar(cfg);

    // Audio
    this.prepareAudio(cfg);
    if (this.snd.bgm && !this.snd.bgm.isPlaying) {
      this.snd.bgm.play();
    }



    // FX managers (NEW)
    this.setupFX();

    // Timers
    this.startSpawnLoop(cfg);
    // if (this.timeLeft > 0) {
    //   this.time.addEvent({
    //     delay: 1000,
    //     loop: true,
    //     callback: () => {
    //       if (this.timeLeft <= 0) return;
    //       this.timeLeft--;
    //       this.ui.timerText.setText(`Time: ${this.timeLeft}`);
    //       if (this.timeLeft <= 0) this.triggerWinIfEligible(cfg);
    //     }
    //   });
    // }

    // Camera
    cam.setBackgroundColor('#0b0f1a');
  }

  /* ------------------------------ UPDATE ----------------------------- */

  update(time, delta) {
    if (!this.player) return;

    const cfg = this.registry.get('cfg') || {};
    const gp = cfg.gameplay || {};
    const speed = gp.playerSpeed ?? 350;
    const boltCooldown = gp.boltCooldown ?? 150; // ms

    // Inputs
    const leftDown = this.cursors.left.isDown || this.keys.A.isDown || this.mobile.isLeft;
    const rightDown = this.cursors.right.isDown || this.keys.D.isDown || this.mobile.isRight;

    // Movement + facing
    let vx = 0;
    if (leftDown) { vx = -speed; this.player.flipX = true; }
    else if (rightDown) { vx = speed; this.player.flipX = false; }
    this.player.setVelocityX(vx);


    // Clamp player to bottom band
    if (this.player.y < this.playerMinY) this.player.y = this.playerMinY;
    if (this.player.y > this.playerMaxY) this.player.y = this.playerMaxY;

    // Shooting
    const wantsShoot = this.cursors.space.isDown || this.keys.SPACE.isDown || this.mobile.isAction;
    if (wantsShoot && time - this.lastShotAt > boltCooldown) {
      this.fireBolt(cfg);
      this.lastShotAt = time;
    }

    // Shard => ground/village damage check
    const shardSpeedMax = gp.shardSpeedMax ?? 220;
    this.shards.children.iterate(child => {
      const s = /** @type {Phaser.Physics.Arcade.Image} */ (child);
      if (!s || !s.body) return;
      if (s.y >= this.groundY - 10) {
        // Village takes damage
        this.onVillageHit(cfg, s);
      } else if (s.body.velocity.y < (gp.shardSpeedMin ?? 120) || s.body.velocity.y > shardSpeedMax + 40) {
        // Ensure sane speed
        s.setVelocityY(Phaser.Math.Clamp(s.body.velocity.y, gp.shardSpeedMin ?? 120, shardSpeedMax));
      }
    });

    // Cleanup projectiles offscreen
    this.projectiles.children.iterate(child => {
      const p = /** @type {Phaser.Physics.Arcade.Image} */ (child);
      if (!p || !p.active) return;
      if (p.y < -32) p.destroy();
    });
  }

  /* --------------------------- HELPERS: ASSETS ------------------------ */

  ensureTexture(key, w = 64, h = 64, fill = 0x888888, border = 0x222222) {
    if (this.textures.exists(key)) return key;

    // Never smaller than 4x4
    const safeW = Math.max(4, Math.floor(w));
    const safeH = Math.max(4, Math.floor(h));

    const gfx = this.make.graphics({ x: 0, y: 0, add: false });

    // Corner radius and stroke width scale with size; never negative
    const minSide = Math.min(safeW, safeH);
    const corner = Math.max(0, Math.floor(minSide / 4));
    const strokeW = Math.max(1, Math.floor(minSide / 16));
    const inset = Math.max(1, Math.floor(strokeW / 2));

    gfx.fillStyle(fill, 1);
    if (corner > 0) gfx.fillRoundedRect(0, 0, safeW, safeH, corner);
    else gfx.fillRect(0, 0, safeW, safeH);

    gfx.lineStyle(strokeW, border, 1);
    if (corner > 0) gfx.strokeRoundedRect(inset, inset, safeW - inset * 2, safeH - inset * 2, Math.max(0, corner - inset));
    else gfx.strokeRect(inset, inset, safeW - inset * 2, safeH - inset * 2);

    gfx.generateTexture(key, safeW, safeH);
    gfx.destroy();
    return key;
  }

  /* ------------------------- HELPERS: CONTROLS ------------------------ */

  createMobileControls(cfg) {
    const leftKey = this.textures.exists('left') ? 'left' : this.ensureTexture('left', 120, 120, 0x26406b, 0x1a2944);
    const rightKey = this.textures.exists('right') ? 'right' : this.ensureTexture('right', 120, 120, 0x26406b, 0x1a2944);
    const actKey = this.textures.exists('action') ? 'action' : this.ensureTexture('action', 130, 130, 0x4b2866, 0x2b153d);

    const padY = this.H - 100;

    // Standard positions (portrait)
    this.mobile.left = this.add.image(160, padY - 30, leftKey).setScrollFactor(0).setDepth(30).setInteractive({ useHandCursor: true }).setAlpha(0.9);
    this.mobile.right = this.add.image(490, padY - 30, rightKey).setScrollFactor(0).setDepth(30).setInteractive({ useHandCursor: true }).setAlpha(0.9);
    this.mobile.action = this.add.image(this.W - 160, padY - 30, actKey).setScrollFactor(0).setDepth(30).setInteractive({ useHandCursor: true }).setAlpha(0.95);

    const pressFx = (img, down) => { img.setScale(down ? 0.92 : 1).setAlpha(down ? 0.75 : 0.95); };

    // Left
    this.mobile.left.on('pointerdown', () => { this.mobile.isLeft = true; pressFx(this.mobile.left, true); });
    this.mobile.left.on('pointerup', () => { this.mobile.isLeft = false; pressFx(this.mobile.left, false); });
    this.mobile.left.on('pointerout', () => { this.mobile.isLeft = false; pressFx(this.mobile.left, false); });

    // Right
    this.mobile.right.on('pointerdown', () => { this.mobile.isRight = true; pressFx(this.mobile.right, true); });
    this.mobile.right.on('pointerup', () => { this.mobile.isRight = false; pressFx(this.mobile.right, false); });
    this.mobile.right.on('pointerout', () => { this.mobile.isRight = false; pressFx(this.mobile.right, false); });

    // Action
    this.mobile.action.on('pointerdown', () => { this.mobile.isAction = true; pressFx(this.mobile.action, true); });
    this.mobile.action.on('pointerup', () => { this.mobile.isAction = false; pressFx(this.mobile.action, false); });
    this.mobile.action.on('pointerout', () => { this.mobile.isAction = false; pressFx(this.mobile.action, false); });

    [this.mobile.left, this.mobile.right, this.mobile.action].forEach(b => b.setScrollFactor(0).setDepth(100));
  }

  /* -------------------------- HELPERS: AUDIO -------------------------- */

  prepareAudio(cfg) {
    const has = key => this.cache.audio.exists(key);

    if (has('bgm')) {
      this.snd.bgm = this.sound.add('bgm', { loop: true, volume: 0.35 });
      this.snd.bgm.play();
    }
    if (has('shoot')) this.snd.shoot = this.sound.add('shoot', { volume: 0.6 });
    if (has('break')) this.snd.hit = this.sound.add('break', { volume: 0.6 });
    if (has('damage')) this.snd.dmg = this.sound.add('damage', { volume: 0.8 });
  }

  /* ------------------------ HELPERS: GAME SYSTEMS --------------------- */

  startSpawnLoop(cfg) {
    const gp = cfg.gameplay || {};
    const minRate = gp.spawnRateMin ?? 600;

    if (this.spawnTimer) this.spawnTimer.remove(false);
    this.spawnTimer = this.time.addEvent({
      delay: this.spawnRate,
      loop: true,
      callback: () => {
        // Spawn only if capacity allows
        if (this.shards.countActive(true) < (gp.maxShards ?? 6)) {
          this.spawnShard(cfg);
        }
        // Gradually increase difficulty (shorter delay)
        this.spawnRate = Math.max(minRate, this.spawnRate - 10);
        this.spawnTimer.delay = this.spawnRate;
      }
    });
  }

  spawnShard(cfg) {
    const gp = cfg.gameplay || {};
    const x = Phaser.Math.Between(48, this.W - 48);
    const y = -32;

    const shardKey = this.textures.exists('enemy') ? 'enemy' : this.ensureTexture('enemy', 48, 56, 0x7bd6ff, 0x164b63);
    const shard = /** @type {Phaser.Physics.Arcade.Image} */ (this.shards.get(x, y, shardKey));
    if (!shard) return;

    // --- NEW: random scale (with robust hitbox) ---
    const scale = Phaser.Math.FloatBetween(0.25, 0.3);
    shard.setScale(scale);

    shard.setActive(true).setVisible(true).setDepth(2);
    shard.body.setAllowGravity(false);

    // Safe collision circle matched to scaled display
    const baseW = shard.width || 48;
    const baseH = shard.height || 56;
    const dispW = baseW * scale;
    const dispH = baseH * scale;
    const r = Math.max(2, Math.floor(Math.min(dispW, dispH) * 0.35));
    const ox = Math.max(0, Math.floor((baseW * scale - r * 2) / 2));
    const oy = Math.max(0, Math.floor((baseH * scale - r * 2) / 2));
    // setCircle expects texture-space values; provide scaled values to approximate display
    // shard.setCircle(r, ox, oy);

    const vy = Phaser.Math.Between(gp.shardSpeedMin ?? 120, gp.shardSpeedMax ?? 220);
    shard.setVelocity(Phaser.Math.Between(-10, 10), vy);

    // Gentle sway
    this.tweens.add({
      targets: shard,
      x: shard.x + Phaser.Math.Between(-40, 40),
      duration: Phaser.Math.Between(900, 1400),
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });
  }

  fireBolt(cfg) {
    const gp = cfg.gameplay || {};
    const boltKey = this.textures.exists('bolt') ? 'bolt' : this.ensureTexture('bolt', 12, 36, 0xfff48f, 0x7f6e2c);

    const p = this.projectiles.get(this.player.x, this.player.y - 40, boltKey);
    if (!p) return;

    p.setActive(true).setVisible(true).setDepth(3);
    p.body.setAllowGravity(false);
    p.setVelocity(0, -(gp.boltSpeed ?? 500));

    // Small stretch to feel speedy
    p.setScale(1, 1.2);

    // Safe circular hitbox for bolt
    const bw = p.width || 12;
    const bh = p.height || 36;
    const br = Math.max(2, Math.floor(Math.min(bw, bh) * 0.4));
    const boxOX = Math.max(0, Math.floor((bw - br * 2) / 2));
    const boxOY = Math.max(0, Math.floor((bh - br * 2) / 2));
    p.setCircle(br, boxOX, boxOY);

    if (this.snd.shoot) this.snd.shoot.play();
  }

  handleProjectileHitShard(bolt, shard) {
    if (bolt?.active) bolt.destroy();

    // Animation (your existing)
    if (this.textures.exists('shard_break') && !this.anims.exists('shard_explode')) {
      this.anims.create({
        key: 'shard_explode',
        frames: this.anims.generateFrameNumbers('shard_break', { start: 0, end: 4 }),
        frameRate: 20,
        repeat: 0
      });
    }

    if (this.anims.exists('shard_explode')) {
      const boom = this.add.sprite(shard.x, shard.y, 'shard_break').setDepth(10);
      boom.play('shard_explode');
      boom.on('animationcomplete', () => boom.destroy());
    }

    // NEW: FX
    this.burstSparks(shard.x, shard.y, Phaser.Math.Between(12, 18));
    this.puffSmoke(shard.x, shard.y, Phaser.Math.Between(6, 10));
    this.ringWave(shard.x, shard.y);

    // Cleanup
    if (shard?.active) shard.destroy();

    // Score + UI feedback
    this.score += 10;
    this.updateScoreText();
    this.floatingText(shard.x, shard.y - 10, '+10');
    this.pulseText(this.ui.scoreText);

    if (this.snd.hit) this.snd.hit.play();

    // ← NEW: check target to trigger Win
    if (this.score >= this.targetScore) {
      if (this.snd.bgm) {
        this.tweens.add({
          targets: this.snd.bgm,
          volume: 0,
          duration: 300,
          onComplete: () => {
            this.snd.bgm.stop();
            this.snd.bgm.setVolume(0.35); // reset for next time
            this.scene.start('WinScene', { score: this.score, damage: this.damage });
          }
        });
      } else {
        this.scene.start('WinScene', { score: this.score, damage: this.damage });
      }
      return;
    }
  }


  onVillageHit(cfg, shard) {
    if (shard?.active) shard.destroy();

    this.damage += 1;
    this.updateHealthBar(cfg);

    const cam = this.sys.cameras.main;

    // NEW: camera feedback
    cam.shake(140, 0.004);
    cam.flash(120, 255, 80, 80);

    // NEW: ground ember burst
    const y = this.groundY - 10;
    const x = Phaser.Math.Clamp((shard?.x ?? this.W / 2), 24, this.W - 24);
    this.burstSparks(x, y, Phaser.Math.Between(10, 14));
    this.puffSmoke(x, y, Phaser.Math.Between(6, 10));

    if (this.snd.dmg) this.snd.dmg.play();

    const maxHits = (cfg.gameplay && cfg.gameplay.villageHealth) ?? 5;
    if (this.damage >= maxHits) {
      this.gameOver(cfg);
    }
  }

  updateScoreText() {
    const cfg = this.registry.get('cfg') || {};
    const label = (cfg.texts && cfg.texts.score_label) || 'Score: ';
    if (this.ui.scoreText) {
      this.ui.scoreText.setText(`${label}${this.score}`);
      this.pulseText(this.ui.scoreText);
    }
  }



  updateHealthBar(cfg) {
    const maxHits = (cfg.gameplay && cfg.gameplay.villageHealth) ?? 5;
    const remain = Math.max(0, maxHits - this.damage);
    const pct = remain / maxHits;
    this.setHealthPct(pct, true);
  }


  // triggerWinIfEligible(cfg) {
  //   // If timer ran out and village survived -> Win
  //   if (this.timeLeft <= 0 && this.damage < ((cfg.gameplay && cfg.gameplay.villageHealth) ?? 5)) {
  //     if (this.snd.bgm) this.snd.bgm.stop();
  //     this.scene.start('WinScene', { score: this.score, damage: this.damage });
  //   }
  // }

  gameOver(cfg) {
    if (this.snd.bgm) {
      this.tweens.add({
        targets: this.snd.bgm,
        volume: 0,
        duration: 300,
        onComplete: () => {
          this.snd.bgm.stop();
          this.snd.bgm.setVolume(0.35); // reset for next time
          this.scene.start('GameOverScene', { score: this.score, damage: this.damage });
        }
      });
    } else {
      this.scene.start('GameOverScene', { score: this.score, damage: this.damage });
    }
  }

  /* ------------------------------ SHUTDOWN ---------------------------- */

  shutdownCleanup() {
    if (this.spawnTimer) { this.spawnTimer.remove(false); this.spawnTimer = null; }
    if (this.snd.bgm) { this.snd.bgm.stop(); this.snd.bgm.destroy(); this.snd.bgm = null; }
    ['shoot', 'hit', 'dmg'].forEach(k => { if (this.snd[k]) { this.snd[k].destroy(); this.snd[k] = null; } });
  }

  /* ------------------------------- EVENTS ----------------------------- */

  init() {
    // Bind cleanup
    this.events.on('shutdown', this.shutdownCleanup, this);
    this.events.on('destroy', this.shutdownCleanup, this);
  }
}

// export default GameScene;
