export default class GamePlayScene extends Phaser.Scene {
    constructor() {
        super('GamePlayScene');

        Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach(fn => {
            if (typeof this[fn] === 'function') {
                this[fn] = this[fn].bind(this);
            }
        });

        this.leftJoystick = {};
        this.rightJoystick = {};
        this.canShoot = true;
        this.reloading = false;
        this.lastBulletTime = 0;
        this.bulletSpeed = 600;
        this.totalBullets = 60;
        this.bulletsInGun = 20;
        this.enemyShoot = this.enemyShoot.bind(this);

    }

    static cachedConfig = null; // Add this line at top of class (outside any function)

    preload() {
        const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf("/"));

        // ✅ Use cached config if it exists
        if (GamePlayScene.cachedConfig) {
            this.config = GamePlayScene.cachedConfig;
            return;
        }

        // Load config JSON
        const cfg = this.load.json("levelConfig", `${basePath}/config.json`);

        this.load.once("filecomplete-json-levelConfig", () => {
            this.config = this.cache.json.get("levelConfig");
            GamePlayScene.cachedConfig = this.config; // ✅ Cache it

            console.log("✅ Config Loaded:", this.config);
            const sheets = cfg.sheets || {};
            const heroData = sheets.hero || {};
            const rawMain = new URLSearchParams(window.location.search).get('main') || '';
            const cleanMain = rawMain.replace(/^"|"$/g, '');
            const sheetUrl =
                cleanMain ||
                heroData.url ||
                `${basePath}/assets/dude.png`;

            const frameW = heroData.frameWidth || 103;
            const frameH = heroData.frameHeight || 142;
            this.load.spritesheet('hero', sheetUrl, {
                frameWidth: frameW,
                frameHeight: frameH,
            });

            if (!this.config || !this.config.texts) {
                console.error("❌ Config or texts missing!");
                return;
            }

            // Load images
            if (this.config.images1) {
                for (const [key, url] of Object.entries(this.config.images1)) {
                    this.load.image(key, `${basePath}/${url}`);
                }
            }
              if (this.config.images2) {
                for (const [key, url] of Object.entries(this.config.images2)) {
                    this.load.image(key, `${basePath}/${url}`);
                }
            }
              if (this.config.ui) {
                for (const [key, url] of Object.entries(this.config.ui)) {
                    this.load.image(key, `${basePath}/${url}`);
                }
            }

            // Load spritesheets
            if (this.config.spritesheets) {
                for (const [key, sheet] of Object.entries(this.config.spritesheets)) {
                    this.load.spritesheet(key, `${basePath}/${sheet.url}`, {
                        frameWidth: sheet.frameWidth,
                        frameHeight: sheet.frameHeight
                    });
                }
            }

            // Load audio
            if (this.config.audio) {
                for (const [key, url] of Object.entries(this.config.audio)) {
                    this.load.audio(key, `${basePath}/${url}`);
                }
            }

            // Load tiles
            if (this.config.tiles) {
                for (const [key, url] of Object.entries(this.config.tiles)) {
                    this.load.image(key, `${basePath}/${url}`);
                }
            }



            this.load.start();
        });
    }

    create() {

        if (screen.orientation && screen.orientation.lock) {
            screen.orientation
                .lock('landscape-primary')
                .catch(err => console.warn('Orientation lock failed:', err));
        }
        this.state = 'playing'; // Reset game state

        this.sounds = {
            bgmusic: this.sound.add('bgmusic', { loop: true, volume: 0.4 }),
            candle_off: this.sound.add('candle_off'),
            enemy_death: this.sound.add('enemy_death'),
            door_lock: this.sound.add('door_lock'),
            jump: this.sound.add('jump'),
            lazer_gun: this.sound.add('lazer_gun'),
            portal_entry: this.sound.add('portal_entry'),
            portal_reentry: this.sound.add('portal_reentry'),
            reload: this.sound.add('reload')
        };

        // Start background music
        this.sounds.bgmusic.play();




        // Access and store mechanics config
        const mech = this.config.mechanics;
        this.totalBullets = mech.totalBullets;
        this.bulletsInGun = mech.bulletsInGun;
        this.reloadTime = mech.reloadTime;
        this.bulletCooldown = mech.bulletCooldown;
        this.maxHealth = mech.heroMaxHealth;
        this.heroHealth = mech.heroMaxHealth;
        this.enemyHitPoints = mech.enemyHitPoints;
        this.enemySpawnDelay = mech.enemySpawnDelay;
        this.enemyFireRate = mech.enemyFireRate;
        this.enemyStopDistanceX = mech.enemyStopDistanceX;
        this.enemyBulletDamage = mech.enemyBulletDamage;

        this.platforms = this.physics.add.staticGroup();
        let x = 300;
        const bgWidth = 1920;
        const bgHeight = 1080; // If your background is 1080px tall
        const totalBg = Math.ceil(x / bgWidth) + 1;

        for (let i = 0; i < totalBg; i++) {
            this.add.image(i * bgWidth + bgWidth / 2, bgHeight / 2, 'sky').setOrigin(0.5);
        }

        for (let i = 0; i < 8; i++) {
            const y = Phaser.Math.Between(500, 800);
            this.platforms.create(x, y, 'platform').refreshBody();
            x += 680;
        }

        const portal = this.add.image(300, 150, 'portal');
        this.hero = this.physics.add.sprite(300, 160, 'hero');
        this.hero.setBounce(0.2);
        this.hero.setCollideWorldBounds(false);
        this.hero.setScale(1.8);
        this.hero.clearTint(); // Reset any red tint
        this.hero.setActive(true).setVisible(true);
        this.physics.add.collider(this.hero, this.platforms);

        this.sys.cameras.main.startFollow(this.hero, true, 0.08, 0.08);
        this.sys.cameras.main.setBounds(0, 0, x, 1080);
        this.physics.world.setBounds(0, 0, x, 1080);

        this.anims.create({
            key: 'walk',
            frames: this.anims.generateFrameNumbers('hero', { start: 0, end: 3 }),
            frameRate: 10,
            repeat: -1
        });

        this.bullets = this.physics.add.group({
            classType: Phaser.Physics.Arcade.Image,
            runChildUpdate: true
        });


        this.canShoot = true;
        this.reloading = false;

        this.ammoUIBg = this.add.image(954, 60, 'bullet_text_bg').setScrollFactor(0).setScale(1);
        this.ammoIcon = this.add.image(900, 56, 'bullet_icon').setScrollFactor(0).setScale(1);
        this.ammoText = this.add.text(930, 42, `${this.bulletsInGun}/${this.totalBullets}`, {
            fontSize: '32px',
            color: '#fff',
            fontStyle: 'bold'
        }).setScrollFactor(0);

        this.setupJoystick();
        this.setupShootJoystick();
        this.setupReloadButton();

        this.hasWand = false;
        this.hasShield = false;

        const platformChildren = this.platforms.getChildren();
        const lastPlatform = platformChildren[platformChildren.length - 1];
        this.wand = this.physics.add.image(lastPlatform.x, lastPlatform.y - 800, 'wand').setScale(0.5);
        this.wand.setData('isWand', true);
        this.physics.add.collider(this.wand, this.platforms);
        const outPortalIndex = Phaser.Math.Between(2, 5);
        const outPortalPlatform = platformChildren[outPortalIndex];
        this.outPortal = this.add.image(outPortalPlatform.x, outPortalPlatform.y - 190, 'out_portal').setAlpha(0.5);

        this.physics.add.overlap(this.hero, this.wand, () => {
            console.log('🧙 Wand collected'); // <- Add this
            this.hasWand = true;
            this.wand.destroy();
            this.outPortal.setAlpha(1);
        }, null, this);

        // Place lock on platform 4 and 6 (index 3 and 5)
        this.locks = this.physics.add.group();

        const lockPlatform1 = platformChildren[3];
        const lockPlatform2 = platformChildren[5];

        const lock1 = this.locks.create(lockPlatform1.x, lockPlatform1.y - 190, 'lock').setScale(0.5);

        this.physics.add.collider(this.locks, this.platforms);


        this.outPortalZone = this.physics.add.staticImage(this.outPortal.x, this.outPortal.y, null)
            .setSize(80, 100) // make a reasonably big invisible box
            .setVisible(false)
            .refreshBody();

        this.physics.add.overlap(this.hero, this.outPortal, () => {
            console.log('🚪 Hero touched portal'); // <== Add this
        });

        this.physics.add.overlap(this.hero, this.outPortalZone, () => {
            if (this.hasWand && this.state !== 'won') {
                console.log('🎉 Level complete conditions met');
                this.state = 'won';
                this.sounds.portal_entry.play();

                this.hero.setVelocity(0, 0);
                this.hero.anims.stop();
                this.canShoot = false;
                this.reloading = false;
                this.leftJoystick.dx = 0;
                this.rightJoystick.dx = 0;
                this.leftJoystick.active = false;
                this.rightJoystick.active = false;

                this.physics.pause();
                this.showLevelCompleteUI();
            }
        }, null, this);

        // Place shield on platform 3, 4 or 5 randomly
        const shieldPlatformIndex = Phaser.Math.Between(3, 5);
        const shieldPlatform = platformChildren[shieldPlatformIndex];
        this.shield = this.physics.add.image(shieldPlatform.x, shieldPlatform.y - 200, 'shield').setScale(0.5);
        this.physics.add.collider(this.shield, this.platforms);

        // Track lock collection
        this.hasLock = false;

        // Add the door (gate)
        const doorIndex = Phaser.Math.Between(2, 5);
        const doorPlatform = platformChildren[6];
        this.door = this.physics.add.staticImage(doorPlatform.x, doorPlatform.y - 290, 'gate_open');

        this.physics.add.overlap(this.hero, this.locks, (hero, lock) => {
            if (!this.hasLock) {
                console.log('🔒 Lock collected');
                this.hasLock = true;
                lock.destroy(); // destroy the specific lock touched
            }
        }, null, this);

        this.physics.add.overlap(this.hero, this.door, () => {
            if (this.hasLock) {
                console.log('🚪 Door touched with lock — closing it');
                this.sounds.door_lock.play();
                this.door.setTexture('gate_close');
                this.hasLock = false;
            }
        }, null, this);

        this.physics.add.overlap(this.hero, this.shield, () => {
            if (!this.hasShield) {
                this.hasShield = true;
                this.heroHealth = Math.min(this.heroHealth * 2, this.maxHealth * 2); // Double up to 2x max
                this.shield.destroy();

                // Add shield visual on hero
                this.heroShieldImage = this.add.image(0, 0, 'shield').setScale(0.3);
                this.heroShieldImage.setOrigin(0.5);
                this.heroShieldImage.setScrollFactor(0);
                this.heroShieldImage.setDepth(2);
            }
        }, null, this);


        // Enemy group and bullets
        this.enemies = this.physics.add.group();
        this.enemyBullets = this.physics.add.group({
            classType: Phaser.Physics.Arcade.Image,
            runChildUpdate: true
        });

        this.physics.add.collider(this.enemies, this.platforms);


        // Spawn enemies every 4 seconds (until door closes)
        this.enemySpawnTimer = this.time.addEvent({
            delay: this.enemySpawnDelay,
            loop: true,
            callback: () => {
                if (this.door.texture.key === 'gate_open') {
                    const enemy = this.physics.add.sprite(this.door.x, this.door.y, 'enemy').setScale(0.8);
                    this.enemies.add(enemy); // Add to the group after adding physics
                    enemy.hp = this.enemyHitPoints;


                    // Start shooting every 2 seconds
                    enemy.shootTimer = this.time.addEvent({
                        delay: this.enemyFireRate,
                        loop: true,
                        callback: () => this.enemyShoot(enemy)
                    });
                }
            }
        });


        this.healthBarFullWidth = 280;


        // Background image behind the health bar
        this.healthBarBgImage = this.add.image(250, 60, 'healthbar_bg')
            .setScrollFactor(0)
            .setOrigin(0.5)
            .setScale(1);

        // Red health bar rectangle in front of the background image
        this.healthBar = this.add.rectangle(230, 60, 200, 15, 0xff0000)
            .setScrollFactor(0)
            .setOrigin(0.5);

        this.healthBar.width = 280;
        this.physics.add.overlap(this.bullets, this.enemies, (bullet, enemy) => {
            if (!bullet.active || !enemy.active) return;
            bullet.destroy();

            enemy.hp--;

            if (enemy.hp <= 0) {

                this.sounds.enemy_death.play();

                enemy.destroy();
                if (enemy.shootTimer) enemy.shootTimer.remove();
            }
        });

        this.physics.add.overlap(this.enemyBullets, this.hero, this.heroHit, null, this);

        this.showStartScreen();

    }

    update(time) {
        if (this.state === 'start') return;

        if (this.state === 'dead' || !this.hero || !this.hero.body) return;

        this.sounds.portal_reentry.play();

        this.handleHeroMovement();
        this.handleShooting(time);

        // Detect fall below screen
        if (this.hero.y > this.physics.world.bounds.height + 100) {
            this.triggerGameOver();
        }

        if (this.hasShield && this.heroShieldImage) {
            this.heroShieldImage.x = this.hero.x;
            this.heroShieldImage.y = this.hero.y - this.hero.displayHeight / 2;
        }


        // console.log(
        //     `Hero: (${Math.round(this.hero.x)}, ${Math.round(this.hero.y)}), Portal: (${Math.round(this.outPortal.x)}, ${Math.round(this.outPortal.y)})`
        // );

        this.enemies.getChildren().forEach(enemy => {
            if (!enemy.active || !enemy.body || !this.hero.active) return;

            const distanceX = Math.abs(enemy.x - this.hero.x);

            if (distanceX > this.enemyStopDistanceX) {
                const direction = enemy.x < this.hero.x ? 1 : -1;
                enemy.setVelocityX(direction * 120);
                enemy.setFlipX(direction < 0);

                const nextPlatform = this.getNextPlatform(enemy.x, direction);
                const isNearEdge = this.isNearPlatformEdge(enemy, direction);
                const isTouchingDown = enemy.body.touching.down;

                if (isNearEdge && nextPlatform && isTouchingDown) {
                    enemy.setVelocityY(-800);
                }
            } else {
                enemy.setVelocityX(0);
            }
            // ✅ This line must be inside the forEach!
            if (enemy.y > this.physics.world.bounds.height + 100) {
                if (enemy.shootTimer) enemy.shootTimer.remove();
                enemy.destroy();
            }

        });

    }

    getNextPlatform(x, direction) {
        const platforms = this.platforms.getChildren();
        return platforms.find(p => {
            const dx = p.x - x;
            return direction > 0 ? dx > 50 && dx < 700 : dx < -50 && dx > -700;
        });
    }

    isNearPlatformEdge(enemy, direction) {
        const offset = direction > 0 ? 20 : -20; // Check very close to the front
        const nextX = enemy.x + offset;
        const enemyBottomY = enemy.y + enemy.displayHeight / 2 + 5;

        const tileBelow = this.platforms.getChildren().some(p => {
            const platformLeft = p.x - 188; // Half of 376
            const platformRight = p.x + 188;
            const withinX = nextX > platformLeft && nextX < platformRight;
            const withinY = Math.abs(p.y - enemyBottomY) < 30;
            return withinX && withinY;
        });

        return !tileBelow;
    }

    showStartScreen() {
        const centerX = this.sys.cameras.main.width / 2;
        const centerY = this.sys.cameras.main.height / 2;
        const texts = this.config.texts || {}; // Fallback to empty object if texts is undefined
        this.startOverlay = this.add.container(centerX, centerY).setScrollFactor(0);

        const bg = this.add.image(0, -50, 'dialog_bg_start').setDisplaySize(837, 417);
        const title = this.add.text(0, -170, texts.title || 'How to Play', {
            font: "bold 70px Arial",
            color: '#fff'
        }).setOrigin(0.5);

        const desc = this.add.text(0, 30, texts.instructions || 'Take aim, shoot the mafia,\nand collect their loot.', {
            font: "60px Arial",
            color: '#fff',
            align: 'center',
            wordWrap: { width: 820 }
        }).setOrigin(0.5);

        const startBtn = this.add.image(0, 270, 'button')
            .setInteractive()
            .setScale(0.5)
            .setDisplaySize(837, 143);

        startBtn.on('pointerdown', () => {
            this.startOverlay.destroy();
            this.state = 'playing';
        });

        this.startOverlay.add([bg, title, desc, startBtn]);
        this.state = 'start';
    }


    heroHit(hero, bullet) {
        if (this.state === 'dead') return;

        // Safely destroy the bullet (or any other attacker)
        bullet.destroy?.();

        // Reduce health
        this.heroHealth -= this.enemyBulletDamage;
        this.heroHealth = Math.max(0, this.heroHealth);
        this.healthBar.width = (this.heroHealth / this.maxHealth) * this.healthBarFullWidth;


        // Camera shake
        this.sys.cameras.main.shake(150, 0.01);

        // Flash red on hit
        hero.setTint(0xff0000);
        this.time.delayedCall(100, () => {
            if (hero && hero.clearTint) hero.clearTint();
        });

        // If still alive, temporary invincibility (brief alpha flicker)
        if (this.heroHealth > 0) {
            this.hero.setAlpha(0.5);
            hero.body.enable = false;

            this.time.delayedCall(10, () => {
                this.hero.setAlpha(1);
                hero.body.enable = true;
            });
        } else {
            this.triggerGameOver();
        }

        if (this.hasShield && this.heroHealth <= this.maxHealth) {
            this.hasShield = false;
            if (this.heroShieldImage) this.heroShieldImage.destroy();
        }
    }


    enemyShoot(enemy) {
        if (!enemy.active || !this.hero.active) return;

        const bullet = this.enemyBullets.create(enemy.x, enemy.y, 'enemy_bullet');
        bullet.setActive(true).setVisible(true);
        bullet.body.setAllowGravity(false);
        bullet.body.setCollideWorldBounds(false);

        const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, this.hero.x, this.hero.y);
        const speed = 300;
        bullet.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
        bullet.setRotation(angle);
    }



    triggerGameOver() {
        this.state = 'dead';
        this.physics.pause();

        const centerX = this.sys.cameras.main.scrollX + this.sys.cameras.main.width / 2;
        const centerY = this.sys.cameras.main.height / 2;

        const overlay = this.add.container(centerX, centerY);

        const bg = this.add.image(-40, -50, 'game_over').setDisplaySize(666, 216);
        const title = this.add.text(-20, -47, 'Game Over', {
            font: "bold 70px Arial",
            color: '#fff'
        }).setOrigin(0.5);
        const btn = this.add.image(-40, 170, 'replay_button_big').setInteractive().setScale(0.5).setDisplaySize(666, 145);

        btn.on("pointerdown", () => this.scene.restart());

        overlay.add([bg, title, btn]);
    }



    setupJoystick() {
        const joyX = 150, joyY = 900;
        const bg = this.add.image(joyX, joyY, 'joystick_bg').setScrollFactor(0);
        const knob = this.add.image(joyX, joyY, 'joystick_knob').setScrollFactor(0);
        this.leftJoystick = { bg, knob, dx: 0, dy: 0, active: false };

        knob.setInteractive();
        knob.on('pointerdown', () => this.leftJoystick.active = true);
        this.input.on('pointerup', () => {
            this.leftJoystick.active = false;
            knob.setPosition(joyX, joyY);
            this.leftJoystick.dx = 0;
            this.leftJoystick.dy = 0;
        });
        this.input.on('pointermove', (p) => {
            if (!this.leftJoystick.active) return;
            const dx = p.x - joyX, dy = p.y - joyY;
            const angle = Math.atan2(dy, dx);
            const dist = Math.min(100, Math.sqrt(dx * dx + dy * dy));
            knob.setPosition(joyX + Math.cos(angle) * dist, joyY + Math.sin(angle) * dist);
            this.leftJoystick.dx = dx / 100;
            this.leftJoystick.dy = dy / 100;
        });

        // Reset joystick state
        this.leftJoystick.active = false;
        this.leftJoystick.dx = 0;
        this.leftJoystick.dy = 0;
    }

    setupShootJoystick() {
        const joyX = 1400, joyY = 800;
        const bg = this.add.image(joyX, joyY, 'shoot_joystick_bg').setScrollFactor(0).setScale(0.7);
        const knob = this.add.image(joyX, joyY, 'shoot_joystick_knob').setScrollFactor(0);
        this.rightJoystick = { bg, knob, dx: 0, dy: 0, active: false };

        knob.setInteractive();
        knob.on('pointerdown', () => this.rightJoystick.active = true);
        this.input.on('pointerup', () => {
            this.rightJoystick.active = false;
            knob.setPosition(joyX, joyY);
            this.rightJoystick.dx = 0;
            this.rightJoystick.dy = 0;
        });
        this.input.on('pointermove', (p) => {
            if (!this.rightJoystick.active) return;
            const dx = p.x - joyX, dy = p.y - joyY;
            const angle = Math.atan2(dy, dx);
            const dist = Math.min(100, Math.sqrt(dx * dx + dy * dy));
            knob.setPosition(joyX + Math.cos(angle) * dist, joyY + Math.sin(angle) * dist);
            this.rightJoystick.dx = dx / 100;
            this.rightJoystick.dy = dy / 100;
        });

        // Reset joystick state
        this.rightJoystick.active = false;
        this.rightJoystick.dx = 0;
        this.rightJoystick.dy = 0;
    }

    showLevelCompleteUI() {
        this.physics.pause();
        const centerX = this.sys.cameras.main.scrollX + this.sys.cameras.main.width / 2;
        const centerY = this.sys.cameras.main.height / 2;
        this.sounds.portal_reentry.play();

        const overlay = this.add.container(centerX, centerY);

        const bg = this.add.image(0, 0, 'level_complete').setDisplaySize(914, 217);
        const title = this.add.text(-20, 3, 'Level Complete', {
            font: "bold 70px Arial",
            color: '#fff'
        }).setOrigin(0.5);

        const nextBtn = this.add.image(-241, 220, 'next_button')
            .setInteractive()
            .setScale(0.5)
            .setDisplaySize(441, 145);

        const replayBtn = this.add.image(241, 220, 'replay_button')
            .setInteractive()
            .setScale(0.5)
            .setDisplaySize(441, 145);

        replayBtn.on('pointerdown', () => {
            this.scene.restart();
        });

        nextBtn.on('pointerdown', () => {
            this.notifyParent('sceneComplete', { result: 'win' })
        });

        overlay.add([bg, title, replayBtn, nextBtn]);
    }

    notifyParent(type, data) {
        if (window.parent !== window) {
            window.parent.postMessage({ type, ...data }, "*");
        }
    }



    setupReloadButton() {
        const btn = this.add.image(1770, 900, 'reload_button').setScrollFactor(0).setInteractive().setScale(1);
        btn.on('pointerdown', () => {
            if (this.reloading || this.bulletsInGun === 20 || this.totalBullets <= 0) return;
            this.canShoot = false;
            this.reloading = true;
            btn.setAlpha(0.5);
            setTimeout(() => {
                const needed = 20 - this.bulletsInGun;
                const refill = Math.min(needed, this.totalBullets);
                this.bulletsInGun += refill;
                this.totalBullets -= refill;
                this.reloading = false;
                this.canShoot = true;
                btn.setAlpha(1);
                this.ammoText.setText(`${this.bulletsInGun}/${this.totalBullets}`);
            }, 5000);
            this.sounds.reload.play();

        });
    }

    handleHeroMovement() {
        if (!this.hero || !this.hero.body) return;

        const fx = this.leftJoystick.dx;
        const fy = this.leftJoystick.dy;
        this.hero.setVelocityX(fx * 200);
        this.hero.setAngle(fx * 5);
        if (fx > 0) this.hero.setFlipX(false);
        else if (fx < 0) this.hero.setFlipX(true);
        if (fy < -0.5 && this.hero.body.touching.down) {
            this.hero.setVelocityY(-1000);
            this.sounds.jump.play();
        } if (fx !== 0) this.hero.anims.play('walk', true);
        else {
            this.hero.setVelocityX(0);
            this.hero.setAngle(0);
            this.hero.anims.stop();
            this.hero.setFrame(1);
        }
    }


    handleShooting(time) {
        if (!this.canShoot || !this.rightJoystick.active || this.reloading || this.bulletsInGun <= 0) return;
        const dx = this.rightJoystick.dx, dy = this.rightJoystick.dy;
        if (Math.abs(dx) < 0.2 && Math.abs(dy) < 0.2) return;
        if (time - this.lastBulletTime < this.bulletCooldown) return;
        this.lastBulletTime = time;
        this.bulletsInGun--;
        this.sounds.lazer_gun.play();

        this.ammoText.setText(`${this.bulletsInGun}/${this.totalBullets}`);
        const bullet = this.bullets.get(this.hero.x, this.hero.y, 'bullet');
        if (bullet) {
            bullet.setActive(true).setVisible(true);
            bullet.body.setAllowGravity(false);
            bullet.body.setCollideWorldBounds(false);
            const angle = Math.atan2(dy, dx);
            const vx = Math.cos(angle) * this.bulletSpeed;
            const vy = Math.sin(angle) * this.bulletSpeed;
            bullet.setVelocity(vx, vy);
            bullet.setRotation(angle);
            bullet.setDepth(1);
        }
    }
}

