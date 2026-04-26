class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');

    // Runtime state
    this.currentPlatform = null;
    this.nextPlatform = null;
    this.platforms = null;

    this.stick = null;          // the bridge
    this.isGrowing = false;
    this.growTimer = 0;
    this.growRate = 800;        // px/sec vertical growth

    this.player = null;
    this.score = 0;
    this.scoreText = null;

    this.inMotion = false;      // blocks input while anims play
    this.perfectZone = null;    // small center zone on next platform

    // Audio refs
    this.sfx = {};
    this.bgm = null;

    // FX
    this.fx = {
      ambient: null,
      shine: null
    };

    // HUD visuals
    this._scorePill = null;

    this.breathTween = null;
  }

  preload() {
    const cfg = this.registry.get('cfg') || {};

    // Images
    const imgs = (cfg.images1 || {});
    const images2 = (cfg.images2 || {});
    const ui = (cfg.ui || {});
    Object.keys(imgs).forEach((key) => this.load.image(key, imgs[key]));
    Object.keys(images2).forEach((key) => this.load.image(key, images2[key]));
    Object.keys(ui).forEach((key) => this.load.image(key, ui[key]));

    // Spritesheets (optional)
    const sheets = cfg.spritesheets || {};
    for (const [key, meta] of Object.entries(sheets)) {
      this.load.spritesheet(key, meta.url, {
        frameWidth: meta.frameWidth,
        frameHeight: meta.frameHeight
      });
    }

    // Audio
    const aud = (cfg.audio || {});
    for (const [key, url] of Object.entries(aud)) this.load.audio(key, url);
  }

  create() {
    const cfg = this.registry.get('cfg') || {};
    const gp = cfg.gameplay || {};
    this.score = 0;

    // Orientation: portrait 1080x1920 expected, but adapt to any
    const W = this.scale.width;
    const H = this.scale.height;

    // Background (optional)
    if (cfg.images2 && cfg.images2.background) {
      const bg = this.add.image(W / 2, H / 2, 'background').setOrigin(0.5);
      const sx = W / bg.width;
      const sy = H / bg.height;
      bg.setScale(Math.max(sx, sy));
      bg.setDepth(-10);
    }

    // Physics world (Arcade)
    this.physics.world.setBounds(0, 0, W, H);

    // FX textures (procedural)
    this._makeParticleTextures();
    this._makeStickTextures();

    // Ambient floating particles (subtle depth) — new API safe
    this.fx.ambient = this._makeEmitter('fx_dot', 0, 0, {
      x: { min: 0, max: W },
      y: H + 20,
      lifespan: 6000,
      quantity: 2,
      frequency: 120,
      speed: { min: 20, max: 40 },
      angle: { min: 260, max: 280 },         // generally upward
      scale: { start: 0.8, end: 0.1 },
      alpha: { start: 0.15, end: 0 },
      blendMode: Phaser.BlendModes.ADD
    });
    this._setEmitterDepth(this.fx.ambient, -5);

    // Groups / containers
    this.platforms = this.physics.add.staticGroup();


    // Ground Y where platforms sit — center the playfield vertically
    const PLAYER_H = 150;   // you set this for player display height

    this.groundY = Math.floor(H / 2 + (PLAYER_H / 2));

    // Create first platform (fixed)
    this.currentPlatform = this._spawnPlatform(
      Math.floor(W * 0.18), // center x
      this.groundY,
      Phaser.Math.Between(180, 260) // width
    );

    // Create next platform (random distance & width)
    this.nextPlatform = this._spawnNextPlatform();

    // Perfect zone indicator on next platform (thin bar)
    this.perfectZone = this.add.rectangle(
      this.nextPlatform.x,
      this.groundY - this.nextPlatform.displayHeight / 2 + 1,
      Math.max(18, Math.floor(this.nextPlatform.displayWidth * 0.18)),
      6,
      0xff2233,
      0.7
    ).setOrigin(0.5, 1);

    // Player
    const playerKey = (cfg.images1 && cfg.images1.player) ? 'player' : 'obj1';
    this.player = this.add.sprite(
      this.currentPlatform.getCenter().x - this.currentPlatform.displayWidth / 2 + 36,
      this.groundY - 36,
      playerKey
    ).setOrigin(0.5, 1);
    this.player.setDisplaySize(150, 150);
    this.physics.add.existing(this.player);
    this.player.body.setAllowGravity(false);
    this.player.body.setSize(100, 100);

    // Breathing effect: gentle chest rise + tiny width change
    this.breathTween = this.tweens.add({
      targets: this.player,
      scaleY: { from: 0.3, to: 0.35 },   // rise ~5%
      scaleX: { from: 0.3, to: 0.35 },   // slight chest expansion
      duration: 1400,
      ease: 'Sine.InOut',
      yoyo: true,
      repeat: -1
    });


    // Score HUD (cool pill + shine)
    this._createScoreHud();
    // this._updateScoreText(false);

    // this._scorePill.setDepth(990);
    if (this.fx.shine) this.fx.shine.setDepth(995);
    this.scoreText.setDepth(1000);
    this.children.bringToTop(this.scoreText);

    // Stick (created when player presses)
    this.stick = null;
    this.isGrowing = false;
    this.growTimer = 0;
    this.inMotion = false;

    // Input
    this.input.on('pointerdown', this._onPointerDown, this);
    this.input.on('pointerup', this._onPointerUp, this);

    // Audio
    const aud = cfg.audio || {};
    this.bgm = aud.bgm ? this.sound.add('bgm', { loop: true, volume: 0.5 }) : null;
    if (this.bgm) this.bgm.play();

    this.sfx = {
      collect: aud.collect ? this.sound.add('collect', { volume: 1, loop: false }) : null
    };

    // Cache gameplay knobs
    const ts = gp.targetScore;
    const parsedTS = Number(ts);
    this.targetScore = Number.isFinite(parsedTS) && parsedTS > 0 ? parsedTS : 100;
    this.walkSpeed = gp.playerWalkSpeed || 420; // px/sec along X
    this.rotateTime = gp.stickRotateMs || 320;
    this.scrollTime = gp.scrollMs || 420;
    this.growRate = gp.stickGrowRate || 900; // px/sec
    this.perfectBonus = gp.perfectBonus || 2;

    this._updateScoreText(false);

    // HUD tip (optional visual guide line)
    this.add.line(0, 0, 0, this.groundY + 2, W, this.groundY + 2, 0xffffff, 0.08).setOrigin(0, 0);
  }

  update(time, delta) {
    if (this.isGrowing && this.stick && !this.inMotion) {
      const growBy = (this.growRate * delta) / 1000;
      this.stick.displayHeight += growBy;
      this._syncStickBodyToDisplay();
    }
  }

  // ===== Input =====
  _onPointerDown() {
    if (this.inMotion) return;
    if (this.isGrowing) return;

    const STICK_BASE_Y_OFFSET = -15;

    // Create a new stick at the right edge of current platform
    const baseX = this.currentPlatform.getCenter().x + this.currentPlatform.displayWidth / 2;
    const baseY = this.groundY - this.currentPlatform.displayHeight / 2 + STICK_BASE_Y_OFFSET;

    // if (this.stick) this.stick.destroy();
    // this.stick = this.add.rectangle(baseX, baseY, 6, 8, 0x111111)
    //   .setOrigin(0.5, 1)
    //   .setAngle(0);
    // this.physics.add.existing(this.stick);
    // this.stick.body.setAllowGravity(false);
    // this._syncStickBodyToDisplay();

    if (this.stickGlow) { this.stickGlow.destroy(); this.stickGlow = null; }
    if (this.stick) { this.stick.destroy(); this.stick = null; }

    // Neon stick (sprite) + soft glow overlay
    this.stick = this.add.image(baseX, baseY, 'stick_grad')
      .setOrigin(0.5, 1)
      .setAngle(0);
    this.stick.setDisplaySize(10, 8); // width ~10, height grows
    this.physics.add.existing(this.stick);
    this.stick.body.setAllowGravity(false);
    this._syncStickBodyToDisplay();

    this.stickGlow = this.add.image(baseX, baseY, 'stick_glow')
      .setOrigin(0.5, 1)
      .setAngle(0)
      .setAlpha(0.35)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.stickGlow.setDisplaySize(34, 20); // wider than stick, slightly taller

    // Subtle pulse while growing
    this.tweens.add({
      targets: this.stickGlow,
      alpha: { from: 0.22, to: 0.42 },
      duration: 520,
      ease: 'Sine.InOut',
      yoyo: true,
      repeat: -1
    });

    this.isGrowing = true;
    this.growTimer = 0;
    if (this.sfx.grow) this.sfx.grow.play({ loop: true });
  }

  _onPointerUp() {
    if (!this.isGrowing || this.inMotion) return;

    this.isGrowing = false;
    if (this.sfx.grow) this.sfx.grow.stop();
    if (!this.stick) return;

    // Rotate stick down
    if (this.sfx.drop) this.sfx.drop.play();
    this.inMotion = true;

    // Dust puff right as it starts to rotate
    this._emitDust(this.stick.x, this.stick.y);

    if (this.stickGlow) {
      this.tweens.add({
        targets: this.stickGlow,
        alpha: { from: this.stickGlow.alpha, to: 0.65 },
        duration: 160,
        ease: 'Quad.Out',
        yoyo: true
      });
    }

    this.tweens.add({
      targets: this.stick,
      angle: 90,
      duration: this.rotateTime,
      ease: 'Sine.Out',
      onUpdate: () => this._syncStickBodyToDisplay(),
      onComplete: () => this._afterStickDropped()
    });
  }

  // ===== Core flow =====
  _afterStickDropped() {
    // Measure whether stick reaches next platform
    const fromX = this.currentPlatform.getCenter().x + this.currentPlatform.displayWidth / 2;
    const stickLen = this.stick.displayHeight; // since it rotated, height equals length
    const toXLeft = this.nextPlatform.getCenter().x - this.nextPlatform.displayWidth / 2;
    const toXRight = this.nextPlatform.getCenter().x + this.nextPlatform.displayWidth / 2;

    const endpointX = fromX + stickLen;
    const success = (endpointX >= toXLeft) && (endpointX <= toXRight);

    // Walk distance: to the end of stick (or as far as we can)
    const walkToX = fromX + Math.min(stickLen, toXRight + 12 - fromX);
    const walkTime = Math.max(140, Math.abs(walkToX - this.player.x) * 1000 / this.walkSpeed);

    this.tweens.add({
      targets: this.player,
      x: walkToX,
      duration: walkTime,
      ease: 'Linear',
      onUpdate: () => { if (this.sfx.step && !this.sfx.step.isPlaying) this.sfx.step.play(); },
      onComplete: () => {
        if (success) {
          // Perfect zone bonus?
          const pzLeft = this.perfectZone.x - this.perfectZone.width / 2;
          const pzRight = this.perfectZone.x + this.perfectZone.width / 2;
          const tipX = fromX + this.stick.displayHeight; // end of stick
          const perfect = tipX >= pzLeft && tipX <= pzRight;

          this.score += 2 + (perfect ? this.perfectBonus : 0);
          if (this.sfx.collect) { this.sfx.collect.stop(); this.sfx.collect.play(); } // one-shot, no loop
          this._updateScoreText(perfect);

          // Instant win when reaching target score
          if (this.targetScore > 0 && this.score >= this.targetScore) {
            if (this.bgm) this.bgm.stop();
            this.scene.start('WinScene');
            return; // prevent further movement tweens
          }

          if (perfect) {
            this._flashPerfect(this.perfectZone.x, this.groundY - this.nextPlatform.displayHeight / 2);
            if (this.sfx.perfect) this.sfx.perfect.play();
          }

          // Move player to center of next platform edge
          // const finalX = this.nextPlatform.getCenter().x - this.nextPlatform.displayWidth / 2 + 36;
          // const time = Math.max(120, Math.abs(finalX - this.player.x) * 1000 / this.walkSpeed);

          // this.tweens.add({
          //   targets: this.player,
          //   x: finalX,
          //   duration: time,
          //   ease: 'Linear',
          //   onComplete: () => this._advanceWorld()
          // });
          this._advanceWorld();
        } else {
          // Fall animation
          this._failFall();
        }
      }
    });
  }

  _advanceWorld() {
    const W = this.scale.width;
    const startX = Math.floor(W * 0.18);
    const dx = startX - this.nextPlatform.getCenter().x;

    const toTween = [this.player, this.currentPlatform, this.nextPlatform, this.perfectZone];
    if (this.stick) toTween.push(this.stick);
    if (this.stickGlow) toTween.push(this.stickGlow);

    this.tweens.add({
      targets: toTween,
      x: `+=${dx}`,
      duration: this.scrollTime,
      ease: 'Sine.InOut',
      onComplete: () => {
        // Cleanup old platform
        this.currentPlatform.destroy();
        if (this.stick) { this.stick.destroy(); this.stick = null; }
        if (this.stickGlow) { this.stickGlow.destroy(); this.stickGlow = null; }

        // Promote next->current
        this.currentPlatform = this.nextPlatform;

        // Spawn new next platform and perfect zone
        this.nextPlatform = this._spawnNextPlatform();
        this.perfectZone.setPosition(
          this.nextPlatform.getCenter().x,
          this.groundY - this.nextPlatform.displayHeight / 2 + 1
        );
        this.perfectZone.width = Math.max(18, Math.floor(this.nextPlatform.displayWidth * 0.18));

        this.inMotion = false;

        // Optional win check (if targetScore set)
        if (this.targetScore > 0 && this.score >= this.targetScore) {
          if (this.bgm) this.bgm.stop();
          this.scene.start('WinScene');
        }
      }
    });
  }

  _failFall() {
    if (this.sfx.fail) this.sfx.fail.play();
    this.cameras.main.shake(250, 0.01);

    this.tweens.add({
      targets: this.player,
      y: this.scale.height + 200,
      duration: 600,
      ease: 'Quad.In',
      onComplete: () => {
        if (this.sfx.gameover) this.sfx.gameover.play();
        if (this.bgm) this.bgm.stop();
        this.scene.start('GameOverScene');
      }
    });
  }

  // ===== Spawning helpers =====
  _spawnPlatform(centerX, centerY, width) {
    // Use platform image; resize to (width x 40)
    const plat = this.add.sprite(centerX, centerY, 'platform')
      .setOrigin(0.5, 1);
    const h = 40;
    plat.setDisplaySize(width, h);
    this.physics.add.existing(plat, true); // static
    plat.body.setSize(width, h);
    return plat;
  }

  _pickNextPlatformParams() {
    const W = this.scale.width;
    const s = this.score || 0;                          // difficulty ramps with score
    const prevW = this.currentPlatform.displayWidth;    // for “same-ish” cases

    // --- Width window tightens as score goes up (tends smaller, trickier) ---
    // Start wide, drift smaller (but keep sane bounds)
    let minW = 100, maxW = 300;
    minW = Phaser.Math.Clamp(140 - Math.min(s * 1.2, 60), 80, 160); // 140 -> 80
    maxW = Phaser.Math.Clamp(300 - Math.min(s * 2.0, 120), 180, 300); // 300 -> 180

    // --- Gap range grows with score (farther platforms later) ---
    let gapMin = 120, gapMax = Math.max(220, Math.floor(W * 0.35));
    gapMin += Math.min(s * 1.8, 160); // up to +160
    gapMax += Math.min(s * 2.2, 240); // up to +240

    // --- Choose width mode: same-ish / smaller / larger ---
    const r = Math.random();
    let width;
    if (r < 0.28) { // ~28%: same-ish
      width = Phaser.Math.Clamp(prevW + Phaser.Math.Between(-20, 20), minW, maxW);
    } else if (r < 0.64) { // ~36%: smaller
      width = Phaser.Math.Clamp(prevW - Phaser.Math.Between(20, 80), minW, maxW);
    } else { // ~36%: larger
      width = Phaser.Math.Clamp(prevW + Phaser.Math.Between(20, 80), minW, maxW);
    }

    // --- Choose gap bucket: short/normal/long, with increasing chance of long as score rises ---
    const rg = Math.random();
    const a = gapMin, b = gapMax, mid = (a + b) * 0.5;
    let gap;
    if (rg < 0.20) {
      gap = Phaser.Math.Between(a, Math.floor(Phaser.Math.Linear(a, b, 0.55))); // short-normal
    } else if (rg < 0.75) {
      gap = Phaser.Math.Between(Math.floor(Phaser.Math.Linear(a, b, 0.45)), Math.floor(Phaser.Math.Linear(a, b, 0.80))); // normal
    } else {
      gap = Phaser.Math.Between(Math.floor(Phaser.Math.Linear(a, b, 0.75)), b); // long/trickier
    }

    // --- Rare “micro” challenge: very narrow + slightly longer gap (probability rises modestly) ---
    if (Math.random() < Math.min(0.05 + s * 0.0008, 0.12)) {
      width = Phaser.Math.Clamp(width * Phaser.Math.FloatBetween(0.45, 0.7), minW, maxW);
      gap = Phaser.Math.Clamp(Math.round(gap * Phaser.Math.FloatBetween(1.1, 1.3)), gapMin, gapMax);
    }

    return { width: Math.round(width), gap: Math.round(gap) };
  }


  _spawnNextPlatform() {
    const { width, gap } = this._pickNextPlatformParams();
    const baseX =
      this.currentPlatform.getCenter().x +
      this.currentPlatform.displayWidth / 2 +
      gap + width / 2;

    return this._spawnPlatform(baseX, this.groundY, width);
  }


  // ===== HUD & FX helpers =====
  _createScoreHud() {
    const cfg = this.registry.get('cfg') || {};
    const W = this.scale.width;

    // // Rounded pill behind score
    // const g = this.add.graphics().setDepth(19);
    // const pillW = 360;
    // const pillH = 72;
    // const radius = 36;
    // g.fillStyle(0x000000, 0.35);
    // g.fillRoundedRect((W - pillW) / 2, 60, pillW, pillH, radius);
    // // subtle border
    // g.lineStyle(2, 0xffffff, 0.15);
    // g.strokeRoundedRect((W - pillW) / 2, 60, pillW, pillH, radius);
    // this._scorePill = g;

    // Score text

    const img = this.add.image(540, 100, 'scoreback')
    const scoreLabel = (cfg.texts && cfg.texts.score_label) ? cfg.texts.score_label : 'Score: ';
    this.scoreText = this.add.text(W / 2, 96, `${scoreLabel}0`, {
      fontFamily: (cfg.font && cfg.font.family) ? cfg.font.family : 'sans-serif',
      fontSize: '46px',
      color: '#050101ff',

    })
      .setOrigin(0.5)
      .setDepth(20)
      .setShadow(0, 3, '#000000', 6, true, true);

    // Shiny sweep over the pill
    // const shine = this.add.rectangle((W ) / 2 - 40, 60  / 2, 80,  10, 0xffffff, 0.12)
    //   .setAngle(20)
    //   .setDepth(20)
    //   .setOrigin(0.5);
    // this.fx.shine = shine;

    // this.tweens.add({
    //   targets: shine,
    //   x: (W ) / 2 + 40,
    //   duration: 1800,
    //   ease: 'Sine.InOut',
    //   yoyo: false,
    //   repeat: -1,
    //   delay: 300
    // });
  }

  _updateScoreText(perfect = false) {
    const cfg = this.registry.get('cfg') || {};
    const label = (cfg.texts && cfg.texts.score_label) ? cfg.texts.score_label : 'Score: ';
    const hasTarget = Number.isFinite(this.targetScore) && this.targetScore > 0;
    const text = hasTarget ? `${label}${this.score} / ${this.targetScore}` : `${label}${this.score}`;
    this.scoreText.setText(text);

    // Pop tween on score change
    this.tweens.killTweensOf(this.scoreText);
    this.scoreText.setScale(1);
    this.tweens.add({
      targets: this.scoreText,
      scale: 1.18,
      duration: 110,
      ease: 'Quad.Out',
      yoyo: true
    });

    // Brief tint if perfect
    if (perfect) {
      this.scoreText.setTint(0xffe066);
      this.time.delayedCall(180, () => this.scoreText.clearTint());
    }
  }

  _flashPerfect(x, y) {
    // Expanding ring (drawn)
    const ring = this.add.graphics().setDepth(15);
    const drawRing = (alpha, radius) => {
      ring.clear();
      ring.lineStyle(6, 0xffe066, alpha);
      ring.strokeCircle(x, y, radius);
    };
    drawRing(1, 10);
    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 420,
      ease: 'Cubic.Out',
      onUpdate: (t) => {
        const v = t.getValue();
        drawRing(1 - v, 10 + v * 90);
      },
      onComplete: () => ring.destroy()
    });

    // Spark burst (API-safe)
    const em = this._makeEmitter('fx_spark', x, y - 6, {
      lifespan: 600,
      speed: { min: 80, max: 220 },
      angle: { min: 220, max: 320 },
      gravityY: 300,
      quantity: 24,
      scale: { start: 0.8, end: 0 },
      alpha: { start: 1, end: 0 },
      blendMode: Phaser.BlendModes.ADD
    }, 16);
    this._explode(em, 24, x, y - 6);
    this.time.delayedCall(620, () => this._destroyEmitter(em));
  }

  _emitDust(x, y) {
    const em = this._makeEmitter('fx_dot', x, y, {
      lifespan: 420,
      speed: { min: 40, max: 120 },
      angle: { min: 200, max: 340 },
      gravityY: 200,
      quantity: 8,
      scale: { start: 0.5, end: 0 },
      alpha: { start: 0.5, end: 0 },
      blendMode: Phaser.BlendModes.NORMAL
    }, 5);
    this._explode(em, 10, x, y);
    this.time.delayedCall(460, () => this._destroyEmitter(em));
  }

  _makeParticleTextures() {
    // dot
    if (!this.textures.exists('fx_dot')) {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      g.fillStyle(0xffffff, 1);
      g.fillCircle(8, 8, 8);
      g.generateTexture('fx_dot', 16, 16);
      g.destroy();
    }
    // spark (diamond)
    if (!this.textures.exists('fx_spark')) {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      g.fillStyle(0xffe066, 1);
      g.beginPath();
      g.moveTo(8, 0);
      g.lineTo(16, 8);
      g.lineTo(8, 16);
      g.lineTo(0, 8);
      g.closePath();
      g.fillPath();
      g.generateTexture('fx_spark', 16, 16);
      g.destroy();
    }
  }

  _makeStickTextures() {
    // Tall base for dynamic resizing (we'll scale height at runtime)
    const texW = 24, texH = 1024;

    // === stick_grad (neon vertical band with faux gradient) ===
    if (!this.textures.exists('stick_grad')) {
      const g = this.make.graphics({ x: 0, y: 0, add: false });

      // Background rounded rect (dark body)
      g.fillStyle(0x141414, 1);
      g.fillRoundedRect(0, 0, texW, texH, 12);

      // "Gradient" stripes (bright center, darker edges)
      // We fake a gradient by drawing multiple thin rects with varying alpha
      for (let i = 0; i < texW; i++) {
        const t = i / (texW - 1);                 // 0..1 across width
        const edge = Math.abs(t - 0.5) * 2;       // 1 at edges, 0 center
        const c = Phaser.Display.Color.Interpolate.ColorWithColor(
          new Phaser.Display.Color(0, 40, 80),   // hot pink
          new Phaser.Display.Color(0, 0, 0),  // cyan
          texW, i
        );
        const col = Phaser.Display.Color.GetColor(c.r, c.g, c.b);
        const alpha = 0.28 + (1 - edge) * 0.32;   // brighter near center
        g.fillStyle(col, alpha);
        g.fillRect(i, 0, 1, texH);
      }

      // Thin white core line for extra punch
      g.fillStyle(0xffffff, 0.25);
      g.fillRect(Math.floor(texW * 0.5) - 1, 0, 2, texH);

      g.generateTexture('stick_grad', texW, texH);
      g.destroy();
    }

    // === stick_glow (soft outer bloom) ===
    if (!this.textures.exists('stick_glow')) {
      const gw = 64, gh = 1024;
      const g = this.make.graphics({ x: 0, y: 0, add: false });

      // Soft colored glow columns (additive look later via blendMode)
      for (let i = 0; i < gw; i++) {
        const t = i / (gw - 1);
        const d = Math.abs(t - 0.5) * 2;          // distance from center 0..1
        const alpha = Math.max(0, 0.35 - d * 0.35);
        const col = Phaser.Display.Color.GetColor(255, 120, 200);
        g.fillStyle(col, alpha);
        g.fillRect(i, 0, 1, gh);
      }

      g.generateTexture('stick_glow', gw, gh);
      g.destroy();
    }
  }


  // ===== Particle compatibility helpers (Phaser 3.x old/new) =====
  _makeEmitter(key, x, y, config, depth = 0) {
    // Try new API first: this.add.particles(x, y, key, config) -> emitter
    try {
      const em = this.add.particles(x, y, key, { ...config });
      this._setEmitterDepth(em, depth);
      return em;
    } catch (e) {
      // Fallback to old API: manager + createEmitter
      const mgr = this.add.particles(key);
      if (typeof mgr.setDepth === 'function') mgr.setDepth(depth);
      const em = mgr.createEmitter({ x, y, ...config });
      return em;
    }
  }

  _explode(emitter, count, x, y) {
    if (!emitter) return;
    if (typeof emitter.explode === 'function') {
      emitter.explode(count, x, y);
    } else if (typeof emitter.emitParticleAt === 'function') {
      emitter.emitParticleAt(x, y, count);
    }
  }

  _setEmitterDepth(emitter, depth) {
    if (!emitter) return;
    if (typeof emitter.setDepth === 'function') {
      emitter.setDepth(depth);
    } else if (emitter.manager && typeof emitter.manager.setDepth === 'function') {
      emitter.manager.setDepth(depth);
    }
  }

  _destroyEmitter(emitter) {
    if (!emitter) return;
    // New API returns an emitter (auto-managed), old API returns emitter attached to a manager
    if (emitter.manager && emitter.manager.destroy) {
      emitter.manager.destroy();
    } else if (emitter.remove) {
      emitter.remove(); // some builds
    } else if (emitter.on) {
      // no-op; GC will handle
    }
  }

  // ===== Utilities =====
  _syncStickBodyToDisplay() {
    if (!this.stick || !this.stick.body) return;
    const w = Math.max(6, Math.floor(this.stick.width * Math.abs(this.stick.scaleX || 1)));
    const h = Math.max(8, Math.floor(this.stick.displayHeight));
    this.stick.body.setSize(w, h);
    this.stick.body.setOffset(-w / 2, -h); // origin (0.5,1)

    if (this.stickGlow) {
      this.stickGlow.x = this.stick.x;
      this.stickGlow.y = this.stick.y;
      this.stickGlow.angle = this.stick.angle;
      // Make glow slightly taller than stick
      const glowW = Math.max(24, Math.floor(w * 3.4));
      const glowH = Math.max(h + 16, 24);
      this.stickGlow.setDisplaySize(glowW, glowH);
    }
  }
}
