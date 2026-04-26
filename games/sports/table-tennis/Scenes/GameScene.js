class GameScene extends Phaser.Scene {
  constructor() { super('GameScene'); }

  preload() {
    const cfg = this.registry.get('cfg') || {};
    const imgs = cfg.images || {};
    const imgs2 = cfg.images2 || {};
    const ui = cfg.ui || {};
    const audio = cfg.audio || {};
    const font = cfg.font || {};

    // Load images2 (secondary images)
    for (const [key, url] of Object.entries(imgs2)) {
      if (url) this.load.image(key, url);
    }

    // Load UI images
    for (const [key, url] of Object.entries(ui)) {
      if (url) this.load.image(key, url);
    }

    // Core images (library assets)
    if (imgs2.background) this.load.image('background', imgs2.background);
    if (imgs2.platform) this.load.image('paddle', imgs2.platform);
    if (imgs.ball) this.load.image('ball', imgs.ball);
    if (imgs.power_speed) this.load.image('power_speed', imgs.power_speed);
    if (imgs.power_grow) this.load.image('power_grow', imgs.power_grow);
    if (imgs.power_shrink) this.load.image('power_shrink', imgs.power_shrink);
    if (imgs.power_multi) this.load.image('power_multi', imgs.power_multi);

    // Mobile controls
    if (ui.left) this.load.image('btn_left', ui.left);
    if (ui.right) this.load.image('btn_right', ui.right);
    if (ui.action) this.load.image('btn_action', ui.action);

    // Mandatory UI overlays
    if (ui.htpbox) this.load.image('htpbox', ui.htpbox);
    if (ui.ovrbox) this.load.image('ovrbox', ui.ovrbox);
    if (ui.replay) this.load.image('replay', ui.replay);
    if (ui.lvl_replay) this.load.image('lvl_replay', ui.lvl_replay);
    if (ui.lvlbox) this.load.image('lvlbox', ui.lvlbox);
    if (ui.next) this.load.image('next', ui.next);
    if (ui.playbtn) this.load.image('playbtn', ui.playbtn);

    // Audio
    if (audio.bgm) this.load.audio('bgm', audio.bgm);
    if (audio.hit) this.load.audio('sfx_hit', audio.hit);
    if (audio.collect) this.load.audio('sfx_collect', audio.collect);
    if (audio.score || audio.level_complete)
      this.load.audio('sfx_score', audio.score || audio.level_complete);
    if (audio.game_over) this.load.audio('sfx_lose', audio.game_over);
    if (audio.level_complete) this.load.audio('sfx_win', audio.level_complete);

    // Font (optional)
    // if (font.url) this.load.ttf('gamefont', font.url);
  }


  create() {
    this.cfg = this.registry.get('cfg') || {};
    this.gp = Object.assign({
      targetScore: 7,
      paddle: { width: 26, height: 160, speed: 620 }, // smaller player paddle & slight speed bump
      // Tougher ball baseline
      ball: { size: 28, speed: 600, speedIncPerHit: 22, maxSpeed: 1200, minExitAngleDeg: 12 },
      // Smarter, faster AI
      ai: { speed: 740, reactDelayMs: 36, missJitter: 6 },
      power: { spawnEveryMs: 7000, maxOnField: 1, durationMs: 6000 },
      arenaInset: 40
    }, this.cfg.gameplay || {});

    // --- World & background ---
    const W = 1920, H = 1080;
    this.W = W; this.H = H;
    this.add.image(W / 2, H / 2, 'background').setDisplaySize(W, H);

    // Decorative center net
    this._drawCenterNet();

    // World bounds + top/bottom walls
    this.physics.world.setBounds(0, 0, W, H);
    this.topWall = this.add.rectangle(W / 2, this.gp.arenaInset / 2, W, this.gp.arenaInset);
    this.botWall = this.add.rectangle(W / 2, H - this.gp.arenaInset / 2, W, this.gp.arenaInset);
    this.physics.add.existing(this.topWall, true);
    this.physics.add.existing(this.botWall, true);

    // --- Paddles ---
    this.player = this.add.sprite(80, H / 2, 'paddle');
    this.player.setDisplaySize(this.gp.paddle.width, this.gp.paddle.height + 80);
    this.physics.add.existing(this.player);
    this.player.body.setImmovable(true).setAllowGravity(false);
    this.player.body.setSize(this.gp.paddle.width, this.gp.paddle.height);

    this.player.baseHeight = this.player.displayHeight;

    this.ai = this.add.sprite(W - 80, H / 2, 'paddle');
    this.ai.setDisplaySize(this.gp.paddle.width, this.gp.paddle.height + 80);
    this.physics.add.existing(this.ai);
    this.ai.body.setImmovable(true).setAllowGravity(false);
    this.ai.body.setSize(this.gp.paddle.width, this.gp.paddle.height);

    this.ai.baseHeight = this.ai.displayHeight;

    // --- Ball group (supports MultiBall) ---
    this.balls = this.add.group();
    this._spawnBall(1);

    // --- Power-ups ---
    this.powers = this.add.group();
    this.lastPowerAt = 0;

    // --- Input ---
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys('W,S,SPACE');

    // Mobile buttons
    this._mkMobileControls();

    // --- Collisions ---
    this.physics.add.collider(this.balls, this.topWall, this._bounceWall, null, this);
    this.physics.add.collider(this.balls, this.botWall, this._bounceWall, null, this);
    this.physics.add.collider(this.balls, this.player, this._hitPaddle, null, this);
    this.physics.add.collider(this.balls, this.ai, this._hitPaddle, null, this);
    this.physics.add.overlap(this.balls, this.powers, this._takePower, null, this);

    // --- Scoring state ---
    this.state = { player: 0, ai: 0, finished: false };
    this.add.image(960, 100, 'scoreback').setScale(1.2, 1)

    // --- UI: Score + Announce + Flash overlay ---
    const fontFamily = (this.cfg.font && this.cfg.font.family) || 'Arial';
    this.ui = {
      scoreText: this.add.text(W / 2, this.gp.arenaInset + 30, 'Player 0 : 0 AI', {
        fontFamily, fontSize: '50px', color: '#070505ff'
      }).setOrigin(0.5, 0),
      infoText: this.add.text(W / 2, H * 0.08 + 150, '', {
        fontFamily, fontSize: '58px', color: '#ffff66', stroke: '#000000', strokeThickness: 6
      }).setOrigin(0.5).setAlpha(0),
      flash: this.add.rectangle(W / 2, H / 2, W, H, 0xffffff, 0).setDepth(1000)
    };

    // --- Audio ---
    this.sfx = {
      hit: this.sound.add('sfx_hit', { volume: 0.9 }),
      collect: this.sound.add('sfx_collect', { volume: 0.8 }),
      score: this.sound.add('sfx_score', { volume: 0.9 }),
      lose: this.sound.add('sfx_lose', { volume: 0.9 }),
      win: this.sound.add('sfx_win', { volume: 0.95 })
    };
    this.bgm = this.sound.add('bgm', { loop: true, volume: 0.55 });
    this.bgm.play();

    // --- AI helpers ---
    this._aiDelayUntil = 0;
    this._aiTargetY = H / 2;

    // Tiny particle manager for hit/score bursts (re-uses 'ball' texture)
    this.pfx = this.add.particles(0, 0, 'ball', {
      x: -1000, y: -1000,
      speed: { min: 60, max: 160 },
      lifespan: 350,
      quantity: 0,
      scale: { start: 0.35, end: 0 },
      emitting: false
    });

    // Difficulty ramp timers
    this._lastRampAt = 0;

    // Cleanup on pause/blur
    this.events.on('shutdown', () => { this.sound.stopAll(); });
    this.events.on('destroy', () => { this.sound.stopAll(); });
  }

  update(time, delta) {
    if (this.state.finished) return;

    const dt = delta / 1000;

    // Player movement (explicit y-position control)
    const up = (this.cursors.up.isDown || this.keys.W.isDown || this._mobile.up);
    const down = (this.cursors.down.isDown || this.keys.S.isDown || this._mobile.down);

    let vy = 0;
    if (up) vy = -this.gp.paddle.speed;
    else if (down) vy = this.gp.paddle.speed;

    this.player.body.setVelocity(0, 0);
    this.player.y += vy * dt;
    this._clampPaddle(this.player);

    // AI movement
    this._updateAI(time, dt);

    // Scoring (ball leaves left/right)
    this.balls.getChildren().forEach(ball => {
      if (!ball.active) return;
      if (ball.x < -50) this._score('ai', ball);
      else if (ball.x > this.W + 50) this._score('player', ball);
    });

    // Power-up spawning
    if (this.powers.getLength() < this.gp.power.maxOnField) {
      if (time - this.lastPowerAt > this.gp.power.spawnEveryMs) {
        this._spawnPower();
        this.lastPowerAt = time;
      }
    }

    // Subtle difficulty ramp every 7s
    if (time - this._lastRampAt > 7000) {
      this._lastRampAt = time;
      this.gp.ai.speed = Math.min(this.gp.ai.speed + 18, 980);
      this.balls.getChildren().forEach(b => {
        if (!b.active) return;
        const v = b.body.velocity.clone().scale(1.03);
        const cap = this.gp.ball.maxSpeed;
        b.body.setVelocity(
          Phaser.Math.Clamp(v.x, -cap, cap),
          Phaser.Math.Clamp(v.y, -cap, cap)
        );
        b._speedMag = Math.min((b._speedMag || this.gp.ball.speed) * 1.03, cap);
      });
    }
  }

  // ---- Helpers ----
  _spawnBall(direction = 1) {
    const b = this.add.sprite(this.W / 2, this.H / 2, 'ball');
    b.setScale(0.2)
    // b.setDisplaySize(this.gp.ball.size, this.gp.ball.size);
    this.physics.add.existing(b);
    b.body.setAllowGravity(false);

    const r = this.gp.ball.size / 2;
    b.body.setCircle(r * 7);
    b.body.setBounce(1, 1);
    b.body.setCollideWorldBounds(false);

    const angle = Phaser.Math.Between(-25, 25);
    const speed = this.gp.ball.speed;
    const vx = speed * direction;
    const vy = speed * Math.tan(Phaser.Math.DegToRad(angle));
    b.body.setVelocity(vx, vy);
    b._speedMag = speed;

    this.balls.add(b);
    return b;
  }

  _bounceWall(ball) {
    if (this.sfx.hit) this.sfx.hit.play({ volume: 0.6 });
  }

  _hitPaddle(ball, paddle) {
    if (this.sfx.hit) this.sfx.hit.play({ volume: 0.9 });

    const offset = Phaser.Math.Clamp((ball.y - paddle.y) / (paddle.displayHeight / 2), -1, 1);
    const inc = this.gp.ball.speedIncPerHit;
    const speed = Math.min((ball._speedMag + inc) * 1.04, this.gp.ball.maxSpeed);
    ball._speedMag = speed;

    const dir = (paddle === this.player) ? 1 : -1;
    const rawAngle = offset * 60;
    const minA = this.gp.ball.minExitAngleDeg;
    const angle = Phaser.Math.Clamp(rawAngle, -60, 60);
    const finalAngle = (Math.abs(angle) < minA) ? (minA * Math.sign(angle || 1)) : angle;

    const rad = Phaser.Math.DegToRad(finalAngle);
    const vx = Math.cos(rad) * speed * dir;
    const vy = Math.sin(rad) * speed;
    ball.body.setVelocity(vx, vy);

    // FX
    this._paddlePop(paddle);
    this._flash(0.08);
    this._burst(ball.x, ball.y, 12);
    this._announceOnce('Nice hit!', '#66ff99', 320);
  }

  _score(side, ball) {
    if (ball.active) ball.destroy();
    if (this.sfx.score) this.sfx.score.play();

    if (side === 'player') this.state.player += 1;
    else this.state.ai += 1;

    this._updateScoreText();

    const msg = (side === 'player') ? 'Player scores!' : 'AI scores!';
    const color = (side === 'player') ? '#a8ff5a' : '#ff7a7a';
    this._announceOnce(msg, color, 900);
    this._flash(0.18);
    this._burst(this.W / 2, this.H / 2, 24);

    // Win/Lose check + scene transition
    if (this.state.player >= this.gp.targetScore) {
      this.state.finished = true;
      this.bgm.stop();
      if (this.sfx.win) this.sfx.win.play();
      this.time.delayedCall(800, () => this._endGame('WinScene'));
      return;
    }
    if (this.state.ai >= this.gp.targetScore) {
      this.state.finished = true;
      this.bgm.stop();
      if (this.sfx.lose) this.sfx.lose.play();
      this.time.delayedCall(800, () => this._endGame('GameOverScene'));
      return;
    }

    // Re-serve after brief delay and ramp AI slightly
    this.time.delayedCall(700, () => {
      const dir = (side === 'player') ? -1 : 1;
      this._spawnBall(dir);
      this.gp.ai.speed = Math.min(this.gp.ai.speed + 14, 980);
    });
  }

  _updateScoreText() {
    this.ui.scoreText.setText(`Player ${this.state.player} : ${this.state.ai} AI`);
  }

  _clampPaddle(p) {
    const half = p.displayHeight * 0.5;
    const top = this.gp.arenaInset + half;
    const bot = this.H - this.gp.arenaInset - half;
    if (p.y < top) p.y = top;
    if (p.y > bot) p.y = bot;
  }

  _updateAI(time, dt) {
    if (time < this._aiDelayUntil) return;

    const balls = this.balls.getChildren().filter(b => b.active);
    if (balls.length === 0) return;

    // choose the ball heading to AI (vx > 0); else pick closest to AI in x
    let candidate = null;
    let minDx = Infinity;
    for (const b of balls) {
      const vx = b.body.velocity.x;
      const dx = (this.ai.x - b.x);
      if (vx > 0) { // coming toward AI
        if (dx >= 0 && dx < minDx) { minDx = dx; candidate = b; }
      }
    }
    if (!candidate) {
      candidate = balls.reduce((a, b) => (Math.abs(this.ai.x - b.x) < Math.abs(this.ai.x - a.x) ? b : a), balls[0]);
    }

    // Predict intercept Y at AI x (considering wall bounces)
    const targetX = this.ai.x - (this.gp.paddle.width * 0.5) - (this.gp.ball.size * 0.5) - 2;
    const predictedY = this._predictInterceptY(candidate, targetX);

    // Add slight imperfection
    const jitter = Phaser.Math.Between(-this.gp.ai.missJitter, this.gp.ai.missJitter);
    const desiredY = Phaser.Math.Clamp(predictedY + jitter, this.gp.arenaInset + 60, this.H - this.gp.arenaInset - 60);

    const dy = desiredY - this.ai.y;
    const dir = Math.sign(dy);

    this.ai.body.setVelocity(0, 0);
    this.ai.y += dir * this.gp.ai.speed * dt;
    this._clampPaddle(this.ai);

    this._aiDelayUntil = time + this.gp.ai.reactDelayMs;
  }

  // Predict y when ball reaches x=targetX, assuming infinite vertical reflections between top/bottom
  _predictInterceptY(ball, targetX) {
    const vx = ball.body.velocity.x;
    const vy = ball.body.velocity.y;
    const bx = ball.x;
    const by = ball.y;

    // if not moving toward target X, fallback to current y
    if (vx <= 0) return by;

    const dx = targetX - bx;
    const t = dx / vx; // time to reach targetX

    // effective vertical bounds (inside arena inset)
    const r = this.gp.ball.size * 0.5;
    const top = this.gp.arenaInset + r;
    const bottom = this.H - this.gp.arenaInset - r;
    const range = bottom - top;

    // straight-line projected y
    const yProj = by + vy * t;

    // reflect using triangle wave
    const norm = (yProj - top) / range;
    const k = Math.floor(norm);
    const frac = norm - k;
    // if k is even => going down segment, odd => reflected up
    const goingUp = (k % 2) !== 0;
    const yReflected = goingUp ? (bottom - frac * range) : (top + frac * range);

    return Phaser.Math.Clamp(yReflected, top, bottom);
  }

  _spawnPower() {
    const kinds = ['speed', 'grow', 'shrink', 'multi'];
    const kind = kinds[Phaser.Math.Between(0, kinds.length - 1)];
    const key = `power_${kind}`;
    const x = Phaser.Math.Between(this.W * 0.35, this.W * 0.65);
    const y = Phaser.Math.Between(this.gp.arenaInset + 120, this.H - this.gp.arenaInset - 120);

    const p = this.add.sprite(x, y, key);
    p.setDisplaySize(100, 100);
    this.physics.add.existing(p);
    p.body.setAllowGravity(false);
    p.body.setSize(300, 300); // collider matches display size (fix)
    p._kind = kind;
    this.powers.add(p);

    // Despawn after a while
    this.time.delayedCall(7000, () => { if (p.active) p.destroy(); });
  }

  _takePower(ball, power) {
    if (!power.active) return;
    power.destroy();
    if (this.sfx.collect) this.sfx.collect.play();

    const grantToPlayer = (ball.body.velocity.x > 0);
    if (grantToPlayer) this._applyPowerTo('player', power._kind, ball);
    else this._applyPowerTo('ai', power._kind, ball);
  }

  _applyPowerTo(side, kind, ballRef) {
    switch (kind) {
      case 'speed': {
        this.balls.getChildren().forEach(b => {
          const v = b.body.velocity.clone().scale(1.25);
          const cap = this.gp.ball.maxSpeed;
          b.body.setVelocity(
            Phaser.Math.Clamp(v.x, -cap, cap),
            Phaser.Math.Clamp(v.y, -cap, cap)
          );
          b._speedMag = Math.min((b._speedMag || this.gp.ball.speed) * 1.25, cap);
        });
        break;
      }
      case 'grow': {
        const who = (side === 'player') ? this.player : this.ai;

        // base height = original paddle height we stored in create()
        const baseH = who.baseHeight || who.displayHeight;

        // grow but clamp so it doesn’t get absurdly huge
        const newH = Math.min(who.displayHeight + 80, baseH + 120);
        who.setDisplaySize(this.gp.paddle.width, newH);
        who.body.setSize(this.gp.paddle.width, newH);

        this.time.delayedCall(this.gp.power.durationMs, () => {
          if (!who.active) return;
          // always return to base height (never smaller than original)
          who.setDisplaySize(this.gp.paddle.width, baseH);
          who.body.setSize(this.gp.paddle.width, baseH);
        });
        break;
      }
      case 'shrink': {
        // ❗ No more height decrease – just a cosmetic effect
        const opp = (side === 'player') ? this.ai : this.player;
        this._paddlePop(opp);      // little squash/pop animation
        opp.setTint(0xff7777);     // red tint to show debuff
        this.time.delayedCall(this.gp.power.durationMs, () => {
          if (!opp.active) return;
          opp.clearTint();
        });
        break;
      }
      case 'multi': {
        const dir = (side === 'player') ? 1 : -1;
        this._spawnBall(dir);
        break;
      }
    }
  }


  _mkMobileControls() {
    this._mobile = { up: false, down: false, action: false };

    const y = this.H - 200;
    const left = this.add.image(190, y - 180, 'btn_left').setInteractive({ useHandCursor: true });
    const right = this.add.image(190, y + 50, 'btn_right').setInteractive({ useHandCursor: true });
    // const action = this.add.image(this.W - 160, y, 'btn_action').setInteractive({ useHandCursor: true });

    // left.setDisplaySize(140, 140).setAlpha(0.8);
    // right.setDisplaySize(140, 140).setAlpha(0.8);
    // action.setDisplaySize(160, 160).setAlpha(0.9);

    // Map: left => UP, right => DOWN
    const press = (img) => img.setScale(1).setAlpha(1);
    const release = (img) => img.setScale(1).setAlpha(0.8);

    left.on('pointerdown', () => { press(left); this._mobile.up = true; });
    left.on('pointerup', () => { release(left); this._mobile.up = false; });
    left.on('pointerout', () => { release(left); this._mobile.up = false; });

    right.on('pointerdown', () => { press(right); this._mobile.down = true; });
    right.on('pointerup', () => { release(right); this._mobile.down = false; });
    right.on('pointerout', () => { release(right); this._mobile.down = false; });

    // action.on('pointerdown', () => { press(action); this._triggerStoredPower(); });
    // action.on('pointerup', () => { release(action); });
    // action.on('pointerout', () => { release(action); });

    this.input.keyboard.on('keydown-SPACE', () => this._triggerStoredPower());
  }

  _triggerStoredPower() {
    // Powers apply instantly on pickup; hook for future.
  }

  // ------ FX / UI helpers ------
  _updateScoreText() {
    this.ui.scoreText.setText(`Player ${this.state.player} : ${this.state.ai} AI`);
  }

  _announceOnce(text, color = '#ffff66', showMs = 600) {
    const t = this.ui.infoText;
    t.setText(text).setColor(color).setAlpha(0).setScale(0.9);
    this.tweens.killTweensOf(t);
    this.tweens.add({ targets: t, alpha: 1, scale: 1, duration: 120, ease: 'quad.out' });
    this.time.delayedCall(showMs, () => {
      this.tweens.add({ targets: t, alpha: 0, duration: 180, ease: 'quad.in' });
    });
  }

  _flash(strength = 0.12) {
    const r = this.ui.flash;
    r.setAlpha(0);
    this.tweens.killTweensOf(r);
    this.tweens.add({
      targets: r, alpha: strength, duration: 60, yoyo: true, ease: 'quad.out'
    });
  }

  _paddlePop(paddle) {
    this.tweens.killTweensOf(paddle);
    paddle.setScale(1, 1);
    this.tweens.add({
      targets: paddle, scaleY: 1.08, duration: 80, yoyo: true, ease: 'sine.out'
    });
  }

  _burst(x, y, count = 16) {
    if (!this.pfx) return;
    this.pfx.setPosition(x, y);
    this.pfx.explode(count, x, y);
  }

  _drawCenterNet() {
    const g = this.add.graphics();
    g.lineStyle(2, 0xffffff, 0.65);
    const dashH = 24, gap = 18, x = this.W / 2;
    let y = this.gp ? this.gp.arenaInset : 40;
    const yMax = (this.H || 1080) - y;
    while (y < yMax) {
      g.strokeLineShape(new Phaser.Geom.Line(x, y, x, Math.min(y + dashH, yMax)));
      y += dashH + gap;
    }
  }

  _endGame(sceneKey) {
    this.sound.stopAll();
    this.balls.getChildren().forEach(b => { if (b.active) b.destroy(); });
    const payload = { playerScore: this.state.player, aiScore: this.state.ai, cfg: this.cfg };
    this.scene.start(sceneKey, payload);
  }
}
