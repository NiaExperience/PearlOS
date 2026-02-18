import { buildLibraryAppendix, getLibraryTemplates, resolveLibraryTemplate, summarizeLibraryOptions } from '@nia/features';

describe('library-templates', () => {
  it('returns interactive templates and includes quick poll', () => {
    const templates = getLibraryTemplates('interactive');
    const quickPoll = templates.find(t => t.id === 'quick_poll_v1');
    expect(templates.length).toBeGreaterThan(0);
    expect(quickPoll).toBeDefined();
  });

  it('does not require choice when only one tool template exists', () => {
    const resolution = resolveLibraryTemplate('tool');
    expect(resolution.templates.length).toBe(1);
    expect(resolution.needsChoice).toBe(false);
    expect(resolution.selected).toBeDefined();
  });

  it('selects template when explicit id is provided', () => {
    const resolution = resolveLibraryTemplate('interactive', 'party_pack_score');
    expect(resolution.selected).toBeDefined();
    expect(resolution.needsChoice).toBe(false);
    expect(resolution.selected!.filename).toContain('score-keeper');
  });

  it('builds a library appendix with code fence', () => {
    const template = getLibraryTemplates('interactive').find(t => t.id === 'quick_poll_v1');
    expect(template).toBeDefined();
    const appendix = buildLibraryAppendix(template!);
    expect(appendix.title).toContain(template!.filename);
    expect(appendix.body).toContain('```html');
  });

  it('summarizes library options for prompting', () => {
    const templates = getLibraryTemplates('interactive');
    const summaries = summarizeLibraryOptions(templates);
    expect(summaries[0]).toHaveProperty('id');
    expect(summaries[0]).toHaveProperty('description');
  });
});
