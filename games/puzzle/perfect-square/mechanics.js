// mechanics.js – Phaser 3 square landing game tuned for 1080x1920
// + 60s timer, start / win / game over overlays
// + config.json-driven images, text, mechanics, and audio

const bgColors = [0x62bd18, 0xff5300, 0xd21034, 0xff475c, 0x8f16b2, 0x588c7e, 0x8c4646];
const holeWidthRange = [40, 240];
const wallRange = [10, 70];
const localStorageName = "squaregame"; // not used now, but kept if needed later

// original logical resolution
const BASE_WIDTH = 640;
const BASE_HEIGHT = 960;

// Path for config.json (same folder as mechanics.js)
const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf("/"));
export const CONFIG_PATH = `${basePath}/config.json`;

export default class GamePlayScene extends Phaser.Scene {
  constructor() {
    super("GamePlayScene");

    // main objects
    this.leftSquare = null;
    this.rightSquare = null;
    this.leftWall = null;
    this.rightWall = null;
    this.square = null;
    this.background = null;

    // UI
    this.squareText = null;
    this.levelText = null;
    this.infoGroup = null;
    this.timerText = null;
    this.targetText = null; // not used now but kept if needed later

    // tweens
    this.rotateTween = null;
    this.growTween = null;
    this.fallTween = null;

    // config (comes ONLY from config.json)
    this.configData = {};

    // data (session-only)
    this.savedData = { level: 1 };
    this.tintColor = 0xffffff;

    // scaling helpers
    this.baseScale = 1;
    this.scaleXFactor = 1;
    this.scaleYFactor = 1;

    // input state
    this.canGrow = false;
    this.isGrowing = false;

    // game state & timer
    this.mode = "start"; // "start" | "play" | "win" | "gameover"
    this.timeLimit = 60; // fallback until config loaded
    this.timeLeft = this.timeLimit;
    this.maxLevels = 3;  // fallback until config loaded
    this.timerEvent = null;

    // overlays
    this.startOverlay = null;
    this.winOverlay = null;
    this.gameOverOverlay = null;

    // audio
    this.bgm = null;
    this.collectSound = null;
  }

  preload() {
    // Load config.json first
    this.load.json("config32", CONFIG_PATH);

    // When config.json finishes loading, queue all assets from it
    this.load.once("filecomplete-json-config32", () => {
      const cfg = this.cache.json.get("config32") || {};
      this.configData = cfg;

      // ----- Images -----
      const imgGroups = [cfg.images1, cfg.images2, cfg.ui];
      imgGroups.forEach(group => {
        if (!group) return;
        for (const [key, url] of Object.entries(group)) {
          const fullUrl = url.startsWith("http") ? url : `${basePath}/${url}`;
          this.load.image(key, fullUrl);
        }
      });

      // ----- Bitmap font -----
      const font = cfg.font;
      if (font && font.png && font.fnt) {
        const fontPng = font.png.startsWith("http")
          ? font.png
          : `${basePath}/${font.png}`;
        const fontFnt = font.fnt.startsWith("http")
          ? font.fnt
          : `${basePath}/${font.fnt}`;
        this.load.bitmapFont(font.key || "font", fontPng, fontFnt);
      }

      // ----- Audio -----
      const aud = cfg.audio || {};
      for (const [key, url] of Object.entries(aud)) {
        const fullUrl = url.startsWith("http") ? url : `${basePath}/${url}`;
        this.load.audio(key, fullUrl);
      }
    });
  }

  create() {
    const width = this.scale.width;  // 1080
    const height = this.scale.height; // 1920

    this.scaleXFactor = width / BASE_WIDTH;
    this.scaleYFactor = height / BASE_HEIGHT;
    this.baseScale = Math.min(this.scaleXFactor, this.scaleYFactor);

    // read mechanics from config.json
    const mech = (this.configData && this.configData.mechanics) || {};
    this.timeLimit = mech.timeLimit || 60;
    this.maxLevels = mech.totalLevels || 3;
    this.timeLeft = this.timeLimit;

    // background
    this.tintColor = 0xffffff;                      // keep texts white
    this.cameras.main.setBackgroundColor("#000000"); // safe fallback

    this.background = this.add.image(width / 2, height / 2, "background");
    this.background.setDisplaySize(width, height);
    this.background.setDepth(-10);                  // behind everything

    const fontKey = (this.configData.font && this.configData.font.key) || "font";
    const texts = this.configData.texts || {};

    // 🔊 Create audio objects (will be played on user interaction)
    const audioCfg = this.configData.audio || {};
    if (audioCfg.bgm) {
      this.bgm = this.sound.add("bgm", {
        loop: true,
        volume: 0.6,
      });
    }
    if (audioCfg.collect) {
      this.collectSound = this.sound.add("collect", {
        volume: 1,
      });
    }

    // bottom bases
    this.leftSquare = this.add.sprite(0, height, "base").setOrigin(1, 1);
    this.rightSquare = this.add.sprite(width, height, "base").setOrigin(0, 1);

    // top walls
    this.leftWall = this.add.sprite(0, height, "top").setOrigin(1, 1);
    this.rightWall = this.add.sprite(width, height, "top").setOrigin(0, 1);

    // scale bases and walls
    this.leftSquare.setScale(this.baseScale);
    this.rightSquare.setScale(this.baseScale);
    this.leftWall.setScale(this.baseScale);
    this.rightWall.setScale(this.baseScale);

    // reposition walls to sit on top of bases
    const baseTopY = height - this.leftSquare.displayHeight;
    this.leftWall.y = baseTopY;
    this.rightWall.y = baseTopY;

    // falling square
    this.square = this.add.sprite(
      width / 2,
      -400 * this.baseScale,
      "square"
    );
    this.square.setOrigin(0.5);
    this.square.setScale(0.2 * this.baseScale);
    this.square.successful = 0;

    // number inside square
    this.squareText = this.add.bitmapText(
      this.square.x,
      this.square.y,
      fontKey,
      (this.savedData.level - this.square.successful).toString(),
      120 * this.baseScale
    );
    this.squareText.setOrigin(0.5);
    this.squareText.tint = this.tintColor;

    // HUD layout: Level and Timer on scoreback images
    const img = this.add.image(220, 70, "scoreback").setScale(1.2, 1);
    const img1 = this.add.image(width / 2 + 365, 70, "scoreback");

    const topMargin = 20 * this.baseScale;

    // Level text at top-left (Outfit)
    this.levelText = this.add.text(
      topMargin + 30,
      topMargin,
      `Level: ${this.savedData.level} / ${this.maxLevels}`,
      {
        fontFamily: "Outfit",
        fontSize: `68px`,
        color: "#030303ff"
      }
    );
    this.levelText.setOrigin(0, 0);

    // Timer text top-right (Outfit)
    this.timerText = this.add.text(
      width - topMargin,
      topMargin,
      `${texts.timerLabel || "Time: "}${this.timeLeft}`,
      {
        fontFamily: "Outfit",
        fontSize: `68px`,
        color: "#000000ff",
      }
    );
    this.timerText.setOrigin(1, 0);

    // helper overlay group (currently unused)
    this.infoGroup = this.add.container(0, 0);
    this.infoGroup.alpha = 0;

    // timer event (only counts when mode === "play")
    this.timerEvent = this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        if (this.mode !== "play") return;
        this.timeLeft--;
        if (this.timeLeft < 0) this.timeLeft = 0;
        this.updateTimerText();
        if (this.timeLeft <= 0) {
          this.handleTimeUp();
        }
      },
    });

    // input handlers
    this.input.on("pointerdown", this.onPointerDown, this);
    this.input.on("pointerup", this.onPointerUp, this);

    // Start overlay first – game begins after Play is pressed
    this.showStartOverlay();
  }

  // ====== Utilities ======
  notifyParent(type, data = {}) {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type, ...data }, "*");
    }
  }

  update() {
    if (this.square && this.squareText) {
      this.squareText.x = this.square.x;
      this.squareText.y = this.square.y;
    }
  }

  scaledY(value) {
    return value * this.baseScale;
  }

  updateTimerText() {
    const texts = this.configData.texts || {};
    const label = texts.timerLabel || "Time: ";
    if (this.timerText) {
      this.timerText.text = `${label}${this.timeLeft}`;
    }
  }

  // Floating landing/fail text
  showLandingText(message, color = "#ffffff") {
    if (!this.square) return;

    const txt = this.add.text(
      this.square.x,
      this.square.y - this.square.displayHeight,
      message,
      {
        fontFamily: "Outfit",
        fontSize: `${64 * this.baseScale}px`,
        color,
        stroke: "#000000",
        strokeThickness: 6,
        align: "center",
      }
    );
    txt.setOrigin(0.5);

    this.tweens.add({
      targets: txt,
      y: txt.y - 80 * this.baseScale,
      alpha: 0,
      duration: 700,
      ease: "Cubic.out",
      onComplete: () => txt.destroy(),
    });
  }

  onPointerDown() {
    if (this.mode !== "play") return;
    if (!this.canGrow || this.isGrowing) return;
    this.grow();
  }

  onPointerUp() {
    if (this.mode !== "play") return;
    if (!this.canGrow || !this.isGrowing) return;
    this.stop();
  }

  // ====== Level setup ======
  updateLevel() {
    // reset input state for this attempt
    this.canGrow = false;
    this.isGrowing = false;

    this.squareText.text = (this.savedData.level - this.square.successful).toString();

    const width = this.scale.width;

    const mech = (this.configData && this.configData.mechanics) || {};
    const hRange = mech.holeWidthRange || holeWidthRange;
    const wRange = mech.wallWidthRange || wallRange;

    const holeWidth = Phaser.Math.Between(
      hRange[0] * this.baseScale,
      hRange[1] * this.baseScale
    );
    const wallWidth = Phaser.Math.Between(
      wRange[0] * this.baseScale,
      wRange[1] * this.baseScale
    );

    // reset square starting position/scale/angle
    this.square.y = -400 * this.baseScale;
    this.square.setScale(0.2 * this.baseScale);
    this.square.angle = 0;

    // move bases to create new hole
    this.tweens.add({
      targets: this.leftSquare,
      x: (width - holeWidth) / 2,
      duration: 500,
      ease: "Cubic.out",
    });

    this.tweens.add({
      targets: this.rightSquare,
      x: (width + holeWidth) / 2,
      duration: 500,
      ease: "Cubic.out",
    });

    this.tweens.add({
      targets: this.leftWall,
      x: (width - holeWidth) / 2 - wallWidth,
      duration: 500,
      ease: "Cubic.out",
    });

    this.tweens.add({
      targets: this.rightWall,
      x: (width + holeWidth) / 2 + wallWidth,
      duration: 500,
      ease: "Cubic.out",
    });

    // bring square in from top
    this.tweens.add({
      targets: this.square,
      y: this.scaledY(150),
      angle: 50,
      duration: 500,
      ease: "Cubic.out",
      onComplete: () => {
        // now we allow growing
        this.canGrow = true;

        // idle rotation
        this.rotateTween = this.tweens.add({
          targets: this.square,
          angle: 40,
          duration: 300,
          ease: "Linear",
          yoyo: true,
          repeat: -1,
        });

        // no in-game hint overlay any more
        if (this.infoGroup) {
          this.infoGroup.removeAll(true); // ensure it's empty
        }
      },
    });
  }

  // ====== Grow / Drop logic ======
  grow() {
    this.isGrowing = true;

    if (this.infoGroup) {
      this.infoGroup.destroy();
      this.infoGroup = null;
    }

    if (this.growTween) {
      this.growTween.stop();
    }

    this.growTween = this.tweens.add({
      targets: this.square,
      scaleX: 1 * this.baseScale,
      scaleY: 1 * this.baseScale,
      duration: 1500,
      ease: "Linear",
    });
  }

  stop() {
    this.canGrow = false;
    this.isGrowing = false;

    let message = "";

    if (this.growTween) {
      this.growTween.stop();
    }
    if (this.rotateTween) {
      this.rotateTween.stop();
    }

    this.rotateTween = this.tweens.add({
      targets: this.square,
      angle: 0,
      duration: 300,
      ease: "Cubic.out",
    });

    const width = this.scale.width;
    const height = this.scale.height;

    const holeWidthCurrent = this.rightSquare.x - this.leftSquare.x;
    const innerHoleWidth = this.rightWall.x - this.leftWall.x;

    if (this.square.displayWidth <= holeWidthCurrent) {
      // too small → falls through
      message = "Oh no!!";
      this.showLandingText("Oh no!!", "#ff3333");
      this.rotateTween.on("complete", () => {
        this.fallTween = this.tweens.add({
          targets: this.square,
          y: height + this.square.displayHeight,
          duration: 300,
          ease: "Cubic.in",
        });
      });
    } else {
      let destY;
      if (this.square.displayWidth <= innerHoleWidth) {
        // perfect land on base → SUCCESS for this drop
        destY =
          height -
          this.leftSquare.displayHeight -
          this.square.displayHeight / 2;
        this.square.successful++;

        // 🔊 success sound + text
        if (this.collectSound) {
          this.collectSound.play();
        }
        const successLabel =
          Phaser.Math.Between(0, 1) === 0 ? "Perfect!" : "Nice!";
        this.showLandingText(successLabel, "#11d211");
      } else {
        // too big, hit the walls → FAIL
        destY =
          height -
          this.leftSquare.displayHeight -
          this.leftWall.displayHeight -
          this.square.displayHeight / 2;
        message = "Oh no!!";
        this.showLandingText("Oh no!!", "#ff3333");
      }

      this.tweens.add({
        targets: this.square,
        y: destY,
        duration: 600,
        ease: "Bounce.out",
      });
    }

    // resolve level result after animations
    this.time.delayedCall(2000, () => {
      // already finished by time or win overlay
      if (this.timeLeft <= 0 || this.mode === "gameover" || this.mode === "win") {
        return;
      }

      if (message) {
        // ❌ FAIL: reset successes and retry same level
        this.square.successful = 0;
        this.updateLevel();
        return;
      }

      // ✅ SUCCESSFUL landing this attempt
      if (this.square.successful >= this.savedData.level) {
        // required number of successes for this level reached
        if (this.savedData.level >= this.maxLevels) {
          // Final level → show win overlay
          this.showWinOverlay();
        } else {
          // Go to next level
          this.savedData.level++;
          this.square.successful = 0;
          this.levelText.text = `Level: ${this.savedData.level} / ${this.maxLevels}`;
          this.updateLevel();
        }
      } else {
        // Not enough successes yet → keep progress and try again in SAME level
        this.updateLevel();
      }
    });
  }

  // ====== Timer-based Game Over ======
  handleTimeUp() {
    if (this.mode === "gameover" || this.mode === "win") return;
    this.mode = "gameover";
    this.canGrow = false;

    if (this.growTween) this.growTween.stop();
    if (this.rotateTween) this.rotateTween.stop();

    this.showGameOverOverlay();
  }

  // ====== Overlays ======
  showStartOverlay() {
    if (this.startOverlay) this.startOverlay.destroy();

    // 🔊 (Re)start BGM on each new game (start or replay)
    if (this.bgm) {
      this.bgm.stop();
      this.bgm.play();
    }

    this.mode = "start";
    this.canGrow = false;
    this.isGrowing = false;

    const w = this.scale.width;
    const h = this.scale.height;
    const texts = this.configData.texts || {};

    const cont = this.add.container(0, 0);
    this.startOverlay = cont;

    const bg = this.add.image(w / 2, h / 2, "htpbg");
    bg.setDisplaySize(w, h);
    cont.add(bg);

    const box = this.add.image(w / 2, h / 2, "htpbox").setScale(0.55, 0.8);
    cont.add(box);

    // ---- Text styles using Outfit (no bitmap font key) ----
    const titleSize = 64 * this.baseScale;
    const bodySize = 40 * this.baseScale;

    const title = this.add.text(
      w / 2,
      h / 2 - box.displayHeight * 0.25 - 30,
      texts.howToTitle || "HOW TO PLAY",
      {
        fontFamily: "Outfit",
        fontSize: `${titleSize}px`,
        color: "#ffffff",
        align: "center",
        wordWrap: { width: box.displayWidth * 0.8, useAdvancedWrap: true },
      }
    ).setOrigin(0.5);
    cont.add(title);

    const square = this.add.image(w / 2 + 250, h / 2 - 30, "square").setScale(0.3, 0.3);
    cont.add(square);

    const line1 = this.add.text(
      w / 2 - 150,
      h / 2 - 20 * this.baseScale,
      texts.howToLine1 || "Tap and hold to grow",
      {
        fontFamily: "Outfit",
        fontSize: `${bodySize}px`,
        color: "#ffffff",
        align: "center",
        wordWrap: { width: box.displayWidth * 0.85, useAdvancedWrap: true },
      }
    ).setOrigin(0.5);
    cont.add(line1);

    const line2 = this.add.text(
      w / 2,
      h / 2 + 30 * this.baseScale + 90,
      texts.howToLine2 || "Release to drop",
      {
        fontFamily: "Outfit",
        fontSize: `${bodySize}px`,
        color: "#ffffff",
        align: "center",
        wordWrap: { width: box.displayWidth * 0.85, useAdvancedWrap: true },
      }
    ).setOrigin(0.5);
    cont.add(line2);

    const playBtn = this.add.image(
      w / 2,
      h / 2 + box.displayHeight * 0.3 + 250,
      "playbtn"
    );
    playBtn.setInteractive({ useHandCursor: true });
    playBtn.on("pointerup", () => {
      this.startOverlay?.destroy();
      this.startOverlay = null;
      this.startGame();
    });
    cont.add(playBtn);
  }

  startGame() {
    // reset full game state
    this.mode = "play";
    this.savedData = { level: 1 };
    this.square.successful = 0;

    // mechanics again from config, just in case
    const mech = (this.configData && this.configData.mechanics) || {};
    this.timeLimit = mech.timeLimit || 60;
    this.maxLevels = mech.totalLevels || 3;

    this.timeLeft = this.timeLimit;
    this.updateTimerText();
    this.levelText.text = `Level: ${this.savedData.level} / ${this.maxLevels}`;

    // recreate info group for tutorials on first level
    if (!this.infoGroup || !this.infoGroup.active) {
      this.infoGroup = this.add.container(0, 0);
      this.infoGroup.alpha = 0.4;
    }

    this.updateLevel();
  }

  showWinOverlay() {
    if (this.winOverlay) this.winOverlay.destroy();

    this.mode = "win";
    this.canGrow = false;

    const w = this.scale.width;
    const h = this.scale.height;
    const texts = this.configData.texts || {};

    const cont = this.add.container(0, 0);
    this.winOverlay = cont;

    const bg = this.add.image(w / 2, h / 2, "winbg");
    bg.setDisplaySize(w, h);
    cont.add(bg);

    const box = this.add.image(w / 2, h / 2, "lvlbox").setScale(0.55);
    cont.add(box);

    // ---- Title (Outfit font) ----
    const title = this.add.text(
      w / 2,
      h / 2,
      texts.levelCompleted || "LEVEL COMPLETED",
      {
        fontFamily: "Outfit",
        fontSize: `${64 * this.baseScale}px`,
        color: "#ffffff",
        align: "center",
      }
    ).setOrigin(0.5);
    cont.add(title);

    // ---- Replay button ----
    const replayBtn = this.add.image(
      w / 2 - box.displayWidth * 0.2 - 60,
      h / 2 + box.displayHeight * 0.3 + 250,
      "lvl_replay"
    );
    replayBtn.setInteractive({ useHandCursor: true });
    replayBtn.on("pointerup", () => {
      this.winOverlay?.destroy();
      this.winOverlay = null;
      // NOTE: do NOT stop bgm here; startGame will restart it
      this.startGame();
    });
    cont.add(replayBtn);

    // ---- Next button ----
    const nextBtn = this.add.image(
      w / 2 + box.displayWidth * 0.2 + 60,
      h / 2 + box.displayHeight * 0.3 + 250,
      "nextbtn"
    );
    nextBtn.setInteractive({ useHandCursor: true });
    nextBtn.on("pointerup", () => {
      this.notifyParent("sceneComplete", { result: "win" });
    });
    cont.add(nextBtn);
  }

  showGameOverOverlay() {
    if (this.gameOverOverlay) this.gameOverOverlay.destroy();

    const w = this.scale.width;
    const h = this.scale.height;
    const texts = this.configData.texts || {};
    const fontKey = (this.configData.font && this.configData.font.key) || "font";

    const cont = this.add.container(0, 0);
    this.gameOverOverlay = cont;

    const bg = this.add.image(w / 2, h / 2, "ovrbg");
    bg.setDisplaySize(w, h);
    cont.add(bg);

    const box = this.add.image(w / 2, h / 2, "ovrbox").setScale(0.55);
    cont.add(box);

    const title = this.add.bitmapText(
      w / 2,
      h / 2,
      fontKey,
      texts.gameOver || "GAME OVER",
      64 * this.baseScale
    ).setOrigin(0.5);
    cont.add(title);

    const replayBtn = this.add.image(
      w / 2,
      h / 2 + box.displayHeight * 0.3 + 200,
      "replay"
    );
    replayBtn.setInteractive({ useHandCursor: true });
    replayBtn.on("pointerup", () => {
      this.gameOverOverlay?.destroy();
      this.gameOverOverlay = null;
      // NOTE: do NOT stop bgm here; startGame will restart it
      this.startGame();
    });
    cont.add(replayBtn);
  }
}
