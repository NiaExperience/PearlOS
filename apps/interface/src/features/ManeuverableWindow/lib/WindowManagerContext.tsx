"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";

import {
  WINDOW_OPEN_EVENT,
  WINDOW_CLOSE_EVENT,
  WINDOW_FOCUS_EVENT,
  type ViewType,
  type WindowOpenRequest,
  type WindowCloseRequest,
  type WindowFocusRequest,
} from "./windowLifecycleController";
import { useDesktopMode } from "@interface/contexts/desktop-mode-context";
import { DesktopMode } from "@interface/types/desktop-modes";

// ─── Window descriptor ──────────────────────────────────────────────
export interface WindowDescriptor {
  id: string;
  viewType: ViewType;
  title: string;
  url?: string;
  html?: string;
  viewState?: WindowOpenRequest["viewState"];
  slot: "left" | "right" | "center" | "float";
  zIndex: number;
  /** 0-1 fraction of viewport */
  widthFraction: number;
  heightFraction: number;
  meta?: Record<string, unknown>;
  createdAt: number;
  /** Incremented on content updates to force iframe remount */
  contentVersion: number;
}

// ─── Layout mode ────────────────────────────────────────────────────
export type LayoutMode = "chat-only" | "split" | "content-only";

// ─── State ──────────────────────────────────────────────────────────
interface WMState {
  windows: WindowDescriptor[];
  nextZ: number;
  layout: LayoutMode;
  /** Fraction (0-1) of viewport width allocated to chat in split mode */
  chatWidthFraction: number;
}

const INITIAL_STATE: WMState = {
  windows: [],
  nextZ: 100,
  layout: "chat-only",
  chatWidthFraction: 0.38,
};

// ─── Actions ────────────────────────────────────────────────────────
type WMAction =
  | { type: "OPEN"; payload: WindowOpenRequest }
  | { type: "CLOSE"; payload: WindowCloseRequest }
  | { type: "CLOSE_ALL" }
  | { type: "FOCUS"; payload: { windowId: string } }
  | { type: "SET_LAYOUT"; payload: LayoutMode }
  | { type: "SET_CHAT_WIDTH"; payload: number };

let idCounter = 0;
function nextId() {
  return `win_${Date.now()}_${++idCounter}`;
}

const DEFAULT_TITLES: Partial<Record<NonNullable<ViewType>, string>> = {
  notes: "Notes",
  docs: "FileSpace",
  chart: "Chart",
  photoMagic: "Photo Magic",
  sprites: "Sprites",
  news: "News",
  pulse: "Pulse",
  weather: "Weather",
  discord: "Discord",
  youtube: "YouTube",
  googleDrive: "Google Drive",
  gmail: "Gmail",
  settings: "Settings",
  styles: "Styles",
  browser: "Browser",
  terminal: "Terminal",
  creation: "Creation Lab",
  creationLaunchpad: "Creation Launchpad",
  launchpadProject: "Project",
  council: "Council",
  studio: "The Studio",
  ourPearlos: "Our PearlOS",
  wonderCanvas: "Wonder Canvas",
  custom: "Window",
};

const FULLSCREEN_PEARLOS_VIEW_TYPES = new Set<ViewType>([
  "agency",
  "council",
  "studio",
  "ourPearlos",
  "creation",
  "creationLaunchpad",
  "launchpadProject",
  "notes",
  "terminal",
  "docs",
  "files",
  "photoMagic",
  "sprites",
  "settings",
  "styles",
  "youtube",
  "news",
  "pulse",
  "weather",
  "discord",
  "googleDrive",
  "gmail",
]);

const NATIVE_PEARLOS_VIEW_TYPES = new Set<ViewType>([
  ...FULLSCREEN_PEARLOS_VIEW_TYPES,
  "browser",
  "wonderCanvas",
]);

const FULLSCREEN_WINDOW_VIEW_TYPES = new Set<ViewType>([
  ...FULLSCREEN_PEARLOS_VIEW_TYPES,
  "browser",
]);

export function isPearlOSFullscreenView(viewType: ViewType | undefined): boolean {
  return Boolean(viewType && FULLSCREEN_PEARLOS_VIEW_TYPES.has(viewType));
}

export function isPearlOSNativeView(viewType: ViewType | undefined): boolean {
  return Boolean(viewType && NATIVE_PEARLOS_VIEW_TYPES.has(viewType));
}

export function isFullscreenWindowView(viewType: ViewType | undefined): boolean {
  return Boolean(viewType && FULLSCREEN_WINDOW_VIEW_TYPES.has(viewType));
}

export function isContentOnlyWindow(win: WindowDescriptor | undefined): boolean {
  return (
    win?.meta?.fullscreen === true ||
    win?.meta?.fullscreenWindow === true ||
    (win?.meta?.wonder === true && win?.meta?.wonderLayout !== "split") ||
    isFullscreenWindowView(win?.viewType)
  );
}

export function layoutForWindows(windows: WindowDescriptor[]): LayoutMode {
  if (windows.length === 0) return "chat-only";
  const top = windows.reduce((best, win) => (win.zIndex > best.zIndex ? win : best), windows[0]);
  return isContentOnlyWindow(top) ? "content-only" : "split";
}

function reducer(state: WMState, action: WMAction): WMState {
  switch (action.type) {
    case "OPEN": {
      const req = action.payload;
      const opensFullscreenWindow = isFullscreenWindowView(req.viewType);
      const opensContentOnly =
        req.meta?.fullscreen === true ||
        req.meta?.fullscreenWindow === true ||
        (req.meta?.wonder === true && req.meta?.wonderLayout !== "split") ||
        opensFullscreenWindow;
      // If same viewType already open, just focus it
      const existing = req.options?.allowDuplicate
        ? undefined
        : state.windows.find((w) => w.viewType === req.viewType);
      if (existing) {
        const contentChanged = (req.url != null && req.url !== existing.url) ||
                               (req.html != null && req.html !== existing.html);
        const updatedWindows = state.windows.map((w) =>
          w.id === existing.id ? {
            ...w,
            zIndex: state.nextZ,
            url: req.url ?? w.url,
            html: req.html ?? w.html,
            viewState: req.viewState ?? w.viewState,
            title: req.title || w.title,
            meta: { ...w.meta, ...req.meta },
            contentVersion: contentChanged ? w.contentVersion + 1 : w.contentVersion,
          } : w
        );
        return {
          ...state,
          windows: updatedWindows,
          nextZ: state.nextZ + 1,
          layout: layoutForWindows(updatedWindows),
        };
      }

      const win: WindowDescriptor = {
        id: nextId(),
        viewType: req.viewType,
        title: req.title || (req.viewType ? DEFAULT_TITLES[req.viewType] : undefined) || "Window",
        url: req.url,
        html: req.html,
        viewState: req.viewState,
        slot: opensContentOnly ? "center" : req.slot || "right",
        zIndex: state.nextZ,
        widthFraction: opensContentOnly ? 1 : req.widthFraction ?? 0.5,
        heightFraction: opensContentOnly ? 1 : req.heightFraction ?? 1,
        meta: opensFullscreenWindow ? { ...req.meta, fullscreenWindow: true } : req.meta,
        createdAt: Date.now(),
        contentVersion: 0,
      };

      return {
        ...state,
        windows: [...state.windows, win],
        nextZ: state.nextZ + 1,
        layout: opensContentOnly ? "content-only" : "split",
      };
    }

    case "CLOSE_ALL":
      return { ...state, windows: [], layout: "chat-only" };

    case "CLOSE": {
      const { windowId, viewType } = action.payload;
      const remaining = state.windows.filter((w) => {
        if (windowId && w.id === windowId) return false;
        if (viewType && w.viewType === viewType) return false;
        return true;
      });
      return {
        ...state,
        windows: remaining,
        layout: layoutForWindows(remaining),
      };
    }

    case "FOCUS": {
      const { windowId } = action.payload;
      const updatedWindows = state.windows.map((w) =>
        w.id === windowId ? { ...w, zIndex: state.nextZ } : w
      );
      return {
        ...state,
        windows: updatedWindows,
        nextZ: state.nextZ + 1,
        layout: layoutForWindows(updatedWindows),
      };
    }

    case "SET_LAYOUT":
      return { ...state, layout: action.payload };

    case "SET_CHAT_WIDTH":
      return {
        ...state,
        chatWidthFraction: Math.max(0.2, Math.min(0.8, action.payload)),
      };

    default:
      return state;
  }
}

// ─── Context ────────────────────────────────────────────────────────
interface WindowManagerContextValue {
  state: WMState;
  openWindow: (req: WindowOpenRequest) => void;
  closeWindow: (req?: WindowCloseRequest) => void;
  focusWindow: (id: string) => void;
  setLayout: (mode: LayoutMode) => void;
  setChatWidth: (fraction: number) => void;
}

const WindowManagerContext = createContext<WindowManagerContextValue | null>(
  null
);

export function useWindowManager() {
  const ctx = useContext(WindowManagerContext);
  if (!ctx) throw new Error("useWindowManager must be inside WindowManagerProvider");
  return ctx;
}

// ─── Provider ───────────────────────────────────────────────────────
export const WindowManagerProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

  useEffect(() => {
    const globalWindow = window as typeof window & { __pearlNativeWindowManagerCount?: number; __pearlNativeWindowManagerReady?: boolean };
    globalWindow.__pearlNativeWindowManagerCount = (globalWindow.__pearlNativeWindowManagerCount || 0) + 1;
    globalWindow.__pearlNativeWindowManagerReady = true;
    return () => {
      globalWindow.__pearlNativeWindowManagerCount = Math.max(0, (globalWindow.__pearlNativeWindowManagerCount || 1) - 1);
      globalWindow.__pearlNativeWindowManagerReady = globalWindow.__pearlNativeWindowManagerCount > 0;
    };
  }, []);

  // ── Clear windows when desktop mode leaves WORK ──────────────────
  // Voice tools and other features can open windows while in WORK mode.
  // When the user switches to HOME (or any non-WORK mode), those windows
  // must be cleared so they don't appear as phantom blank panels.
  const { currentMode } = useDesktopMode();
  const prevModeRef = useRef(currentMode);
  useEffect(() => {
    const prev = prevModeRef.current;
    prevModeRef.current = currentMode;

    if (prev === DesktopMode.DESKTOP && currentMode !== DesktopMode.DESKTOP) {
      dispatch({ type: "CLOSE_ALL" });
    }
  }, [currentMode]);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('pearlos:open-windows-changed', {
        detail: {
          source: 'split-window-manager',
          viewTypes: state.windows.map((entry) => entry.viewType),
        },
      })
    );
  }, [state.windows]);

  const openWindow = useCallback(
    (req: WindowOpenRequest) => dispatch({ type: "OPEN", payload: req }),
    []
  );
  const closeWindow = useCallback(
    (req: WindowCloseRequest = {}) => dispatch({ type: "CLOSE", payload: req }),
    []
  );
  const focusWindow = useCallback(
    (id: string) => dispatch({ type: "FOCUS", payload: { windowId: id } }),
    []
  );
  const setLayout = useCallback(
    (mode: LayoutMode) => dispatch({ type: "SET_LAYOUT", payload: mode }),
    []
  );
  const setChatWidth = useCallback(
    (f: number) => dispatch({ type: "SET_CHAT_WIDTH", payload: f }),
    []
  );

  // ─── Listen for global custom events ──────────────────────────────
  // BrowserWindow also listens to these lifecycle events. The native manager
  // owns PearlOS-native apps; the legacy browser shell owns external browser
  // surfaces such as miniBrowser/enhancedBrowser.
  useEffect(() => {
    const isChatSource = (source?: string) => {
      if (!source) return false;
      return source.startsWith('chat-') || source.startsWith('chat:') || source.startsWith('splitchat:');
    };
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<WindowOpenRequest>).detail;
      if (!isChatSource(detail?.source) && !isPearlOSNativeView(detail?.viewType) && detail?.meta?.fullscreenWindow !== true) return;
      openWindow(detail);
    };
    const onClose = (e: Event) => {
      const detail = (e as CustomEvent<WindowCloseRequest>).detail;
      if (!isChatSource(detail?.source) && !isPearlOSNativeView(detail?.viewType)) return;
      closeWindow(detail);
    };
    const onFocus = (e: Event) => {
      const detail = (e as CustomEvent<WindowFocusRequest>).detail;
      focusWindow(detail.windowId);
    };

    window.addEventListener(WINDOW_OPEN_EVENT, onOpen);
    window.addEventListener(WINDOW_CLOSE_EVENT, onClose);
    window.addEventListener(WINDOW_FOCUS_EVENT, onFocus);

    return () => {
      window.removeEventListener(WINDOW_OPEN_EVENT, onOpen);
      window.removeEventListener(WINDOW_CLOSE_EVENT, onClose);
      window.removeEventListener(WINDOW_FOCUS_EVENT, onFocus);
    };
  }, [openWindow, closeWindow, focusWindow]);

  const value = useMemo(
    () => ({ state, openWindow, closeWindow, focusWindow, setLayout, setChatWidth }),
    [state, openWindow, closeWindow, focusWindow, setLayout, setChatWidth]
  );

  return (
    <WindowManagerContext.Provider value={value}>
      {children}
    </WindowManagerContext.Provider>
  );
};
