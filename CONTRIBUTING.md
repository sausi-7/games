# Contributing to Games Hub

Thanks for wanting to add to the collection! This repo is intentionally simple: pure HTML/CSS/JS, no build step. PRs are very welcome.

## Quick start

```bash
git clone https://github.com/sausi-7/games.git
cd games
python3 -m http.server 8000
# open http://localhost:8000
```

The landing page reads [`games/registry.json`](games/registry.json) — every game listed there shows up as a card.

## Ways to contribute

- 🎮 **Add a new game** — drop a folder, add a registry entry.
- 🐛 **Fix a bug** in an existing game (use the bug-report template).
- 🎨 **Polish the landing page** — accessibility, performance, theming.
- 📚 **Improve docs** — typos, clarity, screenshots.
- ⭐ **Star the repo** — seriously, it really helps.

## Adding a new game

### 1. Drop your game folder

Pick the right category (or propose a new one) and add your folder under `games/<category>/<slug>/`. Slugs use lowercase + dashes (e.g. `my-cool-puzzle`).

```
games/puzzle/my-cool-puzzle/
├── index.html        # required — entry point
├── assets/           # images, audio, fonts
├── config.json       # optional — game-specific config
└── (any JS/CSS/etc.)
```

**Rules of thumb:**
- The game must run by opening just `index.html` (it'll be loaded in an iframe).
- Use **relative paths only** (`./assets/foo.png`, not `/assets/foo.png`).
- Keep total folder size reasonable (< 5 MB ideally). Compress images.
- It must work on mobile + desktop.

### 2. Add a registry entry

Edit [`games/registry.json`](games/registry.json) and append your game to `games`:

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

| Field | What it is |
|---|---|
| `slug` | URL-safe id (`my-cool-puzzle`) — must be unique across all games |
| `name` | Display name shown on the card and modal |
| `category` | One of: `puzzle`, `arcade`, `shooter`, `racing`, `sports`, `platformer`, `casual`, `board`, `word-quiz`, `3d` |
| `path` | Relative path to the game's `index.html` |
| `tech` | `phaser`, `three`, or `html` |
| `tags` | 1–4 short tags used by the search — lowercase |
| `description` | One-line pitch (~80 chars) |

### 3. (Optional) Add a card emoji

If your game's category emoji isn't a great fit, add an override in [`site/app.js`](site/app.js) inside `GAME_EMOJI`:

```js
"my-cool-puzzle": "🧩",
```

### 4. Open a PR

Fill in the PR template checklist. We'll review and merge.

## PR checklist

- [ ] Game folder is under `games/<category>/<slug>/` with a working `index.html`
- [ ] Registry entry added in `games/registry.json` with a unique slug
- [ ] Tested locally with `python -m http.server` — card opens, game plays
- [ ] All asset paths are **relative** (no leading `/`)
- [ ] No console errors
- [ ] Works on at least one mobile viewport (375×667)
- [ ] License-compatible — no copyrighted assets you don't have rights to

## Bug reports

Use the **bug report** issue template. Include:
- The game **slug** (visible in the URL when the modal is open: `#play=snake`)
- What you expected vs. what happened
- Browser + OS
- Console errors if any

## Code style

- Vanilla JS — no TypeScript, no React, no bundler.
- 2-space indent, double quotes in JS, single quotes in HTML attributes.
- Keep `site/app.js` and `site/styles.css` framework-free.
- Per-game code can use whatever style matches that game.

## License

By contributing, you agree your contribution is licensed under the MIT License (same as the repo).
