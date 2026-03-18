#!/bin/sh

# Script to run linters for the project.
# Currently targets apps/ncp, but will be expanded.

# Exit immediately if a command exits with a non-zero status.
set -e

echo "Running linters..."

# --- Linting for apps/ncp ---
echo "\nLinting apps/ncp:"
echo "----------------------------------------------------"

# Navigate to the apps/ncp directory
NCP_DIR="apps/ncp"
echo "Changing directory to $NCP_DIR"
cd "$NCP_DIR"

# Run ruff to auto-fix and format
echo "\nRunning ruff auto-fix and format..."
ruff check . --fix
ruff format .

# Run ruff checks again to catch anything not auto-fixed
echo "\nRunning ruff final checks..."
ruff check .

# Run mypy checks
echo "\nRunning mypy checks..."
mypy .

# Run pylint for duplicate code detection
echo "\nRunning pylint for duplicate code detection..."
# The following command tells pylint to disable all checks (--disable=all),
# then enable only the duplicate-code check (--enable=duplicate-code),
# and run it on all Python files in the current directory tree (.).
pylint --disable=all --enable=duplicate-code .

# Navigate back to the original directory
echo "\nChanging back to original directory."
cd - > /dev/null

echo "\n----------------------------------------------------"
echo "All linting tasks completed."
