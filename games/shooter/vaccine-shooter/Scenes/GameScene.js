// GameScene.js — Virus Blaster (pure gameplay only)
// Orientation: 1920x1080 (responsive); Arcade Physics
// Reads config via this.registry.get('cfg')
// Calls WinScene / GameOverScene without rendering overlays

class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameScene', physics: { arcade: { gravity: { y: 0 }, debug: false } } });

    // Handles initialized once; values will be reset in create()
    this.cfg = null;
    this.W = 1920; this.H = 1080;

    // Entities & Groups
    this.player = null;
    this.enemies = null;     // viruses
    this.spits = null;       // enemy projectiles
    this.bullets = null;     // player projectiles
    this.pickups = null;     // vaccine/shield/rapid

    // UI
    this.ui = { score: null, timer: null, health: null, charges: null };

    // Input & Mobile
    this.keys = {};
    this.mobile = { left: null, right: null, action: null, state: { left: false, right: false, action: false }, lastActionTapAt: 0 };

    // State (will be reinitialized in _resetState)
    this.state = {
      timeLeft: 60, score: 0, hp: 3, vaccineCharges: 0,
      alive: true, finished: false, invulnUntil: 0, rapidUntil: 0, shieldUntil: 0,
      lastShotAt: 0, fireRateMs: 180, lastSpawnAt: 0, spawnEveryMs: 1400, maxEnemies: 6,
      lastDifficultyStepAt: 0, nearestEnemy: null,
    };

    // Keep refs to timers/tweens we create so we can clean them on shutdown
    this._timers = [];
    this._tweens = [];
  }

  init(data) {
    // Allow passing cfg at scene start, but also keep registry fallback
    if (data && data.cfg) {
      this.cfg = data.cfg;
      this.registry.set('cfg', data.cfg);
    } else {
      this.cfg = this.registry.get('cfg') || this.cfg || {};
    }
  }


  preload() {
    const cfg = this.registry.get('cfg') || {};
    this.cfg = cfg;

    const images = (cfg.images || {});
    const audio = (cfg.audio || {});

    // Images (only those used in gameplay)
    this._safeLoadImage('background', images.background);
    this._safeLoadImage('player', images.player);
    this._safeLoadImage('enemy_basic', images.enemy_basic);
    this._safeLoadImage('enemy_spitter', images.enemy_spitter);
    this._safeLoadImage('enemy_mutant', images.enemy_mutant);
    this._safeLoadImage('projectile', images.projectile);
    this._safeLoadImage('vaccine', images.vaccine);
    this._safeLoadImage('shield', images.shield);
    this._safeLoadImage('rapid', images.rapid);
    this._safeLoadImage('platform', images.platform);

    // Mobile buttons
    this._safeLoadImage('btn_left', images.left);
    this._safeLoadImage('btn_right', images.right);
    this._safeLoadImage('btn_action', images.action);

    // Audio
    this._safeLoadAudio('bgm', audio.bgm);
    this._safeLoadAudio('attack', audio.attack);
    this._safeLoadAudio('hit', audio.hit);
    this._safeLoadAudio('collect', audio.collect);
    this._safeLoadAudio('destroy', audio.destroy);
    this._safeLoadAudio('win', audio.win);
    this._safeLoadAudio('gameover', audio.gameover);
  }

  create() {
    // Ensure everything is resumed for fresh runs/replays
    this.physics.world.resume();
    this.time.timeScale = 1;

    // Clean arrays (in case of replay) & re-bind cleanup hooks
    this._timers = [];
    this._tweens = [];

    this.events.once('shutdown', this._cleanup, this);

    // Use config
    const g = (this.cfg.gameplay || {});
    const T = (this.cfg.texts || {});

    // Dimensions
    const cam = this.cameras.main;
    this.W = cam.width;
    this.H = cam.height;

    // Background (fallback if missing)
    if (this.textures.exists('background')) {
      const bg = this.add.image(this.W / 2, this.H / 2, 'background');
      bg.setDisplaySize(this.W, this.H).setScrollFactor(0);
    } else {
      this.cameras.main.setBackgroundColor('#0b0f16');
    }

    // World bounds
    this.physics.world.setBounds(0, 0, this.W, this.H);

    // Reset state for a clean replay
    this._resetState();

    // Make sure we can run after a prior teardown
    this._tearingDown = false;


    // Groups
    this.enemies = this.physics.add.group();
    this.spits = this.physics.add.group({
      classType: Phaser.Physics.Arcade.Image,
      maxSize: (this.cfg.gameplay?.maxSpits || 30),
      runChildUpdate: false
    });
    // replace your bullets group line in create()
    // Safer pooled bullets
    this.bullets = this.physics.add.group({
      classType: Phaser.Physics.Arcade.Image,
      maxSize: (this.cfg.gameplay?.maxBullets || 30),
      runChildUpdate: false
    });


    this.pickups = this.physics.add.group();

    // Player
    this.player = this.physics.add.sprite(this.W * 0.5, this.H * 0.55, this.textures.exists('player') ? 'player' : this._rectTex(56, 56, 0x54d7ff));
    this.player.setCollideWorldBounds(true);
    this._sizeSprite(this.player, g.playerSize || 64, g.playerSize || 64);
    this.player.setDrag(g.playerDrag ?? 800, g.playerDrag ?? 800);
    this.player.setMaxVelocity(g.playerSpeed || 320, g.playerSpeed || 320);

    // Arena soft walls (optional visual/platform)
    if (this.textures.exists('platform')) {
      const t = 24;
      const top = this.add.image(this.W / 2, t / 2, 'platform').setOrigin(0.5, 0.5);
      top.setDisplaySize(this.W, t);
      const bot = this.add.image(this.W / 2, this.H - t / 2, 'platform').setOrigin(0.5, 0.5);
      bot.setDisplaySize(this.W, t);
      const left = this.add.image(t / 2, this.H / 2, 'platform').setOrigin(0.5, 0.5).setAngle(90);
      left.setDisplaySize(this.H, t);
      const right = this.add.image(this.W - t / 2, this.H / 2, 'platform').setOrigin(0.5, 0.5).setAngle(90);
      right.setDisplaySize(this.H, t);
    }

    // UI (gameplay-only HUD)
    const fontFamily = (this.cfg.font && this.cfg.font.family) || 'Outfit';
    this.ui.score = this.add.text(24, 20, `${T.score_label || 'Score: '}0`, { fontFamily, fontSize: 28, color: '#ffffff' }).setScrollFactor(0);
    this.ui.timer = this.add.text(this.W / 2, 20, `${g.timerSeconds || 60}`, { fontFamily, fontSize: 28, color: '#ffffff' }).setOrigin(0.5, 0).setScrollFactor(0);
    this.ui.health = this.add.text(this.W - 24, 20, `HP: 3`, { fontFamily, fontSize: 28, color: '#ffffff' }).setOrigin(1, 0).setScrollFactor(0);
    this.ui.charges = this.add.text(this.W - 24, 54, `Vacc: 0`, { fontFamily, fontSize: 24, color: '#9cf7ff' }).setOrigin(1, 0).setScrollFactor(0);

    // Controls
    this.keys = this.input.keyboard.addKeys({
      up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT',
      W: 'W', A: 'A', S: 'S', D: 'D',
      shoot: 'SPACE', burst: 'E'
    });

    // Mobile buttons (alpha feedback only; no scale growth)
    this._createMobileButtons();

    // Timers / State init (again here to be explicit)
    this.state.timeLeft = g.timerSeconds || 60;
    this.state.fireRateMs = g.fireRateMs || 160;
    this.state.lastShotAt = 0;
    this.state.spawnEveryMs = g.spawnStartMs || 1400;
    this.state.maxEnemies = g.maxEnemiesStart || 6;

    // Physics Collisions
    // Physics Collisions (SAVE HANDLES!)
    this._ovlBulletsEnemies = this.physics.add.overlap(
      this.bullets, this.enemies, (b, e) => this._onBulletHitsEnemy(b, e)
    );
    this._ovlPlayerEnemies = this.physics.add.overlap(
      this.player, this.enemies, (p, e) => this._onPlayerHitsEnemy(p, e)
    );
    this._ovlPlayerSpits = this.physics.add.overlap(
      this.player, this.spits, (p, s) => this._onSpitHitsPlayer(p, s)
    );
    this._ovlPlayerPickups = this.physics.add.overlap(
      this.player, this.pickups, (p, c) => this._onPickup(p, c)
    );


    // Music — use cache check (not instance check)
    if (this.cache.audio.has('bgm')) {
      this.sound.stopAll();
      const m = this.sound.add('bgm', { loop: true, volume: 0.35 });
      m.play();
    }

    // Game timer (1 Hz)
    // this._timers.push(// Game timer (1 Hz)
    // Game timer (1 Hz) — TRACK IT so we can kill on finish/shutdown
    this._timers.push(this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        // If scene not active or already finished, do nothing
        if (!this.scene.isActive('GameScene') || !this.state.alive || this.state.finished) return;

        this.state.timeLeft--;
        // Guard UI text existence before touching it
        if (this.ui?.timer?.setText) this.ui.timer.setText(`${this.state.timeLeft}`);

        if (this.state.timeLeft <= 0) {
          this._finish('win'); // -> WinScene
        }
      }
    }));



    // Enemy spawn loop + difficulty ramp
    // Enemy spawn loop + difficulty ramp
    this._timers.push(this.time.addEvent({
      delay: 100,
      loop: true,
      callback: () => {
        if (!this.state.alive || this.state.finished) return;
        const now = this.time.now;

        if (
          now - this.state.lastSpawnAt >= this.state.spawnEveryMs &&
          (this.enemies?.countActive?.(true) ?? 0) < this.state.maxEnemies
        ) {
          this._spawnEnemy();
          this.state.lastSpawnAt = now;
        }

        // Difficulty ramp every ~7s
        if (now - this.state.lastDifficultyStepAt >= 7000) {
          this.state.lastDifficultyStepAt = now;
          this.state.spawnEveryMs = Math.max(700, this.state.spawnEveryMs - 80);
          this.state.maxEnemies = Math.min(16, this.state.maxEnemies + 1);
          if (Phaser.Math.Between(0, 100) < 20) this._spawnPickup();
        }
      }
    }));

  }

  update(time, delta) {
    if (this._tearingDown) return;
    if (this.physics?.world?.isPaused) return;

    // if (!this.scene.isActive('GameScene') || !this.state.alive || this.state.finished) return;
    // if (!this.state.alive || this.state.finished) return;
    if (!this.scene.isActive('GameScene') || !this.state.alive || this.state.finished) return;

    const g = (this.cfg.gameplay || {});
    const maxV = g.playerSpeed || 320;
    const accel = g.playerAccel ?? 1400;

    // Movement: keyboard (WASD/Arrows)
    let vx = 0, vy = 0;

    const left = (this.keys.left?.isDown) || (this.keys.A?.isDown) || this.mobile.state.left;
    const right = (this.keys.right?.isDown) || (this.keys.D?.isDown) || this.mobile.state.right;
    const up = (this.keys.up?.isDown) || (this.keys.W?.isDown);
    const down = (this.keys.down?.isDown) || (this.keys.S?.isDown);

    if (left) vx -= accel;
    if (right) vx += accel;
    if (up) vy -= accel;
    if (down) vy += accel;

    this.player.setAcceleration(vx, vy);
    this.player.setMaxVelocity(maxV, maxV);

    // Effects windows
    const now = this.time.now;
    const rapidActive = (now < this.state.rapidUntil);
    const fireRate = rapidActive ? Math.max(70, (this.state.fireRateMs * 0.55)) : this.state.fireRateMs;

    // Auto-aim target selection
    this.state.nearestEnemy = this._nearestEnemyTo(this.player.x, this.player.y);

    // Shooting (keyboard or mobile action hold)
    const shooting = (this.keys.shoot?.isDown) || this.mobile.state.action || this.input.activePointer.isDown;
    if (shooting && (now - this.state.lastShotAt >= fireRate)) {
      this._fire();
      this.state.lastShotAt = now;
    }

    // Burst with E (keyboard)
    if (Phaser.Input.Keyboard.JustDown(this.keys.burst)) {
      this._tryBurst();
    }

    // Mobile double-tap detection
    if (this.mobile.justTappedAction) {
      const dtapWindow = 250; // ms
      if (now - this.mobile.lastActionTapAt <= dtapWindow) {
        this._tryBurst();
        this.mobile.lastActionTapAt = 0; // reset
      } else {
        this.mobile.lastActionTapAt = now;
      }
      this.mobile.justTappedAction = false;
    }

    // Update enemy steering
    const enemiesArr = this.enemies?.getChildren?.() || [];
    for (let i = 0; i < enemiesArr.length; i++) {
      const e = enemiesArr[i];
      if (!e || !e.active || !this.player) continue;

      const speed = e.getData('speed') || 120;
      const steer = new Phaser.Math.Vector2(this.player.x - e.x, this.player.y - e.y);
      steer.normalize().scale(speed);
      e.setVelocity(steer.x, steer.y);

      const now2 = this.time.now;
      if (e.getData('type') === 'spitter') {
        const last = e.getData('lastSpitAt') || 0;
        if (now2 - last > 1600 && Phaser.Math.Distance.Between(e.x, e.y, this.player.x, this.player.y) < 680) {
          this._enemySpit(e);
          e.setData('lastSpitAt', now2);
        }
      }
    }


    // Shield visual (tiny tint pulse)
    if (now < this.state.shieldUntil) {
      const t = (Math.sin(now * 0.02) * 0.2 + 0.8);
      this.player.setTintFill(Phaser.Display.Color.GetColor(180, 255, 255));
      this.player.setAlpha(t);
    } else {
      this.player.clearTint();
      this.player.setAlpha(1);
    }

    // Cleanup bullets/spits off-screen
    this._cullOffscreen(this.bullets);
    this._cullOffscreen(this.spits);

    // HUD
    this.ui.score.setText(`${(this.cfg.texts?.score_label) || 'Score: '} ${this.state.score}`);
    this.ui.health.setText(`HP: ${this.state.hp}`);
    this.ui.charges.setText(`Vacc: ${this.state.vaccineCharges}`);
  }

  _destroyColliders() {
    this._ovlBulletsEnemies?.destroy?.(); this._ovlBulletsEnemies = null;
    this._ovlPlayerEnemies?.destroy?.(); this._ovlPlayerEnemies = null;
    this._ovlPlayerSpits?.destroy?.(); this._ovlPlayerSpits = null;
    this._ovlPlayerPickups?.destroy?.(); this._ovlPlayerPickups = null;
  }

  _killTimersAndTweens() {
    // Stop only the timers we created (safe even if called from a timer callback)
    for (let i = 0; i < this._timers.length; i++) {
      const t = this._timers[i];
      try { t?.remove?.(); } catch (_) { }
    }
    this._timers = [];

    // Stop tweens we created
    for (let i = 0; i < this._tweens.length; i++) {
      const tw = this._tweens[i];
      try { tw?.stop?.(); } catch (_) { }
    }
    this._tweens = [];
  }




  // --------------------------
  // Spawning & Pickups
  // --------------------------
  _spawnEnemy() {
    if (this._tearingDown) return null;
    const typeRoll = Phaser.Math.Between(0, 100);
    let key = 'enemy_basic', speed = 140, hp = 1, type = 'basic';
    if (typeRoll > 80) { key = 'enemy_spitter'; speed = 120; hp = 1; type = 'spitter'; }
    if (typeRoll > 92) { key = 'enemy_mutant'; speed = 160; hp = 1; type = 'mutant'; }

    const edge = Phaser.Math.Between(0, 3);
    let x = 0, y = 0;
    if (edge === 0) { x = 0; y = Phaser.Math.Between(0, this.H); }
    if (edge === 1) { x = this.W; y = Phaser.Math.Between(0, this.H); }
    if (edge === 2) { x = Phaser.Math.Between(0, this.W); y = 0; }
    if (edge === 3) { x = Phaser.Math.Between(0, this.W); y = this.H; }

    const tex = this.textures.exists(key) ? key : this._rectTex(56, 56, 0xff4d6d);
    const e = this.enemies.create(x, y, tex);
    this._sizeSprite(e, 54, 54);
    e.setCollideWorldBounds(true);
    e.setImmovable(false);
    e.setDataEnabled();
    e.setData('hp', hp);
    e.setData('type', type);
    e.setData('speed', speed);
    e.setBounce(0.8);

    return e;
  }

  _spawnPickup() {
    if (this._tearingDown) return null;
    const roll = Phaser.Math.Between(0, 100);
    let key = 'vaccine', tag = 'vaccine';
    if (roll > 66) { key = 'shield'; tag = 'shield'; }
    if (roll > 88) { key = 'rapid'; tag = 'rapid'; }
    const tex = this.textures.exists(key) ? key : this._rectTex(36, 36, 0xffff66);
    const x = Phaser.Math.Between(60, this.W - 60);
    const y = Phaser.Math.Between(60, this.H - 60);
    const p = this.pickups.create(x, y, tex);
    this._sizeSprite(p, 44, 44);
    p.setDataEnabled();
    p.setData('tag', tag);
    p.setDepth(1);
    this._tweens.push(this.tweens.add({ targets: p, y: y - 6, duration: 700, yoyo: true, repeat: -1, ease: 'sine.inout' }));
  }

  // --------------------------
  // Combat
  // --------------------------
  // replace your entire _fire() with this version
  _fire() {
    if (!this.player || !this.player.active) return;

    let dir = new Phaser.Math.Vector2(1, 0);
    const pointer = this.input.activePointer;
    if (pointer && pointer.isDown && pointer.worldX != null) {
      dir.set(pointer.worldX - this.player.x, pointer.worldY - this.player.y);
    } else if (this.state.nearestEnemy) {
      dir.set(this.state.nearestEnemy.x - this.player.x, this.state.nearestEnemy.y - this.player.y);
    }
    if (dir.lengthSq() === 0) dir.set(1, 0);
    dir.normalize();

    const speed = (this.cfg.gameplay?.bulletSpeed) || 700;
    const bKey = this.textures.exists('projectile') ? 'projectile' : this._rectTex(16, 6, 0x9cffc7);

    let b = this.bullets.get(this.player.x + dir.x * 24, this.player.y + dir.y * 24);
    if (!b) {
      console.warn('Bullet pool exhausted');
      return;
    }
    if (!b.setDisplaySize) console.error('Bullet missing setDisplaySize:', b);

    // Reset critical properties
    b.setActive(true).setVisible(true);
    b.setTexture(bKey);
    b.clearTint();
    b.setAlpha(1);
    b.setDataEnabled();
    b.setData('dmg', 1);

    this._sizeSprite(b, 22, 8);
    b.body.setAllowGravity(false);
    b.setVelocity(dir.x * speed, dir.y * speed);
    b.setAngle(Phaser.Math.RadToDeg(Math.atan2(dir.y, dir.x)));

    this._play('attack', { volume: 0.45 });
  }

  _enemySpit(enemy) {
    const dir = new Phaser.Math.Vector2(this.player.x - enemy.x, this.player.y - enemy.y).normalize();

    let s = this.spits.get(enemy.x + dir.x * 22, enemy.y + dir.y * 22);
    if (!s) {
      console.warn('Spit pool exhausted');
      return;
    }
    if (!s.setDisplaySize) console.error('Spit missing setDisplaySize:', s);

    const sKey = this.textures.exists('projectile') ? 'projectile' : this._rectTex(12, 12, 0xc38bff);

    // Reset critical properties
    s.setActive(true).setVisible(true);
    s.setTexture(sKey);
    s.clearTint();
    s.setAlpha(1);
    s.setDataEnabled();
    s.setData('dmg', 1);

    this._sizeSprite(s, 16, 16);
    s.body.setAllowGravity(false);
    s.setVelocity(dir.x * 260, dir.y * 260);
  }


  _tryBurst() {
    if (this.state.vaccineCharges <= 0) return;
    this.state.vaccineCharges--;
    this._burstVisualAndDamage();
    this._play('attack', { volume: 0.55 }); // whoosh
  }

  _burstVisualAndDamage() {
    const g = (this.cfg.gameplay || {});
    const R = g.vaccineBurstRadius || 220;
    const cx = this.player?.x ?? 0, cy = this.player?.y ?? 0;

    // Visual ring
    const gfx = this.add.graphics().setDepth(2);
    gfx.lineStyle(6, 0x9cf7ff, 0.9);
    gfx.strokeCircle(cx, cy, 2);
    this._tweens.push(this.tweens.add({
      targets: gfx,
      duration: 300,
      onUpdate: (tw, t) => {
        const r = Phaser.Math.Interpolation.Linear([2, R], t);
        gfx.clear();
        gfx.lineStyle(6, 0x9cf7ff, Phaser.Math.Linear(0.9, 0.0, t));
        gfx.strokeCircle(cx, cy, r);
      },
      onComplete: () => gfx.destroy()
    }));

    // Damage + clear spits (NULL-SAFE!)
    const enemyArr = this.enemies?.getChildren?.() || [];
    for (let i = 0; i < enemyArr.length; i++) {
      const e = enemyArr[i];
      if (!e || !e.active) continue;
      if (Phaser.Math.Distance.Between(cx, cy, e.x, e.y) <= R) {
        this._killEnemy(e, true);
      }
    }
    const spitArr = this.spits?.getChildren?.() || [];
    for (let i = 0; i < spitArr.length; i++) {
      const s = spitArr[i];
      if (!s || !s.active) continue;
      if (Phaser.Math.Distance.Between(cx, cy, s.x, s.y) <= R) {
        s.destroy();
      }
    }

  }


  // --------------------------
  // Collisions
  // --------------------------
  _onBulletHitsEnemy(b, e) {
    if (this._tearingDown || this.state.finished) return;
    b.destroy();
    this._damageEnemy(e, 1);
  }


  _onPlayerHitsEnemy(p, e) {
    if (this._tearingDown || this.state.finished) return;
    const now = this.time.now;
    if (now < this.state.invulnUntil) return;
    if (now < this.state.shieldUntil) return;
    this._play('hit', { volume: 0.55 });
    this._hurtPlayer(1);
    const v = new Phaser.Math.Vector2(p.x - e.x, p.y - e.y).normalize().scale(240);
    p.setVelocity(v.x, v.y);
  }

  _onSpitHitsPlayer(p, s) {
    if (this._tearingDown || this.state.finished) return;
    s.destroy();
    const now = this.time.now;
    if (now < this.state.invulnUntil) return;
    if (now < this.state.shieldUntil) return;
    this._play('hit', { volume: 0.55 });
    this._hurtPlayer(1);
  }

  _onPickup(p, c) {
    if (this._tearingDown || this.state.finished) return;
    const tag = c.getData('tag');
    c.destroy();
    this._play('collect', { volume: 0.6 });

    const now = this.time.now;
    if (tag === 'vaccine') {
      this.state.vaccineCharges++;
    } else if (tag === 'shield') {
      const dur = (this.cfg.gameplay?.shieldMs) || 2500;
      this.state.shieldUntil = Math.max(this.state.shieldUntil, now + dur);
    } else if (tag === 'rapid') {
      const dur = (this.cfg.gameplay?.rapidMs) || 3000;
      this.state.rapidUntil = Math.max(this.state.rapidUntil, now + dur);
    }
  }

  // --------------------------
  // Enemy Damage / Death
  // --------------------------
  _damageEnemy(e, dmg) {
    const hp = (e.getData('hp') || 1) - dmg;
    if (hp <= 0) {
      this._killEnemy(e, false);
    } else {
      e.setData('hp', hp);
    }
  }

  _killEnemy(e, fromBurst) {
    if (!e.active) return;
    const type = e.getData('type') || 'basic';
    if (type === 'basic') this.state.score += 10;
    if (type === 'spitter') this.state.score += 15;
    if (type === 'mutant') this.state.score += 20;

    // Mutant split
    if (type === 'mutant' && !fromBurst) {
      for (let i = 0; i < 2; i++) {
        const b = this.enemies.create(e.x + Phaser.Math.Between(-16, 16), e.y + Phaser.Math.Between(-16, 16), this.textures.exists('enemy_basic') ? 'enemy_basic' : this._rectTex(56, 56, 0x5eff5e));
        this._sizeSprite(b, 46, 46);
        b.setCollideWorldBounds(true).setBounce(0.9);
        b.setDataEnabled();
        b.setData('hp', 1);
        b.setData('type', 'basic');
        b.setData('speed', 150);
      }
    }

    e.destroy();
    this._play('destroy', { volume: 0.55 });
  }

  // --------------------------
  // Player Health / Finish
  // --------------------------
  _hurtPlayer(dmg) {
    this.state.hp -= dmg;
    this.state.invulnUntil = this.time.now + 800;
    if (this.state.hp <= 0 && !this.state.finished) {
      this.time.delayedCall(0, () => { if (!this.state.finished) this._finish('lose'); });
    }
  }




  _finish(outcome) {
    if (this._finishing) return;
    this._finishing = true;

    if (this.state.finished) return;
    this.state.finished = true;
    this.state.alive = false;
    this._tearingDown = true;             // guard for callbacks

    // Pause physics & input immediately to stop the step loop
    if (this.physics?.world && !this.physics.world.isPaused) {
      this.physics.world.pause();
    }
    this.input.enabled = false;

    // Stop timers/tweens so nothing else schedules work
    this._killTimersAndTweens();

    // Only destroy YOUR overlap handles (safe)
    this._destroyColliders();
    // ❌ do NOT call this.physics.world.colliders.destroy()

    // Stop sounds
    this.sound.stopAll();

    // *** Clear groups SAFELY: iterate children instead of clear(true,true)
    const safeWipe = (grp) => {
      if (!grp?.getChildren) return;
      const kids = grp.getChildren().slice(); // copy to avoid mutation during iteration
      for (const k of kids) { try { k.destroy(); } catch (_) { } }
      try { grp.runChildUpdate = false; } catch (_) { }
    };
    safeWipe(this.enemies);
    safeWipe(this.spits);
    safeWipe(this.bullets);
    safeWipe(this.pickups);

    // (optional) keep references; not strictly required
    // this.enemies = this.spits = this.bullets = this.pickups = null;

    const goWin = () => {
      if (this.scene.get('WinScene')) {
        this.scene.stop('GameScene');
        this.scene.start('WinScene', { score: this.state.score || 0 });
      } else {
        this.scene.restart();
      }
    };

    const goLose = () => {
      if (this.scene.get('GameOverScene')) {
        this.scene.stop('GameScene');
        this.scene.start('GameOverScene', { score: this.state.score || 0 });
      } else {
        this.scene.restart();
      }
    };


    // Tiny defer lets Phaser finish any remaining frame bookkeeping
    this.time.delayedCall(0, () => {
      if (outcome === 'win') {
        this._play('win', { volume: 0.7 });
        goWin();
      } else {
        this._play('gameover', { volume: 0.7 });
        goLose();
      }
    });
  }

  _nearestEnemyTo(x, y) {
    let best = null, bestD = Number.MAX_VALUE;
    const arr = this.enemies?.getChildren?.() || [];
    for (let i = 0; i < arr.length; i++) {
      const e = arr[i];
      if (!e || !e.active) continue;
      const d = Phaser.Math.Distance.Between(x, y, e.x, e.y);
      if (d < bestD) { best = e; bestD = d; }
    }
    return best;

  }


  _cullOffscreen(group) {
    if (!group?.getChildren) return;
    const pad = 40;
    const arr = group.getChildren();
    for (let i = 0; i < arr.length; i++) {
      const s = arr[i];
      if (!s || !s.active) continue;
      if (s.x < -pad || s.x > this.W + pad || s.y < -pad || s.y > this.H + pad) {
        s.destroy();
      }
    }

  }

  _sizeSprite(obj, w, h) {
    if (!obj || !obj.setTexture || !obj.setDisplaySize) {
      console.warn('Invalid sprite object in _sizeSprite:', obj);
      return; // Skip sizing if object is invalid
    }
    if (!obj.texture || !obj.texture.key || !obj.frame) {
      const fallbackKey = this._rectTex(Math.max(1, Math.floor(w)), Math.max(1, Math.floor(h)), 0xffffff);
      obj.setTexture(fallbackKey);
    }
    obj.setDisplaySize(w, h);
    if (obj.body) obj.body.setAllowGravity(false);
  }





  _rectTex(w, h, color = 0xffffff) {
    const key = `rect_${w}x${h}_${color}`;
    if (this.textures.exists(key)) return key;
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(color, 1);
    g.fillRect(0, 0, w, h);
    g.generateTexture(key, w, h);
    g.destroy();
    return key;
  }

  _safeLoadImage(key, url) {
    if (!url) return;
    this.load.image(key, url);
  }

  _safeLoadAudio(key, url) {
    if (!url) return;
    this.load.audio(key, url);
  }

  _play(key, cfg = {}) {
    if (!this.sound || !this.cache.audio.has(key)) return;
    this.sound.play(key, cfg);
  }

  _createMobileButtons() {
    const leftX = 160, rightX = 490, bottomY = this.H - 100, actionX = this.W - 160;

    // Left
    this.mobile.left = this.add.image(leftX, bottomY, this.textures.exists('btn_left') ? 'btn_left' : this._rectTex(96, 96, 0x334455))
      .setInteractive({ useHandCursor: true }).setScrollFactor(0).setDepth(10).setAlpha(0.8);
    this.mobile.left.setDisplaySize(112, 112);
    this.mobile.left.on('pointerdown', () => { this.mobile.state.left = true; this.mobile.left.setAlpha(0.6); });
    this.mobile.left.on('pointerup', () => { this.mobile.state.left = false; this.mobile.left.setAlpha(0.8); });
    this.mobile.left.on('pointerout', () => { this.mobile.state.left = false; this.mobile.left.setAlpha(0.8); });

    // Right
    this.mobile.right = this.add.image(rightX, bottomY, this.textures.exists('btn_right') ? 'btn_right' : this._rectTex(96, 96, 0x334455))
      .setInteractive({ useHandCursor: true }).setScrollFactor(0).setDepth(10).setAlpha(0.8);
    this.mobile.right.setDisplaySize(112, 112);
    this.mobile.right.on('pointerdown', () => { this.mobile.state.right = true; this.mobile.right.setAlpha(0.6); });
    this.mobile.right.on('pointerup', () => { this.mobile.state.right = false; this.mobile.right.setAlpha(0.8); });
    this.mobile.right.on('pointerout', () => { this.mobile.state.right = false; this.mobile.right.setAlpha(0.8); });

    // Action (hold to shoot, double-tap burst)
    this.mobile.action = this.add.image(actionX, bottomY, this.textures.exists('btn_action') ? 'btn_action' : this._rectTex(110, 110, 0x445566))
      .setInteractive({ useHandCursor: true }).setScrollFactor(0).setDepth(10).setAlpha(0.85);
    this.mobile.action.setDisplaySize(120, 120);

    this.mobile.action.on('pointerdown', () => {
      this.mobile.state.action = true;
      this.mobile.action.setAlpha(0.65);
      // tap detection for double-tap
      this.mobile.justTappedAction = true;
    });
    this.mobile.action.on('pointerup', () => {
      this.mobile.state.action = false;
      this.mobile.action.setAlpha(0.85);
    });
    this.mobile.action.on('pointerout', () => {
      this.mobile.state.action = false;
      this.mobile.action.setAlpha(0.85);
    });
  }

  _resetState() {
    const g = (this.cfg.gameplay || {});
    this.state = {
      timeLeft: g.timerSeconds ?? 60,
      score: 0,
      hp: 3,
      vaccineCharges: 0,
      alive: true,
      finished: false,
      invulnUntil: 0,
      rapidUntil: 0,
      shieldUntil: 0,
      lastShotAt: 0,
      fireRateMs: g.fireRateMs ?? 160,
      lastSpawnAt: 0,
      spawnEveryMs: g.spawnStartMs ?? 1400,
      maxEnemies: g.maxEnemiesStart ?? 6,
      lastDifficultyStepAt: 0,
      nearestEnemy: null,
    };
    this.mobile.state = { left: false, right: false, action: false };
    this.mobile.lastActionTapAt = 0;
  }


  _cleanup() {
    if (this.physics?.world && !this.physics.world.isPaused) {
      this.physics.world.pause();
    }
    this.input.enabled = false;

    this._tearingDown = true;
    this._killTimersAndTweens();
    this._destroyColliders();
    // try { this.physics?.world?.colliders?.destroy(); } catch (_) { }
    this.sound.stopAll();

    const safeWipe = (grp) => {
      if (!grp?.getChildren) return;
      const kids = grp.getChildren().slice();
      for (const k of kids) {
        try {
          // Fully disable physics before destroy
          if (k.body) { k.body.enable = false; k.body.checkCollision.none = true; }
          k.destroy();
        } catch (_) { }
      }
      try { grp.runChildUpdate = false; } catch (_) { }
    };

    safeWipe(this.enemies);
    safeWipe(this.spits);
    safeWipe(this.bullets);
    safeWipe(this.pickups);

    this.mobile.state = { left: false, right: false, action: false };
  }

}

