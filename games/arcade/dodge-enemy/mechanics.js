export default class Game extends Phaser.Scene {
  constructor() {
    super({ key: 'GameScene' });
    Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach(fn => {
      if (typeof this[fn] === 'function') this[fn] = this[fn].bind(this);
    });
    // Declare state vars only here, everything else from config
    this.player = null;
    this.enemies = null;
    this.cursors = null;
    this.gameOver = false;
    this.joystick = null;

  }

  preload() {
    const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf("/"));
    if (this.load.setCORS) this.load.setCORS("anonymous");

    const evictTexture = (k) => { if (this.textures.exists(k)) this.textures.remove(k); };

    // helpful error surface
    this.load.on("loaderror", (file) => {
      console.error("[Preload] Failed:", file?.type, file?.key, "->", file?.src);
    });

    // helpers
    const parseQueryFrom = (str) => { try { return new URL(str, window.location.href).searchParams; } catch { return new URLSearchParams(""); } };
    const getParam = (name) => {
      const p1 = new URLSearchParams(window.location.search).get(name);
      if (p1) return p1;
      if (window.location.hash?.length > 1) {
        const p2 = new URLSearchParams(window.location.hash.slice(1)).get(name);
        if (p2) return p2;
      }
      if (document.referrer) {
        const p3 = parseQueryFrom(document.referrer).get(name);
        if (p3) return p3;
      }
      return null;
    };
    const collectPrefixed = (prefixes) => {
      const out = {};
      const readAll = (sp) => {
        for (const [k, v] of sp.entries()) {
          for (const p of prefixes) if (k.startsWith(p + ".")) {
            const key = k.slice(p.length + 1);
            (out[p] ??= {})[key] = v;
          }
        }
      };
      readAll(new URLSearchParams(window.location.search));
      if (window.location.hash?.length > 1) readAll(new URLSearchParams(window.location.hash.slice(1)));
      if (document.referrer) readAll(parseQueryFrom(document.referrer));
      return out;
    };
    const resolveUrl = (u) => (!u ? null : (/^(https?:)?\/\//i.test(u) || /^data:/i.test(u) ? u : `${basePath}/${u}`));
    const withBustIfParam = (u, bust) => (!u || !bust ? u : `${u}${u.includes("?") ? "&" : "?"}cb=${Date.now()}`);

    // load config first
    this.load.json("levelConfig", `${basePath}/config.json`);

    this.load.once("filecomplete-json-levelConfig", () => {
      this.config = this.cache.json.get("levelConfig") || {};

      const sheets = this.config.sheets || {};
      const heroData = sheets.hero || {};

      const rawMain = getParam("main") || getParam("player") || "";
      const cleanMain = rawMain ? decodeURIComponent(rawMain).replace(/^"|"$/g, "") : "";
      const fwParam = getParam("fw");
      const fhParam = getParam("fh");

      const pref = collectPrefixed(["image", "sheet", "audio", "fw", "fh", "num", "text"]);

      // numeric + text overrides
      if (pref.num) {
        for (const [k, v] of Object.entries(pref.num)) {
          const n = Number(v);
          if (!Number.isNaN(n)) this.config[k] = n;
        }
      }
      if (pref.text) {
        this.config.text ??= {};
        Object.assign(this.config.text, pref.text);
      }

      // --- HERO / PLAYER SPRITESHEET ---
      // evict only if we’re actually switching sources (via URL param)
      const wantBust = !!cleanMain;
      const chosenHeroUrl = resolveUrl(cleanMain) || resolveUrl(heroData.url) || `${basePath}/assets/hero.png`;
      const frameW = Number(fwParam) || heroData.frameWidth || 103;
      const frameH = Number(fhParam) || heroData.frameHeight || 142;

      if (wantBust) { evictTexture("hero"); evictTexture("player"); }

      const heroUrlFinal = withBustIfParam(chosenHeroUrl, wantBust);
      this.load.spritesheet("hero", heroUrlFinal, { frameWidth: frameW, frameHeight: frameH });
      this.load.spritesheet("player", heroUrlFinal, { frameWidth: frameW, frameHeight: frameH });

      // --- IMAGES (single queue per key; precedence: images2 > images1 > ui; param overrides beat all) ---
      const ui = this.config.ui || {};
      const images1 = this.config.images1 || {};
      const images2 = this.config.images2 || {};

      // collect all keys across groups
      const allImgKeys = new Set([
        ...Object.keys(ui),
        ...Object.keys(images1),
        ...Object.keys(images2),
        ...Object.keys(pref.image || {}),
      ]);

      for (const key of allImgKeys) {
        const fromParam = pref.image?.[key] ?? null;
        const picked = fromParam ?? images2[key] ?? images1[key] ?? ui[key] ?? null;
        const finalUrl = resolveUrl(picked);

        if (!finalUrl) continue;

        // evict only when we actually override an existing key via param
        if (fromParam) evictTexture(key);

        this.load.image(key, withBustIfParam(finalUrl, !!fromParam));
      }

      // --- EXTRA SPRITESHEETS GROUP (not hero/player) ---
      const extraSheets = this.config.spritesheets || {};
      for (const [key, sheet] of Object.entries(extraSheets)) {
        if (key === "hero" || key === "player") continue; // already handled
        const oUrl = pref.sheet?.[key];
        const oFw = pref.fw?.[key];
        const oFh = pref.fh?.[key];

        const finalUrl = resolveUrl(oUrl || sheet.url);
        if (!finalUrl) continue;

        const finalFw = Number(oFw) || sheet.frameWidth;
        const finalFh = Number(oFh) || sheet.frameHeight;

        if (oUrl) evictTexture(key);
        this.load.spritesheet(key, withBustIfParam(finalUrl, !!oUrl), { frameWidth: finalFw, frameHeight: finalFh });
      }

      // --- AUDIO ---
      const audio = this.config.audio || {};
      for (const [key, url] of Object.entries(audio)) {
        const override = pref.audio?.[key];
        const chosen = resolveUrl(override || url);
        if (!chosen) continue;
        this.load.audio(key, withBustIfParam(chosen, !!override));
      }

      // helpful confirmation
      this.load.once("complete", () => {
        const tex = this.textures.get("hero");
        const src = tex?.getSourceImage ? tex.getSourceImage().src : "(no src)";
        console.log("[Preload] Complete. HERO:", src, { frameW, frameH, viaParam: !!cleanMain });
      });

      if (!this.load.isLoading()) this.load.start();
    });
  }

  create() {
    const levelData = this.cache.json.get('levelConfig');
    this.levelData = levelData; // Keep for endLevel
    if (!this.levelConfig) {
      const cfg = this.cache.json.get("levelConfig");
      if (!cfg) {
        console.error("Missing levelConfig during replay.");
        return;
      }
      this.levelConfig = cfg;
    }

    if (levelData.orientation?.frame === 'landscape' && screen.orientation && screen.orientation.lock) {
      screen.orientation
        .lock('landscape-primary')
        .catch(err => console.warn('Orientation lock failed:', err));
    }

    const cfg = this.levelConfig;
    const orientation = cfg.orientation;
    const colors = cfg.colors;
    const game = cfg.game;
    const texts = cfg.texts;

    this.GAME_WIDTH = orientation.width;
    this.GAME_HEIGHT = orientation.height;
    this.ARENA_PADDING = game.arenaPadding;
    this.PLAYER_RADIUS = game.playerRadius;
    this.PLAYER_SPEED = game.playerSpeed;
    this.ENEMY_SIZE = game.enemySize;
    this.ENEMY_SPAWN_INTERVAL = game.enemySpawnInterval;
    this.ENEMY_BASE_SPEED = game.enemyBaseSpeed;
    this.SURVIVAL_DURATION = game.survivalDuration;

    this.timer = this.SURVIVAL_DURATION;
    this.spawnTimer = 0;
    this.enemySpawnInterval = this.ENEMY_SPAWN_INTERVAL;
    this.enemyBaseSpeed = this.ENEMY_BASE_SPEED;
    this.gameOver = false;

    // Background color
    this.sys.cameras.main.setBackgroundColor(colors.background);

    // Arena BG
    this.arenaImg = this.add.image(this.GAME_WIDTH / 2, this.GAME_HEIGHT / 2, 'background');
    this.arenaImg.setDisplaySize(this.GAME_WIDTH - this.ARENA_PADDING * 2, this.GAME_HEIGHT - this.ARENA_PADDING * 2);

    // Player
    // Player
    this.player = this.physics.add.sprite(this.GAME_WIDTH / 2, this.GAME_HEIGHT / 2, 'hero', 0);
    this.player.setDisplaySize(this.PLAYER_RADIUS * 7, this.PLAYER_RADIUS * 7);
    this.player.setCollideWorldBounds(true);
    this.player.setData('speed', this.PLAYER_SPEED);



    // Create animation for hero
    this.anims.create({
      key: 'walk',
      frames: this.anims.generateFrameNumbers('hero', { start: 0, end: 3 }), // adjust if you have more frames
      frameRate: 8,
      repeat: -1
    });
    this.createJoystick(); // Call to setup joystick


    // Enemies group
    this.enemies = this.add.group();

    this.physics.add.collider(this.player, this.enemies, this.handleGameOver, null, this);


    // Input
    this.cursors = this.input.keyboard.createCursorKeys();

    this.add.image(960, 80, 'scorebar')

    // Timer UI
    this.timerText = this.add.text(this.GAME_WIDTH / 2, 80, texts.timer, {
      font: '50px outfit', color: colors.timerText
    }).setOrigin(0.5);

    // Overlays
    this.createStartOverlay();
    this.createGameOverOverlay();
    this.createLevelCompleteOverlay();

    this.bgmSound = this.sound.add('bgm', { loop: true, volume: 0.5 });
    this.gameoverSound = this.sound.add('gameover', { volume: 1.0 });


    this.gameState = 'start';
    this.startOverlay.setVisible(true);

  }
  notifyParent(type, data) {
    if (window.parent !== window) {
      window.parent.postMessage({ type, ...data }, "*");
    }
  }
  // --- Overlays ---
  createStartOverlay() {
    const cfg = this.levelConfig;
    const w = this.GAME_WIDTH, h = this.GAME_HEIGHT, texts = cfg.texts, colors = cfg.colors;

    this.startOverlay = this.add.container(w / 2, h / 2);
    const bg = this.add.image(0, 0, 'htpbox');
    const title = this.add.text(0, -80, '', { font: '50px outfit', color: "white" }).setOrigin(0.5);
    const sub = this.add.text(-200, 0, `Use the joystick to dodge enemies.\nSurvive for ${this.timer} seconds to win.`, { font: '50px outfit', color: "white" }).setOrigin(0.5);
    const playBtn = this.add.image(0, 420, 'button_play').setInteractive();
    const playLabel = this.add.text(0, 95, texts.startBtn, { font: '32px', color: '#000' }).setOrigin(0.5);

    playBtn.on('pointerdown', () => {
      this.startOverlay.setVisible(false);
      this.gameState = 'running';
      this.bgmSound?.play();

    });

    this.startOverlay.add([bg, title, sub, playBtn, playLabel]);
    this.startOverlay.setVisible(false);
  }

  createJoystick() {
    this.joystick = {
      base: this.add.image(180, this.GAME_HEIGHT - 180, 'joystick_base')
        .setScrollFactor(0)
        .setAlpha(0.4)
        .setDepth(10)
        .setVisible(false),
      thumb: this.add.image(180, this.GAME_HEIGHT - 180, 'joystick_thumb')
        .setScrollFactor(0)
        .setDepth(11)
        .setVisible(false),
      pointerId: null,
      force: 0,
      angle: 0
    };

    this.input.on('pointerdown', pointer => {
      if (!this.isGameRunning()) return;
      if (pointer.x < this.sys.scale.width / 2 && this.joystick.pointerId === null) {
        this.joystick.pointerId = pointer.id;
        this.joystick.base.setPosition(pointer.x, pointer.y).setVisible(true);
        this.joystick.thumb.setPosition(pointer.x, pointer.y).setVisible(true);
      }
    });


    this.input.on('pointerup', pointer => {
      if (!this.isGameRunning()) return;
      if (pointer.id === this.joystick.pointerId) {
        this.resetJoystick();
      }
    });

    this.input.on('pointermove', pointer => {
      if (!this.isGameRunning()) return;
      if (pointer.id === this.joystick.pointerId) {
        const dx = pointer.x - this.joystick.base.x;
        const dy = pointer.y - this.joystick.base.y;
        const distance = Math.min(Math.sqrt(dx * dx + dy * dy), 80);
        const angle = Math.atan2(dy, dx);

        this.joystick.thumb.setPosition(
          this.joystick.base.x + Math.cos(angle) * distance,
          this.joystick.base.y + Math.sin(angle) * distance
        );

        this.joystick.force = distance / 80;
        this.joystick.angle = Phaser.Math.RadToDeg(angle);
      }
    });

  }

  resetJoystick() {
    this.joystick.pointerId = null;
    this.joystick.force = 0;
    this.joystick.angle = 0;
    this.joystick.base.setVisible(false);
    this.joystick.thumb.setVisible(false);
  }


  createGameOverOverlay() {
    const cfg = this.levelConfig;
    const w = this.GAME_WIDTH, h = this.GAME_HEIGHT, texts = cfg.texts, colors = cfg.colors;

    this.gameOverOverlay = this.add.container(w / 2, h / 2);
    const bg = this.add.image(0, 0, 'gameover_bg');
    const loseText = this.add.text(0, 0, texts.lose, { font: '50px outfit', color: colors.lose, fontStyle: 'bold' }).setOrigin(0.5);
    const retryBtn = this.add.image(0, 355, 'button_retry').setInteractive();
    const retryLabel = this.add.text(0, 55, texts.retry, { font: '32px', color: '#000' }).setOrigin(0.5);

    retryBtn.on('pointerdown', () => {
      this.scene.restart();
    });

    this.gameOverOverlay.add([bg, loseText, retryBtn, retryLabel]);
    this.gameOverOverlay.setVisible(false);
  }

  createLevelCompleteOverlay() {
    const cfg = this.levelConfig;
    const w = this.GAME_WIDTH, h = this.GAME_HEIGHT, texts = cfg.texts, colors = cfg.colors;

    this.levelCompleteOverlay = this.add.container(w / 2, h / 2);
    const bg = this.add.image(0, 0, 'levelcomplete_bg');
    const winText = this.add.text(0, 0, texts.win, { font: '50px outfit', color: colors.win }).setOrigin(0.5);
    const playBtn = this.add.image(-235, 340, 'replay').setInteractive();
    const nextbtn = this.add.image(235, 340, 'next').setInteractive();
    const playLabel = this.add.text(0, 55, texts.playAgain, { font: '32px', color: '#000' }).setOrigin(0.5);

    playBtn.on('pointerdown', () => {
      this.scene.restart();
    });
    nextbtn.on('pointerdown', () => {
      this.notifyParent('sceneComplete', { result: 'win' });
    });

    this.levelCompleteOverlay.add([bg, winText, playBtn, nextbtn, playLabel]);
    this.levelCompleteOverlay.setVisible(false);
  }

  // --- Game loop ---
  update(time, delta) {
    if (this.gameOver || this.gameState !== 'running') return;

    const speed = this.player.getData('speed');
    let vx = 0, vy = 0;

    // === Joystick movement ===
    if (this.joystick?.force > 0) {
      const rad = Phaser.Math.DegToRad(this.joystick.angle);
      vx = Math.cos(rad) * speed * this.joystick.force;
      vy = Math.sin(rad) * speed * this.joystick.force;

      // Flip based on horizontal joystick direction
      if (vx < 0) this.player.setFlipX(true);
      else if (vx > 0) this.player.setFlipX(false);
    }
    // === Keyboard fallback ===
    else {
      if (this.cursors.left.isDown) {
        vx = -speed;
        this.player.setFlipX(true);
      } else if (this.cursors.right.isDown) {
        vx = speed;
        this.player.setFlipX(false);
      }

      if (this.cursors.up.isDown) vy = -speed;
      if (this.cursors.down.isDown) vy = speed;
    }

    // === Apply movement ===
    this.player.setVelocity(vx, vy);

    if (vx !== 0 || vy !== 0) {
      if (!this.player.anims.isPlaying) this.player.play('walk');
    } else {
      this.player.anims.stop();
      this.player.setFrame(0);
    }


    // === Clamp player inside arena ===
    const minX = this.ARENA_PADDING + this.PLAYER_RADIUS;
    const maxX = this.GAME_WIDTH - this.ARENA_PADDING - this.PLAYER_RADIUS;
    const minY = this.ARENA_PADDING + this.PLAYER_RADIUS;
    const maxY = this.GAME_HEIGHT - this.ARENA_PADDING - this.PLAYER_RADIUS;
    this.player.x = Phaser.Math.Clamp(this.player.x, minX, maxX);
    this.player.y = Phaser.Math.Clamp(this.player.y, minY, maxY);

    // === Spawn enemies ===
    this.spawnTimer += delta;
    const timeElapsed = this.SURVIVAL_DURATION - this.timer;
    this.enemySpawnInterval = Math.max(500, this.ENEMY_SPAWN_INTERVAL - timeElapsed * 12);
    if (this.spawnTimer > this.enemySpawnInterval) {
      this.spawnEnemy();
      this.spawnTimer = 0;
    }

    // === Move enemies & check collision ===
    // this.enemies.children.each(enemy => {
    //   enemy.x += enemy.getData('vx') * (delta / 1000);
    //   enemy.y += enemy.getData('vy') * (delta / 1000);

    //   // Bounce off walls
    //   const min = this.ARENA_PADDING + this.ENEMY_SIZE / 2;
    //   const maxX = this.GAME_WIDTH - this.ARENA_PADDING - this.ENEMY_SIZE / 2;
    //   const maxY = this.GAME_HEIGHT - this.ARENA_PADDING - this.ENEMY_SIZE / 2;
    //   if (enemy.x <= min || enemy.x >= maxX) enemy.setData('vx', -enemy.getData('vx'));
    //   if (enemy.y <= min || enemy.y >= maxY) enemy.setData('vy', -enemy.getData('vy'));

    //   // Collision with player
    //   const dist = Phaser.Math.Distance.Between(enemy.x, enemy.y, this.player.x, this.player.y);
    //   if (dist < this.PLAYER_RADIUS + this.ENEMY_SIZE / 2 - 2) {
    //     this.handleGameOver();
    //   }
    // });

    // === Timer logic ===
    this.timer -= delta / 1000;
    this.timerText.setText('Time: 00:' + String(Math.ceil(this.timer)).padStart(2, '0'));
    if (this.timer <= 0) {
      this.timerText.setText("00:00");
      this.handleWin();
    }
  }


  spawnEnemy() {
    const min = this.ARENA_PADDING + this.ENEMY_SIZE / 2;
    const maxX = this.GAME_WIDTH - this.ARENA_PADDING - this.ENEMY_SIZE / 2;
    const maxY = this.GAME_HEIGHT - this.ARENA_PADDING - this.ENEMY_SIZE / 2;
    // Spawn on random edge
    const edge = Phaser.Math.Between(0, 3);
    let x, y;
    if (edge === 0) { x = Phaser.Math.Between(min, maxX); y = min; }
    else if (edge === 1) { x = maxX; y = Phaser.Math.Between(min, maxY); }
    else if (edge === 2) { x = Phaser.Math.Between(min, maxX); y = maxY; }
    else { x = min; y = Phaser.Math.Between(min, maxY); }

    const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
    const speed = this.enemyBaseSpeed + Phaser.Math.Between(0, 40) + (this.SURVIVAL_DURATION - this.timer) * 5;
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed;

    const enemy = this.physics.add.image(x, y, 'enemy');
    enemy.setDisplaySize(this.ENEMY_SIZE * 5, this.ENEMY_SIZE * 5);
    enemy.setVelocity(vx, vy);
    enemy.setBounce(1);
    enemy.setCollideWorldBounds(true);
    this.enemies.add(enemy);


  }

  handleGameOver() {
    this.gameOver = true;
    this.bgmSound?.stop();
    this.gameoverSound?.play();
    this.destroyAllEnemies();
    this.player?.destroy();
    this.gameOverOverlay.setVisible(true);
    this.gameState = 'gameover';
    this.resetJoystick();  // Hide and disable joystick


  }


  handleWin() {
    this.gameOver = true;
    this.bgmSound?.stop();
    this.destroyAllEnemies();
    this.player?.destroy();
    this.levelCompleteOverlay.setVisible(true);
    this.gameState = 'win';
    this.resetJoystick();  // Hide and disable joystick


  }

  isGameRunning() {
    return this.gameState === 'running' && !this.gameOver;
  }


  destroyAllEnemies() {
    this.enemies.children.each(enemy => {
      enemy.destroy();
    });
    this.enemies.clear(true); // Clear group reference
  }

}
