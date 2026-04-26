export default class TicTacToeScene extends Phaser.Scene {
  constructor() {
    super({ key: 'TicTacToeScene' });

    Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach(fn => {
      if (typeof this[fn] === 'function') {
        this[fn] = this[fn].bind(this);
      }
    });

    this.board = [];
    this.gameOver = false;
    this.state = 'start'; // start | playing | win | gameover
    this.skipNextPointerDown = false;

  }
  notifyParent(type, data) {
    if (window.parent !== window) {
      window.parent.postMessage({ type, ...data }, "*");
    }
  }

  init() {
    this.resetState();
  }

  resetState() {
    this.gameOver = false;
    this.state = 'start';
    this.skipNextPointerDown = false;
    // board will be rebuilt in create() after size is known
  }


  preload() {
    const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));
    this.load.json('levelConfig', `${basePath}/config.json`);

    this.load.once('filecomplete-json-levelConfig', () => {
      const config = this.cache.json.get('levelConfig');
      this.configData = config;
      const spritesheets = config.spritesheets || {};
      const sheets = config.sheets || spritesheets;

      const heroData = sheets.hero || {};
      const spacemanData = sheets.spaceman || {};

      const rawMain = new URLSearchParams(window.location.search).get("main") || "";
      const cleanMain = rawMain.replace(/^"|"$/g, "");

      // Use param > config > fallback
      const sheetUrl = cleanMain || heroData.url || `${basePath}/assets/spritesheet.png`;
      const frameW = heroData.frameWidth || 103;
      const frameH = heroData.frameHeight || 158;

      // Load "player" sprite from main param or fallback
      const usedParam = !!cleanMain;
      this.load.spritesheet("player", sheetUrl, {
        frameWidth: frameW,
        frameHeight: frameH,
      });

      // Load images
      const images = config.images1 || {};
      const images2 = config.images2 || {};
      const ui = config.ui || {};
      for (const key in images) {
        this.load.image(key, `${basePath}/${images[key]}`);
      }

      for (const key in images2) {
        this.load.image(key, `${basePath}/${images2[key]}`);
      }

      for (const key in ui) {
        this.load.image(key, `${basePath}/${ui[key]}`);
      }

      // Load audio
      const audio = config.audio || {};
      for (const key in audio) {
        this.load.audio(key, `${basePath}/${audio[key]}`);
      }

      // Load other spritesheets except "player" if main param was used
      for (const key in spritesheets) {
        if (usedParam && key === "player") continue;

        const sheet = spritesheets[key];
        this.load.spritesheet(key, `${basePath}/${sheet.path}`, {
          frameWidth: sheet.frameWidth,
          frameHeight: sheet.frameHeight,
        });
      }

      this.load.start();
    });
  }


  create() {
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock("portrait-primary").catch(() => { });
    }

    this.size = this.configData?.config?.gridSize || 3;
    this.gridSize = Math.min(this.sys.game.config.width, this.sys.game.config.height) * 0.8;
    this.cellSize = this.gridSize / this.size;
    this.offsetX = (this.sys.game.config.width - this.gridSize) / 2;
    this.offsetY = (this.sys.game.config.height - this.gridSize) / 2;

    // Important: clear any previous pointer listener (from the prior run)
    this.input.off('pointerdown', this.handlePointerDown, this);

    this.add.image(0, 0, 'background')
      .setOrigin(0)
      .setDisplaySize(this.sys.game.config.width, this.sys.game.config.height);

    // (Re)start music
    this.bgMusic?.stop();
    this.bgMusic = this.sound.add('bg_music', { loop: true, volume: 0.4 });
    this.bgMusic.play();

    // fresh board for this run
    this.board = Array(this.size).fill().map(() => Array(this.size).fill(null));
    this.drawGrid();

    this.createOverlays();

    this.input.on('pointerdown', this.handlePointerDown, this);

    // Clean up on shutdown (when restarting) so nothing leaks
    this.events.once('shutdown', () => {
      this.input.off('pointerdown', this.handlePointerDown, this);
      this.bgMusic?.stop();
    });
  }


  drawGrid() {
    const graphics = this.add.graphics({ lineStyle: { width: 8, color: 0x2c3e50 } });

    for (let i = 1; i < this.size; i++) {
      const pos = i * this.cellSize;
      graphics.strokeLineShape(new Phaser.Geom.Line(this.offsetX + pos, this.offsetY, this.offsetX + pos, this.offsetY + this.gridSize));
      graphics.strokeLineShape(new Phaser.Geom.Line(this.offsetX, this.offsetY + pos, this.offsetX + this.gridSize, this.offsetY + pos));
    }
  }


  createOverlays() {
    const cx = this.sys.game.config.width / 2;
    const cy = this.sys.game.config.height / 2;

    // Start Overlay
    this.htpBox = this.add.image(cx, cy, 'htpbox').setOrigin(0.5).setDepth(10);
    this.htptext = this.add.text(cx, cy, 'Classic Tic-Tac-Toe. Players take turns\nputting their marks in empty squares.\nThe first player to get 3 of\ntheir marks in a row\n(up, down, across, or diagonally)\nis the winner.', { font: '50px outfit', fill: '#fff' }).setOrigin(0.5).setDepth(11);
    this.playBtn = this.add.image(cx, cy + 660, 'playbtn').setOrigin(0.5).setInteractive().setDepth(11);
    this.playBtn.on('pointerdown', (pointer) => {
      pointer.event.stopPropagation(); // optional, still useful
      this.skipNextPointerDown = true;
      this.startGame();
    });



    // Win Overlay
    this.lvlBox = this.add.image(cx, cy, 'lvlbox').setOrigin(0.5).setDepth(10).setVisible(false);
    this.lvltext = this.add.text(cx, cy, 'You Win!', { font: '50px outfit', fill: '#fff' }).setOrigin(0.5).setDepth(11).setVisible(false);
    this.nextBtn = this.add.image(cx - 230, cy + 380, 'next').setOrigin(0.5).setInteractive().setDepth(11).setVisible(false);
    this.replayBtnWin = this.add.image(cx + 230, cy + 380, 'lvl_replay').setOrigin(0.5).setInteractive().setDepth(11).setVisible(false);

    this.nextBtn.on('pointerdown', () => this.notifyParent('sceneComplete', { result: 'win' }));
    this.replayBtnWin.on('pointerdown', () => this.scene.restart());

    // Game Over Overlay
    this.ovrBox = this.add.image(cx, cy, 'ovrbox').setOrigin(0.5).setDepth(10).setVisible(false);
    this.ovrtext = this.add.text(cx, cy, 'Try Again!', { font: '50px outfit', fill: '#fff' }).setOrigin(0.5).setDepth(11).setVisible(false);
    this.replayBtnLose = this.add.image(cx, cy + 400, 'replay').setOrigin(0.5).setInteractive().setDepth(11).setVisible(false);
    this.replayBtnLose.on('pointerdown', () => this.scene.restart());

    // Draw overlay

    this.ovrBox1 = this.add.image(cx, cy, 'ovrbox').setOrigin(0.5).setDepth(10).setVisible(false);
    this.ovrtext1 = this.add.text(cx, cy, 'The match was a tie!', { font: '50px outfit', fill: '#fff' }).setOrigin(0.5).setDepth(11).setVisible(false);
    this.replayBtnLose1 = this.add.image(cx, cy + 400, 'replay').setOrigin(0.5).setInteractive().setDepth(11).setVisible(false);
    this.replayBtnLose1.on('pointerdown', () => this.scene.restart());

  }

  startGame() {
    this.htpBox.setVisible(false);
    this.htptext.setVisible(false);
    this.playBtn.setVisible(false);

    // Make sure previous run's end-state can't block input
    this.gameOver = false;
    this.state = 'playing';
    // consume the first tap after clicking Play (your existing behavior)
  }


  handlePointerDown(pointer) {
    if (this.skipNextPointerDown) {
      this.skipNextPointerDown = false; // consume the skip
      return; // prevent turn
    }

    if (this.gameOver || this.state !== 'playing') return;

    const col = Math.floor((pointer.x - this.offsetX) / this.cellSize);
    const row = Math.floor((pointer.y - this.offsetY) / this.cellSize);

    if (row >= 0 && row < this.size && col >= 0 && col < this.size && !this.board[row][col]) {
      this.makeMove(row, col, 'X');
      if (!this.gameOver) {
        this.time.delayedCall(300, () => this.computerMove());
      }
    }
  }


  makeMove(row, col, player) {
    this.board[row][col] = player;
    this.drawMark(row, col, player);

    const winner = this.checkWinner(player);
    if (winner) {
      this.gameOver = true;
      this.animateWinningLine(winner, () => {
        if (player === 'X') this.showWin();
        else this.showGameOver();
      });
    } else if (this.isBoardFull()) {
      this.gameOver = true;
      this.showDraw();
    }
  }


  drawMark(row, col, player) {
    const centerX = this.offsetX + col * this.cellSize + this.cellSize / 2;
    const centerY = this.offsetY + row * this.cellSize + this.cellSize / 2;

    if (player === 'X') {
      const sprite = this.add.sprite(centerX, centerY, 'player');
      sprite.setOrigin(0.5).setDisplaySize(this.cellSize * 0.9, this.cellSize * 0.9);
    } else {
      this.add.image(centerX, centerY, 'enemy')
        .setDisplaySize(this.cellSize * 0.8, this.cellSize * 0.8)
        .setOrigin(0.5);
    }
  }

  animateWinningLine(winner, callback) {
    const graphics = this.add.graphics({ lineStyle: { width: 12, color: 0xff0000 } }).setDepth(9);
    const start = {};
    const end = {};

    const s = this.cellSize;
    const ox = this.offsetX;
    const oy = this.offsetY;

    if (winner.type === 'row') {
      const y = oy + winner.index * s + s / 2;
      start.x = ox;
      start.y = end.y = y;
      end.x = ox + this.gridSize;
    } else if (winner.type === 'col') {
      const x = ox + winner.index * s + s / 2;
      start.y = oy;
      start.x = end.x = x;
      end.y = oy + this.gridSize;
    } else if (winner.type === 'diag') {
      start.x = ox;
      start.y = oy;
      end.x = ox + this.gridSize;
      end.y = oy + this.gridSize;
    } else if (winner.type === 'anti') {
      start.x = ox + this.gridSize;
      start.y = oy;
      end.x = ox;
      end.y = oy + this.gridSize;
    }

    let blinkCount = 0;
    const drawAndToggle = () => {
      graphics.clear();
      if (blinkCount % 2 === 0) {
        graphics.lineStyle(12, 0xff0000);
        graphics.strokeLineShape(new Phaser.Geom.Line(start.x, start.y, end.x, end.y));
      }
      blinkCount++;
      if (blinkCount < 6) {
        this.time.delayedCall(200, drawAndToggle);
      } else {
        graphics.destroy();
        callback();
      }
    };

    drawAndToggle();
  }


  computerMove() {
    if (this.gameOver) return;

    const move = this.findBestMove('O', 'X');
    if (move) {
      this.makeMove(move.row, move.col, 'O');
    }
  }

  findBestMove(ai, player) {
    for (let row = 0; row < this.size; row++) {
      for (let col = 0; col < this.size; col++) {
        if (!this.board[row][col]) {
          this.board[row][col] = ai;
          if (this.checkWinner(ai)) {
            this.board[row][col] = null;
            return { row, col };
          }
          this.board[row][col] = null;
        }
      }
    }

    for (let row = 0; row < this.size; row++) {
      for (let col = 0; col < this.size; col++) {
        if (!this.board[row][col]) {
          this.board[row][col] = player;
          if (this.checkWinner(player)) {
            this.board[row][col] = null;
            return { row, col };
          }
          this.board[row][col] = null;
        }
      }
    }

    const empty = [];
    for (let row = 0; row < this.size; row++) {
      for (let col = 0; col < this.size; col++) {
        if (!this.board[row][col]) empty.push({ row, col });
      }
    }

    return empty.length ? Phaser.Utils.Array.GetRandom(empty) : null;
  }

  checkWinner(player) {
    const b = this.board;
    const s = this.size;

    for (let i = 0; i < s; i++) {
      if (b[i].every(cell => cell === player)) return { type: 'row', index: i };
      if (b.map(row => row[i]).every(cell => cell === player)) return { type: 'col', index: i };
    }

    if (b.map((row, i) => row[i]).every(cell => cell === player)) return { type: 'diag', index: 0 };
    if (b.map((row, i) => row[s - 1 - i]).every(cell => cell === player)) return { type: 'anti', index: 0 };

    return null;
  }


  isBoardFull() {
    return this.board.flat().every(cell => cell !== null);
  }

  showWin() {
    this.state = 'win';
    this.bgMusic?.stop(); // Stop music
    this.lvlBox.setVisible(true);
    this.lvltext.setVisible(true);
    this.nextBtn.setVisible(true);
    this.replayBtnWin.setVisible(true);
  }


  showGameOver() {
    this.state = 'gameover';
    this.bgMusic?.stop(); // Stop music
    this.ovrBox.setVisible(true);
    this.ovrtext.setVisible(true);
    this.replayBtnLose.setVisible(true);
  }
  showDraw() {
    this.state = 'draw';
    this.bgMusic?.stop(); // Stop music
    this.ovrBox1.setVisible(true);
    this.ovrtext1.setVisible(true);
    this.replayBtnLose1.setVisible(true);
  }


}
