import { promises as fs } from 'fs';
import path from 'path';
import type { CreationKind } from './build-task-prompt';

interface SeedStudioFallbackArtifactInput {
  creationId: string;
  creationKind: CreationKind;
  outputPath: string;
  title: string;
  userPrompt: string;
}

interface SeedStudioFallbackArtifactResult {
  created: boolean;
  indexPath: string;
  seedPath: string;
}

interface StudioCandidateReview {
  reviewed: boolean;
  restored: boolean;
  reason?: string;
  seedScore?: number;
  candidateScore?: number;
}

export const STUDIO_SEED_DIR = '.pearlos';
export const STUDIO_SEED_INDEX = 'seed-index.html';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function compact(value: string, fallback: string): string {
  const trimmed = String(value || '').replace(/\s+/g, ' ').trim();
  return trimmed || fallback;
}

function studioSeedPath(outputPath: string): string {
  return path.join(outputPath, STUDIO_SEED_DIR, STUDIO_SEED_INDEX);
}

function timestampForFilename(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function qualityScore(html: string): number {
  const text = html.toLowerCase();
  const checks: Array<[RegExp, number]> = [
    [/\b(search|filter)\b/, 5],
    [/\b(table|tbody|list|rows)\b/, 4],
    [/\b(form|input|select|textarea|button)\b/, 4],
    [/\b(dashboard|metric|summary|analytics|pipeline)\b/, 4],
    [/\b(client|customer|lead|contact)\b/, 4],
    [/\b(job|project|work order|service)\b/, 3],
    [/\b(quote|estimate|value|invoice|\$)\b/, 3],
    [/\b(status|scheduled|quoted|ready|progress)\b/, 3],
    [/\b(add|create|new)\b/, 2],
    [/@media|clamp\(|grid-template-columns|responsive/, 2],
    [/<script[\s>]/, 4],
  ];
  let score = Math.min(10, Math.floor(html.length / 1000));
  for (const [pattern, weight] of checks) {
    if (pattern.test(text)) score += weight;
  }
  return score;
}

async function writeSeedSnapshot(outputPath: string, html: string): Promise<string> {
  const seedPath = studioSeedPath(outputPath);
  await fs.mkdir(path.dirname(seedPath), { recursive: true });
  await fs.writeFile(seedPath, html, 'utf-8');
  return seedPath;
}

function appFallbackHtml(title: string, prompt: string, creationId: string): string {
  const titleText = escapeHtml(compact(title, 'Studio App'));
  const promptText = escapeHtml(compact(prompt, titleText));
  const safeCreationId = escapeHtml(creationId);
  const lower = `${title}\n${prompt}`.toLowerCase();
  const clientFocused = /\b(client|customer|lead|job|handyman|crm|tracker|contact)\b/.test(lower);
  const primaryNoun = clientFocused ? 'Client' : 'Item';
  const sampleRows = clientFocused
    ? [
        ['Sarah Miller', 'Kitchen repair', 'Quoted', '$1,250'],
        ['Northside Condo Board', 'Seasonal maintenance', 'Scheduled', '$3,800'],
        ['Derek Lee', 'Bathroom fan install', 'New lead', '$420'],
      ]
    : [
        ['Website refresh', 'Design pass', 'In progress', 'High'],
        ['Vendor review', 'Compare options', 'Queued', 'Medium'],
        ['Launch checklist', 'QA and publish', 'Ready', 'High'],
      ];
  const rowsJson = JSON.stringify(sampleRows);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="pearlos-creation-id" content="${safeCreationId}" />
  <title>${titleText}</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #111417;
      --panel: #1b2025;
      --line: #303942;
      --text: #f5f2eb;
      --muted: #abb5be;
      --accent: #42d392;
      --accent-2: #6ea8fe;
      --warn: #f5c86a;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
    }
    main { max-width: 1120px; margin: 0 auto; padding: 28px; }
    header { display: flex; justify-content: space-between; gap: 18px; align-items: flex-start; margin-bottom: 22px; }
    h1 { margin: 0 0 8px; font-size: clamp(28px, 5vw, 52px); line-height: 1; letter-spacing: 0; }
    p { color: var(--muted); line-height: 1.55; margin: 0; }
    .badge { border: 1px solid var(--line); color: var(--accent); padding: 8px 10px; border-radius: 8px; white-space: nowrap; }
    .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 20px 0; }
    .metric, .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; }
    .metric { padding: 14px; }
    .metric strong { display: block; font-size: 28px; margin-bottom: 4px; }
    .metric span, label { color: var(--muted); font-size: 13px; }
    .layout { display: grid; grid-template-columns: 1.6fr .9fr; gap: 14px; align-items: start; }
    .panel { padding: 16px; }
    .toolbar { display: flex; gap: 10px; margin: 14px 0; flex-wrap: wrap; }
    input, select, textarea, button {
      font: inherit;
      border-radius: 8px;
      border: 1px solid var(--line);
      background: #12171c;
      color: var(--text);
      padding: 10px 11px;
    }
    input, select, textarea { width: 100%; }
    button { cursor: pointer; background: var(--accent); color: #07110c; border-color: transparent; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 11px 8px; border-bottom: 1px solid var(--line); }
    th { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
    tr:hover td { background: rgba(255,255,255,.03); }
    form { display: grid; gap: 10px; }
    .status { color: var(--warn); }
    .note { margin-top: 12px; padding: 10px; border: 1px solid rgba(110,168,254,.35); border-radius: 8px; color: #d9e7ff; background: rgba(110,168,254,.08); }
    @media (max-width: 820px) {
      main { padding: 18px; }
      header, .layout { display: block; }
      .badge { display: inline-block; margin-top: 14px; }
      .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .panel { margin-top: 14px; overflow-x: auto; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>${titleText}</h1>
        <p>${promptText}</p>
      </div>
      <div class="badge">Runnable first pass</div>
    </header>

    <section class="grid" aria-label="Summary">
      <div class="metric"><strong id="count">0</strong><span>${primaryNoun}s</span></div>
      <div class="metric"><strong id="active">0</strong><span>Active work</span></div>
      <div class="metric"><strong id="value">$0</strong><span>Pipeline value</span></div>
      <div class="metric"><strong id="updated">Now</strong><span>Last update</span></div>
    </section>

    <section class="layout">
      <div class="panel">
        <div class="toolbar">
          <input id="search" placeholder="Search ${primaryNoun.toLowerCase()}s" />
          <select id="statusFilter">
            <option value="">All statuses</option>
            <option>New lead</option>
            <option>Quoted</option>
            <option>Scheduled</option>
            <option>In progress</option>
            <option>Ready</option>
          </select>
        </div>
        <table>
          <thead>
            <tr><th>${primaryNoun}</th><th>Need</th><th>Status</th><th>Value</th></tr>
          </thead>
          <tbody id="rows"></tbody>
        </table>
      </div>

      <aside class="panel">
        <h2 style="margin:0 0 12px;font-size:18px;">Add ${primaryNoun.toLowerCase()}</h2>
        <form id="entryForm">
          <input id="name" placeholder="${primaryNoun} name" required />
          <input id="need" placeholder="Need or project" required />
          <select id="newStatus">
            <option>New lead</option>
            <option>Quoted</option>
            <option>Scheduled</option>
            <option>In progress</option>
            <option>Ready</option>
          </select>
          <input id="newValue" placeholder="Value or priority" required />
          <button type="submit">Add ${primaryNoun.toLowerCase()}</button>
        </form>
        <div class="note">PearlOS seeded this runnable first pass before the builder started. Later builds should improve this baseline, not remove the tracker, search, metrics, or add form.</div>
      </aside>
    </section>
  </main>
  <script>
    const rows = ${rowsJson}.map(([name, need, status, value]) => ({ name, need, status, value }));
    const tbody = document.getElementById('rows');
    const search = document.getElementById('search');
    const statusFilter = document.getElementById('statusFilter');
    const money = (value) => {
      const parsed = Number(String(value).replace(/[^0-9.-]/g, ''));
      return Number.isFinite(parsed) ? parsed : 0;
    };
    function render() {
      const q = search.value.trim().toLowerCase();
      const status = statusFilter.value;
      const visible = rows.filter((row) => {
        const matchesText = !q || [row.name, row.need, row.status, row.value].join(' ').toLowerCase().includes(q);
        const matchesStatus = !status || row.status === status;
        return matchesText && matchesStatus;
      });
      tbody.innerHTML = visible.map((row) => '<tr><td>' + row.name + '</td><td>' + row.need + '</td><td class="status">' + row.status + '</td><td>' + row.value + '</td></tr>').join('');
      document.getElementById('count').textContent = String(rows.length);
      document.getElementById('active').textContent = String(rows.filter((row) => !/ready|done|closed/i.test(row.status)).length);
      const total = rows.reduce((sum, row) => sum + money(row.value), 0);
      document.getElementById('value').textContent = total ? '$' + total.toLocaleString() : String(rows.length);
      document.getElementById('updated').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    document.getElementById('entryForm').addEventListener('submit', (event) => {
      event.preventDefault();
      rows.unshift({
        name: document.getElementById('name').value,
        need: document.getElementById('need').value,
        status: document.getElementById('newStatus').value,
        value: document.getElementById('newValue').value
      });
      event.currentTarget.reset();
      render();
    });
    search.addEventListener('input', render);
    statusFilter.addEventListener('change', render);
    render();
  </script>
</body>
</html>`;
}

function gameFallbackHtml(title: string, prompt: string, creationId: string): string {
  const titleText = escapeHtml(compact(title, 'Studio Game'));
  const promptText = escapeHtml(compact(prompt, titleText));
  const safeCreationId = escapeHtml(creationId);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="pearlos-creation-id" content="${safeCreationId}" />
  <title>${titleText}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: #101418; color: #f5f2eb; font-family: Inter, ui-sans-serif, system-ui, sans-serif; display: grid; place-items: center; }
    main { width: min(960px, 100vw); padding: 18px; }
    h1 { margin: 0 0 6px; font-size: clamp(28px, 5vw, 48px); letter-spacing: 0; }
    p { margin: 0 0 14px; color: #aeb8c2; }
    canvas { display: block; width: 100%; aspect-ratio: 16 / 9; border: 1px solid #31404d; border-radius: 8px; background: #17202a; }
    .bar { display: flex; justify-content: space-between; gap: 12px; margin: 10px 0; color: #aeb8c2; }
    button { border: 0; border-radius: 8px; padding: 10px 12px; background: #42d392; color: #07110c; font-weight: 800; cursor: pointer; }
  </style>
</head>
<body>
  <main>
    <h1>${titleText}</h1>
    <p>${promptText}</p>
    <div class="bar"><span>Space/click to jump</span><strong id="score">0</strong></div>
    <canvas id="game" width="960" height="540"></canvas>
    <div class="bar"><span>Runnable first pass seeded by PearlOS.</span><button id="restart">Restart</button></div>
  </main>
  <script>
    const canvas = document.getElementById('game');
    const ctx = canvas.getContext('2d');
    const scoreEl = document.getElementById('score');
    let player, obstacles, score, running;
    function reset() {
      player = { x: 90, y: 360, vy: 0, size: 34, grounded: false };
      obstacles = [{ x: 760, w: 38, h: 70 }, { x: 1120, w: 50, h: 110 }];
      score = 0;
      running = true;
    }
    function jump() {
      if (player.grounded) {
        player.vy = -15;
        player.grounded = false;
      }
    }
    function frame() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const ground = 430;
      ctx.fillStyle = '#1f7a5a';
      ctx.fillRect(0, ground, canvas.width, 6);
      if (running) {
        player.vy += 0.7;
        player.y += player.vy;
        if (player.y + player.size > ground) {
          player.y = ground - player.size;
          player.vy = 0;
          player.grounded = true;
        }
        obstacles.forEach((ob) => {
          ob.x -= 6;
          if (ob.x + ob.w < 0) {
            ob.x = 980 + Math.random() * 380;
            ob.h = 55 + Math.random() * 110;
            score += 1;
          }
          const hit = player.x < ob.x + ob.w && player.x + player.size > ob.x && player.y + player.size > ground - ob.h;
          if (hit) running = false;
        });
      }
      ctx.fillStyle = '#6ea8fe';
      ctx.fillRect(player.x, player.y, player.size, player.size);
      ctx.fillStyle = '#f5c86a';
      obstacles.forEach((ob) => ctx.fillRect(ob.x, ground - ob.h, ob.w, ob.h));
      ctx.fillStyle = '#f5f2eb';
      ctx.font = '20px system-ui';
      if (!running) ctx.fillText('Game over - press Restart', 360, 250);
      scoreEl.textContent = String(score);
      requestAnimationFrame(frame);
    }
    addEventListener('keydown', (event) => { if (event.code === 'Space') jump(); });
    canvas.addEventListener('pointerdown', jump);
    document.getElementById('restart').addEventListener('click', reset);
    reset();
    frame();
  </script>
</body>
</html>`;
}

export async function seedStudioFallbackArtifact({
  creationId,
  creationKind,
  outputPath,
  title,
  userPrompt,
}: SeedStudioFallbackArtifactInput): Promise<SeedStudioFallbackArtifactResult> {
  const indexPath = path.join(outputPath, 'index.html');
  await fs.mkdir(outputPath, { recursive: true });
  const html = creationKind === 'GAME'
    ? gameFallbackHtml(title, userPrompt, creationId)
    : appFallbackHtml(title, userPrompt, creationId);
  const seedPath = await writeSeedSnapshot(outputPath, html);

  try {
    await fs.writeFile(indexPath, html, { encoding: 'utf-8', flag: 'wx' });
    return { created: true, indexPath, seedPath };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return { created: false, indexPath, seedPath };
    }
    throw error;
  }
}

export async function restoreSeedIfCandidateRegressed(
  outputPath: string | undefined,
): Promise<StudioCandidateReview> {
  if (!outputPath) return { reviewed: false, restored: false, reason: 'missing_output_path' };
  const indexPath = path.join(outputPath, 'index.html');
  const seedPath = studioSeedPath(outputPath);
  let seedHtml = '';
  let candidateHtml = '';
  try {
    [seedHtml, candidateHtml] = await Promise.all([
      fs.readFile(seedPath, 'utf-8'),
      fs.readFile(indexPath, 'utf-8'),
    ]);
  } catch {
    return { reviewed: false, restored: false, reason: 'seed_or_candidate_missing' };
  }

  const seedScore = qualityScore(seedHtml);
  const candidateScore = qualityScore(candidateHtml);
  const candidateMuchSmaller = candidateHtml.length < seedHtml.length * 0.6;
  const candidateRegressed = candidateScore + 3 < seedScore || candidateMuchSmaller;
  if (!candidateRegressed) {
    return { reviewed: true, restored: false, seedScore, candidateScore };
  }

  const rejectedPath = path.join(
    outputPath,
    STUDIO_SEED_DIR,
    `rejected-index-${timestampForFilename()}.html`,
  );
  await fs.mkdir(path.dirname(rejectedPath), { recursive: true });
  await fs.writeFile(rejectedPath, candidateHtml, 'utf-8');
  await fs.writeFile(indexPath, seedHtml, 'utf-8');
  return {
    reviewed: true,
    restored: true,
    reason: candidateMuchSmaller ? 'candidate_much_smaller' : 'candidate_lower_quality_score',
    seedScore,
    candidateScore,
  };
}
