"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";

import {
  planAgencyTasks,
  type AgencyProjectType,
} from "../lib/agency-coordinator";
import {
  buildCoolThingsPreviewHtml,
  escapeHtml,
} from "../lib/cool-things-preview";

// ── App-preview HTML generator ─────────────────────────────────────────
// The launched window used to render only project metadata (Brief +
// Agency Plan), which read as a "gray screen" because nothing actually
// looked like a launched app. This builds a self-contained interactive
// preview from project.title + project.content + project.type so LAUNCH
// genuinely shows something app-shaped. The preview lives in an iframe
// (srcDoc) so its CSS / JS cannot leak into the host page.
//
// Each project type gets a distinct shell:
//   - app      → web-app shell (sidebar nav + main canvas with content)
//   - game     → game canvas with start screen
//   - pearlos  → PearlOS-style module dashboard
//   - feature  → feature-card single-page view
function buildAppPreviewHtml(project: {
  title: string;
  content?: string;
  type: ProjectType;
}): string {
  const brief = `${project.title} ${project.content || ""}`.toLowerCase();
  if (brief.includes("flippable") && brief.includes("card") && brief.includes("cool")) {
    return buildCoolThingsPreviewHtml(project);
  }

  const title = escapeHtml(project.title);
  const body = escapeHtml(project.content || "").replace(/\n/g, "<br/>");
  const type = project.type;
  const accent =
    type === "game" ? "#ff6b9d"
    : type === "pearlos" ? "#7DC3FF"
    : type === "feature" ? "#9F7AEA"
    : "#67E8F9"; // app

  // Type-specific main canvas.
  let canvas = "";
  if (type === "game") {
    canvas = `
      <div class="game-canvas">
        <div class="game-title">${title}</div>
        <div class="game-tagline">${body}</div>
        <button class="game-start" onclick="this.textContent='Loading…';this.disabled=true;">▶ Start</button>
      </div>`;
  } else if (type === "pearlos") {
    canvas = `
      <div class="pearlos-grid">
        <div class="tile"><div class="tile-icon">📊</div><div>Insights</div></div>
        <div class="tile"><div class="tile-icon">🛠</div><div>Controls</div></div>
        <div class="tile"><div class="tile-icon">🔮</div><div>${title}</div></div>
        <div class="tile"><div class="tile-icon">📡</div><div>Stream</div></div>
      </div>
      <p class="brief">${body}</p>`;
  } else if (type === "feature") {
    canvas = `
      <article class="feature">
        <h2>${title}</h2>
        <p>${body}</p>
        <button class="feature-cta">Open ${title}</button>
      </article>`;
  } else {
    // app
    canvas = `
      <div class="app-canvas">
        <h2>${title}</h2>
        <p class="app-body">${body}</p>
        <div class="app-controls">
          <button>Action</button>
          <button>Settings</button>
        </div>
      </div>`;
  }

  return `<!doctype html><html><head><meta charset="utf-8"/>
<style>
  *,*::before,*::after{box-sizing:border-box}
  html,body{margin:0;padding:0;height:100%;background:#0a0614;color:#faf8f5;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
  body{display:flex;flex-direction:column}
  header.shell{display:flex;align-items:center;gap:10px;padding:10px 16px;background:linear-gradient(90deg,${accent}22, transparent);border-bottom:1px solid #ffffff14}
  .dot{width:10px;height:10px;border-radius:50%;background:${accent};box-shadow:0 0 12px ${accent}}
  .shell-title{font-weight:600;letter-spacing:.04em}
  .shell-tabs{margin-left:auto;display:flex;gap:8px;font-size:12px;color:#ffffffaa}
  .shell-tabs span{padding:4px 10px;border-radius:999px;border:1px solid #ffffff22}
  main.shell-main{flex:1;display:flex;min-height:0}
  nav.shell-nav{width:160px;padding:14px 10px;border-right:1px solid #ffffff14;display:flex;flex-direction:column;gap:6px;font-size:13px;color:#ffffffcc}
  nav.shell-nav .navitem{padding:8px 10px;border-radius:8px}
  nav.shell-nav .navitem.active{background:${accent}33;color:#fff}
  section.shell-canvas{flex:1;padding:24px;overflow:auto}
  .app-canvas h2{margin:0 0 12px;font-size:22px}
  .app-body{color:#ffffffcc;line-height:1.55}
  .app-controls{margin-top:18px;display:flex;gap:10px}
  .app-controls button,.feature-cta,.game-start{
    background:${accent};color:#0a0614;border:none;border-radius:10px;
    padding:8px 14px;font-weight:600;cursor:pointer
  }
  .game-canvas{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;text-align:center;gap:14px}
  .game-title{font-size:36px;font-weight:700;letter-spacing:.06em;color:${accent};text-shadow:0 0 18px ${accent}55}
  .game-tagline{max-width:520px;color:#ffffffaa}
  .pearlos-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;max-width:520px}
  .tile{background:#ffffff08;border:1px solid #ffffff14;border-radius:12px;padding:18px;display:flex;flex-direction:column;gap:8px;align-items:flex-start}
  .tile-icon{font-size:24px}
  .brief{margin-top:18px;color:#ffffffaa;line-height:1.55;max-width:520px}
  .feature{max-width:560px}
  .feature h2{margin-top:0}
  footer.shell-status{padding:6px 14px;font-size:11px;color:#ffffff66;border-top:1px solid #ffffff14;display:flex;gap:10px}
</style></head><body>
<header class="shell">
  <span class="dot"></span>
  <span class="shell-title">${title}</span>
  <span class="shell-tabs"><span>Live</span><span>v0.1</span></span>
</header>
<main class="shell-main">
  <nav class="shell-nav">
    <div class="navitem active">Home</div>
    <div class="navitem">${type === "game" ? "Levels" : type === "pearlos" ? "Modules" : "Library"}</div>
    <div class="navitem">${type === "game" ? "Scoreboard" : "Settings"}</div>
    <div class="navitem">About</div>
  </nav>
  <section class="shell-canvas">${canvas}</section>
</main>
<footer class="shell-status">
  <span>● connected</span>
  <span>swarm: idle</span>
  <span style="margin-left:auto">${type}</span>
</footer>
</body></html>`;
}

type ProjectStatus = "queued" | "building" | "complete" | "error";
type ProjectType = "game" | "app" | "feature" | "pearlos";

interface ProjectSprite {
  id: string;
  name: string;
  imageUrl?: string;
}

interface LaunchpadProject {
  id: string;
  title: string;
  content?: string;
  type: ProjectType;
  status: ProjectStatus;
  estimatedMinutes?: number;
  swarmDurationMinutes?: number;
  sprites?: ProjectSprite[];
  createdAt: string;
  updatedAt?: string;
  buildPassCompletedAt?: string;
}

const typeIcon: Record<AgencyProjectType, string> = {
  game: "🎮",
  app: "🌐",
  feature: "⚙️",
  pearlos: "🪩",
};

const statusStyles: Record<string, string> = {
  queued: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  building: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  complete: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  error: "bg-red-500/15 text-red-300 border-red-500/30",
};

function formatTime(minutes: number | undefined): string {
  if (!minutes) return "—";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

interface Props {
  projectId: string;
  // Bumped by the launcher each time the project is re-opened so this
  // view refetches the latest content. Without it, the dedup logic in
  // browser-window keeps the existing component instance and the user
  // sees stale data after an edit pass. (Blair, 2026-05-01.)
  version?: number;
}

const LaunchpadProjectView: React.FC<Props> = ({ projectId, version }) => {
  const [project, setProject] = useState<LaunchpadProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Trace the load on the browser console at every hop. Three prior
    // "fixes" shipped without a way to see where the chain actually
    // broke; the gray-screen symptom looked the same whether the click
    // didn't fire, the projectId was undefined, the fetch failed, or the
    // render bailed silently. These logs let the next debugger pinpoint
    // the breakpoint without rebuilding. See SPECTRUM bug #5.
    // eslint-disable-next-line no-console
    console.log('[LaunchpadProjectView] load start', { projectId, version });
    try {
      if (!projectId) {
        // Defensive: a falsy projectId here would silently fetch
        // /api/launchpad/projects/undefined. Surface it as an explicit
        // error instead of letting the API 404 bubble up unlabeled.
        throw new Error('projectId is missing');
      }
      // Cache-bust the URL so a stale Next.js cache layer can't serve
      // an old project payload after an edit. The version param is
      // ignored by the API but bypasses any HTTP cache keyed on URL.
      const cacheBust = version ? `?v=${version}` : '';
      const res = await fetch(`/api/launchpad/projects/${projectId}${cacheBust}`, {
        cache: 'no-store',
      });
      // eslint-disable-next-line no-console
      console.log('[LaunchpadProjectView] fetch status', { projectId, status: res.status });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // eslint-disable-next-line no-console
      console.log('[LaunchpadProjectView] project loaded', {
        projectId,
        hasProject: Boolean(data?.project),
        title: data?.project?.title,
      });
      setProject(data.project ?? null);
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load project';
      // eslint-disable-next-line no-console
      console.error('[LaunchpadProjectView] load failed', { projectId, error: msg });
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [projectId, version]);

  useEffect(() => {
    load();
  }, [load]);

  // ── Hooks must be called before any conditional return. The previous
  // version ran `useMemo(previewHtml)` *after* the loading / error early
  // returns. On the first render `loading=true` returned early and the
  // memo never ran; on the second render `loading=false` reached the
  // memo, changing the hook count and tripping React error #310 ("rendered
  // more hooks than during the previous render"). The error boundary then
  // swallowed the entire view, which is what produced the persistent
  // "gray screen" bug. See SPECTRUM bug #5.
  const previewHtml = useMemo(
    () =>
      project
        ? buildAppPreviewHtml({
            title: project.title,
            content: project.content,
            type: project.type,
          })
        : "",
    [project?.id, project?.title, project?.content, project?.type],
  );

  if (loading) {
    return (
      <div
        className="h-full flex flex-col items-center justify-center gap-3"
        style={{ backgroundColor: "#0a0614", color: "#faf8f5", fontFamily: "Gohufont, monospace" }}
      >
        <div className="h-8 w-8 rounded-full border-2 border-[#D94F8E]/30 border-t-[#D94F8E] animate-spin" />
        <div className="text-xs text-[#d4c0e8]/70">Loading project…</div>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div
        className="h-full flex flex-col items-center justify-center gap-3"
        style={{ backgroundColor: "#0a0614", color: "#faf8f5", fontFamily: "Gohufont, monospace" }}
      >
        <div className="text-xs text-red-400/80">{error ?? "Project not found"}</div>
        <button
          onClick={() => {
            setLoading(true);
            load();
          }}
          className="text-[11px] text-[#D94F8E]/70 hover:text-[#D94F8E] transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  const planType: AgencyProjectType | null =
    project.type === "game" || project.type === "app" || project.type === "feature" || project.type === "pearlos"
      ? project.type
      : null;
  const tasks = planType
    ? planAgencyTasks(
        project.id,
        project.title,
        planType,
        project.swarmDurationMinutes
      )
    : [];

  const isLaunched = project.status === "complete";

  return (
    <div
      className="h-full overflow-y-auto px-6 py-6"
      style={{ backgroundColor: "#0a0614", color: "#faf8f5", fontFamily: "Gohufont, monospace" }}
    >
      <div className="max-w-3xl mx-auto">
        <div className="flex items-start gap-4">
          <span className="text-5xl">{planType ? typeIcon[planType] : "📦"}</span>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-semibold text-[#faf8f5]">{project.title}</h1>
            <div className="flex items-center gap-3 mt-2 text-xs text-[#d4c0e8]/60">
              <span className="capitalize">{project.type}</span>
              <span>·</span>
              <span>Created {new Date(project.createdAt).toLocaleString()}</span>
              <span>·</span>
              <span>
                Swarm {formatTime(project.swarmDurationMinutes ?? project.estimatedMinutes)}
              </span>
            </div>
          </div>
          <span
            className={`px-3 py-1 rounded-full text-xs font-medium border uppercase tracking-wider ${
              statusStyles[project.status] ?? "bg-white/5 text-white/60 border-white/10"
            }`}
          >
            {project.status}
          </span>
        </div>

        {/* The iframe preview was previously gated on `isLaunched`
            (status === "complete"), which is why LAUNCH felt like a gray
            screen: queued/building projects rendered nothing app-shaped.
            We now render the preview immediately and overlay a "Building…"
            scrim until the build pass finishes, so users always see
            something app-shaped on click. See SPECTRUM bug #5. */}
        <section
          className="mt-8 rounded-2xl border border-white/10 overflow-hidden relative"
          style={{ backgroundColor: "#0a0614" }}
        >
          <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 text-[11px] uppercase tracking-wider text-[#d4c0e8]/60">
            <span>App Preview</span>
            <span className={isLaunched ? "text-[#67E8F9]/80" : "text-amber-300/80"}>
              {isLaunched ? "● live" : "● building"}
            </span>
          </div>
          <iframe
            title={`${project.title} preview`}
            srcDoc={previewHtml}
            sandbox="allow-scripts"
            style={{
              width: "100%",
              height: 420,
              border: "none",
              display: "block",
              backgroundColor: "#0a0614",
            }}
          />
          {!isLaunched && (
            <div
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none"
              style={{ backgroundColor: "rgba(10, 6, 20, 0.55)", backdropFilter: "blur(2px)" }}
            >
              <div className="h-8 w-8 rounded-full border-2 border-amber-300/30 border-t-amber-300 animate-spin" />
              <div className="text-[11px] uppercase tracking-wider text-amber-300/80">
                Building preview… ({project.status})
              </div>
            </div>
          )}
        </section>

        <section className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <h2 className="text-sm font-semibold tracking-wide text-[#faf8f5] mb-3">Brief</h2>
          <pre className="whitespace-pre-wrap text-sm text-[#d4c0e8]/80 font-[Gohufont,monospace]">
            {project.content || "No description provided."}
          </pre>
        </section>

        {project.sprites && project.sprites.length > 0 && (
          <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <h2 className="text-sm font-semibold tracking-wide text-[#faf8f5] mb-3">Sprites</h2>
            <div className="flex flex-wrap gap-2">
              {project.sprites.map((sprite) => (
                <div
                  key={sprite.id}
                  className="flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1"
                >
                  {sprite.imageUrl && (
                    <img src={sprite.imageUrl} alt="" className="w-5 h-5 rounded-full object-cover" />
                  )}
                  <span className="text-xs text-cyan-300/80">{sprite.name}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {tasks.length > 0 && (
          <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <h2 className="text-sm font-semibold tracking-wide text-[#faf8f5] mb-3">
              Agency Plan
            </h2>
            <ul className="space-y-3">
              {tasks.map((t) => (
                <li
                  key={t.taskId}
                  className="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-[#faf8f5]">{t.title}</div>
                    <div className="text-[10px] text-[#d4c0e8]/50 tabular-nums">
                      {formatTime(t.estimatedMinutes)} · {t.agentName}
                    </div>
                  </div>
                  <div className="mt-1 text-xs text-[#d4c0e8]/60">{t.description}</div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {project.status !== "complete" && (
          <div className="mt-6 text-xs text-[#d4c0e8]/50 italic">
            Build status is <strong>{project.status}</strong>. The runnable artifact will be
            wired in here once the agency pipeline produces real output.
          </div>
        )}
      </div>
    </div>
  );
};

export default LaunchpadProjectView;
