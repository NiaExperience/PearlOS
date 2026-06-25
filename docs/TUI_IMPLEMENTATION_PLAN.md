# TUI Implementation Plan - Missing TUI Prompts

Based on the terminal output analysis, here are all the places where simple `read` prompts are used instead of TUI:

## Current Status

### ✅ Already Using TUI
1. **Preset selection** - `promptPreset()` ✓
2. **Step selection** - `promptSteps()` ✓
3. **Permissions/consent** - `promptPermissions()` ✓
4. **Credentials/API keys** - `promptCredentials()` ✓
5. **Environment file choice** - `promptEnvFileChoice()` ✓
6. **Database seeding** - `promptDatabaseSeeding()` ✓

### ❌ Still Using Simple Prompts (Need TUI)

#### 1. **"Run the selected steps now?"** (Line 970 in new-setup.sh)
- **Location**: `confirm_or_exit()` function
- **Current**: `read -r -p "$prompt (y/N): " ans`
- **Should be**: TUI confirm prompt
- **Function needed**: `promptConfirmRunSteps()`

#### 2. **"Continue to next step?"** (Line 1000 in new-setup.sh)
- **Location**: `run_selected()` when a step fails
- **Current**: `read -r -p "Continue to next step? (Y/n): " cont`
- **Should be**: TUI confirm prompt
- **Function needed**: `promptContinueOnFailure()`

#### 3. **Build failure options** (Lines 1065-1071 in new-setup.sh)
- **Location**: `build_project()` when build fails
- **Current**: Numbered options (1-4)
  ```
  1) Try to fix common build issues automatically
  2) Show full build log
  3) Skip build and continue
  4) Abort setup
  ```
- **Should be**: TUI list prompt
- **Function needed**: `promptBuildFailureAction()`

#### 4. **Functional verification prompts** (Lines 1266, 1279 in new-setup.sh)
- **Location**: `functional_prompts()` function
- **Current**: Two separate `read` prompts:
  - `"Is the interface working correctly? (y/N): "`
  - `"Are all services working? (y/N): "`
- **Should be**: TUI confirm prompts
- **Function needed**: `promptFunctionalVerification()`

#### 5. **Prerequisite installation choice** (Line 296 in new-setup.sh)
- **Location**: `assess_prerequisites()` function
- **Current**: Numbered options (1-4)
  ```
  1) Install all missing items (recommended)
  2) Install package manager only (Homebrew/apt/etc)
  3) Install tools only (git, Node.js, Python, etc.)
  4) Skip installation (you can install manually later)
  ```
- **Should be**: TUI list prompt
- **Function needed**: `promptPrerequisiteInstallChoice()`

## Implementation Steps

### Step 1: Add TUI Functions to `setup-wizard-ui.mjs`

Add these new functions:

```javascript
async function promptConfirmRunSteps() {
  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: 'Run the selected steps now?',
      default: true,
    },
  ]);
  return confirm;
}

async function promptContinueOnFailure() {
  const { continue } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'continue',
      message: 'Continue to next step?',
      default: true,
    },
  ]);
  return continue;
}

async function promptBuildFailureAction() {
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'Build failed. What would you like to do?',
      choices: [
        { name: 'Try to fix common build issues automatically', value: 'fix' },
        { name: 'Show full build log', value: 'show_log' },
        { name: 'Skip build and continue', value: 'skip' },
        { name: 'Abort setup', value: 'abort' },
      ],
      default: 'skip',
    },
  ]);
  return action;
}

async function promptFunctionalVerification() {
  const { interfaceOk, servicesOk } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'interfaceOk',
      message: `Please verify:
  1) Open http://localhost:3000 in your browser
  2) Check if the interface loads correctly
  3) Try navigating to different pages

Is the interface working correctly?`,
      default: false,
    },
    {
      type: 'confirm',
      name: 'servicesOk',
      message: `Additional checks:
  4) Check http://localhost:2000/graphql (GraphQL Playground)
  5) Check http://localhost:4000 (Dashboard, if available)

Are all services working?`,
      default: false,
    },
  ]);
  return { interfaceOk, servicesOk };
}

async function promptPrerequisiteInstallChoice() {
  const { choice } = await inquirer.prompt([
    {
      type: 'list',
      name: 'choice',
      message: 'Missing prerequisites detected. What would you like to do?',
      choices: [
        { name: 'Install all missing items (recommended)', value: 'all' },
        { name: 'Install package manager only (Homebrew/apt/etc)', value: 'package_manager' },
        { name: 'Install tools only (git, Node.js, Python, etc.)', value: 'tools' },
        { name: 'Skip installation (you can install manually later)', value: 'skip' },
      ],
      default: 'all',
    },
  ]);
  return choice;
}
```

### Step 2: Add Command Handlers in `setup-wizard-ui.mjs`

Add these to the `main()` function:

```javascript
if (command === 'confirm-run-steps') {
  const confirm = await promptConfirmRunSteps();
  writeOutput({ confirm });
  return;
}

if (command === 'continue-on-failure') {
  const continue = await promptContinueOnFailure();
  writeOutput({ continue });
  return;
}

if (command === 'build-failure') {
  const action = await promptBuildFailureAction();
  writeOutput({ action });
  return;
}

if (command === 'functional-verification') {
  const result = await promptFunctionalVerification();
  writeOutput(result);
  return;
}

if (command === 'prerequisite-install') {
  const choice = await promptPrerequisiteInstallChoice();
  writeOutput({ choice });
  return;
}
```

### Step 3: Update `new-setup.sh` to Use TUI

#### 3.1: Update `confirm_or_exit()` (Line 950)
```bash
confirm_or_exit() {
  local prompt="$1"
  if $NON_INTERACTIVE; then
    return 0
  fi
  
  if $USE_TUI && is_interactive && command_exists node && [[ -f "$TUI_SCRIPT" ]]; then
    local tmpfile
    tmpfile=$(mktemp)
    cd "$REPO_ROOT" && TUI_OUTPUT_FILE="$tmpfile" NODE_PATH="${REPO_ROOT}/node_modules" node "$TUI_SCRIPT" confirm-run-steps
    local tui_result
    tui_result=$(cat "$tmpfile" 2>/dev/null)
    rm -f "$tmpfile"
    if [[ -n "$tui_result" ]] && echo "$tui_result" | grep -q '"confirm":true'; then
      return 0
    else
      echo "Aborted."
      exit 0
    fi
  else
    read -r -p "$prompt (y/N): " ans
    if [[ ! "$ans" =~ ^[yY]$ ]]; then
      echo "Aborted."
      exit 0
    fi
  fi
}
```

#### 3.2: Update `run_selected()` - Continue on failure (Line 1000)
```bash
# Replace the read prompt with TUI call
if is_interactive && ! $NON_INTERACTIVE; then
  local should_continue=true
  if $USE_TUI && command_exists node && [[ -f "$TUI_SCRIPT" ]]; then
    local tmpfile
    tmpfile=$(mktemp)
    cd "$REPO_ROOT" && TUI_OUTPUT_FILE="$tmpfile" NODE_PATH="${REPO_ROOT}/node_modules" node "$TUI_SCRIPT" continue-on-failure
    local tui_result
    tui_result=$(cat "$tmpfile" 2>/dev/null)
    rm -f "$tmpfile"
    if [[ -z "$tui_result" ]] || ! echo "$tui_result" | grep -q '"continue":true'; then
      should_continue=false
    fi
  else
    read -r -p "Continue to next step? (Y/n): " cont
    if [[ "$cont" =~ ^[nN]$ ]]; then
      should_continue=false
    fi
  fi
  
  if [[ "$should_continue" == "false" ]]; then
    break
  fi
fi
```

#### 3.3: Update `build_project()` - Build failure (Lines 1064-1108)
```bash
if is_interactive && ! $NON_INTERACTIVE; then
  local fix_choice="skip"
  if $USE_TUI && command_exists node && [[ -f "$TUI_SCRIPT" ]]; then
    local tmpfile
    tmpfile=$(mktemp)
    cd "$REPO_ROOT" && TUI_OUTPUT_FILE="$tmpfile" NODE_PATH="${REPO_ROOT}/node_modules" node "$TUI_SCRIPT" build-failure
    local tui_result
    tui_result=$(cat "$tmpfile" 2>/dev/null)
    rm -f "$tmpfile"
    if [[ -n "$tui_result" ]]; then
      fix_choice=$(echo "$tui_result" | grep -o '"action":"[^"]*"' | cut -d'"' -f4)
    fi
  else
    echo -e "${YELLOW}  Would you like to:${NC}"
    echo "    1) Try to fix common build issues automatically"
    echo "    2) Show full build log"
    echo "    3) Skip build and continue"
    echo "    4) Abort setup"
    echo ""
    read -r -p "  Choose option [1-4] (default: 3): " fix_choice_input
    case "${fix_choice_input:-3}" in
      1) fix_choice="fix" ;;
      2) fix_choice="show_log" ;;
      3) fix_choice="skip" ;;
      4) fix_choice="abort" ;;
    esac
  fi

  case "$fix_choice" in
    fix)
      # ... existing fix logic ...
      ;;
    show_log)
      # ... existing show log logic ...
      ;;
    skip)
      echo -e "${YELLOW}  Skipping build. You can run 'npm run build' manually later.${NC}"
      rm -f "$build_log"
      return 0
      ;;
    abort)
      echo "Setup aborted."
      rm -f "$build_log"
      exit 1
      ;;
  esac
fi
```

#### 3.4: Update `functional_prompts()` - Verification (Lines 1257-1285)
```bash
# Replace the two read prompts with TUI
if $USE_TUI && is_interactive && ! $NON_INTERACTIVE && command_exists node && [[ -f "$TUI_SCRIPT" ]]; then
  local tmpfile
  tmpfile=$(mktemp)
  cd "$REPO_ROOT" && TUI_OUTPUT_FILE="$tmpfile" NODE_PATH="${REPO_ROOT}/node_modules" node "$TUI_SCRIPT" functional-verification
  local tui_result
  tui_result=$(cat "$tmpfile" 2>/dev/null)
  rm -f "$tmpfile"
  
  if [[ -n "$tui_result" ]]; then
    local interface_ok services_ok
    interface_ok=$(echo "$tui_result" | grep -o '"interfaceOk":true' >/dev/null && echo "true" || echo "false")
    services_ok=$(echo "$tui_result" | grep -o '"servicesOk":true' >/dev/null && echo "true" || echo "false")
    
    if [[ "$interface_ok" == "true" ]]; then
      echo -e "${GREEN}  ✓ Interface verified${NC}"
    else
      echo -e "${YELLOW}  ! Interface may have issues. Check the browser console for errors.${NC}"
    fi
    
    if [[ "$services_ok" == "true" ]]; then
      echo -e "${GREEN}  ✓ All services verified${NC}"
    else
      echo -e "${YELLOW}  ! Some services may have issues. Check logs at /tmp/pearl-os-dev.log${NC}"
    fi
  fi
else
  # Fallback to simple prompts
  echo "Let's verify the project is working correctly:"
  echo ""
  echo "Please verify the following:"
  echo "  1) Open http://localhost:3000 in your browser"
  echo "  2) Check if the interface loads correctly"
  echo "  3) Try navigating to different pages"
  echo ""
  read -r -p "Is the interface working correctly? (y/N): " interface_ok
  # ... rest of fallback logic ...
fi
```

#### 3.5: Update `assess_prerequisites()` - Install choice (Line 296)
```bash
if $USE_TUI && is_interactive && ! $NON_INTERACTIVE && command_exists node && [[ -f "$TUI_SCRIPT" ]]; then
  local tmpfile
  tmpfile=$(mktemp)
  cd "$REPO_ROOT" && TUI_OUTPUT_FILE="$tmpfile" NODE_PATH="${REPO_ROOT}/node_modules" node "$TUI_SCRIPT" prerequisite-install
  local tui_result
  tui_result=$(cat "$tmpfile" 2>/dev/null)
  rm -f "$tmpfile"
  local install_choice
  if [[ -n "$tui_result" ]]; then
    install_choice=$(echo "$tui_result" | grep -o '"choice":"[^"]*"' | cut -d'"' -f4)
  fi
  install_choice="${install_choice:-all}"
else
  echo "Would you like to install missing items now?"
  echo "  1) Install all missing items (recommended)"
  echo "  2) Install package manager only (Homebrew/apt/etc)"
  echo "  3) Install tools only (git, Node.js, Python, etc.)"
  echo "  4) Skip installation (you can install manually later)"
  echo ""
  read -r -p "Choose option [1-4] (default: 1): " install_choice
  case "${install_choice:-1}" in
    1) install_choice="all" ;;
    2) install_choice="package_manager" ;;
    3) install_choice="tools" ;;
    4) install_choice="skip" ;;
  esac
fi

case "$install_choice" in
  all)
    # Install package managers first, then tools
    if [[ ${#missing_package_managers[@]} -gt 0 ]]; then
      install_package_managers
    fi
    if [[ ${#missing_tools[@]} -gt 0 ]]; then
      install_missing_tools
    fi
    ;;
  package_manager)
    if [[ ${#missing_package_managers[@]} -gt 0 ]]; then
      install_package_managers
    fi
    ;;
  tools)
    install_missing_tools
    ;;
  skip)
    echo -e "${YELLOW}  Skipping installation. You may need to install items manually.${NC}"
    ;;
esac
```

### Step 4: Fix Syntax Error in `setup.sh`

**Line 786**: Remove duplicate `1)` case label:
```bash
case "${env_choice:-keep}" in
    keep|1)  # Remove the duplicate "1)" on line 786
        echo ""
        echo -e "${GREEN}  ✓ Keeping existing env files${NC}"
        # ...
```

## Summary

After implementation, **ALL** interactive prompts will use TUI when:
- `USE_TUI` is true
- Terminal is interactive
- Node.js and `inquirer` are available

Fallback to simple `read` prompts will remain for:
- Non-interactive mode
- When TUI is not available
- When Node.js/inquirer are missing


