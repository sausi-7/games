class GameScene extends Phaser.Scene {
  constructor() { super('GameScene'); }

  // ✅ Load images from config (images1 + images2)
  preload() {
    // Try common places you may have stored the config
    const cfg =
      window.GAME_CONFIG ||
      this.registry.get('game_config') ||
      this.sys.game.CONFIG ||
      {};

    const basePath = cfg.basePath || ''; // optional
    const images1 = (cfg.images1 || {});
    const images2 = (cfg.images2 || {});
    const ui = (cfg.ui || {});

    // Merge and load, skipping already-loaded textures
    const allImages = { ...images1, ...images2, ...ui };
    for (const [key, url] of Object.entries(allImages)) {
      if (!this.textures.exists(key)) {
        this.load.image(key, basePath + url);
      }
    }

    const audio = (cfg.audio || {});
    for (const [key, url] of Object.entries(audio)) {
      if (!this.sound.get(key)) this.load.audio(key, basePath + url);
    }
  }

  create() {
    const centerX = 1920 / 2;
    const centerY = 1080 / 2;

    // Optional: draw background if present in images2
    if (this.textures.exists('background')) {
      this.add.image(centerX, centerY, 'background')
        .setDisplaySize(1920, 1080)
        .setDepth(-10);
    }

    // Background stars ✨
    this.add.particles(0, 0, 'star', {
      x: { min: 0, max: 1920 },
      y: { min: 0, max: 1080 },
      lifespan: 4000,
      speedY: { min: 10, max: 50 },
      scale: { start: 0.3, end: 0 },
      alpha: { start: 0.6, end: 0 },
      quantity: 3
    });

    this.choices = ['rock', 'A4_paper', 'side_view_scissors'];

    this.resultText = this.add.text(centerX, 150, '', { fontSize: '48px', fill: '#ff0' })
      .setOrigin(0.5);

    // Placeholders (wider spacing)
    this.playerPlaceholder = this.makePlaceholder(centerX - 400, centerY - 50);
    this.computerPlaceholder = this.makePlaceholder(centerX + 400, centerY - 50);

    this.playerSprite = this.add.sprite(centerX - 400, centerY - 50, 'rock')
      .setDisplaySize(200, 200)
      .setVisible(false);

    this.computerSprite = this.add.sprite(centerX + 400, centerY - 50, 'rock')
      .setDisplaySize(200, 200)
      .setVisible(false);

    // Buttons row (bottom)
    this.buttons = [];
    this.choices.forEach((choice, i) => {
      const spacing = 250; // wider gap
      const startX = centerX - spacing;
      const x = startX + i * spacing;
      const btn = this.add.sprite(x, 900, choice)
        .setInteractive({ useHandCursor: true })
        .setDisplaySize(180, 180);

      // Floating idle tween
      this.tweens.add({
        targets: btn,
        y: btn.y - 15,
        duration: 1200,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
        delay: i * 300
      });

      // Gentle rotation
      this.tweens.add({
        targets: btn,
        angle: { from: -5, to: 5 },
        duration: 2000,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      });

      btn.on('pointerover', () => this.tweens.add({
        targets: btn, scale: 1.2, duration: 150, yoyo: true
      }));
      btn.on('pointerdown', () => this.handleChoice(choice));

      this.buttons.push(btn);
    });

    // Countdown
    this.countdownText = this.add.text(centerX, 280, '3', {
      fontSize: '72px', fill: '#ff4444'
    }).setOrigin(0.5);

    this.countdown = 3;
    this.timer = this.time.addEvent({
      delay: 1000,
      repeat: 2,
      callback: () => {
        this.countdown--;
        this.countdownText.setText(this.countdown);
        if (this.countdown <= 0) {
          this.timeout();
        }
      }
    });

    this.gameOver = false;

    if (this.cache.audio && this.cache.audio.exists('bgm')) {
      this.bgm = this.sound.add('bgm', { loop: true, volume: 0.6 });
      this.bgm.play();
    }

    // Safety: ensure BGM stops if scene shuts down/destroys for any reason
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.stopBGM());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.stopBGM());

  }

  stopBGM() {
    if (this.bgm) {
      try { this.bgm.stop(); } catch (e) { }
      this.bgm.destroy();
      this.bgm = null;
    }
  }

  timeout() {
    if (this.gameOver) return;
    this.gameOver = true;
    this.buttons.forEach(b => b.disableInteractive());
    this.resultText.setText("⏳ Timeout! You Lose!");
    this.playLoseFX(this.playerSprite);
    this.time.delayedCall(700, () => {
      this.stopBGM(); // 🔊 CHANGED: stop music on game over
      this.scene.start('GameOverScene', { reason: 'timeout' });
    });
  }

  resolveRound(player, comp) {
    if (player === comp) {
      this.resultText.setText('✨ Draw!');
      this.playDrawFX(this.playerSprite, this.computerSprite);
      this.time.delayedCall(700, () => {
        this.stopBGM(); // 🔊 stop on draw → game over
        this.scene.start('GameOverScene', { reason: 'draw', player, comp });
      });
      return;
    }

    const isWin =
      (player === 'rock' && comp === 'side_view_scissors') ||
      (player === 'A4_paper' && comp === 'rock') ||
      (player === 'side_view_scissors' && comp === 'A4_paper');

    if (isWin) {
      this.resultText.setText('🔥 You Win!');
      this.playWinFX(this.playerSprite);
      this.time.delayedCall(700, () => {
        this.stopBGM(); // 🔊 stop on win
        this.scene.start('WinScene', { player, comp });
      });
    } else {
      this.resultText.setText('💀 You Lose!');
      this.playLoseFX(this.playerSprite);
      this.time.delayedCall(700, () => {
        this.stopBGM(); // 🔊 stop on loss
        this.scene.start('GameOverScene', { reason: 'lost', player, comp });
      });
    }
  }

  makePlaceholder(x, y) {
    const container = this.add.container(x, y);
    const circle = this.add.circle(0, 0, 120, 0x333333).setStrokeStyle(8, 0x00bbff);
    const q = this.add.text(0, 0, '?', { fontSize: '72px', color: '#fff' }).setOrigin(0.5);
    container.add([circle, q]);
    return container;
  }

  handleChoice(playerChoice) {
    if (this.gameOver) return;
    this.gameOver = true;
    this.timer.remove(false);

    this.buttons.forEach(b => b.disableInteractive());

    this.playerPlaceholder.setVisible(false);
    this.playerSprite.setTexture(playerChoice).setVisible(true);

    const computerChoice = Phaser.Utils.Array.GetRandom(this.choices);
    this.computerPlaceholder.setVisible(false);
    this.computerSprite.setTexture(computerChoice).setVisible(true);

    this.resolveRound(playerChoice, computerChoice);
  }

  timeout() {
    if (this.gameOver) return;
    this.gameOver = true;
    this.buttons.forEach(b => b.disableInteractive());
    this.resultText.setText("⏳ Timeout! You Lose!");
    this.playLoseFX(this.playerSprite);
    this.time.delayedCall(700, () => {
      this.scene.start('GameOverScene', { reason: 'timeout' });
    });
  }

  resolveRound(player, comp) {
    if (player === comp) {
      this.resultText.setText('✨ Draw!');
      this.playDrawFX(this.playerSprite, this.computerSprite);
      this.time.delayedCall(700, () => {
        this.scene.start('GameOverScene', { reason: 'draw', player, comp });
      });
      return;
    }

    const isWin =
      (player === 'rock' && comp === 'side_view_scissors') ||
      (player === 'A4_paper' && comp === 'rock') ||
      (player === 'side_view_scissors' && comp === 'A4_paper');

    if (isWin) {
      this.resultText.setText('🔥 You Win!');
      this.playWinFX(this.playerSprite);
      this.time.delayedCall(700, () => {
        this.scene.start('WinScene', { player, comp });
      });
    } else {
      this.resultText.setText('💀 You Lose!');
      this.playLoseFX(this.playerSprite);
      this.time.delayedCall(700, () => {
        this.scene.start('GameOverScene', { reason: 'lost', player, comp });
      });
    }
  }

  playWinFX(sprite) {
    this.add.particles(sprite.x, sprite.y, 'particle', {
      speed: { min: 100, max: 300 },
      angle: { min: 0, max: 360 },
      lifespan: 1000,
      quantity: 25,
      scale: { start: 1, end: 0 },
      alpha: { start: 1, end: 0 }
    });
    this.tweens.add({
      targets: sprite,
      scale: 1.4,
      duration: 300,
      yoyo: true,
      ease: 'Back.easeOut'
    });
  }

  playLoseFX(sprite) {
    this.cameras.main.shake(500, 0.025);
    this.add.particles(sprite.x, sprite.y, 'red', {
      speed: { min: 70, max: 220 },
      lifespan: 900,
      quantity: 20,
      scale: { start: 1, end: 0 },
      alpha: { start: 1, end: 0 }
    });
    sprite.setTint(0xff0000);
    this.time.delayedCall(500, () => sprite.clearTint());
  }

  playDrawFX(player, comp) {
    this.add.particles(1920 / 2, 1080 / 2 - 50, 'white', {
      speed: { min: 70, max: 150 },
      angle: { min: 0, max: 360 },
      lifespan: 700,
      quantity: 15,
      scale: { start: 0.8, end: 0 },
      alpha: { start: 1, end: 0 }
    });
    this.tweens.add({
      targets: [player, comp],
      scale: 1.3,
      duration: 300,
      yoyo: true,
      repeat: 1,
      ease: 'Sine.easeInOut'
    });
  }

  endGame() {
    this.countdownText.setText('');
    this.tweens.add({
      targets: this.cameras.main,
      alpha: 0.7,
      duration: 1500,
      onComplete: () => {
        this.add.text(1920 / 2, 600, 'Game Over', { fontSize: '64px', fill: '#fff' }).setOrigin(0.5);
      }
    });
  }
}
