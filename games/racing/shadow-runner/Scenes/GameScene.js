// GameScene.js — Shadow Tag (Light Blast + Joystick, Action-only button)
// - Endless shadows spawn randomly at edges and chase the player
// - Light pickups fall slowly from the top; collecting one gives +1 charge
// - ACTION (SPACE / mobile) consumes 1 charge -> screen flash + clears ALL shadows
// - Movement via on-screen joystick (no left/right buttons)
// - Survive 60s to win
// - Uses ONLY library assets in config.json; colliders match display sizes

class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');

    this.cfg = null;
    this.W = 1920; this.H = 1080;

    this.state = {
      timeLeft: 60,
      score: 0,
      alive: true,
      finished: false,
      lightCharges: 0,
      lastMoveVec: new Phaser.Math.Vector2(1, 0),
    };

    // Refs & groups
    this.player = null;
    this.shadows = null;
    this.lights = null;
    this.walls = null;

    // Input
    this.cursors = null;
    this.keys = null;

    // Joystick
    this.joystickData = null;

    // UI
    this.ui = { timer: null, score: null, charges: null };

    // Mobile action button
    this.btnAction = null;
  }

  preload() {
    const cfg = this.registry.get('cfg') || {};
    const img = (k) => cfg.images1?.[k];
    //   const sfx = (k) => cfg.audio?.[k];

    //   if (img('background')) this.load.image('background', img('background'));
    //   this.load.image('player', img('player'));
    this.load.image('shadow', img('enemy'));
    //   this.load.image('collectible', img('collectible'));
    //   this.load.image('platform', img('platform'));

    //   // joystick assets
    //   if (img('joystick_bg')) this.load.image('joystick_bg', img('joystick_bg'));
    //   if (img('joystick_knob')) this.load.image('joystick_knob', img('joystick_knob'));

    //   // mobile action only
      this.load.image('btn_action', img('action'));

    //   // audio
    //   if (sfx('bgm')) this.load.audio('bgm', sfx('bgm'));
    //   if (sfx('collect')) this.load.audio('collect', sfx('collect'));
    //   if (sfx('hit')) this.load.audio('hit', sfx('hit'));
    //   if (sfx('win')) this.load.audio('win', sfx('win'));
    //   if (sfx('gameover')) this.load.audio('gameover', sfx('gameover'));
    //   if (sfx('explosion')) this.load.audio('explosion', sfx('explosion'));
  }

  create() {
    this.cfg = this.registry.get('cfg') || {};
    this._resetRunState(); // <— IMPORTANT
    const gp = this.cfg.gameplay || {};


    // Timer
    this.state.timeLeft = 60;

    // Background
    if (this.textures.exists('background')) {
      this.add.image(this.W * 0.5, this.H * 0.5, 'background')
        .setDisplaySize(this.W, this.H).setDepth(-10);
    } else {
      this.cameras.main.setBackgroundColor('#0b0f1a');
    }

    // Physics world
    this.physics.world.setBounds(0, 0, this.W, this.H);

    // Arena walls
    this.walls = this.physics.add.staticGroup();
    const wallT = gp.wallThickness ?? 24;
    const top = this.add.sprite(this.W / 2, 10, 'platform').setDisplaySize(this.W, wallT);
    const bot = this.add.sprite(this.W / 2, this.H - 10, 'platform').setDisplaySize(this.W, wallT);
    const left = this.add.sprite(10, this.H / 2, 'platform').setDisplaySize(wallT, this.H);
    const right = this.add.sprite(this.W - 10, this.H / 2, 'platform').setDisplaySize(wallT, this.H);
    [top, bot, left, right].forEach(s => { this.physics.add.existing(s, true); s.body.setSize(s.displayWidth, s.displayHeight); this.walls.add(s); });

    // Player
    this.player = this.add.sprite(this.W * 0.25, this.H * 0.5, 'player').setDepth(1);
    this.player.setDisplaySize(gp.playerSize ?? 72, gp.playerSize ?? 72);
    this.physics.add.existing(this.player);
    this.player.body.setCollideWorldBounds(true);
    this.player.body.setSize(this.player.displayWidth, this.player.displayHeight);

    // Groups
    this.shadows = this.physics.add.group({ collideWorldBounds: true });
    this.lights = this.physics.add.group();
    this.time.addEvent({ delay: 1000, callback: () => this._tickTimer(), loop: true });
    this.time.addEvent({ delay: gp.shadowSpawnMs ?? 950, callback: () => this._spawnShadowRandom(), loop: true });
    this.time.addEvent({ delay: gp.lightSpawnMs ?? 2300, callback: () => this._spawnFallingLight(), loop: true });
    this.time.addEvent({ delay: gp.difficultyRampMs ?? 5000, callback: () => this._rampDifficulty(), loop: true });

    // Seed an immediate first drop so you can see it without waiting:
    this._spawnFallingLight();

    // Collisions
    this.physics.add.collider(this.player, this.walls);
    this.physics.add.collider(this.shadows, this.walls);
    this.physics.add.collider(this.shadows, this.shadows);

    this.physics.add.overlap(this.player, this.shadows, () => this._onPlayerHit(), null, this);
    this.physics.add.overlap(this.player, this.lights, (_pl, light) => this._collectLight(light), null, this);

    // Keyboard (SPACE for blast)
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys('W,A,S,D,SPACE');
    this.input.keyboard.on('keydown-SPACE', () => this._lightBlast(), this);

    // UI
    const fontFamily = this.cfg.font?.family ?? 'sans-serif';
    const labelScore = (this.cfg.texts?.score_label ?? 'Light Collected: ');
    this.ui.timer = this.add.text(this.W / 2, 30, this._fmtTime(this.state.timeLeft), { fontFamily, fontSize: '36px', color: '#ffffff' }).setOrigin(0.5, 0);
    this.ui.score = this.add.text(30, 30, `${labelScore}0`, { fontFamily, fontSize: '36px', color: '#ffffff' });
    this.ui.charges = this.add.text(30, 70, `Charges: 0`, { fontFamily, fontSize: '32px', color: '#ffee88' });

    // Audio
    this._playBgm();

    // Systems
    this.time.addEvent({ delay: 1000, callback: () => this._tickTimer(), loop: true });
    this.time.addEvent({ delay: gp.shadowSpawnMs ?? 950, callback: () => this._spawnShadowRandom(), loop: true });
    this.time.addEvent({ delay: gp.lightSpawnMs ?? 2300, callback: () => this._spawnFallingLight(), loop: true });
    this.time.addEvent({ delay: gp.difficultyRampMs ?? 5000, callback: () => this._rampDifficulty(), loop: true });

    // Joystick + action-only button
    this.setupControls();
    this._createActionButton();
    this.scale.on('resize', () => {
      this.setupControls();
      this._positionActionButton();
    });
  }

  update() {
    if (!this.state.alive || this.state.finished) return;

    const gp = this.cfg.gameplay || {};
    const speed = gp.playerSpeed ?? 300;

    // Joystick movement
    if (this.joystickData && this.joystickData.force > 0) {
      const fx = this.joystickData.forceX;
      const fy = this.joystickData.forceY;
      this.player.body.setVelocity(fx * speed, fy * speed);
      if (Math.abs(fx) > 0.1 || Math.abs(fy) > 0.1) {
        this.state.lastMoveVec.set(fx, fy).normalize();
      }
    } else {
      this.player.body.setVelocity(0, 0);
    }

    // Shadows seek player
    const sBase = gp.shadowSpeed ?? 230;
    this.shadows.children.iterate((s) => {
      if (!s) return;
      const dx = this.player.x - s.x;
      const dy = this.player.y - s.y;
      const d = Math.hypot(dx, dy) || 1;
      const v = sBase * (s.speedScale ?? 1);
      s.body.setVelocity((dx / d) * v, (dy / d) * v);
    });

    this._cleanup();
  }

  // ===== Helpers =====
  _fmtTime(t) {
    t = Math.max(0, t | 0);
    const m = Math.floor(t / 60);
    const s = (t % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  _tickTimer() {
    if (!this.state.alive || this.state.finished) return;
    this.state.timeLeft -= 1;
    this.ui.timer.setText(this._fmtTime(this.state.timeLeft));
    if (this.state.timeLeft <= 0) this._win();
  }

  setupControls() {
    const cam = this.cameras.main;
    const joyX = 200, joyY = cam.height - 200;

    // If joystickData exists but its knob was destroyed (from previous run), rebuild
    if (this.joystickData && (!this.joystickData.knob || !this.joystickData.knob.active)) {
      this.joystickData = null;
    }

    if (!this.joystickData) {
      const bg = this.add.image(joyX, joyY, "joystick_bg").setDepth(10).setScrollFactor(0).setInteractive();
      const knob = this.add.image(joyX, joyY, "joystick_knob").setDepth(11).setScrollFactor(0).setInteractive();

      this.joystickData = {
        knob, forceX: 0, forceY: 0,
        get force() { return Math.sqrt(this.forceX ** 2 + this.forceY ** 2); }
      };

      let dragging = false;
      let dragPointerId = null;
      const startX = knob.x, startY = knob.y;
      const maxDist = 100;

      const onPointerDown = (pointer) => { dragging = true; dragPointerId = pointer.id; };
      const onPointerUp = (pointer) => {
        if (pointer.id === dragPointerId) {
          dragging = false; dragPointerId = null;
          knob.x = startX; knob.y = startY;
          this.joystickData.forceX = 0; this.joystickData.forceY = 0;
        }
      };
      const onPointerMove = (pointer) => {
        if (!dragging || pointer.id !== dragPointerId) return;
        const dx = pointer.x - startX, dy = pointer.y - startY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const ang = Math.atan2(dy, dx);
        const cd = Phaser.Math.Clamp(dist, 0, maxDist);
        knob.x = startX + Math.cos(ang) * cd;
        knob.y = startY + Math.sin(ang) * cd;
        this.joystickData.forceX = Phaser.Math.Clamp(dx / maxDist, -1, 1);
        this.joystickData.forceY = Phaser.Math.Clamp(dy / maxDist, -1, 1);
      };

      // bind
      knob.on('pointerdown', onPointerDown);
      this.input.on('pointerup', onPointerUp);
      this.input.on('pointermove', onPointerMove);

      // save a detach function so we can unhook on shutdown
      this._detachJoystickListeners = () => {
        knob.off('pointerdown', onPointerDown);
        this.input.off('pointerup', onPointerUp);
        this.input.off('pointermove', onPointerMove);
      };

    } else {
      this.joystickData.knob.setPosition(joyX, joyY);
    }
  }


  // ---- Spawners ----
  _spawnShadowRandom() {
    if (!this.state.alive || this.state.finished) return;
    const gp = this.cfg.gameplay || {};
    const pad = gp.arenaPadding ?? 80;

    const edgeBias = Phaser.Math.Between(0, 99);
    let x, y;
    if (edgeBias < 70) {
      const side = Phaser.Math.Between(0, 3);
      if (side === 0) { x = Phaser.Math.Between(pad, this.W - pad); y = pad; }
      else if (side === 1) { x = this.W - pad; y = Phaser.Math.Between(pad, this.H - pad); }
      else if (side === 2) { x = Phaser.Math.Between(pad, this.W - pad); y = this.H - pad; }
      else { x = pad; y = Phaser.Math.Between(pad, this.H - pad); }
    } else {
      x = Phaser.Math.Between(pad, this.W - pad);
      y = Phaser.Math.Between(pad, this.H - pad);
    }

    const sh = this.add.sprite(x, y, 'shadow').setTint(0x222222);
    sh.setDisplaySize(gp.shadowSize ?? 64, gp.shadowSize ?? 64);
    this.physics.add.existing(sh);
    sh.body.setCollideWorldBounds(true);
    sh.body.setBounce(0.2);
    sh.body.setSize(sh.displayWidth, sh.displayHeight);
    sh.speedScale = 1.0;
    this.shadows.add(sh);
  }

  _spawnFallingLight() {
    if (!this.state.alive || this.state.finished) return;
    const gp = this.cfg.gameplay || {};
    const pad = gp.arenaPadding ?? 80;
    const x = Phaser.Math.Between(pad, this.W - pad);
    const y = -80; // a bit higher so it's clearly “from above”

    // Make sure the collectible texture exists
    if (!this.textures.exists('collectible')) {
      console.warn('[ShadowTag] Missing texture key: collectible — check config.json images.collectible');
      return;
    }

    const light = this.add.sprite(x, y, 'collectible').setDepth(1);
    light.setDisplaySize(gp.lightSize ?? 50, gp.lightSize ?? 50);
    this.physics.add.existing(light);
    light.body.setSize(light.displayWidth, light.displayHeight);

    // Top-down: no gravity, move via velocity
    light.body.allowGravity = false;
    light.body.setCollideWorldBounds(false);

    // SLOW, readable fall
    light.body.setVelocity(Phaser.Math.Between(-25, 25), gp.lightFallSpeed ?? 45);

    this.lights.add(light);

    // Cleanup if it somehow goes out for too long
    this.time.delayedCall(18000, () => {
      if (light && light.active && light.y > this.H + 80) light.destroy();
    });
  }


  _rampDifficulty() {
    if (!this.state.alive || this.state.finished) return;
    this.shadows.children.iterate((s) => { if (s) s.speedScale = Math.min((s.speedScale ?? 1) + 0.05, 1.8); });
  }

  // ---- Interactions ----
  _collectLight(light) {
    if (!light || !light.active) return;
    light.destroy();
    this.state.lightCharges += 1;
    this.state.score += 1;

    const label = this.cfg.texts?.score_label ?? 'Light Collected: ';
    this.ui.score.setText(`${label}${this.state.score}`);
    this.ui.charges.setText(`Charges: ${this.state.lightCharges}`);
    this._playOnce('collect');
  }

  // ---- LIGHT BLAST ----
  _lightBlast() {
    if (!this.state.alive || this.state.finished) return;
    if (this.state.lightCharges <= 0) return;

    this.state.lightCharges -= 1;
    this.ui.charges.setText(`Charges: ${this.state.lightCharges}`);

    this._playOnce('hit');
    this.cameras.main.flash(180, 255, 255, 255);
    this.tweens.add({ targets: this.player, alpha: 0.6, duration: 90, yoyo: true });

    const arr = this.shadows.getChildren().slice();
    for (let i = 0; i < arr.length; i++) {
      const s = arr[i];
      if (!s || !s.active) continue;
      this._playOnce('explosion');
      this.tweens.add({
        targets: s,
        alpha: 0,
        scaleX: 0.7,
        scaleY: 0.7,
        duration: 140,
        onComplete: () => { if (s && s.active) s.destroy(); }
      });
    }
  }

  // ---- End states ----
  _onPlayerHit() {
    if (!this.state.alive || this.state.finished) return;
    this.state.alive = false;
    this.state.finished = true;

    this._playOnce('gameover');
    this.cameras.main.flash(250, 255, 40, 40);
    this.player.setTint(0xff4444);
    this.player.body.setVelocity(0, 0);
    this.shadows.children.iterate((s) => s && s.body.setVelocity(0, 0));

    // stop bgm if any
    this.sound.sounds.forEach(s => { if (s && s.key === 'bgm') s.stop(); });

    // small delay for feedback, then go to GameOverScene
    const data = { cfg: this.cfg, stats: this._gatherStats() };
    this.time.delayedCall(450, () => {
      this.scene.start('GameOverScene', data);
    });
  }
  _resetRunState() {
    // Fresh gameplay flags
    this.state = {
      timeLeft: 60,
      score: 0,
      alive: true,
      finished: false,
      lightCharges: 0,
      lastMoveVec: new Phaser.Math.Vector2(1, 0),
    };

    // Clear UI/button/joystick references so they can be recreated
    if (this.btnAction) { this.btnAction.destroy(); }
    this.btnAction = null;

    // Force joystick to rebuild
    this.joystickData = null;

    // If you keep any custom timers/arrays, reset them here too
  }
  _win() {
    if (!this.state.alive || this.state.finished) return;
    this.state.finished = true;

    this._playOnce('win');
    this.cameras.main.flash(250, 60, 255, 120);

    // stop bgm if any
    this.sound.sounds.forEach(s => { if (s && s.key === 'bgm') s.stop(); });

    // pass stats to WinScene
    const data = { cfg: this.cfg, stats: this._gatherStats() };
    this.time.delayedCall(450, () => {
      this.scene.start('WinScene', data);
    });
  }


  // ---- Misc ----
  _cleanup() {
    this.shadows.children.iterate((s) => s && s.body && s.body.setSize(s.displayWidth, s.displayHeight));
    this.lights.children.iterate((l) => {
      if (!l || !l.body) return;
      l.body.setSize(l.displayWidth, l.displayHeight);
      if (l.y > this.H + 80) l.destroy();
    });
    if (this.player && this.player.body) this.player.body.setSize(this.player.displayWidth, this.player.displayHeight);
  }

  _playBgm() {
    if (!this.cache.audio.exists('bgm')) return;
    const bgm = this.sound.add('bgm', { loop: true, volume: 0.6 });
    bgm.play();
  }
  _playOnce(key) {
    if (!this.cache.audio.exists(key)) return;
    this.sound.play(key, { volume: 0.9 });
  }

  // ---- Action-only mobile button ----
  _createActionButton() {
    const actionX = this.W - 160;
    const actionY = this.H - 100;

    if (!this.btnAction) {
      this.btnAction = this.add.image(actionX, actionY-100, 'btn_action').setInteractive().setScrollFactor(0).setDepth(12);
      this.btnAction.setDisplaySize(100, 100);
      // this.btnAction.on('pointerdown', () => { this.btnAction.setScale(0.9); this.btnAction.setAlpha(0.85); this._lightBlast(); });
      this.btnAction.on('pointerup', () => { this.btnAction.setScale(1); this.btnAction.setAlpha(1); });
      this.btnAction.on('pointerout', () => { this.btnAction.setScale(1); this.btnAction.setAlpha(1); });
    } else {
      this._positionActionButton();
    }
  }
  _positionActionButton() {
    if (!this.btnAction) return;
    const cam = this.cameras.main;
    this.btnAction.setPosition(cam.width - 160, cam.height - 100);
  }

  _gatherStats() {
    const survived = 60 - Math.max(0, this.state.timeLeft | 0);
    return {
      survivedSeconds: survived,
      collected: this.state.score,
      chargesLeft: this.state.lightCharges
    };
  }

}
