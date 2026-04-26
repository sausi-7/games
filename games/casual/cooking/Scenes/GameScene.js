class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');

    // State
    this.cfg = null;
    this.worldW = 1920;
    this.worldH = 1080;

    this.levelIndex = 0;
    this.currentRecipe = null;
    this.recipeSteps = [];
    this.stepIndex = 0;

    this.timer = 0;
    this.timeLeft = 0;
    this.mistakes = 0;
    this.score = 0;

    // Refs
    this.plate = null;
    this.dropZoneRect = null;
    this.ingredientsGroup = null;
    this.previewLayer = null;

    // UI (gameplay-only)
    this.timerText = null;
    this.scoreText = null;
    this.mistakeText = null;

    // Audio
    this.sfx = {};
    this.bgm = null;

    // Drag helpers
    this.dragStartPos = new Map();
  }

  preload() {
    // Expect config injected by Boot via registry
    this.cfg = this.registry.get('cfg') || {};

    // Load font (optional bitmap/webfont pipeline not enforced here)
    // if (this.cfg.font && this.cfg.font.url) {
    //   this.load.ttf('gamefont', this.cfg.font.url);
    // }

    // Images
    if (this.cfg.images) {
      Object.entries(this.cfg.images).forEach(([key, url]) => {
        this.load.image(key, url);
      });
    }

    // Spritesheets (optional)
    if (this.cfg.spritesheets) {
      Object.entries(this.cfg.spritesheets).forEach(([key, sheet]) => {
        this.load.spritesheet(key, sheet.url, {
          frameWidth: sheet.frameWidth,
          frameHeight: sheet.frameHeight
        });
      });
    }

    // Audio
    if (this.cfg.audio) {
      Object.entries(this.cfg.audio).forEach(([key, url]) => {
        this.load.audio(key, url);
      });
    }
  }

  create() {
    this.cfg = this.registry.get('cfg') || this.cfg || {};
    const cam = this.cameras.main;
    this.worldW = this.sys.game.config.width || 1920;
    this.worldH = this.sys.game.config.height || 1080;
    cam.setBackgroundColor('#1a1a1a');

    // Pull gameplay params
    const gp = this.cfg.gameplay || {};

    // Random recipe selection if enabled
    if (gp.randomRecipe && gp.recipes && gp.recipes.length > 0) {
      this.levelIndex = Phaser.Math.Between(0, gp.recipes.length - 1);
    } else {
      this.levelIndex = gp.startLevel || 0;
    }

    this.timeLeft = gp.timerSeconds ?? 60;
    this.mistakes = 0;
    this.score = 0;

    // Background table (optional)
    if (this.cfg.images && this.cfg.images.background) {
      const bg = this.add.image(this.worldW / 2, this.worldH / 2, 'background');
      const scale = Math.max(this.worldW / bg.width, this.worldH / bg.height);
      bg.setScale(scale);
    }

    // Plate / pan (uses platform image) – sized via config
    const plateKey = (this.cfg.images && this.cfg.images.platform) ? 'platform' : 'platform1';
    const plateW = gp.plateSize?.width ?? 340;
    const plateH = gp.plateSize?.height ?? 140;
    const plateX = gp.dropZone?.x ?? (this.worldW * 0.65);
    const plateY = gp.dropZone?.y ?? (this.worldH * 0.6);

    this.plate = this.add.image(plateX + 300, plateY, plateKey);
    this.plate.setDisplaySize(plateW, plateH);

    // Physics body for precise collider sizing
    this.physics.add.existing(this.plate, true);
    this.plate.body.setSize(plateW, plateH);

    // Visual drop zone outline (debug-style)
    this.dropZoneRect = this.add.rectangle(plateX + 300, plateY, plateW, plateH, 0x00ff00, 0.08)
      .setStrokeStyle(4, 0x00ff00, 0.5);

    // Preview container above plate to stack layers
    this.previewLayer = this.add.container(plateX + 300, plateY);

    // Ingredients
    this.ingredientsGroup = this.add.group();

    // Build level/recipe
    this._loadRecipe(this.levelIndex);
    this._layoutIngredients();

    // UI (gameplay-only: timer, score, mistakes)
    const fontFamily = (this.cfg.font && this.cfg.font.family) ? this.cfg.font.family : 'Arial';

    // === HUD ===
    this.recipeTitleText = this._createFancyText(860, 72,
      `${this._t('make_label', 'Make: ')}${this.currentRecipe?.name || 'Dish'}`,
      1000, 0, 0
    );
    this._hover(this.recipeTitleText, 3, 1600);  // gentle float

    this.scoreText = this._createFancyText(32, 24,
      `${this._t('score_label', 'Score: ')}0`,
      1000, 0, 0
    );

    this.timerText = this._createFancyText(this.worldW / 2, 24,
      `Time: ${this.timeLeft}`,
      1000, 0.5, 0
    );

    this.mistakeText = this._createFancyText(this.worldW - 32, 24,
      `Mistakes: ${this.mistakes}/${gp.mistakeLimit ?? 3}`,
      1000, 1, 0
    );


    // Audio wiring
    if (this.sound && this.cfg.audio) {
      const a = this.cfg.audio;
      if (a.bgm) this.bgm = this.sound.add('bgm', { loop: true, volume: gp.bgmVolume ?? 0.5 });
      if (a.collect) this.sfx.collect = this.sound.add('collect', { volume: 0.8 });
      if (a.hit) this.sfx.hit = this.sound.add('hit', { volume: 0.9 });
      if (a.jump) this.sfx.jump = this.sound.add('jump', { volume: 0.9 });
      if (a['Game_Over'] || a.game_over) {
        const key = a['Game_Over'] ? 'Game_Over' : 'game_over';
        this.sfx.gameOver = this.sound.add(key, { volume: 0.9 });
      }
      if (a['Level_Complete'] || a.level_complete) {
        const key = a['Level_Complete'] ? 'Level_Complete' : 'level_complete';
        this.sfx.win = this.sound.add(key, { volume: 0.9 });
      }
      if (a.attack) this.sfx.attack = this.sound.add('attack', { volume: 0.8 }); // use for correct drop
      if (a['Taking_a_Hit'] || a.taking_a_hit) {
        const key = a['Taking_a_Hit'] ? 'Taking_a_Hit' : 'taking_a_hit';
        this.sfx.miss = this.sound.add(key, { volume: 0.9 });
      }
      if (a['Game_Background'] || a.bgm) {
        if (this.bgm) this.bgm.play();
      }
    }

    // Global input settings
    this.input.setTopOnly(true);

    // Timer loop
    this.timer = this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        this.timeLeft--;
        this.timerText.setText(`Time: ${this.timeLeft}`);

        // Low-time warning at 10s
        if (this.timeLeft <= 10) {
          this._flashTextColor(this.timerText, '#ff5555', 200);
          this._punch(this.timerText, 1.18, 140);
        }

        if (this.timeLeft <= 0) {
          this._failLevel('time');
        }
      }
    });

  }

  update() {
    // Nothing per-frame heavy needed; physics handles collisions if used
  }

  // -----------------------
  // Recipe & Level helpers
  // -----------------------
  _loadRecipe(index) {
    const recipes = (this.cfg.gameplay && this.cfg.gameplay.recipes) || [];
    const safeIndex = Phaser.Math.Clamp(index, 0, Math.max(0, recipes.length - 1));

    this.currentRecipe = recipes[safeIndex] || null;
    if (!this.currentRecipe) {
      // No recipe found: treat as win to move along (or restart)
      this.scene.start('WinScene');
      return;
    }
    this.recipeSteps = [...this.currentRecipe.sequence]; // array of ingredient keys
    this.stepIndex = 0;
  }

  _layoutIngredients() {
    const gp = this.cfg.gameplay || {};
    const size = gp.ingredientSize ?? 100;

    // Pool of available ingredient keys for this level (sequence + decoys)
    const needKeys = new Set(this.recipeSteps);
    const decoys = (this.currentRecipe.decoys || []).slice(0);
    decoys.forEach(k => needKeys.add(k));

    const keys = Phaser.Utils.Array.Shuffle(Array.from(needKeys));

    // Grid layout on the left table side
    const cols = gp.tableCols ?? 4;
    const rows = Math.ceil(keys.length / cols);
    const startX = this.worldW * 0.15;
    const startY = this.worldH * 0.35;
    const gapX = gp.tableGapX ?? 160;
    const gapY = gp.tableGapY ?? 150;

    keys.forEach((key, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      const x = startX + c * gapX;
      const y = startY + r * gapY;

      const spr = this.add.sprite(x, y, key);
      spr.setDisplaySize(size, size);

      // Physics for accurate collider size = displayed size
      this.physics.add.existing(spr);
      spr.body.setSize(size, size);
      spr.setInteractive({ draggable: true, pixelPerfect: false, useHandCursor: true });

      // Store start pos
      this.dragStartPos.set(spr, new Phaser.Math.Vector2(x, y));

      // Drag events
      spr.on('dragstart', () => {
        spr.setDepth(999);
        spr.setAlpha(0.9);
        this.tweens.add({ targets: spr, scaleX: spr.scaleX * 1.08, scaleY: spr.scaleY * 1.08, duration: 80, yoyo: false });
        if (this.sfx.collect) this.sfx.collect.play();
      });

      spr.on('drag', (_pointer, dragX, dragY) => {
        spr.x = dragX;
        spr.y = dragY;
      });

      spr.on('dragend', () => {
        spr.setAlpha(1.0);

        const overPlate = this._isOverPlate(spr);
        if (overPlate) {
          this._tryPlaceIngredient(spr, key);
        } else {
          this._snapBack(spr);
        }
      });

      this.ingredientsGroup.add(spr);
    });
  }

  _isOverPlate(sprite) {
    // Overlap check using bounds vs plate body rectangle
    const plateBounds = new Phaser.Geom.Rectangle(
      this.plate.x - this.plate.displayWidth / 2,
      this.plate.y - this.plate.displayHeight / 2,
      this.plate.displayWidth,
      this.plate.displayHeight
    );
    return plateBounds.contains(sprite.x, sprite.y);
  }

  _tryPlaceIngredient(spr, key) {
    const expected = this.recipeSteps[this.stepIndex];
    const gp = this.cfg.gameplay || {};
    const mistakeLimit = gp.mistakeLimit ?? 3;

    if (key === expected) {
      // Correct placement
      if (this.sfx.attack) this.sfx.attack.play();

      // Lock this sprite and move to preview as a new layer
      this._addPreviewLayer(key);

      // Remove draggable ingredient
      spr.disableInteractive();
      spr.visible = false;
      spr.active = false;

      // Advance recipe
      this.stepIndex++;

      // Award points (time-sensitive bonus)
      this.score += 100 + (this.timeLeft * 2);
      this.scoreText.setText(`${this._t('score_label', 'Score: ')}${this.score}`);

      // score popup & sparkle near the plate
      const bonus = 100 + (this.timeLeft * 2);
      this._floatScore(this.plate.x, this.plate.y - this.plate.displayHeight * 0.6, `+${bonus}`);
      this._sparkle(this.plate.x, this.plate.y);
      this._punch(this.scoreText, 1.14, 120);

      // Completed?
      if (this.stepIndex >= this.recipeSteps.length) {
        this._winLevel();
      }
    } else {
      // Wrong placement
      if (this.sfx.miss) this.sfx.miss.play();
      this._flashPlate(0xff0000);
      this._bumpText(this.mistakeText);
      this._flashTextColor(this.mistakeText, '#ff6666', 160);


      this.mistakes++;
      this.mistakeText.setText(`Mistakes: ${this.mistakes}/${mistakeLimit}`);

      this._snapBack(spr);

      if (this.mistakes >= mistakeLimit) {
        this._failLevel('mistakes');
      }
    }
  }

  _addPreviewLayer(key) {
    // Create a sprite centered in preview container; stack with small vertical offset
    const gp = this.cfg.gameplay || {};
    const layerSize = gp.previewSize ?? 130;
    const offsetY = (this.stepIndex * -16);

    const layer = this.add.image(0, offsetY, key);
    layer.setDisplaySize(layerSize, layerSize);
    layer.setAlpha(0);
    this.previewLayer.add(layer);

    // Pop-in tween
    this.tweens.add({
      targets: layer,
      alpha: 1,
      scaleX: layer.scaleX * 1.06,
      scaleY: layer.scaleY * 1.06,
      y: offsetY - 6,
      duration: 150,
      yoyo: true
    });

    // Nice plate flash for correct drop
    this._flashPlate(0x00ff88);
  }

  _snapBack(spr) {
    const p = this.dragStartPos.get(spr);
    if (!p) return;
    this.tweens.add({
      targets: spr,
      x: p.x,
      y: p.y,
      duration: 140,
      onStart: () => { spr.setDepth(0); },
      onComplete: () => { spr.setDepth(0); }
    });
  }

  _flashPlate(color) {
    // Animate dropZoneRect stroke color
    const g = this.dropZoneRect;
    const originalAlpha = g.strokeAlpha;
    g.setStrokeStyle(g.lineWidth, color, 0.9);
    this.time.delayedCall(120, () => g.setStrokeStyle(g.lineWidth, 0x00ff00, originalAlpha));
  }

  _bumpText(txt) {
    this.tweens.add({
      targets: txt,
      scaleX: 1.12,
      scaleY: 1.12,
      duration: 90,
      yoyo: true
    });
  }

  _stopBGM(fadeMs = 0) {            // default to immediate stop
    if (!this.bgm) return;

    // If you really want fading sometimes, pass a fadeMs > 0 and delay scene switch
    if (this.bgm.isPlaying && fadeMs > 0) {
      if (typeof this.bgm.fadeOut === 'function') {
        this.bgm.fadeOut(fadeMs);
        this.time.delayedCall(fadeMs + 20, () => {
          this.bgm.stop(); this.bgm.destroy(); this.bgm = null;
        });
      } else {
        // Fallback: just tween volume, but still do a hard stop at the end
        this.tweens.add({
          targets: this.bgm, volume: 0, duration: fadeMs,
          onComplete: () => { this.bgm.stop(); this.bgm.destroy(); this.bgm = null; }
        });
      }
    } else {
      this.bgm.stop();
      this.bgm.destroy();
      this.bgm = null;
    }
  }



  // -----------------------
  // Win / Lose
  // -----------------------
  _winLevel() {
    if (this.timer) this.timer.remove(false);
    this._stopBGM(0);          // hard stop
    this.sound.stopByKey('bgm'); // extra safety
    this.sound.stopAll();
    if (this.sfx.win) this.sfx.win.play();

    // Simple final score bonus for remaining time
    this.score += this.timeLeft * 10;
    this.registry.set('lastScore', this.score);
    this.registry.set('lastResult', 'win');
    this.registry.set('lastLevel', this.levelIndex);

    // Hand off to external WinScene (not rendered here)
    this.scene.start('WinScene');
  }

  _failLevel(reason) {
    if (this.timer) this.timer.remove(false);
    this._stopBGM(0);
    this.sound.stopByKey('bgm');
    this.sound.stopAll();
    if (this.sfx.gameOver) this.sfx.gameOver.play();

    this.registry.set('lastScore', this.score);
    this.registry.set('lastResult', reason || 'fail');
    this.registry.set('lastLevel', this.levelIndex);

    // Hand off to external GameOverScene (not rendered here)
    this.scene.start('GameOverScene');
  }

  // -----------------------f
  // Util
  // -----------------------
  _t(key, fallback) {
    return (this.cfg.texts && this.cfg.texts[key]) || fallback || '';
  }

  // ---------- UI HELPERS ----------
  _createFancyText(x, y, text, depth = 1000, originX = 0, originY = 0) {
    const fontFamily = (this.cfg.font && this.cfg.font.family) ? this.cfg.font.family : 'Arial';

    // Main label
    const t = this.add.text(x, y, text, {
      fontFamily,
      fontSize: 36,
      color: '#ffee88',              // warm gold
      stroke: '#000000',
      strokeThickness: 6
    })
      .setOrigin(originX, originY)
      .setDepth(depth);

    // Soft drop shadow
    t.setShadow(0, 4, '#000000', 8, true, true);

    return t;
  }

  // Subtle floating animation
  _hover(t, amplitude = 4, duration = 1500) {
    this.tweens.add({
      targets: t,
      y: t.y - amplitude,
      duration,
      yoyo: true,
      repeat: -1,
      ease: 'sine.inOut'
    });
  }

  // Quick punch scale
  _punch(t, scale = 1.12, dt = 120) {
    this.tweens.add({
      targets: t,
      scaleX: scale,
      scaleY: scale,
      duration: dt,
      yoyo: true
    });
  }

  // Flash color briefly
  _flashTextColor(t, colorHex = '#ff6666', dt = 160) {
    const original = t.style.color || '#ffffff';
    t.setColor(colorHex);
    this.time.delayedCall(dt, () => t.setColor(original));
  }

  // Floating +score popup
  _floatScore(x, y, txt = '+100') {
    const fontFamily = (this.cfg.font && this.cfg.font.family) ? this.cfg.font.family : 'Arial';
    const pop = this.add.text(x, y, txt, {
      fontFamily,
      fontSize: 30,
      color: '#aaffaa',
      stroke: '#002200',
      strokeThickness: 4
    }).setDepth(1200).setAlpha(0.98);
    pop.setShadow(0, 3, '#001100', 6, true, true);

    this.tweens.add({
      targets: pop,
      y: pop.y - 40,
      alpha: 0,
      duration: 700,
      ease: 'quad.out',
      onComplete: () => pop.destroy()
    });
  }

  // Tiny sparkle burst (no external assets)
  // Tiny sparkle burst (no external assets) — works on new Phaser; falls back on old
  _sparkle(x, y) {
    // generate a tiny white pixel the first time
    if (!this.textures.exists('ui_pix')) {
      const g = this.add.graphics();
      g.fillStyle(0xffffff, 1).fillRect(0, 0, 2, 2);
      g.generateTexture('ui_pix', 2, 2);
      g.destroy();
    }

    const config = {
      speed: { min: 80, max: 180 },
      angle: { min: 0, max: 360 },
      lifespan: 400,
      quantity: 10,
      scale: { start: 1.2, end: 0 },
      alpha: { start: 1, end: 0 }
    };

    try {
      // ✅ New API (Phaser 3.80+): returns a ParticleEmitter game object
      const emitter = this.add.particles(x, y, 'ui_pix', config);
      emitter.setDepth(1200);
      this.time.delayedCall(420, () => emitter.destroy());
    } catch (_e) {
      // ↩️ Fallback for older Phaser builds
      const mgr = this.add.particles('ui_pix');
      mgr.setDepth(1200);
      // If createEmitter still exists, use it; otherwise just destroy manager
      if (mgr && typeof mgr.createEmitter === 'function') {
        const e2 = mgr.createEmitter({ x, y, ...config });
        this.time.delayedCall(420, () => { mgr.destroy(); });
      } else {
        // nothing we can do—clean up
        this.time.delayedCall(10, () => { if (mgr && mgr.destroy) mgr.destroy(); });
      }
    }
  }


}