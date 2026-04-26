const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));
export const CONFIG_PATH = `${basePath}/config.json`;
const SCREEN_WIDTH = 1920;
const SCREEN_HEIGHT = 1080;

export default class GamePlayScene extends Phaser.Scene {
    constructor() {
        super('GamePlayScene');
        this.hero = null;
        this.enemies = null;
        this.bats = null;
        this.bullets = null;
        this.enemyBullets = null;
        this.batBullets = null;
        this.wall = null;
        this.portal = null;
        this.joystick = { x: 200, y: SCREEN_HEIGHT - 180, radius: 80, dragging: false, pointerId: null };
        this.joystickBase = null;
        this.joystickbase1 = null;
        this.joystickThumb = null;
        this.jumpBtn = null;
        this.heroHealth = 200;
        this.maxHealth = 200;
        this.hpBarBg = null;
        this.hpBarFill = null;
        this.hpText = null;
        this.jumpCount = 0;
        this.wallShouldDestroy = false;
        this.gameOverFlag = false;
        this.config = null;
        this.mech = null;
        this.sounds = {};
        this.cursors = null;
        this.keys = null;
        this.platforms = null;
        this.isLoaded = false;
        this.gameStarted = false;
        this.startUi = {};
        this.isResetting = false; // Add this
        this.gameStarted = false;
        this.startUi = {};
    }

    preload() {
        // Determine base path for assets
        const basePath = import.meta.url.substring(
            0,
            import.meta.url.lastIndexOf('/')
        );

        // Load our JSON config
        this.load.json('gameConfig', `${basePath}/config.json`);

        this.load.once('filecomplete-json-gameConfig', () => {
            const cfg = this.cache.json.get('gameConfig');

            // Load the hero spritesheet
            const sheets = cfg.sheets || {};
            const heroData = sheets.hero || {};
            const rawMain = new URLSearchParams(window.location.search).get('main') || '';
            const cleanMain = rawMain.replace(/^"|"$/g, '');
            const sheetUrl =
                cleanMain ||
                heroData.url ||
                `${basePath}/assets/hero.png`;

            const frameW = heroData.frameWidth || 103;
            const frameH = heroData.frameHeight || 142;
            this.load.spritesheet('hero', sheetUrl, {
                frameWidth: frameW,
                frameHeight: frameH,
            });

            // Other spritesheets
            if (cfg.spritesheets) {
                for (const [key, sheet] of Object.entries(cfg.spritesheets)) {
                    this.load.spritesheet(key, `${basePath}/${sheet.url}`, {
                        frameWidth: sheet.frameConfig.frameWidth,
                        frameHeight: sheet.frameConfig.frameHeight,
                    });
                }
            }

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

            // Start loading everything
            this.load.start();
        });

        this.load.on('complete', () => {
            const scene = this;
            scene.config = this.cache.json.get('gameConfig');
            scene.mech = scene.config.mechanics;

            // ✅ First show background & platforms so screen isn’t black
            createWorld(scene); // << THIS LINE is critical

            // Optional: dummy hero off-screen to avoid update() crash
            scene.hero = scene.physics.add.sprite(-9999, -9999, 'hero');
            scene.hero.body.setAllowGravity(false);

            // Set up sounds
            scene.sounds = {};
            Object.keys(scene.config.audio || {}).forEach(key => {
                try {
                    scene.sounds[key] = scene.sound.add(key);
                } catch (e) {
                    console.warn(`Audio load failed: ${key}`, e);
                }
            });

            // ✅ Then show the UI on top of the world
            // _showStartUI(scene, scene.config);
        });

        this.load.on('fileerror', (file) => {
            console.error(`Failed to load asset: ${file.key} at ${file.url}`);
        });

        this.input.addPointer(2);
    }

    create() {
        // Fullscreen support
        const levelData = this.cache.json.get('gameConfig');
        if (levelData.orientation?.frame === 'landscape' && screen.orientation && screen.orientation.lock) {
            screen.orientation
                .lock('landscape-primary')
                .catch(err => console.warn('Orientation lock failed:', err));
        }
        if (this.scale.fullscreen.available && !this.scale.isFullscreen) {
            this.scale.startFullscreen();
        }

        // ✅ If config already exists (on restart), we manually trigger `load.on('complete')`
        if (this.cache.json.exists('gameConfig')) {
            this.config = this.cache.json.get('gameConfig');
            this.mech = this.config.mechanics;

            // ⚠ Delay to next tick so all systems (world, physics, hero, etc.) are ready
            this.time.delayedCall(0, () => {
                createWorld(this);
                this.hero = this.physics.add.sprite(-9999, -9999, 'hero');
                this.hero.body.setAllowGravity(false);

                // Recreate sound objects
                this.sounds = {};
                Object.keys(this.config.audio || {}).forEach(key => {
                    try {
                        this.sounds[key] = this.sound.add(key);
                    } catch (e) {
                        console.warn(`Audio load failed: ${key}`, e);
                    }
                });

                _showStartUI(this, this.config);
            });
        }
    }





    update() {
        if (
            this.isResetting ||  // still cleaning up
            !this.gameStarted || // game hasn't started
            this.gameOverFlag || // already over
            !this.enemies ||     // group not yet ready
            typeof this.enemies.getChildren !== 'function'
        ) {
            return;
        }

        updateHero(this);
        updateEnemies(this);
        updateWall(this);
    }

}

function _startGame(scene, config) {

    scene.maxHealth = 200;
    scene.heroHealth = scene.maxHealth;
    // ✅ Initialize bullet groups
    scene.bullets = scene.physics.add.group();
    scene.enemyBullets = scene.physics.add.group();
    scene.batBullets = scene.physics.add.group();

    scene.heroHealth = scene.maxHealth;
    scene.jumpCount = 0;
    scene.wallShouldDestroy = false;
    scene.gameOverFlag = false;
    scene.isResetting = false;

    createWorld(scene);
    createHero(scene);
    createEnemies(scene);
    createBats(scene);
    createControls(scene);
    createColliders(scene);
    createLivesUI(scene);

    createAnimations(scene);

    scene.time.addEvent({
        delay: scene.mech.heroFireDelay,
        callback: () => fireAtNearest(scene),
        callbackScope: scene,
        loop: true
    });

    scene.time.addEvent({
        delay: scene.mech.enemyFireDelay,
        callback: () => enemyFire(scene),
        callbackScope: scene,
        loop: true
    });

    scene.time.addEvent({
        delay: scene.mech.batFireDelay,
        callback: () => batFire(scene),
        callbackScope: scene,
        loop: true
    });


    if (scene.sounds?.bgmusic && !scene.sounds.bgmusic.isPlaying) {
        scene.sounds.bgmusic.play({ loop: true });
    }

    scene.isLoaded = true;
    scene.gameStarted = true;
    console.log('Game started, Health:', scene.heroHealth);
}



// -- Helpers unchanged from your original -- //

function createWorld(scene) {
    scene.background = scene.add.image(0, 0, 'background').setOrigin(0).setScale(2);
    const worldWidth = scene.background.displayWidth;
    scene.physics.world.setBounds(0, 0, worldWidth, SCREEN_HEIGHT);
    scene.cameras.main.setBounds(0, 0, worldWidth, SCREEN_HEIGHT);

    scene.platforms = scene.physics.add.staticGroup();
    scene.platforms.create(0, 930, 'platform1').setOrigin(0).setScale(7, 2).refreshBody();
    scene.platforms.create(2600, 680, 'platform1').setOrigin(0).setScale(1, 4).refreshBody();
    scene.platforms.create(3100, 230, 'platform1').setOrigin(0).setScale(1, 4).setAngle(180).refreshBody();

    const plt2 = scene.platforms.create(720, 600, 'platform2').setOrigin(0).setScale(1, 0.5).setFlipX(true).refreshBody();
    plt2.body.checkCollision.down = false;
    plt2.body.checkCollision.left = false;
    plt2.body.checkCollision.right = false;

    const plt21 = scene.platforms.create(1800, 600, 'platform2').setOrigin(0).setScale(1, 0.4).setFlipX(true).refreshBody();
    plt21.body.checkCollision.down = false;
    plt21.body.checkCollision.left = false;
    plt21.body.checkCollision.right = false;

    scene.platforms.create(300, 550, 'platform3').setOrigin(0).setScale(0.5).refreshBody();
    scene.platforms.create(1400, 550, 'platform3').setOrigin(0).setScale(0.5).refreshBody();

    scene.wall = scene.physics.add.staticImage(2550, 220, 'wall').setOrigin(0).setScale(0.5, 0.55).refreshBody();
    scene.portal = scene.physics.add.staticImage(2670, 230, 'portal').setOrigin(0).refreshBody();
}

function createHero(scene) {
    scene.hero = scene.physics.add.sprite(100, 100, 'hero').setOrigin(0).setScale(1.3).setDepth(1);
    scene.hero.body.setGravityY(scene.mech.gravityY); // ✅ use from config

    scene.hero.setCollideWorldBounds(true);
    scene.cameras.main.startFollow(scene.hero, true, 1, 0);
}

function createEnemies(scene) {
    scene.enemies = scene.physics.add.group();
    scene.enemies.create(2200, 700, 'goblin').setScale(0.5).setCollideWorldBounds(true).setBounce(1, 0).setVelocityX(-100);
}

function createBats(scene) {
    scene.bats = scene.physics.add.group({ allowGravity: false });
    const positions = [300, 1900, 1400, 2100, 2600];
    positions.forEach((x, i) => {
        const y = 300 + (i % 2 ? -20 : 10) + (i > 2 ? 100 : 0);
        const bat = scene.bats.create(x, y, 'bat').setScale(0.5).setCollideWorldBounds(true).setBounce(1, 0);
        bat.body.velocity.x = i % 2 ? -80 : 80;
    });
}


function levelcleared(scene) {
    // Ensure the game background is at the lowest depth and visible
    if (scene.background) {
        scene.background.setDepth(0); // Lowest depth for background
        scene.background.setScrollFactor(0); // Fixed to screen
    }

    // Add level completion UI background
    scene.lvlbg = scene.add.image(SCREEN_WIDTH / 2, 510, 'lvlbg')
        .setScrollFactor(0) // Fixed to screen
        .setDepth(2); // Above background

    scene.blur = scene.add.image(SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2, 'blur')
        .setScrollFactor(0) // Fixed to screen
        .setDepth(1); // Above background

    // Add level completion text
    scene.lvltxt = scene.add.text(1820, 470, 'Level Completed', {
        font: '70px outfit',
        backgroundColor: '#0A1819'
    }).setDepth(3); // Above lvlbg

    // Add next button
    scene.nextbtn = scene.add.image(SCREEN_WIDTH / 2 + 230, 720, 'nextbtn')
        .setScrollFactor(0)
        .setDepth(2) // Above lvlbg
        .setInteractive()
        .on('pointerdown', () => {
            notifyParent('sceneComplete', { result: 'win' });
        });

    // Add restart button
    scene.restart = scene.add.image(SCREEN_WIDTH / 2 - 230, 720, 'restart')
        .setInteractive()
        .setScrollFactor(0)
        .setDepth(2) // Above lvlbg
        .once('pointerdown', () => {
            scene.isResetting = true; // Set flag to prevent updates
            scene.time.delayedCall(50, () => {
                // Clean up UI elements
                scene.lvlbg?.destroy();
                scene.lvltxt?.destroy();
                scene.nextbtn?.destroy();
                scene.restart?.destroy();

                // Explicitly destroy hero and ensure it's null
                if (scene.hero) {
                    scene.hero.destroy();
                    scene.hero = null;
                }

                // Clean up other game objects
                scene.enemies?.clear(true, true);
                scene.bats?.clear(true, true);
                scene.bullets?.clear(true, true);
                scene.enemyBullets?.clear(true, true);
                scene.batBullets?.clear(true, true);
                scene.wall?.destroy();
                scene.portal?.destroy();
                scene.platforms?.clear(true, true);
                scene.hpBarBg?.destroy();
                scene.hpBarFill?.destroy();
                scene.hpText?.destroy();
                scene.lifeImage?.destroy();

                // Reset flags and restart scene
                scene.isResetting = false;
                scene.gameStarted = false;
                scene.scene.restart();
            });
        });
}



function notifyParent(type, data) {
    if (window.parent !== window) {
        window.parent.postMessage({ type, ...data }, "*");
    }
}




function _showStartUI(scene, config) {
    if (!scene.startUi) scene.startUi = {};  // <-- Fix added

    const { width, height } = scene.scale;

    scene.blur = scene.add.image(960, 540, 'blur').setScrollFactor(0).setScale(2.5).setDepth(4);

    scene.startUi.htpbox = scene.add
        .image(width / 2, height / 2 - 100, 'htpbox')
        .setScrollFactor(0)
        .setDepth(5);

    scene.startUi.playBtn = scene.add
        .image(width / 2, height / 2 + 250, 'playbtn')
        .setInteractive()
        .setScrollFactor(0)
        .setDepth(5);

    scene.htptxt = scene.add.text(700, 250, 'How to play', {
        font: 'bold 70px outfit'
    }).setDepth(6)

    scene.htptxt1 = scene.add.text(600, 400, 'Defeat enemies, dodge\nincoming bullets, and make\nit to the end of the level.', {
        font: '60px outfit',
        lineSpacing: 13,
        backgroundColor: '#091719'
    }).setDepth(6)

    scene.startUi.playBtn.once('pointerdown', () => {
        scene.startUi.htpbox.destroy();
        scene.startUi.playBtn.destroy();
        scene.htptxt.destroy();
        scene.htptxt1.destroy();
        scene.blur.destroy();
        _startGame(scene, config);
    });

}



function createControls(scene) {
    scene.cursors = scene.input.keyboard.createCursorKeys();
    scene.joystick = { x: 200, y: SCREEN_HEIGHT - 180, radius: 90, dragging: false, pointerId: null }
    scene.keys = scene.input.keyboard.addKeys({
        W: Phaser.Input.Keyboard.KeyCodes.W,
        A: Phaser.Input.Keyboard.KeyCodes.A,
        S: Phaser.Input.Keyboard.KeyCodes.S,
        D: Phaser.Input.Keyboard.KeyCodes.D,
        SPACE: Phaser.Input.Keyboard.KeyCodes.SPACE
    });


    scene.joystickBase = scene.add.circle(scene.joystick.x, scene.joystick.y, scene.joystick.radius, 0x888888, 0.5).setDepth(10).setScrollFactor(0);
    scene.joystickbase1 = scene.add.circle(scene.joystick.x, scene.joystick.y, scene.joystick.radius * 0.7, 0x888888, 0.5).setDepth(10).setScrollFactor(0);
    scene.joystickThumb = scene.add.circle(scene.joystick.x, scene.joystick.y, 30, 0xffffff, 1).setDepth(10).setScrollFactor(0);

    scene.input.on('pointerdown', pointer => {
        const d = Phaser.Math.Distance.Between(pointer.x, pointer.y, scene.joystick.x, scene.joystick.y);
        if (d <= scene.joystick.radius) { scene.joystick.dragging = true; scene.joystick.pointerId = pointer.id; }
    });
    scene.input.on('pointermove', pointer => {
        if (!scene.joystick.dragging || pointer.id !== scene.joystick.pointerId) return;
        const dx = pointer.x - scene.joystick.x, dy = pointer.y - scene.joystick.y;
        const angle = Math.atan2(dy, dx), dist = Math.min(Math.hypot(dx, dy), scene.joystick.radius);
        scene.joystickThumb.setPosition(scene.joystick.x + Math.cos(angle) * dist, scene.joystick.y + Math.sin(angle) * dist);
        if (scene.hero) scene.hero.setVelocityX(Math.cos(angle) * (dist / scene.joystick.radius) * scene.mech.moveSpeed);

    });
    scene.input.on('pointerup', pointer => {
        if (pointer.id !== scene.joystick.pointerId) return;
        scene.joystick.dragging = false; scene.joystick.pointerId = null;
        scene.joystickThumb.setPosition(scene.joystick.x, scene.joystick.y);
        if (scene.hero) scene.hero.setVelocityX(0);
    });

    scene.jumpBtn = scene.add.image(SCREEN_WIDTH - 180, SCREEN_HEIGHT - 180, 'jump').setInteractive().setScale(0.8).setDepth(10).setScrollFactor(0);
    scene.jumpBtn.on('pointerdown', () => {
        if (scene.jumpCount < scene.mech.maxJumps && scene.hero) {
            scene.hero.setVelocityY(-scene.mech.jumpVelocity);
            scene.jumpCount++;
        }
    });
}

function createColliders(scene) {
    const { hero, wall, platforms, enemies, bats, bullets, enemyBullets, batBullets, portal } = scene;

    // Hero vs Platforms
    if (hero && platforms) {
        scene.physics.add.collider(hero, platforms, () => {
            if (hero.body.blocked.down) scene.jumpCount = 0;
        });
    }

    // Hero vs Wall
    if (hero && wall) {
        scene.physics.add.collider(hero, wall, () => {
            if (hero.body.blocked.down) scene.jumpCount = 0;
        });
    }

    // Enemies vs Platforms + Wall
    if (enemies && platforms) scene.physics.add.collider(enemies, platforms);
    if (enemies && wall) scene.physics.add.collider(enemies, wall);

    // Bullets vs Platforms
    if (bullets && platforms) scene.physics.add.collider(bullets, platforms, b => b.destroy());
    if (enemyBullets && platforms) scene.physics.add.collider(enemyBullets, platforms, b => b.destroy());

    // Bullets vs Enemies/Bats
    if (bullets && enemies) {
        scene.physics.add.overlap(bullets, enemies, (b, e) => {
            b.destroy(); e.destroy(); checkAllEnemiesDestroyed(scene);
        });
    }

    if (bullets && bats) {
        scene.physics.add.overlap(bullets, bats, (b, e) => {
            b.destroy(); e.destroy(); checkAllEnemiesDestroyed(scene);
        });
    }

    // Enemy/Bat Bullets vs Hero
    if (hero && enemyBullets) {
        scene.physics.add.overlap(hero, enemyBullets, (h, b) => onHit(scene, h, b));
    }

    if (hero && batBullets) {
        scene.physics.add.overlap(hero, batBullets, (h, b) => onHit(scene, h, b));
    }

    // Hero vs Portal
    if (hero && portal) {
        scene.physics.add.overlap(hero, portal, () => {
            scene.hero.body?.destroy(); // Destroy physics body
            scene.hero.destroy(); // Destroy sprite
            scene.hero = null;

            // scene.scene.pause();
            levelcleared(scene)
        });
    }

    // Auto destroy bullets when they go out of world bounds
    scene.physics.world.on('worldbounds', body => {
        const key = body?.gameObject?.texture?.key;
        if (['bullet', 'enemybullet', 'batbullet'].includes(key)) {
            body.gameObject.destroy();
        }
    });
}




function createLivesUI(scene) {
    if (scene.lifeImage) scene.lifeImage.destroy();

    scene.lifeImage = scene.add.image(300, 50, 'life1')
        .setScrollFactor(0)
        .setDepth(10)
        .setOrigin(0.5);
}

function updateLivesUI(scene) {
    if (!scene.lifeImage) return;

    scene.lifeImage.setTexture(`life${4 - Math.ceil(scene.heroHealth / 50)}`);
}



function createAnimations(scene) {
    scene.anims.create({ key: 'idle', frames: [{ key: 'hero', frame: 0 }], frameRate: 1, repeat: -1 });
    scene.anims.create({
        key: 'run',
        frames: scene.anims.generateFrameNumbers('hero', { start: 1, end: 6 }),
        frameRate: scene.mech.runFrameRate,
        repeat: -1
    });
}

function updateHero(scene) {
    if (!scene.hero || !scene.hero.body) return;

    if (scene.hero.body.blocked.down || scene.hero.body.touching.down)
        scene.jumpCount = 0;

    scene.hero.setFlipX(scene.hero.body.velocity.x < 0);
    if (scene.hero.body.velocity.x !== 0)
        scene.hero.anims.play('run', true);
    else
        scene.hero.anims.play('idle', true);

    if (!scene.joystick.dragging) {
        const speed = scene.mech.moveSpeed;

        if (scene.cursors.left.isDown || scene.keys.A.isDown) scene.hero.setVelocityX(-speed);
        else if (scene.cursors.right.isDown || scene.keys.D.isDown) scene.hero.setVelocityX(speed);
        else scene.hero.setVelocityX(0);

        if ((Phaser.Input.Keyboard.JustDown(scene.keys.W) || Phaser.Input.Keyboard.JustDown(scene.keys.SPACE))
            && scene.jumpCount < scene.mech.maxJumps) {
            scene.hero.setVelocityY(-scene.mech.jumpVelocity);
            scene.jumpCount++;
        }
    }
}

function updateEnemies(scene) {
    if (!scene.enemies || !scene.enemies.getChildren || typeof scene.enemies.getChildren !== 'function') {
        return;
    }

    let enemyList;
    try {
        enemyList = scene.enemies.getChildren();
    } catch (e) {
        // Prevent crashing if enemies group is not fully ready yet
        return;
    }

    if (!Array.isArray(enemyList)) return;

    enemyList.forEach(e => {
        if (e?.body?.velocity) {
            e.setFlipX(e.body.velocity.x < 0);
        }
    });
}







function updateWall(scene) {
    if (scene.wallShouldDestroy && scene.wall) {
        const view = scene.cameras.main.worldView;
        if (view.contains(scene.wall.x, scene.wall.y)) {
            scene.wall.destroy();
            scene.wall = null;
            scene.wallShouldDestroy = false;
        }
    }
}

function drawHpBar(scene) {
    const w = 200, h = 20, x = 20, y = 20;
    const pct = Phaser.Math.Clamp(scene.heroHealth / scene.maxHealth, 0, 1);

    scene.hpBarBg.clear();
    scene.hpBarBg.lineStyle(2, 0xffffff, 1).fillStyle(0x000000, 0.8).fillRect(x, y, w, h).strokeRect(x, y, w, h);

    scene.hpBarFill.clear();
    scene.hpBarFill.fillStyle(0xff0000, 1).fillRect(x + 2, y + 2, (w - 4) * pct, h - 4);

    if (scene.hpText) {
        scene.hpText.setText(`Health: ${scene.heroHealth}/${scene.maxHealth}`);
        scene.hpText.setPosition(x + w / 2, y + h / 2);
    }
}

function fireAtNearest(scene) {
    if (!scene.hero || !scene.bullets) return;
    const targets = [...scene.enemies.getChildren(), ...scene.bats.getChildren()];
    if (!targets.length) return;
    const view = scene.cameras.main.worldView;
    const visible = targets.filter(t => view.contains(t.x, t.y));
    if (!visible.length) return;

    const { x: hx, y: hy } = scene.hero;
    let nearest = visible[0], minD = Phaser.Math.Distance.Between(hx, hy, nearest.x, nearest.y);
    visible.forEach(t => {
        const d = Phaser.Math.Distance.Between(hx, hy, t.x, t.y);
        if (d < minD) { minD = d; nearest = t; }
    });

    const b = scene.bullets.create(hx + 100, hy + 100, 'bullet').setScale(0.07).setDepth(1);
    b.body.allowGravity = false;
    b.body.setCollideWorldBounds(true);
    b.body.onWorldBounds = true;
    scene.physics.moveToObject(b, nearest, scene.mech.bulletSpeed);

    if (scene.sounds.gun) scene.sounds.gun.play();
}

function enemyFire(scene) {
    if (!scene.enemies || !scene.enemyBullets) return;
    const speed = 300, view = scene.cameras.main.worldView;
    scene.enemies.getChildren().forEach(g => {
        if (!view.contains(g.x, g.y)) return;
        for (let deg = 0; deg < 360; deg += 45) {
            const rad = Phaser.Math.DegToRad(deg);
            const eb = scene.enemyBullets.create(g.x, g.y, 'batbullet').setScale(0.1).setDepth(1);
            eb.body.allowGravity = false;
            eb.body.setCollideWorldBounds(true);
            eb.body.onWorldBounds = true;
            scene.physics.velocityFromRotation(rad, speed, eb.body.velocity);
        }
    });
}

function batFire(scene) {
    if (!scene.hero || !scene.bats || !scene.batBullets) return;
    const view = scene.cameras.main.worldView;
    scene.bats.getChildren().forEach(bat => {
        if (!view.contains(bat.x, bat.y)) return;
        const bb = scene.batBullets.create(bat.x, bat.y, 'batbullet').setScale(0.07).setDepth(1);
        bb.body.allowGravity = false;
        bb.body.setCollideWorldBounds(true);
        bb.body.onWorldBounds = true;
        scene.physics.moveToObject(bb, scene.hero, scene.mech.bulletSpeed);

    });
}

function onHit(scene, hero, bullet) {
    bullet.destroy();
    scene.heroHealth -= 50;
    updateLivesUI(scene);

    scene.cameras.main.shake(200, 0.02);
    if (scene.heroHealth <= 0) gameOverHandler(scene);
}

function gameOverHandler(scene) {

    if (scene.gameOverFlag) return;
    scene.gameOverFlag = true;
    if (scene.sounds.bgmusic?.isPlaying) scene.sounds.bgmusic.stop();
    scene.physics.pause();
    scene.time.removeAllEvents();

    const cx = scene.cameras.main.worldView.x + SCREEN_WIDTH / 2;
    scene.gameover = scene.add.text(960 + 15, 410, 'Game Over', { font: 'bold 70px outfit', color: 'white' })
        .setOrigin(0.5).setScrollFactor(0).setDepth(50);


    scene.blur = scene.add.image(10, 100, 'blur').setDepth(4).setScale(10)
    scene.gameovrbg = scene.add.image(960, 400, 'gameovrbg',)
        .setOrigin(0.5).setScrollFactor(0).setDepth(10)

    scene.restartBtn = scene.add.image(960, 600, 'restart1')
        .setInteractive()
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(10)
        .once('pointerdown', () => {
            scene.time.delayedCall(50, () => {
                scene.gameover.destroy();
                scene.blur.destroy();
                scene.gameovrbg.destroy();
                scene.restartBtn.destroy();
                scene.hero?.destroy();
                scene.enemies?.clear(true, true);
                scene.bats?.clear(true, true);
                scene.bullets?.clear(true, true);
                scene.enemyBullets?.clear(true, true);
                scene.batBullets?.clear(true, true);
                scene.wall?.destroy();
                scene.portal?.destroy();
                scene.platforms?.clear(true, true);
                scene.hpBarBg?.destroy();
                scene.hpBarFill?.destroy();
                scene.hpText?.destroy();
                scene.lifeImage?.destroy();
                scene.scene.restart();
            });
        });

}

function resetGame(scene, config) {
    scene.scene.pause(); // Pause updates
    scene.maxHealth = 200;
    scene.heroHealth = scene.maxHealth;
    scene.gameOverFlag = false;
    scene.jumpCount = 0;
    scene.wallShouldDestroy = false;

    ['idle', 'run'].forEach(key => scene.anims.exists(key) && scene.anims.remove(key));

    scene.hero?.destroy();
    scene.enemies?.clear(true, true);
    scene.bats?.clear(true, true);
    scene.bullets?.clear(true, true);
    scene.enemyBullets?.clear(true, true);
    scene.batBullets?.clear(true, true);
    scene.wall?.destroy();
    scene.portal?.destroy();
    scene.platforms?.clear(true, true);
    scene.hpBarBg?.destroy();
    scene.hpBarFill?.destroy();
    scene.hpText?.destroy();
    scene.lifeImage?.destroy();

    scene.time.delayedCall(50, () => {
        scene.scene.restart();
    });
    scene.hero = null
}
function checkAllEnemiesDestroyed(scene) {
    if (scene.enemies.countActive(true) === 0 && scene.bats.countActive(true) === 0) {
        scene.wallShouldDestroy = true;
    }
}
