// Main Game Scene (simplified, no spritesheet)
export default class GameScene extends Phaser.Scene {
    constructor() {
        super({ key: 'GameScene', physics: { arcade: {} } });

        this.replay = false;
        this.combinationCount = 0;
        this.gameOver = false;
        this.gameWon = false;
        this.targetScore = 0;
        this.bubbleSpeed = 1500;   // (was this.bubblespeed)
        this.timeTotal = 60


        this.bubbleSize = 65;
        this.bubbleColors = ['spherical', 'spherical1', 'spherical2', 'spherical3'];
        this.currentBubbleIndex = 0;
        this.bubbleGrid = [];
        this.shotBubble = null;

        this.texts = {};
        this.levelConfig = null;

        Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach((fn) => {
            if (typeof this[fn] === "function" && fn !== "constructor") {
                this[fn] = this[fn].bind(this);
            }
        });
    }

    init(data) {
        this.replay = data?.replay || false;
    }

    preload() {
        const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));
        this.load.json('levelConfig', `${basePath}/config.json`);

        this.load.once('filecomplete-json-levelConfig', () => {
            const cfg = this.cache.json.get('levelConfig') || {};
            this.levelConfig = cfg;
            this.texts = cfg.texts || cfg.copy || {};
            const mechanics = cfg.mechanics || {};

            // mechanics from config
            this.targetScore = mechanics.targetScore;
            this.bubbleSpeed = mechanics.bubbleSpeed;
            this.gravity = mechanics.gravity || { x: 0, y: 0 };
            this.timeTotal = Number(mechanics.timerSeconds ?? cfg.timerSeconds ?? 60);

            // images
            if (cfg.images1) {
                Object.entries(cfg.images1).forEach(([key, url]) => {
                    this.load.image(key, `${basePath}/${url}`).on('error', () => console.error(`Failed to load image: ${key}`));
                });
            }
            if (cfg.images2) {
                Object.entries(cfg.images2).forEach(([key, url]) => {
                    this.load.image(key, `${basePath}/${url}`).on('error', () => console.error(`Failed to load image: ${key}`));
                });
            }
            if (cfg.ui) {
                Object.entries(cfg.ui).forEach(([key, url]) => {
                    this.load.image(key, `${basePath}/${url}`).on('error', () => console.error(`Failed to load image: ${key}`));
                });
            }

            // audio
            if (cfg.audio) {
                for (const [key, url] of Object.entries(cfg.audio)) {
                    if (typeof url !== 'string') continue;

                    // Allow both full URLs and relative paths
                    const audioUrl =
                        /^https?:\/\//i.test(url) || url.startsWith('//')
                            ? url                       // absolute URL -> use as is
                            : `${basePath}/${url}`;     // relative -> prefix with basePath

                    this.load.audio(key, audioUrl).on('error', () => {
                        console.error(`Failed to load audio "${key}" from ${audioUrl}`);
                    });
                }
            }

            // this.load.start(); // optional, Phaser auto-starts after queueing in most setups
        });
    }

    create() {
        this.popSound = this.sound.add('pop_sound');
        this.upSound = this.sound.add('up');

        if (this.replay) {
            this.startScene();
        } else {
            this.menuScene();
        }
    }

    // add this small helper anywhere in the class (e.g., after methods block begins):
    t(key, fallback) {
        const src = (this.levelConfig && (this.levelConfig.texts || this.levelConfig.copy)) || this.texts || {};
        const val = src[key];
        return (val === undefined || val === null || val === '') ? fallback : val;
    }


    startScene() {
        // Cleanup grid
        this.bubbleGrid.forEach(row => row.forEach(b => { if (b?.destroy) b.destroy(); }));
        this.bubbleGrid = [];

        // UI cleanup if replay
        if (this.aimingLine) this.aimingLine.destroy();
        if (this.nextBubble) this.nextBubble.destroy();
        this.shotBubble = null;

        this.combinationCount = 0;

        // Background + platform
        this.add.image(this.sys.cameras.main.centerX, this.sys.cameras.main.centerY, 'background')

        this.add.image(this.sys.cameras.main.centerX, this.sys.cameras.main.height - 50, 'platform')
            .setDisplaySize(this.sys.cameras.main.width, 100);

        // Cannon
        this.placeCannon();

        // Grid
        this.gridWidth = Math.floor(this.sys.cameras.main.width / this.bubbleSize);
        this.gridOffsetX = (this.sys.cameras.main.width - this.gridWidth * this.bubbleSize) / 2;
        this.gridOffsetY = 100;
        this.createBubbleGrid();

        // Next bubble + aiming line + UI + timer + input
        this.createNextBubble();
        this.aimingLine = this.add.graphics();
        this.createUI();
        this.startTimer();
        this.setupInput();
    }

    // Place the cannon just above the platform, pointing up by default
    placeCannon() {
        const platformTopY = this.sys.cameras.main.height - 100;
        this.cannon = this.add.image(this.sys.cameras.main.centerX, platformTopY, 'cannon').setScale(2);
        this.currentAngle = Math.PI * 1.5; // upward
    }

    createBubbleGrid() {
        const initialRows = 8;
        const oddRowOffset = this.bubbleSize / 2;

        for (let row = 0; row < initialRows; row++) {
            this.bubbleGrid[row] = [];
            const bubbleCount = row % 2 === 0 ? this.gridWidth : this.gridWidth - 1;
            const rowXOffset = row % 2 === 0 ? 0 : oddRowOffset;

            for (let col = 0; col < bubbleCount; col++) {
                const randomIndex = Phaser.Math.Between(0, this.bubbleColors.length - 1);
                const bubbleColor = this.bubbleColors[randomIndex];

                const x = this.gridOffsetX + rowXOffset + col * this.bubbleSize + this.bubbleSize / 2;
                const y = this.gridOffsetY + row * this.bubbleSize + this.bubbleSize / 2;

                const bubble = this.physics.add.image(x, y, bubbleColor);
                bubble.setScale(this.bubbleSize / bubble.width);
                bubble.setImmovable(true);
                bubble.body.moves = false;
                bubble.setData('row', row);
                bubble.setData('col', col);
                bubble.setData('color', bubbleColor);
                bubble.body.setCircle(bubble.width / 3, bubble.width / 6, bubble.height / 6);

                this.bubbleGrid[row][col] = bubble;
            }
        }
    }

    createNextBubble() {
        if (this.nextBubble) this.nextBubble.destroy();
        const color = Phaser.Math.RND.pick(this.bubbleColors);
        const bubble = this.physics.add.image(this.cannon.x + 5, this.cannon.y, color);
        bubble.setScale(this.bubbleSize / bubble.width);
        bubble.setData('color', color).setData('collided', false);
        bubble.body.moves = false;
        bubble.body.setCircle(bubble.width / 3, bubble.width / 6, bubble.height / 6);
        bubble.setScale(0);
        this.sys.tweens.add({
            targets: bubble,
            scale: this.bubbleSize / bubble.width,
            duration: 200,
            ease: 'Back.out'
        });
        this.nextBubble = bubble;
    }

    // ─── Input ──────────────────────────────────────────────────────────
    setupInput() {
        this.cursors = this.input.keyboard.createCursorKeys();
        this.enableInputEvents();
    }

    enableInputEvents() {
        this.input.keyboard.on('keydown-SPACE', this.onKeyDown, this);
        this.input.on('pointerdown', this.onPointerDown, this);
        this.input.on('pointermove', this.onPointerMove, this);
        this.input.on('pointerup', this.onPointerUp, this);
    }

    disableInputEvents() {
        this.input.keyboard.off('keydown-SPACE', this.onKeyDown, this);
        this.input.off('pointerdown', this.onPointerDown, this);
        this.input.off('pointermove', this.onPointerMove, this);
        this.input.off('pointerup', this.onPointerUp, this);
    }

    onKeyDown(event) {
        if (event.code === 'Space' && !this.shotBubble && !this.gameOver) {
            this.shootBubble();
        }
    }

    onPointerDown(p) { if (!this.gameOver) this.updateAiming(p.x, p.y); }
    onPointerMove(p) { if (!this.gameOver) this.updateAiming(p.x, p.y); }
    onPointerUp() { if (!this.shotBubble && !this.gameOver) this.shootBubble(); }

    createUI() {
        // createUI()  ── replace hardcoded strings:
        this.textBox = this.add.image(20, 20, 'textbox').setScrollFactor(0).setDepth(9).setScale(0.8).setOrigin(0, 0);
        this.timerText = this.add.text(
            35, 25,
            `${this.t('timer_label', 'Time')}: ${this.timeTotal}`,
            { font: "50px Outfit", color: '#000000', fontStyle: 'bold' }
        ).setDepth(10);

        this.textBox = this.add.image(800, 20, 'textbox').setScrollFactor(0).setDepth(9).setScale(0.8).setOrigin(0, 0);
        this.combinationText = this.add.text(
            820, 25,
            `${this.t('score_label', 'Score')}: 0`,
            { font: "50px Outfit", color: '#000000', fontStyle: 'bold' }
        ).setDepth(10);

    }

    startTimer() {
        this.timeLeft = this.timeTotal;
        this.timerText.setText(`${this.t('timer_label', 'Time')}: ${this.timeLeft}`);
        if (this.timer) this.timer.remove();
        this.timer = this.time.addEvent({
            delay: 1000,
            loop: true,
            callback: () => {
                this.timeLeft--;
                this.timerText.setText(`${this.t('timer_label', 'Time')}: ${this.timeLeft}`);
                if (this.timeLeft <= 0) this.endGame(false);
            }
        });
    }

    // ─── update() ───────────────────────────────────────────────────────
    update() {
        if (this.gameOver) return;

        // arrow-key aiming only when pointer not down
        if (!this.input.activePointer.isDown) {
            if (this.cursors?.left.isDown) this.updateAiming(this.cannon.x - 5, 0);
            else if (this.cursors?.right.isDown) this.updateAiming(this.cannon.x + 5, 0);
        }

        // moving shot bubble
        if (this.shotBubble) {
            const b = this.shotBubble;

            // wall bounce
            if (b.x <= this.bubbleSize / 2 || b.x >= this.sys.cameras.main.width - this.bubbleSize / 2) {
                b.body.velocity.x *= -1;
                this.sys.cameras.main.shake(50, 0.005);
            }

            // snap to top
            if (b.y <= this.gridOffsetY) {
                const col = Math.floor((b.x - this.gridOffsetX) / this.bubbleSize);
                this.snapBubbleToGrid(b, 0, col);
                return;
            }

            // overlap with existing grid
            const flat = this.bubbleGrid.flat().filter(e => e);
            this.physics.overlap(b, flat, this.handleBubbleCollision, null, this);

            // cleanup if off-screen
            if (b.y > this.sys.cameras.main.height || b.y < 0) {
                b.destroy();
                this.shotBubble = null;
                this.createNextBubble();
            }
        }

        // loss condition
        this.checkBubblesReachedBottom();
    }

    // ─── aiming ─────────────────────────────────────────────────────────
    updateAiming(x, y) {
        if (!this.aimingLine) return;
        this.aimingLine.clear();

        const raw = Math.atan2(y - this.cannon.y, x - this.cannon.x);
        const minA = -0.9 * Math.PI;
        const maxA = -0.1 * Math.PI;
        this.currentAngle = Phaser.Math.Clamp(raw, minA, maxA);

        const len = 400;
        const ex = this.cannon.x + Math.cos(this.currentAngle) * len;
        const ey = this.cannon.y + Math.sin(this.currentAngle) * len;
        this.aimingLine
            .lineStyle(3, 0xffffff, 0.7)
            .beginPath()
            .moveTo(this.cannon.x, this.cannon.y)
            .lineTo(ex, ey)
            .strokePath();
    }

    changeBubbleColor(dir) {
        this.currentBubbleIndex = (this.currentBubbleIndex + dir + this.bubbleColors.length) % this.bubbleColors.length;
        this.createNextBubble();
    }

    shootBubble() {
        if (!this.cannon || !this.nextBubble || this.shotBubble) return;

        this.upSound.play();
        this.shotBubble = this.nextBubble;
        this.nextBubble = null;

        const len = 80;
        this.shotBubble.x = this.cannon.x + Math.cos(this.currentAngle) * len;
        this.shotBubble.y = this.cannon.y + Math.sin(this.currentAngle) * len;
        this.shotBubble.body.moves = true;
        this.shotBubble.body.setVelocity(
            Math.cos(this.currentAngle) * this.bubbleSpeed,
            Math.sin(this.currentAngle) * this.bubbleSpeed
        );

        this.time.delayedCall(300, () => this.createNextBubble());
    }

    handleBubbleCollision(shotBubble, targetBubble) {
        if (shotBubble.getData('collided')) return;
        shotBubble.setData('collided', true);
        this.sys.cameras.main.shake(50, 0.01);
        shotBubble.body.setVelocity(0, 0);

        const row = targetBubble.getData('row');
        const col = targetBubble.getData('col');
        const adj = this.getAdjacentPositions(row, col);
        let best = null, bestDist = Infinity;

        for (const pos of adj) {
            if (this.isValid(pos.row, pos.col) && !this.bubbleGrid[pos.row][pos.col]) {
                const x = this.gridOffsetX + ((pos.row % 2) ? this.bubbleSize / 2 : 0) + pos.col * this.bubbleSize + this.bubbleSize / 2;
                const y = this.gridOffsetY + pos.row * this.bubbleSize + this.bubbleSize / 2;
                const d = Phaser.Math.Distance.Between(shotBubble.x, shotBubble.y, x, y);
                if (d < bestDist) {
                    bestDist = d;
                    best = pos;
                }
            }
        }

        if (!best) best = { row: row + 1, col: col };
        this.snapBubbleToGrid(shotBubble, best.row, best.col);
    }

    snapBubbleToGrid(bubble, row, col) {
        while (this.bubbleGrid.length <= row) this.bubbleGrid.push([]);

        const x = this.gridOffsetX + (row % 2 ? this.bubbleSize / 2 : 0) + col * this.bubbleSize + this.bubbleSize / 2;
        const y = this.gridOffsetY + row * this.bubbleSize + this.bubbleSize / 2;

        bubble.setPosition(x, y);
        if (bubble.body) {
            bubble.body.setVelocity(0, 0);
            bubble.setImmovable(true);
            bubble.body.moves = false;
        }

        bubble.setData('row', row).setData('col', col);
        this.bubbleGrid[row][col] = bubble;
        this.shotBubble = null;

        this.checkMatches(row, col, bubble.getData('color'));
    }

    getAdjacentPositions(r, c) {
        const even = r % 2 === 0;
        return [
            { row: r - 1, col: even ? c - 1 : c }, { row: r - 1, col: even ? c : c + 1 },
            { row: r, col: c - 1 }, { row: r, col: c + 1 },
            { row: r + 1, col: even ? c - 1 : c }, { row: r + 1, col: even ? c : c + 1 }
        ];
    }

    checkMatches(row, col, color) {
        const matches = this.findMatches(row, col, color, {});
        if (matches.length >= 3) {
            this.popSound.play({ volume: 1 });

            // score bump
            this.combinationCount++;
            this.combinationText.setText(`Score: ${this.combinationCount}`);

            // remove matched bubbles
            for (const { row, col } of matches) {
                this.bubbleGrid[row][col].destroy();
                this.bubbleGrid[row][col] = null;
            }

            // win check
            if (this.combinationCount >= this.targetScore) {
                this.time.delayedCall(100, () => this.endGame(true));
                return;
            }

            // drop floaters
            this.checkFloatingBubbles();
        }
    }

    checkFloatingBubbles() {
        const visited = {};
        const anchored = [...Array((this.bubbleGrid[0] || []).length).keys()].map(col => ({ row: 0, col }));
        anchored.forEach(({ row, col }) => this._mark(row, col, visited));

        for (let r = 0; r < this.bubbleGrid.length; r++) {
            for (let c = 0; c < (this.bubbleGrid[r] || []).length; c++) {
                if (this.bubbleGrid[r][c] && !visited[`${r},${c}`]) {
                    const b = this.bubbleGrid[r][c];
                    this.bubbleGrid[r][c] = null;
                    b.body.moves = true;
                    b.body.setVelocity(Phaser.Math.Between(-100, 100), 300);
                    this.sys.tweens.add({ targets: b, angle: Phaser.Math.Between(-360, 360), duration: 1500, ease: 'Power2' });
                    this.time.delayedCall(2000, () => b.destroy());
                }
            }
        }
    }

    _mark(r, c, vis) {
        const key = `${r},${c}`;
        if (vis[key] || !(this.bubbleGrid[r] || [])[c]) return;
        vis[key] = true;
        this.getAdjacentPositions(r, c).forEach(p => this._mark(p.row, p.col, vis));
    }

    checkBubblesReachedBottom() {
        const bottom = this.sys.cameras.main.height - 250;
        for (let r = 0; r < this.bubbleGrid.length; r++) {
            for (let c = 0; c < (this.bubbleGrid[r] || []).length; c++) {
                if (this.bubbleGrid[r][c]) {
                    const y = this.gridOffsetY + r * this.bubbleSize + this.bubbleSize / 2;
                    if (y >= bottom) return this.endGame(false);
                }
            }
        }
    }

    endGame(win) {
        if (this.gameOver) return;
        this.gameOver = true;
        if (this.timer) this.timer.remove();
        if (win) this.winScene();
        else this.gameOverScene();
    }

    isValid(r, c) {
        return r >= 0 && r < this.bubbleGrid.length && c >= 0 && c < (this.bubbleGrid[r] || []).length;
    }

    findMatches(row, col, color, visited = {}, matches = []) {
        if (row < 0 || row >= this.bubbleGrid.length || col < 0 || col >= (this.bubbleGrid[row] || []).length) {
            return matches;
        }

        const key = `${row},${col}`;
        const cell = this.bubbleGrid[row][col];
        if (visited[key] || !cell) return matches;
        if (cell.getData('color') !== color) return matches;

        visited[key] = true;
        matches.push({ row, col });
        for (const pos of this.getAdjacentPositions(row, col)) {
            this.findMatches(pos.row, pos.col, color, visited, matches);
        }
        return matches;
    }

    gameOverScene() {
        this.input.off('pointerup');
        this.input.keyboard.off('keydown-SPACE');

        this.add.image(this.sys.cameras.main.width / 2, this.sys.cameras.main.height / 2, 'ovrbg')
            .setDisplaySize(this.sys.cameras.main.width, this.sys.cameras.main.height);

        const blur = this.add.rectangle(0, 0, 1080, 1920, 0x000000, 0.5).setOrigin(0).setDepth(9);
        const gameOverText = this.add.text(
            540, 700,
            this.t('game_over_title', 'Game Over'),
            { font: "80px Outfit", color: "#FFFFFF" }
        ).setOrigin(0.5).setDepth(11);

        const combotext = this.add.text(
            540, 910,
            `${this.t('score_label', 'Score')}                             ${this.combinationCount}/${this.targetScore}`,
            { font: "70px Outfit", color: "#FFFFFF", align: "center" }
        ).setOrigin(0.5).setDepth(11);
        const restartButton = this.add.image(540, 1300, "replay_level").setInteractive().setScale(1).setDepth(10);
        const gameOverBox = this.add.image(540, 820, "game_over").setDepth(10).setScale(0.55, 0.8);

        restartButton.on("pointerdown", () => {
            restartButton.disableInteractive();
            this.disableInputEvents();

            blur.destroy();
            gameOverBox.destroy();
            gameOverText.destroy();
            combotext.destroy();

            if (this.timerText?.destroy) this.timerText.destroy();
            if (this.combinationText?.destroy) this.combinationText.destroy();

            this.combinationCount = 0;
            this.gameOver = false;

            this.scene.restart({ replay: true });
            this.sys.cameras.main.fadeIn(300, 0, 0, 0);
        });
    }

    menuScene() {
        this.add.image(this.sys.cameras.main.width / 2, this.sys.cameras.main.height / 2, 'htpbg')
            .setDisplaySize(this.sys.cameras.main.width, this.sys.cameras.main.height);

        // Pick any available bgm key (bgm / bgmusic / bg_music)
        if (!this.bgm) {
            const bgKeys = ['bgm', 'bgmusic', 'bg_music'];
            let chosenKey = null;

            for (const k of bgKeys) {
                if (this.cache.audio.exists(k)) {
                    chosenKey = k;
                    break;
                }
            }

            if (chosenKey) {
                this.bgm = this.sound.add(chosenKey, { loop: true, volume: 0.5 });
                this.bgm.play();
            } else {
                console.warn('No bgm found (bgm / bgmusic / bg_music) in audio cache.');
            }
        }


        this.gameState = "howToPlay";

        const blur = this.add.rectangle(0, 0, 1080, 1920, 0x000000, 0.5).setOrigin(0).setDepth(9);
        const howToPlayBox = this.add.image(540, 820, "http").setDepth(10).setScale(0.55, 0.8).setOrigin(0.5);
        const titleText = this.add.text(
            540, 570,
            this.t('how_to_play_title', 'How to Play'),
            { font: "80px Outfit", color: "#ffffff", align: "center" }
        ).setOrigin(0.5).setDepth(11);
        const img = this.add.image(540, 860, 'spherical').setDepth(60).setScale(1.2)
        const img1 = this.add.image(640, 860, 'spherical1').setDepth(60).setScale(1.2)
        const img2 = this.add.image(740, 860, 'spherical2').setDepth(60).setScale(1.2)
        const img3 = this.add.image(840, 860, 'spherical3').setDepth(60).setScale(1.2)
        const descriptionText = this.add.text(
            540, 800,
            this.t('how_to_play_desc', 'Swipe to aim, tap to shoot.\n\nMatch 3+:'),
            { font: "60px Outfit", color: "#ffffff", align: "left", wordWrap: { width: 800, useAdvancedWrap: true } }
        ).setOrigin(0.5).setDepth(11);
        const descriptionText1 = this.add.text(590, 860, `,`, {
            font: "60px Outfit", color: "#ffffff", align: "left", wordWrap: { width: 800, useAdvancedWrap: true },
        }).setOrigin(0.5).setDepth(11);
        const descriptionText2 = this.add.text(690, 860, `,`, {
            font: "60px Outfit", color: "#ffffff", align: "left", wordWrap: { width: 800, useAdvancedWrap: true },
        }).setOrigin(0.5).setDepth(11);
        const descriptionText3 = this.add.text(790, 860, `,`, {
            font: "60px Outfit", color: "#ffffff", align: "left", wordWrap: { width: 800, useAdvancedWrap: true },
        }).setOrigin(0.5).setDepth(11);
        const targetText = this.add.text(
            540, 1050,
            `${this.t('target_label', 'Target')}                                         ${this.targetScore}`,
            { font: "60px Outfit", color: "#ffffff", align: "left" }
        ).setOrigin(0.5).setDepth(11);

        const playButton = this.add.image(540, 1300, "play_game").setInteractive().setScale(1.1).setDepth(11);

        playButton.on('pointerdown', () => {
            blur.destroy();
            howToPlayBox.destroy();
            img.destroy();
            img1.destroy();
            img2.destroy();
            img3.destroy();
            titleText.destroy();
            descriptionText.destroy();
            descriptionText1.destroy();
            descriptionText2.destroy();
            descriptionText3.destroy();
            targetText.destroy();
            playButton.destroy();

            this.startScene();
            this.sys.cameras.main.fadeIn(500, 0, 0, 0);
        });
    }

    winScene() {
        this.input.off('pointerup');
        this.input.keyboard.off('keydown-SPACE');

        this.add.image(this.sys.cameras.main.width / 2, this.sys.cameras.main.height / 2, 'winbg')
            .setDisplaySize(this.sys.cameras.main.width, this.sys.cameras.main.height);

        const blur = this.add.rectangle(0, 0, 1080, 1920, 0x000000, 0.5).setOrigin(0).setDepth(9);
        const winText = this.add.text(
            575, 820,
            this.t('win_title', 'Level Completed'),
            { font: "70px Outfit", color: "#FFFFFF" }
        ).setOrigin(0.5).setDepth(11);
        const winBox = this.add.image(540, 820, "completed").setDepth(10).setScale(0.55, 0.8);

        const buttonY = 1020;
        const buttonSpacing = 230;

        const nextButton = this.add.image(540 - buttonSpacing, buttonY + 250, "next").setInteractive().setDepth(10);
        const replayButton = this.add.image(540 + buttonSpacing, buttonY + 250, "replay").setInteractive().setDepth(10);

        replayButton.on("pointerdown", () => {
            this.disableInputEvents();

            blur.destroy();
            winBox.destroy();
            winText.destroy();
            replayButton.destroy();
            nextButton.destroy();
            this.timerText.destroy();
            this.combinationText.destroy();

            this.combinationCount = 0;
            this.gameOver = false;

            this.scene.restart({ replay: true });
            this.sys.cameras.main.fadeIn(500, 0, 0, 0);
        });

        nextButton.on("pointerdown", () => {
            this.disableInputEvents();

            blur.destroy();
            winBox.destroy();
            winText.destroy();
            replayButton.destroy();
            nextButton.destroy();
            this.timerText.destroy();
            this.combinationText.destroy();

            this.combinationCount = 0;
            this.gameOver = false;

            this.notifyParent('sceneComplete', { result: 'win' });
            this.sys.cameras.main.fadeIn(500, 0, 0, 0);
        });

        this.gameState = "won";
        if (this.bgm && this.bgm.isPlaying) this.bgm.stop();
    }

    notifyParent(type, data) {
        if (window.parent !== window) {
            window.parent.postMessage({ type, ...data }, "*");
        }
    }
}
