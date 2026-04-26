class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
    this.state = {
      floor: 1,
      kills: 0,
      cleared: false,
      invulnUntil: 0,
      nextAttackAt: 0,
      timerLeft: 0,
    };
    this.akazaIsActive = false;
    this.playerIsDead = false;
    // 👇 separated buttons
    this.inputState = { left: false, right: false, jump: false, attack: false };
  }

  init() {
    // track timers / delayed calls so we can clean them on restart
    this._scheduled = [];
    this._mainTimer = null;
  }


  preload() {
    // --- GLOBAL Tween Firewall (catches any scene/manager) ---
    (function () {
      const proto = Phaser.Tweens.TweenManager && Phaser.Tweens.TweenManager.prototype;
      if (!proto || proto.__guardInstalled) return;
      const _origAdd = proto.add;

      proto.add = function (cfg) {
        if (!cfg || typeof cfg !== 'object') {
          console.error('[GLOBAL Tween Firewall] add called with:', cfg);
          console.trace(); // <-- shows exact caller outside your scene too
          return null;     // prevent Phaser from reading cfg.duration
        }
        // Optional extra sanity: ensure minimal valid keys exist
        if (!cfg.targets) {
          console.error('[GLOBAL Tween Firewall] Missing `targets` in tween cfg:', cfg);
          console.trace();
          return null;
        }
        return _origAdd.call(this, cfg);
      };

      proto.__guardInstalled = true;
    })();

    const cfg = this.registry.get('cfg') || {};
    const images = cfg.images1 || {};
    const images2 = cfg.images2 || {};
    const ui = cfg.ui || {};
    const sheets = cfg.spritesheets || {};

    this._purgeAnimations();

    // remove any existing textures for all sheet keys (you already do this)
    Object.keys(sheets).forEach(k => {
      if (this.textures.exists(k)) this.textures.remove(k);
    });

    // ---- SPECIAL LOAD FOR akaza_boss (avoid clobber + bust cache) ----
    if (sheets.akaza_boss && sheets.akaza_boss.url) {
      const s = sheets.akaza_boss;
      const tempKey = '__akaza_boss_sheet__';

      // load with cache-buster to avoid stale single-frame image
      this.load.spritesheet(tempKey, `${s.url}?v=${Date.now()}`, {
        frameWidth: s.frameWidth || 64,
        frameHeight: s.frameHeight || 64,
        ...(s.frames ? { endFrame: s.frames - 1 } : {})
      });

      // when it’s loaded, rename to the canonical key
      this.load.once(`filecomplete-spritesheet-${tempKey}`, () => {
        // if anything already claimed 'akaza_boss', nuke it first
        if (this.textures.exists('akaza_boss')) this.textures.remove('akaza_boss');
        this.textures.renameTexture(tempKey, 'akaza_boss');
      });
    }

    // ---- load the rest of the spritesheets (excluding akaza_boss we just handled) ----
    Object.entries(sheets).forEach(([k, s]) => {
      if (k === 'akaza_boss') return; // skip; handled above
      if (s && s.url) {
        this.load.spritesheet(k, s.url, {
          frameWidth: s.frameWidth || 64,
          frameHeight: s.frameHeight || 64,
          ...(s.frames ? { endFrame: s.frames - 1 } : {})
        });
      }
    });

    // ---- images: still skip any key that’s also a spritesheet ----
    Object.entries(images).forEach(([k, url]) => {
      if (sheets[k]) return;
      if (typeof url === 'string') this.load.image(k, url);
    });

    Object.entries(images2).forEach(([k, url]) => {
      if (sheets[k]) return;
      if (typeof url === 'string') this.load.image(k, url);
    });

    Object.entries(ui).forEach(([k, url]) => {
      if (typeof url === 'string') this.load.image(k, url);
    });

    // 4) Audio (unchanged)
    const audio = cfg.audio || {};
    Object.entries(audio).forEach(([k, url]) => {
      if (typeof url === 'string') this.load.audio(k, url);
    });
  }

  create() {
    const cfg = this.registry.get('cfg') || {};
    const gameplay = cfg.gameplay || {};
    const audio = cfg.audio || {};
    const gconf = this.sys.config || this.sys.game.config;
    const width = Number(gconf.width) || 1080;
    const height = Number(gconf.height) || 1920;

    if (!this.physics || !this.physics.world) {
      console.warn('[GameScene] Arcade Physics not ready on create(); restarting scene once.');
      this.scene.restart();  // one soft retry
      return;
    }
    this.physics.world.setBounds(0, 0, width, height);

    // Physics & world
    this.physics.world.setBounds(0, 0, width, height);
    this.state.timerLeft = gameplay.timerSeconds ?? 90;
    this.playerMaxHP = gameplay.playerMaxHealth ?? 5;
    this.playerHP = this.playerMaxHP;
    this.targetFloors = gameplay.targetFloors ?? 15;

    // Background
    this._ensureTexture('demon_slayer_background', width, height, 0x0d0d22);
    this.bg = this.add.image(width / 2, height / 2, this._keyOr('demon_slayer_background')).setDepth(-10);
    this.bg.setDisplaySize(width, height);

    // Platforms
    this.platforms = this.physics.add.staticGroup();
    const groundKey = this._ensureTexture('platform', 400, 48, 0x333333);
    const ground = this.platforms.create(width / 2, height - 32, groundKey);
    ground.setDisplaySize(width, 64).refreshBody();

    // Player
    const pKey = this._ensureTexture('player', 96, 96, 0x55ddff);
    this.player = this.physics.add.sprite(width / 2, height - 96 - 64, pKey).setDepth(5);
    this.player.setDisplaySize(120, 220);
    this.player.setCollideWorldBounds(true);
    this.player.body.setMaxVelocity(1200, 2400);
    this.player.body.setSize(this.player.width * 0.55, this.player.height * 0.8, true);
    this.player.setDragX(1200);
    this.playerFacing = 1;

    if (this.textures.exists('player') && this.textures.get('player').frameTotal >= 4) {
      if (!this.anims.exists('player_idle')) {
        this.anims.create({
          key: 'player_idle',
          frames: [{ key: 'player', frame: 0 }],
          frameRate: 1,
          repeat: -1
        });
      }
      if (!this.anims.exists('player_attack')) {
        this.anims.create({
          key: 'player_attack',
          frames: this.anims.generateFrameNumbers('player', { start: 1, end: 3 }),
          frameRate: 12,
          repeat: 0
        });
      }
      this.player.play('player_idle');
    }

    // Physics settings
    this.physics.world.gravity.y = (gameplay.gravityY ?? 1200);

    // Groups
    this.enemies = this.physics.add.group({ runChildUpdate: true });
    this.projectiles = this.physics.add.group();
    this.collectibles = this.physics.add.group();

    // Create enemy animations if a spritesheet is present
    if (this.textures.exists('enemy') && this.textures.get('enemy').frameTotal >= 2) {
      this._createEnemyAnims('enemy');
    }

    for (let i = 1; i <= 15; i++) {
      const bossKey = (i === 1) ? 'akaza_boss' : `akaza${i}_boss`;
      const animKey = (i === 1) ? 'akaza_loop' : `akaza${i}_loop`;

      if (this.textures.exists(bossKey)) {
        const tex = this.textures.get(bossKey);
        const ft = tex.frameTotal || 1;
        if (ft >= 2 && !this.anims.exists(animKey)) {
          this.anims.create({
            key: animKey,
            frames: this.anims.generateFrameNumbers(bossKey, { start: 0, end: ft - 1 }),
            frameRate: 8,
            repeat: -1
          });
        } else {
          console.warn(`[BossAnim] Skipping anim ${animKey} for ${bossKey} (frameTotal=${ft})`);
        }
      }
    }




    // Colliders/Overlaps
    this.physics.add.collider(this.player, this.platforms);
    this.physics.add.collider(this.enemies, this.platforms);
    this.physics.add.collider(this.collectibles, this.platforms);
    this.physics.add.collider(this.projectiles, this.platforms, (proj) => proj.destroy(), null, this);
    this.physics.add.overlap(this.player, this.enemies, this._onPlayerHitEnemy, null, this);
    this.physics.add.overlap(this.player, this.projectiles, this._onPlayerHitProjectile, null, this);
    this.physics.add.overlap(this.player, this.collectibles, (pl, col) => {
      col.destroy();
      this._playSfx('collect');
      this.playerHP = Math.min(this.playerMaxHP, this.playerHP + 1);
      this._updateHUD();
    });

    // HUD
    const texts = cfg.texts || {};
    const scoreLabel = texts.score_label || 'Score: ';
    this.scoreText = this.add.text(24, 24, `${scoreLabel}0`, { fontFamily: (cfg.font?.family || 'sans-serif'), fontSize: '36px', color: '#ffffff' }).setDepth(20).setScrollFactor(0);
    this.floorText = this.add.text(width / 2, 24, `Wave 1/${this.targetFloors}`, { fontFamily: (cfg.font?.family || 'sans-serif'), fontSize: '36px', color: '#f2d16b' }).setOrigin(0.5, 0).setDepth(20).setScrollFactor(0);
    this.hpText = this.add.text(24, 72, `HP: ${this.playerHP}/${this.playerMaxHP}`, { fontFamily: (cfg.font?.family || 'sans-serif'), fontSize: '36px', color: '#ff7777' }).setDepth(20).setScrollFactor(0);
    this.timerText = this.add.text(width - 24, 24, `${this.state.timerLeft}s`, { fontFamily: (cfg.font?.family || 'sans-serif'), fontSize: '36px', color: '#9be7ff' }).setOrigin(1, 0).setDepth(20).setScrollFactor(0);


    this.input.addPointer(3);
    // Mobile Controls (now 4 buttons)
    this._createMobileButtons(); // left/right/jump/attack

    // Keyboard
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keyA = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.keyD = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    this.keyW = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.keySPACE = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE); // attack

    // Audio
    this._safeMusic(audio.bgm ? 'bgm' : null);

    // Safely create the SFX object
    this._sfx = {};
    const sfxConfig = {
      attack: { volume: 0.7 },
      hit: { volume: 0.7 },
      collect: { volume: 0.8 },
      destroy: { volume: 0.8 },
      jump: { volume: 0.7 }
    };

    // Only add sounds that have been loaded successfully
    Object.entries(sfxConfig).forEach(([key, config]) => {
      if (this.cache.audio.exists(key)) {
        this._sfx[key] = this.sound.add(key, config);
      }
    });


    // Start first floor
    this._buildFloorLayout();
    this._spawnWaveForFloor();

    // Timer
    this._mainTimer = this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        this.state.timerLeft--;
        this._updateHUD();
        if (this.state.timerLeft <= 0) this._lose();
      }
    });


    // --- DEBUG/FIREWALL for TweenManager ---
    if (!this.__tweenGuardInstalled) {
      this.__tweenGuardInstalled = true;
      const _origAdd = this.tweens.add.bind(this.tweens);
      this.tweens.add = (cfg) => {
        if (!cfg || typeof cfg !== 'object') {
          console.error('[Tween Firewall] this.tweens.add called with:', cfg);
          console.trace(); // <-- shows the exact caller
          return null;     // prevent Phaser from trying to read cfg.duration
        }
        return _origAdd(cfg);
      };
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this._onShutdown, this);
    this.events.once(Phaser.Scenes.Events.DESTROY, this._onShutdown, this);


  }

  update() {
    const cfg = this.registry.get('cfg') || {};
    const gameplay = cfg.gameplay || {};
    const gconf = this.sys.config || this.sys.game.config;
    const width = Number(gconf.width) || 1080;

    const moveSpeed = gameplay.playerSpeed ?? 380;
    const jumpSpeed = gameplay.jumpSpeed ?? 560;

    // Inputs
    const leftHeld = this.inputState.left || this.cursors.left.isDown || this.keyA.isDown;
    const rightHeld = this.inputState.right || this.cursors.right.isDown || this.keyD.isDown;
    const jumpHeld = this.inputState.jump || this.cursors.up.isDown || this.keyW.isDown;
    const attackPressed = Phaser.Input.Keyboard.JustDown(this.keySPACE) || this._consumeTapAttack;

    // Movement
    if (leftHeld && !rightHeld) {
      this.player.setVelocityX(-moveSpeed);
      this.playerFacing = -1;
      this.player.setFlipX(true);
    } else if (rightHeld && !leftHeld) {
      this.player.setVelocityX(moveSpeed);
      this.playerFacing = 1;
      this.player.setFlipX(false);
    } else {
      // light friction handled by dragX
    }

    // JUMP is separate now
    if (jumpHeld && this.player.body.touching.down) {
      this.player.setVelocityY(-jumpSpeed);
      this._playSfx('jump');
    }

    // ATTACK is separate now
    if (attackPressed) {
      this._consumeTapAttack = false;
      this._attack();
    }

    // Clean projectiles off-screen
    this.projectiles.children.iterate((p) => {
      if (!p) return;
      if (p.x < -64 || p.x > width + 64 || p.y < -64 || p.y > (this.sys.config?.height || this.sys.game.config.height) + 64) p.destroy();
    });

    // Wave clear -> stairs
    // if (!this.state.cleared && this.enemies.countActive(true) === 0 && this.pendingEnemies === 0) {
    //   // If it's a boss floor (1-15) and the boss hasn't been spawned yet
    //   if (this.state.floor >= 1 && this.state.floor <= 15 && !this.akazaIsActive) {
    //     this.akazaIsActive = true;  // Use the same flag to indicate a boss is active
    //     this._spawnFloorBoss();     // Call the new generic boss spawn function
    //   } else {
    //     // Normal behavior for non-boss floors or after a boss is defeated
    //     this.state.cleared = true;
    //     this._spawnStairs();
    //   }
    // }

    // In update(), right before spawning boss / stairs
    if (!this.state.cleared && this.enemies.countActive(true) === 0 && this.pendingEnemies === 0) {
      console.log('[WaveClear]', { floor: this.state.floor, kills: this.state.kills, pending: this.pendingEnemies });
      if (this.state.floor >= 1 && this.state.floor <= 15 && !this.akazaIsActive) {
        this.akazaIsActive = true;
        console.log('[SpawnFloorBoss] about to spawn', this.state.floor);
        this._spawnFloorBoss();
      } else {
        this.state.cleared = true;
        console.log('[SpawnStairs]');
        this._spawnStairs();
      }
    }

  }

  // ---------- Shutdown / Cleanup ----------
  _onShutdown = () => {
    this._purgeAnimations();
    // Stop main tick timer
    try { this._mainTimer && this._mainTimer.remove && this._mainTimer.remove(); } catch { }
    this._mainTimer = null;

    // Cancel any delayed calls you tracked
    if (Array.isArray(this._scheduled)) {
      this._scheduled.forEach(ev => { try { ev && ev.remove && ev.remove(); } catch { } });
      this._scheduled = [];
    }

    // Kill tweens and pending time events
    try { this.tweens && this.tweens.killAll && this.tweens.killAll(); } catch { }
    try { this.time && this.time.removeAllEvents && this.time.removeAllEvents(); } catch { }

    // Clear physics groups
    try { this.enemies && this.enemies.clear && this.enemies.clear(true, true); } catch { }
    try { this.projectiles && this.projectiles.clear && this.projectiles.clear(true, true); } catch { }
    try { this.collectibles && this.collectibles.clear && this.collectibles.clear(true, true); } catch { }

    // Stop music/SFX
    try { this.music && this.music.stop && this.music.stop(); } catch { }

    // Remove keyboard listeners
    try { this.input && this.input.keyboard && this.input.keyboard.removeAllKeys(true); } catch { }

    // Remove any scene-level event listeners you might add later
    // try { this.events && this.events.removeAllListeners && this.events.removeAllListeners(); } catch { }
  };

  // Put this in your class
  _purgeAnimations() {
    if (!this.anims) return;
    // all keys your scene may create
    const bossKeys = Array.from({ length: 15 }, (_, i) => i === 0 ? 'akaza_loop' : `akaza${i + 1}_loop`);
    const keys = [
      'player_idle', 'player_attack',
      'enemy_walk', 'enemy_attack',
      ...bossKeys
    ];
    keys.forEach(k => { if (this.anims.exists(k)) this.anims.remove(k); });
  }



  // BOSS CHANGE: Renamed and updated to handle any floor boss
  _spawnFloorBoss() {
    const gconf = this.sys.config || this.sys.game.config;
    const width = Number(gconf.width) || 1080;
    const height = Number(gconf.height) || 1920;
    const floor = this.state.floor;

    // Dynamically determine the boss's texture key and animation key
    const bossKey = (floor === 1) ? 'akaza_boss' : `akaza${floor}_boss`;
    const animKey = (floor === 1) ? 'akaza_loop' : `akaza${floor}_loop`;

    console.log('[SpawnFloorBoss] creating boss', { floor, bossKey, animKey });
    const boss = this.enemies.create(width / 2, height - 200, bossKey);

    this._fitToSheet(boss, bossKey, 228, 0.5, 0.8);
    // in _spawnFloorBoss()
    const tex = this.textures.get(bossKey);
    const ft = tex?.frameTotal || 1;

    if (this.anims.exists(animKey)) {
      boss.play(animKey);
    } else if (ft >= 2 && boss.setFrame) {
      boss.setFrame(0); // only if it’s really a spritesheet
    }
    // else: single-frame image will render normally



    boss.setCollideWorldBounds(true);
    boss.body.setBounce(0.1);

    // HP starts at 8 on floor 1 and increases by 1 for each subsequent floor
    boss.hp = 7 + floor;

    boss.speed = 180 + (floor * 5); // Make him slightly faster on higher floors
    boss.isAkaza = true; // Flag remains useful to identify these special bosses

    // boss.play(animKey);
    console.log('[SpawnFloorBoss] boss spawned');
    // AI for the boss
    boss.update = () => {
      if (!boss.active) return;
      const speed = boss.speed;
      // Basic AI: Move towards the player
      if (this.player.x < boss.x - 10) {
        boss.setVelocityX(-speed);
        boss.setFlipX(true);
      } else if (this.player.x > boss.x + 10) {
        boss.setVelocityX(speed);
        boss.setFlipX(false);
      } else {
        boss.setVelocityX(0);
      }
    };
  }

  _createEnemyAnims(sheetKey) {
    const total = this.textures.get(sheetKey).frameTotal;

    if (!this.anims.exists('enemy_walk')) {
      this.anims.create({
        key: 'enemy_walk',
        // ✅ CHANGED: Use all 3 frames (0, 1, 2) for the looping walk animation
        frames: this.anims.generateFrameNumbers(sheetKey, { start: 0, end: 2 }),
        frameRate: 8,
        repeat: -1 // -1 means it will loop forever
      });
    }

    if (!this.anims.exists('enemy_attack')) {
      // This uses frames 1 and 2 for the attack animation. You can leave this as is,
      // or change it if you have specific attack frames.
      const attackFrames = (total >= 3)
        ? this.anims.generateFrameNumbers(sheetKey, { start: 1, end: 2 }) // frames 1..2
        : [{ key: sheetKey, frame: 1 }]; // fallback

      this.anims.create({
        key: 'enemy_attack',
        frames: attackFrames,
        frameRate: 10,
        repeat: 0 // 0 means it plays once
      });
    }
  }

  _enemyDoAttackAnimation(enemySprite) {
    if (!enemySprite || !enemySprite.anims) return;
    if (this.anims.exists('enemy_attack')) {
      enemySprite.play('enemy_attack', true);
      enemySprite.once('animationcomplete-enemy_attack', () => {
        if (enemySprite.active && this.anims.exists('enemy_walk')) { // ✅ CHANGED
          enemySprite.play('enemy_walk'); // ✅ CHANGED
        }
      });
    }
  }


  // ---------- Floor / Waves ----------
  _buildFloorLayout() {
    this.platforms.children.iterate((child) => {
      if (child && child !== this.platforms.children.entries[0]) { child.destroy(); }
    });

    const gconf = this.sys.config || this.sys.game.config;
    const width = Number(gconf.width) || 1080;
    const height = Number(gconf.height) || 1920;
    const k = this._ensureTexture('platform', 200, 36, 0x2c2c2c);

    const y1 = height - 400;
    const y2 = height - 750;
    const pad = 180;

    const ledge1 = this.platforms.create(pad, y1, k);
    ledge1.setDisplaySize(360, 36).refreshBody();
    const ledge2 = this.platforms.create(width - pad, y2, k);
    ledge2.setDisplaySize(360, 36).refreshBody();
  }

  _spawnWaveForFloor() {
    const cfg = this.registry.get('cfg') || {};
    const gameplay = cfg.gameplay || {};
    const baseRate = gameplay.enemySpawnRate ?? 2500;
    const baseSpeed = gameplay.enemyBaseSpeed ?? 100;
    const floor = this.state.floor;

    let enemyCount = 4 + Math.floor(floor * 0.8);
    let shooters = Math.floor(floor / 3);
    if (floor % 5 === 0 && floor > 15) { // Only run for floors 20, 25, etc.
      enemyCount = 1; shooters = 0;
      this.time.delayedCall(600, () => this._spawnBoss(), null, this);
      this.pendingEnemies = 0;
      return;
    }

    this.pendingEnemies = enemyCount;
    const spawnDelay = Math.max(600, baseRate - floor * 120);

    for (let i = 0; i < enemyCount; i++) {
      this.time.delayedCall(i * spawnDelay, () => {
        const isShooter = shooters > 0 && Math.random() < 0.35;
        if (isShooter) shooters--;
        this._spawnEnemy(isShooter, baseSpeed + floor * 8);
        this.pendingEnemies--;
      });
    }
  }

  // AKAZA CHANGE: New function to spawn Akaza boss
  _spawnAkaza() {
    const gconf = this.sys.config || this.sys.game.config;
    const width = Number(gconf.width) || 1080;
    const height = Number(gconf.height) || 1920;

    // Spawn Akaza in the middle of the screen
    const akaza = this.enemies.create(width / 2, height - 200, 'akaza_boss');

    // Use the same fitting function for consistency
    this._fitToSheet(akaza, 'akaza_boss', 228, 0.5, 0.8);

    akaza.setCollideWorldBounds(true);
    akaza.body.setBounce(0.1);
    akaza.hp = 8; // Double the HP of a normal enemy (2 * 2)
    akaza.speed = 180; // Make him a bit faster
    akaza.isAkaza = true; // Custom flag to identify him

    akaza.play('akaza_loop'); // Play his looping animation

    // AI for Akaza
    akaza.update = () => {
      if (!akaza.active) return;
      const speed = akaza.speed || 180;
      // Basic AI: Move towards the player
      if (this.player.x < akaza.x - 10) {
        akaza.setVelocityX(-speed);
        akaza.setFlipX(true);
      } else if (this.player.x > akaza.x + 10) {
        akaza.setVelocityX(speed);
        akaza.setFlipX(false);
      } else {
        akaza.setVelocityX(0);
      }
    };
  }

  _spawnEnemy(isShooter, speed) {
    const gconf = this.sys.config || this.sys.game.config;
    const width = Number(gconf.width) || 1080;
    const height = Number(gconf.height) || 1920;
    const eKey = this._ensureTexture('enemy', 72, 72, 0xff5566);

    const side = Math.random() < 0.5 ? -1 : 1;
    const ex = side < 0 ? -40 : width + 40;
    const ey = height - 200 - Math.random() * 500;
    const e = this.enemies.create(ex, ey, eKey);

    // ✅ size + origin + body fitted to sheet (uses 780×737 aspect or cfg if present)
    this._fitToSheet(e, 'enemy', 130 /* target display height px */, 0.52 /* bodyW% */, 0.62 /* bodyH% */);

    e.setCollideWorldBounds(true);
    e.body.setBounce(0.1);
    e.hp = 2;
    e.speed = speed || 160;
    e.isShooter = !!isShooter;

    // Play idle if anims exist
    if (this.anims.exists('enemy_walk')) e.play('enemy_walk');


    // Basic AI update
    // Inside _spawnEnemy(isShooter, speed)

    // Basic AI update
    e.update = () => {
      if (!e.active) return;
      if (this.player.x < e.x - 8) {
        e.setVelocityX(-e.speed);
        e.setFlipX(true); // ✅ FLIP ADDED: Face left
      } else if (this.player.x > e.x + 8) {
        e.setVelocityX(e.speed);
        e.setFlipX(false); // ✅ FLIP ADDED: Face right
      } else {
        e.setVelocityX(0);
      }

      if (e.isShooter && Math.abs(this.player.x - e.x) < 350 && Math.random() < 0.01) {
        this._enemyShoot(e);
        this._enemyDoAttackAnimation(e);
      }
    };
  }


  _spawnBoss() {
    const gconf = this.sys.config || this.sys.game.config;
    const width = Number(gconf.width) || 1080;
    const height = Number(gconf.height) || 1920;
    const bKey = this._ensureTexture('boss', 140, 140, 0xaa55ff);

    const b = this.enemies.create(width / 2, height - 480, bKey);
    b.setDisplaySize(140, 140);
    b.setCollideWorldBounds(true);
    b.body.setBounce(0.2);
    b.hp = 12 + Math.floor(this.state.floor * 0.6);
    b.speed = 160 + this.state.floor * 6;
    b.isBoss = true;

    b.update = () => {
      if (!b.active) return;
      const dx = this.player.x - b.x;
      b.setVelocityX(Math.sign(dx) * b.speed);
      if (Math.random() < 0.02) this._enemyShoot(b, true);
    };
  }
  _fitToSheet(gameObject, textureKey, targetDisplayHeight, bodyWidthPercent = 1.0, bodyHeightPercent = 1.0) {
    if (!gameObject || !this.textures.exists(textureKey)) {
      console.warn(`Texture key not found: ${textureKey}`);
      return;
    }

    const tex = this.textures.get(textureKey);
    const frame = tex.getSourceImage();
    if (!frame) return;

    const w = frame.width;
    const h = frame.height;
    const aspect = 1;

    const newDisplayHeight = 150;
    const newDisplayWidth = 110; // Calculate width based on height and aspect ratio

    // ✅ FIX: Use the calculated dimensions to prevent stretching
    gameObject.setDisplaySize(120, 220);
    gameObject.setOrigin(0.5, 0.5);

    // ✅ FIX: Apply the same calculated dimensions to the physics body
    if (gameObject.body) {
      gameObject.body.setSize(110, 150, true);
    }
  }
  _enemyShoot(source, heavy = false) {
    const pKey = this._ensureTexture('projectile', 18, 18, 0xffaa33);
    const p = this.projectiles.create(source.x, source.y, pKey);
    p.setDisplaySize(18, 18);
    const dir = Math.sign((this.player.x + this.player.body.velocity.x * 0.15) - source.x) || 1;
    const spd = heavy ? 460 : 360;
    p.setVelocity(dir * spd, -40 + Math.random() * 80);

    // ensure attack anim even for bosses/non-shooters that call this
    this._enemyDoAttackAnimation(source);
  }


  _spawnStairs() {
    const gconf = this.sys.config || this.sys.game.config;
    const width = Number(gconf.width) || 1080;
    const height = Number(gconf.height) || 1920;
    const sKey = this._ensureTexture('stairs', 120, 64, 0x66ffaa);
    const stairs = this.physics.add.staticSprite(width - 120, height - 120, sKey).setDepth(2);
    stairs.setDisplaySize(140, 80).refreshBody();
    this.stairs = stairs;

    this.nextFloorHint = this.add.text(width - 120, height - 180, 'Next Wave ▶', {
      fontFamily: (this.registry.get('cfg')?.font?.family || 'sans-serif'),
      fontSize: '28px',
      color: '#a8ffcf'
    }).setOrigin(0.5, 1).setDepth(5).setScrollFactor(0);

    this.physics.add.overlap(this.player, stairs, () => {
      if (!this.state.cleared) return;
      if (this.inputState.jump || this.cursors.up.isDown || this.keyW.isDown) this._nextFloor();
    });
  }

  _nextFloor() {
    if (this.stairs) { this.stairs.destroy(); this.stairs = null; }
    if (this.nextFloorHint) { this.nextFloorHint.destroy(); this.nextFloorHint = null; }

    this.state.cleared = false;
    this.state.floor++;
    this.floorText.setText(`Floor ${this.state.floor}/${this.targetFloors}`);

    this.akazaIsActive = false;

    this.playerHP = Math.min(this.playerMaxHP, this.playerHP + 1);
    this._updateHUD();

    if (this.state.floor > this.targetFloors) {
      this._win();
      return;
    }

    this._buildFloorLayout();
    this._spawnWaveForFloor();
  }

  // ---------- Combat ----------
  _attack() {
    const now = this.time.now;
    if (now < this.state.nextAttackAt) return;
    this.state.nextAttackAt = now + 280;

    this._playSfx('attack');

    // If we have the anims, play attack (frames 1..3), then return to idle
    if (this.anims.exists('player_attack') && this.player.anims) {
      this.player.play('player_attack', true);
      // Spawn the hitbox slightly after starting the swing
      this.time.delayedCall(100, () => this._spawnAttackHitbox());
      this.player.once('animationcomplete-player_attack', () => {
        if (this.player && this.player.active) this.player.play('player_idle');
      });
    } else {
      // Fallback if no spritesheet
      this._spawnAttackHitbox();
    }
  }

  _spawnAttackHitbox() {
    const aKey = this._ensureTexture('slash', 56, 56, 0x99ddff);
    const offX = this.playerFacing * 48;
    const hit = this.physics.add.sprite(this.player.x + offX, this.player.y, aKey);
    hit.setDisplaySize(72, 48);
    hit.setImmovable(true);
    hit.body.allowGravity = false;

    // 👇 keep physics active but render invisible
    hit.setVisible(false); // (Alternatively: hit.setAlpha(0);)

    this.time.delayedCall(120, () => hit.destroy());

    this.physics.add.overlap(hit, this.enemies, (h, e) => {
      if (!e.active) return;
      e.hp -= 1;
      this._playSfx('hit');
      if (e.hp <= 0) {
        this._enemyDie(e);
      } else {
        e.setVelocityX(e.body.velocity.x + this.playerFacing * 160);
      }
    });
  }



  _enemyDie(e) {
    this._playSfx('destroy');
    this.state.kills++;
    this.scoreText.setText(`${(this.registry.get('cfg')?.texts?.score_label || 'Score: ')}${this.state.kills}`);
    if (Math.random() < 0.25) {
      const cKey = this._ensureTexture('collectible', 36, 36, 0x44ffaa);
      const c = this.collectibles.create(e.x, e.y - 16, cKey);
      c.setDisplaySize(36, 36);
      c.body.setBounce(0.2);
    }
    e.destroy();
  }
  _addTweenSafe(cfg) {
    if (!cfg || typeof cfg !== 'object') {
      console.error('[Tween guard] Invalid tween config:', cfg);
      return null;
    }
    return this.tweens.add(cfg);
  }



  _damagePlayer(amount = 1, from = null) {
    if (this.playerIsDead || this.time.now < this.state.invulnUntil) return;

    this.playerHP -= amount;
    this._updateHUD();

    if (this.playerHP <= 0) {
      this.playerIsDead = true;
      this._lose();
      return;
    }

    this.state.invulnUntil = this.time.now + 900;

    // ✅ Defensive: only add the tween if both manager & target exist
    try {
      if (this.tweens && this.player && this.player.active) {
        this._addTweenSafe({
          targets: this.player,
          duration: 90,
          repeat: 5,
          alpha: 0.3,
          yoyo: true,
          onComplete: () => {
            if (this.player && this.player.active) this.player.setAlpha(1);
          }
        });
      } else {
        // Fallback effect if tween can’t run (keeps gameplay consistent)
        if (this.player) this.player.setAlpha(0.3);
        this.time.delayedCall(600, () => this.player && this.player.setAlpha(1));
      }
    } catch (err) {
      console.error('[Tween guard] Failed to add damage tween:', err);
      if (this.player) {
        this.player.setAlpha(0.3);
        this.time.delayedCall(600, () => this.player && this.player.setAlpha(1));
      }
    }

    this._playSfx('hit');

    if (from) {
      const dir = Math.sign(this.player.x - from.x) || 1;
      this.player.setVelocity(dir * 420, -380);
    }
  }


  // ---------- HUD / Audio ----------
  _updateHUD() {
    this.hpText.setText(`HP: ${Math.max(0, Math.ceil(this.playerHP))}/${this.playerMaxHP}`);
    this.timerText.setText(`${Math.max(0, this.state.timerLeft)}s`);
  }
  _safeMusic(key) {
    try {
      if (key && this.sound.get(key)) {
        this.music = this.sound.add(key, { loop: true, volume: 0.45 });
        this.music.play();
      } else if (key && this.cache.audio.exists(key)) {
        this.music = this.sound.add(key, { loop: true, volume: 0.45 });
        this.music.play();
      }
    } catch { }
  }
  _playSfx(k) {
    if (!this._sfx) return;
    const s = this._sfx[k];
    if (s && s.play) s.play();
  }

  _onPlayerHitEnemy = (player, enemy) => {
    if (!this.player || !this.player.body) return;
    if (this.time.now < this.state.invulnUntil) return;
    this._damagePlayer(1, enemy);
  };

  _onPlayerHitProjectile = (player, proj) => {
    if (proj && proj.destroy) proj.destroy();
    if (!this.player || !this.player.body) return;
    if (this.time.now < this.state.invulnUntil) return;
    this._damagePlayer(1.5);
  };



  // ---------- Mobile Controls (separate JUMP/ATTACK) ----------
  _createMobileButtons() {
    const gconf = this.sys.config || this.sys.game.config;
    const width = Number(gconf.width) || 1080;
    const height = Number(gconf.height) || 1920;

    const mk = (keyName, x, y, w = 120, h = 120) => {
      const key = this._ensureTexture(keyName, w, h, 0xffffff);
      const btn = this.add.image(x, y, key).setDepth(30).setScrollFactor(0).setInteractive({ useHandCursor: true });
      btn.setDisplaySize(w, h).setAlpha(0.6);
      btn.on('pointerdown', () => { btn.setScale(0.8).setAlpha(0.9); });
      btn.on('pointerup', () => { btn.setScale(0.8).setAlpha(0.6); });
      btn.on('pointerout', () => { btn.setScale(0.8).setAlpha(0.6); });
      return btn;
    };

    // Left / Right (unchanged positions)
    const leftBtn = mk('left', 110, height - 100, 180, 180);
    const rightBtn = mk('right', 400, height - 100, 180, 180);

    leftBtn.on('pointerdown', () => this.inputState.left = true);
    leftBtn.on('pointerup', () => this.inputState.left = false);
    leftBtn.on('pointerout', () => this.inputState.left = false);

    rightBtn.on('pointerdown', () => this.inputState.right = true);
    rightBtn.on('pointerup', () => this.inputState.right = false);
    rightBtn.on('pointerout', () => this.inputState.right = false);

    // NEW: Jump & Attack as separate buttons
    const jumpBtn = mk('action', width - 340, height - 100, 140, 140); // reuse 'action' art or a 'jump' icon if you have one
    const attackBtn = mk('slash', width - 160, height - 100, 140, 140); // reuse 'slash' or any attack icon

    // Jump (hold or tap when grounded)
    jumpBtn.on('pointerdown', () => { this.inputState.jump = true; });
    jumpBtn.on('pointerup', () => { this.inputState.jump = false; });
    jumpBtn.on('pointerout', () => { this.inputState.jump = false; });

    // Attack (tap)
    attackBtn.on('pointerdown', () => { this._consumeTapAttack = true; this.inputState.attack = true; });
    attackBtn.on('pointerup', () => { this.inputState.attack = false; });
    attackBtn.on('pointerout', () => { this.inputState.attack = false; });
  }

  // ---------- Helpers ----------
  _ensureTexture(key, w, h, colorHex) {
    if (!this.textures.exists(key)) {
      const g = this.add.graphics();
      g.fillStyle(colorHex ?? 0x888888, 1).fillRoundedRect(0, 0, Math.max(8, w), Math.max(8, h), 12);
      g.generateTexture(key, Math.max(8, w), Math.max(8, h));
      g.destroy();
    }
    return key;
  }
  _keyOr(name) { return this.textures.exists(name) ? name : this._ensureTexture(name, 64, 64, 0x888888); }

  _lose() {
    this.music && this.music.stop?.();
    if (this.sound.get('game_over')) this.sound.play('game_over', { volume: 0.8 });
    if (this.scene.get('GameOverScene')) this.scene.start('GameOverScene');
  }
  _win() {
    this.music && this.music.stop?.();
    if (this.sound.get('level_complete')) this.sound.play('level_complete', { volume: 0.9 });
    if (this.scene.get('WinScene')) this.scene.start('WinScene');
  }
}
// export default GameScene;
