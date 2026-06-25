import assert from 'node:assert/strict';
import test from 'node:test';

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => new Response('{}', { status: 200 });

const registerModule = await import(new URL(`./telegram-preallowlist-register.mjs?test=${Date.now()}`, import.meta.url));

globalThis.fetch = originalFetch;

test('detects Telegram Bot API message deliveries', () => {
  assert.equal(
    registerModule.isTelegramMessageDelivery('https://api.telegram.org/bot123:abc/sendMessage', { method: 'POST' }),
    true
  );
  assert.equal(
    registerModule.isTelegramMessageDelivery('https://api.telegram.org/bot123:abc/getUpdates', { method: 'POST' }),
    false
  );
});

test('strips raw Telegram memory_search tool lines from message text', () => {
  const result = registerModule.normalizeTelegramOutboundBody({
    chat_id: '123',
    text: 'memory_search query="Steph profile"\nHere is what I found.'
  });

  assert.equal(result.changed, true);
  assert.equal(result.body.text, 'Here is what I found.');
});

test('uses safe fallback when Telegram text is only a hidden tool call', () => {
  const result = registerModule.normalizeTelegramOutboundBody({
    chat_id: '123',
    text: 'memory_search query="private memory"'
  });

  assert.equal(result.changed, true);
  assert.equal(result.body.text, "I don't know that yet.");
});
