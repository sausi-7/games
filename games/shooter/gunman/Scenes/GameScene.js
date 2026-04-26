// GameScene.js — Gun Master (Level 1) — pure gameplay only (portrait-ready)
// - Upward oscillating aim (visual line only)
// - Tap/click/Space/Enter OR mobile Action button fires a BULLET (limited)
// - Bullet limit shown in HUD; configurable via config.json: gameplay.bulletLimit
// - 3 grunts (1 HP) then a mini-boss (3 HP); boss takes 3 bullet hits
// - Uses config.json assets if present (fallback rectangles otherwise)

class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameScene', physics: { arcade: { gravity: { y: 0 }, debug: false } } });

    // Removed: score
    this.state = { level: 1, waveIndex: 0, bossHP: 3, shotsLeft: 15, finished: false };

    // Refs
    this.cfg = null;
    this.W = 1080; this.H = 1920;
    // Removed: coins group
    this.groups = { enemies: null, bullets: null, fx: null };
    // Removed: collect sfx
    this.sfx = { bgm: null, hit: null, shoot: null, empty: null };
    // Removed: scoreText
    this.ui = { waveText: null, bulletsText: null };
    this.player = null;
    this.aim = { line: null, anchor: null, t: 0, speed: 1.25, min: -135, max: -45, currAngle: -90 };
    this.mobile = { action: null, pressing: false };
    this._colliders = [];

    Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach(fn => {
      if (typeof this[fn] === 'function' && fn !== 'constructor') this[fn] = this[fn].bind(this);
    });
  }

  // ---------- Utilities
  _has(key) { return this.textures.exists(key); }
  _fallbackRect(key, w, h, color = 0x8888ff) {
    if (this._has(key)) return key;
    const gk = key + '_fb';
    if (!this._has(gk)) {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      g.fillStyle(color, 1).fillRoundedRect(0, 0, w, h, 12);
      g.generateTexture(gk, w, h);
      g.destroy();
    }
    return gk;
  }

  _ensureParticleTexture() {
    const key = 'fx_circle';
    if (this.textures.exists(key)) return key;
    const r = 8;
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(0xffffff, 1);
    g.fillCircle(r, r, r);
    g.generateTexture(key, r * 2, r * 2);
    g.destroy();
    return key;
  }

  // Shard-based blast (no createEmitter needed)
  _explode(x, y, isBoss = false) {
    const key = this._ensureParticleTexture();
    const pieces = isBoss ? 18 : 12;

    for (let i = 0; i < pieces; i++) {
      let p = this.groups.fx.get(x, y, key);
      if (!p) continue;
      p.setActive(true).setVisible(true).setDepth(9);
      p.setDisplaySize(isBoss ? 18 : 14, isBoss ? 18 : 14);
      p.setBlendMode('ADD');
      p.setAlpha(1);
      p.setScale(0.7);
      p.body.allowGravity = false;

      const speed = Phaser.Math.Between(isBoss ? 220 : 160, isBoss ? 480 : 320);
      const ang = Phaser.Math.FloatBetween(0, Math.PI * 2);
      p.setVelocity(Math.cos(ang) * speed, Math.sin(ang) * speed);
      p.setAngularVelocity(Phaser.Math.Between(-360, 360));
      p.setDrag(240, 240);

      const life = Phaser.Math.Between(300, 650);
      this.tweens.add({
        targets: p,
        alpha: 0,
        scale: 0,
        duration: life,
        onComplete: () => { try { p.destroy(); } catch (e) { } }
      });
    }

    this.cameras.main.shake(isBoss ? 90 : 60, isBoss ? 0.004 : 0.003);
  }

  _maybeGameOverOnAmmo(delayMs = 0) {
    const delay = Math.max(0, delayMs);
    this.time.delayedCall(delay, () => {
      if (this.state.finished) return;
      const enemiesAlive = this.groups.enemies?.countActive(true) || 0;
      const bulletsInFlight = this.groups.bullets?.countActive(true) || 0;
      if (this.state.shotsLeft <= 0 && enemiesAlive > 0 && bulletsInFlight === 0) {
        this.state.finished = true;
        this.scene.start('GameOverScene'); // removed score param
      }
    });
  }

  init() {
    // re-init runtime state on every start (incl. Replay)
    this.state.level = 1;
    this.state.waveIndex = 0;   // start from first grunt again
    this.state.bossHP = 3;      // reset boss hp
    this.state.finished = false;
  }


  // ---------- Phaser lifecycle
  preload() {
    const cfg = this.registry.get('cfg') || {};
    const images = (cfg.images1 || {});
    const ui = (cfg.ui || {});
    const images2 = (cfg.images2 || {});
    const audio = (cfg.audio || {});
    this.cfg = cfg;

    Object.entries(images).forEach(([k, url]) => { if (!this.textures.exists(k)) this.load.image(k, url); });
    Object.entries(ui).forEach(([k, url]) => { if (!this.textures.exists(k)) this.load.image(k, url); });
    Object.entries(images2).forEach(([k, url]) => { if (!this.textures.exists(k)) this.load.image(k, url); });
    Object.entries(audio).forEach(([k, url]) => { if (!this.cache.audio.exists(k)) this.load.audio(k, url); });
  }

  create() {
    const cam = this.sys.cameras.main;
    this.W = cam.width; this.H = cam.height;

    const G = (this.cfg.gameplay || {});
    const I = (this.cfg.images2 || {});
    const A = (this.cfg.audio || {});
    const T = (this.cfg.texts || {});
    const fontFamily = (this.cfg.font && this.cfg.font.family) ? this.cfg.font.family : 'Outfit, Arial';
    // Ensure fresh state on replay (safety even if init() ran)
    this.state.waveIndex = 0;
    this.state.bossHP = 3;
    this.state.finished = false;

    // Apply bullet limit from config each run
    this.state.shotsLeft = (G.bulletLimit ?? 15);

    // Apply bullet limit from config (default 15)
    this.state.shotsLeft = (G.bulletLimit ?? 15);

    // BG
    if (I.background && this._has('background')) {
      this.add.image(this.W * 0.5, this.H * 0.5, 'background').setDisplaySize(this.W, this.H).setDepth(-10);
    } else {
      this.cameras.main.setBackgroundColor('#0b1220');
    }

    // Groups (Arcade)
    this.groups.enemies = this.physics.add.group({ allowGravity: false, immovable: true });
    this.groups.bullets = this.physics.add.group({ allowGravity: false, maxSize: 60 });
    this.groups.fx = this.physics.add.group({ allowGravity: false });

    // Audio
    this.sfx.bgm = A.bgm ? this.sound.add('bgm', { loop: true, volume: 0.35 }) : null;
    this.sfx.shoot = A.attack ? this.sound.add('attack', { volume: 0.6 }) : null;
    this.sfx.hit = A.hit ? this.sound.add('hit', { volume: 0.7 }) : null;
    this.sfx.empty = A.empty ? this.sound.add('empty', { volume: 0.6 }) : null;
    if (this.sfx.bgm) this.sfx.bgm.play();

    // Shooter (bottom center)
    const shooterKey = this._fallbackRect('player', 120, 120, 0x3a86ff);
    this.player = this.add.image(this.W * 0.5, Math.round(this.H * 0.85), shooterKey)
      .setDepth(1).setDisplaySize(220, 280);

    // Aim line (visual)
    this.aim.anchor = new Phaser.Math.Vector2(this.player.x, this.player.y);
    this.aim.line = this.add.line(0, 0, 0, 0, 0, -300, 0xffffff, 1)
      .setOrigin(0.5, 0).setLineWidth(6, 6).setDepth(2);
    this.aim.speed = (G.aimSpeed || 1.25);
    this.aim.min = Phaser.Math.DegToRad(G.aimMinDeg ?? -135);
    this.aim.max = Phaser.Math.DegToRad(G.aimMaxDeg ?? -45);

    // HUD (Removed score text)
    // HUD — glossy pills, aligned baseline (top margin 34px)
    const pad = 26;
    const topY = 34 + 28; // baseline align for both pills

    // Left pill: Enemies
    this.ui.wavePill = this._makePill(0, 0, 380, 64);
    this.ui.waveText = this._makeHudText('👾 Enemies: 1/4');
    this.ui.waveText.setPosition(0, 0);
    this.ui.wavePill.add(this.ui.waveText);
    this.ui.wavePill.setPosition(pad + this.ui.wavePill.w / 2, topY);

    // Right pill: Bullets
    this.ui.bulletsPill = this._makePill(0, 0, 340, 64, 0x0f172a, 0.65, 0x22c55e);
    this.ui.bulletsText = this._makeHudText(`🔫 Bullets: ${this.state.shotsLeft}`);
    this.ui.bulletsText.setPosition(0, 0);
    this.ui.bulletsPill.add(this.ui.bulletsText);
    this.ui.bulletsPill.setPosition(this.W - (pad + this.ui.bulletsPill.w / 2), topY);


    // Inputs
    this.input.on('pointerdown', this._onShoot, this);
    if (this.input.keyboard) {
      this.input.keyboard.on('keydown-SPACE', this._onShoot);
      this.input.keyboard.on('keydown-ENTER', this._onShoot);
    }

    // Mobile Action button
    const actionKey = this._fallbackRect('action', 140, 140, 0x66cc66);
    this.mobile.action = this.add.image(this.W - 40, this.H - 40, actionKey)
      .setOrigin(1, 1).setInteractive({ useHandCursor: true }).setScrollFactor(0).setDepth(1000).setAlpha(0.92);
    this.mobile.action.displayWidth = 140; this.mobile.action.displayHeight = 140;
    this.mobile.action.on('pointerdown', (p) => {
      p.event?.stopPropagation?.();
      this._onShoot();
      this.tweens.add({ targets: this.mobile.action, scale: 0.95, duration: 70, yoyo: true });
    });

    // Bullet ↔ Enemy overlap
    const ov = this.physics.add.overlap(this.groups.bullets, this.groups.enemies, this._onBulletHitEnemy, null, this);
    this._colliders.push(ov);

    // Cleanup hooks
    this.events.once('shutdown', this.shutdown);
    this.events.once('destroy', this.destroy);

    // First enemy
    this._spawnNext();
  }

  update(time, delta) {
    if (this.state.finished) return;

    // Sweep aim (triangle wave)
    const range = (this.aim.max - this.aim.min);
    this.aim.t += (delta / 1000) * this.aim.speed;
    const tri = 1 - Math.abs(((this.aim.t % 2)) - 1); // 0..1..0
    const angle = this.aim.min + tri * range;
    this.aim.currAngle = angle;

    // Short aim line
    const len = 220;
    const ex = this.aim.anchor.x + Math.cos(angle) * len;
    const ey = this.aim.anchor.y + Math.sin(angle) * len;
    this.aim.line.setTo(this.aim.anchor.x, this.aim.anchor.y, ex, ey);
  }



  // ---------- Core mechanics
  _onShoot() {
    if (this.state.finished) return;

    // Enforce bullet limit
    if (this.state.shotsLeft <= 0) {
      this.sfx.empty?.play();
      this.tweens.add({
        targets: this.ui.bulletsText,
        color: '#ff4444',
        duration: 80,
        yoyo: true,
        repeat: 2,
        onComplete: () => this.ui.bulletsText.setColor('#ffffff')
      });
      this._maybeGameOverOnAmmo(0);
      return;
    }

    this.state.shotsLeft--;
    this._refreshBulletHUD();

    this.sfx.shoot?.play();
    this._fireBullet(this.aim.currAngle);

    if (this.state.shotsLeft === 0) {
      const life = (this.cfg.gameplay && this.cfg.gameplay.bulletLifeMs) || 1200;
      this._maybeGameOverOnAmmo(life + 80);
    }
  }

  _refreshBulletHUD() {
  if (this.ui.bulletsText) this.ui.bulletsText.setText(`🔫 Bullets: ${this.state.shotsLeft}`);
}


  _fireBullet(angleRad) {
    const S = (this.cfg.gameplay && this.cfg.gameplay.bulletSpeed) || 1200;
    const LIFE = (this.cfg.gameplay && this.cfg.gameplay.bulletLifeMs) || 1200;

    const bulletKey = this._fallbackRect('bullet', 16, 16, 0xfff275);
    let b = this.groups.bullets.get(this.player.x, this.player.y, bulletKey);
    if (!b) return;

    b.setActive(true).setVisible(true).setDepth(3);
    b.setDisplaySize(16, 16);
    b.body.allowGravity = false;
    b.setCircle(8, 0, 0);

    const vx = Math.cos(angleRad) * S;
    const vy = Math.sin(angleRad) * S;
    b.setVelocity(vx, vy);

    this.time.delayedCall(LIFE, () => { if (b && b.active) b.destroy(); });
  }

  _onBulletHitEnemy(bullet, enemy) {
    if (bullet?.active) bullet.destroy();
    if (!enemy || !enemy.active) return;

    const isBoss = (enemy.getData('type') === 'boss');

    if (isBoss) {
      let hp = (enemy.getData('hp') || 1) - 1;
      enemy.setData('hp', hp);
      this.sfx.hit?.play();
      if (hp <= 0) {
        this._explode(enemy.x, enemy.y, true);
        enemy.destroy();
        this._advanceWave();
      }
    } else {
      this._explode(enemy.x, enemy.y, false);
      this.sfx.hit?.play();
      enemy.destroy();
      this._advanceWave();
    }
  }

  _advanceWave() {
    if (this.state.waveIndex < 3) {
      this.state.waveIndex++;
      this._spawnNext();
    } else {
      this.state.finished = true;
      this.time.delayedCall(350, () => {
        if (this.scene.isActive('GameScene')) this.scene.start('WinScene'); // removed score param
      });
    }
  }

  _spawnNext() {
    const isBoss = (this.state.waveIndex >= 3);
    const enemyKey = isBoss ? 'enemy_boss' : 'enemy';
    const key = this._fallbackRect(enemyKey, isBoss ? 180 : 120, isBoss ? 180 : 120, isBoss ? 0xff6b6b : 0xffd166);

    const padX = 160, padYTop = 220, padYBot = Math.floor(this.H * 0.45);
    const ex = Phaser.Math.Between(padX, this.W - padX);
    const ey = Phaser.Math.Between(padYTop, padYBot);

    const e = this.physics.add.image(ex, ey, key).setDepth(3);
    e.setDisplaySize(isBoss ? 180 : 120, isBoss ? 180 : 120);
    e.body.allowGravity = false; e.setImmovable(true);
    // const r = Math.max(e.displayWidth, e.displayHeight) * 0.35;
    // e.setCircle(r, e.displayWidth * 0.5 - r, e.displayHeight * 0.5 - r);

    e.setData('type', isBoss ? 'boss' : 'grunt');
    if (isBoss) {
      const hp = this.state.bossHP;
      e.setData('hp', hp);
      // no pulsing tween for boss
    }
    this.groups.enemies.add(e);

    const total = 4; const current = Math.min(this.state.waveIndex + 1, total);
    const fontFamily = (this.cfg.font && this.cfg.font.family) ? this.cfg.font.family : 'Outfit, Arial';
    this.ui.waveText.setText(`👾 Enemies: ${current}/${total}`);
    
  }

  // ---------- Cleanup (robust for Replay)
  shutdown() {
    if (this.input) {
      this.input.off('pointerdown', this._onShoot, this);
      if (this.input.keyboard) {
        this.input.keyboard.off('keydown-SPACE', this._onShoot);
        this.input.keyboard.off('keydown-ENTER', this._onShoot);
      }
    }
    this._colliders.forEach(c => { try { c.destroy(); } catch (e) { } });
    this._colliders = [];

    if (this.time) this.time.removeAllEvents();
    if (this.tweens) this.tweens.killAll();

    if (this.sfx?.bgm) { this.sfx.bgm.stop(); this.sfx.bgm.destroy(); this.sfx.bgm = null; }

    try { this.aim.line?.destroy(); } catch (e) { }
    this.aim.line = null;

    try { this.mobile.action?.destroy(); } catch (e) { }
    this.mobile.action = null;

    try { this.player?.destroy(); } catch (e) { }
    this.player = null;

    const clearG = (g) => { try { g?.clear(true, true); } catch (e) { } };
    clearG(this.groups?.bullets);
    clearG(this.groups?.enemies);
    clearG(this.groups?.fx);
    this.groups = { enemies: null, bullets: null, fx: null };

    // Removed scoreText cleanup
    try { this.ui.waveText?.destroy(); } catch (e) { }
    try { this.ui.bulletsText?.destroy(); } catch (e) { }
    this.ui = { waveText: null, bulletsText: null };
  }

  destroy() {
    this.shutdown();
    if (super.destroy) super.destroy();
  }

  // ---------- HUD helpers
  _makePill(x, y, w, h, tint = 0x111827, alpha = 0.65, stroke = 0x2563eb) {
    const g = this.add.graphics().setDepth(4).setScrollFactor(0);
    g.fillStyle(tint, alpha).fillRoundedRect(-w / 2, -h / 2, w, h, 16);
    g.lineStyle(2, stroke, 0.9).strokeRoundedRect(-w / 2, -h / 2, w, h, 16);
    const c = this.add.container(x, y, [g]).setDepth(4).setScrollFactor(0);
    c.bg = g; c.w = w; c.h = h;
    return c;
  }

  _makeHudText(str) {
    const fontFamily = (this.cfg?.font?.family) ? this.cfg.font.family : 'Outfit, Arial';
    return this.add.text(0, 0, str, {
      fontFamily,
      fontSize: 36,
      color: '#e5efff',
      stroke: '#0b1220',
      strokeThickness: 4
    })
      .setDepth(5)
      .setShadow(0, 2, '#000000', 6, true, true)
      .setOrigin(0.5, 0.5)
      .setScrollFactor(0);
  }

}

// export default GameScene;
