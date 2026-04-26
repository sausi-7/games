class GameOverScene extends Phaser.Scene {
  constructor() { super('GameOverScene'); }
  init(data) { this.finalScore = data.score || 0; }
  create() {
    const cfg = this.registry.get('cfg') || {};
    const fontFamily = (cfg.font && cfg.font.family) ? cfg.font.family : 'Outfit, Arial';
    const texts = cfg.texts || {};
    const title = texts.game_over_title || 'Final Score: ';

    const audio = cfg.audio || {};
    for (const [key, url] of Object.entries(audio)) this.load.audio(key, url);

    if (cfg.audio?.bgm) {
      this.bgm = this.sound.add('bgm', { loop: true, volume: 0.4 });
      this.bgm && this.bgm.play();
    }




    if (cfg.images2?.background) {
      this.add.image(0, 0, 'ovrbg').setOrigin(0).setScrollFactor(0);
    }

    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;

    if (this.textures.exists('ovrbox')) this.add.image(cx, cy + 0, 'ovrbox').setScrollFactor(0).setScale(0.55,0.6);

    this.add.text(cx, cy + 0, title, {
      fontSize: '70px', fill: '#ffffff', fontFamily, 
    }).setOrigin(0.5).setScrollFactor(0);

    const replayKey = (cfg.ui && cfg.ui.replay) ? 'replay' : null;
    const replay = replayKey
      ? this.add.image(cx, cy + 350, replayKey).setScrollFactor(0)
      : this.add.text(cx, cy - 100, 'REPLAY', { fontSize: '56px', fill: '#0f0', fontFamily, stroke: '#000', strokeThickness: 8 }).setOrigin(0.5);

    replay.setInteractive({ useHandCursor: true });
    replay.on('pointerdown', () => {
      // 🔇 stop BGM before leaving
      if (this.bgm) { this.bgm.stop(); this.bgm.destroy(); this.bgm = null; }
      // (belt & suspenders) also stop by key in case something else started it
      this.sound.stopByKey && this.sound.stopByKey('bgm');

      this.scene.start('GameScene');
    });
  }
}
