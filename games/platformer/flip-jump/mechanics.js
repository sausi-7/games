export default class FlipJumpScene extends Phaser.Scene {
  constructor() {
    super('FlipJumpScene');
    Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach(fn => {
      if (typeof this[fn] === 'function') this[fn] = this[fn].bind(this);
    });

    this.isGameOver = false;
    this.isGameStarted = false;
    this.distance = 0;
    this.overlays = {};
    this.gameState = 'start';
    this.levelConfig = null;   // restart safety
    this.sceneReady = false;
    this.bgmSound = null;

    this.assetsReady = false;  // <-- gate scene init
  }

  preload() {
    const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));
    if (this.load.setCORS) this.load.setCORS('anonymous');

    // IMPORTANT: attach COMPLETE handler BEFORE any load.start()
    this.load.once('complete', () => {
      this.assetsReady = true;

      const tex = this.textures.get('player');
      const src = tex && tex.getSourceImage ? tex.getSourceImage().src : '(no src)';
      console.log('[Preload] FINAL player texture src:', src);

      if (this.scene.isActive()) {
        this.initSceneFromConfig();
      }
    });

    // Evict only before (re)loading
    // if (this.textures.exists('player')) this.textures.remove('player');

    this.load.on('loaderror', (file) => {
      if (file?.key === 'player') {
        console.error('[Preload] Failed to load player sheet:', file?.src);
      }
    });

    // Config: cached or load then proceed
    if (this.cache.json.exists('levelConfig')) {
      this.levelConfig = this.cache.json.get('levelConfig');
      this.loadAssetsFromConfig(this.levelConfig, basePath);
    } else {
      this.load.json('levelConfig', `${basePath}/config.json`);
      this.load.once('filecomplete-json-levelConfig', () => {
        this.levelConfig = this.cache.json.get('levelConfig');
        this.loadAssetsFromConfig(this.levelConfig, basePath);
      });
    }
  }

  loadAssetsFromConfig(cfg, basePath) {
    // -------- helpers --------
    const resolveUrl = (u) => {
      if (!u) return null;
      if (/^(https?:)?\/\//i.test(u) || /^data:/i.test(u)) return u; // absolute or data:
      return `${basePath}/${u}`; // relative -> basePath
    };
    // -------------------------

    const sheets = cfg.spritesheets || {};

    // ---- NEW: player ONLY from config / default, NO query params ----
    const img1 = cfg.images1 || {};
    let playerUrl = null;

    if (img1.player) {
      // config.images1.player = "path/to/player.png"
      playerUrl = resolveUrl(img1.player);
    } else if (sheets.player && (sheets.player.url || sheets.player.path)) {
      // fallback: if spritesheet path exists, use it as a plain image
      playerUrl = resolveUrl(sheets.player.url || sheets.player.path);
    } else {
      // final fallback
      playerUrl = resolveUrl('assets/player.png');
    }

    this.load.image('player', playerUrl);

    // ---- Spritesheets: everything EXCEPT 'player' ----
    for (const [key, data] of Object.entries(sheets)) {
      if (key === 'player') continue; // skip, handled as image above
      const src = data.url || data.path; // support either field
      const sheetUrl = resolveUrl(src);
      const frameW = data.frameWidth || 103;
      const frameH = data.frameHeight || 143;

      this.load.spritesheet(key, sheetUrl, { frameWidth: frameW, frameHeight: frameH });
    }

    // Load images2 (backgrounds, floor, ceiling, obstacle, finish, etc.)
    for (const [key, url] of Object.entries(cfg.images2 || {})) {
      this.load.image(key, resolveUrl(url));
    }

    // Load images1 (other UI/objects). Re-loading 'player' with same key is harmless,
    // but if you want you can skip it with `if (key === 'player') continue;`
    for (const [key, url] of Object.entries(cfg.images1 || {})) {
      this.load.image(key, resolveUrl(url));
    }

    // UI images (htpbg, winbg, ovrbg, buttons, etc.)
    for (const [key, url] of Object.entries(cfg.ui || {})) {
      this.load.image(key, resolveUrl(url));
    }

    // Audio
    for (const [key, url] of Object.entries(cfg.audio || {})) {
      this.load.audio(key, resolveUrl(url));
    }

    // Start actual loading (global 'complete' is already attached in preload)
    this.load.start();
  }



  create() {

    // make sure we clean up on restart
    this.events.once('shutdown', this.cleanup, this);
    this.events.once('destroy', this.cleanup, this);

    if (!this.bgmSound) {
      this.bgmSound = this.sound.add('bgm', { loop: true, volume: 0.5 });
    }
    this.bgmSound.play();

    // Only build the scene AFTER assets are truly ready
    if (this.assetsReady) {
      this.initSceneFromConfig();
    } else {
      // In case 'create' ran before loader finished (typical on restart)
      this.load.once('complete', () => {
        if (this.scene.isActive()) this.initSceneFromConfig();
      });
    }
  }

  initSceneFromConfig() {
    this.sceneReady = false;

    // Clear overlays/groups on restart
    Object.values(this.overlays).forEach(overlay => overlay.destroy && overlay.destroy());
    this.overlays = {};

    // Config setup
    const cfg = this.levelConfig;
    const orientation = cfg.orientation;
    const game = cfg.game;
    const colors = cfg.colors;
    const texts = cfg.texts;

    this.GAME_WIDTH = orientation.width;
    this.GAME_HEIGHT = orientation.height;
    this.PLAYER_SIZE = game.playerSize;
    this.OBSTACLE_WIDTH = game.obstacleWidth;
    this.OBSTACLE_HEIGHT = game.obstacleHeight;
    this.FLOOR_Y = this.GAME_HEIGHT - game.floorOffsetY;
    this.CEILING_Y = game.ceilingOffsetY;
    this.PLAYER_SPEED = game.playerSpeed;
    this.OBSTACLE_SPEED = game.obstacleSpeed;
    this.finishLineX = game.finishLineX;
    this.OBSTACLE_GAP_MIN = game.obstacleGapMin;
    this.OBSTACLE_GAP_MAX = game.obstacleGapMax;
    this.PLAYER_GRAVITY = game.playerGravity || 2000; // <--- NEW

    this.isGameOver = false;
    this.isGameStarted = false;
    this.distance = 0;
    this.gameState = 'start';
    this.gravityDown = true;

    if (cfg.orientation?.frame === 'landscape' && screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('landscape-primary').catch(err => console.warn('Orientation lock failed:', err));
    }

    // Background color
    this.sys.cameras.main.setBackgroundColor(colors.background);

    // Floor and ceiling
    // Floor and ceiling
    this.floor = this.add.tileSprite(
      this.GAME_WIDTH / 2,
      this.FLOOR_Y + this.OBSTACLE_HEIGHT / 2,
      this.GAME_WIDTH,
      this.OBSTACLE_HEIGHT,
      'floor'
    );
    this.ceiling = this.add.tileSprite(
      this.GAME_WIDTH / 2,
      this.CEILING_Y - this.OBSTACLE_HEIGHT / 2,
      this.GAME_WIDTH,
      this.OBSTACLE_HEIGHT,
      'ceiling'
    );

    // ---- enable physics bodies ----
    this.physics.add.existing(this.floor, true);
    this.physics.add.existing(this.ceiling, true);

    this.floor.body.setSize(this.GAME_WIDTH, this.OBSTACLE_HEIGHT);
    this.floor.body.setOffset(0, 0);

    this.ceiling.body.setSize(this.GAME_WIDTH, this.OBSTACLE_HEIGHT);
    this.ceiling.body.setOffset(0, 0);

    // Player
    this.player = this.physics.add.sprite(
      80,
      this.FLOOR_Y - this.PLAYER_SIZE / 2,
      'player'
    );

    this.physics.add.collider(this.player, this.floor);
    this.physics.add.collider(this.player, this.ceiling);

    // Get actual texture size so scaling matches config PLAYER_SIZE
    const tex = this.textures.get('player');
    let baseWidth = 103;
    let baseHeight = 143;
    try {
      const srcImg = tex && tex.getSourceImage && tex.getSourceImage();
      if (srcImg) {
        baseWidth = srcImg.width || baseWidth;
        baseHeight = srcImg.height || baseHeight;
      }
    } catch (e) { }

    // Scale so visual size ~= PLAYER_SIZE
    const scaleX = this.PLAYER_SIZE / baseWidth;
    const scaleY = this.PLAYER_SIZE / baseHeight;
    this.player.setScale(scaleX + 0.3, scaleY + 0.25);

    // use actual rendered height for positioning on floor/ceiling
    this.playerHalfHeight = this.player.displayHeight / 2;


    // 🔹 Centered, symmetric hitbox (no weird offsets)
    const bodyWidth = this.PLAYER_SIZE * 0.6;
    const bodyHeight = this.PLAYER_SIZE * 0.9;
    this.player.body.setSize(bodyWidth + 200, bodyHeight + 500, true); // true = center on sprite

    this.player.body.setCollideWorldBounds(false);
    this.player.body.allowGravity = false;


    // Obstacles
    this.obstacles = this.physics.add.staticGroup();

    // Finish line (make it nice and wide, refresh body)
    this.finishLine = this.add.sprite(this.finishLineX + 165, this.FLOOR_Y - 500, 'finish');
    this.finishLine.displayHeight = this.OBSTACLE_HEIGHT * 9;
    this.finishLine.displayWidth = 96;
    this.physics.add.existing(this.finishLine, true);
    this.finishLine.body.setSize(this.finishLine.displayWidth, this.finishLine.displayHeight, true);

    this.physics.add.overlap(this.player, this.finishLine, this.reachFinish, null, this);
    this.physics.add.overlap(this.player, this.obstacles, this.hitObstacle, null, this);

    // UI
    this.distanceText = this.add.text(200, 45, '', {
      font: '45px outfit',
      fill: 'black',
    }).setDepth(10).setScrollFactor(0);

    this.targettextr = this.add.text(1480, 45, `Target: ${this.finishLineX}`, {
      font: '45px outfit',
      fill: 'black',
    }).setDepth(10).setScrollFactor(0);

    this.add.image(360, 70, 'scorebar').setScale(1.2, 1).setScrollFactor(0);

    this.add.image(1600, 70, 'scorebar').setScale(1.2, 1).setScrollFactor(0);

    // Obstacles and camera
    this.createObstacles();
    this.sys.cameras.main.startFollow(this.player, false, 1, 0);
    this.sys.cameras.main.setBounds(0, 0, this.finishLineX + 200, this.GAME_HEIGHT);

    // Overlays
    this.createStartOverlay();
    this.createGameOverOverlay();
    this.createLevelCompleteOverlay();
    this.hideAllOverlays();
    this.showStartOverlay();

    // Input for gameplay
    this.input.on('pointerdown', this.handleInput, this);
  }

  cleanup() {
    try {
      // stop audio/physics
      this.physics.pause();
      if (this.bgmSound?.isPlaying) this.bgmSound.stop();

      // detach input
      this.input?.removeAllListeners();

      // stop & destroy player before scene tears down
      if (this.player) {
        this.player.anims?.stop();
        this.player.destroy();
        this.player = null;
      }

      // destroy overlays
      Object.values(this.overlays || {}).forEach(o => o?.destroy?.());
      this.overlays = {};

      // remove scene-specific animations so they'll be recreated cleanly
      ['idle', 'run'].forEach(k => this.anims.exists(k) && this.anims.remove(k));

      // reset flags so preload/create will rebuild deterministically
      this.assetsReady = false;
      this.sceneReady = false;
    } catch (_) { }
  }


  // ----------------- OVERLAY HELPERS -------------------

  createStartOverlay() {
    const { GAME_WIDTH: w, GAME_HEIGHT: h, levelConfig } = this;
    const texts = levelConfig.texts;
    const ui = levelConfig.ui || {};
    const img2 = levelConfig.images2 || {};

    const container = this.add.container(w / 2, h / 2);

    // ---------- BACKGROUND (htpbg) ----------
    let bgBehind = null;
    // We support htpbg from either ui or images2, key is always 'htpbg'
    if ((ui.htpbg || img2.htpbg) && this.textures.exists('htpbg')) {
      bgBehind = this.add.image(0, 0, 'htpbg');
      const sx = w / bgBehind.width;
      const sy = h / bgBehind.height;
      bgBehind.setScale(Math.max(sx, sy)); // cover whole screen
    }

    // ---------- FOREGROUND PANEL (start_overlay or rectangle) ----------
    let panel;
    if (ui.start_overlay && this.textures.exists('start_overlay')) {
      panel = this.add.image(0, 0, 'start_overlay');
      // scale panel to be a nice central card (not full screen)
      const targetWidth = w * 0.6;
      const s = targetWidth / panel.width;
      panel.setScale(s);
    } else {
      panel = this.add.rectangle(0, 0, 600, 500, 0x111133, 0.98);
    }

    // ---------- TEXT ----------
    const desc = this.add.text(0, -200, texts.instructions || '', {
      font: '70px outfit',
      color: '#fff',
      align: 'left',
    }).setOrigin(0.5);

    const desc1 = this.add.text(-300, 0, texts.instructions1 || '', {
      font: '50px outfit',
      color: '#fff',
      align: 'left',
    }).setOrigin(0.5);
    const desc2 = this.add.text(100, 0, 'Avoid:', {
      font: '50px outfit',
      color: '#fff',
      align: 'left',
    }).setOrigin(0.5);


    const img = this.add.image(-100, 0, 'player').setScale(0.3)
    const img1 = this.add.image(230, 0, 'obstacle').setScale(0.3)

    // ---------- BUTTON ----------
    let playBtn, playLabel;
    if (ui.button_play && this.textures.exists('button_play')) {
      playBtn = this.add.image(0, 420, 'button_play').setInteractive({ useHandCursor: true });
      playLabel = this.add.text(0, 120, texts.startBtn || '', {
        font: '50px outfit',
        color: '#111',
      }).setOrigin(0.5);
    } else {
      playBtn = this.add.rectangle(0, 120, 220, 86, 0x60e05d, 1).setInteractive({ useHandCursor: true });
      playLabel = this.add.text(0, 120, texts.startBtn || '', {
        font: '36px',
        color: '#111',
        fontWeight: 'bold'
      }).setOrigin(0.5);
    }

    playBtn.on('pointerdown', () => {
      this.hideAllOverlays();
      this.startGame();
    });

    // ---------- ADD TO CONTAINER (ensure correct layering) ----------
    const children = [];
    if (bgBehind) children.push(bgBehind); // back layer
    children.push(panel, desc, desc1, desc2, img, img1, playBtn, playLabel);
    container.add(children);

    container.setDepth(1000).setVisible(false);
    this.overlays.start = container;
  }


  createGameOverOverlay() {
    const { GAME_WIDTH: w, GAME_HEIGHT: h, levelConfig } = this;
    const texts = levelConfig.texts;
    const ui = levelConfig.ui || {};
    const img2 = levelConfig.images2 || {};

    const container = this.add.container(w / 2, h / 2);

    // ---------- BACKGROUND (ovrbg) ----------
    let bgBehind = null;
    // support ovrbg from either ui or images2, texture key = 'ovrbg'
    if ((ui.ovrbg || img2.ovrbg) && this.textures.exists('ovrbg')) {
      bgBehind = this.add.image(0, 0, 'ovrbg');
      const sx = w / bgBehind.width;
      const sy = h / bgBehind.height;
      bgBehind.setScale(Math.max(sx, sy)); // full screen cover
    }

    // ---------- FOREGROUND PANEL (gameover_overlay or rectangle) ----------
    let panel;
    if (ui.gameover_overlay && this.textures.exists('gameover_overlay')) {
      panel = this.add.image(0, 0, 'gameover_overlay').setScale(0.55, 0.8);
      const targetWidth = w * 0.6;
      const s = targetWidth / panel.width;
      panel.setScale(s);
    } else {
      panel = this.add.rectangle(0, 0, 600, 500, 0x331111, 0.98);
    }

    // ---------- TEXT ----------
    const overText = this.add.text(0, 0, texts.gameOver || 'Try Again!', {
      font: '80px outfit',
      color: '#ffffffff'
    }).setOrigin(0.5);



    // ---------- BUTTON ----------
    let retryBtn, retryLabel;
    if (ui.button_retry && this.textures.exists('button_retry')) {
      retryBtn = this.add.image(0, 400, 'button_retry').setInteractive({ useHandCursor: true });
      retryLabel = this.add.text(0, 200, texts.restart || '', {
        font: '36px', color: '#111', fontWeight: 'bold'
      }).setOrigin(0.5);
    } else {
      retryBtn = this.add.rectangle(0, 200, 220, 86, 0x60e05d, 1).setInteractive({ useHandCursor: true });
      retryLabel = this.add.text(0, 200, texts.restart || '', {
        font: '36px', color: '#111', fontWeight: 'bold'
      }).setOrigin(0.5);
    }

    retryBtn.on('pointerdown', () => {
      retryBtn.disableInteractive();
      this.hideAllOverlays();

      // 🔁 Stop BGM so it can restart cleanly on new run
      if (this.bgmSound?.isPlaying) {
        this.bgmSound.stop();
      }

      this.assetsReady = false;
      this.time.delayedCall(0, () => this.scene.restart()); // micro-delay
    });


    // ---------- ADD TO CONTAINER (layering) ----------
    const children = [];
    if (bgBehind) children.push(bgBehind);
    children.push(panel, overText, retryBtn, retryLabel);
    container.add(children);

    container.setDepth(1000).setVisible(false);
    this.overlays.gameover = container;
  }


  createLevelCompleteOverlay() {
    const { GAME_WIDTH: w, GAME_HEIGHT: h, levelConfig } = this;
    const texts = levelConfig.texts;
    const ui = levelConfig.ui || {};
    const img2 = levelConfig.images2 || {};

    const container = this.add.container(w / 2, h / 2);

    // ---------- BACKGROUND (winbg) ----------
    let bgBehind = null;
    // support winbg from either ui or images2, texture key = 'winbg'
    if ((ui.winbg || img2.winbg) && this.textures.exists('winbg')) {
      bgBehind = this.add.image(0, 0, 'winbg');
      const sx = w / bgBehind.width;
      const sy = h / bgBehind.height;
      bgBehind.setScale(Math.max(sx, sy)); // full screen cover
    }

    // ---------- FOREGROUND PANEL (levelcomplete_overlay or rectangle) ----------
    let panel;
    if (ui.levelcomplete_overlay && this.textures.exists('levelcomplete_overlay')) {
      panel = this.add.image(0, 0, 'levelcomplete_overlay').setScale(0.55, 0.8);
      const targetWidth = w * 0.6;
      const s = targetWidth / panel.width;
      panel.setScale(s);
    } else {
      panel = this.add.rectangle(0, 0, 600, 500, 0x113311, 0.98);
    }

    // ---------- TEXT ----------
    const winText = this.add.text(0, 0, texts.win || 'You Win!', {
      font: '80px outfit',
      color: '#fafffaff',
      fontStyle: 'bold'
    }).setOrigin(0.5);

    // ---------- BUTTONS ----------
    let playAgainBtn, nextBtn;
    if (ui.replay_level && this.textures.exists('replay_level') &&
      ui.next && this.textures.exists('next')) {
      playAgainBtn = this.add.image(-260, 400, 'replay_level').setInteractive({ useHandCursor: true });
      nextBtn = this.add.image(260, 400, 'next').setInteractive({ useHandCursor: true });
    } else {
      playAgainBtn = this.add.rectangle(-220, 200, 220, 86, 0x60e05d, 1).setInteractive({ useHandCursor: true });
      nextBtn = this.add.rectangle(220, 200, 220, 86, 0x60e05d, 1).setInteractive({ useHandCursor: true });
    }

    // const playAgainLabel = this.add.text(-220, 200, texts.restart || 'Play Again', {
    //   font: '36px', color: '#111', fontWeight: 'bold'
    // }).setOrigin(0.5); 

    playAgainBtn.on('pointerdown', () => {
      this.hideAllOverlays();

      // 🔁 Stop BGM so new run starts music from beginning
      if (this.bgmSound?.isPlaying) {
        this.bgmSound.stop();
      }

      this.assetsReady = false;
      this.time.delayedCall(0, () => this.scene.restart());
    });


    nextBtn.on('pointerdown', () => {
      this.hideAllOverlays();
      this.notifyParent('sceneComplete', { result: 'win' });
    });

    // ---------- ADD TO CONTAINER (layering) ----------
    const children = [];
    if (bgBehind) children.push(bgBehind);
    children.push(panel, winText, playAgainBtn, nextBtn);
    container.add(children);

    container.setDepth(1000).setVisible(false);
    this.overlays.levelcomplete = container;
  }


  notifyParent(type, data) {
    if (window.parent !== window) {
      window.parent.postMessage({ type, ...data }, '*');
    }
  }

  hideAllOverlays() {
    Object.values(this.overlays).forEach(overlay => overlay.setVisible(false));
  }
  showStartOverlay() {
    this.hideAllOverlays(); this.overlays.start.setVisible(true); this.gameState = 'start';
  }
  showGameOverOverlay() {
    this.hideAllOverlays(); this.centerOverlay(this.overlays.gameover); this.overlays.gameover.setVisible(true); this.gameState = 'gameover';
  }
  showLevelCompleteOverlay() {
    this.hideAllOverlays(); this.centerOverlay(this.overlays.levelcomplete); this.overlays.levelcomplete.setVisible(true); this.gameState = 'levelcomplete';
  }

  // Keep overlays camera-centered
  centerOverlay(overlay) {
    overlay.x = this.sys.cameras.main.scrollX + this.GAME_WIDTH / 2;
    overlay.y = this.GAME_HEIGHT / 2;
  }

  // --------------- GAME LOGIC ----------------

  createObstacles() {
    if (this.obstacles) this.obstacles.clear(true, true);
    let xPos = 500;
    while (xPos < this.finishLineX - 400) {
      const gap = Phaser.Math.Between(this.OBSTACLE_GAP_MIN, this.OBSTACLE_GAP_MAX);
      xPos += gap;
      const yPos = Phaser.Math.Between(0, 1) === 0
        ? this.FLOOR_Y - this.OBSTACLE_HEIGHT / 2 + 50
        : this.CEILING_Y + this.OBSTACLE_HEIGHT / 2 - 50;

      const obs = this.obstacles.create(xPos, yPos, 'obstacle');
      obs.displayWidth = this.OBSTACLE_WIDTH;
      obs.displayHeight = this.OBSTACLE_HEIGHT * 2;
      obs.refreshBody();
    }
  }

  handleInput() {
    if (this.gameState === 'playing') {
      this.flipGravity();
    }
  }
  startGame() {
    this.gameState = 'playing';
    this.hideAllOverlays();
    this.isGameOver = false;
    this.isGameStarted = true;
    this.distance = 0;
    this.gravityDown = true;

    // reset player position and body
    // reset player position and body
    this.player.x = 80;
    this.player.y = this.FLOOR_Y - this.playerHalfHeight;

    this.player.body.enable = true;

    // physics motion
    this.player.body.setVelocityX(this.PLAYER_SPEED);
    // gravity based on current direction flag
    this.player.body.setGravityY(this.gravityDown ? this.PLAYER_GRAVITY : -this.PLAYER_GRAVITY);

    this.physics.resume();
    this.sys.cameras.main.startFollow(this.player, false, 1, 0);
    this.distanceText.setText(this.levelConfig.texts.distance + '');
  }

  flipGravity() {
    if (this.isGameOver || !this.isGameStarted || this.gameState !== 'playing') return;
    if (!this.player || !this.player.body) return;

    this.gravityDown = !this.gravityDown;
    const body = this.player.body;
    if (this.gravityDown) {
      // Going back to floor
      this.player.setFlipY(false); // face down
      this.player.y = this.FLOOR_Y - this.playerHalfHeight;
      body.setGravityY(this.PLAYER_GRAVITY);
    } else {
      // Going to ceiling
      this.player.setFlipY(true); // face up
      this.player.y = this.CEILING_Y + this.playerHalfHeight;
      body.setGravityY(-this.PLAYER_GRAVITY);
    }


    // keep body perfectly aligned with sprite after teleport
    body.updateFromGameObject();
  }


  hitObstacle() {
    if (this.isGameOver || this.gameState !== 'playing') return;

    // 🔊 Play bomb sound on lose (if loaded as key "bomb")
    try {
      if (this.cache.audio && this.cache.audio.exists('bomb')) {
        this.sound.play('bomb');
      }
    } catch (e) {
      console.warn('[FlipJump] Failed to play bomb sound:', e);
    }

    this.isGameOver = true;
    this.sys.cameras.main.stopFollow();
    this.physics.pause();

    if (this.player) {
      this.player.anims?.stop();
      this.player.destroy();
      this.player = null;
    }

    this.showGameOverOverlay();
  }



  reachFinish() {
    if (this.isGameOver || this.gameState !== 'playing') return;

    this.isGameOver = true;
    this.sys.cameras.main.stopFollow();
    this.physics.pause();

    if (this.player) {
      this.player.anims?.stop();
      this.player.destroy();
      this.player = null;
    }

    this.showLevelCompleteOverlay();
  }



  update(time, delta) {
    // Keep floor/ceiling aligned even when player is gone
    if (this.floor && this.ceiling) {
      const scrollX = this.sys.cameras.main.scrollX;
      this.floor.x = scrollX + this.GAME_WIDTH / 2;
      this.ceiling.x = scrollX + this.GAME_WIDTH / 2;
      this.floor.tilePositionX = scrollX;
      this.ceiling.tilePositionX = scrollX;

      // keep static bodies aligned with the sprites
      if (this.floor.body) {
        this.floor.body.updateFromGameObject();
      }
      if (this.ceiling.body) {
        this.ceiling.body.updateFromGameObject();
      }
    }


    // Keep overlays centered
    Object.values(this.overlays).forEach(overlay => {
      if (overlay.visible) this.centerOverlay(overlay);
    });

    // If player was destroyed already (gameover), bail early
    if (!this.player || !this.isGameStarted || this.isGameOver || this.gameState !== 'playing') return;

    const dx = (this.PLAYER_SPEED * delta) / 1000;
    this.player.x += dx;
    this.distance += dx;
    this.distanceText.setText(this.levelConfig.texts.distance + Math.floor(this.distance));

    if (this.gravityDown) {
      if (this.player.y > this.FLOOR_Y + this.playerHalfHeight) this.hitObstacle();
    } else {
      if (this.player.y < this.CEILING_Y - this.playerHalfHeight) this.hitObstacle();
    }

  }
}
