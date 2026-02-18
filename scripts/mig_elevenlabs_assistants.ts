#!/usr/bin/env tsx
/**
 * mig_elevenlabs_assistants.ts
 *
 * Migration script to update Assistant modePersonalityVoiceConfig from Kokoro to ElevenLabs.
 *
 * Usage:
 *   npx tsx scripts/mig_elevenlabs_assistants.ts <elevenlabs_voice_id>
 *
 * Behavior:
 *   - Finds all Assistant records with modePersonalityVoiceConfig or dailyCallPersonalityVoiceConfig.
 *   - Updates all voice.provider from 'kokoro' to 'elevenlabs' (or '11labs').
 *   - Updates all voice.voiceId to the provided ElevenLabs voice ID.
 *   - Preserves all other configuration fields.
 *
 * This updates the Assistant-level configurations shown in the dashboard UI.
 */

/* eslint-disable no-console, @typescript-eslint/no-explicit-any */

import * as path from 'path';
import * as dotenv from 'dotenv';

// Load .env.local from the project root
const envPath = path.resolve(__dirname, '../.env.local');
const result = dotenv.config({ path: envPath });

if (result.error) {
  console.warn(`⚠️  Could not load .env.local from ${envPath}`);
  console.warn('   Make sure MESH_SHARED_SECRET is set in your environment');
} else {
  console.log(`✅ Loaded environment from ${envPath}`);
}

import { AssistantActions } from '@nia/prism/core/actions';

const CONTENT_TYPE = 'Assistant';

async function updateModeConfig(
  config: Record<string, any> | undefined,
  targetVoiceId: string,
): Promise<Record<string, any> | undefined> {
  if (!config || typeof config !== 'object') {
    return config;
  }

  let updated = false;
  const updatedConfig: Record<string, any> = {};

  for (const [mode, modeConfig] of Object.entries(config)) {
    if (!modeConfig || typeof modeConfig !== 'object') {
      updatedConfig[mode] = modeConfig;
      continue;
    }

    const voice = modeConfig.voice || modeConfig;
    const currentProvider = voice?.provider || voice?.voiceProvider;
    const currentVoiceId = voice?.voiceId;

    // Check if this mode uses Kokoro
    if (currentProvider === 'kokoro' || currentProvider === 'Kokoro') {
      // Update to ElevenLabs
      const updatedModeConfig = {
        ...modeConfig,
        voice: {
          ...voice,
          provider: 'elevenlabs',
          voiceId: targetVoiceId,
        },
      };
      updatedConfig[mode] = updatedModeConfig;
      updated = true;
      console.log(`  🔄 ${mode}: kokoro/${currentVoiceId} → elevenlabs/${targetVoiceId}`);
    } else if (currentProvider === 'elevenlabs' || currentProvider === '11labs') {
      // Already ElevenLabs, but update voice ID if different
      if (currentVoiceId !== targetVoiceId) {
        const updatedModeConfig = {
          ...modeConfig,
          voice: {
            ...voice,
            voiceId: targetVoiceId,
          },
        };
        updatedConfig[mode] = updatedModeConfig;
        updated = true;
        console.log(`  🔄 ${mode}: elevenlabs/${currentVoiceId} → elevenlabs/${targetVoiceId}`);
      } else {
        updatedConfig[mode] = modeConfig;
        console.log(`  ✅ ${mode}: Already set to elevenlabs/${targetVoiceId}`);
      }
    } else {
      // Unknown provider or no voice config, keep as-is
      updatedConfig[mode] = modeConfig;
    }
  }

  return updated ? updatedConfig : config;
}

async function main() {
  const voiceId = process.argv[2];

  if (!voiceId) {
    console.error('Usage: npx tsx scripts/mig_elevenlabs_assistants.ts <elevenlabs_voice_id>');
    console.error('Example: npx tsx scripts/mig_elevenlabs_assistants.ts kdmDKE6EkgrWrrykO9Qt');
    process.exit(1);
  }

  console.log('🔄 Starting Assistant ElevenLabs voice migration...');
  console.log(`   Target voiceId: ${voiceId}\n`);

  try {
    // Get all assistants
    // Note: AssistantActions doesn't have a getAll method, so we'll need to query via Prism
    const { Prism } = await import('@nia/prism');
    const prism = await Prism.getInstance();

    console.log('📋 Querying Assistant records...');
    const result = await prism.query({
      contentType: CONTENT_TYPE,
      tenantId: 'any',
      where: {
        type: { eq: CONTENT_TYPE },
      },
      limit: 1000,
    } as any);

    if (!result.items || result.items.length === 0) {
      console.log('ℹ️  No Assistant records found. Nothing to migrate.');
      return;
    }

    console.log(`Found ${result.items.length} Assistant(s)\n`);

    let updatedCount = 0;
    let skippedCount = 0;

    for (const assistant of result.items as any[]) {
      const assistantId = assistant.page_id || assistant._id;
      if (!assistantId) {
        console.warn('⚠️  Skipping Assistant with no page_id/_id');
        continue;
      }

      const assistantName = assistant.name || assistantId;
      console.log(`\n📝 Processing: ${assistantName}`);

      let needsUpdate = false;
      const updates: any = {};

      // Update modePersonalityVoiceConfig
      if (assistant.modePersonalityVoiceConfig) {
        const updatedModeConfig = await updateModeConfig(
          assistant.modePersonalityVoiceConfig,
          voiceId,
        );
        if (updatedModeConfig !== assistant.modePersonalityVoiceConfig) {
          updates.modePersonalityVoiceConfig = updatedModeConfig;
          needsUpdate = true;
        }
      }

      // Update dailyCallPersonalityVoiceConfig
      if (assistant.dailyCallPersonalityVoiceConfig) {
        const updatedDailyCallConfig = await updateModeConfig(
          assistant.dailyCallPersonalityVoiceConfig,
          voiceId,
        );
        if (updatedDailyCallConfig !== assistant.dailyCallPersonalityVoiceConfig) {
          updates.dailyCallPersonalityVoiceConfig = updatedDailyCallConfig;
          needsUpdate = true;
        }
      }

      if (needsUpdate) {
        try {
          await AssistantActions.updateAssistant(assistantId, updates);
          updatedCount++;
          console.log(`  ✅ Updated ${assistantName}`);
        } catch (error) {
          console.error(`  ❌ Failed to update ${assistantName}:`, error);
        }
      } else {
        skippedCount++;
        console.log(`  ⏭️  No changes needed for ${assistantName}`);
      }
    }

    console.log('\n✅ Migration complete.');
    console.log(`   Updated assistants: ${updatedCount}`);
    console.log(`   Skipped assistants: ${skippedCount}`);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('❌ Migration failed:', error);
  process.exit(1);
});

