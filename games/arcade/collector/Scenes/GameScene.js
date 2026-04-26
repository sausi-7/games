class GameScene extends Phaser.Scene {
  constructor() { super('GameScene'); }

  preload() {
    // Load from cfg
    const cfg = this.registry.get('cfg') || {};
    const images = cfg.images1 || {};
    const images2 = cfg.images2 || {};
    const ui = cfg.ui || {};
    const audio = cfg.audio || {};

    // Images
    Object.entries(images).forEach(([key, url]) => { if (!this.textures.exists(key)) this.load.image(key, url); });
    Object.entries(images2).forEach(([key, url]) => { if (!this.textures.exists(key)) this.load.image(key, url); });

    // UI (we only need 'action' now; joystick is generated)
    Object.entries(ui).forEach(([key, url]) => { if (!this.textures.exists(key)) this.load.image(key, url); });

    // Audio
    Object.entries(audio).forEach(([key, url]) => { if (!this.cache.audio.exists(key)) this.load.audio(key, url); });
  }

  // ---- Generated textures: ring + spark ----
  _ensureRingTexture() {
    if (this.textures.exists('ring_tx')) return;
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    const OUTER = 56, THICK = 14;
    g.clear();
    g.lineStyle(THICK * 1.3, 0x00d1ff, 0.35); g.strokeCircle(OUTER, OUTER, OUTER - THICK * 0.65);
    g.lineStyle(THICK, 0x00f0ff, 0.95); g.strokeCircle(OUTER, OUTER, OUTER - THICK * 0.5);
    g.lineStyle(4, 0xffffff, 0.25); g.strokeCircle(OUTER, OUTER, OUTER - THICK * 1.2);
    g.generateTexture('ring_tx', OUTER * 2, OUTER * 2);
    g.destroy();
  }

  // Prefer authored ring.png if loaded; else fall back to generated ring_tx
  _getRingTextureKey() {
    // Most configs name it 'ring'
    if (this.textures.exists('ring')) return 'ring';

    // Otherwise, try any key containing "ring" (case-insensitive)
    for (const k of Object.keys(this.textures.list)) {
      if (/ring/i.test(k)) return k;
    }

    // Fallback: make sure our procedural texture exists
    this._ensureRingTexture();
    return 'ring_tx';
  }


  _ensureSparkTexture() {
    if (this.textures.exists('spark_tx')) return;
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    const R = 6;
    g.clear(); g.fillStyle(0xffffff, 1); g.fillCircle(R, R, R);
    g.generateTexture('spark_tx', R * 2, R * 2);
    g.destroy();
  }

  // ---- Generated textures: joystick base + knob ----
  _ensureJoystickTextures() {
    if (!this.textures.exists('joy_base')) {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      const R = 150;
      g.fillStyle(0x000000, 0.2); g.fillCircle(R, R, R);
      g.lineStyle(4, 0xffffff, 0.35); g.strokeCircle(R, R, R - 2);
      g.generateTexture('joy_base', R * 2, R * 2);
      g.destroy();
    }
    if (!this.textures.exists('joy_knob')) {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      const R = 70;
      g.fillStyle(0xffffff, 0.9); g.fillCircle(R, R, R);
      g.lineStyle(3, 0x00e5ff, 0.9); g.strokeCircle(R, R, R - 2);
      g.generateTexture('joy_knob', R * 2, R * 2);
      g.destroy();
    }
  }

  // ---- HUD rounded “chip” + progress tex ----
  // ---- HUD rounded “chip” + progress tex (no quadraticCurveTo) ----
  _ensureHudTextures() {
    // Chip panel
    if (!this.textures.exists('hud_chip')) {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      const W = 420, H = 64, R = 18;

      // outer soft glow
      g.fillStyle(0x00f0ff, 0.10);
      g.fillRoundedRect(4, 4, W - 8, H - 8, R + 6);

      // inner panel
      g.fillStyle(0x0a0f14, 0.85);
      g.fillRoundedRect(0, 0, W, H, R);

      // neon border
      g.lineStyle(3, 0x00eaff, 0.8);
      g.strokeRoundedRect(1.5, 1.5, W - 3, H - 3, Math.max(R - 2, 0));

      g.generateTexture('hud_chip', W, H);
      g.destroy();
    }

    // Score bar track
    if (!this.textures.exists('hud_bar')) {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      const W = 420, H = 16, R = 8;

      g.fillStyle(0x0a0f14, 0.85);
      g.fillRoundedRect(0, 0, W, H, R);

      g.lineStyle(2, 0x00eaff, 0.6);
      g.strokeRoundedRect(1, 1, W - 2, H - 2, Math.max(R - 2, 0));

      g.generateTexture('hud_bar', W, H);
      g.destroy();
    }

    // Score bar fill “segment” (tiled)
    if (!this.textures.exists('hud_bar_fill')) {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      const W = 4, H = 12, R = 6;

      g.fillStyle(0x20ffb4, 1);
      g.fillRoundedRect(0, 0, W, H, R);

      g.generateTexture('hud_bar_fill', W, H);
      g.destroy();
    }
  }


  // _rr(g, x, y, w, h, r, fill, stroke) {
  //   g.beginPath();
  //   g.moveTo(x + r, y);
  //   g.lineTo(x + w - r, y);
  //   g.quadraticCurveTo(x + w, y, x + w, y + r);
  //   g.lineTo(x + w, y + h - r);
  //   g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  //   g.lineTo(x + r, y + h);
  //   g.quadraticCurveTo(x, y + h, x, y + h - r);
  //   g.lineTo(x, y + r);
  //   g.quadraticCurveTo(x, y, x + r, y);
  //   g.closePath();
  //   if (fill) g.fillPath();
  //   if (stroke) g.strokePath();
  // }

  // tiny pop FX at (x, y)
  _ringPopFX(x, y) {
    const p = this.add.image(x, y, 'spark_tx').setDepth(999).setScale(0.6).setAlpha(0.9);
    this.tweens.add({ targets: p, scale: 1.6, alpha: 0, duration: 220, ease: 'quad.out', onComplete: () => p.destroy() });
    for (let i = 0; i < 6; i++) {
      const s = this.add.image(x, y, 'spark_tx').setDepth(998).setScale(0.7).setAlpha(0.9);
      const ang = (i / 6) * Math.PI * 2;
      const dx = Math.cos(ang) * Phaser.Math.Between(40, 70);
      const dy = Math.sin(ang) * Phaser.Math.Between(40, 70);
      this.tweens.add({ targets: s, x: x + dx, y: y + dy, alpha: 0, scale: 0.3, duration: 220, ease: 'quad.out', onComplete: () => s.destroy() });
    }
  }

  create() {
    // ---------- CONFIG ----------
    this.cfg = this.registry.get('cfg') || {};
    const G = this.cfg.gameplay || {};
    const I = this.cfg.images2 || {};
    const A = this.cfg.audio || {};

    this._ensureRingTexture();
    this._ensureSparkTexture();
    this._ensureJoystickTextures();
    this._ensureHudTextures();

    // World
    const worldW = G.worldWidth || 1920;
    const worldH = G.worldHeight || 4000;
    this.physics.world.setBounds(0, 0, worldW, worldH);

    // ---------- STATE ----------
    this.finished = false;
    this.timeLeft = G.timerSeconds ?? 75;
    this.score = 0;
    this.TARGET_SCORE = (
      G.targetScore ??      // e.g. config.json: { "gameplay": { "targetScore": 350 } }
      G.targetscore ??      // tolerate lowercase just in case
      this.cfg.targetScore ??
      250
    );

    // Background
    if (I.background) {
      this.bgGroup = this.add.group();
      const tileH = 1080;
      const tiles = Math.ceil(worldH / tileH) + 1;
      for (let i = 0; i < tiles; i++) {
        const bg = this.add.image(worldW * 0.5, i * tileH + tileH * 0.5, 'background').setOrigin(0.5);
        const s = Math.max(1920 / bg.width, 1080 / bg.height);
        bg.setScale(s).setScrollFactor(0.2);
        this.bgGroup.add(bg);
      }
    }

    // Audio
    this.sfx = {
      bgm: A.bgm ? this.sound.add('bgm', { loop: true, volume: 0.4 }) : null,
      wind: A.wind ? this.sound.add('wind', { loop: true, volume: 0.5 }) : null,
      ring: A.collect ? this.sound.add('collect', { volume: 0.8 }) : null,
      hit: A.hit ? this.sound.add('hit', { volume: 0.7 }) : null,
      collide: A.collide ? this.sound.add('collide', { volume: 0.6 }) : null,
      win: A.win ? this.sound.add('win', { volume: 0.9 }) : null,
      lose: A.lose ? this.sound.add('lose', { volume: 0.9 }) : null,
      jump: A.jump ? this.sound.add('jump', { volume: 0.7 }) : null
    };
    if (this.sfx.bgm) this.sfx.bgm.play();
    if (this.sfx.wind) this.sfx.wind.play();

    // Player
    const spawnX = worldW * 0.5, spawnY = 200;
    const pW = G.player?.displayW ?? 96, pH = G.player?.displayH ?? 96;
    this.player = this.add.sprite(spawnX, spawnY, 'player').setOrigin(0.5);
    this.player.setDisplaySize(pW, pH);
    this.physics.add.existing(this.player);
    this._fitBodyToDisplay(this.player, pW, pH);
    this.player.body.setCollideWorldBounds(true);
    this.player.body.setMaxVelocity(G.player?.maxVx ?? 550, G.player?.maxVy ?? 1700);
    this.player.body.setDrag(120, 0);
    this.player.body.setGravityY(G.player?.gravityY ?? 1100);
    this.player.body.setBounce(0.05);

    // Breeze
    this.windX = Phaser.Math.Between(-50, 50);

    // Ground & Pad
    const groundY = worldH - 40;
    this.ground = this.add.sprite(worldW * 0.5, groundY, 'platform1').setOrigin(0.5);
    this.ground.setDisplaySize(worldW, 80);
    this.physics.add.existing(this.ground, true);
    this.ground.body.setSize(worldW, 80);
    this.ground.body.updateFromGameObject();

    const padW = 360, padH = 32;
    const padX = worldW * 0.5 + Phaser.Math.Between(-350, 350);
    const padY = groundY - 100;
    this.pad = this.add.sprite(padX, padY, 'platform4').setOrigin(0.5);
    this.pad.setDisplaySize(padW, padH);
    this.physics.add.existing(this.pad, true);
    this.pad.body.setSize(padW, padH);

    // Rings
    // Rings
    this.rings = this.physics.add.staticGroup();
    const ringCount = G.rings?.count ?? 12;
    const ringSpacing = (worldH - 1000) / ringCount;

    // NEW: decide the texture to use (JSON ring.png if present, else fallback)
    const ringTexKey = this._getRingTextureKey();

    for (let i = 0; i < ringCount; i++) {
      const rx = Phaser.Math.Between(300, worldW - 300);
      const ry = 500 + i * ringSpacing;

      // Use resolved key here instead of hardcoded 'ring_tx'
      const r = this.add.image(rx, ry, ringTexKey).setOrigin(0.5);

      const rw = G.rings?.displayW ?? 112, rh = G.rings?.displayH ?? 112;
      r.setDisplaySize(rw, rh);
      this.physics.add.existing(r, true);
      r.body.setSize(rw, rh);
      r.setData('scored', false);
      this.rings.add(r);
    }


    // Obstacles
    this.obstacles = this.physics.add.group({ allowGravity: false, immovable: true });
    const OCFG = this.cfg.gameplay?.obstacles || {};
    const oCount = OCFG.count ?? 8, oW = OCFG.displayW ?? 96, oH = OCFG.displayH ?? 96, oSpeed = OCFG.speed ?? 220;
    const minY = 900, maxY = this.physics.world.bounds.height - 400;
    for (let i = 0; i < oCount; i++) {
      const ox = Phaser.Math.Between(300, worldW - 300);
      const oy = Phaser.Math.Between(minY, maxY);
      const o = this.physics.add.sprite(ox, oy, 'enemy').setOrigin(0.5);
      o.setDisplaySize(oW, oH);
      this._fitBodyToDisplay(o, oW, oH);
      o.body.setAllowGravity(false);
      o.body.setImmovable(true);
      const span = Phaser.Math.Between(380, 680);
      const leftX = Math.max(140, ox - span * 0.5);
      const rightX = Math.min(worldW - 140, ox + span * 0.5);
      const dir = Math.random() < 0.5 ? -1 : 1;
      o.body.setVelocityX(oSpeed * dir);
      o.setData('leftX', leftX);
      o.setData('rightX', rightX);
      this.obstacles.add(o);
    }

    // Collisions / Overlaps
    this.physics.add.overlap(this.player, this.obstacles, () => this._hitObstacle());

    this.physics.add.overlap(this.player, this.rings, (pl, ring) => {
      if (this.finished || ring.getData('scored')) return;
      ring.setData('scored', true);
      this._ringPopFX(ring.x, ring.y);
      if (ring.body) { ring.body.enable = false; ring.body.checkCollision.none = true; }
      this.tweens.add({ targets: ring, scale: 0.7, alpha: 0, duration: 180, ease: 'quad.in', onComplete: () => ring.setVisible(false).setActive(false) });
      this.score += (this.cfg.gameplay?.rings?.scorePerRing ?? 50);
      this._updateScoreLabel(true); // animate
      if (this.sfx.ring) this.sfx.ring.play();
    });

    // Ignore ground if overlapping pad this step
    this.physics.add.collider(
      this.player,
      this.ground,
      () => {
        if (!this.finished) {
          if (this.sfx.hit) this.sfx.hit.play();
          this._lose('ground-impact');
        }
      },
      (player, ground) => {
        // Only allow a ground-impact if:
        // - game not finished
        // - NOT overlapping the pad
        // - falling fast enough (tune 200 as needed)
        return !this.finished && !this._isOnPad() && player.body.velocity.y > 200;
      },
      this
    );
    // Landing judged only on pad
    this.physics.add.collider(this.player, this.pad, () => this._handleLanding(true));

    // Camera
    this.cameras.main.setBounds(0, 0, worldW, worldH);
    this.cameras.main.startFollow(this.player, true, 0.1, 0.15);
    this.cameras.main.setLerp(0.1, 0.2);

    // Input (keyboard still supported)
    this._setupKeyboard();

    // Touch Controls: Joystick + Action button
    this._setupTouchJoystickAndAction();

    // **Allow multi-touch** (add two extra pointers)
    this.input.addPointer(2);

    // ================= HUD (new cool style) =================
    this._buildHud();

    // Timer
    this.countdown = this.time.addEvent({
      delay: 1000, loop: true,
      callback: () => {
        if (this.finished) return;
        this.timeLeft = Math.max(0, this.timeLeft - 1);
        this._setHudValue(this.timerChip, (this.cfg.texts?.timer_label ?? 'Time'), this.timeLeft);
        if (this.timeLeft <= 0) this._lose('time');
      }
    });

    if (this.sfx.jump) this.sfx.jump.play();
  }

  update(_, delta) {
    if (this.finished) return;

    const dt = delta / 1000;

    // Wind drift
    this.player.body.velocity.x += this.windX * dt;

    // Inputs
    const vx = this.player.body.velocity.x;
    let vy = this.player.body.velocity.y;

    // Glide (hold action) up / release fall
    const liftA = (this.cfg.gameplay?.player?.liftAccel ?? 1400);
    const maxUp = (this.cfg.gameplay?.player?.maxUpSpeed ?? -520);
    const maxDown = (this.cfg.gameplay?.player?.maxDownSpeed ?? 1700);
    if (this._isActionHeld()) {
      vy = Math.max(maxUp, vy - liftA * (delta / 1000));
    } else {
      vy = Math.min(maxDown, vy);
    }
    this.player.body.setVelocityY(vy);

    // Horizontal steer (keyboard OR joystick X)
    const steerAx = (this.cfg.gameplay?.player?.steerAccel ?? 720);
    const joyX = this._getJoyX(); // -1..1
    if (Math.abs(joyX) > 0.15) {
      this.player.body.setVelocityX(vx + (steerAx * joyX) * dt);
    } else {
      if (this._isLeftDown()) this.player.body.setVelocityX(vx - steerAx * dt);
      if (this._isRightDown()) this.player.body.setVelocityX(vx + steerAx * dt);
    }

    // **Face direction**
    const faceVX = this.player.body.velocity.x;
    if (faceVX > 10) this.player.setFlipX(false);
    else if (faceVX < -10) this.player.setFlipX(true);

    // Tilt
    const tiltMax = 18;
    this.player.angle = Phaser.Math.Clamp(Phaser.Math.Linear(this.player.angle, this.player.body.velocity.x * 0.02, 0.15), -tiltMax, tiltMax);

    // Altitude (cool chip)
    this._setHudValue(this.altChip, (this.cfg.texts?.alt_label ?? 'Alt'), this._altitudeString());

    // Fail-safe
    if (this.player.y > this.physics.world.bounds.height + 50) {
      this._lose('fell');
    }

    // Obstacle patrol
    this.obstacles.children.iterate(o => {
      if (!o || !o.body) return;
      const l = o.getData('leftX'), r = o.getData('rightX');
      if (o.x <= l && o.body.velocity.x < 0) { o.body.setVelocityX(Math.abs(o.body.velocity.x)); }
      if (o.x >= r && o.body.velocity.x > 0) { o.body.setVelocityX(-Math.abs(o.body.velocity.x)); }
    });

    // Subtle HUD jiggle (parallax vibe)
    const t = this.time.now * 0.0015;
    const wob = Math.sin(t) * 1.2;
    [this.timerChip, this.scoreChip, this.altChip].forEach(c => c && c.setY(c.baseY + wob));
    if (this.scoreBarContainer) this.scoreBarContainer.setY(this.scoreBarBaseY + wob);
  }

  // ================= HUD helpers =================
  _buildHud() {
    // row start + spacing
    const rowY = 24;
    const gapX = 16;
    let nextX = 24;

    // Create chips side-by-side
    this.timerChip = this._hudChip(nextX, rowY, (this.cfg.texts?.timer_label ?? 'Time'), this.timeLeft);
    nextX += this.timerChip.bg.width + gapX;

    this.scoreChip = this._hudChip(nextX + 300, rowY, (this.cfg.texts?.score_label ?? 'Score'), this._scoreWithTarget());
    nextX += this.scoreChip.bg.width + gapX;

    this.altChip = this._hudChip(nextX + 500, rowY, (this.cfg.texts?.alt_label ?? 'Alt'), this._altitudeString());

    // Score bar directly under the Score chip
    const barX = this.scoreChip.x;
    const barY = this.scoreChip.y + this.scoreChip.bg.height + 10;
    this._createScoreBar(barX, barY);
    this._refreshScoreBar();
  }


  _hudChip(x, y, label, value) {
    const chip = this.add.container(x, y).setScrollFactor(0).setDepth(1000);
    chip.baseY = y;

    const bg = this.add.image(0, 0, 'hud_chip').setOrigin(0, 0);
    chip.bg = bg;

    const txt = this.add.text(18, 18, '', {
      fontFamily: (this.cfg.font?.family || 'Outfit, Arial'),
      fontSize: 28,
      fontStyle: 'bold',
      color: '#EFFFFF',
      stroke: '#001f26',
      strokeThickness: 4
    });
    txt.setShadow(0, 0, '#00eaff', 16, true, true);

    const val = this.add.text(18, 18, '', {
      fontFamily: (this.cfg.font?.family || 'Outfit, Arial'),
      fontSize: 26,
      fontStyle: 'bold',
      color: '#A7FFEA',
      stroke: '#001f26',
      strokeThickness: 3
    });
    val.setShadow(0, 0, '#00ffc8', 12, true, true);

    chip.add([bg, txt, val]);
    chip.lbl = txt; chip.val = val;

    this._setHudValue(chip, label, value);
    return chip;
  }


  _setHudValue(chip, label, value) {
    if (!chip) return;

    // Set label with trailing colon
    chip.lbl.setText(String(label) + ':');

    // Place value right after the label
    const GAP = 8;
    chip.val.setText(String(value));
    chip.val.x = chip.lbl.x + chip.lbl.width + GAP;

    // keep both on the same row (in case something changed them)
    chip.lbl.y = 18;
    chip.val.y = 18;
  }


  _createScoreBar(x, y) {
    // container
    const cont = this.add.container(x, y).setScrollFactor(0).setDepth(1000);
    this.scoreBarContainer = cont;
    this.scoreBarBaseY = y;

    const track = this.add.image(0, 0, 'hud_bar').setOrigin(0, 0);
    cont.add(track);

    const W = track.width - 8; // inner margin
    const H = track.height - 8;
    // create fill as a tiled sprite so we can set width
    const fill = this.add.tileSprite(4, 2, 1, H, 'hud_bar_fill').setOrigin(0, 0);
    cont.add(fill);
    cont._fill = fill;
    cont._maxW = W;

    // target text (right aligned)
    const targetTxt = this.add.text(track.width - 8, -24, `Target: ${this.TARGET_SCORE}`, {
      fontFamily: (this.cfg.font?.family || 'Outfit, Arial'),
      fontSize: 20,
      color: '#C2FFF3',
      stroke: '#001f26',
      strokeThickness: 3
    }).setOrigin(1, 1);
    targetTxt.setShadow(0, 0, '#00eaff', 8, true, true);
    cont.add(targetTxt);
  }

  _refreshScoreBar() {
    if (!this.scoreBarContainer) return;
    const p = Phaser.Math.Clamp(this.score / this.TARGET_SCORE, 0, 1);
    const w = Math.max(1, Math.floor(this.scoreBarContainer._maxW * p));
    this.scoreBarContainer._fill.width = w;
    // pulsate a little when full
    if (p >= 1) {
      this.tweens.add({
        targets: this.scoreBarContainer._fill,
        alpha: { from: 1, to: 0.5 },
        yoyo: true, repeat: 2, duration: 160
      });
    }
  }

  // ===============================
  // Touch Joystick + Action
  // ===============================
  _setupTouchJoystickAndAction() {
    // Joystick state (screen-space)
    this.joy = {
      base: null,
      knob: null,
      centerX: 180,
      centerY: this.scale.height - 180,
      radius: 90,
      pointerId: null,
      x: 0, y: 0, active: false
    };

    // Graphics (stay in screen-space)
    this.joy.base = this.add.image(this.joy.centerX, this.joy.centerY, 'joy_base')
      .setScrollFactor(0).setDepth(1001).setAlpha(0.9);
    this.joy.knob = this.add.image(this.joy.centerX, this.joy.centerY, 'joy_knob')
      .setScrollFactor(0).setDepth(1002).setAlpha(1);

    // --- GLOBAL POINTER LISTENERS ---
    this.input.on('pointerdown', (p) => {
      if (this.joy.pointerId !== null) return;
      if (!this._isInJoyArea(p.x, p.y)) return;
      this._joyStart(p);
    });
    this.input.on('pointermove', (p) => {
      if (p.id === this.joy.pointerId) this._joyMove(p);
    });
    this.input.on('pointerup', (p) => {
      if (p.id === this.joy.pointerId) this._joyEnd(p);
    });
    this.input.on('pointerupoutside', (p) => {
      if (p.id === this.joy.pointerId) this._joyEnd(p);
    });

    // Action button (hold to glide)
    const btnX = this.scale.width - 140, btnY = this.scale.height - 140;
    this.actionBtn = this.add.image(btnX, btnY, 'action')
      .setScrollFactor(0).setDepth(1001).setInteractive({ useHandCursor: true });
    this.actionBtn.setDisplaySize(200, 200);

    this.actionHeld = false;
    const press = img => { img.setScale(0.92); img.setAlpha(0.85); };
    const release = img => { img.setScale(1); img.setAlpha(1); };
    this.actionBtn.on('pointerdown', () => { this.actionHeld = true; press(this.actionBtn); });
    this.actionBtn.on('pointerup', () => { this.actionHeld = false; release(this.actionBtn); });
    this.actionBtn.on('pointerout', () => { this.actionHeld = false; release(this.actionBtn); });
  }

  _joyStart(p) {
    this.joy.pointerId = p.id;
    this.joy.active = true;
    this._joyMove(p);
  }

  _joyMove(p) {
    if (!this.joy.active || p.id !== this.joy.pointerId) return;
    const dx = p.x - this.joy.centerX;
    const dy = p.y - this.joy.centerY;
    const dist = Math.min(Math.hypot(dx, dy), this.joy.radius);
    const ang = Math.atan2(dy, dx);
    const kx = Math.cos(ang) * dist;
    const ky = Math.sin(ang) * dist;

    this.joy.knob.setPosition(this.joy.centerX + kx, this.joy.centerY + ky);

    // normalize to -1..1 range
    this.joy.x = kx / this.joy.radius;
    this.joy.y = ky / this.joy.radius;
  }

  _joyEnd(p) {
    this.joy.pointerId = null;
    this.joy.active = false;
    this.joy.x = 0; this.joy.y = 0;
    this.joy.knob.setPosition(this.joy.centerX, this.joy.centerY);
  }

  _getJoyX() { return this.joy?.x || 0; }

  // ===============================
  // Other helpers / input / rules
  // ===============================
  _hitObstacle() {
    if (this.finished) return;
    if (this.sfx.hit) this.sfx.hit.play();
    this._lose('obstacle');
  }

  _fitBodyToDisplay(sprite, w, h) {
    if (!sprite.body) return;
    sprite.body.setSize(w, h);
    sprite.body.setOffset((sprite.width - w) * 0.5, (sprite.height - h) * 0.5);
  }

  _setupKeyboard() {
    const KB = Phaser.Input.Keyboard.KeyCodes;
    this.keyLeft = this.input.keyboard.addKey(KB.LEFT);
    this.keyRight = this.input.keyboard.addKey(KB.RIGHT);
    this.keyUp = this.input.keyboard.addKey(KB.UP);
    this.keyW = this.input.keyboard.addKey(KB.W);
    this.keyA = this.input.keyboard.addKey(KB.A);
    this.keyD = this.input.keyboard.addKey(KB.D);
    this.keySpace = this.input.keyboard.addKey(KB.SPACE);
  }

  _isLeftDown() { return this.keyLeft?.isDown || this.keyA?.isDown; }
  _isRightDown() { return this.keyRight?.isDown || this.keyD?.isDown; }

  _isActionHeld() {
    // Touch action OR keyboard (Space / Up / W)
    return !!(this.actionHeld || this.keySpace?.isDown || this.keyUp?.isDown || this.keyW?.isDown);
  }

  _handleLanding(onPad) {
    if (this.finished) return;
    if (!onPad) { this._lose('missed-pad'); return; }
    if (this.score >= this.TARGET_SCORE) {
      this._win();
    } else {
      if (this.sfx.hit) this.sfx.hit.play();
      this._lose('target-not-met', 'You did not complete target');
    }
  }

  _isOnPad() { return this.physics.world.overlap(this.player, this.pad); }

  _altitudeString() {
    const h = Math.max(0, Math.floor((this.physics.world.bounds.height - this.player.y)));
    return `${h}m`;
  }

  _scoreWithTarget() {
    const cur = String(this.score).padStart(2, '0');
    return `${cur}/${this.TARGET_SCORE}`;
  }

  _updateScoreLabel(pop = false) {
    // update chip text
    this._setHudValue(this.scoreChip, (this.cfg.texts?.score_label ?? 'Score'), this._scoreWithTarget());
    this._refreshScoreBar();

    if (pop && this.scoreChip) {
      this.tweens.add({
        targets: this.scoreChip,
        scaleX: 1.04, scaleY: 1.04,
        yoyo: true, duration: 110, ease: 'quad.out'
      });
      // little "+50" fly-up (looks slick)
      const fly = this.add.text(this.scoreChip.x + 360, this.scoreChip.y + 12, '+50', {
        fontFamily: (this.cfg.font?.family || 'Outfit, Arial'),
        fontSize: 26, fontStyle: 'bold', color: '#2CFFBA', stroke: '#001f26', strokeThickness: 3
      }).setScrollFactor(0).setDepth(1001);
      fly.setShadow(0, 0, '#2CFFBA', 10, true, true);
      this.tweens.add({
        targets: fly, y: fly.y - 24, alpha: 0,
        duration: 400, ease: 'quad.out', onComplete: () => fly.destroy()
      });
    }
  }

  _endCleanup() {
    if (this.sfx?.bgm) this.sfx.bgm.stop();
    if (this.sfx?.wind) this.sfx.wind.stop();
    if (this.countdown) { this.countdown.remove(false); this.countdown = null; }
    this.input.keyboard?.removeAllKeys(true);
    this.input.removeAllListeners();
  }

  _isInJoyArea(px, py) {
    // circular hit test around the joystick base (bottom-left)
    const dx = px - this.joy.centerX;
    const dy = py - this.joy.centerY;
    return (dx * dx + dy * dy) <= (this.joy.radius * this.joy.radius) * 2.2; // generous
  }

  _gotoScene(key, data) { this._endCleanup(); this.scene.start(key, data); }

  _win() {
    if (this.finished) return;
    this.finished = true;
    if (this.sfx.win) this.sfx.win.play();
    const result = { state: 'win', score: this.score, timeLeft: this.timeLeft };
    this.registry.set('result', result);
    this.events.emit('game-finished', 'win');
    this._gotoScene('WinScene', { result });
  }

  _lose(reason, message) {
    if (this.finished) return;
    this.finished = true;
    if (this.sfx.lose) this.sfx.lose.play();
    const result = { state: 'lose', score: this.score, reason, message };
    if (reason === 'target-not-met' && !message) result.message = 'You did not complete target';
    this.registry.set('result', result);
    this.events.emit('game-finished', 'lose');
    this._gotoScene('GameOverScene', { result });
  }
}
