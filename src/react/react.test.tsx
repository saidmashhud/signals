import { describe, it, expect, vi } from "vitest";
import { signal } from "../core/signal.js";
import { computed } from "../core/computed.js";
import { effect } from "../core/effect.js";

function makeStore<T>(source: { value: T; peek(): T }) {
  const subscribe = (onStoreChange: () => void) => {
    const dispose = effect(() => {
      source.value;
      onStoreChange();
    });
    return dispose;
  };
  const getSnapshot = () => source.peek();
  return { subscribe, getSnapshot };
}

describe("react adapter integration contract", () => {
  it("notifies subscribers on signal change and snapshot reflects it", () => {
    const s = signal(0);
    const { subscribe, getSnapshot } = makeStore(s);
    const notify = vi.fn();

    const unsub = subscribe(notify);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(getSnapshot()).toBe(0);

    s.set(1);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(getSnapshot()).toBe(1);

    unsub();
    s.set(2);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(getSnapshot()).toBe(2);
  });

  it("works with computed sources", () => {
    const a = signal(2);
    const c = computed(() => a.value * 5);
    const { subscribe, getSnapshot } = makeStore(c);
    const notify = vi.fn();

    const unsub = subscribe(notify);
    expect(getSnapshot()).toBe(10);
    a.set(4);
    expect(getSnapshot()).toBe(20);
    expect(notify).toHaveBeenCalledTimes(2);
    unsub();
  });

  it("getSnapshot is stable (no new value) when nothing changed → no tearing", () => {
    const a = signal(1);
    const c = computed(() => a.value % 2);
    const { getSnapshot } = makeStore(c);
    expect(getSnapshot()).toBe(1);
    a.set(3);
    expect(getSnapshot()).toBe(1);
    a.set(2);
    expect(getSnapshot()).toBe(0);
  });
});

describe("react hooks are exported and callable shapes", () => {
  it("module exposes the documented hooks", async () => {
    const mod = await import("./index.js");
    expect(typeof mod.useSignal).toBe("function");
    expect(typeof mod.useComputed).toBe("function");
    expect(typeof mod.useSignalValue).toBe("function");
    expect(typeof mod.useSignalState).toBe("function");
  });
});
