#!/usr/bin/env node
/**
 * Pearl-OS - Setup Wizard TUI (using inquirer)
 * Provides arrow-key navigation, multi-select checkboxes (spacebar), Enter to proceed
 */

import inquirer from 'inquirer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { writeFileSync, readFileSync, existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '..');

const ALL_STEPS = [
  { name: 'Permissions / consent', value: 'permissions', default: true },
  { name: 'Assess prerequisites (check what\'s missing, offer to install)', value: 'assess_prerequisites', default: true },
  { name: 'Check prerequisites (verify all tools are available)', value: 'prerequisites', default: true },
  { name: 'Install Node.js (if missing)', value: 'install_nodejs', default: true },
  { name: 'Install Poetry', value: 'install_poetry', default: true },
  { name: 'Install uv', value: 'install_uv', default: true },
  { name: 'Initialize git submodules (chorus-tts)', value: 'init_submodules', default: true },
  { name: 'Install npm dependencies', value: 'install_npm_deps', default: true },
  { name: 'Install bot Python dependencies (pipecat)', value: 'install_bot_deps', default: false },
  { name: 'Download Chorus assets (Kokoro TTS)', value: 'download_chorus_assets', default: false },
  { name: 'Setup environment files (.env.local + app envs + bot .env)', value: 'setup_env', default: true },
  { name: 'Credentials (API keys → .env.local)', value: 'credentials', default: true },
  { name: 'Setup PostgreSQL (includes seeding)', value: 'setup_postgres', default: true },
  { name: 'Build project (npm run build)', value: 'build_project', default: true },
  { name: 'Start development server (npm run dev)', value: 'start_dev_server', default: true },
  { name: 'Functional prompts (verify project is running)', value: 'functional_prompts', default: true },
];

const PRESETS = {
  full: ALL_STEPS.map(s => s.value),
  minimal: ALL_STEPS.filter(s => s.default).map(s => s.value),
};

async function promptPreset() {
  const { preset } = await inquirer.prompt([
    {
      type: 'list',
      name: 'preset',
      message: 'Choose a setup preset:',
      choices: [
        { name: 'Full setup (all steps)', value: 'full' },
        { name: 'Minimal setup (essential steps only)', value: 'minimal' },
        { name: 'Custom (choose individual steps)', value: 'custom' },
      ],
      default: 'minimal',
    },
  ]);
  return preset;
}

async function promptSteps(preset) {
  if (preset === 'custom') {
    const { steps } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'steps',
        message: 'Select setup steps (↑↓ to navigate, Space to toggle, Enter to confirm):',
        choices: ALL_STEPS,
        pageSize: 15,
        loop: true,
        validate: (answer) => {
          if (answer.length === 0) {
            return 'Please select at least one step.';
          }
          return true;
        },
      },
    ]);
    return steps;
  }
  return PRESETS[preset] || PRESETS.minimal;
}

async function promptEnvFileChoice(existingFiles) {
  const { choice } = await inquirer.prompt([
    {
      type: 'list',
      name: 'choice',
      message: 'Existing environment files detected. What would you like to do?',
      choices: [
        { name: 'Keep all existing env files (just sync secrets)', value: 'keep' },
        { name: 'Recreate root .env.local only (recommended - apps will sync from root)', value: 'recreate_root' },
        { name: 'Clear ALL and recreate from scratch', value: 'clear_all' },
      ],
      default: 'keep',
    },
  ]);
  return choice;
}

async function promptDatabaseSeeding() {
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'Database seeding options:',
      choices: [
        { name: 'Skip (keep existing data)', value: 'skip' },
        { name: 'Add seed data alongside existing', value: 'add' },
        { name: 'Clear all and reseed (destructive!)', value: 'clear_reseed' },
      ],
      default: 'add',
    },
  ]);
  return action;
}

function readEnvFile(envPath) {
  const env = {};
  if (!existsSync(envPath)) {
    return env;
  }
  
  try {
    const content = readFileSync(envPath, 'utf8');
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = trimmed.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        let value = match[2].trim();
        // Remove quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        env[key] = value;
      }
    }
  } catch (err) {
    // Ignore errors
  }
  return env;
}

function maskApiKey(key) {
  if (!key || key.length < 8) return key;
  return key.substring(0, 4) + '....' + key.substring(key.length - 4);
}

async function promptTtsProvider() {
  const { provider } = await inquirer.prompt([
    {
      type: 'list',
      name: 'provider',
      message: 'Which TTS (Text-to-Speech) provider would you like to use?',
      choices: [
        { name: 'Chorus TTS (local, open-source)', value: 'chorus' },
        { name: 'ElevenLabs (cloud, requires API key)', value: 'elevenlabs' },
      ],
      default: 'chorus',
    },
  ]);
  return provider;
}

async function promptCredentials() {
  const { collect } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'collect',
      message: 'Would you like to enter API keys now? (Daily.co, OpenAI, Deepgram)',
      default: true,
    },
  ]);

  if (!collect) {
    return {};
  }

  // Ask about TTS provider first
  const ttsProvider = await promptTtsProvider();
  
  const envPath = join(REPO_ROOT, '.env.local');
  const existingEnv = readEnvFile(envPath);
  
  const creds = { ttsProvider };
  const apiKeys = [
    {
      name: 'daily',
      envKey: 'DAILY_API_KEY',
      label: 'DAILY_API_KEY',
      url: 'https://dashboard.daily.co',
    },
    {
      name: 'openai',
      envKey: 'OPENAI_API_KEY',
      label: 'OPENAI_API_KEY',
      url: 'https://platform.openai.com/api-keys',
    },
    {
      name: 'deepgram',
      envKey: 'DEEPGRAM_API_KEY',
      label: 'DEEPGRAM_API_KEY',
      url: 'https://console.deepgram.com/',
    },
  ];
  
  // Add ElevenLabs API key if chosen
  if (ttsProvider === 'elevenlabs') {
    apiKeys.push({
      name: 'elevenlabs',
      envKey: 'ELEVENLABS_API_KEY',
      label: 'ELEVENLABS_API_KEY',
      url: 'https://elevenlabs.io/app/settings/api-keys',
    });
  }

  for (const apiKey of apiKeys) {
    const existing = existingEnv[apiKey.envKey];
    
    if (existing) {
      const masked = maskApiKey(existing);
      const { action } = await inquirer.prompt([
        {
          type: 'list',
          name: 'action',
          message: `${apiKey.label} exists: ${masked}`,
          choices: [
            { name: `Use existing key (${masked})`, value: 'use' },
            { name: 'Update the API key', value: 'update' },
            { name: 'Skip', value: 'skip' },
          ],
          default: 'use',
        },
      ]);

      if (action === 'use') {
        if (apiKey.name === 'daily') {
          creds.DAILY_API_KEY = existing;
          creds.daily = existing; // Also include old format for backward compatibility
        }
        if (apiKey.name === 'openai') {
          creds.OPENAI_API_KEY = existing;
          creds.openai = existing; // Also include old format for backward compatibility
        }
        if (apiKey.name === 'deepgram') {
          creds.DEEPGRAM_API_KEY = existing;
          creds.deepgram = existing; // Also include old format for backward compatibility
        }
        if (apiKey.name === 'elevenlabs') {
          creds.ELEVENLABS_API_KEY = existing;
          creds.elevenlabs = existing; // Also include old format for backward compatibility
        }
        continue;
      } else if (action === 'skip') {
        continue;
      }
      // Fall through to update prompt
    }

    const { value } = await inquirer.prompt([
      {
        type: 'password',
        name: 'value',
        message: `${apiKey.label} (get from ${apiKey.url}):`,
        mask: '*',
        validate: (input) => input.length > 0 || 'API key cannot be empty',
      },
    ]);

    if (apiKey.name === 'daily') {
      creds.DAILY_API_KEY = value;
      creds.daily = value; // Also include old format for backward compatibility
    }
    if (apiKey.name === 'openai') {
      creds.OPENAI_API_KEY = value;
      creds.openai = value; // Also include old format for backward compatibility
    }
    if (apiKey.name === 'deepgram') {
      creds.DEEPGRAM_API_KEY = value;
      creds.deepgram = value; // Also include old format for backward compatibility
    }
    if (apiKey.name === 'elevenlabs') {
      creds.ELEVENLABS_API_KEY = value;
      creds.elevenlabs = value; // Also include old format for backward compatibility
    }
  }

  return creds;
}

async function promptPermissions() {
  const { consent } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'consent',
      message: `This setup will:
  • Install system packages (may require sudo/admin)
  • Create/modify .env files
  • Configure PostgreSQL database
  • Run npm install and other package managers

Proceed?`,
      default: false,
    },
  ]);
  return consent;
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const outputFile = process.env.TUI_OUTPUT_FILE;

  const writeOutput = (data) => {
    const json = JSON.stringify(data);
    if (outputFile) {
      writeFileSync(outputFile, json, 'utf8');
    } else {
      console.log(json);
    }
  };

  if (command === 'preset') {
    const preset = await promptPreset();
    writeOutput({ preset });
    return;
  }

  if (command === 'steps') {
    const preset = args[1] || 'minimal';
    const steps = await promptSteps(preset);
    writeOutput({ steps });
    return;
  }

  if (command === 'credentials') {
    const creds = await promptCredentials();
    writeOutput(creds);
    return;
  }

  if (command === 'permissions') {
    const consent = await promptPermissions();
    writeOutput({ consent });
    return;
  }

  if (command === 'env-choice') {
    const existingFiles = args[1] ? args[1].split(',') : [];
    const choice = await promptEnvFileChoice(existingFiles);
    writeOutput({ choice });
    return;
  }

  if (command === 'db-seeding') {
    const action = await promptDatabaseSeeding();
    writeOutput({ action });
    return;
  }

  // Full interactive flow
  const preset = await promptPreset();
  const steps = await promptSteps(preset);
  const consent = await promptPermissions();
  const creds = await promptCredentials();

  writeOutput({ preset, steps, consent, creds });
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});

