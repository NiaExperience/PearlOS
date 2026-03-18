#!/bin/bash

# Check if we're actually running Cypress commands
if [[ "$1" == "cypress" ]]; then
    # Run Cypress with config from tests/
    echo "Running Cypress..."
    npx cypress "${@:2}" --config-file tests/cypress.config.js

    echo "Cypress run completed."
else
    # For non-Cypress commands, just run them normally
    echo "Running command: $@"
    "$@"
fi 