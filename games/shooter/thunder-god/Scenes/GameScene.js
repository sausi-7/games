class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');

    // --- Runtime state (gameplay only) ---
    this.state = {
      keysCollected: 0, totalKeys: 0, timerLeft: 0, gameOver: false,
      score: 0, hp: 3, won: false,
      dashing: false, dashEndsAt: 0, nextDashAt: 0, invulnUntil: 0,
    };

    this._lastMoveDir = new Phaser.Math.Vector2(1, 0);

    // ✅ UI refs (created once per scene run; destroyed on shutdown)
    this.ui = {
      scoreText: null, timerText: null,
      flashBarBg: null, flashBarFill: null, flashReadyText: null,
      actionBtn: null, _readyPulse: null,
    };

    // Config
    this._dashCfg = { speed: 1400, durationMs: 220, cooldownMs: 900, invulnMs: 220 };

    // VFX
    this._flashGfx = null;
    this._flashRing = null;

    // Input (mobile)
    this.inputState = { left: false, right: false, up: false, down: false, actionHeld: false };

    // Refs
    this.player = null;
    this.enemies = null;
    this.ghosts = null;
    this.keysGroup = null;
    this.walls = null;
    this.darkness = null;
    this.lightGfx = null;
    this.lightMask = null;

    // Maze data
    this.grid = null;
    this.cellSize = 56;
    this.gridCols = 17;
    this.gridRows = 29;
    this.playArea = new Phaser.Geom.Rectangle(0, 0, 0, 0);

    // Audio
    // 1) In the constructor's sfx map:
    this.sfx = { collect: null, hit: null, win: null, lose: null, jump: null, attack: null, slice: null };

    // this.sfx = { collect: null, hit: null, win: null, lose: null, jump: null, attack: null };
    this.bgm = null;

    // 🔧 housekeeping
    this._timers = [];
    this._uiButtons = [];
    this._keyboardBound = false;
  }

  // Reset state every time the scene starts (important for replay)
  init() {
    this.state.keysCollected = 0;
    this.state.totalKeys = 0;
    this.state.timerLeft = 0;
    this.state.gameOver = false;
    this.state.score = 0;
    this.state.hp = 3;
    this.state.won = false;
    this.state.dashing = false;
    this.state.dashEndsAt = 0;
    this.state.nextDashAt = 0;
    this.state.invulnUntil = 0;

    // clear holders from any previous (just in case)
    this._timers = [];
    this._uiButtons = [];
    this._keyboardBound = false;
  }

  preload() {
    const cfg = this.registry.get('cfg') || {};
    const images = cfg.images1 || {};
    const images2 = cfg.images2 || {};
    const ui = cfg.ui || {};
    Object.entries(images).forEach(([k, u]) => { if (typeof u === 'string' && u.endsWith('.png')) this.load.image(k, u); });
    Object.entries(images2).forEach(([k, u]) => { if (typeof u === 'string' && u.endsWith('.png')) this.load.image(k, u); });
    Object.entries(ui).forEach(([k, u]) => { if (typeof u === 'string' && u.endsWith('.png')) this.load.image(k, u); });

    const sheets = cfg.spritesheets || {};
    Object.entries(sheets).forEach(([k, m]) => {
      if (m && m.url) this.load.spritesheet(k, m.url, { frameWidth: m.frameWidth || 64, frameHeight: m.frameHeight || 64 });
    });

    const audio = cfg.audio || {};
    Object.entries(audio).forEach(([k, u]) => { if (typeof u === 'string' && u.endsWith('.mp3')) this.load.audio(k, u); });
  }

  create() {
    // 🔒 ensure proper cleanup on scene swap/replay
    this.events.once('shutdown', this._onShutdown, this);
    this.events.once('destroy', this._onShutdown, this);

    const cfg = this.registry.get('cfg') || {};
    const cam = this.sys.cameras.main;
    const W = this.sys.game.config.width;
    const H = this.sys.game.config.height;

    // --- Pull gameplay config with sensible defaults ---
    const gp = cfg.gameplay || {};

    // Dash (Flash) tuning
    this._dashCfg = {
      speed: gp.dashSpeed ?? 1400,
      durationMs: gp.dashDuration ?? 220,
      cooldownMs: gp.dashCooldown ?? 10000,
      invulnMs: gp.dashInvuln ?? 220,
    };

    this.state.timerLeft = (gp.timerSeconds ?? 90) | 0;
    const playerSpeed = gp.playerSpeed ?? 200;
    const ghostSpeed = gp.ghostSpeed ?? 110;
    const ghostChaseMul = gp.ghostChaseMultiplier ?? 1.8;
    const detectRadius = gp.ghostDetectRadius ?? 220;
    const keyCount = gp.keyCount ?? 4;

    this.cellSize = gp.cellSize ?? 56;
    this.gridCols = Math.max(7, gp.gridCols ?? 17);
    this.gridRows = Math.max(9, gp.gridRows ?? 29);
    const lightRadiusBase = gp.lightRadius ?? 180;
    const flickerIntensity = gp.flickerIntensity ?? 18;

    const sizes = {
      player: gp.playerSize || { w: 64, h: 64 },
      enemy: gp.enemySize || { w: 48, h: 48 },
      key: gp.keySize || { w: 36, h: 36 },
      platformThickness: gp.platformThickness ?? Math.max(14, Math.floor(this.cellSize * 0.25)),
    };

    if (this.textures.exists('background')) {
      const bg = this.add.image(W / 2, H / 2, 'background').setDepth(-100);
      const scale = Math.max(W / bg.width, H / bg.height);
      bg.setScale(scale);
    }

    if (this.gridCols % 2 === 0) this.gridCols += 1;
    if (this.gridRows % 2 === 0) this.gridRows += 1;
    this.grid = this._generateMaze(this.gridCols, this.gridRows);

    const mazeW = this.gridCols * this.cellSize;
    const mazeH = this.gridRows * this.cellSize;
    this.playArea.setTo((W - mazeW) / 2, (H - mazeH) / 2, mazeW, mazeH);

    // Walls
    this.walls = this.physics.add.staticGroup();
    this._buildWallsFromGrid(sizes.platformThickness);

    // Player
    const startCell = this._findOpenCellNear(1, 1) || { c: 1, r: 1 };
    const px = this._cx(startCell.c);
    const py = this._cy(startCell.r);
    this.player = this._spriteOrFallback(px, py, 'player', sizes.player.w, sizes.player.h, { dynamic: true });
    this.player.setDepth(10);
    this.player.body.setCollideWorldBounds(false);
    this.player.body.setSize(600, 900, true);
    this.physics.add.collider(this.player, this.walls);

    // Keys
    this.keysGroup = this.physics.add.group();
    const placed = new Set([`${startCell.c},${startCell.r}`]);
    this.state.totalKeys = keyCount;
    for (let i = 0; i < keyCount; i++) {
      const cell = this._randomOpenCellAvoid(placed, 5);
      placed.add(`${cell.c},${cell.r}`);
      const key = this._spriteOrFallback(this._cx(cell.c), this._cy(cell.r), 'collectible', sizes.key.w, sizes.key.h, { dynamic: false });
      key.setData('isKey', true);
      key.setDepth(8);
      this.keysGroup.add(key);
    }

    // Exit
    const exitCell = this._randomOpenCellAvoid(placed, 10);
    this.exit = this._spriteOrFallback(this._cx(exitCell.c), this._cy(exitCell.r), 'enemy_exit', sizes.player.w, sizes.player.h, { dynamic: false, keyFallbackColor: 0x66eeff });
    this.exit.setVisible(false).setActive(false).setData('isExit', true);

    // Ghosts
    this.ghosts = this.physics.add.group();
    const ghostsToSpawn = Math.max(1, gp.ghostCount ?? 3);
    for (let g = 0; g < ghostsToSpawn; g++) {
      const cell = this._randomOpenCellAvoid(placed, 8);
      placed.add(`${cell.c},${cell.r}`);
      const ghost = this._spriteOrFallback(this._cx(cell.c), this._cy(cell.r), 'demon_enemy', sizes.enemy.w + 20, sizes.enemy.h + 20, { dynamic: true, keyFallbackColor: 0xffffff });
      this._setTintSafe(ghost, 0xffffff);
      ghost.setDepth(9);
      this._fitBodyExact(ghost);
      ghost.body.setCollideWorldBounds(false);
      ghost.body.setBounce(0, 0);
      ghost.setDataEnabled();
      ghost.setData('mode', 'patrol');
      ghost.setData('vx', 0);
      ghost.setData('vy', 0);
      this.ghosts.add(ghost);
      this.physics.add.collider(ghost, this.walls);
    }

    // Overlaps & Collisions
    this.physics.add.overlap(this.player, this.keysGroup, (player, key) => {
      if (!key || !key.active) return;
      if (typeof key.disableBody === 'function') key.disableBody(true, true);
      else { if (key.body) this.physics.world.disable(key); key.setActive?.(false); key.setVisible?.(false); key.destroy?.(); }
      this._playSFX('collect');
      this.state.keysCollected++;
      this._updateUI();
      if (this.state.keysCollected >= this.state.totalKeys) {
        this.exit.setVisible(true).setActive(true);
        this.sys.tweens.add({ targets: this.exit, scaleX: 1.15, scaleY: 1.15, yoyo: true, duration: 300, repeat: 2 });
      }
    });

    this.physics.add.overlap(this.player, this.exit, () => {
      if (this.state.keysCollected >= this.state.totalKeys) this._win();
    });

    this.physics.add.overlap(this.player, this.ghosts, this._onPlayerEnemyTouch, null, this);

    // Inputs
    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
      shift: Phaser.Input.Keyboard.KeyCodes.SHIFT
    });

    // ✅ Bind keyboard with context so we can cleanly off() later
    this.input.keyboard.on('keydown-SHIFT', this._tryStartDash, this);
    this._keyboardBound = true;

    // Mobile buttons & swipe
    this._createMobileButtons();
    this._installVerticalSwipe();
    this.input.addPointer(3);

    // Camera
    cam.setBounds(0, 0, W, H);
    cam.startFollow(this.player, true, 0.15, 0.15);

    // UI
    const label = (cfg.texts && cfg.texts.score_label) || 'Keys: ';
    this.ui.scoreText = this.add.text(24, 24, `${label}0/${this.state.totalKeys}`, {
      fontFamily: (cfg.font && cfg.font.family) || 'Outfit, system-ui, Arial',
      fontSize: '28px', color: '#ffffff', stroke: '#000000', strokeThickness: 4
    }).setDepth(2000).setScrollFactor(0);

    this.ui.timerText = this.add.text(W - 24, 24, this._fmtTime(this.state.timerLeft), {
      fontFamily: (cfg.font && cfg.font.family) || 'Outfit, system-ui, Arial',
      fontSize: '28px', color: '#ffdd66', stroke: '#000000', strokeThickness: 4
    }).setOrigin(1, 0).setDepth(2000).setScrollFactor(0);

    // Flash cooldown bar
    const BAR_W = 320, BAR_H = 16;
    const barX = W / 2 - BAR_W / 2;
    const barY = 60;

    this.ui.flashBarBg = this.add.graphics().setScrollFactor(0).setDepth(2000);
    this.ui.flashBarBg.fillStyle(0x222222, 0.9);
    this.ui.flashBarBg.fillRoundedRect(barX, barY, BAR_W, BAR_H, 8);
    this.ui.flashBarBg.lineStyle(2, 0xffffff, 0.6);
    this.ui.flashBarBg.strokeRoundedRect(barX, barY, BAR_W, BAR_H, 8);

    this.ui.flashBarFill = this.add.graphics().setScrollFactor(0).setDepth(2001);
    this.ui.flashReadyText = this.add.text(W / 2, barY - 18, 'FLASH READY', {
      fontFamily: (cfg.font && cfg.font.family) || 'Outfit, system-ui, Arial',
      fontSize: '18px', color: '#ffe066', stroke: '#000000', strokeThickness: 3
    }).setOrigin(0.5, 1).setDepth(2002).setScrollFactor(0);

    this._renderFlashBar(1);

    // Dash VFX layers
    this._flashGfx = this.add.graphics().setDepth(1200).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    this._flashRing = this.add.graphics().setDepth(1201).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);

    // Audio
    this._initAudio(cfg);
    this._playBGM('bgm');

    // Timers (store refs so we can remove on shutdown)
    this._timers.push(
      this.time.addEvent({
        delay: 1000, loop: true,
        callback: () => {
          if (this.state.gameOver) return;
          this.state.timerLeft = Math.max(0, this.state.timerLeft - 1);
          this._updateUI();
          if (this.state.timerLeft === 0) this._lose();
        }
      })
    );

    this._timers.push(
      this.time.addEvent({
        delay: 700, loop: true,
        callback: () => {
          if (this.state.gameOver) return;
          const detectR2 = detectRadius * detectRadius;
          this.ghosts.children.iterate(g => {
            if (!g || !g.active) return;
            const dx = this.player.x - g.x;
            const dy = this.player.y - g.y;
            const dist2 = dx * dx + dy * dy;
            if (dist2 < detectR2) {
              g.setData('mode', 'chase');
              const norm = Math.sqrt(dist2) || 1;
              g.body.setVelocity((dx / norm) * ghostSpeed * ghostChaseMul, (dy / norm) * ghostSpeed * ghostChaseMul);
            } else {
              if (g.getData('mode') !== 'patrol') g.setData('mode', 'patrol');
              const pick = Phaser.Math.RND.pick([
                { vx: ghostSpeed, vy: 0 },
                { vx: -ghostSpeed, vy: 0 },
                { vx: 0, vy: ghostSpeed },
                { vx: 0, vy: -ghostSpeed },
              ]);
              g.body.setVelocity(pick.vx, pick.vy);
            }
          });
        }
      })
    );

    this._updateUI();
  }

  update(time, delta) {
    if (this.state.gameOver) return;
    const cfg = this.registry.get('cfg') || {};
    const gp = cfg.gameplay || {};
    const baseSpeed = gp.playerSpeed ?? 200;

    const left = (this.cursors?.left?.isDown || this.wasd?.left?.isDown || this.inputState.left) === true;
    const right = (this.cursors?.right?.isDown || this.wasd?.right?.isDown || this.inputState.right) === true;
    const up = (this.cursors?.up?.isDown || this.wasd?.up?.isDown || this.inputState.up) === true;
    const down = (this.cursors?.down?.isDown || this.wasd?.down?.isDown || this.inputState.down) === true;

    const now = this.time.now;

    // Flash cooldown UI
    const cd = Math.max(0, (this.state.nextDashAt || 0) - now);
    const readyRatio = Phaser.Math.Clamp(1 - (cd / (this._dashCfg.cooldownMs || 1)), 0, 1);
    this._renderFlashBar(readyRatio);
    if (this.ui.actionBtn) {
      const a = 0.5 + 0.5 * readyRatio;
      this.ui.actionBtn.setAlpha(a);
      this.ui.actionBtn.setTint(readyRatio >= 1 ? 0xffffaa : 0xffffff);
    }

    // Dashing
    if (this.state.dashing) {
      if (now >= this.state.dashEndsAt) {
        this.state.dashing = false;
        this.player.body.setVelocity(0, 0);
        this._flashGfx?.setVisible(false).clear();
      } else {
        this._renderDashGlow(this.player.x, this.player.y);
        this._clampToPlayArea(this.player);
        return;
      }
    }

    // Movement
    let vx = 0, vy = 0;
    if (left) vx -= baseSpeed;
    if (right) vx += baseSpeed;
    if (up) vy -= baseSpeed;
    if (down) vy += baseSpeed;
    if (vx !== 0 && vy !== 0) {
      const s = baseSpeed / Math.sqrt(2);
      vx = vx < 0 ? -s : s;
      vy = vy < 0 ? -s : s;
    }
    this.player.body.setVelocity(vx, vy);
    if (vx !== 0 || vy !== 0) {
      const len = Math.hypot(vx, vy) || 1;
      this._lastMoveDir.set(vx / len, vy / len);
    }

    this._clampToPlayArea(this.player);
  }

  _tryStartDash() {
    const now = this.time.now;
    if (now < this.state.nextDashAt || this.state.dashing || this.state.gameOver) return;

    const dir = new Phaser.Math.Vector2(this._lastMoveDir.x, this._lastMoveDir.y);
    if (dir.lengthSq() === 0) dir.set(1, 0);

    this.state.dashing = true;
    this.state.dashEndsAt = now + this._dashCfg.durationMs;
    this.state.nextDashAt = now + this._dashCfg.cooldownMs;
    this.state.invulnUntil = now + this._dashCfg.invulnMs;

    const v = dir.clone().normalize().scale(this._dashCfg.speed);
    this.player.setVelocity(v.x, v.y);
    this._dashVFXStart();
    // 3) Inside _tryStartDash(), right after this._dashVFXStart();
    this._dashVFXStart();
    this._playSFX('slice');   // 🔊 play dash/power SFX at the moment dash begins
    this._flashGfx?.setVisible(true);

    this._flashGfx?.setVisible(true);
  }

  _fitBodyToDisplay(obj, percent = 0.6) {
    if (!obj || !obj.body) return;
    const bw = Math.max(4, (obj.displayWidth || obj.width || 0) * percent);
    const bh = Math.max(4, (obj.displayHeight || obj.height || 0) * percent);
    obj.body.setSize(600, 900, false);
    const offX = ((obj.displayWidth || obj.width || 0) - bw) * 0.5;
    const offY = ((obj.displayHeight || obj.height || 0) - bh) * 0.5;
    obj.body.setOffset?.(offX, offY);
  }

  _fitBodyExact(obj) {
    if (!obj || !obj.body) return;
    if (typeof obj.body.setSize === 'function') obj.body.setSize(100, 100, true);
    obj.body.updateFromGameObject?.();
  }

  _renderFlashBar(ratio) {
    if (!this.ui.flashBarFill || !this.ui.flashBarBg) return;

    const W = this.sys.game.config.width;
    const BAR_W = 320, BAR_H = 16;
    const barX = W / 2 - BAR_W / 2;
    const barY = 60;

    this.ui.flashBarFill.clear();
    const color = ratio >= 1 ? 0xffe066 : 0xffcc33;
    this.ui.flashBarFill.fillStyle(color, 1);
    this.ui.flashBarFill.fillRoundedRect(barX, barY, BAR_W * ratio, BAR_H, 8);

    if (this.ui.flashReadyText) {
      const ready = ratio >= 1;
      this.ui.flashReadyText.setVisible(ready);
      if (ready && !this.ui._readyPulse) {
        this.ui._readyPulse = this.sys.tweens.add({
          targets: this.ui.flashReadyText,
          scale: { from: 1.0, to: 1.08 },
          duration: 600, yoyo: true, repeat: -1, ease: 'sine.inOut'
        });
      }
      if (!ready && this.ui._readyPulse) {
        this.ui._readyPulse.stop(); this.ui._readyPulse = null;
        this.ui.flashReadyText.setScale(1);
      }
    }
  }

  _dashVFXStart() {
    this._flashGfx?.setVisible(true).clear();
    if (!this._flashRing) return;
    const ring = this.add.graphics({ x: this.player.x, y: this.player.y }).setDepth(1201);
    ring.setBlendMode(Phaser.BlendModes.ADD);
    ring.lineStyle(6, 0xffe066, 0.9);
    ring.strokeCircle(0, 0, 24);
    this.sys.tweens.add({
      targets: ring, scale: 3.2, alpha: 0, duration: 180, ease: 'quad.out',
      onComplete: () => ring.destroy()
    });
  }

  _renderDashGlow(x, y) {
    if (!this._flashGfx) return;
    const cam = this.sys.cameras.main;
    const sx = x - cam.worldView.x;
    const sy = y - cam.worldView.y;
    const base = 58, jitter = 8;
    const r1 = base + Phaser.Math.Between(-jitter, jitter);
    const r2 = Math.floor(r1 * 1.55);
    this._flashGfx.clear();
    this._flashGfx.fillStyle(0xfff2a6, 0.95); this._flashGfx.fillCircle(sx, sy, r1 * 0.55);
    this._flashGfx.fillStyle(0xffe066, 0.45); this._flashGfx.fillCircle(sx, sy, r1);
    this._flashGfx.fillStyle(0xffd24d, 0.22); this._flashGfx.fillCircle(sx, sy, r2);
  }

  _updateUI() {
    if (this.ui.scoreText) {
      const label = ((this.registry.get('cfg') || {}).texts || {}).score_label || 'Keys: ';
      this.ui.scoreText.setText(`${label}${this.state.keysCollected}/${this.state.totalKeys}`);
    }
    if (this.ui.timerText) this.ui.timerText.setText(this._fmtTime(this.state.timerLeft));
  }

  _fmtTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  _initAudio(cfg) {
    const a = cfg.audio || {};
    const get = k => (a[k] && this.sound.add(k, { volume: 0.7 })) || null;
    this.sfx.collect = get('collect');
    this.sfx.hit = get('hit');
    this.sfx.win = get('win');
    this.sfx.lose = get('lose');
    this.bgm = (a.bgm && this.sound.add('bgm', { loop: true, volume: 0.35 })) || null;
    // 2) Inside _initAudio(cfg), after existing sfx assignments:
    this.sfx.slice = get('slice');
    this.sfx.slice?.setLoop(false);

  }
  _playBGM() { if (this.bgm && !this.bgm.isPlaying) this.bgm.play(); }
  _playSFX(name) { this.sfx[name]?.play(); }

  // Replace your _win() with this:
  _win() {
    if (this.state.gameOver) return;
    this.state.gameOver = true;

    const payload = { score: this.state.score || 0, timeLeft: this.state.timerLeft || 0, keys: this.state.keysCollected || 0 };
    const goNext = () => { this.bgm?.stop(); this.scene.start('WinScene', payload); };

    if (this.sfx.win) {
      // play and wait for completion, then transition
      this.sfx.win.once('complete', goNext);
      this.sfx.win.play();
    } else {
      goNext();
    }
  }


  _lose(reason = 'timeout') {
    if (this.state.gameOver) return;
    this.state.gameOver = true;
    (this.sfx.lose?.play() || this.sfx.hit?.play()); this.bgm?.stop();
    const payload = { score: this.state.score || 0, timeLeft: this.state.timerLeft || 0, keys: this.state.keysCollected || 0, reason };
    this.scene.start('GameOverScene', payload);
  }

  _generateMaze(cols, rows) {
    const grid = Array.from({ length: rows }, () => Array(cols).fill(1));
    const stack = []; const start = { c: 1, r: 1 };
    grid[start.r][start.c] = 0; stack.push(start);
    const dirs = [{ dc: 0, dr: -2 }, { dc: 0, dr: 2 }, { dc: -2, dr: 0 }, { dc: 2, dr: 0 }];
    const inBounds = (c, r) => c > 0 && c < cols - 1 && r > 0 && r < rows - 1;
    while (stack.length) {
      const cur = stack[stack.length - 1];
      const shuffled = Phaser.Utils.Array.Shuffle(dirs.slice());
      let carved = false;
      for (const d of shuffled) {
        const nc = cur.c + d.dc, nr = cur.r + d.dr;
        if (inBounds(nc, nr) && grid[nr][nc] === 1) {
          grid[cur.r + d.dr / 2][cur.c + d.dc / 2] = 0;
          grid[nr][nc] = 0; stack.push({ c: nc, r: nr }); carved = true; break;
        }
      }
      if (!carved) stack.pop();
    }
    return grid;
  }
  _buildWallsFromGrid(thickness) {
    const platformKey = 'platform';
    for (let r = 0; r < this.gridRows; r++) {
      for (let c = 0; c < this.gridCols; c++) {
        if (this.grid[r][c] === 1) {
          const wall = this._imageOrRect(this._cx(c), this._cy(r), platformKey, this.cellSize, this.cellSize, { color: 0x263238 });
          this.physics.add.existing(wall, true);
          wall.body?.setSize(this.cellSize, this.cellSize);
          wall.body?.updateFromGameObject?.();
          this.walls.add(wall);
        }
      }
    }
    const border = this.add.rectangle(this.playArea.centerX, this.playArea.centerY, this.playArea.width, this.playArea.height, 0x000000, 0)
      .setStrokeStyle(2, 0x0c1018, 1);
    this.physics.add.existing(border, true);
    border.body?.updateFromGameObject?.();
    this.walls.add(border);
  }

  _cx(c) { return this.playArea.x + c * this.cellSize + this.cellSize / 2; }
  _cy(r) { return this.playArea.y + r * this.cellSize + this.cellSize / 2; }
  _findOpenCellNear(c, r) { for (let rr = r; rr < Math.min(this.gridRows - 1, r + 4); rr++) { for (let cc = c; cc < Math.min(this.gridCols - 1, c + 4); cc++) { if (this.grid[rr][cc] === 0) return { c: cc, r: rr }; } } return null; }
  _randomOpenCellAvoid(usedSet, pad = 5) {
    let tries = 0;
    while (tries++ < 500) {
      const c = Phaser.Math.Between(1, this.gridCols - 2);
      const r = Phaser.Math.Between(1, this.gridRows - 2);
      if (this.grid[r][c] === 0) {
        let ok = true;
        for (const k of usedSet) {
          const [uc, ur] = k.split(',').map(n => parseInt(n));
          if (Math.abs(uc - c) + Math.abs(ur - r) < pad) { ok = false; break; }
        }
        if (ok) return { c, r };
      }
    }
    return { c: 1, r: 1 };
  }

  _spriteOrFallback(x, y, key, w, h, opts = {}) {
    const color = opts.keyFallbackColor ?? 0x4caf50;
    let obj;
    if (this.textures.exists(key)) {
      obj = this.physics.add.sprite(x, y, key);
      obj.setDisplaySize(w, h);
    } else {
      const rect = this.add.rectangle(x, y, w, h, color).setOrigin(0.5);
      this.physics.add.existing(rect, !!opts.static);
      obj = rect;
    }
    if (opts.dynamic && obj.body?.immovable) obj.body.immovable = false;
    return obj;
  }
  _imageOrRect(x, y, key, w, h, opts = {}) {
    if (this.textures.exists(key)) { const img = this.add.image(x, y, key); img.setDisplaySize(w, h); return img; }
    return this.add.rectangle(x, y, w, h, opts.color ?? 0x455a64).setOrigin(0.5);
  }
  _clampToPlayArea(obj) {
    const halfW = (obj.displayWidth || obj.width || 0) / 2;
    const halfH = (obj.displayHeight || obj.height || 0) / 2;
    obj.x = Phaser.Math.Clamp(obj.x, this.playArea.left + halfW, this.playArea.right - halfW);
    obj.y = Phaser.Math.Clamp(obj.y, this.playArea.top + halfH, this.playArea.bottom - halfH);
  }

  _createMobileButtons() {
    const W = this.sys.game.config.width;
    const H = this.sys.game.config.height;
    const BTN = 140, PAD = 22;
    const centerLX = 260;
    const rowY = H - (BTN / 2) - PAD;
    const upY = rowY - (BTN + PAD);
    const downY = rowY + (BTN + PAD);
    const actionX = W - (BTN / 2) - PAD;
    const actionY = H - (BTN / 2) - PAD;

    const defs = [
      { key: 'left', x: centerLX - (BTN + PAD) + 50, y: rowY - 50, onDown: () => this.inputState.left = true, onUp: () => this.inputState.left = false },
      { key: 'right', x: centerLX + (BTN + PAD) + 50, y: rowY - 50, onDown: () => this.inputState.right = true, onUp: () => this.inputState.right = false },
      { key: 'up', x: centerLX + 50, y: upY - 50, onDown: () => this.inputState.up = true, onUp: () => this.inputState.up = false },
      { key: 'down', x: centerLX + 50, y: downY - 130, onDown: () => this.inputState.down = true, onUp: () => this.inputState.down = false },
      { key: 'action', x: actionX, y: actionY, onDown: () => this._tryStartDash(), onUp: () => { } },
    ];

    defs.forEach(def => {
      let btn;
      if (this.textures.exists(def.key)) {
        btn = this.add.image(def.x, def.y, def.key).setInteractive({ useHandCursor: true });
        btn.setDisplaySize(BTN, BTN);
      } else {
        btn = this.add.rectangle(def.x, def.y, BTN, BTN, 0x3949ab, 0.55).setInteractive();
      }
      btn.setScrollFactor(0).setDepth(1600);
      btn.on('pointerdown', (p) => { def.onDown(); btn.setScale(0.5).setAlpha(0.9); p.event?.preventDefault?.(); });
      const release = () => { def.onUp(); btn.setScale(0.5).setAlpha(1); };
      btn.on('pointerup', release);
      btn.on('pointerout', release);
      btn.on('pointerupoutside', release);
      btn.on('pointercancel', release);
      btn.on('pointerleave', release);
      if (def.key === 'action') this.ui.actionBtn = btn;
      this._uiButtons.push(btn); // 🔒 track for cleanup
    });
  }

  _setTintSafe(obj, color) {
    if (obj?.setTint) obj.setTint(color);
    else obj?.setFillStyle?.(color, 1);
  }

  _onPlayerEnemyTouch(player, enemy) {
    const now = this.time.now;
    const kill = (obj) => {
      if (!obj || !obj.active) return;
      if (typeof obj.disableBody === 'function') obj.disableBody(true, true);
      else { if (obj.body) this.physics.world.disable(obj); obj.setActive?.(false); obj.setVisible?.(false); obj.destroy?.(); }
    };

    if (this.state.dashing) {
      kill(enemy); this.state.score += 10; return;
    }
    if (now < this.state.invulnUntil) return;

    this.state.hp = Math.max(0, this.state.hp - 1);
    this.state.invulnUntil = now + 600;

    const away = new Phaser.Math.Vector2(player.x - enemy.x, player.y - enemy.y).normalize().scale(260);
    player.setVelocity(away.x, away.y);
    if (this.state.hp <= 0) this._lose();
  }

  _installVerticalSwipe() {
    const W = this.sys.game.config.width, H = this.sys.game.config.height;
    const zone = this.add.zone(W * 0.55, H * 0.4, W * 0.9, H * 0.8).setOrigin(0.5);
    zone.setScrollFactor(0).setDepth(1500).setInteractive();
    let startY = null;
    zone.on('pointerdown', p => { startY = p.position.y; });
    zone.on('pointermove', p => {
      if (startY === null) return;
      const dy = p.position.y - startY;
      const threshold = 18;
      this.inputState.up = dy < -threshold;
      this.inputState.down = dy > threshold;
    });
    const reset = () => { startY = null; this.inputState.up = false; this.inputState.down = false; };
    zone.on('pointerup', reset);
    zone.on('pointerout', reset);
    this._uiButtons.push(zone); // track to destroy on shutdown
  }

  // 🔧 CLEANUP: called automatically on scene stop/start (replay)
  _onShutdown() {
    try {
      // Stop sounds
      if (this.bgm?.isPlaying) this.bgm.stop();
      Object.values(this.sfx).forEach(s => { try { s?.stop(); } catch (_) { } });

      // Kill timers
      this._timers.forEach(t => { try { t?.remove(false); } catch (_) { } });
      this._timers = [];

      // Kill tweens created by this scene
      this.sys.tweens.killAll();

      // Remove keyboard listener
      if (this._keyboardBound) {
        this.input.keyboard.off('keydown-SHIFT', this._tryStartDash, this);
        this._keyboardBound = false;
      }

      // Destroy UI buttons / zones
      this._uiButtons.forEach(b => { try { b?.destroy(true); } catch (_) { } });
      this._uiButtons = [];
      this.ui.actionBtn = null;

      // Destroy graphics
      [this._flashGfx, this._flashRing, this.ui.flashBarBg, this.ui.flashBarFill].forEach(g => { try { g?.destroy(true); } catch (_) { } });
      this._flashGfx = null; this._flashRing = null;
      [this.ui.flashReadyText, this.ui.scoreText, this.ui.timerText].forEach(t => { try { t?.destroy(); } catch (_) { } });
      if (this.ui._readyPulse) { try { this.ui._readyPulse.stop(); } catch (_) { } this.ui._readyPulse = null; }

      // Destroy masks/darkness
      try { this.lightMask?.destroy(); } catch (_) { }
      try { this.darkness?.destroy(); } catch (_) { }
      try { this.lightGfx?.destroy(); } catch (_) { }
      this.lightMask = this.darkness = this.lightGfx = null;

      // Clear physics groups
      const clearGroup = g => { try { g?.clear(true, true); } catch (_) { } };
      clearGroup(this.keysGroup); this.keysGroup = null;
      clearGroup(this.ghosts); this.ghosts = null;
      clearGroup(this.walls); this.walls = null;

      // Player
      try { this.player?.destroy(true); } catch (_) { }
      this.player = null;
    } catch (e) {
      // swallow cleanup errors to avoid blocking replay
      // console.warn('Shutdown cleanup error', e);
    }
  }
}
// export default GameScene;
