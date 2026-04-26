export default class MechanicsScene extends Phaser.Scene {
  constructor() {
    super("MechanicsScene");

    this.COLS = 7;
    this.ROWS = 6;
    this.CELL_SIZE = 130;
    this.board = [];
    this.tokens = [];
    this.currentPlayer = 1;
    this.isGameOver = false;
    this.dropping = false;

    Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach((fn) => {
      if (typeof this[fn] === "function") this[fn] = this[fn].bind(this);
    });
  }

  notifyParent(type, data) {
    if (window.parent !== window) {
      window.parent.postMessage({ type, ...data }, "*");
    }
  }

  preload() {
    const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf("/"));
    if (this.load.setCORS) this.load.setCORS("anonymous");

    const evictTexture = (key) => { if (this.textures.exists(key)) this.textures.remove(key); };
    const evictAudio = (key) => { if (this.cache.audio.exists(key)) this.cache.audio.remove(key); };
    const joinPath = (p) => {
      if (!p) return p;
      try { new URL(p); return p; } catch { /* not absolute */ }
      return `${basePath}/${p.replace(/^\.?\//, "")}`;
    };

    const looksLikeImage = (v) =>
      typeof v === "string" &&
      (/\.(png|jpe?g|webp|gif|svg)$/i.test(v) || /^https?:\/\//i.test(v) || v.startsWith("./") || v.startsWith("/"));

    const loadFromCfg = (cfg) => {
      const images1 = cfg.images1 || {};
      const images2 = cfg.images2 || {};
      const ui = cfg.ui || {};
      const audio = cfg.audio || {};
      const sheets = cfg.sheets || cfg.spritesheets || {};

      // Spritesheet: ?main= overrides config


      // Images
      for (const [key, url] of Object.entries(images1)) this.load.image(key, joinPath(url));
      for (const [key, url] of Object.entries(images2)) this.load.image(key, joinPath(url));

      // UI: load only entries that are actual image paths (skip fontSize/fontColor)
      for (const [key, val] of Object.entries(ui)) {
        if (looksLikeImage(val)) this.load.image(key, joinPath(val));
      }

      // Audio
      for (const [key, url] of Object.entries(audio)) {
        evictAudio(key);
        this.load.audio(key, joinPath(url));
      }

      this.load.script("webfont", "https://ajax.googleapis.com/ajax/libs/webfont/1.6.26/webfont.js");
      this.load.start();
    };

    if (this.cache.json.exists("levelConfig")) {
      loadFromCfg(this.cache.json.get("levelConfig"));
      return;
    }

    this.load.once("filecomplete-json-levelConfig", () => {
      loadFromCfg(this.cache.json.get("levelConfig") || {});
    });

    this.load.json("levelConfig", `${basePath}/config.json`);
  }





  create() {
    this.config = this.cache.json.get("levelConfig") || {};

    this.texts = this.config.texts || {};
    this.t = (k, fallback) => (this.texts && this.texts[k]) || fallback;

    this.COLS = this.config.cols || 7;
    this.ROWS = this.config.rows || 6;
    this.CELL_SIZE = this.config.cellSize || 130;

    const W = this.sys.game.config.width;
    const H = this.sys.game.config.height;
    const centerX = W / 2;
    const centerY = H / 2;

    this.GRID_WIDTH = this.COLS * this.CELL_SIZE;
    this.GRID_HEIGHT = this.ROWS * this.CELL_SIZE;
    this.GRID_LEFT = centerX - this.GRID_WIDTH / 2;
    this.GRID_TOP = centerY - this.GRID_HEIGHT / 2 + 50;

    // ✅ Background: you have it under images2 with key "background"
    // --- make a container for all gameplay visuals ---
    this.gameLayer = this.add.container(0, 0).setDepth(1);

    // ✅ Background
    const bgKey = "background";
    if (this.textures.exists(bgKey)) {
      const bg = this.add.image(W / 2, H / 2, bgKey).setDisplaySize(W, H).setDepth(0);
      this.gameLayer.add(bg);
    }

    // Characters (guard if texture exists)
    // Player (static image)
    if (this.textures.exists("player")) {
      this.player = this.add.image(360, 500, "player").setScale(1.0);
      this.gameLayer.add(this.player);
    }

    // (Optional) AI avatar if you still need it as an image
    if (this.textures.exists("Alien1")) {
      this.aiCharacter = this.add.image(360, 500, "Alien1").setScale(1.7);
      this.gameLayer.add(this.aiCharacter);
    }


    const gridGraphic = this.drawGrid(); // now returns Graphics object
    this.gameLayer.add(gridGraphic);
    gridGraphic.setDepth(0);

    if (this.aiCharacter) this.aiCharacter.setVisible(false);

    this.turnText = this.add.text(
      centerX + 150,
      this.GRID_TOP - 100,
      "YOUR TURN",
      {
        font: "bold 72px Outfit",
        color: "#ffffff",
        letterSpacing: 2
      }
    )
      .setOrigin(0.5)
      .setDepth(10)
      .setStroke("#00e5ff", 10)
      .setShadow(0, 8, "#000000", 10, true, true);

    // idle breathing animation
    this.turnPulse = this.tweens.add({
      targets: this.turnText,
      scale: 1.06,
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: "sine.inOut"
    });


    this.gameLayer.add(this.turnText);

    // 🔒 Hide gameplay visuals until Play is tapped
    this.gameLayer.setVisible(false);


    this.input.on("pointerdown", (pointer) => {
      if (!this.gameStarted || this.dropping || this.isGameOver || this.currentPlayer !== 1) return;
      const col = Math.floor((pointer.x - this.GRID_LEFT) / this.CELL_SIZE);
      if (col >= 0 && col < this.COLS) this.playerMove(col);
    });

    this.resetBoard();
    this.showInstructions();
    this.gameStarted = false;
  }

  animateTurnText(text, color, stroke) {
    this.turnText.setText(text);
    this.turnText.setColor(color);
    this.turnText.setStroke(stroke, 10);

    // pop-in scale
    this.turnText.setScale(0.6);
    this.tweens.add({
      targets: this.turnText,
      scale: 1.1,
      duration: 160,
      yoyo: true,
      ease: "back.out"
    });

    // color flash
    this.tweens.addCounter({
      from: 0,
      to: 6,
      duration: 360,
      onUpdate: () => {
        this.turnText.setAlpha(
          this.turnText.alpha === 1 ? 0.85 : 1
        );
      }
    });

    // tiny camera nudge (optional but feels great)
    this.cameras.main.shake(80, 0.002);
  }


  showInstructions() {
    this.instructionVisible = true;

    if (this.sound && this.cache.audio.exists("bgm")) {
      if (!this.bgm) {
        this.bgm = this.sound.add("bgm", { loop: true, volume: 0.5 });
      }
      if (!this.bgm.isPlaying) {
        this.bgm.play();

      }
    }

    // full overlay container on top
    this.htpOverlay = this.add.container(0, 0).setDepth(1000);

    // Optional full-screen image background if available, else use blur
    let bgNode = null;
    if (this.textures.exists("htpbg")) {
      bgNode = this.add.image(540, 960, "htpbg").setDisplaySize(1080, 1920);
    } else {
      bgNode = this.add.rectangle(0, 0, 1080, 1920, 0x000000, 0.5).setOrigin(0);
    }

    // the HTP card/image
    const card = this.add.image(540, 820, "htp").setScale(0.55, 0.8);

    const desc = this.add.text(
      540, 850,
      this.t(
        "htp_desc",
        "Connect four pieces vertically, horizontally or diagonally. The first one to align 4 pieces wins!"
      ),
      {
        font: "60px Outfit",
        color: "#ffffff",
        wordWrap: { width: 800, useAdvancedWrap: true },
        align: "center",
      }
    ).setOrigin(0.5);

    const desc1 = this.add.text(
      540, 600,
      this.t("htp_title", "How to Play"),
      {
        font: "bold 70px Outfit",
        color: "#ffffff",
        wordWrap: { width: 800, useAdvancedWrap: true },
        align: "center",
      }
    ).setOrigin(0.5);

    const playBtn = this.add.image(540, 1350, "play_game").setInteractive();
    playBtn.on("pointerdown", () => this.startGame());

    this.htpOverlay.add([bgNode, card, desc, desc1, playBtn]);
  }


  startGame() {
    this.instructionVisible = false;
    this.gameStarted = true;

    if (this.htpOverlay) {
      this.htpOverlay.destroy();
      this.htpOverlay = null;
    }

    // 👇 show the whole gameplay
    if (this.gameLayer) this.gameLayer.setVisible(true);
  }



  update() { }

  drawGrid() {
    const graphics = this.add.graphics();
    graphics.fillStyle(0x0055aa, 1);
    graphics.fillRect(
      this.GRID_LEFT,
      this.GRID_TOP,
      this.GRID_WIDTH,
      this.GRID_HEIGHT
    );

    for (let r = 0; r < this.ROWS; r++) {
      for (let c = 0; c < this.COLS; c++) {
        graphics.fillStyle(0x000000, 1);
        graphics.fillCircle(
          this.GRID_LEFT + c * this.CELL_SIZE + this.CELL_SIZE / 2,
          this.GRID_TOP + r * this.CELL_SIZE + this.CELL_SIZE / 2,
          45
        );
      }
    }
    return graphics; // ⬅️ now returns for container use
  }


  resetBoard() {
    this.board = [];
    this.tokens = [];
    for (let r = 0; r < this.ROWS; r++) {
      this.board[r] = [];
      this.tokens[r] = [];
      for (let c = 0; c < this.COLS; c++) {
        this.board[r][c] = 0;
        this.tokens[r][c] = null;
      }
    }
    this.currentPlayer = 1;
    this.isGameOver = false;
    this.dropping = false;
  }

  playerMove(col) {
    const row = this.getEmptyRow(col);
    if (row === -1) return;

    this.dropping = true;
    this.dropToken(row, col, 1, () => {
      const winLine = this.checkWin(row, col, 1);
      if (winLine) {
        this.blinkTokens(winLine);
        this.time.delayedCall(1000, () => {
          this.winGame();
          this.isGameOver = true;
          // this.bgm?.stop();
        });
      }
      else if (this.isDraw()) {
        this.draw();

      } else {
        this.currentPlayer = 2;
        this.animateTurnText("AI THINKING...", "#ff6b6b", "#ff3b3b");

        this.player.setVisible(false);
        this.aiCharacter.setVisible(true);
        this.dropping = false;
        this.time.delayedCall(600, () => this.aiMove());
      }
    });
  }
  winGame() {
    this.isGameOver = true;

    // Overlay container (everything goes here)
    this.winOverlay = this.add.container(0, 0).setDepth(9);

    // Background for WIN
    let bgNode;
    if (this.textures.exists("winbg")) {
      bgNode = this.add.image(540, 960, "winbg").setDisplaySize(1080, 1920);
    } else {
      bgNode = this.add.rectangle(0, 0, 1080, 1920, 0x000000, 0.5).setOrigin(0);
    }
    this.winOverlay.add(bgNode);

    // Foreground box and text
    const gameOverBox = this.add.image(540, 820, "level_complete").setScale(0.55, 0.8).setDepth(10);
    const ttScore = this.add.text(
      540, 850,
      this.t("win_title", "You Win!!"),
      { font: "140px Outfit", color: "#FFFFFF" }
    ).setOrigin(0.5).setDepth(11);


    const buttonY = 1170;
    const buttonSpacing = 240;
    const replayButton = this.add.image(540 - buttonSpacing, buttonY + 200, "replay").setInteractive().setDepth(10);
    const nextButton = this.add.image(540 + buttonSpacing, buttonY + 200, "next").setInteractive().setDepth(10);

    // add all to container so we can destroy at once
    this.winOverlay.add([gameOverBox, ttScore, replayButton, nextButton]);

    replayButton.on("pointerdown", () => {
      this.bgm?.stop();
      this.winOverlay?.destroy();
      this.winOverlay = null;
      this.scene.restart();
    });

    nextButton.on("pointerdown", () => {
      this.winOverlay?.destroy();
      this.winOverlay = null;
      this.notifyParent('sceneComplete', { result: 'win' });
    });
  }


  showAiWin() {
    this.isGameOver = true;
    if (this.timerEvent) this.timerEvent.remove();

    this.ovrOverlay = this.add.container(0, 0).setDepth(9);

    // Background for GAME OVER
    let bgNode;
    if (this.textures.exists("ovrbg")) {
      bgNode = this.add.image(540, 960, "ovrbg").setDisplaySize(1080, 1920);
    } else {
      bgNode = this.add.rectangle(0, 0, 1080, 1920, 0x000000, 0.5).setOrigin(0);
    }
    this.ovrOverlay.add(bgNode);

    const gameOverBox = this.add.image(540, 820, "game_over").setScale(0.55, 0.6).setDepth(10);
    const ttScore = this.add.text(
      540, 850,
      this.t("game_over_title", "Game Over"),
      { font: "70px Outfit", color: "#FFFFFF" }
    ).setOrigin(0.5).setDepth(11);


    const restartButton = this.add.image(540, 1200, "replay_level").setInteractive().setDepth(10);

    this.ovrOverlay.add([gameOverBox, ttScore, restartButton]);

    restartButton.on("pointerdown", () => {
      this.bgm?.stop();
      this.ovrOverlay?.destroy();
      this.ovrOverlay = null;
      this.scene.restart();
    });
  }

  aiMove() {
    if (!this.gameStarted || this.isGameOver) return;
    if (this.isGameOver) return;
    const validCols = this.getValidColumns();

    for (let col of validCols) {
      const row = this.getEmptyRow(col);
      this.board[row][col] = 2;
      if (this.checkWin(row, col, 2)) {
        this.board[row][col] = 0;
        return this.dropToken(row, col, 2, () =>
          this.handlePostAIMove(row, col)
        );
      }
      this.board[row][col] = 0;
    }

    for (let col of validCols) {
      const row = this.getEmptyRow(col);
      this.board[row][col] = 1;
      if (this.checkWin(row, col, 1)) {
        this.board[row][col] = 0;
        return this.dropToken(row, col, 2, () =>
          this.handlePostAIMove(row, col)
        );
      }
      this.board[row][col] = 0;
    }

    const col = Phaser.Math.RND.pick(validCols);
    const row = this.getEmptyRow(col);
    this.dropToken(row, col, 2, () => this.handlePostAIMove(row, col));
  }

  handlePostAIMove(row, col) {
    const winLine = this.checkWin(row, col, 2);
    if (winLine) {
      this.blinkTokens(winLine);
      this.time.delayedCall(1000, () => {
        this.showAiWin();
        this.isGameOver = true;
        // this.bgm?.stop();
      });
    }
    else if (this.isDraw()) {
      this.turnText.setText(this.t("draw_title", "Draw!"));
      this.isGameOver = true;
      // this.bgm?.stop();
    } else {
      this.currentPlayer = 1;
      this.animateTurnText("YOUR TURN", "#7cfef0", "#00e5ff");

      this.player.setVisible(true);
      this.aiCharacter.setVisible(false);
      this.dropping = false;
    }
  }

  blinkTokens(winLine) {
    winLine.forEach(([r, c]) => {
      const token = this.tokens[r][c];
      if (token) {
        this.sys.tweens.add({
          targets: token,
          alpha: 0,
          duration: 300,
          ease: 'Sine.easeInOut',
          yoyo: true,
          repeat: 4
        });
      }
    });
  }


  dropToken(row, col, player, callback) {
    const x = this.GRID_LEFT + col * this.CELL_SIZE + this.CELL_SIZE / 2;
    const yStart = 0;
    const yEnd = this.GRID_TOP + row * this.CELL_SIZE + this.CELL_SIZE / 2;
    const color = player === 1 ? 0xffd700 : 0xff4444;

    // create token
    const token = this.add.circle(x, yStart, 45, color);

    // add into gameplay container so it renders above the grid
    if (this.gameLayer) this.gameLayer.add(token);
    token.setDepth(5);

    // 🔊 play tap sfx as it starts coming down (if loaded in config as "tap")
    if (this.sound && this.cache.audio.exists("tap")) {
      this.sound.play("tap", { volume: 0.7 });
    }

    this.sys.tweens.add({
      targets: token,
      y: yEnd,
      duration: 300,
      ease: "Bounce.easeOut",
      onComplete: () => {
        this.board[row][col] = player;
        this.tokens[row][col] = token;
        callback();
      },
    });
  }


  getEmptyRow(col) {
    for (let r = this.ROWS - 1; r >= 0; r--) {
      if (this.board[r][col] === 0) return r;
    }
    return -1;
  }

  getValidColumns() {
    return this.board[0]
      .map((cell, i) => (cell === 0 ? i : null))
      .filter((i) => i !== null);
  }

  isDraw() {
    return this.board[0].every((cell) => cell !== 0);
  }

  checkWin(r, c, player) {
    return (
      this.checkDir(r, c, player, 1, 0) ||  // horizontal
      this.checkDir(r, c, player, 0, 1) ||  // vertical
      this.checkDir(r, c, player, 1, 1) ||  // diagonal \
      this.checkDir(r, c, player, 1, -1)    // diagonal /
    );
  }

  checkDir(r, c, player, dr, dc) {
    const line = [[r, c]];
    this.collectLine(r, c, player, dr, dc, line);
    this.collectLine(r, c, player, -dr, -dc, line);
    if (line.length >= 4) return line;
    return null;
  }

  countLine(r, c, player, dr, dc) {
    let count = 0;
    let row = r + dr,
      col = c + dc;
    while (
      row >= 0 &&
      row < this.ROWS &&
      col >= 0 &&
      col < this.COLS &&
      this.board[row][col] === player
    ) {
      count++;
      row += dr;
      col += dc;
    }
    return count;
  }

  collectLine(r, c, player, dr, dc, line) {
    let row = r + dr,
      col = c + dc;
    while (
      row >= 0 &&
      row < this.ROWS &&
      col >= 0 &&
      col < this.COLS &&
      this.board[row][col] === player
    ) {
      line.push([row, col]);
      row += dr;
      col += dc;
    }
  }

  draw() {
    this.isGameOver = true;
    if (this.timerEvent) this.timerEvent.remove();

    this.ovrOverlay = this.add.container(0, 0).setDepth(9);

    // Background for DRAW (reuse ovrbg)
    let bgNode;
    if (this.textures.exists("ovrbg")) {
      bgNode = this.add.image(540, 960, "ovrbg").setDisplaySize(1080, 1920);
    } else {
      bgNode = this.add.rectangle(0, 0, 1080, 1920, 0x000000, 0.5).setOrigin(0);
    }
    this.ovrOverlay.add(bgNode);

    const gameOverBox = this.add.image(540, 820, "game_over").setScale(0.55, 0.8).setDepth(10);
    const ttScore = this.add.text(
      540, 850,
      this.t("draw_title", "Draw!"),
      { font: "60px Outfit", color: "#FFFFFF" }
    ).setOrigin(0.5).setDepth(11);


    const restartButton = this.add.image(540, 1280, "replay_level").setInteractive().setDepth(10);

    this.ovrOverlay.add([gameOverBox, ttScore, restartButton]);

    restartButton.on("pointerdown", () => {
      this.bgm?.stop();
      this.ovrOverlay?.destroy();
      this.ovrOverlay = null;
      this.scene.restart();
    });
  }


}
