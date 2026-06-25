/**
 * Registry of tool-call handlers for the web chat agent.
 *
 * When Pearl's LLM response includes a tool_call (e.g. `bot_create_note`),
 * the handler registered here is invoked client-side to execute the action
 * and return a human-readable result string for the chat display.
 */

import {
  NIA_EVENT_NOTE_OPEN,
  NIA_EVENT_NOTE_UPDATED,
  NIA_EVENT_DESKTOP_MODE_SWITCH,
  NIA_EVENT_LAYOUT_MODE_SWITCH,
  NIA_EVENT_ONBOARDING_COMPLETE,
  routeNiaEvent,
} from '@interface/features/DailyCall/events/niaEventRouter';
import {
  applyInterfaceCustomizePayload,
  type InterfaceCustomizePayload,
} from '@interface/lib/interface-customization';
import {
  requestWindowOpen,
  requestWindowClose,
} from '@interface/features/ManeuverableWindow/lib/windowLifecycleController';
import type { ViewType } from '@interface/features/ManeuverableWindow/types/maneuverable-window-types';
import { dispatchPearlSettingsOpen } from '@interface/lib/webchat-onboarding';
import { sanitizeTaskResultForUser } from '@interface/lib/task-result-sanitizer';

// Bot app-name → frontend ViewType. Mirrors APP_NAME_TO_VIEW_TYPE in
// niaEventRouter.ts so chat-mode and voice-mode resolve the same window.
const APP_TO_VIEW_TYPE: Record<string, ViewType> = {
  notes: 'notes',
  notepad: 'notes',
  text: 'notes',
  youtube: 'youtube' as ViewType,
  terminal: 'terminal' as ViewType,
  cmd: 'terminal' as ViewType,
  command: 'terminal' as ViewType,
  files: 'files' as ViewType,
  filespace: 'files' as ViewType,
  docs: 'files' as ViewType,
  'file-manager': 'files' as ViewType,
  explorer: 'files' as ViewType,
  browser: 'enhancedBrowser' as ViewType,
  chrome: 'enhancedBrowser' as ViewType,
  web: 'enhancedBrowser' as ViewType,
  studio: 'creationLaunchpad' as ViewType,
  'the-studio': 'creationLaunchpad' as ViewType,
  thestudio: 'creationLaunchpad' as ViewType,
  'creation-launchpad': 'creationLaunchpad' as ViewType,
  creationlaunchpad: 'creationLaunchpad' as ViewType,
  launchpad: 'creationLaunchpad' as ViewType,
  'creation-engine': 'creationLaunchpad' as ViewType,
  creationengine: 'creationLaunchpad' as ViewType,
  creation: 'creationLaunchpad' as ViewType,
  news: 'news' as ViewType,
  pulse: 'pulse' as ViewType,
  'global-pulse': 'pulse' as ViewType,
  'social-pulse': 'pulse' as ViewType,
  weather: 'weather' as ViewType,
  settings: 'settings' as ViewType,
  styles: 'styles' as ViewType,
  style: 'styles' as ViewType,
  appearance: 'styles' as ViewType,
  discord: 'discord' as ViewType,
  council: 'council' as ViewType,
  'the-council': 'council' as ViewType,
  summon: 'council' as ViewType,
  'summon-agent': 'council' as ViewType,
  summonagent: 'council' as ViewType,
  agency: 'agency' as ViewType,
  'the-agency': 'agency' as ViewType,
  theagency: 'agency' as ViewType,
  tasks: 'agency' as ViewType,
  tasklist: 'agency' as ViewType,
  'task-list': 'agency' as ViewType,
  rooms: 'agency' as ViewType,
  'our-pearlos': 'ourPearlos' as ViewType,
  ourpearlos: 'ourPearlos' as ViewType,
  'our-pearl': 'ourPearlos' as ViewType,
  ourpearl: 'ourPearlos' as ViewType,
  'public-features': 'ourPearlos' as ViewType,
  'feature-catalog': 'ourPearlos' as ViewType,
  'community-features': 'ourPearlos' as ViewType,
};

function resolveViewType(app: string): ViewType {
  const key = app.toLowerCase();
  return APP_TO_VIEW_TYPE[key] ?? ('custom' as ViewType);
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type ChatToolHandler = (args: Record<string, unknown>) => Promise<string>;
type JsonRecord = Record<string, unknown>;
type SearchResultItem = {
  title: string;
  url: string;
  snippet: string;
  source: string;
};
type NewsSourceDoc = SearchResultItem & {
  content: string;
};
type NewsInsight = {
  label: string;
  text: string;
};
type NewsIntelligenceBrief = {
  headline: string;
  bottomLine: string;
  whyItMatters: string;
  keyDevelopments: string[];
  stakes: string[];
  watchNext: string[];
  tensions: NewsInsight[];
  sourceNames: string[];
};

const TOOL_ALIASES: Record<string, string> = {
  web_search: 'bot_web_search',
  search_web: 'bot_web_search',
  search: 'bot_web_search',
  web_fetch: 'bot_web_fetch',
  browser_fetch: 'bot_web_fetch',
  fetch_url: 'bot_web_fetch',
  get_public_profile: 'bot_get_public_profile',
  public_profile: 'bot_get_public_profile',
  profile_info: 'bot_get_public_profile',
  pearl_search: 'bot_web_search',
  task_status: 'bot_list_tasks',
  list_tasks: 'bot_list_tasks',
  agency_status: 'bot_list_tasks',
  open_files: 'bot_open_files',
  open_filespace: 'bot_open_files',
  bot_open_file_space: 'bot_open_files',
  customize_interface: 'bot_customize_interface',
  interface_customize: 'bot_customize_interface',
  set_theme: 'bot_customize_interface',
  change_theme: 'bot_customize_interface',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const FILE_API = '/api/notes/files';
const DEFAULT_NOTES_AGENT = 'pearlos';

function notesFileApiUrl(extra?: Record<string, unknown>): string {
  const params = new URLSearchParams({ agent: DEFAULT_NOTES_AGENT });
  for (const [key, value] of Object.entries(extra ?? {})) {
    const text = String(value ?? '').trim();
    if (text) params.set(key, text);
  }
  return `${FILE_API}?${params.toString()}`;
}

function dispatchNoteOpen(note: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(NIA_EVENT_NOTE_OPEN, {
      detail: {
        event: 'note.open',
        envelope: { v: 1, kind: 'tool', seq: 0, ts: Date.now(), payload: { note } },
        payload: { note, noteId: note._id || note.page_id },
      },
    }),
  );
}

function dispatchNoteUpdated(noteId: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(NIA_EVENT_NOTE_UPDATED, {
      detail: {
        event: 'note.updated',
        envelope: { v: 1, kind: 'tool', seq: 0, ts: Date.now(), payload: { noteId } },
        payload: { noteId },
      },
    }),
  );
}

function openNotesWindow() {
  requestWindowOpen({ viewType: 'notes', source: 'chat-tool-handler' });
}

function scheduleNoteOpen(note: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  window.setTimeout(() => dispatchNoteOpen(note), 150);
  window.setTimeout(() => dispatchNoteOpen(note), 600);
}

// ─── Handlers ────────────────────────────────────────────────────────────────

function weatherIcon(condition: string): string {
  const c = condition.toLowerCase();
  if (c.includes('rain') || c.includes('drizzle')) return 'Rain';
  if (c.includes('snow') || c.includes('sleet')) return 'Snow';
  if (c.includes('thunder') || c.includes('storm')) return 'Storm';
  if (c.includes('cloud') || c.includes('overcast')) return 'Cloudy';
  if (c.includes('sun') || c.includes('clear')) return 'Clear';
  return 'Weather';
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num: string) => String.fromCodePoint(Number.parseInt(num, 10)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function cleanSearchText(value: unknown): string {
  return decodeHtmlEntities(String(value ?? ''))
    .replace(/<[^>]*>/g, ' ')
    .replace(/\[\d+(?:[,\s-]+\d+)*\]/g, '')
    .replace(/\[[ivxlcdm]+\]/gi, '')
    .replace(/\b(?:Skip to Content|Got a tip for us\?|View in English|English US Edition|English UK|Get Started|Explore Get Started Overview|Apple Store Mac iPad iPhone Watch Vision AirPods TV & Home Entertainment Accessories Support|Checking your browser before accessing|Checking your browser|Just a moment|Enable JavaScript and cookies to continue|Verifying you are human|Please stand by while we are checking your browser|Cloudflare Ray ID)\b/gi, ' ')
    .replace(/\s+\.\.\./g, '...')
    .replace(/\s+/g, ' ')
    .trim();
}

function visualSearchIntentHint(text: string): string {
  const normalized = cleanSearchText(text).toLowerCase();
  if (!normalized) return '';
  if (/\btimelines?\b/.test(normalized)) return 'timeline visual';
  if (/\binfographics?\b/.test(normalized)) return 'infographic visual';
  if (/\bcomparison board\b/.test(normalized)) return 'comparison board visual';
  if (/\bvisual maps?\b/.test(normalized)) return 'visual map';
  if (/\bcharts?\b/.test(normalized)) return 'chart visual';
  if (/\bgraphs?\b/.test(normalized)) return 'graph visual';
  if (/\bdiagrams?\b/.test(normalized)) return 'diagram visual';
  if (isTimelineHistoryIntent(normalized)) return 'timeline visual';
  if (/\bvisual(?:ize|ization|isations?|isations?)?\b/.test(normalized)) return 'visual';
  if (/\bshow me\b/.test(normalized) && /\b(canvas|map|breakdown)\b/.test(normalized)) return 'visual';
  if (shouldBuildRankedListVisual(normalized)) return 'ranked list visual';
  return '';
}

function isTimelineHistoryIntent(text: string): boolean {
  const normalized = cleanSearchText(text).toLowerCase();
  if (!normalized) return false;
  if (/\b(?:my|your|our)\s+(?:account|browser|chat|conversation|file|order|search|task)\s+history\b/.test(normalized)) {
    return false;
  }
  return /\b(?:history|evolution|development|origins?|origin story|milestones?|eras?|phases?|generations?|rise and fall)\b/.test(normalized)
    || /\bfrom\b[^.!?]{2,90}\bto\b[^.!?]{2,90}/.test(normalized)
    || /\bhow\b[^.!?]{2,90}\b(?:started|grew|changed|evolved)\b/.test(normalized);
}

export function preserveVisualSearchIntent(
  args: Record<string, unknown>,
  userPrompt: string,
): Record<string, unknown> {
  const hint = visualSearchIntentHint(userPrompt);
  if (!hint) return args;
  const rawQuery = cleanSearchText(args.query || args.q || '');
  const query = rawQuery || cleanSearchText(userPrompt);
  if (!query) return args;
  if (/\b(canvas|visual|visualize|infographic|timeline|chart|graph|diagram|map|comparison board|visual breakdown|ranked list|ranking)\b/i.test(query)) {
    return args.query === query ? args : { ...args, query };
  }
  return {
    ...args,
    query: `${query} ${hint}`.trim(),
  };
}

function visibleTextFromHtml(html: string, maxLength = 900): string {
  const visible = html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ');
  const cleaned = cleanSearchText(visible);
  if (cleaned.length <= maxLength) return cleaned;
  const clipped = cleaned.slice(0, maxLength - 1);
  const boundary = clipped.search(/\s+\S*$/);
  const natural = boundary > Math.floor(maxLength * 0.7) ? clipped.slice(0, boundary) : clipped;
  return `${natural.replace(/[,\s;:.-]+$/g, '').trim()}...`;
}

function looksLikeBrowserChallenge(value: unknown): boolean {
  const text = String(value ?? '').toLowerCase();
  return /\b(checking your browser|just a moment|enable javascript and cookies|verifying you are human|cloudflare ray id|browser before accessing|attention required)\b/i
    .test(text);
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function firstRecord(value: unknown): JsonRecord {
  return Array.isArray(value) ? asRecord(value[0]) : {};
}

function nestedValue(record: JsonRecord, key: string): unknown {
  const item = Array.isArray(record[key]) ? record[key][0] : undefined;
  return asRecord(item).value;
}

function buildChatWeatherHTML(data: JsonRecord, location: string): string {
  const current = firstRecord(data.current_condition);
  const area = firstRecord(data.nearest_area);
  const areaName = nestedValue(area, 'areaName') || location;
  const region = nestedValue(area, 'region') || '';
  const country = nestedValue(area, 'country') || '';
  const label = [areaName, region, country].filter(Boolean).join(', ');
  const condition = String(nestedValue(current, 'weatherDesc') || 'Current conditions');
  const tempF = current.temp_F ?? '--';
  const feelsF = current.FeelsLikeF ?? '--';
  const humidity = current.humidity ?? '--';
  const wind = current.windspeedMiles ?? '--';
  const icon = weatherIcon(condition);

  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    html,body{margin:0;height:100%;background:#0a0614;color:#faf8f5;font-family:Inter,system-ui,sans-serif}
    .weather{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:32px;box-sizing:border-box;background:linear-gradient(135deg,#13213a 0%,#241431 55%,#0a0614 100%)}
    .panel{width:min(680px,100%);border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.08);box-shadow:0 24px 80px rgba(0,0,0,.32);border-radius:8px;padding:28px}
    .eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:#9fd3ff;margin-bottom:10px}
    .place{font-size:20px;font-weight:650;margin-bottom:22px;color:#fff}
    .main{display:flex;align-items:flex-end;justify-content:space-between;gap:24px}
    .temp{font-size:96px;line-height:.9;font-weight:760;letter-spacing:0;color:#fff}
    .cond{font-size:22px;color:#ffd26d;margin-top:12px}
    .icon{font-size:18px;color:#b7e3ff;text-align:right}
    .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:28px}
    .stat{border:1px solid rgba(255,255,255,.1);background:rgba(0,0,0,.18);border-radius:8px;padding:14px}
    .stat b{display:block;font-size:18px;color:#fff}
    .stat span{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:rgba(250,248,245,.58);margin-top:5px}
  </style>
</head>
<body>
  <section class="weather">
    <div class="panel">
      <div class="eyebrow">Live weather</div>
      <div class="place">${escapeHtml(label)}</div>
      <div class="main">
        <div>
          <div class="temp">${escapeHtml(tempF)}&deg;</div>
          <div class="cond">${escapeHtml(condition)}</div>
        </div>
        <div class="icon">${escapeHtml(icon)}</div>
      </div>
      <div class="grid">
        <div class="stat"><b>${escapeHtml(feelsF)}&deg;F</b><span>Feels Like</span></div>
        <div class="stat"><b>${escapeHtml(humidity)}%</b><span>Humidity</span></div>
        <div class="stat"><b>${escapeHtml(wind)} mph</b><span>Wind</span></div>
      </div>
    </div>
  </section>
</body>
</html>`;
}

let lastCanvasOpen: { key: string; ts: number } | null = null;

function openHtmlCanvas(title: string, html: string, meta?: Record<string, unknown>): void {
  const now = Date.now();
  const key = JSON.stringify({
    scenario: meta?.scenario || '',
    query: meta?.query || '',
    title,
  });
  if (lastCanvasOpen && lastCanvasOpen.key === key && now - lastCanvasOpen.ts < 5000) {
    console.warn('[chat-tool-handler] suppressed duplicate canvas open', { title, scenario: meta?.scenario });
    return;
  }
  lastCanvasOpen = { key, ts: now };
  if (typeof window !== 'undefined') {
    (window as typeof window & {
      __pearlLastWonderCanvasOpen?: { ts: number; title: string; scenario?: string; query?: string };
    }).__pearlLastWonderCanvasOpen = {
      ts: now,
      title,
      scenario: String(meta?.scenario || ''),
      query: String(meta?.query || ''),
    };
  }
  routeNiaEvent('wonder.scene', {
    title,
    html,
    transition: 'fade',
    layer: 'main',
    meta: { source: 'webchat', ...meta },
  });
}

function buildGenericTemplateHtml(template: string, data: Record<string, unknown>): string {
  const title = cleanSearchText(data.title || data.heading || template.replace(/_/g, ' ')) || 'Fact Card';
  const subtitle = cleanSearchText(data.subtitle || data.kicker || data.label || '');
  const rawItems = Array.isArray(data.items)
    ? data.items
    : Array.isArray(data.facts)
      ? data.facts
      : Array.isArray(data.points)
        ? data.points
        : [];
  const items = rawItems
    .map((item) => {
      if (typeof item === 'string') return cleanSearchText(item);
      const record = asRecord(item);
      return cleanSearchText(record.text || record.description || record.title || record.label || '');
    })
    .filter(Boolean)
    .slice(0, 5);
  const body = cleanSearchText(data.body || data.summary || data.text || data.description || '');
  const list = items.length
    ? items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')
    : `<li>${escapeHtml(body || 'Current information is ready on the canvas.')}</li>`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    html,body{margin:0;height:100%;background:#111214;color:#f7f4ed;font-family:Inter,system-ui,sans-serif}
    main{min-height:100vh;box-sizing:border-box;padding:clamp(24px,4vw,54px);display:grid;place-items:center;background:linear-gradient(135deg,#111214 0%,#26343a 58%,#2a2022 100%)}
    section{width:min(860px,100%);display:grid;gap:18px}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.14em;color:#9ee6d8}
    h1{font-size:clamp(34px,6vw,72px);line-height:1;margin:0;letter-spacing:0}
    p{font-size:clamp(16px,2vw,22px);line-height:1.45;margin:0;color:#ded8cf}
    ul{list-style:none;margin:10px 0 0;padding:0;display:grid;gap:12px}
    li{border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.085);border-radius:8px;padding:16px 18px;font-size:clamp(15px,1.7vw,19px);line-height:1.4}
  </style>
</head>
<body>
  <main>
    <section>
      <div class="label">${escapeHtml(template.replace(/_/g, ' '))}</div>
      <h1>${escapeHtml(title)}</h1>
      ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}
      <ul>${list}</ul>
    </section>
  </main>
</body>
</html>`;
}

function parseCanvasPlanAttributes(rawAttributes: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match: RegExpExecArray | null;
  while ((match = attrRe.exec(rawAttributes)) !== null) {
    attrs[match[1].toLowerCase()] = decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? '').trim();
  }
  return attrs;
}

function parseCanvasPlanJson(body: string): JsonRecord | null {
  const trimmed = decodeHtmlEntities(body).trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return { items: parsed };
    return asRecord(parsed);
  } catch {
    const objectMatch = trimmed.match(/\{[\s\S]*\}/);
    if (!objectMatch) return null;
    try {
      return asRecord(JSON.parse(objectMatch[0]));
    } catch {
      return null;
    }
  }
}

function canvasPlanTitle(attrs: Record<string, string>, data: JsonRecord): string {
  const headerElement = Array.isArray(data.elements)
    ? data.elements.map(asRecord).find((element) => /^(?:header|title)$/i.test(String(element.type || '')))
    : null;
  return cleanSearchText(
    attrs.title ||
    data.title ||
    data.heading ||
    headerElement?.content ||
    attrs.type ||
    'Visual Canvas',
  ) || 'Visual Canvas';
}

function canvasPlanItems(data: JsonRecord): string[] {
  if (Array.isArray(data.items) || Array.isArray(data.facts) || Array.isArray(data.points)) {
    const rawItems = (Array.isArray(data.items) ? data.items : Array.isArray(data.facts) ? data.facts : data.points) as unknown[];
    return rawItems
      .map((item) => {
        if (typeof item === 'string') return cleanSearchText(item);
        const record = asRecord(item);
        const label = cleanSearchText(record.name || record.title || record.label || record.time || '');
        const body = cleanSearchText(record.text || record.description || record.content || record.cause || record.summary || '');
        return [label, body].filter(Boolean).join(': ');
      })
      .filter(Boolean)
      .slice(0, 9);
  }

  if (!Array.isArray(data.elements)) return [];
  const items: string[] = [];
  let pendingLabel = '';
  for (const rawElement of data.elements) {
    const element = asRecord(rawElement);
    const type = String(element.type || '').toLowerCase();
    const content = cleanSearchText(element.content || element.text || element.label || '');
    if (!content) continue;
    if (/^(?:header|title)$/.test(type)) continue;
    if (/^(?:label|marker|year|date)$/.test(type)) {
      pendingLabel = content;
      continue;
    }
    if (/^(?:card|note|milestone|fact|item|callout)$/.test(type)) {
      items.push([pendingLabel, content].filter(Boolean).join(': '));
      pendingLabel = '';
    }
  }
  return items.slice(0, 9);
}

function buildCanvasPlanHtml(attrs: Record<string, string>, data: JsonRecord): string {
  const title = canvasPlanTitle(attrs, data);
  const typeLabel = cleanSearchText(attrs.type || data.type || attrs.layout || 'visual plan') || 'visual plan';
  const items = canvasPlanItems(data);
  const subtitle = cleanSearchText(data.subtitle || data.summary || data.description || '');
  const cards = (items.length ? items : ['Pearl prepared a visual structure for this answer.'])
    .map((item, index) => `
      <article class="card">
        <b>${String(index + 1).padStart(2, '0')}</b>
        <p>${escapeHtml(item)}</p>
      </article>`)
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    html,body{margin:0;width:100%;height:100%;background:#111214;color:#f7f4ed;font-family:Inter,system-ui,sans-serif}
    main{min-height:100vh;box-sizing:border-box;padding:clamp(22px,3.6vw,48px);display:grid;grid-template-rows:auto 1fr;gap:clamp(16px,2.4vw,28px);background:linear-gradient(135deg,#111214 0%,#25343a 54%,#2f2520 100%)}
    header{display:grid;grid-template-columns:1fr auto;gap:18px;align-items:end}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.14em;color:#9ee6d8}
    h1{font-size:clamp(34px,5.6vw,74px);line-height:.96;letter-spacing:0;margin:8px 0 0;max-width:1050px}
    .stamp{border-left:1px solid rgba(255,255,255,.18);padding-left:16px;color:#f0d28a;font-size:clamp(14px,1.4vw,18px);white-space:nowrap}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px;align-content:start;min-height:0;overflow:auto;padding-right:4px}
    .card{display:grid;grid-template-columns:46px 1fr;gap:13px;align-items:start;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.085);border-radius:8px;padding:15px;box-shadow:0 24px 70px rgba(0,0,0,.22)}
    .card b{width:38px;height:38px;border-radius:50%;display:grid;place-items:center;background:#f3c76d;color:#17130d;font-size:13px}
    .card p{margin:0;color:#e5ded4;font-size:clamp(13px,1.35vw,17px);line-height:1.38}
    .subtitle{max-width:900px;margin:0;color:#d9d1c7;font-size:clamp(15px,1.55vw,19px);line-height:1.35}
    @media (max-width:760px){
      main{overflow:auto}
      header{grid-template-columns:1fr}
      .stamp{border-left:0;border-top:1px solid rgba(255,255,255,.18);padding:12px 0 0}
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <div class="label">${escapeHtml(typeLabel)}</div>
        <h1>${escapeHtml(title)}</h1>
        ${subtitle ? `<p class="subtitle">${escapeHtml(subtitle)}</p>` : ''}
      </div>
      <div class="stamp">${items.length || 1} visual points</div>
    </header>
    <section class="grid" aria-label="${escapeHtml(title)}">${cards}</section>
  </main>
</body>
</html>`;
}

const ASSISTANT_CANVAS_MARKUP_RE = /<canvas\b([^>]*)>([\s\S]*?)<\/canvas>/gi;
const ASSISTANT_WONDER_CANVAS_RE = /<WonderCanvas\b[\s\S]*?(?:\/>|<\/WonderCanvas>)/gi;

export function stripAssistantCanvasMarkup(text: string): string {
  if (!/<(?:canvas|WonderCanvas)\b/i.test(text)) return text;
  ASSISTANT_CANVAS_MARKUP_RE.lastIndex = 0;
  ASSISTANT_WONDER_CANVAS_RE.lastIndex = 0;
  return text
    .replace(ASSISTANT_CANVAS_MARKUP_RE, ' ')
    .replace(ASSISTANT_WONDER_CANVAS_RE, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function wonderCanvasAttributes(tag: string): Record<string, string> {
  const openTag = tag.match(/^<WonderCanvas\b([\s\S]*?)(?:\/>|>)/i);
  return parseCanvasPlanAttributes(openTag?.[1] || '');
}

function wonderCanvasConclusion(tag: string): string {
  const match = tag.match(/\bconclusion\s*:\s*"([^"]{24,260})"/i);
  return cleanSearchText(match?.[1] || '');
}

function extractWonderCanvasItems(tag: string): string[] {
  const items: string[] = [];
  const structuredRe = /\{\s*year\s*:\s*"([^"]+)"[\s\S]*?title\s*:\s*"([^"]+)"[\s\S]*?detail\s*:\s*"([^"]+)"/gi;
  let structured: RegExpExecArray | null;
  while ((structured = structuredRe.exec(tag)) !== null) {
    items.push(`${cleanSearchText(structured[1])}: ${cleanSearchText(structured[2])} - ${cleanSearchText(structured[3])}`);
    if (items.length >= 9) return items;
  }

  const titleDetailRe = /\{\s*title\s*:\s*"([^"]+)"[\s\S]*?detail\s*:\s*"([^"]+)"/gi;
  let titleDetail: RegExpExecArray | null;
  while ((titleDetail = titleDetailRe.exec(tag)) !== null) {
    items.push(`${cleanSearchText(titleDetail[1])}: ${cleanSearchText(titleDetail[2])}`);
    if (items.length >= 9) return items;
  }

  const sectionRe = /\{\s*label\s*:\s*"([^"]+)"[\s\S]*?period\s*:\s*"([^"]+)"/gi;
  let section: RegExpExecArray | null;
  while ((section = sectionRe.exec(tag)) !== null) {
    items.push(`${cleanSearchText(section[2])}: ${cleanSearchText(section[1])}`);
    if (items.length >= 9) return items;
  }

  return items;
}

export function handleAssistantCanvasMarkup(text: string): { text: string; opened: boolean } {
  if (!/<(?:canvas|WonderCanvas)\b/i.test(text)) return { text, opened: false };
  let opened = false;
  let match: RegExpExecArray | null;
  ASSISTANT_CANVAS_MARKUP_RE.lastIndex = 0;
  while ((match = ASSISTANT_CANVAS_MARKUP_RE.exec(text)) !== null) {
    if (opened) continue;
    const attrs = parseCanvasPlanAttributes(match[1] || '');
    const data = parseCanvasPlanJson(match[2] || '');
    if (!data) continue;
    const title = canvasPlanTitle(attrs, data);
    openHtmlCanvas(title, buildCanvasPlanHtml(attrs, data), {
      scenario: 'assistant-canvas-markup',
      query: title,
      canvasType: attrs.type || data.type || attrs.layout || 'visual-plan',
    });
    opened = true;
  }
  ASSISTANT_WONDER_CANVAS_RE.lastIndex = 0;
  while ((match = ASSISTANT_WONDER_CANVAS_RE.exec(text)) !== null) {
    if (opened) continue;
    const tag = match[0] || '';
    const attrs = wonderCanvasAttributes(tag);
    const title = cleanSearchText(attrs.title || 'Wonder Canvas') || 'Wonder Canvas';
    const template = cleanSearchText(attrs.template || attrs.type || 'visual summary') || 'visual summary';
    const items = extractWonderCanvasItems(tag);
    openHtmlCanvas(title, buildCanvasPlanHtml({ type: template, title }, {
      title,
      subtitle: wonderCanvasConclusion(tag),
      items,
    }), {
      scenario: 'assistant-wonder-canvas-markup',
      query: title,
      canvasType: template,
      itemCount: items.length,
      fullscreen: true,
      wonder: true,
    });
    opened = true;
  }

  const stripped = stripAssistantCanvasMarkup(text);
  if (stripped.length >= 60 || !opened) return { text: stripped, opened };

  const fallbackTitle = (() => {
    ASSISTANT_CANVAS_MARKUP_RE.lastIndex = 0;
    const first = ASSISTANT_CANVAS_MARKUP_RE.exec(text);
    if (first) {
      const attrs = parseCanvasPlanAttributes(first[1] || '');
      const data = parseCanvasPlanJson(first[2] || '') || {};
      return canvasPlanTitle(attrs, data);
    }
    ASSISTANT_WONDER_CANVAS_RE.lastIndex = 0;
    const wonder = ASSISTANT_WONDER_CANVAS_RE.exec(text);
    const attrs = wonderCanvasAttributes(wonder?.[0] || '');
    return cleanSearchText(attrs.title || 'the visual') || 'the visual';
  })();
  return {
    text: `The canvas lays out ${fallbackTitle}, with the main points separated so the structure is easier to scan.`,
    opened,
  };
}

export function getLastChatCanvasOpenTs(): number {
  if (typeof window === 'undefined') return 0;
  return Number((window as typeof window & {
    __pearlLastWonderCanvasOpen?: { ts?: unknown };
  }).__pearlLastWonderCanvasOpen?.ts || 0);
}

function isNewVisualCanvasPrompt(text: string): boolean {
  const normalized = cleanSearchText(text).toLowerCase();
  if (!normalized) return false;
  return Boolean(visualSearchIntentHint(normalized))
    || isTimelineHistoryIntent(normalized)
    || /\b(?:comparison\s+(?:board|chart|matrix)|side[-\s]?by[-\s]?side|timeline|infographic|visual\s+breakdown|visual\s+map|diagram|flowchart|chart|graph|map)\b/i.test(normalized)
    || (/\bshow me\b/i.test(normalized) && shouldBuildRankedListVisual(normalized));
}

export function shouldUseVisualCanvasFastPath(text: string): boolean {
  return isNewVisualCanvasPrompt(text);
}

function visualRescueTitle(userPrompt: string, assistantText: string): string {
  const promptTopic = cleanSearchText(userPrompt)
    .replace(/^(?:please\s+|can you\s+|could you\s+|would you\s+)?(?:show me|make|build|create|put together|sketch|draw|generate|give me)\s+(?:a|an|the)?\s*/i, '')
    .replace(/\b(?:on|in)\s+(?:the\s+)?canvas\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  const firstHeading = assistantText
    .split(/\n+/)
    .map((line) => cleanSearchText(line.replace(/^#{1,6}\s*/, '').replace(/\*\*/g, '')))
    .find((line) => line.length >= 8 && line.length <= 90 && !/^here(?:'| i)s\b/i.test(line));
  const title = promptTopic || firstHeading || 'Visual Canvas';
  return title.length > 92 ? `${title.slice(0, 89).replace(/\s+\S*$/g, '').trim()}...` : title;
}

function extractVisualRescueItems(text: string): string[] {
  const rawLines = decodeHtmlEntities(text)
    .replace(/<[^>]*>/g, '\n')
    .split(/\n+/)
    .map((line) => line
      .replace(/^#{1,6}\s*/, '')
      .replace(/^[-*]\s*/, '')
      .replace(/^\d+[.)]\s*/, '')
      .replace(/\*\*/g, '')
      .replace(/_{2,}/g, '')
      .trim())
    .map(cleanSearchText)
    .filter(Boolean);

  const items: string[] = [];
  for (const line of rawLines) {
    if (/^(?:here(?:'| i)s|the canvas|done|opened|ready)\b/i.test(line)) continue;
    if (/^[-=]{3,}$/.test(line)) continue;
    const looksLikeHeading = /^(?:generation|era|phase|stage|period|chapter|step)\s+\d+/i.test(line)
      || /^\d{3,4}(?:\s*[-–]\s*\d{2,4})?\b/.test(line)
      || /^[A-Z][^.!?]{8,80}:/.test(line);
    if (looksLikeHeading || line.length >= 48) {
      items.push(line);
    }
    if (items.length >= 9) break;
  }

  if (items.length >= 3) return items;
  return extractVisualItemsFromText(text).slice(0, 8);
}

function visualPromptFallbackItems(userPrompt: string): string[] {
  const normalized = cleanSearchText(userPrompt).toLowerCase();
  if (shouldBuildRankedListVisual(normalized)) {
    return [
      'Ranking frame: compare the leading candidates by the metric the prompt asks for, not by a single universal scoreboard.',
      `Method caveat: ${rankedMethodCaveat(userPrompt)}`,
      'Confidence check: separate confirmed figures from popularity signals before treating the order as settled.',
    ];
  }
  if (/\btimelines?\b|\bhistory\b|\bevolution\b|\bdevelopment\b|\bmilestones?\b/.test(normalized)) {
    return [
      'Start point: the earliest phase sets the baseline for what changed later.',
      'Turning points: the canvas separates the major breaks where technology, institutions, incentives, or scale shifted.',
      'Current state: the final phase shows what survived, what faded, and what still shapes the topic now.',
    ];
  }
  if (/\bcomparison\b|side[-\s]?by[-\s]?side|\btradeoffs?\b/.test(normalized)) {
    return [
      'Comparison frame: group the options by purpose, strengths, limits, and failure modes.',
      'Tradeoff layer: show what each option gains and what it gives up.',
      'Decision layer: highlight which context makes one option more useful than another.',
    ];
  }
  return [
    'Structure: split the topic into the main phases or categories before judging details.',
    'Signal: call out the turning points that explain why the pattern changed.',
    'Caveat: keep uncertain figures or mixed-method comparisons separate from firmer facts.',
  ];
}

export function rescueMissingVisualCanvas(
  userPrompt: string,
  assistantText: string,
  canvasBaselineTs: number,
): boolean {
  if (!isNewVisualCanvasPrompt(userPrompt)) return false;
  if (getLastChatCanvasOpenTs() > canvasBaselineTs) return false;
  const cleanedAnswer = stripAssistantCanvasMarkup(assistantText);
  const ackOnly = isCanvasAckOnlyText(cleanedAnswer);
  const items = ackOnly
    ? visualPromptFallbackItems(userPrompt)
    : extractVisualRescueItems(cleanedAnswer);
  if (!items.length) return false;
  const title = visualRescueTitle(userPrompt, cleanedAnswer);
  const subtitle = ackOnly
    ? 'The canvas separates the structure and caveats so the visual request is visible beside the chat.'
    : firstSentence(cleanedAnswer, 180);
  openHtmlCanvas(title, buildCanvasPlanHtml({ type: 'visual summary', title }, {
    title,
    subtitle,
    items,
  }), {
    scenario: 'assistant-visual-rescue',
    query: userPrompt,
    itemCount: items.length,
    fullscreen: true,
    wonder: true,
  });
  return true;
}

function buildFollowupVisualHtml(topic: string, items: string[], body: string): string {
  return buildGenericTemplateHtml('visual_breakdown', {
    title: topic,
    subtitle: body,
    items,
  });
}

function extractVisualItemsFromText(text: string): string[] {
  const cleaned = cleanSearchText(text);
  if (!cleaned) return [];
  const explicitLines = cleaned
    .split(/\n+/)
    .map((line) => line.replace(/^[-*]\s*/, '').trim())
    .filter((line) => line.length > 24 && !/^watch next:/i.test(line));
  if (explicitLines.length >= 2) return explicitLines.slice(0, 5);

  const sentences = cleaned.match(/[^.!?]+(?:[.!?]+|$)/g) || [];
  return sentences
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 35)
    .slice(0, 5);
}

function isCanvasFollowupRequest(text: string): boolean {
  const normalized = cleanSearchText(text).toLowerCase();
  return /^(?:show me|visualize(?: it| this| that)?|show(?: it| this| that)?(?: on (?:the )?canvas)?|put (?:it|this|that) on (?:the )?canvas|make (?:it|this|that) visual|give me (?:a )?(?:visual|chart|infographic|visual breakdown))[\s.!?]*$/.test(normalized)
    || /^(?:can you |could you |please )?(?:show|visualize|chart|graph|diagram|display|draw|map|put|make)\s+(?:it|this|that|the above|the last answer|your answer)(?:\s+(?:on|as|into|like|with)\b.*)?[\s.!?]*$/i.test(normalized);
}

function isCanvasAckOnlyText(text: string): boolean {
  const normalized = cleanSearchText(text).toLowerCase();
  if (!normalized) return true;
  const withoutAcks = normalized
    .replace(/\bi put (?:the )?(?:ranked view|ranked list|ranking|visual breakdown|infographic|chart|diagram|timeline|scene|it|that|this)(?:\s+for\b[^.]{0,180})?\s+on (?:the )?canvas\.?/g, ' ')
    .replace(/\b(?:it is|it's|that is|that's) (?:visible|ready|open) on (?:the )?canvas\.?/g, ' ')
    .replace(/\bkey points from (?:the )?(?:last answer|previous answer)\.?/g, ' ')
    .replace(/\b(?:done|opened|ready)\.?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return withoutAcks.length < 24;
}

export async function handleLocalCanvasFollowupPrompt(
  text: string,
  previousAssistantText: string,
): Promise<string | null> {
  if (!isCanvasFollowupRequest(text)) return null;
  if (isCanvasAckOnlyText(previousAssistantText)) return null;
  const items = extractVisualItemsFromText(previousAssistantText);
  if (!items.length) return null;
  const firstLine = cleanSearchText(previousAssistantText).split(/[.!?]\s+/)[0] || 'Visual breakdown';
  const title = firstLine.length > 84
    ? `${firstLine.slice(0, 81).replace(/\s+\S*$/g, '').trim()}...`
    : firstLine;
  openHtmlCanvas(
    'Visual Breakdown',
    buildFollowupVisualHtml(title || 'Visual breakdown', items, 'Key points from the last answer.'),
    {
      scenario: 'chat-followup-visual',
      source: 'previous-assistant-answer',
      itemCount: items.length,
    },
  );
  return 'I put the visual breakdown on the canvas.';
}

async function botGetWeather(args: Record<string, unknown>): Promise<string> {
  const location = String(args.location || args.city || args.place || '').trim();
  if (!location) throw new Error('location is required for bot_get_weather');

  const res = await fetch(`/api/weather?q=${encodeURIComponent(location)}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch weather (${res.status})`);
  }
  const data = await res.json();
  const current = data.current_condition?.[0] ?? {};
  const condition = current.weatherDesc?.[0]?.value || 'current conditions';
  const tempF = current.temp_F ?? 'unknown';

  requestWindowOpen({
    viewType: 'weather' as ViewType,
    source: 'chat-tool:weather',
    title: `Weather: ${location}`,
    html: buildChatWeatherHTML(data, location),
    widthFraction: 0.56,
    heightFraction: 1,
    meta: { location },
  });

  return `Weather for ${location}: ${tempF}F and ${condition}.`;
}

function sourceNameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

function extractSearchResults(data: JsonRecord): { query: string; results: SearchResultItem[]; error?: string } {
  const result = asRecord(data.result ?? data);
  if (result?.success === false) {
    return {
      query: cleanSearchText(result.query),
      results: [],
      error: cleanSearchText(result.error || 'unknown error'),
    };
  }

  const query = cleanSearchText(result.query || data.query || '');
  const rawResults = Array.isArray(result?.results)
    ? result.results
    : Array.isArray(data.results)
      ? data.results
      : [];
  const results = rawResults
    .map((item, index): SearchResultItem => {
      const record = asRecord(item);
      const rawTitle = record.title || record.name || '';
      const rawSnippet = record.snippet || record.description || record.content || record.summary || '';
      const rawUrl = record.url || record.link || record.href || '';
      const url = cleanSearchText(record.url || record.link || record.href || '');
      const title = cleanSearchText(record.title || record.name || url || `Result ${index + 1}`);
      const snippet = cleanSearchText(record.snippet || record.description || record.content || record.summary || '');
      const source = cleanSearchText(record.source || record.site || sourceNameFromUrl(url) || title);
      const challenge = looksLikeBrowserChallenge(`${rawTitle} ${rawSnippet} ${rawUrl}`);
      return challenge ? { title: '', url: '', snippet: '', source: '' } : { title, url, snippet, source };
    })
    .filter((item) => Boolean(item.title || item.snippet || item.url));

  return { query, results };
}

function topicFromSearchQuery(query: string): string {
  const topic = cleanSearchText(query)
    .replace(/^what(?:'| i)?s\s+(?:the\s+)?latest\s+(?:with|on|about)?\s*/i, '')
    .replace(/^(?:please\s+|can you\s+|could you\s+|would you\s+)?(?:show me|make|build|create|draw up|put together|sketch|give me|pull together)\s+(?:an|a|the)?\s*/i, '')
    .replace(/\b(?:on|in)\s+(?:the\s+)?(?:wonder\s+)?canvas\b/gi, '')
    .replace(/\branked list visual\b/gi, '')
    .replace(/\bas\s+a\s+ranked\s+visual\s+list\b/gi, '')
    .replace(/\b(?:show|display)\s+the\s+ranking\s+visually\b/gi, '')
    .replace(/\b(?:make it visual,?\s+not just a paragraph|use the canvas if it helps|keep the chat explanation short and useful|with a short takeaway in chat|with a useful caveat about methodology|without dumping search results|i want the visual and the takeaway in chat)\b/gi, '')
    .replace(/\b(?:timeline|infographic|chart|graph|diagram|comparison board|visual map|visual breakdown)\s+visual\b/gi, '')
    .replace(/\b(?:latest|today|current|recent|news|updates?|headlines)\b/gi, '')
    .replace(/\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}\b/gi, '')
    .replace(/\s+(?:and|as|with|from|to|through|until)\s*[.?!,;:]*\s*$/i, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*[.?!,;:]+\s*$/g, '')
    .trim();
  return topic || 'that topic';
}

function firstSentence(value: string, maxLength = 260): string {
  const cleaned = cleanSearchText(value);
  if (!cleaned) return '';
  const matches = cleaned.match(/[^.!?]+(?:[.!?]+|$)/g) || [cleaned];
  let sentence = matches[0]?.trim() || cleaned;
  if (sentence.length < 45 && matches[1]) {
    sentence = `${sentence} ${matches[1].trim()}`;
  }
  if (sentence.length <= maxLength) return sentence;
  const clipped = sentence.slice(0, maxLength - 1);
  const boundary = clipped.search(/\s+\S*$/);
  const natural = boundary > Math.floor(maxLength * 0.65) ? clipped.slice(0, boundary) : clipped;
  return `${natural.replace(/[,\s;:.-]+$/g, '').trim()}...`;
}

function joinReadable(items: string[], fallback: string): string {
  const unique = Array.from(new Set(items.map((item) => cleanSearchText(item)).filter(Boolean)));
  if (unique.length === 0) return fallback;
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
  return `${unique.slice(0, -1).join(', ')}, and ${unique[unique.length - 1]}`;
}

function visualSurfaceLabel(query: string): string {
  const normalized = query.toLowerCase();
  if (/\btimelines?\b/.test(normalized) || isTimelineHistoryIntent(normalized)) return 'timeline';
  if (/\bcomparison\s+(?:board|chart|matrix)\b|side[-\s]?by[-\s]?side/.test(normalized)) return 'comparison board';
  if (/\bcharts?\b|\bgraphs?\b/.test(normalized)) return 'chart';
  if (/\bdiagrams?\b|\bflowcharts?\b/.test(normalized)) return 'diagram';
  if (/\bmaps?\b/.test(normalized)) return 'map';
  if (/\binfographics?\b/.test(normalized)) return 'infographic';
  return 'visual board';
}

function visualCompanionReply(query: string): string {
  const topic = topicFromSearchQuery(query);
  const surface = visualSurfaceLabel(query);
  const article = /^[aeiou]/i.test(surface) ? 'an' : 'a';
  return [
    `I put ${topic} on the canvas as ${article} ${surface}.`,
    'The useful read is the structure: the main phases, turning points, and tradeoffs are separated so you can scan the pattern first, then drill into the details.',
  ].join(' ');
}

function rankedMethodCaveat(query: string): string {
  const normalized = cleanSearchText(query).toLowerCase();
  if (/\b(?:extinction|geologic|geological|biodiversity|fossil|species loss)\b/.test(normalized)) {
    return 'Treat it as an estimate, not a clean official scoreboard: severity depends on fossil-record resolution, percentage of biodiversity lost, timing, and ecological disruption.';
  }
  if (/\b(?:novels?|books?|fiction|authors?|readership|copies|literature)\b/.test(normalized)) {
    return 'Treat it as an estimate, not a clean official scoreboard: book rankings often mix reported sales, publisher estimates, translations, public-domain circulation, and single-title versus series counts.';
  }
  if (/\b(?:games?|consoles?|arcade|players?|downloads?|units|video game)\b/.test(normalized)) {
    return 'Treat it as an estimate, not a clean official scoreboard: game rankings can mix boxed sales, digital sales, downloads, free-to-play audiences, revenue, and active-player counts.';
  }
  if (/\b(?:highest[-\s]?grossing|box office|movie|movies|films?)\b/.test(normalized)) {
    return 'Treat it as an estimate, not a clean official scoreboard: box-office rankings can mix domestic grosses, worldwide grosses, rereleases, inflation adjustments, and exchange-rate effects.';
  }
  if (/\b(?:tv|television|finales?|films?|movies?|box office|audience|ratings?|watched|streamed)\b/.test(normalized)) {
    return 'Treat it as an estimate, not a clean official scoreboard: audience rankings can mix live ratings, repeats, international totals, streaming data, and survey methods.';
  }
  if (/\b(?:albums?|songs?|music|streamed|billboard|radio)\b/.test(normalized)) {
    return 'Treat it as an estimate, not a clean official scoreboard: music rankings can mix certified sales, shipments, streams, radio play, and regional chart methods.';
  }
  return 'Treat it as an estimate, not a clean official scoreboard: sources often use different date ranges, definitions, and measurement methods.';
}

function rankedCompanionReply(query: string): string {
  const topic = topicFromSearchQuery(query);
  return [
    `I put the ranked view for ${topic} on the canvas.`,
    rankedMethodCaveat(query),
  ].join(' ');
}

function shouldBuildRankedListVisual(query: string): boolean {
  const explicitRanking = /\b(?:best[-\s]?selling|bestselling|highest[-\s]?grossing|most(?:[-\s]+widely)?[-\s]?(?:popular|watched|streamed|played|downloaded|visited|read|sold)|top(?:\s+\d{1,3}|[-\s]?(?:selling|grossing|rated|watched|streamed|played|downloaded|read|sold))|rank(?:ed|ing)?|all[-\s]?time)\b/i
    .test(query);
  if (explicitRanking) return true;
  return /\b(?:biggest|largest|leading)\b(?=[^.!?]{0,90}\b(?:by|rank(?:ed|ing)?|sales|revenue|gross|market\s+cap|population|audience|views|downloads|players|units|copies|readership)\b)/i
    .test(query);
}

function shouldOpenSearchCanvas(query: string): boolean {
  return shouldBuildRankedListVisual(query)
    || isTimelineHistoryIntent(query)
    || /\b(canvas|visual|visualize|visual\s+breakdown|infographic|comparison\s+(?:board|chart|matrix)|side[-\s]?by[-\s]?side|timeline|chart|graph|diagram|flowchart|display|show me|put (?:it|this) on (?:the )?canvas|draw|map|ranked list|ranking)\b/i
    .test(query);
}

function shouldBuildNewsIntelligence(query: string): boolean {
  return /\b(latest|today|current|recent|news|headlines|update|updates|breaking|politics|government|parliament|election|war|conflict|crisis|policy)\b/i
    .test(query);
}

function shouldRouteSearchAsNewsBrief(query: string): boolean {
  const normalized = cleanSearchText(query).toLowerCase();
  if (!shouldBuildNewsIntelligence(normalized)) return false;
  const visualIntent = isNewVisualCanvasPrompt(normalized);
  const throughPresent = /\b(?:from|through|to|until)\s+(?:today|present|now|the modern era|modern day)\b/i.test(normalized);
  const historyShape = /\b(?:history|timeline|evolution|development|milestones|generations?|eras?|phases?)\b/i.test(normalized);
  const hardLiveCue = /\b(?:latest|current|news|headlines|updates?|breaking|today)\b/i.test(normalized);
  const hardLiveCueExcludingToday = /\b(?:latest|current|news|headlines|updates?|breaking)\b/i.test(normalized);
  if (visualIntent && throughPresent && historyShape && !hardLiveCueExcludingToday) return false;
  if (visualIntent && historyShape && /\brecent\b/i.test(normalized) && !hardLiveCueExcludingToday) return false;
  if (visualIntent && !hardLiveCue) return false;
  return true;
}

function shouldOpenNewsCanvas(query: string): boolean {
  return shouldBuildNewsIntelligence(query) || shouldOpenSearchCanvas(query);
}

function classifySearchTopic(query: string): string {
  const normalized = query.toLowerCase();
  if (/\b(news|headlines|breaking|war|conflict|election|politics|government|parliament)\b/.test(normalized)) return 'live brief';
  if (/\b(who is|profile|bio|person|ceo|founder|leader)\b/.test(normalized)) return 'profile';
  if (/\b(stock|market|price|earnings|revenue|shares)\b/.test(normalized)) return 'market watch';
  if (/\b(score|scores|game|match|standings)\b/.test(normalized)) return 'scoreboard';
  if (shouldBuildRankedListVisual(normalized)) return 'ranked list';
  if (isTimelineHistoryIntent(normalized)) return 'timeline';
  return 'current snapshot';
}

function resultSignal(item: SearchResultItem): string {
  return firstSentence(item.snippet || item.title, 190);
}

function resultBrief(item: SearchResultItem): string {
  const title = firstSentence(item.title, 120);
  const signal = firstSentence(item.snippet, 180);
  if (title && signal && !signal.toLowerCase().includes(title.toLowerCase())) {
    return `${title}: ${signal}`;
  }
  return signal || title;
}

function stripRepeatedLead(text: string, title: string): string {
  const cleaned = cleanSearchText(text);
  const cleanedTitle = cleanSearchText(title);
  if (!cleaned || !cleanedTitle) return cleaned;
  if (cleaned.toLowerCase().startsWith(`${cleanedTitle.toLowerCase()}:`)) {
    return cleaned.slice(cleanedTitle.length + 1).trim();
  }
  if (cleaned.toLowerCase().startsWith(cleanedTitle.toLowerCase())) {
    return cleaned.slice(cleanedTitle.length).replace(/^[:\s-]+/, '').trim();
  }
  return cleaned;
}

function isBoilerplateSentence(sentence: string): boolean {
  const text = cleanSearchText(sentence);
  if (text.length < 35) return true;
  if (text.length > 280) return true;
  if (/^(home|advertisement|subscribe|sign in|sign up|latest news|privacy policy|terms|cookies)\b/i.test(text)) return true;
  if (/\b(skip to|edition|newsletter|all rights reserved|follow us|share this|got a tip|view in english|get started explore)\b/i.test(text)) return true;
  const words = text.split(/\s+/);
  const capitalized = words.filter((word) => /^[A-Z][A-Za-z0-9'’-]*$/.test(word)).length;
  return words.length > 10 && capitalized / words.length > 0.62;
}

function sourceSentences(results: SearchResultItem[], docs: NewsSourceDoc[]): string[] {
  const text = [...docs, ...results]
    .map((item) => stripRepeatedLead(`${item.title || ''}. ${'content' in item ? item.content || '' : item.snippet || ''}`, item.title || ''))
    .join(' ');
  const sentences = cleanSearchText(text).match(/[^.!?]+(?:[.!?]+|$)/g) || [];
  return Array.from(new Set(sentences.map((item) => cleanSearchText(item)).filter((item) => !isBoilerplateSentence(item)))).slice(0, 8);
}

function plainSearchSentences(results: SearchResultItem[]): string[] {
  const text = results
    .map((item) => stripRepeatedLead(item.snippet || '', item.title || ''))
    .join(' ');
  const sentences = cleanSearchText(text).match(/[^.!?]+(?:[.!?]+|$)/g) || [];
  return Array.from(new Set(sentences.map((item) => cleanSearchText(item)).filter((item) => !isBoilerplateSentence(item)))).slice(0, 6);
}

function looksLikeRawSearchDump(text: string, results: SearchResultItem[]): boolean {
  const cleaned = cleanSearchText(text);
  if (!cleaned) return false;
  if (/\b(?:search results?|sources?\s+sampled|source\s*:|snippet\s*:|url\s*:|result\s+\d+\s*:)\b/i.test(cleaned)) return true;
  if (/https?:\/\//i.test(cleaned)) return true;

  const lower = cleaned.toLowerCase();
  const repeatedTitles = results.filter((item) => {
    const title = cleanSearchText(item.title);
    return title.length >= 12 && lower.includes(`${title.toLowerCase()}:`);
  });
  if (repeatedTitles.length > 0) return true;

  const colonSegments = cleaned.match(/\b[A-Z][^.!?\n]{8,90}:\s[^.!?\n]{18,}/g) || [];
  return colonSegments.length >= 2;
}

function normalizePlainSearchAnswer(value: unknown, results: SearchResultItem[]): string {
  const text = cleanSearchText(value);
  if (!text) return '';
  if (looksLikeRawSearchDump(text, results)) return '';
  if (/^(?:done|ok|okay|ready)\.?$/i.test(text)) return '';
  return text;
}

function fallbackPlainSearchAnswer(query: string, results: SearchResultItem[]): string {
  const topic = topicFromSearchQuery(query);
  const signals = plainSearchSentences(results);
  const usableSignals = signals.length
    ? signals
    : results
        .map((item) => resultSignal(item))
        .map((item) => stripRepeatedLead(item, topic))
        .filter(Boolean)
        .slice(0, 4);
  const uniqueSignals = Array.from(new Set(usableSignals.map((item) => cleanSearchText(item)).filter(Boolean))).slice(0, 4);

  if (!uniqueSignals.length) {
    return `I could not get enough clean page text to answer ${topic} without guessing.`;
  }

  const normalizedQuestion = cleanSearchText(query).toLowerCase();
  const evidence = cleanSearchText(uniqueSignals.join(' ')).toLowerCase();
  let lead = 'The cleanest read is:';
  if (/\b(?:is|are|can|could|does|do|did|has|have|is there|any way)\b/.test(normalizedQuestion)) {
    const hasPositiveSignal = /\b(?:available|can|supports?|allows?|added|works?|possible)\b/.test(evidence);
    const hasLimitationSignal = /\b(?:not available|not generally available|not supported|cannot|can't|no way|must be a player|needs a player|requires a player)\b/.test(evidence);
    if (hasPositiveSignal) {
      lead = 'Yes, with caveats:';
    } else if (hasLimitationSignal) {
      lead = 'The answer looks limited:';
    }
  }

  const [primary, ...rest] = uniqueSignals;
  const support = rest.slice(0, 2).join(' ');
  return support ? `${lead} ${primary} ${support}` : `${lead} ${primary}`;
}

async function synthesizePlainSearchAnswer(query: string, results: SearchResultItem[]): Promise<string> {
  const fallback = fallbackPlainSearchAnswer(query, results);
  try {
    const res = await fetch('/api/chat/search-answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, results: results.slice(0, 8) }),
    });
    if (!res.ok) throw new Error(`search answer failed (${res.status})`);
    const data = asRecord(await res.json());
    const brief = asRecord(data.brief || data.answer || {});
    const answer = normalizePlainSearchAnswer(
      data.answer || data.summary || brief.answer || brief.summary,
      results,
    );
    return answer || fallback;
  } catch (error) {
    console.warn('[chat-tool-handler] falling back to local search answer synthesis:', error);
    return fallback;
  }
}

function asStringArray(value: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) return fallback;
  return value.map((item) => cleanSearchText(item)).filter(Boolean).slice(0, 6);
}

function normalizeInsightList(value: unknown): NewsInsight[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record = asRecord(item);
      const label = cleanSearchText(record.label || record.title || '');
      const text = cleanSearchText(record.text || record.description || record.summary || '');
      return label && text ? { label, text } : null;
    })
    .filter(Boolean)
    .slice(0, 4) as NewsInsight[];
}

function fallbackNewsBrief(query: string, results: SearchResultItem[], docs: NewsSourceDoc[] = []): NewsIntelligenceBrief {
  const topic = topicFromSearchQuery(query);
  const developments = sourceSentences(results, docs).slice(0, 4);
  const textPool = [...docs, ...results].map((item) => `${item.title}. ${'content' in item ? item.content || item.snippet : item.snippet}`).join(' ');
  const actorMatches = Array.from(new Set(
    (textPool.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g) || [])
      .filter((name) => !/^(The|This|That|Today|Latest|News|United|British|Government)$/.test(name))
  )).slice(0, 4);
  const lead = developments[0] || (results[0] ? resultBrief(results[0]) : '') || `The returned sources are clustered around ${topic}.`;
  const second = developments.find((item) => item !== lead) || (results[1] ? resultBrief(results[1]) : '') || `I only have limited clean source text for ${topic}.`;

  return {
    headline: `Source-backed snapshot: ${topic}`,
    bottomLine: lead,
    whyItMatters: second,
    keyDevelopments: developments.length ? developments : [lead].filter(Boolean),
    stakes: actorMatches.length
      ? actorMatches.map((actor) => `${actor}: named in the returned source material.`)
      : [
          'Source confidence: whether cleaner source text confirms the same pattern.',
          'Timeline: whether later reporting adds dates, decisions, or quantified changes.',
          'Scope: whether the story remains narrow or connects to a wider trend.',
        ],
    watchNext: [
      'Compare later reporting against the same named actors, dates, and figures.',
      'Look for primary-source documents or direct statements before treating early summaries as settled.',
      'Check whether independent sources repeat the same core facts.',
    ],
    tensions: [
      { label: 'Source quality', text: 'The local fallback is using returned snippets and fetched excerpts because the stronger synthesis endpoint was unavailable.' },
      { label: 'Uncertainty', text: 'Treat this as a provisional brief until cleaner primary or specialist sources are available.' },
    ],
    sourceNames: [],
  };
}

function normalizeNewsBrief(value: unknown, query: string, results: SearchResultItem[], docs: NewsSourceDoc[]): NewsIntelligenceBrief {
  const record = asRecord(value);
  const fallback = fallbackNewsBrief(query, results, docs);
  const brief = asRecord(record.brief || record);
  const sourceNames = asStringArray(brief.sourceNames || brief.sources, fallback.sourceNames);
  return {
    headline: cleanSearchText(brief.headline) || fallback.headline,
    bottomLine: cleanSearchText(brief.bottomLine || brief.bottom_line) || fallback.bottomLine,
    whyItMatters: cleanSearchText(brief.whyItMatters || brief.why_it_matters) || fallback.whyItMatters,
    keyDevelopments: asStringArray(brief.keyDevelopments || brief.key_developments, fallback.keyDevelopments),
    stakes: asStringArray(brief.stakes, fallback.stakes),
    watchNext: asStringArray(brief.watchNext || brief.watch_next, fallback.watchNext),
    tensions: normalizeInsightList(brief.tensions).length ? normalizeInsightList(brief.tensions) : fallback.tensions,
    sourceNames,
  };
}

function buildSearchInfographicHtml(query: string, results: SearchResultItem[]): string {
  const topic = topicFromSearchQuery(query);
  const mode = classifySearchTopic(query);
  const topResults = results.slice(0, 5);
  const lead = resultSignal(topResults[0]) || firstSentence(topResults[0]?.title || topic, 180);
  const secondary = resultSignal(topResults[1]) || resultSignal(topResults[2]) || 'The latest returned sources are clustered around one developing story rather than separate, settled takeaways.';
  const sourceCount = new Set(topResults.map((item) => item.source || sourceNameFromUrl(item.url)).filter(Boolean)).size;
  const sourceNames = topResults
    .map((item) => item.source || sourceNameFromUrl(item.url))
    .filter(Boolean)
    .slice(0, 4);
  const facts = topResults.slice(0, 4).map((item, index) => {
    const signal = resultSignal(item) || firstSentence(item.title, 170) || 'New reporting is still developing.';
    return `<article class="fact fact-${index + 1}">
      <div class="fact-num">0${index + 1}</div>
      <p>${escapeHtml(signal)}</p>
    </article>`;
  }).join('');
  const sources = sourceNames.map((source) => `<span>${escapeHtml(source)}</span>`).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    html,body{margin:0;width:100%;height:100%;background:#111214;color:#f7f4ed;font-family:Inter,system-ui,sans-serif;overflow:hidden}
    body{min-height:100vh}
    main{height:100vh;box-sizing:border-box;padding:clamp(20px,3vw,42px);display:grid;grid-template-rows:auto 1fr auto;gap:clamp(16px,2vw,24px);background:
      radial-gradient(circle at 15% 12%,rgba(255,198,102,.26),transparent 30%),
      radial-gradient(circle at 88% 18%,rgba(72,182,171,.26),transparent 28%),
      linear-gradient(135deg,#111214 0%,#243039 52%,#2a1b22 100%)}
    header{display:grid;grid-template-columns:1fr auto;gap:18px;align-items:end}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.16em;color:#9ee6d8}
    h1{font-size:clamp(30px,5.5vw,68px);line-height:.98;margin:6px 0 0;letter-spacing:0;max-width:920px}
    .stamp{min-width:132px;text-align:right;border-left:1px solid rgba(255,255,255,.18);padding-left:18px;color:#d7d0c6}
    .stamp b{display:block;font-size:clamp(30px,4vw,50px);color:#f3c76d;line-height:1}
    .grid{display:grid;grid-template-columns:minmax(260px,.95fr) 1.2fr;gap:clamp(14px,2vw,24px);min-height:0}
    .lead,.fact,.sources{border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.085);border-radius:8px;box-shadow:0 24px 70px rgba(0,0,0,.22)}
    .lead{padding:clamp(18px,2.2vw,28px);display:flex;flex-direction:column;justify-content:space-between;gap:24px}
    .lead h2{font-size:clamp(20px,3vw,36px);line-height:1.08;margin:0;letter-spacing:0}
    .lead p,.fact p{margin:0;color:#e4ded5;line-height:1.45;font-size:clamp(14px,1.45vw,18px)}
    .meter{height:12px;border-radius:999px;background:linear-gradient(90deg,#f3c76d 0 58%,#9ee6d8 58% 82%,#f28f7c 82%);box-shadow:0 0 28px rgba(158,230,216,.22)}
    .facts{display:grid;grid-template-columns:1fr 1fr;grid-auto-rows:1fr;gap:clamp(12px,1.6vw,18px);min-height:0}
    .fact{padding:clamp(14px,1.8vw,22px);display:flex;flex-direction:column;gap:12px;overflow:hidden}
    .fact-num{width:42px;height:42px;border-radius:50%;display:grid;place-items:center;background:#f3c76d;color:#17130d;font-weight:900}
    .sources{padding:12px 14px;display:flex;gap:8px;align-items:center;overflow:hidden}
    .sources small{color:#aba397;white-space:nowrap}
    .sources span{font-size:12px;color:#17130d;background:#f5ead4;border-radius:999px;padding:6px 9px;white-space:nowrap}
    @media (max-width: 760px){
      main{overflow:auto;height:100vh}
      header{grid-template-columns:1fr}
      .stamp{text-align:left;border-left:0;border-top:1px solid rgba(255,255,255,.18);padding:12px 0 0}
      .grid,.facts{grid-template-columns:1fr}
      .lead,.fact{min-height:140px}
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <div class="label">${escapeHtml(mode)}</div>
        <h1>${escapeHtml(topic)}</h1>
      </div>
      <div class="stamp"><b>${topResults.length}</b> fresh signals</div>
    </header>
    <section class="grid" aria-label="Current information infographic">
      <article class="lead">
        <div>
          <div class="label">main thread</div>
          <h2>${escapeHtml(lead)}</h2>
        </div>
        <p>${escapeHtml(secondary)}</p>
        <div class="meter" aria-hidden="true"></div>
      </article>
      <section class="facts" aria-label="Key facts">
        ${facts}
      </section>
    </section>
    <footer class="sources"><small>${sourceCount || topResults.length} live signals</small>${sources}</footer>
  </main>
</body>
</html>`;
}

function rankedMetric(text: string): string {
  return cleanSearchText(text).match(/\b\d+(?:\.\d+)?\s?(?:million|billion|bn|m|copies|units|sales|views|players|downloads|gross|usd|\$)\b/gi)?.[0] || '';
}

function rankedLabel(item: SearchResultItem, index: number): string {
  const title = cleanSearchText(item.title)
    .replace(/\s*[-|:]\s*(?:Wikipedia|Goodreads|Statista|IMDb|Forbes|Rolling Stone|Billboard|The Numbers|Box Office Mojo|Guinness World Records).*$/i, '')
    .replace(/\b(?:List of|Wikipedia)\b:?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (title && title.length <= 90 && !/^(best|top|list of|most|highest|ranked)\b/i.test(title)) {
    return title;
  }
  const snippet = cleanSearchText(item.snippet);
  const namedWork = snippet.match(/\b((?:A|An|The)\s+[A-Z][A-Za-z0-9'’:&]+(?:\s+(?:of|the|and|in|to|a|an|for|from|[A-Z0-9][A-Za-z0-9'’:&]+)){1,8})(?:\s+by\b|\s+is\b|\s+was\b|,|\.)/)?.[1];
  const candidate = namedWork || snippet.match(/\b[A-Z][A-Za-z0-9'’:&]+(?:\s+(?:of|the|and|in|to|a|an|for|from|[A-Z0-9][A-Za-z0-9'’:&]+)){1,7}\b/)?.[0];
  return cleanSearchText(candidate || title || `Rank signal ${index + 1}`).slice(0, 90);
}

function rankedInsight(item: SearchResultItem): string {
  const signal = resultSignal(item);
  if (!signal) return 'This result contributes a ranking signal, but the snippet is thin.';
  return signal
    .replace(/\b(?:Similarly|See also|This is a list of)\b[:,]?\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildRankedListHtml(query: string, results: SearchResultItem[]): string {
  const topic = topicFromSearchQuery(query).replace(/\branked list visual\b/gi, '').trim() || topicFromSearchQuery(query);
  const rows = results.slice(0, 7).map((item, index) => {
    const label = rankedLabel(item, index);
    const metric = rankedMetric(`${item.title} ${item.snippet}`) || (index === 0 ? 'top signal' : 'supporting signal');
    const insight = rankedInsight(item);
    return `<article class="row">
      <div class="rank">${String(index + 1).padStart(2, '0')}</div>
      <div class="copy">
        <h2>${escapeHtml(label)}</h2>
        <p>${escapeHtml(insight)}</p>
      </div>
      <div class="metric">${escapeHtml(metric)}</div>
    </article>`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    html,body{margin:0;width:100%;height:100%;background:#111214;color:#f7f4ed;font-family:Inter,system-ui,sans-serif;overflow:hidden}
    main{height:100vh;box-sizing:border-box;padding:clamp(22px,3.5vw,48px);display:grid;grid-template-rows:auto 1fr auto;gap:18px;background:linear-gradient(135deg,#111214 0%,#25343a 52%,#2f2520 100%)}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.14em;color:#9ee6d8}
    h1{font-size:clamp(34px,5.8vw,72px);line-height:.96;letter-spacing:0;margin:8px 0 0;max-width:1040px}
    .rows{display:grid;gap:10px;min-height:0;overflow:hidden}
    .row{display:grid;grid-template-columns:58px minmax(0,1fr) minmax(110px,.22fr);align-items:center;gap:14px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.085);border-radius:8px;padding:13px 15px;min-height:0}
    .rank{width:46px;height:46px;border-radius:50%;display:grid;place-items:center;background:#f3c76d;color:#17130d;font-weight:900}
    h2{font-size:clamp(17px,2vw,25px);line-height:1.08;letter-spacing:0;margin:0}
    p{font-size:clamp(12px,1.25vw,16px);line-height:1.32;margin:5px 0 0;color:#ded8cf;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .metric{justify-self:end;border:1px solid rgba(158,230,216,.34);border-radius:999px;padding:7px 10px;color:#9ee6d8;font-weight:700;font-size:12px;white-space:nowrap;max-width:190px;overflow:hidden;text-overflow:ellipsis}
    footer{display:grid;grid-template-columns:1fr auto;gap:14px;color:#cfc7ba;font-size:13px}
    @media (max-width: 760px){
      main{overflow:auto;height:100vh}
      .row{grid-template-columns:42px 1fr}
      .rank{width:36px;height:36px}
      .metric{grid-column:2;justify-self:start}
      footer{grid-template-columns:1fr}
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div class="label">ranked estimate</div>
      <h1>${escapeHtml(topic)}</h1>
    </header>
    <section class="rows" aria-label="Ranked list">${rows}</section>
    <footer>
      <span>${escapeHtml(rankedMethodCaveat(query))}</span>
      <span>${escapeHtml(String(results.length))} live signals</span>
    </footer>
  </main>
</body>
</html>`;
}

function buildNewsIntelligenceHtml(query: string, brief: NewsIntelligenceBrief): string {
  const topic = topicFromSearchQuery(query);
  const developments = brief.keyDevelopments.slice(0, 4)
    .map((item, index) => `<article class="dev"><b>${String(index + 1).padStart(2, '0')}</b><p>${escapeHtml(item)}</p></article>`)
    .join('');
  const stakes = brief.stakes.slice(0, 4)
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join('');
  const watch = brief.watchNext.slice(0, 3)
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join('');
  const tensions = brief.tensions.slice(0, 3)
    .map((item) => `<article class="tension"><span>${escapeHtml(item.label)}</span><p>${escapeHtml(item.text)}</p></article>`)
    .join('');
  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    html,body{margin:0;width:100%;height:100%;background:#101112;color:#f8f5ef;font-family:Inter,system-ui,sans-serif;overflow:hidden}
    main{height:100vh;box-sizing:border-box;display:grid;grid-template-rows:auto 1fr;gap:clamp(14px,2vw,24px);padding:clamp(22px,3.4vw,48px);background:linear-gradient(135deg,#101112 0%,#243238 54%,#2b2223 100%)}
    header{display:grid;grid-template-columns:1fr minmax(220px,.42fr);gap:clamp(18px,3vw,34px);align-items:end}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.14em;color:#9ee6d8}
    h1{font-size:clamp(34px,5.8vw,76px);line-height:.96;letter-spacing:0;margin:7px 0 0;max-width:980px}
    .bottom{border-left:1px solid rgba(255,255,255,.18);padding-left:18px;color:#f0d28a;font-size:clamp(16px,1.7vw,22px);line-height:1.25}
    .grid{display:grid;grid-template-columns:1.05fr .95fr;gap:clamp(14px,2vw,24px);min-height:0}
    .panel,.dev,.tension{border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.085);border-radius:8px;box-shadow:0 24px 70px rgba(0,0,0,.23)}
    .panel{padding:clamp(16px,2vw,24px);min-height:0;overflow:hidden}
    .why{display:grid;gap:14px}
    .why p{font-size:clamp(18px,2.2vw,30px);line-height:1.15;margin:0}
    .developments{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px}
    .dev{display:grid;grid-template-columns:44px 1fr;gap:12px;padding:14px;min-height:96px}
    .dev b{width:38px;height:38px;border-radius:50%;display:grid;place-items:center;background:#f3c76d;color:#17130d}
    .dev p,.tension p,li{margin:0;color:#e4ded5;font-size:clamp(13px,1.35vw,17px);line-height:1.38}
    .side{display:grid;grid-template-rows:auto 1fr;gap:12px;min-height:0}
    ul{list-style:none;margin:12px 0 0;padding:0;display:grid;gap:10px}
    li{padding:11px 0;border-top:1px solid rgba(255,255,255,.11)}
    .tensions{display:grid;gap:10px;margin-top:12px}
    .tension{padding:13px}
    .tension span{display:block;color:#9ee6d8;font-size:12px;text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px}
    @media (max-width: 780px){
      main{overflow:auto;height:100vh}
      header,.grid,.developments{grid-template-columns:1fr}
      .bottom{border-left:0;border-top:1px solid rgba(255,255,255,.18);padding:14px 0 0}
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <div class="label">intelligence brief / ${escapeHtml(topic)}</div>
        <h1>${escapeHtml(brief.headline)}</h1>
      </div>
      <div class="bottom">${escapeHtml(brief.bottomLine)}</div>
    </header>
    <section class="grid">
      <section class="panel why">
        <div class="label">why it matters</div>
        <p>${escapeHtml(brief.whyItMatters)}</p>
        <div class="developments">${developments}</div>
      </section>
      <section class="side">
        <section class="panel">
          <div class="label">stakes</div>
          <ul>${stakes}</ul>
        </section>
        <section class="panel">
          <div class="label">watch next</div>
          <ul>${watch}</ul>
          <div class="tensions">${tensions}</div>
        </section>
      </section>
    </section>
  </main>
</body>
</html>`;
}

function newsBriefToReply(brief: NewsIntelligenceBrief): string {
  const developments = brief.keyDevelopments.slice(0, 3).map((item) => `- ${item}`).join('\n');
  const watch = brief.watchNext[0] ? `\n\nWatch next: ${brief.watchNext[0]}` : '';
  return `${brief.bottomLine}\n\n${brief.whyItMatters}\n\n${developments}${watch}`;
}

async function fetchNewsSourceDocs(results: SearchResultItem[]): Promise<NewsSourceDoc[]> {
  const targets = results
    .filter((item) => /^https?:\/\//i.test(item.url))
    .slice(0, 4);
  const settled = await Promise.allSettled(
    targets.map(async (item) => {
      const data = await invokeBotGatewayTool('bot_web_fetch', { url: item.url });
      const result = asRecord(data.result ?? data);
      const content = cleanSearchText(result.content || data.content || '');
      return { ...item, content: content.slice(0, 3200) };
    }),
  );
  return settled
    .map((entry, index) => entry.status === 'fulfilled'
      ? entry.value
      : { ...targets[index], content: targets[index]?.snippet || '' })
    .filter((item): item is NewsSourceDoc => Boolean(item?.title || item?.content || item?.snippet));
}

async function synthesizeNewsIntelligence(
  query: string,
  results: SearchResultItem[],
  docs: NewsSourceDoc[],
): Promise<NewsIntelligenceBrief> {
  try {
    const res = await fetch('/api/chat/news-intelligence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, results: results.slice(0, 8), documents: docs.slice(0, 4) }),
    });
    if (!res.ok) throw new Error(`news intelligence failed (${res.status})`);
    const data = await res.json();
    return normalizeNewsBrief(data, query, results, docs);
  } catch (error) {
    console.warn('[chat-tool-handler] falling back to local news brief synthesis:', error);
    return fallbackNewsBrief(query, results, docs);
  }
}

async function summarizeNewsIntelligence(query: string, results: SearchResultItem[]): Promise<string> {
  const docs = await fetchNewsSourceDocs(results);
  const brief = await synthesizeNewsIntelligence(query, results, docs);
  if (shouldOpenNewsCanvas(query)) {
    openHtmlCanvas(`Intelligence Brief: ${topicFromSearchQuery(query)}`, buildNewsIntelligenceHtml(query, brief), {
      scenario: 'news-intelligence-brief',
      query,
      resultCount: results.length,
      fetchedCount: docs.length,
      fullscreen: true,
      wonder: true,
    });
    return `${newsBriefToReply(brief)}\n\n[[pearl:companion-ready]]`;
  }
  return newsBriefToReply(brief);
}

async function summarizeSearchResults(data: JsonRecord, fallbackQuery = ''): Promise<string> {
  const { query: returnedQuery, results, error } = extractSearchResults(data);
  if (error) {
    return `Search failed: ${error}`;
  }
  const cleanFallback = cleanSearchText(fallbackQuery);
  const cleanReturned = cleanSearchText(returnedQuery);
  const fallbackHasVisualIntent = Boolean(cleanFallback && shouldOpenSearchCanvas(cleanFallback));
  const query = fallbackHasVisualIntent ? cleanFallback : cleanReturned || cleanFallback;
  const queryLabel = query ? ` for ${topicFromSearchQuery(query)}` : '';
  if (!results.length) {
    return `I could not get a clean result${queryLabel}. The available pages were empty, blocked, or not useful enough to answer from.`;
  }

  const topic = topicFromSearchQuery(query);
  if (results.length && shouldBuildRankedListVisual(query)) {
    return `${rankedCompanionReply(query)}\n\n[[pearl:companion-ready]]`;
  }
  if (shouldOpenSearchCanvas(query)) {
    return `${visualCompanionReply(query)}\n\n[[pearl:companion-ready]]`;
  }
  return synthesizePlainSearchAnswer(query || topic, results);
}

function summarizePublicProfile(data: JsonRecord): string {
  const result = asRecord(data.result ?? data);
  if (result?.success === false) {
    return `Public profile lookup failed: ${result.error || 'unknown error'}`;
  }

  const profile = asRecord(result.public_profile);
  const lines: string[] = [];
  const visibility = result.is_public ? 'public' : 'not marked public';
  lines.push(`Visibility: ${visibility}`);

  const displayName = String(profile.displayName || '').trim();
  const bio = String(profile.bio || '').trim();
  const location = String(profile.location || '').trim();
  const profession = String(profile.profession || '').trim();
  const avatarUrl = String(profile.avatarUrl || '').trim();
  const interests = Array.isArray(profile.interests)
    ? profile.interests.map((item) => String(item).trim()).filter(Boolean)
    : [];
  const socialLinks = asRecord(profile.socialLinks);
  const links = Object.entries(socialLinks)
    .map(([key, value]) => [key, String(value || '').trim()] as const)
    .filter(([, value]) => Boolean(value));

  if (displayName) lines.push(`Display name: ${displayName}`);
  if (bio) lines.push(`Bio: ${bio}`);
  if (profession) lines.push(`Profession: ${profession}`);
  if (location) lines.push(`Location: ${location}`);
  if (interests.length) lines.push(`Interests: ${interests.join(', ')}`);
  if (links.length) lines.push(`Links: ${links.map(([key, value]) => `${key}: ${value}`).join(', ')}`);
  if (avatarUrl) lines.push(`Avatar: ${avatarUrl}`);

  if (lines.length <= 1) {
    return 'Your PearlOS public profile does not have public-facing details filled in yet.';
  }
  return `PearlOS public profile:\n${lines.join('\n')}`;
}

type TaskListItem = {
  title: string;
  status: string;
  result: string;
  notes: string[];
  noteFilename: string;
  artifactUrl: string;
  fileSpacePath: string;
};

function normalizeTaskListItem(value: unknown): TaskListItem | null {
  const record = asRecord(value);
  const title = cleanSearchText(record.title || record.task || '');
  if (!title) return null;
  const notes = Array.isArray(record.notes)
    ? record.notes
        .map((note) => sanitizeTaskResultForUser(asRecord(note).text || note, 320))
        .map((note) => cleanSearchText(note))
        .filter(Boolean)
        .slice(-2)
    : [];
  return {
    title,
    status: cleanSearchText(record.status || 'unknown').replace(/_/g, ' '),
    result: cleanSearchText(sanitizeTaskResultForUser(record.result || '', 320)),
    notes,
    noteFilename: cleanSearchText(record.noteFilename || record.note_filename || ''),
    artifactUrl: cleanSearchText(record.artifactUrl || record.artifact_url || ''),
    fileSpacePath: cleanSearchText(record.fileSpacePath || record.file_space_path || ''),
  };
}

async function fetchTaskBucket(status: string, limit: number): Promise<TaskListItem[]> {
  const res = await fetch(`/api/tasks?status=${encodeURIComponent(status)}&limit=${limit}`, {
    cache: 'no-store',
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Task status failed (${res.status})${detail ? `: ${detail.slice(0, 140)}` : ''}`);
  }
  const data = await res.json();
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  return tasks.map(normalizeTaskListItem).filter(Boolean) as TaskListItem[];
}

function taskMatchesQuery(task: TaskListItem, query: string): boolean {
  if (!query) return true;
  const haystack = `${task.title} ${task.result} ${task.notes.join(' ')}`.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).some((part) => haystack.includes(part));
}

function summarizeTaskBucket(label: string, tasks: TaskListItem[]): string {
  if (!tasks.length) return '';
  const lines = tasks.slice(0, 4).map((task) => {
    const detail = task.result || task.notes[task.notes.length - 1] || '';
    const destinations = [
      task.artifactUrl ? `artifact ${task.artifactUrl}` : '',
      task.fileSpacePath ? `FileSpace ${task.fileSpacePath}` : '',
      task.noteFilename ? `note ${task.noteFilename}` : '',
    ].filter(Boolean);
    const destination = destinations.length ? ` Result: ${destinations.join(', ')}.` : '';
    return detail ? `- ${task.title}: ${detail}${destination}` : `- ${task.title}${destination}`;
  });
  return `${label}:\n${lines.join('\n')}`;
}

async function botListTasks(args: Record<string, unknown>): Promise<string> {
  const query = cleanSearchText(args.query || args.search || args.title || '');
  const rawLimit = Number(args.limit || 8);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.round(rawLimit), 3), 20) : 8;
  const [inProgress, pending, completed, failed] = await Promise.all([
    fetchTaskBucket('in_progress', limit),
    fetchTaskBucket('pending', limit),
    fetchTaskBucket('completed', limit),
    fetchTaskBucket('failed', limit),
  ]);
  const filter = (items: TaskListItem[]) => items.filter((task) => taskMatchesQuery(task, query));
  const activeMatches = filter(inProgress);
  const pendingMatches = filter(pending);
  const completedMatches = filter(completed);
  const failedMatches = filter(failed);
  const totalActive = activeMatches.length + pendingMatches.length;
  const totalCompleted = completedMatches.length;
  const totalFailed = failedMatches.length;
  const issueLead = query
    ? `I checked PearlOS tasks for "${query}".`
    : 'I checked the PearlOS task queue.';
  let statusLine = `${issueLead} I do not see a matching task still actively running.`;
  if (totalActive) {
    statusLine = `${issueLead} There ${totalActive === 1 ? 'is' : 'are'} ${totalActive} matching active item${totalActive === 1 ? '' : 's'} right now.`;
  } else if (totalCompleted) {
    statusLine = `${issueLead} The matching task ${totalCompleted === 1 ? 'is finished' : 'tasks are finished'}.`;
  } else if (totalFailed) {
    statusLine = `${issueLead} The matching task ${totalFailed === 1 ? 'failed' : 'matches failed'}.`;
  }
  const sections = [
    summarizeTaskBucket('Running now', activeMatches),
    summarizeTaskBucket('Queued', pendingMatches),
    summarizeTaskBucket('Recently completed', completedMatches),
    summarizeTaskBucket('Recent failures', failedMatches),
  ].filter(Boolean);
  return sections.length ? `${statusLine}\n\n${sections.join('\n\n')}` : statusLine;
}

async function invokeBotGatewayTool(toolName: string, params: Record<string, unknown>): Promise<JsonRecord> {
  const timeoutMs = Number(params.__client_timeout_ms || 0);
  const {
    __client_timeout_ms: _ignoredClientTimeoutMs,
    ...gatewayParams
  } = params;
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool_name: toolName, params: gatewayParams }),
  };
  if (Number.isFinite(timeoutMs) && timeoutMs > 0 && typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    init.signal = AbortSignal.timeout(Math.min(Math.max(Math.round(timeoutMs), 1000), 30000));
  }
  const res = await fetch('/api/tools/invoke', {
    ...init,
  });
  const text = await res.text();
  let parsed: JsonRecord = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }
  if (!res.ok) {
    const detail = parsed?.detail || parsed?.error || text;
    throw new Error(`Tool gateway failed (${res.status})${detail ? `: ${String(detail).slice(0, 180)}` : ''}`);
  }
  return parsed;
}

type OnboardingState = {
  currentBeat?: number;
  completedBeats?: string[];
  requiredActions?: {
    profileUpdated?: boolean;
    welcomeNoteCreated?: boolean;
  };
  source?: string;
  promptFeatureKey?: string;
  updatedAt?: string;
};

const REQUIRED_ONBOARDING_ACTIONS = ['profileUpdated', 'welcomeNoteCreated'] as const;
const SKIP_ONBOARDING_REASONS = new Set(['skip', 'stop', 'already_done', 'already-done', 'already done']);

function onboardingReason(args: Record<string, unknown>): string {
  return String(args.reason || 'completed').trim().toLowerCase();
}

async function fetchCurrentUserProfile(): Promise<Record<string, unknown> | null> {
  const res = await fetch('/api/userProfile');
  if (!res.ok) return null;
  const body = await res.json().catch(() => null) as { items?: Record<string, unknown>[] } | null;
  return Array.isArray(body?.items) && body.items.length > 0 ? body.items[0] : null;
}

function mergeOnboardingState(existing: unknown, incoming: OnboardingState): OnboardingState {
  const base = (existing && typeof existing === 'object' && !Array.isArray(existing))
    ? existing as OnboardingState
    : {};
  const completedBeats = [
    ...(Array.isArray(base.completedBeats) ? base.completedBeats : []),
    ...(Array.isArray(incoming.completedBeats) ? incoming.completedBeats : []),
  ].map((beat) => String(beat).trim()).filter(Boolean);

  return {
    ...base,
    ...incoming,
    completedBeats: Array.from(new Set(completedBeats)),
    requiredActions: {
      ...(base.requiredActions || {}),
      ...(incoming.requiredActions || {}),
    },
    promptFeatureKey: 'onboarding',
    updatedAt: new Date().toISOString(),
  };
}

function missingRequiredOnboardingActions(state: unknown): string[] {
  const record = (state && typeof state === 'object' && !Array.isArray(state)) ? state as OnboardingState : {};
  const actions = record.requiredActions || {};
  return REQUIRED_ONBOARDING_ACTIONS.filter((key) => actions[key] !== true);
}

async function patchOnboardingState(profile: Record<string, unknown> | null, state: OnboardingState, complete?: boolean): Promise<Response> {
  const body: Record<string, unknown> = {
    onboardingState: mergeOnboardingState(profile?.onboardingState, state),
  };
  const id = profile?._id || profile?.page_id;
  if (id) body.id = id;
  if (complete !== undefined) body.onboardingComplete = complete;

  return fetch('/api/userProfile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function botOnboardingProgress(args: Record<string, unknown>): Promise<string> {
  const profile = await fetchCurrentUserProfile();
  const currentBeat = typeof args.currentBeat === 'number' ? Math.trunc(args.currentBeat) : undefined;
  const completedBeat = String(args.completedBeat || '').trim();
  const action = String(args.action || '').trim() as typeof REQUIRED_ONBOARDING_ACTIONS[number];
  const state: OnboardingState = {
    source: String(args.source || 'text'),
  };
  if (currentBeat !== undefined) state.currentBeat = currentBeat;
  if (completedBeat) state.completedBeats = [completedBeat];
  if ((REQUIRED_ONBOARDING_ACTIONS as readonly string[]).includes(action)) {
    state.requiredActions = { [action]: true };
  }

  const res = await patchOnboardingState(profile, state);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Could not record onboarding progress (${res.status}): ${text.slice(0, 180)}`);
  }
  return 'Onboarding progress recorded.';
}

async function botOnboardingComplete(args: Record<string, unknown>): Promise<string> {
  const reason = onboardingReason(args);
  const profile = await fetchCurrentUserProfile();
  if (profile?.onboardingComplete === true) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(NIA_EVENT_ONBOARDING_COMPLETE, {
        detail: {
          event: 'onboarding.complete',
          envelope: { v: 1, kind: 'tool', seq: 0, ts: Date.now(), payload: {} },
          payload: {},
        },
      }));
    }
    return 'Onboarding was already complete.';
  }

  const missingActions = missingRequiredOnboardingActions(profile?.onboardingState);
  if (!SKIP_ONBOARDING_REASONS.has(reason) && missingActions.length > 0) {
    return `Onboarding is not complete yet. Missing required actions: ${missingActions.join(', ')}.`;
  }

  const res = await fetch('/api/userProfile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: profile?._id || profile?.page_id,
      onboardingComplete: true,
      onboardingState: mergeOnboardingState(profile?.onboardingState, {
        completedBeats: ['complete'],
        source: 'text',
      }),
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Could not mark onboarding complete (${res.status}): ${text.slice(0, 180)}`);
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(NIA_EVENT_ONBOARDING_COMPLETE, {
        detail: {
          event: 'onboarding.complete',
          envelope: { v: 1, kind: 'tool', seq: 0, ts: Date.now(), payload: {} },
          payload: {},
        },
      }),
    );
  }
  return 'Onboarding marked as complete.';
}

async function botWebSearch(args: Record<string, unknown>): Promise<string> {
  const query = String(args.query || args.q || args.search || '').trim();
  if (!query) throw new Error('query is required for bot_web_search');
  const countRaw = Number(args.count || args.limit || (shouldBuildNewsIntelligence(query) ? 8 : 5));
  const count = Number.isFinite(countRaw) ? Math.min(Math.max(Math.round(countRaw), 1), 10) : 5;
  const routeAsNewsBrief = shouldRouteSearchAsNewsBrief(query);
  const visualTimeoutMs = shouldOpenSearchCanvas(query) && !routeAsNewsBrief ? 9000 : 0;
  const data = await invokeBotGatewayTool('bot_web_search', {
    query,
    count,
    ...(visualTimeoutMs ? { __client_timeout_ms: visualTimeoutMs } : {}),
  });
  const { results } = extractSearchResults(data);
  if (results.length && routeAsNewsBrief) {
    return summarizeNewsIntelligence(query, results);
  }
  if (results.length && shouldOpenSearchCanvas(query)) {
    const ranked = shouldBuildRankedListVisual(query);
    openHtmlCanvas(`${ranked ? 'Ranked List' : 'Infographic'}: ${topicFromSearchQuery(query)}`, ranked ? buildRankedListHtml(query, results) : buildSearchInfographicHtml(query, results), {
      scenario: 'web-search-brief',
      query,
      resultCount: results.length,
      fullscreen: true,
      wonder: true,
    });
  }
  return summarizeSearchResults(data, query);
}

async function botWebFetch(args: Record<string, unknown>): Promise<string> {
  const url = String(args.url || args.href || '').trim();
  if (!url) throw new Error('url is required for bot_web_fetch');
  const data = await invokeBotGatewayTool('bot_web_fetch', { url });
  const result = asRecord(data.result ?? data);
  if (result?.success === false) {
    return `Fetch failed: ${result.error || 'unknown error'}`;
  }
  const rawContent = String(result?.content || '');
  if (looksLikeBrowserChallenge(rawContent)) {
    return `That page is blocking automated reading, so I could not use its contents directly.`;
  }
  const content = cleanSearchText(rawContent);
  if (!content) {
    return `That page did not return readable text.`;
  }
  const title = cleanSearchText(result.title || result.page_title || result.name || url);
  const query = cleanSearchText(args.query || args.question || args.prompt || `Summarize ${title || url}`);
  return synthesizePlainSearchAnswer(query, [{
    title,
    url,
    snippet: content.slice(0, 3200),
    source: sourceNameFromUrl(url),
  }]);
}

async function botGetPublicProfile(): Promise<string> {
  const data = await invokeBotGatewayTool('bot_get_public_profile', {});
  return summarizePublicProfile(data);
}

async function botWonderCanvasTemplate(args: Record<string, unknown>): Promise<string> {
  const template = String(args.template || args.name || 'fact_card').trim();
  const data = (args.data && typeof args.data === 'object') ? args.data as Record<string, unknown> : {};
  const transition = String(args.transition || 'fade');
  const title = cleanSearchText(data.title || data.heading || template.replace(/_/g, ' ')) || 'Canvas';
  openHtmlCanvas(
    title,
    buildGenericTemplateHtml(template, data),
    { scenario: 'chat-template', template, transition },
  );
  const summary = [
    cleanSearchText(data.subtitle || data.kicker || data.label || ''),
    cleanSearchText(data.summary || data.body || data.text || data.description || ''),
  ].filter(Boolean).join(' ');
  return [
    `Wonder Canvas opened: ${title}.`,
    summary ? `Canvas summary: ${summary.slice(0, 700)}` : 'Give the user a concise companion note in chat that explains what to look at first.',
  ].join(' ');
}

async function pearlCanvas(args: Record<string, unknown>): Promise<string> {
  const action = String(args.action || 'template');
  if (action === 'clear') return botWonderCanvasClear();
  if (action === 'scene') return botWonderCanvasScene(args);
  return botWonderCanvasTemplate(args);
}

async function botWonderCanvasScene(args: Record<string, unknown>): Promise<string> {
  const html = String(args.html || '').trim();
  const url = String(args.url || '').trim();
  if (!html && !url) throw new Error('html or url is required for bot_wonder_canvas_scene');
  const title = cleanSearchText(args.title || 'Wonder Canvas') || 'Wonder Canvas';
  const payload = {
    html,
    url,
    css: String(args.css || ''),
    transition: String(args.transition || 'fade'),
    layer: String(args.layer || 'main'),
    title,
    meta: {
      source: 'webchat',
      ...((args.meta && typeof args.meta === 'object') ? args.meta as Record<string, unknown> : {}),
    },
  };
  routeNiaEvent('wonder.scene', payload);
  const visibleText = html ? visibleTextFromHtml(html) : '';
  return [
    `Wonder Canvas opened: ${title}.`,
    visibleText
      ? `Visible canvas text: ${visibleText}`
      : 'Give the user a concise companion note in chat that explains what changed visually.',
  ].join(' ');
}

async function botWonderCanvasClear(): Promise<string> {
  routeNiaEvent('wonder.clear', {});
  return 'Cleared Wonder Canvas.';
}

async function botCreateNote(args: Record<string, unknown>): Promise<string> {
  const title = String(args.title || 'Untitled Note');
  const content = String(args.content ?? '');

  const res = await fetch(notesFileApiUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, content }),
  });

  if (!res.ok) {
    throw new Error(`Failed to create note (${res.status})`);
  }

  const created = await res.json();

  openNotesWindow();
  scheduleNoteOpen(created);
  await botOnboardingProgress({ action: 'welcomeNoteCreated', source: 'text' }).catch(() => undefined);

  return `Note created: ${title}`;
}

async function botUpdateNote(args: Record<string, unknown>): Promise<string> {
  const id = String(args.note_id || args.noteId || args.id || '');
  const title = args.title != null ? String(args.title) : undefined;
  const content = args.content != null ? String(args.content) : undefined;

  if (!id) throw new Error('note_id is required for bot_update_note');

  const body: Record<string, unknown> = { id };
  if (title !== undefined) body.title = title;
  if (content !== undefined) body.content = content;

  const res = await fetch(notesFileApiUrl(), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Failed to update note (${res.status})`);
  }

  dispatchNoteUpdated(id);

  return `Note updated: ${title || id}`;
}

async function botOpenNote(args: Record<string, unknown>): Promise<string> {
  const id = String(args.note_id || args.noteId || args.id || '');
  const titleQuery = String(args.title || args.note_title || args.noteName || args.note_name || '').trim();
  if (!id && !titleQuery) throw new Error('note_id or title is required for bot_open_note');

  // Fetch the note so we can embed it in the event for the fast path
  let note: Record<string, unknown> | null = null;
  try {
    if (id) {
      const res = await fetch(notesFileApiUrl({ id }));
      if (res.ok) {
        note = await res.json();
      }
    } else if (titleQuery) {
      const res = await fetch(notesFileApiUrl({ title: titleQuery }));
      if (res.ok) {
        const notes = await res.json();
        if (Array.isArray(notes) && notes.length > 0) {
          const normalized = titleQuery.toLowerCase();
          note = notes.find((n: Record<string, unknown>) => String(n.title || '').toLowerCase() === normalized) ?? notes[0];
        }
      }
    }
  } catch {
    // Fall through — the notes-view listener will try to find it by ID
  }

  const noteToOpen = note ?? { _id: id || titleQuery, title: titleQuery };
  openNotesWindow();
  scheduleNoteOpen(noteToOpen);

  const title = note?.title ? String(note.title) : (titleQuery || id);
  return `Opened note: ${title}`;
}

// ─── View / app open/close handlers ──────────────────────────────────────────
// Voice mode delivers `app.open` / `apps.close` envelopes through Daily; chat
// mode never opened the app at all because these tools were unregistered. The
// handlers below dispatch the same window lifecycle requests used by voice.

function openAppByName(app: string): string {
  if (app.trim().toLowerCase() === 'settings') {
    dispatchPearlSettingsOpen('connections');
    return 'Opening Settings.';
  }
  const viewType = resolveViewType(app);
  requestWindowOpen({ viewType, source: `chat-tool:${app}` });
  return `Opening ${app}.`;
}

function closeAppByName(app: string): string {
  const viewType = resolveViewType(app);
  requestWindowClose({ viewType, source: `chat-tool:close-${app}` });
  return `Closed ${app}.`;
}

async function botOpenTerminal(): Promise<string> {
  return openAppByName('terminal');
}

async function botOpenFiles(args: Record<string, unknown>): Promise<string> {
  const query = typeof args?.fileSearchQuery === 'string'
    ? args.fileSearchQuery
    : typeof args?.query === 'string'
      ? args.query
      : typeof args?.search === 'string'
        ? args.search
        : '';
  requestWindowOpen({
    viewType: 'files',
    viewState: query.trim()
      ? { fileSearchQuery: query.trim(), fileSearchNonce: Date.now() }
      : undefined,
    source: 'chat-tool:files',
  });
  return query.trim()
    ? `Opening FileSpace and looking for: ${query.trim()}`
    : 'Opening FileSpace.';
}

async function botOpenNews(args: Record<string, unknown>): Promise<string> {
  const viewType = resolveViewType('news');
  const meta = args?.category ? { category: String(args.category) } : undefined;
  requestWindowOpen({ viewType, source: 'chat-tool:news', meta });
  return 'Opening The News.';
}

async function botOpenYoutube(): Promise<string> {
  return openAppByName('youtube');
}

async function botOpenCreationEngine(): Promise<string> {
  return openAppByName('creation-engine');
}

async function botOpenNotesApp(): Promise<string> {
  openNotesWindow();
  return 'Opening notes.';
}

async function botCloseTerminal(): Promise<string> {
  return closeAppByName('terminal');
}

async function botCloseNotes(): Promise<string> {
  return closeAppByName('notes');
}

async function botCloseYoutube(): Promise<string> {
  return closeAppByName('youtube');
}

async function botCloseAppletCreationEngine(): Promise<string> {
  return closeAppByName('creation-engine');
}

async function botCloseBrowserWindow(args: Record<string, unknown>): Promise<string> {
  const apps = Array.isArray(args.apps) ? (args.apps as unknown[]).map(String) : [];
  if (apps.length === 0) {
    // Match voice-mode safe fallback: only close non-essential surface apps.
    const safe = ['news', 'weather', 'browser'];
    for (const a of safe) closeAppByName(a);
    return 'Closing windows.';
  }
  for (const a of apps) closeAppByName(a);
  return `Closed ${apps.join(', ')}.`;
}

async function botSwitchDesktopMode(args: Record<string, unknown>): Promise<string> {
  const mode = String(args.mode || 'home').toLowerCase();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(NIA_EVENT_DESKTOP_MODE_SWITCH, {
        detail: { mode, payload: { mode }, timestamp: Date.now() },
      }),
    );
  }
  return `Switched to ${mode} mode.`;
}

async function botSwitchLayoutMode(args: Record<string, unknown>): Promise<string> {
  const mode = String(args.mode || 'desktop').toLowerCase();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(NIA_EVENT_LAYOUT_MODE_SWITCH, {
        detail: { mode, payload: { mode }, timestamp: Date.now() },
      }),
    );
  }
  return `Switched layout to ${mode}.`;
}

function normalizeCustomizePayload(args: Record<string, unknown>): InterfaceCustomizePayload {
  const action = String(args.action || '').toLowerCase();
  const theme = String(args.theme || '').trim().toLowerCase();
  const normalizedTheme = theme.replace(/_/g, '-').replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || undefined;
  const description = String(args.description || '').trim();
  const backgroundDescription = String(args.backgroundDescription || args.background_description || '').trim();
  const iconDescription = String(args.iconDescription || args.icon_description || '').trim();
  const target = String(args.target || '').toLowerCase();
  const app = String(args.app || args.icon || '').trim();
  const sourceImageUrl = String(args.sourceImageUrl || args.source_image_url || '').trim();

  return {
    action: action || (normalizedTheme ? 'theme' : 'all'),
    ...(normalizedTheme ? { theme: normalizedTheme } : {}),
    ...(description ? { description } : {}),
    ...(backgroundDescription ? { backgroundDescription } : {}),
    ...(iconDescription ? { iconDescription } : {}),
    ...(target ? { target } : {}),
    ...(app ? { app } : {}),
    ...(sourceImageUrl ? { sourceImageUrl } : {}),
  };
}

function titleCase(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

async function botCustomizeInterface(args: Record<string, unknown>): Promise<string> {
  const payload = normalizeCustomizePayload(args);
  const hasCustomization =
    Boolean(payload.theme) ||
    Boolean(payload.description) ||
    Boolean(payload.backgroundDescription) ||
    Boolean(payload.iconDescription) ||
    Boolean(payload.sourceImageUrl);
  if (!hasCustomization) {
    throw new Error('theme, description, or sourceImageUrl is required for bot_customize_interface');
  }
  if (payload.action === 'theme' && !payload.theme) {
    throw new Error('A valid built-in or custom PearlOS theme is required');
  }

  await applyInterfaceCustomizePayload(payload);

  if (payload.theme && (payload.action === 'theme' || !payload.description)) {
    return `Switched the interface to ${titleCase(String(payload.theme))}.`;
  }
  if (payload.action === 'background') {
    return 'Updated the home and desktop backgrounds.';
  }
  if (payload.action === 'icons') {
    return payload.app
      ? `Updated the ${payload.app} icon.`
      : 'Updated the desktop icons.';
  }
  return 'Updated the interface appearance.';
}

function taskTitleFromText(task: string, explicitTitle: unknown): string | undefined {
  const title = typeof explicitTitle === 'string' ? explicitTitle.trim() : '';
  if (title && title.toLowerCase() !== 'task') return title;
  return undefined;
}

async function botOpenClawTask(args: Record<string, unknown>): Promise<string> {
  const task = String(args.task || args.description || '').trim();
  if (!task) throw new Error('task is required for bot_openclaw_task');

  // Always execute immediately — if the LLM dispatched a task, the user wants
  // results. No queued/pending limbo. The swarm system handles routing.
  const execute = true;
  const title = taskTitleFromText(task, args.title);
  const urgency = String(args.urgency || '').toLowerCase() === 'urgent' ? 'urgent' : 'normal';

  const res = await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'create',
      task,
      ...(title ? { title } : {}),
      source: 'web_chat',
      createdBy: 'pearl',
      assignee: 'claude_cli',
      urgency,
      execute,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Failed to dispatch task (${res.status})${detail ? `: ${detail.slice(0, 160)}` : ''}`);
  }

  await res.json().catch(() => null);
  const status = execute ? 'Sent through' : 'Queued';
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('pearl:task-toast', {
      detail: { message: title ? `${status}: ${title}` : `${status}: task queued`, durationMs: 3600 },
    }));
  }
  return execute
    ? "Got it. I sent that through and I am watching it so updates come back here."
    : "Got it. I queued that and I am watching it so updates come back here.";
}

// ─── Registry ────────────────────────────────────────────────────────────────

const TOOL_HANDLERS: Record<string, ChatToolHandler> = {
  bot_web_search: botWebSearch,
  bot_web_fetch: botWebFetch,
  bot_get_public_profile: botGetPublicProfile,
  bot_wonder_canvas_template: botWonderCanvasTemplate,
  bot_wonder_canvas_scene: botWonderCanvasScene,
  bot_wonder_canvas_clear: botWonderCanvasClear,
  pearl_canvas: pearlCanvas,
  bot_get_weather: botGetWeather,
  bot_onboarding_progress: botOnboardingProgress,
  bot_onboarding_complete: botOnboardingComplete,
  bot_create_note: botCreateNote,
  bot_update_note: botUpdateNote,
  bot_open_note: botOpenNote,
  bot_open_notes: botOpenNotesApp,
  bot_open_files: botOpenFiles,
  bot_open_terminal: botOpenTerminal,
  bot_open_news: botOpenNews,
  bot_open_youtube: botOpenYoutube,
  bot_open_creation_engine: botOpenCreationEngine,
  bot_close_terminal: botCloseTerminal,
  bot_close_notes: botCloseNotes,
  bot_close_youtube: botCloseYoutube,
  bot_close_applet_creation_engine: botCloseAppletCreationEngine,
  bot_close_browser_window: botCloseBrowserWindow,
  bot_switch_desktop_mode: botSwitchDesktopMode,
  bot_switch_layout_mode: botSwitchLayoutMode,
  bot_customize_interface: botCustomizeInterface,
  bot_list_tasks: botListTasks,
  bot_openclaw_task: botOpenClawTask,
};

/**
 * Look up a handler by tool name. Returns undefined if the tool is not
 * registered (the caller can silently skip unknown tools).
 */
export function getChatToolHandler(toolName: string): ChatToolHandler | undefined {
  const normalized = TOOL_ALIASES[toolName] || toolName;
  return TOOL_HANDLERS[normalized];
}

/**
 * Execute a tool call by name. Returns a result string on success,
 * or an error message prefixed with "Error:" on failure.
 */
export async function executeChatTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const normalized = TOOL_ALIASES[toolName] || toolName;
  const handler = getChatToolHandler(normalized);
  if (!handler) {
    return `Unknown tool: ${toolName}`;
  }
  try {
    return await handler(args);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[chat-tool-handler] ${toolName} failed:`, err);
    return `Error: ${msg}`;
  }
}
