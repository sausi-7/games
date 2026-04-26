export const SCREEN_WIDTH = 1920;
export const SCREEN_HEIGHT = 1080;

// Define all functions at the top to ensure they are available
function updateEnemyMovement(scene) {
  scene.enemies.getChildren().forEach(enemy => {
    if (!enemy.active) return;

    // Keep them confined to the right half
    enemy.x = Phaser.Math.Clamp(enemy.x, SCREEN_WIDTH / 2, SCREEN_WIDTH);
    enemy.y = Phaser.Math.Clamp(enemy.y, 0, SCREEN_HEIGHT);
  });
}
function notifyParent(type, data) {
  if (window.parent !== window) {
    window.parent.postMessage({ type, ...data }, "*");
  }
}

function hitEnemy(bullet, enemy) {
  if (!bullet.active || !enemy.active || bullet.hasHit) return;
  bullet.hasHit = true;
  bullet.destroy();

  // Ensure enemy HP is properly initialized
  if (typeof enemy.hp !== 'number' || isNaN(enemy.hp)) {
    console.warn(`Invalid enemy HP: ${enemy.hp}, setting to 2`);
    enemy.hp = 2;
  }

  enemy.hp -= 1;
  console.log(`Enemy hit, HP remaining: ${enemy.hp}`);

  if (enemy.hp <= 0) {
    enemy.destroy();
    console.log('Enemy destroyed');
  }
}


function spawnEnemy(scene) {
  // only spawn if boss is alive, etc…
  if (!scene.boss?.active) return;

  const maxEnemies = 4;
  const activeCount = scene.enemies.getChildren().filter(e => e.active).length;
  if (activeCount >= maxEnemies) return;

  if (!scene.textures.exists('enemy')) {
    console.error('Enemy texture not loaded');
    return;
  }

  // Spawn at boss's position
  const spawnX = scene.boss.x;
  const spawnY = scene.boss.y;

  const enemy = scene.enemies.get(spawnX, spawnY, 'enemy');
  if (!enemy) {
    console.error('Failed to get enemy from group');
    return;
  }

  enemy.enableBody(true, spawnX, spawnY, true, true);
  enemy.body.setAllowGravity(false);

  // Set random velocity for movement
  const speedX = Phaser.Math.Between(-250, 250); // Random horizontal direction
  const speedY = Phaser.Math.Between(-250, 250); // Random vertical direction
  enemy.body.setVelocityX(speedX);
  enemy.body.setVelocityY(speedY);

  // They’ll bounce but will be clamped in updateEnemyMovement
  enemy.body.setCollideWorldBounds(true);
  enemy.body.setBounce(1, 0);

  enemy.hp = 2;

  // after enemy.hp = 2; and your blink tween…
  scene.tweens.add({
    targets: enemy,
    scaleX: 1.13,
    scaleY: 1.13,
    duration: 500,
    yoyo: true,
    repeat: -1
  });


  // Add blinking effect for 200ms
  scene.tweens.add({
    targets: enemy,
    alpha: 0,
    duration: 100, // 100ms per blink (on/off)
    repeat: 1, // Two toggles (off -> on -> off -> on) for 200ms total
    yoyo: true, // Toggle back and forth
    onStart: () => {
      enemy.setAlpha(1); // Ensure enemy starts visible
    },
    onComplete: () => {
      enemy.setAlpha(1); // Ensure enemy ends visible
    }
  });
}

function fireBullet(scene, targetX, targetY) {
  const bullet = scene.physics.add.sprite(scene.hero.x, scene.hero.y, 'hbullet');
  bullet.hasHit = false;
  bullet.body.setSize(20, 20);
  scene.heroBullets.add(bullet);

  const angle = Phaser.Math.Angle.Between(scene.hero.x, scene.hero.y, targetX, targetY);
  const speed = 2800;
  bullet.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);

  // Play hero fire sound
  if (scene.sound.get('herofiresound')) {
    scene.sound.play('herofiresound');
  } else {
    console.warn('Hero fire sound not loaded');
  }
}

function enemiesFire(scene) {
  const activeEnemies = scene.enemies.getChildren().filter(enemy => enemy.active);
  if (activeEnemies.length === 0) return;

  // Randomly select 1 or 2 enemies to fire
  const numToFire = Phaser.Math.Between(1, Math.min(2, activeEnemies.length));
  const enemiesToFire = Phaser.Utils.Array.Shuffle(activeEnemies).slice(0, numToFire);

  enemiesToFire.forEach(enemy => {
    const bullet = scene.physics.add.sprite(enemy.x, enemy.y, 'ebullet');
    bullet.hasHit = false;
    scene.enemyBullets.add(bullet);

    const target = { x: 100, y: Phaser.Math.Between(100, SCREEN_HEIGHT - 100) };
    const bulletAngle = Phaser.Math.Angle.Between(enemy.x, enemy.y, target.x, target.y);
    const bulletSpeed = 2000;
    bullet.setVelocity(Math.cos(bulletAngle) * bulletSpeed, Math.sin(bulletAngle) * bulletSpeed);

    // Play enemy fire sound
    if (scene.sound.get('enemyfiresound')) {
      scene.sound.play('enemyfiresound');
    } else {
      console.warn('Enemy fire sound not loaded');
    }
  });
}

function bossMoveAndFire(scene) {
  if (!scene.boss?.active || !scene.hero?.active) return;

  // Fire boss bullet
  const bullet = scene.physics.add.sprite(scene.boss.x, scene.boss.y, 'bbullet');
  bullet.hasHit = false;
  scene.bossBullets.add(bullet);

  const target = { x: 100, y: Phaser.Math.Between(100, SCREEN_HEIGHT - 100) };
  const angle = Phaser.Math.Angle.Between(bullet.x, bullet.y, target.x, target.y);
  bullet.setVelocity(Math.cos(angle) * 3000, Math.sin(angle) * 3000);
  console.log('Boss bullet fired:', { x: bullet.x, y: bullet.y, targetX: target.x, targetY: target.y });

  // Play boss fire sound
  if (scene.sound.get('bossfiresound')) {
    scene.sound.play('bossfiresound');
  } else {
    console.warn('Boss fire sound not loaded');
  }

  // Store boss's original position
  if (!scene.boss.originalX || !scene.boss.originalY) {
    scene.boss.originalX = scene.boss.x;
    scene.boss.originalY = scene.boss.y;
  }

  // Schedule boss charge after 3 seconds if hero is "up"
  if (!scene.boss.isCharging && scene.hero.y < SCREEN_HEIGHT / 2) {
    scene.boss.isCharging = false;
    scene.time.delayedCall(3000, () => {
      if (scene.boss && scene.boss.active && scene.hero && scene.hero.active) {
        scene.boss.isCharging = true;
        scene.boss.setTexture('boss2');
        scene.boss.setAngle(-40); // Set boss angle to -40 degrees during charge
        const chargeSpeed = 1300;
        const angleToHero = Phaser.Math.Angle.Between(scene.boss.x, scene.boss.y, scene.hero.x, scene.hero.y);
        scene.boss.body.setVelocity(Math.cos(angleToHero) * chargeSpeed, Math.sin(angleToHero) * chargeSpeed);

        // Return to original position after 2 seconds or on collision
        scene.time.delayedCall(2000, () => {
          if (scene.boss && scene.boss.active) {
            scene.boss.isCharging = false;
            scene.boss.setTexture('boss');
            scene.boss.setAngle(0); // Reset angle
            const returnSpeed = 2000;
            const angleToOrigin = Phaser.Math.Angle.Between(scene.boss.x, scene.boss.y, scene.boss.originalX, scene.boss.originalY);
            scene.boss.body.setVelocity(Math.cos(angleToOrigin) * returnSpeed, Math.sin(angleToOrigin) * returnSpeed);
            // Stop movement when close to original position
            scene.time.delayedCall(200, () => {
              if (scene.boss && scene.boss.active) {
                scene.boss.body.setVelocity(0, 0);
                scene.boss.x = scene.boss.originalX;
                scene.boss.y = scene.boss.originalY;
              }
            });
          }
        });
      }
    });
  }
}

function hitBoss(bullet, boss, scene) {
  if (!bullet.active || !boss.active || bullet.hasHit) return;
  bullet.hasHit = true;
  bullet.destroy();

  // Sanitize HP
  if (typeof boss.hp !== 'number' || isNaN(boss.hp)) {
    console.warn(`Invalid boss HP: ${boss.hp}, setting to 200`);
    boss.hp = 200;
  }

  boss.hp = Math.max(0, (typeof boss.hp === 'number' && !isNaN(boss.hp) ? boss.hp : 200) - 10);

  if (boss.hp <= 0) {
    // Just deactivate the boss here—don’t call win()
    scene.tweens.killTweensOf(boss);

    // reset scale just in case
    boss.setScale(1);
    boss.setActive(false);
    boss.setVisible(true);
    boss.setAngle(95);
    if (boss.angle === 95) {
      boss.body.setOffset(100, 100);
      boss.body.setSize(100, 330);
    }
    // scene.time.removeAllEvents();

    // Check if there are any active enemies
    const activeEnemies = scene.enemies.getChildren().filter(enemy => enemy.active);
    if (activeEnemies.length === 0) {
      // No enemies left, trigger win
      if (scene.hero) {
        // scene.hero.setActive(false);
        // scene.hero.setVisible(false);
      }
      win(scene);
    } else {
      console.log(`Boss defeated, but ${activeEnemies.length} enemies remain`);
    }
  }
}

function hitHero(hero, bullet, scene) {
  if (!bullet.active || !hero.active || bullet.hasHit) return;
  bullet.hasHit = true;
  bullet.destroy();
  hero.hp -= 20;

  // Play hero damage sound
  if (scene.sound.get('herodamagesound')) {
    scene.sound.play('herodamagesound');
  } else {
    console.warn('Hero damage sound not loaded');
  }

  // Add screen shake
  scene.cameras.main.shake(200, 0.01); // 200ms shake with intensity 0.01

  // Trigger device vibration (if supported)
  if (navigator.vibrate) {
    navigator.vibrate(200); // Vibrate for 200ms
    console.log('Device vibration triggered');
  } else {
    console.log('Vibration API not supported');
  }

  if (hero.hp <= 0) {
    hero.destroy();
    gameovr(scene);
    scene.time.removeAllEvents();
  }
}

function bossHitHero(boss, hero, scene) {
  if (!boss.active || !hero.active || !boss.isCharging) return;
  hero.hp = Math.max(0, hero.hp - 40);
  console.log(`Boss hit hero, hero HP: ${hero.hp}`);

  // Play hero damage sound
  if (scene.sound.get('herodamagesound')) {
    scene.sound.play('herodamagesound');
  } else {
    console.warn('Hero damage sound not loaded');
  }

  // Immediately return boss to original position
  boss.isCharging = false;
  boss.setTexture('boss');
  boss.setAngle(0); // Reset angle
  const returnSpeed = 400;
  const angleToOrigin = Phaser.Math.Angle.Between(boss.x, boss.y, boss.originalX, boss.originalY);
  boss.body.setVelocity(Math.cos(angleToOrigin) * returnSpeed, Math.sin(angleToOrigin) * returnSpeed);
  // Stop movement when close to original position
  scene.time.delayedCall(2000, () => {
    if (boss && boss.active) {
      boss.body.setVelocity(0, 0);
      boss.x = boss.originalX;
      boss.y = boss.originalY;
    }
  });
}

function gameovr(scene) {
  // Stop background music
  if (scene.sound.get('bgm')) {
    scene.sound.stopByKey('bgm');
    console.log('Background music stopped on game over');
  }

  // Disable input events to prevent firing bullets
  scene.input.off('pointerdown');
  scene.input.keyboard.off('keydown-SPACE');
  if (scene.bossHPImage) {
    scene.bossHPImage.setTexture('bosshp6');
  }
  if (scene.heroHPImage) {
    scene.heroHPImage.setTexture('herohp6');
  }

  // Destroy all enemies and bullets
  scene.enemies.getChildren().forEach(enemy => enemy.destroy());
  scene.heroBullets.getChildren().forEach(bullet => bullet.destroy());
  scene.enemyBullets.getChildren().forEach(bullet => bullet.destroy());
  scene.bossBullets.getChildren().forEach(bullet => bullet.destroy());

  // Destroy the boss if it exists
  if (scene.boss && scene.boss.active) {
    scene.boss.destroy();
  }

  scene.input.off('pointerdown');

  // Clear all timed events to prevent further spawning or firing
  scene.time.removeAllEvents();

  // Display game over UI
  const config = scene.cache.json.get('levelConfig');
  const gameOverText = config?.text?.gameOver || 'Game Over';
  scene.add.image(960, 500, 'gameovrbox').setOrigin(0.5).setDepth(10);
  scene.add.text(990, 500, gameOverText, { font: 'bold 70px outfit', color: '#fff' }).setOrigin(0.5).setDepth(12);
  const restartButton = scene.add.image(960, 700, 'restartbtn').setInteractive().setOrigin(0.5).setDepth(11);

  restartButton.on('pointerdown', () => {
    scene.scene.restart();
    scene.children.list.forEach(child => child.destroy());
    scene.isGameStarted = false;
    restartButton.destroy();
  });
}

function win(scene) {
  // Stop background music
  // if (scene.sound.get('bgm')) {
  //   scene.sound.stopByKey('bgm');
  //   console.log('Background music stopped on win');
  // }

  // 1) Kill every enemy
  if (scene.enemies) {
    scene.enemies.getChildren().forEach(enemy => {
      // if you added per‐enemy timers, remove them too
      if (enemy.wanderEvent) enemy.wanderEvent.remove(false);
      if (enemy.fireEvent) enemy.fireEvent.remove(false);
      enemy.destroy();
    });
  }

  // 2) Destroy all bullets groups
  [scene.heroBullets, scene.enemyBullets, scene.bossBullets].forEach(group => {
    if (!group) return;
    group.getChildren().forEach(bullet => bullet.destroy());
  });

  // 3) Stop all timed events (spawning, firing, boss loops…)
  scene.time.removeAllEvents();

  // 4) Set boss HP image to bosshp6 and angle to 80 degrees
  if (scene.bossHPImage) {
    scene.bossHPImage.setTexture('bosshp6');
  }
  if (scene.boss) {
    scene.boss.setAngle(95);
    if (scene.boss.angle === 95) {
      scene.boss.body.setOffset(100, 100);
      scene.boss.body.setSize(100, 330);
    }
  }

  // 5) Show Level Complete UI
  const config = scene.cache.json.get('levelConfig');
  // const levelCompletedText =  'Level Completed';
  scene.add.image(960, 470, 'lvlbox').setOrigin(0.5).setDepth(10);
  scene.add.text(940, 470, 'Level Completed', {
    fontFamily: 'Outfit',
    fontSize: '70px',
    // ensure it’s not italic
    // use a lighter weight
    color: '#fff'
  }).setOrigin(0.5).setDepth(12);

  // 6) Hook up Restart/Next buttons
  const restartButton = scene.add.image(730, 670, 'restart1')
    .setInteractive().setOrigin(0.5).setDepth(11);
  const nextbtn = scene.add.image(1190, 670, 'nextbtn')
    .setInteractive().setOrigin(0.5).setDepth(11);

  nextbtn.on('pointerdown', () => {
    console.log('Next button clicked, emitting sceneComplete');
    scene.input.off('pointerdown');
    scene.input.keyboard.off('keydown-SPACE');
    scene.input.keyboard.off('keydown-UP');
    scene.input.keyboard.off('keyup-UP');
    scene.isGameStarted = false;
    notifyParent('sceneComplete', { result: 'win' });
  });

  restartButton.on('pointerdown', () => {
    console.log('Restart button clicked, restarting GamePlayScene');
    scene.input.off('pointerdown');
    scene.input.keyboard.off('keydown-SPACE');
    scene.input.keyboard.off('keydown-UP');
    scene.input.keyboard.off('keyup-UP');
    scene.scene.restart();
    scene.children.list.forEach(child => child.destroy());
    scene.isGameStarted = false;
    restartButton.destroy();
  });
}

function startGame(scene) {
  // ─── INITIAL SETUP ─────────────────────────────
  scene.physics.world.setBounds(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
  scene.cameras.main.setBounds(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

  // Background & platform
  scene.add.image(SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2, 'background');
  scene.add.image(SCREEN_WIDTH / 2, 950, 'platform').setScale(1.5);

  // Hero setup
  scene.hero = scene.physics.add.sprite(140, SCREEN_HEIGHT - 100, 'hero').setScale(2);
  scene.hero.setCollideWorldBounds(true);
  scene.hero.body.setGravityY(300);
  scene.hero.hp = 200;
  scene.hero.jumpButtonHeld = false;
  scene.hero.jumpKeyHeld = false;

  // Boss setup
  scene.boss = scene.physics.add.sprite(1500, 100, 'boss');
  scene.boss.body.setOffset(200, 200);
  scene.boss.body.setSize(200, 680);
  scene.boss.hp = 200;
  scene.boss.setCollideWorldBounds(true);
  scene.boss.body.setGravityY(300);

  // HP bars
  scene.heroHPImage = scene.add.image(50, 50, 'herohp').setOrigin(0).setScrollFactor(0);
  scene.bossHPImage = scene.add.image(1600, 50, 'bosshp').setOrigin(0.5).setScrollFactor(0);

  // Groups
  scene.enemies = scene.physics.add.group();
  scene.heroBullets = scene.physics.add.group();
  scene.bossBullets = scene.physics.add.group();
  scene.enemyBullets = scene.physics.add.group();

  // Play background music
  if (scene.sound.get('bgm')) {
    scene.sound.play('bgm', { loop: true });
    console.log('Background music started');
  } else {
    console.warn('Background music not loaded');
  }

  // ─── BOSS INTRO LOGIC ────────────────────────────
  // run once after boss and groups exist
  scene.boss.introDone = false;
  scene.time.delayedCall(1000, () => {
    // 1) Spawn three minions
    for (let i = 0; i < 3; i++) spawnEnemy(scene);

    // 2) Move boss off the right side of the screen with blinking and shaking
    scene.boss.setActive(false); // Deactivate boss during movement
    scene.tweens.add({
      targets: scene.boss,
      x: SCREEN_WIDTH + 300, // Move beyond right edge
      duration: 1000, // 1 second to move off-screen
      ease: 'Linear',
      onComplete: () => {
        scene.boss.setVisible(false); // Hide boss when it reaches the edge
      }
    });
    // Add blinking effect
    scene.tweens.add({
      targets: scene.boss,
      alpha: 0,
      duration: 100, // 100ms per blink (on/off)
      repeat: 4, // 5 blinks over 1 second
      yoyo: true,
      onStart: () => {
        scene.boss.setAlpha(1); // Ensure boss starts visible
      },
      onComplete: () => {
        scene.boss.setAlpha(1); // Ensure boss ends visible before hiding
      }
    });
    // Add shaking effect
    scene.tweens.add({
      targets: scene.boss,
      y: '+=20', // Small vertical shake
      duration: 50, // Fast oscillations
      yoyo: true,
      repeat: 9, // 10 shakes over 1 second
      ease: 'Sine.easeInOut'
    });

    scene.boss.setScale(1);
    scene.tweens.add({
      targets: scene.boss,
      scaleX: 1.13,
      scaleY: 1.13,
      duration: 500,
      yoyo: true,
      repeat: -1
    });


    // 3) Poll until those 3 minions are dead, then move boss back
    const introCheck = scene.time.addEvent({
      delay: 500,
      loop: true,
      callback: () => {
        if (scene.enemies.getChildren().filter(e => e.active).length === 0) {
          scene.boss.setActive(true); // Reactivate boss
          scene.boss.setVisible(true); // Show boss
          scene.boss.x = SCREEN_WIDTH + 300; // Start from off-screen
          scene.tweens.add({
            targets: scene.boss,
            x: 1500, // Return to original x position
            y: 100,  // Return to original y position
            duration: 1000, // 1 second to move back
            ease: 'Linear',
            onComplete: () => {
              scene.boss.introDone = true;
              introCheck.remove(false); // Stop polling
            }
          });
        }
      }
    });
  });

  // ─── COLLIDERS & OVERLAPS ────────────────────────
  scene.physics.add.collider(scene.hero, scene.platform);
  scene.physics.add.overlap(
    scene.enemies,
    scene.heroBullets,
    // first param is enemy, second is bullet
    (enemySprite, bulletSprite) => hitEnemy(bulletSprite, enemySprite),
    null,
    scene
  );

  scene.physics.add.overlap(scene.enemyBullets, scene.hero, (h, b) => hitHero(h, b, scene), null, scene);
  scene.physics.add.overlap(scene.bossBullets, scene.hero, (h, b) => hitHero(h, b, scene), null, scene);
  scene.physics.add.overlap(scene.boss, scene.heroBullets, (boss, bullet) => hitBoss(bullet, boss, scene), null, scene);
  scene.physics.add.overlap(scene.boss, scene.hero, (boss, hero) => bossHitHero(boss, hero, scene), null, scene);

  // ─── INPUT: left half = jump; right half = fire ──
  scene.input.on('pointerdown', pointer => {
    if (pointer.x < SCREEN_WIDTH / 2) {
      scene.hero.jumpButtonHeld = true;
      scene.hero.jumpState = 'ascending';
      scene.hero.body.setAllowGravity(false);
      scene.hero.setVelocityY(-800);
    } else {
      fireBullet(scene, pointer.x, pointer.y);
    }
  });
  scene.input.on('pointerup', pointer => {
    if (pointer.x < SCREEN_WIDTH / 2) {
      scene.hero.jumpButtonHeld = false;
      if (!scene.hero.jumpKeyHeld) {
        scene.hero.jumpState = 'descending';
        scene.hero.setVelocityY(400);
      }
    }
  });
  scene.input.keyboard.on('keydown-SPACE', () => {
    if (scene.hero.body.onFloor()) {
      scene.hero.setVelocityY(-800);
    }
  });

  // ─── TIMED EVENTS ───────────────────────────────
  scene.time.addEvent({ delay: 2000, callback: () => spawnEnemy(scene), callbackScope: scene, loop: true });
  scene.time.addEvent({ delay: 3000, callback: () => bossMoveAndFire(scene), callbackScope: scene, loop: true });
  scene.time.addEvent({ delay: 1100, callback: () => enemiesFire(scene), callbackScope: scene, loop: true });
}

export default class GamePlayScene extends Phaser.Scene {
  constructor() {
    super('GamePlayScene');
    this.isGameStarted = false;
  }

  preload() {
    const basePath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));
    this.load.json('levelConfig', `${basePath}/config.json`);

    this.load.once('filecomplete-json-levelConfig', () => {
      const cfg = this.cache.json.get('levelConfig');
      const sheets = cfg.sheets || {};
      const heroData = sheets.hero || {};
      const rawMain = new URLSearchParams(window.location.search).get('main') || '';
      const cleanMain = rawMain.replace(/^"|"$/g, '');
      const sheetUrl =
        cleanMain ||
        heroData.url ||
        `${basePath}/assets/hero.png`;

      const frameW = heroData.frameWidth || 103;
      const frameH = heroData.frameHeight || 142;
      this.load.spritesheet('hero', sheetUrl, {
        frameWidth: frameW,
        frameHeight: frameH,
      });

      // Load boss spritesheet for boss and boss2
      this.load.spritesheet('boss', `${basePath}/assets/boss.png`, {
        frameWidth: 500,
        frameHeight: 600
      });
      this.load.spritesheet('boss2', `${basePath}/assets/boss2.png`, {
        frameWidth: 500,
        frameHeight: 600
      });

      // Load HP bar images for boss
      for (let i = 0; i <= 6; i++) {
        const key = `bosshp${i === 0 ? '' : i}`;
        this.load.image(key, `${basePath}/assets/bosshp${i === 0 ? '' : i}.png`);
        console.log(`Loading boss HP texture: ${key} from ${basePath}/assets/bosshp${i === 0 ? '' : i}.png`);
      }

      // Load HP bar images for hero
      for (let i = 0; i <= 6; i++) {
        const key = `herohp${i === 0 ? '' : i}`;
        this.load.image(key, `${basePath}/assets/herohp${i === 0 ? '' : i}.png`);
        console.log(`Loading hero HP texture: ${key} from ${basePath}/assets/herohp${i === 0 ? '' : i}.png`);
      }

      if (cfg.spritesheets) {
        for (const [key, sheet] of Object.entries(cfg.spritesheets)) {
          this.load.spritesheet(key, sheet.path, {
            frameWidth: sheet.frameWidth,
            frameHeight: sheet.height,
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
          console.log(`Loading audio: ${key} from ${basePath}/${url}`);
          this.load.audio(key, `${basePath}/${url}`);
        }
      }

      this.load.once('complete', () => {
        console.log('All assets loaded');

        // Verify hero HP texture
        if (!this.textures.exists('herohp')) {
          console.error('Sprite "herohp" not loaded');
        }

        // Verify boss HP textures 0..6
        for (let i = 0; i <= 6; i++) {
          const key = `bosshp${i === 0 ? '' : i}`;
          if (!this.textures.exists(key)) {
            console.error(`Missing boss HP texture: "${key}"`);
          }
        }

        for (let i = 0; i <= 6; i++) {
          const key = `herohp${i === 0 ? '' : i}`;
          if (!this.textures.exists(key)) {
            console.error(`Missing hero HP texture: "${key}"`);
          }
        }

        // Verify enemy texture
        if (!this.textures.exists('enemy')) {
          console.error('Texture "enemy" not loaded');
        }

        // Verify boss textures
        if (!this.textures.exists('boss') || !this.textures.exists('boss2')) {
          console.error('Boss textures missing:', {
            boss: this.textures.exists('boss'),
            boss2: this.textures.exists('boss2')
          });
        }



        // Verify text properties in config
        const config = this.cache.json.get('levelConfig');
        if (!config.text) {
          console.warn('Text properties missing in config.json, using defaults');
        } else {
          console.log('Text properties loaded:', config.text);
        }

        const audioKeys = Object.keys(cfg.audio || {});
        audioKeys.forEach(key => {
          if (this.cache.audio.exists(key)) {
            // add it so scene.sound.get(key) will work
            this.sound.add(key);
            console.log(`Audio "${key}" added to Sound Manager`);
          } else {
            console.warn(`Audio "${key}" failed to load`);
          }
        });

        this.scene.start();
      });

      this.load.start();
    });
  }

  create() {
    const levelData = this.cache.json.get('levelConfig');
    this.levelData = levelData; // Keep for endLevel

    // Apply orientation from config
    if (levelData.orientation?.frame === 'landscape' && screen.orientation && screen.orientation.lock) {
      screen.orientation
        .lock('landscape-primary')
        .catch(err => console.warn('Orientation lock failed:', err));
    }

    // Initialize enemies group
    this.enemies = this.physics.add.group({
      classType: Phaser.Physics.Arcade.Sprite,
      defaultKey: 'enemy',
      maxSize: 108,
      runChildUpdate: true
    });

    // Verify critical textures before proceeding
    if (!this.textures.exists('herohp') || !this.textures.exists('bosshp') || !this.textures.exists('enemy') || !this.textures.exists('boss') || !this.textures.exists('boss2')) {
      console.error('Critical textures missing:', {
        herohp: this.textures.exists('herohp'),
        bosshp: this.textures.exists('bosshp'),
        enemy: this.textures.exists('enemy'),
        boss: this.textures.exists('boss'),
        boss2: this.textures.exists('boss2')
      });
      // Delay restart to ensure textures are loaded
      this.time.delayedCall(1000, () => {
        console.log('Retrying scene start due to missing textures');
        this.scene.restart();
      });
      return;
    }

    this.input.addPointer(2);
    this.input.on('pointerup', () => {
      if (this.scale.fullscreen.available) {
        this.scale.startFullscreen();
      }
    });

    const config = this.cache.json.get('levelConfig');
    const howToPlayText = config?.text?.howToPlay || 'How to Play';
    const instructionsText = config?.text?.instructions || 'Tap the left side of the screen\nto fly and dodge bullets from\nthe enemy and its minions.\nTo shoot, tap the enemy you\nwant to target.';

    const box = this.add.image(960, 450, 'htpbox').setOrigin(0.5).setDepth(10);
    this.add.image(960, 540, 'bg').setOrigin(0.5).setDepth(9);
    const playButton = this.add.image(960, 900, 'playbtn').setInteractive().setOrigin(0.5).setDepth(11);

    const htptxt = this.add.text(890, 220, howToPlayText, { font: 'bold 70px outfit', color: '#fff' }).setOrigin(0.5).setDepth(12);

    this.add.text(970, 530, instructionsText, { font: '55px outfit', color: '#fff', lineSpacing: 18 }).setOrigin(0.5).setDepth(12);

    playButton.on('pointerdown', () => {
      this.children.list.forEach(child => child.destroy());
      this.isGameStarted = true;
      playButton.destroy();
      htptxt.destroy();
      box.destroy();
      startGame(this);
    });
  }

  update() {
    if (!this.isGameStarted) return;

    if (this.hero && this.hero.active) {
      // Update hero HP image
      if (this.hero.hp >= 190) {
        this.heroHPImage.setTexture('herohp');
      } else if (this.hero.hp >= 160) {
        this.heroHPImage.setTexture('herohp1');
      } else if (this.hero.hp >= 120) {
        this.heroHPImage.setTexture('herohp2');
      } else if (this.hero.hp >= 80) {
        this.heroHPImage.setTexture('herohp3');
      } else if (this.hero.hp >= 40) {
        this.heroHPImage.setTexture('herohp4');
      } else if (this.hero.hp >= 10) {
        this.heroHPImage.setTexture('herohp5');
      } else {
        this.heroHPImage.setTexture('herohp6');
      }

      // Handle jump mechanics
      if (this.hero.jumpButtonHeld || this.hero.jumpKeyHeld) {
        this.hero.jumpState = 'ascending';
        this.hero.body.setAllowGravity(false);
        this.hero.setVelocityY(-800); // Slow ascent
        // console.log(`Hero ascending, y=${this.hero.y}, velocityY=${this.hero.body.velocity.y}, onFloor=${this.hero.body.onFloor()}`);
      } else if (!this.hero.body.onFloor()) {
        this.hero.jumpState = 'descending';
        this.hero.body.setAllowGravity(false);
        this.hero.setVelocityY(400); // Slow descent
        // console.log(`Hero descending, y=${this.hero.y}, velocityY=${this.hero.body.velocity.y}, onFloor=${this.hero.body.onFloor()}`);
      } else {
        this.hero.jumpState = 'idle';
        this.hero.body.setAllowGravity(true); // Restore gravity when idle on ground
        this.hero.setVelocityY(0); // Stop vertical movement
        // console.log(`Hero idle on ground, y=${this.hero.y}, velocityY=${this.hero.body.velocity.y}, onFloor=${this.hero.body.onFloor()}`);
      }
    }

    if (this.boss && this.boss.active) {
      if (this.boss.hp >= 190) {
        this.bossHPImage.setTexture('bosshp');
      } else if (this.boss.hp >= 160) {
        this.bossHPImage.setTexture('bosshp1');
      } else if (this.boss.hp >= 120) {
        this.bossHPImage.setTexture('bosshp2');
      } else if (this.boss.hp >= 80) {
        this.bossHPImage.setTexture('bosshp3');
      } else if (this.boss.hp >= 40) {
        this.bossHPImage.setTexture('bosshp4');
      } else if (this.boss.hp >= 10) {
        this.bossHPImage.setTexture('bosshp5');
      } else {
        this.bossHPImage.setTexture('bosshp6');
      }
      if (this.boss && !this.boss.active) {
        this.tweens.killTweensOf(this.boss);
      }

      this.boss.x = Phaser.Math.Clamp(this.boss.x, 100, SCREEN_WIDTH - 100);
      this.boss.y = Phaser.Math.Clamp(this.boss.y, 100, SCREEN_HEIGHT - 100);
    }

    // Check for win condition after boss is defeated
    if (this.boss && !this.boss.active && this.boss.introDone) {
      const alive = this.enemies.getChildren().filter(e => e.active).length;
      if (alive === 0 && this.hero && this.hero.active) {
        // this.hero.setActive(false);
        // this.hero.setVisible(false);
        win(this);
      }
    }

    updateEnemyMovement(this);

    this.heroBullets.getChildren().forEach(bullet => {
      if (!Phaser.Geom.Rectangle.ContainsPoint(this.physics.world.bounds, { x: bullet.x, y: bullet.y })) {
        bullet.destroy();
        console.log('Hero bullet destroyed out of bounds:', { x: bullet.x, y: bullet.y });
      }
    });

    this.enemyBullets.getChildren().forEach(bullet => {
      if (!Phaser.Geom.Rectangle.ContainsPoint(this.physics.world.bounds, { x: bullet.x, y: bullet.y })) {
        bullet.destroy();
      }
    });

    this.bossBullets.getChildren().forEach(bullet => {
      if (!Phaser.Geom.Rectangle.ContainsPoint(this.physics.world.bounds, { x: bullet.x, y: bullet.y })) {
        bullet.destroy();
      }
    });
  }
}