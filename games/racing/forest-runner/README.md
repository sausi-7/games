# Eve's Forest Run

A Phaser 3 endless runner game where the character "Eve" runs through a forest, jumping over obstacles and collecting a spellbook to win.

## Game Overview

- **Game Type**: Endless runner with platformer mechanics
- **Character**: Eve, a young adventurer
- **Objective**: Survive as long as possible, avoid obstacles, and collect the spellbook
- **Controls**: Up arrow to jump, Down arrow to crouch
- **Orientation**: Landscape (1920x1080)

## Game Features

- Endless scrolling forest background
- Multiple obstacle types (rocks, firewood, crows)
- Score tracking with increasing difficulty
- Character animations for running, jumping, and crouching
- Sound effects for actions and events
- Win condition (collecting the spellbook)
- Game over condition (hitting obstacles)

## Project Structure

```
/
├── index.html          # Main HTML file
├── main.js             # Game configuration and initialization
├── mechanics.js        # Game mechanics and scene logic
├── assets/
│   ├── images/         # Image assets (SVG format)
│   │   ├── forest_background.svg
│   │   ├── ground.svg
│   │   ├── rock.svg
│   │   ├── firewood.svg
│   │   ├── crow.svg
│   │   ├── spellbook.svg
│   │   └── eve_spritesheet.svg
│   └── audio/          # Audio placeholders (SVG format)
│       ├── jump.svg
│       ├── crouch.svg
│       ├── background_music.svg
│       └── collision.svg
└── README.md           # This file
```

## Asset Information

### Images

All image assets are provided in SVG format for scalability and small file size:

- **forest_background.svg**: Scrolling forest background with sky, mountains, and trees
- **ground.svg**: Ground platform texture
- **rock.svg**: Rock obstacle that must be jumped over
- **firewood.svg**: Firewood obstacle that must be jumped over
- **crow.svg**: Flying crow obstacle that must be ducked under
- **spellbook.svg**: Collectible item that triggers the win condition
- **eve_spritesheet.svg**: Character spritesheet with animations for running, jumping, and crouching

### Audio

The current implementation uses SVG placeholders for audio files. To implement actual audio:

1. Replace the SVG placeholders with actual audio files (MP3, OGG, or WAV format)
2. Update the `preload()` method in `mechanics.js` to load the actual audio files
3. Update the audio initialization in the `create()` method

Recommended audio files to create/obtain:
- **jump.mp3**: Sound effect for jumping
- **crouch.mp3**: Sound effect for crouching
- **background_music.mp3**: Looping forest ambience or music
- **collision.mp3**: Sound effect for collision with obstacles

## Getting Started

1. Ensure you have a local web server set up (or use an extension like Live Server in VS Code)
2. Open the project directory in your web server
3. Navigate to index.html in your browser
4. Use the Up and Down arrow keys to play

## Future Enhancements

Potential improvements for the game:

- Mobile touch controls
- Difficulty levels
- Power-ups and special abilities
- High score tracking
- More varied obstacles and environments
- Sound settings (volume control, mute option)
- Responsive design for different screen sizes
- Loading screen and intro animation

## Credits

Developed as a Phaser 3 game project. All assets are original SVG creations.