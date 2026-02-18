import { initAppMessageBridge, forwardAppEvent, addAppMessageListener, __resetBridge } from '../events/appMessageBridge';
import { EventEnum } from '@nia/events';

describe('appMessageBridge', () => {
  afterEach(() => { __resetBridge(); });

  it('forwards events with incrementing seq', () => {
    const sent: any[] = [];
    const fakeDaily = { sendAppMessage: (o: any) => { sent.push(o); } };
    initAppMessageBridge(fakeDaily);
    forwardAppEvent(EventEnum.DAILY_CALL_STATE, { phase: 'joined' });
    forwardAppEvent(EventEnum.DAILY_PARTICIPANT_JOIN, { participantId: 'p1' });
    expect(sent).toHaveLength(2);
    expect(sent[0].seq).toBe(1);
    expect(sent[1].seq).toBe(2);
    expect(sent[0].event).toBe(EventEnum.DAILY_CALL_STATE);
  });

  it('invokes listeners for inbound envelopes', () => {
    const received: any[] = [];
    const fakeDaily: any = { sendAppMessage: jest.fn(), on: jest.fn((evt: string, cb: any) => { fakeDaily._cb = cb; }) };
    initAppMessageBridge(fakeDaily);
    addAppMessageListener(env => received.push(env));
    // simulate inbound message
    fakeDaily._cb({ data: { v:1, kind: 'nia.event', seq: 4, ts: Date.now(), event: EventEnum.DAILY_PARTICIPANT_LEAVE, payload: { participantId: 'p2' } } });
    expect(received).toHaveLength(1);
    expect(received[0].event).toBe(EventEnum.DAILY_PARTICIPANT_LEAVE);
  });

  it('filters outbound when allowOutbound returns false', () => {
    const sent: any[] = [];
    const fakeDaily = { sendAppMessage: (o: any) => { sent.push(o); }, on: jest.fn() } as any;
    initAppMessageBridge(fakeDaily, { allowOutbound: (e) => e !== EventEnum.DAILY_CALL_ERROR });
    forwardAppEvent(EventEnum.DAILY_CALL_ERROR, { message: 'x' });
    forwardAppEvent(EventEnum.DAILY_PARTICIPANT_JOIN, { participantId: 'p3' });
    expect(sent).toHaveLength(1);
    expect(sent[0].event).toBe(EventEnum.DAILY_PARTICIPANT_JOIN);
  });
});
