class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');

    // Core state
    this.state = { timeLeft: 60, kills: 0, hp: 3, won: false, gameOver: false };

    // Refs & groups
    this.cfg = null; this.W = 1920; this.H = 1080; // landscape-friendly defaults
    this.platforms = null; this.enemies = null;
    this.bullets = null; this.pellets = null; this.eBullets = null; // enemy bullets
    this.crates = null; this.player = null;

    // Timers
    this._spawnEvt = null; this._crateEvt = null; this._countEvt = null;

    // Input
    this.cursors = null; this.keyShoot = null; this.keyJump = null;

    // Mobile buttons
    this.btnLeft = null; this.btnRight = null; this.btnShoot = null; this.btnJump = null;
    this._holdLeft = false; this._holdRight = false; this._holdShoot = false;

    // Weapons
    this.weapon = 'pistol'; this.weaponEndsAt = 0; this._nextFireAt = 0; this.faceDir = 1;

    // Audio & HUD
    this.sfx = { bgm: null, shoot: null, blast: null, kill: null, hit: null, pickup: null, win: null, lose: null };
    this.hud = { timer: null, hp: null, kills: null, weapon: null };
  }

  // Runs before preload on scene.start()/scene.restart() if present
  init() {
    this._hardResetForReplay();
  }

  // Fully reset state/timers/groups/audio so restart = clean slate
  _hardResetForReplay() {
    // Timers
    if (this._spawnEvt || this._crateEvt || this._countEvt) this._cleanupTimers();
    this._spawnEvt = this._crateEvt = this._countEvt = null;

    // Core state & flags
    this.state = { timeLeft: 60, kills: 0, hp: 3, won: false, gameOver: false };
    this.weapon = 'pistol';
    this.weaponEndsAt = 0;
    this._nextFireAt = 0;
    this.faceDir = 1;
    this._invulnUntil = 0;

    this._holdLeft = false;
    this._holdRight = false;
    this._holdShoot = false;

    // Destroy and null any old groups (if this is a restart on same instance)
    const killGroup = (g) => { try { g?.clear?.(true, true); } catch (e) { } };
    killGroup(this.platforms); this.platforms = null;
    killGroup(this.enemies); this.enemies = null;
    killGroup(this.bullets); this.bullets = null;
    killGroup(this.pellets); this.pellets = null;
    killGroup(this.eBullets); this.eBullets = null;
    killGroup(this.crates); this.crates = null;

    // Kill HUD if it exists (avoid double texts)
    if (this.hud) {
      ['timer', 'hp', 'kills', 'weapon'].forEach(k => {
        try { this.hud[k]?.destroy?.(); } catch (e) { }
        this.hud[k] = null;
      });
    }

    // Stop any looping audio from previous run
    try { if (this.sfx?.bgm?.isPlaying) this.sfx.bgm.stop(); } catch (e) { }
  }


  preload() {
    const cfg = this.registry.get('cfg') || {};
    const images = (cfg.images1 || {}), audio = (cfg.audio || {});
    const images2 = (cfg.images2 || {});
    const ui = (cfg.ui || {});
    for (const k of Object.keys(images2)) this.load.image(k, images2[k]);
    for (const k of Object.keys(ui)) this.load.image(k, ui[k]);
    for (const k of Object.keys(images)) this.load.image(k, images[k]);
    for (const k of Object.keys(audio)) this.load.audio(k, audio[k]);
    // if (cfg.font?.url) this.load.font(cfg.font.family || 'Outfit', cfg.font.url);
  }

  create() {

    // ← ensure a clean slate even on scene.restart()
    this._hardResetForReplay();

    this.cfg = this.registry.get('cfg') || {};
    const G = this.cfg.gameplay || {};

    // World (LANDSCAPE)
    this.W = this.scale.width; this.H = this.scale.height;

    this.physics.world.setBounds(0, 0, this.W, this.H);
    this.physics.world.gravity.y = G.gravityY ?? 900;

    if (this.textures.exists('background')) {
      this.add.image(this.W * 0.5, this.H * 0.5, 'background').setDisplaySize(this.W, this.H).setDepth(-100);
    }

    // Groups
    this.platforms = this.physics.add.staticGroup();
    this.enemies = this.physics.add.group({ maxSize: 96 });
    this.bullets = this.physics.add.group({ maxSize: 18, allowGravity: false });
    this.pellets = this.physics.add.group({ maxSize: 60, allowGravity: false });
    this.eBullets = this.physics.add.group({ maxSize: 96, allowGravity: false }); // enemy bullets
    this.crates = this.physics.add.group({ maxSize: 6 });

    // ---- Arena (more platforms, landscape) ----
    this._buildArenaLandscape();

    // Player
    this.player = this.physics.add.sprite(this.W * 0.5, this.H - 140, 'player')
      .setDisplaySize(64, 64);
    this.player.body.setSize(64, 64);
    this.player.setCollideWorldBounds(true).setMaxVelocity(900, 1400);

    // Colliders / overlaps
    this.physics.add.collider(this.player, this.platforms);
    this.physics.add.collider(this.enemies, this.platforms);
    this.physics.add.collider(this.crates, this.platforms);
    this.physics.add.collider(this.bullets, this.platforms, b => b.destroy(), null, this);
    this.physics.add.collider(this.pellets, this.platforms, p => p.destroy(), null, this);
    this.physics.add.collider(this.eBullets, this.platforms, b => b.destroy(), null, this);

    this.physics.add.overlap(this.bullets, this.enemies, this._onBulletHitsEnemy, null, this);
    this.physics.add.overlap(this.pellets, this.enemies, this._onBulletHitsEnemy, null, this);
    this.physics.add.overlap(this.player, this.enemies, this._onEnemyHitsPlayer, this._canHurtPlayer, this);
    this.physics.add.overlap(this.player, this.eBullets, this._onEBulletHitsPlayer, null, this);
    this.physics.add.overlap(this.player, this.crates, this._onPickupCrate, null, this);

    // Input (SEPARATED: Space/↑ = jump; Z/mouse/tap = shoot)
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keyJump = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.keyShoot = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Z);
    this.keyShoot.on('down', () => this._tryShoot()); // Space no longer shoots

    // Pointer shooting (tap/hold)
    this.input.on('pointerdown', () => { this._holdShoot = true; this._tryShoot(); });
    this.input.on('pointerup', () => { this._holdShoot = false; });

    // Mobile buttons (now includes Jump)
    this._createMobileButtonsLandscape();

    // Audio
    const A = this.cfg.audio || {};
    const get = k => (A[k] ? this.sound.add(k) : null);
    this.sfx.bgm = get('bgm'); this.sfx.shoot = get('shoot'); this.sfx.blast = get('blast');
    this.sfx.kill = get('kill'); this.sfx.hit = get('hit'); this.sfx.pickup = get('collect');
    this.sfx.win = get('win'); this.sfx.lose = get('lose');
    if (this.sfx.bgm) { this.sfx.bgm.setLoop(true); this.sfx.bgm.play(); }

    // HUD
    const font = (this.cfg.font && this.cfg.font.family) ? this.cfg.font.family : 'Arial';
    this.hud.timer = this.add.text(this.W * 0.5, 36, (G.timerSeconds ?? 60).toString(), { fontFamily: font, fontSize: 36, color: '#ffffff' }).setOrigin(0.5, 0.5);
    this.hud.hp = this.add.text(24, 24, 'HP: ' + (G.playerHP ?? 3), { fontFamily: font, fontSize: 28, color: '#ffdf5e' }).setOrigin(0, 0.5);
    this.hud.kills = this.add.text(24, 64, 'Kills: 0', { fontFamily: font, fontSize: 28, color: '#ffffff' }).setOrigin(0, 0.5);
    this.hud.weapon = this.add.text(this.W - 24, 24, 'Pistol', { fontFamily: font, fontSize: 28, color: '#7fe3ff' }).setOrigin(1, 0.5);

    // Timers
    this.state.timeLeft = G.timerSeconds ?? 60;
    this.state.hp = G.playerHP ?? 3;

    this._countEvt = this.time.addEvent({
      delay: 1000, loop: true, callback: () => {
        this.state.timeLeft--;
        this.hud.timer.setText(this.state.timeLeft.toString());
        if (this.state.timeLeft <= 0 && !this.state.won) this._win();
      }
    });

    // Spawners
    this._scheduleNextSpawn(0);
    const crateCd = (G.crate?.cooldownMs ?? 11000);
    this._crateEvt = this.time.addEvent({ delay: crateCd, loop: true, callback: () => this._spawnCrate() });
  }

  update(time, delta) {
    if (this.state.gameOver || this.state.won) return;

    const G = this.cfg.gameplay || {};
    const speed = G.playerSpeed ?? 280;
    const jumpV = (G.jumpSpeed !== undefined ? G.jumpSpeed : -720);

    // ---- Movement (with guards) ----
    let vx = 0;
    if (this.cursors?.left?.isDown || this._holdLeft) { vx -= speed; this.faceDir = -1; }
    if (this.cursors?.right?.isDown || this._holdRight) { vx += speed; this.faceDir = 1; }
    if (this.player?.body) this.player.setVelocityX(vx);

    // Jump (Space/Up or mobile Jump)
    if ((this.cursors?.up?.isDown || this.keyJump?.isDown) && this.player?.body?.onFloor()) {
      this.player.setVelocityY(jumpV);
    }

    // ---- Weapons (hold-to-fire where applicable) ----
    if (this.weapon === 'ak' && (this._holdShoot || this.keyShoot?.isDown) && time >= this._nextFireAt) {
      this._fireBullet();
    }
    if (this.weapon === 'shotgun' && (this._holdShoot || this.keyShoot?.isDown) && time >= this._nextFireAt) {
      this._fireShotgun();
    }
    if (this.weapon !== 'pistol' && time >= this.weaponEndsAt) {
      this._setWeapon('pistol');
    }

    // ---- Enemy AI: aimed shots ----
    this._tickEnemyShooting(time);

    // ---- Cleanup off-screen projectiles ----
    const off = (o) => {
      if (!o?.active) return;
      if (o.x < -50 || o.x > this.W + 50 || o.y < -50 || o.y > this.H + 50) o.destroy();
    };
    this.bullets?.children?.each(off);
    this.pellets?.children?.each(off);
    this.eBullets?.children?.each(off);
  }


  // ---- Crate spawner (drop-in) ----
  _spawnCrate() {
    if (!this.platforms || !this.crates) return;

    const plats = this.platforms.getChildren();
    if (!plats.length) return;

    // Prefer wider platforms so the crate has room
    const wide = plats.filter(p => (p.displayWidth || 0) >= 200);
    const base = (wide.length ? Phaser.Utils.Array.GetRandom(wide) : Phaser.Utils.Array.GetRandom(plats));

    const halfW = (base.displayWidth || 200) * 0.5;
    const x = Phaser.Math.Between((base.x - halfW + 40) | 0, (base.x + halfW - 40) | 0);
    const y = (base.y - (base.displayHeight || 32) * 0.5) - 36;

    const c = this.crates.create(x, y, 'crate');
    c.setDisplaySize(64, 64);
    c.body.setSize(64, 64);
    c.setBounce(0.1);
    c.setCollideWorldBounds(true);
    c.setDepth(5);
  }


  // ----- Arena -----
  // ----- Arena (LANDSCAPE) with alternating platforms -----
  _buildArenaLandscape() {
    // Full-width floor
    this._createPlatform(this.W * 0.5, this.H - 16, this.W, 32, 'platform1');

    // Rows: lower to higher; alternating start (platform → gap → platform …),
    // then next row starts with a gap so columns don't align.
    const pad = 48; // side padding from screen edges
    const rows = [
      { y: this.H * 0.90, segW: 300, segH: 28, gapW: 280, key: 'platform2', startWithPlatform: false },
      { y: this.H * 0.80, segW: 420, segH: 28, gapW: 220, key: 'platform1', startWithPlatform: true },
      { y: this.H * 0.70, segW: 380, segH: 28, gapW: 240, key: 'platform2', startWithPlatform: false },
      { y: this.H * 0.55, segW: 380, segH: 28, gapW: 280, key: 'platform1', startWithPlatform: false },
      { y: this.H * 0.48, segW: 340, segH: 28, gapW: 260, key: 'platform2', startWithPlatform: true },
      { y: this.H * 0.28, segW: 300, segH: 28, gapW: 280, key: 'platform1', startWithPlatform: false },
      { y: this.H * 0.12, segW: 300, segH: 28, gapW: 260, key: 'platform2', startWithPlatform: false }
    ];

    rows.forEach(r => {
      this._addAlternatingRow(
        r.y, r.segW, r.segH, r.gapW,
        pad, pad, r.key, r.startWithPlatform
      );
    });
  }

  // Build a single horizontal row: platform, gap, platform, gap …
  _addAlternatingRow(y, segW, segH, gapW, leftPad, rightPad, key, startWithPlatform = true) {
    // First platform center X
    let x = leftPad + segW * 0.5;

    // If we want to start with a gap first, shift by the gap width
    if (!startWithPlatform) x += gapW;

    const xMax = this.W - rightPad - segW * 0.5;

    for (; x <= xMax; x += (segW + gapW)) {
      this._createPlatform(x, y, segW, segH, key);
    }
  }


  _createPlatform(x, y, w, h, key) {
    const s = this.platforms.create(x, y, key || 'platform1');
    s.setDisplaySize(w, h); s.refreshBody(); s.body.setSize(w, h);
  }

  // ----- Mobile buttons (landscape positions + Jump) -----
  // ----- Mobile buttons (landscape positions + Jump) -----
  // Creates LEFT / RIGHT / FIRE (action) / JUMP. Uses texture keys if present,
  // otherwise draws circular fallback buttons with labels.
  _createMobileButtonsLandscape() {
    // Allow multi-touch (4 pointers total: 1 default + 3 extra)
    this.input.addPointer(3);
    // Let lower buttons still receive input even if something overlaps
    this.input.setTopOnly(false);

    const y = this.H - 90;
    const leftX = 160;
    const rightX = 460;
    const shootX = this.W - 160;
    const jumpX = this.W - 320;

    const makeImageBtn = (texKey, x, y, fallbackLabel) => {
      // If we have a loaded texture, use it
      if (this.textures.exists(texKey)) {
        const img = this.add.image(x, y, texKey)
          .setDisplaySize(120, 120)
          .setAlpha(0.85)
          .setScrollFactor(0)
          .setDepth(999)
          .setInteractive({ useHandCursor: true });
        return img;
      }

      // Fallback: circular button with text label inside
      const circle = this.add.circle(0, 0, 60, 0x000000, 0.35).setStrokeStyle(4, 0xffffff, 0.85);
      const label = this.add.text(0, 0, fallbackLabel, {
        fontFamily: (this.cfg?.font?.family) || 'Arial',
        fontSize: '22px',
        color: '#ffffff',
        stroke: '#000',
        strokeThickness: 3
      }).setOrigin(0.5);

      const c = this.add.container(x, y, [circle, label])
        .setDepth(999)
        .setScrollFactor(0)
        .setSize(120, 120);
      // Make the container itself interactive with a circular hit area
      c.setInteractive(new Phaser.Geom.Circle(60, 60, 60), Phaser.Geom.Circle.Contains);
      c.setAlpha(0.85);
      return c;
    };

    const press = (btn, flag, onPress) => { btn.setScale(0.92); btn.setAlpha(1.0); if (flag) this[flag] = true; if (onPress) onPress(); };
    const lift = (btn, flag) => { btn.setScale(1.0); btn.setAlpha(0.85); if (flag) this[flag] = false; };
    const hookup = (btn, flag, onPress) => {
      btn.on('pointerdown', () => press(btn, flag, onPress));
      btn.on('pointerup', () => lift(btn, flag));
      btn.on('pointerout', () => lift(btn, flag));
      btn.on('pointerupoutside', () => lift(btn, flag));
    };

    // Build buttons (uses 'left', 'right', 'action', 'jump' keys if present)
    this.btnLeft = makeImageBtn('left', leftX, y, 'LEFT');
    this.btnRight = makeImageBtn('right', rightX, y, 'RIGHT');
    this.btnShoot = makeImageBtn('action', shootX, y, 'FIRE');
    this.btnJump = makeImageBtn('jump', jumpX, y, 'JUMP');

    // Wire up holds / actions
    hookup(this.btnLeft, '_holdLeft');
    hookup(this.btnRight, '_holdRight');
    hookup(this.btnShoot, '_holdShoot', () => this._tryShoot());

    // Jump is tap-to-jump (no hold)
    this.btnJump.on('pointerdown', () => {
      this.btnJump.setScale(0.92).setAlpha(1.0);
      const jumpV = (this.cfg?.gameplay?.jumpSpeed !== undefined) ? this.cfg.gameplay.jumpSpeed : -720;
      if (this.player?.body?.onFloor()) this.player.setVelocityY(jumpV);
    });
    const liftJump = () => this.btnJump.setScale(1.0).setAlpha(0.85);
    this.btnJump.on('pointerup', liftJump);
    this.btnJump.on('pointerout', liftJump);
    this.btnJump.on('pointerupoutside', liftJump);
  }

  // ----- Spawning & AI -----
  _scheduleNextSpawn(delayOverride = 0) {
    if (this._spawnEvt) this._spawnEvt.remove(false);
    const G = this.cfg.gameplay || {};
    const total = Math.max(1, G.timerSeconds ?? 60);
    const t = 1 - (this.state.timeLeft / total);
    const startMs = G.spawn?.startMs ?? 1400;
    const endMs = G.spawn?.endMs ?? 500;
    const delay = delayOverride || Phaser.Math.Linear(startMs, endMs, t);

    this._spawnEvt = this.time.addEvent({ delay, loop: false, callback: () => { this._spawnEnemyFaller(); this._scheduleNextSpawn(); } });
  }

  _spawnEnemyFaller() {
    // Spawn from random X at the TOP, then gravity does the rest
    const x = Phaser.Math.Between(40, this.W - 40);
    const y = -24;

    const t = 1 - (this.state.timeLeft / (this.cfg.gameplay?.timerSeconds ?? 60));
    const key = (Math.random() < 0.25 && t > 0.4 && this.textures.exists('enemyFast')) ? 'enemyFast' : 'enemy';
    const e = this.enemies.create(x, y, key);
    const sz = (key === 'enemyFast') ? 52 : 56;
    e.setDisplaySize(sz, sz); e.body.setSize(sz, sz);
    e.setCollideWorldBounds(true).setBounce(0);

    // Small random horizontal drift
    e.setVelocityX(Phaser.Math.Between(-80, 80));
    // tag next shot time
    e.nextShootAt = this.time.now + Phaser.Math.Between(900, 1600);
  }

  _tickEnemyShooting(now) {
    // Guards: only run if we have a live player, bullets group, and the texture exists
    if (!this.player || !this.player.active || !this.player.body) return;
    if (!this.eBullets) return;
    if (!this.textures.exists('ebullet')) return;

    const base = 650, fast = 820; // enemy bullet speeds
    const total = Math.max(1, this.cfg.gameplay?.timerSeconds ?? 60);
    const t = 1 - (this.state.timeLeft / total);

    // Iterate all enemies
    const list = this.enemies?.getChildren ? this.enemies.getChildren() : [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e?.active) continue;

      if (!e.nextShootAt) e.nextShootAt = now + Phaser.Math.Between(900, 1600);
      if (now < e.nextShootAt) continue;

      // Aim at player
      const dx = this.player.x - e.x, dy = this.player.y - e.y;
      const len = Math.max(1, Math.hypot(dx, dy));
      const spd = (e.texture?.key === 'enemyFast') ? fast : base;

      const b = this.eBullets.create(e.x, e.y, 'ebullet');
      b.setDisplaySize(12, 12);
      b.body.setSize(12, 12);
      b.body.allowGravity = false;
      b.setVelocity((dx / len) * spd, (dy / len) * spd);

      // Next shot gets faster as time passes
      const minCd = 700, maxCd = 1400;
      const cd = Phaser.Math.Linear(maxCd, minCd, t) + Phaser.Math.Between(-200, 150);
      e.nextShootAt = now + Math.max(400, cd);
    }
  }

  // ----- Weapons -----
  _tryShoot() {
    if (this.state.gameOver || this.state.won) return;
    if (this.weapon === 'pistol') {
      if (this.bullets.countActive(true) > 0) return; // one-bullet rule
      this._fireBullet();
    } else if (this.weapon === 'ak') this._fireBullet();
    else if (this.weapon === 'shotgun') this._fireShotgun();
  }

  _fireBullet() {
    const G = this.cfg.gameplay || {};
    const now = this.time.now;
    let fireMs = 350, spd = 900;
    if (this.weapon === 'ak') { fireMs = G.weapon?.ak?.fireMs ?? 110; spd = G.weapon?.ak?.bulletSpeed ?? 1100; }
    else if (this.weapon === 'pistol') { fireMs = G.weapon?.pistol?.fireMs ?? 350; spd = G.weapon?.pistol?.bulletSpeed ?? 900; }
    if (now < this._nextFireAt) return; this._nextFireAt = now + fireMs;

    const b = this.bullets.create(this.player.x + this.faceDir * 36, this.player.y - 6, 'bullet');
    b.setDisplaySize(20, 20); b.body.setSize(20, 20); b.body.allowGravity = false;
    b.setVelocity(this.faceDir * spd, 0);
    if (this.sfx.shoot) this.sfx.shoot.play();
  }

  _fireShotgun() {
    const G = this.cfg.gameplay || {};
    const now = this.time.now;
    const fireMs = G.weapon?.shotgun?.fireMs ?? 500;
    const spd = G.weapon?.shotgun?.bulletSpeed ?? 800;
    const pellets = G.weapon?.shotgun?.pellets ?? 5;
    const spread = G.weapon?.shotgun?.spreadDeg ?? 24;
    if (now < this._nextFireAt) return; this._nextFireAt = now + fireMs;

    for (let i = 0; i < pellets; i++) {
      const ang = Phaser.Math.DegToRad(Phaser.Math.Between(-spread / 2, spread / 2));
      const vx = Math.cos(ang) * spd * this.faceDir;
      const vy = Math.sin(ang) * spd * 0.45;
      const p = this.pellets.create(this.player.x + this.faceDir * 36, this.player.y - 6, 'pellet');
      p.setDisplaySize(14, 14); p.body.setSize(14, 14); p.body.allowGravity = false;
      p.setVelocity(vx, vy);
    }
    if (this.sfx.blast) this.sfx.blast.play();
  }

  // ----- Collisions -----
  _onBulletHitsEnemy(projectile, enemy) {
    if (projectile.active) projectile.destroy();
    if (!enemy.active) return; enemy.destroy();
    this.state.kills++; this.hud.kills.setText('Kills: ' + this.state.kills);
    if (this.sfx.kill) this.sfx.kill.play();
  }

  _onEBulletHitsPlayer(player, bullet) {
    // Ensure we destroy the enemy bullet, not the player
    if (bullet?.active) bullet.destroy();

    // Respect brief invulnerability
    if (!this._canHurtPlayer()) return;

    // HP update
    this.state.hp = Math.max(0, (this.state.hp ?? 0) - 1);
    if (this.hud?.hp) this.hud.hp.setText('HP: ' + this.state.hp);
    if (this.sfx?.hit) this.sfx.hit.play();

    // Short i-frames
    this._invulnUntil = this.time.now + 500;

    // Mild knockback away from the bullet
    const kbX = 220 * (bullet.x < player.x ? 1 : -1);
    if (player?.body) player.setVelocity(kbX, -180);

    if (this.state.hp <= 0) this._lose();
  }


  _canHurtPlayer() { return !this._invulnUntil || this.time.now >= this._invulnUntil; }

  _onEnemyHitsPlayer(player, enemy) {
    if (!this._canHurtPlayer()) return;
    this.state.hp--; this.hud.hp.setText('HP: ' + this.state.hp);
    if (this.sfx.hit) this.sfx.hit.play();
    this._invulnUntil = this.time.now + 600;
    const kb = 260 * (enemy.x < player.x ? 1 : -1);
    this.player.setVelocity(kb, -240);
    if (this.state.hp <= 0) this._lose();
  }

  // ----- Crates & weapons -----
  _onPickupCrate(player, crate) {
    crate.destroy();
    const pick = (Math.random() < 0.5) ? 'ak' : 'shotgun';
    this._setWeapon(pick);
    if (this.sfx.pickup) this.sfx.pickup.play();
  }

  _setWeapon(kind) {
    const G = this.cfg.gameplay || {};
    const now = this.time.now;
    if (kind === 'pistol') { this.weapon = 'pistol'; this.weaponEndsAt = 0; this.hud.weapon.setText('Pistol'); }
    else if (kind === 'ak') { this.weapon = 'ak'; this.weaponEndsAt = now + (G.weapon?.ak?.durationMs ?? 10000); this.hud.weapon.setText('AK'); }
    else if (kind === 'shotgun') { this.weapon = 'shotgun'; this.weaponEndsAt = now + (G.weapon?.shotgun?.durationMs ?? 10000); this.hud.weapon.setText('Shotgun'); }
  }

  // ----- Win/Lose & cleanup -----
  _win() {
    if (this.state.won || this.state.gameOver) return;
    this.state.won = true;
    if (this.sfx.win) this.sfx.win.play();
    this._cleanupTimers();

    // Safely handoff only if scenes exist
    if (this.scene.manager.keys && this.scene.manager.keys['WinScene']) {
      this.scene.start('WinScene', { score: this.state.kills });
    }
  }

  _lose() {
    if (this.state.gameOver || this.state.won) return;
    this.state.gameOver = true;
    if (this.sfx.lose) this.sfx.lose.play();
    this._cleanupTimers();

    if (this.scene.manager.keys && this.scene.manager.keys['GameOverScene']) {
      this.scene.start('GameOverScene', { score: this.state.kills });
    }
  }
  _cleanupTimers() { if (this._spawnEvt) { this._spawnEvt.remove(false); this._spawnEvt = null; } if (this._crateEvt) { this._crateEvt.remove(false); this._crateEvt = null; } if (this._countEvt) { this._countEvt.remove(false); this._countEvt = null; } }
  shutdown() { this._cleanupTimers(); Object.values(this.sfx).forEach(s => { if (s && s.stop) s.stop(); }); }
  destroy() { this.shutdown(); }
}
