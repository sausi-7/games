class MainMenuScene extends Phaser.Scene {
  constructor() { super('MainMenuScene'); }
  create() {
    const cfg = this.registry.get('cfg') || {};
    if (cfg.orientation?.frame === 'landscape' && screen.orientation && screen.orientation.lock) {
      screen.orientation
        .lock('landscape-primary')
        .catch(err => console.warn('Orientation lock failed:', err));
    }

    const audio = cfg.audio || {};

    for (const [key, url] of Object.entries(audio)) {
      this.load.audio(key, url);
    }

    if (cfg.audio?.bgm) {
      this.bgm = this.sound.add('bgm', { loop: true, volume: 0.4 });
      this.bgm && this.bgm.play();
    }

    const bg = this.add.image(0, 0, 'htpbg').setOrigin(0).setScrollFactor(0);


    const fontFamily = (cfg.font && cfg.font.family) ? cfg.font.family : 'Outfit, Arial';
    const texts = cfg.texts || {};
    const howTo = texts.how_to_play || "SURVIVE 60 SECONDS.";

    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;

    const boxKey = (cfg.ui && cfg.ui.htpbox) ? 'htpbox' : null;
    const playKey = (cfg.ui && cfg.ui.playbtn) ? 'playbtn' : null;

    const box = boxKey ? this.add.image(cx, cy - 100, boxKey).setScale(0.55, 0.8).setScrollFactor(0) : null;

    this.add.text(cx, (box ? cy - (box.displayHeight * 0.33) : cy - 600) + 100, howTo, {
      fontSize: '50px',
      fill: '#ffffff',
      fontFamily,
      align: 'left',
      wordWrap: { width: Math.min(1100, box ? box.displayWidth - 80 : 1100), useAdvancedWrap: true },
      lineSpacing: 6,
    }).setOrigin(0.5).setScrollFactor(0);

    this.add.text(cx, (box ? cy - (box.displayHeight * 0.33) : cy - 600) - 100, "How to Play", {
      fontSize: '70px',
      fill: '#ffffff',
      fontFamily,
      align: 'left',
      wordWrap: { width: Math.min(1100, box ? box.displayWidth - 80 : 1100), useAdvancedWrap: true },
      lineSpacing: 6,
    }).setOrigin(0.5).setScrollFactor(0);

    const play = playKey
      ? this.add.image(cx, (box ? cy + (box.displayHeight * 0.33) : cy + 200) + 120, playKey)
      : this.add.text(cx, cy + 260, 'PLAY', { fontSize: '64px', fill: '#0f0', fontFamily, stroke: '#000', strokeThickness: 8 })
        .setOrigin(0.5);

    play.setInteractive({ useHandCursor: true }).setScrollFactor(0);
    play.on('pointerdown', () => {
      // stop bgm if playing
      const bgm = this.bgm || this.sound.get('bgm');
      if (bgm?.isPlaying) bgm.stop();

      this.cameras.main.fadeOut(300, 0, 0, 0);
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
        this.scene.start('GameScene');
      });
    });
  }
}
