class WinScene extends Phaser.Scene {
  constructor() { super('WinScene'); }
  init(data) { this.finalScore = data.score || 0; }

  preload() {
    const cfg = this.registry.get('cfg') || {};
    const images = (cfg.images1 || {});
    const images2 = (cfg.images2 || {});
    const ui = (cfg.ui || {});
    const audio = (cfg.audio || {});
    const font = cfg.font || null;

    // Optional font load via CSS
    if (font && font.url && font.family) {
      const f = new FontFace(font.family, `url(${font.url})`);
      f.load().then(ff => document.fonts.add(ff)).catch(() => { });
    }

    // IMAGES
    Object.entries(images).forEach(([key, url]) => this.load.image(key, url));
    Object.entries(images2).forEach(([key, url]) => this.load.image(key, url));
    Object.entries(ui).forEach(([key, url]) => this.load.image(key, url));
    // AUDIO
    Object.entries(audio).forEach(([key, url]) => this.load.audio(key, url));
  }
  create() {
    const cfg = this.registry.get('cfg') || {};
    const fontFamily = (cfg.font && cfg.font.family) ? cfg.font.family : 'Outfit, Arial';
    const texts = cfg.texts || {};
    const title = texts.win_title || 'Score: ';

    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;

    const audio = cfg.audio || {};
    // AUDIO
    for (const [key, url] of Object.entries(audio)) {
      this.load.audio(key, url);
    }

    if (cfg.audio?.bgm) {
      this.bgm = this.sound.add('bgm', { loop: true, volume: 0.4 });
      this.bgm && this.bgm.play();
    }
    
    const bg = (cfg.images2 && cfg.images2.background) ? this.add.image(0, 0, 'winbg').setOrigin(0).setScrollFactor(0) : null;
    if (this.textures.exists('lvlbox')) this.add.image(cx, cy, 'lvlbox').setScale(0.55, 0.4).setScrollFactor(0);

    this.add.text(cx, cy, title, {
      fontSize: '72px', fill: '#ffffff', fontFamily, stroke: '#000', strokeThickness: 6
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
    lvlReplay.on('pointerdown', () => {
      if (this.bgm) { this.bgm.stop(); this.bgm.destroy(); this.bgm = null; }
      // (belt & suspenders) also stop by key in case something else started it
      this.sound.stopByKey && this.sound.stopByKey('bgm');

      this.scene.start('MainMenuScene');
    });
  }
  notifyParent(type, data) {
    if (window.parent !== window) {
      window.parent.postMessage({ type, ...data }, "*");
    }
  }
}
