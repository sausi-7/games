// GameScene.js — Bug Whack (tap-to-squash arcade)
// - Portrait play (1080x1920 friendly), but adapts to any canvas size
// - Tap/click bugs to squash them before they escape off-screen
// - Survive the timer; lose if too many bugs escape
// - Uses ONLY library assets defined in config.json (no fallbacks)
// - Accurate collider sizing = display size

class GameScene extends Phaser.Scene {
  constructor() { super('GameScene'); }

  preload() {
    const cfg = this.registry.get('cfg') || {};
    const img = (cfg.images || {});
    const aud = (cfg.audio || {});
    const font = (cfg.font || {});

    // Font (optional)
    // if (font.url) this.load.ttf('gamefont', font.url);

    // Images (ONLY from provided library keys)
    // Background: use a platform tile as a floor texture
    if (img.platform) this.load.image('platform', img.platform);

    // Bugs
    if (img.bugA) this.load.image('bugA', img.bugA);
    if (img.bugB) this.load.image('bugB', img.bugB);
    if (img.bugGold) this.load.image('bugGold', img.bugGold);

    // (Required UI assets for other scenes; not used here but must be loaded)
    this.load.image('htpbox', img.htpbox);
    this.load.image('ovrbox', img.ovrbox);
    this.load.image('replay', img.replay);
    this.load.image('lvl_replay', img.lvl_replay);
    this.load.image('lvlbox', img.lvlbox);
    this.load.image('next', img.next);
    this.load.image('playbtn', img.playbtn);

    // Audio
    if (aud.bgm) this.load.audio('bgm', aud.bgm);
    if (aud.collect) this.load.audio('squash', aud.collect);
    if (aud.explosion) this.load.audio('blast', aud.explosion);           // squash SFX
    if (aud.game_over) this.load.audio('lose', aud.game_over);
    if (aud.level_complete) this.load.audio('win', aud.level_complete);
  }

  create() {
    // ---- Config & dims
    this.cfg = this.registry.get('cfg') || {};
    const texts = this.cfg.texts || {};
    const gp = this.cfg.gameplay || {};

    this.W = (this.sys.game.config.width || 1080);
    this.H = (this.sys.game.config.height || 1920);

    // ---- World background (tile the platform image)
    // Using a TileSprite so it fills any canvas; purely visual (no collider)
    this.bg = this.add.tileSprite(0, 0, this.W, this.H, 'platform')
      .setOrigin(0, 0)
      .setAlpha(0.2);

    // ---- State
    this.state = {
      timeLeft: gp.timerSeconds ?? 60,
      score: 0,
      escapes: 0,
      escapeLimit: gp.escapeLimit ?? 10,
      finished: false
    };

    // ---- Physics groups
    this.bugs = this.physics.add.group();

    // ---- UI (score, timer, escapes)
    // ---- UI (score, timer, escapes) — styled HUD
    this._buildHUD = () => {
      const pad = 20;
      const hudW = Math.min(this.W - pad * 2, 1000);
      const hudH = 120;
      const hudX = this.W / 2 - hudW / 2;
      const hudY = 20;

      // Rounded backdrop
      const g = this.add.graphics().setDepth(999);
      g.fillStyle(0xffffff, 0.85);
      g.fillRoundedRect(hudX, hudY, hudW, hudH, 24);
      g.lineStyle(3, 0x222222, 0.6);
      g.strokeRoundedRect(hudX, hudY, hudW, hudH, 24);

      const fontFamily = (this.cfg.font && this.cfg.font.family) || 'Arial';
      const labelStyle = {
        fontFamily,
        fontSize: '38px',
        color: '#111',
        stroke: '#000000',
        strokeThickness: 2,
        shadow: { offsetX: 0, offsetY: 2, color: '#000000', blur: 6, fill: true },
      };
      const valueStyle = {
        fontFamily,
        fontSize: '52px',
        color: '#111',
        stroke: '#000000',
        strokeThickness: 3,
        shadow: { offsetX: 0, offsetY: 3, color: '#000000', blur: 8, fill: true },
      };

      const col = (i) => hudX + (i * (hudW / 3)) + 24;
      const centerY = hudY + hudH / 2;

      // SCORE
      const scoreLabel = this.add.text(col(0), centerY - 30, (this.cfg.texts?.score_label ?? 'Score:'), labelStyle).setDepth(1000);
      const scoreText = this.add.text(col(0), centerY + 4, '0', valueStyle).setDepth(1000);

      // TIME
      const timeLabel = this.add.text(col(1), centerY - 30, 'Time:', labelStyle).setDepth(1000);
      const timeText = this.add.text(col(1), centerY + 4, String(this.state.timeLeft), valueStyle).setDepth(1000);

      // ESCAPES
      const missLabel = this.add.text(col(2), centerY - 30, 'Escapes:', labelStyle).setDepth(1000);
      const missText = this.add.text(col(2), centerY + 4, `0/${this.state.escapeLimit}`, valueStyle).setDepth(1000);

      // Tighter layout by aligning to the same baselines
      [scoreLabel, timeLabel, missLabel].forEach(t => t.setOrigin(0, 1));
      [scoreText, timeText, missText].forEach(t => t.setOrigin(0, 0));

      // Keep refs
      this.ui = { scoreText, timeText, missText, hudGraphic: g };

      // Soft entrance animation
      this.tweens.add({
        targets: [scoreLabel, scoreText, timeLabel, timeText, missLabel, missText, g],
        alpha: { from: 0, to: 1 },
        y: '-=8',
        duration: 400,
        ease: 'quad.out',
        stagger: 30
      });
    };
    this._buildHUD();


    // ---- Input -> tap any bug to squash
    this.input.on('gameobjectdown', (pointer, gameObject) => {
      if (this.state.finished) return;
      if (!gameObject.getData('isBug')) return;
      this._squashBug(gameObject);
    });

    // Also allow tapping empty space to do nothing (no mis-taps logic needed)

    // ---- Audio
    this.snd = {
      bgm: this.sound.add('bgm', { loop: true, volume: 0.4 }),
      squash: this.sound.add('squash', { volume: 0.9 }),
      lose: this.sound.add('lose', { volume: 0.9 }),
      win: this.sound.add('win', { volume: 0.9 }),
    };
    if (this.snd.bgm) this.snd.bgm.play();

    // Particles for squash effects
    this.fx = {
      particlesA: this.add.particles('bugA').setDepth(50),
      particlesB: this.add.particles('bugB').setDepth(50),
      particlesG: this.add.particles('bugGold').setDepth(50),
    };


    // ---- Timers
    this.spawnCfg = {
      baseMs: gp.spawnMs ?? 900,
      minMs: gp.minSpawnMs ?? 350,
      accelEveryMs: gp.accelEveryMs ?? 7000,
      accelByMs: gp.accelByMs ?? 80,
      lastAccelAt: this.time.now
    };
    this.nextSpawnIn = this.spawnCfg.baseMs;

    this.timeEventTimer = this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        if (this.state.finished) return;
        this.state.timeLeft = Math.max(0, this.state.timeLeft - 1);
        this.ui.timeText.setText(String(this.state.timeLeft));
        this._popText(this.ui.timeText);

        if (this.state.timeLeft <= 0) {
          this._endGame(true);
        }
      }
    });
  }
  _popText(txt) {
    this.tweens.killTweensOf(txt);
    txt.setScale(1);
    this.tweens.add({
      targets: txt,
      scale: 1.12,
      duration: 90,
      yoyo: true,
      ease: 'quad.out'
    });
  }


  update(time, delta) {
    if (this.state.finished) return;

    // Gradually speed up spawns
    if (time - this.spawnCfg.lastAccelAt >= this.spawnCfg.accelEveryMs) {
      this.spawnCfg.lastAccelAt = time;
      this.spawnCfg.baseMs = Math.max(this.spawnCfg.minMs, this.spawnCfg.baseMs - this.spawnCfg.accelByMs);
    }

    // Spawn logic
    this.nextSpawnIn -= delta;
    if (this.nextSpawnIn <= 0) {
      this._spawnBug();
      this.nextSpawnIn = this.spawnCfg.baseMs;
    }

    // Move bugs and check for escapes
    this.bugs.children.iterate((bug) => {
      if (!bug) return;

      // Subtle jitter turn: occasionally adjust heading slightly
      const turnChance = bug.getData('turnChance') || 0.015;
      if (Math.random() < turnChance) {
        const ang = Phaser.Math.DegToRad(Phaser.Math.Between(-25, 25));
        bug.setData('vx', (bug.getData('vx') || 0) * Math.cos(ang) - (bug.getData('vy') || 0) * Math.sin(ang));
        bug.setData('vy', (bug.getData('vx') || 0) * Math.sin(ang) + (bug.getData('vy') || 0) * Math.cos(ang));
      }

      // Apply velocity based on stored vector
      const speed = bug.getData('speed') || 120;
      const vx = bug.getData('vx') || 0;
      const vy = bug.getData('vy') || 0;
      bug.body.setVelocity(vx * speed, vy * speed);

      // Face movement direction (optional visual flair)
      bug.rotation = Math.atan2(bug.body.velocity.y, bug.body.velocity.x);

      // Escape detection: once spawned inside bounds, if it leaves the padded game area -> escape
      const pad = 40;
      const inBounds = bug.x > pad && bug.x < (this.W - pad) && bug.y > pad && bug.y < (this.H - pad);
      if (inBounds) bug.setData('armed', true); // armed to count escape once it has entered

      const out =
        bug.x < -pad || bug.x > this.W + pad || bug.y < -pad || bug.y > this.H + pad;

      if (out && bug.getData('armed')) {
        this._onEscape(bug);
      }
    });
  }

  // ----- Helpers

  _spawnBug() {
    // Choose random edge (0=top,1=right,2=bottom,3=left)
    const edge = Phaser.Math.Between(0, 3);

    let x = 0, y = 0, vx = 0, vy = 0;
    const margin = 10;

    if (edge === 0) { x = Phaser.Math.Between(margin, this.W - margin); y = -margin; vx = Phaser.Math.FloatBetween(-0.4, 0.4); vy = 1; }
    if (edge === 2) { x = Phaser.Math.Between(margin, this.W - margin); y = this.H + margin; vx = Phaser.Math.FloatBetween(-0.4, 0.4); vy = -1; }
    if (edge === 1) { x = this.W + margin; y = Phaser.Math.Between(margin, this.H - margin); vx = -1; vy = Phaser.Math.FloatBetween(-0.4, 0.4); }
    if (edge === 3) { x = -margin; y = Phaser.Math.Between(margin, this.H - margin); vx = 1; vy = Phaser.Math.FloatBetween(-0.4, 0.4); }

    // Pick bug type (gold is rare)
    const roll = Math.random();
    let key = 'bugA', displayW = 80, displayH = 80, speed = 160, turnChance = 0.02, score = 1;
    if (roll > 0.8 && roll <= 0.97) { // bugB
      key = 'bugB'; displayW = 90; displayH = 90; speed = 130; turnChance = 0.012; score = 2;
    } else if (roll > 0.97) { // gold
      key = 'bugGold'; displayW = 100; displayH = 100; speed = 210; turnChance = 0.018; score = 5;
    }

    const bug = this.add.sprite(x, y, key).setInteractive({ useHandCursor: true });
    bug.setDisplaySize(displayW, displayH);
    this.physics.add.existing(bug);
    bug.body.setAllowGravity(false);
    bug.body.setSize(displayW, displayH); // collider matches display size

    bug.setData('isBug', true);
    bug.setData('speed', speed);
    bug.setData('score', score);
    bug.setData('turnChance', turnChance);
    bug.setData('vx', vx);
    bug.setData('vy', vy);
    bug.setDepth(5);

    this.bugs.add(bug);
  }

  _squashBug(bug) {
    // Score & feedback
    this.state.score += bug.getData('score') || 1;
    this.ui.scoreText.setText(`${(this.cfg.texts?.score_label ?? 'Score: ')}${this.state.score}`);

    if (this.snd.squash) this.snd.squash.play();

    // Tiny squash animation
    this.tweens.add({
      targets: bug,
      scaleX: 1.2, scaleY: 0.7, angle: Phaser.Math.Between(-25, 25),
      duration: 90,
      yoyo: true,
      onComplete: () => {
        bug.destroy();
      }
    });
  }


  _onEscape(bug) {
    bug.destroy();
    this.state.escapes += 1;
    this.ui.missText.setText(`${this.state.escapes}/${this.state.escapeLimit}`);
    this._popText(this.ui.missText);


    if (this.state.escapes >= this.state.escapeLimit) {
      this._endGame(false);
    }
  }

  _endGame(didWin) {
    this.state.finished = true;

    // stop motion
    this.bugs.children.iterate((bug) => { if (bug && bug.body) bug.body.setVelocity(0, 0); });
    if (this.snd.bgm) this.snd.bgm.stop();
    if (didWin && this.snd.win) this.snd.win.play();
    if (!didWin && this.snd.lose) this.snd.lose.play();

    const payload = {
      score: this.state.score,
      escapes: this.state.escapes,
      won: didWin,
      timeLeft: this.state.timeLeft
    };

    // Keep for other systems if needed
    this.registry.set('lastResult', payload);

    // 🔁 Go to the appropriate scene
    if (didWin) {
      this.scene.start('WinScene', payload);
    } else {
      this.scene.start('GameOverScene', payload);
    }
  }

}
