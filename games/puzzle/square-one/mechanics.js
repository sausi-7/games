// mechanics.js — Full JSON-driven version (Phaser 3)

export default class GamePlayScene extends Phaser.Scene {
  constructor() {
    super("GamePlayScene");

    this.configData = null;

    this.terrainGroup = null;
    this.enemyGroup = null;
    this.hero = null;

    this.squareSize = 100;

    this.distance = 0;
    this.distanceText = null;

    this.mode = "start";

    this.startOverlay = null;
    this.winOverlay = null;
    this.gameOverOverlay = null;

    this.bg = null;

    // 🔊 Background music reference
    this.bgm = null;
  }

  preload() {
    // Load config.json
    this.load.json("gameConfig", "config.json");

    // After config loads → load all images & audio dynamically
    this.load.once("filecomplete-json-gameConfig", () => {
      this.configData = this.cache.json.get("gameConfig");

      const images2 = this.configData.images2 || {};
      const ui = this.configData.ui || {};
      const audio = this.configData.audio || {};

      // Load gameplay images
      for (const key in images2) {
        this.load.image(key, images2[key]);
      }

      // Load UI images
      for (const key in ui) {
        this.load.image(key, ui[key]);
      }

      // 🔊 Load audio from JSON
      for (const key in audio) {
        this.load.audio(key, audio[key]);
      }

      this.load.start(); // continue loading
    });
  }

  create() {
    this.configData = this.cache.json.get("gameConfig");

    const M = this.configData.mechanics;

    this.squareSize = Math.round((this.scale.width / M.baseWidth) * M.baseTileSize);
    this.startSquare = M.startSquare;
    this.moveTime = M.moveTime;
    this.targetDistance = M.targetDistance;
    this.squareColors = M.squareColors;

    const width = this.scale.width;
    const height = this.scale.height;

    // 🔊 ==== BACKGROUND MUSIC ====
    // expects "bgm" key in config.json -> audio.bgm = "assets/bgm.mp3"
    const existingBgm = this.sound.get("bgm");
    if (existingBgm) {
      this.bgm = existingBgm;
      if (!this.bgm.isPlaying) {
        this.bgm.play({ loop: true, volume: 0.7 });
      }
    } else if (this.cache.audio.exists("bgm")) {
      this.bgm = this.sound.add("bgm", { loop: true, volume: 0.7 });
      this.bgm.play();
    }

    // ==== BACKGROUND ====
    // expects "background" key in images2
    if (this.configData.images2 && this.configData.images2.background) {
      this.bg = this.add.image(width / 2, height / 2, "background");
      this.bg.setDisplaySize(width, height);
      this.bg.setDepth(-100); // behind everything
    }

    // Terrain
    this.terrainGroup = this.add.group();

    const s = this.squareSize;
    const groundY = height * 0.7;

    const columns = Math.ceil(width / s) + 3;

    for (let i = 0; i < columns; i++) {
      const tile = this.add.sprite(i * s, groundY, "platform");
      tile.setOrigin(0.5);
      tile.setScale(2);
      tile.setTint(this.squareColors[i % 2]);
      this.terrainGroup.add(tile);
    }

    // Enemies
    this.enemyGroup = this.physics.add.group();

    // Player
    this.hero = this.add.sprite(this.startSquare * s, groundY - s / 2, "square_player");
    this.hero.setOrigin(0.5);
    this.hero.setScale(2);

    this.physics.add.existing(this.hero);
    this.hero.body.setAllowGravity(false);
    this.hero.body.setImmovable(true);
    this.hero.canMove = true;

    // Distance Text
    this.scorebar = this.add.image(970, 70, "scorebar").setOrigin(0.5).setScale(1.2, 1);
    this.distance = 0;
    this.distanceText = this.add.text(
      820,
      40,
      `${this.configData.texts.distance_label}: 0 / ${this.targetDistance}`,
      {
        fontFamily: "Outfit",
        fontSize: "40px",
        color: "#030303ff",
      }
    ).setDepth(10);

    // Input
    this.input.on("pointerdown", () => {
      if (this.mode === "play") this.moveForward();
    });

    // Collision
    this.physics.add.overlap(
      this.hero,
      this.enemyGroup,
      () => this.onGameOver(),
      null,
      this
    );

    this.showStartOverlay();
  }

  // ========= START OVERLAY =========

  showStartOverlay() {
    const T = this.configData.texts;

    const width = this.scale.width;
    const height = this.scale.height;

    this.startOverlay = this.add.container(0, 0).setDepth(200);

    const bg = this.add.image(width / 2, height / 2, "htpbg")
      .setDisplaySize(width, height);
    const box = this.add.image(width / 2, height * 0.45, "htpbox").setScale(0.55, 0.6);

    const title = this.add.text(width / 2, height * 0.30, T.how_to_play_title, {
      fontFamily: "Outfit",
      fontSize: "70px",
      color: "#ffffff",
    }).setOrigin(0.5);

    const desc = this.add.text(width / 2 - 200, height * 0.42 + 50, T.how_to_play_desc, {
      fontFamily: "Outfit",
      fontSize: "52px",
      color: "#ffffff",
      align: "center",
    }).setOrigin(0.5);

    const img = this.add.image(width / 2 + 10, height * 0.42 + 50, "square_player").setScale(3);

    const play = this.add.image(width / 2, height * 0.70 + 100, "playbtn")
      .setInteractive()
      .setOrigin(0.5);

    play.on("pointerup", () => {
      this.startOverlay.destroy();
      this.mode = "play";
      this.addEnemy();
    });

    this.startOverlay.add([bg, box, img, title, desc, play]);
  }

  // ========= MOVEMENT =========

  moveForward() {
    if (!this.hero.canMove) return;

    const s = this.squareSize;
    this.hero.canMove = false;

    const terrainTiles = this.terrainGroup.getChildren();
    const enemies = this.enemyGroup.getChildren();

    this.tweens.add({
      targets: terrainTiles,
      x: "-=" + s,
      duration: this.moveTime,
      ease: "Linear",
    });

    this.tweens.add({
      targets: enemies,
      x: "-=" + s,
      duration: this.moveTime,
      ease: "Linear",
    });

    this.tweens.add({
      targets: this.hero,
      angle: this.hero.angle + 90,
      duration: this.moveTime,
      ease: "Linear",
      onComplete: () => {
        this.hero.canMove = true;

        this.distance++;
        this.distanceText.setText(
          `${this.configData.texts.distance_label}: ${this.distance} / ${this.targetDistance}`
        );

        if (this.distance >= this.targetDistance) {
          this.onWin();
          return;
        }

        this.recycleTerrain();
        if (Phaser.Math.Between(0, 10) > 6) this.addEnemy();
      },
    });
  }

  // ========= ENEMY =========

  addEnemy() {
    const tiles = this.terrainGroup.getChildren();
    const s = this.squareSize;

    if (!tiles.length) return;

    let rightmost = tiles[0];
    for (let t of tiles) if (t.x > rightmost.x) rightmost = t;

    const height = this.scale.height;
    const groundY = height * 0.7;

    const enemy = this.add.sprite(rightmost.x, 120, "square_enemy");
    enemy.setScale(2);

    this.physics.add.existing(enemy);
    enemy.body.setAllowGravity(false);
    enemy.body.setImmovable(true);

    this.tweens.add({
      targets: enemy,
      y: groundY - s / 2,
      duration: 800,
      yoyo: true,
      repeat: -1,
    });

    this.enemyGroup.add(enemy);
  }

  recycleTerrain() {
    const tiles = this.terrainGroup.getChildren();
    const s = this.squareSize;

    let leftmost = tiles[0];
    let rightmost = tiles[0];

    for (let t of tiles) {
      if (t.x < leftmost.x) leftmost = t;
      if (t.x > rightmost.x) rightmost = t;
    }

    if (leftmost.x < -s) {
      leftmost.x = rightmost.x + s;
    }

    const enemies = this.enemyGroup.getChildren();
    for (let e of enemies) if (e.x < -s) e.destroy();
  }

  // ========= GAME OVER =========

  onGameOver() {
    this.mode = "gameover";
    this.showGameOverOverlay();
  }

  showGameOverOverlay() {
    const T = this.configData.texts;
    const width = this.scale.width;
    const height = this.scale.height;

    this.gameOverOverlay = this.add.container(0, 0).setDepth(200);

    const bg = this.add.image(width / 2, height / 2, "ovrbg")
      .setDisplaySize(width, height);
    const box = this.add.image(width / 2, height * 0.45, "ovrbox").setScale(0.55);

    const txt = this.add.text(width / 2, height * 0.32 + 150, T.game_over, {
      fontSize: "60px",
      fontFamily: "outfit",
      color: "#ffffff",
    }).setOrigin(0.5);

    const replay = this.add.image(width / 2, height * 0.70 + 70, "replay")
      .setInteractive()
      .setOrigin(0.5);

    replay.on("pointerup", () => {
      // 🔁 Restart BGM from beginning on replay
      if (this.bgm) {
        this.bgm.stop();
        this.bgm.play();
      }
      this.scene.restart();
    });

    this.gameOverOverlay.add([bg, box, txt, replay]);
  }

  // ========= WIN =========

  onWin() {
    this.mode = "win";
    this.showWinOverlay();
  }

  showWinOverlay() {
    const T = this.configData.texts;
    const width = this.scale.width;
    const height = this.scale.height;

    this.winOverlay = this.add.container(0, 0).setDepth(200);

    const bg = this.add.image(width / 2, height / 2, "winbg")
      .setDisplaySize(width, height);
    const box = this.add.image(width / 2, height * 0.45, "lvlbox").setScale(0.55, 0.4);

    const title = this.add.text(width / 2, height * 0.32 + 100, T.level_completed, {
      fontSize: "70px",
      fontFamily: "outfit",
      color: "#ffffff",
    }).setOrigin(0.5);

    const replayBtn = this.add.image(width * 0.42 - 100, height * 0.70, "lvl_replay")
      .setOrigin(0.5)
      .setInteractive();

    replayBtn.on("pointerup", () => {
      // 🔁 Restart BGM from beginning on replay
      if (this.bgm) {
        this.bgm.stop();
        this.bgm.play();
      }
      this.scene.restart();
    });

    const nextBtn = this.add.image(width * 0.60 + 100, height * 0.70, "next")
      .setOrigin(0.5)
      .setInteractive();

    nextBtn.on("pointerup", () => {
      this.notifyParent("sceneComplete", { result: "win" });
    });

    this.winOverlay.add([bg, box, title, replayBtn, nextBtn]);
  }

  // ========= POST MESSAGE =========

  notifyParent(type, data) {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type, ...data }, "*");
    }
  }
}
