/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable no-console */
'use server';

import { randomUUID } from 'crypto';

import { LinkMapDefinition } from '@nia/features/definitions';
import { Prism } from '@nia/prism';

export interface LinkMapInput {
    json: any;
    ttl?: number;
}

export interface LinkMapRecord {
    _id?: string;
    key: string;
    json: string;
    createdAt: string;
    expiresAt?: string;
}


/**
 * Creates a new LinkMap record (short URL).
 */
export async function createLinkMap(data: LinkMapInput): Promise<LinkMapRecord> {
    const { ttl } = data;

    const prism = await Prism.getInstance();

    // Generate a short key. 
    // Using a slice of a UUID for reasonable uniqueness and shortness, 
    // or a full UUID base64url encoded if collision resistance is critical.
    // For now, let's use a random 12-char string (base64url of 9 random bytes).
    const buffer = Buffer.alloc(9);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const randomBytes = require('crypto').randomFillSync(buffer);
    const key = randomBytes.toString('base64url');

    const now = new Date();
    const expiresAt = ttl ? new Date(now.getTime() + ttl * 1000).toISOString() : undefined;

    const record: LinkMapRecord = {
        key,
        json: JSON.stringify(data.json),
        createdAt: now.toISOString(),
        expiresAt,
    };

    const result = await prism.create(LinkMapDefinition.dataModel.block, record);
    if (!result || result.items.length === 0) {
        throw new Error('Failed to create LinkMap record');
    }
    return result.items[0];
}

/**
 * Retrieves a LinkMap record by its page_id.
 * Note: This needs to search across tenants if the link is public/shared globally.
 * However, Prism usually requires a tenantId context.
 * If we store all LinkMaps under a specific tenant (e.g. 'any' or the creator's), 
 * we need to know how to query it.
 * 
 * If we use 'any' as tenantId for lookup, Prism might support it if configured.
 * Otherwise, we might need to query without tenantId filter if Prism allows.
 */
export async function getLinkMapByKey(key: string): Promise<LinkMapRecord | null> {
    // We use 'any' tenantId to allow resolving links from any tenant
    // This assumes the underlying Prism/DB layer supports 'any' or we have a way to query globally.
    // Based on previous context (ResourceShareToken), 'any' seems supported for some lookups.

    const prism = await Prism.getInstance();
    const result = await prism.query({
        contentType: LinkMapDefinition.dataModel.block,
        tenantId: 'any',
        where: { indexer: { path: 'key', equals: key } },
        limit: 1
    } as any);

    if (result && result.items.length > 0) {
        return result.items[0];
    }
    return null;
}

export async function deleteLinkMap(id: string) {
    const prism = await Prism.getInstance();
    await prism.delete(LinkMapDefinition.dataModel.block, id);
}

export async function listLinkMaps(limit = 20, offset = 0) {
    const prism = await Prism.getInstance();
    return prism.query({
        contentType: LinkMapDefinition.dataModel.block,
        tenantId: 'any',
        limit,
        offset,
        sort: { createdAt: 'desc' }
    } as any);
}
