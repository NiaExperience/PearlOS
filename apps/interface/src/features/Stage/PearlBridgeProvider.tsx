'use client';

import { useCallback, useEffect, useRef } from 'react';
import { getClientLogger } from '@interface/lib/client-logger';

const logger = getClientLogger('[pearl_bridge]');

/**
 * The pearl.* Bridge SDK script injected into every experience iframe.
 * Communicates with The Stage via postMessage.
 */
const BRIDGE_SDK_SCRIPT = `
<script>
(function() {
  var _seq = 0;
  var _pending = {};

  function _call(method, args) {
    return new Promise(function(resolve, reject) {
      var id = ++_seq;
      _pending[id] = { resolve: resolve, reject: reject };
      window.parent.postMessage({
        type: 'pearl.bridge',
        id: id,
        method: method,
        args: args || []
      }, '*');
      // Timeout after 30s
      setTimeout(function() {
        if (_pending[id]) {
          _pending[id].reject(new Error('pearl.' + method + ' timed out'));
          delete _pending[id];
        }
      }, 30000);
    });
  }

  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'pearl.bridge.response') {
      var p = _pending[e.data.id];
      if (p) {
        delete _pending[e.data.id];
        if (e.data.error) {
          p.reject(new Error(e.data.error));
        } else {
          p.resolve(e.data.result);
        }
      }
    }
    // Event broadcasts from Pearl
    if (e.data && e.data.type === 'pearl.event' && window.pearl && window.pearl._handlers) {
      var handlers = window.pearl._handlers[e.data.event] || [];
      handlers.forEach(function(h) { try { h(e.data.payload); } catch(ex) {} });
    }
  });

  window.pearl = {
    _handlers: {},
    ask: function(prompt) { return _call('ask', [prompt]); },
    image: function(prompt) { return _call('image', [prompt]); },
    search: function(query) { return _call('search', [query]); },
    speak: function(text) { return _call('speak', [text]); },
    data: function(key, value) { return _call('data', [key, value]); },
    dismiss: function() { return _call('dismiss'); },
    navigate: function(intent) { return _call('navigate', [intent]); },
    on: function(event, handler) {
      if (!this._handlers[event]) this._handlers[event] = [];
      this._handlers[event].push(handler);
    },
    off: function(event, handler) {
      if (!this._handlers[event]) return;
      this._handlers[event] = this._handlers[event].filter(function(h) { return h !== handler; });
    }
  };
})();
</script>
`;

export interface BridgeMessage {
  type: 'pearl.bridge';
  id: number;
  method: string;
  args: unknown[];
}

export interface PearlBridgeHandlers {
  onAsk?: (prompt: string) => Promise<unknown>;
  onSpeak?: (text: string) => Promise<void>;
  onDismiss?: () => void;
  onNavigate?: (intent: string) => Promise<void>;
}

/**
 * Returns the bridge SDK script to inject into experience HTML.
 */
export function getBridgeScript(): string {
  return BRIDGE_SDK_SCRIPT;
}

/**
 * Hook that listens for pearl.bridge postMessages from an experience iframe
 * and routes them to the provided handlers.
 */
export function usePearlBridge(
  iframeRef: React.RefObject<HTMLIFrameElement | null>,
  handlers: PearlBridgeHandlers
) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const handleMessage = useCallback(async (event: MessageEvent) => {
    const data = event.data as BridgeMessage;
    if (!data || data.type !== 'pearl.bridge') return;

    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;

    // Verify the message came from our iframe
    if (event.source !== iframe.contentWindow) return;

    const { id, method, args } = data;
    let result: unknown = null;
    let error: string | null = null;

    try {
      switch (method) {
        case 'ask':
          result = handlersRef.current.onAsk
            ? await handlersRef.current.onAsk(args[0] as string)
            : null;
          break;
        case 'speak':
          if (handlersRef.current.onSpeak) {
            await handlersRef.current.onSpeak(args[0] as string);
          }
          break;
        case 'dismiss':
          handlersRef.current.onDismiss?.();
          break;
        case 'navigate':
          if (handlersRef.current.onNavigate) {
            await handlersRef.current.onNavigate(args[0] as string);
          }
          break;
        default:
          error = `Unknown pearl bridge method: ${method}`;
          logger.warn(error);
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      logger.error(`pearl.${method} failed`, { error });
    }

    // Send response back to iframe
    iframe.contentWindow.postMessage({
      type: 'pearl.bridge.response',
      id,
      result,
      error,
    }, '*');
  }, [iframeRef]);

  useEffect(() => {
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage]);
}
