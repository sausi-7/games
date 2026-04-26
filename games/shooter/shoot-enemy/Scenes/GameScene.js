class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameScene', physics: { arcade: { gravity: { y: 0 }, debug: false } } });

    this.W = 1920; this.H = 1080;
    this._breathers = { ball: null, enemy: null };


    this.state = {
      finished: false,
      shotsTotal: 10,       // endless for now
      shotIndex: 0,
      goals: 0,
      targetGoals: 6,              // “score”
      charging: false,
      chargeStart: 0,
      powerPct: 0,            // 0..1
      aimDeg: 0,              // full 360 now (we’ll clamp with joystick)
      ballInPlay: false,
      lastInputDir: 0,
      minFlightUntil: 0,
      launchPosX: 0,
      launchPosY: 0,

    };

    // Refs
    this.cfg = null;
    this.ui = {};
    this.keys = {};
    this.player = { ball: null, group: null };
    this.enemy = null;
    this.enemies = null;


    // Mobile joystick
    this.mobile = {
      joystick: {
        base: null,
        knob: null,
        zone: null,
        active: false,
        pointerId: null,
        cx: 0, cy: 0,
        r: 120, kR: 38,
        deg: 0,
        strength: 0
      }
    };

    // Handles to clean up
    this._trajGfx = null;
  }

  preload() {
    const cfg = this.registry.get('cfg') || {};

    // Config-driven gameplay (overrides defaults from init)
    const gp = cfg.gameplay || {};
    const parsedTarget = Number(gp.targetGoals ?? gp.target ?? gp.goalsToWin);
    const parsedShots = Number(gp.shotsTotal ?? gp.shots ?? gp.maxShots);
    if (Number.isFinite(parsedTarget) && parsedTarget > 0) this.state.targetGoals = parsedTarget;
    if (Number.isFinite(parsedShots) && parsedShots > 0) this.state.shotsTotal = parsedShots;

    // Assets (use images; fall back to images1 if your JSON is inconsistent)
    const imgs = cfg.images || cfg.images1 || {};
    const imgs2 = cfg.images2 || {}
    const aud = cfg.audio || {};

    if (imgs.background) this.load.image('background', imgs2.background);
    if (imgs.platform) this.load.image('platform', imgs.platform);
    if (imgs.player) this.load.image('player', imgs.player);
    if (imgs.enemy) this.load.image('enemy', imgs.enemy);

    if (aud.bgm) this.load.audio('bgm', aud.bgm);
    if (aud.attack) this.load.audio('kick', aud.attack);
    if (aud.level_complete) this.load.audio('win', aud.level_complete);
    if (aud.game_over) this.load.audio('lose', aud.game_over);
    if (aud.collection) this.load.audio('ping', aud.collection);

    ['htpbox', 'ovrbox', 'replay', 'lvl_replay', 'lvlbox', 'next', 'playbtn'].forEach(k => {
      if (imgs[k]) this.load.image(k, imgs[k]);
    });
  }


  init() {
    // fresh state on every start
    this.state = {
      finished: false,
      shotsTotal: 10,     // will be overridden by config in preload if present
      shotIndex: 0,
      goals: 0,
      targetGoals: 6,     // will be overridden by config in preload if present
      charging: false,
      chargeStart: 0,
      powerPct: 0,
      aimDeg: 0,
      ballInPlay: false,
      lastInputDir: 0,
      minFlightUntil: 0,
      launchPosX: 0,
      launchPosY: 0,


    };

    this.sfx = { bgm: null };

    // fresh refs
    this.cfg = null;
    this.ui = {};
    this.keys = {};
    this.player = { ball: null, group: null };
    this.enemy = null;
    this.enemies = null;
    this._trajGfx = null;
  }


  create() {
    this.cfg = this.registry.get('cfg') || {};

    // World
    this.physics.world.setBounds(0, 0, this.W, this.H);
    this.physics.world.setBoundsCollision(true, true, true, true);

    // Background + ground (visual)
    if (this.textures.exists('background')) {
      this.add.image(this.W * 0.5, this.H * 0.5, 'background').setDisplaySize(this.W, this.H);
    }
    if (this.textures.exists('platform')) {
      this.add.sprite(this.W * 0.5, this.H - 120, 'platform').setDisplaySize(this.W, 120);
    }

    // ... your existing create() setup
    // this._enterFullscreenAtStart();


    // Groups
    this.player.group = this.physics.add.group({ allowGravity: false, collideWorldBounds: true });
    this.enemies = this.physics.add.group({ allowGravity: false, immovable: true });
    this.bullets = this.physics.add.group({ allowGravity: false, collideWorldBounds: true });

    // UI
    // UI
    // const font = (this.cfg.font && this.cfg.font.family) || 'sans-serif';
    // this.ui.score = this.add.text(40, 34, `${(this.cfg.texts?.score_label) || 'Score: '}0`, { fontFamily: font, fontSize: 40, color: '#ffffff' });
    // this.ui.shots = this.add.text(this.W * 0.5 - 60, 34, `Shot: 1/${this.state.shotsTotal}`, { fontFamily: font, fontSize: 40, color: '#ffffff' });
    // // NEW: Target label
    // this.ui.target = this.add.text(40, 164, `Target: ${this.state.targetGoals}`, { fontFamily: font, fontSize: 32, color: '#7dffa5' });

    // this.ui.aim = this.add.text(40, 84, `Aim: 0°`, { fontFamily: font, fontSize: 32, color: '#a0ffea' });
    // this.ui.power = this.add.text(40, 124, `Power: 0%`, { fontFamily: font, fontSize: 32, color: '#ffd27a' });

    // --- Fancy HUD ---
    this._buildHUD();

    // Keyboard fallback (A/D to add spin-like curve; LEFT/RIGHT adjust aim slightly if needed)
    this.keys.left = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT);
    this.keys.right = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT);
    this.keys.space = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);


    if (this.soundExists('bgm')) {
      this.sfx.bgm = this.sound.add('bgm', { loop: true, volume: 0.5 });
      this.sfx.bgm.play();
    }

    // Optional: space to shoot on desktop
    this.input.keyboard.on('keydown-SPACE', () => { if (!this.state.ballInPlay) this._beginCharge(); });
    this.input.keyboard.on('keyup-SPACE', () => this._releaseShot());

    // Joystick
    this._createJoystick();

    // Trajectory gfx
    this._trajGfx = this.add.graphics().setDepth(3).setAlpha(0.9);

    // Spawn ball & enemy
    this._resetBall();
    this._spawnEnemy();

    // Collisions
    this.physics.add.overlap(
      this.bullets,
      this.enemies,
      this._onHitEnemy,
      null,
      this
    );

    // When ball hits world bounds, damp a bit; if it slows too much, end shot
    this.physics.world.on('worldbounds', (body) => {
      if (!body?.gameObject) return;
      const b = body.gameObject;
      if (!b.active) return;
      body.velocity.x *= 0.96;
      body.velocity.y *= 0.96;
    });

    // // --- Arcade debug overlay ---
    // const w = this.physics.world;
    // w.createDebugGraphic();          // prepares the Graphics used for outlines
    // w.drawDebug = true;              // enable drawing
    // w.debugGraphic.setDepth(9999);   // keep on top of HUD
    // w.debugGraphic.setAlpha(0.85);   // a bit see-through

    // // optional: quick toggle with the D key
    // this.input.keyboard.on('keydown-D', () => {
    //   w.drawDebug = !w.drawDebug;
    //   w.debugGraphic.clear();        // clear when toggling
    // });

  }

  update(time, delta) {
    if (this.state.finished) return;

    // Joystick updates → state.aimDeg & power
    const J = this.mobile.joystick;

    // If joystick is active, update aim live
    // If joystick is active, update aim live (SLINGSHOT: fire opposite to pull)
    if (!this.state.ballInPlay && J.active) {
      this.state.aimDeg = Phaser.Math.Angle.WrapDegrees(J.deg + 180);
    } else {
      // minor keyboard nudge if desired
      let dir = 0;
      if (this.keys.left.isDown) dir -= 1;
      if (this.keys.right.isDown) dir += 1;
      this.state.aimDeg = Phaser.Math.Wrap(this.state.aimDeg + dir * 120 * (delta / 1000), -180, 180);
    }


    this._setTextSafe(this.ui.aimVal, `${Math.round(this.state.aimDeg)}°`);

    // Charge UI
    if (this.state.charging) {
      const held = Math.min(1800, time - this.state.chargeStart);
      this.state.powerPct = Phaser.Math.Clamp(held / 1800, 0, 1);
      this._setTextSafe(this.ui.powerVal, `${Math.round(this.state.powerPct * 100)}%`);
    }

    /// Trajectory preview only while charging or joystick is held
    const shouldPreview =
      !this.state.ballInPlay &&
      (this.state.charging || J.active) &&
      this.player.group.getLength() > 0;

    if (shouldPreview) {
      this._updateTrajectory();
    } else {
      this._clearTrajectory();
    }


    // Enemy patrol
    // Enemy follows the "+" loop
    this._moveEnemyAlongPath(delta);



    // If ball is in play and very slow, end shot
    if (this.state.ballInPlay) {
      const live = this.bullets.getChildren().find(b => b.active);
      if (live) {
        const speed = Math.hypot(live.body.velocity.x, live.body.velocity.y);

        const dist = Phaser.Math.Distance.Between(
          live.x, live.y,
          this.state.launchPosX, this.state.launchPosY
        );

        const MIN_DIST = 140;
        const EXTRA_TIME = 700;
        const afterGrace = this.time.now > this.state.minFlightUntil;
        const afterFallback = this.time.now > (this.state.minFlightUntil + EXTRA_TIME);

        if (afterGrace && speed < 60 && (dist > MIN_DIST || afterFallback)) {
          live.destroy();
          this._endShot(false);
        }
      }
    }


  }

  _addBreathing(sprite, amp = 0.06, dur = 1100, delay = 0) {
    if (!sprite) return null;
    const sx = sprite.scaleX || 1;
    const sy = sprite.scaleY || 1;
    return this.tweens.add({
      targets: sprite,
      scaleX: { from: sx, to: sx * (1 + amp) },
      scaleY: { from: sy, to: sy * (1 + amp) },
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      duration: dur,
      delay
    });
  }


  _enterFullscreenAtStart() {
    const scale = this.scale;

    const tryPhaserFS = () => {
      if (!scale.isFullscreen) {
        try { scale.startFullscreen(); } catch (e) { /* ignore */ }
      }
    };

    // Try immediately (works in many desktop contexts / PWAs)
    tryPhaserFS();

    // If the browser requires a user gesture, hook the first input to enter FS
    const onceGoFS = () => {
      tryPhaserFS();
      this.input.off('pointerdown', onceGoFS);
      this.input.keyboard?.off('keydown-F', onceGoFS);
    };

    // Retry on first pointer or press F
    this.input.once('pointerdown', onceGoFS);
    this.input.keyboard?.once('keydown-F', onceGoFS);

    // Optional: keep canvas fitting when fullscreen changes
    scale.on('enterfullscreen', () => scale.refresh());
    scale.on('leavefullscreen', () => scale.refresh());
  }


  // ----- Core flow -----
  _resetBall() {
    // Clear existing player & bullets
    this.player.group.clear(true, true);
    this.bullets?.clear(true, true);

    // Player cannon (static, breathing)
    const px = 420, py = this.H - 300;
    const cannon = this.physics.add.sprite(px, py, 'player');
    cannon.setDisplaySize(230, 230);
    cannon.setImmovable(true);
    cannon.body.setAllowGravity(false);
    cannon.body.setVelocity(0, 0);
    cannon.body.setCollideWorldBounds(false);
    this.player.group.add(cannon);

    // Reset shot state & HUD
    this.state.ballInPlay = false;
    this.state.powerPct = 0;
    this.state.charging = false;
    this._setTextSafe(this.ui.powerVal, `0%`);
    this._setTextSafe(this.ui.shotsVal, `Shots: ${this.state.shotIndex + 1}/${this.state.shotsTotal}`);

    // breathing on the player sprite
    if (this._breathers.ball) { this._breathers.ball.stop(); this._breathers.ball = null; }
    this._breathers.ball = this._addBreathing(cannon, 0.3, 1000, Phaser.Math.Between(0, 200));

    // no trajectory until hold
    this._clearTrajectory();
  }


  _beginCharge() {
    if (this.state.finished || this.state.ballInPlay || this.state.charging) return;
    // Only if we have a ball
    if (!this.player.group.getLength()) return;
    this.state.charging = true;
    this.state.chargeStart = this.time.now;
  }

  _releaseShot() {
    this._clearTrajectory();
    if (!this.state.charging || this.state.finished || this.state.ballInPlay) return;
    this.state.charging = false;

    const cannon = this.player.group.getChildren()[0];
    if (!cannon) return;

    this.soundExists('kick') && this.sound.play('kick', { volume: 0.9 });

    // speed from charge
    const base = 900;
    const p = 0.5 + this.state.powerPct * 0.9; // 0.5..1.4
    const speed = base * p;

    const deg = Number.isFinite(this.state.aimDeg) ? this.state.aimDeg : 0;
    const rad = Phaser.Math.DegToRad(deg);

    let vx = Math.cos(rad) * speed;
    let vy = Math.sin(rad) * speed;

    if (!Number.isFinite(vx) || !Number.isFinite(vy) || (Math.abs(vx) < 1 && Math.abs(vy) < 1)) {
      vx = speed; vy = 0;
    }

    // spawn bullet at cannon
    const bullet = this.physics.add.sprite(cannon.x, cannon.y, 'bullet');
    bullet.setDisplaySize(150, 150);
    bullet.setCollideWorldBounds(true);
    bullet.body.onWorldBounds = true;
    bullet.body.setBounce(0, 0);
    bullet.body.setDrag(10, 10);
    bullet.setDepth(2);
    this.bullets.add(bullet);

    // launch!
    bullet.body.setVelocity(vx, vy);
    this.state.ballInPlay = true;
    this.state.launchPosX = bullet.x;
    this.state.launchPosY = bullet.y;
    this.state.minFlightUntil = this.time.now + 300;

    // pause cannon breathing while a shot is live (optional)
    if (this._breathers.ball) this._breathers.ball.pause();

    // end if nothing happens
    this.time.delayedCall(3000, () => {
      if (this.state.finished) return;
      if (this.state.ballInPlay) this._endShot(false);
    });

    // world-bounds end (destroy bullet and end shot)
    bullet.body.world.on('worldbounds', (body) => {
      if (body.gameObject === bullet && bullet.active) {
        bullet.destroy();
        if (this.state.ballInPlay) this._endShot(false);
      }
    });
  }


  _endShot(scored) {
    this.state.ballInPlay = false;
    this.state.shotIndex += 1;

    // Early win if target reached
    if (this.state.goals >= this.state.targetGoals) {
      this._finish('win');
      return;
    }

    // Out of shots → decide outcome
    if (this.state.shotIndex >= this.state.shotsTotal) {
      const outcome = (this.state.goals >= this.state.targetGoals) ? 'win' : 'lose';
      this._finish(outcome);
      return;
    }

    // Otherwise next shot
    this._resetBall();
  }

  _onHitEnemy(bullet, enemy) {
    if (!enemy || !enemy.active || enemy.getData('hit')) return;
    enemy.setData('hit', true);
    enemy.body.enable = false;

    this.state.goals += 1;
    this._setTextSafe(this.ui.scoreVal, `${(this.cfg.texts?.score_label) || 'Score'}: ${this.state.goals}`);
    if (this.soundExists('ping')) this.sound.play('ping', { volume: 0.9 });

    // stop enemy breathing so the hit tween has full control
    if (this._breathers.enemy) { this._breathers.enemy.stop(); this._breathers.enemy = null; }

    this.tweens.add({
      targets: enemy,
      scale: { from: enemy.scale, to: enemy.scale * 1.2 },
      alpha: { from: 1, to: 0 },
      duration: 160,
      yoyo: false,
      onComplete: () => {
        if (enemy && enemy.active) enemy.destroy();
        this._spawnEnemy();
      }
    });

    // kill bullet and end shot
    if (bullet && bullet.active) bullet.destroy();
    this._endShot(true);
  }



  _spawnEnemy() {
    // Create enemy first so we know its body size for safe bounds
    const enemy = this.physics.add.sprite(0, 0, 'enemy');
    enemy.setDisplaySize(250, 250);
    enemy.setImmovable(true);
    enemy.body.setCollideWorldBounds(true, 1, 1);
    enemy.body.onWorldBounds = false;
    enemy.body.setBounce(0, 0);
    enemy.setData('hit', false);

    this.enemies.add(enemy);
    this.enemy = enemy;

    // Safe radius from body
    const r = Math.max(enemy.body.halfWidth, enemy.body.halfHeight);

    // ⬇️ Random X, with a hard minimum of 800 (but also >= radius)
    const minStartX = Math.max(800, r);
    const maxStartX = this.W - r;
    const startX = Phaser.Math.Between(minStartX, maxStartX);

    // ⬇️ Random Y within safe vertical bounds
    const minStartY = r;
    const maxStartY = this.H - r;
    const startY = Phaser.Math.Between(minStartY, maxStartY);

    // Place enemy and initialize the plus-path starting from this point
    enemy.setPosition(startX, startY);
    enemy.body.setVelocity(0, 0);

    // kill previous enemy breather (if any)
    if (this._breathers.enemy) { this._breathers.enemy.stop(); this._breathers.enemy = null; }

    // start enemy breathing (slightly slower/subtler)
    this._breathers.enemy = this._addBreathing(enemy, 0.2, 1400, Phaser.Math.Between(0, 180));


    this._initPlusPath(enemy, { x: startX, y: startY });
  }




  // Add this method anywhere in the class
  _containEnemies() {
    if (!this.enemies) return;
    const minX = 0, minY = 0, maxX = this.W, maxY = this.H;

    this.enemies.getChildren().forEach(e => {
      if (!e.body) return;
      const r = Math.max(e.body.halfWidth, e.body.halfHeight); // handles circle bodies too

      // Clamp X and flip velocity if out of range
      if (e.x < r) { e.x = r; e.body.velocity.x = Math.abs(e.body.velocity.x); }
      else if (e.x > maxX - r) { e.x = maxX - r; e.body.velocity.x = -Math.abs(e.body.velocity.x); }

      // Clamp Y and flip velocity if out of range
      if (e.y < r) { e.y = r; e.body.velocity.y = Math.abs(e.body.velocity.y); }
      else if (e.y > maxY - r) { e.y = maxY - r; e.body.velocity.y = -Math.abs(e.body.velocity.y); }
    });
  }



  _patrolEnemy(_delta) { /* no-op; path follower handles movement */ }


  // ----- Joystick -----
  _createJoystick() {
    const J = this.mobile.joystick;
    J.cx = 200;
    J.cy = this.H - 180;

    // Visuals
    J.base = this.add.circle(J.cx, J.cy, J.r, 0xffffff, 0.08)
      .setStrokeStyle(2, 0xffffff, 0.25)
      .setDepth(10)
      .setScrollFactor(0);

    J.knob = this.add.circle(J.cx, J.cy, J.kR, "black", 0.3)
      .setStrokeStyle(2, 0xffffff, 0.55)
      .setDepth(11)
      .setScrollFactor(0);

    // **Robust input zone** covering the joystick area
    J.zone = this.add.zone(J.cx, J.cy, J.r * 2, J.r * 2)
      .setOrigin(0.5, 0.5)
      .setInteractive({ useHandCursor: false })
      .setScrollFactor(0)
      .setDepth(12);

    const onDown = (pointer) => {
      if (J.active) return;
      J.active = true;
      J.pointerId = pointer.id;
      this._joyMove(pointer);
      if (!this.state.ballInPlay) this._beginCharge();
    };

    const onMove = (pointer) => {
      if (!J.active || pointer.id !== J.pointerId) return;
      this._joyMove(pointer);
    };

    const onUp = (pointer) => {
      if (pointer.id !== J.pointerId) return;
      J.active = false;
      J.pointerId = null;

      // reset knob
      J.knob.x = J.cx; J.knob.y = J.cy;
      J.deg = 0; J.strength = 0;

      // hide preview immediately
      this._clearTrajectory();

      if (this.state.charging && !this.state.ballInPlay) this._releaseShot();
    };

    J.zone.on('pointerdown', onDown);
    this.input.on('pointermove', onMove);
    this.input.on('pointerup', onUp);

    // Also allow pressing directly on knob / base
    J.base.setInteractive();
    J.knob.setInteractive();
    J.base.on('pointerdown', onDown);
    J.knob.on('pointerdown', onDown);

    // Save handlers to clean up if you add scene transitions later
    this._joyHandlers = { onMove, onUp };
  }

  _joyMove(pointer) {
    const J = this.mobile.joystick;
    const dx = pointer.x - J.cx;
    const dy = pointer.y - J.cy;

    const dist = Math.min(Math.hypot(dx, dy), J.r);
    const ang = Math.atan2(dy, dx); // radians (0 = right)
    const nx = J.cx + Math.cos(ang) * dist;
    const ny = J.cy + Math.sin(ang) * dist;

    J.knob.x = nx; J.knob.y = ny;
    J.deg = Phaser.Math.RadToDeg(ang);   // -180..180
    J.strength = dist / J.r;             // 0..1
  }

  // ----- Trajectory -----
  _clearTrajectory() {
    if (this._trajGfx) this._trajGfx.clear();
  }

  _updateTrajectory() {
    const g = this._trajGfx;
    if (!g) return;

    const cannon = this.player.group?.getChildren?.()[0];
    if (!cannon || !cannon.active) { g.clear(); return; }

    g.clear();

    // power preview
    const p = this.state.charging ? this.state.powerPct : 0.35;
    const base = 900;
    const speed = base * (0.5 + p * 0.9);

    const rad = Phaser.Math.DegToRad(this.state.aimDeg);
    // Reverse for slingshot
    let vx = -Math.cos(rad) * speed;
    let vy = -Math.sin(rad) * speed;

    // integrate
    const steps = 28;
    const dt = 0.035;
    let x = cannon.x, y = cannon.y;

    g.fillStyle(0x89f7ff, 1);
    for (let i = 0; i < steps; i++) {
      vx *= 0.992; vy *= 0.992;
      x -= vx * dt; y -= vy * dt;
      if (x < 0 || x > this.W || y < 0 || y > this.H) break;
      const r = Math.max(1.2, 4 - i * 0.08);
      g.fillCircle(x, y, r);
    }
  }

  _finish(outcome) {
    if (this.state.finished) return;
    this.state.finished = true;

    // 🔇 stop bgm
    if (this.sfx?.bgm) { this.sfx.bgm.stop(); this.sfx.bgm.destroy(); this.sfx.bgm = null; }

    // (optional) play result jingle
    if (outcome === 'win' && this.soundExists('win')) this.sound.play('win', { volume: 0.9 });
    if (outcome === 'lose' && this.soundExists('lose')) this.sound.play('lose', { volume: 0.9 });

    // ...your existing cleanup + scene start...
    this.input.keyboard.removeAllListeners();
    this.input.off('pointermove');
    this.input.off('pointerup');
    this.player.group && this.player.group.clear(true, true);
    this.enemies && this.enemies.clear(true, true);
    this._clearTrajectory();

    this.registry.set('final_score', this.state.goals);
    this.registry.set('shots_used', this.state.shotIndex);
    this.registry.set('target_goals', this.state.targetGoals);

    this.scene.start(outcome === 'win' ? 'WinScene' : 'GameOverScene');
  }

  // ----- HUD builders -----
  _buildHUD() {
    const font = (this.cfg.font && this.cfg.font.family) || 'Outfit, Poppins, sans-serif';

    // Layout for one neat horizontal row centered at the top
    const itemW = 360;        // width of each scorebar pill
    const itemH = 80;         // height of each scorebar pill
    const gap = 22;         // space between pills
    const y = 72;         // vertical position for the row

    const totalW = (itemW * 3) + (gap * 2);
    const startX = (this.W * 0.5) - (totalW * 0.5) + (itemW * 0.5);

    // Small factory to create one pill with background + centered text "Label: value"
    const makePill = (label, value, index, tint = 0xffffff) => {
      const x = startX + index * (itemW + gap);

      // Background image
      const bg = this.add.image(x, y, 'scorebar')
        .setDisplaySize(itemW, itemH)
        .setDepth(20)
        .setOrigin(0.5, 0.5);
      if (bg.setTint && tint !== 0xffffff) bg.setTint(tint);

      // Text on top of it, single line "Label: value"
      const txt = this.add.text(x - 25, y, `${label}: ${value}`, {
        fontFamily: font,
        fontSize: 52,
        color: '#000000ff',
        fontStyle: '700',
        align: 'center',

      })
        .setOrigin(0.5, 0.5)
        .setDepth(21)
        .setShadow(0, 2, '#000000', 4, true, true);

      return txt; // we’ll store and update these
    };

    // Build the three stats (no Aim/Power anymore)
    const scoreLabel = (this.cfg.texts?.score_label) || 'Score';
    this.ui.scoreVal = makePill(scoreLabel, this.state.goals, 0);                         // e.g., "Score: 0"
    this.ui.shotsVal = makePill('Shots', `1/${this.state.shotsTotal}`, 1);               // e.g., "Shots: 1/10"
    this.ui.targetVal = makePill('Target', this.state.targetGoals, 2);                    // e.g., "Target: 6"
  }

  // Small helper to safely set text
  _setTextSafe(obj, text) { obj && obj.setText && obj.setText(text); }


  _initPlusPath(enemy, start = 'bottom') {
    const r = Math.max(enemy.body.halfWidth, enemy.body.halfHeight);

    // Left arm must be at least x >= 1400, but not off-screen
    const minX = Math.max(r, 1400);
    const maxX = this.W - r;

    const minY = r;
    const maxY = this.H - r;

    const cx = this.W * 0.5;
    const cy = this.H * 0.5;

    const points = [
      { x: cx, y: maxY }, // bottom
      { x: cx, y: minY }, // top
      { x: cx, y: cy },   // center
      { x: minX, y: cy }, // left (respects min x = 800)
      { x: maxX, y: cy }, // right
      { x: cx, y: cy },   // center
      { x: cx, y: maxY }  // bottom (loop)
    ];
    // ...rest of your function stays the same


    // Map named starts to waypoint index
    const nameToIdx = { bottom: 0, top: 1, center: 2, left: 3, right: 4 };

    let startIdx = 0;

    if (typeof start === 'string' && start in nameToIdx) {
      startIdx = nameToIdx[start];
    } else if (start && typeof start === 'object' && Number.isFinite(start.x) && Number.isFinite(start.y)) {
      // If coords passed, snap to nearest waypoint in the "+" so the loop continues cleanly
      let best = 0, bestD = Number.POSITIVE_INFINITY;
      for (let i = 0; i < points.length; i++) {
        const dx = points[i].x - start.x;
        const dy = points[i].y - start.y;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = i; }
      }
      startIdx = best;
    } else {
      // fallback
      startIdx = 0;
    }

    enemy._path = { points, idx: (startIdx + 1) % points.length, speed: 120 };

    const p0 = points[startIdx];
    enemy.setPosition(p0.x, p0.y);
    enemy.body.setVelocity(0, 0);
    enemy.body.setBounce(0, 0);
  }

  _moveEnemyAlongPath(delta) {
    if (!this.enemy || !this.enemy.active || !this.enemy._path) return;
    const path = this.enemy._path;
    const target = path.points[path.idx];

    const dx = target.x - this.enemy.x;
    const dy = target.y - this.enemy.y;
    const dist = Math.hypot(dx, dy);

    // how far we can move this frame
    const step = (path.speed) * (delta / 1000);

    if (dist <= step) {
      // snap & advance
      this.enemy.setPosition(target.x, target.y);
      this.enemy.body.setVelocity(0, 0);
      path.idx = (path.idx + 1) % path.points.length;
    } else {
      // steer toward the target
      const nx = dx / dist;
      const ny = dy / dist;
      this.enemy.body.setVelocity(nx * path.speed, ny * path.speed);
    }
  }

  // ----- Utils -----
  soundExists(k) { return this.cache.audio.exists(k); }
}
