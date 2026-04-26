export default class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameScene' });
    // Game State
    this.state = 'menu'; // menu, play, gameover, paused
    // this.targetScore = 50;
    this.score = 0;
    // this.lives = 3;
    // this.targetmiss = this.lives;
    // this.missText = 'Miss: 0' + '/' + this.targetmiss;
    this.miss = 0;
    this.maxFruits = 6;
    this.fruitFallSpeed = 350; // pixels/sec, can ramp up
    this.fruits = null;
    this.basket = null;
    this.cursors = null;
    this.touchPointer = null;
    this.fruitTypes = ['object1', 'object2', 'object3'];
    this.assetsLoaded = false;

    // Explicitly bind all methods to preserve context
    Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach((fn) => {
      if (typeof this[fn] === "function" && fn !== "constructor") {
        this[fn] = this[fn].bind(this);
      }
    });
  }


  preload() {
    // Load config.json and then all assets dynamically
    const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));
    this.load.json('levelConfig', `${basePath}/config.json`);

    this.load.once('filecomplete-json-levelConfig', () => {
      const cfg = this.cache.json.get('levelConfig');
      // Images
      if (cfg.images1) {
        Object.entries(cfg.images1).forEach(([key, url]) => {
          this.load.image(key, `${basePath}/${url}`).on('error', () => {
            console.error(`Failed to load image: ${key}`);
          });
        });
      }
      if (cfg.images2) {
        Object.entries(cfg.images2).forEach(([key, url]) => {
          this.load.image(key, `${basePath}/${url}`).on('error', () => {
            console.error(`Failed to load image: ${key}`);
          });
        });
      }
      if (cfg.ui) {
        Object.entries(cfg.ui).forEach(([key, url]) => {
          this.load.image(key, `${basePath}/${url}`).on('error', () => {
            console.error(`Failed to load image: ${key}`);
          });
        });
      }
      // Audio
      // Audio – support both local paths and full URLs
      if (cfg.audio) {
        for (const [key, url] of Object.entries(cfg.audio)) {
          const audioUrl =
            /^https?:\/\//i.test(url) || url.startsWith('//')
              ? url                // full URL -> use as-is
              : `${basePath}/${url}`; // relative path -> prefix with basePath

          this.load.audio(key, audioUrl).on('error', () => {
            console.error(`Failed to load audio: ${key} from ${audioUrl}`);
          });
        }
      }

      this.load.once('complete', () => { this.assetsLoaded = true; });
      this.load.start();
    });

  }

  create() {
    this.scene.restart = () => { window.game.scene.keys['GameScene'].scene.restart(); };
    this.state = 'menu';

    const cfg = this.cache.json.get('levelConfig');
    this.i18n = cfg.texts || {};   // <-- all display strings come from here

    this.width = cfg.orientation.width;
    this.height = cfg.orientation.height;
    this.targetScore = cfg.mechanics.targetScore;

    this.lives = cfg.mechanics.lives;
    this.targetmiss = this.lives;
    this.maxFruits = cfg.mechanics.maxFruits;
    this.fruitFallSpeed = cfg.mechanics.fruitFallSpeed; // pixels/sec, can ramp up
    this.bombPenalty = (cfg.mechanics && cfg.mechanics.bombPenalty) ?? 1;

    this.lastBombSpawn = 0;
    this.bombSpawnInterval = 2000; // bomb every 2 seconds (tweak as needed)
    this.bombs = this.physics.add.group(); // Group for bombs

    // 🔊 Audio – only add sounds that actually exist in cache
    this.sfx = {};
    if (cfg.audio) {
      Object.keys(cfg.audio).forEach((k) => {
        if (this.cache.audio.exists(k)) {
          this.sfx[k] = this.sound.add(k, { volume: 0.5 });
        } else {
          console.warn(`Audio key "${k}" missing from cache, skipping sound.add.`);
        }
      });
    }

    // 🔁 Start bgm once here (works for first load AND replays)
    const bgm = this.sfx?.bgm;
    if (bgm && !bgm.isPlaying) {
      bgm.setLoop(true);
      bgm.play();
      this.bgm = bgm; // so winScene can stop it
    }

    // Now build menu UI AFTER audio is ready
    this.menuScene();

    // Basket
    this.basket = this.physics.add.image(this.width / 2, this.height - 100, 'basket')
      .setImmovable(true)
      .setCollideWorldBounds(true)
      .setDepth(5)
      .setDisplaySize(350, 250)
      .setVisible(false);

    // Fruit group
    this.fruits = this.physics.add.group();
    this.fruits.clear(true, true);

    // Input
    this.cursors = this.input.keyboard?.createCursorKeys();
    this.input.on('pointermove', pointer => {
      if (this.state === 'play' && pointer.isDown) {
        // Move basket to pointer.x, clamp to screen
        this.basket.x = Phaser.Math.Clamp(pointer.x, 100, this.width - 100);
      }
    });

    // Fruit-basket collision
    this.physics.add.overlap(this.basket, this.fruits, this.catchFruit, null, this);

    this.physics.add.overlap(this.basket, this.bombs, this.hitBomb, null, this);

    // For state updates
    this.lastFruitSpawn = 0;
    this.fruitSpawnInterval = 700; // ms (spawns every 0.7s)

    // For mobile drag
    this.input.on('pointerdown', pointer => { this.touchPointer = pointer; });
    this.input.on('pointerup', () => { this.touchPointer = null; });

    // For pause state
    this.isPaused = false;
  }

  hitBomb(basket, bomb) {
    if (this.state !== 'play') return;
    bomb.destroy();

    // CHANGE: make bomb penalty -1 instead of -3
    const penalty = this.bombPenalty; // now driven by config, defaults to 1


    this.score = Math.max(0, this.score - penalty);
    this.scoreText.setText('Score: ' + this.score);

    // –score float (red)
    this.showScoreFloat(bomb.x, bomb.y - 20, `-${penalty}`, false);

    // Pop FX + shake (unchanged)
    const bombPop = this.add.circle(bomb.x, bomb.y, 45, 0xff0000, 0.5)
      .setStrokeStyle(8, 0xffffff, 0.8)
      .setDepth(20)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.sys.tweens.add({
      targets: bombPop,
      scale: { from: 1, to: 2 },
      alpha: { from: 0.5, to: 0 },
      duration: 400,
      ease: 'cubic.out',
      onComplete: () => bombPop.destroy()
    });

    this.sys.cameras.main.shake(120, 0.012);
    this.sfx.bomb?.play({ volume: 0.9 });
  }



  startGame() {
    // Hide menu, show UI & basket, reset state
    // this.titleText.setVisible(false);
    // this.tapText.setVisible(false);
    this.createUI()


    // this.scoreText.setVisible(true);
    // this.hearts.forEach(h => h.setVisible(true));
    // this.pauseBtn.setVisible(true);
    // this.gameOverText.setVisible(false);
    // this.finalScoreText.setVisible(false);
    // this.playAgainText.setVisible(false);

    this.state = 'play';
    // this.score = 0;
    // this.lives = 3;
    this.fruitFallSpeed = 350;
    this.lastFruitSpawn = 0;
    this.fruitSpawnInterval = 700;
    // this.createUI()
    // this.scoreText.setText('Score: 0');
    // this.hearts.forEach(h => h.setTexture('heart'));

    this.basket.setVisible(true).setPosition(this.width / 2, this.height - 100);

    // Remove any old fruits
    this.fruits.clear(true, true);

    // Input for game over restart
    this.input.once('pointerdown', null);
    this.input.keyboard?.removeAllListeners('keydown-SPACE');
  }

  _t(key, fallback, vars = {}) {
    const src = (this.i18n && this.i18n[key]) ?? fallback ?? '';
    return src.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
  }



  createUI() {
    // Prevent duplicates on replay (defensive guards)
    if (this.scoreText?.destroy) this.scoreText.destroy();
    if (this.missText?.destroy) this.missText.destroy();
    if (this.textBox?.destroy) this.textBox.destroy();
    if (this.targetText?.destroy) this.targetText.destroy();

    // Score (left)
    this.scoreText = this.add.text(
      this.width / 2 - 350, 60,
      `${this._t('ui.score', 'Score')}: 0`,
      { fontFamily: 'outfit', fontSize: 50, color: '#000000ff', fontStyle: 'bold' }
    ).setOrigin(0.5).setDepth(10);

    // Target (center)
    this.targetText = this.add.text(
      this.width / 2, 60,
      `${this._t('ui.target', 'Target')}: ${this.targetScore}`,
      { fontFamily: 'outfit', fontSize: 50, color: '#000000ff', fontStyle: 'bold' }
    ).setOrigin(0.5).setDepth(10);

    // Miss (right)
    this.missText = this.add.text(
      this.width / 2 + 350, 60,
      this._t('ui.miss', 'Miss: {miss}/{total}', { miss: 0, total: this.targetmiss }),
      { fontFamily: 'outfit', fontSize: 50, color: '#000000ff', fontStyle: 'bold' }
    ).setOrigin(0.5).setDepth(10);


    // Scorebar behind texts
    this.textBox = this.add.image(this.width / 2, 60, 'scorebar')
      .setScrollFactor(0)
      .setDepth(9)
      .setScale(1)
      .setOrigin(0.5);
    this.textBox1 = this.add.image(this.width / 2 - 350, 60, 'scorebar')
      .setScrollFactor(0)
      .setDepth(9)
      .setScale(1)
      .setOrigin(0.5);
    this.textBox2 = this.add.image(this.width / 2 + 350, 60, 'scorebar')
      .setScrollFactor(0)
      .setDepth(8)
      .setScale(1)
      .setOrigin(0.5);
  }

  spawnBomb() {
    const x = Phaser.Math.Between(120, this.width - 120);
    const bomb = this.bombs.create(x, -50, 'bomb')
      .setDisplaySize(180, 200)
      .setImmovable(true)
      .setDepth(6);
    bomb.missed = false;
  }

  update(time, delta) {
    // if (this.state === 'menu' || this.state === 'gameover' || this.isPaused) return;
    if (this.state !== 'play' || !this.fruits) return;

    // Keyboard basket movement
    if (this.cursors?.left.isDown) {
      this.basket.x = Phaser.Math.Clamp(this.basket.x - 10, 100, this.width - 100);
    } else if (this.cursors?.right.isDown) {
      this.basket.x = Phaser.Math.Clamp(this.basket.x + 10, 100, this.width - 100);
    }

    // Fruits spawn
    if (this.fruits.getChildren().length < this.maxFruits &&
      time > this.lastFruitSpawn + this.fruitSpawnInterval) {
      this.spawnFruit();
      this.lastFruitSpawn = time;
    }

    // Fruits movement, check if missed
    this.fruits.getChildren().forEach(fruit => {
      fruit.y += (this.fruitFallSpeed * delta / 1000);
      if (fruit.y > this.height + 50 && !fruit.missed) {
        fruit.missed = true;
        this.missFruit(fruit);
      }
    });

    // Bomb spawn logic
    if (this.bombs.getChildren().length < 2 && time > this.lastBombSpawn + this.bombSpawnInterval) {
      this.spawnBomb();
      this.lastBombSpawn = time;
    }

    this.bombs.getChildren().forEach(bomb => {
      bomb.y += (this.fruitFallSpeed * delta / 1000); // Same speed as fruits
      if (bomb.y > this.height + 50 && !bomb.missed) {
        bomb.missed = true;
        bomb.destroy();
      }
    });


    // Difficulty scaling: Fruits fall a bit faster every 10 points
    if (this.score && this.score % 10 === 0) {
      this.fruitFallSpeed = 350 + Math.floor(this.score / 10) * 40;
      this.fruitSpawnInterval = Math.max(350, 700 - Math.floor(this.score / 5) * 30);
    }
  }

  spawnFruit() {
    // Random type, x position
    const fruitKey = Phaser.Utils.Array.GetRandom(this.fruitTypes);
    const x = Phaser.Math.Between(120, this.width - 120);
    const fruit = this.fruits.create(x, -50, fruitKey)
      .setDisplaySize(180, 180)
      .setImmovable(true)
      .setDepth(6);
    fruit.missed = false;
  }

  showScoreFloat(x, y, text, positive = true) {
    const label = this.add.text(x, y, text, {
      fontFamily: 'Outfit',
      fontSize: 44,
      color: positive ? '#3ee36f' : '#ff4d5a',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 6,
    }).setOrigin(0.5).setDepth(30);

    this.tweens.add({
      targets: label,
      y: y - 60,
      alpha: { from: 1, to: 0 },
      duration: 550,
      ease: 'cubic.out',
      onComplete: () => label.destroy(),
    });
  }

  catchFruit(basket, fruit) {
    if (this.state !== 'play') return;
    fruit.destroy();
    // this.scoreText.destroy();
    this.score++;


    this.scoreText.setText(`${this._t('ui.score', 'Score')}: ${this.score}`);


    this.showScoreFloat(fruit.x, fruit.y - 20, '+1', true);
    // 1. Solid colored pop with a white stroke (ring)
    const pop = this.add.circle(fruit.x, fruit.y, 38, 0xffeb3b, 0.5) // Yellow, semi-opaque
      .setStrokeStyle(8, 0xffffff, 0.95)
      .setDepth(20)
      .setBlendMode(Phaser.BlendModes.ADD);

    this.sys.tweens.add({
      targets: pop,
      scale: { from: 1, to: 2.1 },
      alpha: { from: 0.5, to: 0 },
      duration: 320,
      ease: 'cubic.out',
      onComplete: () => pop.destroy()
    });

    // 2. Quick flash (optional)
    // (You can comment this out if you don’t want a strong flash)
    const flash = this.add.circle(fruit.x, fruit.y, 18, 0xffffff, 0.95)
      .setDepth(21)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.sys.tweens.add({
      targets: flash,
      scale: { from: 1, to: 1.6 },
      alpha: { from: 0.95, to: 0 },
      duration: 120,
      onComplete: () => flash.destroy()
    });

    // Sound
    this.sfx.catch?.play();
    if (this.score >= this.targetScore) {
      this.winScene();
    }
  }

  missFruit(fruit) {
    if (this.state !== 'play') return;
    fruit.destroy();
    this.lives--;
    this.miss++;
    this.missText.setText(this._t('ui.miss', 'Miss: {miss}/{total}', { miss: this.miss, total: this.targetmiss }));

    this.sys.cameras.main.shake(50, 0.01);

    this.sfx.miss?.play();

    if (this.lives <= 0) {
      this.endGame();
    }
  }

  endGame() {
    this.state = 'gameover';
    this.basket.setVisible(false);
    this.scoreText.setVisible(false);
    this.missText.setVisible(false);
    this.textBox.setVisible(false);
    this.textBox1.setVisible(false);
    this.textBox2.setVisible(false);
    if (this.targetText) this.targetText.setVisible(false);

    this.gameOverScene();

    this.sfx.gameover?.play();
    // this.hearts.forEach(h => h.setVisible(false));
    this.fruits.clear(true, true);

    // this.input.once('pointerdown', () => this.create());
    this.input.keyboard?.once('keydown-SPACE', () => this.create());
  }

  _addBG(key) {
    const tex = this.textures.exists(key) ? key : 'background';
    return this.add.image(
      this.sys.cameras.main.width / 2,
      this.sys.cameras.main.height / 2,
      tex
    ).setDisplaySize(this.sys.cameras.main.width, this.sys.cameras.main.height);
  }


  menuScene() {
    this.add.image(this.sys.cameras.main.width / 2, this.sys.cameras.main.height / 2, 'background')
      .setDisplaySize(this.sys.cameras.main.width, this.sys.cameras.main.height);

    // Play background music (only if bgm actually loaded)
    // const bgm = this.sfx?.bgm;
    // if (bgm && !bgm.isPlaying) {
    //   bgm.setLoop(true);
    //   bgm.play();
    //   this.bgm = bgm; // so winScene can stop it
    // }

    this.menuImages = [];
    this.gameState = "menu";

    const howToPlayBox = this.add.image(540, 820, "htp").setScale(0.55, 0.7).setDepth(10).setOrigin(0.5);

    const instrY = 840;
    const baseX = 540;

    // Write the instruction text with bigger gaps:
    const instrText = this.add.text(
      baseX, instrY - 225,
      this._t('menu.title', 'How to Play'),
      { font: '60px Outfit', color: '#ffffff', align: 'left', wordWrap: { width: 700 } }
    ).setOrigin(0.5).setDepth(11);

    const instrText1 = this.add.text(
      baseX - 300, instrY - 100,
      this._t('menu.control', 'Control:'),
      { font: '60px Outfit', color: '#ffffff', align: 'left', wordWrap: { width: 700 } }
    ).setOrigin(0.5).setDepth(11);

    const instrText2 = this.add.text(
      baseX - 300, instrY + 40,
      this._t('menu.collect', 'Collect:'),
      { font: '60px Outfit', color: '#ffffff', align: 'left', wordWrap: { width: 700 } }
    ).setOrigin(0.5).setDepth(11);

    const instrText3 = this.add.text(
      baseX - 300, instrY + 150,
      this._t('menu.avoid', 'Avoid:'),
      { font: '60px Outfit', color: '#ffffff', align: 'left', wordWrap: { width: 700 } }
    ).setOrigin(0.5).setDepth(11);


    // Calculate per-character width for even better placement
    const line1Y = instrY - 45;
    const line2Y = instrY + 45;

    // "Swipe the [basket] to collect [apple], [mango], and [orange]."
    this.menuImages.push(this.add.image(baseX - 80, line1Y - 50, "basket")
      .setDisplaySize(90, 80)
      .setOrigin(0.5)
      .setDepth(12));

    this.menuImages.push(this.add.image(baseX + 50, line1Y + 80, "object1")
      .setDisplaySize(90, 90)
      .setOrigin(0.5)
      .setDepth(12));

    this.menuImages.push(this.add.image(baseX + 200, line1Y + 80, "object3")
      .setDisplaySize(90, 90)
      .setOrigin(0.5)
      .setDepth(12));

    this.menuImages.push(this.add.image(baseX - 100, line1Y + 80, "object2")
      .setDisplaySize(90, 90)
      .setOrigin(0.5)
      .setDepth(12));

    // "Do not collect [bomb]."
    this.menuImages.push(this.add.image(baseX - 130, line2Y + 100, "bomb")
      .setDisplaySize(100, 120)
      .setOrigin(0.5)
      .setDepth(12));

    // ... rest of your menuScene code unchanged ...

    // const targetText = this.add
    //   .text(
    //     540,
    //     1050,
    //     `Target                                                ${this.targetScore}`,
    //     {
    //       font: "45px Outfit",
    //       color: "#ffffff",
    //       align: "left",
    //     }
    //   )
    //   .setOrigin(0.5)
    //   .setDepth(11);

    const playButton = this.add
      .image(540, 1240, "play_game")
      .setInteractive().setScale(1)
      .setDepth(11);

    playButton.on('pointerdown', () => {
      howToPlayBox.destroy();
      instrText.destroy();
      instrText1.destroy();
      instrText2.destroy();
      instrText3.destroy();
      // Destroy all menu images:
      this.menuImages.forEach(child => child.destroy());

      // targetText.destroy();
      playButton.destroy();

      this.startGame();

      this.sys.cameras.main.fadeIn(500, 0, 0, 0);
      this.sys.cameras.main.once('camerafadeincomplete', () => {
        this.setupInput();
        // this.startGame();

      });
    });
  }


  gameOverScene() {
    // Add background
    this.input.off('pointerup');
    this.input.keyboard.off('keydown-SPACE');
    this._addBG('ovrbg');

    const overtext = this.add.text(540, 600,
      this._t('over.title', 'Game Over'),
      { font: '80px Outfit', color: '#eeeeeeff', align: 'center' }
    ).setOrigin(0.5).setDepth(11);

    const Targettext = this.add.text(540, 780,
      this._t('over.target', 'Target:     {target}', { target: this.targetScore }),
      { font: '70px Outfit', color: '#eeeeeeff', align: 'left' }
    ).setOrigin(0.5).setDepth(11);

    const ComboText = this.add.text(540, 950,
      this._t('over.score', 'Your Score {score}', { score: this.score }),
      { font: '70px Outfit', color: '#ffffffff', align: 'left' }
    ).setOrigin(0.5).setDepth(11);



    const restartButton = this.add
      .image(540, 1300, "replay")
      .setInteractive()
      .setScale(1)
      .setDepth(10);

    const gameOverBox = this.add.image(540, 850, "game_over").setDepth(10).setScale(0.55, 0.8);



    restartButton.on("pointerdown", () => {
      console.log("Restart button clicked");
      // blur.destroy();
      overtext.destroy();
      gameOverBox.destroy();
      Targettext.destroy();
      ComboText.destroy();
      restartButton.destroy();
      this.missText?.destroy?.();

      this.score = 0;
      this.miss = 0;


      this.gameOver = false;

      // 3) run your normal play-scene setup
      // this.startScene();
      this.create();
      // this.scene.restart()

    });
  }


  notifyParent(type, data) {
    if (window.parent !== window) {
      window.parent.postMessage({ type, ...data }, "*");
    }
  }

  winScene() {
    this.state = 'win'
    // this.fruit.destroy();
    this.basket.setVisible(false);
    this.scoreText.setVisible(false);
    this.missText.setVisible(false);
    this.textBox.setVisible(false);
    this.textBox1.setVisible(false);
    this.textBox2.setVisible(false);
    if (this.targetText) this.targetText.setVisible(false);

    // this.input.off('pointerup');
    // this.input.keyboard.off('keydown-SPACE');
    this._addBG('winbg');




    const winBox = this.add.image(540, 820, "level_complete").setScale(0.55, 0.5).setDepth(10);
    const Targettext = this.add.text(540, 780,
      this._t('win.title', 'Level Completed'),
      { font: '70px Outfit', color: '#FFFFFF', align: 'left' }
    ).setOrigin(0.5).setDepth(11);
    // const ComboText = this.add
    //   .text(540, 860, `Your Score                                                     ${this.score}`, {
    //     font: "45px Outfit",
    //     color: "#FFFFFF",
    //     align: "left",
    //   })
    //   .setOrigin(0.5)
    //   .setDepth(11);

    // Side-by-side buttons
    const buttonY = 1175 // Equivalent to margin-top: 20

    const buttonSpacing = 240;

    const nextButton = this.add
      .image(540 - buttonSpacing, buttonY, "next")
      .setInteractive()
      .setDepth(10);

    const replayButton = this.add
      .image(540 + buttonSpacing, buttonY, "replay_level")
      .setInteractive()
      .setDepth(10);



    // Replay button click
    replayButton.on("pointerdown", () => {
      console.log("Replay button clicked (win screen)");

      // });
      // blur.destroy();
      winBox.destroy();
      // winText.destroy();
      Targettext.destroy();
      // ComboText.destroy();
      replayButton.destroy();
      nextButton.destroy();
      this.score = 0;
      this.miss = 0;

      this.gameOver = false;


      this.create();


    });

    // Next button click
    nextButton.on("pointerdown", () => {
      console.log("Next button clicked (win screen)");

      // // });
      // // blur.destroy();
      // winBox.destroy();
      // // winText.destroy();
      // Targettext.destroy();
      // ComboText.destroy();
      // replayButton.destroy();
      // nextButton.destroy();
      // this.score = 0;
      // this.miss = 0;


      // this.gameOver = false;
      this.notifyParent('sceneComplete', { result: 'win' });


    });

    this.gameState = "won";
    if (this.bgm && this.bgm.isPlaying) {
      this.bgm.stop();
    }
  }
}
