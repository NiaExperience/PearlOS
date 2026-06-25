export const BlockType_DiscordDmVerification = 'DiscordDmVerification';

export interface IDiscordDmVerification {
  _id?: string;
  userId: string;
  discordUserId?: string;
  codeHash: string;
  issuedAt?: string;
  expiresAt: string;
  consumedAt?: string | null;
  attempts?: number;
}
