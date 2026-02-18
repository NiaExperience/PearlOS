import { createTestTenant } from '../../../packages/prism/src/testing';
import { clonePersonality, createPersonality, deletePersonality, listPersonalities, updatePersonality } from '../src/core/actions/personality.actions';


describe('personality.actions', () => {
  test('create personality', async () => {
    const tenant = await createTestTenant();
    const p = await createPersonality(tenant._id!, { name: 'Alpha', primaryPrompt: 'Hi' });
    expect(p).toBeDefined();
    expect(p.name).toBe('Alpha');
  });

  test('reject duplicate name on create', async () => {
    const tenant = await createTestTenant();
    await createPersonality(tenant._id!, { name: 'Dup' });
    await expect(createPersonality(tenant._id!, { name: 'Dup' })).rejects.toThrow(/already exists/i);
  });

  test('update personality & reject duplicate name', async () => {
    const tenant = await createTestTenant();
    const a = await createPersonality(tenant._id!, { name: 'One' });
    const b = await createPersonality(tenant._id!, { name: 'Two' });
    await expect(updatePersonality(tenant._id!, b._id as string, { name: 'One' })).rejects.toThrow(/already exists/i);
    const updated = await updatePersonality(tenant._id!, a._id as string, { description: 'Desc' });
    expect(updated?.description).toBe('Desc');
  });

  test('clone personality generates unique name', async () => {
    const tenant = await createTestTenant();
    const base = await createPersonality(tenant._id!, { name: 'Persona X' });
    const cloned = await clonePersonality(tenant._id!, base._id as string);
    expect(cloned._id).not.toBe(base._id);
    expect(cloned.name).not.toBeFalsy();
    expect(cloned.name).not.toBe(base.name); // should differ via suffix
  });

  test('delete personality', async () => {
    const tenant = await createTestTenant();
    const p = await createPersonality(tenant._id!, { name: 'DeleteMe' });
    const ok = await deletePersonality(tenant._id!, p._id as string);
    expect(ok).toBe(true);
    const list = await listPersonalities(tenant._id!);
    expect(list.find(i => i._id === p._id)).toBeUndefined();
  });
});
