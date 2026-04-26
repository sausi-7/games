// --- Config ---
let GAME_CONFIG = {};


// --- Main Game Class ---
export default class MainScene extends Phaser.Scene {
  constructor() {
    super('MainScene');
    Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach(fn => {
      if (typeof this[fn] === 'function') {
        this[fn] = this[fn].bind(this);
      }
    });
    this.score = 0;
    this.missed = 0;
    this.remaining = GAME_CONFIG.targetCount;
    this.timeLeft = GAME_CONFIG.gameTime;
    this.target = null;
    this.targetTimer = null;
    this.gameActive = false;
    this.timerEvent = null;
    this.uiScore = null;
    this.uiTime = null;
    this.uiMiss = null;
    this.menuGroup = null;
    this.endGroup = null;
    this.uiTarget = null;
    this.images = {};
    this.bgSprite = null;
    this.bgmSound = null;

  }

  preload() {
    const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));
    this.load.json('gameConfig', `${basePath}/config.json`);

    this.load.once('filecomplete-json-gameConfig', () => {
      const config = this.cache.json.get('gameConfig');
      this.images = config.images || {};

      // ✅ Dynamically load bg if present
      if (config.images1) {
        Object.entries(config.images1).forEach(([key, url]) => {
          this.load.image(key, `${basePath}/${url}`);
        });
      }
      if (config.images2) {
        Object.entries(config.images2).forEach(([key, url]) => {
          this.load.image(key, `${basePath}/${url}`);
        });
      }
      if (config.ui) {
        Object.entries(config.ui).forEach(([key, url]) => {
          this.load.image(key, `${basePath}/${url}`);
        });
      }
      this.load.audio('bgm', `${basePath}/assets/bgm.mp3`);



      this.load.start(); // Manually start loading images after config
    });
  }



  create() {



    const json = this.cache.json.get('gameConfig');
    const m = json.mechanics || {};

    GAME_CONFIG = {
      targetCount: m.targetCount ?? 20,
      gameTime: m.gameTime ?? 30,
      targetShape: m.targetShape ?? "circle",
      targetColor: parseInt(m.targetColor ?? "0x26e6b7"),
      backgroundColor: parseInt(m.backgroundColor ?? "0x111827"),
      missLimit: m.missLimit ?? 5,
      targetRadius: m.targetRadius ?? 35,
      targetLifetime: m.targetLifetime ?? 1500,
      uiColor: m.uiColor ?? "#FFF"
    };


    this.add.image(540, 960, 'background')
    // reset all core variables
    this.score = 0;
    this.missed = 0;
    this.remaining = GAME_CONFIG.targetCount;
    this.timeLeft = GAME_CONFIG.gameTime;
    this.target = null;
    this.targetTimer = null;
    this.gameActive = false;


    // this.sys.cameras.main.setBackgroundColor(GAME_CONFIG.backgroundColor);
    const w = this.sys.cameras.main.width;
    const h = this.sys.cameras.main.height;

    // Create a group for menu elements
    this.menuGroup = this.add.group();

    // Title
    const title = this.add.image(w / 2, h / 2 - 50, 'htpbox').setOrigin(0.5);
    this.menuGroup.add(title);

    // Subtitle
    const subtitle = this.add.text(w / 2, h / 2, "Tap the targets to score and reach\nthe goal within the given time.", {
      font: "50px outfit", color: "white"
    }).setOrigin(0.5);
    this.menuGroup.add(subtitle);

    // Start Button (rectangle)
    const btn = this.add.image(w / 2, h / 2 + 600, 'playbtn')
      .setInteractive({ useHandCursor: true });
    this.menuGroup.add(btn);

    // Start Button Label
    // const btnText = this.add.text(w / 2, h / 2 + 100, "START", {
    //   font: "32px", color: "#fff", 
    // }).setOrigin(0.5);
    // this.menuGroup.add(btnText);

    // Button Interaction
    btn.on('pointerdown', () => {
      this.menuGroup.clear(true, true); // ✅ Destroys all menu UI elements
      this.startGame();
    });
  }


  // --- Game Scene ---
  startGame() {
    this.createUI();

    if (!this.bgmSound) {
      this.bgmSound = this.sound.add('bgm', { loop: true });
    }
    this.bgmSound.play();

    this.timerEvent = this.time.addEvent({
      delay: 1000,
      callback: this.tick,
      callbackScope: this,
      loop: true
    });

    this.spawnNextTarget();
    this.gameActive = true;
  }


  createUI() {
    const w = this.sys.cameras.main.width;

    // ✅ Destroy old UI text if restarting
    if (this.uiScore) this.uiScore.destroy();
    if (this.uiTime) this.uiTime.destroy();
    if (this.uiMiss) this.uiMiss.destroy();
    if (this.uiTarget) this.uiTarget.destroy();

    this.scorebar = this.add.image(540, 50, 'scorebar')
    this.scorebar1 = this.add.image(540, 150, 'scorebar')

    this.uiScore = this.add.text(70, 45, `Score: 0`, {
      font: "50px outfit", color: GAME_CONFIG.uiColor,
    }).setOrigin(0, 0.5);

    this.uiTime = this.add.text(w / 2, 45, `Time: ${GAME_CONFIG.gameTime}`, {
      font: "50px outfit", color: GAME_CONFIG.uiColor,
    }).setOrigin(0.5, 0.5);

    this.uiMiss = this.add.text(w - 70, 45, `Missed: 0 / ${GAME_CONFIG.missLimit}`, {
      font: "50px outfit", color: GAME_CONFIG.uiColor,
    }).setOrigin(1, 0.5);

    // ✅ New: Targets remaining
    this.uiTarget = this.add.text(w / 2, 150, `Target: ${this.remaining}`, {
      font: "50px outfit", color: GAME_CONFIG.uiColor,
    }).setOrigin(0.5, 0.5);
  }



  spawnNextTarget() {
    // ✅ Prevent overlapping targets and timers
    if (this.target) this.target.destroy();
    if (this.targetTimer) this.targetTimer.remove();

    if (this.uiTarget) this.uiTarget.setText(`Target: ${this.remaining}`);



    const w = this.sys.cameras.main.width;
    const h = this.sys.cameras.main.height;
    const margin = GAME_CONFIG.targetRadius + 10;
    const minY = 80 + margin;
    const maxY = h - margin;
    const minX = margin;
    const maxX = w - margin;

    const x = Phaser.Math.Between(minX, maxX);
    const y = Phaser.Math.Between(minY, maxY);

    this.target = this.add.image(x, y, 'enemy')
      .setDisplaySize(GAME_CONFIG.targetRadius * 2, GAME_CONFIG.targetRadius * 2)
      .setInteractive({ useHandCursor: true });


    // ✅ Inside this: also cancel the timer when tapped
    this.target.once('pointerdown', () => {
      if (!this.gameActive) return;

      this.score++;
      this.uiScore.setText(`Score: ${this.score}`);
      this.remaining--;
      this.uiTarget.setText(`Target: ${this.remaining}`);
      this.target.destroy();

      if (this.targetTimer) this.targetTimer.remove();

      if (this.remaining <= 0) {
        this.endGame(true);
      } else {
        this.spawnNextTarget();
      }
    });

    // If not tapped in time, count as missed
    this.targetTimer = this.time.delayedCall(GAME_CONFIG.targetLifetime, () => {
      if (!this.gameActive) return;

      if (this.target) this.target.destroy();

      this.missed++;
      this.uiMiss.setText(`Missed: ${this.missed} / ${GAME_CONFIG.missLimit}`);

      if (this.missed >= GAME_CONFIG.missLimit) {
        this.endGame(false);
      } else {
        this.spawnNextTarget(); // try again, same remaining target count
      }
    });
  }


  tick() {
    if (!this.gameActive) return;
    this.timeLeft--;
    this.uiTime.setText(`Time: ${this.timeLeft}`);
    if (this.timeLeft <= 0) this.endGame(false);
  }
  notifyParent(type, data) {
    if (window.parent !== window) {
      window.parent.postMessage({ type, ...data }, "*");
    }
  }

  endGame(won) {
    this.gameActive = false;
    if (this.target) this.target.destroy();
    if (this.targetTimer) this.targetTimer.remove();
    if (this.timerEvent) this.timerEvent.remove();

    // ✅ Stop BGM on game end
    if (this.bgmSound) {
      this.bgmSound.stop();
    }

    this.time.delayedCall(600, () => {
      this.showEndScreen({
        won,
        score: this.score,
        missed: this.missed
      });
    });
  }

  // --- End Scene ---
  showEndScreen(data) {
    const w = this.sys.cameras.main.width;
    const h = this.sys.cameras.main.height;

    this.endGroup = this.add.group();

    const won = data.won;

    const boxKey = won ? 'lvlbox' : 'ovrbox';
    const message = won ? 'YOU WIN!' : 'Try Again!';

    // Background box
    const box = this.add.image(w / 2, h / 2, boxKey).setOrigin(0.5);
    this.endGroup.add(box);

    // Main message
    const msgText = this.add.text(w / 2, h / 2 - 50, message, {
      font: "50px outfit",
      color: "#ffffff"
    }).setOrigin(0.5);
    this.endGroup.add(msgText);

    // Score + Missed display
    const resultText = this.add.text(w / 2, h / 2 + 50,
      `Score: ${data.score}\nMissed: ${data.missed}`,
      {
        font: "50px outfit",
        color: "#ffffff",
        align: "center"
      }
    ).setOrigin(0.5);
    this.endGroup.add(resultText);

    if (won) {
      // --- Replay button for WIN ---
      const replayKeyWin = 'replay_level';
      const replayBtnWin = this.add.image(w / 2 + 230, h / 2 + 340, replayKeyWin)
        .setInteractive({ useHandCursor: true });
      this.endGroup.add(replayBtnWin);

      replayBtnWin.on('pointerdown', () => {
        this.endGroup.clear(true, true);
        this.resetGame();
      });

      // --- Next button ---
      const nextBtn = this.add.image(w / 2 - 230, h / 2 + 340, 'next')
        .setInteractive({ useHandCursor: true });
      this.endGroup.add(nextBtn);

      nextBtn.on('pointerdown', () => {
        this.notifyParent('sceneComplete', { result: 'win' });
      });

    } else {
      // --- Replay button for GAME OVER ---
      const replayKeyLose = 'replay';
      const replayBtnLose = this.add.image(w / 2, h / 2 + 350, replayKeyLose)
        .setInteractive({ useHandCursor: true });
      this.endGroup.add(replayBtnLose);

      replayBtnLose.on('pointerdown', () => {
        this.endGroup.clear(true, true);
        this.resetGame();
      });
    }
  }


  resetGame() {
    // Reset variables
    this.score = 0;
    this.missed = 0;
    this.remaining = GAME_CONFIG.targetCount;
    this.timeLeft = GAME_CONFIG.gameTime;
    this.uiScore.setText("Score: 0");
    this.uiMiss.setText("Missed: 0");
    this.uiTime.setText(`Time: ${this.timeLeft}`);
    if (this.uiTarget) this.uiTarget.setText(`Target: ${GAME_CONFIG.targetCount}`);
    this.startGame();
  }

}
