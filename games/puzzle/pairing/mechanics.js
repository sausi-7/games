export default class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
    Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach(fn => {
      if (typeof this[fn] === 'function') {
        this[fn] = this[fn].bind(this);
      }
    });
  }

  preload() {
    const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));
    this.cache.json.remove('levelConfig');
    this.load.json('levelConfig', `${basePath}/config.json`);

    this.load.once('filecomplete-json-levelConfig', () => {
      const cfg = this.cache.json.get('levelConfig');
      this.configData = cfg;

      this.load.image('background', `${basePath}/${cfg.images2.background}`);

      const loadedKeys = new Set();
      for (let i = 1; i <= cfg.numPairs; i++) {
        const animalKey = `animal${i}`;
        const foodKey = `food${i}`;
        this.load.image(animalKey, `${basePath}/${cfg.images1[animalKey + 'Image']}`);
        this.load.image(foodKey, `${basePath}/${cfg.images1[foodKey + 'Image']}`);
        loadedKeys.add(cfg.images1[animalKey + 'Image']);
        loadedKeys.add(cfg.images1[foodKey + 'Image']);
      }

      for (const [key, path] of Object.entries(cfg.images2)) {
        if (!loadedKeys.has(path) && key !== 'background') {
          this.load.image(key, `${basePath}/${path}`);
        }
      }

      // ✅ UI elements (all buttons/overlays/scorecard)
      for (const [key, path] of Object.entries(cfg.ui || {})) {
        if (path) {
          this.load.image(key, `${basePath}/${path}`);
        }
      }


      for (const [key, url] of Object.entries(cfg.audio || {})) {
        if (!url || typeof url !== 'string') continue;

        // If url is absolute (starts with http/https or //), use as-is.
        // Otherwise, treat it as relative to basePath.
        const audioUrl =
          /^https?:\/\//i.test(url) || url.startsWith('//')
            ? url
            : `${basePath}/${url}`;

        this.load.audio(key, audioUrl).on('error', () => {
          console.error(`Failed to load audio "${key}" from ${audioUrl}`);
        });
      }


      this.load.start();
    });
  }

  create() {
    const levelData = this.cache.json.get('levelConfig');
    this.levelData = levelData; // Keep for endLevel

    // Apply orientation from config
    if (levelData.orientation?.frame === 'landscape' && screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('landscape-primary').catch(err => console.warn('Orientation lock failed:', err));
    }

    const cfg = this.configData;
    this.score = 0;
    this.timeLeft = cfg.gameplay?.timeLimit || 60;
    this.targetScore = cfg.gameplay?.targetScore || 50;
    this.animalSprite = null;
    this.animalFoodMap = {};
    this.foodKeys = [];
    this.timerEvent = null;

    this.sys.cameras.main.setBackgroundColor('#000');

    // ---- NEW: put the whole gameplay under a single container ----
    this.gameLayer = this.add.container(0, 0).setDepth(0);

    // Background goes inside gameLayer (hidden during HTP)
    if (cfg.images2.background) {
      const bg = this.add.image(0, 0, 'background').setOrigin(0);
      bg.setDisplaySize(this.sys.cameras.main.width, this.sys.cameras.main.height);
      this.gameLayer.add(bg);
    }

    // HUD
    const scorecard = this.add.image(630, 70, 'scorecard').setScale(1).setScrollFactor(0);
    const scorecard1 = this.add.image(1330, 70, 'scorecard').setScale(1).setScrollFactor(0);
    this.scoreText = this.add.text(1220, 40, 'Score: 0', { font: '50px outfit', fill: 'black' })
      .setScrollFactor(0).setDepth(1);
    this.timerText = this.add.text(510, 40, `Time: ${this.timeLeft}`, { font: '50px outfit', fill: 'black' })
      .setScrollFactor(0).setDepth(1);

    this.gameLayer.add([scorecard, scorecard1, this.scoreText, this.timerText]);

    for (let i = 1; i <= cfg.numPairs; i++) {
      const animalKey = `animal${i}`;
      const foodKey = `food${i}`;
      this.animalFoodMap[animalKey] = foodKey;
      this.foodKeys.push(foodKey);
    }

    this.correctSound = this.sound.add('correct');
    this.wrongSound = this.sound.add('wrong');
    this.bgMusic = this.sound.add('bg_music', { loop: true });

    this.bgMusic?.play();


    // Food buttons (also inside gameLayer)
    const spacing = 200;
    const startX = (1920 - spacing * (this.foodKeys.length - 1)) / 2;
    this.foodButtons = [];

    for (let i = 0; i < this.foodKeys.length; i++) {
      const key = this.foodKeys[i];
      const btn = this.add.image(startX + i * spacing, 900, key).setInteractive().setScale(1.2);
      btn.on('pointerdown', () => {
        this.sys.tweens.add({ targets: btn, scale: 1.4, duration: 100, yoyo: true });
        this.handleFoodSelection(key);
      });
      this.foodButtons.push(btn);
    }
    this.gameLayer.add(this.foodButtons);

    // IMPORTANT: hide gameplay until Start pressed
    this.gameLayer.setVisible(false);

    // Show HTP
    this.showStartScreen();
  }


  loadNextAnimal() {
    if (this.animalSprite) this.animalSprite.destroy();
    const keys = Object.keys(this.animalFoodMap);
    this.currentAnimalKey = Phaser.Utils.Array.GetRandom(keys);

    this.animalSprite = this.add.image(960, 500, this.currentAnimalKey).setScale(0).setAlpha(0);
    this.sys.tweens.add({
      targets: this.animalSprite,
      scale: 1.5,
      alpha: 1,
      ease: 'Bounce.easeOut',
      duration: 600
    });
  }

  handleFoodSelection(selectedFood) {
    const correctFood = this.animalFoodMap[this.currentAnimalKey];
    if (selectedFood === correctFood) {
      this.correctSound.play();
      this.score += 10;
      this.sys.tweens.add({
        targets: this.animalSprite,
        tint: 0x00ff00,
        scale: 1.7,
        duration: 150,
        yoyo: true,
        onComplete: () => {
          this.animalSprite.clearTint();
          this.loadNextAnimal();
        }
      });
    } else {
      this.wrongSound.play();
      this.score -= 1;

      // Show temporary "Wrong!" popup text
      const wrongText = this.add.text(this.sys.cameras.main.centerX, 300, 'Wrong!', {
        font: '64px outfit',
        fill: '#f8f8f8ff',
        fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(100);

      this.time.delayedCall(400, () => {
        this.sys.tweens.add({
          targets: wrongText,
          alpha: 0,
          duration: 400,
          ease: 'Power1',
          onComplete: () => wrongText.destroy()
        });
      });

      this.sys.tweens.add({
        targets: wrongText,
        alpha: 0,
        duration: 400,
        ease: 'Power1',
        onComplete: () => wrongText.destroy()
      });

      this.sys.tweens.add({
        targets: this.animalSprite,
        tint: 0xff0000,
        alpha: 0.3,
        duration: 100,
        yoyo: true,
        repeat: 2,
        onComplete: () => {
          this.animalSprite.clearTint();
          this.animalSprite.setAlpha(1);
          this.loadNextAnimal();
        }
      });
    }

    this.sys.tweens.add({
      targets: this.scoreText,
      scale: 1.3,
      duration: 100,
      yoyo: true,
      onUpdate: () => this.scoreText.setText('Score: ' + this.score)
    });

    if (this.score >= this.targetScore) {
      this.checkGameResult();
    }
  }


  checkGameResult() {
    if (this.timerEvent) this.timerEvent.remove(false);
    if (this.score >= this.targetScore) {
      this.levelComplete(); // ✅ updated here
    } else {
      this.showGameOverOverlay();
    }
  }


  levelComplete() {
    this.isGameOver = true;
    if (this.timerEvent) this.timerEvent.remove();
    this.physics.pause?.();

    const centerX = this.sys.cameras.main.centerX;
    const centerY = this.sys.cameras.main.centerY;

    this.levelCompleteOverlay = this.add.container(centerX, centerY).setDepth(1000);

    const rec = this.add.rectangle(0, 0, 1920, 1080, 0x000000, 0.85).setOrigin(0.5);

    // Use winbg if present, else fall back to previous 'levelComplete'
    const winBgKey = this.textures.exists('winbg') ? 'winbg' : 'levelComplete';
    const bg = this.add.image(0, 0, winBgKey).setOrigin(0.5);
    const bg1 = this.add.image(0, 0, 'levelComplete').setScale(0.55, 0.6)

    const text = this.add.text(0, 50, 'Level Completed', {
      font: '70px outfit',
      fill: '#ffffff'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(2);

    const nextBtn = this.add.image(-230, 380, 'next').setInteractive().setOrigin(0.5).setScrollFactor(0);
    const replayBtn = this.add.image(230, 380, 'replay').setInteractive().setOrigin(0.5).setScrollFactor(0);

    nextBtn.on('pointerdown', () => {
      this.notifyParent('sceneComplete', { result: 'win' });
    });

    replayBtn.on('pointerdown', () => {
      this.levelCompleteOverlay.destroy();
      if (this.bgMusic) this.bgMusic.stop();
      this.scene.restart();
    });

    this.levelCompleteOverlay.add([rec, bg, bg1, text, nextBtn, replayBtn]);


  }


  notifyParent(type, data) {
    if (window.parent !== window) {
      window.parent.postMessage({ type, ...data }, "*");
    }
  }


  showGameOverOverlay() {
    const centerX = this.sys.game.config.width / 2;
    const centerY = this.sys.game.config.height / 2;



    this.gameOverOverlay = this.add.container(centerX, centerY).setScrollFactor(0).setDepth(1000);

    const rec = this.add.rectangle(0, 0, 1920, 1080, 0x000000, 0.85).setOrigin(0.5);

    // Use ovrbg if present, else fall back to previous 'gameOver'
    const ovrBgKey = this.textures.exists('ovrbg') ? 'ovrbg' : 'gameOver';
    const bg = this.add.image(0, 0, ovrBgKey).setOrigin(0.5);
    const bg1 = this.add.image(0, 0, 'gameOver').setScale(0.55, 0.6)
    const targetLabel1 = this.add.text(-200, -150, 'Game Over', { font: '75px outfit', fill: '#ffffff' }).setOrigin(0, 0.5);
    const targetLabel = this.add.text(-200, 100, 'Target:', { font: '45px outfit', fill: '#ffffff' }).setOrigin(0, 0.5);
    const targetValue = this.add.text(200, 100, this.targetScore.toString(), { font: '45px outfit', fill: '#ffffff' }).setOrigin(1, 0.5);
    const yourLabel = this.add.text(-200, 0, 'Your Score:', { font: '45px outfit', fill: '#ffffff' }).setOrigin(0, 0.5);
    const yourValue = this.add.text(200, 0, this.score.toString(), { font: '45px outfit', fill: '#ffffff' }).setOrigin(1, 0.5);

    const replayBtn = this.add.image(0, 350, 'replayLevel').setInteractive();
    replayBtn.on('pointerdown', () => {
      this.gameOverOverlay.destroy();
      this.bgMusic?.stop();
      this.scene.restart();
    });

    this.gameOverOverlay.add([rec, bg, bg1, targetLabel1, targetLabel, targetValue, yourLabel, yourValue, replayBtn]);
  }



  showStartScreen() {
    const centerX = this.sys.game.config.width / 2;
    const centerY = this.sys.game.config.height / 2;

    // Ensure gameplay is hidden during HTP
    this.gameLayer?.setVisible(false);

    this.startOverlay = this.add.container(centerX, centerY).setScrollFactor(0).setDepth(1000);

    // Full-screen dim
    const rec = this.add.rectangle(0, 0, 1920, 1080, 0x000000, 0.85).setOrigin(0.5);

    // HTP background image (from cfg.ui.htpbg). Fallback to previous asset if missing.
    const htpBgKey = this.textures.exists('htpbg') ? 'htpbg' : 'dialog_bg_start';
    const bg = this.add.image(0, 0, htpBgKey).setOrigin(0.5).setScale(0.95);
    const dialog_bg_start = this.add.image(0, -100, 'dialog_bg_start').setScale(0.55, 0.8)
    const baseText = this.configData.texts?.instructions || 'Instructions here.';
    const baseText1 = this.configData.texts?.instructions1 || 'Instructions here.';
    const instructionText = this.add.text(0, -240, baseText, {
      font: "48px Arial",
      color: '#ffffff',
      align: 'center',
      wordWrap: { width: 1100 }
    }).setOrigin(0.5);
    const instructionText1 = this.add.text(0, -360, baseText1, {
      font: "58px Arial",
      color: '#ffffff',
      align: 'center',
      wordWrap: { width: 1100 }
    }).setOrigin(0.5);

    const pairContainer = this.add.container(0, -30);
    const numPairs = this.configData.numPairs;

    for (let i = 1; i <= numPairs; i++) {
      const animalKey = `animal${i}`;
      const foodKey = `food${i}`;
      const x = (i - 1) * 200 - (numPairs - 1) * 100;

      const animal = this.add.image(x - 40, 0, animalKey).setDisplaySize(150, 150).setOrigin(0.5);
      const food = this.add.image(x - 40, 160, foodKey).setDisplaySize(100, 100).setOrigin(0.5);
      pairContainer.add([animal, food]);
    }

    const startBtn = this.add.image(0, 360, 'playGame').setInteractive();
    startBtn.on('pointerdown', () => {
      // Remove overlay
      this.startOverlay.destroy();

      // Reveal gameplay and start BGM/timer
      this.gameLayer.setVisible(true);

      this.state = 'playing';
      this.loadNextAnimal();

      this.timerEvent = this.time.addEvent({
        delay: 1000,
        loop: true,
        callback: () => {
          this.timeLeft--;
          this.sys.tweens.add({
            targets: this.timerText,
            scale: 1.3,
            duration: 100,
            yoyo: true,
            onUpdate: () => this.timerText.setText('Time: ' + this.timeLeft)
          });
          if (this.timeLeft <= 0) this.checkGameResult();
        }
      });
    });

    this.startOverlay.add([rec, bg, dialog_bg_start, instructionText, instructionText1, pairContainer, startBtn]);
    this.state = 'start';
  }


}
