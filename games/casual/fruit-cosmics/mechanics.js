const basePath = import.meta.url
  ? import.meta.url.substring(0, import.meta.url.lastIndexOf("/"))
  : "./assets";

export default class MechanicsScene extends Phaser.Scene {
  constructor() {
    super("MechanicsScene");
    this.spawnCount = 0;
    this.fruitTypes = ["object"];
    this.sliceTrail = [];
    this.combo = 0;
    this.targetScore = 500;
    this.timeLefts = 60;
    this.comboTimer = null;
    this.gameState = "playing";
    this.lives = 3;
    this.missedFruits = 0;
    this.heartImages = []; // Array to store heart image references
    // Explicitly bind all methods to preserve context
    Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach((fn) => {
      if (typeof this[fn] === "function" && fn !== "constructor") {
        this[fn] = this[fn].bind(this);
      }
    });
  }
  notifyParent(type, data) {
    if (window.parent !== window) {
      window.parent.postMessage({ type, ...data }, "*");
    }
  }
  preload() {
    this.load.on("progress", (value) => console.log("Loading progress:", value));
    this.load.on("complete", () => console.log("Loading complete"));
    this.load.on("loaderror", (file) => console.error("Error loading file:", file.key, file.url));

    // If JSON already in cache (typical on restart), enqueue assets immediately.
    const cachedCfg = this.cache.json.get("levelConfig");
    if (cachedCfg) {
      console.log("Config already cached, enqueueing assets directly");
      this.enqueueAssets(cachedCfg);
      return; // Phaser will auto-start loader at end of preload
    }

    // First run: load JSON, then enqueue assets
    this.load.json("levelConfig", `${basePath}/config.json`);
    this.load.once("filecomplete-json-levelConfig", () => {
      try {
        const cfg = this.cache.json.get("levelConfig");
        if (!cfg) {
          console.error("Config file is empty or invalid");
          return;
        }
        console.log("Config loaded:", cfg);

        this.enqueueAssets(cfg);

        // We are adding new files after the loader started; kick a second pass.
        // This .start() is safe only in this path.
        this.load.start();
      } catch (error) {
        console.error("Error processing config:", error);
      }
    });
  }

  // Merge images from images, images1, images2, and ui into a single flat map
  collectImages(cfg) {
    const out = {};
    const add = (obj) => {
      if (!obj) return;
      for (const [k, v] of Object.entries(obj)) {
        // last one wins if duplicates
        out[k] = v;
      }
    };
    add(cfg.images);   // legacy support
    add(cfg.images1);  // new
    add(cfg.images2);  // new
    add(cfg.ui);       // UI images (buttons, boxes, icons)
    return out;
  }

  // Keys that should NOT be treated as sliceable fruits
  getNonFruitKeys(cfg) {
    const base = new Set([
      "background",
      "bomb",
      "gameOver",
      "htp",
      "next",
      "replay_level",
      "replay",
      "play_game",
      "htpBox",
      "playbtn",
      "stopwatchIcon",
      "scoreback",
      "heart",
      "completed",
      "winbg",
      "ovrbg"
    ]);
    // also exclude every key that appears under cfg.ui just in case names differ
    if (cfg.ui) for (const k of Object.keys(cfg.ui)) base.add(k);
    return base;
  }

  // Return list of sliceable image *filenames* (e.g., "object.png") excluding bomb/ui
  // Return list of sliceable image *filenames* (e.g., "mango.png") excluding bomb/ui
  getSliceableImageFileNames(cfg) {
    if (!cfg) return [];
    const imagesMap = this.collectImages(cfg);   // key -> url
    const nonFruit = this.getNonFruitKeys(cfg);
    const names = [];

    for (const [key, url] of Object.entries(imagesMap)) {
      if (nonFruit.has(key)) continue;           // skip ui/background/etc.
      if (key === "bomb") continue;              // skip bomb
      if (!url) continue;

      const slash = url.lastIndexOf("/");
      const fname = slash >= 0 ? url.substring(slash + 1) : url;

      // defensive: skip any file actually named bomb.png
      if (fname.toLowerCase() === "bomb.png") continue;

      names.push(fname);
    }

    // readability for long lists
    if (names.length > 8) return [...names.slice(0, 7), "…"];
    return names;
  }

  // Resolve bomb filename from config (e.g., "stone.png"); fallback to "bomb.png"
  getBombFileName(cfg) {
    const imagesMap = this.collectImages(cfg);
    const url = imagesMap?.bomb;
    if (!url) return "bomb.png";
    const i = url.lastIndexOf("/");
    return i >= 0 ? url.substring(i + 1) : url;
  }

  // Build final HTP description supporting {slice_list} and {bomb} placeholders
  buildHTPDescription(cfg) {
    const sliceList = this.getSliceableImageFileNames(cfg);
    const bombName = this.getBombFileName(cfg);
    const autoLine = sliceList.length
      ? `Slice (${sliceList.join(", ")}) images. Avoid ${bombName}.`
      : `Slice the objects to score. Avoid ${bombName}.`;

    const tpl = cfg?.labels?.howToPlayDescription;

    // If no template provided, just return auto
    if (!tpl) return autoLine;

    // If template has placeholders, replace them
    if (tpl.includes("{slice_list}") || tpl.includes("{bomb}")) {
      return tpl
        .replaceAll("{slice_list}", sliceList.join(", "))
        .replaceAll("{bomb}", bombName);
    }

    // Template present but no placeholders -> append auto line
    return `${tpl}\n${autoLine}`;
  }




  enqueueAssets(cfg) {
    if (!cfg) return;
    this.fruitTypes = [];

    const imagesMap = this.collectImages(cfg);
    const nonFruit = this.getNonFruitKeys(cfg);
    const { audio = {}, spritesheets = {} } = cfg;

    // helper to resolve URLs
    const resolveUrl = (u) => {
      if (!u) return u;
      // absolute http(s) or data URIs -> use as-is
      if (/^(https?:)?\/\//i.test(u) || /^data:/i.test(u)) return u;
      // otherwise treat as relative to basePath
      return `${basePath}/${u}`;
    };

    // Images
    for (const [key, url] of Object.entries(imagesMap)) {
      const fullUrl = resolveUrl(url);
      if (!this.sys.textures.exists(key)) {
        this.load.image(key, fullUrl);
      }
      // Only push likely fruit textures
      if (!nonFruit.has(key) && key !== "bomb") {
        this.fruitTypes.push(key);
      }
    }

    // Fallback fruit if none discovered
    if (this.fruitTypes.length === 0) this.fruitTypes.push("object");

    // Audio
    for (const [key, url] of Object.entries(audio)) {
      const fullUrl = resolveUrl(url);
      if (!this.cache.audio.exists(key)) {
        this.load.audio(key, fullUrl);
      }
    }

    // Spritesheets
    for (const [key, meta] of Object.entries(spritesheets)) {
      if (meta?.path && !this.textures.exists(key)) {
        const fullUrl = resolveUrl(meta.path);
        this.load.spritesheet(key, fullUrl, {
          frameWidth: meta.frameWidth || 64,
          frameHeight: meta.frameHeight || 64,
          endFrame: meta.frames ? meta.frames - 1 : undefined,
        });
      }
    }
  }


  create() {
    this.canvasWidth = this.sys.game.config.width;
    this.canvasHeight = this.sys.game.config.height;
    this.scaleFactor = 1;
    this.gameState = "howToPlay";

    // Always recreate fresh groups when a scene starts or restarts
    this.fruits = this.add.group();
    this.corruptedFruits = this.add.group();


    this.cfg = this.cache.json.get("levelConfig") || {};
    this.targetScore = this.cfg.targetScore || 200;
    this.timeLefts = this.cfg.timeLimit || 60;
    this.resetGameState();

    this.setupGameVisuals(); // Setup background, UI, etc.
    const howToPlayTitle = this.cfg.labels?.howToPlayTitle || "How to Play";
    const howToPlayDescription = this.buildHTPDescription(this.cfg);
    const targetLabel = this.cfg.labels?.targetLabel || "Target";
    // Show How to Play overlay
    if (this.htpContainer) this.htpContainer.destroy(true);
    this.htpContainer = this.add.container(0, 0).setDepth(20);

    const blur = this.add.rectangle(0, 0, 1080, 1920, 0x000000, 0.5).setOrigin(0);
    const howToPlayBox = this.add.image(540, 830, "htpBox").setScale(0.55, 0.75);

    const titleText = this.add.text(540, 600, howToPlayTitle, {
      font: "70px Outfit",
      color: "#ffffff",
      align: "center",
    }).setOrigin(0.5);

    // --- images list ("Slice:") ---
    const sliceables = this.getSliceableImageFileNames(this.cfg);
    const descY = 760;

    const title = this.add.text(210, descY - 10, this.cfg.labels?.slicetext, {
      font: "60px Outfit",
      color: "#ffffff",
    }).setOrigin(0.5);

    const gap = 160;
    let startX = 540 - (sliceables.length * gap) / 2;

    // keep local refs for thumbs so we can add them to container
    const thumbSprites = [];
    sliceables.forEach((fname, i) => {
      const key = Object.keys(this.collectImages(this.cfg)).find(k =>
        this.collectImages(this.cfg)[k].endsWith(fname)
      );
      if (!key || !this.textures.exists(key)) return;
      const spr = this.add.image(startX + i * gap + 100, descY - 20, key)
        .setScale(0.04);
      thumbSprites.push(spr);
    });

    // “Avoid” line
    const avoid = this.add.text(220, descY + 150, this.cfg.labels?.avoidtext, {
      font: "60px Outfit",
      color: "#ffffff",
    }).setOrigin(0.5);

    // Bomb image
    let bombImg = null;
    const bombKey = "bomb";
    if (this.textures.exists(bombKey)) {
      bombImg = this.add.image(400, descY + 150, bombKey).setScale(0.02);
    }

    const target = this.add.text(230, 1050, targetLabel, {
      font: "60px Outfit",
      color: "#ffffff",
    }).setOrigin(0.5);

    const targetScoreText = this.add.text(850, 1050, `${this.targetScore}`, {
      font: "60px Outfit",
      color: "#ffffff",
    }).setOrigin(0.5);

    const playButton = this.add.image(540, 1300, "play_game").setInteractive().setScale(1, 1);

    // 👇 add EVERYTHING to the container so one destroy clears it all
    this.htpContainer.add([
      blur, howToPlayBox, titleText, title, avoid,
      target, targetScoreText, playButton,
      ...thumbSprites,
      ...(bombImg ? [bombImg] : []),
    ]);

    // Start gameplay and destroy the whole overlay
    playButton.on("pointerdown", () => {
      this.startGame();
      this.htpContainer?.destroy(true); // 👈 clears thumbnails, bomb, texts, blur, button
      this.htpContainer = null;
    });
  }
  setupGameVisuals() {
    const W = this.canvasWidth;
    const H = this.canvasHeight;

    if (this.sys.textures.exists("background")) {
      // Static background — no tileSprite
      this.bg = this.add.image(W / 2, H / 2, "background")
        .setDisplaySize(W, H)
        .setDepth(0);
    } else {
      this.createFallbackBackground();
    }

    this.physics.world.gravity.y = 0;
    this.setupAudio();
    this.createUI();
    this.createAmbientFX();
  }



  resetGameState() {
    this.score = 0;
    this.timeLeft = this.cfg.timeLimit || 60;
    this.gameState = "playing";
    this.lives = 3;
    this.targetScore = this.cfg.targetScore || 200;

    this.combo = 0;
    this.missedFruits = 0;
    this.spawnCount = 0;
    this.sliceTrail = [];
    this.comboTimer = null;
    this.isSlicing = false;

    // Clear heart images array
    this.heartImages = [];

    // Fruits group
    if (!this.fruits || !this.fruits.children) {
      // group missing or destroyed — make a fresh one
      this.fruits = this.add.group();
    } else {
      this.fruits.clear(true, true);
    }

    // Corrupted fruits group
    if (!this.corruptedFruits || !this.corruptedFruits.children) {
      this.corruptedFruits = this.add.group();
    } else {
      this.corruptedFruits.clear(true, true);
    }


    if (this.timerEvent) {
      this.timerEvent.destroy();
    }

    if (this.bgm && this.bgm.isPlaying) {
      this.bgm.stop();
    }
  }

  setupAudio() {
    try {
      if (this.sound.get("bgm")) {
        this.sound.remove("bgm");
      }

      if (this.cache.audio.exists("bgm")) {
        this.bgm = this.sound.add("bgm", { loop: true, volume: 0.3 });
        this.bgm.play();
      } else {
        console.warn("Background music not found");
      }
    } catch (error) {
      console.error("Error setting up audio:", error);
    }
  }

  createUI() {
    if (!this.add) {
      console.error("Cannot create UI: this.add is undefined");
      return;
    }

    const fontSizeBase = Math.round(48 * this.scaleFactor);
    this.add.image(160, 70, "scoreback").setDepth(10);

    this.scoreText = this.add
      .text(20 * this.scaleFactor + 20, 20 * this.scaleFactor + 20, "Score: 00", {
        fontSize: `50px`,
        fill: "#000000",
        stroke: "#000000",
        fontFamily: "Outfit",
      })
      .setDepth(11);

    this.add.image(550, 72, "stopwatchIcon").setDepth(10);

    this.timerText = this.add
      .text(this.canvasWidth / 2 - 120, 20 * this.scaleFactor + 22, "Time: 00:60", {
        fontSize: `47px`,
        fill: "#000000",
        fontWeight: "600",
        fontFamily: "Outfit",
      })
      .setDepth(11)
      .setOrigin(0, 0);

    // 👇 NEW: numeric lives counter (top-right)
    this.createLivesText();

    // Combo text (unchanged)
    this.comboText = this.add
      .text(this.canvasWidth / 2, this.canvasHeight * 0.2, "", {
        fontSize: `${Math.round(72 * this.scaleFactor)}px`,
        fill: "#f8f8f8ff",
        stroke: "#000000",
        strokeThickness: Math.round(6 * this.scaleFactor),
        fontFamily: "Outfit",
      })
      .setOrigin(0.5)
      .setVisible(false);
  }

  createLivesText() {
    this.add.image(this.canvasWidth - 180, 70, "scoreback").setDepth(10);
    // create or refresh the numeric lives text in the top-right corner
    if (this.livesText) this.livesText.destroy();
    this.livesText = this.add
      .text(this.canvasWidth - 150, 20 * this.scaleFactor + 22, `${this.cfg.labels?.livetext} ${this.lives}`, {
        fontSize: `47px`,
        fill: "#000000",
        fontWeight: "600",
        fontFamily: "Outfit",
      })
      .setOrigin(1, 0)
      .setDepth(11);
  }

  updateLivesText() {
    if (!this.livesText) {
      this.createLivesText();
    } else {
      this.livesText.setText(`Lives: ${this.lives}`);
    }
  }


  setupInput() {
    this.input.addPointer(2);

    this.input.on("pointerdown", (pointer) => {
      this.isSlicing = true;
      this.sliceTrail = [{ x: pointer.x, y: pointer.y }];
      this.sliceAt(pointer);
    });

    this.input.on("pointermove", (pointer) => {
      if (this.isSlicing) {
        this.sliceTrail.push({ x: pointer.x, y: pointer.y });
        if (this.sliceTrail.length > 10) {
          this.sliceTrail.shift();
        }
        this.sliceAt(pointer);
      }
    });

    this.input.on("pointerup", () => {
      this.isSlicing = false;
      this.sliceTrail = [];
    });
  }

  setupTimer() {
    this.timerEvent = this.time.addEvent({
      delay: 1000,
      callback: () => {
        if (this.gameState === "playing") {
          this.timeLeft--;
          this.timerText.setText(`Time: ${this.formatTime(this.timeLeft)}`);

          if (this.timeLeft <= 10) {
            this.timerText.setFill("#ff0000");
          } else if (this.timeLeft <= 20) {
            this.timerText.setFill("#000000ff");
          }

          if (this.timeLeft <= 0) {
            this.gameState = "ended";
            // keep bgm playing
            // this.events.emit("sceneComplete");
            this.gameOver();
          }
        }
      },
      callbackScope: this,
      loop: true,
    });
  }

  setupSpawning() {
    this.time.addEvent({
      delay: 1000,
      callback: () => {
        if (this.gameState === "playing") {
          const spawnDelay = Phaser.Math.Between(800, 1500);
          this.time.delayedCall(spawnDelay, this.spawnFruit, [], this);
        }
      },
      callbackScope: this,
      loop: true,
    });

    this.time.addEvent({
      delay: 4000,
      callback: () => {
        if (this.gameState === "playing") {
          const spawnDelay = Phaser.Math.Between(2000, 4000);
          this.time.delayedCall(spawnDelay, this.spawnCorruptedFruit, [], this);
        }
      },
      callbackScope: this,
      loop: true,
    });

    this.time.addEvent({
      delay: 8000,
      callback: () => {
        if (this.gameState === "playing") {
          this.spawnMultipleFruits();
        }
      },
      callbackScope: this,
      loop: true,
    });
  }

  update() {


    if (this.gameState !== "playing") return;
    if (!this.gameStarted) return;

    if (this.fruits && this.fruits.children) {
      this.fruits.children.iterate((fruit) => {
        if (fruit && fruit.y > this.canvasHeight + 100) {
          this.missedFruits++;
          // Missed a normal fruit: deduct score, do NOT reduce lives
          this.score = Math.max(0, this.score - 5);
          this.showScorePopup("-5", fruit.x, this.canvasHeight - 120);
          this.updateScore();
          fruit.destroy();
        }
      });
    }


    if (this.corruptedFruits && this.corruptedFruits.children) {
      this.corruptedFruits.children.iterate((badFruit) => {
        if (badFruit && badFruit.y > this.canvasHeight + 100) {
          badFruit.destroy();
        }
      });
    }

    if (this.comboTimer && this.time.now > this.comboTimer) {
      this.resetCombo();
    }
  }

  spawnFruit() {
    if (this.gameState !== "playing") return;

    const spawnSide = Math.random() < 0.5 ? "left" : "right";
    const x =
      spawnSide === "left"
        ? Phaser.Math.Between(50 * this.scaleFactor, 200 * this.scaleFactor)
        : Phaser.Math.Between(
          this.canvasWidth - 200 * this.scaleFactor,
          this.canvasWidth - 50 * this.scaleFactor
        );

    let fruitType = "object";
    if (this.fruitTypes.length > 0) {
      fruitType = Phaser.Math.RND.pick(this.fruitTypes);
    }

    if (!this.sys.textures.exists(fruitType)) {
      console.warn(`Fruit texture ${fruitType} not found, using fallback`);
      if (this.add) {
        const graphics = this.add.graphics();
        graphics.fillStyle(0xff6600);
        graphics.fillCircle(0, 0, 50);
        graphics.generateTexture("fallback_fruit", 100, 100);
        graphics.destroy();
        fruitType = "fallback_fruit";
      }
    }

    if (!this.physics || !this.add) {
      console.error("Cannot spawn fruit: physics or add is undefined");
      return;
    }

    const fruit = this.physics.add
      .image(x, this.canvasHeight, fruitType)
      .setInteractive()
      .setScale(0.11 * this.scaleFactor);

    const xVelocity =
      spawnSide === "left"
        ? Phaser.Math.Between(100 * this.scaleFactor, 200 * this.scaleFactor)
        : Phaser.Math.Between(-200 * this.scaleFactor, -100 * this.scaleFactor);

    const yVelocity = -Phaser.Math.Between(
      800 * this.scaleFactor,
      1000 * this.scaleFactor
    );

    fruit.setVelocity(xVelocity, yVelocity);
    fruit.setAngularVelocity(Phaser.Math.Between(-200, 200));
    fruit.type = "object";
    fruit.sliced = false;
    fruit.setTint(Phaser.Math.Between(0xffffff, 0xffffff));

    this.fruits.add(fruit);
    this.spawnCount++;
  }

  spawnMultipleFruits() {
    const count = Phaser.Math.Between(2, 4);
    for (let i = 0; i < count; i++) {
      this.time.delayedCall(i * 200, this.spawnFruit, [], this);
    }
  }

  spawnCorruptedFruit() {
    if (this.gameState !== "playing") return;

    const spawnSide = Math.random() < 0.5 ? "left" : "right";
    const x =
      spawnSide === "left"
        ? 100 * this.scaleFactor
        : this.canvasWidth - 100 * this.scaleFactor;

    let corruptedTexture = "bomb";

    if (!this.sys.textures.exists("bomb")) {
      console.warn("Corrupted fruit texture not found, using fallback");
      if (this.add) {
        const graphics = this.add.graphics();
        graphics.fillStyle(0x990000);
        graphics.fillCircle(0, 0, 50);
        graphics.generateTexture("fallback_corrupted", 100, 100);
        graphics.destroy();
        corruptedTexture = "fallback_corrupted";
      }
    }

    if (!this.physics || !this.add) {
      console.error(
        "Cannot spawn corrupted fruit: physics or add is undefined"
      );
      return;
    }

    const corrupted = this.physics.add
      .image(x, this.canvasHeight, corruptedTexture)
      .setInteractive()
      .setScale(0.07 * this.scaleFactor);

    const vx =
      spawnSide === "left"
        ? Phaser.Math.Between(120 * this.scaleFactor, 220 * this.scaleFactor)
        : Phaser.Math.Between(-220 * this.scaleFactor, -120 * this.scaleFactor);

    corrupted.setVelocity(
      vx,
      -Phaser.Math.Between(900 * this.scaleFactor, 1100 * this.scaleFactor)
    );
    corrupted.setAngularVelocity(Phaser.Math.Between(-250, 250));
    corrupted.type = "corrupted";
    corrupted.sliced = false;
    corrupted.setTint(0xff0000);

    this.sys.tweens.add({
      targets: corrupted,
      scaleX: 0.045 * this.scaleFactor,
      scaleY: 0.045 * this.scaleFactor,
      duration: 300,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    this.corruptedFruits.add(corrupted);
    this.spawnCount++;
  }

  sliceAt(pointer) {
    if (this.gameState !== "playing") return;

    const sliced = [];
    const allFruits = [
      ...this.fruits.getChildren(),
      ...this.corruptedFruits.getChildren(),
    ];

    allFruits.forEach((fruit) => {
      if (!fruit.sliced && fruit.getBounds().contains(pointer.x, pointer.y)) {
        fruit.sliced = true;
        const isCorrupted = fruit.type === "corrupted";

        if (isCorrupted) {
          // Bomb tapped: lose a life, do NOT change score
          this.loseLife();
          this.resetCombo();
          this.showScorePopup("Life -1", pointer.x, pointer.y); // optional text
        } else {
          const points = this.calculatePoints();
          this.score += points;
          this.combo++;
          this.comboTimer = this.time.now + 2000;
          this.showScorePopup(`+${points}`, pointer.x, pointer.y);
          this.updateComboDisplay();
        }


        this.createSliceEffect(fruit, pointer.x, pointer.y, isCorrupted);
        this.playSliceSound(isCorrupted);
        sliced.push(fruit);
      }
    });

    sliced.forEach((obj) => obj.destroy());
    if (sliced.length) this.updateScore();
  }

  playSliceSound(isCorrupted) {
    try {
      // ✅ Play bomb.mp3 when bomb/corrupted fruit is sliced
      const soundKey = isCorrupted ? "bomb" : "slice";

      if (this.cache.audio.exists(soundKey)) {
        const sound = this.sound.get(soundKey) || this.sound.add(soundKey);
        sound.play({ volume: isCorrupted ? 1.0 : 0.7 });
      } else {
        console.warn(`Sound key not found: ${soundKey}`);
      }
    } catch (error) {
      console.warn("Error playing slice sound:", error);
    }
  }

  createOverlayBackground(textureKey) {
    const W = this.canvasWidth || this.sys.game.config.width;
    const H = this.canvasHeight || this.sys.game.config.height;

    if (this.textures.exists(textureKey)) {
      return this.add
        .image(W / 2, H / 2, textureKey)
        .setDisplaySize(W, H)
        .setDepth(9); // behind texts/buttons
    }

    // Fallback: blur/dim rectangle
    return this.add
      .rectangle(0, 0, W, H, 0x000000, 0.5)
      .setOrigin(0)
      .setDepth(9);
  }



  calculatePoints() {
    let basePoints = 10;
    if (this.combo > 1) {
      basePoints += (this.combo - 1) * 5;
    }
    return basePoints;
  }

  createSliceEffect(fruit, x, y, isCorrupted) {
    if (!this.add) {
      console.error("Cannot create slice effect: this.add is undefined");
      return;
    }

    try {
      const particles = this.add.particles(0, 0, fruit.texture.key, {
        speed: { min: 50 * this.scaleFactor, max: 150 * this.scaleFactor },
        lifespan: 600,
        quantity: 15,
        scale: { start: 0.06 * this.scaleFactor, end: 0 },
        alpha: { start: 1, end: 0 },
        tint: isCorrupted ? 0xff0000 : 0xffffff,
      });
      particles.explode(15, x, y);
    } catch (error) {
      console.warn("Error creating particle effect:", error);
    }

    this.sys.cameras.main.shake(100, 0.01 * this.scaleFactor);

    if (this.sliceTrail.length > 1) {
      const graphics = this.add.graphics();
      graphics.lineStyle(
        8 * this.scaleFactor,
        isCorrupted ? 0xff0000 : 0xffffff,
        0.8
      );
      graphics.beginPath();
      graphics.moveTo(this.sliceTrail[0].x, this.sliceTrail[0].y);
      for (let i = 1; i < this.sliceTrail.length; i++) {
        graphics.lineTo(this.sliceTrail[i].x, this.sliceTrail[i].y);
      }
      graphics.strokePath();

      this.sys.tweens.add({
        targets: graphics,
        alpha: 0,
        duration: 200,
        onComplete: () => graphics.destroy(),
      });
    }
  }

  updateComboDisplay() {
    if (this.combo > 1) {
      this.comboText.setText(`${this.combo}x COMBO!`);
      this.comboText.setVisible(true);

      this.sys.tweens.add({
        targets: this.comboText,
        scaleX: 1.2,
        scaleY: 1.2,
        duration: 200,
        yoyo: true,
        ease: "Back.easeOut",
      });
    }
  }

  resetCombo() {
    this.combo = 0;
    this.comboText.setVisible(false);
    this.comboTimer = null;
  }

  // Enhanced loseLife method with heart loss effect
  loseLife() {
    this.lives = Math.max(0, this.lives - 1);
    this.updateLivesText();

    // Screen flash (kept)
    const flash = this.add.rectangle(
      this.canvasWidth / 2,
      this.canvasHeight / 2,
      this.canvasWidth,
      this.canvasHeight,
      0xff0000,
      0.3
    );
    this.sys.tweens.add({
      targets: flash,
      alpha: 0,
      duration: 300,
      onComplete: () => flash.destroy(),
    });

    // Small shake to sell the hit
    this.sys.cameras.main.shake(150, 0.015 * this.scaleFactor);

    if (this.lives <= 0) {
      this.gameState = "ended";
      this.gameOver();
    }
  }




  updateLivesDisplay() {
    if (this.gameState === "playing") {
      this.updateLivesText();
    }
  }



  showScorePopup(text, x, y, color) {
    if (!this.add) {
      console.error("Cannot create score popup: this.add is undefined");
      return;
    }

    const popup = this.add
      .text(x, y, text, {
        fontSize: `${Math.round(58 * this.scaleFactor)}px`,
        fill: "#FFFFFF",
        stroke: "#000000",
        strokeThickness: Math.round(10 * this.scaleFactor),
        fontFamily: "Outfit",
      })
      .setOrigin(0.5);

    this.sys.tweens.add({
      targets: popup,
      y: y - 80 * this.scaleFactor,
      alpha: 0.4,
      scale: 2,
      duration: 1000,
      ease: "Power2",
      onComplete: () => popup.destroy(),
    });
  }

  updateScore() {
    this.scoreText.setText(`Score: ${this.score}`);

    if (this.score >= this.targetScore && this.gameState === "playing") {
      this.winGame();
    }
  }

  startGame() {
    if (this.bgm && !this.bgm.isPlaying) this.bgm.play();
    this.gameStarted = true;
    this.gameState = "playing";
    this.physics.world.gravity.y = 300 * this.scaleFactor;
    this.setupSpawning();
    this.setupTimer();
    this.setupInput();
  }

  gameOver() {
    // const overlayBg = this.createOverlayBackground("ovrbg");
    const gameOverTextStr = this.cfg.labels?.gameOverText || "Game Over";

    const img = this.add.image(540, 820, "gameOver").setDepth(10).setScale(0.55, 0.8);
    const gameOverText = this.add
      .text(540, 610, gameOverTextStr, {
        font: "70px Outfit",
        color: "#FFFFFF",
      })
      .setOrigin(0.5)
      .setDepth(11);

    const ttScore = this.add
      .text(250, 820, "Target", {
        font: "60px Outfit",
        color: "#FFFFFF",
      })
      .setOrigin(0.5)
      .setDepth(11);

    const ttScoreYour = this.add
      .text(870, 830, `${this.targetScore}`, {
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
      .image(540, 1300, "replay_level")
      .setInteractive()
      .setDepth(10);

    // const gameOverBox = this.add.image(540, 820, "htp").setDepth(10);
    restartButton.on("pointerdown", () => {
      console.log("Restart button clicked");
      // Clean up before restart
      // overlayBg.destroy();
      // gameOverBox.destroy();
      gameOverText.destroy();
      restartButton.destroy();
      yourUserScore.destroy();
      yourScore.destroy();
      ttScoreYour.destroy();
      ttScore.destroy();
      if (this.timerEvent) { this.timerEvent.remove(false); this.timerEvent = null; }
      this.time.removeAllEvents();              // <-- correct for Phaser 3.60
      this.tweens.killAll();
      if (this.bgm && this.bgm.isPlaying) this.bgm.stop();

      this.scene.restart();

    });
  }

  winGame() {
    const overlayBg = this.createOverlayBackground("winbg");
    const winTextStr = this.cfg.labels?.winText || "Level Completed";

    const winText = this.add
      .text(520, 820, winTextStr, {
        font: "70px Outfit",
        color: "#FFFFFF",
      })
      .setOrigin(0.5)
      .setDepth(11);

    const winBox = this.add.image(540, 820, "completed").setDepth(10).setScale(0.5, 0.3);

    // Side-by-side buttons
    const buttonY = 1000 + 20; // Equivalent to margin-top: 20

    const buttonSpacing = 230;

    const replayButton = this.add
      .image(540 - buttonSpacing, buttonY + 30, "replay")
      .setInteractive()
      .setDepth(10);

    const nextButton = this.add
      .image(540 + buttonSpacing, buttonY + 30, "next")
      .setInteractive()
      .setDepth(10);

    // Replay button click
    replayButton.on("pointerdown", () => {
      console.log("Replay button clicked (win screen)");
      overlayBg.destroy();
      winBox.destroy();
      winText.destroy();
      replayButton.destroy();
      nextButton.destroy();
      if (this.timerEvent) { this.timerEvent.remove(false); this.timerEvent = null; }
      this.time.removeAllEvents();              // <-- correct for Phaser 3.60
      this.tweens.killAll();
      if (this.bgm && this.bgm.isPlaying) this.bgm.stop();

      this.scene.restart(); // Restart the current level

    });

    // Next button click
    nextButton.on("pointerdown", () => {
      console.log("Next button clicked (win screen)");
      winBox.destroy();
      winText.destroy();
      replayButton.destroy();
      nextButton.destroy();
      this.notifyParent('sceneComplete', { result: 'win' }); // Trigger next level or scene
    });

    this.gameState = "won";

  }
  showHowToPlayScreen() {

    try {
      // Debug context
      console.log("Create context:", {
        add: !!this.add,
        sys: !!this.sys,
        textures: !!this.sys?.textures,
      });

      // Ensure critical properties are available
      if (!this.sys || !this.sys.textures || !this.add) {
        console.error("Scene properties missing:", {
          sys: !!this.sys,
          textures: !!this.sys?.textures,
          add: !!this.add,
        });
        this.createFallbackBackground();
        this.startGame();
        return;
      }

      this.cfg = this.cache.json.get("levelConfig");
      this.resetGameState();

      this.canvasWidth = this.sys.game.config.width;
      this.canvasHeight = this.sys.game.config.height;
      this.scaleFactor = 1;

      if (this.sys.textures.exists("background")) {
        this.add
          .image(this.canvasWidth / 2, this.canvasHeight / 2, "background")
          .setDisplaySize(this.canvasWidth, this.canvasHeight);
      } else {
        console.warn("Background texture not found");
        this.createFallbackBackground();
      }

      this.physics.world.gravity.y = 0;
      this.setupAudio();
      this.createUI();
      this.physics.world.gravity.y = 300 * this.scaleFactor;

      console.log("Scene created successfully");
    } catch (error) {
      console.error("Error in create method:", error);
      this.createFallbackBackground();
      this.startGame();
    }
  }

  // Add this method inside the MechanicsScene class
  createFallbackBackground() {
    try {
      const W = this.canvasWidth || this.sys.game.config.width;
      const H = this.canvasHeight || this.sys.game.config.height;
      const key = "__fallback_bg";

      // Generate once per scene run
      if (!this.sys.textures.exists(key)) {
        const g = this.add.graphics();
        // Dark navy, matches your UI palette
        g.fillStyle(0x0b0f1a, 1);
        g.fillRect(0, 0, W, H);
        g.generateTexture(key, W, H);
        g.destroy();
      }

      this.add
        .image(W / 2, H / 2, key)
        .setDisplaySize(W, H)
        .setDepth(0);
    } catch (e) {
      console.warn("Fallback background draw failed:", e);
    }
  }


  createAmbientFX() {
    const W = this.canvasWidth;
    const H = this.canvasHeight;

    // Depths: bg=0, FX=1..3, gameplay >= 4, UI >= 10
    this.makeDustParticles(W, H, 1);
    this.makeLightRays(W, H, 2);

    // Optional: if a vignette texture was generated earlier in this session, remove it
    if (this.textures.exists("__vignette")) this.textures.remove("__vignette");
  }


  makeDustParticles(W, H, depth = 1) {
    // create tiny soft dot texture once
    const key = "__dust_dot";
    if (!this.textures.exists(key)) {
      const g = this.add.graphics();
      g.fillStyle(0xffffff, 1);
      g.fillCircle(16, 16, 16);
      g.generateTexture(key, 32, 32);
      g.destroy();
    }

    // wide, slow drift particles across the whole screen
    const particles = this.add.particles(0, 0, key, {
      x: { min: 0, max: W },
      y: { min: 0, max: H },
      lifespan: 5000,
      speedX: { min: -8, max: 8 },
      speedY: { min: -5, max: -15 }, // slight upward drift
      quantity: 2,
      frequency: 120,
      scale: { start: 0.25, end: 0 },
      alpha: { start: 0.25, end: 0 },
      blendMode: "ADD"
    });
    particles.setDepth(depth);
    this.ambientDust = particles;
  }

  makeLightRays(W, H, depth = 2) {
    const key = "__light_rays";
    if (!this.textures.exists(key)) {
      const g = this.add.graphics({ x: 0, y: 0 });

      // center slightly above the screen so rays "shine down"
      const cx = W / 2;
      const cy = -H * 0.2;

      // Save current transform, translate once, then restore at the end
      if (g.save) g.save();
      if (g.translateCanvas) g.translateCanvas(cx, cy);

      const spokes = 10;
      for (let i = 0; i < spokes; i++) {
        const angle = (i / spokes) * Math.PI * 2;

        if (g.save) g.save();                      // save before rotate
        if (g.rotateCanvas) g.rotateCanvas(angle); // rotate around the translated origin

        g.fillStyle(0xffffff, 0.06);
        // a tall, soft triangular beam
        g.fillTriangle(0, 0, W * 0.12, H * 0.9, -W * 0.12, H * 0.9);

        if (g.restore) g.restore();                // restore rotation for next spoke
      }

      if (g.restore) g.restore();                  // restore translation
      g.generateTexture(key, W, H);
      g.destroy();
    }

    const rays = this.add.image(W / 2, H / 2, key)
      .setDepth(depth)
      .setAlpha(0.35)
      .setBlendMode(Phaser.BlendModes.ADD);

    // slow rotation + breathing
    this.tweens.add({
      targets: rays,
      angle: 360,
      duration: 90000,
      repeat: -1,
      ease: "Linear"
    });
    this.tweens.add({
      targets: rays,
      alpha: { from: 0.25, to: 0.45 },
      duration: 4000,
      yoyo: true,
      repeat: -1,
      ease: "Sine.inOut"
    });

    this.ambientRays = rays;
  }


  // makeVignette(W, H, depth = 3) {
  //   const key = "__vignette";
  //   if (!this.textures.exists(key)) {
  //     const g = this.add.graphics();
  //     // draw concentric transparent center to dark edge
  //     const steps = 6;
  //     for (let i = 0; i < steps; i++) {
  //       const t = i / (steps - 1);
  //       const alpha = 0.55 * t * t; // stronger near edges
  //       g.fillStyle(0x000000, alpha);
  //       const pad = t * Math.max(W, H) * 0.35;
  //       g.fillRect(-pad, -pad, W + pad * 2, H + pad * 2);
  //     }
  //     g.generateTexture(key, W, H);
  //     g.destroy();
  //   }

  //   const vignette = this.add.image(W / 2, H / 2, key)
  //     .setDepth(depth)
  //     .setAlpha(0.6)
  //     .setBlendMode(Phaser.BlendModes.MULTIPLY);
  //   this.ambientVignette = vignette;
  // }


  formatTime(seconds) {
    const minutes = Math.floor(seconds / 60)
      .toString()
      .padStart(2, "0");
    const secs = (seconds % 60).toString().padStart(2, "0");
    return `${minutes}:${secs}`;
  }
}
