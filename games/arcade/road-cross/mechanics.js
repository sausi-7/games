let level = 1;
let score = 0;
let sharedConfig = null;

export default class RoadCrossScene extends Phaser.Scene {
    constructor() {
        super('RoadCrossScene');
        Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach(fn => {
            if (typeof this[fn] === 'function') this[fn] = this[fn].bind(this);
        });
        this.hasAssets = false;
        this.levelConfig = null;
        this.cars = null;
        this.player = null;
        this.levelText = null;
        this.timerText = null;
        this.scoreText = null;
        this.timerEvent = null;
        this.timeLeft = 0;
        this.gameOver = false;
        this._started = false;
        this._endOverlay = null;
        this._startOverlay = null;

        this._carOverlap = null;

        // FX handles
        this.impactParticles = null;
        this.confettiParticles = null;
        this._timerWarningTween = null;
    }

    notifyParent(type, data) {
        if (window.parent !== window) {
            window.parent.postMessage({ type, ...data }, "*");
        }
    }

    preload() {
        const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf("/"));
        this.load.json('levelConfig', `${basePath}/config.json`);

        this.load.once('filecomplete-json-levelConfig', () => {
            const cfg = this.cache.json.get('levelConfig');
            this.levelConfig = cfg;
            sharedConfig = cfg;

            // Spritesheet from URL param or config
            const rawMain = new URLSearchParams(window.location.search).get('main') || '';
            const cleanMain = rawMain.replace(/^"|"$/g, '');
            const sheetInfo = cfg.spritesheets?.player || {};
            const playerSheetURL = cleanMain || `${basePath}/${sheetInfo.path || 'assets/player.png'}`;
            const frameW = sheetInfo.frameWidth || 103;
            const frameH = sheetInfo.frameHeight || 143;
            this.load.spritesheet('player', playerSheetURL, { frameWidth: frameW, frameHeight: frameH });

            // Images
            if (cfg.images1) {
                for (const [key, url] of Object.entries(cfg.images1)) {
                    if (!this.sys.textures.exists(key)) this.load.image(key, `${basePath}/${url}`);
                }
            }
            if (cfg.images2) {
                for (const [key, url] of Object.entries(cfg.images2)) {
                    if (!this.sys.textures.exists(key)) this.load.image(key, `${basePath}/${url}`);
                }
            }
            if (cfg.ui) {
                for (const [key, url] of Object.entries(cfg.ui)) {
                    if (!this.sys.textures.exists(key)) this.load.image(key, `${basePath}/${url}`);
                }
            }

            // Audio (optional)
            if (cfg.audio) {
                for (const [key, url] of Object.entries(cfg.audio)) {
                    if (!this.sound.get(key)) this.load.audio(key, `${basePath}/${url}`);
                }
            }

            this.load.once('complete', () => {
                this.hasAssets = true;
                if (this.scene.isActive()) this._reallyCreate();
            });

            this.load.start();
        });
    }

    init() {
        // reset flags
        this._started = false;
        this.gameOver = false;
        this._hasPlayedHit = false;

        // timers
        if (this.timerEvent) { this.timerEvent.remove(false); this.timerEvent = null; }

        // sounds
        if (this.bgmSound) { this.bgmSound.stop(); this.bgmSound.destroy(); this.bgmSound = null; }
        if (this.hitSound) { this.hitSound.stop(); this.hitSound.destroy(); this.hitSound = null; }

        // overlays
        if (this._startOverlay) { this._startOverlay.destroy(); this._startOverlay = null; }
        if (this._endOverlay) { this._endOverlay.destroy(); this._endOverlay = null; }

        // player/cars
        if (this.player) { this.player.destroy(); this.player = null; }
        if (this._carOverlap) { this._carOverlap.destroy(); this._carOverlap = null; }
        if (this.cars) { this.cars.clear(true, true); this.cars.destroy(); this.cars = null; }

        // UI
        if (this.controlButtons) { this.controlButtons.destroy(); this.controlButtons = null; }
        if (this.levelText) { this.levelText.destroy(); this.levelText = null; }
        if (this.timerText) { this.timerText.destroy(); this.timerText = null; }
        if (this.scoreText) { this.scoreText.destroy(); this.scoreText = null; }
        if (this.scorebar) { this.scorebar.destroy(); this.scorebar = null; }

        // inputs
        if (this.input) {
            this.input.removeAllListeners();
            if (this.input.keyboard) this.input.keyboard.removeAllListeners();
        }

        // FX cleanup
        if (this.impactParticles) { this.impactParticles.destroy(); this.impactParticles = null; }
        if (this.confettiParticles) { this.confettiParticles.destroy(); this.confettiParticles = null; }
        if (this._timerWarningTween) { this._timerWarningTween.stop(); this._timerWarningTween = null; }
    }

    create() {
        if (!this.levelConfig) this.levelConfig = sharedConfig;
        if (!this.levelConfig) { console.warn("❌ levelConfig still missing during create()"); return; }
        this._reallyCreate();
    }

    _reallyCreate() {
        this._hasPlayedHit = false;
        if (!this.levelConfig) { console.warn("❌ levelConfig missing during _reallyCreate()"); return; }

        // clear stray UI
        if (this._endOverlay) { this._endOverlay.destroy(); this._endOverlay = null; }
        if (this._startOverlay) { this._startOverlay.destroy(); this._startOverlay = null; }
        if (this.levelText) this.levelText.destroy();
        if (this.timerText) this.timerText.destroy();
        if (this.scoreText) this.scoreText.destroy();

        // Config
        const cfg = this.levelConfig;
        const orientation = cfg.orientation;
        const game = cfg.game;
        const texts = cfg.texts;
        const colors = cfg.colors;
        this.CARS = cfg.cars;
        this.PLAYER_DEF = cfg.player;

        this.GAME_WIDTH = orientation.width;
        this.GAME_HEIGHT = orientation.height;
        this.TILE_SIZE = game.tileSize;
        this.ROAD_ROWS = game.roadRows;
        this.LANE_HEIGHT = game.laneHeight;
        this.SIDEWALK_HEIGHT = game.sidewalkHeight;
        this.GOAL_HEIGHT = game.goalHeight;
        this.CAR_SPEEDS = game.carSpeeds;
        this.LEVEL_TIME = game.levelTime;
        this.TEXTS = texts;
        this.COLORS = colors;

        this.gameOver = false;
        this.timeLeft = this.LEVEL_TIME;
        this._started = false;

        if (this.cars) this.cars.clear(true, true);
        if (this.player) { this.player.destroy(); this.player = null; }

        // Camera
        this.sys.cameras.main.setBackgroundColor('#1e1e1e');
        this.sys.cameras.main.setViewport(0, 0, this.GAME_WIDTH, this.GAME_HEIGHT);

        // FX textures & particle systems
        this._makeParticleTextures();

        // World
        this._drawBackground();
        this._createPlayer();
        this._spawnCars();
        this._createUI();
        this._showStartOverlay();

        if (this.input?.keyboard) this.input.keyboard.removeAllListeners();
        if (this.timerEvent) this.timerEvent.remove(false);
        this.timerEvent = null;

        this._createControlButtons();
        this.input.setTopOnly(true);
        this._setControlsActive(true);
    }

    /** --------- UI & STYLE HELPERS ---------- **/
    _textStyle(baseSize = 50, color = '#ffffff') {
        // Centralized arcade-style text style
        return {
            fontFamily: 'Outfit',
            fontSize: `${baseSize}px`,
            color,
        };
    }

    _applyArcadeFX(textObj, { stroke = '#13131a', strokeThickness = 8, shadowColor = '#000000', shadowBlur = 6, shadowOffsetY = 4 } = {}) {
        textObj.setStroke(stroke, strokeThickness);
        textObj.setShadow(0, shadowOffsetY, shadowColor, shadowBlur, true, true);
        return textObj;
    }

    _pulseText(target, scaleUp = 1.15, duration = 120) {
        if (!target) return;
        this.tweens.killTweensOf(target);
        target.setScale(1);
        this.tweens.add({
            targets: target,
            scale: scaleUp,
            duration,
            yoyo: true,
            ease: 'Back.Out',
        });
    }

    _startTimerWarning() {
        if (!this.timerText || this._timerWarningTween) return;
        this.timerText.setColor('#ff5252');
        this._timerWarningTween = this.tweens.add({
            targets: this.timerText,
            alpha: 0.35,
            duration: 220,
            yoyo: true,
            repeat: -1,
        });
        // optional beep if present
        if (this.sound.get('beep')) {
            this.time.addEvent({
                delay: 1000,
                loop: true,
                callback: () => { if (!this.gameOver && this._started) this.sound.play('beep', { volume: 0.5 }); }
            });
        }
    }

    /** --------- PARTICLES & CAMERA FX ---------- **/
    _makeParticleTextures() {
        // small round dot
        if (!this.textures.exists('fx_dot')) {
            const g = this.add.graphics();
            g.fillStyle(0xffffff, 1);
            g.fillCircle(4, 4, 4);
            g.generateTexture('fx_dot', 8, 8);
            g.destroy();
        }
        // small square
        if (!this.textures.exists('fx_sq')) {
            const g2 = this.add.graphics();
            g2.fillStyle(0xffffff, 1);
            g2.fillRect(0, 0, 6, 6);
            g2.generateTexture('fx_sq', 6, 6);
            g2.destroy();
        }
    }

    _playHitFX(x, y) {
        const cam = this.cameras.main;
        cam.flash(120, 255, 255, 255);
        cam.shake(220, 0.005);

        const prevScale = this.time.timeScale;
        this.time.timeScale = 0.15;
        this.time.delayedCall(90, () => { this.time.timeScale = prevScale; });

        // One-shot emitter (3.60+)
        const emitter = this.add.particles(x, y, 'fx_dot', {
            speed: { min: 120, max: 260 },
            gravityY: 400,
            angle: { min: 180, max: 360 },
            lifespan: { min: 220, max: 420 },
            scale: { start: 1, end: 0 },
            alpha: { start: 1, end: 0 },
            tint: [0xffffff, 0xff6666, 0xffff66],
            quantity: 0,          // we'll use explode()
            frequency: -1         // don’t auto-emit
        });
        emitter.explode(24, x, y);
        this.time.delayedCall(700, () => emitter.destroy());
    }

    _playWinFX() {
        const cam = this.cameras.main;
        cam.flash(200, 255, 255, 255);

        const colors = [0xff6b6b, 0xffe66d, 0x6bff95, 0x6bd4ff, 0xd66bff];

        const emitter = this.add.particles(this.GAME_WIDTH / 2, 0, 'fx_sq', {
            angle: { min: 80, max: 100 },
            speedY: { min: 320, max: 480 },
            speedX: { min: -120, max: 120 },
            gravityY: 800,
            lifespan: 1400,
            tint: colors,
            rotate: { min: 0, max: 360 },
            scale: { start: 1, end: 0.6 },
            quantity: 12,
            frequency: 60
        });
        this.time.delayedCall(900, () => emitter.stop());
        this.time.delayedCall(2000, () => emitter.destroy());
    }

    /** --------- UI ---------- **/
    _createUI() {
        if (this.levelText) this.levelText.destroy();
        if (this.timerText) this.timerText.destroy();
        if (this.scoreText) this.scoreText.destroy();
        if (this.scorebar) this.scorebar.destroy();

        this.scorebar = this.add.image(540, 70, 'scorebar').setDepth(900);

        this.levelText = this.add.text(80, 40, this.TEXTS.level + ' ' + level, this._textStyle(54, '#ffffff'));
        this._applyArcadeFX(this.levelText).setDepth(901);

        this.timerText = this.add.text(this.GAME_WIDTH / 2, 40, this._formatTime(this.LEVEL_TIME), this._textStyle(54, '#ffffff'))
            .setOrigin(0.5, 0);
        this._applyArcadeFX(this.timerText).setDepth(901);

        this.scoreText = this.add.text(this.GAME_WIDTH - 80, 40, this.TEXTS.score + ' ' + score, this._textStyle(54, '#ffffff'))
            .setOrigin(1, 0);
        this._applyArcadeFX(this.scoreText).setDepth(901);
    }

    _createControlButtons() {
        const buttonSize = 150;
        const spacing = 30;
        const yBase = this.GAME_HEIGHT - buttonSize - spacing;

        this.controlButtons = this.add.container(0, 0);

        const left = this.add.image(150, yBase, 'left')
            .setDisplaySize(buttonSize, buttonSize)
            .setInteractive()
            .on('pointerdown', () => this._tryMovePlayer(-this.TILE_SIZE, 0));

        const right = this.add.image(350, yBase, 'right')
            .setDisplaySize(buttonSize, buttonSize)
            .setInteractive()
            .on('pointerdown', () => this._tryMovePlayer(this.TILE_SIZE, 0));

        const up = this.add.image(970, yBase - 100, 'up')
            .setDisplaySize(buttonSize, buttonSize)
            .setInteractive()
            .on('pointerdown', () => this._tryMovePlayer(0, -this.TILE_SIZE));

        const down = this.add.image(970, yBase + 100, 'down')
            .setDisplaySize(buttonSize, buttonSize)
            .setInteractive()
            .on('pointerdown', () => this._tryMovePlayer(0, this.TILE_SIZE));

        this.controlButtons.add([left, right, up, down]);
        this.controlButtons.setDepth(1000);
    }

    _drawBackground() {
        const w = this.GAME_WIDTH, h = this.GAME_HEIGHT, ROWS = this.ROAD_ROWS, LANE = this.LANE_HEIGHT, SIDE = this.SIDEWALK_HEIGHT, GOAL = this.GOAL_HEIGHT, images = this.levelConfig.images2, ui = this.levelConfig.ui;

        // Goal (top grass)
        if (ui.bg_goal && this.sys.textures.exists('bg_goal')) {
            this.add.image(w / 2, GOAL / 2, 'bg_goal').setDisplaySize(w, GOAL);
        } else {
            this.add.rectangle(w / 2, GOAL / 2, w, GOAL, 0x79e350);
        }
        // Sidewalk (bottom)
        if (images.road && this.sys.textures.exists('road')) {
            this.add.image(w / 2, h - SIDE / 2, 'road').setDisplaySize(w, SIDE);
        } else {
            this.add.rectangle(w / 2, h - SIDE / 2, w, SIDE, 0xbcbcbc);
        }
        // Road (center)
        if (images.background && this.sys.textures.exists('background')) {
            this.add.image(w / 2, h / 2 + GOAL / 2, 'background').setDisplaySize(w, ROWS * LANE);
        } else {
            this.add.rectangle(w / 2, h / 2 + GOAL / 2, w, ROWS * LANE, 0x444444);
        }
        // Lane dashes
        for (let i = 0; i < ROWS; i++) {
            for (let j = 0; j < 12; j++) {
                this.add.rectangle(
                    (j + 0.5) * (w / 12),
                    GOAL + (i + 0.5) * LANE,
                    70, 12,
                    0xffffff,
                    0.35
                );
            }
        }
    }

    _createPlayer() {
        const w = this.GAME_WIDTH, h = this.GAME_HEIGHT, SIDE = this.SIDEWALK_HEIGHT;

        this.player = this.add.sprite(w / 2, h - SIDE / 2, 'player', 0)
            .setDisplaySize(this.PLAYER_DEF.width, this.PLAYER_DEF.height);

        this.physics.add.existing(this.player);
        this.player.body.allowGravity = false;
        this.player.body.setCollideWorldBounds(true);
        this.player.setDepth(2);

        this.anims.create({
            key: 'idle',
            frames: this.anims.generateFrameNumbers('player', { start: 19, end: 19 }),
            frameRate: 6,
            repeat: -1
        });
        this.player.play('idle');
    }

    _spawnCars() {
        const ROWS = this.ROAD_ROWS;
        const LANE = this.LANE_HEIGHT;
        const GOAL = this.GOAL_HEIGHT;

        if (this.cars) this.cars.clear(true, true);
        this.cars = this.physics.add.group();

        for (let i = 0; i < ROWS; i++) {
            const y = GOAL + (i + 0.5) * LANE;
            const speed = this.CAR_SPEEDS[i] + Phaser.Math.Between(-20, 20) + (level - 1) * 12;
            const dir = i % 2 === 0 ? 1 : -1;
            const carCount = 2 + Math.floor(level / 2);

            let spacing = this.GAME_WIDTH / carCount;
            for (let j = 0; j < carCount; j++) {
                const carType = this.CARS[(i + j) % this.CARS.length];
                const baseX = j * spacing + Phaser.Math.Between(-50, 50);
                const spawnX = dir === 1 ? -baseX : this.GAME_WIDTH + baseX;

                const car = this.cars.create(spawnX, y, carType.key)
                    .setDisplaySize(carType.width, carType.height)
                    .setDepth(1);

                car.body.allowGravity = false;
                car.body.setImmovable(true);

                car.setData('dir', dir);
                car.setData('speed', speed);
                car.setData('laneY', y);

                if (dir === 1) car.setFlipX(true);
            }
        }

        this._hasPlayedHit = false;

        if (this._carOverlap) { this._carOverlap.destroy(); this._carOverlap = null; }
        this._carOverlap = this.physics.add.overlap(
            this.player,
            this.cars,
            () => {
                if (!this._hasPlayedHit) {
                    this._hasPlayedHit = true;
                    if (!this.hitSound) this.hitSound = this.sound.add('hit', { volume: 1, loop: false });
                    this.hitSound?.play();
                    this._playHitFX(this.player.x, this.player.y);
                }
                this._onLose();
            },
            null,
            this
        );
    }

    _showStartOverlay() {
        const w = this.GAME_WIDTH, h = this.GAME_HEIGHT;
        this._startOverlay = this.add.container(w / 2, h / 2);
        const bg = this.add.rectangle(0, 0, w * 0.8, 300, 0x222244, 0.96);
        const textImg = this.add.image(0, -150, 'htp').setOrigin(0.5);
        const sub = this.add.text(0, -150, "Tap or swipe to move, cross the road,\nand finish the level.", this._textStyle(46, '#ffffff'))
            .setOrigin(0.5);
        this._applyArcadeFX(sub, { strokeThickness: 6, shadowBlur: 8 });

        const play = this.add.image(0, 500, 'playbtn').setInteractive();
        this._startOverlay.add([bg, textImg, sub, play]);
        this._startOverlay.setDepth(1000).setVisible(true);

        // subtle breathing
        this.tweens.add({
            targets: play,
            scale: 1.05,
            yoyo: true,
            repeat: -1,
            duration: 800,
            ease: 'Sine.inOut'
        });

        play.on('pointerdown', () => {
            this._startOverlay.setVisible(false);
            this._startGame();
        }, this);
    }

    _startGame() {
        if (this.physics?.world?.isPaused) this.physics.world.resume();

        this._started = true;
        this.gameOver = false;
        this.timeLeft = this.LEVEL_TIME;
        this.levelText.setText(this.TEXTS.level + ' ' + level);
        this.timerText.setText(this._formatTime(this.LEVEL_TIME));
        this.scoreText.setText(this.TEXTS.score + ' ' + score);

        // BGM
        if (!this.bgmSound) this.bgmSound = this.sound.add('bgm', { loop: true, volume: 0.4 });
        this.bgmSound.play();

        if (this.timerEvent) this.timerEvent.remove(false);
        this.timerEvent = this.time.addEvent({
            delay: 1000,
            loop: true,
            callback: () => {
                if (!this.gameOver) {
                    this.timeLeft--;
                    this.timerText.setText(this._formatTime(this.timeLeft));
                    if (this.timeLeft === 10) this._startTimerWarning();
                    if (this.timeLeft <= 0) this._onLose();
                }
            }
        });
    }

    _tryMovePlayer(dx, dy) {
        if (!this._started || this.gameOver) return;
        if (dx === 0 && dy === 0) return;

        const nx = Phaser.Math.Clamp(this.player.x + dx, this.TILE_SIZE / 2, this.GAME_WIDTH - this.TILE_SIZE / 2);
        const ny = Phaser.Math.Clamp(this.player.y + dy, this.GOAL_HEIGHT / 2, this.GAME_HEIGHT - this.SIDEWALK_HEIGHT / 2);
        if (ny < this.GOAL_HEIGHT / 2 || ny > this.GAME_HEIGHT - this.SIDEWALK_HEIGHT / 2) return;

        // snappy hop feel
        this.tweens.killTweensOf(this.player);
        this.tweens.add({
            targets: this.player,
            scaleY: 0.92,
            scaleX: 1.06,
            duration: 60,
            yoyo: true
        });

        this.player.x = nx;
        this.player.y = ny;

        if (ny === this.GOAL_HEIGHT / 2) this._onWin();
    }

    update(time, delta) {
        if (!this._started || this.gameOver || !this.cars || !this.cars.getChildren) return;
        const cars = this.cars.getChildren();
        if (!cars || !cars.length) return;

        for (let i = 0; i < cars.length; i++) {
            const car = cars[i];
            if (!car || !car.active) continue;

            let spd = car.getData('speed');
            let dir = car.getData('dir');
            car.x += dir * spd * (delta / 1000);

            // keep lane
            car.y = car.getData('laneY');

            // wrap
            if (dir === 1 && car.x > this.GAME_WIDTH + 180) car.x = -Phaser.Math.Between(200, 600);
            if (dir === -1 && car.x < -180) car.x = this.GAME_WIDTH + Phaser.Math.Between(200, 600);
        }
    }

    _onWin() {
        this.gameOver = true;
        score += 1;
        this.scoreText.setText(this.TEXTS.score + ' ' + score);
        this._pulseText(this.scoreText);

        if (this.bgmSound) this.bgmSound.stop();

        this._playWinFX();

        this._showWinScreen(() => {
            level++;
            this.scene.restart();
        });
    }

    _onLose() {
        this.gameOver = true;

        if (this.bgmSound) this.bgmSound.stop();

        this._showEndScreen(this.TEXTS.gameOver, this.COLORS.gameOver, () => {
            level = 1;
            score = 0;
            this.scene.restart();
        });
    }

    _setControlsActive(active) {
        if (!this.controlButtons) return;
        for (const child of this.controlButtons.list) {
            if (active) child.setInteractive();
            else child.disableInteractive();
        }
    }

    _preRestartCleanup() {
        this._started = false;
        this.gameOver = true;

        if (this.timerEvent) { this.timerEvent.remove(false); this.timerEvent = null; }
        if (this.bgmSound) { this.bgmSound.stop(); }
        if (this.hitSound) { this.hitSound.stop(); }
        if (this._carOverlap) { this._carOverlap.destroy(); this._carOverlap = null; }
        if (this.physics?.world) this.physics.world.pause();
        if (this.physics?.world?.colliders) this.physics.world.colliders.destroy();

        if (this.cars) {
            this.cars.clear(true, true);
            this.cars.destroy();
            this.cars = null;
        }
        if (this._timerWarningTween) { this._timerWarningTween.stop(); this._timerWarningTween = null; }
    }

    _showEndScreen(message, color, onRestart) {
        if (this._endOverlay) { this._endOverlay.destroy(); this._endOverlay = null; }

        const w = this.GAME_WIDTH, h = this.GAME_HEIGHT;
        this._endOverlay = this.add.container(w / 2, h / 2).setDepth(10000);
        this._setControlsActive(false);

        const blocker = this.add.rectangle(0, 0, w, h, 0x000000, 0.001).setOrigin(0.5).setInteractive();

        const rect = this.add.image(0, 0, 'ovrbox');
        const txt = this.add.text(0, 0, message, this._textStyle(56, '#ffffff')).setOrigin(0.5);
        this._applyArcadeFX(txt, { strokeThickness: 10, shadowBlur: 10 });

        const btn = this.add.image(0, 350, 'replay').setOrigin(0.5).setInteractive({ useHandCursor: true });

        // subtle button press tween
        btn.on('pointerdown', () => this.tweens.add({ targets: btn, scale: 0.94, duration: 80, yoyo: true }));

        // minimal, clean restart
        btn.once('pointerup', () => {
            this.input.enabled = false;
            this._preRestartCleanup();
            this.time.delayedCall(0, () => this.scene.restart());
        });

        this._endOverlay.add([blocker, rect, txt, btn]);
        this.children.bringToTop(this._endOverlay);
    }

    _showWinScreen(onNext) {
        if (this._endOverlay) { this._endOverlay.destroy(); this._endOverlay = null; }

        const w = this.GAME_WIDTH, h = this.GAME_HEIGHT;
        this._endOverlay = this.add.container(w / 2, h / 2).setDepth(10000);
        this._setControlsActive(false);

        const blocker = this.add.rectangle(0, 0, w, h, 0x000000, 0.001).setOrigin(0.5).setInteractive();

        const box = this.add.image(0, 0, 'lvlbox');
        const text = this.add.text(0, 0, "You Win!", this._textStyle(56, '#ffffff')).setOrigin(0.5);
        this._applyArcadeFX(text, { strokeThickness: 10, shadowBlur: 10 });

        const next = this.add.image(-235, 350, 'next').setInteractive({ useHandCursor: true });
        const retry = this.add.image(235, 350, 'replay_level').setInteractive({ useHandCursor: true });

        // button feedback
        for (const b of [next, retry]) {
            b.on('pointerdown', () => this.tweens.add({ targets: b, scale: 0.94, duration: 80, yoyo: true }));
        }

        next.once('pointerup', () => {
            this.input.enabled = false;
            this.time.delayedCall(0, () => {
                this._endOverlay?.destroy(); this._endOverlay = null;
                if (this.timerEvent) { this.timerEvent.remove(false); this.timerEvent = null; }
                this.notifyParent('sceneComplete', { result: 'win' });
            });
        });

        retry.once('pointerup', () => {
            this.input.enabled = false;
            this._preRestartCleanup();
            this.time.delayedCall(0, () => this.scene.restart());
        });

        this._endOverlay.add([blocker, box, text, next, retry]);
        this.children.bringToTop(this._endOverlay);
    }

    _formatTime(s) {
        return '00:' + (s < 10 ? '0' : '') + s;
    }
}
