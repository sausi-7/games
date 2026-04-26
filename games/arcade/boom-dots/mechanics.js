// mechanics.js
export default class GamePlayScene extends Phaser.Scene {
  constructor() {
    super("GamePlayScene");

    // core game objects
    this.player = null;
    this.enemy = null;
    this.playerTween = null;
    this.enemyTween = null;

    // scoring & misses
    this.score = 0;
    this.initialScore = 0;
    this.targetScore = 3; // default win at 3
    this.scoreText = null;

    this.missCount = 0;
    this.missLimit = 5;
    this.missText = null;

    // speeds / mechanics defaults
    this.baseFallDuration = 10000;
    this.fallDecrementPerScore = 10;
    this.minFallDuration = 3000;
    this.enemyMinMoveDuration = 800;
    this.enemyExtraMoveDuration = 2000;
    this.shootDuration = 500;
    this.perfectThreshold = 30;

    this.playerScale = 0.07;
    this.enemyScale = 0.07;

    // game state
    this.gameStarted = false;
    this.gameOver = false;

    // overlays
    this.startOverlay = null;
    this.winOverlay = null;
    this.gameOverOverlay = null;

    // UI backgrounds
    this.scoreBack = null;
    this.missBack = null;

    // config
    this.basePath = null;
    this.configData = null;

    // audio
    this.bgm = null;
    this.bgmKey = "bgm";        // expects "bgm" in config.json -> audio
    this.hitKey = "hit";        // expects "hit"
    this.collectKey = "collect"; // expects "collect"

    // UI text bundle
    this.uiText = {
      howToPlayTitle: "How To Play",
      howToPlayBody:
        "Tap to launch the player upward.\nHit the moving enemy.\nClose hits give bonus points!\nWin at 3 hits.\nGame over after 5 misses.",
      levelCompletedTitle: "Level Completed",
      gameOverTitle: "Game Over",
      scoreLabel: "Score",
      missLabel: "Miss"
    };
  }

  // ---------- PARENT COMMUNICATION ----------
  notifyParent(type, data) {
    if (window.parent !== window) {
      window.parent.postMessage({ type, ...data }, "*");
    }
  }

  // helper to safely play sfx by key
  playSfx(key) {
    if (!key) return;
    if (this.cache.audio && this.cache.audio.exists(key)) {
      this.sound.play(key, { loop: false });
    }
  }

  // ---------- PRELOAD ----------
  preload() {
    // Base path for assets (same folder as mechanics.js)
    this.basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf("/"));

    // 1) Load config.json first
    this.load.json("levelConfig", `${this.basePath}/config.json`);

    // 2) Once config is loaded, queue all images & audio from it
    this.load.once("filecomplete-json-levelConfig", () => {
      this.configData = this.cache.json.get("levelConfig") || {};

      // IMAGES
      const images1 = this.configData.images1 || {};
      Object.entries(images1).forEach(([key, relPath]) => {
        this.load.image(key, `${this.basePath}/${relPath}`);
      });

      const images2 = this.configData.images2 || {};
      Object.entries(images2).forEach(([key, relPath]) => {
        this.load.image(key, `${this.basePath}/${relPath}`);
      });

      const ui = this.configData.ui || {};
      Object.entries(ui).forEach(([key, relPath]) => {
        this.load.image(key, `${this.basePath}/${relPath}`);
      });

      // AUDIO
      const audio = this.configData.audio || {};
      Object.entries(audio).forEach(([key, relPath]) => {
        const isAbsolute = /^https?:\/\//i.test(relPath);
        const fullPath = isAbsolute ? relPath : `${this.basePath}/${relPath}`;
        this.load.audio(key, fullPath);
      });
    });
  }

  // ---------- CREATE ----------
  create() {
    const { width, height } = this.scale; // 1080 x 1920 from config
    const cfg = this.configData || {};
    const mech = cfg.mechanics || {};
    const textCfg = cfg.text || {};

    // ---- READ MECHANICS FROM JSON (with defaults) ----
    this.initialScore = mech.initialScore ?? 0;
    this.score = this.initialScore;
    this.targetScore = mech.targetScore ?? this.targetScore;
    this.missLimit = mech.missLimit ?? this.missLimit;

    this.baseFallDuration = mech.baseFallDuration ?? this.baseFallDuration;
    this.fallDecrementPerScore =
      mech.fallDecrementPerScore ?? this.fallDecrementPerScore;
    this.minFallDuration = mech.minFallDuration ?? this.minFallDuration;

    this.enemyMinMoveDuration =
      mech.enemyMinMoveDuration ?? this.enemyMinMoveDuration;
    this.enemyExtraMoveDuration =
      mech.enemyExtraMoveDuration ?? this.enemyExtraMoveDuration;

    this.shootDuration = mech.shootDuration ?? this.shootDuration;
    this.perfectThreshold = mech.perfectThreshold ?? this.perfectThreshold;

    this.playerScale = mech.playerScale ?? this.playerScale;
    this.enemyScale = mech.enemyScale ?? this.enemyScale;

    // ---- TEXT FROM JSON ----
    this.uiText = {
      howToPlayTitle: textCfg.howToPlayTitle || this.uiText.howToPlayTitle,
      howToPlayBody: textCfg.howToPlayBody || this.uiText.howToPlayBody,
      levelCompletedTitle:
        textCfg.levelCompletedTitle || this.uiText.levelCompletedTitle,
      gameOverTitle: textCfg.gameOverTitle || this.uiText.gameOverTitle,
      scoreLabel: textCfg.scoreLabel || this.uiText.scoreLabel,
      missLabel: textCfg.missLabel || this.uiText.missLabel
    };

    this.gameStarted = false;
    this.gameOver = false;
    this.missCount = 0;

    // ---------- BGM (bgm.mp3) ----------
    // Start background music now and do NOT stop on win/over.
    if (this.cache.audio && this.cache.audio.exists(this.bgmKey)) {
      this.bgm = this.sound.add(this.bgmKey, {
        loop: true,
        volume: 0.6
      });
      this.bgm.play();
    }

    // BACKGROUND (key "bg" loaded from images1)
    const bg = this.add.image(width / 2, height / 2, "bg");
    bg.setDisplaySize(width, height);
    bg.setDepth(0);

    // SCORE / TARGET (Score: 0/3) with its own scoreback
    this.scoreBack = this.add.image(40, 80, "scoreback");
    this.scoreBack.setOrigin(0, 0.5);
    this.scoreBack.setDepth(1);

    this.scoreText = this.add.text(90, 80, "", {
      fontFamily: "Outfit",
      fontSize: "44px",
      color: "#000000ff"
    });
    this.scoreText.setOrigin(0, 0.5);
    this.scoreText.setDepth(2);
    this.updateScoreText();

    // MISS (Miss: 0/5) with its own scoreback
    this.missBack = this.add.image(width - 40, 80, "scoreback");
    this.missBack.setOrigin(1, 0.5);
    this.missBack.setDepth(1);

    this.missText = this.add.text(width - 90, 80, "", {
      fontFamily: "Outfit",
      fontSize: "44px",
      color: "#000000ff"
    });
    this.missText.setOrigin(1, 0.5);
    this.missText.setDepth(2);
    this.updateMissText();

    // PLAYER
    this.player = this.add.sprite(width / 2, height * 0.8, "player");
    this.player.setOrigin(0.5);
  
    this.player.setVisible(false);

    // ENEMY
    this.enemy = this.add.sprite(width + 100, 0, "enemy").setScale(1.2);
    this.enemy.setOrigin(0.5);
    // this.enemy.setScale(this.enemyScale + 0.03);
    this.enemy.setVisible(false);

    // Overlays
    this.showStartOverlay();
  }

  // ---------- UPDATE ----------
  update() {
    if (!this.gameStarted || this.gameOver) return;
    if (!this.player || !this.enemy) return;
    if (!this.player.visible || !this.enemy.visible) return;

    const p = this.player;
    const e = this.enemy;

    const dist = Phaser.Math.Distance.Between(p.x, p.y, e.x, e.y);
    const collisionRadius = p.displayWidth / 2 + e.displayWidth / 2;

    if (dist < collisionRadius) {
      // collision
      if (this.enemyTween && this.enemyTween.isPlaying()) {
        this.enemyTween.stop();
      }
      if (this.playerTween && this.playerTween.isPlaying()) {
        this.playerTween.stop();
      }

      // play collect sound when score happens
      this.playSfx(this.collectKey);

      this.score++;

      // perfect bonus (similar logic to original)
      if (Math.abs(p.x - e.x) < this.perfectThreshold) {
        this.score += 2;
      }

      // clamp so we don't display > target
      if (this.score > this.targetScore) this.score = this.targetScore;

      this.updateScoreText();

      if (this.score >= this.targetScore) {
        this.handleWin();
        return;
      }

      // new round
      this.placeEnemy();
      this.placePlayer();
    }
  }

  // ---------- CORE GAME FLOW ----------
  startGame() {
    this.gameStarted = true;
    this.gameOver = false;
    this.score = this.initialScore;
    this.missCount = 0;
    this.updateScoreText();
    this.updateMissText();

    // hide overlays
    if (this.startOverlay) {
      this.startOverlay.destroy();
      this.startOverlay = null;
    }
    if (this.winOverlay) {
      this.winOverlay.destroy();
      this.winOverlay = null;
    }
    if (this.gameOverOverlay) {
      this.gameOverOverlay.destroy();
      this.gameOverOverlay = null;
    }

    this.player.setVisible(true);
    this.enemy.setVisible(true);

    this.placeEnemy();
    this.placePlayer();
  }

  handleWin() {
    if (this.gameOver) return;
    this.gameOver = true;
    this.gameStarted = false;

    if (this.playerTween) this.playerTween.stop();
    if (this.enemyTween) this.enemyTween.stop();

    // NOTE: bgm NOT stopped here (as you requested)
    this.showWinOverlay();
  }

  handleGameOver() {
    if (this.gameOver) return;
    this.gameOver = true;
    this.gameStarted = false;

    if (this.playerTween) this.playerTween.stop();
    if (this.enemyTween) this.enemyTween.stop();

    // NOTE: bgm NOT stopped here
    this.showGameOverOverlay();
  }

  restartScene() {
    // stop bgm ONLY when replaying, so new scene can restart it
    if (this.bgm && this.bgm.isPlaying) {
      this.bgm.stop();
    }
    this.scene.restart();
  }

  // ---------- SCORE / MISS TEXT ----------
  updateScoreText() {
    if (!this.scoreText) return;
    this.scoreText.setText(
      `${this.uiText.scoreLabel}: ${this.score}/${this.targetScore}`
    );
  }

  updateMissText() {
    if (!this.missText) return;
    this.missText.setText(
      `${this.uiText.missLabel}: ${this.missCount}/${this.missLimit}`
    );
  }

  // ---------- MISS HANDLING ----------
  registerMiss() {
    if (this.gameOver) return;

    // stop any current tweens
    if (this.playerTween && this.playerTween.isPlaying()) {
      this.playerTween.stop();
    }
    if (this.enemyTween && this.enemyTween.isPlaying()) {
      this.enemyTween.stop();
    }

    // play miss SFX (using "hit" name if you prefer, just change key)
    this.playSfx(this.hitKey);

    this.missCount++;
    if (this.missCount > this.missLimit) this.missCount = this.missLimit;
    this.updateMissText();

    if (this.missCount >= this.missLimit) {
      this.handleGameOver();
      return;
    }

    // not yet game over -> start next round
    this.placeEnemy();
    this.placePlayer();
  }

  // ---------- PLAYER / ENEMY LOGIC ----------
  placePlayer() {
    const { width, height } = this.scale;

    this.player.x = width / 2;
    this.player.y = height * 0.8;

    // baseFallDuration - score * fallDecrementPerScore, clamped
    let baseDuration =
      this.baseFallDuration - this.score * this.fallDecrementPerScore;
    if (baseDuration < this.minFallDuration) {
      baseDuration = this.minFallDuration;
    }

    this.playerTween = this.tweens.add({
      targets: this.player,
      y: height + this.player.displayHeight,
      duration: baseDuration,
      ease: "Linear",
      onComplete: () => {
        // player reached bottom without firing -> miss
        this.registerMiss();
      }
    });

    // Only allow 1 tap per cycle, like original fire logic
    this.input.removeAllListeners("pointerdown");
    this.input.once("pointerdown", this.fire, this);
  }

  placeEnemy() {
    const { width, height } = this.scale;

    this.enemy.x = width - this.enemy.displayWidth / 2;
    this.enemy.y = -this.enemy.displayHeight / 2;

    // move down quickly to some random Y (20%–70% height)
    const targetY = Phaser.Math.Between(
      Math.round(height * 0.2),
      Math.round(height * 0.7)
    );

    this.tweens.add({
      targets: this.enemy,
      y: targetY,
      duration: 250,
      ease: "Linear",
      onComplete: () => {
        this.moveEnemyHorizontally();
      }
    });
  }

  moveEnemyHorizontally() {
    const duration =
      this.enemyMinMoveDuration +
      Phaser.Math.Between(0, this.enemyExtraMoveDuration);

    this.enemyTween = this.tweens.add({
      targets: this.enemy,
      x: this.enemy.displayWidth / 2,
      duration,
      ease: "Cubic.easeInOut",
      yoyo: true,
      repeat: -1
    });
  }

  fire() {
    if (!this.gameStarted || this.gameOver) return;
    if (!this.playerTween) return;

    this.input.removeAllListeners("pointerdown");

    if (this.playerTween && this.playerTween.isPlaying()) {
      this.playerTween.stop();
    }

    // play hit sound on tap (as requested)
    this.playSfx(this.hitKey);

    // shoot upward
    this.playerTween = this.tweens.add({
      targets: this.player,
      y: -this.player.displayHeight,
      duration: this.shootDuration,
      ease: "Linear",
      onComplete: () => {
        // if it reaches top without hitting -> miss
        this.registerMiss();
      }
    });
  }

  // ---------- OVERLAYS ----------
  showStartOverlay() {
    const { width, height } = this.scale;

    if (this.startOverlay) {
      this.startOverlay.destroy();
    }

    const container = this.add.container(0, 0);
    container.setDepth(100);
    this.startOverlay = container;

    const bg = this.add.image(width / 2, height / 2, "htpbg");
    bg.setDisplaySize(width, height);

    const box = this.add.image(width / 2, height / 2, "htpbox").setScale(0.55, 0.8);
    box.setOrigin(0.5);

    // TITLE
    const title = this.add.text(
      width / 2,
      height / 2 - box.displayHeight * 0.25 - 50,
      this.uiText.howToPlayTitle,
      {
        fontFamily: "Outfit",
        fontSize: "72px",
        color: "#ffffff"
      }
    );
    title.setOrigin(0.5);

    // ---------- TAP ROW ----------
    const tapY = height / 2 - 40;

    const tapLabel = this.add.text(
      width / 2 - 180,
      tapY,
      "Tap:",
      {
        fontFamily: "Outfit",
        fontSize: "48px",
        color: "#ffffff"
      }
    );
    tapLabel.setOrigin(1, 0.5);

    const tapIcon = this.add.image(
      width / 2 - 80,
      tapY,
      "player"
    );
    tapIcon.setOrigin(0.5);
    tapIcon.setScale(0.51);

    // ---------- HIT ROW ----------
    const hitY = tapY + 140;

    const hitLabel = this.add.text(
      width / 2 - 180,
      hitY,
      "Hit:",
      {
        fontFamily: "Outfit",
        fontSize: "48px",
        color: "#ffffff"
      }
    );
    hitLabel.setOrigin(1, 0.5);

    const hitIcon = this.add.image(
      width / 2 - 80,
      hitY,
      "enemy"
    );
    hitIcon.setOrigin(0.5);
    hitIcon.setScale(0.5);

    // ---------- SMALL TEXT ABOUT WIN / MISS ----------
    const summaryText = this.add.text(
      width / 2,
      hitY + 140,
      `Win at ${this.targetScore} hits.\nGame over after ${this.missLimit} misses.`,
      {
        fontFamily: "Outfit",
        fontSize: "40px",
        color: "#ffffff",
        align: "center"
      }
    );
    summaryText.setOrigin(0.5);

    // PLAY BUTTON
    const playBtn = this.add.image(
      width / 2,
      height / 2 + box.displayHeight * 0.25 + 300,
      "playbtn"
    );
    playBtn.setOrigin(0.5);
    playBtn.setInteractive({ useHandCursor: true });
    playBtn.on("pointerup", () => {
      this.startGame();
    });

    container.add([
      bg,
      box,
      title,
      tapLabel,
      tapIcon,
      hitLabel,
      hitIcon,
      summaryText,
      playBtn
    ]);
  }


  showWinOverlay() {
    const { width, height } = this.scale;

    if (this.winOverlay) {
      this.winOverlay.destroy();
    }

    const container = this.add.container(0, 0);
    container.setDepth(100);
    this.winOverlay = container;

    const bg = this.add.image(width / 2, height / 2, "winbg");
    bg.setDisplaySize(width, height);

    const box = this.add.image(width / 2, height / 2, "lvlbox").setScale(0.55, 0.8);
    box.setOrigin(0.5);

    const title = this.add.text(
      width / 2,
      height / 2 - box.displayHeight * 0.25,
      this.uiText.levelCompletedTitle,
      {
        fontFamily: "Outfit",
        fontSize: "72px",
        color: "#ffffff"
      }
    );
    title.setOrigin(0.5);

    const info = this.add.text(
      width / 2,
      height / 2,
      `${this.uiText.scoreLabel}: ${this.score}/${this.targetScore}\n${this.uiText.missLabel}: ${this.missCount}/${this.missLimit}`,
      {
        fontFamily: "Outfit",
        fontSize: "44px",
        color: "#ffffff",
        align: "center"
      }
    );
    info.setOrigin(0.5);

    const replayBtn = this.add.image(
      width / 2 - box.displayWidth * 0.2 - 50,
      height / 2 + box.displayHeight * 0.25 + 300,
      "lvl_replay"
    );
    replayBtn.setOrigin(0.5);
    replayBtn.setInteractive({ useHandCursor: true });
    replayBtn.on("pointerup", () => {
      this.restartScene();
    });

    const nextBtn = this.add.image(
      width / 2 + box.displayWidth * 0.2 + 50,
      height / 2 + box.displayHeight * 0.25 + 300,
      "next"
    );
    nextBtn.setOrigin(0.5);
    nextBtn.setInteractive({ useHandCursor: true });
    nextBtn.on("pointerup", () => {
      this.notifyParent("sceneComplete", { result: "win" });
    });

    container.add([bg, box, title, info, replayBtn, nextBtn]);
  }

  showGameOverOverlay() {
    const { width, height } = this.scale;

    if (this.gameOverOverlay) {
      this.gameOverOverlay.destroy();
    }

    const container = this.add.container(0, 0);
    container.setDepth(100);
    this.gameOverOverlay = container;

    const bg = this.add.image(width / 2, height / 2, "ovrbg");
    bg.setDisplaySize(width, height);

    const box = this.add.image(width / 2, height / 2, "ovrbox").setScale(0.55, 0.8);
    box.setOrigin(0.5);

    const title = this.add.text(
      width / 2,
      height / 2 - box.displayHeight * 0.25,
      this.uiText.gameOverTitle,
      {
        fontFamily: "Outfit",
        fontSize: "72px",
        color: "#ffffff"
      }
    );
    title.setOrigin(0.5);

    const info = this.add.text(
      width / 2,
      height / 2,
      `${this.uiText.scoreLabel}: ${this.score}/${this.targetScore}\n${this.uiText.missLabel}: ${this.missCount}/${this.missLimit}`,
      {
        fontFamily: "Outfit",
        fontSize: "44px",
        color: "#ffffff",
        align: "center"
      }
    );
    info.setOrigin(0.5);

    const replayBtn = this.add.image(
      width / 2,
      height / 2 + box.displayHeight * 0.25 + 300,
      "replay"
    );
    replayBtn.setOrigin(0.5);
    replayBtn.setInteractive({ useHandCursor: true });
    replayBtn.on("pointerup", () => {
      this.restartScene();
    });

    container.add([bg, box, title, info, replayBtn]);
  }
}
