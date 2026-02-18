describe('PearlOS Endpoint', () => {
  beforeEach(() => {
    // Set up console error monitoring before each test
    cy.window().then((win) => {
      // Spy on console methods to detect errors
      cy.spy(win.console, 'error').as('consoleError');
      cy.spy(win.console, 'warn').as('consoleWarn');
      
      // Override console.error to fail tests if called
      const originalError = win.console.error;
      win.console.error = (...args) => {
        cy.log('Console error detected:', ...args);
        originalError.apply(win.console, args);
        throw new Error(`Console error: ${args.join(' ')}`);
      };
    });
  });

  it('should load the pearlos page successfully without console errors', () => {
    // Visit the page and check for errors
    cy.visit('/pearlos', {
      headers: {
        'x-test-mode': 'true',
      },
      onBeforeLoad: (win) => {
        // Set up error monitoring
        cy.spy(win.console, 'error').as('consoleError');
        cy.spy(win.console, 'warn').as('consoleWarn');
      }
    });
    
    // Wait for page to load completely
    cy.get('body').should('be.visible');
    
    // Verify no console errors occurred
    cy.get('@consoleError').should('not.have.been.called');
    cy.get('@consoleWarn').should('not.have.been.called');
    
    // Basic page checks
    cy.get('body').should('be.visible');
    cy.title().should('exist');
    cy.log('Seatrade JDX endpoint is accessible without console errors');
  });

  it('should have proper page structure without errors', () => {
    cy.visit('/pearlos', {
      headers: {
        'x-test-mode': 'true',
      },
      onBeforeLoad: (win) => {
        cy.spy(win.console, 'error').as('consoleError');
        cy.spy(win.console, 'warn').as('consoleWarn');
      }
    });
    
    // Wait for any async operations
    cy.get('body').should('be.visible');
    
    // Verify no console errors
    cy.get('@consoleError').should('not.have.been.called');
    cy.get('@consoleWarn').should('not.have.been.called');
    
    // Page structure checks
    cy.get('html').should('exist');
    cy.get('head').should('exist');
    cy.get('body').should('exist');
    cy.get('body').should('not.be.empty');
  });

  it('should not have any JavaScript runtime errors', () => {
    cy.visit('/pearlos', {
      headers: {
        'x-test-mode': 'true',
      },
      onBeforeLoad: (win) => {
        // Set up global error handler
        win.addEventListener('error', (event) => {
          cy.log('JavaScript error detected:', event.error);
          throw new Error(`JavaScript error: ${event.error?.message || 'Unknown error'}`);
        });
        
        // Set up unhandled promise rejection handler
        win.addEventListener('unhandledrejection', (event) => {
          cy.log('Unhandled promise rejection:', event.reason);
          throw new Error(`Unhandled promise rejection: ${event.reason}`);
        });
        
        cy.spy(win.console, 'error').as('consoleError');
        cy.spy(win.console, 'warn').as('consoleWarn');
      }
    });
    
    // Wait for page to fully load and any async operations
    cy.get('body').should('be.visible');
    cy.get('html').should('exist');
    
    // Final check for console errors
    cy.get('@consoleError').should('not.have.been.called');
    cy.get('@consoleWarn').should('not.have.been.called');
  });
}); 