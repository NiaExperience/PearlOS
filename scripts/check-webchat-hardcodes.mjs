#!/usr/bin/env node
/**
 * Fails if production webchat/runtime code contains known prompt-specific
 * canned answer paths. Generic renderers and tests may contain fixtures; this
 * guard targets runtime shortcuts that speak for Pearl before the model/tool
 * path has a chance to run.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.env.PEARLOS_REPO_ROOT || process.cwd());
const TARGETS = [
  'apps/interface/src/features/ChatMode/lib/chat-tool-handlers.ts',
  'apps/interface/src/features/ChatMode/hooks/useChatSession.ts',
  'apps/interface/src/app/api/chat/news-intelligence/route.ts',
  'apps/pipecat-daily-bot/bot/pearl/bot_tools.py',
  'apps/pipecat-daily-bot/bot/bot_gateway.py',
  'apps/pipecat-daily-bot/bot/filters/narration_filter.py',
  'apps/pipecat-daily-bot/bot/processors/tool_narration.py',
  'apps/pipecat-daily-bot/bot/processors/non_blocking_router.py',
  'apps/pipecat-daily-bot/bot/tools/task_feedback_tools.py',
  'openclaw-runtime-patches/telegram-preallowlist-loader.mjs',
  'scripts/pearl-agent-runtime.mjs',
  'scripts/seed-all-functional-prompts.ts',
];

const FORBIDDEN = [
  {
    name: 'local multimedia prompt bypass',
    pattern: /\bhandleLocalMultimediaPrompt\b/,
  },
  {
    name: 'local timeline registry',
    pattern: /\bLOCAL_TIMELINE_SPECS\b|\bfindLocalTimelineSpec\b|\blocalTimelineHtml\b|\blocalTimelineReply\b/,
  },
  {
    name: 'all-time games canned infographic',
    pattern: /\bpopularGamesInfographicHtml\b|best-selling-games-infographic|Best-Selling Games Ever/,
  },
  {
    name: 'mass extinction canned timeline',
    pattern: /mass-extinction-timeline|Mass Extinction Timeline|End-Permian|End-Cretaceous/,
  },
  {
    name: 'Persian/Iranian canned timeline',
    pattern: /persian-iranian-history-timeline|Persian and Iranian History Timeline|Achaemenid Empire|Islamic Republic/,
  },
  {
    name: 'console wars canned timeline',
    pattern: /console-wars-timeline|Console Wars Timeline|Sega Genesis vs Super Nintendo|Switch 2/,
  },
  {
    name: 'legacy streaming canned answer',
    pattern: /\bstreamingInfographicHtml\b|Streaming Is Not One Throne|streaming-dominance/,
  },
  {
    name: 'legacy scary movie canned answer',
    pattern: /\bhorrorMovieHtml\b|Scariest Pick: Hereditary|scariest-movie/,
  },
  {
    name: 'legacy sprite canned answer',
    pattern: /\bspriteHtml\b|Sprite Draft|sprite-regression|Moonlit Silver Fox Mage/,
  },
  {
    name: 'legacy oil report canned note',
    pattern: /\boilReportContent\b|Iran Conflict Impact on Oil Prices|Strait of Hormuz transit risk/,
  },
  {
    name: 'legacy jewelry site canned reply',
    pattern: /host the first version from your PearlOS user folder|website\.\*jewelry|create a website\.\*jewelry/,
  },
  {
    name: 'topic-specific Apple fallback brief',
    pattern: /\bappleFallbackBrief\b|Apple is trying to focus developers and customers|Apple is setting the table for WWDC/,
  },
  {
    name: 'raw search-result digest voice',
    pattern: /The clearest signal came from|sources sampled/i,
  },
  {
    name: 'mechanical task acknowledgement',
    pattern: /I[’']ve got it|specific result here|making you chase it|next update here should be|bring the result back here|come back with a (?:specific|better) (?:result|answer)|come back with a better answer/i,
  },
  {
    name: 'generic process narration',
    pattern: /\b(?:Let me just|Let me check|Let me grab|Let me see|On it\.|Just a sec\.|Looking into that\.)\b/i,
  },
];

const failures = [];

for (const rel of TARGETS) {
  const filePath = path.join(ROOT, rel);
  if (!fs.existsSync(filePath)) continue;
  const text = fs.readFileSync(filePath, 'utf8');
  let searchable = text;
  if (rel === 'scripts/pearl-agent-runtime.mjs') {
    searchable = searchable.replace(/const GENERIC_ACKNOWLEDGEMENT_PATTERNS = \[[\s\S]*?\];/, '');
  }
  if (rel === 'openclaw-runtime-patches/telegram-preallowlist-loader.mjs') {
    searchable = searchable.replace(/const PEARLOS_EMPTY_PREFACE_RE = .*?;\n/, '');
  }
  for (const rule of FORBIDDEN) {
    const match = searchable.match(rule.pattern);
    if (!match) continue;
    const before = text.slice(0, match.index ?? 0);
    const line = before.split(/\r?\n/).length;
    failures.push(`${rel}:${line} ${rule.name}`);
  }
}

if (failures.length) {
  console.error('check-webchat-hardcodes: forbidden canned webchat/canvas content found:');
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

console.log('check-webchat-hardcodes: passed');
