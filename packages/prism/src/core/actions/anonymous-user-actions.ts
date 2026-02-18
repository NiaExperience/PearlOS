'use server';

import { v4 as uuidv4 } from 'uuid';

import { Prism } from '../../prism';
import { BlockType as AnonymousUserBlockType, IAnonymousUser } from '../blocks/anonymousUser.block';
import { IUserMessageStore } from '../blocks/user.block';
import { getLogger } from '../logger';

const log = getLogger('prism:actions:anonymous-user');


export async function createAnonymousUser(): Promise<IAnonymousUser> {
  const prism = await Prism.getInstance();
  
  // Generate a new session ID for the anonymous user
  const anonymousUser: IAnonymousUser = {
    sessionId: uuidv4()
  };

  // Save to database
  const created = await prism.create(AnonymousUserBlockType, anonymousUser, 'any');
  if (!created || created.total === 0 || created.items.length === 0) {
    throw new Error('Failed to create anonymous user');
  }
  return created.items[0] as unknown as IAnonymousUser;
}

export async function deleteAnonymousUser(sessionId: string): Promise<IAnonymousUser | null> {
  const prism = await Prism.getInstance();
  
  if (!sessionId) {
    throw new Error('Session ID is required');
  }
  
  const query = {
    contentType: AnonymousUserBlockType,
    tenantId: 'any',
    where: { indexer: { path: "sessionId", equals: sessionId } },
    orderBy: { createdAt: 'desc' as const },
  };
  
  const result = await prism.query(query);
  if (!result.items || result.items.length === 0) {
    log.warn('Anonymous user not found', { sessionId });
    return null;
  }
  
  const anonymousUser = result.items[0];
  if (!anonymousUser._id) {
    log.warn('Anonymous user not found', { sessionId });
    return null;
  }
  
  // Delete from database
  const deleted = await prism.delete(AnonymousUserBlockType, anonymousUser._id, 'any');
  if (!deleted) {
    throw new Error('Failed to delete anonymous user');
  }
  
  return deleted as unknown as IAnonymousUser;
}

export async function getAnonymousUserById(anonymousUserId: string): Promise<IAnonymousUser | null> {
  const prism = await Prism.getInstance();
  if (!anonymousUserId) return null;
  const query = {
    contentType: AnonymousUserBlockType,
    tenantId: 'any',
    where: { page_id: anonymousUserId },
    orderBy: { createdAt: 'desc' as const },
  };
  const result = await prism.query(query);
  if (!result.items || result.items.length === 0) return null;
  return result.items[0] as IAnonymousUser;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function migrateAnonymousUserData(sessionId: string): Promise<IUserMessageStore | null> {
  const prism = await Prism.getInstance();
  
  if (!sessionId) {
    throw new Error('Session ID is required');
  }
  
  const query = {
    contentType: AnonymousUserBlockType,
    tenantId: 'any',
    where: { parent_id: sessionId },
    orderBy: { createdAt: 'desc' as const },
  };
  
  const result = await prism.query(query);
  if (!result.items || result.items.length === 0) {
    throw new Error('Anonymous user not found');
  }
  
  const anonymousUser = result.items[0];
  if (!anonymousUser._id) {
    throw new Error('Anonymous user not found');
  }
  
  // copy the IUserMessageStore bits from the anonymous user to a new IUser
  const userMessageStore : IUserMessageStore = {
    messages: anonymousUser.messages || [],
    chatHistory: anonymousUser.chatHistory || [],
    eventHistory: anonymousUser.eventHistory || [],
  };
  return userMessageStore;
}