import { EventEnum } from '@nia/events';

import { forwardAppEvent } from '../events/appMessageBridge';
import { recordParticipantJoin, recordParticipantLeave, getParticipantsSnapshot, __resetParticipantsAggregator } from '../events/participantsAggregator';

jest.mock('../events/appMessageBridge', () => ({
  forwardAppEvent: jest.fn()
}));

describe('participantsAggregator', () => {
  beforeEach(() => { __resetParticipantsAggregator(); (forwardAppEvent as jest.Mock).mockClear(); });

  it('emits first join event once for first non-local participant', () => {
    recordParticipantJoin('room', 'local1', 'me', true);
    recordParticipantJoin('room', 'remote1', 'alice', false);
    recordParticipantJoin('room', 'remote2', 'bob', false);
    const calls = (forwardAppEvent as jest.Mock).mock.calls.map(c => c[0]);
    expect(calls.filter(e => e === EventEnum.DAILY_PARTICIPANT_FIRST_JOIN)).toHaveLength(1);
  });

  it('produces participants change snapshot after debounced join/leave', async () => {
    jest.useFakeTimers();
    recordParticipantJoin('room', 'p1', 'alice', false);
    recordParticipantJoin('room', 'p2', 'bob', false);
    jest.runAllTimers();
    const calls = (forwardAppEvent as jest.Mock).mock.calls;
    const changeCalls = calls.filter(c => c[0] === EventEnum.DAILY_PARTICIPANTS_CHANGE);
    expect(changeCalls.length).toBeGreaterThan(0);
    const snapPayload = changeCalls[changeCalls.length - 1][1];
    expect(snapPayload.count).toBe(2);
    recordParticipantLeave('room', 'p1');
    jest.runAllTimers();
    const after = (forwardAppEvent as jest.Mock).mock.calls.filter(c => c[0] === EventEnum.DAILY_PARTICIPANTS_CHANGE);
    const last = after[after.length - 1][1];
    expect(last.count).toBe(1);
    jest.useRealTimers();
  });

  it('returns snapshot via getter', () => {
    recordParticipantJoin('roomX', 'p1', 'z', false);
    const snap = getParticipantsSnapshot();
    expect(snap?.count).toBe(1);
  });
});
