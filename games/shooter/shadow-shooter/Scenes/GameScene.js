class GameScene extends Phaser.Scene {
  constructor() { super('GameScene'); }

  preload() {
    const cfg = this.registry.get('cfg') || {};
    const img1 = cfg.images1 || {};
    const img2 = cfg.images2 || {};
    const ui = cfg.ui || {};
    const aud = cfg.audio || {};

    if (img2.background) this.load.image('background', img2.background);
    if (img1.player) this.load.image('player', img1.player);
    if (img1.enemy) this.load.image('enemy', img1.enemy);
    if (img1.collectible) this.load.image('bullet', img1.collectible);
    if (img2.platform) this.load.image('platform', img2.platform);

    if (ui.left) this.load.image('btn_up', ui.left);
    if (ui.right) this.load.image('btn_down', ui.right);
    if (ui.action) this.load.image('btn_action', ui.action);

    if (aud.bgm) this.load.audio('bgm', aud.bgm);
    if (aud.explosion) this.load.audio('destroy', aud.explosion);
    if (aud.hit) this.load.audio('hit', aud.hit);
    if (aud.collect) this.load.audio('attack', aud.collect);
  }

  create() {
    const cfg = this.registry.get('cfg') || {};
    const G = cfg.gameplay || {};

    this.W = Number(this.sys.game?.config?.width) || this.scale.width || 1920;
    this.H = Number(this.sys.game?.config?.height) || this.scale.height || 1080;

    this.sys.cameras.main.setBackgroundColor('#0d0d1a');
    if (this.textures.exists('background')) {
      this.add.image(this.W * 0.5, this.H * 0.5, 'background')
        .setDisplaySize(this.W, this.H).setScrollFactor(0);
    }

    this.physics.world.setBounds(0, 0, this.W, this.H);
    this.physics.world.gravity.y = 0;

    this.tune = {
      // survive 1 minute to win
      playerSpeed: G.playerSpeed ?? 500,
      bulletSpeed: G.bulletSpeed ?? 900,
      fireCooldownMs: G.fireCooldownMs ?? 220,
      enemySpawnMs: G.enemySpawnMs ?? 850,
      enemyJitterMs: G.enemyJitterMs ?? 150,
      enemySpeedMin: G.enemySpeedMin ?? 260,
      enemySpeedMax: G.enemySpeedMax ?? 460,
      shadowSpeed: G.shadowSpeed ?? 220,

      // ✅ Updated values
      hpStart: G.hpStart ?? 5,              // 5 lives
      scoreTarget: G.scoreTarget ?? 5,      // target score 5

      sizes: {
        player: (G.playerSize && G.playerSize.w) ? G.playerSize : { w: 96, h: 96 },
        enemy: (G.shadowSize && G.shadowSize.w) ? G.shadowSize : { w: 84, h: 84 },
        bullet: (G.bulletSize && G.bulletSize.w) ? G.bulletSize : { w: 26, h: 12 }
      }
    };


    this.state = {
      score: 0,
      hp: this.tune.hpStart,
      lastShotAt: 0,
      finished: false, alive: true,
      invUntil: 0
    };

    this.player = this.physics.add.sprite(250, this.H * 0.5, 'player');
    this.player.setDisplaySize(this.tune.sizes.player.w + 100, this.tune.sizes.player.h + 100);
    this.player.setCollideWorldBounds(true);
    this.player.body.setAllowGravity(false);
    this.player.body.setSize(this.player.displayWidth - 100, this.player.displayHeight - 70);

    this.bullets = this.physics.add.group({ runChildUpdate: true });
    this.enemies = this.physics.add.group({ runChildUpdate: true });
    this.shadows = this.physics.add.group({ runChildUpdate: true });

    // Overlaps
    // Overlaps
    this._colliders = [];
    this._colliders.push(this.physics.add.overlap(this.bullets, this.enemies, this._bulletHitsEnemy, null, this));
    this._colliders.push(this.physics.add.overlap(this.player, this.enemies, this._enemyHitsPlayer, null, this));
    this._colliders.push(this.physics.add.overlap(this.bullets, this.shadows, this._bulletHitsShadow, null, this));
    this._colliders.push(this.physics.add.overlap(this.player, this.shadows, this._shadowHitsPlayer, null, this));


    this.cursors = this.input.keyboard.createCursorKeys();
    this.keySpace = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this._uiPointerId = null;

    this.input.addPointer(2);

    this.input.on('pointermove', (p) => {
      if (this._uiPointerId === p.id) return;
      if (!this.state.alive || this.state.finished) return;
      if (p.isDown) {
        const hh = this.player.displayHeight * 0.5;
        this.player.y = Phaser.Math.Clamp(p.y, hh, this.H - hh);
      }
    });

    this._mobile = { up: false, down: false, shoot: false };
    this._makeButtons();

    const fontFamily = (cfg.font && cfg.font.family) || 'Arial';
    this.hud = {
      score: this.add.text(60, 50, 'Score: 0', { fontFamily, fontSize: '48px', color: '#000000ff' }).setDepth(1000),
      lives: this.add.text(850, 50, `Lives: ${this.state.hp}`, { fontFamily, fontSize: '48px', color: '#000000ff' }).setDepth(1000),
      // time: this.add.text(this.W - 24, 24, `Time: ${this.state.timeLeft}`, { fontFamily, fontSize: '38px', color: '#b0e3ff' }).setOrigin(1, 0).setDepth(1000),
      target: this.add.text(this.W - 60, 50, `Target: ${this.tune.scoreTarget}`, { fontFamily, fontSize: '48px', color: '#030303ff' }).setOrigin(1, 0).setDepth(1000)
    };

    this.add.image(180, 80, 'scoreback')

    this.add.image(960, 80, 'scoreback')

    this.add.image(1760, 80, 'scoreback')


    this.sfx = {
      bgm: this.cache.audio.exists('bgm') ? this.sound.add('bgm', { loop: true, volume: 0.5 }) : null,
      attack: this.cache.audio.exists('attack') ? this.sound.add('attack', { volume: 0.8 }) : null,
      destroy: this.cache.audio.exists('destroy') ? this.sound.add('destroy', { volume: 0.8 }) : null,
      hit: this.cache.audio.exists('hit') ? this.sound.add('hit', { volume: 0.9 }) : null,
    };
    this.sfx.bgm?.play();

    // this._countEvt = this.time.addEvent({ delay: 1000, loop: true, callback: this._tick, callbackScope: this });
    this._scheduleEnemy();
    this._scheduleShadow();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this._teardown, this);
    this.events.once(Phaser.Scenes.Events.DESTROY, this._teardown, this);
  }

  update(t) {
    if (!this.state.alive || this.state.finished) return;

    let vy = 0;
    if (this.cursors.up.isDown || this._mobile.up) vy = -this.tune.playerSpeed;
    if (this.cursors.down.isDown || this._mobile.down) vy = this.tune.playerSpeed;
    this.player.body.setVelocity(0, vy);

    const hh = this.player.displayHeight * 0.5;
    this.player.y = Phaser.Math.Clamp(this.player.y, hh, this.H - hh);

    const now = t;
    const wantShoot = this.keySpace.isDown || this._mobile.shoot;
    if (wantShoot && (now - this.state.lastShotAt) >= this.tune.fireCooldownMs) {
      this._fire();
      this.state.lastShotAt = now;
    }

    // home shadows toward player
    this.shadows.children.iterate(sh => {
      if (!sh || !sh.active) return;
      this.physics.moveToObject(sh, this.player, this.tune.shadowSpeed);
    });

    // keep bullets moving right
    const targetVX = this.tune.bulletSpeed || 900;
    this.bullets.children.iterate(b => {
      if (!b || !b.active || !b.body) return;
      if (Math.abs(b.body.velocity.x) < 1 && Math.abs(b.body.velocity.y) < 1) {
        b.body.setVelocity(targetVX, 0);
      }
    });
  }

  // ---------- Spawning ----------
  _scheduleEnemy() {
    const j = Phaser.Math.Between(-this.tune.enemyJitterMs, this.tune.enemyJitterMs);
    const delay = Phaser.Math.Clamp(this.tune.enemySpawnMs + j, 250, 2000);
    this.time.delayedCall(delay, this._spawnEnemy, null, this);
  }

  _spawnEnemy() {
    if (!this.state.alive || this.state.finished) return;

    const y = Phaser.Math.Between(60, this.H - 60);
    const x = this.W + 40; // spawn just off the right edge

    const e = this.physics.add.sprite(x, y, 'enemy');

    // use configured enemy size (with safe fallbacks)
    const sz = (this.tune && this.tune.sizes && this.tune.sizes.enemy) || {};
    const ew = Number(sz.w) || 84;
    const eh = Number(sz.h) || 84;
    e.setDisplaySize(ew, eh);

    // physics setup
    e.body.setAllowGravity(false);
    e.body.setDrag(0, 0);
    e.body.useDamping = false;
    e.body.setImmovable(false);
    e.body.setBounce(0, 0);
    e.body.setSize(e.displayWidth, e.displayHeight);

    // move left at random speed
    const spd = Phaser.Math.Between(this.tune.enemySpeedMin, this.tune.enemySpeedMax);
    e.body.setVelocity(-spd, 0);

    // subtle float/wobble
    e._wobble = this.tweens.add({
      targets: e,
      y: { from: e.y - Phaser.Math.Between(12, 40), to: e.y + Phaser.Math.Between(12, 40) },
      duration: Phaser.Math.Between(500, 900),
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut'
    });

    // auto-clean when well offscreen
    e.update = () => {
      if (!e.active || e.x < -Math.max(ew, 120)) {
        e._wobble?.stop();
        e.destroy();
      }
    };

    this.enemies.add(e);
    this._scheduleEnemy();
  }


  _scheduleShadow() {
    const delay = Phaser.Math.Between(2500, 5500);
    this.time.delayedCall(delay, this._spawnShadow, null, this);
  }

  _spawnShadow() {
    if (!this.state.alive || this.state.finished) return;

    const x = this.W + 60; // RIGHT only
    const y = Phaser.Math.Between(40, this.H - 40);

    const sh = this.physics.add.sprite(x, y, 'enemy'); // reuse art
    sh.setDisplaySize(this.tune.sizes.enemy.w + 150, this.tune.sizes.enemy.h + 150);
    sh.setTint(0x5a5a5a).setAlpha(0.9);

    sh.body.setAllowGravity(false).setSize(sh.displayWidth - 100, sh.displayHeight - 80);
    sh._pulse = this.tweens.add({
      targets: sh, alpha: { from: 0.6, to: 1.0 }, duration: 500, yoyo: true, repeat: -1, ease: 'Sine.inOut'
    });

    sh.body.setVelocity(-this.tune.shadowSpeed, 0);
    sh.update = () => {
      if (sh.x < -120 || !sh.active) { sh._pulse?.stop(); sh.destroy(); }
    };

    this.shadows.add(sh);
    this._scheduleShadow();
  }

  // ---------- Actions ----------
  _fire() {
    if (!this.textures.exists('bullet')) return;

    const b = this.physics.add.sprite(
      this.player.x + this.player.displayWidth * 0.6,
      this.player.y,
      'bullet'
    );

    const bw = (this.tune.sizes.bullet && this.tune.sizes.bullet.w) ? this.tune.sizes.bullet.w : 26;
    const bh = (this.tune.sizes.bullet && this.tune.sizes.bullet.h) ? this.tune.sizes.bullet.h : 12;
    b.setDisplaySize(bw, bh);

    b.body.setAllowGravity(false);
    b.body.setDrag(0, 0);
    b.body.useDamping = false;
    b.body.setImmovable(false);
    b.body.setBounce(0, 0);
    b.body.setSize(b.displayWidth, b.displayHeight);
    b.setCollideWorldBounds(false);
    // IMPORTANT: do NOT disable checkCollision; we want overlaps to fire

    const spd = this.tune.bulletSpeed || 900;
    b.body.setVelocity(spd, 0);
    b.setMaxVelocity(spd, spd);
    b.body.maxSpeed = spd;
    b.body.moves = true;

    b.update = () => { if (b.x > this.W + 100 || !b.active) b.destroy(); };

    this.bullets.add(b);
    this.sfx?.attack?.play();
  }

  // ---------- Collisions ----------
  _bulletHitsEnemy(b, e) {
    if (!b.active || !e.active) return;
    b.destroy();

    e._wobble?.stop();
    const boom = this.add.sprite(e.x, e.y, 'enemy').setDisplaySize(e.displayWidth, e.displayHeight).setAlpha(0.9).setScale(0.8);
    this.tweens.add({
      targets: boom,
      scale: { from: 0.8, to: 1.4 },
      alpha: { from: 0.9, to: 0 },
      duration: 280,
      ease: 'Cubic.Out',
      onComplete: () => boom.destroy()
    });
    e.destroy();

    this.state.score += 1;
    if (this.state.score >= this.tune.scoreTarget && !this.state.finished) this._win();

    this.hud.score.setText(`Score: ${this.state.score}`);
    this.sfx.destroy?.play();
  }

  _enemyHitsPlayer(player, e) {
    if (!e.active || !this.state.alive || this.state.finished) return;
    e._wobble?.stop();
    e.destroy();
    this._damagePlayer();
  }

  _bulletHitsShadow(b, sh) {
    if (!b.active || !sh.active) return;
    b.destroy();
    sh._pulse?.stop();
    const boom = this.add.sprite(sh.x, sh.y, 'enemy').setDisplaySize(sh.displayWidth, sh.displayHeight).setAlpha(0.9).setScale(0.8);
    this.tweens.add({
      targets: boom,
      scale: { from: 0.8, to: 1.4 },
      alpha: { from: 0.9, to: 0 },
      duration: 280,
      ease: 'Cubic.Out',
      onComplete: () => boom.destroy()
    });
    sh.destroy();

    this.state.score += 1;
    if (this.state.score >= this.tune.scoreTarget && !this.state.finished) this._win();

    this.hud.score.setText(`Score: ${this.state.score}`);
    this.sfx.destroy?.play();
  }

  _shadowHitsPlayer(player, sh) {
    // FIX: was `!this.state.finished`, which blocked runtime collisions
    if (!sh.active || !this.state.alive || this.state.finished) return;
    const now = this.time.now;
    if (now < this.state.invUntil) return;

    sh._pulse?.stop();
    sh.destroy();
    this._damagePlayer();
  }

  // --- Add this helper anywhere in the class (e.g., above _win/_lose) ---
  _goToScene(key) {
    // stop timers & inputs
    this._countEvt?.remove(false);
    this.time.removeAllEvents();
    this.input.removeAllListeners();

    const data = {
      score: this.state.score,
      hpStart: this.tune.hpStart,
      hpLeft: this.state.hp,
      width: this.W,
      height: this.H,
    };

    // small delay so banner can finish
    this.time.delayedCall(200, () => {
      this.scene.start(key, data);
    });
  }


  _damagePlayer() {
    this.state.hp -= 1;
    this.hud.lives.setText(`Lives: ${this.state.hp}`);
    this.state.invUntil = this.time.now + 200; // short i-frames
    this.sfx.hit?.play();
    this.tweens.add({
      targets: this.player, alpha: { from: 1, to: 0.2 },
      duration: 80, yoyo: true, repeat: 3, onComplete: () => this.player.setAlpha(1)
    });
    if (this.state.hp <= 0 && !this.state.finished) { this.state.alive = false; this._lose(); }
  }



  _win() {
    if (this.state.finished) return;
    this.state.finished = true;
    this._freeze();
    // optional banner (keep it if you like)
    this._showBanner('YOU WIN!');
    this._goToScene('WinScene');        // <-- if your key is different, change here
  }

  _lose() {
    if (this.state.finished) return;
    this.state.finished = true;
    this._freeze();
    // optional banner
    this._showBanner('GAME OVER');
    this._goToScene('GameOverScene');   // <-- change to 'GaneOverScene' if that’s your key
  }


  _showBanner(text) {
    const t = this.add.text(this.W / 2, this.H / 2, text, {
      fontFamily: (this.registry.get('cfg')?.font?.family) || 'Arial',
      fontSize: '72px', color: '#ffffff', stroke: '#000', strokeThickness: 6
    }).setOrigin(0.5).setDepth(2000);
    this.tweens.add({ targets: t, scale: { from: 0.8, to: 1 }, duration: 350, ease: 'Back.Out' });
  }

  _freeze() {
    // stop any movement
    this.enemies.children.iterate(e => e?.body?.setVelocity(0, 0));
    this.shadows.children.iterate(s => s?.body?.setVelocity(0, 0));
    this.bullets.children.iterate(b => b?.body?.setVelocity(0, 0));

    // pause physics (prevents overlap iteration crash)
    this.physics.world?.pause?.();

    // destroy all overlap colliders
    if (this._colliders) {
      this._colliders.forEach(c => c?.destroy?.());
      this._colliders.length = 0;
    }

    this.sfx.bgm?.stop();
  }


  // ----------------- Mobile UI -----------------
  // ----------------- Mobile UI -----------------
  _makeButtons() {
    // --- Configurable sizing (pixels or relative) ---
    const G = (this.registry.get('cfg')?.gameplay) || {};
    const base = Math.min(this.W, this.H);

    // Overall button size (relative to screen). Example: 0.10 => 10% of min(width,height)
    // You can also pass an absolute px value via G.btnSizePx to override.
    const baseSize = Math.round(G.btnSizePx ?? ((G.btnSize ?? 0.09) * base));

    // Optional individual scales
    const upScale = Number(G.btnUpScale) || 1.0;
    const downScale = Number(G.btnDownScale) || 1.0;
    const actionScale = Number(G.btnActionScale) || 1.0;

    const sizeUp = Math.round(baseSize * upScale);
    const sizeDown = Math.round(baseSize * downScale);
    const sizeAct = Math.round(baseSize * actionScale);

    // Padding/spacing can also be config-driven
    const pad = Math.round(G.btnPadPx ?? (0.02 * base));       // default ~2% of screen
    const spacing = Math.round(G.btnSpacingPx ?? (0.018 * base));  // vertical gap between up & down

    // --- Layout ---
    const colX = Math.round(G.btnColX ?? 140);            // left column x
    const downY = Math.round(this.H - pad - sizeDown * 0.5);
    const upY = Math.round(downY - sizeUp - spacing);

    const actX = Math.round(G.btnActionX ?? (this.W - colX));
    const actY = Math.round(G.btnActionY ?? ((upY + downY) / 2));

    const mkBtn = (key, x, y, w, h, onDown, onUp) => {
      if (!this.textures.exists(key)) return null;

      const s = this.add.image(x, y, key)
        .setDisplaySize(w, h)
        .setInteractive({ useHandCursor: true })
        .setDepth(1000)
        .setScrollFactor(0);

      const pressOn = () => { s.setAlpha(0.85).setTint(0xE6E6E6); };
      const pressOff = () => { s.setAlpha(1).clearTint(); };

      s.on('pointerdown', (p) => { this._uiPointerId = p.id; pressOn(); onDown?.(); });
      s.on('pointerup', () => { pressOff(); onUp?.(); this._uiPointerId = null; });
      s.on('pointerout', () => { pressOff(); onUp?.(); this._uiPointerId = null; });

      return s;
    };

    // Build buttons with their individual sizes
    mkBtn('btn_up', colX, upY, sizeUp, sizeUp, () => (this._mobile.up = true), () => (this._mobile.up = false));
    mkBtn('btn_down', colX, downY, sizeDown, sizeDown, () => (this._mobile.down = true), () => (this._mobile.down = false));
    mkBtn('btn_action', actX, actY, sizeAct, sizeAct, () => {
      this._mobile.shoot = true;
      const now = this.time.now;
      if (now - this.state.lastShotAt >= (this.tune.fireCooldownMs * 0.5)) {
        this._fire(); this.state.lastShotAt = now;
      }
    }, () => (this._mobile.shoot = false));
  }




  _teardown() {
    try {
      if (this._colliders) {
        this._colliders.forEach(c => c?.destroy?.());
        this._colliders.length = 0;
      }
      this.time.removeAllEvents();
      this.tweens.killAll();
      this.sfx.bgm?.stop();
      this.physics.world?.pause?.();
      this.enemies?.clear(true, true);
      this.shadows?.clear(true, true);
      this.bullets?.clear(true, true);
    } catch (err) {
      console.warn('Teardown error:', err);
    }
  }

}
