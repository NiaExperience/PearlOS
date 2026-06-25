'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';

import { openStudioCreation } from '../lib/play-creation';

// ─── Types ─────────────────────────────────────────────────────────
type ProjectStatus = 'queued' | 'building' | 'complete' | 'error';
type ProjectType = 'game' | 'app' | 'feature' | 'pearlos';
type SortBy = 'newest' | 'oldest' | 'name';
type FilterBy = 'all' | ProjectType;

interface ProjectSprite {
  id: string;
  name: string;
  imageUrl: string;
}

interface LaunchpadProject {
  id: string;
  title: string;
  content?: string;
  type: ProjectType;
  status: ProjectStatus;
  estimatedMinutes?: number;
  sprites?: ProjectSprite[];
  createdAt: string;
  thumbnail?: string;
  buildPassCompletedAt?: string;
  playUrl?: string;
}

// ─── Helpers ───────────────────────────────────────────────────────
const typeIcon: Record<ProjectType, string> = {
  game: '🎮',
  app: '🌐',
  feature: '⚙️',
  pearlos: '🪩',
};

const statusColors: Record<ProjectStatus, string> = {
  queued: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  building: 'bg-sky-500/20 text-sky-400 border-sky-500/30',
  complete: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  error: 'bg-red-500/20 text-red-400 border-red-500/30',
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ─── Component ─────────────────────────────────────────────────────
export function ProjectGallery() {
  const [projects, setProjects] = useState<LaunchpadProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterBy>('all');
  const [sortBy, setSortBy] = useState<SortBy>('newest');
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/launchpad/projects');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setProjects(Array.isArray(data.projects) ? data.projects : []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProjects();

    const refresh = () => loadProjects();
    window.addEventListener('nia.project.created', refresh);
    window.addEventListener('nia.launchpad.project.created', refresh);
    window.addEventListener('nia.pipeline.status', refresh);
    return () => {
      window.removeEventListener('nia.project.created', refresh);
      window.removeEventListener('nia.launchpad.project.created', refresh);
      window.removeEventListener('nia.pipeline.status', refresh);
    };
  }, [loadProjects]);

  const filteredProjects = useMemo(() => {
    let result = projects;
    
    if (filter !== 'all') {
      result = result.filter(p => p.type === filter);
    }
    
    if (search.trim()) {
      const query = search.toLowerCase();
      result = result.filter(p => p.title.toLowerCase().includes(query));
    }
    
    result = [...result].sort((a, b) => {
      switch (sortBy) {
        case 'newest': return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case 'oldest': return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case 'name': return a.title.localeCompare(b.title);
        default: return 0;
      }
    });
    
    return result;
  }, [projects, filter, sortBy, search]);

  const handleLaunch = (project: LaunchpadProject) => {
    openStudioCreation(project, 'launchpad:project-gallery-play');
  };

  const handleEdit = (project: LaunchpadProject) => {
    setEditingId(project.id);
    setEditTitle(project.title);
    setEditContent(project.content ?? '');
    setEditError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditError(null);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const title = editTitle.trim();
    if (!title) {
      setEditError('Title is required');
      return;
    }
    setSavingEdit(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/launchpad/projects/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content: editContent }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.project) {
        setProjects((prev) => prev.map((p) => (p.id === data.project.id ? { ...p, ...data.project } : p)));
      }
      setEditingId(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async (project: LaunchpadProject) => {
    if (typeof window !== 'undefined' && !window.confirm(`Delete "${project.title}"?`)) return;
    try {
      const res = await fetch(`/api/launchpad/projects/${project.id}`, { method: 'DELETE' });
      if (res.ok) {
        setProjects((prev) => prev.filter((p) => p.id !== project.id));
      }
    } catch {
      // swallow — user will see the project stick around and can retry
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-16 space-y-3">
        <p className="text-sm text-red-400/80">{error}</p>
        <button
          onClick={() => { setLoading(true); loadProjects(); }}
          className="text-xs text-purple-300/80 hover:text-purple-200 underline"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex gap-2">
          {(['all', 'app', 'game', 'pearlos', 'feature'] as FilterBy[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full text-sm transition-all ${
                filter === f
                  ? 'bg-purple-500/30 text-purple-200 border border-purple-500/50'
                  : 'bg-white/5 text-white/60 hover:bg-white/10 border border-transparent'
              }`}
            >
              {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1) + 's'}
            </button>
          ))}
        </div>
        
        <div className="flex gap-3 items-center">
          <input
            type="text"
            placeholder="Search projects..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/90 placeholder:text-white/40 text-sm focus:outline-none focus:border-purple-500/50"
          />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/90 text-sm focus:outline-none focus:border-purple-500/50"
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="name">Name</option>
          </select>
        </div>
      </div>

      {/* Grid */}
      {filteredProjects.length === 0 ? (
        <div className="text-center py-16 text-white/40">
          <p>No projects found</p>
          <p className="text-sm mt-1">Create your first project from Notes</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredProjects.map((project) => (
            <div
              key={project.id}
              className="group relative bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl overflow-hidden hover:border-purple-500/30 hover:bg-white/[0.07] transition-all duration-200"
            >
              {/* Thumbnail */}
              <div className="aspect-video bg-gradient-to-br from-purple-900/30 to-indigo-900/30 flex items-center justify-center text-4xl">
                {typeIcon[project.type]}
              </div>
              
              {/* Content */}
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-medium text-white/90 line-clamp-1">{project.title}</h3>
                  <span className={`px-2 py-0.5 rounded-full text-xs border ${statusColors[project.status]}`}>
                    {project.status}
                  </span>
                </div>
                
                <div className="flex items-center gap-2 mt-2 text-xs text-white/40">
                  <span>{typeIcon[project.type]}</span>
                  <span>{project.type}</span>
                  <span>•</span>
                  <span>{formatDate(project.createdAt)}</span>
                </div>
                
                {/* Actions */}
                <div className="flex gap-2 mt-4 pt-3 border-t border-white/5">
                  {project.status === 'complete' && project.buildPassCompletedAt ? (
                    <>
                      <button
                        onClick={() => handleLaunch(project)}
                        title="Open project view"
                        className="flex-1 px-3 py-1.5 rounded-lg bg-purple-500/20 text-purple-300 text-sm hover:bg-purple-500/30 transition-colors"
                      >
                        Launch
                      </button>
                      <button
                        onClick={() => handleEdit(project)}
                        className="px-3 py-1.5 rounded-lg bg-white/5 text-white/70 text-sm hover:bg-white/10 transition-colors"
                      >
                        Edit
                      </button>
                    </>
                  ) : (
                    <div className="flex-1 px-3 py-1.5 text-xs italic text-white/30">
                      Launch and Edit unlock once the first build pass completes.
                    </div>
                  )}
                  <button
                    onClick={() => handleDelete(project)}
                    aria-label="Delete project"
                    className="px-3 py-1.5 rounded-lg bg-white/5 text-red-400/80 text-sm hover:bg-red-500/10 hover:text-red-400 transition-colors"
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit modal */}
      {editingId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={cancelEdit}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0a0614] p-6 space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-white">Edit Project</h3>
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              placeholder="Project title"
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder:text-white/40 focus:outline-none focus:border-purple-500/50"
              autoFocus
            />
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              placeholder="Project description / brief"
              rows={6}
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder:text-white/40 resize-none focus:outline-none focus:border-purple-500/50"
            />
            {editError && <div className="text-xs text-red-400/80">{editError}</div>}
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={cancelEdit}
                className="px-4 py-2 rounded-lg bg-white/5 text-white/70 text-sm hover:bg-white/10 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                disabled={savingEdit || !editTitle.trim()}
                className="px-4 py-2 rounded-lg bg-purple-500/30 text-purple-200 text-sm hover:bg-purple-500/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {savingEdit ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ProjectGallery;
