/**
 * Meeting Notes — accumulates transcript segments and generates structured
 * meeting notes for display on Wonder Canvas or export to PearlOS Notes.
 */

import { getClientLogger } from '@interface/lib/client-logger';

const log = getClientLogger('[meeting_notes]');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TranscriptSegment {
  speaker: string;
  text: string;
  timestamp: number; // epoch ms
}

export interface MeetingNotes {
  title: string;
  startedAt: number;
  endedAt: number | null;
  segments: TranscriptSegment[];
  summary: string | null;
  keyPoints: string[];
  actionItems: string[];
  decisions: string[];
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let _notes: MeetingNotes | null = null;

export function currentNotes(): Readonly<MeetingNotes> | null {
  return _notes ? { ..._notes, segments: [..._notes.segments] } : null;
}

export function startSession(title?: string): void {
  _notes = {
    title: title || `Meeting ${new Date().toLocaleDateString()}`,
    startedAt: Date.now(),
    endedAt: null,
    segments: [],
    summary: null,
    keyPoints: [],
    actionItems: [],
    decisions: [],
  };
  log.info('Meeting notes session started', { title: _notes.title });
}

export function addSegment(speaker: string, text: string): void {
  if (!_notes) startSession();
  _notes!.segments.push({ speaker, text, timestamp: Date.now() });
}

export function endSession(): MeetingNotes | null {
  if (!_notes) return null;
  _notes.endedAt = Date.now();
  const result = currentNotes()!;
  log.info('Meeting notes session ended', {
    segments: result.segments.length,
    duration: result.endedAt! - result.startedAt,
  });
  return result;
}

export function clearSession(): void {
  _notes = null;
}

// ---------------------------------------------------------------------------
// Formatting — generates HTML for Wonder Canvas display
// ---------------------------------------------------------------------------

export function formatNotesAsHtml(notes: MeetingNotes): string {
  const duration = notes.endedAt
    ? Math.round((notes.endedAt - notes.startedAt) / 60000)
    : Math.round((Date.now() - notes.startedAt) / 60000);

  const keyPointsHtml = notes.keyPoints.length
    ? `<div class="section"><h3>Key Discussion Points</h3><ul>${notes.keyPoints.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>`
    : '';

  const actionItemsHtml = notes.actionItems.length
    ? `<div class="section"><h3>Action Items</h3><ul>${notes.actionItems.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div>`
    : '';

  const decisionsHtml = notes.decisions.length
    ? `<div class="section"><h3>Decisions</h3><ul>${notes.decisions.map((d) => `<li>${esc(d)}</li>`).join('')}</ul></div>`
    : '';

  const summaryHtml = notes.summary
    ? `<div class="section"><h3>Summary</h3><p>${esc(notes.summary)}</p></div>`
    : '';

  // Show last 20 transcript lines as a condensed log
  const recentSegments = notes.segments.slice(-20);
  const transcriptHtml = recentSegments.length
    ? `<div class="section transcript"><h3>Recent Transcript</h3>${recentSegments.map((s) => `<p><strong>${esc(s.speaker)}:</strong> ${esc(s.text)}</p>`).join('')}</div>`
    : '';

  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;color:#e0e0e8;padding:32px;max-width:720px;margin:0 auto;">
  <h2 style="color:#FFD233;margin-bottom:4px;">📝 ${esc(notes.title)}</h2>
  <p style="color:#888;font-size:13px;margin-bottom:24px;">${duration} min${notes.endedAt ? ' (ended)' : ' so far'} · ${notes.segments.length} transcript segments</p>
  ${summaryHtml}
  ${keyPointsHtml}
  ${actionItemsHtml}
  ${decisionsHtml}
  ${transcriptHtml}
  <style>
    .section{margin-bottom:20px}
    .section h3{color:#FFD233;font-size:15px;margin-bottom:8px;border-bottom:1px solid rgba(255,210,51,.2);padding-bottom:4px}
    .section ul{padding-left:20px}
    .section li{margin-bottom:4px;font-size:14px}
    .section p{font-size:14px;line-height:1.5}
    .transcript p{font-size:12px;line-height:1.4;margin-bottom:2px;color:#aaa}
    .transcript strong{color:#ccc}
  </style>
</div>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Export to markdown (for saving to PearlOS Notes)
// ---------------------------------------------------------------------------

export function formatNotesAsMarkdown(notes: MeetingNotes): string {
  const lines: string[] = [];
  lines.push(`# ${notes.title}`);
  lines.push('');
  lines.push(`**Date:** ${new Date(notes.startedAt).toLocaleString()}`);
  const duration = (notes.endedAt || Date.now()) - notes.startedAt;
  lines.push(`**Duration:** ${Math.round(duration / 60000)} minutes`);
  lines.push(`**Segments:** ${notes.segments.length}`);
  lines.push('');

  if (notes.summary) {
    lines.push('## Summary');
    lines.push(notes.summary);
    lines.push('');
  }

  if (notes.keyPoints.length) {
    lines.push('## Key Discussion Points');
    notes.keyPoints.forEach((p) => lines.push(`- ${p}`));
    lines.push('');
  }

  if (notes.actionItems.length) {
    lines.push('## Action Items');
    notes.actionItems.forEach((a) => lines.push(`- [ ] ${a}`));
    lines.push('');
  }

  if (notes.decisions.length) {
    lines.push('## Decisions');
    notes.decisions.forEach((d) => lines.push(`- ${d}`));
    lines.push('');
  }

  if (notes.segments.length) {
    lines.push('## Transcript');
    notes.segments.forEach((s) => {
      const time = new Date(s.timestamp).toLocaleTimeString();
      lines.push(`**${s.speaker}** (${time}): ${s.text}`);
    });
  }

  return lines.join('\n');
}
