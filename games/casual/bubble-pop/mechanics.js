export default class BubblePopScene extends Phaser.Scene {
  constructor() {
    super("BubblePopScene");
    Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach(fn => {
      if (typeof this[fn] === "function") this[fn] = this[fn].bind(this);
    });
    this.cfg = null;
    this.settings = {};
    this.colors = {};
    this.texts = {};
    this.state = "start";
    this.score = 0;
    this.timer = 0;
    this.bubbleGroup = null;
    this.bgImg = null;
    this.images = {};
    this.overlays = {};
    this.bgmSound = null;
    this.hitSound = null;
    this._winButtons = null;

    // HUD refs
    this.scoreText = null;
    this.timerText = null;
    this.targetText = null;
    this.gameOverlay = null;
    this.scorebar = null;

    this.overlayPositions = {};
  }

  notifyParent(type, data) {
    if (window.parent !== window) {
      window.parent.postMessage({ type, ...data }, "*");
    }
  }

  // --- helpers to read manual positions from config ---
  getPos(overlay, key, defX, defY) {
    const p = (this.overlayPositions?.[overlay]?.[key]) || {};
    return { x: (p.x ?? defX), y: (p.y ?? defY) };
  }

  preload() {
    const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));
    this.load.json('levelConfig', `${basePath}/config.json`);
    this.load.once('filecomplete-json-levelConfig', () => {
      this.cfg = this.cache.json.get('levelConfig');

      if (this.cfg.images1) {
        for (const [key, url] of Object.entries(this.cfg.images1)) {
          const full = url.startsWith('http') ? url : `${basePath}/${url}`;
          this.load.image(key, full);
        }
      }

      // audio
      // this.load.audio('bgm', `${basePath}/assets/bgm.mp3`);
      // this.load.audio('hit', `${basePath}/assets/hit.mp3`);

      // overlays + ui
      if (this.cfg.ui) {
        for (const [key, url] of Object.entries(this.cfg.ui)) {
          const full = url.startsWith('http') ? url : `${basePath}/${url}`;
          this.load.image(key, full);
        }
      }

      if (this.cfg.images2) {
        for (const [key, url] of Object.entries(this.cfg.images2)) {
          const full = url.startsWith('http') ? url : `${basePath}/${url}`;
          this.load.image(key, full);
        }
      }

        // Load audio
      if (this.cfg.audio) {
        Object.entries(this.cfg.audio).forEach(([key, url]) => {
          const path = url.startsWith('http') ? url : `${basePath}/${url}`;
          this.load.audio(key, path);
        });
      }

      this.load.start();
    });
  }

  create() {
    this.cfg = this.cfg || this.cache.json.get('levelConfig');
    this.settings = this.cfg.game;
    this.colors = this.cfg.colors;
    this.texts = this.cfg.texts || {};
    this.W = this.cfg.orientation.width;
    this.H = this.cfg.orientation.height;
    this.images = this.cfg.images2 || {};
    this.overlayPositions = this.cfg.overlayPositions || {}; // manual XY from config.json

    // Background
    if (this.images.background && this.sys.textures.exists('background')) {
      this.bgImg = this.add.image(this.W / 2, this.H / 2, 'background')
        .setDisplaySize(this.W, this.H)
        .setDepth(-1);
    } else {
      this.sys.cameras.main.setBackgroundColor(this.colors.background);
    }

    // ✅ BGM starts as soon as the scene is created
    if (!this.bgmSound) {
      this.bgmSound = this.sound.add('bgm', { loop: true, volume: 0.5 });
    }
    if (!this.bgmSound.isPlaying) this.bgmSound.play();

    this.createOverlay('start');
    this.createOverlay('win');       // uses custom next/replay buttons
    this.createOverlay('gameover');
    this.createGameOverlay();

    this.showOverlay("start");
  }

  // --------- Overlay Factory ------------
  createOverlay(type) {
    // Clear previous buttons store
    this._winButtons = null;

    // Destroy old overlay if exists
    if (this.overlays[type]) this.overlays[type].destroy();

    const cx = this.W / 2, cy = this.H / 2;

    // Per-type sizing (images: scale; fallback rect: width/height)
    const dims = {
      start: { imgScaleX: 0.85, imgScaleY: 0.95, rectW: this.W * 0.9, rectH: this.H * 0.62 },
      win: { imgScaleX: 0.65, imgScaleY: 0.80, rectW: this.W * 0.78, rectH: this.H * 0.50 },
      gameover: { imgScaleX: 0.60, imgScaleY: 0.70, rectW: this.W * 0.74, rectH: this.H * 0.44 },
    };
    const d = dims[type] || dims.start;

    let overlayKey, buttonKey, buttonHandler, buttonText, msgText, msgScore;

    if (type === 'start') {
      overlayKey = 'start_overlay';
      buttonKey = 'button_play';
      buttonHandler = () => {
        this.showOverlay("playing");
        this.startGame();
      };
      buttonText = this.texts.tapToStart || "";
      msgText = this.texts.title || "";
      msgScore = this.texts.subtitle || "";
      // (we'll create the decorative 'bubble' AFTER the container is created so we can add it to the container)

    } else if (type === 'win') {
      overlayKey = 'levelcomplete_overlay';
      msgText = this.texts.levelComplete || "You Win!";
      msgScore = this.texts.score ? this.texts.score.replace("{score}", 0) : "";

      // Two buttons: NEXT + REPLAY LEVEL (manual XY via config/fallbacks)
      const nextPos = this.getPos('win', 'nextButton', cx + 225, cy + 330);
      const replayPos = this.getPos('win', 'replayButton', cx - 225, cy + 330);

      const nextBtn = this.add.image(nextPos.x, nextPos.y, 'next')
        .setOrigin(0.5).setInteractive({ useHandCursor: true });
      nextBtn.on('pointerdown', () => {
        // Optional: keep bgm continuous; no restart required on NEXT
        this.showOverlay("playing");
        this.notifyParent('sceneComplete', { result: 'win' });
      });

      const replayBtn = this.add.image(replayPos.x, replayPos.y, 'replay_level')
        .setOrigin(0.5).setInteractive({ useHandCursor: true });
      replayBtn.on('pointerdown', () => {
        // ✅ Restart BGM on Replay (Win)
        if (this.bgmSound) { this.bgmSound.stop(); this.bgmSound.play(); }
        this.showOverlay("playing");
        this.startGame();
      });

      this._winButtons = [nextBtn, replayBtn];

    } else if (type === 'gameover') {
      overlayKey = 'gameover_overlay';
      buttonKey = 'replay';
      buttonHandler = () => {
        // ✅ Restart BGM on Replay (Game Over)
        if (this.bgmSound) { this.bgmSound.stop(); this.bgmSound.play(); }
        this.showOverlay("playing");
        this.startGame();
      };
      buttonText = this.texts.tryAgain || "";
      msgText = this.texts.gameOver || "Try Again!";
      msgScore = this.texts.score ? this.texts.score.replace("{score}", 0) : "";
    }

    const container = this.add.container(0, 0).setDepth(100);

    // Overlay BG image or fallback (with per-type sizing)
    if (overlayKey && this.sys.textures.exists(overlayKey)) {
      const bg = this.add.image(cx, cy, overlayKey)
        .setScale(0.55, 0.8)  // <-- use per-type scales
        .setOrigin(0.5);
      container.add(bg);
    } else {
      const bg = this.add.rectangle(cx, cy, d.rectW, d.rectH, 0xeeeeee, 0.98)
        .setStrokeStyle(4, 0x888888);
      container.add(bg);
    }

    // Main title/message
    const mainText = this.add.text(cx, cy, msgText, {
      font: '50px outfit', color: '#fcf9f9ff'
    }).setOrigin(0.5);
    container.add(mainText);

    // Score text or subtitle
    if (type !== 'start') {
      const scoreText = this.add.text(cx, cy + 70, msgScore, {
        font: '50px outfit', color: 'white'
      }).setOrigin(0.5);
      if (type === "win") this.finalScoreText = scoreText;
      if (type === "gameover") this.finalScoreText2 = scoreText;
      container.add(scoreText);
    } else {
      // "How to Play" label above subtitle
      const howToPlayLabel = this.add.text(cx, cy - 250, (this.texts.how_to_play || "How to Play"), {
        font: '70px outfit',
        color: '#fffbfbff',
      }).setOrigin(0.5);
      container.add(howToPlayLabel);

      const subtitle = this.add.text(cx - 200, cy + 4, msgScore, {
        font: '50px outfit', color: 'white'
      }).setOrigin(0.5);
      container.add(subtitle);

      // 🔧 FIX: make the decorative bubble part of the overlay container
      if (this.sys.textures.exists('bubble')) {
        const bu = this.add.image(520, 960, 'bubble').setScale(0.2);
        // depth not needed; container z-order is already high
        container.add(bu);
      }
    }

    // === Per-overlay button placement ===

    // START overlay (Play button + label)
    if (type === 'start') {
      const { x: btnX, y: btnY } = this.getPos('start', 'playButton', cx, cy + 650);
      const { x: lblX, y: lblY } = this.getPos('start', 'playLabel', cx, btnY - 100);

      if (buttonKey && this.sys.textures.exists(buttonKey)) {
        const btn = this.add.image(btnX, btnY, buttonKey)
          .setOrigin(0.5)
          .setInteractive({ useHandCursor: true });
        btn.on('pointerdown', buttonHandler);
        container.add(btn);
      } else {
        const btn = this.add.rectangle(btnX, btnY, 220, 64, 0x3985ff, 1)
          .setInteractive({ useHandCursor: true });
        btn.on('pointerdown', buttonHandler);
        container.add(btn);
      }

      const label = this.add.text(lblX, lblY, this.texts.tapToStart || "", {
        font: "bold 30px Arial", color: "#fff"
      }).setOrigin(0.5);
      container.add(label);
    }

    // GAMEOVER overlay (Replay button + label)
    // GAMEOVER overlay (Replay button only)
    if (type === 'gameover') {
      const { x: btnX, y: btnY } = this.getPos('gameover', 'replayButton', cx, cy + 250);

      if (buttonKey && this.sys.textures.exists(buttonKey)) {
        const btn = this.add.image(btnX, btnY + 100, buttonKey)
          .setOrigin(0.5)
          .setInteractive({ useHandCursor: true });
        btn.on('pointerdown', buttonHandler);
        container.add(btn);
      } else {
        const btn = this.add.rectangle(btnX, btnY, 220, 64, 0x3985ff, 1)
          .setInteractive({ useHandCursor: true });
        btn.on('pointerdown', buttonHandler);
        container.add(btn);
      }
    }


    // Attach custom win buttons after container exists
    if (type === 'win' && this._winButtons) {
      this._winButtons.forEach(btn => container.add(btn));
    }

    container.setVisible(false);
    this.overlays[type] = container;
  }

  showOverlay(state) {
    this.state = state;
    // Hide all overlays
    for (let k in this.overlays) this.overlays[k].setVisible(false);

    // Show the requested overlay, if exists
    if (this.overlays[state]) this.overlays[state].setVisible(true);

    // HUD visibility
    if (this.gameOverlay) this.gameOverlay.setVisible(state === "playing");

    // Clear bubbles when leaving gameplay
    if (state !== "playing" && this.bubbleGroup) {
      this.bubbleGroup.clear(true, true);
    }
  }

  //--- HUD Overlay ---
  createGameOverlay() {
    const { W, texts, colors } = this;
    const targetCount = this.settings.winPopCount;

    // optional UI bar; adjust/keep as needed
    this.scorebar = this.add.image(540, 70, 'scorebar');
    this.scorebar1 = this.add.image(180, 70, 'scorebar');
    this.scorebar2 = this.add.image(900, 70, 'scorebar');

    this.gameOverlay = this.add.container(0, 0).setDepth(10);

    this.scoreText = this.add.text(70, 45,
      (texts.score || "Score: {score}").replace("{score}", 0),
      { font: '50px outfit', color: colors.score }
    );

    this.targetText = this.add.text(W - 70, 45,
      (texts.target || "Target: {target}").replace("{target}", targetCount),
      { font: '50px outfit', color: colors.lives || colors.timer || '#ffffff' } // reuse palette
    ).setOrigin(1, 0);

    this.timerText = this.add.text(this.W / 2, 45,
      (texts.timer || "Time: {timer}").replace("{timer}", this.settings.gameTime),
      { font: '50px outfit', color: colors.timer }
    ).setOrigin(0.5, 0);

    this.gameOverlay.add([this.scorebar, this.scorebar1, this.scorebar2, this.scoreText, this.targetText, this.timerText]);
    this.gameOverlay.setVisible(false);
  }

  startGame() {
    this.score = 0;
    this.timer = this.settings.gameTime;
    this.gameOver = false;

    // Reset HUD
    if (this.scoreText?.setText) {
      this.scoreText.setText((this.texts.score || "Score: {score}").replace("{score}", 0));
    }
    if (this.timerText?.setText) {
      this.timerText.setText((this.texts.timer || "Time: {timer}").replace("{timer}", this.timer));
    }
    if (this.targetText?.setText) {
      this.targetText.setText((this.texts.target || "Target: {target}")
        .replace("{target}", this.settings.winPopCount));
    }

    if (this.bubbleGroup) this.bubbleGroup.clear(true, true);
    this.bubbleGroup = this.add.group();

    this.input.on('pointerdown', this.checkBubblePop, this);

    this.spawnTimer?.remove();
    this.spawnTimer = this.time.addEvent({
      delay: this.settings.spawnInterval,
      callback: this.spawnBubble,
      callbackScope: this,
      loop: true
    });

    this.timerEvent?.remove();
    this.timerEvent = this.time.addEvent({
      delay: 1000,
      callback: () => {
        if (this.state !== "playing") return;
        this.timer--;
        if (this.timerText?.setText)
          this.timerText.setText((this.texts.timer || "Time: {timer}").replace("{timer}", this.timer));
        if (this.timer <= 0) this.endGame(true); // time up -> evaluate below in endGame
      },
      callbackScope: this,
      loop: true
    });

    this.showOverlay("playing");
  }

  // --- Always use bubble.png image ---
  spawnBubble() {
    if (this.state !== "playing") return;

    const rmin = this.settings.bubbleRadiusMin, rmax = this.settings.bubbleRadiusMax;
    const radius = Phaser.Math.Between(rmin, rmax);
    const x = Phaser.Math.Between(radius + 16, this.W - radius - 16);
    const speed = Phaser.Math.Between(this.settings.bubbleSpeedMin, this.settings.bubbleSpeedMax);

    // Force image usage; skip if texture missing
    if (!this.sys.textures.exists('bubble')) return;

    const bubble = this.add.image(x, this.H + radius + 4, 'bubble')
      .setDisplaySize(radius * 3.3, radius * 3.3)
      .setDepth(1);

    bubble.radius = radius;
    bubble.speed = speed;
    bubble.isPopped = false;

    this.bubbleGroup.add(bubble);
  }

  checkBubblePop(pointer) {
    if (this.state !== "playing" || this.gameOver) return;

    this.bubbleGroup.getChildren().forEach(bubble => {
      if (bubble.isPopped) return;
      const dx = pointer.x - bubble.x;
      const dy = pointer.y - bubble.y;
      if (dx * dx + dy * dy <= bubble.radius * bubble.radius) {
        bubble.isPopped = true;
        this.sys.tweens.add({
          targets: bubble,
          scaleX: 1.5, scaleY: 1.5, alpha: 0,
          duration: 190,
          onComplete: () => { bubble.destroy(); }
        });

        if (!this.hitSound) this.hitSound = this.sound.add('hit', { volume: 1 });
        this.hitSound.play();

        this.score++;
        this.scoreText.setText((this.texts.score || "Score: {score}").replace("{score}", this.score));
        if (this.score >= this.settings.winPopCount) {
          this.endGame(true);
        }
      }
    });
  }

  endGame() {
    this.gameOver = true;
    this.spawnTimer && this.spawnTimer.remove();
    this.timerEvent && this.timerEvent.remove();
    this.input.off('pointerdown', this.checkBubblePop, this);

    // Keep BGM running here; Replay buttons handle restart if needed

    this.time.delayedCall(500, () => {
      const reachedTarget = (this.score >= this.settings.winPopCount);
      if (reachedTarget) {
        if (this.finalScoreText) this.finalScoreText.setText((this.texts.score || "Score: {score}").replace("{score}", this.score));
        this.showOverlay("win");
      } else {
        if (this.finalScoreText2) this.finalScoreText2.setText((this.texts.score || "Score: {score}").replace("{score}", this.score));
        this.showOverlay("gameover");
      }
    });
  }

  update(time, delta) {
    if (this.state !== "playing" || !this.bubbleGroup) return;

    this.bubbleGroup.getChildren().forEach(bubble => {
      if (bubble.isPopped) return;
      bubble.y -= bubble.speed * (delta / 1000);

      // If bubble exits at the top, just remove it (no lives anymore)
      if (bubble.y + bubble.radius < 0) {
        bubble.isPopped = true;
        bubble.destroy();
      }
    });
  }
}
