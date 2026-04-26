// Scenes/GameScene.js
// Pure gameplay-only scene for "Spot Kick Duel" (Portrait 1080x1920)
// - No menus/overlays/transitions besides calling Win/GameOver scenes
// - Uses config from this.registry.get('cfg')
// - Uses this.sys.* access style
// - Mobile buttons: left/right/action
// - Asset fallback system + proper setDisplaySize on obj/platform assets

class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');

    // Core config/state
    this.cfg = null;
    this.W = 1080;
    this.H = 1920;

    // Entities
    this.field = null;
    this.goal = null;
    this.keeper = null;
    this.ball = null;

    // UI
    this.ui = {
      scoreText: null,
      roundText: null,
      statusText: null,
      timerText: null
    };

    // Scores/rounds/turns
    this.playerScore = 0;
    this.cpuScore = 0;
    this.round = 1; // 1..N, each round has two kicks (player, cpu)
    this.totalRounds = 5;
    this.inSuddenDeath = false;

    // Turn state: 'PLAYER_AIM' -> 'PLAYER_SHOT' -> 'CPU_AIM' -> 'CPU_SHOT'
    this.turn = 'PLAYER_AIM';

    // Aim/Dive selection: -1 (Left), 0 (Center), +1 (Right)
    this.aimIndex = 0;
    this.diveIndex = 0;

    // Input flags
    this.inputFlags = { left: false, right: false, action: false };

    // Control sprites
    this.controls = { left: null, right: null, action: null };

    // Timing
    this.turnDeadline = 0;   // per-turn soft timer (ms)
    this.turnTimeMs = 6000;  // player has 6s to select, else Center

    // Audio refs
    this.sfx = { bgm: null, kick: null, save: null, goal: null, miss: null };

    // Misc
    this.busy = false; // locked while animations run
  }

  preload() {
    // Load assets from config
    const cfg = this.registry.get('cfg') || {};
    this.cfg = cfg;

    // Images
    if (cfg.images) {
      for (const [key, url] of Object.entries(cfg.images)) {
        if (url && typeof url === 'string') {
          this.load.image(key, url);
        }
      }
    }

    // Spritesheets (not required, but supported)
    if (cfg.spritesheets) {
      for (const [key, meta] of Object.entries(cfg.spritesheets)) {
        if (meta && meta.url) {
          this.load.spritesheet(key, meta.url, {
            frameWidth: meta.frameWidth || 64,
            frameHeight: meta.frameHeight || 64,
            endFrame: (meta.frames || 0) - 1
          });
        }
      }
    }

    // Audio
    if (cfg.audio) {
      for (const [key, url] of Object.entries(cfg.audio)) {
        if (url) this.load.audio(key, url);
      }
    }
  }

  create() {
    const gcfg = this.sys.game.config;
    this.W = gcfg.width;
    this.H = gcfg.height;

    const cfg = this.cfg || {};
    this.totalRounds = (cfg.gameplay && cfg.gameplay.rounds) || 5;
    this.turnTimeMs = (cfg.gameplay && cfg.gameplay.turnTimeMs) || 6000;

    // Background / field (fallback rectangle if missing)
    this.field = this._spriteOrRect(
      (cfg.images && cfg.images.background) ? 'background' : null,
      this.W * 0.5, this.H * 0.5, this.W, this.H, 0x0b3d0b
    );

    // Goal at top-center
    const goalW = (cfg.gameplay && cfg.gameplay.goalWidth) || 800;
    const goalH = (cfg.gameplay && cfg.gameplay.goalHeight) || 280;
    this.goal = this._spriteOrRect(
      (cfg.images && cfg.images.goal) ? 'goal' : null,
      this.W * 0.5, this.H * 0.18, goalW, goalH, 0xffffff
    );

    // Keeper at goal line
    const keeperW = (cfg.gameplay && cfg.gameplay.keeperWidth) || 300;
    const keeperH = (cfg.gameplay && cfg.gameplay.keeperHeight) || 180;
    this.keeper = this._spriteOrRect(
      (cfg.images && cfg.images.goalkeeper) ? 'goalkeeper' : null,
      this.W * 0.5, this.goal.y + goalH * 0.05, keeperW, keeperH, 0x3333ff
    );

    // Simple midfield/spot marker (optional)
    this._drawSpot();

    // UI (score / round / status / per-turn timer)
    this._createGameplayUI();

    // Audio
    this._initAudio();

    // Controls
    this._createControls();

    // Keyboard
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keySpace = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    // Start background music
    if (this.sfx.bgm && !this.sfx.bgm.isPlaying) {
      this.sfx.bgm.setLoop(true);
      this.sfx.bgm.play({ volume: 0.5 });
    }

    // Initialize state to player aim
    this._setTurn('PLAYER_AIM');
  }

  update(time, delta) {
    // Read keyboard (edge-trigger style)
    if (!this.busy) {
      if (Phaser.Input.Keyboard.JustDown(this.cursors.left)) this._pressLeft();
      if (Phaser.Input.Keyboard.JustDown(this.cursors.right)) this._pressRight();
      if (Phaser.Input.Keyboard.JustDown(this.keySpace)) this._pressAction();
    }

    // Turn timeout -> default Center
    if (!this.busy && this.turnDeadline && time > this.turnDeadline) {
      this._autoCommit();
    }
  }

  // ---------------------------
  // Turn / Flow
  // ---------------------------

  _setTurn(newTurn) {
    this.turn = newTurn;
    this.busy = false;
    this.turnDeadline = this.time.now + this.turnTimeMs;

    switch (newTurn) {
      case 'PLAYER_AIM':
        this.aimIndex = 0; // Center by default
        this._setStatus('Your Shot: Choose Aim (◀ / ▶), Space to Kick');
        break;

      case 'PLAYER_SHOT':
        this.busy = true;
        this._executeShot('player', this.aimIndex);
        break;

      case 'CPU_AIM':
        this.diveIndex = 0; // Center default dive if user takes no action
        this._setStatus('Defend: Choose Dive (◀ / ▶), Space to Dive');
        break;

      case 'CPU_SHOT':
        this.busy = true;
        // CPU chooses aim randomly
        const cpuAim = this._randLane();
        this._executeShot('cpu', cpuAim);
        break;
    }

    this._updateUI();
  }

  _nextTurn(afterDelay = 900) {
    this.time.delayedCall(afterDelay, () => {
      if (this.turn === 'PLAYER_SHOT') {
        // Move to CPU aim
        this._setTurn('CPU_AIM');
      } else if (this.turn === 'CPU_SHOT') {
        // End of round pair -> advance round or sudden death logic
        const pairDone = true;
        if (pairDone) {
          if (!this.inSuddenDeath && this.round < this.totalRounds) {
            this.round += 1;
            this._setTurn('PLAYER_AIM');
          } else {
            // Regulation ended or currently in sudden death
            if (!this.inSuddenDeath && this.round >= this.totalRounds && this.playerScore === this.cpuScore) {
              this.inSuddenDeath = true;
              this._setStatus('Sudden Death! Your Shot.');
              this._setTurn('PLAYER_AIM');
            } else {
              // If tie in sudden death: continue; else finish
              if (this.inSuddenDeath && this.playerScore === this.cpuScore) {
                // keep going
                this.round += 1;
                this._setTurn('PLAYER_AIM');
              } else {
                // Someone leads -> finish
                this._finishMatch();
              }
            }
          }
        }
      }
    });
  }

  _finishMatch() {
    const playerWon = this.playerScore > this.cpuScore;
    if (playerWon) {
      this._setStatus('You Win!');
      // Hand off to WinScene (handled elsewhere)
      this.time.delayedCall(900, () => this.scene.start('WinScene'));
    } else {
      this._setStatus('You Lose!');
      this.time.delayedCall(900, () => this.scene.start('GameOverScene'));
    }
  }

  // ---------------------------
  // Shot Execution
  // ---------------------------

  _executeShot(shooter, aimLane) {
    // Compute CPU keeper guess when player shoots (difficulty bias)
    // Or use player's selected dive when CPU shoots.
    const diff = (this.cfg.gameplay && this.cfg.gameplay.cpuSaveBias) ?? 0.4; // 0..1
    let keeperGuessLane = 0;

    if (shooter === 'player') {
      const willGuessRight = Math.random() < diff;
      keeperGuessLane = willGuessRight ? aimLane : this._randLaneExcept(aimLane);
    } else {
      // CPU shooting -> use player's chosen dive
      keeperGuessLane = this.diveIndex;
    }

    // Keeper dive animation
    this._keeperDiveTo(keeperGuessLane);

    // Ball flight
    const spotY = this.H * 0.82;
    const spotX = this.W * 0.5;
    const target = this._laneTarget(aimLane);

    // Create ball (destroy any existing first)
    if (this.ball) { this.ball.destroy(); this.ball = null; }
    const ballKey = (this.cfg.images && this.cfg.images.ball) ? 'ball' : null;
    this.ball = this._spriteOrRect(ballKey, spotX, spotY, 90, 90, 0xffffff);

    // Kick SFX
    if (this.sfx.kick) this.sfx.kick.play({ volume: 0.9 });

    // Tween ball to goal
    const flightMs = (this.cfg.gameplay && this.cfg.gameplay.ballFlightMs) || 700;
    this.tweens.add({
      targets: this.ball,
      x: target.x,
      y: target.y,
      duration: flightMs,
      ease: 'Quad.easeOut',
      onComplete: () => {
        // Resolve
        const isSave = (keeperGuessLane === aimLane);
        if (isSave) {
          if (this.sfx.save) this.sfx.save.play({ volume: 0.8 });
          this._flashGoal(0xff4444);
          this._setStatus(shooter === 'player' ? 'Saved by CPU!' : 'You Saved It!');
          // small knockback
          this.tweens.add({ targets: this.ball, y: this.ball.y + 60, duration: 200, ease: 'Sine.easeIn' });
        } else {
          if (this.sfx.goal) this.sfx.goal.play({ volume: 0.9 });
          this._flashGoal(0x00ff66);
          this._setStatus('GOAL!');
          if (shooter === 'player') this.playerScore += 1; else this.cpuScore += 1;
        }

        // Reset keeper to center
        this._keeperReset();

        // Clear ball soon
        this.time.delayedCall(450, () => {
          if (this.ball) { this.ball.destroy(); this.ball = null; }
        });

        // Progress flow
        this.busy = false;
        if (shooter === 'player') {
          this._setTurn('CPU_AIM');
        } else {
          this._setTurn('CPU_SHOT'); // reset to shot will handle end-of-round in _nextTurn
        }
        // _setTurn above sets deadline & text; we then advance to next phase handler:
        if (shooter === 'player') {
          // Now CPU_AIM awaits player dive input
        } else {
          // Completed CPU_SHOT -> end of round pair
          this._nextTurn(650);
        }

        this._updateUI();
      }
    });

    // Immediately switch to 'PLAYER_SHOT' or 'CPU_SHOT' turn label (for internal state)
    if (shooter === 'player') this.turn = 'PLAYER_SHOT';
    else this.turn = 'CPU_SHOT';
  }

  // ---------------------------
  // Helpers: Keeper, Aim/Dive, Lanes
  // ---------------------------

  _laneTarget(idx) {
    // idx: -1 L, 0 C, +1 R
    const topY = this.goal.y + (this.goal.displayHeight ? this.goal.displayHeight * -0.1 : -20);
    const spreadX = (this.cfg.gameplay && this.cfg.gameplay.laneSpreadX) || 260;
    return { x: this.W * 0.5 + idx * spreadX, y: topY + 120 };
  }

  _keeperSpot(idx) {
    const baseY = this.goal.y + (this.goal.displayHeight ? this.goal.displayHeight * 0.05 : 30);
    const spreadX = (this.cfg.gameplay && this.cfg.gameplay.laneSpreadX) || 260;
    return { x: this.W * 0.5 + idx * spreadX * 0.9, y: baseY };
  }

  _keeperDiveTo(idx) {
    const p = this._keeperSpot(idx);
    const dur = (this.cfg.gameplay && this.cfg.gameplay.keeperDiveMs) || 350;
    this.tweens.add({
      targets: this.keeper,
      x: p.x,
      y: p.y,
      duration: dur,
      ease: 'Sine.easeOut'
    });
  }

  _keeperReset() {
    const p = this._keeperSpot(0);
    const dur = (this.cfg.gameplay && this.cfg.gameplay.keeperResetMs) || 250;
    this.tweens.add({
      targets: this.keeper,
      x: p.x,
      y: p.y,
      duration: dur,
      ease: 'Sine.easeIn'
    });
  }

  _randLane() {
    const r = Math.random();
    return r < 0.3333 ? -1 : (r < 0.6666 ? 0 : +1);
    // -1 L, 0 C, +1 R
  }

  _randLaneExcept(except) {
    const options = [-1, 0, +1].filter(v => v !== except);
    return options[Math.floor(Math.random() * options.length)];
  }

  _drawSpot() {
    const g = this.add.graphics();
    g.fillStyle(0xffffff, 0.9);
    const x = this.W * 0.5, y = this.H * 0.82;
    g.fillCircle(x, y, 6);
    g.lineStyle(2, 0xffffff, 0.6);
    g.strokeCircle(x, y, 22);
  }

  _flashGoal(color = 0xffffff) {
    const g = this.add.graphics();
    g.fillStyle(color, 0.25);
    const w = this.goal.displayWidth || 800;
    const h = (this.goal.displayHeight || 250) * 0.5;
    g.fillRect(this.goal.x - w * 0.5, this.goal.y - h * 0.8, w, h);
    this.time.delayedCall(150, () => g.destroy());
  }

  // ---------------------------
  // UI
  // ---------------------------

  _createGameplayUI() {
    const style = {
      fontFamily: (this.cfg.font && this.cfg.font.family) || 'system-ui',
      fontSize: '40px',
      color: '#ffffff'
    };

    this.ui.scoreText = this.add.text(24, 24, '', style).setOrigin(0, 0).setDepth(10);
    this.ui.roundText = this.add.text(this.W - 24, 24, '', style).setOrigin(1, 0).setDepth(10);

    this.ui.statusText = this.add.text(this.W * 0.5, this.H * 0.08, '', {
      ...style, fontSize: '44px', color: '#fffd93'
    }).setOrigin(0.5, 0.5).setDepth(10);

    this.ui.timerText = this.add.text(this.W * 0.5, this.H * 0.12, '', {
      ...style, fontSize: '32px', color: '#a6c6ff'
    }).setOrigin(0.5, 0.5).setDepth(10);

    this._updateUI();
  }

  _setStatus(msg) {
    if (this.ui.statusText) this.ui.statusText.setText(msg);
  }

  _updateUI() {
    if (this.ui.scoreText) {
      this.ui.scoreText.setText(`Score  You ${this.playerScore} : ${this.cpuScore} CPU`);
    }
    const rndTxt = this.inSuddenDeath ? `Sudden Death (R${this.round})` : `Round ${this.round}/${this.totalRounds}`;
    if (this.ui.roundText) this.ui.roundText.setText(rndTxt);

    // Turn timer display
    if (this.turnDeadline) {
      const rem = Math.max(0, Math.ceil((this.turnDeadline - this.time.now) / 1000));
      this.ui.timerText.setText(`Time: ${rem}s`);
    } else {
      this.ui.timerText.setText('');
    }
  }

  // ---------------------------
  // Input: Buttons + Keyboard
  // ---------------------------

  _createControls() {
    const cfg = this.cfg || {};
    const leftKey = 'left';
    const rightKey = 'right';
    const actionKey = 'action';

    const makeBtn = (key, x, y) => {
      const size = 160; // visual size we used in _spriteOrRect
      const s = this._spriteOrRect(
        (cfg.images && cfg.images[key]) ? key : null,
        x, y, size, size,
        key === leftKey ? 0x314aff : key === rightKey ? 0x31d1ff : 0xffb703
      );

      // ✅ Define a local-space rectangle hit area so it works for Graphics AND Sprites
      const hit = new Phaser.Geom.Rectangle(-size / 2, -size / 2, size, size);
      s.setInteractive({
        hitArea: hit,
        hitAreaCallback: Phaser.Geom.Rectangle.Contains,
        useHandCursor: true
      });

      s.on('pointerdown', () => {
        s.setScale(0.94); s.setAlpha(0.85);
        if (key === leftKey) this._pressLeft();
        if (key === rightKey) this._pressRight();
        if (key === actionKey) this._pressAction();
      });
      s.on('pointerup', () => { s.setScale(1); s.setAlpha(1); });
      s.on('pointerout', () => { s.setScale(1); s.setAlpha(1); });

      s.setDepth(20);
      return s;
    };

    // Mobile positions (standard)
    const leftX = 160, leftY = this.H - 100;
    const rightX = 490, rightY = this.H - 100;
    const actionX = this.W - 160, actionY = this.H - 100;

    this.controls.left = makeBtn(leftKey, leftX, leftY);
    this.controls.right = makeBtn(rightKey, rightX, rightY);
    this.controls.action = makeBtn(actionKey, actionX, actionY);
  }


  _pressLeft() {
    if (this.busy) return;
    if (this.turn === 'PLAYER_AIM') {
      this.aimIndex = Math.max(-1, this.aimIndex - 1);
      this._setStatus(`Your Shot: Aim ${this._laneName(this.aimIndex)} (Space to Kick)`);
    } else if (this.turn === 'CPU_AIM') {
      this.diveIndex = Math.max(-1, this.diveIndex - 1);
      this._setStatus(`Defend: Dive ${this._laneName(this.diveIndex)} (Space to Dive)`);
    }
    this._updateUI();
  }

  _pressRight() {
    if (this.busy) return;
    if (this.turn === 'PLAYER_AIM') {
      this.aimIndex = Math.min(+1, this.aimIndex + 1);
      this._setStatus(`Your Shot: Aim ${this._laneName(this.aimIndex)} (Space to Kick)`);
    } else if (this.turn === 'CPU_AIM') {
      this.diveIndex = Math.min(+1, this.diveIndex + 1);
      this._setStatus(`Defend: Dive ${this._laneName(this.diveIndex)} (Space to Dive)`);
    }
    this._updateUI();
  }

  _pressAction() {
    if (this.busy) return;
    if (this.turn === 'PLAYER_AIM') {
      this._setTurn('PLAYER_SHOT'); // executes with current aimIndex
    } else if (this.turn === 'CPU_AIM') {
      // Commit dive and run CPU shot
      this._setTurn('CPU_SHOT');
    }
  }

  _laneName(idx) {
    return idx === -1 ? 'Left' : (idx === 0 ? 'Center' : 'Right');
  }

  _autoCommit() {
    if (this.busy) return;
    if (this.turn === 'PLAYER_AIM') {
      this._setStatus('Auto: Center Kick');
      this.aimIndex = 0;
      this._setTurn('PLAYER_SHOT');
    } else if (this.turn === 'CPU_AIM') {
      this._setStatus('Auto: Center Dive');
      this.diveIndex = 0;
      this._setTurn('CPU_SHOT');
    }
  }

  // ---------------------------
  // Audio
  // ---------------------------

  _initAudio() {
    const aud = this.cfg.audio || {};
    this.sfx.bgm = aud.bgm ? this.sound.add('bgm') : null;
    this.sfx.kick = aud.kick ? this.sound.add('kick') : (aud.attack ? this.sound.add('attack') : null);
    this.sfx.save = aud.save ? this.sound.add('save') :
      (aud.hit ? this.sound.add('hit') : (aud.collision ? this.sound.add('collision') : null));
    this.sfx.goal = aud.goal ? this.sound.add('goal') :
      (aud.level_complete ? this.sound.add('level_complete') :
        (aud.collect ? this.sound.add('collect') : null));
    this.sfx.miss = aud.miss ? this.sound.add('miss') :
      (aud.destroy ? this.sound.add('destroy') : null);
  }

  // ---------------------------
  // Asset Helpers (Fallbacks)
  // ---------------------------

  _spriteOrRect(keyOrNull, x, y, w, h, color = 0x888888) {
    // If we have a texture, use a sprite and size it
    if (keyOrNull && this.textures.exists(keyOrNull)) {
      const s = this.add.sprite(x, y, keyOrNull);
      s.setDisplaySize(w, h);
      return s; // native Sprite methods intact
    }

    // Fallback: use Graphics but DO NOT override its methods
    const g = this.add.graphics();
    g.fillStyle(color, 1);
    g.fillRoundedRect(x - w * 0.5, y - h * 0.5, w, h, Math.min(12, w * 0.1));

    // Emulate size props expected elsewhere, without touching methods
    g.x = x;
    g.y = y;
    g.displayWidth = w;
    g.displayHeight = h;

    // Important: leave g.setDepth and g.destroy as-is to avoid recursion
    return g;
  }

}

export default GameScene;
