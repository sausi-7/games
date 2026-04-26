export default class FuryScene extends Phaser.Scene {
  constructor() {
    super('FuryScene');
    Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach(fn => {
      if (typeof this[fn] === 'function') this[fn] = this[fn].bind(this);
    });
    this.assetsReady = false;
    this.configReady = false;
    this.bgmSound = null;
    this.enemyOverlap = null;
  }

  notifyParent(type, data) {
    if (window.parent !== window) {
      window.parent.postMessage({ type, ...data }, "*");
    }
  }

  preload() {
    const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));
    this.load.json('levelConfig', `${basePath}/config.json`);

    this.load.on('loaderror', (file) => {
      console.warn('[Loader Error]', file?.key, file?.type, file?.src);
    });

    this.load.once('filecomplete-json-levelConfig', () => {
      const cfg = this.cache.json.get('levelConfig') || {};
      this.levelConfig = cfg;

      const sp = new URLSearchParams(window.location.search);
      const rawMain = sp.get('main') || '';
      const decodedMain = rawMain ? decodeURIComponent(rawMain).replace(/^"|"$/g, '') : '';
      const hasMainParam = decodedMain.trim().length > 0;

      if (cfg.images1) {
        for (const [key, url] of Object.entries(cfg.images1)) {
          if (String(key).toLowerCase() === 'hero' && hasMainParam) continue;
          this.load.image(key, `${basePath}/${url}`);
        }
      }
      if (cfg.images2) {
        for (const [key, url] of Object.entries(cfg.images2)) {
          if (String(key).toLowerCase() === 'hero' && hasMainParam) continue;
          this.load.image(key, `${basePath}/${url}`);
        }
      }
      if (cfg.ui) {
        for (const [key, url] of Object.entries(cfg.ui)) {
          if (String(key).toLowerCase() === 'hero' && hasMainParam) continue;
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


      if (cfg.sheets) {
        for (const [key, sheet] of Object.entries(cfg.sheets)) {
          if (String(key).toLowerCase() === 'hero') continue;
          this.load.spritesheet(key, `${basePath}/${sheet.url}`, sheet.frameConfig);
        }
      }

      this.load.once('complete', () => {
        this.assetsReady = true;
        if (this.scene.isActive()) this.create();
      });

      this.load.start();
      this.configReady = true;
    });
  }

  create() {
    const levelData = this.cache.json.get('levelConfig');
    this.levelData = levelData;

    if (levelData.orientation?.frame === 'landscape' && screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('landscape-primary')
        .catch(err => console.warn('Orientation lock failed:', err));
    }

    if (!this.assetsReady || !this.levelConfig) {
      this.time.delayedCall(30, this.create, [], this);
      return;
    }

    const cfg = this.levelConfig;
    this.orientation = cfg.orientation;
    this.gameConfig = cfg.game;
    this.colors = cfg.colors;
    this.texts = cfg.texts;
    this.images = cfg.images;
    this.gameW = this.orientation.width;
    this.gameH = this.orientation.height;

    // ---- BGM: start as soon as scene is ready ----
    if (!this.bgmSound && this.sound && this.cache.audio.exists('bgm')) {
      this.bgmSound = this.sound.add('bgm', { loop: true, volume: 0.4 });
      this.bgmSound.play();
    }


    // ADD THE GAME BACKGROUND IMMEDIATELY — NO BLACK FLASH
    if (this.sys.textures.exists('background')) {
      this.add.image(this.gameW / 2, this.gameH / 2, 'background')
        .setDisplaySize(this.gameW, this.gameH)
        .setDepth(-10);
    }

    this.createStartOverlay();
    this.createGameOverOverlay();
    this.createLevelCompleteOverlay();
    this.hideOverlays();
    this.showStart();

    this.input.on('pointerdown', pointer => {
      if (this.gameState === 'playing') this.handleShoot(pointer.x, pointer.y);
    });
  }

  // --- Overlays ---
  createStartOverlay() {
    const { gameW, gameH, texts } = this;
    this.startOverlay = this.add.container(gameW / 2, gameH / 2);

    // ---- FULLSCREEN BACKGROUND: htpbg (fallback: none) ----
    let bgBehind = null;
    if (this.sys.textures.exists('htpbg')) {
      bgBehind = this.add.image(0, 0, 'htpbg');
      const sx = gameW / bgBehind.width;
      const sy = gameH / bgBehind.height;
      bgBehind.setScale(Math.max(sx, sy));
    }

    // ---- FOREGROUND PANEL (same start_overlay as before) ----
    let panel;
    if (this.sys.textures.exists('start_overlay')) {
      panel = this.add.image(0, -50, 'start_overlay').setScale(0.5, 0.6);
    } else {
      panel = this.add.rectangle(0, -50, 900, 600, 0x000022, 0.9);
    }

    const howToPlayTitle = this.add.text(0, -200, 'HOW TO PLAY', {
      font: '80px outfit', color: '#fff', fontStyle: 'bold'
    }).setOrigin(0.5);

    const title = this.add.text(0, -120, texts.title, {
      font: '60px outfit', color: '#fff', fontStyle: 'bold'
    }).setOrigin(0.5);

    const targetScore = this.gameConfig?.scoreToWin || 9999;
    const desc = this.add.text(
      -340,
      -40,
      `Defend:`,
      { font: '50px outfit', color: '#fff', align: 'center' }
    ).setOrigin(0.5);

    const desc1 = this.add.text(
      +160,
      -40,
      `Destroy:`,
      { font: '50px outfit', color: '#fff', align: 'center' }
    ).setOrigin(0.5);

    const desc2 = this.add.text(
      -10,
      100,
      `Tap to Shoot`,
      { font: '50px outfit', color: '#fff', align: 'center' }
    ).setOrigin(0.5);

    const playBtn = this.add.image(0, 320, 'button_play')
      .setDisplaySize(950, 150)
      .setInteractive();
    const playLabel = this.add.text(0, 140, texts.startBtn, {
      font: '40px outfit', color: '#000'
    }).setOrigin(0.5);

    const img = this.add.image(-90, -50, 'plane').setScale(0.5)
    const img1 = this.add.image(340, -40, 'enemy').setScale(0.15)

    playBtn.on('pointerdown', () => {
      this.hideOverlays();
      this.startGame();
    });

    const children = [];
    if (bgBehind) children.push(bgBehind);
    children.push(panel, howToPlayTitle, title, desc, desc2, desc1, playBtn, playLabel, img, img1);

    this.startOverlay.add(children);
    this.startOverlay.setDepth(1000).setVisible(false);
  }


  createGameOverOverlay() {
    const { gameW, gameH, texts } = this;
    this.gameOverOverlay = this.add.container(gameW / 2, gameH / 2);

    // ---- FULLSCREEN BACKGROUND: ovrbg (fallback: none) ----
    let bgBehind = null;
    if (this.sys.textures.exists('ovrbg')) {
      bgBehind = this.add.image(0, 0, 'ovrbg');
      const sx = gameW / bgBehind.width;
      const sy = gameH / bgBehind.height;
      bgBehind.setScale(Math.max(sx, sy));
    }

    // ---- FOREGROUND PANEL (reuse start_overlay) ----
    let panel;
    if (this.sys.textures.exists('start_overlay')) {
      panel = this.add.image(0, -50, 'start_overlay').setScale(0.5, 0.6);
    } else {
      panel = this.add.rectangle(0, -50, 900, 600, 0x330000, 0.9);
    }

    const gameOverTitle = this.add.text(0, -100, 'GAME OVER', {
      font: '80px outfit', color: '#fff', fontStyle: 'bold'
    }).setOrigin(0.5);

    const overText = this.add.text(0, 0, texts.gameOver, {
      font: '50px outfit', color: '#fff'
    }).setOrigin(0.5);

    const retryBtn = this.add.image(0, 320, 'replay')
      .setDisplaySize(930, 160)
      .setInteractive();
    const retryLabel = this.add.text(0, 120, texts.retry, {
      font: '40px outfit', color: '#000'
    }).setOrigin(0.5);

    retryBtn.on('pointerdown', () => {
      console.log('Retry button clicked');
      this.restartGame();
    });

    const children = [];
    if (bgBehind) children.push(bgBehind);
    children.push(panel, gameOverTitle, overText, retryBtn, retryLabel);

    this.gameOverOverlay.add(children);
    this.gameOverOverlay.setDepth(1000).setVisible(false);
  }


  createLevelCompleteOverlay() {
    const { gameW, gameH, texts } = this;
    this.levelCompleteOverlay = this.add.container(gameW / 2, gameH / 2);

    // ---- FULLSCREEN BACKGROUND: winbg (fallback: none) ----
    let bgBehind = null;
    if (this.sys.textures.exists('winbg')) {
      bgBehind = this.add.image(0, 0, 'winbg');
      const sx = gameW / bgBehind.width;
      const sy = gameH / bgBehind.height;
      bgBehind.setScale(Math.max(sx, sy));
    }

    // ---- FOREGROUND PANEL (reuse start_overlay) ----
    let panel;
    if (this.sys.textures.exists('start_overlay')) {
      panel = this.add.image(0, -50, 'start_overlay').setScale(0.5, 0.6);
    } else {
      panel = this.add.rectangle(0, -50, 900, 600, 0x003300, 0.9);
    }

    const levelCompleteTitle = this.add.text(0, -50, 'LEVEL COMPLETED', {
      font: '80px outfit', color: '#fff', fontStyle: 'bold'
    }).setOrigin(0.5);

    const winText = this.add.text(0, 40, texts.win, {
      font: '50px outfit', color: '#fff'
    }).setOrigin(0.5);

    const playAgainBtn = this.add.image(-235, 280, 'button_retry')
      .setDisplaySize(440, 100)
      .setInteractive();
    const next = this.add.image(235, 280, 'next')
      .setDisplaySize(440, 100)
      .setInteractive();
    const playAgainLabel = this.add.text(0, 120, texts.playAgain, {
      font: '40px outfit', color: '#000'
    }).setOrigin(0.5);

    playAgainBtn.on('pointerdown', () => {
      console.log('Play again button clicked');
      this.restartGame();
    });

    next.on('pointerdown', () => {
      this.hideOverlays();
      this.notifyParent('sceneComplete', { result: 'win' });
    });

    const children = [];
    if (bgBehind) children.push(bgBehind);
    children.push(panel, levelCompleteTitle, winText, playAgainBtn, next, playAgainLabel);

    this.levelCompleteOverlay.add(children);
    this.levelCompleteOverlay.setDepth(1000).setVisible(false);
  }



  hideOverlays() {
    if (this.startOverlay) this.startOverlay.setVisible(false);
    if (this.gameOverOverlay) this.gameOverOverlay.setVisible(false);
    if (this.levelCompleteOverlay) this.levelCompleteOverlay.setVisible(false);
  }

  showStart() {
    this.gameState = 'start';
    this.hideOverlays();
    this.startOverlay.setVisible(true);
  }

  // --- Main Game ---
  startGame() {
    // if (this.bgmSound) {
    //   this.bgmSound.stop();
    //   this.bgmSound.destroy();
    // }
    // if (this.sound && this.cache.audio.exists('bgm')) {
    //   this.bgmSound = this.sound.add('bgm', { loop: true, volume: 0.4 });
    //   this.bgmSound.play();
    // }

    this.destroyAllOverlays();
    this.cleanupAllUIElements();

    this.gameState = 'playing';
    this.gameW = this.orientation.width;
    this.gameH = this.orientation.height;

    // Background
    if (this.sys.textures.exists('background')) {
      this.add.image(this.gameW / 2, this.gameH / 2, 'background')
        .setDisplaySize(this.gameW, this.gameH)
        .setDepth(-10);
    }


    // --- Static Plane ---
    if (this.sys.textures.exists('plane')) {
      this.plane = this.add.image(this.gameW / 2, this.gameH / 2, 'plane').setDepth(10);
    }

    // --- Invisible Collider ---
    this.centerCollider = this.add.rectangle(this.gameW / 2, this.gameH / 2, 120, 120);
    this.physics.add.existing(this.centerCollider);
    this.centerCollider.body.setImmovable(true);
    this.centerCollider.body.setAllowGravity(false);

    // Groups
    this.enemies?.clear(true, true);
    this.rockets?.clear(true, true);
    this.enemies = this.physics.add.group();
    this.rockets = this.physics.add.group();

    // Stats
    this.score = 0;
    this.health = this.gameConfig.maxHealth || 3;
    this.enemySpeed = this.gameConfig.startEnemySpeed || 100;
    this.spawnInterval = this.gameConfig.spawnInterval || 1000;
    this.lastSpawn = 0;

    // --- SCORE (TOP LEFT) ---
    if (this.sys.textures.exists('ui_bg')) {
      this.scoreBg = this.add.image(200, 60, 'ui_bg').setDepth(95);
    }
    this.scoreText = this.add.text(190, 55, this.texts.score.replace('{score}', 0), {
      font: '50px outfit', color: '#000000ff'
    }).setOrigin(0.5).setDepth(96);

    // --- LIVES (TOP RIGHT) - Numerical ---
    if (this.sys.textures.exists('ui_bg')) {
      this.livesBg = this.add.image(920, 60, 'ui_bg').setDepth(95);
    }

    const targetScore = this.gameConfig?.scoreToWin || 9999;

    this.targettext = this.add.text(920, 55, `Target:${targetScore}`, {
      font: '50px outfit', color: '#000000ff'
    }).setOrigin(0.5).setDepth(96);

    // --- LIVES (TOP RIGHT) - Numerical ---
    if (this.sys.textures.exists('ui_bg')) {
      this.livesBg = this.add.image(1720, 60, 'ui_bg').setDepth(95);
    }
    this.livesText = this.add.text(1720, 55, `Lives: ${this.health}`, {
      font: '50px outfit', color: '#000000ff'
    }).setOrigin(0.5).setDepth(96);

    // --- Collisions ---
    this.physics.add.overlap(this.rockets, this.enemies, this.rocketHitsEnemy, null, this);
    this.enemyOverlap = this.physics.add.overlap(this.enemies, this.centerCollider, this.enemyHitsPlane, null, this);

    this.gameOver = false;
    this.won = false;
  }

  handleShoot(targetX, targetY) {
    if (this.gameOver) return;
    const cx = this.gameW / 2, cy = this.gameH / 2;
    const angle = Phaser.Math.Angle.Between(cx, cy, targetX, targetY);

    const rocket = this.createSpriteOrFallback(cx, cy, 'rocket', true);
    this.rockets.add(rocket);

    const speed = 900;
    this.physics.velocityFromRotation(angle, speed, rocket.body.velocity);
    rocket.body.setAllowGravity(false);
    rocket.rotation = angle;

    this.playShootEffect(cx, cy, angle);
    if (this.sound && this.cache.audio.exists('shoot')) this.sound.play('shoot', { volume: 0.5 });
  }

  spawnEnemy() {
    const margin = 100;
    const side = Phaser.Math.Between(0, 3);
    let x, y;
    if (side === 0) { x = Phaser.Math.Between(margin, this.gameW - margin); y = -margin; }
    else if (side === 1) { x = this.gameW + margin; y = Phaser.Math.Between(margin, this.gameH - margin); }
    else if (side === 2) { x = Phaser.Math.Between(margin, this.gameW - margin); y = this.gameH + margin; }
    else { x = -margin; y = Phaser.Math.Between(margin, this.gameH - margin); }

    const enemy = this.createSpriteOrFallback(x, y, 'enemy', true);
    enemy.setDisplaySize(250, 250);
    this.enemies.add(enemy);

    const cx = this.gameW / 2, cy = this.gameH / 2;
    const angle = Phaser.Math.Angle.Between(x, y, cx, cy);
    this.physics.velocityFromRotation(angle, this.enemySpeed, enemy.body.velocity);
    enemy.body.setAllowGravity(false);
    enemy.rotation = angle;
  }

  rocketHitsEnemy(rocket, enemy) {
    if (!rocket.active || !enemy.active) return;
    this.playExplosion(enemy.x, enemy.y);
    if (this.sound && this.cache.audio.exists('explosion')) {
      this.sound.play('explosion', { volume: 0.4, loop: false });
    }
    rocket.setActive(false).setVisible(false);
    this.rockets.remove(rocket, true, true);
    this.enemies.remove(enemy, true, true);
    this.score += 1;
    if (this.scoreText) {
      this.scoreText.setText(this.texts.score.replace('{score}', this.score));
    }
  }

  enemyHitsPlane(_, enemy) {
    if (!enemy.active) return;
    this.playExplosion(enemy.x, enemy.y);
    if (this.sound && this.cache.audio.exists('hit')) {
      this.sound.play('hit', { volume: 0.6, loop: false });
    }
    enemy.destroy();
    this.health -= 1;
    if (this.health < 0) this.health = 0;

    if (this.livesText) {
      this.livesText.setText(`Lives: ${this.health}`);
    }

    if (this.health <= 0) this.triggerGameOver();
  }

  update(time, dt) {
    if (this.gameState !== 'playing' || this.gameOver) return;

    if (time - this.lastSpawn > this.spawnInterval) {
      this.spawnEnemy();
      this.lastSpawn = time;
      if (this.spawnInterval > (this.gameConfig.minSpawnInterval || 350))
        this.spawnInterval -= (this.gameConfig.spawnAccel || 5);
    }

    this.rockets.children.iterate(r => {
      if (!r) return;
      if (r.x < 0 || r.x > this.gameW || r.y < 0 || r.y > this.gameH) r.destroy();
    });

    if (this.score >= (this.gameConfig.scoreToWin || 9999) && !this.won) {
      this.won = true;
      this.triggerLevelComplete();
    }
  }

  playExplosion(x, y) {
    if (!this.sys.textures.exists('explosion')) return;
    const exp = this.add.image(x, y, 'explosion').setDepth(50).setScale(0.8);
    this.sys.tweens.add({
      targets: exp, scale: 2, alpha: 0, duration: 350, onComplete: () => exp.destroy()
    });
  }

  playShootEffect(x, y, angle) {
    const fxX = x + Math.cos(angle) * 48, fxY = y + Math.sin(angle) * 48;
    const flash = this.add.circle(fxX, fxY, 8, 0xffffff).setDepth(49);
    this.sys.tweens.add({
      targets: flash, alpha: 0, scale: 2, duration: 120, onComplete: () => flash.destroy()
    });
  }

  triggerGameOver() {
    // DO NOT stop BGM here; it should continue.
    this.gameOver = true;
    this.gameState = 'gameOver';

    // Stop gameplay: clear enemies, rockets, and overlap
    if (this.enemyOverlap) {
      this.enemyOverlap.destroy();
      this.enemyOverlap = null;
    }
    if (this.enemies) this.enemies.clear(true, true);
    if (this.rockets) this.rockets.clear(true, true);

    this.hideOverlays();
    if (!this.gameOverOverlay || !this.gameOverOverlay.active) {
      this.createGameOverOverlay();
    }
    this.gameOverOverlay.setVisible(true);
  }


  triggerLevelComplete() {
    // DO NOT stop BGM here; it should continue.
    this.gameOver = true;
    this.won = true;
    this.gameState = 'levelComplete';

    // Stop gameplay: clear enemies, rockets, and overlap
    if (this.enemyOverlap) {
      this.enemyOverlap.destroy();
      this.enemyOverlap = null;
    }
    if (this.enemies) this.enemies.clear(true, true);
    if (this.rockets) this.rockets.clear(true, true);

    this.hideOverlays();
    if (!this.levelCompleteOverlay || !this.levelCompleteOverlay.active) {
      this.createLevelCompleteOverlay();
    }
    this.levelCompleteOverlay.setVisible(true);
  }


  createSpriteOrFallback(x, y, key, withPhysics) {
    let sprite;
    if (this.sys.textures.exists(key)) {
      sprite = this.physics.add.sprite(x, y, key);
    } else {
      sprite = this.add.rectangle(x, y, 32, 32, 0xff00ff);
      if (withPhysics) this.physics.add.existing(sprite);
    }
    if (withPhysics && sprite.body) sprite.body.setAllowGravity(false);
    return sprite;
  }

  destroyAllOverlays() {
    if (this.startOverlay) {
      this.startOverlay.removeAll(true);
      this.startOverlay.destroy();
      this.startOverlay = null;
    }
    if (this.gameOverOverlay) this.gameOverOverlay.setVisible(false);
    if (this.levelCompleteOverlay) this.levelCompleteOverlay.setVisible(false);
  }

  cleanupAllUIElements() {
    let allObjects = [];
    try {
      if (this.children && this.children.list) allObjects = this.children.list.slice();
      else if (this.children && this.children.entries) allObjects = this.children.entries.slice();
      else if (this.sys && this.sys.displayList && this.sys.displayList.list) allObjects = this.sys.displayList.list.slice();
    } catch (e) { console.warn('Error accessing children list:', e); return; }

    allObjects.forEach(obj => {
      if (!obj || !obj.active) return;
      try {
        if (obj.texture && ['start_overlay', 'htpbox', 'button_play', 'button_retry', 'next', 'replay', 'levelcomplete_overlay', 'gameover_overlay'].includes(obj.texture.key)) {
          obj.destroy(); return;
        }
        if (obj.type === 'Text' || obj instanceof Phaser.GameObjects.Text) { obj.destroy(); return; }
        if (obj.texture && obj.texture.key === 'explosion') { obj.destroy(); return; }
        if (obj instanceof Phaser.GameObjects.Container && obj.depth >= 1000) { obj.removeAll(true); obj.destroy(); return; }
      } catch (e) { console.warn('Error destroying object:', e); }
    });
  }

  restartGame() {
    console.log('Restarting game...');

    // Restart BGM from the beginning on replay
    if (this.bgmSound) {
      this.bgmSound.stop();
      this.bgmSound.play();
    }

    this.cleanupGameObjects();
    this.resetOverlays();
    this.startGame();
  }


  cleanupGameObjects() {
    this.sys.tweens.killAll();

    if (this.enemyOverlap) {
      this.enemyOverlap.destroy();
      this.enemyOverlap = null;
    }

    if (this.enemies) { this.enemies.clear(true, true); this.enemies = null; }
    if (this.rockets) { this.rockets.clear(true, true); this.rockets = null; }

    if (this.plane) { this.plane.destroy(); this.plane = null; }
    if (this.centerCollider) { this.centerCollider.destroy(); this.centerCollider = null; }

    if (this.scoreBg) { this.scoreBg.destroy(); this.scoreBg = null; }
    if (this.livesBg) { this.livesBg.destroy(); this.livesBg = null; }
    if (this.scoreText) { this.scoreText.destroy(); this.scoreText = null; }
    if (this.livesText) { this.livesText.destroy(); this.livesText = null; }

    try {
      const all = this.children?.list?.slice() || [];
      all.forEach(obj => {
        if (!obj || !obj.active) return;
        if (obj === this.startOverlay || obj === this.gameOverOverlay || obj === this.levelCompleteOverlay) return;
        if (obj.parentContainer && (obj.parentContainer === this.startOverlay ||
          obj.parentContainer === this.gameOverOverlay ||
          obj.parentContainer === this.levelCompleteOverlay)) return;
        try { obj.destroy(); } catch (e) { console.warn(e); }
      });
    } catch (e) { console.warn('Cleanup error:', e); }
  }

  resetOverlays() {
    this.hideOverlays();
    if (!this.startOverlay || !this.startOverlay.active) { if (this.startOverlay) this.startOverlay.destroy(); this.createStartOverlay(); }
    if (!this.gameOverOverlay || !this.gameOverOverlay.active) { if (this.gameOverOverlay) this.gameOverOverlay.destroy(); this.createGameOverOverlay(); }
    if (!this.levelCompleteOverlay || !this.levelCompleteOverlay.active) { if (this.levelCompleteOverlay) this.levelCompleteOverlay.destroy(); this.createLevelCompleteOverlay(); }
  }

  shutdown() {
    if (this.enemyOverlap) {
      this.enemyOverlap.destroy();
      this.enemyOverlap = null;
    }
  }
}