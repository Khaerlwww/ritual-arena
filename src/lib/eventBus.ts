// src/lib/eventBus.ts
//
// Lightweight typed event bus for client-side cross-hook invalidation.
// When a write action succeeds (claim, stake, open pack, etc.), it
// emits a domain-specific event. Hooks that own related data listen
// and refetch — no manual `refetch()` plumbing at every call site,
// no polling, no global state.
//
// Pair this with `watchContractEvent` for changes from OTHER users
// (admin mint to your wallet, someone buys your listing, etc.).

export type EventPayload =
  | { type: 'ap-changed'; reason: string }
  | { type: 'nft-changed'; reason: string }
  | { type: 'position-changed'; reason: string }
  | { type: 'identity-changed'; reason: string }
  | { type: 'listing-changed'; reason: string }
  | { type: 'tx-success'; source: string; action: string; hash?: string };

export type EventType = EventPayload['type'];
type Listener = (payload: EventPayload) => void;

const listeners: { [E in EventType]?: Set<Listener> } = {} as never;

export function emit(payload: EventPayload): void {
  if (typeof window === 'undefined') return;
  const set = listeners[payload.type];
  if (!set) return;
  for (const fn of set) {
    try {
      fn(payload);
    } catch (e) {
      console.error(`[eventBus] listener for ${payload.type} threw:`, e);
    }
  }
}

export function on<T extends EventType>(
  type: T,
  fn: (payload: Extract<EventPayload, { type: T }>) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};
  let set = listeners[type];
  if (!set) {
    set = new Set();
    listeners[type] = set;
  }
  set.add(fn as Listener);
  return () => {
    set?.delete(fn as Listener);
  };
}

// Backwards-compatible alias for existing code.
export function emitAPChanged(): void {
  emit({ type: 'ap-changed', reason: 'other' });
}
