const CONNECTIONS = {
  straight: [[0, 1], [0, -1]],
  elbow: [[0, 1], [1, 0]],
  t: [[0, 1], [-1, 0], [1, 0]],
  cross: [[0, 1], [0, -1], [1, 0], [-1, 0]]
};

export default class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
    this.grid = [];
    this.powerTile = null;
    this.bulbs = [];
    this.centerX = 0;
    this.centerY = 0;
    this.offsetX = 0;
    this.offsetY = 0;
    this.tileSize = 0;
    this.settings = {};
    this.player = null;
    this.timer = null;
    this.timeLeft = 60; // 3 minutes in seconds
    this.timerText = null;
    this.state = 'htp'; // 'htp', 'playing', 'win', 'gameover'
    this.overlay = null;

    this.sfx = { collect: null };

    this.scorebar = null;
    this.timeTotal = 60;
    this.texts = {};



    Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach(fn => {
      if (typeof this[fn] === 'function') this[fn] = this[fn].bind(this);
    });
  }

  preload() {
    const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));
    this.load.json('levelConfig', `${basePath}/config.json`);

    this.load.once('filecomplete-json-levelConfig', () => {
      const config = this.cache.json.get('levelConfig');
      const cfg = this.cache.json.get("levelConfig");

      this.configData = config;
      this.settings = config.settings || {};
      this.GRID_SIZE = this.settings.gridSize || 6;

      this.texts =
        config.texts ||            // preferred: put all strings here
        config.uiTexts ||          // fallback names supported
        config.copy ||             // another common alias
        {};

      const s = this.settings || {};
      this.timeTotal =
        (typeof s.timerSeconds === 'number' && s.timerSeconds) ||
        (typeof s.timeSeconds === 'number' && s.timeSeconds) ||
        (typeof s.time === 'number' && s.time) ||
        (typeof s.timeLimit === 'number' && s.timeLimit) ||
        (typeof s.timeMinutes === 'number' && s.timeMinutes * 60) ||
        this.timeTotal; // keep default if none found
      const spritesheets = cfg.spritesheets || {};
      const eveData = spritesheets.eve || {};


      // Load eve sprite

      // Load images
      const images1 = config.images1 || {};
      const images2 = config.images2 || {};
      const ui = config.ui || {};

      const playerFromCfg =
        (ui && (ui.player || ui.player_png)) ||
        (images1 && (images1.player || images1.player_png)) ||
        (images2 && (images2.player || images2.player_png)) ||
        'player.png';

      const playerUrl = playerFromCfg.startsWith('http') ? playerFromCfg : `${basePath}/${playerFromCfg}`;
      this.load.image('player', playerUrl);

      const tileFromCfg =
        (ui && (ui.tile || ui.tile_png)) ||
        (images1 && (images1.tile || images1.tile_png)) ||
        (images2 && (images2.tile || images2.tile_png)) ||
        'tile.png';

      const tileUrl = tileFromCfg.startsWith('http') ? tileFromCfg : `${basePath}/${tileFromCfg}`;
      this.load.image('tile', tileUrl);


      for (const key in images1) {
        this.load.image(key, `${basePath}/${images1[key]}`);
      }

      for (const key in images2) {
        this.load.image(key, `${basePath}/${images2[key]}`);
      }

      for (const key in ui) {
        this.load.image(key, `${basePath}/${ui[key]}`);
      }

      // Load audio (support both local paths & full URLs)
      const audio = config.audio || {};
      for (const key in audio) {
        const url = audio[key];
        const audioUrl =
          /^https?:\/\//i.test(url) || url.startsWith('//')
            ? url                   // full URL -> use as-is
            : `${basePath}/${url}`; // relative -> prefix with basePath

        this.load.audio(key, audioUrl).on('error', () => {
          console.error(`Failed to load audio: ${key} from ${audioUrl}`);
        });
      }

      this.load.start();
    });
  }

  create() {
    const screenWidth = this.sys.game.config.width;
    const screenHeight = this.sys.game.config.height;
    const margin = this.settings.margin || 20;

    // ✅ Reload settings if missing (on replay)
    if (!this.settings || !this.settings.bulbPositions) {
      const config = this.cache.json.get('levelConfig');
      this.configData = config;
      this.settings = config.settings || {};
      this.GRID_SIZE = this.settings.gridSize || 6;
    }

    const s = this.settings || {};
    this.timeTotal =
      (typeof s.timerSeconds === 'number' && s.timerSeconds) ||
      (typeof s.timeSeconds === 'number' && s.timeSeconds) ||
      (typeof s.time === 'number' && s.time) ||
      (typeof s.timeLimit === 'number' && s.timeLimit) ||
      (typeof s.timeMinutes === 'number' && s.timeMinutes * 60) ||
      this.timeTotal;


    this.add.image(screenWidth / 2, screenHeight / 2, 'background')
      .setOrigin(0.5)
      .setDisplaySize(screenWidth, screenHeight)
      .setDepth(-2);

    this.scorebar = this.add.image(540, 50, 'scorebar')
      .setDepth(19)        // below timerText (20)
      .setVisible(false);

    // Background music – only if actually loaded
    if (this.bgMusic && this.bgMusic.isPlaying) {
      this.bgMusic.stop();
    }

    if (this.cache.audio.exists('bg_music')) {
      this.bgMusic = this.sound.add('bg_music', { loop: true, volume: 0.5 });
      this.bgMusic.play();
    } else {
      console.warn('Audio key "bg_music" missing from cache, cannot play BGM.');
    }

    if (this.cache.audio.exists('collect')) {
      this.sfx.collect = this.sound.add('collect', { loop: false, volume: 1 });
    }

    const maxGridWidth = screenWidth - margin * 2;
    const maxGridHeight = screenHeight - margin * 2;
    this.tileSize = Math.floor(Math.min(maxGridWidth / this.GRID_SIZE, maxGridHeight / this.GRID_SIZE));
    this.centerX = screenWidth / 2;
    this.centerY = screenHeight / 2;
    this.offsetX = this.centerX - (this.tileSize * (this.GRID_SIZE - 1)) / 2;
    this.offsetY = this.centerY - (this.tileSize * (this.GRID_SIZE - 1)) / 2;


    this.showOverlay('htp'); // Show "how to play" on start

    this.events.on('shutdown', this.shutdown, this);
    this.events.on('destroy', this.shutdown, this);
  }

  // ADD: tiny helper to read texts with a fallback
  t(key, fallback) {
    // Support flat keys or nested via dot: "overlays.htp.title"
    const src = this.texts || {};
    if (!key) return fallback;
    if (src[key] != null) return src[key];

    // dotted access support
    if (key.includes('.')) {
      try {
        return key.split('.').reduce((o, k) => (o && o[k] != null ? o[k] : undefined), src) ?? fallback;
      } catch {
        return fallback;
      }
    }
    return fallback;
  }



  showOverlay(type) {
    if (type === 'htp') {
      this.overlay = this.add.container(1080 / 2, 1920 / 2);
      const box = this.add.image(0, -50, 'htpbox').setScale(0.55, 0.8);
      const htp = this.add.text(-160, -300, this.t('htp_title', 'How to Play'), {
        font: '70px outfit',
        color: '#fff',
        align: 'left'
      });
      const howToText = this.add.text(-300, -100, this.t('htp_instruction_rotate', 'Tap to rotate:'), {
        font: '50px outfit',
        color: '#fff',
        align: 'left'
      }).setOrigin(0.5);

      const howToText1 = this.add.text(-330, 100, this.t('htp_instruction_connect', 'Connect:'), {
        font: '50px outfit',
        color: '#fff',
        align: 'left'
      }).setOrigin(0.5);

      const img = this.add.image(0, -100, 'tile').setScale(1, 0.7)

      const img1 = this.add.image(-80, 70, 'bulb').setScale(1)

      const btn = this.add.image(0, 450, 'playbtn').setInteractive({ useHandCursor: true });
      btn.on('pointerdown', () => this.startGame());
      this.overlay.add([box, htp, howToText, howToText1, img, img1, btn]);
      this.state = 'htp';
    } else if (type === 'gameover') {
      this.overlay = this.add.container(1080 / 2, 1920 / 2);
      const box = this.add.image(0, -100, 'ovrbox').setScale(0.55, 0.8);
      const gameOverText = this.add.text(0, -200, this.t('gameover_title', 'Game Over'), {
        font: '70px outfit',
        color: '#fff',
      }).setOrigin(0.5);
      const gameOverText1 = this.add.text(0, 0, this.t('gameover_sub', 'Try Again!'), {
        font: '50px outfit',
        color: '#fff',
      }).setOrigin(0.5);
      const replay = this.add.image(0, 400, 'replay').setInteractive({ useHandCursor: true });
      replay.on('pointerdown', () => {
        if (this.bgMusic && this.bgMusic.isPlaying) {
          this.bgMusic.stop();
        }
        this.scene.restart();
      });

      this.overlay.add([box, gameOverText, gameOverText1, replay]);
      this.state = 'gameover';
    } else if (type === 'win') {
      this.overlay = this.add.container(1080 / 2, 1920 / 2);
      const box = this.add.image(0, -100, 'lvlbox').setScale(0.55, 0.8);
      const winText = this.add.text(0, -50, this.t('win_title', 'Level Completed'), {
        font: '80px outfit',
        color: '#fff',
      }).setOrigin(0.5);
      const next = this.add.image(-235, 330, 'next').setInteractive({ useHandCursor: true });
      const replay = this.add.image(235, 330, 'lvl_replay').setInteractive({ useHandCursor: true });
      next.on('pointerdown', () => this.notifyParent('sceneComplete', { result: 'win' }));
      replay.on('pointerdown', () => {
        if (this.bgMusic && this.bgMusic.isPlaying) {
          this.bgMusic.stop();
        }
        this.scene.restart();
      });

      this.overlay.add([box, winText, next, replay]);
      this.state = 'win';
    }
  }

  notifyParent(type, data) {
    if (window.parent !== window) {
      window.parent.postMessage({ type, ...data }, "*");
    }
  }


  startGame() {
    this.hideOverlay();
    this.state = 'playing';
    this.timeLeft = this.timeTotal;

    this.createLevel();
    this.drawGrid();
    this.scorebar?.setVisible(true);
    this.timerText = this.add.text(this.centerX, 50, "Time: --:--", {
      font: '50px outfit',
      color: 'black',
    }).setOrigin(0.5).setDepth(20);

    // immediately reflect the JSON-configured time
    this.updateTimer();


    this.checkConnections();

    if (this.timer) this.timer.remove();
    this.timer = this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        if (this.state !== 'playing') return;
        this.timeLeft--;
        this.updateTimer();
        if (this.timeLeft <= 0) {
          this.timeLeft = 0;
          this.updateTimer();
          this.gameOver();
        }
      }
    });
  }


  updateTimer() {
    const mm = String(Math.floor(this.timeLeft / 60)).padStart(2, '0');
    const ss = String(this.timeLeft % 60).padStart(2, '0');
    const label = this.t('time_label', 'Time');
    if (this.timerText) this.timerText.setText(`${label}:${mm}:${ss}`);
  }


  hideOverlay() {
    if (this.overlay) {
      this.overlay.destroy();
      this.overlay = null;
    }
  }


  createLevel() {
    const types = ['straight', 'elbow', 't', 'cross'];
    for (let y = 0; y < this.GRID_SIZE; y++) {
      this.grid[y] = [];
      for (let x = 0; x < this.GRID_SIZE; x++) {
        const type = Phaser.Math.RND.pick(types);
        const rotation = Phaser.Math.Between(0, 3);
        this.grid[y][x] = { x, y, type, rotation, graphics: null };
      }
    }

    this.powerTile = this.grid[0][0];
    this.powerTile.type = 'cross';
    this.powerTile.rotation = 0;

    const bulbPositions = this.settings.bulbPositions || [];
    const bulbSize = this.settings.bulbSize || 129;

    for (const [x, y] of bulbPositions) {
      const cx = this.offsetX + x * this.tileSize;
      const cy = this.offsetY + y * this.tileSize;
      const bulb = this.add.image(cx, cy, 'bulb')
        .setDisplaySize(bulbSize, bulbSize)
        .setDepth(10);

      this.bulbs.push({ x, y, lit: false, sprite: bulb });
    }

    // 👇 Add the player sprite at the power tile position
    const powerX = this.offsetX + this.powerTile.x * this.tileSize;
    const powerY = this.offsetY + this.powerTile.y * this.tileSize;
    this.player = this.add.image(powerX, powerY, 'player')
      .setOrigin(0.5)
      .setDisplaySize(this.tileSize, this.tileSize)
      .setDepth(11);

  }

  drawGrid() {
    const padding = this.settings.tilePadding || 4;

    for (let y = 0; y < this.GRID_SIZE; y++) {
      for (let x = 0; x < this.GRID_SIZE; x++) {
        const tile = this.grid[y][x];
        const cx = this.offsetX + x * this.tileSize;
        const cy = this.offsetY + y * this.tileSize;

        // Background sprite for the tile (replaces the filled rectangle)
        // Keep the same visual size as before: (tileSize - padding)
        if (!tile.bg) {
          tile.bg = this.add.image(cx, cy, 'tile')
            .setOrigin(0.5)
            .setDisplaySize(this.tileSize - padding, this.tileSize - padding)
            .setDepth(1)
            .setInteractive({ useHandCursor: true });
        } else {
          tile.bg.setPosition(cx, cy).setDisplaySize(this.tileSize - padding, this.tileSize - padding);
        }

        // Graphics layer only for wires/borders on top of the image
        if (!tile.graphics) {
          tile.graphics = this.add.graphics().setDepth(2);
        }

        // Draw wires/border for the current tile
        this.drawTile(tile, false);

        // Click: rotate tile
        tile.bg.removeAllListeners?.();
        tile.bg.on('pointerdown', () => {
          if (this.state !== 'playing') return;
          tile.rotation = (tile.rotation + 1) % 4;
          this.drawTile(tile, false);
          this.checkConnections();
        });
      }
    }
  }


  drawTile(tile, powered) {
    const g = tile.graphics;
    g.clear();

    const cx = this.offsetX + tile.x * this.tileSize;
    const cy = this.offsetY + tile.y * this.tileSize;

    const wireColor = powered
      ? parseInt(this.settings.litWireColor?.replace('#', ''), 16) || 0xffff00
      : parseInt(this.settings.unlitWireColor?.replace('#', ''), 16) || 0x666666;

    const borderColor = parseInt(this.settings.tileBorder?.replace('#', ''), 16) || 0xffffff;
    const padding = this.settings.tilePadding || 4;
    const wireThickness = this.settings.wireThickness || 8;

    // We no longer fill the tile—the sprite is the background.
    // Draw wires from center toward connection directions.
    g.lineStyle(wireThickness, wireColor, 1);
    const dirs = this.getTileConnections(tile);
    for (const [dx, dy] of dirs) {
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + dx * this.tileSize / 2, cy + dy * this.tileSize / 2);
      g.strokePath();
    }

    // Optional border to match previous look
    g.lineStyle(1, borderColor);
    g.strokeRect(
      cx - (this.tileSize - padding) / 2,
      cy - (this.tileSize - padding) / 2,
      this.tileSize - padding,
      this.tileSize - padding
    );

    // Keep bg sprite aligned (in case layout changed)
    tile.bg?.setPosition(cx, cy).setDisplaySize(this.tileSize - padding, this.tileSize - padding);
  }


  getTileConnections(tile) {
    const base = CONNECTIONS[tile.type];
    return base.map(([dx, dy]) => this.rotateDirection(dx, dy, tile.rotation));
  }

  rotateDirection(dx, dy, rot) {
    for (let i = 0; i < rot; i++) {
      [dx, dy] = [-dy, dx];
    }
    return [dx, dy];
  }

  checkConnections() {
    const visited = new Set();
    const queue = [[this.powerTile.x, this.powerTile.y]];

    while (queue.length > 0) {
      const [x, y] = queue.shift();
      const key = `${x},${y}`;
      if (visited.has(key)) continue;
      visited.add(key);

      const tile = this.grid[y][x];
      const conns = this.getTileConnections(tile);

      for (const [dx, dy] of conns) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= this.GRID_SIZE || ny >= this.GRID_SIZE) continue;

        const neighbor = this.grid[ny][nx];
        const neighborConns = this.getTileConnections(neighbor);

        if (neighborConns.some(([ndx, ndy]) => ndx === -dx && ndy === -dy)) {
          queue.push([nx, ny]);
        }
      }
    }

    let allLit = true;
    for (const bulb of this.bulbs) {
      const key = `${bulb.x},${bulb.y}`;
      if (visited.has(key)) {
        if (!bulb.lit) {
          if (this.sfx.collect) {
            this.sfx.collect.play();
          } else if (this.cache.audio.exists('collect')) {
            // fallback if you didn't pre-create the instance
            this.sound.play('collect', { loop: false, volume: 1 });
          }
          bulb.sprite.setTint(0xffffcc);
          bulb.lit = true;
        }
      } else {
        bulb.sprite.setTint(0x444400);
        bulb.lit = false;
        allLit = false;
      }
    }

    for (const row of this.grid) {
      for (const tile of row) {
        const key = `${tile.x},${tile.y}`;
        this.drawTile(tile, visited.has(key));
      }
    }

    if (allLit) this.showWin();
  }

  showWin() {
    if (this.state !== 'playing') return;
    this.state = 'win';
    if (this.timer) this.timer.remove();
    this.scorebar?.setVisible(false);
    this.clearGameplay();
    this.hideOverlay();
    this.showOverlay('win');
  }


  gameOver() {
    if (this.state !== 'playing') return;
    this.state = 'gameover';
    if (this.timer) this.timer.remove();
    this.scorebar?.setVisible(false);
    this.clearGameplay();
    this.hideOverlay();
    this.showOverlay('gameover');
  }

  shutdown() {
    if (this.timer) this.timer.remove();
    this.grid = [];
    this.bulbs = [];
    this.powerTile = null;
    this.player = null;
  }


  clearGameplay() {
    // Destroy grid tiles
    for (const row of this.grid) {
      for (const tile of row) {
        tile.graphics?.destroy();
        tile.bg?.destroy();           // <-- add this
      }
    }

    // Destroy bulbs
    for (const bulb of this.bulbs) {
      bulb.sprite?.destroy();
    }

    // Destroy player
    if (this.player) {
      this.player.destroy();
      this.player = null;
    }

    // Destroy timer text
    if (this.timerText) {
      this.timerText.destroy();
      this.timerText = null;
    }

    // Clear arrays and state
    this.grid = [];
    this.bulbs = [];
    this.powerTile = null;
  }

}
