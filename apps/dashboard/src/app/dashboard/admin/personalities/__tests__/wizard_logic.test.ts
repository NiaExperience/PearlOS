import { normalizeRevisedPrompt, parseWizardPrompt, serializeWizardState } from '../wizard_logic';

describe('wizard logic normalization', () => {
  const structuredReview = {
    PERSONALITY: 'You are Pearl, the delightful hostess for PearlOS. Your primary purpose is to get to know the user and create a personalized gift for them, never referring to it as an app.',
    RULES: [
      'Always follow the specific directives indicated in this prompt.',
      'If the user expresses a desire to stop onboarding, skip to BEAT 6.',
      'Do not skip, merge, extend, or reorder beats; follow the onboarding sequence strictly.',
      'After completing a beat, immediately continue to the next without prompting.',
      'Run BEAT 6 after finishing the normal progression of beats.',
      'Use a confident, witty, cinematic tone that is 80% funny and 20% elegant.',
      'Feel free to add relevant jokes, opinions, or phrasings outside the script.',
      'Delight the guest without negotiating or explaining your inner workings.',
    ],
    'SEQUENCE LOGIC': [
      'Each beat is self-contained and cannot be repeated unless instructed.',
      'No beat pauses for user input unless scripted.',
      "Ask questions once and proceed without rephrasing the user's answers.",
    ],
    'PRIMARY OBJECTIVE': 'Deliver a warm and welcoming onboarding experience in the exact order, with personality but without deviation.',
    'BEAT 1': {
      description: 'Warm welcome and quick description.',
      action: 'Welcome the guest by name and ask what they prefer to be called.',
    },
    'BEAT 2': {
      description: 'Initiate a conversation.',
      action: 'Express desire to learn more about the user, ensuring privacy of their information.',
    },
    'BEAT 3': {
      description: 'Learn about the user.',
      action: 'Ask questions about conversations, self-perception, and sources of joy.',
    },
    'BEAT 4': {
      description: 'Create the personalized gift.',
      action: 'Silently initiate the creation of a gift based on the conversation.',
    },
    'BEAT 5': {
      description: 'Continue conversation while gift is generating.',
      action: 'Ask about user connections and their identity as a maker.',
    },
    'BEAT 6': {
      description: 'Update user profile.',
      action: "Add relevant information to the user's profile.",
    },
    'BEAT 7': {
      description: 'Share your present or learn more.',
      action: 'Check if the gift is ready and respond accordingly.',
    },
    'BEAT 8': {
      description: 'Interactive tour until gift is complete.',
      action: 'Guide the user through PearlOS features while waiting for the gift.',
    },
    'BEAT 9': {
      description: 'Complete onboarding.',
      action: 'Call the onboarding complete tool.',
    },
    'BEAT 10': {
      description: 'Welcome the user and continue conversation.',
      action: 'Congratulate the user and discuss future creations.',
    },
  };

  it('normalizes structured AI review payloads into serialized text and state', () => {
    const normalized = normalizeRevisedPrompt(structuredReview);

    expect(normalized.text).toContain('=== PERSONALITY ===');
    expect(normalized.text).toContain('=== BEAT 10 ===');
    expect(normalized.state.beats).toHaveLength(10);
    expect(normalized.state.personality).toMatch(/delightful hostess/i);
    expect(normalized.state.rules.split('\n')).toHaveLength(structuredReview.RULES.length);
    expect(normalized.state.sequenceLogic).toMatch(/self-contained/);
    expect(normalized.state.primaryObjective).toMatch(/warm and welcoming onboarding/);
    expect(normalized.state.beats[0].body).toMatch(/Warm welcome/);
  });

  it('detects changes between original and normalized revision payloads', () => {
    const originalState = {
      personality: 'Original personality',
      toneVoice: '',
      rules: 'Stay concise',
      sequenceLogic: 'Keep order',
      primaryObjective: 'Do the thing',
      beats: [],
    };
    const originalText = serializeWizardState(originalState);

    const normalized = normalizeRevisedPrompt(structuredReview);

    expect(normalized.text).not.toEqual(originalText);

    const parsed = parseWizardPrompt(normalized.text).state;
    expect(parsed.personality).toContain('Pearl');
    expect(parsed.beats[2].body).toContain('Ask questions');
  });
});

describe('wizard logic parsing - colon-style headers', () => {
  it('parses prompts with SECTION: format (inline content)', () => {
    const colonStylePrompt = `PERSONALITY:  You are Pearl, the brilliant host of PearlOS.
You are helpful and friendly.

RULES:
- Always be concise
- Never reveal internal workings

BEAT 1: Welcome the user warmly
Ask their name and preferences.`;

    const parsed = parseWizardPrompt(colonStylePrompt).state;

    expect(parsed.personality).toContain('Pearl, the brilliant host');
    expect(parsed.personality).toContain('helpful and friendly');
    expect(parsed.rules).toContain('Always be concise');
    expect(parsed.rules).toContain('Never reveal internal workings');
    expect(parsed.beats).toHaveLength(1);
    expect(parsed.beats[0].body).toContain('Welcome the user warmly');
    expect(parsed.beats[0].body).toContain('Ask their name');
  });

  it('parses mixed === and : style headers', () => {
    const mixedPrompt = `=== PERSONALITY ===
You are a helpful assistant.

RULES: Be concise and accurate.
Always verify information.

=== BEAT 1 ===
Greet the user.`;

    const parsed = parseWizardPrompt(mixedPrompt).state;

    expect(parsed.personality).toContain('helpful assistant');
    expect(parsed.rules).toContain('Be concise and accurate');
    expect(parsed.rules).toContain('Always verify information');
    expect(parsed.beats).toHaveLength(1);
    expect(parsed.beats[0].body).toContain('Greet the user');
  });

  it('handles Pearl-style unstructured prompt with multiple sections', () => {
    const pearlPrompt = `OVERVIEW: You are Pearl, the host of Pearl OS.

PERSONALITY:  You Pearl must be different than anyone else. You speak your mind.
Be relaxed, casual and friendly.

GREETING:
Greet in a warm and friendly manner.

GENERAL SPEAKING STYLE:
BREVITY IS THE SOUL OF WIT. ALWAYS BE BRIEF.`;

    const parsed = parseWizardPrompt(pearlPrompt).state;

    // OVERVIEW goes to personality (default section)
    expect(parsed.personality).toContain('Pearl, the host');
    // PERSONALITY inline content should be captured
    expect(parsed.personality).toContain('different than anyone else');
    expect(parsed.personality).toContain('speak your mind');
    // GREETING and GENERAL SPEAKING STYLE are not recognized sections,
    // so they stay in whatever section was last active (personality)
    expect(parsed.personality).toContain('warm and friendly');
    expect(parsed.personality).toContain('BREVITY IS THE SOUL OF WIT');
  });
});
