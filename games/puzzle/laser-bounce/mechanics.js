export default class LaserBounceScene extends Phaser.Scene {
  constructor() {
    super("MechanicsScene");
    Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach((fn) => {
      if (typeof this[fn] === "function") this[fn] = this[fn].bind(this);
    });

    // Will set from config:
    this.hasGameOverShown = false;
    this.CENTER_X = 540;
    this.CENTER_Y = 960;
    this.RADIUS = 300;
    this.NUM_TARGETS = 5;
    this.MIRROR_COUNT = 5;
    this.MIRROR_LENGTH = 120;
    this.gameOverShown = false;
    this.timeLeft = 60;
    this.timerText = null;
    this.timerEvent = null;
    this.previewPath = [];
    this.gameStarted = false;

    this.laserDelay = null; // handle for delayed laser-clear


    // Game state
    this.cannon = null;
    this.player = null;
    this.angle = 0;
    this.mirrors = [];
    this.targets = [];
    this.laserFired = false;
    this.graphics = null;
    this.score = 0;
    this.scoreText = null;
  }
  // ---- helpers (add inside class) ----
  hasTex(key) {
    return this.textures.exists(key) && this.textures.get(key) && this.textures.get(key).key !== '__MISSING';
  }
  hasAudio(key) {
    return this.cache.audio && this.cache.audio.exists && this.cache.audio.exists(key);
  }
  makeButton(x, y, label, depth = 10) {
    // text fallback for missing image buttons
    const btn = this.add.text(x, y, label, {
      font: '48px Outfit',
      color: '#ffffff',
      backgroundColor: '#444',
      padding: { left: 28, right: 28, top: 12, bottom: 12 }
    }).setOrigin(0.5).setDepth(depth).setInteractive({ useHandCursor: true });
    return btn;
  }


  notifyParent(type, data) {
    if (window.parent !== window) {
      window.parent.postMessage({ type, ...data }, "*");
    }
  }

  preload() {
    const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));

    // Allow cross-origin
    if (this.load.setCORS) this.load.setCORS('anonymous');

    // Make sure we can replace the sheet on restart
    // if (this.textures.exists('eve')) this.textures.remove('eve');

    // Debug load errors
    this.load.on('loaderror', (file) => {
      if (file?.key === 'eve') {
        console.error('[Preload] Failed to load eve sheet:', file.src);
      } else {
        console.error('[Preload] Failed:', file?.key, file?.src);
      }
    });

    // Helper utils
    const parseQueryFrom = (str) => {
      try { return new URL(str, window.location.href).searchParams; }
      catch { return new URLSearchParams(''); }
    };
    const getParam = (name) => {
      const p1 = new URLSearchParams(window.location.search).get(name);
      if (p1) return p1;
      if (window.location.hash?.length > 1) {
        const p2 = new URLSearchParams(window.location.hash.slice(1)).get(name);
        if (p2) return p2;
      }
      if (document.referrer) {
        const p3 = parseQueryFrom(document.referrer).get(name);
        if (p3) return p3;
      }
      return null;
    };
    const resolveUrl = (u) => {
      if (!u) return null;
      if (/^(https?:)?\/\//i.test(u) || /^data:/i.test(u)) return u; // absolute/data:
      return `${basePath}/${u}`; // relative
    };
    const withBustIfParam = (u, hasParam) => {
      if (!u || !hasParam) return u;
      return `${u}${u.includes('?') ? '&' : '?'}cb=${Date.now()}`;
    };

    // Load config
    this.load.json('levelConfig', `${basePath}/config.json`);

    this.load.once('filecomplete-json-levelConfig', () => {
      const cfg = this.cache.json.get('levelConfig') || {};
      const spritesheets = cfg.spritesheets || {};
      const sheets = cfg.sheets || {};
      const heroData = sheets.hero || {};
      const eveData = spritesheets.eve || {};

      // Params
      const rawMain = getParam('main') || getParam('player') || '';
      const cleanMain = rawMain ? decodeURIComponent(rawMain).replace(/^"|"$/g, '') : '';
      const fwParam = getParam('fw');
      const fhParam = getParam('fh');

      // Choose URL with correct precedence (and only queue ONCE)
      const chosenUrl =
        resolveUrl(cleanMain) ||                       // param (highest)
        resolveUrl(eveData.url || eveData.path) ||     // config spritesheets.eve
        resolveUrl(heroData.url) ||                    // legacy sheets.hero.url
        `${basePath}/assets/hero.png`;                 // fallback

      // Choose frame size (param -> config -> defaults)
      const frameW = Number(fwParam) || eveData.frameWidth || heroData.frameWidth || 103;
      const frameH = Number(fhParam) || eveData.frameHeight || heroData.frameHeight || 142;

      // Queue eve with optional cache-bust only when param used
      this.load.spritesheet('eve', withBustIfParam(chosenUrl, !!cleanMain), {
        frameWidth: frameW,
        frameHeight: frameH,
      });

      // Queue other spritesheets EXCEPT 'eve' (to avoid overriding the param)
      for (const [key, data] of Object.entries(spritesheets)) {
        if (key === 'eve') continue; // don't overwrite
        const src = data.url || data.path;
        if (!src) continue;
        this.load.spritesheet(key, resolveUrl(src), {
          frameWidth: data.frameWidth,
          frameHeight: data.frameHeight,
        });
      }

      // Images
      if (cfg.images1) {
        for (const [key, url] of Object.entries(cfg.images1)) {
          this.load.image(key, resolveUrl(url));
        }
      }
      if (cfg.images2) {
        for (const [key, url] of Object.entries(cfg.images2)) {
          this.load.image(key, resolveUrl(url));
        }
      }
      if (cfg.ui) {
        for (const [key, url] of Object.entries(cfg.ui)) {
          this.load.image(key, resolveUrl(url));
        }
      }

      // Audio
      if (cfg.audio) {
        for (const [key, url] of Object.entries(cfg.audio)) {
          this.load.audio(key, resolveUrl(url));
        }
      }

      console.debug('[Preload] eve queued:', chosenUrl, { frameW, frameH, viaParam: !!cleanMain });

      // Verify actual source used
      this.load.once('complete', () => {
        const tex = this.textures.get('eve');
        const src = tex?.getSourceImage ? tex.getSourceImage().src : '(no src)';
        console.log('[Preload] FINAL eve texture src:', src);
      });

      this.load.start();
    });
  }


  create() {

    this.events.once('shutdown', this.cleanup, this);
    this.events.once('destroy', this.cleanup, this);
    // Read from config
    const cfg = this.cache.json.get('levelConfig') || {};
    const mechanics = cfg.mechanics || {};
    const orientation = cfg.orientation || {};
    this.width = orientation.width || 1080;
    this.height = orientation.height || 1920;



    this.CENTER_X = mechanics.centerX ?? 540;
    this.CENTER_Y = mechanics.centerY ?? 960;
    this.RADIUS = mechanics.radius ?? 300;
    this.NUM_TARGETS = mechanics.numTargets ?? 5;
    this.MIRROR_COUNT = mechanics.mirrorCount ?? 5;
    this.MIRROR_LENGTH = mechanics.mirrorLength ?? 120;

    this.resetRunState();

    if (!this.textures.exists('eve')) {
      console.warn('[Create] Missing spritesheet: eve. Showing minimal fallback.');
      this.add.rectangle(this.width / 2, this.height / 2, this.width, this.height, 0x0b0f1a);
      this.createUI();
      this.showInstructions();
      return; // prevent later sprite/anims usage
    }

    this.timerEvent?.remove?.();
    this.timerEvent = null;

    this.graphics = this.add.graphics();

    if (this.hasTex('background')) {
      this.add.image(this.width / 2, this.height / 2, 'background').setOrigin(0.5).setDepth(0);
    } else {
      // fallback: dark backdrop
      this.add.rectangle(this.width / 2, this.height / 2, this.width, this.height, 0x0b0f1a, 1).setDepth(0);
    }


    if (this.hasAudio('bgm')) {
      this.bgm = this.sound.add('bgm', { loop: true, volume: 0.3 });
      this.bgm.play();
    } else {
      this.bgm = null;
    }


    if (!this.anims.exists('idle')) {
      this.anims.create({
        key: 'idle',
        frames: this.anims.generateFrameNumbers('eve', { start: 0, end: 0 }),
        frameRate: 5,
        repeat: -1,
      });
    }


    // Add cannon (gun) image, centered, same y as player, just right
    this.cannon = this.add.sprite(this.CENTER_X, this.CENTER_Y, 'eve')
      .setOrigin(0.5, 1)
      .setScale(1.3)
      .setDepth(7);
    this.cannon.play('idle');

    const m0 = String(Math.floor(this.timeLeft / 60)).padStart(2, '0');
    const s0 = String(this.timeLeft % 60).padStart(2, '0');



    // Draw mirrors
    this.mirrors = [];
    for (let i = 0; i < this.MIRROR_COUNT; i++) {
      const angleDeg = i * (360 / this.MIRROR_COUNT);
      const angleRad = Phaser.Math.DegToRad(angleDeg);
      const x = this.CENTER_X + Math.cos(angleRad) * this.RADIUS;
      const y = this.CENTER_Y + Math.sin(angleRad) * this.RADIUS;
      const offset = this.MIRROR_LENGTH / 2;
      const x1 = x - offset * Math.cos(angleRad + Math.PI / 4);
      const y1 = y - offset * Math.sin(angleRad + Math.PI / 4);
      const x2 = x + offset * Math.cos(angleRad + Math.PI / 4);
      const y2 = y + offset * Math.sin(angleRad + Math.PI / 4);

      this.mirrors.push({ x1, y1, x2, y2 });
      this.graphics.lineStyle(4, 0x8888ff, 1);
      this.graphics.strokeLineShape(new Phaser.Geom.Line(x1, y1, x2, y2));
      this.graphics.setDepth(2);
    }

    // Add targets
    this.targets = [];
    for (let i = 0; i < this.NUM_TARGETS; i++) {
      const angleDeg = i * (360 / this.NUM_TARGETS) + 60;
      const angleRad = Phaser.Math.DegToRad(angleDeg);
      const x = this.CENTER_X + Math.cos(angleRad) * (this.RADIUS + 150);
      const y = this.CENTER_Y + Math.sin(angleRad) * (this.RADIUS + 150);
      let target;
      if (this.hasTex('enemy')) {
        target = this.add.image(x, y, 'enemy').setDisplaySize(60, 60).setOrigin(0.5).setDepth(2);
      } else {
        target = this.add.circle(x, y, 30, 0xff4444).setDepth(2);
      }


      target.hit = false;
      this.targets.push(target);
    }

    // Score UI
    this.score = 0;
    this.scoreText = this.add.text(this.CENTER_X - 350, 60, 'Score: 0', {
      fontFamily: 'outfit',
      fontSize: '50px',
      color: '#fff',
      align: 'center'
    }).setOrigin(0.5).setDepth(11);

    // Controls
    this.input.on('pointermove', (pointer) => {
      if (!this.gameStarted) return;
      this.angle = Phaser.Math.Angle.Between(this.CENTER_X, this.CENTER_Y, pointer.x, pointer.y);
      this.cannon.rotation = this.angle + Math.PI / 2;
    });

    // Show preview when screen is touched — does NOT fire laser anymore
    this.input.on('pointerdown', () => {
      // Do nothing (or keep angle update only)
    });

    // Nothing on pointer up anymore
    this.input.on('pointerup', () => {
      // no-op
    });



    this.showInstructions();
    this.createUI();

    if (this.hasTex('firebtn')) {
      this.fireBtn = this.add.image(this.CENTER_X, this.height - 200, 'firebtn')
        .setOrigin(0.5)
        .setScale(1)
        .setInteractive()
        .setDepth(10);
    } else {
      this.fireBtn = this.makeButton(this.CENTER_X, this.height - 200, 'FIRE', 10);
    }


    this.fireBtn.on('pointerdown', () => {
      if (!this.gameStarted || this.laserFired || this.gameOverShown) return;

      this.laserFired = true;
      this.graphics.clear();

      // Redraw mirrors after clearing
      this.graphics.lineStyle(4, 0x8888ff, 1);
      for (const mirror of this.mirrors) {
        this.graphics.strokeLineShape(new Phaser.Geom.Line(mirror.x1, mirror.y1, mirror.x2, mirror.y2));
      }

      this.fireLaser();
      this.previewPath = [];
    });


    this.timerText = this.add.text(
      this.CENTER_X + 270, 60, `Time Left: ${m0}:${s0}`, { font: '50px outfit', color: '#ffffff' }
    ).setOrigin(0.5).setDepth(11);


    this.timerEvent = this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        if (!this.gameStarted) return; // ⛔ block timer updates until Play
        this.timeLeft--;

        if (this.timeLeft < 0) {
          this.timeLeft = 0; // ⛔ clamp at 0
          return; // 🛑 prevent further logic (avoid duplicate gameOver call)
        }

        const minutes = String(Math.floor(this.timeLeft / 60)).padStart(2, '0');
        const seconds = String(this.timeLeft % 60).padStart(2, '0');
        this.timerText.setText(`Time Left: ${minutes}:${seconds}`);

        if (this.timeLeft === 0) {
          this.laserFired = true;
          this.graphics?.clear?.();
          if (this.targets.every(t => t.hit || !t.visible)) {
            this.winGame();
          } else {
            this.gameOver();
          }
        }
      }
    });

  }
  // put this inside the class
  resetRunState() {
    // Pull a limit from config if you have it, else default (e.g., 60s)
    const cfg = this.cache.json.get('levelConfig') || {};
    const mechanics = cfg.mechanics || {};
    const defaultLimit = Number.isFinite(mechanics.timeLimit) ? mechanics.timeLimit : 60;

    this.hasGameOverShown = false;
    this.gameOverShown = false;
    this.gameStarted = false;
    this.laserFired = false;
    this.score = 0;

    // fresh timer and UI text
    this.timeLeft = defaultLimit;
    // If timerText exists from a previous run, update it now
    // if (this.timerText) {
    //   // const m = String(Math.floor(this.timeLeft / 60)).padStart(2, '0');
    //   // const s = String(this.timeLeft % 60).padStart(2, '0');
    //   this.timerText.setText(`Time Left: ${m}:${s}`);
    // }
  }


  createUI() {

    if (this.hasTex('scorebar')) {
      this.textBox = this.add.image(540, 60, 'scorebar')
        .setScrollFactor(0).setDepth(9).setScale(1).setOrigin(0.5);
    } else {
      this.textBox = this.add.rectangle(540, 60, 680, 60, 0x222222, 0.9)
        .setScrollFactor(0).setDepth(9).setOrigin(0.5);
    }

  }

  update() { }

  fireLaser() {
    let path = [];
    let currentX = this.CENTER_X;
    let currentY = this.CENTER_Y;
    let dirX = Math.cos(this.angle);
    let dirY = Math.sin(this.angle);

    path.push({ x: currentX, y: currentY });

    let bounceCount = 0;

    while (bounceCount < this.MIRROR_COUNT) {
      let endX = currentX + dirX * 2000;
      let endY = currentY + dirY * 2000;

      let nearest = null;
      let nearestDist = Infinity;
      let hitPoint = null;
      let normal = null;

      for (const mirror of this.mirrors) {
        const line1 = new Phaser.Geom.Line(currentX, currentY, endX, endY);
        const line2 = new Phaser.Geom.Line(mirror.x1, mirror.y1, mirror.x2, mirror.y2);

        const intersect = Phaser.Geom.Intersects.GetLineToLine(line1, line2);
        if (intersect) {
          const ix = Phaser.Geom.Intersects.GetLineToLine(line1, line2);
          if (ix) {
            const dist = Phaser.Math.Distance.Between(currentX, currentY, ix.x, ix.y);
            if (dist < nearestDist) {
              nearestDist = dist;
              nearest = mirror;
              hitPoint = ix;
              normal = this.getNormal(mirror);
            }
          }
        }
      }

      if (!nearest) break;

      path.push(hitPoint);

      const inVec = new Phaser.Math.Vector2(dirX, dirY);
      const normVec = new Phaser.Math.Vector2(normal.x, normal.y);
      const reflect = inVec.reflect(normVec).normalize();

      dirX = reflect.x;
      dirY = reflect.y;
      currentX = hitPoint.x + dirX * 0.5;
      currentY = hitPoint.y + dirY * 0.5;

      bounceCount++;
    }

    path.push({
      x: currentX + dirX * 1000,
      y: currentY + dirY * 1000,
    });

    this.drawLaserPath(path);
    if (this.hasAudio('jump')) this.sound.add('jump', { volume: 2 }).play();



    // Target hit detection + destroy (hide) on hit
    let anyHit = false;
    for (const target of this.targets) {
      if (target.hit || !target.visible) continue;
      for (let i = 0; i < path.length - 1; i++) {
        const dist = this.pointToSegmentDistance(
          target.x, target.y,
          path[i].x, path[i].y,
          path[i + 1].x, path[i + 1].y
        );
        if (dist <= 30) {
          target.hit = true;
          this.sound.add('collection', { volume: 2 }).play();

          this.score += 10;
          this.scoreText.setText('Score: ' + this.score);
          target.setVisible(false);
          anyHit = true;
          break;
        }
      }
    }

    // kill any previous pending laser clear
    this.laserDelay?.remove?.();
    this.laserDelay = this.time.delayedCall(500, () => {
      // scene may already be shutting down; guard everything
      if (!this.sys || !this.sys.isActive()) return;

      this.laserFired = false;

      if (this.graphics?.clear) {
        if (this.graphics?.clear) {
          this.graphics.clear();
          this.graphics.lineStyle(4, 0x8888ff, 1);
          for (const mirror of this.mirrors) {
            this.graphics.strokeLineShape(new Phaser.Geom.Line(mirror.x1, mirror.y1, mirror.x2, mirror.y2));
          }
        }

      }

      if (this.targets?.length && this.targets.every(t => t.hit || !t.visible) && !this.gameOverShown) {
        this.winGame();
      }
    });


  }


  cleanup() {
    try {
      this.physics.pause?.();
      this.input?.removeAllListeners();

      this.laserDelay?.remove?.();
      this.laserDelay = null;

      this.timerEvent?.remove?.();
      this.timerEvent = null;

      this.htpOverlay?.destroy?.(); this.htpOverlay = null;

      this.timerText?.destroy?.(); this.timerText = null;
      this.scoreText?.destroy?.(); this.scoreText = null;
      this.textBox?.destroy?.(); this.textBox = null;
      this.playButton?.off?.('pointerdown'); this.playButton?.destroy?.(); this.playButton = null;

      this.bgm?.stop?.();

      if (this.cannon) { this.cannon.anims?.stop(); this.cannon.destroy(); this.cannon = null; }

      if (this.anims.exists('idle')) this.anims.remove('idle');

      this.fireBtn?.removeAllListeners?.(); this.fireBtn?.destroy?.(); this.fireBtn = null;

      this.graphics?.destroy?.(); this.graphics = null;

      (this.targets || []).forEach(t => t?.destroy?.()); this.targets = [];

      this.hasGameOverShown = false;
    } catch (e) { }
  }



  calculateLaserPath() {
    let path = [];
    let currentX = this.CENTER_X;
    let currentY = this.CENTER_Y;
    let dirX = Math.cos(this.angle);
    let dirY = Math.sin(this.angle);

    path.push({ x: currentX, y: currentY });
    let bounceCount = 0;

    while (bounceCount < this.MIRROR_COUNT) {
      let endX = currentX + dirX * 2000;
      let endY = currentY + dirY * 2000;
      let nearest = null;
      let nearestDist = Infinity;
      let hitPoint = null;
      let normal = null;

      for (const mirror of this.mirrors) {
        const line1 = new Phaser.Geom.Line(currentX, currentY, endX, endY);
        const line2 = new Phaser.Geom.Line(mirror.x1, mirror.y1, mirror.x2, mirror.y2);
        const intersect = Phaser.Geom.Intersects.GetLineToLine(line1, line2);
        if (intersect) {
          const dist = Phaser.Math.Distance.Between(currentX, currentY, intersect.x, intersect.y);
          if (dist < nearestDist) {
            nearestDist = dist;
            nearest = mirror;
            hitPoint = intersect;
            normal = this.getNormal(mirror);
          }
        }
      }

      if (!nearest) break;

      path.push(hitPoint);
      const inVec = new Phaser.Math.Vector2(dirX, dirY);
      const normVec = new Phaser.Math.Vector2(normal.x, normal.y);
      const reflect = inVec.reflect(normVec).normalize();

      dirX = reflect.x;
      dirY = reflect.y;
      currentX = hitPoint.x + dirX * 0.5;
      currentY = hitPoint.y + dirY * 0.5;

      bounceCount++;
    }

    path.push({ x: currentX + dirX * 1000, y: currentY + dirY * 1000 });
    return path;
  }



  showGameComplete() {
    this.gameOverShown = true;

    // Dim background
    const overlay = this.add.rectangle(this.CENTER_X, this.CENTER_Y, this.width, this.height, 0x000000, 0.65).setDepth(10);
    // Show message
    this.add.text(this.CENTER_X, this.CENTER_Y, 'Game Complete!', {
      fontSize: '64px',
      color: '#ffff00',
      fontStyle: 'bold',
      stroke: '#222',
      strokeThickness: 8,
      align: 'center',
    }).setOrigin(0.5).setDepth(11);

    this.add.text(this.CENTER_X, this.CENTER_Y + 100, `Score: ${this.score}`, {
      fontSize: '48px',
      color: '#fff',
      align: 'center',
    }).setOrigin(0.5).setDepth(11);

    // Add restart button
    const restart = this.add.text(this.CENTER_X, this.CENTER_Y + 220, 'Restart', {
      fontSize: '40px',
      backgroundColor: '#444',
      color: '#fff',
      padding: { left: 40, right: 40, top: 12, bottom: 12 },
      borderRadius: 12,
      align: 'center',
    }).setOrigin(0.5).setInteractive().setDepth(11);
    restart.on('pointerdown', () => this.scene.restart());
  }

  drawLaserPath(path, color = 0xff0000) {
    if (!this.graphics) return;
    this.graphics.lineStyle(4, color, 1);
    this.graphics.beginPath();
    this.graphics.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) this.graphics.lineTo(path[i].x, path[i].y);
    this.graphics.strokePath();
  }


  getNormal(mirror) {
    const dx = mirror.x2 - mirror.x1;
    const dy = mirror.y2 - mirror.y1;
    const norm = new Phaser.Math.Vector2(-dy, dx).normalize();
    return { x: norm.x, y: norm.y };
  }

  pointToSegmentDistance(px, py, x1, y1, x2, y2) {
    const A = px - x1;
    const B = py - y1;
    const C = x2 - x1;
    const D = y2 - y1;

    const dot = A * C + B * D;
    const len_sq = C * C + D * D;
    let param = -1;
    if (len_sq !== 0) param = dot / len_sq;

    let xx, yy;
    if (param < 0) {
      xx = x1;
      yy = y1;
    } else if (param > 1) {
      xx = x2;
      yy = y2;
    } else {
      xx = x1 + param * C;
      yy = y1 + param * D;
    }

    const dx = px - xx;
    const dy = py - yy;
    return Math.sqrt(dx * dx + dy * dy);
  }

  startGame() {
    this.instructionVisible = false;
    this.gameStarted = true; // ✅ ALLOW game controls and timer
    if (this.htpOverlay) this.htpOverlay.destroy();
  }



  showInstructions() {
    this.instructionVisible = true;

    this.htpOverlay = this.add.container(0, 0).setDepth(10); // full overlay container

    this.blur = this.add
      .rectangle(0, 0, 1080, 1920, 0x000000, 0.5)
      .setOrigin(0);
    this.howToPlayBox = this.hasTex('htp')
      ? this.add.image(540, 820, "htp")
      : this.add.rectangle(540, 820, 840, 520, 0x1b1f2a, 1).setStrokeStyle(4, 0xffffff, 0.2);

    this.descriptionText = this.add
      .text(
        540,
        800,
        "Destroy all targets by deflecting lasers from the mirrors.",
        {
          font: "60px Outfit",
          color: "#ffffff",
          wordWrap: { width: 800, useAdvancedWrap: true },
        }
      )
      .setOrigin(0.5);

    this.targetLabel = this.add
      .text(240, 1200, "", {
        font: "60px Outfit",
        color: "#ffffff",
      })
      .setOrigin(0.5);

    this.targetScoreText = this.add
      .text(850, 1200, ``, {
        font: "60px Outfit",
        color: "#ffffff",
      })
      .setOrigin(0.5);

    this.playButton = this.hasTex('play_game')
      ? this.add.image(540, 1450, "play_game").setInteractive()
      : this.makeButton(540, 1450, 'PLAY');
    this.playButton.on("pointerdown", () => {
      this.startGame();
    });
    this.htpOverlay.add([
      this.blur,
      this.howToPlayBox,
      this.descriptionText,
      this.targetLabel,
      this.targetScoreText,
      this.playButton,
    ]);
  }

  gameOver() {
    if (this.hasGameOverShown) return;
    this.hasGameOverShown = true;

    this.timerEvent?.remove?.();
    this.timerEvent = null;

    this.bgm?.stop?.();

    const blur = this.add.rectangle(0, 0, 1080, 1920, 0x000000, 0.5)
      .setOrigin(0).setDepth(9);

    const gameOverBox = this.hasTex('game_over')
      ? this.add.image(540, 820, "game_over").setDepth(10)
      : this.add.rectangle(540, 820, 840, 520, 0x2a1b1b, 1).setDepth(10);

    const restartButton = this.hasTex('replay_level')
      ? this.add.image(540, 1170, 'replay_level').setInteractive().setDepth(10)
      : this.makeButton(540, 1170, 'RESTART', 10);

    this.add.text(280, 880, "Your Score:", { font: "60px Outfit", color: "#FFFFFF" })
      .setOrigin(0.5).setDepth(11);
    this.add.text(870, 880, `${this.score}`, { font: "60px Outfit", color: "#FFFFFF" })
      .setOrigin(0.5).setDepth(11);
    const safeRestart = () => {
      restartButton.disableInteractive();
      this.cannon?.anims?.stop();
      this.input?.removeAllListeners();

      // NEW: cancel any pending delayed laser clear
      this.laserDelay?.remove?.();
      this.laserDelay = null;

      // optional: freeze inputs this frame
      this.input.enabled = false;

      this.time.delayedCall(30, () => this.scene.restart());
    };

    restartButton.on('pointerdown', () => {
      restartButton.disableInteractive();           // prevent double fires
      this.input.once('pointerup', () => {          // let the input cycle finish
        // extra guard: cancel any delayed laser clear
        this.laserDelay?.remove?.();
        this.laserDelay = null;

        // freeze input to avoid late handlers touching destroyed objects
        this.input.enabled = false;

        // restart on next tick (zero-delay)
        this.time.delayedCall(0, () => {
          this.scene.stop();
          this.scene.start(this.scene.key);
        });
      });
    });
  }


  winGame() {
    if (this.hasGameOverShown) return;
    this.hasGameOverShown = true;

    this.timerEvent?.remove?.();
    this.timerEvent = null;

    // Guard bgm (can be null)
    this.bgm?.stop?.();

    // define BEFORE using
    const buttonY = 1170;
    const buttonSpacing = 240;

    const gameOverBox = this.hasTex('level_complete')
      ? this.add.image(540, 820, "level_complete").setDepth(10)
      : this.add.rectangle(540, 820, 840, 520, 0x1b2a1b, 1).setDepth(10);

    const blur = this.add
      .rectangle(0, 0, 1080, 1920, 0x000000, 0.5)
      .setOrigin(0)
      .setDepth(9);

    // safer: only use image if texture exists, else fallback to text button
    const replayButton = this.hasTex('replay')
      ? this.add.image(540 - buttonSpacing, buttonY, "replay").setInteractive().setDepth(10)
      : this.makeButton(540 - buttonSpacing, buttonY, 'REPLAY', 10);

    const nextButton = this.hasTex('next')
      ? this.add.image(540 + buttonSpacing, buttonY, "next").setInteractive().setDepth(10)
      : this.makeButton(540 + buttonSpacing, buttonY, 'NEXT', 10);

    this.add.text(290, 880, "Your Score", { font: "60px Outfit", color: "#FFFFFF" })
      .setOrigin(0.5).setDepth(11);
    this.add.text(870, 880, `${this.score}`, { font: "60px Outfit", color: "#FFFFFF" })
      .setOrigin(0.5).setDepth(11);

    const safeRestart = () => {
      this.cannon?.anims?.stop();
      this.input?.removeAllListeners();
      this.timerEvent?.remove?.();
      this.timerEvent = null;

      // NEW: cancel any pending delayed laser clear
      this.laserDelay?.remove?.();
      this.laserDelay = null;

      this.input.enabled = false;
      this.time.delayedCall(30, () => this.scene.restart());
    };

    replayButton.on('pointerdown', () => {
      replayButton.disableInteractive();
      this.input.once('pointerup', () => {
        this.laserDelay?.remove?.();
        this.laserDelay = null;
        this.input.enabled = false;
        this.time.delayedCall(0, () => {
          this.scene.stop();
          this.scene.start(this.scene.key);
        });
      });
    });


    nextButton.on('pointerdown', () => {
      nextButton.disableInteractive();
      this.cannon?.anims?.stop();
      this.input?.removeAllListeners();
      this.notifyParent('sceneComplete', { result: 'win' });
    });
  }

}
