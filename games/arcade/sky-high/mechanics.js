export default class GamePlayScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
    Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach(fn => {
      if (typeof this[fn] === 'function') {
        this[fn] = this[fn].bind(this);
      }
    });
    this.player = null;
    this.sun = null;
    this.fireballs = null;
    this.clouds = null;
    this.gems = null;
    this.key = null;
    this.door = null;
    this.joystickData = null;
    this.shieldButton = null;
    this.shieldSprite = null;
    this.isShieldActive = false;
    this.shieldPower = 0;
    this.playerHealth = 3;
    this.gameOver = false;
    this.levelComplete = false;
    this.cloudTimers = new Map();
    this.respawnPoint = { x: 200, y: 750 };
    this.playerOnGround = false;
    this.cursors = null;
    this.spaceKey = null;
    this.worldWidth = 3840; // Two screens (background + flipped background)
    this.moveSpeed = 200; // Player movement speed
    this.hasKey = false;
    this.isGameStarted = false;
  }
  init(data) {
    // Reset critical state variables
    this.player = null;
    this.sun = null;
    this.fireballs = null;
    this.clouds = null;
    this.gems = null;
    this.key = null;
    this.door = null;
    this.joystickData = null;
    this.shieldButton = null;
    this.shieldSprite = null;
    this.isShieldActive = false;
    this.shieldPower = 0;
    this.playerHealth = 3;
    this.gameOver = false;
    this.levelComplete = false;
    this.cloudTimers = new Map();
    this.respawnPoint = { x: 200, y: 750 };
    this.playerOnGround = false;
    this.cursors = null;
    this.spaceKey = null;
    this.hasKey = false;
    this.isGameStarted = data.restartDirectly || false;

    // Clear any existing timers
    this.time.removeAllEvents();
  }

  preload() {
    const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));
    this.load.json('levelConfig', `${basePath}/config.json`);

    this.load.once('filecomplete-json-levelConfig', () => {
      const cfg = this.cache.json.get('levelConfig');
      const sheets = cfg.sheets || {};
      const heroData = sheets.hero || {};
      const rawMain = new URLSearchParams(window.location.search).get('main') || '';
      const cleanMain = rawMain.replace(/^"|"$/g, '');
      const sheetUrl =
        cleanMain ||
        heroData.url ||
        `${basePath}/assets/eve_spritesheet.png`;

      const frameW = heroData.frameWidth || 103;
      const frameH = heroData.frameHeight || 142;
      this.load.spritesheet('eve', sheetUrl, {
        frameWidth: frameW,
        frameHeight: frameH,
      });



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
    const cfg = this.cache.json.get('levelConfig');
    this.mechanics = cfg.mechanics || {};
    const bg = this.add.image(0, 0, 'blur_background').setOrigin(0).setScrollFactor(0);
    // if (this.scale.fullscreen.available && !this.scale.isFullscreen) {
    //   this.scale.startFullscreen();
    // }
    this.input.addPointer(2); // Enable multi-touch for joystick

    if (screen.orientation?.lock) {
      screen.orientation.lock('landscape').catch(() => console.warn('Orientation lock failed'));
    }
    // this.showStartScreen();
    if (this.isGameStarted) {
      this.gameStartScreen();
    } else {
      this.showStartScreen();
    }



  }

  gameStartScreen() {
    this.isGameStarted = true;

    // Clear any existing objects to prevent duplicates
    if (this.fireballs) this.fireballs.clear(true, true);
    if (this.clouds) this.clouds.clear(true, true);
    if (this.gems) this.gems.clear(true, true);
    if (this.key) this.key.destroy();
    if (this.door) this.door.destroy();
    if (this.player) this.player.destroy();

    // Create background
    this.bg = this.add.image(0, 0, 'background').setOrigin(0, 0).setDepth(0);
    this.bg2 = this.add.image(1920, 0, 'background').setOrigin(0, 0).setFlipX(true).setDepth(0);

    // Sun
    this.sun = this.add.image(1920, 150, 'enemy').setOrigin(0.5).setScale(0.8).setDepth(1);

    // Physics groups
    this.fireballs = this.physics.add.group({ depth: 4 });
    this.clouds = this.physics.add.staticGroup();
    this.gems = this.physics.add.group();

    // Platforms and collectibles
    this.createInitialPlatforms();
    this.createGems();

    // Key and door
    this.key = this.physics.add.sprite(2500, 450, 'key').setScale(0.8).setDepth(3);
    this.key.body.setSize(40, 40);
    this.door = this.physics.add.sprite(3500, 450, 'closed_gate').setScale(0.8).setDepth(3);
    this.door.body.setSize(100, 150);

    // Player setup
    this.player = this.physics.add.sprite(200, 550, 'eve').setDepth(5);
    this.player.setScale(2);
    this.player.body.setSize(80, 120);
    this.player.body.setGravityY(this.mechanics.gravityForce || 600);

    // Camera setup
    this.sys.cameras.main.startFollow(this.player, true);
    this.sys.cameras.main.setBounds(0, 0, this.worldWidth, 1080);

    // Animations, UI, controls, collisions
    this.createAnimations();
    this.createUI();
    this.setupCollisions();

    // Fireball spawn event
    this.time.addEvent({
      delay: this.mechanics.fireballSpawnDelay || 2000,
      callback: this.spawnFireball,
      callbackScope: this,
      loop: true,
    });
  }

  createInitialPlatforms() {
    const platforms = [
      // First screen (x: 0 to 3840)
      { x: 300, y: 800, type: 'platform1' },
      { x: 600, y: 700, type: 'platform2' },
      { x: 900, y: 600, type: 'platform3' },
      { x: 1200, y: 700, type: 'platform1' },
      { x: 1500, y: 600, type: 'platform2' },
      { x: 1800, y: 500, type: 'platform3' },
      { x: 2200, y: 800, type: 'platform1' },
      { x: 2600, y: 700, type: 'platform2' },
      { x: 3000, y: 600, type: 'platform3' },
      { x: 3400, y: 700, type: 'platform1' },
    ];
    platforms.forEach(pos => {
      const cloud = this.clouds.create(pos.x, pos.y, pos.type).setScale(0.8).setDepth(2);
      cloud.body.setSize(cloud.width * 0.8, 30);
      cloud.disappeared = false;
      cloud.body.checkCollision.down = false;
      cloud.body.checkCollision.left = false;
      cloud.body.checkCollision.right = false;
      cloud.body.checkCollision.up = true;
    });
  }

  showStartScreen() {
    const centerX = 1920 / 2;
    const centerY = 1080 / 2;
    const cfg = this.cache.json.get('levelConfig');
    const message = cfg.texts || {};

    this.startOverlay = this.add.container(centerX, centerY).setScrollFactor(0);
    const htp = this.add.image(0, -100, 'htp').setDepth(11).setScale(1).setOrigin(0.5);
    const title = this.add.text(-80, -375, 'How to Play', { font: "bold 70px Outfit", color: '#fff' })
      .setDepth(11).setOrigin(0.5, -1);
    // const rock = this.add.image(centerX + 135, centerY - 100, 'burning-rock').setScale(0.3).setDepth(13).setOrigin(0.5);
    // const eagle = this.add.image(centerX + 235, centerY - 100, 'eagle').setScale(0.3).setDepth(13).setOrigin(0.5);
    const desc = this.add.text(-5, -120, message.htpMessage, {
      font: "60px Outfit", color: '#fff', align: 'left', wordWrap: { width: 800, useAdvancedWrap: true }
    }).setOrigin(0.5, 0);
    const startBtn = this.add.image(0, 260, 'play_game')
      .setInteractive()
      .setScale(1)
      .setDepth(14);

    // this.load.audio('background_music', 'bgm');

    const music = this.sound.add('bgm', {
      volume: 0.8,
      loop: true
    });
    music.play();

    startBtn.on('pointerdown', () => {
      // if (!this.scale.isFullscreen) {
      //   this.scale.startFullscreen();
      // }
      this.startOverlay.destroy();
      // rock.destroy();
      // eagle.destroy();
      this.gameStartScreen();
    });

    this.startOverlay.add([htp, title, desc, startBtn]);
  }

  endGame() {
    this.gameOver = true;
    this.physics.pause();

    // Clear all cloud timers
    this.cloudTimers.forEach((timer, cloud) => {
      timer.remove();
      this.cloudTimers.delete(cloud);
    });

    // Clean up joystick input listeners and objects
    if (this.joystickData) {
      this.joystickData.bg.removeAllListeners();
      this.joystickData.knob.removeAllListeners();
      this.input.off('pointerup');
      this.input.off('pointermove');
      this.joystickData.bg.destroy();
      this.joystickData.knob.destroy();
      this.joystickData = null;
    }

    // Clean up shield button
    if (this.shieldButton) {
      this.shieldButton.removeAllListeners();
      this.shieldButton.destroy();
      this.shieldButton = null;
    }

    // Clean up keyboard inputs
    if (this.cursors) {
      this.input.keyboard.removeAllKeys();
      this.cursors = null;
    }
    if (this.spaceKey) {
      this.input.keyboard.removeKey(this.spaceKey);
      this.spaceKey = null;
    }

    // Clear physics groups
    this.fireballs.clear(true, true);
    this.clouds.clear(true, true);
    this.gems.clear(true, true);

    // Destroy key, door, and player
    if (this.key) this.key.destroy();
    if (this.door) this.door.destroy();
    if (this.player) this.player.destroy();
    if (this.sun) this.sun.destroy();

    // Destroy UI elements
    if (this.healthBars) {
      this.healthBars.forEach(bar => bar.destroy());
      this.healthBars = [];
    }
    if (this.shieldBars) {
      this.shieldBars.forEach(bar => bar.destroy());
      this.shieldBars = [];
    }

    // Display game over screen
    const centerX = this.sys.cameras.main.scrollX + this.sys.cameras.main.width / 2;
    const centerY = this.sys.cameras.main.height / 2;
    const overlay = this.add.container(centerX, centerY);
    const bg = this.add.image(0, -90, 'game_over').setOrigin(0.5).setDepth(30);
    const btn = this.add.image(0, 120, 'replay_level').setInteractive().setScale(1).setDepth(35);

    btn.on('pointerdown', () => {
      this.scene.restart({ restartDirectly: true });
    });

    overlay.add([bg, btn]);
  }

  createGems() {
    const gemPositions = [
      { x: 900, y: 550 },
      { x: 1800, y: 450 },
      // { x: 3000, y: 600 }, // Adjusted x to ensure it's on the second screen
    ];
    gemPositions.forEach(pos => {
      const gem = this.gems.create(pos.x, pos.y, 'shield_gems').setDepth(3);
      gem.setScale(0.6);
      gem.body.setSize(40, 40);
      gem.setBounce(0.3);
      gem.setCollideWorldBounds(true);
      // Debug log to confirm gem creation
      console.log(`Gem created at x: ${pos.x}, y: ${pos.y}`);
    });
  }

  createAnimations() {
    if (!this.anims.exists('idle')) {
      this.anims.create({
        key: 'idle',
        frames: this.anims.generateFrameNumbers('eve', { start: 3, end: 3 }),
        frameRate: 8,
        repeat: -1
      });
    }

    if (!this.anims.exists('walk')) {
      this.anims.create({
        key: 'walk',
        frames: this.anims.generateFrameNumbers('eve', { start: 2, end: 4 }),
        frameRate: 10,
        repeat: -1
      });
    }
  }


  createUI() {
    // Clear existing UI elements
    this.healthBars = [];
    this.shieldBars = [];

    // Create health and shield bars
    this.healthBars.push(this.add.image(100, 50, 'health_bar_3').setOrigin(0).setScrollFactor(0).setDepth(10));
    this.shieldBars.push(this.add.image(100, 120, 'shield_bar_0').setOrigin(0).setScrollFactor(0).setDepth(10));

    // Set up controls
    this.setupControls();

    // Initialize keyboard controls
    this.cursors = this.input.keyboard.createCursorKeys();
    this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
  }

  setupControls() {
    const cam = this.sys.cameras.main;
    const shieldX = cam.width - 200;
    const shieldY = cam.height / 2 + 130;
    const joyX = 300;
    const joyY = cam.height - 400;

    const static_bg = this.add.image(shieldX, shieldY, 'static_button')
      .setDepth(10)
      .setScrollFactor(0)
      .setInteractive()
      .setDisplaySize(227, 227)
      .setAlpha(0.7);

    // Create shield button
    this.shieldButton = this.add.image(shieldX, shieldY, 'shield_button')
      .setScrollFactor(0)
      .setDepth(12)
      .setScale(1.5)
      .setInteractive()
      .on('pointerdown', () => {
        if (!this.gameOver && !this.levelComplete) this.activateShield();
      });

    // Create joystick
    const bg = this.add.image(joyX, joyY, 'static_button')
      .setDepth(10)
      .setScrollFactor(0)
      .setInteractive()
      .setDisplaySize(227, 227)
      .setAlpha(0.7);
    const knob = this.add.image(joyX, joyY, 'movable_button')
      .setDepth(11)
      .setScrollFactor(0)
      .setInteractive()
      .setDisplaySize(116.27, 116.27);
    this.joystickData = { bg, knob, forceX: 0, forceY: 0, get force() { return Math.sqrt(this.forceX ** 2 + this.forceY ** 2); } };

    let dragging = false;
    let dragId = null;
    const startX = knob.x;
    const startY = knob.y;
    const maxDist = 100;

    knob.on('pointerdown', ptr => {
      dragging = true;
      dragId = ptr.id;
    });

    this.input.on('pointerup', ptr => {
      if (ptr.id === dragId) {
        dragging = false;
        dragId = null;
        knob.setPosition(startX, startY);
        this.joystickData.forceX = 0;
        this.joystickData.forceY = 0;
      }
    });

    this.input.on('pointermove', ptr => {
      if (!dragging || ptr.id !== dragId) return;
      const dx = ptr.x - startX;
      const dy = ptr.y - startY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx);
      const clamped = Phaser.Math.Clamp(dist, 0, maxDist);
      knob.setPosition(startX + Math.cos(angle) * clamped, startY + Math.sin(angle) * clamped);
      this.joystickData.forceX = Phaser.Math.Clamp(dx / maxDist, -1, 1);
      this.joystickData.forceY = Phaser.Math.Clamp(dy / maxDist, -1, 1);
    });
  }

  setupCollisions() {
    this.physics.add.collider(this.player, this.clouds, (p, cloud) => {
      if (!cloud.disappeared) {
        this.playerOnGround = true;
        this.startCloudTimer(cloud);
      }
    }, null, this);
    this.physics.add.collider(this.gems, this.clouds);
    this.physics.add.collider(this.key, this.clouds);
    this.physics.add.collider(this.door, this.clouds);
    this.physics.add.overlap(this.player, this.fireballs, (p, f) => {
      if (!this.isShieldActive) { this.playerHit(); f.destroy(); } else { this.reflectFireball(f); }
    }, null, this);
    this.physics.add.overlap(this.player, this.gems, (_, gem) => this.collectGem(gem), null, this);
    this.physics.add.overlap(this.player, this.key, () => this.collectKey(), null, this);
    this.physics.add.overlap(this.player, this.door, () => {
      if (this.hasKey) {
        this.door.destroy();
        this.opendoor = this.physics.add.sprite(3500, 450, 'opened_gate').setScale(0.8).setDepth(3);
        this.opendoor.body.setSize(100, 150);
        this.physics.add.collider(this.opendoor, this.clouds);

        this.levelComplete = true;
        this.showLevelComplete();
      }
    }, null, this);
  }

  startCloudTimer(cloud) {
    if (!this.cloudTimers.has(cloud)) {
      const timer = this.time.delayedCall(this.mechanics.cloudDisappearDelay || 5000, () => {
        cloud.disappeared = true;
        cloud.setAlpha(0.3);
        cloud.body.enable = false;
        this.cloudTimers.delete(cloud);
      });
      this.cloudTimers.set(cloud, timer);
    }
  }

  spawnFireball() {
    if (this.gameOver || this.levelComplete) return;
    const fb = this.fireballs.create(this.player.x + 800, 150, 'fireball').setDepth(4);
    fb.setScale(1);
    fb.body.setSize(40, 40);
    const angle = Phaser.Math.Angle.Between(fb.x, fb.y, this.player.x, this.player.y);
    const speed = this.mechanics.fireballSpeed || 400;
    fb.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
  }

  reflectFireball(fb) {
    const force = this.mechanics.fireballReflectForce || 300;
    this.shieldCollideSound = this.sound.add('shield_activate', { volume: 0.3 });
    this.shieldCollideSound.play();
    fb.setVelocity(Phaser.Math.Between(-force, force), -Math.abs(fb.body.velocity.y));
  }

  activateShield() {
    if (this.shieldPower > 0 && !this.isShieldActive) {
      this.isShieldActive = true;
      this.shieldPower--;
      this.updateShieldUI();
      this.shieldSprite = this.add.image(
        this.player.x + (this.player.flipX ? -50 : 50),
        this.player.y - 20,
        'shield'
      ).setScale(0.1).setDepth(this.player.depth + 1);
      this.time.delayedCall((this.mechanics.shieldDuration || 3) * 1000, () => {
        this.isShieldActive = false;
        this.shieldSprite?.destroy();
        this.shieldSprite = null;
      });
    }
  }

  collectGem(gem) {
    gem.destroy();
    this.collectGemSound = this.sound.add('gem_collect');
    this.collectGemSound.play();
    this.shieldPower = Math.min(3, this.shieldPower + 1);
    this.updateShieldUI();
  }

  collectKey() {
    this.key.destroy();
    this.collectKeySound = this.sound.add('key_collect');
    this.collectKeySound.play();
    this.hasKey = true;
  }

  playerHit() {
    this.playerHealth--;
    this.updateHealthUI();
    this.fireballSound = this.sound.add('fireball_sound');
    this.fireballSound.play();
    // this.respawnPoint = { x: this.player.x, y: this.player.y };
    // if (this.playerHealth <= 0) {
    //   this.gameOver = true;
    //   this.respawnPlayer();
    if (this.playerHealth <= 0) {
      this.endGame();
      // restart the entire scene instead of freezing
      // this.scene.restart();
    }
  }

  respawnPlayer() {
    this.player.setPosition(this.respawnPoint.x, this.respawnPoint.y);
    this.player.setVelocity(0, 0);
    this.playerHealth = 3;
    this.updateHealthUI();
  }

  updateHealthUI() {
    const maxPerBar = 3; // number of fill-levels per bar (0 through 3)
    this.healthBars.forEach((bar, i) => {
      // compute how many “points” are in this bar
      const pointsInThisBar = Phaser.Math.Clamp(this.playerHealth - i * maxPerBar, 0, maxPerBar);
      console.log(`Health bar ${i}: ${pointsInThisBar} points`);
      bar.setTexture(`health_bar_${pointsInThisBar}`);
    });
  }

  updateShieldUI() {
    const maxPerBar = 3; // number of fill-levels per bar (0 through 3)
    this.shieldBars.forEach((bar, i) => {
      const pointsInThisBar = Phaser.Math.Clamp(this.shieldPower - i * maxPerBar, 0, maxPerBar);
      bar.setTexture(`shield_bar_${pointsInThisBar}`);
    });
  }


  update(time, delta) {
    if (!this.isGameStarted || this.gameOver || this.levelComplete) return;

    // Player movement based on input
    let moveX = 0;
    if (this.joystickData?.force > 0) {
      moveX = this.joystickData.forceX;
    } else {
      if (this.cursors.left.isDown) moveX -= 1;
      if (this.cursors.right.isDown) moveX += 1;
    }
    this.player.setVelocityX(moveX * this.moveSpeed);

    // Jump logic
    let shouldJump = false;
    if (this.joystickData?.force > 0 && this.joystickData.forceY < -0.5 && this.playerOnGround) {
      shouldJump = true;
    }
    if (this.cursors.up.isDown && this.playerOnGround) {
      shouldJump = true;
    }
    if (shouldJump) {
      this.JumpSound = this.sound.add('up');
      this.JumpSound.play();
      this.player.setVelocityY(-(this.mechanics.jumpForce || 600));
    }

    // Shield activation
    if (Phaser.Input.Keyboard.JustDown(this.spaceKey)) {
      this.activateShield();
    }

    // Animation
    if (Math.abs(this.player.body.velocity.x) > 0) {
      this.player.play('walk', true);
      this.player.setFlipX(this.player.body.velocity.x < 0);
    } else {
      this.player.play('idle', true);
    }

    // keep the shield visual glued to the player
    if (this.isShieldActive && this.shieldSprite) {
      this.shieldSprite.setPosition(
        this.player.x + (this.player.flipX ? -50 : 50),
        this.player.y - 20
      );
    }

    // Clean up fireballs
    this.fireballs.children.iterate(fb => {
      if (fb && fb.active && (fb.y > 1180 || fb.x < this.player.x - 1000)) {
        fb.destroy();
      }
      return true;
    });

    // Ground overlap check
    this.playerOnGround = false;
    this.physics.world.overlap(this.player, this.clouds, () => {
      this.playerOnGround = true;
    });

    // Fell off map
    if (this.player.y > 1180) {
      this.endGame();
    }
  }

  showLevelComplete() {
    this.physics.pause();
    const centerX = this.sys.cameras.main.scrollX + this.sys.cameras.main.width / 2;
    const centerY = this.sys.cameras.main.height / 2;

    // Clear all cloud timers
    this.cloudTimers.forEach((timer, cloud) => {
      timer.remove();
      this.cloudTimers.delete(cloud);
    });

    // Clear physics groups
    this.fireballs.clear(true, true);
    this.clouds.clear(true, true);
    this.gems.clear(true, true);

    // Destroy key, door, and player
    if (this.key) this.key.destroy();
    if (this.door) this.door.destroy();
    if (this.player) this.player.destroy();
    if (this.sun) this.sun.destroy();

    const overlay = this.add.container(centerX, centerY);
    const bg = this.add.image(0, -70, 'level_complete').setDepth(25);
    // const title = this.add.text(-20, 3, 'Level Complete', {
    //     font: "bold 70px Arial",
    //     color: '#fff'
    // }).setOrigin(0.5);

    const replayBtn = this.add.image(-230, 150, 'replay')
      .setInteractive()
      .setScale(1)
      .setDepth(46);


    const nextBtn = this.add.image(230, 150, 'next')
      .setInteractive().setDepth(46);

    replayBtn.on('pointerdown', () => {
      this.scene.restart();
    });

    nextBtn.on('pointerdown', () => {
      // this.scene.restart();
      this.notifyParent('sceneComplete', { result: 'win' });
      console.log('sceneComplete');
    });

    overlay.add([bg, replayBtn, nextBtn]);
  }

  notifyParent(type, data) {
    if (window.parent !== window) {
      window.parent.postMessage({ type, ...data }, "*");
    }
  }


}