const SCREEN_WIDTH = 1920;
const SCREEN_HEIGHT = 1080;

export default class GamePlayScene extends Phaser.Scene {
    constructor() {
        super('GamePlayScene');

        Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach(fn => {
            if (typeof this[fn] === 'function') {
                this[fn] = this[fn].bind(this);
            }
        });

        this.kills = 0;
        this.lives = 3;
        this.gameOver = false;
        this.gameTimers = [];

        this.gameStarted = false;
        this.targetKills = 3; // 👈 default, overridden by JSON
    }

    preload() {
        const basePath = import.meta.url.substring(
            0,
            import.meta.url.lastIndexOf('/')
        );

        this.load.json('levelConfig', `${basePath}/config.json`);

        this.load.once('filecomplete-json-levelConfig', () => {
            const cfg = this.cache.json.get('levelConfig');

            // Load mechanics settings
            const mechanics = cfg.mechanics || {};
            this.mafiaSpeed = mechanics.mafiaSpeed || 50;
            // this.timer = mechanics.timer || 60;
            this.heroBulletSpeed = mechanics.heroBulletSpeed || 800;
            this.mafiaSpawnInterval = mechanics.mafiaSpawnInterval || 5000;
            if (this.mafiaSpawnInterval <= 0) {
                console.warn('Invalid mafiaSpawnInterval, setting to default 5000ms');
                this.mafiaSpawnInterval = 5000;
            }
            this.shootAllowed = mechanics.shootAllowedInitially || false;

            // ⚠️ IMPORTANT:
            // Make sure config.json has something like:
            // "images1": { "player": "player.png", ... }
            // We will use texture key 'player' in create()

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
                    if (!url) continue;

                    let finalUrl = url;

                    // If it's NOT an absolute URL, prefix basePath
                    if (!/^https?:\/\//i.test(url) && !url.startsWith('//')) {
                        finalUrl = `${basePath}/${url}`;
                    }

                    this.load.audio(key, finalUrl);
                }
            }


            this.load.start();
        });
    }


    create() {
        // Reset game state
        this.gameTimers = [];
        this.kills = 0;
        this.lives = 3;
        this.gameOver = false;
        this.money = 0;
        this.facing = 'right';
        this.gameStarted = false;

        // Initialize physics groups
        this.mafias = this.physics.add.group();
        this.heroBullets = this.physics.add.group({ allowGravity: false });
        this.mafiaBullets = this.physics.add.group({ allowGravity: false });
        this.moneyItems = this.physics.add.group();
        this.platforms = this.physics.add.staticGroup();
        this.flyingPlatforms = this.physics.add.staticGroup();
        this.bgGroup = this.add.group();

        // Load configuration
        const cfg = this.cache.json.get('levelConfig') || {};
        const mechanics = cfg.mechanics || {};
        this.lives = mechanics.lives ?? 3;
        this.mafiaSpeed = mechanics.mafiaSpeed || 50;
        // this.timer = mechanics.timer || 60;
        this.heroBulletSpeed = mechanics.heroBulletSpeed || 800;
        this.mafiaSpawnInterval = mechanics.mafiaSpawnInterval || 5000;
        this.targetKills = mechanics.targetKills ?? 3; // 👈 target kills from JSON (default 3)

        if (this.mafiaSpawnInterval <= 0) {
            console.warn('Invalid mafiaSpawnInterval, setting to default 5000ms');
            this.mafiaSpawnInterval = 5000;
        }

        // Allow shooting immediately for testing
        this.shootAllowed = true; // Changed from mechanics.shootAllowedInitially || false

        console.log(
            'create: mafiaSpawnInterval=',
            this.mafiaSpawnInterval,
            'shootAllowed=',
            this.shootAllowed,
            'targetKills=',
            this.targetKills
        );

        // Lock orientation (if supported)
        if (screen.orientation && screen.orientation.lock) {
            screen.orientation
                .lock('landscape-primary')
                .catch(err => console.warn('Orientation lock failed:', err));
        }

        // Set up background
        this.bgWidth = 1920;
        this.lastBGX = 0;
        for (let i = -1; i < Math.ceil(32000 / this.bgWidth) + 4; i++) {
            const x = i * this.bgWidth;
            const key = i % 2 === 0 ? 'background' : 'background';
            const tile = this.add.image(x, 0, key)
                .setOrigin(0, 0)
                .setDisplaySize(1920, 1080)
                .setScrollFactor(1);
            tile.bgIndex = i;
            this.bgGroup.add(tile);
            this.lastBGX = x;
        }

        // Set up platforms
        for (let i = 0; i < 160; i++) {
            const x = i * 840;
            let shouldSkip = false;
            for (let j = 1; j < 20; j++) {
                const flyingX = j * 1000 + 1200;
                if (j % 2 === 0 && Math.abs(x - flyingX) < 200) {
                    shouldSkip = true;
                    break;
                }
            }
            if (!shouldSkip) {
                const plat = this.platforms.create(x, 1000, 'platform');
                plat.setScale(1).refreshBody();
            }
        }

        // Set up hero
        this.hero = this.physics.add.sprite(100, 450, 'player');
        this.hero.setBounce(0.2).setCollideWorldBounds(false);
        this.hero.setDisplaySize(173, 260);
        this.physics.add.collider(this.hero, this.platforms);
        this.hero.setVisible(false); // hide until Play clicked

        // Set up camera
        this.sys.cameras.main.setBounds(0, 0, 32000, 1080);
        this.sys.cameras.main.startFollow(this.hero);
        this.physics.world.setBounds(0, 0, 32000, 1080);

        this.cursors = this.input.keyboard.createCursorKeys();

        // Set up physics overlaps and colliders
        this.physics.add.overlap(this.hero, this.moneyItems, this.collectMoney, null, this);
        this.physics.add.collider(this.mafias, this.platforms);
        this.physics.add.overlap(this.heroBullets, this.mafias, this.killMafia, null, this);
        this.physics.add.overlap(this.hero, this.mafiaBullets, this.heroHit, null, this);
        this.physics.add.collider(this.hero, this.flyingPlatforms);
        this.physics.add.collider(this.mafias, this.flyingPlatforms);

        // Set up input
        this.input.keyboard.on('keydown-SPACE', () => {
            if (!this.gameOver) this.fireHeroBullet();
        });

        this.add.image(200, 90, 'scoreback').setScrollFactor(0);
        this.add.image(960, 90, 'scoreback').setScrollFactor(0);
        this.add.image(1700, 90, 'scoreback').setScrollFactor(0);

        // ---- UI ----
        this.moneyText = this.add.text(1580, 60, 'Money: 0', {
            fontSize: '52px',
            fontFamily: 'Outfit',
            fill: '#030303ff'
        }).setScrollFactor(0);


        this.livesText = this.add.text(100, 60, 'Lives: ' + this.lives, {
            fontSize: '52px',
            fontFamily: 'Outfit',
            fill: '#0a0909ff'
        }).setScrollFactor(0);

        // 👇 NEW: Target text (kills)
        this.targetText = this.add.text(815, 60, `Target: 0 / ${this.targetKills}`, {
            fontSize: '52px',
            fontFamily: 'Outfit',
            fill: '#000000ff'
        }).setScrollFactor(0);

        // Set up flying platforms and initial mafias
        for (let i = 1; i < 80; i++) {
            const x = i * 1000 + 1200;
            const y = 490;
            this.flyingPlatforms.create(x, y, 'flyingplatform')
                .setScale(0.7)
                .refreshBody();
        }

        // Remove platforms marked for removal
        this.time.delayedCall(100, () => {
            const toRemove = this.platformsToRemove || [];
            this.platforms.getChildren().forEach(p => {
                if (p && toRemove.some(rx => Math.abs(p.x - rx) < 50)) {
                    p.destroy();
                }
            });
            this.platformsToRemove = null;
        });

        // Pause physics until start
        this.physics.pause();

        // Show start screen
        this.showStartScreen();

        // Debug keys
        this.input.keyboard.on('keydown-G', () => {
            if (!this.gameOver) this.endGame();
        });
        this.input.keyboard.on('keydown-L', () => {
            if (!this.gameOver) this.showLevelComplete();
        });

        // ---- AUDIO (Play bgm immediately at scene start) ----
        this.sounds = {
            bgMusic: this.sound.add('bg_music', { loop: true, volume: 0.5 }),
            coins: this.sound.add('coins'),
            knife: this.sound.add('knife'),
            shoot: this.sound.add('shoot')
        };

        // 🎵 Start music now (NOT on Play button)
        if (!this.sounds.bgMusic.isPlaying) {
            this.sounds.bgMusic.play();
        }


        // Controls
        this.setupControls();

        // Handle resize
        this.sys.scale.on('resize', () => {
            this.setupControls();
        });

        // Fullscreen on first click
        this.input.addPointer(2);
        this.input.once('pointerdown', () => {
            if (!this.scale.isFullscreen) {
                this.scale.startFullscreen();
            }
        });

        console.log(
            'create completed: mafiaSpawnInterval=',
            this.mafiaSpawnInterval,
            'shootAllowed=',
            this.shootAllowed
        );
    }

    update() {
        if (this.gameOver || !this.gameStarted) return;

        if (this.hero.y > 1190) {
            this.endGame();
            return;
        }

        const scrollX = this.sys.cameras.main.scrollX;
        this.bgGroup.children.iterate((tile) => {
            if (tile.x + this.bgWidth < scrollX - this.bgWidth) {
                tile.x = this.lastBGX + this.bgWidth;
                tile.bgIndex += this.bgGroup.getLength();
                const key = tile.bgIndex % 2 === 0 ? 'background' : 'background';
                tile.setTexture(key);
                this.lastBGX = tile.x;
            }
        });

        if (this.joystickData && this.joystickData.force > 0) {
            const fx = this.joystickData.forceX;
            const fy = this.joystickData.forceY;

            this.hero.setVelocityX(fx * 400);
            this.hero.setAngle(fx * 5);

            if (fx > 0) {
                this.hero.setFlipX(false);
                this.facing = 'right';
            } else if (fx < 0) {
                this.hero.setFlipX(true);
                this.facing = 'left';
            }

            if (fy < -0.5 && this.hero.body.touching.down) {
                this.hero.setVelocityY(-1000);
            }
        } else {
            this.hero.setVelocityX(0);
            this.hero.setAngle(0);
        }

        if (this.cursors.up.isDown && this.hero.body.touching.down) {
            this.hero.setVelocityY(-1000);
        }

        this.mafias.children.iterate(mafia => {
            if (!mafia || mafia.dead) return;

            if (!mafia.body.blocked.down) {
                mafia.setVelocityX(0);
                return;
            }

            const distance = mafia.x - mafia.patrolStartX;

            if (Math.abs(distance) >= mafia.patrolRange) {
                mafia.direction = distance > 0 ? -1 : 1;
            }

            if (!mafia.direction) mafia.direction = 1;

            mafia.setVelocityX(mafia.direction * this.mafiaSpeed);
            mafia.flipX = mafia.direction < 0;

            if (Phaser.Math.Distance.Between(mafia.x, mafia.y, this.hero.x, this.hero.y) < 30) {
                this.heroHit(this.hero, mafia);
            }

            if (this.shootAllowed && Phaser.Math.Between(0, 100) < 1) {
                this.fireMafiaBullet(mafia, mafia.direction);
            }
        });

        const camLeft = this.sys.cameras.main.scrollX;
        const camRight = camLeft + this.sys.cameras.main.width;
        this.heroBullets.children.iterate(b => {
            if (b && (b.x < camLeft - 100 || b.x > camRight + 100)) b.destroy();
        });
        this.mafiaBullets.children.iterate(b => {
            if (b && (b.x < camLeft - 100 || b.x > camRight + 100)) b.destroy();
        });
    }

    collectMoney(hero, money) {
        money.destroy();
        this.money += 10;
        this.moneyText.setText('Money: ' + this.money);
        this.sounds.coins.play();
    }

    showStartScreen() {
        const cam = this.sys.cameras.main;
        const centerX = cam.width / 2;
        const centerY = cam.height / 2;

        this.startOverlay = this.add.container(centerX, centerY).setScrollFactor(0);

        // Full-screen background (htpbg)
        const bgFull = this.add.image(0, 0, 'htpbg')
            .setOrigin(0.5)
            .setDisplaySize(cam.width, cam.height);

        // Dialog panel (dialog_bg_start)
        const dialog = this.add.image(0, 0, 'dialog_bg_start')
            .setDisplaySize(837, 417)
            .setOrigin(0.5);

        const title = this.add.text(0, -150, 'How to Play', {
            font: "bold 70px Arial",
            color: '#fff'
        }).setOrigin(0.5);

        const desc = this.add.text(-200, +40, 'Control:', {
            font: "60px Arial",
            color: '#fff',
            align: 'center',
            wordWrap: { width: 820 }
        }).setOrigin(0.5);

        const desc1 = this.add.text(100, 40, 'Kill:', {
            font: "60px Arial",
            color: '#fff',
            align: 'center',
            wordWrap: { width: 820 }
        }).setOrigin(0.5);
        const img = this.add.image(230, 50, 'mafia').setScale(0.7);
        const img1 = this.add.image(-30, 20, 'player').setScale(0.3);


        const startBtn = this.add.image(0, 350, 'button')
            .setInteractive()
            .setScale(0.5)
            .setDisplaySize(837, 143);

        startBtn.on('pointerdown', () => {
            console.log('Start button clicked: starting game');

            if (this.startOverlay) {
                this.startOverlay.destroy();
                this.startOverlay = null;
            }

            this.shootAllowed = true;

            if (this.hero) {
                this.hero.setVisible(true);
            }

            this.enableControls();  // show joystick + fire button
            this.startGame();
        });

        this.startOverlay.add([bgFull, dialog, title, desc, desc1, img, img1, startBtn]);
    }

    startGame() {
        if (this.gameStarted) return;

        this.gameStarted = true;
        this.gameOver = false;

        // Resume physics
        this.physics.resume();

        const minDelay = 100;


        // Mafia spawn loop
        this.gameTimers.push(
            this.time.addEvent({
                delay: Math.max(this.mafiaSpawnInterval, minDelay),
                loop: true,
                callback: () => {
                    if (!this.gameOver && this.gameStarted) {
                        this.spawnMafia();
                    }
                }
            })
        );

        // Initial mafias on flying platforms
        if (this.flyingPlatforms && this.mafias) {
            this.flyingPlatforms.children.iterate(flyingPlat => {
                if (!flyingPlat) return;
                const bounds = flyingPlat.getBounds();
                const mafia = this.mafias.create(bounds.centerX, bounds.top - 130, 'mafia')
                    .setScale(0.6)
                    .setDisplaySize(173, 260)
                    .setCollideWorldBounds(false)
                    .setBounce(0);
                mafia.health = 3;
                mafia.patrolStartX = bounds.centerX;
                mafia.patrolRange = 100;
                console.log('Initial mafia spawned at:', bounds.centerX, bounds.top - 130);
            });
        }
    }

    fireHeroBullet() {
        if (!this.heroBullets || this.gameOver || !this.gameStarted || !this.shootAllowed) {
            console.log(
                'fireHeroBullet blocked: heroBullets=',
                !!this.heroBullets,
                'gameOver=',
                this.gameOver,
                'shootAllowed=',
                this.shootAllowed
            );
            return;
        }

        const dir = this.facing === 'left' ? -1 : 1;
        const bullet = this.heroBullets.create(this.hero.x + dir * 20, this.hero.y, 'bullet').setScale(0.2);
        bullet.setVelocityX(dir * this.heroBulletSpeed);
        bullet.setDisplaySize(14, 5);
        this.sounds.shoot.play();
        console.log(
            'Hero bullet fired at:',
            bullet.x,
            bullet.y,
            'velocity:',
            bullet.body.velocity.x
        );
    }

    fireMafiaBullet(mafia, dir) {
        if (!this.mafiaBullets || this.gameOver) return;

        const bullet = this.mafiaBullets.create(mafia.x, mafia.y, 'bullet').setScale(0.2);
        bullet.setVelocityX(dir * 300);
        bullet.setDisplaySize(14, 5);
        console.log(
            'Mafia bullet fired at:',
            bullet.x,
            bullet.y,
            'velocity:',
            bullet.body.velocity.x
        );
    }

    spawnMafia() {
        if (!this.mafias || this.gameOver || !this.gameStarted) return;

        const offset = Phaser.Math.Between(600, 1200);
        const spawnX = this.hero.x + offset;
        const mafia = this.mafias.create(spawnX, 700, 'mafia')
            .setScale(0.6)
            .setDisplaySize(173, 260);
        mafia.setCollideWorldBounds(false).setBounce(0);
        mafia.health = 3;
        mafia.patrolStartX = spawnX;
        mafia.patrolRange = 300;
        mafia.direction = Phaser.Math.Between(0, 1) ? 1 : -1;
        console.log('Mafia spawned at:', spawnX, 700);
    }

    killMafia(bullet, mafia) {
        bullet.destroy();

        mafia.health--;
        if (mafia.health <= 0) {
            mafia.disableBody(true, true);
            mafia.dead = true;

            const coin = this.moneyItems.create(mafia.x, mafia.y, 'money')
                .setScale(0.4)
                .setDisplaySize(148, 222);
            coin.setImmovable(true);
            coin.body.allowGravity = false;

            this.mafiaSpeed += 5;
            this.moneyText.setText('Money: ' + this.money);

            // 👇 NEW: count kills & update target UI
            this.kills++;
            if (this.targetText) {
                this.targetText.setText(`Target: ${this.kills} / ${this.targetKills}`);
            }

            // If target reached, trigger win
            if (!this.gameOver && this.kills >= this.targetKills) {
                this.showLevelComplete();
            }
        }
    }

    heroHit(hero, attacker) {
        if (this.gameOver) return;
        attacker.destroy?.();
        this.lives--;

        // Update numeric lives UI
        if (this.livesText) {
            this.livesText.setText('Lives: ' + this.lives);
        }

        this.sounds.knife.play();

        if (this.lives > 0) {
            this.respawnHero();
        } else {
            this.endGame();
        }
    }

    respawnHero() {
        this.hero.setVelocity(0, 0);
        this.hero.setPosition(this.hero.x, 650);
        this.hero.setAlpha(0.5);
        this.hero.body.enable = false;

        this.time.delayedCall(1000, () => {
            this.hero.setAlpha(1);
            this.hero.body.enable = true;
        });
    }

    setupControls() {
        const cam = this.sys.cameras.main;

        const shootBtnX = cam.width - 200;
        const shootBtnY = cam.height / 2 + 130;
        const joyX = 300;
        const joyY = cam.height - 400;

        // ---- SHOOT BUTTON ----
        if (!this.shootButton) {
            this.shootButton = this.add.image(shootBtnX, shootBtnY, 'shoot_button')
                .setScrollFactor(0)
                .setDepth(12)
                .setScale(0.8)
                .setInteractive();

            this.shootButton.on('pointerdown', () => {
                console.log(
                    'Shoot button clicked: gameOver=',
                    this.gameOver,
                    'shootAllowed=',
                    this.shootAllowed
                );
                if (!this.gameOver) this.fireHeroBullet();
            });

            // Hide and disable on start screen
            this.shootButton.setVisible(false);
            this.shootButton.disableInteractive();
        } else {
            this.shootButton.setPosition(shootBtnX, shootBtnY);
        }

        // ---- JOYSTICK ----
        if (!this.joystickData) {
            const bg = this.add.image(joyX, joyY, "joystick_bg")
                .setDepth(10)
                .setScrollFactor(0)
                .setInteractive()
                .setDisplaySize(227, 227);

            const knob = this.add.image(joyX, joyY, "joystick_knob")
                .setDepth(11)
                .setScrollFactor(0)
                .setInteractive()
                .setDisplaySize(116.27, 116.27);

            this.joystickData = {
                bg,
                knob,
                forceX: 0,
                forceY: 0,
                get force() {
                    return Math.sqrt(this.forceX ** 2 + this.forceY ** 2);
                }
            };

            // Hide and disable on start screen
            bg.setVisible(false);
            knob.setVisible(false);
            bg.disableInteractive();
            knob.disableInteractive();

            let dragging = false;
            let dragPointerId = null;
            const startX = knob.x;
            const startY = knob.y;
            const maxDist = 100;

            knob.on("pointerdown", pointer => {
                dragging = true;
                dragPointerId = pointer.id;
            });

            this.input.on("pointerup", pointer => {
                if (pointer.id === dragPointerId) {
                    dragging = false;
                    dragPointerId = null;
                    knob.x = startX;
                    knob.y = startY;
                    this.joystickData.forceX = 0;
                    this.joystickData.forceY = 0;
                }
            });

            this.input.on("pointermove", pointer => {
                if (!dragging || pointer.id !== dragPointerId) return;

                const dx = pointer.x - startX;
                const dy = pointer.y - startY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const angle = Math.atan2(dy, dx);

                const clampedDist = Phaser.Math.Clamp(dist, 0, maxDist);
                knob.x = startX + Math.cos(angle) * clampedDist;
                knob.y = startY + Math.sin(angle) * clampedDist;

                this.joystickData.forceX = Phaser.Math.Clamp(dx / maxDist, -1, 1);
                this.joystickData.forceY = Phaser.Math.Clamp(dy / maxDist, -1, 1);
            });
        } else {
            this.joystickData.knob.setPosition(joyX, joyY);
            this.joystickData.bg.setPosition(joyX, joyY);
        }
    }

    enableControls() {
        if (this.shootButton) {
            this.shootButton.setVisible(true);
            this.shootButton.setActive(true);
            this.shootButton.setInteractive();
        }

        if (this.joystickData) {
            const { bg, knob } = this.joystickData;
            if (bg) {
                bg.setVisible(true);
                bg.setActive(true);
                bg.setInteractive();
            }
            if (knob) {
                knob.setVisible(true);
                knob.setActive(true);
                knob.setInteractive();
            }
        }
    }

    disableControls() {
        if (this.shootButton) {
            this.shootButton.setVisible(false);
            this.shootButton.disableInteractive();
        }

        if (this.joystickData) {
            const { bg, knob } = this.joystickData;
            if (bg) {
                bg.setVisible(false);
                bg.disableInteractive();
            }
            if (knob) {
                knob.setVisible(false);
                knob.disableInteractive();
            }
        }
    }

    endGame() {
        this.gameOver = true;
        this.gameStarted = false;

        this.physics.pause();
        this.time.removeAllEvents();

        this.disableControls();

        const centerX = this.sys.cameras.main.scrollX + this.sys.cameras.main.width / 2;
        const centerY = this.sys.cameras.main.height / 2;

        const overlay = this.add.container(centerX, centerY);

        // Full-screen background (ovrbg)
        const bgFull = this.add.image(0, 0, 'ovrbg')
            .setOrigin(0.5)
            .setDisplaySize(this.sys.cameras.main.width, this.sys.cameras.main.height);

        // Panel (game_over)
        const panel = this.add.image(0, -40, 'game_over')
            .setDisplaySize(666, 216)
            .setOrigin(0.5);

        const title = this.add.text(0, -50, 'Game Over', {
            font: "bold 70px Arial",
            color: '#fff'
        }).setOrigin(0.5);

        const btn = this.add.image(0, 180, 'replay_button_big')
            .setInteractive()
            .setScale(0.5)
            .setDisplaySize(666, 145);

        btn.on('pointerdown', () => {
            this.shutdown();
            this.scene.restart();
        });

        overlay.add([bgFull, panel, title, btn]);
    }

    showLevelComplete() {
        this.gameOver = true;
        this.gameStarted = false;

        this.physics.pause();
        this.time.removeAllEvents();
        this.disableControls();

        const centerX = this.sys.cameras.main.scrollX + this.sys.cameras.main.width / 2;
        const centerY = this.sys.cameras.main.height / 2;

        const overlay = this.add.container(centerX, centerY);

        // Full-screen background (winbg)
        const bgFull = this.add.image(0, 0, 'winbg')
            .setOrigin(0.5)
            .setDisplaySize(this.sys.cameras.main.width, this.sys.cameras.main.height);

        // Panel (level_complete)
        const panel = this.add.image(0, -40, 'level_complete')
            .setDisplaySize(914, 217)
            .setOrigin(0.5);

        const title = this.add.text(0, -50, 'Level Complete', {
            font: "bold 70px Arial",
            color: '#fff'
        }).setOrigin(0.5);

        const replayBtn = this.add.image(-241, 180, 'replay_button')
            .setInteractive()
            .setScale(0.5)
            .setDisplaySize(441, 145);

        const nextBtn = this.add.image(241, 180, 'next_button')
            .setInteractive()
            .setScale(0.5)
            .setDisplaySize(441, 145);

        replayBtn.on('pointerdown', () => {
            this.shutdown();
            this.scene.restart();
        });

        nextBtn.on('pointerdown', () => {
            this.notifyParent('sceneComplete', { result: 'win' });
            console.log('sceneComplete');
        });

        overlay.add([bgFull, panel, title, replayBtn, nextBtn]);
    }

    notifyParent(type, data) {
        if (window.parent !== window) {
            window.parent.postMessage({ type, ...data }, "*");
        }
    }

    shutdown() {
        // Destroy all game timers
        if (this.gameTimers) {
            this.gameTimers.forEach(timer => {
                if (timer && timer.remove) {
                    timer.remove();
                }
            });
            this.gameTimers = [];
        }

        this.time.removeAllEvents();

        this.input.keyboard.removeAllListeners();
        this.input.removeAllListeners();

        if (this.mafias) {
            this.mafias.clear(true, true);
            this.mafias = null;
        }
        if (this.heroBullets) {
            this.heroBullets.clear(true, true);
            this.heroBullets = null;
        }
        if (this.mafiaBullets) {
            this.mafiaBullets.clear(true, true);
            this.mafiaBullets = null;
        }
        if (this.moneyItems) {
            this.moneyItems.clear(true, true);
            this.moneyItems = null;
        }
        if (this.platforms) {
            this.platforms.clear(true, true);
            this.platforms = null;
        }
        if (this.flyingPlatforms) {
            this.flyingPlatforms.clear(true, true);
            this.flyingPlatforms = null;
        }
        if (this.bgGroup) {
            this.bgGroup.clear(true, true);
            this.bgGroup = null;
        }

        if (this.moneyText) {
            this.moneyText.destroy();
            this.moneyText = null;
        }

        if (this.livesText) {
            this.livesText.destroy();
            this.livesText = null;
        }
        if (this.targetText) {       // 👈 destroy target text
            this.targetText.destroy();
            this.targetText = null;
        }

        if (this.shootButton) {
            this.shootButton.destroy();
            this.shootButton = null;
        }
        if (this.joystickData) {
            if (this.joystickData.knob) this.joystickData.knob.destroy();
            if (this.joystickData.bg) this.joystickData.bg.destroy();
            this.joystickData = null;
        }

        if (this.hero) {
            this.hero.destroy();
            this.hero = null;
        }

        if (this.startOverlay) {
            this.startOverlay.destroy();
            this.startOverlay = null;
        }

        if (this.sounds) {
            Object.values(this.sounds).forEach(sound => {
                if (sound && sound.stop && sound.destroy) {
                    sound.stop();
                    sound.destroy();
                }
            });
            this.sounds = null;
        }

        if (this.physics.world) {
            this.physics.world.setBounds(0, 0, 32000, 1080);
            this.physics.pause();
        }
        if (this.sys.cameras.main) {
            this.sys.cameras.main.setBounds(0, 0, 32000, 1080);
            this.sys.cameras.main.stopFollow();
        }

        // Reset game state from JSON
        this.kills = 0;
        const cfg = this.cache.json.get('levelConfig');
        const mechanics = cfg?.mechanics || {};
        this.lives = mechanics.lives ?? 3;
        this.targetKills = mechanics.targetKills ?? 3; // 👈 reset target
        this.gameOver = false;
        this.money = 0;

        this.shootAllowed = mechanics.shootAllowedInitially || false;
        this.mafiaSpeed = mechanics.mafiaSpeed || 50;
        this.mafiaSpawnInterval = mechanics.mafiaSpawnInterval || 5000;
        this.facing = 'right';
        this.platformsToRemove = null;

        console.log('Shutdown completed: Game state fully reset');
    }

    destroy() {
        this.shutdown();
        super.destroy();
    }
}
