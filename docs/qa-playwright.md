# PearlOS QA Playwright Screenshot Workflow

Automated screenshot capture for PearlOS visual QA, targeting the ActiveJobsWidget and full-page state.

## Quick Start

```bash
# Ensure PearlOS is running locally
npm run start:all

# Run the screenshot workflow
npm run qa:screenshot
```

Screenshots are saved to `qa/screenshots/` with ISO-8601 timestamps.

## How It Works

1. Launches headless Chromium via Playwright
2. Navigates to `http://localhost:3000/login`
3. Authenticates using `DASHBOARD_ADMIN_EMAIL` / `DASHBOARD_ADMIN_PASSWORD` from `.env.local`
4. Waits for the ActiveJobsWidget to mount (detected via the `gohufont-active-jobs` style tag)
5. Captures a full-page screenshot
6. Attempts a targeted screenshot of the ActiveJobsWidget element
7. Saves both to `qa/screenshots/` with timestamped filenames

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DASHBOARD_ADMIN_EMAIL` | (from `.env.local`) | Login email |
| `DASHBOARD_ADMIN_PASSWORD` | (from `.env.local`) | Login password |
| `PEARLOS_URL` | `http://localhost:3000` | Base URL of the Interface app |

## CI/CD Integration

The GitHub Action at `.github/workflows/qa-screenshot.yml` runs on every PR to `main` or `staging`:

1. Installs dependencies and Playwright browsers
2. Starts PearlOS in the background
3. Waits for the Interface to respond on port 3000
4. Runs `npm run qa:screenshot`
5. Uploads screenshots as build artifacts (retained 30 days)

### Required Secrets

Add these to your GitHub repository secrets:

- `DASHBOARD_ADMIN_EMAIL`
- `DASHBOARD_ADMIN_PASSWORD`

### Manual Trigger

The workflow also supports `workflow_dispatch` for on-demand runs from the Actions tab.

## Output

```
qa/screenshots/
  pearlos-full-2026-04-22T04-54-00-000Z.png      # Full-page capture
  active-jobs-widget-2026-04-22T04-54-02-000Z.png # Widget-only capture
  failure-2026-04-22T04-54-05-000Z.png            # Only on error
```

## Extending

To screenshot additional selectors, add entries to the `widgetSelectors` array in `scripts/qa-screenshot.ts`. The script tries each selector in order and captures the first match.

For broader visual regression testing, see the existing suite at `tests/visual-regression/`.
