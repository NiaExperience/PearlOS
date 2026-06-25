/**
 * events/index.ts
 * 
 * Central export for event routing system
 */

export {
  routeNiaEvent,
  initializeNiaEventRouter,
  closeWindows,
  EventEnum,
  NIA_EVENT_DESKTOP_MODE_SWITCH,
  NIA_EVENT_LAYOUT_MODE_SWITCH,
  NIA_EVENT_VIEW_CLOSE,
  NIA_EVENT_ONBOARDING_COMPLETE,
  NIA_EVENT_WONDER_SCENE,
  NIA_EVENT_WONDER_ADD,
  NIA_EVENT_WONDER_REMOVE,
  NIA_EVENT_WONDER_CLEAR,
  NIA_EVENT_WONDER_ANIMATE,
} from './niaEventRouter';
