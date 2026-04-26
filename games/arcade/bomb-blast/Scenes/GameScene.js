// Scenes/GameScene.js
// Gameplay-only scene for "Bomb Toss"
// - No menus/overlays/transitions UI here (other scenes handle that)
// - Uses config from this.registry.get('cfg')
// - Portrait 1080x1920 by default (but uses runtime size from this.sys.game.config)
// - Uses this.sys.* for cameras, tweens, and game.config access
// - Includes asset fallback system and proper sizing (setDisplaySize)

class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');

    // Cached config & dimensions
    this.cfg = null;
    this.W = 1080;
    this.H = 1920;

    // Lanes and positions
    this.laneXs = [];
    this.laneCount = 5;

    // inside constructor, near other fields
    this.fx = { slowMoOverlay: null };


    // Entities & state
    this.player = null;
    this.playerLane = 2;
    this.playerShield = false;

    this.bomb = null;
    this.bombState = 'player'; // 'player' | 'enemy' | 'air'
    this.bombFuse = 5; // seconds
    this.bombFuseLeft = 5;
    this.bombHolder = null; // null | player | enemy sprite
    this.enemyHoldingTimer = null;

    // Groups
    this.enemies = null;
    this.powerups = null;

    // Scoring/Timer
    this.score = 0;
    this.targetScore = 5000;
    this.timeLeft = 60;

    // Spawning
    this.spawnTimer = null;
    this.spawnRate = 1800; // ms
    this.spawnRateMin = 700;
    this.enemySpeedStart = 140;
    this.enemySpeedMax = 260;
    this.elapsedSec = 0;

    // Input
    this.cursors = null;
    this.keys = null;
    this.pointerStart = null;

    // UI (gameplay-only)
    this.ui = { scoreText: null, timerText: null, fuseBarBg: null, fuseBar: null };

    // Audio
    this.snd = { bgm: null, throw: null, explode: null, destroy: null, hit: null, collect: null, win: null, lose: null };

    // Mobile controls
    this.mobile = { left: null, right: null, action: null, isLeft: false, isRight: false, isAction: false };
  }

  // -------------------------------------------------------
  // Helper: Default config if none was injected (for safety)
  // -------------------------------------------------------
  _defaultCfg() {
    return {
      font: { family: 'Outfit', url: 'assets/outfit.ttf' },
      texts: {
        how_to_play:
          'Swipe left/right to toss the bomb to adjacent lanes. Make it explode near enemy clusters. Do not let it explode in your hands!',
        score_label: 'Points: ',
        win_title: 'Bomb Master!',
        game_over_title: 'Kaboom!'
      },
      gameplay: {
        orientation: 'portrait',
        lanes: 5,
        timerSeconds: 60,
        targetScore: 5000,
        gravityY: -900,
        playerSpeed: 500,
        bombFuseSeconds: 5,
        enemySpawnRate: 1800,
        enemySpawnRateMin: 700,
        enemySpeedStart: 140,
        enemySpeedMax: 260,
        explosionRadius: 170,
        enemyHoldMs: 1250,
        slowMoScale: 0.5,
        slowMoMs: 2500
      },
      images: {
        background: 'assets/images/background.png',
        bomb: 'assets/images/obj7.png',
        enemyA: 'assets/images/obj11.png',
        enemyB: 'assets/images/obj13.png',
        power_fuse: 'assets/images/obj20.png',
        power_slowmo: 'assets/images/obj18.png',
        power_shield: 'assets/images/obj22.png',
        collectible: 'assets/images/obj12.png',
        platform: 'assets/images/platform1.png',
        floor: 'assets/images/platform3.png',
        left: 'assets/images/left.png',
        right: 'assets/images/right.png',
        action: 'assets/images/action.png',
        // Mandatory UI assets (used by other scenes)
        htpbox: 'assets/images/htpbox.png',
        ovrbox: 'assets/images/ovrbox.png',
        replay: 'assets/images/replay.png',
        lvl_replay: 'assets/images/lvl_replay.png',
        lvlbox: 'assets/images/lvlbox.png'
      },
      spritesheets: {},
      audio: {
        bgm: 'assets/audio/Game_Background.mp3',
        throw: 'assets/audio/Attack.mp3',
        explode: 'assets/audio/Explosion.mp3',
        destroy: 'assets/audio/Destroy.mp3',
        hit: 'assets/audio/Taking_a_Hit.mp3',
        collect: 'assets/audio/Collection.mp3',
        win: 'assets/audio/Level_Complete.mp3',
        lose: 'assets/audio/Game_Over.mp3'
      }
    };
  }

  // -------------------------------------------------------
  // Preload: load assets if paths exist; fallbacks in create
  // -------------------------------------------------------
  preload() {
    // Read cfg now so we know what to load
    const injected = this.registry.get('cfg');
    this.cfg = injected && typeof injected === 'object' ? injected : this._defaultCfg();

    // Load images
    const imgs = this.cfg.images1 || {};
    const images2 = this.cfg.images2 || {};
    Object.keys(imgs).forEach((key) => {
      const url = imgs[key];
      if (typeof url === 'string' && url.length > 0) {
        try {
          this.load.image(key, url);
        } catch (e) {
          console.warn('[GameScene] Failed to queue image load for', key, url, e);
        }
      }
    });

    Object.keys(images2).forEach((key) => {
      const url = images2[key];
      if (typeof url === 'string' && url.length > 0) {
        try {
          this.load.image(key, url);
        } catch (e) {
          console.warn('[GameScene] Failed to queue image load for', key, url, e);
        }
      }
    });

    // Load audio
    const aus = this.cfg.audio || {};
    Object.keys(aus).forEach((key) => {
      const url = aus[key];
      if (typeof url === 'string' && url.length > 0) {
        try {
          this.load.audio(key, url);
        } catch (e) {
          console.warn('[GameScene] Failed to queue audio load for', key, url, e);
        }
      }
    });

    // Simple progress event (optional—no UI overlay)
    this.load.on('loaderror', (f) => console.warn('[GameScene] Load error:', f && f.src));
  }

  // -------------------------------------------------------
  // Create: build world, entities, collisions, UI, systems
  // -------------------------------------------------------
  create() {
    // Dimensions
    this.W = Number(this.sys.game.config.width) || 1080;
    this.H = Number(this.sys.game.config.height) || 1920;

    // World physics
    const gy = (this.cfg.gameplay && this.cfg.gameplay.gravityY) || 900;
    this.physics.world.setBounds(0, 0, this.W, this.H);
    this.physics.world.gravity.y = gy;

    // Lanes
    this.laneCount = (this.cfg.gameplay && this.cfg.gameplay.lanes) || 5;
    this.laneXs = this._computeLaneXs(this.laneCount, this.W);

    // Fallbacks (textures) for missing assets
    this._ensureFallbackTexture('bomb', 72, 72, 0xffe066);
    this._ensureFallbackTexture('enemyA', 90, 90, 0xff7675);
    this._ensureFallbackTexture('enemyB', 96, 96, 0xff5252);
    this._ensureFallbackTexture('power_fuse', 64, 64, 0x74b9ff);
    this._ensureFallbackTexture('power_slowmo', 64, 64, 0xa29bfe);
    this._ensureFallbackTexture('power_shield', 64, 64, 0x55efc4);
    this._ensureFallbackTexture('collectible', 56, 56, 0x81ecec);
    this._ensureFallbackTexture('platform', 200, 18, 0x95a5a6);
    this._ensureFallbackTexture('floor', this.W, 30, 0x7f8c8d);
    this._ensureFallbackTexture('left', 120, 120, 0x2ecc71);
    this._ensureFallbackTexture('right', 120, 120, 0x3498db);
    this._ensureFallbackTexture('action', 140, 140, 0xe67e22);

    // Background (optional)
    if (this.textures.exists('background')) {
      const bg = this.add.image(this.W / 2, this.H / 2, 'background');
      bg.setDisplaySize(this.W, this.H);
      bg.setDepth(-10);
    }

    // Floor (visual only)
    const floor = this.add.image(this.W / 2, this.H - 8, 'floor');
    floor.setDisplaySize(this.W, 16).setDepth(-1);

    // Lane accents
    for (let i = 0; i < this.laneCount; i++) {
      const y = this.H - 200; // horizontal accents near bottom
      const mark = this.add.image(this.laneXs[i], y, 'platform');
      mark.setDisplaySize(160, 12).setAlpha(0.3).setDepth(-1);
    }

    // Groups
    this.enemies = this.physics.add.group({ runChildUpdate: false });
    this.powerups = this.physics.add.group({ runChildUpdate: false });

    // Player
    this.playerLane = Math.floor(this.laneCount / 2);
    this.player = this.physics.add.image(this.laneXs[this.playerLane], this.H - 120, 'platform');
    this.player.setDisplaySize(160, 24).setImmovable(true).setDepth(2);
    this.player.body.allowGravity = false;

    // Bomb (starts with player)
    this.bombFuse = (this.cfg.gameplay && this.cfg.gameplay.bombFuseSeconds) || 5;
    this.bombFuseLeft = this.bombFuse;
    this.bomb = this.physics.add.image(this.player.x, this.player.y - 70, 'bomb');
    this.bomb.setDisplaySize(72, 72).setDepth(3);
    this._attachBombTo(this.player, 'player');

    // Colliders/overlaps
    this.physics.add.overlap(this.bomb, this.player, () => {
      if (this.bombState === 'air') this._catchBombByPlayer();
    });

    this.physics.add.overlap(this.bomb, this.enemies, (bomb, enemy) => {
      if (this.bombState === 'air') this._catchBombByEnemy(enemy);
    });

    this.physics.add.overlap(this.player, this.powerups, (player, pu) => this._collectPowerup(pu));

    // Inputs
    this._setupInput();

    // UI (score/timer/fuse)
    const style = { fontFamily: (this.cfg.font && this.cfg.font.family) || 'Outfit', fontSize: '42px', color: '#EAF2FF' };
    const label = (this.cfg.texts && this.cfg.texts.score_label) || 'Points: ';
    this.ui.scoreText = this.add.text(24, 24, `${label}0`, style).setDepth(5);
    this.ui.timerText = this.add.text(this.W - 24, 24, this._fmtTime(this.timeLeft), style).setOrigin(1, 0).setDepth(5);

    // Fuse bar
    this.ui.fuseBarBg = this.add.rectangle(this.W / 2, 110, 420, 18, 0x2b2f3a, 0.9).setDepth(5);
    this.ui.fuseBar = this.add.rectangle(this.W / 2 - 210, 110, 420, 18, 0xffc300, 1).setOrigin(0, 0.5).setDepth(5);

    // Audio
    this._setupAudio();

    // Systems: spawns + game timer + difficulty ramp
    this._startSpawning();
    this._startGameTimer();
    this._startDifficultyRamp();

    // Camera slight zoom/feel
    this.sys.cameras.main.setBackgroundColor('#0b0f1a');
  }

  // -------------------------------------------------------
  update(time, delta) {
    // Keyboard lane movement
    if (this.mobile.isLeft || (this.cursors && this.cursors.left.isDown) || (this.keys && this.keys.A.isDown)) {
      this._movePlayerBy(-1);
    } else if (this.mobile.isRight || (this.cursors && this.cursors.right.isDown) || (this.keys && this.keys.D.isDown)) {
      this._movePlayerBy(1);
    }

    // Action button = quick vertical toss if holding bomb
    if (this.mobile.isAction || (this.keys && this.keys.SPACE.isDown)) {
      if (this.bombState === 'player') this._tossBombFromHolder(0); // up
    }

    // Update bomb tether if held
    if (this.bombState === 'player' && this.player) {
      this.bomb.setPosition(this.player.x, this.player.y - 70);
    } else if (this.bombState === 'enemy' && this.bombHolder && this.bombHolder.active) {
      this.bomb.setPosition(this.bombHolder.x, this.bombHolder.y - 55);
    }

    // Update fuse
    this._tickFuse(delta / 1000);
  }

  // =======================================================
  //                    GAME HELPERS
  // =======================================================

  _computeLaneXs(count, width) {
    const xs = [];
    const pad = width * 0.1;
    const usable = width - pad * 2;
    for (let i = 0; i < count; i++) {
      xs.push(pad + usable * (i / (count - 1)));
    }
    return xs;
  }

  _ensureFallbackTexture(key, w, h, color) {
    if (this.textures.exists(key)) return;
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(color, 1);
    g.fillRoundedRect(0, 0, w, h, Math.min(w, h) * 0.2);
    g.lineStyle(2, 0x1c2333, 1);
    g.strokeRoundedRect(1, 1, w - 2, h - 2, Math.min(w, h) * 0.2);
    g.generateTexture(key, w, h);
    g.destroy();
    console.warn('[GameScene] Fallback texture created for', key);
  }

  _fmtTime(sec) {
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${r.toString().padStart(2, '0')}`;
  }

  // ----------------- INPUT -----------------
  _setupInput() {
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys('A,D,SPACE');

    // Swipe to toss
    this.input.on('pointerdown', (p) => {
      this.pointerStart = { x: p.x, y: p.y, t: p.downTime };
    });
    this.input.on('pointerup', (p) => {
      if (!this.pointerStart) return;
      const dx = p.x - this.pointerStart.x;
      const dy = p.y - this.pointerStart.y;
      const dt = p.upTime - this.pointerStart.t;
      const swipeDist = Math.hypot(dx, dy);
      const isSwipe = swipeDist > 40 && dt < 500;
      if (isSwipe && Math.abs(dx) > Math.abs(dy)) {
        const dir = dx > 0 ? +1 : -1;
        if (this.bombState === 'player') this._tossBombFromHolder(dir);
      }
      this.pointerStart = null;
    });

    // Mobile buttons
    const imgs = this.cfg.images || {};
    const mkBtn = (key, x, y, onDown, onUp) => {
      const btn = this.add.image(x, y, key).setDepth(10).setInteractive({ useHandCursor: true });
      btn.setDisplaySize(key === 'action' ? 160 : 120, key === 'action' ? 160 : 120);
      btn.on('pointerdown', () => {
        btn.setScale(0.92).setAlpha(0.9);
        onDown();
      });
      btn.on('pointerup', () => {
        btn.setScale(1).setAlpha(1);
        onUp();
      });
      btn.on('pointerout', () => {
        btn.setScale(1).setAlpha(1);
        onUp();
      });
      return btn;
    };

    this.mobile.left = mkBtn(
      'left',
      160,
      this.H - 100,
      () => (this.mobile.isLeft = true),
      () => (this.mobile.isLeft = false)
    );
    this.mobile.right = mkBtn(
      'right',
      490,
      this.H - 100,
      () => (this.mobile.isRight = true),
      () => (this.mobile.isRight = false)
    );
    this.mobile.action = mkBtn(
      'action',
      this.W - 160,
      this.H - 100,
      () => (this.mobile.isAction = true),
      () => (this.mobile.isAction = false)
    );
    this.mobile.left.setAlpha(0.85);
    this.mobile.right.setAlpha(0.85);
    this.mobile.action.setAlpha(0.85);
  }

  _movePlayerBy(deltaLane) {
    const newLane = Phaser.Math.Clamp(this.playerLane + deltaLane, 0, this.laneCount - 1);
    if (newLane === this.playerLane) return;
    this.playerLane = newLane;
    this.sys.tweens.add({
      targets: this.player,
      x: this.laneXs[this.playerLane],
      duration: Math.max(80, 240 - (this.cfg.gameplay.playerSpeed || 500) * 0.2),
      ease: 'Sine.easeOut'
    });
  }

  // ----------------- AUDIO -----------------
  _setupAudio() {
    const a = this.cfg.audio || {};
    const playLoop = (key, vol = 0.6) => {
      if (!this.sound.get(key) && this.cache.audio.has(key)) {
        const s = this.sound.add(key, { loop: true, volume: vol });
        s.play();
        return s;
      }
      return null;
    };
    const addOne = (key, vol = 1) => (this.cache.audio.has(key) ? this.sound.add(key, { volume: vol }) : null);

    this.snd.bgm = playLoop('bgm', 0.45);
    this.snd.throw = addOne('throw', 0.7);
    this.snd.explode = addOne('explode', 0.9);
    this.snd.destroy = addOne('destroy', 0.8);
    this.snd.hit = addOne('hit', 0.9);
    this.snd.collect = addOne('collect', 0.8);
    this.snd.win = addOne('win', 0.9);
    this.snd.lose = addOne('lose', 0.9);
  }

  // ----------------- BOMB -----------------
  _attachBombTo(holder, type) {
    this.bombHolder = holder;
    this.bombState = type; // 'player' | 'enemy'
    this.bomb.body.stop();
    this.bomb.body.setAllowGravity(false);
    this.bomb.setVelocity(0, 0);
    if (type === 'player') {
      this.bomb.setPosition(this.player.x, this.player.y - 70);
    } else if (type === 'enemy') {
      this.bomb.setPosition(holder.x, holder.y - 55);
    }
  }

  _catchBombByPlayer() {
    if (this.bombState !== 'air') return;
    this._attachBombTo(this.player, 'player');
    if (this.snd.collect) this.snd.collect.play();
  }

  _catchBombByEnemy(enemy) {
    if (!enemy.active || this.bombState !== 'air') return;
    this._attachBombTo(enemy, 'enemy');
    if (this.snd.collect) this.snd.collect.play();

    // Enemy will re-toss after hold time if still alive & holding
    if (this.enemyHoldingTimer) this.enemyHoldingTimer.remove(false);
    const holdMs = (this.cfg.gameplay && this.cfg.gameplay.enemyHoldMs) || 1250;
    this.enemyHoldingTimer = this.time.delayedCall(holdMs, () => {
      if (this.bombState === 'enemy' && this.bombHolder === enemy && enemy.active) {
        const dir = Phaser.Math.Between(0, 1) === 0 ? -1 : +1;
        this._tossBombFromHolder(dir);
      }
    });
  }

  _tossBombFromHolder(dir) {
    // dir: -1 left, 0 up, +1 right
    if (this.bombState !== 'player' && this.bombState !== 'enemy') return;

    // Allow lateral lane-targeting only within bounds if dir != 0
    let baseLane = this.bombState === 'player' ? this.playerLane : (this._findLaneIndexForX(this.bombHolder.x) ?? 0);
    const targetLane = Phaser.Math.Clamp(baseLane + dir, 0, this.laneCount - 1);

    // Detach
    this.bombState = 'air';
    this.bombHolder = null;
    this.bomb.body.setAllowGravity(true);

    const speedX = 520;
    const speedY = 740;
    const vx = dir === 0 ? 0 : (targetLane - baseLane) * speedX;
    const vy = -speedY;

    this.bomb.setVelocity(vx, vy);
    if (this.snd.throw) this.snd.throw.play();

    // Small camera nudge
    this.sys.cameras.main.shake(90, 0.002);
  }

  _findLaneIndexForX(x) {
    let idx = 0;
    let best = Number.MAX_VALUE;
    for (let i = 0; i < this.laneXs.length; i++) {
      const d = Math.abs(this.laneXs[i] - x);
      if (d < best) {
        best = d;
        idx = i;
      }
    }
    return idx;
  }

  _tickFuse(dt) {
    if (!this.bomb || !this.bomb.active) return;
    this.bombFuseLeft -= dt;
    this.bombFuseLeft = Math.max(0, this.bombFuseLeft);

    // Update fuse UI
    const pct = Phaser.Math.Clamp(this.bombFuseLeft / this.bombFuse, 0, 1);
    this.ui.fuseBar.width = 420 * pct;

    // Explode when time up
    if (this.bombFuseLeft <= 0) {
      this._explodeBomb();
    }
  }

  _explodeBomb() {
    // Visual pulse
    this._makeExplosionCircle(this.bomb.x, this.bomb.y, (this.cfg.gameplay && this.cfg.gameplay.explosionRadius) || 170);

    if (this.snd.explode) this.snd.explode.play();

    // If player is holding it and no shield -> lose
    if (this.bombState === 'player') {
      if (this.playerShield) {
        // Consume shield and reset fuse instead of losing
        this.playerShield = false;
        this.bombFuseLeft = this.bombFuse;
        return;
      } else {
        this._gameOver();
        return;
      }
    }

    // Count enemies in radius
    const radius = (this.cfg.gameplay && this.cfg.gameplay.explosionRadius) || 170;
    let destroyed = 0;
    this.enemies.children.iterate((e) => {
      if (!e || !e.active) return;
      const dx = e.x - this.bomb.x;
      const dy = e.y - this.bomb.y;
      if (dx * dx + dy * dy <= radius * radius) {
        destroyed++;
        this._killEnemy(e);
      }
    });

    // Score: 100 each, +25 per extra in same blast
    if (destroyed > 0) {
      const pts = destroyed * 100 + Math.max(0, destroyed - 1) * 25;
      this._addScore(pts);
    }

    // Reset bomb to player with fresh fuse
    this.bombFuseLeft = this.bombFuse;
    this._attachBombTo(this.player, 'player');
  }

  _makeExplosionCircle(x, y, r) {
    const g = this.add.graphics().setDepth(6);
    g.fillStyle(0xffd166, 0.35);
    g.fillCircle(x, y, r);
    g.lineStyle(6, 0xff6b6b, 0.9);
    g.strokeCircle(x, y, r);
    this.sys.tweens.add({
      targets: g,
      alpha: 0,
      scale: 1.25,
      duration: 320,
      onComplete: () => g.destroy()
    });
    this.sys.cameras.main.flash(120, 255, 210, 120);
  }

  // ----------------- ENEMIES & SPAWNS -----------------
  _startSpawning() {
    this.spawnRate = (this.cfg.gameplay && this.cfg.gameplay.enemySpawnRate) || 1800;
    this.spawnRateMin = (this.cfg.gameplay && this.cfg.gameplay.enemySpawnRateMin) || 700;
    this.enemySpeedStart = (this.cfg.gameplay && this.cfg.gameplay.enemySpeedStart) || 140;
    this.enemySpeedMax = (this.cfg.gameplay && this.cfg.gameplay.enemySpeedMax) || 260;

    const loopSpawn = () => {
      this._spawnEnemyRow();
      // Occasionally spawn powerup
      if (Phaser.Math.Between(0, 100) < 18) this._spawnRandomPowerup();
      // Re-loop
      this.spawnTimer = this.time.delayedCall(this.spawnRate, loopSpawn);
    };
    loopSpawn();
  }

  _startDifficultyRamp() {
    // Every second, slightly increase difficulty and tick fuse if held by enemy a bit faster (implicitly handled)
    this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        this.elapsedSec++;
        // Accelerate spawn rate
        // was: this.spawnRate = Math.max(this.spawnRateMin, this.spawnRate - 20);
        this.spawnRate = Math.max(this.spawnRateMin, this.spawnRate - 8); // gentler ramp

        // Nudge enemy speed closer to max over time
      }
    });
  }

  _spawnEnemyRow() {
    // Pick 2–3 lanes to spawn enemies (avoid overcrowding)
    const lanes = Phaser.Utils.Array.NumberArray(0, this.laneCount - 1);
    Phaser.Utils.Array.Shuffle(lanes);
    const spawnCount = Phaser.Math.Between(2, Math.min(3, this.laneCount));
    const speed = Phaser.Math.Linear(this.enemySpeedStart, this.enemySpeedMax, Phaser.Math.Clamp(this.elapsedSec / 60, 0, 1));

    for (let i = 0; i < spawnCount; i++) {
      const lane = lanes[i];
      const kind = Phaser.Math.Between(0, 3) === 0 ? 'enemyB' : 'enemyA';
      const s = this.physics.add.image(this.laneXs[lane], -Phaser.Math.Between(60, 160), kind);
      s.setDisplaySize(kind === 'enemyB' ? 96 : 90, kind === 'enemyB' ? 96 : 90);
      s.setVelocity(0, speed * 0.25); // quarter speed

      s.setDepth(1);
      s.setData('lane', lane);
      this.enemies.add(s);
      // Auto-destroy when off-screen
      s.setCollideWorldBounds(false);
      s.body.checkCollision.none = true;
    }

    // Clean up far below screen
    this.time.delayedCall(3500, () => {
      this.enemies.children.each((e) => {
        if (e && e.active && e.y > this.H + 120) e.destroy();
      });
    });
  }

  _killEnemy(e) {
    if (!e || !e.active) return;
    // Small pop effect
    const pop = this.add.rectangle(e.x, e.y, e.displayWidth, e.displayHeight, 0xffffff, 0.25).setDepth(6);
    this.sys.tweens.add({ targets: pop, alpha: 0, scale: 1.3, duration: 200, onComplete: () => pop.destroy() });
    if (this.snd.destroy) this.snd.destroy.play();
    e.destroy();
  }

  // ----------------- POWERUPS -----------------
  _spawnRandomPowerup() {
    const types = ['power_fuse', 'power_slowmo', 'power_shield'];
    const t = Phaser.Utils.Array.GetRandom(types);
    const lane = Phaser.Math.Between(0, this.laneCount - 1);
    const p = this.physics.add.image(this.laneXs[lane], -40, t);
    p.setDisplaySize(64, 64);
    const g = this.cfg.gameplay || {};
    p.setVelocity(0, Phaser.Math.Between(g.powerupSpeedMin || 60, g.powerupSpeedMax || 100) * 0.25);


    p.setDepth(1);
    p.setData('ptype', t);
    this.powerups.add(p);
  }

  _collectPowerup(pu) {
    if (!pu || !pu.active) return;

    // Ensure fx holder exists (for overlays, etc.)
    if (!this.fx) this.fx = { slowMoOverlay: null };

    const type = pu.getData('ptype') || pu.texture?.key;
    pu.destroy();

    switch (type) {
      case 'power_fuse': {
        // Extend fuse but never exceed the max fuse
        const extra = 2.5;
        this.bombFuseLeft = Math.min(this.bombFuse, this.bombFuseLeft + extra);

        // small feedback
        const ping = this.add.circle(this.bomb.x, this.bomb.y, 20, 0x74b9ff, 0.4).setDepth(6);
        this.sys.tweens.add({ targets: ping, alpha: 0, scale: 2, duration: 280, onComplete: () => ping.destroy() });
        break;
      }

      case 'power_slowmo': {
        const scale = (this.cfg.gameplay && this.cfg.gameplay.slowMoScale) || 0.5;
        const ms = (this.cfg.gameplay && this.cfg.gameplay.slowMoMs) || 2500;

        // Apply global slow motion
        this.time.timeScale = scale;

        // Subtle fullscreen overlay (replaces camera.setTint which doesn't exist)
        if (this.fx.slowMoOverlay) this.fx.slowMoOverlay.destroy();
        this.fx.slowMoOverlay = this.add
          .rectangle(this.W / 2, this.H / 2, this.W, this.H, 0x99ccff, 0.15)
          .setScrollFactor(0)
          .setDepth(9);

        // Gentle pulsing while slow‑mo is active
        this.sys.tweens.add({
          targets: this.fx.slowMoOverlay,
          alpha: 0.25,
          yoyo: true,
          duration: 300,
          repeat: Math.max(0, Math.floor(ms / 300) - 1)
        });

        // Restore normal speed & remove overlay
        this.time.delayedCall(ms, () => {
          this.time.timeScale = 1;
          if (this.fx && this.fx.slowMoOverlay) {
            this.fx.slowMoOverlay.destroy();
            this.fx.slowMoOverlay = null;
          }
        });
        break;
      }

      case 'power_shield': {
        // Gain one safety against self‑detonation
        this.playerShield = true;

        // Visual halo on player
        const halo = this.add.circle(this.player.x, this.player.y - 20, 40, 0x55efc4, 0.35).setDepth(3);
        this.sys.tweens.add({
          targets: halo,
          y: halo.y - 30,
          alpha: 0,
          duration: 420,
          onComplete: () => halo.destroy()
        });
        break;
      }

      default: {
        // Unknown/bonus pickup: small score nudge (optional)
        this._addScore(50);
        break;
      }
    }

    if (this.snd.collect) this.snd.collect.play();
  }


  // ----------------- UI & SCORING -----------------
  _addScore(n) {
    this.score += n;
    const label = (this.cfg.texts && this.cfg.texts.score_label) || 'Points: ';
    this.ui.scoreText.setText(`${label}${this.score}`);

    // Punch effect
    this.sys.tweens.add({ targets: this.ui.scoreText, scale: 1.1, duration: 80, yoyo: true });
    if (this.score >= this.targetScore) this._winGame();
  }

  // ----------------- TIMER / WIN-LOSE -----------------
  _startGameTimer() {
    this.timeLeft = (this.cfg.gameplay && this.cfg.gameplay.timerSeconds) || 60;
    this.targetScore = (this.cfg.gameplay && this.cfg.gameplay.targetScore) || 5000;
    this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        this.timeLeft--;
        this.ui.timerText.setText(this._fmtTime(this.timeLeft));
        if (this.timeLeft <= 0) {
          // Timer end -> check score
          if (this.score >= this.targetScore) this._winGame();
          else this._gameOver();
        }
      }
    });
  }

  _winGame() {
    if (this.snd.win) this.snd.win.play();
    this._cleanup();
    // Handoff to Win scene (no overlay rendering here)
    this.scene.start('WinScene');
  }

  _gameOver() {
    if (this.snd.hit) this.snd.hit.play();
    if (this.snd.lose) this.snd.lose.play();
    this._cleanup();
    this.scene.start('GameOverScene');
  }

  _cleanup() {
    if (this.spawnTimer) this.spawnTimer.remove(false);
    if (this.enemyHoldingTimer) this.enemyHoldingTimer.remove(false);
    if (this.snd.bgm) this.snd.bgm.stop();

    // reset any slow-mo / overlays
    this.time.timeScale = 1;
    if (this.fx && this.fx.slowMoOverlay) {
      this.fx.slowMoOverlay.destroy();
      this.fx.slowMoOverlay = null;
    }
  }


  // =======================================================
  // END CLASS
  // =======================================================
}

// export default GameScene;
