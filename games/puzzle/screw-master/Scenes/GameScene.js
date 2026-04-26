/* -----------------------------
   GAME CONSTANTS
------------------------------ */
const GAME_WIDTH = 1080;
const GAME_HEIGHT = 1920;

/* -----------------------------
   MAIN GAME SCENE
------------------------------ */
class GameScene extends Phaser.Scene {
  constructor() {
    super("GameScene");

    // config-driven mechanics
    this.cfg = null;
    this.rows = 4;
    this.cols = 4;
    this.totalTime = 60;
    this.pointsPerTap = 1;

    // game state
    this.tiles = [];
    this.rowData = [];
    this.score = 0;
    this.elapsed = 0;
    this.gameOver = false;
  }

  /* -----------------------------
        LOAD CONFIG.JSON
  ------------------------------ */
  preload() {
    // loads config.json from same folder as index.html
    this.load.json("gameConfig", "config.json");
  }

  /* -----------------------------
        APPLY CONFIG
  ------------------------------ */
  applyConfig() {
    const json = this.cache.json.get("gameConfig") || {};

    this.cfg = json;

    const mechanics = json.mechanics || {};

    this.rows = mechanics.rows ?? 4;
    this.cols = mechanics.cols ?? 4;
    this.totalTime = mechanics.totalTime ?? 60;
    this.pointsPerTap = mechanics.pointsPerTap ?? 1;
  }

  create() {
    // read config first
    this.applyConfig();

    // RESET ON RESTART
    this.tiles = [];
    this.rowData = [];
    this.score = 0;
    this.elapsed = 0;
    this.gameOver = false;

    this.cameras.main.setBackgroundColor("#FFFFFF");

    this.createUI();
    this.createGrid();
    this.startTimer();
  }

  /* -----------------------------
       UI – Timer + Score
  ------------------------------ */
  createUI() {
    this.timerBg = this.add.rectangle(
      GAME_WIDTH / 2,
      40,
      GAME_WIDTH * 0.9,
      30,
      0x222222
    );

    this.timerBar = this.add
      .rectangle(
        this.timerBg.x - this.timerBg.width / 2,
        40,
        0,
        24,
        0x00acee
      )
      .setOrigin(0, 0.5);

    this.scoreText = this.add
      .text(GAME_WIDTH / 2, 110, "Score: 0", {
        fontSize: "80px",
        fontFamily: "Arial",
        color: "#ff6347"
      })
      .setOrigin(0.5);
  }

  /* -----------------------------
       GRID OF tiles (config)
  ------------------------------ */
  createGrid() {
    const top = 200;
    const tileHeight = (GAME_HEIGHT - top) / this.rows;
    const tileWidth = GAME_WIDTH / this.cols;

    for (let r = 0; r < this.rows; r++) {
      this.tiles[r] = [];
      this.rowData[r] = {};
    }

    for (let r = 0; r < this.rows; r++) {
      this.createRow(r, tileWidth, tileHeight, top);
    }
  }

  createRow(r, tileW, tileH, top) {
    const COLS = this.cols;

    let prev = r > 0 ? this.rowData[r - 1].black : -1;

    let black = Phaser.Math.Between(0, COLS - 1);
    if (black === prev) black = (black + 1) % COLS;

    this.rowData[r].black = black;

    for (let c = 0; c < COLS; c++) {
      const x = tileW * c + tileW / 2;
      const y = GAME_HEIGHT - (r + 1) * tileH + tileH / 2;

      const color = c === black ? 0x000000 : 0xf7f7f7;

      if (!this.tiles[r][c]) {
        const tile = this.add
          .rectangle(x, y, tileW - 8, tileH - 8, color)
          .setStrokeStyle(4, 0x505050)
          .setInteractive();

        tile.row = r;
        tile.col = c;

        tile.on("pointerdown", () => this.handleClick(tile));

        this.tiles[r][c] = tile;
      } else {
        const tile = this.tiles[r][c];
        tile.setFillStyle(color);
        tile.x = x;
        tile.y = y;
      }
    }
  }

  /* -----------------------------
         TILE CLICK HANDLER
  ------------------------------ */
  handleClick(tile) {
    if (this.gameOver) return;
    if (tile.row !== 0) return;

    const black = this.rowData[0].black;

    if (tile.col === black) {
      // score from config.json
      this.score += this.pointsPerTap;
      this.scoreText.setText("Score: " + this.score);

      this.tweens.add({
        targets: tile,
        scaleX: 0.85,
        scaleY: 0.85,
        yoyo: true,
        duration: 120
      });

      this.shiftRows();
    } else {
      this.endGame();
    }
  }

  /* -----------------------------
         SHIFT ALL ROWS DOWN
  ------------------------------ */
  shiftRows() {
    const ROWS = this.rows;
    const COLS = this.cols;

    for (let r = 0; r < ROWS - 1; r++) {
      this.rowData[r].black = this.rowData[r + 1].black;
    }

    const top = 200;
    const tileH = (GAME_HEIGHT - top) / ROWS;
    const tileW = GAME_WIDTH / COLS;

    this.createRow(ROWS - 1, tileW, tileH, top);

    for (let r = 0; r < ROWS; r++) {
      const black = this.rowData[r].black;
      for (let c = 0; c < COLS; c++) {
        const tile = this.tiles[r][c];
        tile.setFillStyle(c === black ? 0x000000 : 0xf7f7f7);
        tile.row = r;
      }
    }
  }

  /* -----------------------------
           TIMER LOGIC
  ------------------------------ */
  startTimer() {
    this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        if (this.gameOver) return;

        this.elapsed++;

        const ratio = Phaser.Math.Clamp(
          this.elapsed / this.totalTime,
          0,
          1
        );
        this.timerBar.width = this.timerBg.width * ratio;

        if (this.elapsed >= this.totalTime) {
          this.endGame();
        }
      }
    });
  }

  /* -----------------------------
        GAME OVER SCREEN
  ------------------------------ */
  endGame() {
    this.gameOver = true;

    const overlay = this.add.rectangle(
      GAME_WIDTH / 2,
      GAME_HEIGHT / 2,
      GAME_WIDTH,
      GAME_HEIGHT,
      0xff6347,
      1
    );
    overlay.setInteractive();

    const tps = (this.score / Math.max(this.elapsed, 1)).toFixed(3);

    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 200, "GAME OVER", {
        fontSize: "140px",
        color: "#ffffff"
      })
      .setOrigin(0.5);

    this.add
      .text(
        GAME_WIDTH / 2,
        GAME_HEIGHT / 2,
        `Score: ${tps} tiles/sec`,
        {
          fontSize: "70px",
          color: "#ffffff"
        }
      )
      .setOrigin(0.5);

    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 200, "Tap to Restart", {
        fontSize: "70px",
        color: "#ffffff"
      })
      .setOrigin(0.5);

    overlay.on("pointerdown", () => {
      this.scene.restart();
    });
  }
}

/* -----------------------------
        PHASER CONFIG
------------------------------ */
// const config = {
//   type: Phaser.AUTO,
//   width: GAME_WIDTH,
//   height: GAME_HEIGHT,
//   backgroundColor: "#000000",
//   scene: [TileGame],
//   scale: {
//     mode: Phaser.Scale.FIT,
//     autoCenter: Phaser.Scale.CENTER_BOTH,
//     orientation: Phaser.Scale.PORTRAIT
//   }
// };

// new Phaser.Game(config);
