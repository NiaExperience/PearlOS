/**
 * Shared close button HTML for Wonder Canvas scenes.
 * Used by desktop app launchers and the browser-window app.open handler.
 *
 * Styling is handled globally by the wonder-canvas-runtime CSS
 * (.wonder-close-btn class). No inline styles needed here -- the runtime
 * provides responsive sizing, safe-area positioning, and hover states
 * for all viewports automatically.
 */
export function closeButtonHTML(): string {
  return `<button class="wonder-close-btn"
  onclick="window.parent.postMessage({type:'wonder.interaction',action:'close',label:'Close scene'},'*')"
  aria-label="Close">✕</button>`;
}
