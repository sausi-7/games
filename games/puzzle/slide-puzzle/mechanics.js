export default class SlidingRelicsScene extends Phaser.Scene {
  constructor() {
    super('SlidingRelics');
    this.tiles = [];
    this.empty = { x: 0, y: 0 };
    this.moveCount = 0;

    // --- Configurable defaults ---
    this.TILE_SIZE = 160;
    this.TILE_GAP = 14;
    this.TILE_TEXT_COLOR = "#1b2233";
    this.timeRemaining = 60;
    this.GRID_SIZE = 3;

    this.timerEvent = null;
    this.won = false;
    this.tileSprites = [];
    this.emptySlotRect = null;

    // --- AUDIO ---
    this.bgm = null;
    this.sfx = {};
    this.gameStarted = false;



    Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach(fn => {
      if (typeof this[fn] === 'function') {
        this[fn] = this[fn].bind(this);
      }
    });
  }
  init() {
    // reset all state for a fresh run
    this.tiles = [];
    this.empty = { x: 0, y: 0 };
    this.moveCount = 0;
    this.timerEvent = null;
    this.won = false;
    this.tileSprites = [];
    this.emptySlotRect = null;
    this.gameStarted = false;
  }



  preload() {
    const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));
    this.load.json('config', `${basePath}/config.json`);

    this.load.once('filecomplete-json-config', () => {
      const cfg = this.cache.json.get('config');
      const images = cfg.images2 || {};
      const ui = cfg.ui || {};

      // Load regular images from config
      for (const [key, url] of Object.entries(images)) {
        this.load.image(key, `${basePath}/${url}`);
      }
      for (const [key, url] of Object.entries(ui)) {
        this.load.image(key, `${basePath}/${url}`);
      }

      // --- AUDIO ---
      const audio = cfg.audio || {};
      for (const [key, url] of Object.entries(audio)) {
        this.load.audio(key, `${basePath}/${url}`);
      }

      // --- NEW: try to load tile1..tile9.png sitting alongside this file ---
      // If any file isn't present, Phaser will just skip it; we'll fallback at runtime.
      for (let i = 1; i <= 9; i++) {
        this.load.image(`tile${i}`, `${basePath}/tile${i}.png`);
      }
    });
  }

  makeRingTexture() {
    if (this.textures.exists('tapRing')) return;
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.lineStyle(6, 0xffffff, 1);
    g.strokeCircle(64, 64, 58);
    g.generateTexture('tapRing', 128, 128);
    g.destroy();
  }

  makeShineTexture() {
    if (this.textures.exists('tileShine')) return;
    const w = 220, h = 40;
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    // soft diagonal bar
    const grd = g.createLinearGradient(0, 0, w, 0);
    grd.addColorStop(0, 'rgba(255,255,255,0)');
    grd.addColorStop(0.5, 'rgba(255,255,255,0.9)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle(grd);
    g.fillRect(0, 0, w, h);
    g.generateTexture('tileShine', w, h);
    g.destroy();
  }

  tapFX(tile) {
    this.makeRingTexture();
    this.makeShineTexture();

    const cx = tile.rect.x;
    const cy = tile.rect.y;

    // Ring pop
    const ring = this.add.image(cx, cy, 'tapRing').setDepth(5).setScale(0.4).setAlpha(0.9);
    this.sys.tweens.add({
      targets: ring,
      scale: 1.2,
      alpha: 0,
      duration: 220,
      ease: 'quad.out',
      onComplete: () => ring.destroy()
    });

    // Tile bump
    this.sys.tweens.add({
      targets: [tile.rect, tile.text],
      scale: 1.06,
      duration: 90,
      yoyo: true,
      ease: 'quad.out'
    });

    // Shine sweep across the tile
    const shine = this.add.image(cx - this.TILE_SIZE * 0.7, cy - this.TILE_SIZE * 0.3, 'tileShine')
      .setDepth(6)
      .setRotation(0.48) // ≈ 27.5°
      .setAlpha(0.9)
      .setScale(this.TILE_SIZE / 220); // keep proportion with tile

    this.sys.tweens.add({
      targets: shine,
      x: cx + this.TILE_SIZE * 0.7,
      y: cy + this.TILE_SIZE * 0.3,
      alpha: 0,
      duration: 260,
      ease: 'sine.inOut',
      onComplete: () => shine.destroy()
    });
  }

  nudgeInvalid(tile) {
    // subtle “nope” shake if not adjacent to empty slot
    this.sys.tweens.add({
      targets: [tile.rect, tile.text],
      x: `+=10`,
      duration: 50,
      yoyo: true,
      repeat: 2,
      ease: 'sine.inOut',
      onComplete: () => {
        // return to center to avoid drift
        tile.rect.x = Math.round(tile.rect.x);
        tile.text.x = tile.rect.x;
      }
    });
  }


  makeSparkTexture() {
    if (this.textures.exists('spark')) return;
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(0xffffff, 1);
    g.fillCircle(8, 8, 8);
    g.generateTexture('spark', 16, 16);
    g.destroy();
  }

  styleHudText(t, strokeColor = '#0ff', strokeW = 6) {
    // big, arcade look with outline + shadow
    t.setFontStyle('900') // ultra bold
      .setStroke(strokeColor, strokeW)
      .setShadow(0, 6, '#000000', 8, true, true);
    return t;
  }

  pulse(target, scale = 1.08, dur = 120) {
    this.sys.tweens.add({
      targets: target,
      scale: scale,
      duration: dur,
      yoyo: true,
      ease: 'quad.out'
    });
  }

  flashColorText(target, colors = ['#ffea00', '#ff006e'], times = 8, dur = 120) {
    let i = 0;
    const tw = this.sys.tweens.addCounter({
      from: 0, to: times, duration: colors.length * dur * times, repeat: 0,
      onUpdate: () => {
        const c = colors[i % colors.length];
        target.setColor(c);
        i++;
      }
    });
    return tw;
  }




  // Moving glossy "shine" sweep that loops over the tile


  burstAt(x, y, count = 12) {
    this.makeSparkTexture();

    // Returns an Emitter (newer builds) or a Manager (older builds)
    const p = this.add.particles(x, y, 'spark', {
      speed: { min: 80, max: 220 },
      angle: { min: 0, max: 360 },
      scale: { start: 1, end: 0 },
      alpha: { start: 1, end: 0 },
      lifespan: 450,
      quantity: count,
      blendMode: 'ADD'
    });

    // Stop emission shortly after start
    this.time.delayedCall(80, () => {
      if (p && typeof p.stop === 'function') p.stop(); // works if p is an Emitter
    });

    // Destroy whatever was created (Emitter or Manager)
    this.time.delayedCall(900, () => {
      if (!p) return;
      if (p.manager && typeof p.manager.destroy === 'function') {
        // p is an Emitter
        p.manager.destroy();
      } else if (typeof p.destroy === 'function') {
        // p is a Manager (older signature)
        p.destroy();
      }
    });
  }

  confettiAt(x, y, spread = 1200, rows = 2) {
    this.makeSparkTexture();

    for (let r = 0; r < rows; r++) {
      const p = this.add.particles(x, y - r * 30, 'spark', {
        speedX: { min: -spread / 2, max: spread / 2 },
        speedY: { min: -80, max: -240 },
        gravityY: 600,
        scale: { start: 1.2, end: 0 },
        alpha: { start: 1, end: 0 },
        lifespan: 1200,
        quantity: 24,
        rotate: { min: 0, max: 360 },
        blendMode: 'ADD'
      });

      // brief emission then cleanup
      this.time.delayedCall(120, () => {
        if (p && typeof p.stop === 'function') p.stop();
      });

      this.time.delayedCall(1600, () => {
        if (!p) return;
        if (p.manager && typeof p.manager.destroy === 'function') {
          p.manager.destroy();
        } else if (typeof p.destroy === 'function') {
          p.destroy();
        }
      });
    }
  }

  create() {

    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock("portrait-primary").catch(() => { });
    }
    const config = this.cache.json.get('config');
    const mechanics = config.mechanics || {};



    // Apply configurable values
    this.TILE_SIZE = mechanics.TILE_SIZE || this.TILE_SIZE;
    this.TILE_GAP = mechanics.TILE_GAP || this.TILE_GAP;
    this.TILE_TEXT_COLOR = mechanics.TILE_TEXT_COLOR || this.TILE_TEXT_COLOR;
    this.timeRemaining = mechanics.timeLimit || this.timeRemaining;
    this.GRID_SIZE = mechanics.GRID_SIZE || this.GRID_SIZE;

    this.add.image(0, 0, 'background').setOrigin(0, 0).setDisplaySize(this.sys.scale.width, this.sys.scale.height);
    this.add.image(40, 30, 'scorebar').setOrigin(0, 0);

    this.moveText = this.add.text(80, 70, "Moves: 0", {
      font: "64px outfit",
      color: "#ffffff",
      align: "left"
    }).setOrigin(0, 0.5);
    this.styleHudText(this.moveText, '#00e5ff', 8);

    this.timeText = this.add.text(this.sys.scale.width - 90, 70, "Time: 00:00", {
      font: "64px outfit",
      color: "#ffffff",
      align: "right"
    }).setOrigin(1, 0.5);
    this.styleHudText(this.timeText, '#ff6b6b', 8);

    // gentle idle breathing on the timer so it feels alive
    this.sys.tweens.add({
      targets: this.timeText,
      scale: 1.02,
      yoyo: true,
      duration: 900,
      repeat: -1,
      ease: 'sine.inOut'
    });

    this.winGroup = this.add.container(0, 0).setDepth(100).setVisible(false);

    // --- AUDIO ---
    const audio = config.audio || {};
    this.sfx = {};
    for (const key of ['bgm', 'game_over', 'win', 'slide']) {
      if (audio[key]) this.sfx[key] = this.sound.add(key, { loop: (key === 'bgm') });
    }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      // remove pointer listener if it was set
      if (this.input) this.input.off('pointerup', this.handlePointer, this);
      // stop timers safely
      if (this.timerEvent) { this.timerEvent.remove(false); this.timerEvent = null; }
      // stop any audio
      if (this.sfx && this.sfx.bgm && this.sfx.bgm.isPlaying) this.sfx.bgm.stop();
      if (this.sound) this.sound.stopAll();
    });

    this.showMenu();
  }


  notifyParent(type, data) {
    if (window.parent !== window) {
      window.parent.postMessage({ type, ...data }, "*");
    }
  }
  showMenu() {
    this.menuContainer = this.add.container(0, 0);

    const htpbox = this.add.image(540, 960, 'htpbox').setOrigin(0.5).setScale(1).setDepth(11);
    const howToPlay = this.add.text(530, 950, 'Slide the tiles to arrange them\nin order. Tap a tile next to the\nempty space to move it.\nComplete the puzzle before\ntime runs out!', {
      font: '50px outfit',
      fill: '#ffffff',
    }).setOrigin(0.5).setDepth(15);

    // this.styleHudText(howToPlay, '#7cfef0', 6);
    // howToPlay.setFontSize(50);

    const playButton = this.add.image(540, 1600, 'playbtn').setInteractive().setOrigin(0.5).setDepth(20);

    playButton.on('pointerdown', () => {
      this.menuContainer.destroy(); // Remove menu
      this.gameStarted = true;
      this.startGame();
    });

    this.menuContainer.add([htpbox, howToPlay, playButton]);
  }

  startGame() {
    // always resume physics for a new round
    if (this.physics && this.physics.world && this.physics.world.isPaused) {
      this.physics.resume();
    }
    this.makeSparkTexture();


    const gridPixel = this.GRID_SIZE * this.TILE_SIZE + (this.GRID_SIZE - 1) * this.TILE_GAP;
    this.gridOriginX = Math.floor((this.sys.scale.width - gridPixel) / 2);
    this.gridOriginY = Math.floor((this.sys.scale.height - gridPixel) / 2);

    this.createPuzzle();

    // ensure we don't stack duplicate listeners
    this.input.off('pointerup', this.handlePointer, this);
    this.input.on('pointerup', this.handlePointer, this);

    // reset and start timer
    if (this.timerEvent) { this.timerEvent.remove(false); this.timerEvent = null; }
    this.timeRemaining = (this.cache.json.get('config').mechanics?.timeLimit) ?? this.timeRemaining;
    this.timerEvent = this.time.addEvent({ delay: 1000, loop: true, callback: this.updateTimer, callbackScope: this });

    if (this.sfx.bgm && !this.sfx.bgm.isPlaying) this.sfx.bgm.play({ loop: true, volume: 0.3 });
  }


  createPuzzle() {
    let numbers = Phaser.Utils.Array.NumberArray(1, this.GRID_SIZE * this.GRID_SIZE - 1);

    do {
      Phaser.Utils.Array.Shuffle(numbers);
    } while (!this.isSolvable(numbers));
    numbers.push(0);

    this.tiles = [];
    this.tileSprites = [];
    let idx = 0;
    for (let y = 0; y < this.GRID_SIZE; y++) {
      for (let x = 0; x < this.GRID_SIZE; x++) {
        let num = numbers[idx++];
        this.tiles.push(num);
        if (num === 0) {
          this.empty.x = x;
          this.empty.y = y;
        } else {
          this.createTile(num, x, y);
        }
      }
    }
    this.drawEmptySlot();
  }

  gridToPixel(x, y) {
    return {
      px: this.gridOriginX + x * (this.TILE_SIZE + this.TILE_GAP),
      py: this.gridOriginY + y * (this.TILE_SIZE + this.TILE_GAP)
    }
  }

  blinkEmptySlot() {
    if (!this.emptySlotRect) return;
    this.sys.tweens.add({
      targets: this.emptySlotRect,
      alpha: 0.2,
      yoyo: true,
      duration: 80,
      repeat: 1
    });
  }


  createTile(num, x, y) {
    const { px, py } = this.gridToPixel(x, y);

    const key = this.textures.exists(`tile${num}`) ? `tile${num}` : 'tile';

    const img = this.add.image(px + this.TILE_SIZE / 2, py + this.TILE_SIZE / 2, key)
      .setDisplaySize(this.TILE_SIZE, this.TILE_SIZE)
      .setDepth(1)
      .setInteractive({ useHandCursor: true });

    const text = this.add.text(img.x, img.y, num, {
      font: `bold ${this.TILE_SIZE / 2}px outfit`,
      color: this.TILE_TEXT_COLOR
    }).setOrigin(0.5).setDepth(2);

    const tile = { num, x, y, rect: img, text };
    this.tileSprites.push(tile);

    // Instant tap feedback
    img.on('pointerdown', () => {
      this.tapFX(tile);

      // If not adjacent to empty, give a tiny nudge to indicate it's locked
      const isAdjacent =
        (Math.abs(x - this.empty.x) === 1 && y === this.empty.y) ||
        (Math.abs(y - this.empty.y) === 1 && x === this.empty.x);

      if (!isAdjacent) this.nudgeInvalid(tile);
      if (isAdjacent) this.blinkEmptySlot();

    });
  }



  drawEmptySlot() {
    if (this.emptySlotRect) this.emptySlotRect.destroy();
    const { px, py } = this.gridToPixel(this.empty.x, this.empty.y);
    this.emptySlotRect = this.add.rectangle(
      px + this.TILE_SIZE / 2, py + this.TILE_SIZE / 2, this.TILE_SIZE, this.TILE_SIZE
    ).setStrokeStyle(4, 0x9badc9, 1).setDepth(0);
  }

  handlePointer(pointer) {
    if (this.won) return;

    // Get grid coordinates from pointer
    const px = pointer.x - this.gridOriginX;
    const py = pointer.y - this.gridOriginY;
    if (px < 0 || py < 0) return;
    const x = Math.floor(px / (this.TILE_SIZE + this.TILE_GAP));
    const y = Math.floor(py / (this.TILE_SIZE + this.TILE_GAP));
    if (x >= this.GRID_SIZE || y >= this.GRID_SIZE) return;

    if (x === this.empty.x && y === this.empty.y) return; // clicked empty slot

    // Only move if adjacent to empty
    if (
      (Math.abs(x - this.empty.x) === 1 && y === this.empty.y) ||
      (Math.abs(y - this.empty.y) === 1 && x === this.empty.x)
    ) {
      this.moveTile(x, y, this.empty.x, this.empty.y);
    }
  }

  moveTile(fromX, fromY, toX, toY) {
    // Update data
    const fromIdx = fromY * this.GRID_SIZE + fromX;
    const toIdx = toY * this.GRID_SIZE + toX;
    const tileNum = this.tiles[fromIdx];

    this.tiles[toIdx] = tileNum;
    this.tiles[fromIdx] = 0;

    // Find the tileSprite and update its x,y
    let tile = this.tileSprites.find(t => t.x === fromX && t.y === fromY && t.num === tileNum);
    if (!tile) return;

    tile.x = toX;
    tile.y = toY;

    const { px, py } = this.gridToPixel(toX, toY);

    // --- AUDIO: Play slide on tile move
    if (this.sfx.slide) this.sfx.slide.play();

    this.sys.tweens.add({
      targets: [tile.rect, tile.text],
      x: px + this.TILE_SIZE / 2,
      y: py + this.TILE_SIZE / 2,
      duration: 140,
      onComplete: () => {
        // After movement, update the empty slot and check win
        this.empty.x = fromX;
        this.empty.y = fromY;
        this.drawEmptySlot();

        // Sparkle at the new tile position
        this.burstAt(px + this.TILE_SIZE / 2, py + this.TILE_SIZE / 2, 10);

        // Moves ++ with a punchy pulse
        this.moveCount++;
        this.moveText.setText(`Moves: ${this.moveCount}`);
        this.pulse(this.moveText, 1.12, 140);

        if (this.checkWin()) {
          this.onWin();
        }
      }

    });
  }

  updateTimer() {
    if (this.won) return;

    this.timeRemaining--;

    const mm = String(Math.floor(this.timeRemaining / 60)).padStart(2, '0');
    const ss = String(this.timeRemaining % 60).padStart(2, '0');
    this.timeText.setText(`Time: ${mm}:${ss}`);

    if (this.timeRemaining === 10 && !this._lowTimeFX) {
      this._lowTimeFX = true;
      // fast pulsing + color flash
      this.sys.tweens.add({
        targets: this.timeText,
        scale: 1.15,
        yoyo: true,
        duration: 160,
        repeat: -1,
        ease: 'quad.inOut'
      });
      this.flashColorText(this.timeText, ['#ffffff', '#ff3b3b'], 40, 80);
      // optional: subtle camera shake to add urgency
      if (this.cameras && this.cameras.main) this.cameras.main.shake(200, 0.002);
    }


    if (this.timeRemaining <= 0) {
      this.onGameOver();
    }
  }

  onGameOver() {
    if (this.won) return;
    if (this.timerEvent) { this.timerEvent.remove(false); this.timerEvent = null; }
    this.physics.pause();

    // Small spritz (uses fixed confettiAt)
    this.confettiAt(540, 880, 800, 1);

    if (this.sfx.bgm && this.sfx.bgm.isPlaying) this.sfx.bgm.stop();
    if (this.sfx.game_over) this.sfx.game_over.play();

    this.add.image(540, 960, 'ovrbox').setOrigin(0.5).setDepth(15);
    this.add.text(540, 960, "Try Again!", { font: '48px outfit', fill: '#ffffff' })
      .setOrigin(0.5).setDepth(16);

    this.add.image(540, 1300, 'replay')
      .setOrigin(0.5).setDepth(10).setInteractive()
      .on('pointerdown', () => {
        this.input.off('pointerup', this.handlePointer, this);
        this.sound.stopAll();
        this.scene.stop();
        this.scene.start(this.scene.key);
      });

    this.winGroup.setVisible(true);
  }


  checkWin() {
    for (let i = 0; i < this.tiles.length - 1; i++) {
      if (this.tiles[i] !== i + 1) return false;
    }
    return true;
  }

  onWin() {
    this.won = true;
    if (this.sfx.bgm && this.sfx.bgm.isPlaying) this.sfx.bgm.stop();
    if (this.timerEvent) { this.timerEvent.remove(false); this.timerEvent = null; }
    if (this.sfx.win) this.sfx.win.play();
    this.physics.pause();
    this.confettiAt(540, 820, 1200, 3);
    this.pulse(this.add.text(540, 960, 'You Win!', { font: '72px outfit', color: '#ffffff' }).setOrigin(0.5).setDepth(10), 1.2, 220);


    this.add.image(540, 960, 'lvlbox').setOrigin(0.5).setDepth(5);
    this.add.image(780, 1300, 'next').setOrigin(0.5).setInteractive().setDepth(10)
      .on('pointerdown', () => this.notifyParent('sceneComplete', { result: 'win' }));
    this.add.image(300, 1300, 'lvl_replay').setOrigin(0.5).setInteractive().setDepth(10)
      .on('pointerdown', () => {
        this.input.off('pointerup', this.handlePointer, this);
        this.sound.stopAll();
        this.scene.stop();
        this.scene.start(this.scene.key);
      });
    this.add.text(540, 960, '', { font: '48px outfit', fill: '#ffffffff' }).setOrigin(0.5).setDepth(10);

    this.winGroup.setVisible(true);
  }

  isSolvable(nums) {
    // nums is 1..N-1 (no zero yet)
    const N = this.GRID_SIZE * this.GRID_SIZE;
    let inv = 0;
    for (let i = 0; i < nums.length - 1; i++) {
      for (let j = i + 1; j < nums.length; j++) {
        if (nums[i] > nums[j]) inv++;
      }
    }
    if (this.GRID_SIZE % 2 === 1) {
      return inv % 2 === 0;
    } else {
      // assume blank at the end during check (row-from-bottom = 1)
      // For even width, puzzle is solvable if inversions are odd when blank row is even, or even when blank row is odd.
      // With blank at end (row-from-bottom = 1 => odd), need inversions even.
      return inv % 2 === 0;
    }
  }

}
