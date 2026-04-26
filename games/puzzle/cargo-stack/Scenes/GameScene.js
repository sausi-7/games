class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  // --- PRELOAD: ASSET LOADING & FALLBACKS ---
  preload() {
    // Pull config (and guard with sane defaults)
    this.cfg = this.registry.get('cfg') || {};
    const images = this.cfg.images1 || {};
    const images2 = this.cfg.images2 || {};
    const ui = this.cfg.ui || {};
    const audio = this.cfg.audio || {};
    const font = this.cfg.font || {};
    this.gameplay = this.cfg.gameplay || { gravity: 800, winStackCount: 5, loseMissCount: 3, minOverlapFraction: 0.55 };
    this.texts = this.cfg.texts || { score_label: 'Stacked:', missed_label: 'Missed:', target_label: 'Target:' };


    // Load images listed in cfg.images (e.g., background, crane, cargo, platform, action, etc.)
    Object.entries(images).forEach(([key, url]) => {
      if (url) this.load.image(key, url);
    });
    Object.entries(images2).forEach(([key, url]) => {
      if (url) this.load.image(key, url);
    });
    Object.entries(ui).forEach(([key, url]) => {
      if (url) this.load.image(key, url);
    });

    // Load audio if provided
    if (audio.bgm) this.load.audio('bgm', audio.bgm);
    if (audio.drop) this.load.audio('drop', audio.drop);
    if (audio.land) this.load.audio('land', audio.land);
    if (audio.miss) this.load.audio('miss', audio.miss);
    if (audio.win) this.load.audio('win', audio.win);
    if (audio.lose) this.load.audio('lose', audio.lose);

    // Optional: load webfont via helper on window (defined in your HTML)
    if (font.family && font.url && typeof window.loadFont === 'function') {
      window.loadFont(font.family, font.url);
    }

    // Safety net: log load errors
    this.load.on('loaderror', (file) => {
      console.warn(`Load error for key "${file.key}" (${file.src}). Will use a fallback at runtime if referenced.`);
    });
  }

  createFallbackTexture(key) {
    if (this.textures.exists(key)) return;
    const size = 128;
    const canvas = this.textures.createCanvas(key, size, size);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ff00ff';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#000000';
    ctx.font = '16px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(key, size / 2, size / 2);
    canvas.refresh();
  }

  // --- CREATE: GAME SETUP ---
  create() {
    this.isGameOver = false;
    this.stackedCount = 0;
    this.missedCount = 0;

    // Stacking rules (moderate difficulty)
    this.lastTopCargo = null;
    this.minOverlapFraction = (this.cfg?.gameplay?.minOverlapFraction ?? 0.55); // 55% default
    this.overlapForgivenessPx = 6; // small forgiveness so it's not too punishing

    // Background (image if available, otherwise a sky fill)
    if (this.textures.exists('background')) {
      this.add.image(0, 0, 'background')
        .setOrigin(0, 0)
        .setDisplaySize(this.scale.width, this.scale.height);
    } else {
      const g = this.add.graphics().setDepth(-10);
      g.fillStyle(0x4682B4, 1);
      g.fillRect(0, 0, this.scale.width, this.scale.height);
    }

    // Physics Groups
    this.platforms = this.physics.add.staticGroup(); // ground only
    // IMPORTANT: stacked cargo must be dynamic bodies (immovable) — not staticGroup
    this.stackedCargo = this.physics.add.group({ immovable: true, allowGravity: false });
    this.fallingCargo = this.physics.add.group();

    // Initial setup
    this.createBottomPlatform();
    this.createUI();
    this.createCraneAndCargo();
    this.setupInputs();
    this.playMusic();
    this._buildFXLayer();


    // Visual helpers
    this.validZoneGfx = this.add.graphics().setDepth(5);
    this.guideGfx = this.add.graphics().setDepth(5);

    // Listen for scene shutdown to clean up
    this.events.on('shutdown', this.shutdown, this);
  }

  // --- UPDATE: GAME LOOP ---
  update() {
    if (this.isGameOver) return;

    // Crane and attached cargo movement
    if (this.crane && this.cargo) {
      this.cargo.x = this.crane.x;
    }

    // Check for missed cargo that fell offscreen
    this.fallingCargo.getChildren().forEach(cargo => {
      if (cargo.y > this.scale.height + cargo.displayHeight) {
        this.handleMiss(cargo);
      }
    });

    // ---- Visual aids for clarity ----
    this.validZoneGfx.clear();
    this.guideGfx.clear();

    // Vertical guide line from cargo down to the top surface (or ground if first piece)
    if (this.cargo) {
      this.guideGfx.lineStyle(3, 0xffffff, 0.5);
      this.guideGfx.beginPath();
      this.guideGfx.moveTo(this.cargo.x, this.cargo.y + this.cargo.displayHeight * 0.5);
      const toY = this.lastTopCargo ? this.lastTopCargo.getBounds().top : (this.scale.height - 100);
      this.guideGfx.lineTo(this.cargo.x, toY);
      this.guideGfx.strokePath();
      this.guideGfx.closePath();
    }

    // Valid landing zone band (required overlap width) on current top block
    if (this.lastTopCargo) {
      const topB = this.lastTopCargo.getBounds();
      const cargoW = this.cargo ? (this.cargo.displayWidth || this.cargo.width) : (this.lastTopCargo.displayWidth || this.lastTopCargo.width);
      const req = cargoW * this.minOverlapFraction;

      const zoneX = topB.centerX - req / 2;
      const zoneY = topB.top - 4;  // thin band just above top surface
      const zoneH = 8;

      this.validZoneGfx.fillStyle(0x00ff88, 0.25).fillRect(zoneX, zoneY, req, zoneH);
      this.validZoneGfx.lineStyle(2, 0x00ff88, 0.9).strokeRect(zoneX, zoneY, req, zoneH);
    }
  }

  // --- UTILITIES FOR STACK/MISS ---
  _overlappingWidth(a, b) {
    const A = a.getBounds();
    const B = b.getBounds();
    const left = Math.max(A.left, B.left);
    const right = Math.min(A.right, B.right);
    return Math.max(0, right - left);
  }

  _matchBodyToDisplay(go) {
    // Ensure Arcade body matches the scaled display size
    if (go.body && go.displayWidth && go.displayHeight) {
      go.body.setSize(go.displayWidth, go.displayHeight, true); // true = center on origin
    }
  }

  _missCargo(cargo) {
    if (this.fallingCargo?.contains(cargo)) {
      this.fallingCargo.remove(cargo);
    }
    this.missedCount++;
    this.sound.play('miss');
    this.updateUI();

    // 🔥 Miss FX here
    this._onMissFX(cargo.x, cargo.y);

    cargo.setCollideWorldBounds(false);
    if (cargo.body) cargo.body.checkCollision.none = true;
    this.time.delayedCall(250, () => cargo.destroy());
    this.checkWinLoseConditions();
  }


  // --- GAME MECHANICS ---
  createCraneAndCargo() {
    if (this.isGameOver) return;

    const startX = 150;
    const craneY = 150;
    this.crane = this.add.sprite(startX, craneY, 'crane').setDisplaySize(100, 100);

    // Moderate sized cargo (not too thin, not too wide)
    const cargoW = 160;  // tuned size for "normal" difficulty
    const cargoH = 90;

    this.cargo = this.physics.add.sprite(this.crane.x, this.crane.y + 75, 'cargo').setDisplaySize(cargoW, cargoH);
    this.cargo.body.setAllowGravity(false);
    this._matchBodyToDisplay(this.cargo); // crucial: body size == display size

    // Crane movement tween
    this.craneTween = this.tweens.add({
      targets: this.crane,
      x: this.scale.width - 150,
      ease: 'Sine.easeInOut',
      duration: 2000,
      yoyo: true,
      repeat: -1
    });
  }

  dropCargo() {
    if (this.isGameOver || !this.cargo) return;

    this.sound.play('drop', { volume: 0.7 });

    const cargoToDrop = this.cargo;
    this.cargo = null;

    cargoToDrop.body.setAllowGravity(true);
    this.physics.world.gravity.y = this.cfg.gameplay.gravity || 800;
    this._matchBodyToDisplay(cargoToDrop); // keep sizes correct when it starts falling
    this.fallingCargo.add(cargoToDrop);

    // Setup collisions for the newly dropped cargo
    this.physics.add.collider(cargoToDrop, this.platforms, this.handleLanding, null, this);
    this.physics.add.collider(cargoToDrop, this.stackedCargo, this.handleLanding, null, this);

    // Create the next crane and cargo after a short delay
    this.time.delayedCall(500, this.createCraneAndCargo, [], this);
  }

  handleLanding(cargo, landingSurface) {
    // Only proceed on true "touching down" this frame
    if (!cargo.body.touching.down && !cargo.body.blocked.down) return;

    // If the first piece hasn't been placed yet:
    if (!this.lastTopCargo) {
      // Only allow the first piece to land on the ground (platform)
      if (landingSurface?.texture?.key === 'platform') {
        if (this.fallingCargo.contains(cargo)) this.fallingCargo.remove(cargo);

        // Add to stacked group as immovable dynamic body
        this.stackedCargo.add(cargo);
        cargo.body.setAllowGravity(false);
        cargo.body.setVelocity(0, 0);
        cargo.body.immovable = true;
        this._matchBodyToDisplay(cargo);

        this.lastTopCargo = cargo;
        this.stackedCount++;
        this.sound.play('land', { volume: 0.8 });
        this.updateUI();
        this.checkWinLoseConditions();
        return;
      } else {
        // Hit something else before ground — treat as miss
        this._missCargo(cargo);
        return;
      }
    }

    // From the 2nd piece onward:
    if (landingSurface?.texture?.key === 'platform') {
      // It reached the ground again after we already have a stack -> MISS
      this._missCargo(cargo);
      return;
    }

    // Must overlap sufficiently with the current top cargo to count as stacked
    const overlap = this._overlappingWidth(cargo, this.lastTopCargo);
    const required = ((cargo.displayWidth || cargo.width) * this.minOverlapFraction) - this.overlapForgivenessPx;

    if (overlap >= required) {
      // Good stack
      if (this.fallingCargo.contains(cargo)) this.fallingCargo.remove(cargo);

      // Add to stacked group as immovable dynamic body
      this.stackedCargo.add(cargo);
      cargo.body.setAllowGravity(false);
      cargo.body.setVelocity(0, 0);
      cargo.body.immovable = true;
      this._matchBodyToDisplay(cargo);

      this.lastTopCargo = cargo;
      this.stackedCount++;
      this.sound.play('land', { volume: 0.8 });
      this.updateUI();
      this.checkWinLoseConditions();
    } else {
      // Not enough overlap -> MISS
      this._missCargo(cargo);
    }
  }

  handleMiss(cargo) {
    this.missedCount++;
    this.sound.play('miss');
    this.updateUI();

    // 🔥 Miss FX here
    this._onMissFX(cargo.x, cargo.y);

    cargo.destroy();
    this.checkWinLoseConditions();
  }


  checkWinLoseConditions() {
    if (this.isGameOver) return;
    if (this.stackedCount >= this.cfg.gameplay.winStackCount) {
      this.gameOver(true);
    } else if (this.missedCount >= this.cfg.gameplay.loseMissCount) {
      this.gameOver(false);
    }
  }

  gameOver(isWin) {
    this.isGameOver = true;
    this.sound.stopAll();
    if (this.craneTween) this.craneTween.stop();

    if (this.validZoneGfx) this.validZoneGfx.clear();
    if (this.guideGfx) this.guideGfx.clear();

    this.sound.play(isWin ? 'win' : 'lose');

    this.time.delayedCall(1200, () => {
      this.scene.start(isWin ? 'WinScene' : 'GameOverScene');
    }, [], this);
  }

  // --- SETUP & UTILITIES ---
  createBottomPlatform() {
    const ground = this.platforms.create(this.scale.width / 2, this.scale.height - 50, 'platform');
    ground.setDisplaySize(this.scale.width * 1.5, 100).refreshBody();
  }

  createUI() {
    const fontFamily = (this.cfg.font && this.cfg.font.family) || 'Bangers, Impact, Arial Black, system-ui, sans-serif';

    // smaller, cleaner HUD style
    this._hudBaseStyle = {
      fontFamily,
      fontSize: '44px',      // was 64px
      color: '#ffe56b',
      stroke: '#2a2139',
      strokeThickness: 8,    // was 10
      align: 'center'
    };

    // helper: make one HUD pill with auto-size + center alignment
    const makeHud = (x, y, text, minWidth = 280, height = 64, fill = 0x1f1532, alpha = 0.85) => { // was 420x86
      const cont = this.add.container(Math.round(x), Math.round(y)).setDepth(1000);

      const label = this.add.text(0, 0, text, this._hudBaseStyle)
        .setOrigin(0.5, 0.5)
        .setShadow(5, 5, '#000000', 7, true, true) // slightly lighter shadow
        .setResolution(2);

      const gfx = this.add.graphics();
      cont.add([gfx, label]);

      this._resizePill(gfx, label, minWidth, height, fill, alpha);
      return { cont, gfx, label, minWidth, height, fill, alpha };
    };

    // Safer top Y & side X positions
    const topY = 58;                     // was 70
    const sideX = 140;                   // was 220

    // TARGET (top center) — narrower so it doesn't touch side pills
    this._hudTarget = makeHud(
      this.scale.width / 2, topY,
      `${this.texts.target_label} ${this.cfg.gameplay.winStackCount}`,
      Math.min(this.scale.width * 0.5, 440),  // was ~0.6 width / 620
      64,
      0x241b3a, 0.9
    );

    // STACKED (left)
    this._hudStacked = makeHud(
      sideX, topY,
      `${this.texts.score_label} 0`,
      280, 64
    );

    // MISSED (right)
    this._hudMissed = makeHud(
      this.scale.width - sideX, topY,
      `${this.texts.missed_label} 0`,
      280, 64
    );

    // subtle idle shimmer
    this.tweens.add({
      targets: this._hudTarget.label,
      scale: { from: 1.0, to: 1.05 },
      duration: 1000,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });

    this.targetText = this._hudTarget.label;
    this.stackedText = this._hudStacked.label;
    this.missedText = this._hudMissed.label;
  }


  _resizePill(gfx, label, minWidth, height, fill, alpha) {
    const padX = 40; // was 56
    const desiredW = Math.max(minWidth, Math.ceil(label.width + padX));
    const desiredH = height;

    gfx.clear();
    gfx.fillStyle(fill, alpha);
    gfx.fillRoundedRect(-desiredW / 2, -desiredH / 2, desiredW, desiredH, 18); // slightly smaller radius
    gfx.lineStyle(3, 0x5c4ea3, 0.9); // thinner stroke
    gfx.strokeRoundedRect(-desiredW / 2, -desiredH / 2, desiredW, desiredH, 18);
  }



  updateUI() {
    this._prevStacked = this._prevStacked ?? 0;
    this._prevMissed = this._prevMissed ?? 0;

    const stackedChanged = this.stackedCount !== this._prevStacked;
    const missedChanged = this.missedCount !== this._prevMissed;

    // update labels
    this.stackedText.setText(`${this.texts.score_label} ${this.stackedCount}`);
    this.missedText.setText(`${this.texts.missed_label} ${this.missedCount}`);

    // re-size pills to match any new text width
    this._resizePill(this._hudStacked.gfx, this._hudStacked.label, this._hudStacked.minWidth, this._hudStacked.height, this._hudStacked.fill, this._hudStacked.alpha);
    this._resizePill(this._hudMissed.gfx, this._hudMissed.label, this._hudMissed.minWidth, this._hudMissed.height, this._hudMissed.fill, this._hudMissed.alpha);

    if (stackedChanged) {
      const diff = this.stackedCount - this._prevStacked;
      this._pulse(this.stackedText, 1.15);
      if (diff > 0) this._floatNumber(this._hudStacked.cont.x + 90, this._hudStacked.cont.y, `+${diff}`, 0x00ff99);
    }

    if (missedChanged) {
      const diff = this.missedCount - this._prevMissed;
      this._pulse(this.missedText, 1.12, 0xff6677);
      if (diff > 0) this._floatNumber(this._hudMissed.cont.x + 120, this._hudMissed.cont.y, `+${diff}`, 0xff5566);
    }

    this._prevStacked = this.stackedCount;
    this._prevMissed = this.missedCount;
  }

  _buildFXLayer() {
    // tiny white dot texture (once)
    if (!this.textures.exists('fxDot')) {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      g.fillStyle(0xffffff, 1);
      g.fillCircle(4, 4, 4);
      g.generateTexture('fxDot', 8, 8);
      g.destroy();
    }

    // simple sprite pool for "particles"
    this._fxPool = this._fxPool || [];
    this._fxActive = new Set(); // track active dots

    // prewarm a few (optional)
    for (let i = 0; i < 32; i++) {
      const s = this.add.image(-1000, -1000, 'fxDot').setVisible(false).setDepth(2500);
      this._fxPool.push(s);
    }

    // full-screen red flash
    this._missFlash = this.add.rectangle(
      this.scale.width / 2, this.scale.height / 2,
      this.scale.width, this.scale.height,
      0xff3344, 0
    ).setScrollFactor(0).setDepth(3000);

    // dim overlay
    this._missDim = this.add.rectangle(
      this.scale.width / 2, this.scale.height / 2,
      this.scale.width, this.scale.height,
      0x000000, 0
    ).setScrollFactor(0).setDepth(2999);
  }

  _burstDots(x, y, count = 24, tint = 0xff5566) {
    for (let i = 0; i < count; i++) {
      const s = this._fxPool.length ? this._fxPool.pop() : this.add.image(-1000, -1000, 'fxDot').setDepth(2500);
      this._fxActive.add(s);

      // random direction & power
      const ang = Phaser.Math.FloatBetween(Math.PI * 1.1, Math.PI * 1.9); // mostly downward fan
      const spd = Phaser.Math.Between(80, 320);
      const dx = Math.cos(ang) * spd;
      const dy = Math.sin(ang) * spd;

      s.setPosition(x, y)
        .setScale(Phaser.Math.FloatBetween(0.8, 1.2))
        .setAlpha(1)
        .setTint(tint)
        .setVisible(true);

      this.tweens.add({
        targets: s,
        x: x + dx,
        y: y + dy + 100,  // a bit of "gravity"
        alpha: 0,
        scale: 0,
        duration: Phaser.Math.Between(420, 580),
        ease: 'Cubic.Out',
        onComplete: () => {
          s.setVisible(false);
          this._fxActive.delete(s);
          this._fxPool.push(s);
        }
      });
    }
  }


  _pulse(label, maxScale = 1.12, tintHex = null) {
    if (!label) return;
    const oldTint = label.tintTopLeft;

    if (tintHex != null) label.setTint(tintHex);
    this.tweens.killTweensOf(label);
    this.tweens.add({
      targets: label,
      scale: maxScale,
      duration: 100,
      yoyo: true,
      ease: 'Back.Out',
      onComplete: () => {
        if (tintHex != null) label.clearTint();
        label.setScale(1);
      }
    });
  }

  _onMissFX(x, y) {
    // camera shake
    this.cameras.main.shake(160, 0.006);

    // brief slow-mo
    const restoreTS = this.time.timeScale;
    const restorePhys = this.physics.world.timeScale;
    this.time.timeScale = 0.6;
    this.physics.world.timeScale = 0.6;
    this.time.delayedCall(160, () => {
      this.time.timeScale = restoreTS;
      this.physics.world.timeScale = restorePhys;
    });

    // flash + dim
    this._missFlash.setAlpha(0.5);
    this._missDim.setAlpha(0.25);
    this.tweens.add({
      targets: [this._missFlash, this._missDim],
      alpha: 0,
      duration: 180,
      ease: 'Quad.Out'
    });

    // 🔁 replace emitter.explode(...) with our sprite burst:
    this._burstDots(x, y, 24, 0xff5566);
  }



  _floatNumber(x, y, txt, colorHex = 0xffffff) {
    const t = this.add.text(x, y, txt, {
      fontFamily: (this.cfg.font && this.cfg.font.family) || 'Bangers, Impact, Arial Black, sans-serif',
      fontSize: '48px',
      color: Phaser.Display.Color.IntegerToColor(colorHex).rgba,
      stroke: '#000000',
      strokeThickness: 8,
      align: 'center'
    })
      .setOrigin(0.5)
      .setShadow(4, 4, '#000', 6, true, true)
      .setDepth(2000)
      .setResolution(2);

    this.tweens.add({
      targets: t,
      y: y - 60,
      alpha: { from: 1, to: 0 },
      duration: 650,
      ease: 'Cubic.Out',
      onComplete: () => t.destroy()
    });
  }

  setupInputs() {
    this.input.on('pointerdown', this.dropCargo, this);
    this.input.keyboard.on('keydown-SPACE', this.dropCargo, this);

    // Mobile button if needed (simple version)
    if (!this.sys.game.device.os.desktop) {
      this.setupMobileControls();
    }
  }

  setupMobileControls() {
    // const actionBtn = this.add.sprite(this.scale.width / 2, this.scale.height - 180, '')
    //   .setDisplaySize(200, 200)
    //   .setInteractive()
    //   .setAlpha(0.7);

    // actionBtn.on('pointerdown', () => {
    //   actionBtn.setScale(0.9);
    //   actionBtn.setAlpha(1);
    // });
    // actionBtn.on('pointerup', () => {
    //   actionBtn.setScale(1);
    //   actionBtn.setAlpha(0.7);
    // });
  }

  playMusic() {
    this.bgm = this.sound.add('bgm', { loop: true, volume: 0.4 });
    this.bgm.play();
  }

  shutdown() {
    if (this.bgm) this.bgm.stop();
    if (this.craneTween) this.craneTween.stop();
    this.tweens.killAll();
    this.sound.stopAll();
    if (this.validZoneGfx) this.validZoneGfx.clear();
    if (this.guideGfx) this.guideGfx.clear();
  }
}
