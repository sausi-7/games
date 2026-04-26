## What's in this PR?

<!-- One or two sentences. New game? Bug fix? Polish? -->

## Type

- [ ] 🎮 New game
- [ ] 🐛 Bug fix
- [ ] 🎨 Landing page / docs polish
- [ ] 📚 Docs only
- [ ] 🔧 Tooling / refactor

## Checklist

### If adding a game
- [ ] Game folder lives under `games/<category>/<slug>/`
- [ ] Folder has a working `index.html` that opens standalone
- [ ] All asset paths are **relative** (no leading `/`)
- [ ] Entry added to `games/registry.json` with a unique `slug`
- [ ] Tested locally: `python -m http.server` → card opens → game plays
- [ ] Works on a mobile-width viewport (375 × 667)

### If fixing a bug
- [ ] Linked the issue this fixes (`Fixes #...`)
- [ ] Verified the fix in the browser
- [ ] No new console errors

### Always
- [ ] No copyrighted/unlicensed assets
- [ ] No tracking, ads, or required signup added
- [ ] PR title is descriptive

## Screenshots / GIF

<!-- Drag in a screenshot of the new game or the bug fix in action. -->
