/* @jest-environment jsdom */

import { EventEnum } from '@nia/events';

import {
  NIA_EVENT_ALL,
  NIA_EVENT_BOT_SPEAKING_STARTED,
  NIA_EVENT_WINDOW_MAXIMIZE,
  NIA_EVENT_WINDOW_MINIMIZE,
  NIA_EVENT_WINDOW_RESET,
  NIA_EVENT_WINDOW_RESTORE,
  NIA_EVENT_WINDOW_SNAP_LEFT,
  NIA_EVENT_WINDOW_SNAP_RIGHT,
  NIA_EVENT_APPLET_REFRESH,
  NIA_EVENT_NOTES_REFRESH,
  routeNiaEvent,
  type NiaEventDetail,
} from '../niaEventRouter';

describe('routeNiaEvent', () => {
  const baseEnvelope = {
    v: 1 as const,
    kind: 'nia.event' as const,
    seq: 1,
    ts: Date.now(),
    payload: { room: 'test-room' },
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('dispatches specialized and aggregate events for known topics', () => {
    const speakingListener = jest.fn();
    const aggregateListener = jest.fn();

    window.addEventListener(NIA_EVENT_BOT_SPEAKING_STARTED, speakingListener as EventListener);
    window.addEventListener(NIA_EVENT_ALL, aggregateListener as EventListener);

    routeNiaEvent({ ...baseEnvelope, event: EventEnum.BOT_SPEAKING_STARTED });

    expect(speakingListener).toHaveBeenCalledTimes(1);
    expect(aggregateListener).toHaveBeenCalledTimes(1);

    const speakingDetail = (speakingListener.mock.calls[0][0] as CustomEvent<NiaEventDetail>).detail;
    expect(speakingDetail.event).toBe(EventEnum.BOT_SPEAKING_STARTED);
    expect(speakingDetail.payload).toEqual(expect.objectContaining({ room: 'test-room' }));

    window.removeEventListener(NIA_EVENT_BOT_SPEAKING_STARTED, speakingListener as EventListener);
    window.removeEventListener(NIA_EVENT_ALL, aggregateListener as EventListener);
  });

  it('only dispatches aggregate event for unknown topics', () => {
    const aggregateListener = jest.fn();
    window.addEventListener(NIA_EVENT_ALL, aggregateListener as EventListener);

    routeNiaEvent({ ...baseEnvelope, event: 'custom.unknown' });

    expect(aggregateListener).toHaveBeenCalledTimes(1);
    const aggDetail = (aggregateListener.mock.calls[0][0] as CustomEvent<NiaEventDetail>).detail;
    expect(aggDetail.event).toBe('custom.unknown');

    window.removeEventListener(NIA_EVENT_ALL, aggregateListener as EventListener);
  });

  it('routes notes.refresh events to dedicated channel', () => {
    const notesListener = jest.fn();
    const aggregateListener = jest.fn();

    window.addEventListener(NIA_EVENT_NOTES_REFRESH, notesListener as EventListener);
    window.addEventListener(NIA_EVENT_ALL, aggregateListener as EventListener);

    routeNiaEvent({ ...baseEnvelope, event: EventEnum.NOTES_REFRESH });

    expect(notesListener).toHaveBeenCalledTimes(1);
    expect(aggregateListener).toHaveBeenCalledTimes(1);

    const detail = (notesListener.mock.calls[0][0] as CustomEvent<NiaEventDetail>).detail;
    expect(detail.event).toBe(EventEnum.NOTES_REFRESH);

    window.removeEventListener(NIA_EVENT_NOTES_REFRESH, notesListener as EventListener);
    window.removeEventListener(NIA_EVENT_ALL, aggregateListener as EventListener);
  });

  it('routes applet.refresh events to dedicated channel', () => {
    const appletListener = jest.fn();
    const aggregateListener = jest.fn();

    window.addEventListener(NIA_EVENT_APPLET_REFRESH, appletListener as EventListener);
    window.addEventListener(NIA_EVENT_ALL, aggregateListener as EventListener);

    routeNiaEvent({ ...baseEnvelope, event: EventEnum.APPLET_REFRESH });

    expect(appletListener).toHaveBeenCalledTimes(1);
    expect(aggregateListener).toHaveBeenCalledTimes(1);

    const detail = (appletListener.mock.calls[0][0] as CustomEvent<NiaEventDetail>).detail;
    expect(detail.event).toBe(EventEnum.APPLET_REFRESH);

    window.removeEventListener(NIA_EVENT_APPLET_REFRESH, appletListener as EventListener);
    window.removeEventListener(NIA_EVENT_ALL, aggregateListener as EventListener);
  });

  const windowEventCases = [
    { enumValue: EventEnum.WINDOW_MINIMIZE, customName: NIA_EVENT_WINDOW_MINIMIZE },
    { enumValue: EventEnum.WINDOW_MAXIMIZE, customName: NIA_EVENT_WINDOW_MAXIMIZE },
    { enumValue: EventEnum.WINDOW_RESTORE, customName: NIA_EVENT_WINDOW_RESTORE },
    { enumValue: EventEnum.WINDOW_SNAP_LEFT, customName: NIA_EVENT_WINDOW_SNAP_LEFT },
    { enumValue: EventEnum.WINDOW_SNAP_RIGHT, customName: NIA_EVENT_WINDOW_SNAP_RIGHT },
    { enumValue: EventEnum.WINDOW_RESET, customName: NIA_EVENT_WINDOW_RESET },
  ] as const;

  it.each(windowEventCases)('dispatches %s window automation event', ({ enumValue, customName }) => {
    const windowListener = jest.fn();
    const aggregateListener = jest.fn();

    window.addEventListener(customName, windowListener as EventListener);
    window.addEventListener(NIA_EVENT_ALL, aggregateListener as EventListener);

    routeNiaEvent({ ...baseEnvelope, event: enumValue });

    expect(windowListener).toHaveBeenCalledTimes(1);
    expect(aggregateListener).toHaveBeenCalledTimes(1);

    const detail = (windowListener.mock.calls[0][0] as CustomEvent<NiaEventDetail>).detail;
    expect(detail.event).toBe(enumValue);

    window.removeEventListener(customName, windowListener as EventListener);
    window.removeEventListener(NIA_EVENT_ALL, aggregateListener as EventListener);
  });
});
