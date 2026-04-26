export default class MemoryMatrix extends Phaser.Scene {
  constructor() {
    super('MemoryMatrix');

    this.gridSize = 5; // default fallback
    this.patternLength = 5; // default fallback

    this.cellSize = 150;
    this.spacing = 20;
    this.pattern = [];
    this.userInput = [];
    this.grid = [];
    this.inputEnabled = false;

    // Bind all class functions
    Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach(fn => {
      if (typeof this[fn] === 'function') {
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
    const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));
    this.load.json('levelConfig', `${basePath}/config.json`);

    this.load.once('filecomplete-json-levelConfig', () => {
      const config = this.cache.json.get('levelConfig');
      this.configData = config;

      // Load images
      const images = config.images2 || {};
      const ui = config.ui || {};
      for (const key in images) {
        this.load.image(key, `${basePath}/${images[key]}`);
      }

      for (const key in ui) {
        this.load.image(key, `${basePath}/${ui[key]}`);
      }

      // Load audio
      // Load audio
      const audio = config.audio || {};
      for (const [key, url] of Object.entries(audio)) {
        if (!url || typeof url !== 'string') continue;

        // If URL is absolute (http/https or protocol-relative), use as-is.
        // Otherwise, treat as relative to basePath.
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
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock("portrait-primary").catch(() => { });
    }

    const config = this.configData || {};
    this.gridSize = config.gridSize || this.gridSize;
    this.patternLength = config.patternLength || this.patternLength;

    // Background
    if (config.images2 && config.images2.background) {
      const bg = this.add.image(0, 0, 'background').setOrigin(0);
      bg.setDisplaySize(this.sys.scale.width, this.sys.scale.height);
    } else {
      this.sys.cameras.main.setBackgroundColor('#121212');
    }

    // Music
    if (config.audio && config.audio.bg_music) {
      this.sound.add('bg_music', { loop: true, volume: 0.4 }).play();
    }

    // Overlays
    this.createHTPOverlay();
    this.createGameOverOverlay();
    this.createWinOverlay();

    this.hideAllOverlays();
    this.showHTP();
  }

  showHTP() {
    this.hideAllOverlays();
    this.inputEnabled = false;
    this.htpOverlay.setVisible(true);
  }

  startLevel() {
    this.hideAllOverlays();
    this.createGrid();
    this.showPattern();
  }

  createHTPOverlay() {
    const { width, height } = this.sys.scale;
    this.htpOverlay = this.add.container(width / 2, height / 2);
    const bg = this.add.image(0, 0, 'htpbg').setOrigin(0.5);
    const box = this.add.image(0, -50, 'htpbox').setScale(0.55, 0.8).setOrigin(0.5);

    const htpText1 = this.add.text(
      -180, -300,
      "How to Play",
      { font: '70px outfit', fill: '#fff', align: 'left' }
    );
    const htpText = this.add.text(
      -390, -100,
      "Watch the sequence of highlighted\ntiles. Tap them back in the same order!",
      { font: '50px outfit', fill: '#fff', align: 'left' }
    );

    const playBtn = this.add.image(0, 450, 'playbtn')
      .setOrigin(0.5)
      .setInteractive()
      .on('pointerdown', () => {
        this.htpOverlay.setVisible(false);
        this.startLevel();
      });

    this.htpOverlay.add([bg, box, htpText1, htpText, playBtn]);
    this.htpOverlay.setDepth(1000).setVisible(false);
  }

  createGameOverOverlay() {
    const { width, height } = this.sys.scale;
    this.gameOverOverlay = this.add.container(width / 2, height / 2);

    const bg = this.add.image(0, 0, 'ovrbg').setOrigin(0.5);
    const box = this.add.image(0, -100, 'ovrbox').setScale(0.55, 0.4).setOrigin(0.5);
    const text = this.add.text(0, -100, 'Game Over', {
      font: '80px outfit',
      fill: '#ffffff'
    }).setOrigin(0.5);

    const replayBtn = this.add.image(0, 200, 'replay')
      .setOrigin(0.5)
      .setInteractive()
      .on('pointerdown', () => {
        this.gameOverOverlay.setVisible(false);
        this.scene.restart();
      });

    this.gameOverOverlay.add([bg, box, text, replayBtn]);
    this.gameOverOverlay.setDepth(1000).setVisible(false);
  }

  createWinOverlay() {
    const { width, height } = this.sys.scale;
    this.winOverlay = this.add.container(width / 2, height / 2);

    const bg = this.add.image(0, 0, 'winbg').setOrigin(0.5);
    const box = this.add.image(0, 0, 'lvlbox').setOrigin(0.5).setScale(0.55, 0.4);
    const text = this.add.text(0, 0, 'Level Completed', {
      font: '80px outfit',
      fill: '#ffffff'
    }).setOrigin(0.5);

    const replayBtn = this.add.image(-230, 320, 'lvl_replay')
      .setOrigin(0.5)
      .setInteractive()
      .on('pointerdown', () => {
        this.winOverlay.setVisible(false);
        this.scene.restart();
      });

    const nextBtn = this.add.image(230, 320, 'next')
      .setOrigin(0.5)
      .setInteractive()
      .on('pointerdown', () => {
        this.winOverlay.setVisible(false);
        this.notifyParent('sceneComplete', { result: 'win' });
      });

    this.winOverlay.add([bg, box, text, replayBtn, nextBtn]);
    this.winOverlay.setDepth(1000).setVisible(false);
  }

  hideAllOverlays() {
    if (this.htpOverlay) this.htpOverlay.setVisible(false);
    if (this.gameOverOverlay) this.gameOverOverlay.setVisible(false);
    if (this.winOverlay) this.winOverlay.setVisible(false);
  }

  createGrid() {
    const width = this.sys.scale.width;
    const height = this.sys.scale.height;
    const gridWidth = this.gridSize * (this.cellSize + this.spacing) - this.spacing;
    const startX = (width - gridWidth) / 2;
    const startY = height / 2 - gridWidth / 2;

    const cardKeys = Object.keys(this.configData.images2).filter(k => k.startsWith('card'));
    this.grid = [];

    for (let row = 0; row < this.gridSize; row++) {
      for (let col = 0; col < this.gridSize; col++) {
        const x = startX + col * (this.cellSize + this.spacing);
        const y = startY + row * (this.cellSize + this.spacing);
        const cardKey = Phaser.Utils.Array.GetRandom(cardKeys);

        const tile = this.add.image(x, y, cardKey)
          .setOrigin(0)
          .setDisplaySize(this.cellSize, this.cellSize)
          .setInteractive();

        tile.row = row;
        tile.col = col;
        tile.isSelected = false;

        tile.on('pointerdown', () => this.handleTileClick(tile));
        this.grid.push(tile);
      }
    }
  }

  showPattern() {
    this.pattern = Phaser.Utils.Array.Shuffle(this.grid).slice(0, this.patternLength);
    this.userInput = [];
    this.inputEnabled = false;

    let i = 0;
    this.time.addEvent({
      delay: 800,
      repeat: this.pattern.length - 1,
      callback: () => {
        this.flashTile(this.pattern[i]);
        i++;
        if (i === this.pattern.length) {
          this.time.delayedCall(600, () => {
            this.inputEnabled = true;
          });
        }
      }
    });
  }

  flashTile(tile) {
    this.tweens.add({
      targets: tile,
      alpha: { from: 1, to: 0.01 },
      duration: 500,
      yoyo: true,
    });
  }

  handleTileClick(tile) {
    if (!this.inputEnabled) return;

    // Visual click feedback
    this.tweens.add({
      targets: tile,
      alpha: { from: 1, to: 0.1 },
      duration: 200,
      yoyo: true,
    });

    const expectedTile = this.pattern[this.userInput.length];
    this.userInput.push(tile);

    // Check immediately if this click is correct
    if (tile !== expectedTile) {
      this.inputEnabled = false;
      this.time.delayedCall(300, () => this.shakeGrid(() => this.showGameOverOverlay()));
      return;
    }

    // If full sequence entered and correct
    if (this.userInput.length === this.pattern.length) {
      this.inputEnabled = false;
      this.time.delayedCall(300, () => this.showWinOverlay());
    }
  }

  shakeGrid(callback) {
    let completed = 0;
    const total = this.grid.length;

    this.grid.forEach(tile => {
      this.tweens.add({
        targets: tile,
        x: tile.x + 5,
        duration: 50,
        yoyo: true,
        repeat: 2,
        onComplete: () => {
          tile.x -= 5;
          completed++;
          if (completed === total && callback) callback();
        }
      });
    });
  }

  showGameOverOverlay() {
    this.hideAllOverlays();
    this.inputEnabled = false;
    this.gameOverOverlay.setVisible(true);
  }

  showWinOverlay() {
    this.hideAllOverlays();
    this.inputEnabled = false;
    this.winOverlay.setVisible(true);
  }
}
