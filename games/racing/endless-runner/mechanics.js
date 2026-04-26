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
    const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));
    this.load.json('levelConfig', `${basePath}/config.json`);

    this.load.once('filecomplete-json-levelConfig', () => {
      const cfg = this.cache.json.get('levelConfig');

      if (cfg.spritesheets) {
        for (const [key, sheet] of Object.entries(cfg.spritesheets)) {
          this.load.spritesheet(key, `${basePath}/${sheet.url}`, {
            frameWidth: sheet.frameWidth,
            frameHeight: sheet.frameHeight
          });
        }
      }

      if (cfg.images1) {
        Object.entries(cfg.images1).forEach(([key, url]) => {
          this.load.image(key, `${basePath}/${url}`);
        });
      }

      if (cfg.images2) {
        Object.entries(cfg.images2).forEach(([key, url]) => {
          this.load.image(key, `${basePath}/${url}`);
        });
      }

      if (cfg.ui) {
        Object.entries(cfg.ui).forEach(([key, url]) => {
          this.load.image(key, `${basePath}/${url}`);
        });
      }

      if (cfg.audio) {
        for (const [key, url] of Object.entries(cfg.audio)) {
          if (!url) continue;

          let finalUrl = url;

          // If it's NOT an absolute URL, prefix basePath
          if (!/^https?:\/\//i.test(url) && !url.startsWith('//')) {
            finalUrl = `${basePath}/${url}`;
          }

          this.load.audio(key, finalUrl);
        }
      }


      this.load.start();
    });
  }

  create() {
    this.cfg = this.cache.json.get('levelConfig');
    const mechanics = this.cfg.mechanics;

    const levelData = this.cache.json.get('levelConfig');
    this.levelData = levelData; // Keep for endLevel

    // Apply orientation from config
    if (levelData.orientation?.frame === 'landscape' && screen.orientation && screen.orientation.lock) {
      screen.orientation
        .lock('landscape-primary')
        .catch(err => console.warn('Orientation lock failed:', err));
    }

    this.playerSpeed = mechanics.playerSpeed;
    this.jumpVelocity = mechanics.jumpVelocity;
    this.slideDuration = mechanics.slideDuration;

    this.physics.world.gravity.y = mechanics.gravityY;
    this.physics.world.setBounds(0, 0, Number.MAX_SAFE_INTEGER, 1080);
    this.sys.cameras.main.setBounds(0, 0, Number.MAX_SAFE_INTEGER, 1080);

    this.bg = this.add
      .tileSprite(0, 0, 1920, 1080, 'background')
      .setOrigin(0)
      .setScrollFactor(0);

    this.platforms = this.physics.add.staticGroup();
    for (let i = 0; i < 10; i++) {
      const ground = this.platforms.create(i * 400, 1000, 'platform').setScale(2);
      ground.refreshBody();
    }

    this.player = this.physics.add.sprite(200, 500, 'player');
    this.player.setScale(0.5); // Using player.png as a simple image (no spritesheet/animation)

    this.player.setVelocityX(0);
    this.player.setMaxVelocity(this.playerSpeed, 1000);
    this.player.setBounce(0);
    this.player.setDrag(0);
    this.player.setFriction(0, 0);

    // 🔹 Start hidden & disabled – will be enabled on Play button
    this.player.setVisible(false);
    this.player.body.enable = false;

    // ✅ Wait for scale to apply, then store body size/offset without altering them
    this.time.delayedCall(0, () => {
      const body = /** @type {Phaser.Physics.Arcade.Body} */ (this.player.body);

      this.player.originalBodySize = {
        width: body.width,
        height: body.height,
        offsetX: body.offset.x,
        offsetY: body.offset.y
      };
    });

    this.isSliding = false;

    this.physics.add.collider(this.player, this.platforms);
    this.sys.cameras.main.startFollow(this.player);
    this.sys.cameras.main.setFollowOffset(-500, 0);

    this.obstacles = this.physics.add.group();
    this.coins = this.physics.add.group();

    this.coinCount = 0;
    this.distance = 0;

    // 🎯 Coin target (default 7, but can be overridden from mechanics.targetCoins)
    this.targetCoins = (this.cfg.mechanics && this.cfg.mechanics.targetCoins) || 7;

    // ✅ UI: create but hide; show only after Play is clicked
    this.timeBox = this.add
      .image(300, 70, 'timebox')
      .setScale(1)
      .setScrollFactor(0)
      .setVisible(false);

    this.pointBox = this.add
      .image(1600, 70, 'pointbox')
      .setScale(1)
      .setScrollFactor(0)
      .setVisible(false);

    this.coinText = this.add
      .text(1500, 40, `Coins: 0/${this.targetCoins}`, { font: '50px outfit', fill: 'black' })
      .setScrollFactor(0)
      .setVisible(false);

    this.timerText = this.add
      .text(180, 40, 'Time:', { font: '50px outfit', fill: 'black' })
      .setScrollFactor(0)
      .setVisible(false);

    this.timerEvent = null;

    this.physics.add.overlap(this.player, this.coins, this.collectCoin, null, this);
    this.physics.add.overlap(this.player, this.obstacles, this.checkCollision, null, this);

    this.setupControls();
    this.obstacleTimer = null;
    this.coinTimer = null;
    this.isGameOver = false;

    this.backgroundMusic = this.sound.add('background_music', {
      loop: true,
      volume: 0.5
    });
    this.backgroundMusic.play();

    this.showStartScreen();
  }

  setupControls() {
    this.input.on('pointerdown', pointer => {
      this.touchStartY = pointer.y;
      this.touchStartX = pointer.x;
    });

    this.input.on('pointerup', pointer => {
      const dy = pointer.y - this.touchStartY;
      const dx = pointer.x - this.touchStartX;
      const swipeThreshold = 50;

      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > swipeThreshold) {
        if (dy < 0) this.jump();
        else this.slide();
      }
    });

    this.cursors = this.input.keyboard.createCursorKeys();
  }

  update() {
    if (this.isGameOver) return;

    this.bg.tilePositionX = this.sys.cameras.main.scrollX * 0.5;

    this.platforms.children.each(platform => {
      if (platform.x + platform.displayWidth < this.sys.cameras.main.scrollX) {
        platform.x += this.platforms.getLength() * 400;
        platform.refreshBody();
      }
    });

    this.obstacles.children.each(obj => {
      if (obj.x < this.sys.cameras.main.scrollX - 200) obj.destroy();
    });

    this.coins.children.each(coin => {
      if (coin.x < this.sys.cameras.main.scrollX - 200) coin.destroy();
    });

    if (Phaser.Input.Keyboard.JustDown(this.cursors.up)) this.jump();
    if (Phaser.Input.Keyboard.JustDown(this.cursors.down)) this.slide();

    this.distance += this.playerSpeed / 1000;
  }

  jump() {
    if (!this.player.body.blocked.down || this.isSliding) return;
    this.player.setVelocityY(this.jumpVelocity);
    this.sound.play('jump');
  }

  slide() {
    if (this.isSliding || !this.player.originalBodySize) return;
    this.isSliding = true;

    const { width, height, offsetX, offsetY } = this.player.originalBodySize;

    // Shorter body for slide
    this.player.body.setSize(width, height * 0.5);
    this.player.body.setOffset(offsetX, offsetY + height * 0.5);

    this.sys.tweens.add({
      targets: this.player,
      angle: -80,
      duration: 500,
      ease: 'Power2',
      onComplete: () => {
        this.time.delayedCall(this.slideDuration, () => {
          this.player.body.setSize(width, height);
          this.player.body.setOffset(offsetX, offsetY);
          this.isSliding = false;

          this.sys.tweens.add({
            targets: this.player,
            angle: 0,
            duration: 200,
            ease: 'Power2'
          });
        });
      }
    });
  }

  spawnObstacle() {
    const mechanics = this.cfg.mechanics;
    const isHigh = Phaser.Math.Between(0, 1) === 0;
    const y = isHigh ? 620 : 880;
    const key = isHigh ? 'obstacle_high' : 'obstacle';
    const x = this.sys.cameras.main.scrollX + mechanics.obstacleSpawnDistance;

    const obstacle = this.obstacles.create(x, y, key);

    const scale = this.cfg.scales?.[key] ?? 1;
    obstacle.setScale(scale);

    obstacle.setImmovable(true);
    obstacle.body.allowGravity = false;
    obstacle.setData('type', isHigh ? 'high' : 'low');
  }

  spawnCoins() {
    const mechanics = this.cfg.mechanics;
    const yOptions = [880, 780, 720, 650];
    const y = Phaser.Math.RND.pick(yOptions);
    const baseX = this.sys.cameras.main.scrollX + mechanics.coinSpawnDistance;

    const numCoins = Phaser.Math.Between(1, 4);
    let attempts = 0;
    let valid = false;
    let spawnX = baseX;

    while (!valid && attempts < 10) {
      valid = true;
      spawnX = baseX + Phaser.Math.Between(0, 200);
      this.obstacles.children.each(obstacle => {
        if (Math.abs(obstacle.x - spawnX) < 100) valid = false;
      });
      attempts++;
    }

    const coinScale = this.cfg.scales?.coin ?? 1;

    for (let i = 0; i < numCoins; i++) {
      const coin = this.coins.create(spawnX + i * 60, y, 'coin');
      coin.setCircle(75 * coinScale); // Optional: scale hit area too
      coin.setScale(coinScale);
      coin.body.allowGravity = false;
    }
  }

  collectCoin(player, coin) {
    const playerTop = player.getBounds().top;
    const playerBottom = player.getBounds().bottom;
    const coinY = coin.y;
    const buffer = 30;

    if (coinY > playerTop - buffer && coinY < playerBottom + buffer) {
      coin.destroy();
      this.coinCount++;

      // Update with target text: Coins: X/7
      this.coinText.setText(`Coins: ${this.coinCount}/${this.targetCoins}`);
      this.sound.play('coin');

      // 🎯 If target reached, complete level (only once)
      if (this.coinCount >= this.targetCoins && !this.isGameOver) {
        this.levelComplete();
      }
    }
  }

  checkCollision(player, obstacle) {
    const type = obstacle.getData('type');
    const playerBounds = player.getBounds();
    const obstacleBounds = obstacle.getBounds();

    const overlap = Phaser.Geom.Intersects.RectangleToRectangle(playerBounds, obstacleBounds);
    if (overlap) {
      if (type === 'high') {
        if (!this.isSliding) this.gameOver();
      } else {
        this.gameOver();
      }
    }
  }

  showStartScreen() {
    const centerX = this.sys.game.config.width / 2;
    const centerY = this.sys.game.config.height / 2;

    this.startOverlay = this.add
      .container(centerX, centerY)
      .setScrollFactor(0)
      .setDepth(2);

    const children = [];

    // 🔹 Fullscreen HTP background (optional)
    if (this.textures.exists('htpbg')) {
      const fullBg = this.add
        .image(0, 0, 'htpbg')
        .setDisplaySize(this.sys.game.config.width, this.sys.game.config.height)
        .setScrollFactor(0);
      children.push(fullBg);
    }

    // 🔹 Dialog panel (old asset, kept)
    const panelKey = this.textures.exists('dialog_bg_start')
      ? 'dialog_bg_start'
      : (this.textures.exists('htpbg') ? 'htpbg' : 'background');

    const panel = this.add.image(0, -50, panelKey).setScale(0.55, 0.7);
    children.push(panel);

    const title = this.add.text(0, -245, this.cfg.texts.title || 'How to Play', {
      font: 'bold 70px outfit',
      color: '#fff'
    }).setOrigin(0.5);

    const desc = this.add.text(
      -300,
      -100,
      this.cfg.texts.instructions || 'Instructions here.',
      {
        font: '58px outfit',
        color: '#fff',
        align: 'left',
        wordWrap: { width: 820 }
      }
    ).setOrigin(0.5);

    const desc1 = this.add.text(
      -300,
      +100,
      this.cfg.texts.instructions1 || 'Instructions here.',
      {
        font: '58px outfit',
        color: '#fff',
        align: 'left',
        wordWrap: { width: 820 }
      }
    ).setOrigin(0.5);

    const desc2 = this.add.text(+50, -100, 'Avoid:', {
      font: '58px outfit',
      color: '#fff',
      align: 'left',
      wordWrap: { width: 820 }
    }).setOrigin(0.5);

    const img = this.add.image(-100, -100, 'player').setScale(0.3);
    const img1 = this.add.image(-100, 100, 'coin').setScale(0.5);
    const img2 = this.add.image(230, -100, 'obstacle_high').setScale(0.7);
    const img3 = this.add.image(390, -100, 'obstacle').setScale(0.35);

    const startBtn = this.add.image(0, 360, 'button').setInteractive();
    const startLabel = this.add
      .text(0, 230, '', { font: 'bold 48px outfit', color: '#fff' })
      .setOrigin(0.5);

    startBtn.on('pointerdown', () => {
      this.startOverlay.destroy();

      // Show & enable player when game starts
      this.player.setVisible(true);
      this.player.body.enable = true;
      this.player.setVelocityX(this.playerSpeed);

      // Show HUD only after game starts
      this.timeBox.setVisible(true);
      this.pointBox.setVisible(true);
      this.coinText.setVisible(true);
      this.timerText.setVisible(true);

      const mechanics = this.cfg.mechanics;

      this.obstacleTimer = this.time.addEvent({
        delay: mechanics.obstacleSpawnDelay,
        callback: this.spawnObstacle,
        callbackScope: this,
        loop: true
      });

      this.coinTimer = this.time.addEvent({
        delay: mechanics.coinSpawnDelay,
        callback: this.spawnCoins,
        callbackScope: this,
        loop: true
      });

      let remaining = mechanics.gameTimer || 60;
      const min0 = Math.floor(remaining / 60);
      const sec0 = remaining % 60;
      this.timerText.setText(`Time: ${min0}:${sec0 < 10 ? '0' + sec0 : sec0}`);

      this.timerEvent = this.time.addEvent({
        delay: 1000,
        repeat: remaining - 1,
        callback: () => {
          remaining--;
          const min = Math.floor(remaining / 60);
          const sec = remaining % 60;
          this.timerText.setText(`Time: ${min}:${sec < 10 ? '0' + sec : sec}`);

          if (remaining === 0 && !this.isGameOver) {
            this.levelComplete();
          }
        }
      });

      this.state = 'playing';
    });

    children.push(
      title,
      desc,
      desc1,
      desc2,
      img,
      img1,
      img2,
      img3,
      startBtn,
      startLabel
    );

    this.startOverlay.add(children);
    this.state = 'start';
  }

  gameOver() {
    this.sound.play('collision');
    this.isGameOver = true;
    this.player.setVelocity(0);
    this.physics.pause();

    if (this.obstacleTimer) this.obstacleTimer.remove();
    if (this.coinTimer) this.coinTimer.remove();
    if (this.timerEvent) this.timerEvent.remove();

    const centerX = this.sys.game.config.width / 2;
    const centerY = this.sys.game.config.height / 2;

    this.gameOverOverlay = this.add
      .container(centerX, centerY)
      .setDepth(2);

    const children = [];

    // 🔹 Fullscreen lose background (optional)
    if (this.textures.exists('ovrbg')) {
      const fullBg = this.add
        .image(0, 0, 'ovrbg')
        .setDisplaySize(this.sys.game.config.width, this.sys.game.config.height)
        .setScrollFactor(0);
      children.push(fullBg);
    }

    // 🔹 Panel (old asset, kept)
    const panelKey = this.textures.exists('game_over')
      ? 'game_over'
      : (this.textures.exists('ovrbg') ? 'ovrbg' : 'background');

    const bg = this.add
      .image(0, 0, panelKey)
      .setDisplaySize(900, 216)
      .setScrollFactor(0);
    children.push(bg);

    const title = this.add
      .text(10, 0, 'Game Over', {
        font: 'bold 70px outfit',
        color: '#fff'
      })
      .setOrigin(0.5)
      .setScrollFactor(0);

    const btn = this.add
      .image(0, 200, 'replay_button_big')
      .setInteractive()
      .setScrollFactor(0);

    const label = this.add
      .text(0, 120, '', {
        font: 'bold 48px outfit',
        color: '#fff'
      })
      .setOrigin(0.5)
      .setScrollFactor(0);

    btn.on('pointerdown', () => {
      // 🔊 Restart BGM on replay: stop old & let create() start new one
      if (this.backgroundMusic) {
        this.backgroundMusic.stop();
        this.backgroundMusic.destroy();
        this.backgroundMusic = null;
      }
      this.cleanupTextures?.();
      this.scene.restart();
    });

    children.push(title, btn, label);
    this.gameOverOverlay.add(children);

    // ❌ Do NOT stop BGM here; keep it playing on the overlay
  }

  levelComplete() {
    this.isGameOver = true;
    if (this.timerEvent) this.timerEvent.remove();
    if (this.obstacleTimer) this.obstacleTimer.remove();
    if (this.coinTimer) this.coinTimer.remove();

    this.physics.pause?.();

    const centerX = this.sys.game.config.width / 2;
    const centerY = this.sys.game.config.height / 2;

    this.levelCompleteOverlay = this.add
      .container(centerX, centerY)
      .setDepth(2);

    const children = [];

    // 🔹 Fullscreen win background (optional)
    if (this.textures.exists('winbg')) {
      const fullBg = this.add
        .image(0, 0, 'winbg')
        .setDisplaySize(this.sys.game.config.width, this.sys.game.config.height)
        .setScrollFactor(0);
      children.push(fullBg);
    }

    // 🔹 Panel (old asset, kept)
    const panelKey = this.textures.exists('level_complete')
      ? 'level_complete'
      : (this.textures.exists('winbg') ? 'winbg' : 'background');

    const bg = this.add
      .image(0, 0, panelKey)
      .setDisplaySize(914, 217)
      .setScrollFactor(0);
    children.push(bg);

    const title = this.add
      .text(0, 0, this.cfg.texts.levelComplete || 'Level Completed', {
        font: 'bold 70px outfit',
        color: '#fff'
      })
      .setOrigin(0.5)
      .setScrollFactor(0);

    const nextBtn = this.add
      .image(-230, 220, 'next_button')
      .setInteractive()
      .setDisplaySize(400, 100)
      .setScrollFactor(0);

    const replayBtn = this.add
      .image(230, 220, 'replay_button')
      .setInteractive()
      .setDisplaySize(400, 100)
      .setScrollFactor(0);

    nextBtn.on('pointerdown', () => this.events.emit('sceneComplete'));

    replayBtn.on('pointerdown', () => {
      // 🔊 Restart BGM on replay
      if (this.backgroundMusic) {
        this.backgroundMusic.stop();
        this.backgroundMusic.destroy();
        this.backgroundMusic = null;
      }
      this.cleanupTextures?.();
      this.scene.restart();
    });

    children.push(title, nextBtn, replayBtn);
    this.levelCompleteOverlay.add(children);

    // ❌ Do NOT stop BGM here either
  }
}
