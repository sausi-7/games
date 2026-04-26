 class MainMenuScene extends Phaser.Scene {
      constructor() { super('MainMenuScene'); }
      create() {
        const cfg = this.registry.get('cfg') || {};
        const fontFamily = (cfg.font && cfg.font.family) ? cfg.font.family : 'Outfit, Arial';
        const texts = cfg.texts || {};
        const howTo = texts.how_to_play || "SURVIVE 60 SECONDS.";

        const cx = this.scale.width / 2;
        const cy = this.scale.height / 2;

        const boxKey = (cfg.images && cfg.images.htpbox) ? 'htpbox' : null;
        const playKey = (cfg.images && cfg.images.playbtn) ? 'playbtn' : null;

        const box = boxKey ? this.add.image(cx, cy - 40, boxKey).setScrollFactor(0) : null;

        this.add.text(cx, (box ? cy - (box.displayHeight * 0.33) : cy - 200) + 220, howTo, {
          fontSize: '50px',
          fill: '#ffffff',
          fontFamily,
          align: 'center',
          wordWrap: { width: Math.min(1100, box ? box.displayWidth - 80 : 1100), useAdvancedWrap: true },
          lineSpacing: 6,
          stroke: '#000', strokeThickness: 6
        }).setOrigin(0.5).setScrollFactor(0);

        const play = playKey
          ? this.add.image(cx, (box ? cy + (box.displayHeight * 0.33) : cy + 200) + 200, playKey)
          : this.add.text(cx, cy + 260, 'PLAY', { fontSize: '64px', fill: '#0f0', fontFamily, stroke: '#000', strokeThickness: 8 })
              .setOrigin(0.5);

        play.setInteractive({ useHandCursor: true }).setScrollFactor(0);
        play.on('pointerdown', () => {
          this.cameras.main.fadeOut(300, 0, 0, 0);
          this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
            this.scene.start('GameScene');
          });
        });
      }
    }
