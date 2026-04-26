export default class JumpDotScene extends Phaser.Scene {
    constructor() {
        super('JumpDotScene');
        Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach((fn) => {
            if (typeof this[fn] === "function") this[fn] = this[fn].bind(this);
        });
        this.player = null;
        this.cursors = null;
        this.obstacles = null;
        this.flipSide = false;
        this.score = 0;
        this.scoreText = null;
        this.gameOver = false;

        this.GAME_WIDTH = 1080;
        this.GAME_HEIGHT = 1920;

        this.bounceHeight = 100;
        this.bounceSpeed = 5;
        this.obstacleTimer = 0;
        this.obstacleInterval = 1500;
    }

    notifyParent(type, data) {
        if (window.parent !== window) {
            window.parent.postMessage({ type, ...data }, "*");
        }
    }

    preload() {
        const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));

        // Keep absolute URLs as-is, prefix relative with basePath
        const resolveUrl = (u) => {
            if (!u) return u;
            if (/^(https?:)?\/\//i.test(u) || /^data:/i.test(u)) return u; // absolute or data URI
            return `${basePath}/${u}`;
        };

        this.load.json('levelConfig', `${basePath}/config.json`);

        this.load.once('filecomplete-json-levelConfig', () => {
            const cfg = this.cache.json.get('levelConfig') || {};

            // --- IMAGES (background/ui/etc) ---
            if (cfg.images1) {
                Object.entries(cfg.images1).forEach(([key, url]) => {
                    this.load.image(key, resolveUrl(url));
                });
            }
            if (cfg.images2) {
                Object.entries(cfg.images2).forEach(([key, url]) => {
                    this.load.image(key, resolveUrl(url));
                });
            }
            if (cfg.ui) {
                Object.entries(cfg.ui).forEach(([key, url]) => {
                    this.load.image(key, resolveUrl(url));
                });
            }

            // --- AUDIO (BGM can be an absolute URL) ---
            if (cfg.audio) {
                for (const [key, url] of Object.entries(cfg.audio)) {
                    this.load.audio(key, resolveUrl(url));
                }
            }

            // --- PLAYER IMAGE (NOT SPRITESHEET) ---
            const playerPath =
                (cfg.images1 && cfg.images1.player) ||
                (cfg.images2 && cfg.images2.player) ||
                (cfg.ui && cfg.ui.player) ||
                'assets/player.png'; // relative fallback

            this.load.image('player', resolveUrl(playerPath));

            // IMPORTANT: start a second loader pass because we enqueued after JSON
            this.load.start();
        });
    }


    // key lookup with {var} interpolation and safe fallback
    _t(key, fallback, vars = {}) {
        const src = (this.i18n && this.i18n[key]) ?? fallback ?? '';
        return src.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
    }


    create() {
        // lock portrait if supported
        if (screen.orientation && screen.orientation.lock) {
            screen.orientation.lock("portrait-primary").catch(() => { });
        }

        const cfg = this.cache.json.get('levelConfig') || {};
        this.i18n = cfg.texts || {}; // <-- all scene strings read from here

        const mechanics = cfg.mechanics || {};

        this.GAME_WIDTH = cfg.orientation?.width || 1080;
        this.GAME_HEIGHT = cfg.orientation?.height || 1920;

        this.bounceHeight = mechanics.bounceHeight ?? 100;
        this.bounceSpeed = mechanics.bounceSpeed ?? 500;
        this.obstacleInterval = mechanics.obstacleInterval ?? 1500;
        this.obstacleVelocityBase = mechanics.obstacleVelocityBase ?? 400;
        this.obstacleVelocityPerScore = mechanics.obstacleVelocityPerScore ?? 5;
        this.targetScore = mechanics.targetScore ?? 20;

        this.score = 0;
        this.gameOver = false;
        this.obstacleInterval = 1500;
        this.obstacleTimer = 0;
        this.flipSide = false;

        // background (expects 'background' in cfg images/ui)
        // background (expects 'background' in cfg images/ui)
        this.bg = this.add.image(this.GAME_WIDTH / 2, this.GAME_HEIGHT / 2, 'background')
            .setDepth(0)
            .setOrigin(0.5);


        // BGM (if present)
        this.bgm = this.sound.add('bgm', { loop: true, volume: 0.5 });
        this.bgm?.play();

        // UI
        this.scoreText = this.add.text(
            170, 33,
            `${this._t('ui.score', 'Score')}: 0`,
            { font: 'bold 50px outfit', color: '#0c0a0aff', align: 'center' }
        ).setOrigin(0.5, 0).setDepth(10);


        this.targettext = this.add.text(
            880, 33,
            `${this._t('ui.target', 'Target')}: ${this.targetScore}`,
            { font: 'bold 50px outfit', color: '#000000ff', align: 'center' }
        ).setOrigin(0.5, 0).setDepth(10);


        // --- PLAYER IMAGE (NO ANIMS) ---
        this.player = this.add.image(200, this.GAME_HEIGHT - 300, 'player')
            .setOrigin(0.5, 1)
            .setScale(1.5);

        this.physics.add.existing(this.player);
        this.player.body.setAllowGravity(false);
        this.player.body.setImmovable(true);

        // Bounce tween (same as before)
        // Bounce tween (store ref so we can pause/resume)
        this.playerBounce = this.sys.tweens.add({
            targets: this.player,
            y: `-=${this.bounceHeight}`,
            yoyo: true,
            duration: 500,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });

        // Hide player until Play is pressed
        this.player.setVisible(false);
        this.playerBounce.pause();


        // Obstacles
        this.obstacles = this.physics.add.group();

        // Tap to switch sides
        this.input.on('pointerdown', () => {
            if (this.gameOver || this.scenePaused) return;
            this.flipSide = !this.flipSide;
            const newX = this.flipSide ? this.GAME_WIDTH - 200 : 200;
            this.sys.tweens.add({
                targets: this.player,
                x: newX,
                duration: 150,
                ease: 'Power2'
            });
        });

        // Collision
        this.physics.add.overlap(this.player, this.obstacles, () => this.endGame(), null, this);

        this.createUI();
        this.scenePaused = true;
        this.showHowToPlay();
    }

    createUI() {
        this.textBox = this.add.image(170, 65, 'scorebar')
            .setScrollFactor(0)
            .setDepth(9)
            .setScale(1)
            .setOrigin(0.5);

        this.textBox1 = this.add.image(870, 65, 'scorebar')
            .setScrollFactor(0)
            .setDepth(9)
            .setScale(1)
            .setOrigin(0.5);
    }

    hideHUD(hide = true) {
        const items = [this.scoreText, this.targettext, this.textBox, this.textBox1];
        items.forEach(it => it && it.setVisible(!hide));
    }


    showBackdrop(key, alpha = 1) {
        // destroy any previous backdrop
        if (this.backdrop) this.backdrop.destroy();

        // if the requested key doesn't exist, fall back to the default background
        const textureKey = this.textures.exists(key) ? key : 'background';

        this.backdrop = this.add.image(this.GAME_WIDTH / 2, this.GAME_HEIGHT / 2, textureKey)
            .setOrigin(0.5)
            .setDepth(9)       // sits under the overlay boxes (10/11) but above the HUD (scorebar at 9 -> keep this 8 or move scorebar up)
            .setAlpha(0);

        // optional fade-in
        this.sys.tweens.add({
            targets: this.backdrop,
            alpha,
            duration: 250,
            ease: 'Power2'
        });
    }


    showHowToPlay() {
        this.htpOverlay = this.add.image(this.GAME_WIDTH / 2, this.GAME_HEIGHT / 2, 'htpbox').setScale(0.55, 0.7).setDepth(20).setOrigin(0.5);

        this.htp = this.add.text(
            this.GAME_WIDTH / 2 - 200, 740,
            this._t('menu.title', 'How to Play')
            , {
                font: '70px outfit',
                fill: '#fff',
                align: 'center'
            }).setDepth(1001)

        this.dodge = this.add.image(this.GAME_WIDTH / 2 - 150, this.GAME_HEIGHT / 2 + 130, 'object_to_avoid').setScale(0.26).setDepth(1001);
        this.dodgetext = this.add.text(
            this.GAME_WIDTH / 2 - 410, this.GAME_HEIGHT / 2 + 100,
            this._t('menu.avoid', 'Avoid:')
            , {
                font: '50px outfit',
                fill: '#fff',
                align: 'center'
            }).setDepth(1001)
        this.text = this.add.text(
            this.GAME_WIDTH / 2 - 25, this.GAME_HEIGHT / 2 - 10,
            this._t('menu.instructions', 'Tap left or right to switch positions.')
            ,
            {
                font: '50px outfit',
                fill: '#fff',
                align: 'left',
                lineSpacing: 13
            }
        ).setOrigin(0.5).setDepth(21);

        const playBtn = this.add.image(this.GAME_WIDTH / 2, this.GAME_HEIGHT / 2 + 450, 'playbtn')
            .setDepth(21)
            .setInteractive({ useHandCursor: true })
            .on('pointerdown', () => {
                this.htpOverlay.destroy();
                this.htp.destroy();
                this.dodge.destroy();
                this.dodgetext.destroy();
                this.text.destroy();
                playBtn.destroy();

                // Reveal player and resume bounce
                this.player.setVisible(true);
                this.playerBounce?.resume();

                this.scenePaused = false;
            });

    }

    update(time, delta) {
        if (this.scenePaused || this.gameOver) return;

        // Spawn obstacles
        this.obstacleTimer += delta;
        if (this.obstacleTimer > this.obstacleInterval) {
            this.spawnObstacle();
            this.obstacleTimer = 0;
            if (this.obstacleInterval > 500) this.obstacleInterval -= 20;
        }

        // Recycle obstacles
        this.obstacles.getChildren().forEach(ob => {
            if (ob.y > this.GAME_HEIGHT + 100) {
                ob.destroy();
                this.score += 1;
                this.collect = this.sound.add('collect', { loop: false, volume: 0.9 });
                this.collect?.play();
                this.scoreText.setText(`${this._t('ui.score', 'Score')}: ${this.score}`);


                if (this.score >= this.targetScore && !this.gameOver) {
                    this.winGame();
                }
            }
        });
    }

    spawnObstacle() {
        const x = Phaser.Math.Between(100, this.GAME_WIDTH - 100);
        const obstacle = this.add.image(x, -50, 'object_to_avoid').setScale(0.5);
        this.physics.add.existing(obstacle);
        obstacle.body.setVelocityY(400 + this.score * 5);
        obstacle.body.setImmovable(true);
        this.obstacles.add(obstacle);
    }

    endGame() {
        this.sound.add('collision', { volume: 3 }).play();
        this.gameOver = true;
        this.sys.cameras.main.shake(300, 0.02);
        this.physics.pause();
        this.hideHUD(true);


        // Hide the normal gameplay bg if you want the new backdrop to be clean
        this.bg?.setVisible(false);

        // NEW: show Game Over backdrop (falls back to 'background' if 'ovrbg' missing)
        this.showBackdrop('ovrbg');

        this.add.image(this.GAME_WIDTH / 2, this.GAME_HEIGHT / 2, 'ovrbox').setScale(0.5, 0.4).setDepth(10).setOrigin(0.5);
        this.add.text(540, 880, 'Game Over', {
            font: '70px outfit', fill: '#fff', align: 'center'
        }).setOrigin(0.5).setDepth(11);
        this.add.text(this.GAME_WIDTH / 2, this.GAME_HEIGHT / 2 + 70, this._t('over.score', 'Your Score: {score}', { score: this.score })
            , {
                font: '50px outfit', fill: '#fff', align: 'center'
            }).setOrigin(0.5).setDepth(11);

        this.add.image(this.GAME_WIDTH / 2, this.GAME_HEIGHT / 2 + 330, 'replay')
            .setDepth(11)
            .setInteractive({ useHandCursor: true })
            .on('pointerdown', () => {
                this.bgm?.stop();     // stop current loop
                this.scene.restart(); // create() will add+play bgm again
            });
    }

    winGame() {
        this.gameOver = true;
        this.physics.pause();
        this.hideHUD(true);


        this.bg?.setVisible(false);

        // NEW: show Win backdrop (falls back to 'background' if 'winbg' missing)
        this.showBackdrop('winbg');

        this.add.image(this.GAME_WIDTH / 2, this.GAME_HEIGHT / 2, 'lvlbox').setScale(0.5, 0.3).setDepth(10).setOrigin(0.5);
        this.add.text(this.GAME_WIDTH / 2, this.GAME_HEIGHT / 2, 'Level Completed', {
            font: '70px outfit', fill: '#fff', align: 'center'
        }).setOrigin(0.5).setDepth(11);

        this.add.image(this.GAME_WIDTH / 2 - 235, this.GAME_HEIGHT / 2 + 250, 'lvl_replay')
            .setDepth(11)
            .setInteractive({ useHandCursor: true })
            .on('pointerdown', () => {
                this.bgm?.stop();
                this.scene.restart();
            });


        this.add.image(this.GAME_WIDTH / 2 + 235, this.GAME_HEIGHT / 2 + 250, 'next')
            .setDepth(11)
            .setInteractive({ useHandCursor: true })
            .on('pointerdown', () => this.notifyParent('sceneComplete', { result: 'win' }));
    }

}
