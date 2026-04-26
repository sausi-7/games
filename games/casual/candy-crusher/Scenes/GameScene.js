class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');

    // Board / layout
    this.GRID_W = 7;
    this.GRID_H = 7;
    this.CELL = 100;
    this.CANDY_SIZE = 92;
    this.PAD_X = 180;
    this.PAD_Y = 600;

    // State
    this.board = null;
    this.sprites = null;
    this.selected = null;
    this.inputBlocked = false;

    // Gameplay
    this.score = 0;
    this.timeLeft = 60;
    this.targetScore = 100;

    // Config references
    this.cfg = null;
    this.colors = [];
    this.allowUnbreakable = false;
    this.hintAfter = 5;
    this.lastInteractionAt = 0;
    this.hintFx = null;

    // Audio
    this.sfx = {};
    this.bgm = null;

    // Background refs
    this._bg = null;

    // Score target helper (computed in create)
    this._scoreTarget = null;

    this._onShutdown = this._onShutdown.bind(this);

    // Score target helper (computed in create)
    this._scoreTarget = null;
    this.targetText = null;   // <— add this
    this.hasEnded = false;



  }

  preload() {
    this.cfg = this.registry.get('cfg') || {};
    const images = (this.cfg.images || {});
    const audio = (this.cfg.audio || {});

    Object.entries(images).forEach(([key, url]) => this.load.image(key, url));
    Object.entries(audio).forEach(([key, url]) => this.load.audio(key, url));

    this._ensureFallbackTextures();
  }

  _ensureFallbackTextures() {
    if (!this.textures.exists('fallback_tile')) {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      g.fillStyle(0x224155, 1);
      g.fillRect(0, 0, this.CELL, this.CELL);
      g.lineStyle(2, 0x2e6a89, 1);
      g.strokeRect(1, 1, this.CELL - 2, this.CELL - 2);
      g.generateTexture('fallback_tile', this.CELL, this.CELL);
      g.destroy();
    }
    if (!this.textures.exists('fallback_bg')) {
      const W = Math.max(1, Math.floor(this.sys.game.config.width || 1080));
      const H = Math.max(1, Math.floor(this.sys.game.config.height || 1920));
      const g2 = this.make.graphics({ x: 0, y: 0, add: false });
      g2.fillStyle(0x0d1b24, 1);
      g2.fillRect(0, 0, W, H);
      g2.generateTexture('fallback_bg', W, H);
      g2.destroy();
    }
    if (!this.textures.exists('spark')) {
      const g3 = this.make.graphics({ x: 0, y: 0, add: false });
      const R = 8;
      g3.fillStyle(0xffffff, 1);
      g3.fillCircle(R, R, R);
      g3.generateTexture('spark', R * 2, R * 2);
      g3.destroy();
    }
  }

  _computeLayout() {
    const cam = this.sys.cameras.main;
    const W = cam.width;
    const H = cam.height;

    const TOP_HUD = 96;
    const MARGIN_X = 10;
    const MARGIN_B = 10;

    const availW = W - MARGIN_X * 2;
    const availH = H - TOP_HUD - MARGIN_B;

    const cellW = Math.floor(availW / this.GRID_W);
    const cellH = Math.floor(availH / this.GRID_H);
    const cell = Math.max(60, Math.min(cellW, cellH));

    this.CELL = cell;
    this.CANDY_SIZE = Math.floor(cell * 0.92);

    const boardW = this.GRID_W * this.CELL;
    const boardH = this.GRID_H * this.CELL;

    this.PAD_X = Math.floor((W - boardW) / 2);
    this.PAD_Y = Math.floor(TOP_HUD + (H - TOP_HUD - boardH) / 2);
  }

  create() {
    this.inputBlocked = false;
    this.selected = null;
    if (this.hintFx?.stop) this.hintFx.stop();
    this.hintFx = null;

    this.input.removeAllListeners();
    this.tweens?.killAll?.();
    this.time?.removeAllEvents?.();

    const gp = this.cfg.gameplay || {};
    this.timeLeft = gp.timerSeconds ?? 60;
    this.targetScore = gp.targetScore ?? 100;
    this.hintAfter = gp.hintAfterSeconds ?? 5;
    this.allowUnbreakable = !!gp.allowUnbreakable;

    this.hasEnded = false;


    this.colors = (gp.candyKeys || ['object1', 'object2', 'object3', 'object4', 'object5'])
      .map((k, i) => ({ key: k, id: i }));

    this._computeLayout();
    this._addGameBackground();

    this.mainLayer = this.add.container(0, 0).setDepth(1).setAlpha(0);
    this.sprites = this.add.group();
    this.mainLayer.add(this.sprites.getChildren());

    const cam = this.sys.cameras.main;
    this.score = 0;
    this.scoreText = this.add.text(24, 16, `${(this.cfg.texts?.score_label) || 'Score:'} 0`, {
      fontFamily: (this.cfg.font && this.cfg.font.family) || 'Outfit',
      fontSize: '42px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 6
    }).setDepth(1000).setAlpha(0);

    this.timerText = this.add.text(cam.width - 24, 16, `${this.timeLeft}`, {
      fontFamily: (this.cfg.font && this.cfg.font.family) || 'Outfit',
      fontSize: '42px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 6
    }).setOrigin(1, 0).setDepth(1000).setAlpha(0);

    this._scoreTarget = () => {
      const tx = this.scoreText.x + this.scoreText.width + 24;
      const ty = this.scoreText.y + this.scoreText.height * 0.5;
      return { x: tx, y: ty };
    };

    const targetLabel = (this.cfg.texts?.target_left_label) || 'Target Left:';
    this.targetText = this.add.text(cam.width / 2, 16, '', {
      fontFamily: (this.cfg.font && this.cfg.font.family) || 'Outfit',
      fontSize: '42px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 6,
    })
      .setOrigin(0.5, 0)
      .setDepth(1000)
      .setAlpha(0);

    // First update of the text
    this._updateTargetText();


    this._createAudio();
    this._buildBoard();
    this._enablePointerInput();

    this.timeEvent = this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        this.timeLeft = Math.max(0, this.timeLeft - 1);
        this.timerText.setText(`${this.timeLeft}`);
        if (this.timeLeft <= 10) {
          this._tickSfx();
          this._pulseTimer();
        }
        if (this.timeLeft === 0) this._endRound();
      }
    });

    this.lastInteractionAt = this.time.now;

    this.time.addEvent({
      delay: 300,
      loop: true,
      callback: () => {
        if (this.inputBlocked) return;
        if (this.time.now - this.lastInteractionAt > this.hintAfter * 1000) {
          this._showHint();
        }
      }
    });

    this.tweens.add({ targets: this.scoreText, alpha: 1, duration: 220, ease: 'sine.out' });
    this.tweens.add({ targets: this.targetText, alpha: 1, duration: 220, ease: 'sine.out', delay: 40 });
    this.tweens.add({ targets: this.timerText, alpha: 1, duration: 220, ease: 'sine.out', delay: 60 });
    this.tweens.add({ targets: this.mainLayer, alpha: 1, duration: 220, ease: 'sine.out', delay: 90 });

    this.time.delayedCall(100, () => this._applyAlwaysJiggleToAll());

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this._onShutdown);
    this.events.once(Phaser.Scenes.Events.DESTROY, this._onShutdown);
  }

  _addGameBackground() {
    const cam = this.sys.cameras.main;
    const W = cam.width, H = cam.height;

    const prefs = ['game_bg', 'bg', 'background'];
    let keyToUse = null;
    for (const k of prefs) {
      if (this.textures.exists(k)) { keyToUse = k; break; }
    }
    if (!keyToUse) {
      const all = this.textures.getTextureKeys?.() || [];
      const guess = all.find(k => /bg|background/i.test(k) && k !== '__DEFAULT' && k !== '__MISSING');
      if (guess) keyToUse = guess;
    }
    if (!keyToUse) keyToUse = 'fallback_bg';

    const bg = this.add.image(W / 2, H / 2, keyToUse)
      .setDepth(-99999)
      .setScrollFactor(0)
      .setAlpha(1)
      .setVisible(true);

    const src = this.textures.get(keyToUse).getSourceImage();
    const bw = (src && src.width) || W;
    const bh = (src && src.height) || H;
    const scale = Math.max(W / bw, H / bh);
    bg.setScale(scale);
    this.children.sendToBack(bg);
    this._bg = bg;

    this.tweens.add({
      targets: bg,
      scale: scale * 1.01,
      duration: 4500,
      yoyo: true,
      repeat: -1,
      ease: 'sine.inOut'
    });
  }

  update() { }

  _onShutdown() {
    if (this.hintFx) { this.hintFx.stop(); this.hintFx = null; }
    if (this.timeEvent) { this.timeEvent.remove(false); this.timeEvent = null; }
    this.tweens?.killAll?.();
    this.time?.removeAllEvents?.();
    if (this.bgm) { this.bgm.stop(); this.bgm.destroy(); this.bgm = null; }
    this.input?.removeAllListeners?.();
  }

  _createAudio() {
    const a = this.cfg?.audio || {};
    const tryAdd = (k) => { if (a[k]) this.sfx[k] = this.sound.add(k, { volume: 0.8 }); };
    tryAdd('swap');
    tryAdd('match');
    tryAdd('special');
    tryAdd('tick');
    tryAdd('win');
    tryAdd('lose');
    tryAdd('swap_fail');
    if (a.bgm) {
      this.bgm = this.sound.add('bgm', { loop: true, volume: 0.4 });
      this.bgm.play();
    }
  }

  _play(key, vol = 1) { const s = this.sfx[key]; if (s) s.play({ volume: vol }); }
  _tickSfx() { this._play('tick', 0.45); }

  _safeRemoveEmitter(em) {
    try {
      if (!em) return;
      em.stop?.();
      if (em.remove) em.remove();
      else if (em.manager?.removeEmitter) em.manager.removeEmitter(em);
    } catch (_) { }
  }

  _colorForType(typeId) {
    const palette = [
      0xff6b6b, // red
      0x4dd0e1, // teal
      0xffd166, // amber
      0x8bc34a, // green
      0xba68c8, // purple
      0xff8a65, // orange
      0x64b5f6  // blue
    ];
    return palette[typeId % palette.length];
  }

  _burstAt(x, y, count = 6, tint = 0xffffff) {
    const em = this.add.particles(0, 0, 'spark', {
      speed: { min: 20, max: 40 },
      angle: { min: 0, max: 360 },
      lifespan: { min: 900, max: 1100 },
      scale: { start: 2.0, end: 0.0 },
      alpha: { start: 1.0, end: 0.3 },
      tint,
      quantity: 10,
      blendMode: 'ADD'
    });
    em.explode(count, x, y);
    this.time.delayedCall(1100, () => { try { em.remove?.(); } catch (e) { } });
  }

  _floatScoreText(amount) {
    try {
      const { x, y } = this._scoreTarget();
      const t = this.add.text(x, y - 8, `+${amount}`, {
        fontFamily: (this.cfg.font && this.cfg.font.family) || 'Outfit',
        fontSize: '60px',
        color: '#fff',
        stroke: '#000',
        strokeThickness: 4
      }).setDepth(1200).setAlpha(0.9);
      this.tweens.add({
        targets: t,
        y: y - 28,
        alpha: 0,
        duration: 650,
        ease: 'sine.out',
        onComplete: () => t.destroy()
      });
    } catch { }
  }

  _shakeBoard(intensity = 0.0025, duration = 120) {
    try {
      this.sys.cameras.main.shake(duration, intensity);
    } catch { }
  }

  _pulseTimer() {
    if (!this.timerText) return;
    if (this._timerPulsing) return;
    this._timerPulsing = true;
    this.tweens.add({
      targets: this.timerText,
      scale: 2.18,
      duration: 140,
      yoyo: true,
      repeat: 2,
      ease: 'sine.inOut',
      onComplete: () => { this._timerPulsing = false; }
    });
  }

  _launchOrbsTowardsScore(origins, totalScoreDelta, tint = 0xffffff) {
    if (!origins || origins.length === 0 || totalScoreDelta <= 0) return;

    const maxOrbs = Math.min(18, origins.length);
    const step = Math.max(1, Math.floor(origins.length / maxOrbs));
    const picked = origins.filter((_, i) => i % step === 0).slice(0, maxOrbs);

    const perOrb = Math.max(1, Math.floor(totalScoreDelta / picked.length));
    let remainder = totalScoreDelta - perOrb * picked.length;

    const { x: txBase, y: tyBase } = this._scoreTarget();

    picked.forEach((p) => {
      const orb = this.add.image(p.x, p.y, 'spark')
        .setDepth(960)
        .setScale(1.0)
        .setAlpha(0.95)
        .setTint(tint)
        .setBlendMode(Phaser.BlendModes.ADD);

      const tx = txBase + Phaser.Math.Between(-8, 8);
      const ty = tyBase + Phaser.Math.Between(-6, 6);

      const ctrl1 = new Phaser.Math.Vector2((p.x + tx) / 2 + Phaser.Math.Between(-40, 40), p.y - Phaser.Math.Between(80, 140));
      const ctrl2 = new Phaser.Math.Vector2((p.x + tx) / 2 + Phaser.Math.Between(-40, 40), ty - Phaser.Math.Between(50, 110));
      const curve = new Phaser.Curves.CubicBezier(
        new Phaser.Math.Vector2(p.x, p.y), ctrl1, ctrl2, new Phaser.Math.Vector2(tx, ty)
      );

      const tTotal = Phaser.Math.Between(650, 900);
      let addThisOrb = perOrb + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder--;

      this.tweens.add({
        targets: { t: 0 },
        t: 1,
        duration: tTotal,
        ease: 'Quad.easeInOut',
        onUpdate: (tw) => {
          const t = tw.getValue();
          const pt = curve.getPoint(t);
          orb.setPosition(pt.x, pt.y);
          orb.setScale(Phaser.Math.Linear(1.0, 0.55, t));
          orb.setAlpha(Phaser.Math.Linear(0.95, 0.65, t));
        },
        onComplete: () => {
          orb.destroy();
          this._addScore(addThisOrb);
          this._popScoreLabel();
          this._burstAt(tx, ty, 4, tint);
        }
      });
    });
  }

  _popScoreLabel() {
    if (!this.scoreText) return;
    this.tweens.add({
      targets: this.scoreText,
      scale: 1.08,
      duration: 120,
      yoyo: true,
      ease: 'sine.inOut'
    });
  }

  _applyAlwaysJiggle(target) {
    if (!target || !target.active) return;

    const existing = target.getData && target.getData('__ajTween');
    if (existing && existing.isPlaying()) return;
    try { if (existing && !existing.isPlaying()) existing.stop(); } catch { }

    const dur = 1600 + Phaser.Math.Between(0, 600);
    const scaleMin = 0.96 + Phaser.Math.Between(-10, 10) * 0.001;
    const scaleMax = 1.04 + Phaser.Math.Between(-10, 10) * 0.001;
    const angleRange = 3 + Phaser.Math.Between(-1, 1);

    const tween = this.tweens.add({
      targets: target,
      props: {
        scaleX: { from: scaleMin, to: scaleMax },
        scaleY: { from: scaleMax, to: scaleMin },
        angle: { from: -angleRange, to: angleRange }
      },
      duration: dur,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });

    target.setData && target.setData('__ajTween', tween);
    target.once && target.once(Phaser.GameObjects.Events.DESTROY, () => {
      try { tween.stop(); } catch { }
    });
  }

  _applyAlwaysJiggleToAll() {
    try {
      const kids = this.sprites?.getChildren?.() || [];
      kids.forEach(s => this._applyAlwaysJiggle(s));
    } catch { }
  }

  _jiggle(targets, { squeeze = 0.92, stretch = 1.08, angle = 6, duration = 160, repeat = 1 } = {}) {
    if (!targets || (Array.isArray(targets) && targets.length === 0)) return;
    try {
      this.tweens.add({
        targets,
        scaleX: { from: 1, to: squeeze },
        scaleY: { from: 1, to: stretch },
        angle: { from: 0, to: Phaser.Math.Between(-angle, angle) },
        yoyo: true,
        repeat,
        duration,
        ease: 'sine.inOut',
        onComplete: () => {
          (Array.isArray(targets) ? targets : [targets]).forEach(t => t && t.setAngle(0).setScale(1));
          (Array.isArray(targets) ? targets : [targets]).forEach(t => this._applyAlwaysJiggle(t));
        }
      });
    } catch { }
  }

  _jiggleCells(cells, opts) {
    const targets = (cells || [])
      .map(({ r, c }) => this.board?.[r]?.[c]?.sprite)
      .filter(Boolean);
    this._jiggle(targets, opts);
  }

  _buildBoard() {
    const tileKey =
      (this.textures.exists('tile_bg') ? 'tile_bg' :
        (this.textures.exists('platform1') ? 'platform1' : 'fallback_tile'));

    for (let r = 0; r < this.GRID_H; r++) {
      for (let c = 0; c < this.GRID_W; c++) {
        const { x, y } = this._cellPos(r, c);
        const t = this.add.image(x, y, tileKey).setDepth(0);
        t.setDisplaySize(this.CELL, this.CELL);
        t.setOrigin(0.5, 0.5);
      }
    }

    this.board = Array.from({ length: this.GRID_H }, () => Array(this.GRID_W).fill(null));

    for (let r = 0; r < this.GRID_H; r++) {
      for (let c = 0; c < this.GRID_W; c++) {
        const cell = this._randomCellAvoidingStartTriples(r, c);
        this.board[r][c] = cell;
        this._spawnSpriteForCell(cell, r, c, true);
      }
    }

    if (!this._existsAnyValidMove()) {
      this._shuffleBoard(false);
    }

    this.time.delayedCall(100, () => this._applyAlwaysJiggleToAll());
  }

  _randomCellAvoidingStartTriples(r, c) {
    const pool = [...this.colors];
    let pick = Phaser.Utils.Array.GetRandom(pool);
    if (c >= 2 &&
      this.board[r][c - 1] && this.board[r][c - 2] &&
      this.board[r][c - 1].type === pick.id &&
      this.board[r][c - 2].type === pick.id) {
      pick = Phaser.Utils.Array.GetRandom(pool.filter(p => p.id !== pick.id));
    }
    if (r >= 2 &&
      this.board[r - 1][c] && this.board[r - 2][c] &&
      this.board[r - 1][c].type === pick.id &&
      this.board[r - 2][c].type === pick.id) {
      pick = Phaser.Utils.Array.GetRandom(pool.filter(p => p.id !== pick.id));
    }
    return { type: pick.id, key: pick.key, special: null, unbreakable: false };
  }

  _spawnSpriteForCell(cell, r, c, instant = false) {
    const { x, y } = this._cellPos(r, c);
    const spr = this.add.image(x, y, this._textureForCell(cell)).setDepth(10 + r);
    spr.setDisplaySize(this.CANDY_SIZE, this.CANDY_SIZE);
    spr.setData({ r, c });
    spr.setInteractive(
      new Phaser.Geom.Circle(this.CANDY_SIZE * 0.5, this.CANDY_SIZE * 0.5, this.CANDY_SIZE * 0.55),
      Phaser.Geom.Circle.Contains
    );
    this.sprites.add(spr);

    if (!instant) {
      spr.setY(this.PAD_Y - this.CELL * (this.GRID_H - r));
      spr.setScale(0.0);
      this.tweens.add({
        targets: spr,
        scale: 1.0,
        duration: 180,
        ease: 'back.out',
        onComplete: () => this._applyAlwaysJiggle(spr)
      });
    } else {
      spr.setScale(0.0);
      this.tweens.add({
        targets: spr,
        scale: 1.0,
        duration: 180,
        ease: 'back.out',
        delay: (r * 30 + c * 15),
        onComplete: () => this._applyAlwaysJiggle(spr)
      });
    }

    cell.sprite = spr;
  }

  _textureForCell(cell) {
    if (cell.special === 'colorbomb') {
      return (this.cfg.images && this.cfg.images.colorbomb) ? 'colorbomb' : 'power';
    }
    return cell.key;
  }

  _cellPos(r, c) {
    return {
      x: this.PAD_X + c * this.CELL + this.CELL * 0.5,
      y: this.PAD_Y + r * this.CELL + this.CELL * 0.5
    };
  }

  _enablePointerInput() {
    this.input.removeAllListeners();

    this.input.on('gameobjectdown', (pointer, gameObject) => {
      if (this.inputBlocked) return;
      this._hideHint();

      const r = gameObject.getData && gameObject.getData('r');
      const c = gameObject.getData && gameObject.getData('c');
      if (r == null || c == null) return;
      if (!this._inBounds(r, c)) return;

      this.selected = { r, c, x: pointer.x, y: pointer.y };
      this.lastInteractionAt = this.time.now;

      try {
        this.tweens.add({
          targets: gameObject,
          angle: Phaser.Math.Between(-5, 5),
          duration: 60,
          yoyo: true,
          ease: 'sine.inOut'
        });
        this._jiggle(gameObject, { duration: 140, repeat: 0, angle: 5, squeeze: 0.94, stretch: 1.06 });
      } catch { }
    });

    this.input.on('pointermove', (pointer) => {
      if (!this.selected || this.inputBlocked) return;
      const dx = pointer.x - this.selected.x;
      const dy = pointer.y - this.selected.y;
      const thresh = 24;
      if (Math.abs(dx) < thresh && Math.abs(dy) < thresh) return;

      let dir = null;
      if (Math.abs(dx) > Math.abs(dy)) dir = { dr: 0, dc: (dx > 0 ? 1 : -1) };
      else dir = { dr: (dy > 0 ? 1 : -1), dc: 0 };

      const r2 = this.selected.r + dir.dr;
      const c2 = this.selected.c + dir.dc;

      this._trySwap(this.selected.r, this.selected.c, r2, c2);
      this.selected = null;
    });

    this.input.on('gameobjectup', () => { this.selected = null; });
    this.input.on('pointerup', () => { this.selected = null; });
  }

  _trySwap(r1, c1, r2, c2) {
    if (!this._inBounds(r1, c1) || !this._inBounds(r2, c2)) return;
    if (this.inputBlocked) return;
    if (Math.abs(r1 - r2) + Math.abs(c1 - c2) !== 1) return;

    const a = this.board[r1][c1];
    const b = this.board[r2][c2];
    if (!a || !b) return;
    if (a.unbreakable || b.unbreakable) return;

    this.inputBlocked = true;
    this.lastInteractionAt = this.time.now;
    this._hideHint();

    const posA = this._cellPos(r1, c1);
    const posB = this._cellPos(r2, c2);

    try {
      this.tweens.add({ targets: [a.sprite], angle: 8, duration: 70, yoyo: true, ease: 'sine.inOut' });
      this.tweens.add({ targets: [b.sprite], angle: -8, duration: 70, yoyo: true, ease: 'sine.inOut' });
      this._jiggle([a.sprite, b.sprite], { duration: 120, repeat: 0, angle: 4, squeeze: 0.96, stretch: 1.04 });
    } catch { }

    this.tweens.add({ targets: [a.sprite], x: posB.x, y: posB.y, duration: 120, ease: 'sine.inOut' });
    this.tweens.add({
      targets: [b.sprite], x: posA.x, y: posA.y, duration: 120, ease: 'sine.inOut',
      onComplete: () => {
        this.board[r1][c1] = b; b.sprite.setData({ r: r1, c: c1 });
        this.board[r2][c2] = a; a.sprite.setData({ r: r2, c: c2 });

        if (a.special === 'colorbomb' || b.special === 'colorbomb') {
          this._resolveColorBombSwap(r1, c1, r2, c2, a, b);
        } else {
          const matches = this._findMatches();
          if (matches.total > 0) {
            this._resolveMatches(matches);
          } else {
            this._play('swap_fail', 0.75);
            this._invalidSwapSnap(r1, c1, r2, c2);
          }
        }
      }
    });
  }

  _invalidSwapSnap(r1, c1, r2, c2) {
    const cellAtA = this.board[r1][c1];
    const cellAtB = this.board[r2][c2];
    if (!cellAtA || !cellAtB) { this.inputBlocked = false; return; }

    const sprA = cellAtA.sprite;
    const sprB = cellAtB.sprite;

    const posA = this._cellPos(r1, c1);
    const posB = this._cellPos(r2, c2);

    this.board[r1][c1] = cellAtB;
    this.board[r2][c2] = cellAtA;

    if (sprB) sprB.setData({ r: r1, c: c1 });
    if (sprA) sprA.setData({ r: r2, c: c2 });

    if (sprB) this.tweens.add({ targets: sprB, x: posA.x, y: posA.y, duration: 120, ease: 'sine.inOut' });
    if (sprA) {
      this.tweens.add({
        targets: sprA, x: posB.x, y: posB.y, duration: 120, ease: 'sine.inOut',
        onComplete: () => { this.inputBlocked = false; }
      });
    } else {
      this.inputBlocked = false;
    }
  }

  _findMatches() {
    const horiz = [];
    const vert = [];
    const allSet = new Set();
    const H = this.GRID_H, W = this.GRID_W;

    for (let r = 0; r < H; r++) {
      let start = 0;
      while (start < W) {
        const cell = this.board[r][start];
        if (!cell || cell.special === 'colorbomb') { start++; continue; }
        let end = start + 1;
        while (end < W && this._matchableEqual(this.board[r][end], cell)) end++;
        const len = end - start;
        if (len >= 3) {
          const run = [];
          for (let c = start; c < end; c++) {
            run.push({ r, c });
            allSet.add(`${r},${c}`);
          }
          horiz.push({ run, len, r, c0: start, c1: end - 1 });
        }
        start = end;
      }
    }

    for (let c = 0; c < W; c++) {
      let start = 0;
      while (start < H) {
        const cell = this.board[start][c];
        if (!cell || cell.special === 'colorbomb') { start++; continue; }
        let end = start + 1;
        while (end < H && this._matchableEqual(this.board[end][c], cell)) end++;
        const len = end - start;
        if (len >= 3) {
          const run = [];
          for (let r = start; r < end; r++) {
            run.push({ r, c });
            allSet.add(`${r},${c}`);
          }
          vert.push({ run, len, c, r0: start, r1: end - 1 });
        }
        start = end;
      }
    }

    const intersections = [];
    const hSet = new Set(horiz.flatMap(h => h.run.map(p => `${p.r},${p.c}`)));
    const vSet = new Set(vert.flatMap(v => v.run.map(p => `${p.r},${p.c}`)));
    hSet.forEach(k => { if (vSet.has(k)) intersections.push(k); });

    return {
      horiz, vert, intersections,
      cells: Array.from(allSet).map(s => {
        const [r, c] = s.split(',').map(Number); return { r, c };
      }),
      total: allSet.size
    };
  }

  _matchableEqual(a, b) {
    return !!a && !!b && a.special !== 'colorbomb' && b.special !== 'colorbomb' && a.type === b.type;
  }

  _resolveMatches(matches, opts = { causedBySpecial: false }) {
    const specialsToCreate = [];
    const toClear = new Set(matches.cells.map(p => `${p.r},${p.c}`));

    matches.horiz.filter(h => h.len >= 5).forEach(h => {
      const idx = Math.floor((h.c0 + h.c1) / 2);
      specialsToCreate.push({ r: h.r, c: idx, type: 'colorbomb', baseType: this.board[h.r][idx].type });
    });
    matches.vert.filter(v => v.len >= 5).forEach(v => {
      const idx = Math.floor((v.r0 + v.r1) / 2);
      specialsToCreate.push({ r: idx, c: v.c, type: 'colorbomb', baseType: this.board[idx][v.c].type });
    });



    matches.intersections.forEach(k => {
      const [r, c] = k.split(',').map(Number);
      specialsToCreate.push({ r, c, type: 'wrapped', baseType: this.board[r][c].type });
    });

    if (opts.causedBySpecial) specialsToCreate.length = 0;

    specialsToCreate.forEach(sp => {
      const key = `${sp.r},${sp.c}`;
      if (toClear.has(key)) toClear.delete(key);
    });

    const cellsToClear = Array.from(toClear).map(s => {
      const [r, c] = s.split(',').map(Number); return { r, c };
    });

    if (cellsToClear.length === 0 && specialsToCreate.length === 0) {
      this.inputBlocked = false;
      return;
    }

    const perTile = (this.cfg.gameplay && this.cfg.gameplay.pointsPerTile) ?? 3;
    this._play('match', 0.6);
    let gained = 0;
    const orbOrigins = [];
    let tintForSet = 0xffffff;

    cellsToClear.forEach(({ r, c }, idx) => {
      const cell = this.board[r][c];
      if (!cell || !cell.sprite) return;
      gained += perTile;

      const pos = this._cellPos(r, c);
      const tint = this._colorForType(cell.type);
      if (idx === 0) tintForSet = tint;
      orbOrigins.push({ x: pos.x, y: pos.y });
      this._burstAt(pos.x, pos.y, 7, tint);

      const s = cell.sprite;
      this.tweens.add({
        targets: s, scale: 1.25, duration: 80, yoyo: true, ease: 'sine.inOut',
        onComplete: () => {
          this.tweens.add({
            targets: s, scale: 0, alpha: 0, duration: 120, ease: 'back.in',
            onComplete: () => { s.destroy(); }
          });
        }
      });
      this.board[r][c] = null;
    });

    const specialPulse = (sprite) => {
      try {
        this.tweens.add({ targets: sprite, scale: 1.08, duration: 80, yoyo: true, ease: 'sine.inOut' });
      } catch { }
    };

    if (gained > 0) {
      this._launchOrbsTowardsScore(orbOrigins, gained, tintForSet);
      this._floatScoreText(gained);
    }

    specialsToCreate.forEach(sp => {
      const cell = this.board[sp.r][sp.c];
      if (!cell) return;
      cell.special = sp.type;
      if (cell.sprite) {
        cell.sprite.clearTint();
        if (sp.type === 'stripedH') cell.sprite.setTint(0xf0f0f0);
        if (sp.type === 'stripedV') cell.sprite.setTint(0xe0e0ff);
        if (sp.type === 'wrapped') cell.sprite.setTint(0xffe0a0);
        if (sp.type === 'colorbomb') {
          cell.key = (this.cfg.images && this.cfg.images.colorbomb) ? 'colorbomb' : 'power';
          cell.sprite.setTexture(cell.key);
          cell.sprite.setTint(0xffffff);
          this._shakeBoard(0.003, 140);
        }
        specialPulse(cell.sprite);
        this._applyAlwaysJiggle(cell.sprite);
      }
    });

    const neighborSet = new Set();
    const addN = (r, c) => { if (this._inBounds(r, c)) neighborSet.add(`${r},${c}`); };
    cellsToClear.forEach(({ r, c }) => {
      addN(r - 1, c); addN(r + 1, c); addN(r, c - 1); addN(r, c + 1);
    });
    cellsToClear.forEach(({ r, c }) => neighborSet.delete(`${r},${c}`));
    const neighborCells = Array.from(neighborSet).map(s => {
      const [r, c] = s.split(',').map(Number);
      return { r, c };
    });
    this._jiggleCells(neighborCells, { duration: 120, repeat: 0, angle: 4, squeeze: 0.96, stretch: 1.04 });
    neighborCells.forEach(({ r, c }) => this._applyAlwaysJiggle(this.board[r][c]?.sprite));

    this.time.delayedCall(250, () => {
      this._collapseAndRefill(() => {
        const m2 = this._findMatches();
        if (m2.total > 0) this._resolveMatches(m2, { causedBySpecial: false });
        else {
          if (!this._existsAnyValidMove()) this._shuffleBoard(true);
          this.inputBlocked = false;
        }
      });
    });
  }

  _resolveColorBombSwap(r1, c1, r2, c2, a, b) {
    let clearAll = false;
    let targetType = null;

    if (a.special === 'colorbomb' && b.special === 'colorbomb') {
      clearAll = true;
    } else if (a.special === 'colorbomb') {
      targetType = b.special === null ? b.type : null;
    } else if (b.special === 'colorbomb') {
      targetType = a.special === null ? a.type : null;
    }

    if (clearAll) {
      const cells = [];
      for (let r = 0; r < this.GRID_H; r++) for (let c = 0; c < this.GRID_W; c++) {
        const cell = this.board[r][c];
        if (!cell || cell.unbreakable) continue;
        cells.push({ r, c });
      }
      this._shakeBoard(0.004, 160);
      this._clearSpecificCells(cells, true);
    } else if (targetType !== null) {
      const cells = [];
      for (let r = 0; r < this.GRID_H; r++) for (let c = 0; c < this.GRID_W; c++) {
        const cell = this.board[r][c];
        if (!cell || cell.unbreakable) continue;
        if (cell.type === targetType) cells.push({ r, c });
      }
      this._shakeBoard(0.003, 140);
      this._clearSpecificCells(cells, true);
    } else {
      const matches = this._findMatches();
      if (matches.total > 0) this._resolveMatches(matches);
      else this._invalidSwapSnap(r1, c1, r2, c2);
    }
  }

  _clearSpecificCells(cells, causedBySpecial = false) {
    if (cells.length === 0) { this.inputBlocked = false; return; }
    this._play('special', 0.7);

    const perTile = (this.cfg.gameplay && this.cfg.gameplay.pointsPerTile) ?? 3;
    let gained = 0;
    const orbOrigins = [];
    let tintForSet = 0xffffff;

    cells.forEach(({ r, c }, idx) => {
      const cell = this.board[r][c];
      if (!cell || !cell.sprite) return;
      gained += perTile;

      const pos = this._cellPos(r, c);
      const tint = this._colorForType(cell.type);
      if (idx === 0) tintForSet = tint;
      orbOrigins.push({ x: pos.x, y: pos.y });
      this._burstAt(pos.x, pos.y, 7, tint);

      const s = cell.sprite;
      this.tweens.add({
        targets: s, scale: 0, alpha: 0.0, duration: 140, ease: 'back.in',
        onComplete: () => s.destroy()
      });
      this.board[r][c] = null;
    });

    if (gained > 0) {
      this._launchOrbsTowardsScore(orbOrigins, gained, tintForSet);
      this._floatScoreText(gained);
    }

    this.time.delayedCall(160, () => {
      this._collapseAndRefill(() => {
        const m2 = this._findMatches();
        if (m2.total > 0) this._resolveMatches(m2, { causedBySpecial });
        else {
          if (!this._existsAnyValidMove()) this._shuffleBoard(true);
          this.inputBlocked = false;
        }
      });
    });
  }

  _collapseAndRefill(onDone) {
    // Stop all existing jiggle tweens to prevent conflicts
    this.sprites.getChildren().forEach(s => {
      const tween = s.getData('__ajTween');
      if (tween && tween.isPlaying()) tween.stop();
    });

    // Collect moves for existing cells and track new cells to spawn
    const moves = [];
    const newCells = [];
    for (let c = 0; c < this.GRID_W; c++) {
      let write = this.GRID_H - 1;
      // Move existing cells down
      for (let r = this.GRID_H - 1; r >= 0; r--) {
        const cell = this.board[r][c];
        if (cell && cell.sprite && cell.sprite.active) {
          if (write !== r) {
            this.board[write][c] = cell;
            this.board[r][c] = null;
            moves.push({ sprite: cell.sprite, from: { r, c }, to: { r: write, c } });
          }
          write--;
        }
      }
      // Create new cells for empty slots at the top
      for (let r = write; r >= 0; r--) {
        const pick = Phaser.Utils.Array.GetRandom(this.colors);
        const cell = { type: pick.id, key: pick.key, special: null, unbreakable: false };
        this.board[r][c] = cell;
        newCells.push({ cell, r, c });
      }
    }

    // Animate existing cells to their new positions
    moves.forEach(m => {
      const sprite = m.sprite;
      if (!sprite || !sprite.active) return;
      const { x, y } = this._cellPos(m.to.r, m.to.c);
      sprite.setData({ r: m.to.r, c: m.to.c });
      sprite.setDepth(10 + m.to.r);

      this.tweens.add({
        targets: sprite,
        x: x,
        y: y,
        duration: 160,
        ease: 'cubic.out',
        onComplete: () => {
          this.tweens.add({
            targets: sprite,
            scale: { from: 0.98, to: 1 },
            duration: 90,
            ease: 'sine.out',
            onComplete: () => this._applyAlwaysJiggle(sprite)
          });
        }
      });
    });

    // Spawn and animate new cells
    newCells.forEach(({ cell, r, c }) => {
      const { x, y } = this._cellPos(r, c);
      this._spawnSpriteForCell(cell, r, c, false);
      cell.sprite.setDepth(10 + r);
      this.tweens.add({
        targets: cell.sprite,
        y: y,
        duration: 200 + (this.GRID_H - r) * 50,
        ease: 'cubic.out',
        delay: c * 30,
        onComplete: () => {
          this._applyAlwaysJiggle(cell.sprite);
        }
      });
    });

    // Ensure all sprites have jiggle applied after animations
    this.time.delayedCall(800, () => {
      this.sprites.getChildren().forEach(s => {
        if (s && s.active) this._applyAlwaysJiggle(s);
      });
      onDone();
    });
  }

  _existsAnyValidMove() {
    for (let r = 0; r < this.GRID_H; r++) for (let c = 0; c < this.GRID_W; c++) {
      if (this._wouldMatchAfterSwap(r, c, r, c + 1)) return true;
      if (this._wouldMatchAfterSwap(r, c, r + 1, c)) return true;
    }
    return false;
  }

  _wouldMatchAfterSwap(r1, c1, r2, c2) {
    if (!this._inBounds(r2, c2)) return false;
    const a = this.board[r1][c1], b = this.board[r2][c2];
    if (!a || !b || a.unbreakable || b.unbreakable) return false;

    this.board[r1][c1] = b;
    this.board[r2][c2] = a;
    const m = this._findMatches().total > 0;
    this.board[r1][c1] = a;
    this.board[r2][c2] = b;
    return m;
  }

  _showHint() {
    if (this.hintFx) return;
    for (let r = 0; r < this.GRID_H; r++) {
      for (let c = 0; c < this.GRID_W; c++) {
        if (this._wouldMatchAfterSwap(r, c, r, c + 1)) {
          return this._pulseCells([{ r, c }, { r, c: c + 1 }]);
        }
        if (this._wouldMatchAfterSwap(r, c, r + 1, c)) {
          return this._pulseCells([{ r, c }, { r: r + 1, c }]);
        }
      }
    }
    this._shuffleBoard(true);
  }

  _pulseCells(cells) {
    const targets = cells.map(({ r, c }) => this.board[r][c]?.sprite).filter(Boolean);
    if (targets.length === 0) return;
    this.hintFx = this.tweens.add({
      targets, scale: 1.08, duration: 220, yoyo: true, repeat: -1, ease: 'sine.inOut'
    });
  }

  _hideHint() {
    if (this.hintFx) { this.hintFx.stop(); this.hintFx = null; }
    this.sprites.getChildren().forEach(s => {
      if (s && s.active) {
        s.setScale(1).setDisplaySize(this.CANDY_SIZE, this.CANDY_SIZE);
        this._applyAlwaysJiggle(s);
      }
    });
  }

  _shuffleBoard(animate) {
    const cells = [];
    for (let r = 0; r < this.GRID_H; r++) for (let c = 0; c < this.GRID_W; c++) {
      const cell = this.board[r][c];
      if (cell && !cell.unbreakable) cells.push({ r, c, cell });
    }
    Phaser.Utils.Array.Shuffle(cells);

    let i = 0;
    for (let r = 0; r < this.GRID_H; r++) for (let c = 0; c < this.GRID_W; c++) {
      const cell = this.board[r][c];
      if (cell && !cell.unbreakable) {
        const src = cells[i++].cell;
        this.board[r][c] = { ...src };
        const target = this.board[r][c];
        if (cell.sprite) {
          const s = cell.sprite;
          target.sprite = s;
          s.setTexture(this._textureForCell(target));
          s.clearTint();
          s.setData({ r, c });
          const { x, y } = this._cellPos(r, c);
          if (animate) {
            this.tweens.add({ targets: s, x, y, duration: 160, ease: 'cubic.out' });
            this.tweens.add({ targets: s, scale: { from: 0.98, to: 1 }, duration: 90, ease: 'sine.out' });
          } else s.setPosition(x, y);
          this._applyAlwaysJiggle(s);
        }
      }
    }

    if (!this._existsAnyValidMove()) {
      Phaser.Utils.Array.Shuffle(cells);
    }
  }

  _updateTargetText() {
    if (!this.targetText) return;
    const left = Math.max(0, (this.targetScore ?? 0) - (this.score ?? 0));
    const label = (this.cfg.texts?.target_left_label) || 'Target Left:';
    this.targetText.setText(`${label} ${left}`);
  }


  _addScore(n) {
    if (n <= 0 || this.hasEnded) return;
    this.score += n;

    const label = (this.cfg.texts && this.cfg.texts.score_label) || 'Score: ';
    this.scoreText.setText(`${label} ${this.score}`);
    this._updateTargetText();
    this.tweens.add({ targets: this.scoreText, scale: 1.08, duration: 120, yoyo: true });

    // Win instantly when target reached
    if (this.score >= (this.targetScore ?? 0)) {
      this._endRound();
    }
  }



  _endRound() {
    if (this.hasEnded) return;   // <-- guard
    this.hasEnded = true;
    this.inputBlocked = true;
    if (this.timeEvent) { this.timeEvent.remove(false); this.timeEvent = null; }
    if (this.bgm) { this.bgm.stop(); this.bgm.destroy(); this.bgm = null; }
    if (this.hintFx) { this.hintFx.stop(); this.hintFx = null; }
    this.tweens.killAll();
    this.time.removeAllEvents();

    const won = this.score >= this.targetScore;
    const payload = {
      score: this.score,
      target: this.targetScore,
      timeSpent: (this.cfg.gameplay?.timerSeconds ?? 60) - this.timeLeft
    };

    this.time.delayedCall(120, () => {
      this.scene.stop('GameScene');
      this.scene.start(won ? 'WinScene' : 'GameOverScene', payload);
    });
  }

  _inBounds(r, c) {
    return r >= 0 && c >= 0 && r < this.GRID_H && c < this.GRID_W;
  }
}