export default class MechanicsScene extends Phaser.Scene {
  constructor() {
    super("MechanicsScene");
    this.platforms = [];

    Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach((fn) => {
      if (typeof this[fn] === "function") this[fn] = this[fn].bind(this);
    });
  }

  preload() {
    const basePath = import.meta.url.substring(
      0,
      import.meta.url.lastIndexOf("/")
    );
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
      const sheetUrl = cleanMain || heroData.url || `${basePath}/assets/hero.png`;

      const frameW = heroData.frameWidth || 100;
      const frameH = heroData.frameHeight || 158;

      // Load eve sprite
      this.load.spritesheet("character", sheetUrl, {
        frameWidth: frameW,
        frameHeight: frameH,
      });

      const images2 = cfg.images2 || {};
      const ui = cfg.ui || {};
      // const sheets = cfg.sheets || cfg.spritesheets || {};
      const audio = cfg.audio || {};
      // const spacemanData = sheets.spaceman || {};
      const charSheet = sheets.character;
      if (charSheet?.url) {
        this.load.spritesheet("character", `${basePath}/${charSheet.url}`, {
          frameWidth: charSheet.frameWidth || 100,
          frameHeight: charSheet.frameHeight || 158,
        });
      }



      for (const [key, url] of Object.entries(images2)) {
        this.load.image(key, `${basePath}/${url}`);
      }
      for (const [key, url] of Object.entries(ui)) {
        this.load.image(key, `${basePath}/${url}`);
      }

      for (const [key, url] of Object.entries(audio)) {
        this.load.audio(key, `${basePath}/${url}`);
      }

      this.load.start();
    });
  }

  create() {

    this.instructionVisible = false;
    this.gameOver = false;
    this.platforms = [];
    this.currentStep = 0;

    if (this.htpOverlay) {
      this.htpOverlay.destroy();
      this.htpOverlay = null;
    }
    this.config = this.cache.json.get("levelConfig") || {};
    this.W = this.sys.game.config.width;
    this.H = this.sys.game.config.height;
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock("portrait-primary").catch(() => { });
    }

    // 🔧 Initialize game state values
    this.timeLeft = this.config.timer || 30;
    this.currentStep = 0;
    this.gameOver = false;

    this.STEP_COUNT = this.config.stepCount || 10;
    this.PLATFORM_WIDTH = this.config.platformWidth || 100;
    this.PLATFORM_HEIGHT = this.config.platformHeight || 20;
    this.PLATFORM_GAP = this.config.platformGap || 120;
    this.PLATFORM_OFFSET_Y = this.config.platformOffsetY || 200;
    this.SAFE_COLOR = this.config.safeColor || 0x00ff00;
    this.FAIL_COLOR = this.config.failColor || 0xff0000;
    this.DEFAULT_COLOR = this.config.defaultColor || 0xffffff;
    const W = this.sys.game.config.width;
    const H = this.sys.game.config.height;
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
    const centerX = this.sys.cameras.main.centerX;

    // Platforms (pairs)
    for (let i = 0; i < this.STEP_COUNT; i++) {
      const y = this.H - this.PLATFORM_OFFSET_Y - i * this.PLATFORM_GAP;
      const isLeftSafe = Phaser.Math.Between(0, 1) === 0;

      const left = this.add
        .rectangle(
          centerX - 200,
          y,
          this.PLATFORM_WIDTH,
          this.PLATFORM_HEIGHT,
          this.DEFAULT_COLOR
        )
        .setInteractive();
      left.safe = isLeftSafe;

      const right = this.add
        .rectangle(
          centerX + 200,
          y,
          this.PLATFORM_WIDTH,
          this.PLATFORM_HEIGHT,
          this.DEFAULT_COLOR
        )
        .setInteractive();
      right.safe = !isLeftSafe;

      this.platforms.push({ left, right });
    }

    // Player
    this.player = this.add
      .sprite(centerX, this.H - 100, "character")
      .setScale(1)
      .setFrame(21);

    // Click handler
    this.input.on("gameobjectdown", (pointer, obj) => {
      if (this.instructionVisible || this.gameOver) return;

      const currentPair = this.platforms[this.currentStep];
      if (obj === currentPair.left || obj === currentPair.right) {
        if (obj.safe) {
          obj.fillColor = 0x00ff00;
          this.jumpSound = this.sound.add("jump", {
            loop: false,
            volume: 1,
          });
          this.jumpSound.play();
          // 👇 Set jump frame based on side
          const jumpFrame = obj === currentPair.left ? 19 : 20;
          console.log("Setting frame to:", jumpFrame);

          this.player.setFrame(jumpFrame);

          this.sys.tweens.add({
            targets: this.player,
            x: obj.x,
            y: obj.y - 40,
            duration: 300,
            onComplete: () => {
              this.currentStep++;
              this.player.setFrame(1); // 👈 Back to standing frame after jump
              if (this.currentStep >= this.STEP_COUNT) this.winGame();
            },
          });
        } else {
          obj.fillColor = 0xff0000;
          this.gameover = this.sound.add("gameover", {
            loop: false,
            volume: 1,
          });
          this.gameover.play();
          this.sys.tweens.add({
            targets: this.player,
            alpha: 0,
            duration: 500,
            onComplete: () => this.loseGame(),
          });
        }
      }
    });
    this.showInstructions();
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
        "Tap a platform to jump forward.\nEach step has one safe and one fake glass tile — only one will hold your weight! Choose wisely and reach the top before time runs out. One wrong step, and it's game over! 💥",
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

  startGame() {
    this.instructionVisible = false;
    if (this.htpOverlay) this.htpOverlay.destroy();
    this.scorebar = this.add.image(this.W / 2, 90, "scorebar").setDepth(10);

    this.timerText = this.add
      .text(this.W / 2, 90, `Time: ${this.timeLeft}s`, {
        fontSize: "60px",
        fill: "#FFFFFF",
        fontFamily: "Outfit",
        stroke: "#000000",
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(11);
    this.timerEvent = this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        if (this.gameOver) return;
        this.timeLeft--;
        this.timerText.setText(`Time: ${this.timeLeft}s`);
        if (this.timeLeft <= 0) this.loseGame();
      },
    });
  }

  update() { }

  winGame() {
    this.gameOver = true;
    this.timerEvent.remove();
    this.bgm?.stop();
    this.levelCompleted = this.sound.add("levelCompleted", {
      loop: false,
      volume: 0.5,
    });
    this.levelCompleted.play();
    const gameOverBox = this.add.image(540, 820, "level_complete").setDepth(10);
    const buttonY = 1170;
    const buttonSpacing = 240;
    const blur = this.add
      .rectangle(0, 0, 1080, 1920, 0x000000, 0.5)
      .setOrigin(0)
      .setDepth(9);
    console.log("Blur created:", blur);

    const ttScore = this.add
      .text(310, 820, "Steps Crossed", {
        font: "60px Outfit",
        color: "#FFFFFF",
      })
      .setOrigin(0.5)
      .setDepth(11);

    const ttScoreYour = this.add
      .text(870, 830, `${this.currentStep}`, {
        font: "60px Outfit",
        color: "#FFFFFF",
      })
      .setOrigin(0.5)
      .setDepth(11);

    const yourScore = this.add
      .text(250, 980, "Time Left", {
        font: "60px Outfit",
        color: "#FFFFFF",
      })
      .setOrigin(0.5)
      .setDepth(11);

    const yourUserScore = this.add
      .text(870, 980, `${this.timeLeft}`, {
        font: "60px Outfit",
        color: "#FFFFFF",
      })
      .setOrigin(0.5)
      .setDepth(11);
    const replayButton = this.add
      .image(540 - buttonSpacing, buttonY, "replay")
      .setInteractive()
      .setDepth(10);

    const nextButton = this.add
      .image(540 + buttonSpacing, buttonY, "next")
      .setInteractive()
      .setDepth(10);

    replayButton.on("pointerdown", () => {
      if (this.gameover && this.gameover.isPlaying) this.gameover.stop();
      if (this.levelCompleted && this.levelCompleted.isPlaying)
        this.levelCompleted.stop();
      blur.destroy();
      gameOverBox.destroy();
      yourScore.destroy();
      ttScore.destroy();
      nextButton.destroy();

      yourUserScore.destroy();
      ttScoreYour.destroy();
      replayButton.destroy();
      this.scene.restart();
    });

    nextButton.on("pointerdown", () => {
      if (this.gameover && this.gameover.isPlaying) this.gameover.stop();
      if (this.levelCompleted && this.levelCompleted.isPlaying)
        this.levelCompleted.stop();
      blur.destroy();
      gameOverBox.destroy();
      yourScore.destroy();
      ttScore.destroy();
      nextButton.destroy();

      yourUserScore.destroy();
      ttScoreYour.destroy();
      replayButton.destroy();
      this.notifyParent('sceneComplete', { result: 'win' })
    });
  }

  notifyParent(type, data) {
    if (window.parent !== window) {
      window.parent.postMessage({ type, ...data }, "*");
    }
  }

  loseGame() {
    this.gameOver = true;
    this.timerEvent.remove();
    this.bgm?.stop();
    const blur = this.add
      .rectangle(0, 0, 1080, 1920, 0x000000, 0.5)
      .setOrigin(0)
      .setDepth(9);
    console.log("Blur created:", blur);
    const gameOverBox = this.add.image(540, 820, "game_over").setDepth(10);
    const ttScore = this.add
      .text(310, 820, "Steps Crossed", {
        font: "60px Outfit",
        color: "#FFFFFF",
      })
      .setOrigin(0.5)
      .setDepth(11);

    const ttScoreYour = this.add
      .text(870, 830, `${this.currentStep}`, {
        font: "60px Outfit",
        color: "#FFFFFF",
      })
      .setOrigin(0.5)
      .setDepth(11);

    const yourScore = this.add
      .text(250, 980, "Time Left", {
        font: "60px Outfit",
        color: "#FFFFFF",
      })
      .setOrigin(0.5)
      .setDepth(11);

    const yourUserScore = this.add
      .text(870, 980, `${this.timeLeft}`, {
        font: "60px Outfit",
        color: "#FFFFFF",
      })
      .setOrigin(0.5)
      .setDepth(11);
    const restartButton = this.add
      .image(540, 1170, "replay_level")
      .setInteractive()
      .setDepth(10);

    restartButton.on("pointerdown", () => {
      if (this.gameover && this.gameover) this.gameover.stop();
      blur.destroy();
      gameOverBox.destroy();
      yourScore.destroy();
      ttScore.destroy();
      yourUserScore.destroy();
      ttScoreYour.destroy();
      restartButton.destroy();
      this.scene.restart();
    });
  }
}
