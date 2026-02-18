/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-explicit-any */

declare global {
  namespace Cypress {
    interface Chainable {
      mockMicrophone(audioFixturePath?: string): Chainable<void>;
      injectAudioFile(fixturePath: string): Chainable<any>;
      testVoiceAssistant(fixturePath?: string): Chainable<any>;
      /**
       * Triggers playback of a WAV file in an already open Safari window
       * by clicking a button in __tests__/index.html.
       * @param wavFileName The name of the WAV file (e.g., "show-me-the-agendas.wav")
       * @example cy.playWavViaSafari('show-me-the-agendas.wav')
       */
      playWavViaSafari(wavFileName: string): Chainable<void>;
    }
  }
  interface Window {
    audioContextInstance?: AudioContext;
    gainNodeInstance?: GainNode;
    streamDestinationInstance?: MediaStreamAudioDestinationNode;
  }
}

// ... (your existing mockMicrophone, injectAudioFile, testVoiceAssistant commands) ...

Cypress.Commands.add('playWavViaSafari', (wavFileName) => {
  // Construct the data-testid based on your naming convention in index.html
  // e.g., "show-me-the-agendas.wav" -> "play-show-me-the-agendas-wav"
  const testId = `play-${wavFileName.replace(/\.wav$/i, '').toLowerCase().replace(/[^a-z0-9_]+/g, '-')}-wav`;
  cy.task('customLog', `Constructed data-testid for Safari: ${testId} from filename: ${wavFileName}`);
  
  cy.task('playWavInSafariViaAppleScript', testId).then(result => {
    cy.task('customLog', `Result from playWavInSafariViaAppleScript for ${testId}: ${result}`);
    // Check if the result indicates an error from AppleScript
    if (typeof result === 'string' && result.toLowerCase().startsWith('error')) {
        throw new Error(`AppleScript failed for ${testId}: ${result}`);
    }
  });
  // Add a small delay to allow Safari to start playing and audio to route.
  // This is crucial and might need adjustment based on observed system delays.
  cy.wait(1500, { log: true }); // Make this wait visible in Cypress logs
});

export { };