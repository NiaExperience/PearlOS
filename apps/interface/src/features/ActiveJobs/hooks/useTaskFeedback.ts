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
}

export interface FeedbackState {
  /** Map of taskId → feedback type already submitted */
  submitted: Map<string, 'up' | 'down'>;
}

export function useTaskFeedback() {
  const [feedbackState, setFeedbackState] = useState<FeedbackState>({
    submitted: new Map(),
  });
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTaskId, setModalTaskId] = useState<string | null>(null);
  const [modalTaskName, setModalTaskName] = useState<string>('');
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

  const openFeedbackModal = useCallback((taskId: string, taskName: string) => {
    setModalTaskId(taskId);
    setModalTaskName(taskName);
    setModalOpen(true);
  }, []);

  const closeFeedbackModal = useCallback(() => {
    setModalOpen(false);
    setModalTaskId(null);
    setModalTaskName('');
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
      for (const img of feedback.images) {
        formData.append('images', img);
      }

      await fetch('/api/task-feedback', {
        method: 'POST',
        body: formData,
      });

      setFeedbackState((prev) => {
        const next = new Map(prev.submitted);
        next.set(feedback.taskId, 'down');
        return { submitted: next };
      });

      closeFeedbackModal();
    } catch (e) {
      console.error('Failed to submit feedback:', e);
    } finally {
      setSubmitting(false);
    }
  }, [closeFeedbackModal]);

  return {
    feedbackState,
    modalOpen,
    modalTaskId,
    modalTaskName,
    submitting,
    handleThumbsUp,
    openFeedbackModal,
    closeFeedbackModal,
    submitFeedback,
  };
}
