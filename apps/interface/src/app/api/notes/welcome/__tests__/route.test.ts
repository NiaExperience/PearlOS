import { NextResponse } from 'next/server';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { POST } from '../route';

const mockPrismQuery = jest.fn();
const mockCreateNote = jest.fn();
const mockGetAssistantBySubDomain = jest.fn();
const mockGetAssistantByName = jest.fn();
const mockResolveInterfaceActorContext = jest.fn();
const testRoot = path.join(os.tmpdir(), 'pearlos-notes-welcome-route-test');

jest.mock('@nia/prism', () => ({
  Prism: {
    getInstance: jest.fn().mockResolvedValue({
      query: (...args: unknown[]) => mockPrismQuery(...args),
    }),
  },
}));

jest.mock('@nia/prism/core/actions/assistant-actions', () => ({
  getAssistantBySubDomain: (...args: unknown[]) => mockGetAssistantBySubDomain(...args),
  getAssistantByName: (...args: unknown[]) => mockGetAssistantByName(...args),
}));

jest.mock('@interface/features/Notes/actions/notes-actions', () => ({
  createNote: (...args: unknown[]) => mockCreateNote(...args),
}));

jest.mock('@interface/features/Notes/lib/welcome-note', () => ({
  WELCOME_NOTE_TITLE: 'Welcome to PearlOS',
  getWelcomeNoteContent: jest.fn(() => ({
    title: 'Welcome to PearlOS',
    content: 'Start here.',
  })),
}));

jest.mock('@interface/lib/tenant-actor', () => ({
  resolveInterfaceActorContext: (...args: unknown[]) => mockResolveInterfaceActorContext(...args),
}));

describe('/api/notes/welcome', () => {
  beforeEach(() => {
    fs.rmSync(testRoot, { force: true, recursive: true });
    process.env.PEARLOS_USER_ROOT = testRoot;
    jest.clearAllMocks();
    mockPrismQuery.mockResolvedValue({ items: [] });
    mockCreateNote.mockResolvedValue({ _id: 'note-1' });
    mockGetAssistantBySubDomain.mockResolvedValue(null);
    mockGetAssistantByName.mockResolvedValue(null);
    mockResolveInterfaceActorContext.mockResolvedValue({
      ok: true,
      actor: {
        userId: 'user-1',
        userEmail: 'sam@example.com',
        userName: 'Sam',
        tenantId: 'tenant-a',
        tenantRole: 'member',
      },
    });
  });

  afterEach(() => {
    fs.rmSync(testRoot, { force: true, recursive: true });
    delete process.env.PEARLOS_USER_ROOT;
  });

  it('creates the welcome note in the resolved actor tenant, not the caller tenant', async () => {
    const response = await POST({
      headers: new Headers(),
      json: async () => ({ tenantId: 'tenant-spoof' }),
    } as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockResolveInterfaceActorContext).toHaveBeenCalledWith({ requestedTenantId: 'tenant-spoof' });
    expect(mockPrismQuery).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          { parent_id: { eq: 'user-1' } },
          { indexer: { path: 'title', equals: 'Welcome to PearlOS' } },
        ]),
      }),
    }));
    expect(mockCreateNote).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', title: 'Welcome to PearlOS' }),
      'tenant-a',
    );
  });

  it('does not query or create when the requested tenant is forbidden', async () => {
    mockResolveInterfaceActorContext.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: 'tenant_forbidden' }, { status: 403 }),
    });

    const response = await POST({
      headers: new Headers(),
      json: async () => ({ tenantId: 'tenant-b' }),
    } as any);

    expect(response.status).toBe(403);
    expect(mockPrismQuery).not.toHaveBeenCalled();
    expect(mockCreateNote).not.toHaveBeenCalled();
  });

  it('authorizes assistant-derived tenant scope before writing', async () => {
    mockGetAssistantBySubDomain.mockResolvedValueOnce({ tenantId: 'tenant-from-assistant' });

    await POST({
      headers: new Headers({ referer: 'https://acme.pearlos.example/home' }),
      json: async () => ({}),
    } as any);

    expect(mockGetAssistantBySubDomain).toHaveBeenCalledWith('acme');
    expect(mockResolveInterfaceActorContext).toHaveBeenCalledWith({
      requestedTenantId: 'tenant-from-assistant',
    });
    expect(mockCreateNote).toHaveBeenCalledWith(expect.any(Object), 'tenant-a');
  });

  it('returns early when the welcome note already exists', async () => {
    mockPrismQuery.mockResolvedValueOnce({
      items: [{ title: 'Welcome to PearlOS' }],
    });

    const response = await POST({
      headers: new Headers(),
      json: async () => ({ tenantId: 'tenant-a' }),
    } as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toBe('Already exists');
    expect(mockCreateNote).not.toHaveBeenCalled();
  });

  it('detects an existing welcome note indexed by userId instead of parent_id', async () => {
    mockPrismQuery.mockImplementation(async (query: unknown) => {
      const serialized = JSON.stringify(query);
      if (serialized.includes('"path":"userId"') && serialized.includes('"path":"normalizedTitle"')) {
        return {
          items: [{
            _id: 'note-existing',
            userId: 'user-1',
            normalizedTitle: 'welcome to pearlos',
          }],
        };
      }
      return { items: [] };
    });

    const response = await POST({
      headers: new Headers(),
      json: async () => ({ tenantId: 'tenant-a' }),
    } as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toBe('Already exists');
    expect(mockCreateNote).not.toHaveBeenCalled();
  });

  it('detects an existing filesystem welcome note before creating a DB duplicate', async () => {
    const documentsDir = path.join(testRoot, 'tenant-a', 'user-1', 'Documents');
    fs.mkdirSync(documentsDir, { recursive: true });
    fs.writeFileSync(path.join(documentsDir, 'Welcome-to-PearlOS.md'), '# Welcome to PearlOS\n\nStart here.', 'utf-8');

    const response = await POST({
      headers: new Headers(),
      json: async () => ({ tenantId: 'tenant-a' }),
    } as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toBe('Already exists');
    expect(mockCreateNote).not.toHaveBeenCalled();
  });
});
