import assert from 'node:assert/strict';
import test from 'node:test';

import { load } from './telegram-preallowlist-loader.mjs';

const DISCORD_SEND_SOURCE = `
function stripUndefinedFields(value) {
\treturn Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== void 0));
}

export async function sendDiscordText(rest, channelId, text, replyTo, request, maxLinesPerMessage, components, embeds, chunkMode, silent, maxChars) {
\tif (!text.trim()) throw new Error("Message must be non-empty for Discord sends");
\treturn { content: text };
}
`;

const DISCORD_CORE_SOURCE = `
function clean$2(value) {
\treturn Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== void 0));
}

function serializeAnyComponent(component) {
\treturn component.serialize();
}

function payloadHasV2Components(payload) {
\treturn Boolean(payload.components?.some((component) => component.isV2));
}

function normalizePayloadFlags(payload) {
\treturn payload.flags;
}

function serializePayload(payload) {
\tif (typeof payload === "string") return { content: payload };
\tconst flags = normalizePayloadFlags(payload);
\treturn clean$2({
\t\tcontent: payload.content,
\t\tembeds: payload.embeds?.map((entry) => "serialize" in entry ? entry.serialize() : entry),
\t\tcomponents: payload.components?.map((entry) => serializeAnyComponent(entry)),
\t\tallowed_mentions: payload.allowed_mentions ?? payload.allowedMentions,
\t\tflags,
\t\ttts: payload.tts,
\t\tfiles: payload.files,
\t\tpoll: payload.poll,
\t\tsticker_ids: payload.stickers
\t});
}

export { serializePayload };
`;

const DISCORD_PROVIDER_SOURCE = `
async function safeDiscordInteractionCall(label, fn) {
\treturn await fn();
}

export async function deliverDiscordInteractionReplyTest(interaction, content, firstMessageComponents) {
\tlet hasReplied = false;
\tconst preferFollowUp = false;
\tconst params = {};
\tconst sendMessage = async (content, files, components) => {
\t\tconst payload = files && files.length > 0 ? {
\t\t\tcontent,
\t\t\t...components ? { components } : {},
\t\t\tfiles
\t\t} : {
\t\t\tcontent,
\t\t\t...components ? { components } : {}
\t\t};
\t\tawait safeDiscordInteractionCall("interaction send", async () => {
\t\t\tif (!preferFollowUp && !hasReplied) {
\t\t\t\tawait interaction.reply(payload);
\t\t\t\thasReplied = true;
\t\t\t\treturn;
\t\t\t}
\t\t\tawait interaction.followUp(payload);
\t\t\thasReplied = true;
\t\t});
\t};
\tawait sendMessage(content, void 0, firstMessageComponents);
}
`;

const DISCORD_INBOUND_HANDLER_SOURCE = `
async function handleDiscordCurrentMessage(processContext, message, token, ctx, isDirectMessage, isGuildMessage, messageChannelId, deliverTarget) {
\tconst { ctxPayload, persistedSessionKey, turn, replyPlan, deliverTarget, replyTarget, replyReference } = processContext;
\treturn ctxPayload;
}
`;

const DISCORD_ROUTER_PROBE_SOURCE = `
export function __pearlRouterProbe(value) {
\treturn pearlOsDiscordLooksLikeAgencyTask(value);
}

async function handleDiscordCurrentMessage(processContext, message, token, ctx, isDirectMessage, isGuildMessage, messageChannelId) {
\tconst { ctxPayload, persistedSessionKey, turn, replyPlan, deliverTarget, replyTarget, replyReference } = processContext;
\treturn ctxPayload;
}
`;

const DISCORD_LEGACY_ROUTER_PROBE_SOURCE = `
export function __pearlRouterProbe(value) {
\treturn pearlOsDiscordLooksLikeAgencyTask(value);
}

async function processDiscordMessage() {
\tawait recordInboundSession({
\t\tstorePath,
\t\tsessionKey: persistedSessionKey,
\t\tctx: ctxPayload,
\t\tupdateLastRoute: {
\t\t\tsessionKey: persistedSessionKey,
\t\t\tchannel: "discord",
\t\t\tto: lastRouteTo,
\t\t\taccountId: route.accountId
\t\t},
\t\tonRecordError: (err) => {
\t\t\tlogVerbose(\`discord: failed updating session meta: \${String(err)}\`);
\t\t}
\t});
\treturn ctxPayload;
}
`;

async function importPatchedSource(url, source) {
  const result = await load(url, {}, async () => ({
    format: 'module',
    source,
  }));
  assert.match(result.source, /pearlOsSanitizeDiscordOutboundText/);
  const encoded = Buffer.from(result.source).toString('base64');
  return import(`data:text/javascript;base64,${encoded}#${Date.now()}-${Math.random()}`);
}

async function importPatchedDiscordSendSource() {
  return importPatchedSource('file:///tmp/send-test.js', DISCORD_SEND_SOURCE);
}

async function importPatchedDiscordRouterProbeSource() {
  const result = await load(
    'file:///tmp/extensions/discord/message-handler.process-test.js',
    {},
    async () => ({
      format: 'module',
      source: DISCORD_ROUTER_PROBE_SOURCE,
    })
  );
  const encoded = Buffer.from(result.source).toString('base64');
  return import(`data:text/javascript;base64,${encoded}#${Date.now()}-${Math.random()}`);
}

async function importPatchedLegacyDiscordRouterProbeSource() {
  const result = await load(
    'file:///tmp/message-handler-RA1CGaUz.js',
    {},
    async () => ({
      format: 'module',
      source: DISCORD_LEGACY_ROUTER_PROBE_SOURCE,
    })
  );
  assert.match(result.source, /pearlOsMaybeRouteDiscordAgencyTask/);
  assert.match(result.source, /statusReactions\.setDone/);
  const encoded = Buffer.from(result.source).toString('base64');
  return import(`data:text/javascript;base64,${encoded}#${Date.now()}-${Math.random()}`);
}

test('patched Discord send suppresses canned-only progress text', async () => {
  const mod = await importPatchedDiscordSendSource();
  const result = await mod.sendDiscordText(
    null,
    '123',
    'Still working on it.',
    null,
    null,
    10,
    [],
    [],
    undefined,
    false,
    2000
  );

  assert.equal(result, null);
});

test('patched Discord core payload serializer normalizes em dashes', async () => {
  const mod = await importPatchedSource(
    'file:///tmp/extensions/discord/discord-test.js',
    DISCORD_CORE_SOURCE
  );

  assert.deepEqual(
    mod.serializePayload("I wish I could check that for you — but still no tool access."),
    { content: "I wish I could check that for you, but still no tool access." }
  );
  assert.deepEqual(
    mod.serializePayload({ content: "One thing — then another.", allowedMentions: { parse: [] } }),
    { content: "One thing, then another.", allowed_mentions: { parse: [] } }
  );
});

test('patched Discord provider interaction send sanitizes and skips empty content', async () => {
  const mod = await importPatchedSource(
    'file:///tmp/extensions/discord/provider-test.js',
    DISCORD_PROVIDER_SOURCE
  );
  const replies = [];
  const interaction = {
    reply: async (payload) => replies.push(payload),
    followUp: async (payload) => replies.push(payload),
  };

  await mod.deliverDiscordInteractionReplyTest(interaction, "One thing — then another.");
  assert.deepEqual(replies, [{ content: "One thing, then another." }]);

  await mod.deliverDiscordInteractionReplyTest(interaction, "Top sources:\\nURL: https://example.test");
  assert.deepEqual(replies, [{ content: "One thing, then another." }]);
});

test('patched Discord inbound handler injects linked PearlOS identity context', async () => {
  const result = await load(
    'file:///tmp/extensions/discord/message-handler.process-test.js',
    {},
    async () => ({
      format: 'module',
      source: DISCORD_INBOUND_HANDLER_SOURCE,
    })
  );

  assert.match(result.source, /pearlOsEnrichDiscordLinkedIdentityContext/);
  assert.match(result.source, /\/api\/discord\/dm-link\/context\?discordUserId=/);
  assert.match(result.source, /Trusted PearlOS identity context for this verified Discord sender/);
});

test('patched Discord inbound handler recognizes note-detail followups', async () => {
  const result = await load(
    'file:///tmp/extensions/discord/message-handler.process-test.js',
    {},
    async () => ({
      format: 'module',
      source: DISCORD_INBOUND_HANDLER_SOURCE,
    })
  );

  assert.match(result.source, /pearlOsDiscordLooksLikeAgencyTaskDetails/);
  assert.match(result.source, /Follow-up details from the requester/);
  assert.match(result.source, /local\\s\*llama/);
});

test('patched Discord inbound handler routes public prod Canvas breakage reports', async () => {
  const mod = await importPatchedDiscordRouterProbeSource();

  assert.equal(
    mod.__pearlRouterProbe(
      "Pearl what's happening here on prod? Canvas unavailable. The visual scene could not be loaded. /canvas/a35c26c02165af19.html Failed to fetch Wonder Canvas HTML (404)"
    ),
    true
  );
  assert.equal(mod.__pearlRouterProbe('Canvas looks good now, thanks.'), false);
});

test('patched Discord inbound handler routes explicit tool and task requests', async () => {
  const mod = await importPatchedDiscordRouterProbeSource();

  assert.equal(
    mod.__pearlRouterProbe('Can you run a tool call and create a task to fix the Discord bridge?'),
    true
  );
  assert.equal(
    mod.__pearlRouterProbe("Pearl's Discord tool calls are not creating tasks; audit why and patch it."),
    true
  );
  assert.equal(mod.__pearlRouterProbe('What tools do you have available?'), false);
});

test('patched legacy Discord message handler routes explicit tool and task requests', async () => {
  const mod = await importPatchedLegacyDiscordRouterProbeSource();

  assert.equal(
    mod.__pearlRouterProbe('Can you run a tool call and create a task to fix the Discord bridge?'),
    true
  );
  assert.equal(
    mod.__pearlRouterProbe("Pearl's Discord tool calls are not creating tasks; audit why and patch it."),
    true
  );
});

test('patched Discord send strips canned prefixes and internal identifiers', async () => {
  const mod = await importPatchedDiscordSendSource();
  const result = await mod.sendDiscordText(
    null,
    '123',
    [
      "I'm checking the actual state before I say more. The staging build passed.",
      'Task ID: task-abc123456789',
      'Run ID: 550e8400-e29b-41d4-a716-446655440000',
      'Hash: 0123456789abcdef0123456789abcdef',
    ].join('\n'),
    null,
    null,
    10,
    [],
    [],
    undefined,
    false,
    2000
  );

  assert.deepEqual(result, { content: 'The staging build passed.' });
});

test('patched Discord send strips leaked tool description envelopes', async () => {
  const mod = await importPatchedDiscordSendSource();
  const result = await mod.sendDiscordText(
    null,
    '123',
    [
      'Let me dispatch this to write that summary note.',
      '<description>Dispatch note-writing task for prod summary</description>',
    ].join('\n'),
    null,
    null,
    10,
    [],
    [],
    undefined,
    false,
    2000
  );

  assert.deepEqual(result, { content: 'Let me dispatch this to write that summary note.' });
});

test('patched Discord send suppresses raw search result dumps', async () => {
  const mod = await importPatchedDiscordSendSource();
  const result = await mod.sendDiscordText(
    null,
    '123',
    [
      'Top sources:',
      '1. Example Result',
      'URL: https://example.test',
      'Summary: A copied search snippet.',
    ].join('\n'),
    null,
    null,
    10,
    [],
    [],
    undefined,
    false,
    2000
  );

  assert.equal(result, null);
});
