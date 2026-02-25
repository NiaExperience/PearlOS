/**
 * Shared close button HTML for Wonder Canvas scenes.
 * Used by desktop app launchers and the browser-window app.open handler.
 */
export function closeButtonHTML(): string {
  return `<button onclick="window.parent.postMessage({type:'wonder.interaction',action:'close',label:'Close scene'},'*')"
  style="position:fixed;top:16px;right:16px;z-index:9999;display:flex;align-items:center;gap:6px;
  background:rgba(15,8,32,0.7);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
  border:1px solid rgba(255,255,255,0.15);border-radius:100px;padding:8px 16px;
  color:#d4c0e8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  font-size:13px;font-weight:600;cursor:pointer;transition:all 0.2s ease;letter-spacing:0.03em;"
  onmouseover="this.style.background='rgba(15,8,32,0.9)';this.style.borderColor='rgba(255,211,51,0.4)';this.style.color='#FFD233'"
  onmouseout="this.style.background='rgba(15,8,32,0.7)';this.style.borderColor='rgba(255,255,255,0.15)';this.style.color='#d4c0e8'"
  >✕ Close</button>`;
}
