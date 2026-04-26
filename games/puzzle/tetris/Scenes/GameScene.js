// GameScene.js — Portrait Tetris (10x20)
// Refactored for smoother gameplay, SRS rotation, ghost piece, and optimized line clears.
// Restored grid background drawing and completed all helper functions.

class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  //
  // >> 1. PHASER SCENE METHODS: preload, create, update
  //

  preload() {
    const cfg = this.registry.get('cfg') || {};
    const img = cfg.images1 || {};
    const img2 = cfg.images2 || {};
    const ui = cfg.ui || {};
    const aud = cfg.audio || {};

    // Load assets from config
    if (img.background) this.load.image('background', img2.background);
    if (img.block) this.load.image('colourful_block', img2.block);
    if (ui.left) this.load.image('btn_left', ui.left);
    if (ui.right) this.load.image('btn_right', ui.right);
    if (ui.action) this.load.image('btn_action', ui.action);
    if (ui.down) this.load.image('btn_down', ui.down);

    if (aud.bgm) this.load.audio('bgm', aud.bgm);
    ['move', 'rotate', 'lock', 'clear', 'tetris', 'gameover', 'levelup'].forEach(k => {
      if (aud[k]) this.load.audio(`s_${k}`, aud[k]);
    });
  }

  create() {
    this._ensureBlockTexture();
    this._ensureSparkTexture();
    // Fallback if block image is missing
    const cfg = this.registry.get('cfg') || {};
    this.W = 1080; this.H = 1920;

    this.targetScore = cfg.gameplay?.target_score ?? 500; // default to 500 if not provided
    this.winTriggered = false;
    this.cameras.main.setBackgroundColor('#14294b');

    if (this.textures.exists('background')) {
      this.add.image(this.W / 2, this.H / 2, 'background').setDisplaySize(this.W, this.H);
    }

    // Grid & Playfield Dimensions
    this.cols = 10; this.rows = 20;
    this.cell = Math.min(48, Math.floor((this.W * 0.86) / this.cols), Math.floor((this.H * 0.60) / this.rows));
    this.fieldW = this.cell * this.cols;
    this.fieldH = this.cell * this.rows;
    this.fieldX = Math.floor((this.W - this.fieldW) / 2);
    this.fieldY = Math.floor(this.H * 0.18);
    this._drawBoard();

    // Game State Initialization
    this.score = 0; this.lines = 0; this.level = 1;
    this.bag = []; this.nextQueue = [];
    this.holdPiece = null; this.canHold = true;
    this.gameOver = false;


    this.winTriggered = false;

    // Timers & Delays (in milliseconds)
    this.levelSpeeds = [800, 700, 600, 520, 450, 390, 340, 300, 265, 235, 210, 190, 170, 155, 140];
    this.gravityMs = this.levelSpeeds[0];
    this.lockDelayMs = 500;
    this.dasMs = 160;       // Delay before auto-shift starts
    this.arrMs = 45;        // Auto-repeat rate
    this.softDropMultiplier = 0.08;
    this.maxLockResets = 15;

    // Dynamic State
    this.fallTimer = 0;
    this.lockTimer = 0;
    this.lockResetCount = 0;
    this.grid = Array(this.rows).fill(null).map(() => Array(this.cols).fill(0));

    // Groups for managing sprites
    this.tileGroup = this.add.group();
    this.activePiece = { type: null, rot: 0, x: 0, y: 0, tiles: [] };
    this.ghostPiece = { type: null, tiles: [] };

    this._initSounds(cfg);
    this._initUI(cfg);
    this._initInput();
    this._initPieces();

    // Start the game
    while (this.nextQueue.length < 5) this._pushNextFromBag();
    this._spawnPiece();
  }

  update(time, delta) {
    if (this.gameOver || !this.activePiece.type) return;

    // --- Handle Input ---
    this._handleInput(delta);

    // --- Handle Gravity & Locking ---
    const isTouchingFloor = !this._canPlace(this.activePiece.type, this.activePiece.rot, this.activePiece.x, this.activePiece.y + 1);

    if (isTouchingFloor) {
      // On the ground, start or continue lock timer
      if (this.lockTimer === 0) this.lockResetCount = 0; // Reset counter when lock sequence begins
      this.lockTimer += delta;
    } else {
      // In the air, apply gravity and reset lock timer
      this.lockTimer = 0;
      const currentGravity = this.inputState.softDrop ? this.gravityMs * this.softDropMultiplier : this.gravityMs;
      this.fallTimer += delta;
      if (this.fallTimer >= currentGravity) {
        this.fallTimer = 0;
        this._tryMove(0, 1); // Gravity drop
      }
    }

    // Check if lock timer has expired
    if (this.lockTimer >= this.lockDelayMs) {
      this._placePiece();
    }
  }

  _checkWin() {
    if (this.winTriggered || this.gameOver) return;
    if (this.score >= this.targetScore) {
      this.winTriggered = true;
      this.sound.stopAll();
      this.scene.start('WinScene', {
        score: this.score,
        level: this.level,
        lines: this.lines
      });
    }
  }




  //
  // >> 2. CORE GAMEPLAY LOGIC
  //

  _spawnPiece() {
    this.fallTimer = 0;
    this.lockTimer = 0;
    this.canHold = true;

    if (this.nextQueue.length === 0) this._pushNextFromBag();
    const type = this.nextQueue.shift();
    while (this.nextQueue.length < 5) this._pushNextFromBag();

    this.activePiece = { type, rot: 0, x: Math.floor(this.cols / 2), y: 0, tiles: [] };

    // Game Over Condition: If the new piece spawns colliding with existing blocks.
    if (!this._canPlace(this.activePiece.type, this.activePiece.rot, this.activePiece.x, this.activePiece.y)) {
      this._endGame();
      return;
    }

    this._renderActive();
  }

  _placePiece() {
    if (!this.activePiece.type) return;
    const shape = this._shape(this.activePiece.type, this.activePiece.rot);

    // Game Over Condition: If any part of the piece locks above the visible board.
    for (const [dx, dy] of shape) {
      if (this.activePiece.y + dy < 0) {
        this._endGame();
        return;
      }
    }

    // Add piece to the static grid
    shape.forEach(([dx, dy]) => {
      const gx = this.activePiece.x + dx;
      const gy = this.activePiece.y + dy;
      if (gy >= 0 && gy < this.rows && gx >= 0 && gx < this.cols) {
        this.grid[gy][gx] = 1; // Mark grid cell as occupied

        // Create a static sprite for the locked block
        const sx = this.fieldX + gx * this.cell + this.cell / 2;
        const sy = this.fieldY + gy * this.cell + this.cell / 2;
        const tile = this.add.image(sx, sy, 'colourful_block').setTint(this.tints[this.activePiece.type]);
        tile.setDisplaySize(this.cell - 2, this.cell - 2);
        this.physics.add.existing(tile, true); // Make it a static physics body
        tile.body.updateFromGameObject(); // Ensure physics body position is synced
        this.tileGroup.add(tile);
      }
    });

    this.sound.play('s_lock', { volume: 0.6 });
    this._destroyActiveSprites(this.activePiece.tiles);
    this.activePiece.type = null; // Mark active piece as null

    // Check for line clears after a short delay to let the lock sound play
    this.time.delayedCall(50, () => {
      const clearedCount = this._clearLines();
      if (clearedCount > 0) {
        const ptsPer = [0, 100, 300, 500, 800]; // Score for 1, 2, 3, 4 lines
        this._addScore(ptsPer[clearedCount] * this.level);
        this.lines += clearedCount;
        this.sound.play(clearedCount === 4 ? 's_tetris' : 's_clear');

        const newLevel = 1 + Math.floor(this.lines / 10);
        if (newLevel > this.level) {
          this.level = newLevel;
          const speedIndex = Math.min(this.level - 1, this.levelSpeeds.length - 1);
          this.gravityMs = this.levelSpeeds[speedIndex];
          this.sound.play('s_levelup');
        }
        this._refreshLabels();
      }
      this._spawnPiece();
    });
  }

  _clearLines() {
    const fullRows = [];
    for (let r = this.rows - 1; r >= 0; r--) {
      if (this.grid[r].every(cell => cell !== 0)) {
        fullRows.push(r);
      }
    }
    if (fullRows.length === 0) return 0;

    // Find tiles in rows to destroy (for particles) and keep remaining for drop
    const tiles = this.tileGroup.getChildren();
    const tilesToDestroy = [];
    const remainingTiles = [];

    tiles.forEach(tile => {
      const row = Math.floor((tile.y - this.fieldY) / this.cell);
      if (fullRows.includes(row)) {
        tilesToDestroy.push(tile);
      } else {
        remainingTiles.push(tile);
      }
    });

    // VISUALS: flash + shake + particles
    this._flashBoard();
    this.cameras.main.shake(120, 0.0035);
    this._rowBursts(tilesToDestroy, fullRows.length);

    // Fade out cleared row tiles
    this.tweens.add({
      targets: tilesToDestroy,
      alpha: 0,
      duration: 180,
      ease: 'Power1',
      onComplete: () => tilesToDestroy.forEach(t => t.destroy())
    });

    // Drop above tiles
    remainingTiles.forEach(tile => {
      const oldRow = Math.floor((tile.y - this.fieldY) / this.cell);
      const rowsClearedBelow = fullRows.filter(r => r > oldRow).length;
      if (rowsClearedBelow > 0) {
        const ny = tile.y + rowsClearedBelow * this.cell;
        this.tweens.add({
          targets: tile,
          y: ny,
          duration: 120 + rowsClearedBelow * 20,
          ease: 'Quad.easeIn',
          onUpdate: () => tile.body && tile.body.updateFromGameObject(),
          onComplete: () => tile.body && tile.body.updateFromGameObject()
        });
      }
    });

    // Update grid
    fullRows.sort((a, b) => a - b).forEach(r => {
      this.grid.splice(r, 1);
      this.grid.unshift(new Array(this.cols).fill(0));
    });

    // Floating points near HUD
    const ptsPer = [0, 100, 300, 500, 800];
    const gained = ptsPer[fullRows.length] * this.level;
    this._floatScoreText(`+${gained}`);

    return fullRows.length;
  }


  // in class GameScene

  _endGame() {
    if (this.gameOver) return;
    this.gameOver = true;
    this.sound.stopAll();
    this.sound.play('s_gameover');

    // --- EDITED PART: TRANSITION TO GAMEOVER SCENE ---
    this.scene.start('GameOverScene', {
      score: this.score,
      level: this.level,
      lines: this.lines
    });
  }


  //
  // >> 3. PIECE MOVEMENT & COLLISION
  //

  _tryMove(dx, dy) {
    if (!this.activePiece.type) return false;
    const { type, rot, x, y } = this.activePiece;
    if (this._canPlace(type, rot, x + dx, y + dy)) {
      this.activePiece.x += dx;
      this.activePiece.y += dy;
      this._renderActive();
      this._resetLockTimerIfNeeded();
      return true;
    }
    return false;
  }

  _rotate(dir) {
    if (!this.activePiece.type) return;
    const { type, rot, x, y } = this.activePiece;
    const newRot = (rot + dir + 4) % 4; // Ensure positive modulo

    // Get kick data for this rotation
    const kickData = this.srsKicks[type === 'I' ? 'I' : 'JLSTZ'];
    const kickSet = kickData[`${rot}->${newRot}`] || [];

    for (const [kx, ky] of kickSet) {
      if (this._canPlace(type, newRot, x + kx, y - ky)) { // SRS Y-axis is inverted
        this.activePiece.x += kx;
        this.activePiece.y -= ky;
        this.activePiece.rot = newRot;
        this._renderActive();
        this.sound.play('s_rotate', { volume: 0.7 });
        this._resetLockTimerIfNeeded();
        return;
      }
    }
  }

  _hardDrop() {
    if (!this.activePiece.type) return;
    let dropDist = 0;
    while (this._canPlace(this.activePiece.type, this.activePiece.rot, this.activePiece.x, this.activePiece.y + 1)) {
      this.activePiece.y++;
      dropDist++;
    }
    this._addScore(2 * dropDist);
    this._placePiece();
  }

  _hold() {
    if (!this.canHold) return;
    this.canHold = false;
    this._destroyActiveSprites(this.activePiece.tiles);
    this._destroyActiveSprites(this.ghostPiece.tiles);


    const currentType = this.activePiece.type;
    if (this.holdPiece === null) {
      this.holdPiece = currentType;
      this._spawnPiece();
    } else {
      const newType = this.holdPiece;
      this.holdPiece = currentType;
      this.activePiece = { type: newType, rot: 0, x: Math.floor(this.cols / 2), y: 0, tiles: [] };
      if (!this._canPlace(this.activePiece.type, this.activePiece.rot, this.activePiece.x, this.activePiece.y)) {
        this._endGame();
        return;
      }
      this._renderActive();
    }
  }

  _canPlace(type, rot, x, y) {
    const shape = this._shape(type, rot);
    for (const [dx, dy] of shape) {
      const cx = x + dx;
      const cy = y + dy;
      // Check boundaries
      if (cx < 0 || cx >= this.cols || cy >= this.rows) return false;
      // Check grid collision (only for cells inside the playfield)
      if (cy >= 0 && this.grid[cy][cx] !== 0) return false;
    }
    return true;
  }

  _resetLockTimerIfNeeded() {
    // If the piece is on the floor, any successful move resets the lock delay
    const isTouchingFloor = !this._canPlace(this.activePiece.type, this.activePiece.rot, this.activePiece.x, this.activePiece.y + 1);
    if (isTouchingFloor) {
      this.lockResetCount++;
      // Prevent infinite stalling by forcing a lock after too many resets
      if (this.lockResetCount >= this.maxLockResets) {
        this._placePiece();
      } else {
        this.lockTimer = 0; // Reset the timer
      }
    }
  }


  //
  // >> 4. INPUT HANDLING
  //

  _initInput() {
    this.inputState = { left: false, right: false, softDrop: false, hardDrop: false, rotate: false, hold: false };
    this.dasTimer = { left: 0, right: 0 }; // Timers for horizontal auto-shift

    this.input.keyboard.on('keydown', e => {
      switch (e.code) {
        case 'ArrowLeft':
        case 'KeyA': this.inputState.left = true; this.dasTimer.left = 0; break;
        case 'ArrowRight':
        case 'KeyD': this.inputState.right = true; this.dasTimer.right = 0; break;
        case 'ArrowDown':
        case 'KeyS': this.inputState.softDrop = true; break;
        case 'ArrowUp':
        case 'KeyW':
          if (!this.inputState.rotate) { this._rotate(1); } // Rotate on initial press
          this.inputState.rotate = true;
          break;
        case 'Space':
          if (!this.inputState.hardDrop) { this._hardDrop(); }
          this.inputState.hardDrop = true;
          break;
        case 'KeyC':
          if (!this.inputState.hold) { this._hold(); }
          this.inputState.hold = true;
          break;
      }
    });

    this.input.keyboard.on('keyup', e => {
      switch (e.code) {
        case 'ArrowLeft':
        case 'KeyA': this.inputState.left = false; break;
        case 'ArrowRight':
        case 'KeyD': this.inputState.right = false; break;
        case 'ArrowDown':
        case 'KeyS': this.inputState.softDrop = false; break;
        case 'ArrowUp':
        case 'KeyW': this.inputState.rotate = false; break;
        case 'Space': this.inputState.hardDrop = false; break;
        case 'KeyC': this.inputState.hold = false; break;
      }
    });

    this._setupMobileButtons();
  }

  _handleInput(delta) {
    // Horizontal Movement (DAS)
    const processMove = (dir, key) => {
      if (this.inputState[key]) {
        this.dasTimer[key] += delta;
        const isInitialPress = this.dasTimer[key] === delta; // First frame it's held
        const isRepeating = this.dasTimer[key] > this.dasMs && (this.dasTimer[key] - this.dasMs) % this.arrMs < delta;

        if (isInitialPress || isRepeating) {
          if (this._tryMove(dir, 0)) {
            this.sound.play('s_move', { volume: 0.6 });
          }
        }
      }
    };
    processMove(-1, 'left');
    processMove(1, 'right');
  }

  _setupMobileButtons() {
    const cam = this.cameras.main;
    const y = cam.height - 150;

    // A helper to create our buttons
    const makeButton = (config) => {
      const btn = this.add.image(config.x, config.y, config.texture)
        .setScrollFactor(0)
        .setDepth(30)
        .setDisplaySize(config.size, config.size)
        .setInteractive({ useHandCursor: true });

      btn.on('pointerdown', () => {
        btn.setScale(0.92).setAlpha(0.8);
        if (config.onDown) config.onDown();
      });

      const onUpOrOut = () => {
        btn.setScale(1).setAlpha(1);
        if (config.onUp) config.onUp();
      };
      btn.on('pointerup', onUpOrOut);
      btn.on('pointerout', onUpOrOut);
    };

    // Left button (holdable)
    makeButton({
      x: 180, y: 1600, texture: 'btn_left', size: 100,
      onDown: () => { this.inputState.left = true; this.dasTimer.left = 0; },
      onUp: () => { this.inputState.left = false; }
    });

    // Right button (holdable)
    makeButton({
      x: 420, y: 1600, texture: 'btn_right', size: 100,
      onDown: () => { this.inputState.right = true; this.dasTimer.right = 0; },
      onUp: () => { this.inputState.right = false; }
    });

    // Rotate button (single press)
    makeButton({
      x: this.W - 180, y: 1600, texture: 'btn_action', size: 100,
      onDown: () => this._rotate(1)
    });

    // Hard drop button (single press)
    makeButton({
      x: this.W - 400, y: 1600, texture: 'btn_down', size: 100,
      onDown: () => this._hardDrop()
    });

    // Hold button (single press)
    // makeButton({
    //   x: this.fieldX - 100, y: this.fieldY + 80, texture: 'btn_action', size: 100,
    //   onDown: () => this._hold()
    // });

    // Enable soft drop by tapping/dragging on the playfield
    const zone = this.add.zone(this.fieldX, this.fieldY, this.fieldW, this.fieldH).setOrigin(0).setInteractive();
    zone.on('pointerdown', () => this.inputState.softDrop = true);
    zone.on('pointerup', () => this.inputState.softDrop = false);
    zone.on('pointerout', () => this.inputState.softDrop = false);
  }


  //
  // >> 5. RENDERING & UI
  //

  _renderActive() {
    this._destroyActiveSprites(this.activePiece.tiles);
    const shape = this._shape(this.activePiece.type, this.activePiece.rot);
    shape.forEach(([dx, dy]) => {
      const x = this.fieldX + (this.activePiece.x + dx) * this.cell + this.cell / 2;
      const y = this.fieldY + (this.activePiece.y + dy) * this.cell + this.cell / 2;
      // Do not render tiles that are above the visible playfield
      if (y > this.fieldY) {
        const tile = this.add.image(x, y, 'colourful_block').setTint(this.tints[this.activePiece.type]);
        tile.setDisplaySize(this.cell - 2, this.cell - 2).setDepth(10);
        this.activePiece.tiles.push(tile);
      }
    });
    this._renderGhost();
  }

  _renderGhost() {
    this._destroyActiveSprites(this.ghostPiece.tiles);
    if (!this.activePiece.type) return;

    let ghostY = this.activePiece.y;
    while (this._canPlace(this.activePiece.type, this.activePiece.rot, this.activePiece.x, ghostY + 1)) {
      ghostY++;
    }

    const shape = this._shape(this.activePiece.type, this.activePiece.rot);
    shape.forEach(([dx, dy]) => {
      const x = this.fieldX + (this.activePiece.x + dx) * this.cell + this.cell / 2;
      const y = this.fieldY + (ghostY + dy) * this.cell + this.cell / 2;
      if (y > this.fieldY) {
        const tile = this.add.image(x, y, 'colourful_block').setTint(this.tints[this.activePiece.type]);
        tile.setDisplaySize(this.cell - 2, this.cell - 2).setDepth(9).setAlpha(0.3);
        this.ghostPiece.tiles.push(tile);
      }
    });
  }

  _destroyActiveSprites(spriteArray) {
    if (spriteArray) {
      spriteArray.forEach(s => s.destroy());
      spriteArray.length = 0;
    }
  }

  _drawBoard() {
    const g = this.add.graphics({ x: this.fieldX, y: this.fieldY });
    // Fill for the background of the grid
    g.fillStyle(0x0f1f3c, 1);
    g.fillRoundedRect(0, 0, this.fieldW, this.fieldH, 16);
    // Style for the grid lines
    g.lineStyle(1, 0x1f355f, 0.6);
    // Draw vertical grid lines
    for (let c = 1; c < this.cols; c++) {
      g.lineBetween(c * this.cell, 0, c * this.cell, this.fieldH);
    }
    // Draw horizontal grid lines
    for (let r = 1; r < this.rows; r++) {
      g.lineBetween(0, r * this.cell, this.fieldW, r * this.cell);
    }
  }

  _initUI(cfg) {
    const texts = (cfg.texts || {});
    const fontFamily = (cfg.font?.family || 'Arial');

    // Panel width fits the playfield width
    const panelW = Math.max(this.fieldW * 0.9, 780);
    const panelH = 150;
    const panelX = (this.W - panelW) / 2;
    const panelY = this.fieldY - (panelH + 40);

    // Panel behind labels
    this._makeHudPanel(panelX, panelY, panelW, panelH);

    // Title (subtle)
    this.lblTitle = this._makeNeonText(this.W / 2, panelY + 34, texts.title || '', {
      size: 32,
      color: '#e6f3ff',
      stroke: '#88b7ff',
      strokeThickness: 3,
      shadowColor: '#6fb6ff',
      shadowBlur: 12,
      fontFamily,
      originX: 0.5,
      originY: 0.5,
    });

    // Score (big & juicy)
    this.lblScore = this._makeNeonText(this.W / 2, panelY + 50, `${texts.score_label || 'Score:'} 0`, {
      size: 54,
      color: '#ffffff',
      stroke: '#00ffc6',
      strokeThickness: 6,
      shadowColor: '#00ffd5',
      shadowBlur: 22,
      fontFamily,
    });

    // Level/lines/target (slightly smaller, gold-ish)
    this.lblLevel = this._makeNeonText(this.W / 2, panelY + 130, `Level 1  |  Lines 0  |  Target ${this.targetScore}`, {
      size: 30,
      color: '#ffe9ad',
      stroke: '#ffc94d',
      strokeThickness: 4,
      shadowColor: '#ffdf7a',
      shadowBlur: 14,
      fontFamily,
    });

    // Keep a copy to detect changes for animations
    this._lastHud = { score: 0, level: 1, lines: 0 };
  }



  _refreshLabels() {
    const texts = (this.registry.get('cfg')?.texts || {});
    const scoreTxt = `${texts.score_label || 'Score:'} ${this.score}`;
    const levelTxt = `Level ${this.level}  |  Lines ${this.lines}  |  Target ${this.targetScore}`;

    // Animate on change
    if (this.score !== this._lastHud.score) this._pulse(this.lblScore);
    if (this.level !== this._lastHud.level || this.lines !== this._lastHud.lines) this._pulse(this.lblLevel, 1.06, 140);

    this.lblScore.setText(scoreTxt);
    this.lblLevel.setText(levelTxt);

    this._lastHud.score = this.score;
    this._lastHud.level = this.level;
    this._lastHud.lines = this.lines;
  }



  _addScore(v) {
    this.score += v;
    this._refreshLabels();
    this._checkWin();   // <<< call win check here
  }



  //
  // >> 6. DATA & HELPERS
  //

  _initSounds(cfg) {
    this.sound.add('bgm', { loop: true, volume: 0.5 });
    if (cfg.audio?.bgm) this.sound.play('bgm');
  }

  _pushNextFromBag() {
    if (this.bag.length === 0) {
      this.bag = ['I', 'O', 'T', 'J', 'L', 'S', 'Z'];
      Phaser.Utils.Array.Shuffle(this.bag);
    }
    this.nextQueue.push(this.bag.pop());
  }

  _shape(type, rot) {
    return this.pieces[type][rot % this.pieces[type].length];
  }

  _ensureBlockTexture() {
    if (this.textures.exists('colourful_block')) return;
    const size = 129;
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(0xffffff, 1); g.fillRoundedRect(0, 0, size, size, 18);
    g.lineStyle(6, 0xb0b8c8, 1); g.strokeRoundedRect(3, 3, size - 6, size - 6, 16);
    g.fillStyle(0xffffff, 0.25); g.fillRoundedRect(10, 10, size - 20, Math.floor(size * 0.45), 12);
    g.fillStyle(0x000000, 0.18); g.fillRoundedRect(10, Math.floor(size * 0.55), size - 20, Math.floor(size * 0.35), 12);
    g.lineStyle(2, 0xffffff, 0.08); g.lineBetween(12, size * 0.52, size - 12, size * 0.52);
    g.generateTexture('colourful_block', size, size);
    g.destroy();
  }

  _initPieces() {
    // Piece shapes defined for each of 4 rotations (0, 1, 2, 3)
    this.pieces = {
      I: [[[-1, 0], [0, 0], [1, 0], [2, 0]], [[1, -1], [1, 0], [1, 1], [1, 2]], [[-1, 1], [0, 1], [1, 1], [2, 1]], [[0, -1], [0, 0], [0, 1], [0, 2]]],
      O: [[[0, 0], [1, 0], [0, 1], [1, 1]], [[0, 0], [1, 0], [0, 1], [1, 1]], [[0, 0], [1, 0], [0, 1], [1, 1]], [[0, 0], [1, 0], [0, 1], [1, 1]]],
      T: [[[-1, 0], [0, 0], [1, 0], [0, -1]], [[0, -1], [0, 0], [0, 1], [1, 0]], [[-1, 0], [0, 0], [1, 0], [0, 1]], [[0, -1], [0, 0], [0, 1], [-1, 0]]],
      J: [[[-1, -1], [-1, 0], [0, 0], [1, 0]], [[0, -1], [1, -1], [0, 0], [0, 1]], [[-1, 0], [0, 0], [1, 0], [1, 1]], [[0, -1], [0, 0], [-1, 1], [0, 1]]],
      L: [[[-1, 0], [0, 0], [1, 0], [1, -1]], [[0, -1], [0, 0], [0, 1], [1, 1]], [[-1, 1], [-1, 0], [0, 0], [1, 0]], [[-1, -1], [0, -1], [0, 0], [0, 1]]],
      S: [[[-1, 0], [0, 0], [0, -1], [1, -1]], [[0, -1], [0, 0], [1, 0], [1, 1]], [[-1, 1], [0, 1], [0, 0], [1, 0]], [[-1, -1], [-1, 0], [0, 0], [0, 1]]],
      Z: [[[-1, -1], [0, -1], [0, 0], [1, 0]], [[1, -1], [1, 0], [0, 0], [0, 1]], [[-1, 0], [0, 0], [0, 1], [1, 1]], [[0, -1], [0, 0], [-1, 0], [-1, 1]]],
    };
    this.tints = { I: 0x49c6ff, O: 0xffe16b, T: 0xbb6bff, J: 0x6bb7ff, L: 0xff9d4d, S: 0x6bff9a, Z: 0xff6b6b };

    // Standard SRS kick data. [kx, ky]
    // See: https://tetris.fandom.com/wiki/SRS
    this.srsKicks = {
      'JLSTZ': {
        '0->1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
        '1->0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
        '1->2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
        '2->1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
        '2->3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
        '3->2': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
        '3->0': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
        '0->3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
      },
      'I': {
        '0->1': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
        '1->0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
        '1->2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
        '2->1': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
        '2->3': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
        '3->2': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
        '3->0': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
        '0->3': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
      }
    };
  }

  _makeHudPanel(x, y, w, h) {
    const g = this.add.graphics();
    g.setDepth(5);

    // Soft shadow
    g.fillStyle(0x000000, 0.25);
    g.fillRoundedRect(x + 8, y + 10, w, h, 18);

    // Main panel
    g.fillStyle(0x0c1a33, 0.85);
    g.fillRoundedRect(x, y, w, h, 18);

    // Inner highlight
    g.lineStyle(2, 0x2a4c86, 0.9);
    g.strokeRoundedRect(x + 3, y + 3, w - 6, h - 6, 16);

    // Top glow bar
    g.fillStyle(0x1a3a6d, 0.45);
    g.fillRoundedRect(x + 8, y + 8, w - 16, Math.max(14, Math.floor(h * 0.18)), 12);
    return g;
  }

  _makeNeonText(x, y, txt, opts = {}) {
    const {
      size = 48,
      color = '#ffffff',
      stroke = '#0ff',
      strokeThickness = 6,
      shadowColor = '#00e5ff',
      shadowBlur = 24,
      fontFamily = 'Arial',
      originX = 0.5,
      originY = 0.5,
      depth = 10,
    } = opts;

    const t = this.add.text(x, y, txt, {
      fontFamily,
      fontSize: `${size}px`,
      color,
      stroke: stroke,
      strokeThickness,
    })
      .setOrigin(originX, originY)
      .setDepth(depth);

    // Soft neon glow
    t.setShadow(0, 0, shadowColor, shadowBlur, true, true);
    return t;
  }

  _pulse(target, scale = 1.08, duration = 120) {
    if (!target) return;
    this.tweens.add({
      targets: target,
      scaleX: target.scaleX * scale,
      scaleY: target.scaleY * scale,
      yoyo: true,
      duration,
      ease: 'Quad.easeOut',
    });
  }

  _ensureSparkTexture() {
    if (this.textures.exists('spark')) return;
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    // radial sparkle
    g.fillStyle(0xffffff, 1);
    g.fillCircle(8, 8, 8);
    g.fillStyle(0xffffff, 0.6);
    g.fillCircle(8, 8, 5);
    g.fillStyle(0xffffff, 0.35);
    g.fillCircle(8, 8, 2.5);
    g.generateTexture('spark', 16, 16);
    g.destroy();
  }

  _rowBursts(tilesToDestroy, lines) {
    if (!tilesToDestroy.length) return;
    const countPerTile = Phaser.Math.Clamp(6 + lines * 2, 6, 14);

    tilesToDestroy.forEach(tile => {
      const emitter = this.add.particles(0, 0, 'spark', {
        x: tile.x,
        y: tile.y,
        lifespan: { min: 220, max: 360 },
        speed: { min: 80, max: 220 },
        angle: { min: 200, max: 340 }, // mostly downward
        gravityY: 500,
        quantity: countPerTile,
        scale: { start: 0.9, end: 0 },
        alpha: { start: 0.95, end: 0 },
        blendMode: 'ADD',
        tint: [0x9dfcff, 0xa7ffde, 0xfff6a5, 0xffa6b3]
      });
      // short life for the emitter itself
      this.time.delayedCall(120, () => emitter.destroy());
    });
  }

  _flashBoard() {
    // quick white sweep over the board
    const fx = this.add.rectangle(
      this.fieldX + this.fieldW / 2,
      this.fieldY + this.fieldH / 2,
      this.fieldW, this.fieldH,
      0xffffff, 0.0
    ).setDepth(50).setBlendMode('ADD');

    this.tweens.add({
      targets: fx,
      alpha: { from: 0.0, to: 0.35 },
      duration: 70,
      yoyo: true,
      ease: 'Quad.easeOut',
      onComplete: () => fx.destroy()
    });
  }

  _floatScoreText(text = '+100') {
    const yBase = this.fieldY - 16; // just above the panel
    const t = this._makeNeonText(this.W / 2, yBase, text, {
      size: 42,
      color: '#ffffff',
      stroke: '#00ffc6',
      strokeThickness: 6,
      shadowColor: '#00ffd5',
      shadowBlur: 20,
      fontFamily: (this.registry.get('cfg')?.font?.family || 'Arial'),
      depth: 60
    }).setScale(0.9);

    this.tweens.add({
      targets: t,
      y: yBase - 50,
      alpha: { from: 1, to: 0 },
      scaleX: 1.1,
      scaleY: 1.1,
      duration: 650,
      ease: 'Cubic.easeOut',
      onComplete: () => t.destroy()
    });

    // tiny pulse on the score label too
    this._pulse(this.lblScore, 1.08, 120);
  }


}