export default class CatchMeIfYouCan extends Phaser.Scene {
  constructor() {
    super({ key: "CatchMeIfYouCan", physics: { arcade: { gravity: { y: 0 } } } });

    // autobind instance methods
    Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach(fn => {
      if (typeof this[fn] === 'function') this[fn] = this[fn].bind(this);
    });

    this.gameStarted = false;
    this.overlays = {};
    this._alive = false

    // Joystick state
    this.joystickBase = null;
    this.joystickThumb = null;
    this.joystickPointerId = null;
    this.joystickData = { dx: 0, dy: 0, active: false };

    // Background ref
    this._bg = null;

    // Store input handlers so we can remove them on shutdown
    this._onPointerDown = null;
    this._onPointerUp = null;
    this._onPointerMove = null;

    // Keep references to timers/tweens we create, to clean up
    this.obstacleTimer = null;
    this.enemyMoveTimer = null;
    this._overlayTween = null;

    // sfx
    this.sfx = { hit: null };
    this.hitParticles = null;

    this._looseTimers = [];

  }

  init() {
    this.gameStarted = false;
    this.overlays = {};
    this._alive = false;          // not alive until create()
    if (this.input) this.removeJoystickListeners();
  }

  // True when the scene is running (safe to touch cameras/physics/etc.)
  isAlive() { return this._alive === true; }

  notifyParent(type, data) {
    if (window.parent !== window) {
      window.parent.postMessage({ type, ...data }, "*");
    }
  }
  preload() {

    if (!CatchMeIfYouCan.staticConfigData) {
      const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));
      this.load.json('levelConfig', `${basePath}/config.json`);
      this.load.once('filecomplete-json-levelConfig', () => {
        const config = this.cache.json.get('levelConfig');
        CatchMeIfYouCan.staticConfigData = config;
        this.settings = config.settings || {};
        this.loadAssetsFromConfig(config);
        this.load.start();   // ✅ first load
      });
    } else {
      this.loadAssetsFromConfig(CatchMeIfYouCan.staticConfigData);
      this.load.start();     // ✅ restart load
    }
  }


  loadAssetsFromConfig(config) {
    const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));

    const images = config.images1 || {};
    const images2 = config.images2 || {};
    const ui = config.ui || {};

    // 🔁 Use this.textures instead of this.sys.textures
    for (const key in images) {
      if (!this.textures.exists(key)) this.load.image(key, `${basePath}/${images[key]}`);
    }
    for (const key in images2) {
      if (!this.textures.exists(key)) this.load.image(key, `${basePath}/${images2[key]}`);
    }
    for (const key in ui) {
      if (!this.textures.exists(key)) this.load.image(key, `${basePath}/${ui[key]}`);
    }

    if (!this.textures.exists('player')) {
      this.load.image('player', `${basePath}/player.png`);
    }

    const audio = config.audio || {};

    // Audio – support both local paths and full URLs
    for (const key in audio) {
      if (this.cache.audio.exists(key)) continue;

      const rawUrl = audio[key];
      const audioUrl =
        /^https?:\/\//i.test(rawUrl) || rawUrl.startsWith('//')
          ? rawUrl                   // full URL -> use as-is
          : `${basePath}/${rawUrl}`; // relative -> prefix with basePath

      this.load.audio(key, audioUrl).on('error', () => {
        console.error(`Failed to load audio: ${key} from ${audioUrl}`);
      });
    }

    // Ensure hit sfx fallback (same URL logic)
    if (!this.cache.audio.exists('hit') && audio.hit !== undefined) {
      const rawHit = audio.hit;
      const hitUrl =
        /^https?:\/\//i.test(rawHit) || rawHit.startsWith('//')
          ? rawHit
          : `${basePath}/${rawHit}`;

      this.load.audio('hit', hitUrl).on('error', () => {
        console.error(`Failed to load fallback hit sfx from ${hitUrl}`);
      });
    }

  }

  create() {
    this._alive = true;
    // Resume physics if we paused it in a previous run
    if (this.physics && this.physics.world && this.physics.world.isPaused) {
      this.physics.world.resume();
    }

    this.configData = CatchMeIfYouCan.staticConfigData;
    if (!this.configData) { this.scene.restart(); return; }

    const { settings, audio } = this.configData;

    // BGM – only start if actually loaded
    let bgmKey = null;
    if (this.cache.audio.exists('bg_music')) {
      bgmKey = 'bg_music';
    } else if (this.cache.audio.exists('bgm')) {
      bgmKey = 'bgm';
    }

    if (bgmKey) {
      this.bgMusic = this.sound.add(bgmKey, { loop: true, volume: 0.5 });
      this.bgMusic.play();
    } else {
      console.warn('No bgm audio (bg_music/bgm) found in cache; skipping background music.');
      this.bgMusic = null;
    }


    // SFX
    if (this.cache.audio.exists('hit')) {
      this.sfx.hit = this.sound.add('hit', { volume: 0.9 });
    }

    this.playerSpeed = (settings && settings.playerSpeed) || 300;
    this.enemySpeed = (settings && settings.enemySpeed) || 220;
    this.obstacleSpeed = (settings && settings.obstacleSpeed) || 320;
    this.maxHits = (settings && settings.maxHits) || 5;

    this.obstacleSpawnDelay = (settings && (settings.obstacleSpawnDelay ?? settings.spawnDelay)) || 1600;

    // PLAYER
    const centerX = this.scale.width / 2;                // 🔁 this.scale
    this.player = this.physics.add.image(centerX, this.scale.height * 0.85, 'player'); // 🔁 this.scale
    this.player.setCollideWorldBounds(true);
    this.player.body.setAllowGravity(false);
    this.player.setDepth(5);
    this.player.setVisible(false);

    // ENEMY
    this.enemy = this.physics.add.image(centerX, this.scale.height * 0.25, 'enemy');   // 🔁 this.scale
    this.enemy.setDisplaySize(160, 160);
    this.enemy.setCollideWorldBounds(true);
    this.enemy.setBounce(1);
    this.enemy.setMaxVelocity(360, 360);
    this.enemy.body.setAllowGravity(false);
    this.enemy.setDepth(5);
    this.enemy.setVisible(false);

    this.obstacles = this.add.group();

    this.bar = this.add.image(540, 70, 'scorebar').setDepth(101);
    this.bar.setVisible(false);

    this.hitCount = 0;
    this.hitText = this.add.text(420, 30, `Hit: 0/${this.maxHits}`, {
      font: '58px outfit',
      fill: '#000'
    }).setDepth(102);
    this.hitText.setVisible(false);

    this.cursors = this.input.keyboard.createCursorKeys();

    // --- impact particle texture (runtime generated) ---
    if (!this.textures.exists('hit_part')) {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      g.fillStyle(0xffffff, 1);
      g.fillCircle(4, 4, 4);
      g.generateTexture('hit_part', 8, 8);
      g.destroy();
    }

    // Particle manager & emitter (keep one, reuse on every hit)
    this.hitParticles = this.add.particles(0, 0, 'hit_part', {
      lifespan: { min: 200, max: 450 },
      speed: { min: 120, max: 260 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.9, end: 0.2 },
      alpha: { start: 1, end: 0 },
      gravityY: 600,
      quantity: 0,
      blendMode: 'ADD'
    });
    this.hitParticles.setDepth(110);

    this.playerEnemyCollider = this.physics.add.collider(this.player, this.enemy, this.onWin, null, this);
    this.playerObstaclesCollider = this.physics.add.collider(this.player, this.obstacles, this.hitObstacle, null, this);
    this.playerEnemyCollider.active = false;
    this.playerObstaclesCollider.active = false;

    // Joystick
    this.createJoystick();

    // Start with HTP overlay & HTP background
    this.setBackground('htpbg', 'background');
    this.showHTPOverlay();

    // Clean-up guards on restart/destroy
    this.events.once('shutdown', this.onShutdown, this);
  }


  // ---------- Background helper ----------
  setBackground(key, fallbackKey = null) {
    const texMgr = this.textures;
    const chosen = texMgr.exists(key) ? key : (fallbackKey && texMgr.exists(fallbackKey) ? fallbackKey : null);

    const w = this.scale.width;
    const h = this.scale.height;

    // If nothing available, destroy any existing bg and exit
    if (!chosen) {
      if (this._bg) { this._bg.destroy(); this._bg = null; }
      return;
    }

    // If we have an _bg but it was removed from the display list (or belongs to another scene),
    // recreate it. Also recreate it if it's using a different texture than `chosen`.
    const needsCreate = (
      !this._bg ||
      !this._bg.scene ||                 // removed from scene
      (this._bg.texture && this._bg.texture.key !== chosen)
    );

    if (needsCreate) {
      if (this._bg) { try { this._bg.destroy(); } catch (_) { } }
      this._bg = this.add.image(w / 2, h / 2, chosen).setDepth(0);
    } else {
      // ensure it's on correct position / depth if it still exists
      this._bg.setDepth(0);
      this._bg.setPosition(w / 2, h / 2);
    }

    this._bg.setDisplaySize(w, h);
  }



  // --- JOYSTICK IMPLEMENTATION ---
  createJoystick() {
    const w = this.scale.width;   // 🔁 this.scale
    const h = this.scale.height;
    const baseRadius = 120;
    const joyX = w / 2;
    const joyY = h - 180;

    if (this.joystickBase) this.joystickBase.destroy();
    if (this.joystickThumb) this.joystickThumb.destroy();

    this.joystickBase = this.add.image(joyX, joyY, 'joystick_base')
      .setDepth(101).setVisible(false).setAlpha(0.7);
    this.joystickThumb = this.add.image(joyX, joyY, 'joystick_thumb')
      .setDepth(102).setVisible(false).setAlpha(0.9);

    // Create *named* handlers so we can remove them later
    this._onPointerDown = (pointer) => {
      if (!this.isAlive()) return;
      if (!this.gameStarted || this.joystickPointerId !== null) return;
      if (Phaser.Math.Distance.Between(pointer.x, pointer.y, joyX, joyY) < baseRadius) {
        this.joystickPointerId = pointer.id;
        this.joystickData.active = true;
        this.updateJoystick(pointer.x, pointer.y);
      }
    };

    this._onPointerUp = (pointer) => {
      if (!this.isAlive()) return;
      if (pointer.id === this.joystickPointerId) {
        this.resetJoystick();
      }
    };

    this._onPointerMove = (pointer) => {
      if (!this.isAlive()) return;
      if (this.joystickPointerId === pointer.id && this.joystickData.active) {
        this.updateJoystick(pointer.x, pointer.y);
      }
    };

    // Attach
    this.input.on('pointerdown', this._onPointerDown);
    this.input.on('pointerup', this._onPointerUp);
    this.input.on('pointermove', this._onPointerMove);
  }

  removeJoystickListeners() {
    if (!this.input) return;
    if (this._onPointerDown) this.input.off('pointerdown', this._onPointerDown);
    if (this._onPointerUp) this.input.off('pointerup', this._onPointerUp);
    if (this._onPointerMove) this.input.off('pointermove', this._onPointerMove);
    this._onPointerDown = this._onPointerUp = this._onPointerMove = null;
  }

  showJoystick(show = true) {
    if (this.joystickBase) this.joystickBase.setVisible(show);
    if (this.joystickThumb) this.joystickThumb.setVisible(show);
    if (!show) this.resetJoystick();
  }

  updateJoystick(px, py) {
    if (!this.joystickBase || !this.joystickThumb) return;
    const joyX = this.joystickBase.x;
    const joyY = this.joystickBase.y;
    const dx = px - joyX;
    const dy = py - joyY;
    const dist = Math.min(Math.sqrt(dx * dx + dy * dy), 90);
    const angle = Math.atan2(dy, dx);
    const thumbX = joyX + Math.cos(angle) * dist;
    const thumbY = joyY + Math.sin(angle) * dist;

    this.joystickThumb.setPosition(thumbX, thumbY);
    this.joystickData.dx = Math.cos(angle) * (dist / 90);
    this.joystickData.dy = Math.sin(angle) * (dist / 90);
    this.joystickData.active = true;
  }

  resetJoystick() {
    if (!this.joystickBase || !this.joystickThumb) return;
    this.joystickThumb.setPosition(this.joystickBase.x, this.joystickBase.y);
    this.joystickData.dx = 0;
    this.joystickData.dy = 0;
    this.joystickData.active = false;
    this.joystickPointerId = null;
  }

  // --- OVERLAY FUNCTIONS ---
  showHTPOverlay() {
    const cx = this.scale.width / 2;   // 🔁 this.scale
    const cy = this.scale.height / 2;
    const overlays = this.overlays;

    // Ensure HTP background (fallback to gameplay background if missing).
    this.setBackground('htpbg', 'background');

    overlays.htpbox = this.add.image(cx, cy, 'htpbox').setScale(0.55, 0.8).setDepth(100);
    overlays.htpbox1 = this.add.image(cx - 100, cy + 140, 'enemy').setScale(1).setDepth(100);
    overlays.htpbox2 = this.add.image(cx - 100, cy - 70, 'player').setScale(0.7).setDepth(100);
    overlays.htpbox3 = this.add.image(cx + 280, cy - 70, 'obstacle').setScale(1).setDepth(100);
    overlays.htptext1 = this.add.text(340, 660, "How to Play", {
      font: '70px outfit', fill: 'white', align: 'left', wordWrap: { width: 700 }
    }).setDepth(101)
    overlays.htptext = this.add.text(cx - 300, cy + 140, 'Catch:', {
      font: '50px outfit', fill: 'white', align: 'left', wordWrap: { width: 700 }
    }).setOrigin(0.5).setDepth(101);
    overlays.htptext3 = this.add.text(cx + 100, cy - 80, 'Avoid:', {
      font: '50px outfit', fill: 'white', align: 'left', wordWrap: { width: 700 }
    }).setOrigin(0.5).setDepth(101);

    overlays.htptext2 = this.add.text(cx - 300, cy - 80, 'Control:', {
      font: '50px outfit', fill: 'white', align: 'left', wordWrap: { width: 700 }
    }).setOrigin(0.5).setDepth(101);

    overlays.playbtn = this.add.image(cx, cy + 500, 'playbtn')
      .setDepth(101).setInteractive({ useHandCursor: true });
    overlays.playbtn.on('pointerdown', this.startGame);

    this._overlayTween = this.tweens.add({
      targets: overlays.playbtn,
      scale: { from: 1, to: 1 },
      yoyo: true, repeat: -1, duration: 700
    });

    this.showJoystick(false);
  }

  hideHTPOverlay() {
    if (this._overlayTween) { this._overlayTween.stop(); this._overlayTween = null; }
    Object.values(this.overlays).forEach(obj => obj && obj.destroy());
    this.overlays = {};
  }

  showWinOverlay() {
    const cx = this.scale.width / 2;   // 🔁 this.scale
    const cy = this.scale.height / 2;
    const overlays = this.overlays;

    this.setBackground('winbg', 'background');

    overlays.lvlbox = this.add.image(cx, cy, 'lvlbox').setScale(.55, 0.6).setDepth(100);
    overlays.winText = this.add.text(cx, cy, 'Level Completed', {
      font: '50px outfit', fill: '#ffffffff', fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(101);

    overlays.next = this.add.image(cx + 230, cy + 350, 'next')
      .setDepth(101).setInteractive({ useHandCursor: true });
    overlays.next.on('pointerdown', () => this.notifyParent('sceneComplete', { result: 'win' }));

    overlays.lvl_replay = this.add.image(cx - 230, cy + 350, 'lvl_replay')
      .setDepth(101).setInteractive({ useHandCursor: true });
    overlays.lvl_replay.on('pointerdown', () => {
      overlays.lvl_replay.disableInteractive();
      this.time.delayedCall(0, () => this.scene.restart());
    });

    this.showJoystick(false);
  }

  showGameOverOverlay() {
    const cx = this.scale.width / 2;   // 🔁 this.scale
    const cy = this.scale.height / 2;
    const overlays = this.overlays;

    this.setBackground('ovrbg', 'background');

    overlays.ovrbox = this.add.image(cx, cy, 'ovrbox').setScale(0.55, 0.7).setDepth(100);
    overlays.gameOverText = this.add.text(cx, cy - 200, 'Game Over', {
      font: '70px outfit', fill: '#ffffff',
    }).setOrigin(0.5).setDepth(101);

    overlays.gameOverText1 = this.add.text(cx, cy, 'Try Again', {
      font: '50px outfit', fill: '#ffffff',
    }).setOrigin(0.5).setDepth(101);

    overlays.replay = this.add.image(cx, cy + 400, 'replay')
      .setDepth(101).setInteractive({ useHandCursor: true });
    overlays.replay.on('pointerdown', () => {
      overlays.replay.disableInteractive();

      // Stop all timers/tweens before restarting
      if (this.obstacleTimer) { this.obstacleTimer.remove(); this.obstacleTimer = null; }
      if (this.enemyMoveTimer) { this.enemyMoveTimer.remove(); this.enemyMoveTimer = null; }
      if (this._overlayTween) { this._overlayTween.stop(); this._overlayTween = null; }

      // Restart scene safely on next frame
      this.scene.stop(this.scene.key);
      this.scene.start(this.scene.key);
    });


    this.showJoystick(false);
  }

  // --- GAME STATE LOGIC ---
  startGame = () => {
    this.hideHTPOverlay();

    // Use gameplay background during play
    this.setBackground('background', 'background');

    // Make sure player/enemy are visible & above background
    const centerX = this.scale.width / 2;                 // 🔁 this.scale
    this.player.setPosition(centerX, this.scale.height * 0.85);
    this.player.setVisible(true).setDepth(5);
    this.enemy.setVisible(true).setDepth(5);

    this.hitText.setVisible(true);
    this.bar.setVisible(true);
    this.hitCount = 0;
    this.hitText.setText(`Hit: 0/${this.maxHits}`);

    // fully clear old obstacles
    if (this.obstacles) {
      this.obstacles.getChildren().forEach(o => o && o.destroy());
      this.obstacles.clear(false, true);
    }

    this.gameStarted = true;
    this.startEnemyMoveTimer();

    this.obstacleTimer = this.time.addEvent({
      delay: this.obstacleSpawnDelay,
      callback: this.throwObstacle,
      callbackScope: this,
      loop: true
    });

    this.playerEnemyCollider.active = true;
    this.playerObstaclesCollider.active = true;

    this.showJoystick(true);
  };

  onWin = () => {
    this.stopGame();
    this.showWinOverlay();
  };

  // --- SMART ENEMY MOVEMENT ---
  startEnemyMoveTimer() {
    if (this.enemyMoveTimer) this.enemyMoveTimer.remove();
    this.enemyMoveTimer = this.time.addEvent({
      delay: 300,
      loop: true,
      callback: () => {
        if (!this.isAlive() || !this.gameStarted || !this.physics || !this.physics.world || !this.enemy || !this.player) return;

        this.setEnemyFleeVelocity();
      }
    });
  }

  setEnemyFleeVelocity() {
    const margin = 40;
    const w = this.scale.width, h = this.scale.height;    // 🔁 this.scale
    let x = this.enemy.x, y = this.enemy.y;

    if (x < margin || x > w - margin || y < margin || y > h - margin) {
      let angle = this.getSafeAngle(x, y, w, h);
      this.enemy.body.setVelocity(Math.cos(angle) * this.enemySpeed, Math.sin(angle) * this.enemySpeed);
      return;
    }

    const dx = this.enemy.x - this.player.x;
    const dy = this.enemy.y - this.player.y;
    let angle = Math.atan2(dy, dx);
    angle += Phaser.Math.FloatBetween(-Math.PI / 4, Math.PI / 4);
    this.enemy.body.setVelocity(Math.cos(angle) * this.enemySpeed, Math.sin(angle) * this.enemySpeed);
  }

  getSafeAngle(x, y, w, h) {
    if (x < 40 && y < 40) return Phaser.Math.FloatBetween(Math.PI / 6, Math.PI / 2);
    if (x > w - 40 && y < 40) return Phaser.Math.FloatBetween(Math.PI / 2, (5 * Math.PI) / 6);
    if (x < 40 && y > h - 40) return Phaser.Math.FloatBetween(-Math.PI / 2, -Math.PI / 6);
    if (x > w - 40 && y > h - 40) return Phaser.Math.FloatBetween(-5 * Math.PI / 6, -Math.PI / 2);
    if (x < 40) return Phaser.Math.FloatBetween(-Math.PI / 3, Math.PI / 3);
    if (x > w - 40) return Phaser.Math.FloatBetween(2 * Math.PI / 3, 4 * Math.PI / 3);
    if (y < 40) return Phaser.Math.FloatBetween(Math.PI / 6, (5 * Math.PI) / 6);
    if (y > h - 40) return Phaser.Math.FloatBetween(-5 * Math.PI / 6, -Math.PI / 6);
    return Phaser.Math.FloatBetween(-Math.PI, Math.PI);
  }

  update() {
    if (!this.isAlive() || !this.gameStarted || !this.player || !this.player.body) return;


    let vx = 0, vy = 0;

    // Keyboard
    if (this.cursors.left.isDown) vx -= 1;
    if (this.cursors.right.isDown) vx += 1;
    if (this.cursors.up.isDown) vy -= 1;
    if (this.cursors.down.isDown) vy += 1;

    // Joystick
    if (this.joystickData.active && (this.joystickData.dx !== 0 || this.joystickData.dy !== 0)) {
      vx = this.joystickData.dx;
      vy = this.joystickData.dy;
    }

    if (vx !== 0 || vy !== 0) {
      const len = Math.sqrt(vx * vx + vy * vy) || 1;
      vx /= len; vy /= len;
      this.player.body.setVelocity(vx * this.playerSpeed, vy * this.playerSpeed);
    } else {
      this.player.body.setVelocity(0);
    }
  }

  throwObstacle() {
    if (!this.isAlive() || !this.gameStarted || !this.enemy || !this.player) return;

    const x = this.enemy.x;
    const y = this.enemy.y;

    const obstacle = this.physics.add.image(x, y, 'obstacle');
    obstacle.setDisplaySize(80, 80);
    obstacle.setCollideWorldBounds(true);
    obstacle.setBounce(1);
    obstacle.body.setAllowGravity(false);

    const dx = this.player.x - x;
    const dy = this.player.y - y;
    const angle = Math.atan2(dy, dx);

    obstacle.body.setVelocity(Math.cos(angle) * this.obstacleSpeed, Math.sin(angle) * this.obstacleSpeed);
    this.obstacles.add(obstacle);

    const ev = this.time.delayedCall(10000, () => {
      // Extra guard in case we’re already down
      if (!this.isAlive() || !obstacle || !obstacle.scene) return;
      obstacle.destroy();
    });
    this._looseTimers.push(ev);
  }

  cleanupEntities() {
    // kill any pending delayedCalls created per obstacle
    if (this._looseTimers && this._looseTimers.length) {
      for (const ev of this._looseTimers) { try { ev.remove(false); } catch (_) { } }
      this._looseTimers.length = 0;
    }
    // remove colliders safely
    if (this.physics && this.physics.world) {
      if (this.playerEnemyCollider) {
        try { this.physics.world.removeCollider(this.playerEnemyCollider); } catch (e) { }
        this.playerEnemyCollider = null;
      }
      if (this.playerObstaclesCollider) {
        try { this.physics.world.removeCollider(this.playerObstaclesCollider); } catch (e) { }
        this.playerObstaclesCollider = null;
      }
    } else {
      this.playerEnemyCollider = null;
      this.playerObstaclesCollider = null;
    }

    // destroy obstacles
    if (this.obstacles) {
      try {
        this.obstacles.getChildren().forEach(o => o && o.destroy());
        this.obstacles.clear(false, true);
      } catch (e) { }
    }

    // destroy sprites
    if (this.player) { try { this.player.destroy(); } catch (e) { } this.player = null; }
    if (this.enemy) { try { this.enemy.destroy(); } catch (e) { } this.enemy = null; }

    // hide HUD
    if (this.hitText) this.hitText.setVisible(false);
    if (this.bar) this.bar.setVisible(false);
  }

  hitObstacle(player, obstacle) {
    if (this.sfx.hit) this.sfx.hit.play();

    if (this.hitParticles) {
      this.hitParticles.emitParticleAt(obstacle.x, obstacle.y, 18);
    }

    if (this.cameras && this.cameras.main) {
      this.cameras.main.shake(120, 0.004);
      this.cameras.main.flash(100, 255, 255, 255);
    }

    const kx = player.x - obstacle.x;
    const ky = player.y - obstacle.y;
    const len = Math.max(1, Math.hypot(kx, ky));
    const kb = 280;
    if (player.body) {
      player.body.setVelocity((kx / len) * kb, (ky / len) * kb);
    }

    obstacle.destroy();
    player.setTint(0xff0000);
    this.time.delayedCall(120, () => player.clearTint());

    this.hitCount++;
    this.hitText.setText(`Hit: ${this.hitCount}/${this.maxHits}`);

    if (this.hitCount >= this.maxHits) {
      this.stopGame();
      this.showGameOverOverlay();
    }
  }

  stopGame() {
    if (!this.isAlive()) return;


    this.gameStarted = false;

    if (this.physics && this.physics.world) {
      this.physics.world.pause();
    }

    if (this.obstacleTimer) { this.obstacleTimer.remove(); this.obstacleTimer = null; }
    if (this.enemyMoveTimer) { this.enemyMoveTimer.remove(); this.enemyMoveTimer = null; }

    if (this.bgMusic && this.bgMusic.isPlaying) {
      this.bgMusic.stop();
    }

    if (this.playerEnemyCollider) this.playerEnemyCollider.active = false;
    if (this.playerObstaclesCollider) this.playerObstaclesCollider.active = false;

    this.showJoystick(false);

    this.cleanupEntities();
  }

  // Cleanup when the scene is shutting down or destroyed
  onShutdown() {
    this._alive = false;
    this.removeJoystickListeners();

    if (this._overlayTween) { this._overlayTween.stop(); this._overlayTween = null; }

    if (this.obstacleTimer) { this.obstacleTimer.remove(); this.obstacleTimer = null; }
    if (this.enemyMoveTimer) { this.enemyMoveTimer.remove(); this.enemyMoveTimer = null; }

    // cancel any straggler delayedCalls
    if (this._looseTimers && this._looseTimers.length) {
      for (const ev of this._looseTimers) { try { ev.remove(false); } catch (_) { } }
      this._looseTimers.length = 0;
    }


    this.hideHTPOverlay();


    if (this._bg) { try { this._bg.destroy(); } catch (e) { } this._bg = null; }

    if (this.hitParticles) { try { this.hitParticles.destroy(); } catch (e) { } this.hitParticles = null; }

    this.cleanupEntities();
    this.bgMusic = null;
    this.cursors = null;
  }
}
