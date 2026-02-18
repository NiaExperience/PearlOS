# Testing in Nia Universal Monorepo

This document provides a comprehensive overview of the testing strategy, structure, and commands for the Nia Universal monorepo. It covers unit, integration, and end-to-end (E2E) testing across all apps and the shared package.

---

## 🧪 Test Types & Locations

### 1. **Unit & Integration Tests**
- **Per-app tests:**
  - Each app (`apps/interface`, `apps/dashboard`, `apps/mesh`) and the prism package (`packages/prism`) has its own `__tests__/` directory for app-specific tests (API, integration, etc.).
  - Example: `apps/interface/__tests__/`, `apps/dashboard/__tests__/`, `packages/prism/__tests__`
- **Test file naming:**
  - Test files use the `.test.ts` or `.test.tsx` suffix and are typically placed in `__tests__` folders at the app or shared root.

### 2. **End-to-End (E2E) Tests**
- **Cypress E2E tests** are located in `apps/interface/__tests-e2e__/e2e/`.
- **Test pages** for E2E are in `apps/interface/src/app/test-e2e/`.
- **Fixtures** and **support files** are in the root `cypress/` directory.
  - Note, the cypress tests require running the app(s) first
  - The cypress tests are basically POC at this point, and need more tests  

---


## 🚀 Load Test Framework

Nia Universal now includes a robust JMeter-based load test framework for Prism Mesh and API endpoints. This setup allows you to run local or CI load tests with dynamic CRUD operations, configurable thread counts, durations, and loop counts.

### Features

- Unified JMeter test plan for complete CRUD lifecycle per thread
- Thread isolation with per-thread record creation and management
- Express API proxy server for Prism Mesh with detailed logging
- Automated setup, execution, and cleanup scripts
- Mesh endpoint health checks before test start
- Parameterized runner scripts for thread count, duration, ramp-up, and loop count
- Results and HTML reports generated automatically

### How to Run a Load Test

```sh
npm run test:load
# or run manually:
cd tests/load-tests
./run-complete-test.sh [NUM_THREADS] [DURATION] [RAMP_UP] [LOOP_COUNT] [LOOP_CONTINUE_FOREVER]
```

- Example: `./run-complete-test.sh 10 60 10 1000 false`

### Configuration

- The main test plan is in `tests/load-tests/jmeter/load-test-unified.jmx`
- Results and reports are in `tests/load-tests/results/`
- API server logs are in `tests/load-tests/temp/api.log`
- All parameters can be set via CLI or environment variables

### Troubleshooting

- If the test stalls, check the API server logs in `tests/load-tests/temp/api.log`
- Ensure proper tenant ID handling via headers or query parameters
- Check JSON extraction in JMeter if "NOT_FOUND" errors occur
- Use timeouts in JMeter HTTP samplers to avoid hanging threads

### Customization

- You can edit the load-test-unified.jmx file to add new scenarios or endpoints
- Scripts are modular and can be extended for CI/CD integration

---
## 🚦 How to Run Tests

### 1. **All Unit/Integration Tests**
```sh
npm test
# or
npm run test
```
- Runs all Jest tests in all apps and shared.
- Uses an in-memory database for speed and isolation.

### 2. **App/Package-Specific Tests**
```sh
cd apps/interface && npm test
cd apps/dashboard && npm test
cd packages/prism && npm test
```

### 3. **E2E (Cypress) Tests**
- **If you have a DB container running:**
  ```sh
  npm run test:e2e
  ```
- **If you want to start a local container and clone data from AWS:**
  ```sh
  npm run test:e2e:auto
  ```
- **To run all Cypress tests:**
  ```sh
  npm run cypress:run
  ```
- **To run a specific Cypress test file:**
  ```sh
  npx cypress run --spec "apps/interface/__tests-e2e__/e2e/dynamicContent-actions.cy.js"
  ```
- **To open Cypress in interactive mode:**
  ```sh
  npm run cypress:open
  ```

---

## 🏗️ Test Frameworks & Configuration

- **Jest** is used for all unit and integration tests (TypeScript, React, Node, API, etc.).
  - Configured via `jest.config.mjs` at the repo root.
  - Uses `ts-jest` for TypeScript/TSX support.
  - Coverage is collected and output to `/coverage`.
- **Cypress** is used for E2E tests in the interface app.
  - Configured via `cypress.config.js` and `cypress/` directory at the root.

---

## 🗂️ Test Structure & Strategy

### **Philosophy**
- **Shared logic is tested in `packages/prism/__tests__`** to ensure business rules, actions, and utilities are robust and reusable.
- **App-specific tests** live in each app's `__tests__` directory, focusing on API routes, integration, and UI flows unique to that app.
- **E2E tests** in the interface app verify real user workflows and cross-component integration.
- **Test files are colocated at the root of each app or in `packages/prism` for discoverability and consistency.**
- **Legacy migration code** is tested separately and lives in `migration/` folders, not part of main app logic.

### **Test Coverage**
- Coverage is collected for all core logic, actions, and API routes.
- Reports are output to `/coverage` and can be viewed in HTML or text format.

---

## 🧑‍💻 IDE Integration

- **Jest extension for VSCode:**
  - Use the following settings (see `.example.vscode.settings.json`):
    ```json
    {
      "jest.debugMode": false,
      "jest.jestCommandLine": "./node_modules/.bin/jest --maxWorkers=4 --config jest.config.mjs",
      "jest.nodeEnv": {
        "NODE_ENV": "test"
      },
      "jest.runMode": "on-demand",
      "testExplorer.useNativeTesting": true,
      "testExplorer.codeLens": true,
      "testExplorer.showOnRun": true,
      "testExplorer.onReload": "retire",
      "testExplorer.onStart": "reset",
      "testExplorer.gutterDecoration": true,
      "testExplorer.sort": "byLocation"
    }
    ```
- This enables test discovery, code lens, and gutter decorations in VSCode.

### Python Bot (Pipecat) Test Integration

The imported Daily Pipecat bot (`apps/pipecat-daily-bot/bot`) now has a minimal **pytest** harness.

**Key points:**

| Item | Location / Command |
|------|--------------------|
| Tests directory | `apps/pipecat-daily-bot/bot/tests/` |
| Sample tests | `test_personalities.py`, `test_build_pipeline.py` |
| Run just Python tests | `cd apps/pipecat-daily-bot/bot && poetry run pytest -q` |
| Combined JS + Python | `npm test` (Python runs after Jest) |
| Skip behavior | If Poetry not installed, Python tests are skipped gracefully |

**VS Code Integration:**

Add (already present in `.vscode/settings.json`):

```json
{
  "python.testing.pytestEnabled": true,
  "python.testing.unittestEnabled": false,
  "python.testing.pytestArgs": [
    "apps/pipecat-daily-bot/bot/tests"
  ]
}
```

You will also need the `ms-python.python` extension installed. If using Poetry, ensure the interpreter selected in VS Code points at the bot virtualenv (or set `python.defaultInterpreterPath`).

**Adding More Tests:**

- Place additional test modules in the same `tests/` folder (pytest auto-discovers `test_*.py`).
- Prefer fast, side-effect free tests (don’t join a real Daily room in unit tests; you can mock `DailyTransport` or future abstraction layers).
- For integration-style checks later, consider a separate `tests/integration/` subfolder and mark them with `@pytest.mark.integration` so they can be excluded by default.

**Future Enhancements (not yet implemented):**

- Add `pytest-cov` to collect coverage for the bot code.
- Introduce mocks for LLM/STT/TTS services to validate conversational turns deterministically.
- Wire Python coverage into a combined multi-language coverage report if desired (e.g., via `coverage combine` with lcov conversion).

---

## 🛠️ Troubleshooting

- **Test not discovered?**
  - Ensure your test file ends with `.test.ts` or `.test.tsx` and is in a `__tests__` folder at the app or prism root.
  - Make sure `moduleFileExtensions` in `jest.config.mjs` includes `'tsx'`.
  - Clear Jest cache: `npx jest --clearCache`
  - Check your `tsconfig.json` includes test files and has `jsx`, `esModuleInterop`, and `allowSyntheticDefaultImports` set.
- **Need to see test logs?**
  - Add `DEBUG_TEST=true` to your `.env.local` file to enable full console logging during tests.
  - By default, Jest silences console logs to keep test output clean, but this setting will show all logs.
  - Example:
  
    ```bash
    # In .env.local
    DEBUG_TEST=true
    ```
    
  - This is especially useful when debugging complex test scenarios or when you need to see what's happening in the background.
- **Cypress errors?**
  - Clear Cypress cache: `npx cypress cache clear`
  - Reinstall Cypress: `npx cypress install`
  - Ensure the app and database are running.
- **Database issues?**
  - Use `npm run pg:start` to start a local Postgres container and clone data from AWS if needed.

---

## 🧭 Summary

- **Unit/integration tests**: `npm test` (all), or per-app / prism.
- **E2E tests**: `npm run test:e2e` or `npm run test:e2e:auto` (with DB container).
- **Test files**: At app / prism root in `__tests__` folders, named `*.test.ts(x)`.
- **Coverage**: `/coverage` directory.
- **IDE integration**: VSCode Jest extension recommended.
- **Troubleshooting**: See above for common issues and fixes.

---

For any questions or to contribute to the testing strategy, see the root `jest.config.mjs`, `cypress.config.js`, and the `packages/prism/__tests__` directory for examples.
