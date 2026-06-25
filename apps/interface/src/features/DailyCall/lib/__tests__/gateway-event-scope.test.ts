import {
  gatewaySubscriptionScope,
  shouldAcceptGatewayEnvelope,
} from '../gateway-event-scope';

describe('gateway event scope', () => {
  it('requires a scoped subscription identity', () => {
    expect(gatewaySubscriptionScope({})).toBeNull();
    expect(gatewaySubscriptionScope({ sessionId: 'room-1', userId: 'user-1' })).toBe('room-1');
    expect(gatewaySubscriptionScope({ userId: 'user-1' })).toBe('user-1');
  });

  it('drops unscoped gateway events', () => {
    expect(
      shouldAcceptGatewayEnvelope(
        { kind: 'nia.event' } as any,
        { sessionId: 'room-1', userId: 'user-1' },
      ),
    ).toBe(false);
  });

  it('accepts matching session, room, and targeted user events', () => {
    expect(
      shouldAcceptGatewayEnvelope(
        { session_id: 'room-1', payload: {} },
        { sessionId: 'room-1', userId: 'user-1' },
      ),
    ).toBe(true);
    expect(
      shouldAcceptGatewayEnvelope(
        { payload: { room_url: 'https://example.daily.co/room-1' } },
        { sessionId: 'room-1', userId: 'user-1' },
      ),
    ).toBe(true);
    expect(
      shouldAcceptGatewayEnvelope(
        { targetSessionUserId: 'user-1', payload: {} },
        { sessionId: 'room-1', userId: 'user-1' },
      ),
    ).toBe(true);
  });

  it('drops events for another user or session', () => {
    expect(
      shouldAcceptGatewayEnvelope(
        { session_id: 'room-2', payload: {} },
        { sessionId: 'room-1', userId: 'user-1' },
      ),
    ).toBe(false);
    expect(
      shouldAcceptGatewayEnvelope(
        { payload: { requester_user_id: 'user-2' } },
        { sessionId: 'room-1', userId: 'user-1' },
      ),
    ).toBe(false);
  });

  it('drops events from another tenant even when user/session match', () => {
    expect(
      shouldAcceptGatewayEnvelope(
        { tenantId: 'tenant-b', session_id: 'room-1', payload: {} },
        { tenantId: 'tenant-a', sessionId: 'room-1', userId: 'user-1' },
      ),
    ).toBe(false);
    expect(
      shouldAcceptGatewayEnvelope(
        { session_id: 'room-1', payload: { requester_tenant_id: 'tenant-a' } },
        { tenantId: 'tenant-a', sessionId: 'room-1', userId: 'user-1' },
      ),
    ).toBe(true);
  });
});
