import { IUserProfile } from '@nia/prism/core/blocks/userProfile.block';

import {
  buildConversationSummaries,
  hasConversationSummaries,
} from '../conversation-summaries';

describe('conversation summaries helper', () => {
  it('returns an empty array when profile is undefined', () => {
    expect(buildConversationSummaries()).toEqual([]);
  });

  it('includes the lastConversationSummary as a grouped item', () => {
    const profile: IUserProfile = {
      _id: 'user-1',
      first_name: 'Ada',
      email: 'ada@example.com',
      lastConversationSummary: {
        summary: 'Latest session summary',
        sessionId: 'session-123',
        timestamp: '2025-11-09T12:00:00.000Z',
        assistantName: 'Nimbus',
        participantCount: 2,
        durationSeconds: 600,
      },
    };

    const groups = buildConversationSummaries(profile);

    expect(groups).toHaveLength(1);
    expect(groups[0].sessionId).toBe('session-123');
    expect(groups[0].items).toHaveLength(1);
    expect(groups[0].items[0]).toMatchObject({
      summary: 'Latest session summary',
      source: 'lastConversationSummary',
    });
    expect(groups[0].latestTimestamp).toBe('2025-11-09T12:00:00.000Z');
    expect(groups[0].assistantName).toBe('Nimbus');
  });

  it('merges session history summaries by sessionId and orders by most recent timestamp', () => {
    const profile: IUserProfile = {
      _id: 'user-2',
      first_name: 'Alan',
      email: 'alan@example.com',
      lastConversationSummary: {
        summary: 'Fresh summary',
        sessionId: 'session-shared',
        timestamp: '2025-11-09T18:00:00.000Z',
        assistantName: 'Atlas',
        participantCount: 3,
        durationSeconds: 720,
      },
      sessionHistory: [
        {
          time: '2025-11-09T15:00:00.000Z',
          action: 'session-summary',
          sessionId: 'session-shared',
          refIds: [
            {
              type: 'conversation-summary',
              id: 'summary-001',
              description: 'Earlier summary from history',
            },
          ],
        },
        {
          time: '2025-11-08T10:00:00.000Z',
          action: 'session-summary',
          sessionId: 'session-older',
          refIds: [
            {
              type: 'conversation-summary',
              id: 'summary-002',
              description: 'Older session summary',
            },
          ],
        },
        {
          time: '2025-11-09T16:00:00.000Z',
          action: 'session-summary',
          sessionId: 'session-shared',
          refIds: [
            {
              type: 'conversation-summary',
              id: 'summary-003',
              description: 'History follow-up summary',
            },
          ],
        },
      ],
    };

    const groups = buildConversationSummaries(profile);

    expect(groups).toHaveLength(2);
    expect(groups[0].sessionId).toBe('session-shared');
    expect(groups[0].latestTimestamp).toBe('2025-11-09T18:00:00.000Z');
    expect(groups[0].items).toHaveLength(3);
    expect(groups[0].items.map(item => item.summary)).toEqual([
      'Fresh summary',
      'History follow-up summary',
      'Earlier summary from history',
    ]);

    expect(groups[1].sessionId).toBe('session-older');
    expect(groups[1].items[0].summary).toBe('Older session summary');
    expect(groups[1].latestTimestamp).toBe('2025-11-08T10:00:00.000Z');
  });

  it('ignores session history entries without conversation summary descriptions', () => {
    const profile: IUserProfile = {
      _id: 'user-3',
      first_name: 'Grace',
      email: 'grace@example.com',
      sessionHistory: [
        {
          time: '2025-11-01T10:00:00.000Z',
          action: 'session-summary',
          sessionId: 'session-empty',
          refIds: [
            {
              type: 'conversation-summary',
              id: 'summary-empty',
              description: '    ',
            },
          ],
        },
      ],
    };

    expect(buildConversationSummaries(profile)).toEqual([]);
  });

  it('hasConversationSummaries mirrors presence of valid summaries', () => {
    const withoutSummaries: IUserProfile = {
      _id: 'user-4',
      first_name: 'Linus',
      email: 'linus@example.com',
      sessionHistory: [
        {
          time: '2025-11-03T10:00:00.000Z',
          action: 'user-joined',
          sessionId: 'session-other',
        },
      ],
    };

    expect(hasConversationSummaries(withoutSummaries)).toBe(false);

    const withSummaries: IUserProfile = {
      _id: 'user-5',
      first_name: 'Margaret',
      email: 'margaret@example.com',
      sessionHistory: [
        {
          time: '2025-11-04T08:00:00.000Z',
          action: 'session-summary',
          sessionId: 'session-something',
          refIds: [
            {
              type: 'conversation-summary',
              id: 'summary-010',
              description: 'Conversation summary from history',
            },
          ],
        },
      ],
    };

    expect(hasConversationSummaries(withSummaries)).toBe(true);
  });
});
