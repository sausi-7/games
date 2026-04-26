class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');

    this.W = 1920; this.H = 1080;
    this.grid = { cell: 54, cols: 30, rows: 18 };

    this.cfg = null;

    this.player = null;
    this.walls = null;      // static physics blocks
    this.wallList = [];     // cached references used by geometry checks
    this.dots = null;       // static
    this.power = null;      // static
    this.ghosts = null;     // dynamic
    this._ghostData = [];   // [{sprite, dir, home, mode, releaseAt}]

    this.spawn = { player: { c: 16, r: 9 }, house: { c: 10, r: 9 } };

    this.cursors = null;
    this._move = { x: 0, y: 0 };

    this.mobile = {
      leftBtn: null, rightBtn: null, upBtn: null, downBtn: null,
      holdLeft: false, holdRight: false, holdUp: false, holdDown: false
    };
  }

  init() {
    // Reset game state
    this.state = {
      score: 0, lives: 3, level: 1, finished: false,
      playerSpeed: 200, ghostSpeed: 170, frightenedSpeed: 110,
      pelletMs: 6000, frightenedUntil: 0,
      ghostThinkEveryMs: 550, lastThinkAt: 0,
      dotsLeft: 0,
      lastSpeedIncrease: 0,
      lastGhostSpawn: 0,
      maxGhosts: 8
    };
    this._ghostData = [];
    this._move = { x: 0, y: 0 };
    this.mobile = {
      leftBtn: null, rightBtn: null, upBtn: null, downBtn: null,
      holdLeft: false, holdRight: false, holdUp: false, holdDown: false
    };
  }

  preload() {
    const cfg = this.registry.get('cfg') || {};
    this.cfg = cfg;
    for (const [k, url] of Object.entries(cfg.images1 || {})) this.load.image(k, url);
    for (const [k, url] of Object.entries(cfg.images2 || {})) this.load.image(k, url);
    for (const [k, url] of Object.entries(cfg.audio || {})) this.load.audio(k, url);
  }

  create() {
    this._seedRng();
    this.physics.world.setBounds(0, 0, this.W, this.H);

    // Clear any existing tweens or timed events
    if (this.tweens) this.tweens.killAll();
    if (this.time) this.time.removeAllEvents();

    // Background
    if (this.cfg.images2?.background) {
      const bg = this.add.image(this.W/2, this.H/2, 'background').setDepth(-5);
      bg.setDisplaySize(this.W, this.H);
    }

    // Audio
    this.sfx = {
      bgm: this.sound.add('bgm', { loop: true, volume: 0.4 }),
      collect: this.sound.add('collect', { volume: 0.6 }),
      power: this.sound.add('power', { volume: 0.7 }),
      hit: this.sound.add('hit', { volume: 0.9 }),
      destroy: this.sound.add('destroy', { volume: 0.8 }),
      levelwin: this.sound.add('levelwin', { volume: 0.8 })
    };
    this.sfx.bgm?.play();

    // Build maze of blocks
    this._buildMazeBlocks();

    // Make sure spawn is actually walkable
    this._ensureSafePlayerSpawn();

    // Player
    const pxy = this._cellToXY(this.spawn.player.c, this.spawn.player.r);
    this.player = this.physics.add.image(pxy.x, pxy.y, 'player').setDepth(3);
    this.player.setDisplaySize(this.grid.cell * 0.7, this.grid.cell * 0.7);
    this.player.setCollideWorldBounds(true);
    this.player.body.setSize(this.player.width, this.player.height, true);

    // Ghosts (only ghost1, count from config)
    this.ghosts = this.physics.add.group();
    this._spawnGhosts();

    // Physics
    this.physics.add.collider(this.player, this.walls);
    this.physics.add.collider(this.ghosts, this.walls, (ghost, wall) => this._ghostBounceOrChoose(ghost, wall));

    this.physics.add.overlap(this.player, this.dots, (_p, dot) => {
      dot.disableBody(true, true);
      this.state.score += 10; this.state.dotsLeft--; this.sfx.collect?.play();
      
      // Animate score collection
      this._animateScoreCollection(dot.x, dot.y, '+10');
      
      this._refreshUI();
      if (this.state.dotsLeft <= 0) this._onWin();
    });

    this.physics.add.overlap(this.player, this.power, (_p, pellet) => {
      pellet.disableBody(true, true); this.sfx.power?.play();
      this.state.frightenedUntil = this.time.now + this.state.pelletMs;
      this._ghostData.forEach(g => { if (g.mode === 'normal') g.mode = 'frightened'; });
      
      // Animate power pellet collection
      this._animateScoreCollection(pellet.x, pellet.y, 'POWER!');
    });

    this.physics.add.overlap(this.player, this.ghosts, (_p, ghost) => this._onPlayerVsGhost(ghost));


    this.input.addPointer(2); // allow 2 pointers for mobile
    // Input + mobile pad
    if (this.input.keyboard) this.input.keyboard.removeAllKeys(true); // Clear any existing key listeners
    this.cursors = this.input.keyboard.createCursorKeys();
    this._createMobilePad();

    // UI
    const fontFamily = (this.cfg.font && this.cfg.font.family) ? this.cfg.font.family : 'Outfit, Arial';
    this.ui = {
      scoreText: this.add.text(24, 16, '', { fontFamily, fontSize: 32, color: '#fff' }).setDepth(10),
      livesText: this.add.text(24, 54, '', { fontFamily, fontSize: 28, color: '#ffeb3b' }).setDepth(10),
      levelText: this.add.text(24, 88, '', { fontFamily, fontSize: 28, color: '#9cf' }).setDepth(10)
    };
    this._refreshUI();
    this.state.lastThinkAt = this.time.now;
    this.state.lastSpeedIncrease = this.time.now;
    this.state.lastGhostSpawn = this.time.now;
  }

  update(time) {
    if (this.state.finished) return;

    // Progressive difficulty - increase ghost speed every 30 seconds
    if (time - this.state.lastSpeedIncrease > 30000) {
      this.state.lastSpeedIncrease = time;
      this.state.ghostSpeed = Math.min(this.state.ghostSpeed + 15, 280);
      this.state.frightenedSpeed = Math.min(this.state.frightenedSpeed + 10, 150);
      
      // Visual feedback for speed increase
      this._showDifficultyIncrease('SPEED UP!');
    }

    // Progressive difficulty - add ghost every 45 seconds (up to max)
    if (time - this.state.lastGhostSpawn > 45000 && this._ghostData.length < this.state.maxGhosts) {
      this.state.lastGhostSpawn = time;
      this._spawnAdditionalGhost();
      this._showDifficultyIncrease('NEW GHOST!');
    }

    // Frightened timeout
    if (this.state.frightenedUntil && time > this.state.frightenedUntil) {
      this.state.frightenedUntil = 0;
      this._ghostData.forEach(g => { if (g.mode === 'frightened') g.mode = 'normal'; });
    }

    // Player movement (4-way)
    this._move.x = 0; this._move.y = 0;
    if (this.cursors.left?.isDown || this.mobile.holdLeft)   this._move.x = -1;
    else if (this.cursors.right?.isDown || this.mobile.holdRight) this._move.x = 1;
    if (this.cursors.up?.isDown   || this.mobile.holdUp)     this._move.y = -1;
    else if (this.cursors.down?.isDown || this.mobile.holdDown)   this._move.y = 1;
    if (this._move.x !== 0) this._move.y = 0;

    const v = this.state.playerSpeed;
    this.player.setVelocity(this._move.x * v, this._move.y * v);
    this.player.body.setSize(this.player.width, this.player.height, true);

    // Ghost "brain" ticks
    if (time - this.state.lastThinkAt > this.state.ghostThinkEveryMs) {
      this.state.lastThinkAt = time;
      this._ghostData.forEach(gd => this._ghostConsiderNewDir(gd));
    }
    // Apply ghost velocity
    this._ghostData.forEach(gd => {
      const sp = (gd.mode === 'frightened') ? this.state.frightenedSpeed : this.state.ghostSpeed;
      gd.sprite.setVelocity(gd.dir.x * sp, gd.dir.y * sp);
      gd.sprite.body.setSize(100, 100, true);
    });
  }

  shutdown() {
    // Stop sounds
    if (this.sfx) {
      Object.values(this.sfx).forEach(sound => sound?.stop());
      this.sfx = null;
    }

    // Destroy player
    this.player?.destroy();
    this.player = null;

    // Destroy groups
    this.walls?.clear(true, true);
    this.walls = null;
    this.dots?.clear(true, true);
    this.dots = null;
    this.power?.clear(true, true);
    this.power = null;
    this.ghosts?.clear(true, true);
    this.ghosts = null;

    // Clear ghost data
    this._ghostData = [];

    // Destroy UI
    if (this.ui) {
      Object.values(this.ui).forEach(text => text?.destroy());
      this.ui = null;
    }

    // Destroy mobile controls
    if (this.mobile) {
      Object.values(this.mobile).filter(btn => btn && typeof btn.destroy === 'function').forEach(btn => btn.destroy());
      this.mobile.leftBtn = null;
      this.mobile.rightBtn = null;
      this.mobile.upBtn = null;
      this.mobile.downBtn = null;
      this.mobile.holdLeft = false;
      this.mobile.holdRight = false;
      this.mobile.holdUp = false;
      this.mobile.holdDown = false;
    }

    // Clear wall list
    this.wallList = [];

    // Clear cursors
    if (this.input.keyboard) this.input.keyboard.removeAllKeys(true);
    this.cursors = null;

    // Clear tweens and timed events
    if (this.tweens) this.tweens.killAll();
    if (this.time) this.time.removeAllEvents();
  }

  // ───────────── Maze (blocks) ─────────────
  _buildMazeBlocks() {
    const G = this.grid;
    const rows = this._layoutRows();

    this.walls = this.physics.add.staticGroup();
    this.dots = this.physics.add.staticGroup();
    this.power = this.physics.add.staticGroup();
    this.wallList = []; // reset

    const offX = Math.floor((this.W - (G.cols * G.cell)) / 2);
    const offY = Math.floor((this.H - (G.rows * G.cell)) / 2);

    // Build horizontal runs of '#'
    for (let r = 0; r < G.rows; r++) {
      const line = rows[r] || "".padEnd(G.cols, '#');
      let c = 0;
      while (c < G.cols) {
        const ch = line[c] || '#';
        if (ch === '#') {
          const start = c;
          while (c < G.cols && line[c] === '#') c++;
          const run = c - start;
          const w = run * G.cell;
          const h = G.cell;
          const x = offX + start * G.cell + w / 2;
          const y = offY + r * G.cell + h / 2;

          const rect = this.add.rectangle(x, y, w, h, 0x79C6FF, 1).setDepth(1);
          this.physics.add.existing(rect, true); // static body
          if (rect.body) {
            rect.body.setSize(rect.width, rect.height, true);
            this.walls.add(rect);
            this.wallList.push(rect);
          }
        } else {
          const x = offX + c * G.cell + G.cell / 2;
          const y = offY + r * G.cell + G.cell / 2;
          if (ch === '.') {
            const d = this.dots.create(x, y, 'collectible').setDepth(2);
            d.setDisplaySize(G.cell * 0.35, G.cell * 0.35);
            d.refreshBody();
            this.state.dotsLeft++;
          } else if (ch === 'o') {
            const p = this.power.create(x, y, 'powerpellet').setDepth(2);
            p.setDisplaySize(G.cell * 0.65, G.cell * 0.65);
            p.refreshBody();
          } else if (ch === 'P') {
            this.spawn.player = { c, r };
          } else if (ch === 'H') {
            this.spawn.house = { c, r };
          }
          c++;
        }
      }
    }
  }

  // ───────────── Safe spawn ─────────────
  _ensureSafePlayerSpawn() {
    const rows = this._layoutRows();
    const isWalk = (c, r) => ((rows[r] || '')[c] || '#') !== '#';
    let { c, r } = this.spawn.player;

    if (!isWalk(c, r) || ![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => isWalk(c + dx, r + dy))) {
      for (let rr = 0; rr < this.grid.rows; rr++) {
        for (let cc = 0; cc < this.grid.cols; cc++) {
          if (isWalk(cc, rr) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => isWalk(cc + dx, rr + dy))) {
            this.spawn.player = { c: cc, r: rr };
            return;
          }
        }
      }
    }
  }

  // ───────────── Ghosts ─────────────
  _spawnGhosts() {
    const house = this._cellToXY(this.spawn.house.c, this.spawn.house.r);
    const count = Math.max(1, (this.cfg.gameplay?.ghostCount || 4));
    for (let i = 0; i < count; i++) {
      this._createGhost(house, i, count);
    }
  }

  _createGhost(house, index, totalCount) {
    const g = this.ghosts.create(
      house.x + (index - (totalCount - 1) / 2) * (this.grid.cell * 0.9),
      house.y,
      'ghost1'
    ).setDepth(3);
    g.setDisplaySize(this.grid.cell * 0.60, this.grid.cell * 0.60);
    g.body.setCollideWorldBounds(true);
    g.body.setSize(100, 100, true);

    const dir = new Phaser.Math.Vector2(index % 2 === 0 ? 1 : -1, 0);
    this._ghostData.push({
      sprite: g,
      dir,
      home: { x: house.x, y: house.y },
      mode: 'normal',
      releaseAt: this.time.now + index * 700
    });
  }

  _spawnAdditionalGhost() {
    const house = this._cellToXY(this.spawn.house.c, this.spawn.house.r);
    const index = this._ghostData.length;
    this._createGhost(house, index, index + 1);
  }

  _ghostConsiderNewDir(gd) {
    if (gd.releaseAt && this.time.now < gd.releaseAt) return;

    if (gd.mode === 'eyes') {
      const toHome = new Phaser.Math.Vector2(gd.home.x - gd.sprite.x, gd.home.y - gd.sprite.y).normalize();
      gd.dir.copy(this._cardinalFromVector(toHome));
      if (Phaser.Math.Distance.Between(gd.sprite.x, gd.sprite.y, gd.home.x, gd.home.y) < this.grid.cell * 0.3) {
        gd.mode = 'normal'; gd.releaseAt = this.time.now + 800;
      }
      return;
    }

    const options = this._openCardinalDirs(gd.sprite, gd.dir.clone().negate());
    if (options.length === 0) { gd.dir.negate(); return; }

    const playerPos = new Phaser.Math.Vector2(this.player.x, this.player.y);
    let chosen = null;

    if (gd.mode === 'frightened') {
      chosen = options[this._randInt(0, options.length - 1)];
    } else {
      let bestD = Infinity;
      options.forEach(d => {
        const nx = gd.sprite.x + d.x * this.grid.cell;
        const ny = gd.sprite.y + d.y * this.grid.cell;
        const d2 = Phaser.Math.Distance.Squared(playerPos.x, playerPos.y, nx, ny);
        if (d2 < bestD) { bestD = d2; chosen = d; }
      });
      if (Math.random() < 0.2 && options.length > 1) {
        chosen = options[this._randInt(0, options.length - 1)];
      }
    }
    gd.dir.copy(chosen);
  }

  _ghostBounceOrChoose(ghost /*, wall */) {
    const gd = this._ghostData.find(x => x.sprite === ghost);
    if (!gd) return;
    ghost.x += gd.dir.x * -2; ghost.y += gd.dir.y * -2; // unstick slightly
    const opts = this._openCardinalDirs(ghost, gd.dir.clone().negate());
    gd.dir.copy(opts.length ? opts[this._randInt(0, opts.length - 1)] : gd.dir.negate());
  }

  // ───────────── Interactions ─────────────
  _onPlayerVsGhost(ghostSprite) {
    const g = this._ghostData.find(x => x.sprite === ghostSprite);
    if (!g || this.state.finished) return;

    // Bodies always = visuals
    this.player.body.setSize(this.player.width, this.player.height, true);
    ghostSprite.body.setSize(100, 100, true);

    if (g.mode === 'frightened') {
      // eaten -> eyes mode (but NOT disabled/destroyed)
      g.mode = 'eyes';
      this.state.score += 200;
      this.sfx.destroy?.play();
      
      // Animate ghost destruction
      this._animateGhostDestruction(ghostSprite);
      this._animateScoreCollection(ghostSprite.x, ghostSprite.y, '+200');
      
      return;
    }

    // Lose a life - animate collision
    this.sfx.hit?.play();
    this._animatePlayerHit();
    
    this.state.lives -= 1; this._refreshUI();
    if (this.state.lives <= 0) return this._onGameOver();

    const pxy = this._cellToXY(this.spawn.player.c, this.spawn.player.r);
    this.player.body.reset(pxy.x, pxy.y);
  }

  _onWin() {
    this.state.finished = true;
    this.sfx.bgm?.stop();
    this.scene.start('WinScene', { score: this.state.score });
  }

  _onGameOver() {
    this.state.finished = true;
    this.sfx.bgm?.stop();
    this.scene.start('GameOverScene');
  }

  // ───────────── Animations ─────────────
  _animateScoreCollection(x, y, text) {
    const scoreText = this.add.text(x, y, text, {
      fontFamily: 'Outfit, Arial',
      fontSize: 24,
      color: '#ffeb3b',
      fontStyle: 'bold'
    }).setDepth(20).setOrigin(0.5);

    this.tweens.add({
      targets: scoreText,
      y: y - 60,
      alpha: 0,
      scale: 1.5,
      duration: 1000,
      ease: 'Power2',
      onComplete: () => scoreText.destroy()
    });
  }

  _animatePlayerHit() {
    // Flash red and shake
    const originalTint = this.player.tint;
    this.player.setTint(0xff0000);
    
    this.tweens.add({
      targets: this.player,
      x: this.player.x + 5,
      duration: 50,
      yoyo: true,
      repeat: 5,
      ease: 'Power2'
    });

    this.time.delayedCall(300, () => {
      this.player.setTint(originalTint);
    });
  }

  _animateGhostDestruction(ghost) {
    // Flash white and scale down briefly
    const originalTint = ghost.tint;
    ghost.setTint(0xffffff);
    
    this.tweens.add({
      targets: ghost,
      scaleX: 0.3,
      scaleY: 0.3,
      duration: 200,
      yoyo: true,
      ease: 'Power2',
      onComplete: () => {
        ghost.setTint(originalTint);
        ghost.setScale(1);
      }
    });
  }

  _showDifficultyIncrease(text) {
    const diffText = this.add.text(this.W / 2, this.H / 2, text, {
      fontFamily: 'Outfit, Arial',
      fontSize: 48,
      color: '#ff6b35',
      fontStyle: 'bold'
    }).setDepth(50).setOrigin(0.5).setAlpha(0);

    this.tweens.add({
      targets: diffText,
      alpha: 1,
      scale: 1.2,
      duration: 500,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.tweens.add({
          targets: diffText,
          alpha: 0,
          y: diffText.y - 50,
          duration: 1000,
          delay: 1000,
          ease: 'Power2',
          onComplete: () => diffText.destroy()
        });
      }
    });
  }

  // ───────────── Controls ─────────────
  _createMobilePad() {
    const y = this.H - 110, leftX = 160, rightX = 490, upX = this.W - 490, downX = this.W - 160;
    const mk = (x, key, angle = 0) => {
      const s = this.add.image(x, y, key).setDepth(50).setInteractive({ useHandCursor: true });
      s.setDisplaySize(112, 112); s.alpha = 0.9; s.angle = angle;
      s.on('pointerdown', () => { s.setScale(0.95); s.alpha = 1.0; });
      s.on('pointerup', () => { s.setScale(1.0); s.alpha = 0.9; });
      s.on('pointerout', () => { s.setScale(1.0); s.alpha = 0.9; });
      return s;
    };
    this.mobile.leftBtn = mk(leftX, 'left', 0);
    this.mobile.rightBtn = mk(rightX, 'right', 0);
    this.mobile.upBtn = mk(upX, 'right', -90);
    this.mobile.downBtn = mk(downX, 'right', 90);

    this.mobile.leftBtn.on('pointerdown', () => { this.mobile.holdLeft = true; });
    this.mobile.leftBtn.on('pointerup', () => { this.mobile.holdLeft = false; });
    this.mobile.rightBtn.on('pointerdown', () => { this.mobile.holdRight = true; });
    this.mobile.rightBtn.on('pointerup', () => { this.mobile.holdRight = false; });
    this.mobile.upBtn.on('pointerdown', () => { this.mobile.holdUp = true; });
    this.mobile.upBtn.on('pointerup', () => { this.mobile.holdUp = false; });
    this.mobile.downBtn.on('pointerdown', () => { this.mobile.holdDown = true; });
    this.mobile.downBtn.on('pointerup', () => { this.mobile.holdDown = false; });
  }

  // ───────────── Geometry helpers ─────────────
  _openCardinalDirs(s, forbid) {
    const dirs = [ new Phaser.Math.Vector2(1, 0), new Phaser.Math.Vector2(-1, 0),
                   new Phaser.Math.Vector2(0, 1), new Phaser.Math.Vector2(0, -1) ];
    const out = [];
    dirs.forEach(d => {
      if (forbid && d.x === forbid.x && d.y === forbid.y) return;
      const step = this.grid.cell * 0.55;
      const test = new Phaser.Geom.Rectangle(
        s.x + d.x * step - s.displayWidth / 2,
        s.y + d.y * step - s.displayHeight / 2,
        s.displayWidth, s.displayHeight
      );
      let blocked = false;
      for (let i = 0; i < this.wallList.length; i++) {
        const w = this.wallList[i];
        if (!w || !w.body) continue;
        const r = new Phaser.Geom.Rectangle(w.body.x, w.body.y, w.body.width, w.body.height);
        if (Phaser.Geom.Intersects.RectangleToRectangle(test, r)) { blocked = true; break; }
      }
      if (!blocked) out.push(d);
    });
    return out;
  }

  _cardinalFromVector(v) {
    return (Math.abs(v.x) > Math.abs(v.y))
      ? new Phaser.Math.Vector2(Math.sign(v.x) || 1, 0)
      : new Phaser.Math.Vector2(0, Math.sign(v.y) || 1);
  }

  _cellToXY(c, r) {
    const G = this.grid;
    const offX = Math.floor((this.W - (G.cols * G.cell)) / 2);
    const offY = Math.floor((this.H - (G.rows * G.cell)) / 2);
    return { x: offX + c * G.cell + G.cell / 2, y: offY + r * G.cell + G.cell / 2 };
  }

  _layoutRows() {
    return [
      "##############################",
      "#............##............  #",
      "#.####.#####.##.#####.####.  #",
      "#o#  #.#   #.##.#   #.#  #o  #",
      "#.####.#####.##.#####.####.  #",
      "#..........................  #",
      "#.####.##.########.##.####.  #",
      "#......##....##....##......  #",
      "######.##### ## #####.###### #",
      "     #.H   ###P###   H.#     #",
      "######.##### ## #####.###### #",
      "#......##....##....##......  #",
      "#.####.##.########.##.####.  #",
      "#o... ................ ..o.  #",
      "#.####.#####.##.#####.####.  #",
      "#............##............  #",
      "##############################",
      "##############################"
    ];
  }

  _seedRng() { this._rng = (seed => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; })(Date.now() % 2147483647); }
  _randInt(a, b) { return Math.floor(this._rng() * (b - a + 1)) + a; }
  _refreshUI() { this.ui?.scoreText?.setText(`Score: ${this.state.score}`); this.ui?.livesText?.setText(`Lives: ${this.state.lives}`); this.ui?.levelText?.setText(`Level: ${this.state.level}`); }
}