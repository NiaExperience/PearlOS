"use client";

import React, { useCallback, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { WindowDescriptor } from "../lib/WindowManagerContext";
import { isPearlOSNativeView, useWindowManager } from "../lib/WindowManagerContext";
import { requestWindowClose } from "../lib/windowLifecycleController";
import CreationLaunchpad from "../../CreationLaunchpad/CreationLaunchpad";
import LaunchpadProjectView from "../../CreationLaunchpad/components/LaunchpadProjectView";
import { ErrorBoundary } from "@interface/components/ErrorBoundary";
import NotesView from "@interface/features/Notes/components/notes-view-next";
import { AgencyView, StudioView } from "@interface/features/TaskVisualization";
import { CouncilView } from "@interface/features/Council";
import { OurPearlOSView } from "@interface/features/OurPearlOS";
import { PulseView } from "@interface/features/Pulse";
import { PhotoMagicView } from "@interface/features/PhotoMagic";
import SpritesApp from "@interface/features/Sprites/SpritesApp";
import TerminalView from "@interface/features/Terminal/components/TerminalView";
import YouTubeViewWrapper from "@interface/features/YouTube/components/YouTubeViewWrapper";
import GmailViewWithAuth from "@interface/features/Gmail/components/GmailViewWithAuth";
import GoogleDriveView from "@interface/features/GoogleDrive/components/GoogleDriveView";
import FilesView from "@interface/features/Files/components/FilesView";
import { buildNewsHTML } from "@interface/lib/news-app-html";
import MiniBrowserView from "@interface/features/MiniBrowser/components/MiniBrowserView";
import { AppearancePanel } from "@interface/components/settings-panels/AppearancePanel";
import SettingsPanels from "@interface/components/settings-panels/SettingsPanels";

// ─── Placeholder content renderers ─────────────────────────────────
// In production these would lazy-load the actual feature components.
// For now they render styled placeholders or iframes.

const PlaceholderContent: React.FC<{ win: WindowDescriptor }> = ({ win }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      height: "100%",
      color: "#d4c0e8",
      fontSize: 14,
      fontFamily: "Gohufont, monospace",
      opacity: 0.6,
    }}
  >
    {win.title} — coming soon
  </div>
);

const CreationLabContent: React.FC = () => (
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      height: "100%",
      backgroundColor: "#0a0614",
      color: "#faf8f5",
      fontFamily: "Gohufont, monospace",
    }}
  >
    {/* Header */}
    <div
      style={{
        padding: "16px 20px",
        borderBottom: "1px solid rgba(123, 63, 142, 0.2)",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <span style={{ fontSize: 22 }}>🎨</span>
      <div>
        <div style={{ fontSize: 16, fontWeight: 600 }}>Creation Lab</div>
        <div style={{ fontSize: 12, color: "#d4c0e8", opacity: 0.6 }}>
          AI-powered game & experience creation
        </div>
      </div>
    </div>
    {/* Content area */}
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: 24,
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: 80,
          height: 80,
          borderRadius: 20,
          background: "linear-gradient(135deg, #D94F8E33, #7B3F8E33)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 36,
        }}
      >
        🎨
      </div>
      <div style={{ fontSize: 18, fontWeight: 600 }}>Create something wonderful</div>
      <div style={{ fontSize: 13, color: "#d4c0e8", opacity: 0.7, maxWidth: 320 }}>
        Ask Pearl to create games, interactive scenes, visualizations, or creative experiences using the Creation Lab pipeline.
      </div>
      <div
        style={{
          marginTop: 8,
          padding: "8px 16px",
          borderRadius: 12,
          border: "1px solid rgba(217, 79, 142, 0.3)",
          background: "rgba(217, 79, 142, 0.1)",
          fontSize: 12,
          color: "#D94F8E",
        }}
      >
        Try: "Pearl, create a space exploration game"
      </div>
    </div>
  </div>
);

const IframeContent: React.FC<{ url: string; version?: number }> = ({ url, version }) => (
  <iframe
    key={`iframe-url-${version ?? 0}`}
    src={url}
    title="Content"
    style={{
      width: "100%",
      height: "100%",
      border: "none",
      borderRadius: "0 0 16px 16px",
    }}
    sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
  />
);

const HtmlContent: React.FC<{ html: string; version?: number }> = ({ html, version }) => {
  // Wrap HTML content with error boundary to prevent canvas JS errors from
  // propagating to parent frame and cascading to Daily voice session teardown.
  let safeHtml = html.includes('<script')
    ? html.replace('</body>', `<script>window.onerror=function(m,s,l,c,e){console.warn('[WonderCanvas] Script error caught:',m);return true;}</script></body>`)
    : html;

  // Frame-lock: ensure srcDoc HTML can't pinch-zoom or chain-overscroll the
  // shell, even when the user-supplied HTML omits a viewport meta entirely.
  const frameLockMeta = '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />';
  const frameLockStyle = '<style>html,body{touch-action:pan-x pan-y;-webkit-text-size-adjust:100%;overscroll-behavior:contain;}</style>';
  if (!/<meta\s+name=["']viewport["']/i.test(safeHtml)) {
    if (safeHtml.includes('<head>')) {
      safeHtml = safeHtml.replace('<head>', `<head>${frameLockMeta}${frameLockStyle}`);
    } else if (/<html[^>]*>/i.test(safeHtml)) {
      safeHtml = safeHtml.replace(/<html([^>]*)>/i, `<html$1><head>${frameLockMeta}${frameLockStyle}</head>`);
    } else {
      safeHtml = `<!DOCTYPE html><html><head>${frameLockMeta}${frameLockStyle}</head><body>${safeHtml}</body></html>`;
    }
  } else if (safeHtml.includes('</head>')) {
    safeHtml = safeHtml.replace('</head>', `${frameLockStyle}</head>`);
  }

  const pearlThemeBridge = `<script>(function(){try{var parentDoc=window.parent&&window.parent.document;if(!parentDoc)return;var parentRoot=parentDoc.documentElement;var theme=parentRoot.getAttribute('data-pearl-theme');if(theme)document.documentElement.setAttribute('data-pearl-theme',theme);var computed=window.parent.getComputedStyle(parentRoot);['--pearl-ui-font','--pearl-shell-bg','--pearl-stage-bg','--pearl-desktop-stage-bg','--pearl-panel-bg','--pearl-panel-muted-bg','--pearl-panel-border','--pearl-panel-backdrop','--pearl-text','--pearl-muted','--pearl-soft','--pearl-accent','--pearl-radius','--pearl-window-bg','--pearl-window-content-bg','--pearl-window-border','--pearl-window-backdrop','--pearl-window-title-bg','--pearl-window-control-bg','--pearl-window-control-hover-bg','--pearl-window-control-border','--pearl-window-control-hover-border','--pearl-window-shadow'].forEach(function(name){var value=computed.getPropertyValue(name);if(value)document.documentElement.style.setProperty(name,value);});}catch(e){console.warn('[PearlTheme] iframe theme sync failed',e);}})();</script>`;
  if (safeHtml.includes('</head>')) {
    safeHtml = safeHtml.replace('</head>', `${pearlThemeBridge}</head>`);
  }

  return (
    <iframe
      key={`iframe-html-${version ?? 0}`}
      srcDoc={safeHtml}
      title="Content"
      style={{
        width: "100%",
        height: "100%",
        border: "none",
        borderRadius: 0,
        backgroundColor: "transparent",
      }}
      sandbox="allow-scripts allow-same-origin"
    />
  );
};

const SettingsContent: React.FC = () => (
  <div
    style={{
      height: "100%",
      padding: "24px",
      color: "#faf8f5",
      fontFamily: "Gohufont, monospace",
      overflowY: "auto",
      background: "var(--pearl-window-content-bg, #0a0614)",
    }}
  >
    <SettingsPanels initialOpenPanel="connections" />
  </div>
);

// ─── In-App Browser with navigation chrome ────────────────────────
const BrowserContent: React.FC<{ initialUrl: string }> = ({ initialUrl }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [addressValue, setAddressValue] = useState(initialUrl);
  const [currentUrl, setCurrentUrl] = useState(initialUrl);
  const [history, setHistory] = useState<string[]>([initialUrl]);
  const [historyIndex, setHistoryIndex] = useState(0);

  const navigate = (url: string, pushHistory = true) => {
    let resolved = url.trim();
    if (!resolved) return;
    if (!/^https?:\/\//i.test(resolved)) {
      if (resolved.includes(".") && !resolved.includes(" ")) {
        resolved = "https://" + resolved;
      } else {
        resolved = `https://www.google.com/search?igu=1&q=${encodeURIComponent(resolved)}`;
      }
    }
    setCurrentUrl(resolved);
    setAddressValue(resolved);
    if (pushHistory) {
      const newHistory = [...history.slice(0, historyIndex + 1), resolved];
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
    }
  };

  const goBack = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setCurrentUrl(history[newIndex]);
      setAddressValue(history[newIndex]);
    }
  };

  const goForward = () => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setCurrentUrl(history[newIndex]);
      setAddressValue(history[newIndex]);
    }
  };

  const refresh = () => {
    const iframe = iframeRef.current;
    if (iframe) {
      iframe.src = currentUrl;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      navigate(addressValue);
    }
  };

  const navBtnStyle: React.CSSProperties = {
    width: 28,
    height: 28,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
    border: "1px solid var(--pearl-window-control-border, transparent)",
    background: "var(--pearl-window-control-bg, transparent)",
    color: "var(--pearl-text, #d4c0e8)",
    cursor: "pointer",
    fontSize: 14,
    lineHeight: 1,
    flexShrink: 0,
    transition: "background 0.15s, opacity 0.15s",
  };

  return (
    <div
      className="pearl-app-window-content"
      style={{ display: "flex", flexDirection: "column", height: "100%" }}
    >
      {/* Navigation bar */}
      <div
        className="pearl-app-window-titlebar"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "6px 10px",
          borderBottom: "1px solid var(--pearl-window-border, rgba(123, 63, 142, 0.2))",
          flexShrink: 0,
        }}
      >
        <button
          onClick={goBack}
          style={{ ...navBtnStyle, opacity: historyIndex > 0 ? 1 : 0.3 }}
          disabled={historyIndex <= 0}
          aria-label="Back"
          title="Back"
        >
          ←
        </button>
        <button
          onClick={goForward}
          style={{ ...navBtnStyle, opacity: historyIndex < history.length - 1 ? 1 : 0.3 }}
          disabled={historyIndex >= history.length - 1}
          aria-label="Forward"
          title="Forward"
        >
          →
        </button>
        <button onClick={refresh} style={navBtnStyle} aria-label="Refresh" title="Refresh">
          ↻
        </button>
        <input
          type="text"
          value={addressValue}
          onChange={(e) => setAddressValue(e.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          style={{
            flex: 1,
            height: 28,
            padding: "0 10px",
            borderRadius: 8,
            border: "1px solid var(--pearl-window-border, rgba(123, 63, 142, 0.3))",
            background: "var(--pearl-panel-muted-bg, rgba(255,255,255,0.05))",
            color: "var(--pearl-text, #faf8f5)",
            fontSize: 12,
            fontFamily: "var(--pearl-ui-font, Gohufont, monospace)",
            outline: "none",
            transition: "border-color 0.15s",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "var(--pearl-window-control-hover-border, rgba(217, 79, 142, 0.5))";
            e.currentTarget.select();
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "var(--pearl-window-border, rgba(123, 63, 142, 0.3))";
          }}
        />
        <button
          onClick={() => navigate(addressValue)}
          style={{ ...navBtnStyle, fontSize: 13 }}
          aria-label="Go"
          title="Go"
        >
          ⏎
        </button>
      </div>
      {/* Iframe */}
      <iframe
        ref={iframeRef}
        src={currentUrl}
        title="Web Browser"
        style={{
          flex: 1,
          width: "100%",
          border: "none",
          borderRadius: "0 0 16px 16px",
          backgroundColor: "#fff",
        }}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
      />
    </div>
  );
};

interface RenderContext {
  assistantName: string;
  onClose: () => void;
}

function renderContent(win: WindowDescriptor, ctx: RenderContext) {
  if (win.viewType === "settings") return <SettingsContent />;
  if (win.viewType === "styles") {
    return (
      <ErrorBoundary name="Styles">
        <div
          style={{
            height: "100%",
            overflowY: "auto",
            padding: "24px",
            background: "var(--pearl-window-content-bg, #0a0614)",
          }}
        >
          <AppearancePanel title="Styles" description="Theme, backgrounds, and desktop icons" />
        </div>
      </ErrorBoundary>
    );
  }
  if (win.viewType === "creation") return <CreationLabContent />;
  if (win.viewType === "creationLaunchpad") return <CreationLaunchpad />;
  if (win.viewType === "launchpadProject") {
    // Accept the projectId from either `meta` (the WindowManagerContext
    // path) or `viewState` (the legacy browser-window path). Earlier
    // gray-screen reports came from the rendering surface that lost the
    // id when a request only carried one of the two. See SPECTRUM bug #5.
    const fromMeta = win.meta?.launchpadProjectId as string | undefined;
    const fromViewState = (win as unknown as { viewState?: { launchpadProjectId?: string } }).viewState?.launchpadProjectId;
    const projectId = fromMeta || fromViewState;
    if (projectId) return <LaunchpadProjectView projectId={projectId} />;
    // Falling through here is the previous "gray screen" — surface a
    // visible message so future drift is loud, not silent.
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          color: "#ff9bb6",
          fontSize: 13,
          fontFamily: "Gohufont, monospace",
          padding: 24,
          textAlign: "center",
        }}
      >
        Launchpad project window opened without a project id.<br />
        Please reopen from the project list.
      </div>
    );
  }
  if (win.viewType === "notes") {
    return (
      <ErrorBoundary name="Notes">
        <NotesView
          assistantName={(win.meta?.assistantName as string) || ctx.assistantName}
          supportedFeatures={win.meta?.supportedFeatures as string[] | undefined}
          tenantId={win.meta?.tenantId as string | undefined}
          initialNoteId={win.viewState?.openNoteId}
          onClose={ctx.onClose}
        />
      </ErrorBoundary>
    );
  }
  if (win.viewType === "youtube") {
    const query = (win.meta?.youtubeQuery as string)
      || ((win as unknown as { viewState?: { youtubeQuery?: string } }).viewState?.youtubeQuery)
      || "";
    return (
      <ErrorBoundary name="YouTube">
        <YouTubeViewWrapper
          query={query}
          assistantName={(win.meta?.assistantName as string) || ctx.assistantName}
        />
      </ErrorBoundary>
    );
  }
  if (win.viewType === "googleDrive") {
    return (
      <ErrorBoundary name="GoogleDrive">
        <GoogleDriveView />
      </ErrorBoundary>
    );
  }
  if (win.viewType === "gmail") {
    return (
      <ErrorBoundary name="Gmail">
        <GmailViewWithAuth />
      </ErrorBoundary>
    );
  }
  if (win.viewType === "terminal") {
    return <TerminalView />;
  }
  if (win.viewType === "miniBrowser") {
    return (
      <MiniBrowserView
        initialUrl={win.viewState?.browserUrl || win.url || "https://www.google.com"}
        presentation={win.viewState?.miniBrowserPresentation || "browser"}
      />
    );
  }
  if (win.viewType === "files" || win.viewType === "docs") {
    return (
      <ErrorBoundary name="FileSpace">
        <FilesView
          initialPath={win.viewState?.fileSpacePath}
          initialSearchQuery={win.viewState?.fileSearchQuery}
          initialSearchNonce={win.viewState?.fileSearchNonce}
        />
      </ErrorBoundary>
    );
  }
  if (win.viewType === "photoMagic") {
    return (
      <ErrorBoundary name="PhotoMagic">
        <PhotoMagicView />
      </ErrorBoundary>
    );
  }
  if (win.viewType === "sprites") {
    return (
      <ErrorBoundary name="Sprites">
        <SpritesApp />
      </ErrorBoundary>
    );
  }
  if (win.viewType === ("news" as string)) {
    const category = (win.meta?.category as string) || undefined;
    const newsHtml = buildNewsHTML(category);
    return <HtmlContent html={newsHtml} version={win.contentVersion} />;
  }
  if (win.viewType === "pulse") {
    return (
      <ErrorBoundary name="Pulse">
        <PulseView />
      </ErrorBoundary>
    );
  }
  if (win.viewType === ("weather" as string)) {
    // Weather is rendered as HTML content via Wonder Canvas.
    // If the window was opened with pre-built HTML, use it.
    if (win.html) return <HtmlContent html={win.html} version={win.contentVersion} />;
    return <PlaceholderContent win={win} />;
  }
  if (win.viewType === "browser" && win.url) return <BrowserContent initialUrl={win.url} />;
  if (win.viewType === "agency") {
    return (
      <ErrorBoundary name="TheAgency">
        <AgencyView />
      </ErrorBoundary>
    );
  }
  if (win.viewType === "council") {
    return (
      <ErrorBoundary name="Council">
        <CouncilView />
      </ErrorBoundary>
    );
  }
  if (win.viewType === "studio") {
    return (
      <ErrorBoundary name="TheStudio">
        <StudioView />
      </ErrorBoundary>
    );
  }
  if (win.viewType === "ourPearlos") {
    return (
      <ErrorBoundary name="OurPearlOS">
        <OurPearlOSView />
      </ErrorBoundary>
    );
  }
  if (win.html) return <HtmlContent html={win.html} version={win.contentVersion} />;
  if (win.url) return <IframeContent url={win.url} version={win.contentVersion} />;
  return <PlaceholderContent win={win} />;
}

// ─── Content Panel ──────────────────────────────────────────────────
interface ContentPanelProps {
  win: WindowDescriptor;
}

const ContentPanel: React.FC<ContentPanelProps> = ({ win }) => {
  const { closeWindow, focusWindow, state } = useWindowManager();
  const pathname = usePathname();
  // Extract assistantName from URL path: /[assistantId]/...
  const assistantName = pathname?.split("/").filter(Boolean)[0] || "Pearl";
  const isCinematicFullscreen =
    win.meta?.wonder === true ||
    win.meta?.cinematic === true ||
    (win.viewType === "custom" && win.meta?.fullscreen === true);
  const isContentOnly = state.layout === "content-only";

  const handleClose = useCallback(() => {
    if (isPearlOSNativeView(win.viewType)) {
      requestWindowClose({
        viewType: win.viewType,
        source: "content-panel:close",
        reason: "native-window-close-button",
      });
      return;
    }
    closeWindow({ windowId: win.id });
  }, [closeWindow, win.id, win.viewType]);

  const handleFocus = useCallback(() => {
    focusWindow(win.id);
  }, [focusWindow, win.id]);

  // Full-screen cinematic mode: no borders, just content.
  if (isCinematicFullscreen && isContentOnly) {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          position: "relative",
          overflow: "hidden",
          backgroundColor: "#0a0614",
        }}
      >
        {/* Floating close button */}
        <button
          onClick={handleClose}
          aria-label={`Close ${win.title}`}
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            zIndex: 1000,
            width: 32,
            height: 32,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "50%",
            border: "1px solid rgba(255,255,255,0.2)",
            background: "rgba(0,0,0,0.5)",
            backdropFilter: "blur(8px)",
            color: "#faf8f5",
            cursor: "pointer",
            fontSize: 18,
            lineHeight: 1,
            transition: "all 0.15s",
          }}
          onMouseEnter={(e) => {
            (e.target as HTMLElement).style.background = "rgba(255,255,255,0.2)";
          }}
          onMouseLeave={(e) => {
            (e.target as HTMLElement).style.background = "rgba(0,0,0,0.5)";
          }}
        >
          ×
        </button>
        <div style={{ width: "100%", height: "100%" }}>{renderContent(win, { assistantName, onClose: handleClose })}</div>
      </div>
    );
  }

  return (
    <div
      onPointerDown={handleFocus}
      className="pearl-app-window"
      data-pearl-app-window="true"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        borderRadius: "calc(var(--pearl-radius, 8px) + 8px)",
        overflow: "hidden",
        border: "1px solid var(--pearl-window-border, rgba(123, 63, 142, 0.25))",
        zIndex: win.zIndex,
        position: "relative",
      }}
    >
      {/* Floating close button — anchored to the top-right corner of the window */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          handleClose();
        }}
        aria-label={`Close ${win.title}`}
        className="pearl-app-window-control"
        style={{
          position: "absolute",
          top: 6,
          right: 6,
          zIndex: 1000,
          width: 32,
          height: 32,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "50%",
          border: "1px solid var(--pearl-window-control-border, rgba(255, 210, 51, 0.35))",
          cursor: "pointer",
          fontSize: 18,
          fontWeight: 600,
          lineHeight: 1,
          boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
          transition: "all 0.15s",
        }}
      >
        ×
      </button>

      {/* Content area */}
      <div className="pearl-app-window-content" style={{ flex: 1, minHeight: 0, overflow: "hidden auto" }}>
        {renderContent(win, { assistantName, onClose: handleClose })}
      </div>
    </div>
  );
};

export default ContentPanel;
