class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');

    // Runtime state
    this._timeLeft = 0;
    this._finished = false;

    this._score = 0;
    this._health = 100;
    this._ammo = 0;

    this._lastShotAt = 0;

    this._touchLeft = false;
    this._touchRight = false;
    this._touchShoot = false;
    this._touchJump = false;

    // Refs
    this._player = null;
    this._ground = null;

    this._zombies = null;
    this._bullets = null;
    this._pickups = null;

    this._spawnTimer = null;
    this._pickupTimer = null;
    this._difficultyTimer = null;

    this._bgm = null;

    // UI
    this._scoreText = null;
    this._healthText = null;
    this._ammoText = null;
    this._timerText = null;

    this._targetScore = 50;
  }

  init() {
    // reset core run-state every time this scene starts
    this._score = 0;
    this._timeLeft = 0;
    this._finished = false;
    this._lastShotAt = 0;
    this._transitioning = false;

    // clear touch latches
    this._touchLeft = this._touchRight = this._touchShoot = this._touchJump = false;

    // if previous run paused physics, resume now
    if (this.physics && this.physics.world) this.physics.world.resume();
  }


  preload() {
    const cfg = this.registry.get('cfg') || {};
    const images = (cfg.images1 || {});
    const images2 = (cfg.images2 || {});
    const ui = (cfg.ui || {});
    const audio = (cfg.audio || {});
    const font = cfg.font || null;

    // Optional font load via CSS
    if (font && font.url && font.family) {
      const f = new FontFace(font.family, `url(${font.url})`);
      f.load().then(ff => document.fonts.add(ff)).catch(() => { });
    }

    // IMAGES
    Object.entries(images).forEach(([key, url]) => this.load.image(key, url));
    Object.entries(images2).forEach(([key, url]) => this.load.image(key, url));
    Object.entries(ui).forEach(([key, url]) => this.load.image(key, url));
    // AUDIO
    Object.entries(audio).forEach(([key, url]) => this.load.audio(key, url));
  }

  create() {
    const cfg = this.registry.get('cfg') || {};
    const G = cfg.gameplay || {};
    const T = cfg.texts || {};
    const images2 = (cfg.images2 || {});

    this._score = 0;

    // === LANDSCAPE WORLD ===
    const worldW = 1920;
    const worldH = 1080;

    if (this.input && this.input.addPointer) {
      this.input.addPointer(2);
    }

    // Camera & world
    this.sys.cameras.main.setBackgroundColor('#000000');
    this.physics.world.setBounds(0, 0, worldW, worldH);
    this._finished = false;

    // Background (optional image)
    if (images2.background) {
      const bg = this.add.image(worldW / 2, worldH / 2, 'background');
      bg.setDisplaySize(worldW, worldH);
      bg.setDepth(-100);
    }

    // Ground strip (thin collider at bottom)
    this._ground = this.add.image(worldW / 2, worldH - 60, 'platform');
    this._ground.setDisplaySize(worldW, 80);
    this.physics.add.existing(this._ground, true); // static
    this._fitBody(this._ground, { immovable: true }); // centers & refreshes static body

    // Player (no fallback; expect 'player' in config)
    this._player = this.add.image(worldW / 2, worldH - 300, 'player');
    this._player.setDisplaySize(300, 340);
    this.physics.add.existing(this._player);
    this._player.body.setCollideWorldBounds(true);
    this._fitBody(this._player); // match 96x128
    this._inflateBody(this._player, this._playerHitboxPadX, this._playerHitboxPadY);

    this._player.body.setMaxVelocity(1000, 1000);
    this._player.body.setDrag(1600, 0);
    this._playerFacingRight = true;

    // ✅ Add gravity so player can land & jump
    const gravY = (G.gravityY ?? 700);
    this._player.body.setGravityY(gravY);
    // (optional but nice) a tiny bounce helps settle on the ground
    this._player.body.setBounce(0.02);

    // Collide with ground
    this.physics.add.collider(this._player, this._ground);

    // Groups
    this._zombies = this.physics.add.group({ runChildUpdate: false });
    this._bullets = this.physics.add.group({ runChildUpdate: false, maxSize: 30 });
    this._pickups = this.physics.add.group({ runChildUpdate: false, maxSize: 8 });

    // Gameplay params
    this._timeLeft = G.timerSeconds ?? 90;
    this._health = G.playerHealth ?? 100;
    this._ammo = G.startAmmo ?? 30;

    this._targetScore = (G.targetScore ?? 50);

    this._playerSpeed = G.playerSpeed ?? 360;
    this._jumpPower = G.jumpPower ?? -650;
    this._bulletSpeed = G.bulletSpeed ?? 900;
    this._fireRateMs = G.fireRateMs ?? 200;

    this._zombieSpeed = G.zombieSpeed ?? 120;
    this._spawnInterval = G.enemySpawnRate ?? 1600; // ms
    this._spawnMinInterval = G.enemySpawnMinRate ?? 600; // ms (difficulty cap)
    this._spawnDecay = G.enemySpawnDecay ?? 100; // reduce interval every step
    this._maxZombies = G.maxZombies ?? 18;

    this._pickupInterval = G.pickupSpawnRate ?? 4500;
    this._maxPickups = G.maxPickups ?? 4;

    // ✅ NEW: pickup tuning
    this._maxAmmo = G.maxAmmo ?? 120;
    this._ammoPickupAmount = G.ammoPickupAmount ?? 12;
    this._healthPickupAmount = G.healthPickupAmount ?? 25;

    // Physics overlaps/colliders
    this.physics.add.overlap(this._bullets, this._zombies, this._onBulletHitsZombie, null, this);
    this.physics.add.overlap(this._player, this._zombies, this._onPlayerHitsZombie, null, this);
    this.physics.add.overlap(this._player, this._pickups, this._onPlayerCollectsPickup, null, this);

    // UI (gameplay-only)
    const fontFamily = (cfg.font && cfg.font.family) ? cfg.font.family : 'Arial';
    const pad = 20;

    this.add.image(170, 70, 'scoreback')
    this.add.image(960, 70, 'scoreback')
    this.add.image(1700, 70, 'scoreback')


    // CHANGED: include target "/ X"
    const scoreLabel = (cfg.texts?.score_label) ?? 'Score:';
    this._scoreText = this.add.text(
      pad + 15, pad + 25,
      `${scoreLabel} 0 / ${this._targetScore}`,
      { fontFamily, fontSize: '46px', color: '#030202ff' }
    ).setScrollFactor(0);
    this._healthText = this.add.text(pad + 820, pad + 25, `Health: ${this._health}`, { fontFamily, fontSize: '46px', color: '#000000ff' }).setScrollFactor(0);
    // this._ammoText = this.add.text(pad, pad + 90, `Ammo: ${this._ammo}`, { fontFamily, fontSize: '32px', color: '#66ccff' }).setScrollFactor(0);
    this._timerText = this.add.text(worldW - pad - 70, pad + 25, this._fmtTime(this._timeLeft), { fontFamily, fontSize: '46px', color: '#030301ff' }).setOrigin(1, 0).setScrollFactor(0);

    // Input
    this._cursors = this.input.keyboard.createCursorKeys();
    this._keys = this.input.keyboard.addKeys({ A: 'A', D: 'D', S: 'S', SPACE: 'SPACE', W: 'W' });

    // Mobile controls (standard positions; auto adapt to canvas size)
    // Virtual joystick (left) + Action button (right)
    this._buildJoystickControls(cfg);


    // Timers
    this._spawnTimer = this.time.addEvent({ delay: this._spawnInterval, loop: true, callback: this._spawnZombie, callbackScope: this });
    this._pickupTimer = this.time.addEvent({ delay: this._pickupInterval, loop: true, callback: this._spawnPickup, callbackScope: this });
    this._difficultyTimer = this.time.addEvent({ delay: 5000, loop: true, callback: this._increaseDifficulty, callbackScope: this });

    // Game clock
    this._secTimer = this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        if (this._finished) return;
        this._timeLeft -= 1;
        if (this._timeLeft < 0) this._timeLeft = 0;
        this._timerText.setText(this._fmtTime(this._timeLeft));
        if (this._timeLeft <= 0) this._win();
      }
    });

    // Audio
    if (this.sound && cfg.audio && cfg.audio.bgm) {
      this._bgm = this.sound.add('bgm', { volume: 0.5, loop: true });
      this._bgm.play();
    }

    this._sfxAttack = this.sound.get('attack') || this.sound.add('attack', { volume: 0.75 });
    this._sfxHit = this.sound.get('hit') || this.sound.add('hit', { volume: 0.8 });
    this._sfxCollect = this.sound.get('collect') || this.sound.add('collect', { volume: 0.8 });
    this._sfxDestroy = this.sound.get('destroy') || this.sound.add('destroy', { volume: 0.7 });
    this._sfxWin = this.sound.get('win') || (cfg.audio.level_complete ? this.sound.add('level_complete', { volume: 0.8 }) : null);
    this._sfxLose = this.sound.get('lose') || (cfg.audio.game_over ? this.sound.add('game_over', { volume: 0.8 }) : null);
  }

  update() {
    if (this._finished) return;

    const cam = this.sys.cameras.main;
    const worldW = cam.width;

    // Horizontal input
    // Horizontal input (keyboard OR joystick)
    let vx = 0;

    const joyX = (this._joy?.vecX ?? 0);
    // threshold so tiny jitters don’t move the player
    const joyActive = Math.abs(joyX) > 0.18;

    if (this._cursors.left.isDown || this._keys.A.isDown) {
      vx = -this._playerSpeed;
      this._playerFacingRight = false;
    } else if (this._cursors.right.isDown || this._keys.D.isDown) {
      vx = this._playerSpeed;
      this._playerFacingRight = true;
    } else if (joyActive) {
      vx = this._playerSpeed * joyX; // analog scale
      this._playerFacingRight = (joyX >= 0);
    }

    this._player.body.setVelocityX(vx);


    // Quick turn (S / Down)
    if (Phaser.Input.Keyboard.JustDown(this._cursors.down) || Phaser.Input.Keyboard.JustDown(this._keys.S)) {
      this._playerFacingRight = !this._playerFacingRight;
    }

    this._player.setFlipX(!this._playerFacingRight);

    // Shooting
    if (this._touchShoot || this._cursors.space.isDown || this._keys.SPACE.isDown) {
      this._tryShoot();
    }

    // Jumping (W / Up arrow / touch button)
    // Keyboard/tap jump
    let jumpPressed = Phaser.Input.Keyboard.JustDown(this._cursors.up) || Phaser.Input.Keyboard.JustDown(this._keys.W);

    // Joystick "up" to jump (one-shot latch per upward push)
    if (!jumpPressed && this._joy) {
      const upAmount = -(this._joy.vecY); // vecY is down+, so invert
      const upPressed = upAmount > 0.35;   // push up beyond threshold
      if (upPressed && !this._joy.jumpedLatch) {
        jumpPressed = true;
        this._joy.jumpedLatch = true;
      }
      if (!upPressed && this._joy.jumpedLatch) {
        // release latch after stick comes back down
        this._joy.jumpedLatch = false;
      }
    }

    if (jumpPressed) {
      this._tryJump();
    }


    // Cleanup off-screen bullets & zombies (use dynamic worldW)
    this._bullets.children.iterate(b => {
      if (!b) return;
      if (b.active && (b.x < -50 || b.x > worldW + 50)) b.destroy();
    });
    this._zombies.children.iterate(z => {
      if (!z) return;
      if (z.active && (z.x < -120 || z.x > worldW + 120)) z.destroy();
    });

    // UI refresh
    const lbl = (this.registry.get('cfg')?.texts?.score_label) ?? 'Score:';
    this._scoreText.setText(`${lbl} ${this._score} / ${this._targetScore}`);
    this._healthText.setText(`Health: ${this._health}`);
    // this._ammoText.setText(`Ammo: ${this._ammo}`);
  }

  // ===== Helpers =====

  _fmtTime(sec) {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `Time: ${m}:${s}`;
  }


  // ===== Virtual Joystick + Action Button =====

  _buildJoystickControls(cfg) {
    const cam = this.cameras.main;
    const w = cam.width, h = cam.height;

    // internal joy state
    this._joy = {
      base: null, thumb: null,
      dragging: false,
      startX: 0, startY: 0,
      vecX: 0, vecY: 0,       // normalized (-1..1)
      jumpedLatch: false      // one-shot jump latch per upward push
    };

    // sizes & layout
    const margin = 24;
    const baseRadius = 110;
    const thumbRadius = 46;

    // left-bottom placement for joystick
    const baseX = margin + baseRadius;
    const baseY = h - (margin + baseRadius);

    // right-bottom placement for action button
    const actionSize = 182;
    // const actionX = w - (margin + actionSize * 0.5);
    // const actionY = h - (margin + actionSize * 0.5);

    // make textures (1-time)
    const baseKey = this._createCircleTexture('__joy_base', baseRadius * 2, 0xffffff, 0.12, 4, 0xffffff, 0.35);
    const thumbKey = this._createCircleTexture('__joy_thumb', thumbRadius * 2, 0xffffff, 0.35, 4, 0xffffff, 0.8);

    // JOYSTICK: base
    const base = this.add.image(baseX + 100, baseY - 100, baseKey)
      .setScrollFactor(0).setDepth(1000).setInteractive({ useHandCursor: false });
    // JOYSTICK: thumb
    const thumb = this.add.image(baseX + 100, baseY - 100, thumbKey)
      .setScrollFactor(0).setDepth(1001).setInteractive();

    this._joy.base = base;
    this._joy.thumb = thumb;

    // Input logic for joystick
    const startDrag = (pointer) => {
      // only start if touching near the base (left half of the screen)
      const isLeftSide = pointer.x <= (w * 0.6); // generous left zone
      if (!isLeftSide) return;
      this._joy.dragging = true;
      this._joy.startX = base.x;
      this._joy.startY = base.y;
      this._updateJoystick(pointer.x, pointer.y, baseRadius);
    };

    const moveDrag = (pointer) => {
      if (!this._joy.dragging) return;
      this._updateJoystick(pointer.x, pointer.y, baseRadius);
    };

    const endDrag = () => {
      if (!this._joy.dragging) return;
      this._resetJoystick();
    };

    this.input.on('pointerdown', startDrag);
    this.input.on('pointermove', moveDrag);
    this.input.on('pointerup', endDrag);
    this.input.on('pointerupoutside', endDrag);
    this.input.on('pointercancel', endDrag);

    // ACTION button (fire)
    // ACTION button (fire)
    const actionKey = (cfg.ui && cfg.ui.action) ? 'action' : this._createActionFallback();
    const action = this.add.image(0, 0, actionKey)
      .setScrollFactor(0).setDepth(1000).setAlpha(0.9);
    // const actionSize = 132;
    action.setDisplaySize(actionSize, actionSize);
    action.setInteractive({ useHandCursor: true });

    // keep your desired offsets here (single source of truth)
    const ACTION_OFFSET_X = -100;
    const ACTION_OFFSET_Y = -100;

    // helper: place action using current canvas size + offsets
    const placeAction = (width, height) => {
      const margin = 24;
      const ax = width - (margin + actionSize * 0.5) + ACTION_OFFSET_X;
      const ay = height - (margin + actionSize * 0.5) + ACTION_OFFSET_Y;
      action.setPosition(ax, ay);
    };

    // initial placement
    placeAction(w, h);

    // wire fire press
    action.on('pointerdown', () => { this._touchShoot = true; action.setScale(0.95).setAlpha(0.75); });
    const release = () => { this._touchShoot = false; action.setScale(1).setAlpha(0.9); };
    action.on('pointerup', release);
    action.on('pointerout', release);
    action.on('pointerupoutside', release);
    action.on('pointercancel', release);

    // Re-anchor on resize (preserve offsets)
    const onResize = ({ width, height }) => {
      const nbx = margin + baseRadius;
      const nby = height - (margin + baseRadius);
      base.setPosition(nbx, nby);
      thumb.setPosition(nbx, nby);
      this._resetJoystick(); // reset vec & thumb
      placeAction(width, height); // <-- uses the same offsets
    };
    this.scale.on('resize', onResize);

    // clean up listener on shutdown to avoid duplicates on replay
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', onResize);
    });

  }

  _updateJoystick(px, py, maxDist) {
    const j = this._joy;
    const dx = px - j.startX;
    const dy = py - j.startY;

    // clamp thumb within base circle
    const dist = Math.sqrt(dx * dx + dy * dy);
    const clamped = Math.min(dist, maxDist);
    const nx = (dist > 0) ? dx / dist : 0;
    const ny = (dist > 0) ? dy / dist : 0;

    const thumbX = j.startX + nx * clamped;
    const thumbY = j.startY + ny * clamped;
    j.thumb.setPosition(thumbX, thumbY);

    // normalized vector (-1..1). In screen coords, down is +Y, so invert for gameplay
    j.vecX = this._clamp(nx, -1, 1);
    j.vecY = this._clamp(ny, -1, 1); // downward positive; we'll invert when deciding jump
  }

  _resetJoystick() {
    const j = this._joy;
    j.dragging = false;
    j.vecX = 0;
    j.vecY = 0;
    j.jumpedLatch = false;
    if (j.thumb && j.base) j.thumb.setPosition(j.base.x, j.base.y);
  }

  _createCircleTexture(key, size, fill, fillA, strokeW, stroke, strokeA) {
    if (this.textures.exists(key)) return key;
    const g = this.add.graphics();
    g.fillStyle(fill, fillA ?? 1).fillCircle(size / 2, size / 2, size / 2);
    if (strokeW > 0) g.lineStyle(strokeW, stroke, strokeA ?? 1).strokeCircle(size / 2, size / 2, size / 2 - strokeW * 0.5);
    g.generateTexture(key, size, size);
    g.destroy();
    return key;
  }

  _createActionFallback() {
    const key = '__action_btn';
    if (this.textures.exists(key)) return key;
    const s = 132;
    const g = this.add.graphics();
    g.fillStyle(0xffffff, 0.1).fillRoundedRect(0, 0, s, s, 24);
    g.lineStyle(4, 0xffffff, 0.6).strokeRoundedRect(0, 0, s, s, 24);
    // small bolt icon
    g.lineStyle(10, 0xffffff, 0.9);
    g.beginPath();
    g.moveTo(s * 0.55, s * 0.18);
    g.lineTo(s * 0.35, s * 0.55);
    g.lineTo(s * 0.52, s * 0.55);
    g.lineTo(s * 0.42, s * 0.86);
    g.strokePath();
    g.generateTexture(key, s, s);
    g.destroy();
    return key;
  }

  _clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }





  // Fit Arcade body to the GameObject's current display size.
  // Options: { allowGravity: boolean, immovable: boolean }
  _fitBody(go, opts = {}) {
    if (!go.body) this.physics.add.existing(go); // dynamic by default
    const b = go.body;
    const w = Math.round(go.displayWidth);
    const h = Math.round(go.displayHeight);

    if (b.setSize) b.setSize(w, h, true);

    if (opts.allowGravity === false && b.setAllowGravity) b.setAllowGravity(false);
    if (opts.immovable && b.setImmovable) b.setImmovable(true);

    if (b.isStatic && b.updateFromGameObject) b.updateFromGameObject();
    return b;
  }

  _tryShoot() {
    const now = this.time.now;
    if (now - this._lastShotAt < this._fireRateMs) return;
    if (this._ammo <= 0) return;

    this._lastShotAt = now;
    this._ammo -= 1;

    const b = this._bullets.get(this._player.x, this._player.y - 10, 'round_bullet');
    if (!b) return;

    b.setActive(true).setVisible(true);
    b.setDisplaySize(30, 30);
    this._fitBody(b, { allowGravity: false });
    b.body.setVelocityX(this._playerFacingRight ? this._bulletSpeed : -this._bulletSpeed);

    if (this._sfxAttack) this._sfxAttack.play();
  }

  _tryJump() {
    // Only jump if player is touching the ground
    if (this._player.body.touching.down || this._player.body.blocked.down) {
      this._player.body.setVelocityY(this._jumpPower);
    }
  }

  _spawnZombie() {
    if (this._finished) return;
    if (this._zombies.countActive(true) >= this._maxZombies) return;

    const cam = this.sys.cameras.main;
    const worldW = cam.width;
    const worldH = cam.height;

    const spawnLeft = Math.random() < 0.5;
    const x = spawnLeft ? -40 : worldW + 40;
    const y = worldH - 115;

    const z = this._zombies.get(x, y - 155, 'enemy');
    if (!z) return;

    z.setActive(true).setVisible(true);
    z.setDisplaySize(300, 370);
    this._fitBody(z, { allowGravity: false });
    this._inflateBody(z, this._enemyHitboxPadX - 500 ?? 10, this._enemyHitboxPadY - 300 ?? 4);
    z.body.setCollideWorldBounds(false);

    // Simple chase AI: constant horizontal speed toward player
    const dir = (this._player.x > z.x) ? 1 : -1;
    z.body.setVelocityX(dir * this._zombieSpeed);
  }

  _spawnPickup() {
    if (this._finished) return;
    if (this._pickups.countActive(true) >= this._maxPickups) return;

    const cam = this.sys.cameras.main;
    const worldW = cam.width;
    const worldH = cam.height;

    const x = Phaser.Math.Between(120, worldW - 120);
    const y = worldH - Phaser.Math.Between(220, 360);

    // ✅ Use distinct keys: 'ammo' or 'medkit'
    const isAmmo = Math.random() < 0.65;
    const key = isAmmo ? 'ammo' : 'medkit';

    const p = this._pickups.get(x, y, key);
    if (!p) return;

    p.setActive(true).setVisible(true);
    p.setDisplaySize(72, 72);
    this._fitBody(p, { allowGravity: false });

    // small idle bob (optional)
    this.tweens.add({
      targets: p,
      y: p.y - 8,
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: 'sine.inOut'
    });
  }

  _increaseDifficulty() {
    // Make zombies faster and spawn more frequently over time
    this._zombieSpeed = Math.min(this._zombieSpeed + 10, 320);
    this._spawnInterval = Math.max(this._spawnInterval - this._spawnDecay, this._spawnMinInterval);
    if (this._spawnTimer) {
      this._spawnTimer.remove(false);
      this._spawnTimer = this.time.addEvent({
        delay: this._spawnInterval,
        loop: true,
        callback: this._spawnZombie,
        callbackScope: this
      });
    }
  }

  _onBulletHitsZombie(bullet, zombie) {
    if (!bullet.active || !zombie.active) return;

    bullet.destroy();
    this._explodeEnemy(zombie);

    this._score += 10;
    if (this._sfxDestroy) this._sfxDestroy.play();
    this.cameras.main.shake(100, 0.0025);

    // NEW: check target-based win
    if (!this._finished && this._score >= this._targetScore) {
      this._win();
    }
  }



  _onPlayerHitsZombie(player, zombie) {
    if (!zombie.active) return;
    zombie.destroy();

    this._health -= 15;
    if (this._health < 0) this._health = 0;
    if (this._sfxHit) this._sfxHit.play();

    if (this._health <= 0) this._lose();
  }

  _onPlayerCollectsPickup(player, pickup) {
    if (!pickup.active) return;

    const k = pickup.texture.key;

    if (k === 'ammo') {
      // ✅ Ammo pickup
      this._ammo = Math.min(this._ammo + this._ammoPickupAmount, this._maxAmmo);
    } else if (k === 'medkit') {
      // ✅ Health pickup
      this._health = Math.min(this._health + this._healthPickupAmount, 100);
    }

    // quick feedback
    this.tweens.add({ targets: pickup, scale: 1.2, duration: 100, yoyo: true });
    if (this._sfxCollect) this._sfxCollect.play();

    // remove after a short beat so the tween shows
    this.time.delayedCall(120, () => pickup.destroy());
  }
  // Fade out the camera, then start another scene with data
  _transitionToScene(targetKey, data = {}, delayMs = 350) {
    const cam = this.cameras.main;
    // avoid multiple triggers
    if (this._transitioning) return;
    this._transitioning = true;

    // small delay so sfx/particles finish
    this.time.delayedCall(delayMs, () => {
      cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
        this.scene.start(targetKey, data);
      });
      cam.fadeOut(300, 0, 0, 0);
    });
  }


  _win() {
    if (this._finished) return;
    this._finished = true;
    this._teardown();
    if (this._sfxWin) this._sfxWin.play();

    const payload = { score: this._score, timeLeft: this._timeLeft };
    this.events.emit('game_win', payload);

    // ✅ transition to WinScene
    this._transitionToScene('WinScene', payload, 250);
  }

  _lose() {
    if (this._finished) return;
    this._finished = true;
    this._teardown();
    if (this._sfxLose) this._sfxLose.play();

    const payload = { score: this._score, timeLeft: this._timeLeft };
    this.events.emit('game_over', payload);

    // ✅ transition to GameOverScene
    this._transitionToScene('GameOverScene', payload, 250);
  }
  // Enlarge (or shrink) a body's hitbox by padding in pixels (kept centered)
  _inflateBody(go, padX = 0, padY = 0) {
    if (!go.body || !go.displayWidth || !go.displayHeight) return;
    const w = Math.round(go.displayWidth + padX * 2);
    const h = Math.round(go.displayHeight + padY * 2);
    if (go.body.setSize) go.body.setSize(w + 200, h + 500, true); // true => re-center on the GameObject
  }



  _teardown() {
    if (this._bgm && this._bgm.isPlaying) this._bgm.stop();

    // Stop timers
    [this._spawnTimer, this._pickupTimer, this._difficultyTimer, this._secTimer].forEach(t => {
      if (t && !t.hasDispatched) t.remove(false);
    });

    // Freeze physics
    this.physics.world.pause();

    // Kill inputs
    this._touchLeft = this._touchRight = this._touchShoot = this._touchJump = false;
  }

  // Make sure we have a 4x4 white pixel texture for particles
  // Make sure we have a 4x4 white pixel texture for particles
  _ensureParticleTexture() {
    const key = '__px';
    if (this.textures.exists(key)) return key;
    const g = this.add.graphics();
    g.fillStyle(0xffffff, 1).fillRect(0, 0, 4, 4);
    g.generateTexture(key, 4, 4);
    g.destroy();
    return key;
  }

  // One-off particle burst at (x, y) with a tint (Phaser 3.60+)
  _emitBurst(x, y, tint = 0xff4444) {
    const tex = this._ensureParticleTexture();

    // New API: returns a ParticleEmitter (not a manager)
    const emitter = this.add.particles(x, y, tex, {
      speed: { min: 120, max: 260 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.9, end: 0.2 },
      alpha: { start: 1, end: 0 },
      lifespan: { min: 250, max: 500 },
      quantity: 0,             // we'll trigger via explode
      tint
    });

    // Burst once, then clean up
    if (emitter.explode) emitter.explode(16, x, y);

    // emitter.manager is the ParticleEmitterManager; destroy that to remove both
    const mgr = emitter.manager ?? emitter;
    this.time.delayedCall(550, () => mgr.destroy());
  }


  // Enemy explode animation (pop + fade + rotate + particles)
  _explodeEnemy(enemy) {
    if (!enemy.active) return;

    // Disable collisions & movement immediately
    if (enemy.body) {
      enemy.body.enable = false;
      enemy.body.setVelocity(0, 0);
    }

    // Particles tinted by enemy color-ish (fallback red)
    const tint = (enemy.tintTopLeft ?? 0xff4444);
    this._emitBurst(enemy.x, enemy.y, tint);

    // Tween: scale up a bit, rotate, then fade & destroy
    this.tweens.add({
      targets: enemy,
      scale: enemy.scale * 1.4,
      angle: enemy.angle + Phaser.Math.Between(-35, 35),
      duration: 180,
      onComplete: () => {
        this.tweens.add({
          targets: enemy,
          alpha: 0,
          scale: enemy.scale * 0.6,
          duration: 140,
          onComplete: () => enemy.destroy()
        });
      }
    });
  }
}
