class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');

    this.cfg = null;

    this.letters = [];
    this.letterGroup = null;
    this.center = { x: 540, y: 1180 };
    this.radius = 260;

    this.dragPath = [];
    this.dragGraphics = null;
    this.currentWordText = null;

    this.gridCells = [];
    this.words = [];
    this.wordsLeft = 0;

    this.foundWords = new Set();
    this.bonusWords = new Set();

    this.shuffleBtn = null;

    this.sfx = {};
    this.bgm = null;

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);

    this._hasMadeFallbacks = false;

    // FX
    this.fxLayer = null; // container for overlays

    // Wheel decor
    this._wheelPlate = null;
    this._wheelRing = null;
    this._wheelGlow = null;

    // Timer / state
    this._finished = false;
    this._timeLeft = 60;
    this._timerText = null;
    this._timerUI = null;
    this._tickEvt = null;
  }

  _normalize(w) {
    return String(w || '').toUpperCase().trim().replace(/[^A-Z]/g, '');
  }

  preload() {
    const cfg = this.registry.get('cfg') || {};
    this.cfg = cfg;

    // Accept any combination; still support old `images` for backward-compat.
    const images1 = cfg.images1 || {};
    const images2 = cfg.images2 || {};
    const ui = cfg.ui || {};
    const legacy = cfg.images || {}; // optional legacy map

    // Load order: images1 -> images2 -> ui -> legacy
    // (later ones override earlier keys if duplicated)
    const loaders = [images1, images2, ui, legacy];
    for (const pack of loaders) {
      for (const [key, url] of Object.entries(pack)) {
        // Skip falsy urls to avoid loader errors
        if (url) this.load.image(key, url);
      }
    }

    const audio = cfg.audio || {};
    for (const [key, url] of Object.entries(audio)) this.load.audio(key, url);

    if (cfg.font && cfg.font.url && cfg.font.family) {
      const font = new FontFace(cfg.font.family, `url(${cfg.font.url})`);
      font.load().then(f => document.fonts.add(f)).catch(() => { });
    }
  }


  // Put this near the top of the class (e.g., under other helpers)
  _noWrap(style = {}) {
    // Force a very large wrap width so it never triggers wrap logic
    // and avoid advanced wrapping (slower, not needed here).
    return {
      ...style,
      wordWrap: { width: 4096, useAdvancedWrap: false }
    };
  }


  create() {
    const cfg = this.cfg;
    const G = cfg.gameplay || {};
    const family = (cfg.font && cfg.font.family) ? cfg.font.family : 'Arial';
    // this._finished = false;
    this.allowRepeatLetters = (G.allowRepeatLetters !== false);

    this._initFallbackTextures();
    this._initFxTextures();
    this._initWheelTextures();

    if (cfg.audio?.bgm) {
      this.bgm = this.sound.add('bgm', { loop: true, volume: 0.6 });
      this.bgm.play();
    }
    this.sfx.collect = cfg.audio?.collect ? this.sound.add('collect', { volume: 1 }) : null;
    this.sfx.hit = cfg.audio?.hit ? this.sound.add('hit', { volume: 0.8 }) : null;
    this.sfx.attack = cfg.audio?.attack ? this.sound.add('attack', { volume: 0.8 }) : null;
    this.sfx.win = cfg.audio?.win ? this.sound.add('win', { volume: 0.9 }) : null;

    const bgKey = this._pickTexture(['background'], 'fallback_bg');
    this.add.image(540, 960, bgKey).setDepth(-10).setDisplaySize(1080, 1920);

    // FX layer on top — general FX
    this.fxLayer = this.add.container(0, 0).setDepth(5000);

    // Use provided puzzle or single inferred one
    const puzzles = Array.isArray(G.puzzles) && G.puzzles.length
      ? G.puzzles
      : [{ letters: G.letters, crossword: G.crossword, bonusWords: G.bonusWords }];

    const picked = Phaser.Utils.Array.GetRandom(puzzles);
    const letters = (picked.letters || []).map(c => String(c).toUpperCase());
    const crossword = picked.crossword || { words: [] };
    const bonus = (picked.bonusWords || []).map(w => w.toUpperCase());

    this._buildCrosswordAuto(crossword, family);

    // Fancy wheel background/decor before letters
    this._buildWheelDecor();

    // Letters wheel
    this._buildWheel(letters, family);

    // Current typed word display
    this.currentWordText = this.add.text(540, 1520, '', this._noWrap({
      fontFamily: family, fontSize: 48, color: '#ffffff', align: 'center', fontStyle: 'bold'
    })).setOrigin(0.5);


    // ===== TIMER UI (always visible & on top) =====

    // ===== TIMER UI (always visible & on top) =====
    this._finished = false;
    // allow cfg override: gameplay.timerSeconds (number > 0), else default 60
    const startSecs = Number((this.cfg.gameplay && this.cfg.gameplay.timerSeconds) || 0);
    this._timeLeft = startSecs > 0 ? startSecs : 60;


    // Top overlay container at very high depth; camera-fixed
    this._timerUI = this.add.container(540, 110).setDepth(6000);
    this._timerUI.setScrollFactor(0);

    // Pill background for contrast
    const pill = this.add.image(0, 0, 'timer_pill').setOrigin(0.5);
    // Timer text (dark over bright pill)
    this._timerText = this.add.text(0, 0, String(this._timeLeft), this._noWrap({
      fontFamily: family, fontSize: 50, color: '#111827', fontStyle: 'bold'
    })).setOrigin(0.5).setDepth(6001);


    this._timerUI.add([pill, this._timerText]);

    // Tick every second
    this._tickEvt = this.time.addEvent({
      delay: 1000,
      callback: () => this._tickTimer(),
      loop: true
    });

    // (Shuffle button left disabled in comments)

    this.dragGraphics = this.add.graphics().setDepth(50);

    this.input.on('pointerdown', this._onPointerDown);
    this.input.on('pointermove', this._onPointerMove);
    this.input.on('pointerup', this._onPointerUp);

    this.bonusWords = new Set(bonus.map(b => this._normalize(b)));
  }

  // ---------- BUILDERS ----------
  _buildCrosswordAuto(cw, family) {
    this.gridCells = [];
    this.words = [];

    // Increase spacing between blocks
    const cellSize = 86;
    const cellGap = 16;
    const pitch = cellSize + cellGap;

    const used = new Map();
    const keyOf = (r, c) => `${r},${c}`;

    (cw.words || []).forEach(w => {
      (w.slots || []).forEach(s => used.set(keyOf(s.r, s.c), { r: s.r, c: s.c }));
    });

    (cw.cells || []).forEach(s => { used.set(keyOf(s.r, s.c), { r: s.r, c: s.c }); });
    if (used.size === 0) return;

    let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
    used.forEach(({ r, c }) => {
      minR = Math.min(minR, r); maxR = Math.max(maxR, r);
      minC = Math.min(minC, c); maxC = Math.max(maxC, c);
    });

    const totalCols = (maxC - minC + 1);
    const totalRows = (maxR - minR + 1);
    const gridW = totalCols * pitch - cellGap;
    const gridH = totalRows * pitch - cellGap;

    const startX = 540 - gridW / 2 + cellSize / 2;
    const startY = 260; // keep high on screen

    const cellBgKey = this._pickTexture(
      ['platform', 'platform1', 'platform2', 'platform3', 'platform4', ...this._objList()],
      'fallback_cell'
    );
    const emptyKey = 'fallback_empty';

    const cellMap = new Map();
    used.forEach(({ r, c }) => {
      const x = startX + (c - minC) * pitch;
      const y = startY + (r - minR) * pitch;

      const isUsed = (cw.words || []).some(w =>
        (w.slots || []).some(s => s.r === r && s.c === c)
      );
      const tex = isUsed ? cellBgKey : emptyKey;
      const cellSprite = this.add.image(x, y, tex).setDepth(1);
      cellSprite.setDisplaySize(cellSize, cellSize);

      const txt = this.add.text(x, y, '', this._noWrap({
        fontFamily: family || 'Arial',
        fontSize: 44,
        color: '#ffffff',
        fontStyle: 'bold'
      })).setOrigin(0.5).setDepth(2);


      const cell = { x, y, r, c, text: txt, filled: false };
      this.gridCells.push(cell);
      cellMap.set(keyOf(r, c), cell);
    });

    (cw.words || []).forEach(w => {
      const slots = (w.slots || []).map(s => {
        const ref = cellMap.get(keyOf(s.r, s.c));
        return { r: s.r, c: s.c, ref };
      });
      this.words.push({
        word: this._normalize(w.word),
        slots,
        dir: w.dir,
        placed: false
      });
    });

    this.wordsLeft = this.words.length;
    this._targetWordSet = new Set(this.words.map(w => w.word));
  }

  _buildWheel(letterArray, family) {
    this.letterGroup = this.add.container(0, 0).setDepth(20);
    this.letters = [];

    const n = letterArray.length;
    const step = (Math.PI * 2) / Math.max(1, n);

    const tileKey = this._pickTexture(
      ['player', 'collectible', 'enemy', 'action', ...this._objList()],
      'fallback_circle'
    );

    for (let i = 0; i < n; i++) {
      const angle = i * step - Math.PI / 2;
      const x = this.center.x + Math.cos(angle) * this.radius;
      const y = this.center.y + Math.sin(angle) * this.radius;

      const spr = this.add.image(x, y, tileKey).setDepth(21);
      spr.setDisplaySize(110, 110);
      spr.setInteractive(new Phaser.Geom.Circle(0, 0, 55), Phaser.Geom.Circle.Contains);

      // subtle drop shadow effect via duplicate image
      const shadow = this.add.image(x, y + 6, tileKey).setDepth(20).setAlpha(0.25);
      shadow.setDisplaySize(112, 112);
      this.letterGroup.add(shadow);

      const txt = this.add.text(x, y, letterArray[i], {
        fontFamily: family || 'Arial', fontSize: 56, color: '#2b2b2b', fontStyle: 'bold'
      }).setOrigin(0.5).setDepth(22);

      this.letterGroup.add(spr);
      this.letterGroup.add(txt);

      // gentle idle bob + micro scale pulse
      this.tweens.add({
        targets: [spr, txt, shadow],
        y: '+=6',
        duration: 1600 + i * 80,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      });
      this.tweens.add({
        targets: [spr, txt],
        scale: { from: 1.0, to: 1.04 },
        duration: 1400 + i * 60,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      });

      this.letters.push({ char: letterArray[i], sprite: spr, text: txt, angle });
    }
  }

  // ---------- WHEEL DECOR ----------
  _buildWheelDecor() {
    // center plate
    this._wheelPlate = this.add.image(this.center.x, this.center.y, 'wheel_plate')
      .setDepth(18)
      .setAlpha(0.95);

    // slow rotating ring
    this._wheelRing = this.add.image(this.center.x, this.center.y, 'wheel_ring')
      .setDepth(19)
      .setAlpha(0.9);

    // soft glow
    this._wheelGlow = this.add.image(this.center.x, this.center.y, 'wheel_glow')
      .setDepth(17)
      .setAlpha(0.6);

    // animate ring rotation
    this.tweens.add({
      targets: this._wheelRing,
      angle: 360,
      duration: 12000,
      repeat: -1,
      ease: 'Linear'
    });

    // gentle glow pulse
    this.tweens.add({
      targets: this._wheelGlow,
      alpha: { from: 0.45, to: 0.8 },
      duration: 1800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });
  }

  // ---------- INPUT ----------
  _getLetterAt(x, y) {
    for (const L of this.letters) {
      const dx = x - L.sprite.x, dy = y - L.sprite.y;
      if (dx * dx + dy * dy <= 55 * 55) return L;
    }
    return null;
  }

  _onPointerDown(pointer) {
    if (this._finished) return;
    this.dragPath = [];
    const L = this._getLetterAt(pointer.x, pointer.y);
    if (L) {
      this.dragPath.push(L);
      if (this.sfx.attack) this.sfx.attack.play();
      L.sprite.setAlpha(0.85).setScale(1.05);
      this.currentWordText.setText(L.char);
    }
    this._redrawDrag();
  }

  _onPointerMove(pointer) {
    if (this._finished) return;
    if (!pointer.isDown) return;

    const L = this._getLetterAt(pointer.x, pointer.y);
    if (!L) return;

    const last = this.dragPath[this.dragPath.length - 1];
    const secondLast = this.dragPath[this.dragPath.length - 2];

    if (secondLast && L === secondLast) {
      const removed = this.dragPath.pop();
      if (removed) removed.sprite.setAlpha(1).setScale(1);
      if (this.sfx.hit) this.sfx.hit.play();
    } else if (L !== last) {
      if (this.allowRepeatLetters || !this.dragPath.includes(L)) {
        this.dragPath.push(L);
        if (this.sfx.attack) this.sfx.attack.play();
        L.sprite.setAlpha(0.85).setScale(1.05);
      }
    }

    this.currentWordText.setText(this.dragPath.map(o => o.char).join(''));
    this._redrawDrag();
  }

  // keep the path on miss; clear it on success
  _onPointerUp() {
    if (this._finished) return;
    const word = this.dragPath.map(L => L.char).join('');
    const accepted = this._submitWord(word);

    if (accepted) {
      this.dragPath.forEach(L => L.sprite.setAlpha(1).setScale(1));
      this.dragPath = [];
      this._redrawDrag();
      this.currentWordText.setText('');
    } else {
      this.dragPath.forEach(L => L.sprite.setAlpha(1).setScale(1));
      // keep path to let the player tweak/extend
    }
  }

  _redrawDrag() {
    this.dragGraphics.clear();
    if (this.dragPath.length < 1) return;
    this.dragGraphics.lineStyle(6, 0xffffff, 0.9);
    for (let k = 0; k < this.dragPath.length - 1; k++) {
      const a = this.dragPath[k].sprite;
      const b = this.dragPath[k + 1].sprite;
      this.dragGraphics.beginPath();
      this.dragGraphics.moveTo(a.x, a.y);
      this.dragGraphics.lineTo(b.x, b.y);
      this.dragGraphics.strokePath();
    }
  }

  _submitWord(rawWord) {
    if (this._finished) return false;

    const word = this._normalize(rawWord);
    if (word.length < 2) return false;

    if (this.foundWords.has(word)) {
      if (this.sfx.hit) this.sfx.hit.play();
      this._flashRepeat(word);
      return false;
    }

    const wordCenter = (slots) => {
      if (!slots || !slots.length) return { x: 540, y: 800 };
      let sx = 0, sy = 0, n = 0;
      for (const s of slots) {
        if (s.ref) { sx += s.ref.x; sy += s.ref.y; n++; }
      }
      return n ? { x: sx / n, y: sy / n } : { x: 540, y: 800 };
    };

    if (this._targetWordSet && this._targetWordSet.has(word)) {
      const target = this.words.find(w => w.word === word && !w.placed);
      if (!target) { if (this.sfx.hit) this.sfx.hit.play(); return false; }

      target.slots.forEach((slot, i) => {
        const ref = slot.ref;
        if (!ref) return;
        ref.text.setText(target.word[i]);
        ref.filled = true;
      });

      target.placed = true;
      this.foundWords.add(word);
      this.wordsLeft--;

      const tierText = (word.length >= 6) ? 'PERFECT!' : (word.length >= 4 ? 'GREAT!' : 'NICE!');
      const pos = wordCenter(target.slots);

      // Celebrate (top-depth FX + collect sound)
      this.sfx.collect && this.sfx.collect.play();
      this._celebrateWord(tierText, pos, 0x66ff99);

      // Win condition: all words placed BEFORE timer ends
      if (this.wordsLeft <= 0) {
        this._finish(true);
      }
      return true;
    }

    if (this.bonusWords && this.bonusWords.has(word)) {
      // Bonus celebration (no score, just FX)
      const pos = { x: 540, y: 1460 };
      this._celebrateWord(`BONUS`, pos, 0x66d9ff, true);
      this.foundWords.add(word);
      return true;
    }

    if (this.sfx.hit) this.sfx.hit.play();
    this._shakeWheel();
    return false;
  }

  // ---------- TIMER ----------
  _tickTimer() {
    if (this._finished) return;
    this._timeLeft = Math.max(0, this._timeLeft - 1);
    if (this._timerText) this._timerText.setText(String(this._timeLeft));

    // Little urgency shake in the last 5 seconds
    if (this._timeLeft > 0 && this._timeLeft <= 5) {
      this.cameras.main.shake(80, 0.0012);
    }

    if (this._timeLeft <= 0) {
      // Time up — if any words left, it’s a loss
      if (this.wordsLeft > 0) {
        this._finish(false);
      } else {
        // Edge case: finished exactly on tick
        this._finish(true);
      }
    }
  }

  // End the round and move to next scene
  _finish(isWin) {
    if (this._finished) return;
    this._finished = true;

    // stop timer
    if (this._tickEvt) { this._tickEvt.remove(false); this._tickEvt = null; }

    // Optional SFX/FX
    if (isWin) {
      if (this.sfx.win) this.sfx.win.play();
      this._burst(540, 360, 0xffe066, 60, 450);
      this._popBig('PUZZLE COMPLETE!', { x: 540, y: 380 }, 0xfff3b0);
      this.scene.start('WinScene', { timeLeft: this._timeLeft });
    } else {
      this._shakeWheel();
      this._popBig('TIME UP!', { x: 540, y: 380 }, 0xff6b6b);
      this.scene.start('GameOverScene', { timeLeft: 0, wordsLeft: this.wordsLeft });
    }
  }

  _shuffleLetters() {
    const n = this.letters.length;
    const perm = [...Array(n).keys()];
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [perm[i], perm[j]] = [perm[j], perm[i]];
    }

    const step = (Math.PI * 2) / Math.max(1, n);
    perm.forEach((oldIdx, i) => {
      const angle = i * step - Math.PI / 2;
      const x = this.center.x + Math.cos(angle) * this.radius;
      const y = this.center.y + Math.sin(angle) * this.radius;

      const L = this.letters[oldIdx];
      L.angle = angle;

      this.tweens.add({ targets: [L.sprite, L.text], x, y, duration: 300, ease: 'Cubic.easeInOut' });
    });

    this.letters = perm.map(oldIdx => this.letters[oldIdx]);
    this.dragPath = [];
    this._redrawDrag();
    this.currentWordText.setText('');
    this.letters.forEach(L => L.sprite.setAlpha(1).setScale(1));
  }

  update() { }

  _objList() { const arr = []; for (let i = 1; i <= 28; i++) arr.push(`obj${i}`); return arr; }
  _pickTexture(candidates, fallback) { for (const k of candidates) if (this.textures.exists(k)) return k; return fallback; }

  // ---------- UI / FX HELPERS ----------
  _celebrateWord(label, pos, color = 0xffffff, isBonus = false) {
    this._burst(pos.x, pos.y, isBonus ? 0x66d9ff : 0xffe066, isBonus ? 45 : 32, isBonus ? 420 : 360);
    this._popLabel(pos, label, color);
    if (label === 'GREAT!' || label === 'PERFECT!' || isBonus) {
      this.cameras.main.shake(90, 0.0025);
    }
  }

  // Phaser 3.60+ compatible burst
  _burst(x, y, tint = 0xffe066, count = 32, speed = 360) {
    // Pass 'null' for the frame param, then your config
    const emitter = this.add.particles(x, y, 'fx_spark', null, {
      quantity: count,
      speed: { min: speed * 0.6, max: speed * 1.15 },
      angle: { min: 0, max: 360 },
      gravityY: 0,
      lifespan: 600,
      scale: { start: 1, end: 0 },
      tint: tint,
      rotate: { min: 0, max: 360 },
      blendMode: Phaser.BlendModes.ADD
    });

    // Ensure the particle *manager* sits above everything visually
    const mgr = emitter.particleManager || emitter.manager || emitter; // fallback just in case
    if (mgr.setDepth) mgr.setDepth(5000);

    // Stop and clean up shortly after the burst
    this.time.delayedCall(620, () => {
      if (emitter.stop) emitter.stop();
      if (mgr.destroy) mgr.destroy();
    });
  }


  _popLabel(pos, text, color = 0xffffff) {
    const family = (this.cfg.font && this.cfg.font.family) ? this.cfg.font.family : 'Arial';
    const t = this.add.text(pos.x, pos.y, text, this._noWrap({
      fontFamily: family,
      fontSize: 64,
      color: '#ffffff',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 8
    }))
      .setDepth(5001) // above particles
      .setScale(0.5)
      .setAlpha(0.95);

    t.setShadow(0, 0, Phaser.Display.Color.IntegerToColor(color).rgba, 12, true, true);

    this.tweens.add({
      targets: t,
      scale: 1.05, y: pos.y - 40, alpha: 1,
      duration: 220, ease: 'Back.Out',
      onComplete: () => {
        this.tweens.add({
          targets: t,
          y: pos.y - 120, alpha: 0,
          duration: 380, ease: 'Quad.easeIn',
          onComplete: () => t.destroy()
        });
      }
    });
  }

  _popBig(text, pos, color = 0xffffff) {
    const family = (this.cfg.font && this.cfg.font.family) ? this.cfg.font.family : 'Arial';
    const t = this.add.text(pos.x, pos.y, text, this._noWrap({
      fontFamily: family,
      fontSize: 72,
      color: '#ffffff',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 10
    }))
      .setDepth(5002) // very top
      .setScale(0.2)
      .setAlpha(0.98);

    t.setShadow(0, 0, Phaser.Display.Color.IntegerToColor(color).rgba, 16, true, true);

    this.tweens.add({
      targets: t, scale: 1, duration: 260, ease: 'Back.Out',
      onComplete: () => {
        this.time.delayedCall(600, () => {
          this.tweens.add({
            targets: t, alpha: 0, duration: 350, ease: 'Quad.easeIn',
            onComplete: () => t.destroy()
          });
        });
      }
    });
  }

  _shakeWheel() {
    this.cameras.main.shake(90, 0.002);
  }

  _flashRepeat() {
    const family = (this.cfg.font && this.cfg.font.family) ? this.cfg.font.family : 'Arial';
    const pos = { x: 540, y: 1460 };
    const t = this.add.text(pos.x, pos.y, 'ALREADY FOUND', this._noWrap({
      fontFamily: family,
      fontSize: 40,
      color: '#ffd166',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 6
    })).setDepth(5001).setAlpha(0);

    this.tweens.add({
      targets: t, alpha: 1, duration: 120, yoyo: true, repeat: 1,
      onComplete: () => t.destroy()
    });
  }


  // ---------- FALLBACKS ----------
  _initFallbackTextures() {
    if (this._hasMadeFallbacks) return;

    if (!this.textures.exists('fallback_circle')) {
      const g = this.add.graphics({ x: 0, y: 0 });
      g.fillStyle(0xffffff, 1); g.fillCircle(100, 100, 100);
      g.lineStyle(8, 0xD7DCE2, 1); g.strokeCircle(100, 100, 96);
      g.generateTexture('fallback_circle', 200, 200); g.destroy();
    }

    if (!this.textures.exists('fallback_cell')) {
      const g = this.add.graphics({ x: 0, y: 0 });
      const PURPLE = 0x5A33C8;
      g.fillStyle(PURPLE, 1);
      g.fillRoundedRect(0, 0, 86, 86, 12);
      g.generateTexture('fallback_cell', 86, 86);
      g.destroy();
    }

    if (!this.textures.exists('fallback_empty')) {
      const g = this.add.graphics({ x: 0, y: 0 });
      const LIGHT = 0xd8e6ff;
      g.fillStyle(LIGHT, 1);
      g.fillRoundedRect(0, 0, 86, 86, 12);
      g.generateTexture('fallback_empty', 86, 86);
      g.destroy();
    }

    if (!this.textures.exists('fallback_bg')) {
      const g = this.add.graphics({ x: 0, y: 0 });
      g.fillStyle(0x79B7F5, 1); g.fillRect(0, 0, 1080, 1920);
      g.fillStyle(0x9FD1FF, 0.35); g.fillRect(0, 0, 1080, 640);
      g.fillStyle(0x8BC8FF, 0.25); g.fillRect(0, 640, 1080, 640);
      g.fillStyle(0x7EBEFF, 0.2); g.fillRect(0, 1280, 1080, 640);
      g.generateTexture('fallback_bg', 1080, 1920); g.destroy();
    }

    this._hasMadeFallbacks = true;
  }

  _initFxTextures() {
    if (!this.textures.exists('fx_spark')) {
      const g = this.add.graphics({ x: 0, y: 0 });
      g.fillStyle(0xffffff, 1); g.fillCircle(8, 8, 8);
      g.generateTexture('fx_spark', 16, 16); g.destroy();
    }

    // timer pill
    if (!this.textures.exists('timer_pill')) {
      const w = 220, h = 82, r = 36;
      const g = this.add.graphics({ x: 0, y: 0 });
      g.fillStyle(0xffffff, 0.95);
      g.fillRoundedRect(0, 0, w, h, r);
      g.lineStyle(4, 0xe5e7eb, 1);
      g.strokeRoundedRect(2, 2, w - 4, h - 4, r - 2);
      g.generateTexture('timer_pill', w, h);
      g.destroy();
    }

    if (!this.textures.exists('fallback_pill')) {
      // kept if you reuse elsewhere; not used for score anymore
      const w = 320, h = 70, r = 32;
      const g = this.add.graphics({ x: 0, y: 0 });
      g.fillStyle(0xffffff, 0.92);
      g.fillRoundedRect(0, 0, w, h, r);
      g.lineStyle(4, 0xe5e7eb, 1);
      g.strokeRoundedRect(2, 2, w - 4, h - 4, r - 2);
      g.generateTexture('fallback_pill', w, h); g.destroy();
    }
  }

  _initWheelTextures() {
    // center plate (stacked circles for a faux gradient)
    if (!this.textures.exists('wheel_plate')) {
      const g = this.add.graphics({ x: 0, y: 0 });
      const cx = 200, cy = 200, R = 180;
      g.fillStyle(0xffffff, 0.95); g.fillCircle(cx, cy, R);
      g.fillStyle(0xeaf2ff, 0.9); g.fillCircle(cx, cy, R - 16);
      g.fillStyle(0xdce9ff, 0.9); g.fillCircle(cx, cy, R - 28);
      g.lineStyle(6, 0xc9d7ee, 1); g.strokeCircle(cx, cy, R - 2);
      g.generateTexture('wheel_plate', 400, 400); g.destroy();
    }
    // outer ring
    if (!this.textures.exists('wheel_ring')) {
      const g = this.add.graphics({ x: 0, y: 0 });
      const cx = 220, cy = 220, R = 200;
      g.lineStyle(12, 0x9FC5FF, 1); g.strokeCircle(cx, cy, R);
      g.lineStyle(6, 0xE6F0FF, 1); g.strokeCircle(cx, cy, R - 14);
      g.generateTexture('wheel_ring', 440, 440); g.destroy();
    }
    // soft glow
    if (!this.textures.exists('wheel_glow')) {
      const g = this.add.graphics({ x: 0, y: 0 });
      const cx = 260, cy = 260;
      g.fillStyle(0x9acbff, 0.12); g.fillCircle(cx, cy, 240);
      g.fillStyle(0x9acbff, 0.08); g.fillCircle(cx, cy, 300);
      g.generateTexture('wheel_glow', 520, 520); g.destroy();
    }
  }
}

