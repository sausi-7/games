class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');

    // Core state
    this.cfg = null;
    this.board = null;            // {rows, cols, cell, offsetX, offsetY}
    this.level = null;            // level data from cfg.gameplay.levels[0]
    this.colors = null;           // color->hex map
    this.pairs = null;            // [{id,color,a:{r,c},b:{r,c}}...]
    this.paths = {};              // color -> array of {r,c}
    this.locked = {};

    this._ended = false;          // cells occupied by finalized paths (by color), key: "r,c" -> color

    // Input/UX
    this.dragging = false;
    this.activeColor = null;      // color string currently drawing
    this.activePath = [];         // temp path while dragging
    this.lastCell = null;

    // Gfx layers
    this.gfxTiles = null;         // board tiles rectangles
    this.gfxPipes = null;         // pipes per color (Graphics)
    this.gfxNodes = null;         // colored endpoint circles
    this.gfxHover = null;         // hover highlight cell (not used visually)

    // UI (gameplay-only)
    this.scoreText = null;
    this.timerText = null;

    this.timeLeft = 0;
    this.score = 0;
    this.requireFullFill = false; // can be enabled in cfg

    // Audio
    this.sfx = {};
    this.bgm = null;

    // bindings
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
  }

  preload() {
    // Config provided by Boot scene via registry
    this.cfg = this.registry.get('cfg') || {};
    // ADD in preload(), near the end, before this.preload() returns
    this.colorTexKeys = {}; // color -> texture key

    const colors = (this.cfg.gameplay?.levels?.[0]?.colors) || {};
    Object.keys(colors).forEach(color => {
      const fromCfg = this.cfg.images1?.[color];    // e.g. "red": "assets/red.png"
      const url = fromCfg || `assets/${color}.png`; // fallback guess
      const key = `colortex_${color}`;
      this.load.image(key, url);
      this.colorTexKeys[color] = key;
    });



    // Load only library audio (no image assets needed for board; nodes/pipes use Graphics)
    const aud = this.cfg.audio || {};
    if (aud.bgm) this.load.audio('bgm', aud.bgm);
    if (aud.collect) this.load.audio('collect', aud.collect);            // pipe completed
    if (aud.hit) this.load.audio('hit', aud.hit);                        // invalid move
    if (aud.Level_Complete || aud.level_complete) {
      this.load.audio('levelComplete', aud.Level_Complete || aud.level_complete);
    }
    if (aud.Game_Over || aud.game_over) {
      this.load.audio('gameOver', aud.Game_Over || aud.game_over);
    }

    // Mandatory UI images for other scenes (not used here but preloaded in Boot usually).
    const imgs = this.cfg.images2 || {};
    Object.entries(imgs).forEach(([k, v]) => {
      if (typeof v === 'string' && v.endsWith('.png')) this.load.image(k, v);
    });

    // Optional font
    // if (this.cfg.font?.url) this.load.ttf('gamefont', this.cfg.font.url);
  }

  create() {
    this._ended = false;          // the key fix: allow _endLevel to run again
    this.input.enabled = true;    // re-enable input in case prior run disabled it
    this.dragging = false;
    this.activeColor = null;
    this.activePath = [];
    this.lastCell = null;

    this.score = 0;        // <— reset score so it doesn't carry over
    this.timeLeft = 0;

    const sys = this.sys;
    const cam = sys.cameras.main;
    const W = cam.width;
    const H = cam.height;

    // --- Background ---
    if (this.textures.exists('background')) {
      const bg = this.add.image(W / 2, H / 2, 'background')
        .setOrigin(0.5)
        .setDepth(-1000) // ensure behind everything
        .setScrollFactor(0);

      // Scale to cover screen (maintaining aspect ratio)
      const src = this.textures.get('background').getSourceImage();
      // const scale = Math.max(W / src.width, H / src.height);
      // bg.setScale(scale);

      // Store ref for orientation handling
      this._background = bg;

      // Resize handler (optional)
      // this.scale.on('resize', (gameSize) => {
      //   const { width, height } = gameSize;
      //   bg.setPosition(width / 2, height / 2);
      //   const newScale = Math.max(width / src.width, height / src.height);
      //   bg.setScale(newScale);
      // });
    }

    // --- Particle setup (1px white circle -> 'dot') ---
    const pg = this.add.graphics();
    pg.fillStyle(0xffffff, 1);
    pg.fillCircle(8, 8, 8);
    pg.generateTexture('dot', 16, 16);
    pg.destroy();

    // Phaser 3.60+: ParticleEmitter is a Game Object
    this.fxEmitter = this.add.particles(0, 0, 'dot', {
      lifespan: 550,
      speed: { min: 60, max: 160 },
      quantity: 12,
      angle: { min: 0, max: 360 },
      scale: { start: 0.7, end: 0 },
      alpha: { start: 0.9, end: 0 },
      gravityY: 200,
      blendMode: 'ADD',
      emitting: false // do not auto-emit; we'll use explode()
    }).setDepth(999);




    // Gameplay data
    this.level = (this.cfg.gameplay?.levels || [])[0] || {};
    this.colors = this.level.colors || {
      red: '#ef4444', blue: '#3b82f6', green: '#22c55e',
      yellow: '#eab308', purple: '#a855f7', orange: '#f97316',
      cyan: '#06b6d4'
    };
    const rows = this.level.rows || 8;
    const cols = this.level.cols || 8;

    // Win rule toggle (fixes "impossible" layouts by default)
    const levelStrict = this.level.requireFullFill;
    const globalStrict = this.cfg.gameplay?.requireFullFill;
    this.requireFullFill = (levelStrict !== undefined) ? !!levelStrict : !!globalStrict;

    // If level provides its own timer, prefer it
    if (typeof this.level.timerSeconds === 'number') {
      this.timeLeft = this.level.timerSeconds;
    }

    // Board sizing (portrait/landscape aware)
    const pad = Math.floor(Math.min(W, H) * 0.06);
    const usableW = W - pad * 2;
    const usableH = H - pad * 2;
    const cell = Math.floor(Math.min(usableW / cols, usableH / rows));
    const boardW = cell * cols;
    const boardH = cell * rows;
    const offsetX = Math.floor((W - boardW) / 2);
    const offsetY = Math.floor((H - boardH) / 2);

    this.board = { rows, cols, cell, offsetX, offsetY };

    // Graphics layers
    this.gfxTiles = this.add.graphics();
    this.gfxPipes = this.add.graphics();
    this.gfxNodes = this.add.graphics();
    this.gfxHover = this.add.graphics();

    this.pipeLayer = this.add.layer(); // for image pipes (beneath nodes)
    this.nodeLayer = this.add.layer(); // for image nodes (above pipes)

    this.useImagePipes = false; // <- do NOT draw images on the line


    // helpers to check if a texture exists for a color
    this._hasTex = (color) => {
      const key = this.colorTexKeys?.[color];
      return !!key && this.textures.exists(key);
    };
    this._texKey = (color) => this.colorTexKeys[color];

    // Build tiled background (rounded rectangles, subtle checker)
    this._drawTiles();

    // Parse pairs
    this.pairs = (this.level.pairs || []).map((p, idx) => ({
      id: idx,
      color: p.color,
      a: { r: p.a[0], c: p.a[1] },
      b: { r: p.b[0], c: p.b[1] }
    }));

    // Initialize paths/locks
    Object.keys(this.colors).forEach(color => {
      this.paths[color] = [];
    });
    this.locked = {}; // key "r,c" -> color

    // Draw endpoints as circles
    this._drawNodes();

    // Timer & Score (gameplay-only UI)
    if (!this.timeLeft && (this.cfg.gameplay?.timerSeconds ?? 0) > 0) {
      this.timeLeft = this.cfg.gameplay.timerSeconds;
    } // optional timer
    this.scoreText = this._makeFancyText(
      offsetX, offsetY - Math.max(28, Math.floor(this.board.cell * 0.45)),
      `${this.cfg.texts?.score_label || 'Score:'} 0`, 0, 1
    );
    this.timerText = this._makeFancyText(
      offsetX + boardW, offsetY - Math.max(28, Math.floor(this.board.cell * 0.45)),
      this.timeLeft > 0 ? `Time: ${this.timeLeft}` : '', 1, 1
    );


    // Input
    this.input.on('pointerdown', this._onPointerDown);
    this.input.on('pointermove', this._onPointerMove);
    this.input.on('pointerup', this._onPointerUp);

    // Audio
    if (this.sound.get('bgm')) this.sound.get('bgm').stop();
    if (this.cache.audio.exists('bgm')) {
      this.bgm = this.sound.add('bgm', { loop: true, volume: 0.45 });
      this.bgm.play();
    }

    // Optional countdown
    if (this.timeLeft > 0) {
      this.time.addEvent({
        delay: 1000,
        loop: true,
        callback: () => {
          this.timeLeft--;
          if (this.timerText) this.timerText.setText(`Time: ${this.timeLeft}`);
          if (this.timeLeft <= 0) {
            this._onLose();
          }
        }
      });
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.off('pointerdown', this._onPointerDown);
      this.input.off('pointermove', this._onPointerMove);
      this.input.off('pointerup', this._onPointerUp);
      if (this.fxEmitter && this.fxEmitter.destroy) this.fxEmitter.destroy();
    });


  }

  update() {
    // Nothing heavy per-frame; drawing occurs on events
  }

  // ===== Drawing =====
  _drawTiles() {
    const { rows, cols, cell, offsetX, offsetY } = this.board;
    const g = this.gfxTiles;
    g.clear();

    const base = 0x0f172a; // slate-900
    const alt = 0x111827; // gray-900
    const stroke = 0x1f2937; // gray-8 00

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = offsetX + c * cell;
        const y = offsetY + r * cell;
        const fill = ((r + c) % 2 === 0) ? base : alt;
        g.lineStyle(2, stroke, 0.7);
        g.fillStyle(fill, 1);
        g.fillRoundedRect(x + 2, y + 2, cell - 4, cell - 4, Math.min(10, Math.floor(cell * 0.15)));
        g.strokeRoundedRect(x + 2, y + 2, cell - 4, cell - 4, Math.min(10, Math.floor(cell * 0.15)));
      }
    }
  }

  _drawNodes() {
    const g = this.gfxNodes;
    g.clear();
    this.nodeLayer.removeAll(true);

    const { cell } = this.board;

    this.pairs.forEach(p => {
      const colHex = Phaser.Display.Color.HexStringToColor(this.colors[p.color]).color;
      [p.a, p.b].forEach(end => {
        const { x, y } = this._cellToXY(end.r, end.c);
        const radius = Math.floor(cell * 0.28);

        if (this._hasTex(p.color)) {
          const key = this._texKey(p.color);
          const img = this.add.image(x, y, key)
            .setDisplaySize(radius * 2, radius * 2)
            .setDepth(3);
          this.nodeLayer.add(img);

          // optional white ring
          g.lineStyle(3, 0xffffff, 0.95);
          g.strokeCircle(x, y, radius);
        } else {
          // fallback: solid color circle
          g.fillStyle(colHex, 1);
          g.lineStyle(3, 0xffffff, 0.95);
          g.fillCircle(x, y, radius);
          g.strokeCircle(x, y, radius);
        }
      });
    });

    // keep pipes beneath nodes
    this._redrawPipes();
  }


  _redrawPipes() {
    const g = this.gfxPipes;
    g.clear();
    this.pipeLayer.removeAll(true); // clear any old images, just in case

    const { cell } = this.board;

    Object.keys(this.paths).forEach(color => {
      const path = this.paths[color];
      if (!path || path.length <= 1) return;

      const colHex = Phaser.Display.Color.HexStringToColor(this.colors[color]).color;
      const thicknessImg = Math.max(8, Math.floor(cell * 0.30));
      const thicknessLine = Math.max(6, Math.floor(cell * 0.24));

      // *** Always draw only strokes (no image segments) ***
      // Glow (soft under-stroke)
      g.save();
      g.setBlendMode(Phaser.BlendModes.ADD);
      g.lineStyle(thicknessImg + Math.floor(thicknessImg * 0.6), colHex, 0.18);
      g.beginPath();
      path.forEach((pt, i) => {
        const { x, y } = this._cellToXY(pt.r, pt.c);
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      });
      g.strokePath();
      g.restore();

      // Main colored line
      g.lineStyle(thicknessLine, colHex, 0.95);
      g.beginPath();
      path.forEach((pt, i) => {
        const { x, y } = this._cellToXY(pt.r, pt.c);
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      });
      g.strokePath();
    });
  }





  // ===== Input handlers =====
  _onPointerDown(pointer) {
    const cell = this._xyToCell(pointer.x, pointer.y);
    if (!cell) return;

    // Determine which color we're interacting with
    const epColor = this._endpointColorAt(cell);
    const pipeColor = this._pathColorAt(cell);
    const colorAtCell = epColor || pipeColor;
    if (!colorAtCell) return;

    this.dragging = true;
    this.activeColor = colorAtCell;

    // If this color had locked cells (completed earlier), unlock them so we can edit
    this._unlockColor(this.activeColor);

    // If we tapped on an existing path but not its tail, trim back to that cell; otherwise start fresh
    if (this.paths[this.activeColor]?.length) {
      const idx = this._indexOfInPath(this.paths[this.activeColor], cell);
      if (idx >= 0) {
        this.paths[this.activeColor] = this.paths[this.activeColor].slice(0, idx + 1);
      } else {
        this.paths[this.activeColor] = [cell];
      }
    } else {
      this.paths[this.activeColor] = [cell];
    }

    this.activePath = this.paths[this.activeColor].slice();
    this.lastCell = cell;

    this._redrawPipes();
  }

  _onPointerMove(pointer) {
    if (!this.dragging || !this.activeColor) return;

    const target = this._xyToCell(pointer.x, pointer.y);
    if (!target) return;

    const last = this.lastCell;
    if (!last) return;

    // Walk cell-by-cell towards target (handles fast drags)
    let curr = { r: last.r, c: last.c };
    const steps = 40; // safety to avoid infinite loops
    let guard = 0;

    while ((curr.r !== target.r || curr.c !== target.c) && guard++ < steps) {
      const dr = target.r - curr.r;
      const dc = target.c - curr.c;
      // Move 1 cell orthogonally toward target (prefer the axis with greater distance)
      let next;
      if (Math.abs(dr) >= Math.abs(dc)) next = { r: curr.r + Math.sign(dr), c: curr.c };
      else next = { r: curr.r, c: curr.c + Math.sign(dc) };

      if (!this._tryStepTo(next)) break; // stop if blocked
      curr = next;
    }
    this._drawHover(target);

  }

  _onPointerUp() {
    if (!this.dragging) return;
    this.dragging = false;

    const color = this.activeColor;
    const path = this.paths[color] || [];
    const endHit = path.length > 0 ? this._endpointMatch(color, path[path.length - 1]) : false;

    if (endHit) {
      // Lock all cells of this path for this color (including endpoints)
      path.forEach(pt => { this.locked[`${pt.r},${pt.c}`] = color; });
      this._ding();

      // Win check (full fill optional)
      const connected = this._allPairsConnected();
      const filled = this._allCellsFilled();
      if (connected && (!this.requireFullFill || filled)) {
        this._onWin();
      }
    } else {
      // Not completed: keep partial path but do not lock cells yet
      const last = path[path.length - 1];
      const epColor = last ? this._endpointColorAt(last) : null;
      if (epColor && epColor !== color) {
        this.paths[color] = path.slice(0, -1);
        this._redrawPipes();
        this._blip();
      }
    }

    this.activeColor = null;
    this.activePath = [];
    this.lastCell = null;

    if (this.gfxHover) this.gfxHover.clear();

  }

  // ===== Movement / Rules core =====
  _tryStepTo(cell) {
    // Bounds check
    if (!cell) return false;
    const { rows, cols } = this.board;
    if (cell.r < 0 || cell.r >= rows || cell.c < 0 || cell.c >= cols) return false;

    const key = `${cell.r},${cell.c}`;

    // 1) Block entering a locked cell of another color
    if (this.locked[key] && this.locked[key] !== this.activeColor) {
      this._blip();
      return false;
    }

    // 2) Block entering another color's endpoint
    const epColor = this._endpointColorAt(cell);
    if (epColor && epColor !== this.activeColor) {
      this._blip();
      return false;
    }
    // (Entering your own endpoint is allowed — completion will be checked on pointer up)

    // 3) Block crossing another color's current path
    const pathColorHere = this._pathColorAt(cell);
    if (pathColorHere && pathColorHere !== this.activeColor) {
      this._blip();
      return false;
    }

    // 4) If stepping back onto our own path (backtrack), trim to that index
    const idx = this._indexOfInPath(this.activePath, cell);
    if (idx >= 0) {
      this.activePath = this.activePath.slice(0, idx + 1);
    } else {
      this.activePath.push(cell);
    }

    // Persist and redraw
    this.paths[this.activeColor] = this.activePath.slice();
    this.lastCell = cell;
    this._redrawPipes();
    return true;
  }

  // ===== Helpers =====
  _unlockColor(color) {
    // Remove locked marks for this color so player can reroute
    Object.keys(this.locked).forEach(k => {
      if (this.locked[k] === color) delete this.locked[k];
    });
  }

  _cellToXY(r, c) {
    const { cell, offsetX, offsetY } = this.board;
    const x = offsetX + c * cell + cell / 2;
    const y = offsetY + r * cell + cell / 2;
    return { x, y };
  }

  _xyToCell(x, y) {
    const { rows, cols, cell, offsetX, offsetY } = this.board;
    if (x < offsetX || y < offsetY) return null;
    const c = Math.floor((x - offsetX) / cell);
    const r = Math.floor((y - offsetY) / cell);
    if (r < 0 || r >= rows || c < 0 || c >= cols) return null;
    return { r, c };
  }

  _endpointColorAt(cell) {
    for (const p of this.pairs) {
      if ((p.a.r === cell.r && p.a.c === cell.c) || (p.b.r === cell.r && p.b.c === cell.c)) {
        return p.color;
      }
    }
    return null;
  }

  _endpointMatch(color, cell) {
    const p = this.pairs.find(pp => pp.color === color);
    if (!p) return false;
    return (p.b.r === cell.r && p.b.c === cell.c) || (p.a.r === cell.r && p.a.c === cell.c);
  }

  _pathColorAt(cell) {
    for (const [color, path] of Object.entries(this.paths)) {
      if (this._indexOfInPath(path, cell) >= 0) return color;
    }
    return null;
  }

  _indexOfInPath(path, cell) {
    if (!path) return -1;
    return path.findIndex(pt => pt.r === cell.r && pt.c === cell.c);
  }

  _allPairsConnected() {
    // each color path must connect its two endpoints (start and end are actual endpoints)
    return this.pairs.every(p => {
      const path = this.paths[p.color] || [];
      if (path.length < 2) return false;
      const s = path[0];
      const e = path[path.length - 1];
      const isStartEndpoint = (s.r === p.a.r && s.c === p.a.c) || (s.r === p.b.r && s.c === p.b.c);
      const isEndEndpoint = (e.r === p.a.r && e.c === p.a.c) || (e.r === p.b.r && e.c === p.b.c);
      return isStartEndpoint && isEndEndpoint;
    });
  }

  _allCellsFilled() {
    // strict rule: every cell must be locked by some completed path
    const { rows, cols } = this.board;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const key = `${r},${c}`;
        if (!this.locked[key]) return false;
      }
    }
    return true;
  }

  // ===== Feedback / Win-Lose =====
  _ding() {
    if (this.cache.audio.exists('collect')) this.sound.play('collect', { volume: 0.8 });

    // Score bump
    this.score += 100;
    if (this.scoreText) {
      this.scoreText.setText(`${this.cfg.texts?.score_label || 'Score:'} ${this.score}`);
      this.tweens.add({
        targets: this.scoreText, scaleX: 1.12, scaleY: 1.12,
        yoyo: true, duration: 120, ease: 'Back.Out'
      });
    }

    // Confetti at latest completed endpoint
    const color = this.activeColor;
    const path = this.paths[color] || [];
    const last = path[path.length - 1];
    if (last && this.fxEmitter) {
      const { x, y } = this._cellToXY(last.r, last.c);
      this.fxEmitter.explode(16, x, y);
    }
  }


  _blip() {
    if (this.cache.audio.exists('hit')) this.sound.play('hit', { volume: 0.6 });
    this.cameras.main.shake(90, 0.003);
    // quick tiles flash
    this.tweens.add({
      targets: this.gfxTiles, alpha: 0.6,
      yoyo: true, duration: 80, ease: 'Quad.easeOut'
    });
  }


  // --- Text / UI helpers ---
  _makeFancyText(x, y, initial, originX = 0, originY = 1) {
    const fontFamily = this.cfg.font?.family || 'Arial';
    const t = this.add.text(x, y, initial, {
      fontFamily,
      fontSize: Math.max(20, Math.floor(this.sys.cameras.main.height * 0.022)),
      color: '#ffffff',
      stroke: '#0ea5e9',      // cyan stroke
      strokeThickness: 4,
      shadow: { color: '#000000', blur: 8, offsetX: 0, offsetY: 2, fill: true }
    }).setOrigin(originX, originY);

    // gentle idle pulsing for premium feel
    this.tweens.add({
      targets: t,
      scaleX: 1.02, scaleY: 1.02,
      duration: 1500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
    });

    return t;
  }

  // --- Hover highlight ---
  _drawHover(cell) {
    const g = this.gfxHover;
    g.clear();
    if (!cell) return;
    const { cell: cs, offsetX, offsetY } = this.board;
    const x = offsetX + cell.c * cs + 2;
    const y = offsetY + cell.r * cs + 2;
    const w = cs - 4, h = cs - 4;

    const pulse = 0.15 + 0.15 * Math.sin(this.time.now / 120);
    g.lineStyle(4, 0x38bdf8, 0.9); // sky-400
    g.fillStyle(0x38bdf8, 0.08 + pulse);
    g.strokeRoundedRect(x, y, w, h, Math.min(10, Math.floor(cs * 0.15)));
    g.fillRoundedRect(x, y, w, h, Math.min(10, Math.floor(cs * 0.15)));
  }

  // --- Scale to cover ---
  _fitCover(displayObj, texW, texH, W, H) {
    const s = Math.max(W / texW, H / texH);
    displayObj.setScale(s);
  }


  _onWin() {
    if (this.cache.audio.exists('levelComplete')) this.sound.play('levelComplete', { volume: 1.0 });

    const cam = this.cameras.main;

    // Burst confetti mid-screen
    if (this.fxEmitter) this.fxEmitter.explode(36, cam.centerX, cam.centerY);

    // Pipes shimmer + slight zoom
    this.tweens.add({
      targets: this.gfxPipes,
      alpha: 0.25,
      yoyo: true,
      duration: 120,
      repeat: 5,
      onStart: () => {
        this.tweens.add({ targets: cam, zoom: 1.03, duration: 300, yoyo: true, ease: 'Sine.easeInOut' });
      },
      onComplete: () => {
        this._endLevel('WinScene', { reason: 'win' });
      }
    });
  }



  _onLose() {
    if (this.cache.audio.exists('gameOver')) this.sound.play('gameOver', { volume: 1.0 });
    this._endLevel('GameOverScene', { reason: 'timeout' });
  }

  _endLevel(targetScene, extra = {}) {
    if (this._ended) return;
    this._ended = true;

    // Disable input immediately
    this.input.off('pointerdown', this._onPointerDown);
    this.input.off('pointermove', this._onPointerMove);
    this.input.off('pointerup', this._onPointerUp);
    this.input.enabled = false;

    // Fade out BGM nicely
    if (this.bgm && this.bgm.isPlaying) {
      this.tweens.add({
        targets: this.bgm,
        volume: 0,
        duration: 250,
        onComplete: () => this.bgm.stop()
      });
    }

    const cam = this.sys.cameras.main;
    const payload = {
      score: this.score,
      timeLeft: this.timeLeft,
      rows: this.board?.rows,
      cols: this.board?.cols,
      requireFullFill: this.requireFullFill,
      // you can add more:
      // paths: this.paths,
      ...extra
    };

    // Nice camera fade then switch
    cam.fadeOut(280, 0, 0, 0);
    cam.once('camerafadeoutcomplete', () => {
      this.scene.start(targetScene, payload);
    });
  }

}
