'use client';

import { useEffect, useState } from 'react';

interface TaskState {
  id: string;
  label: string;
  progress: number;
}

export default function CanvasTaskProgress() {
  const [task, setTask] = useState<TaskState | null>(null);
  const [hiding, setHiding] = useState(false);

  useEffect(() => {
    const onStart = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const payload = detail?.payload ?? detail;
      setTask({
        id: payload?.taskId ?? '',
        label: payload?.label ?? 'Loading...',
        progress: 5,
      });
      setHiding(false);
    };

    const onProgress = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const payload = detail?.payload ?? detail;
      const progress = payload?.progress ?? 0;
      setTask((prev) => (prev ? { ...prev, progress } : null));
    };

    const onComplete = (e: Event) => {
      setTask((prev) => (prev ? { ...prev, progress: 100 } : null));
      setHiding(true);
      setTimeout(() => {
        setTask(null);
        setHiding(false);
      }, 800);
    };

    window.addEventListener('nia:canvas.task.start', onStart);
    window.addEventListener('nia:canvas.task.progress', onProgress);
    window.addEventListener('nia:canvas.task.complete', onComplete);

    return () => {
      window.removeEventListener('nia:canvas.task.start', onStart);
      window.removeEventListener('nia:canvas.task.progress', onProgress);
      window.removeEventListener('nia:canvas.task.complete', onComplete);
    };
  }, []);

  if (!task) return null;

  return (
    <div
      className="canvas-task-progress"
      style={{
        position: 'fixed',
        bottom: 100,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'clamp(280px, 50vw, 400px)',
        height: 36,
        background: 'rgba(56, 189, 248, 0.12)',
        border: '1px solid rgba(56, 189, 248, 0.2)',
        borderRadius: 18,
        overflow: 'hidden',
        zIndex: 1000,
        transition: 'opacity 0.3s ease',
        display: 'flex',
        alignItems: 'center',
        backdropFilter: 'blur(12px)',
        opacity: hiding ? 0 : 1,
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: `${task.progress}%`,
          background: 'linear-gradient(90deg, rgba(52, 211, 153, 0.3), rgba(52, 211, 153, 0.5))',
          borderRadius: 18,
          transition: 'width 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      />
      <span
        style={{
          position: 'relative',
          zIndex: 1,
          padding: '0 16px',
          fontSize: 13,
          fontWeight: 500,
          color: 'rgba(255, 255, 255, 0.8)',
          letterSpacing: '0.02em',
          whiteSpace: 'nowrap',
        }}
      >
        {task.label}
      </span>
    </div>
  );
}
