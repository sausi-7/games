class GameScene extends Phaser.Scene {
  constructor() { super('GameScene'); }

  preload() {
    const cfg = this.registry.get('cfg') || { images: {}, audio: {}, gameplay: {} };
    const img = (k) => cfg.images?.[k];
    const sfx = (k) => cfg.audio?.[k];

    // ---- Images ----
    this.load.image('track', img('track'));
    this.load.image('background', img('background'));
    this.load.image('train', img('train'));
    this.load.image('station', img('station'));
    this.load.image('signal', img('signal'));
    this.load.image('platform', img('platform'));

    // Mobile controls
    this.load.image('btn_left', img('left'));
    this.load.image('btn_right', img('right'));
    this.load.image('btn_action', img('action'));

    // ---- Audio ----
    if (sfx('bgm')) this.load.audio('bgm', sfx('bgm'));
    if (sfx('collect')) this.load.audio('collect', sfx('collect'));
    if (sfx('hit')) this.load.audio('hit', sfx('hit'));
    if (sfx('jump')) this.load.audio('horn', sfx('jump'));
    if (sfx('gameover')) this.load.audio('gameover', sfx('gameover'));
    if (sfx('win')) this.load.audio('win', sfx('win'));
  }

  create() {
    const cfg = this.registry.get('cfg') || {};
    const gp = cfg.gameplay || {};
    const W = this.scale?.width ?? this.sys.game.config.width;
    const H = this.scale?.height ?? this.sys.game.config.height;
    this.W = W; this.H = H;

    // ---- Rules ----
    this.rules = {
      timerSeconds: gp.timerSeconds ?? 120,
      targetStations: gp.targetStations ?? 5,
      maxSpeed: gp.maxSpeed ?? 360,
      accel: gp.accel ?? 180,
      brake: gp.brake ?? 260,
      friction: gp.friction ?? 40,
      stationDwellSec: gp.stationDwellSec ?? 3,
      stopSpeed: gp.stopSpeed ?? 6,
      spawnSpacingMin: gp.spawnSpacingMin ?? 1600,
      spawnSpacingMax: gp.spawnSpacingMax ?? 2600,
      redEveryN: gp.redEveryN ?? 4,
      hp: gp.hp ?? 3,
      paxMin: gp.paxMin ?? 6,
      paxMax: gp.paxMax ?? 24,
      redChance: gp.redChance ?? 0.42,
      proxRedChance: gp.proxRedChance ?? 0.65,
      preSignalTriggerDist: gp.preSignalTriggerDist ?? 320
    };

    // ---- State ----
    this.state = {
      speed: 0,
      hp: this.rules.hp,
      stationsServed: 0,
      timeLeft: this.rules.timerSeconds,
      finished: false,
      doorsOpen: false,
      dwelling: false,
      dwellUntil: 0,
      nextIsRedCounter: 0,
      laneIndex: 1,
      passengersTotal: 0
    };

    // ---- Background (parallax) ----
    if (cfg.images?.background) {
      this.bgTS = this.add.tileSprite(W / 2, H / 2, W, H, 'background').setDepth(-20);
    } else {
      this.cameras.main.setBackgroundColor(0x1b1f2a);
      this.bgTS = null;
    }

    // ---- Track (platform + rails) ----
    this.trackBed = this.add.tileSprite(W / 2, H * 0.75, W, 40, 'platform').setDepth(-12);
    const railsKey = this.textures.exists('track') ? 'track' : this._buildRailsTexture();
    this.railsTS = this.add.tileSprite(W / 2, this.trackBed.y, W, 18, railsKey).setDepth(-11).setAlpha(1);

    // ---- Lanes ----
    const centerY = this.trackBed.y - 40;
    this.lanes = [centerY - 34, centerY, centerY + 34];

    // ---- Groups ----
    this.signals = this.add.group();
    this.stations = this.add.group();

    // ---- Train ----
    this.train = this.add.sprite(W * 0.28, this.lanes[this.state.laneIndex], 'train');
    this.train.setDisplaySize(120, 60);
    this.physics.add.existing(this.train);
    this.train.body.setAllowGravity(false).setImmovable(true).setSize(120, 60);
    this.train.setDepth(5);

    // ---- UI ----
    this.ui = {
      speed: this.add.text(20, 20, '', { fontFamily: cfg.font?.family || 'sans-serif', fontSize: 28, color: '#ffffff' }).setDepth(50),
      time:  this.add.text(20, 56, '', { fontFamily: cfg.font?.family || 'sans-serif', fontSize: 28, color: '#ffffff' }).setDepth(50),
      stat:  this.add.text(20, 92, '', { fontFamily: cfg.font?.family || 'sans-serif', fontSize: 28, color: '#ffffff' }).setDepth(50),
      hp:    this.add.text(20, 128, '', { fontFamily: cfg.font?.family || 'sans-serif', fontSize: 28, color: '#ffffff' }).setDepth(50),
      pax:   this.add.text(20, 164, '', { fontFamily: cfg.font?.family || 'sans-serif', fontSize: 28, color: '#ffffff' }).setDepth(50),
      hint:  this.add.text(W / 2, 20, 'Right=Throttle, Left=Brake, Up/Down=Change Lane, Action=Doors/Horn', { fontFamily: cfg.font?.family || 'sans-serif', fontSize: 20, color: '#cfe6ff' }).setOrigin(0.5, 0).setDepth(50)
    };
    this.ui.stationHint = this.add.text(W / 2, 48, '', { fontFamily: cfg.font?.family || 'sans-serif', fontSize: 22, color: '#ffd08c' }).setOrigin(0.5, 0).setDepth(50);
    this.ui.doorMsg = this.add.text(W / 2, 80, '', { fontFamily: cfg.font?.family || 'sans-serif', fontSize: 24, color: '#8cff98' }).setOrigin(0.5, 0).setDepth(60).setAlpha(0);
    this._lastStationPrompt = '';

    // ---- Controls ----
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys({
      A: Phaser.Input.Keyboard.KeyCodes.A,
      D: Phaser.Input.Keyboard.KeyCodes.D,
      W: Phaser.Input.Keyboard.KeyCodes.W,
      S: Phaser.Input.Keyboard.KeyCodes.S,
      SPACE: Phaser.Input.Keyboard.KeyCodes.SPACE
    });

    this._mobile = { left: false, right: false, action: false };
    this._makeMobileButtons(cfg);
    this._setupSwipeLanes();

    // ---- Audio ----
    const hasAudio = (k) => this.cache.audio && this.cache.audio.exists(k);
    this.sfx = {
      bgm: hasAudio('bgm') ? (this.sound.get('bgm') || this.sound.add('bgm', { loop: true, volume: 0.5 })) : null,
      collect: hasAudio('collect') ? this.sound.add('collect') : null,
      hit: hasAudio('hit') ? this.sound.add('hit') : null,
      horn: hasAudio('horn') ? this.sound.add('horn') : null,
      gameover: hasAudio('gameover') ? this.sound.add('gameover') : null,
      win: hasAudio('win') ? this.sound.add('win') : null
    };
    if (this.sfx.bgm && !this.sfx.bgm.isPlaying) this.sfx.bgm.play();

    // ---- Spawning ----
    this._worldObjects = [];
    this._scheduleSeed();

    // ---- Timer ----
    this._countEvt = this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        if (this.state.finished) return;
        this.state.timeLeft -= 1;
        if (this.state.timeLeft <= 0) this._finish(false);
      }
    });

    this._refreshUI();
  }

  update(_t, dtMs) {
    if (this.state.finished) return;
    const dt = dtMs / 1000;

    // Input
    const accelHeld = this.cursors.right.isDown || this.keys.D.isDown || this._mobile.right;
    const brakeHeld = this.cursors.left.isDown  || this.keys.A.isDown || this._mobile.left;

    if (Phaser.Input.Keyboard.JustDown(this.cursors.up) || Phaser.Input.Keyboard.JustDown(this.keys.W)) this._changeLane(-1);
    if (Phaser.Input.Keyboard.JustDown(this.cursors.down) || Phaser.Input.Keyboard.JustDown(this.keys.S)) this._changeLane(1);

    const actionPressed = Phaser.Input.Keyboard.JustDown(this.keys.SPACE) || this._justTappedAction;
    if (actionPressed) {
      this._justTappedAction = false;
      if (this.sfx.horn) this.sfx.horn.play();
      const st = this._currentStationUnderTrain();
      if (st && !st.served && this.state.speed <= this.rules.stopSpeed && !this.state.dwelling) {
        this.state.doorsOpen = !this.state.doorsOpen;
        if (this.state.doorsOpen) {
          this.state.dwelling = true;
          this.state.dwellUntil = this.time.now + this.rules.stationDwellSec * 1000;
          this._setDoorMessage('Doors OPEN', '#8cff98');
        } else {
          this.state.dwelling = false;
          this._setDoorMessage('Doors CLOSED', '#ffc28c');
        }
      }
    }

    // Speed integration
    if (accelHeld) this.state.speed = Math.min(this.rules.maxSpeed, this.state.speed + this.rules.accel * dt);
    if (brakeHeld) this.state.speed = Math.max(0, this.state.speed - this.rules.brake * dt);
    if (!accelHeld && !brakeHeld) this.state.speed = Math.max(0, this.state.speed - this.rules.friction * dt);
    if (this.state.dwelling && this.state.doorsOpen) this.state.speed = 0;

    // Parallax
    const dx = this.state.speed * dt;
    if (this.bgTS)     this.bgTS.tilePositionX     += dx * 0.15;
    if (this.trackBed) this.trackBed.tilePositionX += dx * 0.90;
    if (this.railsTS)  this.railsTS.tilePositionX  += dx * 1.00;

    if (dx > 0) {
      this._scrollGroup(this.signals, dx);
      this._scrollGroup(this.stations, dx);
      this._maybeScheduleMore();
    }

    // Dwell logic
    if (this.state.dwelling) {
      if (!this.state.doorsOpen || this.state.speed > this.rules.stopSpeed) {
        this.state.dwelling = false;
        this.ui.hint.setText('Dwell cancelled (keep doors open & stopped)');
      } else if (this.time.now >= this.state.dwellUntil) {
        const st = this._currentStationUnderTrain();
        if (st && !st.served) {
          st.served = true;
          const boarded = Phaser.Math.Between(this.rules.paxMin, this.rules.paxMax);
          this.state.passengersTotal += boarded;
          this._floatText(`+${boarded} passengers`, this.train.x, this.train.y - 56);

          this.state.stationsServed += 1;
          if (this.sfx.collect) this.sfx.collect.play();
          this.state.dwelling = false;
          this.state.doorsOpen = false;

          if (this.state.stationsServed >= this.rules.targetStations) {
            const off = this.state.passengersTotal;
            if (off > 0) this._floatText(`-${off} passengers`, this.train.x, this.train.y - 90, '#ff8a8a');
            this.state.passengersTotal = 0;
            this.ui.hint.setText('Terminal station — all passengers alighted');
            this._refreshUI();
            // small pause, then finish->WinScene
            this.time.delayedCall(350, () => this._finish(true));
          } else {
            this.ui.hint.setText('Station served! Proceed to next.');
          }
        } else {
          this.state.dwelling = false;
          this.state.doorsOpen = false;
        }
      }
    }

    // Signals
    this.signals.getChildren().forEach(sig => {
      if (sig.color === 'red' && sig.mode === 'prox' && !sig.proxTriggered) {
        if ((sig.x - this.train.x) <= this.rules.preSignalTriggerDist) {
          sig.proxTriggered = true;
          sig.greenAt = this.time.now + sig.greenDelay;
          if (sig.countText) sig.countText.setText('');
          else sig.countText = this.add.text(sig.x, sig.y - 52, '', { fontFamily: 'sans-serif', fontSize: 20, color: '#ffeb8a' }).setOrigin(0.5, 1).setDepth(2);
        }
      }

      if (sig.color === 'red' && sig.greenAt) {
        const remaining = sig.greenAt - this.time.now;
        if (remaining <= 0) {
          sig.color = 'green';
          this._updateSignalTint(sig);
          if (sig.countText) { sig.countText.destroy(); sig.countText = null; }
        } else if (sig.countText) {
          sig.countText.setText(`${Math.ceil(remaining / 1000)}s`);
        }
      }

      if (sig.countText) sig.countText.setPosition(sig.x, sig.y - 52);

      if (!sig.passed && sig.x <= this.train.x) {
        sig.passed = true;
        if (sig.color === 'red' && this.state.speed > 0) this._finish(false, 'Signal passed at RED');
      }
    });

    // Cleanup and UI
    this._cleanupGroup(this.signals);
    this._cleanupGroup(this.stations);
    this._refreshUI();
    this._updatePrompts();
  }

  _setDoorMessage(text, color = '#8cff98') {
    this.ui.doorMsg.setText(text).setColor(color).setAlpha(1);
    this.tweens.add({ targets: this.ui.doorMsg, alpha: 0, duration: 1500, ease: 'Sine.easeOut', delay: 300 });
  }

  _updateSignalTint(sig) { sig.setTint(sig.color === 'red' ? 0xff3b3b : 0x3bff6d); }

  _updatePrompts() {
    const st = this._currentStationUnderTrain();
    let msg = '';

    if (st && !st.served) {
      if (this.state.speed > this.rules.stopSpeed) msg = 'In station — Brake to stop (<= stop speed)';
      else if (!this.state.doorsOpen && !this.state.dwelling) msg = 'In station — Open your doors (press Action)';
      else if (this.state.doorsOpen && this.state.dwelling) {
        const sec = Math.max(0, Math.ceil((this.state.dwellUntil - this.time.now) / 1000));
        msg = `Doors OPEN — Boarding… ${sec}s`;
      } else if (!this.state.doorsOpen && this.state.dwelling) msg = 'Dwell cancelled — Open doors to board';
      else msg = 'In station — Close your doors when boarding completes';
    } else if (st && st.served) {
      msg = 'Station served — Proceed to next station';
    } else {
      msg = 'Maintain speed, obey signals, prepare for next station';
    }

    if (msg !== this._lastStationPrompt) {
      this.ui.stationHint.setText(msg);
      this._lastStationPrompt = msg;
    }
  }

  // ---------------- Helpers ----------------

  _makeMobileButtons(cfg) {
    const W = this.W, H = this.H;
    const mkBtn = (key, x, y, onDown, onUp) => {
      const b = this.add.image(x, y, key).setInteractive({ useHandCursor: true });
      b.setDisplaySize(140, 140).setDepth(60).setAlpha(0.85);
      b.on('pointerdown', () => { b.setScale(0.92); b.setAlpha(1.0); onDown(); });
      b.on('pointerup',   () => { b.setScale(1.0);  b.setAlpha(0.85); onUp(); });
      b.on('pointerout',  () => { b.setScale(1.0);  b.setAlpha(0.85); onUp(); });
      b.setScrollFactor(0);
      return b;
    };

    this.btnLeft  = mkBtn('btn_left', 160, H - 100, () => { this._mobile.left = true; },  () => { this._mobile.left = false; });
    this.btnRight = mkBtn('btn_right',490, H - 100, () => { this._mobile.right = true; }, () => { this._mobile.right = false; });
    this.btnAction= mkBtn('btn_action', this.W - 160, H - 100, () => { this._justTappedAction = true; }, () => {});
    if (!cfg.images?.left) this.btnLeft.setVisible(false);
    if (!cfg.images?.right) this.btnRight.setVisible(false);
    if (!cfg.images?.action) this.btnAction.setVisible(false);
  }

  _setupSwipeLanes() {
    let startY = null;
    this.input.on('pointerdown', (p) => { startY = p.y; });
    this.input.on('pointerup', (p) => {
      if (startY == null) return;
      const dy = p.y - startY;
      const TH = 30;
      if (dy <= -TH) this._changeLane(-1);
      if (dy >=  TH) this._changeLane(1);
      startY = null;
    });
  }

  _changeLane(dir) {
    const next = Phaser.Math.Clamp(this.state.laneIndex + dir, 0, this.lanes.length - 1);
    if (next !== this.state.laneIndex) {
      this.state.laneIndex = next;
      this.tweens.add({ targets: this.train, y: this.lanes[next], duration: 120, ease: 'Sine.easeOut' });
    }
  }

  _scheduleSeed() { for (let i = 0; i < 4; i++) this._spawnNextStretch(); }

  _maybeScheduleMore() {
    const farthestX = this._worldObjects.length ? Math.max(...this._worldObjects.map(o => o.x)) : -Infinity;
    if (farthestX < this.W * 2.0) this._spawnNextStretch();
  }

  _spawnNextStretch() {
    const gap = Phaser.Math.Between(this.rules.spawnSpacingMin, this.rules.spawnSpacingMax);
    const baseX = (this._worldObjects.length ? Math.max(...this._worldObjects.map(o => o.x)) : this.W) + gap;

    const color = this._decideSignalColor();
    this._spawnSignal(baseX - 260, color);

    if (Math.random() < 0.7) this._spawnStation(baseX);
  }

  _decideSignalColor() {
    this.state.nextIsRedCounter++;
    if (this.state.nextIsRedCounter >= this.rules.redEveryN) {
      this.state.nextIsRedCounter = 0;
      return 'red';
    }
    return Math.random() < this.rules.redChance ? 'red' : 'green';
  }

  _spawnSignal(x, color) {
    const y = this.trackBed.y - 70;
    const s = this.add.sprite(x, y, 'signal');
    s.setDisplaySize(40, 80).setDepth(-9);
    s.passed = false;
    s.color = color;

    if (color === 'red') {
      s.greenDelay = Phaser.Math.Between(1000, 5000);
      if (Math.random() < this.rules.proxRedChance) {
        s.mode = 'prox';
        s.proxTriggered = false;
        s.greenAt = 0;
        s.countText = this.add.text(s.x, s.y - 52, 'WAIT', { fontFamily: 'sans-serif', fontSize: 20, color: '#ffeb8a' }).setOrigin(0.5, 1).setDepth(2);
      } else {
        s.mode = 'timer';
        s.greenAt = this.time.now + s.greenDelay;
        s.countText = this.add.text(s.x, s.y - 52, '', { fontFamily: 'sans-serif', fontSize: 20, color: '#ffeb8a' }).setOrigin(0.5, 1).setDepth(2);
      }
    }

    this._updateSignalTint(s);
    this._worldObjects.push(s);
    this.signals.add(s);
  }

  _spawnStation(x) {
    const y = this.trackBed.y - 20;
    const stationKey =
      (this.textures.exists('station') && 'station') ||
      (this.textures.exists('platform') && 'platform');
    if (!stationKey) return;

    const st = this.add.sprite(x, y, stationKey);
    st.setDisplaySize(420, 38).setDepth(-5);
    st.served = false;

    this._worldObjects.push(st);
    this.stations.add(st);
  }

  _scrollGroup(group, dx) { group.getChildren().forEach(obj => { obj.x -= dx; }); }

  _cleanupGroup(group) {
    group.getChildren().forEach(obj => {
      if (obj.x < -200) {
        const idx = this._worldObjects.indexOf(obj);
        if (idx >= 0) this._worldObjects.splice(idx, 1);
        if (obj.countText) { obj.countText.destroy(); obj.countText = null; }
        obj.destroy();
      } else {
        if (obj.countText) obj.countText.setPosition(obj.x, obj.y - 52);
      }
    });
  }

  _currentStationUnderTrain() {
    let found = null;
    this.stations.getChildren().forEach(st => {
      if (st.served) return;
      const half = st.displayWidth * 0.5;
      if (this.train.x >= st.x - half && this.train.x <= st.x + half) found = st;
    });
    return found;
  }

  _floatText(text, x, y, color = '#a8ffb0') {
    const t = this.add.text(x, y, text, { fontFamily: 'sans-serif', fontSize: 26, color }).setOrigin(0.5).setDepth(60);
    this.tweens.add({ targets: t, y: y - 28, alpha: 0, duration: 900, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }

  _onDamageOrFault(_reason) {
    if (this.state.finished) return;
    if (this.sfx.hit) this.sfx.hit.play();
    this.state.hp -= 1;
    this.train.setTint(0xff6b6b);
    this.time.delayedCall(120, () => this.train.clearTint());
    if (this.state.hp <= 0) this._finish(false);
  }

  _refreshUI() {
    this.ui.speed.setText(`Speed: ${Math.round(this.state.speed)} px/s`);
    this.ui.time.setText(`Time: ${this.state.timeLeft}s`);
    this.ui.stat.setText(`Stations: ${this.state.stationsServed}/${this.rules.targetStations}`);
    this.ui.hp.setText(`HP: ${this.state.hp}${this.state.doorsOpen ? '  (Doors Open)' : ''}`);
    this.ui.pax.setText(`Passengers: ${this.state.passengersTotal}`);
  }

  // ====== ENDING / SCENE TRANSITION ======
  _finish(won, msg) {
    if (this.state.finished) return;
    this.state.finished = true;

    if (won && this.sfx.win) this.sfx.win.play();
    if (!won && this.sfx.gameover) this.sfx.gameover.play();
    if (this.sfx.bgm && this.sfx.bgm.isPlaying) this.sfx.bgm.stop();

    // store result for WinScene/GameOverScene to read
    this.registry.set('train_result', {
      won,
      stationsServed: this.state.stationsServed,
      passengers: this.state.passengersTotal,
      timeLeft: this.state.timeLeft,
      msg: msg || ''
    });

    const nextScene = won ? 'WinScene' : 'GameOverScene';

    // optional fade then start next scene
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start(nextScene);
    });
    this.cameras.main.fadeOut(350, 0, 0, 0);
  }

  shutdown() { this._teardown(); }
  destroy() { this._teardown(); }

  _teardown() {
    if (this._countEvt) { this._countEvt.remove(false); this._countEvt = null; }
    if (this.sfx?.bgm && this.sfx.bgm.isPlaying) { this.sfx.bgm.stop(); }
    this.signals?.getChildren()?.forEach(s => s.countText?.destroy());
    [this.signals, this.stations].forEach(g => {
      if (!g) return;
      g.getChildren().forEach(ch => ch?.destroy?.());
      g.clear(true);
    });
  }

  // ===== Rails fallback generator =====
  _buildRailsTexture() {
    const key = 'railsGen';
    if (this.textures.exists(key)) return key;

    const w = 128, h = 18;
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(0x9a7b4f, 1);
    for (let x = 0; x < w; x += 16) g.fillRect(x, 2, 10, h - 4);
    g.fillStyle(0xbfc5c9, 1);
    g.fillRect(0, 3, w, 4);
    g.fillRect(0, h - 7, w, 4);
    g.fillStyle(0x60666a, 1);
    g.fillRect(0, 3, w, 1);
    g.fillRect(0, h - 4, w, 1);
    g.generateTexture(key, w, h);
    g.destroy();
    return key;
  }
}
