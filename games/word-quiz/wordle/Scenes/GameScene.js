class GameScene extends Phaser.Scene {
  constructor() {
    super("GameScene");

    // Logical portrait canvas; Scale Manager will fit to device
    this.W = 1080;
    this.H = 1920;

    // Config & state
    this.cfg = null;
    this.answer = "";
    this.wordLen = 5;
    this.maxRows = 6;

    // Visual layers
    this.bg = null;
    this.keyGfx = null; // keyboard caps (graphics)

    // Row containers to prevent layout drift
    this.rowContainers = []; // [row] -> Phaser.GameObjects.Container

    // Tile objects (for per-tile animations)
    this.tileRects = []; // [row][col] -> Rectangle (positions are local to row container)
    this.tileLabels = []; // [row][col] -> Text (local to row container)

    // Hint UI
    this.hintText = null;

    // Gameplay
    this.grid = []; // rows of chars
    this.row = 0; // current row
    this.col = 0; // current col (cursor)
    this.keyRects = []; // hit areas for on-screen keyboard
    this.keyStatus = {}; // letter => 'correct' | 'present' | 'absent'

    // Audio
    this.sfx = { key: null, hit: null, win: null, bgm: null };

    // Colors (can be overridden by cfg.gameplay.colors)
    this.colors = {
      bg: 0xf2f2f2,
      tile: 0xdadada,
      text: "#111111",
      correct: 0x6aaa64, // green
      present: 0xc9b458, // yellow
      absent: 0x787c7e, // gray
      key: 0xd7dadd,
      keyText: "#111111",
    };
  }

  preload() {
    const cfg = this.registry.get("cfg") || {};
    this.cfg = cfg;

    // load images (from your library only)
    if (cfg.images2)
      Object.entries(cfg.images2).forEach(([key, url]) =>
        this.load.image(key, url)
      );
    if (cfg.ui)
      Object.entries(cfg.ui).forEach(([key, url]) => this.load.image(key, url));
    // audio
    if (cfg.audio)
      Object.entries(cfg.audio).forEach(([key, url]) =>
        this.load.audio(key, url)
      );
    // font (optional)
    // if (cfg.font?.url) this.load.ttf("wordfont", cfg.font.url);
  }

  create() {
    // ---- Scale / background ----
    this.scale.resize(this.W, this.H);
    this.scale.scaleMode = Phaser.Scale.FIT;

    const gp = this.cfg.gameplay || {};
    this.wordLen = gp.wordLength ?? 5;
    this.maxRows = gp.maxRows ?? 6;

    // merge color overrides
    if (gp.colors) this.colors = { ...this.colors, ...gp.colors };

    // background image or flat color
    if (this.cfg.images2?.background) {
      this.bg = this.add
        .image(this.W / 2, this.H / 2, "background")
        .setDisplaySize(this.W, this.H);
    } else {
      this.cameras.main.setBackgroundColor(
        Phaser.Display.Color.IntegerToColor(this.colors.bg)
      );
    }

    // audio setup
    if (this.cfg.audio?.bgm) {
      this.sfx.bgm = this.sound.add("bgm", { loop: true, volume: 0.35 });
      this.sfx.bgm.play();
    }
    if (this.cfg.audio?.collect)
      this.sfx.key = this.sound.add("collect", { volume: 0.7 });
    if (this.cfg.audio?.hit)
      this.sfx.hit = this.sound.add("hit", { volume: 0.9 });
    if (this.cfg.audio?.win)
      this.sfx.win = this.sound.add("win", { volume: 1.0 });

    // choose answer (random each run by default; daily/fixed supported)
    this.answer = this._pickAnswer();

    // init grid
    this.grid = Array.from({ length: this.maxRows }, () =>
      Array(this.wordLen).fill("")
    );

    // title + hint
    const fontFamily =
      this.cfg.font && this.cfg.font.family
        ? this.cfg.font.family
        : "Outfit, Arial";
    this.add
      .text(this.W / 2, 90, gp.titleText ?? "WORDLY", {
        fontFamily,
        fontSize: "92px",
        fontStyle: "bold",
        color: this.colors.text,
      })
      .setOrigin(0.5);

    const hint = this._getClueFor(this.answer);
    this.hintText = this.add
      .text(this.W / 2, 170, "Hint: " + hint, {
        fontFamily,
        fontSize: "36px",
        color: "#FFF",
        align: "center",
        wordWrap: { width: this.W - 120 },
      })
      .setOrigin(0.5)
      .setAlpha(0);

    // float-in animation for hint (subtle)
    this.tweens.add({
      targets: this.hintText,
      alpha: 1,
      y: "+=8",
      duration: 500,
      ease: "Sine.Out",
      delay: 200,
    });

    // draw grid board (per-row container; per-tile as children)
    this._layoutGrid(fontFamily);

    // draw on-screen keyboard
    this._layoutKeyboard(fontFamily);

    // input: physical keyboard
    this.input.keyboard.on("keydown", (ev) => this._onKeyDown(ev.key));

    // input: on-screen keyboard taps
    this.input.on("pointerdown", (p) => this._handleKeyboardTap(p));

    // resize anchoring
    this.scale.on("resize", () => {
      if (this.bg)
        this.bg
          .setDisplaySize(this.W, this.H)
          .setPosition(this.W / 2, this.H / 2);
    });

    // soft camera zoom-in at start for polish
    this.cameras.main.setZoom(0.98);
    this.tweens.add({
      targets: this.cameras.main,
      zoom: 1,
      duration: 600,
      ease: "Quad.Out",
    });
  }

  // ============ Layout ============

  _layoutGrid(fontFamily) {
    // Grid area centered higher on screen
    const top = 240;
    const gap = 16;
    const tileSize = Math.min(
      140,
      (this.W - 2 * 80 - (this.wordLen - 1) * gap) / this.wordLen
    );
    const left =
      (this.W - (this.wordLen * tileSize + (this.wordLen - 1) * gap)) / 2;

    this.gridGeom = { left, top, tileSize, gap };

    // Row containers
    this.rowContainers = Array.from({ length: this.maxRows }, () =>
      this.add.container(0, 0)
    );
    this.tileRects = Array.from({ length: this.maxRows }, () =>
      Array(this.wordLen)
    );
    this.tileLabels = Array.from({ length: this.maxRows }, () =>
      Array(this.wordLen)
    );

    for (let r = 0; r < this.maxRows; r++) {
      const rowY = top + r * (tileSize + gap); // absolute row Y used only to compute child local Y
      for (let c = 0; c < this.wordLen; c++) {
        const x = left + c * (tileSize + gap);
        const y = rowY;
        // Children positions are absolute, but when added to container they become local to container (container at 0,0)
        const rect = this.add.rectangle(
          x + tileSize / 2,
          y + tileSize / 2,
          tileSize,
          tileSize,
          this.colors.tile,
          1
        );
        rect.setOrigin(0.5).setScale(0.96);
        this.tweens.add({
          targets: rect,
          scaleX: 1,
          scaleY: 1,
          duration: 300,
          ease: "Back.Out",
          delay: 12 * (r * this.wordLen + c),
        });
        this.rowContainers[r].add(rect);
        this.tileRects[r][c] = rect;

        const label = this.add
          .text(rect.x, rect.y, "", {
            fontFamily,
            fontSize: Math.round(tileSize * 0.5) + "px",
            fontStyle: "bold",
            color: this.colors.text,
          })
          .setOrigin(0.5)
          .setScale(0.96);
        this.tweens.add({
          targets: label,
          scaleX: 1,
          scaleY: 1,
          duration: 300,
          ease: "Back.Out",
          delay: 12 * (r * this.wordLen + c),
        });
        this.rowContainers[r].add(label);
        this.tileLabels[r][c] = label;
      }
    }
  }

  _layoutKeyboard(fontFamily) {
    const rows = this.cfg.gameplay?.keyboardRows ?? [
      "QWERTYUIOP",
      "ASDFGHJKL",
      "{ENTER}ZXCVBNM{DEL}",
    ];

    const kbTop = 1180;
    const kbGap = 12;
    const keyH = 120;
    const sidePad = 40;

    this.keyRects = [];
    if (this.keyGfx) this.keyGfx.destroy();
    this.keyGfx = this.add.graphics();

    let y = kbTop;
    rows.forEach((row) => {
      const tokens = this._tokenizeRow(row);
      const totalFlex = tokens.reduce(
        (acc, t) => acc + (t.special ? 1.6 : 1),
        0
      );
      const keyW =
        (this.W - sidePad * 2 - kbGap * (tokens.length - 1)) / totalFlex;

      let x = sidePad;
      tokens.forEach((t) => {
        const w = keyW * (t.special ? 1.6 : 1);
        // Draw keycap
        this.keyGfx
          .fillStyle(this.colors.key, 1)
          .fillRoundedRect(x, y, w, keyH, 12);

        const label = t.special
          ? t.code === "ENTER"
            ? "ENTER"
            : "DEL"
          : t.code;
        const txt = this.add
          .text(x + w / 2, y + keyH / 2, label, {
            fontFamily,
            fontSize: (t.special ? 44 : 54) + "px",
            fontStyle: "bold",
            color: this.colors.keyText,
          })
          .setOrigin(0.5);
        // float-in
        txt.setAlpha(0);
        this.tweens.add({
          targets: txt,
          alpha: 1,
          duration: 220,
          delay: 20 * this.keyRects.length,
        });

        this.keyRects.push({
          x,
          y,
          w,
          h: keyH,
          code: t.code,
          special: t.special,
        });

        x += w + kbGap;
      });

      y += keyH + kbGap;
    });
  }

  _tokenizeRow(str) {
    const tokens = [];
    let i = 0;
    while (i < str.length) {
      if (str[i] === "{") {
        const j = str.indexOf("}", i + 1);
        const code = str.slice(i + 1, j);
        tokens.push({ code, special: true });
        i = j + 1;
      } else {
        tokens.push({ code: str[i], special: false });
        i++;
      }
    }
    return tokens;
  }

  // ============ Input Handling ============

  _handleKeyboardTap(p) {
    for (const rect of this.keyRects) {
      if (
        p.x >= rect.x &&
        p.x <= rect.x + rect.w &&
        p.y >= rect.y &&
        p.y <= rect.y + rect.h
      ) {
        // key press pop animation (quick flash rectangle)
        const flash = this.add
          .rectangle(
            rect.x + rect.w / 2,
            rect.y + rect.h / 2,
            rect.w,
            rect.h,
            0xffffff,
            0.18
          )
          .setOrigin(0.5);
        this.tweens.add({
          targets: flash,
          alpha: 0,
          duration: 110,
          onComplete: () => flash.destroy(),
        });

        this._pressKey(rect.code);
        break;
      }
    }
  }

  _onKeyDown(key) {
    const k = key.toUpperCase();
    if (k.length === 1 && k >= "A" && k <= "Z") this._pressKey(k);
    else if (k === "ENTER" || key === "Enter") this._pressKey("ENTER");
    else if (k === "BACKSPACE" || key === "Backspace" || k === "DELETE")
      this._pressKey("DEL");
  }

  _pressKey(code) {
    if (this.row >= this.maxRows) return; // game already ended

    if (code === "ENTER") {
      if (!this._isRowComplete(this.row)) {
        if (this.sfx.hit) this.sfx.hit.play();
        this._shakeRow(this.row); // row shake animation (container-based, no drift)
        return;
      }
      this._submitRow();
      return;
    }

    if (code === "DEL") {
      if (this.col > 0) {
        this.col--;
        this.grid[this.row][this.col] = "";
        this._updateLetters();
      }
      return;
    }

    // A–Z letter input
    if (code.length === 1) {
      if (this.col >= this.wordLen) return;
      this.grid[this.row][this.col] = code;
      if (this.sfx.key) this.sfx.key.play();
      this._updateLetters();

      // tile pop animation (scale only; position untouched)
      const rect = this.tileRects[this.row][this.col];
      const lbl = this.tileLabels[this.row][this.col];
      this.tweens.add({
        targets: [rect, lbl],
        scaleX: 1.08,
        scaleY: 1.08,
        duration: 90,
        yoyo: true,
        ease: "Back.Out",
      });

      this.col++;
    }
  }

  _updateLetters() {
    for (let r = 0; r < this.maxRows; r++) {
      for (let c = 0; c < this.wordLen; c++) {
        this.tileLabels[r][c].setText(this.grid[r][c]);
      }
    }
  }

  // ============ Game Rules ============

  _submitRow() {
    if (!this._isRowComplete(this.row)) {
      if (this.sfx.hit) this.sfx.hit.play();
      this._shakeRow(this.row);
      return;
    }

    const guess = this.grid[this.row].join("");
    if (!this._isValidGuess(guess)) {
      if (this.sfx.hit) this.sfx.hit.play();
      this._shakeRow(this.row);
      return;
    }

    const { mapping, keyStatusDelta } = this._evaluate(guess, this.answer);

    // Flip reveal animation for this row with color change
    this._flipRevealRow(this.row, mapping);

    // Update keyboard status (with smooth tween) after flips
    this.time.delayedCall(420 + 130 * this.wordLen, () => {
      Object.entries(keyStatusDelta).forEach(([ch, status]) => {
        const prev = this.keyStatus[ch];
        if (
          !prev ||
          (prev === "present" && status === "correct") ||
          (prev === "absent" && status !== "absent")
        ) {
          this.keyStatus[ch] = status;
        }
      });
      this._repaintKeyboardSmooth();
    });

    // Win?
    if (guess === this.answer) {
      this.time.delayedCall(450 + 130 * this.wordLen, () => {
        if (this.sfx.win) this.sfx.win.play();
        if (this.sfx.bgm) this.sfx.bgm.stop();

        // celebrate: cascade bounce + slight zoom pulse + confetti
        for (let c = 0; c < this.wordLen; c++) {
          const rect = this.tileRects[this.row][c];
          const lbl = this.tileLabels[this.row][c];
          this.tweens.add({
            targets: [rect, lbl],
            scaleY: 1.14,
            scaleX: 1.14,
            yoyo: true,
            duration: 130,
            ease: "Back.Out",
            delay: c * 40,
          });
        }
        this.tweens.add({
          targets: this.cameras.main,
          zoom: 1.03,
          duration: 160,
          yoyo: true,
          ease: "Sine.InOut",
        });
        this._confettiBurst();

        this.time.delayedCall(420, () => this.scene.start("WinScene"));
      });
      return;
    }

    // Advance after flip finishes
    this.time.delayedCall(450 + 130 * this.wordLen, () => {
      this.row++;
      this.col = 0;
      if (this.row >= this.maxRows) {
        if (this.sfx.bgm) this.sfx.bgm.stop();
        this.cameras.main.shake(260, 0.006);
        return this.time.delayedCall(280, () =>
          this.scene.start("GameOverScene")
        );
      }
    });
  }

  _repaintKeyboardSmooth() {
    // redraw keyboard caps with tweened color flash
    if (!this.keyGfx) return;
    this.keyGfx.clear();

    const rows = this.cfg.gameplay?.keyboardRows ?? [
      "QWERTYUIOP",
      "ASDFGHJKL",
      "{ENTER}ZXCVBNM{DEL}",
    ];
    const kbTop = 1180,
      kbGap = 12,
      keyH = 120,
      sidePad = 40;

    let y = kbTop;
    rows.forEach((row) => {
      const tokens = this._tokenizeRow(row);
      const totalFlex = tokens.reduce(
        (acc, t) => acc + (t.special ? 1.6 : 1),
        0
      );
      const keyW =
        (this.W - sidePad * 2 - kbGap * (tokens.length - 1)) / totalFlex;

      let x = sidePad;
      tokens.forEach((t) => {
        const w = keyW * (t.special ? 1.6 : 1);
        let fill = this.colors.key;
        if (!t.special) {
          const s = this.keyStatus[t.code];
          if (s === "correct") fill = this.colors.correct;
          else if (s === "present") fill = this.colors.present;
          else if (s === "absent") fill = this.colors.absent;
        }
        // quick white flash then settle to color
        const flash = this.add
          .rectangle(x + w / 2, y + keyH / 2, w, keyH, 0xffffff, 0.22)
          .setOrigin(0.5);
        this.tweens.add({
          targets: flash,
          alpha: 0,
          duration: 120,
          onComplete: () => flash.destroy(),
        });

        this.keyGfx.fillStyle(fill, 1).fillRoundedRect(x, y, w, keyH, 12);

        x += w + kbGap;
      });
      y += keyH + kbGap;
    });
  }

  _evaluate(guess, answer) {
    // Standard Wordle rules with duplicate handling
    const res = Array(this.wordLen).fill("absent");
    const keyDelta = {};
    const answerChars = answer.split("");
    const used = Array(this.wordLen).fill(false);

    // First pass: correct
    for (let i = 0; i < this.wordLen; i++) {
      if (guess[i] === answer[i]) {
        res[i] = "correct";
        used[i] = true;
      }
    }
    // Second pass: present
    for (let i = 0; i < this.wordLen; i++) {
      if (res[i] === "correct") continue;
      const gi = guess[i];
      let found = false;
      for (let j = 0; j < this.wordLen; j++) {
        if (!used[j] && gi === answerChars[j]) {
          used[j] = true;
          found = true;
          break;
        }
      }
      if (found) res[i] = "present";
    }

    // Build keyboard delta
    for (let i = 0; i < this.wordLen; i++) {
      const ch = guess[i];
      const st = res[i];
      const prev = keyDelta[ch];
      if (
        !prev ||
        (prev === "present" && st === "correct") ||
        (prev === "absent" && st !== "absent")
      ) {
        keyDelta[ch] = st;
      }
    }
    return { mapping: res, keyStatusDelta: keyDelta };
  }

  _pickAnswer() {
    // Modes:
    // - fixedAnswer (if set in config) => exactly that
    // - dailyWord (set gameplay.dailyWord=true) => deterministic by UTC day
    // - default => random each run (so it changes every time)
    const len = this.cfg.gameplay?.wordLength ?? 5;
    const pool = (
      this.cfg.words?.answerPool || [
        "APPLE",
        "BRAIN",
        "CHAOS",
        "DELTA",
        "GHOST",
        "MIXER",
        "PLANT",
        "ROBOT",
        "TIGER",
        "WATER",
        "CLOUD",
        "HONEY",
        "LASER",
        "QUIET",
        "RIVER",
        "SMILE",
        "SOLID",
        "TRACK",
        "UNITY",
        "VIVID",
      ]
    )
      .filter((w) => w.length === len)
      .map((w) => w.toUpperCase());

    if (!pool.length) return "APPLE";

    const fixed = (this.cfg.gameplay?.fixedAnswer || "").toUpperCase();
    if (fixed && fixed.length === len) return fixed;

    if (this.cfg.gameplay?.dailyWord) {
      const days = Math.floor(Date.now() / 86400000); // days since epoch
      const idx = ((days * 1664525 + 1013904223) >>> 0) % pool.length; // LCG-ish
      return pool[idx];
    }
    return pool[Math.floor(Math.random() * pool.length)];
  }

  _isValidGuess(guess) {
    const v1 = (this.cfg.words?.answerPool || []).map((x) => x.toUpperCase());
    const v2 = (this.cfg.words?.validGuesses || []).map((x) => x.toUpperCase());
    if (v1.length || v2.length) return v1.includes(guess) || v2.includes(guess);
    return /^[A-Z]+$/.test(guess) && guess.length === this.wordLen;
  }

  // ===== Animations =====

  _shakeRow(r) {
    // Tween the ROW CONTAINER, not individual tiles (prevents layout drift)
    const cont = this.rowContainers[r];
    if (!cont) return;
    cont.x = 0;
    this.tweens.add({
      targets: cont,
      x: { from: 0, to: 12 },
      yoyo: true,
      repeat: 3,
      duration: 40,
      ease: "Sine.InOut",
      onComplete: () => {
        cont.x = 0;
      },
    });
  }

  _flipRevealRow(r, mapping) {
    const colorFor = (m) =>
      m === "correct"
        ? this.colors.correct
        : m === "present"
        ? this.colors.present
        : this.colors.absent;
    for (let c = 0; c < this.wordLen; c++) {
      const rect = this.tileRects[r][c];
      const lbl = this.tileLabels[r][c];
      const delay = 130 * c;

      // flip: scaleY down → recolor → scaleY up with easing (scale only; no position change)
      this.tweens.add({
        targets: [rect, lbl],
        scaleY: 0.05,
        duration: 120,
        delay,
        ease: "Cubic.In",
        yoyo: false,
        onComplete: () => {
          rect.fillColor = colorFor(mapping[c]);
          this.tweens.add({
            targets: [rect, lbl],
            scaleY: 1,
            duration: 160,
            ease: "Back.Out",
          });
        },
      });
    }
  }

  _confettiBurst() {
    // simple particles using rectangles (absolute positions computed once; no tile mutation)
    const pieces = 28;
    for (let i = 0; i < pieces; i++) {
      const px = this.W / 2 + Phaser.Math.Between(-80, 80);
      const py =
        this.gridGeom.top +
        this.row * (this.gridGeom.tileSize + this.gridGeom.gap) +
        this.gridGeom.tileSize / 2;
      const r = this.add.rectangle(
        px,
        py,
        Phaser.Math.Between(8, 14),
        Phaser.Math.Between(8, 14),
        Phaser.Display.Color.RandomRGB().color,
        1
      );
      r.setAlpha(0.95);
      const dx = Phaser.Math.Between(-260, 260);
      const dy = Phaser.Math.Between(-640, -360);
      const rot = Phaser.Math.FloatBetween(-2, 2);
      this.tweens.add({
        targets: r,
        x: px + dx,
        y: py + dy,
        angle: `+=${rot * 180}`,
        alpha: 0,
        duration: Phaser.Math.Between(600, 900),
        ease: "Cubic.Out",
        onComplete: () => r.destroy(),
      });
    }
  }

  // ===== Helpers =====

  _isRowComplete(r) {
    for (let c = 0; c < this.wordLen; c++)
      if (this.grid[r][c] === "") return false;
    return true;
  }

  _getClueFor(word) {
    // prefer config clue if supplied
    const cfgClue = this.cfg.words?.clues?.[word];
    if (cfgClue) return cfgClue;

    // fallback hard-but-fair clues for the default pool
    const fallback = {
      APPLE: "Famous for keeping appointments away from doctors.",
      BRAIN: "The engine that never burns fuel.",
      CHAOS: "When order forgets its manners.",
      DELTA: "A change, or a river’s patient handwriting.",
      GHOST: "Seen when courage blinks.",
      MIXER: "It blends without judgment.",
      PLANT: "Eats light, drinks quietly.",
      ROBOT: "It obeys logic, not lunch breaks.",
      TIGER: "Striped thunder wrapped in fur.",
      WATER: "It wears mountains down by being soft.",
      CLOUD: "A traveler with no suitcase.",
      HONEY: "Sunlight archived in jars.",
      LASER: "Light taught to keep a straight face.",
      QUIET: "When sound is thinking.",
      RIVER: "A road that moves while you stand still.",
      SMILE: "A curve that edits moods.",
      SOLID: "Matter that refuses to wander.",
      TRACK: "A path that stays to be chased.",
      UNITY: "Many acting as if one.",
      VIVID: "Color that remembers your eyes.",
    };
    return fallback[word] || "It’s obvious only after you know it.";
  }
}
