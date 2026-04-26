// Scenes/GameScene.js
// Portrait 1080x1920
// Visual-Polish edition – safe, replay-proof, mobile-friendly.
// Mechanics unchanged. All effects are optional and wrapped.

class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');

    // ---- Enhancement tracking (SAFE) ----
    this.enhancementActive = true;
    this.activeEffects = new Set();     // display objects created for FX
    this.activeTweens = new Set();      // tweens we spawn
    this.activeParticles = new Set();   // particle managers
    this.enhancementsInitialized = false;
    this.maxEffects = 80;

    // Existing flags
    this._levelIndex = 0;
    this._collStart = null;
    this._collActive = null;
  }

  // ===== SAFETY + UTIL =====
  safeEnhance(effectFunction, fallbackFunction = () => {}) {
    try {
      effectFunction.call(this);
    } catch (err) {
      // Never break gameplay if FX fail
      console.warn('[Enhance] failed safely:', err);
      try { fallbackFunction.call(this); } catch {}
    }
  }

  _trackTween(tw) {
    if (!tw) return tw;
    this.activeTweens.add(tw);
    tw.once('complete', () => this.activeTweens.delete(tw));
    tw.once('stop',     () => this.activeTweens.delete(tw));
    return tw;
  }

  _trackEffect(go) {
    if (!go || !go.destroy) return go;
    this.activeEffects.add(go);
    // Auto-untrack on destroy
    const origDestroy = go.destroy.bind(go);
    go.destroy = (...args) => {
      this.activeEffects.delete(go);
      return origDestroy(...args);
    };
    return go;
  }

  _trackParticles(pm) {
    if (!pm) return pm;
    this.activeParticles.add(pm);
    const origDestroy = pm.destroy?.bind(pm);
    pm.destroy = (...args) => {
      this.activeParticles.delete(pm);
      return origDestroy ? origDestroy(...args) : undefined;
    };
    return pm;
  }

  // ===== DEVICE VIBRATION UTILITY =====
  vibrate(pattern = 50) {
    try {
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(pattern);
      }
    } catch (err) {
      // Vibration not supported or failed, silently continue
      console.warn('[Vibration] not supported:', err);
    }
  }

  monitorPerformance() {
    // graceful degrade if FPS drops
    const fps = this.game?.loop?.actualFps || 60;
    if (fps < 45 && this.enhancementActive) {
      // reduce emissive effects
      this.activeParticles.forEach(pm => {
        if (pm && pm.emitters) {
          pm.emitters.list.forEach(e => {
            if (e?.ops?.quantity) e.ops.quantity.value = Math.max(1, Math.floor((e.ops.quantity.value || 4) * 0.5));
          });
        }
      });
      // soften camera shakes by scaling factor
      this._shakeScale = 0.5;
    } else {
      this._shakeScale = 1.0;
    }
  }

  cleanupAllEnhancements() {
    // Kill tweens
    try { this.tweens.killAll(); } catch {}
    this.activeTweens.forEach(t => { try { t.stop(); } catch {} });
    this.activeTweens.clear();

    // Particles
    this.activeParticles.forEach(pm => { try { pm.destroy(); } catch {} });
    this.activeParticles.clear();

    // Display FX (ripples, flashes, temp graphics, etc.)
    this.activeEffects.forEach(go => { try { go.destroy(); } catch {} });
    this.activeEffects.clear();

    // Timers
    try { this.time.removeAllEvents(); } catch {}

    // Reset any modified child properties
    this.resetEnhancedObjects();

    this.enhancementsInitialized = false;
  }

  preserveOriginalState(sprite) {
    if (!sprite || !sprite.setData) return;
    if (!sprite.getData('origScaleX')) sprite.setData('origScaleX', sprite.scaleX);
    if (!sprite.getData('origScaleY')) sprite.setData('origScaleY', sprite.scaleY);
    if (!sprite.getData('origAlpha'))  sprite.setData('origAlpha',  sprite.alpha);
    if (!sprite.getData('origTint'))   sprite.setData('origTint',   sprite.tintTopLeft || 0xffffff);
  }

  resetEnhancedObjects() {
    if (!this.children?.list) return;
    this.children.list.forEach(child => {
      try {
        const sx = child.getData?.('origScaleX');
        const sy = child.getData?.('origScaleY');
        const oa = child.getData?.('origAlpha');
        const ot = child.getData?.('origTint');
        if (sx != null) child.setScale(sx, sy ?? sx);
        if (oa != null) child.setAlpha(oa);
        if (ot != null && child.setTint) child.setTint(ot);
      } catch {}
    });
  }

  // ===== ENHANCEMENT APIS =====
  enhanceSpawn(sprite, opts = {}) {
    if (!sprite) return;
    this.preserveOriginalState(sprite);
    const { duration = 260, ease = 'Back.easeOut', from = 0.0 } = opts;
    const toX = sprite.scaleX, toY = sprite.scaleY;
    sprite.setScale(from, from).setAlpha(0.0);
    this._trackTween(this.tweens.add({
      targets: sprite,
      scaleX: toX, scaleY: toY, alpha: 1,
      duration, ease
    }));
  }

  enhanceButtonPress(button) {
    if (!button || !button.on) return;
    // Avoid duplicate handlers
    if (button.getData && button.getData('__fxBound')) return;
    button.setData?.('__fxBound', true);

    button.on('pointerdown', () => {
      this.safeEnhance(() => {
        this._trackTween(this.tweens.add({
          targets: button,
          scaleX: (button.scaleX || 1) * 0.92,
          scaleY: (button.scaleY || 1) * 0.92,
          alpha: 0.8,
          duration: 90,
          ease: 'Power2'
        }));
      });
    });

    const upReset = () => {
      this.safeEnhance(() => {
        this._trackTween(this.tweens.add({
          targets: button,
          scaleX: button.getData?.('origScaleX') ?? 1,
          scaleY: button.getData?.('origScaleY') ?? 1,
          alpha:   button.getData?.('origAlpha')  ?? 1,
          duration: 110,
          ease: 'Power2'
        }));
      });
    };
    button.on('pointerup', upReset);
    button.on('pointerout', upReset);
  }

  addScreenShake(intensity = 0.004, duration = 120) {
    const scale = this._shakeScale ?? 1.0;
    this.safeEnhance(() => this.cameras.main.shake(duration, intensity * scale));
  }

  createTouchRipple(x, y) {
    this.safeEnhance(() => {
      const ripple = this._trackEffect(this.add.circle(x, y, 6, 0xffffff, 0.25).setDepth(100));
      this._trackTween(this.tweens.add({
        targets: ripple,
        radius: 32,
        alpha: 0,
        duration: 260,
        ease: 'Quad.easeOut',
        onComplete: () => ripple.destroy()
      }));
    });
  }

  createCollectionEffect(x, y) {
    // small pop + star burst
    this.safeEnhance(() => {
      const pop = this._trackEffect(this.add.graphics().setDepth(50));
      pop.lineStyle(2, 0xffff66, 1);
      pop.strokeCircle(0, 0, 8);
      pop.setPosition(x, y).setAlpha(1).setScale(1);
      this._trackTween(this.tweens.add({
        targets: pop,
        alpha: 0,
        scale: 1.7,
        duration: 180,
        ease: 'Quad.easeOut',
        onComplete: () => pop.destroy()
      }));

      const mgr = this._emitters?.starBurst;
      if (mgr) {
        if (typeof mgr.emitParticleAt === 'function') mgr.emitParticleAt(x, y, 10);
        else if (typeof mgr.explode === 'function')    mgr.explode(10, x, y);
      }
    });
  }

  createHitEffect(x, y) {
    this.safeEnhance(() => {
      const mgr = this._emitters?.cutBurst;
      if (mgr) {
        if (typeof mgr.emitParticleAt === 'function') mgr.emitParticleAt(x, y, 14);
        else if (typeof mgr.explode === 'function')    mgr.explode(14, x, y);
      }
      this.addScreenShake(0.006, 120);
      const flash = this._trackEffect(this.add.rectangle(this.cameras.main.centerX, this.cameras.main.centerY, this.scale.width, this.scale.height, 0xff4040, 0.15).setDepth(200));
      this._trackTween(this.tweens.add({ targets: flash, alpha: 0, duration: 140, onComplete: () => flash.destroy() }));
    });
  }

  // ===== ORIGINAL LIFECYCLE (kept) with enhancements woven in safely =====
  init(data) {
    this._levelIndex = (data && typeof data.levelIndex === 'number') ? data.levelIndex : 0;
  }

  preload() {
    this.cfg = this.registry.get('cfg') || {};

    const img = this.cfg.images1 || {};
    const images2 = this.cfg.images2 || {};
    const ui = this.cfg.ui || {};
    const aud = this.cfg.audio || {};
    const ss = this.cfg.spritesheets || {};
    const font = this.cfg.font || {};

    try {
      if (font.family && font.url && typeof window !== 'undefined' && window.loadFont) {
        window.loadFont(font.family, font.url);
      }
    } catch { }

    Object.entries(img).forEach(([key, url]) => {
      if (typeof url === 'string' && url.endsWith('.png')) {
        this.load.image(key, url);
      }
    });
    Object.entries(images2).forEach(([key, url]) => {
      if (typeof url === 'string' && url.endsWith('.png')) {
        this.load.image(key, url);
      }
    });
    Object.entries(ui).forEach(([key, url]) => {
      if (typeof url === 'string' && url.endsWith('.png')) {
        this.load.image(key, url);
      }
    });
  }

  create() {
    // --- reset runtime state (important for replays) ---
    this.candy = null;
    this.monster = null;
    this.anchors = [];
    this.stars = null;
    this.spikes = null;

    this.ropes = []; // { beads:[], links:[], gfx:Graphics }
    this.swipe = { path: [], max: 24, isDown: false };
    this.ui = { starsText: null };

    this.state = {
      starsCollected: 0,
      starsRequired: 3,
      won: false,
      lost: false,
      eating: false
    };

    this._emitters = { starBurst: null, cutBurst: null };
    this._bottomLoseY = null;
    this._floorSensor = null;
    this._monsterCaptureRadius = 94; // baseline; dynamic calc uses max() with this

    if (!this.matter || !this.matter.world) {
      this.add.text(40, 40, 'Enable Matter physics in config', { fontSize: '28px', color: '#fff' });
      return;
    }

    const cfg = this.registry.get('cfg') || {};
    const W = (this.sys.config && this.sys.config.width)  || this.scale.width;
    const H = (this.sys.config && this.sys.config.height) || this.scale.height;

    // ---- Global tunables (baseline used by BOTH levels) ----
    const gravityY       = (cfg.gameplay && typeof cfg.gameplay.gravityY === 'number') ? cfg.gameplay.gravityY : 1.05;
    this._ropeSlack      = (cfg.gameplay && typeof cfg.gameplay.ropeSlack === 'number') ? cfg.gameplay.ropeSlack : 1.12;
    this._beadFricAir    = (cfg.gameplay && typeof cfg.gameplay.beadFrictionAir === 'number') ? cfg.gameplay.beadFrictionAir : 0.028;
    this._beadFriction   = (cfg.gameplay && typeof cfg.gameplay.beadFriction === 'number') ? cfg.gameplay.beadFriction : 0.02;
    this._consDamp       = 0.42;
    this._consStiff      = 0.95;

    // Physics
    this.matter.world.setBounds(0, 0, W, H, 32, true, true, true, true);
    this.matter.world.engine.positionIterations   = 7;
    this.matter.world.engine.constraintIterations = 7;
    this.matter.world.setGravity(0, gravityY);

    // Background
    if (cfg.images2?.background && this.textures.exists('background')) {
      const bg = this.add.image(W/2, H/2, 'background').setDisplaySize(W, H).setDepth(-10);
      this.enhanceSpawn(bg, { duration: 300, from: 0.95, ease: 'Quad.easeOut' });
    }

    // Level data
    const levels = cfg.levels || [];
    const level  = levels[this._levelIndex] || levels[0] || {};
    this.state.starsRequired = (typeof level.starsRequired === 'number') ? level.starsRequired : (cfg.starsRequired ?? 3);

    // Monster (target)
    const mX = level.monster?.x ?? W*0.5;
    const mY = level.monster?.y ?? H*0.82;
    this.monster = this.add.image(mX, mY, 'player').setDisplaySize(120, 120).setDepth(6);
    this.enhanceSpawn(this.monster, { duration: 260, from: 0.6 });

    // Slightly larger sensor than before to be more forgiving while moving
    const monsterBody = this.matter.add.circle(mX, mY, 96, { isStatic: true, isSensor: true });
    this.monster.setData('body', monsterBody);

    // Only Level 2: gentle horizontal patrol; sensor stays synced
    if (level.monsterPatrol) {
      const { fromX, toX, duration } = level.monsterPatrol;
      this._trackTween(this.tweens.add({
        targets: this.monster,
        x: { from: fromX, to: toX },
        ease: 'Sine.easeInOut',
        duration: duration ?? 5600,
        yoyo: true,
        repeat: -1,
        onUpdate: () => {
          const mb = this.monster.getData('body');
          if (mb) this.matter.body.setPosition(mb, this.monster.x, this.monster.y);
        }
      }));
    }

    // Candy
    const candySize = 64;
    const cX = level.candy?.x ?? W*0.5;
    const cY = level.candy?.y ?? H*0.22;
    this.candy = this.add.image(cX, cY, 'collectible').setDisplaySize(candySize, candySize).setDepth(5);
    this.enhanceSpawn(this.candy, { duration: 220, from: 0.7 });

    const candyBody = this.matter.add.circle(cX, cY, candySize*0.38, {
      restitution: 0,
      friction: 0.02,
      frictionAir: 0.02, // consistent
      inertia: Infinity
    });
    this.candy.setData('body', candyBody);

    // Sync sprite with body
    this.events.on('update', () => {
      const b = this.candy.getData('body');
      if (b) {
        this.candy.x = b.position.x;
        this.candy.y = b.position.y;
        this.candy.rotation = b.angle;
      }
    });

    // Anchors
    this.anchors = (level.anchors || []).map(a => {
      const img = this.add.image(a.x, a.y, 'platform').setDisplaySize(36, 36).setDepth(6);
      this.enhanceSpawn(img, { duration: 200, from: 0.6 });
      const body = this.matter.add.circle(a.x, a.y, 18, { isStatic: true });
      img.setData('body', body);
      return img;
    });

    // Stars
    this.stars = this.add.group();
    (level.stars || []).forEach(s => {
      const star = this.add.image(s.x, s.y, 'star').setDisplaySize(48, 48).setDepth(5);
      this.enhanceSpawn(star, { duration: 260, from: 0.4 });
      const body = this.matter.add.circle(s.x, s.y, 24, { isStatic: true, isSensor: true });
      star.setData('body', body);
      this.stars.add(star);
      this._trackTween(this.tweens.add({ targets: star, alpha: { from: 0.6, to: 1 }, duration: 900, yoyo: true, repeat: -1 }));
      this._trackTween(this.tweens.add({ targets: star, angle: { from: -8, to: 8 }, duration: 1800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }));
    });

    // Spikes
    this.spikes = this.add.group();
    (level.spikes || []).forEach(s => {
      const sp = this.add.image(s.x, s.y, 'spike').setDisplaySize(64, 64).setDepth(5);
      this.enhanceSpawn(sp, { duration: 240, from: 0.6 });
      const body = this.matter.add.rectangle(s.x, s.y, 60, 60, { isStatic: true, isSensor: true });
      sp.setData('body', body);
      this.spikes.add(sp);
    });

    // Ropes (identical behavior both levels)
    (level.ropes || []).forEach(r => this._buildRope(r));

    // FLOOR SENSOR — lose on ground touch (unless inside mouth capture)
    const floorY = (cfg.gameplay && cfg.gameplay.bottomLoseY) ? cfg.gameplay.bottomLoseY : (H - 24);
    this._bottomLoseY = floorY;
    this._floorSensor = this.matter.add.rectangle(W/2, floorY, W, 8, { isStatic: true, isSensor: true });

    // Collisions (start + active)
    this._collStart = (evt) => {
      if (this.state.won || this.state.lost || this.state.eating) return;
      evt.pairs.forEach(({ bodyA, bodyB }) => {
        this._checkCandyMonster(bodyA, bodyB);
        this._checkCandySpike(bodyA, bodyB);
        this._checkCandyFloor(bodyA, bodyB);
      });
    };
    this._collActive = (evt) => {
      if (this.state.won || this.state.lost || this.state.eating) return;
      evt.pairs.forEach(({ bodyA, bodyB }) => {
        this._checkCandyMonster(bodyA, bodyB);
        this._checkCandyFloor(bodyA, bodyB);
      });
    };
    this.matter.world.on('collisionstart', this._collStart);
    this.matter.world.on('collisionactive', this._collActive);

    // HUD
    this.ui.starsText = this.add.text(24, 24, `Stars: 0/${this.state.starsRequired}`, {
      fontFamily: (cfg.font && cfg.font.family) || 'Outfit, Arial',
      fontSize: '40px',
      color: '#fff',
      stroke: '#000',
      strokeThickness: 4
    }).setScrollFactor(0).setDepth(20);

    // Audio
    this._sfx = {
      bgm:    this.sound.add('bgm',        { loop: true, volume: 0.35 }),
      cut:    this.sound.add('attack',     { volume: 0.8 }),
      collect:this.sound.add('collect',    { volume: 0.8 }),
      win:    this.sound.add('level_done', { volume: 0.9 }),
      lose:   this.sound.add('game_over',  { volume: 0.9 }),
      hit:    this.sound.add('hit',        { volume: 0.8 })
    };
    if (!this.sound.locked && cfg.audio?.bgm) this._sfx.bgm.play();

    // Particles + cut ring (cross-version safe)
    this._emitters.starBurst = this._makeParticleManager('star', {
      lifespan: 500, speed: { min: 80, max: 220 }, angle: { min: 0, max: 360 },
      scale: { start: 0.5, end: 0 }, quantity: 12, emitting: false
    });
    this._emitters.cutBurst = this._ensureCutBurst();

    // Swipe input
    this.input.on('pointerdown', p => {
      this.swipe.isDown = true; this.swipe.path = [{ x: p.x, y: p.y }];
      this.createTouchRipple(p.x, p.y);
    });
    this.input.on('pointermove', p => {
      if (!this.swipe.isDown) return;
      this.swipe.path.push({ x: p.x, y: p.y });
      if (this.swipe.path.length > this.swipe.max) this.swipe.path.shift();
      const cutPoint = this._tryCutAlongSwipe();
      if (cutPoint) {
        this.addScreenShake(0.002, 80);
        this._spawnCutPop(cutPoint.x, cutPoint.y);
      }
    });
    this.input.on('pointerup', () => { this.swipe.isDown = false; this.swipe.path.length = 0; });

    // OOB fallback lose
    this.time.addEvent({
      delay: 200,
      loop: true,
      callback: () => {
        const b = this.candy.getData('body');
        if (!b || this.state.won || this.state.lost || this.state.eating) return;
        if (b.position.y > H + 120 || b.position.x < -120 || b.position.x > W + 120) this._lose();
      }
    });

    // Optional: enhance existing mobile buttons if present (no-ops if not found)
    ['leftButton','rightButton','actionButton','jumpButton'].forEach(key => {
      const btn = this[key];
      if (btn) { this.preserveOriginalState(btn); this.enhanceButtonPress(btn); }
    });

    // Cleanup guards
    const onShutdown = () => {
      const world = (this.matter && this.matter.world) ? this.matter.world : null;
      if (world && typeof world.off === 'function') {
        if (this._collStart)  world.off('collisionstart', this._collStart);
        if (this._collActive) world.off('collisionactive', this._collActive);
      }
      this._collStart = null;
      this._collActive = null;
      this._stopBgm();
      this.input.removeAllListeners();

      // Ensure ropes gfx are cleared
      (this.ropes || []).forEach(r => { try { r.gfx?.destroy(); } catch {} });

      // Enhancement cleanup
      this.cleanupAllEnhancements();
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, onShutdown);
    this.events.once(Phaser.Scenes.Events.DESTROY,  onShutdown);
  }

  _ensureCutBurst() {
    if (!this.textures.exists('cutDot')) {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      g.fillStyle(0xffffff, 1); g.fillCircle(8, 8, 8);
      g.generateTexture('cutDot', 16, 16); g.destroy();
    }
    return this._makeParticleManager('cutDot', {
      lifespan: 300, speed: { min: 120, max: 260 }, angle: { min: 0, max: 360 },
      scale: { start: 0.8, end: 0 }, quantity: 16, emitting: false
    });
  }

  _makeParticleManager(key, config) {
    try {
      const pm = this.add.particles(0, 0, key, config).setDepth(15);
      return this._trackParticles(pm);
    } catch (e1) {
      try {
        const pm = this.add.particles(key, config).setDepth(15);
        return this._trackParticles(pm);
      } catch (e2) {
        console.warn('[GameScene] Particles disabled for', key, e2);
        return null;
      }
    }
  }

  // Rope builder — identical params for both levels
  _buildRope(r) {
    const getPoint = (tag) => {
      if (tag === 'candy') {
        const b = this.candy.getData('body');
        return { x: b.position.x, y: b.position.y, body: b };
      } else {
        const idx = Number(tag);
        const aImg = this.anchors[idx];
        const b = aImg.getData('body');
        return { x: b.position.x, y: b.position.y, body: b };
      }
    };

    const A = getPoint(r.from);
    const B = getPoint(r.to);

    const segs = Math.max(3, Math.floor(r.segments || 8));
    const beads = [];
    const links = [];

    for (let i = 0; i < segs; i++) {
      const t = (i + 1) / (segs + 1);
      const x = Phaser.Math.Linear(A.x, B.x, t);
      const y = Phaser.Math.Linear(A.y, B.y, t);
      const bead = this.matter.add.circle(x, y, 6, {
        friction: this._beadFriction, frictionAir: this._beadFricAir, restitution: 0
      });
      beads.push(bead);
    }

    const makeLink = (body1, body2) => {
      const p1 = body1.position, p2 = body2.position;
      const baseLen = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
      const len = baseLen * this._ropeSlack; // same slack everywhere
      return this.matter.add.constraint(body1, body2, len, this._consStiff, { damping: this._consDamp });
    };

    links.push(makeLink(A.body, beads[0]));
    for (let i = 0; i < beads.length - 1; i++) links.push(makeLink(beads[i], beads[i + 1]));
    links.push(makeLink(beads[beads.length - 1], B.body));

    const gfx = this.add.graphics().setDepth(4);
    gfx.lineStyle(5, 0x2a2a2a, 1);

    this.ropes.push({ beads, links, gfx });
  }

  // Try to cut; return cut point for FX
  _tryCutAlongSwipe() {
    if (!this.swipe.isDown || this.swipe.path.length < 2) return null;

    const p1 = this.swipe.path[this.swipe.path.length - 2];
    const p2 = this.swipe.path[this.swipe.path.length - 1];

    for (const rope of this.ropes) {
      for (let i = rope.links.length - 1; i >= 0; i--) {
        const c = rope.links[i];
        const a = c.bodyA.position, b = c.bodyB.position;

        if (Phaser.Geom.Intersects.LineToLine(
          new Phaser.Geom.Line(p1.x, p1.y, p2.x, p2.y),
          new Phaser.Geom.Line(a.x, a.y, b.x, b.y)
        )) {
          this.matter.world.removeConstraint(c);
          rope.links.splice(i, 1);
          if (this._sfx?.cut) this._sfx.cut.play();
          
          // Add device vibration on rope cut
          this.vibrate(50); // Short 50ms vibration
          
          return { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
        }
      }
    }
    return null;
  }

  _spawnCutPop(x, y) {
    const mgr = this._emitters.cutBurst;
    if (mgr) {
      if (typeof mgr.emitParticleAt === 'function') mgr.emitParticleAt(x, y, 16);
      else if (typeof mgr.explode === 'function')    mgr.explode(16, x, y);
    }
    const ring = this._trackEffect(this.add.graphics().setDepth(30));
    ring.lineStyle(2, 0xffffaa, 1);
    ring.strokeCircle(0, 0, 6);
    ring.x = x; ring.y = y; ring.alpha = 1; ring.scale = 1;
    this._trackTween(this.tweens.add({ targets: ring, scale: 2.2, alpha: 0, duration: 180, ease: 'Quad.easeOut', onComplete: () => ring.destroy() }));
  }

  // Continuous star pickup (adds pop + gentle text pulse)
  _scanStarOverlaps() {
    const cBody = this.candy.getData('body');
    if (!cBody) return;
    const cx = cBody.position.x, cy = cBody.position.y;
    this.stars.getChildren().slice().forEach(star => {
      const b = star.getData('body'); if (!b) return;
      const dx = b.position.x - cx, dy = b.position.y - cy;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist <= 48) {
        this.matter.world.remove(b); star.destroy();
        this.state.starsCollected++;
        this.createCollectionEffect(cx, cy);
        if (this._sfx?.collect) this._sfx.collect.play();
        this._refreshHUD();
      }
    });
  }

  // Helper: robust sprite-distance mouth capture (works even while patrol tweening)
  _spriteMouthCapture() {
    if (!this.monster || !this.candy) return false;
    const mx = this.monster.x, my = this.monster.y;
    const cx = this.candy.x,   cy = this.candy.y;
    const dist = Phaser.Math.Distance.Between(mx, my, cx, cy);

    // dynamic threshold based on sprite sizes, with a baseline floor
    const dynamicR = Math.max(
      this._monsterCaptureRadius,
      (this.monster.displayWidth + this.candy.displayWidth) * 0.38
    );
    return dist <= dynamicR;
  }

  _checkCandyMonster(a, b) {
    // Keep Matter sensor path (for L1), but also rely on sprite-distance check
    const cBody = this.candy.getData('body');
    const mBody = this.monster.getData('body');
    const touch = (a === cBody && b === mBody) || (b === cBody && a === mBody);
    if (touch || this._spriteMouthCapture()) this._eatCandy();
  }

  _checkCandyFloor(a, b) {
    const cBody = this.candy.getData('body');
    const fBody = this._floorSensor;
    const touch = (a === cBody && b === fBody) || (b === cBody && a === fBody);
    if (!touch) return;

    // If it's inside the mouth when touching floor, count as feed instead of lose
    if (this._spriteMouthCapture()) { this._eatCandy(); return; }
    this._lose();
  }

  _checkCandySpike(a, b) {
    const cBody = this.candy.getData('body');
    const spikeBodies = this.spikes.getChildren().map(s => s.getData('body'));
    if ((a === cBody && spikeBodies.includes(b)) || (b === cBody && spikeBodies.includes(a))) {
      if (this._sfx?.hit) this._sfx.hit.play();
      this.createHitEffect(this.candy.x, this.candy.y);
      
      // Add stronger vibration for spike hit
      this.vibrate(100); // Longer 100ms vibration for damage
      
      this._lose();
    }
  }

  _refreshHUD() {
    if (this.ui.starsText) {
      this.ui.starsText.setText(`Stars: ${this.state.starsCollected}/${this.state.starsRequired}`);
      this._trackTween(this.tweens.add({ targets: this.ui.starsText, scaleX: 1.08, scaleY: 1.08, duration: 100, yoyo: true, ease: 'Quad.easeOut' }));
    }
  }

  _eatCandy() {
    if (this.state.eating || this.state.won || this.state.lost) return;
    this.state.eating = true;
    const b = this.candy.getData('body'); if (b) this.matter.body.setStatic(b, true);

    // Gentle success vibration
    this.vibrate(30);

    this._trackTween(this.tweens.add({ targets: this.monster, scaleX: 1.12, scaleY: 0.92, duration: 120, yoyo: true, ease: 'Back.easeOut' }));
    this._trackTween(this.tweens.add({
      targets: this.candy,
      x: this.monster.x, y: this.monster.y,
      scaleX: 0.2, scaleY: 0.2, alpha: 0.0,
      duration: 300, ease: 'Quad.easeIn',
      onComplete: () => this._win()
    }));
  }

  _win() {
    if (this.state.won || this.state.lost) return;
    this.state.won = true;
    if (this._sfx?.win) this._sfx.win.play();
    this._stopBgm();

    // Victory vibration pattern - two quick pulses
    this.vibrate([80, 60, 80]);

    const cfg = this.registry.get('cfg') || {};
    const total = (cfg.levels || []).length;
    this.safeEnhance(() => {
      // subtle celebratory flash
      const flash = this._trackEffect(this.add.rectangle(this.cameras.main.centerX, this.cameras.main.centerY, this.scale.width, this.scale.height, 0x66ff88, 0.25).setDepth(100));
      this._trackTween(this.tweens.add({ targets: flash, alpha: 0, duration: 220, onComplete: () => flash.destroy() }));
      this.addScreenShake(0.004, 120);
    });

    if (this._levelIndex < total - 1) {
      this.cameras.main.fadeOut(220, 0, 0, 0, (_cam, prog) => {
        if (prog === 1) this.scene.start('GameScene', { levelIndex: this._levelIndex + 1 });
      });
    } else {
      this.scene.start('WinScene', { score: this.state.starsCollected });
    }
  }

  _lose() {
    if (this.state.won || this.state.lost || this.state.eating) return;
    this.state.lost = true;
    if (this._sfx?.lose) this._sfx.lose.play();
    this.cameras.main.flash(150, 255, 40, 40);
    this._stopBgm();
    
    // Game over vibration - longer, more intense
    this.vibrate([200, 100, 200]);
    
    this.scene.start('GameOverScene', { score: this.state.starsCollected });
  }

  _stopBgm() {
    if (this._sfx?.bgm && this._sfx.bgm.isPlaying) this._sfx.bgm.stop();
  }

  update() {
    if (this.state.won || this.state.lost) return;

    // Draw ropes
    for (const rope of this.ropes) {
      rope.gfx.clear();
      rope.gfx.lineStyle(5, 0x2a2a2a, 1);
      for (const c of rope.links) {
        const pA = c.bodyA.position, pB = c.bodyB.position;
        rope.gfx.beginPath(); rope.gfx.moveTo(pA.x, pA.y); rope.gfx.lineTo(pB.x, pB.y); rope.gfx.strokePath();
      }
    }

    // Reliable star pickup + light juice
    this._scanStarOverlaps();

    // Per-frame monster capture using sprite distance (robust with patrol)
    if (!this.state.eating && !this.state.won && !this.state.lost && this._spriteMouthCapture()) {
      this._eatCandy();
    }

    // Backup floor check by Y (kept)
    const cb = this.candy.getData('body');
    if (cb && !this.state.won && !this.state.eating && cb.position.y >= this._bottomLoseY) {
      this._checkCandyFloor(cb, this._floorSensor);
    }

    // Performance monitor
    this.monitorPerformance();
  }

  // ====== Scene lifecycle cleanup for replay ======
  shutdown() {
    // called by you if needed; guards also attached in create()
    this.cleanupAllEnhancements();
  }
}

// export default GameScene;