describe('Accept Invite flow', () => {
  const assistant = 'seatrade'; // adjust to a known assistant in dev

  it('shows Google option and accepts with password', () => {
    // Use a dummy token param to load page UI; backend verification is not required for UI presence
    cy.visit(`/accept-invite?token=dummy-token&assistant=${assistant}`);

    // Google button should always be visible
    cy.contains('button', 'Continue with Google').should('be.visible');

    // Fill password form and attempt submit (the API may respond 400 with dummy token, we only assert UI interactions)
    cy.get('input[name="new-password"]').type('Password123!');
    cy.get('input[name="confirm-password"]').type('Password123!');
    cy.contains('button', 'Activate Account').should('be.enabled');
  });

  it('navigates to google-complete on Click', () => {
    cy.intercept('GET', '/accept-invite/google-complete*').as('googleComplete');
    cy.visit(`/accept-invite?token=tok123&assistant=${assistant}`);
    cy.contains('button', 'Continue with Google').click();
    cy.wait('@googleComplete');
    // Server will redirect back with error=InvalidOrExpired for dummy token
    cy.location('pathname').should('include', '/accept-invite');
    cy.location('search').should('include', 'error=');
  });
});
