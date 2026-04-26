class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');

    // Runtime state
    this._finished = false;
    this._timeLeft = 0;
    this._score = 0;
    this._playerHP = 3;

    // Refs / groups
    this._player = null;
    this._ghosts = null;
    this._portals = null;
    this._walls = null;

    // UI
    this._scoreText = null;
    this._hpText = null;
    this._timerText = null;

    // Input flags (mobile)
    this._joystick = null;
    this._joystickThumb = null;
    this._joystickBase = null;
    this._joystickActive = false;
    this._joystickVector = { x: 0, y: 0 };
    this._touchAction = false;

    // Audio
    this._bgm = null;

    // Colliders & flags
    this._playerWallsCollider = null;
    this._ghostsWallsCollider = null;
    this._portalWallColliders = [];
    this._mazeCleared = false;

    // Misc
    this._portalTargetsSealed = 0;
    this._totalPortals = 0;
  }

  preload() {
    const cfg = this.registry.get('cfg') || {};
    const images = cfg.images1 || {};
    const images2 = cfg.images2 || {};
    const ui = cfg.ui || {};
    const spritesheets = cfg.spritesheets || {};
    const audio = cfg.audio || {};
    const font = cfg.font || null;

    if (font && font.url && font.family) {
      const ff = new FontFace(font.family, `url(${font.url})`);
      ff.load().then(f => document.fonts.add(f)).catch(() => { });
    }

    for (const [key, url] of Object.entries(images)) {
      this.load.image(key, url);
    }
    for (const [key, url] of Object.entries(images2)) {
      this.load.image(key, url);
    }
    for (const [key, url] of Object.entries(ui)) {
      this.load.image(key, url);
    }

    for (const [key, meta] of Object.entries(spritesheets)) {
      if (!meta || !meta.url) continue;
      this.load.spritesheet(key, meta.url, {
        frameWidth: meta.frameWidth,
        frameHeight: meta.frameHeight,
        endFrame: meta.frames - 1
      });
    }

    for (const [key, url] of Object.entries(audio)) {
      this.load.audio(key, url);
    }
  }

  create() {
    const cfg = this.registry.get('cfg') || {};
    const G = cfg.gameplay || {};
    const T = cfg.texts || {};
    const cam = this.sys.cameras.main;

    // Difficulty knobs
    const MAX_GHOSTS = G.maxGhosts ?? 10;
    const GHOSTS_PER_WAVE = G.ghostsPerWave ?? 2;
    const PORTAL_SPAWN_CHANCE = G.portalSpawnChance ?? 0.6;
    const MIN_PLAYER_SPAWN_DIST = G.minSpawnDist ?? 160;

    const W = this.sys.game.config.width;
    const H = this.sys.game.config.height;

    // State
    this._finished = false;
    this._score = 0;
    this._playerHP = G.playerHP ?? 3;
    this._timeLeft = G.timerSeconds ?? 90;
    this._portalTargetsSealed = 0;

    // WORLD & PHYSICS
    this.physics.world.setBounds(0, 0, W, H);

    // Background
    if (cfg.images2?.background) {
      const bg = this.add.image(W * 0.5, H * 0.5, 'background');
      bg.setDisplaySize(W, H);
      bg.setDepth(-100);
    }

    // Maze walls
    this._walls = this.physics.add.staticGroup();
    const wallTex = 'platform';
    const addWall = (x, y, w, h) => {
      const wall = this.add.image(x, y, wallTex);
      wall.setDisplaySize(w, h);
      this.physics.add.existing(wall, true);
      wall.body.setSize(w, h);
      this._walls.add(wall);
    };

    // Outer bounds
    addWall(W * 0.5, 16, W, 32);
    addWall(W * 0.5, H - 16, W, 32);
    addWall(16, H * 0.5, 32, H);
    addWall(W - 16, H * 0.5, 32, H);

    // Inner walls
    addWall(W * 0.5, H * 0.35, W * 0.7, 24);
    addWall(W * 0.5, H * 0.65, W * 0.7, 24);
    addWall(W * 0.28, H * 0.5, 24, H * 0.35);
    addWall(W * 0.72, H * 0.5, 24, H * 0.35);

    // PLAYER
    this._player = this.add.image(W * 0.2, H * 0.8, 'player');
    this._player.setDisplaySize(G.playerSize?.w ?? 80, G.playerSize?.h ?? 80);
    this.physics.add.existing(this._player);
    this._player.body.setCollideWorldBounds(true);
    // this._player.body.setSize(this._player.displayWidth, this._player.displayHeight);
    const bw = this._player.displayWidth * 3;
    const bh = this._player.displayHeight * 10;

    this._player.body.setSize(bw + 150, bh + 100);       // resize the hitbox
    this._player.body.setOffset(             // recenter it (optional)
      (this._player.displayWidth - bw) * 0.05,
      (this._player.displayHeight - bh) * 0.2
    );
    // GROUPS
    this._ghosts = this.add.group();
    this._portals = this.add.group();

    // COLLISIONS
    this._playerWallsCollider = this.physics.add.collider(this._player, this._walls);
    this._ghostsWallsCollider = this.physics.add.collider(this._ghosts, this._walls);
    this.physics.add.overlap(this._player, this._ghosts, this._onPlayerHitGhost, null, this);

    // PORTALS
    const portalCount = G.portalCount ?? 3;
    const portalRadius = 60;
    const portalTex = 'portal';
    const runeTex = 'rune';
    const portalSpots = [
      { x: W * 0.8, y: H * 0.2 },
      { x: W * 0.5, y: H * 0.5 },
      { x: W * 0.8, y: H * 0.85 },
      { x: W * 0.25, y: H * 0.55 },
      { x: W * 0.6, y: H * 0.3 }
    ];

    Phaser.Utils.Array.Shuffle(portalSpots);
    for (let i = 0; i < portalCount; i++) {
      const spot = portalSpots[i % portalSpots.length];
      const p = this._createPortal(spot.x, spot.y, portalTex, runeTex, portalRadius);
      this._portals.add(p.container);
    }
    this._totalPortals = this._portals.getLength();

    // GHOST SPAWNING
    const spawnEveryMs = G.ghostSpawnRateMs ?? 2500;
    this.time.addEvent({
      delay: spawnEveryMs,
      loop: true,
      callback: () => {
        if (this._finished) return;
        if (this._ghosts.getLength() >= MAX_GHOSTS) return;

        const portals = this._portals.getChildren().slice();
        Phaser.Utils.Array.Shuffle(portals);

        let spawns = 0;
        for (const pc of portals) {
          if (spawns >= GHOSTS_PER_WAVE) break;
          const data = pc?.getData?.('portal');
          if (!data || data.sealed) continue;

          if (Math.random() > PORTAL_SPAWN_CHANCE) continue;

          const dx = this._player.x - pc.x;
          const dy = this._player.y - pc.y;
          const d = Math.hypot(dx, dy);
          if (d < MIN_PLAYER_SPAWN_DIST) continue;

          this._spawnGhostNearPortal(pc);
          spawns++;

          if (this._ghosts.getLength() >= MAX_GHOSTS) break;
        }
      }
    });

    // DIFFICULTY SCALER
    this.time.addEvent({
      delay: G.difficultyStepMs ?? 12000,
      loop: true,
      callback: () => {
        if (this._finished) return;
        const base = (this.registry.get('cfg')?.gameplay?.ghostSpeed ?? 110);
        const cur = this.registry.get('ghostSpeed') ?? base;
        const step = (this.registry.get('cfg')?.gameplay?.ghostSpeedStep ?? 10);
        const max = (this.registry.get('cfg')?.gameplay?.ghostSpeedMax ?? 200);
        const nxt = Math.min(cur + step, max);
        this.registry.set('ghostSpeed', nxt);
      }
    });

    // INPUT
    this._keys = this.input.keyboard.addKeys({
      left: Phaser.Input.Keyboard.KeyCodes.LEFT,
      right: Phaser.Input.Keyboard.KeyCodes.RIGHT,
      up: Phaser.Input.Keyboard.KeyCodes.UP,
      down: Phaser.Input.Keyboard.KeyCodes.DOWN,
      A: Phaser.Input.Keyboard.KeyCodes.A,
      D: Phaser.Input.Keyboard.KeyCodes.D,
      W: Phaser.Input.Keyboard.KeyCodes.W,
      S: Phaser.Input.Keyboard.KeyCodes.S,
      SPACE: Phaser.Input.Keyboard.KeyCodes.SPACE
    });
    this.input.addPointer(3);

    // MOBILE CONTROLS
    this._createMobileButtons();

    // ENHANCED UI with cool styling
    const fontFamily = cfg.font?.family || 'Arial Black, sans-serif';

    // Score text with glow effect
    const label = (T.score_label || 'SCORE: ');
    this._scoreText = this.add.text(60, 40, `${label}0`, {
      fontFamily: fontFamily,
      fontSize: '42px',
      fontStyle: 'bold',
      color: '#00ffff',
      stroke: '#0033ff',
      strokeThickness: 4,
      shadow: {
        offsetX: 0,
        offsetY: 0,
        color: '#00ffff',
        blur: 10,
        fill: true
      }
    }).setScrollFactor(0).setDepth(1000);

    // HP text with danger colors
    this._hpText = this.add.text(60, 100, `HP: ${this._playerHP}`, {
      fontFamily: fontFamily,
      fontSize: '42px',
      fontStyle: 'bold',
      color: '#ff3366',
      stroke: '#990033',
      strokeThickness: 4,
      shadow: {
        offsetX: 0,
        offsetY: 0,
        color: '#ff3366',
        blur: 10,
        fill: true
      }
    }).setScrollFactor(0).setDepth(1000);

    // Timer text with warning style
    this._timerText = this.add.text(W - 60, 40, this._fmtTime(this._timeLeft), {
      fontFamily: fontFamily,
      fontSize: '42px',
      fontStyle: 'bold',
      color: '#ffff00',
      stroke: '#ff6600',
      strokeThickness: 4,
      shadow: {
        offsetX: 0,
        offsetY: 0,
        color: '#ffff00',
        blur: 10,
        fill: true
      }
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(1000);

    // Pulse effect for timer when low
    this.time.addEvent({
      delay: 500,
      loop: true,
      callback: () => {
        if (this._finished) return;
        if (this._timeLeft <= 10 && this._timeLeft > 0) {
          this.tweens.add({
            targets: this._timerText,
            scale: { from: 1.0, to: 1.2 },
            duration: 200,
            yoyo: true
          });
        }
      }
    });

    // TIMER
    this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        if (this._finished) return;
        this._timeLeft = Math.max(0, this._timeLeft - 1);
        this._timerText.setText(this._fmtTime(this._timeLeft));
        if (this._timeLeft <= 0) {
          this._gameOver('time_up');
        }
      }
    });

    // AUDIO
    if (this.sound) {
      this._bgm = this.sound.add('bgm', { loop: true, volume: 0.6 });
      if (this._bgm) this._bgm.play();
    }

    this.registry.set('ghostSpeed', G.ghostSpeed ?? 110);
  }

  update(_, dt) {
    if (this._finished) return;

    // Movement
    const speed = (this.registry.get('cfg')?.gameplay?.playerSpeed ?? 240);
    const body = this._player.body;
    if (body) {
      let vx = 0;
      let vy = 0;

      const left = this._keys.left.isDown || this._keys.A.isDown;
      const right = this._keys.right.isDown || this._keys.D.isDown;
      const up = this._keys.up.isDown || this._keys.W.isDown;
      const down = this._keys.down.isDown || this._keys.S.isDown;

      if (left && !right) vx = -speed;
      else if (right && !left) vx = speed;

      if (up && !down) vy = -speed;
      else if (down && !up) vy = speed;

      if (this._joystickActive) {
        vx = this._joystickVector.x * speed;
        vy = this._joystickVector.y * speed;
      }

      if (vx !== 0) {
        this._player.setFlipX(vx < 0); // left = true, right = false
      }

      body.setVelocity(vx, vy);
    }

    // Ghost AI
    const gSpeed = this.registry.get('ghostSpeed') ?? 120;
    this._ghosts.getChildren().forEach((g) => {
      const gb = g.body;
      if (!gb) return;
      const dx = this._player.x - g.x;
      const dy = this._player.y - g.y;
      const len = Math.max(1, Math.hypot(dx, dy));
      gb.setVelocity((dx / len) * gSpeed, (dy / len) * gSpeed);
    });

    // Interaction with portals
    const actionPressed = this._keys.SPACE.isDown || this._touchAction;
    if (actionPressed) {
      this._attemptPortalPuzzle();
    }
  }

  // ---------- Helpers ----------

  _createMobileButtons() {
    const cfg = this.registry.get('cfg') || {};
    const W = this.sys.game.config.width;
    const H = this.sys.game.config.height;

    this._createJoystick(180, H - 180);

    const actionBtn = this.add.image(W - 160, H - 180, 'action').setInteractive({ useHandCursor: false });
    actionBtn.setDisplaySize(140, 140);
    actionBtn.setScrollFactor(0).setDepth(1000).setAlpha(0.8);

    actionBtn.on('pointerdown', () => {
      actionBtn.setScale(0.9);
      actionBtn.setAlpha(1.0);
      this._touchAction = true;
    });

    actionBtn.on('pointerup', () => {
      actionBtn.setScale(1.0);
      actionBtn.setAlpha(0.8);
      this._touchAction = false;
    });

    actionBtn.on('pointerout', () => {
      actionBtn.setScale(1.0);
      actionBtn.setAlpha(0.8);
      this._touchAction = false;
    });
  }

  _createJoystick(x, y) {
    const baseRadius = 80;
    const thumbRadius = 40;
    const maxDistance = 60;

    this._joystickBase = this.add.circle(x, y, baseRadius, 0x000000, 0.3);
    this._joystickBase.setStrokeStyle(3, 0xffffff, 0.5);
    this._joystickBase.setScrollFactor(0).setDepth(999);

    this._joystickThumb = this.add.circle(x, y, thumbRadius, 0xffffff, 0.8);
    this._joystickThumb.setStrokeStyle(3, 0x00ff00, 0.8);
    this._joystickThumb.setScrollFactor(0).setDepth(1000);

    this._joystickBase.setInteractive({ useHandCursor: false, draggable: false });

    const baseX = x;
    const baseY = y;

    this._joystickBase.on('pointerdown', (pointer) => {
      this._joystickActive = true;
      this._updateJoystickPosition(pointer, baseX, baseY, maxDistance);
    });

    this.input.on('pointermove', (pointer) => {
      if (this._joystickActive) {
        this._updateJoystickPosition(pointer, baseX, baseY, maxDistance);
      }
    });

    this.input.on('pointerup', () => {
      if (this._joystickActive) {
        this._joystickActive = false;
        this._joystickVector.x = 0;
        this._joystickVector.y = 0;

        this.tweens.add({
          targets: this._joystickThumb,
          x: baseX,
          y: baseY,
          duration: 100,
          ease: 'Power2'
        });
      }
    });
  }

  _updateJoystickPosition(pointer, baseX, baseY, maxDistance) {
    const dx = pointer.x - baseX;
    const dy = pointer.y - baseY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > 0) {
      const clampedDistance = Math.min(distance, maxDistance);
      const angle = Math.atan2(dy, dx);

      const thumbX = baseX + Math.cos(angle) * clampedDistance;
      const thumbY = baseY + Math.sin(angle) * clampedDistance;

      this._joystickThumb.x = thumbX;
      this._joystickThumb.y = thumbY;

      this._joystickVector.x = (thumbX - baseX) / maxDistance;
      this._joystickVector.y = (thumbY - baseY) / maxDistance;
    } else {
      this._joystickVector.x = 0;
      this._joystickVector.y = 0;
    }
  }

  _fmtTime(t) {
    const m = Math.floor(t / 60);
    const s = (t % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  _onPlayerHitGhost = (player, ghost) => {
    if (this._finished) return;
    this._playerHP = Math.max(0, this._playerHP - 1);
    if (this.sound && this.sound.get('hit')) this.sound.play('hit', { volume: 0.9 });
    this._hpText.setText(`HP: ${this._playerHP}`);

    // Flash effect on hit
    this.tweens.add({
      targets: this._hpText,
      scale: { from: 1.3, to: 1.0 },
      duration: 300,
      ease: 'Bounce.easeOut'
    });

    if (this._playerHP <= 0) {
      this._gameOver('caught');
    }
  };

  _createPortal(x, y, portalKey, runeKey, radius) {
    const base = this.add.image(0, 0, portalKey);
    base.setTint(0x9b59ff);
    base.setDisplaySize(96, 96);

    const r1 = this.add.image(0, -radius, runeKey).setDisplaySize(64, 64);
    const r2 = this.add.image(radius * 0.87, radius * 0.5, runeKey).setDisplaySize(64, 64);
    const r3 = this.add.image(-radius * 0.87, radius * 0.5, runeKey).setDisplaySize(64, 64);

    const choices = [0, 90, 180, 270];

    const startAngles = [
      Phaser.Utils.Array.GetRandom(choices),
      Phaser.Utils.Array.GetRandom(choices),
      Phaser.Utils.Array.GetRandom(choices)
    ];

    r1.setAngle(startAngles[0]);
    r2.setAngle(startAngles[1]);
    r3.setAngle(startAngles[2]);

    const targetAngles = startAngles.map((a) => {
      const opts = choices.filter((c) => c !== ((a % 360) + 360) % 360);
      return Phaser.Utils.Array.GetRandom(opts);
    });

    const c = this.add.container(x, y, [base, r1, r2, r3]);
    this.physics.add.existing(c);
    c.body.setSize(110, 110);
    c.setData('portal', {
      base,
      runes: [r1, r2, r3],
      sealed: false,
      solving: false,
      targetAngles
    });

    this.tweens.add({
      targets: base,
      alpha: { from: 0.6, to: 1.0 },
      duration: 800,
      yoyo: true,
      repeat: -1
    });

    const col = this.physics.add.collider(c, this._walls);
    if (!this._portalWallColliders) this._portalWallColliders = [];
    this._portalWallColliders.push(col);

    return { container: c };
  }

  _spawnGhostNearPortal(pc) {
    const x = pc.x + Phaser.Math.Between(-30, 30);
    const y = pc.y + Phaser.Math.Between(-30, 30);

    // SPAWN EFFECT - Portal flash and particles
    const flash = this.add.circle(pc.x, pc.y, 60, 0x9b59ff, 0.8);
    flash.setDepth(100);

    this.tweens.add({
      targets: flash,
      scale: { from: 0.3, to: 2.0 },
      alpha: { from: 0.8, to: 0 },
      duration: 400,
      ease: 'Power2',
      onComplete: () => flash.destroy()
    });

    // Create particle burst effect
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const particle = this.add.circle(pc.x, pc.y, 6, 0xff00ff, 0.9);
      particle.setDepth(99);

      this.tweens.add({
        targets: particle,
        x: pc.x + Math.cos(angle) * 80,
        y: pc.y + Math.sin(angle) * 80,
        alpha: 0,
        scale: 0,
        duration: 500,
        ease: 'Power2',
        onComplete: () => particle.destroy()
      });
    }

    // Spawn the ghost with entrance effect
    const g = this.add.image(x, y, 'enemy');
    g.setTint(0xffffff);
    g.setDisplaySize(70, 70);
    g.setAlpha(0);
    g.setScale(0.5);

    this.physics.add.existing(g);
    g.body.setCollideWorldBounds(true);
    g.body.setSize(g.displayWidth, g.displayHeight);
    this._ghosts.add(g);

    // Ghost entrance animation
    this.tweens.add({
      targets: g,
      alpha: 1,
      scale: 0.5,
      duration: 300,
      ease: 'Back.easeOut'
    });

    if (!this._mazeCleared && this._walls && this._walls.getLength() > 0) {
      this.physics.add.collider(g, this._walls);
    }
  }

  _attemptPortalPuzzle() {
    const reach = 90;
    let nearest = null;
    let bestD = Infinity;

    this._portals.getChildren().forEach((pc) => {
      const portal = pc.getData('portal');
      if (!portal || portal.sealed) return;
      const dx = this._player.x - pc.x;
      const dy = this._player.y - pc.y;
      const d = Math.hypot(dx, dy);
      if (d < reach && d < bestD) {
        bestD = d;
        nearest = pc;
      }
    });

    if (!nearest) return;
    const portal = nearest.getData('portal');
    if (portal.solving) return;

    portal.solving = true;

    const rotateNext = () => {
      if (!portal || portal.sealed) return;
      const runes = portal.runes;
      let idx = runes.findIndex((r, i) => (Math.abs((r.angle % 360) - portal.targetAngles[i]) % 360) !== 0);
      if (idx < 0) idx = 0;
      runes[idx].angle = Phaser.Math.Snap.To((runes[idx].angle + 90) % 360, 90);
      this.sound?.play('attack', { volume: 0.6 });

      const allMatch = runes.every((r, i) => ((Math.abs((r.angle % 360) - portal.targetAngles[i]) % 360) === 0));
      if (allMatch) {
        this._sealPortal(nearest);
      }
    };

    rotateNext();

    this.time.delayedCall(220, () => { if (portal) portal.solving = false; });
  }

  _sealPortal(pc) {
    const portal = pc.getData('portal');
    if (!portal || portal.sealed) return;
    portal.sealed = true;

    this.sound?.play('explosion', { volume: 0.9 });
    this.tweens.add({
      targets: [portal.base, ...portal.runes],
      scale: { from: 1, to: 0 },
      alpha: { from: 1, to: 0 },
      duration: 350,
      onComplete: () => {
        pc.destroy();
      }
    });

    this._score += (this.registry.get('cfg')?.gameplay?.sealScore ?? 100);
    this._scoreText.setText((this.registry.get('cfg')?.texts?.score_label || 'SCORE: ') + this._score);

    // Score increase animation
    this.tweens.add({
      targets: this._scoreText,
      scale: { from: 1.3, to: 1.0 },
      duration: 300,
      ease: 'Bounce.easeOut'
    });

    this._portalTargetsSealed++;

    const clearAfter = 2;
    if (!this._mazeCleared && this._portalTargetsSealed >= clearAfter) {
      this._clearMazeWalls();
    }

    if (this._portalTargetsSealed >= (this._totalPortals || 0)) {
      this.sound?.play('level_complete', { volume: 0.85 });
      this._win();
    } else {
      this.sound?.play('collect', { volume: 0.8 });
    }
  }

  _clearMazeWalls() {
    if (this._mazeCleared) return;
    this._mazeCleared = true;

    this._playerWallsCollider?.destroy();
    this._playerWallsCollider = null;
    this._ghostsWallsCollider?.destroy();
    this._ghostsWallsCollider = null;

    if (this._portalWallColliders) {
      for (const col of this._portalWallColliders) col?.destroy();
      this._portalWallColliders.length = 0;
    }

    if (this._walls) {
      this._walls.children?.iterate?.((wall) => {
        if (!wall) return;
        if (wall.body) {
          this.physics.world.disableBody(wall.body);
        }
        wall.destroy();
      });

      this._walls.clear(false, false);
    }
  }

  _win() {
    if (this._finished) return;
    this._finished = true;
    if (this._bgm) this._bgm.stop();
    this.scene.start('WinScene', { score: this._score });
  }

  _gameOver(reason) {
    if (this._finished) return;
    this._finished = true;
    this.sound?.play('gameover', { volume: 0.9 });
    if (this._bgm) this._bgm.stop();
    this.scene.start('GameOverScene', { score: this._score, reason });
  }
}