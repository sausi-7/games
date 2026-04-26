export default class MechanicsScene extends Phaser.Scene {
  constructor() {
    super("MechanicsScene");

    Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach((fn) => {
      if (typeof this[fn] === "function") this[fn] = this[fn].bind(this);
    });

    //  state flags
    this.hasEnded = false;
    this.gameOver = false;
    this.instructionVisible = true;

    // event/timer handles (so we can remove them safely)
    this.secondTimerEvent = null;
    this.scoreTickEvent = null;
    this.lightWarnEvent = null;
    this.lightToggleEvent = null;

    this._startBg = null;   // HTP background
    this._winBg = null;   // Win background
    this._ovrBg = null;
  }

  preload() {
    const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf("/"));

    // allow CORS for remote assets (covers audio too)
    if (this.load.setCORS) this.load.setCORS("anonymous");

    // load config first
    this.load.json("levelConfig", `${basePath}/config.json`);

    // helper: detect absolute URL
    const isAbsolute = (p) => /^https?:\/\//i.test(p);

    this.load.once("filecomplete-json-levelConfig", () => {
      const cfg = this.cache.json.get("levelConfig") || {};

      const images = cfg.images2 || {};
      const ui = cfg.ui || {};
      const audio = cfg.audio || {};

      // Character image
      const playerPathFromJson = images.player || images.character || images.hero;
      if (playerPathFromJson) {
        const url = isAbsolute(playerPathFromJson)
          ? playerPathFromJson
          : `${basePath}/${playerPathFromJson}`;
        this.load.image("character", url);
      } else {
        this.load.image("character", `${basePath}/assets/player.png`);
      }

      // Other images
      for (const [key, urlIn] of Object.entries(images)) {
        const url = isAbsolute(urlIn) ? urlIn : `${basePath}/${urlIn}`;
        this.load.image(key, url);
      }
      for (const [key, urlIn] of Object.entries(ui)) {
        const url = isAbsolute(urlIn) ? urlIn : `${basePath}/${urlIn}`;
        this.load.image(key, url);
      }

      // Audio (supports string or array of sources)
      for (const [key, val] of Object.entries(audio)) {
        if (Array.isArray(val)) {
          const urls = val.map((u) => (isAbsolute(u) ? u : `${basePath}/${u}`));
          this.load.audio(key, urls);
        } else {
          const url = isAbsolute(val) ? val : `${basePath}/${val}`;
          this.load.audio(key, url);
        }
      }

      // IMPORTANT: start the second batch now so assets finish before create()
      this.load.start();
    });
  }


  resetState() {
    this.hasEnded = false;
    this.gameOver = false;
    this.instructionVisible = true;

    // core gameplay vars
    this.totalTime = this.totalTimeStart;
    this.score = 0;
    this.isGreen = true;

    // clear any leftover events if Phaser kept the same instance
    this.secondTimerEvent?.remove();
    this.scoreTickEvent?.remove();
    this.lightWarnEvent?.remove();
    this.lightToggleEvent?.remove();

    this.secondTimerEvent = null;
    this.scoreTickEvent = null;
    this.lightWarnEvent = null;
    this.lightToggleEvent = null;
  }

  // Toggle HUD (time, distance, light, progress bar, scorebar) visibility
  _setHUDVisible(v) {
    this.uiTimerText?.setVisible(v);
    this.uiDistanceText?.setVisible(v);
    this.timerContainer?.setVisible(v);
    this.lightContainer?.setVisible(v);
    this.scorebar?.setVisible(v);
    this.scorebar1?.setVisible(v);
    this.highScoreText?.setVisible(v);
    this.distanceText?.setVisible(v);
  }


  _getImgKeyContains(substr) {
    const imgs = Object.keys(this.config?.images2 || {});
    return imgs.find(k => k.toLowerCase().includes(substr)) || null;
  }
  _addFullBg(key, depth = 0) {
    if (!key) return null;
    const W = this.sys.game.config.width;
    const H = this.sys.game.config.height;
    return this.add.image(W / 2, H / 2, key).setDisplaySize(W, H).setDepth(depth);
  }




  create() {
    this.config = this.cache.json.get("levelConfig") || {};
    this.instructionVisible = true;

    this.gameWidth = this.sys.game.config.width;
    this.gameHeight = this.sys.game.config.height;

    // Configurable values
    this.totalTimeStart = this.config.timer || 20;
    this.playerSpeed = this.config.playerSpeed || 4;
    this.finishLineY = this.config.finishLineY || 100;
    this.playerSize = this.config.playerSize || 50;
    this.lightChangeMin = this.config.lightChangeMin || 1000;
    this.lightChangeMax = this.config.lightChangeMax || 3000;

    this.lightFontSize = this.config.fontSizes?.light || "48px";
    this.timerFontSize = this.config.fontSizes?.timer || "32px";
    this.winLoseFontSize = this.config.fontSizes?.winLose || "48px";
    this.messageBoxSize = this.config.messageBox || { width: 600, height: 300 };
    this.isGreen = true;
    this.gameOver = false;
    this.totalTime = this.totalTimeStart;
    this.score = 0;
    this.highScore = parseInt(localStorage.getItem("redLightHighScore") || "0");
    this.lightChangeWarning = false;
    this.playerStartY = this.gameHeight - 100;
    const W = this.sys.game.config.width;
    const H = this.sys.game.config.height;

    this.resetState();

    // --- background for gameplay (default) ---
    // const W = this.sys.game.config.width;
    // const H = this.sys.game.config.height;

    const mainBgKey = Object.keys(this.config.images2 || {}).find((key) =>
      key.toLowerCase().includes("background")
    );
    if (mainBgKey) {
      this.background = this.add.image(W / 2, H / 2, mainBgKey)
        .setDisplaySize(W, H)
        .setDepth(0);
    }

    // prepare BGM instance (don’t play yet)
    if (this.config.audio?.bgm && !this.bgm) {
      // avoid crash if remote audio failed CORS/URL
      if (this.cache.audio && this.cache.audio.exists("bgm")) {
        this.bgm = this.sound.add("bgm", { loop: true, volume: 0.5 });
      } else {
        console.warn('BGM not in cache yet or failed to load:', this.config.audio.bgm);
      }
    }


    // normal flow...
    this.createPlayer();
    this.createFinish();
    this.createUI();
    this.setupInput();
    // this.startGameplay();

    const skip = this.sys.settings.data?.skipInstructions;

    // If skipping instructions (Replay), start BGM and go straight to game
    if (skip && this.bgm && !this.bgm.isPlaying) {
      this.bgm.play();
    }

    if (skip) {
      this.startGame();   // ✅ this will call startGameplay()
    } else {
      this.showInstructions();
    }


  }

  createBackground() {
    // Gradient background
    const graphics = this.add.graphics();
    graphics.fillGradientStyle(0x87ceeb, 0x87ceeb, 0x98fb98, 0x98fb98);
    graphics.fillRect(0, 0, this.gameWidth, this.gameHeight);

    // Finish line with checkered pattern
    const finishLine = this.add.graphics();
    finishLine.fillStyle(0x000000);
    finishLine.fillRect(0, this.finishLineY - 5, this.gameWidth, 10);

    // Add checkered pattern
    for (let x = 0; x < this.gameWidth; x += 20) {
      const color = (x / 20) % 2 === 0 ? 0xffffff : 0x000000;
      finishLine.fillStyle(color);
      finishLine.fillRect(x, this.finishLineY - 5, 20, 10);
    }

    // Progress markers
    const totalDistance = this.playerStartY - this.finishLineY;
    for (let i = 1; i <= 4; i++) {
      const y = this.playerStartY - (totalDistance * i) / 5;
      this.add.line(0, 0, 0, y, this.gameWidth, y, 0xcccccc, 0.5).setOrigin(0);
      this.add.text(10, y - 10, `${i * 20}%`, {
        fontSize: "16px",
        color: "#666666",
        fontFamily: "Arial",
      });
    }
  }

  createFinish() {
    // Place the finish image at the finish line Y; adjust origin so its bottom sits on the line
    const x = this.gameWidth / 2;
    const y = this.finishLineY;
    this.finish = this.physics.add.staticImage(x, y + 400, "finish").setOrigin(0.5, 1).setScale(2.3, 1);

    // Optional: scale the visual without affecting the body size too oddly
    // (if your finish.png is very large/small)
    // this.finish.setDisplaySize(300, 80);

    // If you want the body to match the displayed size exactly, uncomment:
    // this.finish.refreshBody();

    // Win on overlap
    this.physics.add.overlap(this.player, this.finish, () => {
      if (!this.hasEnded) {
        const timeBonus = this.totalTime * 10;
        this.score += timeBonus;
        this.endGame(true, `🎉 You Win!\nFinal Score: ${this.score}`);
      }
    });
  }




  createPlayer() {
    this.playerShadow = this.add.ellipse(
      this.gameWidth / 2 + 3,
      this.playerStartY + 3,
      this.playerSize * 0.8,
      this.playerSize * 0.3,
      0x000000,
      0.3
    );

    // Use an IMAGE instead of a sprite/spritesheet
    this.player = this.add
      .image(this.gameWidth / 2, this.playerStartY, "character")
      .setDisplaySize(this.playerSize + 100, this.playerSize + 140);

    // No animations; remove anims.create / play calls

    // Keep physics
    this.physics.add.existing(this.player);
    this.player.body.setAllowGravity(false);
    this.player.body.setCollideWorldBounds(true);

    this.movementParticles = this.add.particles(0, 0, "white", {
      speed: { min: 20, max: 40 },
      scale: { start: 0.3, end: 0 },
      lifespan: 300,
      emitting: false,
    });
  }


  createUI() {
    // Light indicator with pulsing effect
    this.lightContainer = this.add.container(this.gameWidth / 2, 50);
    // Scorecard background
    this.scorebar = this.add.image(this.gameWidth / 2 - 350, 90, "scorebar").setDepth(10);
    this.scorebar1 = this.add.image(this.gameWidth / 2 + 370, 90, "scorebar").setDepth(10);

    // Time Left
    this.uiTimerText = this.add
      .text(100, 65, `Time: ${this.totalTime}s`, {
        fontSize: "42px",
        fill: "#050404ff",
        fontFamily: "Outfit"

      })
      .setDepth(11);

    // Distance Covered
    this.uiDistanceText = this.add
      .text(this.gameWidth - 100, 65, `Dist: 0`, {
        fontSize: "42px",
        fill: "#0a0808ff",
        fontFamily: "Outfit",

      })
      .setOrigin(1, 0)
      .setDepth(11);

    this.lightBg = this.add.circle(0, 150, 60, 0x333333);
    this.lightText = this.add
      .text(0, 150, "🟢", {
        fontSize: "60px",
        fontFamily: "Outift",
      })
      .setOrigin(0.5);

    this.lightLabel = this.add
      .text(0, 240, "GREEN LIGHT", {
        fontSize: "30px",
        color: "#008000",
        fontFamily: "Outfit",
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    this.lightContainer.add([this.lightBg, this.lightText, this.lightLabel]);

    // Warning indicator
    this.warningText = this.add
      .text(this.gameWidth / 2, 350, "⚠️ CHANGING SOON!", {
        fontSize: "30px",
        color: "#ff6600",
        fontFamily: "Outfit",
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setVisible(false);

    // Enhanced timer with progress bar
    this.timerContainer = this.add.container(this.gameWidth / 2, 400);

    this.timerBg = this.add
      .rectangle(0, 0, 400, 40, 0x333333)
      .setStrokeStyle(2, 0x666666);
    this.timerProgress = this.add.rectangle(-95, 0, 190, 36, 0x00aa00);
    this.timerText = this.add
      .text(0, 0, `⏱️ ${this.totalTime}s`, {
        fontSize: this.timerFontSize,
        color: "#ffffff",
        fontFamily: "Outfit",
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    this.timerContainer.add([this.timerBg, this.timerProgress, this.timerText]);

    this.highScoreText = this.add.text(20, 50, ``, {
      fontSize: "20px",
      color: "#666",
      fontFamily: "Outfit",
    });

    // Distance indicator
    this.distanceText = this.add
      .text(this.gameWidth - 20, 20, "", {
        fontSize: "20px",
        color: "#000",
        fontFamily: "Outfit",
      })
      .setOrigin(1, 0);
  }

  setupInput() {
    this.touchActive = false;
    this.moveKey = this.input.keyboard.addKey(
      Phaser.Input.Keyboard.KeyCodes.SPACE
    );

    // Enhanced input feedback
    this.input.on("pointerdown", () => {
      this.touchActive = true;
      // this.player.setTint(0xffffff);
    });

    this.input.on("pointerup", () => {
      this.touchActive = false;
      // this.player.clearTint();
    });

    // Keyboard feedback
    this.input.keyboard.on("keydown-SPACE", () => {
      this.player.setTint(0xffffff);
    });

    this.input.keyboard.on("keyup-SPACE", () => {
      this.player.clearTint();
    });
  }

  startGameplay() {
    this.scheduleNextLightChange();

    this.secondTimerEvent = this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        if (!this.gameOver && !this.instructionVisible) {
          this.totalTime--;
          this.updateTimer();
          if (this.totalTime <= 0) {
            this.endGame(false, "⏰ Time's up!");
          }
        }
      },
    });

    this.scoreTickEvent = this.time.addEvent({
      delay: 100,
      loop: true,
      callback: () => {
        if (!this.gameOver && !this.instructionVisible && this.player.y < this.playerStartY - 10) {
          this.score = Math.max(this.score, Math.floor((this.playerStartY - this.player.y) / 5));
        }
      },
    });
  }


  scheduleNextLightChange() {
    const delay = Phaser.Math.Between(this.lightChangeMin, this.lightChangeMax);

    // cancel old warning/toggle if still around
    this.lightWarnEvent?.remove();
    this.lightToggleEvent?.remove();

    this.lightWarnEvent = this.time.delayedCall(Math.max(0, delay - 1000), () => {
      if (!this.gameOver) this.showLightWarning();
    });

    this.lightToggleEvent = this.time.delayedCall(delay, () => {
      if (!this.gameOver) {
        this.toggleLight();
        this.scheduleNextLightChange();
      }
    });
  }


  showLightWarning() {
    this.warningText.setVisible(true);
    this.lightContainer.setScale(1.1);

    // Pulse effect
    this.sys.tweens.add({
      targets: this.warningText,
      alpha: { from: 1, to: 0.3 },
      duration: 250,
      yoyo: true,
      repeat: 3,
    });

    this.time.delayedCall(1000, () => {
      this.warningText.setVisible(false);
      this.lightContainer.setScale(1);
    });
  }

  toggleLight() {
    this.isGreen = !this.isGreen;

    if (this.isGreen) {
      this.lightText.setText("🟢");
      this.lightLabel.setText("GREEN LIGHT").setColor("#008000");
      this.lightBg.setFillStyle(0x004400);
    } else {
      this.lightText.setText("🔴");
      this.lightLabel.setText("RED LIGHT").setColor("#aa0000");
      this.lightBg.setFillStyle(0x440000);
    }

    // Screen flash effect
    const flash = this.add.rectangle(
      this.gameWidth / 2,
      this.gameHeight / 2,
      this.gameWidth,
      this.gameHeight,
      this.isGreen ? 0x00ff00 : 0xff0000,
      0.2
    );

    this.sys.tweens.add({
      targets: flash,
      alpha: 0,
      duration: 200,
      onComplete: () => flash.destroy(),
    });

    // Sound effect simulation with screen shake
    this.sys.cameras.main.shake(100, 0.005);
  }

  updateTimer() {
    this.timerText.setText(`⏱️ ${this.totalTime}s`);

    // Update progress bar
    const progress = this.totalTime / this.totalTimeStart;
    const width = 190 * progress;
    this.timerProgress.setSize(width, 36);
    this.timerProgress.x = -95 + (190 - width) / 2;

    // Change color based on time remaining
    if (progress > 0.5) {
      this.timerProgress.setFillStyle(0x00aa00);
    } else if (progress > 0.25) {
      this.timerProgress.setFillStyle(0xffaa00);
    } else {
      this.timerProgress.setFillStyle(0xaa0000);
    }

    // Pulse effect when time is low
    if (this.totalTime <= 5) {
      this.timerContainer.setScale(1.1);
      this.sys.tweens.add({
        targets: this.timerContainer,
        scaleX: 1,
        scaleY: 1,
        duration: 200,
      });
    }
    if (this.uiTimerText) {
      this.uiTimerText.setText(`Time: ${this.totalTime}s`);
    }
  }

  update() {
    if (this.gameOver || this.instructionVisible) return;

    const moving = this.moveKey?.isDown || this.touchActive;

    if (moving) {
      if (!this.isGreen) {
        this.endGame(false, "🚫 Caught moving on red!");
      } else {
        this.player.y -= this.playerSpeed;
        this.playerShadow.y = this.player.y + 3;

        // Movement particles
        this.movementParticles.setPosition(this.player.x, this.player.y + 25);
        this.movementParticles.start();
        if (this.uiDistanceText) {
          this.uiDistanceText.setText(`Dist: ${Math.floor(this.score)}`);
        }
        // Player animation
        this.player.angle = Math.sin(this.time.now * 0.01) * 2;
      }
    } else {
      this.movementParticles.stop();
      this.player.angle = 0;
    }

    // Update distance indicator
    const totalDistance = this.playerStartY - this.finishLineY;
    const currentDistance = this.playerStartY - this.player.y;
    const percentage = Math.max(
      0,
      Math.floor((currentDistance / totalDistance) * 100)
    );

    // Check for win condition
    // if (this.player.y <= this.finishLineY + 10) {
    //   const timeBonus = this.totalTime * 10;
    //   this.score += timeBonus;
    //   this.endGame(true, `🎉 You Win!\nFinal Score: ${this.score}`);
    // }
  }

  showInstructions() {
    this.instructionVisible = true;

    this._setHUDVisible(false);

    // Hide gameplay background while HTP is up (optional)
    if (this.background) this.background.setVisible(false);

    // HTP background (key like "htpbg", or any key containing "htpbg")
    const htpKey = this._getImgKeyContains("htpbg");
    if (this._startBg) { this._startBg.destroy(); this._startBg = null; }
    this._startBg = this._addFullBg(htpKey || null, 5); // depth under overlay if you want

    // Start BGM now (plays across game and win/lose; only restart on Replay)
    if (this.bgm && !this.bgm.isPlaying) {
      this.bgm.play();
    }

    this.htpOverlay = this.add.container(0, 0).setDepth(10);

    this.blur = this.add
      .rectangle(0, 0, 1080, 1920, 0x000000, 0.5)
      .setOrigin(0);
    this.howToPlayBox = this.add.image(540, 820, "htp").setScale(0.55, 0.8);
    this.howToPlayBox1 = this.add.image(770, 750, "character").setScale(0.3);

    this.descriptionText = this.add.text(
      540,
      580,
      "How to play",
      {
        font: "70px Outfit",
        color: "#ffffff",
        wordWrap: { width: 800, useAdvancedWrap: true },
      }
    ).setOrigin(0.5);
    this.descriptionText1 = this.add.text(
      380,
      720,
      "Hold screen to move:",
      {
        font: "60px Outfit",
        color: "#ffffff",
        wordWrap: { width: 800, useAdvancedWrap: true },
      }
    ).setOrigin(0.5);

    this.descriptionText2 = this.add.text(
      380,
      880,
      "Stop on red light.",
      {
        font: "60px Outfit",
        color: "#ffffff",
        wordWrap: { width: 800, useAdvancedWrap: true },
      }
    ).setOrigin(0.5);

    this.descriptionText3 = this.add.text(
      380,
      1000,
      "Move on green light.",
      {
        font: "60px Outfit",
        color: "#ffffff",
        wordWrap: { width: 800, useAdvancedWrap: true },
      }
    ).setOrigin(0.5);


    // forward when you see the Green Light.\nStop when you see the Red Light.\nReach the finish line before the timer runs out

    this.targetLabel = this.add.text(240, 1200, "", {
      font: "60px Outfit",
      color: "#ffffff",
    }).setOrigin(0.5);

    this.targetScoreText = this.add.text(850, 1200, ``, {
      font: "60px Outfit",
      color: "#ffffff",
    }).setOrigin(0.5);


    this.playButton = this.add.image(540, 1300, "play_game").setInteractive();
    this.playButton.on("pointerdown", () => {
      this.startGame();
    });

    this.htpOverlay.add([
      this.blur,
      this.howToPlayBox,
      this.howToPlayBox1,
      this.descriptionText,
      this.descriptionText1,
      this.descriptionText2,
      this.descriptionText3,
      this.targetLabel,
      this.targetScoreText,
      this.playButton,
    ]);
  }

  startGame() {
    this.instructionVisible = false;

    if (this.htpOverlay) this.htpOverlay.destroy();
    if (this.blur && this.blur.destroy) this.blur.destroy();

    // Remove HTP bg, restore gameplay bg visibility
    if (this._startBg) { this._startBg.destroy(); this._startBg = null; }
    if (this.background) this.background.setVisible(true);

    // ✅ Show HUD now
    this._setHUDVisible(true);

    // ✅ Start gameplay only now
    this.startGameplay();
  }


  endGame(won, message) {
    if (this.hasEnded) return;
    this.hasEnded = true;
    this.gameOver = true;

    // DO NOT stop BGM here (keeps playing across win/lose)
    // if (this.bgm && this.bgm.isPlaying) this.bgm.stop();  <-- remove

    this.secondTimerEvent?.remove();
    this.scoreTickEvent?.remove();
    this.lightWarnEvent?.remove();
    this.lightToggleEvent?.remove();
    this.secondTimerEvent = this.scoreTickEvent = this.lightWarnEvent = this.lightToggleEvent = null;

    if (!won && this.config.audio?.gameover) {
      this.gameover = this.sound.add("gameover", { loop: false, volume: 0.5 });
      this.gameover.play();
    }

    if (won && this.config.audio?.levelCompleted) {
      this.levelCompleted = this.sound.add("levelCompleted", {
        loop: false,
        volume: 0.5,
      });
      this.levelCompleted.play();
    }

    if (this.timerEvent?.remove) this.timerEvent.remove();
    if (this.ball?.body) { this.ball.body.setVelocity(0, 0); this.ball.setVisible(false); }

    // Add end-state background below blur
    const W = this.sys.game.config.width;
    const H = this.sys.game.config.height;

    // Clear any previous end-state BGs
    if (this._winBg) { this._winBg.destroy(); this._winBg = null; }
    if (this._ovrBg) { this._ovrBg.destroy(); this._ovrBg = null; }

    if (won) {
      const winKey = this._getImgKeyContains("winbg");
      if (winKey) this._winBg = this._addFullBg(winKey, 8); // depth 8 (below blur at 9)
    } else {
      const ovrKey = this._getImgKeyContains("ovrbg");
      if (ovrKey) this._ovrBg = this._addFullBg(ovrKey, 8);
    }

    const blur = this.add.rectangle(0, 0, 1080, 1920, 0x000000, 0.5)
      .setOrigin(0).setDepth(9);

    const endBoxKey = won ? "level_complete" : "game_over";
    const gameOverBox = this.add.image(540, 820, endBoxKey).setScale(0.55, 0.8).setDepth(10);



    if (won) {
      const buttonY = 1170;
      const buttonSpacing = 240;
      const blur = this.add
        .rectangle(0, 0, 1080, 1920, 0x000000, 0.5)
        .setOrigin(0)
        .setDepth(9);
      console.log("Blur created:", blur);

      const ttScore = this.add
        .text(540, 820, "Level Completed", {
          font: "80px Outfit",
          color: "#FFFFFF",
        })
        .setOrigin(0.5)
        .setDepth(11);

      const ttScoreYour = this.add
        .text(870, 830, ``, {
          font: "60px Outfit",
          color: "#FFFFFF",
        })
        .setOrigin(0.5)
        .setDepth(11);

      const yourScore = this.add
        .text(250, 980, "", {
          font: "60px Outfit",
          color: "#FFFFFF",
        })
        .setOrigin(0.5)
        .setDepth(11);

      const yourUserScore = this.add
        .text(870, 980, ``, {
          font: "60px Outfit",
          color: "#FFFFFF",
        })
        .setOrigin(0.5)
        .setDepth(11);
      const replayButton = this.add
        .image(540 - buttonSpacing, buttonY + 150, "replay")
        .setInteractive()
        .setDepth(10);

      const nextButton = this.add
        .image(540 + buttonSpacing, buttonY + 150, "next")
        .setInteractive()
        .setDepth(10);

      replayButton.on("pointerdown", () => {
        if (this.gameover?.isPlaying) this.gameover.stop();
        if (this.levelCompleted?.isPlaying) this.levelCompleted.stop();

        // stop and let it restart on new scene (we pass skipInstructions:true, so create() will start BGM)
        if (this.bgm?.isPlaying) this.bgm.stop();

        blur.destroy(); gameOverBox.destroy(); yourScore.destroy(); ttScore.destroy();
        yourUserScore.destroy(); ttScoreYour.destroy(); replayButton.destroy(); nextButton?.destroy();
        if (this._winBg) { this._winBg.destroy(); this._winBg = null; }
        if (this._ovrBg) { this._ovrBg.destroy(); this._ovrBg = null; }

        this.scene.restart({ skipInstructions: false });
      });

      nextButton.on("pointerdown", () => {
        if (this.gameover?.isPlaying) this.gameover.stop();
        if (this.levelCompleted?.isPlaying) this.levelCompleted.stop();

        // DO NOT stop BGM on Next
        blur.destroy(); gameOverBox.destroy(); yourScore.destroy(); ttScore.destroy();
        yourUserScore.destroy(); ttScoreYour.destroy(); replayButton.destroy(); nextButton.destroy();
        if (this._winBg) { this._winBg.destroy(); this._winBg = null; }
        if (this._ovrBg) { this._ovrBg.destroy(); this._ovrBg = null; }

        this.notifyParent('sceneComplete', { result: 'win' });
      });

    } else {
      const blur = this.add
        .rectangle(0, 0, 1080, 1920, 0x000000, 0.5)
        .setOrigin(0)
        .setDepth(9);
      console.log("Blur created:", blur);

      const ttScore = this.add
        .text(350, 820, "Distance Covered", {
          font: "60px Outfit",
          color: "#FFFFFF",
        })
        .setOrigin(0.5)
        .setDepth(11);

      const ttScore1 = this.add
        .text(540, 580, "Game Over", {
          font: "70px Outfit",
          color: "#FFFFFF",
        })
        .setOrigin(0.5)
        .setDepth(11);

      const ttScoreYour = this.add
        .text(870, 830, `${Math.floor(this.score)}`, {
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
        .text(870, 980, `${this.totalTime}`, {
          font: "60px Outfit",
          color: "#FFFFFF",
        })
        .setOrigin(0.5)
        .setDepth(11);
      const restartButton = this.add
        .image(540, 1270, "replay_level")
        .setInteractive()
        .setDepth(10);

      restartButton.on("pointerdown", () => {
        if (this.gameover) this.gameover.stop();

        // stop and restart BGM on new scene
        if (this.bgm?.isPlaying) this.bgm.stop();

        blur.destroy(); gameOverBox.destroy(); yourScore.destroy(); ttScore.destroy(); ttScore1.destroy();
        yourUserScore.destroy(); ttScoreYour.destroy(); restartButton.destroy();
        if (this._winBg) { this._winBg.destroy(); this._winBg = null; }
        if (this._ovrBg) { this._ovrBg.destroy(); this._ovrBg = null; }

        this.scene.restart({ skipInstructions: false });
      });

    }
  }

  notifyParent(type, data) {
    if (window.parent !== window) {
      window.parent.postMessage({ type, ...data }, "*");
    }
  }

  createConfetti() {
    const colors = [0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0xff00ff, 0x00ffff];

    for (let i = 0; i < 50; i++) {
      const confetti = this.add.rectangle(
        Phaser.Math.Between(0, this.gameWidth),
        -10,
        8,
        8,
        colors[Phaser.Math.Between(0, colors.length - 1)]
      );

      this.sys.tweens.add({
        targets: confetti,
        y: this.gameHeight + 50,
        rotation: Phaser.Math.Between(-Math.PI, Math.PI),
        duration: Phaser.Math.Between(2000, 4000),
        ease: "Cubic.easeOut",
        onComplete: () => confetti.destroy(),
      });
    }
  }
}
