// mechanics.js

export default class GameScene extends Phaser.Scene {
    constructor() {
        super('GameScene');
        this.levelIndex = 0;
        this.coresCollected = 0;
        this.inMenu = true;
        this.bgMusic = null;

        this.winProcessed = false; // prevent double processing
        Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach(fn => {
            if (typeof this[fn] === 'function') this[fn] = this[fn].bind(this);
        });
    }

    init() {
        this.cfg = null;
        this.levelData = null;
        this.platforms = null;
        this.hazards = null;
        this.ready = false;
        this.winProcessed = false;

        this.cores = null;
        this.player = null;
        this.exit = null;
        this.coreText = null;
        this.menuContainer = null;

        // overlay BG refs so we can destroy properly
        this._startBg = null;
        this._winBg = null;
        this._ovrBg = null;
        this.scorebar = null;
        this.texts = {};


    }

    preload() {
        const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));

        // Load the config file first
        this.load.json('levelConfig', `${basePath}/config.json`);

        this.load.once('filecomplete-json-levelConfig', () => {
            const cfg = this.cache.json.get('levelConfig');
            this.cfg = cfg; // Save config for later use

            // Load images
            if (cfg.images1) {
                for (const [key, url] of Object.entries(cfg.images1)) {
                    this.load.image(key, `${basePath}/${url}`);
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

            // Load audio
            if (cfg.audio) {
                for (const [key, url] of Object.entries(cfg.audio)) {
                    if (typeof url !== 'string') continue;

                    // Allow both full URLs and relative paths
                    const audioUrl =
                        /^https?:\/\//i.test(url) || url.startsWith('//')
                            ? url                       // absolute URL – use as is
                            : `${basePath}/${url}`;     // relative – prefix with basePath

                    this.load.audio(key, audioUrl).on('error', () => {
                        console.error(`Failed to load audio "${key}" from ${audioUrl}`);
                    });
                }
            }


            // NOTE: Removed any spritesheet loading entirely.

            // Once everything is queued, start loading
            this.load.start();
        });
    }

    create() {
        const levelData = this.cache.json.get('levelConfig');
        this.levelData = levelData; // Keep for endLevel

        if (levelData.orientation?.frame === 'landscape' && screen.orientation && screen.orientation.lock) {
            screen.orientation.lock('landscape-primary').catch(err => console.warn('Orientation lock failed:', err));
        }

        const M = this.cfg.mechanics;
        this.playerSpeed = M.playerSpeed;
        this.jumpVelocity = M.jumpVelocity;
        this.maxJumps = M.maxJumps;
        this.conveyorDefaultSpeed = M.conveyorDefaultSpeed;

        // Safely set gravity
        if (this.cfg && this.cfg.game && this.cfg.game.gravity !== undefined) {
            this.physics.world.gravity.y = this.cfg.game.gravity;
        } else {
            this.physics.world.gravity.y = 1000;
        }

        this.platforms = this.physics.add.staticGroup();
        this.hazards = this.physics.add.staticGroup();
        this.cores = this.physics.add.group({ allowGravity: false });

        this.menuContainer = this.add.container(0, 0);
        this.time.delayedCall(0, () => this.createMenu());

        this.cursors = this.input.keyboard.createCursorKeys();
        this.flipKey = this.input.keyboard.addKey('SPACE');
        this.input.keyboard.on('keydown-P', () => this.scene.pause());
        this._setupTouch();
        this.input.addPointer(2);
        this.jumpKey = this.input.keyboard.addKey('up');
    }

    update() {
        if (!this.inMenu && this.ready && this.player) {
            this._handleMovement();
            if (Phaser.Input.Keyboard.JustDown(this.flipKey)) this._flipGravity();
        }
    }

    // ---------- Menu ----------


    _t(key, fallback = "") {
        // Priority: level override -> global -> fallback
        const levelTexts = (this.levelData && this.levelData.texts) || {};
        const globalTexts = (this.cfg && this.cfg.texts) || {};
        return (key in levelTexts ? levelTexts[key] : (key in globalTexts ? globalTexts[key] : fallback));
    }

    createMenu() {
        if (!this.bgMusic) {
            this.bgMusic = this.sound.add('bg_music', { loop: true, volume: 0.5 });
        }
        // Always (re)start from beginning on starting gameplay
        this.bgMusic.stop();
        this.bgMusic.play();

        if (!this.menuContainer) this.menuContainer = this.add.container(0, 0);
        this.menuContainer.removeAll(true);

        const width = 1920;
        const height = 1080;

        // Start overlay background (htpbg)
        this._startBg = this.add.image(width / 2, height / 2, 'htpbg')
            .setOrigin(0.5)
            .setDepth(0)
            .setScrollFactor(0);
        this.menuContainer.add(this._startBg);

        const box = this.add.image(width / 2, height / 2 - 100, 'htpbox')
            .setScale(0.6, 0.8)
            .setOrigin(0.5)
            .setDepth(1)
            .setScrollFactor(0);



        const title = this.add
            .text(width / 2, height / 3 - 180, this._t('how_to_play_title', 'How to Play'), {
                font: '70px outfit',
                fill: 'white',
                lineSpacing: 18,
                align: 'center'
            })
            .setDepth(30)
            .setOrigin(0.5)
            .setScrollFactor(0);

        const title1 = this.add
            .text(width / 2 - 250, height / 3, this._t('control_label', 'Control:'), {
                font: '50px outfit',
                fill: 'white',
                lineSpacing: 18,
                align: 'center'
            })
            .setDepth(30)
            .setOrigin(0.5)
            .setScrollFactor(0);


        const titleimg = this.add.image(900, 370, "player").setScale(0.7)


        const title2 = this.add
            .text(width / 2 - 250, height / 3 + 150, this._t('collect_label', 'Collect:'), {
                font: '50px outfit',
                fill: 'white',
                lineSpacing: 18,
                align: 'center'
            })
            .setDepth(30)
            .setOrigin(0.5)
            .setScrollFactor(0);

        const titleimg1 = this.add.image(900, 510, "power_core").setScale(2.4)



        const title3 = this.add
            .text(width / 2 - 250, height / 3 + 300, this._t('avoid_label', 'Avoid:'), {
                font: '50px outfit',
                fill: 'white',
                lineSpacing: 18,
                align: 'center'
            })
            .setDepth(30)
            .setOrigin(0.5)
            .setScrollFactor(0);

        const titleimg2 = this.add.image(900, 640, "laser_beam").setScale(1, 0.5)

        const btn = this.add.image(width / 2, height / 2 + 350, 'button').setInteractive().setScrollFactor(0);

        btn.once('pointerup', () => {
            this.menuContainer.setVisible(false);
            this.menuContainer.removeAll(true);
            this.inMenu = false;
            if (this._startBg) { this._startBg.destroy(); this._startBg = null; }
            this._startLevel(0); // always restarts level 0
        });

        this.menuContainer.add([box, title, title1, titleimg, title2, titleimg1, title3, titleimg2, btn]);
    }

    // --------- Level flow ---------

    _startLevel(index) {
        if (!this.cfg || !this.cfg.levels) return;

        this.levelIndex = index;
        this.coresCollected = 0;
        this.winProcessed = false;
        this.levelData = this.cfg.levels[this.levelIndex];

        // gameplay background
        this.add.image(1000, 550, 'background');

        this.leftButton = this.add.image(150, 900, 'left').setInteractive().setScrollFactor(0).setDepth(20);
        this.rightButton = this.add.image(400, 900, 'right').setInteractive().setScrollFactor(0).setDepth(20);
        this.upButton = this.add.image(1750, 900, 'up').setInteractive().setScrollFactor(0).setDepth(20);
        this.upButton.on('pointerdown', () => this._flipGravity());

        // flags to track button holding
        this.moveLeft = false;
        this.moveRight = false;

        // pointer down/up/out
        this.leftButton.on('pointerdown', () => (this.moveLeft = true));
        this.rightButton.on('pointerdown', () => (this.moveRight = true));
        this.leftButton.on('pointerup', () => (this.moveLeft = false));
        this.rightButton.on('pointerup', () => (this.moveRight = false));
        this.leftButton.on('pointerout', () => (this.moveLeft = false));
        this.rightButton.on('pointerout', () => (this.moveRight = false));

        // player (now a single image texture)
        const { x: px, y: py } = this.levelData.playerStart;
        this.player = this.physics.add
            .sprite(px, py, 'player')
            .setScale(0.6)
            .setBounce(0)
            .setDepth(20)
            .setCollideWorldBounds(true);

        // Tweak body size/offset if needed for collisions with your PNG
        // (these values were for the old spritesheet — adjust to your asset)
        this.player.body.setSize(this.player.width * 0.6, this.player.height * 0.8);
        this.player.body.setOffset(this.player.width * 0.2, this.player.height * 0.1);

        this.jumpsRemaining = this.maxJumps;
        this.physics.add.collider(this.player, this.platforms, () => (this.jumpsRemaining = this.maxJumps), null, this);

        // build platforms, hazards, cores
        this._buildLevel();

        // exit portal
        const { x: ex, y: ey } = this.levelData.exit;
        this.exit = this.physics.add
            .staticSprite(ex, ey, 'exit_portal')
            .setVisible(false)
            .setScale(2.5)
            .setActive(false)
            .setDepth(10);

        // HUD
        this.scorebar = this.add.image(960, 50, 'scorebar').setDepth(10).setScrollFactor(0);
        const coreLabel = this._t('cores_label', 'Cores');
        this.coreText = this.add
            .text(850, 20, `${coreLabel}: 0/${this.levelData.cores.length}`, { font: 'bold 50px outfit', fill: '#111010ff' }).setDepth(101)


        // collisions & overlaps
        this.physics.add.collider(this.player, this.platforms, this._onPlatform, null, this);
        this.physics.add.collider(this.player, this.hazards, this._onDeath, null, this);
        this.physics.add.overlap(this.player, this.cores, this._collectCore, null, this);
        this.physics.add.overlap(this.player, this.exit, this._onWin, null, this);

        this.ready = true;
    }

    _buildLevel() {
        const L = this.levelData;
        L.platforms.forEach(p => {
            const obj = this.platforms.create(p.x, p.y, p.type);
            if (p.type === 'conveyor') {
                obj.isConveyor = true;
                obj.speed = p.speed;
            }
            obj.refreshBody();
        });
        L.hazards.forEach(h => this.hazards.create(h.x, h.y, h.type));
        L.cores.forEach(c => {
            const core = this.cores.create(c.x, c.y, 'power_core')
                .setScale(2.5) // increase or decrease this value as needed
                .setDepth(5);
        });

    }

    // ---------- Movement & gravity ----------

    _handleMovement() {
        const speed = this.playerSpeed;
        const left = this.cursors.left.isDown || this.moveLeft;
        const right = this.cursors.right.isDown || this.moveRight;

        if (left) {
            this.player.setVelocityX(-speed);
            this.player.setFlipX(true);
            // no animations (single image)
        } else if (right) {
            this.player.setVelocityX(speed);
            this.player.setFlipX(false);
        } else {
            this.player.setVelocityX(0);
        }

        // conveyor belt logic
        this.platforms.getChildren().forEach(p => {
            if (p.isConveyor && (this.player.body.touching.down || this.player.body.touching.up)) {
                this.player.x += Math.sign(this.physics.world.gravity.y) * p.speed * this.game.loop.delta / 1000;
            }
        });
    }

    notifyParent(type, data) {
        if (window.parent !== window) {
            window.parent.postMessage({ type, ...data }, "*");
        }
    }

    _flipGravity() {
        // reverse world gravity
        this.physics.world.gravity.y *= -1;

        // flip the player sprite vertically whenever gravity is negative
        this.player.setFlipY(this.physics.world.gravity.y < 0);

        // flip up arrow too
        if (this.upButton) this.upButton.setFlipY(this.physics.world.gravity.y < 0);

        // play sound & shake
        // this.sound.play('flip');
        this.sys.cameras.main.shake(100, 0.005);
    }

    // ---------- Callbacks ----------

    _onPlatform(plr, plat) {
        if ((this.physics.world.gravity.y > 0 && plr.body.velocity.y > 0) ||
            (this.physics.world.gravity.y < 0 && plr.body.velocity.y < 0)) {
            plr.setVelocityY(-plr.body.velocity.y * 0.8);
        }
    }

    _collectCore(plr, core) {
        core.destroy();
        this.coresCollected++;
        this.coreText.setText(`${this._t('cores_label', 'Cores')}: ${this.coresCollected}/${this.levelData.cores.length}`);

        this.sound.play('collect');
        this.add.particles('power_core').emitParticleAt(core.x, core.y, 10);

        if (this.coresCollected === this.levelData.cores.length) {
            this.time.delayedCall(this.exitOpenDelay, () => {
                this.exit.setVisible(true).setActive(true);
            });
        }
    }

    _onDeath() {
        // Do NOT stop bgm; only play sfx and show overlay
        this.sound.play('death', { loop: false, volume: 0.3 });
        this.sys.cameras.main.shake(200, 0.02);
        this.time.delayedCall(500, () => { this.gameover(); });
    }

    _onWin() {
        this._setGameplayUIVisible(false);
        this.ready = false; // stop movement updates

        if (this.winProcessed || this.coresCollected < this.levelData.cores.length) return;
        this.winProcessed = true;

        if (this.player) { this.player.destroy(); this.player = null; }

        // Win overlay background
        this._winBg = this.add.image(960, 540, 'winbg')
            .setOrigin(0.5)
            .setDepth(9)
            .setScrollFactor(0);

        // Background box
        const lvlbox = this.add.image(960, 450, 'lvlbox').setOrigin(0.5).setScale(0.55, 0.6).setDepth(10).setScrollFactor(0);

        // Next button
        const nxt = this.add.image(1200, 800, 'next')
            .setOrigin(0.5)
            .setDepth(20)
            .setScrollFactor(0)
            .setInteractive();

        nxt.on('pointerup', () => {
            this.notifyParent('sceneComplete', { result: 'win' });
        });

        // Title Text
        const txt1 = this.add.text(
            this.sys.scale.width / 2,
            this.sys.scale.height / 2 - 200,
            this._t('level_completed_title', 'Level Completed'),
            { font: '70px outfit', fill: 'white' }
        ).setOrigin(0.5).setDepth(10).setScrollFactor(0);


        // const txt2 = this.add.text(this.sys.scale.width / 2, this.sys.scale.height / 2 + 20, `Cores Collected: ${this.coresCollected}/${this.levelData.cores.length}`, {
        //     font: '50px outfit', fill: 'white'
        // }).setOrigin(0.5).setDepth(10).setScrollFactor(0);

        // Replay button
        const replay = this.add.image(720, 800, 'lvl_replay')
            .setOrigin(0.5)
            .setDepth(20)
            .setScrollFactor(0)
            .setInteractive();

        replay.on('pointerup', () => {
            lvlbox.destroy(); nxt.destroy(); txt1.destroy(); replay.destroy();
            if (this._winBg) { this._winBg.destroy(); this._winBg = null; }
            this._handleReplayLevel();
        });
    }

    _handleNextLevel() {
        const next = this.levelIndex + 1;
        this._clearLevel();
        if (next < this.cfg.levels.length) {
            this._startLevel(next);
        } else {
            this.inMenu = true;
            this.menuContainer.setVisible(true);
            this.createMenu();
        }
    }

    _handleReplayLevel() {
        this._clearLevel();

        // Always restart BGM from beginning on Replay (win or gameover)
        if (this.bgMusic) {
            this.bgMusic.stop();
            this.bgMusic.play();
        } else {
            this.bgMusic = this.sound.add('bg_music', { loop: true, volume: 0.5 });
            this.bgMusic.play();
        }

        this._startLevel(this.levelIndex); // Replay current level
    }

    _clearLevel() {
        // Clear any pending timers
        this.time.removeAllEvents();

        // destroy everything from previous level
        this.platforms.clear(true, true);
        this.hazards.clear(true, true);
        this.cores.clear(true, true);
        if (this.player) this.player.destroy();
        if (this.exit) this.exit.destroy();
        if (this.coreText) this.coreText.destroy();

        // Clear touch buttons
        if (this.leftButton) this.leftButton.destroy();
        if (this.rightButton) this.rightButton.destroy();
        if (this.upButton) this.upButton.destroy();

        // Remove gameplay background(s)
        if (this.children && this.children.getAll) {
            this.children.getAll()
                .filter(c => c.texture && c.texture.key === 'background')
                .forEach(bg => bg.destroy());
        }

        // Remove any overlay BGs if still present
        if (this._winBg) { this._winBg.destroy(); this._winBg = null; }
        if (this._ovrBg) { this._ovrBg.destroy(); this._ovrBg = null; }
    }

    // ---------- Touch ----------

    _setupTouch() {
        this.input.addPointer(3);

        this.input.on('pointerdown', ptr => {
            this._touchLeft = ptr.x < this.sys.scale.width / 2;
            this._touchRight = !this._touchLeft;
        });

        this.input.on('pointerup', () => {
            this._touchLeft = this._touchRight = false;
        });
    }

    _setGameplayUIVisible(visible) {
        if (this.coreText) this.coreText.setVisible(visible);
        if (this.scorebar) this.scorebar.setVisible(visible);

        const btns = [this.leftButton, this.rightButton, this.upButton];
        btns.forEach(b => {
            if (!b) return;
            b.setVisible(visible);
            if (visible) b.setInteractive();
            else b.disableInteractive();
        });
    }


    gameover() {
        this._setGameplayUIVisible(false);
        this.ready = false; // stop movement updates

        // Keep BGM running; show overlay
        this.time.removeAllEvents();
        this.input.keyboard.removeAllListeners();

        if (this.player) { this.player.destroy(); this.player = null; }

        // Game Over overlay background
        this._ovrBg = this.add.image(960, 540, 'ovrbg')
            .setOrigin(0.5)
            .setDepth(9)
            .setScrollFactor(0);

        const ovrbox = this.add.image(960, 450, 'ovrbox').setOrigin(0.5).setScale(0.6, 0.8).setDepth(10).setScrollFactor(0);
        const txt = this.add.text(800, 200, this._t('game_over_title', 'Game Over'), {
            font: '70px outfit',
            fill: 'white'
        }).setDepth(101)

        const collectedLabel = this._t('cores_collected_label', 'Cores Collected');
        const txt1 = this.add.text(770, 480, `${collectedLabel}: ${this.coresCollected}/${this.levelData.cores.length}`, {
            font: '50px outfit',
            fill: 'white'
        }).setDepth(101)



        const replay = this.add.image(960, 900, 'replay')
            .setOrigin(0.5)
            .setDepth(20)
            .setScrollFactor(0)
            .setInteractive();

        replay.on('pointerup', () => {
            ovrbox.destroy();
            txt.destroy();
            txt1.destroy();
            replay.destroy();
            if (this._ovrBg) { this._ovrBg.destroy(); this._ovrBg = null; }
            this._handleReplayLevel();
        });
    }

    _restartGame() {
        // 1) Tear down any existing level objects
        this._clearLevel();

        // 2) Reset your flags
        this.inMenu = true;
        this.ready = false;
        this.levelIndex = 0;
        this.winProcessed = false;

        // 3) Restore gravity
        this.physics.world.gravity.y = (this.cfg?.game?.gravity ?? 1000);

        // 4) ONLY clear your keyboard shortcuts
        this.input.keyboard.removeAllListeners();
        this.flipKey = this.input.keyboard.addKey('SPACE');
        this.input.keyboard.on('keydown-P', () => this.scene.pause());

        // 5) (Re-)setup your touch handlers if you need them
        this._setupTouch();

        // 6) Rebuild & show the menu
        if (!this.menuContainer || !this.menuContainer.list) {
            this.menuContainer = this.add.container(0, 0);
        } else {
            this.menuContainer.removeAll(true);
        }
        this.menuContainer.setVisible(true);
        this.createMenu();
    }
}
