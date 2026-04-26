export default class NumberMerge extends Phaser.Scene {
  constructor() {
    super('NumberMerge');
    Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach(fn => {
      if (typeof this[fn] === 'function') this[fn] = this[fn].bind(this);
    });
    this.gameTime = 600;  
    this.timerText = null;
    this.timerEvent = null;
    this.timerRunning = false;

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
      this.settings = config.settings || {};
      this.gridSize = this.settings.gridSize || 3;
      this.tileGap = this.settings.tileGap || 24;
      this.tileSize = 129; // fixed PNG size


      const images1 = config.images1 || {};
      const images2 = config.images2 || {};
      const ui = config.ui || {};
      for (const key in images1) {
        this.load.image(key, `${basePath}/${images1[key]}`);
      }

      for (const key in images2) {
        this.load.image(key, `${basePath}/${images2[key]}`);
      }

      for (const key in ui) {
        this.load.image(key, `${basePath}/${ui[key]}`);
      }

      const audio = config.audio || {};
      for (const key in audio) {
        this.load.audio(key, `${basePath}/${audio[key]}`);
      }

      this.load.start();
    });
  }

  create() {
    if (this.winPopup) { this.winPopup.destroy(); this.winPopup = null; }
    if (this.gameOverPopup) { this.gameOverPopup.destroy(); this.gameOverPopup = null; }

    const gameWidth = 1080
    const gameHeight = 1920
    this.moveCount = 0;
    this.undoStack = [];

    this.add.image(gameWidth / 2, gameHeight / 2, 'background')
      .setOrigin(0.5)
      .setDisplaySize(gameWidth, gameHeight)
      .setDepth(-10);
    this.showStartScreen();
    this.add.image(540, 100, 'scorebar')


    this.bgMusic = this.sound.add('bg_music', { loop: true, volume: 0.5 });
    this.bgMusic.play();

    this.bg = this.add.rectangle(gameWidth / 2, gameHeight / 2, gameWidth, gameHeight, 0x20232a, 0.2);

    this.movesText = this.add.text(100, 100, 'Moves: 0', {
      font: '50px outfit', color: 'white'
    }).setOrigin(0, 0.5);

    this.timerText = this.add.text(880, 100, '10:00', {
      font: '50px outfit', color: '#fff', align: 'right'
    }).setOrigin(0, 0.5);


    this.createGrid();
    this.createOverlay();

    this.input.on('gameobjectdown', this.handleTileTap, this);
    this.updateUI();
  }


  startTimer() {
    this.gameTime = 600;
    this.timerRunning = true;
    this.updateTimerText();
    if (this.timerEvent) this.timerEvent.remove();
    this.timerEvent = this.time.addEvent({
      delay: 1000,
      callback: this.tickTimer,
      callbackScope: this,
      loop: true,
    });
  }

  tickTimer() {
    if (!this.timerRunning) return;
    this.gameTime--;
    this.updateTimerText();
    if (this.gameTime <= 0) {
      this.timerRunning = false;
      this.timerEvent.remove();
      this.onGameOver();
    }
  }

  updateTimerText() {
    const min = Math.floor(this.gameTime / 60);
    const sec = this.gameTime % 60;
    this.timerText.setText(
      `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
    );
  }


  showStartScreen() {
    // const { gameWidth, gameHeight } = this.settings;
    const gameWidth = 1080
    const gameHeight = 1920
    this.startScreen = this.add.container(gameWidth / 2, gameHeight / 2).setDepth(2000);

    const bg = this.add.image(0, -50, 'htpbox').setOrigin(0.5);
    const helpText = this.add.text(0, -100, 'Tap a tile to increment it and its\nneighbors. Make all tiles the same\nto win!', {
      font: '50px outfit', color: '#fff', align: 'left', lineSpacing: 10
    }).setOrigin(0.5);

    const playBtn = this.add.image(0, 580, 'playbtn').setInteractive({ useHandCursor: true });
    playBtn.on('pointerdown', () => {
      this.startScreen.setVisible(false);
      this.startTimer();

    });

    this.startScreen.add([bg, helpText, playBtn]);
  }


  createGrid(seedGrid) {
    if (this.tiles) this.tiles.forEach(row => row.forEach(cell => cell.gfx.destroy()));
    this.tiles = [];

    const gameWidth = 1080
    const gameHeight = 1920
    const tileSize = this.tileSize;
    const offsetX = (gameWidth - (this.gridSize * tileSize + (this.gridSize - 1) * this.tileGap)) / 2;
    const offsetY = (gameHeight - (this.gridSize * tileSize + (this.gridSize - 1) * this.tileGap)) / 2 + 60;

    for (let y = 0; y < this.gridSize; y++) {
      this.tiles[y] = [];
      for (let x = 0; x < this.gridSize; x++) {
        const num = seedGrid ? seedGrid[y][x] : Phaser.Math.Between(1, 3);
        const px = offsetX + x * (tileSize + this.tileGap);
        const py = offsetY + y * (tileSize + this.tileGap);
        const gfx = this.add.container(px + tileSize / 2, py + tileSize / 2);

        const tileImgKey = `enemy${num}`;
        const img = this.add.image(0, 0, tileImgKey).setDisplaySize(tileSize, tileSize).setInteractive({ useHandCursor: true });
        img.setData('type', 'enemy');
        img.setData('gx', x);
        img.setData('gy', y);

        const txt = this.add.text(0, 0, num, {
          fontFamily: 'Outfit, Arial',
          font: '48px',
          color: '#222',
          fontStyle: 'bold'
        }).setOrigin(0.5);

        gfx.add([img, txt]);
        this.tiles[y][x] = { gfx, img, txt, value: num, x, y };
      }
    }
  }

  createOverlay() {
    const gameWidth = 1080
    const gameHeight = 1920
    this.overlay = this.add.container(gameWidth / 2, gameHeight / 2).setDepth(1000).setVisible(false);
    const bg = this.add.rectangle(0, 0, gameWidth, gameHeight, 0x20232a, 0.88).setOrigin(0.5);
    const box = this.add.rectangle(0, 0, 660, 540, 0xffffff, 1).setOrigin(0.5).setStrokeStyle(10, 0x68d391, 0.75);
    const winText = this.add.text(0, -110, 'You Win!', {
      fontFamily: 'Outfit, Arial',
      font: '76px',
      color: '#222',
      fontStyle: 'bold',
      align: 'center'
    }).setOrigin(0.5);
    this.movesResult = this.add.text(0, 35, '', {
      fontFamily: 'Outfit, Arial',
      font: '48px',
      color: '#222',
      align: 'center'
    }).setOrigin(0.5);
    this.overlay.add([bg, box, winText, this.movesResult]);
  }

  handleTileTap(pointer, obj) {
    if (!obj.getData('type') || obj.getData('type') !== 'enemy' || this.overlay.visible) return;
    if (!this.timerRunning) return; // <--- Only if game is running!
    const x = obj.getData('gx');
    const y = obj.getData('gy');
    this.makeMove(x, y);
  }


  makeMove(x, y) {
    this.undoStack.push(this.tiles.map(row => row.map(cell => cell.value)));
    if (this.undoStack.length > 20) this.undoStack.shift();

    this.moveCount++;
    let toUpdate = [{ x, y }];
    if (y > 0) toUpdate.push({ x, y: y - 1 });
    if (y < this.gridSize - 1) toUpdate.push({ x, y: y + 1 });
    if (x > 0) toUpdate.push({ x: x - 1, y });
    if (x < this.gridSize - 1) toUpdate.push({ x: x + 1, y });

    toUpdate.forEach(pos => {
      let cell = this.tiles[pos.y][pos.x];
      cell.value = cell.value + 1;
      if (cell.value > 4) cell.value = 1;

      cell.img.setTexture(`enemy${cell.value}`);
      cell.txt.setText(cell.value);

      this.sys.tweens.add({
        targets: cell.gfx,
        scale: { from: 1.13, to: 1 },
        duration: 110
      });
    });

    this.updateUI();
    if (this.checkWin()) {
      setTimeout(() => this.showWin(), 300);
    }
  }

  updateUI() {
    this.movesText.setText('Moves: ' + this.moveCount);
    if (this.bestScore) this.bestText.setText('Best: ' + this.bestScore);
  }

  checkWin() {
    const v = this.tiles[0][0].value;
    return this.tiles.every(row => row.every(cell => cell.value === v));
  }

  showWin() {
    this.timerRunning = false;
    if (this.timerEvent) this.timerEvent.remove();

    if (!this.bestScore || this.moveCount < this.bestScore) {
      this.bestScore = this.moveCount;
      localStorage.setItem('nm_best', this.bestScore);
    }

    // Remove overlay if exists
    if (this.overlay) this.overlay.setVisible(false);

    const gameWidth = 1080
    const gameHeight = 1920
    if (this.winPopup) this.winPopup.destroy();
    this.winPopup = this.add.container(gameWidth / 2, gameHeight / 2).setDepth(3000);

    const bg = this.add.image(0, 0, 'lvlbox').setOrigin(0.5);
    const text = this.add.text(0, 0, 'You Win!', {
      font: '50px outfit',
      color: 'white',
      fontStyle: 'bold',
      align: 'center'
    }).setOrigin(0.5);

    const movesText = this.add.text(0, 85, 'Solved in ' + this.moveCount + ' moves\n(Best: ' + this.bestScore + ')', {
      fontFamily: 'Outfit, Arial',
      font: '50px outfit',
      color: 'white',
      align: 'center'
    }).setOrigin(0.5);

    const nextBtn = this.add.image(-230, 350, 'next').setInteractive({ useHandCursor: true });
    nextBtn.on('pointerdown', () => { this.notifyParent('sceneComplete', { result: 'win' }) });

    const replayBtn = this.add.image(230, 350, 'lvl_replay').setInteractive({ useHandCursor: true });
    replayBtn.on('pointerdown', () => { this.scene.restart(); });

    this.winPopup.add([bg, text, movesText, nextBtn, replayBtn]);
    this.updateUI();
  }

  onGameOver() {
    // Remove overlay if exists
    if (this.overlay) this.overlay.setVisible(false);

    const gameWidth = 1080
    const gameHeight = 1920
    if (this.gameOverPopup) this.gameOverPopup.destroy();
    this.gameOverPopup = this.add.container(gameWidth / 2, gameHeight / 2).setDepth(3000);

    const bg = this.add.image(0, 0, 'ovrbox').setOrigin(0.5); // background in the middle
    const text = this.add.text(0, 0, 'Try Again!', {
      font: '50px outfit',
      color: 'white',
      align: 'center'
    }).setOrigin(0.5);

    const replayBtn = this.add.image(0, 350, 'replay').setInteractive({ useHandCursor: true });
    replayBtn.on('pointerdown', () => { this.scene.restart(); });

    this.gameOverPopup.add([bg, text, replayBtn]);
  }


}
