describe('Interface App Console Error Check', () => {
  beforeEach(() => {
    // Set up console error spying before each test
    cy.window().then((win) => {
      cy.spy(win.console, 'error').as('consoleError');
      cy.spy(win.console, 'warn').as('consoleWarn');
      cy.spy(win.console, 'log').as('consoleLog');
    });
  });

  it('should load localhost:3000 without console errors', () => {
    // Visit the homepage
    cy.visit('http://localhost:3000', {
      failOnStatusCode: false, // Don't fail if the server returns an error status
      timeout: 30000, // Wait up to 30 seconds for the page to load
    });

    // Wait for the page to fully load and any async operations to complete
    cy.wait(3000);

    // Check that the page loaded successfully
    cy.get('body').should('exist');

    // Log any console messages that occurred (for debugging)
    cy.get('@consoleLog').then((consoleLog) => {
      if (consoleLog && consoleLog.getCalls().length > 0) {
        cy.task('log', 'Console logs:');
        consoleLog.getCalls().forEach((call, index) => {
          cy.task('log', `Log ${index + 1}: ${call.args.join(' ')}`);
        });
      }
    });

    cy.get('@consoleWarn').then((consoleWarn) => {
      if (consoleWarn && consoleWarn.getCalls().length > 0) {
        cy.task('log', 'Console warnings:');
        consoleWarn.getCalls().forEach((call, index) => {
          cy.task('log', `Warning ${index + 1}: ${call.args.join(' ')}`);
        });
      }
    });

    cy.get('@consoleError').then((consoleError) => {
      if (consoleError && consoleError.getCalls().length > 0) {
        cy.task('log', 'Console errors:');
        consoleError.getCalls().forEach((call, index) => {
          cy.task('log', `Error ${index + 1}: ${call.args.join(' ')}`);
        });
      }
    });

    // Assert that no console errors occurred
    cy.get('@consoleError').should('not.have.been.called');
  });

  it('should navigate to different pages and check for console errors', () => {
    const pagesToTest = [
      'http://localhost:3000',
      'http://localhost:3000/about',
      'http://localhost:3000/contact',
    ];

    pagesToTest.forEach((url) => {
      cy.visit(url, {
        failOnStatusCode: false,
        timeout: 30000,
      });

      // Wait for page load
      cy.wait(2000);

      // Check for errors on this specific page
      cy.get('@consoleError').then((consoleError) => {
        if (consoleError && consoleError.getCalls().length > 0) {
          const errorCount = consoleError.getCalls().length;
          cy.task('log', `Found ${errorCount} console errors on ${url}`);
          
          // Log the specific errors
          consoleError.getCalls().forEach((call, index) => {
            cy.task('log', `Error ${index + 1} on ${url}: ${call.args.join(' ')}`);
          });
        }
      });

      // Reset the spy for the next page
      cy.window().then((win) => {
        cy.spy(win.console, 'error').as('consoleError');
      });
    });
  });
});
