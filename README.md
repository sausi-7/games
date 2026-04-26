<div align="center">

<img src="assets/logo.svg" alt="Games Hub" width="320" />

# 🎮 Games Hub

### **142 playable browser games. One repo. Zero installs.**

A curated collection of HTML5 / Phaser / Three.js mini-games built while exploring text-to-game AI generation.
Click any card on the live site and play instantly — no build step, no signup, just games.

[![Live Demo](https://img.shields.io/badge/▶_Play_Now-7c87ff?style=for-the-badge&logoColor=white)](https://sausi-7.github.io/games/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge)](LICENSE)
[![Games: 142](https://img.shields.io/badge/games-142-ec4899?style=for-the-badge)](games/registry.json)
[![Made with Phaser](https://img.shields.io/badge/Made_with-Phaser_3-orange?style=for-the-badge)](https://phaser.io/)
[![Stars](https://img.shields.io/github/stars/sausi-7/games?style=for-the-badge&color=yellow)](https://github.com/sausi-7/games/stargazers)

[**▶ Live Demo**](https://sausi-7.github.io/games/) · [**Browse Categories**](#-categories) · [**Add Your Own**](CONTRIBUTING.md) · [**💬 Discussions**](https://github.com/sausi-7/games/discussions)

`games` · `html5-games` · `phaser` · `threejs` · `javascript` · `browser-games` · `mini-games` · `vanilla-js` · `no-build` · `github-pages`

</div>

---

## 🚀 Quick play

> **Just want to play?** → [**sausi-7.github.io/games**](https://sausi-7.github.io/games/)

Or run locally — no dependencies, just a static server:

```bash
git clone https://github.com/sausi-7/games.git
cd games
python3 -m http.server 8000
# open http://localhost:8000
```

Click any card to play. Press <kbd>/</kbd> to search, <kbd>R</kbd> for a random game, <kbd>Esc</kbd> to close the modal.

---

## ✨ What's inside

- **142 fully-playable** browser games — every card on the site loads in an iframe and plays instantly.
- **10 categories** — puzzle, arcade, shooter, racing, sports, platformer, casual, board, word & quiz, and 3D.
- **Single-page launcher** with live search, category filters, dark/light mode, deep-linkable URLs (`#play=snake`).
- **Mobile-friendly** — responsive grid, collapsing modal, touch-first controls.
- **Zero build step** — pure HTML / CSS / JS. Drop on GitHub Pages, Netlify, or any static host.
- **Single source of truth** — all metadata lives in [`games/registry.json`](games/registry.json).

---

## 📚 Categories

| | Category | Count | A few inside |
|---|---|---:|---|
| 🕹️ | **Arcade**     | 40 | Snake · Pac-Man · Flappy · Crossy Road · Bubble Pop |
| 🧩 | **Puzzle**     | 27 | 2048 · Sudoku · Tetris · Cut the Rope · Memory |
| 🎯 | **Shooter**    | 21 | Bird Shooter · Sniper · Alien Battle · Space Fighter |
| 🏃 | **Platformer** | 13 | Mario-Like · Doodle Jump · Parkour · That Level Again × 5 |
| 🏎️ | **Racing**     | 10 | Car Race · Endless Runner · Two Cars · Road Fighter |
| 🎈 | **Casual**     | 9  | Candy Crush · Fruit Merge · Bubble Shooter · Cooking |
| ⚽ | **Sports**     | 7  | Football · Basketball · Cricket · Bowling · Penalty |
| ♟️ | **Board**      | 6  | Chess · Ludo · Carrom · Tic-Tac-Toe · Snake & Ladder |
| 🌐 | **3D**         | 5  | Stack Tower · Orbital Outpost · Planet War (Three.js) |
| 📝 | **Word & Quiz**| 4  | Wordlee · Words of Wonder · Math Quest · Quiz |

> Browse the full list and metadata in [`games/registry.json`](games/registry.json).

---

## 🌟 Featured games

|  | Name | Tech | Try it |
|---|---|---|---|
| 🐍 | **Snake** — eat, grow, don't hit yourself | Phaser | [Play](https://sausi-7.github.io/games/#play=snake) |
| 🔢 | **2048** — slide, merge, hit 2048 | Phaser | [Play](https://sausi-7.github.io/games/#play=2048) |
| ♟️ | **Chess** — classic chess vs the computer | Phaser | [Play](https://sausi-7.github.io/games/#play=chess) |
| 🏎️ | **Car Race** — 3D traffic-dodging racer | Three.js | [Play](https://sausi-7.github.io/games/#play=car-race) |
| 🏗️ | **Stack Tower** — stack 3D blocks higher | Three.js | [Play](https://sausi-7.github.io/games/#play=stack-tower) |
| 🅰️ | **Wordlee** — guess the 5-letter word | HTML5 | [Play](https://sausi-7.github.io/games/#play=wordle) |

---

## 🛠 Tech stack

- **[Phaser 3](https://phaser.io/)** — primary 2D game engine (~90% of games).
- **[Three.js](https://threejs.org/)** — for the 3D titles.
- **Vanilla HTML/CSS/JS** — for the landing page launcher. No bundler, no React, no framework.
- **Static-only** — deploys to GitHub Pages with zero config.

---

## 📁 Project structure

```
games/
├── 3d/             # 3D titles (Three.js)
├── arcade/         # Snake, Pac-Man, Flappy, …
├── board/          # Chess, Ludo, …
├── casual/         # Match-3, idle, cooking, …
├── platformer/     # Mario-likes, Doodle Jump, …
├── puzzle/         # 2048, Sudoku, Tetris, …
├── racing/         # Car Race, Two Cars, …
├── shooter/        # Bird Shooter, Sniper, …
├── sports/         # Football, Basketball, …
├── word-quiz/      # Wordlee, Quiz, …
└── registry.json   # ⭐ source of truth — every game listed here
site/
├── app.js          # grid + search + modal player
└── styles.css      # theme + layout
assets/             # logo, favicon, og-image
index.html          # landing page
```

Each individual game lives in its own folder with `index.html`, `assets/`, and (usually) a `config.json` and `mechanics.js`. Games are self-contained and use only **relative paths** internally, so they'll keep working even if you copy a folder elsewhere.

---

## 🧩 Adding a new game

1. Drop your game folder into the right category, e.g. `games/puzzle/my-cool-puzzle/`. Make sure it has its own `index.html`.
2. Add an entry to [`games/registry.json`](games/registry.json):
   ```json
   {
     "slug": "my-cool-puzzle",
     "name": "My Cool Puzzle",
     "category": "puzzle",
     "path": "games/puzzle/my-cool-puzzle/index.html",
     "tech": "phaser",
     "tags": ["logic", "tiles"],
     "description": "One-line pitch shown on the card."
   }
   ```
3. (Optional) Add an emoji override in [`site/app.js`](site/app.js) `GAME_EMOJI`.
4. Open a PR. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full checklist.

---

## 🗺 Roadmap

- [ ] Per-game screenshot thumbnails (auto-captured via Playwright)
- [ ] Local high-score storage per game
- [ ] Audio mute toggle in the modal
- [ ] Categorize by play time (60s · 5min · session)
- [ ] PWA install support
- [ ] Game submission via GitHub Issues template
- [ ] More Three.js / WebGL titles

Got an idea? [Open an issue](https://github.com/sausi-7/games/issues/new/choose).

---

## 🤝 Contributing

PRs welcome — from new games, to bug fixes, to landing-page polish.

- 📖 Start with [CONTRIBUTING.md](CONTRIBUTING.md) for the dev setup and code style.
- 🌱 Browse [**`good first issue`**](https://github.com/sausi-7/games/issues?q=is%3Aopen+is%3Aissue+label%3A%22good+first+issue%22) — friendly tasks for newcomers.
- 🆘 Browse [**`help wanted`**](https://github.com/sausi-7/games/issues?q=is%3Aopen+is%3Aissue+label%3A%22help+wanted%22) — bigger projects looking for an owner.
- 💬 Got an idea or just want to chat? [Open a discussion](https://github.com/sausi-7/games/discussions).
- 🐛 Bug in a game? [File a bug](https://github.com/sausi-7/games/issues/new/choose) — include the game's slug (e.g. `bug: snake — wall collision wrong`).

By participating you agree to follow the [Code of Conduct](.github/CODE_OF_CONDUCT.md). Found a security issue? See [SECURITY.md](SECURITY.md) — please don't open a public issue for those.

### 💖 Support the project

If you'd like to help fund continued work on the collection, you can [sponsor on GitHub](https://github.com/sponsors/sausi-7) — every bit helps and is hugely appreciated.

A free way to support: **[give the repo a ⭐](https://github.com/sausi-7/games/stargazers)** and share it with friends. Stars genuinely help it reach more people.

---

## 📈 Star history

<a href="https://star-history.com/#sausi-7/games&Date">
  <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=sausi-7/games&type=Date" width="640" />
</a>

---

## 📜 License

[MIT](LICENSE) © 2026 Saurabh Singh

You're free to fork, remix, and ship. Attribution appreciated, not required.

---

## 🙏 Acknowledgements

- [Phaser](https://phaser.io/) and [Three.js](https://threejs.org/) — the engines under almost everything here.
- These games were built and iterated using **[Pikoo](https://pikoo.ai)** — a free AI-powered game-creation agent. If you want to build your own micro-games, that's a great starting point.

---

<div align="center">

If this collection made you smile, [**give it a ⭐**](https://github.com/sausi-7/games/stargazers) — it genuinely helps it reach more people.

</div>
