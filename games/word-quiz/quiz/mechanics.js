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

      // Background
      if (cfg.images2?.background) {
        this.load.image('background', `${basePath}/${cfg.images2.background}`);
      }

      // Old animal/food assets (kept so HTP pairs still work if you want them)
      const loadedKeys = new Set();
      if (cfg.numPairs && cfg.images1) {
        for (let i = 1; i <= cfg.numPairs; i++) {
          const animalKey = `animal${i}`;
          const foodKey = `food${i}`;
          if (cfg.images1[animalKey + 'Image']) {
            this.load.image(animalKey, `${basePath}/${cfg.images1[animalKey + 'Image']}`);
            loadedKeys.add(cfg.images1[animalKey + 'Image']);
          }
          if (cfg.images1[foodKey + 'Image']) {
            this.load.image(foodKey, `${basePath}/${cfg.images1[foodKey + 'Image']}`);
            loadedKeys.add(cfg.images1[foodKey + 'Image']);
          }
        }
      }

      // Other images2
      for (const [key, path] of Object.entries(cfg.images2 || {})) {
        if (!loadedKeys.has(path) && key !== 'background') {
          this.load.image(key, `${basePath}/${path}`);
        }
      }

      // UI elements (buttons/overlays/scorecard)
      for (const [key, path] of Object.entries(cfg.ui || {})) {
        if (path) {
          this.load.image(key, `${basePath}/${path}`);
        }
      }

      // Audio
      for (const [key, url] of Object.entries(cfg.audio || {})) {
        if (!url || typeof url !== 'string') continue;

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
    const cfg = this.configData;

    const W = this.sys.game.config.width;
    const H = this.sys.game.config.height;

    // ─── QUIZ LAYOUT FROM JSON ────────────────────────────────────────────────
    const layoutCfg = cfg.layout || {};

    // Ratios are relative to screen height (0 = top, 1 = bottom)
    this.questionYRatio = layoutCfg.questionYRatio ?? 0.26;         // was 0.32
    this.optionsStartYRatio = layoutCfg.optionsStartYRatio ?? 0.50; // was 0.55
    this.optionsSpacing = layoutCfg.optionsSpacing ?? 120;          // was 140

    // Apply orientation from config (we only force landscape; portrait will be 1080x1920 via game config)
    if (levelData.orientation?.frame === 'landscape' && screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('landscape-primary').catch(err =>
        console.warn('Orientation lock failed:', err)
      );
    }

    // ─── GAME STATE ──────────────────────────────────────────────────────────────
    this.score = 0;

    const gp = cfg.gameplay || {};

    // Time limit from JSON
    this.timeLeft = gp.timeLimit ?? 60;

    // Difficulty from JSON: "easy" | "medium" | "hard"
    this.difficulty = (gp.difficulty || 'easy').toLowerCase();

    // how many questions asked per run (default 5 now)
    this.maxQuestions = gp.maxQuestions ?? 5;

    // how many need to be correct to win
    this.targetScore = gp.targetScore ?? gp.requiredCorrect ?? 3;

    // Quiz-specific
    this.currentQuestionIndex = 0;
    this.selectedQuestions = [];

    this.timerEvent = null;
    this.state = 'start';

    this.sys.cameras.main.setBackgroundColor('#000');

    // ---- put the whole gameplay under a single container ----
    this.gameLayer = this.add.container(0, 0).setDepth(0);

    // Background inside gameLayer
    if (cfg.images2?.background) {
      const bg = this.add.image(0, 0, 'background').setOrigin(0);
      bg.setDisplaySize(this.sys.cameras.main.width, this.sys.cameras.main.height);
      this.gameLayer.add(bg);
    }

    // ─── HUD (Timer + Score) ────────────────────────────────────────────────────
    const hudY = H * 0.08;
    const leftCardX = W * 0.25;
    const rightCardX = W * 0.75;

    const scorecard = this.add
      .image(leftCardX, hudY, 'scorecard')
      .setScrollFactor(0);
    const scorecard1 = this.add
      .image(rightCardX, hudY, 'scorecard')
      .setScrollFactor(0);

    const scorecard2 = this.add
      .image(rightCardX - 280, hudY + 100, 'scorecard')
      .setScrollFactor(0);

    this.timerText = this.add
      .text(leftCardX, hudY - 5, `Time: ${this.timeLeft}`, {
        font: '50px outfit',
        fill: 'black',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(1);

    this.scoreText = this.add
      .text(rightCardX, hudY - 5, 'Score: 0', {
        font: '50px outfit',
        fill: 'black',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(1);

    this.targettxt = this.add
      .text(rightCardX - 280, hudY + 100, 'Target: ' + this.targetScore.toString(), {
        font: '50px outfit',
        fill: 'black',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(1);

    this.gameLayer.add([scorecard, scorecard1, scorecard2, this.scoreText, this.targettxt,this.timerText]);

    // ─── Audio ──────────────────────────────────────────────────────────────────
    this.correctSound = this.sound.add('correct');
    this.wrongSound = this.sound.add('wrong');
    this.bgMusic = this.sound.add('bg_music', { loop: true });
    this.bgMusic?.play();

    // ─── Prepare Questions from JSON (difficulty-based) ─────────────────────────
    this.prepareQuestionsFromConfig(cfg);

    // ─── Create Question + Options UI ───────────────────────────────────────────
    this.createQuestionUI();

    // IMPORTANT: hide gameplay until Start pressed
    this.gameLayer.setVisible(false);

    // Show HTP (start screen)
    this.showStartScreen();
  }

  // Pick questions based on difficulty / JSON format
  prepareQuestionsFromConfig(cfg) {
    const questionsConfig = cfg.questions || [];

    // Backward compatibility: old flat array
    if (Array.isArray(questionsConfig)) {
      if (questionsConfig.length > 0) {
        const shuffled = Phaser.Utils.Array.Shuffle(questionsConfig.slice());
        this.selectedQuestions = shuffled.slice(0, this.maxQuestions);
      } else {
        this.selectedQuestions = [];
        console.warn('No questions found in config.json (flat array is empty).');
      }
      return;
    }

    // New format: { easy: [], medium: [], hard: [] }
    const difficultyKey = this.difficulty || 'easy';
    let pool = questionsConfig[difficultyKey] || [];

    // Fallback if chosen difficulty has no questions
    if (!Array.isArray(pool) || pool.length === 0) {
      const order = ['easy', 'medium', 'hard'];
      for (const key of order) {
        if (Array.isArray(questionsConfig[key]) && questionsConfig[key].length > 0) {
          pool = questionsConfig[key];
          console.warn(`Difficulty "${difficultyKey}" empty, falling back to "${key}".`);
          break;
        }
      }
    }

    if (Array.isArray(pool) && pool.length > 0) {
      const shuffled = Phaser.Utils.Array.Shuffle(pool.slice());
      this.selectedQuestions = shuffled.slice(0, this.maxQuestions);
    } else {
      this.selectedQuestions = [];
      console.warn('No questions found in config.json for any difficulty.');
    }
  }

  // ───────────────────────────────────────────────────────────────────────────────
  //      QUIZ UI
  // ───────────────────────────────────────────────────────────────────────────────

  createQuestionUI() {
    const W = this.sys.game.config.width;
    const H = this.sys.game.config.height;

    const questionY = H * (this.questionYRatio ?? 0.26);
    const startY = H * (this.optionsStartYRatio ?? 0.50);
    const spacing = this.optionsSpacing ?? 120;

    // 🔹 Question background card (similar to options)
    const questionBgWidth = W * 0.9;
    const questionBgHeight = 120;

    const questionBg = this.add
      .rectangle(
        W * 0.5,
        questionY,
        questionBgWidth,
        questionBgHeight,
        0xffffff,
        0.9
      )
      .setStrokeStyle(3, 0x000000);

    // Question text (center, upper-middle)
    this.questionText = this.add
      .text(W * 0.5, questionY, '', {
        font: '46px outfit',
        fill: '#000000',              // black to match options
        align: 'center',
        wordWrap: { width: questionBgWidth * 0.9 },
      })
      .setOrigin(0.5)
      .setDepth(1);

    // Add both to gameLayer so bg sits behind text
    this.gameLayer.add([questionBg, this.questionText]);

    // Option buttons (up to 4)
    this.optionButtons = []; // array of { container, bg, label }

    const btnWidth = W * 0.8;
    const btnHeight = 100;

    for (let i = 0; i < 4; i++) {
      const container = this.add.container(W * 0.5, startY + i * spacing);

      const bg = this.add
        .rectangle(0, 0, btnWidth, btnHeight, 0xffffff, 0.9)
        .setStrokeStyle(3, 0x000000)
        .setInteractive({ useHandCursor: true });

      const label = this.add
        .text(0, 0, '', {
          font: '40px outfit',
          fill: '#000000',
          align: 'center',
          wordWrap: { width: btnWidth * 0.9 },
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });

      container.add([bg, label]);

      this.optionButtons.push({ container, bg, label });
      this.gameLayer.add(container);

      const index = i;
      const handler = () => {
        if (this.state !== 'playing') return;
        this.handleOptionSelection(index);
      };

      bg.on('pointerdown', handler);
      label.on('pointerdown', handler);
    }
  }

  showQuestion() {
    if (!this.selectedQuestions || this.selectedQuestions.length === 0) {
      console.warn('No selected questions; cannot showQuestion()');
      return;
    }

    if (this.currentQuestionIndex >= this.selectedQuestions.length) {
      this.checkGameResult();
      return;
    }

    const q = this.selectedQuestions[this.currentQuestionIndex];
    const text = q.text || q.question || '';
    const options = q.options || [];

    this.questionText.setText(text);

    for (let i = 0; i < this.optionButtons.length; i++) {
      const btn = this.optionButtons[i];
      const optText = options[i] ?? '';
      btn.label.setText(optText);
      const visible = !!optText;
      btn.container.setVisible(visible);
      btn.bg.setFillStyle(0xffffff, 0.9); // reset button color
    }
  }

  handleOptionSelection(selectedIndex) {
    const q = this.selectedQuestions[this.currentQuestionIndex];
    const correctIndex =
      typeof q.correctIndex === 'number' ? q.correctIndex : 0;

    const isCorrect = selectedIndex === correctIndex;

    const chosenBtn = this.optionButtons[selectedIndex];
    const correctBtn = this.optionButtons[correctIndex];

    if (isCorrect) {
      this.correctSound?.play();

      // Increment "score" = #correct answers
      this.score += 1;

      // Reset all buttons to default, then set chosen to GREEN
      this.optionButtons.forEach(btn => {
        btn.bg.setFillStyle(0xffffff, 0.9);
      });

      if (chosenBtn) {
        chosenBtn.bg.setFillStyle(0x00ff00, 0.9); // green
      }

    } else {
      this.wrongSound?.play();

      // Wrong popup
      const wrongText = this.add
        .text(
          this.sys.cameras.main.centerX,
          this.sys.cameras.main.centerY - 250,
          'Wrong!',
          {
            font: '64px outfit',
            fill: '#ffffff',
            fontStyle: 'bold',
          }
        )
        .setOrigin(0.5)
        .setDepth(100);

      this.sys.tweens.add({
        targets: wrongText,
        alpha: 0,
        duration: 600,
        ease: 'Power1',
        onComplete: () => wrongText.destroy(),
      });

      // highlight correct answer in green, chosen in red
      if (chosenBtn) {
        chosenBtn.bg.setFillStyle(0xff0000, 0.9); // red
      }
      if (correctBtn) {
        correctBtn.bg.setFillStyle(0x00ff00, 0.9); // green
      }
    }

    // Animate score text bump
    this.sys.tweens.add({
      targets: this.scoreText,
      scale: 1.2,
      duration: 120,
      yoyo: true,
      onUpdate: () => this.scoreText.setText('Score: ' + this.score),
    });

    // Move to next question after a 1 sec delay
    this.state = 'feedback';
    this.time.delayedCall(1000, () => {
      this.currentQuestionIndex += 1;

      // Check win/lose conditions
      const done = this.checkGameResult();
      if (!done) {
        this.state = 'playing';
        this.showQuestion();
      }
    });
  }

  // ───────────────────────────────────────────────────────────────────────────────
  //      RESULT LOGIC (WIN / LOSE)
  // ───────────────────────────────────────────────────────────────────────────────

  checkGameResult() {
    // WIN: reached required correct answers
    if (this.score >= this.targetScore) {
      if (this.timerEvent) this.timerEvent.remove(false);
      this.levelComplete();
      return true;
    }

    // LOSE conditions:
    const noMoreQuestions =
      this.currentQuestionIndex >= this.maxQuestions ||
      this.currentQuestionIndex >= (this.selectedQuestions?.length || 0);

    if (noMoreQuestions || this.timeLeft <= 0) {
      if (this.timerEvent) this.timerEvent.remove(false);
      this.showGameOverOverlay();
      return true;
    }

    return false;
  }

  levelComplete() {
    this.isGameOver = true;
    if (this.timerEvent) this.timerEvent.remove();
    this.physics.pause?.();

    const centerX = this.sys.cameras.main.centerX;
    const centerY = this.sys.cameras.main.centerY;
    const W = this.sys.game.config.width;
    const H = this.sys.game.config.height;

    this.levelCompleteOverlay = this.add.container(centerX, centerY).setDepth(1000);

    const rec = this.add
      .rectangle(0, 0, W, H, 0x000000, 0.85)
      .setOrigin(0.5);

    // Use winbg if present, else fall back to previous 'levelComplete'
    const winBgKey = this.textures.exists('winbg') ? 'winbg' : 'levelComplete';
    const bg = this.add.image(0, 0, winBgKey).setOrigin(0.5);
    const bg1 = this.add.image(0, 0, 'levelComplete').setScale(0.55, 0.6);

    const text = this.add
      .text(0, 0, 'Level Completed', {
        font: '80px outfit',
        fill: '#ffffff',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(2);

    const nextBtn = this.add
      .image(-230, 380, 'next')
      .setInteractive()
      .setOrigin(0.5)
      .setScrollFactor(0);
    const replayBtn = this.add
      .image(230, 380, 'replay')
      .setInteractive()
      .setOrigin(0.5)
      .setScrollFactor(0);

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
      window.parent.postMessage({ type, ...data }, '*');
    }
  }

  showGameOverOverlay() {
    const centerX = this.sys.game.config.width / 2;
    const centerY = this.sys.game.config.height / 2;
    const W = this.sys.game.config.width;
    const H = this.sys.game.config.height;

    this.gameOverOverlay = this.add
      .container(centerX, centerY)
      .setScrollFactor(0)
      .setDepth(1000);

    const rec = this.add
      .rectangle(0, 0, W, H, 0x000000, 0.85)
      .setOrigin(0.5);

    // Use ovrbg if present, else fall back to previous 'gameOver'
    const ovrBgKey = this.textures.exists('ovrbg') ? 'ovrbg' : 'gameOver';
    const bg = this.add.image(0, 0, ovrBgKey).setOrigin(0.5);
    const bg1 = this.add.image(0, 0, 'gameOver').setScale(0.55, 0.6);

    const targetLabel1 = this.add
      .text(-200, -150, 'Game Over', {
        font: '75px outfit',
        fill: '#ffffff',
      })
      .setOrigin(0, 0.5);
    const targetLabel = this.add
      .text(-200, 100, 'Target:', {
        font: '45px outfit',
        fill: '#ffffff',
      })
      .setOrigin(0, 0.5);
    const targetValue = this.add
      .text(200, 100, this.targetScore.toString(), {
        font: '45px outfit',
        fill: '#ffffff',
      })
      .setOrigin(1, 0.5);
    const yourLabel = this.add
      .text(-200, 0, 'Your Score:', {
        font: '45px outfit',
        fill: '#ffffff',
      })
      .setOrigin(0, 0.5);
    const yourValue = this.add
      .text(200, 0, this.score.toString(), {
        font: '45px outfit',
        fill: '#ffffff',
      })
      .setOrigin(1, 0.5);

    const replayBtn = this.add.image(0, 350, 'replayLevel').setInteractive();
    replayBtn.on('pointerdown', () => {
      this.gameOverOverlay.destroy();
      this.bgMusic?.stop();
      this.scene.restart();
    });

    this.gameOverOverlay.add([
      rec,
      bg,
      bg1,
      targetLabel1,
      targetLabel,
      targetValue,
      yourLabel,
      yourValue,
      replayBtn,
    ]);
  }

  showStartScreen() {
    const centerX = this.sys.game.config.width / 2;
    const centerY = this.sys.game.config.height / 2;
    const W = this.sys.game.config.width;
    const H = this.sys.game.config.height;

    // Ensure gameplay is hidden during HTP
    this.gameLayer?.setVisible(false);

    this.startOverlay = this.add
      .container(centerX, centerY)
      .setScrollFactor(0)
      .setDepth(1000);

    // Full-screen dim
    const rec = this.add
      .rectangle(0, 0, W, H, 0x000000, 0.85)
      .setOrigin(0.5);

    // HTP background image
    const htpBgKey = this.textures.exists('htpbg') ? 'htpbg' : 'dialog_bg_start';
    const bg = this.add.image(0, 0, htpBgKey).setOrigin(0.5).setScale(0.95);
    const dialog_bg_start = this.add
      .image(0, -100, 'dialog_bg_start')
      .setScale(0.55, 0.8);

    const gp = this.configData.gameplay || {};
    const difficultyLabel =
      (gp.difficulty || 'easy').charAt(0).toUpperCase() +
      (gp.difficulty || 'easy').slice(1);
    const maxQ = gp.maxQuestions ?? 5;
    const required = gp.targetScore ?? gp.requiredCorrect ?? Math.ceil(maxQ * 0.6);

    const baseText1 =
      this.configData.texts?.instructions1 ||
      'How to Play';

    const baseText =
      this.configData.texts?.instructions ||
      `You will be asked ${maxQ} ${difficultyLabel} questions.\n` +
      `Pick the correct option for each.\n` +
      `Get at least ${required} correct answers before the time runs out to win!`;

    const instructionText1 = this.add
      .text(0, -360, baseText1, {
        font: '68px Arial',
        color: '#ffffff',
        align: 'center',
        wordWrap: { width: W * 0.9 },
      })
      .setOrigin(0.5);

    const instructionText = this.add
      .text(0, -100, baseText, {
        font: '48px Arial',
        color: '#ffffff',
        align: 'center',
        wordWrap: { width: W * 0.9 },
      })
      .setOrigin(0.5);

    // Pair images (animal/food)


    const pairContainer = this.add.container(0, -30);

    // const numPairs = this.configData.numPairs || 0;

    // for (let i = 1; i <= numPairs; i++) {
    //   const animalKey = `animal${i}`;
    //   const foodKey = `food${i}`;
    //   const x = (i - 1) * 200 - (numPairs - 1) * 100;

    //   const animal = this.add
    //     .image(x - 40, 0, animalKey)
    //     .setDisplaySize(150, 150)
    //     .setOrigin(0.5);
    //   const food = this.add
    //     .image(x - 40, 160, foodKey)
    //     .setDisplaySize(100, 100)
    //     .setOrigin(0.5);
    //   pairContainer.add([animal, food]);
    // }

    const startBtn = this.add.image(0, 360, 'playGame').setInteractive();
    startBtn.on('pointerdown', () => {
      // Remove overlay
      this.startOverlay.destroy();

      // Reveal gameplay and start BGM/timer
      this.gameLayer.setVisible(true);

      this.state = 'playing';

      // Start first question
      this.currentQuestionIndex = 0;
      this.score = 0;
      this.timeLeft = gp.timeLimit ?? 60;
      this.timerText.setText('Time: ' + this.timeLeft);
      this.scoreText.setText('Score: ' + this.score);

      this.showQuestion();

      this.timerEvent = this.time.addEvent({
        delay: 1000,
        loop: true,
        callback: () => {
          this.timeLeft--;
          if (this.timeLeft < 0) this.timeLeft = 0;

          this.sys.tweens.add({
            targets: this.timerText,
            scale: 1.2,
            duration: 100,
            yoyo: true,
            onUpdate: () => this.timerText.setText('Time: ' + this.timeLeft),
          });

          if (this.timeLeft <= 0) {
            this.checkGameResult();
          }
        },
      });
    });

    this.startOverlay.add([
      rec,
      bg,
      dialog_bg_start,
      instructionText,
      instructionText1,
      pairContainer,
      startBtn,
    ]);

    this.state = 'start';
  }
}
