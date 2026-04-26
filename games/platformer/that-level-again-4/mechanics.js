export const SCREEN_WIDTH = 1920;
export const SCREEN_HEIGHT = 1080;

export default class GamePlayScene extends Phaser.Scene {
    constructor() {
        super('GamePlayScene');
    }

    preload() {

        // determine base path for assets
        const basePath = import.meta.url.substring(
            0,
            import.meta.url.lastIndexOf('/')
        );

        // load our JSON config (which now includes a `fonts` array)
        this.load.json('levelConfig', `${basePath}/config.json`);

        this.load.once('filecomplete-json-levelConfig', () => {
            const cfg = this.cache.json.get('levelConfig');

            // ─── inject fonts from JSON ──────────────────────────

            // ────────────────────────────────────────────────────

            // now load the hero spritesheet (as before)
            const sheets = cfg.sheets || {};
            const heroData = sheets.hero || {};
            const rawMain = new URLSearchParams(window.location.search).get('main') || '';
            const cleanMain = rawMain.replace(/^"|"$/g, '');
            const sheetUrl =
                cleanMain ||
                heroData.url ||
                `${basePath}/assets/hero.png`;

            const frameW = heroData.frameWidth || 103;
            const frameH = heroData.frameHeight || 142;
            this.load.spritesheet('hero', sheetUrl, {
                frameWidth: frameW,
                frameHeight: frameH,
            });

            // images
            // if (cfg.images) {
            //     for (const [key, url] of Object.entries(cfg.images)) {
            //         this.load.image(key, url);
            //     }
            // }

            // other spritesheets
            if (cfg.spritesheets) {
                for (const [key, sheet] of Object.entries(cfg.spritesheets)) {
                    this.load.spritesheet(key, sheet.path, {
                        frameWidth: sheet.frameWidth,
                        frameHeight: sheet.frameHeight,
                    });
                }
            }

            if (cfg.images2) {
                for (const [key, url] of Object.entries(cfg.images2)) {
                    this.load.image(key, `${basePath}/${url}`);
                }
            }

            if (cfg.ui) {
                for (const [key, url] of Object.entries(cfg.ui)) {
                    this.load.image(key, `${basePath}/${url}`);
                }
            }

            if (cfg.audio) {
                for (const [key, url] of Object.entries(cfg.audio)) {
                    this.load.audio(key, `${basePath}/${url}`);
                }
            }

            // start loading everything
            this.load.start();
        });
    }

    create() {
        if (screen.orientation && screen.orientation.lock) {
            screen.orientation
                .lock('landscape-primary')
                .catch(err => console.warn('Orientation lock failed:', err));
        }
        const levelData = this.cache.json.get('levelConfig');
        this.levelData = levelData; // keep for endlevel

        // Prepare holders for specific dynamic texts
        this.htpText = null;
        this.htpMessageText = null;
        this.levelText = null;

        // Dynamic text from JSON
        const texts = levelData.texts || {};
        const textLayouts = {
            clueLabel: {
                x: 70, y: 60,
                origin: { x: 0, y: 0 },
                style: { font: 'bold 60px outfit', fill: 'black', align: 'center' },
                depth: 5
            },
            clueValue: {
                x: 220, y: 70,
                origin: { x: 0, y: 0 },
                style: { font: '50px outfit', fill: 'black', align: 'center', backgroundColor: '#FFF8EB' },
                depth: 5
            },
            htp: {
                x: 720, y: 230,
                origin: { x: 0, y: 0 },
                style: { font: 'bold 70px outfit', fill: 'white', align: 'center' },
                depth: 20
            },
            htpMessage: {
                x: 940, y: 490,
                origin: { x: 0.5, y: 0.5 },
                style: { font: '60px outfit', fill: 'white', lineSpacing: 13 },
                depth: 20
            }
        };

        Object.entries(textLayouts).forEach(([key, cfg]) => {
            const content = texts[key];
            if (!content) return;
            const txt = this.add
                .text(cfg.x, cfg.y, content, cfg.style)
                .setOrigin(cfg.origin.x, cfg.origin.y)
                .setDepth(cfg.depth);
            if (key === 'htp') this.htpText = txt;
            if (key === 'htpMessage') this.htpMessageText = txt;
        });

        // Start screen UI
        const starbg = this.add.image(0, 0, 'startbg')
            .setOrigin(0, 0).setDepth(15).setScale(1.5);
        const playbg = this.add.image(SCREEN_WIDTH / 2, 420, 'playbg')
            .setDepth(19).setScale(1);
        const playbtn = this.add.image(SCREEN_WIDTH / 2, 780, 'playbtnbg')
            .setDepth(20).setScale(1).setInteractive();

        this.physics.pause();
        playbtn.on('pointerdown', () => {
            starbg.destroy();
            playbg.destroy();
            playbtn.destroy();
            if (this.htpText) this.htpText.destroy();
            if (this.htpMessageText) this.htpMessageText.destroy();
            this.physics.resume();
            console.log('Game started');
            hintBtn.setInteractive();
        });

        this.game.canvas.style.touchAction = 'none';
        this.speed = 300;

        this.bgMusic = this.sound.add('bgmusic', { loop: true, volume: 0.5 });
        this.bgMusic.play();

        // Hero walk animation
        this.anims.create({
            key: 'hero-walk',
            frames: this.anims.generateFrameNumbers('hero', { start: 1, end: 3 }),
            frameRate: 10,
            repeat: -1
        });

        // Background and UI
        this.add.image(400, 300, 'background').setScale(0.49);
        this.add.image(200, 100, 'clue').setScale(0.45, 1).setDepth(4);


        this.input.addPointer(2);

        // fire fullscreen on first tap‐up (works better on Android)
        this.input.once('pointerup', () => {
            if (this.scale.fullscreen.available && !this.scale.isFullscreen) {
                this.scale.startFullscreen();
            }
        });

        const hintBtn = this.add.image(1800, 90, 'hint')
            .setInteractive()
            .setDepth(13)
            .setScrollFactor(0)
            .setScale(1);

        hintBtn.disableInteractive();
        hintBtn.on('pointerdown', () => {
            // create a container so we can easily destroy all elements at once
            this.physics.pause();
            this.hintContainer = this.add.container(400, 300).setDepth(50);

            // semi-transparent black background
            const panel = this.add.image(600, +120, 'board')
                .setOrigin(0.5);

            // your hint text
            const hintStr = texts.hintMessage || '';
            const hintCfg = {
                x: 600,
                y: +200,
                origin: { x: 0.5, y: 0.5 },
                style: { font: '60px outfit', fill: '#fff', lineSpacing: 13 },
                depth: 50,

            };
            const hintText = this.add
                .text(hintCfg.x, hintCfg.y, hintStr, hintCfg.style)
                .setOrigin(hintCfg.origin.x, hintCfg.origin.y);


            // close button (“X”) in top-right of panel
            const closeBtn = this.add
                .image(600, +440, 'close')
                .setScale(1)
                .setInteractive({ useHandCursor: true });

            closeBtn.on('pointerdown', () => {
                this.physics.resume();
                this.hintContainer.destroy();
            });

            // add all to container
            this.hintContainer.add([panel, hintText, closeBtn]);
        });

        // touch flags
        this.moveLeft = false;
        this.moveRight = false;

        // add the three buttons (position to taste)
        this.btnLeft = this.add.image(170, 930, 'left')
            .setInteractive().setDepth(13).setScrollFactor(0).setScale(0.9);
        this.btnRight = this.add.image(420, 930, 'right')
            .setInteractive().setDepth(13).setScrollFactor(0).setScale(0.9);
        this.btnJump = this.add.image(1750, 930, 'jump')
            .setInteractive().setDepth(13).setScrollFactor(0).setScale(0.9);

        // left button
        this.btnLeft
            .on('pointerdown', () => { this.moveLeft = true; })
            .on('pointerup', () => { this.moveLeft = false; })
            .on('pointerout', () => { this.moveLeft = false; });

        // right button
        this.btnRight
            .on('pointerdown', () => { this.moveRight = true; })
            .on('pointerup', () => { this.moveRight = false; })
            .on('pointerout', () => { this.moveRight = false; });


        // Left: tap or hold
        this.btnLeft
            .on('pointerdown', () => {
                this.moveLeft = true;
                this.hero.setVelocityX(-this.speed).setFlipX(true);
            })
            .on('pointerup', () => {
                this.moveLeft = false;
                this.hero.setVelocityX(0);
            })
            .on('pointerout', () => {
                this.moveLeft = false;
                this.hero.setVelocityX(0);
            });

        // Right: tap or hold
        this.btnRight
            .on('pointerdown', () => {
                this.moveRight = true;
                this.hero.setVelocityX(this.speed).setFlipX(false);
            })
            .on('pointerup', () => {
                this.moveRight = false;
                this.hero.setVelocityX(0);
            })
            .on('pointerout', () => {
                this.moveRight = false;
                this.hero.setVelocityX(0);
            });

        // jump button
        this.btnJump.on('pointerdown', () => {
            if (this.hero.body.onFloor()) {
                this.hero.setVelocityY(-700);
            }
        });

        // Static groups
        this.platforms = this.physics.add.staticGroup();
        this.spikes = this.physics.add.staticGroup();
        this.buttons = this.physics.add.staticGroup();
        this.next = this.physics.add.staticGroup();

        // Stick as static physics image
        this.stick = this.physics.add
            .staticImage(1680, 450, 'stick')
            .setDepth(5)
            .setScale(0.34)
            .refreshBody();

        // "Back" door (next = back)
        this.next
            .create(-39, 550, 'next')
            .setDepth(0)
            .setScale(0.5)
            .refreshBody();

        // Spawn modules
        levelData.modules.forEach(({ type, x, y, scale, angle, width, height }) => {
            let sprite;
            if (type === 'platform') {
                sprite = this.platforms.create(x, y, 'platform').setDepth(1);
            } else if (type === 'spike') {
                sprite = this.spikes.create(x, y, 'spike').setDepth(0.5);
            } else if (type === 'button') {
                sprite = this.buttons
                    .create(x, y, 'button')
                    .setData('pressed', false)
                    .setDepth(5);
            }
            if (!sprite) return;
            if (width && height) sprite.setDisplaySize(width, height);
            else if (scale) sprite.setScale(scale);
            if (angle) sprite.setAngle(angle);
            sprite.refreshBody();
        });

        // Button interactive logic
        this.buttons.getChildren().forEach(btn => {
            btn.setInteractive();
            btn.on('pointerdown', () => {
                btn.setTexture('button1');
                if (this.stick) {
                    this.stick.destroy();
                    this.stick = null;
                }
            });
            btn.on('pointerup', () => {
                ['button1', 'button'].forEach((tex, i) => {
                    this.time.delayedCall(50 * i, () => btn.setTexture(tex));
                });
            });
        });

        // Hero setup
        this.hero = this.physics.add
            .sprite(levelData.spawn.x, levelData.spawn.y, 'hero')
            .setDepth(10)
            .setScale(0.9)
            .setCollideWorldBounds(true);
        this.hero.body.setSize(40, 110);
        this.hero.body.setOffset(30, 30);

        // Colliders
        this.physics.add.collider(this.hero, this.platforms);
        this.physics.add.collider(this.hero, this.stick);
        // Slide transition to next scene on overlap
        this.physics.add.overlap(
            this.hero,
            this.next,
            () => {
                this.bgMusic.stop();
                this.physics.pause();
                endLevel(this, this.levelData);
                this.hero.destroy();
                this.hero = null;
            }
        );


        // Hero-spike collision: spawn hero1 and reset hero
        this.physics.add.collider(
            this.hero,
            this.spikes,
            (hero, spike) => {
                this.deadMusic = this.sound.add('death', { loop: false, volume: 0.5 });
                this.deadMusic.play();

                // remove any previous “ghost”
                if (this.hero1) {
                    this.hero1.destroy();
                    this.hero1 = null;
                }

                const deathX = hero.x;
                const deathY = hero.y;

                // spawn a “ghost” using frame 4 of your hero spritesheet, angled 60°
                this.hero1 = this.physics.add
                    .sprite(deathX, deathY, 'hero')
                    .setFrame(4)        // pick frame 4
                    .setAngle(-80)       // rotate 60°
                    .setDepth(10)
                    .setScale(0.9)
                    .setCollideWorldBounds(true);

                this.hero1.body.setSize(110, 70);
                this.hero1.body.setOffset(10, 25);

                this.hero1.body.setGravityY(500);

                // re-add colliders for the ghost
                this.physics.add.collider(this.hero1, this.platforms);
                this.physics.add.collider(this.hero1, this.buttons);

                // reset the real hero back to spawn
                hero.setPosition(levelData.spawn.x, levelData.spawn.y);
                hero.setVelocity(0, 0);
            }
        );


        // Input
        this.cursors = this.input.keyboard.createCursorKeys();
    }


    update() {
        if (!this.hero) return; // Exit early if hero is null
        const speed = 300;
        let moving = false;

        // horizontal: keyboard OR touch
        if (this.cursors.left.isDown || this.moveLeft) {
            this.hero.setVelocityX(-this.speed).setFlipX(true);
            moving = true;
        } else if (this.cursors.right.isDown || this.moveRight) {
            this.hero.setVelocityX(this.speed).setFlipX(false);
            moving = true;
        } else {
            this.hero.setVelocityX(0);
        }

        // walk anim
        if (moving) {
            this.hero.anims.play('hero-walk', true);
        } else {
            this.hero.anims.stop();
            this.hero.setFrame(0);
        }

        // jump (keyboard only—touch handled on pointerdown above)
        if (this.cursors.up.isDown && this.hero.body.onFloor()) {
            this.hero.setVelocityY(-700);
        }
    }
}

function notifyParent(type, data) {
    if (window.parent !== window) {
        window.parent.postMessage({ type, ...data }, "*");
    }
}

function endLevel(scene, levelData) {
    // Disable interactive buttons, with null checks for safety
    if (scene.btnLeft) scene.btnLeft.disableInteractive();
    if (scene.btnRight) scene.btnRight.disableInteractive();
    if (scene.btnJump) scene.btnJump.disableInteractive();


    const playbg1 = scene.add.image(960, 450, 'playbg1').setDepth(19).setScale(1);
    // add level text from JSON
    const levelTxtStr = levelData?.texts?.leveltxt || 'Level Complete';
    scene.levelText = scene.add.text(SCREEN_WIDTH / 2 - 10, 450, levelTxtStr, { font: 'bold 70px outfit', fill: 'white', align: 'center', wordWrap: { width: 800 } })
        .setOrigin(0.5)
        .setDepth(20);

    const startbg1 = scene.add.image(0, 0, 'startbg').setOrigin(0, 0).setDepth(18).setScale(1.5);
    const restart = scene.add.image(730, 670, 'restart').setDepth(20).setScale(1).setInteractive();
    restart.on('pointerdown', () => {
        playbg1.destroy();
        if (scene.levelText) { scene.levelText.destroy(); scene.levelText = null; }
        scene.scene.restart();
    });

    const nextbtn = scene.add.image(1190, 670, 'nextbtn').setDepth(20).setScale(1).setInteractive();
    nextbtn.on('pointerdown', () => {
        playbg1.destroy();
        if (scene.levelText) { scene.levelText.destroy(); scene.levelText = null; }
        scene.scene.stop();
        notifyParent('sceneComplete', { result: 'win' });
    });
}

