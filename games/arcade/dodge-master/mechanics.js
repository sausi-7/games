export class AssetManager {
    constructor(scene) {
        this.scene = scene;
        this.fallbacks = {
            player: { type: 'eve' },
            obstacle: { type: 'bomb' },
            pause: { type: 'pauseBtn', size: 48, color: 0x888888 },
            background: { type: 'fill', color: 0x87CEEB }

        };
        this.inputLocked = true;


    }
    createFallback(key) {
        let f = this.fallbacks[key];
        if (!f) f = { type: 'rect', width: 48, height: 48, color: 0xff00ff };

        if (f.type === 'eve') {
            const sprite = this.scene.add.sprite(0, 0, 'eve').setOrigin(0.5, 1).setScale(1.7);
            sprite.play && sprite.anims && sprite.anims.play('idle', true);
            // sprite.radius = 48;
            return sprite;
        }

        if (f.type === 'bomb') {
            const img = this.scene.add.image(0, 0, 'bomb').setScale(0.3).setOrigin(0.5);
            img.width = 64;
            img.height = 64;
            return img;
        }

        let g = this.scene.add.graphics();
        if (f.type === 'circle') {
            g.fillStyle(f.color, 1);
            g.fillCircle(0, 0, f.radius);
        } else if (f.type === 'rect') {
            g.fillStyle(f.color, 1);
            g.fillRect(-f.width / 2, -f.height / 2, f.width, f.height);
        } else if (f.type === 'pauseBtn') {
            g.fillStyle(f.color, 1);
            g.fillCircle(0, 0, f.size / 2);
            g.fillStyle(0xffffff, 1);
            g.fillRect(-8, -f.size / 4 + 4, 10, f.size / 2 - 8);
            g.fillRect(8, -f.size / 4 + 4, 10, f.size / 2 - 8);
        } else if (f.type === 'fill') {
            g.fillStyle(f.color, 1);
            g.fillRect(0, 0, this.scene.scale.width, this.scene.scale.height);
        }
        return g;
    }

}

export default class ShapeDodgeScene extends Phaser.Scene {
    constructor() {
        super('ShapeDodgeScene');
        Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach((fn) => {
            if (typeof this[fn] === "function") this[fn] = this[fn].bind(this);
        });
        this.gameWidth = 1080;
        this.gameHeight = 1920;
        this.player = null;
        this.obstacles = null;
        this.score = 0;
        this.highScore = 0;
        this.spawnTimer = 0;
        this.spawnInterval = 700;
        this.obstacleSpeed = 350;
        this.lastSpeedIncrease = 0;
        this.state = 'INIT';
        this.assetManager = null;
        this.timeLeft = 120; // in seconds
        this.timerText = null;
        this.timerEvent = null;

    }

    preload() {
        // Load config.json and then all assets dynamically
        const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));
        this.load.json('levelConfig', `${basePath}/config.json`);

        this.load.once('filecomplete-json-levelConfig', () => {
            const cfg = this.cache.json.get('levelConfig');
            const spritesheets = cfg.spritesheets || {};
            const eveData = spritesheets.eve || {};
            const rawMain = new URLSearchParams(window.location.search).get('main') || '';
            const cleanMain = rawMain.replace(/^"|"$/g, '');
            const sheetUrl =
                cleanMain ||
                eveData.url ||
                `${basePath}/${eveData.path}`;
            const mechanics = cfg.mechanics || {};
            this.load.spritesheet('eve', sheetUrl, {
                frameWidth: eveData.frameWidth || 102,
                frameHeight: eveData.frameHeight || 158,
            }).on('error', () => console.error('Failed to load Eve spritesheet'));
            // Images
            if (cfg.images1) {
                Object.entries(cfg.images1).forEach(([key, url]) => {
                    this.load.image(key, `${basePath}/${url}`).on('error', () => {
                        console.error(`Failed to load image: ${key}`);
                    });
                });
            }
            if (cfg.images2) {
                Object.entries(cfg.images2).forEach(([key, url]) => {
                    this.load.image(key, `${basePath}/${url}`).on('error', () => {
                        console.error(`Failed to load image: ${key}`);
                    });
                });
            }
            if (cfg.ui) {
                Object.entries(cfg.ui).forEach(([key, url]) => {
                    this.load.image(key, `${basePath}/${url}`).on('error', () => {
                        console.error(`Failed to load image: ${key}`);
                    });
                });
            }
            // Audio
            if (cfg.audio) {
                for (const [key, url] of Object.entries(cfg.audio)) {
                    this.load.audio(key, `${basePath}/${url}`);
                }
            }
            this.load.once('complete', () => { this.assetsLoaded = true; });
            this.load.start();
        });
    }

    create() {
        if (screen.orientation && screen.orientation.lock) {
            screen.orientation.lock("portrait-primary").catch(() => { });
        }
        const cfg = this.cache.json.get("levelConfig") || {};
        const mechanics = cfg.mechanics || {};

        this.speedIncreaseInterval = mechanics.speedIncreaseInterval ?? 5000;
        this.speedIncreaseAmount = mechanics.speedIncreaseAmount ?? 40;
        this.targetScore = mechanics?.targetScore || 100;

        this.assetManager = new AssetManager(this);
        // this.sys.cameras.main.setBackgroundColor('#87CEEB');
        this.add.image(540, 960, 'background');
        this.sound.add('bgm', { loop: true, volume: 0.5 }).play();

        this.score = 0;
        this.highScore = parseInt(localStorage.getItem('shapedodge_highscore') || '0');
        this.scoreText = this.add.text(200, 33, 'Score: 0', {
            font: '50px outfit',
            color: '#fff'
        }).setOrigin(0.5, 0).setDepth(10);

        this.timerText = this.add.text(1000, 33, 'Time Left: 02:00', {
            font: '50px outfit',
            color: '#fff'
        }).setOrigin(1, 0).setDepth(10);

        this.targettext = this.add.text(470, 33, `Target: ${this.targetScore}`, {
            font: '50px outfit',
            color: '#fff'
        }).setOrigin(0.5, 0).setDepth(10);


        // this.pauseBtn = this.assetManager.createFallback('pause');
        // this.pauseBtn.setPosition(this.gameWidth - 80, 80);
        // this.pauseBtn.setInteractive(new Phaser.Geom.Circle(0, 0, 32), Phaser.Geom.Circle.Contains);
        // this.pauseBtn.on('pointerdown', () => this.togglePause());

        this.anims.create({
            key: 'idle',
            frames: this.anims.generateFrameNumbers('eve', { start: 18, end: 18 }),
            frameRate: 5,
            repeat: -1
        });


        this.player = this.assetManager.createFallback('player');
        this.player.setPosition(this.gameWidth / 2, this.gameHeight - 80);
        this.player.radius = 48;
        this.player.setDepth(10);

        this.obstacles = this.add.group();

        let ground = this.add.graphics();
        ground.fillStyle(0x000000, 0.09);
        ground.fillEllipse(this.gameWidth / 2, this.gameHeight - 100, 350, 28);

        this.pauseOverlay = this.add.rectangle(this.gameWidth / 2, this.gameHeight / 2, this.gameWidth, this.gameHeight, 0x000000, 0.35)
            .setVisible(false).setDepth(50);
        this.pauseText = this.add.text(this.gameWidth / 2, this.gameHeight / 2, 'PAUSED', {
            fontFamily: 'Arial', font: '128px', color: '#fff', stroke: '#222', strokeThickness: 6
        }).setOrigin(0.5).setDepth(51).setVisible(false);

        this.gameOverPanel = this.add.container(this.gameWidth / 2, this.gameHeight / 2).setDepth(100).setVisible(false);
        let goBg = this.add.rectangle(0, 0, 700, 600, 0xffffff, 0.92).setStrokeStyle(8, 0x222222);
        let goText = this.add.text(0, -120, 'GAME OVER', {
            font: '50px', color: '#ffffffff'
        }).setOrigin(0.5);
        this.finalScoreText = this.add.text(0, 10, '', {
            fontFamily: 'Arial', font: '64px', color: '#333', stroke: '#fff', strokeThickness: 2
        }).setOrigin(0.5);
        this.highScoreText = this.add.text(0, 100, '', {
            fontFamily: 'Arial', font: '48px', color: '#222'
        }).setOrigin(0.5);
        let retryBtn = this.add.rectangle(0, 200, 220, 80, 0x32ff4d, 1).setInteractive();
        let retryText = this.add.text(0, 200, 'RETRY', {
            fontFamily: 'Arial', font: '48px', color: '#fff', stroke: '#222', strokeThickness: 3
        }).setOrigin(0.5);
        retryBtn.on('pointerdown', () => this.restartGame());
        this.gameOverPanel.add([goBg, goText, this.finalScoreText, this.highScoreText, retryBtn, retryText]);
        this.input.on('pointermove', (pointer) => {
            if (this.state !== 'PLAY' || this.paused || this.inputLocked) return;
            if (pointer.x > this.gameWidth - 140 && pointer.y < 160) return;
            let newX = Phaser.Math.Clamp(pointer.x, 48, this.gameWidth - 48);
            this.player.x = newX;
        });

        this.input.on('pointerdown', (pointer) => {
            if (this.state !== 'PLAY' || this.paused || this.inputLocked) return;
            if (pointer.x > this.gameWidth - 140 && pointer.y < 160) return;
            let newX = Phaser.Math.Clamp(pointer.x, 48, this.gameWidth - 48);
            this.player.x = newX;
        });


        this.input.addPointer(2);
        this.createUI()

        this.htpContainer = this.add.container(this.gameWidth / 2, this.gameHeight / 2).setDepth(1000);

        let htpBg = this.add.image(0, 0, 'htpbox');
        let htpText = this.add.text(0, 0, 'Swipe to move and dodge the falling\nobjects. Reach the target score before\nthe timer runs out.', {
            font: '50px outfit',
            color: '#fff',

        }).setOrigin(0.5);

        let playBtn = this.add.image(0, 630, 'playbtn').setInteractive();

        playBtn.on('pointerdown', () => {
            this.htpContainer.setVisible(false);
            this.inputLocked = false; // ✅ unlock input
            this.startGame();
        });


        this.htpContainer.add([htpBg, htpText, playBtn]);


        // this.startGame();
    }

    startGame() {
        this.input.enabled = true; // ✅ re-enable just in case
        this.state = 'PLAY';
        const cfg = this.cache.json.get("levelConfig") || {};
        const mechanics = cfg.mechanics || {};
        this.state = 'PLAY';
        this.score = 0;
        this.updateScoreText();
        this.spawnInterval = mechanics.spawnInterval ?? 700;
        this.obstacleSpeed = mechanics.obstacleSpeed ?? 350;
        this.lastSpeedIncrease = this.time ? this.time.now : 0;
        this.spawnTimer = 0;
        this.clearObstacles();
        this.player.x = this.gameWidth / 2;
        this.player.setVisible(true);
        this.gameOverPanel.setVisible(false);
        this.pauseOverlay.setVisible(false);
        this.pauseText.setVisible(false);
        this.sys.cameras.main.shake(0, 0);
        this.lastScoreUpdate = null;
        this.paused = false;
        this.timeLeft = 120;
        this.updateTimerDisplay();
        if (this.timerEvent) this.timerEvent.remove();
        this.timerEvent = this.time.addEvent({
            delay: 1000,
            callback: () => {
                if (this.paused || this.state !== 'PLAY') return;
                this.timeLeft--;
                this.updateTimerDisplay();
                if (this.timeLeft <= 0) this.onGameOver();
            },
            loop: true
        });

    }
    updateTimerDisplay() {
        const min = String(Math.floor(this.timeLeft / 60)).padStart(2, '0');
        const sec = String(this.timeLeft % 60).padStart(2, '0');
        this.timerText.setText(`Time Left: ${min}:${sec}`);
    }


    togglePause() {
        if (this.state !== 'PLAY') return;
        this.paused = !this.paused;
        this.pauseOverlay.setVisible(this.paused);
        this.pauseText.setVisible(this.paused);
    }

    clearObstacles() {
        this.obstacles.getChildren().forEach(ob => { ob.destroy(); });
        this.obstacles.clear(true);
    }

    updateScoreText() {
        this.scoreText.setText('Score: ' + this.score);
    }

    update(time, delta) {
        if (this.state !== 'PLAY' || this.paused) return;

        this.spawnTimer += delta;
        if (this.spawnTimer > this.spawnInterval) {
            this.spawnObstacle();
            this.spawnTimer = 0;
        }

        if (time - this.lastSpeedIncrease > this.speedIncreaseInterval) {
            this.obstacleSpeed += this.speedIncreaseAmount;
            this.spawnInterval = Math.max(350, this.spawnInterval - 45);
            this.lastSpeedIncrease = time;
        }

        let toRemove = [];
        this.obstacles.getChildren().forEach(ob => {
            ob.y += this.obstacleSpeed * delta / 1000;
            if (ob.y > this.gameHeight + 50) {
                toRemove.push(ob);
            } else if (this.checkCollision(ob, this.player)) {
                this.sound.add('collision', { volume: 0.5 }).play();

                this.onGameOver();
            }
        });
        toRemove.forEach(ob => ob.destroy());

        if (!this.lastScoreUpdate) this.lastScoreUpdate = time;
        if (time - this.lastScoreUpdate >= 1000) {
            this.score++;
            this.updateScoreText();
            this.lastScoreUpdate = time;
        }

        if (this.score >= this.targetScore) {
            this.onWin();
        }



    }

    onWin() {
        if (this.state !== 'PLAY') return;
        this.state = 'WIN';

        // Stop timers and obstacle logic
        if (this.timerEvent) this.timerEvent.remove();
        this.timerEvent = null;

        this.paused = true;
        this.player.setVisible(false);
        this.clearObstacles();

        // Camera flash and win panel after delay
        this.sys.cameras.main.flash(250, 255, 255, 255);

        // ✨ DO NOT disable input globally
        // this.input.enabled = false;  ❌ REMOVE this line

        setTimeout(() => this.showWinScene(), 400);
    }


    notifyParent(type, data) {
        if (window.parent !== window) {
            window.parent.postMessage({ type, ...data }, "*");
        }
    }
    showWinScene() {
        const panel = this.add.container(this.gameWidth / 2, this.gameHeight / 2).setDepth(200);
        const bg = this.add.image(0, 0, 'lvlbox');

        const title = this.add.text(0, 0, 'YOU WIN!', {
            font: '50px outfit',
            color: '#ffffffff',
            stroke: '#000',
            strokeThickness: 5
        }).setOrigin(0.5);

        // const stats = this.add.text(0, 20, `Score: ${this.score}`, {
        //     font: '50px outfit', color: 'white'
        // }).setOrigin(0.5);

        const btnReplay = this.add.image(-240, 350, 'lvl_replay').setInteractive();
        const btnNext = this.add.image(240, 350, 'next').setInteractive();
        panel.add([bg, title, btnReplay, btnNext]);

        btnReplay.on('pointerdown', () => {
            panel.destroy(true);
            this.input.enabled = true; // re-enable input
            this.restartGame();
        });

        btnNext.on('pointerdown', () => this.notifyParent('sceneComplete', { result: 'win' }));



    }


    spawnObstacle() {
        let x = Phaser.Math.Between(48, this.gameWidth - 48);
        let y = -32;
        let ob = this.assetManager.createFallback('obstacle');
        ob.setPosition(x, y);
        ob.setDepth(5);
        ob.radius = 32;  // adjust based on bomb1 size
        ob.width = 64;
        ob.height = 74;

        this.obstacles.add(ob);
    }

    checkCollision(ob, player) {
        let cx = player.x, cy = player.y, cr = player.radius;
        let rx = ob.x - ob.width / 2, ry = ob.y - ob.height / 2, rw = ob.width, rh = ob.height;
        let testX = cx;
        let testY = cy;
        if (cx < rx) testX = rx;
        else if (cx > rx + rw) testX = rx + rw;
        if (cy < ry) testY = ry;
        else if (cy > ry + rh) testY = ry + rh;
        let dist = Phaser.Math.Distance.Between(cx, cy, testX, testY);
        return dist <= cr;
    }

    onGameOver() {
        this.state = 'GAMEOVER';
        this.sys.cameras.main.shake(200, 0.04, true);
        this.player.setVisible(false);
        setTimeout(() => this.showGameOverPanel(), 400);
    }

    showGameOverPanel() {
        this.gameOverPanel.removeAll(true);
        let bg = this.add.image(0, 0, 'ovrbox');
        let title = this.add.text(0, 0, 'TRY AGAIN!', {
            font: '50px outfit', color: '#fafafaff'
        }).setOrigin(0.5);

        // let scoreText = this.add.text(0, 10, 'SCORE: ' + this.score, {
        //     fontFamily: 'Arial', font: '64px', color: 'white'
        // }).setOrigin(0.5);

        let btn = this.add.image(0, 380, 'replay').setInteractive();
        btn.on('pointerdown', () => this.restartGame());

        this.gameOverPanel.add([bg, title, btn]);
        this.gameOverPanel.setVisible(true);

    }

    restartGame() {
        this.startGame();
    }

    createUI() {

        this.textBox = this.add.image(540, 60, 'scorebar')
            .setScrollFactor(0)
            .setDepth(9)
            .setScale(1)
            .setOrigin(0.5);
    }
}
