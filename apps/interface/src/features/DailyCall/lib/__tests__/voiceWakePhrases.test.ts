import { isPearlWakePhrase, normalizeWakePhraseTranscript } from '../voiceWakePhrases';

describe('voice wake phrases', () => {
  it('normalizes browser transcripts', () => {
    expect(normalizeWakePhraseTranscript("Pearl, it's me.")).toBe("pearl it's me");
  });

  it.each([
    'Hey Pearl',
    'Pearl',
    'Purl',
    'Perle',
    'Pearl, you there?',
    'Pearl wake up',
    'Hi Pearl',
    'Hello Pearl',
    "Pearl, it's me",
    'wake up Pearl',
    'okay April are you there',
  ])('matches %s', (phrase) => {
    expect(isPearlWakePhrase(phrase)).toBe(true);
  });

  it.each([
    'tell me about pearl diving',
    'the pearl necklace is in the drawer',
    'hello there',
    'wake up early tomorrow',
  ])('does not match incidental speech: %s', (phrase) => {
    expect(isPearlWakePhrase(phrase)).toBe(false);
  });
});
