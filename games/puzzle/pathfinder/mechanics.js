export default class MazeGame extends Phaser.Scene {
  constructor() {
    super('MazeGame');
    this.cellSize = 64;
    this.offsetX = 32;
    this.offsetY = 112;

    // Battery fields kept but no longer used for game over
    this.batteryMax = 100;
    this.battery = this.batteryMax;
    this.batteryDrain = 1.5;
    this.batteryZap = 20;
    this.powerBoost = 25;

    this.grid = [];
    this.keysNeeded = 0;
    this.htpContainer = null;
    this.isGameStarted = false;
    this.heldDir = null;
    this.sfx = {
      bgm: null,
      collect: null,
      gameover: null,
      lvlcomplete: null
    };

    this.timeLimit = 60; // seconds
    this.timeLeft = 60;
    this.keysGot = 0;
    this.canMove = true;

    Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach(fn => {
      if (typeof this[fn] === 'function') {
        this[fn] = this[fn].bind(this);
      }
    });
  }

  preload() {
    const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));
    this.load.json('levelConfig', `${basePath}/config.json`);

    this.load.once('filecomplete-json-levelConfig', () => {
      const config = this.cache.json.get('levelConfig');
      this.configData = config;
      const images = config.images1 || {};
      const ui = config.ui || {};
      const images2 = config.images2 || {};
      for (const key in images) {
        this.load.image(key, `${basePath}/${images[key]}`);
      }
      for (const key in ui) {
        this.load.image(key, `${basePath}/${ui[key]}`);
      }
      for (const key in images2) {
        this.load.image(key, `${basePath}/${images2[key]}`);
      }
      const audio = config.audio || {};
      for (const key in audio) {
        this.load.audio(key, `${basePath}/${audio[key]}`);
      }
      this.load.start();
    });
  }

  create() {
    const levelData = this.cache.json.get('levelConfig');
    this.levelData = levelData;

    const cfg = this.cache.json.get('levelConfig');
    const m = cfg.mechanics || {};

    // Mechanics
    this.cellSize = m.cellSize ?? 64;
    this.offsetX = m.offsetX ?? 32;
    this.offsetY = m.offsetY ?? 112;

    // Battery values are not used for game over anymore
    this.batteryMax = m.batteryMax ?? 100;
    this.battery = this.batteryMax;
    this.batteryDrain = m.batteryDrain ?? 1.5;
    this.batteryZap = m.batteryZap ?? 20;

    this.timeLimit = m.timeLimit ?? 60;
    this.timeLeft = this.timeLimit;

    // Orientation
    if (levelData.orientation?.frame === 'landscape' && screen.orientation && screen.orientation.lock) {
      screen.orientation
        .lock('landscape-primary')
        .catch(err => console.warn('Orientation lock failed:', err));
    }

    this.makeMaze();

    // Audio
    this.sfx.bgm = this.sound.add('bgm', { loop: true, volume: 0.5 });
    this.sfx.collect = this.sound.add('collect', { loop: false, volume: 1 });
    this.sfx.gameover = this.sound.add('gameover', { loop: false, volume: 1 });
    this.sfx.lvlcomplete = this.sound.add('lvlcomplete', { loop: false, volume: 1 });

    this.makeUI();

    this.input.addPointer(2);
    this.addTouchControls();
    this.showHTPPopup();

    this.cursors = this.input.keyboard.createCursorKeys();
    this.gameOver = false;
    this.timeLeft = this.timeLimit;
  }

  // ---------- TOUCH CONTROLS ----------

  addTouchControls() {
    this.btnUp = this.add.image(1500, 850, 'up').setInteractive().setScale(0.7).setDepth(50);
    this.btnLeft = this.add.image(150, 850, 'left').setInteractive().setScale(0.7).setDepth(50);
    this.btnDown = this.add.image(1700, 850, 'down').setInteractive().setScale(0.7).setDepth(50);
    this.btnRight = this.add.image(350, 850, 'right').setInteractive().setScale(0.7).setDepth(50);

    this.btnUp.on('pointerdown', () => { this.heldDir = 'up'; });
    this.btnLeft.on('pointerdown', () => { this.heldDir = 'left'; });
    this.btnDown.on('pointerdown', () => { this.heldDir = 'down'; });
    this.btnRight.on('pointerdown', () => { this.heldDir = 'right'; });

    [this.btnUp, this.btnLeft, this.btnDown, this.btnRight].forEach(btn => {
      btn.on('pointerup', () => { this.heldDir = null; });
      btn.on('pointerout', () => { this.heldDir = null; });
      btn.on('pointerupoutside', () => { this.heldDir = null; });
    });
  }

  // ---------- SIMPLE SHAPES ----------

  makeRect(x, y, w, h, color) {
    return this.add.rectangle(x, y, w, h, color).setOrigin(0.5);
  }
  makeCircle(x, y, r, color) {
    return this.add.circle(x, y, r, color).setOrigin(0.5);
  }

  // ---------- HTP POPUP ----------

  showHTPPopup() {
    this.isGameStarted = false;
    this.htpContainer = this.add.container(960, 540).setDepth(1001);

    const bg = this.add.image(0, -50, 'htpbox');
    const text = this.add.text(
      -550,
      -150,
      'Collect all the keys and reach the exit\nbefore time runs out.\nUse the on-screen buttons or arrow keys to move.',
      {
        font: '50px outfit',
        color: '#ffffff',
        lineSpacing: 13
      }
    );
    const playBtn = this.add.image(0, 380, 'playtbtn').setInteractive();

    playBtn.on('pointerdown', () => {
      this.htpContainer.destroy();
      this.isGameStarted = true;
      if (this.sfx.bgm && !this.sfx.bgm.isPlaying) this.sfx.bgm.play();
    });

    this.htpContainer.add([bg, text, playBtn]);
  }

  // ---------- MAZE (ORIGINAL SIZE, WIDER PATHS VISUALLY) ----------

  makeMaze() {
    this.keysNeeded = 0;
    this.keysGot = 0;

    if (this.keySprites) { this.keySprites.forEach(s => s.destroy()); }
    this.keySprites = [];

    this.grid = [];

    const MAZE = [
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      [1, 2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 4, 1, 0, 5, 0, 1, 6, 0, 0, 1],
      [1, 0, 1, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1],
      [1, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1],
      [1, 0, 1, 0, 1, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1, 1, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1],
      [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1],
      [1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 0, 1],
      [1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1],
      [1, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0, 1],
      [1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1],
      [1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 0, 1],
      [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
      [1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 3, 1],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    ];

    const cs = this.cellSize;
    const wallSize = cs * 0.7;
    const floorSize = cs * 0.7;

    this.grid = [];
    this.keySprites = [];

    for (let r = 0; r < MAZE.length; r++) {
      this.grid[r] = [];
      for (let c = 0; c < MAZE[0].length; c++) {
        const x = this.offsetX + c * cs + cs / 2;
        const y = this.offsetY + r * cs + cs / 2;
        const v = MAZE[r][c];
        let type = 'floor';

        if (v === 1) {
          this.add.image(x, y, 'tile').setDisplaySize(wallSize, wallSize);
          type = 'wall';
        }
        else if (v === 5) {
          // electric wall now just visual floor (no penalty)
          this.makeRect(x, y, floorSize, floorSize, 0xff5555);
          type = 'floor';
        }
        else if (v === 3) {
          this.makeRect(x, y, floorSize, floorSize, 0x232342);
          this.exitSprite = this.add.image(x, y, 'exit')
            .setDisplaySize(cs * 0.8, cs * 0.8)
            .setDepth(25);
          this.exit = { row: r, col: c };
          type = 'exit';
        }
        else if (v === 2) {
          this.makeRect(x, y, floorSize, floorSize, 0x232342);
          this.player = this.add.image(x, y, 'player')
            .setDisplaySize(cs * 1.4, cs * 1.4)   // 👈 zoomed-in player
            .setDepth(50);
          this.player.gridPos = { row: r, col: c };
        }

        else {
          // 0, 4, 6 all treated as floor now
          this.makeRect(x, y, floorSize, floorSize, 0x232342);
        }

        this.grid[r][c] = { type, x, y, taken: false };
      }
    }

    this.keysGot = 0;
    this.placeRandomKeys(3); // always 3 keys
  }

  placeRandomKeys(totalKeys) {
    const candidates = [];

    for (let r = 0; r < this.grid.length; r++) {
      for (let c = 0; c < this.grid[0].length; c++) {
        const cell = this.grid[r][c];

        if (cell.type !== 'floor') continue;
        if (this.player && this.player.gridPos.row === r && this.player.gridPos.col === c) continue;
        if (this.exit && this.exit.row === r && this.exit.col === c) continue;

        candidates.push({ r, c, cell });
      }
    }

    Phaser.Utils.Array.Shuffle(candidates);

    const num = Math.min(totalKeys, candidates.length);
    this.keysNeeded = num;

    for (let i = 0; i < num; i++) {
      const { r, c, cell } = candidates[i];
      cell.type = 'key';
      const keySprite = this.add.image(cell.x, cell.y, 'key')
        .setDisplaySize(this.cellSize * 0.7, this.cellSize * 0.7);
      keySprite.setData('type', 'key');
      keySprite.setData('pos', { r, c });
      this.keySprites.push(keySprite);
    }
  }

  // ---------- UI (NO ENERGY BAR NOW) ----------

  makeUI() {
    this.timerTxt = this.add.text(1280, 50, "Time: 00:00", {
      font: '50px outfit', color: '#fdfdfdff'
    }).setOrigin(0.5).setDepth(10);

    this.keyTxt = this.add.text(500, 50, `Keys: 0 / 0`, {
      font: '50px outfit', color: '#fafafaff'
    }).setOrigin(0, 0.5).setDepth(10);

    this.updateKeys();
  }

  // ---------- UPDATE LOOP ----------

  update(time, delta) {
    if (this.gameOver || !this.isGameStarted) return;

    this.timeLeft -= delta / 1000;
    if (this.timeLeft < 0) this.timeLeft = 0;
    this.timerTxt.setText("Time: " + this.fmtCountdown(this.timeLeft));

    if (this.timeLeft <= 0) {
      this.endGame(false);
      return;
    }

    this.handleInput();
  }

  // ---------- INPUT (KEYBOARD + HELD TOUCH) ----------

  handleInput() {
    if (!this.canMove || this.gameOver || !this.isGameStarted) return;

    let dir = null;
    if (this.cursors.left.isDown) dir = 'left';
    else if (this.cursors.right.isDown) dir = 'right';
    else if (this.cursors.up.isDown) dir = 'up';
    else if (this.cursors.down.isDown) dir = 'down';
    else if (this.heldDir) dir = this.heldDir; // touch

    if (!dir) return;

    let { row, col } = this.player.gridPos;
    let tr = row, tc = col;

    if (dir === 'left') tc--;
    else if (dir === 'right') tc++;
    else if (dir === 'up') tr--;
    else if (dir === 'down') tr++;

    if (tr === row && tc === col) return;
    if (this.cellFree(tr, tc)) {
      this.movePlayer(tr, tc);
    }
  }

  // ---------- HELPERS ----------

  fmtCountdown(t) {
    let m = Math.floor(t / 60);
    let s = Math.floor(t) % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  cellFree(r, c) {
    if (r < 0 || c < 0 || r >= this.grid.length || c >= this.grid[0].length) return false;
    let t = this.grid[r][c].type;
    return t !== 'wall';
  }

  movePlayer(r, c) {
    this.canMove = false;
    let px = this.offsetX + c * this.cellSize + this.cellSize / 2;
    let py = this.offsetY + r * this.cellSize + this.cellSize / 2;

    this.sys.tweens.add({
      targets: this.player,
      x: px,
      y: py,
      duration: 100,
      onComplete: () => {
        this.player.gridPos = { row: r, col: c };
        this.cellEvent(r, c);
        this.canMove = true;
      }
    });

    // 🔥 Battery no longer affects game over
    // this.battery -= this.batteryDrain;
    // this.updateBattery();
  }

  cellEvent(r, c) {
    let cell = this.grid[r][c];

    // ewall has no effect now (treated visually only)

    if (cell.type === 'key' && !cell.taken) {
      cell.taken = true;
      this.keysGot++;
      this.updateKeys();

      // Safely find & remove the key sprite for this cell
      const idx = this.keySprites.findIndex(k => {
        if (!k) return false;
        const pos = k.getData('pos');
        return pos && pos.r === r && pos.c === c;
      });

      if (idx !== -1) {
        this.keySprites[idx].destroy();
        this.keySprites.splice(idx, 1);
      }

      if (this.sfx.collect) this.sfx.collect.play();
    }

    if (cell.type === 'exit' && this.keysGot >= this.keysNeeded) {
      this.endGame(true);
    }
  }


  updateKeys() {
    this.keyTxt.setText(`Keys: ${this.keysGot} / ${this.keysNeeded}`);
  }

  // ---------- END GAME ----------

  endGame(win) {
    this.gameOver = true;
    if (this.sfx.bgm && this.sfx.bgm.isPlaying) this.sfx.bgm.pause();

    if (this.popupContainer) this.popupContainer.destroy();

    if (win) {
      if (this.sfx.lvlcomplete) this.sfx.lvlcomplete.play();
      this.popupContainer = this.add.container(960, 540).setDepth(2000);
      const lvlBg = this.add.image(0, 0, 'lvlbox');
      const nextBtn = this.add.image(-230, 350, 'next').setInteractive();
      const text = this.add.text(-100, 0, 'You Win!', {
        font: '52px outfit', color: '#ffffff'
      });
      const replayBtn = this.add.image(230, 350, 'lvl_replay').setInteractive();

      nextBtn.on('pointerdown', () => {
        this.notifyParent('sceneComplete', { result: 'win' });
      });
      replayBtn.on('pointerdown', () => {
        this.scene.restart();
      });
      this.popupContainer.add([lvlBg, text, nextBtn, replayBtn]);
    } else {
      if (this.sfx.gameover) this.sfx.gameover.play();
      this.popupContainer = this.add.container(960, 540).setDepth(2000);
      const ovrBg = this.add.image(0, -100, 'ovrbox');
      const text = this.add.text(-100, -100, 'Try Again!', {
        font: '52px outfit', color: '#ffffff'
      });
      const replayBtn = this.add.image(0, 250, 'replay').setInteractive();

      replayBtn.on('pointerdown', () => {
        this.scene.restart();
      });
      this.popupContainer.add([ovrBg, text, replayBtn]);
    }
  }

  notifyParent(type, data) {
    if (window.parent !== window) {
      window.parent.postMessage({ type, ...data }, "*");
    }
  }

  fmtTime(t) {
    let m = Math.floor(t / 60), s = Math.floor(t) % 60, ms = Math.floor((t % 1) * 100);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  }
}
