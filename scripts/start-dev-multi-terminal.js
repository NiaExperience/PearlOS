#!/usr/bin/env node
/**
 * Start development servers in multiple terminal windows
 * Cross-platform script for Windows, macOS, and Linux
 * 
 * Opens three separate terminal windows:
 * 1. Main Servers (Interface, Mesh, Dashboard) - npm run start:all
 * 2. Chorus TTS (Local TTS server) - npm run chorus:start
 * 3. Bot Gateway (Pipecat bot) - npm run --workspace=pipecat-daily-bot start:server
 * 
 * Usage: npm run start:multi
 */

const { exec } = require('child_process');
const os = require('os');
const path = require('path');

const platform = os.platform();
const projectRoot = path.resolve(__dirname, '..');

// Commands to run in separate terminals
const commands = [
  {
    name: 'Main Servers',
    command: 'npm run start:all',
    description: 'Interface, Mesh, Dashboard'
  },
  {
    name: 'Chorus TTS',
    command: 'npm run chorus:start',
    description: 'Local TTS server (Kokoro)'
  },
  {
    name: 'Bot Gateway',
    command: 'npm run --workspace=pipecat-daily-bot start:server',
    description: 'Pipecat bot gateway'
  }
];


/**
 * Windows: Use cmd.exe with start command
 */
function startWindows() {
  console.log('🪟 Detected Windows - opening Command Prompt windows...');
  
  commands.forEach(({ name, command, description }) => {
    // Use 'start' to open new cmd window
    // /k keeps window open after command
    // Escape quotes properly for Windows
    const cmd = `start "Nia Dev - ${name}" cmd /k "cd /d ${projectRoot.replace(/\\/g, '/')} && ${command}"`;
    exec(cmd, (error) => {
      if (error) {
        console.error(`❌ Failed to open terminal for ${name}:`, error.message);
      } else {
        console.log(`✅ Opened terminal: ${name}`);
      }
    });
  });
}

/**
 * macOS: Use osascript to open Terminal.app windows
 */
function startMacOS() {
  console.log('🍎 Detected macOS - opening Terminal windows...');
  
  commands.forEach(({ name, command, description }) => {
    // Escape special characters for AppleScript
    const escapedCommand = command.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const escapedPath = projectRoot.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    
    const script = `tell application "Terminal"
  do script "cd ${escapedPath} && echo 'Nia Dev - ${name}' && echo '${description}' && ${escapedCommand}"
  activate
end tell`;
    
    const cmd = `osascript -e '${script.replace(/'/g, "'\\''")}'`;
    exec(cmd, (error) => {
      if (error) {
        console.error(`❌ Failed to open terminal for ${name}:`, error.message);
      } else {
        console.log(`✅ Opened terminal: ${name}`);
      }
    });
  });
}

/**
 * Linux: Try gnome-terminal, then xterm, then konsole
 */
function startLinux() {
  console.log('🐧 Detected Linux - opening terminal windows...');
  
  // Check which terminal is available
  exec('which gnome-terminal', (error) => {
    if (!error) {
      startGnomeTerminal();
    } else {
      exec('which xterm', (error) => {
        if (!error) {
          startXterm();
        } else {
          exec('which konsole', (error) => {
            if (!error) {
              startKonsole();
            } else {
              console.error('❌ No supported terminal found. Please install gnome-terminal, xterm, or konsole.');
              process.exit(1);
            }
          });
        }
      });
    }
  });
}

function startGnomeTerminal() {
  console.log('   Using gnome-terminal');
  
  commands.forEach(({ name, command, description }) => {
    const cmd = `gnome-terminal --title="Nia Dev - ${name}" -- bash -c "cd ${projectRoot} && echo '${description}' && ${command}; exec bash" &`;
    exec(cmd, (error) => {
      if (error) {
        console.error(`❌ Failed to open terminal for ${name}:`, error.message);
      } else {
        console.log(`✅ Opened terminal: ${name}`);
      }
    });
  });
}

function startXterm() {
  console.log('   Using xterm');
  
  commands.forEach(({ name, command, description }) => {
    const cmd = `xterm -title "Nia Dev - ${name}" -e "cd ${projectRoot} && echo '${description}' && ${command}; bash" &`;
    exec(cmd, (error) => {
      if (error) {
        console.error(`❌ Failed to open terminal for ${name}:`, error.message);
      } else {
        console.log(`✅ Opened terminal: ${name}`);
      }
    });
  });
}

function startKonsole() {
  console.log('   Using konsole');
  
  commands.forEach(({ name, command, description }) => {
    const cmd = `konsole --title "Nia Dev - ${name}" -e bash -c "cd ${projectRoot} && echo '${description}' && ${command}; exec bash" &`;
    exec(cmd, (error) => {
      if (error) {
        console.error(`❌ Failed to open terminal for ${name}:`, error.message);
      } else {
        console.log(`✅ Opened terminal: ${name}`);
      }
    });
  });
}

/**
 * Main entry point
 */
function main() {
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║  Nia Universal - Multi-Terminal Development Launcher  ║');
  console.log('╚═══════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Starting development servers in separate terminals...');
  console.log(`Platform: ${platform}`);
  console.log(`Project root: ${projectRoot}`);
  
  switch (platform) {
    case 'win32':
      startWindows();
      break;
    case 'darwin':
      startMacOS();
      break;
    case 'linux':
      startLinux();
      break;
    default:
      console.error(`❌ Unsupported platform: ${platform}`);
      console.error('Supported platforms: win32 (Windows), darwin (macOS), linux');
      process.exit(1);
  }
  
  console.log('');
  console.log('✨ Terminal windows should be opening now!');
  console.log('');
  console.log('💡 Tips:');
  console.log('   - Each service runs in its own terminal window');
  console.log('   - Close the terminal windows to stop the services');
  console.log('   - Check each terminal for service logs');
  console.log('');
}

// Run the script
main();

