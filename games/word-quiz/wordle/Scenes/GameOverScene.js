class GameOverScene extends Phaser.Scene {
      constructor() { super('GameOverScene'); }
      init(data) { this.finalScore = data.score || 0; }
      create() {
        const cfg = this.registry.get('cfg') || {};
        const fontFamily = (cfg.font && cfg.font.family) ? cfg.font.family : 'Outfit, Arial';
        const texts = cfg.texts || {};
        const title = texts.game_over_title || 'Final Score: ';

        const cx = this.scale.width / 2;
        const cy = this.scale.height / 2;

        if (this.textures.exists('ovrbox')) this.add.image(cx, cy-200, 'ovrbox').setScrollFactor(0);

        this.add.text(cx, cy - 140, title + " " + this.finalScore, {
          fontSize: '42px', fill: '#ffffff', fontFamily, stroke: '#000', strokeThickness: 6
        }).setOrigin(0.5).setScrollFactor(0);

        const replayKey = (cfg.ui && cfg.ui.replay) ? 'replay' : null;
        const replay = replayKey
          ? this.add.image(cx, cy + 150, replayKey).setScrollFactor(0)
          : this.add.text(cx, cy - 100, 'REPLAY', { fontSize: '56px', fill: '#0f0', fontFamily, stroke: '#000', strokeThickness: 8 }).setOrigin(0.5);

        replay.setInteractive({ useHandCursor: true });
        replay.on('pointerdown', () => this.scene.start('GameScene'));
      }
    }
