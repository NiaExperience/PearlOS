import { sanitizeDiscordContent } from '../src/app/api/discord/_lib/sanitize-discord-content';

describe('sanitizeDiscordContent', () => {
  it('strips orphan tool closing tags from public Discord content', () => {
    expect(
      sanitizeDiscordContent('Let me kick off a few parallel tracks.\n\n</tool_call>'),
    ).toBe('Let me kick off a few parallel tracks.');
  });

  it('strips complete tool call blocks while preserving visible prose', () => {
    expect(
      sanitizeDiscordContent('Queued. <tool_call>{"name":"pearl-task-dispatch"}</tool_call>'),
    ).toBe('Queued.');
  });

  it('strips fenced tool JSON payloads', () => {
    expect(
      sanitizeDiscordContent('```json\n{"tool_call":"pearl-task-dispatch","arguments":{"task":"x"}}\n```\nPosted.'),
    ).toBe('Posted.');
  });

  it('strips XML-style exec calls from public Discord content', () => {
    expect(
      sanitizeDiscordContent(
        'Checking now.\n<exec command="pm2 status 2>&1" />\nStill here.',
      ),
    ).toBe('Checking now.\nStill here.');
  });

  it('strips XML-style read path calls from public Discord content', () => {
    expect(
      sanitizeDiscordContent(
        'Alright, dispatching.\n<read>\n<path>/home/deploy/OpenClaw/skills/coding-agent/SKILL.md</path>\n</read>\nQueued.',
      ),
    ).toBe('Alright, dispatching.\n\nQueued.');
  });

  it('strips XML session/file envelopes from public Discord content', () => {
    expect(
      sanitizeDiscordContent('<file> <sessions> <session id="session-1" name="pearlos-staging-private-omega" /> </sessions>'),
    ).toBe('');
  });

  it('strips inline JSON tool-call objects', () => {
    expect(
      sanitizeDiscordContent('Checking {"tool_call":"bot_web_search","arguments":{"query":"license","count":3}} done.'),
    ).toBe('Checking  done.');
  });

  it('strips inline recipient-name tool payloads', () => {
    expect(
      sanitizeDiscordContent('Run {"recipient_name":"functions.exec_command","parameters":{"cmd":"pm2 status"}} instead.'),
    ).toBe('Run  instead.');
  });

  it('strips OpenAI-style inline tool_calls arrays', () => {
    expect(
      sanitizeDiscordContent('Before {"tool_calls":[{"function":{"name":"web_search","arguments":"{}"}}]} after.'),
    ).toBe('Before  after.');
  });

  it('removes raw internal failure details from public Discord content', () => {
    expect(
      sanitizeDiscordContent(
        "Pearl's Agency says: Pearl says: sandbox workspace-write failed with permission mode blocks disp-5d1fad6498.\nDone now.",
      ),
    ).toBe("Pearl's Agency says: I hit a worker permissions problem before the task could finish cleanly. Done now.");
  });

  it('trims long content at a sentence boundary', () => {
    const long = `First sentence. ${'Second sentence '.repeat(160)} tail`;
    expect(sanitizeDiscordContent(long).endsWith('tail')).toBe(false);
    expect(sanitizeDiscordContent(long).endsWith('.')).toBe(true);
  });
});
