class GameScene extends Phaser.Scene {
    constructor() {
        super('GameScene');
        this.swipeStartX = null;
        this.swipeStartTime = null;
        this.swipeActive = false;
        this.swipeDirection = null;
        this.isGameOver = false;
        this.gameStarted = false;
        this.partsCollected = 0;
        this.distanceTraveled = 0;
        this.score = 0;
        // Default values that can be overridden by JSON
        this.gameSpeed = 320;
        this.glideVelocity = 320;
        this.lateralVelocity = 450;
        this.totalParts = 10;
        this.obstacleSpawnTime = 1500;
        this.partSpawnTime = 5000;
        this.maxActiveObjects = 20;
        this.minObjectDistance = 280;

        // MISS logic
        this.maxMisses = 5;
        this.missedParts = 0;

        // HEALTH: default health
        this.maxHealth = 10;
        this.health = 10;
    }

    preload() {
        const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));
        this.load.json('levelConfig', `${basePath}/config.json`);
        this.load.script('webfont', 'https://ajax.googleapis.com/ajax/libs/webfont/1.6.26/webfont.js');

        this.load.once('filecomplete-json-levelConfig', () => {
            const cfg = this.cache.json.get('levelConfig');

            const images = cfg.images1 || {};
            const images2 = cfg.images2 || {};
            const uiImages = cfg.ui || {};
            const audio = cfg.audio || {};

            // ✅ ALWAYS load a single PNG player sprite
            this.load.image('player', `${basePath}/assets/player.png`);

            for (const [key, url] of Object.entries(images)) {
                this.load.image(key, `${basePath}/${url}`);
            }

            for (const [key, url] of Object.entries(images2)) {
                this.load.image(key, `${basePath}/${url}`);
            }

            for (const [key, url] of Object.entries(uiImages)) {
                this.load.image(key, `${basePath}/${url}`);
            }

            // 🔊 AUDIO: support both local paths and full URLs
            const resolvePath = (u) => {
                if (!u) return null;
                // if it already looks like a full URL, use as-is
                if (/^https?:\/\//i.test(u) || u.startsWith('//')) {
                    return u;
                }
                // otherwise treat it as relative to basePath
                return `${basePath}/${u}`;
            };

            for (const [key, url] of Object.entries(audio)) {
                const finalUrl = resolvePath(url);
                if (finalUrl) {
                    this.load.audio(key, finalUrl);
                }
            }

            this.load.start();
        });
    }


    create() {
        if (screen.orientation && screen.orientation.lock) {
            screen.orientation.lock("portrait-primary").catch(() => { });
        }

        if (this.scale.fullscreen.available && !this.scale.isFullscreen) {
            this.scale.startFullscreen();
        }

        const cfg = this.cache.json.get('levelConfig');
        this.texts = cfg.texts || {};
        this.mechanics = cfg.mechanics || {};
        this.minPlayerY = this.cameras.main.height * (this.mechanics.minPlayerYRatio || 0.6);

        // ✅ Pull core numbers from JSON so UI + HTP use them
        this.totalParts = this.mechanics.totalParts || this.totalParts;
        this.maxMisses = this.mechanics.maxMisses || this.maxMisses;
        this.maxHealth = this.mechanics.maxHealth || this.maxHealth;
        this.health = this.maxHealth;

        this.cameras.main.setBackgroundColor('#000000');
        this.physics.world.setBounds(0, 0, 1080, 1920);

        // --- BGM: start music when scene starts ---
        if (!this.sound.get('bgm')) {
            this.bgm = this.sound.add('bgm', { volume: 0.5, loop: true });
            this.bgm.play();
        } else {
            this.bgm = this.sound.get('bgm');
            if (!this.bgm.isPlaying) {
                this.bgm.play();
            }
        }
        // ------------------------------------------

        // Initialize critical groups
        initializeGroups(this);

        this.background = this.add.image(540, 960, 'space_background').setDepth(0);
        this.stars = this.add.tileSprite(540, 960, 1080, 1920, 'stars').setScrollFactor(0, 0).setDepth(1);
        this.moon = this.add.image(540, 2370, 'moon-mask').setDepth(2);
        this.moonGlow = this.add.image(540, 1970, 'moon-glow').setDepth(1);
        this.tweens.add({
            targets: this.moonGlow,
            alpha: { from: 0.7, to: 1 },
            duration: 2000,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });


        window.WebFont.load({
            custom: {
                families: ['Outfit'],
                urls: ['outfit.ttf']
            },
            active: () => {
                // Show "How to Play" popup and pause scene updates
                addHTPPopup(this);
            }
        });

        this.input.on('pointerdown', (pointer) => {
            if (this.isGameOver) return;
            this.swipeStartX = pointer.x;
            this.swipeStartTime = this.time.now;
            this.swipeActive = true;
        });

        this.input.on('pointermove', (pointer) => {
            if (this.swipeActive && !this.isGameOver) {
                const deltaX = pointer.x - this.swipeStartX;
                if (deltaX < -10) {
                    this.swipeDirection = 'left';
                } else if (deltaX > 10) {
                    this.swipeDirection = 'right';
                } else {
                    this.swipeDirection = null;
                }
            }
        });

        this.input.on('pointerup', () => {
            this.swipeActive = false;
            this.swipeDirection = null;
            this.swipeStartX = null;
            this.swipeStartTime = null;
        });
    }

    update(time, delta) {
        // Only proceed if game has started, not restarting, not game over, and player is fully initialized
        if (this.restarting || !this.gameStarted || this.isGameOver || !this.player || !this.player.active || !this.player.body) {
            return;
        }

        this.stars.tilePositionY -= 1.5;
        this.distanceTraveled += this.glideVelocity / 60;

        // Update parts group (check for missed collectibles)
        if (this.parts && typeof this.parts.getChildren === 'function') {
            this.parts.getChildren().forEach(part => {
                if (part && part.active && part.y > this.cameras.main.height + 100) {
                    part.destroy();
                    handleMissedPart(this);
                }
            });
        }

        // Player movement
        if (this.player) {
            if (this.cursors.left.isDown || this.swipeDirection === 'left') {
                this.player.setVelocityX(-this.lateralVelocity);
                this.player.setAngle(-10);
            } else if (this.cursors.right.isDown || this.swipeDirection === 'right') {
                this.player.setVelocityX(this.lateralVelocity);
                this.player.setAngle(10);
            } else {
                this.player.setVelocityX(0);
                this.player.setAngle(0);
            }


            // Vertical movement constraints - Modified to prevent vibration
            const targetY = this.minPlayerY + 10; // Add a small offset for smooth hovering
            const distanceToTarget = targetY - this.player.y;

            if (Math.abs(distanceToTarget) < 2) {
                this.player.y = targetY;
                this.player.setVelocityY(0);
            } else {
                const smoothingFactor = 0.1;
                this.player.setVelocityY(distanceToTarget * smoothingFactor);
            }

            // Update background
            this.stars.tilePositionY -= 2;
        }

        // Cleanup offscreen objects
        cleanupOffscreenObjects(this);

        // Gradually increase difficulty
        this.gameSpeed += 0.002;
        if (this.glideVelocity < 200) {
            this.glideVelocity += 0.001;
        }
    }
}

function createCoolText(scene, x, y, content, {
    fontSize = 50,
    weight = 'bold',
    color = '#FFFFFF',
    stroke = '#0E1C3A',
    strokeThickness = 8,
    shadowColor = '#000000',
    shadowBlur = 12,
    shadowOffsetX = 0,
    shadowOffsetY = 4,
    originX = 0.5,
    originY = 0.5,
    depth = 10
} = {}) {
    const txt = scene.add.text(x, y, content, {
        font: `${weight} ${fontSize}px Outfit`,
        color
    })
        .setOrigin(originX, originY)
        .setDepth(depth);

    // strong outline + soft shadow
    txt.setStroke(stroke, strokeThickness);
    txt.setShadow(shadowOffsetX, shadowOffsetY, shadowColor, shadowBlur, true, true);

    return txt;
}

function initializeGroups(scene) {
    // Ensure physics groups are properly initialized
    scene.parts = scene.physics.add.group();
    scene.obstacles = scene.physics.add.group();
    scene.activeObjects = [];
}

function addHTPPopup(scene) {
    scene.htpElements = [];

    const width = scene.cameras.main.width;
    const height = scene.cameras.main.height;

    // ✅ Use JSON-driven values for numbers in the HTP text
    const cfg = scene.cache.json.get('levelConfig') || {};
    const mechanics = cfg.mechanics || scene.mechanics || {};
    const totalParts = mechanics.totalParts || scene.totalParts || 10;
    const maxMisses = mechanics.maxMisses || scene.maxMisses || 5;
    const maxHealth = mechanics.maxHealth || scene.maxHealth || 10;

    const blur = scene.add.rectangle(0, 0, 1080, 1920, 0x000000, 0.5).setOrigin(0).setDepth(9);
    const bg = scene.add.image(width / 2, height / 2, 'htpbg');
    const htpBox = scene.add.image(width / 2, height / 3 + 200, 'how-to-play').setScale(0.55, 0.8).setDepth(10);
    const htptxt = createCoolText(scene, 540, 610, scene.texts.htp || 'How to Play', {
        fontSize: 70, weight: '900',
        color: '#FFFFFF', stroke: '#0E1C3A', strokeThickness: 8, shadowBlur: 18, depth: 11
    });

    const htptxt1 = createCoolText(scene, 200, 1010, "Avoid:", {
        fontSize: 48, weight: '900',
        color: '#FFFFFF', stroke: '#0E1C3A', strokeThickness: 8, shadowBlur: 18, depth: 11
    });

    const img = scene.add.image(440, 800, 'player').setDepth(11).setScale(0.7)

    const img1 = scene.add.image(440, 1000, 'alien').setDepth(11).setScale(0.7)
    const img2 = scene.add.image(620, 1000, 'alien2').setDepth(11).setScale(0.7)
    const img3 = scene.add.image(820, 800, 'part1').setDepth(11).setScale(1)

    const defaultMsg =
        'Swipe to guide your player\n' +
        'through obstacles and\n' +
        'collect spaceship parts.\n' +
        `Collect ${totalParts} parts to repair your ship.\n` +
        `You can miss up to ${maxMisses} parts.\n` +
        `You have ${maxHealth} health.`;

    const htpText = createCoolText(
        scene,
        200,
        height / 3 + 160,
        scene.texts.htpMessage || defaultMsg,
        {
            fontSize: 48,
            weight: '700',
            color: '#EAF3FF',
            stroke: '#11264C',
            strokeThickness: 6,
            shadowBlur: 14,
            depth: 11
        }
    ).setAlign('center');

    const htpText4 = createCoolText(
        scene,
        630,
        height / 3 + 160,
        " Collect:",
        {
            fontSize: 48,
            weight: '700',
            color: '#EAF3FF',
            stroke: '#11264C',
            strokeThickness: 6,
            shadowBlur: 14,
            depth: 11
        }
    ).setAlign('center');

    scene.tweens.add({
        targets: htpText,
        alpha: { from: 0.9, to: 1 },
        duration: 1500,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
    });
    const playbtn = scene.add.image(width / 2, height / 2 + 320, 'play_game').setOrigin(0.5).setDepth(10).setInteractive();

    playbtn.on('pointerover', () => playbtn.setScale(1.05));
    playbtn.on('pointerout', () => playbtn.setScale(1));
    playbtn.on('pointerdown', () => {
        scene.htpElements.forEach(el => el.destroy());
        scene.htpElements = [];
        initializeGame(scene);
        scene.gameStarted = true;
        scene.scene.resume(); // Resume scene updates after initialization
        // BGM already playing from create(), nothing to do here
    });

    scene.htpElements.push(blur, bg, htpBox, htptxt, htptxt1, htpText4, img, img1, img2, img3, htpText, playbtn);
}

function initializeGame(scene) {
    const cfg = scene.cache.json.get('levelConfig');
    scene.mechanics = cfg.mechanics || {};

    // Apply mechanics from JSON, with defaults if not specified
    scene.gameSpeed = scene.mechanics.obstacleSpeed || scene.gameSpeed;
    scene.glideVelocity = scene.mechanics.glideVelocity || scene.glideVelocity;
    scene.lateralVelocity = scene.mechanics.playerSpeed || scene.lateralVelocity;
    scene.totalParts = scene.mechanics.totalParts || scene.totalParts;
    scene.obstacleSpawnTime = scene.mechanics.obstacleSpawnDelay || scene.obstacleSpawnTime;
    scene.partSpawnTime = scene.mechanics.partSpawnDelay || scene.partSpawnTime;
    scene.maxActiveObjects = scene.mechanics.maxActiveObjects || scene.maxActiveObjects;
    scene.minObjectDistance = scene.mechanics.minObjectDistance || scene.minObjectDistance;
    scene.minPlayerY = scene.cameras.main.height * (scene.mechanics.minPlayerYRatio || 0.6);

    // MISS config + reset
    scene.maxMisses = scene.mechanics.maxMisses || scene.maxMisses || 5;
    scene.missedParts = 0;

    // HEALTH config + reset
    scene.maxHealth = scene.mechanics.maxHealth || scene.maxHealth || 10;
    scene.health = scene.maxHealth;

    // Ensure clean state
    cleanupAllObjects(scene);
    scene.activeObjects = [];
    scene.partsCollected = 0;

    // Reinitialize groups to ensure they exist
    initializeGroups(scene);

    scene.leftBoundary = scene.physics.add.staticGroup();
    scene.rightBoundary = scene.physics.add.staticGroup();
    scene.leftBoundary.create(10, 960, 'ground').setVisible(false).setDisplaySize(20, 1920).refreshBody();
    scene.rightBoundary.create(1070, 960, 'ground').setVisible(false).setDisplaySize(20, 1920).refreshBody();

    scene.player = scene.physics.add.sprite(cfg.spawn.x || 540, cfg.spawn.y || 1152, 'player')
        .setCollideWorldBounds(true)
        .setGravityY(0)
        .setDepth(11)
        .setScale(0.8)
    // .setSize(40, 60);
    scene.player.setVelocityY(-scene.glideVelocity);


    scene.physics.add.collider(scene.player, scene.leftBoundary);
    scene.physics.add.collider(scene.player, scene.rightBoundary);
    scene.physics.add.collider(scene.player, scene.obstacles, (player, obstacle) => {
        handlePlayerObstacleCollision(player, obstacle, scene);
    }, null, scene);
    scene.physics.add.overlap(scene.player, scene.parts, (player, part) => {
        collectPart(player, part, scene);
    }, null, scene);

    const padding = 40;
    const labelX = padding + 20;
    const labelY = padding + 48;
    const width = scene.cameras.main.width;

    scene.add.image(190, 90, 'scoreback')

    scene.add.image(540, 90, 'scoreback')

    scene.add.image(890, 90, 'scoreback')



    // Parts HUD
    scene.partsLabelText = createCoolText(scene, labelX, labelY, (scene.texts.clueLabel || 'Parts:'), {
        fontSize: 46, weight: '900', originX: 0, originY: 0.5,
        color: '#000000ff', stroke: '#ffffffff', strokeThickness: 0, shadowBlur: 14, depth: 12
    });

    scene.scoreText = createCoolText(scene, labelX + 150, labelY, '0', {
        fontSize: 48, weight: '900', originX: 0, originY: 0.5,
        color: '#000000ff', stroke: '#f1f1f1ff', strokeThickness: 0, shadowBlur: 14, depth: 12
    });

    scene.fixedText = createCoolText(scene, labelX + 190, labelY, `/${scene.totalParts}`, {
        fontSize: 44, weight: '800', originX: 0, originY: 0.5,
        color: '#030303ff', stroke: '#f6f9ffff', strokeThickness: 0, shadowBlur: 12, depth: 12
    });

    // HEALTH HUD (center top-ish)
    const healthX = width / 2;
    const healthY = labelY;

    scene.healthText = createCoolText(
        scene,
        healthX,
        healthY,
        `${scene.texts.healthLabel || 'Health'}: ${scene.health}`,
        {
            fontSize: 44,
            weight: '800',
            originX: 0.5,
            originY: 0.5,
            color: '#000000ff',
            stroke: '#ffffffff',
            strokeThickness: 0,
            shadowBlur: 12,
            depth: 12
        }
    );

    // MISS HUD (right side)
    scene.missLabelText = createCoolText(scene, width - padding - 260, labelY, scene.texts.missLabel || 'Miss:', {
        fontSize: 44,
        weight: '800',
        originX: 0,
        originY: 0.5,
        color: '#000000ff',
        stroke: '#fff2f2ff',
        strokeThickness: 0,
        shadowBlur: 12,
        depth: 12
    });

    scene.missText = createCoolText(scene, width - padding - 40, labelY, `0/${scene.maxMisses}`, {
        fontSize: 46,
        weight: '900',
        originX: 1,
        originY: 0.5,
        color: '#000000ff',
        stroke: '#ffffffff',
        strokeThickness: 0,
        shadowBlur: 14,
        depth: 12
    });

    // gentle idle shimmer on parts count
    scene.tweens.add({
        targets: scene.scoreText,
        scaleX: 1.02,
        scaleY: 1.02,
        duration: 1200,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
    });

    scene.cursors = scene.input.keyboard.createCursorKeys();

    scene.jumpSound = scene.sound.add('jump');
    scene.collectSound = scene.sound.add('collect');
    scene.crashSound = scene.sound.add('crash');

    scene.time.addEvent({
        delay: scene.obstacleSpawnTime,
        callback: () => spawnObstacle(scene),
        callbackScope: scene,
        loop: true
    });

    scene.time.addEvent({
        delay: scene.partSpawnTime,
        callback: () => spawnPart(scene),
        callbackScope: scene,
        loop: true
    });
}

// ---------------- SPAWN + COLLISION LOGIC ----------------

function spawnObstacle(scene) {
    if (scene.isGameOver || scene.activeObjects.length >= scene.maxActiveObjects) return;

    const width = scene.cameras.main.width;
    const randomX = findSafeSpawnPosition(
        scene,
        50,
        width - 50,
        -100,
        15,
        scene.minObjectDistance,
        'obstacle'
    );

    // ✅ Only aliens now: alien / alien2
    const alienType = Phaser.Math.Between(0, 1) === 0 ? 'alien' : 'alien2';
    const obstacle = scene.obstacles.create(randomX, -100, alienType).setScale(1);

    obstacle.setDepth(3);

    const obstacleSpeed =
        scene.player && scene.player.y <= scene.minPlayerY
            ? scene.gameSpeed + 200
            : scene.gameSpeed + scene.glideVelocity;

    obstacle.setVelocityY(obstacleSpeed);
    obstacle.setImmovable();

    scene.activeObjects.push(obstacle);
    obstacle.setData('type', 'obstacle');
    obstacle.setData('offScreenCallback', () => {
        const index = scene.activeObjects.indexOf(obstacle);
        if (index > -1) {
            scene.activeObjects.splice(index, 1);
        }
        obstacle.destroy();
    });

    obstacle.outOfBoundsKill = true;
    obstacle.checkWorldBounds = true;
    obstacle.on('outOfBounds', () => obstacle.getData('offScreenCallback')());
}

function spawnPart(scene) {
    if (scene.isGameOver || scene.partsCollected >= scene.totalParts ||
        scene.activeObjects.length >= scene.maxActiveObjects) return;

    const width = scene.cameras.main.width;

    // always use single collectible sprite
    const partKey = 'part1';

    const randomX = findSafeSpawnPosition(
        scene,
        100,
        width - 100,
        -100,
        20,
        scene.minObjectDistance * 1.2,
        'part'
    );

    const part = scene.parts.create(randomX, -100, partKey).setDepth(3);
    const partSpeed = scene.player && scene.player.y <= scene.minPlayerY ?
        scene.gameSpeed + 150 : scene.gameSpeed + scene.glideVelocity + (scene.mechanics.partSpeedAdjustment || -50);
    part.setVelocityY(partSpeed);
    part.setScale(1.5);

    scene.activeObjects.push(part);
    const floatTween = scene.tweens.add({
        targets: part,
        x: part.x + Phaser.Math.Between(-40, 40),
        duration: 2500,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
    });
    part.setAngularVelocity(Phaser.Math.Between(-15, 15));

    part.setData('type', 'part');
    part.setData('tween', floatTween);
    part.setData('offScreenCallback', () => {
        const index = scene.activeObjects.indexOf(part);
        if (index > -1) {
            scene.activeObjects.splice(index, 1);
        }
        if (floatTween && floatTween.isPlaying()) {
            floatTween.stop();
        }
        part.destroy();
    });

    part.outOfBoundsKill = true;
    part.checkWorldBounds = true;
    part.on('outOfBounds', () => part.getData('offScreenCallback')());
}

function findSafeSpawnPosition(scene, minX, maxX, y, attempts = 10, minDistance = null, objectType = null) {
    let randomX;
    let isSafe = false;
    let attempt = 0;
    const distance = minDistance || scene.minObjectDistance;

    while (!isSafe && attempt < attempts) {
        randomX = Phaser.Math.Between(minX, maxX);
        isSafe = !isTooCloseToOtherObjects(scene, randomX, y, distance, objectType);
        attempt++;
    }

    if (!isSafe && attempts < 20) {
        const newY = y + Phaser.Math.Between(-100, 100);
        return findSafeSpawnPosition(scene, minX, maxX, newY, attempts + 5, distance, objectType);
    }

    return randomX;
}

function isTooCloseToOtherObjects(scene, x, y, distance, objectType) {
    for (const obj of scene.activeObjects) {
        if (!obj || !obj.active) continue; // Skip destroyed or inactive objects
        let requiredDistance = distance;
        if (objectType && obj.getData('type') && obj.getData('type') !== objectType) {
            requiredDistance = distance * 1.5;
        }
        const objDistance = Phaser.Math.Distance.Between(x, y, obj.x, obj.y);
        if (objDistance < requiredDistance) {
            return true;
        }
    }
    return false;
}

function collectPart(player, part, scene) {
    scene.collectSound.play();
    const index = scene.activeObjects.indexOf(part);
    if (index > -1) {
        scene.activeObjects.splice(index, 1);
    }
    const tween = part.getData('tween');
    if (tween && tween.isPlaying()) {
        tween.stop();
    }
    part.destroy();
    scene.partsCollected++;
    scene.scoreText.setText(scene.partsCollected);
    // pop effect on score change
    scene.tweens.add({
        targets: scene.scoreText,
        scale: { from: 1.0, to: 1.15 },
        duration: 120,
        yoyo: true,
        ease: 'Back.Out'
    });

    if (scene.partsCollected >= scene.totalParts) {
        handleWin(scene);
    }
}

// HEALTH-BASED obstacle collision
function handlePlayerObstacleCollision(player, obstacle, scene) {
    if (scene.isGameOver) return;

    // remove this obstacle from activeObjects + destroy it
    const index = scene.activeObjects.indexOf(obstacle);
    if (index > -1) {
        scene.activeObjects.splice(index, 1);
    }
    obstacle.destroy();

    scene.crashSound.play();

    // decrement health
    scene.health = (scene.health || scene.maxHealth || 10) - 1;

    // update health HUD
    if (scene.healthText) {
        scene.healthText.setText(`${scene.texts.healthLabel || 'Health'}: ${scene.health}`);
        scene.tweens.add({
            targets: scene.healthText,
            scale: { from: 1.0, to: 1.15 },
            duration: 140,
            yoyo: true,
            ease: 'Back.Out'
        });
    }

    // if health still > 0, continue playing
    if (scene.health > 0) {
        return;
    }

    // health <= 0 → GAME OVER
    scene.isGameOver = true;
    cleanupAllObjects(scene);
    if (scene.player && scene.player.active) {
        scene.player.setVelocity(0);

    }
    if (scene.obstacles && typeof scene.obstacles.setVelocity === 'function') {
        scene.obstacles.setVelocity(0, 0);
    }
    if (scene.parts && typeof scene.parts.setVelocity === 'function') {
        scene.parts.setVelocity(0, 0);
    }
    scene.cameras.main.fade(500, 0, 0, 0);
    scene.time.delayedCall(500, () => {
        try {
            console.log("Calling gameOver from handlePlayerObstacleCollision (health 0)");
            gameOver(
                scene,
                scene.player ? scene.player.x : 540,
                scene.player ? scene.player.y : 1152,
                false,
                scene.texts.healthZeroMessage || ''
            );
        } catch (error) {
            console.error("Error in handlePlayerObstacleCollision:", error);
        }
    });
}

function handleMissedPart(scene) {
    if (scene.isGameOver) return;

    // Increment miss count
    scene.missedParts = (scene.missedParts || 0) + 1;

    // Update HUD
    if (scene.missText) {
        scene.missText.setText(`${scene.missedParts}/${scene.maxMisses}`);
        // small feedback
        scene.tweens.add({
            targets: scene.missText,
            scale: { from: 1.0, to: 1.15 },
            duration: 120,
            yoyo: true,
            ease: 'Back.Out'
        });
    }

    // If we still have misses left, just continue the game
    if (scene.missedParts < scene.maxMisses) {
        return;
    }

    // Reached or exceeded max misses -> Game Over
    scene.isGameOver = true;
    cleanupAllObjects(scene);
    if (scene.player && scene.player.active) {
        scene.player.setVelocity(0);

    }
    if (scene.obstacles && typeof scene.obstacles.setVelocity === 'function') {
        scene.obstacles.setVelocity(0, 0);
    }
    if (scene.parts && typeof scene.parts.setVelocity === 'function') {
        scene.parts.setVelocity(0, 0);
    }
    scene.cameras.main.fade(500, 0, 0, 0);
    scene.time.delayedCall(500, () => {
        try {
            console.log("Calling gameOver from handleMissedPart");
            gameOver(
                scene,
                scene.player ? scene.player.x : 540,
                scene.player ? scene.player.y : 1152,
                false,
                scene.texts.missedPartMessage || 'You missed too many parts!'
            );
        } catch (error) {
            console.error("Error in handleMissedPart:", error);
        }
    });
}

function handleWin(scene) {
    if (scene.isGameOver) return;
    scene.isGameOver = true;
    cleanupAllObjects(scene);
    if (scene.player && scene.player.active) {
        scene.player.setVelocity(0);

    }
    if (scene.obstacles && typeof scene.obstacles.setVelocity === 'function') {
        scene.obstacles.setVelocity(0, 0);
    }
    if (scene.parts && typeof scene.parts.setVelocity === 'function') {
        scene.parts.setVelocity(0, 0);
    }
    scene.cameras.main.fade(500, 0, 0, 0);
    scene.time.delayedCall(500, () => {
        try {
            console.log("Calling gameOver from handleWin");
            gameOver(scene, scene.player ? scene.player.x : 540, scene.player ? scene.player.y : 1152, true, scene.texts.winMessage || '');
        } catch (error) {
            console.error("Error in handleWin:", error);
        }
    });
}

function notifyParent(type, data) {
    if (window.parent !== window) {
        window.parent.postMessage({ type, ...data }, "*");
    }
}

function gameOver(scene, playerX, playerY, isWin, reason) {
    console.log("gameOver function entered, isWin:", isWin, "reason:", reason);
    // Reset camera to ensure visibility
    scene.cameras.main.resetFX();
    scene.cameras.main.setAlpha(1);
    scene.cameras.main.setVisible(true);

    const width = scene.cameras.main.width;
    const height = scene.cameras.main.height;

    const blur = scene.add.rectangle(0, 0, 1080, 1920, 0x000000, 0.5).setOrigin(0).setDepth(9);
    console.log("Blur created:", blur);

    if (isWin) {
        const bg = scene.add.image(width / 2, height / 2, 'winbg');
        const completedBox = scene.add.image(width / 2, height / 2.5 + 185, scene.textures.exists('completed') ? 'completed' : 'space_background').setScale(0.55).setDepth(10);
        const completedText = createCoolText(scene, width / 2, height / 2.5 + 185,
            scene.texts.levelComplete || 'Level Completed',
            { fontSize: 74, weight: '900', color: '#FFFFFF', stroke: '#0E1C3A', strokeThickness: 9, shadowBlur: 20, depth: 11 }
        );

        const winMessageText = createCoolText(scene, width / 2, height / 2.5 + 260, reason,
            { fontSize: 56, weight: '800', color: '#EAF3FF', stroke: '#080808ff', strokeThickness: 0, shadowBlur: 14, depth: 11 }
        ).setAlign('center');

        scene.tweens.add({
            targets: completedText,
            scale: { from: 0.98, to: 1.03 },
            duration: 900,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });
        const replayButton = scene.add.image(width / 2 - 235, height / 2 + 320, scene.textures.exists('replay') ? 'replay' : 'play_game').setInteractive().setDepth(10);
        const nextButton = scene.add.image(width / 2 + 235, height / 2 + 320, scene.textures.exists('next') ? 'next' : 'play_game').setInteractive().setDepth(10);

        console.log("Win UI elements created:", bg, completedBox, completedText, winMessageText, replayButton, nextButton);

        replayButton.on('pointerover', () => replayButton.setScale(1.05));
        replayButton.on('pointerout', () => replayButton.setScale(1));
        nextButton.on('pointerover', () => nextButton.setScale(1.05));
        nextButton.on('pointerout', () => nextButton.setScale(1));

        replayButton.on('pointerdown', () => {
            console.log("Replay button clicked");
            // Clean up before restart
            cleanupAllObjects(scene);
            scene.time.removeAllEvents();
            blur.destroy();
            bg.destroy();
            completedBox.destroy();
            completedText.destroy();
            winMessageText.destroy();
            replayButton.destroy();
            nextButton.destroy();
            scene.isGameOver = false;
            scene.partsCollected = 0;
            scene.missedParts = 0;
            scene.health = scene.maxHealth;
            scene.gameSpeed = scene.mechanics.obstacleSpeed || 320;
            scene.glideVelocity = scene.mechanics.glideVelocity || 320;
            scene.gameStarted = false;
            // scene.restarting = true;

            // ensure BGM is playing on replay
            if (scene.bgm && !scene.bgm.isPlaying) {
                scene.bgm.play();
            }

            scene.scene.restart();
        });

        nextButton.on('pointerdown', () => {
            console.log("Next button clicked");
            // Clean up before restart / exit
            cleanupAllObjects(scene);
            scene.time.removeAllEvents();
            blur.destroy();
            completedBox.destroy();
            completedText.destroy();
            winMessageText.destroy();
            replayButton.destroy();
            nextButton.destroy();
            scene.isGameOver = false;
            scene.partsCollected = 0;
            scene.missedParts = 0;
            scene.health = scene.maxHealth;
            scene.gameStarted = false;
            scene.gameSpeed = scene.mechanics.obstacleSpeed || 320;
            scene.glideVelocity = scene.mechanics.glideVelocity || 320;
            notifyParent('sceneComplete', { result: 'win' });
        });
    } else {
        const bg = scene.add.image(width / 2, height / 2, 'ovrbg');
        const gameOverBox = scene.add.image(width / 2, height / 3 + 200, scene.textures.exists('game_over') ? 'game_over' : 'space_background').setScale(0.5).setDepth(10);
        const gameOverText = createCoolText(scene, 540, 550 + 200,
            scene.texts.leveltxt || 'Game Over',
            { fontSize: 74, weight: '900', color: '#f3f3f3ff', stroke: '#080707ff', strokeThickness: 0, shadowBlur: 20, originX: 0.5, depth: 11 }
        );

        const partsText = createCoolText(scene, 150, 740 + 200,
            scene.texts.partsCollected || 'Parts Collected',
            { fontSize: 56, weight: '800', color: '#FFE2E2', stroke: '#050505ff', strokeThickness: 0, shadowBlur: 14, originX: 0, depth: 11 }
        );

        const scoreText = createCoolText(scene, 940, 740 + 200,
            `${scene.partsCollected}/${scene.totalParts}`,
            { fontSize: 56, weight: '900', color: '#FFFFFF', stroke: '#000000ff', strokeThickness: 0, shadowBlur: 14, originX: 1, depth: 11 }
        );

        const reasonText = createCoolText(scene, width / 2, height / 3 + 340,
            reason,
            { fontSize: 54, weight: '800', color: '#FFECEC', stroke: '#080505ff', strokeThickness: 0, shadowBlur: 14, depth: 11 }
        ).setAlign('center');

        const restartButton = scene.add.image(width / 2, height / 2 + 210, scene.textures.exists('restart') ? 'restart' : 'play_game').setInteractive().setDepth(10);

        console.log("Game over UI elements created:", bg, gameOverBox, gameOverText, partsText, scoreText, reasonText, restartButton);

        restartButton.on('pointerover', () => restartButton.setScale(1.05));
        restartButton.on('pointerout', () => restartButton.setScale(1));

        restartButton.on('pointerdown', () => {
            console.log("Restart button clicked");
            // Clean up before restart
            cleanupAllObjects(scene);
            scene.time.removeAllEvents();
            blur.destroy();
            bg.destroy();
            gameOverBox.destroy();
            gameOverText.destroy();
            partsText.destroy();
            scoreText.destroy();
            reasonText.destroy();
            restartButton.destroy();
            scene.isGameOver = false;
            scene.partsCollected = 0;
            scene.missedParts = 0;
            scene.health = scene.maxHealth;
            scene.gameSpeed = scene.mechanics.obstacleSpeed || 320;
            scene.glideVelocity = scene.mechanics.glideVelocity || 320;
            scene.gameStarted = false;

            // ensure BGM is playing on restart
            if (scene.bgm && !scene.bgm.isPlaying) {
                scene.bgm.play();
            }

            scene.scene.restart();
        });
    }
}

function cleanupOffscreenObjects(scene) {
    const height = scene.cameras.main.height;
    for (let i = scene.activeObjects.length - 1; i >= 0; i--) {
        const obj = scene.activeObjects[i];
        if (obj && obj.active && obj.y > height + 200) {
            if (obj.getData('offScreenCallback')) {
                obj.getData('offScreenCallback')();
            } else {
                scene.activeObjects.splice(i, 1);
                obj.destroy();
            }
        }
    }
    if (scene.activeObjects.length > scene.maxActiveObjects * 0.8) {
        for (let i = 0; i < scene.activeObjects.length && scene.activeObjects.length > scene.maxActiveObjects * 0.6; i++) {
            const obj = scene.activeObjects[i];
            if (obj && obj.active && (obj.y > height || obj.y < -200)) {
                if (obj.getData('offScreenCallback')) {
                    obj.getData('offScreenCallback')();
                    i--;
                } else {
                    scene.activeObjects.splice(i, 1);
                    obj.destroy();
                    i--;
                }
            }
        }
    }
}

function cleanupAllObjects(scene) {
    // Destroy all active objects
    while (scene.activeObjects && scene.activeObjects.length > 0) {
        const obj = scene.activeObjects.pop();
        if (obj && obj.active) {
            const tween = obj.getData && obj.getData('tween');
            if (tween && tween.isPlaying()) {
                tween.stop();
            }
            obj.destroy();
        }
    }

    // Safe clear for obstacle group
    if (scene.obstacles && scene.obstacles.children && typeof scene.obstacles.clear === 'function') {
        scene.obstacles.clear(true, true);
    }

    // Safe clear for parts group
    if (scene.parts && scene.parts.children && typeof scene.parts.clear === 'function') {
        scene.parts.clear(true, true);
    }

    // Destroy player
    if (scene.player && scene.player.active) {
        scene.player.destroy();
        scene.player = null; // Prevent stale reference
    }

    // Safe clear for left and right boundaries
    if (scene.leftBoundary && scene.leftBoundary.children && typeof scene.leftBoundary.clear === 'function') {
        scene.leftBoundary.clear(true, true);
    }
    if (scene.rightBoundary && scene.rightBoundary.children && typeof scene.rightBoundary.clear === 'function') {
        scene.rightBoundary.clear(true, true);
    }

    // Destroy UI elements if they exist
    if (scene.textBox) {
        scene.textBox.destroy();
        scene.textBox = null;
    }
    if (scene.partsLabelText) {
        scene.partsLabelText.destroy();
        scene.partsLabelText = null;
    }
    if (scene.scoreText) {
        scene.scoreText.destroy();
        scene.scoreText = null;
    }
    if (scene.fixedText) {
        scene.fixedText.destroy();
        scene.fixedText = null;
    }
    if (scene.missLabelText) {
        scene.missLabelText.destroy();
        scene.missLabelText = null;
    }
    if (scene.missText) {
        scene.missText.destroy();
        scene.missText = null;
    }
    // HEALTH HUD destroy
    if (scene.healthText) {
        scene.healthText.destroy();
        scene.healthText = null;
    }
}

export default GameScene;
