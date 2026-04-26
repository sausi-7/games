// Scenes/GameScene.js
// Pure gameplay-only scene for "Tower Blast"
// - No menus/overlays/transitions besides calling Win/GameOver scenes
// - Uses config from this.registry.get('cfg')
// - Portrait 1080x1920, mobile buttons included
// - Uses this.sys.* access style

class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');

    this.player = null;
    this.cursors = null;

    this.platforms = null;
    this.enemies = null;
    this.spikes = null;
    this.gems = null;
    this.healths = null;

    this.score = 0;
    this.lives = 3;
    this.timeLeft = null;

    this.scrollSpeed = 100;
    this.scrollAccel = 6;
    this.scrollMax = 350;

    this.nextRowY = 0;
    this.lastSafeX = null; // <-- track reachable chain

    this.ui = { scoreText: null, timerText: null, healthBarBg: null, healthBar: null };

    this.mobile = { left: null, right: null, action: null, isLeft: false, isRight: false, isAction: false };

    this.snd = { bgm: null, jump: null, hit: null, collect: null, collapse: null };

    this.bg = null;
  }

  // ---------- Utility: Fall-back textures ----------
  ensureTextureRect(key, w, h, color = 0x8888aa) {
    if (this.textures.exists(key)) return;
    const g = this.add.graphics().fillStyle(color, 1).fillRect(0, 0, w, h);
    g.generateTexture(key, w, h);
    g.destroy();
  }

  preload() {
    const cfg = (this.cfg = this.registry.get('cfg') || {});

    // Images
    if (cfg.images1) {
      Object.entries(cfg.images1).forEach(([key, url]) => {
        if (url && typeof url === 'string') this.load.image(key, url);
      });
    }
     if (cfg.images2) {
      Object.entries(cfg.images2).forEach(([key, url]) => {
        if (url && typeof url === 'string') this.load.image(key, url);
      });
    }
     if (cfg.ui) {
      Object.entries(cfg.ui).forEach(([key, url]) => {
        if (url && typeof url === 'string') this.load.image(key, url);
      });
    }

    // Spritesheets
    if (cfg.spritesheets) {
      Object.entries(cfg.spritesheets).forEach(([key, meta]) => {
        if (meta && meta.url) {
          this.load.spritesheet(key, meta.url, {
            frameWidth: meta.frameWidth || 32,
            frameHeight: meta.frameHeight || 32
          });
        }
      });
    }

    // Audio
    if (cfg.audio) {
      Object.entries(cfg.audio).forEach(([key, url]) => {
        if (url && typeof url === 'string') this.load.audio(key, url);
      });
    }
  }

  create() {
    const cfg = this.registry.get('cfg') || {};
    const gameplay = cfg.gameplay || {};

    const width = Number(this.sys.game.config.width);
    const height = Number(this.sys.game.config.height);

    this.physics.world.setBounds(0, -150000, width, 150000 + height);
    this.sys.cameras.main.setBounds(0, -150000, width, 150000 + height);
    this.sys.cameras.main.setBackgroundColor('#0b1020');

    // Background (parallax + overlay fallback)
    if (!this.textures.exists('background')) {
      this.ensureTextureRect('background', 64, 64, 0x10182e);
      const g = this.add.graphics();
      g.lineStyle(4, 0x0f2344, 0.4).strokeRect(0, 0, 64, 64);
      g.generateTexture('bg_tile_overlay', 64, 64);
      g.destroy();
    }
    this.bg = this.add
      .tileSprite(0, 0, width, height, 'background')
      .setOrigin(0, 0)
      .setScrollFactor(0);
    if (this.textures.exists('bg_tile_overlay')) {
      this.add
        .tileSprite(0, 0, width, height, 'bg_tile_overlay')
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setAlpha(0.25);
    }

    // Gameplay config
    this.lives = Phaser.Math.Clamp(gameplay.maxLives ?? 3, 1, 10);
    this.timeLeft = Number.isFinite(gameplay.timerSeconds) ? gameplay.timerSeconds : null;

    // Easier defaults (can be overridden via config.json)
    this.scrollSpeed = gameplay.scrollSpeedStart ?? 80;
    this.scrollAccel = gameplay.scrollAccel ?? 3;
    this.scrollMax = gameplay.scrollSpeedMax ?? 240;

    this.playerSpeed = gameplay.playerSpeed ?? 300;
    this.jumpVelocity = gameplay.jumpVelocity ?? -560;
    this.gravity = gameplay.gravity ?? 1000;
    this.enemySpeed = gameplay.enemySpeed ?? 110;

    this.floorSpacing = gameplay.floorSpacing ?? 200;
    this.platformMinW = gameplay.platformMinWidth ?? 240;
    this.platformMaxW = gameplay.platformMaxWidth ?? 520;

    // NEW: Maximum horizontal shift the guaranteed platform can be from the last one
    this.maxReachX = gameplay.maxReachX ?? 220;

    this.prob = {
      enemy: gameplay.enemySpawnChance ?? 0.2,
      spike: gameplay.spikeSpawnChance ?? 0.15,
      gem: gameplay.collectibleChance ?? 0.35,
      health: gameplay.healthPackChance ?? 0.1
    };

    // Physics gravity
    this.physics.world.gravity.y = this.gravity;

    // Fallbacks for critical textures
    this.ensureTextureRect('platform', 256, 32, 0x1a2e55);
    this.ensureTextureRect('spike', 40, 30, 0xaa3344);
    this.ensureTextureRect('gem', 26, 24, 0x55e1ff);
    this.ensureTextureRect('health', 28, 28, 0x5ae16a);
    this.ensureTextureRect('left', 96, 96, 0x22334a);
    this.ensureTextureRect('right', 96, 96, 0x22334a);
    this.ensureTextureRect('action', 100, 100, 0x2a4a22);

    // Groups
    this.platforms = this.physics.add.group({ allowGravity: false, immovable: true });
    this.enemies = this.physics.add.group({ allowGravity: true });
    this.spikes = this.physics.add.group({ allowGravity: false, immovable: true });
    this.gems = this.physics.add.group({ allowGravity: false, immovable: true });
    this.healths = this.physics.add.group({ allowGravity: false, immovable: true });

    // Player
    const playerStartX = width * 0.5;
    const playerStartY = height - 300;

    if (!this.textures.exists('player')) {
      this.ensureTextureRect('player', 36, 48, 0x6ad3ff);
    }
    this.player = this.physics.add.sprite(playerStartX, playerStartY, 'player').setDepth(10);
    this.player.setCollideWorldBounds(true);
    this.player.setBounce(0);
    const w = 22, h = 120, ox = 50, oy = 20;  // width, height, offsetX, offsetY
    this.player.body.setSize(w, h);        // size of the hitbox
    this.player.body.setOffset(ox, oy);
    this.player.body.setMaxVelocity(this.playerSpeed, 1000);

    // Animations — only if real spritesheets (frameTotal > 1)
    const playerTex = this.textures.exists('player') ? this.textures.get('player') : null;
    const playerSheetCfg = this.cfg?.spritesheets?.player;
    if (playerSheetCfg && playerTex && playerTex.frameTotal > 1) {
      if (!this.anims.exists('player_run')) {
        this.anims.create({
          key: 'player_run',
          frames: this.anims.generateFrameNumbers('player', {
            start: 0,
            end: Math.max(1, (playerSheetCfg.frames ?? 4) - 1)
          }),
          frameRate: 10,
          repeat: -1
        });
      }
      if (!this.anims.exists('player_idle')) {
        this.anims.create({
          key: 'player_idle',
          frames: [{ key: 'player', frame: 0 }],
          frameRate: 1
        });
      }
      if (!this.anims.exists('player_jump')) {
        this.anims.create({
          key: 'player_jump',
          frames: [{ key: 'player', frame: 0 }],
          frameRate: 1
        });
      }
    }

    // Initial rows
    this.nextRowY = height - 200;
    this.lastSafeX = playerStartX; // seed GRP chain
    this.spawnRow(this.nextRowY);
    for (let i = 0; i < 10; i++) {
      this.nextRowY -= this.floorSpacing;
      this.spawnRow(this.nextRowY);
    }

    // Collisions / overlaps
    this.physics.add.collider(this.player, this.platforms);
    this.physics.add.collider(this.enemies, this.platforms);

    this.physics.add.overlap(this.player, this.spikes, () => this.hurtPlayer(1, 'spike'), null, this);
    this.physics.add.overlap(
      this.player,
      this.enemies,
      (_p, enemy) => enemy.active && this.hurtPlayer(1, 'enemy', enemy),
      null,
      this
    );
    this.physics.add.overlap(this.player, this.gems, (_p, gem) => this.collectGem(gem), null, this);
    this.physics.add.overlap(this.player, this.healths, (_p, hp) => this.collectHealth(hp), null, this);

    // Input
    this.cursors = this.input.keyboard.createCursorKeys();

    // UI
    const label = (cfg.texts && cfg.texts.score_label) ? cfg.texts.score_label : 'Score: ';
    this.ui.scoreText = this.add
      .text(16, 16, `${label}0`, { fontFamily: cfg.font?.family || 'system-ui', fontSize: '28px', color: '#cfe3ff' })
      .setScrollFactor(0);

    this.ui.timerText = this.add
      .text(width * 0.5, 16, this.timeLeft !== null ? `Time: ${this.timeLeft}` : 'Time: ∞', {
        fontFamily: cfg.font?.family || 'system-ui',
        fontSize: '28px',
        color: '#cfe3ff'
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0);

    this.ui.healthBarBg = this.add.rectangle(width - 180, 30, 160, 20, 0x0e1626).setScrollFactor(0);
    this.ui.healthBarBg.setStrokeStyle(2, 0x213259, 1);
    this.ui.healthBar = this.add.rectangle(width - 180, 30, 160, 20, 0x55e16a).setScrollFactor(0);
    this.refreshHealthBar();

    // Mobile controls
    this.createMobileControls();

    // Audio
    this.snd.bgm = this.sound.add('bgm', { loop: true, volume: 0.5 });
    this.snd.jump = this.sound.add('jump', { volume: 0.6 });
    this.snd.hit = this.sound.add('hit', { volume: 0.8 });
    this.snd.collect = this.sound.add('collect', { volume: 0.7 });
    this.snd.collapse = this.sound.add('collapse', { volume: 0.7 });
    if (this.snd.bgm) this.snd.bgm.play();

    // Camera & timer
    this.sys.cameras.main.scrollY = 0;

    if (this.timeLeft !== null) {
      this.time.addEvent({
        delay: 1000,
        loop: true,
        callback: () => {
          this.timeLeft = Math.max(0, this.timeLeft - 1);
          if (this.ui.timerText) this.ui.timerText.setText(`Time: ${this.timeLeft}`);
          if (this.timeLeft === 0) this.win();
        }
      });
    }
  }

  // ---- Row spawning with Guaranteed Reachable Platform (GRP) ----
  spawnRow(y) {
    const width = Number(this.sys.game.config.width);
    const minW = this.platformMinW;
    const maxW = this.platformMaxW;

    // (1) GRP: always create one platform near lastSafeX (reachability)
    const w0 = Phaser.Math.Between(minW, maxW);
    const jitter = Phaser.Math.Between(-this.maxReachX, this.maxReachX);
    const margin = 30 + w0 * 0.5;
    const x0 = Phaser.Math.Clamp((this.lastSafeX ?? width * 0.5) + jitter, margin, width - margin);
    const p0 = this.createPlatform(x0, y, w0, 0.5); // hazards half as likely on GRP
    this.lastSafeX = x0;

    // (2) Optional extras (0–2) at random positions that don't overlap the GRP too closely
    const extraCount = Phaser.Math.Between(0, 2);
    for (let i = 0; i < extraCount; i++) {
      const w = Phaser.Math.Between(minW, maxW);
      const margin2 = 30 + w * 0.5;
      let attempts = 10;
      let x = x0;
      while (attempts-- > 0) {
        const candidate = Phaser.Math.Between(margin2, width - margin2);
        if (Math.abs(candidate - x0) > (w0 * 0.5 + w * 0.5 + 40)) { x = candidate; break; }
      }
      this.createPlatform(x, y, w, 1.0);
    }

    // Flavor collapse ping sometimes
    if (Math.random() < 0.1 && this.snd.collapse) {
      this.time.delayedCall(200, () => this.snd.collapse && this.snd.collapse.play(), null, this);
    }
  }

  createPlatform(cx, y, w, hazardScale = 1.0) {
    const h = 32;
    const platform = this.platforms.create(cx, y, 'platform');
    platform.displayWidth = w;
    platform.displayHeight = h;
    platform.refreshBody();
    platform.body.setAllowGravity(false);
    platform.body.setImmovable(true);

    const left = cx - w * 0.5 + 24;
    const right = cx + w * 0.5 - 24;

    const placeEnemy = Math.random() < (this.prob.enemy * hazardScale);
    const placeSpike = Math.random() < (this.prob.spike * hazardScale);
    const placeGem = Math.random() < this.prob.gem;
    const placeHealth = Math.random() < this.prob.health;

    if (placeEnemy) this.spawnEnemy(Phaser.Math.Between(left, right), y - 28, left, right);
    if (placeSpike) this.spawnSpike(Phaser.Math.Between(left, right), y - 22);
    if (placeGem) this.spawnGem(Phaser.Math.Between(left, right), y - 40);
    if (placeHealth && Math.random() < 0.5) this.spawnHealth(Phaser.Math.Between(left, right), y - 40);

    return platform;
  }

  spawnEnemy(x, y, minX, maxX) {
    if (!this.textures.exists('enemy')) this.ensureTextureRect('enemy', 32, 28, 0xe6a34f);
    const e = this.enemies.create(x, y, 'enemy').setScale(0.4);
    e.setCollideWorldBounds(false);
    e.setBounce(0);
    e.body.setVelocityX((Math.random() < 0.5 ? -1 : 1) * this.enemySpeed);
    e.setData('minX', minX);
    e.setData('maxX', maxX);

    const enemySheetCfg = this.cfg?.spritesheets?.enemy;
    const enemyTex = this.textures.exists('enemy') ? this.textures.get('enemy') : null;
    if (enemySheetCfg && enemyTex && enemyTex.frameTotal > 1 && !this.anims.exists('enemy_walk')) {
      this.anims.create({
        key: 'enemy_walk',
        frames: this.anims.generateFrameNumbers('enemy', {
          start: 0,
          end: Math.max(1, (enemySheetCfg.frames ?? 4) - 1)
        }),
        frameRate: 8,
        repeat: -1
      });
    }
    if (this.anims.exists('enemy_walk')) e.play('enemy_walk', true);
  }

  spawnSpike(x, y) {
    const s = this.spikes.create(x, y-10, 'spike');

    // 1) Visual scale (uniform)
    const SCALE = (this.cfg?.gameplay?.spikeScale ?? 0.5); // make this tunable
    s.setScale(SCALE);

    // 2) Physics body: rectangular hitbox sized to the *display* size
    //    (we'll make it a bit narrower and only the bottom-half is "sharp")
    s.body.setAllowGravity(false);
    s.body.setImmovable(true);

    const dispW = s.displayWidth;
    const dispH = s.displayHeight;

    // Hitbox covers bottom-half and 70% width
    const hbW = dispW * 0.7;
    const hbH = dispH * 0.5;

    s.body.setSize(hbW, hbH);                // set collider size in world pixels
    s.body.setOffset((dispW - hbW) / 2,      // center horizontally
      (dispH - hbH));         // sit on the bottom of the sprite

    s.setAngle(0);
  }


  spawnGem(x, y) {
    const g = this.gems.create(x, y, 'gem');
    g.body.setAllowGravity(false);
    g.body.setImmovable(true);
  }

  spawnHealth(x, y) {
    const h = this.healths.create(x, y-10, 'health').setScale(0.2);
    h.body.setAllowGravity(false);
    h.body.setImmovable(true);
  }

  refreshHealthBar() {
    const maxLives = this.cfg?.gameplay?.maxLives ?? 3;
    const ratio = Phaser.Math.Clamp(this.lives / maxLives, 0, 1);
    const fullW = 160;
    this.ui.healthBar.width = fullW * ratio;
    this.ui.healthBar.x =
      Number(this.sys.game.config.width) - 180 - (fullW - this.ui.healthBar.width) * 0.5;
  }

  playAnimForMovement() {
    if (!this.player.anims) return;
    if (this.player.body.onFloor()) {
      if (Math.abs(this.player.body.velocity.x) > 10) {
        if (this.anims.exists('player_run')) this.player.play('player_run', true);
      } else {
        if (this.anims.exists('player_idle')) this.player.play('player_idle', true);
      }
    } else {
      if (this.anims.exists('player_jump')) this.player.play('player_jump', true);
    }
  }

  // Damage + brief invulnerability + knockback
  hurtPlayer(amount = 1, _source = 'enemy', fromObj = null) {
    if (!this.player || !this.player.active) return;
    if (this.player.getData('invuln')) return;

    this.lives = Math.max(0, this.lives - amount);
    this.refreshHealthBar();
    this.snd.hit && this.snd.hit.play();

    const dir = fromObj ? Math.sign(this.player.x - fromObj.x) || 1 : (Math.random() < 0.5 ? -1 : 1);
    this.player.setVelocityY(this.jumpVelocity * 0.6);
    this.player.setVelocityX(dir * (this.playerSpeed * 0.8));

    this.sys.tweens.add({
      targets: this.player,
      alpha: 0.3,
      duration: 80,
      yoyo: true,
      repeat: 7,
      onComplete: () => {
        this.player.clearAlpha();
        this.player.setData('invuln', false);
      }
    });
    this.player.setData('invuln', true);

    if (this.lives <= 0) this.gameOver('out_of_health');
  }

  collectGem(gem) {
    if (!gem.active) return;
    gem.disableBody(true, true);
    this.score += 10;
    if (this.ui.scoreText) {
      const label = this.cfg?.texts?.score_label || 'Score: ';
      this.ui.scoreText.setText(`${label}${this.score}`);
    }
    this.snd.collect && this.snd.collect.play();
  }

  collectHealth(hp) {
    if (!hp.active) return;
    hp.disableBody(true, true);
    const maxLives = this.cfg?.gameplay?.maxLives ?? 3;
    this.lives = Math.min(maxLives, this.lives + 1);
    this.refreshHealthBar();
    this.snd.collect && this.snd.collect.play();
  }

  createMobileControls() {
    const w = Number(this.sys.game.config.width);
    const h = Number(this.sys.game.config.height);

    const leftX = 160;
    const rightX = 490;
    const bottomY = h - 100;
    const actionX = w - 160;

    const mkBtn = (key, x, y, onDown, onUp) => {
      const s = this.add
        .image(x, y, key)
        .setScrollFactor(0)
        .setAlpha(0.8)
        .setDepth(50)
        .setInteractive({ useHandCursor: true });
      s.setScale(1);
      s.on('pointerdown', () => {
        s.setScale(0.9);
        s.setAlpha(0.6);
        onDown();
      });
      s.on('pointerup', () => {
        s.setScale(1);
        s.setAlpha(0.8);
        onUp();
      });
      s.on('pointerout', () => {
        s.setScale(1);
        s.setAlpha(0.8);
        onUp();
      });
      return s;
    };

    this.mobile.left = mkBtn('left', leftX, bottomY - 50, () => (this.mobile.isLeft = true), () => (this.mobile.isLeft = false));
    this.mobile.right = mkBtn('right', rightX, bottomY - 50, () => (this.mobile.isRight = true), () => (this.mobile.isRight = false));
    this.mobile.action = mkBtn('action', actionX, bottomY - 50, () => (this.mobile.isAction = true), () => (this.mobile.isAction = false));
  }

  handleInput() {
    const body = this.player.body;
    const left = (this.cursors.left && this.cursors.left.isDown) || this.mobile.isLeft;
    const right = (this.cursors.right && this.cursors.right.isDown) || this.mobile.isRight;
    const jumpPressed =
      (this.cursors.up && Phaser.Input.Keyboard.JustDown(this.cursors.up)) || this.mobile.isAction;

    if (left && !right) {
      body.setVelocityX(-this.playerSpeed);
      this.player.setFlipX(true);
    } else if (right && !left) {
      body.setVelocityX(this.playerSpeed);
      this.player.setFlipX(false);
    } else {
      body.setVelocityX(0);
    }

    if (jumpPressed && this.player.body.onFloor()) {
      this.player.setVelocityY(this.jumpVelocity);
      this.snd.jump && this.snd.jump.play();
      if (this.mobile.isAction) this.mobile.isAction = false; // consume tap
    }

    this.playAnimForMovement();
  }

  update(_time, delta) {
    if (!this.player || !this.player.active) return;
    const dt = Math.max(delta, 16) / 1000;
    const cam = this.sys.cameras.main;
    const height = Number(this.sys.game.config.height);

    // Input
    this.handleInput();

    // Auto upward scroll with rubber-banding:
    // - If player is near bottom -> slow down a lot
    // - If player is high on screen -> allow normal acceleration
    const bottomVisibleY = cam.scrollY + height;
    const distFromBottom = bottomVisibleY - this.player.y; // pixels above the bottom
    if (distFromBottom < 180) {
      // panic slowdown
      this.scrollSpeed = Math.max(60, this.scrollSpeed - 220 * dt);
    } else {
      // gentle ramp up
      this.scrollSpeed = Math.min(this.scrollMax, this.scrollSpeed + this.scrollAccel * dt);
    }
    cam.scrollY -= this.scrollSpeed * dt;

    // Parallax
    this.bg && (this.bg.tilePositionY -= this.scrollSpeed * dt * 0.4);

    // Crushed check (player falls below visible bottom)
    if (this.player.y > bottomVisibleY - 40) {
      this.gameOver('crushed');
      return;
    }

    // Generate more rows upward
    while (this.nextRowY > cam.scrollY - 2000) {
      this.nextRowY -= this.floorSpacing;
      this.spawnRow(this.nextRowY);
    }

    // Cleanup below
    const cullY = bottomVisibleY + 200;
    this.platforms.children.iterate((o) => o && o.y > cullY && o.destroy());
    this.enemies.children.iterate((o) => o && o.y > cullY && o.destroy());
    this.spikes.children.iterate((o) => o && o.y > cullY && o.destroy());
    this.gems.children.iterate((o) => o && o.y > cullY && o.destroy());
    this.healths.children.iterate((o) => o && o.y > cullY && o.destroy());

    // Enemy patrol
    this.enemies.children.iterate((e) => {
      if (!e || !e.body) return;
      const minX = e.getData('minX') ?? e.x - 60;
      const maxX = e.getData('maxX') ?? e.x + 60;
      if (e.x < minX) e.body.setVelocityX(Math.abs(this.enemySpeed));
      if (e.x > maxX) e.body.setVelocityX(-Math.abs(this.enemySpeed));
      e.setFlipX(e.body.velocity.x < 0);
    });
  }

  win() {
    const score = this.score;
    this.snd.bgm && this.snd.bgm.stop();
    this.scene.start('WinScene', { score });
  }

  gameOver(reason = 'dead') {
    if (!this.player.active) return;
    this.snd.bgm && this.snd.bgm.stop();
    this.player.setActive(false).setVisible(false);
    this.scene.start('GameOverScene', { score: this.score, reason });
  }
}


