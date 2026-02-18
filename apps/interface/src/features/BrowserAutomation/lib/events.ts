// Typed browser automation event contract
// Provides strongly typed helpers for dispatching and listening to custom events

export type ActionData = {
  type: 'click' | 'type' | 'scroll' | 'hover' | 'wait';
  selector?: string;
  text?: string;
  coordinates?: { x: number; y: number };
  waitTime?: number;
};

// Queue events
export interface BrowserQueueEnqueueDetail { id: string; kind: 'navigate' | 'perform'; size: number; }
export interface BrowserQueueDequeueDetail { id: string; kind: 'navigate' | 'perform'; }

// Action lifecycle events
export interface BrowserActionRequestDetail { action: ActionData; }
export interface BrowserActionSuccessDetail { id: string; kind: 'navigate' | 'perform'; }
export interface BrowserActionRetryDetail { id: string; attempt: number; }
export interface BrowserActionFailedDetail { id: string; error: string; }

// Session events
export interface BrowserSessionClosedDetail { sessionId: string; }
export interface BrowserSessionCloseErrorDetail { sessionId: string; error: string; }

export type BrowserEventDetailMap = {
  'browser.queue.enqueue': BrowserQueueEnqueueDetail;
  'browser.queue.dequeue': BrowserQueueDequeueDetail;
  'browser.action.request': BrowserActionRequestDetail;
  'browser.action.success': BrowserActionSuccessDetail;
  'browser.action.retry': BrowserActionRetryDetail;
  'browser.action.failed': BrowserActionFailedDetail;
  'browser.session.closed': BrowserSessionClosedDetail;
  'browser.session.close_error': BrowserSessionCloseErrorDetail;
};

export type BrowserEventName = keyof BrowserEventDetailMap;

export function dispatchBrowserEvent<K extends BrowserEventName>(name: K, detail: BrowserEventDetailMap[K]): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export function addBrowserEventListener<K extends BrowserEventName>(name: K, listener: (detail: BrowserEventDetailMap[K]) => void): () => void {
  const handler = (e: Event) => {
    const ce = e as CustomEvent<BrowserEventDetailMap[K]>;
    listener(ce.detail);
  };
  window.addEventListener(name, handler as EventListener);
  return () => window.removeEventListener(name, handler as EventListener);
}
