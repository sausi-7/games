// GameScene.js — Pure gameplay only (no menus/overlays/transitions)
// Uses cfg from this.registry.get('cfg')
// Portrait-first (1080x1920), keyboard + mobile buttons, asset fallbacks, scoring, timer, lives

class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameScene', physics: { arcade: { gravity: { y: 0 } } } });

    // Bind methods to ensure 'this' context in callbacks
    Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach(fn => {
      if (typeof this[fn] === 'function' && fn !== 'constructor') this[fn] = this[fn].bind(this);
    });
    // FX & helpers
    this.fx = null;               // generic particle manager
    this.fxSpark = null;          // a second particle manager for sparkles
    this._shieldSprite = null;
    this.sfx = { bgm: null, hit: null, collect: null, dash: null, swap: null };
    // visual aura when health is active


    // Core state
    this.cfg = null;
    this.W = 1080;
    this.H = 1920;
    this.centerX = 540;
    this.centerY = 960;

    // Player & lanes
    this.player = null;
    this.currentSide = 'left'; // 'left' | 'right'
    this.laneX = { left: 0, right: 0 };
    this.isDashing = false;
    this.dashUntil = 0;
    this.invulnUntil = 0; // generic (for dash)
    this.shieldUntil = 0; // health power-up window

    // Groups
    this.enemies = null;     // bombs + birds
    this.gems = null;
    this.shields = null;
    this.fuels = null;

    // Timers / events
    this.timers = {
      enemies: null,
      birds: null,
      gems: null,
      shields: null,
      fuels: null,
      ramp: null,
      secondTick: null
    };

    // UI
    this.ui = { scoreText: null, livesText: null, timerText: null };

    // Score/lives/timer
    this.score = 0;
    this.lives = 3;
    this.timeLeft = 0;
    this.fuel = 1.0; // Add fuel system

    // Input
    this.keys = null;
    this.mobile = { left: null, right: null, action: null };
    this.mobilePressed = { left: false, right: false, action: false };

    // Audio
    this.sfx = { bgm: null, hit: null, collect: null, dash: null, fuel: null };

    // Misc
    this.gameOver = false;
    this.gameWon = false;
    this.background = null;
  }

  // ---------- Utility: asset URL helper (no import.meta needed) ----------
  _assetUrl(rel) {
    // Allow absolute URLs or root/relative paths referenced from the HTML page.
    if (!rel || typeof rel !== 'string') return rel;
    if (/^https?:\/\//i.test(rel)) return rel;   // absolute URL
    return rel; // relative to hosting HTML
  }

  preload() {
    // Pull cfg early if Boot scene placed it
    const cfg = this.registry.get('cfg') || {};

    // Load IMAGES
    if (cfg.images1) {
      Object.entries(cfg.images1).forEach(([key, rel]) => {
        this.load.image(key, this._assetUrl(rel));
      });
    }

      if (cfg.images2) {
      Object.entries(cfg.images2).forEach(([key, rel]) => {
        this.load.image(key, this._assetUrl(rel));
      });
    }

    // Load SPRITESHEETS
    if (cfg.spritesheets) {
      Object.entries(cfg.spritesheets).forEach(([key, meta]) => {
        this.load.spritesheet(key, this._assetUrl(meta.url), {
          frameWidth: meta.frameWidth,
          frameHeight: meta.frameHeight,
          endFrame: meta.frames - 1
        });
      });
    }

    // Load AUDIO
    if (cfg.audio) {
      Object.entries(cfg.audio).forEach(([key, rel]) => {
        this.load.audio(key, this._assetUrl(rel));
      });
    }
  }

  create() {
    // Read config
    const cfg = this.registry.get('cfg') || {};
    this.cfg = cfg;
    this._resetState();  // <--- add this line

    const gameplay = cfg.gameplay || {};
    const layout = cfg.layout || {};
    const texts = cfg.texts || {};

    // Dimensions via user-preferred sys access, with safe fallbacks
    const sysCfg = this.sys.config || this.sys.game?.config || {};
    this.W = Number(sysCfg.width ?? 1080);
    this.H = Number(sysCfg.height ?? 1920);
    this.centerX = Math.floor(this.W * 0.5);
    this.centerY = Math.floor(this.H * 0.5);

    // Camera (use this.sys.cameras as preferred)
    const cam = this.sys.cameras?.main || this.cameras.main;
    cam.setBackgroundColor('#0b1020');

    // Background (tileSprite if texture exists)
    if (this.textures.exists('background')) {
      this.background = this.add.tileSprite(this.centerX, this.centerY, this.W, this.H, 'background').setDepth(-10);
    } else {
      // Fallback solid
      const g = this.add.graphics();
      g.fillStyle(0x0b1020, 1).fillRect(0, 0, this.W, this.H).setDepth(-10);
      this.background = { tilePositionY: 0, setTilePosition: () => { } };
    }

    // Parameters with defaults
    this.timeLeft = Phaser.Math.Clamp(Number(gameplay.timerSeconds ?? 90), 1, 3600);
    this.lives = Number(gameplay.lives ?? 3);

    this.enemySpawnRate = Number(gameplay.enemySpawnRateMs ?? 1100);
    this.minEnemySpawnRate = Number(gameplay.minEnemySpawnRateMs ?? 550);
    this.rampEverySec = Number(gameplay.rampEverySec ?? 15);
    this.rampFactor = Number(gameplay.rampFactor ?? 0.92);

    this.birdEveryMs = Number(gameplay.birdEveryMs ?? 2500);
    this.gemEveryMs = Number(gameplay.gemEveryMs ?? 1800);
    this.shieldEveryMs = Number(gameplay.shieldEveryMs ?? 12000);
    this.shieldDurationMs = Number(gameplay.shieldDurationMs ?? 4000);

    this.nearMissRadius = Number(gameplay.nearMissRadius ?? 32);

    this.laneOffsetX = Number(layout.laneOffsetX ?? 170);
    const ropeX = this.centerX;

    // Visual rope + lane markers using platform texture (fallback rectangles if missing)
    const laneHeight = this.H + 200;
    this._ensureTexture('platform', 129, 129, 0x37507b);
    const leftLane = this.add.sprite(ropeX - this.laneOffsetX, this.centerY, 'platform').setDepth(-2);
    leftLane.setDisplaySize(14, laneHeight);
    const rightLane = this.add.sprite(ropeX + this.laneOffsetX, this.centerY, 'platform').setDepth(-2);
    rightLane.setDisplaySize(14, laneHeight);

    // Lane x positions
    this.laneX.left = ropeX - this.laneOffsetX;
    this.laneX.right = ropeX + this.laneOffsetX;

    // Physics groups
    this.enemies = this.physics.add.group({ runChildUpdate: true });
    this.gems = this.physics.add.group({ runChildUpdate: true });
    this.shields = this.physics.add.group({ runChildUpdate: true });
    this.fuels = this.physics.add.group();

    // Player
    const playerKey = this._ensureTexture('player_vehicle_topView', 129, 129, 0x57ccff);
    this.player = this.physics.add.sprite(this.laneX.left, this.H - 320, playerKey).setDepth(5);
    this.player.setDisplaySize(60, 110);
    this._baseScaleX = this.player.scaleX;
    this._baseScaleY = this.player.scaleY;
    
    // Make collision area slightly larger and more forgiving
    this.player.body.setSize(70, 120, true); // width, height, center
    this.player.setCollideWorldBounds(true);
    this.player.setImmovable(false);
    this.player.body.allowGravity = false;

    // Input
    this._setupKeyboard();
    this._setupMobileButtons();

    // Overlaps
    this.physics.add.overlap(this.player, this.enemies, this._onHitEnemy);
    this.physics.add.overlap(this.player, this.gems, this._onCollectGem);
    this.physics.add.overlap(this.player, this.shields, this._onCollectShield);
    this.physics.add.overlap(this.player, this.fuels, this._collectFuel, null, this);
    
    // UI (gameplay-only)
    const fontFamily = (this.cfg.font && this.cfg.font.family) ? this.cfg.font.family : 'Outfit, system-ui, Arial';
    this.ui.scoreText = this.add.text(24, 24, `${texts.score_label || 'Score:'} 0`, {
      fontFamily, fontSize: '36px', color: '#d7ecff'
    }).setDepth(20).setScrollFactor(0);
    this.ui.livesText = this.add.text(24, 70, `Lives: ${this.lives}`, {
      fontFamily, fontSize: '32px', color: '#ffd3a6'
    }).setDepth(20).setScrollFactor(0);
    this.ui.timerText = this.add.text(this.W - 24, 24, `Time: ${this.timeLeft}`, {
      fontFamily, fontSize: '36px', color: '#b2f5ea'
    }).setOrigin(1, 0).setDepth(20).setScrollFactor(0);

    // Audio
    if (this.sound) {
      if (this.sound.locked) this.sound.unlock(); // mobile safety
      if (this.cache.audio.has('bgm')) {
        this.sfx.bgm = this.sound.add('bgm', { loop: true, volume: 0.4 });
        this.sfx.bgm.play();
      }
      if (this.cache.audio.has('hit')) this.sfx.hit = this.sound.add('hit', { volume: 0.9 });
      if (this.cache.audio.has('collect')) this.sfx.collect = this.sound.add('collect', { volume: 0.9 });
      if (this.cache.audio.has('attack')) this.sfx.dash = this.sound.add('attack', { volume: 0.9 });
      if (this.cache.audio.has('fuel')) this.sfx.fuel = this.sound.add('fuel', { volume: 0.8 });
      if (this.cache.audio.has('swap')) {
        this.sfx.swap = this.sound.add('swap', { loop: false, volume: 0.8 });
      }
    }

    // Start systems
    this._startTimers();

    // Initial snap
    this._snapTo('left', 0);
  }

  // ---------- Setup Inputs ----------
  _setupKeyboard() {
    this.keys = this.input.keyboard.addKeys({
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
      cursLeft: Phaser.Input.Keyboard.KeyCodes.LEFT,
      cursRight: Phaser.Input.Keyboard.KeyCodes.RIGHT,
      dash1: Phaser.Input.Keyboard.KeyCodes.SPACE,
      dash2: Phaser.Input.Keyboard.KeyCodes.K,
      instantLeft: Phaser.Input.Keyboard.KeyCodes.Q,  // Q for instant left
      instantRight: Phaser.Input.Keyboard.KeyCodes.E  // E for instant right
    });
  }

  _pulsePlayer(mult = 1.06, dur = 120) {
    if (!this.player) return;
    const sx = this._baseScaleX ?? this.player.scaleX;
    const sy = this._baseScaleY ?? this.player.scaleY;

    // prevent stacking
    this.tweens.killTweensOf(this.player);

    // start from base scale every time
    this.player.setScale(sx, sy);

    this.tweens.add({
      targets: this.player,
      scaleX: sx * mult,
      scaleY: sy * mult,
      yoyo: true,
      duration: dur,               // 100–150 ms as requested
      ease: 'Sine.easeInOut',
      onComplete: () => this.player.setScale(sx, sy) // hard reset just in case
    });
  }

  _setupMobileButtons() {
    const y = this.H - 100;

    const makeBtn = (key, x, onDown, onUp) => {
      const tex = this._ensureTexture(key, 96, 96, 0x2f3d5c);
      const img = this.add.image(x, y, tex).setInteractive({ useHandCursor: true }).setDepth(30);
      img.setDisplaySize(96, 96);
      img.on('pointerdown', () => { img.setScale(0.92).setAlpha(0.85); onDown && onDown(); });
      img.on('pointerup', () => { img.setScale(0.5).setAlpha(0.5); onUp && onUp(); });
      img.on('pointerout', () => { img.setScale(0.5).setAlpha(0.5); onUp && onUp(); });
      return img;
    };

    const leftX = 160;
    const rightX = 490;
    const actionX = this.W - 160;

    this.mobile.left = makeBtn('left', leftX,
      () => { this.mobilePressed.left = true; this._snapTo('left'); },
      () => { this.mobilePressed.left = false; }
    );

    this.mobile.right = makeBtn('right', rightX,
      () => { this.mobilePressed.right = true; this._snapTo('right'); },
      () => { this.mobilePressed.right = false; }
    );

    this.mobile.action = makeBtn('action', actionX,
      () => { this.mobilePressed.action = true; this._tryDash(); },
      () => { this.mobilePressed.action = false; }
    );
  }

  // ---------- Timers / Spawning / Ramp ----------
  _startTimers() {
    const t = this.time;

    // Enemy (bombs)
    this._restartEnemyTimer(this.enemySpawnRate);

    // Birds
    if (this.birdEveryMs > 0) {
      this.timers.birds = t.addEvent({ delay: this.birdEveryMs, loop: true, callback: this._spawnBird });
    }

 

    // Shields
    if (this.shieldEveryMs > 0) {
      this.timers.shields = t.addEvent({ delay: this.shieldEveryMs, loop: true, callback: this._spawnShield });
    }

    // Fuel spawning timer
    const fuelEveryMs = Number(this.cfg?.gameplay?.fuelEveryMs ?? 3000); // Every 3 seconds by default
    if (fuelEveryMs > 0) {
      this.timers.fuels = t.addEvent({ delay: fuelEveryMs, loop: true, callback: this._spawnFuel });
    }

    // Difficulty ramp every X seconds
    if (this.rampEverySec > 0 && this.rampFactor > 0 && this.rampFactor < 1) {
      this.timers.ramp = t.addEvent({ delay: this.rampEverySec * 1000, loop: true, callback: this._rampDifficulty });
    }

    // Per-second score + timer countdown
    this.timers.secondTick = t.addEvent({ delay: 1000, loop: true, callback: this._onSecondTick });
  }

  _restartEnemyTimer(delayMs) {
    if (this.timers.enemies) this.timers.enemies.remove(false);
    this.timers.enemies = this.time.addEvent({ delay: delayMs, loop: true, callback: this._spawnBomb });
  }

  _rampDifficulty() {
    const next = Math.max(this.minEnemySpawnRate, Math.floor(this.enemySpawnRate * this.rampFactor));
    if (next !== this.enemySpawnRate) {
      this.enemySpawnRate = next;
      this._restartEnemyTimer(this.enemySpawnRate);
    }
  }

  _onSecondTick() {
    if (this.gameOver || this.gameWon) return;

    this.timeLeft = Math.max(0, this.timeLeft - 1);
    this.score += 1; // survival score
    this._refreshUI();

    if (this.timeLeft <= 0) {
      if (this.lives > 0) this._win();
      else this._lose();
    }
  }

  // ---------- Spawners ----------
  _spawnBomb() {
    if (this.gameOver || this.gameWon) return;

    const side = Math.random() < 0.5 ? 'left' : 'right';
    const x = this.laneX[side];
    const y = -90;

    const key = this._ensureTexture('enemy_vehicle_topView', 129, 129, 0xff5b5b);
    const bomb = this.enemies.create(x, y, key);
    bomb.setDisplaySize(60, 110);
    bomb.body.setVelocity(0, 220 + Phaser.Math.Between(0, 50)); // fall speed
    bomb.body.allowGravity = false;
    bomb.setData('type', 'bomb');
    bomb.setData('nearMissAwarded', false);

    // Slight lane wobble
    bomb.setData('wobbleAmp', Phaser.Math.Between(0, 1) ? 8 : 0);
    bomb.setData('wobblePhase', Math.random() * Math.PI * 2);
    bomb.setDepth(2);
  }

  _spawnBird() {
    if (this.gameOver || this.gameWon) return;

    const fromLeft = Math.random() < 0.5;
    const y = Phaser.Math.Between(80, 360);
    const x = fromLeft ? -60 : this.W + 60;

    const key = this._ensureTexture('obstacle', 129, 129, 0xffe07a);
    const obstacle = this.enemies.create(x, y, key);
    obstacle.setDisplaySize(96, 72);
    obstacle.body.allowGravity = false;
    obstacle.setData('type', 'obstacle');
    obstacle.setData('nearMissAwarded', false);

    const vx = fromLeft ? Phaser.Math.Between(140, 220) : Phaser.Math.Between(-220, -140);
    const vy = Phaser.Math.Between(70, 140);
    obstacle.body.setVelocity(vx, vy);
    obstacle.setDepth(2);
  }


  _spawnShield() {
    if (this.gameOver || this.gameWon) return;

    const side = Math.random() < 0.5 ? 'left' : 'right';
    const x = this.laneX[side];
    const y = -60;

    const key = this._ensureTexture('health', 129, 129, 0x8ecbff);
    const s = this.shields.create(x, y, key);
    s.setDisplaySize(72, 72);
    s.body.setVelocity(0, 180);
    s.body.allowGravity = false;
    s.setDepth(1);
  }

  _spawnFuel() {
    if (this.gameOver || this.gameWon) return;

    const side = Math.random() < 0.5 ? 'left' : 'right';
    const x = this.laneX[side];
    const y = -60;

    const key = this._ensureTexture('fuel_vehicle', 129, 129, 0x6ef7a6);
    const fuel = this.fuels.create(x, y, key);
    fuel.setDisplaySize(90, 90);
    
    // Make fuel collision area slightly larger for easier pickup
    fuel.body.setSize(100, 100, true); // width, height, center
    fuel.body.setVelocity(0, 190);
    fuel.body.allowGravity = false;
    fuel.setDepth(1);
  }

  // ---------- Update ----------
  update(time, delta) {
    if (this.gameOver || this.gameWon) return;

    // Background upward drift
    if (this.background?.tilePositionY !== undefined) {
      const scrollSpeed = Number(this.cfg?.gameplay?.scrollSpeed ?? 60);
      this.background.tilePositionY -= (scrollSpeed * delta) / 1000;
    }

    // Keyboard snap
    if (Phaser.Input.Keyboard.JustDown(this.keys.left) || Phaser.Input.Keyboard.JustDown(this.keys.cursLeft)) {
      this._snapTo('left');
    } else if (Phaser.Input.Keyboard.JustDown(this.keys.right) || Phaser.Input.Keyboard.JustDown(this.keys.cursRight)) {
      this._snapTo('right');
    }
    
    // Instant snap (no animation) for precise fuel collection
    if (Phaser.Input.Keyboard.JustDown(this.keys.instantLeft)) {
      this._snapTo('left', 1); // 1ms = almost instant
    } else if (Phaser.Input.Keyboard.JustDown(this.keys.instantRight)) {
      this._snapTo('right', 1); // 1ms = almost instant
    }
    
    if (Phaser.Input.Keyboard.JustDown(this.keys.dash1) || Phaser.Input.Keyboard.JustDown(this.keys.dash2)) {
      this._tryDash();
    }

    // Dash / invulnerability windows expire
    if (this.isDashing && time >= this.dashUntil) {
      this.isDashing = false;
    }
    if (time >= this.invulnUntil) {
      this.invulnUntil = 0;
    }

    // Enemy wobble + cleanup & near-miss
    const nearR2 = this.nearMissRadius * this.nearMissRadius;
    const px = this.player.x, py = this.player.y;
    this.enemies.children.iterate(e => {
      if (!e) return;
      if (e.getData('type') === 'bomb') {
        const amp = e.getData('wobbleAmp') || 0;
        if (amp > 0) {
          const phase = (e.getData('wobblePhase') || 0) + 0.07;
          e.setData('wobblePhase', phase);
          const baseX = e.body.velocity.x === 0 ? (Math.abs(e.x - this.laneX.left) < Math.abs(e.x - this.laneX.right) ? this.laneX.left : this.laneX.right) : e.x;
          e.x = baseX + Math.sin(phase) * amp;
        }
      }

      // near-miss
      if (!e.getData('nearMissAwarded')) {
        const dx = e.x - px, dy = e.y - py;
        if (dx * dx + dy * dy < nearR2) {
          this.score += 2;
          e.setData('nearMissAwarded', true);
          this._emitSpark(e.x, e.y, 0xffffff);
          this._refreshUI();
        }
      }
      // cleanup
      if (e.y > this.H + 120 || e.x < -140 || e.x > this.W + 140) e.destroy();
    });

    this.gems.children.iterate(o => { if (o && o.y > this.H + 120) o.destroy(); });
    this.shields.children.iterate(o => { if (o && o.y > this.H + 120) o.destroy(); });
    
    // Clean up fuel cars that go off screen
    this.fuels.children.iterate(o => { if (o && o.y > this.H + 120) o.destroy(); });
    
    this._updateShieldAura();
  }

  _snapTo(side, durationMs) {
    if (this.gameOver || this.gameWon) return;
    const sideKey = side === 'right' ? 'right' : 'left';
    if (this.currentSide === sideKey && !durationMs) return;

    const speed = Number(this.cfg?.gameplay?.playerSpeed ?? 520);
    const duration = durationMs ?? Math.max(60, Math.min(260, Math.floor(1000 * (this.laneOffsetX / speed))));

    this.currentSide = sideKey;
    const targetX = this.laneX[sideKey];

    if (this.sfx?.swap) {
      this.sfx.swap.stop();
      this.sfx.swap.play();
    }

    // 🔑 Prevent half-movement bugs
    this.tweens.killTweensOf(this.player);

    this.sys.tweens.add({
      targets: this.player,
      x: targetX,
      duration,
      ease: 'Sine.easeOut',
      onUpdate: () => {
        // Continuously update physics body during movement
        if (this.player.body) {
          this.player.body.updateFromGameObject();
        }
      },
      onComplete: () => { 
        this.player.x = targetX; // snap hard at end
        // Final physics body update
        if (this.player.body) {
          this.player.body.updateFromGameObject();
        }
      }
    });
  }

  _collectFuel(player, fuelCar) {
    if (!fuelCar || this.gameOver || this.gameWon) return;
    
    const fx = fuelCar.x, fy = fuelCar.y;
    fuelCar.destroy(); // remove fuel from game

    // Play fuel pickup sound if available
    if (this.sfx?.fuel) {
      this.sfx.fuel.play();
    } else if (this.sfx?.collect) {
      this.sfx.collect.play(); // fallback to collect sound
    }

    // Add score for fuel collection
    this.score += 3;
    
    // Visual effects
    this._emitBurst(fx, fy, { color: 0x6ef7a6, count: 12, speed: { min: 100, max: 220 } });
    this._floatingText('+3 FUEL', fx, fy - 10, '#6ef7a6');
    this._pulsePlayer(1.05, 100);

    // If you have a fuel system, increase fuel here
    if (this.fuel !== undefined) {
      this.fuel = Math.min(1, this.fuel + 0.25); // 25% refill, max 100%
    }

    this._refreshUI();
  }

  _tryDash() {
    if (this.gameOver || this.gameWon) return;
    const now = this.time.now;
    const cooldown = Number(this.cfg?.gameplay?.dashCooldownMs ?? 1200);
    const dur = Number(this.cfg?.gameplay?.dashDurationMs ?? 180);
    const boost = Number(this.cfg?.gameplay?.dashBoost ?? 220);

    if (this.isDashing || (this._lastDashAt && now - this._lastDashAt < cooldown)) return;

    this.isDashing = true;
    this.dashUntil = now + dur;
    this.invulnUntil = Math.max(this.invulnUntil, now + dur);
    this._lastDashAt = now;

    const sign = this.currentSide === 'left' ? -1 : 1;

    // 🔑 Kill tweens so dash always overrides
    this.tweens.killTweensOf(this.player);

    this.sys.tweens.add({
      targets: this.player,
      x: this.player.x + sign * boost,   // bigger swing than 0.35
      yoyo: true,
      duration: Math.max(120, dur),      // a bit longer for effect
      ease: 'Sine.easeInOut'
    });

    if (this.sfx.dash) this.sfx.dash.play();
  }

  // ---------- Collisions ----------
  _onHitEnemy(player, enemy) {
    if (!enemy || !player || this.gameOver || this.gameWon) return;

    const now = this.time.now;
    const hasShield = now < this.shieldUntil;
    const isInvuln = now < this.invulnUntil;

    if (hasShield) {
      // consume health, destroy enemy
      this.shieldUntil = 0;
      this._emitBurst(enemy.x, enemy.y, { color: 0x8ecbff, count: 18, speed: { min: 120, max: 300 } });
      enemy.destroy();
      if (this.sfx.hit) this.sfx.hit.play();
      return;
    }
    if (isInvuln) {
      // dash through
      this._emitBurst(enemy.x, enemy.y, { color: 0xffffff, count: 12, speed: { min: 140, max: 320 } });
      enemy.destroy();
      return;
    }

    // take damage
    this.lives = Math.max(0, this.lives - 1);
    if (this.sfx.hit) this.sfx.hit.play();

    // FX: camera punch, debris, flash, hit-stop
    this._cameraPunch(0.012, 160);
    this._emitBurst(enemy.x, enemy.y, { color: 0xff5b5b, count: 20, speed: { min: 160, max: 340 } });
    this._flashSprite(this.player, 0xff2222, 100);
    this._hitStop(120, 0.2);

    // brief invulnerability + flash tween already present
    this.invulnUntil = now + 500;
    this.sys.tweens.add({ targets: this.player, alpha: 0.3, yoyo: true, repeat: 3, duration: 80 });

    enemy.destroy();

    this._refreshUI();
    if (this.lives <= 0) {
      this._lose();
    }
  }

  _onCollectGem(player, gem) {
    if (!gem || this.gameOver || this.gameWon) return;
    const gx = gem.x, gy = gem.y;
    gem.destroy();

    this.score += 5;
    if (this.sfx.collect) this.sfx.collect.play();

    this._emitBurst(gx, gy, { color: 0x6ef7a6, count: 16, speed: { min: 120, max: 260 } });
    this._floatingText('+5', gx, gy - 10, '#6ef7a6');
    this._pulsePlayer(1.06, 120);   // small, fast pulse

    this._refreshUI();
  }

  _onCollectShield(player, s) {
    if (!s || this.gameOver || this.gameWon) return;
    const sx = s.x, sy = s.y;
    s.destroy();

    this.shieldUntil = this.time.now + this.shieldDurationMs;

    // FX: blue burst + quick ring pop
    this._emitBurst(sx, sy, { color: 0x5ec8ff, count: 16, speed: { min: 100, max: 240 } });
    const ringKey = this._ensureCircleTex('fxShieldRingPop', 56, 0x9ed7ff);
    const ring = this.add.image(this.player.x, this.player.y, ringKey).setDepth(6).setBlendMode('ADD').setAlpha(0.8).setScale(0.6);
    this.tweens.add({
      targets: ring,
      alpha: 0,
      scale: 1.6,
      duration: 300,
      ease: 'Sine.easeOut',
      onComplete: () => ring.destroy()
    });
    this._pulsePlayer(1.08, 120);
    this._refreshUI();
  }

  // ---------- Win/Lose ----------
  _win() {
    if (this.gameOver || this.gameWon) return;
    this.gameWon = true;

    const payload = this._payload();
    this.events.emit('GAME_WON', payload);

    const meta = this.cfg?.meta || {};
    const key = meta.winKey || 'WinScene';

    if (meta.autoSceneChange && this._hasScene(key)) {
      this._stopTimersOnly();
      this.scene.start(key, payload);
      this.scene.stop('GameScene');
    } else {
      console.warn(`[GameScene] WinScene '${key}' not found or autoSceneChange=false. Add it to game config or set correct key in cfg.meta.winKey.`);
      this._stopTimersOnly();
    }
  }

  _lose() {
    if (this.gameOver || this.gameWon) return;
    this.gameOver = true;

    const payload = this._payload();
    this.events.emit('GAME_OVER', payload);

    const meta = this.cfg?.meta || {};
    const key = meta.gameOverKey || 'GameOverScene';

    if (meta.autoSceneChange && this._hasScene(key)) {
      // Clean timers/SFX but DON'T freeze physics before switching
      this._stopTimersOnly();
      this.scene.start(key, payload);
      this.scene.stop('GameScene'); // fully hand off
    } else {
      // Scene not found or auto disabled — don't freeze; keep game responsive
      console.warn(`[GameScene] GameOverScene '${key}' not found or autoSceneChange=false. Add it to game config or set correct key in cfg.meta.gameOverKey.`);
      // Minimal feedback: stop spawns/music but leave physics running
      this._stopTimersOnly();
      // Optionally: set a flag; your manager can listen to GAME_OVER and transition.
    }
  }

  // ---------- Helper Methods ----------
  _ensureCircleTex(key, radius = 8, color = 0xffffff) {
    if (this.textures.exists(key)) return key;
    const g = this.add.graphics();
    g.fillStyle(color, 1);
    g.fillCircle(radius, radius, radius);
    g.generateTexture(key, radius * 2, radius * 2);
    g.destroy();
    return key;
  }

  // Replace your _emitBurst with this tween-based version (no emitters)
  _emitBurst(x, y, opts = {}) {
    const {
      color = 0xffffff,
      count = 14,
      speed = { min: 100, max: 280 },
      lifespan = { min: 250, max: 600 },
      scale = { start: 0.9, end: 0 },
      gravityY = 0 // ignored in tween version
    } = opts;

    const dotKey = this._ensureCircleTex('fxDot_' + color.toString(16), 6, color);

    for (let i = 0; i < count; i++) {
      const life = Phaser.Math.Between(lifespan.min || 250, lifespan.max || 600);
      const spd = Phaser.Math.Between(speed.min || 100, speed.max || 280);
      const ang = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const dx = Math.cos(ang) * spd * (life / 1000);
      const dy = Math.sin(ang) * spd * (life / 1000);

      const p = this.add.image(x, y, dotKey)
        .setDepth(60)
        .setScale(scale.start ?? 0.9)
        .setAlpha(1)
        .setBlendMode('ADD');

      this.tweens.add({
        targets: p,
        x: x + dx,
        y: y + dy,
        alpha: 0,
        scale: scale.end ?? 0,
        duration: life,
        ease: 'Sine.easeOut',
        onComplete: () => p.destroy()
      });
    }
  }

  // Replace your _emitSpark with this (lightweight sparkles)
  _emitSpark(x, y, color = 0xffffff) {
    const sparkKey = this._ensureCircleTex('fxSpark_' + color.toString(16), 3, color);
    const qty = 8;

    for (let i = 0; i < qty; i++) {
      const life = Phaser.Math.Between(180, 360);
      const spd = Phaser.Math.Between(60, 140);
      const ang = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const dx = Math.cos(ang) * spd * (life / 1000);
      const dy = Math.sin(ang) * spd * (life / 1000);

      const p = this.add.image(x, y, sparkKey)
        .setDepth(60)
        .setScale(0.7)
        .setAlpha(1)
        .setBlendMode('ADD');

      this.tweens.add({
        targets: p,
        x: x + dx,
        y: y + dy,
        alpha: 0,
        scale: 0,
        duration: life,
        ease: 'Sine.easeOut',
        onComplete: () => p.destroy()
      });
    }
  }

  _floatingText(text, x, y, color = '#ffffff') {
    const t = this.add.text(x, y, text, {
      fontFamily: (this.cfg.font?.family) || 'Outfit, system-ui, Arial',
      fontSize: '36px',
      color,
      stroke: '#000000',
      strokeThickness: 4
    }).setOrigin(0.5).setDepth(50);

    this.tweens.add({
      targets: t,
      y: y - 60,
      alpha: 0,
      duration: 600,
      ease: 'Sine.easeOut',
      onComplete: () => t.destroy()
    });
  }

  _cameraPunch(intensity = 0.01, duration = 150) {
    const cam = this.cameras.main;
    cam.shake(duration, intensity);
  }

  _flashSprite(target, tint = 0xff4444, dur = 90) {
    if (!target) return;
    target.setTintFill(tint);
    this.time.delayedCall(dur, () => target.clearTint());
  }

  _hitStop(ms = 120, scale = 0.15) {
    // brief slowdown for dramatic impact (doesn't fully freeze input/UI)
    const phys = this.physics.world;
    const time = this.time;
    const prevPhys = phys.timeScale;
    const prevTime = this.game.loop.timeScale ?? 1;

    phys.timeScale = scale;
    this.game.loop.timeScale = scale;

    time.delayedCall(ms, () => {
      phys.timeScale = prevPhys;
      this.game.loop.timeScale = prevTime;
    });
  }

  _updateShieldAura() {
    const now = this.time.now;
    const active = now < this.shieldUntil;

    if (active) {
      if (!this._shieldSprite) {
        const ringKey = this._ensureCircleTex('fxShieldRing', 48, 0x5ec8ff);
        this._shieldSprite = this.add.image(this.player.x, this.player.y, ringKey)
          .setDepth(4)
          .setAlpha(0.55)
          .setScale(1.2)
          .setBlendMode('ADD');
        this.tweens.add({
          targets: this._shieldSprite,
          scale: 1.35,
          alpha: 0.35,
          yoyo: true,
          repeat: -1,
          duration: 450,
          ease: 'Sine.easeInOut'
        });
      }
      // follow player
      this._shieldSprite.setPosition(this.player.x, this.player.y);
      this._shieldSprite.setVisible(true);
    } else if (this._shieldSprite) {
      this._shieldSprite.destroy();
      this._shieldSprite = null;
    }
  }

  _hasScene(key) {
    // Works on Phaser 3.x
    const m = this.scene && this.scene.manager;
    return !!(m && m.keys && m.keys[key]);
  }

  _stopTimersOnly() {
    if (this._shieldSprite) { this._shieldSprite.destroy(); this._shieldSprite = null; }

    Object.values(this.timers).forEach(t => t && t.remove(false));
    if (this.sfx.bgm) this.sfx.bgm.stop();
  }

  _payload() {
    return { score: this.score, timeLeft: this.timeLeft, lives: this.lives, fuel: this.fuel };
  }

  _resetState() {
    // flags
    this.gameOver = false;
    this.gameWon = false;
    this.isDashing = false;
    this.dashUntil = 0;
    this.invulnUntil = 0;
    this.shieldUntil = 0;
    this._lastDashAt = 0;

    // core values from cfg
    const gp = this.cfg?.gameplay || {};
    this.timeLeft = Phaser.Math.Clamp(Number(gp.timerSeconds ?? 90), 1, 3600);
    this.lives = Number(gp.lives ?? 3);
    this.score = 0;
    this.fuel = 1.0; // Reset fuel to full

    // make sure physics resumes if it was paused earlier
    if (this.physics && this.physics.world) {
      this.physics.world.timeScale = 1;
    }

    // clear any dangling timers from a previous run
    Object.keys(this.timers).forEach(k => {
      if (this.timers[k]) { this.timers[k].remove(false); this.timers[k] = null; }
    });
  }

  _stopAll() {
    Object.values(this.timers).forEach(t => t && t.remove(false));
    this.physics.world.timeScale = 0; // pause physics without scenes
    if (this.sfx.bgm) this.sfx.bgm.stop();
  }

  // ---------- UI ----------
  _refreshUI() {
    const label = (this.cfg.texts && this.cfg.texts.score_label) ? this.cfg.texts.score_label : 'Score:';
    if (this.ui.scoreText) this.ui.scoreText.setText(`${label} ${this.score}`);
    if (this.ui.livesText) this.ui.livesText.setText(`Lives: ${this.lives}${(this.time.now < this.shieldUntil) ? ' (Shield)' : ''}`);
    if (this.ui.timerText) this.ui.timerText.setText(`Time: ${this.timeLeft}`);
  }

  // ---------- Texture Fallback ----------
  _ensureTexture(key, w = 64, h = 64, color = 0x888888) {
    if (this.textures.exists(key)) return key;
    // If key not loaded, create a basic rectangle texture on the fly
    const gfx = this.add.graphics();
    gfx.fillStyle(color, 1).fillRoundedRect(0, 0, w, h, 12);
    const genKey = `${key}_fallback`;
    gfx.generateTexture(genKey, w, h);
    gfx.destroy();
    return genKey;
  }
}