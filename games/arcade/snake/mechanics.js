export default class SnakeGame extends Phaser.Scene {
  constructor() {
    super("SnakeGame");
    this.state = "playing";
    Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach(fn => {
      if (typeof this[fn] === 'function') this[fn] = this[fn].bind(this);
    });

    this.targetScore = 20; // Add this to your constructor or as a class field
    this.overlayGroup = null; // Track overlays

  }

  preload() {
    // Safer base path (works for modules; falls back if needed)
    const basePath = (() => {
      try {
        const url = import.meta?.url || '';
        return url.substring(0, url.lastIndexOf('/'));
      } catch {
        // Fallback: current location (expects config.json relative to index.html)
        return '.';
      }
    })();

    // ---- helpers -------------------------------------------------------------
    const evictTexture = (key) => {
      try {
        if (this.textures.exists(key)) this.textures.remove(key);
      } catch { }
    };

    const isAbsolute = (p) => /^https?:\/\//i.test(p) || p.startsWith('data:') || p.startsWith('//');
    const joinPath = (p) => (isAbsolute(p) ? p : `${basePath}/${p}`.replace(/([^:]\/)\/+/g, '$1'));

    const enqueueAllAssets = (cfg) => {
      // Merge all image maps: images (legacy), images1, images2, ui
      const images = {
        ...(cfg.images || {}),
        ...(cfg.images1 || {}),
        ...(cfg.images2 || {}),
        ...(cfg.ui || {}),
      };

      // Images
      for (const key in images) {
        const src = images[key];
        evictTexture(key);
        this.load.image(key, joinPath(src));
      }

      // Audio
      const audio = cfg.audio || {};
      for (const key in audio) {
        const src = audio[key];
        this.load.audio(key, joinPath(src));
      }

      // Spritesheets
      const sheets = cfg.spritesheets || {};
      for (const key in sheets) {
        const s = sheets[key] || {};
        if (!s.path || !s.frameWidth || !s.frameHeight) continue;
        evictTexture(key);
        this.load.spritesheet(key, joinPath(s.path), {
          frameWidth: s.frameWidth,
          frameHeight: s.frameHeight,
          startFrame: s.startFrame ?? 0,
          endFrame: s.endFrame ?? undefined,
        });
      }
    };

    // CORS & logging
    if (this.load.setCORS) this.load.setCORS('anonymous');
    this.load.on('loaderror', (file) => {
      console.error('[Preload] Failed to load:', file?.key, file?.src || file?.url || file);
    });

    // ---- main flow -----------------------------------------------------------
    const hasCached = this.cache.json.exists('levelConfig');

    if (hasCached) {
      // Cached config path
      this.configData = this.cache.json.get('levelConfig');
      enqueueAllAssets(this.configData);

      // On cached runs you wanted to start the game immediately after load:
      this.load.once('complete', () => {
        try {
          this.startGame();
        } catch (e) {
          console.error('[Preload] startGame() failed:', e);
        }
      });
      this.load.start();
    } else {
      // First time (or cache cleared): fetch config.json, then load assets
      this.load.json('levelConfig', joinPath('config.json'));

      this.load.once('filecomplete-json-levelConfig', () => {
        const cfg = this.cache.json.get('levelConfig');
        this.configData = cfg || {};

        enqueueAllAssets(this.configData);

        // On first run you wanted to show HTP overlay:
        this.load.once('complete', () => {
          try {
            this.showHtpOverlay(); // keep your behavior
          } catch (e) {
            console.error('[Preload] showHtpOverlay() failed:', e);
            // Fallback to startGame so app doesn't stall
            try { this.startGame(); } catch { }
          }
        });

        this.load.start();
      });

      // Kick off loading of the JSON
      this.load.start();
    }
  }



  create() {
    // Intentionally left blank!
    // All logic is in startGame

  }

  startGame() {
    this.state = "playing";
    this.cellSize = Math.floor(this.sys.scale.width / 30);
    this.cols = Math.floor(this.sys.scale.width / this.cellSize);
    this.rows = Math.floor(this.sys.scale.height / this.cellSize);

    const gameConfig = this.configData.config || {};
    this.speed = gameConfig.speed || 150;
    this.defaultSpeed = this.speed;
    this.powerUpThreshold = gameConfig.powerUpInterval || 10;

    this.moveTimer = 0;

    this.snake = [{ x: Math.floor(this.cols / 2), y: Math.floor(this.rows / 2) }];
    this.snakeRects = [];
    this.food = null;
    this.foodRect = null;
    this.powerUp = null;
    this.powerUpRect = null;
    this.direction = "RIGHT";
    this.nextDirection = "RIGHT";
    this.score = 0;
    this.ghostMode = false;
    this.magnetActive = false;

    this.powerUpUsedThresholds = new Set();

    this.drawBG();
    this.spawnFood();
    this.initSwipe();

    this.add.image(540, 50, 'scorebar');

    this.scoreText = this.add.text(100, 20, "Score: 0", {
      font: '50px outfit',
      fill: "#f8f8f8ff",
    });

    this.targettext = this.add.text(870, 20, `Target: ${this.targetScore}`, {
      font: '50px outfit',
      fill: "#f8f8f8ff",
    }).setOrigin(0.5, 0);

    this.countdownText = this.add.text(this.sys.scale.width / 2 - 20, 20, "", {
      font: '50px outfit',
      fill: "#ffffffff",
    }).setOrigin(0.5, 0);

    this.soundEat = () => { };

    if (this.sound.locked) {
      this.sound.once(Phaser.Sound.Events.UNLOCKED, () => {
        this.bgMusic = this.sound.add("bg_music", { loop: true, volume: 0.5 });
        this.bgMusic.play();
      });
    } else {
      this.bgMusic = this.sound.add("bg_music", { loop: true, volume: 0.5 });
      this.bgMusic.play();
    }
  }

  // ... rest of your code unchanged ...



  drawBG() {
    if (this.sys.textures.exists('background')) {
      this.add.image(0, 0, 'background').setOrigin(0).setDisplaySize(this.sys.scale.width, this.sys.scale.height);
    } else {
      this.add.rectangle(0, 0, this.sys.scale.width, this.sys.scale.height, 0xffffff).setOrigin(0);
    }
  }


  spawnFood() {
    do {
      this.food = {
        x: Phaser.Math.Between(0, this.cols - 1),
        y: Phaser.Math.Between(1, this.rows - 1),
        type: 'normal'
      };
    } while (
      this.snake.some((s) => s.x === this.food.x && s.y === this.food.y) ||
      (this.powerUp && this.powerUp.x === this.food.x && this.powerUp.y === this.food.y)
    );

    if (this.foodRect) this.foodRect.destroy();

    this.foodRect = this.add.image(
      this.food.x * this.cellSize + this.cellSize / 2,
      this.food.y * this.cellSize + this.cellSize / 2,
      this.food.type
    );

    const size = this.cellSize * 4;
    this.foodRect.setDisplaySize(size, size);
  }

  spawnPowerUp() {
    const type = Phaser.Utils.Array.GetRandom(['big', 'slow', 'boost', 'bomb', 'ghost', 'magnet']);
    let x, y;
    do {
      x = Phaser.Math.Between(0, this.cols - 1);
      y = Phaser.Math.Between(1, this.rows - 1);
    } while (
      this.snake.some((s) => s.x === x && s.y === y) ||
      (this.food && this.food.x === x && this.food.y === y)
    );

    this.powerUp = { x, y, type };

    if (this.powerUpRect) this.powerUpRect.destroy();

    this.powerUpRect = this.add.image(
      x * this.cellSize + this.cellSize / 2,
      y * this.cellSize + this.cellSize / 2,
      type
    );
    this.powerUpRect.setDisplaySize(this.cellSize * 2, this.cellSize * 2);

    // ⚡ Flashing effect
    this.sys.tweens.add({
      targets: this.powerUpRect,
      alpha: { from: 1, to: 0.3 },
      yoyo: true,
      repeat: -1,
      duration: 500,
    });
  }

  initSwipe() {
    let startX, startY;
    this.input.on("pointerdown", (p) => {
      startX = p.x;
      startY = p.y;
    });

    this.input.on("pointerup", (p) => {
      if (this.state !== "playing") {
        // this.scene.restart();
        return;
      }

      const dx = p.x - startX;
      const dy = p.y - startY;
      if (Math.abs(dx) > Math.abs(dy)) {
        if (dx > 10 && this.direction !== "LEFT") this.nextDirection = "RIGHT";
        else if (dx < -10 && this.direction !== "RIGHT") this.nextDirection = "LEFT";
      } else {
        if (dy > 10 && this.direction !== "UP") this.nextDirection = "DOWN";
        else if (dy < -10 && this.direction !== "DOWN") this.nextDirection = "UP";
      }
    });
  }

  update(time, delta) {
    if (this.state !== "playing") return;
    if (this.state === "gameover") return;

    if (this.magnetActive) {
      this.pullFoodTowardSnake();
    }

    // Show countdown to next power-up
    const nextTarget = Math.ceil(this.score / 10) * 10;
    if (this.countdownText) {
      if (nextTarget > this.score && nextTarget - this.score <= 3) {
        this.countdownText.setText(`Next Power-Up in: ${nextTarget - this.score}`);
      } else {
        this.countdownText.setText('');
      }
    }

    // Check if score threshold reached for power-up spawn
    if (
      this.score > 0 &&
      this.score % 10 === 0 &&
      !this.powerUp &&
      !this.powerUpUsedThresholds.has(this.score)
    ) {
      this.spawnPowerUp();
      this.powerUpUsedThresholds.add(this.score);
    }

    this.moveTimer += delta;
    if (this.moveTimer >= this.speed) {
      this.moveTimer = 0;
      this.moveSnake();
      this.renderSnake();
    }
  }

  showHtpOverlay() {
    this.state = "htp";
    this.clearOverlay();

    const centerX = this.sys.scale.width / 2;
    const centerY = this.sys.scale.height / 2;
    this.overlayGroup = this.add.group();

    const htpBox = this.add.image(centerX, centerY, "htpbox").setOrigin(0.5).setDepth(10);
    const playBtn = this.add.image(centerX, centerY + htpBox.displayHeight / 2 + 150, "playbtn").setOrigin(0.5).setDepth(10).setInteractive({ useHandCursor: true });
    const txt = this.add.text(centerX - 50, centerY - htpBox.displayHeight / 2 + 500, `Swipe to control the snake.\nEat food to grow longer and\nscore points. Hitting a wall or\nbiting yourself ends the game.\n Target:${this.targetScore}`, {
      align: "left",
      font: "50px outfit",
      color: "white",
    }).setOrigin(0.5).setDepth(11);

    this.overlayGroup.addMultiple([htpBox, playBtn, txt]);
    playBtn.once('pointerup', () => {
      this.clearOverlay();
      this.startGame();
    });
  }

  showGameOverOverlay() {
    this.state = "gameover";
    this.clearOverlay();

    const centerX = this.sys.scale.width / 2;
    const centerY = this.sys.scale.height / 2;
    this.overlayGroup = this.add.group();

    const ovrBox = this.add.image(centerX, centerY, "ovrbox").setOrigin(0.5).setDepth(10);
    const replayBtn = this.add.image(centerX, centerY + ovrBox.displayHeight / 2 + 120, "replay").setOrigin(0.5).setDepth(10).setInteractive({ useHandCursor: true });
    const txt = this.add.text(centerX, centerY, "Try Again", {
      font: "50px outfit",
      color: "#fffcfcff",
    }).setOrigin(0.5).setDepth(11);

    this.overlayGroup.addMultiple([ovrBox, replayBtn, txt]);
    replayBtn.once("pointerup", () => {
      this.clearOverlay();
      this.showHtpOverlay();
    });
  }

  showWinOverlay() {
    this.state = "win";
    if (this.bgMusic) this.bgMusic.stop();

    this.clearOverlay();

    const centerX = this.sys.scale.width / 2;
    const centerY = this.sys.scale.height / 2;
    this.overlayGroup = this.add.group();

    const lvlBox = this.add.image(centerX, centerY, "lvlbox").setOrigin(0.5).setDepth(10);
    const nextBtn = this.add.image(centerX + 240, centerY + lvlBox.displayHeight / 2 + 80, "next").setOrigin(0.5).setDepth(10).setInteractive({ useHandCursor: true });
    const replayBtn = this.add.image(centerX - 240, centerY + lvlBox.displayHeight / 2 + 80, "lvl_replay").setOrigin(0.5).setDepth(10).setInteractive({ useHandCursor: true });
    const txt = this.add.text(centerX, centerY, "YOU WIN!", {
      font: "50px outfit",
      color: "#ffffffff",
    }).setOrigin(0.5).setDepth(11);

    this.overlayGroup.addMultiple([lvlBox, nextBtn, replayBtn, txt]);
    replayBtn.once("pointerup", () => {
      this.clearOverlay();
      this.showHtpOverlay();
    });
    nextBtn.once("pointerup", () => {
      this.clearOverlay();
      this.notifyParent('sceneComplete', { result: 'win' });
    });
  }

  clearOverlay() {
    if (this.overlayGroup) {
      this.overlayGroup.clear(true, true);
      this.overlayGroup = null;
    }
  }

  notifyParent(type, data) {
    if (window.parent !== window) {
      window.parent.postMessage({ type, ...data }, "*");
    }
  }


  moveSnake() {
    this.direction = this.nextDirection;
    const head = { ...this.snake[0] };

    if (this.direction === "RIGHT") head.x++;
    else if (this.direction === "LEFT") head.x--;
    else if (this.direction === "UP") head.y--;
    else if (this.direction === "DOWN") head.y++;

    const hitWall = head.x < 0 || head.x >= this.cols || head.y < 0 || head.y >= this.rows;
    const hitSelf = this.snake.some((s) => s.x === head.x && s.y === head.y);

    if (!this.ghostMode && (hitWall || hitSelf)) {
      this.gameOver();
      return;
    }

    if (this.ghostMode) {
      head.x = (head.x + this.cols) % this.cols;
      head.y = (head.y + this.rows) % this.rows;
    }

    this.snake.unshift(head);

    const headPixelX = head.x * this.cellSize + this.cellSize / 2;
    const headPixelY = head.y * this.cellSize + this.cellSize / 2;

    const foodBounds = this.foodRect.getBounds();
    const powerBounds = this.powerUpRect ? this.powerUpRect.getBounds() : null;

    let ateSomething = false;

    if (Phaser.Geom.Rectangle.Contains(foodBounds, headPixelX, headPixelY)) {
      this.activatePower('normal');
      this.spawnFood();
      ateSomething = true;
    }

    if (this.powerUp && powerBounds && Phaser.Geom.Rectangle.Contains(powerBounds, headPixelX, headPixelY)) {
      this.activatePower(this.powerUp.type);
      this.powerUp = null;
      this.powerUpRect.destroy();
      this.powerUpRect = null;
      ateSomething = true;
    }

    if (!ateSomething) {
      this.snake.pop();
    }
  }

  activatePower(type) {
    switch (type) {
      case "normal":
        this.score++;
        break;
      case "big":
        this.score += 5;
        for (let i = 0; i < 4; i++) this.snake.push({ x: -1, y: -1 });
        break;
      case "slow":
        this.speed = 300;
        this.time.delayedCall(5000, () => this.speed = this.defaultSpeed);
        break;
      case "boost":
        this.speed = 75;
        this.time.delayedCall(5000, () => this.speed = this.defaultSpeed);
        break;
      case "bomb":
        this.gameOver();
        return;
      case "ghost":
        this.ghostMode = true;
        this.time.delayedCall(5000, () => this.ghostMode = false);
        break;
      case "magnet":
        this.magnetActive = true;
        this.time.delayedCall(5000, () => this.magnetActive = false);
        break;
    }
    if (this.scoreText) this.scoreText.setText("Score: " + this.score);
    if (this.score >= this.targetScore) {
      this.showWinOverlay();
      return;
    }


    this.soundEat();
  }

  pullFoodTowardSnake() {
    const head = this.snake[0];
    if (this.food.x < head.x) this.food.x++;
    else if (this.food.x > head.x) this.food.x--;
    if (this.food.y < head.y) this.food.y++;
    else if (this.food.y > head.y) this.food.y--;

    this.foodRect.setPosition(
      this.food.x * this.cellSize + this.cellSize / 2,
      this.food.y * this.cellSize + this.cellSize / 2
    );
  }

  renderSnake() {
    this.snakeRects.forEach(r => r.destroy());
    this.snakeRects = this.snake.map(s =>
      this.add.rectangle(
        s.x * this.cellSize + this.cellSize / 2,
        s.y * this.cellSize + this.cellSize / 2,
        this.cellSize * 2 - 2,
        this.cellSize * 2 - 2,
        0x00ff00
      )
    );
  }

  gameOver() {
    this.showGameOverOverlay();
    this.state = "gameover";
    if (this.bgMusic) this.bgMusic.stop();

    this.snakeRects.forEach(r => r.destroy());
    this.snakeRects = [];
    if (this.foodRect) this.foodRect.destroy();
    if (this.powerUpRect) this.powerUpRect.destroy();
    this.foodRect = null;
    this.powerUpRect = null;

    this.scoreText.destroy();
    this.countdownText.destroy();

    this.add.rectangle(0, 0, this.sys.scale.width, this.sys.scale.height, 0x000000).setOrigin(0);


    this.add.text(this.sys.scale.width / 2, this.sys.scale.height / 2.5 + 50, `Score: ${this.score}`, {
      font: "32px",
      fill: "#ffffff",
    }).setOrigin(0.5);

    // this.add.text(this.sys.scale.width / 2, this.sys.scale.height / 1.5, "Tap to Restart", {
    //   font: "24px",
    //   fill: "#00ffff",
    // }).setOrigin(0.5);
  }
}
