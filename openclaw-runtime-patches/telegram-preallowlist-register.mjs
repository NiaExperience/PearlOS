import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  extractPearlTaskDispatchText,
  sanitizePublicDiscordEmbed,
  sanitizePublicDiscordOutboundText
} from './discord-outbound-sanitizer.mjs';

const loaderPath = path.join(path.dirname(new URL(import.meta.url).pathname), 'telegram-preallowlist-loader.mjs');
const TELEGRAM_EMPTY_TEXT_FALLBACK = "I don't know that yet.";
const execFileAsync = promisify(execFile);
const DISCORD_TOOL_DISPATCH_ENABLED = process.env.PEARL_DISCORD_TOOL_DISPATCH_ENABLED !== '0';
const PEARL_TASK_DISPATCH_BIN = process.env.PEARL_TASK_DISPATCH_BIN || '/home/deploy/.local/bin/pearl-task-dispatch';

function ensureOpenClawDistExtensionsBridge() {
  const cwd = process.cwd();
  const expected = path.join(cwd, 'dist', 'extensions');
  if (fs.existsSync(expected)) return;

  const candidates = [
    path.join(cwd, 'node_modules', 'openclaw', 'dist', 'extensions')
  ];
  const target = candidates.find((candidate) => fs.existsSync(path.join(candidate, 'memory-core', 'index.js')));
  if (!target) return;

  try {
    fs.mkdirSync(path.dirname(expected), { recursive: true });
    fs.symlinkSync(target, expected, 'dir');
  } catch {
    // If another process creates it during startup, the plugin loader can use it.
  }
}

ensureOpenClawDistExtensionsBridge();

function fetchInputUrl(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (input && typeof input === 'object' && typeof input.url === 'string') return input.url;
  return '';
}

function fetchMethod(input, init) {
  return String(init?.method || (input && typeof input === 'object' ? input.method : '') || 'GET').toUpperCase();
}

function isDiscordMessageDelivery(input, init) {
  const method = fetchMethod(input, init);
  if (method !== 'POST' && method !== 'PATCH') return false;

  try {
    const url = new URL(fetchInputUrl(input));
    if (!/(^|\.)discord(?:app)?\.com$/i.test(url.hostname)) return false;
    return /^\/api(?:\/v\d+)?\/channels\/\d+\/messages(?:\/\d+)?$/i.test(url.pathname)
      || /^\/api(?:\/v\d+)?\/webhooks\/\d+\/[^/]+(?:\/messages\/@original|\/messages\/\d+)?$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function hasDiscordPayloadBesidesContent(body) {
  return ['embeds', 'components', 'sticker_ids', 'attachments', 'files', 'poll'].some((key) => {
    const value = body?.[key];
    if (Array.isArray(value)) return value.length > 0;
    return value != null;
  });
}

function hasDiscordPayloadContent(body) {
  if (typeof body?.content === 'string' && body.content.trim()) return true;
  if (Array.isArray(body?.embeds) && body.embeds.some((embed) => {
    if (!embed || typeof embed !== 'object') return false;
    if (String(embed.title ?? '').trim() || String(embed.description ?? '').trim()) return true;
    return Array.isArray(embed.fields) && embed.fields.some((field) => String(field?.name ?? '').trim() || String(field?.value ?? '').trim());
  })) return true;
  return hasDiscordPayloadBesidesContent(body);
}

function discordChannelIdFromFetch(input) {
  try {
    const pathname = new URL(fetchInputUrl(input)).pathname;
    const match = pathname.match(/\/channels\/(\d+)\/messages\b/i);
    return match?.[1] || '';
  } catch {
    return '';
  }
}

async function dispatchPearlTaskFromDiscordText(content, channelId = '') {
  if (!DISCORD_TOOL_DISPATCH_ENABLED) return null;
  const taskText = extractPearlTaskDispatchText(content);
  if (!taskText) return null;
  const taskBody = [
    taskText,
    channelId ? `Discord source channel ${channelId}. Return final user-visible updates there.` : ''
  ].filter(Boolean).join('\n\n');
  try {
    await execFileAsync(PEARL_TASK_DISPATCH_BIN, [
      taskBody,
      '--source',
      'discord',
      '--created-by',
      'agency'
    ], {
      timeout: 20_000,
      env: process.env
    });
    return 'I routed that into tracked Agency work. The result will come back here when it finishes.';
  } catch (error) {
    console.warn(`Pearl Discord dispatch command failed: ${String(error).slice(0, 240)}`);
    return 'I caught a leaked dispatch command before posting it, but the task queue call failed. Send that once more and I will route it through the tracked path.';
  }
}

async function normalizeDiscordOutboundBody(body, input) {
  if (!body || typeof body !== 'object') {
    return { body, changed: false, suppress: false };
  }

  let changed = false;
  const next = { ...body };
  if (typeof next.content === 'string') {
    const dispatchReply = await dispatchPearlTaskFromDiscordText(
      next.content,
      discordChannelIdFromFetch(input)
    );
    const sanitized = sanitizePublicDiscordOutboundText(dispatchReply ?? next.content);
    if (sanitized !== next.content) {
      next.content = sanitized;
      changed = true;
    }
  }
  if (Array.isArray(next.embeds)) {
    const embeds = next.embeds.map(sanitizePublicDiscordEmbed);
    if (JSON.stringify(embeds) !== JSON.stringify(next.embeds)) {
      next.embeds = embeds;
      changed = true;
    }
  }
  if (!changed) return { body, changed: false, suppress: false };

  return {
    body: next,
    changed: true,
    suppress: !hasDiscordPayloadContent(next)
  };
}

export function isTelegramMessageDelivery(input, init) {
  const method = fetchMethod(input, init);
  if (method !== 'POST' && method !== 'PATCH') return false;

  try {
    const url = new URL(fetchInputUrl(input));
    if (!/^api\.telegram\.org$/i.test(url.hostname)) return false;
    return /^\/bot[^/]+\/(?:sendMessage|editMessageText|sendPhoto|sendDocument|sendVideo|sendAnimation|sendAudio|sendVoice|sendVideoNote|editMessageCaption)$/i.test(url.pathname);
  } catch {
    return false;
  }
}

export function normalizeTelegramOutboundBody(body) {
  if (!body || typeof body !== 'object') {
    return { body, changed: false };
  }

  let changed = false;
  const next = { ...body };

  if (typeof next.text === 'string') {
    const sanitized = sanitizePublicDiscordOutboundText(next.text);
    if (sanitized !== next.text) {
      next.text = sanitized.trim() || TELEGRAM_EMPTY_TEXT_FALLBACK;
      changed = true;
    }
  }

  if (typeof next.caption === 'string') {
    const sanitized = sanitizePublicDiscordOutboundText(next.caption);
    if (sanitized !== next.caption) {
      if (sanitized.trim()) next.caption = sanitized.trim();
      else delete next.caption;
      changed = true;
    }
  }

  return changed ? { body: next, changed: true } : { body, changed: false };
}

function isChatCompletionUrl(input) {
  const url = fetchInputUrl(input);
  return /\/(?:v1\/)?chat\/completions$/i.test(url);
}

function sanitizeCompletionPayload(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.choices)) return payload;
  let changed = false;
  const choices = payload.choices.map((choice) => {
    if (!choice || typeof choice !== 'object') return choice;
    const next = { ...choice };
    if (next.message && typeof next.message === 'object' && typeof next.message.content === 'string') {
      const sanitized = sanitizePublicDiscordOutboundText(next.message.content);
      if (sanitized !== next.message.content) {
        next.message = { ...next.message, content: sanitized };
        changed = true;
      }
    }
    return next;
  });
  return changed ? { ...payload, choices } : payload;
}

function sanitizeSseCompletionText(text) {
  if (typeof text !== 'string' || !text.includes('data:')) return text;
  return text.split(/(\r?\n)/).map((line) => {
    if (!line.startsWith('data:')) return line;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return line;
    try {
      return `data: ${JSON.stringify(sanitizeCompletionPayload(JSON.parse(data)))}`;
    } catch {
      return line;
    }
  }).join('');
}

function normalizeDeepseekMessage(message) {
  if (!message || typeof message !== 'object' || message.role === 'tool') return null;
  const next = { ...message };

  if (Array.isArray(next.content)) {
    const textParts = [];
    let omittedImages = 0;
    for (const part of next.content) {
      if (!part || typeof part !== 'object') continue;
      if (part.type === 'text') {
        textParts.push({ type: 'text', text: String(part.text ?? '') });
      } else if (part.type === 'image_url') {
        omittedImages += 1;
      }
    }
    if (omittedImages > 0) {
      textParts.push({
        type: 'text',
        text: `[${omittedImages} image attachment${omittedImages === 1 ? '' : 's'} omitted: current Pearl public Discord model is text-only.]`
      });
    }
    next.content = textParts.length > 0 ? textParts : '';
  }

  if (next.role === 'assistant') {
    delete next.tool_calls;
    if (next.content == null) next.content = '';
  }

  return next;
}

function normalizeDeepseekBody(body) {
  if (!body || typeof body !== 'object') return body;
  const model = String(body.model ?? '');
  if (!/\bdeepseek-v4-flash\b/i.test(model)) return body;

  const next = { ...body };
  delete next.tools;
  delete next.tool_choice;
  delete next.parallel_tool_calls;
  if (Array.isArray(next.messages)) {
    next.messages = next.messages.map(normalizeDeepseekMessage).filter(Boolean);
  }
  return next;
}

const originalFetch = globalThis.fetch;
if (typeof originalFetch === 'function' && !globalThis.__pearlOsDeepseekDiscordFetchPatch) {
  globalThis.__pearlOsDeepseekDiscordFetchPatch = true;
  globalThis.fetch = async function pearlOsDeepseekDiscordFetch(input, init) {
    if (init?.body && typeof init.body === 'string') {
      try {
        let parsed = JSON.parse(init.body);
        if (isDiscordMessageDelivery(input, init)) {
          const normalizedDiscord = await normalizeDiscordOutboundBody(parsed, input);
          if (normalizedDiscord.suppress) {
            return new Response(JSON.stringify({
              id: '0',
              type: 0,
              content: '',
              channel_id: new URL(fetchInputUrl(input)).pathname.split('/').at(-2) || null
            }), {
              status: 200,
              headers: { 'content-type': 'application/json' }
            });
          }
          if (normalizedDiscord.changed) {
            parsed = normalizedDiscord.body;
            init = { ...init, body: JSON.stringify(normalizedDiscord.body) };
          }
        }
        if (isTelegramMessageDelivery(input, init)) {
          const normalizedTelegram = normalizeTelegramOutboundBody(parsed);
          if (normalizedTelegram.changed) {
            parsed = normalizedTelegram.body;
            init = { ...init, body: JSON.stringify(normalizedTelegram.body) };
          }
        }
        const normalized = normalizeDeepseekBody(parsed);
        if (normalized !== parsed) {
          init = { ...init, body: JSON.stringify(normalized) };
        }
      } catch {
        // Non-JSON fetch bodies should pass through untouched.
      }
    }
    const response = await originalFetch.call(this, input, init);
    if (!isChatCompletionUrl(input)) return response;
    try {
      const contentType = response.headers?.get?.('content-type') ?? '';
      if (/text\/event-stream/i.test(contentType)) {
        const text = await response.clone().text();
        const sanitized = sanitizeSseCompletionText(text);
        if (sanitized === text) return response;
        return new Response(sanitized, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        });
      }
      if (!/json/i.test(contentType)) return response;
      const payload = await response.clone().json();
      const sanitized = sanitizeCompletionPayload(payload);
      if (sanitized === payload) return response;
      return new Response(JSON.stringify(sanitized), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      });
    } catch {
      return response;
    }
  };
}

register(pathToFileURL(loaderPath));
