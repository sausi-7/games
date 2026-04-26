export default class GameScene extends Phaser.Scene {
    constructor() {
        super('GameScene');
        Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach(fn => {
            if (typeof this[fn] === 'function') {
                this[fn] = this[fn].bind(this);
            }
        });

        // Game objects
        this.player = null;
        this.gameStarted = false;

        // Obstacle groups
        this.platforms = null;
        this.burningRocks = null;
        this.branches = null;
        this.eagles = null;

        // Collectible groups
        this.bluePowers = null;
        this.spellBooks = null;

        // Track the last platform position for endless generation
        this.lastPlatformX = 0;
        this.lastRockX = -Infinity;

        // UI elements
        this.healthBar = null;
        this.powerBar = null;
        this.scoreText = null;
        this.healthIcon = null;
        this.powerIcon = null;
        this.scoreIcon = null;

        // Game state
        this.score = 0;
        this.health = 6; // Player starts with 3 health
        this.power = 0;  // Player starts with 0 power
        this.gameOver = false;
        this.gameSpeed = 500;
        this.targetGameSpeed = 300; // Target speed for smooth acceleration

        // Controls
        this.cursors = null;

        // Timers
        this.obstacleTimer = null;
    }

    preload() {

        // determine base path for assets
        const basePath = import.meta.url.substring(
            0,
            import.meta.url.lastIndexOf('/')
        );

        // load our JSON config (which now includes a `fonts` array)
        this.load.json('levelConfig', `${basePath}/config.json`);

        this.load.once('filecomplete-json-levelConfig', () => {
            const cfg = this.cache.json.get('levelConfig');
            this.mechanics = cfg.mechanics || {};

            // ─── inject fonts from JSON ──────────────────────────

            // ────────────────────────────────────────────────────

            // now load the hero spritesheet (as before)
            const sheets = cfg.sheets || {};
            const heroData = sheets.hero || {};
            const rawMain = new URLSearchParams(window.location.search).get('main') || '';
            const cleanMain = rawMain.replace(/^"|"$/g, '');
            const sheetUrl =
                cleanMain ||
                heroData.url ||
                `${basePath}/assets/eve_spritesheet.png`;

            const frameW = heroData.frameWidth || 103;
            const frameH = heroData.frameHeight || 142;
            this.load.spritesheet('player', sheetUrl, {
                frameWidth: frameW,
                frameHeight: frameH,
            });


            // other spritesheets
            if (cfg.spritesheets) {
                for (const [key, sheet] of Object.entries(cfg.spritesheets)) {
                    this.load.spritesheet(key, sheet.path, {
                        frameWidth: sheet.frameWidth,
                        frameHeight: sheet.frameHeight,
                    });
                }
            }

            // audio
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
            this.load.audio(
                'background_music',
                // adjust path as needed
                `${basePath}/assets/background_music.mp3`
            );


            // start loading everything
            this.load.start();
        });
    }

    create() {

        const cfg = this.cache.json.get('levelConfig');
        this.mechanics = cfg.mechanics;
        // Apply orientation from config
        if (cfg.orientation?.frame === 'landscape' && screen.orientation && screen.orientation.lock) {
            screen.orientation
                .lock('landscape-primary')
                .catch(err => console.warn('Orientation lock failed:', err));
        }



        this.gameSpeed = this.mechanics.gameSpeed;
        this.targetGameSpeed = this.mechanics.targetGameSpeed;
        this.health = this.mechanics.initialHealth;
        this.power = this.mechanics.initialPower;
        // this.bg1 = this.add.image(0, 0, 'blur_background')
        //     .setOrigin(0, 0)
        //     .setScrollFactor(0);

        const music = this.sound.add('background_music', {
            loop: true
        });
        music.play();




        // this.input.once('pointerdown', () => {
        //     if (!this.scale.isFullscreen) {
        //         this.scale.startFullscreen();
        //     }
        // });

        // start the actual game immediately:
        this.showStartScreen();
    }

    showStartScreen() {

        const centerX = this.sys.cameras.main.width / 2;
        const centerY = this.sys.cameras.main.height / 2;
        // if (!this.sound.get('background_music')) {
        //     const music = this.sound.add('background_music', {
        //         loop: true
        //     });
        //     music.play();
        // }
        // create a container to hold everything
        this.startOverlay = this.add.container(centerX, centerY).setScrollFactor(0);

        const bg = this.add.image(0, -100, 'htp').setDepth(10).setScale(1).setOrigin(0.5);
        const title = this.add.text(-180, -390, 'How to Play', { font: "bold 70px Outfit", color: '#fff' })
            .setDepth(11).setOrigin(0.5, -1);
        const rock = this.add.image(centerX + 135, centerY - 100, 'burning-rock').setScale(0.3).setDepth(13).setOrigin(0.5);
        const eagle = this.add.image(centerX + 235, centerY - 100, 'enemy').setScale(0.3).setDepth(13).setOrigin(0.5);
        const desc = this.add.text(-5, -120, 'Avoid obstacles like        ,      .\nSwipe up to jump, swipe twice for\nan extra bounce', {
            font: "60px Outfit", color: '#fff', align: 'left',
        }).setOrigin(0.5, 0);
        const startBtn = this.add.image(0, 260, 'play_game')
            .setInteractive()
            .setScale(1)
            .setDepth(14);

        startBtn.on('pointerdown', () => {
            this.input.on('pointerup', () => {
                if (this.scale.fullscreen.available) {
                    this.scale.startFullscreen();
                }
            });
            // if (!this.scale.isFullscreen) {
            //     this.scale.startFullscreen();
            // }
            this.startOverlay.destroy();
            rock.destroy();
            eagle.destroy();
            this.gameStartScreen();
        });

        this.startOverlay.add([bg, title, desc, startBtn]);
    }

    endGame() {
        this.gameOver = true;
        this.physics.pause();
        this.burningRocks.clear(true, true);
        this.eagles.clear(true, true);

        const centerX = this.sys.cameras.main.scrollX + this.sys.cameras.main.width / 2;
        const centerY = this.sys.cameras.main.height / 2;

        const overlay = this.add.container(centerX, centerY);

        const bg = this.add.image(0, -90, 'game_over').setOrigin(0.5).setDepth(30);

        const btn = this.add.image(0, 120, 'replay_level').setInteractive().setScale(1).setDepth(35);

        btn.on('pointerdown', () => {
            this.scene.restart();
        });

        overlay.add([bg, btn]);
    }


    showLevelComplete() {
        this.physics.pause();
        const centerX = this.sys.cameras.main.scrollX + this.sys.cameras.main.width / 2;
        const centerY = this.sys.cameras.main.height / 2;

        const overlay = this.add.container(centerX, centerY);
        this.burningRocks.clear(true, true);
        this.eagles.clear(true, true);
        const bg = this.add.image(0, -70, 'level_complete').setDepth(25);


        const replayBtn = this.add.image(-230, 150, 'replay')
            .setInteractive()
            .setScale(1)
            .setDepth(46);


        const nextBtn = this.add.image(230, 150, 'next')
            .setInteractive().setDepth(46);

        replayBtn.on('pointerdown', () => {
            this.scene.restart();
        });

        nextBtn.on('pointerdown', () => {

            this.notifyParent('sceneComplete', { result: 'win' })
            console.log('sceneComplete');
        });

        overlay.add([bg, replayBtn, nextBtn]);
    }


    gameStartScreen() {
        // Add background - create a repeating background for endless effect
        this.bg1 = this.add.tileSprite(0, 0, this.sys.game.config.width, this.sys.game.config.height, 'background')
            .setOrigin(0, 0)
            .setScrollFactor(0);


        this.jumpSound = this.sound.add('jump');
        this.collectSound = this.sound.add('collect');
        this.collisionSound = this.sound.add('collision');
        this.birdHitSound = this.sound.add('bird_hit');
        // Game state
        this.score = 0;
        this.health = this.mechanics.initialHealth;
        this.power = this.mechanics.initialPower; // Player starts with 0 power
        this.gameOver = false;
        this.gameSpeed = this.mechanics.gameSpeed;
        this.targetGameSpeed = this.mechanics.targetGameSpeed;// Target speed for smooth acceleration
        this.canDoubleJump = false; // Track if player can double jump
        this.hasDoubleJumped = false; // Track if player has used double jump
        this.wasInAir = false;



        // Set up touch controls for mobile with double jump support
        this.input.on('pointerdown', (pointer) => {
            // First jump when on the ground
            if (this.player.body.touching.down) {
                this.jumpSound.play();
                this.player.setVelocityY(-800);
                this.player.anims.play('jump', true);

                // Enable double jump when player jumps from the ground
                this.canDoubleJump = true;
                this.hasDoubleJumped = false;

                // // Add jump particles
                // this.jumpEmitter.setPosition(this.player.x, this.player.y + 50);
                // this.jumpEmitter.explode();

                // Add a small camera effect for jump feedback
                this.sys.cameras.main.shake(100, 0.003);
            }
            // Double jump when in the air and double jump is available
            else if (!this.player.body.touching.down && this.canDoubleJump && !this.hasDoubleJumped) {
                // Perform double jump with slightly higher velocity to dodge eagles
                this.jumpSound.play();
                this.player.setVelocityY(-750);
                this.player.anims.play('jump', true);

                // Mark double jump as used
                this.hasDoubleJumped = true;
                this.canDoubleJump = false;

                // Add a stronger camera effect for double jump feedback
                this.sys.cameras.main.shake(150, 0.004);

                // Create a more dramatic particle effect for double jump
                // this.jumpEmitter.setPosition(this.player.x, this.player.y + 30);
                // this.jumpEmitter.explode(15); // More particles for double jump

                // No need for horizontal speed boost since we're controlling player position directly
            }
        });

        // Add touch release handler to end sliding immediately
        this.input.on('pointerup', (pointer) => {
            // No specific action needed for pointerup with double jump mechanic
        });

        // No ground object - platform-long will be the ground layer

        // Create obstacle groups - MUST be initialized before using them
        this.platforms = this.physics.add.group();
        this.burningRocks = this.physics.add.group();
        this.branches = this.physics.add.group();
        this.eagles = this.physics.add.group();
        this.bluePowers = this.physics.add.group();
        this.spellBooks = this.physics.add.group();

        // Create long platform for player to walk on
        this.longPlatform = this.physics.add.staticGroup();
        // Create multiple long platforms to cover the width of the game
        this.lastPlatformX = 0;
        for (let i = 0; i < 5; i++) {
            const platform = this.longPlatform.create(i * 400, this.sys.game.config.height, 'platform-long')
                .setOrigin(0, 1)
                .setImmovable(true) // Ensure platform doesn't move when player lands on it
                .refreshBody(); // Ensure physics body is updated
            this.lastPlatformX = Math.max(this.lastPlatformX, platform.x + platform.width);
        }
        this.longPlatform.children.iterate((plat) => {
            // say your blades are 20px tall
            const bladeHeight = 120;
            plat.body
                .setSize(plat.displayWidth, plat.displayHeight - bladeHeight)
                .setOffset(0, bladeHeight);
        });
        const groundTile = this.longPlatform.getChildren()[0];
        const samplePlat = this.longPlatform.getChildren()[0];
        const groundTopY = this.sys.game.config.height - samplePlat.displayHeight;
        this.groundTopY = groundTopY;
        // We'll create initial floating platforms after player setup

        // Create player - position it just above the ground platform
        this.player = this.physics.add.sprite(100, groundTopY, 'player').setOrigin(0.5, 1).setScale(2.5).setDepth(5);
        // 2) size & offset the body so the box hugs her boots


        this.player.body
            .setSize(50, 130)
            .setOffset(25, 20);

        // 3) any other settings…
        this.player.setBounce(0.1);
        this.player.setCollideWorldBounds(false);

        // Set up camera with bounds but don't follow player
        // We'll manually control camera position in update()
        this.sys.cameras.main.setBounds(0, 0, Number.MAX_SAFE_INTEGER, this.sys.game.config.height);
        // Don't use startFollow as we're manually controlling camera position



        // Set up animations
        this.anims.create({
            key: 'run',
            frames: [
                { key: 'player', frame: 3 },
                { key: 'player', frame: 2 },
                { key: 'player', frame: 0 },
            ],
            frameRate: 7, // Increased frame rate for smoother animation
            repeat: -1
        });

        // Create dust particle effect for sliding
        // this.slideParticles = this.add.particles('player');
        // this.slideEmitter = this.add.particles(
        //     0,               // initial x (ignored once you use `follow`)
        //     0,               // initial y
        //     'player',        // texture key
        //     {
        //         frame: 1,
        //         lifespan: 600,
        //         speed: { min: 50, max: 100 },
        //         angle: { min: 180, max: 360 },
        //         scale: { start: 0.2, end: 0 },
        //         quantity: 1,
        //         blendMode: 'ADD',
        //         on: false,
        //         follow: this.player    // make the emitter follow the player
        //     }
        // );


        // Create a subtle trail effect for the player
        // this.trailParticles = this.add.particles('player');
        // this.trailEmitter = this.add.particles(
        //     0, 0, 'player',
        //     {
        //         frame: 0,
        //         lifespan: 300,
        //         alpha: { start: 0.3, end: 0 },
        //         scale: { start: 0.5, end: 0.1 },
        //         quantity: 1,
        //         frequency: 100,
        //         blendMode: 'ADD',
        //         follow: this.player
        //     }
        // );
        // this.trailEmitter.startFollow(this.player);

        // Create jump particle effect
        // this.jumpParticles = this.add.particles('player');
        // this.jumpEmitter = this.add.particles(
        //     0, 0, 'player',
        //     {
        //         frame: 0,
        //         lifespan: 500,
        //         speed: { min: 50, max: 150 },
        //         angle: { min: 230, max: 310 },
        //         scale: { start: 0.4, end: 0 },
        //         quantity: 8,
        //         blendMode: 'ADD',
        //         on: false,
        //         follow: this.player
        //     }
        // );

        // Add a landing animation for smoother transition
        this.anims.create({
            key: 'land',
            frames: [
                { key: 'player', frame: 1 },
                { key: 'player', frame: 1 }
            ],
            frameRate: 20,
            repeat: 0
        });

        this.anims.create({
            key: 'jump',
            frames: [
                { key: 'player', frame: 3 },
                { key: 'player', frame: 2 },
                { key: 'player', frame: 0 }
            ],
            frameRate: 10,
            repeat: 0
        });

        this.anims.create({
            key: 'slide',
            frames: [{ key: 'player', frame: 10 }],
            frameRate: 1,
            repeat: 0
        });

        // UI elements setup

        // Add UI elements
        // Health bar (red)
        this.healthBar = this.add.image(420, 80, 'red-bar-full').setScrollFactor(0);
        // this.healthIcon = this.add.image(40, 40, 'heart-icon').setScrollFactor(0);

        // Power bar (blue)
        this.powerBar = this.add.image(this.sys.game.config.width - 400, 80, 'blue-bar-empty').setScrollFactor(0);
        // this.powerIcon = this.add.image(40, 80, 'magic-icon').setScrollFactor(0);


        // Set up input controls
        this.cursors = this.input.keyboard.createCursorKeys();

        // Set up collisions with improved platform handling
        this.physics.add.collider(this.player, this.platforms, null, function (player, platform) {
            // Only allow collision if player is moving downward or standing on platform
            return player.body.velocity.y >= 0;
        }, this);
        this.physics.add.collider(this.player, this.longPlatform, null, function (player, platform) {
            // Only allow collision if player is moving downward or standing on platform
            // Prevent collision when pressing down (sliding)
            return player.body.velocity.y >= 0 && !this.cursors.down.isDown;
        }, this);

        this.physics.add.collider(this.player, this.burningRocks, this.hitObstacle, null, this);
        this.physics.add.collider(this.player, this.branches, this.hitObstacle, null, this);
        this.physics.add.collider(this.player, this.eagles, this.hitObstacle, null, this);

        this.physics.add.overlap(this.player, this.bluePowers, this.collectPower, null, this);
        this.physics.add.overlap(this.player, this.spellBooks, this.collectSpellBook, null, this);



        // Create initial obstacles
        this.spawnObstacle();
        // this.spawnObstacle();



        // Initialize game variables
        this.score = 0;
        // this.scoreText.setText(this.score);
        this.health = 6; // Player starts with 3 health
        this.power = 0;  // Player starts with 0 power

        // Start the game
        this.gameOver = false;
        this.isSliding = false; // Track sliding state
        this.wasInAir = false; // Track if player was in the air

        // Create initial floating platforms now that everything is set up
        for (let i = 0; i < 3; i++) {
            // this.spawnFloatingPlatform();
        }

        this.gameStarted = true;
    }





    update() {
        if (!this.gameStarted) {
            return;   // <-- don’t run any of your scrolling / player logic yet
        }

        if (this.gameOver) {
            return;
        }

        // Scroll the background to create endless effect
        this.bg1.tilePositionX += this.gameSpeed / 120;

        // Move the camera forward to create the illusion of player moving toward burning rocks
        this.sys.cameras.main.scrollX += this.gameSpeed / 120;

        // Keep player at a fixed position relative to the camera
        // This creates the illusion that the player is moving toward the burning rocks
        this.player.x = this.sys.cameras.main.scrollX + 400;

        // No need to handle horizontal movement with arrow keys anymore
        // since we're keeping the player at a fixed position relative to the camera

        // If player falls off the screen, reset position
        if (this.player.y > this.sys.game.config.height) {
            this.player.y = this.sys.game.config.height - 120;
            this.player.setVelocityY(0);
            this.player.body.setSize(50, 130);
            this.player.body.setOffset(25, 0);
        }

        // Generate new platforms as player moves forward
        // Check if player is approaching the end of the current platforms
        if (this.player.x > this.lastPlatformX - 1920) {
            this.generateNewPlatform();
        }


        // Handle animations with smoother transitions
        if (this.player.body.touching.down) {
            // Just landed
            if (this.wasInAir) {
                this.wasInAir = false;

                // Add a small camera shake for impact feedback
                this.sys.cameras.main.shake(100, 0.005);

                this.player.anims.play('run', true);
                // Chain the run animation after landing completes
                this.player.on('animationcomplete-land', () => {
                    if (!this.isSliding && this.player.body.touching.down) {
                        this.player.anims.play('run', true);
                    }
                });
            }
            // Already on ground and not sliding
            else if (!this.isSliding && !this.cursors.down.isDown) {
                this.player.anims.play('run', true);
            }
        } else {
            // Player is in the air
            this.wasInAir = true;
        }

        // Handle player jumping with double jump capability
        const jumpKey = this.cursors.up.isDown || this.input.keyboard.addKey('SPACE').isDown;

        // First jump when on the ground
        if (jumpKey && this.player.body.touching.down) {
            this.jumpSound.play();
            this.player.setVelocityY(-700); // Increased jump velocity to match higher gravity
            this.player.anims.play('jump', true);

            // Enable double jump when player jumps from the ground
            this.canDoubleJump = true;
            this.hasDoubleJumped = false;

            // Add a small camera effect for jump feedback
            this.sys.cameras.main.shake(100, 0.003);

            // Trigger jump particle effect
            // this.jumpEmitter.setPosition(this.player.x, this.player.y + 50);
            // this.jumpEmitter.explode();
        }
        // Double jump when in the air and double jump is available
        else if (jumpKey && !this.player.body.touching.down && this.canDoubleJump && !this.hasDoubleJumped) {
            // Perform double jump with slightly higher velocity to dodge eagles
            this.jumpSound.play();
            this.player.setVelocityY(this.mechanics.playerDoubleJumpVelocity);
            this.player.anims.play('jump', true);

            // Mark double jump as used
            this.hasDoubleJumped = true;
            this.canDoubleJump = false;

            // Add a stronger camera effect for double jump feedback
            this.sys.cameras.main.shake(150, 0.004);

            // Create a more dramatic particle effect for double jump
            // this.jumpEmitter.setPosition(this.player.x, this.player.y + 30);
            // this.jumpEmitter.explode(15); // More particles for double jump

            // No need for horizontal speed boost since we're controlling player position directly
        }

        // Reset double jump ability when landing
        if (this.player.body.touching.down) {
            if (this.wasInAir) {
                // Reset double jump flags when landing
                this.canDoubleJump = false;
                this.hasDoubleJumped = false;
            }
        }

        // Maintain normal player hitbox
        this.player.body.setSize(50, 130);
        this.player.body.setOffset(25, 20);

        // Update score with visual feedback
        this.score += 1;
        // this.scoreText.setText(this.score);


        // Increase game speed gradually with smoother transitions
        if (this.score % 100 === 0 && this.score > 0) {
            // Target a higher speed but transition to it smoothly
            this.targetGameSpeed = Math.min(500, this.gameSpeed + 20);
        }

        // Smooth transition to target speed
        if (this.gameSpeed < this.targetGameSpeed) {
            this.gameSpeed += 0.5; // Gradually increase speed
        } else if (this.gameSpeed > this.targetGameSpeed) {
            // this.gameSpeed -= 0.5; // Gradually decrease speed when coming out of power mode
        }

        // Move obstacles
        this.moveGroup(this.burningRocks);
        this.moveGroup(this.branches);
        this.moveGroup(this.eagles);

        // Move platforms
        this.moveGroup(this.platforms);

        // Move collectibles
        this.moveGroup(this.bluePowers);
        // this.moveGroup(this.spellBooks);

        // We're now manually controlling the camera position
        // No need to follow the player as we're keeping it at a fixed position relative to the camera

        // Update power glow position if active
        if (this.powerGlow) {
            this.powerGlow.x = this.player.x;
            this.powerGlow.y = this.player.y;
        }

        // Update blue power orb glows
        this.bluePowers.getChildren().forEach(powerOrb => {
            if (powerOrb.glow) {
                powerOrb.glow.x = powerOrb.x;
                powerOrb.glow.y = powerOrb.y;
            }
        });

        // Update spell book glows
        this.spellBooks.getChildren().forEach(book => {
            if (book.glow) {
                book.glow.x = book.x;
                book.glow.y = book.y;
            }
        });
    }

    notifyParent(type, data) {
        if (window.parent !== window) {
            window.parent.postMessage({ type, ...data }, "*");
        }
    }

    moveGroup(group) {
        group.getChildren().forEach(item => {
            // Only move items that don't have tweens (eagles have their own movement)
            if (!this.sys.tweens.getTweensOf(item).length) {
                // Apply smoother movement with delta time for consistent speed
                const deltaFactor = this.game.loop.delta / 16.666; // Normalize to 60fps

                // Don't move burning rocks - they should appear stationary on the platform
                // while the player moves toward them
                if (group !== this.burningRocks) {
                    const speedFactor = 60;
                    const targetX = item.x - (this.gameSpeed / speedFactor) * deltaFactor;
                    item.x = Phaser.Math.Linear(item.x, targetX, 0.8); // Smooth interpolation
                }
            }

            // Remove items that are off-screen (to the left)
            if (item.x < this.sys.cameras.main.scrollX - item.width) {
                // If the item has a glow effect, destroy it too
                if (item.glow) {
                    item.glow.destroy();
                }
                item.destroy();
            }

            // Also remove items that are far behind (to the right)
            if (item.x > this.sys.cameras.main.scrollX + this.sys.game.config.width + 1000) {
                // If the item has a glow effect, destroy it too
                if (item.glow) {
                    item.glow.destroy();
                }
                item.destroy();
            }
        });
    }

    spawnObstacle() {
        if (this.gameOver) return;

        // Randomly select obstacle type
        const obstacleType = Phaser.Math.Between(1, 2);
        let obstacle;

        // Calculate spawn position based on camera position
        const cameraRight = this.sys.cameras.main.scrollX + this.sys.game.config.width;

        // Use the improved checkOverlap function for better spacing
        // Calculate base spawn position with random offset
        const baseOffset = Phaser.Math.Between(500, 900); // Increased spacing
        let spawnX = cameraRight + baseOffset;
        let spawnY = this.sys.game.config.height - 120; // Default Y position for ground obstacles

        // Ensure minimum gap from last rock and no overlap with other obstacles
        const minGap = 500; // Increased minimum gap from last obstacle
        spawnX = Math.max(spawnX, this.lastRockX + minGap);

        // If there's an overlap, try to find a better position
        let attempts = 0;
        const maxAttempts = 8; // More attempts to find a good position
        while (this.checkOverlap(spawnX, spawnY, 300) && attempts < maxAttempts) {
            spawnX += 250; // Move further to avoid overlap
            attempts++;
        }

        this.lastRockX = spawnX;

        switch (obstacleType) {
            case 1: // Burning rock - static obstacle on the ground
                obstacle = this.burningRocks.create(spawnX, this.sys.game.config.height - 120, 'burning-rock').setDepth(8);
                obstacle.setScale(1); // Scale down the rock slightly
                obstacle.setSize(150, 230);
                break;


            case 2: // Eagle (flying obstacle) - moves horizontally
                obstacle = this.eagles.create(spawnX, this.sys.game.config.height - 300, 'enemy').setDepth(8).setScale(1);

                break;
        }

        // Set obstacle properties
        obstacle.setImmovable(true);
        obstacle.setOrigin(0, 1);
        obstacle.body.setAllowGravity(false);



        // Occasionally spawn a blue power orb with decreased frequency
        if (Phaser.Math.Between(1, 50) <= 2) { // Reduced from 1 in 10 to 1 in 20
            this.spawnBluePower();
        }

        // Occasionally spawn the spell book (goal) after a certain score
        if (this.score > 1000 && Phaser.Math.Between(1, 100) <= 50) {
            this.spawnSpellBook();
        }
    }

    spawnFloatingPlatform() {
        // Choose random platform type
        const platformType = Phaser.Math.Between(0, 1);
        const platformY = Phaser.Math.Between(this.sys.game.config.height - 300, this.sys.game.config.height - 180);

        // Create platform at a random x position relative to camera
        const platformX = Phaser.Math.Between(
            this.sys.cameras.main.scrollX + this.sys.game.config.width / 2,
            this.sys.cameras.main.scrollX + this.sys.game.config.width
        );

        // Check for overlap with existing obstacles and platforms
        if (this.checkOverlap(platformX, platformY, 200)) {
            // Try again later if there's an overlap
            return;
        }

        // Create platform
        const platform = this.platforms.create(
            platformX,
            platformY,
            'platform-float' + platformType
        );

        platform.setImmovable(true);
        platform.setOrigin(0, 1);
        platform.body.setAllowGravity(false);

        // Adjust the platform's physics body to make it easier to land on
        const platformHeight = 20; // Height of the collision area
        platform.body.setSize(platform.width, platformHeight);
        platform.body.setOffset(0, platform.height - platformHeight);

        platform.refreshBody(); // Ensure physics body is updated

        // Always spawn a blue power orb on the platform
        const powerOrb = this.bluePowers.create(platformX + platform.width / 2, platformY - 50, 'blue-power');

        // Add glow effect
        const glow = this.add.image(powerOrb.x, powerOrb.y, 'blue-glow');
        glow.setAlpha(0.7);

        // Group them together
        powerOrb.glow = glow;

        powerOrb.setImmovable(true);
        powerOrb.body.setAllowGravity(false);
    }

    // Helper function to check if a new object would overlap with existing objects
    checkOverlap(x, y, minDistance) {
        // Increase minimum distance to prevent objects from being too close
        const safeDistance = minDistance * 1.5;

        // Check burning rocks with both x and y distance
        if (this.burningRocks.getChildren().some(rock =>
            Math.abs(rock.x - x) < safeDistance && Math.abs(rock.y - y) < 150)) {
            return true;
        }

        // Check branches with both x and y distance
        if (this.branches.getChildren().some(branch =>
            Math.abs(branch.x - x) < safeDistance && Math.abs(branch.y - y) < 150)) {
            return true;
        }

        // Check eagles with both x and y distance
        if (this.eagles.getChildren().some(eagle =>
            Math.abs(eagle.x - x) < safeDistance && Math.abs(eagle.y - y) < 150)) {
            return true;
        }

        // Check blue powers with both x and y distance
        if (this.bluePowers.getChildren().some(power =>
            Math.abs(power.x - x) < safeDistance && Math.abs(power.y - y) < 100)) {
            return true;
        }

        // Check spell books with both x and y distance
        if (this.spellBooks.getChildren().some(book =>
            Math.abs(book.x - x) < safeDistance && Math.abs(book.y - y) < 100)) {
            return true;
        }

        // Check platforms with both x and y distance
        if (this.platforms.getChildren().some(platform =>
            Math.abs(platform.x - x) < safeDistance && Math.abs(platform.y - y) < 150)) {
            return true;
        }

        return false;
    }

    spawnBluePower() {
        // Create blue power orb relative to camera position
        // const powerY = Phaser.Math.Between(game.config.height - 300, game.config.height - 200);
        const powerY = this.groundTopY - Phaser.Math.Between(20, 60);
        const powerX = this.sys.cameras.main.scrollX + this.sys.game.config.width;
        if (this.bluePowers.getChildren().some(o => Math.abs(o.x - powerX) < 200)) {
            return;
        }
        const powerOrb = this.bluePowers.create(powerX, powerY, 'blue-power');

        // Add glow effect
        const glow = this.add.image(powerOrb.x, powerOrb.y, 'blue-glow');
        glow.setAlpha(0.7);

        // Group them together
        powerOrb.glow = glow;

        powerOrb.setImmovable(true);
        powerOrb.body.setAllowGravity(false);
    }

    collectPower(player, powerOrb) {
        // Store position before destroying the orb
        const orbX = powerOrb.x;
        const orbY = powerOrb.y;

        // Remove the power orb and its glow
        if (powerOrb.glow) {
            powerOrb.glow.destroy();
        }
        this.collectSound.play();
        powerOrb.destroy();

        // Increase power
        this.power++;

        // Update power bar
        if (this.power <= 3) {
            this.powerBar.setTexture('blue-bar-' + (this.power === 1 ? 'half' : 'full'));
        }

        // Add a small camera shake for feedback
        this.sys.cameras.main.shake(100, 0.002);

        // If power is full, enable special ability
        if (this.power >= 3) {
            this.activatePowerMode();
        }
    }

    activatePowerMode() {
        // Reset power counter
        this.power = 0;
        this.powerBar.setTexture('blue-bar-empty');

        // Set invulnerability flag
        this.isInvulnerable = true;

        // Store original game speed
        this.originalGameSpeed = this.gameSpeed;

        // Increase game speed temporarily
        this.gameSpeed += 100;
        this.targetGameSpeed = this.gameSpeed;

        // Add blur effect to the player
        this.player.setTint(0x00ffff);

        // Add glow effect
        this.powerGlow = this.add.image(this.player.x, this.player.y, 'blue-glow');
        this.powerGlow.setAlpha(0.7);
        this.powerGlow.setScale(2);

        // Create a continuous particle trail
        // this.powerTrail = this.add.particles('blue-glow');
        // this.powerTrailEmitter = this.add.particles(
        //     this.player.x, this.player.y, 'blue-glow', {
        //     follow: this.player,
        //     speed: { min: 10, max: 50 },
        //     angle: { min: 0, max: 360 },
        //     scale: { start: 0.3, end: 0 },
        //     lifespan: 500,
        //     quantity: 2,
        //     blendMode: 'ADD',
        //     frequency: 20
        // });

        // Add a camera effect for power-up feedback
        this.sys.cameras.main.shake(200, 0.005);

        // Create a timer to deactivate power mode after 5 seconds
        this.powerModeTimer = this.time.delayedCall(
            this.mechanics.powerModeDuration,
            this.deactivatePowerMode,
            [], this
        );
    }

    deactivatePowerMode() {
        // Remove invulnerability
        this.isInvulnerable = false;

        // Restore original game speed gradually
        this.targetGameSpeed = this.originalGameSpeed;

        // Remove visual effects
        this.player.clearTint();

        if (this.powerGlow) {
            this.powerGlow.destroy();
        }

        if (this.powerTrailEmitter) {
            this.powerTrailEmitter.stop();
            this.time.delayedCall(500, () => {
                this.powerTrailEmitter.destroy();
            });
        }
    }

    spawnSpellBook() {
        const cameraRight = this.sys.cameras.main.scrollX + this.sys.game.config.width;
        const bookY = this.groundTopY - Phaser.Math.Between(30, 80);
        const bookX = cameraRight + Phaser.Math.Between(100, 400);

        // overlap checks (optional)…
        if (this.burningRocks.getChildren().some(r => Math.abs(r.x - bookX) < 300)) return;
        if (this.spellBooks.getChildren().some(b => Math.abs(b.x - bookX) < 300)) return;
        if (this.bluePowers.getChildren().some(o => Math.abs(o.x - bookX) < 300)) return;

        const spellBook = this.spellBooks.create(bookX, bookY, 'spellbook')
            .setDepth(25)
            .setScale(1)
            .setImmovable(true);
        spellBook.body.setAllowGravity(false);

        const glow = this.add.image(bookX, bookY, 'book-glow')
            .setDepth(24)
            .setAlpha(0.7);
        spellBook.glow = glow;

        console.log('Spawned spell book at', bookX, bookY);
    }


    collectSpellBook(player, book) {
        // Remove the spell book and its glow
        if (book.glow) {
            book.glow.destroy();
        }
        book.destroy();
        this.collectSound.play();

        // Increase score significantly
        this.score += 100;
        // this.scoreText.setText(this.score);

        // Create a celebratory effect
        // const particles = this.add.particles('blue-glow');
        // const emitter = particles.createEmitter({
        //     x: player.x,
        //     y: player.y,
        //     speed: { min: -800, max: 800 },
        //     angle: { min: 0, max: 360 },
        //     scale: { start: 0.5, end: 0 },
        //     lifespan: 1000,
        //     quantity: 20
        // });

        // Stop the emitter after a short time
        this.time.delayedCall(300, () => {
            // emitter.stop();
        });
        this.reachGoal(); // Call the reachGoal method to handle victory
    }

    // Removed updateScore method as we're updating the score in the update method

    hitObstacle(player, obstacle) {
        if (this.gameOver)
            return;

        // If player is invulnerable (power mode active), destroy obstacle without taking damage
        if (this.isInvulnerable) {
            // Create a special effect to show invulnerability
            // const particles = this.add.particles('blue-glow');
            // const emitter = particles.createEmitter({
            //     x: obstacle.x,
            //     y: obstacle.y,
            //     speed: { min: 50, max: 200 },
            //     angle: { min: 0, max: 360 },
            //     scale: { start: 0.4, end: 0 },
            //     lifespan: 500,
            //     quantity: 10,
            //     blendMode: 'ADD'
            // });

            // Stop the emitter after a short time and destroy the particle system
            this.time.delayedCall(300, () => {
                // emitter.stop();
                this.time.delayedCall(500, () => {
                    // particles.destroy();
                });
            });

            // Remove the obstacle without taking damage
            obstacle.destroy();
            return;
        }

        if (obstacle.texture.key === 'enemy') {
            this.birdHitSound.play();
        } else {
            this.collisionSound.play();
        }
        // Play collision sound
        // this.collisionSound.play();

        // Reduce health
        this.health--;

        // Update health bar based on remaining health
        if (this.health > 0) {
            // Flash player red to indicate damage
            this.player.setTint(0xff0000);

            // Update health bar texture
            this.healthBar.setTexture('red-bar-' + this.health);

            // Create a timer to remove the red tint
            this.time.delayedCall(300, () => {
                this.player.clearTint();
            });

            // Make the player temporarily invulnerable
            obstacle.destroy(); // Remove the obstacle that was hit

            // Add a brief invulnerability period
            this.player.alpha = 0.5;
            this.time.delayedCall(1500, () => {
                this.player.alpha = 1;
            });
        } else {
            // Game over logic when health reaches zero

            this.endGame();
        }
    }

    reachGoal(player, spellBook) {
        // this.backgroundMusic.stop();
        this.physics.pause();
        this.gameOver = true;
        // music.stop();
        this.showLevelComplete();
        // Victory text relative to camera position

        // Add restart functionality
        this.input.keyboard.once('keydown-SPACE', () => {
            this.scene.restart();
        });
    }

    generateNewPlatform() {

        const spawnX = this.lastPlatformX - 50;
        const platform = this.longPlatform.create(spawnX, this.sys.game.config.height, 'platform-long')
            .setOrigin(0, 1)
            .setImmovable(true)
            .refreshBody();
        // Update the last platform position
        this.lastPlatformX = spawnX + platform.width;

        this.longPlatform.children.iterate((plat) => {
            // say your blades are 20px tall
            const bladeHeight = 120;
            plat.body
                .setSize(plat.displayWidth, plat.displayHeight - bladeHeight)
                .setOffset(0, bladeHeight);
        });
        // === Place multiple obstacles with spacing constraint ===
        const obstacleCount = Phaser.Math.Between(1, 1);
        const minGap = 220; // Minimum pixels between obstacles
        const usedXPositions = [];

        for (let i = 0; i < obstacleCount; i++) {
            let attempts = 0;
            let validX = null;

            while (attempts < 10) {
                const offsetX = Phaser.Math.Between(50, platform.width - 100);
                const tryX = spawnX + offsetX;
                const isTooClose = usedXPositions.some(x => Math.abs(x - tryX) < minGap);

                if (!isTooClose) {
                    validX = tryX;
                    usedXPositions.push(tryX);
                    break;
                }

                attempts++;
            }

            if (validX !== null) {
                const obstacleType = Phaser.Math.Between(1, 2); // 1: rock, 2: eagle

                if (obstacleType === 1) {
                    const rock = this.burningRocks.create(validX, this.sys.game.config.height - 120, 'burning-rock');
                    rock
                        .setOrigin(0, 1)
                        .setImmovable(true)
                        .setDepth(8)
                        .setScale(1)
                        .body.setAllowGravity(false)
                        .setSize(150, 230);
                } else {
                    const eagleY = this.sys.game.config.height - Phaser.Math.Between(250, 300);
                    const eagle = this.eagles.create(validX, eagleY, 'enemy')
                        .setDepth(8)
                        .setOrigin(0, 1)
                        .setScale(1)
                        .setImmovable(true);
                    eagle.body.setAllowGravity(false);
                }
            }
        }
        if (Phaser.Math.Between(1, 4) === 1) {
            // — blue power on platform —
            const orbX = spawnX + Phaser.Math.Between(50, platform.width - 50);
            const orbY = this.groundTopY - Phaser.Math.Between(100, 200);
            const powerOrb = this.bluePowers.create(orbX, orbY, 'blue-power');
            const glow = this.add.image(orbX, orbY, 'blue-glow')
                .setAlpha(0.7)
                .setDepth(8);
            powerOrb.glow = glow;
            powerOrb
                .setImmovable(true)
                .body.setAllowGravity(false);
        }

        // Occasionally spawn the spell book (goal) after a certain score
        if (this.score > 3000 && Phaser.Math.Between(1, 100) <= 50) {
            console.log('Spawning spell book');
            this.spawnSpellBook();
        }
    }

}