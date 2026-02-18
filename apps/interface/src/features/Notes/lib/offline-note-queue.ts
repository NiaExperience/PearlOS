import { getClientLogger } from '@interface/lib/client-logger';

const log = getClientLogger('Notes');

const STORAGE_KEY = 'nia_notes_queue_v1';
const MAX_ATTEMPTS = 3;

export interface OfflineNotePayload {
  noteId: string;
  assistantName: string;
  data: {
    title: string;
    content: string;
    isPinned?: boolean;
  };
}

export interface QueuedOfflineNote extends OfflineNotePayload {
  queuedAt: number;
  attempts: number;
}

const isBrowserEnvironment = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const readQueue = (): QueuedOfflineNote[] => {
  if (!isBrowserEnvironment()) {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as QueuedOfflineNote[];
    if (!Array.isArray(parsed)) {
      window.localStorage.removeItem(STORAGE_KEY);
      return [];
    }

    return parsed;
  } catch (error) {
    log.error('Failed to read offline queue, clearing storage', { error });
    window.localStorage.removeItem(STORAGE_KEY);
    return [];
  }
};

const writeQueue = (queue: QueuedOfflineNote[]) => {
  if (!isBrowserEnvironment()) return;

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
};

export const queueOfflineNoteUpdate = (payload: OfflineNotePayload) => {
  if (!isBrowserEnvironment()) return;

  const queue = readQueue();
  const nextItem: QueuedOfflineNote = {
    ...payload,
    queuedAt: Date.now(),
    attempts: 0,
  };
  queue.push(nextItem);
  writeQueue(queue);
  log.info('Queued offline note update', {
    noteId: payload.noteId,
    queueSize: queue.length,
  });
};

export const consumeNextQueuedNote = (): QueuedOfflineNote | null => {
  if (!isBrowserEnvironment()) return null;

  const queue = readQueue();
  if (!queue.length) return null;

  const [next, ...rest] = queue;
  writeQueue(rest);
  return next;
};

export const requeueNoteUpdate = (item: QueuedOfflineNote) => {
  if (!isBrowserEnvironment()) return;

  const queue = readQueue();
  queue.unshift(item);
  writeQueue(queue);
  log.info('Re-queued offline note update', {
    noteId: item.noteId,
    attempts: item.attempts,
  });
};

export const hasQueuedOfflineNotes = () => readQueue().length > 0;

export const shouldDropQueuedItem = (item: QueuedOfflineNote) => item.attempts >= MAX_ATTEMPTS;

