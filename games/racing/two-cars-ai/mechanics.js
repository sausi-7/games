// mechanics.js
export default class GamePlayScene extends Phaser.Scene {
  constructor() {
    super("GamePlayScene");

    this.cars = [];
    this.carColors = [0xff0000, 0x0000ff]; // left lanes red, right lanes blue
    this.carTurnSpeed = 250;
    this.obstacleSpeed = 600;
    this.obstacleDelay = 1400;

    this.carGroup = null;
    this.obstacleGroup = null;
    this.targetGroup = null;

    this.carBaseY = 0;

    // Lives (player only)
    this.playerLives = 3;
    this.livesText = null;

    // score
    this.score = 0;
    this.scoreText = null;

    // 🔥 Target score
    this.targetScore = 50;
    this.targetText = null;

    // Audio
    this.bgm = null;

    // Config
    this.configData = null;
    this.basePath = null;

    // Game state
    this.gameStarted = false;
    this.gameOver = false;

    // Overlays
    this.startOverlay = null;
    this.winOverlay = null;
    this.gameOverOverlay = null;

    // Text bundle from JSON
    this.uiText = {};

    // Simple AI timing
    this.aiDecisionCooldown = 0;
    this.aiDecisionInterval = 150; // ms between checks for danger

    // Spawner event
    this.spawnEvent = null;
  }

  // ---------- PARENT COMMUNICATION ----------
  notifyParent(type, data) {
    if (window.parent !== window) {
      window.parent.postMessage({ type, ...data }, "*");
    }
  }

  preload() {
    // Path to this folder (same as config.json, assets, etc.)
    this.basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf("/"));

    // 1) Load config.json first
    this.load.json("levelConfig", `${this.basePath}/config.json`);

    // 2) When config is loaded, queue all images & audio from it
    this.load.once("filecomplete-json-levelConfig", () => {
      this.configData = this.cache.json.get("levelConfig") || {};

      const images = this.configData.images1 || {};
      Object.entries(images).forEach(([key, relPath]) => {
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

      const audio = this.configData.audio || {};
      Object.entries(audio).forEach(([key, relPath]) => {
        // ✅ If it's an absolute URL, use as is; otherwise prefix basePath
        const isAbsolute = /^https?:\/\//i.test(relPath);
        const fullPath = isAbsolute ? relPath : `${this.basePath}/${relPath}`;
        this.load.audio(key, fullPath);
      });
    });
  }

  create() {
    const { width, height } = this.scale;
    const cfg = this.configData || {};

    this.input.addPointer(3);

    // ---------- MECHANICS FROM JSON ----------
    const mech = cfg.mechanics || {};
    this.playerLives = mech.initialLives ?? 3;
    this.score = mech.initialScore ?? 0;
    this.obstacleSpeed = mech.obstacleSpeed ?? this.obstacleSpeed;
    this.obstacleDelay = mech.obstacleDelay ?? this.obstacleDelay;

    // 🔥 Allow overriding targetScore from JSON
    this.targetScore = mech.targetScore ?? 50;

    // ---------- TEXT LABELS FROM JSON ----------
    const textCfg = cfg.text || {};
    this.uiText = {
      livesLabel: textCfg.livesLabel || "Lives",
      scoreLabel: textCfg.scoreLabel || "Score",
      timeLabel: textCfg.timeLabel || "Time", // unused now, but kept in case

      howToPlayTitle: textCfg.howToPlayTitle || "How To Play",
      controlLabel: textCfg.controlLabel || "Control",
      avoidLabel: textCfg.avoidLabel || "Avoid",
      collectLabel: textCfg.collectLabel || "Collect",

      levelCompletedTitle: textCfg.levelCompletedTitle || "Level Completed",
      gameOverTitle: textCfg.gameOverTitle || "Game Over",
      gameOverScorePrefix: textCfg.gameOverScorePrefix || "Score: "
    };

    // ---------- AUDIO SETTINGS ----------
    const audioSettings = cfg.audioSettings || {};
    const bgmKey = audioSettings.bgmKey || "bgm"; // which audio key to use as bgm
    const bgmVolume = audioSettings.bgmVolume ?? 0.5;

    this.driftKey = audioSettings.driftKey || "drift";

    // ---------- BGM ----------
    if (this.bgm && this.bgm.isPlaying) {
      this.bgm.stop();
    }

    if (this.cache.audio.exists(bgmKey)) {
      this.bgm = this.sound.add(bgmKey, {
        loop: true,
        volume: bgmVolume
      });
      this.bgm.play();
    } else {
      console.warn("BGM key not found in audio cache:", bgmKey);
    }

    // Kill global gravity – we move everything manually
    this.physics.world.gravity.y = 0;

    // Background
    const roadKey = (cfg.keys && cfg.keys.roadKey) || "track";
    const road = this.add.image(width / 2, height / 2, roadKey);
    road.setDisplaySize(width, height);
    road.setDepth(0);

    this.physics.world.setBounds(0, 0, width, height);

    this.carGroup = this.physics.add.group();

    // Obstacles + targets share similar settings via groups
    this.obstacleGroup = this.physics.add.group({
      allowGravity: false,
      immovable: true
    });

    this.targetGroup = this.physics.add.group({
      allowGravity: false,
      immovable: true
    });

    this.carBaseY = height - 250;

    // ---------- UI: LIVES / SCORE / TARGET ----------

    // Score background (left)
    this.scoreback = this.add.image(30, 40, "scoreback");
    this.scoreback.setOrigin(0, 0);
    this.scoreback.setDepth(15);

    // Lives background (right)
    this.scoreback1 = this.add.image(750, 40, "scoreback");
    this.scoreback1.setOrigin(0, 0);
    this.scoreback1.setDepth(15);

    // 🔥 Target background (middle)
    this.scoreback2 = this.add.image(400, 40, "scoreback");
    this.scoreback2.setOrigin(0, 0);
    this.scoreback2.setDepth(15);

    // Lives text
    this.livesText = this.add.text(
      width / 2 + 350,
      80,
      `${this.uiText.livesLabel}: ${this.playerLives}`,
      {
        fontFamily: "Outfit",
        fontSize: "48px",
        color: "#020101ff"
      }
    );
    this.livesText.setOrigin(0.5);
    this.livesText.setDepth(20);

    // Score text
    this.scoreText = this.add.text(
      110,
      80,
      `${this.uiText.scoreLabel}: ${this.score}`,
      {
        fontFamily: "Outfit",
        fontSize: "44px",
        color: "#000000ff"
      }
    );
    this.scoreText.setOrigin(0, 0.5);
    this.scoreText.setDepth(20);

    // 🔥 Target text on top of scoreback2
    this.targetText = this.add.text(
      400 + this.scoreback2.displayWidth / 2,
      80,
      `Target: ${this.targetScore}`,
      {
        fontFamily: "Outfit",
        fontSize: "44px",
        color: "#000000ff"
      }
    );
    this.targetText.setOrigin(0.5);
    this.targetText.setDepth(20);

    // ---------- CARS ----------
    const car1Key = (cfg.keys && cfg.keys.car1Key) || "top_view_fullvehicle";
    const car2Key = (cfg.keys && cfg.keys.car2Key) || "top_view_fullvehicle2";

    this.cars = [];
    for (let i = 0; i < 2; i++) {
      const carKey = i === 0 ? car1Key : car2Key;
      const car = this.physics.add.sprite(0, this.carBaseY, carKey);
      car.setScale(0.5);
      car.setOrigin(0.5);

      // Two lanes per side (4 total)
      car.positions = [
        (width * (i * 4 + 1)) / 8,
        (width * (i * 4 + 3)) / 8
      ];

      car.canMove = true;
      car.side = i;
      car.x = car.positions[car.side];

      car.body.setAllowGravity(false);
      car.body.setVelocity(0, 0);
      car.body.setGravity(0, 0);
      car.body.immovable = true;

      car.setDepth(10);

      // Mark AI vs Player
      car.isAI = (i === 0); // left car AI, right car player

      this.cars.push(car);
      this.carGroup.add(car);
    }

    // ---------- COLLISIONS ----------
    this.physics.add.overlap(
      this.carGroup,
      this.obstacleGroup,
      this.onHitObstacle,
      null,
      this
    );

    this.physics.add.overlap(
      this.carGroup,
      this.targetGroup,
      this.onHitTarget,
      null,
      this
    );

    // DO NOT start spawner/input yet
    this.gameStarted = false;
    this.gameOver = false;

    // ---------- SHOW START OVERLAY ----------
    this.showStartOverlay();
  }

  // ---------- COMMON LANE SWITCH HELPER ----------
  switchCarLane(car, playSound = false) {
    if (!car || !car.canMove || this.gameOver || !this.gameStarted) return;

    if (playSound && this.driftKey && this.cache.audio.exists(this.driftKey)) {
      this.sound.play(this.driftKey, {
        loop: false,
        volume: 0.1
      });
    }

    car.canMove = false;

    // Tilt animation
    this.tweens.add({
      targets: car,
      angle: 20 - 40 * car.side,
      duration: this.carTurnSpeed / 2,
      ease: "Linear",
      onComplete: () => {
        this.tweens.add({
          targets: car,
          angle: 0,
          duration: this.carTurnSpeed / 2,
          ease: "Linear"
        });
      }
    });

    // Switch lane (inner <-> outer)
    car.side = 1 - car.side;

    this.tweens.add({
      targets: car,
      x: car.positions[car.side],
      duration: this.carTurnSpeed,
      ease: "Linear",
      onComplete: () => {
        car.canMove = true;
      }
    });
  }

  // ---------- START / WIN / GAME OVER LOGIC ----------

  startGame() {
    if (this.startOverlay) {
      this.startOverlay.destroy();
      this.startOverlay = null;
    }

    this.gameStarted = true;
    this.gameOver = false;

    // INPUT: only controls **player** car (right side)
    this.input.on("pointerdown", this.moveCar, this);

    // SPAWNER
    this.spawnEvent = this.time.addEvent({
      delay: this.obstacleDelay,
      callback: this.spawnRow,
      callbackScope: this,
      loop: true
    });
  }

  stopGameplay() {
    // stop spawner
    if (this.spawnEvent) {
      this.spawnEvent.remove(false);
      this.spawnEvent = null;
    }
    // stop input
    this.input.off("pointerdown", this.moveCar, this);
  }

  handleWin() {
    if (this.gameOver) return;
    this.gameOver = true;
    this.stopGameplay();
    this.showWinOverlay();
  }

  handleGameOver() {
    if (this.gameOver) return;
    this.gameOver = true;
    this.stopGameplay();
    this.showGameOverOverlay();
  }

  // ---------- SPAWNING ----------

  // Spawn a row: for each side (left/right), either an obstacle or a target
  spawnRow() {
    if (!this.gameStarted || this.gameOver) return;

    for (let lane = 0; lane < 2; lane++) {
      const spawnObstacle = Phaser.Math.Between(0, 1) === 1;
      if (spawnObstacle) {
        this.spawnObstacle(lane);
      } else {
        this.spawnTarget(lane);
      }
    }
  }

  spawnObstacle(lane) {
    const { width } = this.scale;
    const position = Phaser.Math.Between(0, 1) + 2 * lane; // 0/1 or 2/3
    const x = (width * (position * 2 + 1)) / 8;

    const obstacle = this.obstacleGroup.create(x, -50, "traffic_cone_topview");
    obstacle.setOrigin(0.5);
    obstacle.setDepth(5);
    obstacle.setScale(0.9);

    obstacle.setTint(this.carColors[Math.floor(position / 2)]);
    obstacle.setVelocityY(this.obstacleSpeed);
  }

  spawnTarget(lane) {
    const { width } = this.scale;
    const position = Phaser.Math.Between(0, 1) + 2 * lane; // 0/1 or 2/3
    const x = (width * (position * 2 + 1)) / 8;

    const target = this.targetGroup.create(x, -50, "fuel");
    target.setOrigin(0.5);
    target.setDepth(5);
    target.setScale(0.8);

    target.setTint(this.carColors[Math.floor(position / 2)]);
    target.setVelocityY(this.obstacleSpeed);
  }

  // ---------- INPUT (PLAYER ONLY) ----------
  moveCar(pointer) {
    if (!this.gameStarted || this.gameOver) return;

    // Always control the **right** car (index 1)
    const playerCar = this.cars[1];
    this.switchCarLane(playerCar, true);
  }

  // ---------- COLLISIONS ----------
  onHitObstacle(car, obstacle) {
    if (!this.gameStarted || this.gameOver) return;

    if (obstacle && obstacle.destroy) obstacle.destroy();

    // Play hit sound (key must exist in config.audio)
    if (this.cache.audio.exists("hit")) {
      this.sound.play("hit");
    }

    // If AI crashes -> player wins
    if (car.isAI) {
      this.handleWin();
      return;
    }

    // Player crash -> lose life, if 0 then AI wins (game over)
    this.playerLives -= 1;
    if (this.livesText) {
      this.livesText.setText(`${this.uiText.livesLabel}: ${this.playerLives}`);
    }

    if (this.playerLives <= 0) {
      this.handleGameOver();
    } else {
      if (car && car.setAlpha) {
        this.tweens.add({
          targets: car,
          alpha: 0.2,
          yoyo: true,
          repeat: 3,
          duration: 80
        });
      }
    }
  }

  onHitTarget(car, target) {
    if (!this.gameStarted || this.gameOver) return;

    if (target && target.destroy) target.destroy();

    // Play collect sound (key must exist in config.audio)
    if (this.cache.audio.exists("collect")) {
      this.sound.play("collect");
    }

    // +10 score for each target collected (only player score matters for UI & win)
    if (!car.isAI) {
      this.score += 10;
      if (this.scoreText) {
        this.scoreText.setText(`${this.uiText.scoreLabel}: ${this.score}`);
      }

      // 🔥 Win when reaching or exceeding target score
      if (this.score >= this.targetScore) {
        this.handleWin();
      }
    }
  }

  // ---------- AI HELPERS ----------
  findIncomingObstacle(car, laneXOverride = null) {
    // Look for the closest obstacle in the given lane (or current car.x),
    // ahead of the car, within a danger distance.
    let danger = null;
    let closestDist = Infinity;

    const dangerDistance = 600; // how far ahead to look
    const laneTolerance = 100;  // how close in x to be considered same lane

    const laneX = laneXOverride !== null ? laneXOverride : car.x;

    this.obstacleGroup.children.iterate((obs) => {
      if (!obs) return;

      const dx = Math.abs(obs.x - laneX);
      if (dx > laneTolerance) return; // not same lane

      const dy = car.y - obs.y; // positive = obstacle is ahead
      if (dy > 0 && dy < dangerDistance && dy < closestDist) {
        closestDist = dy;
        danger = obs;
      }
    });

    return danger;
  }

  // ---------- UPDATE LOOP ----------
  update(time, delta) {
    const { height } = this.scale;

    // Keep cars locked to base Y
    this.cars.forEach((car) => {
      if (!car) return;
      car.y = this.carBaseY;
      if (car.body) {
        car.body.velocity.y = 0;
      }
    });

    // Clean up off-screen obstacles/targets
    this.obstacleGroup.children.iterate((obj) => {
      if (!obj) return;
      if (obj.y > height + obj.displayHeight) {
        obj.destroy();
      }
    });

    this.targetGroup.children.iterate((obj) => {
      if (!obj) return;
      if (obj.y > height + obj.displayHeight) {
        obj.destroy();
      }
    });

    // ---------- Simple AI: dodge obstacles ----------
    if (this.gameStarted && !this.gameOver) {
      this.aiDecisionCooldown -= delta;
      if (this.aiDecisionCooldown <= 0) {
        this.aiDecisionCooldown = this.aiDecisionInterval;

        const aiCar = this.cars[0]; // left car
        if (aiCar && aiCar.canMove) {
          // Check danger in current lane
          const dangerCurrent = this.findIncomingObstacle(aiCar);

          if (dangerCurrent) {
            // Check the other lane – only switch if other lane is safe
            const otherLaneX = aiCar.positions[1 - aiCar.side];
            const dangerOther = this.findIncomingObstacle(aiCar, otherLaneX);

            if (!dangerOther) {
              this.switchCarLane(aiCar, false);
            }
          }
        }
      }
    }
  }

  // ---------- OVERLAYS ----------
  showStartOverlay() {
    const { width, height } = this.scale;

    const container = this.add.container(0, 0);
    container.setDepth(50);
    this.startOverlay = container;

    // Background
    const bg = this.add.image(width / 2, height / 2, "htpbg");
    bg.setDisplaySize(width, height);

    // Box
    const box = this.add.image(width / 2, height / 2, "htpbox");
    box.setScale(0.55, 0.8);

    // Title (from JSON)
    const title = this.add.text(
      width / 2,
      height / 2 - 260,
      this.uiText.howToPlayTitle,
      {
        fontFamily: "Outfit",
        fontSize: "64px",
        color: "#ffffff"
      }
    );
    title.setOrigin(0.5);

    // --- NEW ROWS: Control / Avoid / Collect ---
    const rowStartY = height / 2 - 40;
    const rowGap = 110;
    const labelX = width / 2 - 260;

    // Control row
    const controlLabel = this.add.text(
      labelX - 130,
      rowStartY + 230,
      this.uiText.controlLabel,
      {
        fontFamily: "Outfit",
        fontSize: "52px",
        color: "#ffffff"
      }
    );
    controlLabel.setOrigin(0, 0.5);

    const controlCar1 = this.add.image(
      width / 2 - 410,
      rowStartY,
      "top_view_fullvehicle"
    );
    controlCar1.setScale(0.5);

    const controlCar2 = this.add.image(
      width / 2 - 220,
      rowStartY,
      "top_view_fullvehicle2"
    );
    controlCar2.setScale(0.5);

    // Avoid row
    const avoidY = rowStartY + rowGap;
    const avoidLabel = this.add.text(
      labelX + 500,
      avoidY + 120,
      this.uiText.avoidLabel,
      {
        fontFamily: "Outfit",
        fontSize: "52px",
        color: "#ffffff"
      }
    );
    avoidLabel.setOrigin(0, 0.5);

    const avoidObstacle = this.add.image(
      width / 2 + 300,
      avoidY - 100,
      "traffic_cone_topview"
    );
    avoidObstacle.setScale(0.6);

    // Collect row
    const collectY = rowStartY + rowGap * 2;
    const collectLabel = this.add.text(
      labelX + 200,
      collectY + 10,
      this.uiText.collectLabel,
      {
        fontFamily: "Outfit",
        fontSize: "52px",
        color: "#ffffff"
      }
    );
    collectLabel.setOrigin(0, 0.5);

    const collectTarget = this.add.image(
      width / 2 + 30,
      collectY - 200,
      "fuel"
    );
    collectTarget.setScale(0.8);

    // Play button
    const playBtn = this.add.image(width / 2, height / 2 + 470, "playbtn");
    playBtn.setScale(1);
    playBtn.setInteractive({ useHandCursor: true });
    playBtn.on("pointerup", () => {
      this.startGame();
    });

    container.add([
      bg,
      box,
      title,
      controlLabel,
      controlCar1,
      controlCar2,
      avoidLabel,
      avoidObstacle,
      collectLabel,
      collectTarget,
      playBtn
    ]);
  }

  showWinOverlay() {
    const { width, height } = this.scale;

    if (this.winOverlay) {
      this.winOverlay.destroy();
      this.winOverlay = null;
    }

    const container = this.add.container(0, 0);
    container.setDepth(60);
    this.winOverlay = container;

    // Background
    const bg = this.add.image(width / 2, height / 2, "winbg");
    bg.setDisplaySize(width, height);

    // Box
    const box = this.add.image(width / 2, height / 2, "lvlbox");
    box.setScale(0.55);

    // Text (from JSON)
    const title = this.add.text(
      width / 2,
      height / 2,
      this.uiText.levelCompletedTitle,
      {
        fontFamily: "Outfit",
        fontSize: "74px",
        color: "#ffffff"
      }
    );
    title.setOrigin(0.5);

    // Buttons
    const nextBtn = this.add.image(width / 2 + 230, height / 2 + 320, "next");
    nextBtn.setScale(1);
    nextBtn.setInteractive({ useHandCursor: true });
    nextBtn.on("pointerup", () => {
      this.notifyParent("sceneComplete", { result: "win" });
    });

    const replayBtn = this.add.image(
      width / 2 - 230,
      height / 2 + 320,
      "replay"
    );
    replayBtn.setScale(1);
    replayBtn.setInteractive({ useHandCursor: true });
    replayBtn.on("pointerup", () => {
      this.scene.restart();
    });

    container.add([bg, box, title, nextBtn, replayBtn]);
  }

  showGameOverOverlay() {
    const { width, height } = this.scale;

    if (this.gameOverOverlay) {
      this.gameOverOverlay.destroy();
      this.gameOverOverlay = null;
    }

    const container = this.add.container(0, 0);
    container.setDepth(60);
    this.gameOverOverlay = container;

    // Background
    const bg = this.add.image(width / 2, height / 2, "ovrbg");
    bg.setDisplaySize(width, height);

    // Box
    const box = this.add.image(width / 2, height / 2, "ovrbox");
    box.setScale(0.55);

    // Title (from JSON)
    const title = this.add.text(
      width / 2,
      height / 2 - 140,
      this.uiText.gameOverTitle,
      {
        fontFamily: "Outfit",
        fontSize: "74px",
        color: "#ffffff"
      }
    );
    title.setOrigin(0.5);

    // Score text (prefix from JSON)
    const scoreText = this.add.text(
      width / 2,
      height / 2 + 50,
      `${this.uiText.gameOverScorePrefix}${this.score}`,
      {
        fontFamily: "Outfit",
        fontSize: "48px",
        color: "#ffffff"
      }
    );
    scoreText.setOrigin(0.5);

    // Replay button
    const replayBtn = this.add.image(
      width / 2,
      height / 2 + 350,
      "replay_level"
    );
    replayBtn.setScale(1);
    replayBtn.setInteractive({ useHandCursor: true });
    replayBtn.on("pointerup", () => {
      this.scene.restart();
    });

    container.add([bg, box, title, scoreText, replayBtn]);
  }
}
