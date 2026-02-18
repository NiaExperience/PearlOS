#!/usr/bin/env tsx
/**
 * One-time migration script to convert UUID-based allowedPersonalities keys
 * to composite keys (name-provider-voiceId format)
 */

import { AssistantActions } from '@nia/prism/core/actions';

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PersonalityConfig {
  personalityId?: string;
  name?: string;
  voiceId?: string;
  voiceProvider?: string;
  voiceParameters?: unknown;
}

async function migrateAllAssistants() {
  console.log('🔄 Starting migration of allowedPersonalities keys...\n');

  // Get all assistants - we need to implement a method to get all
  // For now, let's just log instructions
  console.log('⚠️  Manual migration required:');
  console.log('1. Connect to your database');
  console.log('2. Run this query to find assistants with UUID keys:\n');
  console.log(`
    db.assistants.find({
      "allowedPersonalities": { 
        $exists: true 
      }
    }).forEach(function(doc) {
      var updated = false;
      var migrated = {};
      
      for (var key in doc.allowedPersonalities) {
        var config = doc.allowedPersonalities[key];
        
        // Check if key is a UUID
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) {
          var name = config.name || 'unnamed';
          var provider = config.voiceProvider || 'unknown';
          var voiceId = config.voiceId || 'no-voice';
          var newKey = name + '-' + provider + '-' + voiceId;
          migrated[newKey] = config;
          updated = true;
          print('Migrating: ' + key + ' -> ' + newKey);
        } else {
          migrated[key] = config;
        }
      }
      
      if (updated) {
        db.assistants.updateOne(
          { _id: doc._id },
          { $set: { allowedPersonalities: migrated } }
        );
        print('Updated assistant: ' + doc.name + ' (' + doc._id + ')');
      }
    });
  `);

  console.log('\n3. Or if you have specific assistant IDs, you can use this function:\n');
}

async function migrateAssistant(assistantId: string) {
  console.log(`\n🔄 Migrating assistant ${assistantId}...`);

  const assistant = await AssistantActions.getAssistantById(assistantId);
  if (!assistant) {
    console.error(`❌ Assistant ${assistantId} not found`);
    return;
  }

  const allowedPersonalities = assistant.allowedPersonalities as Record<string, PersonalityConfig> | undefined;
  
  if (!allowedPersonalities || typeof allowedPersonalities !== 'object' || Array.isArray(allowedPersonalities)) {
    console.log('ℹ️  No allowedPersonalities to migrate');
    return;
  }

  const migrated: Record<string, PersonalityConfig> = {};
  let needsMigration = false;

  for (const [key, config] of Object.entries(allowedPersonalities)) {
    if (uuidRegex.test(key)) {
      // Old UUID format - migrate to composite key
      const name = config.name || 'unnamed';
      const provider = config.voiceProvider || 'unknown';
      const voiceId = config.voiceId || 'no-voice';
      const newKey = `${name}-${provider}-${voiceId}`;
      
      console.log(`  🔀 ${key} → ${newKey}`);
      migrated[newKey] = config;
      needsMigration = true;
    } else {
      // Already using composite key format
      migrated[key] = config;
    }
  }

  if (needsMigration) {
    console.log(`\n💾 Saving migrated data...`);
    await AssistantActions.updateAssistant(assistant._id!, { 
      allowedPersonalities: migrated 
    });
    console.log(`✅ Successfully migrated assistant ${assistant.name}`);
    
    // Verify
    const updated = await AssistantActions.getAssistantById(assistantId);
    const updatedKeys = Object.keys((updated?.allowedPersonalities as Record<string, unknown>) || {});
    console.log(`\n📋 Updated keys: ${updatedKeys.join(', ')}`);
  } else {
    console.log('✅ No migration needed - all keys already in composite format');
  }
}

// Main execution
const assistantId = process.argv[2];

if (assistantId) {
  migrateAssistant(assistantId)
    .then(() => {
      console.log('\n✨ Migration complete!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Migration failed:', error);
      process.exit(1);
    });
} else {
  migrateAllAssistants()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Error:', error);
      process.exit(1);
    });
}
