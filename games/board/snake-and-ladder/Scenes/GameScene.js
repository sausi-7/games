class GameScene extends Phaser.Scene {
  constructor() {
    super("GameScene");

    // Core state
    this.cfg = null;

    this.boardTiles = [];
    this.tilePositions = {}; // tileIndex -> { x, y }

    // Player & AI tokens
    this.player = null;
    this.ai = null;
    this.currentTile = 1;  // player tile
    this.aiTile = 1;       // AI tile
    this.targetTile = 1;
    this.isMoving = false;
    this.currentTurn = "player"; // "player" | "ai"

    this.snakesMap = {};
    this.laddersMap = {};

    this.remainingTime = 0; // no longer used, but kept for safety
    this.movesUsed = 0;     // no limit now, just races to 100
    this.gameWon = false;
    this.gameOver = false;

    // UI
    this.positionText = null;
    this.timerText = null;     // not used anymore
    this.movesText = null;     // not used anymore
    this.diceSprite = null;
    this.diceValueText = null;
    this.turnText = null;
    this.scoreBg = null;

    // button props unused but kept
    this.leftBtn = null;
    this.rightBtn = null;
    this.actionBtn = null;

    // Audio
    this.bgm = null;
    this.sfxRoll = null;
    this.sfxSnake = null;
    this.sfxLadder = null;
    this.sfxWin = null;
    this.sfxLose = null;

    // UI font helper
    this.uiFontFamily = "Arial";

    // Text labels from JSON
    this.playerTurnLabel = "Your Turn";
    this.aiTurnLabel = "AI Turn";
    this.aiDicePrefix = "AI:";
  }

  preload() {
    // Load all assets based on config
    this.cfg = this.registry.get("cfg") || {};

    const images = this.cfg.images1 || {};
    Object.keys(images).forEach((key) => {
      this.load.image(key, images[key]);
    });

    const images2 = this.cfg.images2 || {};
    Object.keys(images2).forEach((key) => {
      this.load.image(key, images2[key]);
    });

    const ui = this.cfg.ui || {};
    Object.keys(ui).forEach((key) => {
      this.load.image(key, ui[key]);
    });

    const spritesheets = this.cfg.spritesheets || {};
    Object.keys(spritesheets).forEach((key) => {
      const sheet = spritesheets[key];
      this.load.spritesheet(key, sheet.url, {
        frameWidth: sheet.frameWidth,
        frameHeight: sheet.frameHeight
      });
    });

    const audio = this.cfg.audio || {};
    Object.keys(audio).forEach((key) => {
      this.load.audio(key, audio[key]);
    });
  }

  create() {
    this.cfg = this.registry.get("cfg") || {};
    const gameplay = this.cfg.gameplay || {};
    const textsCfg = this.cfg.texts || {};

    const width = this.scale.width;
    const height = this.scale.height;

    // Use one fontFamily everywhere
    const fontFamily = (this.cfg.font && this.cfg.font.family) || "Arial";
    this.uiFontFamily = fontFamily;

    // Texts from JSON (with fallbacks)
    const scoreLabel = textsCfg.score_label || "Position: ";
    this.playerTurnLabel = textsCfg.turn_player || "Your Turn";
    this.aiTurnLabel = textsCfg.turn_ai || "AI Turn";
    this.aiDicePrefix = textsCfg.ai_dice_prefix || "AI:";

    // --- Background ---
    if (this.cfg.images2 && this.cfg.images2.background) {
      const bg = this.add.image(width / 2, height / 2, "background");
      bg.setDisplaySize(width, height);
    }

    // --- Gameplay config defaults ---
    const tileSize = gameplay.tileSize || 96;
    const boardOffsetX = gameplay.boardOffsetX || 60;
    const boardOffsetY = gameplay.boardOffsetY || 480;
    const playerSize = gameplay.playerSize || 80;
    const stepDuration = gameplay.stepDuration || 220;

    // grid cell vs visual tile size (creates the gap)
    const gridSize = tileSize;              // logical cell size / spacing
    const tileVisualSize = gridSize * 0.9;  // actual sprite size (a bit smaller)

    // No timer / move limit logic now; just race to 100
    this.remainingTime = gameplay.timerSeconds || 120; // unused
    this.movesUsed = 0;
    this.gameWon = false;
    this.gameOver = false;
    this.currentTurn = "player";

    // Build snakes/ladder maps
    this.snakesMap = {};
    (gameplay.snakes || []).forEach((s) => {
      this.snakesMap[s.from] = s.to;
    });

    this.laddersMap = {};
    (gameplay.ladders || []).forEach((l) => {
      this.laddersMap[l.from] = l.to;
    });

    // --- Physics ---
    this.physics.world.setBounds(0, 0, width, height);

    // --- Board tiles as a static group ---
    const tileGroup = this.physics.add.staticGroup();
    this.boardTiles = [];

    for (let tileIndex = 1; tileIndex <= 100; tileIndex++) {
      const pos = this.tileToWorldPosition(tileIndex, {
        tileSize: gridSize,       // still use full grid size for positions
        boardOffsetX,
        boardOffsetY
      });

      this.tilePositions[tileIndex] = pos;

      const tile = tileGroup.create(pos.x, pos.y, "platform");

      // smaller visual size → gap between tiles
      tile.setDisplaySize(tileVisualSize, tileVisualSize);
      tile.refreshBody();

      // Collider matches visual size
      tile.body.setSize(tileVisualSize, tileVisualSize);
      this.boardTiles.push(tile);

      // TILE NUMBER LABEL (bold + stroke)
      const label = this.add.text(pos.x, pos.y, String(tileIndex), {
        fontFamily: fontFamily,
        fontSize: "42px",
        color: "#ffffff",
        fontStyle: "bold",
        stroke: "#000000",
        strokeThickness: 4
      });
      label.setOrigin(0.5);
      label.setDepth(10); // above tiles
    }

    // --- Player & AI tokens ---
    const startPos = this.tilePositions[1];
    this.currentTile = 1;
    this.aiTile = 1;

    // Player uses "player" texture
    this.player = this.physics.add.sprite(startPos.x, startPos.y, "player").setDepth(101);
    this.player.setDisplaySize(playerSize, playerSize);
    this.player.body.setCollideWorldBounds(true);
    this.player.body.setSize(playerSize, playerSize);

    // ✅ AI uses "enemy" texture now
    this.ai = this.physics.add.sprite(startPos.x + 12, startPos.y - 12, "enemy");
    this.ai.setDisplaySize(playerSize, playerSize);
    this.ai.body.setCollideWorldBounds(true);
    this.ai.body.setSize(playerSize, playerSize);

    this.isMoving = false;

    // --- Simple decoration for snakes & ladders using graphics ---
    this.drawSnakesAndLadders(gridSize, boardOffsetX, boardOffsetY);

    // --- Position UI centered with background ---
    const posY = 40;

    // Background behind the position text (scoreback.png)
    if (this.textures.exists("scoreback")) {
      this.scoreBg = this.add.image(width / 2, posY + 40, "scoreback");
      this.scoreBg.setOrigin(0.5, 0.5);
      this.scoreBg.setDepth(8);
    }

    // Position text centered horizontally, same Y as before
    this.positionText = this.add.text(width / 2, posY + 10, scoreLabel + this.currentTile, {
      fontFamily: fontFamily,
      fontSize: "48px",
      color: "#020101ff",
    })
      .setOrigin(0.5, 0)  // center X, keep top at posY
      .setDepth(10);

    // Turn indicator (bold, outlined so it's visible)
    this.turnText = this.add.text(
      width / 2,
      150,
      this.playerTurnLabel,
      {
        fontFamily: fontFamily,
        fontSize: "42px",
        color: "#ffff66",
        fontStyle: "bold",
        stroke: "#000000",
        strokeThickness: 5
      }
    ).setOrigin(0.5, 0).setDepth(15);

    // --- Dice UI ---
    const diceY = height - 260;
    this.diceSprite = this.add.sprite(width / 2, diceY + 20, "dice");
    this.diceSprite.setDisplaySize(200, 200);

    // Bold, outlined dice number
    this.diceValueText = this.add.text(this.diceSprite.x, this.diceSprite.y, "-", {
      fontFamily: fontFamily,
      fontSize: "64px",
      color: "#ffffff",
      fontStyle: "bold",
      stroke: "#000000",
      strokeThickness: 6,
      shadow: {
        offsetX: 2,
        offsetY: 2,
        color: "#000000",
        blur: 4,
        fill: true
      }
    }).setOrigin(0.5).setDepth(20);

    this.diceSprite.setInteractive({ useHandCursor: true });
    this.diceSprite.on("pointerdown", () => {
      this.handleRollInput();
    });

    // Keyboard input
    this.input.keyboard.on("keydown-SPACE", () => {
      this.handleRollInput();
    });
    this.input.keyboard.on("keydown-ENTER", () => {
      this.handleRollInput();
    });

    // --- Audio setup ---
    this.setupAudio();

    // ensure we can access stepDuration later
    this.stepDuration = stepDuration;
  }

  update(time, delta) {
    if (this.gameOver || this.gameWon) {
      return;
    }
    // No timer logic now – player can roll until win/lose.
  }

  // --- Utility: convert tile index (1-100) to world position (zig-zag board) ---
  tileToWorldPosition(tileIndex, opts) {
    const tileSize = opts.tileSize;
    const boardOffsetX = opts.boardOffsetX;
    const boardOffsetY = opts.boardOffsetY;

    const index = tileIndex - 1;
    const rowFromBottom = Math.floor(index / 10);
    const colRaw = index % 10;

    const rowFromTop = 9 - rowFromBottom;
    const isEvenRowFromBottom = (rowFromBottom % 2 === 0);

    let col;
    if (isEvenRowFromBottom) {
      col = colRaw;
    } else {
      col = 9 - colRaw;
    }

    // extra gap between rows
    const rowGap = 20;

    // SHIFT BOARD UPWARD
    const boardShiftY = 120;

    const x = boardOffsetX + col * tileSize + tileSize / 2;
    const y =
      boardOffsetY +
      rowFromTop * tileSize +
      tileSize / 2 +
      rowFromTop * rowGap -
      boardShiftY;

    return { x, y };
  }

  drawSnakesAndLadders(tileSize, boardOffsetX, boardOffsetY) {
    const gameplay = this.cfg.gameplay || {};

    // ============
    //  SNAKES (IMAGE)
    // ============
    (gameplay.snakes || []).forEach((s) => {
      const fromPos = this.tilePositions[s.from];
      const toPos = this.tilePositions[s.to];
      if (!fromPos || !toPos) return;

      const dx = toPos.x - fromPos.x;
      const dy = toPos.y - fromPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy); // snake length

      // Place snake sprite in the middle
      const snake = this.add.image(
        (fromPos.x + toPos.x) / 2,
        (fromPos.y + toPos.y) / 2,
        "snake"
      );

      snake.setDepth(4); // Below players, above board

      // Stretch snake to full distance
      snake.setDisplaySize(70, dist);
      // (70 width → adjust if your snake is too thick/thin)

      // Rotate snake to match direction
      const angleDeg = Phaser.Math.RadToDeg(Math.atan2(dy, dx));
      snake.setAngle(angleDeg + 90);
    });

    // ============
    //  LADDERS (IMAGE)
    // ============
    (gameplay.ladders || []).forEach((l) => {
      const fromPos = this.tilePositions[l.from];
      const toPos = this.tilePositions[l.to];
      if (!fromPos || !toPos) return;

      const dx = toPos.x - fromPos.x;
      const dy = toPos.y - fromPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      const ladder = this.add.image(
        (fromPos.x + toPos.x) / 2,
        (fromPos.y + toPos.y) / 2,
        "ladder"
      );

      ladder.setDepth(5);

      ladder.setDisplaySize(50, dist);
      // width = 50 px (adjust as you like)

      const angleDeg = Phaser.Math.RadToDeg(Math.atan2(dy, dx));
      ladder.setAngle(angleDeg + 90);
    });
  }


  setupAudio() {
    const audioCfg = this.cfg.audio || {};

    if (audioCfg.bgm) {
      this.bgm = this.sound.add("bgm", {
        loop: true,
        volume: 0.5
      });
      this.bgm.play();
    }

    if (audioCfg.roll) {
      this.sfxRoll = this.sound.add("roll", { volume: 0.8 });
    }
    if (audioCfg.snake) {
      this.sfxSnake = this.sound.add("snake", { volume: 0.8 });
    }
    if (audioCfg.ladder) {
      this.sfxLadder = this.sound.add("ladder", { volume: 0.8 });
    }
    if (audioCfg.win) {
      this.sfxWin = this.sound.add("win", { volume: 0.8 });
    }
    if (audioCfg.lose) {
      this.sfxLose = this.sound.add("lose", { volume: 0.8 });
    }
  }

  // --- PLAYER INPUT (only on player's turn) ---
  handleRollInput() {
    if (this.gameOver || this.gameWon || this.isMoving) return;
    if (this.currentTurn !== "player") return; // not your turn

    // No move limit now – just race to 100
    const value = Phaser.Math.Between(1, 6);

    if (this.sfxRoll) {
      this.sfxRoll.play();
    }

    // Block further rolls while animating + moving
    this.isMoving = true;

    // Fancy dice roll effect, then move player
    this.playDiceRollEffect(value, "", () => {
      this.movePlayerBy(value, () => {
        if (!this.gameOver && !this.gameWon) {
          this.startAiTurn();
        }
      });
    });
  }

  // --- PLAYER MOVEMENT ---
  movePlayerBy(steps, onTurnComplete) {
    const gameplay = this.cfg.gameplay || {};
    const tileSize = gameplay.tileSize || 96;
    const boardOffsetX = gameplay.boardOffsetX || 60;
    const boardOffsetY = gameplay.boardOffsetY || 480;

    let tentativeTarget = this.currentTile + steps;

    if (tentativeTarget > 100) {
      // Can't move beyond 100, stay in place
      tentativeTarget = this.currentTile;
    }

    this.targetTile = tentativeTarget;

    if (this.targetTile === this.currentTile) {
      // ❗ No movement, must unlock input
      this.isMoving = false;

      this.updatePositionUI();
      this.checkWinLoseConditions();
      if (onTurnComplete && !this.gameOver && !this.gameWon) {
        onTurnComplete();
      }
      return;
    }

    const pathTiles = [];
    for (let t = this.currentTile + 1; t <= this.targetTile; t++) {
      pathTiles.push(t);
    }

    if (pathTiles.length === 0) {
      // Safety: also unlock here
      this.isMoving = false;

      this.updatePositionUI();
      this.checkWinLoseConditions();
      if (onTurnComplete && !this.gameOver && !this.gameWon) {
        onTurnComplete();
      }
      return;
    }

    this.isMoving = true;

    let stepIndex = 0;
    const moveStep = () => {
      const tile = pathTiles[stepIndex];
      const pos = this.tileToWorldPosition(tile, {
        tileSize,
        boardOffsetX,
        boardOffsetY
      });
      this.currentTile = tile;
      if (this.player) {
        this.player.setPosition(pos.x, pos.y);
      }
      this.updatePositionUI();

      stepIndex++;
      if (stepIndex >= pathTiles.length) {
        // Finished basic movement; apply snakes/ladders
        this.time.delayedCall(200, () => {
          this.applySnakeOrLadderPlayer(onTurnComplete);
        });
      } else {
        this.time.delayedCall(this.stepDuration, moveStep);
      }
    };

    this.time.delayedCall(this.stepDuration, moveStep);
  }


  applySnakeOrLadderPlayer(onTurnComplete) {
    const gameplay = this.cfg.gameplay || {};
    const tileSize = gameplay.tileSize || 96;
    const boardOffsetX = gameplay.boardOffsetX || 60;
    const boardOffsetY = gameplay.boardOffsetY || 480;

    let finalTile = this.currentTile;
    let hitType = null; // "ladder" or "snake"

    if (this.laddersMap[finalTile]) {
      finalTile = this.laddersMap[finalTile];
      hitType = "ladder";
      if (this.sfxLadder) this.sfxLadder.play();
    } else if (this.snakesMap[finalTile]) {
      finalTile = this.snakesMap[finalTile];
      hitType = "snake";
      if (this.sfxSnake) this.sfxSnake.play();
    }

    if (finalTile !== this.currentTile) {
      const pos = this.tileToWorldPosition(finalTile, {
        tileSize,
        boardOffsetX,
        boardOffsetY
      });
      this.currentTile = finalTile;

      if (this.player) {
        this.tweens.add({
          targets: this.player,
          x: pos.x,
          y: pos.y,
          duration: 350,
          ease: "Sine.easeInOut",
          onComplete: () => {
            this.isMoving = false;
            this.updatePositionUI();
            this.checkWinLoseConditions();

            // ladder / snake visual effect
            if (hitType) {
              this.playSnakeOrLadderHitEffect(this.player, hitType);
            }

            if (onTurnComplete && !this.gameOver && !this.gameWon) {
              onTurnComplete();
            }
          }
        });
      } else {
        this.isMoving = false;
        this.updatePositionUI();
        this.checkWinLoseConditions();
        if (hitType) {
          this.playSnakeOrLadderHitEffect(this.player, hitType);
        }
        if (onTurnComplete && !this.gameOver && !this.gameWon) {
          onTurnComplete();
        }
      }
    } else {
      this.isMoving = false;
      this.updatePositionUI();
      this.checkWinLoseConditions();
      if (onTurnComplete && !this.gameOver && !this.gameWon) {
        onTurnComplete();
      }
    }
  }

  // --- AI TURN / MOVEMENT ---
  startAiTurn() {
    if (this.gameOver || this.gameWon) return;

    this.currentTurn = "ai";
    if (this.turnText) {
      this.turnText.setText(this.aiTurnLabel);
      this.turnText.setColor("#ff8888");
    }

    const steps = Phaser.Math.Between(1, 6);

    // Block input while AI animates & moves
    this.isMoving = true;

    // Same dice animation, but with JSON-configurable prefix
    this.playDiceRollEffect(steps, this.aiDicePrefix, () => {
      this.moveAiBy(steps, () => {
        if (!this.gameOver && !this.gameWon) {
          this.currentTurn = "player";
          if (this.turnText) {
            this.turnText.setText(this.playerTurnLabel);
            this.turnText.setColor("#ffff66");
          }
        }
      });
    });
  }

  moveAiBy(steps, onTurnComplete) {
    const gameplay = this.cfg.gameplay || {};
    const tileSize = gameplay.tileSize || 96;
    const boardOffsetX = gameplay.boardOffsetX || 60;
    const boardOffsetY = gameplay.boardOffsetY || 480;

    let tentativeTarget = this.aiTile + steps;

    if (tentativeTarget > 100) {
      tentativeTarget = this.aiTile;
    }

    if (tentativeTarget === this.aiTile) {
      // ❗ AI didn't move (e.g., at 99 and rolled >1) → unlock
      this.isMoving = false;

      this.checkAiWinLoseConditions();
      if (onTurnComplete && !this.gameOver && !this.gameWon) {
        onTurnComplete();
      }
      return;
    }

    const pathTiles = [];
    for (let t = this.aiTile + 1; t <= tentativeTarget; t++) {
      pathTiles.push(t);
    }

    if (pathTiles.length === 0) {
      // Safety: unlock as well
      this.isMoving = false;

      this.checkAiWinLoseConditions();
      if (onTurnComplete && !this.gameOver && !this.gameWon) {
        onTurnComplete();
      }
      return;
    }

    this.isMoving = true;

    let stepIndex = 0;
    const moveStep = () => {
      const tile = pathTiles[stepIndex];
      const pos = this.tileToWorldPosition(tile, {
        tileSize,
        boardOffsetX,
        boardOffsetY
      });
      this.aiTile = tile;
      if (this.ai) {
        // small offset so tokens don't overlap perfectly
        this.ai.setPosition(pos.x + 12, pos.y - 12);
      }

      stepIndex++;
      if (stepIndex >= pathTiles.length) {
        this.time.delayedCall(200, () => {
          this.applySnakeOrLadderAi(onTurnComplete);
        });
      } else {
        this.time.delayedCall(this.stepDuration, moveStep);
      }
    };

    this.time.delayedCall(this.stepDuration, moveStep);
  }


  applySnakeOrLadderAi(onTurnComplete) {
    const gameplay = this.cfg.gameplay || {};
    const tileSize = gameplay.tileSize || 96;
    const boardOffsetX = gameplay.boardOffsetX || 60;
    const boardOffsetY = gameplay.boardOffsetY || 480;

    let finalTile = this.aiTile;
    let hitType = null;

    if (this.laddersMap[finalTile]) {
      finalTile = this.laddersMap[finalTile];
      hitType = "ladder";
      if (this.sfxLadder) this.sfxLadder.play();
    } else if (this.snakesMap[finalTile]) {
      finalTile = this.snakesMap[finalTile];
      hitType = "snake";
      if (this.sfxSnake) this.sfxSnake.play();
    }

    if (finalTile !== this.aiTile) {
      const pos = this.tileToWorldPosition(finalTile, {
        tileSize,
        boardOffsetX,
        boardOffsetY
      });
      this.aiTile = finalTile;

      if (this.ai) {
        this.tweens.add({
          targets: this.ai,
          x: pos.x + 12,
          y: pos.y - 12,
          duration: 350,
          ease: "Sine.easeInOut",
          onComplete: () => {
            this.isMoving = false;
            this.checkAiWinLoseConditions();

            if (hitType) {
              this.playSnakeOrLadderHitEffect(this.ai, hitType);
            }

            if (onTurnComplete && !this.gameOver && !this.gameWon) {
              onTurnComplete();
            }
          }
        });
      } else {
        this.isMoving = false;
        this.checkAiWinLoseConditions();
        if (hitType) {
          this.playSnakeOrLadderHitEffect(this.ai, hitType);
        }
        if (onTurnComplete && !this.gameOver && !this.gameWon) {
          onTurnComplete();
        }
      }
    } else {
      this.isMoving = false;
      this.checkAiWinLoseConditions();
      if (onTurnComplete && !this.gameOver && !this.gameWon) {
        onTurnComplete();
      }
    }
  }

  // --- UI & WIN/LOSE CHECKS (Player) ---
  updatePositionUI() {
    const textsCfg = this.cfg.texts || {};
    const scoreLabel = textsCfg.score_label || "Position: ";
    if (this.positionText) {
      this.positionText.setText(scoreLabel + this.currentTile);
    }
  }

  checkWinLoseConditions() {
    // Only win condition: reach tile 100
    if (this.currentTile === 100) {
      this.onPlayerWin();
    }
  }

  // --- WIN/LOSE CHECKS (AI) ---
  checkAiWinLoseConditions() {
    if (this.aiTile === 100) {
      this.onAiWin();
    }
  }

  onPlayerWin() {
    if (this.gameWon || this.gameOver) return;
    this.gameWon = true;

    if (this.sfxWin) {
      this.sfxWin.play();
    }

    if (this.bgm) {
      this.bgm.stop();
    }

    // 🔥 Go to WinScene
    this.scene.start("WinScene");
  }


  onAiWin() {
    if (this.gameOver || this.gameWon) return;
    this.gameOver = true;

    if (this.sfxLose) {
      this.sfxLose.play();
    }

    if (this.bgm) {
      this.bgm.stop();
    }

    // 🔥 Go to GameOverScene
    this.scene.start("GameOverScene");
  }


  // --- DICE ROLL VISUAL EFFECT ---
  playDiceRollEffect(finalValue, prefix, onComplete) {
    // Safety: if dice not created, just show final value and continue
    if (!this.diceSprite || !this.diceValueText) {
      if (this.diceValueText) {
        this.diceValueText.setText((prefix || "") + finalValue);
      }
      if (onComplete) onComplete();
      return;
    }

    const labelPrefix = prefix || "";
    const rollDuration = 600;   // total ms for the pretend rolling
    const interval = 60;        // how fast numbers change
    const totalSteps = Math.floor(rollDuration / interval);
    let step = 0;

    // Rapidly change dice number to look like rolling
    this.time.addEvent({
      delay: interval,
      repeat: totalSteps,
      callback: () => {
        step++;
        const tempVal = Phaser.Math.Between(1, 6);
        if (this.diceValueText) {
          const v = (step >= totalSteps) ? finalValue : tempVal;
          this.diceValueText.setText(labelPrefix + v);
        }
      }
    });

    // Wobble / shake animation on the dice sprite + text
    this.tweens.add({
      targets: [this.diceSprite, this.diceValueText],
      angle: { from: -18, to: 18 },
      scale: { from: 1.0, to: 1.15 },
      duration: 120,
      yoyo: true,
      repeat: 4,
      onComplete: () => {
        // Reset to normal & then continue turn
        this.tweens.add({
          targets: [this.diceSprite, this.diceValueText],
          angle: 0,
          scale: 1,
          duration: 100,
          onComplete: () => {
            if (onComplete) {
              onComplete();
            }
          }
        });
      }
    });
  }

  // --- SNAKE / LADDER HIT VISUAL EFFECT ---
  playSnakeOrLadderHitEffect(sprite, type) {
    if (!sprite) return;

    const textsCfg = this.cfg.texts || {};
    const ladderText = textsCfg.ladder_text || "LADDER!";
    const snakeText = textsCfg.snake_text || "SNAKE!";

    const isLadder = type === "ladder";
    const text = isLadder ? ladderText : snakeText;
    const color = isLadder ? "#66ff66" : "#ff6666";

    // Floating text above the token
    const label = this.add.text(sprite.x, sprite.y - 40, text, {
      fontFamily: this.uiFontFamily,
      fontSize: "26px",
      color: color,
      fontStyle: "bold",
      stroke: "#000000",
      strokeThickness: 5
    }).setOrigin(0.5).setDepth(30);

    this.tweens.add({
      targets: label,
      y: label.y - 40,
      alpha: 0,
      duration: 600,
      ease: "Cubic.easeOut",
      onComplete: () => {
        label.destroy();
      }
    });

    if (isLadder) {
      // Bounce relative to current scale, then restore exactly
      const originalScaleX = sprite.scaleX;
      const originalScaleY = sprite.scaleY;

      this.tweens.add({
        targets: sprite,
        scaleX: originalScaleX * 1.2,
        scaleY: originalScaleY * 1.2,
        duration: 160,
        yoyo: true,
        repeat: 1,
        onComplete: () => {
          sprite.setScale(originalScaleX, originalScaleY);
        }
      });
    } else {
      // Snake bite: quick red flash + shake
      const originalTint = sprite.tintTopLeft;
      this.tweens.add({
        targets: sprite,
        x: { from: sprite.x - 6, to: sprite.x + 6 },
        duration: 60,
        yoyo: true,
        repeat: 4,
        onStart: () => {
          sprite.setTint(0xff2222);
        },
        onComplete: () => {
          sprite.setTint(originalTint);
        }
      });
    }
  }

  onGameOver() {
    if (this.gameOver || this.gameWon) return;
    this.gameOver = true;

    if (this.sfxLose) {
      this.sfxLose.play();
    }

    if (this.bgm) {
      this.bgm.stop();
    }

    // 🔥 Fallback: send to GameOverScene
    this.scene.start("GameOverScene");
  }


  // Optional clean-up if scene is shut down
  shutdown() {
    if (this.bgm) {
      this.bgm.stop();
      this.bgm.destroy();
      this.bgm = null;
    }
  }

  destroy() {
    this.shutdown();
    Phaser.Scene.prototype.destroy.call(this);
  }
}
