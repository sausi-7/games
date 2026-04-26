export default class MainScene extends Phaser.Scene {
    constructor() {
        super('MainScene');
        Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach(fn => {
            if (typeof this[fn] === 'function') this[fn] = this[fn].bind(this);
        });

        this.state = 'start';
        this.totalTime = 60;
        this.timerEvent = null;
        this.timerText = null;
        this.config = null;
        this.basePath = null;

        // Defaults (will be overridden by config.mechanics)
        this.rows = 4;
        this.cols = 4;
    }

    preload() {
        this.basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));
        this.load.json('levelConfig', `${this.basePath}/config.json`);

        this.load.once('filecomplete-json-levelConfig', () => {
            this.config = this.cache.json.get('levelConfig');
            console.log('Config Loaded:', this.config);

            if (!this.config) {
                console.error('Missing config.json');
                return;
            }

            const loadImageMap = (map) => {
                if (!map) return;
                for (const [key, url] of Object.entries(map)) {
                    if (typeof url === 'string') {
                        this.load.image(key, `${this.basePath}/${url}`);
                    }
                }
            };

            loadImageMap(this.config.images2);
            loadImageMap(this.config.ui);
            loadImageMap(this.config.tiles);

            if (this.config.spritesheets) {
                for (const [key, sheet] of Object.entries(this.config.spritesheets)) {
                    if (sheet?.url && sheet?.frameWidth && sheet?.frameHeight) {
                        this.load.spritesheet(key, `${this.basePath}/${sheet.url}`, {
                            frameWidth: sheet.frameWidth,
                            frameHeight: sheet.frameHeight
                        });
                    }
                }
            }

            if (this.config.audio) {
                for (const [key, url] of Object.entries(this.config.audio)) {
                    if (typeof url !== 'string') continue;
                    const audioUrl =
                        /^https?:\/\//i.test(url) || url.startsWith('//')
                            ? url
                            : `${this.basePath}/${url}`;

                    this.load.audio(key, audioUrl).on('error', () => {
                        console.error(`Failed to load audio "${key}" from ${audioUrl}`);
                    });
                }
            }

            this.load.start();
        });
    }

    create() {
        if (!this.config) {
            console.error('Config not loaded properly!');
            return;
        }

        // Orientation lock
        if (this.config.orientation && screen.orientation && screen.orientation.lock) {
            const orientation = this.config.orientation.frame || 'portrait-primary';
            screen.orientation.lock(orientation).catch(() => {});
        }

        // Read mechanics from config
        const mech = this.config.mechanics || {};
        this.totalTime = mech.startTime ?? 60;

        // 🔹 NEW: read rows/cols from mechanics
        this.rows = mech.rows ?? 4;
        this.cols = mech.cols ?? 4;

        // Ensure even number of tiles
        const totalTiles = this.rows * this.cols;
        if (totalTiles % 2 !== 0) {
            console.warn(
                `Grid ${this.rows}x${this.cols} has odd number of tiles (${totalTiles}). ` +
                `Memory games need an even number; last tile will be unused.`
            );
        }

        // Background music (unchanged)
        if (!this.bgmusic) {
            const bgKeys = ['bgmusic', 'bg_music', 'bgm'];
            let chosenKey = null;
            for (const k of bgKeys) {
                if (this.cache.audio.exists(k)) {
                    chosenKey = k;
                    break;
                }
            }
            if (chosenKey) {
                this.bgmusic = this.sound.add(chosenKey, { loop: true, volume: 0.5 });
                this.bgmusic.play();
            } else {
                console.warn('No background music found (bgmusic / bg_music / bgm).');
            }
        }

        this.showStartScreen();
    }

    showStartScreen() {
        this.clearScene();
        this.state = 'start';

        const centerX = this.sys.scale.width / 2;
        const centerY = this.sys.scale.height / 2;

        this.startOverlay = this.add.container(0, 0);
        const texts = this.config.texts || {};

        const bg = this.add.image(centerX, centerY + 10, 'htpbg')
            .setDisplaySize(this.sys.scale.width, this.sys.scale.height);

        const dialogBg = this.add.image(540, 900, 'dialog_bg_start').setDisplaySize(
            Math.min(1200, this.scale.width - 40),
            Math.min(600, this.scale.height - 200)
        )
            .setOrigin(0.5)
            .setScrollFactor(0)
            .setDepth(0);

        const titleText = this.add.text(530, 650, texts.title || 'How to Play', {
            font: '70px outfit',
            fill: '#fff',
            wordWrap: { width: 600 }
        }).setOrigin(0.5, 0).setDepth(3);

        const howToPlayText = this.add.text(
            190,
            840,
            texts.instructions || 'Find and match the same\nnumbers on hidden tiles to\nclear the grid.',
            { font: '60px outfit', align: 'center' }
        );

        const playButton = this.add.sprite(centerX, centerY + 370, 'playButton').setInteractive();
        playButton.on('pointerdown', () => {
            if (this.cache.audio.has('click')) this.sound.play('click');
            this.startGame();
        });

        this.startOverlay.add([bg, dialogBg, titleText, howToPlayText, playButton]);
    }

    createTimerUI() {
        // Always read startTime from config
        this.totalTime = this.config?.mechanics?.startTime ?? 60;

        this.add.image(this.sys.scale.width - 500, 150, 'timer-bg')
            .setOrigin(0.5);

        this.add.image(this.sys.scale.width - 310, 147, 'timer-icon');

        this.timerText = this.add.text(this.sys.scale.width - 630, 120, 'Time: 01:00', {
            font: '50px outfit',
            fill: '#000'
        });

        this.timerEvent = this.time.addEvent({
            delay: 1000,
            callback: this.updateTimer,
            callbackScope: this,
            loop: true
        });
    }

    updateTimer() {
        this.totalTime--;

        const minutes = Math.floor(this.totalTime / 60);
        const seconds = this.totalTime % 60;
        const formatted = `Time: ${minutes.toString().padStart(2, '0')}:${seconds
            .toString()
            .padStart(2, '0')}`;
        this.timerText.setText(formatted);

        if (this.totalTime <= 0) {
            this.timerEvent.remove(false);
            this.showGameOverScreen();
        }
    }

    startGame() {
        this.clearScene();
        this.state = 'game';

        this.matchedTiles = 0;
        this.tiles = [];
        this.revealedTiles = [];

        // 🔹 Use rows/cols from config
        const rows = this.rows;
        const cols = this.cols;
        const totalTiles = rows * cols;

        // Build list of card texture keys
        const allCardKeys = Object.keys(this.config?.images2 || {})
            .filter(k => /^card\d+$/i.test(k))
            .sort((a, b) => {
                const na = parseInt(a.replace(/\D/g, ''), 10);
                const nb = parseInt(b.replace(/\D/g, ''), 10);
                return na - nb;
            });

        const numPairsNeeded = Math.floor(totalTiles / 2);

        if (allCardKeys.length < numPairsNeeded) {
            console.error(
                `Not enough card images: need ${numPairsNeeded}, found ${allCardKeys.length}`
            );
        }

        // Take only as many card keys as we need
        const cardKeys = allCardKeys.slice(0, numPairsNeeded);

        // Create pairs
        this.cardImages = [];
        cardKeys.forEach(k => {
            this.cardImages.push(k, k);
        });

        // If totalTiles is odd, one tile will never be used (that’s okay or you can handle specially)
        Phaser.Utils.Array.Shuffle(this.cardImages);

        // Background + grid
        this.add.image(this.sys.scale.width / 2, this.sys.scale.height / 2, 'background')
            .setDisplaySize(this.sys.scale.width, this.sys.scale.height);
        this.add.image(this.sys.scale.width / 2, this.sys.scale.height / 2, 'grid_bg')
            .setDisplaySize(940, 970);

        this.add.image(this.sys.scale.width / 2 + 300, this.sys.scale.height / 2 - 370, 'popbars')
            .setScale(1.5);

        const spacing = 210;
        const tileSize = 100;

        // 🔹 Compute grid width/height using rows & cols
        const gridPixelWidth = (cols - 1) * spacing + tileSize;
        const gridPixelHeight = (rows - 1) * spacing + tileSize;

        const startX = (this.sys.scale.width - gridPixelWidth) / 2 + tileSize / 2;
        const startY = (this.sys.scale.height - gridPixelHeight) / 2 + 240;

        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                // If we somehow ran out of cards (odd tiles etc.), skip making extra tiles
                if (this.cardImages.length === 0) continue;

                const x = startX + col * spacing;
                const y = startY + row * spacing;

                const tile = this.add
                    .sprite(x, y - 200, 'tile')
                    .setInteractive()
                    .setScale(1);

                tile.card = this.cardImages.pop(); // e.g. 'card3'
                tile.revealed = false;
                tile.on('pointerdown', () => this.revealTile(tile));
                this.tiles.push(tile);
            }
        }

        this.createTimerUI();
    }

    revealTile(tile) {
        if (tile.revealed || this.revealedTiles.length >= 2 || this.state !== 'game') return;
        if (this.cache.audio.has('flip')) this.sound.play('flip');

        tile.disableInteractive();

        this.tweens.add({
            targets: tile,
            scaleX: 0,
            duration: 150,
            ease: 'Linear',
            onComplete: () => {
                tile.setTexture(tile.card).setScale(0, 0.2);
                this.tweens.add({
                    targets: tile,
                    scaleX: 0.2,
                    duration: 150,
                    ease: 'Linear',
                    onComplete: () => {
                        tile.revealed = true;
                        this.revealedTiles.push(tile);
                        tile.setInteractive();
                        if (this.revealedTiles.length === 2) {
                            this.time.delayedCall(500, this.checkMatch, [], this);
                        }
                    }
                });
            }
        });
    }

    checkMatch() {
        const [tile1, tile2] = this.revealedTiles;

        if (tile1.card === tile2.card) {
            if (this.cache.audio.has('match')) this.sound.play('match');
            tile1.disableInteractive();
            tile2.disableInteractive();

            this.tweens.add({
                targets: [tile1, tile2],
                alpha: 0,
                scaleX: 0.1,
                scaleY: 0.1,
                duration: 300,
                ease: 'Sine.easeOut',
                onComplete: () => {
                    this.matchedTiles += 2;
                    if (this.matchedTiles === this.tiles.length) {
                        this.showWinScreen();
                        return;
                    }
                    this.revealedTiles = [];
                }
            });
        } else {
            if (this.cache.audio.has('wrong')) this.sound.play('wrong');

            tile1.disableInteractive();
            tile2.disableInteractive();

            this.tweens.add({
                targets: [tile1, tile2],
                scaleX: 0,
                duration: 150,
                ease: 'Linear',
                onComplete: () => {
                    tile1.setTexture('tile').setScale(0, 1);
                    tile2.setTexture('tile').setScale(0, 1);
                    this.tweens.add({
                        targets: [tile1, tile2],
                        scaleX: 1,
                        duration: 150,
                        ease: 'Linear',
                        onComplete: () => {
                            tile1.revealed = false;
                            tile2.revealed = false;
                            tile1.setInteractive();
                            tile2.setInteractive();
                            this.revealedTiles = [];
                        }
                    });
                }
            });
        }
    }

    showGameOverScreen() {
        this.clearScene();
        this.state = 'gameover';
        if (this.cache.audio.has('gameover')) this.sound.play('gameover');

        this.gameOverOverlay = this.add.container(0, 0);

        const bg = this.add.image(this.sys.scale.width / 2, this.sys.scale.height / 2, 'ovrbg')
            .setDisplaySize(this.sys.scale.width, this.sys.scale.height);

        const title = this.add.text(this.sys.scale.width / 2, 760, 'Game Over', {
            font: '70px outfit',
            fill: '#fff'
        }).setOrigin(0.5, 0).setDepth(5);

        const banner = this.add.image(540, 800, 'dialog_bg_start')
            .setDisplaySize(800, 400)
            .setOrigin(0.5)
            .setScrollFactor(0)
            .setDepth(0);

        const retry = this.add.sprite(this.sys.scale.width / 2, 1150, 'retryButton').setInteractive();
        retry.on('pointerdown', () => this.startGame());

        this.gameOverOverlay.add([bg, banner, title, retry]);
    }

    showWinScreen() {
        this.clearScene();
        this.state = 'win';
        if (this.cache.audio.has('win')) this.sound.play('win');

        this.winOverlay = this.add.container(0, 0);

        const bg = this.add.image(this.sys.scale.width / 2, this.sys.scale.height / 2, 'winbg')
            .setDisplaySize(this.sys.scale.width, this.sys.scale.height);

        const winText = this.add.text(this.sys.scale.width / 2, 900, 'Level Completed', {
            font: 'bold 70px outfit',
            fill: '#fff',
            wordWrap: { width: 800 }
        }).setOrigin(0.5, 0).setDepth(1);

        const banner = this.add.image(540, 940, 'level_complete').setDisplaySize(1000, 400);

        const nextImage = this.add.sprite(300, 1250, 'next_button').setInteractive();
        nextImage.on('pointerdown', () => {
            if (this.cache.audio.has('click')) this.sound.play('click');
            this.notifyParent('sceneComplete', { result: 'win' });
        });

        const playAgain = this.add.sprite(800, 1250, 'replay_button').setInteractive();
        playAgain.on('pointerdown', () => {
            if (this.cache.audio.has('click')) this.sound.play('click');
            this.startGame();
        });

        this.winOverlay.add([bg, banner, winText, nextImage, playAgain]);
    }

    notifyParent(type, data) {
        if (window.parent !== window) {
            window.parent.postMessage({ type, ...data }, '*');
        }
    }

    clearScene() {
        if (this.startOverlay) { this.startOverlay.destroy(); this.startOverlay = null; }
        if (this.winOverlay) { this.winOverlay.destroy(); this.winOverlay = null; }
        if (this.gameOverOverlay) { this.gameOverOverlay.destroy(); this.gameOverOverlay = null; }
    }
}
