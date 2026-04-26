  // --- BOOT: load config.json, then all assets from it ---
   class BootScene extends Phaser.Scene {
      constructor() { super('BootScene'); }
      preload() {
        // Adjust if your config lives elsewhere
        this.load.json('gameConfig', 'config.json');

        this.load.once('filecomplete-json-gameConfig', () => {
          const cfg = this.cache.json.get('gameConfig') || {};
          this.registry.set('cfg', cfg);

          // Font (optional)
          if (cfg.font && cfg.font.family && cfg.font.url) {
            loadFont(cfg.font.family, cfg.font.url);
          }

          // Images
          const images = cfg.images || {};
          Object.keys(images).forEach(k => this.load.image(k, images[k]));

          // Spritesheets
          const sheets = cfg.spritesheets || {};
          Object.keys(sheets).forEach(k => {
            const s = sheets[k];
            this.load.spritesheet(k, s.url, {
              frameWidth: s.frameWidth, frameHeight: s.frameHeight,
              startFrame: s.startFrame || 0, endFrame: s.endFrame || undefined
            });
          });

          // Audio
          const audio = cfg.audio || {};
          Object.keys(audio).forEach(k => this.load.audio(k, audio[k]));
        });
      }
      create() {
        // When everything above finishes, start menu
        // Slight delay ensures font is ready
        this.time.delayedCall(50, () => this.scene.start('MainMenuScene'));
      }
    }
