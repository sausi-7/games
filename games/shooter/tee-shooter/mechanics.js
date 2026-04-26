export default class Main extends Phaser.Scene {
  constructor() {
    super('Main');
    Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach(fn => {
      if (typeof this[fn] === 'function') {
        this[fn] = this[fn].bind(this);
      }
    });
    this.windowRects = [];
    this.charSprites = [];
    this.kills = 0;
    this.isActive = false;
    this.activeCharIdx = -1;
    this.activeTimer = null;
    this.killText = null;
    this.levelConfig = null;
    this.windowImages = [];
    this.characterImages = [];
    // Overlays
    this.startOverlay = null;
    this.gameOverOverlay = null;
    this.levelCompleteOverlay = null;
    this.gameState = 'start';

    this.misses = 0;
    this.missText = null;
    this.bgmSound = null;

    // HUD backgrounds (graphic pills)
    this.killBg = null;
    this.missBg = null;
  }

  // preload() {
  //   const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));
  //   this.load.json('levelConfig', `${basePath}/config.json`);
  //   this.load.once('filecomplete-json-levelConfig', () => {
  //     const cfg = this.cache.json.get('levelConfig');
  //     this.levelConfig = cfg;

  //     if (cfg.images1) {
  //       for (const [key, url] of Object.entries(cfg.images1)) {
  //         this.load.image(key, `${basePath}/${url}`);
  //       }
  //     }
  //     if (cfg.images2) {
  //       for (const [key, url] of Object.entries(cfg.images2)) {
  //         this.load.image(key, `${basePath}/${url}`);
  //       }
  //     }

  //     if (cfg.ui) {
  //       for (const [key, url] of Object.entries(cfg.ui)) {
  //         this.load.image(key, `${basePath}/${url}`);
  //       }
  //     }
  //     if (cfg.audio) {
  //       for (const [key, url] of Object.entries(cfg.audio)) {
  //         this.load.audio(key, `${basePath}/${url}`);
  //       }
  //     }
  //     this.load.start();
  //   });
  // }

  preload() {
    const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));
    this.load.json('levelConfig', `${basePath}/config.json`);

    this.load.once('filecomplete-json-levelConfig', () => {
      const cfg = this.cache.json.get('levelConfig');
      this.levelConfig = cfg;

      // images1
      if (cfg.images1) {
        for (const [key, url] of Object.entries(cfg.images1)) {
          const full = /^https?:\/\//i.test(url) ? url : `${basePath}/${url}`;
          this.load.image(key, full);
        }
      }
      // images2
      if (cfg.images2) {
        for (const [key, url] of Object.entries(cfg.images2)) {
          const full = /^https?:\/\//i.test(url) ? url : `${basePath}/${url}`;
          this.load.image(key, full);
        }
      }
      // ui
      if (cfg.ui) {
        for (const [key, url] of Object.entries(cfg.ui)) {
          const full = /^https?:\/\//i.test(url) ? url : `${basePath}/${url}`;
          this.load.image(key, full);
        }
      }
      // ✅ AUDIO (fixes: use cfg not config, and don't prepend basePath for absolute URLs)
      if (cfg.audio) {
        for (const [key, url] of Object.entries(cfg.audio)) {
          const full = /^https?:\/\//i.test(url) ? url : `${basePath}/${url}`;
          // Phaser handles CORS automatically; the absolute URL must allow it.
          this.load.audio(key, full);
        }
      }

      this.load.start();
    });
  }


  create() {
    // Init config references
    const cfg = this.levelConfig;
    const orientation = cfg.orientation;
    this.gameConfig = cfg.game;
    this.colors = cfg.colors;
    this.texts = cfg.texts;
    this.images = cfg.images;

    const levelData = this.cache.json.get('levelConfig');
    this.levelData = levelData; // Keep for endLevel

    // Apply orientation from config
    if (levelData.orientation?.frame === 'landscape' && screen.orientation && screen.orientation.lock) {
      screen.orientation
        .lock('landscape-primary')
        .catch(err => console.warn('Orientation lock failed:', err));
    }

    this.gameW = orientation.width;
    this.gameH = orientation.height;

    this.add.image(960, 540, 'bg');

    this.kills = 0;
    this.windowRects = this.getWindowRects();
    this.charSprites = [];
    this.windowImages = [];
    this.characterImages = [];
    this.killText = null;
    this.isActive = false;

    // Create overlays
    this.createStartOverlay();
    this.createGameOverOverlay();
    this.createLevelCompleteOverlay();
    this.hideOverlays();
    this.showStart();

    // Only listen for gameplay taps while game is running
    this.input.on('pointerdown', pointer => {
      if (this.gameState === 'playing') this.handleTap(pointer);
    });
  }

  showStart() {
    this.kills = 0;
    this.gameState = 'start';
    this.hideOverlays();
    this.startOverlay.setVisible(true);
  }

  startGame() {
    this.hideOverlays();
    this.kills = 0;
    this.isActive = true;
    this.gameState = 'playing';

    this.misses = 0;

    this._ensureBgm(0.2);       // make sure it exists (optional low vol)
    this._fadeBgm(0.5, 250);    // bring it up for gameplay


    // Clear old HUD
    if (this.missText) this.missText.destroy();
    if (this.killText) this.killText.destroy();
    if (this.killBg) this.killBg.destroy();
    if (this.missBg) this.missBg.destroy();

    // Remove previous sprites/images
    this.charSprites.forEach(obj => obj?.destroy?.());
    this.charSprites = [];
    this.windowImages.forEach(obj => obj?.destroy?.());
    this.windowImages = [];

    this.windowRects = this.getWindowRects();

    // --- HUD (no scorebar; stylish text pills) ---
    // KILLS (center-top, green)
    this.killText = this._makeText(
      this.gameW / 2 - 500, 60,
      this.texts.kills.replace('{kills}', 0).replace('{maxKills}', this.gameConfig.killsToWin),
      {
        size: 46,
        origin: 0.5,
        strokeThickness: 12,
        shadowOffsetY: 6,
        fontStyle: '900',
      }
    );
    this.killBg = this._drawBadgeBehind(this.killText, {
      fill: this.colors?.terrorist || '#16a34a', // use provided color if present
      alpha: 0.22,
      radius: 20,
      padX: 28,
      padY: 12,
      outlineAlpha: 0.35
    });

    // MISSES (top-right, red)
    this.missText = this._makeText(
      this.gameW - 80, 94,
      'Missed: 0/5',
      {
        size: 46,
        origin: 1,            // right align
        align: 'right',
        strokeThickness: 10,
        shadowOffsetY: 5,
        fontStyle: '800'
      }
    );
    this.missBg = this._drawBadgeBehind(this.missText, {
      fill: '#ef4444',
      alpha: 0.22,
      radius: 18,
      padX: 22,
      padY: 10,
      outlineAlpha: 0.35
    });

    // Draw windows
    for (let i = 0; i < this.gameConfig.numWindows; ++i) {
      let rect = this.windowRects[i];
      let windowImg = this.add.image(rect.x, rect.y, 'window')
        .setDisplaySize(rect.width, rect.height)
        .setDepth(0);
      this.windowImages.push(windowImg);
    }

    this.nextCharacter();
  }

  nextCharacter() {
    // Remove previous character images/labels
    this.charSprites.forEach(obj => obj?.destroy?.());
    this.charSprites = [];

    this.activeCharIdx = Phaser.Math.Between(0, this.gameConfig.numWindows - 1);
    const hostageChance = this.gameConfig.hostageChance || 0.5;
    this.currentCharType = (Math.random() < hostageChance) ? 'hostage' : 'terrorist';
    let rect = this.windowRects[this.activeCharIdx];

    // Add character image
    const charKey = this.currentCharType;
    const charImg = this.add.image(rect.x, rect.y + rect.height / 4 - 150, charKey)
      .setDisplaySize(rect.width * 0.8, rect.height * 0.8)
      .setDepth(2);
    this.charSprites.push(charImg);

    // Pop-in effect
    charImg.setScale(0);
    this.sys.tweens.add({
      targets: charImg,
      scale: 1.8,
      ease: 'Back.Out',
      duration: 250
    });

    // Label badge (T/H)
    const labelBg = this.add.rectangle(rect.x, rect.y - rect.height / 2 + 92, 52, 48,
      this.currentCharType === 'terrorist'
        ? Phaser.Display.Color.HexStringToColor(this.colors.terrorist).color
        : Phaser.Display.Color.HexStringToColor(this.colors.hostage).color
    ).setDepth(10);
    this.charSprites.push(labelBg);

    const label = this._makeText(
      rect.x,
      rect.y - rect.height / 2 + 92,
      (this.currentCharType === 'terrorist') ? 'E' : 'F',
      {
        size: 40,
        strokeThickness: 8,
        shadowOffsetY: 4,
        origin: 0.5,
      }
    ).setDepth(11);
    this.charSprites.push(label);

    // Character stays for a random time
    const showTime = Phaser.Math.Between(this.gameConfig.minShowTime, this.gameConfig.maxShowTime);
    this.activeTimer = this.time.delayedCall(showTime, () => {
      if (this.gameState !== 'playing') return;

      if (this.currentCharType === 'terrorist') {
        this.misses += 1;
        this.missText.setText(`Missed: ${this.misses}/5`);
        this._pop(this.missText);
        // redraw pill to fit new width
        this.missBg?.destroy();
        this.missBg = this._drawBadgeBehind(this.missText, {
          fill: '#ef4444',
          alpha: 0.22,
          radius: 18,
          padX: 22,
          padY: 10,
          outlineAlpha: 0.35
        });

        if (this.misses >= 5) {
          this._fadeBgm(0.12, 300);

          this.isActive = false;
          this.gameState = 'gameover';
          this.sound.play('gameover');
          this.sys.cameras.main.shake(300, 0.02);
          this.time.delayedCall(350, this.showGameOver);
          return;
        }
      }

      this.nextCharacter();
    });
  }

  handleTap(pointer) {
    if (!this.isActive) return;
    let x = pointer.x * this.gameW / this.sys.game.canvas.width;
    let y = pointer.y * this.gameH / this.sys.game.canvas.height;
    let idx = -1;
    for (let i = 0; i < this.windowRects.length; ++i) {
      let rect = this.windowRects[i];
      if (
        x > rect.x - rect.width / 2 && x < rect.x + rect.width / 2 &&
        y > rect.y - rect.height / 2 && y < rect.y + rect.height / 2
      ) { idx = i; break; }
    }
    if (idx !== this.activeCharIdx) return;

    if (this.activeTimer) this.activeTimer.remove();

    // where we tapped
    const rect = this.windowRects[this.activeCharIdx];
    const cx = rect.x;
    const cy = rect.y + rect.height / 4 - 150;

    if (this.currentCharType === 'hostage') {
      // 🔴 FRIEND KILLED → INSTANT GAME OVER
      this._effectHitHostage(cx, cy);
      this.sound.play('gameover');

      if (this.activeTimer) this.activeTimer.remove();

      this.isActive = false;
      this.gameState = 'gameover';

      this._fadeBgm(0.12, 300);
      this.sys.cameras.main.shake(350, 0.02);

      this.time.delayedCall(300, () => {
        this.showGameOver();
      });

      return; // ⛔ STOP EVERYTHING HERE
    }
    else {
      // 🟡 Terrorist hit FX (unchanged)
      this._effectHitTerrorist(cx, cy);
      this.sound.play('attack');
      this.kills += 1;

      this.killText.setText(
        this.texts.kills.replace('{kills}', this.kills).replace('{maxKills}', this.gameConfig.killsToWin)
      );
      this._pop(this.killText);
      this.killBg?.destroy();
      this.killBg = this._drawBadgeBehind(this.killText, {
        fill: this.colors?.terrorist || '#16a34a',
        alpha: 0.22, radius: 20, padX: 28, padY: 12, outlineAlpha: 0.35
      });

      if (this.kills >= this.gameConfig.killsToWin) {
        this.isActive = false;
        this.gameState = 'win';
        this.time.delayedCall(350, () => { this.showLevelComplete(); });
      } else {
        this.time.delayedCall(120, () => this.nextCharacter());
      }
    }

  }


  showGameOver() {
    this._fadeBgm(0.12, 300);

    this.hideOverlays();
    this.gameOverOverlay.setVisible(true);
  }

  showLevelComplete() {
    this._fadeBgm(0.12, 300);

    this.hideOverlays();
    this.levelCompleteOverlay.setVisible(true);
  }

  // --- BGM helpers ---
  _ensureBgm(startVol = 0.5) {
    if (!this.bgmSound) {
      this.bgmSound = this.sound.add('bgm', { loop: true, volume: startVol });
      this.bgmSound.play();
    } else {
      if (!this.bgmSound.isPlaying) this.bgmSound.play();
      this.bgmSound.setVolume(startVol);
    }
  }
  _fadeBgm(to = 0.12, duration = 350) {
    if (!this.bgmSound) return;
    const clamp = v => Math.max(0, Math.min(1, v));
    const from = clamp(this.bgmSound.volume ?? 0.5);
    to = clamp(to);

    this.tweens.addCounter({
      from,
      to,
      duration,
      ease: 'Quad.Out',
      // FIRST arg is the tween; call getValue() on it
      onUpdate: (tween) => {
        const v = tween.getValue();
        this.bgmSound.setVolume(v);
      }
    });
  }


  // Quick screen flash (color overlay that fades out)
  _screenFlash(color = 0x00ff00, duration = 160, alpha = 0.15) {
    const cam = this.sys.cameras.main;
    const g = this.add.graphics().setScrollFactor(0).setDepth(9999);
    g.fillStyle(color, 1);
    g.fillRect(0, 0, cam.width, cam.height);
    g.alpha = 0;

    this.tweens.add({
      targets: g, alpha, duration: Math.floor(duration * 0.4), yoyo: true,
      onComplete: () => g.destroy()
    });
  }

  // Generic expanding ring
  _ring(x, y, { line = 6, color = 0xffffff, startR = 10, endR = 140, duration = 280, startAlpha = 0.9 } = {}) {
    const g = this.add.graphics().setDepth(50);
    g.lineStyle(line, color, startAlpha);

    let r = startR;
    const tween = this.tweens.addCounter({
      from: startR, to: endR, duration,
      onUpdate: t => {
        r = t.getValue();
        g.clear();
        g.lineStyle(line, color, Phaser.Math.Linear(startAlpha, 0, t.progress));
        g.strokeCircle(x, y, r);
      },
      onComplete: () => g.destroy()
    });
    return tween;
  }

  // Burst made of small circles
  _burst(x, y, {
    count = 16, minR = 18, maxR = 42,
    tint = 0xffd54a, // warm gold
    duration = 280
  } = {}) {
    const parts = [];
    for (let i = 0; i < count; i++) {
      const g = this.add.graphics().setDepth(60);
      g.fillStyle(tint, 1);
      const r = Phaser.Math.Between(minR, maxR) / 10;
      g.fillCircle(0, 0, r);
      g.x = x; g.y = y;
      parts.push({ g, r });
    }
    parts.forEach(p => {
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const dist = Phaser.Math.Between(40, 130);
      const tx = x + Math.cos(angle) * dist;
      const ty = y + Math.sin(angle) * dist;

      this.tweens.add({
        targets: p.g,
        x: tx, y: ty, alpha: 0,
        duration,
        ease: 'Quad.Out',
        onComplete: () => p.g.destroy()
      });
    });
  }

  // Soft vignette (hostage fail)
  _vignette(color = 0xff0000, alpha = 0.22, duration = 250) {
    const cam = this.sys.cameras.main;
    const g = this.add.graphics().setScrollFactor(0).setDepth(9998);
    // draw transparent center with radial falloff using multiple rings
    const rings = 6;
    for (let i = 0; i < rings; i++) {
      const a = alpha * ((i + 1) / rings);
      g.fillStyle(color, a);
      const margin = 40 + i * 24;
      g.fillRect(-margin, -margin, cam.width + margin * 2, cam.height + margin * 2);
    }
    g.alpha = 0;
    this.tweens.add({
      targets: g, alpha: 1, duration: Math.floor(duration * 0.45), yoyo: true,
      onComplete: () => g.destroy()
    });
  }

  // Crosshair blip at tap point
  _crosshair(x, y, { color = 0xffffff, duration = 220 } = {}) {
    const g = this.add.graphics().setDepth(70);
    const draw = (s) => {
      g.clear();
      g.lineStyle(3, color, 1);
      g.strokeCircle(x, y, 14 + s * 6);
      g.beginPath();
      g.moveTo(x - 18 - s * 3, y); g.lineTo(x - 6, y);
      g.moveTo(x + 18 + s * 3, y); g.lineTo(x + 6, y);
      g.moveTo(x, y - 18 - s * 3); g.lineTo(x, y - 6);
      g.moveTo(x, y + 18 + s * 3); g.lineTo(x, y + 6);
      g.strokePath();
    };
    this.tweens.addCounter({
      from: 0, to: 1, duration,
      onUpdate: t => draw(t.getValue()),
      onComplete: () => g.destroy()
    });
  }

  // 🟡 Terrorist hit combo FX
  _effectHitTerrorist(x, y) {
    this._crosshair(x, y, { color: 0xffffff, duration: 200 });
    this._burst(x, y, { tint: 0xffd54a, duration: 260, count: 18 });
    this._ring(x, y, { color: 0xffffff, duration: 260, startR: 10, endR: 120, line: 5 });
    this._screenFlash(0x22ff88, 150, 0.12);
    // slight camera bump
    this.sys.cameras.main.shake(120, 0.004);
  }

  // 🔴 Hostage hit combo FX
  _effectHitHostage(x, y) {
    this._crosshair(x, y, { color: 0xffc0c0, duration: 240 });
    this._burst(x, y, { tint: 0x8b0000, duration: 320, count: 14, minR: 16, maxR: 38 });
    this._ring(x, y, { color: 0xff4444, duration: 340, startR: 12, endR: 160, line: 7 });
    this._vignette(0xff0000, 0.25, 300);
    // stronger camera shake
    this.sys.cameras.main.shake(240, 0.012);
  }


  // Reusable, juicy game text
  _makeText(x, y, content, opts = {}) {
    const {
      size = 50,
      color = '#ffffff',
      stroke = '#141414',
      strokeThickness = 8,
      shadowColor = 'rgba(0,0,0,0.65)',
      shadowBlur = 10,
      shadowOffsetX = 0,
      shadowOffsetY = 4,
      origin = 0.5,
      depth = 11,
      fontFamily = 'Outfit, outfit, sans-serif',
      fontStyle = '900',
      align = 'center',
      padding = { x: 12, y: 6 },
    } = opts;

    const t = this.add.text(x, y, content, {
      fontFamily,
      fontSize: `${size}px`,
      fontStyle,
      color,
      align,
      padding,
      stroke,
      strokeThickness,
      shadow: {
        color: shadowColor,
        blur: shadowBlur,
        offsetX: shadowOffsetX,
        offsetY: shadowOffsetY,
        fill: true,
        stroke: true,
      }
    })
      .setOrigin(origin)
      .setDepth(depth);

    return t;
  }

  // Draw a rounded, translucent badge behind a text object
  _drawBadgeBehind(textObj, {
    fill = '#000000',
    alpha = 0.2,
    radius = 18,
    padX = 18,
    padY = 8,
    outlineAlpha = 0.3
  } = {}) {
    const g = this.add.graphics().setDepth((textObj.depth || 10) - 1);
    const colorInt = Phaser.Display.Color.HexStringToColor(fill).color;

    const left = textObj.x - textObj.displayWidth * textObj.originX - padX;
    const top = textObj.y - textObj.displayHeight * textObj.originY - padY;
    const w = textObj.displayWidth + padX * 2;
    const h = textObj.displayHeight + padY * 2;

    g.fillStyle(colorInt, alpha);
    g.fillRoundedRect(left, top, w, h, radius);

    g.lineStyle(2, 0xffffff, outlineAlpha);
    g.strokeRoundedRect(left, top, w, h, radius);

    return g;
  }

  // Tiny scale pop for feedback
  _pop(target) {
    this.tweens.killTweensOf(target);
    target.setScale(1);
    this.tweens.add({
      targets: target,
      scale: 1.06,
      duration: 90,
      yoyo: true,
      ease: 'Quad.Out'
    });
  }

  // --- Overlay Creation Methods ---
  createStartOverlay() {
    const { gameW, gameH, texts } = this;
    // this._ensureBgm(0.5);



    // Container centered on screen; all children use LOCAL coords relative to this point
    this.startOverlay = this.add.container(gameW / 2, gameH / 2);

    // Background (centered a bit up)
    const bg = this.add.image(0, -100, 'start_overlay');

    // Title / description text (use valid Phaser text styles + setOrigin)
    const desc = this.add.text(-400, -50, "Tap", {
      fontSize: "48px",
      color: "#ffffff",
      align: "left",
      fontFamily: "Arial",
      stroke: "#000000",
      strokeThickness: 6,
    }).setOrigin(0.5).setShadow(0, 5, "#000000", 8, true, true);

    // If you want a second line, create it properly and ADD IT TO THE CONTAINER
    const desc1 = this.add.text(50, -50, "Avoid", {
      fontSize: "48px",
      color: "#ffffff",
      align: "left",
      fontFamily: "Arial",
      stroke: "#000000",
      strokeThickness: 6,
    }).setOrigin(0.5).setShadow(0, 5, "#000000", 8, true, true);

    // Play button (local coords)
    const playBtn = this.add.image(0, 350, 'button_play').setInteractive({ useHandCursor: true });

    const playLabel = this.add.text(0, 140, texts.startBtn, {
      font: "48px",
      color: "#111111",
      fontFamily: "Arial",
      stroke: "#ffffff",
      strokeThickness: 10,
    }).setOrigin(0.5).setShadow(0, 2, "rgba(255,255,255,0.35)", 6, true, true);

    playBtn.on('pointerdown', (pointer) => {
      pointer.event.stopPropagation(); // ⛔ stop reaching handleTap
      this.hideOverlays();
      this.gameState = 'playing';
      this.startGame();
    });


    // Characters (LOCAL coordinates relative to the container center)
    // Put them AFTER bg in the add order so they render on top
    const friend = this.add.image(+260, -50, 'hostage').setScale(1);
    const enemy = this.add.image(-200, -50, 'terrorist').setScale(1);

    // IMPORTANT: Depth of children inside a Container is ignored; order in add() matters.
    this.startOverlay.add([bg, desc, desc1, playBtn, playLabel, friend, enemy]);

    // One depth for the whole overlay
    this.startOverlay.setDepth(1000).setVisible(true); // set to true if you want it to show immediately
  }


  createGameOverOverlay() {
    const { gameW, gameH, texts } = this;
    this.gameOverOverlay = this.add.container(gameW / 2, gameH / 2);
    const bg = this.add.image(0, 0, 'gameover_overlay');
    const overText = this._makeText(0, 0, texts.gameOver, {
      size: 62,
      strokeThickness: 12,
      shadowOffsetY: 6,
    });
    const retryBtn = this.add.image(0, 380, 'button_retry').setInteractive();
    const retryLabel = this._makeText(0, 120, texts.retry, {
      size: 44,
      color: '#111',
      stroke: '#ffffff',
      strokeThickness: 6,
      shadowColor: 'rgba(255,255,255,0.35)',
      shadowBlur: 6,
      shadowOffsetY: 2,
    });
    retryBtn.on('pointerdown', (pointer) => {
      pointer.event.stopPropagation();
      this.hideOverlays();
      this.gameState = 'playing';
      this.startGame();
    });

    this.gameOverOverlay.add([bg, overText, retryBtn, retryLabel]);
    this.gameOverOverlay.setDepth(1000).setVisible(false);
  }

  notifyParent(type, data) {
    if (window.parent !== window) {
      window.parent.postMessage({ type, ...data }, "*");
    }
  }

  createLevelCompleteOverlay() {
    const { gameW, gameH, texts } = this;
    this.levelCompleteOverlay = this.add.container(gameW / 2, gameH / 2);
    const bg = this.add.image(0, 0, 'levelcomplete_overlay');
    const winText = this._makeText(0, 0, texts.win, {
      size: 62,
      strokeThickness: 12,
      shadowOffsetY: 6,
    });

    const playAgainBtn = this.add.image(-235, 350, 'next').setInteractive();
    const playAgainBtn1 = this.add.image(235, 350, 'replay').setInteractive();
    const playAgainLabel = this._makeText(0, 120, texts.playAgain, {
      size: 40,
      color: '#111',
      stroke: '#ffffff',
      strokeThickness: 6,
      shadowColor: 'rgba(255,255,255,0.35)',
      shadowBlur: 6,
      shadowOffsetY: 2,
    });
    playAgainBtn.on('pointerdown', (pointer) => {
      pointer.event.stopPropagation();
      this.hideOverlays();
      this.gameState = 'playing';
      this.notifyParent('sceneComplete', { result: 'win' });
    });

    playAgainBtn1.on('pointerdown', (pointer) => {
      pointer.event.stopPropagation();
      this.hideOverlays();
      this.gameState = 'playing';
      this.startGame();
    });

    this.levelCompleteOverlay.add([bg, winText, playAgainBtn, playAgainBtn1, playAgainLabel]);
    this.levelCompleteOverlay.setDepth(1000).setVisible(false);
  }

  hideOverlays() {
    if (this.startOverlay) this.startOverlay.setVisible(false);
    if (this.gameOverOverlay) this.gameOverOverlay.setVisible(false);
    if (this.levelCompleteOverlay) this.levelCompleteOverlay.setVisible(false);
  }

  getWindowRects() {
    const num = this.gameConfig.numWindows;
    const marginY = this.gameConfig.marginY;
    const windowW = this.gameConfig.windowWidth * 2.2;
    const windowH = this.gameConfig.windowHeight * 2.2;
    const space = (this.gameW - (num * windowW)) / (num + 1);
    let rects = [];
    for (let i = 0; i < num; ++i) {
      const x = space + i * (windowW + space) + windowW / 2;
      const y = marginY + windowH / 2;
      rects.push({ x, y, width: windowW, height: windowH });
    }
    return rects;
  }

  shutdown() {
    this.charSprites.forEach(obj => obj?.destroy?.());
    this.charSprites = [];
    this.windowImages.forEach(obj => obj?.destroy?.());
    this.windowImages = [];
    if (this.killText) this.killText.destroy();
    if (this.missText) this.missText.destroy();
    if (this.killBg) this.killBg.destroy();
    if (this.missBg) this.missBg.destroy();
    this.killText = null;
    this.missText = null;
    this.killBg = null;
    this.missBg = null;
    if (this.activeTimer) this.activeTimer.remove();
  }

  destroy() { this.shutdown(); }
  stop() { this.shutdown(); }
}
