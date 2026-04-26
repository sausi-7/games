const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));
export const CONFIG_PATH = `${basePath}/config.json`;
const width = 1080;
const height = 1920;

export default class GamePlayScene extends Phaser.Scene {
  constructor() {
    super('GamePlayScene');
    this.bird = null;
    this.pipes = null;
    this.score = 0;
    this.highScore = localStorage.getItem('flappyHighScore') || 0;
    this.scoreText = null;
    this.highScoreText = null;
    this.gameOver = false;
    this.ground = null;
    this.background = null;
    this.isGameStarted = false;
    this.sounds = {};
    this.startMessage = null;
    this.level = null;
    this.target = null;
    this.startgamenow = 0;
    this.config = null;
    this.targetscore = 0;
    this.pipeSpeed = 300;
    this.gap = 300;
    this.levelClearedTriggered = false;
  }

  preload() {
    // Load configuration JSON
    this.load.json('config12', CONFIG_PATH);

    // Once config is loaded, dynamically load all assets
    this.load.once('filecomplete-json-config12', () => {
      // Retrieve parsed configuration
      this.config = this.cache.json.get('config12');
      this.textContent = this.config.text || {};

      // Load images (background, pipes, ui, etc.)
      if (this.config.images2) {
        Object.entries(this.config.images2).forEach(([key, url]) => {
          const path = url.startsWith('http') ? url : `${basePath}/${url}`;
          this.load.image(key, path);
        });
      }

      if (this.config.ui) {
        Object.entries(this.config.ui).forEach(([key, url]) => {
          const path = url.startsWith('http') ? url : `${basePath}/${url}`;
          this.load.image(key, path);
        });
      }

      // Load audio
      if (this.config.audio) {
        Object.entries(this.config.audio).forEach(([key, url]) => {
          const path = url.startsWith('http') ? url : `${basePath}/${url}`;
          this.load.audio(key, path);
        });
      }

      // ✅ Load the single player image instead of a spritesheet
      // Prefer config-defined path (images2.player), fallback to /player.png beside the scene
      const playerUrlFromConfig =
        (this.config.images1 && this.config.images1.player) ||
        (this.config.images1 && this.config.images1.player);
      const playerPath = playerUrlFromConfig
        ? (playerUrlFromConfig.startsWith('http') ? playerUrlFromConfig : `${basePath}/${playerUrlFromConfig}`)
        : `${basePath}/player.png`;
      this.load.image('player', playerPath);

      // Start loading the queued assets
      this.load.start();
    });
  }

  create() {
    // Lock to portrait and request fullscreen
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('portrait-primary').catch(() => { });
    }
    if (this.scale.fullscreen.available && !this.scale.isFullscreen) {
      this.scale.startFullscreen();
    }

    // Initialize sounds
    this.sounds = {};
    Object.keys(this.config.audio || {}).forEach(key => {
      this.sounds[key] = this.sound.add(key);
    });

    // Keep audio alive even if tab loses focus (optional but handy for mobile webviews)
    this.sound.pauseOnBlur = false;

    // 🔊 Start (or reuse) looping BGM
    const bgmKey = 'bgm'; // key from config.audio
    let bgm = this.sound.get(bgmKey);

    if (!bgm) {
      // we didn't add it earlier on this AudioManager, add + play
      bgm = this.sound.add(bgmKey, { loop: true, volume: 0.6 });
      bgm.play();
    } else if (!bgm.isPlaying) {
      // already exists (e.g., scene restart), ensure it's playing
      bgm.play({ loop: true, volume: bgm.volume ?? 0.6 });
    }

    // keep a reference for later
    this.sounds.bgm = bgm;


    // Create pipe group
    // Create pipe group
    this.pipes = this.physics.add.group();

    // Track score zones and the recurring pipe timer
    this.scoreZonesGroup = this.add.group();
    this._pipeTimer = null;

    // Level parameters
    const level1 = this.config.level1 || {};
    this.targetscore = level1.targetscore || 3;
    this.pipeSpeed = level1.pipeSpeed || 300;
    this.gap = level1.gap || 300;

    // Background
    this.background = this.add
      .tileSprite(540, 900, width, height, 'background')
      .setDisplaySize(width, height)
      .setDepth(0);

    // Ground
    this.ground = this.add
      .tileSprite(540, 1800, width, 200, 'ground')
      .setDisplaySize(width, 400)
      .setDepth(2);
    this.physics.add.existing(this.ground, true);


    // Setup game objects and UI
    createBird(this, { hidden: true });   // ⬅️ bird + message start hidden
    createColliders(this);
    createScore(this, this.config);
    taskpanel(this, this.config);


    // Input handling
    this.input.addPointer(2);
    this.input.on('pointerup', () => {
      if (this.scale.fullscreen.available && !this.scale.isFullscreen) {
        this.scale.startFullscreen();
      }
    });
  }

  update() {
    if (this.gameOver) return;

    if (this.isGameStarted) {
      this.background.tilePositionX += 3;
      this.ground.tilePositionX += 3;
    } else if (this.bird) {
      this.bird.y = 640 + Math.sin(this.time.now * 0.003) * 40;
    }

    if (this.bird && (this.bird.y < 0 || this.bird.y > height - 200)) {
      gameOverHandler(this, this.config);
    }
  }
}

// ---------------- helpers ----------------

function resetGame(scene, config) {
  stopBreathing(scene);
  scene.score = 0;
  scene.gameOver = false;
  scene.isGameStarted = false;
  scene.startgamenow = 0;
  scene.levelClearedTriggered = false;

  // No sprite animations now, but keep guard
  if (scene.anims && scene.anims.exists && scene.anims.exists('flap')) {
    scene.anims.remove('flap');
  }

  if (scene.bird) {
    scene.bird.destroy();
    scene.bird = null;
  }

  if (scene.pipes) {
    scene.pipes.getChildren().forEach(pipe => pipe.destroy());
    scene.pipes.clear(true, true);
  }

  if (scene.startMessage) { scene.startMessage.destroy(); scene.startMessage = null; }
  if (scene.scoreText) { scene.scoreText.destroy(); scene.scoreText = null; }
  if (scene.highScoreText) { scene.highScoreText.destroy(); scene.highScoreText = null; }
  if (scene.level) { scene.level.destroy(); scene.level = null; }
  if (scene.target) { scene.target.destroy(); scene.target = null; }

  if (scene.physics.world && scene.physics.world.colliders) {
    scene.physics.world.colliders.destroy();
  }
}

function restartBGM(scene) {
  const bgm = scene?.sounds?.bgm || scene.sound.get('bgm');
  if (bgm) {
    const vol = bgm.volume ?? 0.6;
    bgm.stop();              // stop current loop
    bgm.play({ loop: true, volume: vol }); // play from start
  }
}

// ---- idle breathing helpers ----
// ---- idle/play breathing helper (mode-aware) ----
function startBreathing(scene, mode = 'idle') {
  if (!scene?.bird || !scene?.tweens) return;

  // Ensure no leftovers from a prior scene instance
  stopBreathing(scene);
  try { scene.tweens.killTweensOf(scene.bird); } catch (_) { }

  const base = 1.3;
  const amp = (mode === 'play') ? 0.02 : 0.04;
  const tilt = (mode === 'play') ? 1 : 2;
  const dur = (mode === 'play') ? 650 : 900;

  scene.bird.setScale(base);

  scene.birdBreathTween = scene.tweens.add({
    targets: scene.bird,
    scaleX: base * (1 + amp) + 0.1, // keep your offset if you want it
    scaleY: base * (1 - amp) + 0.1,
    duration: dur,
    yoyo: true,
    ease: 'Sine.inOut',
    repeat: -1
  });

  scene.birdBreathTilt = scene.tweens.add({
    targets: scene.bird,
    angle: tilt,
    duration: dur,
    yoyo: true,
    ease: 'Sine.inOut',
    repeat: -1
  });
}



function stopBreathing(scene) {
  // Safely stop + remove by using the TweenManager
  if (scene?.birdBreathTween) {
    try { scene.birdBreathTween.stop(); } catch (_) { }
    if (scene.tweens) { try { scene.tweens.remove(scene.birdBreathTween); } catch (_) { } }
    scene.birdBreathTween = null;
  }
  if (scene?.birdBreathTilt) {
    try { scene.birdBreathTilt.stop(); } catch (_) { }
    if (scene.tweens) { try { scene.tweens.remove(scene.birdBreathTilt); } catch (_) { } }
    scene.birdBreathTilt = null;
  }

  // Also kill any residual tweens targeting the bird (belt & suspenders)
  if (scene?.tweens && scene?.bird) {
    try { scene.tweens.killTweensOf(scene.bird); } catch (_) { }
  }

  if (scene?.bird) {
    scene.bird.setScale(1.3).setAngle(0);
  }
}




function createBird(scene, { hidden = false } = {}) {
  // Ensure the player texture is present
  if (!scene.textures.exists('player')) {
    console.warn('player.png not loaded yet');
    return;
  }

  // Create a physics sprite using the single-frame image
  scene.bird = scene.physics.add.sprite(200, 640, 'player')
    .setCollideWorldBounds(true)
    .setScale(1.3)
    .setBounce(0)
    .setDragY(50)
    .setDepth(3);

  // Physics setup
  scene.bird.body.allowGravity = false;

  // Tighter body size
  const tex = scene.textures.get('player').getSourceImage();
  const bw = tex ? tex.width : 100;
  const bh = tex ? tex.height : 100;
  scene.bird.body.setSize(Math.floor(bw * 0.9), Math.floor(bh * 0.9))
    .setOffset(Math.floor(bw * 0.05), Math.floor(bh * 0.05));

  // Start message (hidden by default if requested)
  scene.startMessage = scene.add.image(540, 960, 'message')
    .setScale(2.5)
    .setDepth(4);

  if (hidden) {
    scene.bird.setVisible(false).setActive(false);
    scene.startMessage.setVisible(false).disableInteractive?.();
  }
}


function createColliders(scene) {
  scene.physics.add.collider(scene.bird, scene.pipes, () => gameOverHandler(scene, scene.config), null, scene);
  scene.physics.add.collider(scene.bird, scene.ground, () => gameOverHandler(scene, scene.config), null, scene);
}

function createScore(scene, config) {
  if (typeof scene.score !== 'number') {
    scene.score = 0;
  }

  scene.scoreText = scene.add.text(540, 100, scene.score.toString(), {
    fontFamily: 'outfit',
    fontSize: '128px',
    fill: '#fff',
    fontStyle: 'bold'
  })
    .setOrigin(0.5)
    .setDepth(4);

  scene.highScoreText = scene.add.text(540, 200, ``, {
    fontFamily: 'outfit',
    fontSize: '64px',
    fill: '#fff',
    fontStyle: 'bold'
  }).setOrigin(0.5).setDepth(4);
}

function handleClick(scene) {
  if (scene.startgamenow === 1) {
    if (!scene.isGameStarted) {
      startGame(scene, scene.config);
    } else if (!scene.gameOver) {
      flapBird(scene, scene.config);
    }
  }
}

function startGame(scene, config) {
  startBreathing(scene, 'play');  // <-- add this (don’t stop breathing)
  scene.isGameStarted = true;
  if (scene.startMessage) { scene.startMessage.destroy(); scene.startMessage = null; }
  scene.bird.body.allowGravity = true;
  scene.bird.setGravityY(800);
  flapBird(scene, scene.config);
  createPipe(scene, scene.config);
}


function flapBird(scene, config) {
  if (!scene.bird || scene.gameOver) return;
  scene.bird.setVelocityY(-400);
  if (scene.sounds.flap) scene.sounds.flap.play();
}

function createPipe(scene, config) {
  if (scene.gameOver) return;

  const pipeWidth = 104;
  const pipeHeight = 960;
  const x = width;
  const y = Phaser.Math.Between(scene.gap + 200, height - scene.gap - 600);

  const topPipe = scene.pipes.create(x, y - scene.gap / 2 - pipeHeight / 2, 'pipe')
    .setImmovable(true)
    .setVelocityX(-scene.pipeSpeed)
    .setScale(2, pipeHeight / 320)
    .setFlipY(true)
    .setDepth(1);
  topPipe.body.setAllowGravity(false);

  const bottomPipe = scene.pipes.create(x, y + scene.gap / 2 + pipeHeight / 2, 'pipe')
    .setImmovable(true)
    .setVelocityX(-scene.pipeSpeed)
    .setScale(2, pipeHeight / 320)
    .setDepth(1);
  bottomPipe.body.setAllowGravity(false);

  const scoreZone = scene.add.zone(x + pipeWidth / 2, y, 10, scene.gap);
  scene.physics.world.enable(scoreZone);
  scoreZone.body
    .setImmovable(true)
    .setVelocityX(-scene.pipeSpeed)
    .setAllowGravity(false);
  scoreZone.scored = false;

  // ⭐ track zones so we can destroy them on win/game-over
  if (scene.scoreZonesGroup) scene.scoreZonesGroup.add(scoreZone);

  scene.physics.add.overlap(scene.bird, scoreZone, (_, zone) => {
    if (!zone.scored) {
      zone.scored = true;
      updateScore(scene, scene.config);
    }
  }, null, scene);

  // ⭐ keep a handle so we can cancel on win/game-over
  scene._pipeTimer = scene.time.delayedCall(1500, () => createPipe(scene, scene.config));
}


function updateScore(scene, config) {
  scene.score++;
  scene.scoreText.setText(scene.score.toString());
  if (scene.sounds.score) scene.sounds.score.play();

  if (scene.score >= scene.targetscore && !scene.levelClearedTriggered) {
    scene.levelClearedTriggered = true;
    scene.time.delayedCall(500, () => {
      scene.physics.pause();
      levelcleared(scene, scene.config);
    });
  }
}

function destroyPipesAndZones(scene) {
  // Stop next scheduled pipe spawn (if any)
  if (scene._pipeTimer && scene._pipeTimer.remove) {
    scene._pipeTimer.remove(false);
    scene._pipeTimer = null;
  }

  // Destroy all pipes
  if (scene.pipes) {
    scene.pipes.getChildren().forEach(p => p.destroy());
    scene.pipes.clear(true, true);
  }

  // Destroy all score zones
  if (scene.scoreZonesGroup) {
    scene.scoreZonesGroup.getChildren().forEach(z => {
      if (z.body && z.body.destroy) z.body.destroy();
      z.destroy();
    });
    scene.scoreZonesGroup.clear(true, true);
  }
}

function destroyPlayer(scene) {
  stopBreathing(scene); 
  if (scene.bird) {
    // disable physics body first to avoid callbacks
    if (scene.bird.disableBody) scene.bird.disableBody(true, true);
    scene.bird.destroy();
    scene.bird = null;
  }
}


function gameOverHandler(scene, config) {
  if (scene.gameOver) return;
  // Immediately clean up dynamic gameplay entities



  scene.gameOver = true;
  scene.isGameStarted = false;
  scene.physics.pause();

  stopBreathing(scene);

  destroyPipesAndZones(scene);
  destroyPlayer(scene);

  // No animations now; guard anyway
  if (scene.bird && scene.bird.anims && scene.bird.anims.stop) {
    scene.bird.anims.stop();
  }

  if (scene.startMessage) {
    scene.startMessage.destroy();
    scene.startMessage = null;
  }

  const backdrop = scene.add.image(0, 0, 'backdrop').setOrigin(0).setDepth(4).setInteractive();
  const gameOverImage = scene.add.image(540, 800, 'gameover').setScale(0.55, 0.8).setDepth(4);

  scene.add.text(530, 800,
    `${scene.textContent.targetScore || 'Target: '}                                       ${scene.targetscore}`,
    { fontFamily: 'outfit', fontSize: '60px', fontWeight: '400', color: '#fff' }
  ).setOrigin(0.5).setDepth(4);

  scene.add.text(530, 960,
    `${scene.textContent.yourScore || 'Your Score: '}                                 ${scene.score}`,
    { fontFamily: 'outfit', fontSize: '60px', fontWeight: '400', color: '#fff' }
  ).setOrigin(0.5).setDepth(4);

  scene.gameovertxt1 = scene.add.text(540, 650,
    scene.textContent.gameOver || 'Game Over',
    { fontFamily: 'outfit', fontSize: 'bold 70px', fontWeight: '500', color: '#fff' }
  )
    .setOrigin(0.5)
    .setDepth(4)
    .setScrollFactor(0);

  const restartButton = scene.add.image(540, 1300, 'restart')
    .setScale(1)
    .setDepth(4)
    .setInteractive();

  restartButton.on('pointerover', () => restartButton.setScale(1.1));
  restartButton.on('pointerout', () => restartButton.setScale(1));
  restartButton.on('pointerdown', () => {
    // 🔁 restart music only here
    restartBGM(scene);

    resetGame(scene, scene.config);
    scene.scene.restart();
  });


  function stopBGM(scene) {
    const bgm = scene?.sounds?.bgm || scene.sound.get('bgm');
    if (bgm && bgm.isPlaying) bgm.stop();
  }

}

function levelcleared(scene, config) {

  const cam = scene.cameras.main;

  destroyPipesAndZones(scene);
  destroyPlayer(scene);

  scene.add.image(0, 0, 'backdrop')
    .setOrigin(0)
    .setDepth(4)
    .setInteractive();

  scene.add.image(cam.centerX, cam.centerY - 30, 'lvlboard').setScale(0.55, 0.4)
    .setDepth(5);

  scene.add.text(cam.centerX, cam.centerY,
    scene.textContent.levelCleared || 'Level Completed',
    { fontFamily: 'outfit', fontSize: '70px', fontWeight: '500', color: '#fff' }
  ).setOrigin(0.5).setDepth(5);


  const nextButton = scene.add.image(cam.centerX + 250, cam.centerY + 300, 'nxtlvl')
    .setOrigin(0.5)
    .setScale(1)
    .setInteractive({ pixelPerfect: true, useHandCursor: true })
    .setDepth(5);

  nextButton.on('pointerover', () => nextButton.setScale(1.1));
  nextButton.on('pointerout', () => nextButton.setScale(1));
  nextButton.on('pointerdown', () => {
    // stopBGM(scene);
    scene.physics.pause();
    scene.scene.stop();

    resetGame(scene, scene.config);
    // ✅ Do NOT restart BGM here (music keeps playing)
    notifyParent('sceneComplete', { result: 'win' });
  });

  const replayButton = scene.add.image(cam.centerX - 250, cam.centerY + 300, 'restart1')
    .setOrigin(0.5)
    .setScale(1)
    .setInteractive({ pixelPerfect: true, useHandCursor: true })
    .setDepth(5);
  replayButton.on('pointerover', () => replayButton.setScale(1.1));
  replayButton.on('pointerout', () => replayButton.setScale(1));
  replayButton.on('pointerdown', () => {
    restartBGM(scene);              // 🔁 restart track now
    resetGame(scene, scene.config);
    scene.scene.restart();
  });
}

function notifyParent(type, data) {
  if (window.parent !== window) {
    window.parent.postMessage({ type, ...data }, "*");
  }
}

function taskpanel(scene, config) {
  const backdrop = scene.add.image(0, 0, 'backdrop').setOrigin(0).setInteractive().setDepth(3);
  const panel = scene.add.image(540, 800, 'taskpanel').setDepth(5).setScale(0.55, 0.8);

  const target = scene.add.text(540, 1030,
    `${config.text?.targetLabel || 'Target: '}                                         ${scene.targetscore}`,
    { fontFamily: 'outfit', fontSize: '60px', fontWeight: '900', color: '#fff' }
  ).setOrigin(0.5).setDepth(8);

  const htptext = scene.add.text(375, 700,
    config.text?.tapInstructions || 'Control:',
    { fontFamily: 'outfit', fontSize: '60px', fontWeight: '400', fill: 'white', lineSpacing: 13 }
  ).setOrigin(0.5).setDepth(8);

  const htptext12 = scene.add.text(275, 860,
    config.text?.tapInstructions1 || 'Avoid:',
    { fontFamily: 'outfit', fontSize: '60px', fontWeight: '400', fill: 'white', lineSpacing: 13 }
  ).setOrigin(0.5).setDepth(8);

  const htptext1 = scene.add.text(540, 580,
    config.text?.howToPlay || 'How to Play',
    { fontFamily: 'outfit', fontSize: 'bold 70px', fontWeight: '400', fill: '#fff' }
  ).setOrigin(0.5).setDepth(5);

  const img = scene.add.image(740, 700, 'player').setScale(1.5).setDepth(8);

  const img1 = scene.add.image(440, 850, 'pipe').setScale(1.5, 0.4).setDepth(8);


  const playbtn = scene.add.image(540, 1260, 'playbtn1')
    .setOrigin(0.5)
    .setScale(1)
    .setInteractive({ pixelPerfect: true, useHandCursor: true });

  backdrop.setDepth(3);
  panel.setDepth(5);
  playbtn.setDepth(5);

  playbtn.on('pointerover', () => playbtn.setScale(1.1));
  playbtn.on('pointerout', () => playbtn.setScale(1));
  playbtn.on('pointerdown', () => {
    // Clean overlay
    backdrop.destroy();
    panel.destroy();
    playbtn.destroy();
    htptext.destroy();
    htptext12.destroy();
    htptext1.destroy();
    img.destroy();
    img1.destroy();
    target.destroy();

    // ✅ Reveal player and message now
    if (!scene.bird || !scene.startMessage) {
      createBird(scene, { hidden: false });
      startBreathing(scene, 'idle');   // <-- add this line here too
    } else {
      scene.bird.setVisible(true).setActive(true);
      scene.startMessage.setVisible(true);
      startBreathing(scene, 'idle');   // <-- already had start; change to 'idle'
    }

    // Make sure bird is in idle pose (no gravity yet)
    scene.isGameStarted = false;
    scene.bird.body.allowGravity = false;
    scene.bird.setVelocity(0, 0);

    // Allow “tap to start / flap”
    scene.startgamenow = 1;

    // Avoid stacking multiple listeners if user re-opens panel later
    scene.input.off('pointerdown', handleClick, scene);
    scene.input.on('pointerdown', () => handleClick(scene), scene);
  });

}
