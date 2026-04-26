

export default class GameScene extends Phaser.Scene {
  constructor() {

    super('GameScene');

    Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach(fn => {
      if (typeof this[fn] === 'function') {
        this[fn] = this[fn].bind(this);
      }
    });
  }


  preload() {
    const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf("/"));

    // Allow cross‑origin images (CDN, S3, etc.)
    if (this.load.setCORS) this.load.setCORS('anonymous');

    // If scene restarts, ensure a fresh load for the same key
    // if (this.textures.exists('player')) {
    //   this.textures.remove('player');
    // }

    // Helpful errors
    this.load.on('loaderror', (file) => {
      if (file && file.key === 'player') {
        console.error('[Preload] Failed to load player sheet:', file.src);
      }
    });

    // --- helper utils ---
    const parseQueryFrom = (str) => {
      try {
        const u = new URL(str, window.location.href);
        return u.searchParams;
      } catch { return new URLSearchParams(''); }
    };

    const getParam = (name) => {
      // 1) ?query on iframe URL
      const p1 = new URLSearchParams(window.location.search).get(name);
      if (p1 != null && p1 !== '') return p1;

      // 2) #hash style e.g. #main=...&fw=96
      if (window.location.hash && window.location.hash.length > 1) {
        const p2 = new URLSearchParams(window.location.hash.slice(1)).get(name);
        if (p2 != null && p2 !== '') return p2;
      }

      // 3) Parent/embedding page via document.referrer
      if (document.referrer) {
        const refParams = parseQueryFrom(document.referrer);
        const p3 = refParams.get(name);
        if (p3 != null && p3 !== '') return p3;
      }

      return null;
    };

    const resolveUrl = (u) => {
      if (!u) return null;
      if (/^(https?:)?\/\//i.test(u) || /^data:/i.test(u)) return u; // absolute or data:
      return `${basePath}/${u}`; // relative -> basePath
    };

    // Cache-bust only if overriding via param
    const withBustIfParam = (u, hasParam) => {
      if (!u || !hasParam) return u;
      const sep = u.includes('?') ? '&' : '?';
      return `${u}${sep}cb=${Date.now()}`;
    };

    // Start config load
    this.load.json("levelConfig", `${basePath}/config.json`);

    this.load.once("filecomplete-json-levelConfig", () => {
      // 1) config
      this.config = this.cache.json.get("levelConfig") || {};
      const sheets = this.config.sheets || {};
      const heroData = sheets.hero || {};

      // 2) parameters
      const rawMain = getParam("main") || getParam("player") || "";
      const cleanMain = rawMain ? decodeURIComponent(rawMain).replace(/^"|"$/g, "") : "";
      const fwParam = getParam("fw");
      const fhParam = getParam("fh");

      // 3) select URL & frame size
      const chosenUrl =
        resolveUrl(cleanMain) ||
        resolveUrl(heroData.url) ||
        `${basePath}/assets/player.png`;

      const frameW = Number(fwParam) || heroData.frameWidth || 103;
      const frameH = Number(fhParam) || heroData.frameHeight || 142;

      // 4) enqueue player spritesheet (with cache-bust if param used)
      this.load.spritesheet("player", withBustIfParam(chosenUrl, !!cleanMain), {
        frameWidth: frameW,
        frameHeight: frameH,
      });

      // 5) enqueue other assets
      if (this.config.images1) {
        for (const [key, url] of Object.entries(this.config.images1)) {
          this.load.image(key, resolveUrl(url));
        }
      }

      if (this.config.images2) {
        for (const [key, url] of Object.entries(this.config.images2)) {
          this.load.image(key, resolveUrl(url));
        }
      }

      if (this.config.ui) {
        for (const [key, url] of Object.entries(this.config.ui)) {
          this.load.image(key, resolveUrl(url));
        }
      }

      if (this.config.spritesheets) {
        for (const [key, sheet] of Object.entries(this.config.spritesheets)) {
          this.load.spritesheet(key, resolveUrl(sheet.url), {
            frameWidth: sheet.frameWidth,
            frameHeight: sheet.frameHeight,
          });
        }
      }

      if (this.config.audio) {
        for (const [key, url] of Object.entries(this.config.audio)) {
          this.load.audio(key, resolveUrl(url));
        }
      }

      console.debug("[Preload] queue player:", chosenUrl, { frameW, frameH, viaParam: !!cleanMain });

      // 6) after everything finishes, confirm actual source image used
      this.load.once('complete', () => {
        const tex = this.textures.get('player');
        const src = tex && tex.getSourceImage ? tex.getSourceImage().src : '(no src)';
        console.log('[Preload] FINAL player texture src:', src);
      });

      // Go!
      this.load.start();
    });
  }




  init() {
    // hard reset runtime state for safe restarts
    this.gameStarted = false;
    this.gameOver = false;
    this.levelCompleted = false;

    this.player = null;
    this.platforms = null;
    this.flyingplatforms = null;
    this.swamps = [];
    this.harmfulDecorations = [];
    this.photoTargets = new Set();
    this.nearbyPhotoTarget = null;

    this.startOverlay = null;
    this.endOverlay = null;
    this.shootButton = null;

    // IMPORTANT: force joystick to be rebuilt on restart
    this.joystickData = null;

    // sounds/timers
    this.bgm = null;
    this.spaceshipSound = null;
    this.gameStartTime = null;
  }


  create() {
    this.physics.resume();

    // one-time shutdown hook to clean leftovers when scene restarts
    this.events.once('shutdown', this.cleanup, this);
    this.events.once('destroy', this.cleanup, this);

    const levelData = this.cache.json.get('levelConfig');
    this.levelData = levelData; // Keep for endLevel

    // Apply orientation from config
    if (levelData.orientation?.frame === 'landscape' && screen.orientation && screen.orientation.lock) {
      screen.orientation
        .lock('landscape-primary')
        .catch(err => console.warn('Orientation lock failed:', err));
    }


    // Reset game state
    this.gameStarted = false;
    this.gameOver = false;
    this.playerHealth = 100;
    this.maxHealth = 100;
    this.maxGameTime = 30;
    this.gameStartTime = null;
    this.levelCompleted = false;

    this.requiredPictures = Math.floor(this.maxGameTime / 6); // 5 for 30s, 10 for 60s
    this.picturesTaken = 0;
    this.nearbyPhotoTarget = null;
    this.photoTargets = new Set(); // Track which decorations can be photographed

    this.harmfulDecorations = [];
    this.bgGroup = this.add.group();
    this.bgWidth = 1920;
    this.lastBGX = 0;
    for (let i = -1; i < Math.ceil(1920 / this.bgWidth) + 4; i++) {
      const x = i * this.bgWidth;
      const tile = this.add.image(x, 0, "background").setOrigin(0, 0).setDisplaySize(1920, 1080).setScrollFactor(1);
      tile.bgIndex = i;
      this.bgGroup.add(tile);
      this.lastBGX = x;
    }



    // Clean up any existing overlays
    if (this.startOverlay) this.startOverlay.destroy();
    if (this.endOverlay) this.endOverlay.destroy();

    // Get actual screen dimensions
    this.screenWidth = 1920
    this.screenHeight = 1080

    // Platform configuration
    const platformCount = 20;
    const platformGap = 400;
    const startX = 200;
    this.platformY = this.screenHeight - 60;
    this.flyingPlatformOffset = 120;

    // Create platform groups
    this.platforms = this.physics.add.staticGroup();
    this.flyingplatforms = this.physics.add.staticGroup();
    this.groundPlatforms = [];
    this.flyingPlatformPositions = [];

    // Generate platforms
    this.generatePlatforms(platformCount, platformGap, startX);

    // Add decorations and UI
    this.addPlatformDecorations();
    this.createUI();
    this.setupAnimations();

    // Set world and camera bounds
    const worldWidth = startX + (platformCount * platformGap) + 400;
    this.physics.world.setBounds(0, 0, worldWidth, this.screenHeight);
    this.sys.cameras.main.setBounds(0, 0, worldWidth, this.screenHeight);



    this.bgm = this.sound.add("bgm", { loop: true, volume: 1 });
    this.bgm.play();

    this.showStartScreen();
    this.setupControls();





  }

  generatePlatforms(platformCount, platformGap, startX) {
    let currentGap = platformGap;
    for (let i = 0; i < platformCount; i++) {
      if (i > 0 && i % 4 === 0) {
        currentGap += 30;
      }
      const x = startX + i * currentGap;
      const y = this.platformY;
      if (i % 2 === 0) {
        this.createGroundPlatform(x, y, i);
      } else {
        this.createSwampArea(x, y, i);
      }
    }
  }

  cleanup() {
    try {
      this.physics.resume();

      // stop sounds
      this.bgm?.stop();
      this.spaceshipSound?.stop();

      // stop & destroy player before anything touches its animation/texture
      if (this.player) {
        this.player.anims?.stop();
        this.player.destroy();
        this.player = null;
      }

      // remove input listeners we attached
      if (this.joystickData?.knob) this.joystickData.knob.removeAllListeners();
      this.input?.removeAllListeners();

      // destroy UI bits if they survived
      this.startOverlay?.destroy();
      this.endOverlay?.destroy();
      this.shootButton?.destroy();

      // IMPORTANT: remove scene-specific animations so we recreate fresh next run
      ['left', 'right', 'turn'].forEach(k => {
        if (this.anims.exists(k)) this.anims.remove(k);
      });

      // clear references so init() starts fresh
      this.joystickData = null;
      this.shootButton = null;
      this.startOverlay = null;
      this.endOverlay = null;
    } catch (e) { /* ignore */ }
  }



  createGroundPlatform(x, y, index) {
    const platform = this.platforms.create(x, y, 'platform')
      .setScale(0.5)
      .refreshBody()
      .setDepth(1);
    const visualWidth = platform.displayWidth;
    const visualHeight = platform.displayHeight;
    platform.body.setSize(visualWidth, 80);
    platform.body.setOffset(
      (platform.width * platform.scaleX - visualWidth) / 2,
      visualHeight - 80
    );
    this.groundPlatforms.push({ x, y, width: visualWidth, index });
  }

  createSwampArea(x, y, index) {
    const swamp = this.add.image(x, y + 30, 'swamp')
      .setScale(1.4)
      .setDepth(0)
      .setTint(0x8B4513);
    this.physics.add.existing(swamp, true);
    swamp.body.setSize(swamp.width * swamp.scaleX, 100);
    swamp.body.setOffset(0, swamp.height * swamp.scaleY - 100);
    if (!this.swamps) this.swamps = [];
    this.swamps.push(swamp);
    const warning = this.add.image(x, y - 60, 'warning')
      .setScale(0.6)
      .setDepth(1);
    const isLarge = (index - 1) % 4 === 0;
    const type = isLarge ? 'largeflyingplatform' : 'flyingplatform';
    const platformX = x + (isLarge ? 80 : 80);
    const platformY = y - (isLarge ? 250 : 250);
    const flyingplatform = this.flyingplatforms.create(platformX, platformY, type)
      .setScale(isLarge ? 0.5 : 0.5)
      .refreshBody()
      .setDepth(1);
    const visualWidth = flyingplatform.displayWidth;
    const visualHeight = flyingplatform.displayHeight;
    flyingplatform.body.setSize(visualWidth * 0.9, 60);
    flyingplatform.body.setOffset(
      (flyingplatform.width * flyingplatform.scaleX - visualWidth * 0.9) / 2,
      visualHeight - 60
    );
    this.flyingPlatformPositions.push({
      x: platformX,
      y: platformY,
      width: visualWidth,
      index,
      isLarge
    });
  }

  setupAnimations() {
    if (!this.anims.exists('left')) {
      this.anims.create({
        key: 'left',
        frames: this.anims.generateFrameNumbers('player', { start: 0, end: 3 }),
        frameRate: 10,
        repeat: -1
      });
    }
    if (!this.anims.exists('turn')) {
      this.anims.create({
        key: 'turn',
        frames: [{ key: 'player', frame: 4 }],
        frameRate: 20
      });
    }
    if (!this.anims.exists('right')) {
      this.anims.create({
        key: 'right',
        frames: this.anims.generateFrameNumbers('player', { start: 5, end: 8 }),
        frameRate: 10,
        repeat: -1
      });
    }
  }

  showStartScreen() {

    const cam = this.sys.cameras.main;
    const centerX = cam.width / 2;
    const centerY = cam.height / 2;

    this.startOverlay = this.add.container(centerX, centerY).setScrollFactor(0).setDepth(200);

    const bg = this.add.image(0, -50, 'dialog_bg_start').setDisplaySize(840, 657);
    const title = this.add.text(0, -170, 'How to Play', {
      font: "bold 60px Arial",
      color: '#fff'
    }).setOrigin(0.5);

    const desc = this.add.text(0, 70, 'Navigate the alien world and take pictures of plants from a distance. Protect yourself from animals by teleporting. Tap the teleport button, then select a spot inside the dotted circle to move.', {
      font: "50px Arial",
      color: '#fff',
      align: 'left',
      wordWrap: { width: 820 }
    }).setOrigin(0.5);

    const startBtn = this.add.image(0, 370, 'button')
      .setInteractive()
      .setScale(0.5)
      .setDisplaySize(837, 143);

    startBtn.on('pointerdown', () => {
      this.startOverlay.destroy();
      // this.startOverlay.destroy();
      this.gameStarted = true;
      this.spawnSpaceship();
    });

    this.startOverlay.add([bg, title, desc, startBtn]);


  }

  spawnSpaceship() {

    this.spaceshipSound = this.sound.add("spaceship", { volume: 1 });
    this.spaceshipSound.play();



    this.spaceship = this.add.image(-200, this.screenHeight * 0.2, 'spaceship')
      .setScale(0.6)
      .setDepth(2);
    this.sys.tweens.add({
      targets: this.spaceship,
      x: 300,
      duration: 2000,
      ease: 'Power2.easeOut',
      onComplete: () => this.spawnLightBeam()
    });
  }

  spawnLightBeam() {
    this.lightbeam = this.add.image(300, this.screenHeight * 0.4, 'lightbeam')
      .setScale(0.3)
      .setDepth(1)
      .setAlpha(0);
    this.sys.tweens.add({
      targets: this.lightbeam,
      alpha: 0.8,
      duration: 800,
      onComplete: () => this.spawnPlayer()
    });
    this.sys.tweens.add({
      targets: this.lightbeam,
      alpha: 0.6,
      duration: 600,
      yoyo: true,
      repeat: -1
    });
  }

  spawnPlayer() {


    this.player = this.physics.add.sprite(300, this.screenHeight * 0.3, "player")
      .setScale(1.1)
      .setDepth(2)
      .setCollideWorldBounds(true);
    this.player.body.allowGravity = false;
    this.physics.add.collider(this.player, this.platforms);
    this.physics.add.collider(this.player, this.flyingplatforms);
    if (this.swamps) {
      this.swamps.forEach(swamp => {
        this.physics.add.overlap(this.player, swamp, () => {
          this.takeDamage(50);
        });
      });
    }
    this.harmfulDecorations.forEach(deco => {
      this.physics.add.overlap(this.player, deco, () =>
        this.handleDecorationCollision(deco)
      );
    });
    this.sys.cameras.main.startFollow(this.player);
    this.sys.cameras.main.setFollowOffset(-200, -50);
    this.sys.cameras.main.setLerp(0.1, 0.1);
    this.sys.tweens.add({
      targets: this.player,
      y: this.platformY - 160,
      duration: 1500,
      ease: 'Bounce.easeOut',
      onComplete: () => {
        this.player.body.allowGravity = true;
        this.player.body.setGravityY(350);
        this.fadeOutBeamAndSpaceship();
        this.gameStartTime = this.time.now + (this.maxGameTime * 1000);
      }
    });
  }

  fadeOutBeamAndSpaceship() {
    this.sys.tweens.add({
      targets: this.lightbeam,
      alpha: 0,
      duration: 1000,
      onComplete: () => this.lightbeam.destroy()
    });
    this.sys.tweens.add({
      targets: this.spaceship,
      x: 800,
      y: this.screenHeight * 0.1,
      duration: 2500,
      ease: 'Power2.easeIn',
      onComplete: () => this.spaceship.destroy()

    });
    this.spaceshipSound.stop();
  }

  createUI() {
    const healthBarX = this.screenWidth * 0.1;
    const healthBarY = this.screenHeight * 0.08;
    this.healthBarBg = this.add.rectangle(healthBarX, healthBarY, 224, 34, 0x000000, 0.7)
      .setScrollFactor(0)
      .setDepth(100);
    this.healthBarBorder = this.add.rectangle(healthBarX, healthBarY, 220, 30, 0x444444)
      .setScrollFactor(0)
      .setDepth(101)
      .setStrokeStyle(2, 0x666666);
    this.healthBarFill = this.add.rectangle(healthBarX, healthBarY, 220, 30, 0x00ff44)
      .setScrollFactor(0)
      .setDepth(102);
    this.healthText = this.add.text(healthBarX, healthBarY + 25, `Health: ${this.playerHealth}/${this.maxHealth}`, {
      fontSize: '18px',
      fill: '#ffffff',
      fontFamily: 'Arial',
      stroke: '#000000',
      strokeThickness: 2
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(103);
    this.timerText = this.add.text(this.screenWidth * 0.9, this.screenHeight * 0.08, 'Time: 00:00', {
      fontSize: '22px',
      fill: '#ffffff',
      fontFamily: 'Arial',
      stroke: '#000000',
      strokeThickness: 2
    }).setOrigin(0.5).setScrollFactor(0).setDepth(102);
    // Add after this.timerText = ...
    this.pictureCounterText = this.add.text(this.screenWidth * 0.75, this.screenHeight * 0.08, `Pictures Taken: ${this.picturesTaken}/${this.requiredPictures}`, {
      fontSize: '22px',
      fill: '#ffffff',
      fontFamily: 'Arial',
      stroke: '#000000',
      strokeThickness: 2
    }).setOrigin(0.5).setScrollFactor(0).setDepth(102);
  }
  updatePictureCounter() {
    if (this.pictureCounterText) {
      this.pictureCounterText.setText(`Pictures Taken: ${this.picturesTaken}/${this.requiredPictures}`);

      //    this.pictureCounterText.setText(`'Pictures Taken' ${this.picturesTaken}/${this.requiredPictures}`);
    }
  }

  updateTimer() {

    if (!this.gameStartTime || this.gameOver || this.levelCompleted) return;
    const remaining = Math.max(0, Math.floor((this.gameStartTime - this.time.now) / 1000));
    const min = String(Math.floor(remaining / 60)).padStart(2, '0');
    const sec = String(remaining % 60).padStart(2, '0');
    this.timerText.setText(`Time: ${min}:${sec}`);
    if (remaining === 0) {
      this.endGame();
    }
  }

  updateHealthBar() {
    const percent = this.playerHealth / this.maxHealth;
    const width = 220 * percent;
    this.healthBarFill.width = width;
    this.healthBarFill.x = this.screenWidth * 0.1 - 110 + width / 2;
    const color = percent > 0.6 ? 0x00ff44 :
      percent > 0.3 ? 0xffaa00 : 0xff0044;
    this.healthBarFill.setFillStyle(color);
    this.healthText.setText(`Health: ${this.playerHealth}/${this.maxHealth}`);
  }

  takeDamage(amount) {
    this.playerHealth = Math.max(0, this.playerHealth - amount);
    this.updateHealthBar();
    if (this.player) {
      this.sound.play("ouch", { volume: 1 });
      this.sys.cameras.main.shake(200, 0.02);
      this.player.setTint(0xff0044);
      const damageText = this.add.text(this.player.x, this.player.y - 50, `-${amount}`, {
        fontSize: '24px',
        fill: '#ff0044',
        fontFamily: 'Arial',
        stroke: '#000000',
        strokeThickness: 2
      }).setOrigin(0.5);
      this.sys.tweens.add({
        targets: damageText,
        y: damageText.y - 60,
        alpha: 0,
        duration: 1000,
        onComplete: () => damageText.destroy()
      });
      this.time.delayedCall(300, () => this.player?.clearTint());
    }
    if (this.playerHealth === 0) this.endGame();
  }

  healPlayer(amount) {
    this.playerHealth = Math.min(this.maxHealth, this.playerHealth + amount);
    this.updateHealthBar();
    if (this.player) {
      this.player.setTint(0x00ff44);
      const healText = this.add.text(this.player.x, this.player.y - 50, `+${amount}`, {
        fontSize: '24px',
        fill: '#00ff44',
        fontFamily: 'Arial',
        stroke: '#000000',
        strokeThickness: 2
      }).setOrigin(0.5);
      this.sys.tweens.add({
        targets: healText,
        y: healText.y - 60,
        alpha: 0,
        duration: 1000,
        onComplete: () => healText.destroy()
      });
      this.time.delayedCall(300, () => this.player?.clearTint());
    }
  }

  endGame() {
    this.gameOver = true;
    this.physics.pause();

    const centerX = this.sys.cameras.main.scrollX + this.sys.cameras.main.width / 2;
    const centerY = this.sys.cameras.main.height / 2;

    const overlay = this.add.container(centerX, centerY).setDepth(200);

    const bg = this.add.image(-40, -50, 'game_over').setDisplaySize(666, 216);
    const title = this.add.text(-20, -47, 'Game Over', {
      font: "bold 70px Arial",
      color: '#fff'
    }).setOrigin(0.5);
    const btn = this.add.image(-40, 170, 'replay_button_big').setInteractive().setScale(0.5).setDisplaySize(666, 145)

    btn.on('pointerdown', () => {
      this.scene.restart();
    });

    overlay.add([bg, title, btn]);
  }


  completeLevel() {

    this.levelCompleted = true; // Add this line

    this.physics.pause();
    const centerX = this.sys.cameras.main.scrollX + this.sys.cameras.main.width / 2;
    const centerY = this.sys.cameras.main.height / 2;

    const overlay = this.add.container(centerX, centerY).setDepth(100);

    const bg = this.add.image(0, 0, 'level_complete').setDisplaySize(914, 217);
    const title = this.add.text(-20, 3, 'Level Complete', {
      font: "bold 70px Arial",
      color: '#fff'
    }).setOrigin(0.5);

    const replayBtn = this.add.image(-241, 220, 'replay_button')
      .setInteractive()
      .setScale(0.5)
      .setDisplaySize(441, 145)


    const nextBtn = this.add.image(241, 220, 'next_button')
      .setInteractive()
      .setScale(0.5).setDisplaySize(441, 145)

    replayBtn.on('pointerdown', () => {
      this.scene.restart();
    });

    nextBtn.on('pointerdown', () => {
      this.notifyParent('sceneComplete', { result: 'win' });
      console.log('sceneComplete');
    });

    overlay.add([bg, title, replayBtn, nextBtn]);


  }

  notifyParent(type, data) {
    if (window.parent !== window) {
      window.parent.postMessage({ type, ...data }, "*");
    }
  }


  handleDecorationCollision(deco) {
    if (deco.hasDealtDamage) return;
    deco.hasDealtDamage = true;
    const dmg = deco.texture.key === 'fly' ? 15 : 10;
    this.takeDamage(dmg);
    deco.setTint(0xff0044);
    this.time.delayedCall(400, () => deco?.clearTint());
    this.time.delayedCall(1500, () => {
      if (deco?.active) deco.hasDealtDamage = false;
    });
  }

  addPlatformDecorations() {
    const decorationTypes = ['alien_plant', 'alien_plant2', 'alien_plant3', 'alien_plant4', 'alien_plant5', 'bird'];
    const decorationScale = 0.7;
    const occupiedPositions = [];

    const isPositionAvailable = (x, y) =>
      occupiedPositions.every(p => Math.hypot(x - p.x, y - p.y) > 120);

    const placeDecoration = (x, y, type) => {
      const scale = type === 'fly' ? 0.5 : decorationScale;
      const deco = this.add.image(x, y, type)
        .setScale(scale)
        .setDepth(1);
      this.physics.add.existing(deco, true);
      deco.body.setSize(deco.width * deco.scaleX, deco.height * deco.scaleY);
      this.harmfulDecorations.push(deco);
      // Add this after: this.harmfulDecorations.push(deco);
      this.photoTargets.add(deco);
      deco.photographed = false;
      if (type === 'fly') {
        this.sys.tweens.add({
          targets: deco,
          y: y - 30,
          duration: 1500,
          ease: 'Sine.easeInOut',
          yoyo: true,
          repeat: -1
        });
        this.sys.tweens.add({
          targets: deco,
          rotation: 0.2,
          duration: 2000,
          ease: 'Sine.easeInOut',
          yoyo: true,
          repeat: -1
        });
      }
      occupiedPositions.push({ x, y });
    };

    this.groundPlatforms.forEach(platform => {
      if (platform.index === 0) return;
      if (Math.random() < 0.4) {
        const type = Phaser.Utils.Array.GetRandom(decorationTypes);
        const x = Phaser.Math.Between(
          platform.x - platform.width / 2 + 40,
          platform.x + platform.width / 2 - 40
        );
        const y = platform.y - 60;
        if (isPositionAvailable(x, y)) {
          placeDecoration(x, y, type);
        }
      }
    });

    this.flyingPlatformPositions.forEach(platform => {
      if (Math.random() < 0.5) {
        const type = Phaser.Utils.Array.GetRandom(decorationTypes);
        const margin = platform.isLarge ? 50 : 30;
        const x = Phaser.Math.Between(
          platform.x - platform.width / 2 + margin,
          platform.x + platform.width / 2 - margin
        );
        const y = platform.y - 60;
        if (isPositionAvailable(x, y)) {
          placeDecoration(x, y, type);
        }
      }
    });
  }

  setupControls() {
    const cam = this.sys.cameras.main;
    if (this.joystickData && (!this.joystickData.knob || !this.joystickData.knob.active)) {
      this.joystickData = null;
    }

    const shootBtnX = cam.width - 200;
    const shootBtnY = cam.height / 2 + 130;
    const joyX = 300;
    const joyY = cam.height - 400;

    if (!this.shootButton) {
      this.shootButton = this.add.image(shootBtnX, shootBtnY, 'camera')
        .setScrollFactor(0)
        .setDepth(12)
        .setScale(0.8)
        .setInteractive();

      this.shootButton.on('pointerdown', () => {
        if (!this.gameOver) this.fireHeroBullet();
      });
      // Add after: this.shootButton.on('pointerdown', () => {...});
      this.shootButton.setVisible(false);
    } else {
      this.shootButton.setPosition(shootBtnX, shootBtnY);
    }

    if (!this.joystickData) {
      const bg = this.add.image(joyX, joyY, "joystick_bg")
        .setDepth(10)
        .setScrollFactor(0)
        .setInteractive()
        .setDisplaySize(227, 227);

      const knob = this.add.image(joyX, joyY, "joystick_knob")
        .setDepth(11)
        .setScrollFactor(0)
        .setInteractive()
        .setDisplaySize(116.27, 116.27);

      this.joystickData = {
        knob,
        forceX: 0,
        forceY: 0,
        get force() {
          return Math.sqrt(this.forceX ** 2 + this.forceY ** 2);
        }
      };

      let dragging = false;
      let dragPointerId = null;
      const startX = knob.x;
      const startY = knob.y;
      const maxDist = 100;

      knob.on("pointerdown", pointer => {
        dragging = true;
        dragPointerId = pointer.id;
      });

      this.input.on("pointerup", pointer => {
        if (pointer.id === dragPointerId) {
          dragging = false;
          dragPointerId = null;
          knob.x = startX;
          knob.y = startY;
          this.joystickData.forceX = 0;
          this.joystickData.forceY = 0;
        }
      });

      this.input.on("pointermove", pointer => {
        if (!dragging || pointer.id !== dragPointerId) return;

        const dx = pointer.x - startX;
        const dy = pointer.y - startY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx);

        const clampedDist = Phaser.Math.Clamp(dist, 0, maxDist);
        knob.x = startX + Math.cos(angle) * clampedDist;
        knob.y = startY + Math.sin(angle) * clampedDist;

        this.joystickData.forceX = Phaser.Math.Clamp(dx / maxDist, -1, 1);
        this.joystickData.forceY = Phaser.Math.Clamp(dy / maxDist, -1, 1);
      });
    } else {
      this.joystickData.knob.setPosition(joyX, joyY);
    }
  }

  checkNearbyPhotoTargets() {
    if (!this.player || this.gameOver) return;

    let nearestTarget = null;
    let minDistance = 200; // Detection radius

    this.photoTargets.forEach(target => {
      if (!target.active || target.photographed) return; // Skip photographed targets
      const distance = Phaser.Math.Distance.Between(
        this.player.x, this.player.y,
        target.x, target.y
      );
      if (distance < minDistance) {
        nearestTarget = target;
        minDistance = distance;
      }
    });

    this.nearbyPhotoTarget = nearestTarget;

    // Show/hide camera button based on proximity
    if (this.shootButton) {
      this.shootButton.setVisible(!!nearestTarget);
    }
  }

  fireHeroBullet() {
    if (!this.nearbyPhotoTarget || this.gameOver) return;

    this.sound.play("shutter", { volume: 1 });
    // Take picture effect
    this.sys.cameras.main.flash(200, 255, 255, 255);

    // Mark target as photographed and grey it out
    this.photoTargets.delete(this.nearbyPhotoTarget);
    this.nearbyPhotoTarget.setTint(0x666666); // Grey tint
    this.nearbyPhotoTarget.setAlpha(0.6); // Make it semi-transparent
    this.nearbyPhotoTarget.photographed = true; // Mark as photographed
    this.nearbyPhotoTarget = null;





    this.picturesTaken++;
    this.updatePictureCounter();

    // Check win condition
    if (this.picturesTaken >= this.requiredPictures) {
      this.completeLevel();
    }
  }



  update() {
    if (!this.player || !this.player.body || !this.gameStarted || this.gameOver) return;
    // Add after: if (!this.player || !this.player.body || !this.gameStarted || this.gameOver) return;
    this.checkNearbyPhotoTargets();
    this.updateTimer();
    const speed = 350;
    const jumpPower = -900;

    // Joystick movement
    if (this.joystickData && this.joystickData.force > 0.1) {
      const fx = this.joystickData.forceX;
      const fy = this.joystickData.forceY;
      this.player.setVelocityX(fx * speed);
      this.player.setAngle(fx * 5);
      if (fx > 0) {
        this.player.setFlipX(false);
        this.player.anims.play('right', true);
      } else if (fx < 0) {
        this.player.setFlipX(true);
        this.player.anims.play('left', true);
      }
      if (fy < -0.5 && this.player.body.touching.down) {
        this.player.setVelocityY(jumpPower);
      }
    } else {
      this.player.setVelocityX(0);
      this.player.setAngle(0);
      this.player.anims.play('turn');
    }

    // Fall detection
    const fallLimit = this.screenHeight - 100;
    if (this.player.y > fallLimit && !this.gameOver) {
      this.takeDamage(30);
      this.player.setPosition(this.player.x - 100, this.platformY - 160);
    }

    if (this.player.x > this.physics.world.bounds.width - 500 && this.picturesTaken >= this.requiredPictures) {
      this.completeLevel();
    }

  }

  shootBullet() {
    // Implement bullet shooting logic here if needed
    console.log('Shoot bullet!');
  }
}








