class GameOverScene extends Phaser.Scene {
  constructor() { super('GameOverScene'); }
  init(data) { this.finalScore = data.score || 0; }
  create() {
    const cfg = this.registry.get('cfg') || {};
    // Add background image
    this.add.image(this.scale.width / 2, this.scale.height / 2, 'game-over')
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(-1); // Ensure background is behind other elements

    const fontFamily = (cfg.font && cfg.font.family) ? cfg.font.family : 'Outfit, Arial';
    const texts = cfg.texts || {};
    const title = texts.game_over_title || 'Final Score: ';

    const cx = this.scale.width / 2;
    const cy = this.scale.height - 400;

    if (this.textures.exists('ovrbox')) this.add.image(cx, cy - 50, 'ovrbox').setScrollFactor(0).setDisplaySize(500,200);

    this.add.text(cx, cy - 50, title, {
      fontSize: '42px', fill: '#ffffff', fontFamily, stroke: '#000', strokeThickness: 6
    }).setOrigin(0.5).setScrollFactor(0);

    const replayKey = (cfg.ui && cfg.ui.replay) ? 'replay' : null;
    const replay = replayKey
      ? this.add.image(cx, cy + 120, replayKey).setScrollFactor(0).setDisplaySize(500,100)
      : this.add.text(cx, cy - 100, 'REPLAY', { fontSize: '56px', fill: '#0f0', fontFamily, stroke: '#000', strokeThickness: 8 }).setOrigin(0.5);

    replay.setInteractive({ useHandCursor: true });
    replay.on('pointerdown', () => this.scene.start('GameScene'));
  }
}