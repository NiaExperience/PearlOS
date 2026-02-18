#!/usr/bin/env ts-node
/**
 * Database Seeding Script - Nia Universal Local Development
 * 
 * Seeds the database with:
 * - Pearl assistant (fully configured for local dev with Kokoro TTS)
 * - Pearl personality
 * - Demo user for Interface login (demo@local.dev / password123)
 * - Admin user for Dashboard login (admin@local.dev / admin123)
 * - Sample notes and welcome content
 * 
 * Usage: npm run pg:seed
 */

import * as path from 'path';
import { hash } from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { createPostgresDatabase, createGinIndex } from '../apps/mesh/src/resolvers/database/postgres';
import { createNotionModel } from '../apps/mesh/src/resolvers/models/notion-model';
import * as dotenv from 'dotenv';

// Import platform definitions for content types
import { platformDefinitionsIndex } from '../packages/prism/src/core/platform-definitions';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

// ============================================================================
// FIXED IDS - These IDs are stable so the seeded data is predictable
// ============================================================================
// Tenant - The organization container for all content
const LOCAL_TENANT_ID = '00000000-0000-0000-0000-000000000001';
const LOCAL_TENANT_PAGE_ID = '00000000-0000-0000-0000-000000000001';

// Assistant and Personality
const PEARLOS_ASSISTANT_ID = '00000000-0000-0000-0001-000000000001';
const PEARLOS_PAGE_ID = '00000000-0000-0000-0001-000000000001';
const PEARL_PERSONALITY_ID = '00000000-0000-0000-0002-000000000001';
const PEARL_PERSONALITY_PAGE_ID = '00000000-0000-0000-0002-000000000001';

// Users
const DEMO_USER_ID = '00000000-0000-0000-0003-000000000001';
const ADMIN_USER_ID = '00000000-0000-0000-0003-000000000002';

// Content
const WELCOME_NOTE_ID = '00000000-0000-0000-0004-000000000001';

// Functional Prompts
const FUNC_PROMPT_CREATE_APP_ID = '00000000-0000-0000-0005-000000000001';

// ============================================================================
// Default Credentials (shown in console after seeding)
// ============================================================================
const DEMO_USER_EMAIL = 'demo@local.dev';
const DEMO_USER_PASSWORD = 'password123';
const ADMIN_USER_EMAIL = 'admin@local.dev';
const ADMIN_USER_PASSWORD = 'admin123';

interface SeedData {
  type: string;
  page_id: string;
  parent_id?: string;
  content: Record<string, unknown>;
  indexer: Record<string, unknown>;
  order?: number;
}

/**
 * Create the complete seed data for local development
 */
async function createSeedData(): Promise<SeedData[]> {
  const now = new Date().toISOString();
  
  // Hash passwords using bcryptjs
  const demoPasswordHash = await hash(DEMO_USER_PASSWORD, 10);
  const adminPasswordHash = await hash(ADMIN_USER_PASSWORD, 10);
  
  return [
    // ========================================================================
    // LOCAL DEV TENANT - The organization container for all local dev content
    // ========================================================================
    {
      type: 'Tenant',
      page_id: LOCAL_TENANT_PAGE_ID,
      content: {
        _id: LOCAL_TENANT_ID,
        name: 'Local Development',
        domain: 'localhost',
        description: 'Default tenant for local development and testing',
        planTier: 'professional',
        settings: {
          features: ['voice', 'notes', 'chat', 'htmlContent'],
          maxAssistants: 100,
          maxUsers: 100,
        },
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      indexer: {
        name: 'Local Development',
        domain: 'localhost',
        status: 'active',
      },
      order: 0
    },
    
    // ========================================================================
    // PEARL ASSISTANT - The main assistant for local development
    // ========================================================================
    {
      type: 'Assistant',
      page_id: PEARLOS_PAGE_ID,
      parent_id: LOCAL_TENANT_ID, // Link to tenant
      content: {
        _id: PEARLOS_ASSISTANT_ID,
        name: 'Pearl',
        subDomain: 'pearlos',
        tenantId: LOCAL_TENANT_ID,
        
        // Identity and greeting
        description: 'Pearl is a friendly AI assistant for Nia Universal local development',
        firstMessage: "Hey there! I'm Pearl, your AI companion. How can I help you today?",
        
        // Model configuration - uses OpenAI when available
        model: {
          provider: 'openai',
          model: 'gpt-4o-mini',
          temperature: 0.7,
          systemPrompt: `You are Pearl, a helpful and friendly AI assistant built into the Nia Universal platform.
You are warm, approachable, and knowledgeable. You help users with their questions and tasks.
You can help with notes, browsing, and general conversation.
Keep responses concise but helpful. Use a friendly, conversational tone.`
        },
        
        // Voice configuration - Kokoro/Chorus for local TTS
        voiceProvider: 'pipecat',
        modePersonalityVoiceConfig: {
          default: {
            personalityId: PEARL_PERSONALITY_ID,
            personalityName: 'Pearl',
            personaName: 'Pearl',
            room_name: 'local-pearl-default',
            voice: {
              provider: 'pocket',
              voiceId: 'azelma',
              speed: 1.0,
              model: 'pocket-v1'
            }
          },
          home: {
            personalityId: PEARL_PERSONALITY_ID,
            personalityName: 'Pearl',
            personaName: 'Pearl',
            room_name: 'local-pearl-home',
            voice: {
              provider: 'pocket',
              voiceId: 'azelma',
              speed: 1.0,
              model: 'pocket-v1'
            }
          },
          work: {
            personalityId: PEARL_PERSONALITY_ID,
            personalityName: 'Pearl',
            personaName: 'Pearl',
            room_name: 'local-pearl-work',
            voice: {
              provider: 'pocket',
              voiceId: 'azelma',
              speed: 1.0,
              model: 'pocket-v1'
            }
          },
          creative: {
            personalityId: PEARL_PERSONALITY_ID,
            personalityName: 'Pearl',
            personaName: 'Pearl',
            room_name: 'local-pearl-creative',
            voice: {
              provider: 'pocket',
              voiceId: 'azelma',
              speed: 1.0,
              model: 'pocket-v1'
            }
          }
        },
        
        // Daily call configuration (same as mode config)
        dailyCallPersonalityVoiceConfig: {
          default: {
            personalityId: PEARL_PERSONALITY_ID,
            personalityName: 'Pearl',
            personaName: 'Pearl',
            room_name: 'local-pearl-call',
            voice: {
              provider: 'pocket',
              voiceId: 'azelma',
              speed: 1.0,
              model: 'pocket-v1'
            }
          }
        },
        
        // Transcription configuration (Deepgram when available)
        transcriber: {
          provider: 'deepgram',
          model: 'nova-2',
          language: 'en-US'
        },
        
        // Features enabled for this assistant
        supportedFeatures: [
          'notes',
          'htmlContent',
          'miniBrowser',
          'dailyCall',
          'avatar',
          'passwordLogin',
          'guestLogin',
          'onboarding',
          'calculator',
          'youtube',
          'soundtrack',
          'terminal',
          'openclawBridge',
          'enhancedBrowser',
          'googleDrive',
          'gmail'
        ],
        
        // Access control - allow local development access
        allowAnonymousLogin: true,
        startFullScreen: false,
        
        // Desktop mode default
        desktopMode: 'home',
        
        // Additional settings
        backchannelingEnabled: true,
        backgroundDenoisingEnabled: true,
        silenceTimeoutSeconds: 30,
        maxDurationSeconds: 3600, // 1 hour max call
        
        createdAt: now,
        updatedAt: now
      },
      indexer: {
        name: 'Pearl',
        subDomain: 'pearlos',
        tenantId: LOCAL_TENANT_ID,
        allowAnonymousLogin: true
      },
      order: 1
    },
    
    // ========================================================================
    // PEARL PERSONALITY - The personality configuration for Pearl
    // ========================================================================
    {
      type: 'Personality',
      page_id: PEARL_PERSONALITY_PAGE_ID,
      parent_id: LOCAL_TENANT_ID, // Linked to tenant for listPersonalities to work
      content: {
        _id: PEARL_PERSONALITY_ID,
        key: 'pearl-default',
        name: 'Pearl',
        description: 'Default personality for Pearl - friendly, helpful, conversational',
        tenantId: LOCAL_TENANT_ID,
        primaryPrompt: `You are Pearl, an AI assistant with a warm and friendly personality.

Core traits:
- Helpful and knowledgeable
- Conversational and engaging  
- Patient and understanding
- Concise but thorough

Communication style:
- Use natural, conversational language
- Be encouraging and positive
- Ask clarifying questions when needed
- Provide actionable suggestions

Remember: You're here to help the user accomplish their goals while making the interaction enjoyable.`,
        variables: ['username', 'roomName'],
        beats: [
          { message: "Is there anything specific I can help you with?", start_time: 120 },
          { message: "Feel free to ask me anything!", start_time: 300 }
        ],
        version: 1,
        createdAt: now,
        updatedAt: now
      },
      indexer: {
        name: 'Pearl',
        key: 'pearl-default',
        tenantId: LOCAL_TENANT_ID
      },
      order: 2
    },
    
    // ========================================================================
    // DEMO USER - For Interface login
    // ========================================================================
    {
      type: 'User',
      page_id: DEMO_USER_ID,
      content: {
        _id: DEMO_USER_ID,
        name: 'Demo User',
        email: DEMO_USER_EMAIL.toLowerCase(),
        emailVerified: now,
        password_hash: demoPasswordHash,
        image: null,
        chatHistory: [],
        eventHistory: [],
        metadata: {
          role: 'user',
          source: 'seed-script'
        },
        createdAt: now,
        updatedAt: now
      },
      indexer: {
        name: 'Demo User',
        email: DEMO_USER_EMAIL.toLowerCase()
      },
      order: 3
    },
    
    // ========================================================================
    // ADMIN USER - For Dashboard login  
    // ========================================================================
    {
      type: 'User',
      page_id: ADMIN_USER_ID,
      content: {
        _id: ADMIN_USER_ID,
        name: 'Admin User',
        email: ADMIN_USER_EMAIL.toLowerCase(),
        emailVerified: now,
        password_hash: adminPasswordHash,
        image: null,
        chatHistory: [],
        eventHistory: [],
        metadata: {
          role: 'admin',
          source: 'seed-script'
        },
        createdAt: now,
        updatedAt: now
      },
      indexer: {
        name: 'Admin User',
        email: ADMIN_USER_EMAIL.toLowerCase()
      },
      order: 4
    },
    
    // ========================================================================
    // USER-TENANT ROLE - Link admin user to tenant as owner
    // ========================================================================
    {
      type: 'UserTenantRole',
      page_id: uuidv4(),
      content: {
        _id: uuidv4(),
        userId: ADMIN_USER_ID,
        tenantId: LOCAL_TENANT_ID,
        role: 'owner',
        assignedBy: ADMIN_USER_ID,
        createdAt: now,
        updatedAt: now
      },
      indexer: {
        userId: ADMIN_USER_ID,
        tenantId: LOCAL_TENANT_ID,
        role: 'owner'
      },
      order: 5
    },
    
    // ========================================================================
    // WELCOME NOTE - Sample content showing the system works
    // ========================================================================
    {
      type: 'Note',
      page_id: WELCOME_NOTE_ID,
      parent_id: PEARLOS_ASSISTANT_ID,
      content: {
        _id: uuidv4(),
        title: '👋 Welcome to Nia Universal!',
        content: `# Welcome to Nia Universal Local Development

This note was created by the database seeding script to demonstrate the platform works!

## What's Working

✅ **Database** - PostgreSQL is connected and storing data
✅ **GraphQL** - Mesh API at http://localhost:2000/graphql
✅ **Interface** - Main app at http://localhost:3000/pearlos
✅ **Dashboard** - Admin panel at http://localhost:4000

## Login Credentials

### Interface (localhost:3000)
- Email: \`demo@local.dev\`
- Password: \`password123\`

### Dashboard (localhost:4000)
- Email: \`admin@local.dev\`
- Password: \`admin123\`

## Voice Features

Voice features require additional API keys:
- **Daily.co** - For WebRTC rooms (DAILY_API_KEY)
- **Deepgram** - For speech-to-text (DEEPGRAM_API_KEY)
- **OpenAI** - For AI responses (OPENAI_API_KEY)

Without these, the platform works in text-only mode.

## Next Steps

1. Explore the Interface at http://localhost:3000/pearlos
2. Check the Dashboard at http://localhost:4000
3. Query the GraphQL API at http://localhost:2000/graphql
4. Add API keys to .env.local for full features

Happy building! 🚀`,
        tags: ['welcome', 'getting-started', 'documentation'],
        category: 'ideas',
        tenantId: LOCAL_TENANT_ID,
        createdBy: ADMIN_USER_ID,
        createdAt: now,
        updatedAt: now
      },
      indexer: {
        title: 'Welcome to Nia Universal!',
        category: 'ideas',
        tags: ['welcome', 'getting-started', 'documentation'],
        tenantId: LOCAL_TENANT_ID
      },
      order: 6
    },
    
    // ========================================================================
    // FUNCTIONAL PROMPT - For AI app generation
    // ========================================================================
    {
      type: 'FunctionalPrompt',
      page_id: FUNC_PROMPT_CREATE_APP_ID,
      content: {
        _id: FUNC_PROMPT_CREATE_APP_ID,
        featureKey: 'bot_create_app_from_description',
        promptContent: `You are an AI assistant that helps create mini HTML/CSS/JS applications based on user descriptions.

When the user describes an app they want:
1. Understand the core functionality they need
2. Design a clean, minimal user interface
3. Implement the logic using vanilla JavaScript
4. Style it with modern CSS (flexbox, grid, CSS variables)
5. Return a complete, standalone HTML file

Guidelines:
- Keep the code simple and readable
- Use semantic HTML elements
- Make it responsive and mobile-friendly
- Add helpful comments
- Include error handling where appropriate
- Use modern CSS (no frameworks needed)

Return your response as a single HTML file that includes all CSS and JS inline.`,
        userId: ADMIN_USER_ID,
        revisions: [],
        createdAt: now,
        updatedAt: now
      },
      indexer: {
        featureKey: 'bot_create_app_from_description',
        type: 'functional-prompt'
      },
      order: 7
    }
  ];
}

/**
 * Main seeding function
 */
async function seedDatabase() {
  try {
    console.log('');
    console.log('🌱 ══════════════════════════════════════════════════════════');
    console.log('🌱  Nia Universal - Database Seeding');
    console.log('🌱 ══════════════════════════════════════════════════════════');
    console.log('');
    
    // Connect to the Postgres database
    console.log('📡 Connecting to database...');
    const sequelize = await createPostgresDatabase(
      process.env.POSTGRES_HOST || 'localhost',
      parseInt(process.env.POSTGRES_PORT || '5432'),
      process.env.POSTGRES_DB || 'testdb',
      process.env.POSTGRES_USER || 'postgres',
      process.env.POSTGRES_PASSWORD || 'password',
      { shouldLog: false }
    );
    
    // Initialize the NotionModel
    const NotionModel = createNotionModel(sequelize);
    console.log('✅ Database connection established');
    
    // Check if table exists, create if it doesn't
    const tableExists = await sequelize.getQueryInterface().tableExists('notion_blocks');
    if (!tableExists) {
      console.log('📋 Creating table notion_blocks...');
      await NotionModel.sync();
      console.log('✅ Table created');
      
      // Create GIN indexes
      console.log('📋 Creating GIN indexes...');
      await createGinIndex(sequelize, true);
      console.log('✅ Indexes created');
    } else {
      console.log('✅ Table notion_blocks exists');
    }
    
    // Check for existing data
    let existingCount = 0;
    try {
      existingCount = await NotionModel.count();
    } catch {
      // Ignore - proceed with seeding
    }
    
    if (existingCount > 0) {
      console.log(`\n📊 Database Status: ${existingCount} existing record(s)`);
      console.log('');
      console.log('Options:');
      console.log('  1. Skip (keep existing data)');
      console.log('  2. Add seed data alongside existing');
      console.log('  3. Clear all and reseed (destructive!)');
      console.log('');
      
      const readline = require('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      const answer = await new Promise<string>((resolve) => {
        rl.question('Choose option (1/2/3) or Enter to skip: ', resolve);
      });
      rl.close();
      
      const choice = answer.trim().toLowerCase();
      
      if (choice === '' || choice === '1') {
        console.log('✅ Skipping - existing data preserved');
        await sequelize.close();
        return;
      } else if (choice === '3') {
        console.log('🗑️  Clearing existing data...');
        await NotionModel.destroy({ where: {} });
        console.log('✅ Data cleared');
      }
      // choice === '2' continues to seeding
    }
    
    // Generate seed data
    console.log('\n📦 Generating seed data...');
    const seedData = await createSeedData();
    console.log(`   Created ${seedData.length} records to insert`);
    
    // Clean up existing seeded data to avoid duplicates
    console.log('\n🧹 Cleaning up existing seeded data...');
    
    // Remove existing Local Development tenant
    await sequelize.query(
      `DELETE FROM notion_blocks WHERE type = 'Tenant' AND content->>'name' = 'Local Development'`
    );
    
    // Remove existing pearlos assistant
    const existingPearlos = (await sequelize.query(
      `SELECT block_id FROM notion_blocks WHERE type = 'Assistant' AND indexer->>'subDomain' = 'pearlos'`
    )) as [{ block_id: string }[], unknown];

    if (existingPearlos[0]?.length > 0) {
      console.log(`⚠️  Found ${existingPearlos[0].length} existing pearlos assistant(s) - removing duplicates`);
      await sequelize.query(
        `DELETE FROM notion_blocks WHERE type = 'Assistant' AND indexer->>'subDomain' = 'pearlos'`
      );
    }
    
    // Clean up existing users with same emails
    await sequelize.query(
      `DELETE FROM notion_blocks WHERE type = 'User' AND (indexer->>'email' = $1 OR indexer->>'email' = $2)`,
      { bind: [DEMO_USER_EMAIL.toLowerCase(), ADMIN_USER_EMAIL.toLowerCase()] }
    );
    
    // Clean up existing functional prompts
    await sequelize.query(
      `DELETE FROM notion_blocks WHERE type = 'FunctionalPrompt' AND indexer->>'featureKey' = 'bot_create_app_from_description'`
    );
    
    // Clean up Pearl personality
    await sequelize.query(
      `DELETE FROM notion_blocks WHERE type = 'Personality' AND indexer->>'key' = 'pearl-default'`
    );
    
    // Clean up user tenant roles for seeded users
    await sequelize.query(
      `DELETE FROM notion_blocks WHERE type = 'UserTenantRole' AND content->>'tenantId' = $1`,
      { bind: [LOCAL_TENANT_ID] }
      );
    
    console.log('✅ Cleanup complete');
    
    // ========================================================================
    // SEED PLATFORM CONTENT DEFINITIONS (CRITICAL!)
    // These DynamicContent definitions must exist before creating content
    // ========================================================================
    console.log('\n📋 Creating Platform Content Definitions...');
    
    // Remove existing platform definitions
    await sequelize.query(`DELETE FROM notion_blocks WHERE type = 'DynamicContent'`);
    
    // Insert all platform definitions
    const definitions = Object.entries(platformDefinitionsIndex);
    for (const [defName, definition] of definitions) {
      try {
        const defPageId = uuidv4();
        await NotionModel.create({
          page_id: defPageId,
          type: 'DynamicContent',
          content: definition as any,
          indexer: {
            dynamicBlockType: defName,
            name: (definition as any).name || defName,
          },
          order: 0
        } as any);
        console.log(`   ✅ Definition: ${defName}`);
      } catch (error: any) {
        console.error(`   ❌ Failed Definition ${defName}:`, error.message);
      }
    }
    console.log(`✅ Created ${definitions.length} content definitions`);
    
    // Insert seed data
    console.log('\n📝 Inserting seed data...');
    for (const data of seedData) {
      try {
        await NotionModel.create({
          page_id: data.page_id,
          parent_id: data.parent_id,
          type: data.type,
          content: data.content as any,
          indexer: data.indexer,
          order: data.order
        } as any);
        console.log(`   ✅ ${data.type}: ${(data.content as any).name || (data.content as any).title || data.page_id}`);
      } catch (error: any) {
        console.error(`   ❌ Failed ${data.type}:`, error.message);
      }
    }
    
    // Close connection
    await sequelize.close();
    
    // Print success summary
    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('✅ DATABASE SEEDING COMPLETE!');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');
    console.log('🔑 LOGIN CREDENTIALS');
    console.log('───────────────────────────────────────────────────────────────');
    console.log('');
    console.log('📱 Interface (http://localhost:3000/pearlos)');
    console.log(`   Email:    ${DEMO_USER_EMAIL}`);
    console.log(`   Password: ${DEMO_USER_PASSWORD}`);
    console.log('');
    console.log('⚙️  Dashboard (http://localhost:4000)');
    console.log(`   Email:    ${ADMIN_USER_EMAIL}`);
    console.log(`   Password: ${ADMIN_USER_PASSWORD}`);
    console.log('');
    console.log('───────────────────────────────────────────────────────────────');
    console.log('🚀 Start the platform: npm run start:all');
    console.log('───────────────────────────────────────────────────────────────');
    console.log('');
    
  } catch (error) {
    console.error('❌ Error during database seeding:', error);
    process.exit(1);
  }
}

// Execute
if (require.main === module) {
  seedDatabase();
}

export { seedDatabase };
