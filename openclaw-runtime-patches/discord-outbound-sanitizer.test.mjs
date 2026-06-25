import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractPearlTaskDispatchText,
  sanitizePublicDiscordOutboundText,
} from './discord-outbound-sanitizer.mjs';

test('strips read/path tool markup from public Discord text', () => {
  const clean = sanitizePublicDiscordOutboundText([
    'Alright, dispatching.',
    '<read>',
    '<path>/home/deploy/OpenClaw/skills/coding-agent/SKILL.md</path>',
    '</read>',
    'Queued.',
  ].join('\n'));

  assert.equal(clean, 'Alright, dispatching.\n\nQueued.');
});

test('strips command envelopes from public Discord text', () => {
  const clean = sanitizePublicDiscordOutboundText([
    'I see it.',
    '<command>/root/.local/bin/pearl-task-dispatch "CANVAS FIRST-RESPONSE FIX"</command>',
    'Queued.',
  ].join('\n'));

  assert.equal(clean, 'I see it.\n\nQueued.');
});

test('strips standalone tool description envelopes from public Discord text', () => {
  const clean = sanitizePublicDiscordOutboundText([
    'Let me dispatch this.',
    '<description>Dispatch note-writing task for prod summary</description>',
  ].join('\n'));

  assert.equal(clean, 'Let me dispatch this.');
});

test('extracts allowlisted Pearl task dispatch command text', () => {
  const task = extractPearlTaskDispatchText([
    'I see it.',
    '<command>/root/.local/bin/pearl-task-dispatch "CANVAS FIRST-RESPONSE FIX"</command>',
    'Queued.',
  ].join('\n'));

  assert.equal(task, 'CANVAS FIRST-RESPONSE FIX');
});

test('extracts Pearl task dispatch command text after flags', () => {
  const task = extractPearlTaskDispatchText(
    '<command>/home/deploy/.local/bin/pearl-task-dispatch --source discord --created-by agency "Fix Discord tool calls and task routing"</command>'
  );

  assert.equal(task, 'Fix Discord tool calls and task routing');
});

test('extracts JSON Pearl task dispatch tool calls', () => {
  const task = extractPearlTaskDispatchText([
    '<tool_call>',
    '{"name":"pearl-task-dispatch","arguments":{"task":"Audit why Discord tool calls are not creating Agency tasks and patch the runtime."}}',
    '</tool_call>',
  ].join('\n'));

  assert.equal(task, 'Audit why Discord tool calls are not creating Agency tasks and patch the runtime.');
});

test('extracts nested function-call Pearl task dispatch arguments', () => {
  const task = extractPearlTaskDispatchText(JSON.stringify({
    tool_calls: [{
      type: 'function',
      function: {
        name: 'pearl_task_dispatch',
        arguments: JSON.stringify({
          task: 'Run the Discord task bridge audit and report the concrete fix.'
        })
      }
    }]
  }));

  assert.equal(task, 'Run the Discord task bridge audit and report the concrete fix.');
});

test('extracts leaked bot task tool calls from Discord text', () => {
  const task = extractPearlTaskDispatchText(JSON.stringify({
    name: 'bot_openclaw_task',
    arguments: {
      description: 'Create an Agency task from this Discord request instead of only replying in chat.'
    }
  }));

  assert.equal(task, 'Create an Agency task from this Discord request instead of only replying in chat.');
});

test('does not extract arbitrary command envelopes', () => {
  const task = extractPearlTaskDispatchText('<command>rm -rf /tmp/nope</command>');
  assert.equal(task, null);
});

test('strips fenced command envelopes from public Discord text', () => {
  const clean = sanitizePublicDiscordOutboundText([
    'I see it.',
    '```xml',
    '<command>/root/.local/bin/pearl-task-dispatch "CANVAS FIRST-RESPONSE FIX"</command>',
    '```',
    'Queued.',
  ].join('\n'));

  assert.equal(clean, 'I see it.\n\nQueued.');
});

test('normalizes em dashes and en dashes from public Discord text', () => {
  const clean = sanitizePublicDiscordOutboundText(
    'The idea works — one model writes, another checks — and ranges like 1–3 stay readable.'
  );

  assert.equal(clean, 'The idea works, one model writes, another checks, and ranges like 1-3 stay readable.');
});

test('suppresses the OpenClaw canned progress fallback', () => {
  const clean = sanitizePublicDiscordOutboundText('Still working on it.');

  assert.equal(clean, '');
});

test('strips canned progress lines while preserving the actual update', () => {
  const clean = sanitizePublicDiscordOutboundText([
    "I'm checking the actual state before I say more.",
    'The Notes link now opens the audit directly after login.',
  ].join('\n'));

  assert.equal(clean, 'The Notes link now opens the audit directly after login.');
});

test('strips canned progress sentence prefixes while preserving actual content', () => {
  const clean = sanitizePublicDiscordOutboundText(
    "I'm checking the actual state before I say more. The staging build passed with the Discord sanitizer patch."
  );

  assert.equal(clean, 'The staging build passed with the Discord sanitizer patch.');
});

test('suppresses the mechanical working-through status line', () => {
  const clean = sanitizePublicDiscordOutboundText(
    'Working through "Today\'s Standup..." now; I’ll only post again when there is evidence, a blocker, or a result.'
  );

  assert.equal(clean, '');
});

test('removes task, run, and hash identifiers from public Discord text', () => {
  const clean = sanitizePublicDiscordOutboundText([
    'Task ID: task-abc123456789',
    'Run ID: 550e8400-e29b-41d4-a716-446655440000',
    'Hash: 0123456789abcdef0123456789abcdef',
    'The visible result is ready.',
  ].join('\n'));

  assert.equal(clean, 'The visible result is ready.');
});
