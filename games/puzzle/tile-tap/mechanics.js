export default class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
    Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach(fn => {
      if (typeof this[fn] === 'function') this[fn] = this[fn].bind(this);
    });
  }

  preload() {
    const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));
    this.load.json('levelConfig', `${basePath}/config.json`);

    this.load.once('filecomplete-json-levelConfig', () => {
      const config = this.cache.json.get('levelConfig');
      this.configData = config;

      const images1 = config.images1 || {};
      const images = config.images2 || {};
      const ui = config.ui || {};

      for (const key in images1) this.load.image(key, `${basePath}/${images1[key]}`);
      for (const key in images) this.load.image(key, `${basePath}/${images[key]}`);
      for (const key in ui) this.load.image(key, `${basePath}/${ui[key]}`);

      const audio = config.audio || {};
      for (const key in audio) this.load.audio(key, `${basePath}/${audio[key]}`);

      this.load.start();
    });
  }

  notifyParent(type, data) {
    if (window.parent !== window) window.parent.postMessage({ type, ...data }, '*');
  }

  create() {
    const levelData = this.cache.json.get('levelConfig');
    this.levelData = levelData;

    if (levelData.orientation?.frame === 'landscape' && screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('landscape-primary').catch(err => console.warn('Orientation lock failed:', err));
    }

    const cfg = this.cache.json.get('levelConfig');
    this.gridSize = cfg.gridSize || 3;
    this.maxTime = cfg.maxTime || 60;
    this.tileSize = 160;
    this.tileGap = 10;
    this.tiles = [];
    this.moves = 0;
    this.timerStarted = false;
    this.elapsedTime = this.maxTime;
    this.winShown = false;

    // BG
    this.add.image(this.sys.scale.width / 2, this.sys.scale.height / 2, 'background')
      .setDisplaySize(this.sys.scale.width, this.sys.scale.height)
      .setDepth(-1);

    // top bar UI
    this.add.image(960, 100, 'scorebar');
    this.playBackgroundMusic(cfg); // handles unlock + reuse internally


    // SFX
    this.sfx = {
      merge: this.sound.add('merge', { volume: 0.6 })
    };


    // particles / fx textures
    this.makeFxTextures();
    // create base textures for the grid background once
    // create base textures for the grid background once
    if (!this.textures.exists('grid-tex')) {
      this.makeGridBgTextures();
    }
    this.createHUD();
    // How to Play overlay
    this.showHowToPlay();
  }
  // ---------- FX helpers ----------
  makeFxTextures() {
    // dot
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(0xffffff, 1);
    g.fillCircle(8, 8, 8);
    g.generateTexture('fx-dot', 16, 16);
    g.clear();
    // spark (diamond)
    g.fillStyle(0xffffff, 1);
    g.beginPath();
    g.moveTo(6, 0); g.lineTo(12, 6); g.lineTo(6, 12); g.lineTo(0, 6); g.closePath();
    g.fillPath();
    g.generateTexture('fx-spark', 12, 12);
    g.destroy();
    // particle emitters (kept offscreen; we'll just emit at coordinates)
    this.fxEmitter = this.add.particles(0, 0, 'fx-dot', {
      speed: { min: 80, max: 180 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.9, end: 0 },
      alpha: { start: 1, end: 0 },
      lifespan: 500,
      quantity: 12,
      rotate: { start: 0, end: 360 }
    });
    this.fxEmitter.setDepth(9);
    this.confetti = this.add.particles(0, 0, 'fx-spark', {
      speed: { min: 100, max: 250 },
      gravityY: 400,
      angle: { min: -100, max: -80 },
      scale: { start: 1.2, end: 0 },
      alpha: { start: 1, end: 0 },
      lifespan: 1200,
      quantity: 0
    });
    this.confetti.setDepth(20);
  }
  floatText(x, y, txt, size = 42, color = '#ffffff') {
    const t = this.add.text(x, y, txt, {
      font: `${size}px outfit`,
      color
    }).setOrigin(0.5).setDepth(12);
    t.setStroke('#000000', 6).setShadow(2, 2, '#000000', 8, true, true);
    this.tweens.add({
      targets: t,
      y: y - 60,
      alpha: 0,
      duration: 650,
      ease: 'Quad.easeOut',
      onComplete: () => t.destroy()
    });
  }
  camBop(intensity = 0.002, duration = 100) {
    const cam = this.cameras.main;
    cam.shake(duration, intensity);
  }

  pulse(target, scale = 1.08, duration = 180) {
    this.tweens.add({ targets: target, scale, duration, yoyo: true, ease: 'Quad.easeOut' });
  }

  // ---------- Audio ----------
  playBackgroundMusic(cfg) {
    const musicKey = 'bg_music';
    if (!(cfg.audio && cfg.audio[musicKey])) return;

    // Reuse an existing instance if it's already in the SoundManager
    const existing = this.sound.get(musicKey);
    if (existing) {
      this.bgMusic = existing;
      if (!existing.isPlaying && !existing.isPaused) {
        existing.setLoop(true);
        existing.setVolume(0.5);
        // Start only if not already playing
        if (!this.sound.locked) {
          existing.play();
        } else {
          this.sound.once('unlocked', () => existing.play());
        }
      }
      return;
    }

    // Otherwise create it once
    this.bgMusic = this.sound.add(musicKey, { loop: true, volume: 0.5 });

    if (!this.sound.locked) {
      this.bgMusic.play();
    } else {
      this.sound.once('unlocked', () => this.bgMusic.play());
    }
  }


  // ---------- HUD ----------
  createHUD() {
    // nicer text styles
    const labelStyle = { font: '48px outfit', color: '#ffffff' };
    this.moveText = this.add.text(600, 100, 'Moves: 0', labelStyle).setOrigin(0.5).setDepth(5);
    this.moveText.setStroke('#000000', 8).setShadow(2, 2, '#000000', 10, true, true);

    this.timerText = this.add.text(1320, 100, `Time: ${this.maxTime}s`, labelStyle).setOrigin(0.5).setDepth(5);
    this.timerText.setStroke('#000000', 8).setShadow(2, 2, '#000000', 10, true, true);

    // time bar beneath timer
    const barW = 340, barH = 14;
    this.timeBarBg = this.add.rectangle(1320, 140, barW, barH, 0x000000, 0.35).setOrigin(0.5).setDepth(4);
    this.timeBar = this.add.rectangle(1320 - barW / 2, 140, barW, barH, 0x00ff99, 0.95)
      .setOrigin(0, 0.5).setDepth(4);
  }

  // ---------- How to Play ----------
  showHowToPlay() {
    this.htpContainer = this.add.container(0, 0).setDepth(100);
    const bg = this.add.image(960, 540, "htpbox").setOrigin(0.5);
    const instrText = this.add.text(900, 540,
      "Tap a tile to flip it and its neighbors.\nTurn all tiles white or black to win before\ntime runs out!",
      { font: '50px outfit', color: '#ffffff', align: 'left', lineSpacing: 13 }
    ).setOrigin(0.5);
    instrText.setStroke('#000000', 8).setShadow(2, 2, '#000000', 10, true, true);

    const playBtn = this.add.image(960, 960, 'playbtn').setInteractive({ useHandCursor: true });
    this.pulse(playBtn, 1.06, 400);
    this.time.addEvent({ delay: 600, loop: true, callback: () => this.pulse(playBtn, 1.06, 400) });

    playBtn.on('pointerdown', () => {
      this.htpContainer.destroy();
      this.startGame();
    });

    this.htpContainer.add([bg, instrText, playBtn]);
  }

  // ---------- Game start / timer ----------
  startGame() {
    this.createGrid();
    this.startTimer();
  }

  startTimer() {
    this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        if (this.timerStarted && !this.winShown) {
          this.elapsedTime--;
          this.timerText.setText(`Time: ${this.elapsedTime}s`);

          // animate time bar
          const pct = Phaser.Math.Clamp(this.elapsedTime / this.maxTime, 0, 1);
          const targetW = 340 * pct;
          this.timeBar.width = targetW;


          // low-time warning
          if (this.elapsedTime === 10) {
            this.timerLowWarning();
          }
          if (this.elapsedTime <= 0) {
            this.timerStarted = false;
            this.showLoseScreen();
          }
        }
      }
    });
  }

  timerLowWarning() {
    this.timerText.setColor('#ff6464');
    this.timeBar.fillColor = 0xff4d4d;
    this.pulse(this.timerText, 1.14, 200);
    this.time.addEvent({ delay: 350, repeat: 8, callback: () => this.pulse(this.timerText, 1.14, 200) });
    this.cameras.main.flash(300, 200, 0, 0);
  }

  // ---------- Grid / tiles ----------
  createGrid() {
    const gridWidth = this.gridSize * this.tileSize + (this.gridSize - 1) * this.tileGap;
    const startX = (this.sys.scale.width - gridWidth) / 2;
    const startY = 300;
    const gridHeight = this.gridSize * this.tileSize + (this.gridSize - 1) * this.tileGap;

    this.createGridBackground(startX, startY, gridWidth, gridHeight);

    // ...then your existing tile creation:
    for (let row = 0; row < this.gridSize; row++) {
      this.tiles[row] = [];
      for (let col = 0; col < this.gridSize; col++) {
        const x = startX + col * (this.tileSize + this.tileGap);
        const y = startY + row * (this.tileSize + this.tileGap);
        const isOn = Phaser.Math.Between(0, 1) === 1;
        const texture = isOn ? 'object1' : 'object2';

        const tile = this.add.image(x, y, texture)
          .setDisplaySize(this.tileSize, this.tileSize)
          .setOrigin(0, 0)
          .setInteractive()
          .setDepth(3); // <-- above panel (-2), grid (-1), pads (0)

        tile.state = isOn;
        tile.updateTexture = () => tile.setTexture(tile.state ? 'object1' : 'object2');

        tile.on('pointerdown', () => {
          if (!this.timerStarted) this.timerStarted = true;

          const rate = Phaser.Math.FloatBetween(0.95, 1.06);
          this.sfx.merge?.play({ rate });

          // FX: pop + particles + cam bop
          this.sys.tweens.add({ targets: tile, scaleX: 0.92, scaleY: 0.92, duration: 90, yoyo: true, ease: 'Quad.easeInOut' });
          const cx = tile.x + this.tileSize / 2;
          const cy = tile.y + this.tileSize / 2;
          this.fxEmitter.emitParticleAt(cx, cy, 8);

          this.camBop(0.002, 80);
          // SFX: slight random pitch so it doesn't feel repetitive



          // toggle center + neighbors with ripple timing
          this.toggleTile(row, col, 0);
          this.toggleTile(row - 1, col, 40);
          this.toggleTile(row + 1, col, 40);
          this.toggleTile(row, col - 1, 40);
          this.toggleTile(row, col + 1, 40);

          // score UI
          this.moves++;
          this.moveText.setText(`Moves: ${this.moves}`);
          this.floatText(cx, cy, '+1', 40, '#00ffcc');
          this.pulse(this.moveText, 1.08, 160);

          this.checkWin();
        });

        this.tiles[row][col] = tile;
      }
    }
  }

  toggleTile(row, col, delayMs = 0) {
    if (row < 0 || row >= this.gridSize || col < 0 || col >= this.gridSize) return;
    const tile = this.tiles[row][col];

    this.time.delayedCall(delayMs, () => {
      tile.state = !tile.state;
      tile.updateTexture();
      // subtle neighbor ripple
      this.sys.tweens.add({
        targets: tile,
        alpha: { from: 0.8, to: 1 },
        duration: 120,
        ease: 'Quad.easeOut'
      });
    });
  }

  update(time, delta) {
    // cheap animated grid scroll (no tween)
    if (this._gridTile) {
      const t = time * 0.00035;         // speed
      this._gridTile.tilePositionX = 48 * Math.sin(t);
      this._gridTile.tilePositionY = 48 * Math.cos(t * 0.7);
    }

    // gentle breathing on all pads at once
    if (this.cellPads) {
      this.cellPads.alpha = 0.92 + 0.06 * Math.sin(time * 0.003);
    }
  }


  // ---------- Win / Lose ----------
  checkWin() {
    const firstState = this.tiles[0][0].state;
    for (let row of this.tiles) {
      for (let tile of row) {
        if (tile.state !== firstState) return;
      }
    }
    this.showWinScreen();
  }

  showWinScreen() {
    if (this.winShown) return;
    this.winShown = true;

    // FX
    this.cameras.main.flash(400, 255, 255, 255);
    // confetti burst across the top
    for (let i = 0; i < 6; i++) {
      this.time.delayedCall(i * 80, () => {
        this.confetti.emitParticleAt(Phaser.Math.Between(300, 1620), 50, 24);
      });
    }

    this.add.image(960, 540, 'lvlbox').setOrigin(0.5).setDepth(10);
    const title = this.add.text(960, 600, 'You Win!', { font: '72px outfit', color: '#feffffff' })
      .setOrigin(0.5).setDepth(11);
    title.setStroke('#000000', 10).setShadow(3, 3, '#000000', 12, true, true);
    this.pulse(title, 1.1, 250);

    this.add.image(730, 900, 'lvl_replay').setInteractive().setDepth(12)
      .on('pointerdown', () => this.scene.restart());

    this.add.image(1200, 900, 'next').setInteractive().setDepth(12)
      .on('pointerdown', () => this.notifyParent('sceneComplete', { result: 'win' }));
  }

  showLoseScreen() {
    if (this.winShown) return;
    this.winShown = true;

    // FX
    this.cameras.main.shake(300, 0.004);
    this.cameras.main.flash(200, 200, 0, 0);

    this.add.image(960, 540, 'ovrbox').setOrigin(0.5).setDepth(10);

    const t = this.add.text(960, 540, `Moves: ${this.moves}\nTime: ${this.elapsedTime}s`, {
      font: '50px outfit',
      color: '#ffffff',
      align: 'left',
      lineSpacing: 10
    }).setOrigin(0.5).setDepth(11);
    t.setStroke('#000000', 8).setShadow(2, 2, '#000000', 10, true, true);

    this.add.image(960, 900, 'replay').setInteractive().setDepth(12)
      .on('pointerdown', () => this.scene.restart());
  }

  getRating(moves, time) {
    if (moves <= 12 && time <= 20) return 'Genius!';
    if (moves <= 20 && time <= 40) return 'Well Done';
    return 'Try Again';
  }

  // ---------- Grid BG: textures once ----------
  makeGridBgTextures() {
    // 1) tiny repeating grid tile (32x32 with crosshair lines)
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.clear().fillStyle(0x0f172a, 1).fillRect(0, 0, 32, 32); // slate-900 base
    g.lineStyle(1, 0x1f2a44, 0.9); // darker line
    g.beginPath();
    g.moveTo(16, 0); g.lineTo(16, 32); // vertical
    g.moveTo(0, 16); g.lineTo(32, 16); // horizontal
    g.strokePath();
    g.generateTexture('grid-tex', 32, 32);
    g.clear();

    // 2) rounded cell pad (soft plate under each tile)
    const padW = this.tileSize, padH = this.tileSize, r = 18;
    g.fillStyle(0x0b1222, 1);
    g.fillRoundedRect(0, 0, padW, padH, r);
    g.lineStyle(2, 0x2a3759, 0.9);
    g.strokeRoundedRect(1, 1, padW - 2, padH - 2, r - 2);
    g.generateTexture('cell-pad', padW, padH);
    g.clear();

    // 3) panel bg (bigger, with glow stroke)
    const panelW = this.sys.scale.width * 0.8;
    const panelH = this.sys.scale.height * 0.7;
    const pr = 28;
    g.fillStyle(0x0a0f1d, 0.85).fillRoundedRect(0, 0, panelW, panelH, pr);
    g.lineStyle(4, 0x2d3a61, 0.7).strokeRoundedRect(2, 2, panelW - 4, panelH - 4, pr - 4);
    g.generateTexture('grid-panel', panelW, panelH);
    g.destroy();

  }

  // ---------- Build the background behind the grid ----------
  createGridBackground(startX, startY, gridW, gridH) {
    if (!this.textures.exists('grid-tex')) this.makeGridBgTextures();

    // panel behind
    this.add.image(960, 560, 'grid-panel')
      .setDepth(-2)
      .setAlpha(0.9);

    // animated grid (we'll scroll it in update)
    const pad = 26;
    this._gridTile = this.add.tileSprite(
      startX - pad, startY - pad,
      gridW + pad * 2, gridH + pad * 2,
      'grid-tex'
    ).setOrigin(0, 0).setAlpha(0.35).setDepth(-1);

    // per-cell pads (no per-pad infinite tweens)
    this.cellPads = this.add.container(0, 0).setDepth(0);
    for (let r = 0; r < this.gridSize; r++) {
      for (let c = 0; c < this.gridSize; c++) {
        const x = startX + c * (this.tileSize + this.tileGap);
        const y = startY + r * (this.tileSize + this.tileGap);
        const padImg = this.add.image(x, y, 'cell-pad').setOrigin(0, 0).setAlpha(0.95);
        this.cellPads.add(padImg);
      }
    }
  }


}
