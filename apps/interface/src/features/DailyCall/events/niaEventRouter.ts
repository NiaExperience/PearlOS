import { EventEnum } from '@nia/events';
import posthog from 'posthog-js';

import type { AppMessageEnvelope } from './appMessageBridge';

type AnyPayload = Record<string, unknown> | null | undefined;

type MinimalEnvelope<TPayload> = Pick<AppMessageEnvelope<TPayload>, 'v' | 'kind' | 'seq' | 'ts' | 'payload'> & {
  event: string;
};

export interface NiaEventDetail<TPayload = AnyPayload> {
  event: EventEnum | string;
  envelope: MinimalEnvelope<TPayload>;
  payload: TPayload;
}

export const NIA_EVENT_ALL = 'nia.event.all';
export const NIA_EVENT_OPENCLAW_TASK = 'nia.event.openclawTask';
export const NIA_EVENT_BOT_SPEAKING_STARTED = 'nia.event.botSpeakingStarted';
export const NIA_EVENT_BOT_SPEAKING_STOPPED = 'nia.event.botSpeakingStopped';
export const NIA_EVENT_CONVERSATION_WRAPUP = 'nia.event.conversationWrapup';
export const NIA_EVENT_SESSION_END = 'nia.event.sessionEnd';
export const NIA_EVENT_WINDOW_MINIMIZE = 'nia.event.windowMinimize';
export const NIA_EVENT_WINDOW_MAXIMIZE = 'nia.event.windowMaximize';
export const NIA_EVENT_WINDOW_RESTORE = 'nia.event.windowRestore';
export const NIA_EVENT_WINDOW_SNAP_LEFT = 'nia.event.windowSnapLeft';
export const NIA_EVENT_WINDOW_SNAP_RIGHT = 'nia.event.windowSnapRight';
export const NIA_EVENT_WINDOW_RESET = 'nia.event.windowReset';
export const NIA_EVENT_NOTE_OPEN = 'nia.event.noteOpen';
export const NIA_EVENT_NOTE_CLOSE = 'nia.event.noteClose';
export const NIA_EVENT_NOTE_UPDATED = 'nia.event.noteUpdated';
export const NIA_EVENT_NOTE_SAVED = 'nia.event.noteSaved';
export const NIA_EVENT_NOTE_DOWNLOAD = 'nia.event.noteDownload';
export const NIA_EVENT_NOTE_DELETED = 'nia.event.noteDeleted';
export const NIA_EVENT_NOTE_MODE_SWITCH = 'nia.event.noteModeSwitch';
export const NIA_EVENT_NOTES_REFRESH = 'nia.event.notesRefresh';
export const NIA_EVENT_NOTES_LIST = 'nia.event.notesList';
export const NIA_EVENT_APPLET_REFRESH = 'nia.event.appletRefresh';
export const NIA_EVENT_APP_OPEN = 'nia.event.appOpen';
export const NIA_EVENT_APPS_CLOSE = 'nia.event.appsClose';
export const NIA_EVENT_BROWSER_OPEN = 'nia.event.browserOpen';
export const NIA_EVENT_BROWSER_CLOSE = 'nia.event.browserClose';
export const NIA_EVENT_VIEW_CLOSE = 'nia.event.viewClose';
export const NIA_EVENT_DESKTOP_MODE_SWITCH = 'nia.event.desktopModeSwitch';
export const NIA_EVENT_YOUTUBE_SEARCH = 'nia.event.youtubeSearch';
export const NIA_EVENT_YOUTUBE_PLAY = 'nia.event.youtubePlay';
export const NIA_EVENT_YOUTUBE_PAUSE = 'nia.event.youtubePause';
export const NIA_EVENT_YOUTUBE_NEXT = 'nia.event.youtubeNext';
export const NIA_EVENT_CALL_START = 'nia.event.callStart';
export const NIA_EVENT_HTML_CREATED = 'nia.event.htmlCreated';
export const NIA_EVENT_HTML_UPDATED = 'nia.event.htmlUpdated';
export const NIA_EVENT_HTML_LOADED = 'nia.event.htmlLoaded';
export const NIA_EVENT_HTML_GENERATION_REQUESTED = 'nia.event.htmlGenerationRequested';
export const NIA_EVENT_HTML_MODIFICATION_REQUESTED = 'nia.event.htmlModificationRequested';
export const NIA_EVENT_HTML_ROLLBACK_REQUESTED = 'nia.event.htmlRollbackRequested';
export const NIA_EVENT_APPLET_OPEN = 'nia.event.appletOpen';
export const NIA_EVENT_APPLET_CLOSE = 'nia.event.appletClose';
export const NIA_EVENT_APPLET_UPDATED = 'nia.event.appletUpdated';
export const NIA_EVENT_APPLET_SHARE_OPEN = 'nia.event.appletShareOpen';
export const NIA_EVENT_ONBOARDING_COMPLETE = 'nia.event.onboardingComplete';
export const NIA_EVENT_SPRITE_OPEN = 'nia.event.spriteOpen';
export const NIA_EVENT_EXPERIENCE_RENDER = 'nia:experience.render';
export const NIA_EVENT_EXPERIENCE_DISMISS = 'nia:experience.dismiss';

/**
 * String-based event routing for events not yet in EventEnum.
 * Maps raw event topic strings to window CustomEvent names.
 */
export const NIA_EVENT_CANVAS_RENDER = 'nia.event.canvasRender';
export const NIA_EVENT_CANVAS_CLEAR = 'nia.event.canvasClear';

// Wonder Canvas events
export const NIA_EVENT_WONDER_SCENE = 'nia:wonder.scene';
export const NIA_EVENT_WONDER_ADD = 'nia:wonder.add';
export const NIA_EVENT_WONDER_REMOVE = 'nia:wonder.remove';
export const NIA_EVENT_WONDER_CLEAR = 'nia:wonder.clear';
export const NIA_EVENT_WONDER_ANIMATE = 'nia:wonder.animate';

const STRING_ROUTED_EVENT_NAMES: Record<string, string> = {
  'experience.render': NIA_EVENT_EXPERIENCE_RENDER,
  'experience.dismiss': NIA_EVENT_EXPERIENCE_DISMISS,
  'canvas.render': NIA_EVENT_CANVAS_RENDER,
  'canvas.clear': NIA_EVENT_CANVAS_CLEAR,
  'wonder.scene': NIA_EVENT_WONDER_SCENE,
  'wonder.add': NIA_EVENT_WONDER_ADD,
  'wonder.remove': NIA_EVENT_WONDER_REMOVE,
  'wonder.clear': NIA_EVENT_WONDER_CLEAR,
  'wonder.animate': NIA_EVENT_WONDER_ANIMATE,
};

const ROUTED_EVENT_NAMES: Record<string, string> = {
  [EventEnum.BOT_SPEAKING_STARTED]: NIA_EVENT_BOT_SPEAKING_STARTED,
  [EventEnum.BOT_SPEAKING_STOPPED]: NIA_EVENT_BOT_SPEAKING_STOPPED,
  [EventEnum.BOT_CONVERSATION_WRAPUP]: NIA_EVENT_CONVERSATION_WRAPUP,
  [EventEnum.BOT_SESSION_END]: NIA_EVENT_SESSION_END,
  [EventEnum.WINDOW_MINIMIZE]: NIA_EVENT_WINDOW_MINIMIZE,
  [EventEnum.WINDOW_MAXIMIZE]: NIA_EVENT_WINDOW_MAXIMIZE,
  [EventEnum.WINDOW_RESTORE]: NIA_EVENT_WINDOW_RESTORE,
  [EventEnum.WINDOW_SNAP_LEFT]: NIA_EVENT_WINDOW_SNAP_LEFT,
  [EventEnum.WINDOW_SNAP_RIGHT]: NIA_EVENT_WINDOW_SNAP_RIGHT,
  [EventEnum.WINDOW_RESET]: NIA_EVENT_WINDOW_RESET,
  [EventEnum.NOTE_OPEN]: NIA_EVENT_NOTE_OPEN,
  [EventEnum.NOTE_CLOSE]: NIA_EVENT_NOTE_CLOSE,
  [EventEnum.NOTE_UPDATED]: NIA_EVENT_NOTE_UPDATED,
  [EventEnum.NOTE_SAVED]: NIA_EVENT_NOTE_SAVED,
  [EventEnum.NOTE_DOWNLOAD]: NIA_EVENT_NOTE_DOWNLOAD,
  [EventEnum.NOTE_DELETED]: NIA_EVENT_NOTE_DELETED,
  [EventEnum.NOTE_MODE_SWITCH]: NIA_EVENT_NOTE_MODE_SWITCH,
  [EventEnum.NOTES_REFRESH]: NIA_EVENT_NOTES_REFRESH,
  [EventEnum.NOTES_LIST]: NIA_EVENT_NOTES_LIST,
  [EventEnum.APPLET_REFRESH]: NIA_EVENT_APPLET_REFRESH,
  [EventEnum.APP_OPEN]: NIA_EVENT_APP_OPEN,
  [EventEnum.APPS_CLOSE]: NIA_EVENT_APPS_CLOSE,
  [EventEnum.BROWSER_OPEN]: NIA_EVENT_BROWSER_OPEN,
  [EventEnum.BROWSER_CLOSE]: NIA_EVENT_BROWSER_CLOSE,
  [EventEnum.VIEW_CLOSE]: NIA_EVENT_VIEW_CLOSE,
  [EventEnum.DESKTOP_MODE_SWITCH]: NIA_EVENT_DESKTOP_MODE_SWITCH,
  [EventEnum.YOUTUBE_SEARCH]: NIA_EVENT_YOUTUBE_SEARCH,
  [EventEnum.YOUTUBE_PLAY]: NIA_EVENT_YOUTUBE_PLAY,
  [EventEnum.YOUTUBE_PAUSE]: NIA_EVENT_YOUTUBE_PAUSE,
  [EventEnum.YOUTUBE_NEXT]: NIA_EVENT_YOUTUBE_NEXT,
  [EventEnum.CALL_START]: NIA_EVENT_CALL_START,
  [EventEnum.HTML_CREATED]: NIA_EVENT_HTML_CREATED,
  [EventEnum.HTML_UPDATED]: NIA_EVENT_HTML_UPDATED,
  [EventEnum.HTML_LOADED]: NIA_EVENT_HTML_LOADED,
  [EventEnum.HTML_GENERATION_REQUESTED]: NIA_EVENT_HTML_GENERATION_REQUESTED,
  [EventEnum.HTML_MODIFICATION_REQUESTED]: NIA_EVENT_HTML_MODIFICATION_REQUESTED,
  [EventEnum.HTML_ROLLBACK_REQUESTED]: NIA_EVENT_HTML_ROLLBACK_REQUESTED,
  [EventEnum.APPLET_OPEN]: NIA_EVENT_APPLET_OPEN,
  [EventEnum.APPLET_CLOSE]: NIA_EVENT_APPLET_CLOSE,
  [EventEnum.APPLET_UPDATED]: NIA_EVENT_APPLET_UPDATED,
  [EventEnum.APPLET_SHARE_OPEN]: NIA_EVENT_APPLET_SHARE_OPEN,
  [EventEnum.ONBOARDING_COMPLETE]: NIA_EVENT_ONBOARDING_COMPLETE,
};

function dispatchEvent<TPayload>(eventName: string, detail: NiaEventDetail<TPayload>) {
  window.dispatchEvent(new CustomEvent<NiaEventDetail<TPayload>>(eventName, { detail }));
}

function asEventEnum(value: string): EventEnum | null {
  return (Object.values(EventEnum) as string[]).includes(value) ? (value as EventEnum) : null;
}

export function routeNiaEvent<TPayload = AnyPayload>(envelope: MinimalEnvelope<TPayload>) {
  const eventEnum = asEventEnum(envelope.event);
  const detail: NiaEventDetail<TPayload> = {
    event: eventEnum ?? envelope.event,
    envelope,
    payload: envelope.payload,
  };

  // Specific Event Tracking Logic
  if (posthog) {
    const rawPayload: any = envelope.payload || {};
    
    switch (eventEnum) {
      case EventEnum.BOT_SPEAKING_STARTED:
        posthog.capture('bot_speaking_started');
        break;
      case EventEnum.BOT_SPEAKING_STOPPED:
        posthog.capture('bot_speaking_stopped');
        break;
      case EventEnum.BOT_CONVERSATION_WRAPUP:
        posthog.capture('bot_conversation_wrapup');
        break;
      case EventEnum.BOT_SESSION_END:
        posthog.capture('bot_session_end');
        break;
        
      // Window Automation (Bot initiated)
      case EventEnum.WINDOW_MINIMIZE:
        posthog.capture('window_minimized_by_bot');
        break;
      case EventEnum.WINDOW_MAXIMIZE:
        posthog.capture('window_maximized_by_bot');
        break;
      case EventEnum.WINDOW_RESTORE:
        posthog.capture('window_restored_by_bot');
        break;
      case EventEnum.WINDOW_SNAP_LEFT:
        posthog.capture('window_snapped_left_by_bot');
        break;
      case EventEnum.WINDOW_SNAP_RIGHT:
        posthog.capture('window_snapped_right_by_bot');
        break;
      case EventEnum.WINDOW_RESET:
        posthog.capture('window_reset_by_bot');
        break;

      // Note Operations (Bot initiated)
      case EventEnum.NOTE_OPEN:
        posthog.capture('note_opened_by_bot', { noteId: rawPayload?.noteId, title: rawPayload?.title });
        break;
      case EventEnum.NOTE_CLOSE:
        posthog.capture('note_closed_by_bot');
        break;
      case EventEnum.NOTE_UPDATED:
        posthog.capture('note_updated_by_bot', { noteId: rawPayload?.noteId });
        break;
      case EventEnum.NOTE_SAVED:
        posthog.capture('note_saved_by_bot', { noteId: rawPayload?.noteId });
        break;
      case EventEnum.NOTE_DOWNLOAD:
        posthog.capture('note_downloaded_by_bot', { noteId: rawPayload?.noteId });
        break;
      case EventEnum.NOTE_DELETED:
        posthog.capture('note_deleted_by_bot', { noteId: rawPayload?.noteId });
        break;
      case EventEnum.NOTE_MODE_SWITCH:
        posthog.capture('note_mode_switched_by_bot', { mode: rawPayload?.mode });
        break;
      case EventEnum.NOTES_REFRESH:
        posthog.capture('notes_refreshed_by_bot');
        break;
      case EventEnum.NOTES_LIST:
        posthog.capture('notes_listed_by_bot');
        break;
      case EventEnum.APPLET_REFRESH:
        posthog.capture('applet_refresh_by_bot');
        break;

      // App/Browser Operations (Bot initiated)
      case EventEnum.APP_OPEN:
        posthog.capture('app_opened_by_bot', { appName: rawPayload?.app });
        break;
      case EventEnum.APPS_CLOSE:
        posthog.capture('apps_closed_by_bot', { apps: rawPayload?.apps });
        break;
      case EventEnum.BROWSER_OPEN:
        posthog.capture('browser_opened_by_bot', { url: rawPayload?.url });
        break;
      case EventEnum.BROWSER_CLOSE:
        posthog.capture('browser_closed_by_bot');
        break;
      case EventEnum.VIEW_CLOSE:
        posthog.capture('view_closed_by_bot', { target: rawPayload?.target });
        break;
      case EventEnum.DESKTOP_MODE_SWITCH:
        posthog.capture('desktop_mode_switched_by_bot', { mode: rawPayload?.mode });
        break;

      // YouTube (Bot initiated)
      case EventEnum.YOUTUBE_SEARCH:
        posthog.capture('youtube_searched_by_bot', { query: rawPayload?.query });
        break;
      case EventEnum.YOUTUBE_PLAY:
        posthog.capture('youtube_played_by_bot', { videoId: rawPayload?.videoId });
        break;
      case EventEnum.YOUTUBE_PAUSE:
        posthog.capture('youtube_paused_by_bot');
        break;
      case EventEnum.YOUTUBE_NEXT:
        posthog.capture('youtube_next_by_bot');
        break;

      // Call
      case EventEnum.CALL_START:
        posthog.capture('call_started_by_bot');
        break;

      // HTML/Applets (Bot initiated)
      case EventEnum.HTML_CREATED:
        posthog.capture('html_created_by_bot', { appletId: rawPayload?.appletId, title: rawPayload?.title });
        break;
      case EventEnum.HTML_UPDATED:
        posthog.capture('html_updated_by_bot', { appletId: rawPayload?.appletId });
        break;
      case EventEnum.HTML_LOADED:
        posthog.capture('html_loaded_by_bot', { appletId: rawPayload?.appletId });
        break;
      case EventEnum.HTML_GENERATION_REQUESTED:
        posthog.capture('html_generation_requested_by_bot', { contentType: rawPayload?.contentType });
        break;
      case EventEnum.APPLET_OPEN:
        posthog.capture('applet_opened_by_bot', { appletId: rawPayload?.appletId });
        break;
      case EventEnum.APPLET_CLOSE:
        posthog.capture('applet_closed_by_bot', { appletId: rawPayload?.appletId });
        break;
      case EventEnum.APPLET_UPDATED:
        posthog.capture('applet_updated_by_bot', { appletId: rawPayload?.appletId });
        break;
      case EventEnum.APPLET_SHARE_OPEN:
        posthog.capture('applet_share_opened_by_bot', { appletId: rawPayload?.appletId });
        break;
      case EventEnum.ONBOARDING_COMPLETE:
        posthog.capture('onboarding_completed_by_bot');
        break;

      // System / Daily / Admin events
      case EventEnum.ASSISTANT_STARTED:
        posthog.capture('assistant_started_by_bot');
        break;
      case EventEnum.DAILY_PARTICIPANT_FIRST_JOIN:
        posthog.capture('daily_participant_first_join', { participantId: rawPayload?.participantId });
        break;
      case EventEnum.DAILY_CALL_ERROR:
        posthog.capture('daily_call_error', { error: rawPayload?.error });
        break;
      case EventEnum.DAILY_PARTICIPANT_JOIN:
        posthog.capture('daily_participant_join', { participantId: rawPayload?.participantId });
        break;
      case EventEnum.DAILY_PARTICIPANT_LEAVE:
        posthog.capture('daily_participant_leave', { participantId: rawPayload?.participantId });
        break;
      case EventEnum.DAILY_CALL_STATE:
        posthog.capture('daily_call_state_change', { state: rawPayload?.state });
        break;
      case EventEnum.DAILY_PARTICIPANTS_CHANGE:
        posthog.capture('daily_participants_change', { count: rawPayload?.count });
        break;
      case EventEnum.DAILY_PARTICIPANT_IDENTITY:
        posthog.capture('daily_participant_identity', { identity: rawPayload?.identity });
        break;
      case EventEnum.DAILY_BOT_HEARTBEAT:
        // High volume event, maybe skip or sample? capturing for now.
        posthog.capture('daily_bot_heartbeat');
        break;
      case EventEnum.BOT_CONVERSATION_PACING_BEAT:
        posthog.capture('bot_conversation_pacing_beat');
        break;
      case EventEnum.ADMIN_PROMPT_MESSAGE:
        posthog.capture('admin_prompt_message');
        break;
      case EventEnum.ADMIN_PROMPT_RESPONSE:
        posthog.capture('admin_prompt_response');
        break;
      case EventEnum.LLM_CONTEXT_MESSAGE:
        posthog.capture('llm_context_message');
        break;
      case EventEnum.RESOURCE_ACCESS_CHANGED:
        posthog.capture('resource_access_changed_by_bot', { resourceId: rawPayload?.resourceId });
        break;

      default:
        // Fallback for unknown events
        posthog.capture('nia_event_routed', {
          event: envelope.event,
          eventEnum: eventEnum || 'unknown',
          payloadKeys: envelope.payload ? Object.keys(envelope.payload) : []
        });
        break;
    }
  }

  const shouldDispatchAppletRefresh =
    eventEnum === EventEnum.HTML_CREATED ||
    eventEnum === EventEnum.HTML_UPDATED ||
    eventEnum === EventEnum.HTML_ROLLBACK_REQUESTED;

  if (shouldDispatchAppletRefresh) {
    const refreshDetail: NiaEventDetail<TPayload> = {
      ...detail,
      event: EventEnum.APPLET_REFRESH,
    };
    dispatchEvent(NIA_EVENT_APPLET_REFRESH, refreshDetail);
  }

  const routed = eventEnum ? ROUTED_EVENT_NAMES[eventEnum] : undefined;
  if (routed) {
    dispatchEvent(routed, detail);
  }

  // String-based routing for events not yet in EventEnum (e.g., experience.*)
  const stringRouted = STRING_ROUTED_EVENT_NAMES[envelope.event];
  if (stringRouted) {
    dispatchEvent(stringRouted, detail);
  }

  dispatchEvent(NIA_EVENT_ALL, detail);
}
