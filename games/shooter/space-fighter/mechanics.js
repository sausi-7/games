class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
    this.lastFired = 0;
    this.swipeStartX = null;
    this.swipeStartTime = null;
    this.swipeActive = false;
    this.swipeDirection = null;
    this.isGameOver = false;
    this.lastFiredTime = 0;

    this.score = 0;
    this.targetScore = 0;
  }

  preload() {
    const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));
    console.log('base path', basePath);
    this.load.json('levelConfig', `${basePath}/config.json`);

    this.load.once('filecomplete-json-levelConfig', () => {
      const cfg = this.cache.json.get('levelConfig');
      const images = cfg.images || {};

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

      // Load audio
      const audio = cfg.audio || {};
      for (const [key, url] of Object.entries(audio)) {
        if (!url || typeof url !== 'string') continue;

        // If URL is absolute (http/https or protocol-relative), use as-is.
        // Otherwise, treat as relative to basePath.
        const audioUrl =
          /^https?:\/\//i.test(url) || url.startsWith('//')
            ? url
            : `${basePath}/${url}`;

        this.load.audio(key, audioUrl).on('error', () => {
          console.error(`Failed to load audio "${key}" from ${audioUrl}`);
        });
      }

      this.load.start();
    });
  }

  create() {
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock("portrait-primary").catch(() => { });
    }

    if (this.scale.fullscreen.available && !this.scale.isFullscreen) {
      this.scale.startFullscreen();
    }

    this.input.addPointer(3);

    const cfg = this.cache.json.get('levelConfig');
    this.texts = cfg.texts || {};

    if (cfg.audio && cfg.audio.bgm) {
      this.bgm = this.sound.add('bgm', { loop: true });
      this.bgm.play();
      this.bgm.setVolume(0.5);
    }

    const moon = this.add.image(540, -200, 'moon')
      .setOrigin(0.5)
      .setDepth(1)
      .setScrollFactor(0);

    this.tweens.add({
      targets: moon,
      angle: 360,
      duration: 30000,
      repeat: -1
    });

    this.gameStarted = false;

    this.bg = this.add.tileSprite(0, 0, 0, 0, 'bg').setOrigin(0).setDepth(0);

    addHTPPopup(this);


    this.input.on('pointerdown', (pointer) => {
      if (this.isGameOver) return;

      console.log('Pointer down at:', pointer.x, pointer.y, 'gameStarted:', this.gameStarted);
      this.swipeStartX = pointer.x;
      this.swipeStartTime = this.time.now;
      this.swipeActive = true;

      // NEW: tap anywhere to fire laser once game has started
      if (this.gameStarted) {
        this.sound.play('gun', { loop: false });
        fireLaser(this);
      }
    });


    this.input.on('pointermove', (pointer) => {
      if (this.swipeActive) {
        const deltaX = pointer.x - this.swipeStartX;
        if (deltaX < -50) {
          this.swipeDirection = 'left';
        } else if (deltaX > 50) {
          this.swipeDirection = 'right';
        } else {
          this.swipeDirection = null;
        }
      }
    });

    this.input.on('pointerup', (pointer) => {
      console.log('Pointer up, swipeActive:', this.swipeActive, 'gameStarted:', this.gameStarted);
      this.swipeActive = false;
      this.swipeDirection = null;
      this.swipeStartX = null;
      this.swipeStartTime = null;
    });
  }

  update(time, delta) {
    if (!this.gameStarted) return;
    updateGame(this, time, delta);
  }
}

function addHTPPopup(scene) {
  scene.htpElements = [];

  const blur = scene.add.rectangle(0, 0, 1080, 1920, 0x000000, 0.5)
    .setOrigin(0)
    .setDepth(9);
  scene.htpElements.push(blur);

  // NEW: full HTP background image
  const htpBg = scene.add.image(540, 960, 'htpbg')
    .setDepth(10)
    .setOrigin(0.5);
  scene.htpElements.push(htpBg);

  const htpBg1 = scene.add.image(440, 765, 'spaceship')
    .setScale(0.7)
    .setDepth(13)
    .setOrigin(0.5);
  scene.htpElements.push(htpBg1);
  const htpBg2 = scene.add.image(700, 945, 'asteroid')
    .setScale(1)
    .setDepth(13)
    .setOrigin(0.5);
  scene.htpElements.push(htpBg2);

  const htpBox = scene.add.image(540, 850, 'htpbox').setScale(0.55, 0.8).setDepth(11);
  const htptxt = scene.add.text(540, 600, scene.texts.htp || 'How to Play', {
    font: 'bold 70px outfit',
    color: '#ffffff'
  }).setOrigin(0.5).setDepth(11);
  const htpText = scene.add.text(240, 745, scene.texts.htpMessage || 'Swipe left or right to move\nthe hero.\nTap the fire button to\nshoot lasers and break\nasteroids.', {
    font: '60px outfit',
    color: '#ffffff',
    lineSpacing: 7
  }).setOrigin(0.5).setDepth(11);

  const htpText1 = scene.add.text(360, 945, scene.texts.htpMessage1 || 'Swipe left or right to move\nthe hero.\nTap the fire button to\nshoot lasers and break\nasteroids.', {
    font: '60px outfit',
    color: '#ffffff',
    lineSpacing: 7
  }).setOrigin(0.5).setDepth(11);

  const htpText2 = scene.add.text(540, 1100, scene.texts.htpMessage2 || 'Swipe left or right to move\nthe hero.\nTap the fire button to\nshoot lasers and break\nasteroids.', {
    font: '60px outfit',
    color: '#ffffff',
    lineSpacing: 7
  }).setOrigin(0.5).setDepth(11);

  const playbtn = scene.add.image(540, 1370, 'playbtn').setOrigin(0.5).setDepth(11).setInteractive();

  playbtn.on('pointerdown', () => {
    console.log('Play button clicked, starting game');
    scene.htpElements.forEach(el => el.destroy());
    initializeGame(scene);
    scene.gameStarted = true;

  });

  scene.htpElements.push(htptxt, htpBox, htpText, htpText1, htpText2, playbtn);
}

function updateScoreText(scene) {
  if (scene.scoreText) {
    scene.scoreText.setText(`Score: ${scene.score}/${scene.targetScore}`);
  }
}

function addScore(scene, amount) {
  scene.score += amount;
  updateScoreText(scene);
}


function updateHealthBar(scene) {
  if (scene.health < 0) scene.health = 0;
  if (scene.healthText) {
    scene.healthText.setText(`HP: ${scene.health}`);
  }
}


function initializeGame(scene) {
  const cfg = scene.cache.json.get('levelConfig');
  scene.mechanics = cfg.mechanics || {};

  scene.cameras.main.setBackgroundColor('#000000');
  scene.physics.world.setBounds(0, 0, 1080, 1920);

  scene.timebg = scene.add.image(850, 100, 'scoreback').setDepth(8).setOrigin(0.5);
  scene.background = scene.add.tileSprite(0, 0, 1080, 1920, 'background').setOrigin(0).setDepth(0);
  scene.bg = scene.add.tileSprite(0, 0, 1080, 1920, 'bg').setDepth(0).setOrigin(0);

  scene.player = scene.physics.add.sprite(540, 1520, 'spaceship')
    .setCollideWorldBounds(true)
    .setDepth(1)
    .setScale(1);

  // Slightly smaller collision box (keep this one)
  scene.player.body.setSize(scene.player.width * 0.8, scene.player.height * 0.8, true);

  // --- HEALTH AS NUMBER ---
  scene.health = scene.mechanics.initialHealth || 100;
  scene.healthText = scene.add.text(260, 100, `HP: ${scene.health}`, {
    fontSize: '50px',
    color: '#000000ff',
    fontFamily: 'outfit',
  }).setDepth(8).setOrigin(0.5);

  // --- SCORE + TARGET ---
  scene.score = 0;
  scene.targetScore = scene.mechanics.targetScore || 50;
  scene.hasWon = false;

  scene.scoreText = scene.add.text(850, 100, `Score: ${scene.score}/${scene.targetScore}`, {
    fontSize: '50px',
    color: '#000000ff',
    fontFamily: 'outfit',
  }).setDepth(8).setOrigin(0.5);

  // scene.targetText = scene.add.text(260, 400, `Target: ${scene.targetScore}`, {
  //   fontSize: '50px',
  //   color: '#ffffff',
  //   fontFamily: 'outfit',
  // }).setDepth(8).setOrigin(0.5);
  // -----------------------


  scene.scoreback = scene.add.image(250, 100, 'scoreback').setDepth(7)
  // ------------------------

  // -----------------------------------------------------------


  scene.asteroids = scene.physics.add.group({
    maxSize: scene.mechanics.maxAsteroids || 4
  });

  const randomAsteroidTypes = ['asteroid', 'asteroid1', 'asteroid2'];

  scene.time.addEvent({
    delay: Phaser.Math.Between(scene.mechanics.asteroidSpawnDelayMin || 2400, scene.mechanics.asteroidSpawnDelayMax || 5000),
    callback: () => {
      if (scene.asteroids.getLength() < scene.asteroids.maxSize) {
        const x = Phaser.Math.Between(50, 1030);
        const y = Phaser.Math.Between(-100, -500);
        const type = Phaser.Math.RND.pick(randomAsteroidTypes);
        const asteroid = scene.asteroids.create(x, y, type)
          .setScale(1)
          .setDepth(5)
          .setVelocity(
            Phaser.Math.Between(scene.mechanics.asteroidSpeedMin || -10, scene.mechanics.asteroidSpeedMax || 20),
            Phaser.Math.Between(scene.mechanics.asteroidSpeedMin || 10, scene.mechanics.asteroidSpeedMax || 20)
          );
        asteroid.body.setSize(asteroid.width, asteroid.height);
      }
    },
    callbackScope: scene,
    loop: true
  });

  scene.time.addEvent({
    delay: scene.mechanics.largeAsteroidSpawnDelay || 20000,
    callback: () => {
      if (scene.asteroids.getLength() < scene.asteroids.maxSize) {
        const x = Phaser.Math.Between(50, 1030);
        const y = Phaser.Math.Between(-100, -500);
        const asteroid = scene.asteroids.create(x, y, 'asteroid3')
          .setScale(1)
          .setDepth(5)
          .setVelocity(
            Phaser.Math.Between(scene.mechanics.asteroidSpeedMin || -10, scene.mechanics.asteroidSpeedMax || 20),
            Phaser.Math.Between(scene.mechanics.asteroidSpeedMin || 10, scene.mechanics.asteroidSpeedMax || 20)
          );
        asteroid.body.setSize(asteroid.width, asteroid.height);
        asteroid.hitCount = 0;
      }
    },
    callbackScope: scene,
    loop: true
  });

  scene.lasers = scene.physics.add.group({
    classType: Phaser.Physics.Arcade.Image,
    maxSize: scene.mechanics.maxLasers || 100
  });

  scene.cursors = scene.input.keyboard.createCursorKeys();
  scene.fireKey = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

  scene.physics.add.overlap(scene.player, scene.asteroids, handlePlayerAsteroidCollision, null, scene);
  scene.physics.add.overlap(scene.lasers, scene.asteroids, handleLaserAsteroidCollision, null, scene);

  // updatelaserBar(scene);
}

function updateGame(scene, time, delta) {
  // Stop updating when game is over or already won
  if (scene.isGameOver || scene.hasWon) {
    return;
  }

  // Background scroll + core gameplay
  scene.background.tilePositionY -= 8;
  scene.bg.tilePositionY -= 8;
  movePlayer(scene);
  updateAsteroids(scene);
  updateLasers(scene);

  // --- CHECK SCORE TARGET ONLY ---
  if (!scene.hasWon && scene.score >= scene.targetScore) {
    scene.hasWon = true;
    handleWin(scene);
    return;
  }
}

function movePlayer(scene) {
  const speed = scene.mechanics.playerSpeed || 500;
  scene.player.setY(1520);
  scene.player.setVelocityX(0);
  scene.player.setVelocityY(0);

  if (scene.swipeDirection === 'left') {
    scene.player.setVelocityX(-speed);
    scene.player.setAngle(-25);  // tilt left
  } else if (scene.swipeDirection === 'right') {
    scene.player.setVelocityX(speed);
    scene.player.setAngle(25);   // tilt right
  } else {
    scene.player.setVelocityX(0);
    scene.player.setAngle(0);    // straight
  }
}

function fireLaser(scene) {
  console.log(
    'Attempting to fire laser, lastFired:',
    scene.lastFired,
    'currentTime:',
    scene.time.now
  );

  // Only respect per-shot delay (laserFireDelay)
  const delay = scene.mechanics.laserFireDelay || 200;
  if (scene.lastFired && scene.time.now <= scene.lastFired + delay) {
    return;
  }

  const laser = scene.lasers.get(scene.player.x, 1370);

  if (!laser) {
    console.warn('No available laser in the group');
    return;
  }

  try {
    laser
      .setTexture('round_bullet')
      .setActive(true)
      .setVisible(true)
      .setDepth(1);

    laser.body.setSize(laser.width, laser.height);
    laser.body.setVelocityY(-(scene.mechanics.laserSpeed || 1800));

    scene.lastFired = scene.time.now;
    scene.lastFiredTime = scene.time.now;
  } catch (error) {
    console.error('Error setting laser texture:', error);
  }
}



function updateAsteroids(scene) {
  const asteroidsTypes = ['asteroid', 'asteroid1', 'asteroid2', 'asteroid3'];
  scene.asteroids.getChildren().forEach(asteroid => {
    if (asteroid.y > 2000) {
      asteroid.setY(Phaser.Math.Between(-100, -500));
      asteroid.setX(Phaser.Math.Between(50, 1030));
      asteroid.setTexture(Phaser.Math.RND.pick(asteroidsTypes));
      asteroid.setVelocity(
        Phaser.Math.Between(scene.mechanics.asteroidSpeedMin || -10, scene.mechanics.asteroidSpeedMax || 20),
        Phaser.Math.Between(scene.mechanics.asteroidSpeedMin || 10, scene.mechanics.asteroidSpeedMax || 20)
      );
      asteroid.setDepth(5);
      asteroid.body.setSize(asteroid.width, asteroid.height);
      if (asteroid.texture.key === 'asteroid3') {
        asteroid.hitCount = 0;
      }
    }
  });
}

function updateLasers(scene) {
  scene.lasers.getChildren().forEach(laser => {
    if (laser.y <= -100) {
      laser.setActive(false).setVisible(false);
    }
  });
}

function handleWin(scene) {
  scene.physics.world.isPaused = true;

  const blur = scene.add.rectangle(0, 0, 1080, 1920, 0x000000, 0.5)
    .setOrigin(0)
    .setDepth(9);

  // NEW: win background
  const winBg = scene.add.image(540, 960, 'winbg')
    .setScale(1)
    .setDepth(10);

  // Optional: keep lvlbox on top of winBg
  const ovrbox = scene.add.image(540, 750, 'lvlbox')
    .setScale(0.55, 0.6)
    .setDepth(11);

  const restart = scene.add.image(310, 1160, 'restart1')
    .setScale(1)
    .setDepth(11)
    .setInteractive();

  const nextbtn = scene.add.image(770, 1160, 'nextbtn')
    .setScale(1)
    .setDepth(11)
    .setInteractive();

  const ovrTitle = scene.add.text(
    540,
    755,
    scene.texts.levelComplete || 'Level Completed',
    { font: 'bold 70px outfit', fill: 'white' }
  ).setDepth(12).setOrigin(0.5);


  restart.on('pointerdown', () => {
    ovrbox.destroy();
    restart.destroy();
    blur.destroy();
    ovrTitle.destroy();
    nextbtn.destroy();
    winBg.destroy();
    scene.scene.restart();
  });


  nextbtn.on('pointerdown', () => {
    ovrbox.destroy();
    restart.destroy();
    ovrTitle.destroy();
    blur.destroy();
    nextbtn.destroy();
    winBg.destroy();
    scene.laser = scene.mechanics.initialLasers || 15;
    scene.scene.stop();
    notifyParent('sceneComplete', { result: 'win' });
  });
}

function notifyParent(type, data) {
  if (window.parent !== window) {
    window.parent.postMessage({ type, ...data }, "*");
  }
}

function handlePlayerAsteroidCollision(player, asteroid) {
  const scene = this;
  const asteroidTypes = ['asteroid', 'asteroid1', 'asteroid2', 'asteroid3'];

  // Play crash sound
  scene.sound.play('crash', { loop: false });
  if (scene.bgm) {
    scene.bgm.setVolume(0.3); // Lower the background music volume
    scene.time.delayedCall(1000, () => {
      scene.bgm.setVolume(0.5); // Restore the volume after 1 second
    }, [], scene);
  }

  const bomb = scene.add.image(scene.player.x, scene.player.y, 'bomb')
    .setDepth(2)
    .setScale(1);
  console.log('Bomb effect created at player position:', scene.player.x, scene.player.y);

  scene.tweens.add({
    targets: bomb,
    alpha: 0,
    duration: 400,
    onComplete: () => {
      bomb.destroy();
      console.log('Bomb effect destroyed');
    }
  });

  scene.health -= scene.mechanics.healthDamagePerHit || 25;
  updateHealthBar(scene);

  asteroid.setY(Phaser.Math.Between(-100, -500));
  asteroid.setX(Phaser.Math.Between(50, 1030));
  asteroid.setTexture(Phaser.Math.RND.pick(asteroidTypes));
  asteroid.setVelocity(
    Phaser.Math.Between(scene.mechanics.asteroidSpeedMin || -10, scene.mechanics.asteroidSpeedMax || 20),
    Phaser.Math.Between(scene.mechanics.asteroidSpeedMin || 10, scene.mechanics.asteroidSpeedMax || 20)
  );
  asteroid.setDepth(5);
  asteroid.body.setSize(asteroid.width, asteroid.height);
  if (asteroid.texture.key === 'asteroid3') {
    asteroid.hitCount = 0;
  }

  if (scene.health <= 0) {
    scene.background.tilePositionY = 0;
    scene.bg.tilePositionY = 0;
    scene.scrollStopped = true;

    const playerX = scene.player.x;
    const playerY = scene.player.y;
    scene.player.destroy();
    gameovr(scene, playerX, playerY);
  }

}

function handleLaserAsteroidCollision(laser, asteroid) {
  const scene = this;
  const asteroidTypes = ['asteroid', 'asteroid1', 'asteroid2', 'asteroid3'];

  const isAsteroid3 = asteroid.texture.key === 'asteroid3';
  const explosion = scene.add.image(asteroid.x, asteroid.y, 'explosion')
    .setDepth(12)
    .setScale(isAsteroid3 ? 1 : 0.8);

  scene.tweens.add({
    targets: explosion,
    alpha: 0,
    duration: 500,
    onComplete: () => {
      explosion.destroy();
    }
  });

  laser.destroy();

  if (isAsteroid3) {
    asteroid.hitCount = (asteroid.hitCount || 0) + 1;
    if (asteroid.hitCount >= (scene.mechanics.largeAsteroidHits || 2)) {
      asteroid.setY(Phaser.Math.Between(-100, -500));
      asteroid.setX(Phaser.Math.Between(50, 1030));
      asteroid.setTexture(Phaser.Math.RND.pick(asteroidTypes));
      asteroid.setVelocity(
        Phaser.Math.Between(scene.mechanics.asteroidSpeedMin || -10, scene.mechanics.asteroidSpeedMax || 20),
        Phaser.Math.Between(scene.mechanics.asteroidSpeedMin || 10, scene.mechanics.asteroidSpeedMax || 20)
      );
      asteroid.setDepth(5);
      asteroid.body.setSize(asteroid.width, asteroid.height);
      asteroid.hitCount = 0;

      // NEW: score for destroying big asteroid
      addScore(scene, 10);
    }
  } else {
    asteroid.setY(Phaser.Math.Between(-100, -500));
    asteroid.setX(Phaser.Math.Between(50, 1030));
    asteroid.setTexture(Phaser.Math.RND.pick(asteroidTypes));
    asteroid.setVelocity(
      Phaser.Math.Between(scene.mechanics.asteroidSpeedMin || -10, scene.mechanics.asteroidSpeedMax || 20),
      Phaser.Math.Between(scene.mechanics.asteroidSpeedMin || 10, scene.mechanics.asteroidSpeedMax || 20)
    );
    asteroid.setDepth(5);
    asteroid.body.setSize(asteroid.width, asteroid.height);

    // NEW: score for normal asteroid
    addScore(scene, 10);
  }

}

function gameovr(scene, playerX, playerY) {
  scene.isGameOver = true;

  const bomb = scene.add.image(playerX, playerY, 'bomb')
    .setDepth(2)
    .setScale(1);

  scene.tweens.add({
    targets: bomb,
    alpha: 0,
    duration: 400,
    onComplete: () => {
      bomb.destroy();
    }
  });

  const blur = scene.add.rectangle(0, 0, 1080, 1920, 0x000000, 0.5)
    .setOrigin(0)
    .setDepth(9);

  // NEW: game over background
  const ovrBg = scene.add.image(540, 960, 'ovrbg')
    .setScale(1)
    .setDepth(10);

  const ovrbox = scene.add.image(540, 740, 'gameover')
    .setScale(0.55, 0.8)
    .setDepth(11);

  const restart = scene.add.image(540, 1240, 'restart')
    .setScale(1)
    .setDepth(11)
    .setInteractive();

  const ovrTitle = scene.add.text(
    570,
    500,
    scene.texts.leveltxt || 'Game Over',
    { font: 'bold 70px outfit', fill: 'white' }
  ).setDepth(12).setOrigin(0.5);

  const scoreText = scene.add.text(
    540,
    760,
    `Score: ${scene.score}`,
    { font: 'bold 60px outfit', fill: '#ffffff' }
  )
    .setDepth(12)
    .setOrigin(0.5);



  restart.on('pointerdown', () => {
    ovrbox.destroy();
    scoreText
    blur.destroy();
    restart.destroy();
    ovrTitle.destroy();
    ovrBg.destroy();
    scene.isGameOver = false;
    scene.scene.restart();
  });

}

export default GameScene;