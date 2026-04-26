export default class NumberMergeScene extends Phaser.Scene {
  constructor() {
    super('NumberMergeScene');
    Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach((fn) => {
      if (typeof this[fn] === 'function') this[fn] = this[fn].bind(this);
    });

    this.gameStarted = false;
    this.timerEvent = null;
    this.timeLeft = 600;
    this.timerText = null;

    this.grid = [];
    this.tiles = [];
    this.score = 0;
    // --- constructor additions ---
    this.backgroundMusic = null;
    this.sfxMerge = null;

  }

  preload() {
    const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));
    this.load.json('levelConfig', `${basePath}/config.json`);

    this.load.once('filecomplete-json-levelConfig', () => {
      const config = this.cache.json.get('levelConfig');
      this.configData = config;

      const { images2 = {}, ui = {}, audio = {}, game = {} } = config;

      // Read optional theme colors from JSON (with nice defaults)
      this.theme = {
        boardColor: (game.theme && game.theme.boardColor) || '#bbada0',   // main panel
        cellColor: (game.theme && game.theme.cellColor) || '#cdc1b4',   // empty cell
        shadowAlpha: 0.18
      };

      // Gameplay values
      this.gridSize = game.gridSize || 4;
      this.gap = game.gap || 15;
      this.tileSize = game.tileSize || 129;
      this.fontSize = game.fontSize || 64;

      this.timeLimit = this.getTimeLimitFromConfig(game);

      // Tiles
      this.tileImages = images2 || {};

      // Load background if present
      if (images2.background) {
        this.load.image('background', `${basePath}/${images2.background}`);
      }

      // Load tile images
      for (const key in images2) {
        this.load.image(`${key}`, `${basePath}/${images2[key]}`);
      }

      // Load UI images
      for (const key in ui) {
        this.load.image(key, `${basePath}/${ui[key]}`);
      }

      // Load audio (optional)
      for (const key in audio) {
        this.load.audio(key, `${basePath}/${audio[key]}`);
      }

      // Start loading queued assets
      this.load.start();
    });
  }

  create() {
    const screenW = this.sys.game.config.width;
    const screenH = this.sys.game.config.height;


 

    this.showHTPPopup(screenW, screenH);

  }

  showHTPPopup(screenW, screenH) {
    this.htpGroup = this.add.group();
    const htpBox = this.add.image(screenW / 2, screenH / 2, 'htpbox').setOrigin(0.5);
    const howTo = 'Merge tiles with the same number by\nswiping in any direction.\nCombine numbers to reach 2048\nbefore the timer runs out!';
    const text = this.makeFancyText(screenW / 2, screenH / 2 - 80, howTo, {
      size: 44,
      color: '#ffffff',
      stroke: '#2b2b2b',
      strokeThickness: 6,
      shadowColor: '#000000',
      shadowBlur: 10,
      shadowOffsetY: 3,
      align: 'center',
      origin: 0.5
    });

    const playBtn = this.add.image(screenW / 2, screenH / 2 + 650, 'playbtn').setOrigin(0.5).setInteractive({ useHandCursor: true });

    this.htpGroup.addMultiple([htpBox, text, playBtn]);
    playBtn.once('pointerup', () => {
      this.htpGroup.clear(true, true);
      this.startGame(screenW, screenH);
    });
  }

  startGame(screenW, screenH) {
    // Calculate grid layout
    this.grid = [];
    this.tiles = [];
    this.score = 0;
    this.scoreText = null;

    const GRID_PIXEL_SIZE = this.tileSize * this.gridSize + this.gap * (this.gridSize + 1);
    const offsetX = (screenW - GRID_PIXEL_SIZE) / 2;
    const offsetY = (screenH - GRID_PIXEL_SIZE) / 2;


         this.addBackgroundEffects();

    // Board panel + empty cells (vector)
    this.drawGridBackground(offsetX, offsetY, GRID_PIXEL_SIZE);

    // Background (under everything)
    this.add.image(screenW / 2, screenH / 2, 'background')
      .setDisplaySize(screenW, screenH)
      .setDepth(-1);


  


    const barY = screenH / 2 - 900;

    // Score
    this.scoreBadge = this.makeBadgeText(screenW / 2 - 260, barY, 'SCORE:', '0', {
      size: 40, strokeThickness: 5
    });
    this.scoreBadge.right.x -= 130;

    const initialTimeStr = '10:00';
    this.timerBadge = this.makeBadgeText(screenW / 2 + 260, barY, 'TIME:', initialTimeStr, {
      size: 40, strokeThickness: 5
    });
    this.timerBadge.left.x += 120   // the "TIME" label  

    // Keep a plain handle for quick updates
    this.scoreText = { setText: (v) => this.scoreBadge.update(String(v)) };
    this.timerText = { setText: (v) => this.timerBadge.update(v) };

    // Create grid placeholders
    for (let y = 0; y < this.gridSize; y++) {
      this.grid[y] = [];
      this.tiles[y] = [];
      for (let x = 0; x < this.gridSize; x++) {
        this.grid[y][x] = 0;
      }
    }

    this.addRandomTile(offsetX, offsetY);
    this.addRandomTile(offsetX, offsetY);

    // Controls
    this.input.keyboard.on('keydown', (e) => {
      if (!this.gameStarted) return;
      let moved = false;
      switch (e.code) {
        case 'ArrowUp': moved = this.move(0, -1, offsetX, offsetY); break;
        case 'ArrowDown': moved = this.move(0, 1, offsetX, offsetY); break;
        case 'ArrowLeft': moved = this.move(-1, 0, offsetX, offsetY); break;
        case 'ArrowRight': moved = this.move(1, 0, offsetX, offsetY); break;
      }
      if (moved) {
        this.time.delayedCall(140, () => {
          this.addRandomTile(offsetX, offsetY);
          if (!this.canMove()) this.gameOver();
        });
      }
    });

    let startX, startY;
    this.input.on('pointerdown', pointer => {
      if (!this.gameStarted) return;
      startX = pointer.x;
      startY = pointer.y;
    });
    this.input.on('pointerup', pointer => {
      if (!this.gameStarted) return;
      const dx = pointer.x - startX;
      const dy = pointer.y - startY;
      if (Math.abs(dx) > Math.abs(dy)) {
        if (dx > 30) this.moveAndAdd(1, 0, offsetX, offsetY);
        else if (dx < -30) this.moveAndAdd(-1, 0, offsetX, offsetY);
      } else {
        if (dy > 30) this.moveAndAdd(0, 1, offsetX, offsetY);
        else if (dy < -30) this.moveAndAdd(0, -1, offsetX, offsetY);
      }
    });

    // Start timer
    this.timeLeft = this.timeLimit;  // ← from JSON
    this.timerEvent = this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        if (!this.gameStarted) return;
        this.timeLeft--;
        this.updateTimerText();
        if (this.timeLeft <= 0) {
          this.timerEvent.remove(false);
          this.gameOver();
        }
      }
    });

    if (!this.backgroundMusic) {
      this.backgroundMusic = this.sound.add('bgm', { loop: true, volume: 0.35 });
    }
    if (!this.backgroundMusic.isPlaying) this.backgroundMusic.play();

    if (!this.sfxMerge) {
      this.sfxMerge = this.sound.add('merge', { volume: 0.8 });
    }

    this.gameStarted = true;
  }


  updateTimerText() {
    const min = Math.floor(this.timeLeft / 60);
    const sec = this.timeLeft % 60;
    const t = `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
    this.timerText.setText(t);
  }




  addRandomTile(offsetX, offsetY) {
    const empty = [];
    for (let y = 0; y < this.gridSize; y++) {
      for (let x = 0; x < this.gridSize; x++) {
        if (this.grid[y][x] === 0) empty.push({ x, y });
      }
    }
    if (empty.length === 0) return;

    const spot = Phaser.Utils.Array.GetRandom(empty);
    const value = Math.random() < 0.9 ? 2 : 4;
    this.grid[spot.y][spot.x] = value;

    const tileX = offsetX + this.gap + spot.x * (this.tileSize + this.gap) + this.tileSize / 2;
    const tileY = offsetY + this.gap + spot.y * (this.tileSize + this.gap) + this.tileSize / 2;

    const imageKey = `tile_${value}`;
    const tile = this.add.image(tileX, tileY, imageKey).setDisplaySize(this.tileSize, this.tileSize);
    const label = this.makeFancyText(tileX, tileY, String(value), {
      size: this.fontSize,
      color: value <= 4 ? '#3b3b3b' : '#ffffff',
      stroke: value <= 4 ? '#ffffff' : '#2b2b2b',
      strokeThickness: value <= 4 ? 4 : 6,
      shadowColor: '#000000',
      shadowBlur: 6,
      shadowOffsetY: 2,
      fontFamily: 'outfit',
      fontStyle: '700',
      origin: 0.5,
      depth: 2
    }).setData('isTileLabel', true);

    // start small and pop in
    tile.setScale(0);
    label.setScale(0);
    this.tiles[spot.y][spot.x] = { tile, label };

    // animate spawn pop
    this.animateSpawn(tile, label);
  }

  moveAndAdd(dx, dy, offsetX, offsetY) {
    if (this.move(dx, dy, offsetX, offsetY)) {
      this.time.delayedCall(140, () => {
        this.addRandomTile(offsetX, offsetY);
        if (!this.canMove()) this.gameOver();
      });
    }
  }

  move(dx, dy, offsetX, offsetY) {
    let moved = false;
    const combined = Array.from({ length: this.gridSize }, () => Array(this.gridSize).fill(false));
    let range = [...Array(this.gridSize).keys()];
    if (dx === 1 || dy === 1) range = range.reverse();

    for (let i of range) {
      for (let j of range) {
        const x = dx === 0 ? j : i;
        const y = dy === 0 ? j : i;
        const value = this.grid[y][x];
        if (value === 0) continue;

        let nx = x, ny = y;
        while (true) {
          const tx = nx + dx, ty = ny + dy;
          if (tx < 0 || tx >= this.gridSize || ty < 0 || ty >= this.gridSize) break;
          if (this.grid[ty][tx] === 0) {
            this.grid[ty][tx] = this.grid[ny][nx];
            this.grid[ny][nx] = 0;
            this.swapTiles(nx, ny, tx, ty, offsetX, offsetY);
            nx = tx; ny = ty;
            moved = true;
          } else if (this.grid[ty][tx] === value && !combined[ty][tx]) {
            this.grid[ty][tx] *= 2;
            this.grid[ny][nx] = 0;
            const gained = this.grid[ty][tx];
            this.score += gained;
            this.scoreText.setText(this.score);

            // floating score from merged cell -> badge
            this.showScoreGainAtGrid(tx, ty, offsetX, offsetY, gained);

            // remove old tile visuals at source and create/animate upgraded tile at target
            this.destroyTile(nx, ny);
            this.updateTile(tx, ty, offsetX, offsetY, /* isMerge */ true);
            if (this.grid[ty][tx] === 2048) { // or your target tile value
              this.win();
            }
            combined[ty][tx] = true;
            moved = true;
            break;
          } else break;
        }
      }
    }
    return moved;
  }

  // --- BACKGROUND EFFECTS ---


  swapTiles(x1, y1, x2, y2, offsetX, offsetY) {
    const tile = this.tiles[y1][x1];
    if (!tile) return;
    this.tiles[y1][x1] = null;
    this.tiles[y2][x2] = tile;

    const tileX = offsetX + this.gap + x2 * (this.tileSize + this.gap) + this.tileSize / 2;
    const tileY = offsetY + this.gap + y2 * (this.tileSize + this.gap) + this.tileSize / 2;

    // Smooth move with easing, then tiny pop when it lands
    this.sys.tweens.add({
      targets: [tile.tile, tile.label],
      x: tileX,
      y: tileY,
      duration: 160,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        this.popTile(tile.tile, tile.label);
      }
    });
  }


  // --- unchanged methods omitted for brevity ---

  addBackgroundEffects() {
    // floating circles
    this.bgParticles = this.add.group();
    this.time.addEvent({
      delay: 900,
      loop: true,
      callback: () => {
        const x = Phaser.Math.Between(50, this.cameras.main.width - 50);
        const y = this.cameras.main.height + 30;
        const circle = this.add.circle(x, y, Phaser.Math.Between(3, 8), 0xffffff, 0.08).setDepth(-5);
        this.bgParticles.add(circle);
        this.tweens.add({
          targets: circle,
          y: -20,
          alpha: 0,
          duration: Phaser.Math.Between(7000, 10000),
          ease: 'Sine.easeOut',
          onComplete: () => circle.destroy()
        });
      }
    });

    // pulsing glow around board
    const boardSize = this.gridSize * this.tileSize + (this.gridSize - 1) * this.gap;
    this.gridStartX = (this.sys.game.config.width - boardSize) / 2;
    this.gridStartY = (this.sys.game.config.height - boardSize) / 2;
    const glow = this.add.rectangle(
      this.gridStartX + boardSize / 2,
      this.gridStartY + boardSize / 2,
      boardSize + 80,
      boardSize + 80,
      0xffffff,
      0.05
    ).setDepth(-4);
    this.tweens.add({
      targets: glow,
      alpha: { from: 0.05, to: 0.15 },
      scale: { from: 1, to: 1.05 },
      duration: 4000,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });

    // random twinkles
    this.time.addEvent({
      delay: 1800,
      loop: true,
      callback: () => {
        const x = Phaser.Math.Between(this.gridStartX, this.gridStartX + boardSize);
        const y = Phaser.Math.Between(this.gridStartY, this.gridStartY + boardSize);
        const star = this.add.star(x, y, 5, 2, 6, 0xffffff, 0.4).setDepth(-6);
        this.tweens.add({
          targets: star,
          alpha: { from: 0.4, to: 0 },
          scale: { from: 0.5, to: 1.6 },
          duration: 900,
          ease: 'Cubic.easeOut',
          onComplete: () => star.destroy()
        });
      }
    });
  }

  updateTile(x, y, offsetX, offsetY, isMerge = false) {
    this.destroyTile(x, y);
    const value = this.grid[y][x];
    const tileX = offsetX + this.gap + x * (this.tileSize + this.gap) + this.tileSize / 2;
    const tileY = offsetY + this.gap + y * (this.tileSize + this.gap) + this.tileSize / 2;
    const imageKey = `tile_${value}`;
    const newTile = this.add.image(tileX, tileY, imageKey).setDisplaySize(this.tileSize, this.tileSize);
    const label = this.makeFancyText(tileX, tileY, String(value), {
      size: this.fontSize,
      color: value <= 4 ? '#3b3b3b' : '#ffffff',
      stroke: value <= 4 ? '#ffffff' : '#2b2b2b',
      strokeThickness: value <= 4 ? 4 : 6,
      shadowColor: '#000000',
      shadowBlur: 6,
      shadowOffsetY: 2,
      fontFamily: 'outfit',
      fontStyle: '700',
      origin: 0.5,
      depth: 2
    }).setData('isTileLabel', true);
    this.tiles[y][x] = { tile: newTile, label };

    if (isMerge && this.sfxMerge) this.sfxMerge.play();

    if (isMerge) {
      this.time.delayedCall(40, () => {
        this.sys.tweens.add({
          targets: [newTile, label],
          scale: { from: 1.0, to: 1.15 },
          duration: 200,
          ease: 'Back.easeOut',
          yoyo: true,
          onStart: () => {
            newTile.setTint(0xfff4d6);
          },
          onComplete: () => {
            newTile.clearTint && newTile.clearTint();
            newTile.setScale(1.0);
            label.setScale(1.0);
          }
        });
        this.burstEffect(tileX, tileY, 6);
      });
    } else {
      this.animateSpawn(newTile, label);
    }
  }

  // --- rest of your methods unchanged ---



  destroyTile(x, y) {
    if (this.tiles[y] && this.tiles[y][x]) {
      // fade out quickly then destroy to make merges look smoother
      const t = this.tiles[y][x];
      try {
        this.sys.tweens.add({
          targets: [t.tile, t.label],
          alpha: 0,
          duration: 90,
          onComplete: () => {
            t.tile.destroy();
            t.label.destroy();
          }
        });
      } catch (e) {
        t.tile.destroy();
        t.label.destroy();
      }
      this.tiles[y][x] = null;
    }
  }

  canMove() {
    for (let y = 0; y < this.gridSize; y++) {
      for (let x = 0; x < this.gridSize; x++) {
        const val = this.grid[y][x];
        if (val === 0) return true;
        for (const [dx, dy] of [[1, 0], [0, 1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < this.gridSize && ny < this.gridSize && this.grid[ny][nx] === val) return true;
        }
      }
    }
    return false;
  }

  // ── Fancy text helpers ─────────────────────────────────────────────────────────
  _makeHex(c) { return (typeof c === 'number') ? '#' + c.toString(16).padStart(6, '0') : c; }

  makeFancyText(x, y, txt, {
    size = 50,
    color = '#ffffff',
    stroke = '#000000',
    strokeThickness = 6,
    shadowColor = '#000000',
    shadowBlur = 8,
    shadowOffsetX = 0,
    shadowOffsetY = 4,
    fontFamily = 'outfit',
    fontStyle = '700', // bold-ish
    align = 'center',
    origin = 0.5,
    depth = 10
  } = {}) {
    const t = this.add.text(x, y, txt, {
      font: `${fontStyle} ${size}px ${fontFamily}`,
      color: this._makeHex(color),
      align
    })
      .setOrigin(origin)
      .setDepth(depth)
      .setStroke(this._makeHex(stroke), strokeThickness)
      .setShadow(shadowOffsetX, shadowOffsetY, this._makeHex(shadowColor), shadowBlur, true, true);

    return t;
  }

  // faster shorthand for badges like score/timer
  makeBadgeText(x, y, label, value, opts = {}) {
    const left = this.makeFancyText(x - 120, y, label, { size: 36, color: '#FFD761', stroke: '#2b2b2b', ...opts });
    const right = this.makeFancyText(x + 120, y, value, { size: 42, color: '#FFFFFF', stroke: '#2b2b2b', ...opts });
    return { left, right, update: (v) => right.setText(v) };
  }


  // visual helpers
  animateSpawn(tile, label) {
    try {
      this.sys.tweens.add({
        targets: [tile, label],
        scale: { from: 0, to: 1.05 },
        duration: 260,
        ease: 'Back.easeOut',
        onComplete: () => {
          // small settle
          this.sys.tweens.add({ targets: [tile, label], scale: 1, duration: 80 });
        }
      });

      this.sys.tweens.add({ targets: [tile, label], alpha: { from: 0, to: 1 }, duration: 220 });
    } catch (e) {
      // ignore if things break on exotic platforms
    }
  }

  popTile(tile, label) {
    try {
      this.sys.tweens.add({
        targets: [tile, label],
        scale: { from: 1, to: 1.08 },
        duration: 90,
        yoyo: true,
        ease: 'Sine.easeInOut'
      });
    } catch (e) { }
  }

  burstEffect(x, y, count = 6) {
    // simple starburst made from small circles - no external particle textures needed
    const color = this._toIntColor('#fff4d6');
    for (let i = 0; i < count; i++) {
      const r = Phaser.Math.Between(3, 8);
      const c = this.add.circle(x, y, r, color, 1).setDepth(30);
      const tx = x + Phaser.Math.Between(-40, 40);
      const ty = y + Phaser.Math.Between(-40, 40);
      this.sys.tweens.add({
        targets: c,
        x: tx,
        y: ty,
        alpha: 0,
        scale: 0.4,
        duration: 340 + Phaser.Math.Between(0, 160),
        ease: 'Cubic.easeOut',
        onComplete: () => c.destroy()
      });
    }
  }

  showScoreGainAtGrid(x, y, offsetX, offsetY, amount) {
    const tileX = offsetX + this.gap + x * (this.tileSize + this.gap) + this.tileSize / 2;
    const tileY = offsetY + this.gap + y * (this.tileSize + this.gap) + this.tileSize / 2;

    const plus = this.makeFancyText(tileX, tileY - this.tileSize / 2, `+${amount}`, {
      size: 30, color: '#FFD761', stroke: '#2b2b2b', strokeThickness: 4, origin: 0.5, depth: 50
    });

    // destination (score badge right text)
    const destX = this.scoreBadge.right.x;
    const destY = this.scoreBadge.right.y;

    this.sys.tweens.add({
      targets: plus,
      x: destX,
      y: destY,
      alpha: 0,
      scale: 0.6,
      duration: 700,
      ease: 'Cubic.easeIn',
      onComplete: () => plus.destroy()
    });
  }

  gameOver() {
    // --- at the start of gameOver() ---
    if (this.backgroundMusic) {
      this.backgroundMusic.stop();
      this.backgroundMusic.destroy();
      this.backgroundMusic = null;
    }

    if (this.timerEvent) this.timerEvent.remove(false);
    this.gameStarted = false;

    // camera shake for dramatic effect
    this.cameras.main.shake(220, 0.015);

    this.clearBoard();
    const centerX = this.sys.game.config.width / 2;
    const centerY = this.sys.game.config.height / 2;
    const group = this.add.group();

    const overBox = this.add.image(centerX, centerY, 'ovrbox').setOrigin(0.5);
    const text = this.makeFancyText(centerX, centerY + 50, 'Try Again!', {
      size: 56, color: '#FFFFFF', stroke: '#2b2b2b', strokeThickness: 8, shadowBlur: 10
    });

    const replayBtn = this.add.image(centerX, centerY + 400, 'replay').setOrigin(0.5).setInteractive({ useHandCursor: true });

    group.addMultiple([overBox, text, replayBtn]);

    replayBtn.once('pointerup', () => {
      group.clear(true, true);
      this.scene.restart();
    });
  }
  notifyParent(type, data) {
    if (window.parent !== window) {
      window.parent.postMessage({ type, ...data }, "*");
    }
  }
  getTimeLimitFromConfig(game = {}) {
    if (Number.isFinite(game.timeLimitSeconds)) return Math.max(0, game.timeLimitSeconds | 0);
    if (Number.isFinite(game.timeLimitMinutes)) return Math.max(0, (game.timeLimitMinutes * 60) | 0);
    if (Number.isFinite(game.timeLimit)) return Math.max(0, game.timeLimit | 0);
    return 600; // default 10:00
  }

  _toIntColor(c) {
    if (typeof c === 'number') return c;
    if (typeof c === 'string') {
      // Accept "#rrggbb" or "0xrrggbb"
      if (c.startsWith('0x')) return parseInt(c, 16);
      return Phaser.Display.Color.HexStringToColor(c).color;
    }
    return 0xffffff;
  }

  // Draws the full board panel + all empty cells as rounded rects in one Graphics
  drawGridBackground(offsetX, offsetY, gridPixelSize) {
    const g = this.add.graphics().setDepth(0);

    // Soft drop shadow
    g.fillStyle(this._toIntColor('#000000'), this.theme.shadowAlpha ?? 0.18);
    g.fillRoundedRect(offsetX - 10, offsetY - 10, gridPixelSize + 20, gridPixelSize + 20, 32);

    // Main board
    g.fillStyle(this._toIntColor(this.theme.boardColor), 1);
    g.fillRoundedRect(offsetX, offsetY, gridPixelSize, gridPixelSize, 28);

    // Optional subtle inner stroke for a premium look
    g.lineStyle(2, this._toIntColor(Phaser.Display.Color.IntegerToColor(this._toIntColor(this.theme.boardColor)).darken(10).color), 0.6);
    g.strokeRoundedRect(offsetX + 1, offsetY + 1, gridPixelSize - 2, gridPixelSize - 2, 26);

    // Empty cells
    const cellColor = this._toIntColor(this.theme.cellColor);
    g.fillStyle(cellColor, 1);

    for (let y = 0; y < this.gridSize; y++) {
      for (let x = 0; x < this.gridSize; x++) {
        const cellX = offsetX + this.gap + x * (this.tileSize + this.gap);
        const cellY = offsetY + this.gap + y * (this.tileSize + this.gap);
        g.fillRoundedRect(cellX, cellY, this.tileSize, this.tileSize, 16);
      }
    }
  }


  win() {
    // --- at the start of win() ---
    if (this.backgroundMusic) {
      this.backgroundMusic.stop();
      this.backgroundMusic.destroy();
      this.backgroundMusic = null;
    }

    if (this.timerEvent) this.timerEvent.remove(false);
    this.gameStarted = false;

    // celebratory camera effect
    this.cameras.main.flash(300, 200, 255, 200);

    this.clearBoard();
    const centerX = this.sys.game.config.width / 2;
    const centerY = this.sys.game.config.height / 2;
    const group = this.add.group();

    const lvlBox = this.add.image(centerX, centerY, 'lvlbox').setOrigin(0.5);
    const nextBtn = this.add.image(centerX - 240, centerY + 350, 'next').setOrigin(0.5).setInteractive({ useHandCursor: true });
    const text = this.makeFancyText(centerX, centerY + 50, 'You Win!', {
      size: 56, color: '#7CFF7A', stroke: '#204420', strokeThickness: 8, shadowColor: '#0e1a0e', shadowBlur: 10
    });

    const replayBtn = this.add.image(centerX + 240, centerY + 350, 'lvl_replay').setOrigin(0.5).setInteractive({ useHandCursor: true });
    group.addMultiple([lvlBox, text, nextBtn, replayBtn]);

    nextBtn.once('pointerup', () => {
      this.notifyParent('sceneComplete', { result: 'win' });
    });
    replayBtn.once('pointerup', () => {
      group.clear(true, true);
      this.scene.restart();
    });
  }

  clearBoard() {
    // Destroy all tiles tracked in the 2D array
    for (let y = 0; y < this.tiles.length; y++) {
      for (let x = 0; x < (this.tiles[y] ? this.tiles[y].length : 0); x++) {
        if (this.tiles[y][x]) {
          this.tiles[y][x].tile?.destroy();
          this.tiles[y][x].label?.destroy();
          this.tiles[y][x] = null;
        }
      }
    }

    // Safety: if any label slipped out of the tiles[][] tracking, nuke by tag
    this.children.list
      .filter(o => o?.data?.get?.('isTileLabel'))
      .forEach(o => o.destroy());

    // Reset grid state
    for (let y = 0; y < this.grid.length; y++) {
      for (let x = 0; x < (this.grid[y] ? this.grid[y].length : 0); x++) {
        this.grid[y][x] = 0;
      }
    }
  }

}
