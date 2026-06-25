'use client';

import { useState, useCallback } from 'react';

export interface TaskFeedback {
  taskId: string;
  taskName: string;
  type: 'up' | 'down';
  notes: string;
  images: File[];
  timestamp: number;
  mode: 'text' | 'voice';
  /** Original task description for relaunch context */
  taskDescription?: string;
}

export interface FeedbackState {
  /** Map of taskId → feedback type already submitted */
  submitted: Map<string, 'up' | 'down'>;
}

export function useTaskFeedback() {
  const [feedbackState, setFeedbackState] = useState<FeedbackState>({
    submitted: new Map(),
  });
  /** Which task ID currently has inline feedback open (null = none) */
  const [inlineFeedbackTaskId, setInlineFeedbackTaskId] = useState<string | null>(null);
  const [inlineFeedbackTaskName, setInlineFeedbackTaskName] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const handleThumbsUp = useCallback(async (taskId: string, taskName: string) => {
    setFeedbackState((prev) => {
      const next = new Map(prev.submitted);
      next.set(taskId, 'up');
      return { submitted: next };
    });

    try {
      await fetch('/api/task-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId,
          taskName,
          type: 'up',
          notes: '',
          images: [],
          timestamp: Date.now(),
          mode: 'text',
        }),
      });
    } catch (e) {
      console.error('Failed to submit thumbs up feedback:', e);
    }
  }, []);

  /** Toggle inline feedback for a specific task (replaces modal) */
  const openInlineFeedback = useCallback((taskId: string, taskName: string) => {
    setInlineFeedbackTaskId((prev) => (prev === taskId ? null : taskId));
    setInlineFeedbackTaskName(taskName);
  }, []);

  const closeInlineFeedback = useCallback(() => {
    setInlineFeedbackTaskId(null);
    setInlineFeedbackTaskName('');
  }, []);

  const submitFeedback = useCallback(async (feedback: TaskFeedback) => {
    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('taskId', feedback.taskId);
      formData.append('taskName', feedback.taskName);
      formData.append('type', feedback.type);
      formData.append('notes', feedback.notes);
      formData.append('timestamp', String(feedback.timestamp));
      formData.append('mode', feedback.mode);
      if (feedback.taskDescription) {
        formData.append('taskDescription', feedback.taskDescription);
      }
      // The widget itself re-queues the task to pending (PATCH status='pending'
      // with the user's note) right after this submission, so we no longer
      // ask the feedback API to fire a duplicate /api/message relaunch.
      formData.append('relaunch', 'false');
      for (const img of feedback.images) {
        formData.append('images', img);
      }

      await fetch('/api/task-feedback', {
        method: 'POST',
        body: formData,
      });

      closeInlineFeedback();
    } catch (e) {
      console.error('Failed to submit feedback:', e);
    } finally {
      setSubmitting(false);
    }
  }, [closeInlineFeedback]);

  return {
    feedbackState,
    inlineFeedbackTaskId,
    inlineFeedbackTaskName,
    submitting,
    handleThumbsUp,
    openInlineFeedback,
    closeInlineFeedback,
    submitFeedback,
  };
}
