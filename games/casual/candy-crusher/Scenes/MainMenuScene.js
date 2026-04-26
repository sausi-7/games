class MainMenuScene extends Phaser.Scene {
  constructor() {
    super('MainMenuScene');
    this._bgm = null;
  }

  create() {
    const cfg = this.registry.get('cfg') || {};
    const audioCfg = cfg.audio || {};

    // ——— background
    this.add.image(this.scale.width / 2, this.scale.height / 2, 'startscreen_bg')
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(-1);

    // ——— optional orientation lock
    if (cfg.orientation?.frame === 'landscape' && screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('landscape-primary').catch(err => console.warn('Orientation lock failed:', err));
    }
 
    // ——— helpers
    const hasAudio = (key) => this.cache.audio && this.cache.audio.exists && this.cache.audio.exists(key);
    const makeSfx = (key, opts={}) => hasAudio(key) ? this.sound.add(key, { volume: 0.7, ...opts }) : null;
    const playSfx = (key, opts={}) => {
      const s = makeSfx(key, opts);
      if (s) s.play();
    };

    // ——— BGM: start after first pointer interaction (unlocks audio on mobile)
    if (hasAudio('bgm')) {
      this._bgm = this.sound.add('bgm', { loop: true, volume: 0.5 });
      const startBgm = () => {
        // some browsers need context resume on first user gesture
        try { this.sound.context && this.sound.context.resume && this.sound.context.resume(); } catch(_) {}
        if (!this._bgm.isPlaying) this._bgm.play();
      };
      // if already unlocked, play immediately; otherwise on first tap/click
      if (this.sound.locked) this.input.once('pointerdown', startBgm);
      else startBgm();
    }

    // ——— UI
    const fontFamily = (cfg.font && cfg.font.family) ? cfg.font.family : 'Outfit, Arial';
    const texts = cfg.texts || {};
    const howTo = texts.how_to_play || "SURVIVE 60 SECONDS.";

    const cx = this.scale.width / 2;
    const cy = this.scale.height - 600;

    const boxKey = (cfg.ui && cfg.ui.htpbox) ? 'htpbox' : null;
    const playKey = (cfg.ui && cfg.ui.playbtn) ? 'playbtn' : null;

    const box = boxKey ? this.add.image(cx, cy + 50, boxKey).setDisplaySize(
      Math.min(1200, this.scale.width - 40),
      Math.min(600, this.scale.height - 200)
    )
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(0) : null;

      this.add.text(cx, (box ? cy - (box.displayHeight * 0.33) + 50 : cy ) , "How to play", {
      fontSize: '60px',
      fill: '#ffffff',
      fontFamily,
      align: 'center',
      wordWrap: { width: Math.min(1100, box ? box.displayWidth - 80 : 1100), useAdvancedWrap: true },
      lineSpacing: 6,
      stroke: '#000', strokeThickness: 6
    }).setOrigin(0.5).setScrollFactor(0).setDepth(1);


    this.add.text(cx, (box ? cy - (box.displayHeight * 0.33) : cy - 400) + 170, howTo, {
      fontSize: '50px',
      fill: '#ffffff',
      fontFamily,
      align: 'center',
      wordWrap: { width: Math.min(1100, box ? box.displayWidth - 80 : 1100), useAdvancedWrap: true },
      lineSpacing: 6,
      stroke: '#000', strokeThickness: 6
    }).setOrigin(0.5).setScrollFactor(0).setDepth(1);

    const play = playKey
      ? this.add.image(cx, (box ? cy + (box.displayHeight * 0.33 - 50) : cy ), playKey).setDisplaySize(500, 100)
          .setScrollFactor(0)
          .setDepth(1)
      : this.add.text(cx, cy + 260, 'PLAY', { fontSize: '64px', fill: '#0f0', fontFamily, stroke: '#000', strokeThickness: 8 })
          .setOrigin(0.5);

    play.setInteractive({ useHandCursor: true }).setScrollFactor(0);

    // Hover + press sounds
    play.on('pointerover', () => {
      // subtle hover tick
      if (hasAudio('tick')) playSfx('tick', { volume: 0.4 });
    });

    play.on('pointerdown', () => {
      // click/confirm sound preference order
      if (hasAudio('swap_success')) playSfx('swap_success');
      else if (hasAudio('swap')) playSfx('swap');
      else if (hasAudio('special')) playSfx('special');

      // nice transition + stop bgm on scene switch
      this.cameras.main.fadeOut(300, 0, 0, 0);
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
        if (this._bgm && this._bgm.isPlaying) this._bgm.stop();
        this.scene.start('GameScene');
      });
    });

    // ——— simple mute toggle (optional)
    const muteBtn = this.add.text(this.scale.width - 30, 30, this.sound.mute ? '🔇' : '🔊', {
      fontSize: '42px',
      fontFamily
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(2).setInteractive({ useHandCursor: true });

    muteBtn.on('pointerdown', () => {
      this.sound.mute = !this.sound.mute;
      muteBtn.setText(this.sound.mute ? '🔇' : '🔊');
      // if unmuting and bgm exists, ensure it’s running
      if (!this.sound.mute && this._bgm && !this._bgm.isPlaying) {
        if (this.sound.locked) this.input.once('pointerdown', () => this._bgm.play());
        else this._bgm.play();
      }
    });
  }

  shutdown() {
    if (this._bgm && this._bgm.isPlaying) this._bgm.stop();
  }

  destroy() {
    if (this._bgm) { this._bgm.destroy(); this._bgm = null; }
  }
}
