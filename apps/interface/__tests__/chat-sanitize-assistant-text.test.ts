import {
  detectTextBodyToolCalls,
  sanitizeAssistantText,
} from '../src/features/ChatMode/lib/sanitize-assistant-text';

describe('sanitizeAssistantText', () => {
  it('strips complete leaked tool tags', () => {
    expect(
      sanitizeAssistantText('Before <tool_call>{"name":"search","arguments":{"q":"secret"}}</tool_call> After'),
    ).toBe('Before  After');
  });

  it('strips partial streamed tool tags', () => {
    expect(
      sanitizeAssistantText('Answer starts. <tool_use>{"name":"send_message","arguments":'),
    ).toBe('Answer starts.');
  });

  it('strips orphan tool closing tags leaked after visible prose', () => {
    expect(
      sanitizeAssistantText('Let me kick off a few parallel tracks.\n\n</tool_call>'),
    ).toBe('Let me kick off a few parallel tracks.');
  });

  it('strips fenced tool JSON blocks', () => {
    expect(
      sanitizeAssistantText('```json\n{"name":"send_message","arguments":{"content":"hi"}}\n```\nDone.'),
    ).toBe('Done.');
  });

  it('detects and strips nested inline tool-call JSON', () => {
    const leaked = 'Pearl says {"tool_call":"bot_web_search","arguments":{"query":"OpenAI news","count":3}} done.';

    expect(detectTextBodyToolCalls(leaked)).toEqual([
      {
        toolName: 'bot_web_search',
        args: { query: 'OpenAI news', count: 3 },
        rawJson: '{"tool_call":"bot_web_search","arguments":{"query":"OpenAI news","count":3}}',
      },
    ]);
    expect(sanitizeAssistantText(leaked)).toBe('Pearl says  done.');
  });

  it('drops process narration openings', () => {
    expect(
      sanitizeAssistantText("Let me check the server nickname first. Use Change Nickname in that server."),
    ).toBe('Use Change Nickname in that server.');
  });

  it('strips common search/tool babble from streamed answers', () => {
    expect(
      sanitizeAssistantText("Answer. Now I'll look that up. Real result."),
    ).toBe('Answer. Real result.');

    expect(
      sanitizeAssistantText('Let me run web_search. Sources sampled: ISW.'),
    ).not.toMatch(/let me|web_search|Sources sampled/i);
  });

  it('strips standalone fenced nested tool calls', () => {
    expect(
      sanitizeAssistantText('```json\n{"tool_call":"bot_web_search","arguments":{"query":"x"}}\n```\n'),
    ).toBe('');
  });

  it('returns empty string when only process narration is present', () => {
    expect(sanitizeAssistantText("I'll look into that")).toBe('');
  });
});
