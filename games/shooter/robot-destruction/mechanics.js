export const SCREEN_WIDTH = 1920;
export const SCREEN_HEIGHT = 1080;

export default class GamePlayScene extends Phaser.Scene {
  constructor() {
    super('GamePlayScene');
  }

  preload() {
    // Determine base path for assets
    const basePath = import.meta.url.substring(
      0,
      import.meta.url.lastIndexOf('/')
    );

    // Load JSON config
    const cfg = this.load.json('levelConfig', `${basePath}/config.json`);

    this.load.once('filecomplete-json-levelConfig', () => {
      const cfg = this.cache.json.get('levelConfig');

      // Load hero spritesheet
      const sheets = cfg.sheets || {};
      const heroData = sheets.hero || {};
      const rawMain = new URLSearchParams(window.location.search).get('main') || '';
      const cleanMain = rawMain.replace(/^"|"$/g, '');
      const sheetUrl =
        cleanMain ||
        heroData.url ||
        `${basePath}/assets/hero.png`;

      const frameW = heroData.frameWidth || 103;
      const frameH = heroData.frameHeight || 142;
      this.load.spritesheet('hero', sheetUrl, {
        frameWidth: frameW,
        frameHeight: frameH,
      });

      // Other spritesheets
      if (cfg.spritesheets) {
        for (const [key, sheet] of Object.entries(cfg.spritesheets)) {
          this.load.spritesheet(key, sheet.path, {
            frameWidth: sheet.frameWidth,
            frameHeight: sheet.frameHeight,
          });
        }
      }

      if (cfg.images1) {
        for (const [key, url] of Object.entries(cfg.images1)) {
          this.load.image(key, `${basePath}/${url}`);
        }
      }
      if (cfg.images2) {
        for (const [key, url] of Object.entries(cfg.images2)) {
          this.load.image(key, `${basePath}/${url}`);
        }
      }

      if (cfg.ui) {
        for (const [key, url] of Object.entries(cfg.ui)) {
          this.load.image(key, `${basePath}/${url}`);
        }
      }

      if (cfg.audio) {
        for (const [key, url] of Object.entries(cfg.audio)) {
          if (!url) continue;

          let finalUrl = url;

          // If it's NOT an absolute URL, prefix basePath
          if (!/^https?:\/\//i.test(url) && !url.startsWith('//')) {
            finalUrl = `${basePath}/${url}`;
          }

          this.load.audio(key, finalUrl);
        }
      }


      // Start loading
      this.load.start();
    });
  }

  create() {
    // Lock screen orientation to landscape
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation
        .lock('landscape-primary')
        .catch(err => console.warn('Orientation lock failed:', err));
    }

    // Set up physics world and pause it initially
    this.physics.world.setBounds(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    this.physics.pause();

    this.mechanics = this.cache.json.get('levelConfig').mechanics || {};
    this.playerSpeed = this.mechanics.playerSpeed || 300;
    this.jumpForce = this.mechanics.jumpForce || 780;
    this.deactivationTime = this.mechanics.deactivationTime || 3;
    this.bulletDamage = this.mechanics.bulletDamage || 50;


    // Background (visible during HTP screen and game)
    this.add.image(960, 540, 'background');
    this.timerSound = this.sound.add('timer', { loop: true });

    // Create overlay to dim the background
    this.overlay = this.add.rectangle(960, 540, SCREEN_WIDTH, SCREEN_HEIGHT, 0x000000, 0.7)
      .setDepth(10);

    // Create HTP box
    this.htpBox = this.add.image(960, 500, 'htpbox')
      .setOrigin(0.5)
      .setDepth(11);

    // Create Play button
    this.playBtn = this.add.image(960, 880, 'playbtn')
      .setOrigin(0.5)
      .setInteractive()
      .setDepth(11);

    this.htptxt = this.add.text(700, 310, 'How to Play', {
      fontSize: 'bold 70px',
      fontFamily: 'outfit',
      backgroundColor: '#0D0D0D',
      color: '#ffffff'
    }).setDepth(12);

    this.htptxt1 = this.add.text(610, 480, 'Dodge bullets fired by the\nrobots and deactivate\nthem from behind.', {
      fontSize: '60px',
      fontFamily: 'outfit',
      lineSpacing: 8,
      backgroundColor: '#0D0D0D',
      color: '#ffffff'
    }).setDepth(12);

    // Handle Play button click
    this.playBtn.on('pointerdown', () => {
      // Attempt to go fullscreen
      if (this.scale.fullscreen.available && !this.scale.isFullscreen) {
        this.scale.startFullscreen();
      }
      this.bgm = this.sound.add('bgm', { loop: true });
      this.bgm.play();

      // Destroy HTP elements
      this.overlay.destroy();
      this.htpBox.destroy();
      this.htptxt.destroy();
      this.htptxt1.destroy();
      this.playBtn.destroy();

      // Start the game
      startGame(this);

      // Resume physics
      this.physics.resume();
    });
  }

  update() {
    if (!this.hero || !this.hero.active) {
      return;
    }

    const speed = this.playerSpeed;

    let direction = 0;

    // Keyboard support
    if (this.cursors.left.isDown) direction -= 1;
    if (this.cursors.right.isDown) direction += 1;

    // Joystick support
    if (this.joystickActive) direction += this.joystickDirection;

    // Horizontal movement
    if (direction < -0.3) {
      this.hero.setVelocityX(-speed);
      this.hero.setFlipX(true);
      this.hero.anims.play('walk', true);
    } else if (direction > 0.3) {
      this.hero.setVelocityX(speed);
      this.hero.setFlipX(false);
      this.hero.anims.play('walk', true);
    } else {
      this.hero.setVelocityX(0);
      this.hero.anims.stop();
    }

    // Jumping
    if ((this.cursors.up.isDown || this.isJumpPressed) && this.hero.body.touching.down) {
      this.hero.setVelocityY(-this.jumpForce);
    }

    // Move hero with platform if standing on it
    if (this.hero.standingPlatform) {
      const platform = this.hero.standingPlatform;
      const prevX = platform.prevX || platform.x;
      const deltaX = platform.x - prevX;
      this.hero.x += deltaX;
      platform.prevX = platform.x;
    }

    // Enemy defuse logic
    this.enemies.getChildren().forEach(enemy => {
      if (!enemy.isDeactivated) {
        let isCollidingThisFrame = false;

        // Check if hero is touching the enemy and from the right
        if (Phaser.Geom.Intersects.RectangleToRectangle(this.hero.body, enemy.body)) {
          const heroIsFromRight = this.hero.x > enemy.x;
          if (heroIsFromRight) {
            isCollidingThisFrame = true;
          }
        }

        if (isCollidingThisFrame && enemy.isDefusing) {
          enemy.isColliding = true;
          enemy.deactivationText.setPosition(enemy.x, enemy.y - 140);
          enemy.deactivationTextBg.setPosition(enemy.x, enemy.y - 140);
          enemy.defuseBar.setPosition(enemy.x, enemy.y - 30);

          // Start timer sound if not playing
          if (!this.timerSound.isPlaying) {
            this.timerSound.play({ volume: 1.5 });
            this.bgm.setVolume(0.35); // Pause background music while timer is active
          }

          // Start blinking if not already
          if (!enemy.blinkTween) {
            enemy.blinkTween = this.tweens.add({
              targets: enemy,
              alpha: { from: 1, to: 0.3 },
              duration: 300,
              yoyo: true,
              repeat: -1
            });
          }

          // Update defuse progress
          const deltaTime = this.game.loop.delta / 1000;
          enemy.defuseProgress = (enemy.defuseProgress || 0) + deltaTime;

          const remainingTime = Math.max(0, this.deactivationTime - enemy.defuseProgress);
          if (remainingTime <= 0) {
            deactivateEnemy(this, enemy);
            this.timerSound.stop();
            this.bgm.setVolume(1);
          } else {
            const displayTime = isNaN(remainingTime) ? this.deactivationTime : Math.ceil(remainingTime);
            enemy.deactivationText.setText(`Deactivating in: ${displayTime}`);
            enemy.defuseBar.setScale(remainingTime / this.deactivationTime, 1);

            const progressRatio = enemy.defuseProgress / this.deactivationTime;
            const r = Math.round(progressRatio * 255);
            const g = Math.round((1 - progressRatio) * 255);
            const color = (r << 16) + (g << 8);
            enemy.defuseBar.setFillStyle(color);
          }

        } else if (enemy.isColliding || enemy.isDefusing) {
          // Cancel defusing
          enemy.isColliding = false;
          enemy.isDefusing = false;
          enemy.defuseBar.setVisible(false);
          enemy.deactivationText.setVisible(false);
          enemy.deactivationTextBg.setVisible(false);
          enemy.defuseProgress = 0;

          // Stop timer sound
          this.timerSound.stop();

          // Stop blinking
          if (enemy.blinkTween) {
            enemy.blinkTween.stop();
            enemy.blinkTween = null;
            enemy.setAlpha(1);
          }
        }
      }
    });
  }
}

function startGame(scene) {
  const levelData = scene.cache.json.get('levelConfig');
  scene.levelData = levelData;

  scene.input.addPointer(2);

  // Create touch buttons
  const jumpbtn = scene.add.image(1680, 850, 'jump').setScale(0.8).setInteractive();

  // Initialize input states for touch controls
  scene.isJumpPressed = false;

  // Handle touch events for buttons
  jumpbtn.on('pointerdown', () => {
    scene.isJumpPressed = true;
  });
  jumpbtn.on('pointerup', () => {
    scene.isJumpPressed = false;
  });
  jumpbtn.on('pointerout', () => {
    scene.isJumpPressed = false;
  });

  // Joystick base and thumb
  scene.joystickBase = scene.add.circle(150, 850, 120, "black", 0.65).setScrollFactor(0).setDepth(8);
  scene.joystickThumb = scene.add.circle(150, 850, 40, 0xcccccc, 1).setScrollFactor(0).setDepth(9);
  scene.circle = scene.add.circle(150, 850, 70, 0xcccccc, 0.8).setScrollFactor(0).setDepth(10);
  scene.joystickActive = false;
  scene.joystickDirection = 0;

  // Drag events
  scene.joystickThumb.setInteractive({
    draggable: true,
    hitArea: new Phaser.Geom.Circle(0, 0, 700), // Increased hit area radius
    hitAreaCallback: Phaser.Geom.Circle.Contains
  });
  scene.input.setDraggable(scene.joystickThumb);

  scene.input.on('dragstart', (pointer, gameObject) => {
    scene.joystickActive = true;
  });

  scene.input.on('drag', (pointer, gameObject, dragX, dragY) => {
    const dx = dragX - scene.joystickBase.x;
    const dy = dragY - scene.joystickBase.y;
    const distance = Math.min(Math.sqrt(dx * dx + dy * dy), 50);
    const angle = Math.atan2(dy, dx);

    const newX = scene.joystickBase.x + distance * Math.cos(angle);
    const newY = scene.joystickBase.y + distance * Math.sin(angle);
    scene.joystickThumb.setPosition(newX, newY);

    scene.joystickDirection = Math.cos(angle); // -1 to 1
  });

  scene.input.on('dragend', () => {
    scene.joystickThumb.setPosition(scene.joystickBase.x, scene.joystickBase.y);
    scene.joystickActive = false;
    scene.joystickDirection = 0;
  });

  // Create platforms group
  scene.platforms = scene.physics.add.staticGroup();
  scene.platforms.add(scene.add.image(800, 1080, 'platform').setScale(8, 1));
  scene.platforms.add(scene.add.image(700, 530, 'platform'));
  scene.platforms.add(scene.add.image(70, 750, 'platform'));
  scene.platforms.add(scene.add.image(1400, 350, 'platform'));
  scene.platforms.add(scene.add.image(1834, 600, 'platform').setScale(0.5, 1));

  // Moving platforms
  const platform1 = scene.physics.add.staticImage(1500, 850, 'platform').setScale(0.5, 1);
  const platform2 = scene.physics.add.staticImage(1100, 750, 'platform').setScale(0.5, 1);
  scene.platforms.add(platform1);
  scene.platforms.add(platform2);


  // Add tweens for moving platforms
  scene.tweens.add({
    targets: platform1,
    x: { from: 1500, to: 1400 },
    duration: 3000,
    yoyo: true,
    repeat: -1,
    ease: 'Sine.easeInOut',
    onUpdate: () => {
      platform1.refreshBody();
    }
  });

  scene.tweens.add({
    targets: platform2,
    x: { from: 1100, to: 1200 },
    duration: 3000,
    yoyo: true,
    repeat: -1,
    ease: 'Sine.easeInOut',
    onUpdate: () => {
      platform2.refreshBody();
    }
  });


  // Hero setup
  scene.hero = scene.physics.add.sprite(140, 500, 'hero').setScale(1.25);
  scene.hero.setBounce(0.2);
  scene.hero.setCollideWorldBounds(true);
  scene.hero.hp = 200; // Initialize hero HP
  scene.hero.setOffset(50, 1);
  scene.hero.setSize(50, 130); // Set hero size for better collision detection
  scene.hero.standingPlatform = null; // Track platform hero is standing on

  // Hero HP image
  scene.hpImage = scene.add.image(320, 70, 'hp1').setOrigin(0.5).setScrollFactor(0);

  // Enemies setup
  scene.enemies = scene.physics.add.staticGroup();
  scene.enemies.add(scene.add.image(650, 420, 'enemy').setScale(1));
  scene.enemies.add(scene.add.image(750, 980, 'enemy').setScale(1));
  scene.enemies.add(scene.add.image(1380, 250, 'enemy').setScale(1));
  scene.enemies.getChildren().forEach(enemy => {
    enemy.isDeactivated = false;
    enemy.isDefusing = false;
    enemy.isColliding = false; // Track active collision
    enemy.defuseBar = scene.add.rectangle(enemy.x, enemy.y - 30, 25, 5, 0x00ff00);
    enemy.defuseBar.setVisible(false);
    enemy.defuseProgress = 0;
    // Create background box for deactivation text
    enemy.deactivationTextBg = scene.add.image(enemy.x, enemy.y - 140, 'box')
      .setOrigin(0.5)
      .setVisible(false);
    enemy.deactivationText = scene.add.text(enemy.x, enemy.y - 140, 'Deactivating in: <b>3</b>', {
      fontSize: '30px',
      fontFamily: 'outfit',
      color: 'black',
      backgroundColor: '#C0BDB9',
      align: 'center'
    }).setOrigin(0.5).setVisible(false);
  });

  // Bullets group
  scene.bullets = scene.physics.add.group({
    maxSize: 100,
    allowGravity: false
  });

  // Animations
  scene.anims.create({
    key: 'walk',
    frames: scene.anims.generateFrameNumbers('hero', { start: 0, end: 5 }),
    frameRate: 10,
    repeat: -1
  });

  // Keyboard controls
  scene.cursors = scene.input.keyboard.createCursorKeys();

  // Collisions
  scene.physics.add.collider(scene.hero, scene.platforms, (hero, platform) => {
    // Check if hero is standing on the platform (touching down)
    if (hero.body.touching.down && platform.body.touching.up) {
      hero.standingPlatform = platform;
      platform.prevX = platform.x; // Store initial x position
    }
  }, null, scene);

  // Clear standing platform when hero leaves it
  scene.physics.world.on('worldstep', () => {
    if (scene.hero && scene.hero.body && scene.hero.standingPlatform && !scene.hero.body.touching.down) {
      scene.hero.standingPlatform = null;
    }
  });

  scene.physics.add.collider(scene.hero, scene.enemies, (hero, enemy) => {
    if (!enemy.isDeactivated) {
      // Check if hero is colliding from the right side
      const heroIsFromRight = hero.x > enemy.x;

      if (heroIsFromRight) {
        enemy.isColliding = true;
        enemy.isDefusing = true;
        enemy.defuseBar.setVisible(true);
        enemy.deactivationText.setVisible(true);
        enemy.deactivationTextBg.setVisible(true);
        if (enemy.defuseProgress === undefined) {
          enemy.defuseProgress = 0;
        }
      }
    }
  }, null, scene);

  scene.physics.add.collider(scene.hero, scene.bullets, (hero, bullet) => handleHeroBulletCollision(scene, hero, bullet), null, scene);

  // Enemy bullet firing timer
  scene.bulletTimer = scene.time.addEvent({
    delay: 1000,
    callback: () => {
      scene.enemies.getChildren().forEach(enemy => {
        if (!enemy.isDeactivated) {
          fireBullet(scene, enemy);
        }
      });
    },
    callbackScope: scene,
    loop: true
  });
}

function fireBullet(scene, enemy) {
  const bullet = scene.bullets.create(enemy.x, enemy.y, 'round_bullet')
  if (bullet) {
    bullet.setScale(0.051);
    const angle = Phaser.Math.Between(0, 360);
    const speed = 400;
    scene.physics.velocityFromAngle(angle, speed, bullet.body.velocity);
    scene.sound.play('gun', { volume: 0.5 });
  }
}

function deactivateEnemy(scene, enemy) {
  enemy.isDeactivated = true;
  enemy.setTexture('enemy').setAngle(-80);
  enemy.defuseBar.setVisible(false);
  enemy.deactivationText.setText('Enemy deactivated!');
  enemy.deactivationText.setVisible(true);
  enemy.deactivationTextBg.setVisible(true);
  enemy.isDefusing = false;
  enemy.isColliding = false;
  enemy.defuseProgress = 0;

  // Stop blinking
  if (enemy.blinkTween) {
    enemy.blinkTween.stop();
    enemy.blinkTween = null;
    enemy.setAlpha(1); // Reset to full opacity
  }

  scene.time.delayedCall(2000, () => {
    enemy.deactivationText.setVisible(false);
    enemy.deactivationTextBg.setVisible(false);
  });

  if (scene.enemies.getChildren().every(e => e.isDeactivated)) {
    win(scene);
  }
}

function notifyParent(type, data) {
  if (window.parent !== window) {
    window.parent.postMessage({ type, ...data }, "*");
  }
}

function handleHeroBulletCollision(scene, hero, bullet) {
  bullet.destroy();
  hero.hp -= scene.bulletDamage;
  // Decrease HP by 50 per bullet hit

  // Attempt to vibrate the device
  if (navigator.vibrate) {
    const success = navigator.vibrate(200); // Vibrate for 200ms
    console.log('Vibration attempted, supported:', success);
  } else {
    console.log('Vibration API not supported, using screen shake fallback');
  }
  // Screen shake effect
  scene.cameras.main.shake(200, 0.01); // 200ms shake with low intensity

  // Update HP image based on current HP
  if (hero.hp === 200) {
    scene.hpImage.setTexture('hp1');
  } else if (hero.hp === 150) {
    scene.hpImage.setTexture('hp2');
  } else if (hero.hp === 100) {
    scene.hpImage.setTexture('hp3');
  } else if (hero.hp === 50) {
    scene.hpImage.setTexture('hp4');
  } else if (hero.hp <= 0) {
    hero.hp = 0;
    hero.destroy();
    scene.time.delayedCall(500, () => {
      gameovr(scene);
    });
  }
}

function win(scene) {
  // Pause physics to stop game interactions
  scene.physics.pause();
  if (scene.bgm) {
    scene.bgm.stop();
  }

  // Create overlay to dim the background
  const overlay = scene.add.rectangle(960, 540, SCREEN_WIDTH, SCREEN_HEIGHT, 0x000000, 0.7)
    .setDepth(10);

  // Create level complete box
  const lvlbox = scene.add.image(960, 500, 'lvlbox')
    .setOrigin(0.5)
    .setDepth(11);

  // Create level complete text
  const lvltxt = scene.add.text(680, 460, 'Level Completed!', {
    fontSize: 'bold 70px',
    fontFamily: 'outfit',
    backgroundColor: '#0D0D0D',
    color: '#ffffff'
  }).setDepth(12);

  // Create Next button
  const nextbtn = scene.add.image(1200, 730, 'nextbtn')
    .setOrigin(0.5)
    .setInteractive()
    .setDepth(11);

  // Handle Next button click
  nextbtn.on('pointerdown', () => {
    overlay.destroy();
    lvlbox.destroy();
    lvltxt.destroy();
    nextbtn.destroy();
    restart.destroy();
    notifyParent('sceneComplete', { result: 'win' });
  });

  // Create Restart button
  const restart = scene.add.image(740, 730, 'restart')
    .setOrigin(0.5)
    .setInteractive()
    .setDepth(11);

  // Handle Restart button click
  restart.on('pointerdown', () => {
    overlay.destroy();
    lvlbox.destroy();
    lvltxt.destroy();
    nextbtn.destroy();
    restart.destroy();
    scene.scene.restart();
  });
}

function gameovr(scene) {
  // Pause physics to stop game interactions
  scene.physics.pause();
  if (scene.bgm) {
    scene.bgm.stop();
  }

  if (scene.timerSound) {
    scene.timerSound.stop();
  }

  scene.sound.stopByKey('gun');
  if (scene.bulletTimer) {
    scene.bulletTimer.remove();
  }
  // Create overlay to dim the background
  const overlay = scene.add.rectangle(960, 540, SCREEN_WIDTH, SCREEN_HEIGHT, 0x000000, 0.7)
    .setDepth(10);

  // Create game over box
  const gameovrbg = scene.add.image(960, 440, 'gameovrbg')
    .setOrigin(0.5)
    .setDepth(11);

  // Create game over text
  const lvltxt = scene.add.text(800, 400, 'Game Over', {
    fontSize: 'bold 70px',
    fontFamily: 'outfit',
    backgroundColor: '#0D0D0D',
    color: '#ffffff'
  }).setDepth(12);

  // Create Restart button
  const restart = scene.add.image(960, 660, 'restart1')
    .setOrigin(0.5)
    .setInteractive()
    .setDepth(11);

  // Handle Restart button click
  restart.on('pointerdown', () => {
    overlay.destroy();
    gameovrbg.destroy();
    lvltxt.destroy();
    restart.destroy();
    scene.scene.restart();
  });
}