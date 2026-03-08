import { describe, it, expect, vi } from "vitest";
import {
  signal,
  computed,
  effect,
  batch,
  untracked,
  observerCount,
  sourceCount,
} from "./index.js";

type AnyProducer = Parameters<typeof observerCount>[0];

describe("signal", () => {
  it("reads and writes via .value and get/set", () => {
    const a = signal(1);
    expect(a.value).toBe(1);
    expect(a.get()).toBe(1);
    a.value = 2;
    expect(a.value).toBe(2);
    a.set(3);
    expect(a.get()).toBe(3);
    a.update((p) => p + 1);
    expect(a.value).toBe(4);
  });

  it("does not notify when the value is Object.is-equal", () => {
    const a = signal(1);
    const spy = vi.fn(() => a.value);
    effect(spy);
    expect(spy).toHaveBeenCalledTimes(1);
    a.set(1);
    expect(spy).toHaveBeenCalledTimes(1);
    a.set(2);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("supports a custom equality function", () => {
    const a = signal({ n: 1 }, { equals: (x, y) => x.n === y.n });
    const spy = vi.fn(() => a.value.n);
    effect(spy);
    expect(spy).toHaveBeenCalledTimes(1);
    a.set({ n: 1 });
    expect(spy).toHaveBeenCalledTimes(1);
    a.set({ n: 2 });
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("computed", () => {
  it("derives and memoises", () => {
    const a = signal(2);
    const fn = vi.fn(() => a.value * 10);
    const c = computed(fn);
    expect(c.value).toBe(20);
    expect(c.value).toBe(20);
    expect(fn).toHaveBeenCalledTimes(1);
    a.set(3);
    expect(c.value).toBe(30);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("is LAZY: never runs fn if its value is never read", () => {
    const a = signal(1);
    const fn = vi.fn(() => a.value + 1);
    const c = computed(fn);
    a.set(2);
    a.set(3);
    expect(fn).not.toHaveBeenCalled();
    expect(c.value).toBe(4);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("composes computeds", () => {
    const a = signal(1);
    const b = computed(() => a.value + 1);
    const c = computed(() => b.value * 2);
    expect(c.value).toBe(4);
    a.set(10);
    expect(c.value).toBe(22);
  });

  it("throws on a direct cycle", () => {
    const c: { value: number } = computed((): number => c.value + 1) as never;
    expect(() => c.value).toThrow(/cycle/i);
  });

  it("propagates and caches thrown errors, recovering afterwards", () => {
    const a = signal(0);
    const c = computed(() => {
      if (a.value === 0) throw new Error("boom");
      return a.value;
    });
    expect(() => c.value).toThrow("boom");
    expect(() => c.value).toThrow("boom");
    a.set(5);
    expect(c.value).toBe(5);
  });
});

describe("effect", () => {
  it("runs immediately and on dependency change", () => {
    const a = signal(1);
    const seen: number[] = [];
    effect(() => seen.push(a.value));
    expect(seen).toEqual([1]);
    a.set(2);
    expect(seen).toEqual([1, 2]);
  });

  it("dispose stops further runs", () => {
    const a = signal(1);
    const spy = vi.fn(() => a.value);
    const dispose = effect(spy);
    a.set(2);
    expect(spy).toHaveBeenCalledTimes(2);
    dispose();
    a.set(3);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("supports .dispose() method form", () => {
    const a = signal(1);
    const spy = vi.fn(() => a.value);
    const handle = effect(spy);
    handle.dispose();
    a.set(2);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("cleanup", () => {
  it("runs cleanup before each re-run and on dispose", () => {
    const a = signal(0);
    const events: string[] = [];
    const dispose = effect(() => {
      const v = a.value;
      events.push(`run:${v}`);
      return () => events.push(`cleanup:${v}`);
    });
    expect(events).toEqual(["run:0"]);
    a.set(1);
    expect(events).toEqual(["run:0", "cleanup:0", "run:1"]);
    dispose();
    expect(events).toEqual(["run:0", "cleanup:0", "run:1", "cleanup:1"]);
  });
});

describe("dynamic dependencies", () => {
  it("unsubscribes from sources that stop being read", () => {
    const cond = signal(true);
    const a = signal("a");
    const b = signal("b");
    const fn = vi.fn(() => (cond.value ? a.value : b.value));
    const c = computed(fn);

    expect(c.value).toBe("a");
    expect(fn).toHaveBeenCalledTimes(1);

    b.set("b2");
    expect(c.value).toBe("a");
    expect(fn).toHaveBeenCalledTimes(1);

    a.set("a2");
    expect(c.value).toBe("a2");
    expect(fn).toHaveBeenCalledTimes(2);

    cond.set(false);
    expect(c.value).toBe("b2");
    expect(fn).toHaveBeenCalledTimes(3);

    a.set("a3");
    expect(c.value).toBe("b2");
    expect(fn).toHaveBeenCalledTimes(3);

    b.set("b3");
    expect(c.value).toBe("b3");
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it("drops the subscription to the unused source (no observer left)", () => {
    const cond = signal(true);
    const a = signal("a");
    const b = signal("b");
    const c = computed(() => (cond.value ? a.value : b.value));

    const dispose = effect(() => c.value);

    expect(observerCount(a as unknown as AnyProducer)).toBe(1);
    expect(observerCount(b as unknown as AnyProducer)).toBe(0);

    cond.set(false);
    expect(observerCount(a as unknown as AnyProducer)).toBe(0);
    expect(observerCount(b as unknown as AnyProducer)).toBe(1);

    dispose();
  });
});

describe("the DIAMOND problem (glitch-freedom)", () => {
  it("recomputes the sink EXACTLY ONCE per source change", () => {
    const a = signal(1);
    const b = computed(() => a.value + 1);
    const c = computed(() => a.value * 2);
    const dFn = vi.fn(() => b.value + c.value);
    const d = computed(dFn);

    const observed: number[] = [];
    effect(() => observed.push(d.value));

    expect(observed).toEqual([1 + 1 + 1 * 2]);
    expect(dFn).toHaveBeenCalledTimes(1);

    a.set(2);
    expect(observed).toEqual([4, 7]);
    expect(dFn).toHaveBeenCalledTimes(2);

    a.set(3);
    expect(observed).toEqual([4, 7, 4 + 6]);
    expect(dFn).toHaveBeenCalledTimes(3);
  });

  it("never observes a half-updated graph (consistency invariant)", () => {
    const a = signal(1);
    const b = computed(() => a.value);
    const c = computed(() => a.value);
    const inconsistencies: string[] = [];
    const d = computed(() => {
      if (b.value !== c.value) {
        inconsistencies.push(`b=${b.value} c=${c.value}`);
      }
      return b.value + c.value;
    });
    const effectValues: number[] = [];
    effect(() => effectValues.push(d.value));

    for (let i = 2; i <= 50; i++) a.set(i);

    expect(inconsistencies).toEqual([]);
    expect(effectValues[effectValues.length - 1]).toBe(100);
  });

  it("deep diamond recomputes the sink once", () => {
    const a = signal(0);
    const b = computed(() => a.value + 1);
    const c = computed(() => a.value + 2);
    const e = computed(() => b.value + c.value);
    const f = computed(() => b.value - c.value);
    const gFn = vi.fn(() => e.value * f.value);
    const g = computed(gFn);

    effect(() => g.value);
    expect(gFn).toHaveBeenCalledTimes(1);
    a.set(10);
    expect(gFn).toHaveBeenCalledTimes(2);
    a.set(20);
    expect(gFn).toHaveBeenCalledTimes(3);
  });
});

describe("batch", () => {
  it("coalesces N writes into ONE effect run", () => {
    const a = signal(0);
    const b = signal(0);
    const spy = vi.fn(() => a.value + b.value);
    effect(spy);
    expect(spy).toHaveBeenCalledTimes(1);

    batch(() => {
      a.set(1);
      a.set(2);
      b.set(3);
      expect(spy).toHaveBeenCalledTimes(1);
    });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("reads inside a batch see the latest written value", () => {
    const a = signal(0);
    let insideValue = -1;
    batch(() => {
      a.set(5);
      insideValue = a.value;
    });
    expect(insideValue).toBe(5);
  });

  it("nested batches flush only at the outermost close", () => {
    const a = signal(0);
    const spy = vi.fn(() => a.value);
    effect(spy);
    batch(() => {
      a.set(1);
      batch(() => {
        a.set(2);
      });
      expect(spy).toHaveBeenCalledTimes(1);
    });
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("untracked", () => {
  it("reads without subscribing", () => {
    const a = signal(1);
    const b = signal(10);
    const spy = vi.fn(() => a.value + untracked(() => b.value));
    effect(spy);
    expect(spy).toHaveBeenCalledTimes(1);

    b.set(20);
    expect(spy).toHaveBeenCalledTimes(1);

    a.set(2);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("untracked inside a computed does not create a dependency", () => {
    const a = signal(1);
    const b = signal(1);
    const c = computed(() => untracked(() => a.value) + b.value);
    expect(c.value).toBe(2);
    a.set(100);
    expect(c.value).toBe(2);
    b.set(2);
    expect(c.value).toBe(102);
  });
});

describe("memory safety / no leaks", () => {
  it("disposing an effect drops ALL its source subscriptions to 0", () => {
    const a = signal(1);
    const b = signal(2);
    const dispose = effect(() => a.value + b.value);

    expect(observerCount(a as unknown as AnyProducer)).toBe(1);
    expect(observerCount(b as unknown as AnyProducer)).toBe(1);

    dispose();

    expect(observerCount(a as unknown as AnyProducer)).toBe(0);
    expect(observerCount(b as unknown as AnyProducer)).toBe(0);
  });

  it("a computed with no observers releases its own subscriptions when its observers go away", () => {
    const a = signal(1);
    const c = computed(() => a.value + 1);
    const dispose = effect(() => c.value);

    expect(observerCount(a as unknown as AnyProducer)).toBe(1);
    expect(observerCount(c as unknown as AnyProducer)).toBe(1);
    expect(sourceCount(c as never)).toBe(1);

    dispose();
    expect(observerCount(c as unknown as AnyProducer)).toBe(0);
  });

  it("re-running an effect does not accumulate duplicate subscriptions", () => {
    const a = signal(1);
    effect(() => a.value);
    for (let i = 0; i < 100; i++) a.set(i);
    expect(observerCount(a as unknown as AnyProducer)).toBe(1);
  });
});

describe("ordering & re-entrancy", () => {
  it("writing a signal from inside an effect re-runs dependents once", () => {
    const a = signal(0);
    const b = signal(0);
    const log: string[] = [];
    effect(() => {
      log.push(`A:${a.value}`);
      if (a.value < 3) b.set(a.value);
    });
    effect(() => log.push(`B:${b.value}`));
    a.set(1);
    a.set(2);
    expect(b.value).toBe(2);
    expect(log.filter((l) => l.startsWith("B:")).length).toBeGreaterThan(0);
  });
});
