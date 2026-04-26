#!/usr/bin/env bash
# One-shot script to configure the GitHub repo for maximum discoverability.
# Run this AFTER you've pushed the repo to GitHub. Requires the `gh` CLI:
#   brew install gh && gh auth login
#
# Usage:  ./.github/setup-repo.sh
# Or:     REPO=sausi-7/games ./.github/setup-repo.sh

set -euo pipefail

REPO="${REPO:-sausi-7/games}"
DEMO_URL="https://sausi-7.github.io/games/"
DESCRIPTION="🎮 142 playable browser games in one repo. Click and play instantly — no installs, no signups. Built with Phaser, Three.js, and vanilla JS."

echo "▶ Configuring $REPO ..."

# ---------- About panel: description, homepage, topics ----------
echo "  · Setting description + homepage"
gh repo edit "$REPO" \
  --description "$DESCRIPTION" \
  --homepage "$DEMO_URL" \
  --enable-issues \
  --enable-discussions \
  --enable-wiki=false

echo "  · Setting topics"
gh repo edit "$REPO" \
  --add-topic games \
  --add-topic html5-games \
  --add-topic browser-games \
  --add-topic javascript \
  --add-topic phaser \
  --add-topic phaser3 \
  --add-topic threejs \
  --add-topic mini-games \
  --add-topic game-collection \
  --add-topic github-pages \
  --add-topic vanilla-js \
  --add-topic no-build \
  --add-topic web-games \
  --add-topic open-source-games

# ---------- Labels ----------
echo "  · Creating labels"
create_label() {
  local name="$1" color="$2" desc="$3"
  gh label create "$name" --repo "$REPO" --color "$color" --description "$desc" --force >/dev/null 2>&1 || true
}
create_label "good first issue"  "7057ff" "Good for newcomers"
create_label "help wanted"       "008672" "Extra attention is needed"
create_label "new game"          "0e8a16" "Adding a new game to the collection"
create_label "landing page"      "1d76db" "Affects the launcher / index page"
create_label "performance"       "fbca04" "Performance improvement"
create_label "a11y"              "5319e7" "Accessibility improvement"
create_label "mobile"            "c5def5" "Mobile-specific issue"
create_label "discussion"        "d4c5f9" "Open question / RFC"

# ---------- Starter issues ----------
echo "  · Creating starter issues"
create_issue() {
  local title="$1" body="$2" labels="$3"
  gh issue create --repo "$REPO" --title "$title" --body "$body" --label "$labels" >/dev/null
  echo "    ✓ $title"
}

create_issue "Add per-game screenshot thumbnails" \
"Right now each card uses a category-colored gradient + emoji as the visual. We should auto-capture a real screenshot of each game.

**Approach**
- Add a Node script using Playwright that walks \`games/registry.json\`, opens each game in a headless browser, waits ~3s for first paint, and screenshots a 16:10 region.
- Save to \`games/<category>/<slug>/thumb.webp\`.
- Update the card render in \`site/app.js\` to prefer \`thumb.webp\` if present, fall back to the gradient-emoji art.

**Why a good first issue**
- Self-contained — no need to touch any individual game's code.
- Big visual impact for users browsing the grid.

Drop a comment if you want to take this on." \
"good first issue,help wanted,landing page"

create_issue "Add audio mute toggle to the modal player" \
"The modal opens games in an iframe but there's no global mute. Add a 🔊 / 🔇 button next to the fullscreen / restart buttons.

**Approach**
- Add the button in [index.html](../blob/main/index.html) modal toolbar.
- Use \`postMessage\` to the iframe so individual games can opt in (most won't), but as a fallback set \`iframe.allow=\"autoplay 'none'\"\` or use the muted attribute trick.
- Persist the preference in \`localStorage\`.

Good first issue if you've worked with iframe messaging before." \
"good first issue,help wanted"

create_issue "Add localStorage high-score support" \
"Most games already track a score internally but throw it away when you close the modal. We can persist per-game high scores on the launcher side.

**Approach**
- Define a tiny postMessage protocol: games \`postMessage({type:'score', value:N})\`.
- The launcher catches it, stores \`localStorage[\"hs:<slug>\"] = max(prev, N)\`.
- Show the high score under the title in the modal bar.
- Document the protocol in CONTRIBUTING.md so new games can opt in.

Existing games keep working unchanged." \
"help wanted"

create_issue "Make the site installable as a PWA" \
"Add a \`manifest.webmanifest\` + minimal service worker so users can 'install to home screen' and play offline.

**Acceptance**
- Lighthouse PWA audit passes.
- Works offline for at least the landing page + most-recently-played games.
- Existing iframe-game flow keeps working.

Bonus: pre-cache the most-popular 10 games." \
"help wanted"

create_issue "Add a 'play time' filter (60s / 5min / session)" \
"A lot of these are bite-sized — let users filter by how long a game takes.

**Approach**
- Add a \`playtime\` field to each registry entry: \`\"60s\" | \"5min\" | \"session\"\`.
- Add a filter row under the category chips.
- Backfill values for the 142 existing games (PR can do a few categories at a time).

Open to a 'difficulty' filter at the same time if anyone wants to stack PRs." \
"good first issue,help wanted"

create_issue "Add a share button to the modal" \
"Each game has a deep-link (\`#play=snake\`). Let people share it.

**Approach**
- Add a 'Share' button in the modal toolbar.
- Use \`navigator.share\` on mobile, fall back to copying the URL on desktop with a toast.

Should be ~30 lines of code." \
"good first issue"

create_issue "i18n: translate the landing page" \
"The launcher is English-only. Let's support a few more languages — start with one PR per language.

**Approach**
- Extract user-facing strings in \`site/app.js\` and \`index.html\` into a tiny dictionary.
- Add a language picker in the footer (defaults to the browser language).
- Persist choice in localStorage.

Welcome contributions for: 🇪🇸 Spanish, 🇫🇷 French, 🇩🇪 German, 🇮🇳 Hindi, 🇨🇳 Chinese, 🇯🇵 Japanese, 🇧🇷 Portuguese." \
"good first issue,help wanted"

create_issue "Add a keyboard-shortcut help overlay" \
"Press \`?\` to show a panel listing all the shortcuts (\`/\` search, \`R\` random, \`Esc\` close, etc.). Closes on \`Esc\` or click-outside.

Small, self-contained, very 'good first issue'." \
"good first issue"

create_issue "Discussion: which games would you most like added next?" \
"Open thread for the community to suggest new games. Drop a comment with:

- Game name
- 1-line pitch
- Optional: link to inspiration / similar game
- Optional: are you up for building it yourself?

Maintainers will turn the most-upvoted suggestions into 'new game' issues." \
"discussion,new game"

echo ""
echo "✅ Done. Visit the repo to confirm:"
echo "   https://github.com/$REPO"
echo ""
echo "Manual follow-ups (one-time, web UI only):"
echo "  1. Settings → Pages → Source: 'GitHub Actions'"
echo "  2. Settings → General → Features → tick 'Discussions' if not enabled by gh above"
echo "  3. (Optional) Settings → Features → enable 'Sponsorships' to activate FUNDING.yml"
