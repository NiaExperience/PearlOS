/**
 * @jest-environment node
 *
 * Combined Notes actions test file.
 * Merged from notes-action.test.ts and notes-actions.test.ts to consolidate feature tests
 * into a single __tests__ folder per project conventions.
 */

import { jest } from '@jest/globals';
import { TenantActions } from '@nia/prism/core/actions';
import { UserBlock, TenantBlock } from '@nia/prism/core/blocks';
import { TenantRole } from '@nia/prism/core/blocks/userTenantRole.block';
import { createTestTenant, createTestUser, testSessionUser } from '@nia/prism/testing';
import { v4 as uuidv4 } from 'uuid';

import {
  createNote,
  findNoteById,
  findNotesByUserAndTitle,
  findNoteByUserAndMode,
  deleteNote,
  updateNote
} from '../actions/notes-actions';
import { Note } from '../types/notes-types';

// ----------------------------------------------------------------------------------
// Legacy simple actions tests (from original notes-actions.test.ts)
// ----------------------------------------------------------------------------------
let TENANT = '';
const NOTE_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

function makeNote(overrides: any = {}) {
  return {
    _id: NOTE_ID,
    title: 'Note Title',
    contentType: 'note',
    content: 'Body',
    userId: testSessionUser._id,
    mode: 'personal',
    tenantId: TENANT,
    ...overrides
  };
}

describe('Notes actions (session user baseline)', () => {
  beforeAll(async () => {
    jest.clearAllMocks();
    const tenant = await createTestTenant({ name: 'Test Tenant' });
    TENANT = tenant._id!;
  });

  describe('createNote', () => {
    it('creates and injects userId when missing', async () => {
      const noteData = { title: 'T', contentType: 'note', content: 'B' } as any;
      const note = await createNote(noteData, TENANT);
      expect(note.userId).toBe(testSessionUser._id);
    });
  });

  describe('findNoteById', () => {
    it('returns null when not found', async () => {
      const res = await findNoteById(NOTE_ID, TENANT);
      expect(res).toBeNull();
    });
  });

  describe('findNotesByUserAndTitle', () => {
    it('returns items when found', async () => {
      const note = await createNote(makeNote({ _id: uuidv4(), title: 'Note Title' }), TENANT);
      const res = await findNotesByUserAndTitle(testSessionUser._id!, TENANT, 'Note Title');
      expect(res).not.toBeNull();
      expect(res![0].title).toBe('Note Title');
      expect(res![0]._id).toBe(note._id);
    });
  });

  describe('findNoteByUserAndMode', () => {
    it('returns items for personal mode with parent filter', async () => {
      const user = await createTestUser({ name: 'Bob ' + uuidv4(), email: `bob@example${uuidv4()}.com` });
      const note = await createNote(makeNote({ _id: uuidv4(), userId: user._id!, mode: 'personal' }), TENANT);
      const res = await findNoteByUserAndMode(user._id!, TENANT, 'personal');
      expect(res).toHaveLength(1);
      expect(res[0]._id).toBe(note._id);
    });
  });

  describe('updateNote', () => {
    it('updates note', async () => {
      const note = await createNote(makeNote({ _id: uuidv4() }), TENANT);
      const updated = await updateNote(note._id!, { title: 'Updated' }, TENANT);
      expect(updated.title).toBe('Updated');
      expect(updated._id).toBe(note._id);
    });
  });

  describe('deleteNote', () => {
    it('deletes note after verifying ownership', async () => {
      const note = await createNote(makeNote({ _id: uuidv4() }), TENANT);
      const deleted = await deleteNote(note._id!, TENANT);
      expect(deleted._id).toBe(note._id);
    });
  });
});

// ----------------------------------------------------------------------------------
// Detailed CRUD + mode filtering tests (from notes-action.test.ts)
// ----------------------------------------------------------------------------------

describe('Notes actions (detailed CRUD & mode filtering)', () => {
  let testUser: UserBlock.IUser & { _id: string };
  let workTenant: TenantBlock.ITenant & { _id: string };
  let personalTenant: TenantBlock.ITenant & { _id: string };
  let unique: string;

  beforeEach(async () => {
    unique = uuidv4().substring(0, 8);

    // Create test user
    const userData: UserBlock.IUser = {
      name: `Test User ${unique}`,
      email: `testuser${unique}@example.com`,
      phone_number: '4155551234',
    };
    testUser = await createTestUser(userData, 'password123') as UserBlock.IUser & { _id: string };

    // Create work tenant
    workTenant = await createTestTenant({ name: `Work Tenant ${unique}` }) as TenantBlock.ITenant & { _id: string };

    // Create personal tenant (simulating personal workspace)
    personalTenant = await createTestTenant({ name: `Personal Tenant ${unique}` }) as TenantBlock.ITenant & { _id: string };

    // Assign user to work tenant
    await TenantActions.assignUserToTenant(testUser._id!, workTenant._id!, TenantRole.MEMBER);
  });

  describe('createNote', () => {
    it('creates a personal note successfully', async () => {
      const noteData: Note = {
        title: `Personal Note ${unique}`,
        content: 'This is a personal note for testing',
        mode: 'personal',
        userId: testUser._id!,
        tenantId: personalTenant._id!
      } as any;

      const result = await createNote(noteData, personalTenant._id!);
      expect(result).toBeDefined();
      expect(result._id).toBeDefined();
      expect(result.mode).toBe('personal');
    });

    it('creates a work note successfully', async () => {
      const noteData: Note = {
        title: `Work Note ${unique}`,
        content: 'This is a work note for testing',
        mode: 'work',
        userId: testUser._id!,
        tenantId: workTenant._id!
      } as any;

      const result = await createNote(noteData, workTenant._id!);
      expect(result).toBeDefined();
      expect(result._id).toBeDefined();
      expect(result.mode).toBe('work');
    });
  });

  describe('findNoteByUserAndMode', () => {
    let personalNote: Note;
    let workNote: Note;

    beforeEach(async () => {
      personalNote = await createNote({
        title: `Personal Note ${unique}`,
        content: 'Personal content',
        mode: 'personal',
        userId: testUser._id!,
        tenantId: personalTenant._id!
      } as any, personalTenant._id!);

      workNote = await createNote({
        title: `Work Note ${unique}`,
        content: 'Work content',
        mode: 'work',
        userId: testUser._id!,
        tenantId: workTenant._id!
      } as any, workTenant._id!);
    });

    it('finds personal notes only when mode is personal', async () => {
      const result = await findNoteByUserAndMode(testUser._id!, personalTenant._id!, 'personal');
      expect(result).toBeDefined();
      if (result) {
        expect(result.every(n => n.mode === 'personal')).toBe(true);
        expect(result.find(n => n._id === personalNote._id)).toBeDefined();
      }
    });

    it('finds work notes only when mode is work', async () => {
      const result = await findNoteByUserAndMode(testUser._id!, workTenant._id!, 'work');
      expect(result).toBeDefined();
      if (result) {
        expect(result.every(n => n.mode === 'work')).toBe(true);
        expect(result.find(n => n._id === workNote._id)).toBeDefined();
      }
    });

    it('returns empty array when no notes match mode filter (work in personal tenant)', async () => {
      const result = await findNoteByUserAndMode(testUser._id!, personalTenant._id!, 'work');
      expect(result).toBeDefined();
      if (result) {
        expect(result).toHaveLength(0);
      }
    });

    it('handles non-existent user gracefully', async () => {
      const fakeUserId = '12345678-1234-1234-1234-123456789012';
      const result = await findNoteByUserAndMode(fakeUserId, workTenant._id!, 'work');
      expect(result).toBeDefined();
      if (result) {
        expect(result).toHaveLength(0);
      }
    });

    it('validates parameters', async () => {
      await expect(findNoteByUserAndMode('', workTenant._id!, 'work')).rejects.toThrow('userId, tenantId and mode are required');
      await expect(findNoteByUserAndMode(testUser._id!, '', 'work')).rejects.toThrow('userId, tenantId and mode are required');
      await expect(findNoteByUserAndMode(testUser._id!, workTenant._id!, '')).rejects.toThrow('userId, tenantId and mode are required');
    });
  });

  describe('Mode Filtering Validation', () => {
    it('creates notes with correct mode-based business logic', async () => {
      const personal = await createNote({
        title: `Personal Validation Test ${unique}`,
        content: 'Testing personal mode business logic',
        mode: 'personal',
        userId: testUser._id!,
        tenantId: personalTenant._id!
      } as any, personalTenant._id!);

      const work = await createNote({
        title: `Work Validation Test ${unique}`,
        content: 'Testing work mode business logic',
        mode: 'work',
        userId: testUser._id!,
        tenantId: workTenant._id!
      } as any, workTenant._id!);

      expect(personal.mode).toBe('personal');
      expect(work.mode).toBe('work');
    });
  });
});
