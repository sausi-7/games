var svg = document.querySelector("svg");
var cursor = svg.createSVGPoint();
var arrows = document.querySelector(".arrows");
var randomAngle = 0;

// AUDIO
var sfxBow = null;
var sfxArrow = null;
var sfxBullseye = null;
var sfxHit = null;
var sfxMiss = null;
var bgm = null;          // 🔊 background music
var audioInitialized = false;

var AUDIO_CFG = {
	bow: "assets/bow.mp3",
	arrow: "assets/arrow.mp3",
	bullseye: "assets/bullseye.mp3",
	hit: "assets/hit.mp3",
	miss: "assets/miss.mp3",
	bgm: "assets/bgm.mp3"
};

// all audio from /assets/ folder (relative to index.html)
var AUDIO_BASE = "assets/";

function makeAudio(key) {
	var src = AUDIO_CFG && AUDIO_CFG[key];
	if (!src) {
		console.warn("❌ No audio path configured for key:", key);
		return null;
	}

	var a = new Audio();
	a.src = src;
	a.preload = "auto";

	// DEBUG: log load errors
	a.addEventListener("error", function () {
		console.log("❌ Audio load error for", a.src, "code:", a.error && a.error.code);
	});

	return a;
}


function initAudio() {
	sfxBow = makeAudio("bow");
	sfxArrow = makeAudio("arrow");
	sfxBullseye = makeAudio("bullseye");
	sfxHit = makeAudio("hit");
	sfxMiss = makeAudio("miss");
	bgm = makeAudio("bgm");

	if (sfxBow) sfxBow.volume = 0.8;
	if (sfxArrow) sfxArrow.volume = 0.9;
	if (sfxBullseye) sfxBullseye.volume = 1.0;
	if (sfxHit) sfxHit.volume = 0.9;
	if (sfxMiss) sfxMiss.volume = 0.9;

	if (bgm) {
		bgm.loop = true;
		bgm.volume = 0.4; // tune as you like
	}
}



function notifyParent(type, data) {
	if (window.parent !== window) {
		window.parent.postMessage({ type, ...data }, "*");
	}
}


function playSound(audio) {
	if (!audio) return;
	try {
		audio.currentTime = 0;
		audio
			.play()
			.catch(function (err) {
				console.log("🔇 play() failed for", audio.src, err);
			});
	} catch (e) {
		console.log("🔇 Audio error for", audio && audio.src, e);
	}
}

function restartBGM() {
	if (!bgm) return;
	try {
		bgm.currentTime = 0;
		bgm
			.play()
			.catch(function (err) {
				console.log("🔇 BGM play() failed:", err);
			});
	} catch (e) {
		console.log("🔇 BGM error:", e);
	}
}



// GAME STATE
var MAX_ARROWS = 10;
var BULLSEYE_TARGET = 2; // defaults, overridden by config.json
var arrowsUsed = 0;
var bullseyeCount = 0;
var isGameActive = false;
var inputAttached = false;

// =====================================
// LOAD TEXT + SETTINGS FROM config.json
// =====================================
var TEXT = {};

fetch("config.json")
	.then(res => res.json())
	.then(function (cfg) {
		TEXT = cfg.text || {};

		// Load background image
		if (cfg.images2 && cfg.images2.bg) {
			applyBackground(cfg.images2.bg);
		}

		/* 
		======================================
		⭐ 2.3 — MERGE AUDIO CONFIG FROM JSON ⭐
		======================================
		*/
		if (cfg.audio) {
			AUDIO_CFG = Object.assign({}, AUDIO_CFG, cfg.audio);
		}

		// Load gameplay settings
		if (typeof cfg.maxArrows === "number") {
			MAX_ARROWS = cfg.maxArrows;
		}
		if (typeof cfg.bullseyeTarget === "number") {
			BULLSEYE_TARGET = cfg.bullseyeTarget;
		}

		applyTextFromConfig();
		updateArrowHUD();
		updateTargetHUD();
	})
	.catch(function (err) {
		console.error("Config load error:", err);
	});



// HUD + end-screen elements
var endScreenEl = document.getElementById("end-screen");
var endTitleEl = document.getElementById("end-title");
var endSubtitleEl = document.getElementById("end-subtitle");

var replayBtn = document.getElementById("btn-replay");
var nextBtn = document.getElementById("btn-next");


// center of target
var target = {
	x: 900,
	y: 249.5,
};

// target intersection line segment
var lineSegment = {
	x1: 875,
	y1: 280,
	x2: 925,
	y2: 220,
};

// bow rotation point
var pivot = {
	x: 100,
	y: 250,
};

function applyBackground(bgPath) {
	document.body.style.background = `url("${bgPath}") no-repeat center center fixed`;
	document.body.style.backgroundSize = "cover";
}


// --- helper: normalize mouse/touch event ---
function getPointerEvent(e) {
	if (e.touches && e.touches.length > 0) {
		return e.touches[0];
	}
	if (e.changedTouches && e.changedTouches.length > 0) {
		return e.changedTouches[0];
	}
	return e;
}

// =====================================
// APPLY TEXT TO HTML
// =====================================
function applyTextFromConfig() {
	// HOW TO PLAY
	var htpTitle = document.getElementById("htp-title");
	var htpLine1 = document.getElementById("htp-line1");
	var htpLine2 = document.getElementById("htp-line2");
	var htpTap = document.getElementById("htp-tap");

	if (htpTitle) {
		htpTitle.textContent = TEXT.howToPlayTitle || "HOW TO PLAY";
	}
	if (htpLine1) {
		htpLine1.textContent = TEXT.howToPlayLine1 || "";
	}
	if (htpLine2) {
		htpLine2.textContent = TEXT.howToPlayLine2 || "";
	}
	if (htpTap) {
		htpTap.textContent = TEXT.howToPlayTap || "Tap to Start";
	}

	// HUD
	var arrowCounter = document.getElementById("arrow-counter");
	var bullseyeCounter = document.getElementById("bullseye-counter");

	if (arrowCounter) {
		arrowCounter.textContent =
			(TEXT.hudArrows || "Arrows") + ": " + MAX_ARROWS;
	}

	if (bullseyeCounter) {
		bullseyeCounter.textContent =
			(TEXT.hudBullseyes || "Bullseyes") + ": 0 / " + BULLSEYE_TARGET;
	}

	// END SCREEN
	var endRestart = document.getElementById("end-restart");
	if (endRestart) {
		endRestart.textContent =
			TEXT.tapToRestart || "Tap to restart";
	}
}

// HUD helpers
function updateArrowHUD() {
	var arrowCounter = document.getElementById("arrow-counter");
	if (!arrowCounter) return;

	arrowCounter.textContent =
		(TEXT.hudArrows || "Arrows") +
		": " +
		(MAX_ARROWS - arrowsUsed);
}

function updateTargetHUD() {
	var bullseyeCounter = document.getElementById("bullseye-counter");
	if (!bullseyeCounter) return;

	bullseyeCounter.textContent =
		(TEXT.hudBullseyes || "Bullseyes") +
		": " +
		bullseyeCount +
		" / " +
		BULLSEYE_TARGET;
}

// Reset game state for a fresh round
function resetGameState() {
	arrowsUsed = 0;
	bullseyeCount = 0;
	isGameActive = true;

	updateArrowHUD();
	updateTargetHUD();

	// remove old arrows
	while (arrows.firstChild) {
		arrows.removeChild(arrows.firstChild);
	}

	// hide result texts
	TweenMax.set(".miss, .hit, .bullseye", { autoAlpha: 0 });
}

// initialize aim once game actually starts
function initAim() {
	aim({
		clientX: 320,
		clientY: 300,
	});
}

// attach input listeners once
function attachInputListeners() {
	if (inputAttached) return;
	inputAttached = true;

	// 🎯 Only capture input on the SVG game area, not the whole window
	svg.addEventListener("mousedown", draw);

	svg.addEventListener(
		"touchstart",
		function (e) {
			e.preventDefault();
			draw(e);
		},
		{ passive: false }
	);
}


// global entrypoint called from index.html on first tap
window.startArcheryGame = function () {
	if (!audioInitialized) {
		initAudio();
		audioInitialized = true;
	}

	// 🔊 start background music on first game start
	restartBGM();

	var instructions = document.getElementById("instructions");
	if (instructions) {
		instructions.style.display = "none";
	}

	attachInputListeners();
	resetGameState();
	initAim();
};


function draw(e) {
	// Don't allow shooting when game is inactive or out of arrows
	if (!isGameActive) return;
	if (arrowsUsed >= MAX_ARROWS) return;

	var pe = getPointerEvent(e);

	// play bow stretch sound
	playSound(sfxBow);

	// pull back arrow
	randomAngle = Math.random() * Math.PI * 0.03 - 0.015;
	TweenMax.to(".arrow-angle use", 0.3, {
		opacity: 1,
	});

	window.addEventListener("mousemove", aim);
	window.addEventListener("mouseup", loose);

	window.addEventListener(
		"touchmove",
		function touchMoveHandler(ev) {
			loose._touchMoveHandler = touchMoveHandler;
			ev.preventDefault();
			aim(ev);
		},
		{ passive: false }
	);

	window.addEventListener(
		"touchend",
		function touchEndHandler(ev) {
			loose._touchEndHandler = touchEndHandler;
			loose();
		},
		{ passive: false }
	);

	aim(pe);
}

function aim(e) {
	var pe = getPointerEvent(e);

	// get position in SVG coordinates
	var point = getMouseSVG(pe);
	point.x = Math.min(point.x, pivot.x - 7);
	point.y = Math.max(point.y, pivot.y + 7);
	var dx = point.x - pivot.x;
	var dy = point.y - pivot.y;

	var angle = Math.atan2(dy, dx) + randomAngle;
	var bowAngle = angle - Math.PI;
	var distance = Math.min(Math.sqrt(dx * dx + dy * dy), 50);
	var scale = Math.min(Math.max(distance / 30, 1), 2);

	TweenMax.to("#bow", 0.3, {
		scaleX: scale,
		rotation: bowAngle + "rad",
		transformOrigin: "right center",
	});

	TweenMax.to(".arrow-angle", 0.3, {
		rotation: bowAngle + "rad",
		svgOrigin: "100 250",
	});
	TweenMax.to(".arrow-angle use", 0.3, {
		x: -distance,
	});
	TweenMax.to("#bow polyline", 0.3, {
		attr: {
			points:
				"88,200 " +
				Math.min(pivot.x - (1 / scale) * distance, 88) +
				",250 88,300",
		},
	});

	var radius = distance * 9;
	var offset = {
		x: Math.cos(bowAngle) * radius,
		y: Math.sin(bowAngle) * radius,
	};
	var arcWidth = offset.x * 3;

	TweenMax.to("#arc", 0.3, {
		attr: {
			d:
				"M100,250c" +
				offset.x +
				"," +
				offset.y +
				"," +
				(arcWidth - offset.x) +
				"," +
				(offset.y + 50) +
				"," +
				arcWidth +
				",50",
		},
		autoAlpha: distance / 60,
	});
}

function loose() {
	if (!isGameActive) return;

	window.removeEventListener("mousemove", aim);
	window.removeEventListener("mouseup", loose);

	if (loose._touchMoveHandler) {
		window.removeEventListener("touchmove", loose._touchMoveHandler);
		loose._touchMoveHandler = null;
	}
	if (loose._touchEndHandler) {
		window.removeEventListener("touchend", loose._touchEndHandler);
		loose._touchEndHandler = null;
	}

	// play arrow release sound
	playSound(sfxArrow);

	// this arrow is now used
	arrowsUsed++;
	updateArrowHUD();

	TweenMax.to("#bow", 0.4, {
		scaleX: 1,
		transformOrigin: "right center",
		ease: Elastic.easeOut,
	});
	TweenMax.to("#bow polyline", 0.4, {
		attr: {
			points: "88,200 88,250 88,300",
		},
		ease: Elastic.easeOut,
	});

	// duplicate arrow
	var newArrow = document.createElementNS(
		"http://www.w3.org/2000/svg",
		"use"
	);
	newArrow.setAttributeNS(
		"http://www.w3.org/1999/xlink",
		"href",
		"#arrow"
	);
	arrows.appendChild(newArrow);

	// animate arrow along path
	var path = MorphSVGPlugin.pathDataToBezier("#arc");
	TweenMax.to([newArrow], 0.5, {
		force3D: true,
		bezier: {
			type: "cubic",
			values: path,
			autoRotate: ["x", "y", "rotation"],
		},
		onUpdate: hitTest,
		onUpdateParams: ["{self}"],
		onComplete: onMiss,
		ease: Linear.easeNone,
	});
	TweenMax.to("#arc", 0.3, {
		opacity: 0,
	});

	// hide previous arrow at bow
	TweenMax.set(".arrow-angle use", {
		opacity: 0,
	});
}

// Register outcome for this arrow and check win/lose
function registerOutcome(type) {
	if (!isGameActive) return;

	if (type === "bullseye") {
		bullseyeCount++;
		updateTargetHUD();
		playSound(sfxBullseye);
	} else if (type === "hit") {
		playSound(sfxHit);
	} else if (type === "miss") {
		playSound(sfxMiss);
	}

	// Check win condition
	if (bullseyeCount >= BULLSEYE_TARGET) {
		endGame(true);
	} else if (arrowsUsed >= MAX_ARROWS) {
		// Out of arrows and not enough bullseyes
		endGame(false);
	}
}

function hitTest(tween) {
	// check for collisions with arrow and target
	var arrow = tween.target[0];
	var transform = arrow._gsTransform;
	var radians = (transform.rotation * Math.PI) / 180;
	var arrowSegment = {
		x1: transform.x,
		y1: transform.y,
		x2: Math.cos(radians) * 60 + transform.x,
		y2: Math.sin(radians) * 60 + transform.y,
	};

	var intersection = getIntersection(arrowSegment, lineSegment);
	if (intersection && intersection.segment1 && intersection.segment2) {
		tween.pause();
		var dx = intersection.x - target.x;
		var dy = intersection.y - target.y;
		var distance = Math.sqrt(dx * dx + dy * dy);

		var selector;
		var outcome;
		if (distance < 7) {
			selector = ".bullseye";
			outcome = "bullseye";
		} else {
			selector = ".hit";
			outcome = "hit";
		}

		showMessage(selector);
		registerOutcome(outcome);
	}
}

function onMiss() {
	showMessage(".miss");
	registerOutcome("miss");
}

function showMessage(selector) {
	TweenMax.killTweensOf(selector);
	TweenMax.killChildTweensOf(selector);
	TweenMax.set(selector, {
		autoAlpha: 1,
	});
	TweenMax.staggerFromTo(
		selector + " path",
		0.5,
		{
			rotation: -5,
			scale: 0,
			transformOrigin: "center",
		},
		{
			scale: 1,
			ease: Back.easeOut,
		},
		0.05
	);
	TweenMax.staggerTo(
		selector + " path",
		0.3,
		{
			delay: 2,
			rotation: 20,
			scale: 0,
			ease: Back.easeIn,
		},
		0.03
	);
}

function endGame(didWin) {
	if (!isGameActive) return;
	isGameActive = false;

	if (!endScreenEl) return;

	// Set title + subtitle from TEXT config
	if (didWin) {
		endTitleEl.textContent = TEXT.winTitle || "YOU WIN!";
		endSubtitleEl.textContent = (
			TEXT.winSubtitle ||
			"You hit {bullseyes} bullseyes in {arrows} arrows!"
		)
			.replace("{bullseyes}", bullseyeCount)
			.replace("{arrows}", arrowsUsed);
	} else {
		endTitleEl.textContent = TEXT.loseTitle || "GAME OVER";
		endSubtitleEl.textContent = (
			TEXT.loseSubtitle ||
			"You only hit {bullseyes} bullseyes in {arrows} arrows."
		)
			.replace("{bullseyes}", bullseyeCount)
			.replace("{arrows}", arrowsUsed);
	}

	endScreenEl.style.display = "flex";

	// Ensure buttons exist
	if (!replayBtn || !nextBtn) return;

	// Replay always available
	replayBtn.style.display = "inline-block";
	replayBtn.onclick = function () {
		endScreenEl.style.display = "none";
		resetGameState();
		initAim();
		restartBGM();
	};

	if (didWin) {
		// Show Next only on WIN
		nextBtn.style.display = "inline-block";
		nextBtn.onclick = function () {
			endScreenEl.style.display = "none";
			notifyParent("sceneComplete", { result: "win" });
		};
	} else {
		// Hide Next on lose
		nextBtn.style.display = "none";
		nextBtn.onclick = null;
	}
}


function getMouseSVG(e) {
	cursor.x = e.clientX;
	cursor.y = e.clientY;
	return cursor.matrixTransform(svg.getScreenCTM().inverse());
}

function getIntersection(segment1, segment2) {
	var dx1 = segment1.x2 - segment1.x1;
	var dy1 = segment1.y2 - segment1.y1;
	var dx2 = segment2.x2 - segment2.x1;
	var dy2 = segment2.y2 - segment2.y1;
	var cx = segment1.x1 - segment2.x1;
	var cy = segment1.y1 - segment2.y1;
	var denominator = dy2 * dx1 - dx2 * dy1;
	if (denominator === 0) {
		return null;
	}
	var ua = (dx2 * cy - dy2 * cx) / denominator;
	var ub = (dx1 * cy - dy1 * cx) / denominator;
	return {
		x: segment1.x1 + ua * dx1,
		y: segment1.y1 + ua * dy1,
		segment1: ua >= 0 && ua <= 1,
		segment2: ub >= 0 && ub <= 1,
	};
}
