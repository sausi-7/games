// mechanics.js (Phaser 3, 1080x1920, default export, overlays + score + JSON config + audio)

const bgColors = [0x62bd18, 0xffbb00, 0xff5300, 0xd21034, 0xff475c, 0x8f16b2];
const angleRange = [25, 155];

// 🔍 Visual scales
const BALL_SCALE = 1.9; // make balls bigger
const TARGET_SCALE = 1.7; // make targets bigger
const ARM_SCALE = 1.5; // make arm slightly bigger

export default class GamePlayScene extends Phaser.Scene {
  constructor() {
    super("GamePlayScene");

    // Config from JSON
    this.configData = null;
    this.mechanics = null;
    this.texts = null;

    // Game state (no best score now)
    this.tintColor = 0xffffff;
    this.tintColor2 = 0xffffff;

    this.targetArray = [];
    this.steps = 0;
    this.rotatingDirection = 0; // 0 or 1
    this.rotationAngle = 0;
    this.rotatingBall = 1;
    this.destroyFlag = false;
    this.saveRotationSpeed = 0; // set after mechanics load

    // Display containers / objects
    this.gameGroup = null;
    this.ballContainer = null;
    this.targetContainer = null;
    this.arm = null;
    this.balls = [];
    this.bgImage = null;
    this.scoreback = null;
    this.scoreback1 = null;

    // Scoring + target
    this.targetGoal = 0;
    this.currentScore = 0;
    this.scoreText = null;
    this.targetText = null;

    // Overlays
    this.startOverlay = null;
    this.winOverlay = null;
    this.gameOverOverlay = null;

    // Audio
    this.bgm = null;
    this.collectSfx = null;

    // Game flow flags
    this.isGameOver = false;
    this.gameStarted = false;
  }

  preload() {
    // 1) Load config.json
    this.load.json("levelConfig", "config.json");

    // 2) Once config is loaded, queue all images & audio from it
    this.load.once("filecomplete-json-levelConfig", () => {
      const cfg = this.cache.json.get("levelConfig");

      if (!cfg) {
        console.error("config.json missing or invalid");
        return;
      }

      this.configData = cfg;

      // Extract sections
      const { images1, images2, ui, audio, mechanics, texts } = cfg;

      // Save mechanics & texts for later
      this.mechanics = mechanics || {};
      this.texts = texts || {};

      // Images1 (gameplay)
      if (images1) {
        Object.keys(images1).forEach((key) => {
          this.load.image(key, images1[key]);
        });
      }

      // Images2 (backgrounds etc.)
      if (images2) {
        Object.keys(images2).forEach((key) => {
          this.load.image(key, images2[key]);
        });
      }

      // UI images
      if (ui) {
        Object.keys(ui).forEach((key) => {
          this.load.image(key, ui[key]);
        });
      }

      // Audio
      if (audio) {
        Object.keys(audio).forEach((key) => {
          this.load.audio(key, audio[key]);
        });
      }
    });
  }

  create() {
    const width = this.scale.width; // 1080
    const height = this.scale.height; // 1920

    // Safety fallback if config somehow missing
    if (!this.configData) {
      console.error("Config data not loaded. Check config.json and paths.");
      // Provide minimal fallbacks so game does not crash
      this.mechanics = this.mechanics || {
        ballDistance: 180,
        rotationSpeed: 4,
        visibleTargets: 7,
        targetGoal: 5,
      };
      this.texts = this.texts || {
        scoreLabel: "Score",
        targetLabel: "Target",
        howToPlayTitle: "How to Play",
        howToPlayBody:
          "Tap when the moving ball\nis over the next target.\n\nMiss a tap and you lose!",
        winTitle: "Level Completed",
        gameOverTitle: "Game Over",
      };
    }

    // Apply mechanics from JSON
    this.saveRotationSpeed = this.mechanics.rotationSpeed || 4;
    this.targetGoal = this.mechanics.targetGoal || 5;
    this.visibleTargets = this.mechanics.visibleTargets || 7;
    this.ballDistance = this.mechanics.ballDistance || 180;

    this.isGameOver = false;
    this.gameStarted = false;
    this.targetArray = [];
    this.balls = [];
    this.currentScore = 0;

    // 🌄 BACKGROUND IMAGE (from images2.bg)
    this.bgImage = this.add.image(width / 2, height / 2, "bg");
    this.bgImage.setDisplaySize(width, height);
    this.bgImage.setDepth(-10); // behind everything

    // Colors for balls / target text
    this.tintColor = Phaser.Math.RND.pick(bgColors);
    do {
      this.tintColor2 = Phaser.Math.RND.pick(bgColors);
    } while (this.tintColor === this.tintColor2);

    // Camera background now irrelevant (covered by bg.png)
    this.cameras.main.setBackgroundColor(0x000000);

    // 🔊 Audio instances
    if (this.sound && this.cache.audio.has("bgm")) {
      this.bgm = this.sound.add("bgm", {
        loop: true,
        volume: 0.6,
      });
    }
    if (this.sound && this.cache.audio.has("collect")) {
      this.collectSfx = this.sound.add("collect", {
        volume: 1,
      });
    }

    // Play BGM as soon as scene starts (and keep it playing on win/lose)
    if (this.bgm) {
      this.bgm.play();
    }

    // 🔝 HUD: Score + Target (with scoreback under them)
    const hudStyle = {
      fontFamily: "outfit",
      fontSize: "48px",
      fontStyle: "bold",
      color: "#000000ff",
    };

    // Score background & text
    this.scoreback = this.add.image(190, 90, "scoreback");
    this.scoreText = this.add
      .text(80, 60, `${this.texts.scoreLabel || "Score"}: 0`, hudStyle)
      .setDepth(1);
    this.scoreText.setOrigin(0, 0);

    // Target background & text
    this.scoreback1 = this.add.image(890, 90, "scoreback");
    this.targetText = this.add
      .text(
        width - 80,
        60,
        `${this.texts.targetLabel || "Target"}: ${this.targetGoal}`,
        hudStyle
      )
      .setDepth(1);
    this.targetText.setOrigin(1, 0);

    // Containers
    this.gameGroup = this.add.container(0, 0);
    this.ballContainer = this.add.container(0, 0);
    this.targetContainer = this.add.container(0, 0);

    this.gameGroup.add([this.targetContainer, this.ballContainer]);

    // Base positions (same as original logic: height/4 * 2.7)
    const baseY = (height / 4) * 2.7;

    // Arm
    this.arm = this.add.sprite(width / 2, baseY, "arm");
    this.arm.setOrigin(0, 0.5);
    this.arm.setTint(this.tintColor2);
    this.arm.setScale(ARM_SCALE);
    this.ballContainer.add(this.arm);

    // Balls
    const ball1 = this.add.sprite(width / 2, baseY, "ball");
    ball1.setOrigin(0.5);
    ball1.setTint(this.tintColor2);
    ball1.setScale(BALL_SCALE);

    const ball2 = this.add.sprite(width / 2, height / 2, "ball");
    ball2.setOrigin(0.5);
    ball2.setTint(this.tintColor2);
    ball2.setScale(BALL_SCALE);

    this.balls = [ball1, ball2];
    this.ballContainer.add([ball1, ball2]);

    // Initial rotation + state
    this.rotationAngle = 0;
    this.rotatingBall = 1;
    this.rotatingDirection = Phaser.Math.Between(0, 1);
    this.destroyFlag = false;
    this.steps = 0;

    // First target on ball[0]
    const firstTarget = this.createTargetContainer(ball1.x, ball1.y, 0);
    this.targetContainer.add(firstTarget);
    this.targetArray.push(firstTarget);

    // Input (but will be ignored until gameStarted = true)
    this.input.on("pointerdown", this.changeBall, this);

    // Pre-generate visible targets (from mechanics.visibleTargets)
    for (let i = 0; i < this.visibleTargets; i++) {
      this.addTarget();
    }

    // Show start overlay last so it's on top
    this.showStartOverlay();
  }

  update() {
    // 🔒 Stop gameplay movement after win/lose
    if (
      this.isGameOver ||
      !this.balls ||
      this.balls.length < 2 ||
      !this.balls[0] ||
      !this.balls[1]
    ) {
      return;
    }

    // We allow rotation even before start; taps just won't do anything
    this.rotationAngle =
      (this.rotationAngle +
        this.saveRotationSpeed * (this.rotatingDirection * 2 - 1)) %
      360;

    const rad = Phaser.Math.DegToRad(this.rotationAngle);
    const centerBall = this.balls[1 - this.rotatingBall];
    const orbitBall = this.balls[this.rotatingBall];

    if (!centerBall || !orbitBall || !this.arm) {
      return;
    }

    orbitBall.x = centerBall.x - this.ballDistance * Math.sin(rad);
    orbitBall.y = centerBall.y + this.ballDistance * Math.cos(rad);

    this.arm.x = centerBall.x;
    this.arm.y = centerBall.y;
    this.arm.angle = this.rotationAngle + 90;

    // Recenter gameGroup so the "other" ball stays near the original base position
    const width = this.scale.width;
    const height = this.scale.height;
    const baseY = (height / 4) * 2.7;

    const ballWorldX = centerBall.x + this.gameGroup.x;
    const ballWorldY = centerBall.y + this.gameGroup.y;

    const distanceX = ballWorldX - width / 2;
    const distanceY = ballWorldY - baseY;

    this.gameGroup.x = Phaser.Math.Linear(
      this.gameGroup.x,
      this.gameGroup.x - distanceX,
      0.05
    );
    this.gameGroup.y = Phaser.Math.Linear(
      this.gameGroup.y,
      this.gameGroup.y - distanceY,
      0.05
    );
  }

  changeBall() {
    // ignore taps until game actually started
    if (!this.gameStarted || this.isGameOver || this.targetArray.length <= 1) {
      return;
    }

    this.destroyFlag = false;

    const currentBall = this.balls[this.rotatingBall];
    const nextTarget = this.targetArray[1];

    if (!currentBall || !nextTarget) return;

    const distanceFromTarget = Phaser.Math.Distance.Between(
      currentBall.x,
      currentBall.y,
      nextTarget.x,
      nextTarget.y
    );

    // 👉 Only here we decide: hit or miss
    if (distanceFromTarget < 20) {
      // Success
      this.rotatingDirection = Phaser.Math.Between(0, 1);

      const firstTarget = this.targetArray[0];
      this.tweens.add({
        targets: firstTarget,
        alpha: 0,
        duration: 500,
        ease: "Cubic.easeIn",
        onComplete: () => {
          firstTarget.destroy();
        },
      });

      this.targetArray.shift();

      // Move arm to current ball
      this.arm.x = currentBall.x;
      this.arm.y = currentBall.y;

      // Swap rotating ball
      this.rotatingBall = 1 - this.rotatingBall;

      // Recompute angle so motion continues smoothly
      const otherBall = this.balls[1 - this.rotatingBall];
      if (otherBall) {
        this.rotationAngle =
          Phaser.Math.RadToDeg(
            Phaser.Math.Angle.Between(
              otherBall.x,
              otherBall.y,
              currentBall.x,
              currentBall.y
            )
          ) - 90;
        this.arm.angle = this.rotationAngle + 90;
      }

      // Fade targets in slightly
      for (let i = 0; i < this.targetArray.length; i++) {
        this.targetArray[i].alpha = Math.min(
          1,
          this.targetArray[i].alpha + 1 / 7
        );
      }

      // Add next target
      this.addTarget();

      // 🧮 Update score (number of successful hits)
      this.currentScore += 1;
      if (this.scoreText) {
        this.scoreText.setText(
          `${this.texts.scoreLabel || "Score"}: ${this.currentScore}`
        );
      }

      // 🔊 Play collect SFX on scoring
      if (this.collectSfx) {
        this.collectSfx.play();
      }

      // Check win condition (from JSON)
      if (this.currentScore >= this.targetGoal) {
        this.handleWin();
        return;
      }
    } else {
      // Missed on tap
      this.gameOver();
      return;
    }
  }

  addTarget() {
    this.steps++;

    const lastTarget = this.targetArray[this.targetArray.length - 1];
    const startX = lastTarget.x;
    const startY = lastTarget.y;

    const randomAngle = Phaser.Math.Between(
      angleRange[0] + 90,
      angleRange[1] + 90
    );

    const targetX =
      startX +
      this.ballDistance * Math.sin(Phaser.Math.DegToRad(randomAngle));
    const targetY =
      startY +
      this.ballDistance * Math.cos(Phaser.Math.DegToRad(randomAngle));

    const target = this.createTargetContainer(targetX, targetY, this.steps);
    target.alpha = 1 - this.targetArray.length * (1 / 7);

    this.targetContainer.add(target);
    this.targetArray.push(target);
  }

  createTargetContainer(x, y, stepNumber) {
    const targetSprite = this.add.sprite(0, 0, "target");
    targetSprite.setOrigin(0.5);
    targetSprite.setScale(TARGET_SCALE);

    const colorHex = "#" + this.tintColor.toString(16).padStart(6, "0");

    const text = this.add.text(0, 0, stepNumber.toString(), {
      fontFamily: "outfit",
      fontSize: "32px",
      fontStyle: "bold",
      color: colorHex,
      align: "center",
    });
    text.setOrigin(0.5);

    const container = this.add.container(x, y, [targetSprite, text]);
    return container;
  }

  // 🔹 Start / HTP overlay
  showStartOverlay() {
    const width = this.scale.width;
    const height = this.scale.height;

    this.startOverlay = this.add.container(0, 0);
    this.startOverlay.setDepth(1000);

    const bg = this.add.image(width / 2, height / 2, "htpbg");
    bg.setDisplaySize(width, height);

    const box = this.add
      .image(width / 2, height / 2, "htpbox")
      .setScale(0.55, 0.8);

    const title = this.add.text(
      width / 2,
      height / 2 - 220,
      this.texts.howToPlayTitle || "How to Play",
      {
        fontFamily: "outfit",
        fontSize: "72px",
        fontStyle: "bold",
        color: "#ffffff",
        align: "center",
      }
    );
    title.setOrigin(0.5);

    const instructions = this.add.text(
      width / 2,
      height / 2,
      this.texts.howToPlayBody ||
        "Tap when the moving ball\nis over the next target.\n\nMiss a tap and you lose!",
      {
        fontFamily: "outfit",
        fontSize: "50px",
        color: "#ffffff",
        align: "center",
        wordWrap: { width: box.displayWidth * 0.8 },
      }
    );
    instructions.setOrigin(0.5);

    const playBtn = this.add.image(width / 2, height / 2 + 450, "playbtn");
    playBtn.setInteractive({ useHandCursor: true });

    playBtn.on("pointerdown", () => {
      this.gameStarted = true;
      if (this.startOverlay) {
        this.startOverlay.destroy();
        this.startOverlay = null;
      }
    });

    this.startOverlay.add([bg, box, title, instructions, playBtn]);
  }

  // 🔹 Win logic + overlay
  handleWin() {
    if (this.isGameOver) return;
    this.isGameOver = true;

    this.saveRotationSpeed = 0;
    if (this.arm) this.arm.setVisible(false);
    this.input.off("pointerdown", this.changeBall, this);

    this.showWinOverlay();
    // ❗ Do NOT stop BGM here – keep it running
  }

  showWinOverlay() {
    const width = this.scale.width;
    const height = this.scale.height;

    this.winOverlay = this.add.container(0, 0);
    this.winOverlay.setDepth(1000);

    const bg = this.add.image(width / 2, height / 2, "winbg");
    bg.setDisplaySize(width, height);

    const box = this.add
      .image(width / 2, height / 2, "lvlbox")
      .setScale(0.55);

    const title = this.add.text(
      width / 2,
      height / 2,
      this.texts.winTitle || "Level Completed",
      {
        fontFamily: "outfit",
        fontSize: "72px",
        fontStyle: "bold",
        color: "#ffffff",
        align: "center",
      }
    );
    title.setOrigin(0.5);

    const replayBtn = this.add.image(
      width / 2 - 230,
      height / 2 + 320,
      "lvl_replay"
    );
    replayBtn.setInteractive({ useHandCursor: true });
    replayBtn.on("pointerdown", () => {
      // Stop BGM and restart scene => BGM restarts from create()
      if (this.bgm) this.bgm.stop();
      this.scene.restart();
    });

    const nextBtn = this.add.image(
      width / 2 + 230,
      height / 2 + 320,
      "nextbtn"
    );
    nextBtn.setInteractive({ useHandCursor: true });
    nextBtn.on("pointerdown", () => {
      // Optional: stop BGM when leaving level
      if (this.bgm) this.bgm.stop();
      this.notifyParent("sceneComplete", { result: "win" });
    });

    this.winOverlay.add([bg, box, title, replayBtn, nextBtn]);
  }

  // 🔹 Game over logic + overlay
  gameOver() {
    if (this.isGameOver) return;
    this.isGameOver = true;

    this.input.off("pointerdown", this.changeBall, this);
    this.saveRotationSpeed = 0;

    if (this.arm) {
      this.arm.setVisible(false);
    }

    this.showGameOverOverlay();
    // ❗ Do NOT stop BGM here either
  }

  showGameOverOverlay() {
    const width = this.scale.width;
    const height = this.scale.height;

    this.gameOverOverlay = this.add.container(0, 0);
    this.gameOverOverlay.setDepth(1000);

    const bg = this.add.image(width / 2, height / 2, "ovrbg");
    bg.setDisplaySize(width, height);

    const box = this.add
      .image(width / 2, height / 2, "ovrbox")
      .setScale(0.55);

    const title = this.add.text(
      width / 2,
      height / 2 - 150,
      this.texts.gameOverTitle || "Game Over",
      {
        fontFamily: "outfit",
        fontSize: "72px",
        fontStyle: "bold",
        color: "#ffffff",
        align: "center",
      }
    );
    title.setOrigin(0.5);

    const info = this.add.text(
      width / 2,
      height / 2,
      `${this.texts.scoreLabel || "Score"}: ${this.currentScore}\n${
        this.texts.targetLabel || "Target"
      }: ${this.targetGoal}`,
      {
        fontFamily: "outfit",
        fontSize: "48px",
        color: "#ffffff",
        align: "center",
      }
    );
    info.setOrigin(0.5);

    const replayBtn = this.add.image(
      width / 2,
      height / 2 + 360,
      "replaybtn"
    );
    replayBtn.setInteractive({ useHandCursor: true });
    replayBtn.on("pointerdown", () => {
      // Stop BGM and restart scene => BGM restarts from create()
      if (this.bgm) this.bgm.stop();
      this.scene.restart();
    });

    this.gameOverOverlay.add([bg, box, title, info, replayBtn]);
  }

  // 🔹 PostMessage helper for parent
  notifyParent(type, data) {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type, ...data }, "*");
    }
  }
}
