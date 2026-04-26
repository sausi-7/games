export default class BalanceStackScene extends Phaser.Scene {
  constructor() {
    super('BalanceStack');
    Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach(fn => {
      if (typeof this[fn] === 'function') this[fn] = this[fn].bind(this);
    });
    this.settings = {};
    this.blockCount = 0;
    this.isDropping = false;
    this.isGameOver = false;
    this.startOverlay = null;
    this.winOverlay = null;
    this.gameOverOverlay = null;
    this.bgmSound = null;
    this.levelConfig = null;

    // refs
    this.stackGroup = null;
    this.currentBlock = null;
    this.bg = null;
    this.base = null;
    this.scoreText = null;
    this.targettext = null;

    this._destroyed = false;
    this.sfx = {};
  }

  preload() {
    const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));
    this.load.json('levelConfig', `${basePath}/config.json`);

    if (this.cache.json.exists('levelConfig')) {
      this.levelConfig = this.cache.json.get('levelConfig');
      this.loadImages();
      this.loadui();
      this.loadSounds();
    } else {
      this.load.once('filecomplete-json-levelConfig', () => {
        this.levelConfig = this.cache.json.get('levelConfig');
        this.loadImages();
        this.loadui();
        this.loadSounds();
        this.load.start();
      });
    }
  }

  loadSounds() {
    if (this.levelConfig?.audio) {
      const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));
      for (const [key, url] of Object.entries(this.levelConfig.audio)) {
        const full = url.startsWith('http') ? url : `${basePath}/${url}`;
        this.load.audio(key, full);
      }
    }
  }

  loadImages() {
    if (this.levelConfig?.images2) {
      const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));
      for (const [key, url] of Object.entries(this.levelConfig.images2)) {
        const full = url.startsWith('http') ? url : `${basePath}/${url}`;
        this.load.image(key, full);
      }
    }
  }

  loadui() {
    if (this.levelConfig?.ui) {
      const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));
      for (const [key, url] of Object.entries(this.levelConfig.ui)) {
        const full = url.startsWith('http') ? url : `${basePath}/${url}`;
        this.load.image(key, full);
      }
    }
  }

  create() {
    if (!this.levelConfig) {
      this.load.once('filecomplete-json-levelConfig', () => {
        this.levelConfig = this.cache.json.get('levelConfig');
        this.initializeScene();
      });
      this.load.start();
      return;
    }
    this.initializeScene();
  }

  // --- tiny i18n helper with {placeholders} ---
  tx(key, fallback = '', vars = null) {
    let s = (this.texts && this.texts[key]) ?? fallback ?? '';
    if (vars) {
      s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
    }
    return s;
  }

  initializeScene() {
    this._destroyed = false;

    const cfg = this.levelConfig;
    this.orientation = cfg.orientation || { width: 1080, height: 1920 };
    this.settings = cfg.game || {};
    this.texts = cfg.texts || {};
    this.images = cfg.images || {};
    this.GAME_WIDTH = this.orientation.width;
    this.GAME_HEIGHT = this.orientation.height;

    // Background
    if (this.sys.textures.exists('background')) {
      this.bg = this.add.image(this.GAME_WIDTH / 2, this.GAME_HEIGHT / 2, 'background')
        .setDisplaySize(this.GAME_WIDTH, this.GAME_HEIGHT)
        .setDepth(-100);
    } else {
      this.sys.cameras.main.setBackgroundColor(this.settings.backgroundColor ?? 0xf7fafd);
    }

    if (this.sys.textures.exists('scorebar')) {
      this.add.image(180, 70, 'scorebar');
    }

    if (this.sys.textures.exists('scorebar')) {
      this.add.image(880, 70, 'scorebar');
    }

    // Base
    if (this.sys.textures.exists('base')) {
      this.base = this.add.image(
        this.GAME_WIDTH / 2,
        this.GAME_HEIGHT - (this.settings.baseHeight ?? 120) / 2,
        'base'
      )
        .setDisplaySize(this.settings.baseWidth ?? 600, this.settings.baseHeight ?? 120)
        .setOrigin(0.5, 0.5);
    } else {
      this.base = this.add
        .rectangle(
          this.GAME_WIDTH / 2,
          this.GAME_HEIGHT - (this.settings.baseHeight ?? 120) / 2,
          this.settings.baseWidth ?? 600,
          this.settings.baseHeight ?? 120,
          this.settings.baseColor ?? 0x222c37
        )
        .setOrigin(0.5, 0.5);
    }

    // Score & stack
    this.blockCount = 0;
    this.stackGroup = this.add.group();
    this.scoreText = this.add
      .text(this.GAME_WIDTH / 2 - 370, 70, `${this.tx('score_label', 'Score')}: 00`, {
        font: '50px outfit',
        color: 'black',
        fontStyle: 'bold'
      })
      .setOrigin(0.5);

    this.targettext = this.add
      .text(
        880,
        70,
        `${this.tx('target_label', 'Target')}: ${this.settings.targetBlocks ?? 10}`,
        {
          font: '50px outfit',
          color: 'black',
          fontStyle: 'bold'
        }
      )
      .setOrigin(0.5);

    this.speed = 110;
    this.speedStep = 22;
    this.maxSpeed = 290;

    this.isDropping = false;
    this.isGameOver = false;

    // Single pointerdown handler
    this.input.removeAllListeners();
    this.input.on('pointerdown', () => {
      if (this.isGameOver) {
        this.restartGame();
        return;
      }
      if (!this.isDropping) {
        this.dropBlock();
      }
    });

    // BGM
    if (this.sound.locked) {
      this.sound.once('unlocked', () => {
        this.bgmSound = this.sound.add('bgm', { loop: true, volume: 0.6 });
        this.bgmSound.play();
      });
    } else {
      this.bgmSound = this.sound.add('bgm', { loop: true, volume: 0.6 });
      this.bgmSound.play();
    }

    // SFX
    if (this.cache.audio.exists('drop')) {
      this.sfx.drop = this.sound.add('drop', { volume: this.settings.dropVolume ?? 0.9 });
    }

    this.showStartOverlay();
  }

  showStartOverlay() {
    this.startOverlay?.destroy();
    this.startOverlay = this.add.container(0, 0).setDepth(1000);

    const htp = this.sys.textures.exists('htp')
      ? this.add.image(this.GAME_WIDTH / 2, this.GAME_HEIGHT / 2, 'htp').setOrigin(0.5).setScale(0.55, 0.8)
      : this.add
        .rectangle(this.GAME_WIDTH / 2, this.GAME_HEIGHT / 2, 900, 900, 0x000000, 0.4)
        .setOrigin(0.5);

    const howToPlayText = this.add
      .text(
        this.GAME_WIDTH / 2 - 20,
        this.GAME_HEIGHT / 2 - 200,
        this.tx('htp_title', 'How to Play'),
        {
          font: '70px outfit',
          color: '#ffffff',
          align: 'left',
          wordWrap: { width: 800 }
        }
      )
      .setOrigin(0.5);

    const howToPlayText1 = this.add
      .text(
        this.GAME_WIDTH / 2 - 20,
        this.GAME_HEIGHT / 2 +50,
        this.tx(
          'htp_body',
          'Tap to drop the moving block.\nOnly the aligned part stays.\nStack up to win!'
        ),
        {
          font: '50px outfit',
          color: '#ffffff',
          align: 'left',
          lineSpacing: 20,
          wordWrap: { width: 800 }
        }
      )
      .setOrigin(0.5);

    const img = this.add.image(700, 870, "cool_images").setScale(0.3, 1).setDepth(5)
     const img1 = this.add.image(700, 1010, "base").setScale(0.25, 0.2).setDepth(5)

    const playbtn = this.sys.textures.exists('playbtn')
      ? this.add.image(this.GAME_WIDTH / 2, this.GAME_HEIGHT / 2 + 500, 'playbtn').setOrigin(0.5).setInteractive()
      : this.add.rectangle(this.GAME_WIDTH / 2, this.GAME_HEIGHT / 2 + 620, 420, 140, 0x5eaaff).setOrigin(0.5).setInteractive();

    playbtn.on('pointerdown', () => {
      this.startOverlay?.destroy();
      this.spawnBlock();
    });

    this.startOverlay.add([htp, howToPlayText, howToPlayText1, img, img1,playbtn]);
  }

  spawnBlock() {
    if (this._destroyed) return;

    const blockW = this.settings.blockWidth ?? 500;
    const blockH = this.settings.blockHeight ?? 60;

    const firstTargetY = 200 + blockH / 2;
    const last = this._getTopBlock();
    const stackY = last
      ? last.y - blockH
      : this.base.y - (this.settings.baseHeight ?? 120) / 2 - blockH / 2;
    const startY = Math.min(firstTargetY, stackY);

    if (this.sys.textures.exists('cool_images')) {
      this.currentBlock = this.add
        .image(Phaser.Math.Between(220, this.GAME_WIDTH - 220), startY, 'cool_images')
        .setDisplaySize(blockW, blockH)
        .setOrigin(0.5, 0.5);
    } else {
      this.currentBlock = this.add
        .rectangle(
          Phaser.Math.Between(220, this.GAME_WIDTH - 220),
          startY,
          blockW,
          blockH,
          this.settings.blockColor ?? 0x5eaaff
        )
        .setOrigin(0.5, 0.5);
    }

    this.currentDir = Phaser.Math.Between(0, 1) === 0 ? -1 : 1;
    this.currentSpeed = Math.min(this.speed, this.maxSpeed);
    this.isDropping = false;
  }

  dropBlock() {
    if (!this.currentBlock || this.isDropping) return;

    // SFX when dropping
    this.sfx?.drop?.play();

    this.isDropping = true;
    this.sys.tweens.killTweensOf(this.currentBlock);
    this.physicsBlockDrop();
  }

  physicsBlockDrop() {
    if (!this.currentBlock) return;

    const blockH = this.settings.blockHeight ?? 60;
    const baseH = this.settings.baseHeight ?? 120;
    const last = this._getTopBlock();

    const targetY = last ? last.y - blockH : this.base.y - baseH / 2 - blockH / 2;

    this.sys.tweens.add({
      targets: this.currentBlock,
      y: targetY,
      duration: 250,
      ease: 'Cubic.easeIn',
      onComplete: () => {
        if (!this.currentBlock || this._destroyed) return;
        this.handleLanding();
      }
    });
  }

  handleLanding() {
    if (!this.currentBlock || !this.stackGroup) return;

    const blockW = this.settings.blockWidth ?? 500;
    const blockH = this.settings.blockHeight ?? 60;

    let leftEdge = this.currentBlock.x - blockW / 2;
    let rightEdge = this.currentBlock.x + blockW / 2;

    const last = this._getTopBlock();

    if (last && last.active) {
      let lastLeft = last.x - last.displayWidth / 2;
      let lastRight = last.x + last.displayWidth / 2;

      let overlapLeft = Math.max(leftEdge, lastLeft);
      let overlapRight = Math.min(rightEdge, lastRight);
      let overlapWidth = overlapRight - overlapLeft;

      if (overlapWidth <= 0) {
        this.blockFallsOff();
        return;
      }

      if (overlapWidth < blockW) {
        const cut = blockW - overlapWidth;
        const cutLeft = leftEdge < lastLeft ? cut : 0;
        const cutRight = rightEdge > lastRight ? cut : 0;
        const newX = overlapLeft + overlapWidth / 2;

        const makeFallingPiece = (x, w) => {
          if (w <= 0) return;
          let falling;
          if (this.sys.textures.exists('cool_images')) {
            falling = this.add
              .image(x, this.currentBlock.y, 'cool_images')
              .setDisplaySize(w, blockH)
              .setOrigin(0.5, 0.5)
              .setTint(0xe05151);
          } else {
            falling = this.add
              .rectangle(x, this.currentBlock.y, w, blockH, 0xe05151)
              .setOrigin(0.5, 0.5);
          }
          this.sys.tweens.add({
            targets: falling,
            y: falling.y + 100,
            alpha: 0,
            duration: 500,
            ease: 'Quad.easeIn',
            onComplete: () => falling.destroy()
          });
        };

        if (cutLeft) {
          makeFallingPiece(leftEdge + cutLeft / 2, cutLeft);
        }
        if (cutRight) {
          makeFallingPiece(rightEdge - cutRight / 2, cutRight);
        }

        this.currentBlock.displayWidth = overlapWidth;
        this.currentBlock.x = newX;
      }
    }

    // Add to stack
    this.stackGroup.add(this.currentBlock);
    this.blockCount += 1;
    this.scoreText?.setText(`${this.tx('score_label', 'Score')}: ${String(this.blockCount).padStart(2, '0')}`);

    // Check win
    if (this.blockCount >= (this.settings.targetBlocks ?? 10) || this.currentBlock.y < 150) {
      this.showEndScreen(true);
      return;
    }

    // Increase speed and spawn next
    this.speed = Math.min(this.speed + this.speedStep, this.maxSpeed);
    this.spawnBlock();
  }

  blockFallsOff() {
    if (!this.currentBlock) return;
    this.sys.tweens.add({
      targets: this.currentBlock,
      y: this.currentBlock.y + 170,
      alpha: 0.4,
      duration: 520,
      ease: 'Quad.easeIn',
      onComplete: () => {
        this.showEndScreen(false);
      }
    });
  }

  notifyParent(type, data) {
    if (window.parent !== window) return;
    window.parent.postMessage({ type, ...data }, '*');
  }

  showEndScreen(win) {
    this.isGameOver = true;

    if (win) {
      this.winOverlay?.destroy();
      this.winOverlay = this.add.container(0, 0).setDepth(1000);

      const box = this.sys.textures.exists('lvlbox')
        ? this.add.image(this.GAME_WIDTH / 2, this.GAME_HEIGHT / 2, 'lvlbox').setScale(0.55, 0.8).setOrigin(0.5)
        : this.add.rectangle(this.GAME_WIDTH / 2, this.GAME_HEIGHT / 2, 900, 900, 0x000000, 0.5).setOrigin(0.5);

      const text = this.add.text(
        this.GAME_WIDTH / 2 - 230,
        this.GAME_HEIGHT / 2,
        this.tx('win_title', 'You Win!'),
        {
          font: '70px outfit',
          color: 'white'
        }
      );

      const next = this.sys.textures.exists('next')
        ? this.add.image(this.GAME_WIDTH / 2 + 235, this.GAME_HEIGHT / 2 + 440, 'next').setOrigin(0.5).setInteractive()
        : this.add.rectangle(this.GAME_WIDTH / 2 + 235, this.GAME_HEIGHT / 2 + 330, 260, 120, 0x2ecc71).setOrigin(0.5).setInteractive();

      const replay = this.sys.textures.exists('replay_level')
        ? this.add.image(this.GAME_WIDTH / 2 - 235, this.GAME_HEIGHT / 2 + 440, 'replay_level').setOrigin(0.5).setInteractive()
        : this.add.rectangle(this.GAME_WIDTH / 2 - 235, this.GAME_HEIGHT / 2 + 330, 260, 120, 0x3498db).setOrigin(0.5).setInteractive();

      next.on('pointerdown', () => {
        this.notifyParent('sceneComplete', { result: 'win' });
      });
      replay.on('pointerdown', () => this.restartGame());

      this.winOverlay.add([box, text, next, replay]);
    } else {
      this.gameOverOverlay?.destroy();
      this.gameOverOverlay = this.add.container(0, 0).setDepth(1000);

      const box = this.sys.textures.exists('ovrbox')
        ? this.add.image(this.GAME_WIDTH / 2, this.GAME_HEIGHT / 2, 'ovrbox').setOrigin(0.5).setScale(0.55, 0.8)
        : this.add.rectangle(this.GAME_WIDTH / 2, this.GAME_HEIGHT / 2, 900, 900, 0x000000, 0.5).setOrigin(0.5);

      const text = this.add.text(
        this.GAME_WIDTH / 2 - 150,
        this.GAME_HEIGHT / 2 - 300,
        this.tx('game_over_title', 'Game Over'),
        {
          font: '70px outfit',
          color: 'white'
        }
      );

      const hasTarget = !!this.settings?.targetBlocks;
      const scoreLineText = this.tx(
        'your_score_fmt',
        'Your Score: {score}{slashTarget}',
        {
          score: String(this.blockCount).padStart(2, '0'),
          target: this.settings?.targetBlocks,
          slashTarget: hasTarget ? ` / ${this.settings.targetBlocks}` : ''
        }
      );

      const scoreLine = this.add
        .text(this.GAME_WIDTH / 2, this.GAME_HEIGHT / 2, scoreLineText, {
          font: '60px outfit',
          color: '#ffffff',
          align: 'center'
        })
        .setOrigin(0.5);

      const replay = this.sys.textures.exists('replay')
        ? this.add.image(this.GAME_WIDTH / 2, this.GAME_HEIGHT / 2 + 450, 'replay').setOrigin(0.5).setInteractive()
        : this.add.rectangle(this.GAME_WIDTH / 2, this.GAME_HEIGHT / 2 + 380, 280, 120, 0xe74c3c).setOrigin(0.5).setInteractive();

      replay.on('pointerdown', () => this.restartGame());

      this.gameOverOverlay.add([box, text, scoreLine, replay]);
    }
  }

  restartGame() {
    this._destroyed = true;

    if (this.currentBlock) this.sys.tweens.killTweensOf(this.currentBlock);

    this.input.removeAllListeners();

    this.startOverlay?.destroy();
    this.winOverlay?.destroy();
    this.gameOverOverlay?.destroy();

    this.currentBlock?.destroy();
    this.currentBlock = null;

    if (this.stackGroup) {
      this.stackGroup.clear(true, true);
      this.stackGroup = null;
    }

    this.scoreText?.destroy();
    this.scoreText = null;

    this.targettext?.destroy();
    this.targettext = null;

    this.base?.destroy();
    this.base = null;

    this.bg?.destroy();
    this.bg = null;

    if (this.bgmSound?.isPlaying) this.bgmSound.stop();
    if (this.sfx?.drop) {
      this.sfx.drop.destroy();
      this.sfx.drop = null;
    }

    this.scene.restart();
  }

  update(time, delta) {
    if (this.isDropping || this.isGameOver || !this.currentBlock) return;

    const d = (this.currentSpeed * (delta / 1000)) * this.currentDir;
    this.currentBlock.x += d;

    const widthNow = this.currentBlock.displayWidth ?? (this.currentBlock.width || (this.settings.blockWidth ?? 500));
    const minX = widthNow / 2 + 90;
    const maxX = this.GAME_WIDTH - widthNow / 2 - 90;

    if (this.currentBlock.x < minX) {
      this.currentBlock.x = minX;
      this.currentDir *= -1;
    } else if (this.currentBlock.x > maxX) {
      this.currentBlock.x = maxX;
      this.currentDir *= -1;
    }
  }

  _getTopBlock() {
    if (!this.stackGroup) return null;
    const arr = this.stackGroup.getChildren();
    return arr && arr.length ? arr[arr.length - 1] : null;
  }
}
