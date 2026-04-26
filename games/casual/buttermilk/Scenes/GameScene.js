class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');

    // Core state
    this.cfg = null;
    this.orderIndex = 0;
    this.currentOrder = null;

    // Glass / mixing
    this.glass = null;
    this.glassCapacity = 100; // logical units, overridden by cfg
    this.mix = {};            // ingredientKey -> units poured
    this.totalPoured = 0;
    this.activeIngredient = null;
    this.isPouring = false;

    // Input helpers
    this.pointerDownAt = null;     // {x,y,time}
    this.swipeThreshold = 140;     // px downward to serve
    this.swipeFromGlass = false;

    // UI
    this.score = 0;
    this.combo = 0;
    this.consecutiveBad = 0;
    this.timerMs = 0;
    this.hasEnded = false;
    this.scoreText = null;
    this.timerText = null;
    this.orderText = null;
    this.fillText = null;

    // SFX
    this.sfx = {};
    this.bgm = null;

    // Pre-bound handlers
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);

    // Groups / sprites
    this.ingredients = new Map(); // key -> sprite
    this.platforms = null;

    this.didAutoServe = false; // prevents double-trigger when full

    // Visual pour FX
    this.ingColors = null;      // ingredient key -> tint
    this.particles = null;      // ParticleEmitterManager
    this.pourEmitter = null;    // active emitter
    this.liquidGfx = null;      // Graphics fill inside glass
    this.liquidMask = null;     // Mask for liquid gfx
    this.liquidColor = 0x57c7ff; // default water-like color

    // UI
    this.score = 0;
    // ...
    this.fillText = null;

    // NEW: pour label
    this.pourLabel = null;

    // HUD bits
    this.scorePill = null;
    this.timerPill = null;
    this.scoreValueText = null;
    this.timerValueText = null;
    this._scoreLast = 0;
    this._timerDangerArmed = false;

  }

  init() {
    // Hard reset for replay
    this.hasEnded = false;
    this.score = 0;
    this._scoreLast = 0;
    this._timerDangerArmed = false;

    this.combo = 0;
    this.consecutiveBad = 0;

    this.orderIndex = 0;          // start recipes from the beginning
    this.currentOrder = null;

    this.mix = {};
    this.totalPoured = 0;
    this.activeIngredient = null;
    this.isPouring = false;
    this.didAutoServe = false;
    this.hasIce = false;

    this.pointerDownAt = null;

    // Kill any lingering tweens/sounds from prior run (constructor not re-invoked)
    if (this.tweens) this.tweens.killAll();
    if (this.sound) this.sound.stopAll(); // stops sfx that may have been mid-play
  }


  preload() {
    // Expect config injected by Boot via registry
    this.cfg = this.registry.get('cfg') || {};

    // ---- Load IMAGES (only from provided library paths) ----
    const images = this.cfg.images1 || {};
    const images2 = this.cfg.images2 || {};
    const ui = this.cfg.ui_images || {};
    Object.keys(images).forEach((key) => {
      this.load.image(key, images[key]);
    });
    Object.keys(images2).forEach((key) => {
      this.load.image(key, images2[key]);
    });
    Object.keys(ui).forEach((key) => {
      this.load.image(key, ui[key]);
    });

    // ---- Load AUDIO ----
    const audio = this.cfg.audio || {};
    Object.keys(audio).forEach((key) => {
      this.load.audio(key, audio[key]);
    });

  }

  _createGlassFallbackTexture(key = 'glass_fallback', w = 180, h = 300) {
    // draw a rounded “glass” silhouette with transparent center
    const g = this.add.graphics();
    g.clear();

    const radius = 18;
    const outerColor = 0xffffff;     // white outline
    const outerAlpha = 0.9;
    const rimColor = 0xffffff;
    const rimAlpha = 0.20;

    // Outer outline
    g.lineStyle(6, outerColor, outerAlpha);
    g.strokeRoundedRect(0, 0, w, h, radius);

    // Top rim glow
    g.fillStyle(rimColor, rimAlpha);
    g.fillRoundedRect(6, 10, w - 12, 14, 8);

    // Slight inner side glow
    g.fillStyle(0xffffff, 0.10);
    g.fillRoundedRect(10, 24, 10, h - 40, 8);

    // Generate texture and cleanup
    g.generateTexture(key, w, h);
    g.destroy();
  }

  // Make a reusable rounded-pill texture
  _makePillTexture(key, w, h, fillHex = 0x1e293b, strokeHex = 0xffffff, strokeAlpha = 0.15) {
    const g = this.add.graphics();
    g.clear();

    // subtle "two-tone" fill
    g.fillStyle(fillHex, 1);
    g.fillRoundedRect(0, 0, w, h, h / 2);
    g.fillStyle(0xffffff, 0.05);
    g.fillRoundedRect(0, 0, w, h * 0.55, h / 2);

    // stroke + shadow band
    g.lineStyle(3, strokeHex, strokeAlpha);
    g.strokeRoundedRect(1.5, 1.5, w - 3, h - 3, h / 2 - 2);

    g.generateTexture(key, w, h);
    g.destroy();
  }

  // Small icon textures (star and clock) drawn with Graphics
  _makeIconTextures() {
    // star
    const s = this.add.graphics();
    s.fillStyle(0xffd166, 1);
    const cx = 18, cy = 18, r1 = 16, r2 = 7, spikes = 5;
    let rot = Math.PI / 2 * 3, x = cx, y = cy;
    s.beginPath();
    s.moveTo(cx, cy - r1);
    for (let i = 0; i < spikes; i++) {
      x = cx + Math.cos(rot) * r1; y = cy + Math.sin(rot) * r1; s.lineTo(x, y); rot += Math.PI / spikes;
      x = cx + Math.cos(rot) * r2; y = cy + Math.sin(rot) * r2; s.lineTo(x, y); rot += Math.PI / spikes;
    }
    s.lineTo(cx, cy - r1);
    s.closePath(); s.fillPath();
    s.generateTexture('icon_star', 36, 36); s.destroy();

    // clock
    const c = this.add.graphics();
    c.fillStyle(0x93c5fd, 1);
    c.fillCircle(18, 18, 16);
    c.fillStyle(0x0f172a, 1);
    c.fillCircle(18, 18, 2.5);
    // hands
    c.lineStyle(3, 0x0f172a, 1);
    c.beginPath(); c.moveTo(18, 18); c.lineTo(18, 8); c.strokePath();
    c.beginPath(); c.moveTo(18, 18); c.lineTo(26, 18); c.strokePath();
    c.generateTexture('icon_clock', 36, 36); c.destroy();
  }

  // build fancy HUD and store refs
  _buildHUD(gw, gh) {
    // Make textures once
    if (!this.textures.exists('pill_dark')) this._makePillTexture('pill_dark', 320, 64, 0x0f172a);
    if (!this.textures.exists('pill_warn')) this._makePillTexture('pill_warn', 320, 64, 0x7f1d1d);
    if (!this.textures.exists('pill_ok')) this._makePillTexture('pill_ok', 320, 64, 0x083344);
    this._makeIconTextures();

    const fontFamily = (this.cfg.font && this.cfg.font.family) || 'Outfit, Arial, sans-serif';

    // SCORE PILL (top-left)
    this.scorePill = this.add.image(40, 40, 'pill_ok').setOrigin(0, 0).setDepth(20);
    this.scorePill.setScale(1); // base scale for bump

    const star = this.add.image(this.scorePill.x + 28, this.scorePill.y + 32, 'icon_star')
      .setOrigin(0.5).setDepth(21);

    const scoreLabel = this.add.text(this.scorePill.x + 52, this.scorePill.y + 14, 'SCORE:', {
      fontFamily, fontSize: '38px', color: '#9ee6ff', letterSpacing: 2
    }).setDepth(21);

    this.scoreValueText = this.add.text(this.scorePill.x + 200, this.scorePill.y + 14, '0', {
      fontFamily, fontSize: '38px', color: '#e2f3ff', fontStyle: 'bold'
    }).setDepth(21);

    // subtle shadow
    [scoreLabel, this.scoreValueText].forEach(t => t.setShadow(0, 2, '#000', 4, true, true));

    // TIMER PILL (top-right)
    this.timerPill = this.add.image(gw - 40, 40, 'pill_dark').setOrigin(1, 0).setDepth(20);

    const clock = this.add.image(this.timerPill.x - 28, this.timerPill.y + 32, 'icon_clock')
      .setOrigin(0.5).setDepth(21);

    const timeLabel = this.add.text(this.timerPill.x - 180, this.timerPill.y + 14, 'TIME:', {
      fontFamily, fontSize: '38px', color: '#cbd5e1', letterSpacing: 2
    }).setOrigin(1, 0).setDepth(21);

    this.timerValueText = this.add.text(this.timerPill.x - 80, this.timerPill.y + 14, this._fmtTime(this.timerMs), {
      fontFamily, fontSize: '38px', color: '#ffffff', fontStyle: 'bold'
    }).setOrigin(1, 0).setDepth(21);

    [timeLabel, this.timerValueText].forEach(t => t.setShadow(0, 2, '#000', 4, true, true));
  }

  // nice pop when score increases
  _bumpScorePill() {
    if (!this.scorePill) return;
    this.tweens.killTweensOf(this.scorePill);
    this.tweens.add({
      targets: this.scorePill,
      scale: 1.06,
      duration: 120,
      yoyo: true,
      ease: 'Back.Out'
    });
  }

  // turn timer pill red + pulse when low
  _setTimerDanger(enabled) {
    if (!this.timerPill) return;
    this.timerPill.setTexture(enabled ? 'pill_warn' : 'pill_dark');

    this.tweens.killTweensOf(this.timerPill);
    if (enabled) {
      this.tweens.add({
        targets: this.timerPill,
        alpha: { from: 1, to: 0.65 },
        duration: 220,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.inOut'
      });
    } else {
      this.timerPill.setAlpha(1);
    }
  }


  create() {
    // Pull from cfg
    this.glassCapacity = (this.cfg.gameplay && this.cfg.gameplay.glassCapacity) || 100;
    this.timerMs = ((this.cfg.gameplay && this.cfg.gameplay.timerSeconds) || 60) * 1000;
    this.tolerancePerfect = (this.cfg.gameplay && this.cfg.gameplay.tolerancePerfect) || 0.10;
    this.toleranceSoft = (this.cfg.gameplay && this.cfg.gameplay.toleranceSoft) || 0.25;
    this.targetScore = (this.cfg.gameplay && this.cfg.gameplay.targetScore) || 300;
    this.pourRates = (this.cfg.gameplay && this.cfg.gameplay.pourRates) || {};
    this.recipes = (this.cfg.gameplay && this.cfg.gameplay.recipes) || [];
    this.pourSpeedMultiplier = (this.cfg.gameplay && this.cfg.gameplay.pourSpeedMultiplier) || 0.1;
    // 0.35x of previous speed; tweak in config if needed

    this._scoreLast = 0;
    this._timerDangerArmed = false;


    // Camera/world (portrait 1080x1920)
    const gw = this.game.config.width;
    const gh = this.game.config.height;
    // this.cameras.main.setBackgroundColor('#0e0f13');
    this.add.image(gw * 0.5, gh * 0.5, 'background')

    // --- Background counter & shelf using platform images ---
    const counter = this.add.sprite(gw * 0.5, gh * 0.82, 'platform')
      .setOrigin(0.5, 0.5);
    counter.setDisplaySize(gw * 0.9, 80);
    this.physics.add.existing(counter, true);
    counter.body.setSize(counter.displayWidth, counter.displayHeight);

    const shelf = this.add.sprite(gw * 0.5, gh * 0.23, 'platform2')
      .setOrigin(0.5, 0.5);
    shelf.setDisplaySize(gw * 0.9, 72);
    this.physics.add.existing(shelf, true);
    shelf.body.setSize(shelf.displayWidth, shelf.displayHeight);

    // --- Glass ---
    const glassW = 180;
    const glassH = 300;

    let glassKey = 'glass';
    if (!this.textures.exists(glassKey)) {
      // Build a fallback texture on the fly
      this._createGlassFallbackTexture('glass_fallback', glassW, glassH);
      glassKey = 'glass_fallback';
    }

    this.glass = this.add.sprite(gw * 0.5, gh * 0.66, glassKey).setOrigin(0.5, 1);
    this.glass.setDisplaySize(glassW, glassH);
    this.physics.add.existing(this.glass, true);
    this.glass.body.setSize(this.glass.displayWidth, this.glass.displayHeight);


    // --- Ingredient -> color (you can move these to config later) ---
    this.ingColors = {
      yogurt: 0xfff3cc, // creamy
      water: 0x57c7ff, // blue
      salt: 0xe6e6e6, // light gray
      cumin: 0xad7f3d, // spice brown
      lemon: 0xfff062, // yellow
      soda: 0xa3f5ff, // cyan
      sugar: 0xffffff, // white
      ice: 0xcef0ff  // icy blue-white
    };

    // --- Tiny round 'drop' texture for particles ---
    const g = this.add.graphics();
    g.fillStyle(0xffffff, 1);
    g.fillCircle(4, 4, 4);
    g.generateTexture('drop', 8, 8);
    g.destroy();

    // --- Particle manager + emitter (start stopped) ---
    // Phaser 3.60+: create the emitter directly (no manager)
    // --- Particle manager + emitter (Phaser 3.55.x style) ---
    // this.particles = this.add.particles('drop'); // manager (a Game Object)
    // this.particles.setDepth(7);

    // --- 3.60+ emitter (no manager) ---
    this.pourEmitter = this.add.particles(
      this.glass.x,
      this.glass.y - this.glass.displayHeight + 12,
      'drop',
      {
        speedY: { min: 220, max: 360 },
        speedX: { min: -30, max: 30 },
        lifespan: { min: 400, max: 700 },
        scale: { start: 0.8, end: 0.2 },
        quantity: 2,
        frequency: 25,
        gravityY: 550,
        alpha: { start: 0.9, end: 0.0 },
        tint: this.liquidColor,
        emitting: false, // start off
      }
    );
    this.pourEmitter.setDepth(7);

    // keep emitter and label aligned with the glass (stored handler for cleanup)
    this._updateTick = () => {
      if (this.pourEmitter) {
        this.pourEmitter.setPosition(
          this.glass.x,
          this.glass.y - this.glass.displayHeight + 12
        );
      }
      if (this.pourLabel) {
        this.pourLabel.setPosition(
          this.glass.x,
          this.glass.y - this.glass.displayHeight - 110
        );
      }
    };
    this.events.on('update', this._updateTick);

    // --- Liquid fill graphics inside the glass ---
    this.liquidGfx = this.add.graphics();
    const maskShape = this.add.rectangle(
      this.glass.x,
      this.glass.y - this.glass.displayHeight / 2,
      this.glass.displayWidth * 0.72, // narrower than glass for a margin
      this.glass.displayHeight * 0.9
    ).setOrigin(0.5);
    this.liquidMask = maskShape.createGeometryMask();
    this.liquidGfx.setMask(this.liquidMask);
    // after creating glass, particles, and liquidGfx
    this.glass.setDepth(5);
    if (this.liquidGfx) this.liquidGfx.setDepth(6);   // liquid above glass
    if (this.pourEmitter) this.pourEmitter.setDepth(7);
    // droplets above liquid


    // Initial draw
    this._redrawLiquid();

    // --- Ingredient buttons (top shelf) ---
    // Layout row on shelf: center line, spaced icons
    const shelfY = shelf.y + 4; // visually a tad below center
    const ingKeys = [
      'yogurt', 'water', 'salt', 'cumin',
      'lemon', 'soda', 'sugar', 'ice'
    ].filter(k => !!this.cfg.images1[k]); // only spawn if present in config

    const gap = Math.min(140, (gw * 0.86) / Math.max(ingKeys.length, 1));
    const startX = gw * 0.5 - ((ingKeys.length - 1) * gap) / 2;

    ingKeys.forEach((key, idx) => {
      const x = startX + idx * gap;
      const sp = this.add.sprite(x, shelfY, key).setOrigin(0.5, 0.5);
      sp.setDisplaySize(96, 96);
      this.physics.add.existing(sp, true);
      sp.body.setSize(sp.displayWidth, sp.displayHeight);
      sp.setInteractive({ useHandCursor: true, pixelPerfect: false });
      this.ingredients.set(key, sp);
    });

    // --- UI (minimal gameplay-only) ---
    // const fontFamily = (this.cfg.font && this.cfg.font.family) || 'Outfit, Arial, sans-serif';
    const scoreLabel = (this.cfg.texts && this.cfg.texts.score_label) || 'Score:';
    // this.scoreText = this.add.text(40, 40, `${scoreLabel} 0`, { fontFamily, fontSize: '42px', color: '#ffffff' });
    // this.timerText = this.add.text(gw - 40, 40, this._fmtTime(this.timerMs), { fontFamily, fontSize: '42px', color: '#ffffff' }).setOrigin(1, 0);
    // this.orderText = this.add.text(gw * 0.5, gh * 0.48 - 150, '', { fontFamily, fontSize: '58px', color: '#e70d0dff' }).setOrigin(0.5, 0.5);
    // Fancy HUD
    this._buildHUD(gw, gh);

    if (this.timerValueText) this.timerValueText.setText(this._fmtTime(this.timerMs));
    if (this.scoreValueText) this.scoreValueText.setText(String(this.score));


    // Order title (we keep this one center-screen, make it bolder)
    const fontFamily = (this.cfg.font && this.cfg.font.family) || 'Outfit, Arial, sans-serif';
    this.orderText = this.add.text(gw * 0.5, gh * 0.48 - 150, '', {
      fontFamily, fontSize: '62px', color: '#ff6b6b', fontStyle: 'bold', stroke: '#000', strokeThickness: 8
    }).setOrigin(0.5).setDepth(10);

    // Update Fill text stays where you have it


    this.fillText = this.add.text(gw * 0.5, this.glass.y - this.glass.displayHeight - 20, 'Fill: 0%', { fontFamily, fontSize: '48px', color: '#045781ff' }).setOrigin(0.5, 1);

    // NEW: floating label for current ingredient
    this.pourLabel = this.add.text(
      this.glass.x,
      this.glass.y - this.glass.displayHeight - 110,
      '',
      {
        fontFamily,
        fontSize: '44px',
        color: '#ffd166',
        fontStyle: 'bold',
        stroke: '#000000',
        strokeThickness: 6,
        align: 'center'
      }
    ).setOrigin(0.5).setAlpha(0).setDepth(8);


    // --- Prepare first order ---
    this._startNextOrder();

    // --- Input ---
    this.input.on(Phaser.Input.Events.POINTER_DOWN, this._onPointerDown);
    this.input.on(Phaser.Input.Events.POINTER_UP, this._onPointerUp);
    this.input.on(Phaser.Input.Events.POINTER_MOVE, this._onPointerMove);

    // --- Audio ---
    const A = this.sound.add.bind(this.sound);
    const aud = this.cfg.audio || {};
    if (aud.bgm) {
      this.bgm = A('bgm', { loop: true, volume: 0.7 });
      this.bgm.play();
    }
    if (aud.pour) this.sfx.pour = A('pour', { volume: 0.9 });
    if (aud.collect) this.sfx.collect = A('collect', { volume: 1.0 });
    if (aud.hit) this.sfx.hit = A('hit', { volume: 1.0 });
    if (aud.level_complete) this.sfx.level_complete = A('level_complete', { volume: 1.0 });
    if (aud.game_over) this.sfx.game_over = A('game_over', { volume: 1.0 });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.pourEmitter) this.pourEmitter.stop();
      if (this.bgm) this.bgm.stop();

      // NEW: remove update listener and kill tweens
      if (this._updateTick) this.events.off('update', this._updateTick);
      if (this.tweens) this.tweens.killAll();
    });

  }

  update(time, delta) {
    if (this.hasEnded) return;

    // Timer
    this.timerMs = Math.max(0, this.timerMs - delta);
    // this.timerText.setText(this._fmtTime(this.timerMs));
    if (this.timerValueText) this.timerValueText.setText(this._fmtTime(this.timerMs));

    // Arm danger at 10s and below
    const lowMs = 10000;
    if (this.timerMs <= lowMs && !this._timerDangerArmed) {
      this._timerDangerArmed = true;
      this._setTimerDanger(true);
      // optional: tiny shake
      this.tweens.add({ targets: this.timerPill, angle: { from: -2, to: 2 }, duration: 60, yoyo: true, repeat: 6 });
    } else if (this.timerMs > lowMs && this._timerDangerArmed) {
      this._timerDangerArmed = false;
      this._setTimerDanger(false);
    }

    if (this.timerMs <= 0) {
      this._endRound(false, 'time');
      return;
    }

    // Pouring logic
    if (this.isPouring && this.activeIngredient && this.totalPoured < this.glassCapacity) {
      const baseRate = this.pourRates[this.activeIngredient] || 0;
      const rate = baseRate * this.pourSpeedMultiplier;       // <<< slower overall
      const add = (rate * delta) / 1000;                       // units per second (now reduced)
      const room = this.glassCapacity - this.totalPoured;
      const amt = Math.min(add, room);
      if (amt > 0) {
        this.mix[this.activeIngredient] = (this.mix[this.activeIngredient] || 0) + amt;
        this.totalPoured += amt;
        this._updateFillLabel();
        this._redrawLiquid();

      }
      if (this.totalPoured >= this.glassCapacity) {
        this._stopPour();
        if (!this.didAutoServe) {
          this.didAutoServe = true;
          this._shakeGlassThenAutoServe();
        }
      }

    }
    // Win check
    if (this.score >= this.targetScore) {
      this._endRound(true, 'target');
    }
  }

  _redrawLiquid() {
    if (!this.liquidGfx) return;
    const pct = Phaser.Math.Clamp(this.totalPoured / this.glassCapacity, 0, 1);

    // Liquid area (simple rectangle) – you can curve the top later
    const width = this.glass.displayWidth * 0.66;   // inside margins
    const height = this.glass.displayHeight * 0.86;  // inside margins
    const left = this.glass.x - width / 2;
    const bottom = this.glass.y - 8;                 // slight offset
    const fillH = height * pct;

    this.liquidGfx.clear();

    // subtle layered effect (dark body + lighter top foam)
    // Body
    this.liquidGfx.fillStyle(this.liquidColor, 0.95);
    this.liquidGfx.fillRect(left, bottom - fillH, width, fillH);

    // Top line/foam
    if (pct > 0) {
      this.liquidGfx.fillStyle(0xffffff, 0.15);
      this.liquidGfx.fillRect(left, bottom - fillH - 4, width, 6);
    }
  }

  _setLiquidColorForIngredient(key) {
    this.liquidColor = this.ingColors[key] ?? 0x57c7ff;
  }


  // ---------------- Input ----------------

  _onPointerDown(pointer) {
    if (this.hasEnded) return;

    const worldPoint = pointer.position;
    // Check ingredient hit first
    for (const [key, sp] of this.ingredients.entries()) {
      if (sp.getBounds().contains(worldPoint.x, worldPoint.y)) {
        if (key === 'ice') {
          // Toggle ice bonus quickly (no continuous pour)
          this._toggleIce();
          if (this.sfx.collect) this.sfx.collect.play();
          return;
        }
        this._startPour(key);
        return;
      }
    }

    // If pressed inside glass, prepare for swipe-serve
    if (this.glass.getBounds().contains(worldPoint.x, worldPoint.y)) {
      this.pointerDownAt = { x: worldPoint.x, y: worldPoint.y, time: this.time.now };
      this.swipeFromGlass = true;
    } else {
      this.pointerDownAt = { x: worldPoint.x, y: worldPoint.y, time: this.time.now };
      this.swipeFromGlass = false;
    }
  }

  _onPointerMove(pointer) {
    // Continuous pour is handled in update()
  }

  _onPointerUp(pointer) {
    if (this.hasEnded) return;

    // Stop pour if any
    if (this.isPouring) {
      this._stopPour();
    }

    // Serve detection: swipe down from glass
    if (this.pointerDownAt) {
      const dy = pointer.y - this.pointerDownAt.y;
      if (this.swipeFromGlass && dy >= this.swipeThreshold) {
        this._serveDrink();
      }
    }
    this.pointerDownAt = null;
    this.swipeFromGlass = false;
  }

  // --------------- Helpers ---------------

  _startPour(key) {
    this._setLiquidColorForIngredient(key);
    if (this.pourEmitter) {
      if (this.pourEmitter.setTint) this.pourEmitter.setTint(this.liquidColor);
      else if (this.pourEmitter.setParticleTint) this.pourEmitter.setParticleTint(this.liquidColor);
      else if (this.pourEmitter.setConfig) this.pourEmitter.setConfig({ tint: this.liquidColor });
      this.pourEmitter.start();
    }
    this.activeIngredient = key;
    this.isPouring = true;
    if (this.sfx.pour) this.sfx.pour.play();

    // NEW: show ingredient name while pouring
    const name = this._getIngredientDisplayName(key);
    this.tweens.killTweensOf(this.pourLabel);
    this.pourLabel.setText(name);
    this.pourLabel.setAlpha(1);
    this.pourLabel.setScale(0.96);
    this.tweens.add({
      targets: this.pourLabel,
      scale: 1.04,
      duration: 200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut'
    });
  }


  _stopPour() {
    if (this.pourEmitter) this.pourEmitter.stop();
    this.isPouring = false;
    this.activeIngredient = null;
    if (this.sfx.pour) this.sfx.pour.stop();

    // NEW: fade label out
    this.tweens.killTweensOf(this.pourLabel);
    this.tweens.add({
      targets: this.pourLabel,
      alpha: 0,
      duration: 140
    });
  }





  _toggleIce() {
    this.hasIce = !this.hasIce;

    // NEW: flash feedback
    const msg = this.hasIce ? 'ICE ADDED' : 'ICE REMOVED';
    this._flashLabel(msg, 600);

    // If user is actively pouring something, bring its name back after the flash
    if (this.isPouring && this.activeIngredient) {
      const name = this._getIngredientDisplayName(this.activeIngredient);
      this.time.delayedCall(620, () => {
        if (!this.isPouring || !this.activeIngredient) return;
        this.tweens.killTweensOf(this.pourLabel);
        this.pourLabel.setText(name);
        this.pourLabel.setAlpha(1);
        this.pourLabel.setScale(0.96);
        this.tweens.add({
          targets: this.pourLabel,
          scale: 1.04,
          duration: 200,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.inOut'
        });
      });
    }
  }


  _startNextOrder() {
    if (!this.recipes.length) return;
    this.currentOrder = this.recipes[this.orderIndex % this.recipes.length];
    this.orderIndex += 1;
    // Reset mix
    this.mix = {};
    this.totalPoured = 0;
    this._redrawLiquid();

    this.didAutoServe = false;

    this.hasIce = false;
    // Update UI
    this.orderText.setText(this.currentOrder.name);
    this._updateFillLabel();
  }

  _serveDrink() {
    // No content poured?
    if (this.totalPoured <= 0) {
      if (this.sfx.hit) this.sfx.hit.play();
      this.consecutiveBad++;
      if (this.consecutiveBad >= 3) {
        this._endRound(false, 'badmix');
      }
      return;
    }

    const targets = this.currentOrder.targets; // {ingredient: percent}
    const actualPct = {};
    for (const k of Object.keys(targets)) {
      const amt = this.mix[k] || 0;
      actualPct[k] = (amt / this.totalPoured) || 0; // 0..1
    }

    // Scoring
    let perfectCount = 0;
    let partialCount = 0;
    let maxPerIng = 25; // each ingredient perfect -> 25 pts
    let gained = 0;
    let anyHardFail = false;

    for (const k of Object.keys(targets)) {
      const target = targets[k] / 100; // -> 0..1
      const act = actualPct[k] || 0;
      const diff = Math.abs(act - target);
      if (diff <= this.tolerancePerfect) {
        perfectCount++;
        gained += maxPerIng;
      } else if (diff <= this.toleranceSoft) {
        partialCount++;
        // linearly scale from perfect to soft: at soft -> 40% of points
        const t = Phaser.Math.Clamp((this.toleranceSoft - diff) / (this.toleranceSoft - this.tolerancePerfect), 0, 1);
        gained += Phaser.Math.Linear(10, maxPerIng, t); // 10..25
      } else {
        anyHardFail = true;
      }
    }

    // Optional ice bonus
    if (this.hasIce) gained += 5;

    if (anyHardFail) {
      // Bad mix
      if (this.sfx.hit) this.sfx.hit.play();
      this.consecutiveBad++;
      this.combo = 0;
      // Small consolation if partially close
      if (gained > 0) this.score += Math.floor(gained * 0.4);
    } else {
      // Good or perfect
      if (perfectCount === Object.keys(targets).length) {
        this.combo++;
        gained += this.combo * 5; // combo bonus
      } else {
        this.combo = 0;
      }
      this.consecutiveBad = 0;
      if (this.sfx.level_complete) this.sfx.level_complete.play();
      this.score += Math.floor(gained);
    }

    if (this.scoreValueText) this.scoreValueText.setText(String(this.score));
    if (this.score > this._scoreLast) this._bumpScorePill();
    this._scoreLast = this.score;


    // Next order
    this._startNextOrder();
  }
  _getIngredientDisplayName(key) {
    return (this.cfg.texts && this.cfg.texts.ingredient_names && this.cfg.texts.ingredient_names[key])
      ? this.cfg.texts.ingredient_names[key]
      : key.toUpperCase();
  }

  _flashLabel(msg, keepForMs = 700) {
    if (!this.pourLabel) return;
    this.tweens.killTweensOf(this.pourLabel);
    this.pourLabel.setText(msg);
    this.pourLabel.setAlpha(1);
    this.pourLabel.setScale(1.05);
    // gentle pulse
    this.tweens.add({
      targets: this.pourLabel,
      scale: 1.0,
      duration: 160,
      yoyo: true,
      repeat: 2,
      ease: 'Sine.inOut'
    });
    // fade out after a short delay
    this.tweens.add({
      targets: this.pourLabel,
      alpha: 0,
      delay: keepForMs,
      duration: 180
    });
  }



  _updateFillLabel() {
    const pct = Math.round((this.totalPoured / this.glassCapacity) * 100);
    this.fillText.setText(`Fill: ${pct}%`);
  }

  _shakeGlassThenAutoServe() {
    // Tiny screen shake for the glass
    this.tweens.add({
      targets: this.glass,
      x: { from: this.glass.x - 8, to: this.glass.x + 8 },
      duration: 45,
      ease: 'Sine.inOut',
      yoyo: true,
      repeat: 6,
      onComplete: () => {
        this._evaluateMixAndEnd(); // decide WinScene or GameOverScene
      }
    });
  }

  _evaluateMixAndEnd() {
    if (this.hasEnded) return;

    const targets = this.currentOrder?.targets || {};
    if (!targets || !Object.keys(targets).length) {
      this._endRound(false, 'no_recipe');
      return;          // <-- no scene.start here
    }

    if (this.totalPoured <= 0) {
      this._endRound(false, 'empty');
      return;          // <-- no scene.start here
    }

    let allPerfect = true;
    for (const k of Object.keys(targets)) {
      const target = targets[k] / 100;
      const actual = (this.mix[k] || 0) / this.totalPoured;
      const diff = Math.abs(actual - target);
      if (diff > this.tolerancePerfect) {
        allPerfect = false;
        break;
      }
    }

    if (allPerfect) {
      this._endRound(true, 'perfect_full');   // <-- central transition
    } else {
      this._endRound(false, 'imperfect_full'); // <-- central transition
    }
  }



  _endRound(won, reason) {
    if (this.hasEnded) return;
    this.hasEnded = true;

    // Stop pour SFX immediately
    if (this.sfx.pour) this.sfx.pour.stop();

    // Play result SFX
    if (won) {
      if (this.sfx.level_complete) this.sfx.level_complete.play();
    } else {
      if (this.sfx.game_over) this.sfx.game_over.play();
    }

    // Freeze input
    this.input.off(Phaser.Input.Events.POINTER_DOWN, this._onPointerDown);
    this.input.off(Phaser.Input.Events.POINTER_UP, this._onPointerUp);
    this.input.off(Phaser.Input.Events.POINTER_MOVE, this._onPointerMove);

    // Store result for outer scenes
    this.registry.set('roundEnded', { won, reason, score: this.score });

    // Transition after a short delay so the SFX can be heard
    this.time.delayedCall(350, () => {
      const target = won ? 'WinScene' : 'GameOverScene';
      // (Optional safety) stop if already active, then start
      if (this.scene.isActive(target)) {
        this.scene.stop(target);
      }
      this.scene.start(target);
    });
  }

  _fmtTime(ms) {
    const s = Math.ceil(ms / 1000);
    const m = Math.floor(s / 60);
    const ss = (s % 60).toString().padStart(2, '0');
    return `${m}:${ss}`;
  }
}
