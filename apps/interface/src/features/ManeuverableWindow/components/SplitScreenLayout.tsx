"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useWindowManager } from "../lib/WindowManagerContext";
import ContentPanel from "./ContentPanel";

const MOBILE_BREAKPOINT_PX = 768;

function useIsMobileViewport(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT_PX);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return isMobile;
}

/**
 * SplitScreenLayout
 *
 * Renders a resizable two-pane layout:
 *   LEFT  — Chat (always visible, persistent)
 *   RIGHT — Content panels (stacked tabs when multiple)
 *
 * When no content windows are open the chat expands to fill the screen.
 * A draggable divider lets users adjust the split ratio.
 */
const SplitScreenLayout: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { state, closeWindow, focusWindow } = useWindowManager();
  const { windows, layout, chatWidthFraction } = state;
  const { setChatWidth } = useWindowManager();
  const isMobile = useIsMobileViewport();

  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const [dragActive, setDragActive] = useState(false);

  // ── Drag-to-resize divider ──────────────────────────────────────
  // On desktop the divider runs vertically and resizes width.
  // On mobile (<768px) the layout stacks; the divider runs horizontally
  // and resizes height instead.
  const startDrag = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      isDragging.current = true;
      setDragActive(true);
      const el = containerRef.current;
      if (!el) return;

      const onMove = (ev: PointerEvent) => {
        if (!isDragging.current || !el) return;
        const rect = el.getBoundingClientRect();
        const fraction = isMobile
          ? (ev.clientY - rect.top) / rect.height
          : (ev.clientX - rect.left) / rect.width;
        setChatWidth(fraction);
      };

      const onUp = () => {
        isDragging.current = false;
        setDragActive(false);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [setChatWidth, isMobile]
  );

  const hasContent = windows.length > 0 && layout !== "chat-only";
  const isContentOnly = layout === "content-only";
  const activeWindows = [...windows].sort((a, b) => a.zIndex - b.zIndex);
  const topWindow = activeWindows[activeWindows.length - 1];

  // ── Tab bar when multiple content windows ───────────────────────
  const tabBar =
    windows.length > 1 && !isContentOnly ? (
      <div
        className="pearl-app-window-tabs"
        style={{
          display: "flex",
          gap: 2,
          padding: "4px 8px",
          borderBottom: "1px solid var(--pearl-window-border, rgba(123, 63, 142, 0.15))",
          overflowX: "auto",
          flexShrink: 0,
        }}
      >
        {windows.map((w) => (
          <button
            key={w.id}
            onClick={() => focusWindow(w.id)}
            className="pearl-app-window-tab"
            data-active={topWindow?.id === w.id ? "true" : "false"}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 12px",
              borderRadius: 8,
              border: "1px solid transparent",
              cursor: "pointer",
              fontSize: 12,
              fontFamily: "var(--pearl-ui-font, Gohufont, monospace)",
              transition: "all 0.15s",
              whiteSpace: "nowrap",
            }}
          >
            <span style={{ fontSize: 12 }}>{w.title}</span>
            <span
              onClick={(e) => {
                e.stopPropagation();
                closeWindow({ windowId: w.id });
              }}
              style={{
                marginLeft: 4,
                opacity: 0.5,
                cursor: "pointer",
                fontSize: 14,
                lineHeight: 1,
              }}
            >
              ×
            </span>
          </button>
        ))}
      </div>
    ) : null;

  return (
    <div
      ref={containerRef}
      style={{
        display: "flex",
        flexDirection: isMobile ? "column" : "row",
        width: "100%",
        height: "100%",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* ── Chat pane ──────────────────────────────────────────────
       * In split / chat-only modes the pane is part of the flex flow
       * (left on desktop, top on mobile, sized by chatWidthFraction
       * or full width).
       * In content-only mode (fullscreen Wonder Canvas) the pane is
       * promoted to a fixed overlay that covers the viewport with
       * pointer-events: none on the wrapper. ChatMode's inner chat bar
       * re-enables pointer events on its own row, so the input bar
       * stays visible and clickable above the canvas while clicks on
       * empty space still pass through to the content beneath. Without
       * this the pane was display:none and the user had no way to type
       * to Pearl during any fullscreen scene (Weather, News, Discord). */}
      <div
        style={{
          width: isContentOnly
            ? "100%"
            : isMobile
              ? "100%"
              : hasContent
                ? `${chatWidthFraction * 100}%`
                : "100%",
          height: isContentOnly
            ? "100%"
            : isMobile
              ? hasContent
                ? `${chatWidthFraction * 100}%`
                : "100%"
              : "100%",
          transition: dragActive
            ? "none"
            : isMobile
              ? "height 0.3s ease"
              : "width 0.3s ease",
          position: isContentOnly ? "fixed" : "relative",
          inset: isContentOnly ? 0 : undefined,
          zIndex: isContentOnly ? 100 : undefined,
          pointerEvents: isContentOnly ? "none" : undefined,
          flexShrink: 0,
          overflow: "hidden",
          order: isMobile && hasContent && !isContentOnly ? 3 : 1,
        }}
      >
        {children}
      </div>

      {/* ── Resizable divider ────────────────────────────────────── */}
      {hasContent && !isContentOnly && (
        <div
          onPointerDown={startDrag}
          className="pearl-app-window-divider"
          data-active={dragActive ? "true" : "false"}
          style={{
            width: isMobile ? "100%" : 6,
            height: isMobile ? 6 : undefined,
            cursor: isMobile ? "row-resize" : "col-resize",
            transition: "background 0.15s",
            flexShrink: 0,
            position: "relative",
            zIndex: 200,
            // Page wrapper sets pointer-events:none so empty chat space passes
            // clicks through to desktop icons. Re-enable here so the divider
            // can be grabbed for resizing.
            pointerEvents: "auto",
            order: isMobile ? 2 : 2,
          }}
        >
          {/* Visual grip dots */}
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              display: "flex",
              flexDirection: isMobile ? "row" : "column",
              gap: 3,
            }}
          >
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  width: 3,
                  height: 3,
                  borderRadius: "50%",
                  background: "rgba(212,192,232,0.4)",
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Content pane ─────────────────────────────────────────── */}
      {hasContent && (
        <div
          style={{
            flex: 1,
            height: "100%",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            position: "relative",
            padding: isContentOnly
              ? 0
              : isMobile
                ? "8px 8px 8px 8px"
                : "8px 0 8px 8px",
            gap: 0,
            // Page wrapper (page.tsx) sets pointer-events:none so the chat
            // overlay doesn't block desktop icons. Re-enable on the content
            // pane so window chrome (close button, tabs, content interaction)
            // is clickable. Without this the X never receives the click.
            pointerEvents: "auto",
            order: isMobile ? 1 : 3,
          }}
        >
          {tabBar}

          {/* Render the top-most window */}
          <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
            {topWindow && <ContentPanel win={topWindow} />}
          </div>
        </div>
      )}
    </div>
  );
};

export default SplitScreenLayout;
