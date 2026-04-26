const basePath = import.meta.url.substring(
  0,
  import.meta.url.lastIndexOf('/')
);
export const CONFIG_PATH = `${basePath}/config.json`;
const SCREEN_WIDTH = 1080;
const SCREEN_HEIGHT = 1920;

export default class GamePlayScene extends Phaser.Scene {
  constructor() {
    super('GamePlayScene');

    // Default timing, target, and audio keys; all overridden from config.json
    this.molePopUpMs = 800;
    this.moleHoldMs = 1500;
    this.molePopDownMs = 800;
    this.moleCycleMs = this.molePopUpMs + this.moleHoldMs + this.molePopDownMs;
    this.timeLimit = 60;    // seconds
    this.scoreTarget = 600;

    this.bgm = null;       // background music Sound object
    this.hitSound = null;  // hit effect Sound object

    this.moles = [];       // Initialize moles array
    this.score = 0;        // Initialize score
    this.remainingTime = this.timeLimit;
    this.holePattern = [1, 2, 1, 2, 1, 2, 1]; // Default hole pattern
    this.isPaused = true;  // Start paused for start screen
    this.maxPopUp = 3;     // max moles to pop up at once

    console.log('Constructor initialized:', { moles: this.moles, score: this.score, scoreTarget: this.scoreTarget, remainingTime: this.remainingTime, moleCycleMs: this.moleCycleMs });
  }

  preload() {
    // Load the JSON manifest
    this.load.json('assetConfig', CONFIG_PATH);

    // Parse and queue assets when JSON is ready
    this.load.once('filecomplete-json-assetConfig', () => {
      const cfg = this.cache.json.get('assetConfig') || {};

      // Mechanics overrides (unchanged)
      this.molePopUpMs = Number(cfg.MOLE_POP_UP_MS) || this.molePopUpMs;
      this.moleHoldMs = Number(cfg.MOLE_HOLD_MS) || this.moleHoldMs;
      this.molePopDownMs = Number(cfg.MOLE_POP_DOWN_MS) || this.molePopDownMs;
      if (!isFinite(this.molePopUpMs) || this.molePopUpMs <= 0) this.molePopUpMs = 800;
      if (!isFinite(this.moleHoldMs) || this.moleHoldMs <= 0) this.moleHoldMs = 1500;
      if (!isFinite(this.molePopDownMs) || this.molePopDownMs <= 0) this.molePopDownMs = 800;
      this.moleCycleMs = this.molePopUpMs + this.moleHoldMs + this.molePopDownMs;

      this.timeLimit = Number(cfg.timeLimitSeconds) || this.timeLimit;
      if (!isFinite(this.timeLimit) || this.timeLimit <= 0) this.timeLimit = 60;
      this.remainingTime = this.timeLimit;
      this.scoreTarget = Number(cfg.scoreTarget) || this.scoreTarget;
      if (!isFinite(this.scoreTarget) || this.scoreTarget <= 0) this.scoreTarget = 100;
      this.score = Number(cfg.initialScore) || this.score;
      if (!isFinite(this.score)) this.score = 0;

      this.maxPopUp = Math.min(Number(cfg.maxPopUp) || this.maxPopUp, 9);
      if (!isFinite(this.maxPopUp) || this.maxPopUp <= 0) this.maxPopUp = 3;

      if (Array.isArray(cfg.holePattern) && cfg.holePattern.length) {
        this.holePattern = cfg.holePattern;
      } else {
        this.holePattern = [1, 2, 1, 2, 1, 2, 1];
        console.warn('Invalid or empty holePattern in config.json, using default:', this.holePattern);
      }

      // Load text configurations
      this.textConfig = cfg.text || {};
      this.textConfig.howToPlay = this.textConfig.howToPlay || 'How to Play';
      this.textConfig.targetLabel = this.textConfig.targetLabel || 'Target';
      this.textConfig.timeLabel = this.textConfig.timeLabel || 'Time';
      this.textConfig.hitInstruction = this.textConfig.hitInstruction || 'Hit these to gain\npoints.';
      this.textConfig.avoidInstruction = this.textConfig.avoidInstruction || 'Avoid hitting this as it\nsteals your score.';
      this.textConfig.scoreDisplay = this.textConfig.scoreDisplay || 'Score: {score}/{target}';
      this.textConfig.timeDisplay = this.textConfig.timeDisplay || 'Time: {mm}:{ss}';
      this.textConfig.gameOver = this.textConfig.gameOver || 'Game Over';
      this.textConfig.yourScoreLabel = this.textConfig.yourScoreLabel || 'Your Score';
      this.textConfig.pauseTitle = this.textConfig.pauseTitle || 'GAME PAUSED';
      this.textConfig.resumeInstruction = this.textConfig.resumeInstruction || 'Click to Resume';

      // Load images (unchanged)
      if (cfg.images1) {
        for (const [key, url] of Object.entries(cfg.images1)) {
          this.load.image(key, `${basePath}/${url}`);
        }
      }
        if (cfg.images2) {
        for (const [key, url] of Object.entries(cfg.images2)) {
          this.load.image(key, `${basePath}/${url}`);
        }
      }
        if (cfg.ui) {
        for (const [key, url] of Object.entries(cfg.ui)) {
          this.load.image(key, `${basePath}/${url}`);
        }
      }

      // Load spritesheets (updated to handle character sprite with URL param)
      if (cfg.spritesheets) {
        const sheets = cfg.spritesheets || {};
        const heroData = sheets.hero || {};
        const rawMain = new URLSearchParams(window.location.search).get('main') || '';
        const cleanMain = rawMain.replace(/^"|"$/g, '');
        const sheetUrl = cleanMain || heroData.path || `${basePath}/assets/hero.png`;
        const frameW = heroData.frameWidth || 103;
        const frameH = heroData.frameHeight || 142;

        this.load.spritesheet('doodler', sheetUrl, {
          frameWidth: frameW,
          frameHeight: frameH
        });
        console.log('Loading character spritesheet:', 'doodler', sheetUrl, { frameWidth: frameW, frameHeight: frameH });

        // Load other spritesheets (unchanged)
        for (const [key, data] of Object.entries(sheets)) {
          if (key !== 'hero') {
            this.load.spritesheet(key, data.path, {
              frameWidth: data.frameWidth || 103,
              frameHeight: data.frameHeight || 143
            });
            console.log('Loading spritesheet:', key, data.path, { frameWidth: data.frameWidth, frameHeight: data.frameHeight });
          }
        }
      } else {
        console.warn('No spritesheets defined in config.json, loading default character sprite');
        this.load.spritesheet('doodler', `${basePath}/assets/characters.png`, {
          frameWidth: 103,
          frameHeight: 142
        });
      }

      // Load audio (unchanged)
      if (cfg.audio) {
        for (const [key, url] of Object.entries(cfg.audio)) {
          this.load.audio(key, `${basePath}/${url}`);
        }
      }

      console.log('Preload complete:', {
        moleCycleMs: this.moleCycleMs,
        score: this.score,
        scoreTarget: this.scoreTarget,
        remainingTime: this.remainingTime,
        holePattern: this.holePattern,
        maxPopUp: this.maxPopUp,
        textConfig: this.textConfig
      });

      this.load.start();
    });

    // Handle JSON loading errors (updated to include doodler fallback)
    this.load.on('loaderror', (file) => {
      console.error('Load error for file:', file.key, file.src);
      if (file.key === 'assetConfig') {
        console.error('Failed to load config.json:', file);
        this.holePattern = [1, 2, 1, 2, 1, 2, 1];
        this.scoreTarget = scoreTarget || 600;
        this.timeLimit = 60;
        this.remainingTime = this.timeLimit;
        this.molePopUpMs = 800;
        this.moleHoldMs = 1500;
        this.molePopDownMs = 800;
        this.moleCycleMs = this.molePopUpMs + this.moleHoldMs + this.molePopDownMs;
        this.maxPopUp = 3;
        this.score = 0;
        // Fallback text configuration
        this.textConfig = {
          howToPlay: 'How to Play',
          targetLabel: 'Target',
          timeLabel: 'Time',
          hitInstruction: 'Hit these to gain\npoints.',
          avoidInstruction: 'Avoid hitting this as it\nsteals your score.',
          scoreDisplay: 'Score: {score}/{target}',
          timeDisplay: 'Time: {mm}:{ss}',
          gameOver: 'Game Over',
          yourScoreLabel: 'Your Score',
          pauseTitle: 'GAME PAUSED',
          resumeInstruction: 'Click to Resume'
        };
        // Fallback character sprite
        this.load.spritesheet('doodler', `${basePath}/assets/characters.png`, {
          frameWidth: 103,
          frameHeight: 142
        });
        this.load.start();
      } else if (['restartbtn', 'ovrrestart', 'nextbtn'].includes(file.key)) {
        console.error(`Failed to load button asset: ${file.key}`);
      } else if (file.key === 'doodler') {
        console.warn('Failed to load doodler, character sprite will not display');
      }
    });

    this.load.on('filecomplete', (key) => console.log('Asset loaded:', key));
  }

  create() {
    // Reset critical properties on scene restart (unchanged)
    this.score = 0;
    this.remainingTime = this.timeLimit;
    this.moles = [];
    this.isPaused = true;
    this.htpText = null;
    this.targetText1 = null;
    this.timertext = null;
    this.timertext1 = null;
    this.htpMessageText = null;
    this.htpMessageText1 = null;
    console.log('Timer and score reset in create:', { timeLimit: this.timeLimit, remainingTime: this.remainingTime, score: this.score });

    // Clear existing game objects, preserving persistent UI (unchanged)
    this.children.list.forEach(child => {
      if (child !== this.scoreText && child !== this.timeText && child !== this.scorebg && child !== this.timebg) {
        child.destroy();
      }
    });
    console.log('Game objects cleared, remaining:', this.children.list.length);

    // Start screen UI (unchanged for images)
    const blurbg = this.add
      .rectangle(540, 960, 1080, 1920, 0x000000, 0.6)
      .setDepth(21);
    const mole = this.add.image(210, 700, 'enemy')
      .setScale(0.1).setDepth(25);
    const mole3 = this.add.image(370, 700, 'enemy3')
      .setScale(0.3).setDepth(25);
    const mole2 = this.add.image(210, 950, 'enemy')
      .setScale(0.16).setDepth(25);
    const playbg = this.add.image(SCREEN_WIDTH / 2, 910, 'htpbox')
      .setDepth(21)
      .setScale(1);
    const playbtn = this.add.image(SCREEN_WIDTH / 2, 1530, 'playbtn')
      .setDepth(21)
      .setScale(1)
      .setInteractive({ useHandCursor: true });

    // Start screen text (updated to use textConfig)
    this.htpText = this.add.text(450, 490, this.textConfig.howToPlay, {
      fontFamily: 'outfit',
      fontSize: '70px',
      fontStyle: 'bold',
      color: '#ffffff',
      align: 'center'
    }).setOrigin(0.5).setDepth(22);

    const targetText = this.add.text(850, 1170, `${this.scoreTarget}`, {
      fontFamily: 'outfit',
      fontSize: '60px',
      color: '#ffffff',
      backgroundColor: '#131704',
      align: 'center'
    }).setOrigin(0.5).setDepth(22);

    this.targetText1 = this.add.text(240, 1170, this.textConfig.targetLabel, {
      fontFamily: 'outfit',
      fontSize: '60px',
      color: '#ffffff',
      align: 'center'
    }).setOrigin(0.5).setDepth(22);

    const minutes = Math.floor(this.remainingTime / 60).toString().padStart(2, '0');
    const seconds = (this.remainingTime % 60).toString().padStart(2, '0');
    const formattedTime = `${minutes}:${seconds}`;

    this.timertext = this.add.text(850, 1340, formattedTime, {
      fontFamily: 'outfit',
      fontSize: '60px',
      color: '#ffffff',
      backgroundColor: '#131704',
      align: 'center'
    }).setOrigin(0.5).setDepth(22);

    this.timertext1 = this.add.text(220, 1340, this.textConfig.timeLabel, {
      fontFamily: 'outfit',
      fontSize: '60px',
      color: '#ffffff',
      align: 'center'
    }).setOrigin(0.5).setDepth(22);

    this.htpMessageText = this.add.text(600, 950, this.textConfig.avoidInstruction, {
      fontFamily: 'outfit',
      fontSize: '60px',
      color: '#ffffff',
      backgroundColor: '#161A05',
      lineSpacing: 5
    }).setOrigin(0.5).setDepth(22);

    this.htpMessageText1 = this.add.text(700, 720, this.textConfig.hitInstruction, {
      fontFamily: 'outfit',
      fontSize: '60px',
      color: '#ffffff',
      lineSpacing: 5
    }).setOrigin(0.5).setDepth(22);

    // Pause gameplay (unchanged)
    this.isPaused = true;
    this.input.enabled = false;
    playbtn.scene.input.enabled = true;

    playbtn.on('pointerdown', () => {
      playbg.destroy();
      blurbg.destroy();
      playbtn.destroy();
      mole.destroy();
      mole2.destroy();
      mole3.destroy();
      targetText.destroy();
      if (this.htpText) this.htpText.destroy();
      if (this.targetText1) this.targetText1.destroy();
      if (this.timertext) this.timertext.destroy();
      if (this.timertext1) this.timertext1.destroy();
      if (this.htpMessageText) this.htpMessageText.destroy();
      if (this.htpMessageText1) this.htpMessageText1.destroy();
      this.htpText = null;
      this.targetText1 = null;
      this.timertext = null;
      this.timertext1 = null;
      this.htpMessageText = null;
      this.htpMessageText1 = null;
      this.isPaused = false;
      this.input.enabled = true;
      if (this.popEvent) this.popEvent.paused = false;
      if (this.countdownEvent) this.countdownEvent.paused = false;
      console.log('Game started');
    });

    // Ensure critical properties (unchanged)
    if (!Array.isArray(this.moles)) {
      this.moles = [];
      console.warn('moles array was undefined or invalid in create, reinitialized to empty array');
    }
    if (!isFinite(this.scoreTarget)) {
      this.scoreTarget = 50;
      console.warn('scoreTarget was invalid in create, reinitialized to:', this.scoreTarget);
    }
    if (!isFinite(this.timeLimit)) {
      this.timeLimit = 60;
      console.warn('timeLimit was invalid in create, reinitialized to:', this.timeLimit);
    }
    if (!isFinite(this.remainingTime)) {
      this.remainingTime = this.timeLimit;
      console.warn('remainingTime was invalid in create, reinitialized to:', this.remainingTime);
    }
    if (!isFinite(this.moleCycleMs)) {
      this.moleCycleMs = this.molePopUpMs + this.moleHoldMs + this.molePopDownMs;
      console.warn('moleCycleMs was invalid in create, reinitialized to:', this.moleCycleMs);
    }
    if (!isFinite(this.score)) {
      this.score = 0;
      console.warn('score was invalid in create, reinitialized to:', this.score);
    }

    // Background & scaling (unchanged)
    this.add.image(0, -10, 'background').setOrigin(0, 0).setScale(1.2);
    this.scale.scaleMode = Phaser.Scale.FIT;
    this.scale.autoCenter = Phaser.Scale.CENTER_BOTH;
    this.cameras.main.setBackgroundColor('#a0e0a0');

    // Play background music (unchanged)
    if (this.sound && this.cache.audio.exists('bgmusic')) {
      this.bgm = this.sound.add('bgmusic', { loop: true });
      this.bgm.play();
    }

    // Prepare hit sound (unchanged)
    if (this.sound && this.cache.audio.exists('hit')) {
      this.hitSound = this.sound.add('hit');
    }

    // Top UI bar (unchanged)
    this.scorebg = this.add.image(250, 100, 'scorebg').setScale(0.9, 1);
    this.timebg = this.add.image(870, 100, 'timebg').setScale(1.1, 1);

    // Shared text style
    const textStyle = {
      fontFamily: 'outfit',
      fontSize: '50px',
      fontStyle: 'bold',
      color: 'black',
    };

    // Score display (updated to use textConfig)
    const scoreText = this.textConfig.scoreDisplay
      .replace('{score}', this.score)
      .replace('{target}', this.scoreTarget);
    this.scoreText = this.add
      .text(80, 65, scoreText, textStyle)
      .setDepth(10)
      .setScrollFactor(0)
      .setOrigin(0);

    // Timer display (updated to use textConfig)
    const formatTime = (seconds) => {
      const minutes = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return this.textConfig.timeDisplay
        .replace('{mm}', minutes.toString().padStart(2, '0'))
        .replace('{ss}', secs.toString().padStart(2, '0'));
    };
    this.timeText = this.add
      .text(1000, 65, formatTime(this.remainingTime), textStyle)
      .setDepth(10)
      .setScrollFactor(0)
      .setOrigin(1, 0);

    // Create holes + moles (unchanged)
    layoutHoles(this);

    console.log('Moles created:', this.moles.length, 'Score:', this.score);

    // Hammer sprite (unchanged)
    this.hammer = this.add.image(0, 0, 'hammer')
      .setScale(0.3)
      .setDepth(20)
      .setVisible(false);

    // Character sprite (updated to use 'doodler')
    if (this.textures.exists('doodler')) {
      this.character = this.add.sprite(0, 0, 'doodler')
        .setFrame(1)
        .setFlipX(true)
        .setScale(2)
        .setDepth(19)
        .setVisible(false);
      console.log('Character sprite created:', {
        frame: 13,
        flipX: this.character.flipX,
        scale: this.character.scale,
        depth: this.character.depth,
        visible: this.character.visible
      });
    } else {
      console.warn('doodler texture not found, character sprite not created');
      this.character = null;
    }

    // Whack input (unchanged)
    this.input.on('pointerdown', (pointer) => handleHit(this, pointer));

    // Pop-3 loop (unchanged)
    this.popEvent = this.time.addEvent({
      delay: this.moleCycleMs,
      loop: true,
      callback: () => {
        console.log('popThree triggered, moles available:', this.moles.length, 'Score:', this.score);
        popThree(this);
      },
      callbackScope: this,
      paused: true
    });

    // Countdown timer (updated to use formatTime)
    this.countdownEvent = this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        if (!isFinite(this.remainingTime)) {
          this.remainingTime = this.timeLimit;
          console.warn('remainingTime was NaN in countdown, reinitialized to:', this.remainingTime);
        }
        this.remainingTime = Math.max(0, this.remainingTime - 1);
        if (this.timeText) {
          this.timeText.setText(formatTime(this.remainingTime));
        } else {
          console.warn('timeText is undefined in countdownEvent');
        }
        console.log('Countdown tick, remainingTime:', this.remainingTime, 'Score:', this.score);
      },
      paused: true
    });

    // End game (unchanged)
    this.time.delayedCall(this.timeLimit * 1000, () => {
      if (!this.isPaused) {
        this.popEvent.remove();
        this.countdownEvent.remove();
        console.log('Active game objects before game over:', this.children.list.length);
        showGameOver(this);
      }
    });
  }
}

function layoutHoles(scene) {
  if (!Array.isArray(scene.holePattern) || !scene.holePattern.length) {
    scene.holePattern = [1, 2, 1, 2, 1, 2, 1];
    console.warn('holePattern is invalid or empty in layoutHoles, using default:', scene.holePattern);
  }

  const W = scene.scale.width, H = scene.scale.height;
  const top = 200, bottom = 200;
  const rows = scene.holePattern.length;
  const vSpace = (H - top - bottom) / (rows - 1);
  const cx = W / 2, hx = W * 0.25;

  scene.holePattern.forEach((cnt, i) => {
    const y = top + i * vSpace;
    const xs = cnt === 1 ? [cx] : [cx - hx, cx + hx];
    xs.forEach(x => createHoleWithMole(scene, x, y));
  });
}

function createHoleWithMole(scene, x, y) {
  if (!Array.isArray(scene.moles)) {
    scene.moles = [];
    console.warn('moles array was undefined or invalid in createHoleWithMole, reinitialized to empty array');
  }

  scene.add.image(x, y + 10, 'hole').setScale(0.23).setDepth(0);
  scene.add.image(x - 1, y + 10, 'hole1').setScale(2.4).setDepth(20);

  const moleYHidden = y + 5;
  const moleYVisible = y - 25;
  const mole = scene.add.image(x, moleYHidden, 'enemy')
    .setScale(0.2)
    .setDepth(10)
    .setVisible(false)
    .setInteractive();
  mole.originalYHidden = moleYHidden;
  mole.originalYVisible = moleYVisible;
  mole.hitCount = 1;
  mole.isAnimating = false;
  mole.on('pointerdown', () => whack(scene, mole));
  scene.moles.push(mole);
  console.log('Mole created at:', { x, y });
}

function popThree(scene) {
  if (scene.isPaused) {
    console.log('popThree skipped: game is paused');
    return;
  }

  if (!Array.isArray(scene.moles)) {
    scene.moles = [];
    console.warn('moles array was undefined or invalid in popThree, reinitialized to empty array');
  }

  const available = scene.moles.filter(m => m.active && !m.visible && !m.isAnimating);
  if (!available.length) {
    console.log('No available moles to pop');
    return;
  }

  const count = Math.min(scene.maxPopUp, available.length);
  Phaser.Utils.Array.Shuffle(available);
  const choices = available.slice(0, count);

  choices.forEach(mole => {
    mole.isAnimating = true;
    const types = ['enemy2', 'enemy', 'enemy3'];
    const key = Phaser.Utils.Array.GetRandom(types);
    mole.setTexture(key);
    if (key === 'enemy') { mole.setScale(0.18); mole.hitCount = 1; }
    else if (key === 'enemy2') { mole.setScale(0.25); mole.hitCount = 1; }
    else { mole.setScale(0.55); mole.hitCount = 1; }
    mole.setY(mole.originalYHidden).setVisible(true);
    console.log('Mole popped:', { texture: key, scale: mole.scale, hitCount: mole.hitCount });
  });

  scene.tweens.add({
    targets: choices,
    props: { y: { getEnd: m => m.originalYVisible } },
    ease: 'Quad.easeOut',
    duration: scene.molePopUpMs,
    onComplete: () => console.log('Pop-up animation completed for', choices.length, 'moles')
  });

  scene.time.delayedCall(scene.molePopUpMs + scene.moleHoldMs, () => {
    scene.tweens.add({
      targets: choices,
      props: { y: { getEnd: m => m.originalYHidden } },
      ease: 'Quad.easeIn',
      duration: scene.molePopDownMs,
      onComplete: () => {
        choices.forEach(m => {
          if (m.active) {
            m.setVisible(false);
            m.isAnimating = false;
            console.log('Mole hidden:', m.texture.key);
          }
        });
      }
    });
  });
}

function handleHit(scene, pointer) {
  if (scene.isPaused || scene.scene.isPaused()) {
    console.log('handleHit skipped: game is paused or scene is paused');
    return;
  }

  // Hammer animation
  scene.hammer
    .setPosition(pointer.x, pointer.y)
    .setAngle(-10)
    .setVisible(true);
  console.log('Hammer shown:', {
    x: scene.hammer.x,
    y: scene.hammer.y,
    visible: scene.hammer.visible,
    depth: scene.hammer.depth,
    angle: scene.hammer.angle
  });

  // Character sprite (no angle animation, updated to use 'doodler')
  if (scene.character) {
    scene.character
      .setPosition(pointer.x + 110, pointer.y + 40)
      .setFrame(13)
      .setFlipX(true)
      .setScale(2)
      .setDepth(23)
      .setVisible(true);
    console.log('Character shown:', {
      x: scene.character.x,
      y: scene.character.y,
      frame: scene.character.frame.name,
      flipX: scene.character.flipX,
      scale: scene.character.scale,
      depth: scene.character.depth,
      visible: scene.character.visible,
      angle: scene.character.angle
    });
  } else {
    console.warn('Character sprite not available, skipping display');
  }

  // Animate hammer only
  scene.tweens.add({
    targets: scene.hammer,
    angle: { from: -60, to: 0 },
    duration: 150,
    yoyo: true,
    onComplete: () => {
      scene.hammer.setVisible(false);
      if (scene.character) {
        scene.character.setVisible(false);
        console.log('Character hidden:', { visible: scene.character.visible });
      }
      console.log('Hammer hidden:', { visible: scene.hammer.visible });
    }
  });

  // Check hits
  if (!Array.isArray(scene.moles)) {
    scene.moles = [];
    console.warn('moles array was undefined or invalid in handleHit, reinitialized to empty array');
  }

  scene.moles.forEach(mole => {
    if (mole.active && mole.visible && mole.getBounds().contains(pointer.x, pointer.y)) {
      whack(scene, mole);
    }
  });
}

function whack(scene, mole) {
  if (scene.isPaused || !mole.visible || !mole.active) return;

  if (!isFinite(scene.score)) {
    scene.score = 0;
    console.warn('score was NaN in whack, reinitialized to:', scene.score);
  }

  if (scene.hitSound) {
    scene.hitSound.play();
  }

  mole.disableInteractive();
  mole.hitCount--;
  if (mole.hitCount > 0) {
    scene.time.delayedCall(200, () => {
      if (mole.active) {
        mole.setInteractive();
      }
    });
    return;
  }

  const { x, y } = mole;
  const type = mole.texture.key;
  mole.setVisible(false).setInteractive().setY(mole.originalYHidden);

  const delta = type === 'enemy2' ? -50 : 40;
  scene.score = Math.max(0, scene.score + delta);
  if (scene.scoreText) {
    scene.scoreText.setText(scene.textConfig.scoreDisplay
      .replace('{score}', scene.score)
      .replace('{target}', scene.scoreTarget));
  } else {
    console.warn('scoreText is undefined in whack');
  }

  const fb = scene.add
    .text(x, y - 50, (delta > 0 ? '+' : '') + delta, {
      font: '52px outfit',
      fill: delta > 0 ? '#0f0' : '#f00'
    })
    .setOrigin(0.5)
    .setDepth(20);
  scene.time.delayedCall(500, () => {
    if (fb.active) {
      fb.destroy();
    }
  });

  console.log('Mole whacked:', { type, delta, newScore: scene.score });

  // Check for win condition
  if (scene.score >= scene.scoreTarget && scene.remainingTime > 0 && !scene.isPaused) {
    console.log('Win condition met:', { score: scene.score, scoreTarget: scene.scoreTarget, remainingTime: scene.remainingTime });
    scene.popEvent.remove();
    scene.countdownEvent.remove();
    showGameOver(scene);
  }
}

function showGameOver(scene) {
  scene.input.enabled = true;
  if (scene.bgm) {
    scene.bgm.stop();
    scene.bgm = null;
  }
  if (scene.hitSound) {
    scene.hitSound.destroy();
    scene.hitSound = null;
  }
  if (scene.pauseOverlay) {
    scene.pauseOverlay.destroy();
    console.log('Pause overlay destroyed in showGameOver');
  }
  if (scene.popEvent) {
    scene.popEvent.remove();
    console.log('popEvent removed in showGameOver');
  }
  if (scene.countdownEvent) {
    scene.countdownEvent.remove();
    console.log('countdownEvent removed in showGameOver');
  }

  const { width, height } = scene.scale;

  // Add semi-transparent background
  const bg = scene.add
    .rectangle(width / 2, height / 2, width, height, 0x000000, 0.6)
    .setDepth(100);

  const passed = scene.score >= scene.scoreTarget;

  if (passed) {
    const lvlbox = scene.add.image(width / 2, 900, 'lvlbox')
      .setDepth(100)
      .setScale(1);

    const nextbtn = scene.add.image(770, 1100, 'nextbtn')
      .setDepth(101)
      .setScale(1)
      .setInteractive({ useHandCursor: true });
    console.log('Next button created:', {
      x: nextbtn.x,
      y: nextbtn.y,
      depth: nextbtn.depth,
      interactive: nextbtn.input.enabled,
      texture: nextbtn.texture.key
    });

    const restartbtn = scene.add.image(310, 1100, 'restartbtn')
      .setDepth(101)
      .setScale(1)
      .setInteractive({ useHandCursor: true });
    console.log('Restart button created:', {
      x: restartbtn.x,
      y: restartbtn.y,
      depth: restartbtn.depth,
      interactive: restartbtn.input.enabled,
      texture: restartbtn.texture.key
    });

    nextbtn.on('pointerdown', () => {
      console.log('Next button clicked, emitting sceneComplete');
      notifyParent('sceneComplete', { result: 'win' });
    });

    restartbtn.on('pointerdown', () => {
      console.log('Restart button clicked');
      scene.scene.restart();
    });
  } else {
    const ovrtext = scene.add.text(450, 730, scene.textConfig.gameOver, {
      fontFamily: 'outfit',
      fontSize: '70px',
      fontStyle: 'bold',
      color: '#fff',
      align: 'center'
    })
      .setOrigin(0.5)
      .setDepth(101);

    const scoreText = scene.add
      .text(900, 1060, `${scene.score}`, {
        fontFamily: 'outfit',
        fontSize: '60px',
        color: '#fff',
        align: 'center'
      })
      .setOrigin(0.5)
      .setDepth(101);

    const scoreText1 = scene.add
      .text(300, 1060, scene.textConfig.yourScoreLabel, {
        fontFamily: 'outfit',
        fontSize: '60px',
        color: '#fff',
        align: 'center'
      })
      .setOrigin(0.5)
      .setDepth(101);

    const targetText = scene.add
      .text(870, 910, `${scene.scoreTarget}`, {
        fontFamily: 'outfit',
        fontSize: '60px',
        color: '#fff',
        align: 'center'
      })
      .setOrigin(0.5)
      .setDepth(101);

    const targetText1 = scene.add
      .text(240, 900, scene.textConfig.targetLabel, {
        fontFamily: 'outfit',
        fontSize: '60px',
        color: '#fff',
        align: 'center'
      })
      .setOrigin(0.5)
      .setDepth(101);

    const ovrbox = scene.add.image(width / 2, 890, 'ovrbox')
      .setDepth(100)
      .setScale(1);

    const ovrrestart = scene.add.image(width / 2, 1280, 'ovrrestart')
      .setDepth(101)
      .setScale(1)
      .setInteractive({ useHandCursor: true });
    console.log('Game over restart button created:', {
      x: ovrrestart.x,
      y: ovrrestart.y,
      depth: ovrrestart.depth,
      interactive: ovrrestart.input.enabled,
      texture: ovrrestart.texture.key
    });

    ovrrestart.on('pointerdown', () => {
      console.log('Game over restart button clicked');
      scene.scene.restart();
    });
  }
}

function notifyParent(type, data) {
  if (window.parent !== window) {
    window.parent.postMessage({ type, ...data }, "*");
  }
}

function pauseGame(scene) {
  if (scene.isPaused) return;
  scene.isPaused = true;
  scene.popEvent.paused = true;
  scene.countdownEvent.paused = true;

  if (scene.bgm) {
    scene.bgm.pause();
  }

  scene.pauseOverlay = scene.add.container(0, 0).setDepth(200);
  const { width, height } = scene.scale;

  const bg = scene.add
    .text(width / 2, height / 2 - 60, scene.textConfig.pauseTitle, {
      fontSize: '48px',
      fontStyle: 'bold',
      color: '#fff',
      align: 'center'
    })
    .setOrigin(0.5);
  const tt = scene.add
    .text(width / 2, height / 2, `Target: ${scene.scoreTarget}`, {
      fontSize: '32px',
      color: '#fff',
      align: 'center'
    })
    .setOrigin(0.5);
  const rt = scene.add
    .text(width / 2, height / 2 + 60, scene.textConfig.resumeInstruction, {
      fontSize: '32px',
      color: '#fff'
    })
    .setOrigin(0.5)
    .setInteractive({ useHandCursor: true });
  rt.on('pointerdown', () => resumeGame(scene));

  scene.pauseOverlay.add([bg, tt, rt]);
}

function resumeGame(scene) {
  scene.isPaused = false;
  scene.popEvent.paused = false;
  scene.countdownEvent.paused = false;

  if (scene.bgm) {
    scene.bgm.resume();
  }

  scene.pauseOverlay.destroy();
  console.log('Game resumed, popEvent active:', !scene.popEvent.paused);
}