class WinScene extends Phaser.Scene {
  constructor() { super('WinScene'); }
  init(data) { this.finalScore = data.score || 0; }

  preload() {
    const cfg = this.registry.get('cfg') || {};
    const { images1 = {}, images2 = {}, ui = {}, spritesheets = {}, audio = {}, font = {} } = cfg;

    const safeLoadImage = (key, url) => {
      if (!key || !url) return;
      if (!this.textures.exists(key)) this.load.image(key, url);
    };
    const safeLoadSheet = (key, obj) => {
      if (!key || !obj || !obj.url) return;
      if (!this.textures.exists(key)) {
        this.load.spritesheet(key, obj.url, {
          frameWidth: obj.frameWidth || 64,
          frameHeight: obj.frameHeight || 64,
          endFrame: (obj.frames || 0) - 1
        });
      }
    };
    const safeLoadAudio = (key, url) => {
      if (!key || !url) return;
      if (!this.cache.audio.exists(key)) this.load.audio(key, url);
    };

    // Images
    Object.entries(images1).forEach(([key, url]) => safeLoadImage(key, url));
    Object.entries(ui).forEach(([key, url]) => safeLoadImage(key, url));
    Object.entries(images2).forEach(([key, url]) => safeLoadImage(key, url));
    // Spritesheets
    Object.entries(spritesheets).forEach(([key, sheet]) => safeLoadSheet(key, sheet));
    // Audio
    Object.entries(audio).forEach(([key, url]) => safeLoadAudio(key, url));

    // Load font (non-blocking)
    if (font && font.family && font.url && 'FontFace' in window) {
      const ff = new FontFace(font.family, `url(${font.url})`);
      ff.load().then(loaded => document.fonts.add(loaded)).catch(() => { });
    }
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

    if (this.textures.exists('lvlbox')) this.add.image(cx, cy, 'lvlbox').setScrollFactor(0).setScale(0.55, 0.6);

    if (cfg.images2?.background) {
      this.add.image(0, 0, 'background2').setOrigin(0).setDepth(-1).setScrollFactor(0);
    }
    this.add.text(cx, cy, title, {
      fontSize: '70px', fill: '#ffffff', fontFamily, stroke: '#000', strokeThickness: 6
    }).setOrigin(0.5).setScrollFactor(0);

    const nextKey = (cfg.ui && cfg.ui.next) ? 'next' : null;
    const replayKey = (cfg.ui && cfg.ui.lvl_replay) ? 'lvl_replay' : null;

    const next = nextKey
      ? this.add.image(cx - 235, cy + 370, nextKey).setScrollFactor(0)
      : this.add.text(cx - 235, cy + 330, 'NEXT', { fontSize: '56px', fill: '#0ff', fontFamily, stroke: '#000', strokeThickness: 8 }).setOrigin(0.5);

    const lvlReplay = replayKey
      ? this.add.image(cx + 235, cy + 370, replayKey).setScrollFactor(0)
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
