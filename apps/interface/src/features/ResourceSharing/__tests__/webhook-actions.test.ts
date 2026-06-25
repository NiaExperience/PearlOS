/**
 * @jest-environment node
 */

import { dispatchWebhookEvent } from '@nia/prism/core/actions/webhook-actions';
import { ResourceType } from '@nia/prism/core/blocks/resourceShareToken.block';

const mockDnsLookup = jest.fn();
const prismMock = {
  query: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
};

jest.mock('dns/promises', () => ({
  lookup: (...args: unknown[]) => mockDnsLookup(...args),
}));

jest.mock('../../../../../../packages/prism/src/prism', () => ({
  Prism: {
    getInstance: jest.fn(async () => prismMock),
  },
}));

describe('webhook delivery infrastructure', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 204,
      text: async () => '',
    })) as jest.Mock;
  });

  it('delivers matching share events and records delivery status', async () => {
    prismMock.query.mockResolvedValue({
      items: [
        {
          _id: 'subscription-1',
          tenantId: 'tenant-1',
          createdBy: 'user-1',
          url: 'https://example.com/webhook',
          secret: 'secret',
          events: ['share.created'],
          resourceTypes: [ResourceType.Notes],
          isActive: true,
        },
      ],
    });
    prismMock.create.mockResolvedValue({
      items: [{
        _id: 'delivery-1',
        tenantId: 'tenant-1',
        subscriptionId: 'subscription-1',
        event: 'share.created',
        resourceId: 'note-1',
        resourceType: ResourceType.Notes,
        status: 'pending',
        attemptCount: 0,
        requestBody: { event: 'share.created' },
      }],
    });
    prismMock.update.mockResolvedValue({ items: [{ _id: 'delivery-1' }] });

    const deliveries = await dispatchWebhookEvent({
      event: 'share.created',
      tenantId: 'tenant-1',
      resourceId: 'note-1',
      resourceType: ResourceType.Notes,
      actorUserId: 'owner-1',
      recipientUserId: 'viewer-1',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://example.com/webhook',
      expect.objectContaining({
        method: 'POST',
        redirect: 'manual',
        headers: expect.objectContaining({
          'X-PearlOS-Event': 'share.created',
          'X-PearlOS-Signature-256': expect.stringMatching(/^sha256=/),
        }),
      })
    );
    expect(prismMock.create).toHaveBeenCalledWith(
      'WebhookDelivery',
      expect.objectContaining({
        tenantId: 'tenant-1',
        event: 'share.created',
        resourceId: 'note-1',
        resourceType: ResourceType.Notes,
      }),
      'tenant-1'
    );
    expect(prismMock.update).toHaveBeenCalledWith(
      'WebhookDelivery',
      'delivery-1',
      expect.objectContaining({
        tenantId: 'tenant-1',
        event: 'share.created',
        resourceId: 'note-1',
        resourceType: ResourceType.Notes,
        requestBody: expect.objectContaining({ event: 'share.created' }),
        status: 'success',
        responseStatus: 204,
      }),
      'tenant-1'
    );
    expect(deliveries).toHaveLength(1);
  });

  it('does not fetch webhook URLs that resolve to private addresses', async () => {
    mockDnsLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    prismMock.query.mockResolvedValue({
      items: [
        {
          _id: 'subscription-1',
          tenantId: 'tenant-1',
          createdBy: 'user-1',
          url: 'https://localhost.example/webhook',
          events: ['task.completed'],
          resourceTypes: [ResourceType.Task],
          isActive: true,
        },
      ],
    });
    prismMock.create.mockResolvedValue({
      items: [{ _id: 'delivery-1', tenantId: 'tenant-1', status: 'pending' }],
    });
    prismMock.update.mockResolvedValue({ items: [{ _id: 'delivery-1' }] });

    const deliveries = await dispatchWebhookEvent({
      event: 'task.completed',
      tenantId: 'tenant-1',
      resourceId: 'task-1',
      resourceType: ResourceType.Task,
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(prismMock.update).toHaveBeenCalledWith(
      'WebhookDelivery',
      'delivery-1',
      expect.objectContaining({
        status: 'failed',
        error: 'Webhook URL resolves to a private address',
      }),
      'tenant-1',
    );
    expect(deliveries[0]).toMatchObject({ status: 'failed' });
  });

  it('skips inactive or non-matching subscriptions', async () => {
    prismMock.query.mockResolvedValue({
      items: [
        {
          _id: 'subscription-1',
          tenantId: 'tenant-1',
          createdBy: 'user-1',
          url: 'https://example.com/webhook',
          events: ['share.redeemed'],
          resourceTypes: [ResourceType.Apps],
          isActive: true,
        },
        {
          _id: 'subscription-2',
          tenantId: 'tenant-1',
          createdBy: 'user-1',
          url: 'https://example.com/webhook',
          events: ['share.created'],
          resourceTypes: [ResourceType.Notes],
          isActive: false,
        },
      ],
    });

    const deliveries = await dispatchWebhookEvent({
      event: 'share.created',
      tenantId: 'tenant-1',
      resourceId: 'note-1',
      resourceType: ResourceType.Notes,
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(prismMock.create).not.toHaveBeenCalled();
    expect(deliveries).toEqual([]);
  });
});
