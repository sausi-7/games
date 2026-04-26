const SCREEN_WIDTH = 1920;
const SCREEN_HEIGHT = 1080;

export { SCREEN_WIDTH, SCREEN_HEIGHT };

export default class GamePlayScene extends Phaser.Scene {
    constructor() {
        super("GamePlayScene");
    }

    preload() {
        const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf("/"));
        this.load.json("levelConfig", `${basePath}/config.json`);

        this.load.once("filecomplete-json-levelConfig", () => {
            const cfg = this.cache.json.get("levelConfig");
            this.levelData = cfg;

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
            // Load audio
            const audio = cfg.audio || {};
            for (const [key, url] of Object.entries(audio)) {
                if (!url || typeof url !== 'string') continue;

                // If URL is absolute (http/https or protocol-relative), use as-is.
                // Otherwise, treat as relative to basePath.
                const audioUrl =
                    /^https?:\/\//i.test(url) || url.startsWith('//')
                        ? url
                        : `${basePath}/${url}`;

                this.load.audio(key, audioUrl).on('error', () => {
                    console.error(`Failed to load audio "${key}" from ${audioUrl}`);
                });
            }

            this.load.start();
        });
    }

    create() {
        const cfg = this.levelData;
        this.jetHits = 0;
        this.score = 0;
        this.jetCrashed = false;
        this.canBeHit = true;
        this.totalSpawned = 0;
        this.requiredKills = cfg.requiredKills || 8;
        this.maxTerrorists = cfg.maxTerrorists || 8;

        this.gameEnded = false;   // <-- ADD THIS HERE


        // Load sounds from the config
        this.sounds = {
            jetMove: this.sound.add("jet_move"),
            missileLaunch: this.sound.add("jet_missile"),
            rocketLaunch: this.sound.add("terrorist_rocket"),
            missileHit: this.sound.add("missile_hit"),
            rocketHit: this.sound.add("rocket_hit"),
            explosion: this.sound.add("explosion")
        };

        this.physics.world.setBounds(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
        this.physics.world.gravity.y = 0;

        // Initialize groups
        this.terrorists = this.physics.add.group();
        this.missiles = this.physics.add.group();
        this.rockets = this.physics.add.group();

        if (this.bgm) {
            this.bgm.stop();
        }
        this.bgm = this.sound.add("bgm", { loop: true, volume: 0.6 });
        this.bgm.play();

        // Add background image
        this.add.image(SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2, "background")
            .setDisplaySize(SCREEN_WIDTH, SCREEN_HEIGHT);

        // Dim overlay for HTP and overlays
        this.bgOverlay = this.add.rectangle(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, 0x000000, 0.8)
            .setOrigin(0, 0)
            .setDepth(1);

        // Initialize UI elements (they will also create win/lose backgrounds)
        addGameOverUIElements(this);
        addLevelCompleteUIElements(this);
        addRetryUIElements(this);

        // Make characters invisible initially
        this.jet = this.physics.add.sprite(960, 150, "fighter")
            .setDisplaySize(320, 107.5)
            .setCollideWorldBounds(true)
            .setDepth(3)
            .setVisible(false);
        this.jet.body.allowGravity = false;

        // Input
        this.cursors = this.input.keyboard.createCursorKeys();

        // Health bar (create but HIDE for now)
        this.jetHealth = 5;
        this.healthBar = this.add.graphics().setDepth(5);
        this.healthBar.setVisible(false);   // <- hide until Play is clicked

        // How-to-play popup (adds htpbg if available)
        addPlayButton(this);

        // WIN event: show winbg + levelComplete panel
        this.events.on('levelComplete', () => {
            this.gameEnded = true;
            this.physics.world.pause();   // STOP ALL MOVEMENT

            // 🔹 Destroy jet (fighter)
            if (this.jet) {
                this.jet.destroy();
                this.jet = null;
            }

            // 🔹 Destroy health bar
            if (this.healthBar) {
                this.healthBar.clear();
                this.healthBar.destroy();
                this.healthBar = null;
            }

            if (this.winBg) this.winBg.setVisible(true);
            this.levelCompleteUI.setVisible(true);

            if (this.joystick) {
                this.joystick.bg.setVisible(false);
                this.joystick.knob.setVisible(false);
            }
        });


        // Joystick (create but HIDE visuals until Play)
        this.joystick = createJoystick(this);
        this.joystick.bg.setVisible(false);
        this.joystick.knob.setVisible(false);

        // Fullscreen toggle
        this.input.addPointer(2);
        this.input.on('pointerup', () => {
            if (this.scale.fullscreen.available) {
                this.scale.startFullscreen();
            }
        });
    }

    update() {
        if (this.gameEnded) return;
        if (!this.jet || !this.jet.active || !this.jet.body) return;

        this.jet.setVelocityX(0);

        if (this.joystick && this.joystick.force > 0) {
            const forceX = this.joystick.forceX;

            this.jet.setVelocityX(forceX * 400);
            this.jet.setAngle(forceX * 10);

            if (!this.sounds.jetMove.isPlaying) {
                this.sounds.jetMove.play({ volume: 0.5 });
            }
        } else {
            this.jet.setAngle(0);
        }

        this.terrorists.getChildren().forEach(t => {
            t.x += 2 * t.getData("direction");
            if (t.x < 50 || t.x > 1870) t.setData("direction", -t.getData("direction"));
        });

        this.missiles.getChildren().forEach(m => {
            if (m.active && m.y > 1080) {
                playExplosion(this, m.x, 980);
                m.destroy();
            }
        });
    }
}

/* ---------- GAME OVER UI (ovrbg) ---------- */

function addGameOverUIElements(scene) {
    // Full-screen lose background (ovrbg) – stays hidden until lose
    if (scene.textures.exists("ovrbg")) {
        scene.ovrBg = scene.add.image(SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2, "ovrbg")
            .setDisplaySize(SCREEN_WIDTH, SCREEN_HEIGHT)
            .setDepth(1.5)
            .setVisible(false);
    }

    // Container for panel UI
    const gameOverUI = scene.add.container(SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2)
        .setDepth(2);

    // Panel (keep using game_over_bg as before)
    const gameOverBg = scene.add.image(0, -100, "game_over_bg")
        .setDisplaySize(666, 216)
        .setDepth(2);
    gameOverUI.add(gameOverBg);

    // Title text from JSON
    const gameOverText = scene.add.text(30, -94, scene.levelData.text.game_over, {
        fontSize: "70px",
        color: "#fff",
        fontFamily: "Arial"
    }).setOrigin(0.5).setDepth(3);
    gameOverUI.add(gameOverText);

    // Replay button
    const replayButton = scene.add.image(0, 130, "replay_button2")
        .setInteractive()
        .setDisplaySize(666, 145);
    replayButton.on("pointerdown", () => {
        if (scene.bgm) {
            scene.bgm.stop();
        }
        scene.scene.restart();
    });
    gameOverUI.add(replayButton);

    gameOverUI.setVisible(false);
    scene.gameOverUI = gameOverUI;
}

/* ---------- LEVEL COMPLETE UI (winbg) ---------- */

function addLevelCompleteUIElements(scene) {
    // Full-screen win background (winbg) – hidden until win
    if (scene.textures.exists("winbg")) {
        scene.winBg = scene.add.image(SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2, "winbg")
            .setDisplaySize(SCREEN_WIDTH, SCREEN_HEIGHT)
            .setDepth(1.5)
            .setVisible(false);
    }

    const levelCompleteUI = scene.add.container(SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2)
        .setDepth(2);

    // Keep old level_complete panel
    const levelCompleteBg = scene.add.image(0, -100, "level_complete")
        .setDisplaySize(914, 217)
        .setDepth(2);
    levelCompleteUI.add(levelCompleteBg);

    const levelCompleteText = scene.add.text(-15, -94, scene.levelData.text.level_complete, {
        fontSize: "70px",
        color: "#fff",
        fontFamily: "Arial"
    }).setOrigin(0.5).setDepth(3);
    levelCompleteUI.add(levelCompleteText);

    const replayButton = scene.add.image(-230, 130, "replay_button")
        .setInteractive()
        .setDisplaySize(441, 145);
    replayButton.on("pointerdown", () => {
        if (scene.bgm) {
            scene.bgm.stop();
        }
        scene.scene.restart();
    });

    levelCompleteUI.add(replayButton);

    const nextLevelButton = scene.add.image(240, 130, "next_level_button")
        .setInteractive()
        .setDisplaySize(441, 145);
    nextLevelButton.on("pointerdown", () => notifyParent('sceneComplete', { result: 'win' }));
    levelCompleteUI.add(nextLevelButton);

    levelCompleteUI.setVisible(false);
    scene.levelCompleteUI = levelCompleteUI;
}

function notifyParent(type, data) {
    if (window.parent !== window) {
        window.parent.postMessage({ type, ...data }, "*");
    }
}

/* ---------- RETRY POPUP (unchanged) ---------- */

function addRetryUIElements(scene) {
    const retryBg = scene.add.rectangle(0, 0, 400, 200, 0x000000, 0.8);
    const retryText = scene.add.text(0, -50, scene.levelData.text.retry_message, {
        fontSize: "40px",
        color: "#fff"
    }).setOrigin(0.5);
    const retryButton = scene.add.text(0, 40, scene.levelData.text.retry_button, {
        fontSize: "36px",
        backgroundColor: "#fff",
        color: "#000"
    })
        .setOrigin(0.5)
        .setPadding(10)
        .setInteractive()
        .on("pointerdown", () => scene.scene.restart());

    scene.retryUI = scene.add.container(SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2);
    scene.retryUI.add([retryBg, retryText, retryButton]);
    scene.retryUI.setVisible(false);
}

/* ---------- HOW TO PLAY POPUP (htpbg) ---------- */

function addPlayButton(scene) {
    // Full-screen HTP background behind dialog
    if (scene.textures.exists("htpbg")) {
        scene.htpBg = scene.add.image(SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2, "htpbg")
            .setDisplaySize(SCREEN_WIDTH, SCREEN_HEIGHT)
            .setDepth(1.2); // above bgOverlay but below dialog panel
    }

    // Center dialog panel (keep using dialog_bg)
    const dialogBg = scene.add.image(SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2 - 100, "dialog_bg")
        .setDisplaySize(837, 494)
        .setDepth(2)
        .setOrigin(0.5);

    const titleText = scene.add.text(
        SCREEN_WIDTH / 2,
        SCREEN_HEIGHT / 2 - 254,
        scene.levelData.text.how_to_play,
        {
            fontSize: "70px",
            color: "#fff",
            font: "bold 70px Arial",
        }
    ).setOrigin(0.5).setDepth(3);

    const descriptionText = scene.add.text(
        SCREEN_WIDTH / 2 - 230,
        SCREEN_HEIGHT / 2 - 100,
        scene.levelData.text.play_description,
        {
            fontSize: "60px",
            wordWrap: { width: 820 },
            color: "#fff",
            fontFamily: "Arial"
        }
    ).setOrigin(0.5).setDepth(3);

    const descriptionText1 = scene.add.text(
        SCREEN_WIDTH / 2 - 230,
        SCREEN_HEIGHT / 2 + 50,
        "Dodge:",
        {
            fontSize: "60px",
            wordWrap: { width: 820 },
            color: "#fff",
            fontFamily: "Arial"
        }
    ).setOrigin(0.5).setDepth(3);

    const img = scene.add.image(1000, 450, 'fighter').setDepth(11).setScale(0.5)
    const img1 = scene.add.image(900, 590, 'missile').setDepth(11).setScale(0.3)

    const playButton = scene.add.image(SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2 + 275, "play_button")
        .setInteractive()
        .setDisplaySize(837, 143)
        .setDepth(3);

    playButton.on('pointerdown', () => {
        scene.sounds.jetMove.play();
        startGame(scene);

        // Show HUD now
        updateHealthBar(scene);
        scene.healthBar.setVisible(true);
        if (scene.joystick) {
            scene.joystick.bg.setVisible(true);
            scene.joystick.knob.setVisible(true);
        }

        // Hide all HTP stuff
        scene.bgOverlay.setVisible(false);
        if (scene.htpBg) scene.htpBg.setVisible(false);
        playButton.setVisible(false);
        titleText.setVisible(false);
        img.setVisible(false);
        img1.setVisible(false);
        descriptionText.setVisible(false);
        descriptionText1.setVisible(false);
        dialogBg.setVisible(false);

        scene.jet.setVisible(true);
    });
}

/* ---------- CONTROLS & GAMEPLAY (unchanged except returning bg) ---------- */

function createJoystick(scene) {
    const bg = scene.add.image(200, SCREEN_HEIGHT / 2, "joystick_bg")
        .setDepth(10)
        .setScrollFactor(0)
        .setInteractive();
    const knob = scene.add.image(200, SCREEN_HEIGHT / 2, "joystick_knob")
        .setDepth(11)
        .setScrollFactor(0)
        .setInteractive();

    let dragging = false;
    let startX = knob.x;
    let maxDist = 100;
    let forceX = 0;

    knob.on("pointerdown", () => dragging = true);
    scene.input.on("pointerup", () => {
        dragging = false;
        knob.x = startX;
        forceX = 0;
    });

    scene.input.on("pointermove", pointer => {
        if (!dragging) return;

        const dx = pointer.x - startX;
        const clamped = Phaser.Math.Clamp(dx, -maxDist, maxDist);
        knob.x = startX + clamped;
        forceX = clamped / maxDist;
    });

    return {
        bg,          // <- so we can hide/show from scene
        knob,
        forceX: 0,
        get force() {
            return Math.abs(forceX);
        },
        get forceX() {
            return forceX;
        }
    };
}

function startGame(scene) {
    scene.time.addEvent({
        delay: 3000,
        loop: true,
        callback: () => {
            if (!scene.jet.active) return;
            const missile = scene.missiles.create(scene.jet.x, scene.jet.y + 20, "missile")
                .setScale(0.25)
                .setDepth(2);
            missile.setVelocityY(500);
            scene.sounds.missileLaunch.play();
            missile.body.allowGravity = false;
        }
    });

    scene.time.addEvent({
        delay: 4000,
        loop: true,
        callback: () => {
            scene.terrorists.getChildren().forEach(t => {
                if (t.active) {
                    const rocket = scene.rockets.create(t.x, t.y - 20, "rocket")
                        .setDisplaySize(62.54, 48.8)
                        .setDepth(1);
                    rocket.setVelocityY(-500);
                    scene.sounds.rocketLaunch.play();
                    rocket.body.allowGravity = false;
                }
            });
        }
    });

    scene.physics.add.overlap(scene.missiles, scene.terrorists, (missile, terrorist) => {
        playExplosion(scene, terrorist.x, terrorist.y);
        missile.destroy();
        terrorist.destroy();
        scene.score++;
        scene.sounds.missileHit.play();
        spawnTerrorists(scene, 1);

        if (scene.score >= scene.requiredKills) {
            scene.events.emit("levelComplete");
        }
    });

    spawnTerrorists(scene, 4);
    setupJetCollisions(scene);
}

function spawnTerrorists(scene, count = 1) {
    for (let i = 0; i < count; i++) {
        if (scene.totalSpawned >= scene.maxTerrorists) return;
        const x = Phaser.Math.Between(100, 1820);
        const idx = Phaser.Math.Between(1, 4);
        const t = scene.physics.add.sprite(x, 900, `terrorist${idx}`)
            .setDisplaySize(164, 315)
            .setDepth(1);
        t.body.allowGravity = false;
        t.setData("direction", Phaser.Math.Between(0, 1) === 0 ? -1 : 1);
        scene.terrorists.add(t);
        scene.totalSpawned++;
    }
}

function setupJetCollisions(scene) {
    scene.physics.add.overlap(scene.rockets, scene.jet, (rocket) => {
        if (!scene.canBeHit || scene.jetCrashed) return;

        scene.canBeHit = false;
        rocket.destroy();
        scene.sounds.rocketHit.play();

        scene.jetHealth--;
        updateHealthBar(scene);

        playExplosion(scene, scene.jet.x, scene.jet.y, "explosion2");
        scene.jet.setTint(0xff0000);

        scene.time.delayedCall(200, () => {
            scene.jet.clearTint();
            scene.canBeHit = true;
        });

        if (scene.jetHealth > 0) {
            respawnJet(scene);
        } else if (!scene.jetCrashed) {
            scene.jetCrashed = true;
            crashAndBurn(scene);
        }
    });
}

function updateHealthBar(scene) {
    scene.healthBar.clear();
    const barWidth = 300;
    const barHeight = 25;
    const x = 860;
    const y = 30;

    scene.healthBar.fillStyle(0x555555, 1);
    scene.healthBar.fillRect(x, y, barWidth, barHeight);

    const healthRatio = Phaser.Math.Clamp(scene.jetHealth / 5, 0, 1);
    scene.healthBar.fillStyle(0xff0000, 1);
    scene.healthBar.fillRect(x, y, barWidth * healthRatio, barHeight);
}

function respawnJet(scene) {
    const oldJet = scene.jet;
    oldJet.destroy();

    scene.time.delayedCall(600, () => {
        scene.jet = scene.physics.add.sprite(960, 150, "fighter")
            .setDisplaySize(320, 107.5)
            .setCollideWorldBounds(true)
            .setDepth(3);
        scene.jet.body.allowGravity = false;
        setupJetCollisions(scene);
    });
}

function crashAndBurn(scene) {
    const crashJet = scene.physics.add.sprite(scene.jet.x, scene.jet.y, "fighter")
        .setDisplaySize(320, 107.5)
        .setAngle(45)
        .setDepth(3);

    crashJet.setVelocity(0, 300);
    crashJet.setAngularVelocity(200);
    crashJet.setCollideWorldBounds(false);
    crashJet.body.allowGravity = false;

    for (let i = 1; i <= 4; i++) {
        scene.time.delayedCall(500 * i, () => {
            playExplosion(scene, crashJet.x + Phaser.Math.Between(-40, 40), crashJet.y + Phaser.Math.Between(-20, 20));
        });
    }

    scene.time.delayedCall(1200, () => {
        playExplosion(scene, crashJet.x, 980, "explosion2");
        crashJet.destroy();

        scene.gameEnded = true;            // STOP GAME
        scene.physics.world.pause();       // PAUSE PHYSICS

        if (scene.joystick) {
            scene.joystick.bg.setVisible(false);
            scene.joystick.knob.setVisible(false);
        }

        if (scene.ovrBg) scene.ovrBg.setVisible(true);
        scene.gameOverUI.setVisible(true);
    });

}

function playExplosion(scene, x, y, texture = "explosion") {
    const boom = scene.add.image(x, y, texture)
        .setDisplaySize(495, 400)
        .setDepth(4);
    scene.sounds.explosion.play();

    scene.tweens.add({
        targets: boom,
        alpha: 0,
        duration: 400,
        onComplete: () => boom.destroy()
    });
}

function nextLevel(scene) {
    scene.scene.start("NextLevelScene");
}
