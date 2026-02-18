#!/usr/bin/env tsx
/**
 * Test script to verify mig_elevenlabs logic without modifying database
 * This simulates what the migration would do
 */

/* eslint-disable no-console, @typescript-eslint/no-explicit-any */

// Simulate UserProfile records with different voice configs
const mockProfiles = [
  {
    page_id: '1',
    email: 'user1@example.com',
    personalityVoiceConfig: {
      voiceProvider: 'kokoro',
      voiceId: 'af_heart',
      personalityId: 'test-1',
    },
  },
  {
    page_id: '2',
    email: 'user2@example.com',
    personalityVoiceConfig: {
      voiceProvider: 'elevenlabs',
      voiceId: 'old-voice-id',
      personalityId: 'test-2',
    },
  },
  {
    page_id: '3',
    email: 'user3@example.com',
    personalityVoiceConfig: {
      voiceProvider: 'elevenlabs',
      voiceId: 'kdmDKE6EkgrWrrykO9Qt', // Target voice ID
      personalityId: 'test-3',
    },
  },
  {
    page_id: '4',
    email: 'user4@example.com',
    // No personalityVoiceConfig
  },
];

function simulateMigration(profiles: any[], targetVoiceId: string) {
  console.log(`🔄 Simulating migration to voiceId: ${targetVoiceId}\n`);

  let updatedCount = 0;
  let skippedCount = 0;

  for (const item of profiles) {
    const pageId = item.page_id || item._id;
    if (!pageId) {
      console.warn('⚠️  Skipping profile with no page_id/_id');
      continue;
    }

    const pvc = item.personalityVoiceConfig;
    if (!pvc || typeof pvc !== 'object') {
      skippedCount++;
      console.log(`⏭️  ${item.email}: No voice config - SKIP`);
      continue;
    }

    const currentProvider = pvc.voiceProvider;
    const currentVoiceId = pvc.voiceId;

    // Skip if already matching target config
    if (currentProvider === 'elevenlabs' && currentVoiceId === targetVoiceId) {
      skippedCount++;
      console.log(`✅ ${item.email}: Already matches target (${currentProvider}/${currentVoiceId}) - SKIP`);
      continue;
    }

    const updatedConfig = {
      ...pvc,
      voiceProvider: 'elevenlabs',
      voiceId: targetVoiceId,
      lastUpdated: new Date().toISOString(),
    };

    updatedCount++;
    console.log(`🔄 ${item.email}: ${currentProvider}/${currentVoiceId} → elevenlabs/${targetVoiceId} - UPDATE`);
  }

  console.log('\n✅ Simulation complete.');
  console.log(`   Would update: ${updatedCount} profiles`);
  console.log(`   Would skip: ${skippedCount} profiles`);
}

const targetVoiceId = process.argv[2] || 'kdmDKE6EkgrWrrykO9Qt';
simulateMigration(mockProfiles, targetVoiceId);

