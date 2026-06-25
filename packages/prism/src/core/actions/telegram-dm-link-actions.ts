'use server';

import { Prism } from '../../prism';
import { PrismContentQuery } from '../types';
import { isValidUUID } from '../utils';
import { BlockType_TelegramDmLink, ITelegramDmLink } from './telegram-dm-link-constants';

export async function getTelegramDmLinkById(id: string): Promise<ITelegramDmLink | null> {
  if (!id || !isValidUUID(id)) return null;
  const prism = await Prism.getInstance();
  const query: PrismContentQuery = {
    contentType: BlockType_TelegramDmLink,
    tenantId: 'any',
    where: { page_id: id },
    orderBy: { createdAt: 'desc' as const },
  };
  const result = await prism.query(query);
  return (result.items?.[0] as ITelegramDmLink) ?? null;
}

export async function getTelegramDmLinkByUser(userId: string): Promise<ITelegramDmLink | null> {
  if (!userId) return null;
  const prism = await Prism.getInstance();
  const query: PrismContentQuery = {
    contentType: BlockType_TelegramDmLink,
    tenantId: 'any',
    where: { parent_id: userId },
    orderBy: { createdAt: 'desc' as const },
  } as any;
  const result = await prism.query(query);
  const links = (result.items as ITelegramDmLink[]) || [];
  return links.find((link) => !link.revokedAt) ?? null;
}

export async function getTelegramDmLinkByTelegramId(telegramUserId: string): Promise<ITelegramDmLink | null> {
  if (!telegramUserId) return null;
  const prism = await Prism.getInstance();
  const query: PrismContentQuery = {
    contentType: BlockType_TelegramDmLink,
    tenantId: 'any',
    where: { indexer: { path: 'telegramUserId', equals: telegramUserId } },
    orderBy: { createdAt: 'desc' as const },
  } as any;
  const result = await prism.query(query);
  const links = (result.items as ITelegramDmLink[]) || [];
  return links.find((link) => !link.revokedAt) ?? null;
}

export async function getTelegramDmLinkByPhoneNumber(phoneNumber: string): Promise<ITelegramDmLink | null> {
  if (!phoneNumber) return null;
  const prism = await Prism.getInstance();
  const query: PrismContentQuery = {
    contentType: BlockType_TelegramDmLink,
    tenantId: 'any',
    where: { indexer: { path: 'phoneNumber', equals: phoneNumber } },
    orderBy: { createdAt: 'desc' as const },
  } as any;
  const result = await prism.query(query);
  const links = (result.items as ITelegramDmLink[]) || [];
  return links.find((link) => !link.revokedAt) ?? null;
}

export async function upsertTelegramDmLink(input: {
  userId: string;
  phoneNumber?: string | null;
  telegramUserId: string;
  telegramChatId: string;
  telegramUsername?: string | null;
}): Promise<ITelegramDmLink> {
  if (!input.userId) throw new Error('userId required');
  if (!input.telegramUserId) throw new Error('telegramUserId required');
  if (!input.telegramChatId) throw new Error('telegramChatId required');

  const current = await getTelegramDmLinkByUser(input.userId);
  const prism = await Prism.getInstance();
  const verifiedAt = new Date().toISOString();
  if (current?._id) {
    const updated = await prism.update(
      BlockType_TelegramDmLink,
      current._id,
      {
        ...(input.phoneNumber ? { phoneNumber: input.phoneNumber } : {}),
        telegramUserId: input.telegramUserId,
        telegramChatId: input.telegramChatId,
        telegramUsername: input.telegramUsername ?? null,
        verifiedAt,
        revokedAt: null,
      },
      'any',
    );
    if (updated.items?.[0]) return updated.items[0] as ITelegramDmLink;
  }

  const created = await prism.create(
    BlockType_TelegramDmLink,
    {
      userId: input.userId,
      ...(input.phoneNumber ? { phoneNumber: input.phoneNumber } : {}),
      telegramUserId: input.telegramUserId,
      telegramChatId: input.telegramChatId,
      telegramUsername: input.telegramUsername ?? null,
      verifiedAt,
    },
    'any',
  );
  if (!created.items?.[0]) throw new Error('Failed to create Telegram DM link');
  return created.items[0] as ITelegramDmLink;
}

export async function revokeTelegramDmLink(userId: string): Promise<boolean> {
  const current = await getTelegramDmLinkByUser(userId);
  if (!current?._id) return false;
  const prism = await Prism.getInstance();
  const updated = await prism.update(
    BlockType_TelegramDmLink,
    current._id,
    { revokedAt: new Date().toISOString() },
    'any',
  );
  return Boolean(updated.items?.[0]);
}
