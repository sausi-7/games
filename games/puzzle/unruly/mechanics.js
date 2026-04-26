export default class UnrulyScene extends Phaser.Scene {
  constructor() {
    super("UnrulyScene");
    Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach((fn) => {
      if (typeof this[fn] === "function") this[fn] = this[fn].bind(this);
    });
  }

  preload() {
    const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));
    this.load.json('levelConfig', `${basePath}/config.json`);

    this.load.once('filecomplete-json-levelConfig', () => {
      const cfg = this.cache.json.get('levelConfig') || {};
      const spritesheets = cfg.spritesheets || {};
      const eveData = spritesheets.player || {};

      // 👇 Check for "main" param from URL
      const rawMain = new URLSearchParams(window.location.search).get('main') || '';
      const cleanMain = rawMain.replace(/^"|"$/g, ''); // strip quotes if present

      const sheetUrl = cleanMain
        ? cleanMain // use URL param if provided
        : eveData.path
          ? `${basePath}/${eveData.path}` // fallback to config
          : `${basePath}/assets/eve_spritesheet.png`; // final fallback

      const frameW = eveData.frameWidth || 102;
      const frameH = eveData.frameHeight || 158;

      this.load.spritesheet('player', sheetUrl, {
        frameWidth: frameW,
        frameHeight: frameH,
      });

      // Load other assets
      if (cfg.images2) {
        Object.entries(cfg.images2).forEach(([key, url]) => {
          this.load.image(key, `${basePath}/${url}`);
        });
      }

      if (cfg.ui) {
        Object.entries(cfg.ui).forEach(([key, url]) => {
          this.load.image(key, `${basePath}/${url}`);
        });
      }
      if (cfg.audio) {
        Object.entries(cfg.audio).forEach(([key, url]) => {
          this.load.audio(key, `${basePath}/${url}`);
        });
      }
    });
  }



  create() {
    const cfg = this.cache.json.get("levelConfig") || {};
    const images = cfg.images || {};
    const sheets = cfg.spritesheets || {};
    const mechanics = cfg.mechanics || {};
    const events = cfg.events || [];

    const GAME_WIDTH = cfg.orientation?.width || 1080;
    const GAME_HEIGHT = cfg.orientation?.height || 1920;

    this.bgm = this.sound.add('bgm', { loop: true, volume: 0.3 })
    this.bgm.play();


    const STATS = [
      { key: "gold", color: 0xffe066, label: "Gold" },
      { key: "popularity", color: 0x59caff, label: "Popularity" },
      { key: "ego", color: 0xfd69a7, label: "Royal Ego" },
      { key: "chaos", color: 0xb086f7, label: "Chaos" }
    ];

    this.GAME_WIDTH = GAME_WIDTH;
    this.GAME_HEIGHT = GAME_HEIGHT;
    this.STATS = STATS;
    this.STAT_MIN = mechanics.statMin ?? 0;
    this.STAT_MAX = mechanics.statMax ?? 10;
    this.CHOICES_TO_WIN = mechanics.choicesToWin ?? 20;
    this.EVENTS = events;

    this.sys.cameras.main.setBackgroundColor(0xf5f3e8);
    if (images.bg) {
      this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'background')
        .setDisplaySize(GAME_WIDTH, GAME_HEIGHT)
        .setDepth(-1);
    }

    this.stats = { gold: 5, popularity: 5, ego: 5, chaos: 5 };
    this.dilemmasSolved = 0;
    this.isGameOver = false;
    this.eventDeck = Phaser.Utils.Array.Shuffle([...this.EVENTS]);
    this.statBars = [];
    this.statTexts = [];

    // Title
    // this.add.text(GAME_WIDTH / 2, 60, "Unruly-Ruly", {
    //   fontFamily: "Arial Black", fontSize: 74, color: "#ab0088"
    // }).setOrigin(0.5);

    // Stat bars
    let barWidth = 200, barHeight = 32, spacing = 40;
    let totalWidth = STATS.length * barWidth + (STATS.length - 1) * spacing;
    let startX = GAME_WIDTH / 2 - totalWidth / 2 + barWidth / 2;
    for (let i = 0; i < STATS.length; i++) {
      let x = startX + i * (barWidth + spacing);
      // this.add.rectangle(x, 170, barWidth, barHeight, 0xe9e9e9).setOrigin(0.5);
      // let fg = this.add.rectangle(x, 75, barWidth * (this.stats[STATS[i].key] / this.STAT_MAX), barHeight, STATS[i].color).setOrigin(0.5, 0.5).setDepth(10);
      // this.statBars.push(fg);
      this.add.text(x, 40, STATS[i].label, {
        fontFamily: 'outfit', fontSize: 26, color: "#ffffff"
      }).setOrigin(0.5).setDepth(10);
      let t = this.add.text(x, 75, this.stats[STATS[i].key], {
        fontFamily: 'outfit', fontSize: 28, color: "#ffffff"
      }).setOrigin(0.5).setDepth(10);
      this.statTexts.push(t);
    }

    // Monarch (Eve)
    if (sheets.player) {
      this.anims.create({
        key: 'idle',
        frames: this.anims.generateFrameNumbers('player', { start: 18, end: 18 }),
        frameRate: 5,
        repeat: -1
      });
      this.monarch = this.add.sprite(GAME_WIDTH / 2, GAME_HEIGHT - 160, 'player').setOrigin(0.5);
      this.monarch.setScale(2);
      this.monarch.play('idle');
    }

    this.createUI();
    this.showNextEvent();
    this.showInstructions();
  }

  createUI() {

    this.textBox = this.add.image(540, 60, 'scorebar')
      .setScrollFactor(0)
      .setDepth(9)
      .setScale(1)
      .setOrigin(0.5);
  }

  showNextEvent() {
    if (this.eventCard) this.eventCard.destroy();
    if (this.dilemmasSolved >= this.CHOICES_TO_WIN) return this.showEndScreen(true);
    if (this.eventDeck.length === 0) this.eventDeck = Phaser.Utils.Array.Shuffle([...this.EVENTS]);
    this.currentEvent = this.eventDeck.pop();
    this.dilemmasSolved++;

    let cardW = 800, cardH = 600;
    this.eventCard = this.add.container(this.GAME_WIDTH / 2, 520 + cardH / 2);
    let bg = this.add.rectangle(0, 0, cardW, cardH, 0xffffff).setStrokeStyle(7, 0xdac888).setOrigin(0.5);
    let advCirc = this.add.circle(0, -cardH / 2 + 100, 80, 0xefd988).setStrokeStyle(4, 0x666);
    let advInitials = this.add.text(0, -cardH / 2 + 100, this.currentEvent.advisor.split(" ").map(w => w[0]).join(""), {
      fontSize: 60, color: "#222", fontFamily: "outfit"
    }).setOrigin(0.5);
    let dilemmaText = this.add.text(0, -cardH / 2 + 200, this.currentEvent.text, {
      fontFamily: "outfit", fontSize: 34, color: "#222", align: "center", wordWrap: { width: cardW - 60 }
    }).setOrigin(0.5, 0);

    let btns = [], btnY = 100, btnH = 100, btnGap = 32;
    this.currentEvent.choices.forEach((choice, i) => {
      let btn = this.createChoiceButton(0, btnY + i * (btnH + btnGap), cardW - 120, btnH, choice.text, () => {
        if (this.isGameOver) return;
        this.handleChoice(choice.effects);
      });
      btns.push(btn);
    });

    this.eventCard.add([bg, advCirc, advInitials, dilemmaText, ...btns]);
  }

  createChoiceButton(x, y, w, h, label, cb) {
    let grp = this.add.container(x, y);
    let btnBg = this.add.rectangle(0, 0, w, h, 0xf8e7d3).setStrokeStyle(5, 0xa98754).setOrigin(0.5);
    btnBg.setInteractive({ useHandCursor: true });
    btnBg.on('pointerdown', () => cb && cb());
    let btnText = this.add.text(0, 0, label, {
      fontFamily: "Comic Sans MS, Arial", fontSize: 32, color: "#79412b", align: "center", wordWrap: { width: w - 30 }
    }).setOrigin(0.5);
    grp.add([btnBg, btnText]);
    return grp;
  }

  handleChoice(effects) {
    for (let k in effects) {
      if (this.stats[k] !== undefined) {
        this.stats[k] += effects[k];
        if (this.stats[k] > this.STAT_MAX) this.stats[k] = this.STAT_MAX;
        if (this.stats[k] < this.STAT_MIN) this.stats[k] = this.STAT_MIN;
      }
    }
    this.updateStatBars();
    if (Object.values(this.stats).some(val => val === this.STAT_MIN || val === this.STAT_MAX)) return this.showEndScreen(false);
    this.time.delayedCall(500, () => this.showNextEvent());
  }

  updateStatBars() {
    for (let i = 0; i < this.STATS.length; i++) {
      let key = this.STATS[i].key;
      // this.statBars[i].width = 200 * (this.stats[key] / this.STAT_MAX);
      this.statTexts[i].setText(this.stats[key]);
    }
  }

  showEndScreen(won) {
    this.isGameOver = true;
    if (this.eventCard) this.eventCard.destroy();

    this.winGame(won);

    // let overlay = this.add.rectangle(this.GAME_WIDTH / 2, this.GAME_HEIGHT / 2, this.GAME_WIDTH, this.GAME_HEIGHT, 0x000000, 0.7).setDepth(10);
    // let card = this.add.container(this.GAME_WIDTH / 2, this.GAME_HEIGHT / 2).setDepth(11);
    // let bg = this.add.rectangle(0, 0, 820, 680, 0xffffff).setStrokeStyle(7, 0x897a3c).setOrigin(0.5);

    // let msg = won
    //   ? "🎉 You Rule! 🎉\nSurvived 20 days of silliness.\n\nBards will sing your questionable wisdom."
    //   : "👑 Your reign is over! 👑\nA stat maxed or mined out.\n\nNobody said ruling was easy!";

    // let txt = this.add.text(0, -180, msg, {
    //   fontFamily: "Comic Sans MS, Arial", fontSize: 40, color: "#222", align: "center", wordWrap: { width: 760 }
    // }).setOrigin(0.5);

    // let stats = this.add.text(0, 60,
    //   `Final Stats:\nGold: ${this.stats.gold}\nPopularity: ${this.stats.popularity}\nRoyal Ego: ${this.stats.ego}\nChaos: ${this.stats.chaos}\nProblems Solved: ${this.dilemmasSolved}`,
    //   { fontFamily: "Arial", fontSize: 34, color: "#644", align: "center" }
    // ).setOrigin(0.5);

    // let btn = this.createChoiceButton(0, 210, 350, 90, "Rule Again!", () => this.scene.restart());
    // card.add([bg, txt, stats, btn]);
    // this.sys.tweens.add({ targets: card, scale: { from: 0.7, to: 1 }, duration: 400, ease: "Back.Out" });
  }

  startGame() {
    this.instructionVisible = false;
    if (this.htpOverlay) this.htpOverlay.destroy();

    // Timer event
    // this.timerEvent = this.time.addEvent({
    //   delay: 1000,
    //   repeat: this.timerDuration - 1,
    //   callback: () => {
    //     if (this.gameOverActive) return;
    //     this.timeLeft--;
    //     this.timerText.setText(`Time Left: ${this.timeLeft}`);
    //     if (this.timeLeft <= 0) {
    //       this.gameOver();
    //     }
    //   }
    // });

    // Scorebar background image (make sure 'scorebar' is in config.images)
    // this.add.image(this.W / 2, 90, "scorebar").setDepth(10);

    // // Timer on top of scorebar
    // this.timerText.setPosition(this.W / 2 + 300, 65).setDepth(11);

    // // Score text on top of scorebar
    // this.scoreText.setPosition(this.W / 2 - 150 - 300, 65).setDepth(11);
    // if (this.timerEvent) this.timerEvent.paused = false;
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
        "Guide Ruly through tricky royal decisions! Each choice you make affects your kingdom’s fate. Read the event, pick wisely, and balance the stats to survive. Make the wrong move... and chaos awaits!",
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

  gameOver() {
    this.gameOver = true;
    // if (this.timerEvent) this.timerEvent.remove();
    this.bgm?.stop();
    // this.gameover = this.sound.add("gameover", {
    //   loop: false,
    //   volume: 1,
    // });
    // this.gameover.play();
    const blur = this.add
      .rectangle(0, 0, 1080, 1920, 0x000000, 0.5)
      .setOrigin(0)
      .setDepth(9);
    console.log("Blur created:", blur);
    const gameOverBox = this.add.image(540, 820, "game_over").setDepth(10);
    // const ttScore = this.add
    //   .text(210, 820, "Score", {
    //     font: "60px Outfit",
    //     color: "#FFFFFF",
    //   })
    //   .setOrigin(0.5)
    //   .setDepth(11);

    // const ttScoreYour = this.add
    //   .text(870, 830, `${this.score}`, {
    //     font: "60px Outfit",
    //     color: "#FFFFFF",
    //   })
    //   .setOrigin(0.5)
    //   .setDepth(11);

    const yourScore = this.add
      .text(250, 880, "Time Left", {
        font: "60px Outfit",
        color: "#FFFFFF",
      })
      .setOrigin(0.5)
      .setDepth(11);

    const yourUserScore = this.add
      .text(870, 880, `${this.timeLeft}`, {
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
      // this.gameover?.stop();

      gameOverBox.destroy();
      yourScore.destroy();
      // ttScore.destroy();
      yourUserScore.destroy();
      // ttScoreYour.destroy();
      restartButton.destroy();
      this.scene.restart();
    });
  }

  winGame(won) {
    this.gameOver = true;
    // this.timerEvent.remove();
    this.bgm.stop();
    // this.levelCompleted = this.sound.add("levelCompleted", {
    //   loop: false,
    //   volume: 0.5,
    // });
    // this.levelCompleted.play();
    const gameOverBox = this.add.image(540, 820, "level_complete").setDepth(10);
    const buttonY = 1170;
    const buttonSpacing = 240;
    const blur = this.add
      .rectangle(0, 0, 1080, 1920, 0x000000, 0.5)
      .setOrigin(0)
      .setDepth(9);
    console.log("Blur created:", blur);

    const msg = won
      ? "🎉 You Rule!.Bards will sing your questionable wisdom."
      : "👑 Your reign is over!.Nobody said ruling was easy!";

    const txt = this.add.text(540, 770, msg, {
      fontFamily: "outfit", fontSize: 40, color: "#ffffff", align: "center", wordWrap: { width: 760 }
    }).setOrigin(0.5).setDepth(15);

    const stats = this.add.text(540, 930,
      `Gold: ${this.stats.gold}\nPopularity: ${this.stats.popularity}\nRoyal Ego: ${this.stats.ego}\nChaos: ${this.stats.chaos}\nProblems Solved: ${this.dilemmasSolved}`,
      { fontFamily: "outfit", fontSize: 34, color: "#ffffff", align: "center" }
    ).setOrigin(0.5).setDepth(15);


    const replayButton = this.add
      .image(540 - buttonSpacing, buttonY, "replay")
      .setInteractive()
      .setDepth(10);

    const nextButton = this.add
      .image(540 + buttonSpacing, buttonY, "next")
      .setInteractive()
      .setDepth(10);

    replayButton.on("pointerdown", () => {
      // if (this.gameover && this.gameover.isPlaying) this.gameover.stop();
      // if (this.levelCompleted && this.levelCompleted.isPlaying)
      //   this.levelCompleted.stop();
      blur.destroy();
      gameOverBox.destroy();
      // yourScore.destroy();
      // ttScore.destroy();
      // yourUserScore.destroy();
      txt.destroy();
      stats.destroy();
      nextButton.destroy();
      // ttScoreYour.destroy();
      replayButton.destroy();
      this.scene.restart();
    });

    nextButton.on("pointerdown", () => {
      // if (this.gameover && this.gameover.isPlaying) this.gameover.stop();
      // if (this.levelCompleted && this.levelCompleted.isPlaying)
      //   this.levelCompleted.stop();
      blur.destroy();
      gameOverBox.destroy();
      txt.destroy();
      stats.destroy();
      // yourScore.destroy();
      // ttScore.destroy();
      nextButton.destroy();
      // yourUserScore.destroy();
      // ttScoreYour.destroy();
      replayButton.destroy();
      this.notifyParent('sceneComplete', { result: 'win' });
    });
  }

  notifyParent(type, data) {
    if (window.parent !== window) {
      window.parent.postMessage({ type, ...data }, "*");
    }
  }
}
