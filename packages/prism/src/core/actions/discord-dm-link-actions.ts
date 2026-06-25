'use server';

import { Prism } from '../../prism';
import { PrismContentQuery } from '../types';
import { isValidUUID } from '../utils';
import { BlockType_DiscordDmLink, IDiscordDmLink } from './discord-dm-link-constants';
import { getUserTenantRoles } from './tenant-actions';
import { getUserById } from './user-actions';

export async function getDiscordDmLinkById(id: string): Promise<IDiscordDmLink | null> {
  if (!id || !isValidUUID(id)) return null;
  const prism = await Prism.getInstance();
  const query: PrismContentQuery = {
    contentType: BlockType_DiscordDmLink,
    tenantId: 'any',
    where: { page_id: id },
    orderBy: { createdAt: 'desc' as const },
  };
  const result = await prism.query(query);
  return (result.items?.[0] as IDiscordDmLink) ?? null;
}

export async function getDiscordDmLinkByUser(userId: string): Promise<IDiscordDmLink | null> {
  if (!userId) return null;
  const prism = await Prism.getInstance();
  const query: PrismContentQuery = {
    contentType: BlockType_DiscordDmLink,
    tenantId: 'any',
    where: { parent_id: userId },
    orderBy: { createdAt: 'desc' as const },
  } as any;
  const result = await prism.query(query);
  const links = (result.items as IDiscordDmLink[]) || [];
  return links.find((link) => !link.revokedAt) ?? null;
}

async function listDiscordDmLinksByDiscordId(discordUserId: string): Promise<IDiscordDmLink[]> {
  if (!discordUserId) return [];
  const prism = await Prism.getInstance();
  const query: PrismContentQuery = {
    contentType: BlockType_DiscordDmLink,
    tenantId: 'any',
    where: { indexer: { path: 'discordUserId', equals: discordUserId } },
    orderBy: { createdAt: 'desc' as const },
  } as any;
  const result = await prism.query(query);
  return (result.items as IDiscordDmLink[]) || [];
}

export async function getDiscordDmLinkByDiscordId(discordUserId: string): Promise<IDiscordDmLink | null> {
  const links = await listDiscordDmLinksByDiscordId(discordUserId);
  return links.find((link) => !link.revokedAt) ?? null;
}

export async function getDiscordDmLinkedAccountScope(discordUserId: string): Promise<{
  discordUserId: string;
  userId: string;
  email: string;
  tenantId: string;
} | null> {
  const link = await getDiscordDmLinkByDiscordId(discordUserId);
  if (!link?.userId) return null;
  const user = await getUserById(link.userId);
  const email = typeof user?.email === 'string' ? user.email.trim().toLowerCase() : '';
  const roles = await getUserTenantRoles(link.userId);
  const tenantId = roles.find((role) => typeof role?.tenantId === 'string' && role.tenantId.trim())?.tenantId?.trim() || '';
  if (!email || !tenantId) return null;
  return {
    discordUserId: link.discordUserId,
    userId: link.userId,
    email,
    tenantId,
  };
}

export async function upsertDiscordDmLink(input: {
  userId: string;
  discordUserId: string;
}): Promise<IDiscordDmLink> {
  if (!input.userId) throw new Error('userId required');
  if (!input.discordUserId) throw new Error('discordUserId required');
  const current = await getDiscordDmLinkByUser(input.userId);
  const existingForDiscordLinks = await listDiscordDmLinksByDiscordId(input.discordUserId);
  const prism = await Prism.getInstance();
  const verifiedAt = new Date().toISOString();
  for (const existingForDiscord of existingForDiscordLinks) {
    if (!existingForDiscord?._id || existingForDiscord.revokedAt || existingForDiscord.userId === input.userId) continue;
    await prism.update(
      BlockType_DiscordDmLink,
      existingForDiscord._id,
      { revokedAt: verifiedAt },
      'any',
    );
  }
  if (current?._id) {
    const updated = await prism.update(
      BlockType_DiscordDmLink,
      current._id,
      {
        discordUserId: input.discordUserId,
        verifiedAt,
        revokedAt: null,
      },
      'any',
    );
    if (updated.items?.[0]) return updated.items[0] as IDiscordDmLink;
  }

  const created = await prism.create(
    BlockType_DiscordDmLink,
    {
      userId: input.userId,
      discordUserId: input.discordUserId,
      verifiedAt,
    },
    'any',
  );
  if (!created.items?.[0]) throw new Error('Failed to create Discord DM link');
  return created.items[0] as IDiscordDmLink;
}

export async function revokeDiscordDmLink(userId: string): Promise<boolean> {
  const current = await getDiscordDmLinkByUser(userId);
  if (!current?._id) return false;
  const prism = await Prism.getInstance();
  const updated = await prism.update(
    BlockType_DiscordDmLink,
    current._id,
    { revokedAt: new Date().toISOString() },
    'any',
  );
  return Boolean(updated.items?.[0]);
}
