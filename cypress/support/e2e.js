// Cypress support file (JavaScript)
// Keep it simple to avoid TS preprocessors in headless runs

// Custom command to play WAV in Safari via AppleScript (called via cy.task)
Cypress.Commands.add('playWavViaSafari', (wavFileName) => {
  const testId = `play-${wavFileName.replace(/\.wav$/i, '').toLowerCase().replace(/[^a-z0-9_]+/g, '-')}-wav`;
  cy.task('customLog', `Constructed data-testid for Safari: ${testId} from filename: ${wavFileName}`);
  cy.task('playWavInSafariViaAppleScript', testId).then((result) => {
    cy.task('customLog', `Result from playWavInSafariViaAppleScript for ${testId}: ${result}`);
    if (typeof result === 'string' && result.toLowerCase().startsWith('error')) {
      throw new Error(`AppleScript failed for ${testId}: ${result}`);
    }
  });
  cy.wait(1500, { log: true });
});

// Console error helpers used by several specs
Cypress.Commands.add('checkConsoleErrors', () => {
  cy.window().then((win) => {
    cy.spy(win.console, 'error').as('consoleError');
    cy.spy(win.console, 'warn').as('consoleWarn');
    cy.spy(win.console, 'log').as('consoleLog');
    cy.spy(win, 'addEventListener').as('addEventListener');
  });
});

Cypress.Commands.add('assertNoConsoleErrors', () => {
  cy.get('@consoleError').should('not.have.been.called');
  cy.get('@consoleWarn').should('not.have.been.called');
});

Cypress.Commands.add('visitAndCheckErrors', (url) => {
  cy.visit(url);
  cy.checkConsoleErrors();
  cy.wait(1000);
  cy.assertNoConsoleErrors();
});
