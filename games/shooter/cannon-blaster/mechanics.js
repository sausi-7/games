export default class GameScene extends Phaser.Scene {
    constructor() {
        super('GameScene');
        this.loadedConfig = null;
        this.score = 0;
        this.lives = 3;
        this.initialLives = 3;     // <-- keep original max for x/x display
        this.stoneSpawnTimer = 0;
        this.spawnInterval = 2000; // Initial spawn every 2 seconds
        this.cannon = null;
        this.stones = null;
        this.cannonShots = null;
        this.scoreTarget = 200;
        this.hasEnded = false;
        this.isPaused = false;
        this.invincibilityTimer = 0;
        this.invincibilityTime = 2000;

        this.isGameStarted = false; // Ensure game starts with How to Play screen

        // UI refs
        this.scoreText = null;
        this.livesText = null;     // <-- numeric lives text
        this.targetText = null;

        this.fireEvent = null;
        // <-- target score text

        Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach(fn => {
            if (typeof this[fn] === 'function') {
                this[fn] = this[fn].bind(this);
            }
        });
    }

    preload() {
        this.loadConfig();
    }

    create() {
        this.loadedConfig = this.cache.json.get('levelConfig');
        // Reset critical game states
        this.texts = this.loadedConfig?.texts || {};
        this.mechanics = this.loadedConfig?.mechanics || {};

        this.lives = this.mechanics.initialLives || 3;
        this.initialLives = this.lives; // lock the "max" for x/x
        this.score = 0;
        this.hasEnded = false;
        this.isGameStarted = false; // Ensure How to Play screen shows
        this.stoneSpawnTimer = 0;
        this.spawnInterval = this.mechanics.spawnInterval || 2000;
        this.scoreTarget = this.mechanics.scoreTarget || 200;
        this.invincibilityTime = this.mechanics.invincibilityTime || 2000;

        this.input.removeAllListeners(); // ensure a clean input slate on fresh create
        this.events.once('shutdown', this.onShutdown, this);
        this.events.once('destroy', this.onShutdown, this);

        // Background
        this.add.image(960, 540, 'background').setOrigin(0.5);

        // BGM – stop old, then start only if key exists
        if (this.bgm && this.bgm.isPlaying) this.bgm.stop();

        // Try common keys so config can use "bg_music" or "bgm"
        let bgmKey = null;
        if (this.cache.audio.exists('bg_music')) {
            bgmKey = 'bg_music';
        } else if (this.cache.audio.exists('bgm')) {
            bgmKey = 'bgm';
        }

        if (bgmKey) {
            this.bgm = this.sound.add(bgmKey, { loop: true, volume: 1 });
            this.bgm.play();
        } else {
            console.warn('No BGM key (bg_music/bgm) found in audio cache, skipping BGM playback.');
            this.bgm = null;
        }


        // Ground (invisible, at y=1080)
        this.ground = this.physics.add.staticGroup();

        // Player (CANNON IMAGE, not spritesheet)
        this.cannon = this.physics.add.sprite(960, 970, 'cannon')
            .setDepth(5)
            .setScale(2)
            .setImmovable(true);
        this.cannon.setCollideWorldBounds(true);

        // Groups
        this.stones = this.physics.add.group({ collideWorldBounds: true });
        this.cannonShots = this.physics.add.group();

        // --- UI ---
        // Left box for Score/Target
        this.pointbox = this.add.image(250, 70, 'pointbox').setDepth(3);

        this.pointbox1 = this.add.image(950, 70, 'pointbox').setDepth(3);
        // Right box for Lives
        this.hpbox = this.add.image(1670, 70, 'hpbox').setDepth(3).setScale(1);

        // Score (top-left)
        this.scoreText = this.add.text(
            120, 35,
            `${this.texts.scoreLabel || 'Score'}: 0`,
            { font: '50px outfit', fill: 'black' }
        ).setDepth(4);

        // Target (under score)
        this.targetText = this.add.text(
            830, 35,
            `${this.texts.targetLabel || 'Target'}: ${this.scoreTarget}`,
            { font: '50px outfit', fill: 'black' }
        ).setDepth(4);

        // Lives numeric (top-right)
        this.livesText = this.add.text(
            1570, 35,
            `${this.texts.livesLabel || 'Live'}: ${this.lives}`,
            { font: '50px outfit', fill: 'black' }
        ).setDepth(4);

        // Collisions
        this.physics.add.collider(this.stones, this.ground, this.stoneHitsGround, null, this);
        this.physics.add.collider(this.cannon, this.stones, this.cannonHit, null, this);
        this.physics.add.overlap(this.cannonShots, this.stones, this.shotHitsStone, null, this);

        this.htpbg = this.add.image(960, 540, 'htpbg').setOrigin(0.5)
            .setDepth(9)
            .setDisplaySize(1920, 1080);
        // How to Play UI
        this.htpTextTitle = this.add.text(960, 380, this.texts.howToPlayTitle || 'How to Play', {
            font: 'bold 70px outfit',
            fill: '#ffffff'
        }).setOrigin(0.5).setDepth(11);

        this.htpTextInstructions = this.add.text(580, 500,
            this.texts.howToPlayInstructions || '',
            {
                font: '50px outfit',
                fill: '#ffffff',
                lineSpacing: 10
            }).setOrigin(0.5).setDepth(11);

        this.htpTextInstructions1 = this.add.text(630, 680,
            'Avoid and hit:',
            {
                font: '50px outfit',
                fill: '#ffffff',
                lineSpacing: 10
            }).setOrigin(0.5).setDepth(11);

        this.img = this.add.image(760, 510, 'cannon').setDepth(11).setScale(1.5)
        this.img1 = this.add.image(880, 660, 'stone').setDepth(11).setScale(0.3)

        this.htpBox = this.add.image(960, 540, 'htpbox').setOrigin(0.5).setDepth(10).setScale(0.55, 0.6);
        this.playButton = this.add.image(960, 880, 'playbtn')
            .setOrigin(0.5)
            .setInteractive()
            .setDepth(10)
            .on('pointerdown', () => this.startGame());

        this.physics.pause(); // Pause physics until game starts
        if (!this.loadedConfig) {
            console.warn('Config not available on create(). Restart preload manually if needed.');
            return;
        }
    }

    loadConfig() {
        const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));
        this.load.json('levelConfig', `${basePath}/config.json`);

        this.load.once('filecomplete-json-levelConfig', () => {
            this.loadedConfig = this.cache.json.get('levelConfig') || {};
            const cfg = this.loadedConfig;

            this.texts = cfg.texts || {};
            this.mechanics = cfg.mechanics || {};
            this.spawnInterval = this.mechanics.spawnInterval || 2000;
            this.fireDelay = this.mechanics.fireDelay || 500;
            this.scoreTarget = this.mechanics.scoreTarget || 200;
            this.invincibilityTime = this.mechanics.invincibilityTime || 2000;

            // IMAGES: bulk-load images1/images2/ui
            let cannonLoadedFromMap = false;

            if (cfg.images1) {
                Object.entries(cfg.images1).forEach(([key, url]) => {
                    if (key === 'cannon') cannonLoadedFromMap = true;
                    this.load.image(key, `${basePath}/${url}`).on('error', () => console.error(`Failed to load image: ${key}`));
                });
            }

            if (cfg.images2) {
                Object.entries(cfg.images2).forEach(([key, url]) => {
                    if (key === 'cannon') cannonLoadedFromMap = true;
                    this.load.image(key, `${basePath}/${url}`).on('error', () => console.error(`Failed to load image: ${key}`));
                });
            }

            if (cfg.ui) {
                Object.entries(cfg.ui).forEach(([key, url]) => {
                    if (key === 'cannon') cannonLoadedFromMap = true;
                    this.load.image(key, `${basePath}/${url}`).on('error', () => console.error(`Failed to load image: ${key}`));
                });
            }

            // Ensure 'cannon' exists even if not in JSON maps (fallback to assets/cannon.png)
            if (!cannonLoadedFromMap) {
                this.load.image('cannon', `${basePath}/assets/cannon.png`)
                    .on('error', () => console.error('Failed to load fallback cannon image at assets/cannon.png'));
            }

            // AUDIO
            // AUDIO – support both local paths and full URLs
            if (cfg.audio) {
                for (const [key, url] of Object.entries(cfg.audio)) {
                    const audioUrl =
                        /^https?:\/\//i.test(url) || url.startsWith('//')
                            ? url                   // full URL -> use as-is
                            : `${basePath}/${url}`; // relative -> prefix with basePath

                    this.load.audio(key, audioUrl).on('error', () => {
                        console.error(`Failed to load audio: ${key} from ${audioUrl}`);
                    });
                }
            }


            this.load.start();
        });
    }

    startGame() {
        // destroy How-To-Play UI
        this.htpBox?.destroy();
        this.playButton?.destroy();
        this.img?.destroy();
        this.img1?.destroy();
        this.htpbg?.destroy();
        this.htpTextTitle?.destroy();
        this.htpTextInstructions?.destroy();
        this.htpTextInstructions1?.destroy();

        // —— RESET CORE STATE ——
        this.score = 0;
        this.lives = this.mechanics.initialLives || 3;
        this.initialLives = this.lives;
        this.invincibilityTimer = 0;
        this.hasEnded = false;
        this.isGameStarted = true;

        this.isPaused = false;                 // ensure not paused for this run
        this.stoneSpawnTimer = 0;              // reset spawner accumulator
        this.spawnInterval = this.mechanics.spawnInterval || 2000;

        // refresh UI values
        this.scoreText.setText(`${this.texts.scoreLabel || 'Score'}: 0`);
        this.targetText.setText(`${this.texts.targetLabel || 'Target'}: ${this.scoreTarget}`);
        this.livesText.setText(`${this.texts.livesLabel || 'Live'}: ${this.lives}`);

        // stop any old BGM, start fresh


        // pointer‐move → cannon
        this.input.removeAllListeners('pointermove');
        this.input.on('pointermove', pointer => {
            this.cannon.x = Phaser.Math.Clamp(pointer.x, 50, 1870);
        });

        // kick off your firing loop
        const delay = (this.fireDelay > 0) ? this.fireDelay : 500;
        if (this.fireEvent) { this.fireEvent.remove(false); }
        this.fireEvent = this.time.addEvent({
            delay,
            callback: this.fireCannon,
            callbackScope: this,
            loop: true
        });

        // finally resume physics
        this.physics.resume();
    }

    update(time, delta) {
        if (!this.isGameStarted || this.hasEnded) return;

        this.stoneSpawnTimer += delta;
        if (this.stoneSpawnTimer >= this.spawnInterval && !this.isPaused) {
            this.spawnStone();
            this.stoneSpawnTimer = 0;

            if (this.spawnInterval > 1000) {
                this.spawnInterval -= 20;
            }
        }

        if (this.invincibilityTimer > 0) {
            this.invincibilityTimer -= delta;
            this.cannon.setAlpha(this.invincibilityTimer % 200 < 100 ? 0.5 : 1);
        } else {
            this.cannon.setAlpha(1);
        }

        this.cannonShots.getChildren().forEach(shot => {
            if (shot.y < 0) shot.destroy();
        });
        this.stones.getChildren().forEach(stone => {
            const text = stone.getData('text');
            if (text && text.active && stone.active) {
                text.setPosition(stone.x, stone.y);
            }
        });

    }

    spawnStone() {
        const x = Phaser.Math.Between(50, 1870);
        const hits = Phaser.Math.Between(1, 8);
        const stone = this.stones.create(x, 0, 'stone').setScale(0.3).setDepth(1);

        stone.setBounce(1);
        stone.setCollideWorldBounds(true);
        stone.setVelocity(Phaser.Math.Between(-100, 100), 300);
        stone.body.setAllowGravity(false);

        stone.setData('hits', hits);
        const text = this.add.text(x, 0, hits, { font: 'bold 30px outfit', fill: '#fff' }).setDepth(6);
        text.setData('parent', stone);
        stone.setData('text', text);
    }

    stoneHitsGround(stone, ground) {
        this.sound.play('stone_ground');
        stone.setVelocityY(-300);
    }

    _stopAllSfxKeepBgm() {
        const all = this.sound.sounds || [];
        for (const s of all) {
            if (this.bgm && s === this.bgm) continue; // keep bgm
            try { s.stop(); } catch (e) { }
        }
    }

    shotHitsStone(shot, stone) {
        shot.destroy();
        this.sound.play('stone_hit');
        const hits = stone.getData('hits') - 1;
        stone.setData('hits', hits);
        const text = stone.getData('text');

        if (text) text.setText(hits);
        if (hits <= 0) {
            if (text) text.destroy();
            stone.destroy();
            this.score += 10;
            this.scoreText.setText(`${this.texts.scoreLabel || 'Score'}: ${this.score}`);
            this.sound.play('explosion');
            if (this.sys?.cameras?.main) {
                this.sys.cameras.main.shake(100, 0.01);
            }


            if (this.score >= this.scoreTarget && !this.hasEnded) {
                this.hasEnded = true;
                this.winGame();
            }
        }
    }

    winGame() {
        if (this.bgm) this.bgm.setVolume(0.7);
        // this._stopAllSfxKeepBgm();

        this.isPaused = true;         // so fireCannon early-returns
        if (this.fireEvent) {         // remove the repeating timer
            this.fireEvent.remove(false);
            this.fireEvent = null;
        }
        this.input.removeAllListeners();  // no more pointer events
        this._stopSoundByKey('shoot');    // force-stop any active shoot sounds
        this._stopAllSfxKeepBgm();        // keep BGM only (already in your code)


        // Full background first
        const winbg = this.add.image(960, 540, 'winbg')
            .setOrigin(0.5)
            .setDepth(9)
            .setDisplaySize(1920, 1080);

        // Overlay dim layer (optional)
        const overlay = this.add.rectangle(960, 540, 1920, 1080, 0x000000, 0.4).setDepth(10);

        // Foreground box
        const lvlbox = this.add.image(960, 500, 'lvlbox')
            .setScale(0.55, 0.6)
            .setOrigin(0.5)
            .setDepth(11);

        const lvltxt = this.add.text(680, 460, this.texts.levelComplete || 'Level Completed!', {
            fontSize: 'bold 70px',
            fontFamily: 'outfit',
            color: '#ffffff'
        }).setDepth(12);

        const nextbtn = this.add.image(1200, 870, 'nextbtn')
            .setOrigin(0.5)
            .setInteractive()
            .setDepth(12);

        const winRestart = this.add.image(740, 870, 'restart')
            .setOrigin(0.5)
            .setInteractive()
            .setDepth(12);

        nextbtn.on('pointerdown', () => {
            [winbg, overlay, lvlbox, lvltxt, nextbtn, winRestart].forEach(o => o.destroy());
            this.notifyParent('sceneComplete', { result: 'win' });
        });

        winRestart.on('pointerdown', () => {
            if (this.bgm && this.bgm.isPlaying) this.bgm.stop();
            [winbg, overlay, lvlbox, lvltxt, nextbtn, winRestart].forEach(o => o.destroy());
            this.safeRestart();
        });
    }

    notifyParent(type, data) {
        if (window.parent !== window) {
            window.parent.postMessage({ type, ...data }, "*");
        }
    }

    cannonHit(cannon, obj) {
        if (this.invincibilityTimer <= 0 && !this.hasEnded) {
            this.lives--;
            this.invincibilityTimer = this.invincibilityTime;
            this.sound.play('stone_hit');

            // Update numeric lives text instead of destroying hearts
            if (this.livesText) {
                this.livesText.setText(`${this.texts.livesLabel || 'Live'}: ${this.lives}`);
            }

            if (this.lives <= 0) {
                this.hasEnded = true;
                // this.sound.stopAll();
                this.gameOver();
            }
        }
    }

    gameOver() {
        if (this.bgm) this.bgm.setVolume(0.8);
        // this._stopAllSfxKeepBgm();

        this.isPaused = true;         // so fireCannon early-returns
        if (this.fireEvent) {         // remove the repeating timer
            this.fireEvent.remove(false);
            this.fireEvent = null;
        }
        this.input.removeAllListeners();  // no more pointer events
        this._stopSoundByKey('shoot');    // force-stop any active shoot sounds
        this._stopAllSfxKeepBgm();        // keep BGM only (already in your code)


        this.physics.pause();

        // Full background
        const ovrbg = this.add.image(960, 540, 'ovrbg')
            .setOrigin(0.5)
            .setDepth(9)
            .setDisplaySize(1920, 1080);

        // Overlay layer
        const overlay = this.add.rectangle(960, 540, 1920, 1080, 0x000000, 0.4).setDepth(10);

        // Foreground box
        const gameovrbg = this.add.image(960, 440, 'gameovrbg')
            .setScale(0.55, 0.6)
            .setOrigin(0.5)
            .setDepth(11);

        const lvltxt = this.add.text(760, 240, this.texts.gameOver || 'Game Over', {
            fontSize: 'bold 70px',
            fontFamily: 'outfit',
            color: '#ffffff'
        }).setDepth(12);

        const scoretxt1 = this.add.text(820, 400, 'Score:', {
            fontSize: '70px',
            fontFamily: 'outfit',
            color: '#ffffff'
        }).setDepth(12);

        const scoretxt = this.add.text(1020, 400, `${this.score}`, {
            fontSize: '70px',
            fontFamily: 'outfit',
            color: '#ffffff'
        }).setDepth(12);

        const restart = this.add.image(960, 800, 'restart1')
            .setOrigin(0.5)
            .setInteractive()
            .setDepth(12);

        restart.on('pointerdown', () => {
            if (this.bgm && this.bgm.isPlaying) this.bgm.stop();
            [ovrbg, overlay, gameovrbg, lvltxt, scoretxt1, scoretxt, restart].forEach(o => o.destroy());
            this.safeRestart();
        });
    }

    _stopSoundByKey(key) {
        const list = this.sound?.sounds || [];
        for (const s of list) {
            if (s?.key === key && s.isPlaying) {
                try { s.stop(); } catch (e) { }
            }
        }
    }

    onShutdown() {
        // stop repeating fire timer
        if (this.fireEvent) {
            try { this.fireEvent.remove(false); } catch (e) { }
            this.fireEvent = null;
        }

        // remove any input listeners we attached
        try { this.input?.removeAllListeners(); } catch (e) { }

        // stop all SFX but don't explode if bgm is null
        this._stopSoundByKey('shoot');
        this._stopAllSfxKeepBgm();

        // clear physics groups & colliders
        try { this.cannonShots?.clear(true, true); } catch (e) { }
        try { this.stones?.clear(true, true); } catch (e) { }

        // resume alpha on cannon if we were mid-blink
        try { this.cannon?.setAlpha(1); } catch (e) { }

        // make sure physics is not left paused for the next run
        try { this.physics?.resume(); } catch (e) { }

        // cancel any tweens/time events just in case
        try { this.tweens?.killAll(); } catch (e) { }
        // try { this.time?.removeAllEvents(); } catch (e) { }
    }

    safeRestart() {
        // soft cleanup in case shutdown doesn’t fire (it will, but belts+suspenders)
        this.onShutdown();
        // stop BGM so a fresh one starts cleanly in create()
        try { if (this.bgm?.isPlaying) this.bgm.stop(); } catch (e) { }
        this.scene.restart(); // will re-run init -> create (preload is skipped, which is fine)
    }


    fireCannon() {
        if (this.hasEnded || this.isPaused) return; // <-- guard
        const shot = this.cannonShots.create(this.cannon.x, this.cannon.y - 50, 'bomb').setScale(0.1);
        shot.setVelocityY(-1600);
        this.sound.play('shoot');
    }

    togglePause() {
        this.isPaused = !this.isPaused;
        this.physics.world.isPaused = this.isPaused;
        if (this.isPaused) {
            this.add.text(960, 540, this.texts.pausedResume || 'Paused\nResume', {
                font: '48px Arial',
                fill: '#fff',
                align: 'center'
            }).setOrigin(0.5).setInteractive().on('pointerdown', () => this.togglePause());
        } else {
            this.children.list.forEach(child => {
                if (child.text === 'Paused\nResume') child.destroy();
            });
        }
    }
}
