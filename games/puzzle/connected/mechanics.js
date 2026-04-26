const DEFAULT_ROWS = 6;
const DEFAULT_COLS = 6;
const DEFAULT_TARGET_SCORE = 20;   // 🎯 default score needed to WIN
const DEFAULT_TIME_LIMIT = 30;     // ⏱️ default seconds to reach the target
const DEFAULT_DOT_SCALE_RATIO = 0.6;
const DEFAULT_PROGRESS_SEGMENTS = 12;

export default class GamePlayScene extends Phaser.Scene {
  constructor() {
    super("GamePlayScene");

    // general
    this.mode = "start"; // "start" | "play" | "end"
    this.w = 400;
    this.h = 500;

    // layout / mechanics
    this.rows = DEFAULT_ROWS;
    this.cols = DEFAULT_COLS;
    this.tileSize = 60;
    this.offsetX = 0;
    this.offsetY = 0;

    this.targetScore = DEFAULT_TARGET_SCORE;
    this.timeLimit = DEFAULT_TIME_LIMIT;
    this.dotScaleRatio = DEFAULT_DOT_SCALE_RATIO;
    this.progressSegments = DEFAULT_PROGRESS_SEGMENTS;

    // sound
    this.isSoundOn = true;

    // gameplay
    this.grid = [];
    this.dotsGroup = null;
    this.score = 0;
    this.bestScore = 0;
    this.moves = 0;
    this.count = 0;
    this.currentType = -1; // 1..4: which dot color is selected
    this.lastRow = -1;
    this.lastCol = -1;
    this.clicked = false;

    this.labelScore = null;
    this.labelTarget = null;
    this.labelMoves = null; // not shown now, but kept if you ever want it
    this.progressBar = null;
    this.progressBg = null;
    this.progressStep = 1;
    this.progressMaxWidth = 1;

    this.cellBackgrounds = null;

    // HUD backgrounds
    this.scoreBg = null;
    this.targetBg = null;
    this.timeBg = null;

    // game background
    this.bgImage = null;

    // timer
    this.timeLeft = this.timeLimit;
    this.timerText = null;
    this.timerEvent = null;

    // audio
    this.tap1_s = null;
    this.tap2_s = null;
    this.tap3_s = null;
    this.combo_s = null;
    this.bgm = null; // 🔊 background music

    // overlays
    this.startOverlay = null;
    this.winOverlay = null;
    this.gameOverlay = null;

    // end particles
    this.particles = null;

    // config
    this.configData = null;
    this.basePath = null;
  }

  // ----------------- Phaser lifecycle -----------------

  preload() {
    // base path for this module folder
    try {
      this.basePath = import.meta.url.substring(
        0,
        import.meta.url.lastIndexOf("/")
      );
    } catch (e) {
      // fallback: assume current folder
      this.basePath = ".";
    }

    // helper: resolve URL from config
    const resolvePath = (relPath) => {
      if (!relPath) return relPath;
      // Full URL: use as-is
      if (/^https?:\/\//i.test(relPath)) return relPath;
      // Root-relative: /assets/...
      if (relPath.startsWith("/")) return relPath;
      // Relative to this module folder
      return `${this.basePath}/${relPath}`;
    };

    // Load config.json first
    this.load.json("levelConfig", `${this.basePath}/config.json`);

    // When config is loaded, queue all other assets dynamically
    this.load.once("filecomplete-json-levelConfig", () => {
      this.configData = this.cache.json.get("levelConfig") || {};

      const images1 = this.configData.images1 || {};
      Object.entries(images1).forEach(([key, relPath]) => {
        this.load.image(key, resolvePath(relPath));
      });

      const images2 = this.configData.images2 || {};
      Object.entries(images2).forEach(([key, relPath]) => {
        this.load.image(key, resolvePath(relPath));
      });

      const ui = this.configData.ui || {};
      Object.entries(ui).forEach(([key, relPath]) => {
        this.load.image(key, resolvePath(relPath));
      });

      const audio = this.configData.audio || {};
      Object.entries(audio).forEach(([key, relPath]) => {
        this.load.audio(key, resolvePath(relPath));
      });

      // 🔥 VERY IMPORTANT: actually start loading the queued assets
      this.load.start();
    });
  }


  create() {
    const { width, height } = this.scale;
    this.w = width;
    this.h = height;

    // ❌ old white background removed
    // this.cameras.main.setBackgroundColor("#ecf0f1");

    // ---- read mechanics from config ----
    if (!this.configData) {
      this.configData = {};
    }

    const mech = this.configData.mechanics || {};
    this.rows = mech.rows || DEFAULT_ROWS;
    this.cols = mech.cols || DEFAULT_COLS;
    this.targetScore = mech.targetScore || DEFAULT_TARGET_SCORE;
    this.timeLimit = mech.timeLimit || DEFAULT_TIME_LIMIT;
    this.dotScaleRatio = mech.dotScaleRatio || DEFAULT_DOT_SCALE_RATIO;
    this.progressSegments =
      mech.progressSegments || DEFAULT_PROGRESS_SEGMENTS;

    this.timeLeft = this.timeLimit;

    // restore best score
    this.bestScore = 0;
    try {
      const tmp = parseInt(
        window.localStorage.getItem("7_best_score") || "0",
        10
      );
      if (!isNaN(tmp) && tmp > 0) this.bestScore = tmp;
    } catch (e) {
      // ignore
    }

    // audio SFX
    this.tap1_s = this.sound.add("tap1");
    this.tap2_s = this.sound.add("tap2");
    this.tap3_s = this.sound.add("tap3");
    this.combo_s = this.sound.add("combo");

    // 🔊 background music – created here but played on startGame()
    if (this.sound.get("bgm")) {
      // optional: stop any stray instance from a previous scene
      this.sound.get("bgm").stop();
    }
    this.bgm = this.sound.add("bgm", { loop: true, volume: 0.6 });

    // start with HOW-TO-PLAY overlay
    this.showStartOverlay();
  }

  update() {
    if (this.mode === "play") {
      this.updatePlay();
    }
    // start & end rely on button events only
  }

  // ----------------- Messaging to parent -----------------

  notifyParent(type, data) {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type, ...data }, "*");
    }
  }

  // ----------------- START OVERLAY -----------------

  showStartOverlay() {
    this.mode = "start";

    // 🔊 start BGM on start screen
    if (this.bgm && !this.bgm.isPlaying) {
      this.bgm.play();
    }

    // just in case if restarting
    if (this.startOverlay) {
      this.startOverlay.destroy(true);
      this.startOverlay = null;
    }

    const texts = this.configData.texts || {};
    const htpTitle = texts.htpTitle || "HOW TO PLAY";
    const htpBody =
      texts.htpBody ||
      `Connect same-colored dots\nby dragging to make chains.\n\nReach ${this.targetScore} points\nwithin ${this.timeLimit} seconds!`;

    const container = this.add.container(0, 0).setDepth(20);
    this.startOverlay = container;

    // background full-screen
    const bg = this.add.image(this.w / 2, this.h / 2, "htpbg");
    const bgScale = Math.max(this.w / bg.width, this.h / bg.height);
    bg.setScale(bgScale);

    // box in center
    const box = this.add.image(this.w / 2, this.h * 0.5, "htpbox");
    const boxScale = Math.min(
      (this.w * 0.9) / box.width,
      (this.h * 0.5) / box.height
    );
    box.setScale(boxScale);

    // "How to Play" text
    const title = this.add
      .text(this.w / 2, this.h * 0.32 + 200, htpTitle, {
        fontFamily: "outfit",
        fontSize: `${Math.round(this.h * 0.035)}px`,
        color: "#ffffff",
      })
      .setOrigin(0.5);

    // Body text (e.g. "Connect:")
    const info = this.add
      .text(this.w / 2, this.h * 0.42 + 150, htpBody, {
        fontFamily: "outfit",
        fontSize: `${Math.round(this.h * 0.026)}px`,
        color: "#ffffff",
        align: "center",
      })
      .setOrigin(0.5);

    // 👉 Dot legend row under the text: dot1, dot2, dot3, dot4
    const dotKeys = ["player1", "player2", "player3", "player4"];
    const dotsY = this.h * 0.48 + 200; // slightly below the "Connect:" text
    const dotTargetSize = this.h * 0.05; // 5% of screen height
    const spacing = dotTargetSize * 1.6; // horizontal spacing

    const dots = dotKeys.map((key, index) => {
      const x =
        this.w / 2 + (index - (dotKeys.length - 1) / 2) * spacing; // centered row

      const sprite = this.add.image(x, dotsY - 40, key);

      // scale dots nicely
      const scale = dotTargetSize / sprite.width;
      sprite.setScale(scale);

      return sprite;
    });

    // play button
    const playBtn = this.add
      .image(this.w / 2, this.h * 0.78 - 200, "playbtn")
      .setInteractive({ useHandCursor: true });

    playBtn.on("pointerdown", () => {
      if (this.tap1_s) this.tap1_s.play({ volume: 0.6 });
      container.destroy(true);
      this.startGame();
    });

    container.add([bg, box, title, info, ...dots, playBtn]);
  }


  // ----------------- GAMEPLAY SETUP -----------------

  startGame() {
    this.mode = "play";


    // --- layout for 1080x1920 ---
    // grid width uses 90% of screen width
    this.tileSize = (this.w * 0.9) / this.cols;
    const gridWidth = this.cols * this.tileSize;

    // center horizontally, place roughly in upper-middle vertically
    this.offsetX = (this.w - gridWidth) / 2 + this.tileSize / 2;
    this.offsetY = this.h * 0.22; // ~22% from top

    // 🎨 gameplay background image (bg.png)
    if (this.bgImage) {
      this.bgImage.destroy();
      this.bgImage = null;
    }
    this.bgImage = this.add.image(this.w / 2, this.h / 2, "bg");
    const bgScale = Math.max(this.w / this.bgImage.width, this.h / this.bgImage.height);
    this.bgImage.setScale(bgScale).setDepth(0); // created first, stays at back

    this.createGridBackground();

    this.dotsGroup = this.add.group();
    this.grid = new Array(this.rows)
      .fill(null)
      .map(() => new Array(this.cols).fill(null));

    this.score = 0;
    this.moves = 0;
    this.count = 0;
    this.currentType = -1;
    this.lastRow = -1;
    this.lastCol = -1;
    this.clicked = false;

    // reset timer
    this.timeLeft = this.timeLimit;
    if (this.timerEvent) {
      this.timerEvent.remove(false);
      this.timerEvent = null;
    }

    // ✅ HUD row for Score, Target, Time with scoreback.png
    const hudY = this.h * 0.08;

    // SCORE
    this.scoreBg = this.add.image(this.w * 0.2, hudY, "scoreback");
    const hudScale = Math.min(
      (this.w * 0.28) / this.scoreBg.width,
      (this.h * 0.08) / this.scoreBg.height
    );
    this.scoreBg.setScale(hudScale);

    this.labelScore = this.add.text(
      this.scoreBg.x,
      this.scoreBg.y,
      "Score: 0",
      {
        fontFamily: "outfit",
        fontSize: `${Math.round(this.h * 0.025)}px`,
        color: "#070606ff",
      }
    ).setOrigin(0.5);

    // TARGET (center)
    this.targetBg = this.add.image(this.w * 0.5, hudY, "scoreback");
    this.targetBg.setScale(hudScale);

    this.labelTarget = this.add.text(
      this.targetBg.x,
      this.targetBg.y,
      `Target: ${this.targetScore}`,
      {
        fontFamily: "outfit",
        fontSize: `${Math.round(this.h * 0.025)}px`,
        color: "#000000ff",
      }
    ).setOrigin(0.5);

    // TIME (right)
    this.timeBg = this.add.image(this.w * 0.8, hudY, "scoreback");
    this.timeBg.setScale(hudScale);

    this.timerText = this.add.text(
      this.timeBg.x,
      this.timeBg.y,
      `Time: ${this.timeLeft}`,
      {
        fontFamily: "outfit",
        fontSize: `${Math.round(this.h * 0.025)}px`,
        color: "#000000ff",
      }
    ).setOrigin(0.5);

    // progress + bar near bottom
    this.progressBg = this.add
      .sprite(this.w / 2, this.h * 0.86, "bar")
      .setOrigin(0.5, 0.5);

    this.progressBar = this.add
      .sprite(this.w / 2, this.h * 0.86, "progress")
      .setOrigin(0, 0.5);

    this.progressBar.displayWidth = 0;
    this.progressBar.x = this.w / 2 - this.progressBg.displayWidth / 2;

    this.progressMaxWidth = this.progressBg.displayWidth;
    this.progressStep = this.progressMaxWidth / this.progressSegments;

    // build grid
    this.buildWorld();

    // start countdown timer (1 second interval)
    this.timerEvent = this.time.addEvent({
      delay: 1000,
      callback: this.handleTimerTick,
      callbackScope: this,
      loop: true,
    });
  }

  // ----------------- GRID BACKGROUND -----------------

  createGridBackground() {
    // clear old backgrounds if replaying
    if (this.cellBackgrounds) {
      this.cellBackgrounds.clear(true, true);
      this.cellBackgrounds = null;
    }

    this.cellBackgrounds = this.add.group();

    const cellSize = this.tileSize * 0.9; // slightly smaller than tile
    const radius = cellSize * 0.2;

    // Create a reusable rounded-rect texture once
    const textureKey = "cellbg";
    if (!this.textures.exists(textureKey)) {
      const g = this.add.graphics();
      g.fillStyle(0xffffff, 0.14); // subtle white-ish panel
      g.fillRoundedRect(0, 0, cellSize, cellSize, radius);
      g.generateTexture(textureKey, cellSize, cellSize);
      g.destroy();
    }

    // Place a cell background at every grid position
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const x = this.offsetX + col * this.tileSize;
        const y = this.offsetY + row * this.tileSize;

        const cell = this.add
          .image(x, y, textureKey)
          .setOrigin(0.5)
          .setDepth(1); // above bg, below dots

        this.cellBackgrounds.add(cell);
      }
    }
  }


  handleTimerTick() {
    if (this.mode !== "play") return;

    this.timeLeft--;
    if (this.timeLeft < 0) this.timeLeft = 0;

    if (this.timerText) {
      this.timerText.setText(`Time: ${this.timeLeft}`);
    }

    // time up → if we didn't reach target, game over
    if (this.timeLeft <= 0) {
      if (this.timerEvent) {
        this.timerEvent.remove(false);
        this.timerEvent = null;
      }

      // decide win/lose on time end (just in case player hit target exactly at 0)
      if (this.score >= this.targetScore) {
        this.finishGame(true);
      } else {
        this.finishGame(false);
      }
    }
  }

  buildWorld() {
    for (let i = 0; i < this.rows; i++) {
      for (let j = 0; j < this.cols; j++) {
        this.addDot(i, j, true);
      }
    }
  }

  addDot(row, col, withDelay) {
    // choose a color: 1..4
    const colorIndex = Phaser.Math.Between(1, 4);
    const textureKey = `player${colorIndex}`;

    const x = this.offsetX + col * this.tileSize;
    const y = this.offsetY + row * this.tileSize;

    const dot = this.add
      .sprite(x, y, textureKey)
      .setOrigin(0.5)
      .setDepth(2); // ✅ above cell backgrounds

    dot.row = row;
    dot.col = col;
    dot.isSelected = false;
    dot.colorId = colorIndex;
    dot.clearTint();

    const ratio = this.dotScaleRatio || DEFAULT_DOT_SCALE_RATIO;
    const baseScale = (this.tileSize * ratio) / dot.width;
    dot.baseScale = baseScale;
    dot.setScale(0.01);

    this.dotsGroup.add(dot);
    this.grid[row][col] = dot;

    this.tweens.add({
      targets: dot,
      scaleX: baseScale,
      scaleY: baseScale,
      duration: 400,
      delay: withDelay ? col * 100 + 1 : 400,
    });
  }


  // ----------------- GAMEPLAY UPDATE -----------------

  updatePlay() {
    const pointer = this.input.activePointer;

    // While finger/mouse is down, continuously try to extend the chain
    if (pointer.isDown) {
      if (!this.clicked) {
        // Fresh drag
        this.clicked = true;
        this.count = 0;
        this.currentType = -1;
        this.lastRow = -1;
        this.lastCol = -1;
        this.unselectAllDots();
      }
      this.trySelectDot(pointer);
    }

    // When finger is released, resolve the chain
    if (!pointer.isDown && this.clicked) {
      if (this.count > 1) {
        this.removeSelectedDots();
        this.moveDotsDown();
        this.addMissingDots();
        this.updateScoreAndLabels();
      } else {
        this.unselectAllDots();
      }

      this.clicked = false;
      this.count = 0;
      this.currentType = -1;
      this.lastRow = -1;
      this.lastCol = -1;
    }
  }

  trySelectDot(pointer) {
    const dot = this.getDotAtPointer(pointer);
    if (!dot) return;
    if (dot.isSelected) return; // already in chain

    // First dot in the chain
    if (this.count === 0 || this.currentType === -1) {
      this.currentType = dot.colorId;
      this.selectDot(dot);
      return;
    }

    // Same color and adjacent → extend chain
    if (dot.colorId === this.currentType && this.inRange(dot.row, dot.col)) {
      this.selectDot(dot);
    } else {
      // Wrong move → cancel current chain
      this.unselectAllDots();
      this.currentType = -1;
      this.count = 0;
      this.lastRow = -1;
      this.lastCol = -1;
    }
  }

  getDotAtPointer(pointer) {
    const x = pointer.x;
    const y = pointer.y;

    for (let i = 0; i < this.rows; i++) {
      for (let j = 0; j < this.cols; j++) {
        const dot = this.grid[i][j];
        if (!dot) continue;
        const bounds = dot.getBounds();
        if (Phaser.Geom.Rectangle.Contains(bounds, x, y)) {
          return dot;
        }
      }
    }
    return null;
  }

  selectDot(dot) {
    if (this.isSoundOn) {
      const barLevel =
        this.progressBar.displayWidth / this.progressStep;

      if (barLevel <= 3) {
        this.tap1_s.play({ volume: 0.5 });
      } else if (barLevel <= 7) {
        this.tap2_s.play({ volume: 0.7 });
      } else {
        this.tap3_s.play({ volume: 0.9 });
      }
    }

    dot.isSelected = true;
    // highlight via tint + slight scale up
    dot.setTint(0xffff66);
    dot.setScale(dot.baseScale * 1.2);

    this.count += 1;
    this.lastRow = dot.row;
    this.lastCol = dot.col;
    this.increaseBar();
  }

  inRange(row, col) {
    if (this.lastRow === -1) return true;

    return (
      (this.lastCol - 1 === col && this.lastRow === row) ||
      (this.lastCol + 1 === col && this.lastRow === row) ||
      (this.lastCol === col && this.lastRow - 1 === row) ||
      (this.lastCol === col && this.lastRow + 1 === row)
    );
  }

  removeSelectedDots() {
    for (let i = 0; i < this.rows; i++) {
      for (let j = 0; j < this.cols; j++) {
        const dot = this.grid[i][j];
        if (!dot || !dot.isSelected) continue;

        this.tweens.add({
          targets: dot,
          scaleX: dot.baseScale * 2,
          scaleY: dot.baseScale * 2,
          alpha: 0,
          duration: 300,
          onComplete: () => {
            dot.destroy();
          },
        });

        this.grid[i][j] = null;
      }
    }
  }

  moveDotsDown() {
    // compress each column
    for (let col = 0; col < this.cols; col++) {
      const dotsInColumn = [];

      // collect from bottom to top
      for (let row = this.rows - 1; row >= 0; row--) {
        const dot = this.grid[row][col];
        if (dot) {
          dotsInColumn.push(dot);
          this.grid[row][col] = null;
        }
      }

      // put them back from bottom
      let targetRow = this.rows - 1;
      for (let k = 0; k < dotsInColumn.length; k++) {
        const dot = dotsInColumn[k];
        dot.row = targetRow;
        this.grid[targetRow][col] = dot;

        const targetY = this.offsetY + targetRow * this.tileSize;

        this.tweens.add({
          targets: dot,
          y: targetY,
          duration: 100 * (this.rows - targetRow),
          delay: 100,
        });

        targetRow--;
      }
    }
  }

  addMissingDots() {
    for (let col = 0; col < this.cols; col++) {
      for (let row = 0; row < this.rows; row++) {
        if (!this.grid[row][col]) {
          const x = this.offsetX + col * this.tileSize;
          const targetY = this.offsetY + row * this.tileSize;
          const startY = this.offsetY - this.tileSize;

          const colorIndex = Phaser.Math.Between(1, 4);
          const textureKey = `player${colorIndex}`;

          const dot = this.add.sprite(x, startY, textureKey).setOrigin(0.5);
          dot.row = row;
          dot.col = col;
          dot.isSelected = false;
          dot.colorId = colorIndex;
          dot.clearTint();

          const ratio = this.dotScaleRatio || DEFAULT_DOT_SCALE_RATIO;
          const baseScale = (this.tileSize * ratio) / dot.width;
          dot.baseScale = baseScale;
          dot.setScale(baseScale);

          this.dotsGroup.add(dot);
          this.grid[row][col] = dot;

          this.tweens.add({
            targets: dot,
            y: targetY,
            duration: 400,
            delay: 400,
          });
        }
      }
    }
  }

  updateScoreAndLabels() {
    if (this.isSoundOn) {
      this.combo_s.play({ volume: 0.4 });
    }

    this.moves += 1; // not used for win/lose now, just internal

    const multiplier = this.getMultiplierBar();
    this.score += this.count * multiplier;
    if (this.labelScore) {
      this.labelScore.setText(`Score: ${this.score}`);
    }

    this.clearBar();

    // 🎯 If we reached or passed target, immediate WIN
    if (this.score >= this.targetScore && this.mode === "play") {
      if (this.timerEvent) {
        this.timerEvent.remove(false);
        this.timerEvent = null;
      }
      this.finishGame(true);
    }
  }

  // ----------------- BAR / MULTIPLIER -----------------

  increaseBar() {
    const level =
      this.progressBar.displayWidth / this.progressStep;
    if (level <= this.progressSegments - 1) {
      const newWidth =
        this.progressBar.displayWidth + this.progressStep;

      this.tweens.add({
        targets: this.progressBar,
        displayWidth: Math.min(newWidth, this.progressMaxWidth),
        duration: 100,
      });
    }
  }

  clearBar() {
    this.tweens.add({
      targets: this.progressBar,
      displayWidth: 0,
      duration: 300,
    });
  }

  getMultiplierBar() {
    const level =
      this.progressBar.displayWidth / this.progressStep;

    if (level <= 4) return 1;
    else if (level <= 8) return 5;
    else return 10;
  }

  unselectAllDots() {
    this.count = 0;
    for (let i = 0; i < this.rows; i++) {
      for (let j = 0; j < this.cols; j++) {
        const dot = this.grid[i][j];
        if (dot && dot.isSelected) {
          dot.isSelected = false;
          dot.clearTint();
          dot.setScale(dot.baseScale);
        }
      }
    }
    this.clearBar();
  }

  // ----------------- FINISH + OVERLAYS -----------------

  finishGame(isWin) {
    if (this.mode === "end") return; // avoid double call

    this.mode = "end";

    // stop timer
    if (this.timerEvent) {
      this.timerEvent.remove(false);
      this.timerEvent = null;
    }

    // ❗ Do NOT stop BGM here – it should keep playing over win/lose

    // clear gameplay objects
    if (this.dotsGroup) {
      this.dotsGroup.clear(true, true);
      this.dotsGroup = null;
    }
    this.grid = [];

    // NEW: remove grid cells
    if (this.cellBackgrounds) {
      this.cellBackgrounds.clear(true, true);
      this.cellBackgrounds = null;
    }

    if (this.labelScore) this.labelScore.destroy();
    if (this.labelTarget) this.labelTarget.destroy();
    if (this.timerText) this.timerText.destroy();
    if (this.progressBar) this.progressBar.destroy();
    if (this.progressBg) this.progressBg.destroy();

    if (this.scoreBg) this.scoreBg.destroy();
    if (this.targetBg) this.targetBg.destroy();
    if (this.timeBg) this.timeBg.destroy();

    // keep bgImage if you want it behind overlays (optional)

    // save best score
    this.saveBestScore();

    // choose overlay
    if (isWin) {
      this.showWinOverlay();
    } else {
      this.showGameOverlay();
    }
  }

  saveBestScore() {
    if (this.bestScore === 0) {
      try {
        const tmp = parseInt(
          window.localStorage.getItem("7_best_score") || "0",
          10
        );
        if (!isNaN(tmp) && tmp > 0) this.bestScore = tmp;
      } catch (e) {
        // ignore
      }
    }

    if (this.score > this.bestScore) {
      this.bestScore = this.score;
      try {
        window.localStorage.setItem(
          "7_best_score",
          String(this.bestScore)
        );
      } catch (e) {
        // ignore
      }
    }
  }

  // ✅ WIN OVERLAY

  showWinOverlay() {
    if (this.winOverlay) {
      this.winOverlay.destroy(true);
      this.winOverlay = null;
    }

    const texts = this.configData.texts || {};
    const winTitle = texts.winTitle || "LEVEL COMPLETED!";

    const cont = this.add.container(0, 0).setDepth(30);
    this.winOverlay = cont;

    const bg = this.add.image(this.w / 2, this.h / 2, "winbg");
    const bgScale = Math.max(this.w / bg.width, this.h / bg.height);
    bg.setScale(bgScale);

    const box = this.add.image(this.w / 2, this.h * 0.5, "lvlbox");
    const boxScale = Math.min(
      (this.w * 0.9) / box.width,
      (this.h * 0.5) / box.height
    );
    box.setScale(boxScale);

    const title = this.add
      .text(this.w / 2, this.h * 0.35 + 200, winTitle, {
        fontFamily: "outfit",
        fontSize: `${Math.round(this.h * 0.04)}px`,
        color: "#ffffff",
      })
      .setOrigin(0.5);

    const info = this.add
      .text(this.w / 2, this.h * 0.45 + 200, `Score: ${this.score}`, {
        fontFamily: "outfit",
        fontSize: `${Math.round(this.h * 0.03)}px`,
        color: "#ffffff",
        align: "center",
      })
      .setOrigin(0.5);

    // replay button
    const replayBtn = this.add
      .image(this.w * 0.4 - 130, this.h * 0.78 - 200, "lvl_replay")
      .setInteractive({ useHandCursor: true });

    replayBtn.on("pointerdown", () => {
      if (this.tap1_s) this.tap1_s.play({ volume: 0.6 });
      // 🔁 restart BGM on replay
      if (this.bgm) {
        this.bgm.stop();
      }
      this.scene.restart();
    });

    // next button
    const nextBtn = this.add
      .image(this.w * 0.6 + 130, this.h * 0.78 - 200, "next")
      .setInteractive({ useHandCursor: true });

    nextBtn.on("pointerdown", () => {
      if (this.tap2_s) this.tap2_s.play({ volume: 0.6 });
      this.notifyParent("sceneComplete", { result: "win" });
    });

    cont.add([bg, box, title, info, replayBtn, nextBtn]);
  }

  // ✅ GAME OVER OVERLAY

  showGameOverlay() {
    if (this.gameOverlay) {
      this.gameOverlay.destroy(true);
      this.gameOverlay = null;
    }

    const texts = this.configData.texts || {};
    const gameOverTitle = texts.gameOverTitle || "GAME OVER";

    const cont = this.add.container(0, 0).setDepth(30);
    this.gameOverlay = cont;

    const bg = this.add.image(this.w / 2, this.h / 2, "ovrbg");
    const bgScale = Math.max(this.w / bg.width, this.h / bg.height);
    bg.setScale(bgScale);

    const box = this.add.image(this.w / 2, this.h * 0.5, "ovrbox");
    const boxScale = Math.min(
      (this.w * 0.9) / box.width,
      (this.h * 0.5) / box.height
    );
    box.setScale(boxScale);

    const title = this.add
      .text(this.w / 2, this.h * 0.35 + 200, gameOverTitle, {
        fontFamily: "outfit",
        fontSize: `${Math.round(this.h * 0.04)}px`,
        color: "#ffffff",
      })
      .setOrigin(0.5);

    const info = this.add
      .text(this.w / 2, this.h * 0.45 + 200, `Score: ${this.score}`, {
        fontFamily: "outfit",
        fontSize: `${Math.round(this.h * 0.03)}px`,
        color: "#ffffff",
        align: "center",
      })
      .setOrigin(0.5);

    const replayBtn = this.add
      .image(this.w / 2, this.h * 0.78 - 200, "replay")
      .setInteractive({ useHandCursor: true });

    replayBtn.on("pointerdown", () => {
      if (this.tap1_s) this.tap1_s.play({ volume: 0.6 });
      // 🔁 restart BGM on replay
      if (this.bgm) {
        this.bgm.stop();
      }
      this.scene.restart();
    });

    cont.add([bg, box, title, info, replayBtn]);
  }
}
