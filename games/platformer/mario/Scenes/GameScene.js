
class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');

    // bind helpers just in case
    Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach((fn) => {
      if (typeof this[fn] === 'function') this[fn] = this[fn].bind(this);
    });

    // state
    this.player = null;
    this.platforms = null;       // staticGroup
    this.enemies = null;         // group
    this.coins = null;           // group
    this.flag = null;

    this.score = 0;
    this.timeLeft = 0;
    this.gameOver = false;
    this.gameWon = false;

    this.inputs = { left: false, right: false, jump: false };

    // audio
    this.sfx = { jump: null, hit: null, collect: null, bgm: null, destroy: null };
  }
  // add this method near the top of the class
  init() {
    this.score = 0;
    this.timeLeft = 0;
    this.gameOver = false;
    this.gameWon = false;

    this.inputs = { left: false, right: false, jump: false };
    this.mobileLeftPressed = false;
    this.mobileRightPressed = false;

    // stop any lingering camera effects
    if (this.cameras && this.cameras.main) {
      this.cameras.main.resetFX();
      this.cameras.main.setZoom(1);
    }
  }

  preload() {
    const cfg = this.registry.get('cfg') || {};
    // accept either images1 or images (backward compatible)
    const imagesA = cfg.images1 || cfg.images || {};
    const imagesB = cfg.images2 || {};
    const ui = cfg.ui || {};
    const audio = cfg.audio || {};
    const sheets = cfg.spritesheets || {};

    // IMAGES (load everything)
    [imagesA, imagesB, ui].forEach(obj => {
      Object.entries(obj).forEach(([key, url]) => { if (url) this.load.image(key, url); });
    });

    // SPRITESHEETS (optional hero sheet)
    if (sheets.hero && sheets.hero.url) {
      this.load.spritesheet('hero', sheets.hero.url, {
        frameWidth: sheets.hero.frameWidth,
        frameHeight: sheets.hero.frameHeight
      });
    }

    // AUDIO
    if (audio.bgm) this.load.audio('bgm', audio.bgm);
    if (audio.jump) this.load.audio('jump', audio.jump);
    if (audio.hit) this.load.audio('hit', audio.hit);
    if (audio.collect) this.load.audio('collect', audio.collect);
    if (audio.destroy) this.load.audio('destroy', audio.destroy);
  }


  create() {
    const cfg = this.registry.get('cfg') || {};
    const G = cfg.gameplay || {};
    const I = {
      ...(cfg.images1 || cfg.images || {}),
      ...(cfg.images2 || {}),
      ...(cfg.ui || {})
    };


    const W = 1920, H = 1080; // design resolution (landscape)
    this.cameras.main.setBackgroundColor('#202830');
    this.input.addPointer(3);

    // Background (if provided)
    // Background (parallax via TileSprite)
    // Background (parallax via TileSprite)
    if (this.textures.exists('background')) {
      const W = 1920, H = 1080;
      const texImg = this.textures.get('background').getSourceImage();
      const texH = texImg ? texImg.height : 1080;
      const scaleY = H / texH;

      this.bgParallaxFactor = (cfg?.gameplay?.bgParallax ?? 0.5);

      this.bg = this.add.tileSprite(0, 0, W, H, 'background')
        .setOrigin(0, 0)
        .setScrollFactor(0);

      this.bg.setTileScale(scaleY, scaleY);
    }

    // inside create(), near the top (after you read cfg/G/I and set background)
    this.events.once('shutdown', this._cleanup);
    this.events.once('destroy', this._cleanup);

    // Physics world bounds (wide level)
    const levelWidth = G.levelWidth || 4000; // scrollable width
    this.physics.world.setBounds(0, 0, levelWidth, H);

    // PLATFORM STATIC GROUP
    this.platforms = this.physics.add.staticGroup();

    // Helper to add a platform sprite with accurate collider
    const addPlatform = (x, y, w = 200, h = 32, key = 'platform') => {
      const p = this.add.sprite(x, y, key).setOrigin(0, 0.5);
      p.setDisplaySize(w, h);
      this.physics.add.existing(p, true);
      p.body.setSize(w, h);
      this.platforms.add(p);
      return p;
    };

    // Build ground across the bottom using platform tiles
    const groundY = H - 80;
    let xCursor = 0;
    while (xCursor < levelWidth) {
      addPlatform(xCursor, groundY, 256, 48, 'platform');
      xCursor += 256;
    }

    // A few floating platforms (simple layout)
    addPlatform(600, groundY - 200, 220, 32, 'platform');
    addPlatform(900, groundY - 350, 220, 32, 'platform');
    addPlatform(1300, groundY - 260, 240, 32, 'platform');
    addPlatform(1700, groundY - 420, 260, 32, 'platform');
    addPlatform(2100, groundY - 280, 220, 32, 'platform');
    addPlatform(2500, groundY - 180, 220, 32, 'platform');
    addPlatform(2950, groundY - 320, 240, 32, 'platform');
    addPlatform(3350, groundY - 240, 220, 32, 'platform');
    addPlatform(3750, groundY - 340, 220, 32, 'platform');
    addPlatform(4050, groundY - 200, 220, 32, 'platform');
    addPlatform(4450, groundY - 200, 220, 32, 'platform');
    addPlatform(4750, groundY - 350, 220, 32, 'platform');
    addPlatform(5050, groundY - 260, 240, 32, 'platform');

    // COINS (collectibles)
    this.coins = this.physics.add.group({ allowGravity: false });
    const addCoin = (x, y) => {
      const c = this.physics.add.sprite(x, y, 'collectible');
      c.setDisplaySize(60, 60);
      c.body.setSize(252, 292);
      this.coins.add(c);
      return c;
    };
    // sprinkle some coins
    [650, 900, 950, 1320, 1720, 1760, 2120, 2540, 2970, 3380].forEach((cx, i) => {
      const cy = (i % 2 === 0) ? groundY - 260 : groundY - 200;
      addCoin(cx, cy);
    });

    // ENEMIES
    this.enemies = this.physics.add.group();
    const addWalker = (x, y) => {
      const e = this.physics.add.sprite(x, y, 'enemy').setOrigin(0.5, 1);
      e.setDisplaySize(100, 120);
      e.body.setSize(143, 224);
      e.setCollideWorldBounds(true);
      e.setBounce(0);
      e.setVelocityX(Phaser.Math.Between(-70, -50));
      e.setData('type', 'walker');
      e.setData('speed', 60 + Phaser.Math.Between(0, 30));
      e.setData('dir', -1);
      this.enemies.add(e);
      return e;
    };
    // place on safe platforms
    addWalker(920, groundY - 350);
    addWalker(1710, groundY - 420);
    addWalker(2510, groundY - 180);
    addWalker(3360, groundY - 240);
    addWalker(3760, groundY - 350);
    addWalker(4000, groundY - 420);
    addWalker(4250, groundY - 180);
    addWalker(4400, groundY - 240);

    // PLAYER
    const useSheet = this.textures.exists('hero');
    if (useSheet) {
      this.player = this.physics.add.sprite(150, groundY - 100, 'hero', 0);
    } else {
      this.player = this.physics.add.sprite(150, groundY - 100, 'player');
    }
    this.player.setDisplaySize(100, 120);
    this.player.body.setSize(342, 705);
    this.player.setCollideWorldBounds(true);
    this.player.setMaxVelocity(600, 1200);
    this.player.setDragX(1200);
    this.player.setBounce(0);

    // simple hero animations if sheet exists
    if (useSheet) {
      this.anims.create({
        key: 'run',
        frames: this.anims.generateFrameNumbers('hero', { start: 0, end: Math.max(1, (cfg.spritesheets?.hero?.frames ?? 4) - 1) }),
        frameRate: 12,
        repeat: -1
      });
      this.anims.create({ key: 'idle', frames: [{ key: 'hero', frame: 0 }], frameRate: 1 });
    }

    // FLAG (win)
    // this.flag = this.physics.add.staticSprite(levelWidth - 160, groundY - 48, 'flag');
    // this.flag.setDisplaySize(64, 128);
    // this.flag.body.setSize(64, 128);

    // === FLAG (visual) + GOAL SENSOR (collision) ===
    const flagX = levelWidth - 160;
    const flagY = groundY; // bottom aligned with ground

    // Visual flag only (no physics)
    this.flag = this.add.image(flagX, flagY, 'flag')
      .setOrigin(0.5, 1)      // stick bottom of flag to ground
      .setDisplaySize(64, 128);

    // Invisible goal sensor (actual win trigger)
    const goalW = 80;   // width of the trigger
    const goalH = 180;  // height of the trigger
    this.goal = this.add.rectangle(flagX, flagY - goalH / 2, goalW, goalH, 0x00ff00, 0); // alpha=0 = invisible
    this.physics.add.existing(this.goal, true);

    // Overlap check with goal
    this.physics.add.overlap(this.player, this.goal, this._onReachFlag);


    // COLLISIONS
    this.physics.add.collider(this.player, this.platforms);
    this.physics.add.collider(this.enemies, this.platforms, this._enemyPatrolBounce);
    this.physics.add.overlap(this.player, this.coins, this._onCollectCoin);
    this.physics.add.overlap(this.player, this.enemies, this._onPlayerEnemyOverlap);
    // this.physics.add.overlap(this.player, this.flag, this._onReachFlag);

    // CAMERA
    this.cameras.main.setBounds(0, 0, levelWidth, H);
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);

    // INPUTS
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys('A,D,SPACE,W');

    // MOBILE BUTTONS
    this._createMobileButtons(W, H);

    // inside create(), replace scoreText + timerText creation
    const fontFamily = (cfg.font?.family) || 'Arial';

    this.scoreText = this.add.text(20, 24, `${(cfg.texts?.score_label) ?? 'Score:'} 0`, {
      fontFamily,
      fontSize: '42px',
      color: '#ffe082'
    })
      .setStroke('#000000', 6)
      .setShadow(3, 3, '#000000', 4, true, true)
      .setScrollFactor(0)
      .setDepth(1000);

    this.timeLeft = G.timerSeconds ?? 120;
    this.timerText = this.add.text(W - 260, 24, `Time: ${this.timeLeft}`, {
      fontFamily,
      fontSize: '42px',
      color: '#80d8ff'
    })
      .setStroke('#000000', 6)
      .setShadow(3, 3, '#000000', 4, true, true)
      .setScrollFactor(0)
      .setDepth(1000);
    // subtle entry pop
    this._pop(this.scoreText, 1.15);
    this._pop(this.timerText, 1.15);

    this.time.addEvent({
      delay: 1000, loop: true, callback: () => {
        if (this.gameOver || this.gameWon) return;
        this.timeLeft = Math.max(0, this.timeLeft - 1);
        this.timerText.setText(`Time: ${this.timeLeft}`);
        if (this.timeLeft === 0) this._lose('time');
      }
    });

    // AUDIO
    if (this.sound && this.cache.audio.exists('bgm')) {
      this.sfx.bgm = this.sound.add('bgm', { loop: true, volume: 0.5 });
      this.sfx.bgm.play();
    }
    if (this.cache.audio.exists('jump')) this.sfx.jump = this.sound.add('jump', { volume: 0.6 });
    if (this.cache.audio.exists('hit')) this.sfx.hit = this.sound.add('hit', { volume: 0.6 });
    if (this.cache.audio.exists('collect')) this.sfx.collect = this.sound.add('collect', { volume: 0.7 });
    if (this.cache.audio.exists('destroy')) this.sfx.destroy = this.sound.add('destroy', { volume: 0.7 });

    // PITS (falling off)
    this.deathY = H + 50;

    // difficulty ramp (occasional enemy speed up)
    this.time.addEvent({
      delay: 8000,
      loop: true,
      callback: () => {
        this.enemies.children.iterate((e) => {
          if (!e || !e.active) return;
          const sp = e.getData('speed') || 60;
          e.setData('speed', Math.min(sp + 10, 160));
        });
      }
    });
  }

  update(_, dt) {
    if (this.gameOver || this.gameWon) return;
    // Parallax background scroll
    if (this.bg) {
      this.bg.tilePositionX = this.cameras.main.scrollX * this.bgParallaxFactor;
    }


    // inputs
    this.inputs.left = this.cursors.left.isDown || this.keys.A.isDown || this.inputs.left;
    this.inputs.right = this.cursors.right.isDown || this.keys.D.isDown || this.inputs.right;

    const onGround = this.player.body.blocked.down;

    // horizontal
    const moveSpeed = (this.registry.get('cfg')?.gameplay?.playerSpeed) ?? 300;
    if (this.inputs.left && !this.inputs.right) {
      this.player.setAccelerationX(-moveSpeed * 4);
      this.player.setFlipX(true);
      if (this.player.anims && onGround) this.player.play('run', true);
    } else if (this.inputs.right && !this.inputs.left) {
      this.player.setAccelerationX(moveSpeed * 4);
      this.player.setFlipX(false);
      if (this.player.anims && onGround) this.player.play('run', true);
    } else {
      this.player.setAccelerationX(0);
      if (this.player.anims && onGround) this.player.play('idle', true);
    }

    // jump (edge triggered)
    if ((Phaser.Input.Keyboard.JustDown(this.cursors.up) || Phaser.Input.Keyboard.JustDown(this.keys.W) || this.inputs.jump) && onGround) {
      this.player.setVelocityY(-520);
      if (this.sfx.jump) this.sfx.jump.play();
      this.inputs.jump = false; // consume mobile jump tap
    }

    // stop run anim mid-air
    if (!onGround && this.player.anims) {
      // keep last frame; simple approach
    }

    // enemy patrol AI
    this.enemies.children.iterate((e) => {
      if (!e || !e.active) return;
      const dir = e.getData('dir') || -1;
      const spd = e.getData('speed') || 60;
      e.setVelocityX(dir * spd);
      e.setFlipX(dir > 0);
    });

    // death by falling
    if (this.player.y > this.deathY) {
      this._lose('pit');
    }

    // cleanup offscreen coins/enemies (optional)
    const camX = this.cameras.main.worldView.x, camW = this.cameras.main.worldView.width;
    this.coins.children.each((c) => { if (c && c.active && c.x < camX - 200) c.destroy(); });
    this.enemies.children.each((e) => { if (e && e.active && e.x < camX - 400) e.destroy(); });

    // reset held inputs (keyboard handled by Phaser; mobile flags persist until pointerup)
    this.inputs.left = this.mobileLeftPressed || false;
    this.inputs.right = this.mobileRightPressed || false;
  }

  // ==== Handlers & Helpers ====

  _enemyPatrolBounce(enemy, platform) {
    // reverse direction if touching platform edge
    const left = platform.body.left, right = platform.body.right;
    if (enemy.x < left + 10) { enemy.setData('dir', 1); }
    else if (enemy.x > right - 10) { enemy.setData('dir', -1); }
  }

  // replace _onCollectCoin()
  _onCollectCoin(player, coin) {
    if (this.sfx.collect) this.sfx.collect.play();
    // removed: this._shake(60, 80);
    // in _onCollectCoin()
    this._burst('collectible', coin.x, coin.y, {
      speed: { min: 120, max: 240 },
      scale: { start: 0.7, end: 0 },
      lifespan: 450,
      quantity: 10
    });

    this._pop(this.scoreText, 1.25);

    coin.disableBody(true, true);
    this.score += 10;
    this.scoreText.setText(`${(this.registry.get('cfg')?.texts?.score_label) ?? 'Score:'} ${this.score}`);

    const float = this.add.text(coin.x, coin.y - 20, '+10', {
      fontFamily: (this.registry.get('cfg')?.font?.family) || 'Arial',
      fontSize: '36px',
      color: '#ffd54f'
    }).setStroke('#000', 4).setShadow(2, 2, '#000', 4, true, true).setDepth(999);

    this.tweens.add({
      targets: float,
      y: float.y - 60,
      alpha: 0,
      duration: 600,
      ease: 'cubic.out',
      onComplete: () => float.destroy()
    });
  }

  // replace _onPlayerEnemyOverlap()
  _onPlayerEnemyOverlap(player, enemy) {
    const vy = player.body.velocity.y;
    const playerAbove = vy > 150 && (player.y < enemy.y - 10);
    if (playerAbove) {
      if (this.sfx.destroy) this.sfx.destroy.play();
      this._flash(220);
      // removed: this._shake(200, 140);
      // removed: this._zoomPunch(1.06, 140);
      this._vibrate(80);
      // in _onPlayerEnemyOverlap(), stomp branch
      this._burst('enemy', enemy.x, enemy.getBounds().bottom, {
        speed: { min: 200, max: 420 },
        angle: { min: 220, max: 320 },
        scale: { start: 1.0, end: 0 },
        lifespan: 500,
        quantity: 16
      });

      enemy.disableBody(true, true);
      player.setVelocityY(-360);

      this.score += 20;
      this.scoreText.setText(`${(this.registry.get('cfg')?.texts?.score_label) ?? 'Score:'} ${this.score}`);
      this._pop(this.scoreText, 1.3);
    } else {
      if (this.sfx.hit) this.sfx.hit.play();
      this._flash(300, 0xff0000);
      this._shake(260, 200); // keep shake ONLY on game over
      this._vibrate(150);
      this._lose('enemy');
    }
  }

  _onReachFlag() {
    if (this.gameOver || this.gameWon) return;
    this.gameWon = true;

    // stop motion
    this.player.setAcceleration(0, 0);
    this.player.setVelocity(0, 0);
    this.enemies.children.iterate((e) => e && e.body && (e.body.velocity.x = 0));
    if (this.sfx.bgm) this.sfx.bgm.stop();

    const payload = { score: this.score, timeLeft: this.timeLeft };

    // optional small delay for the win FX to finish
    this.time.delayedCall(200, () => {
      // keep the event for any listeners, then change scene
      this.events.emit('game-win', payload);
      if (this.scene.get('WinScene')) {
        this.scene.start('WinScene', payload);
      }
    });
  }

  _lose(reason) {
    if (this.gameOver || this.gameWon) return;
    this.gameOver = true;

    this.player.setAcceleration(0, 0);
    this.player.setVelocity(0, 0);
    if (this.sfx.bgm) this.sfx.bgm.stop();

    const payload = { reason, score: this.score, timeLeft: this.timeLeft };

    // brief delay so shake/flash can show
    this.time.delayedCall(200, () => {
      // keep the event for any listeners, then change scene
      this.events.emit('game-over', payload);
      if (this.scene.get('GameOverScene')) {
        this.scene.start('GameOverScene', payload);
      }
    });
  }

  _createMobileButtons(W, H) {
    const leftX = 160, rightX = 490, btnY = H - 100, actionX = W - 160;

    const makeBtn = (key, x, y, onDown, onUp) => {
      // use texture existence instead of assuming which section (ui/images1/images2)
      if (!this.textures.exists(key)) return null;

      const b = this.add.image(x, y, key)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true })
        .setDepth(999);

      b.setDisplaySize(100, 100);

      b.on('pointerdown', () => { b.setScale(0.95); b.setAlpha(0.8); onDown(); });
      b.on('pointerup', () => { b.setScale(0.8); b.setAlpha(1.0); onUp(); });
      b.on('pointerout', () => { b.setScale(0.8); b.setAlpha(1.0); onUp(); });
      return b;
    };

    makeBtn('left', leftX, btnY, () => { this.mobileLeftPressed = true; }, () => { this.mobileLeftPressed = false; });
    makeBtn('right', rightX, btnY, () => { this.mobileRightPressed = true; }, () => { this.mobileRightPressed = false; });
    makeBtn('action', W - 160, btnY, () => { this.inputs.jump = true; }, () => { });
  }


  // ==== FX Helpers ==== 
  _flash(duration = 200, color = 0xffffff) {
    this.cameras.main.flash(duration, (color >> 16) & 255, (color >> 8) & 255, color & 255);
  }
  _shake(duration = 150, intensity = 120) {
    this.cameras.main.shake(duration, Math.min(1, intensity / 1000));
  }
  _zoomPunch(scale = 1.05, duration = 120) {
    const cam = this.cameras.main;
    const base = cam.zoom;
    this.tweens.add({ targets: cam, zoom: base * scale, duration: duration / 2, ease: 'quad.out', yoyo: true });
  }
  _vibrate(ms = 60) {
    try { if (navigator && navigator.vibrate) navigator.vibrate(ms); } catch (e) { }
  }
  _pop(target, factor = 1.2) {
    this.tweens.add({ targets: target, scaleX: factor, scaleY: factor, duration: 90, yoyo: true, ease: 'quart.out' });
  }
  // replaces previous _burst(manager, x, y, opts)
  _burst(textureKey, x, y, opts = {}) {
    if (!textureKey) return;

    const config = {
      speed: opts.speed ?? { min: 180, max: 360 },
      angle: opts.angle ?? { min: 200, max: 340 },
      scale: opts.scale ?? { start: 1.0, end: 0 },
      lifespan: opts.lifespan ?? 500,
      gravityY: opts.gravityY ?? 800,
      quantity: opts.quantity ?? 12,
      blendMode: opts.blendMode ?? 'ADD',
      on: false // we will explode once
    };

    // Phaser 3.60+ — returns a ParticleEmitter
    const emitter = this.add.particles(x, y, textureKey, config);

    // explode the configured quantity at x,y
    const count = (typeof config.quantity === 'number') ? config.quantity : 10;
    emitter.explode(count, x, y);

    // tidy up after the particles finish
    const life = (typeof config.lifespan === 'number') ? config.lifespan : 600;
    this.time.delayedCall(life + 60, () => {
      emitter.stop();
      // remove the emitter from its manager and destroy the manager if empty
      if (emitter.remove) emitter.remove();
      if (emitter.manager && emitter.manager.emitters && emitter.manager.emitters.getTotalFree() === 0) {

      }
    });
  }

  // tidy up when leaving the scene or restarting it
  _cleanup() {
    // stop bgm
    if (this.sfx && this.sfx.bgm) {
      this.sfx.bgm.stop();
      this.sfx.bgm.destroy();
      this.sfx.bgm = null;
    }

    // clear timers/tweens safely
    if (this.time) this.time.clearPendingEvents();
    if (this.tweens) this.tweens.killAll();

    // reset camera fx/zoom
    if (this.cameras && this.cameras.main) {
      this.cameras.main.resetFX();
      this.cameras.main.setZoom(1);
    }
  }

}
