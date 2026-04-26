class BootScene extends Phaser.Scene {
  constructor() { super('BootScene'); }

  preload() {
    this.load.json('gameConfig', 'config.json');

    this.load.once('filecomplete-json-gameConfig', () => {
      const cfg = this.cache.json.get('gameConfig') || {};
      this.registry.set('cfg', cfg);

      // ---- Font ----
      if (cfg.font && cfg.font.family && cfg.font.url) {
        loadFont(cfg.font.family, cfg.font.url);
      }

      // ---- Load every "images*" group ----
      Object.keys(cfg).forEach(section => {
        if (section.startsWith("images")) {
          const imgs = cfg[section];
          Object.keys(imgs).forEach(k => this.load.image(k, imgs[k]));
        }
      });

      // ---- UI ----
      const ui = cfg.ui || {};
      Object.keys(ui).forEach(k => this.load.image(k, ui[k]));

      // ---- Audio ----
      const audio = cfg.audio || {};
      Object.keys(audio).forEach(k => this.load.audio(k, audio[k]));

      // Debug log
      this.load.on('filecomplete', (key) => {
        console.log('✅ Loaded asset:', key);
      });

      // Restart loader for new batch
      this.load.start();
    });

    this.load.once('complete', () => {
     
      this.scene.start('MainMenuScene');
    });
  }
}
