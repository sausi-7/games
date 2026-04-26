class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');

    this.cfg = null;
    this.W = 1080; this.H = 1920;

    this.ball = null;
    this.ground = null;
    this.leftPlat = null;
    this.platformCollider = null;
    this.groundCollider = null;

    this.hoop = { board: null, netSensor: null, netSprite: null, boardBody: null };
    this.ui = { scoreText: null, shotsText: null, resetBtn: null, hintText: null, powerBar: null };
    this.fx = { confettiEmitter: null, trailEmitter: null };
    this.redBox = null;

    this.state = {
      finalscore: 0,
      shots: 5,
      shotsTaken: 0,
      aiming: false,
      canAim: true,
      madeShot: false,
      maxPower: 2000,
      powerScale: 8.0,
      dots: [],
      dotCount: 30,
      dotDt: 0.05,
      lastClankAt: 0
    };
  }

  preload() {
    const basePath = '.';
    this.load.json('levelConfig', `${basePath}/config.json`);

    this.load.once('filecomplete-json-levelConfig', () => {
      const cfg = this.cache.json.get('levelConfig') || {};
      const spritesheets = cfg.spritesheets || {};
      const eveData = spritesheets.eve || {};

      if (eveData.path) {
        this.load.spritesheet('eve', `${basePath}/${eveData.path}`, {
          frameWidth: eveData.frameWidth || 102,
          frameHeight: eveData.frameHeight || 158,
        }).on('error', () => console.error('Failed to load Eve spritesheet'));
      }

      if (cfg.images1) {
        Object.entries(cfg.images1).forEach(([key, url]) => {
          this.load.image(key, `${basePath}/${url}`).on('error', () => console.error(`Failed to load image: ${key}`));
        });
      }

      if (cfg.images2) {
        Object.entries(cfg.images2).forEach(([key, url]) => {
          this.load.image(key, `${basePath}/${url}`).on('error', () => console.error(`Failed to load image: ${key}`));
        });
      }

      if (cfg.ui) {
        Object.entries(cfg.ui).forEach(([key, url]) => {
          this.load.image(key, `${basePath}/${url}`).on('error', () => console.error(`Failed to load image: ${key}`));
        });
      }

      if (cfg.audio) {
        for (const [key, url] of Object.entries(cfg.audio)) {
          this.load.audio(key, `${basePath}/${url}`);
        }
      }
      this.load.start();
    });
  }

  create() {
    this.cfg = this.cache.json.get('levelConfig') || {};
    const g = this.cfg.gameplay || {};
    if (Number.isFinite(g.initialShots)) this.state.shots = g.initialShots;
    if (g.maxPower) this.state.maxPower = g.maxPower;
    if (g.powerScale) this.state.powerScale = g.powerScale;

    this._bakeFallbackTextures();
    this._buildBackground();
    this._buildCourt();
    this._buildGround();
    this._buildLeftPlatform();
    this._buildHoop();
    this._spawnBall();

    this._buildUI();
    this._wireInput();

    this._makeTrajectoryDots(); // Ensure dots are created/recreated on scene start
    this._buildFX();

    // --- AUDIO ---
    this.sfx = {
      bgm: this.sound.get('bgm') || this.sound.add('bgm', { loop: true, volume: 0.5 }),
      score: this.sound.get('score') || this.sound.add('score', { volume: 0.9 })
    };
    if (this.sfx.bgm) this.sfx.bgm.play();

    // stop any looping audio when scene goes away
    this.events.once('shutdown', () => { this.sound.stopAll(); });
    this.events.once('destroy', () => { this.sound.stopAll(); });

  }

  update() {
    if (!this.state.aiming) {
      for (const d of this.state.dots) d.setVisible(false);
      if (this.ui.powerBar) this.ui.powerBar.setScale(0, 1).setVisible(false);
    }

    const m = 400;
    if (this.ball && (this.ball.y > this.H + m || this.ball.y < -m || this.ball.x < -m || this.ball.x > this.W + m)) {
      this._resetBall(true);
    }
  }

  _stopBgm() {
    if (this.sfx?.bgm && this.sfx.bgm.isPlaying) this.sfx.bgm.stop();
  }


   _bakeFallbackTextures() {
    if (!this.textures.exists('background')) {
      const g = this.add.graphics();
      const r = new Phaser.Display.Color(14, 19, 38);
      const s = new Phaser.Display.Color(34, 45, 84);
      const h = this.H, steps = 16;
      for (let i = 0; i < steps; i++) {
        const c = Phaser.Display.Color.Interpolate.ColorWithColor(r, s, steps - 1, i);
        g.fillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b), 1);
        g.fillRect(0, (i / steps) * h, this.W, h / steps + 2);
      }
      g.generateTexture('background', this.W, this.H);
      g.destroy();
    }

    if (!this.textures.exists('court')) {
      const w = this.W, h = 560;
      const g = this.add.graphics();
      g.fillStyle(0x141c45, 1).fillRoundedRect(0, 0, w, h, 40);         // darker, richer base
      g.fillStyle(0x22306f, 1).fillRoundedRect(w * 0.08, 100, w * 0.84, 360, 40);
      g.lineStyle(8, 0x3a4ebd, 0.7).strokeCircle(w * 0.5, 280, 110);    // brighter line ring
      g.generateTexture('court', w, h); g.destroy();
    }

    // Backboard with soft gradient + glossy center box
    if (!this.textures.exists('backboard')) {
      const g = this.add.graphics();
      // gradient-ish: draw two rounded rects
      g.fillStyle(0xf8fbff, 1).fillRoundedRect(0, 0, 360, 210, 18);
      g.fillStyle(0xeaf0ff, 1).fillRoundedRect(0, 0, 360, 210, 18);
      // inner rectangle (shooter's square)
      g.lineStyle(8, 0xff5a36, 1).strokeRoundedRect(48, 36, 270, 150, 10);
      // glossy stripe
      g.fillStyle(0xffffff, 0.35).fillRoundedRect(12, 14, 336, 28, 12);
      g.generateTexture('backboard', 360, 210);
      g.destroy();
    }

    // Rim with higher contrast and thicker stroke
    if (!this.textures.exists('rim')) {
      const g = this.add.graphics();
      const cx = 75, cy = 75, r = 60;
      g.lineStyle(14, 0xff8c1a, 1).strokeCircle(cx, cy, r);
      // inner dark ring for depth
      g.lineStyle(6, 0x6b3208, 0.9).strokeCircle(cx, cy, r - 6);
      g.generateTexture('rim', 150, 150); 
      g.destroy();
    }

    // A soft glow sprite for the rim (used additively)
    if (!this.textures.exists('rimGlow')) {
      const g = this.add.graphics();
      const cx = 96, cy = 96, r = 86;
      for (let i = 0; i < 8; i++) {
        const alpha = 0.15 - (i * 0.018);
        g.lineStyle(20 + i * 6, 0xffb347, alpha).strokeCircle(cx, cy, r - i * 4);
      }
      g.generateTexture('rimGlow', 192, 192);
      g.destroy();
    }

    // Net as bright white with subtle diagonal sheen
    if (!this.textures.exists('netTex')) {
      const g = this.add.graphics();
      // white net
      g.lineStyle(5, 0xffffff, 0.95);
      for (let y = 0; y < 150; y += 15) g.lineBetween(0, y, 150, y);
      for (let x = 0; x <= 150; x += 15) g.lineBetween(x, 0, x, 150);
      // faint diagonal sheen
      g.lineStyle(10, 0xbfd8ff, 0.15);
      g.lineBetween(0, 0, 150, 150);
      g.lineBetween(-20, 10, 130, 160);
      g.generateTexture('netTex', 150, 150);
      g.destroy();
    }

    if (!this.textures.exists('ball')) {
      const g = this.add.graphics();
      g.fillStyle(0xffa52b, 1).fillCircle(64, 64, 64);
      g.lineStyle(6, 0x2b1b0f, 1).strokeCircle(64, 64, 64);
      g.lineBetween(64, 0, 64, 128); g.lineBetween(0, 64, 128, 64);
      g.generateTexture('ball', 128, 128); g.destroy();
    }

    if (!this.textures.exists('platformTex')) {
      const g = this.add.graphics();
      g.fillStyle(0x4251c6, 1).fillRoundedRect(0, 0, 260, 24, 10);
      g.lineStyle(4, 0x5f78ff, 1).strokeRoundedRect(0, 0, 260, 24, 10);
      g.generateTexture('platformTex', 260, 24); g.destroy();
    }

    if (!this.textures.exists('btnReset')) {
      const g = this.add.graphics();
      g.fillStyle(0x222a4f, 1).fillRoundedRect(0, 0, 180, 80, 20);
      g.lineStyle(4, 0x4b61d1, 1).strokeRoundedRect(0, 0, 180, 80, 20);
      g.fillStyle(0x6f88ff, 1); g.fillTriangle(50, 25, 130, 40, 50, 55);
      g.generateTexture('btnReset', 180, 80); g.destroy();
    }
    if (!this.textures.exists('pill')) {
      const g = this.add.graphics();
      g.fillStyle(0x0f1430, 0.85).fillRoundedRect(0, 0, 480, 80, 40);
      g.generateTexture('pill', 480, 80); g.destroy();
    }
    if (!this.textures.exists('bar')) {
      const g = this.add.graphics();
      g.fillStyle(0x5466ff, 1).fillRoundedRect(0, 0, 360, 18, 9);
      g.generateTexture('bar', 360, 18); g.destroy();
    }

    if (!this.textures.exists('redBox')) {
      const g = this.add.graphics();
      g.fillStyle(0xff0000, 1).fillRect(0, 0, 80, 80);
      g.generateTexture('redBox', 80, 80); g.destroy();
    }
  }


  _buildBackground() {
    // Keep the baked gradient image only
    this.add.image(this.W / 2, this.H / 2, 'background').setDepth(-100);

    // Optional: very subtle vignette to add depth (no shapes/ovals)
    const g = this.add.graphics();
    const padding = 40;
    g.fillStyle(0x000000, 0.35);
    g.fillRect(-padding, -padding, this.W + padding * 2, this.H + padding * 2);
    g.setBlendMode(Phaser.BlendModes.MULTIPLY);
    g.setAlpha(0.4).setDepth(-90);
  }


  _buildCourt() {
    this.add.image(this.W / 2, this.H - 280, 'court').setDepth(-50);
    const g = this.add.graphics();
    g.lineStyle(10, 0x1e2959, 1);
    g.lineBetween(this.W * 0.82, this.H - 560, this.W * 0.82, this.H - 280);
    g.lineBetween(this.W * 0.82, this.H - 560, this.W * 0.88, this.H - 460);
    g.setDepth(-40);
  }

  _buildGround() {
    this.ground = this.physics.add.staticImage(this.W / 2, this.H - 240, 'platformTex')
      .setScale(5).setOffset(0, 0);
    this.ground.refreshBody();
  }

  _buildLeftPlatform() {
    const x = this.W * 0.22;
    const y = this.H * 0.66;
    this.leftPlat = this.physics.add.staticImage(x, y, 'platformTex');
    this.leftPlat.setSize(260, 24).setOffset(0, 0);
    this.leftPlat.refreshBody();
  }

  _buildHoop() {
    const hoopX = this.W * 0.82;
    const hoopY = this.H * 0.36;

    // Backboard (brighter tint), slight tilt depth
    this.hoop.board = this.add.image(hoopX, hoopY, 'backboard')
      .setDepth(5)
      .setScale(1.2)
      .setTint(0xf5f9ff);

    // Rim
    const rimImg = this.add.image(hoopX - 62.5, hoopY + 50, 'rim')
      .setDepth(7)
      .setScale(1.25)
      .setTint(0xffa21a);

    // Additive glow overlay for the rim
    const rimGlow = this.add.image(rimImg.x, rimImg.y, 'rimGlow')
      .setDepth(6) // just behind rim so the rim lines stay crisp
      .setScale(0.9)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.55);

    // Gentle pulse on the glow
    this.tweens.add({
      targets: rimGlow,
      alpha: { from: 0.38, to: 0.68 },
      duration: 1200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut'
    });

    // Collidable board body (invisible)
    this.hoop.boardBody = this.physics.add.staticImage(this.hoop.board.x + 75, this.hoop.board.y + 12.5, null)
      .setSize(25, 150).setOffset(0, 0);
    this.hoop.boardBody.refreshBody();

    // Scoring sensor
    this.hoop.netSensor = this.add.zone(rimImg.x, rimImg.y + 45, 133, 50).setOrigin(0.5, 0.5);
    this.physics.world.enable(this.hoop.netSensor, Phaser.Physics.Arcade.STATIC_BODY);

    // Net brighter with mild tint toward blue-white
    this.hoop.netSprite = this.add.image(rimImg.x, rimImg.y + 87.5, 'netTex')
      .setDepth(6)
      .setAlpha(0.9)
      .setTint(0xeef6ff)
      .setScale(1.0, 1.375);

    // RedBox collider (kept)
    this.redBox = this.physics.add.staticImage(hoopX + 100, hoopY - 50, 'redBox')
      .setScale(1.5)
      .setDepth(5);
    this.redBox.refreshBody();
  }


  _spawnBall() {
    if (this.ball) this.ball.destroy();

    const startX = this.leftPlat.x;
    const startY = this.leftPlat.y - 120;

    this.ball = this.physics.add.image(startX, startY - 100, 'ball')
      .setScale(0.2)
      .setBounce(0.8)
      .setCollideWorldBounds(true)
      .setDepth(8);

    // const bodyRadius = 80;
    // this.ball.setCircle(bodyRadius, 64 - bodyRadius, 64 - bodyRadius);

    this.physics.world.setBounds(0, 0, this.W, this.H, true, true, true, true);

    this.platformCollider = this.physics.add.collider(this.ball, this.leftPlat);
    this.groundCollider = this.physics.add.collider(this.ball, this.ground, () => {
      if (this.ball) {
        this.ball.destroy();
        this._resetBall(true);
      }
    });

    const impact = () => {
      const now = this.time.now;
      if (now - this.state.lastClankAt > 140) {
        this.state.lastClankAt = now;
        this._rimClankFX();
      }
    };
    this.physics.add.collider(this.ball, this.hoop.boardBody, impact, null, this);

    this.physics.add.overlap(this.ball, this.hoop.netSensor, this._maybeScore, null, this);

    this.physics.add.collider(this.ball, this.redBox, this._handleRedBoxCollision, null, this);

    const shadow = this.add.ellipse(this.ball.x, this.ball.y + 16, 80, 22, 0x000000, 0.25).setDepth(3);
    this.tweens.add({ targets: shadow, alpha: { from: 0.18, to: 0.32 }, duration: 900, yoyo: true, repeat: -1 });
    this.events.on('update', () => {
      if (this.ball && this.ball.active) {
        shadow.x = this.ball.x;
        shadow.y = this.ball.y + 16;
        shadow.scaleX = Phaser.Math.Clamp(1 - (this.ball.body.velocity.y / 2000), 0.7, 1.2);
      }
    });
  }

  _fancyText(x, y, text, sizePx = 36, color = '#E9EEFF') {
    const t = this.add.text(x, y, text, {
      fontFamily: 'Arial, Helvetica, sans-serif',
      fontSize: `${sizePx}px`,
      fontStyle: '900',          // heavy/bold
      color,
      stroke: '#0A1030',         // dark stroke for contrast
      strokeThickness: 8,
      align: 'center',
      padding: { left: 8, right: 8, top: 4, bottom: 4 }
    })
      .setOrigin(0.5)
      .setDepth(51);

    // Subtle neon-ish glow
    t.setShadow(0, 0, '#3E56C4', 14, true, true);
    return t;
  }


  _buildUI() {
    // Score pill
    const scoreBg = this.add.image(this.W * 0.5, 100, 'pill')
      .setDepth(50)
      .setTint(0x1B2352); // deep blue tint

    this.ui.scoreText = this._fancyText(scoreBg.x, scoreBg.y, 'SCORE: 0', 40, '#E9EEFF');

    // Shots pill
    const shotsBg = this.add.image(this.W * 0.5, 190, 'pill')
      .setDepth(50)
      .setTint(0x1B2352);

    this.ui.shotsText = this._fancyText(shotsBg.x, shotsBg.y, `SHOTS: ${this.state.shots}`, 34, '#C8D5FF');

    // Reset button (kept, but give it a slight glow on hover)
    this.ui.resetBtn = this.add.image(this.W - 120, 120, 'btnReset')
      .setInteractive({ useHandCursor: true })
      .setDepth(60);

    this.ui.resetBtn.on('pointerover', () => this.ui.resetBtn.setScale(1.05));
    this.ui.resetBtn.on('pointerout', () => this.ui.resetBtn.setScale(1.0));
    this.ui.resetBtn.on('pointerup', () => this._fullReset());

    // Aim hint
    this.ui.hintText = this._fancyText(
      this.leftPlat.x + 60,
      this.leftPlat.y + 50,
      'Drag from the ball → Aim & Release',
      28,
      '#C9D2FF'
    )
      .setAlpha(0.95)
      .setDepth(40);

    this.tweens.add({
      targets: this.ui.hintText,
      alpha: { from: 0.95, to: 0.45 },
      duration: 900,
      yoyo: true,
      repeat: 6
    });

    // Power bar (kept, but bring above hint & make it feel “HUD”-ish)
    this.ui.powerBar = this.add.image(this.leftPlat.x - 120, this.leftPlat.y - 60, 'bar')
      .setOrigin(0, 0.5)
      .setDepth(55)
      .setTint(0x4B61D1)
      .setScale(0, 1)
      .setVisible(false);
  }


  _wireInput() {
    const isBallIdle = () => {
      if (!this.ball || !this.ball.body) return false;
      const v = this.ball.body.velocity;
      return Math.hypot(v.x, v.y) < 50;
    };

    this.input.on('pointerdown', (p) => {
      if (!this.state.canAim || !isBallIdle()) return;
      const within = Phaser.Math.Distance.Between(p.x, p.y, this.ball.x, this.ball.y) < 160;
      if (!within) return;
      this.state.aiming = true;
      this.ui.powerBar.setVisible(true);
    });

    this.input.on('pointermove', (p) => {
      if (!this.state.aiming) return;
      this._updateAimPreview(p);
    });

    this.input.on('pointerup', (p) => {
      if (!this.state.aiming) return;
      this._fireShot(p);
      this.state.aiming = false;
      this.ui.powerBar.setVisible(false);
      for (const d of this.state.dots) d.setVisible(false);
    });
  }

  _makeTrajectoryDots() {
    // Clear existing dots to avoid duplicates on scene restart
    this.state.dots.forEach(dot => dot.destroy());
    this.state.dots = [];

    if (!this.textures.exists('dot')) {
      const g = this.add.graphics().fillStyle(0xffffff, 0.9).fillCircle(6, 6, 6);
      g.generateTexture('dot', 12, 12); g.destroy();
    }
    for (let i = 0; i < this.state.dotCount; i++) {
      const d = this.add.image(0, 0, 'dot').setDepth(30).setVisible(false).setAlpha(0.85);
      this.state.dots.push(d);
    }
  }

  _buildFX() {
    this.fx.confettiEmitter = this.add.particles(0, 0, 'dot', {
      speed: { min: 200, max: 560 },
      lifespan: 700,
      quantity: 0,
      gravityY: 1000,
      scale: { start: 1.2, end: 0 },
      on: false
    });
    this.fx.confettiEmitter.setDepth(100);

    this.fx.trailEmitter = this.add.particles(0, 0, 'dot', {
      speed: 0,
      lifespan: 220,
      quantity: 1,
      frequency: 50,
      scale: { start: 0.8, end: 0 },
      on: false
    });
    this.fx.trailEmitter.startFollow(this.ball);
    this.fx.trailEmitter.setDepth(20);
  }

  _updateAimPreview(pointer) {
    if (!this.ball) return;
    const dx = this.ball.x - pointer.x;
    const dy = this.ball.y - pointer.y;

    const rawPower = Math.hypot(dx, dy) * this.state.powerScale;
    const power = Math.min(rawPower, this.state.maxPower);

    let dirx = 0, diry = 0;
    if (dx !== 0 || dy !== 0) {
      const len = Math.hypot(dx, dy);
      dirx = dx / len;
      diry = dy / len;
    }

    const v0x = dirx * power;
    const v0y = diry * power;

    const g = this.physics.world.gravity.y;
    const p0x = this.ball.x, p0y = this.ball.y;

    for (let i = 0; i < this.state.dotCount; i++) {
      const t = (i + 1) * this.state.dotDt;
      const x = p0x + v0x * t;
      const y = p0y + v0y * t + 0.5 * g * t * t;
      const d = this.state.dots[i];
      d.setPosition(x, y).setVisible(true);
      const a = Phaser.Math.Linear(1, 0.15, i / (this.state.dotCount - 1));
      d.setAlpha(a).setScale(Phaser.Math.Linear(1.0, 0.5, i / (this.state.dotCount - 1)));
    }

    this.ui.powerBar.setScale(Phaser.Math.Clamp(power / this.state.maxPower, 0, 1), 1);
  }

  _fireShot(pointer) {
    if (!this.ball) return;
    const dx = this.ball.x - pointer.x;
    const dy = this.ball.y - pointer.y;
    const rawPower = Math.hypot(dx, dy) * this.state.powerScale;
    const power = Math.min(rawPower, this.state.maxPower);

    const len = Math.max(Math.hypot(dx, dy), 0.0001);
    const dirx = dx / len;
    const diry = dy / len;

    const v0x = dirx * power;
    const v0y = diry * power;

    this.ball.setVelocity(v0x, v0y);

    if (this.platformCollider) this.platformCollider.active = false;
    if (this.groundCollider) this.groundCollider.active = false;
    this.time.delayedCall(450, () => {
      if (this.platformCollider) this.platformCollider.active = true;
      if (this.groundCollider) this.groundCollider.active = true;
    });

    this.fx.trailEmitter.start();

    this.state.shots = Math.max(0, this.state.shots - 1);
    this.state.shotsTaken += 1;
    this.ui.shotsText.setText(`Shots: ${this.state.shots}`);

    this.state.canAim = false;
    this.time.delayedCall(500, () => {
      this._waitUntilIdle().then(() => {
        this.state.canAim = true;
        this.fx.trailEmitter.stop();
        if (this.state.shots <= 0) {
          if (this.state.finalscore >= 10) {
            this._stopBgm();
            this.scene.start('WinScene');
          } else {
            this._stopBgm();
            this.scene.start('GameOverScene');
          }
        }
      });
    });
  }

  async _waitUntilIdle() {
    return new Promise(resolve => {
      const check = () => {
        if (!this.ball || !this.ball.body) return resolve();
        const v = this.ball.body.velocity;
        if (Math.hypot(v.x, v.y) < 50) return resolve();
        this.time.delayedCall(120, check);
      };
      check();
    });
  }

  _maybeScore(ball, sensor) {
    if (!this.ball || this.ball.body.velocity.y <= 80) return;
    const dx = Math.abs(this.ball.x - sensor.x);
    if (dx > 66.5) return;

    if (this.state.madeShot) return;
    this.state.madeShot = true;

    this._swishFX(sensor.x, sensor.y);

    if (this.sfx?.score) this.sfx.score.play();


    const points = (this.ball.x < this.W * 0.55) ? 3 : 2;
    this.state.finalscore += points;
    this.ui.scoreText.setText(`Score: ${this.state.finalscore}`);

    this.time.delayedCall(800, () => {
      this._resetBall(false);
      if (this.state.finalscore >= 10) {
        this._stopBgm();
        this.scene.start('WinScene');
      }
    });
  }

  _swishFX(x, y) {
    this.tweens.add({
      targets: this.hoop.netSprite,
      alpha: { from: 0.85, to: 0.2 },
      scaleY: { from: 1.375, to: 1.125 },
      duration: 120,
      yoyo: true
    });
    this.fx.confettiEmitter.explode(42, x, y + 50);
    this.cameras.main.shake(140, 0.0025);
  }

  _rimClankFX() {
    this.cameras.main.shake(90, 0.002);
    this.tweens.add({
      targets: [this.hoop.board],
      angle: { from: -1.5, to: 0 },
      duration: 140,
      ease: 'Quad.easeOut'
    });
  }

  _resetBall(outOfBounds = false) {
    this.fx.trailEmitter.stop();
    this.state.madeShot = false;
    this._spawnBall();

    if (this.state.shots <= 0 && !outOfBounds) {
      if (this.state.finalscore >= 10) {
        this._stopBgm();
        this.scene.start('WinScene');
      } else {
        this._stopBgm();
        this.scene.start('GameOverScene');
      }
    }
  }

  _fullReset() {
    this.state.finalscore = 0;
    this.state.shots = 5;
    this.state.shotsTaken = 0;
    this.ui.scoreText.setText('Score: 0');
    this.ui.shotsText.setText(`Shots: ${this.state.shots}`);
    this._resetBall(false);
  }

  _handleRedBoxCollision(ball, redBox) {
    const ballVelocity = ball.body.velocity;
    const speed = Math.hypot(ballVelocity.x, ballVelocity.y);
    if (speed > 800 && speed < 1200) {
      const hoopX = this.W * 0.82;
      const hoopY = this.H * 0.36 + 50;
      const dx = hoopX - ball.x;
      const dy = hoopY - ball.y;
      const len = Math.hypot(dx, dy);
      const dirX = dx / len;
      const dirY = dy / len;
      ball.setVelocity(dirX * 600, dirY * 600);
    }
  }
}