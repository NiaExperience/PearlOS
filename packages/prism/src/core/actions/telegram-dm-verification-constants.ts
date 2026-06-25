export const BlockType_TelegramDmVerification = 'TelegramDmVerification';

export interface ITelegramDmVerification {
  _id?: string;
  userId: string;
  phoneNumber?: string | null;
  telegramUserId?: string;
  telegramChatId?: string;
  telegramUsername?: string | null;
  codeHash?: string;
  startTokenHash: string;
  startTokenIssuedAt?: string;
  claimedAt?: string | null;
  issuedAt?: string;
  expiresAt: string;
  consumedAt?: string | null;
  attempts?: number;
}
