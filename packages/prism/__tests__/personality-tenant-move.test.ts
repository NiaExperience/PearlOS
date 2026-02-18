import { createTestTenant } from '../../../packages/prism/src/testing';
import { createPersonality, listPersonalities, updatePersonality } from '../src/core/actions/personality.actions';

describe('personality tenant move', () => {
  test('moving a personality to another tenant persists and remains editable', async () => {
    const tenantA = await createTestTenant();
    const tenantB = await createTestTenant();

    const p = await createPersonality(tenantA._id!, { name: `MoveMe-${Date.now()}`, primaryPrompt: 'Hi' });
    expect(p).toBeDefined();

    // Precondition: exists under tenant A only
    let listA = await listPersonalities(tenantA._id!);
    let listB = await listPersonalities(tenantB._id!);
    expect(listA.find(i => i._id === p._id)).toBeDefined();
    expect(listB.find(i => i._id === p._id)).toBeUndefined();

    // Move to tenant B
    const moved = await updatePersonality(tenantA._id!, p._id as string, { tenantId: tenantB._id! });
    expect(moved).toBeTruthy();

    // Postcondition: removed from A, present in B
    listA = await listPersonalities(tenantA._id!);
    listB = await listPersonalities(tenantB._id!);
    expect(listA.find(i => i._id === p._id)).toBeUndefined();
    const foundInB = listB.find(i => i._id === p._id);
    expect(foundInB).toBeDefined();

    // Ensure subsequent updates work using the new tenant context
    const updatedUnderB = await updatePersonality(tenantB._id!, p._id as string, { description: 'moved' });
    expect(updatedUnderB?.description).toBe('moved');
  });
});
