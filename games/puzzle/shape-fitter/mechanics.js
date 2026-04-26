export default class MechanicsScene extends Phaser.Scene {
  constructor() {
    super("MechanicsScene");
    Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach(fn => {
      if (typeof this[fn] === "function") this[fn] = this[fn].bind(this);
    });
    this.levelConfig = null;
    this.settings = {};
    this.colors = {};
    this.texts = {};
    this.orientation = {};
    this.overlays = {};
    this.bgmSound = null;

    this._gameObjects = []; // Track gameplay objects for proper removal
  }

  preload() {
    const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));
    const toURL = (p) => /^(https?:)?\/\//i.test(p) ? p : `${basePath}/${p}`;

    this.load.json('levelConfig', `${basePath}/config.json`);

    this.load.once('filecomplete-json-levelConfig', () => {
      this.levelConfig = this.cache.json.get('levelConfig') || {};
      const ui = this.levelConfig.ui || {};
      const images2 = this.levelConfig.images2 || {};
      const audio = this.levelConfig.audio || {};

      const overlayAssets = [
        'start_overlay', 'gameover_overlay', 'levelcomplete_overlay',
        'button_play', 'button_retry', 'button_next',
        'bg', 'scorebar', 'replay_level'
      ];

      // 1) Prefer images2 over ui for known overlay assets
      overlayAssets.forEach((k) => {
        const src = images2[k] || ui[k];
        if (src) {
          this.load.image(k, toURL(src));
          // console.debug('[preload] queued', k, '->', src);
        }
      });

      // 2) Load any EXTRA keys that exist only in images2 (not in overlayAssets)
      Object.keys(images2).forEach((k) => {
        if (!overlayAssets.includes(k)) {
          this.load.image(k, toURL(images2[k]));
          // console.debug('[preload] queued extra images2', k, '->', images2[k]);
        }
      });

      // 3) Audio
      if (audio.bgm) this.load.audio('bgm', toURL(audio.bgm));

      // Ensure the newly queued files actually start loading
      if (!this.load.isLoading()) this.load.start();
    });
  }



  create() {
    const cfg = this.levelConfig || {};
    this.orientation = cfg.orientation || { width: 420, height: 720 };
    this.settings = cfg.game || {};
    this.colors = cfg.colors || {};
    this.texts = cfg.texts || {};

    this.GAME_WIDTH = this.orientation.width;
    this.GAME_HEIGHT = this.orientation.height;
    this.SHAPES = this.settings.shapes || ["circle", "square", "triangle"];
    this.TIMER_DURATION = this.settings.timerDuration || 30;
    this.MAX_MISTAKES = this.settings.maxMistakes || 5;
    this.SNAP_DISTANCE = this.settings.snapDistance || 48;
    this.OUTLINE_SIZE = this.settings.outlineSize || 72;
    this.SHAPE_SIZE = this.settings.shapeSize || 64;
    // Dynamically space shapes based on size
    const totalShapeHeight = this.OUTLINE_SIZE + this.SHAPE_SIZE + 600; // 100 is padding

    // Place outlines higher if shapes are larger
    const centerY = this.GAME_HEIGHT / 2;
    this.OUTLINE_Y = (centerY - totalShapeHeight / 2) / this.GAME_HEIGHT;
    this.SHAPE_Y = (centerY + totalShapeHeight / 2 - this.SHAPE_SIZE) / this.GAME_HEIGHT;



    // this.sys.cameras.main.setBackgroundColor(this.colors.background || "#f9f9fb");
    this.bg = this.add.image(540, 960, 'background')
    this.showOverlay('start');
  }

  // --------- OVERLAY SYSTEM -------------
  showOverlay(type) {
    this.hideOverlay();

    let overlayKey, buttonKey, buttonHandler, buttonText;
    const cx = this.GAME_WIDTH / 2;
    const cy = this.GAME_HEIGHT / 2;
    const container = this.add.container(0, 0);
    this.overlays.container = container;

    const images = this.levelConfig.images || {};

    if (type === 'start') {
      overlayKey = 'start_overlay';
      buttonKey = 'button_play';
      buttonText = this.texts.play || "";
      buttonHandler = () => {
        this.hideOverlay();
        if (this.sys.sound && this.sys.cache.audio.exists('bgm')) {
          if (!this.bgmSound) {
            this.bgmSound = this.sound.add('bgm', { loop: true, volume: 0.5 });
          }
          if (!this.bgmSound.isPlaying) {
            this.bgmSound.play();
          }
        }
        this.resetGame();
      };

    } else if (type === 'gameover') {
      overlayKey = 'gameover_overlay';
      buttonKey = 'button_retry';
      buttonText = this.texts.retry || "";
      buttonHandler = () => { this.hideOverlay(); this.resetGame(); };
    } else if (type === 'nextlevel') {
      overlayKey = 'levelcomplete_overlay';
      buttonKey = 'button_next';
      buttonText = this.texts.next || "";
      buttonHandler = () => {
        this.hideOverlay(); this.notifyParent('sceneComplete', { result: 'win' });
      };
    }

    // Overlay BG
    if (this.sys.textures.exists(overlayKey)) {
      const bg = this.add.image(cx, cy, overlayKey).setOrigin(0.5);
      container.add(bg);
    } else {
      const bg = this.add.rectangle(cx, cy, this.GAME_WIDTH, this.GAME_HEIGHT, 0x232323, 0.8);
      container.add(bg);
    }

    // Position map for each type
    const positions = {
      start: { x: cx, y: cy + 650 },
      gameover: { x: cx, y: cy + 350 },
      nextlevel: { x: cx + 230, y: cy + 340 },
    };

    const pos = positions[type] || { x: cx, y: cy + 400 };

    // Primary Button
    if (this.sys.textures.exists(buttonKey)) {
      const btn = this.add.image(pos.x, pos.y, buttonKey).setOrigin(0.5).setInteractive({ useHandCursor: true });
      btn.on('pointerdown', buttonHandler);
      container.add(btn);

      const label = this.add.text(pos.x, pos.y - 100, buttonText, {
        font: "50px outfit", color: "white"
      }).setOrigin(0.5);
      container.add(label);
    } else {
      const btn = this.add.rectangle(pos.x, pos.y, 180, 60, 0x3985ff, 1).setInteractive({ useHandCursor: true });
      btn.on('pointerdown', buttonHandler);
      container.add(btn);
      const label = this.add.text(pos.x, pos.y, buttonText, {
        font: "50px outfit", color: "white"
      }).setOrigin(0.5);
      container.add(label);
    }

    // Add "How to Play" text for start overlay
    if (type === 'start') {
      const howText = this.texts.howToPlay || "Drag shapes to matching outlines!";
      const howToPlayText = this.add.text(cx, cy, howText, {
        font: "50px outfit", color: "#ffffff", align: "left", wordWrap: { width: this.GAME_WIDTH * 0.8 }
      }).setOrigin(0.5);
      container.add(howToPlayText);
    }

    // Game over message
    if (type === 'gameover') {
      const msg = this.texts.lose || "Too many mistakes!";
      const msgText = this.add.text(cx, cy, msg, {
        font: "50px outfit", color: "white"
      }).setOrigin(0.5);
      container.add(msgText);
    }

    // Win message
    if (type === 'nextlevel') {
      const msg = this.texts.win || "You Win!";
      const msgText = this.add.text(cx, cy, msg, {
        font: "50px outfit", color: "white"
      }).setOrigin(0.5);
      container.add(msgText);

      // Optional replay button
      if (this.sys.textures.exists("replay_level")) {
        const replayBtn = this.add.image(cx - 230, cy + 340, "replay_level").setOrigin(0.5).setInteractive({ useHandCursor: true });
        replayBtn.on('pointerdown', () => {
          this.hideOverlay();
          this.resetGame();
        });
        container.add(replayBtn);
      }
    }

    // Ensure overlay is top
    if (this.children && typeof this.children.bringToTop === 'function') {
      this.children.bringToTop(container);
    }
  }

  notifyParent(type, data) {
    if (window.parent !== window) {
      window.parent.postMessage({ type, ...data }, "*");
    }
  }


  hideOverlay() {
    if (this.overlays.container) {
      this.overlays.container.destroy();
      this.overlays.container = null;
    }
  }
  // --------- END OVERLAY SYSTEM ----------

  // Remove only gameplay objects, not overlays
  clearGameplayObjects() {
    if (Array.isArray(this._gameObjects)) {
      this._gameObjects.forEach(obj => obj?.destroy && obj.destroy());
      this._gameObjects = [];
    }
  }

  resetGame() {
    this.matched = 0;
    this.timer = this.TIMER_DURATION;
    this.mistakes = 0;
    this.dragShape = null;

    // Remove gameplay graphics, NOT overlays
    this.clearGameplayObjects();

    this.add.image(540, 70, 'scorebar')

    // UI: Title, Timer, Mistakes
    this.titleText = this.add.text(
      this.GAME_WIDTH / 2, 30,
      this.texts.title || "",
      { font: "50px outfit", color: "white", align: "center" }
    ).setOrigin(0.5);
    this._gameObjects.push(this.titleText);

    this.timerText = this.add.text(
      this.GAME_WIDTH / 2 + 300, 70,
      (this.texts.timer || "Time Left: {timer}").replace("{timer}", this.timer),
      { font: "50px outfit", color: "white" }
    ).setOrigin(0.5);
    this._gameObjects.push(this.timerText);

    this.mistakesText = this.add.text(
      this.GAME_WIDTH / 2 - 300, 70,
      (this.texts.mistakes || "Mistakes: {mistakes}/{maxMistakes}")
        .replace("{mistakes}", this.mistakes)
        .replace("{maxMistakes}", this.MAX_MISTAKES),
      { font: "50px outfit", color: "white" }
    ).setOrigin(0.5);
    this._gameObjects.push(this.mistakesText);

    // Shuffle order of shape types
    let types = Phaser.Utils.Array.Shuffle(this.SHAPES.slice());

    // Outlines (target drop zones)
    const xOffsets = [
      this.GAME_WIDTH * 0.22,
      this.GAME_WIDTH * 0.5,
      this.GAME_WIDTH * 0.78,
    ];

    this.outlines = [];
    for (let i = 0; i < 3; i++) {
      let o = this.makeOutline(
        types[i],
        xOffsets[i],
        this.GAME_HEIGHT * this.OUTLINE_Y,
        this.OUTLINE_SIZE
      );
      this.outlines.push(o);
      this._gameObjects.push(o);
    }

    // Shapes to drag
    this.shapes = [];
    for (let i = 0; i < 3; i++) {
      let s = this.makeShape(
        types[i],
        xOffsets[i],
        this.GAME_HEIGHT * this.SHAPE_Y,
        this.SHAPE_SIZE,
        i
      );
      this.shapes.push(s);
      this._gameObjects.push(s);
    }

    this.input.on("pointerdown", this.onDown, this);
    this.input.on("pointermove", this.onMove, this);
    this.input.on("pointerup", this.onUp, this);

    this.timerEvent = this.time.addEvent({
      delay: 1000,
      callback: () => {
        this.timer--;
        this.timerText.setText(
          (this.texts.timer || "Time Left: {timer}").replace("{timer}", this.timer)
        );
        if (this.timer <= 0) this.endGame(false, this.texts.timeout || "Time's up!");
      },
      loop: true,
    });
  }

  makeOutline(type, x, y, size) {
    let g = this.add.graphics();
    g.lineStyle(5, Phaser.Display.Color.HexStringToColor(this.colors.outline || "#cccccc").color, 1);
    if (type === "circle") g.strokeCircle(x, y, size / 2);
    if (type === "square") g.strokeRect(x - size / 2, y - size / 2, size, size);
    if (type === "triangle") {
      let h = (size * Math.sqrt(3)) / 2;
      g.strokeTriangle(
        x,
        y - h / 2,
        x - size / 2,
        y + h / 2,
        x + size / 2,
        y + h / 2
      );
    }
    if (type === "hexagon") {
      const r = size / 2;
      const points = [];
      for (let i = 0; i < 6; i++) {
        const angle = Phaser.Math.DegToRad(60 * i - 30);
        points.push({ x: x + r * Math.cos(angle), y: y + r * Math.sin(angle) });
      }
      g.strokePoints(points, true);
    }

    g.type = type;
    g.x0 = x;
    g.y0 = y;
    return g;
  }

  makeShape(type, x, y, size, idx) {
    let g = this.add.graphics({ x: 0, y: 0 });
    let color = Phaser.Display.Color.HexStringToColor(
      this.colors["shape" + idx] ||
      Phaser.Display.Color.RGBStringToColor(
        `rgb(${70 + idx * 60},${179 + idx * 30},${230 - idx * 40})`
      ).color
    ).color;
    g.fillStyle(color, 1);

    if (type === "circle") g.fillCircle(x, y, size / 2);
    if (type === "square") g.fillRect(x - size / 2, y - size / 2, size, size);
    if (type === "triangle") {
      let h = (size * Math.sqrt(3)) / 2;
      g.fillTriangle(
        x,
        y - h / 2,
        x - size / 2,
        y + h / 2,
        x + size / 2,
        y + h / 2
      );
    }
    if (type === "hexagon") {
      const r = size / 2;
      const points = [];
      for (let i = 0; i < 6; i++) {
        const angle = Phaser.Math.DegToRad(60 * i - 30);
        points.push({ x: x + r * Math.cos(angle), y: y + r * Math.sin(angle) });
      }
      g.beginPath();
      g.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y);
      g.closePath();
      g.fillPath();
    }

    g.type = type;
    g.size = size;
    g.idx = idx;
    g.home = { x, y };
    g.logic = { x, y, matched: false };
    g.setInteractive(
      new Phaser.Geom.Rectangle(x - size / 2, y - size / 2, size, size),
      Phaser.Geom.Rectangle.Contains
    );
    return g;
  }

  onDown(pointer, targets) {
    if (this.matched === 3 || this.dragShape) return;
    let found = this.shapes.find(
      (s) => targets.includes(s) && !s.logic.matched
    );
    if (found) {
      this.dragShape = found;
      this.dragOffset = {
        x: found.logic.x - pointer.x,
        y: found.logic.y - pointer.y,
      };
      if (this.children && typeof this.children.bringToTop === 'function') {
        this.children.bringToTop(found);
      }
    }
  }

  onMove(pointer) {
    if (!this.dragShape) return;
    let x = Phaser.Math.Clamp(
      pointer.x + this.dragOffset.x,
      0,
      this.GAME_WIDTH
    );
    let y = Phaser.Math.Clamp(
      pointer.y + this.dragOffset.y,
      0,
      this.GAME_HEIGHT
    );
    this.dragShape.logic.x = x;
    this.dragShape.logic.y = y;
    this.redrawShape(this.dragShape, x, y);
  }

  onUp() {
    if (!this.dragShape) return;
    let shape = this.dragShape;
    let snapped = false;

    for (let outline of this.outlines) {
      if (outline.type === shape.type) {
        let dx = shape.logic.x - outline.x0;
        let dy = shape.logic.y - outline.y0;
        if (Math.sqrt(dx * dx + dy * dy) < this.SNAP_DISTANCE) {
          snapped = true;
          shape.logic.x = outline.x0;
          shape.logic.y = outline.y0;
          shape.logic.matched = true;
          this.redrawShape(shape, outline.x0, outline.y0);
          this.matched++;
          break;
        }
      }
    }

    if (!snapped) {
      let { x, y } = shape.home;
      this.sys.tweens.add({
        targets: shape.logic,
        x,
        y,
        duration: 200,
        onUpdate: () => {
          this.redrawShape(shape, shape.logic.x, shape.logic.y);
        },
      });
      this.mistakes++;
      this.mistakesText.setText(
        (this.texts.mistakes || "Mistakes: {mistakes}/{maxMistakes}")
          .replace("{mistakes}", this.mistakes)
          .replace("{maxMistakes}", this.MAX_MISTAKES)
      );
    }

    if (this.matched === 3) {
      this.time.delayedCall(300, () => this.endGame(true, this.texts.win || "You Win!"));
    } else if (this.mistakes >= this.MAX_MISTAKES) {
      this.time.delayedCall(300, () =>
        this.endGame(false, this.texts.lose || "Too many mistakes!")
      );
    }

    this.dragShape = null;
  }

  redrawShape(shape, x, y) {
    shape.clear();
    let color = Phaser.Display.Color.HexStringToColor(
      this.colors["shape" + shape.idx] ||
      Phaser.Display.Color.RGBStringToColor(
        `rgb(${70 + shape.idx * 60},${179 + shape.idx * 30},${230 - shape.idx * 40})`
      ).color
    ).color;
    shape.fillStyle(color, 1);

    if (shape.type === "circle") shape.fillCircle(x, y, shape.size / 2);
    if (shape.type === "square")
      shape.fillRect(
        x - shape.size / 2,
        y - shape.size / 2,
        shape.size,
        shape.size
      );
    if (shape.type === "triangle") {
      let h = (shape.size * Math.sqrt(3)) / 2;
      shape.fillTriangle(
        x,
        y - h / 2,
        x - shape.size / 2,
        y + h / 2,
        x + shape.size / 2,
        y + h / 2
      );
    }
    if (shape.type === "hexagon") {
      const r = shape.size / 2;
      const points = [];
      for (let i = 0; i < 6; i++) {
        const angle = Phaser.Math.DegToRad(60 * i - 30);
        points.push({ x: x + r * Math.cos(angle), y: y + r * Math.sin(angle) });
      }
      shape.beginPath();
      shape.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) shape.lineTo(points[i].x, points[i].y);
      shape.closePath();
      shape.fillPath();
    }

  }

  endGame(win, msg) {
    this.input.off("pointerdown", this.onDown, this);
    this.input.off("pointermove", this.onMove, this);
    this.input.off("pointerup", this.onUp, this);
    if (this.timerEvent) this.timerEvent.remove();
    if (this.bgmSound && this.bgmSound.isPlaying) {
      this.bgmSound.stop();
    }


    this.time.delayedCall(250, () => {
      if (win) {
        this.showOverlay('nextlevel');
      } else {
        this.showOverlay('gameover');
      }
    });
  }

  update() { }
}
