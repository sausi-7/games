// ... (unchanged header & class code above)

class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
    this.cfg = null;
    this.W = 1080;
    this.H = 1920;

    this.bottles = [];
    this.selected = null;
    this.moves = 0;
    this.isPouring = false;

    this.colorsMap = {};
    this.groups = { ui: null, world: null };

    this.sfx = { pour: null, invalid: null, win: null, hit: null, bgm: null };

    // NEW: prevent double win-transition
    this.didWin = false;
    this.didLose = false;
    this.timeLeft = 0;       // seconds remaining
    this.timerEvent = null;

    this.score = 0;                 // NEW: score
    this.uiFX = { redOverlay: null, finalWarnTween: null };
  }
  init() {
    // reset all volatile state
    this.bottles = [];
    this.selected = null;
    this.moves = 0;
    this.isPouring = false;
    this.didWin = false;
    this.didLose = false;
    this.timeLeft = 0;
    this.timerEvent = null;

    // stop any lingering audio/tweens from previous run
    if (this.sound) this.sound.stopAll();
    if (this.tweens) this.tweens.killAll();
    if (this.input) this.input.setDefaultCursor('default');

    this.score = 0;                 // NEW
    this.uiFX = { redOverlay: null, finalWarnTween: null }; // NEW
  }


  preload() {
    // Load cfg json is handled outside. We only read it here.
    this.cfg = this.registry.get('cfg') || {};

    // ----- Images -----
    const images = (this.cfg.images2 || {});
    Object.keys(images).forEach(k => {
      const url = images[k];
      if (typeof url === 'string') this.load.image(k, url);
    });

    // Provide a neutral fallback square & platform
    const fallbackKeys = ['fallback_square_64', 'fallback_wide_platform'];
    fallbackKeys.forEach(k => {
      if (!this.textureExists(k)) {
        const g = this.make.graphics({ x: 0, y: 0, add: false });
        if (k === 'fallback_square_64') {
          g.fillStyle(0x808080, 1);
          g.fillRoundedRect(0, 0, 64, 64, 12);
          g.generateTexture('fallback_square_64', 64, 64);
        } else {
          g.fillStyle(0x606060, 1);
          g.fillRoundedRect(0, 0, 300, 28, 12);
          g.generateTexture('fallback_wide_platform', 300, 28);
        }
        g.destroy();
      }
    });

    // ----- Audio -----
    const audio = (this.cfg.audio || {});
    Object.keys(audio).forEach(k => {
      const url = audio[k];
      if (typeof url === 'string') this.load.audio(k, url);
    });
  }


  create() {
    this.isPouring = false;
    this.didWin = false;
    this.didLose = false;
    this.selected = null;
    this.moves = 0;
    // --- Robust config bootstrap (fixes: Cannot read properties of null 'audio') ---
    // Re-grab from registry in case preload() didn't run or another scene replaced registry data.
    const regCfg = this.registry.get('cfg');
    this.cfg = (this.cfg && typeof this.cfg === 'object') ? this.cfg : (regCfg || {});

    // Dimensions
    this.W = this.sys.cameras.main.width;
    this.H = this.sys.cameras.main.height;

    // Groups
    this.groups.world = this.add.container(0, 0);
    this.groups.ui = this.add.container(0, 0);

    // Red pulse overlay (initially invisible)
    this.uiFX.redOverlay = this.add.rectangle(this.W / 2, this.H / 2, this.W, this.H, 0xff2d3d, 0)
      .setDepth(999);
    this.groups.ui.add(this.uiFX.redOverlay);


    // Config bindings (all with safe fallbacks)
    const gp = this.cfg.gameplay ?? {};
    const col = this.cfg.colors ?? {};
    this.colorsMap = col;

    // Background (optional)
    if (this.cfg.images2?.background) {
      const bgKey = this.safeImage('background', 'fallback_square_64', this.W, this.H, 0x0b0f1a);
      const bg = this.add.image(this.W / 2, this.H / 2, bgKey);
      bg.setDisplaySize(this.W, this.H);
      bg.setDepth(-100);
      this.groups.world.add(bg);
    } else {
      this.cameras.main.setBackgroundColor('#0b0f1a');
    }

    // --- Timer: read from config (default 60s), create label, start ticking ---
    this.timeLeft = Number.isFinite(gp.timerSeconds) && gp.timerSeconds > 0 ? gp.timerSeconds : 60;
    this.timerText = this.makeFancyText(20, 20, `Time: ${this.timeLeft}`, {
      size: '34px',
      color: '#ffe1e1',
      stroke: '#1a0f1f',
      strokeThickness: 8,
      shadowColor: '#ff8290',
      shadowBlur: 16,
      depth: 200,
      ox: 0, oy: 0
    });
    this.groups.ui.add(this.timerText);

    // tick every second
    this.timerEvent = this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => this.onTimeTick()
    });

    this.scoreText = this.makeFancyText(this.W / 2, 24, 'Score: 0', {
      size: '38px',
      color: '#d1f7ff',
      stroke: '#0a1a24',
      strokeThickness: 8,
      shadowColor: '#7ee7ff',
      shadowBlur: 18,
      depth: 200,
      ox: 0.5, oy: 0
    });
    this.groups.ui.add(this.scoreText);

    // clean up timer on scene shutdown (safety)
    this.events.once('shutdown', () => {
      if (this.timerEvent) this.timerEvent.remove(false);
    });


    // Optional shelf/platform
    const platformKey = this.safeImage('platform', 'fallback_wide_platform', 300, 28, 0x606060);
    const shelfY = Math.round(this.H * 0.85);
    const shelf = this.add.image(this.W / 2, shelfY, platformKey);
    shelf.setDisplaySize(Math.min(1200, this.W * 0.9), 28);
    shelf.setAlpha(0.9);
    this.groups.world.add(shelf);

    // Build bottles from layout
    const layout = gp.levelLayout ?? [];
    const capacity = gp.bottleCapacity ?? 4;

    // Grid placement
    const cols = gp.columns ?? 6;
    const marginTop = Math.round(this.H * 0.12);
    const marginX = Math.round(this.W * 0.06);
    const gridW = this.W - marginX * 2;
    const colW = gridW / cols;

    const bottleWidth = Math.min(100, Math.floor(colW * 0.65));
    const bottleHeight = Math.min(240, Math.floor((shelfY - marginTop) * 0.65));
    const gapX = Math.floor((colW - bottleWidth) / 2);

    // Pour animation settings
    this.pourMsPerUnit = gp.pourMsPerUnit ?? 220;
    this.pourArcHeight = Math.round(Math.min(120, this.H * 0.12));

    // Create Bottle instances
    this.bottles = layout.map((stack, i) => {
      const r = Math.floor(i / cols);
      const c = i % cols;
      const x = Math.round(marginX + c * colW + gapX + bottleWidth / 2);
      const y = Math.round(marginTop + r * (bottleHeight + 50)) + 150;

      const b = new Bottle(this, x, y, bottleWidth, bottleHeight, capacity, stack, this.colorsMap);
      this.groups.world.add(b.container);

      b.container.setInteractive(
        new Phaser.Geom.Rectangle(-bottleWidth / 2, -bottleHeight / 2, bottleWidth, bottleHeight),
        Phaser.Geom.Rectangle.Contains
      );
      b.container.on('pointerdown', () => this.onBottleTap(b));
      return b;
    });

    // UI: moves
    this.movesText = this.makeFancyText(this.W - 20, 20, 'Moves: 0', {
      size: '34px',
      color: '#e6f0ff',
      stroke: '#0d1a33',
      strokeThickness: 8,
      shadowColor: '#7aa7ff',
      shadowBlur: 16,
      depth: 200,
      ox: 1, oy: 0
    });
    this.groups.ui.add(this.movesText);
    // --- Audio (safe) ---
    const a = this.cfg.audio ?? {};
    this.sfx.pour = a.attack ? this.sound.add('attack', { volume: 0.6 }) : null;
    this.sfx.invalid = a.collision ? this.sound.add('collision', { volume: 0.6 }) : null;
    this.sfx.hit = a.hit ? this.sound.add('hit', { volume: 0.6 }) : null;
    this.sfx.win = a.level_complete ? this.sound.add('level_complete', { volume: 0.7 }) : null;

    if (a.bgm) {
      this.sfx.bgm = this.sound.add('bgm', { volume: 0.35, loop: true });
      if (this.sound.locked) {
        this.sound.once('unlocked', () => {
          if (this.sfx.bgm && !this.sfx.bgm.isPlaying) this.sfx.bgm.play();
        });
      } else {
        this.sfx.bgm.play();
      }
    }

    // Initial win check
    this.checkWin();
  }


  async onBottleTap(bottle) {
    if (this.isPouring || this.didWin) return;

    if (!this.selected) {
      if (bottle.isEmpty()) {
        // invalid pick → subtle bump only; no camera shake
        this.bumpBottle(bottle);
        this.playInvalid();
        return;
      }
      this.selected = bottle;
      bottle.setSelected(true);
      this.tweens.add({ targets: bottle.container, scale: 1.03, yoyo: true, duration: 80 });
      return;
    }

    if (bottle === this.selected) {
      bottle.setSelected(false);
      this.selected = null;
      return;
    }

    const src = this.selected;
    const dst = bottle;
    const pourInfo = src.getPourInfoInto(dst);

    if (!pourInfo.canPour || pourInfo.units <= 0) {
      // Keep source selected; only target bumps to avoid “shake” feeling on the whole screen
      this.bumpBottle(dst);
      this.playInvalid();
      return;
    }

    // VALID POUR
    this.isPouring = true;
    src.setSelected(false);
    await this.animatePour(src, dst, pourInfo.units, pourInfo.colorName);
    this.isPouring = false;
    this.selected = null;

    this.moves++;
    this.movesText.setText(`Moves: ${this.moves}`);
    this.pulseText(this.movesText, { amount: 1.22, ms: 120, colorFlash: '#ffffff' });

    this.checkWin();
  }

  // ---------- Asset helpers (add these inside GameScene) ----------
  textureExists(key) {
    return this.textures && this.textures.exists(key);
  }

  // Ensures a texture exists, otherwise generates a rounded-rect fallback and returns its key
  safeImage(key, fallbackKey, w = 64, h = 64, tint = 0x888888) {
    // If the requested key exists, use it
    if (this.textures && this.textures.exists(key)) return key;

    // If fallback already exists, use it
    if (this.textures && this.textures.exists(fallbackKey)) return fallbackKey;

    // Generate a simple rounded-rect fallback texture on the fly
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(tint, 1);
    g.fillRoundedRect(0, 0, w, h, Math.min(w, h) * 0.2);
    g.generateTexture(fallbackKey, w, h);
    g.destroy();

    return fallbackKey;
  }


  // ---------- Fancy text & FX helpers ----------
  makeFancyText(x, y, content, opts = {}) {
    const t = this.add.text(x, y, content, {
      fontFamily: (this.cfg.font && this.cfg.font.family) || 'system-ui',
      fontSize: opts.size || '34px',
      fontStyle: '700',
      color: opts.color || '#ffffff',
      stroke: opts.stroke || '#0b0f1a',
      strokeThickness: opts.strokeThickness ?? 6,
      shadow: {
        offsetX: 0,
        offsetY: 0,
        color: opts.shadowColor || '#000000',
        blur: opts.shadowBlur ?? 12,
        stroke: true,
        fill: true
      }
    })
      .setDepth(opts.depth ?? 200)
      .setOrigin(opts.ox ?? 0.5, opts.oy ?? 0.5);

    // subtle idle breathing
    this.tweens.add({
      targets: t,
      scale: (opts.breatheScale ?? 1.03),
      duration: 1200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });

    return t;
  }

  pulseText(t, { amount = 1.18, ms = 140, colorFlash = '#ffffff' } = {}) {
    const originalColor = t.style.color;
    this.tweens.add({
      targets: t,
      scale: amount,
      duration: ms,
      yoyo: true,
      onStart: () => t.setColor(colorFlash),
      onComplete: () => t.setColor(originalColor)
    });
  }

  startLowTimeWarning() {
    if (this._lowTimeTween) return;

    // Timer heartbeat
    this._lowTimeTween = this.tweens.add({
      targets: this.timerText,
      scale: 1.3,
      duration: 120,
      yoyo: true,
      repeat: -1
    });

    // Screen pulse
    if (!this.uiFX.finalWarnTween) {
      this.uiFX.finalWarnTween = this.tweens.add({
        targets: this.uiFX.redOverlay,
        alpha: { from: 0.00, to: 0.12 },
        duration: 240,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      });
    }
  }

  stopLowTimeWarning() {
    if (this._lowTimeTween) { this._lowTimeTween.stop(); this._lowTimeTween = null; }
    if (this.uiFX.finalWarnTween) { this.uiFX.finalWarnTween.stop(); this.uiFX.finalWarnTween = null; }
    if (this.uiFX.redOverlay) this.uiFX.redOverlay.setAlpha(0);
    if (this.timerText) this.timerText.setScale(1);
  }


  // Generate tiny particle textures once
  ensureJuiceTextures() {
    if (!this.textures.exists('spark')) {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      g.fillStyle(0xffffff, 1);
      g.fillCircle(8, 8, 8);
      g.generateTexture('spark', 16, 16);
      g.clear();
      g.lineStyle(3, 0xffffff, 1);
      g.strokeCircle(10, 10, 10);
      g.generateTexture('ring', 20, 20);
      g.destroy();
    }
  }

  burstConfetti(x, y) {
    this.ensureJuiceTextures();
    const p = this.add.particles(0, 0, 'spark', {
      x, y,
      speed: { min: 120, max: 320 },
      angle: { min: 0, max: 360 },
      lifespan: { min: 500, max: 1000 },
      scale: { start: 1, end: 0 },
      quantity: 30,
      gravityY: 600,
      tint: [0xff6b6b, 0xffd93d, 0x6bcB77, 0x4d96ff, 0xb892ff]
    });
    this.time.delayedCall(900, () => p.destroy());
  }


  onTimeTick() {
    if (this.didWin || this.didLose) return;
    this.timeLeft = Math.max(0, this.timeLeft - 1);
    if (this.timerText) this.timerText.setText(`Time: ${this.timeLeft}`);

    // Final 6-second urgency
    if (this.timeLeft <= 6 && this.timeLeft > 0) {
      this.startLowTimeWarning();

      // quick color flash + optional tick SFX
      const old = this.timerText.style.color;
      this.timerText.setColor('#ff4d4f');
      this.time.delayedCall(110, () => this.timerText.setColor(old));

      if (this.sfx.hit) this.sfx.hit.play({ volume: 0.3 });
      this.cameras.main.shake(60, 0.0012); // subtle shake
    } else if (this.timeLeft > 6) {
      this.stopLowTimeWarning();
    }

    if (this.timeLeft === 0) {
      this.stopLowTimeWarning();
      this.didLose = true;
      if (this.sfx.bgm && this.sfx.bgm.isPlaying) this.sfx.bgm.stop();
      this.isPouring = true;
      const gameOverKey = (this.cfg.scenes && this.cfg.scenes.gameover) || 'GameOverScene';
      this.scene.start(gameOverKey, { reason: 'timeout', moves: this.moves, time: 0, score: this.score });
    }
  }



  playInvalid() { if (this.sfx.invalid) this.sfx.invalid.play(); }

  bumpBottle(bottle) {
    // Guard against stacked bumps (which can look jittery on edges)
    const t = bottle.container;
    if (this.isPouring || this.didWin) return;
    this.tweens.killTweensOf(t);
    t.setScale(1);
    this.tweens.add({ targets: t, scale: 1.05, yoyo: true, duration: 80, repeat: 1 });
  }

  async animatePour(src, dst, units, colorName) {
    const srcP = src.getNeckWorld();
    const dstP = dst.getNeckWorld();

    for (let i = 0; i < units; i++) {
      const droplet = this.add.circle(srcP.x, srcP.y, 10, dst.colorValue(colorName), 1).setDepth(150);
      const midX = (srcP.x + dstP.x) / 2;
      const midY = Math.min(srcP.y, dstP.y) - this.pourArcHeight;

      await new Promise((resolve) => {
        const tw = this.tweens.addCounter({
          from: 0, to: 1, duration: this.pourMsPerUnit,
          onStart: () => { if (this.sfx.pour) this.sfx.pour.play(); },
          onUpdate: (tween) => {
            const t = tween.getValue();
            const x = (1 - t) * (1 - t) * srcP.x + 2 * (1 - t) * t * midX + t * t * dstP.x;
            const y = (1 - t) * (1 - t) * srcP.y + 2 * (1 - t) * t * midY + t * t * dstP.y;
            droplet.setPosition(x, y);
          },
          onComplete: () => {
            const unitColor = src.popTopUnit();
            dst.pushUnit(unitColor);
            src.redraw();
            dst.redraw();
            droplet.destroy(true);

            resolve();
          }
        });
        tw && tw.once && tw.once('destroy', () => { droplet.destroy(true); resolve(); });
      });
    }
    // After all units animate & transfer:
    this.addScore(units);  // NEW: award points per unit poured

  }

  addScore(delta = 1) {
    if (!Number.isFinite(delta) || delta <= 0) return;

    this.score += delta;
    this.scoreText.setText(`Score: ${this.score}`);

    // Pop effect
    this.tweens.add({
      targets: this.scoreText,
      scale: 1.24,
      duration: 120,
      yoyo: true
    });

    // Floating "+X"
    const t = this.add.text(this.scoreText.x, this.scoreText.y + 40, `+${delta}`, {
      fontFamily: (this.cfg.font && this.cfg.font.family) || 'system-ui',
      fontSize: '32px',
      color: '#9bffb0',
      stroke: '#0d2a16',
      strokeThickness: 6
    }).setOrigin(0.5, 0).setDepth(210);

    this.tweens.add({
      targets: t,
      y: t.y - 36,
      alpha: 0,
      duration: 480,
      onComplete: () => t.destroy()
    });

    // Sparkle near score
    this.ensureJuiceTextures();
    const p = this.add.particles(0, 0, 'spark', {
      x: this.scoreText.x,
      y: this.scoreText.y + 10,
      speed: { min: 70, max: 160 },
      angle: { min: -60, max: 240 },
      lifespan: { min: 300, max: 700 },
      scale: { start: 0.9, end: 0 },
      quantity: 10,
      tint: [0x9bffb0, 0x7ee7ff, 0xffffa8]
    });
    this.time.delayedCall(500, () => p.destroy());
  }


  checkWin() {
    if (this.didWin) return;

    const allGood = this.bottles.every(b => b.isUniformOrEmpty());
    if (!allGood) return;

    this.didWin = true;
    if (this.timerEvent) this.timerEvent.remove(false);
    if (this.sfx.win) this.sfx.win.play();

    // Small celebration pulse
    this.bottles.forEach(b => {
      this.tweens.add({
        targets: b.container,
        scale: 1.06,
        yoyo: true,
        duration: 140,
        repeat: 3,
        delay: Phaser.Math.Between(0, 160)
      });
    });

    // celebration
    this.burstConfetti(this.W * 0.5, this.H * 0.25);
    this.burstConfetti(this.W * 0.2, this.H * 0.35);
    this.burstConfetti(this.W * 0.8, this.H * 0.35);


    // ✅ Allowed minimal transition to WinScene (keeps GameScene pure of UI)
    const winKey = (this.cfg.scenes && this.cfg.scenes.win) || 'WinScene';
    this.time.delayedCall(600, () => {
      // Pass data if your WinScene reads it
      this.scene.start(winKey, { moves: this.moves });
    });

    // lock inputs after win
    this.isPouring = true;
  }

  update() { /* no per-frame logic needed */ }
}

// ---------- Bottle Helper Class (unchanged except comments) ----------
class Bottle {
  constructor(scene, x, y, width, height, capacity, stackNames, colorsMap) {
    this.scene = scene;
    this.capacity = capacity;
    this.stack = Array.isArray(stackNames) ? [...stackNames] : [];
    this.colorsMap = colorsMap;

    this.width = width;
    this.height = height;

    this.container = scene.add.container(x, y);
    this.bg = scene.add.rectangle(0, 0, width, height, 0xffffff, 0.08)
      .setStrokeStyle(2, 0xffffff, 0.2)
      .setOrigin(0.5);
    this.container.add(this.bg);

    this.liquidGfx = scene.add.graphics();
    this.container.add(this.liquidGfx);

    this.selectedRing = scene.add.circle(0, 0, Math.max(width, height) * 0.58, 0x8ee0ff, 0.15)
      .setVisible(false);
    this.container.addAt(this.selectedRing, 0);

    this.redraw();
  }

  isEmpty() { return this.stack.length === 0; }
  isFull() { return this.stack.length >= this.capacity; }
  topColor() { return this.stack.length ? this.stack[this.stack.length - 1] : null; }

  getPourInfoInto(dst) {
    if (this.isEmpty()) return { canPour: false, units: 0, colorName: null };
    const color = this.topColor();
    const dstTop = dst.topColor();

    if (dst.isFull()) return { canPour: false, units: 0, colorName: null };
    if (dstTop !== null && dstTop !== color) return { canPour: false, units: 0, colorName: null };

    const contiguous = this.countTopContiguous(color);
    const free = dst.capacity - dst.stack.length;
    const units = Math.min(contiguous, free);
    return { canPour: units > 0, units, colorName: color };
  }

  countTopContiguous(color) {
    let count = 0;
    for (let i = this.stack.length - 1; i >= 0; i--) {
      if (this.stack[i] === color) count++;
      else break;
    }
    return count;
  }

  popTopUnit() { return this.stack.pop(); }
  pushUnit(colorName) { if (this.stack.length < this.capacity) this.stack.push(colorName); }

  isUniformOrEmpty() {
    if (this.stack.length === 0) return true;
    const first = this.stack[0];
    for (let i = 1; i < this.stack.length; i++) if (this.stack[i] !== first) return false;
    return true;
  }

  colorValue(name) {
    const v = this.colorsMap[name];
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v.startsWith('#')) return parseInt(v.slice(1), 16);
    return 0x999999;
  }

  redraw() {
    const g = this.liquidGfx;
    g.clear();

    const pad = 6;
    const usableH = this.height - pad * 2;
    const unitH = usableH / this.capacity;
    const w = this.width - pad * 2;

    for (let i = 0; i < this.stack.length; i++) {
      const hex = this.colorValue(this.stack[i]);
      const y = this.height / 2 - pad - unitH * (i + 1) + unitH / 2;
      g.fillStyle(hex, 1);
      g.fillRoundedRect(-w / 2, y - unitH / 2, w, unitH - 2, Math.min(8, unitH * 0.3));
      g.lineStyle(2, 0x000000, 0.12);
      g.strokeRoundedRect(-w / 2, y - unitH / 2, w, unitH - 2, Math.min(8, unitH * 0.3));
    }

    g.lineStyle(3, 0xffffff, 0.22);
    g.strokeRoundedRect(-this.width / 2, -this.height / 2, this.width, this.height, Math.min(16, this.width * 0.25));
  }

  setSelected(v) { this.selectedRing.setVisible(!!v); }

  getNeckWorld() {
    const p = new Phaser.Math.Vector2(0, -this.height / 2);
    const wp = this.container.getWorldTransformMatrix().transformPoint(p.x, p.y);
    return new Phaser.Math.Vector2(wp.x, wp.y);
  }
}

// export default GameScene;
