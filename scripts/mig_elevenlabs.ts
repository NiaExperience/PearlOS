#!/usr/bin/env tsx
/**
 * mig_elevenlabs.ts
 *
 * One-off helper to migrate local UserProfile voice settings to ElevenLabs.
 *
 * Usage:
 *   npx tsx scripts/mig_elevenlabs.ts <elevenlabs_voice_id>
 *
 * Behavior:
 *   - Finds all UserProfile records with a populated personalityVoiceConfig.
 *   - Sets personalityVoiceConfig.voiceProvider = "elevenlabs".
 *   - Sets personalityVoiceConfig.voiceId to the provided voice id.
 *   - Updates personalityVoiceConfig.lastUpdated to now.
 *
 * This is intended for local/dev environments where you want to switch all
 * stored profiles over to a single ElevenLabs voice.
 */

/* eslint-disable no-console, @typescript-eslint/no-explicit-any */

import { Prism } from '@nia/prism';

const CONTENT_TYPE = 'UserProfile';

async function main() {
  const voiceId = process.argv[2];

  if (!voiceId) {
    console.error('Usage: npx tsx scripts/mig_elevenlabs.ts <elevenlabs_voice_id>');
    process.exit(1);
  }

  console.log('🔄 Starting ElevenLabs voice migration...');
  console.log(`   Target voiceId: ${voiceId}\n`);

  const prism = await Prism.getInstance();

  // Fetch a reasonably large page of UserProfiles.
  // For typical local/dev datasets this should be sufficient.
  console.log('📋 Querying UserProfile records with personalityVoiceConfig...');
  const result = await prism.query({
    contentType: CONTENT_TYPE,
    tenantId: 'any',
    where: {
      type: { eq: CONTENT_TYPE },
    },
    limit: 1000,
  } as any);

  if (!result.items || result.items.length === 0) {
    console.log('ℹ️  No UserProfile records found. Nothing to migrate.');
    return;
  }

  let updatedCount = 0;
  let skippedCount = 0;

  for (const item of result.items as any[]) {
    const pageId = item.page_id || item._id;
    if (!pageId) {
      console.warn('⚠️  Skipping UserProfile with no page_id/_id:', item);
      continue;
    }

    const pvc = item.personalityVoiceConfig;
    if (!pvc || typeof pvc !== 'object') {
      skippedCount++;
      continue;
    }

    const currentProvider = pvc.voiceProvider;
    const currentVoiceId = pvc.voiceId;

    // Skip if already matching target config
    if (currentProvider === 'elevenlabs' && currentVoiceId === voiceId) {
      skippedCount++;
      continue;
    }

    const updatedConfig = {
      ...pvc,
      voiceProvider: 'elevenlabs',
      voiceId,
      lastUpdated: new Date().toISOString(),
    };

    try {
      await prism.update(
        CONTENT_TYPE,
        pageId,
        { personalityVoiceConfig: updatedConfig },
        'any',
      );
      updatedCount++;
      if (updatedCount % 10 === 0) {
        process.stdout.write(`   Updated ${updatedCount} profiles...\r`);
      }
    } catch (error) {
      console.error(`❌ Failed to update UserProfile ${pageId}:`, error);
    }
  }

  console.log('\n✅ Migration complete.');
  console.log(`   Updated profiles: ${updatedCount}`);
  console.log(`   Skipped profiles: ${skippedCount}`);
}

main().catch((error) => {
  console.error('❌ Migration failed:', error);
  process.exit(1);
});


