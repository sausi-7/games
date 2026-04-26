
export default class TrenchDefenceScene extends Phaser.Scene {
  constructor() {
    super('Main');
    Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach(fn => {
      if (typeof this[fn] === 'function') this[fn] = this[fn].bind(this);
    });
  }

  preload() {
    const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));

    // Prevent duplicate listener bugs
    this.load.removeAllListeners('filecomplete-json-levelConfig');

    this.load.json('levelConfig', `${basePath}/config.json`);
    this.load.once('filecomplete-json-levelConfig', () => {
      const cfg = this.cache.json.get('levelConfig');
      this.levelConfig = cfg;

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

      this.load.audio('bgm', `${basePath}/assets/bgm.mp3`);
      this.load.audio('hit', `${basePath}/assets/hit.mp3`);


      this.load.start(); // <-- force start asset loading after reloading config
    });
  }


  create() {
    this.sceneReady = false;
    const levelData = this.cache.json.get('levelConfig');
    this.levelData = levelData; // Keep for endLevel

    if (levelData.orientation?.frame === 'landscape' && screen.orientation && screen.orientation.lock) {
      screen.orientation
        .lock('landscape-primary')
        .catch(err => console.warn('Orientation lock failed:', err));
    }


    // Reuse cached config if already loaded (Phaser doesn't refetch it on restart)
    if (!this.levelConfig) {
      this.levelConfig = this.cache.json.get('levelConfig');
    }

    // Still no config? Try again later
    if (!this.levelConfig) {
      this.time.delayedCall(50, this.create, [], this);
      return;
    }

    this.onCreateReady();
  }



  onCreateReady() {
    const cfg = this.levelConfig;
    this.gameConfig = cfg.game;
    this.texts = cfg.texts;
    this.colors = cfg.colors;
    this.images = cfg.images2;
    this.overlayCfg = cfg.overlays || {};

    this.W = 1920;
    this.H = 1080;
    this.center = { x: this.W / 2, y: this.H / 2 };

    if (this.images.background && this.sys.textures.exists('background')) {
      this.bg = this.add.image(this.W / 2, this.H / 2, 'background')
        .setDisplaySize(this.W, this.H)
        .setDepth(-100);
    }
    this.sys.cameras.main.setBackgroundColor(this.colors.background);

    // Mechanics values from config
    this.towerX = this.W * (this.gameConfig.towerXPercent ?? 0.85);
    this.towerY = this.center.y;

    // Zigzag path values from config
    const zigzag = this.gameConfig.zigzag || {};
    this.pathPoints = this.makeZigZagPath(
      this.W, this.H,
      this.towerX, this.towerY,
      zigzag.margin, zigzag.steps, zigzag.amplitudePercent
    );
    this.createPath(this.pathPoints);

    this.tower = this.createTower(this.towerX, this.towerY);

    this.troops = [];

    this.scorebar = this.add.image(960, 70, 'scorebar')

    this.scoreText = this.add.text(500, 40,
      this.texts.score.replace('{score}', 0),
      { font: '50px outfit', color: '#fff' }
    ).setDepth(30);

    this.timerText = this.add.text(this.W / 2 + 320, 40,
      this.texts.timer.replace('{timer}', this.gameConfig.levelDuration),
      { font: '50px outfit', color: '#fff' }
    ).setOrigin(0.5, 0).setDepth(30);

    // Config-driven variables
    this.spawnDelay = this.gameConfig.spawnDelay ?? 1000;
    this.lastSpawn = 0;
    this.levelDuration = this.gameConfig.levelDuration ?? 60;

    this.hpIncreaseInterval = this.gameConfig.hpIncreaseInterval ?? 10000;
    this.lastHpUp = this.time.now;
    this.troopHp = this.gameConfig.initialTroopHp ?? 1;

    this.gameOver = false;
    this.instructionVisible = false;
    this.gameOverActive = false;

    // Show instructions overlay
    this.showInstructions();
    this.sceneReady = true;

  }

  // --- Overlays (Modern, dynamic containers only) ---

  showInstructions() {
    this.instructionVisible = true;

    this.htpOverlay = this.add.container(0, 0).setDepth(100);
    const blur = this.add.rectangle(0, 0, this.W, this.H, 0x000000, 0.5).setOrigin(0);
    const howToPlayBox = this.add.image(this.W / 2, this.H / 2 - 100, "htp");

    const descriptionText = this.add.text(
      this.W / 2, this.H / 2 - 120,
      this.texts.howToPlay || "Tap to shoot enemies before they reach the other end.",
      {
        font: "50px outfit",
        color: "#ffffff",
        wordWrap: { width: this.W * 0.7, useAdvancedWrap: true },
      }
    ).setOrigin(0.5);

    const targetLabel = this.add.text(
      this.W / 2 - 510, this.H / 2 - 40,
      this.texts.targetLabel || "Target:",
      { font: "50px Outfit", color: "#ffffff" }
    ).setOrigin(0.5);

    const targetScoreText = this.add.text(
      this.W / 2 - 400, this.H / 2 - 40,
      this.texts.targetScore || `${this.gameConfig.scoreToWin || 10}`,
      { font: "50px Outfit", color: "#ffffff" }
    ).setOrigin(0.5);

    const playButton = this.add.image(this.W / 2, this.H / 2 + 350, "play_game").setInteractive();
    playButton.on("pointerdown", () => {
      this.htpOverlay.destroy();
      this.htpOverlay = undefined;
      this.instructionVisible = false;
      this.startGame();
    });

    this.htpOverlay.add([
      blur, howToPlayBox,
      descriptionText, targetLabel, targetScoreText, playButton
    ]);
  }

  gameOverOverlay() {
    this.gameOverActive = true;

    this.gameoverOverlay = this.add.container(0, 0).setDepth(100);
    const blur = this.add.rectangle(0, 0, this.W, this.H, 0x000000, 0.5).setOrigin(0);

    const gameOverBox = this.add.image(this.W / 2, this.H / 2, "game_over");

    const yourScore = this.add.text(
      this.W / 2 - 20, this.H / 2,
      this.texts.timeLeftLabel || "Time Left:",
      { font: "50px Outfit", color: "#FFFFFF" }
    ).setOrigin(0.5);

    const yourUserScore = this.add.text(
      this.W / 2 + 140, this.H / 2,
      `${this.timer}`,
      { font: "50px Outfit", color: "#FFFFFF" }
    ).setOrigin(0.5);

    const restartButton = this.add.image(this.W / 2, this.H / 2 + 350, "replay_level")
      .setInteractive();

    restartButton.on("pointerdown", () => {
      blur.destroy();
      gameOverBox.destroy();
      yourScore.destroy();
      yourUserScore.destroy();
      restartButton.destroy();
      this.gameoverOverlay.destroy();
      this.scene.restart();
    });

    this.gameoverOverlay.add([
      blur, gameOverBox,
      yourScore, yourUserScore,
      restartButton
    ]);
  }

  winOverlay() {
    this.gameOverActive = true;

    this.winOverlayCont = this.add.container(0, 0).setDepth(100);
    const blur = this.add.rectangle(0, 0, this.W, this.H, 0x000000, 0.5).setOrigin(0);

    const winBox = this.add.image(this.W / 2, this.H / 2, "level_complete");

    const yourScore = this.add.text(
      this.W / 2, this.H / 2,
      this.texts.timeTakenLabel || "You Win!",
      { font: "50px Outfit", color: "#FFFFFF" }
    ).setOrigin(0.5);

    const yourUserScore = this.add.text(
      this.W / 2 + 150, this.H / 2 + 60,
      ""
    ).setOrigin(0.5);

    const replayButton = this.add.image(this.W / 2 - 235, this.H / 2 + 350, "replay").setInteractive();
    const nextButton = this.add.image(this.W / 2 + 235, this.H / 2 + 350, "next").setInteractive();

    replayButton.on("pointerdown", () => {
      blur.destroy();
      winBox.destroy();
      yourScore.destroy();
      yourUserScore.destroy();
      nextButton.destroy();
      replayButton.destroy();
      this.winOverlayCont.destroy();
      this.scene.restart();
    });

    nextButton.on("pointerdown", () => {
      blur.destroy();
      winBox.destroy();
      yourScore.destroy();
      yourUserScore.destroy();
      replayButton.destroy();
      nextButton.destroy();
      this.winOverlayCont.destroy();
      this.notifyParent('sceneComplete', { result: 'win' });
    });

    this.winOverlayCont.add([
      blur, winBox,
      yourScore, yourUserScore,
      replayButton, nextButton
    ]);
  }

  notifyParent(type, data) {
    if (window.parent !== window) {
      window.parent.postMessage({ type, ...data }, "*");
    }
  }

  // --- MAIN GAME LOOP ---

  startGame() {
    this.gameOver = false;
    if (!this.bgm || !this.bgm.isPlaying) {
      this.bgm = this.sound.add('bgm', { loop: true, volume: 0.5 });
      this.bgm.play();
    }

    this.gameOverActive = false;
    this.score = 0;
    this.timer = this.levelDuration;
    this.troopHp = this.gameConfig.initialTroopHp ?? 1;
    this.lastSpawn = this.time.now;
    this.lastHpUp = this.time.now;
    this.levelStart = this.time.now; // <-- Start counting time only after play

    this.troops.forEach(t => {
      t.g.destroy();
      if (t.hpText) t.hpText.destroy();
    });
    this.troops = [];
    this.scoreText.setText(this.texts.score.replace('{score}', 0));
    this.timerText.setText(this.texts.timer.replace('{timer}', this.levelDuration));

    // Clean up overlays if present
    if (this.gameoverOverlay) { this.gameoverOverlay.destroy(); this.gameoverOverlay = undefined; }
    if (this.winOverlayCont) { this.winOverlayCont.destroy(); this.winOverlayCont = undefined; }

    // Start timer event only now
    this.time.addEvent({ delay: 100, callback: () => this.updateTimer(), loop: true });
  }


  updateTimer() {
    if (this.gameOver) return;
    if (this.time.now - this.lastSpawn > this.spawnDelay) {
      this.spawnTroop();
      this.lastSpawn = this.time.now;
    }
    if (this.time.now - this.lastHpUp > this.hpIncreaseInterval) {
      this.troopHp++;
      this.lastHpUp = this.time.now;
    }
    let elapsed = Math.floor((this.time.now - this.levelStart) / 1000);
    this.timer = Math.max(0, this.levelDuration - elapsed);
    this.timerText.setText(this.texts.timer.replace('{timer}', this.timer));
    if (this.timer <= 0) {
      this.winLevel();
    }
  }

  spawnTroop() {
    let troop = this.createTroop(this.pathPoints[0].x, this.pathPoints[0].y, this.troopHp);
    let t = {
      g: troop.g,
      hpText: troop.hpText,
      progress: 0,
      hp: this.troopHp
    };
    this.troops.push(t);
  }

  update(time, dt) {
    if (!this.sceneReady || this.gameOver || this.htpOverlay || this.gameOverActive) return;
    if (this.gameOver || this.htpOverlay || this.gameOverActive) return;
    for (let i = this.troops.length - 1; i >= 0; i--) {
      let t = this.troops[i];
      t.progress += dt / 7000;
      let pos = this.pathGetXY(this.pathPoints, Phaser.Math.Clamp(t.progress, 0, 1));
      t.g.x = pos.x;
      t.g.y = pos.y;
      if (t.hpText) {
        t.hpText.x = pos.x;
        t.hpText.y = pos.y - 30;
      }
      if (t.progress >= 1) {
        this.loseGame();
        return;
      }
    }
  }

  loseGame() {
    if (this.bgm && this.bgm.isPlaying) this.bgm.stop();

    this.gameOver = true;
    this.gameOverOverlay();
    this.troops.forEach(t => {
      t.g.destroy();
      if (t.hpText) t.hpText.destroy();
    });
    this.troops = [];
  }

  winLevel() {
    if (this.bgm && this.bgm.isPlaying) this.bgm.stop();

    this.gameOver = true;
    this.winOverlay();
    this.troops.forEach(t => {
      t.g.destroy();
      if (t.hpText) t.hpText.destroy();
    });
    this.troops = [];
  }

  // --- CONFIG-DRIVEN PATH ---
  makeZigZagPath(sceneW, sceneH, endX, endY, margin = 120, steps = 8, amplitudePercent = 0.32) {
    const startX = margin;
    const amplitude = sceneH * amplitudePercent;
    const dx = (endX - startX) / steps;
    let points = [];
    for (let i = 0; i <= steps; i++) {
      let x = startX + dx * i;
      let y = (i % 2 === 0) ? endY - amplitude : endY + amplitude;
      if (i === 0 || i === steps) y = endY;
      points.push({ x, y });
    }
    return points;
  }

  pathGetXY(path, t) {
    let total = 0, lens = [];
    for (let i = 1; i < path.length; i++) {
      let l = Phaser.Math.Distance.BetweenPoints(path[i - 1], path[i]);
      lens.push(l); total += l;
    }
    let dist = t * total, acc = 0;
    for (let i = 0; i < lens.length; i++) {
      if (acc + lens[i] >= dist) {
        let r = (dist - acc) / lens[i];
        let x = Phaser.Math.Interpolation.Linear([path[i].x, path[i + 1].x], r);
        let y = Phaser.Math.Interpolation.Linear([path[i].y, path[i + 1].y], r);
        return { x, y };
      }
      acc += lens[i];
    }
    return { ...path[path.length - 1] };
  }

  createTower(x, y) {
    return this.add.image(x, y, 'tower').setDepth(10).setOrigin(0.5);
  }

  createTroop(x, y, hp = 1) {
    let tint = 0xffffff;
    if (hp > 2) tint = 0xa33d3d;
    else if (hp > 1) tint = 0xd98332;

    let troopImg = this.add.image(x, y, 'enemy')
      .setOrigin(0.5)
      .setDepth(9)
      .setScale(1.2)
      .setInteractive();

    troopImg.setTint(tint);

    // HP text label
    let hpText = this.add.text(x, y - 30, hp, {
      font: '40px outfit',
      color: '#fff',
      stroke: '#222',
      strokeThickness: 4
    }).setOrigin(0.5).setDepth(10);

    // Add pointerdown event directly to troopImg
    troopImg.on('pointerdown', () => {
      this.sound.play('hit', { volume: 1 });

      hp--;
      let tint = 0xffffff;
      if (hp > 2) tint = 0xa33d3d;
      else if (hp > 1) tint = 0xd98332;
      troopImg.setTint(tint);
      if (hpText) hpText.setText(hp);

      if (hp <= 0) {
        this.createExplosion(troopImg.x, troopImg.y);
        troopImg.destroy();
        if (hpText) hpText.destroy();
        let idx = this.troops.findIndex(t => t.g === troopImg);
        if (idx !== -1) this.troops.splice(idx, 1);
        this.score++;
        this.scoreText.setText(this.texts.score.replace('{score}', this.score));
      }
    });


    return { g: troopImg, hpText };
  }

  createExplosion(x, y) {
    let exp = this.add.image(x, y, 'explosion').setDepth(20).setScale(0.85);
    this.sys.tweens.add({
      targets: exp,
      alpha: 0,
      scale: 2,
      duration: 260,
      onComplete: () => exp.destroy()
    });
  }

  createPath(points) {
    let g = this.add.graphics({ lineStyle: { width: 16, color: 0xd2a86a, alpha: 0.75 } });
    g.strokePoints(points, false, false);
    g.setDepth(3);
    return g;
  }
}
