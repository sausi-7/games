const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf("/"));
export const CONFIG_PATH = `${basePath}/config.json`;

export default class GamePlayScene extends Phaser.Scene {
  constructor() {
    super("GamePlayScene");

    // core objects
    this.ball = null;
    this.arrow = null;
    this.coin = null;
    this.deadlyArray = [];
    this.hudText = null;
    this.targetText = null;
    this.background = null;

    // state
    this.rotateDirection = 1;   // 1 or -1
    this.power = 0;
    this.charging = false;
    this.score = 0;
    this.gameOver = false;
    this.gameWon = false;
    this.gameStarted = false;

    // lives / overlays
    this.lives = 2;
    this.gameOverOverlay = null;
    this.startOverlay = null;
    this.winOverlay = null;

    // target score
    this.targetScore = 10;

    // audio
    this.bgm = null;
    this.collectSfx = null;


    // tuning (base; will be scaled)
    this.friction = 0.99;
    this.ballRadius = 10;
    this.rotateSpeed = 3;
    this.minPower = 50;
    this.maxPower = 200;
    this.degToRad = Math.PI / 180;

    // HUD elements
    this.powerText = null;
    this.scoreText = null;
    this.livesText = null;
    this.targetText = null; // already there, keep it

    // HUD backgrounds
    this.powerBack = null;
    this.scoreBack = null;
    this.livesBack = null;
    this.targetBack = null;


    // config
    this.configData = null;
  }

  preload() {
    // 1) Load config.json
    this.load.json("gameConfig", CONFIG_PATH);

    // 2) Once config is loaded, load all images from it
    this.load.once("filecomplete-json-gameConfig", () => {
      const config = this.cache.json.get("gameConfig") || {};
      this.configData = config;

      const images = config.images1 || {};
      const images2 = config.images2 || {};
      const ui = config.ui || {};

      // Load every image defined in config.images
      for (const [key, relPath] of Object.entries(images)) {
        const url = relPath.startsWith("http")
          ? relPath
          : `${basePath}/${relPath}`;
        this.load.image(key, url);
      }


       for (const [key, relPath] of Object.entries(images2)) {
        const url = relPath.startsWith("http")
          ? relPath
          : `${basePath}/${relPath}`;
        this.load.image(key, url);
      }

       for (const [key, relPath] of Object.entries(ui)) {
        const url = relPath.startsWith("http")
          ? relPath
          : `${basePath}/${relPath}`;
        this.load.image(key, url);
      }

      const audio = config.audio || {};

      for (const [key, relPath] of Object.entries(audio)) {
        const url = relPath.startsWith("http")
          ? relPath
          : `${basePath}/${relPath}`;
        this.load.audio(key, url);
      }
    });
  }

  create() {
    const w = this.scale.width;   // 1080
    const h = this.scale.height;  // 1920

    // ----- Mechanics from config -----
    const mechanics = (this.configData && this.configData.mechanics) || {};
    const baseBallRadius = mechanics.ballRadius ?? 10;
    const baseMinPower = mechanics.minPower ?? 50;
    const baseMaxPower = mechanics.maxPower ?? 200;

    this.friction = mechanics.friction ?? 0.99;
    this.rotateSpeed = mechanics.rotateSpeed ?? 3;
    this.targetScore = mechanics.targetScore ?? 10;
    this.lives = mechanics.lives ?? 2;

    // scale from original 320x480
    const baseWidth = 320;
    const scaleFactor = w / baseWidth;

    this.ballRadius = baseBallRadius * scaleFactor;
    this.minPower = baseMinPower * scaleFactor;
    this.maxPower = baseMaxPower * scaleFactor;

    // reset per run
    this.score = 0;
    this.gameOver = false;
    this.gameWon = false;
    this.gameStarted = false;
    this.deadlyArray = [];
    this.gameOverOverlay = null;
    this.startOverlay = null;
    this.winOverlay = null;

    // background first
    this.background = this.add.image(w / 2, h / 2, "background");
    this.background.setDisplaySize(w, h);
    this.background.setDepth(0);

    // BALL
    this.ball = this.add.sprite(w / 2, h / 2, "ball");
    this.ball.setOrigin(0.5);
    this.ball.setDisplaySize(this.ballRadius * 2 + 10, this.ballRadius * 2 + 10);
    this.ball.xSpeed = 0;
    this.ball.ySpeed = 0;

    // ARROW
    this.arrow = this.add.sprite(w / 2, h / 2, "arrow");
    this.arrow.setOrigin(-1, 0.5);
    this.arrow.setScale(scaleFactor);

    // COIN
    this.coin = this.add.sprite(0, 0, "coin");
    this.coin.setOrigin(0.5);
    this.coin.setDisplaySize(this.ballRadius * 2, this.ballRadius * 2);

    // FIRST ENEMY
    this.placeDeadly();

    // PLACE COIN
    this.placeCoin();

    const fontFamily = this.getFontFamily();

    // You can tweak all these positions manually 👇
    const powerPos = { x: 220, y: 80 };
    const scorePos = { x: 220, y: 180 };
    const livesPos = { x: 220, y: 280 };
    const targetPos = { x: w - 220, y: 80 };

    // POWER
    this.powerBack = this.add.image(powerPos.x - 30, powerPos.y, "scoreback");
    this.powerBack.setDepth(1);

    this.powerText = this.add.text(powerPos.x - 30, powerPos.y, "", {
      fontFamily,
      fontSize: 52,
      color: "#050404ff",
    });
    this.powerText.setOrigin(0.5);
    this.powerText.setDepth(2);

    // SCORE
    this.scoreBack = this.add.image(scorePos.x + 320, 80, "scoreback");
    this.scoreBack.setDepth(1);

    this.scoreText = this.add.text(scorePos.x + 320, 80, "", {
      fontFamily,
      fontSize: 52,
      color: "#020101ff",
    });
    this.scoreText.setOrigin(0.5);
    this.scoreText.setDepth(2);

    // LIVES
    this.livesBack = this.add.image(540, livesPos.y - 80, "scoreback");
    this.livesBack.setDepth(1);

    this.livesText = this.add.text(540, livesPos.y - 80, "", {
      fontFamily,
      fontSize: 52,
      color: "#000000ff",
    });
    this.livesText.setOrigin(0.5);
    this.livesText.setDepth(2);

    // TARGET
    this.targetBack = this.add.image(targetPos.x + 30, targetPos.y, "scoreback");
    this.targetBack.setDepth(1);

    this.targetText = this.add.text(targetPos.x + 30, targetPos.y, "", {
      fontFamily,
      fontSize: 52,
      color: "#030303ff",
    });
    this.targetText.setOrigin(0.5);
    this.targetText.setDepth(2);

    this.updateHud();

    // ---- AUDIO SETUP ----
    const bgmVolume =
      (this.configData &&
        this.configData.mechanics &&
        this.configData.mechanics.bgmVolume) || 1;
    const collectVolume =
      (this.configData &&
        this.configData.mechanics &&
        this.configData.mechanics.collectVolume) || 1;

    // background music – loop, do NOT stop on win/lose
    this.bgm = this.sound.add("bgm", {
      loop: true,
      volume: bgmVolume,
    });
    this.bgm.play();

    // coin collect sfx – one-shot
    this.collectSfx = this.sound.add("collect", {
      loop: false,
      volume: collectVolume,
    });



    // Start overlay (H2P)
    this.showStartOverlay();
  }

  // ======================= Main update =======================

  update() {
    // Do nothing until game started or after win/over
    if (!this.gameStarted || this.gameOver || this.gameWon) {
      return;
    }

    // Charging power while pointer is down
    if (this.charging) {
      this.power += 1;
      this.power = Math.min(this.power, this.maxPower);
      this.updateHud();
    } else {
      // rotate arrow when not charging
      this.arrow.angle += this.rotateSpeed * this.rotateDirection;
    }

    // Move ball manually
    this.ball.x += this.ball.xSpeed;
    this.ball.y += this.ball.ySpeed;

    // Bounce off walls
    this.wallBounce();

    // Friction
    this.ball.xSpeed *= this.friction;
    this.ball.ySpeed *= this.friction;

    // Arrow follows ball
    this.arrow.x = this.ball.x;
    this.arrow.y = this.ball.y;

    // Coin pickup
    if (this.getDistance(this.ball, this.coin) < (this.ballRadius * 2) * (this.ballRadius * 2)) {
      // play collect sfx (one-shot)
      if (this.collectSfx) {
        this.collectSfx.play();
      }

      this.score += 1;


      // Check win condition BEFORE spawning more enemies
      if (this.score >= this.targetScore && !this.gameWon) {
        this.updateHud();
        this.createWinOverlay();
        return; // stop further logic this frame
      }

      this.placeDeadly();
      this.placeCoin();
      this.updateHud();
    }

    // Check collision with enemies
    for (let i = 0; i < this.deadlyArray.length; i++) {
      if (this.getDistance(this.ball, this.deadlyArray[i]) < (this.ballRadius * 2) * (this.ballRadius * 2)) {
        this.handleHit();
        break;
      }
    }
  }

  // ======================= Start overlay =======================

  showStartOverlay() {
    const w = this.scale.width;
    const h = this.scale.height;
    const fontFamily = this.getFontFamily();

    const titleText = this.getText("howToPlayTitle", "HOW TO PLAY");
    const bodyText = this.getText(
      "howToPlayBody",
      "Hold to charge power.\nRelease to shoot.\nCollect coins, avoid enemies."
    );

    const bg = this.add.image(w / 2, h / 2, "htpbg");
    bg.setDisplaySize(w, h);
    bg.setDepth(20);

    const box = this.add.image(w / 2, h / 2, "htpbox").setScale(0.55, 0.8);
    box.setDepth(21);

    const img = this.add.image(w / 2 - 350, h / 2 + 80, "ball").setScale(4);
    img.setDepth(22);

    const img1 = this.add.image(w / 2, h / 2 + 80, "coin").setScale(4);
    img1.setDepth(22);

    const img2 = this.add.image(w / 2 + 350, h / 2 + 80, "deadly").setScale(4);
    img2.setDepth(22);

    const title = this.add.text(w / 2, h / 2 - 280, titleText, {
      fontFamily,
      fontSize: 64,
      color: "#ffffff",
    });
    title.setOrigin(0.5);
    title.setDepth(22);

    const info = this.add.text(w / 2, h / 2 - 100, bodyText, {
      fontFamily,
      fontSize: 46,
      color: "#ffffff",
      align: "center",
    });
    info.setOrigin(0.5);
    info.setDepth(22);

    const info1 = this.add.text(w / 2 - 350, h / 2 + 200, "Control", {
      fontFamily,
      fontSize: 46,
      color: "#ffffff",
      align: "center",
    });
    info1.setOrigin(0.5);
    info1.setDepth(22);

    const info2 = this.add.text(w / 2 - 10, h / 2 + 200, "Colllect", {
      fontFamily,
      fontSize: 46,
      color: "#ffffff",
      align: "center",
    });
    info2.setOrigin(0.5);
    info2.setDepth(22);


    const info3 = this.add.text(w / 2 + 330, h / 2 + 200, "Avoid", {
      fontFamily,
      fontSize: 46,
      color: "#ffffff",
      align: "center",
    });
    info3.setOrigin(0.5);
    info3.setDepth(22);


    const playBtn = this.add.image(w / 2, h / 2 + 460, "playbtn");
    playBtn.setInteractive({ useHandCursor: true });
    playBtn.setDepth(22);

    playBtn.on("pointerup", () => {
      bg.destroy();
      box.destroy();
      title.destroy();
      info.destroy();
      info1.destroy();
      info2.destroy();
      info3.destroy();
      playBtn.destroy();
      img1.destroy();
      img2.destroy()
      img.destroy();
      this.startGame();
    });

    this.startOverlay = { bg, box, title, info, img, img1, img2, info1, info2, info3, playBtn };
  }

  startGame() {
    this.gameStarted = true;
    this.input.on("pointerdown", this.charge, this);
  }

  // ======================= Lives / hit handling =======================

  handleHit() {
    if (this.gameOver || this.gameWon) return;

    this.lives -= 1;

    if (this.lives > 0) {
      const w = this.scale.width;
      const h = this.scale.height;

      this.ball.x = w / 2;
      this.ball.y = h / 2;
      this.ball.xSpeed = 0;
      this.ball.ySpeed = 0;

      this.arrow.x = this.ball.x;
      this.arrow.y = this.ball.y;
      this.arrow.angle = 0;
      this.rotateDirection = 1;
      this.power = 0;
      this.charging = false;

      this.updateHud();
    } else {
      this.gameOver = true;
      this.createGameOverOverlay();
    }
  }

  // ======================= Game Over Overlay =======================

  createGameOverOverlay() {
    const w = this.scale.width;
    const h = this.scale.height;
    const fontFamily = this.getFontFamily();
    const titleText = this.getText("gameOverTitle", "GAME OVER");

    this.input.removeAllListeners();

    const bg = this.add.image(w / 2, h / 2, "ovrbg");
    bg.setDisplaySize(w, h);
    bg.setDepth(30);

    const box = this.add.image(w / 2, h / 2, "ovrbox").setScale(0.55, 0.4);
    box.setDepth(31);

    const gameOverText = this.add.text(w / 2, h / 2, titleText, {
      fontFamily,
      fontSize: 72,
      color: "#ffffff",
    });
    gameOverText.setOrigin(0.5);
    gameOverText.setDepth(32);

    const replayBtn = this.add.image(w / 2, h / 2 + 280, "replay");
    replayBtn.setInteractive({ useHandCursor: true });
    replayBtn.setDepth(32);

    replayBtn.on("pointerup", () => {
      if (this.bgm) {
        this.bgm.stop();   // stop old BGM
      }
      this.scene.restart(); // new scene will start fresh BGM in create()
    });

    this.gameOverOverlay = { bg, box, gameOverText, replayBtn };
  }

  // ======================= Win Overlay =======================

  createWinOverlay() {
    const w = this.scale.width;
    const h = this.scale.height;
    const fontFamily = this.getFontFamily();
    const winTitle = this.getText("winTitle", "LEVEL COMPLETED");

    this.gameWon = true;
    this.input.removeAllListeners();

    const bg = this.add.image(w / 2, h / 2, "winbg");
    bg.setDisplaySize(w, h);
    bg.setDepth(40);

    const box = this.add.image(w / 2, h / 2, "lvlbox").setScale(0.5, 0.4);
    box.setDepth(41);

    const title = this.add.text(w / 2, h / 2, winTitle, {
      fontFamily,
      fontSize: 64,
      color: "#ffffff",
    });
    title.setOrigin(0.5);
    title.setDepth(42);

    const replayBtn = this.add.image(w / 2 - 230, h / 2 + 260, "lvl_replay");
    replayBtn.setInteractive({ useHandCursor: true });
    replayBtn.setDepth(42);

    const nextBtn = this.add.image(w / 2 + 230, h / 2 + 260, "next");
    nextBtn.setInteractive({ useHandCursor: true });
    nextBtn.setDepth(42);
    replayBtn.on("pointerup", () => {
      if (this.bgm) {
        this.bgm.stop();   // stop old BGM
      }
      this.scene.restart();
    });

    nextBtn.on("pointerup", () => {
      this.notifyParent("sceneComplete", { result: "win" });
    });

    this.winOverlay = { bg, box, title, replayBtn, nextBtn };
  }

  // ======================= Spawning & legality =======================

  placeDeadly() {
    const w = this.scale.width;
    const h = this.scale.height;

    const deadly = this.add.sprite(0, 0, "deadly");
    deadly.setOrigin(0.5);
    deadly.setDisplaySize(this.ballRadius * 2, this.ballRadius * 2);
    this.deadlyArray.push(deadly);

    // 👇 compute min Y so enemies stay BELOW the lives HUD area
    const minY =
      this.livesText && this.livesBack
        ? this.livesText.y + this.livesBack.displayHeight / 2 + this.ballRadius
        : this.ballRadius;

    do {
      const randomX =
        Math.random() * (w - 2 * this.ballRadius) + this.ballRadius;
      const randomY =
        Math.random() * (h - minY - this.ballRadius) + minY;

      deadly.x = randomX;
      deadly.y = randomY;
    } while (this.illegalDeadly());
  }



  illegalDeadly() {
    const last = this.deadlyArray[this.deadlyArray.length - 1];

    if (this.getDistance(this.ball, last) < (this.ballRadius * 3) * (this.ballRadius * 3)) {
      return true;
    }

    for (let i = 0; i < this.deadlyArray.length - 1; i++) {
      if (this.getDistance(this.deadlyArray[i], last) < (this.ballRadius * 2) * (this.ballRadius * 2)) {
        return true;
      }
    }
    return false;
  }

  placeCoin() {
    const w = this.scale.width;
    const h = this.scale.height;

    // 👇 same min Y rule for coin
    const minY =
      this.livesText && this.livesBack
        ? this.livesText.y + this.livesBack.displayHeight / 2 + this.ballRadius
        : this.ballRadius;

    do {
      this.coin.x =
        Math.random() * (w - 2 * this.ballRadius) + this.ballRadius;
      this.coin.y =
        Math.random() * (h - minY - this.ballRadius) + minY;
    } while (this.illegalCoin());
  }


  illegalCoin() {
    if (this.getDistance(this.ball, this.coin) < (this.ballRadius * 2.5) * (this.ballRadius * 2.5)) {
      return true;
    }

    for (let i = 0; i < this.deadlyArray.length; i++) {
      if (this.getDistance(this.deadlyArray[i], this.coin) < (this.ballRadius * 3) * (this.ballRadius * 3)) {
        return true;
      }
    }
    return false;
  }

  // ======================= Physics helpers =======================

  wallBounce() {
    const w = this.scale.width;
    const h = this.scale.height;

    if (this.ball.x < this.ballRadius) {
      this.ball.x = this.ballRadius;
      this.ball.xSpeed *= -1;
    }
    if (this.ball.y < this.ballRadius) {
      this.ball.y = this.ballRadius;
      this.ball.ySpeed *= -1;
    }
    if (this.ball.x > w - this.ballRadius) {
      this.ball.x = w - this.ballRadius;
      this.ball.xSpeed *= -1;
    }
    if (this.ball.y > h - this.ballRadius) {
      this.ball.y = h - this.ballRadius;
      this.ball.ySpeed *= -1;
    }
  }

  getDistance(from, to) {
    const xDist = from.x - to.x;
    const yDist = from.y - to.y;
    return xDist * xDist + yDist * yDist;
  }

  // ======================= Input / firing =======================

  charge() {
    if (this.gameOver || this.gameWon) return;

    this.power = this.minPower;
    this.charging = true;

    this.input.off("pointerdown", this.charge, this);
    this.input.on("pointerup", this.fire, this);
  }

  fire() {
    if (this.gameOver || this.gameWon) return;

    this.input.off("pointerup", this.fire, this);
    this.input.on("pointerdown", this.charge, this);

    const rad = Phaser.Math.DegToRad(this.arrow.angle);
    this.ball.xSpeed += Math.cos(rad) * (this.power / 20);
    this.ball.ySpeed += Math.sin(rad) * (this.power / 20);

    this.power = 0;
    this.charging = false;
    this.rotateDirection *= -1;

    this.updateHud();
  }

  updateHud() {
    const targetLabel = this.getText("targetLabel", "Target");

    if (this.powerText) {
      this.powerText.setText(`Power: ${Math.round(this.power)}`);
    }
    if (this.scoreText) {
      this.scoreText.setText(`Score: ${this.score}`);
    }
    if (this.livesText) {
      this.livesText.setText(`Lives: ${this.lives}`);
    }
    if (this.targetText) {
      this.targetText.setText(`${targetLabel}: ${this.targetScore}`);
    }
  }


  // ======================= Config helpers =======================

  getFontFamily() {
    return (this.configData && this.configData.texts && this.configData.texts.fontFamily) || "outfit";
  }

  getText(key, fallback) {
    return (this.configData &&
      this.configData.texts &&
      this.configData.texts[key]) || fallback;
  }

  // ======================= Notify parent (for Next button) =======================

  notifyParent(type, data = {}) {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type, ...data }, "*");
    }
  }
}
