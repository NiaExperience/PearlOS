const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

module.exports = {
  e2e: {
    baseUrl: 'http://localhost:3000',
    env: {
      CYPRESS: 'true',
      NEXT_PUBLIC_TEST_ANONYMOUS_USER: 'true',
    },
    specPattern: [
      'cypress/e2e/**/*.cy.js'
    ],
  supportFile: 'cypress/support/e2e.js',
    fixturesFolder: 'cypress/fixtures',
    screenshotOnRunFailure: true,
    video: false,
    setupNodeEvents(on, config) {
      // Force esbuild preprocessor to avoid Cypress' webpack preprocessor and tsconfig-paths issues
      try {
        const esbuildPreprocessor = require('@bahmutov/cypress-esbuild-preprocessor');
        on('file:preprocessor', esbuildPreprocessor());
      } catch (e) {
        console.warn('Esbuild preprocessor not available, falling back to default. Error:', e?.message || e);
      }

      // Register task to read audio files
      on('task', {
        readAudioFile(filePath) {
          const resolvedPath = path.resolve(__dirname, 'cypress', 'fixtures', filePath);
          if (fs.existsSync(resolvedPath)) {
            // Read as base64 to pass through Cypress task API
            return fs.readFileSync(resolvedPath).toString('base64');
          }
          return null;
        },
        // Add a custom task for logging
        customLog(message) {
          console.log('CYPRESS TASK LOG: ', message);
          return null; // Tasks should return null or a serializable value
        },
        // New task to play WAV in Safari via AppleScript
        playWavInSafariViaAppleScript(buttonTestId) {
          console.log(`CYPRESS TASK: Attempting to click button in Safari with data-testid: ${buttonTestId}`);
          return new Promise((resolve, reject) => {
            // Path to your AppleScript file. Ensure this is correct.
            const scriptPath = path.resolve(__dirname, 'apps/interface/scripts', 'clickSafariButton.applescript'); 
            const command = `osascript "${scriptPath}" "${buttonTestId}"`;

            exec(command, (error, stdout, stderr) => {
              if (error) {
                console.error(`Error executing AppleScript: ${error.message}`);
                console.error(`AppleScript stderr: ${stderr}`);
                return reject(new Error(`AppleScript execution failed: ${stderr || error.message}`));
              }
              if (stderr) {
                // AppleScript might output to stderr for non-fatal errors or info
                console.warn(`AppleScript stderr: ${stderr}`);
              }
              console.log(`AppleScript stdout: ${stdout}`);
              resolve(stdout.trim()); // Resolve with the output from AppleScript
            });
          });
        }
      });

      // Add browser launch arguments
      on('before:browser:launch', (browser, launchOptions) => {
        if (browser.family === 'chromium' || browser.name === 'chrome') {
          launchOptions.args.push('--no-sandbox');
          launchOptions.args.push('--use-fake-ui-for-media-stream');
          launchOptions.args.push('--use-fake-device-for-media-stream');
          // Allow loopback audio
          launchOptions.args.push('--allow-loopback-in-peer-connection');
        }
        return launchOptions;
      });
      
      return config;
    },
  },
}; 