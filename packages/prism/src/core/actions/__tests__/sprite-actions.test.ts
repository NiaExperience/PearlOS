const mockQuery = jest.fn();

jest.mock('@nia/prism', () => ({
  Prism: {
    getInstance: jest.fn(async () => ({
      query: mockQuery,
    })),
  },
}));

jest.mock('../resourceShareToken-actions', () => ({
  getTokensRedeemedByUser: jest.fn(),
}));

import { BlockType_Sprite } from '../../blocks/sprite.block';
import { findByName, listByUser } from '../sprite-actions';

describe('sprite actions query filters', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses uppercase GraphQL logical filters when finding by name', async () => {
    mockQuery.mockResolvedValueOnce({
      total: 1,
      items: [{ _id: 'sprite-1', name: 'Pearl Sprite' }],
    });

    await findByName('user-1', 'Pearl Sprite');

    expect(mockQuery).toHaveBeenCalledWith(expect.objectContaining({
      contentType: BlockType_Sprite,
      tenantId: 'any',
      where: {
        type: { eq: BlockType_Sprite },
        indexer: { path: 'parent_id', equals: 'user-1' },
        AND: [{ indexer: { path: 'name', equals: 'Pearl Sprite' } }],
      },
    }));
  });

  it('uses uppercase GraphQL logical filters for tenant-scoped lists', async () => {
    mockQuery.mockResolvedValueOnce({
      total: 0,
      items: [],
    });

    await listByUser('user-1', 20, 0, 'tenant-a');

    expect(mockQuery).toHaveBeenCalledWith(expect.objectContaining({
      contentType: BlockType_Sprite,
      tenantId: 'any',
      where: {
        type: { eq: BlockType_Sprite },
        indexer: { path: 'parent_id', equals: 'user-1' },
        AND: [{ indexer: { path: 'tenantId', equals: 'tenant-a' } }],
      },
      limit: 20,
      offset: 0,
    }));
  });
});
