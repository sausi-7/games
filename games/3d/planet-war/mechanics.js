export const SCREEN_WIDTH = 1920;
export const SCREEN_HEIGHT = 1080;

export default class GamePlayScene extends Phaser.Scene {
  constructor() {
    super('GamePlayScene');
  }

  preload() {
    const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));

    // Allow CORS for remote assets (audio/images served from https)
    if (this.load.setCORS) this.load.setCORS('anonymous');

    // helper: detect absolute URLs
    const isAbsolute = (p) => /^https?:\/\//i.test(p);

    // 1) load config first
    this.load.json('levelConfig', `${basePath}/config.json`);

    // 2) when config is in cache, queue the rest and START the second batch
    this.load.once('filecomplete-json-levelConfig', () => {
      const cfg = this.cache.json.get('levelConfig') || {};

      const images1 = cfg.images1 || {};
      const images2 = cfg.images2 || {};
      const ui = cfg.ui || {};
      const audio = cfg.audio || {};

      // --- IMAGES (with absolute-url support) ---
      const loadImgMap = (map) => {
        for (const [key, urlIn] of Object.entries(map)) {
          const url = isAbsolute(urlIn) ? urlIn : `${basePath}/${urlIn}`;
          this.load.image(key, url);
        }
      };

      loadImgMap(images1);
      loadImgMap(images2);
      loadImgMap(ui);

      // Ensure 'player' exists (fallback)
      if (!images1.player) {
        this.load.image('player', `${basePath}/assets/player.png`);
      }

      // Spritesheets if any (unchanged)
      if (cfg.spritesheets) {
        for (const [key, sheet] of Object.entries(cfg.spritesheets)) {
          const path = isAbsolute(sheet.path) ? sheet.path : `${basePath}/${sheet.path}`;
          this.load.spritesheet(key, path, {
            frameWidth: sheet.frameWidth,
            frameHeight: sheet.frameHeight,
          });
        }
      }

      // --- AUDIO (string or array; absolute-url support) ---
      for (const [key, val] of Object.entries(audio)) {
        if (Array.isArray(val)) {
          const urls = val.map((u) => (isAbsolute(u) ? u : `${basePath}/${u}`));
          this.load.audio(key, urls);
        } else {
          const url = isAbsolute(val) ? val : `${basePath}/${val}`;
          this.load.audio(key, url);
        }
      }

      // IMPORTANT: kick off this second batch
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

    // --- BGM: detect the configured key and add only if it's cached ---
    const audioCfg = (this.cache.json.get('levelConfig') || {}).audio || {};
    // prefer 'bgm' if present, else pick the first audio entry (if any)
    const bgmKey = audioCfg.bgm ? 'bgm' : Object.keys(audioCfg)[0];

    if (bgmKey && this.cache.audio && this.cache.audio.exists(bgmKey)) {
      const existing = this.sound.get(bgmKey);
      this.bgm = existing || this.sound.add(bgmKey, { loop: true, volume: 1 });

      if (!this.bgm.isPlaying) {
        if (this.sound.locked) {
          this.sound.once(Phaser.Sound.Events.UNLOCKED, () => {
            if (this.bgm && !this.bgm.isPlaying) this.bgm.play({ seek: 0 });
          });
        } else {
          this.bgm.play({ seek: 0 });
        }
      }
    } else {
      console.warn('BGM missing from cache or not configured. audio keys:', Object.keys(audioCfg));
    }


    this.mechanics = this.cache.json.get('levelConfig').mechanics || {};
    this.playerSpeed = this.mechanics.playerSpeed || 300;
    this.jumpForce = this.mechanics.jumpForce || 780;
    this.bulletDamage = this.mechanics.bulletDamage || 50;

    this.heroMaxHP = this.mechanics.heroHP ?? 200; // from JSON (fallback 200)
    this.enemyMaxHP = this.mechanics.enemyHP ?? 5;   // from JSON (fallback 5)

    // Background (visible during HTP screen and game)
    this.bg = this.add.image(960, 540, this.textures.exists('htpbg') ? 'htpbg' : 'background');

    const cfg = this.cache.json.get('levelConfig');
    const texts = (cfg && cfg.texts) || {};
    this.texts = texts;

    // Create HTP box
    this.htpBox = this.add.image(960, 500, 'htpbox')
      .setScale(0.6, 0.8)
      .setOrigin(0.5)
      .setDepth(11);

    // Create Play button
    this.playBtn = this.add.image(960, 950, 'playbtn')
      .setOrigin(0.5)
      .setInteractive()
      .setDepth(11);

    this.htptxt = this.add.text(780, 180, texts.howToPlayTitle || 'How to Play', {
      fontSize: 'bold 70px',
      fontFamily: 'outfit',
      color: '#ffffff'
    }).setDepth(12);

    // --- CHANGED: use 'player' image in HTP preview instead of 'hero' spritesheet ---
    this.hero1 = this.add.image(838, 350, 'player').setScale(1.3).setDepth(100);
    // -------------------------------------------------------------------------------

    this.bullet1 = this.add.image(800, 520, 'bullet').setScale(2).setDepth(100);
    this.enemy1 = this.add.image(850, 700, 'enemy').setScale(0.7).setDepth(100);

    this.htptxt1 = this.add.text(500, 320, texts.howToPlayBody || 'Shoot, block attacks, dodge\nrockets, and take down the\nrobots to clear the level.', {
      fontSize: '60px',
      fontFamily: 'outfit',
      lineSpacing: 8,
      color: '#ffffff'
    }).setDepth(12);

    this.htptxt2 = this.add.text(500, 490, 'Avoid:', {
      fontSize: '60px',
      fontFamily: 'outfit',
      lineSpacing: 8,
      color: '#ffffff'
    }).setDepth(12);

    this.htptxt3 = this.add.text(500, 660, 'Destroy:', {
      fontSize: '60px',
      fontFamily: 'outfit',
      lineSpacing: 8,
      color: '#ffffff'
    }).setDepth(12);

    // Handle Play button click
    this.playBtn.on('pointerdown', () => {
      // Destroy HTP elements
      this.htpBox.destroy();
      this.htptxt.destroy();
      this.bullet1.destroy();
      this.enemy1.destroy();
      this.hero1.destroy();
      this.htptxt1.destroy();
      this.htptxt2.destroy();
      this.htptxt3.destroy();
      this.playBtn.destroy();

      // Swap background to the in-game background
      if (this.textures.exists('background')) {
        this.bg.setTexture('background');
      }

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

    this.heroBullets.getChildren().forEach(bullet => {
      if (bullet.lifespan && this.time.now > bullet.lifespan) bullet.destroy();
    });

    this.bullets.getChildren().forEach(bullet => {
      if (bullet.lifespan && this.time.now > bullet.lifespan) bullet.destroy();
    });

    const speed = this.playerSpeed;
    let direction = 0;

    // Keyboard support
    if (this.cursors.left.isDown) direction -= 1;
    if (this.cursors.right.isDown) direction += 1;

    // Joystick support
    if (this.joystickActive) direction += this.joystickDirection;

    // Home-in bullets
    if (this.hero && this.hero.active) {
      this.bullets.getChildren().forEach(bullet => {
        if (bullet.homing && bullet.active) {
          this.physics.moveToObject(bullet, this.hero, bullet.speed);
        }
      });
    }

    // --- CHANGED: no animations; just move and flip the static 'player' sprite ---
    if (direction < -0.3) {
      this.hero.setVelocityX(-speed);
      this.hero.setFlipX(true);
    } else if (direction > 0.3) {
      this.hero.setVelocityX(speed);
      this.hero.setFlipX(false);
    } else {
      this.hero.setVelocityX(0);
    }
    // ------------------------------------------------------------------------------

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

    if (this.shieldActive && this.shieldSprite && this.hero && this.hero.active) {
      this.shieldSprite.x = this.hero.x;
      this.shieldSprite.y = this.hero.y - 60;
    }

    this.enemies.getChildren().forEach(enemy => {
      if (!this.hero) return;
      if (enemy.x < this.hero.x) {
        enemy.flipX = true; // face right if player is right of enemy
      } else {
        enemy.flipX = false;  // face left if player is left of enemy
      }
    });

    if (this.shieldBtnHeld && this.shieldAvailable) {
      resumeShield(this);
    } else {
      pauseShield(this);
    }
  }
}

function startGame(scene) {
  const levelData = scene.cache.json.get('levelConfig');
  scene.levelData = levelData;
  scene.shieldBtnHeld = false;

  scene.input.addPointer(2);

  scene.heroBullets = scene.physics.add.group({
    maxSize: 50,
    allowGravity: false
  });
  scene.shieldAvailable = true; // at the very start of the game

  // Create touch buttons
  const jumpbtn = scene.add.image(1680, 700, 'jump').setScale(0.6).setInteractive();

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
  scene.shieldAvailable = true;
  scene.shieldHealth = scene.shieldHealthMax;

  // Drag events
  scene.joystickThumb.setInteractive({
    draggable: true,
    hitArea: new Phaser.Geom.Circle(0, 0, 700),
    hitAreaCallback: Phaser.Geom.Circle.Contains
  });
  scene.input.setDraggable(scene.joystickThumb);

  scene.input.on('dragstart', () => {
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

  const firebtn = scene.add.image(1680, 900, 'firebtn').setScale(0.85).setInteractive().setScrollFactor(0).setScale(0.7);
  firebtn.on('pointerdown', () => {
    fireHeroBullet(scene);
  });

  scene.shieldUsed = false;

  // Shield state variables
  scene.shieldActive = false;
  scene.shieldPaused = false;
  scene.shieldHealthMax = 7;
  scene.shieldHealth = scene.shieldHealthMax;

  scene.shieldHealthImg = null;
  scene.shieldTimer = null;

  const shieldBtn = scene.add.image(1450, 900, 'shieldbtn').setScale(0.85).setInteractive().setScrollFactor(0);

  shieldBtn.on('pointerdown', () => {
    scene.shieldBtnHeld = true;
  });

  shieldBtn.on('pointerup', () => {
    scene.shieldBtnHeld = false;
    pauseShield(scene);
  });

  shieldBtn.on('pointerout', () => {
    scene.shieldBtnHeld = false;
    pauseShield(scene);
  });

  // --- CHANGED: create hero as a single-frame physics sprite using 'player' texture ---
  scene.hero = scene.physics.add.sprite(140, 500, 'player').setScale(1.25);
  // -----------------------------------------------------------------------------------
  scene.hero.setBounce(0.2);
  scene.hero.setCollideWorldBounds(true);
  scene.hero.hp = scene.heroMaxHP; // Initialize hero HP
  scene.hero.setOffset(50, 1);
  scene.hero.setSize(50, 130);
  scene.hero.standingPlatform = null;

  // Hero HP image
  scene.hpImage = scene.add.image(320, 70, 'hp1').setOrigin(0.5).setScrollFactor(0);

  // Enemies setup
  scene.enemies = scene.physics.add.staticGroup();
  scene.enemies.add(scene.add.image(650, 420, 'enemy').setScale(1));
  scene.enemies.add(scene.add.image(750, 980, 'enemy').setScale(1));
  scene.enemies.add(scene.add.image(1380, 250, 'enemy').setScale(1));

  scene.enemies.getChildren().forEach(enemy => {
    enemy.hp = 5;
  });
  scene.enemies.getChildren().forEach(enemy => {
    scene.tweens.add({
      targets: enemy,
      scale: { from: 1, to: 1.05 },
      duration: 600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });
  });

  // Bullets group
  scene.bullets = scene.physics.add.group({
    maxSize: 100,
    allowGravity: false
  });

  // --- CHANGED: remove walk animation creation entirely (no spritesheet frames) ---

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

  scene.physics.add.overlap(scene.heroBullets, scene.enemies, (bullet, enemy) => {
    bullet.destroy();
    enemy.hp -= 1;
    enemy.setTint(0xff0000);
    scene.time.delayedCall(100, () => enemy.clearTint());
    if (enemy.hp <= 0) {
      const explosionKey = Phaser.Math.Between(0, 1) ? 'e1' : 'e2';
      const explosion = scene.add.image(enemy.x, enemy.y, explosionKey).setDepth(99);

      scene.sound.play('destroy', { loop: false });
      scene.time.delayedCall(500, () => explosion.destroy());
      enemy.destroy();

      // Win if all destroyed
      if (scene.enemies.countActive(true) === 0) {
        win(scene);
      }
    }
  });

  scene.physics.add.collider(scene.hero, scene.enemies); // Normal physics bounce
  scene.physics.add.collider(scene.hero, scene.bullets, (hero, bullet) => handleHeroBulletCollision(scene, hero, bullet), null, scene);

  scene.enemies.getChildren().forEach((enemy, idx) => {
    enemy.hp = scene.enemyMaxHP;
    let delays = [2000, 2200, 2300];
    let delay = delays[idx % delays.length];

    enemy.bulletTimer = scene.time.addEvent({
      delay: delay,
      loop: true,
      callback: () => {
        if (enemy.active) {
          fireBullet(scene, enemy);
        }
      }
    });
  });

  if (scene.shieldHealthImg) scene.shieldHealthImg.destroy();
  scene.shieldHealthImg = scene.add.image(1600, 70, 's7')
    .setOrigin(0.5)
    .setScale(1)
    .setScrollFactor(0)
    .setDepth(30);
}

function pauseShield(scene) {
  if (scene.bgm && scene.bgm.isPlaying) {
    scene.bgm.setVolume(1);
  }
  if (scene.shieldSound && scene.shieldSound.isPlaying) {
    scene.shieldSound.stop();
  }
  if (!scene.shieldActive) return;
  scene.shieldActive = false;
  scene.shieldPaused = true;
  if (scene.shieldSprite) scene.shieldSprite.destroy();
  scene.shieldSprite = null;
}

function resumeShield(scene) {
  if (!scene.shieldAvailable) return;
  if (scene.shieldHealth <= 0) return;
  if (scene.shieldActive) return;
  if (scene.bgm && scene.bgm.isPlaying) {
    scene.bgm.setVolume(0.2);
  }
  if (!scene.shieldSound || !scene.shieldSound.isPlaying) {
    scene.shieldSound = scene.sound.add('shield', { loop: true });
    scene.shieldSound.play();
  }

  if (scene.shieldDepleteImg) scene.shieldDepleteImg.setVisible(false);

  scene.shieldActive = true;
  scene.shieldPaused = false;

  if (scene.shieldHealthImg) {
    scene.shieldHealthImg.setTexture('s' + scene.shieldHealth);
    scene.shieldHealthImg.setVisible(true);
  }

  if (scene.shieldHealth === 7) {
    scene.shieldHealth = 6;
    scene.shieldHealthImg.setTexture('s6');
  }

  if (!scene.shieldSprite && scene.hero && scene.hero.active) {
    scene.shieldSprite = scene.physics.add.image(scene.hero.x, scene.hero.y - 60, 'shield')
      .setScale(1.3)
      .setDepth(10)
      .setImmovable(true)
      .setAlpha(1);

    if (scene.shieldSprite.body.setCircle) {
      scene.shieldSprite.body.setCircle(70);
    }
    scene.shieldSprite.body.allowGravity = false;

    scene.physics.add.overlap(
      scene.shieldSprite,
      scene.bullets,
      (shield, bullet) => {
        // explosion, destroy, shake...
      },
      null,
      scene
    );
  }

  if (!scene.shieldTimer) {
    scene.shieldTimer = scene.time.addEvent({
      delay: 2000,
      loop: true,
      callback: () => {
        if (!scene.shieldActive) return;
        scene.shieldHealth--;
        if (scene.shieldHealth > 0) {
          scene.shieldHealthImg.setTexture('s' + scene.shieldHealth);
        } else {
          destroyShield(scene);
        }
      }
    });
  }
}

function destroyShield(scene) {
  if (scene.shieldSprite) scene.shieldSprite.destroy();
  scene.shieldSprite = null;

  if (scene.shieldHealthImg) scene.shieldHealthImg.setTexture('s1').setVisible(true);
  else {
    scene.shieldHealthImg = scene.add.image(1600, 70, 's1')
      .setOrigin(0.5)
      .setScale(1)
      .setScrollFactor(0)
      .setDepth(30);
  }

  if (scene.shieldTimer) {
    scene.shieldTimer.remove();
    scene.shieldTimer = null;
  }
  scene.shieldActive = false;
  scene.shieldPaused = false;
  scene.shieldHealth = 0;
  scene.shieldAvailable = false;
  showShieldDepletion(scene);
}

function showShieldDepletion(scene) {
  if (scene.shieldDepleteImg) scene.shieldDepleteImg.destroy();
  scene.shieldDepleteImg = scene.add.image(1600, 70, 's7')
    .setOrigin(0.5)
    .setScale(1)
    .setScrollFactor(0)
    .setDepth(31);

  let step = 7;

  if (scene.shieldDepleteTimer) {
    scene.shieldDepleteTimer.remove();
    scene.shieldDepleteTimer = null;
  }

  scene.shieldDepleteTimer = scene.time.addEvent({
    delay: 2000,
    loop: true,
    callback: () => {
      step--;
      if (step > 0) {
        scene.shieldDepleteImg.setTexture('s' + step);
      } else {
        scene.shieldDepleteImg.setTexture('s1');
        scene.shieldDepleteTimer.remove();
        scene.shieldDepleteTimer = null;
      }
    }
  });
}

function fireBullet(scene, enemy) {
  const targetX = scene.hero.x;
  const targetY = scene.hero.y;

  const bullet = scene.bullets.create(enemy.x, enemy.y, 'bullet');
  if (bullet) {
    bullet.setScale(1);
    scene.physics.moveTo(bullet, targetX, targetY, 400);
    bullet.body.allowGravity = false;

    const angleRad = Phaser.Math.Angle.Between(enemy.x, enemy.y, targetX, targetY);
    const angleDeg = Phaser.Math.RadToDeg(angleRad);
    bullet.setAngle(angleDeg);

    scene.sound.play('gun', { volume: 0.5 });
    bullet.lifespan = scene.time.now + 3000;
  }
}

function notifyParent(type, data) {
  if (window.parent !== window) {
    window.parent.postMessage({ type, ...data }, "*");
  }
}

function handleHeroBulletCollision(scene, hero, bullet) {
  if (scene.shieldActive) {
    const explosion = scene.add.image(bullet.x, bullet.y, 'explosion').setScale(0.5).setDepth(99);
    scene.time.delayedCall(150, () => explosion.destroy());
    bullet.destroy();
    scene.cameras.main.shake(100, 0.003);
    return;
  }

  bullet.destroy();
  hero.hp -= scene.bulletDamage;
  if (navigator.vibrate) navigator.vibrate(200);
  scene.cameras.main.shake(200, 0.01);

  if (hero.hp < 0) hero.hp = 0;

  const ratio = hero.hp / scene.heroMaxHP;
  if (ratio > 0.75) {
    scene.hpImage.setTexture('hp1');
  } else if (ratio > 0.50) {
    scene.hpImage.setTexture('hp2');
  } else if (ratio > 0.25) {
    scene.hpImage.setTexture('hp3');
  } else if (hero.hp > 0) {
    scene.hpImage.setTexture('hp4');
  }

  if (hero.hp <= 0) {
    hero.destroy();
    scene.time.delayedCall(500, () => {
      gameovr(scene);
    });
  }
}

function win(scene) {
  scene.physics.pause();

  const texts = scene.texts || {};

  const winBg = scene.add.image(960, 540, scene.textures.exists('winbg') ? 'winbg' : 'background')
    .setDepth(10);

  const lvlbox = scene.add.image(960, 500, 'lvlbox')
    .setScale(0.55, 0.6)
    .setOrigin(0.5)
    .setDepth(12);

  const lvltxt = scene.add.text(680, 460, texts.levelCompleted || 'Level Completed!', {
    fontSize: 'bold 70px',
    fontFamily: 'outfit',
    color: '#ffffff'
  }).setDepth(12);

  const nextbtn = scene.add.image(1220, 870, 'nextbtn')
    .setOrigin(0.5)
    .setInteractive()
    .setDepth(11);

  nextbtn.on('pointerdown', () => {
    winBg.destroy();
    lvlbox.destroy();
    lvltxt.destroy();
    nextbtn.destroy();
    restart.destroy();
    notifyParent('sceneComplete', { result: 'win' });
  });

  const restart = scene.add.image(720, 870, 'restart')
    .setOrigin(0.5)
    .setInteractive()
    .setDepth(11);

  restart.on('pointerdown', () => {
    winBg.destroy();
    lvlbox.destroy();
    lvltxt.destroy();
    nextbtn.destroy();
    restart.destroy();

    if (scene.bgm) {
      scene.bgm.stop();
      scene.bgm.destroy();
      scene.bgm = null;
    }
    scene.scene.restart();
  });
}

function fireHeroBullet(scene) {
  if (!scene.hero || !scene.hero.active) return;
  const direction = scene.hero.flipX ? -1 : 1;
  const bullet = scene.heroBullets.create(scene.hero.x + direction * 60, scene.hero.y, 'bullet1');
  if (bullet) {
    bullet.setScale(1);
    bullet.body.velocity.x = 600 * direction;
    bullet.body.allowGravity = false;
    scene.sound.play('gun', { volume: 0.6 });
    bullet.lifespan = scene.time.now + 2000;

    if (direction === 1) {
      bullet.setAngle(0);
    } else {
      bullet.setAngle(180);
    }
  }
}

function gameovr(scene) {
  scene.physics.pause();

  const ovrBg = scene.add.image(960, 540, scene.textures.exists('ovrbg') ? 'ovrbg' : 'background')
    .setDepth(10);

  if (scene.timerSound) scene.timerSound.stop();
  scene.sound.stopByKey('gun');
  if (scene.bulletTimer) scene.bulletTimer.remove();

  const texts = scene.texts || {};

  const gameovrbg = scene.add.image(960, 440, 'gameovrbg')
    .setScale(0.55, 0.8)
    .setOrigin(0.5)
    .setDepth(11);

  const lvltxt = scene.add.text(800, 200, texts.gameOver || 'Game Over', {
    fontSize: 'bold 70px',
    fontFamily: 'outfit',
    color: '#ffffff'
  }).setDepth(12);

  const lvltxt1 = scene.add.text(800, 400, 'Try Again!', {
    fontSize: 'bold 70px',
    fontFamily: 'outfit',
    color: '#ffffff'
  }).setDepth(12);

  const restart = scene.add.image(960, 920, 'restart1')
    .setOrigin(0.5)
    .setInteractive()
    .setDepth(11);

  restart.on('pointerdown', () => {
    ovrBg.destroy();
    gameovrbg.destroy();
    lvltxt.destroy();
    lvltxt1.destroy();
    restart.destroy();

    if (scene.bgm) {
      scene.bgm.stop();
      scene.bgm.destroy();
      scene.bgm = null;
    }

    scene.scene.restart();
  });
}
