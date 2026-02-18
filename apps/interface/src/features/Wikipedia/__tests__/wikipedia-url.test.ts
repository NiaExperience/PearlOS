import { generateWikipediaUrl } from '@interface/features/Wikipedia';

describe('generateWikipediaUrl', () => {
  it('formats basic query', () => {
    expect(generateWikipediaUrl('quantum physics')).toContain('Quantum_mechanics'); // special case mapping
  });
  it('strips question prefixes and punctuation', () => {
    const url = generateWikipediaUrl('What is artificial intelligence?');
    expect(url).toContain('Artificial_intelligence');
  });
});
