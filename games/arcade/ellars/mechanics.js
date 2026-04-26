const SCREEN_WIDTH = 1080;
const SCREEN_HEIGHT = 1920;

export default class GP002Scene extends Phaser.Scene {
    constructor() {
        super("GP002Scene");
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

            if (cfg.audio) {
                for (const [key, url] of Object.entries(cfg.audio)) {
                    this.load.audio(key, `${basePath}/${url}`);
                }
            }

            if (cfg.tileTypes) {
                this.tileTypes = cfg.tileTypes;
                this.tileTypes.forEach(t => this.load.image(t, `${basePath}/assets/${t}.png`));
            }

            if (cfg.gearTypes) {
                this.gearTypes = cfg.gearTypes;
                this.gearTypes.forEach(g => this.load.image(g, `${basePath}/assets/${g}.png`));
            }

            if (cfg.foodTypes) {
                this.foodTypes = cfg.foodTypes;
                this.foodTypes.forEach(f => this.load.image(f, `${basePath}/assets/${f}.png`));
            }

            this.load.on('complete', () => {
                console.log('All assets loaded successfully');
            });

            this.load.on('fileerror', (file) => {
                console.error(`Error loading file: ${file.key}`);
            });

            this.load.start();
        });
    }

    create() {
        const cfg = this.levelData;
        this.gridRows = cfg.gridRows || 6;
        this.gridCols = cfg.gridCols || 6;
        this.tileSize = cfg.tileSize || 160;
        this.tileScale = cfg.tileScale || 0.8;
        this.moveLimit = cfg.moveLimit || 20;
        this.shuffleChances = cfg.shuffleChances || 3;

        this.gearsRequired = cfg.gearsRequired || 10;
        this.remainingMoves = this.moveLimit;
        this.gearsCollected = 0;
        this.totalGearsPlaced = 2;
        this.fallingTilesCount = 0;

        this.yOffset = ((cfg.orientation?.height || 1920) - (this.gridRows * this.tileSize)) / 2 - 130;
        this.xOffset = ((cfg.orientation?.width || 1080) - (this.gridCols * this.tileSize)) / 2;

        this.add.image(540, 960, "jungle_background").setDisplaySize(1080, 1920).setDepth(-2);
        this.add.image(540, this.yOffset + (this.tileSize * this.gridRows) / 2, "grid_background").setDepth(-1);
        this.add.image(540, this.yOffset + (this.tileSize * this.gridRows) / 2, "middle_background").setDepth(-1);
        createStartScreen(this);
    }

    update() { }
}

// ========== External Functions ========== //

function createStartScreen(scene) {
    scene.startScreenElements = [];

    const black_bg = scene.add.rectangle(0, 0, 1080, 1920, 0x000000, 0.8)
        .setOrigin(0, 0).setDepth(2000);

    const bgImage = scene.add.image(540, 820, "game_info")
        .setDisplaySize(914, 1201).setDepth(2000);
    const heading = scene.add.text(260, 320, "How to Play", {
        font: "bold 70px Arial",
        fill: "#ffffff"
    }).setOrigin(0, 0.5).setDepth(2001);
    const description = scene.add.text(160, 460,
        "On a grid covered with,\n" +
        "various objects, try to form\n" +
        "horizontal or vertical\n" +
        "chains of at least three\n" +
        "identical ones by swapping\n" +
        "neighbouring objects. Find\n" +
        "parts and food before the\n" +
        "timer runs out.",
        {
            font: "60px Arial",
            fill: "#ffffff",
            wordWrap: { width: 820 },
            align: "left",
            lineSpacing: 10
        }
    ).setOrigin(0, 0).setDepth(2001);

    const partsLabel = scene.add.text(160, 1170, `Parts to Collect:`, {
        font: "60px Arial",
        fill: "#ffffff",
        align: "left"
    }).setOrigin(0, 0.5).setDepth(2001);

    const partsValue = scene.add.text(880, 1170, `${scene.gearsRequired}`, {
        font: "60px Arial",
        fill: "#ffffff",
        align: "right"
    }).setOrigin(1, 0.5).setDepth(2001);

    const timeLabel = scene.add.text(160, 1300, `Time:`, {
        font: "60px Arial",
        fill: "#ffffff",
        align: "left"
    }).setOrigin(0, 0.5).setDepth(2001);

    const timeValue = scene.add.text(880, 1300, `01:20`, {
        font: "60px Arial",
        fill: "#ffffff",
        align: "right"
    }).setOrigin(1, 0.5).setDepth(2001);

    const btnBg = scene.add.image(540, 1570, "texts_bg")
        .setDisplaySize(914, 164)
        .setDepth(2001);

    const playBtn = scene.add.text(540, 1570, "▶ Play Game", {
        font: "bold 70px Arial",
        fill: "#000000"
    }).setOrigin(0.5).setDepth(2002).setInteractive();

    scene.startScreenElements.push(
        bgImage, heading, description,
        partsLabel, partsValue, timeLabel, timeValue,
        btnBg, playBtn
    );

    playBtn.on("pointerdown", () => {
        scene.startScreenElements.forEach(el => el.destroy());
        black_bg.destroy();
        startGame(scene);
    });
}

function startGame(scene) {
    // Resume audio context if suspended
    if (scene.sound && scene.sound.context && scene.sound.context.state === 'suspended') {
        scene.sound.context.resume().then(() => {
            console.log('Audio context resumed');
        });
    }

    // Check if physics is available
    if (!scene.physics) {
        console.error('Physics system is not initialized. Check game configuration.');
        return;
    }

    scene.createUI = () => createUI(scene);
    scene.createBoard = () => createBoard(scene);
    scene.placeGearsSmartly = () => placeGearsSmartly(scene);
    scene.dropTiles = () => dropTiles(scene);
    scene.animateShuffle = () => animateShuffle(scene);
    scene.handleInput = pointer => handleInput(scene, pointer);
    scene.processMatches = () => processMatches(scene);
    scene.updateHungryBar = () => updateHungryBar(scene);
    scene.areAdjacent = (a, b) => areAdjacent(a, b);
    scene.swapTiles = (a, b, playerMove) => swapTiles(scene, a, b, playerMove);
    scene.spawnFood = () => spawnFood(scene);
    scene.showLevelCompleteScreen = () => showLevelCompleteScreen(scene);
    scene.showGameOverScreen = () => showGameOverScreen(scene);

    scene.createUI();
    scene.createBoard();

    const pathY = 1690;
    scene.add.image(540, pathY + 150, "path").setDisplaySize(1080, 90).setDepth(1);
    scene.ellara = scene.add.image(720, pathY + 20, "ellara").setDisplaySize(156, 252).setDepth(2);
    scene.add.image(920, pathY, "time_machine").setDisplaySize(319, 357).setDepth(2);
    scene.dino = scene.physics.add.image(200, pathY + 20, "dino").setDisplaySize(400, 300).setDepth(2);
    scene.dino.body.allowGravity = false;
    scene.updateHungryBar();

    scene.physics.moveTo(scene.dino, scene.dino.x + 400, pathY, 5);
    scene.physics.add.overlap(scene.dino, scene.ellara, () => {
        scene.dino.destroy();
        scene.showGameOverScreen();
    });

    scene.remainingTime = 80;
    scene.timerEvent = scene.time.addEvent({
        delay: 1000,
        callback: () => {
            if (scene.remainingTime > 0) {
                scene.remainingTime--;
            }

            const min = Math.floor(scene.remainingTime / 60);
            const sec = scene.remainingTime % 60;
            const minStr = min < 10 ? `0${min}` : `${min}`;
            const secStr = sec < 10 ? `0${sec}` : `${sec}`;
            scene.timerText.setText(`${minStr}:${secStr}`);

            if (scene.remainingTime === 10 && scene.sound) {
                scene.sound.play("low_time_warning");
            }

            if (scene.remainingTime === 0 && scene.gearsCollected < scene.gearsRequired) {
                scene.timerEvent.remove();
                scene.showGameOverScreen();
            }
        },
        loop: true
    });

    scene.input.on("pointerdown", scene.handleInput, scene);
    if (scene.sound) {
        scene.bgMusic = scene.sound.add("bg_music", { loop: true, volume: 0.4 });
        scene.bgMusic.play();
    } else {
        console.warn("Sound system unavailable, skipping background music");
    }
}

function createUI(scene) {
    const topY = 95;
    const bgY = 95;

    // --- DUMMY TIMER TEXT ELEMENTS (DEPTH 9) --- //
    scene.add.image(115, topY - 5, "stopwatch_icon").setDisplaySize(40, 50).setDepth(9);
    scene.add.text(145, topY, "Time:", {
        font: "bold 50px Arial",
        fill: "#ffffff",
        alpha: 0.01
    }).setOrigin(0, 0.5).setDepth(9);
    scene.add.text(285, topY, "00:00", {
        font: "50px Arial",
        fill: "# Carbide",
        alpha: 0.01
    }).setOrigin(0, 0.5).setDepth(9);

    // --- BACKGROUND --- //
    scene.add.image(250, bgY, "texts_bg").setDisplaySize(367, 82).setDepth(10);

    // --- REAL TIMER ICON + TEXT --- //
    scene.add.image(115, topY - 5, "stopwatch_icon").setDisplaySize(40, 50).setDepth(11);
    scene.add.text(145, topY, "Time:", {
        font: "bold 50px Arial",
        fill: "#000000"
    }).setOrigin(0, 0.5).setDepth(11);
    scene.timerText = scene.add.text(285, topY, "1:20", {
        font: "50px Arial",
        fill: "#000000"
    }).setOrigin(0, 0.5).setDepth(11);

    scene.add.image(825, bgY, "texts_bg").setDisplaySize(360, 82).setDepth(10);
    scene.add.image(685, topY, "gear_icon").setDisplaySize(44, 48).setDepth(11);
    scene.partsLabel = scene.add.text(730, topY, "Parts:", { font: "bold 50px Arial", fill: "#000000" }).setOrigin(0, 0.5).setDepth(11);
    scene.partsCount = scene.add.text(890, topY, `${scene.gearsCollected}/${scene.gearsRequired}`, { font: "50px Arial", fill: "#000000" }).setOrigin(0, 0.5).setDepth(11);

    const barX = 660, barY = 220;
    scene.add.image(barX + 175, barY + 10, "foodbar_bg").setDisplaySize(353.4, 76.47).setOrigin(0.5).setDepth(8);
    scene.foodBar = scene.add.graphics().setDepth(10);
    scene.hungryValue = 90;

    const shuffleY = scene.yOffset + scene.tileSize * scene.gridRows + 110;
    const shuffleBg = scene.add.image(225, shuffleY, "texts_bg").setDisplaySize(357, 82).setDepth(10);
    scene.add.image(shuffleBg.x - 105, shuffleY - 3, "shuffle_icon").setDisplaySize(42, 42).setDepth(11);
    scene.shuffleText = scene.add.text(shuffleBg.x + 40, shuffleY - 3, "Reshuffle", { font: "bold 50px Arial", fill: "#000000" }).setOrigin(0.5).setDepth(11).setInteractive();

    scene.shuffleText.on("pointerdown", () => {
        if (scene.shuffleChances > 0) {
            scene.shuffleChances--;
            scene.animateShuffle();
        } else if (scene.sound) {
            scene.sound.play("wrong_swap");
        }
    });

    scene.gearSlots = [];
    scene.gearSlotImages = [];
    const startY = 900;
    for (let i = 0; i < scene.gearsRequired; i++) {
        const slot = scene.add.image(950, startY - i * 80, "gear_icon").setDisplaySize(70, 70).setAlpha(0).setOrigin(0.5).setDepth(2);
        scene.gearSlots.push({ x: slot.x, y: slot.y });
        scene.gearSlotImages.push(slot);
    }
}

function updateHungryBar(scene) {
    const barX = 670;
    const barY = 220;

    scene.foodBar.clear();
    scene.foodBar.fillStyle(0xffcc00, 1);

    const width = 280 * (scene.hungryValue / 100);
    scene.foodBar.fillRect(barX, barY, width, 13);

    if (scene.hungryValue <= 0 && !scene.foodGameOver) {
        scene.foodGameOver = true;
        scene.timerEvent?.remove();
        scene.showGameOverScreen();
    }
}

function createBoard(scene) {
    scene.board = [];

    for (let row = 0; row < scene.gridRows; row++) {
        scene.board[row] = [];
        for (let col = 0; col < scene.gridCols; col++) {
            const x = col * scene.tileSize + scene.tileSize / 2 + scene.xOffset;
            const y = row * scene.tileSize + scene.tileSize / 2 + scene.yOffset;

            let type, tries = 0;
            do {
                type = Phaser.Utils.Array.GetRandom(scene.tileTypes);
                tries++;
            } while (
                tries < 10 &&
                ((col >= 2 && scene.board[row][col - 1]?.texture.key === type && scene.board[row][col - 2]?.texture.key === type) ||
                    (row >= 2 && scene.board[row - 1]?.[col]?.texture.key === type && scene.board[row - 2]?.[col]?.texture.key === type))
            );

            const tile = scene.add.sprite(x, y, type)
                .setDisplaySize(scene.tileSize * scene.tileScale, scene.tileSize * scene.tileScale)
                .setData({ type, row, col })
                .setInteractive()
                .setDepth(2);

            scene.board[row][col] = tile;
        }
    }

    scene.placeGearsSmartly();
}

function placeGearsSmartly(scene) {
    const gearPlacementPlan = [
        { minRow: 0, maxRow: 2, count: 1 },
        { minRow: 3, maxRow: 5, count: 1 }
    ];

    let totalPlaced = 0;
    const alreadyPlacedPositions = new Set();

    for (const { minRow, maxRow, count } of gearPlacementPlan) {
        let valid = [];

        for (let row = minRow; row <= maxRow; row++) {
            for (let col = 1; col < scene.gridCols - 1; col++) {
                const key = `${row}-${col}`;
                if (!alreadyPlacedPositions.has(key)) {
                    valid.push({ row, col });
                }
            }
        }

        Phaser.Utils.Array.Shuffle(valid);

        let gearsPlaced = 0;
        for (let { row, col } of valid) {
            const neighbors = [
                scene.board[row - 1]?.[col],
                scene.board[row + 1]?.[col],
                scene.board[row]?.[col - 1],
                scene.board[row]?.[col + 1]
            ];

            const counts = {};
            for (let t of neighbors.map(n => n?.texture?.key)) {
                if (scene.tileTypes.includes(t)) counts[t] = (counts[t] || 0) + 1;
            }

            if (Object.values(counts).some(c => c >= 2)) continue;

            const gear = Phaser.Utils.Array.GetRandom(scene.gearTypes);
            const tile = scene.board[row][col];
            tile.setTexture(gear);
            tile.setDisplaySize(scene.tileSize * scene.tileScale, scene.tileSize * scene.tileScale);
            tile.setData("type", gear);
            tile.setDepth(1);

            const key = `${row}-${col}`;
            alreadyPlacedPositions.add(key);
            gearsPlaced++;
            totalPlaced++;

            if (gearsPlaced >= count || totalPlaced >= scene.gearsRequired) break;
        }

        if (totalPlaced >= scene.gearsRequired) break;
    }

    scene.totalGearsPlaced = totalPlaced;
}

function areAdjacent(a, b) {
    const dx = Math.abs(a.getData("col") - b.getData("col"));
    const dy = Math.abs(a.getData("row") - b.getData("row"));
    return dx + dy === 1;
}

function handleInput(scene, pointer) {
    const col = Math.floor((pointer.x - scene.xOffset) / scene.tileSize);
    const row = Math.floor((pointer.y - scene.yOffset) / scene.tileSize);
    if (row < 0 || row >= scene.gridRows || col < 0 || col >= scene.gridCols) return;

    const tile = scene.board[row][col];
    if (!tile) return;

    if (!scene.selectedTile) {
        scene.selectedTile = tile;
        tile.setTint(0xffffaa);
    } else {
        tile.clearTint();
        if (scene.areAdjacent(scene.selectedTile, tile)) {
            scene.swapTiles(scene.selectedTile, tile, true);
            scene.selectedTile.clearTint();
            scene.selectedTile = null;
        } else {
            scene.selectedTile.clearTint();
            scene.selectedTile = tile;
            tile.setTint(0xffffaa);
        }
    }
}

function swapTiles(scene, a, b, playerMove = false) {
    if (!a || !b) return;

    const r1 = a.getData("row"), c1 = a.getData("col");
    const r2 = b.getData("row"), c2 = b.getData("col");

    scene.board[r1][c1] = b;
    scene.board[r2][c2] = a;
    a.setData({ row: r2, col: c2 });
    b.setData({ row: r1, col: c1 });

    scene.tweens.add({ targets: a, x: c2 * scene.tileSize + scene.tileSize / 2 + scene.xOffset, y: r2 * scene.tileSize + scene.tileSize / 2 + scene.yOffset, duration: 150 });

    if (playerMove) {
        scene.hungryValue = Math.max(0, scene.hungryValue - 10);
        scene.updateHungryBar();
        if (scene.sound) {
            scene.sound.play("correct_swap");
        }
    }

    scene.tweens.add({
        targets: b,
        x: c1 * scene.tileSize + scene.tileSize / 2 + scene.xOffset,
        y: r1 * scene.tileSize + scene.tileSize / 2 + scene.yOffset,
        duration: 150,
        onComplete: () => {
            const matched = scene.processMatches();
            if (!matched && playerMove && scene.sound) {
                scene.sound.play("wrong_swap");
                scene.swapTiles(a, b, false);
            }
        }
    });
}

function dropTiles(scene) {
    for (let c = 0; c < scene.gridCols; c++) {
        let empty = 0;
        for (let r = scene.gridRows - 1; r >= 0; r--) {
            const tile = scene.board[r][c];
            if (!tile) {
                empty++;
            } else if (empty > 0) {
                const newRow = r + empty;
                scene.board[newRow][c] = tile;
                scene.board[r][c] = null;
                tile.setData({ row: newRow, col: c });
                scene.tweens.add({
                    targets: tile,
                    y: newRow * scene.tileSize + scene.tileSize / 2 + scene.yOffset,
                    duration: 200
                });
            }
        }

        for (let r = 0; r < empty; r++) {
            const x = c * scene.tileSize + scene.tileSize / 2 + scene.xOffset;
            const y = r * scene.tileSize + scene.tileSize / 2 + scene.yOffset;

            let type;
            if (
                scene.totalGearsPlaced < scene.gearsRequired &&
                scene.fallingTilesCount >= 8 &&
                Phaser.Math.Between(0, 100) < 10
            ) {
                type = Phaser.Utils.Array.GetRandom(scene.gearTypes);
                scene.totalGearsPlaced++;
                scene.fallingTilesCount = 0;
            } else if (scene.tileDestroyStreak >= Phaser.Math.Between(15, 25)) {
                type = 'food';
                scene.tileDestroyStreak = 0;
            } else {
                let tries = 0;
                do {
                    type = Phaser.Utils.Array.GetRandom(scene.tileTypes);
                    const below1 = scene.board[r + 1]?.[c]?.texture?.key;
                    const below2 = scene.board[r + 2]?.[c]?.texture?.key;
                    if (below1 === type && below2 === type) {
                        tries++;
                        continue;
                    }
                    break;
                } while (tries < 10);
                scene.fallingTilesCount++;
            }

            const tile = scene.add.sprite(x, -scene.tileSize, type)
                .setDisplaySize(scene.tileSize * scene.tileScale, scene.tileSize * scene.tileScale)
                .setOrigin(0.5)
                .setData({ type, row: r, col: c })
                .setDepth(1);
            scene.board[r][c] = tile;

            scene.tweens.add({
                targets: tile,
                y: y,
                duration: 300
            });
        }
    }

    scene.time.delayedCall(350, () => {
        scene.processMatches();
    });
}

function processMatches(scene) {
    let matched = [];

    for (let r = 0; r < scene.gridRows; r++) {
        for (let c = 0; c < scene.gridCols - 2; c++) {
            const [t1, t2, t3] = [scene.board[r][c], scene.board[r][c + 1], scene.board[r][c + 2]];
            if (t1 && t2 && t3 && !scene.gearTypes.includes(t1.texture.key) && !scene.foodTypes.includes(t1.texture.key) &&
                t1.texture.key === t2.texture.key && t1.texture.key === t3.texture.key) {
                matched.push(t1, t2, t3);
            }
        }
    }

    for (let c = 0; c < scene.gridCols; c++) {
        for (let r = 0; r < scene.gridRows - 2; r++) {
            const [t1, t2, t3] = [scene.board[r][c], scene.board[r + 1][c], scene.board[r + 2][c]];
            if (t1 && t2 && t3 && !scene.gearTypes.includes(t1.texture.key) && !scene.foodTypes.includes(t1.texture.key) &&
                t1.texture.key === t2.texture.key && t1.texture.key === t3.texture.key) {
                matched.push(t1, t2, t3);
            }
        }
    }

    matched = [...new Set(matched)];
    if (matched.length === 0) return false;

    const gearsToCollect = new Set();
    const foodToCollect = new Set();

    matched.forEach(tile => {
        const r = tile.getData("row");
        const c = tile.getData("col");

        if (typeof r !== 'number' || typeof c !== 'number') return;
        if (!scene.board[r] || !scene.board[r][c]) return;

        const adj = [
            [r - 1, c],
            [r + 1, c],
            [r, c - 1],
            [r, c + 1]
        ];

        adj.forEach(([ar, ac]) => {
            if (
                ar >= 0 && ar < scene.gridRows &&
                ac >= 0 && ac < scene.gridCols &&
                scene.board[ar] && scene.board[ar][ac]
            ) {
                const neighbor = scene.board[ar][ac];
                if (scene.gearTypes.includes(neighbor.texture.key)) {
                    gearsToCollect.add(neighbor);
                } else if (scene.foodTypes.includes(neighbor.texture.key)) {
                    foodToCollect.add(neighbor);
                }
            }
        });

        tile.destroy();
        scene.board[r][c] = null;
        scene.tileDestroyStreak = (scene.tileDestroyStreak || 0) + 1;
    });

    foodToCollect.forEach(food => {
        const r = food.getData("row");
        const c = food.getData("col");
        food.destroy();
        scene.board[r][c] = null;
        scene.hungryValue = Math.min(100, scene.hungryValue + 30);
        scene.updateHungryBar();
        if (scene.sound) {
            scene.sound.play("food_collected");
        }
    });

    gearsToCollect.forEach(gear => {
        const r = gear.getData("row");
        const c = gear.getData("col");
        gear.destroy();
        scene.board[r][c] = null;

        if (scene.gearsCollected < scene.gearsRequired) {
            scene.gearsCollected++;
            scene.partsCount.setText(`${scene.gearsCollected}/${scene.gearsRequired}`);
            if (scene.sound) {
                scene.sound.play("gear_collected");
            }

            if (scene.gearsCollected === scene.gearsRequired) {
                scene.cameras.main.flash(300, 255, 255, 255);
                scene.time.delayedCall(800, () => {
                    scene.showLevelCompleteScreen();
                });
            }
        }
    });

    if (scene.gearsCollected < scene.gearsRequired) {
        scene.dropTiles();
        return true;
    }

    return false;
}

function animateShuffle(scene) {
    if (scene.sound) {
        scene.sound.play("shuffle_sound");
    }
    const flat = scene.board.flat().filter(Boolean);
    Phaser.Utils.Array.Shuffle(flat);

    flat.forEach((tile, i) => {
        const row = Math.floor(i / scene.gridCols);
        const col = i % scene.gridCols;

        const x = col * scene.tileSize + scene.tileSize / 2 + scene.xOffset;
        const y = row * scene.tileSize + scene.tileSize / 2 + scene.yOffset;

        scene.board[row][col] = tile;
        tile.setData({ row, col, type: tile.texture.key });

        scene.tweens.add({ targets: tile, x, y, duration: 300 });
    });
}

function spawnFood(scene) {
    if (!scene.physics) {
        console.warn("Physics unavailable, skipping food spawn");
        return;
    }

    const col = Phaser.Math.Between(0, scene.gridCols - 1);
    const x = col * scene.tileSize + scene.tileSize / 2 + scene.xOffset;
    const y = -50;

    const food = scene.add.circle(x, y, 30, 0x00ff00).setDepth(20);
    scene.physics.add.existing(food);
    food.body.setVelocityY(200);

    scene.physics.add.overlap(food, scene.ellara, () => {
        food.destroy();
        scene.hungryValue = Math.min(100, scene.hungryValue + 30);
        scene.updateHungryBar();
    });
}

function showGameOverScreen(scene) {
    if (scene.sound) {
        scene.sound.play("game_over");
    }
    const black_bg_over = scene.add.rectangle(0, 0, 1080, 1920, 0x000000, 0.8).setOrigin(0, 0).setDepth(2000);
    const bg = scene.add.image(540, 960, "game_over").setDisplaySize(914, 376).setDepth(3000);
    const title = scene.add.text(450, 875, "Game Over", { font: "bold 70px Arial", fill: "#ffffff" }).setOrigin(0.5).setDepth(3001);
    const partsLabel = scene.add.text(160, 1050, "Parts Collected:", { font: "60px Arial", fill: "#ffffff" }).setOrigin(0, 0.5).setDepth(3001);
    const partsValue = scene.add.text(880, 1050, `${scene.gearsCollected}/${scene.gearsRequired}`, { font: "60px Arial", fill: "#ffffff" }).setOrigin(1, 0.5).setDepth(3001);
    const replayBtnBg = scene.add.image(540, 1300, "texts_bg").setDisplaySize(914, 164).setDepth(3001);
    const replayBtn = scene.add.text(540, 1295, "⟳ Replay Level", {
        font: "bold 60px Arial", fill: "#000000"
    }).setOrigin(0.5).setInteractive().setDepth(3002);

    replayBtn.on("pointerdown", () => {
        [bg, title, partsLabel, partsValue, replayBtnBg, replayBtn, black_bg_over].forEach(el => el.destroy());
        scene.scene.restart();
    });
}
function notifyParent(type, data) {
    if (window.parent !== window) {
        window.parent.postMessage({ type, ...data }, "*");
    }
}

function showLevelCompleteScreen(scene) {
    const black_bg_level = scene.add.rectangle(0, 0, 1080, 1920, 0x000000, 0.8).setOrigin(0, 0).setDepth(2000);
    const bg = scene.add.image(540, 890, "level_complete").setDisplaySize(914, 217).setDepth(3000);
    const title = scene.add.text(560, 895, "Level Complete", { font: "bold 70px Arial", fill: "#ffffff" }).setOrigin(0.5).setDepth(3002);

    const nextBtnBg = scene.add.image(780, 1100, "texts_bg").setDisplaySize(441, 145).setDepth(3001);
    const nextBtn = scene.add.text(780, 1095, "▶ Next", {
        font: "bold 70px Arial", fill: "#000000"
    }).setOrigin(0.5).setInteractive().setDepth(3002);

    nextBtn.on("pointerdown", () => {
        [bg, title, nextBtnBg, nextBtn, black_bg_level].forEach(el => el.destroy());
        scene.scene.stop();
        notifyParent('sceneComplete', { result: 'win' });
    });

    const replayBtnBg = scene.add.image(300, 1100, "texts_bg").setDisplaySize(441, 145).setDepth(3001);
    const replayBtn = scene.add.text(300, 1095, "⟳ Replay", {
        font: "bold 70px Arial", fill: "#000000"
    }).setOrigin(0.5).setInteractive().setDepth(3002);

    replayBtn.on("pointerdown", () => {
        [bg, title, nextBtnBg, nextBtn, replayBtnBg, replayBtn, black_bg_level].forEach(el => el.destroy());
        scene.scene.restart();
    });
}