class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameScene', physics: { arcade: { gravity: { y: 0 }, debug: false } } });

    // Runtime state
    this.state = {
      shotsLeft: 6,
      enemiesAlive: 0,
      finished: false,
      scopeRadius: 220,
      aimHot: false,          // true when reticle is over target with clear LOS
      lastShotAt: 0,
      fireCooldownMs: 350,
      reloading: false,
      reloadUntil: 0,
      timeLeftSec: 0,
      _timerEvt: null

    };

    // Refs
    this.cfg = null;
    this.W = 1920; this.H = 1080;

    // Groups / objects
    this.roofs = null;        // static cover platforms
    this.enemies = null;      // alive enemies
    this.dead = null;         // killed corpses/fx (non-physics)
    this.ui = { shots: null };

    // Input
    this.pointer = null;

    // Virtual joystick state
    this._joy = { base: null, knob: null, active: false, vec: new Phaser.Math.Vector2(0, 0) };
    this._joySpeed = 5; // scope pan speed per frame driven by joystick


    // Scope rendering
    this.scope = { gfx: null, maskGfx: null, container: null };
  }

  init() {
    const cfg = this.registry.get('cfg') || {};
    // Reset all per-run state
    this.state.finished = false;
    this.state.timeLeftSec = cfg?.gameplay?.timeLimitSec ?? 120;

    this.state.enemiesAlive = 0;
    this.state.aimHot = false;
    this.state.reloading = false;
    this.state.reloadUntil = 0;
    this.state.lastShotAt = 0;
    this.state.shotsLeft = cfg?.gameplay?.bulletLimit ?? 10; // safe default for UI build
    this._mobileActionPressed = false;
    if (this._joy?.vec) this._joy.vec.set(0, 0);
  }


  preload() {
    // Load from config placed in registry by your Boot scene
    const cfg = this.registry.get('cfg') || {};
    const images = (cfg.images1 || {});
    const images2 = (cfg.images2 || {});
    const ui = (cfg.ui || {});
    const audio = (cfg.audio || {});
    const spritesheets = (cfg.spritesheets || {});

    // Images
    Object.keys(images).forEach(key => {
      this.load.image(key, images[key]);
    });
    Object.keys(images2).forEach(key => {
      this.load.image(key, images2[key]);
    });
    Object.keys(ui).forEach(key => {
      this.load.image(key, ui[key]);
    });


    // Spritesheets
    Object.keys(spritesheets).forEach(key => {
      const s = spritesheets[key];
      this.load.spritesheet(key, s.url, { frameWidth: s.frameWidth, frameHeight: s.frameHeight });
    });

    // Audio
    Object.keys(audio).forEach(key => this.load.audio(key, audio[key]));

    // Font (optional)
    // if (cfg.font && cfg.font.url) this.load.font('gamefont', cfg.font.url);
  }

  create() {

    this.tweens.killAll();
    this.time.removeAllEvents();
    this.sound.stopAll();
    this.cfg = this.registry.get('cfg') || {};
    this.W = this.scale.width; this.H = this.scale.height;

    if (this.cfg.orientation?.frame === 'landscape' && screen.orientation && screen.orientation.lock) {
      screen.orientation
        .lock('landscape-primary')
        .catch(err => console.warn('Orientation lock failed:', err));
    }
    if (this.scale.fullscreen.available && !this.scale.isFullscreen) {
      this.scale.startFullscreen();
    }
    // bullet limit from config (fallback 10)
    this.state.shotsLeft = this.cfg?.gameplay?.bulletLimit ?? 10;


    // World groups
    this.roofs = this.physics.add.staticGroup();
    this.enemies = this.physics.add.group();
    this.dead = this.add.group();

    // Background (simple dark to keep focus on scope view)
    this.add.image(0, 0, 'background').setOrigin(0, 0).setDisplaySize(this.W, this.H);
    // this.cameras.main.setBackgroundColor(0x000000);

    // Build one rooftop skyline using platform images (scaled & with matching collider sizes)
    this._spawnRooftops();

    // Spawn enemies (patrolling silhouettes)
    const level = this.cfg.gameplay?.level || {};
    const enemyDefs = level.enemies || [];
    enemyDefs.forEach(def => this._spawnEnemy(def));

    this.state.enemiesAlive = this.enemies.getLength();
    this.state.totalEnemies = this.state.enemiesAlive;

    // UI: shots (top-right)
    this._buildShotsUI();

    this.add.image(960, 70, 'timerbar').setOrigin(0.5).setScale(1).setDepth(99);
    this.add.text(830, 40, 'TIME: ', {
      fontFamily: 'Outfit',
      fontSize: '40px',
      color: '#030202ff',
     
      // strokeThickness: 4
    }).setDepth(100);
    // ---- TIMER UI (top-center) ----
    this.ui.timer = this.add.text(this.W * 0.5 + 40, 40, '', {
      fontFamily: 'Outfit, Arial',
      fontSize: '40px',
      color: '#030101ff',
      // stroke: '#000000',
      // strokeThickness: 4
    }).setOrigin(0.5, 0).setDepth(100);

    this._refreshTimerUI();

    // Start ticking each second
    this.state._timerEvt = this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        if (this.state.finished) return;
        this.state.timeLeftSec = Math.max(0, this.state.timeLeftSec - 1);
        this._refreshTimerUI();

        // If time ran out and enemies remain -> Game Over
        if (this.state.timeLeftSec <= 0 && this.state.enemiesAlive > 0 && !this.state.finished) {
          if (this.sfx?.bgm) this.sfx.bgm.stop();
          this._finish(false);
        }
      }
    });


    // Reload UI (hidden until needed)
    this.ui.reload = this.add.text(this.W * 0.5, 80, '', {
      fontFamily: 'Outfit, Arial',
      fontSize: '40px',
      color: '#ff2b2b',
      stroke: '#000000',
      strokeThickness: 4
    }).setOrigin(0.5).setDepth(30).setVisible(false);

    this.tweens.add({
      targets: this.ui.reload,
      scale: 1.12,
      duration: 300,
      yoyo: true,
      repeat: -1,
      paused: true
    });



    // Audio
    this.sfx = {
      bgm: this.sound.add('bgm', { volume: 0.35, loop: true }),
      shot: this.sound.add('attack', { volume: 0.6 }),
      hit: this.sound.add('hit', { volume: 0.6 }),
      kill: this.sound.add('destroy', { volume: 0.7 }),
      reload: this.sound.add('reload', { volume: 0.7, loop: false })
    };
    if (this.sfx.bgm) this.sfx.bgm.play();

    // Input
    this.pointer = this.input.activePointer;

    // Scope overlay & mask
    this._createScope();

    // Mobile controls (hold left/right pans; action = fire)
    this._setupMobileButtons();

    // this._setupPhysicsDebug();

    // Collisions not needed (we raycast), but ensure bodies are enabled
    // Update loop timer (for patrol)

    this.time.addEvent({ loop: true, delay: 20, callback: this._tickPatrol, callbackScope: this });
  }

  update(time) {
    if (this.state.finished) return;

    // Manual panning on desktop via mouse drag
    // this._handleDesktopPan();
    this._applyJoystickPan();

    // Scope reticle + “hot” detection
    const hot = this._aimIsOnTarget();
    if (hot !== this.state.aimHot) {
      this.state.aimHot = hot;
      this._redrawScope();
    }

    // Fire (mouse/touch or mobile Action)
    if (this._shouldFire(time)) {
      this._fire(time);
    }

    // Victory check
    // Victory check
    if (this.state.enemiesAlive <= 0 && !this.state.finished) {
      this._finish(true); // → WinScene
    }

  }

  // Finish the level and swap scenes
  _finish(win) {
    if (this.state._timerEvt) {
      this.state._timerEvt.remove(false);
      this.state._timerEvt = null;
    }

    if (this.state.finished) return;         // guard
    this.state.finished = true;
    if (this.sfx?.bgm) this.sfx.bgm.stop();

    // Optional: pass some stats
    const data = {
      bulletsLeft: this.state.shotsLeft,
      enemiesLeft: this.state.enemiesAlive,
      totalEnemies: this.state.totalEnemies ?? 0
    };

    this.scene.start(win ? 'WinScene' : 'GameOverScene', data);
  }


  // --------------------------
  // Level build
  // --------------------------
  _spawnRooftops() {
    const platKey = this.cfg.images2?.platform ? 'platform' : 'platform1';

    const roofs = this.cfg.gameplay?.level?.roofs || [
      { x: 350, y: this.H - 180, w: 420, h: 48 },
      { x: 830, y: this.H - 240, w: 360, h: 48 },
      { x: 1220, y: this.H - 180, w: 500, h: 48 },
      { x: 1600, y: this.H - 280, w: 420, h: 48 },
    ];

    const padX = this.cfg?.gameplay?.roofCollider?.padX ?? 0;
    const padY = this.cfg?.gameplay?.roofCollider?.padY ?? 0;

    // NEW: positive = push collider DOWN, negative = move it UP (relative to the sprite)
    const shiftY = this.cfg?.gameplay?.roofCollider?.shiftY ?? 0;

    roofs.forEach(r => {
      const spr = this.add.sprite(r.x, r.y, platKey);
      spr.setDisplaySize(r.w, r.h);

      this.physics.add.existing(spr, true); // static body

      // collider size (your current logic)
      const cw = Math.max(2, r.w - padX * 2);
      const ch = Math.max(2, r.h - padY * 2 - 200);

      // IMPORTANT: no updateFromGameObject() after customizing body
      spr.body.setSize(cw, ch);

      // ⬇️ move the hitbox vertically without moving the sprite
      spr.body.setOffset(padX, padY + shiftY);

      // keep LOS blocker rect in sync with the shifted collider
      spr.setData('blocker', {
        rx: spr.x - r.w / 2 + padX,
        ry: spr.y - r.h / 2 + padY + shiftY,  // ⬅️ include shiftY here too
        rw: cw,
        rh: ch
      });

      this.roofs.add(spr);
    });
  }


  _spawnEnemy(def) {
    // def: { x, y, patrol:{dx|minX|maxX|speed}, size, key }
    const key = def.key || 'enemy';
    const size = def.size || 56;

    const e = this.add.sprite(def.x, def.y, key);
    e.setDisplaySize(size, size);
    e.setOrigin(0.5, 0.5);

    this.physics.add.existing(e);
    const body = e.body;
    body.setAllowGravity(false);

    // ---- GROW THE ENEMY HITBOX (height/width) ----
    const extraW = this.cfg?.gameplay?.enemyCollider?.extraW ?? 0;
    const extraH = this.cfg?.gameplay?.enemyCollider?.extraH ?? 0;

    // keep the collider centered around the sprite (origin 0.5)
    // then snap offset to your existing pattern (0,0)
    body.setSize(e.displayWidth + extraW, e.displayHeight + extraH, true);
    body.setOffset(0, 0);
    // IMPORTANT: no negative offset

    e.setDataEnabled();
    e.setData('alive', true);
    e.setData('patrol', {
      speed: (def.patrol?.speed ?? 60),
      minX: (def.patrol?.minX ?? def.x - (def.patrol?.dx ?? 120)),
      maxX: (def.patrol?.maxX ?? def.x + (def.patrol?.dx ?? 120)),
      dir: 1
    });

    this.enemies.add(e);
  }


  _tickPatrol() {
    this.enemies.children.iterate(e => {
      if (!e || !e.getData('alive')) return;
      const p = e.getData('patrol');
      if (!p) return;
      e.x += p.dir * p.speed * 0.02;
      if (e.x > p.maxX) { e.x = p.maxX; p.dir = -1; }
      if (e.x < p.minX) { e.x = p.minX; p.dir = 1; }
      if (e.anims) e.setFlipX(p.dir < 0);
      if (e.body) e.body.updateFromGameObject(); // keeps body perfectly in sync with the sprite

    });
  }

  // --------------------------
  // Scope, Pan & Fire
  // --------------------------
  _createScope() {
    const r = this.state.scopeRadius;

    // Crosshair
    const scopeGfx = this.add.graphics();
    this.scope = { gfx: scopeGfx, r };
    this._redrawScope();
    scopeGfx.setPosition(this.W * 0.35, this.H * 0.50).setDepth(11);

    // --- Vignette via RenderTexture + erase hole ---
    this._spot = this._spot || {};

    // Clean up from replays (avoid leaking textures/hidden sprites)
    if (this._spot.eraseImg) { this._spot.eraseImg.destroy(); this._spot.eraseImg = null; }
    if (this.textures.exists('scopeHole')) this.textures.remove('scopeHole');

    // RenderTexture overlay
    this._spot.rt = this.add.renderTexture(0, 0, this.W, this.H)
      .setOrigin(0, 0)
      .setDepth(10)                // below crosshair, above world
      .setBlendMode(Phaser.BlendModes.NORMAL);

    // Build a crisp circle texture once, then reuse it for erasing
    const pad = 2;                 // small radius boost to avoid any halo
    const d = (r + pad) * 2;
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(0xffffff, 1);
    g.fillCircle(d / 2, d / 2, r + pad);
    g.generateTexture('scopeHole', d, d);
    g.destroy();

    // Hidden image used as the eraser source
    this._spot.eraseImg = this.add.image(0, 0, 'scopeHole').setVisible(false).setOrigin(0.5);

    this._updateVignetteHole();
  }

  _updateVignetteHole() {
    const rt = this._spot?.rt;
    if (!rt) return;

    // Paint fully opaque overlay, punch a clean hole, THEN apply overall alpha
    rt.clear();
    rt.fill(0x000000, 1); // full alpha paint
    rt.erase(this._spot.eraseImg, this.scope.gfx.x, this.scope.gfx.y);
    rt.setAlpha(0.84);
  }


  _redrawScope() {
    const g = this.scope.gfx;
    const r = this.scope.r;
    g.clear();

    // Rim
    g.lineStyle(6, this.state.aimHot ? 0xff2b2b : 0x9fa1a5, 1);
    g.strokeCircle(0, 0, r);

    // Crosshair lines
    g.lineStyle(2, 0x1f5a7a, 1);
    g.beginPath();
    g.moveTo(-r, 0); g.lineTo(r, 0);
    g.moveTo(0, -r); g.lineTo(0, r);
    g.strokePath();

    // Center dot
    g.fillStyle(this.state.aimHot ? 0xff2b2b : 0x1f5a7a, 1);
    g.fillCircle(0, 0, 4);
  }

  // _handleDesktopPan() {
  //   // Click-drag to move scope
  //   if (this.input.activePointer.isDown) {
  //     const p = this.input.activePointer;
  //     this.scope.gfx.setPosition(p.worldX, p.worldY);
  //     this.scope.maskGfx.setPosition(p.worldX, p.worldY);
  //   }
  // }

  _panBy(dx, dy) {
    const g = this.scope.gfx;
    let x = g.x + dx, y = g.y + dy;
    const r = this.scope.r + 6;
    x = Phaser.Math.Clamp(x, r, this.W - r);
    y = Phaser.Math.Clamp(y, r, this.H - r);
    g.setPosition(x, y);

    // keep the vignette hole aligned with the scope
    this._updateVignetteHole();
  }


  _shouldFire(time) {
    // Block fire while reloading or out of bullets
    if (this.state.reloading || this.state.shotsLeft <= 0) return false;

    // Desktop: just-pressed left button
    const desktopPress = this.input.activePointer.leftButtonDown() && this.input.activePointer.justDown;
    // Mobile: set by button
    const mobilePress = this._mobileActionPressed === true;

    const canFire = (time - this.state.lastShotAt) >= this.state.fireCooldownMs;
    if (mobilePress) this._mobileActionPressed = false;
    return canFire && (desktopPress || mobilePress);
  }

  _fire(time) {
    this.state.lastShotAt = time;
    this.state.shotsLeft--;
    if (this.sfx.shot) this.sfx.shot.play();
    this._refreshShotsUI();

    // If hot, eliminate the locked enemy and play hit effect
    const hitEnemy = this._getEnemyUnderReticleWithLOS();
    if (hitEnemy) {
      if (this.sfx.hit) this.sfx.hit.play();
      if (this.sfx.kill) this.sfx.kill.play();

      hitEnemy.setData('alive', false);
      this.enemies.remove(hitEnemy, true, true);

      // corpse
      const corpse = this.add.sprite(hitEnemy.x, hitEnemy.y, 'enemy');
      corpse.setDisplaySize(hitEnemy.displayWidth, hitEnemy.displayHeight);
      corpse.setTint(0x101010);
      corpse.setAlpha(0.6);
      this.dead.add(corpse);

      // visual feedback
      this._spawnHitEffect(hitEnemy.x, hitEnemy.y);
      this.state.enemiesAlive--;
      if (this.state.enemiesAlive <= 0 && !this.state.finished) {
        this._finish(true);
        return;
      }


      if (this.state.enemiesAlive <= 0 && !this.state.finished) {
        this._finish(true);
        return;
      }

    }

    // If out of bullets and still enemies -> fail will be checked below
    // Start reload (1–2s, configurable)
    const minMs = (this.cfg?.gameplay?.reloadMsMin ?? 1000);
    const maxMs = (this.cfg?.gameplay?.reloadMsMax ?? 2000);
    const reloadMs = Phaser.Math.Between(minMs, maxMs);

    this.state.reloading = false;
    this.state.reloadUntil = time + reloadMs;

    // Play reload sound (no loop)
    if (this.sfx.reload) {
      // prevent overlap if player spams tap at the edge of cooldown
      this.sfx.reload.stop();
      this.sfx.reload.play();
    }


    // Show RELOAD UI
    if (this.ui.reload) {
      this.ui.reload.setVisible(true);
      if (this.ui.reload.anims && this.ui.reload.anims.isPlaying) { /* no-op */ }
    }
    // start pulsing tween if you added it above
    const t = this.tweens.getTweensOf(this.ui.reload)[0];
    if (t) t.resume?.();

    // Finish reload after delay
    this.time.delayedCall(reloadMs, () => {
      this.state.reloading = false;
      if (this.ui.reload) this.ui.reload.setVisible(false);
      // stop pulsing tween when hidden
      const t2 = this.tweens.getTweensOf(this.ui.reload)[0];
      if (t2) t2.pause?.();
    });

    if (this.state.shotsLeft <= 0 && this.state.enemiesAlive > 0 && !this.state.finished) {
      if (this.sfx.bgm) this.sfx.bgm.stop();
      this._finish(false); // → GameOverScene
      return;
    }

  }


  // --------------------------
  // Aim & LOS helpers
  // --------------------------
  _aimIsOnTarget() {
    return !!this._getEnemyUnderReticleWithLOS();
  }

  _getEnemyUnderReticleWithLOS() {
    const cx = this.scope.gfx.x;
    const cy = this.scope.gfx.y;

    let target = null;
    let bestD2 = Infinity;

    this.enemies.children.iterate(e => {
      if (!e || !e.active || !e.getData('alive')) return;

      const body = e.body;
      // 1) Use Arcade’s precise body hit-test (matches your display size from _spawnEnemy)
      const pointInside = body
        ? body.hitTest(cx, cy)
        : Phaser.Geom.Rectangle.Contains(e.getBounds(), cx, cy); // fallback

      if (!pointInside) return;

      // 2) Optional LOS check to respect roofs
      const ex = e.x, ey = e.y; // origin is 0.5 already
      if (!this._lineHasClearSight(cx, cy, ex, ey)) return;

      // 3) Pick the closest valid enemy
      const dx = ex - cx, dy = ey - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; target = e; }
    });

    return target;
  }


  _lineHasClearSight(x1, y1, x2, y2) {
    const roofs = this.roofs.getChildren();
    for (let i = 0; i < roofs.length; i++) {
      const r = roofs[i];

      // Prefer the trimmed "blocker" rect; fallback to display rect if missing
      const blk = r.getData('blocker');
      const rx = blk ? blk.rx : r.x - r.displayWidth / 2;
      const ry = blk ? blk.ry : r.y - r.displayHeight / 2;
      const rw = blk ? blk.rw : r.displayWidth;
      const rh = blk ? blk.rh : r.displayHeight;

      if (this._segmentIntersectsAABB(x1, y1, x2, y2, rx, ry, rw, rh)) {
        const bothAbove = (y1 < ry + 1) && (y2 < ry + 1);
        if (!bothAbove) return false;
      }
    }
    return true;
  }


  _segmentIntersectsAABB(x1, y1, x2, y2, rx, ry, rw, rh) {
    // Liang–Barsky style clip (simplified)
    let t0 = 0, t1 = 1;
    const dx = x2 - x1, dy = y2 - y1;

    const p = [-dx, dx, -dy, dy];
    const q = [x1 - rx, rx + rw - x1, y1 - ry, ry + rh - y1];

    for (let i = 0; i < 4; i++) {
      if (p[i] === 0) {
        if (q[i] < 0) return false;
      } else {
        const t = q[i] / p[i];
        if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
        else { if (t < t0) return false; if (t < t1) t1 = t; }
      }
    }
    return true;
  }

  // --------------------------
  // UI — Shots
  // --------------------------
  _buildShotsUI() {
    const bullets = [];
    const iconW = 28, gap = 1;
    const uiDepth = 100;
    for (let i = 0; i < this.state.shotsLeft; i++) {
      const b = this.add.image(this.W - 20 - i * (iconW + gap), 28, 'bullet');
      b.setOrigin(1, 0);
      b.setScale(0.3);
      b.setDepth(uiDepth);
      bullets.push(b);

    }
    this.ui.shots = bullets;
  }
  _refreshShotsUI() {
    const left = this.state.shotsLeft;
    this.ui.shots.forEach((b, idx) => {
      b.setAlpha(idx < left ? 1 : 0.25);
    });
  }

  _formatMMSS(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  _refreshTimerUI() {
    if (!this.ui?.timer) return;
    this.ui.timer.setText(this._formatMMSS(this.state.timeLeftSec));
  }


  // --------------------------
  // Mobile buttons
  // --------------------------
  _setupMobileButtons() {
    // ACTION button (fire)
    const hasAction = !!this.textures.exists('action');
    if (hasAction) {
      const btn = this.add.image(this.W - 200, this.H - 160, 'action').setInteractive({ useHandCursor: true });
      btn.setDisplaySize(200, 200);
      btn.setDepth(20);
      btn.on('pointerdown', () => {
        btn.setScale(1); btn.setAlpha(0.8);
        this._mobileActionPressed = true;   // handled in _shouldFire()
      });
      btn.on('pointerup', () => { btn.setScale(1); btn.setAlpha(1); });
      btn.on('pointerout', () => { btn.setScale(1); btn.setAlpha(1); });
    }

    // JOYSTICK (left bottom). Uses Graphics (no extra assets required)
    const baseR = 110, knobR = 60;
    const x = 200, y = this.H - 160;

    // base
    const base = this.add.circle(x, y, baseR, 0x000000, 0.35).setStrokeStyle(2, 0xffffff, 0.25);
    base.setDepth(20).setInteractive({ draggable: true });

    // knob
    const knob = this.add.circle(x, y, knobR, 0xffffff, 0.5).setStrokeStyle(2, 0x000000, 0.4);
    knob.setDepth(21).setInteractive({ draggable: true });

    this._joy.base = base;
    this._joy.knob = knob;

    const start = (pointer) => {
      this._joy.active = true;
      this._joy.originX = base.x;
      this._joy.originY = base.y;
      this._updateJoy(pointer.worldX, pointer.worldY, baseR);
    };

    const move = (pointer) => {
      if (!this._joy.active) return;
      this._updateJoy(pointer.worldX, pointer.worldY, baseR);
    };

    const end = () => {
      this._joy.active = false;
      this._joy.vec.set(0, 0);
      knob.setPosition(base.x, base.y);
    };

    // pointer events for both circles (so dragging either works)
    [base, knob].forEach(s => {
      s.on('pointerdown', (p) => start(p));
      s.on('pointermove', (p) => move(p));
      s.on('pointerup', () => end());
      s.on('pointerout', () => end());
      s.on('pointerupoutside', () => end());
    });
  }

  // compute joystick vector and place knob (clamped to base radius)
  _updateJoy(wx, wy, radius) {
    const ox = this._joy.originX, oy = this._joy.originY;
    const dx = wx - ox, dy = wy - oy;
    const len = Math.sqrt(dx * dx + dy * dy) || 0.0001;
    const clamped = Math.min(len, radius);
    const nx = dx / len, ny = dy / len;

    // store normalized vector scaled by intensity (0..1)
    const intensity = clamped / radius;
    this._joy.vec.set(nx * intensity, ny * intensity);

    // position the knob
    const kx = ox + nx * clamped;
    const ky = oy + ny * clamped;
    this._joy.knob.setPosition(kx, ky);
  }

  // apply panning from joystick every frame
  _applyJoystickPan() {
    if (!this._joy.active) return;
    // Pan speed scaled by joystick intensity
    const dx = this._joy.vec.x * this._joySpeed;
    const dy = this._joy.vec.y * this._joySpeed;
    this._panBy(dx, dy);
  }

  // Simple hit effect: small camera shake + pulse at impact point + quick rim flash
  _spawnHitEffect(x, y) {
    // Camera micro-shake
    this.cameras.main.shake(120, 0.0025);

    // Pulse circle at impact
    const pulse = this.add.circle(x, y, 6, 0xffffff, 0.9).setDepth(25);
    this.tweens.add({
      targets: pulse,
      radius: { from: 6, to: 36 },
      alpha: { from: 0.9, to: 0 },
      duration: 180,
      ease: 'Cubic.easeOut',
      onComplete: () => pulse.destroy()
    });

    // Brief red flash on scope rim
    const oldHot = this.state.aimHot; // remember current rim color state
    this.state.aimHot = true;
    this._redrawScope();
    this.time.delayedCall(120, () => {
      this.state.aimHot = oldHot;
      this._redrawScope();
    });
  }


  _mkBtn(key, x, y, onHold) {
    const btn = this.add.image(x, y, key).setInteractive({ useHandCursor: true });
    btn.setDisplaySize(110, 110);
    btn.setDepth(20);
    btn.on('pointerdown', () => { btn.setScale(0.92); btn.setAlpha(0.8); btn._down = true; onHold(); });
    btn.on('pointerup', () => { btn.setScale(1); btn.setAlpha(1); btn._down = false; });
    btn.on('pointerout', () => { btn.setScale(1); btn.setAlpha(1); btn._down = false; });
    // hold repeat
    this.time.addEvent({ loop: true, delay: 30, callback: () => { if (btn._down) onHold(); }, callbackScope: this });
  }

  _setupPhysicsDebug() {
    const w = this.physics.world;

    // Create (or reuse) the debug graphics layer
    if (!w.debugGraphic) w.createDebugGraphic();

    // Make sure it actually draws
    w.drawDebug = true;

    // Put it ABOVE the vignette (depth 10) and crosshair (depth 11) but below UI (100+)
    w.debugGraphic
      .setDepth(15)
      .setAlpha(1)
      .setScrollFactor(1);

    // Optional: quick toggle with the D key during dev
    this.input.keyboard?.on('keydown-D', () => {
      w.drawDebug = !w.drawDebug;
      w.debugGraphic.setVisible(w.drawDebug);
      if (!w.drawDebug) w.debugGraphic.clear();
    });
  }

}
