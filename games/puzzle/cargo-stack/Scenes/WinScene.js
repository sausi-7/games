class WinScene extends Phaser.Scene {
  constructor() { super('WinScene'); }
  init(data) { this.finalScore = data.score || 0; }
  create() {
    const cfg = this.registry.get('cfg') || {};
    const fontFamily = (cfg.font && cfg.font.family) ? cfg.font.family : 'Outfit, Arial';
    const texts = cfg.texts || {};
    const title = texts.win_title || 'Score: ';

    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;

    if (this.textures.exists('lvlbox')) this.add.image(cx, cy, 'lvlbox').setScrollFactor(0);

    this.add.text(cx, cy - 40, title +"" + this.finalScore, {
      fontSize: '42px', fill: '#ffffff', fontFamily, stroke: '#000', strokeThickness: 6
    }).setOrigin(0.5).setScrollFactor(0);

    const nextKey = (cfg.ui && cfg.ui.next) ? 'next' : null;
    const replayKey = (cfg.ui && cfg.ui.lvl_replay) ? 'lvl_replay' : null;

    const next = nextKey
      ? this.add.image(cx - 235, cy + 330, nextKey).setScrollFactor(0)
      : this.add.text(cx - 235, cy + 330, 'NEXT', { fontSize: '56px', fill: '#0ff', fontFamily, stroke: '#000', strokeThickness: 8 }).setOrigin(0.5);

    const lvlReplay = replayKey
      ? this.add.image(cx + 235, cy + 330, replayKey).setScrollFactor(0)
      : this.add.text(cx + 235, cy + 330, 'REPLAY', { fontSize: '56px', fill: '#0f0', fontFamily, stroke: '#000', strokeThickness: 8 }).setOrigin(0.5);

    next.setInteractive({ useHandCursor: true });
    lvlReplay.setInteractive({ useHandCursor: true });

    next.on('pointerdown', () => this.notifyParent('sceneComplete', { result: 'win' }));
    lvlReplay.on('pointerdown', () => this.scene.start('GameScene'));
  }

  notifyParent(type, data) {
    if (window.parent !== window) {
      window.parent.postMessage({ type, ...data }, "*");
    }
  }
}
