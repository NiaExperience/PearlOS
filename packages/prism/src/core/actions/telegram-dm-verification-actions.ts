'use server';

import { Prism } from '../../prism';
import { PrismContentQuery } from '../types';
import { isValidUUID } from '../utils';
import {
  BlockType_TelegramDmVerification,
  ITelegramDmVerification,
} from './telegram-dm-verification-constants';

export async function createTelegramDmVerification(
  data: ITelegramDmVerification,
): Promise<ITelegramDmVerification> {
  if (!data.userId) throw new Error('userId required');
  if (!data.startTokenHash) throw new Error('startTokenHash required');
  if (!data.expiresAt) throw new Error('expiresAt required');

  const prism = await Prism.getInstance();
  const payload = {
    ...data,
    attempts: data.attempts ?? 0,
    issuedAt: data.issuedAt ?? new Date().toISOString(),
  };
  const created = await prism.create(BlockType_TelegramDmVerification, payload, 'any');
  if (!created || created.total === 0 || created.items.length === 0) {
    throw new Error('Failed to create Telegram verification');
  }
  return created.items[0] as ITelegramDmVerification;
}

export async function getTelegramDmVerificationById(id: string): Promise<ITelegramDmVerification | null> {
  if (!id || !isValidUUID(id)) return null;
  const prism = await Prism.getInstance();
  const query: PrismContentQuery = {
    contentType: BlockType_TelegramDmVerification,
    tenantId: 'any',
    where: { page_id: id },
    orderBy: { createdAt: 'desc' as const },
  };
  const result = await prism.query(query);
  return (result.items?.[0] as ITelegramDmVerification) ?? null;
}

export async function listTelegramDmVerificationsForUser(userId: string): Promise<ITelegramDmVerification[]> {
  if (!userId) return [];
  const prism = await Prism.getInstance();
  const query: PrismContentQuery = {
    contentType: BlockType_TelegramDmVerification,
    tenantId: 'any',
    where: { parent_id: userId },
    orderBy: { createdAt: 'desc' as const },
  } as any;
  const result = await prism.query(query);
  return (result.items as ITelegramDmVerification[]) || [];
}

export async function getActiveTelegramDmVerification(
  userId: string,
  now: Date = new Date(),
): Promise<ITelegramDmVerification | null> {
  const list = await listTelegramDmVerificationsForUser(userId);
  return (
    list.find((item) => !item.consumedAt && new Date(item.expiresAt).getTime() > now.getTime()) ??
    null
  );
}

export async function getActiveTelegramDmVerificationByStartToken(
  userId: string,
  startTokenHash: string,
  now: Date = new Date(),
): Promise<ITelegramDmVerification | null> {
  if (!userId || !startTokenHash) return null;
  const list = await listTelegramDmVerificationsForUser(userId);
  return (
    list.find(
      (item) =>
        item.startTokenHash === startTokenHash &&
        !item.consumedAt &&
        new Date(item.expiresAt).getTime() > now.getTime(),
    ) ?? null
  );
}

export async function getActiveTelegramDmVerificationByCodeHash(
  codeHash: string,
  now: Date = new Date(),
): Promise<ITelegramDmVerification | null> {
  if (!codeHash) return null;
  const prism = await Prism.getInstance();
  const query: PrismContentQuery = {
    contentType: BlockType_TelegramDmVerification,
    tenantId: 'any',
    where: { indexer: { path: 'codeHash', equals: codeHash } },
    orderBy: { createdAt: 'desc' as const },
  } as any;
  const result = await prism.query(query);
  const verifications = (result.items as ITelegramDmVerification[]) || [];
  return (
    verifications.find(
      (item) => !item.consumedAt && new Date(item.expiresAt).getTime() > now.getTime(),
    ) ?? null
  );
}

export async function updateTelegramDmVerification(
  id: string,
  updatePayload: Partial<ITelegramDmVerification>,
): Promise<ITelegramDmVerification | null> {
  if (!id || !isValidUUID(id)) return null;
  const prism = await Prism.getInstance();
  const updated = await prism.update(BlockType_TelegramDmVerification, id, updatePayload, 'any');
  return (updated.items?.[0] as ITelegramDmVerification) ?? null;
}

export async function markTelegramDmVerificationConsumed(
  id: string,
): Promise<ITelegramDmVerification | null> {
  if (!id || !isValidUUID(id)) return null;
  const current = await getTelegramDmVerificationById(id);
  if (!current || current.consumedAt) return null;
  const prism = await Prism.getInstance();
  const updated = await prism.update(
    BlockType_TelegramDmVerification,
    id,
    { consumedAt: new Date().toISOString() },
    'any',
  );
  return (updated.items?.[0] as ITelegramDmVerification) ?? null;
}

export async function incrementTelegramDmVerificationAttempt(
  id: string,
): Promise<ITelegramDmVerification | null> {
  if (!id || !isValidUUID(id)) return null;
  const current = await getTelegramDmVerificationById(id);
  if (!current) return null;
  const attempts = (current.attempts ?? 0) + 1;
  const updatePayload: Partial<ITelegramDmVerification> = { attempts };
  if (attempts >= 5 && !current.consumedAt) {
    updatePayload.consumedAt = new Date().toISOString();
  }
  const prism = await Prism.getInstance();
  const updated = await prism.update(BlockType_TelegramDmVerification, id, updatePayload, 'any');
  return (updated.items?.[0] as ITelegramDmVerification) ?? null;
}
