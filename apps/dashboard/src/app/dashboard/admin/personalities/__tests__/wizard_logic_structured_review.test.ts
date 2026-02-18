import { normalizeRevisedPrompt } from '../wizard_logic';

describe('normalizeRevisedPrompt structured beats', () => {
  it('maps GOAL and inline // into goal and body', () => {
    const payload = {
      PERSONALITY: 'P',
      RULES: ['r1'],
      'SEQUENCE LOGIC': ['s1'],
      'PRIMARY OBJECTIVE': 'O',
      'BEAT 1': {
        GOAL: 'Do thing',
        '//': 'Body line',
      },
    };

    const normalized = normalizeRevisedPrompt(payload);
    const beat = normalized.state.beats[0];
    expect(beat.goal).toBe('Do thing');
    expect(beat.body).toContain('Body line');
  });
});
