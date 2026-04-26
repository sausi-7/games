/* =========================================================
   Games Hub — landing page logic
   - Loads games/registry.json
   - Renders grid, search, category filters
   - Modal iframe player with deep-link via URL hash
   ========================================================= */

const GH_REPO = "sausi-7/games";

// per-category emoji used as the visual on cards
const CATEGORY_EMOJI_FALLBACK = {
  puzzle: "🧩",
  arcade: "🕹️",
  shooter: "🎯",
  racing: "🏎️",
  sports: "⚽",
  platformer: "🏃",
  casual: "🎈",
  board: "♟️",
  "word-quiz": "📝",
  "3d": "🌐",
};

// per-category gradient pair for the card art
const CATEGORY_GRAD = {
  puzzle:     ["#7c3aed", "#4c1d95"],
  arcade:     ["#ec4899", "#831843"],
  shooter:    ["#ef4444", "#7f1d1d"],
  racing:     ["#f59e0b", "#7c2d12"],
  sports:     ["#10b981", "#064e3b"],
  platformer: ["#06b6d4", "#0c4a6e"],
  casual:     ["#f472b6", "#831843"],
  board:      ["#64748b", "#1e293b"],
  "word-quiz":["#3b82f6", "#1e3a8a"],
  "3d":       ["#8b5cf6", "#4c1d95"],
};

// per-game emoji overrides (fall back to category emoji)
const GAME_EMOJI = {
  "2048": "🔢", "tetris": "🟦", "snake": "🐍", "curve-snake": "🐍",
  "snake-and-ladder": "🎲", "chess": "♟️", "ludo": "🎲", "tic-tac-toe": "⭕",
  "rock-paper-scissors": "✊", "carrom": "🪙", "sudoku": "🔢",
  "memory": "🧠", "memory-cards": "🧠", "pacman": "👻", "flappy": "🐤",
  "mario": "🍄", "doodle-jump": "⬆️", "bubble-shooter": "🫧", "bubble-pop": "🫧",
  "candy-crush": "🍬", "candy-crusher": "🍬", "fruit-merge": "🍇",
  "fruit-basket": "🧺", "fruit-cosmics": "🍓", "cooking": "👨‍🍳",
  "buttermilk": "🥛", "wordle": "🅰️", "words-of-wonder": "🔠",
  "math-quest": "➕", "quiz": "❓", "football": "⚽", "basketball": "🏀",
  "bowling": "🎳", "cricket-123": "🏏", "table-tennis": "🏓",
  "archer": "🏹", "penalty": "🥅",
  "bird-shooter": "🐦", "alien-battle": "👾", "fighter-jet": "✈️",
  "fighter-fury": "✈️", "sniper": "🔭", "shooter": "🔫", "shoot-enemy": "🎯",
  "cannon-blaster": "💥", "robot-destruction": "🤖", "vaccine-shooter": "💉",
  "tower-shooter": "🗼", "tee-shooter": "🏌️", "thunder-god": "⚡",
  "shadow-shooter": "🌑", "space-fighter": "🚀", "trench-defence": "🪖",
  "gunman": "🤠", "gun-run": "🔫", "projectile-enemy": "🎯",
  "survivor": "🧟",
  "car-race": "🏎️", "road-fighter": "🚗", "one-car": "🚙", "two-cars": "🚗",
  "two-cars-ai": "🤖", "endless-runner": "🏃", "forest-runner": "🌲",
  "shadow-runner": "🌑", "survival-run": "🏃", "straight-rush": "💨",
  "antigravity": "🌀", "cool-platformer": "🦘", "flip-jump": "🔄",
  "parkour": "🤸", "devil-king": "😈", "level-devil": "😈",
  "that-level-again-1": "🔁", "that-level-again-2": "🔁",
  "that-level-again-3": "🔁", "that-level-again-4": "🔁",
  "that-level-again-5": "🔁",
  "stack-tower": "🏗️", "cosmic-cleaner": "🧹", "orbital-outpost": "🛰️",
  "planet-visitor": "🪐", "planet-war": "🪐",
  "hex-puzzle": "⬡", "cut-rope": "✂️", "connected": "🔗", "link": "🔗",
  "laser-bounce": "💡", "circuit-bulb": "💡", "signal-circuit": "📡",
  "colour-pour": "🧪", "screw-master": "🔩", "shape-fitter": "🧩",
  "shape-collector": "🔷", "perfect-square": "⬜", "tile-tap": "🎹",
  "slide-puzzle": "🧩", "pathfinder": "🧭", "number-merge": "🔢",
  "four-dots": "🔵", "cargo-stack": "📦", "pairing": "🃏",
  "line-trap": "✏️", "unruly": "⚪", "6oct": "🔶", "square-one": "🔲",
  "circle-path": "⭕", "color-dash": "🎨", "balance-stack": "📚",
  "bomb-blast": "💣", "boom-dots": "💥", "bug-smasher": "🐛",
  "whack-a-bug": "🐞", "tap-target": "🎯", "kaiju-krush": "🦖",
  "crowd-control": "👥", "crossy-road": "🛣️", "road-cross": "🛣️",
  "red-light-green-light": "🚦", "glass-step": "🪟", "swipe-assassin": "🗡️",
  "fly-monkey": "🐒", "hungry-player": "😋", "jump-dot": "⬆️",
  "demon": "👹", "abhita": "✨", "ellars": "✨", "dream-weaver": "💭",
  "endless-mafia": "🕴️", "dodge-enemy": "💨", "dodge-master": "💨",
  "catch-me-if-you-can": "🏃", "collector": "💎", "pirates": "🏴‍☠️",
  "spaceman": "👨‍🚀", "space-waves": "🌊", "sky-high": "🪂",
  "luma-bounce": "🟡", "stick-game": "🪵", "stick-toss": "🪵",
  "breakoid": "🧱", "window-shooter": "🪟", "tile": "🎹",
};

const els = {
  grid: document.getElementById("grid"),
  empty: document.getElementById("empty"),
  search: document.getElementById("search-input"),
  filters: document.getElementById("filters"),
  stats: document.getElementById("stats"),
  themeToggle: document.getElementById("theme-toggle"),
  themeIcon: document.querySelector(".theme-icon"),
  starCount: document.getElementById("star-count"),
  randomBtn: document.getElementById("random-game"),
  clearFilters: document.getElementById("clear-filters"),
  modal: document.getElementById("modal"),
  modalTitle: document.getElementById("modal-title"),
  modalChip: document.getElementById("modal-chip"),
  modalFrame: document.getElementById("modal-frame"),
  modalOpen: document.getElementById("modal-open"),
  modalReload: document.getElementById("modal-reload"),
  modalFs: document.getElementById("modal-fullscreen"),
};

const state = {
  games: [],
  categories: [],
  q: "",
  category: "all",
};

// ---------- Init ----------
init();

async function init() {
  loadTheme();
  attachUiEvents();

  try {
    const res = await fetch("games/registry.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`registry fetch ${res.status}`);
    const data = await res.json();
    state.games = data.games || [];
    state.categories = data.categories || [];
  } catch (err) {
    console.error("Failed to load registry:", err);
    els.grid.innerHTML = `<p style="grid-column:1/-1;color:var(--text-dim);text-align:center;padding:40px">
      Couldn't load <code>games/registry.json</code>. Are you serving over HTTP? Try <code>python -m http.server</code>.</p>`;
    return;
  }

  renderStats();
  renderFilters();
  renderGrid();
  hydrateFromHash();
  fetchStarCount();
}

// ---------- Theme ----------
function loadTheme() {
  const saved = localStorage.getItem("theme");
  const initial = saved || "light";
  setTheme(initial);
}
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  els.themeIcon.textContent = t === "light" ? "☀️" : "🌙";
  localStorage.setItem("theme", t);
}

// ---------- UI events ----------
function attachUiEvents() {
  els.themeToggle.addEventListener("click", () => {
    setTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light");
  });
  els.search.addEventListener("input", (e) => {
    state.q = e.target.value.trim().toLowerCase();
    renderGrid();
  });
  els.randomBtn.addEventListener("click", playRandom);
  if (els.clearFilters) {
    els.clearFilters.addEventListener("click", () => {
      state.q = "";
      state.category = "all";
      els.search.value = "";
      renderFilters();
      renderGrid();
    });
  }

  // Modal close buttons
  els.modal.querySelectorAll("[data-close]").forEach((el) =>
    el.addEventListener("click", closeModal)
  );
  els.modalReload.addEventListener("click", () => {
    const src = els.modalFrame.getAttribute("src");
    els.modalFrame.setAttribute("src", "about:blank");
    requestAnimationFrame(() => els.modalFrame.setAttribute("src", src));
  });
  els.modalFs.addEventListener("click", () => {
    const target = els.modal.querySelector(".modal__panel");
    if (!document.fullscreenElement) target.requestFullscreen?.();
    else document.exitFullscreen?.();
  });

  // Keyboard
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !els.modal.hidden) {
      closeModal();
      return;
    }
    if (e.target.matches("input, textarea")) return;
    if (e.key === "/") { e.preventDefault(); els.search.focus(); }
    else if (e.key.toLowerCase() === "r" && els.modal.hidden) playRandom();
  });

  // Hash changes
  window.addEventListener("hashchange", hydrateFromHash);
}

// ---------- Stats ----------
function renderStats() {
  const counts = {};
  for (const g of state.games) counts[g.category] = (counts[g.category] || 0) + 1;
  const top = state.categories
    .map((c) => ({ c, n: counts[c.id] || 0 }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 4);
  els.stats.innerHTML = `
    <span class="stat"><span class="stat__num">${state.games.length}</span> games</span>
    ${top.map(({ c, n }) => `<span class="stat"><span class="stat__num">${n}</span> ${c.emoji} ${c.label}</span>`).join("")}
  `;
}

// ---------- Filters ----------
function renderFilters() {
  const counts = {};
  for (const g of state.games) counts[g.category] = (counts[g.category] || 0) + 1;
  const all = `<button class="chip" type="button" data-cat="all" aria-pressed="${state.category === "all"}">
    All <span class="chip__count">${state.games.length}</span>
  </button>`;
  const cats = state.categories
    .map((c) => `<button class="chip" type="button" data-cat="${c.id}" aria-pressed="${state.category === c.id}">
      <span aria-hidden="true">${c.emoji}</span> ${c.label}
      <span class="chip__count">${counts[c.id] || 0}</span>
    </button>`)
    .join("");
  els.filters.innerHTML = all + cats;
  els.filters.querySelectorAll(".chip").forEach((btn) =>
    btn.addEventListener("click", () => {
      state.category = btn.dataset.cat;
      renderFilters();
      renderGrid();
    })
  );
}

// ---------- Grid ----------
function renderGrid() {
  const filtered = state.games.filter((g) => {
    if (state.category !== "all" && g.category !== state.category) return false;
    if (!state.q) return true;
    const hay = `${g.name} ${g.category} ${(g.tags || []).join(" ")} ${g.description}`.toLowerCase();
    return hay.includes(state.q);
  });

  if (!filtered.length) {
    els.grid.innerHTML = "";
    els.empty.hidden = false;
    return;
  }
  els.empty.hidden = true;

  els.grid.innerHTML = filtered.map(renderCard).join("");
  els.grid.querySelectorAll(".card").forEach((card) =>
    card.addEventListener("click", () => openGame(card.dataset.slug))
  );
}

function renderCard(g) {
  const emoji = GAME_EMOJI[g.slug] || CATEGORY_EMOJI_FALLBACK[g.category] || "🎮";
  const grad = CATEGORY_GRAD[g.category] || ["#444", "#222"];
  const cat = state.categories.find((c) => c.id === g.category);
  const techLabel = g.tech === "phaser" ? "Phaser" : g.tech === "three" ? "Three.js" : "HTML5";
  return `
    <button class="card" data-slug="${g.slug}" data-category="${g.category}"
      style="--card-c1:${grad[0]};--card-c2:${grad[1]}" aria-label="Play ${escapeAttr(g.name)}">
      <div class="card__art">
        <span class="card__emoji" aria-hidden="true">${emoji}</span>
        <span class="card__play" aria-hidden="true">▶</span>
      </div>
      <div class="card__body">
        <h3 class="card__title">${escapeHtml(g.name)}</h3>
        <p class="card__desc">${escapeHtml(g.description || "")}</p>
        <div class="card__meta">
          <span class="card__chip">${cat?.emoji || ""} ${cat?.label || g.category}</span>
          <span class="card__tech">${techLabel}</span>
        </div>
      </div>
    </button>
  `;
}

// ---------- Modal player ----------
function openGame(slug) {
  const g = state.games.find((x) => x.slug === slug);
  if (!g) return;
  const cat = state.categories.find((c) => c.id === g.category);
  els.modalTitle.textContent = g.name;
  els.modalChip.textContent = `${cat?.emoji || ""} ${cat?.label || g.category}`;
  els.modalChip.style.background = CATEGORY_GRAD[g.category]?.[0] || "var(--accent)";
  els.modalFrame.setAttribute("src", g.path);
  els.modalOpen.setAttribute("href", g.path);
  els.modal.hidden = false;
  document.body.style.overflow = "hidden";
  if (location.hash !== `#play=${slug}`) {
    history.replaceState(null, "", `#play=${slug}`);
  }
}

function closeModal() {
  els.modal.hidden = true;
  els.modalFrame.setAttribute("src", "about:blank");
  document.body.style.overflow = "";
  if (location.hash.startsWith("#play=")) {
    history.replaceState(null, "", location.pathname + location.search);
  }
  if (document.fullscreenElement) document.exitFullscreen?.();
}

function hydrateFromHash() {
  const m = location.hash.match(/^#play=([\w-]+)/);
  if (m) openGame(m[1]);
  else if (!els.modal.hidden) closeModal();
}

function playRandom() {
  if (!state.games.length) return;
  const pool = state.category === "all"
    ? state.games
    : state.games.filter((g) => g.category === state.category);
  const pick = pool[Math.floor(Math.random() * pool.length)];
  openGame(pick.slug);
}

// ---------- Star count (cached 1h) ----------
async function fetchStarCount() {
  const cached = readCache("gh_stars", 60 * 60 * 1000);
  if (cached != null) return showStars(cached);
  try {
    const res = await fetch(`https://api.github.com/repos/${GH_REPO}`);
    if (!res.ok) return;
    const data = await res.json();
    if (typeof data.stargazers_count === "number") {
      writeCache("gh_stars", data.stargazers_count);
      showStars(data.stargazers_count);
    }
  } catch {}
}
function showStars(n) {
  els.starCount.hidden = false;
  els.starCount.querySelector("em").textContent = formatNum(n);
}
function readCache(key, maxAgeMs) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { v, t } = JSON.parse(raw);
    if (Date.now() - t > maxAgeMs) return null;
    return v;
  } catch { return null; }
}
function writeCache(key, v) {
  try { localStorage.setItem(key, JSON.stringify({ v, t: Date.now() })); } catch {}
}
function formatNum(n) {
  return n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : String(n);
}

// ---------- Helpers ----------
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
