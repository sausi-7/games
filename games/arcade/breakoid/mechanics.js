export default class MechanicsScene extends Phaser.Scene {
  constructor() {
    super("MechanicsScene");

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

      const images = cfg.images1 || {};
      const images2 = cfg.images2 || {};
      const ui = cfg.ui || {};
      const sheets = cfg.sheets || {};
      const audio = cfg.audio || {};
      const spacemanData = sheets.spaceman || {};


      for (const [key, url] of Object.entries(images)) {
        this.load.image(key, `${basePath}/${url}`);
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
    this.config = this.cache.json.get("levelConfig") || {};
    const m = this.config.mechanics || {};
    this.gameStarted = false;
    const gravityValue = m.gravity ?? 0;
    this.physics.world.gravity.y = gravityValue;

    this.timeLimit = m.timeLimit ?? 60;
    this.ballInitialSpeed = m.ballInitialSpeed ?? 2000;
    this.ballMinSpeed = m.ballMinSpeed ?? 600;
    this.ballMaxSpeed = m.ballMaxSpeed ?? 1000;
    this.paddleSpeed = m.paddleSpeed ?? 5;
    this.paddleLerpFactor = m.paddleLerpFactor ?? 0.15;
    this.paddleWidthRatio = m.paddleWidthRatio ?? 0.25;
    this.paddleHeight = m.paddleHeight ?? 20;
    this.ballRadius = m.ballRadius ?? 12;
    this.winScore = m.winScore ?? 250;

    this.brickRows = m.brickRows ?? 3;
    this.brickCols = m.brickCols ?? 5;
    this.brickHeight = m.brickHeight ?? 30;
    this.brickSpacing = m.brickSpacing ?? 10;
    this.brickColors = m.brickColors ?? [0x00bfff, 0xffcc00, 0xff3399];

    this.hasEnded = false;
    if (this.config.audio?.bgm) {
      this.bgm = this.sound.add("bgm", { loop: true, volume: 0.5 });
      this.bgm.play();
    }
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
    // HOW TO PLAY OVERLAY
    this.htpOverlay = this.add.container(0, 0).setDepth(10); // full overlay container

    this.blur = this.add
      .rectangle(0, 0, 1080, 1920, 0x000000, 0.5)
      .setOrigin(0);
    this.howToPlayBox = this.add.image(540, 820, "htp");

    this.descriptionText = this.add
      .text(
        540,
        800,
        "Swipe to move the paddle and bounce the ball! Break bricks to score — each tile gives 10 points. Keep the ball in play and aim for a high score!",
        {
          font: "60px Outfit",
          color: "#ffffff",
          wordWrap: { width: 800, useAdvancedWrap: true },
        }
      )
      .setOrigin(0.5);

    this.targetLabel = this.add
      .text(240, 1200, "Target", {
        font: "60px Outfit",
        color: "#ffffff",
      })
      .setOrigin(0.5);

    this.targetScoreText = this.add
      .text(850, 1200, `${this.winScore}`, {
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

    this.timeLeft = this.timeLimit;
    // this.timerText = this.add.text(16, 16, `Time: ${this.timeLeft}`, {
    //   fontSize: `50px`,
    //   fill: "#000000",
    //   stroke: "#000000",
    //   fontFamily: "Outfit",
    // });

    this.timerEvent = this.time.addEvent({
      delay: 1000,
      callback: this.tickTimer,
      callbackScope: this,
      loop: true,
    });
    this.score = 0;

    this.add.image(550, 70, "scorebar").setDepth(10);
    this.timerText = this.add
      .text(80, 40, `Time: ${this.timeLeft}`, {
        fontSize: `50px`,
        fill: "#FFFFFF",
        stroke: "#FFFFFF",
        fontFamily: "Outfit",
      })
      .setDepth(11);
    this.scoreText = this.add
      .text(W - 60, 40, `Score: 0`, {
        fontSize: `50px`,
        fill: "#FFFFFF",
        stroke: "#FFFFFF",
        fontFamily: "Outfit",
      })
      .setOrigin(1, 0)
      .setDepth(11);

    // Paddle
    // const paddleWidth = W * this.paddleWidthRatio;
    const paddleWidth = W * this.paddleWidthRatio;
    this.paddle = this.add.image(W / 2, H - 100, "platform");
    this.paddle.displayWidth = paddleWidth;
    this.paddle.displayHeight = this.paddleHeight + 150;

    this.physics.add.existing(this.paddle, true); // static body

    // Now safely override body size and offset
    // this.paddle.body.setSize(20, 200);
    // this.paddle.body.setOffset(200, 200);

    this.paddle.displayWidth = W * this.paddleWidthRatio;
    this.paddle.displayHeight = this.paddleHeight + 150;
    this.physics.add.existing(this.paddle, true);

    this.ball = this.add.image(W, H, "ball");
    this.ball.setScale(0.1);

    this.physics.add.existing(this.ball);

    this.ball.body.setCollideWorldBounds(true);
    this.ball.body.setBounce(1, 1);
    this.ball.body.onWorldBounds = true;

    this.physics.world.setBoundsCollision(true, true, true, false);

    // this.resetBall();

    // Bricks
    this.bricks = this.physics.add.staticGroup();
    const brickWidth = (W / this.brickCols) * 0.8;
    const startX =
      (W -
        (this.brickCols * brickWidth +
          (this.brickCols - 1) * this.brickSpacing)) /
      2;
    const startY = 150;

    for (let row = 0; row < this.brickRows; row++) {
      for (let col = 0; col < this.brickCols; col++) {
        const x =
          startX + col * (brickWidth + this.brickSpacing) + brickWidth / 2;
        const y =
          startY +
          row * (this.brickHeight + this.brickSpacing) +
          this.brickHeight / 2;
        const color = this.brickColors[row % this.brickColors.length];
        const brick = this.add.rectangle(
          x,
          y,
          brickWidth,
          this.brickHeight,
          color
        );
        this.physics.add.existing(brick, true);
        this.bricks.add(brick);
      }
    }

    // Colliders
    this.physics.add.collider(
      this.ball,
      this.paddle,
      (ball, paddle) => {
        if (this.gameStarted) this.hitPaddle(ball, paddle);
      },
      null,
      this
    );

    this.physics.add.collider(
      this.ball,
      this.bricks,
      (ball, brick) => {
        if (this.gameStarted) this.hitBrick(ball, brick);
      },
      null,
      this
    );

    this.targetX = this.paddle.x;
    this.input.on("pointermove", (pointer) => {
      this.targetX = pointer.x;
    });
    this.ball.setVisible(false);
    this.cursors = this.input.keyboard.createCursorKeys();
  }

  tickTimer() {
    if (!this.gameStarted || this.hasEnded) return;
    this.timeLeft--;
    this.timerText.setText(`Time: ${this.timeLeft}`);
    if (this.timeLeft <= 0) this.loseGame();
  }

  resetBall() {
    const W = this.sys.game.config.width;
    const H = this.sys.game.config.height;

    this.ball.setPosition(W / 2, H - 140);
    this.ball.body.setVelocity(0, 0);

    this.time.delayedCall(100, () => {
      const angle = Phaser.Math.Between(-45, 45);
      const rad = Phaser.Math.DegToRad(angle);
      const vx = Math.sin(rad) * this.ballInitialSpeed;
      const vy = -Math.cos(rad) * this.ballInitialSpeed;
      this.ball.body.setVelocity(vx, vy);
    });
  }

  hitPaddle(ball, paddle) {
    const relativeHit = (ball.x - paddle.x) / (paddle.displayWidth / 2);
    const clamped = Phaser.Math.Clamp(relativeHit, -1, 1); // Avoid extremes

    // Angle range: -75° to +75° (stronger direction control)
    const maxBounceAngle = 75;
    const angleDeg = clamped * maxBounceAngle;
    const angleRad = Phaser.Math.DegToRad(angleDeg);

    const speed = Math.max(
      this.ballMinSpeed,
      Math.min(this.ballInitialSpeed, ball.body.speed || this.ballInitialSpeed)
    );

    const vx = Math.sin(angleRad) * speed;
    const vy = -Math.cos(angleRad) * speed;

    ball.body.setVelocity(vx, vy);
  }

  hitBrick(ball, brick) {
    if (this.config.audio?.tap) {
      this.sound.play("tap", { volume: 0.5 });
    }

    brick.destroy();

    this.score += 10;
    this.scoreText.setText(`Score: ${this.score}`);

    const particles = this.add.particles(brick.x, brick.y, "white", {
      speed: { min: 50, max: 100 },
      scale: { start: 0.3, end: 0 },
      lifespan: 300,
      quantity: 5,
    });
    this.time.delayedCall(300, () => particles.destroy());

    // Win condition 1: All bricks destroyed
    const noBricksLeft = this.bricks.countActive() === 0;
    const reachedScore = this.score >= this.winScore;

    if ((noBricksLeft || reachedScore) && !this.hasEnded) {
      this.winGame();
    }
  }

  update() {
    if (!this.gameStarted || this.hasEnded) return;

    if (this.targetX !== undefined) {
      this.paddle.x += (this.targetX - this.paddle.x) * this.paddleLerpFactor;
      this.paddle.x = Phaser.Math.Clamp(
        this.paddle.x,
        this.paddle.displayWidth / 2,
        this.sys.game.config.width - this.paddle.displayWidth / 2
      );

      this.paddle.body.updateFromGameObject();
    }

    if (this.cursors.left.isDown) {
      this.targetX = Math.max(
        this.paddle.x - this.paddleSpeed,
        this.paddle.displayWidth / 2
      );
    } else if (this.cursors.right.isDown) {
      this.targetX = Math.min(
        this.paddle.x + this.paddleSpeed,
        this.sys.game.config.width - this.paddle.displayWidth / 2
      );
    }

    const v = this.ball.body.velocity;
    const speed = Math.sqrt(v.x * v.x + v.y * v.y);

    if (speed < this.ballMinSpeed && speed > 0) {
      const factor = this.ballMinSpeed / speed;
      this.ball.body.setVelocity(v.x * factor, v.y * factor);
    } else if (speed > this.ballMaxSpeed) {
      const factor = this.ballMaxSpeed / speed;
      this.ball.body.setVelocity(v.x * factor, v.y * factor);
    }
    if (this.ball.y > this.sys.game.config.height + this.ball.displayHeight) {
      this.loseGame();
    }
  }
  startGame() {
    this.gameStarted = true;

    if (this.htpOverlay) {
      this.htpOverlay.destroy(); // remove full container with all children
    }

    this.ball.setVisible(true);
    this.resetBall();
  }

  winGame() {
    this.timerEvent.remove();
    if (this.bgm && this.bgm.isPlaying) {
      this.bgm.stop();
    }
    this.hasEnded = true;
    this.ball.setVisible(false);
    this.ball.body.setVelocity(0);
    if (this.config.audio?.levelCompleted) {
      this.levelCompleted = this.sound.add("levelCompleted", {
        loop: false,
        volume: 0.5,
      });
      this.levelCompleted.play();
    }
    const blur = this.add
      .rectangle(0, 0, 1080, 1920, 0x000000, 0.5)
      .setOrigin(0)
      .setDepth(9);
    console.log("Blur created for win screen:", blur);

    const winBox = this.add.image(540, 820, "level_complete").setDepth(10);

    const buttonY = 1000 + 150;
    const buttonSpacing = 240;
    const ttScore = this.add
      .text(250, 820, "Target", {
        font: "60px Outfit",
        color: "#FFFFFF",
      })
      .setOrigin(0.5)
      .setDepth(11);

    const ttScoreYour = this.add
      .text(870, 830, `${this.winScore}`, {
        font: "60px Outfit",
        color: "#FFFFFF",
      })
      .setOrigin(0.5)
      .setDepth(11);

    const yourScore = this.add
      .text(300, 980, "Your Score", {
        font: "60px Outfit",
        color: "#FFFFFF",
      })
      .setOrigin(0.5)
      .setDepth(11);

    const yourUserScore = this.add
      .text(870, 980, `${this.score}`, {
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
      console.log("Replay button clicked (win screen)");
      blur.destroy();
      winBox.destroy();
      yourScore.destroy();
      yourUserScore.destroy();
      replayButton.destroy();
      nextButton.destroy();
      this.scene.restart();
    });

    nextButton.on("pointerdown", () => {
      console.log("Next button clicked (win screen)");
      blur.destroy();
      winBox.destroy();
      yourScore.destroy();
      yourUserScore.destroy();
      replayButton.destroy();
      nextButton.destroy();
      this.notifyParent('sceneComplete', { result: 'win' })
    });

    this.gameState = "won";
    if (this.bgm && this.bgm.isPlaying) {
      this.bgm.stop();
    }
  }
  notifyParent(type, data) {
    if (window.parent !== window) {
      window.parent.postMessage({ type, ...data }, "*");
    }
  }

  loseGame() {
    if (this.hasEnded) return;
    if (this.bgm && this.bgm.isPlaying) {
      this.bgm.stop();
    }
    if (this.config.audio?.gameover) {
      this.gameover = this.sound.add("gameover", { loop: false, volume: 0.5 });
      this.gameover.play();
    }

    this.hasEnded = true;
    this.timerEvent.remove();
    this.ball.body.setVelocity(0, 0);
    this.ball.setVisible(false);

    const blur = this.add
      .rectangle(0, 0, 1080, 1920, 0x000000, 0.5)
      .setOrigin(0)
      .setDepth(9);
    console.log("Blur created:", blur);

    const ttScore = this.add
      .text(250, 820, "Target", {
        font: "60px Outfit",
        color: "#FFFFFF",
      })
      .setOrigin(0.5)
      .setDepth(11);

    const ttScoreYour = this.add
      .text(870, 830, `${this.winScore}`, {
        font: "60px Outfit",
        color: "#FFFFFF",
      })
      .setOrigin(0.5)
      .setDepth(11);

    const yourScore = this.add
      .text(300, 980, "Your Score", {
        font: "60px Outfit",
        color: "#FFFFFF",
      })
      .setOrigin(0.5)
      .setDepth(11);

    const yourUserScore = this.add
      .text(870, 980, `${this.score}`, {
        font: "60px Outfit",
        color: "#FFFFFF",
      })
      .setOrigin(0.5)
      .setDepth(11);

    const restartButton = this.add
      .image(540, 1170, "replay_level")
      .setInteractive()
      .setDepth(10);

    const gameOverBox = this.add.image(540, 820, "game_over").setDepth(10);
    restartButton.on("pointerdown", () => {
      console.log("Restart button clicked");
      blur.destroy();
      gameOverBox.destroy();
      restartButton.destroy();
      yourUserScore.destroy();
      yourScore.destroy();
      ttScoreYour.destroy();
      ttScore.destroy();
      this.scene.restart(); // ✅ Correct
    });
  }
}
