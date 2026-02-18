'use server';

import { compare, hash } from 'bcryptjs';
import { Prism } from '../../prism';
import { getSessionSafely } from '../auth';
import { AnonymousUserBlock, UserBlock } from '../blocks';
import { BlockType_User } from '../blocks/user.block';
import { ContentData } from '../content/types';
import { getLogger } from '../logger';
import { isValidUUID } from '../utils';
import { getAssistantBySubDomain } from './assistant-actions';
import { getUsersForTenant } from './tenant-actions';
import { NextAuthOptions } from 'next-auth';

const log = getLogger('prism:actions:user');

export async function getUsers(assistantName: string | undefined): Promise<UserBlock.IUser[]> {
  const prism = await Prism.getInstance();
  let users: UserBlock.IUser[] = [];
  if (assistantName) {
    const assistant = await getAssistantBySubDomain(assistantName);
    if (!assistant || !assistant._id) {
      log.warn('Assistant not found by subdomain', { assistantName });
      return [];
    }
    users = await getUsersForTenant(assistant._id as string);
  } else {
    const query = {
      contentType: BlockType_User,
      tenantId: 'any',
      where: {},
      orderBy: { createdAt: 'desc' as const },
    };
    const result = await prism.query(query);
    users = result.items as UserBlock.IUser[];
  }
  return users || [];
}

export async function getUserById(userId: string): Promise<UserBlock.IUser | null> {
  const prism = await Prism.getInstance();
  if (!userId || !isValidUUID(userId)) return null;
  const query = {
    contentType: BlockType_User,
    tenantId: 'any',
    where: { page_id: userId },
    orderBy: { createdAt: 'desc' as const },
  };
  const result = await prism.query(query);
  if (!result.items || result.items.length === 0) return null;
  return result.items[0] as UserBlock.IUser;
}

export async function getUserByEmail(email: string): Promise<UserBlock.IUser | null> {
  if (!email) {
    throw new Error('Email is required');
  }
  const prism = await Prism.getInstance();
  const query = {
    contentType: BlockType_User,
    tenantId: 'any',
    where: { indexer: { path: "email", equals: email.toLowerCase() } },
    orderBy: { createdAt: 'desc' as const },
  };
  const result = await prism.query(query);
  if (!result.items || result.items.length === 0) return null;
  return result.items[0] as UserBlock.IUser;
}

export async function getUserByName(name: string): Promise<UserBlock.IUser | null> {
  if (!name) {
    throw new Error('Name is required');
  }
  const prism = await Prism.getInstance();
  const query = {
    contentType: BlockType_User,
    tenantId: 'any',
    where: { indexer: { path: "name", equals: name.toLowerCase() } },
    orderBy: { createdAt: 'desc' as const },
  };
  const result = await prism.query(query);
  if (!result.items || result.items.length === 0) return null;
  return result.items[0] as UserBlock.IUser;
}

export async function getUserByPhoneNumber(phoneNumber: string, assistantId: string): Promise<UserBlock.IUser | null> {
  if (!phoneNumber) {
    throw new Error('Phone number is required');
  }
  if (!assistantId || !isValidUUID(assistantId)) {
    throw new Error('Assistant ID is required');
  }
  const prism = await Prism.getInstance();
  // Use direct field match for phone_number instead of indexer. phone_number may not be indexed
  // in some environments, so relying on indexer can cause false negatives.
  const query = {
    contentType: BlockType_User,
    tenantId: 'any',
    where: {
      OR: [
        { indexer: { path: "phone_number", equals: phoneNumber } },
        { indexer: { path: "phone_number", equals: `+${phoneNumber}` } } 
       ]
    },
    orderBy: { createdAt: 'desc' as const },
  } as any;
  let result = await prism.query(query);
  // Post-filter to ensure only users with an actual matching phone_number are considered
  const filtered = (result.items as UserBlock.IUser[] | undefined)?.filter(u => {
    const val = u.phone_number?.trim();
    return !!val && (val === phoneNumber || val === `+${phoneNumber}`);
  }) || [];
  if (filtered.length === 0) return null;
  return filtered[0] as UserBlock.IUser;
}

export async function createUser(userData: Omit<UserBlock.IUser, 'password_hash'> & { password?: string }): Promise<UserBlock.IUser> {
  const { password, ...rest } = userData;
  if (!rest.name) {
    throw new Error('Name is required');
  }
  if (!rest.email) {
    throw new Error('Email is required');
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(rest.email!)) {
    throw new Error('Invalid email');
  }
  const existingUser = await getUserByEmail(rest.email);
  if (existingUser) {
    throw new Error('User with this email already exists');
  }
  let password_hash;
  if (password && password.length > 0) {
    password_hash = await hash(password, 10);
  }
  const user: UserBlock.IUser = {
    ...rest,
    password_hash,
  };
  const prism = await Prism.getInstance();
  const created = await prism.create(BlockType_User, user, 'any');
  if (!created || created.total === 0 || created.items.length === 0) {
    throw new Error('Failed to create user');
  }
  return created.items[0] as unknown as UserBlock.IUser;
}

export async function getCurrentUser(authOptions: NextAuthOptions) {
  try {
    const session = await getSessionSafely(undefined, authOptions);
    if (!session || !session.user?.id) {
      throw new Error('Not authenticated');
    }
    const user = await getUserById(session.user.id);
    if (!user) {
      throw new Error('User not found');
    }
    return { success: true, data: user };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      statusCode: error.message === 'Not authenticated' ? 401 : 404,
    };
  }
}

export async function updateUser(userId: string, data: Omit<UserBlock.IUser, 'password_hash'> & { password?: string }) {
  try {
    if (!userId) {
      throw new Error('User ID is required');
    }
    if (!isValidUUID(userId)) {
      throw new Error('Invalid userId format');
    }
    const prism = await Prism.getInstance();
    const updateData: ContentData = { ...data };
    if (data.password) {
      const password_hash = await hash(data.password as string, 10);
      delete updateData.password; // Remove password from updateData
      updateData.password_hash = password_hash; // Add hashed password
    }
    const updated = await prism.update(BlockType_User, userId, updateData, 'any');
    if (!updated || updated.total === 0 || updated.items.length === 0) {
      throw new Error('User not found');
    }
    return { success: true, data: updated.items[0] as unknown as UserBlock.IUser };
  } catch (error: any) {
    const isNotFound = error.message === 'User not found' || error.message.includes('Content not found with id:');
    return {
      success: false,
      error: error.message,
      statusCode: isNotFound ? 404 : 400,
    };
  }
}

export async function deleteUser(userId: string) {
  try {
    if (!userId || !isValidUUID(userId)) {
      throw new Error('Invalid userId format');
    }
    const prism = await Prism.getInstance();
    const deleted = await prism.delete(BlockType_User, userId, 'any');
    if (!deleted) {
      throw new Error('User not found');
    }
    return { success: true, message: 'User deleted successfully' };
  } catch (error: any) {
    const isNotFound = error.message === 'User not found' || error.message.includes('Content not found with id:');
    return {
      success: false,
      error: error.message,
      statusCode: isNotFound ? 404 : 400,
    };
  }
}

export async function verifyUserPassword(userId: string, password: string): Promise<boolean> {
  try {
    const user = await getUserById(userId);
    if (!user || !user.password_hash) {
      return false;
    }
    return await compare(password, user.password_hash);
  } catch (error) {
    log.error('Error verifying user password', { userId, error });
    return false;
  }
}

export async function convertAnonymousUserToUser(anonymousUserId: string, userData: UserBlock.IUser): Promise<UserBlock.IUser> {
  if (userData.email) {
    const user = await getUserByEmail(userData.email);
    if (user) {
      return user;
    }
  }
  const prism = await Prism.getInstance();
  // Fetch anonymous user
  const query = {
    contentType: AnonymousUserBlock.BlockType,
    tenantId: 'any',
    where: { page_id: anonymousUserId },
    orderBy: { createdAt: 'desc' as const },
  };
  const result = await prism.query(query);
  if (!result.items || result.items.length === 0) {
    throw new Error('Anonymous user not found');
  }
  const anon = result.items[0] as AnonymousUserBlock.IAnonymousUser;
  const metadata = anon.metadata || undefined;
  userData.metadata = { ...userData.metadata, ...metadata };
  const newUser = await createUser(userData);
  await prism.delete(AnonymousUserBlock.BlockType, anonymousUserId, 'any');
  return newUser;
}