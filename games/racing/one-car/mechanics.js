// mechanics.js
export default class GamePlayScene extends Phaser.Scene {
  constructor() {
    super("GamePlayScene");

    this.cars = [];
    this.carColors = [0xff0000, 0x0000ff];
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

    // Target score (will be overridden from JSON)
    this.targetScore = 0;
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

    // Spawner event
    this.spawnEvent = null;

    // Keyboard
    this.cursors = null;
    this.keyA = null;
    this.keyD = null;
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

    // 🔥 Target score from JSON (config.mechanics.targetScore), default 100
    this.targetScore = mech.targetScore ?? 100;

    // ---------- TEXT LABELS FROM JSON ----------
    const textCfg = cfg.text || {};
    this.uiText = {
      livesLabel: textCfg.livesLabel || "Lives",
      scoreLabel: textCfg.scoreLabel || "Score",
      timeLabel: textCfg.timeLabel || "Time",

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
    const bgmKey = audioSettings.bgmKey || "bgm";
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

    // Obstacles + targets
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
    this.scoreback = this.add.image(30, 40, "scoreback");
    this.scoreback.setOrigin(0, 0);
    this.scoreback.setDepth(15);

    this.scoreback1 = this.add.image(750, 40, "scoreback");
    this.scoreback1.setOrigin(0, 0);
    this.scoreback1.setDepth(15);

    this.scoreback2 = this.add.image(400, 40, "scoreback");
    this.scoreback2.setOrigin(0, 0);
    this.scoreback2.setDepth(15);

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

    // ---------- PLAYER CAR (ONLY ONE, 4 LANES) ----------
    const carKey = (cfg.keys && cfg.keys.car2Key) || "top_view_fullvehicle2";

    this.cars = [];

    const car = this.physics.add.sprite(0, this.carBaseY, carKey);
    car.setScale(0.5);
    car.setOrigin(0.5);

    // 4 lanes across the whole road
    car.positions = [
      (width * 1) / 8, // lane 0
      (width * 3) / 8, // lane 1
      (width * 5) / 8, // lane 2
      (width * 7) / 8  // lane 3
    ];

    car.laneIndex = 1; // start in lane 1 (slightly left of center)
    car.x = car.positions[car.laneIndex];
    car.canMove = true; // ✅ important for lane switching

    car.body.setAllowGravity(false);
    car.body.setVelocity(0, 0);
    car.body.setGravity(0, 0);
    car.body.immovable = true;

    car.setDepth(10);

    this.cars.push(car);
    this.carGroup.add(car);

    // ---------- KEYBOARD SETUP ----------
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keyA = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.keyD = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);

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

    this.gameStarted = false;
    this.gameOver = false;

    // ---------- SHOW START OVERLAY ----------
    this.showStartOverlay();
  }

  // ---------- COMMON LANE SWITCH HELPER ----------
  /**
   * direction: -1 = left, +1 = right
   */
  switchCarLane(car, direction = 1, playSound = false) {
    if (!car || !car.canMove || this.gameOver || !this.gameStarted) return;

    if (playSound && this.driftKey && this.cache.audio.exists(this.driftKey)) {
      this.sound.play(this.driftKey, {
        loop: false,
        volume: 0.1
      });
    }

    car.canMove = false;

    let newLane = car.laneIndex + direction;
    const maxLane = car.positions.length - 1;

    // Clamp between 0 and maxLane (no wrap-around)
    if (newLane < 0) newLane = 0;
    if (newLane > maxLane) newLane = maxLane;

    // If already at edge and tapped further, do nothing but unlock movement
    if (newLane === car.laneIndex) {
      car.canMove = true;
      return;
    }

    car.laneIndex = newLane;

    // Small tilt for fun
    this.tweens.add({
      targets: car,
      angle: direction > 0 ? 15 : -15,
      duration: this.carTurnSpeed / 2,
      yoyo: true,
      ease: "Linear"
    });

    this.tweens.add({
      targets: car,
      x: car.positions[car.laneIndex],
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

    // INPUT: tap left/right to move one lane in that direction
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
    if (this.spawnEvent) {
      this.spawnEvent.remove(false);
      this.spawnEvent = null;
    }
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
  spawnRow() {
    if (!this.gameStarted || this.gameOver) return;

    // lane = 0 (left side: lanes 0,1) and lane = 1 (right side: lanes 2,3)
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

    const playerCar = this.cars[0];
    const { width } = this.scale;

    // Tap on right half => move right one lane
    // Tap on left half  => move left one lane
    if (pointer.x >= width / 2) {
      this.switchCarLane(playerCar, +1, true);
    } else {
      this.switchCarLane(playerCar, -1, true);
    }
  }

  // ---------- COLLISIONS ----------
  onHitObstacle(car, obstacle) {
    if (!this.gameStarted || this.gameOver) return;

    if (obstacle && obstacle.destroy) obstacle.destroy();

    if (this.cache.audio.exists("hit")) {
      this.sound.play("hit");
    }

    // Player crash -> lose life, if 0 then game over
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

    if (this.cache.audio.exists("collect")) {
      this.sound.play("collect");
    }

    this.score += 10;
    if (this.scoreText) {
      this.scoreText.setText(`${this.uiText.scoreLabel}: ${this.score}`);
    }

    // Win when reaching or exceeding target score from JSON
    if (this.score >= this.targetScore) {
      this.handleWin();
    }
  }

  // ---------- UPDATE LOOP ----------
  update(time, delta) {
    const { height } = this.scale;

    // KEYBOARD CONTROL: left/right arrows or A/D
    if (this.gameStarted && !this.gameOver && this.cars.length > 0) {
      const playerCar = this.cars[0];

      if (
        this.cursors &&
        Phaser.Input.Keyboard.JustDown(this.cursors.left)
      ) {
        this.switchCarLane(playerCar, -1, true);
      } else if (
        this.cursors &&
        Phaser.Input.Keyboard.JustDown(this.cursors.right)
      ) {
        this.switchCarLane(playerCar, +1, true);
      } else if (this.keyA && Phaser.Input.Keyboard.JustDown(this.keyA)) {
        this.switchCarLane(playerCar, -1, true);
      } else if (this.keyD && Phaser.Input.Keyboard.JustDown(this.keyD)) {
        this.switchCarLane(playerCar, +1, true);
      }
    }

    // Keep car locked to base Y
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
  }

  // ---------- OVERLAYS ----------
  showStartOverlay() {
    const { width, height } = this.scale;

    const container = this.add.container(0, 0);
    container.setDepth(50);
    this.startOverlay = container;

    const bg = this.add.image(width / 2, height / 2, "htpbg");
    bg.setDisplaySize(width, height);

    const box = this.add.image(width / 2, height / 2, "htpbox");
    box.setScale(0.55, 0.8);

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

    const rowStartY = height / 2 - 40;
    const rowGap = 110;
    const labelX = width / 2 - 260;

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

    const controlCar = this.add.image(
      width / 2 - 320,
      rowStartY,
      "top_view_fullvehicle2"
    );
    controlCar.setScale(0.5);

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
      controlCar,
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

    const bg = this.add.image(width / 2, height / 2, "winbg");
    bg.setDisplaySize(width, height);

    const box = this.add.image(width / 2, height / 2, "lvlbox");
    box.setScale(0.55);

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

    const bg = this.add.image(width / 2, height / 2, "ovrbg");
    bg.setDisplaySize(width, height);

    const box = this.add.image(width / 2, height / 2, "ovrbox");
    box.setScale(0.55);

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
