export default class GameScene extends Phaser.Scene {
    constructor() {
        super('GameScene');
        Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach(fn => {
            if (typeof this[fn] === 'function') {
                this[fn] = this[fn].bind(this);
            }
        });
    }
    init() {
        // runtime state reset
        // this.hp = 0;                      // ← no longer used (safe to delete)
        this.lives = 0;                      // NEW
        this.score = 0;
        this.fishEaten = 0;
        this.timeLeft = 0;
        this.targetFishCount = 0;
        this.eating = false;
        this.lastPointerX = 960;
        this.targetPointer = { x: 960, y: 540 };

        // refs you create later
        this.shark = null;
        this.fishes = null;
        this.drums = null;
        this.bubbles = null;
        this.ground = null;
        this.timerText = null;
        this.fishCountText = null;

        // this.hpImage = null;              // ← remove this line
        this.livesText = null;               // NEW
        this.background = null;
        this.bgm = null;
    }


    onShutdown() {
        // stop audio
        this.sound?.stopAll();

        // timers/tweens/colliders
        this.time?.removeAllEvents();
        this.tweens?.killAll();
        if (this.physics?.world?.colliders) this.physics.world.colliders.destroy();

        // input listeners
        if (this.input) {
            this.input.removeAllListeners();
            this.input.keyboard?.removeAllListeners?.();
        }
    }

    // --- LABEL HELPERS (pull from config.json) ---
    _getCfg() { return this.cache?.json?.get('levelConfig') || {}; }
    _getLabels() { const cfg = this._getCfg(); return (cfg.labels || {}); }

    /** Return labels[key] or fallback if missing */
    _t(key, fallback = '') {
        const L = this._getLabels();
        return (L[key] ?? fallback);
    }

    /** Very small {var} template helper */
    _fmt(template, vars = {}) {
        if (!template || typeof template !== 'string') return template;
        return template.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`));
    }

    /** Optionally read text style from cfg.textStyles[key], else return default */
    _textStyle(key, defaultStyle) {
        const styles = (this._getCfg().textStyles || {});
        return Object.assign({}, defaultStyle, styles[key] || {});
    }



    preload() {
        const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));

        // ✅ helper: keep absolute URLs as-is, prefix relative ones with basePath
        const resolveUrl = (u) => {
            if (!u) return u;
            if (/^(https?:)?\/\//i.test(u) || /^data:/i.test(u)) return u; // absolute or data URI
            return `${basePath}/${u}`; // relative
        };

        this.load.json('levelConfig', `${basePath}/config.json`);
        this.load.once('filecomplete-json-levelConfig', () => {
            const cfg = this.cache.json.get('levelConfig');

            // --- Player image
            const imgFromConfig = (cfg.images1 && cfg.images1.player) ? resolveUrl(cfg.images1.player) : null;
            const playerUrl = imgFromConfig || `${basePath}/assets/player.png`;
            this.load.image('shark', playerUrl);

            // --- images1
            if (cfg.images1) {
                Object.entries(cfg.images1).forEach(([key, url]) => {
                    this.load.image(key, resolveUrl(url)).on('error', () => console.error(`Failed to load image: ${key}`));
                });
            }
            // --- images2
            if (cfg.images2) {
                Object.entries(cfg.images2).forEach(([key, url]) => {
                    this.load.image(key, resolveUrl(url)).on('error', () => console.error(`Failed to load image: ${key}`));
                });
            }
            // --- ui
            if (cfg.ui) {
                Object.entries(cfg.ui).forEach(([key, url]) => {
                    this.load.image(key, resolveUrl(url)).on('error', () => console.error(`Failed to load image: ${key}`));
                });
            }
            // --- audio  ✅ resolves absolute BGM URL correctly
            if (cfg.audio) {
                Object.entries(cfg.audio).forEach(([key, url]) => {
                    this.load.audio(key, resolveUrl(url)).on('error', () => console.error(`Failed to load audio: ${key}`));
                });
            }

            this.load.start();
        });
    }


    lastPointerX = 960; // default center

    create() {
        this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);
        const cfg = this.cache.json.get('levelConfig');
        const mechanics = cfg.mechanics || {};

        if (cfg.orientation && screen.orientation.lock) {
            screen.orientation
                .lock('landscape-primary')
                .catch(err => console.warn('Orientation lock failed:', err));
        }

        this.targetPointer = { x: 960, y: 540 }; // Default pointer to center of screen


        this.physics.pause();

        this.bgm = this.sound.add('bgm', { loop: true, volume: 1 });
        this.bgm.play();

        this.htpBox = this.add.image(960, 450, 'htpbox')
            .setOrigin(0.5)
            .setScale(0.8, 1)
            .setDepth(11);

        // Create Play button
        this.playBtn = this.add.image(960, 860, 'playbtn')
            .setOrigin(0.5)
            .setInteractive()
            .setDepth(11);

        this.htptxt = this.add.text(700, 310, '', {
            fontSize: 'bold 70px',
            fontFamily: 'outfit',
            backgroundColor: '#0D0D0D',
            color: '#ffffff'
        }).setDepth(12);
        // -- Build rich "How to Play" line: Control [player.png] eat [object1..7]
        // Center of your HTP box (adjust if your htpbox art has a different usable area)
        const HTP_CX = 960;
        const HTP_TOP = 320;   // top baseline inside the htpbox where you want to start stacking

        // Pick player key (fallback to 'shark' if 'player' not present)
        const playerKey = this.textures.exists('player')
            ? 'player'
            : (this.textures.exists('shark') ? 'shark' : null);

        // --- MANUAL positions ---
        // Feel free to tweak these numbers exactly how you want.
        const items = [
            { type: 'text', text: this._t('howToPlayTitle', 'How to Play'), x: HTP_CX, y: HTP_TOP - 200 },
            { type: 'text', text: this._t('controlLabel', 'Control:'), x: HTP_CX - 440, y: HTP_TOP - 70 },

            ...(playerKey ? [{ type: 'image', key: playerKey, x: HTP_CX - 100, y: HTP_TOP - 70, scale: 0.4 }] : []),

            { type: 'text', text: this._t('collectLabel', 'Collect:'), x: HTP_CX - 450, y: HTP_TOP + 100 },

            { type: 'image', key: 'object1', x: HTP_CX - 270, y: HTP_TOP + 100, scale: 0.24 },
            { type: 'image', key: 'object2', x: HTP_CX - 120, y: HTP_TOP + 100, scale: 0.24 },
            { type: 'image', key: 'object4', x: HTP_CX + 30, y: HTP_TOP + 100, scale: 0.24 },

            { type: 'image', key: 'object5', x: HTP_CX + 180, y: HTP_TOP + 100, scale: 0.24 },
            { type: 'image', key: 'object6', x: HTP_CX + 350, y: HTP_TOP + 100, scale: 0.24 },
            { type: 'image', key: 'object7', x: HTP_CX + 500, y: HTP_TOP + 100, scale: 0.24 },

            { type: 'text', text: this._t('avoidLabel', 'Avoid:'), x: HTP_CX - 470, y: HTP_TOP + 270 },
            { type: 'image', key: 'obstacle', x: HTP_CX - 180, y: HTP_TOP + 270, scale: 0.24 },
            { type: 'image', key: 'chemical_drum', x: HTP_CX + 0, y: HTP_TOP + 270, scale: 0.3 }
        ];


        this.htpRichRow = this._buildHTPCustomLayout({
            depth: 12,
            defaultTextStyle: this._textStyle('htpHeading', { fontSize: '70px', fontFamily: 'outfit', color: '#ffffff' }),
            items
        });




        // Handle Play button click
        this.playBtn.on('pointerdown', () => {
            // Attempt to go fullscreen

            // Destroy HTP elements
            // this.overlay.destroy();
            this.htpBox.destroy();
            this.htptxt.destroy();
            // this.htptxt1.destroy();
            this.playBtn.destroy();
            this.htpRichRow?.destroy();

            // Start the game
            this.startgame();

            // this.bgm = this.sound.add('bgm', { loop: true, volume: 1 });
            // this.bgm.play();


            // Resume physics
            this.physics.resume();
        });

        this.background = this.add.tileSprite(0, 0, 1920, 1080, 'background').setOrigin(0, 0);
        this.background.setScrollFactor(0.5);

        // --- FX bootstrap: a tiny circle texture for particles ---
        const g = this.make.graphics({ x: 0, y: 0, add: false });
        g.fillStyle(0xffffff, 1);
        g.fillCircle(8, 8, 8);
        g.generateTexture('fxCircle', 16, 16);
        g.destroy();

        // === EXTRA FX TEXTURES ===
        (() => {
            // star shard
            if (!this.textures.exists('__fxStar')) {
                const g = this.make.graphics({ x: 0, y: 0, add: false });
                g.fillStyle(0xffffff, 1);
                g.beginPath();
                g.moveTo(12, 0);
                g.lineTo(16, 10);
                g.lineTo(28, 12);
                g.lineTo(16, 16);
                g.lineTo(12, 28);
                g.lineTo(8, 16);
                g.lineTo(0, 12);
                g.lineTo(8, 10);
                g.closePath();
                g.fillPath();
                g.generateTexture('__fxStar', 28, 28);
                g.destroy();
            }

            // shockwave ring
            if (!this.textures.exists('__fxRing')) {
                const g = this.make.graphics({ x: 0, y: 0, add: false });
                g.lineStyle(6, 0xffffff, 1);
                g.strokeCircle(64, 64, 48);
                g.generateTexture('__fxRing', 128, 128);
                g.destroy();
            }

            // streak (for speed lines)
            if (!this.textures.exists('__fxStreak')) {
                const g = this.make.graphics({ x: 0, y: 0, add: false });
                g.fillStyle(0xffffff, 1);
                g.fillRoundedRect(0, 0, 60, 10, 5);
                g.generateTexture('__fxStreak', 60, 10);
                g.destroy();
            }
        })();

        // === PARTICLE MANAGERS ===
        // 1) Meat/bits burst
        this.eatBurst = this.add.particles(0, 0, 'fxCircle', {
            quantity: 0,
            lifespan: { min: 320, max: 650 },
            speed: { min: 120, max: 300 },
            angle: { min: 0, max: 360 },
            gravityY: 250,
            scale: { start: 0.9, end: 0 },
            alpha: { start: 1, end: 0 },
            blendMode: 'ADD'
        });

        // 2) Sparkle shards
        this.eatSparkles = this.add.particles(0, 0, '__fxStar', {
            quantity: 0,
            lifespan: { min: 450, max: 900 },
            speed: { min: 80, max: 180 },
            angle: { min: 0, max: 360 },
            rotate: { min: -180, max: 180 },
            gravityY: 120,
            scale: { start: 0.8, end: 0 },
            alpha: { start: 0.95, end: 0 },
            blendMode: 'ADD'
        });

        // 3) Speed lines
        this.eatStreaks = this.add.particles(0, 0, '__fxStreak', {
            quantity: 0,
            lifespan: { min: 220, max: 400 },
            speed: { min: 260, max: 420 },
            angle: { min: 0, max: 360 },
            gravityY: 0,
            scale: { start: 1, end: 0 },
            alpha: { start: 0.9, end: 0 },
            blendMode: 'ADD'
        });



        // Eat burst emitter
        this.eatEmitter = this.add.particles(0, 0, 'fxCircle', {
            speed: { min: 100, max: 260 },
            angle: { min: 0, max: 360 },
            gravityY: 50,
            lifespan: 500,
            quantity: 0,                // we'll trigger bursts manually
            scale: { start: 0.7, end: 0 },
            alpha: { start: 1, end: 0 },
            tint: [0x7dd3fc, 0x60a5fa, 0xfde68a, 0xfca5a5]
        });

        // Drum landing “poof” emitter
        this.poofEmitter = this.add.particles(0, 0, 'fxCircle', {
            speed: { min: 20, max: 80 },
            angle: { min: 0, max: 360 },
            lifespan: 600,
            quantity: 0,
            scale: { start: 0.6, end: 0 },
            alpha: { start: 0.5, end: 0 }
        });

        // Soft trail behind the shark
        this.trailEmitter = this.add.particles(0, 0, 'fxCircle', {
            follow: null,             // set in startgame() once shark exists
            frequency: 45,
            lifespan: 300,
            speed: 0,
            quantity: 1,
            scale: { start: 0.25, end: 0 },
            alpha: { start: 0.25, end: 0 }
        });


        // Overlays (topmost z)
        this.hitOverlay = this.add.rectangle(960, 540, 1920, 1080, 0xff0000, 0).setDepth(19);
        this.lowHpOverlay = this.add.rectangle(960, 540, 1920, 1080, 0xff0000, 0).setDepth(18);

        // Flags/tween refs for low-HP loop
        this.lowHpActive = false;
        this.lowHpTween = null;
        this.hpPulse = null;



    }

    /**
 * Build a manual "How to Play" layout.
 * Pass exact x,y for each item. Items can be {type:'text', text:'...', x,y}
 * or {type:'image', key:'player|object1..7', x,y, scale?:number}.
 * Returns a Phaser Container you can destroy later.
 */
    _buildHTPCustomLayout({ depth = 12, defaultTextStyle, items = [] } = {}) {
        const row = this.add.container(0, 0).setDepth(depth);

        const textStyle = defaultTextStyle || { fontSize: '70px', fontFamily: 'outfit', color: '#ffffff', align: 'center' };

        items.forEach(item => {
            if (item.type === 'text') {
                const t = this.add.text(item.x, item.y, item.text ?? '', textStyle).setOrigin(0.5);
                row.add(t);
            } else if (item.type === 'image') {
                if (!this.textures.exists(item.key)) return; // skip missing textures safely
                const s = item.scale != null ? item.scale : 0.25;
                const img = this.add.image(item.x, item.y, item.key).setOrigin(0.5).setScale(s);
                row.add(img);
            }
        });

        return row;
    }


    hardRestart() {
        // stop audio
        this.sound.stopAll();

        // clear timers/tweens/colliders safely
        if (this.time) this.time.removeAllEvents();
        if (this.tweens) this.tweens.killAll();
        if (this.physics && this.physics.world) {
            this.physics.world.colliders.destroy(); // remove all colliders
        }

        // remove input listeners
        if (this.input) {
            this.input.removeAllListeners();
            this.input.keyboard?.removeAllListeners?.();
        }

        // finally restart scene fresh
        this.scene.stop();
        this.scene.start('GameScene');
    }


    startgame() {

        const cfg = this.cache.json.get('levelConfig');
        const mechanics = cfg.mechanics || {};




        // --- PLAYER (shark) setup ---
        this.shark = this.physics.add.sprite(960, 540, 'shark')
            .setScale(10)      // 👈 adjust the visible size here (e.g. 0.5, 0.7, 1.2)
            .setDepth(10);

        // Always call this after scaling to ensure the physics body matches
        this.shark.body.setSize(this.shark.width * 0.6, this.shark.height * 0.6);
        this.shark.body.setOffset(
            (this.shark.displayWidth - this.shark.body.width) / 2,
            (this.shark.displayHeight - this.shark.body.height) / 2
        );

        this.startSharkPulse();

        this.shark.setAngle(0);
        // this.shark.body.setOffset(-10, 30);
        this.shark.body.setSize(200, 250);
        this.shark.setCollideWorldBounds(true);
        this.shark.body.allowGravity = false;
        this.shark.body.setVelocity(0, 0);

        // --- Auto-mirroring hitbox offset (flip-aware + scale-aware) ---
        this._hitboxY = this.shark.body.offset.y || 30;   // keep your current Y
        this._hitboxXBase = -10; // tune: desired X when flipX = false (your "facing left")

        this._getMirroredOffsetX = () => {
            // displayWidth changes with scale; body.width is physics box width
            return (this.shark.displayWidth - this.shark.body.width - this._hitboxXBase);
        };

        this._applyHitboxOffset = () => {
            if (!this.shark?.body) return;
            const ox = this.shark.flipX ? this._getMirroredOffsetX() : this._hitboxXBase;
            this.shark.body.setOffset(ox, this._hitboxY);
        };

        // Attach the trail to the shark now that it exists
        if (this.trailEmitter) {
            this.trailEmitter.setConfig({ follow: this.shark });
        }


        // initial apply
        this._applyHitboxOffset();




        this.targetPointer = { x: this.shark.x, y: this.shark.y };

        this.input.on('pointermove', (pointer) => {
            this.targetPointer.x = Phaser.Math.Clamp(pointer.x, 0, 1920);
            this.targetPointer.y = Phaser.Math.Clamp(pointer.y, 0, 1080);

            const dx = pointer.x - this.lastPointerX;
            if (dx > 1) {
                this.shark.flipX = true;   // facing right
            } else if (dx < -1) {
                this.shark.flipX = false;    // facing left
            }
            this._applyHitboxOffset();

            this.shark.setAngle(0);       // ensure no rotation is applied
            this.lastPointerX = pointer.x;
        });


        // Fish group
        this.fishes = this.physics.add.group();
        this.time.addEvent({ delay: 1200, callback: this.spawnFish, callbackScope: this, loop: true });

        // Drums, bubbles, ground
        this.drums = this.physics.add.group();
        this.bubbles = this.physics.add.group();
        this.time.addEvent({ delay: 4000, callback: this.spawnDrum, callbackScope: this, loop: true });

        this.ground = this.physics.add.staticImage(960, 1080, null)
            .setDisplaySize(1920, 160) // Increased height to make landing reliable
            .setVisible(false);

        // Colliders
        this.fishOverlap = this.physics.add.overlap(this.shark, this.fishes, this.eatFish, undefined, this);

        this.bubbleCollider = this.physics.add.collider(this.shark, this.bubbles, this.hitBubble, null, this);
        this.physics.add.collider(this.drums, this.ground, this.landDrum, null, this);
        this.physics.add.collider(this.shark, this.drums, this.hitDrum, this.drumStillFalling, this);

        this.add.image(200, 70, 'hpbox').setScale(1)
        this.lives = (mechanics.lives ?? 5);   // default 5 lives
        this.livesText = this.add.text(
            100, 40,
            this._fmt(this._t('livesTemplate', 'Lives: {lives}'), { lives: this.lives }),
            this._textStyle('uiNumbers', { font: 'bold 48px outfit', fill: '#000000' })
        ).setScrollFactor(0).setOrigin(0, 0);




        this.add.image(1700, 70, 'pointbox').setScale(1.3, 1)

        this.add.image(960, 70, 'timebox').setScale(1.3, 1)
        // this.healthBar = this.add.text(40, 20, 'HP: 45', { font: '50px outfit', fill: 'black' }).setScrollFactor(0).setOrigin(0, 0);
        // this.timerText = this.add.text(1835, 20, '90', { font: '50px outfit', fill: 'black' }).setScrollFactor(0).setOrigin(0, 0);
        // Variables - load from mechanics
        // this.hp = mechanics.initialHP || 45;
        this.score = 0;
        this.fishEaten = 0;
        this.timeLeft = mechanics.gameTime || 90;
        this.eating = false;
        this.targetFishCount = mechanics.targetFishCount || 10;


        const initMinutes = Math.floor(this.timeLeft / 60);
        const initSeconds = this.timeLeft % 60;
        const initFormatted = `${initMinutes.toString().padStart(2, '0')}:${initSeconds.toString().padStart(2, '0')}`;

        this.timerText = this.add.text(
            960, 40,
            initFormatted,
            this._textStyle('uiNumbers', { font: 'bold 50px outfit', fill: '#000000' })
        ).setScrollFactor(0).setOrigin(0, 0);


        this.add.text(
            800, 35,
            this._t('timeLabel', 'Time:'),
            this._textStyle('uiNumbers', { font: 'bold 50px outfit', fill: '#000000' })
        ).setScrollFactor(0).setOrigin(0, 0);


        // this.scoreText = this.add.text(400, 20, 'Score: 0', { font: '50px outfit', fill: 'black' }).setScrollFactor(0).setOrigin(0, 0);
        this.fishCountText = this.add.text(
            1550, 35,
            this._fmt(this._t('pointsTemplate', 'Points: {got}/{target}'), {
                got: 0, target: this.targetFishCount
            }),
            this._textStyle('uiNumbers', { font: 'bold 50px outfit', fill: '#000000' })
        ).setScrollFactor(0).setOrigin(0, 0);


        // // Variables - load from mechanics
        // this.hp = mechanics.initialHP || 45;
        // this.score = 0;
        // this.fishEaten = 0;
        // this.timeLeft = mechanics.gameTime || 90;
        // this.eating = false;
        // this.targetFishCount = mechanics.targetFishCount || 50;



        // Timer
        this.time.addEvent({ delay: 1000, callback: this.updateTimer, callbackScope: this, loop: true });

    }

    drumStillFalling(shark, drum) {
        return !drum.getData('hasLanded');
    }


    update() {
        if (!this.shark || !this.targetPointer) return;

        this.background.tilePositionX += 1;

        const speed = 0.06;
        this.shark.x = Phaser.Math.Interpolation.Linear([this.shark.x, this.targetPointer.x], speed);
        this.shark.y = Phaser.Math.Interpolation.Linear([this.shark.y, this.targetPointer.y], speed);

        if (this.fishes) {
            this.fishes.getChildren().forEach(fish => {
                if (fish.active) {
                    const baseY = fish.getData('baseY') || 400;
                    const phase = fish.getData('phase') || 0;
                    fish.y = baseY + Math.sin(this.time.now / 600 + phase + fish.x / 80) * 30;
                    if (fish.x > 2000) fish.destroy();
                }
            });
        }

        if (this.drums) {
            this.drums.getChildren().forEach(drum => {
                if (drum.y > 1100 && !drum.getData('hasLanded')) {
                    this.landDrum(drum, this.ground);
                }
            });
        }
    }


    _buildHTPRichRow(opts) {
        const {
            centerX = 960,       // Center horizontally (1920/2)
            startY = 400,        // Starting Y position
            depth = 12,
            textStyle = { fontSize: '70px', fontFamily: 'outfit', color: '#ffffff' },
            imageScale = 0.25,   // Scale for all images
            lineSpacing = 100,   // Vertical distance between lines
            fishSpacing = 120,   // Horizontal gap between fish
        } = opts || {};

        const row = this.add.container(0, 0).setDepth(depth);
        const addCenteredText = (txt, y) => {
            const t = this.add.text(centerX, y, txt, textStyle).setOrigin(0.5);
            row.add(t);
            return t;
        };

        const addCenteredImage = (key, y, scale = imageScale) => {
            if (!this.textures.exists(key)) return null;
            const img = this.add.image(centerX, y, key).setOrigin(0.5).setScale(scale);
            row.add(img);
            return img;
        };

        const addFishRow = (keys, y) => {
            const visible = keys.filter(k => this.textures.exists(k));
            if (visible.length === 0) return;

            const totalWidth = (visible.length - 1) * fishSpacing;
            let startX = centerX - totalWidth / 2;
            visible.forEach(k => {
                const img = this.add.image(startX, y, k).setOrigin(0.5).setScale(imageScale);
                row.add(img);
                startX += fishSpacing;
            });
        };

        // Build structure
        let currentY = startY;

        addCenteredText('Control', currentY); currentY += lineSpacing;
        const playerKey = this.textures.exists('player')
            ? 'player'
            : (this.textures.exists('shark') ? 'shark' : null);
        if (playerKey) addCenteredImage(playerKey, currentY, imageScale + 0.05);

        currentY += lineSpacing;
        addCenteredText('Eat', currentY); currentY += lineSpacing;

        addFishRow(['object1', 'object2', 'object4'], currentY);
        currentY += lineSpacing;
        addFishRow(['object5', 'object6', 'object7'], currentY);

        return row;
    }

    spawnFish() {
        const spawnLeft = Phaser.Math.Between(0, 1) === 0;
        const y = Phaser.Math.Between(100, 1000);
        const cfg = this.cache.json.get('levelConfig');
        const mechanics = cfg.mechanics || {};

        let fish, velocity, baseX;
        if (spawnLeft) {
            baseX = -50;
            velocity = mechanics.fishSpeed || 80;
        } else {
            baseX = 1970;
            velocity = -(mechanics.fishSpeed || 200);
        }

        fish = this.fishes.create(baseX, y, `object${Phaser.Math.Between(1, 7)}`);
        fish.setVelocityX(velocity);
        fish.setScale(0.45);
        fish.body.allowGravity = false;

        fish.setData('baseY', y);
        fish.setData('phase', Phaser.Math.FloatBetween(0, Math.PI * 2));
        fish.setData('spawnLeft', spawnLeft);
        fish.setData('originalVelocity', velocity);
        fish.setData('spawnX', baseX);

        fish.flipX = !spawnLeft;
    }

    spawnDrum() {
        const cfg = this.cache.json.get('levelConfig');
        const mechanics = cfg.mechanics || {};
        const drum = this.drums.create(Phaser.Math.Between(100, 1820), -40, 'chemical_drum');
        drum.setVelocityY(mechanics.drumSpeed || 800);
        drum.setScale(0.5);
        drum.body.allowGravity = false;
        drum.setData('hasLanded', false);
    }

    landDrum(drum, ground) {
        if (!drum.getData('hasLanded')) {
            drum.setData('hasLanded', true);
            if (drum.body) {
                drum.body.velocity.y = 0;
                drum.body.allowGravity = false;
                drum.body.immovable = true;
            }

            const bubble = this.bubbles.create(drum.x, drum.y - 40, 'obstacle').setScale(0.3);
            bubble.setVelocityY(-160);
            bubble.body.allowGravity = false;
            // Little dust/poof where the drum hits
            this.poofEmitter?.emitParticleAt(drum.x, drum.y, 20);
            this.time.delayedCall(500, () => drum.destroy(), [], this);
        }
    }


    eatFish(shark, fish) {
        // Guard against double-processing
        if (!fish.active || fish.getData('beingEaten')) return;
        fish.setData('beingEaten', true);

        // Stop the fish and disable its body immediately so further frames can't miss it
        fish.setVelocity(0);
        fish.disableBody(true, false); // hide from physics instantly (but keep GameObject for FX position)

        // SFX
        this.sound.play('eat');

        // FX (use fish.x/y before we destroy)
        const fxX = fish.x, fxY = fish.y;
        const tint = fish?.tintTopLeft ?? 0xffffff;
        this.playEatFX(fxX, fxY, tint);
        this.blinkShark();

        // Scoring / counters / UI
        this.score += 10;
        this.fishEaten += 1;
        this.fishCountText.setText(
            this._fmt(this._t('pointsTemplate', 'Points: {got}/{target}'), {
                got: this.fishEaten, target: this.targetFishCount
            })
        );

        // Clean up the fish object (destroy after a tick so FX can read coords safely)
        this.time.delayedCall(0, () => fish.destroy());

        // Win check
        if (this.fishEaten >= this.targetFishCount) {
            this.win();
        }
    }


    hitBubble(shark, bubble) {
        // Camera + hit flash (keep your nice feedback)
        this.cameras.main.shake(150, 0.005);
        this.cameras.main.flash(100, 255, 64, 64);

        this.tweens.add({
            targets: this.hitOverlay,
            alpha: { from: 0.35, to: 0 },
            duration: 200,
            ease: 'Quad.Out'
        });

        bubble.destroy();
        this.shark.setTint(0xff0000);
        this.time.delayedCall(400, () => this.shark.clearTint());

        this.bomb = this.sound.add('bomb', { loop: false, volume: 1 });
        this.bomb.play();


        // ↓↓↓ lives system
        this._loseALife();
    }


    /** Quick blink + pulse on the shark (no permanent size change). */
    blinkShark() {
        if (!this.shark) return;

        // reset to a known alpha in case previous tween left it mid-state
        this.shark.setAlpha(1);


        this.tweens.add({
            targets: this.shark,
            scaleX: this.shark.scaleX * 1.08,
            scaleY: this.shark.scaleY * 1.08,
            duration: 90,
            yoyo: true,
            ease: 'Back.Out(3)'
        });
    }

    /** Creates a continuous breathing / pulse effect on the shark. */
    startSharkPulse() {
        if (!this.shark) return;

        // Stop old tween if it exists
        if (this.sharkPulseTween) {
            this.sharkPulseTween.stop();
            this.sharkPulseTween = null;
        }


        this.sharkPulseTween = this.tweens.add({
            targets: this.shark,
            scale: { from: 0.6, to: 0.7 },
            duration: 900,
            yoyo: true,
            repeat: -1, // infinite loop
            ease: 'Sine.inOut'
        });
    }



    /** Fancy eat FX at (x,y) with optional tint. */
    playEatFX(x, y, tint = 0xFFFFFF) {
        // a) Micro hit-stop
        const oldScale = this.time.timeScale;
        this.time.timeScale = 0.25;
        this.time.delayedCall(60, () => (this.time.timeScale = oldScale));

        // b) Camera punch
        this.cameras.main.shake(90, 0.0025);

        // c) Particles
        const juicyPalette = [tint, 0x7dd3fc, 0x60a5fa, 0xfde68a, 0xfca5a5];
        this.eatBurst?.setConfig({ tint: juicyPalette });
        this.eatBurst?.emitParticleAt(x, y, Phaser.Math.Between(14, 22));

        this.eatSparkles?.setConfig({ tint: juicyPalette });
        this.eatSparkles?.emitParticleAt(x, y, Phaser.Math.Between(10, 16));

        this.eatStreaks?.setConfig({ tint: tint });
        this.eatStreaks?.emitParticleAt(x, y, Phaser.Math.Between(6, 10));

        // d) Shockwave ring
        const ring = this.add.image(x, y, '__fxRing')
            .setDepth(15)
            .setScale(0.25)
            .setAlpha(0.8)
            .setBlendMode(Phaser.BlendModes.ADD);

        this.tweens.add({
            targets: ring,
            scale: { from: 0.25, to: 1.6 },
            alpha: { from: 0.8, to: 0 },
            duration: 260,
            ease: 'Cubic.Out',
            onComplete: () => ring.destroy()
        });

        // e) Floating score text
        const txt = this.add.text(x, y - 10, '+10', {
            font: 'bold 56px outfit',
            fill: '#ffffff',
            stroke: '#000000',
            strokeThickness: 6
        }).setOrigin(0.5).setDepth(16);

        this.tweens.add({
            targets: txt,
            y: y - 90,
            alpha: { from: 1, to: 0 },
            scale: { from: 1, to: 1.4 },
            duration: 550,
            ease: 'Quad.Out',
            onComplete: () => txt.destroy()
        });

        // f) Shark squash & stretch
        if (this.shark) {
            this.tweens.add({
                targets: this.shark,
                scaleX: this.shark.scaleX * 0.92,
                scaleY: this.shark.scaleY * 1.08,
                duration: 70,
                yoyo: true,
                ease: 'Back.Out(2)'
            });
        }
    }

    _loseALife() {
        if (this.lives <= 0) return;       // already at zero, ignore extra hits
        this.lives -= 1;
        if (this.livesText) this.livesText.setText(`Lives: ${this.lives}`);

        // Optional: subtle low-life pulse when 1 life remains
        if (this.lives === 1) {
            this.tweens.add({
                targets: this.livesText,
                scale: { from: 1, to: 1.15 },
                duration: 280,
                yoyo: true,
                repeat: 5,
                ease: 'Sine.inOut'
            });
            this.tweens.add({
                targets: this.lowHpOverlay,
                alpha: { from: 0.0, to: 0.25 },
                duration: 600,
                yoyo: true,
                repeat: 6,
                ease: 'Sine.InOut'
            });
        }

        if (this.lives <= 0) {
            this.gameOver();
        }
    }


    updateTimer() {
        this.timeLeft--;

        const minutes = Math.floor(this.timeLeft / 60);
        const seconds = this.timeLeft % 60;
        const formattedTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

        this.timerText.setText(formattedTime);

        if (this.timeLeft <= 0) {
            if (this.fishEaten >= this.targetFishCount) this.win();
            else this.gameOver();
        }
    }


    win() {
        if (this.bgm) this.bgm.setVolume(0.2);

        // Stop warning FX
        this.lowHpTween?.stop(); this.lowHpTween = null;
        this.hpPulse?.stop(); this.hpPulse = null;
        if (this.lowHpOverlay) this.lowHpOverlay.alpha = 0;
        if (this.hitOverlay) this.hitOverlay.alpha = 0;

        // ✅ Pause physics on WIN
        this.physics.pause();

        // ✅ Win background image (full-screen)
        const winBG = this.add.image(960, 540, 'level_completed_background')
            .setOrigin(0.5)
            .setDepth(10)
            .setScrollFactor(0);
        winBG.setDisplaySize(1920, 1080);

        // Level complete UI
        const lvlbox = this.add.image(960, 500, 'lvlbox').setOrigin(0.5).setDepth(12);
        const lvltxt = this.add.text(
            680, 460,
            this._t('winText', 'Level Completed!'),
            this._textStyle('htpHeading', { fontSize: 'bold 70px', fontFamily: 'outfit', color: '#ffffff' })
        ).setDepth(12);



        const nextbtn = this.add.image(1200, 730, 'nextbtn')
            .setOrigin(0.5)
            .setInteractive()
            .setDepth(11);

        const restart = this.add.image(740, 730, 'restart')
            .setOrigin(0.5)
            .setInteractive()
            .setDepth(11);

        // Handlers
        nextbtn.on('pointerdown', () => {
            winBG.destroy();
            lvlbox.destroy();
            lvltxt.destroy();
            nextbtn.destroy();
            restart.destroy();
            this.notifyParent('sceneComplete', { result: 'win' });
        });

        restart.on('pointerdown', () => {
            winBG.destroy();
            lvlbox.destroy();
            lvltxt.destroy();
            nextbtn.destroy();
            restart.destroy();
            this.scene.restart(); // SHUTDOWN will run
        });
    }


    notifyParent(type, data) {
        if (window.parent !== window) {
            window.parent.postMessage({ type, ...data }, "*");
        }
    }

    hitDrum(shark, drum) {
        // Camera + hit flash
        this.cameras.main.shake(150, 0.005);
        this.cameras.main.flash(100, 255, 64, 64);

        this.tweens.add({
            targets: this.hitOverlay,
            alpha: { from: 0.35, to: 0 },
            duration: 200,
            ease: 'Quad.Out'
        });

        this.shark.setTint(0xff0000);
        this.time.delayedCall(400, () => this.shark.clearTint());
        drum.destroy();
        this.bomb = this.sound.add('bomb', { loop: false, volume: 1 });
        this.bomb.play();

        // ↓↓↓ lives system
        this._loseALife();
    }

    gameOver() {
        // Stop warning FX
        this.lowHpTween?.stop(); this.lowHpTween = null;
        this.hpPulse?.stop(); this.hpPulse = null;
        if (this.lowHpOverlay) this.lowHpOverlay.alpha = 0;
        if (this.hitOverlay) this.hitOverlay.alpha = 0;

        if (this.bgm) this.bgm.setVolume(0.2);

        // ✅ Pause physics on GAME OVER (kept)
        this.physics.pause();

        // ✅ Game over background image (full-screen)
        const overBG = this.add.image(960, 540, 'level_lost_background')
            .setOrigin(0.5)
            .setDepth(10)
            .setScrollFactor(0);
        overBG.setDisplaySize(1920, 1080);

        // Game over UI
        const gameovrbg = this.add.image(960, 440, 'gameovrbg').setOrigin(0.5).setDepth(11).setScale(0.37, 0.3);
        const lvltxt = this.add.text(
            800, 400,
            this._t('gameOverText', 'Game Over'),
            Object.assign(
                { fontSize: 'bold 70px', fontFamily: 'outfit', color: '#ffffff', backgroundColor: '#0D0D0D' },
                this._textStyle('htpHeading', {})
            )
        ).setDepth(12);


        const restart = this.add.image(960, 660, 'restart1')
            .setOrigin(0.5)
            .setInteractive()
            .setDepth(11);

        restart.on('pointerdown', () => {
            overBG.destroy();
            gameovrbg.destroy();
            lvltxt.destroy();
            restart.destroy();
            this.scene.restart(); // SHUTDOWN cleans everything
        });
    }

}