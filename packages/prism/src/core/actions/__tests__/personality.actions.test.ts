const mockQuery = jest.fn();
const mockUpdate = jest.fn();

jest.mock('../../../prism', () => ({
  Prism: {
    getInstance: jest.fn(async () => ({
      query: mockQuery,
      update: mockUpdate,
    })),
  },
}));

import { getPersonalityById, updatePersonality } from '../personality.actions';

describe('personality actions tenant scope', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('queries personality ids with parent tenant scope', async () => {
    mockQuery.mockResolvedValueOnce({
      total: 1,
      items: [{
        _id: 'personality-1',
        tenantId: 'tenant-a',
        parent_id: 'tenant-a',
        primaryPrompt: 'Tenant prompt',
      }],
    });

    const result = await getPersonalityById('personality-1', 'tenant-a');

    expect(mockQuery).toHaveBeenCalledWith({
      contentType: 'Personality',
      tenantId: 'any',
      where: {
        page_id: 'personality-1',
        parent_id: 'tenant-a',
      },
    });
    expect(result?.primaryPrompt).toBe('Tenant prompt');
  });

  it('drops mismatched personality records even if the backing query returns one', async () => {
    mockQuery.mockResolvedValueOnce({
      total: 1,
      items: [{
        _id: 'personality-1',
        tenantId: 'tenant-b',
        parent_id: 'tenant-b',
        primaryPrompt: 'Wrong tenant prompt',
      }],
    });

    const result = await getPersonalityById('personality-1', 'tenant-a');

    expect(result).toBeUndefined();
  });

  it('rejects cross-tenant personality moves during update', async () => {
    mockQuery.mockResolvedValueOnce({
      total: 1,
      items: [{
        _id: 'personality-1',
        tenantId: 'tenant-a',
        parent_id: 'tenant-a',
        primaryPrompt: 'Tenant prompt',
      }],
    });

    await expect(updatePersonality('tenant-a', 'personality-1', {
      tenantId: 'tenant-b',
    } as any)).rejects.toMatchObject({ code: 'TENANT_MISMATCH' });
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
