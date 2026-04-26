const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));
export const CONFIG_PATH = `${basePath}/config.json`;

export default class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
    this.waves = [];
    this.boardConsumed = false;
    this.scrollSpeed = 3;
    this.fixedLeaderY = null;
    this.bgScrollPosition = 0;
    this.firstObsLabel = null;
  }

  preload() {
    // Determine base path for assets
    const basePath = import.meta.url.substring(
      0,
      import.meta.url.lastIndexOf('/')
    );

    // Load our JSON config
    this.load.json('game_config', `${basePath}/config.json`);

    this.load.once('filecomplete-json-game_config', () => {
      const cfg = this.cache.json.get('game_config');

      // Load waves from config
      if (Array.isArray(cfg.waves)) {
        this.waves = cfg.waves;
      }

      // Load the hero spritesheet
      const sheets = cfg.sheets || {};
      const heroData = sheets.hero || {};
      const rawMain = new URLSearchParams(window.location.search).get('main') || '';
      const cleanMain = rawMain.replace(/^"|"$/g, '');
      const sheetUrl =
        cleanMain ||
        heroData.url ||
        `${basePath}/assets/hero.png`;

      const frameW = heroData.frameWidth || 103;
      const frameH = heroData.frameHeight || 152;
      this.load.spritesheet('hero', sheetUrl, {
        frameWidth: frameW,
        frameHeight: frameH,
      });

      // Other spritesheets
      if (cfg.spritesheets) {
        for (const [key, sheet] of Object.entries(cfg.spritesheets)) {
          this.load.spritesheet(key, `${basePath}/${sheet.path}`, {
            frameWidth: sheet.frameWidth,
            frameHeight: sheet.frameHeight,
            endFrame: sheet.endFrame || undefined,
          });
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
          this.load.audio(key, `${basePath}/${url}`);
        }
      }

      // Start loading everything
      this.load.start();
    });

    this.load.on('fileerror', (file) => {
      console.error(`Failed to load asset: ${file.key} at ${file.url}`);
    });
  }


  create() {
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock("portrait-primary").catch(() => { });
    }

    if (this.scale.fullscreen.available && !this.scale.isFullscreen) {
      this.scale.startFullscreen();
    }

    const { width, height } = this.scale;

    // 🎵 Audio
    this.bgm = this.sound.add('bgm', { loop: true, volume: 0.5 });
    this.fightMusic = this.sound.add('fight', { loop: true, volume: 0.5 });
    this.bgm.play();

    // 🕺 Animations
    this.anims.create({
      key: 'heroRun',
      frames: this.anims.generateFrameNumbers('hero', { start: 16, end: 17 }),
      frameRate: 8,
      repeat: -1
    });
    this.anims.create({
      key: 'heroFight',
      frames: this.anims.generateFrameNumbers('hero', { start: 16, end: 16 }),
      frameRate: 6,
      repeat: -1
    });
    this.anims.create({
      key: 'obsFight',
      frames: this.anims.generateFrameNumbers('obs', { start: 0, end: 3 }),
      frameRate: 6,
      repeat: -1
    });

    // 📊 State
    this.waveIndex = 0;
    this.players = [];
    this.state = 'run';
    this.score = 0;
    this.boardConsumed = false;

    // 🧮 Score Text
    this.scoreText = this.add.text(width / 2, 16, 'Score: 0', {
      font: '52px outfit',
      fill: '#fff',
      stroke: '#000',
      strokeThickness: 3
    }).setOrigin(0.5, 0).setDepth(1);

    // 🔲 Solid color backup
    this.add.rectangle(0, 0, width, height, 0x333333).setOrigin(0);

    // 🖼️ Background (tileSprite for infinite scroll)
    if (this.textures.exists('background')) {
      this.bg = this.add.tileSprite(0, 0, width, height, 'background').setOrigin(0);
      this.bgScrollPosition = 0;
      // console.log('Background added:', this.bg);
    } else {
      // console.warn('Background texture "bg" not found');
    }

    // 🎮 Groups
    this.playersGroup = this.physics.add.group();
    this.powerups = this.add.group();
    this.obstacles = this.add.group();

    // 👤 Spawn Leader
    spawnLeader(this);
    this.fixedLeaderY = this.players[0].y;
    // console.log('Leader spawned at:', this.players[0].x, this.players[0].y);

    // 🚩 First wave
    nextWave(this);
    // console.log('Powerups after nextWave:', this.powerups.getChildren());

    // 🖱️ Move hero on pointer drag
    this.input.on('pointermove', pointer => {
      const leader = this.players[0];
      leader.x = Phaser.Math.Clamp(pointer.x, 40, width - 40);
    });

    // 📝 Show How To Play screen
    htp(this);

    this.scrollSpeed = 3;
    this.maxScrollSpeed = 12;

    this.time.addEvent({
      delay: 3000,
      loop: true,
      callback: () => {
        if (this.scrollSpeed < this.maxScrollSpeed) {
          this.scrollSpeed = Math.min(this.scrollSpeed + 3, this.maxScrollSpeed);
          // console.log('Scroll speed increased to:', this.scrollSpeed);
        }
      }
    });

  }


  update() {
    const leader = this.players[0];
    leader.y = this.fixedLeaderY;
    if (leader.body) {
      leader.body.setVelocityY(0);
      leader.body.setVelocityX(0);
    }

    const scrollSpeed = Number.isFinite(this.scrollSpeed) ? this.scrollSpeed : 10;

    this.players.forEach((p, index) => {
      // console.log(`Player ${index} position - x: ${p.x}, y: ${p.y}, body x: ${p.body.x}, body y: ${p.body.y}`);
    });

    if (this.state === 'run') {
      // console.log('Scroll speed:', scrollSpeed);

      if (this.bg && this.bg.active) {
        this.bgScrollPosition -= scrollSpeed;
        this.bg.tilePositionY = this.bgScrollPosition;
        // console.log('Background scroll position:', this.bgScrollPosition, 'tilePositionY:', this.bg.tilePositionY);
      }
      // console.log('Powerups in update:', this.powerups.getChildren());
      this.powerups.children.iterate(p => {
        if (p) {
          if (!Number.isFinite(p.posY)) {
            p.posY = Number.isFinite(p.initialY) ? p.initialY : 0;
            // console.log(`Initialized posY for powerup ${p.type} to ${p.posY}`);
          }
          p.posY += scrollSpeed;
          p.y = p.posY;
          // console.log(`Moving powerup ${p.type} to y=${p.y}, posY=${p.posY}`);
          const leaderBounds = leader.getBounds();
          const powerupBounds = p.getBounds();
          if (Phaser.Geom.Intersects.RectangleToRectangle(leaderBounds, powerupBounds) && !this.boardConsumed) {
            // console.log('Manual overlap detected:', p);
            this.boardConsumed = true;
            onBoardPick(this, p);
          }
        }
      });
      this.obstacles.getChildren().forEach(o => {
        if (o) o.y += scrollSpeed;
      });

      const firstObs = this.obstacles.getChildren()[0];
      if (firstObs && firstObs.y >= this.scale.height - 750) {
        this.state = 'fight';
        startBattle(this);
      }
    }

    positionFollowers(this);
  }
}

function spawnLeader(scene) {
  const { width, height } = scene.scale;
  const ctr = scene.add.container(width / 2, height - 100);
  scene.physics.world.enable(ctr);
  ctr.body.setImmovable(true).setAllowGravity(false);

  const spr = scene.add.sprite(0, -250, 'hero')
    .setScale(2)
    .play('heroRun');
  const lbl = scene.add.text(0, -400, '0', {
    font: '52px outfit',
    fill: '#fff',
    stroke: '#000',
    strokeThickness: 3
  }).setOrigin(0.5);

  ctr.add([spr, lbl]);
  ctr.sprite = spr;
  ctr.label = lbl;

  ctr.body.setSize(spr.width, spr.height);
  ctr.body.setOffset(-100, -250 - spr.height / 2);
  // console.log('Leader physics body - width:', ctr.body.width, 'height:', ctr.body.height, 'offsetX:', ctr.body.offset.x, 'offsetY:', ctr.body.offset.y, 'positionX:', ctr.body.x, 'positionY:', ctr.body.y);

  scene.players.push(ctr);
  scene.playersGroup.add(ctr);
}

function spawnFollower(scene) {
  const leader = scene.players[0];
  const ctr = scene.add.container(leader.x, leader.y);
  scene.physics.world.enable(ctr);
  ctr.body.setImmovable(true).setAllowGravity(false);

  const spr = scene.add.sprite(0, 10, 'hero')
    .setScale(0.7)
    .play('heroRun');

  ctr.add([spr]);
  ctr.sprite = spr;

  const scaledHeight = spr.height * 0.7;
  const scaledWidth = spr.width * 0.7;
  ctr.body.setSize(scaledWidth, scaledHeight);
  ctr.body.setOffset(-100, 10 - scaledHeight / 2);
  // console.log('Follower physics body - width:', ctr.body.width, 'height:', ctr.body.height, 'offsetX:', ctr.body.offset.x, 'offsetY:', ctr.body.offset.y, 'positionX:', ctr.body.x, 'positionY:', ctr.body.y);

  scene.players.push(ctr);
  scene.playersGroup.add(ctr);
}

function updateLabels(scene) {
  // console.log('Updating labels. Total followers:', scene.players.length - 1);
  if (scene.players.length > 0) {
    const followerCount = scene.players.length - 1;
    scene.players[0].label.setText(`${followerCount}`);
    // console.log('Leader label updated to:', scene.players[0].label.text);
  }
}

function onBoardPick(scene, pu) {
  scene.powerups.clear(true, true);

  const { type, value: v } = pu;
  // console.log(`Board picked: ${type} with value ${v}`);
  if (type === 'add') {
    for (let i = 0; i < v; i++) spawnFollower(scene);
  } else if (type === 'mul') {
    const cnt = scene.players.length;
    for (let i = 0; i < cnt * (v - 1); i++) spawnFollower(scene);
  } else {
    for (let i = 0; i < v; i++) {
      if (scene.players.length > 1) {
        scene.players.pop().destroy();
      }
    }
    if (scene.players.length <= 1) {
      scene.bgm.stop();
      gameovr(scene);
      return;

    }
  }

  updateLabels(scene);
  scene.time.delayedCall(2000, () => {
    spawnEnemies(scene, scene.waves[scene.waveIndex].enemyCount);
  });
}

function spawnEnemies(scene, count) {
  scene.obstacles.clear(true, true);
  scene.firstObsLabel = null;

  let numRows;
  if (count <= 3) {
    numRows = 1;
  } else if (count <= 6) {
    numRows = 2;
  } else {
    numRows = 3;
  }

  const baseObsPerRow = Math.floor(count / numRows);
  const extraObs = count % numRows;
  let currentObsIndex = 0;

  const rowSpacing = 50;
  const padding = 60;

  for (let row = 0; row < numRows; row++) {
    const obsInThisRow = baseObsPerRow + (row < extraObs ? 1 : 0);
    if (obsInThisRow === 0) break;

    const rowY = -500 + row * rowSpacing;
    const xSpacing = (scene.scale.width - 2 * padding) / (obsInThisRow > 1 ? obsInThisRow - 1 : 1);
    const startX = padding;

    for (let i = 0; i < obsInThisRow; i++) {
      const x = startX + (obsInThisRow > 1 ? i * xSpacing : (scene.scale.width - 2 * padding) / 2);
      const ctr = scene.add.container(x, rowY);
      const spr = scene.add.sprite(0, 0, 'obs', 0)
        .setScale(0.3);

      let lbl;
      if (currentObsIndex === 0) {
        const screenCenterX = scene.scale.width / 2;
        const labelX = screenCenterX - x;
        lbl = scene.add.text(labelX, -200, '', {
          font: '52px outfit',
          fill: '#f00',
          stroke: '#000',
          strokeThickness: 3
        }).setOrigin(0.5);
        scene.firstObsLabel = lbl;
        ctr.add([spr, lbl]);
      } else {
        ctr.add([spr]);
      }

      ctr.sprite = spr;
      ctr.label = lbl;
      scene.obstacles.add(ctr);
      currentObsIndex++;
    }
  }

  const totalObs = scene.obstacles.getLength();
  const firstObs = scene.obstacles.getChildren()[0];
  if (firstObs && firstObs.label) {
    firstObs.label.setText(`-${totalObs}`);
  }
  // console.log(`Spawned ${totalObs} enemies in ${numRows} rows`);
}

function nextWave(scene) {
  scene.boardConsumed = false;
  scene.powerups.clear(true, true);
  scene.obstacles.clear(true, true);

  const wave = scene.waves[scene.waveIndex] || {};
  if (!Array.isArray(wave.boards)) {
    // console.warn('No boards defined for wave', scene.waveIndex);
    return;
  }

  wave.boards.forEach((b, i) => {
    const x = (i === 0 ? 0.25 : 0.75) * scene.scale.width;
    createBoard(scene, x, -60, b.type, b.val);
  });
}

function createBoard(scene, x, y, type, val) {
  const key = type === 'add' ? 'boardAdd'
    : type === 'mul' ? 'boardMul'
      : 'boardSub';
  const txt = (type === 'mul' ? '×' : '') + (type === 'sub' ? -val : val);

  const ctr = scene.add.container(x, y);
  const img = scene.add.image(0, 0, key).setScale(0.7);
  const lbl = scene.add.text(0, 0, txt, {
    font: '52px outfit',
    fill: type === 'add' ? '#0f0' : type === 'mul' ? '#ff0' : '#f55',
    stroke: '#000',
    strokeThickness: 3
  }).setOrigin(0.5);

  ctr.add([img, lbl]);
  ctr.type = type;
  ctr.value = val;
  ctr.initialY = y;
  ctr.posY = y;
  ctr.y = y;
  scene.powerups.add(ctr);
  // console.log(`Created board: ${type} at x=${x}, y=${y}, posY=${ctr.posY}, initialY=${ctr.initialY}, ctr.y=${ctr.y}`);
}

function positionFollowers(scene) {
  const total = scene.players.length;
  if (total <= 1) return;

  const cols = Math.min(18, total - 1); // max columns
  const spacing = 50;
  const padding = 30;
  const rows = Math.ceil((total - 1) / cols);
  const gridW = (cols - 1) * spacing;
  const gridH = (rows - 1) * spacing;

  const centerX = scene.players[0].x; // ✅ Follow leader X
  const startX = Phaser.Math.Clamp(centerX - gridW / 2, padding, scene.scale.width - gridW - padding);

  const startY = scene.fixedLeaderY - gridH - spacing;

  scene.players.slice(1).forEach((ctr, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;

    const tx = Phaser.Math.Clamp(startX + col * spacing, padding, scene.scale.width - padding);
    const ty = Phaser.Math.Clamp(startY + row * spacing, padding, scene.fixedLeaderY - spacing);

    const threshold = 1;
    const dx = Math.abs(ctr.x - tx);
    const dy = Math.abs(ctr.y - ty);

    ctr.x = dx > threshold ? Phaser.Math.Linear(ctr.x, tx, 0.2) : tx;
    ctr.y = dy > threshold ? Phaser.Math.Linear(ctr.y, ty, 0.2) : ty;

    if (ctr.body) {
      ctr.body.setVelocity(0);
    }
  });
}


function startBattle(scene) {
  scene.state = 'fight';
  scene.bgm.setVolume(0.1); // Lower volume at battle start
  scene.fightMusic.play();

  scene.players.forEach(p => p.sprite.play('heroFight'));
  scene.obstacles.getChildren().forEach(o => o.sprite.play('obsFight'));

  const rounds = Math.max(scene.players.length, scene.obstacles.getLength());
  scene.time.addEvent({
    delay: 50,
    repeat: rounds,
    callback: () => {
      if (scene.players.length > 1 && scene.obstacles.getLength()) {
        scene.score++;
        scene.scoreText.setText(`Score: ${scene.score}`);
        scene.players.pop().destroy();
        // console.log('Follower removed in startBattle. Total players:', scene.players.length);
        updateLabels(scene);
        scene.obstacles.getChildren().pop().destroy();
        const totalObs = scene.obstacles.getLength();
        const firstObs = scene.obstacles.getChildren()[0];
        if (firstObs && firstObs.label) {
          firstObs.label.setText(totalObs.toString());
        }
      } else {
        scene.time.removeAllEvents();
        scene.fightMusic.stop();

        if (scene.players.length > 1) {
          // ✅ Player won the fight
          scene.bgm.setVolume(0.5); // Restore volume
          scene.waveIndex++;
          if (scene.waveIndex < scene.waves.length) {
            scene.state = 'run';
            nextWave(scene);
            scene.players.forEach(p => p.sprite.play('heroRun'));
          } else {
            scene.bgm.stop();
            win(scene); // All waves completed
          }
        } else {
          // ❌ Player lost
          scene.bgm.stop(); // Stop background music
          gameovr(scene);
        }
      }
    }
  });
}


function makeEndScene(key, text, color) {
  return {
    key,
    create() {
      this.sound.stopByKey('bgm');
      this.sound.stopByKey('fight');
      const { width, height } = this.scale;
      this.add.text(width / 2, height / 2, text, {
        font: '52px outfit',
        fill: color
      }).setOrigin(0.5);
      this.input.once('pointerup', () => this.scene.start('GameScene'));
    }
  };
}

function htp(scene) {
  // Pause background scroll and game state
  scene.state = 'pause';
  scene.tweens.pauseAll(); // Pause all tweens (e.g., candy movements)
  scene.anims.pauseAll(); // Pause all animations (if any)

  // Dim the background using a transparent overlay (optional)
  const overlay = scene.add.image(0, 0, 'backdrop')
    .setOrigin(0)
    .setDepth(6);

  // Show HTP background and play button
  const htpbg = scene.add.image(scene.scale.width / 2, scene.scale.height / 2 - 100, 'htpbg')
    .setDepth(7)
    .setScale(1); // Adjust scale if needed

  const playbtn = scene.add.image(scene.scale.width / 2, scene.scale.height / 2 + 370, 'playbtn')
    .setDepth(7)
    .setInteractive();

  const htptxt = scene.add.text(190, 710, 'Swipe to guide your player\nthrough series of obstacles\nthat increase or decrease\nits numbers. The higher\nyour number, the further\nyou go!', {
    font: '60px outfit',
    lineSpacing: 5
  }).setDepth(8)
  const htptxt1 = scene.add.text(280, 555, 'How to Play', {
    font: 'bold 70px outfit',
    lineSpacing: 13
  }).setDepth(8)

  // Start game when play is clicked
  playbtn.once('pointerdown', () => {
    overlay.destroy();
    htpbg.destroy();
    playbtn.destroy();
    htptxt.destroy();
    htptxt1.destroy();

    // Resume the game
    scene.state = 'run';
    scene.tweens.resumeAll(); // Resume all tweens
    scene.anims.resumeAll();
  });
}

function gameovr(scene) {

  scene.players.forEach(p => {
    if (p.sprite?.anims) p.sprite.anims.stop();
  });
  scene.obstacles.getChildren().forEach(o => {
    if (o.sprite?.anims) o.sprite.anims.stop();
  });
  const overlay = scene.add.image(0, 0, 'backdrop')
    .setOrigin(0)
    .setDepth(6);

  const ovrbg = scene.add.image(scene.scale.width / 2, 760, 'ovrbg').setDepth(7);

  const ovrxt = scene.add.text(380, 720, 'Game Over', {
    font: 'bold 70px outfit'
  }).setDepth(8);

  const ovrbtn = scene.add.image(scene.scale.width / 2, 960, 'ovrbtn')
    .setDepth(7)
    .setInteractive();

  ovrbtn.once('pointerdown', () => {
    overlay.destroy();
    ovrbg.destroy();
    ovrxt.destroy();
    ovrbtn.destroy();
    scene.scene.restart(); // ⬅️ Restart the GameScene
  });
}
function notifyParent(type, data) {
  if (window.parent !== window) {
    window.parent.postMessage({ type, ...data }, "*");
  }
}

function win(scene) {

  scene.players.forEach(p => {
    if (p.sprite?.anims) p.sprite.anims.stop();
  });

  const overlay = scene.add.image(0, 0, 'backdrop')
    .setOrigin(0)
    .setDepth(6);


  const lvlrestart = scene.add.image(320, 960, 'lvlrestart')
    .setDepth(7)
    .setInteractive();

  const nxtlvl = scene.add.image(770, 960, 'nxtlvl')
    .setDepth(7)
    .setInteractive();

  const lvlbg = scene.add.image(scene.scale.width / 2, 760, 'lvlbg').setDepth(7);

  const lvlxt = scene.add.text(380, 720, 'Level Completed', {
    font: 'bold 70px outfit'
  }).setDepth(8);


  nxtlvl.on('pointerdown', () => {
    notifyParent('sceneComplete', { result: 'win' });
  });

  lvlrestart.on('pointerdown', () => {
    scene.scene.restart();

  });
}



export const GameOverScene = makeEndScene('GameOver', 'GAME OVER', '#f00');
export const WinScene = makeEndScene('Win', 'YOU WIN!', '#0f0');