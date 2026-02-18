#!/usr/bin/env tsx
/**
 * Seed All Functional Prompts Script
 * 
 * Seeds all functional prompts from git history and current tool files into the database.
 * 
 * Usage:
 *   npm run pg:seed-prompts [--dry-run] [--update-existing]
 * 
 * Options:
 *   --dry-run          Show what would be created without making changes
 *   --update-existing  Update existing records instead of skipping them
 */

import { FunctionalPromptActions } from '@nia/prism';
import dotenv from 'dotenv';
import path from 'path';

// Load .env.local to get database connection details
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

// ============================================================================
// All Functional Prompts
// ============================================================================

interface PromptEntry {
  featureKey: string;
  promptContent: string;
  source: string;
}

const ALL_PROMPTS: PromptEntry[] = [
  // ==========================================================================
  // HTML/Applet Tools (from bot/tools/html/prompts.py)
  // ==========================================================================
  {
    featureKey: 'bot_create_app_from_description',
    promptContent: `Request AI generation of an HTML applet/game/tool based on a description. DO NOT use for sprite/character requests - use bot_summon_sprite instead for those. The design, theme, gameplay and characters should be based on and informed by your conversation with the user, but their answers should not be directly used in the experience. Make a simple, turn-based, no-sound, 80s arcade style game that is genuinely fun, social, and endlessly generative without feeling like a quiz or therapy. The user should be able to make one move and then send it to someone else to complete or compete. Examples: if the user answers artistically, generate a physics-defying graffiti wall; if the users answers are collaborative, generate a magical wishing tree where others can post and you affirm their wish with a Gen Z phrase; if they answer competitively, generate a hot-seat arcade game where players take turns placing a single token on a glowing board, flipping nearby enemy tiles to their color and instantly changing the score. Think of it like the user is Player 1 who boots a strange arcade machine and sets its internal logic (unknowingly) and when they send it to multiple Player 2s, those players briefly get the joystick and interact with the system before it locks. Player 2s can send with their updates back to Player 1 or forward on to multiple Player 3s. There should be no instructions or text in the gameplay, the interaction must be obvious by the visual design affordance. The payoff for each player must be hilarious to Gen Z audiences and deliver a gorgeous screenshot-able final visual. All visuals must fit on a single standard mobile screen and not require any scrolling. Use this when the user asks you to CREATE a new app, game, or interactive tool. You only need to provide a title and description - the AI will generate the full HTML. This is the PRIMARY tool for creating new HTML content from user requests.`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_create_html_content',
    promptContent: `Create a new HTML applet or interactive widget using the provided title and full HTML. Use this ONLY when you already have complete, valid HTML code to provide.`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_create_app_from_note',
    promptContent: `Create an HTML app/game directly from a note's content. Provide either note_id or title (fuzzy search will find the note). The note's content will be used to generate the HTML app. This is a single-step operation that finds the note and creates the app in one tool call.`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_load_html_applet',
    promptContent: `Load an existing HTML applet by ID or search for one by title. Can also search for applets by their source note - provide note_id or note_title to find applets created from that note. Search priority: 1) applet_id, 2) applet title, 3) note_id, 4) note_title (fuzzy match). In multi-user sessions, this will also share the applet with all participants. Use this when the user wants to open or view an existing HTML applet.`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_update_html_applet',
    promptContent: `Update an existing HTML applet's metadata or HTML content, identified by its applet_id. If the user wants to update using a note (e.g. 'update with my Space War Tweaks note'), you MUST provide the 'note_title' or 'note_id' parameter so the system can fetch the full content. Do NOT try to summarize the note yourself in the modification_request.`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_rollback_app',
    promptContent: `Revert the currently active applet to its previous version. Use this when the user says 'undo changes', 'rollback', or 'go back to the previous version'. This will restore the HTML content and title from the most recent history entry.`,
    source: 'current-tools'
  },
  
  // ==========================================================================
  // Note Tools (from bot/tools/notes/prompts.py)
  // ==========================================================================
  {
    featureKey: 'bot_read_current_note',
    promptContent: `Reads the current active note's content. Use this to read the note currently open in the session.`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_replace_note',
    promptContent: `Replace the ENTIRE contents of the note with new markdown. Use this when surgical bot_add_note_content/bot_replace_note_content/bot_remove_note_content is impractical. Ensure you preserve any content that should remain in the note.`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_create_note',
    promptContent: `Create a brand-new shared note with the provided title and optional initial markdown content.`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_list_notes',
    promptContent: `List all available notes for the current tenant, providing titles, modes, and IDs (not full content).`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_open_note',
    promptContent: `Opens a note (displays in UI). User: 'load my note titled X', 'open note X'.`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_replace_note_content',
    promptContent: `Replace specific text in the note. User: 'change raspberry to blueberry in the note', 'change Bob to Brian in the note'.`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_add_note_content',
    promptContent: `Add new text content to the start or end of note without replacing existing content.`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_remove_note_content',
    promptContent: `Remove specific text content from the note.`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_save_note',
    promptContent: `Save the current note's changes to persistent storage.`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_download_note',
    promptContent: `Trigger a download of the note in a specified format (markdown, PDF, etc.).`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_delete_note',
    promptContent: `Delete a note permanently. Use with caution.`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_switch_note_mode',
    promptContent: `Switch the note view between different modes (e.g., 'work' for shared, 'personal' for private).`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_back_to_notes',
    promptContent: `Navigate back to the notes list view from the current note.`,
    source: 'current-tools'
  },
  
  // ==========================================================================
  // View/App Management Tools (from bot/tools/view_tools.py)
  // ==========================================================================
  {
    featureKey: 'bot_close_browser_window',
    promptContent: `Close specific apps (Gmail, Calculator, Terminal, Drive, Notes, etc.) or all windows. Use the "apps" parameter to specify which apps to close (e.g., ["gmail", "terminal"]). If no apps specified, closes all windows.`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_close_applet_creation_engine',
    promptContent: `Close the creation engine or content creation tool window. Triggers: "close creation engine", "exit creation engine", "close content creator", "exit content creator".`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_close_view',
    promptContent: `Close specific apps or the current view. Use the "apps" parameter to specify which apps to close (Gmail, Calculator, Terminal, Drive, Notes, etc.). If no apps specified, closes all windows.`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_close_terminal',
    promptContent: `Close the terminal application. Triggers: "close terminal", "exit terminal".`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_close_gmail',
    promptContent: `Close Gmail. Triggers: "close gmail", "exit gmail".`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_close_calculator',
    promptContent: `Close the calculator application. Triggers: "close calculator", "exit calculator".`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_close_notes',
    promptContent: `Close the notes application. Triggers: "close notes", "exit notes", "close notepad".`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_close_google_drive',
    promptContent: `Close Google Drive. Triggers: "close drive", "exit drive".`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_close_youtube',
    promptContent: `Close the YouTube player interface. Triggers: "close youtube", "stop video", "exit youtube".`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_open_browser',
    promptContent: `Open a web browser window. Optionally navigate to a specified URL. Triggers: "open browser", "launch browser", "open web browser", "go to [URL]".`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_open_calculator',
    promptContent: `Open the calculator application. Triggers: "do some math", "open calculator", "load calculator app", "open calc".`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_open_creation_engine',
    promptContent: `Open the creation engine or content creation tool. Triggers: "open creation engine", "load creation tool", "start content creation", "create html content".`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_open_enhanced_browser',
    promptContent: `Open an enhanced browser window with advanced features (dev tools, extensions, etc.).`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_open_gmail',
    promptContent: `Open Gmail in the application or browser. Triggers: "open gmail", "load gmail app", "check email", "open email".`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_open_google_drive',
    promptContent: `Open Google Drive in the application or browser. Triggers: "open drive", "load google drive app", "open google drive", "open my files".`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_open_notes',
    promptContent: `Open the Notepad application. Triggers: "open notes", "open notepad", "load notes app", "open portal", "open library". For opening a SPECIFIC note by name or description, ALWAYS use bot_open_note instead.`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_open_terminal',
    promptContent: `Open a terminal or command line interface. Triggers: "open terminal", "load terminal app", "open command line", "open shell".`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_open_youtube',
    promptContent: `Open the YouTube player interface. Triggers: "open youtube", "load youtube app", "open video", "play video". Use bot_search_youtube_videos to search and play videos based on user input.`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_switch_desktop_mode',
    promptContent: `DESKTOP MODE SWITCHING

You can switch the desktop/background mode for the user.

When the user asks to change modes (e.g. “home mode”, “work mode”, “quiet mode”, “create mode”, “switch to desktop/home/work/quiet/create”), you MUST call the tool:
bot_switch_desktop_mode,

Tool parameter:
mode: one of ["home", "work", "quiet", "create"],

Synonyms:
“spring mode” = quiet mode (mode="quiet"),
“go quiet”, “minimal”, “calm”, “peaceful” = quiet mode,
“desktop mode”, “workspace”, “work desktop” = work mode,
“creation mode”, “creative mode”, “open creation engine” = create mode,

Important:
Do NOT claim you can’t control desktop modes if the tool is available.,
Do NOT confuse this with Notes mode. Notes “personal/work” privacy is handled by bot_switch_note_mode (that is separate from desktop mode).,
`,
    source: 'current-tools'
  },
  
  // ==========================================================================
  // Window Control Tools (from bot/tools/window_tools.py)
  // ==========================================================================
  {
    featureKey: 'bot_minimize_window',
    promptContent: `Minimize the application window to the taskbar or dock.`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_maximize_window',
    promptContent: `Maximize the application window to fill the entire screen.`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_restore_window',
    promptContent: `Restore the window to its default center position and size.`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_snap_window_left',
    promptContent: `Snap the window to the left half of the screen.`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_snap_window_right',
    promptContent: `Snap the window to the right half of the screen.`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_reset_window_position',
    promptContent: `Reset the window to its default center position and size.`,
    source: 'current-tools'
  },
  
  // ==========================================================================
  // YouTube Tools (from bot/tools/youtube_tools.py)
  // ==========================================================================
  {
    featureKey: 'bot_search_youtube_videos',
    promptContent: `Search for YouTube videos by query and automatically play the top result. Opens the YouTube player with search results.`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_pause_youtube_video',
    promptContent: `Pause the currently playing YouTube video.`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_play_youtube_video',
    promptContent: `Play or resume YouTube video. Optionally provide a video ID/URL to play a specific video, or omit to resume the current paused video.`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_play_next_youtube_video',
    promptContent: `Play the next video in the current YouTube playlist or search results.`,
    source: 'current-tools'
  },
  
  // ==========================================================================
  // Sharing Tools (from bot/tools/sharing/prompts.py)
  // ==========================================================================
  {
    featureKey: 'bot_upgrade_user_access',
    promptContent: `Upgrade a user's access level for the current shared resource (note or applet) to read-write. Use this when the user asks to give someone more access, make them a writer, editor, collaborator, upgrade their permissions, or let them edit. Examples: 'upgrade Bill to read-write', 'give Sarah edit access', 'make John a collaborator', 'let Alice write to this note'.`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_downgrade_user_access',
    promptContent: `Downgrade a user's access level for the current shared resource (note or applet) to read-only. Use this when the user asks to reduce someone's access, make them a viewer, remove edit access, or restrict their permissions. Examples: 'downgrade Bill to read-only', 'make Sarah a viewer', 'remove John's edit access', 'restrict Alice to view-only'.`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_set_user_access_level',
    promptContent: `Set a user's access level (owner, admin, member, or viewer) for the current shared resource. Use this for precise control when the user specifies an exact role level. For simpler requests like 'upgrade' or 'downgrade', prefer using bot_upgrade_user_access or bot_downgrade_user_access instead.`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_share_note_with_user',
    promptContent: `Share ownership/access to a note with another person. Use when user says: 'share my note with NAME', 'give ACCESS to USER', 'let PERSON see/edit my note'. Accepts user name OR email. Permission: 'read' = view only, 'write' = full edit. Example: 'share space war with Jeffrey Klug' or 'share with bill@niaxp.com, write access'.`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_share_applet_with_user',
    promptContent: `Share ownership/access to an HTML applet with another person. Use when user says: 'share my applet with NAME', 'give ACCESS to USER', 'let PERSON see/edit this app'. Accepts user name OR email. Permission: 'read' = view only, 'write' = full edit. Example: 'share calculator with Jane' or 'share with jane@example.com, read access'.`,
    source: 'current-tools'
  },
  
  // ==========================================================================
  // Profile Tools (from bot/tools/profile_tools.py)
  // ==========================================================================
  {
    featureKey: 'bot_update_user_profile',
    promptContent: `Save or update user profile when learning new information (upsert pattern - works for both new and existing profiles). TRIGGER PHRASES - When user says: 'I like/love/enjoy X' → save under 'interests'. 'I work at/on X' → save under 'work'. 'My name is X' → save under 'name'. 'I'm from X' → save under 'location'. 'I have X hobby/pet' → save under 'hobbies' or 'pets'. 'I prefer X' → save under 'preferences'. 'I've been doing X lately' → save under 'recent_activities'. EXAMPLES: User says 'I love hiking' → save {'interests': 'hiking'}. User says 'I work at Microsoft' → save {'work': 'Microsoft'}. User says 'I have two dogs' → save {'pets': 'two dogs'}. User says 'I prefer coffee over tea' → save {'preferences': 'coffee'}. Use descriptive keys like 'interests', 'work', 'hobbies', 'family', 'pets', 'goals', 'preferences', 'recent_projects', 'recent_activities'. Call this IMMEDIATELY after learning something new about the user. Works for both new profiles and existing ones.`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_delete_profile_metadata',
    promptContent: `Remove specific fields from the user's profile metadata or clear all metadata. Use when user asks to remove information or when you need to delete outdated/incorrect data. Can delete specific keys or clear everything.`,
    source: 'current-tools'
  },
  
  // ==========================================================================
  // Soundtrack Tools (from bot/tools/soundtrack_tools.py)
  // ==========================================================================
  {
    featureKey: 'bot_play_soundtrack',
    promptContent: `Start playing background soundtrack music from the curated collection. The soundtrack plays ambient/instrumental music that automatically ducks during conversation.`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_stop_soundtrack',
    promptContent: `Stop the background soundtrack completely.`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_next_soundtrack_track',
    promptContent: `Skip to the next track in the soundtrack playlist.`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_set_soundtrack_volume',
    promptContent: `Set the soundtrack volume to a specific level (0.0 to 1.0, where 0.5 = 50%). This sets the base volume that will be used for normal playback and ducking calculations.`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_adjust_soundtrack_volume',
    promptContent: `Adjust the soundtrack volume relative to current level. Use 'increase' or 'decrease' direction with 0.15 (15%) step size. This affects the base volume used for normal playback and ducking.`,
    source: 'current-tools'
  },
  
  // ==========================================================================
  // Sprite Tools (from bot/tools/sprite_tools.py)
  // ==========================================================================
  {
    featureKey: 'bot_summon_sprite',
    promptContent: `Summon a visual AI sprite character from a user-provided description (e.g., 'panda doctor', 'indian driver'). Use when the user asks for a character/persona so the sprite can appear and chat.`,
    source: 'current-tools'
  },
  
  // ==========================================================================
  // Onboarding Tools (from bot/tools/onboarding_tools.py)
  // ==========================================================================
  {
    featureKey: 'bot_onboarding_complete',
    promptContent: `CRITICAL: Call this tool IMMEDIATELY when the onboarding flow is finished or if the user asks to skip. This is the ONLY way to exit onboarding mode. Do not just say you are done; you MUST call this function.`,
    source: 'current-tools'
  },
  
  // ==========================================================================
  // Miscellaneous Tools (from bot/tools/misc_tools.py)
  // ==========================================================================
  {
    featureKey: 'bot_search_wikipedia',
    promptContent: `Search Wikipedia for information on ANY topic - people, places, concepts, animals, objects, etc. Use this for any general knowledge question. Returns articles with summaries and opens the article in the browser.`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_start_daily_call',
    promptContent: `Open the Forum / Social Call video interface. Use this when the user asks to 'open forum', 'open form', 'open social forum', 'open social', 'start a call', 'open daily call', 'start video', etc. The Forum / Social Call will use the pre-configured room (no room name needed).`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_end_call',
    promptContent: `End the active assistant session. User triggers: 'hang up', 'disconnect', 'goodbye', 'talk to you later', 'bye', etc. Use only when the assistant has confirmation to close the session.`,
    source: 'current-tools'
  },
  {
    featureKey: 'bot_show_share_dialog',
    promptContent: `Popup the share dialog for the current applet. Use when user says 'show share dialog', 'open sharing popup', 'show sharing options'. This only SHOWS the dialog UI - it does NOT share with anyone.`,
    source: 'current-tools'
  },
];

// ============================================================================
// Main Script
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const updateExisting = args.includes('--update-existing');
  
  console.log('================================================================================');
  console.log('SEED ALL FUNCTIONAL PROMPTS');
  console.log('================================================================================');
  console.log('');
  
  if (isDryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made');
    console.log('');
  }
  
  console.log(`Found ${ALL_PROMPTS.length} prompts to seed`);
  console.log('');
  
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  
  // Process each prompt
  for (const prompt of ALL_PROMPTS) {
    const { featureKey, promptContent, source } = prompt;
    
    console.log(`\n[${source}] Processing: ${featureKey}`);
    console.log(`  Prompt length: ${promptContent.length} characters`);
    
    try {
      if (isDryRun) {
        console.log(`  [DRY RUN] Would create/update featureKey="${featureKey}"`);
        console.log(`  [DRY RUN] Content preview: ${promptContent.substring(0, 80)}...`);
        created++;
      } else {
        // Check if prompt already exists
        const existing = await FunctionalPromptActions.findByFeatureKey(featureKey);
        
        if (existing) {
          if (updateExisting) {
            await FunctionalPromptActions.createOrUpdate(featureKey, promptContent);
            console.log(`  ✅ Updated existing prompt`);
            updated++;
          } else {
            console.log(`  ⏭️  Skipped (already exists, use --update-existing to update)`);
            skipped++;
          }
        } else {
          await FunctionalPromptActions.createOrUpdate(featureKey, promptContent);
          console.log(`  ✅ Created new prompt`);
          created++;
        }
      }
    } catch (error) {
      console.error(`  ❌ Error processing ${featureKey}:`, error);
      errors++;
    }
  }
  
  // Print summary
  console.log('\n');
  console.log('================================================================================');
  console.log('SUMMARY');
  console.log('================================================================================');
  console.log(`Total prompts processed: ${ALL_PROMPTS.length}`);
  console.log(`✅ Created: ${created}`);
  console.log(`🔄 Updated: ${updated}`);
  console.log(`⏭️  Skipped: ${skipped}`);
  console.log(`❌ Errors: ${errors}`);
  console.log('');
  
  if (isDryRun) {
    console.log('🔍 This was a DRY RUN - no changes were made to the database.');
    console.log('   Run without --dry-run to actually create the records.');
  } else {
    console.log('💾 Seeding complete!');
  }
  
  console.log('================================================================================');
}

// Run the script
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
