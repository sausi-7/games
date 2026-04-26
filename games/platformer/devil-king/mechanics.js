export default class MultiverseKing extends Phaser.Scene {
    constructor() {
        super("MultiverseKing");

        Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach(fn => {
            if (typeof this[fn] === 'function') {
                this[fn] = this[fn].bind(this);
            }
        });
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


            const sheets = cfg.sheets || {};
            const heroData = sheets.hero || {};
            const rawMain = new URLSearchParams(window.location.search).get('main') || '';
            const cleanMain = rawMain.replace(/^"|"$/g, '');
            const sheetUrl = cleanMain || cfg.spritesheets?.hero?.path || heroData.url || 'default/hero.png'; // Fallback to default if none provided

            const frameW = cfg.spritesheets?.hero?.frameWidth || heroData.frameWidth || 103;
            const frameH = cfg.spritesheets?.hero?.frameHeight || heroData.frameHeight || 142;
            console.log(`Loading hero spritesheet from ${sheetUrl}`);
            this.load.spritesheet('hero', sheetUrl, {
                frameWidth: frameW,
                frameHeight: frameH,
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
                    this.load.audio(key, `${basePath}/${url}`);
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
        this.config = this.cache.json.get('levelConfig');
        this.mechanics = this.config.mechanics || {};
        this.texts = this.config.texts || {};

        this.gameStarted = false; // Initially false

        this.bgGroup = this.add.group();
        this.bgWidth = 1920;
        this.lastBGX = 0;
        for (let i = -1; i < Math.ceil(1920 / this.bgWidth) + 4; i++) {
            const x = i * this.bgWidth;
            const tile = this.add.image(x, 0, "background").setOrigin(0, 0).setDisplaySize(1920, 1080).setScrollFactor(1);
            tile.bgIndex = i;
            this.bgGroup.add(tile);
            this.lastBGX = x;
        }

        this.platforms = this.physics.add.staticGroup();
        for (let i = 0; i < 40; i++) {
            this.platforms.create(i * 400, 1030, 'platform').setScale(1).refreshBody();
        }
        this.platforms.create(1400, 600, 'platform').refreshBody();

        this.cactus = this.physics.add.sprite(2250, 940, "obstacle").setScale(1).setImmovable(true).setCollideWorldBounds(true);
        this.cactus.body.allowGravity = false;

        const portalX = 450, portalY = 450;
        this.portalFrame = this.add.image(portalX, portalY, "portalframe").setScale(0.5);
        this.portalRotation = this.add.image(portalX, portalY, "portalrotation").setScale(0.5);
        this.sys.tweens.add({ targets: this.portalRotation, angle: 360, duration: 1000, repeat: -1 });

        this.player = this.physics.add.sprite(portalX, portalY - 100, "hero").setCollideWorldBounds(true);
        this.player.setBounce(0.3).setAlpha(0).setDisplaySize(278, 278);
        this.player.health = this.mechanics.playerHealth ?? 100;
        this.player.bullets = this.mechanics.playerBullets ?? 5;
        this.facing = "right";
        this.lastHitTime = 0;

        this.physics.add.collider(this.player, this.platforms);
        this.physics.add.collider(this.player, this.cactus, this.handleCactusHit, null, this);


        this.heartIcon = this.add.image(50., 30, "heart").setScrollFactor(0).setScale(1);
        this.healthBarBg = this.add.rectangle(70, 20, 200, 20, 0x0B70A5).setOrigin(0).setScrollFactor(0);
        this.healthBar = this.add.rectangle(70, 20, 200, 20, 0xFFFFFF).setOrigin(0).setScrollFactor(0);

        this.bullets = this.physics.add.group();

        this.anims.create({
            key: "hero-walk",
            frames: this.anims.generateFrameNumbers("hero", { start: 1, end: 6 }),
            frameRate: 10,
            repeat: -1,
        });

        this.mafias = this.physics.add.group();
        this.physics.add.collider(this.mafias, this.platforms);
        this.physics.add.collider(this.player, this.mafias, this.handlePlayerHit, null, this);
        this.physics.add.overlap(this.bullets, this.mafias, this.hitEnemy, null, this);

        this.mafiasSpawned = false;
        this.mafia3Spawned = false;
        this.mafia4Spawned = false;
        this.mafia5Spawned = false;
        this.cactus2Placed = false;
        this.exitPortalCreated = false;
        this.playerDisappearing = false;

        this.sys.cameras.main.startFollow(this.player);
        this.sys.cameras.main.setBounds(0, 0, 8000, 1080);
        this.physics.world.setBounds(0, 0, 8000, 1080);
        this.input.addPointer(2);

        this.setupControls();

        this.sys.scale.on('resize', () => {
            this.setupControls();
        });

        this.bgm = this.sound.add("bgm", { loop: true, volume: 0.5 });
        this.bgm.play();


        this.input.once('pointerdown', () => {
            if (!this.scale.isFullscreen) {
                this.scale.startFullscreen();
            }
        });

        this.showStartScreen();



    }

    showStartScreen() {
        const centerX = this.sys.cameras.main.width / 2;
        const centerY = this.sys.cameras.main.height / 2;

        const titleText = this.texts.startScreen?.title || "How to Play";
        const descText = this.texts.startScreen?.description || "Guide King David across dimensions...";
        const buttonText = this.texts.startScreen?.startButton || "Start";

        this.startOverlay = this.add.container(centerX, centerY).setScrollFactor(0);

        // Add black rectangle for background dimming
        this.blackRect = this.add.rectangle(0, 0, this.sys.cameras.main.width, this.sys.cameras.main.height, 0x000000, 0.7)
            .setOrigin(0)
            .setScrollFactor(0)
            .setDepth(-1); // behind everything else


        // Dialog elements
        const bg = this.add.image(0, -50, 'dialog_bg_start').setDisplaySize(837, 417);
        const title = this.add.text(0, -170, titleText, {
            font: "bold 70px Arial",
            color: '#fff'
        }).setOrigin(0.5);

        const desc = this.add.text(0, 30, descText, {
            font: "60px Arial",
            color: '#fff',
            align: 'left',
            wordWrap: { width: 820 }
        }).setOrigin(0.5);

        const startBtn = this.add.image(0, 270, 'button')
            .setInteractive()
            .setScale(0.5)
            .setDisplaySize(837, 143);

        startBtn.on('pointerdown', () => {
            // Remove overlay and black background
            this.startOverlay.destroy();
            this.blackRect.destroy();
            this.gameStarted = true;

            this.sys.tweens.add({
                targets: this.player,
                alpha: 1,
                duration: 1000
            });

            this.time.delayedCall(100, () => {
                this.player.setAlpha(0);

                const fog = this.add.image(this.player.x, this.player.y, 'fog')
                    .setScale(0.4)
                    .setAlpha(0);

                this.sys.tweens.add({
                    targets: [this.player, fog],
                    alpha: 1,
                    duration: 800,
                    onUpdate: () => {
                        fog.setPosition(this.player.x, this.player.y);
                    },
                    onComplete: () => {
                        this.sys.tweens.add({
                            targets: [this.portalFrame, this.portalRotation, fog],
                            alpha: 0,
                            duration: 800,
                            onComplete: () => {
                                this.portalFrame.destroy();
                                this.portalRotation.destroy();
                                fog.destroy();
                            }
                        });
                    }
                });

                this.sys.cameras.main.zoomTo(1.2, 400, 'Sine.easeInOut');
                this.time.delayedCall(1000, () => {
                    this.sys.cameras.main.zoomTo(1, 500, 'Sine.easeInOut');
                });
            });
        });

        this.startOverlay.add([bg, title, desc, startBtn]);
    }

    endGame() {
        this.gameOver = true;
        this.physics.pause();

        const centerX = this.sys.cameras.main.scrollX + this.sys.cameras.main.width / 2;
        const centerY = this.sys.cameras.main.height / 2;

        const overlay = this.add.container(centerX, centerY);

        const bg = this.add.image(-40, -50, 'game_over').setDisplaySize(666, 216);
        const title = this.add.text(-20, -47, this.texts.gameOverScreen?.title || "Game Over", {
            font: "bold 70px Arial",
            color: '#fff'
        }).setOrigin(0.5);
        const btn = this.add.image(-20, 170, 'replay_button_big').setInteractive().setScale(0.5).setDisplaySize(666, 145);


        btn.on('pointerdown', () => {
            this.scene.restart();
        });

        overlay.add([bg, title, btn]);
    }

    showLevelComplete() {
        this.physics.pause();
        const centerX = this.sys.cameras.main.scrollX + this.sys.cameras.main.width / 2;
        const centerY = this.sys.cameras.main.height / 2;

        const overlay = this.add.container(centerX, centerY);

        const bg = this.add.image(0, 0, 'level_complete').setDisplaySize(914, 217);
        const title = this.add.text(-20, 3, 'Level Complete', {
            font: "bold 70px Arial",
            color: '#fff'
        }).setOrigin(0.5);

        const nxtbtn = this.add.image(240, 220, 'nextbtn').setInteractive();
        nxtbtn.on('pointerdown', () => {
            this.notifyParent('sceneComplete', { result: 'win' });
        });

        const replayBtn = this.add.image(-240, 220, 'replay_button')
            .setInteractive()



        replayBtn.on('pointerdown', () => {
            this.scene.restart();
        });



        overlay.add([bg, title, replayBtn, nxtbtn]);
    }



    updateHealthBar() {
        this.healthBar.width = Math.max((this.player.health / 100) * 200, 0);
    }

    notifyParent(type, data) {
        if (window.parent !== window) {
            window.parent.postMessage({ type, ...data }, "*");
        }
    }

    spawnMafiasAfterLanding() {
        if (this.mafiasSpawned) return;
        this.mafiasSpawned = true;
        const mafia1 = this.mafias.create(1600, 300, "enemy").setDisplaySize(197, 296).setCollideWorldBounds(true);
        mafia1.body.allowGravity = false;
        this.spawnFog(mafia1, true);

        const mafia2 = this.mafias.create(1300, 940, "enemy").setDisplaySize(197, 296).setCollideWorldBounds(true);
        mafia2.body.allowGravity = false;
        this.spawnFog(mafia2, true);
    }

    spawnMafia3() {
        this.mafia3 = this.mafias.create(this.cactus.x + 550, 940, "enemy").setDisplaySize(197, 296).setCollideWorldBounds(true);
        this.spawnFog(this.mafia3, true);
    }

    spawnMafia4(x) {
        this.mafia4 = this.mafias.create(x, 200, "enemy").setDisplaySize(197, 296).setCollideWorldBounds(true);
        this.mafia4.body.allowGravity = false;
        this.spawnFog(this.mafia4, true);
    }

    spawnCactus2(x) {
        this.cactus2 = this.physics.add.staticImage(x, 940, "obstacle").setScale(1).refreshBody();
        this.physics.add.collider(this.player, this.cactus2, this.handleCactusHit, null, this); // <-- Added collision logic
    }

    spawnMafia5(x) {
        this.mafia5 = this.mafias.create(x, 940, "enemy").setDisplaySize(197, 296).setCollideWorldBounds(true);
        this.spawnFog(this.mafia5, true);
    }

    createExitPortal(x) {
        const portalY = 880;
        this.exitPortalFrame = this.add.image(x, portalY, "portalframe").setScale(0.5);
        this.exitPortalRotation = this.add.image(x, portalY, "portalrotation").setScale(0.5);
        this.sys.tweens.add({ targets: this.exitPortalRotation, angle: 360, duration: 1000, repeat: -1 });
    }
    spawnFog(entity, enableGravityAfter = false) {
        // Place fog *on top* of enemy initially
        const fog = this.add.image(entity.x, entity.y, 'fog')
            .setScale(0.5)
            .setAlpha(1)
            .setDepth(entity.depth + 1); // Ensure fog is visible over enemy

        entity.setAlpha(0); // Hide enemy initially

        // Animate fog and fade in enemy together
        this.sys.tweens.add({
            targets: fog,
            alpha: 0,
            duration: 1500,
            ease: 'Sine.easeOut',
            onUpdate: () => {
                fog.setPosition(entity.x, entity.y); // Keep fog following enemy
            },
            onComplete: () => {
                fog.destroy();
                if (enableGravityAfter && entity.body) {
                    entity.body.allowGravity = true;
                }
            }

        });

        this.sys.tweens.add({
            targets: entity,
            alpha: 1,
            duration: 1000,
            delay: 300, // Delay enemy appearance slightly
            ease: 'Sine.easeInOut',
            onComplete: () => {
                if (enableGravityAfter && entity.body) {
                    entity.body.allowGravity = true;
                }
            }
        });
    }


    update() {
        if (!this.gameStarted) return; // 
        const scrollX = this.sys.cameras.main.scrollX;
        this.bgGroup.children.iterate((tile) => {
            if (tile.x + this.bgWidth < scrollX - this.bgWidth) {
                tile.x = this.lastBGX + this.bgWidth;
                tile.bgIndex += this.bgGroup.getLength();
                tile.setTexture("background");
                this.lastBGX = tile.x;
            }
        });

        const speed = this.mechanics.playerSpeed;

        if (this.joystickData && this.joystickData.force > 0.1) {
            const fx = this.joystickData.forceX;
            const fy = this.joystickData.forceY;

            this.player.setVelocityX(fx * speed);
            this.player.setAngle(fx * 5); // slight lean

            if (fx > 0) {
                this.player.setFlipX(false);
                this.facing = 'right';
            } else if (fx < 0) {
                this.player.setFlipX(true);
                this.facing = 'left';
            }

            if (fy < -0.5 && this.player.body.touching.down) {
                this.player.setVelocityY(this.mechanics.jumpVelocity ?? -1000);
            }

            this.player.anims.play('hero-walk', true);
        } else {
            this.player.setVelocityX(0);
            this.player.setAngle(0);
            this.player.anims.stop();
            this.player.setFrame(1);
        }

        // Handle end of level portal transition
        if (this.exitPortalCreated) {
            const exitX = this.exitPortalFrame.x;
            if (this.player.x > exitX - 50) {
                this.player.x = exitX - 50;
                this.player.setVelocityX(0);
            }

            if (
                this.mafias.countActive(true) === 0 &&
                this.player.x >= exitX - 50 &&
                !this.playerDisappearing
            ) {
                this.playerDisappearing = true;
                this.player.setVelocityX(0);
                this.sys.tweens.add({
                    targets: this.player,
                    alpha: 0,
                    duration: 200,
                    onComplete: () => {
                        this.player.disableBody(true, true);
                        // this.add.text(exitX - 150, this.player.y - 100, 'LEVEL COMPLETE!', {
                        //   fontSize: '48px',
                        //   fill: '#ffffff',
                        // }).setScrollFactor(0);
                        this.showLevelComplete()
                    },
                });
            }
        }

        if (!this.mafiasSpawned && this.player.body.onFloor()) this.spawnMafiasAfterLanding();
        if (!this.mafia3Spawned && this.player.x > this.cactus.x + 50) { this.spawnMafia3(); this.mafia3Spawned = true; }
        if (this.mafia3Spawned && !this.mafia4Spawned && this.player.x > this.mafia3.x + 50) { this.spawnMafia4(this.mafia3.x + 650); this.mafia4Spawned = true; }
        if (this.mafia4Spawned && !this.cactus2Placed && this.player.x > this.mafia4.x + 50) { this.spawnCactus2(this.mafia4.x + 650); this.cactus2Placed = true; }
        if (this.cactus2Placed && !this.mafia5Spawned && this.player.x > this.cactus2.x + 50) { this.spawnMafia5(this.cactus2.x + 650); this.mafia5Spawned = true; }

        if (!this.exitPortalCreated && this.mafia5Spawned && this.mafias.countActive(true) === 0) {
            this.createExitPortal(this.mafia5.x + 550);
            this.exitPortalCreated = true;
        }

        this.mafias.children.iterate(mafia => {
            if (!mafia.body || !mafia.body.allowGravity) return;
            const mafiaSpeed = this.mechanics.enemySpeed ?? 200;


            const diffX = this.player.x - mafia.x;

            if (Math.abs(diffX) > 5) {  // prevent jitter when too close
                mafia.setVelocityX(diffX > 0 ? mafiaSpeed : -mafiaSpeed);
                mafia.setFlipX(diffX < 0); // face direction of movement
            } else {
                mafia.setVelocityX(0); // stop moving when very close
            }
        });




    }

    shootBullet() {
        if (this.player.bullets > 0) {
            const bullet = this.bullets.create(this.player.x, this.player.y, "bullet");
            const bulletSpeed = this.mechanics.bulletSpeed ?? 800;
            bullet.setVelocityX(this.facing === "left" ? -bulletSpeed : bulletSpeed);

            bullet.body.allowGravity = false;


            this.sound.play("laser", { volume: 1 });
        }
    }


    hitEnemy(bullet, enemy) {
        bullet.destroy();
        if (enemy.active) enemy.destroy();
    }


    handlePlayerHit(player, enemy) {
        const now = this.time.now;
        if (now - this.lastHitTime < 1000) return;
        this.lastHitTime = now;

        this.sound.play("ouch");  // <--- Play ouch sound

        player.health -= this.mechanics.enemyDamage ?? 20;

        this.updateHealthBar();

        player.setTint(0xff4444);
        this.time.delayedCall(300, () => {
            player.clearTint();
        });

        const knockback = 300;
        player.setVelocityX(player.x < enemy.x ? -knockback : knockback);
        player.setVelocityY(-200);

        if (player.health <= 0) this.gameOver();
    }


    handleCactusHit(player, cactus) {
        const now = this.time.now;
        if (now - this.lastHitTime < 1000) return;
        this.lastHitTime = now;

        this.sound.play("ouch");  // <--- Play ouch sound

        player.health -= this.mechanics.cactusDamage ?? 10;

        this.updateHealthBar();

        player.setTint(0xff4444);
        this.time.delayedCall(300, () => {
            player.clearTint();
        });

        const knockback = 300;
        player.setVelocityX(player.x < cactus.x ? -knockback : knockback);
        player.setVelocityY(-200);

        if (player.health <= 0) this.gameOver();
    }


    gameOver() {
        this.player.setTint(0xff0000);
        this.physics.pause();
        this.time.delayedCall(1000, () => {
            this.joystickData = null;  // <-- ADD THIS LINE
            this.shootButton = null;
            this.endGame()
            // <-- OPTIONAL but recommended
            // this.scene.restart();
        });
    }


    setupControls() {
        const cam = this.sys.cameras.main;

        const shootBtnX = cam.width - 200;
        const shootBtnY = cam.height / 2;
        const joyX = 200;
        const joyY = cam.height / 2;

        // Destroy existing UI if any
        if (this.shootButton) this.shootButton.destroy();
        if (this.joystickData?.knob) this.joystickData.knob.destroy();
        if (this.joystickData?.bg) this.joystickData.bg.destroy();

        // Recreate shoot button
        this.shootButton = this.add.image(shootBtnX, shootBtnY, 'joystick_knob')
            .setScrollFactor(0)
            .setDepth(12)
            .setScale(0.8)
            .setInteractive();

        this.shootButton.on('pointerdown', () => {
            this.shootBullet();
        });

        // Recreate joystick
        const bg = this.add.image(joyX, joyY, "joystick_bg")
            .setDepth(10)
            .setScrollFactor(0)
            .setInteractive();

        const knob = this.add.image(joyX, joyY, "joystick_knob")
            .setDepth(11)
            .setScrollFactor(0)
            .setInteractive();

        this.joystickData = {
            knob,
            bg,
            forceX: 0,
            forceY: 0,
            get force() {
                return Math.sqrt(this.forceX ** 2 + this.forceY ** 2);
            }
        };

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
    }
}