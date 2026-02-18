#!/usr/bin/env tsx
/**
 * Check Assistant voice configurations
 */

import * as path from 'path';
import * as dotenv from 'dotenv';

const envPath = path.resolve(__dirname, '../.env.local');
dotenv.config({ path: envPath });

import { AssistantActions } from '@nia/prism/core/actions';

async function main() {
  const { Prism } = await import('@nia/prism');
  const prism = await Prism.getInstance();

  const result = await prism.query({
    contentType: 'Assistant',
    tenantId: 'any',
    where: { type: { eq: 'Assistant' } },
    limit: 100,
  } as any);

  console.log(`Found ${result.items?.length || 0} Assistant(s)\n`);

  for (const assistant of result.items || []) {
    const name = assistant.name || assistant._id;
    console.log(`📝 ${name}:`);

    if (assistant.modePersonalityVoiceConfig) {
      console.log('  OS Mode Config:');
      for (const [mode, config] of Object.entries(assistant.modePersonalityVoiceConfig)) {
        const voice = (config as any)?.voice || {};
        const provider = voice.provider || 'none';
        const voiceId = voice.voiceId || 'none';
        console.log(`    ${mode}: ${provider}/${voiceId}`);
      }
    }

    if (assistant.dailyCallPersonalityVoiceConfig) {
      console.log('  DailyCall Config:');
      for (const [mode, config] of Object.entries(assistant.dailyCallPersonalityVoiceConfig)) {
        const voice = (config as any)?.voice || {};
        const provider = voice.provider || 'none';
        const voiceId = voice.voiceId || 'none';
        console.log(`    ${mode}: ${provider}/${voiceId}`);
      }
    }
    console.log('');
  }
}

main().catch(console.error);

