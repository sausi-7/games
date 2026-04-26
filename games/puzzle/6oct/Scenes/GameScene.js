class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');

    // Runtime
    this._puzzleIndex = 0;
    this._puzzle = null;

    // Grid
    this._grid = { rows: 0, cols: 0, cells: [], sprites: [], letterTexts: [] };

    // Targets
    this._targetsAll = [];
    this._targets = new Set();
    this._targetPlacements = {};
    this._found = new Set();

    // Wheel
    this._wheel = { group: null, radius: 170, center: null, letters: [] };
    this._currentWord = [];
    this._streak = 0;

    // Score/Timer/State
    this._score = 0;
    this._timeLeft = 0;
    this._finished = false;

    // UI
    this._scoreText = null;
    this._timerText = null;
    this._progressText = null;
    this._currentWordText = null;

    // Audio
    this._bgm = null;

    // Buttons
    this._btnShuffle = null;
    this._btnClear = null;
    this._btnSubmit = null;

    // Visual style for solved letters (WOW-like purple chip)
    this.COLORS = {
      filledBg: 0x4820a8,        // deep purple for filled tiles
      letterFilled: '#ffffff',   // white letters on solved tiles
      letterEmpty: '#1a2b4d'     // navy letters when empty
    };

  }

  preload() {
    const cfg = this.registry.get('cfg') || {};
    const images = (cfg.images || {});
    const audio = (cfg.audio || {});

    for (const [k, url] of Object.entries(images)) this.load.image(k, url);
    for (const [k, url] of Object.entries(audio)) this.load.audio(k, url);

    if (cfg.font && cfg.font.url && cfg.font.family) {
      const ff = new FontFace(cfg.font.family, `url(${cfg.font.url})`);
      ff.load().then(f => document.fonts.add(f)).catch(() => { });
    }
  }

  // Returns an index that rotates through puzzles in a random order across page reloads
  _selectNextPuzzle(puzzles) {
    if (!Array.isArray(puzzles) || puzzles.length === 0) return 0;

    const KEY_ORDER = 'wow_order_v1';
    const KEY_PTR = 'wow_ptr_v1';

    // get or make a shuffled order the same length as puzzles
    let order = [];
    try { order = JSON.parse(localStorage.getItem(KEY_ORDER) || '[]'); } catch (e) { }
    if (!Array.isArray(order) || order.length !== puzzles.length) {
      order = Array.from({ length: puzzles.length }, (_, i) => i);
      Phaser.Utils.Array.Shuffle(order);
      localStorage.setItem(KEY_ORDER, JSON.stringify(order));
      localStorage.setItem(KEY_PTR, '0');
    }

    // pointer advances each time you start a GameScene
    let ptr = parseInt(localStorage.getItem(KEY_PTR) || '0', 10);
    if (isNaN(ptr)) ptr = 0;

    const idx = order[ptr % order.length];
    ptr = (ptr + 1) % order.length;

    localStorage.setItem(KEY_PTR, String(ptr));
    return idx;
  }


  create() {
    const cfg = this.registry.get('cfg') || {};
    const G = cfg.gameplay || {};

    this._createBackground();

    const puzzles = Array.isArray(G.puzzles) ? G.puzzles : [];

    // If the designer forces a specific puzzle, use it; otherwise pick next randomized one
    if (Number.isInteger(G.startPuzzleIndex)) {
      this._puzzleIndex = Phaser.Math.Clamp(G.startPuzzleIndex, 0, Math.max(0, puzzles.length - 1));
    } else {
      this._puzzleIndex = this._selectNextPuzzle(puzzles);
    }

    this._puzzle = puzzles[this._puzzleIndex] || this._makeFallbackPuzzle();


    // Init
    this._score = 0; this._streak = 0; this._found.clear();
    this._targetsAll = (this._puzzle.targets || []).map(s => s.toUpperCase());
    this._targets = new Set(this._targetsAll);
    this._finished = false;

    // Timer
    this._timeLeft = G.timerSeconds || 0;
    if (this._timeLeft > 0) {
      this.time.addEvent({
        delay: 1000, loop: true,
        callback: () => {
          if (this._finished) return;
          this._timeLeft = Math.max(0, this._timeLeft - 1);
          this._updateTimerText();
          if (this._timeLeft <= 0) this._onLose();
        }
      });
    }

    // BGM
    if (this.cache.audio.exists('bgm')) {
      this._bgm = this.sound.add('bgm', { loop: true, volume: (G.bgmVolume ?? 0.6) });
      this._bgm.play();
    }

    // Polished fallback textures & icons
    this._ensureWOWTextures();

    // Grid + Wheel
    this._buildGridFromBlueprint(this._puzzle.grid);
    this._buildLetterWheel(this._puzzle.bank);

    // UI
    this._createCurrentWordStrip();
    this._createHUD();
    this._createMobileButtons();
    this._setupKeyboard();

    this.scale.on('resize', () => this._layout(), this);
    this._layout();
  }

  update() {
    if (this._finished) return;
  }

  // ----------------------------------------------------------------
  // VISUALS
  // ----------------------------------------------------------------
  _createBackground() {
    const W = this.scale.width, H = this.scale.height;
    if (this.textures.exists('background')) {
      const bg = this.add.image(W / 2, H / 2, 'background').setDepth(-100);
      const s = Math.max(W / bg.width, H / bg.height);
      bg.setScale(s);
      return;
    }
    // fallback gradient
    const g = this.add.graphics();
    const top = 0x79b8ff, bot = 0xd7efff, steps = 24;
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      const c = Phaser.Display.Color.Interpolate.ColorWithColor(
        Phaser.Display.Color.IntegerToColor(top),
        Phaser.Display.Color.IntegerToColor(bot), steps - 1, i
      );
      g.fillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b), 1);
      g.fillRect(0, H * (i / steps), W, H / steps + 1);
    }
    g.generateTexture('bg_grad', W, H);
    g.destroy();
    this.add.image(W / 2, H / 2, 'bg_grad').setDepth(-100).setDisplaySize(W, H);
  }

  // >>> NEW polished tile that matches your screenshot (soft white, rounded, border, inner highlight)
  _ensureWOWTextures() {
    // Soft tile (screenshot style)
    if (!this.textures.exists('tile_soft')) {
      const S = 160, r = 26;
      const g = this.add.graphics();

      // Drop shadow
      g.fillStyle(0x000000, 0.18);
      g.fillRoundedRect(10, 14, S - 20, S - 22, r);

      // Main plate
      g.fillStyle(0xffffff, 0.96);
      g.fillRoundedRect(6, 6, S - 20, S - 20, r);

      // Border stroke (subtle blue)
      g.lineStyle(4, 0xe9f0ff, 1);
      g.strokeRoundedRect(6, 6, S - 20, S - 20, r);

      // Top highlight band
      g.fillStyle(0xffffff, 0.7);
      g.fillRoundedRect(6, 6, S - 20, 20, r);

      g.generateTexture('tile_soft', S, S);
      g.destroy();
    }

    // Circular button base
    if (!this.textures.exists('btn_circle')) {
      const s = 200;
      const g = this.add.graphics();
      g.fillStyle(0x000000, 0.2); g.fillCircle(s / 2 + 4, s / 2 + 8, s / 2 - 10);
      g.fillStyle(0xffffff, 0.95); g.fillCircle(s / 2, s / 2, s / 2 - 14);
      g.fillStyle(0xffffff, 0.45);
      g.slice(s / 2, s / 2 - 10, s / 2 - 22, Phaser.Math.DegToRad(200), Phaser.Math.DegToRad(-20), true);
      g.fillPath();
      g.generateTexture('btn_circle', s, s);
      g.destroy();
    }

    // Vector shuffle icon (uses quadraticBezierTo if present; else lines)
    if (!this.textures.exists('icon_shuffle')) {
      const s = 140, col = 0x6674a6;
      const g = this.add.graphics();
      g.lineStyle(10, col, 1);

      const bez = (cx, cy, tx, ty) => {
        if (typeof g.quadraticBezierTo === 'function') g.quadraticBezierTo(cx, cy, tx, ty);
        else g.lineTo(tx, ty);
      };

      g.beginPath(); g.moveTo(18, s * 0.55); bez(s * 0.45, s * 0.15, s * 0.85, s * 0.45); g.strokePath();
      g.fillStyle(col, 1); g.fillTriangle(s * 0.78, s * 0.35, s * 0.92, s * 0.48, s * 0.76, s * 0.52);

      g.lineStyle(10, col, 1);
      g.beginPath(); g.moveTo(s * 0.82, s * 0.52); bez(s * 0.45, s * 0.85, 22, s * 0.58); g.strokePath();
      g.fillTriangle(28, s * 0.48, 16, s * 0.62, 34, s * 0.64);

      g.generateTexture('icon_shuffle', s, s);
      g.destroy();
    }

    // Letter token chip
    if (!this.textures.exists('token')) {
      const s = 128;
      const g = this.add.graphics();
      g.fillStyle(0x000000, 0.2); g.fillCircle(s / 2 + 2, s / 2 + 6, s / 2 - 10);
      g.fillStyle(0xffffff, 0.98); g.fillCircle(s / 2, s / 2, s / 2 - 14);
      g.generateTexture('token', s, s);
      g.destroy();
    }
  }

  // ----------------------------------------------------------------
  // PUZZLE / GRID
  // ----------------------------------------------------------------
  _makeFallbackPuzzle() {
    return {
      bank: "SPHINX",
      targets: ["SPIN", "HIPS", "SHIN", "PIN", "SIN"],
      grid: {
        rows: 8,
        cols: 12,
        cells: [
          "............",
          "..SPIN......",
          "............",
          "...HIPS.....",
          "............",
          "....SHIN....",
          "............",
          "............"
        ]
      }
    };
  }

  _buildGridFromBlueprint(gridSpec) {
    const cfg = this.registry.get('cfg') || {};
    const G = cfg.gameplay || {};
    const rows = gridSpec?.rows || 7;
    const cols = gridSpec?.cols || 12;
    const cells = gridSpec?.cells || [];

    this._grid.rows = rows;
    this._grid.cols = cols;
    this._grid.cells = [];
    this._grid.sprites = [];
    this._grid.letterTexts = [];

    const tileKey = this.textures.exists('platform2') ? 'platform2' : 'tile_soft';

    for (let r = 0; r < rows; r++) {
      this._grid.cells[r] = [];
      this._grid.sprites[r] = [];
      this._grid.letterTexts[r] = [];
      const line = (cells[r] || "").padEnd(cols, '.').substring(0, cols);

      for (let c = 0; c < cols; c++) {
        const ch = line[c];
        if (ch !== '.') {
          const tile = this.add.sprite(0, 0, tileKey);
          tile.setDisplaySize(G.gridCellW ?? 92, G.gridCellH ?? 92);
          this.physics.add.existing(tile);
          tile.body.setImmovable(true);
          tile.body.setAllowGravity(false);
          tile.body.setSize(tile.displayWidth, tile.displayHeight);
          tile.setData('filled', false);             // << add

          const lt = this.add.text(0, 0, '', {
            fontFamily: (cfg.font?.family || 'Outfit, Arial'),
            fontSize: `${G.gridLetterSize ?? 40}px`,
            color: this.COLORS.letterEmpty,               // << change to use the constant
            stroke: '#ffffff',
            strokeThickness: 6
          }).setOrigin(0.5);
          lt.setShadow(0, 2, '#0b1222', 4, true, true);

          this._grid.sprites[r][c] = tile;
          this._grid.letterTexts[r][c] = lt;
          this._grid.cells[r][c] = ch;
        } else {
          this._grid.sprites[r][c] = null;
          this._grid.letterTexts[r][c] = null;
          this._grid.cells[r][c] = '.';
        }
      }
    }

    this._computeTargetPlacements();
  }

  _computeTargetPlacements() {
    this._targetPlacements = {};
    const rows = this._grid.rows, cols = this._grid.cols;

    const scanWord = (word) => {
      const w = word.toUpperCase();
      // Horizontal
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c <= cols - w.length; c++) {
          let ok = true;
          for (let i = 0; i < w.length; i++) {
            if (this._grid.cells[r][c + i] !== w[i]) { ok = false; break; }
          }
          if (ok) return Array.from({ length: w.length }, (_, i) => ({ r, c: c + i }));
        }
      }
      // Vertical
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r <= rows - w.length; r++) {
          let ok = true;
          for (let i = 0; i < w.length; i++) {
            if (this._grid.cells[r + i][c] !== w[i]) { ok = false; break; }
          }
          if (ok) return Array.from({ length: w.length }, (_, i) => ({ r: r + i, c }));
        }
      }
      return null;
    };

    for (const w of this._targetsAll) {
      const coords = scanWord(w);
      if (coords) this._targetPlacements[w] = coords;
    }
  }

  // ----------------------------------------------------------------
  // WHEEL
  // ----------------------------------------------------------------
  // --- WOW LETTER WHEEL (index-safe) ---
  _buildLetterWheel(bankStr) {
    const cfg = this.registry.get('cfg') || {};
    const G = cfg.gameplay || {};

    const chars = (bankStr || '').replace(/\s+/g, '').toUpperCase().split('');
    this._wheel.group?.destroy(true);
    this._wheel.group = this.add.container(0, 0);
    this._wheel.letters = [];          // keep stable (no reordering)
    this._wheel.angles = [];           // we will shuffle ANGLES, not the array

    // Center button
    const centerKey = this.textures.exists('btn_circle') ? 'btn_circle' :
      (this.textures.exists('action') ? 'action' : 'token');
    const center = this.add.sprite(0, 0, centerKey).setInteractive({ useHandCursor: true });
    center.setDisplaySize(G.wheelCenterSize ?? 260, G.wheelCenterSize ?? 260);
    this.physics.add.existing(center);
    center.body.setImmovable(true); center.body.setAllowGravity(false);
    center.body.setSize(center.displayWidth, center.displayHeight);
    center.on('pointerdown', () => { center.setScale(0.96); center.setAlpha(0.9); this._shuffleWheel(); });
    center.on('pointerup', () => { center.setScale(1); center.setAlpha(1); });
    center.on('pointerout', () => { center.setScale(1); center.setAlpha(1); });

    const icoKey = this.textures.exists('icon_shuffle') ? 'icon_shuffle' :
      (this.textures.exists('action') ? 'action' : null);
    if (icoKey) {
      const ico = this.add.image(0, 0, icoKey);
      const sz = (G.wheelCenterSize ?? 260) * 0.38;
      ico.setDisplaySize(sz, sz);
      this._wheel.group.add(ico);
    }
    this._wheel.group.add(center);
    this._wheel.center = center;

    // Tokens
    const N = Math.max(3, chars.length);
    const rad = (G.wheelRadius ?? 170);
    const tokenKey = this.textures.exists('token') ? 'token' :
      (this.textures.exists('platform1') ? 'platform1' : 'btn_circle');

    // Precompute evenly spaced angles
    this._wheel.angles = Array.from({ length: N }, (_, i) => (i / N) * Math.PI * 2 - Math.PI / 2);

    chars.forEach((ch, i) => {
      const ang = this._wheel.angles[i];
      const x = Math.cos(ang) * rad, y = Math.sin(ang) * rad;

      const sp = this.add.sprite(x, y, tokenKey).setInteractive({ useHandCursor: true });
      sp.setDisplaySize(G.wheelTokenSize ?? 128, G.wheelTokenSize ?? 128);
      this.physics.add.existing(sp);
      sp.body.setImmovable(true); sp.body.setAllowGravity(false);
      sp.body.setSize(sp.displayWidth, sp.displayHeight);

      const t = this.add.text(x, y, ch, {
        fontFamily: (cfg.font?.family || 'Outfit, Arial'),
        fontSize: `${G.wheelLetterSize ?? 64}px`,
        color: '#1a2b4d',
        stroke: '#ffffff',
        strokeThickness: 6
      }).setOrigin(0.5);
      t.setShadow(0, 2, '#0b1222', 4, true, true);

      // Store a letter object and put it on the sprite so handler is always correct
      const L = { ch, sprite: sp, text: t, angleIndex: i };
      sp.setData('letter', L);
      sp.on('pointerdown', () => this._onWheelLetterPressedObj(L));

      this._wheel.group.add(sp);
      this._wheel.group.add(t);
      this._wheel.letters.push(L);
    });
    this._shuffleWheel();

  }

  _onWheelLetterPressedObj(L) {
    if (this._finished || !L) return;
    this._currentWord.push({ ch: L.ch });
    L.sprite.setTint(0xcbd2ff);
    this._updateCurrentWordText();
  }

  // Shuffle ANGLES only; keep letters array and handlers stable
  _shuffleWheel() {
    if (this._finished) return;
    const cfg = this.registry.get('cfg') || {};
    const G = cfg.gameplay || {};
    const rad = (G.wheelRadius ?? 170);

    // Create a shuffled copy of indices 0..N-1 and reassign each letter's angleIndex
    const idxs = this._wheel.letters.map((_, i) => i);
    Phaser.Utils.Array.Shuffle(idxs);

    this._wheel.letters.forEach((L, slot) => {
      L.angleIndex = idxs[slot];
      const ang = this._wheel.angles[L.angleIndex];
      const x = Math.cos(ang) * rad, y = Math.sin(ang) * rad;
      L.sprite.setPosition(x, y);
      L.text.setPosition(x, y);
    });
  }


  // ----------------------------------------------------------------
  // UI
  // ----------------------------------------------------------------
  _createCurrentWordStrip() {
    const cfg = this.registry.get('cfg') || {};
    const G = cfg.gameplay || {};
    this._currentWordText = this.add.text(0, 0, '', {
      fontFamily: (cfg.font?.family || 'Outfit, Arial'),
      fontSize: `${G.currentWordSize ?? 64}px`,
      color: '#ffffff',
      stroke: '#1a2b4d',
      strokeThickness: 6
    }).setOrigin(0.5);
    this._currentWordText.setShadow(0, 3, '#0b1222', 6, true, true);
  }

  _createHUD() {
    const cfg = this.registry.get('cfg') || {};
    const texts = cfg.texts || {};
    const scoreLabel = texts.score_label || 'Score:';

    this._scoreText = this.add.text(30, 24, `${scoreLabel} 0`, {
      fontFamily: (cfg.font?.family || 'Outfit, Arial'),
      fontSize: '42px',
      color: '#ffffff',
      stroke: '#0f1a2e',
      strokeThickness: 5
    }).setOrigin(0, 0.5);
    this._scoreText.setShadow(0, 2, '#0b1222', 4, true, true);

    this._progressText = this.add.text(30, 74, `Found 0 / ${this._targetsAll.length}`, {
      fontFamily: (cfg.font?.family || 'Outfit, Arial'),
      fontSize: '30px',
      color: '#e6edff',
      stroke: '#0f1a2e',
      strokeThickness: 4
    }).setOrigin(0, 0.5);
    this._progressText.setShadow(0, 2, '#0b1222', 4, true, true);

    this._timerText = this.add.text(this.scale.width - 30, 24, '', {
      fontFamily: (cfg.font?.family || 'Outfit, Arial'),
      fontSize: '42px',
      color: '#ffffff',
      align: 'right',
      stroke: '#0f1a2e',
      strokeThickness: 5
    }).setOrigin(1, 0.5);
    this._timerText.setShadow(0, 2, '#0b1222', 4, true, true);

    this._updateTimerText();
  }

  _createMobileButtons() {
    this._btnShuffle = this._spawnButton('left', 160, this.scale.height - 100, () => this._shuffleWheel());
    this._btnClear = this._spawnButton('right', 490, this.scale.height - 100, () => this._clearCurrentWord());
    this._btnSubmit = this._spawnButton('action', this.scale.width - 160, this.scale.height - 100, () => this._submitCurrentWord());
  }

  _spawnButton(key, x, y, onClick) {
    const actualKey = this.textures.exists(key) ? key : 'btn_circle';
    const sp = this.add.sprite(x, y, actualKey).setInteractive({ useHandCursor: true });
    sp.setDisplaySize(128, 128);
    this.physics.add.existing(sp);
    sp.body.setImmovable(true);
    sp.body.setAllowGravity(false);
    sp.body.setSize(sp.displayWidth, sp.displayHeight);
    if (actualKey === 'btn_circle' && key === 'left' && this.textures.exists('icon_shuffle')) {
      const ico = this.add.image(x, y, 'icon_shuffle').setDisplaySize(54, 54);
      sp.on('destroy', () => ico.destroy());
    }
    sp.on('pointerdown', () => { sp.setScale(0.92); sp.setAlpha(0.85); onClick(); });
    sp.on('pointerup', () => { sp.setScale(1); sp.setAlpha(1); });
    sp.on('pointerout', () => { sp.setScale(1); sp.setAlpha(1); });
    return sp;
  }

  _setupKeyboard() {
    this.input.keyboard.on('keydown-ENTER', () => this._submitCurrentWord());
    this.input.keyboard.on('keydown-BACKSPACE', () => this._clearCurrentWord());
    this.input.keyboard.on('keydown-SPACE', () => this._shuffleWheel());
  }

  // ----------------------------------------------------------------
  // LAYOUT
  // ----------------------------------------------------------------
  _layout() {
    const cfg = this.registry.get('cfg') || {};
    const G = cfg.gameplay || {};
    const W = this.scale.width, H = this.scale.height;

    // Grid left-center
    const cellW = (G.gridCellW ?? 92), cellH = (G.gridCellH ?? 92);
    const gap = (G.gridGap ?? 10); // << new configurable gap

    const gridW = this._grid.cols * cellW + (this._grid.cols - 1) * gap;
    const gridH = this._grid.rows * cellH + (this._grid.rows - 1) * gap;
    const gx = Math.max(60, (W * 0.55 - gridW) / 2);
    const gy = Math.max(120, (H - gridH) / 2 - 20);

    for (let r = 0; r < this._grid.rows; r++) {
      for (let c = 0; c < this._grid.cols; c++) {
        const tile = this._grid.sprites[r][c];
        const lt = this._grid.letterTexts[r][c];
        if (!tile) continue;

        const x = gx + c * (cellW + gap) + cellW / 2;
        const y = gy + r * (cellH + gap) + cellH / 2;

        tile.setPosition(x, y);
        tile.setDisplaySize(cellW, cellH);
        tile.body.setSize(cellW, cellH);
        if (lt) lt.setPosition(x, y);
      }
    }


    // Wheel on right
    const wx = W * 0.77;
    const wy = H * 0.58;
    this._wheel.group.setPosition(wx, wy);

    // Current word under grid
    this._currentWordText?.setPosition(W * 0.30, gy + gridH + 48);

    // Buttons
    if (this._btnShuffle) this._btnShuffle.setPosition(160, H - 100);
    if (this._btnClear) this._btnClear.setPosition(490, H - 100);
    if (this._btnSubmit) this._btnSubmit.setPosition(W - 160, H - 100);

    this._timerText?.setPosition(W - 30, 24);
  }

  // ----------------------------------------------------------------
  // GAME LOGIC + HARDER RULES
  // ----------------------------------------------------------------
  _clearCurrentWord() {
    if (this._finished) return;
    this._wheel.letters.forEach(L => L.sprite.clearTint());
    this._currentWord = [];
    this._updateCurrentWordText();
  }

  _revealLetterAt(r, c, ch) {
    const tile = this._grid.sprites[r][c];
    const lt = this._grid.letterTexts[r][c];
    if (!tile || !lt) return;

    if (tile.getData('filled')) return; // already revealed by a previous word

    // Flip animation
    this.tweens.add({
      targets: [tile, lt],
      scaleY: 0.05,
      duration: 90,
      yoyo: false,
      onComplete: () => {
        lt.setText(ch);
        lt.setColor(this.COLORS.letterFilled);
        tile.setTintFill(this.COLORS.filledBg);          // purple chip look
        tile.setData('filled', true);
        this.tweens.add({ targets: [tile, lt], scaleY: 1, duration: 90, yoyo: false });
      }
    });
  }


  _submitCurrentWord() {
    if (this._finished) return;
    if (!this._currentWord.length) return;

    const cfg = this.registry.get('cfg') || {};
    const G = cfg.gameplay || {};
    const wrongScore = G.wrongPenaltyScore ?? 3;
    const wrongTime = G.wrongPenaltyTime ?? 5;

    const upper = this._currentWord.map(x => x.ch).join('').toUpperCase();

    // reset
    this._wheel.letters.forEach(L => L.sprite.clearTint());
    this._currentWord = [];
    this._updateCurrentWordText();

    if (this._targets.has(upper)) {
      // Place letters
      const coords = this._targetPlacements[upper];
      if (coords && coords.length) {
        for (let i = 0; i < coords.length; i++) {
          const { r, c } = coords[i];
          this._revealLetterAt(r, c, upper[i]);
        }
      }

      // scoring (harder bonus on longer words)
      this._streak += 1;
      const base = (G.pointsPerWord ?? 10);
      const lenBonus = Math.max(0, upper.length - 3); // +1 per char beyond 3
      const streakBonus = (this._streak >= (G.streakBonusAfter ?? 2)) ? (G.streakBonusPoints ?? 5) : 0;
      this._score += base + lenBonus + streakBonus;

      if (this.cache.audio.exists('collect')) this.sound.play('collect', { volume: (G.sfxVolume ?? 0.8) });

      this._targets.delete(upper);
      this._found.add(upper);
      this._updateHUD();

      // Dynamic difficulty: every N correct words cut time & auto-shuffle
      const N = (G.diffEveryFound ?? 2);
      const cut = (G.diffTimeCut ?? 5);
      if (this._found.size > 0 && this._found.size % N === 0) {
        if (this._timeLeft > 0) this._timeLeft = Math.max(0, this._timeLeft - cut);
        this._shuffleWheel();
        this._updateTimerText();
      }

      if (this._targets.size === 0) this._onWin();
    } else {
      // HARDER: wrong guess penalizes score and time
      this._streak = 0;
      this._score = Math.max(0, this._score - wrongScore);
      if (this._timeLeft > 0) this._timeLeft = Math.max(0, this._timeLeft - wrongTime);
      this._updateHUD(); this._updateTimerText();

      this._shakeGrid();
      if (this.cache.audio.exists('hit')) this.sound.play('hit', { volume: (G.sfxVolume ?? 0.8) });

      if (this._timeLeft <= 0) this._onLose();
    }
  }

  _shakeGrid() {
    const cam = this.cameras.main;
    this.tweens.add({
      targets: cam, x: { from: -5, to: 5 }, duration: 40, repeat: 6, yoyo: true,
      onComplete: () => cam.setPosition(0, 0)
    });
  }

  _updateCurrentWordText() {
    if (!this._currentWordText) return;
    const s = this._currentWord.map(x => x.ch).join('');
    this._currentWordText.setText(s);
  }

  _updateHUD() {
    const cfg = this.registry.get('cfg') || {};
    const scoreLabel = (cfg.texts?.score_label) || 'Score:';
    this._scoreText?.setText(`${scoreLabel} ${this._score}`);
    this._progressText?.setText(`Found ${this._found.size} / ${this._targetsAll.length}`);
  }

  _updateTimerText() {
    if (!this._timerText) return;
    if (this._timeLeft <= 0) { this._timerText.setText(''); return; }
    const m = Math.floor(this._timeLeft / 60).toString().padStart(2, '0');
    const s = Math.floor(this._timeLeft % 60).toString().padStart(2, '0');
    this._timerText.setText(`${m}:${s}`);
  }

  _onWin() {
    if (this._finished) return;
    this._finished = true;
    if (this.cache.audio.exists('level_complete')) this.sound.play('level_complete', { volume: 0.9 });
    this._bgm?.stop();

    const payload = { score: this._score, timeLeft: this._timeLeft, words: [...this._found] };
    // fire an event for anyone listening (optional)
    this.events.emit('win', payload);
    // go to WinScene (handled elsewhere)
    this.scene.start('WinScene', payload);
  }

  _onLose() {
    if (this._finished) return;
    this._finished = true;
    if (this.cache.audio.exists('game_over')) this.sound.play('game_over', { volume: 0.9 });
    this._bgm?.stop();

    const payload = { score: this._score, words: [...this._found] };
    this.events.emit('lose', payload);
    this.scene.start('GameOverScene', payload);
  }

}
