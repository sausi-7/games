const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));
const CONFIG_PATH = `${basePath}/config.json`;

export const SCREEN_WIDTH = 1080;
export const SCREEN_HEIGHT = 1920;

export default class Lvl1Scene extends Phaser.Scene {
  constructor() {
    super('Lvl1Scene');
    this.gameConfig = null;
    this.score = 0; // Initialize score in constructor
  }

  preload() {
    // Load the JSON via Phaser
    this.load.json('gameConfig', CONFIG_PATH);

    // Once the JSON is loaded, queue all assets
    this.load.once('filecomplete-json-gameConfig', () => {
      const cfg = this.cache.json.get('gameConfig');
      if (!cfg) {
        console.error('Failed to parse config.json');
        return;
      }
      this.gameConfig = cfg;

      if (cfg.spritesheets) {
        for (const [key, sheet] of Object.entries(cfg.spritesheets)) {
          this.load.spritesheet(key, sheet.path, {
            frameWidth: sheet.frameWidth,
            frameHeight: sheet.frameHeight,
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
      // Queue additional JSON for levels if under 'levels'
      if (cfg.levels) {
        Object.keys(cfg.levels).forEach(levelKey => {
          // levels are in-memory, no need to load
        });
      }

      // Start loading all queued assets
      this.load.start();
    });
  }

  create() {
    const cfg = this.gameConfig;
    if (!cfg) {
      console.error('Config not loaded before create()');
      return;
    }

    // Reset game state
    this.score = 0; // Ensure score is reset
    this.candies = []; // Reset candies array
    this.scoreText = null; // Reset score text
    this.scoreTarget = cfg.levels.level1.scoreTarget; // Initialize scoreTarget from level1 config

    // Add game background immediately
    this.add.image(0, 0, 'bg1').setOrigin(0, 0);

    // Run How to Play screen first
    showHowToPlay(this);
  }

  resize(newWidth, newHeight) {
    this.cameras.resize(newWidth, newHeight);

    let newCellWidth = newWidth / 5;
    let newCellHeight = newHeight / 8;
    let newBaseWidth = newCellWidth * 0.8;
    let newBaseHeight = newCellHeight * 0.8;

    for (let row = 0; row < this.candies.length; row++) {
      for (let col = 0; col < this.candies[row].length; col++) {
        let candy = this.candies[row][col];
        if (candy) {
          let newX = col * newCellWidth + newCellWidth / 2 + boardXOffset;
          let newY = row * newCellHeight + newCellHeight / 2 + boardYOffset;
          candy.setPosition(newX, newY);
          candy.setDisplaySize(newBaseWidth, newBaseHeight);
        }
      }
    }
  }

  update() {
    if (this.score >= this.scoreTarget) {
      this.sound.play('divine');
      this.time.delayedCall(100, () => {
        this.sound.get('bgmusic').stop();
        win(this); // Call win without stopping the scene
      });
    }
  }
}

function showHowToPlay(scene) {
  const rec = scene.add.rectangle(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, 0x000000, 0.7).setOrigin(0, 0).setDepth(9);
  // Add How to Play elements
  const htpBox = scene.add.image(540, 770, 'htpbox').setScale(1).setDepth(10);
  const playBtn = scene.add.image(540, 1370, 'playbtn').setScale(1).setDepth(10).setInteractive();
  const htpTitle = scene.add.text(450, 420, 'How to Play', { font: 'bold 70px outfit', fill: 'white' }).setDepth(11).setOrigin(0.5);
  const htpText = scene.add.text(520, 780,
    'On a grid covered with\nvarious objects, try to form\nhorizontal or vertical chains\nof at least three identical\nones by swapping\nneighbouring objects.',
    { font: '60px outfit', fill: 'white', lineSpacing: 8 }
  ).setDepth(11).setOrigin(0.5);

  const targettxt = scene.add.text(250, 1120, 'Target', { font: '60px outfit', fill: 'white' }).setDepth(11).setOrigin(0.5);
  const targettxt1 = scene.add.text(880, 1120, `${scene.scoreTarget}`, { font: '60px outfit', fill: 'white' }).setDepth(11).setOrigin(0.5);

  // Handle play button click
  playBtn.on('pointerdown', () => {
    // Destroy How to Play elements
    rec.destroy();
    htpBox.destroy();
    playBtn.destroy();
    htpTitle.destroy();
    htpText.destroy();
    targettxt.destroy();
    targettxt1.destroy();

    // Start the game
    startGame(scene);
  });
}

function gameovr(scene) {
  // Destroy all candies using the candies array
  for (let row = 0; row < scene.gameConfig.levels.level1.rows; row++) {
    for (let col = 0; col < scene.gameConfig.levels.level1.columns; col++) {
      if (scene.candies[row] && scene.candies[row][col]) {
        scene.candies[row][col].destroy();
        scene.candies[row][col] = null;
      }
    }
  }

  // Destroy all tile backgrounds and other game objects
  scene.children.list.slice().forEach(child => {
    // Check for tilebg and other objects
    if (child.texture && (child.texture.key === 'tilebg' || ['object1', 'object2', 'object3', 'object4', 'object5'].includes(child.texture.key))) {
      child.destroy();
    }
  });

  // If tilebg objects are in a group or container, destroy the group
  if (scene.tilebgGroup) {
    scene.tilebgGroup.clear(true, true); // Remove all children and destroy them
  }

  // If tilebg is part of a tilemap, clear the tilemap layer
  if (scene.tilebgLayer) {
    scene.tilebgLayer.destroy();
  }

  const rec = scene.add.rectangle(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, 0x000000, 0.7).setOrigin(0, 0).setDepth(9);



  // Add Game Over elements
  const ovrbox = scene.add.image(540, 750, 'gameovrbg').setScale(1).setDepth(10);
  const restart1btn = scene.add.image(540, 1160, 'restart1btn').setScale(1).setDepth(10).setInteractive();
  const ovrTitle = scene.add.text(450, 590, 'Game Over', { font: 'bold 70px outfit', fill: 'white' }).setDepth(11).setOrigin(0.5);

  const targettxt = scene.add.text(250, 770, 'Target', { font: '60px outfit', fill: 'white' }).setDepth(11).setOrigin(0.5);
  const targettxt1 = scene.add.text(850, 770, `${scene.scoreTarget}`, { font: '60px outfit', fill: 'white' }).setDepth(11).setOrigin(0.5);

  const scoretxt = scene.add.text(250, 930, 'Score', { font: '60px outfit', fill: 'white' }).setDepth(11).setOrigin(0.5);
  const scoretxt1 = scene.add.text(850, 930, `${scene.score}`, { font: '60px outfit', fill: 'white', align: 'center' }).setDepth(11).setOrigin(0.5);

  // Handle restart button click
  restart1btn.on('pointerdown', () => {
    // Destroy Game Over elements
    rec.destroy();
    ovrbox.destroy();
    restart1btn.destroy();
    ovrTitle.destroy();
    targettxt.destroy();
    targettxt1.destroy();
    scoretxt.destroy();
    scoretxt1.destroy();

    // Restart the scene
    scene.scene.restart();
  });
}

function win(scene) {
  // Destroy tile background and candies
  scene.children.list.forEach(child => {
    if (child.texture && (child.texture.key === 'tilebg' || ['object1', 'object2', 'object3', 'object4', 'object5'].includes(child.texture.key))) {
      child.destroy();
    }
  });
  const rec = scene.add.rectangle(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, 0x000000, 0.7).setOrigin(0, 0).setDepth(9);

  // Add Level Completed elements
  const lvlbox = scene.add.image(540, 750, 'lvlbox').setScale(1).setDepth(10);
  const restartbtn = scene.add.image(310, 950, 'restartbtn').setScale(1).setDepth(10).setInteractive();
  const nextbtn = scene.add.image(770, 950, 'nextbtn').setScale(1).setDepth(10).setInteractive();
  const ovrTitle = scene.add.text(520, 760, 'Level Completed', { font: 'bold 70px outfit', fill: 'white' }).setDepth(13).setOrigin(0.5);

  // Handle restart button click
  restartbtn.on('pointerdown', () => {
    // Destroy Level Completed elements
    rec.destroy();
    lvlbox.destroy();
    restartbtn.destroy();
    nextbtn.destroy();
    ovrTitle.destroy();

    // Restart the scene
    scene.scene.restart();
  });

  // Handle next button click
  nextbtn.on('pointerdown', () => {
    // Destroy Level Completed elements
    rec.destroy();
    lvlbox.destroy();
    restartbtn.destroy();
    nextbtn.destroy();
    ovrTitle.destroy();

    // Emit event to move to next scene
    notifyParent('sceneComplete', { result: 'win' });
  });
}

function notifyParent(type, data) {
  if (window.parent !== window) {
    window.parent.postMessage({ type, ...data }, "*");
  }
}

function startGame(scene) {
  const cfg = scene.gameConfig;

  // Unpack mechanics
  const { PLAYER_SPEED, ATTACK_RANGE, ATTACK_COOLDOWN, PUNCH_DURATION } = cfg.mechanics;
  Object.assign(scene, { PLAYER_SPEED, ATTACK_RANGE, ATTACK_COOLDOWN, PUNCH_DURATION });

  // Use level1 settings
  const level1 = cfg.levels.level1;
  let { timeLimit, scoreTarget, rows, columns } = level1;

  // Start background music
  const bgMusic = scene.sound.add('bgmusic', { loop: true });
  bgMusic.play();

  // Score & timer
  scene.score = 0; // Ensure score is reset
  const scrtxt = scene.add.text(100, 65, 'Score: ', { font: 'bold 50px outfit', fill: 'black' }).setDepth(3);
  scene.scoreText = scene.add.text(250, 70, `${scene.score}`, { font: '50px outfit', fill: 'black', align: 'center' }).setDepth(3);
  const scorebg = scene.add.image(200, 100, 'scorebg').setDepth(2).setScale(0.9, 1);
  let timeRemaining = timeLimit; // timeLimit in seconds

  const timebg = scene.add.image(860, 100, 'timebg').setDepth(2).setScale(1.1, 1);
  // Initialize timer display in MM:SS format
  const formatTime = (seconds) => {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };
  const timtxt = scene.add.text(720, 65, 'Time: ', { font: 'bold 50px outfit', fill: 'black' }).setDepth(3);
  const timerText = scene.add.text(860, 70, `${formatTime(timeRemaining)}`, { font: '50px outfit', fill: 'black' }).setDepth(3);

  // Create a timer event
  const timerEvent = scene.time.addEvent({
    delay: 1000,
    loop: true,
    callback: () => {
      if (timeRemaining > 0) {
        timeRemaining--;
        timerText.setText(`${formatTime(timeRemaining)}`);
      } else {
        // Stop the timer event when time reaches 0
        timerEvent.remove();
        if (scene.score < scoreTarget) {
          scene.time.delayedCall(100, () => {
            bgMusic.stop();
            gameovr(scene);
          });
        }
      }
    }
  });

  // Level text and header
  scene.add.text(440, 67, 'Level: ', { font: 'bold 50px outfit', fill: 'black' }).setDepth(3);
  scene.add.text(580, 67, '1', { font: '50px outfit', fill: 'black' }).setDepth(3);
  scene.add.image(520, 100, 'lvltxtbg').setDepth(2);

  const isMobile = scene.sys.game.config.width < 768;
  const tileScale = isMobile ? 2.5 : 2;
  const objScale = isMobile ? 2.5 : 2;
  const swipeThreshold = isMobile ? 30 : 20;

  const boardWidth = 800;
  const boardHeight = 1300;
  const cellWidth = boardWidth / columns;
  const cellHeight = boardHeight / rows;
  const boardYOffset = 300;
  const boardXOffset = 130;
  scene.candies = [];
  const candyScale = 1;
  const objects = ['object1', 'object2', 'object3', 'object4', 'object5'];

  // Draw tile background for every grid cell
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      let tileX = col * cellWidth + cellWidth / 2 + boardXOffset;
      let tileY = row * cellHeight + cellHeight / 2 + boardYOffset;
      scene.add.image(tileX, tileY, 'tilebg').setOrigin(0.5).setDepth(1).setScale(tileScale);
    }
  }

  // Splash screens
  let splash = scene.add.image(SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2, 'lvl1').setDepth(10);
  scene.children.bringToTop(splash);
  scene.time.delayedCall(1000, () => { splash.destroy(); });

  let splash1 = scene.add.image(SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2, 'lvl1iconbg').setDepth(9);
  scene.children.bringToTop(splash1);
  scene.time.delayedCall(1000, () => { splash1.destroy(); });

  let splash3 = scene.add.image(0, 0, 'lvlbg').setDepth(8).setOrigin(0, 0);
  scene.children.bringToTop(splash3);
  scene.time.delayedCall(1000, () => { splash3.destroy(); });

  // Generate an array of all grid positions
  let positions = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      positions.push({ row, col });
    }
  }
  Phaser.Utils.Array.Shuffle(positions);

  // Create candies and attach drag (swipe) events
  positions.forEach((pos, index) => {
    let candyX = pos.col * cellWidth + cellWidth / 2 + boardXOffset;
    let candyY = pos.row * cellHeight + cellHeight / 2 + boardYOffset;
    let objKey = objects[index % objects.length];

    let baseWidth = cellWidth * 0.8;
    let baseHeight = cellHeight * 0.8;

    let candy = scene.add.image(candyX, candyY, objKey)
      .setOrigin(0.5)
      .setInteractive({ draggable: true })
      .setDepth(2);

    candy.setDisplaySize(baseWidth, baseHeight);

    candy.row = pos.row;
    candy.col = pos.col;
    if (!scene.candies[pos.row]) {
      scene.candies[pos.row] = [];
    }
    scene.candies[pos.row][pos.col] = candy;

    // Ensure any pre-existing matches are cleared before user interaction
    scene.time.delayedCall(500, () => {
      let initialMatches = checkMatches();
      if (initialMatches.length > 0) {
        removeMatches(initialMatches, true);

        const repeatMatchCheck = () => {
          let newMatches = checkMatches();
          if (newMatches.length > 0) {
            removeMatches(newMatches, true);
            scene.time.delayedCall(350, repeatMatchCheck);
          }
        };
        scene.time.delayedCall(350, repeatMatchCheck);
      }
    });

    candy.on('dragstart', (pointer) => {
      candy.swipeStartX = pointer.x;
      candy.swipeStartY = pointer.y;
    });

    candy.on('dragend', (pointer) => {
      let deltaX = pointer.x - candy.swipeStartX;
      let deltaY = pointer.y - candy.swipeStartY;
      let absDeltaX = Math.abs(deltaX);
      let absDeltaY = Math.abs(deltaY);
      const swipeThreshold = 20;
      if (absDeltaX < swipeThreshold && absDeltaY < swipeThreshold) {
        candy.x = candy.col * cellWidth + cellWidth / 2 + boardXOffset;
        candy.y = candy.row * cellHeight + cellHeight / 2 + boardYOffset;
        return;
      }
      let direction;
      if (absDeltaX > absDeltaY) {
        direction = deltaX > 0 ? 'right' : 'left';
      } else {
        direction = deltaY > 0 ? 'down' : 'up';
      }
      let targetRow = candy.row;
      let targetCol = candy.col;
      if (direction === 'left') {
        targetCol--;
      } else if (direction === 'right') {
        targetCol++;
      } else if (direction === 'up') {
        targetRow--;
      } else if (direction === 'down') {
        targetRow++;
      }
      if (targetRow < 0 || targetRow >= rows || targetCol < 0 || targetCol >= columns) {
        candy.x = candy.col * cellWidth + cellWidth / 2 + boardXOffset;
        candy.y = candy.row * cellHeight + cellHeight / 2 + boardYOffset;
        return;
      }
      let adjacentCandy = scene.candies[targetRow][targetCol];
      if (adjacentCandy) {
        swapCandies(candy, adjacentCandy);
      } else {
        candy.x = candy.col * cellWidth + cellWidth / 2 + boardXOffset;
        candy.y = candy.row * cellHeight + cellHeight / 2 + boardYOffset;
      }
    });
  });

  // --- MATCH-3 LOGIC FUNCTIONS ---

  const checkMatches = () => {
    let matches = [];
    // Horizontal matches
    for (let row = 0; row < rows; row++) {
      let matchLength = 1;
      for (let col = 0; col < columns; col++) {
        let current = scene.candies[row][col];
        let next = (col < columns - 1) ? scene.candies[row][col + 1] : null;
        if (current && next && current.texture.key === next.texture.key) {
          matchLength++;
        } else {
          if (matchLength >= 3) {
            for (let i = col - matchLength + 1; i <= col; i++) {
              matches.push({ row: row, col: i });
            }
          }
          matchLength = 1;
        }
      }
    }
    // Vertical matches
    for (let col = 0; col < columns; col++) {
      let matchLength = 1;
      for (let row = 0; row < rows; row++) {
        let current = scene.candies[row][col];
        let next = (row < rows - 1) ? scene.candies[row + 1][col] : null;
        if (current && next && current.texture.key === next.texture.key) {
          matchLength++;
        } else {
          if (matchLength >= 3) {
            for (let i = row - matchLength + 1; i <= row; i++) {
              matches.push({ row: i, col: col });
            }
          }
          matchLength = 1;
        }
      }
    }
    // Remove duplicates
    let matchSet = new Set();
    matches.forEach(pos => {
      matchSet.add(`${pos.row}-${pos.col}`);
    });
    return Array.from(matchSet).map(str => {
      let parts = str.split('-');
      return { row: parseInt(parts[0]), col: parseInt(parts[1]) };
    });
  };

  const removeMatches = (matchPositions, isStartup = false) => {
    if (!isStartup) {
      scene.score += Math.floor(matchPositions.length / 3) * 10;
      scene.scoreText.setText('' + scene.score);
    }

    matchPositions.forEach(pos => {
      if (scene.candies[pos.row][pos.col]) {
        scene.candies[pos.row][pos.col].destroy();
        scene.candies[pos.row][pos.col] = null;
        scene.sound.add('destroy').play();
      }
    });

    dropCandies();
  };

  const dropCandies = () => {
    // Make candies fall
    for (let col = 0; col < columns; col++) {
      for (let row = rows - 1; row >= 0; row--) {
        if (scene.candies[row][col] === null) {
          for (let above = row - 1; above >= 0; above--) {
            if (scene.candies[above][col] !== null) {
              let movingCandy = scene.candies[above][col];
              scene.candies[row][col] = movingCandy;
              scene.candies[above][col] = null;
              movingCandy.row = row;
              let newY = row * cellHeight + cellHeight / 2 + boardYOffset;
              scene.tweens.add({
                targets: movingCandy,
                y: newY,
                duration: 300,
                ease: 'Power2'
              });
              break;
            }
          }
        }
      }
    }
    // Fill empty cells with new candies
    for (let col = 0; col < columns; col++) {
      for (let row = 0; row < rows; row++) {
        if (scene.candies[row][col] === null) {
          let candyX = col * cellWidth + cellWidth / 2 + boardXOffset;
          let startY = boardYOffset - cellHeight / 2;
          let objKey = Phaser.Utils.Array.GetRandom(objects);

          let baseWidth = cellWidth * 0.8;
          let baseHeight = cellHeight * 0.8;

          let newCandy = scene.add.image(candyX, startY, objKey)
            .setOrigin(0.5)
            .setInteractive({ draggable: true })
            .setDisplaySize(baseWidth, baseHeight)
            .setDepth(2);
          newCandy.row = row;
          newCandy.col = col;
          scene.candies[row][col] = newCandy;
          let targetY = row * cellHeight + cellHeight / 2 + boardYOffset;
          scene.tweens.add({
            targets: newCandy,
            y: targetY,
            duration: 300,
            ease: 'Power2'
          });
          newCandy.on('dragstart', (pointer) => {
            newCandy.swipeStartX = pointer.x;
            newCandy.swipeStartY = pointer.y;
          });
          newCandy.on('dragend', (pointer) => {
            let deltaX = pointer.x - newCandy.swipeStartX;
            let deltaY = pointer.y - newCandy.swipeStartY;
            let absDeltaX = Math.abs(deltaX);
            let absDeltaY = Math.abs(deltaY);
            const swipeThreshold = 20;
            if (absDeltaX < swipeThreshold && absDeltaY < swipeThreshold) {
              newCandy.x = newCandy.col * cellWidth + cellWidth / 2 + boardXOffset;
              newCandy.y = newCandy.row * cellHeight + cellHeight / 2 + boardYOffset;
              return;
            }
            let direction;
            if (absDeltaX > absDeltaY) {
              direction = deltaX > 0 ? 'right' : 'left';
            } else {
              direction = deltaY > 0 ? 'down' : 'up';
            }
            let targetRow = newCandy.row;
            let targetCol = newCandy.col;
            if (direction === 'left') {
              targetCol--;
            } else if (direction === 'right') {
              targetCol++;
            } else if (direction === 'up') {
              targetRow--;
            } else if (direction === 'down') {
              targetRow++;
            }
            if (targetRow < 0 || targetRow >= rows || targetCol < 0 || targetCol >= columns) {
              newCandy.x = newCandy.col * cellWidth + cellWidth / 2 + boardXOffset;
              newCandy.y = newCandy.row * cellHeight + cellHeight / 2 + boardYOffset;
              return;
            }
            let adjacentCandy = scene.candies[targetRow][targetCol];
            if (adjacentCandy) {
              swapCandies(newCandy, adjacentCandy);
            } else {
              newCandy.x = newCandy.col * cellWidth + cellWidth / 2 + boardXOffset;
              newCandy.y = newCandy.row * cellHeight + cellHeight / 2 + boardYOffset;
            }
          });
        }
      }
    }
    // Check for cascaded matches after drop
    scene.time.delayedCall(350, () => {
      let newMatches = checkMatches();
      if (newMatches.length > 0) {
        removeMatches(newMatches);
      }
    });
  };

  let reshuffleUsed = false;

  // Add Reshuffle Button
  let reshuffleBtn = scene.add.image(540, 1765, 're')
    .setScale(1)
    .setOrigin(0.5)
    .setInteractive()
    .setDepth(3);

  reshuffleBtn.on('pointerdown', () => {
    if (!reshuffleUsed) {
      reshuffleGrid();
      reshuffleUsed = true;
      reshuffleBtn.setAlpha(0.5).disableInteractive();
    }
  });

  const reshuffleGrid = () => {
    let allCandies = [];

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        if (scene.candies[row][col]) {
          allCandies.push(scene.candies[row][col]);
        }
      }
    }

    let validShuffle = false;

    while (!validShuffle) {
      Phaser.Utils.Array.Shuffle(allCandies);

      let tempCandies = [];
      let index = 0;
      for (let row = 0; row < rows; row++) {
        tempCandies[row] = [];
        for (let col = 0; col < columns; col++) {
          let candy = allCandies[index++];
          candy.row = row;
          candy.col = col;
          tempCandies[row][col] = candy;
        }
      }

      let newMatches = checkMatches(tempCandies);
      if (newMatches.length === 0) {
        validShuffle = true;
      }
    }

    let index = 0;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        let candy = allCandies[index++];
        scene.candies[row][col] = candy;

        let newX = col * cellWidth + cellWidth / 2 + boardXOffset;
        let newY = row * cellHeight + cellHeight / 2 + boardYOffset;

        scene.tweens.add({
          targets: candy,
          x: newX,
          y: newY,
          duration: 500,
          ease: 'Power2'
        });
      }
    }
  };

  const swapCandies = (candyA, candyB) => {
    let rowA = candyA.row, colA = candyA.col;
    let rowB = candyB.row, colB = candyB.col;

    scene.candies[rowA][colA] = candyB;
    scene.candies[rowB][colB] = candyA;

    candyA.row = rowB;
    candyA.col = colB;
    candyB.row = rowA;
    candyB.col = colA;

    let newAX = candyA.col * cellWidth + cellWidth / 2 + boardXOffset;
    let newAY = candyA.row * cellHeight + cellHeight / 2 + boardYOffset;
    let newBX = candyB.col * cellWidth + cellWidth / 2 + boardXOffset;
    let newBY = candyB.row * cellHeight + cellHeight / 2 + boardYOffset;

    scene.tweens.add({
      targets: candyA,
      x: newAX,
      y: newAY,
      duration: 300,
      ease: 'Power2'
    });

    scene.tweens.add({
      targets: candyB,
      x: newBX,
      y: newBY,
      duration: 300,
      ease: 'Power2',
      onComplete: () => {
        let matches = checkMatches();
        if (matches.length > 0) {
          removeMatches(matches);
        } else {
          scene.candies[rowA][colA] = candyA;
          scene.candies[rowB][colB] = candyB;

          candyA.row = rowA;
          candyA.col = colA;
          candyB.row = rowB;
          candyB.col = colB;

          scene.tweens.add({
            targets: candyA,
            x: colA * cellWidth + cellWidth / 2 + boardXOffset,
            y: rowA * cellHeight + cellHeight / 2 + boardYOffset,
            duration: 300,
            ease: 'Power2'
          });

          scene.tweens.add({
            targets: candyB,
            x: colB * cellWidth + cellWidth / 2 + boardXOffset,
            y: rowB * cellHeight + cellHeight / 2 + boardYOffset,
            duration: 300,
            ease: 'Power2'
          });
        }
      }
    });
  };
}