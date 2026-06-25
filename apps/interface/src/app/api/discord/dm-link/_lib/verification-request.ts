import { generateDiscordCode, hashDiscordCode } from '@interface/lib/discord-dm-code';
import {
  createDiscordDmVerification,
  listDiscordDmVerificationsForUser,
} from '@nia/prism/core/actions/discord-dm-verification-actions';
import type { IDiscordDmVerification } from '@nia/prism/core/actions/discord-dm-verification-constants';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MAX_ACTIVE_PER_HOUR = 5;

export class DiscordDmVerificationRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'DiscordDmVerificationRequestError';
    this.status = status;
  }
}

export async function issueDiscordDmVerificationCode(input: {
  userId: string;
  discordUserId?: string;
}): Promise<{ code: string; expiresAt: string; codeSent: false }> {
  const discordUserId = input.discordUserId?.trim() || '';
  if (discordUserId && !/^\d{17,20}$/.test(discordUserId)) {
    throw new DiscordDmVerificationRequestError(
      'Invalid Discord user ID. Use your numeric Discord ID.',
      400,
    );
  }

  const now = Date.now();
  const existing = await listDiscordDmVerificationsForUser(input.userId);
  const activeRecentCount = existing.filter((item: IDiscordDmVerification) => {
    if (item.consumedAt) return false;
    const issuedAt = item.issuedAt ? new Date(item.issuedAt).getTime() : 0;
    const expiresAt = new Date(item.expiresAt).getTime();
    return expiresAt > now && issuedAt >= now - HOUR_MS;
  }).length;

  if (activeRecentCount >= MAX_ACTIVE_PER_HOUR) {
    throw new DiscordDmVerificationRequestError('Too many requests. Try again in about an hour.', 429);
  }

  const code = generateDiscordCode();
  const expiresAt = new Date(now + DAY_MS).toISOString();

  await createDiscordDmVerification({
    userId: input.userId,
    ...(discordUserId ? { discordUserId } : {}),
    codeHash: hashDiscordCode(code),
    expiresAt,
    attempts: 0,
    issuedAt: new Date(now).toISOString(),
  });

  return { code, expiresAt, codeSent: false };
}
