export const BlockType_TelegramDmLink = 'TelegramDmLink';

export interface ITelegramDmLink {
  _id?: string;
  userId: string;
  phoneNumber?: string | null;
  telegramUserId: string;
  telegramChatId: string;
  telegramUsername?: string | null;
  verifiedAt: string;
  revokedAt?: string | null;
}
