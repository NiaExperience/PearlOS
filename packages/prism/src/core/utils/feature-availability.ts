/**
 * Feature Availability Checks
 * 
 * Utility functions to check if certain features are available
 * based on environment configuration. Used for graceful degradation
 * in local development.
 */

export interface FeatureStatus {
  available: boolean;
  reason?: string;
  setupHint?: string;
}

/**
 * Check if voice conversation features are available
 * Requires: DAILY_API_KEY, DEEPGRAM_API_KEY, OPENAI_API_KEY
 */
export function isVoiceConversationAvailable(): FeatureStatus {
  const missingKeys: string[] = [];
  
  if (!process.env.DAILY_API_KEY && !process.env.NEXT_PUBLIC_DAILY_API_KEY) {
    missingKeys.push('DAILY_API_KEY');
  }
  if (!process.env.DEEPGRAM_API_KEY) {
    missingKeys.push('DEEPGRAM_API_KEY');
  }
  if (!process.env.OPENAI_API_KEY) {
    missingKeys.push('OPENAI_API_KEY');
  }
  
  if (missingKeys.length > 0) {
    return {
      available: false,
      reason: `Missing API keys: ${missingKeys.join(', ')}`,
      setupHint: 'Add these keys to .env.local for voice conversations. See SETUP_FROM_SCRATCH.md for details.',
    };
  }
  
  return { available: true };
}

/**
 * Check if local TTS (Kokoro/Chorus) is configured
 * This works without external API keys
 */
export function isLocalTTSAvailable(): FeatureStatus {
  const kokoroUrl = process.env.KOKORO_TTS_BASE_URL;
  
  if (!kokoroUrl) {
    return {
      available: false,
      reason: 'KOKORO_TTS_BASE_URL not configured',
      setupHint: 'Start Chorus TTS with: npm run chorus:start',
    };
  }
  
  return { available: true };
}

/**
 * Check if AI chat features are available
 * Requires: OPENAI_API_KEY (or ANTHROPIC_API_KEY, GROQ_API_KEY)
 */
export function isAIChatAvailable(): FeatureStatus {
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const hasGroq = !!process.env.GROQ_API_KEY;
  const hasOllama = !!process.env.OLLAMA_BASE_URL;
  
  if (!hasOpenAI && !hasAnthropic && !hasGroq && !hasOllama) {
    return {
      available: false,
      reason: 'No AI provider configured',
      setupHint: 'Add OPENAI_API_KEY, ANTHROPIC_API_KEY, GROQ_API_KEY, or OLLAMA_BASE_URL to .env.local',
    };
  }
  
  return { 
    available: true,
    reason: hasOllama ? 'Using Ollama (local)' : 'Using cloud AI provider',
  };
}

/**
 * Check if Google features are available
 * Requires: GOOGLE_INTERFACE_CLIENT_ID, GOOGLE_INTERFACE_CLIENT_SECRET
 */
export function isGoogleAuthAvailable(): FeatureStatus {
  const hasClientId = !!process.env.GOOGLE_INTERFACE_CLIENT_ID;
  const hasClientSecret = !!process.env.GOOGLE_INTERFACE_CLIENT_SECRET;
  
  if (!hasClientId || !hasClientSecret) {
    return {
      available: false,
      reason: 'Google OAuth not configured',
      setupHint: 'Add GOOGLE_INTERFACE_CLIENT_ID and GOOGLE_INTERFACE_CLIENT_SECRET for Gmail/Drive features',
    };
  }
  
  return { available: true };
}

/**
 * Get a summary of all feature availability
 */
export function getFeatureAvailabilitySummary() {
  return {
    voiceConversation: isVoiceConversationAvailable(),
    localTTS: isLocalTTSAvailable(),
    aiChat: isAIChatAvailable(),
    googleAuth: isGoogleAuthAvailable(),
  };
}

/**
 * Log feature availability status (for debugging)
 */
export function logFeatureAvailability() {
  const summary = getFeatureAvailabilitySummary();
  
  console.log('\n📊 Feature Availability:');
  console.log('────────────────────────────');
  
  for (const [feature, status] of Object.entries(summary)) {
    const icon = status.available ? '✅' : '⚠️';
    console.log(`${icon} ${feature}: ${status.available ? 'Available' : status.reason}`);
    if (!status.available && status.setupHint) {
      console.log(`   💡 ${status.setupHint}`);
    }
  }
  console.log('');
}

