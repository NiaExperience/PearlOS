# UI - Daily.co Video Call Interface

A React-based web interface for joining Daily.co video calls, designed to work with the PipeCat AI bot.

## Overview

This UI component provides a clean, responsive interface for joining Daily.co video calls. It's built with:
- **React 18**: Modern React with hooks
- **Daily.co React Components**: Official Daily.co UI components
- **Parcel**: Fast bundler for development and production
- **Jotai**: State management for React

## Setup

### Prerequisites
- Node.js (v16 or higher)
- Daily.co account and room URL

### Installation

**Option 1: From root directory (recommended)**
```bash
npm run install:all
```

**Option 2: From ui directory**
```bash
cd ui
npm install
```

### Configuration

The UI automatically reads the `DAILY_ROOM_URL` from the root `.env` file. No additional configuration needed!

The setup process:
1. Reads `DAILY_ROOM_URL` from the root `.env` file
2. Creates a local `.env` file in the UI directory
3. Makes the room URL available to the React application

### Running the UI

**Option 1: From root directory (recommended)**
```bash
npm run start:ui
```

**Option 2: From ui directory**
```bash
cd ui
npm start
```

The UI will be available at `http://localhost:1234` (or the next available port).

## Features

- **Video Call Interface**: Clean, modern UI for joining Daily.co calls
- **Real-time Communication**: Built with Daily.co React components
- **Responsive Design**: Works on desktop and mobile devices
- **Audio/Video Controls**: Mute, camera toggle, and other call controls
- **Participant Management**: View and manage call participants
- **Integration Ready**: Designed to work seamlessly with the PipeCat bot

## Project Structure

```
ui/
├── src/
│   ├── App.js          # Main application component
│   ├── Call.js         # Video call interface
│   ├── CallControls.js # Call control buttons
│   ├── PreJoin.js      # Pre-join room interface
│   ├── Tile.js         # Individual participant tile
│   ├── index.js        # Application entry point
│   └── styles.css      # Global styles
├── public/
│   └── index.html      # HTML template
├── package.json        # Dependencies and scripts
└── README.md           # This file
```

## Development

### Local Development
```bash
cd ui
npm install
npm start
```

### Building for Production
```bash
# From root directory
npm run build:ui

# From ui directory
cd ui
npm run build
```

### Available Scripts
- `npm start`: Start development server
- `npm run build`: Build for production
- `npm run dev`: Alias for start (Parcel default)

## Integration with Bot

This UI is designed to work with the PipeCat AI bot:

1. **Start both services**: Use `npm run start:all` from the root directory
2. **Join the call**: Use the UI to join your Daily.co room
3. **Bot joins automatically**: The bot will join the same room and provide AI assistance
4. **Voice interaction**: Speak to interact with the bot through the video call

## Configuration

### Environment Variables
The UI automatically reads the `DAILY_ROOM_URL` from the root `.env` file. The setup script handles this automatically when you run `npm start` or `npm run build`.

### Customization
- **Styling**: Modify `src/styles.css` for custom styling
- **Components**: Edit individual React components in `src/`
- **Daily.co settings**: Configure Daily.co parameters in the components

## Troubleshooting

### Common Issues
1. **Port conflicts**: If port 1234 is in use, Parcel will use the next available port
2. **Daily.co connection**: Verify your room URL is correct and accessible
3. **Audio/video permissions**: Ensure browser permissions are granted
4. **Bot not joining**: Check that the bot is running and configured with the same room URL

### Browser Compatibility
- Chrome/Chromium (recommended)
- Firefox
- Safari
- Edge

### Mobile Support
The UI is responsive and works on mobile devices, but desktop is recommended for the best experience.

## Learn More

- [Daily.co Documentation](https://docs.daily.co)
- [Daily.co React Components](https://docs.daily.co/reference/daily-react)
- [React Documentation](https://react.dev)
- [Parcel Documentation](https://parceljs.org)
- [Jotai Documentation](https://jotai.org)

## Community

Share your creations with the Daily.co community at [community.daily.co](https://community.daily.co)!
