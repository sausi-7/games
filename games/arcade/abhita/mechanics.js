export default class GamePlayScene extends Phaser.Scene {
  constructor() {
    super('GamePlayScene');

    Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach(fn => {
      if (typeof this[fn] === 'function') {
        this[fn] = this[fn].bind(this);
      }
    });
  }

  preload() {
    const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf("/"));

    // Use cached config if it exists
    if (GamePlayScene.cachedConfig) {
      this.config = GamePlayScene.cachedConfig;
      return;
    }

    // Load config JSON
    this.load.json("levelConfig", `${basePath}/config.json`);

    this.load.once("filecomplete-json-levelConfig", () => {
      this.config = this.cache.json.get("levelConfig");
      GamePlayScene.cachedConfig = this.config;

      console.log("✅ Config Loaded:", this.config);

      if (!this.config || !this.config.texts) {
        console.error("❌ Config or texts missing!");
        return;
      }

      // Load images
      if (this.config.images2) {
        for (const [key, url] of Object.entries(this.config.images2)) {
          this.load.image(key, `${basePath}/${url}`);
        }
      }

       if (this.config.ui) {
        for (const [key, url] of Object.entries(this.config.ui)) {
          this.load.image(key, `${basePath}/${url}`);
        }
      }

      // Load spritesheets
      if (this.config.spritesheets) {
        for (const [key, sheet] of Object.entries(this.config.spritesheets)) {
          this.load.spritesheet(key, `${basePath}/${sheet.url}`, {
            frameWidth: sheet.frameWidth,
            frameHeight: sheet.frameHeight
          });
        }
      }

      // Load audio
      if (this.config.audio) {
        for (const [key, url] of Object.entries(this.config.audio)) {
          this.load.audio(key, `${basePath}/${url}`);
        }
      }

      // Load tiles
      if (this.config.tiles) {
        for (const [key, url] of Object.entries(this.config.tiles)) {
          this.load.image(key, `${basePath}/${url}`);
        }
      }

      this.load.start();
    });
  }

  create() {
    this.timerText = null;
    this.timerEvent = null;
    this.timerDuration = 60; // seconds
    this.pieces = []; // Store pieces for enabling/disabling

    const GAME_WIDTH = this.sys.game.config.width;
    const GAME_HEIGHT = this.sys.game.config.height;

    // Set camera zoom
    this.sys.cameras.main.setZoom(0.8);

    // Add background
    const bg = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'background')
      .setDisplaySize(GAME_WIDTH, GAME_HEIGHT)
      .setDepth(-10);

    // Puzzle dimensions
    const puzzleW = 360, puzzleH = 600;
    const puzzleX = (GAME_WIDTH - puzzleW) / 2;
    const puzzleY = GAME_HEIGHT - puzzleH - 60;

    // Draw puzzle border
    this.add.rectangle(
      puzzleX + puzzleW / 2,
      puzzleY + puzzleH / 2,
      puzzleW,
      puzzleH,
      0x333333
    ).setStrokeStyle(4, 0xffffff);

    // Scatter box
    const scatterW = 700, scatterH = 250;
    const scatterX = (GAME_WIDTH - scatterW) / 2;
    const scatterY = puzzleY - scatterH - 40;

    // Draw scatter area
    this.add.rectangle(
      scatterX + scatterW / 2,
      scatterY + scatterH / 2,
      scatterW,
      scatterH,
      0x222244,
      0.18
    ).setStrokeStyle(2, 0x8888ff);

    // Puzzle split settings
    const cols = 2, rows = 4;
    const pieceW = Math.floor(598 / cols), pieceH = Math.floor(932 / rows);
    const scaleX = puzzleW / 598, scaleY = puzzleH / 932;

    let placedCount = 0, totalPieces = cols * rows;
    const scene = this;

    // Ensure textures manager and fullImage are available
    if (!this.textures || !this.textures.exists('cool_image')) {
      console.error("❌ Texture manager or 'fullImage' not available!");
      this.add.text(
        GAME_WIDTH / 2,
        GAME_HEIGHT / 2,
        'Error: Failed to load puzzle image!',
        { font: "bold 40px Arial", color: "#ff0000" }
      ).setOrigin(0.5);
      return;
    }

    // Generate puzzle piece textures
    this.generatePuzzlePieceTextures(cols, rows, pieceW, pieceH);

    // Create puzzle pieces
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const idx = row * cols + col;
        const key = 'piece' + idx;

        // Verify texture exists
        if (!this.textures.exists(key)) {
          console.error(`❌ Texture ${key} not found!`);
          continue;
        }

        // Target location in puzzle
        const targetX = puzzleX + Math.round(col * pieceW * scaleX);
        const targetY = puzzleY + Math.round(row * pieceH * scaleY);

        // Random position in scatter box
        const px = Phaser.Math.Between(
          scatterX,
          scatterX + scatterW - pieceW * scaleX
        );
        const py = Phaser.Math.Between(
          scatterY,
          scatterY + scatterH - pieceH * scaleY
        );

        // Create draggable piece
        const piece = this.add.image(px, py, key)
          .setOrigin(0)
          .setScale(scaleX, scaleY)
          .setInteractive({ draggable: true });

        piece.puzzle = { idx, col, row, targetX, targetY, placed: false };
        this.input.setDraggable(piece);
        this.pieces.push(piece);

        // Drag logic
        piece.on('drag', function (pointer, dragX, dragY) {
          if (this.puzzle.placed) return;
          this.x = dragX;
          this.y = dragY;
        });

        // Snap logic
        piece.on('dragend', function () {
          if (this.puzzle.placed) return;
          const dist = Phaser.Math.Distance.Between(this.x, this.y, this.puzzle.targetX, this.puzzle.targetY);
          if (dist < 25) {
            scene.sys.tweens.add({
              targets: this,
              x: this.puzzle.targetX,
              y: this.puzzle.targetY,
              duration: 120,
              onComplete: () => {
                this.puzzle.placed = true;
                this.disableInteractive();
                placedCount++;
                if (placedCount === totalPieces) {
                  scene.timerEvent?.remove(false);
                  scene.time.delayedCall(350, () => {
                    scene.showLevelCompleteUI();
                  });
                }
              }
            });
          }
        });
      }
    }

    this.showStartScreen();
  }

  generatePuzzlePieceTextures(cols, rows, pieceW, pieceH) {
    // Ensure textures manager exists
    if (!this.textures) {
      console.error("❌ Texture manager is undefined!");
      return;
    }

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const idx = row * cols + col;
        const key = 'piece' + idx;

        // Skip if texture already exists
        if (this.textures.exists(key)) {
          continue;
        }

        // Generate puzzle piece texture
        try {
          const rt = this.make.renderTexture({ width: pieceW, height: pieceH, add: false });
          rt.draw('cool_image', -col * pieceW, -row * pieceH);
          rt.saveTexture(key);
          rt.destroy();
        } catch (error) {
          console.error(`❌ Failed to generate texture ${key}:`, error);
        }
      }
    }
  }

  showStartScreen() {
    const centerX = this.sys.game.config.width / 2;
    const centerY = this.sys.game.config.height / 2;

    this.startOverlay = this.add.container(centerX, centerY).setScrollFactor(0);

    const bg = this.add.image(0, -50, 'dialog_bg_start');
    const title = this.add.text(-55, -165, this.config.texts.title || 'How to Play', {
      font: "bold 70px Arial", color: '#fff'
    }).setOrigin(0.5);

    const desc = this.add.text(0, 30, this.config.texts.instructions ||
      'Drag and drop pieces to the grid below!\nSolve the puzzle to win.',
      { font: "60px Arial", color: '#fff', align: 'left', wordWrap: { width: 820 } }
    ).setOrigin(0.5);

    const startBtn = this.add.image(0, 300, 'button').setInteractive();
    const startLabel = this.add.text(0, 300, '', { // Fixed: Proper string literal
      font: "bold 48px Arial", color: '#000000ff'
    }).setOrigin(0.5);

    startBtn.on('pointerdown', () => {
      this.startOverlay.destroy();
      this.state = 'playing';
      this.enablePieces();
      this.startTimer();
    });

    this.startOverlay.add([bg, title, desc, startBtn, startLabel]);
    this.state = 'start';
    this.disablePieces();

    if (!this.timerText) {
      this.timerText = this.add.text(
        this.sys.game.config.width / 2, 30,
        "Time: 1:00",
        { font: "bold 56px Arial", color: "#ffff00" }
      ).setOrigin(0.5).setDepth(100);
    } else {
      this.timerText.setText("Time: 1:00").setVisible(true);
    }
  }

  update() {
    if (this.timerStarted) {
      const remaining = Math.max(0, Math.ceil((this.timerEndTime - this.time.now) / 1000));
      this.updateTimerDisplay(remaining);
      if (remaining <= 0) {
        this.timerStarted = false;
        this.endGameTimer();
      }
    }
  }

  startTimer() {
    this.timerStarted = true;
    this.timerEndTime = this.time.now + this.timerDuration * 1000;
  }

  showLevelCompleteUI() {
    const centerX = this.sys.game.config.width / 2;
    const centerY = this.sys.game.config.height / 2;

    this.physics.pause?.();

    this.levelCompleteOverlay = this.add.container(centerX, centerY);

    const bg = this.add.image(0, 0, 'level_complete').setDisplaySize(914, 217);
    const title = this.add.text(0, 0, 'Level Complete!', {
      font: "bold 70px Arial", color: '#fff'
    }).setOrigin(0.5);

    const nextBtn = this.add.image(-230, 200, 'next_button').setInteractive();
    const replayBtn = this.add.image(230, 200, 'replay_button').setInteractive();

    nextBtn.on('pointerdown', () => this.notifyParent('sceneComplete', { result: 'win' }));
    replayBtn.on('pointerdown', () => {
      this.cleanupTextures();
      this.scene.restart();
    });

    this.levelCompleteOverlay.add([bg, title, nextBtn, replayBtn]);
  }

  triggerGameOver() {
    const centerX = this.sys.game.config.width / 2;
    const centerY = this.sys.game.config.height / 2;

    this.physics.pause?.();

    this.gameOverOverlay = this.add.container(centerX, centerY);

    const bg = this.add.image(0, 0, 'game_over').setDisplaySize(666, 216);
    const title = this.add.text(0, -30, 'Game Over', {
      font: "bold 70px Arial", color: '#fff'
    }).setOrigin(0.5);
    const btn = this.add.image(0, 120, 'replay_button_big').setInteractive().setDisplaySize(400, 100);
    const label = this.add.text(0, 120, 'Restart', {
      font: "bold 48px Arial", color: '#fff'
    }).setOrigin(0.5);

    btn.on("pointerdown", () => {
      this.cleanupTextures();
      this.scene.restart();
    });

    this.gameOverOverlay.add([bg, title, btn, label]);
  }

  cleanupTextures() {
    const cols = 2, rows = 4;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const idx = row * cols + col;
        const key = 'piece' + idx;
        if (this.textures && this.textures.exists(key)) {
          this.textures.remove(key);
        }
      }
    }
  }
  notifyParent(type, data) {
    if (window.parent !== window) {
      window.parent.postMessage({ type, ...data }, "*");
    }
  }

  enablePieces() {
    if (!this.pieces) return;
    this.pieces.forEach(p => p.setInteractive({ draggable: true }));
  }

  disablePieces() {
    if (!this.pieces) return;
    this.pieces.forEach(p => p.disableInteractive());
  }

  updateTimerDisplay(timeLeft) {
    const min = Math.floor(timeLeft / 60);
    const sec = Math.max(0, Math.floor(timeLeft % 60));
    const formatted = `${min}:${sec.toString().padStart(2, '0')}`;
    if (this.timerText) this.timerText.setText(`Time: ${formatted}`);
  }

  endGameTimer() {
    this.disablePieces();
    this.timerText.setText('Time: 0:00');
    this.triggerGameOver();
  }
}