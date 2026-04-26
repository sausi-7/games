

class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameScene', physics: { arcade: { gravity: { y: 1600 }, debug: false } } });

    // runtime handles
    this.cfg = null;
    this.W = 1080; this.H = 1920;

    // entities/groups
    this.player = null;
    this.platforms = null;      // staticGroup
    this.movingPlatforms = [];  // array of sprites we tween
    this.disappearingPlatforms = []; // array of sprites we toggle
    this.exitDoor = null;
    this.fireballs = null;      // physics group

    // ui
    this.ui = {
      timerText: null,
      hearts: [],
      mobile: { left: null, right: null, action: null },
      mobileState: { left: false, right: false, action: false }
    };

    // state
    this.state = {
      timeLeft: 60,
      health: 3,
      finished: false,
      invulnUntil: 0,
      fireballSpawned: 0,
      maxFireballs: 8
    };

    // controls
    this.cursors = null;

    // timers
    this.ticker = null;
    this.fireballSpawner = null;

    // sounds
    this.sfx = { bgm: null, jump: null, hit: null, collide: null, levelComplete: null, gameOver: null };

    // after sounds in constructor:
    this._colPlayerPlatforms = null;
    this._ovlPlayerFireballs = null;
    this._ovlPlayerExit = null;

  }

  init() {
    this._isShuttingDown = false;

    this._colPlayerPlatforms = null;
this._ovlPlayerFireballs = null;
this._ovlPlayerExit = null;


    // Fresh per-start state (constructor may not re-run on restart)
    this.cfg = this.registry.get('cfg') || this.cfg || {};

    this.W = 1080;
    this.H = 1920;

    // Reset runtime containers
    this.player = null;
    this.platforms = null;
    this.movingPlatforms = [];
    this.disappearingPlatforms = [];
    this.exitDoor = null;
    this.fireballs = null;

    // UI & input
    this.ui = {
      timerText: null,
      hearts: [],
      mobile: { left: null, right: null, action: null },
      mobileState: { left: false, right: false, action: false }
    };
    this.cursors = null;

    // Gameplay state
    this.state = {
      timeLeft: 60,
      health: 3,
      finished: false,
      invulnUntil: 0,
      fireballSpawned: 0,
      maxFireballs: 8
    };

    this.ready = false;

    // Timers & sfx handles
    this.ticker = null;
    this.fireballSpawner = null;
    this.sfx = { bgm: null, jump: null, hit: null, collide: null, levelComplete: null, gameOver: null };
  }


  preload() {
    const cfg = this.registry.get('cfg') || {};
    this.cfg = cfg;

    // Helper to conditionally load assets if URL exists
    const L = (key, url) => { if (url) this.load.image(key, url); };

    // IMAGES
    const im = (cfg.images || {});
    L('background', im.background);
    L('player', im.player);
    L('platform', im.platform);
    L('exit', im.exit || im.collectible); // fallback to any object if no dedicated exit
    L('fireball', im.fireball || im.enemy); // fallback to generic enemy
    L('heart', im.heart || im.objHeart); // allow user custom heart

    // mobile buttons
    L('leftBtn', im.left);
    L('rightBtn', im.right);
    L('actionBtn', im.action);

    // AUDIO
    const au = (cfg.audio || {});
    if (au.bgm) this.load.audio('bgm', au.bgm);
    if (au.jump) this.load.audio('jump', au.jump);
    if (au.hit) this.load.audio('hit', au.hit);
    if (au.collect) this.load.audio('collect', au.collect);
    if (au.collision) this.load.audio('collision', au.collision);
    if (au.gameOver) this.load.audio('gameOver', au.gameOver);
    if (au.levelComplete) this.load.audio('levelComplete', au.levelComplete);
  }

  create() {
    const cfg = this.cfg || {};
    const gp = cfg.gameplay || {};
    const images = cfg.images || {};
    const texts = cfg.texts || {};
    // Ensure overlays from a previous run don't cover the new game
    if (this.scene.isActive('GameOverScene')) this.scene.stop('GameOverScene');
    if (this.scene.isActive('WinScene')) this.scene.stop('WinScene');

    // Just in case the previous world was paused somewhere else
    if (this.physics?.world?.isPaused) this.physics.world.resume();

    // Cache for _lateCreate
    this._cachedCfg = { cfg, gp, images, texts };

    // Real viewport size
    const worldW = (this.sys.scale && this.sys.scale.gameSize)
      ? this.sys.scale.gameSize.width
      : (this.scale?.gameSize?.width || this.W);
    const worldH = (this.sys.scale && this.sys.scale.gameSize)
      ? this.sys.scale.gameSize.height
      : (this.scale?.gameSize?.height || this.H);
    this.W = worldW;
    this.H = worldH;

    // If physics not yet ready, defer to next tick
    if (!(this.physics && this.physics.world && this.physics.add)) {
      this.time.delayedCall(0, () => this._lateCreate(), [], this);
      return;
    }




    this._lateCreate();
  }

  _lateCreate() {
    if (!(this.physics && this.physics.world && this.physics.add)) {
      this.time.delayedCall(0, () => this._lateCreate(), [], this);
      return;
    }

    const { cfg, gp } = this._cachedCfg || { cfg: (this.cfg || {}), gp: ((this.cfg || {}).gameplay || {}) };

    // Physics world + safe worldbounds handler
    const world = this.physics.world;
    world.setBounds(0, 0, this.W, this.H);
    world.setBoundsCollision(true, true, true, true);
    world.removeAllListeners && world.removeAllListeners('worldbounds');
    world.on('worldbounds', (body, up, down, left, right) => {
      const go = body && body.gameObject;
      if (!go || !go.getData || !go.getData('isDVD')) return;

      const speed = go.getData('dvdSpeed') || 340;
      if (left || right) body.setVelocityX(-body.velocity.x);
      if (up || down) body.setVelocityY(-body.velocity.y);

      const vx = body.velocity.x, vy = body.velocity.y;
      const len = Math.max(0.0001, Math.hypot(vx, vy));
      body.setVelocity((vx / len) * speed, (vy / len) * speed);

      if (this.sfx && this.sfx.collide) this.sfx.collide.play({ volume: 0.5 });
    });

    // Fallback textures (so scene always renders even if assets missing)
    this._ensureFallbackTexture('background', 0x0a0f1e);
    this._ensureFallbackTexture('player', 0x3ec7e8);
    this._ensureFallbackTexture('platform', 0x6b5f4a, 200, 32);
    this._ensureFallbackTexture('exit', 0xf2d45c, 96, 96, 'EXIT');
    this._ensureFallbackTexture('fireball', 0xff6b6b, 48, 48);
    this._ensureFallbackTexture('heart', 0xff3b3b, 32, 32, '♥');
    this._ensureFallbackTexture('leftBtn', 0x2a2a2a, 128, 128, '◀');
    this._ensureFallbackTexture('rightBtn', 0x2a2a2a, 128, 128, '▶');
    this._ensureFallbackTexture('actionBtn', 0x2a2a2a, 128, 128, '⤒');

    // Background
    const bg = this.add.image(this.W * 0.5, this.H * 0.5, 'background');
    bg.setDisplaySize(this.W, this.H);

    // Platforms (fresh group every time)
    this.platforms = this.physics.add.staticGroup();
    this._buildPlatformTower();

    // Exit
    this.exitDoor = this.physics.add.sprite(this.W * 0.5, 140, 'exit');
    this.exitDoor.setDisplaySize(100, 100);
    this.exitDoor.setImmovable(true);
    this.exitDoor.body.allowGravity = false;
    this.exitDoor.setDepth(2);
    this.tweens.add({
      targets: this.exitDoor, alpha: { from: 1, to: 0.4 },
      duration: 700, yoyo: true, repeat: -1
    });

    // Player
    this.player = this.physics.add.sprite(this.W * 0.5, this.H - 120, 'player');
    this.player.setDisplaySize(64, 64);
    this.player.setCollideWorldBounds(true);
    this.player.setDragX(1400);
    this.player.setMaxVelocity(500, 1400);
    // this.ready = true;
    // Colliders
    this.physics.add.collider(this.player, this.platforms);
    // this.physics.add.collider(this.player, this.movingPlatforms);
    // this.physics.add.collider(this.player, this.disappearingPlatforms);

    // Fireballs & overlaps
    this.fireballs = this.physics.add.group({ allowGravity: false });
    this.physics.add.overlap(this.player, this.fireballs, this._onHitByFireball, null, this);
    this.physics.add.overlap(this.player, this.exitDoor, this._onReachExit, null, this);

    // Controls & mobile UI
    this.cursors = this.input.keyboard.createCursorKeys();
    this._setupMobileButtons();

    // HUD
    const fontFamily = (cfg.font && cfg.font.family) ? cfg.font.family : 'Outfit, Arial';
    this.ui.timerText = this.add.text(this.W * 0.5, 40, this._formatTime(this.state.timeLeft), {
      fontFamily, fontSize: '40px', color: '#ffffff', stroke: '#000', strokeThickness: 4
    }).setOrigin(0.5, 0);
    this._drawHearts();

    // Audio
    this._initAudio();

    // Timers
    const tickRate = 1000;
    this.ticker = this.time.addEvent({ delay: tickRate, loop: true, callback: this._tick, callbackScope: this });
    const spawnRate = gp.fireballSpawnRate || 3500;
    this.fireballSpawner = this.time.addEvent({ delay: spawnRate, loop: true, callback: this._spawnFireball, callbackScope: this });

    // Start with a couple of fireballs
    this._spawnFireball();
    this._spawnFireball();

    // Cleanup hooks
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this._onShutdown, this);
    this.events.once(Phaser.Scenes.Events.DESTROY, this._onShutdown, this);

    // ✅ Mark scene fully built ONLY at the very end
    this.ready = true;
  }

  _destroyColliders() {
  if (this._colPlayerPlatforms) { this._colPlayerPlatforms.destroy(); this._colPlayerPlatforms = null; }
  if (this._ovlPlayerFireballs) { this._ovlPlayerFireballs.destroy(); this._ovlPlayerFireballs = null; }
  if (this._ovlPlayerExit) { this._ovlPlayerExit.destroy(); this._ovlPlayerExit = null; }
}







  update() {
    // If scene not fully built or already finished, do nothing
    if (this.state?.finished || !this.ready) return;

    const speed = (this.cfg?.gameplay?.playerSpeed) || 320;

    // --- INPUT (guard everything) ---
    let vx = 0;
    const curs = this.cursors || null;

    if (curs) {
      if (curs.left?.isDown) vx = -speed;
      else if (curs.right?.isDown) vx = speed;
    }

    if (this.ui?.mobileState?.left) vx = -speed;
    if (this.ui?.mobileState?.right) vx = speed;

    if (this.player?.body) this.player.setVelocityX(vx);

    // Jump
    const wantJump = (curs?.up?.isDown || curs?.space?.isDown || this.ui?.mobileState?.action);
    if (wantJump && this.player?.body?.blocked?.down) {
      this.player.setVelocityY(-1050);
      if (this.sfx?.jump) this.sfx.jump.play({ volume: 0.9 });
    }

    // Keep disappearing platforms synced
    if (Array.isArray(this.disappearingPlatforms)) {
      this.disappearingPlatforms.forEach(p => {
        if (p?.body) p.body.checkCollision.none = !p.visible;
      });
    }

    // --- FIREBALL SPEED NORMALIZATION (guards included) ---
    if (this.fireballs) {
      this.fireballs.children.iterate((fb) => {
        if (!fb?.body) return;
        const dvd = fb.getData && fb.getData('dvdSpeed');
        if (!dvd) return;

        const vx = fb.body.velocity.x, vy = fb.body.velocity.y;
        const len = Math.hypot(vx, vy);

        // Kickstart if ever near-zero
        if (len < 10) {
          const a = Math.random() * Math.PI * 2;
          fb.body.setVelocity(Math.cos(a) * dvd, Math.sin(a) * dvd);
          return;
        }

        // Tighten speed
        if (Math.abs(len - dvd) > 1) {
          fb.body.setVelocity((vx / len) * dvd, (vy / len) * dvd);
        }
      });

      // Clamp safeguard only if world exists
      const world = this.physics?.world || null;
      if (world) {
        const maxX = world.bounds.width;
        const maxY = world.bounds.height;

        this.fireballs.children.iterate((fb) => {
          if (!fb?.body) return;
          const dvd = fb.getData && fb.getData('dvdSpeed');

          if (fb.x < 0) { fb.x = 0; fb.body.setVelocityX(Math.abs(fb.body.velocity.x)); }
          if (fb.x > maxX) { fb.x = maxX; fb.body.setVelocityX(-Math.abs(fb.body.velocity.x)); }
          if (fb.y < 0) { fb.y = 0; fb.body.setVelocityY(Math.abs(fb.body.velocity.y)); }
          if (fb.y > maxY) { fb.y = maxY; fb.body.setVelocityY(-Math.abs(fb.body.velocity.y)); }

          if (dvd) {
            const vx = fb.body.velocity.x, vy = fb.body.velocity.y;
            const len = Math.max(0.0001, Math.hypot(vx, vy));
            if (Math.abs(len - dvd) > 1) {
              fb.body.setVelocity((vx / len) * dvd, (vy / len) * dvd);
            }
          }
        });
      }
    }
  }


  // ---------------------------
  // Build Platforms (6–7 tiers)
  // ---------------------------
  _buildPlatformTower() {
    // Y positions from bottom towards top (portrait)
    const tiers = Phaser.Utils.Array.Shuffle([1650, 1420, 1210, 995, 790, 590, 410]).slice(0, 7).sort((a, b) => a - b);
    const horizontalSpan = this.W * 0.65; // spread across screen
    const baseWidth = 280, baseHeight = 36;

    tiers.forEach((y, i) => {
      const x = 200 + Math.random() * (this.W - 400);
      const isMoving = (i % 3 === 1);           // some tiers move
      const isGhost = (i % 4 === 2);           // some tiers disappear/reappear

      const plt = this.add.sprite(x, y, 'platform');
      plt.setDisplaySize(baseWidth, baseHeight);
      plt.setDepth(1);
      this.physics.add.existing(plt, true); // static initially
      this.platforms.add(plt);

      if (isMoving) {
        // Convert to dynamic-ish via tween using yoyo X movement
        // We still keep it static body but update its position via refreshBody
        const range = 140 + Math.random() * 120;
        const leftX = Math.max(120, x - range);
        const rightX = Math.min(this.W - 120, x + range);
        this.tweens.add({
          targets: plt,
          x: { from: leftX, to: rightX },
          duration: 2400 + Math.random() * 1200,
          ease: 'Sine.inOut',
          yoyo: true,
          repeat: -1,
          onUpdate: () => plt.body && plt.body.updateFromGameObject && plt.body.updateFromGameObject(plt),
          onYoyo: () => plt.body && plt.body.updateFromGameObject && plt.body.updateFromGameObject(plt)
        });
        this.movingPlatforms.push(plt);
      }

      if (isGhost) {
        this.time.addEvent({
          delay: 1400 + Math.random() * 900,
          loop: true,
          callback: () => {
            plt.visible = !plt.visible;
            // For static bodies, toggle enabling by re-adding/removing from static group collisions
            plt.body.checkCollision.none = !plt.visible;
            // Important for Arcade Static: refresh body when position/visible toggles
            if (plt.body && plt.body.updateFromGameObject) plt.body.updateFromGameObject(plt);
          }
        });
        this.disappearingPlatforms.push(plt);
      }
    });

    // Ground safety ledge at the bottom
    const ground = this.add.sprite(this.W * 0.5, this.H - 30, 'platform');
    ground.setDisplaySize(this.W, 60);
    this.physics.add.existing(ground, true);
    this.platforms.add(ground);
  }

  // ---------------------------
  // Fireballs
  // ---------------------------

  _spawnFireball() {
    if (this.state.finished) return;
    if (this.state.fireballSpawned >= this.state.maxFireballs) return;

    // Keep a safe margin from edges using the real world size
    const margin = 120;
    const x = margin + Math.random() * (this.W - margin * 2);
    const y = margin + Math.random() * (this.H - margin * 2);

    const fb = this.physics.add.sprite(x, y, 'fireball');
    fb.setDisplaySize(48, 48);
    fb.setDepth(2);

    // IMPORTANT: body matches visuals & is centered
    fb.body.setSize(48, 48, true);

    // World-bound bounce & event
    fb.setCollideWorldBounds(true);
    fb.body.onWorldBounds = true;

    fb.body.allowGravity = false;
    fb.body.useDamping = false;
    fb.setBounce(1, 1); // harmless; we still do manual reflection

    // Fixed-speed "DVD" motion
    const dvdSpeed = 280 + Math.random() * 140;
    const angle = Math.random() * Math.PI * 2;
    fb.body.setVelocity(Math.cos(angle) * dvdSpeed, Math.sin(angle) * dvdSpeed);

    fb.setData('isDVD', true);
    fb.setData('dvdSpeed', dvdSpeed);

    this.fireballs.add(fb);
    this.state.fireballSpawned++;
  }

  _getMainCam() {
    return (this.sys?.cameras?.main) || (this.cameras?.main) || null;
  }



  _onHitByFireball(player, fb) {
    const now = this.time.now;
    if (now < this.state.invulnUntil || this.state.finished) return;

    // Damage
    this.state.health = Math.max(0, this.state.health - 1);
    this._updateHearts();

    // Camera shake (plugin-safe)
    const cam = this._getMainCam();
    if (cam) cam.shake(120, 0.004);

    // Hit feedback
    player.setTintFill(0xffaaaa);
    this.time.delayedCall(120, () => player.clearTint());
    if (this.sfx.hit) this.sfx.hit.play({ volume: 0.9 });

    // brief invulnerability
    this.state.invulnUntil = now + 800;

    if (this.state.health <= 0) this._triggerLose('health');
  }


  _onReachExit() {
    if (this.state.finished) return;

    // Require the player to actually reach above the exit's lip
    if (this.player.y < this.exitDoor.y + 80) {
      // Optional compatibility event for analytics/hooks
      this.events.emit('levelComplete', { timeLeft: this.state.timeLeft, health: this.state.health });

      // Finish gameplay systems (pause physics, stop timers/audio)
      this._finishScene();

      // SFX
      // SFX
      if (this.sfx.levelComplete) this.sfx.levelComplete.play({ volume: 1.0 });

      // 🚀 Replace current scene atomically with WinScene
      this.scene.start('WinScene', {
        timeLeft: this.state.timeLeft,
        health: this.state.health,
        score: this.state.timeLeft
      });


    }
  }


  _tick() {
    if (this.state.finished) return;

    this.state.timeLeft = Math.max(0, this.state.timeLeft - 1);
    if (this.ui.timerText) this.ui.timerText.setText(this._formatTime(this.state.timeLeft));

    if (this.state.timeLeft <= 0) {
      this._triggerLose('time');
    }
  }

  _triggerLose(reason) {
    if (this.state.finished) return;

    // Optional compatibility event for analytics/hooks
    this.events.emit('gameOver', { reason });

    // Finish gameplay systems
    this._finishScene();

    // SFX
    // SFX
    if (this.sfx.gameOver) this.sfx.gameOver.play({ volume: 1.0 });

    // 🚀 Replace current scene atomically with GameOverScene
    this.scene.start('GameOverScene', {
      reason,
      timeLeft: this.state.timeLeft,
      health: this.state.health,
      score: 0
    });


  }

_finishScene() {
  this.state.finished = true;

  // Stop accepting physics interactions ASAP
  if (this.physics?.world) this.physics.world.pause();

  // Remove colliders BEFORE clearing or destroying bodies/groups
  this._destroyColliders();

  // Timers & audio
  this._cancelTimers();
  if (this.sfx?.bgm) this.sfx.bgm.stop();

  // Detach our worldbounds listener
  const world = this.physics?.world;
  if (world?.removeAllListeners) world.removeAllListeners('worldbounds');
}



  _cancelTimers() {
    if (this.ticker) {
      this.ticker.remove(false);
      this.ticker = null;
    }
    if (this.fireballSpawner) {
      this.fireballSpawner.remove(false);
      this.fireballSpawner = null;
    }
  }



  // ---------------------------
  // UI: Hearts & Timer
  // ---------------------------
  _drawHearts() {
    // clear
    this.ui.hearts.forEach(h => h.destroy());
    this.ui.hearts = [];

    const startX = 36, startY = 36, spacing = 42;
    for (let i = 0; i < 3; i++) {
      const heart = this.add.image(startX + i * spacing, startY, 'heart').setOrigin(0, 0);
      heart.setDisplaySize(32, 32);
      this.ui.hearts.push(heart);
    }
    this._updateHearts();
  }

  _updateHearts() {
    for (let i = 0; i < this.ui.hearts.length; i++) {
      const heart = this.ui.hearts[i];
      heart.setAlpha(i < this.state.health ? 1 : 0.25);
    }
  }

  _formatTime(sec) {
    const m = Math.floor(sec / 60), s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // ---------------------------
  // Mobile Buttons
  // ---------------------------
  _setupMobileButtons() {
    const im = this.cfg.images || {};
    // Positions per standard
    const leftX = 160, rightX = 490, bottomY = this.H - 100, actionX = this.W - 160;

    const mkBtn = (key, x, y, onDown, onUp) => {
      const b = this.add.image(x, y, key).setInteractive({ useHandCursor: true });
      b.setDisplaySize(128, 128);
      b.setScrollFactor(0).setDepth(1000);
      b.on('pointerdown', () => { b.setScale(0.95); b.setAlpha(0.8); onDown(); });
      b.on('pointerup', () => { b.setScale(1.0); b.setAlpha(1.0); onUp(); });
      b.on('pointerout', () => { b.setScale(1.0); b.setAlpha(1.0); onUp(); });
      return b;
    };

    this.ui.mobile.left = mkBtn('leftBtn', leftX, bottomY,
      () => { this.ui.mobileState.left = true; },
      () => { this.ui.mobileState.left = false; }
    );

    this.ui.mobile.right = mkBtn('rightBtn', rightX, bottomY,
      () => { this.ui.mobileState.right = true; },
      () => { this.ui.mobileState.right = false; }
    );

    this.ui.mobile.action = mkBtn('actionBtn', actionX, bottomY,
      () => { this.ui.mobileState.action = true; },
      () => { this.ui.mobileState.action = false; }
    );
  }

  // ---------------------------
  // Audio
  // ---------------------------
  _initAudio() {
    const au = this.cfg.audio || {};
    if (this.sound) {
      if (this.cache.audio.exists('bgm')) { this.sfx.bgm = this.sound.add('bgm', { loop: true, volume: 0.5 }); this.sfx.bgm.play(); }
      if (this.cache.audio.exists('jump')) this.sfx.jump = this.sound.add('jump');
      if (this.cache.audio.exists('hit')) this.sfx.hit = this.sound.add('hit');
      if (this.cache.audio.exists('collision')) this.sfx.collide = this.sound.add('collision');
      if (this.cache.audio.exists('gameOver')) this.sfx.gameOver = this.sound.add('gameOver');
      if (this.cache.audio.exists('levelComplete')) this.sfx.levelComplete = this.sound.add('levelComplete');
    }
  }

  // ---------------------------
  // Fallback textures
  // ---------------------------
  _ensureFallbackTexture(key, color = 0xffffff, w = 96, h = 96, label = null) {
    if (this.textures.exists(key)) return;
    const rtKey = `__rt_${key}`;
    const g = this.add.graphics();
    g.fillStyle(color, 1);
    g.fillRoundedRect(0, 0, w, h, 12);
    if (label) {
      const txt = this.add.text(w / 2, h / 2, label, { fontSize: '24px', color: '#000', fontFamily: 'Arial', fontStyle: 'bold' }).setOrigin(0.5);
      const rt = this.make.renderTexture({ width: w, height: h, add: false }, false);
      rt.draw(g, 0, 0);
      rt.draw(txt, 0, 0);
      rt.saveTexture(rtKey);
      g.destroy(); txt.destroy(); rt.destroy();
    } else {
      const rt = this.make.renderTexture({ width: w, height: h, add: false }, false);
      rt.draw(g, 0, 0);
      rt.saveTexture(rtKey);
      g.destroy(); rt.destroy();
    }
    this.textures.renameTexture(rtKey, key);
  }

  // ---------------------------
  // Cleanup
  // ---------------------------
_onShutdown() {
  if (this._isShuttingDown) return;
  this._isShuttingDown = true;

  // Halt physics first
  if (this.physics?.world) this.physics.world.pause();

  // Kill colliders BEFORE clearing groups/objects
  this._destroyColliders();

  // Stop timers
  if (this.ticker) { this.ticker.remove(false); this.ticker = null; }
  if (this.fireballSpawner) { this.fireballSpawner.remove(false); this.fireballSpawner = null; }

  // Stop/destroy audio
  if (this.sfx?.bgm) { try { this.sfx.bgm.stop(); } catch(e){} this.sfx.bgm.destroy(); this.sfx.bgm = null; }

  // Remove only our worldbounds listener
  const world = this.physics?.world;
  if (world?.removeAllListeners) world.removeAllListeners('worldbounds');

  // Now it’s safe to clear groups
  if (this.fireballs) { this.fireballs.clear(true, true); this.fireballs = null; }
  if (this.platforms) { this.platforms.clear(true, true); this.platforms = null; }

  // Null refs
  this.movingPlatforms.length = 0;
  this.disappearingPlatforms.length = 0;
  this.player = null;
  this.exitDoor = null;

  // Don't nuke scene event bus
  this.ready = false;
}

}


