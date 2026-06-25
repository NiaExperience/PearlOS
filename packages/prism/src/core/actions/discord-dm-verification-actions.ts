'use server';

import { Prism } from '../../prism';
import { PrismContentQuery } from '../types';
import { isValidUUID } from '../utils';
import {
  BlockType_DiscordDmVerification,
  IDiscordDmVerification,
} from './discord-dm-verification-constants';

export async function createDiscordDmVerification(
  data: IDiscordDmVerification,
): Promise<IDiscordDmVerification> {
  if (!data.userId) throw new Error('userId required');
  if (!data.codeHash) throw new Error('codeHash required');
  if (!data.expiresAt) throw new Error('expiresAt required');

  const prism = await Prism.getInstance();
  const payload = {
    ...data,
    attempts: data.attempts ?? 0,
    issuedAt: data.issuedAt ?? new Date().toISOString(),
  };
  const created = await prism.create(BlockType_DiscordDmVerification, payload, 'any');
  if (!created || created.total === 0 || created.items.length === 0) {
    throw new Error('Failed to create Discord verification');
  }
  return created.items[0] as IDiscordDmVerification;
}

export async function getDiscordDmVerificationById(id: string): Promise<IDiscordDmVerification | null> {
  if (!id || !isValidUUID(id)) return null;
  const prism = await Prism.getInstance();
  const query: PrismContentQuery = {
    contentType: BlockType_DiscordDmVerification,
    tenantId: 'any',
    where: { page_id: id },
    orderBy: { createdAt: 'desc' as const },
  };
  const result = await prism.query(query);
  return (result.items?.[0] as IDiscordDmVerification) ?? null;
}

export async function listDiscordDmVerificationsForUser(userId: string): Promise<IDiscordDmVerification[]> {
  if (!userId) return [];
  const prism = await Prism.getInstance();
  const query: PrismContentQuery = {
    contentType: BlockType_DiscordDmVerification,
    tenantId: 'any',
    where: { parent_id: userId },
    orderBy: { createdAt: 'desc' as const },
  } as any;
  const result = await prism.query(query);
  return (result.items as IDiscordDmVerification[]) || [];
}

export async function getActiveDiscordDmVerification(
  userId: string,
  now: Date = new Date(),
): Promise<IDiscordDmVerification | null> {
  const list = await listDiscordDmVerificationsForUser(userId);
  return (
    list.find((item) => !item.consumedAt && new Date(item.expiresAt).getTime() > now.getTime()) ??
    null
  );
}

export async function getActiveDiscordDmVerificationByCodeHash(
  codeHash: string,
  now: Date = new Date(),
): Promise<IDiscordDmVerification | null> {
  if (!codeHash) return null;
  const prism = await Prism.getInstance();
  const query: PrismContentQuery = {
    contentType: BlockType_DiscordDmVerification,
    tenantId: 'any',
    where: { indexer: { path: 'codeHash', equals: codeHash } },
    orderBy: { createdAt: 'desc' as const },
  } as any;
  const result = await prism.query(query);
  const verifications = (result.items as IDiscordDmVerification[]) || [];
  return (
    verifications.find(
      (item) => !item.consumedAt && new Date(item.expiresAt).getTime() > now.getTime(),
    ) ?? null
  );
}

export async function updateDiscordDmVerification(
  id: string,
  updatePayload: Partial<IDiscordDmVerification>,
): Promise<IDiscordDmVerification | null> {
  if (!id || !isValidUUID(id)) return null;
  const prism = await Prism.getInstance();
  const updated = await prism.update(BlockType_DiscordDmVerification, id, updatePayload, 'any');
  return (updated.items?.[0] as IDiscordDmVerification) ?? null;
}

export async function markDiscordDmVerificationConsumed(
  id: string,
): Promise<IDiscordDmVerification | null> {
  if (!id || !isValidUUID(id)) return null;
  const current = await getDiscordDmVerificationById(id);
  if (!current || current.consumedAt) return null;
  const prism = await Prism.getInstance();
  const updated = await prism.update(
    BlockType_DiscordDmVerification,
    id,
    { consumedAt: new Date().toISOString() },
    'any',
  );
  return (updated.items?.[0] as IDiscordDmVerification) ?? null;
}

export async function incrementDiscordDmVerificationAttempt(
  id: string,
): Promise<IDiscordDmVerification | null> {
  if (!id || !isValidUUID(id)) return null;
  const current = await getDiscordDmVerificationById(id);
  if (!current) return null;
  const attempts = (current.attempts ?? 0) + 1;
  const updatePayload: Partial<IDiscordDmVerification> = { attempts };
  if (attempts >= 5 && !current.consumedAt) {
    updatePayload.consumedAt = new Date().toISOString();
  }
  const prism = await Prism.getInstance();
  const updated = await prism.update(BlockType_DiscordDmVerification, id, updatePayload, 'any');
  return (updated.items?.[0] as IDiscordDmVerification) ?? null;
}
