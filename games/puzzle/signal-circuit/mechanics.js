export default class MechanicsScene extends Phaser.Scene {
  constructor() {
    super("MechanicsScene");
    Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach((fn) => {
      if (typeof this[fn] === "function") this[fn] = this[fn].bind(this);
    });

    // These will be set from config:
    this.TILE_SIZE = 170;
    this.GRID_ROWS = 5;
    this.GRID_COLS = 5;
    this.timerDuration = 60;
    this.timeLeft = 60;

    // Game state
    this.grid = [];
    this.startTile = { row: 0, col: 0 };
    this.endTile = { row: 5, col: 5 };
    this.connectionMap = null;
    this.winText = null;
    this.timerText = null;
    this.gameOverActive = false;
    this.bgm = null;

    this.tileTypes = ['straight', 'corner', 't'];
  }
  notifyParent(type, data) {
    if (window.parent !== window) {
      window.parent.postMessage({ type, ...data }, "*");
    }
  }

  init(data) {
    // existing resets ...
    this.isGameOver = false;
    this.gameOverActive = false;
    this.instructionVisible = false;

    if (this.timerEvent) { this.timerEvent.remove(); this.timerEvent = null; }
    if (this.connectionMap) this.connectionMap.clear();

    if (this.bgm && this.bgm.isPlaying) this.bgm.stop();
    this.bgm = null;

    this.grid = [];
    this.startTile = { row: 0, col: 0 };
    this.endTile = { row: 0, col: 0 };

    // NEW: remember if we should auto-start (used after Replay)
    this._autoStart = !!(data && data.autoStart);
  }



  preload() {
    const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));
    this.load.json('levelConfig', `${basePath}/config.json`);

    this.load.once('filecomplete-json-levelConfig', () => {
      const cfg = this.cache.json.get('levelConfig');
      const spritesheets = cfg.spritesheets || {};
      const eveData = spritesheets.eve || {};
      const rawMain = new URLSearchParams(window.location.search).get('main') || '';
      const cleanMain = rawMain.replace(/^"|"$/g, '');
      const sheetUrl =
        cleanMain ||
        eveData.url ||
        `${basePath}/${eveData.path}`;

      if (spritesheets.eve) {
        this.load.spritesheet('eve', sheetUrl, {
          frameWidth: eveData.frameWidth || 102,
          frameHeight: eveData.frameHeight || 158,
        }).on('error', () => console.error('Failed to load Eve spritesheet'));
      }

      if (cfg.images2) {
        Object.entries(cfg.images2).forEach(([key, url]) => {
          this.load.image(key, `${basePath}/${url}`).on('error', () => {
            console.error(`Failed to load image: ${key}`);
          });
        });
      }

      if (cfg.ui) {
        Object.entries(cfg.ui).forEach(([key, url]) => {
          this.load.image(key, `${basePath}/${url}`).on('error', () => {
            console.error(`Failed to load image: ${key}`);
          });
        });
      }
      if (cfg.audio) {
        for (const [key, url] of Object.entries(cfg.audio)) {
          const audioUrl =
            /^https?:\/\//i.test(url) || url.startsWith('//')
              ? url                  // full URL -> use as-is
              : `${basePath}/${url}`; // relative -> prefix with basePath

          this.load.audio(key, audioUrl).on('error', () => {
            console.error(`Failed to load audio: ${key} from ${audioUrl}`);
          });
        }
      }

      this.load.once('complete', () => { this.assetsLoaded = true; });
      this.load.start();
    });
  }

  create() {
    this.input.removeAllListeners();

    const cfg = this.cache.json.get('levelConfig');
    const mechanics = cfg.mechanics || {};

    this.cfg = cfg;
    this.strings = (cfg && cfg.text) || {};


    this.width = cfg.orientation?.width || 1080;
    this.height = cfg.orientation?.height || 1920;

    this.TILE_SIZE = mechanics.tileSize ?? 170;
    this.GRID_ROWS = mechanics.gridRows ?? 5;
    this.GRID_COLS = mechanics.gridCols ?? 5;
    this.timerDuration = mechanics.timer ?? 60;
    this.timeLeft = this.timerDuration;

    // BGM guard
    // BGM guard – only if actually loaded
    if (this.bgm && this.bgm.isPlaying) this.bgm.stop();

    if (this.cache.audio.exists('bgm')) {
      this.bgm = this.sound.add('bgm', { loop: true, volume: 0.3 });
      this.bgm.play();
    } else {
      console.warn('BGM "bgm" missing from cache, cannot play.');
    }

    // sfxConnect guard – also check cache
    if (!this.sfxConnect && this.cache.audio.exists('collection')) {
      this.sfxConnect = this.sound.add('collection', { volume: 1 });
    }


    // Background only
    this.add.image(this.width / 2, this.height / 2, 'background').setOrigin(0.5);

    // Connection layer (empty now)
    this.connectionMap = this.add.graphics();

    // Timer UI (hidden until game starts)
    this.timerText = this.add.text(
      this.width / 2, 60,
      `${this.t('timer_label', 'Time')}: ${this.timeLeft}`,
      { fontFamily: 'outfit', fontSize: '50px', color: '#070707ff', align: 'center' }
    ).setOrigin(0.5).setDepth(10).setVisible(false);

    // IMPORTANT: Do NOT build grid or bind tile input here.

    // Show instructions overlay
    this.showInstructions();

    // If we came from Replay → start immediately (skip overlay)
    if (this._autoStart) this.startGame();
  }


  update() { }

  createUI() {

    this.textBox = this.add.image(540, 60, 'scorebar')
      .setScrollFactor(0)
      .setDepth(9)
      .setScale(1)
      .setOrigin(0.5);
  }

  buildGrid() {
    const offsetX = (this.width - this.GRID_COLS * this.TILE_SIZE) / 2;
    const offsetY = 450;

    for (let row = 0; row < this.GRID_ROWS; row++) {
      this.grid[row] = [];
      for (let col = 0; col < this.GRID_COLS; col++) {
        const x = offsetX + col * this.TILE_SIZE + this.TILE_SIZE / 2;
        const y = offsetY + row * this.TILE_SIZE + this.TILE_SIZE / 2;

        const type = Phaser.Utils.Array.GetRandom(this.tileTypes);
        const rotation = Phaser.Math.Between(0, 3);

        const tile = this.add.image(x, y, 'platform')
          .setDisplaySize(this.TILE_SIZE - 15, this.TILE_SIZE - 15)
          .setInteractive();

        tile.tileType = type;
        tile.rotationState = rotation;
        tile.row = row;
        tile.col = col;
        tile.connections = this.getConnections(type, rotation);
        this.grid[row][col] = tile;

        this.drawTileLines(tile);
        // Start/end icons
        if (row === 0 && col === 0) {
          const startIcon = this.add.text(x - 30, y - 120, this.t('label_start', 'START'), {
            fontFamily: 'outfit', fontSize: '42px', color: '#ffffff', fontStyle: 'bold'
          }).setOrigin(0.5).setDepth(2);
        }
        if (row === this.GRID_ROWS - 1 && col === this.GRID_COLS - 1) {
          const endIcon = this.add.text(x + 50, y + 120, this.t('label_end', 'END'), {
            fontFamily: 'outfit', fontSize: '42px', color: '#ffffff', fontStyle: 'bold'
          }).setOrigin(0.5).setDepth(2);
        }
      }
    }
    this.grid[0][0].setTint(0x00ff00);
    this.grid[this.GRID_ROWS - 1][this.GRID_COLS - 1].setTint(0xffff00);
    this.startTile = { row: 0, col: 0 };
    this.endTile = { row: this.GRID_ROWS - 1, col: this.GRID_COLS - 1 };
  }

  drawTileLines(tile) {
    const g = this.add.graphics();
    g.lineStyle(8, 0xffffff);
    g.setDepth(1);

    const cx = tile.x;
    const cy = tile.y;
    const len = this.TILE_SIZE / 2 - 10;

    tile.lines = [];
    tile.connections.forEach(dir => {
      let x = 0, y = 0;
      if (dir === 'up') y = -len;
      if (dir === 'down') y = len;
      if (dir === 'left') x = -len;
      if (dir === 'right') x = len;
      g.lineBetween(cx, cy, cx + x, cy + y);
      tile.lines.push({ x: cx + x, y: cy + y, dir });
    });

    tile.graphics = g;
  }

  rotateTileAt(x, y) {
    for (let row = 0; row < this.GRID_ROWS; row++) {
      for (let col = 0; col < this.GRID_COLS; col++) {
        const tile = this.grid[row][col];
        if (tile.getBounds().contains(x, y)) {
          // keep previous connections to detect NEW links
          const prevConnections = tile.connections ? tile.connections.slice() : [];

          // rotate + recompute
          tile.rotationState = (tile.rotationState + 1) % 4;
          tile.connections = this.getConnections(tile.tileType, tile.rotationState);

          // redraw
          if (tile.graphics) tile.graphics.destroy();
          this.drawTileLines(tile);

          // if this rotation created ANY new valid link to a neighbor, play sfx
          if (this._createdNewLink(tile, prevConnections)) {
            if (this.sfxConnect) this.sfxConnect.play();
          }

          return;
        }
      }
    }
  }


  getConnections(type, rot) {
    const base = {
      straight: [['up', 'down'], ['left', 'right']],
      corner: [['up', 'right'], ['right', 'down'], ['down', 'left'], ['left', 'up']],
      t: [['left', 'up', 'right'], ['up', 'right', 'down'], ['right', 'down', 'left'], ['down', 'left', 'up']]
    };

    return base[type][rot % base[type].length];
  }

  _createdNewLink(tile, prevConnections) {
    // returns true if tile now connects to any neighbor via a direction
    // that it did NOT have before the rotation
    const dirs = tile.connections || [];
    for (const dir of dirs) {
      const [dx, dy] = this.directionDelta(dir);
      const nr = tile.row + dy;
      const nc = tile.col + dx;
      if (nr < 0 || nr >= this.GRID_ROWS || nc < 0 || nc >= this.GRID_COLS) continue;

      const neighbor = this.grid[nr][nc];
      if (!neighbor) continue;
      const opp = this.oppositeDirection(dir);

      // valid link now?
      const linkNow = neighbor.connections && neighbor.connections.includes(opp);

      // did we already have this link before rotation?
      const hadBefore = prevConnections && prevConnections.includes(dir) && linkNow;

      if (linkNow && !hadBefore) {
        // new link formed by this rotation
        return true;
      }
    }
    return false;
  }


  drawConnections() {
    this.connectionMap.clear();
    this.connectionMap.lineStyle(4, 0x00ff00);
    const visited = {};
    this.dfs(this.startTile.row, this.startTile.col, visited);
  }

  dfs(row, col, visited) {
    const key = `${row},${col}`;
    if (visited[key]) return;
    visited[key] = true;

    const tile = this.grid[row][col];
    tile.connections.forEach(dir => {
      const [dx, dy] = this.directionDelta(dir);
      const nr = row + dy;
      const nc = col + dx;
      if (nr < 0 || nr >= this.GRID_ROWS || nc < 0 || nc >= this.GRID_COLS) return;

      const neighbor = this.grid[nr][nc];
      const opp = this.oppositeDirection(dir);
      if (neighbor.connections.includes(opp)) {
        this.connectionMap.strokeLineShape(new Phaser.Geom.Line(
          tile.x, tile.y,
          neighbor.x, neighbor.y
        ));
        this.dfs(nr, nc, visited);
      }
    });
  }

  checkWin() {
    const visited = {};
    this.dfs(this.startTile.row, this.startTile.col, visited);
    const key = `${this.endTile.row},${this.endTile.col}`;
    if (visited[key]) {
      // this.sound.add('collection', { volume: 2 }).play();

      // this.winText.setText('Circuit Complete!');
      this.gameOverActive = true;
      this.winGame();
      // if (this.timerEvent) this.timerEvent.remove();
      // this.input.once('pointerdown', () => this.scene.restart());
    } else {
      this.winText.setText('');
    }
  }

  directionDelta(dir) {
    if (dir === 'up') return [0, -1];
    if (dir === 'down') return [0, 1];
    if (dir === 'left') return [-1, 0];
    if (dir === 'right') return [1, 0];
  }

  oppositeDirection(dir) {
    return { up: 'down', down: 'up', left: 'right', right: 'left' }[dir];
  }





  startGame() {
    this.instructionVisible = false;
    if (this.htpOverlay) this.htpOverlay.destroy();

    // Show HUD now
    this.createUI();                 // scorebar etc.
    this.setHUDVisible(true); // show timer

    // Build gameplay now
    this.buildGrid();
    this.input.on('pointerdown', (pointer) => {
      if (this.gameOverActive) return;
      this.rotateTileAt(pointer.worldX, pointer.worldY);
      this.drawConnections();
      this.checkWin();
    });

    this.drawConnections();

    // Start timer
    this.timerEvent = this.time.addEvent({
      delay: 1000,
      repeat: this.timerDuration - 1,
      callback: () => {
        if (this.gameOverActive) return;
        this.timeLeft--;
        this.timerText.setText(`${this.t('timer_label', 'Time')}: ${this.timeLeft}`);
        if (this.timeLeft <= 0) this.gameOver();
      }
    });
  }


  showInstructions() {
    this.instructionVisible = true;

    this.htpOverlay = this.add.container(0, 0).setDepth(10); // full overlay container

    this.blur = this.add
      .rectangle(0, 0, 1080, 1920, 0x000000, 0.5)
      .setOrigin(0);
    this.howToPlayBox = this.add.image(540, 820, "htp").setScale(0.55, 0.8);

    this.descriptionText = this.add
      .text(
        540,
        800,
        this.t('htp_description', "Complete the circuit from start to end, before time’s up!"),
        {
          font: "60px Outfit",
          color: "#ffffff",
          wordWrap: { width: 800, useAdvancedWrap: true },
        }
      )
      .setOrigin(0.5);

    this.targetLabel = this.add
      .text(240, 1200, "", {
        font: "60px Outfit",
        color: "#ffffff",
      })
      .setOrigin(0.5);

    this.targetScoreText = this.add
      .text(850, 1200, ``, {
        font: "60px Outfit",
        color: "#ffffff",
      })
      .setOrigin(0.5);

    this.playButton = this.add.image(540, 1350, "play_game").setInteractive();
    this.playButton.on("pointerdown", () => {
      this.startGame();
    });
    this.htpOverlay.add([
      this.blur,
      this.howToPlayBox,
      this.descriptionText,
      this.targetLabel,
      this.targetScoreText,
      this.playButton,
    ]);
  }
  gameOver() {
    this.isGameOver = true;
    if (this.timerEvent) this.timerEvent.remove();

    this.setHUDVisible(false);

    // ❌ removed this.bgm?.stop();

    const bg = this.add.image(this.width / 2, this.height / 2, "ovrbg")
      .setDepth(9).setScrollFactor(0);
    bg.setDisplaySize(this.width, this.height);

    const blur = this.add.rectangle(0, 0, this.width, this.height, 0x000000, 0.35)
      .setOrigin(0).setDepth(9.5).setScrollFactor(0);

    const gameOverBox = this.add.image(540, 820, "game_over").setScale(0.55, 0.8).setDepth(10);

    const yourScore1 = this.add.text(540, 580, this.t('gameover_title', 'Game Over'),
      { font: "70px Outfit", color: "#FFFFFF" }).setOrigin(0.5).setDepth(11);

    const yourScore = this.add.text(250, 880, this.t('gameover_time_left', 'Time Left'),
      { font: "60px Outfit", color: "#FFFFFF" }).setOrigin(0.5).setDepth(11);

    const yourUserScore = this.add.text(870, 880, `${this.timeLeft}`,
      { font: "60px Outfit", color: "#FFFFFF" }).setOrigin(0.5).setDepth(11);

    const restartButton = this.add.image(540, 1260, "replay_level")
      .setInteractive().setDepth(10);

    restartButton.on("pointerdown", () => {
      // cleanup
      bg.destroy(); blur.destroy(); gameOverBox.destroy();
      yourScore1.destroy();
      yourScore.destroy(); yourUserScore.destroy(); restartButton.destroy();

      this.isGameOver = false;
      this.gameOverActive = false;
      if (this.timerEvent) { this.timerEvent.remove(); this.timerEvent = null; }

      // ✅ stop BGM only on replay before restart
      if (this.bgm && this.bgm.isPlaying) this.bgm.stop();

      this.scene.restart();
    });
  }



  // Helper: deep get with fallback
  // Helper: flat get with fallback
  t(key, fallback = "") {
    if (!this.strings || typeof this.strings !== "object") return fallback;

    const value = this.strings[key];
    return (typeof value === "string") ? value : fallback;
  }




  winGame() {
    this.isGameOver = true;
    if (this.timerEvent) this.timerEvent.remove();

    this.setHUDVisible(false);



    const bg = this.add.image(this.width / 2, this.height / 2, "winbg")
      .setDepth(9).setScrollFactor(0);
    bg.setDisplaySize(this.width, this.height);

    const blur = this.add.rectangle(0, 0, this.width, this.height, 0x000000, 0.25)
      .setOrigin(0).setDepth(9.5).setScrollFactor(0);

    const gameOverBox = this.add.image(540, 820, "level_complete").setScale(0.55, 0.8).setDepth(10);
    const buttonY = 1170, buttonSpacing = 240;
    const yourScore1 = this.add.text(540, 580, this.t('win_title', 'Level Completed'),
      { font: "70px Outfit", color: "#FFFFFF" }).setOrigin(0.5).setDepth(11);

    const yourScore = this.add.text(290, 880, this.t('win_time_taken', 'Time Taken'),
      { font: "60px Outfit", color: "#FFFFFF" }).setOrigin(0.5).setDepth(11);

    const yourUserScore = this.add.text(870, 880, `${this.timerDuration - this.timeLeft}`,
      { font: "60px Outfit", color: "#FFFFFF" }).setOrigin(0.5).setDepth(11);

    const replayButton = this.add.image(540 - buttonSpacing, buttonY + 100, "replay")
      .setInteractive().setDepth(10);

    const nextButton = this.add.image(540 + buttonSpacing, buttonY + 100, "next")
      .setInteractive().setDepth(10);

    const cleanup = () => {
      bg.destroy(); blur.destroy(); gameOverBox.destroy();
      yourScore1.destroy();
      yourScore.destroy(); yourUserScore.destroy();
      replayButton.destroy(); nextButton.destroy();
    };

    replayButton.on("pointerdown", () => {
      cleanup();

      this.isGameOver = false;
      this.gameOverActive = false;
      if (this.timerEvent) { this.timerEvent.remove(); this.timerEvent = null; }

      // ✅ stop BGM only on replay before restart
      if (this.bgm && this.bgm.isPlaying) this.bgm.stop();

      this.scene.restart();
    });

    nextButton.on("pointerdown", () => {
      cleanup();
      // 🚫 do not stop BGM on next; let parent handle it if needed
      this.notifyParent("sceneComplete", { result: "win" });
    });
  }

  setHUDVisible(visible) {
    if (this.textBox) this.textBox.setVisible(visible);
    if (this.timerText) this.timerText.setVisible(visible);
  }



}
