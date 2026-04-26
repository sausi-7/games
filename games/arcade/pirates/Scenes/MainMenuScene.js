class MainMenuScene extends Phaser.Scene {
  constructor() { super('MainMenuScene'); }
  create() {



    const cfg = this.registry.get('cfg') || {};
    if (cfg.orientation?.frame === 'landscape' && screen.orientation && screen.orientation.lock) {
      screen.orientation
        .lock('landscape-primary')
        .catch(err => console.warn('Orientation lock failed:', err));
    }

    const G = cfg.gameplay || {};
    const targetKills = Number.isFinite(G.enemyTargetKills) ? G.enemyTargetKills : 2;

    const audio = cfg.audio || {};
    // AUDIO
    for (const [key, url] of Object.entries(audio)) {
      this.load.audio(key, url);
    }

    if (cfg.audio?.bgm) {
      this.bgm = this.sound.add('bgm', { loop: true, volume: 0.4 });
      this.bgm && this.bgm.play();
    }
    const fontFamily = (cfg.font && cfg.font.family) ? cfg.font.family : 'Outfit, Arial';
    const texts = cfg.texts || {};
    const howTo = texts.how_to_play || "SURVIVE 60 SECONDS.";
    const kills = texts.kills || "KILLS";

    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;

    const boxKey = (cfg.ui && cfg.ui.htpbox) ? 'htpbox' : null;
    const playKey = (cfg.ui && cfg.ui.playbtn) ? 'playbtn' : null;
    const bg = (cfg.images2 && cfg.images2.background) ? this.add.image(0, 0, 'background').setOrigin(0).setScrollFactor(0) : null;
    const box = boxKey ? this.add.image(cx, cy - 100, boxKey).setScale(0.55, 0.8).setScrollFactor(0) : null;

    this.add.text(cx, (box ? cy - (box.displayHeight * 0.33) : cy - 600) - 100, "How to Play", {
      fontSize: '70px',
      fill: '#ffffff',
      fontFamily,
      align: 'left',
      wordWrap: { width: Math.min(1100, box ? box.displayWidth - 80 : 1100), useAdvancedWrap: true },
      lineSpacing: 6,
      stroke: '#000', strokeThickness: 6
    }).setOrigin(0.5).setScrollFactor(0);

    this.add.text(cx + 100, (box ? cy - (box.displayHeight * 0.33) : cy - 600) + 50, "Collect:", {
      fontSize: '50px',
      fill: '#ffffff',
      fontFamily,
      align: 'left',
      wordWrap: { width: Math.min(1100, box ? box.displayWidth - 80 : 1100), useAdvancedWrap: true },
      lineSpacing: 6,
      stroke: '#000', strokeThickness: 6
    }).setOrigin(0.5).setScrollFactor(0);

    this.add.text(cx - 300, (box ? cy - (box.displayHeight * 0.33) : cy - 600) + 50, "Control:", {
      fontSize: '50px',
      fill: '#ffffff',
      fontFamily,
      align: 'left',
      wordWrap: { width: Math.min(1100, box ? box.displayWidth - 80 : 1100), useAdvancedWrap: true },
      lineSpacing: 6,
      stroke: '#000', strokeThickness: 6
    }).setOrigin(0.5).setScrollFactor(0);

    this.add.image(cx - 130, (box ? cy - (box.displayHeight * 0.33) : cy) + 50, 'player').setScrollFactor(0).setScale(0.25);

    this.add.image(cx + 300, (box ? cy - (box.displayHeight * 0.33) : cy - 600) + 50, 'collectible').setScrollFactor(0).setScale(0.4);

    this.add.text(cx - 300, (box ? cy + (box.displayHeight * 0.33) : cy + 200) - 200, `${kills}(${targetKills}):`, {
      fontSize: '50px', fill: '#ffffffff', fontFamily, stroke: '#000', strokeThickness: 6
    }).setOrigin(0.5).setScrollFactor(0);

    this.add.text(cx + 100, (box ? cy + (box.displayHeight * 0.33) : cy + 200) - 200, "Avoid:", {
      fontSize: '50px', fill: '#ffffffff', fontFamily, stroke: '#000', strokeThickness: 6
    }).setOrigin(0.5).setScrollFactor(0);


    this.add.image(cx - 90, (box ? cy + (box.displayHeight * 0.33) : cy + 200) - 200, 'enemy').setScrollFactor(0).setScale(0.7);
    this.add.image(cx + 300, (box ? cy + (box.displayHeight * 0.33) : cy + 200) - 200, 'bullet1').setScrollFactor(0).setScale(0.5);


    const play = playKey
      ? this.add.image(cx, (box ? cy + (box.displayHeight * 0.33) : cy + 200) + 120, playKey)
      : this.add.text(cx, cy + 260, 'PLAY', { fontSize: '64px', fill: '#0f0', fontFamily, stroke: '#000', strokeThickness: 8 })
        .setOrigin(0.5);

    play.setInteractive({ useHandCursor: true }).setScrollFactor(0);
    play.on('pointerdown', () => {
      this.bgm && this.bgm.stop();
      this.cameras.main.fadeOut(300, 0, 0, 0);
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
        this.scene.start('GameScene');
      });
    });

    this._enterFullscreenAtStart();

  }

  _enterFullscreenAtStart() {
    const scale = this.scale;

    const tryPhaserFS = () => {
      if (!scale.isFullscreen) {
        try { scale.startFullscreen(); } catch (e) { /* ignore */ }
      }
    };

    // Try immediately (works in many desktop contexts / PWAs)
    tryPhaserFS();

    // If the browser requires a user gesture, hook the first input to enter FS
    const onceGoFS = () => {
      tryPhaserFS();
      this.input.off('pointerdown', onceGoFS);
      this.input.keyboard?.off('keydown-F', onceGoFS);
    };

    // Retry on first pointer or press F
    this.input.once('pointerdown', onceGoFS);
    this.input.keyboard?.once('keydown-F', onceGoFS);

    // Optional: keep canvas fitting when fullscreen changes
    scale.on('enterfullscreen', () => scale.refresh());
    scale.on('leavefullscreen', () => scale.refresh());
  }
}
