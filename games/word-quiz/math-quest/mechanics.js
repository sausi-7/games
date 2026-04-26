export default class MechanicsScene extends Phaser.Scene {
  constructor() {
    super("MechanicsScene");

    this.score = 0;
    this.timeLeft = 60;
    this.currentAnswer = null;
    this.answerButtons = [];
    this.pathTiles = [];
    this.currentTileIndex = 0;
    this.isGameOver = false;

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
    this.load.json("levelConfig", `${basePath}/config.json`);
    this.load.script(
      "webfont",
      "https://ajax.googleapis.com/ajax/libs/webfont/1.6.26/webfont.js"
    );

    this.load.once("filecomplete-json-levelConfig", () => {
      const cfg = this.cache.json.get("levelConfig");
      const spritesheets = cfg.spritesheets || {};
      const eveData = spritesheets.eve || {};
      const sheets = cfg.sheets || cfg.spritesheets || {};

      const heroData = sheets.hero || {};
      const spacemanData = sheets.spaceman || {};

      const rawMain = new URLSearchParams(window.location.search).get("main") || "";
      const cleanMain = rawMain.replace(/^"|"$/g, "");

      // Use sheetUrl from param, config, or fallback
      const sheetUrl = cleanMain || heroData.url || `${basePath}/assets/eve_spritesheet.png`;

      const frameW = heroData.frameWidth || 102;
      const frameH = heroData.frameHeight || 158;

      // Load eve sprite
      this.load.spritesheet("eve", sheetUrl, {
        frameWidth: frameW,
        frameHeight: frameH,
      });

      // Load character sprite, prefer main param
      const charSheet = sheets.character;
      if (cleanMain) {
        this.load.spritesheet("character", sheetUrl, {
          frameWidth: frameW,
          frameHeight: frameH,
        });
      } else if (charSheet?.url) {
        this.load.spritesheet("character", `${basePath}/${charSheet.url}`, {
          frameWidth: charSheet.frameWidth || 100,
          frameHeight: charSheet.frameHeight || 158,
        });
      }

      // Load other assets
      const images2 = cfg.images2 || {};
      const ui = cfg.ui || {};
      for (const [key, url] of Object.entries(images2)) {
        this.load.image(key, `${basePath}/${url}`);
      }

      for (const [key, url] of Object.entries(ui)) {
        this.load.image(key, `${basePath}/${url}`);
      }

      const audio = cfg.audio || {};
      for (const [key, url] of Object.entries(audio)) {
        this.load.audio(key, `${basePath}/${url}`);
      }

      this.load.start();
    });
  }
  init(data) {
    this._skipHTP = !!(data && data.skipHTP);
  }



  create() {
    this.answerButtons?.forEach(o => { o.btn?.destroy(); o.text?.destroy(); });
    this.answerButtons = [];
    this.pathTiles?.forEach(t => t?.destroy());
    this.pathTiles = [];
    this.currentTileIndex = 0;
    this.score = 0;
    this.isGameOver = false;
    this.config = this.cache.json.get("levelConfig") || {};
    this.timeLeft = this.config.timer || 60;
    this.targetScore = this.config.winScore || 60;
    const tileCount = this.config.tileCount || 6;
    const tileSpacing = this.config.tileSpacing || 160;
    const tileW = this.config.tileWidth || 300;
    const tileH = this.config.tileHeight || 60;
    const playerSize = this.config.playerSize || 80;
    const questionBox = this.config.questionBox || {};
    const answerButton = this.config.answerButton || {};
    const W = this.sys.game.config.width;
    const H = this.sys.game.config.height;
    this.W = this.sys.game.config.width;
    this.H = this.sys.game.config.height;
    this.isGameOver = false;

    const bgKey = Object.keys(this.config.images2 || {}).find((key) =>
      key.toLowerCase().includes("background")
    );
    if (bgKey) {
      this.background = this.add
        .image(W / 2, H / 2, bgKey)
        .setDisplaySize(W, H)
        .setDepth(0);
    }
    if (this.config.audio?.bgm) {
      this.bgm = this.sound.add("bgm", { loop: true, volume: 0.5 });
      this.bgm.play();
    }
    const centerX = this.sys.game.config.width / 2;

    // Enlarged Stepping Tiles
    const bottomY = this.H - 150;
    for (let i = 0; i < tileCount; i++) {
      const tile = this.add
        .image(centerX, bottomY - i * tileSpacing, "tileImage")
        .setDisplaySize(tileW, tileH);

      this.pathTiles.push(tile);
    }

    // Enlarged Player
    this.player = this.add
      .sprite(centerX, this.pathTiles[0].y - 45, "character")
      .setScale(1);

    // Score and Timer
    this.scoreText = this.add.text(40, 30, "Score: 0", {
      fontSize: "45px",
      fontFamily: "Outfit",
      fill: "#FFFFFF",
    });

    this.timerText = this.add.text(
      this.sys.game.config.width - 220,
      30,
      `Time: ${this.timeLeft}`, // ← backticks here!
      {
        fontSize: "45px",
        fontFamily: "Outfit",
        fill: "#FFFFFF",
      }
    );

    // Enlarged Question Box
    this.add
      .rectangle(
        centerX,
        250,
        questionBox.width || 640,
        questionBox.height || 120,
        0xfff59d
      )
      .setStrokeStyle(4, 0xfbc02d);

    this.questionText = this.add
      .text(centerX, 250, "", {
        fontSize: "48px",
        fontFamily: "Outfit",
        color: "#000",
        align: "center",
        wordWrap: { width: 600 },
      })
      .setOrigin(0.5);

    const answerSpacing = answerButton.spacing || 140;
    const answerW = answerButton.width || 500;
    const answerH = answerButton.height || 100;
    // Enlarged Answer Buttons
    for (let i = 0; i < 3; i++) {
      const y = 430 + i * answerSpacing;

      const btn = this.add
        .rectangle(centerX, y, answerW, answerH, 0xffffff)
        .setStrokeStyle(3, 0x333333)
        .setInteractive();

      const text = this.add
        .text(centerX, y, "", {
          fontSize: "40px",
          fontFamily: "Outfit",
          color: "#000",
        })
        .setOrigin(0.5);

      btn.on("pointerdown", () => {
        if (text.text == this.currentAnswer) {
          this.score += 10;
          this.scoreText.setText("Score: " + this.score);
          this.movePlayer();
        } else {
          this.sys.cameras.main.shake(200);
          this.score = Math.max(0, this.score - 5);
          this.scoreText.setText("Score: " + this.score);
          if (this.currentTileIndex > 0) {
            this.currentTileIndex--;
            this.sys.tweens.add({
              targets: this.player,
              y: this.pathTiles[this.currentTileIndex].y - 70,
              duration: 300,
              ease: "Power2",
            });
          }
        }
        this.generateQuestion();
      });

      // ✅ push the pair
      this.answerButtons.push({ btn, text });

      // ❌ REMOVE these from inside the loop:
      // if (this._skipHTP) this.startGame(); else this.showInstructions();
    }
    // this.answerButtons.push({ btn, text });


    // Timer Event
    this.timerEvent = this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        this.timeLeft--;
        this.timerText.setText("Time: " + this.timeLeft);
        if (this.timeLeft <= 0) this.endGame();
      },
    });

    // Pause timer initially
    this.timerEvent.paused = true;

    this.generateQuestion();
    this.showInstructions();
  }

  startGame() {
    this.instructionVisible = false;
    if (this.htpOverlay) this.htpOverlay.destroy();

    // Scorebar background image (make sure 'scorebar' is in config.images)
    this.add.image(this.W / 2, 90, "scorebar").setDepth(10);

    // Timer on top of scorebar
    this.timerText.setPosition(this.W / 2 + 300, 65).setDepth(11);

    // Score text on top of scorebar
    this.scoreText.setPosition(this.W / 2 - 150 - 300, 65).setDepth(11);
    if (this.timerEvent) this.timerEvent.paused = false;
  }

  update() { }

  generateQuestion() {
    if (this.isGameOver) return; // Don't generate if game ended

    const a = Phaser.Math.Between(1, 20);
    const b = Phaser.Math.Between(1, 20);
    const ops = ["+", "-", "*"];
    const op = Phaser.Utils.Array.GetRandom(ops);
    const questionStr = `${a} ${op} ${b}`;
    this.currentAnswer = eval(questionStr);
    this.questionText.setText(`Solve: ${questionStr}`);

    let answers = [this.currentAnswer];
    while (answers.length < 3) {
      const fake = this.currentAnswer + Phaser.Math.Between(-10, 10);
      if (!answers.includes(fake)) answers.push(fake);
    }

    Phaser.Utils.Array.Shuffle(answers);
    this.answerButtons.forEach((btn, i) => {
      btn.text.setText(answers[i]);
    });
  }

  movePlayer() {
    this.currentTileIndex++;

    if (this.currentTileIndex >= this.pathTiles.length) {
      this.winGame();
      return;
    }

    this.sys.tweens.add({
      targets: this.player,
      y: this.pathTiles[this.currentTileIndex].y - 45,
      duration: 400,
      ease: "Power2",
    });
  }

  endGame() {
    if (this.isGameOver) return;
    this.isGameOver = true;

    this.timerEvent?.remove();
    this.bgm?.stop();

    // play Game Over SFX (use a distinct var so it never clashes with the method name)
    this.sfxGameOver = this.sound.add("gameover", { loop: false, volume: 1 });
    this.sfxGameOver.play();   // <-- keep this
    // REMOVE: this.endGame.play();

    const blur = this.add.rectangle(0, 0, 1080, 1920, 0x000000, 0.5).setOrigin(0).setDepth(9);
    const gameOverBox = this.add.image(540, 820, "game_over").setDepth(10);

    const ttScore = this.add.text(210, 820, "Score", { font: "60px Outfit", color: "#FFFFFF" })
      .setOrigin(0.5).setDepth(11);
    const ttScoreYour = this.add.text(870, 830, `${this.score}`, { font: "60px Outfit", color: "#FFFFFF" })
      .setOrigin(0.5).setDepth(11);

    const yourScore = this.add.text(250, 980, "Time Left", { font: "60px Outfit", color: "#FFFFFF" })
      .setOrigin(0.5).setDepth(11);
    const yourUserScore = this.add.text(870, 980, `${this.timeLeft}`, { font: "60px Outfit", color: "#FFFFFF" })
      .setOrigin(0.5).setDepth(11);

    const restartButton = this.add.image(540, 1170, "replay_level").setInteractive().setDepth(10);
    restartButton.on("pointerdown", () => {
      this.sfxGameOver?.stop();           // stop the correct sound
      blur.destroy();
      gameOverBox.destroy();
      yourScore.destroy();
      ttScore.destroy();
      yourUserScore.destroy();
      ttScoreYour.destroy();
      restartButton.destroy();
      this.scene.restart({ skipHTP: true });
    });
  }


  winGame() {
    if (this.isGameOver) return;
    this.isGameOver = true;

    this.timerEvent?.remove();
    this.bgm?.stop();

    this.sfxLevelComplete = this.sound.add("levelCompleted", { loop: false, volume: 0.5 });
    this.sfxLevelComplete.play();

    const blur = this.add.rectangle(0, 0, 1080, 1920, 0x000000, 0.5).setOrigin(0).setDepth(9);
    const gameOverBox = this.add.image(540, 820, "level_complete").setDepth(10);
    const buttonY = 1170;
    const buttonSpacing = 240;

    const ttScore = this.add.text(210, 820, "Score", { font: "60px Outfit", color: "#FFFFFF" })
      .setOrigin(0.5).setDepth(11);
    const ttScoreYour = this.add.text(870, 830, `${this.score}`, { font: "60px Outfit", color: "#FFFFFF" })
      .setOrigin(0.5).setDepth(11);

    const yourScore = this.add.text(250, 980, "Time Left", { font: "60px Outfit", color: "#FFFFFF" })
      .setOrigin(0.5).setDepth(11);
    const yourUserScore = this.add.text(870, 980, `${this.timeLeft}`, { font: "60px Outfit", color: "#FFFFFF" })
      .setOrigin(0.5).setDepth(11);

    const replayButton = this.add.image(540 - buttonSpacing, buttonY, "replay").setInteractive().setDepth(10);
    const nextButton = this.add.image(540 + buttonSpacing, buttonY, "next").setInteractive().setDepth(10);

    replayButton.on("pointerdown", () => {
      this.sfxLevelComplete?.stop();
      blur.destroy();
      gameOverBox.destroy();
      yourScore.destroy();
      ttScore.destroy();
      yourUserScore.destroy();
      nextButton.destroy();
      ttScoreYour.destroy();
      replayButton.destroy();
      this.scene.restart({ skipHTP: true });
    });

    nextButton.on("pointerdown", () => {
      this.sfxLevelComplete?.stop();
      blur.destroy();
      gameOverBox.destroy();
      yourScore.destroy();
      ttScore.destroy();
      nextButton.destroy();
      yourUserScore.destroy();
      ttScoreYour.destroy();
      replayButton.destroy();
      this.notifyParent('sceneComplete', { result: 'win' });
    });
  }


  showInstructions() {
    this.instructionVisible = true;

    this.htpOverlay = this.add.container(0, 0).setDepth(10); // full overlay container

    this.blur = this.add
      .rectangle(0, 0, 1080, 1920, 0x000000, 0.5)
      .setOrigin(0);
    this.howToPlayBox = this.add.image(540, 820, "htp");

    this.descriptionText = this.add
      .text(
        540,
        800,
        "Answer correctly to climb up. Wrong answers push you down. Reach the top before time’s up! ⏱️",
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

    this.playButton = this.add.image(540, 1450, "play_game").setInteractive();
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
}
