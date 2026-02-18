
import { jest } from '@jest/globals';
import { Prism } from '@nia/prism';
import { createTestTenant, createTestUser } from '@nia/prism/testing';
import { v4 as uuidv4 } from 'uuid';

import { findNoteByUserAndMode } from '../actions/notes-actions';
import { NotesDefinition } from '../definition';

describe('Notes legacy retrieval', () => {
  let TENANT = '';

  beforeAll(async () => {
    const tenant = await createTestTenant({ name: 'Test Tenant Legacy' });
    TENANT = tenant._id!;
  });

  it('retrieves notes without mode when querying for personal mode', async () => {
    const user = await createTestUser({ name: 'Legacy User ' + uuidv4(), email: `legacy@example${uuidv4()}.com` });
    
    // 1. Modify definition to make 'mode' optional for this test tenant
    const legacyDefinition = JSON.parse(JSON.stringify(NotesDefinition));
    legacyDefinition.dataModel.jsonSchema.required = ['tenantId', 'title']; // Remove 'mode'
    
    // Update definition in Prism
    const p = await Prism.getInstance();
    await p.createDefinition(legacyDefinition, TENANT);
    
    // 2. Create a note without mode using direct Prism access to bypass any app-layer defaults
    const noteData = {
        title: 'Legacy Note No Mode',
        content: 'Body',
        userId: user._id,
        tenantId: TENANT,
        // mode is intentionally missing
    };
    
    const createdResult = await p.create('Notes', noteData, TENANT);
    const created = createdResult.items[0];
    
    // 3. Verify we can retrieve it using findNoteByUserAndMode('personal')
    // The function should return it because we added the fallback logic.
    const res = await findNoteByUserAndMode(user._id!, TENANT, 'personal');
    
    expect(res).toHaveLength(1);
    expect(res[0]._id).toBe(created._id);
    expect(res[0].title).toBe('Legacy Note No Mode');
    expect(res[0].mode).toBeUndefined();
    
    // 4. Verify we DO NOT retrieve it using findNoteByUserAndMode('work')
    const resWork = await findNoteByUserAndMode(user._id!, TENANT, 'work');
    expect(resWork).toHaveLength(0);
  });
});
