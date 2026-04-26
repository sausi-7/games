class GameOverScene extends Phaser.Scene {
  constructor() { super('GameOverScene'); }
  init(data) { this.finalScore = data.score || 0; }

  preload() {
    const cfg = this.registry.get('cfg') || {};
    const img1 = cfg.images1 || {};
    const img2 = cfg.images2 || {};
    const ui = cfg.ui || {};
    const aud = cfg.audio || {};

    if (img2.background) this.load.image('background', img2.background);
    if (img1.player) this.load.image('player', img1.player);
    if (img1.enemy) this.load.image('enemy', img1.enemy);
    if (img1.collectible) this.load.image('bullet', img1.collectible);
    if (img2.platform) this.load.image('platform', img2.platform);

    if (ui.left) this.load.image('btn_up', ui.left);
    if (ui.right) this.load.image('btn_down', ui.right);
    if (ui.action) this.load.image('btn_action', ui.action);

    if (aud.bgm) this.load.audio('bgm', aud.bgm);
    if (aud.explosion) this.load.audio('destroy', aud.explosion);
    if (aud.hit) this.load.audio('hit', aud.hit);
    if (aud.collect) this.load.audio('attack', aud.collect);
  }
  create() {
    const cfg = this.registry.get('cfg') || {};
    const fontFamily = (cfg.font && cfg.font.family) ? cfg.font.family : 'Outfit, Arial';
    const texts = cfg.texts || {};
    const title = texts.game_over_title || 'Final Score: ';

    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;

    const audio = cfg.audio || {};
    for (const [key, url] of Object.entries(audio)) this.load.audio(key, url);

    if (cfg.audio?.bgm) {
      this.bgm = this.sound.add('bgm', { loop: true, volume: 0.4 });
      this.bgm && this.bgm.play();
    }




    if (cfg.images2?.background) {
      this.add.image(0, 0, 'ovrbg').setOrigin(0).setScrollFactor(0);
    }

    if (this.textures.exists('ovrbox')) this.add.image(cx, cy - 200, 'ovrbox').setScale(0.55, 0.6).setScrollFactor(0);

    this.add.text(cx, cy - 300, "Game Over", {
      fontSize: '62px', fill: '#ffffff', fontFamily, stroke: '#000', strokeThickness: 6
    }).setOrigin(0.5).setScrollFactor(0);

    this.add.text(cx, cy - 140, title + this.finalScore, {
      fontSize: '42px', fill: '#ffffff', fontFamily, stroke: '#000', strokeThickness: 6
    }).setOrigin(0.5).setScrollFactor(0);

    const replayKey = (cfg.ui && cfg.ui.replay) ? 'replay' : null;
    const replay = replayKey
      ? this.add.image(cx, cy + 200, replayKey).setScrollFactor(0)
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
