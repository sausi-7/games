export default class MechanicsScene extends Phaser.Scene {
    constructor() {
        super({ key: 'MechanicsScene' });
        Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach(fn => {
            if (typeof this[fn] === 'function') {
                this[fn] = this[fn].bind(this);
            }
        });
        this.player = null;
        this.joystick = null;
        this.score = 0;
        this.gameStarted = false;
        this.backgroundMusic = null;


        this.battery = 100;
        this.shield = 100;
    }

    preload() {
        const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));
        this.load.json('levelConfig', `${basePath}/config.json`);

        this.load.once('filecomplete-json-levelConfig', () => {
            const cfg = this.cache.json.get('levelConfig');
            const sheets = cfg.sheets || {};
            const heroData = sheets.hero || {};
            const rawMain = new URLSearchParams(window.location.search).get('main') || '';
            const cleanMain = rawMain.replace(/^"|"$/g, '');
            const sheetUrl =
                cleanMain ||
                heroData.url ||
                `${basePath}/assets/hero.png`;

            const frameW = heroData.frameWidth || 103;
            const frameH = heroData.frameHeight || 160;
            this.load.spritesheet('hero', sheetUrl, {
                frameWidth: frameW,
                frameHeight: frameH,
            });

            // Load boss spritesheet for boss and boss2
            this.load.spritesheet('boss', `${basePath}/assets/hero.png`, {
                frameWidth: 500,
                frameHeight: 600
            });

            // Optional load failure logger
            this.load.on('loaderror', (file) => {
                console.warn('Failed to load:', file.key, file.src);
            });

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


            if (cfg.audio) {
                for (const [key, url] of Object.entries(cfg.audio)) {
                    console.log(`Loading audio: ${key} from ${basePath}/${url}`);
                    this.load.audio(key, `${basePath}/${url}`);
                }
            }

            this.load.start();
        });
    }
    init() {
        this.resetCoreState();
    }

    resetCoreState() {
        this.score = 0;
        this.gameStarted = false;
        this.battery = 100;
        this.shield = 100;
        this.batteryDead = false;
    }

    notifyParent(type, data) {
        if (window.parent !== window) {
            window.parent.postMessage({ type, ...data }, "*");
        }
    }

    create() {

        this.resetCoreState();
        const levelData = this.cache.json.get('levelConfig');
        this.levelData = levelData; // Keep for endLevel

        // Apply orientation from config
        if (levelData.orientation?.frame === 'landscape' && screen.orientation && screen.orientation.lock) {
            screen.orientation
                .lock('landscape-primary')
                .catch(err => console.warn('Orientation lock failed:', err));
        }
        this.physics.world.gravity.y = 0;

        const cfg = this.cache.json.get('levelConfig');
        this.add.image(960, 540, 'background');
        this.add.image(960, 50, 'scorebar')

        // Player
        this.player = this.physics.add.sprite(960, 540, 'hero', 19).setCollideWorldBounds(true).setScale(1.5);
        // this.player.setFlipX(true); 

        this.player.setDamping(true).setDrag(0.98).setMaxVelocity(300);
        this.player.lastHit = 0;

        // Controls
        this.cursors = this.input.keyboard.createCursorKeys();
        this.beamKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

        // Mobile joystick
        this.createJoystick();

        // UI
        this.createUI();

        // Junk
        this.junkGroup = this.physics.add.group();
        this.spawnJunk();

        this.asteroidGroup = this.physics.add.group();
        this.satelliteGroup = this.physics.add.group();
        this.spawnAsteroids();
        this.spawnSatellites();

        // Player collisions with hazards
        this.physics.add.collider(this.player, this.asteroidGroup, this.hitObstacle, null, this);
        this.physics.add.collider(this.player, this.satelliteGroup, this.hitObstacle, null, this);


        // Audio
        this.collectSound = this.sound.add('collect');
        this.vacuumSound = this.sound.add('vacuum');
        this.hitSound = this.sound.add('hit');

        // Collision
        this.physics.add.overlap(this.player, this.junkGroup, this.collectJunk, null, this);
        // this.win();
        this.showMenu();

    }

    showMenu() {
        this.menuContainer = this.add.container(0, 0);

        // Add background box first, at lower depth
        const htpbox = this.add.image(960, 500, 'htpbox').setOrigin(0.5).setScale(1).setDepth(10);

        // Add the text after, with higher depth
        const howToPlay = this.add.text(860, 500, 'Use joystick to move.\nCollect junk to score and recharge battery.\nAvoid asteroids and satellites.\nBattery drains while moving.', {
            font: '50px outfit',
            fill: '#ffffff',
            lineSpacing: 15
        }).setOrigin(0.5).setDepth(15);

        const playButton = this.add.image(960, 930, 'playbtn').setInteractive().setOrigin(0.5).setDepth(20);

        playButton.on('pointerdown', () => {
            this.menuContainer.destroy();
            this.gameStarted = true;
            // Play background music if not already playing
            if (!this.backgroundMusic) {
                this.backgroundMusic = this.sound.add('background_music', { loop: true, volume: 0.6 });
                this.backgroundMusic.play();
            } else {
                this.backgroundMusic.resume();
            }
            this.physics.resume();
        });


        this.menuContainer.add([htpbox, howToPlay, playButton]);

        this.physics.pause(); // Pause physics until play
        this.gameStarted = false;
    }



    spawnAsteroids() {
        for (let i = 0; i < 5; i++) {
            const x = Phaser.Math.Between(200, 1720);
            const y = Phaser.Math.Between(200, 880);
            const asteroid = this.asteroidGroup.create(x, y, 'asteroid');

            asteroid.setVelocity(Phaser.Math.Between(-50, 50), Phaser.Math.Between(-50, 50));
            asteroid.setBounce(1).setCollideWorldBounds(true).setMaxVelocity(150);
            asteroid.setAngularVelocity(Phaser.Math.Between(-30, 30)); // optional: spinning

            asteroid.setCircle(80); // Assuming 160x160 asset
        }
    }


    hitObstacle(player, hazard) {

        if (!player.lastHit || this.time.now - player.lastHit > 1000) {
            this.shield -= 20;
            this.shield = Math.max(this.shield, 0);
            this.shieldBar.setText(`Shield: ${this.shield}%`);
            this.hitSound.play();

            this.sys.cameras.main.flash(100, 255, 0, 0);

            if (this.shield <= 0) {
                this.gameOver('Try Again!');
            }


            player.lastHit = this.time.now;
        }
    }



    gameOver(reason = 'Try Again!') {
        if (this.backgroundMusic) {
            this.backgroundMusic.pause(); // or .stop() if you want to restart from beginning next time
        }

        this.physics.pause();
        this.player.setVelocity(0);

        // Add background first, at lower depth
        this.add.image(960, 540, 'ovrbox').setOrigin(0.5).setDepth(5);

        // Add text above background with stylish options
        const gameOverText = this.add.text(960, 540, reason, {
            font: '50px outfit', // Fallback to Arial Black if Outfit isn't loaded                 // Larger, bold font
            color: '#ffffffff',                  // Bright yellow
            stroke: '#1b2233',                 // Dark outline for contrast
            strokeThickness: 10,
            shadow: {
                offsetX: 4,
                offsetY: 4,
                color: '#000',
                blur: 12,
                fill: true
            },
            align: 'center'
        })
            .setOrigin(0.5)
            .setDepth(10);

        // Add replay button above all
        this.add.image(960, 900, 'replay').setOrigin(0.5).setDepth(10).setInteractive().on('pointerdown', () => {
            this.sound.stopAll();
            this.scene.restart();
        });
    }




    spawnSatellites() {
        for (let i = 0; i < 3; i++) {
            const x = Phaser.Math.Between(300, 1600);
            const y = Phaser.Math.Between(300, 800);
            const satellite = this.satelliteGroup.create(x, y, 'object');

            satellite.setImmovable(false); // Important for motion
            satellite.setVelocity(Phaser.Math.Between(-20, 20), Phaser.Math.Between(-20, 20));
            satellite.setBounce(1).setCollideWorldBounds(true).setMaxVelocity(100);
            satellite.setAngularVelocity(Phaser.Math.Between(-20, 20)); // optional: spinning

        }
    }


    createJoystick() {
        this.joystick = {
            base: this.add.image(200, 880, 'joystick_base')
                .setScrollFactor(0)
                .setAlpha(0.4)
                .setDepth(10)
                .setVisible(false),
            thumb: this.add.image(200, 880, 'joystick_thumb')
                .setScrollFactor(0)
                .setDepth(11)
                .setVisible(false),
            pointerId: null,
            force: 0,
            angle: 0
        };

        this.input.on('pointerdown', pointer => {
            if (pointer.x < this.sys.scale.width / 2 && this.joystick.pointerId === null) {
                this.joystick.pointerId = pointer.id;
                this.joystick.base.setPosition(pointer.x, pointer.y).setVisible(true);
                this.joystick.thumb.setPosition(pointer.x, pointer.y).setVisible(true);
            }
        });

        this.input.on('pointerup', pointer => {
            if (pointer.id === this.joystick.pointerId) {
                this.resetJoystick();
            }
        });

        this.input.on('pointermove', pointer => {
            if (pointer.id === this.joystick.pointerId) {
                const dx = pointer.x - this.joystick.base.x;
                const dy = pointer.y - this.joystick.base.y;
                const distance = Math.min(Math.sqrt(dx * dx + dy * dy), 80); // joystick radius
                const angle = Math.atan2(dy, dx);

                this.joystick.thumb.setPosition(
                    this.joystick.base.x + Math.cos(angle) * distance,
                    this.joystick.base.y + Math.sin(angle) * distance
                );

                this.joystick.force = distance / 80;
                this.joystick.angle = Phaser.Math.RadToDeg(angle);
            }
        });
    }

    resetJoystick() {
        this.joystick.pointerId = null;
        this.joystick.force = 0;
        this.joystick.angle = 0;
        this.joystick.base.setVisible(false);
        this.joystick.thumb.setVisible(false);
    }

    createUI() {
        this.scoreText = this.add.text(970, 50, 'Score: 0', { font: '36px outfit', fill: '#ffffff' }).setOrigin(0.5);
        this.batteryBar = this.add.text(500, 30, 'Battery: 100%', { font: '32px outfit', fill: '#ffffffff' });
        this.shieldBar = this.add.text(1240, 30, 'Shield: 100%', { font: '32px outfit', fill: '#ffffffff' });
    }


    spawnJunk() {
        for (let i = 0; i < 20; i++) {
            const x = Phaser.Math.Between(100, 1820);
            const y = Phaser.Math.Between(100, 980);
            const key = Phaser.Math.RND.pick(['junk1', 'junk2']);
            const junk = this.junkGroup.create(x, y, key);

            junk.setVelocity(Phaser.Math.Between(-30, 30), Phaser.Math.Between(-30, 30));
            junk.setBounce(1).setCollideWorldBounds(true).setMaxVelocity(150);
            junk.setAngularVelocity(Phaser.Math.Between(-20, 20)); // optional: spinning

        }
    }


    collectJunk(player, junk) {
        junk.destroy();
        this.score += 10;
        this.scoreText.setText(`Score: ${this.score}`);
        this.collectSound.play();

        // Recharge battery on collection
        this.battery = Math.min(this.battery + 10, 100);
        this.batteryBar.setText(`Shield: ${this.battery.toFixed(0)}%`);

        if (this.junkGroup.countActive() === 0) {
            this.win();
            // You win – reload for now
        }
    }

    win() {
        if (this.backgroundMusic) {
            this.backgroundMusic.pause(); // or .stop() if you want to restart from beginning next time
        }

        this.physics.pause();
        this.player.setVelocity(0);
        this.add.image(960, 540, 'lvlbox').setOrigin(0.5).setDepth(5);
        this.add.text(960, 540, `You collected all junk!\nScore: ${this.score}`, {
            fontSize: '48px outfit',
            fill: '#ffffff',
            align: 'center',
            wordWrap: { width: 800 }
        }).setOrigin(0.5).setDepth(10);
        this.add.image(720, 900, 'next').setOrigin(0.5).setInteractive().setDepth(10).on('pointerdown', () => {
            this.notifyParent('sceneComplete', { result: 'win' });  // Change to your next level scene
        });
        this.add.image(1200, 900, 'lvl_replay').setOrigin(0.5).setInteractive().setDepth(10).on('pointerdown', () => {
            this.scene.restart();
        });
        this.add.text(960, 540, 'Mission Complete!', {
            fontSize: '48px outfit',
            fill: '#ffffffff'
        }).setOrigin(0.5);



    }



    update() {
        if (!this.gameStarted) return;

        const speed = 200;
        let isMoving = false;

        if (this.joystick?.force > 0) {
            const rad = Phaser.Math.DegToRad(this.joystick.angle);
            this.physics.velocityFromRotation(rad, speed * this.joystick.force, this.player.body.velocity);
            isMoving = true;

            // Flip based on joystick angle (left if angle > 90 or < -90)
            this.player.setFlipX(this.joystick.angle > 90 || this.joystick.angle < -90);
        }
        else {
            if (this.cursors.left.isDown) {
                this.player.setVelocityX(-speed);
                this.player.setFlipX(true);  // Flip left
                isMoving = true;
            } else if (this.cursors.right.isDown) {
                this.player.setVelocityX(speed);
                this.player.setFlipX(false); // Face right
                isMoving = true;
            }
            else {
                this.player.setVelocityX(0);
            }

            if (this.cursors.up.isDown) {
                this.player.setVelocityY(-speed);
                isMoving = true;
            } else if (this.cursors.down.isDown) {
                this.player.setVelocityY(speed);
                isMoving = true;
            } else {
                this.player.setVelocityY(0);
            }
        }

        // Battery drain if moving
        if (isMoving && this.battery > 0) {
            this.battery -= 0.05;
            this.battery = Math.max(this.battery, 0);
            this.batteryBar.setText(`Battery: ${this.battery.toFixed(0)}%`);
        }
        if (this.battery <= 0 && !this.batteryDead) {
            this.batteryDead = true;
            this.gameOver('Battery Depleted!');
        }

        // this.player.setVelocity(0); // freeze movement
        // this.physics.pause();
        // this.time.delayedCall(2000, () => this.scene.restart());
    }




    pullJunk() {
        if (this.battery <= 0) return; // Don't pull if battery is empty

        const radius = 200;
        this.junkGroup.getChildren().forEach(junk => {
            const distance = Phaser.Math.Distance.Between(this.player.x, this.player.y, junk.x, junk.y);
            if (distance < radius) {
                this.physics.moveToObject(junk, this.player, 150);
            }
        });

        this.battery -= 1; // Pulling consumes more battery
        this.battery = Math.max(this.battery, 0);
        this.batteryBar.setText(`Battery: ${this.battery.toFixed(0)}%`);
    }

}

