export default class ProjEnemyScene extends Phaser.Scene {
    constructor() {
        super({ key: "ProjEnemyScene" });
        Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach((fn) => {
            if (typeof this[fn] === "function") this[fn] = this[fn].bind(this);
        });
        this.archer = null;
        this.enemyArcher = null;
        this.arrows = [];
        this.objects = [];
        this.enemyArrows = [];
        this.timer = 30;
        this.score = 0;
        this.missed = 0;
        this.timerText = null;
        this.scoreText = null;
        this.missedText = null;
        this.gameOver = false;
        this.cursors = null;
        this.mechanics = {};
        this.timers = [];
        this.inputListener = null;
        this.started = false;
        this.movingUp = false;
        this.movingDown = false;
        this.bgmSound = null;
        this.fireSound = null;
    }
    notifyParent(type, data) {
        if (window.parent !== window) {
            window.parent.postMessage({ type, ...data }, "*");
        }
    }

    preload() {
        const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));

        // Cross-origin & restart-safe
        if (this.load.setCORS) this.load.setCORS('anonymous');
        // if (this.textures.exists('eve')) this.textures.remove('eve');

        this.load.on('loaderror', (file) => {
            console.error('[Preload] Failed:', file?.key, file?.src);
        });

        // Helpers
        const parseQueryFrom = (str) => {
            try { return new URL(str, window.location.href).searchParams; }
            catch { return new URLSearchParams(''); }
        };
        const getParam = (name) => {
            const p1 = new URLSearchParams(window.location.search).get(name);
            if (p1 != null && p1 !== '') return p1;
            if (window.location.hash?.length > 1) {
                const p2 = new URLSearchParams(window.location.hash.slice(1)).get(name);
                if (p2 != null && p2 !== '') return p2;
            }
            if (document.referrer) {
                const p3 = parseQueryFrom(document.referrer).get(name);
                if (p3 != null && p3 !== '') return p3;
            }
            return null;
        };
        const resolveUrl = (u) => {
            if (!u) return null;
            if (/^(https?:)?\/\//i.test(u) || /^data:/i.test(u)) return u; // absolute/data:
            return `${basePath}/${u}`; // relative
        };
        const withBustIfParam = (u, hasParam) => {
            if (!u || !hasParam) return u;
            return `${u}${u.includes('?') ? '&' : '?'}cb=${Date.now()}`;
        };

        // Load config then queue assets
        this.load.json('levelConfig', `${basePath}/config.json`);
        this.load.once('filecomplete-json-levelConfig', () => {
            const cfg = this.cache.json.get('levelConfig') || {};
            const spritesheets = cfg.spritesheets || {};
            const sheets = cfg.sheets || {};
            const hero = sheets.hero || {};
            const eveCfg = spritesheets.eve || {};

            // Params (support ?main= or ?player= + optional ?fw & ?fh)
            const rawMain = getParam('main') || getParam('player') || '';
            const cleanMain = rawMain ? decodeURIComponent(rawMain).replace(/^"|"$/g, '') : '';
            const fwParam = getParam('fw');
            const fhParam = getParam('fh');

            // If a param is provided, we’re intentionally replacing the sheet.
            // To avoid stale frames, remove the old animation + texture first.
            if (cleanMain) {
                if (this.anims.exists('idle')) {
                    this.anims.remove('idle');
                }
                if (this.textures.exists('eve')) {
                    this.textures.remove('eve');
                }
            }

            // Decide EVE src (param → spritesheets.eve.url/path → sheets.hero.url → fallback)
            const chosenUrl =
                resolveUrl(cleanMain) ||
                resolveUrl(eveCfg.url || eveCfg.path) ||
                resolveUrl(hero.url) ||
                `${basePath}/assets/eve_spritesheet.png`;

            const frameWidth = Number(fwParam) || eveCfg.frameWidth || hero.frameWidth || 102;
            const frameHeight = Number(fhParam) || eveCfg.frameHeight || hero.frameHeight || 158;

            // Queue eve ONCE (cache-bust only when param used)
            this.load.spritesheet('eve', withBustIfParam(chosenUrl, !!cleanMain), {
                frameWidth,
                frameHeight,
            });

            // Queue other spritesheets EXCEPT eve (to avoid overwriting the param)
            for (const [key, s] of Object.entries(spritesheets)) {
                if (key === 'eve') continue;
                const src = s.url || s.path;
                if (!src) continue;
                this.load.spritesheet(key, resolveUrl(src), {
                    frameWidth: s.frameWidth,
                    frameHeight: s.frameHeight,
                });
            }

            // Images
            if (cfg.images1) {
                for (const [key, url] of Object.entries(cfg.images1)) {
                    this.load.image(key, resolveUrl(url));
                }
            }
            if (cfg.images2) {
                for (const [key, url] of Object.entries(cfg.images2)) {
                    this.load.image(key, resolveUrl(url));
                }
            }

            if (cfg.ui) {
                for (const [key, url] of Object.entries(cfg.ui)) {
                    this.load.image(key, resolveUrl(url));
                }
            }
            // Audio (use config if present; otherwise fallbacks you were using)
            const audio = cfg.audio || {};
            if (audio.bgm) this.load.audio('bgm', resolveUrl(audio.bgm));
            else this.load.audio('bgm', `${basePath}/assets/bgm.mp3`);
            if (audio.fire) this.load.audio('fire', resolveUrl(audio.fire));
            else this.load.audio('fire', `${basePath}/assets/fire.mp3`);

            console.debug('[Preload] eve queued:', chosenUrl, { frameWidth, frameHeight, viaParam: !!cleanMain });

            this.load.once('complete', () => {
                const tex = this.textures.get('eve');
                const src = tex?.getSourceImage ? tex.getSourceImage().src : '(no src)';
                console.log('[Preload] FINAL eve texture src:', src);
            });

            this.load.start();
        });
    }


    create() {
        const baseConfig = this.cache.json.get('levelConfig') || {};
        this.mechanics = baseConfig.mechanics || {};

        const width = this.sys.game.config.width;
        const height = this.sys.game.config.height;

        this.timer = this.mechanics.timer || 30;

        this.score = 0;
        this.missed = 0;
        this.gameOver = false;
        this.arrows = [];
        this.objects = [];
        this.enemyArrows = [];
        this.add.image(540, 960, 'background');
        this.add.image(540
            , 60, 'scorebar');

        this.timerText = this.add.text(70, 35, 'Time: 30', { font: '50px outfit', fill: 'white' });
        this.scoreText = this.add.text(450, 35, 'Score 0', { font: '50px outfit', fill: 'white' });
        this.missedText = this.add.text(800, 35, 'Miss: 0/5', { font: '50px outfit', fill: 'white' });
        this.anims.create({
            key: 'idle',
            frames: this.anims.generateFrameNumbers('eve', { start: 15, end: 15 }),
            frameRate: 4,
            repeat: -1
        });

        this.archer = this.add.sprite(40, height / 2 + 40, 'eve')
            .setOrigin(0.5, 1)
            .setScale(2);
        this.archer.play('idle');
        this.physics.add.existing(this.archer);
        this.archer.body.setCollideWorldBounds(true);
        this.archer.body.setImmovable(true);
        this.archer.body.setAllowGravity(false);

        this.enemyArcher = this.add.image(width - 40, 140, 'enemy')
            .setOrigin(0.5);
        this.physics.add.existing(this.enemyArcher);
        this.enemyArcher.body.setImmovable(true);
        this.enemyArcher.body.setAllowGravity(false);

        // Only create cursors (keyboard) in advance, but don't set up pointer listener or timers!
        this.cursors = this.input.keyboard.createCursorKeys();

        // Hide UI initially
        this.timerText.setVisible(false);
        this.scoreText.setVisible(false);
        this.missedText.setVisible(false);

        this.createHTPOverlay();
    }

    createHTPOverlay() {
        const width = this.sys.game.config.width;
        const height = this.sys.game.config.height;

        this.htpOverlay = this.add.container(width / 2, height / 2);
        const box = this.add.image(0, 0, 'htpbox');
        const htpText = this.add.text(+10, 0,
            "Hold upper-left: Move Up\n" +
            "Hold lower-left: Move Down\n" +
            "Tap right side: Fire Arrow\n" +
            "Shoot the falling bombs.\n" +
            "Avoid enemy arrows!\n" +
            "You lose if you miss too many bombs or\nget hit.", {
            font: '50px outfit',
            color: 'white',
            align: 'left',
            lineSpacing: 10,
        }).setOrigin(0.5);

        const playBtn = this.add.image(0, 640, 'playbtn').setInteractive({ useHandCursor: true });
        playBtn.on('pointerdown', () => this.startGame(), this);

        this.htpOverlay.add([box, htpText, playBtn]);
    }

    startGame() {
        this.started = true;
        // Play background music
        if (!this.bgmSound) {
            this.bgmSound = this.sound.add('bgm', { loop: true, volume: 0.5 });
        }
        this.bgmSound.play();


        // Destroy overlays if present
        if (this.htpOverlay) {
            this.htpOverlay.destroy();
            this.htpOverlay = null;
        }
        if (this.gameOverOverlay) {
            this.gameOverOverlay.destroy();
            this.gameOverOverlay = null;
        }
        if (this.winOverlay) {
            this.winOverlay.destroy();
            this.winOverlay = null;
        }

        // Show main UI
        this.timerText.setVisible(true);
        this.scoreText.setVisible(true);
        this.missedText.setVisible(true);

        // Reset game state variables
        this.gameOver = false;
        this.timer = this.mechanics.timer || 30;
        this.score = 0;
        this.missed = 0;

        // Reset UI text
        this.timerText.setText('Time: ' + this.timer);
        this.scoreText.setText('Score: ' + this.score);
        this.missedText.setText('Miss: ' + this.missed + '/' + (this.mechanics.maxMisses || 5));

        // Remove all remaining arrows, enemyArrows, objects
        if (Array.isArray(this.arrows)) this.arrows.forEach(a => a.destroy());
        if (Array.isArray(this.enemyArrows)) this.enemyArrows.forEach(a => a.destroy());
        if (Array.isArray(this.objects)) this.objects.forEach(o => o.destroy());
        this.arrows = [];
        this.enemyArrows = [];
        this.objects = [];

        // Reset player and enemy positions
        const width = this.sys.game.config.width;
        const height = this.sys.game.config.height;
        if (this.archer) {
            this.archer.x = 40;
            this.archer.y = height / 2 + 40;
            this.archer.play && this.archer.play('idle');
        }
        if (this.enemyArcher) {
            this.enemyArcher.x = width - 40;
            this.enemyArcher.y = 140;
        }

        // Cancel previous timers and input listener if any
        if (this.timers && this.timers.length) {
            this.timers.forEach(evt => evt && evt.remove());
        }
        this.timers = [];

        // Cancel previous pointer listeners (if any)
        if (this.inputListener) {
            this.input.off('pointerdown', this.inputListener);
            this.input.off('pointerup', this.inputListener);
            this.inputListener = null;
        }

        // --- SMOOTH TOUCH/MOUSE MOVEMENT ON HOLD ---
        this.movingUp = false;
        this.movingDown = false;

        // Pointer DOWN: begin moving or fire
        this.inputListener = (pointer) => {
            if (this.gameOver || !this.started) return;
            const width = this.sys.game.config.width;

            if (pointer.x > width / 2) {
                // Right half: fire arrow (single tap)
                this.shootArrow();
                this.movingUp = false;
                this.movingDown = false;
            } else {
                // Left half: hold for movement
                if (pointer.y < this.archer.y) {
                    this.movingUp = true;
                    this.movingDown = false;
                } else if (pointer.y > this.archer.y) {
                    this.movingUp = false;
                    this.movingDown = true;
                }
            }
        };
        this.input.on('pointerdown', this.inputListener, this);

        // Pointer UP or pointer OUT: stop movement
        this.input.on('pointerup', () => {
            this.movingUp = false;
            this.movingDown = false;
        }, this);
        this.input.on('pointerout', () => {
            this.movingUp = false;
            this.movingDown = false;
        }, this);

        // --- Start timers for gameplay ---
        this.timers.push(
            this.time.addEvent({
                delay: 1000, callback: () => {
                    if (!this.gameOver) {
                        this.timer--;
                        this.timerText.setText('Time: ' + this.timer);
                        if (this.timer <= 0) this.endGame(true);
                    }
                }, loop: true
            }),
            this.time.addEvent({
                delay: 1000, callback: () => {
                    if (!this.gameOver) this.spawnObject();
                }, loop: true
            }),
            this.time.addEvent({
                delay: 3000, callback: () => {
                    if (!this.gameOver) this.shootEnemyArrow();
                }, loop: true
            })
        );
    }



    shootArrow() {
        if (!this.fireSound) {
            this.fireSound = this.sound.add('fire', { volume: 1.0 });
        }
        this.fireSound.play();

        const arrow = this.add.rectangle(this.archer.x + 30, this.archer.y, 50, 6, 0x00ffff);
        this.physics.add.existing(arrow);
        arrow.body.setVelocityX(this.mechanics.arrowSpeed || 600);
        arrow.body.setAllowGravity(false);
        this.arrows.push(arrow);
    }

    shootEnemyArrow() {
        const eArrow = this.add.rectangle(this.enemyArcher.x - 30, this.enemyArcher.y, 50, 6, 0xff0000);
        this.physics.add.existing(eArrow);
        eArrow.body.setVelocityX(-(this.mechanics.enemyArrowSpeed || 400));
        eArrow.body.setAllowGravity(false);
        this.enemyArrows.push(eArrow);
    }

    spawnObject() {
        const width = this.sys.game.config.width;
        const x = Phaser.Math.Between(100, width - 60);
        const y = -50;

        const object = this.add.image(x, y, 'bomb')
            .setDisplaySize(60, 80)
            .setOrigin(0.5);

        this.physics.add.existing(object);
        // object.body.setCircle(30);
        object.body.setBounce(0.3);
        this.objects.push(object);
    }

    update() {
        if (!this.started || this.gameOver) return;
        const width = this.sys.game.config.width;
        const height = this.sys.game.config.height;

        // --- Keyboard movement (optional) ---
        if (this.cursors && this.cursors.up.isDown) {
            this.archer.y -= 5;
        } else if (this.cursors && this.cursors.down.isDown) {
            this.archer.y += 5;
        }

        // --- Smooth touch/mouse movement (on hold) ---
        if (this.movingUp) {
            this.archer.y -= 5;
        }
        if (this.movingDown) {
            this.archer.y += 5;
        }
        this.archer.y = Phaser.Math.Clamp(this.archer.y, 80, height - 80);

        // Enemy follows the player's Y
        const speed = 1.2;
        if (Math.abs(this.archer.y - this.enemyArcher.y) > 2) {
            if (this.archer.y > this.enemyArcher.y) this.enemyArcher.y += speed;
            else this.enemyArcher.y -= speed;
        }
        this.enemyArcher.y = Phaser.Math.Clamp(this.enemyArcher.y, 80, height - 80);

        // Remove out-of-bounds arrows
        this.arrows = this.arrows.filter(arrow => {
            if (arrow.x > width) { arrow.destroy(); return false; }
            return true;
        });

        this.enemyArrows = this.enemyArrows.filter(eArrow => {
            if (eArrow.x < 0) { eArrow.destroy(); return false; }
            if (Phaser.Geom.Intersects.RectangleToRectangle(eArrow.getBounds(), this.archer.getBounds())) {
                eArrow.destroy();
                this.endGame(false);
                return false;
            }
            return true;
        });

        this.objects = this.objects.filter((object) => {
            if (object.y > height + 50) {
                object.destroy();
                this.missed++;
                this.missedText.setText('Miss: ' + this.missed + '/5');
                if (this.missed >= (this.mechanics.maxMisses || 5)) this.endGame(false);
                return false;
            }

            for (let j = 0; j < this.arrows.length; j++) {
                if (Phaser.Math.Distance.Between(this.arrows[j].x, this.arrows[j].y, object.x, object.y) < 30) {
                    this.arrows[j].destroy(); object.destroy(); this.arrows.splice(j, 1);
                    this.score++;
                    this.scoreText.setText('Score: ' + this.score);
                    // WIN CHECK
                    if (this.score >= (this.mechanics.targetScore || 10)) {
                        this.endGame(true);
                    }
                    return false;
                }
            }
            return true;
        });
    }


    endGame(won) {
        if (this.bgmSound && this.bgmSound.isPlaying) {
            this.bgmSound.stop();
        }

        this.gameOver = true;
        this.timerText.setVisible(false);
        this.scoreText.setVisible(false);
        this.missedText.setVisible(false);

        // Stop input and timers
        if (this.inputListener) {
            this.input.off('pointerdown', this.inputListener);
            this.inputListener = null;
        }
        if (this.timers && this.timers.length) {
            this.timers.forEach(evt => evt && evt.remove());
        }
        this.timers = [];

        const width = this.sys.game.config.width;
        const height = this.sys.game.config.height;

        if (won) {
            this.showWinOverlay();
        } else {
            this.showGameOverOverlay();
        }
    }

    showGameOverOverlay() {
        const width = this.sys.game.config.width;
        const height = this.sys.game.config.height;
        this.gameOverOverlay = this.add.container(width / 2, height / 2);

        const box = this.add.image(0, 0, 'ovrbox');
        const txt = this.add.text(0, 0, "Try Again!", {
            font: '50px outfit', fill: '#fff'
        }).setOrigin(0.5);

        const replayBtn = this.add.image(0, 350, 'replay').setInteractive({ useHandCursor: true });
        replayBtn.on('pointerdown', () => {
            this.gameOverOverlay.destroy();
            this.scene.restart();
        });

        this.gameOverOverlay.add([box, txt, replayBtn]);
    }

    showWinOverlay() {
        const width = this.sys.game.config.width;
        const height = this.sys.game.config.height;
        this.winOverlay = this.add.container(width / 2, height / 2);

        const box = this.add.image(0, 0, 'lvlbox');
        const txt = this.add.text(0, 0, "YOU WIN!", {
            font: '50px outfit', fill: '#fff'
        }).setOrigin(0.5);

        const nextBtn = this.add.image(-240, 350, 'next').setInteractive({ useHandCursor: true });
        const replayBtn = this.add.image(240, 350, 'lvl_replay').setInteractive({ useHandCursor: true });

        nextBtn.on('pointerdown', () => {
            this.winOverlay.destroy();
            this.notifyParent('sceneComplete', { result: 'win' });
        });

        replayBtn.on('pointerdown', () => {
            this.winOverlay.destroy();
            this.scene.restart();
        });

        this.winOverlay.add([box, txt, nextBtn, replayBtn]);
    }
}
