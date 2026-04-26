export default class StickTossScene extends Phaser.Scene {
  constructor() {
    super({ key: 'StickTossScene' });
    Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach(fn => {
      if (typeof this[fn] === 'function') this[fn] = this[fn].bind(this);
    });
    this.sticks = [];
    this.score = 0;
    this.isThrowing = false;
    this.gameOver = false;
    this.gameState = 'start';
    this.bgm = null;

    // NEW: small helpers / state
    this.fx = { canFX: true };
    this._trailTimer = null;
    this._tapArmed = false; // prevents the Play tap from firing a stick

  }

  preload() {
    const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));
    this.load.json('levelConfig', `${basePath}/config.json`);
    this.load.once('filecomplete-json-levelConfig', () => {
      const cfg = this.cache.json.get('levelConfig');
      this.levelConfig = cfg;
      if (cfg.images1) for (const [key, url] of Object.entries(cfg.images1)) this.load.image(key, `${basePath}/${url}`);
      this.load.start();

      if (cfg.images2) for (const [key, url] of Object.entries(cfg.images2)) this.load.image(key, `${basePath}/${url}`);
      this.load.start();

      if (cfg.ui) for (const [key, url] of Object.entries(cfg.ui)) this.load.image(key, `${basePath}/${url}`);
      this.load.start();

      const audio = cfg.audio || {};
      if (cfg.audio) for (const [key, url] of Object.entries(audio)) {
        this.load.audio(key, url);
      }
    });

    // NEW: 1px white texture for spark/trail rectangles (no external asset)
    const rt = this.make.renderTexture({ width: 1, height: 1, add: false });
    rt.draw(this.add.rectangle(0, 0, 1, 1, 0xffffff, 1));
    rt.saveTexture('px1');
    rt.destroy();
  }

  create() {
    // Try enabling FX pipeline (Phaser 3.60+)
    this.fx.canFX = !!(this.sys.game.renderer && this.sys.game.renderer.pipelines && this.sys.game.renderer.pipelines.postFX);

    // Load config values
    const cfg = this.levelConfig;
    const orientation = cfg.orientation;
    const game = cfg.game;
    const colors = cfg.colors;
    const texts = cfg.texts;

    this.GAME_WIDTH = orientation.width;
    this.GAME_HEIGHT = orientation.height;
    this.RING_RADIUS = game.ringRadius;
    this.STICK_LENGTH = game.stickLength;
    this.STICK_WIDTH = game.stickWidth;
    this.MAX_STICKS = game.maxSticks;
    this.MIN_ANGLE_GAP = Phaser.Math.DegToRad(game.minAngleGapDeg);
    this.ringRotationSpeed = Phaser.Math.DegToRad(game.ringRotationSpeedDeg);
    this.THROW_SPEED = game.throwSpeed;
    this.RING_X = this.GAME_WIDTH / 2;
    this.RING_Y = this.GAME_HEIGHT / 2 + (game.ringYOffset || 0);

    this.sticks = [];
    this.score = 0;
    this.isThrowing = false;
    this.gameOver = false;
    this.gameState = 'start';

    if (this.bgm) { this.bgm.stop(); this.bgm.destroy(); this.bgm = null; }
    this.bgm = this.sound.add('bgm', { loop: true, volume: 1 });
    this.bgm.play();

    // Background
    this.add.image(540, 960, 'background').setDepth(0);

    // --- Main game objects (hidden initially) ---
    this.ring = this.createSprite('ring', this.RING_X, this.RING_Y, 'circle', 0xffffff, this.RING_RADIUS);
    this.ring.setDepth(1).setVisible(false);

    // NEW: subtle glow on ring
    this._addGlow(this.ring, 0x00eaff, 6, 0.7);

    // this.add.image(540, 70, 'scorebar');

    this.stickGroup = this.add.group();

    this.scorebar = this.add.image(this.GAME_WIDTH / 2, 70, 'scorebar')
      .setOrigin(0.5)
      .setScale(1.1,1)
      .setVisible(false);        // start hidden like scoreText

    this.scoreText = this.add.text(
      this.GAME_WIDTH / 2, 70,
      `${texts.score.toUpperCase()}: 0/${this.MAX_STICKS}`,
      {
        fontFamily: 'Outfit',
        fontSize: '50px',
        color: '#0f0808ff',
      }
    ).setOrigin(0.5).setVisible(false);


    // Input
    this.input.on('pointerdown', (pointer) => {
      if (!this._tapArmed) return; // ignore taps until armed
      if (!this.isThrowing && !this.gameOver && this.gameState === 'playing') {
        this.throwStick();
      }
    });

    // after: this.input.on('pointerdown', () => { ... });
    this.arrowSfx = this.sound.add('arrow', { volume: 0.9 });


    // Overlays
    this.createStartOverlay();
    this.createGameOverOverlay();
    this.createLevelCompleteOverlay();
    this.hideAllOverlays();
    this.showStart();
  }

  // --- Overlay helpers ---

  createStartOverlay() {
    const { GAME_WIDTH: w, GAME_HEIGHT: h, levelConfig } = this;
    const texts = levelConfig.texts;
    this.startOverlay = this.add.container(w / 2, h / 2);
    const bg = this.add.image(0, 0, 'start_overlay').setScale(0.55, 0.8);
    const htp = this.add.text(-210, -250, texts.htptext?.toUpperCase() || 'HOW TO PLAY', {
      fontFamily: 'Outfit',
      fontSize: `68px`,
    }).setDepth(1001);
    // NEW: cooler title + description
    const title = this._makeNeonText(0, -260, texts.title?.toUpperCase() || '', 68, '#ffffff', '#9aeb4f')
      .setOrigin(0.5);

    const desc = this._makeSoftText(
      -200, 0,
      "Tap to shoot:",
      60, '#eaf5ff'
    ).setOrigin(0.5);

    const desc1 = this._makeSoftText(
      -200, + 200,
      "Avoid hitting:",
      60, '#eaf5ff'
    ).setOrigin(0.5);


    const img = this.add.image(70, -20, 'ring').setScale(0.3);

    const img1 = this.add.image(+30, + 200, 'stick').setScale(1);

    const playLabel = this.add.image(0, 480, "button_play")
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    // NEW: button hover / press feedback
    this._addButtonFX(playLabel);

    playLabel.on('pointerdown', (pointer, lx, ly, event) => {
      event?.stopPropagation();                // ⛔ don't let this tap reach the global listener
      this.hideAllOverlays();
      this.startGame();
    });


    this.startOverlay.add([bg, htp, title, desc, desc1, img, img1, playLabel]);
    this.startOverlay.setDepth(1000).setVisible(false);
  }

  createGameOverOverlay() {
    const { GAME_WIDTH: w, GAME_HEIGHT: h, levelConfig } = this;
    const texts = levelConfig.texts;
    this.gameOverOverlay = this.add.container(w / 2, h / 2);
    // background image for game over (ovrbg)
    const bg = this.add.image(0, 0, 'ovrbg').setDepth(2);
    const panel = this.add.image(0, 0, 'gameover_overlay').setScale(0.5, 0.3);


    const overText1 = this.add.text(-200, -40, texts.ovrtext?.toUpperCase() || 'GAME OVER', {
      fontFamily: 'Outfit',
      fontSize: '68px',
      color: '#ffffff'
    })

    // const overText = this.add.text(-180, 30, texts.lose?.toUpperCase() || 'GAME OVER', {
    //   fontFamily: 'Outfit',
    //   fontSize: '58px',
    //   color: '#ffffff'
    // })

    const retryBtn = this.add.image(0, 250, 'button_retry').setInteractive({ useHandCursor: true });
    this._addButtonFX(retryBtn);

    const retryLabel = this._makeSoftText(0, 120, texts.retry?.toUpperCase() || '', 32, '#0b1220')
      .setOrigin(0.5);

    retryBtn.on('pointerdown', (pointer, lx, ly, event) => {
      event?.stopPropagation();
      this._restartBgm();               // 🔊 restart bgm
      this.hideAllOverlays();
      this.startGame();
    });
    this.gameOverOverlay.add([bg, panel,overText1, retryBtn, retryLabel]);
    this.gameOverOverlay.setDepth(1000).setVisible(false);
  }

  createLevelCompleteOverlay() {
    const { GAME_WIDTH: w, GAME_HEIGHT: h, levelConfig } = this;
    const texts = levelConfig.texts;
    this.levelCompleteOverlay = this.add.container(w / 2, h / 2);
    // background image for win (winbg)
    const bg = this.add.image(0, 0, 'winbg').setDepth(-1);
    const panel = this.add.image(0, 0, "levelcomplete_overlay").setScale(0.5, 0.3);


    const winText = this.add.text(0, 0, texts.win?.toUpperCase() || 'LEVEL COMPLETE',{ fontFamily: 'Outfit', fontSize: '54px', color: '#ffffff' })
      .setOrigin(0.5);

    const playAgainBtn = this.add.image(-235, 220, "replay_level").setInteractive({ useHandCursor: true });
    const nextBtn = this.add.image(235, 220, "next").setOrigin(0.5).setInteractive({ useHandCursor: true });

    this._addButtonFX(playAgainBtn);
    this._addButtonFX(nextBtn);

    nextBtn.on('pointerdown', () => { this.hideAllOverlays(); this.notifyParent('sceneComplete', { result: 'win' }); });
    playAgainBtn.on('pointerdown', (pointer, lx, ly, event) => {
      event?.stopPropagation();
      this._restartBgm();               // 🔊 restart bgm
      this.hideAllOverlays();
      this.startGame();
    });

    this.levelCompleteOverlay.add([bg, panel, winText, playAgainBtn, nextBtn]);
    this.levelCompleteOverlay.setDepth(1000).setVisible(false);
  }

  hideAllOverlays() {
    if (this.startOverlay) this.startOverlay.setVisible(false);
    if (this.gameOverOverlay) this.gameOverOverlay.setVisible(false);
    if (this.levelCompleteOverlay) this.levelCompleteOverlay.setVisible(false);
  }

  notifyParent(type, data) {
    if (window.parent !== window) {
      window.parent.postMessage({ type, ...data }, "*");
    }
  }

  showStart() {
    this.cleanupFlyingStick();

    this.gameState = 'start';
    this.hideAllOverlays();
    this.ring.setVisible(false);
    this.scoreText.setVisible(false);
    this.stickGroup.clear(true, true);
    this.sticks = [];
    this.score = 0;
    this.isThrowing = false;
    this.gameOver = false;
    this.startOverlay.setVisible(true);
    this.scoreText.setVisible(false);
    this.scorebar?.setVisible(false);

  }

  startGame() {
    this.cleanupFlyingStick();

    this.gameState = 'playing';
    this.hideAllOverlays();
    this.ring.setVisible(true);
    this.scoreText.setVisible(true);
    this.scorebar?.setVisible(true);
    this.stickGroup.clear(true, true);
    this.sticks = [];
    this.score = 0;
    this.isThrowing = false;
    this.gameOver = false;
    this.scoreText.setText(`${this.levelConfig.texts.score.toUpperCase()}: 0/${this.MAX_STICKS}`);
    this._pulse(this.scoreText, 1.0, 1.06, 220);

    // Arm gameplay taps shortly after entering 'playing'
    this._tapArmed = false;
    this.time.delayedCall(120, () => { this._tapArmed = true; });
  }


  cleanupFlyingStick() {
    if (this._trailTimer) { this._trailTimer.remove(false); this._trailTimer = null; }
    if (this.flyingStick) {
      this.flyingStick.destroy();
      this.flyingStick = null;
      this.flyingStickState = null;
    }
  }

  update(time, delta) {
    if (this.gameState !== 'playing' || this.gameOver) return;

    this.ring.rotation += this.ringRotationSpeed * delta / 1000;

    for (let obj of this.sticks) {
      let worldAngle = obj.angle + this.ring.rotation;
      obj.stick.x = this.RING_X + this.RING_RADIUS * Math.cos(worldAngle);
      obj.stick.y = this.RING_Y + this.RING_RADIUS * Math.sin(worldAngle);
      obj.stick.rotation = worldAngle + Math.PI / 2;
    }

    if (this.flyingStick && this.flyingStickState) {
      const stick = this.flyingStick;
      const state = this.flyingStickState;
      const moveDist = state.speed * (delta / 1000);
      stick.x += Math.cos(state.angle) * moveDist;
      stick.y += Math.sin(state.angle) * moveDist;

      // trail dot
      if (!this._trailTimer) {
        this._trailTimer = this.time.addEvent({
          delay: 22,
          loop: true,
          callback: () => this._spawnTrailDot(stick.x, stick.y)
        });
      }

      const tipX = stick.x + Math.cos(state.angle) * this.STICK_LENGTH;
      const tipY = stick.y + Math.sin(state.angle) * this.STICK_LENGTH;
      const distToRing = Phaser.Math.Distance.Between(tipX, tipY, this.RING_X, this.RING_Y);
      if (distToRing <= this.RING_RADIUS) {
        const hitAngle = Math.atan2(tipY - this.RING_Y, tipX - this.RING_X);

        const correctedRadius = this.RING_RADIUS + (this.STICK_LENGTH / 2) + 20;
        const stickX = this.RING_X + correctedRadius * Math.cos(hitAngle);
        const stickY = this.RING_Y + correctedRadius * Math.sin(hitAngle);

        stick.x = stickX;
        stick.y = stickY;

        this.flyingStick = null;
        this.flyingStickState = null;
        if (this._trailTimer) { this._trailTimer.remove(false); this._trailTimer = null; }

        if (this.checkCollision(Phaser.Math.Angle.Wrap(hitAngle - this.ring.rotation))) {
          this.handleGameOver(stick);
        } else {
          this.landStick(stick, Phaser.Math.Angle.Wrap(hitAngle - this.ring.rotation));
        }
      }
    }
  }

  throwStick() {
    this.isThrowing = true;

    (this.arrowSfx && this.arrowSfx.play()) || this.sound.play('arrow', { volume: 0.9 });

    const startX = this.GAME_WIDTH / 2;
    const startY = this.GAME_HEIGHT - 100;
    const dx = this.RING_X - startX;
    const dy = this.RING_Y - startY;
    const angleToRing = Math.atan2(dy, dx);

    const flyingStick = this.createSprite('stick', startX, startY, 'rectangle', 0xffffff, this.STICK_WIDTH, this.STICK_LENGTH);
    flyingStick.setOrigin(0.5, 1);
    flyingStick.setDepth(2);
    flyingStick.rotation = Math.PI; // aesthetic

    // NEW: add a soft glow to the flying stick
    this._addGlow(flyingStick, 0xffffff, 3, 0.65);

    this.flyingStick = flyingStick;
    this.flyingStickState = { startX, startY, angle: angleToRing, speed: this.THROW_SPEED };

    // NEW: tiny throw pop
    this._popAt(flyingStick.x, flyingStick.y, 10, 0x8dcbff);
  }

  checkCollision(newAngle) {
    for (let obj of this.sticks) {
      let diff = Phaser.Math.Angle.Wrap(newAngle - obj.angle);
      if (Math.abs(diff) < this.MIN_ANGLE_GAP) return true;
    }
    return false;
  }

  landStick(stick, angle) {
    const texts = this.levelConfig.texts;
    this.sticks.push({ angle, stick });
    this.stickGroup.add(stick);
    this.score++;
    this.scoreText.setText(`${texts.score.toUpperCase()}: ${this.score}/${this.MAX_STICKS}`);
    this._pulse(this.scoreText, 1.0, 1.08, 160);

    // NEW: ring thump + sparkle
    this._ringThump();
    this._sparkAt(stick.x, stick.y, 12, 0x7dfbff);

    if (this.score >= this.MAX_STICKS) {
      this.handleWin();
    } else {
      this.time.delayedCall(250, () => { this.isThrowing = false; });
    }
  }

  handleGameOver(collidedStick) {
    // if (this.bgm) this.bgm.stop();
    this.gameOver = true;
    this.isThrowing = false;

    // NEW: quick red flash
    this.cameras.main.flash(120, 255, 40, 60);

    this.sys.tweens.add({
      targets: collidedStick,
      x: collidedStick.x + 10,
      duration: 50,
      yoyo: true,
      repeat: 5,
      onComplete: () => {
        collidedStick.destroy();
        this._shatterAt(this.RING_X, this.RING_Y, 20, 0xff5a7a);
        this.showGameOverOverlay();
      }
    });
  }

  handleWin() {
    // if (this.bgm) this.bgm.stop();
    this.gameOver = true;
    this.isThrowing = false;

    // NEW: confetti burst + white flash
    this.cameras.main.flash(120, 255, 255, 255);
    this._confetti(70);

    this.showLevelCompleteOverlay();
  }

  showGameOverOverlay() {
    this.gameState = 'gameover';
    this.hideAllOverlays();
    this.ring.setVisible(false);
    this.scoreText.setVisible(false);
    this.scorebar?.setVisible(false);
    this.stickGroup.setVisible(false);
    this.gameOverOverlay.setVisible(true);
  }

  showLevelCompleteOverlay() {
    this.gameState = 'levelcomplete';
    this.hideAllOverlays();
    this.ring.setVisible(false);
    this.scoreText.setVisible(false);
    this.scorebar?.setVisible(false);
    this.stickGroup.setVisible(false);
    this.levelCompleteOverlay.setVisible(true);
  }

  // --- Utility ---
  createSprite(key, x = 0, y = 0, type = 'rectangle', color = 0xff00ff, width = 32, height = 32) {
    if (this.sys.textures.exists(key)) {
      return this.add.image(x, y, key);
    }
    switch (type) {
      case 'circle': return this.add.circle(x, y, width, color);
      case 'rectangle': return this.add.rectangle(x, y, width, height, color);
      default: return this.add.rectangle(x, y, 32, 32, 0xff00ff);
    }
  }

  // =========================
  // Fancy text + FX helpers
  // =========================

  _makeNeonText(x, y, text, size = 42, color = '#ffffff', strokeColor = '#f4f5f5ff') {
    const t = this.add.text(x, y, text, {
      fontFamily: 'Outfit, Arial, sans-serif',
      fontSize: `${size}px`,
      color,
      fontStyle: '700',
      stroke: strokeColor,
      strokeThickness: Math.max(2, Math.floor(size * 0.14)),
      align: 'center'
    });
    t.setShadow(0, 0, strokeColor, Math.floor(size * 0.7), true, true);
    this._addGlow(t, Phaser.Display.Color.HexStringToColor(strokeColor).color, 4, 0.65);
    return t;
  }

  _makeSoftText(x, y, text, size = 26, color = '#bfc6ccff') {
    const t = this.add.text(x, y, text, {
      fontFamily: 'Outfit, Arial, sans-serif',
      fontSize: `${size}px`,
      color,
      align: 'center',
      wordWrap: { width: this.GAME_WIDTH * 0.8, useAdvancedWrap: true }
    });
    t.setShadow(0, 2, '#000000', 6, false, true);
    return t;
  }

  _addGlow(go, color = 0x00eaff, dist = 4, intensity = 0.7) {
    if (!this.fx.canFX || !go.preFX) return;
    try {
      go.preFX.addGlow(color, dist, intensity, true);
    } catch (_) { /* ignore if pipeline not available */ }
  }

  _pulse(go, from = 1, to = 1.06, dur = 180) {
    this.tweens.add({
      targets: go,
      scale: { from, to },
      duration: dur,
      yoyo: true,
      ease: 'Sine.easeOut'
    });
  }

  _addButtonFX(btn) {
    btn.on('pointerover', () => this.tweens.add({ targets: btn, scale: 1.06, duration: 120 }));
    btn.on('pointerout', () => this.tweens.add({ targets: btn, scale: 1.0, duration: 120 }));
    btn.on('pointerdown', () => this.tweens.add({ targets: btn, scale: 0.96, duration: 80, yoyo: true }));
    this._addGlow(btn, 0xffffff, 3, 0.45);
  }

  // =========================
  // Juice: particles w/o emitters
  // (safe for Phaser 3.60 changes)
  // =========================

  _spawnTrailDot(x, y) {
    const s = Phaser.Math.Between(3, 6);
    const d = this.add.image(x, y, 'px1')
      .setDisplaySize(s, s)
      .setTint(0x9fe3ff)
      .setAlpha(0.9)
      .setDepth(3)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({
      targets: d,
      alpha: 0,
      scale: 0.2,
      duration: 260,
      onComplete: () => d.destroy()
    });
  }

  _popAt(x, y, count = 8, tint = 0x8dcbff) {
    for (let i = 0; i < count; i++) {
      const a = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const speed = Phaser.Math.Between(220, 360);
      const life = Phaser.Math.Between(220, 340);
      const dot = this.add.image(x, y, 'px1')
        .setDisplaySize(4, 4)
        .setTint(tint)
        .setDepth(4)
        .setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({
        targets: dot,
        x: x + Math.cos(a) * speed * (life / 1000),
        y: y + Math.sin(a) * speed * (life / 1000),
        alpha: 0,
        duration: life,
        onComplete: () => dot.destroy()
      });
    }
  }

  _sparkAt(x, y, count = 10, tint = 0x7dfbff) {
    for (let i = 0; i < count; i++) {
      const a = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const len = Phaser.Math.Between(16, 28);
      const seg = this.add.image(x, y, 'px1')
        .setDisplaySize(len, 2)
        .setTint(tint)
        .setAlpha(0.9)
        .setDepth(4)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setRotation(a);
      this.tweens.add({
        targets: seg,
        alpha: 0,
        scaleX: 0,
        duration: Phaser.Math.Between(160, 240),
        onComplete: () => seg.destroy()
      });
    }
  }

  _shatterAt(x, y, count = 20, tint = 0xff5a7a) {
    for (let i = 0; i < count; i++) {
      const a = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const speed = Phaser.Math.Between(180, 300);
      const life = Phaser.Math.Between(260, 420);
      const size = Phaser.Math.Between(4, 10);
      const piece = this.add.image(x, y, 'px1')
        .setDisplaySize(size, size)
        .setTint(tint)
        .setDepth(5);
      this.tweens.add({
        targets: piece,
        x: x + Math.cos(a) * speed,
        y: y + Math.sin(a) * speed,
        angle: Phaser.Math.Between(-180, 180),
        alpha: 0,
        duration: life,
        ease: 'Quad.easeOut',
        onComplete: () => piece.destroy()
      });
    }
  }

  _confetti(count = 60) {
    for (let i = 0; i < count; i++) {
      const x = Phaser.Math.Between(80, this.GAME_WIDTH - 80);
      const y = -Phaser.Math.Between(0, 300);
      const w = Phaser.Math.Between(6, 12);
      const h = Phaser.Math.Between(10, 18);
      const tint = Phaser.Display.Color.GetColor(
        Phaser.Math.Between(40, 255),
        Phaser.Math.Between(40, 255),
        Phaser.Math.Between(40, 255)
      );
      const bit = this.add.image(x, y, 'px1').setDisplaySize(w, h).setTint(tint).setDepth(999);
      bit.setBlendMode(Phaser.BlendModes.NORMAL);
      this.tweens.add({
        targets: bit,
        y: this.GAME_HEIGHT + 40,
        angle: Phaser.Math.Between(-180, 180),
        duration: Phaser.Math.Between(1200, 1800),
        ease: 'Cubic.easeIn',
        onComplete: () => bit.destroy()
      });
    }
  }

  _ringThump() {
    this.tweens.add({
      targets: this.ring,
      scale: { from: 1.0, to: 1.05 },
      duration: 90,
      yoyo: true,
      ease: 'Sine.easeOut'
    });
  }

  _restartBgm() {
    if (!this.bgm) {
      this.bgm = this.sound.add('bgm', { loop: true, volume: 1 });
    }
    // restart from the beginning
    this.bgm.stop();
    this.bgm.play({ seek: 0 });
  }

}
