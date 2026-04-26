#!/usr/bin/env python3
"""One-shot restructure: move Custom*/ folders into games/<category>/<slug>/
and emit games/registry.json. Idempotent-ish: skips folders already moved."""
import json, os, shutil, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GAMES_DIR = ROOT / "games"

CATEGORIES = [
    {"id": "puzzle",     "label": "Puzzle",       "emoji": "🧩", "color": "#7c3aed"},
    {"id": "arcade",     "label": "Arcade",       "emoji": "🕹️",  "color": "#ec4899"},
    {"id": "shooter",    "label": "Shooter",      "emoji": "🎯", "color": "#ef4444"},
    {"id": "racing",     "label": "Racing",       "emoji": "🏎️",  "color": "#f59e0b"},
    {"id": "sports",     "label": "Sports",       "emoji": "⚽", "color": "#10b981"},
    {"id": "platformer", "label": "Platformer",   "emoji": "🏃", "color": "#06b6d4"},
    {"id": "casual",     "label": "Casual",       "emoji": "🎈", "color": "#f472b6"},
    {"id": "board",      "label": "Board",        "emoji": "♟️",  "color": "#64748b"},
    {"id": "word-quiz",  "label": "Word & Quiz",  "emoji": "📝", "color": "#3b82f6"},
    {"id": "3d",         "label": "3D",           "emoji": "🌐", "color": "#8b5cf6"},
]

# (folder, category, slug, name, description, tags)
GAMES = [
    ("Custom2048",            "puzzle",     "2048",                "2048",                "Slide tiles. Merge matching numbers. Reach 2048.",                ["merge","numbers","classic"]),
    ("Custom6oct",            "puzzle",     "6oct",                "6 Octagons",          "Octagon-tile sliding puzzle.",                                    ["tiles","minimal"]),
    ("CustomRPS",             "board",      "rock-paper-scissors", "Rock Paper Scissors", "The timeless hand game vs the AI.",                                ["classic","quick"]),
    ("CustomSudoku",          "puzzle",     "sudoku",              "Sudoku",              "Classic 9x9 number logic puzzle.",                                ["logic","numbers","classic"]),
    ("Customabhita",          "arcade",     "abhita",              "Abhita",              "Reflex-driven dodge mini-game.",                                  ["reflex","dodge"]),
    ("Customalienbattle",     "shooter",    "alien-battle",        "Alien Battle",        "Top-down alien shooter. Survive the swarm.",                      ["aliens","top-down","survival"]),
    ("Customantigravity",     "platformer", "antigravity",         "Anti-Gravity",        "Flip gravity to navigate hazards.",                               ["physics","gravity"]),
    ("Customarcher",          "sports",     "archer",              "Archer",              "Aim, draw, and release. Hit your target.",                        ["bow","aim","precision"]),
    ("Custombalancestack",    "arcade",     "balance-stack",       "Balance Stack",       "Stack blocks without toppling the tower.",                        ["stacking","balance"]),
    ("Custombasketball",      "sports",     "basketball",          "Basketball",          "Arc the ball through the hoop.",                                  ["hoops","arcade-sports"]),
    ("Custombirdshooter",     "shooter",    "bird-shooter",        "Bird Shooter",        "Track and shoot flying birds.",                                   ["aim","reflex"]),
    ("Custombombblast",       "arcade",     "bomb-blast",          "Bomb Blast",          "Time the blast to chain destruction.",                            ["explosions","timing"]),
    ("Customboomdots",        "arcade",     "boom-dots",           "Boom Dots",           "Tap to detonate dots and clear the screen.",                      ["chain","reflex"]),
    ("Custombowling",         "sports",     "bowling",             "Bowling",             "Knock down all the pins.",                                        ["pins","aim","sport"]),
    ("Custombreakoid",        "arcade",     "breakoid",            "Breakoid",            "Breakout-style brick smashing.",                                  ["brick","paddle","classic"]),
    ("Custombubblepop",       "casual",     "bubble-pop",          "Bubble Pop",          "Pop matching bubbles to score.",                                  ["match","bubbles","relaxing"]),
    ("Custombubbleshooter",   "casual",     "bubble-shooter",      "Bubble Shooter",      "Shoot bubbles into matching color clusters.",                     ["match-3","shooter","classic"]),
    ("Custombugsmasher",      "arcade",     "bug-smasher",         "Bug Smasher",         "Squash bugs before they reach the goal.",                         ["whack","reflex"]),
    ("Custombuttermilk",      "casual",     "buttermilk",          "Buttermilk",          "Cute pour-and-mix idle game.",                                    ["idle","pour","cute"]),
    ("Customcandycrush",      "casual",     "candy-crush",         "Candy Crush",         "Match-3 candy puzzle.",                                           ["match-3","candy","classic"]),
    ("Customcandycrusher",    "casual",     "candy-crusher",       "Candy Crusher",       "Smash candy patterns for points.",                                ["match","crush"]),
    ("Customcannonblaster",   "shooter",    "cannon-blaster",      "Cannon Blaster",      "Aim and fire cannonballs at targets.",                            ["cannon","physics","aim"]),
    ("Customcargostack",      "puzzle",     "cargo-stack",         "Cargo Stack",         "Pack cargo crates without overflow.",                             ["stacking","logistics"]),
    ("Customcarrace",         "racing",     "car-race",            "Car Race",            "3D car-racing run with traffic dodging.",                         ["3d","cars","traffic"]),
    ("Customcarrom",          "board",      "carrom",              "Carrom",              "Pocket the carrom pieces with skill.",                            ["table","aim","classic"]),
    ("Customchess",           "board",      "chess",               "Chess",               "Classic chess vs the computer.",                                  ["strategy","classic"]),
    ("Customcirclepath",      "arcade",     "circle-path",         "Circle Path",         "Trace the rotating circle without slipping.",                     ["timing","ring"]),
    ("Customcircuitbulb",     "puzzle",     "circuit-bulb",        "Circuit Bulb",        "Wire circuits to light the bulb.",                                ["logic","wires"]),
    ("Customcmiyc",           "arcade",     "catch-me-if-you-can", "Catch Me If You Can", "Outrun the chasers in a wide arena.",                             ["chase","stealth"]),
    ("Customcollector",       "arcade",     "collector",           "Collector",           "Sweep up coins before time runs out.",                            ["coins","time-attack"]),
    ("Customcolordash",       "arcade",     "color-dash",          "Color Dash",          "Match the player's color to pass each gate.",                     ["color-match","reflex"]),
    ("Customcolourpour",      "puzzle",     "colour-pour",         "Colour Pour",         "Sort liquids into single-color tubes.",                           ["sort","liquid","relax"]),
    ("Customconnected",       "puzzle",     "connected",           "Connected",           "Link nodes without crossing lines.",                              ["graph","logic"]),
    ("Customcooking",         "casual",     "cooking",             "Cooking",             "Plate orders before the timer hits zero.",                        ["timer","kitchen"]),
    ("Customcoolplatformer",  "platformer", "cool-platformer",     "Cool Platformer",     "Run, jump, and dash through hazards.",                            ["jump","run","platform"]),
    ("Customcosmiccleaner",   "3d",         "cosmic-cleaner",      "Cosmic Cleaner",      "3D space-junk vacuum-up game.",                                   ["3d","space"]),
    ("Customcricket123",      "sports",     "cricket-123",         "Cricket 1-2-3",       "Bat through fast deliveries.",                                    ["cricket","reflex"]),
    ("Customcrossyroad",      "arcade",     "crossy-road",         "Crossy Road",         "Hop across roads, rivers, and rails.",                            ["frogger","endless"]),
    ("Customcrowdcontrol",    "arcade",     "crowd-control",       "Crowd Control",       "Steer your growing crowd through obstacles.",                     ["growing","io-style"]),
    ("Customcurvesnake",      "arcade",     "curve-snake",         "Curve Snake",         "Snake-style game with smooth curve trails.",                      ["snake","trail"]),
    ("Customcutrope",         "puzzle",     "cut-rope",            "Cut the Rope",        "Slice ropes to land the candy in the goal.",                      ["physics","slice"]),
    ("Customdemon",           "arcade",     "demon",               "Demon",               "Survive a horde of demonic enemies.",                             ["survival","dark"]),
    ("Customdevilking",       "platformer", "devil-king",          "Devil King",          "Hop hazards in a devilish trial run.",                            ["challenge","jump"]),
    ("Customdodgeenemy",      "arcade",     "dodge-enemy",         "Dodge Enemy",         "Slip past charging enemies.",                                     ["dodge","reflex"]),
    ("Customdodgemaster",     "arcade",     "dodge-master",        "Dodge Master",        "Endless dodging at increasing speed.",                            ["endless","dodge"]),
    ("Customdoodlejump",      "platformer", "doodle-jump",         "Doodle Jump",         "Jump from platform to platform — go higher.",                     ["vertical","jump","classic"]),
    ("Customdreamweaver",     "arcade",     "dream-weaver",        "Dream Weaver",        "Weave glowing trails through a dreamscape.",                      ["chill","trail"]),
    ("Customellars",          "arcade",     "ellars",              "Ellars",              "Surreal arcade dodger.",                                          ["abstract","dodge"]),
    ("Customendlessmafia",    "arcade",     "endless-mafia",       "Endless Mafia",       "Brawl through endless waves of mafia thugs.",                     ["brawler","endless"]),
    ("Customendlessrunner",   "racing",     "endless-runner",      "Endless Runner",      "Run forever. Dodge everything.",                                  ["runner","endless"]),
    ("Customfighterfury",     "shooter",    "fighter-fury",        "Fighter Fury",        "Side-scrolling jet shooter.",                                     ["jet","side-scroll"]),
    ("Customfighterjet",      "shooter",    "fighter-jet",         "Fighter Jet",         "Top-down jet combat.",                                            ["jet","top-down"]),
    ("Customflappyplay",      "arcade",     "flappy",              "Flappy",              "Tap to flap. Don't hit the pipes.",                               ["tap","one-button","classic"]),
    ("Customflipjump",        "platformer", "flip-jump",           "Flip Jump",           "Flip the world to land safely.",                                  ["gravity","flip"]),
    ("Customflymonkey",       "arcade",     "fly-monkey",          "Fly Monkey",          "Swing the monkey through the canopy.",                            ["swing","jungle"]),
    ("Customfootball",        "sports",     "football",            "Football",            "Score goals in a fast-paced footy match.",                        ["soccer","goals"]),
    ("Customforestrunner",    "racing",     "forest-runner",       "Forest Runner",       "Sprint through a forest — dodge logs and gaps.",                  ["runner","forest"]),
    ("Customfourdots",        "puzzle",     "four-dots",           "Four Dots",           "Tap dots in the right pattern.",                                  ["pattern","tap"]),
    ("Customfruitbasket",     "casual",     "fruit-basket",        "Fruit Basket",        "Catch falling fruits in your basket.",                            ["catch","fruits","cute"]),
    ("Customfruitcosmics",    "casual",     "fruit-cosmics",       "Fruit Cosmics",       "Cosmic-themed fruit smasher.",                                    ["fruits","slash"]),
    ("Customfruitmerge",      "casual",     "fruit-merge",         "Fruit Merge",         "Drop fruits — merge same kinds to evolve.",                       ["merge","suika","drop"]),
    ("Customgame",            "arcade",     "luma-bounce",         "LumaBounce",          "Bouncy reflex arcade game.",                                      ["bounce","reflex"]),
    ("Customglassstepin",     "arcade",     "glass-step",          "Glass Step",          "Pick the safe glass tile. Don't fall.",                           ["squid-game","pick"]),
    ("Customgunman",          "shooter",    "gunman",              "Gunman",              "Quick-draw gunfight game.",                                       ["western","quickdraw"]),
    ("Customgunrun",          "shooter",    "gun-run",             "Gun Run",             "Run-and-gun side-scroller.",                                      ["run-gun","side-scroll"]),
    ("Customhexpuzzle",       "puzzle",     "hex-puzzle",          "Hex Puzzle",          "Place hex blocks to clear the board.",                            ["hex","blocks"]),
    ("Customhungryplayer",    "arcade",     "hungry-player",       "Hungry Player",       "Gobble food, dodge hazards, grow.",                               ["eat","grow"]),
    ("Customjumpdot",         "arcade",     "jump-dot",            "Jump Dot",            "Tap to jump the dot over rotating hazards.",                      ["one-button","timing"]),
    ("Customkaijukrush",      "arcade",     "kaiju-krush",         "Kaiju Krush",         "Smash through the city as a giant kaiju.",                        ["destruction","kaiju"]),
    ("Customlaserbounce",     "puzzle",     "laser-bounce",        "Laser Bounce",        "Reflect lasers to hit all targets.",                              ["lasers","reflect","logic"]),
    ("Customlink",            "puzzle",     "link",                "Link",                "Link matching tiles by shortest path.",                           ["match","mahjong"]),
    ("Customludo",            "board",      "ludo",                "Ludo",                "Classic Ludo — you vs 3 AI opponents.",                           ["dice","classic","family"]),
    ("Custommario",           "platformer", "mario",               "Mario-Like",          "Side-scrolling platformer adventure.",                            ["platformer","retro"]),
    ("Custommathquest",       "word-quiz",  "math-quest",          "Math Quest",          "Speed math challenge.",                                           ["math","education","quick"]),
    ("Custommemory",          "puzzle",     "memory",              "Memory",              "Flip cards. Find pairs.",                                         ["memory","cards","classic"]),
    ("Custommemorygame",      "puzzle",     "memory-cards",        "Memory Cards",        "Card-matching memory test.",                                      ["memory","cards"]),
    ("Customnumbermerge",     "puzzle",     "number-merge",        "Number Merge",        "Merge same numbers, climb the score.",                            ["merge","numbers"]),
    ("Customonecar",          "racing",     "one-car",             "One Car",             "Steer one car through dense traffic.",                            ["traffic","reflex"]),
    ("Customorbitaloutpost",  "3d",         "orbital-outpost",     "Orbital Outpost",     "3D space-station defense.",                                       ["3d","space","defense"]),
    ("Custompacman",          "arcade",     "pacman",              "Pac-Man",             "Eat dots. Avoid ghosts.",                                         ["maze","classic"]),
    ("Custompairinggame",     "puzzle",     "pairing",             "Pairing",             "Pair up matching items quickly.",                                 ["match","quick"]),
    ("Customparkour",         "platformer", "parkour",             "Parkour",             "Wall-run, slide, and vault forward.",                             ["parkour","run"]),
    ("Custompathfinder",      "puzzle",     "pathfinder",          "Pathfinder",          "Solve maze paths under time pressure.",                           ["maze","path"]),
    ("Customperfectsquare",   "puzzle",     "perfect-square",      "Perfect Square",      "Tap when the square aligns perfectly.",                           ["timing","precision"]),
    ("Custompirates",         "arcade",     "pirates",             "Pirates",             "Sail and battle on the high seas.",                               ["pirates","ships"]),
    ("Customplanetvisitor",   "3d",         "planet-visitor",      "Planet Visitor",      "Land on alien planets in 3D.",                                    ["3d","space","explore"]),
    ("Customplanetwar",       "3d",         "planet-war",          "Planet War",          "Defend your planet from cosmic invaders.",                        ["3d","space","defense"]),
    ("Customprojenemy",       "shooter",    "projectile-enemy",    "Projectile Enemy",    "Dodge and counter ranged enemies.",                               ["bullet-hell","reflex"]),
    ("Customquizgame",        "word-quiz",  "quiz",                "Quiz",                "Test your knowledge across categories.",                          ["trivia","education"]),
    ("Customredlight",        "arcade",     "red-light-green-light", "Red Light, Green Light", "Move on green. Freeze on red.",                            ["squid-game","reflex"]),
    ("Customroadcross",       "arcade",     "road-cross",          "Road Cross",          "Cross busy roads safely.",                                        ["frogger","timing"]),
    ("Customroadfighter",     "racing",     "road-fighter",        "Road Fighter",        "Top-down race weaving through traffic.",                          ["traffic","race","retro"]),
    ("Customrobotdestruction","shooter",    "robot-destruction",   "Robot Destruction",   "Blast incoming robots to scrap.",                                 ["robots","blaster"]),
    ("Customscrewmaster",     "puzzle",     "screw-master",        "Screw Master",        "Unscrew and sort the metal pieces.",                              ["sort","mechanical"]),
    ("Customshadowrunner",    "racing",     "shadow-runner",       "Shadow Runner",       "Sprint through a shadow world.",                                  ["runner","dark"]),
    ("Customshadowshooter",   "shooter",    "shadow-shooter",      "Shadow Shooter",      "Pick off shadow enemies from cover.",                             ["stealth","shooter"]),
    ("Customshapecollector",  "arcade",     "shape-collector",     "Shape Collector",     "Catch only the matching shapes.",                                 ["shapes","match"]),
    ("Customshapefitter",     "puzzle",     "shape-fitter",        "Shape Fitter",        "Fit shapes into the right slots.",                                ["shapes","kids"]),
    ("Customshootenemy",      "shooter",    "shoot-enemy",         "Shoot Enemy",         "Pick off enemies before they reach you.",                         ["aim","reflex"]),
    ("Customshooter",         "shooter",    "shooter",             "Shooter",             "Top-down arena shooter.",                                         ["arena","top-down"]),
    ("Customsignalcircuit",   "puzzle",     "signal-circuit",      "Signal Circuit",      "Route signals through circuit gates.",                            ["logic","circuit"]),
    ("Customskyhigh",         "arcade",     "sky-high",            "Sky High",            "Climb endlessly into the sky.",                                   ["climb","endless"]),
    ("Customslidepuzzle1",    "puzzle",     "slide-puzzle",        "Slide Puzzle",        "Reassemble the image by sliding tiles.",                          ["sliding","classic"]),
    ("Customsnake",           "arcade",     "snake",               "Snake",               "Eat. Grow. Don't hit yourself.",                                  ["snake","classic"]),
    ("Customsnakeladder",     "board",      "snake-and-ladder",    "Snake & Ladder",      "Roll the dice. Climb. Slide. Win.",                               ["dice","family","classic"]),
    ("Customsniper",          "shooter",    "sniper",              "Sniper",              "Steady your scope. One shot, one kill.",                          ["scope","precision"]),
    ("Customspacefighter",    "shooter",    "space-fighter",       "Space Fighter",       "Dogfight through asteroid fields.",                               ["space","dogfight"]),
    ("Customspaceman",        "arcade",     "spaceman",            "Spaceman",            "Float and survive in zero gravity.",                              ["space","float"]),
    ("Customspacewaves",      "arcade",     "space-waves",         "Space Waves",         "Surf waves of space debris.",                                     ["space","wave"]),
    ("Customsquareone",       "puzzle",     "square-one",          "Square One",          "Slide squares to clear the board.",                               ["sliding","minimal"]),
    ("Customstacktower",      "3d",         "stack-tower",         "Stack Tower",         "Stack 3D blocks for the highest tower.",                          ["3d","stack","timing"]),
    ("Customstickgame",       "arcade",     "stick-game",          "Stick Game",          "Draw sticks to bridge gaps.",                                     ["stick","draw"]),
    ("Customsticktoss",       "arcade",     "stick-toss",          "Stick Toss",          "Toss sticks at the spinning target.",                             ["aim","spin"]),
    ("Customstraightrush",    "racing",     "straight-rush",       "Straight Rush",       "Sprint forward — react to oncoming hazards.",                     ["sprint","reflex"]),
    ("Customsurvivalrun",     "racing",     "survival-run",        "Survival Run",        "Outrun the danger as long as you can.",                           ["survival","runner"]),
    ("Customsurvivor",        "shooter",    "survivor",            "Survivor",            "Vampire-survivors-style horde survival.",                         ["horde","survival","auto"]),
    ("Customtabletennis",     "sports",     "table-tennis",        "Table Tennis",        "Volley the ping-pong ball.",                                      ["pong","sport"]),
    ("Customtaptarget",       "arcade",     "tap-target",          "Tap Target",          "Tap targets before they vanish.",                                 ["tap","reflex"]),
    ("Customteeshooter",      "shooter",    "tee-shooter",         "Tee Shooter",         "Tee-up trick-shot shooter.",                                      ["aim","tee"]),
    ("Customtetris",          "puzzle",     "tetris",              "Tetris",              "The classic falling-block puzzle.",                               ["blocks","classic"]),
    ("CustomthatlevelagainL", "platformer", "that-level-again-1",  "That Level Again — 1","Trick-platformer level 1.",                                       ["trick","platformer"]),
    ("CustomthatlevelagainL2","platformer", "that-level-again-2",  "That Level Again — 2","Trick-platformer level 2.",                                       ["trick","platformer"]),
    ("CustomthatlevelagainL3","platformer", "that-level-again-3",  "That Level Again — 3","Trick-platformer level 3.",                                       ["trick","platformer"]),
    ("CustomthatlevelagainL4","platformer", "that-level-again-4",  "That Level Again — 4","Trick-platformer level 4.",                                       ["trick","platformer"]),
    ("CustomthatlevelagainL5","platformer", "that-level-again-5",  "That Level Again — 5","Trick-platformer level 5.",                                       ["trick","platformer"]),
    ("Customthundergod",      "shooter",    "thunder-god",         "Thunder God",         "Smite enemies with lightning.",                                   ["thunder","power"]),
    ("Customtictactoe",       "board",      "tic-tac-toe",         "Tic-Tac-Toe",         "X's and O's. Three in a row wins.",                               ["classic","quick"]),
    ("Customtile",            "puzzle",     "tile-tap",            "Tile Tap",            "Tap only the dark tiles. Don't miss.",                            ["tap","tile","classic"]),
    ("Customtowershooter",    "shooter",    "tower-shooter",       "Tower Shooter",       "Defend your tower from waves of enemies.",                        ["defense","tower"]),
    ("Customtrenchdefence",   "shooter",    "trench-defence",      "Trench Defence",      "Hold the trench against the assault.",                            ["defense","war"]),
    ("Customtwocars",         "racing",     "two-cars",            "Two Cars",            "Steer two cars at once. Catch & dodge.",                          ["dual","reflex"]),
    ("Customtwocarsai",       "racing",     "two-cars-ai",         "Two Cars AI",         "AI-twist on the two-cars classic.",                               ["dual","ai"]),
    ("Customunruly",          "puzzle",     "unruly",              "Unruly",              "Place tiles by no-three-in-a-row rules.",                         ["logic","binary"]),
    ("Customvaccineshooter",  "shooter",    "vaccine-shooter",     "Vaccine Shooter",     "Shoot viruses with your vaccine gun.",                            ["health","shooter"]),
    ("Customwhackabug",       "arcade",     "whack-a-bug",         "Whack-a-Bug",         "Bonk the bugs as they pop up.",                                   ["whack","reflex"]),
    ("Customwordlee",         "word-quiz",  "wordle",              "Wordlee",             "Guess the 5-letter word in 6 tries.",                             ["wordle","letters"]),
    ("Customwordsofwonder",   "word-quiz",  "words-of-wonder",     "Words of Wonder",     "Build words from a wheel of letters.",                            ["letters","spelling"]),
    ("custompenalty",         "sports",     "penalty",             "Penalty Shootout",    "One-on-one penalty kicks vs the keeper.",                         ["soccer","quick"]),
    ("killer1",               "arcade",     "swipe-assassin",      "Swipe Assassin",      "Swipe to slice incoming threats.",                                ["swipe","slash"]),
    ("leveldevil",            "platformer", "level-devil",         "Level Devil",          "Trickster platformer that hates you.",                            ["trick","platformer"]),
    ("newgame",               "puzzle",     "line-trap",           "Line Trap",           "Trap the dot inside your line.",                                  ["draw","minimal"]),
    ("window-shooter",        "shooter",    "window-shooter",      "Window Shooter",      "Pick off enemies through the window.",                            ["aim","reflex"]),
]

def main():
    # tech detection: peek at index.html
    def detect_tech(folder: Path) -> str:
        idx = folder / "index.html"
        if not idx.exists():
            return "html"
        try:
            html = idx.read_text(errors="ignore")
        except Exception:
            return "html"
        if "phaser" in html.lower():
            return "phaser"
        if "three" in html.lower() and "three.min.js" in html.lower():
            return "three"
        return "html"

    GAMES_DIR.mkdir(exist_ok=True)
    for cat in CATEGORIES:
        (GAMES_DIR / cat["id"]).mkdir(exist_ok=True)

    seen_slugs = {}
    moved = []
    skipped = []
    missing = []
    for folder, cat, slug, name, desc, tags in GAMES:
        src = ROOT / folder
        dst = GAMES_DIR / cat / slug
        if dst.exists():
            skipped.append(folder)
            continue
        if not src.exists():
            missing.append(folder)
            continue
        # collision check
        key = (cat, slug)
        if key in seen_slugs:
            print(f"!! duplicate slug: {key} (was {seen_slugs[key]}, now {folder})", file=sys.stderr)
            sys.exit(1)
        seen_slugs[key] = folder
        shutil.move(str(src), str(dst))
        moved.append((folder, cat, slug))

    # build registry
    games_out = []
    for folder, cat, slug, name, desc, tags in GAMES:
        dst = GAMES_DIR / cat / slug
        if not dst.exists():
            continue
        tech = detect_tech(dst)
        games_out.append({
            "slug": slug,
            "name": name,
            "category": cat,
            "path": f"games/{cat}/{slug}/index.html",
            "tech": tech,
            "tags": tags,
            "description": desc,
        })

    registry = {
        "version": 1,
        "generated_from": "scripts/restructure.py",
        "categories": CATEGORIES,
        "games": games_out,
    }
    (GAMES_DIR / "registry.json").write_text(json.dumps(registry, indent=2, ensure_ascii=False))

    print(f"Moved: {len(moved)}")
    print(f"Skipped (already in place): {len(skipped)}")
    if missing:
        print(f"!! missing src folders: {missing}", file=sys.stderr)
    print(f"Registry written to {GAMES_DIR/'registry.json'} with {len(games_out)} games")

if __name__ == "__main__":
    main()
