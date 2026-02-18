import { createPersonality, clonePersonality, listPersonalities } from '../src/core/actions/personality.actions';
import { createTestTenant } from '../../../packages/prism/src/testing';
// Reuse the same in-memory Prism mock from personality-actions.test by mocking prism again.
const memory: Record<string, any[]> = {};

describe('personality clone name increments', () => {
  test('sibling numeric suffix increments', async () => {
    const tenant = await createTestTenant();
    const base = await createPersonality(tenant._id!, { name: 'Persona' });
    const c1 = await clonePersonality(tenant._id!, base._id as string); // Persona 1
    const c2 = await clonePersonality(tenant._id!, base._id as string); // Persona 2
    const c3 = await clonePersonality(tenant._id!, base._id as string); // Persona 3
    const names = (await listPersonalities(tenant._id!)).map(p => p.name).filter(Boolean) as string[];
    expect(names).toContain('Persona');
    expect(names).toContain('Persona 1');
    expect(names).toContain('Persona 2');
    expect(names).toContain('Persona 3');
  });

  test('child dotted suffix increments when base ends with number', async () => {
    const tenant = await createTestTenant();
    const base = await createPersonality(tenant._id!, { name: 'Persona 7' });
    const c1 = await clonePersonality(tenant._id!, base._id as string); // Persona 7.1
    const c2 = await clonePersonality(tenant._id!, base._id as string); // Persona 7.2
    const names = (await listPersonalities(tenant._id!)).map(p => p.name).filter(Boolean) as string[];
    expect(names).toContain('Persona 7');
    expect(names).toContain('Persona 7.1');
    expect(names).toContain('Persona 7.2');
  });
});
