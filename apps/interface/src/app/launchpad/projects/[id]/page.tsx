import Link from 'next/link';
import { notFound } from 'next/navigation';

import { TopBarTitle } from '@interface/components/TopBarTitle';
import { readProjects } from '../../../api/launchpad/lib/store';
import {
  planAgencyTasks,
  type AgencyProjectType,
} from '@interface/features/CreationLaunchpad/lib/agency-coordinator';

const typeIcon: Record<AgencyProjectType, string> = {
  game: '🎮',
  app: '🌐',
  feature: '⚙️',
  pearlos: '🪩',
};

const statusStyles: Record<string, string> = {
  queued: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  building: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  complete: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  error: 'bg-red-500/15 text-red-300 border-red-500/30',
};

function formatTime(minutes: number | undefined): string {
  if (!minutes) return '—';
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export default async function ProjectLaunchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const projects = await readProjects();
  const project = projects.find((p) => p.id === id);
  if (!project) notFound();

  const tasks = ['game', 'app', 'feature', 'pearlos'].includes(project.type)
    ? planAgencyTasks(
        project.id,
        project.title,
        project.type as AgencyProjectType,
        project.swarmDurationMinutes
      )
    : [];

  return (
    <div className="h-svh w-screen overflow-hidden bg-[#0a0614] pt-16">
      <TopBarTitle />
      <div
        className="h-full overflow-y-auto pt-24 pb-16 px-6 max-w-4xl mx-auto"
        style={{ color: '#faf8f5', fontFamily: 'Gohufont, monospace' }}
      >
        <Link
          href="/launchpad"
          className="text-xs text-[#d4c0e8]/60 hover:text-[#faf8f5] transition-colors"
        >
          ← Back to Studio
        </Link>

        <div className="mt-4 flex items-start gap-4">
          <span className="text-5xl">{typeIcon[project.type as AgencyProjectType]}</span>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-semibold text-[#faf8f5]">{project.title}</h1>
            <div className="flex items-center gap-3 mt-2 text-xs text-[#d4c0e8]/60">
              <span className="capitalize">{project.type}</span>
              <span>·</span>
              <span>Created {new Date(project.createdAt).toLocaleString()}</span>
              <span>·</span>
              <span>Swarm {formatTime(project.swarmDurationMinutes ?? project.estimatedMinutes)}</span>
            </div>
          </div>
          <span
            className={`px-3 py-1 rounded-full text-xs font-medium border uppercase tracking-wider ${
              statusStyles[project.status] ?? 'bg-white/5 text-white/60 border-white/10'
            }`}
          >
            {project.status}
          </span>
        </div>

        <section className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <h2 className="text-sm font-semibold tracking-wide text-[#faf8f5] mb-3">Brief</h2>
          <pre className="whitespace-pre-wrap text-sm text-[#d4c0e8]/80 font-[Gohufont,monospace]">
            {project.content || 'No description provided.'}
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

        {project.status !== 'complete' && (
          <div className="mt-6 text-xs text-[#d4c0e8]/50 italic">
            Build status is <strong>{project.status}</strong>. The runnable artifact will be
            wired in here once the agency pipeline produces real output.
          </div>
        )}
      </div>
    </div>
  );
}
