import fs from 'node:fs/promises';

type TelegramUser = {
  id?: number;
  is_bot?: boolean;
  first_name?: string;
  username?: string;
};

type TelegramChat = {
  id?: number;
  type?: string;
};

type TelegramContact = {
  phone_number?: string;
  user_id?: number;
};

type TelegramMessage = {
  message_id?: number;
  from?: TelegramUser;
  chat?: TelegramChat;
  text?: string;
  contact?: TelegramContact;
};

type TelegramUpdate = {
  update_id?: number;
  message?: TelegramMessage;
};

type TelegramResponse<T> = {
  ok?: boolean;
  result?: T;
  description?: string;
};

export type TelegramContactMatch = {
  telegramUserId: string;
  telegramChatId: string;
  telegramUsername?: string | null;
  firstName?: string | null;
};

const OPENCLAW_CONFIG_PATH = process.env.OPENCLAW_CONFIG_PATH || '/root/.openclaw/openclaw.json';

export function normalizeTelegramPhone(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const leadingPlus = trimmed.startsWith('+');
  let digits = trimmed.replace(/[^\d]/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length < 8 || digits.length > 15) return null;
  return `${leadingPlus ? '+' : '+'}${digits}`;
}

function phoneDigits(input: string | undefined): string {
  if (!input) return '';
  let digits = input.replace(/[^\d]/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  return digits;
}

async function readTelegramToken(): Promise<string> {
  const envToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (envToken) return envToken;
  try {
    const raw = await fs.readFile(OPENCLAW_CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const token =
      parsed?.channels?.telegram?.token ||
      parsed?.channels?.telegram?.botToken ||
      parsed?.env?.TELEGRAM_BOT_TOKEN ||
      parsed?.plugins?.entries?.telegram?.config?.token ||
      parsed?.plugins?.entries?.telegram?.config?.botToken;
    if (typeof token === 'string' && token.trim()) return token.trim();
  } catch {
    // Fall through to a clear caller-facing error.
  }
  throw new Error('Telegram bot token is not configured.');
}

export async function telegramApi<T>(method: string, payload: Record<string, unknown> = {}): Promise<T> {
  const token = await readTelegramToken();
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });
  const data = (await res.json().catch(() => null)) as TelegramResponse<T> | null;
  if (!res.ok || !data?.ok) {
    throw new Error(data?.description || `Telegram API ${method} failed`);
  }
  return data.result as T;
}

export async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
  await telegramApi('sendMessage', {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  });
}

export async function resolveTelegramContactByPhone(phoneNumber: string): Promise<TelegramContactMatch | null> {
  const targetDigits = phoneDigits(phoneNumber);
  if (!targetDigits) return null;
  const updates = await telegramApi<TelegramUpdate[]>('getUpdates', {
    limit: 100,
    allowed_updates: ['message'],
  });

  for (const update of [...(updates || [])].reverse()) {
    const msg = update.message;
    if (!msg?.chat?.id || msg.chat.type !== 'private' || !msg.from?.id) continue;
    const contactDigits = phoneDigits(msg.contact?.phone_number);
    const textDigits = phoneDigits(msg.text);
    const contactUserMatches = !msg.contact?.user_id || msg.contact.user_id === msg.from.id;
    const phoneMatches =
      (contactDigits && contactDigits === targetDigits && contactUserMatches) ||
      (textDigits && textDigits === targetDigits);
    if (!phoneMatches) continue;
    return {
      telegramUserId: String(msg.from.id),
      telegramChatId: String(msg.chat.id),
      telegramUsername: msg.from.username ?? null,
      firstName: msg.from.first_name ?? null,
    };
  }

  return null;
}

export async function resolveTelegramStartTokenClaim(
  startPayload: string,
): Promise<TelegramContactMatch | null> {
  const payload = startPayload.trim();
  if (!payload) return null;
  const updates = await telegramApi<TelegramUpdate[]>('getUpdates', {
    limit: 100,
    allowed_updates: ['message'],
  });

  for (const update of [...(updates || [])].reverse()) {
    const msg = update.message;
    if (!msg?.chat?.id || msg.chat.type !== 'private' || !msg.from?.id) continue;
    const text = msg.text?.trim();
    if (!text?.startsWith('/start')) continue;
    const parts = text.split(/\s+/);
    const candidate = parts[1]?.trim();
    if (!candidate || candidate !== payload) continue;
    return {
      telegramUserId: String(msg.from.id),
      telegramChatId: String(msg.chat.id),
      telegramUsername: msg.from.username ?? null,
      firstName: msg.from.first_name ?? null,
    };
  }

  return null;
}
