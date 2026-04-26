const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));
export const CONFIG_PATH = `${basePath}/config.json`;
const width = 1080;
const height = 1920;

export default class GamePlayScene2 extends Phaser.Scene {
  constructor() {
    super('GamePlayScene2');
    this.doodler = null;
    this.platforms = null;
    this.movingPlatforms = null;
    this.springs = null;
    this.enemies = null;
    this.score = 0;
    this.highScore = localStorage.getItem('doodleHighScore') || 0;
    this.scoreText = null;
    this.highScoreText = null;
    this.gameOver = false;
    this.cursors = null;
    this.initialPlatformCount = 12;
    this.jumpVelocity = -750;
    this.maxVelocity = 800;
    this.cameraYMin = 99999;
    this.sounds = {};
    this.lastGeneratedY = 0;
    this.gravity = 500;
    this.moveSpeed = 400;
    this.platformPool = [];
    this.difficultyLevel = 1;
    this.springJumpVelocity = -800;
    this.enemySpawnChance = 0.1;
    this.springSpawnChance = 0.15;
    this.gameOverImage = null;
    this.finalScoreText = null;
    this.bestScoreText = null;
    this.restartButton = null;
    this.backdrop = null;
    this.targetScore = 100;
    this.startgamenow = 0;
    this.level = null;
    this.target = null;
    this.config = null;
    this.textContent = null;
    this.levelClearedTriggered = false;
    this.moveLeft = false;
    this.moveRight = false;

    this.initialDoodlerY = 0; // Track initial y-position for score
  }

  preload() {
    // Load configuration
    this.load.json('config1', CONFIG_PATH);

    this.load.once('filecomplete-json-config1', () => {
      this.config = this.cache.json.get('config1');
      this.textContent = this.config.text || {};

      // Load images
      if (this.config.assets?.images1) {
        Object.entries(this.config.assets.images1).forEach(([key, url]) => {
          const path = url.startsWith('http') ? url : `${basePath}/${url}`;
          this.load.image(key, path);
        });
      }

      if (this.config.assets?.images2) {
        Object.entries(this.config.assets.images2).forEach(([key, url]) => {
          const path = url.startsWith('http') ? url : `${basePath}/${url}`;
          this.load.image(key, path);
        });
      }

      if (this.config.assets?.ui) {
        Object.entries(this.config.assets.ui).forEach(([key, url]) => {
          const path = url.startsWith('http') ? url : `${basePath}/${url}`;
          this.load.image(key, path);
        });
      }

      // Load audio
      if (this.config.assets?.audio) {
        Object.entries(this.config.assets.audio).forEach(([key, url]) => {
          const path = url.startsWith('http') ? url : `${basePath}/${url}`;
          this.load.audio(key, path);
        });
      }

      // Hero spritesheet
      const heroData = this.config.sheets?.hero || {};
      const rawMain = new URLSearchParams(window.location.search).get('main') || '';
      const cleanMain = rawMain.replace(/^"|"$/g, '');
      const sheetUrl = cleanMain || heroData.url || `${basePath}/assets/characters.png`;
      const frameW = heroData.frameWidth || 103;
      const frameH = heroData.frameHeight || 143;
      this.load.spritesheet('doodler', sheetUrl, { frameWidth: frameW, frameHeight: frameH });

      // Kick off the queued asset load
      this.load.start();
    });
  }



  create() {
    // Lock orientation
    if (screen.orientation?.lock) {
      screen.orientation.lock('portrait-primary').catch(() => { });
    }
    if (this.scale.fullscreen.available && !this.scale.isFullscreen) {
      this.scale.startFullscreen();
    }

    // Parse config if not already
    this.config = this.cache.json.get('config1');
    this.textContent = this.config.text || {};

    // Initialize sounds
    this.sounds = {};
    Object.keys(this.config.assets?.audio || {}).forEach(key => {
      this.sounds[key] = this.sound.add(key);
    });

    // Level parameters
    const lvl = this.config.level2 || {};
    this.gravity = lvl.gravity || this.gravity;
    this.jumpVelocity = lvl.jumpVelocity || this.jumpVelocity;
    this.maxVelocity = lvl.maxVelocity || this.maxVelocity;
    this.moveSpeed = lvl.moveSpeed || this.moveSpeed;
    this.springJumpVelocity = lvl.springJumpVelocity || this.springJumpVelocity;
    this.targetScore = lvl.targetScore || this.targetScore;
    this.initialPlatformCount = lvl.initialPlatformCount || this.initialPlatformCount;
    this.enemySpawnChance = lvl.enemySpawnChance || this.enemySpawnChance;
    this.springSpawnChance = lvl.springSpawnChance || this.springSpawnChance;

    // Physics world
    this.physics.world.gravity.y = this.gravity;
    this.physics.world.setBounds(0, 0, width, height);

    // Groups
    this.platforms = this.physics.add.staticGroup();
    this.movingPlatforms = this.physics.add.group({ allowGravity: false, immovable: true });

    this.springs = this.physics.add.staticGroup();
    this.enemies = this.physics.add.group({ allowGravity: false });

    // Create scene elements
    createBackground(this);
    createDoodler(this);
    createPlatforms(this);
    createScore(this, this.config);
    createColliders(this);
    taskpanel(this, this.config);
    createAnimations(this);

    // Input
    this.input.addPointer(2);
    this.input.on('pointerup', () => {
      if (this.scale.fullscreen.available && !this.scale.isFullscreen) {
        this.scale.startFullscreen();
      }
    });
  }

  update() {
    if (this.gameOver || !this.doodler) return;
    handleInput(this);
    handleWrapping(this);
    updateScore(this, this.config);
    generatePlatforms(this);
    checkGameOver(this);
    updateDifficulty(this);
  }
}

function resetGame(scene, config) {
  scene.score = 0;
  scene.gameOver = false;
  scene.startgamenow = 0;
  scene.levelClearedTriggered = false;
  scene.moveLeft = false;
  scene.moveRight = false;
  scene.initialDoodlerY = 0;

  ['idle', 'left', 'right'].forEach(anim => {
    if (scene.anims.exists(anim)) {
      scene.anims.remove(anim);
    }
  });

  if (scene.doodler) {
    scene.doodler.destroy();
    scene.doodler = null;
  }
  if (scene.platforms) {
    scene.platforms.clear(true, true);
  }
  if (scene.movingPlatforms) {
    scene.movingPlatforms.clear(true, true);
  }
  if (scene.springs) {
    scene.springs.clear(true, true);
  }
  if (scene.enemies) {
    scene.enemies.clear(true, true);
  }
  if (scene.scoreText) {
    scene.scoreText.destroy();
    scene.scoreText = null;
  }
  if (scene.highScoreText) {
    scene.highScoreText.destroy();
    scene.highScoreText = null;
  }
  if (scene.level) {
    scene.level.destroy();
    scene.level = null;
  }
  if (scene.target) {
    scene.target.destroy();
    scene.target = null;
  }
  if (scene.physics.world && scene.physics.world.colliders) {
    scene.physics.world.colliders.destroy();
  }
  if (scene.cameras.main) {
    scene.cameras.main.scrollY = 0;
  }
}

function createBackground(scene) {
  scene.add
    .image(width / 2, height / 2, 'background')
    .setScrollFactor(0)
    .setScale(2)
    .setDepth(0);
}

function createDoodler(scene) {
  if (!scene.textures.exists('doodler')) {
    console.warn('Doodler texture not loaded yet');
    return;
  }

  scene.doodler = scene.physics
    .add.sprite(width / 2, Math.round(870 * 1.2), 'doodler', 5)
    .setScale(0.9)
    .setBounce(0)
    .setDepth(3)
    .setCollideWorldBounds(false);

  scene.doodler.body
    .setSize(scene.doodler.width * 0.6, scene.doodler.height * 0.7)
    .setOffset(scene.doodler.width * 0.2, scene.doodler.height * 0.3);
  scene.doodler.body.maxVelocity.set(scene.moveSpeed, scene.maxVelocity);
  scene.doodler.body.allowGravity = false;
  scene.doodler.body.velocity.y = 0;

  scene.initialDoodlerY = scene.doodler.y; // Store initial y-position

  scene.cameras.main.startFollow(scene.doodler, false, 0, 1, 0, height / 4);
  scene.cameras.main.setDeadzone(0, 300);

  setupControls(scene);
}

function createPlatforms(scene) {
  let startPlatform = scene.platforms.create(width / 2, Math.round(900 * 1.3), 'platform');
  startPlatform.setScale(1.4);
  startPlatform.refreshBody();
  startPlatform.body.setSize(startPlatform.width * 0.9, startPlatform.height * 0.3);
  startPlatform.type = 'normal';
  startPlatform.body.checkCollision.down = false;
  startPlatform.body.checkCollision.left = false;
  startPlatform.body.checkCollision.right = false;

  let currentY = Math.round(800 * 1.5);
  let lastX = width / 2;

  scene.lastGeneratedY = currentY;

  for (let i = 0; i < scene.initialPlatformCount; i++) {
    const maxHorizontalDistance = 200;
    const minX = Math.max(100 * 1.5, lastX - maxHorizontalDistance * 1.5);
    const maxX = Math.min(620 * 1.5, lastX + maxHorizontalDistance * 1.5);
    const x = Phaser.Math.Between(minX, maxX);

    currentY -= Phaser.Math.Between(60 * 1.5, 100 * 1.5);
    createPlatform(scene, x, currentY);
    lastX = x;
  }
}

function createScore(scene, config) {
  if (typeof scene.score !== 'number') {
    scene.score = 0;
  }

  const score1 = scene.add.image(200, 100, 'scorebg').setScrollFactor(0);

  scene.scoreText = scene.add
    .text(90, 70, 'Score: 0', {
      fontSize: '50px',
      fontFamily: 'outfit',
      fill: 'black',
      fontStyle: 'bold',
      backgroundColor: null
    })
    .setScrollFactor(0)
    .setDepth(1);

  scene.highScoreText = scene.add
    .text(20, 60, '', {
      fontSize: '32px',
      fontFamily: 'outfit',
      fill: '#000',
      fontStyle: 'bold',
      backgroundColor: '#45AEE4'
    })
    .setScrollFactor(0)
    .setDepth(1);
}

function createColliders(scene) {
  scene.physics.add.collider(
    scene.doodler,
    scene.platforms,
    (doodler, platform) => handlePlatformCollision(scene, doodler, platform),
    (doodler, platform) => checkCollision(doodler, platform),
    scene
  );
  scene.physics.add.collider(
    scene.doodler,
    scene.movingPlatforms,
    (doodler, platform) => handlePlatformCollision(scene, doodler, platform),
    (doodler, platform) => checkCollision(doodler, platform),
    scene
  );
  scene.physics.add.overlap(
    scene.doodler,
    scene.springs,
    (doodler, spring) => handleSpringCollision(scene, doodler, spring),
    null,
    scene
  );
  scene.physics.add.overlap(
    scene.doodler,
    scene.enemies,
    (doodler, monster) => handleMonsterCollision(scene, doodler, monster),
    null,
    scene
  );
}

function createAnimations(scene) {
  scene.anims.create({
    key: 'idle',
    frames: scene.anims.generateFrameNumbers('doodler', { start: 0, end: 2 }),
    frameRate: 6,
    repeat: -1,
  });
  scene.anims.create({
    key: 'left',
    frames: scene.anims.generateFrameNumbers('doodler', { start: 4, end: 5 }),
    frameRate: 6,
    repeat: -1,
  });
  scene.anims.create({
    key: 'right',
    frames: scene.anims.generateFrameNumbers('doodler', { start: 4, end: 5 }),
    frameRate: 6,
    repeat: -1,
  });
}

function createPlatform(scene, x, y) {
  const difficulty = Math.min(scene.difficultyLevel, 10);
  const totalRange = 100;
  let platformType = Phaser.Math.Between(1, totalRange);
  let platform;

  const normalThreshold = 70;
  const movingThreshold = normalThreshold + 20 + Math.floor(difficulty / 2);

  if (scene.consecutiveBreakPlatforms >= 2 && platformType > movingThreshold) {
    platformType = Phaser.Math.Between(1, movingThreshold);
  }

  if (platformType <= normalThreshold) {
    platform = scene.platforms.create(x, y, 'platform');
    platform.type = 'normal';
    scene.consecutiveBreakPlatforms = 0;
  } else if (platformType <= movingThreshold) {
    platform = scene.movingPlatforms.create(x, y, 'platform2');
    platform.type = 'moving';
    platform.originalX = x;
    platform.setVelocityX(scene.platformSpeed + difficulty * 10);
    setupMovingPlatform(scene, platform);
    scene.consecutiveBreakPlatforms = 0;
  } else {
    platform = scene.platforms.create(x, y, 'platform-break');
    platform.type = 'break';
    scene.consecutiveBreakPlatforms++;
  }

  platform.setScale(1);
  platform.refreshBody();
  platform.body.setSize(platform.width * 0.8, platform.height * 0.3);
  platform.body.checkCollision.down = false;
  platform.body.checkCollision.left = false;
  platform.body.checkCollision.right = false;
  platform.body.immovable = true;

  if (platform.type === 'normal' && Math.random() < scene.springSpawnChance) {
    createSpring(scene, x, y - 15 * 1.5);
  }
  if (Math.random() < scene.enemySpawnChance) {
    createMonster(scene, x, y - 37 * 1.5);
  }

  console.log(`Platform created: ${platform.type}, Difficulty: ${difficulty}, Consecutive Breaks: ${scene.consecutiveBreakPlatforms}`);

  return platform;
}

function createSpring(scene, x, y) {
  const spring = scene.springs.create(x, y, 'spring'); // uses staticGroup
  spring.setScale(0.5);

  // Static bodies need refreshBody() after scale/size
  const bodyW = spring.width * 0.6;
  const bodyH = spring.height * 0.4;
  spring.body.setSize(bodyW, bodyH);
  spring.refreshBody();

  return spring;
}


function createMonster(scene, x, y) {
  const boundedX = Phaser.Math.Clamp(x, 100 * 1.5, 620 * 1.5);
  const monster = scene.enemies.create(boundedX, y + 17, 'monster');
  monster.setScale(0.7);
  monster.body.setSize(monster.width * 0.8, monster.height * 0.8);
  monster.originalX = boundedX;
  monster.setVelocityX(50);

  scene.time.addEvent({
    delay: 50,
    callback: () => {
      if (monster.active) {
        if (
          monster.x <= monster.originalX - 70 * 1.5 ||
          monster.x >= monster.originalX + 70 * 1.5
        ) {
          monster.setVelocityX(-monster.body.velocity.x);
        }
      }
    },
    loop: true,
  });

  return monster;
}

function setupMovingPlatform(scene, platform) {
  scene.time.addEvent({
    delay: 50,
    callback: () => {
      if (platform.active) {
        if (platform.x <= platform.originalX - 100 * 1.5) {
          platform.setVelocityX(Math.abs(platform.body.velocity.x));
        } else if (platform.x >= platform.originalX + 100 * 1.5) {
          platform.setVelocityX(-Math.abs(platform.body.velocity.x));
        }
      }
    },
    loop: true,
  });
}

function checkCollision(doodler, platform) {
  return doodler.body.velocity.y > 0;
}

function handlePlatformCollision(scene, doodler, platform) {
  const doodlerBottom = doodler.body.bottom;
  const platformTop = platform.body.top;

  if (doodlerBottom <= platformTop + 15) {
    doodler.setVelocityY(scene.jumpVelocity);
    scene.sounds.jump?.play();

    if (platform.type === 'break') {
      scene.sounds.break?.play();
      platform.destroy();
    } else if (platform.type === 'moving') {
      doodler.body.velocity.x += platform.body.velocity.x * 0.5;
    }
  }
}

function handleSpringCollision(scene, doodler, spring) {
  const falling = doodler.body.velocity.y > 0;
  const above = doodler.body.bottom <= spring.body.top + 20;

  if (falling && above) {
    if (scene.textures.exists('spring-compressed')) {
      spring.setTexture('spring-compressed');
      spring.refreshBody?.();
    }
    scene.sounds.spring?.play();
    doodler.setVelocityY(scene.springJumpVelocity);

    scene.time.delayedCall(180, () => {
      if (spring.active && scene.textures.exists('spring')) {
        spring.setTexture('spring');
        spring.refreshBody?.();
      }
    });
  }
}
function handleMonsterCollision(scene, doodler, monster) {
  if (scene.gameOver) return;

  const doodlerBottom = doodler.body.bottom;
  const doodlerVy = doodler.body.velocity.y;
  const monsterTop = monster.body.top;
  const stomp = doodlerVy > 0 && doodlerBottom <= monsterTop + 15;

  if (stomp) {
    if (monster.active) monster.destroy();
    scene.sounds.jump?.play();
    doodler.setVelocityY(scene.jumpVelocity);
  } else {
    gameOverHandler(scene, scene.config);
  }
}




function generatePlatforms(scene) {
  const currentCameraY = scene.cameras.main.scrollY;
  const bufferZone = 1500;
  const minPlatforms = 15;

  const allPlatforms = [
    ...scene.platforms.getChildren(),
    ...scene.movingPlatforms.getChildren(),
  ];
  const visiblePlatforms = allPlatforms.filter(
    (platform) => platform.y >= currentCameraY - bufferZone
  );

  if (visiblePlatforms.length < minPlatforms) {
    // Find the highest platform Y position
    const highestPlatformY = Math.min(
      ...allPlatforms.map((p) => p.y),
      scene.lastGeneratedY
    );

    // Start generating platforms just above the highest platform
    let nextY = highestPlatformY;

    const gridColumns = 4;
    const columnWidth = width / gridColumns;
    let currentColumn = Math.floor(scene.doodler.x / columnWidth);

    for (let i = 0; i < 8; i++) {
      currentColumn =
        (currentColumn + (i % 2 === 0 ? 1 : -1) + gridColumns) % gridColumns;
      const baseX = (currentColumn + 0.5) * columnWidth;
      const x = Phaser.Math.Clamp(
        baseX + Phaser.Math.Between(-30 * 1.5, 30 * 1.5),
        100 * 1.5,
        620 * 1.5
      );

      // Use the same vertical distance as in createPlatforms (90–150 pixels)
      const verticalDistance = Phaser.Math.Between(60 * 1.5, 100 * 1.5); // 90–150 pixels
      nextY -= verticalDistance;

      createPlatform(scene, x, nextY);
      console.log(
        `Platform created at x: ${x}, y: ${nextY}, verticalDistance: ${verticalDistance}, highestPlatformY: ${highestPlatformY}`
      );
    }
    scene.lastGeneratedY = nextY;
  }

  cleanupPlatforms(scene, currentCameraY);
}

function cleanupPlatforms(scene, currentCameraY) {
  const cleanupBuffer = 1920;
  [
    ...scene.platforms.getChildren(),
    ...scene.movingPlatforms.getChildren(),
    ...scene.springs.getChildren(),
    ...scene.enemies.getChildren(),
  ].forEach((object) => {
    if (object.y > currentCameraY + cleanupBuffer) {
      object.destroy();
    }
  });
}

function updateScore(scene, config) {
  if (!scene.doodler || !scene.startgamenow) return;

  // Calculate score based on how far the doodler has climbed
  const heightClimbed = scene.initialDoodlerY - scene.doodler.y;
  if (heightClimbed > 0) {
    const newScore = Math.floor(heightClimbed / 10);
    if (newScore > scene.score) {
      scene.score = newScore;
      scene.scoreText.setText('Score: ' + scene.score);
      console.log(`Score updated: ${scene.score}, Doodler Y: ${scene.doodler.y}, Camera Y: ${scene.cameras.main.scrollY}`);

      if (scene.score > scene.highScore) {
        scene.highScore = scene.score;
        scene.highScoreText.setText('Best: ' + scene.highScore);
        localStorage.setItem('doodleHighScore', scene.highScore);
      }

      if (scene.score >= scene.targetScore && !scene.levelClearedTriggered) {
        scene.levelClearedTriggered = true;
        scene.time.delayedCall(500, () => {
          scene.physics.pause();
          levelcleared(scene, scene.config);
        });
      }
    }
  }
}

function updateDifficulty(scene) {
  scene.difficultyLevel = Math.floor(scene.score / 2000) + 1;
  scene.jumpVelocity = Math.max(-700, -550 - scene.difficultyLevel * 10); // Ensure jump velocity stays at least -700
  scene.enemySpawnChance = Math.min(0.1 + scene.difficultyLevel * 0.02, 0.3);
  scene.springSpawnChance = Math.max(0.15 - scene.difficultyLevel * 0.01, 0.05);
  console.log(`Difficulty updated: ${scene.difficultyLevel}, Score: ${scene.score}`);
}

function checkGameOver(scene) {
  if (scene.doodler.y > scene.cameras.main.scrollY + 1920) {
    gameOverHandler(scene, scene.config);
  }

  if (scene.doodler.body.velocity.y > 0) {
    const allPlatforms = [
      ...scene.platforms.getChildren(),
      ...scene.movingPlatforms.getChildren(),
    ];
    const hasPlatformBelow = allPlatforms.some(
      (platform) =>
        platform.y > scene.doodler.y &&
        Math.abs(platform.x - scene.doodler.x) < 300
    );
    if (
      !hasPlatformBelow &&
      scene.doodler.y > scene.cameras.main.scrollY + 960
    ) {
      gameOverHandler(scene, scene.config);
    }
  }
}

function gameOverHandler(scene, config) {
  if (scene.gameOver) return;

  scene.gameOver = true;
  scene.physics.pause();
  scene.doodler.setTint(0xff0000);

  scene.backdrop = scene.add
    .image(0, 0, 'backdrop')
    .setOrigin(0)
    .setDepth(4)
    .setScrollFactor(0)
    .setInteractive();

  scene.gameOverImage = scene.add
    .image(540, 960, 'gameover')
    .setDepth(4)
    .setScrollFactor(0);

  scene.finalScoreText = scene.add
    .text(
      520,
      1140,
      `${scene.textContent.yourScore || 'Your Score'}                              ${scene.score}`,
      {
        fontFamily: 'outfit',
        fontSize: '60px',
        fontWeight: '400',
        fill: 'white',
      }
    )
    .setOrigin(0.5)
    .setDepth(4)
    .setScrollFactor(0);

  scene.bestScoreText = scene.add
    .text(
      520,
      970,
      `${scene.textContent.targetScore || 'Target'}                                      ${scene.targetScore}`,
      {
        fontFamily: 'outfit',
        fontSize: '60px',
        fontWeight: '400',
        fill: 'white',
      }
    )
    .setOrigin(0.5)
    .setDepth(4)
    .setScrollFactor(0);

  scene.gameovertxt1 = scene.add
    .text(
      450,
      800,
      scene.textContent.gameOver || 'Game Over',
      {
        fontFamily: 'outfit',
        fontSize: '70px',
        fontWeight: '500',
        fill: 'white',
      }
    )
    .setOrigin(0.5)
    .setDepth(4)
    .setScrollFactor(0);

  const restartButton = scene.add
    .image(width / 2, 1350, 'restart')
    .setDepth(4)
    .setScrollFactor(0)
    .setInteractive();

  restartButton.on('pointerover', () => restartButton.setScale(1.1));
  restartButton.on('pointerout', () => restartButton.setScale(1));
  restartButton.on('pointerdown', () => {
    if (scene.gameOver) {
      resetGame(scene, scene.config);
      scene.scene.restart();
    }
  });
}

function levelcleared(scene, config) {
  const cam = scene.cameras.main;

  scene.add
    .image(0, 0, 'backdrop')
    .setOrigin(0)
    .setScrollFactor(0)
    .setDepth(4)
    .setInteractive();

  scene.add
    .image(cam.centerX, cam.centerY, 'lvlboard')
    .setScrollFactor(0)
    .setDepth(5);

  scene.add
    .text(
      460,
      cam.centerY - 180,
      scene.textContent.levelCleared || 'Level Cleared',
      {
        fontFamily: 'outfit',
        fontSize: '70px',
        fontWeight: '400',
        fill: '#fff',
      }
    )
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(5);

  scene.add
    .text(
      cam.centerX + 10,
      1150,
      `${scene.textContent.yourScore || 'Your Score'}                                ${scene.score}`,
      {
        fontFamily: 'outfit',
        fontSize: '60px',
        fontWeight: '400',
        fill: '#fff',
      }
    )
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(5);

  scene.add
    .text(
      cam.centerX + 10,
      950,
      `${scene.textContent.targetScore || 'Target'}                                         ${scene.targetScore}`,
      {
        fontFamily: 'outfit',
        fontSize: '60px',
        fontWeight: '400',
        fill: '#fff',
      }
    )
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(5);

  const nextButton = scene.add
    .image(cam.centerX, cam.centerY + 400, 'nxtlvl')
    .setOrigin(0.5)
    .setScale(1)
    .setInteractive({ pixelPerfect: true, useHandCursor: true })
    .setScrollFactor(0)
    .setDepth(5);

  nextButton.on('pointerover', () => nextButton.setScale(1.1));
  nextButton.on('pointerout', () => nextButton.setScale(1));
  nextButton.on('pointerdown', () => {
    scene.physics.pause();
    scene.scene.stop();
    resetGame(scene, scene.config);
    notifyParent('sceneComplete', { result: 'win' });
  });
}

function taskpanel(scene, config) {
  const backdrop = scene.add
    .image(0, 0, 'backdrop')
    .setOrigin(0)
    .setInteractive()
    .setDepth(3);

  const taskpanel = scene.add
    .image(540, 900, 'taskpanel')
    .setDepth(4);

  scene.level = scene.add
    .text(
      440,
      650,
      scene.textContent.howToPlayTitle || 'How to Play',
      {
        fontSize: 'bold 70px',
        fontFamily: 'outfit',
        fill: '#fff',
      }
    )
    .setOrigin(0.5)
    .setDepth(4);

  const htptext = scene.add
    .text(
      470,
      910,
      scene.textContent.howToPlayDescription ||
      'Tap left or right to jump\nbetween platforms and\ndodge enemies.',
      {
        fontFamily: 'outfit',
        fontSize: '60px',
        fontWeight: '100',
        fill: 'white',
        lineSpacing: 13,
        backgroundColor: '#0B1D26'
      }
    )
    .setOrigin(0.5)
    .setDepth(8);

  scene.target = scene.add
    .text(
      540,
      1160,
      `${scene.textContent.targetLabel || 'Target'}:                                         ${scene.targetScore}`,
      {
        fontFamily: 'outfit',
        fontSize: '60px',
        fontWeight: '400',
        fill: 'white',
      }
    )
    .setOrigin(0.5)
    .setDepth(4);

  const playbtn = scene.add
    .image(540, 1390, 'playbtn1')
    .setOrigin(0.5)
    .setInteractive({ pixelPerfect: true, useHandCursor: true })
    .setDepth(4)
    .setScale(1);

  const taskpanelcontainer = scene.add
    .container(0, 0, [backdrop, taskpanel, scene.level, htptext, scene.target, playbtn])
    .setDepth(4);
  taskpanelcontainer.y = scene.cameras.main.scrollY;

  playbtn.on('pointerover', () => playbtn.setScale(1.1));
  playbtn.on('pointerout', () => playbtn.setScale(1));
  playbtn.on('pointerdown', () => {
    taskpanelcontainer.destroy(); // Destroy container instead of hiding
    scene.startgamenow = 1;
    if (scene.doodler) {
      scene.doodler.body.allowGravity = true;
      scene.physics.world.gravity.y = scene.gravity;
      scene.time.delayedCall(100, () => {
        scene.doodler.body.velocity.y = scene.jumpVelocity;
        console.log('Game started, gravity applied, initial jump triggered');
      });
    } else {
      console.error('Doodler not found when starting game');
    }
  });
}

function setupControls(scene) {
  scene.cursors = scene.input.keyboard.createCursorKeys();
  scene.input.on('pointerdown', (pointer) => {
    if (!scene.gameOver) {
      if (pointer.x < scene.sys.game.config.width / 2) {
        scene.moveLeft = true;
        scene.moveRight = false;
      } else {
        scene.moveLeft = false;
        scene.moveRight = true;
      }
    }
  });
  scene.input.on('pointerup', () => {
    scene.moveLeft = false;
    scene.moveRight = false;
  });
}

function handleInput(scene) {
  if (scene.gameOver || !scene.doodler) return;

  if (scene.cursors.left.isDown || scene.moveLeft) {
    scene.doodler.setVelocityX(-scene.moveSpeed);
    if (
      !scene.doodler.anims.isPlaying ||
      scene.doodler.anims.currentAnim.key !== 'left'
    ) {
      scene.doodler.play('left');
      scene.doodler.flipX = true;
    }
  } else if (scene.cursors.right.isDown || scene.moveRight) {
    scene.doodler.setVelocityX(scene.moveSpeed);
    if (
      !scene.doodler.anims.isPlaying ||
      scene.doodler.anims.currentAnim.key !== 'right'
    ) {
      scene.doodler.play('right');
      scene.doodler.flipX = false;
    }
  } else {
    scene.doodler.setVelocityX(0);
    if (
      !scene.doodler.anims.isPlaying ||
      scene.doodler.anims.currentAnim.key !== 'idle'
    ) {
      scene.doodler.play('idle');
    }
  }
}

function notifyParent(type, data) {
  if (window.parent !== window) {
    window.parent.postMessage({ type, ...data }, "*");
  }
}

function handleWrapping(scene) {
  if (!scene.doodler) return;
  if (scene.doodler.x < 0) {
    scene.doodler.x = width;
  } else if (scene.doodler.x > width) {
    scene.doodler.x = 0;
  }
}