// mechanics.js

/* ===========================
   Minimal defaults (used if config.json is missing keys)
   =========================== */
const DEFAULT_CFG = {
    assets: {
        images: {
            background: "assets/background.png",
            meteor: "assets/meteor.png",
            collectable: "assets/pod.png",
            solar: "assets/solar.png",
            htpbox: "assets/htpbox.png",
            playbtn: "assets/playbtn.png",
            ovrbox: "assets/ovrbox.png",
            replay: "assets/replay.png",
            lvlbox: "assets/lvlbox.png",
            next: "assets/next.png",
            lvl_replay: "assets/lvl_replay.png",
            scoreback: "assets/scoreback.png",
            // 🔑 new player image
            spaceship: "assets/spaceship.png",

            htpbg: "assets/htpbg.png",
            winbg: "assets/winbg.png",
            ovrbg: "assets/ovrg.png"
        },
        // ❌ no default spritesheets anymore – player is an image now
        spritesheets: {},
        audio: {
            music: "assets/audio/music.mp3",
            alert: "assets/audio/alert.mp3",
            hit: "assets/audio/hit.mp3",
            collect: "assets/audio/collect.mp3"
        }
    },
    mechanics: {
        surviveSeconds: 180,
        laserRange: 110,
        meteorSpawn: { min: 1.4, max: 2.4 },
        podSpawn: { min: 5.0, max: 8.0 },
        meteorSpeed: { min: 120, max: 220 },
        podSpeed: { min: 42, max: 68 },

        // New scoring / lives system
        lives: 4,
        targetScore: 100,
        meteorScore: 10,  // score per destroyed meteor
        podScore: 5       // optional bonus for pod, can be set in JSON
    },
    texts: {
        labels: {
            gameOver: "GAME OVER",
            levelComplete: "LEVEL COMPLETE",
            youWin: "You Win!",
            play: "PLAY",
            replay: "REPLAY",
            next: "NEXT",
            // 🔁 renamed to fit your wording (can be overridden from JSON)
            lives: "Shield",
            score: "Energy"
        },
        howToPlay: [
            "Destroy meteors to gain energy.",
            "Reach the target energy before shields are lost.",
            "Tap meteors to shoot lasers.",
            "Tap collectables to gain bonuses (optional)."
        ]
    }
};

/* Deep merge utility */
function deepMerge(target, source) {
    const out = Array.isArray(target) ? [...target] : { ...target };
    for (const k of Object.keys(source || {})) {
        if (source[k] && typeof source[k] === "object" && !Array.isArray(source[k])) {
            out[k] = deepMerge(out[k] || {}, source[k]);
        } else {
            out[k] = source[k];
        }
    }
    return out;
}

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

/* ===========================
   MechanicsScene (JSON-driven)
   =========================== */
export default class MechanicsScene extends Phaser.Scene {
    constructor() {
        super("MechanicsScene");

        this.cfg = null; // merged runtime config (DEFAULT_CFG + config.json)
        this.center = { x: 540, y: 960 };
        this.station = null;
        this.meteors = [];
        this.pods = [];
        this.meteorPool = [];
        this.podPool = [];
        this.graphics = null;

        // overlays / pause
        this.paused = false;
        this.overlay = null;

        this.ui = {};

        // new game state
        this.lives = 4;
        this.score = 0;
        this.targetScore = 100;

        this.timers = { survive: 60 * 3, meteor: 0, pod: 0 };

        this.sounds = {};
        this.lowAlertShown = false; // not used now, but harmless

        // particles
        this.particles = null;
        this.explosionEmitter = null;
    }

    /* ---------------- PRELOAD: load config.json, then queue assets it defines ---------------- */
    preload() {
        // 1) Load config.json first (paths are relative to index.html)
        this.load.json("gameCfg", "config.json");

        // If config.json fails, we'll just use DEFAULT_CFG in create()
        this.load.on("loaderror", (file) => {
            if (file && file.key === "gameCfg") {
                // No second-phase enqueue; create() will deep-merge defaults.
            }
        });

        // 2) When config arrives, normalize and enqueue assets from it, then start loader again
        this.load.once("filecomplete-json-gameCfg", () => {
            const userCfg = this.cache.json.get("gameCfg") || {};

            // Normalize: support either top-level or assets.* nesting (both will work)
            const normalizedAssets = {
                images: {
                    ...(userCfg.images || {}),
                    ...((userCfg.assets && userCfg.assets.images) || {}),
                    ...(userCfg.images1 || {}),
                    ...(userCfg.images2 || {}),
                    ...(userCfg.ui || {})
                },
                spritesheets: {
                    ...(userCfg.spritesheets || {}),
                    ...((userCfg.assets && userCfg.assets.spritesheets) || {})
                },
                audio: {
                    ...(userCfg.audio || {}),
                    ...((userCfg.assets && userCfg.assets.audio) || {})
                }
            };

            this.cfg = deepMerge(DEFAULT_CFG, {
                assets: normalizedAssets,
                mechanics: userCfg.mechanics || {},
                texts: userCfg.texts || {}
            });

            // Images
            Object.entries(this.cfg.assets.images || {}).forEach(([key, path]) => {
                this.load.image(key, path);
            });

            // Spritesheets (still supported if user sets them, but player doesn't use them)
            Object.entries(this.cfg.assets.spritesheets || {}).forEach(
                ([key, obj]) => {
                    if (obj && obj.path) {
                        this.load.spritesheet(key, obj.path, {
                            frameWidth: obj.frameWidth || 32,
                            frameHeight: obj.frameHeight || 32,
                            startFrame: obj.startFrame || 0,
                            endFrame: obj.endFrame ?? -1
                        });
                    }
                }
            );

            // Audio
            Object.entries(this.cfg.assets.audio || {}).forEach(([key, path]) => {
                this.load.audio(key, path);
            });

            // Kick second-phase load
            this.load.start();
        });
    }

    getM() {
        return this.cfg?.mechanics || DEFAULT_CFG.mechanics;
    }

    T(path, fallback = "") {
        const root = this.cfg?.texts || {};
        const parts = path.split(".");
        let cur = root;

        for (const p of parts) {
            if (cur && Object.prototype.hasOwnProperty.call(cur, p)) {
                cur = cur[p];
            } else {
                cur = undefined;
                break;
            }
        }
        return (cur !== undefined && cur !== null) ? cur : fallback;
    }

    getSound(key, cfg = {}) {
        try {
            if (this.sound && this.cache.audio.exists(key)) {
                return this.sound.add(key, cfg);
            }
        } catch (e) { }
        // no-op fallback (non-visual)
        return {
            play() { },
            stop() { },
            setLoop() { },
            setRate() { },
            setVolume() { }
        };
    }

    create() {
        // Finalize cfg if not set (e.g., config.json missing)
        if (!this.cfg) this.cfg = deepMerge(DEFAULT_CFG, {});

        // 🔁 RESET RUNTIME ARRAYS / POOLS ON EVERY RESTART
        this.meteors = [];
        this.pods = [];
        this.meteorPool = [];
        this.podPool = [];

        // also reset overlay refs & flags just to be safe
        this.overlay = null;
        this.gameOver = false;
        this.winShown = false;
        this.paused = false;

        // cache mechanics into simple locals
        const M = this.getM();
        this.timers.survive = M.surviveSeconds ?? 180;

        // lives/score from JSON (with defaults)
        this.lives = M.lives ?? 4;
        this.targetScore = M.targetScore ?? 100;
        this.score = 0;

        const W = this.scale.width,
            H = this.scale.height;
        this.center = { x: W / 2, y: H / 2 };

        // background
        if (this.textures.exists("background")) {
            const bg = this.add.image(W / 2, H / 2, "background");
            bg.setScale(Math.max(W / bg.width, H / bg.height)).setDepth(-1000);
        }

        // 🚀 player: spaceship image
        const playerKey = this.textures.exists("spaceship") ? "spaceship" : null;
        if (playerKey) {
            this.station = this.add.image(this.center.x, this.center.y, playerKey)
                .setDepth(1);
        } else {
            this.station = this.add.image(this.center.x, this.center.y, null);
        }

        // graphics + sounds
        this.graphics = this.add
            .graphics({ lineStyle: { width: 2, color: 0x9cc2ff, alpha: 0.85 } })
            .setDepth(5);

        const addSound = (k, cfg) =>
            (this.sounds[k] = this.getSound(k, cfg));
        addSound("music", { loop: true, volume: 0.35 });
        addSound("alert", { volume: 0.9 });
        addSound("hit", { volume: 0.8 });
        addSound("collect", { volume: 0.8 });
        this.sounds.music.play();

        // === EXPLOSION SETUP ===
        // === EXPLOSION SETUP ===
        const g = this.make.graphics({ x: 0, y: 0, add: false });
        g.fillStyle(0xffffff, 1);
        g.fillCircle(4, 4, 4);
        g.generateTexture("spark", 8, 8);
        g.destroy();

        // In Phaser 3.60, you create the emitter directly with add.particles(...)
        this.explosionEmitter = this.add
            .particles(0, 0, "spark", {
                on: false,
                speed: { min: 80, max: 360 },
                angle: { min: 0, max: 360 },
                scale: { start: 0.9, end: 0 },
                alpha: { start: 1, end: 0 },
                lifespan: { min: 350, max: 700 },
                quantity: 24,
                blendMode: "ADD",
                tint: [0xffffff, 0xfff1c2, 0xffc266, 0xff6666, 0x9cc2ff],
                gravityY: 0
            })
            .setDepth(60);


        // UI
        this.buildUI();
        this.updateLivesUI();
        this.updateScoreUI();

        // timers
        this.timers.meteor =
            this.time.now +
            Phaser.Math.Between(
                M.meteorSpawn.min * 1000,
                M.meteorSpawn.max * 1000
            );
        this.timers.pod =
            this.time.now + Phaser.Math.Between(M.podSpawn.min * 1000, M.podSpawn.max * 1000);

        // input
        this.input.on("pointerdown", (pointer) => this.handleTap(pointer));

        // start overlay
        this.pauseGame(true);
        this.showStartOverlay();

        // flags
        this.gameOver = false;
        this.winShown = false;
    }

    buildUI() {
        const W = this.scale.width;
        const pad = 20;

        // Horizontal row Y
        const rowY = pad + 70;

        // Positions for Shield (left) and Energy (right)
        const leftX = W / 2 - 350;
        const rightX = W / 2 + 350;

        // 🔳 background boxes behind Shield & Energy
        this.ui.livesBack = this.add.image(leftX, rowY, "scoreback").setDepth(69);

        this.ui.scoreBack = this.add.image(rightX, rowY, "scoreback").setDepth(69);
        // 👉 make Energy/Score background wider
        this.ui.scoreBack.setScale(1.2, 1); // increase X scale only

        // 🔳 background box behind Timer
        const timeY = rowY + 80;
        this.ui.timeBack = this.add.image(W / 2, timeY, "scoreback").setDepth(69);
        this.ui.timeBack.setScale(1.3, 1); // slightly wider than default

        // Shield (lives) – black text, centered on left scoreback
        this.ui.livesText = this.add.text(
            this.ui.livesBack.x,
            this.ui.livesBack.y,
            `${this.T("labels.lives", "Shield")}: ${this.lives}`,
            {
                fontSize: "50px",
                fontFamily: "Outfit",
                color: "#000000ff"
            }
        )
            .setOrigin(0.5)
            .setDepth(70);

        // Energy (score) – black text, centered on right (wider) scoreback
        this.ui.scoreText = this.add.text(
            this.ui.scoreBack.x,
            this.ui.scoreBack.y,
            "Score: 00/100",
            {
                fontSize: "50px",
                fontFamily: "Outfit",
                color: "#000000ff"
            }
        )
            .setOrigin(0.5)
            .setDepth(70);

        // Timer – black text, centered on its scoreback
        this.ui.timer = this.add.text(
            this.ui.timeBack.x,
            this.ui.timeBack.y,
            "03:00",
            {
                fontSize: "46px",
                fontFamily: "Outfit",
                color: "#000000ff"
            }
        )
            .setOrigin(0.5)
            .setDepth(70);
    }


    updateLivesUI() {
        if (this.ui.livesText) {
            this.ui.livesText.setText(
                `${this.T("labels.lives", "Shield")}: ${this.lives}`
            );
        }
    }

    updateScoreUI() {
        if (this.ui.scoreText) {
            const cur = String(this.score).padStart(2, "0");
            const tgt = this.targetScore;
            this.ui.scoreText.setText(
                `${this.T("labels.score", "Energy")}: ${cur}/${tgt}`
            );
        }
    }

    handleTap(pointer) {
        if (this.gameOver || this.paused) return;

        const pod = this.pods.find(
            (p) =>
                p.active &&
                Phaser.Math.Distance.Between(
                    pointer.x,
                    pointer.y,
                    p.sprite.x,
                    p.sprite.y
                ) < 36
        );
        if (pod) {
            this.collectPod(pod);
            return;
        }

        const meteor = this.findNearestMeteor(
            pointer.x,
            pointer.y,
            this.getM().laserRange
        );
        this.drawLaser(pointer.x, pointer.y);
        if (meteor) this.destroyMeteor(meteor, true);
    }

    drawLaser(tx, ty) {
        const sx = this.station.x,
            sy = this.station.y,
            g = this.graphics;
        g.clear();
        g.lineStyle(2, 0x9cc2ff, 0.9);
        g.beginPath();
        g.moveTo(sx, sy);
        g.lineTo(tx, ty);
        g.strokePath();
        this.time.delayedCall(90, () => g.clear());
    }

    findNearestMeteor(x, y, range) {
        let best = null,
            bestD = Infinity;
        for (const m of this.meteors) {
            if (!m.active) continue;
            const d = Phaser.Math.Distance.Between(
                x,
                y,
                m.sprite.x,
                m.sprite.y
            );
            if (d < range && d < bestD) {
                best = m;
                bestD = d;
            }
        }
        return best;
    }

    spawnMeteor() {
        const M = this.getM();
        const W = this.scale.width;
        const x = Phaser.Math.Between(80, W - 80),
            y = -40;
        const spd = Phaser.Math.Between(M.meteorSpeed.min, M.meteorSpeed.max);
        const angle = Phaser.Math.FloatBetween(
            (10 * Math.PI) / 180,
            (170 * Math.PI) / 180
        );
        const vx = Math.cos(angle) * 40,
            vy = spd;

        const sprite = this.getFromPool(this.meteorPool, "meteor");
        sprite.setPosition(x, y).setVisible(true).setActive(true).setDepth(2);
        if (sprite.setScale) sprite.setScale(1);
        this.meteors.push({ sprite, vx, vy, active: true });
    }

    spawnPod() {
        const M = this.getM();
        const H = this.scale.height,
            W = this.scale.width;
        const side = Phaser.Math.RND.pick(["left", "right"]);
        const x = side === "left" ? -40 : W + 40;
        const y = Phaser.Math.Between(180, H - 200);
        const spd = Phaser.Math.Between(M.podSpeed.min, M.podSpeed.max);
        const vx = side === "left" ? spd : -spd;
        const vy = Phaser.Math.FloatBetween(-10, 10);

        const sprite = this.getFromPool(this.podPool, "collectable");
        sprite.setPosition(x, y).setVisible(true).setActive(true).setDepth(2);

        this.pods.push({ sprite, vx, vy, active: true, ttl: 12000 });
    }

    getFromPool(pool, key) {
        let spr = pool.find((s) => !s.active);
        if (!spr) {
            spr = this.add.sprite(-9999, -9999, key);
            spr.active = false;
            pool.push(spr);
        }
        spr.active = true;
        return spr;
    }

    playExplosion(x, y) {
        if (this.explosionEmitter) this.explosionEmitter.explode(32, x, y);
        const ring = this.add
            .circle(x, y, 12, 0xffffff, 0.1)
            .setStrokeStyle(3, 0xffc266, 1)
            .setDepth(59);
        this.tweens.add({
            targets: ring,
            scale: { from: 1, to: 3 },
            alpha: { from: 0.9, to: 0 },
            duration: 450,
            ease: "Cubic.easeOut",
            onComplete: () => ring.destroy()
        });
        this.cameras.main.flash(60, 255, 240, 200);
    }

    destroyMeteor(meteor, byPlayer = false) {
        this.playExplosion(meteor.sprite.x, meteor.sprite.y);
        meteor.active = false;
        meteor.sprite
            .setVisible(false)
            .setActive(false)
            .setPosition(-9999, -9999);

        if (byPlayer) {
            const M = this.getM();
            this.score += M.meteorScore ?? 10;
            this.updateScoreUI();
            if (this.score >= this.targetScore && !this.winShown) {
                this.winShown = true;
                this.endGame(true);
            }
        }
    }

    collectPod(pod) {
        const M = this.getM();
        pod.active = false;
        pod.sprite
            .setVisible(false)
            .setActive(false)
            .setPosition(-9999, -9999);

        // ✅ Always add podScore (default 5 if not set)
        const gain = (typeof M.podScore === "number") ? M.podScore : 5;
        this.score += gain;
        this.updateScoreUI();

        if (this.score >= this.targetScore && !this.winShown) {
            this.winShown = true;
            this.endGame(true);
        }

        this.sounds.collect.play();
    }



    meteorHitsStation(meteor) {
        this.playExplosion(meteor.sprite.x, meteor.sprite.y);
        this.cameras.main.shake(120, 0.003);
        this.sounds.hit.play();

        meteor.active = false;
        meteor.sprite
            .setVisible(false)
            .setActive(false)
            .setPosition(-9999, -9999);

        this.lives = Math.max(0, this.lives - 1);
        this.updateLivesUI();

        if (this.lives <= 0 && !this.gameOver) {
            this.endGame(false);
        }
    }

    createOverlayRoot(depth = 999) {
        if (this.overlay) this.overlay.destroy();
        const W = this.scale.width,
            H = this.scale.height;
        const root = this.add.container(0, 0).setDepth(depth);
        const dim = this.add
            .rectangle(W / 2, H / 2, W, H, 0x000000, 0.6)
            .setInteractive();
        root.add(dim);
        this.overlay = root;
        return root;
    }

    createImageButton(
        key,
        x,
        y,
        onClick,
        label = "BTN",
        w = 240,
        h = 90,
        depth = 1000
    ) {
        if (this.textures.exists(key)) {
            const img = this.add
                .image(x, y, key)
                .setDepth(depth)
                .setInteractive({ useHandCursor: true });
            img.on("pointerdown", () => onClick && onClick());
            return img;
        } else {
            const rect = this.add
                .rectangle(0, 0, w, h, 0x2a3a6a, 1)
                .setStrokeStyle(2, 0x9cc2ff);
            const txt = this.add
                .text(0, 0, label, {
                    fontSize: "24px",
                    color: "#cfe2ff",
                    fontFamily: "Outfit"
                })
                .setOrigin(0.5);
            const btn = this.add.container(x, y, [rect, txt]).setDepth(depth);
            btn.setSize(w, h).setInteractive();
            btn.on("pointerdown", () => onClick && onClick());
            return btn;
        }
    }


    createPanel(
        key,
        x,
        y,
        fallbackText = "PANEL",
        w = 620,
        h = 420,
        depth = 1000
    ) {
        if (this.textures.exists(key))
            return this.add.image(x, y, key).setDepth(depth);
        const panel = this.add
            .rectangle(0, 0, w, h, 0x0e1a33, 1)
            .setStrokeStyle(2, 0x4a6cd4);
        const label = this.add
            .text(0, -h / 2 + 24, fallbackText, {
                fontSize: "22px",
                color: "#b7c9ff",
                fontFamily: "Outfit"
            })
            .setOrigin(0.5, 0);
        return this.add.container(x, y, [panel, label]).setDepth(depth);
    }


    pauseGame(p = true) {
        this.paused = !!p;
    }
    resumeGame() {
        this.paused = false;
    }

    showStartOverlay() {
        const W = this.scale.width, H = this.scale.height;
        const root = this.createOverlayRoot(990);

        // 🔳 HTP background
        let htpBg = null;
        if (this.textures.exists("htpbg")) {
            htpBg = this.add.image(W / 2, H / 2, "htpbg");
            htpBg.setScale(Math.max(W / htpBg.width, H / htpBg.height));
        }

        const box = this.createPanel(
            "htpbox",
            W / 2,
            H * 0.55 - 300,
            this.T("labels.howToPlayTitle", "HOW TO PLAY")
        ).setScale(0.55, 0.8);

        // Prefer texts.howToPlay array; fall back to DEFAULT_CFG
        const linesFromCfg = this.cfg?.texts?.howToPlay;
        const htpLines = Array.isArray(linesFromCfg) && linesFromCfg.length
            ? linesFromCfg
            : DEFAULT_CFG.texts.howToPlay;

        // Main how-to-play text
        const text = this.add.text(
            W / 2,
            H * 0.48 - 400,
            htpLines.join("\n"),
            {
                fontSize: "62px",
                fontFamily: "Outfit",
                color: "#cfe2ff",
                align: "left",
                wordWrap: { width: 580 }
            }
        ).setOrigin(0.5);

        // ---------- ICON ROW: Control / Hit / Collect ----------
        const rowY = H * 0.48 - 80;
        const spacing = 260;
        const centerX = W / 2;

        const controlX = centerX - spacing;
        const hitX = centerX;
        const collectX = centerX + spacing;

        const controlIcon = this.add.image(controlX, rowY - 100, "spaceship")
            .setOrigin(0.5)
            .setDepth(1001)
            .setScale(0.8);

        const controlLabel = this.add.text(controlX, rowY + 90, "Control", {
            fontSize: "42px",
            fontFamily: "Outfit",
            color: "#cfe2ff"
        }).setOrigin(0.5).setDepth(1001);

        const hitIcon = this.add.image(hitX, rowY - 100, "meteor")
            .setOrigin(0.5)
            .setDepth(1001)
            .setScale(0.9);

        const hitLabel = this.add.text(hitX, rowY + 90, "Hit", {
            fontSize: "42px",
            fontFamily: "Outfit",
            color: "#cfe2ff"
        }).setOrigin(0.5).setDepth(1001);

        const collectIcon = this.add.image(collectX, rowY - 100, "collectable")
            .setOrigin(0.5)
            .setDepth(1001)
            .setScale(0.9);

        const collectLabel = this.add.text(collectX, rowY + 90, "Collect", {
            fontSize: "42px",
            fontFamily: "Outfit",
            color: "#cfe2ff"
        }).setOrigin(0.5).setDepth(1001);

        const playBtn = this.createImageButton(
            "playbtn",
            W / 2,
            H * 0.75 - 200,
            () => {
                if (this.overlay) {
                    this.overlay.destroy();
                    this.overlay = null;
                }
                this.resumeGame();
            },
            this.T("labels.play", "PLAY")
        );

        const toAdd = [
            box,
            text,
            controlIcon,
            controlLabel,
            hitIcon,
            hitLabel,
            collectIcon,
            collectLabel,
            playBtn
        ];
        if (htpBg) {
            // ensure bg is above dim but behind UI
            root.add([htpBg, ...toAdd]);
        } else {
            root.add(toAdd);
        }
    }



    showGameOverOverlay() {
        const W = this.scale.width, H = this.scale.height;
        const root = this.createOverlayRoot(990);

        // 🔳 Game Over background
        let ovrBg = null;
        if (this.textures.exists("ovrbg")) {
            ovrBg = this.add.image(W / 2, H / 2, "ovrbg");
            ovrBg.setScale(Math.max(W / ovrBg.width, H / ovrBg.height));
        }

        const box = this.createPanel(
            "ovrbox",
            W / 2,
            H / 2,
            this.T("labels.gameOver", "GAME OVER"),
        ).setScale(0.55, 0.8);

        const title = this.add.text(
            W / 2,
            H / 2 - 130,
            this.T("labels.gameOver", "GAME OVER"),
            {
                fontSize: "70px",
                fontFamily: "Outfit",
                color: "#ffffff",
                align: "center"
            }
        ).setOrigin(0.5);

        const stats = this.add.text(
            W / 2,
            H / 2 + 10,
            `${this.T("labels.score", "Energy")}: ${this.score}/${this.targetScore}\n${this.T("labels.lives", "Shield")}: ${this.lives}`,
            {
                fontSize: "50px",
                fontFamily: "Outfit",
                color: "#fefeffff",
                align: "center"
            }
        ).setOrigin(0.5);

        const replayBtn = this.createImageButton(
            "replay",
            W / 2,
            H / 2 + 500,
            () => {
                if (this.sounds.music && this.sounds.music.stop) {
                    this.sounds.music.stop();
                }
                this.scene.restart();
            },
            this.T("labels.replay", "REPLAY")
        );

        const toAdd = [box, title, stats, replayBtn];
        if (ovrBg) {
            root.add([ovrBg, ...toAdd]);
        } else {
            root.add(toAdd);
        }

        this.pauseGame(true);
    }



    showWinOverlay() {
        const W = this.scale.width, H = this.scale.height;
        const root = this.createOverlayRoot(990);

        // 🔳 Win background
        let winBg = null;
        if (this.textures.exists("winbg")) {
            winBg = this.add.image(W / 2, H / 2, "winbg");
            winBg.setScale(Math.max(W / winBg.width, H / winBg.height));
        }

        const box = this.createPanel(
            "lvlbox",
            W / 2,
            H / 2,
            this.T("labels.levelComplete", "LEVEL COMPLETE"),
        ).setScale(0.55);

        const text = this.add.text(
            W / 2,
            H / 2,
            `${this.T("labels.youWin", "You Win!")}`,
            {
                fontSize: "70px",
                fontFamily: "Outfit",
                color: "#e7e9ecff",
                align: "center"
            }
        ).setOrigin(0.5);

        const nextBtn = this.createImageButton(
            "next",
            W / 2 + 235,
            H / 2 + 330,
            () => this.notifyParent("sceneComplete", { result: "win" }),
            this.T("labels.next", "NEXT")
        );
        const replayBtn = this.createImageButton(
            "lvl_replay",
            W / 2 - 235,
            H / 2 + 330,
            () => {
                if (this.sounds.music && this.sounds.music.stop) {
                    this.sounds.music.stop();
                }
                this.scene.restart();
            },
            this.T("labels.replay", "REPLAY")
        );

        const toAdd = [box, text, nextBtn, replayBtn];
        if (winBg) {
            root.add([winBg, ...toAdd]);
        } else {
            root.add(toAdd);
        }

        this.pauseGame(true);
    }


    notifyParent(type, data) {
        if (window.parent !== window) {
            window.parent.postMessage({ type, ...data }, "*");
        }
    }

    update(time, delta) {
        const dt = delta / 1000;
        if (this.gameOver || this.paused) return;

        const M = this.getM();

        // spawns
        if (time >= this.timers.meteor) {
            this.spawnMeteor();
            this.timers.meteor =
                time +
                Phaser.Math.Between(
                    M.meteorSpawn.min * 1000,
                    M.meteorSpawn.max * 1000
                );
        }
        if (time >= this.timers.pod) {
            this.spawnPod();
            this.timers.pod =
                time +
                Phaser.Math.Between(M.podSpawn.min * 1000, M.podSpawn.max * 1000);
        }

        // meteors
        const H = this.scale.height;
        for (const m of this.meteors) {
            if (!m.active) continue;
            m.sprite.x += m.vx * dt;
            m.sprite.y += m.vy * dt;
            const d = Phaser.Math.Distance.Between(
                m.sprite.x,
                m.sprite.y,
                this.station.x,
                this.station.y
            );
            if (d < 85) {
                this.meteorHitsStation(m);
                continue;
            }
            if (m.sprite.y > H + 80) {
                m.active = false;
                m.sprite
                    .setActive(false)
                    .setVisible(false)
                    .setPosition(-9999, -9999);
            }
        }

        // pods
        const W = this.scale.width;
        for (const p of this.pods) {
            if (!p.active) continue;
            p.sprite.x += p.vx * dt;
            p.sprite.y += p.vy * dt;
            p.ttl -= delta;
            if (
                p.ttl <= 0 ||
                p.sprite.x < -100 ||
                p.sprite.x > W + 100
            ) {
                p.active = false;
                p.sprite
                    .setActive(false)
                    .setVisible(false)
                    .setPosition(-9999, -9999);
            }
        }

        // timer-based lose condition (optional)
        this.timers.survive = Math.max(0, this.timers.survive - dt);
        if (this.ui.timer) {
            this.ui.timer.setText(this.formatTime(this.timers.survive));
        }
        if (this.timers.survive <= 0 && !this.gameOver && !this.winShown) {
            if (this.score < this.targetScore) {
                this.endGame(false);
            } else {
                this.endGame(true);
            }
        }
    }

    formatTime(sec) {
        const s = Math.ceil(sec);
        const m = Math.floor(s / 60);
        const r = s % 60;
        return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
    }

    endGame(win) {
        this.gameOver = true;
        this.pauseGame(true);
        this.time.delayedCall(50, () => {
            if (win) this.showWinOverlay();
            else this.showGameOverOverlay();
        });
    }
}
