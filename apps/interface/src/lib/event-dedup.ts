/**
 * Simple ring-buffer dedup for nia.event envelopes.
 *
 * Both the Daily app-message bridge and the gateway WebSocket can deliver
 * the same event.  This module ensures each unique envelope is processed
 * only once regardless of delivery path.
 */

const DEDUP_SIZE = 256;
const _seen = new Set<string>();
const _seenOrder: string[] = [];

/**
 * Returns `true` if this key was already seen (duplicate).
 * Returns `false` on first encounter and records the key.
 */
export function isDuplicateEvent(seq: number, ts: number, event: string): boolean {
  const key = `${seq}:${ts}:${event}`;
  if (_seen.has(key)) return true;
  _seen.add(key);
  _seenOrder.push(key);
  if (_seenOrder.length > DEDUP_SIZE) {
    const old = _seenOrder.shift()!;
    _seen.delete(old);
  }
  return false;
}
