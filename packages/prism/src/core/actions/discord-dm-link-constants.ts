export const BlockType_DiscordDmLink = 'DiscordDmLink';

export interface IDiscordDmLink {
  _id?: string;
  userId: string;
  discordUserId: string;
  verifiedAt: string;
  revokedAt?: string | null;
}
