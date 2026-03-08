import { useRef, useMemo, useCallback, useSyncExternalStore } from "react";
import { signal as createSignal, type Signal, type ReadonlySignal } from "../core/signal.js";
import { computed as createComputed, type Computed } from "../core/computed.js";
import { effect } from "../core/effect.js";

export function useSignal<T>(initial: T): Signal<T> {
  const ref = useRef<Signal<T> | null>(null);
  if (ref.current === null) {
    ref.current = createSignal(initial);
  }
  return ref.current;
}

export function useComputed<T>(fn: () => T): Computed<T> {
  const ref = useRef<Computed<T> | null>(null);
  if (ref.current === null) {
    ref.current = createComputed(fn);
  }
  return ref.current;
}

export function useSignalValue<T>(source: ReadonlySignal<T>): T {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const dispose = effect(() => {
        source.value;
        onStoreChange();
      });
      return dispose;
    },
    [source],
  );

  const getSnapshot = useCallback(() => source.peek(), [source]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useSignalState<T>(initial: T): [T, (next: T | ((prev: T) => T)) => void] {
  const sig = useSignal(initial);
  const value = useSignalValue(sig);
  const setter = useMemo(
    () => (next: T | ((prev: T) => T)) => {
      if (typeof next === "function") sig.update(next as (prev: T) => T);
      else sig.set(next);
    },
    [sig],
  );
  return [value, setter];
}
