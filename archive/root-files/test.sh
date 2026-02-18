#!/bin/sh

# Script to run tests for the project.
# Currently targets apps/ncp, but will be expanded.

# Exit immediately if a command exits with a non-zero status.
set -e

echo "Running tests..."

# --- Running tests for apps/ncp ---
echo "\nRunning tests for apps/ncp:"
echo "----------------------------------------------------"

# Navigate to the apps/ncp directory
NCP_DIR="apps/ncp"
echo "Changing directory to $NCP_DIR"
cd "$NCP_DIR"

# Run pytest with coverage
echo "\nRunning pytest with coverage..."
# --cov=. means measure coverage for the current directory (apps/ncp)
# --cov-report=term-missing shows a summary in the terminal including missing lines
# --cov-report=html generates an HTML report in coverage_html_report/
pytest --cov=. --cov-report=term-missing --cov-report=html

# Navigate back to the original directory
echo "\nChanging back to original directory."
cd - > /dev/null

echo "\n----------------------------------------------------"
echo "All testing tasks completed."
