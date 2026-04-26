// ================= CONFIG LOADING ====================
let CONFIG = null;

async function loadConfig() {
  const response = await fetch("config.json");
  CONFIG = await response.json();
}

// Wait for config to load, then setup scene
(async () => {
  await loadConfig();
  startGameAfterConfig();
})();

function startGameAfterConfig() {
  // ===== APPLY CONFIG VALUES FROM JSON =====
  if (CONFIG && CONFIG.mechanics) {
    if (typeof CONFIG.mechanics.targetScore === "number") {
      TARGET_SCORE = CONFIG.mechanics.targetScore;
    }
    if (typeof CONFIG.mechanics.stepTime === "number") {
      stepTime = CONFIG.mechanics.stepTime;
    }
  }
  // =========================================

  setupScene();
  initaliseValues();
  showHowToPlay();
  requestAnimationFrame(animate);
}


// =====================================================

// ================= GLOBALS & DOM REFS =================
const counterDOM = document.getElementById("counter");
const endDOM = document.getElementById("end");

let scene;
let camera;
let renderer;

const distance = 500;
const zoom = 2;

let chickenSize;
let positionWidth;
let columns;
let boardWidth;
let stepTime = 200; // default, can be overridden by config

let initialCameraPositionY;
let initialCameraPositionX;

let lanes;
let currentLane;
let currentColumn;

let previousTimestamp;
let startMoving;
let moves;
let stepStartTimestamp;

let chicken;
let hemiLight;
let dirLight;
let backLight;

let score = 0;
let scorePerStep = 1; // default, can be overridden by config

// ========= SIMPLE TARGET / WIN LOGIC =========
let TARGET_SCORE = 200;

function updateScoreUI() {
  counterDOM.textContent = `${score}/${TARGET_SCORE}`;
}


function checkWinCondition() {
  // Only trigger once
  if (score < TARGET_SCORE || isGameOver) return;

  isGameOver = true;

  // Update end text to WIN
  const msgEl = document.getElementById("end-message");
  if (msgEl) {
    msgEl.textContent = "You Win!";
  }

  // Show NEXT button only on win
  const nextBtn = document.getElementById("next");
  if (nextBtn) {
    nextBtn.style.display = "inline-block";
  }

  // Show overlay
  endDOM.style.visibility = "visible";

  // Stop BGM if playing
  if (bgm) {
    bgm.pause();
    bgm.currentTime = 0;
  }
}

// Notify parent (for React Native WebView / iframe host)
function notifyParent(type, data) {
  if (window.parent !== window) {
    window.parent.postMessage({ type, ...data }, "*");
  }
}
// =============================================
// default, can be overridden by config

// Game start flag for input blocking
let gameStarted = false;

let bgm = null;        // 🔊 background music
let isGameOver = false;

let jumpSfx = null;    // 🔊 jump sound (forward move)


// =====================================================

// ================= SCENE SETUP ========================
function setupScene() {
  scene = new THREE.Scene();

  camera = new THREE.OrthographicCamera(
    window.innerWidth / -2,
    window.innerWidth / 2,
    window.innerHeight / 2,
    window.innerHeight / -2,
    0.1,
    10000
  );

  camera.rotation.x = (50 * Math.PI) / 180;
  camera.rotation.y = (20 * Math.PI) / 180;
  camera.rotation.z = (10 * Math.PI) / 180;

  initialCameraPositionY = -Math.tan(camera.rotation.x) * distance;
  initialCameraPositionX =
    Math.tan(camera.rotation.y) *
    Math.sqrt(distance ** 2 + initialCameraPositionY ** 2);

  camera.position.y = initialCameraPositionY;
  camera.position.x = initialCameraPositionX;
  camera.position.z = distance;

  // ------ USE CONFIG VALUES WITH FALLBACKS ------
  chickenSize = CONFIG?.mechanics?.playerSize ?? 15;
  positionWidth = CONFIG?.mechanics?.laneWidth ?? 42;
  columns = CONFIG?.mechanics?.columns ?? 17;
  scorePerStep = CONFIG?.mechanics?.scorePerStep ?? 1;
  stepTime = CONFIG?.mechanics?.stepTime ?? 200;
  boardWidth = positionWidth * columns;
  // ----------------------------------------------

  // Renderer
  renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
  });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  // 🔊 BGM loaded once (must be after user gesture to play)
  // 🔊 AUDIO FROM CONFIG ==================================
  // 🔊 AUDIO FROM CONFIG ==================================
  const bgmSrc = CONFIG?.audio?.bgm;
  if (bgmSrc) {
    bgm = new Audio(bgmSrc);
    bgm.loop = true;      // default loop
    bgm.volume = 0.5;     // default volume
  }

  const jumpSrc = CONFIG?.audio?.jump;
  if (jumpSrc) {
    jumpSfx = new Audio(jumpSrc);
    jumpSfx.loop = false; // default: no loop
    jumpSfx.volume = 1.0; // default volume
  }
  // ======================================================

  // ======================================================



  // Chicken + lights
  chicken = new Chicken();
  scene.add(chicken);

  hemiLight = new THREE.HemisphereLight(0xffffff, 0xffffff, 0.6);
  scene.add(hemiLight);

  const initialDirLightPositionX = -100;
  const initialDirLightPositionY = -100;
  dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
  dirLight.position.set(initialDirLightPositionX, initialDirLightPositionY, 200);
  dirLight.castShadow = true;
  dirLight.target = chicken;
  scene.add(dirLight);

  dirLight.shadow.mapSize.width = 2048;
  dirLight.shadow.mapSize.height = 2048;
  var d = 500;
  dirLight.shadow.camera.left = -d;
  dirLight.shadow.camera.right = d;
  dirLight.shadow.camera.top = d;
  dirLight.shadow.camera.bottom = -d;

  backLight = new THREE.DirectionalLight(0x000000, 0.4);
  backLight.position.set(200, 200, 50);
  backLight.castShadow = true;
  scene.add(backLight);

  // Store initial positions for reset use
  setupScene._initialDirLightPositionX = initialDirLightPositionX;
  setupScene._initialDirLightPositionY = initialDirLightPositionY;
}
// =====================================================

// ================= LANE / OBJECT CONSTANTS ============
const laneTypes = ["car", "truck", "forest"];
const laneSpeeds = [2, 2.5, 3];
// ** UPDATED: MUCH BRIGHTER AND WIDER COLOR PALETTE **
const vechicleColors = [
  0xff5722, // Deep Orange
  0x00bcd4, // Cyan
  0x8bc34a, // Light Green
  0xffeb3b, // Yellow
  0x9c27b0, // Purple
  0xe91e63, // Pink
  0x03a9f4, // Light Blue
];
const threeHeights = [20, 45, 60];
// =====================================================

// ================= TEXTURES ===========================
function Texture(width, height, rects) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "rgba(0,0,0,0.6)";
  rects.forEach((rect) => {
    context.fillRect(rect.x, rect.y, rect.w, rect.h);
  });
  return new THREE.CanvasTexture(canvas);
}

const carFrontTexture = new Texture(40, 80, [{ x: 0, y: 10, w: 30, h: 60 }]);
const carBackTexture = new Texture(40, 80, [{ x: 10, y: 10, w: 30, h: 60 }]);
const carRightSideTexture = new Texture(110, 40, [
  { x: 10, y: 0, w: 50, h: 30 },
  { x: 70, y: 0, w: 30, h: 30 },
]);
const carLeftSideTexture = new Texture(110, 40, [
  { x: 10, y: 10, w: 50, h: 30 },
  { x: 70, y: 10, w: 30, h: 30 },
]);

const truckFrontTexture = new Texture(30, 30, [{ x: 15, y: 0, w: 10, h: 30 }]);
const truckRightSideTexture = new Texture(25, 30, [
  { x: 0, y: 15, w: 10, h: 10 },
]);
const truckLeftSideTexture = new Texture(25, 30, [
  { x: 0, y: 5, w: 10, h: 10 },
]);
// =====================================================

// ================= GEOMETRY HELPERS ===================
function Wheel() {
  const wheel = new THREE.Mesh(
    new THREE.BoxBufferGeometry(12 * zoom, 33 * zoom, 12 * zoom),
    // ** UPDATED: DEEP BLACK WHEELS **
    new THREE.MeshLambertMaterial({ color: 0x111111, flatShading: true })
  );
  wheel.position.z = 6 * zoom;
  return wheel;
}

function Car() {
  const car = new THREE.Group();
  // Get a random bright color
  const color =
    vechicleColors[Math.floor(Math.random() * vechicleColors.length)];

  const main = new THREE.Mesh(
    new THREE.BoxBufferGeometry(60 * zoom, 30 * zoom, 15 * zoom),
    // ** UPDATED: Main body uses Phong (more reflective) material with bright color **
    new THREE.MeshPhongMaterial({ color: color, flatShading: true })
  );
  main.position.z = 12 * zoom;
  main.castShadow = true;
  main.receiveShadow = true;
  car.add(main);

  const cabin = new THREE.Mesh(
    new THREE.BoxBufferGeometry(33 * zoom, 24 * zoom, 12 * zoom),
    [
      // ** UPDATED: Cabin uses a distinct, light silver/grey color **
      new THREE.MeshPhongMaterial({
        color: 0xaaaaaa, // Silver-Gray
        flatShading: true,
        map: carBackTexture,
      }),
      new THREE.MeshPhongMaterial({
        color: 0xaaaaaa, // Silver-Gray
        flatShading: true,
        map: carFrontTexture,
      }),
      new THREE.MeshPhongMaterial({
        color: 0xaaaaaa, // Silver-Gray
        flatShading: true,
        map: carRightSideTexture,
      }),
      new THREE.MeshPhongMaterial({
        color: 0xaaaaaa, // Silver-Gray
        flatShading: true,
        map: carLeftSideTexture,
      }),
      new THREE.MeshPhongMaterial({ color: 0xaaaaaa, flatShading: true }),
      new THREE.MeshPhongMaterial({ color: 0xaaaaaa, flatShading: true }),
    ]
  );
  cabin.position.x = 6 * zoom;
  cabin.position.z = 25.5 * zoom;
  cabin.castShadow = true;
  cabin.receiveShadow = true;
  car.add(cabin);

  const frontWheel = new Wheel();
  frontWheel.position.x = -18 * zoom;
  car.add(frontWheel);

  const backWheel = new Wheel();
  backWheel.position.x = 18 * zoom;
  car.add(backWheel);

  car.castShadow = true;
  car.receiveShadow = false;

  return car;
}

function Truck() {
  const truck = new THREE.Group();
  // Get a random bright color
  const color =
    vechicleColors[Math.floor(Math.random() * vechicleColors.length)];

  const base = new THREE.Mesh(
    new THREE.BoxBufferGeometry(100 * zoom, 25 * zoom, 5 * zoom),
    // ** UPDATED: Cargo base is a light, contrasting blue/gray **
    new THREE.MeshLambertMaterial({ color: 0x90a4ae, flatShading: true }) // Blue Gray
  );
  base.position.z = 10 * zoom;
  truck.add(base);

  const cargo = new THREE.Mesh(
    new THREE.BoxBufferGeometry(75 * zoom, 35 * zoom, 40 * zoom),
    // ** UPDATED: Cargo body is a light, contrasting blue/gray **
    new THREE.MeshPhongMaterial({ color: 0x90a4ae, flatShading: true }) // Blue Gray
  );
  cargo.position.x = 15 * zoom;
  cargo.position.z = 30 * zoom;
  cargo.castShadow = true;
  cargo.receiveShadow = true;
  truck.add(cargo);

  const cabin = new THREE.Mesh(
    new THREE.BoxBufferGeometry(25 * zoom, 30 * zoom, 30 * zoom),
    [
      // ** UPDATED: Cabin uses the bright random color for emphasis **
      new THREE.MeshPhongMaterial({ color: color, flatShading: true }),
      new THREE.MeshPhongMaterial({
        color: color,
        flatShading: true,
        map: truckFrontTexture,
      }),
      new THREE.MeshPhongMaterial({
        color: color,
        flatShading: true,
        map: truckRightSideTexture,
      }),
      new THREE.MeshPhongMaterial({
        color: color,
        flatShading: true,
        map: truckLeftSideTexture,
      }),
      new THREE.MeshPhongMaterial({ color: color, flatShading: true }),
      new THREE.MeshPhongMaterial({ color: color, flatShading: true }),
    ]
  );
  cabin.position.x = -40 * zoom;
  cabin.position.z = 20 * zoom;
  cabin.castShadow = true;
  cabin.receiveShadow = true;
  truck.add(cabin);

  const frontWheel = new Wheel();
  frontWheel.position.x = -38 * zoom;
  truck.add(frontWheel);

  const middleWheel = new Wheel();
  middleWheel.position.x = -10 * zoom;
  truck.add(middleWheel);

  const backWheel = new Wheel();
  backWheel.position.x = 30 * zoom;
  truck.add(backWheel);

  return truck;
}

function Three() {
  const three = new THREE.Group();

  const trunk = new THREE.Mesh(
    new THREE.BoxBufferGeometry(15 * zoom, 15 * zoom, 20 * zoom),
    // ** UPDATED: Richer Brown Trunk **
    new THREE.MeshPhongMaterial({ color: 0x6d4c41, flatShading: true }) // Rich Brown
  );
  trunk.position.z = 10 * zoom;
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  three.add(trunk);

  const height = threeHeights[Math.floor(Math.random() * threeHeights.length)];

  const crown = new THREE.Mesh(
    new THREE.BoxBufferGeometry(30 * zoom, 30 * zoom, height * zoom),
    // ** UPDATED: Vibrant Lime Green Crown **
    new THREE.MeshLambertMaterial({ color: 0x9ccc65, flatShading: true }) // Vibrant Lime Green
  );
  crown.position.z = (height / 2 + 20) * zoom;
  crown.castShadow = true;
  crown.receiveShadow = false;
  three.add(crown);

  return three;
}

// 💖 Cute Cartoon Character 💖
function Chicken() {
  const character = new THREE.Group();
  const bodyColor = 0xffe082; // Soft Yellow/Orange

  // 1. Main Body (Large, rounded sphere for a cute, squishy look)
  const body = new THREE.Mesh(
    new THREE.SphereBufferGeometry(
      chickenSize * zoom * 0.9, // Make it quite large
      16,
      16
    ),
    new THREE.MeshPhongMaterial({
      color: bodyColor,
      flatShading: true
    })
  );
  body.position.z = 15 * zoom;
  body.castShadow = true;
  body.receiveShadow = true;
  character.add(body);

  // 2. Face/Belly Patch (For contrast)
  const facePatch = new THREE.Mesh(
    new THREE.SphereBufferGeometry(
      chickenSize * zoom * 0.6,
      16,
      16
    ),
    new THREE.MeshPhongMaterial({
      color: 0xfffde7, // Off-White
      flatShading: true
    })
  );
  // Flatten and position it on the front
  facePatch.scale.set(1.0, 1.0, 0.5);
  facePatch.position.y = -8 * zoom;
  facePatch.position.z = 16 * zoom;
  character.add(facePatch);

  // 3. Eyes (Large, black spheres for expression)
  const eyeMaterial = new THREE.MeshPhongMaterial({ color: 0x111111, shininess: 100 });

  // Left Eye
  const leftEye = new THREE.Mesh(
    new THREE.SphereBufferGeometry(5 * zoom, 8, 8),
    eyeMaterial
  );
  leftEye.position.x = -6 * zoom;
  leftEye.position.y = -10 * zoom;
  leftEye.position.z = 23 * zoom; // Pushed forward and up 
  character.add(leftEye);

  // Right Eye
  const rightEye = new THREE.Mesh(
    new THREE.SphereBufferGeometry(5 * zoom, 8, 8),
    eyeMaterial
  );
  rightEye.position.x = 6 * zoom;
  rightEye.position.y = -10 * zoom;
  rightEye.position.z = 23 * zoom; // Pushed forward and up
  character.add(rightEye);

  // 4. Beak/Nose (Small orange box/wedge)
  const nose = new THREE.Mesh(
    new THREE.BoxBufferGeometry(5 * zoom, 5 * zoom, 5 * zoom),
    new THREE.MeshLambertMaterial({ color: 0xff9800, flatShading: true }) // Orange beak
  );
  nose.position.y = -13 * zoom;
  nose.position.z = 15 * zoom;
  character.add(nose);

  return character;
}


function Road() {
  const road = new THREE.Group();

  const createSection = (color) =>
    new THREE.Mesh(
      new THREE.PlaneBufferGeometry(boardWidth * zoom, positionWidth * zoom),
      new THREE.MeshPhongMaterial({ color })
    );

  // ** UPDATED: Darker, more contrast for the road **
  const middle = createSection(0x37474f); // Dark Asphalt
  middle.receiveShadow = true;
  road.add(middle);

  // ** UPDATED: Lighter color for shoulder/lane markers **
  const left = createSection(0x607d8b); // Light Gray/Blue
  left.position.x = -boardWidth * zoom;
  road.add(left);

  // ** UPDATED: Lighter color for shoulder/lane markers **
  const right = createSection(0x607d8b); // Light Gray/Blue
  right.position.x = boardWidth * zoom;
  road.add(right);

  return road;
}

function Grass() {
  const grass = new THREE.Group();

  const createSection = (color) =>
    new THREE.Mesh(
      new THREE.BoxBufferGeometry(
        boardWidth * zoom,
        positionWidth * zoom,
        3 * zoom
      ),
      new THREE.MeshPhongMaterial({ color })
    );

  // ** UPDATED: Lush, Bright Green Grass **
  const middle = createSection(0x8bc34a); // Lush Bright Green
  middle.receiveShadow = true;
  grass.add(middle);

  // ** UPDATED: Slightly darker, contrasting border grass **
  const left = createSection(0x689f38); // Darker Green
  left.position.x = -boardWidth * zoom;
  grass.add(left);

  // ** UPDATED: Slightly darker, contrasting border grass **
  const right = createSection(0x689f38); // Darker Green
  right.position.x = boardWidth * zoom;
  grass.add(right);

  grass.position.z = 1.5 * zoom;
  return grass;
}

function Lane(index) {
  this.index = index;
  this.type =
    index <= 0
      ? "field"
      : laneTypes[Math.floor(Math.random() * laneTypes.length)];

  switch (this.type) {
    case "field": {
      this.type = "field";
      this.mesh = new Grass();
      break;
    }
    case "forest": {
      this.mesh = new Grass();

      this.occupiedPositions = new Set();
      this.threes = [1, 2, 3, 4].map(() => {
        const three = new Three();
        let position;
        do {
          position = Math.floor(Math.random() * columns);
        } while (this.occupiedPositions.has(position));
        this.occupiedPositions.add(position);
        three.position.x =
          (position * positionWidth + positionWidth / 2) * zoom -
          (boardWidth * zoom) / 2;
        this.mesh.add(three);
        return three;
      });
      break;
    }
    case "car": {
      this.mesh = new Road();
      this.direction = Math.random() >= 0.5;

      const occupiedPositions = new Set();
      this.vechicles = [1, 2, 3].map(() => {
        const vechicle = new Car();
        let position;
        do {
          position = Math.floor((Math.random() * columns) / 2);
        } while (occupiedPositions.has(position));
        occupiedPositions.add(position);
        vechicle.position.x =
          (position * positionWidth * 2 + positionWidth / 2) * zoom -
          (boardWidth * zoom) / 2;
        if (!this.direction) vechicle.rotation.z = Math.PI;
        this.mesh.add(vechicle);
        return vechicle;
      });

      this.speed = laneSpeeds[Math.floor(Math.random() * laneSpeeds.length)];
      break;
    }
    case "truck": {
      this.mesh = new Road();
      this.direction = Math.random() >= 0.5;

      const occupiedPositions = new Set();
      this.vechicles = [1, 2].map(() => {
        const vechicle = new Truck();
        let position;
        do {
          position = Math.floor((Math.random() * columns) / 3);
        } while (occupiedPositions.has(position));
        occupiedPositions.add(position);
        vechicle.position.x =
          (position * positionWidth * 3 + positionWidth / 2) * zoom -
          (boardWidth * zoom) / 2;
        if (!this.direction) vechicle.rotation.z = Math.PI;
        this.mesh.add(vechicle);
        return vechicle;
      });

      this.speed = laneSpeeds[Math.floor(Math.random() * laneSpeeds.length)];
      break;
    }
  }
}
// =====================================================

// ================= GAME STATE INIT ====================
const generateLanes = () =>
  [-9, -8, -7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
    .map((index) => {
      const lane = new Lane(index);
      lane.mesh.position.y = index * positionWidth * zoom;
      scene.add(lane.mesh);
      return lane;
    })
    .filter((lane) => lane.index >= 0);

const addLane = () => {
  const index = lanes.length;
  const lane = new Lane(index);
  lane.mesh.position.y = index * positionWidth * zoom;
  scene.add(lane.mesh);
  lanes.push(lane);
};

function initaliseValues() {
  lanes = generateLanes();

  currentLane = 0;
  currentColumn = Math.floor(columns / 2);

  previousTimestamp = null;

  startMoving = false;
  moves = [];
  stepStartTimestamp = null;

  chicken.position.x = 0;
  chicken.position.y = 0;

  camera.position.y = initialCameraPositionY;
  camera.position.x = initialCameraPositionX;

  const initialDirLightPositionX = setupScene._initialDirLightPositionX;
  const initialDirLightPositionY = setupScene._initialDirLightPositionY;

  dirLight.position.x = initialDirLightPositionX;
  dirLight.position.y = initialDirLightPositionY;

  score = 0;
  updateScoreUI();

  const msgEl = document.getElementById("end-message");
  if (msgEl) msgEl.textContent = "Game Over";

  const nextBtn = document.getElementById("next");
  if (nextBtn) nextBtn.style.display = "none";

}

function initGameplay() {
  // No re-init needed, board already exists.
  // You can reset timing here if you want, or even leave it empty.
  previousTimestamp = null;
}
// =====================================================

// ================== INPUT HANDLERS ====================
document.querySelector("#retry").addEventListener("click", () => {
  // remove existing lanes
  if (lanes) {
    lanes.forEach((lane) => scene.remove(lane.mesh));
  }

  initaliseValues();
  endDOM.style.visibility = "hidden";

  // Reset flags
  isGameOver = false;
  gameStarted = false;

  // 🔊 Stop bgm now; it will restart after next tap
  if (bgm) {
    bgm.pause();
    bgm.currentTime = 0;
  }

  // show how to play again
  showHowToPlay();
});

// NEXT button: notify parent about win
const nextBtnEl = document.querySelector("#next");
if (nextBtnEl) {
  nextBtnEl.addEventListener("click", () => {
    // optionally hide overlay
    endDOM.style.visibility = "hidden";
    notifyParent("sceneComplete", { result: "win" });
  });
}

document
  .getElementById("forward")

  .addEventListener("click", () => move("forward"));

document
  .getElementById("backward")
  .addEventListener("click", () => move("backward"));

document.getElementById("left").addEventListener("click", () => move("left"));

document.getElementById("right").addEventListener("click", () => move("right"));

window.addEventListener("keydown", (event) => {
  if (event.keyCode == "38") {
    move("forward");
  } else if (event.keyCode == "40") {
    move("backward");
  } else if (event.keyCode == "37") {
    move("left");
  } else if (event.keyCode == "39") {
    move("right");
  }
});

function playJumpSfx() {
  if (jumpSfx) {
    jumpSfx.currentTime = 0;
    jumpSfx.play().catch(() => { });
  }
}


function move(direction) {
  // Block movement until game has started OR game is over
  if (!gameStarted || isGameOver) return;

  const finalPositions = moves.reduce(
    (position, move) => {
      if (move === "forward")
        return { lane: position.lane + 1, column: position.column };
      if (move === "backward")
        return { lane: position.lane - 1, column: position.column };
      if (move === "left")
        return { lane: position.lane, column: position.column - 1 };
      if (move === "right")
        return { lane: position.lane, column: position.column + 1 };
    },
    { lane: currentLane, column: currentColumn }
  );

  // ======== FORWARD ========
  if (direction === "forward") {
    if (
      lanes[finalPositions.lane + 1].type === "forest" &&
      lanes[finalPositions.lane + 1].occupiedPositions.has(finalPositions.column)
    ) return;

    playJumpSfx(); // 🔊 play sound
    if (!stepStartTimestamp) startMoving = true;
    addLane();
  }

  // ======== BACKWARD ========
  else if (direction === "backward") {
    if (finalPositions.lane === 0) return;

    if (
      lanes[finalPositions.lane - 1].type === "forest" &&
      lanes[finalPositions.lane - 1].occupiedPositions.has(finalPositions.column)
    ) return;

    playJumpSfx(); // 🔊 play sound
    if (!stepStartTimestamp) startMoving = true;
  }

  // ======== LEFT ========
  else if (direction === "left") {
    if (finalPositions.column === 0) return;

    if (
      lanes[finalPositions.lane].type === "forest" &&
      lanes[finalPositions.lane].occupiedPositions.has(finalPositions.column - 1)
    ) return;

    playJumpSfx(); // 🔊 play sound
    if (!stepStartTimestamp) startMoving = true;
  }

  // ======== RIGHT ========
  else if (direction === "right") {
    if (finalPositions.column === columns - 1) return;

    if (
      lanes[finalPositions.lane].type === "forest" &&
      lanes[finalPositions.lane].occupiedPositions.has(finalPositions.column + 1)
    ) return;

    playJumpSfx(); // 🔊 play sound
    if (!stepStartTimestamp) startMoving = true;
  }

  moves.push(direction);
}

// =====================================================

// =============== HOW TO PLAY OVERLAY ==================
function showHowToPlay() {
  const el = document.getElementById("howToPlay");
  const msgEl = el.querySelector(".msg");

  if (msgEl && CONFIG?.ui?.howToPlay) {
    msgEl.textContent = CONFIG.ui.howToPlay;
  }

  el.style.display = "flex";
  window.addEventListener("pointerdown", startGameOnce);
}


function startGameOnce() {
  if (gameStarted) return;
  gameStarted = true;

  document.getElementById("howToPlay").style.display = "none";

  // 🔊 Start BGM after first tap (browser allows audio)
  if (bgm) {
    bgm.currentTime = 0;
    bgm.play().catch(() => { });
  }

  window.removeEventListener("pointerdown", startGameOnce);
}

// =====================================================

// ================= MAIN ANIMATION LOOP ===============
function animate(timestamp) {
  requestAnimationFrame(animate);

  if (!scene || !camera || !renderer) return;

  // 🛑 PAUSE IMPLEMENTATION: Stop all logic if game is over, only render the scene
  if (isGameOver) {
    renderer.render(scene, camera);
    return;
  }

  if (!previousTimestamp) previousTimestamp = timestamp;
  const delta = timestamp - previousTimestamp;
  previousTimestamp = timestamp;

  if (!lanes) {
    // before game initialises, just render scene
    renderer.render(scene, camera);
    return;
  }

  // Animate cars and trucks moving on the lane
  lanes.forEach((lane) => {
    if (lane.type === "car" || lane.type === "truck") {
      const aBitBeforeTheBeginingOfLane =
        (-boardWidth * zoom) / 2 - positionWidth * 2 * zoom;
      const aBitAfterTheEndOFLane =
        (boardWidth * zoom) / 2 + positionWidth * 2 * zoom;
      lane.vechicles.forEach((vechicle) => {
        if (lane.direction) {
          vechicle.position.x =
            vechicle.position.x < aBitBeforeTheBeginingOfLane
              ? aBitAfterTheEndOFLane
              : (vechicle.position.x -= (lane.speed / 16) * delta);
        } else {
          vechicle.position.x =
            vechicle.position.x > aBitAfterTheEndOFLane
              ? aBitBeforeTheBeginingOfLane
              : (vechicle.position.x += (lane.speed / 16) * delta);
        }
      });
    }
  });

  if (startMoving) {
    stepStartTimestamp = timestamp;
    startMoving = false;
  }

  if (stepStartTimestamp) {
    const moveDeltaTime = timestamp - stepStartTimestamp;
    const t = Math.min(moveDeltaTime / stepTime, 1);
    const moveDeltaDistance = t * positionWidth * zoom;
    const jumpDeltaDistance = Math.sin(t * Math.PI) * 8 * zoom;

    switch (moves[0]) {
      case "forward": {
        const positionY =
          currentLane * positionWidth * zoom + moveDeltaDistance;
        camera.position.y = initialCameraPositionY + positionY;
        dirLight.position.y = setupScene._initialDirLightPositionY + positionY;
        chicken.position.y = positionY;
        chicken.position.z = jumpDeltaDistance;
        break;
      }
      case "backward": {
        const positionY =
          currentLane * positionWidth * zoom - moveDeltaDistance;
        camera.position.y = initialCameraPositionY + positionY;
        dirLight.position.y = setupScene._initialDirLightPositionY + positionY;
        chicken.position.y = positionY;
        chicken.position.z = jumpDeltaDistance;
        break;
      }
      case "left": {
        const positionX =
          (currentColumn * positionWidth + positionWidth / 2) * zoom -
          (boardWidth * zoom) / 2 -
          moveDeltaDistance;
        camera.position.x = initialCameraPositionX + positionX;
        dirLight.position.x = setupScene._initialDirLightPositionX + positionX;
        chicken.position.x = positionX;
        chicken.position.z = jumpDeltaDistance;
        break;
      }
      case "right": {
        const positionX =
          (currentColumn * positionWidth + positionWidth / 2) * zoom -
          (boardWidth * zoom) / 2 +
          moveDeltaDistance;
        camera.position.x = initialCameraPositionX + positionX;
        dirLight.position.x = setupScene._initialDirLightPositionX + positionX;
        chicken.position.x = positionX;
        chicken.position.z = jumpDeltaDistance;
        break;
      }
    }

    // Once a step has ended
    if (moveDeltaTime > stepTime) {
      switch (moves[0]) {
        case "forward": {
          currentLane++;
          // forward increases score
          score += scorePerStep;
          break;
        }
        case "backward": {
          currentLane--;
          // backward decreases score, but not below 0
          score -= scorePerStep;
          if (score < 0) score = 0;
          break;
        }
        case "left": {
          currentColumn--;
          // left/right do NOT change score
          break;
        }
        case "right": {
          currentColumn++;
          // left/right do NOT change score
          break;
        }
      }

      // update HUD & check for WIN after every completed step
      updateScoreUI();
      checkWinCondition();

      moves.shift();
      stepStartTimestamp = moves.length === 0 ? null : timestamp;
    }

  }

  // Hit test
  if (
    lanes[currentLane].type === "car" ||
    lanes[currentLane].type === "truck"
  ) {
    const chickenMinX = chicken.position.x - (chickenSize * zoom) / 2;
    const chickenMaxX = chicken.position.x + (chickenSize * zoom) / 2;
    const vechicleLength = { car: 60, truck: 105 }[lanes[currentLane].type];
    lanes[currentLane].vechicles.forEach((vechicle) => {
      const carMinX = vechicle.position.x - (vechicleLength * zoom) / 2;
      const carMaxX = vechicle.position.x + (vechicleLength * zoom) / 2;
      if (chickenMaxX > carMinX && chickenMinX < carMaxX) {
        if (!isGameOver) {
          isGameOver = true;

          // Game over text
          const msgEl = document.getElementById("end-message");
          if (msgEl) {
            msgEl.textContent = "Game Over";
          }

          // Hide NEXT button on loss
          const nextBtn = document.getElementById("next");
          if (nextBtn) {
            nextBtn.style.display = "none";
          }

          endDOM.style.visibility = "visible";

          // 🔊 Stop BGM on game over
          if (bgm) {
            bgm.pause();
            bgm.currentTime = 0;
          }
        }

      }
    });
  }

  renderer.render(scene, camera);
}
// =====================================================