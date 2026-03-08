import {
  type Producer,
  type Consumer,
  type Link,
  CLEAN,
  DIRTY,
  RUNNING,
  track,
  runWithTracking,
  updateIfNecessary,
  tagProducerConsumer,
} from "./graph.js";
import type { ReadonlySignal } from "./signal.js";

export interface ComputedOptions<T> {
  equals?: (a: T, b: T) => boolean;
}

class ComputedImpl<T> implements ReadonlySignal<T>, Producer, Consumer {
  version = 0;
  observers: Link | undefined = undefined;
  observersTail: Link | undefined = undefined;

  state: Consumer["state"] = DIRTY;
  sources: Link | undefined = undefined;
  sourcesTail: Link | undefined = undefined;
  sourcesCursor: Link | undefined = undefined;
  tracking = false;

  private readonly fn: () => T;
  private readonly equals: (a: T, b: T) => boolean;
  private valueCache: T | typeof UNSET = UNSET;
  private computeError: unknown = undefined;
  private hasError = false;

  constructor(fn: () => T, options?: ComputedOptions<T>) {
    this.fn = fn;
    this.equals = options?.equals ?? Object.is;
    tagProducerConsumer(this);
  }

  get value(): T {
    track(this);
    updateIfNecessary(this);
    if (this.hasError) throw this.computeError;
    return this.valueCache as T;
  }

  get(): T {
    return this.value;
  }

  peek(): T {
    updateIfNecessary(this);
    if (this.hasError) throw this.computeError;
    return this.valueCache as T;
  }

  recompute(): boolean {
    if (this.state === RUNNING) {
      throw new Error("signals: cycle detected — a computed read itself while computing.");
    }
    this.state = RUNNING;

    let next: T;
    let threw = false;
    let error: unknown = undefined;
    try {
      next = runWithTracking(this, this.fn);
    } catch (e) {
      threw = true;
      error = e;
      next = UNSET as unknown as T;
    }

    this.state = CLEAN;

    let changed = false;
    if (threw) {
      changed = !this.hasError || this.computeError !== error;
      this.hasError = true;
      this.computeError = error;
    } else {
      if (this.hasError) {
        changed = true;
      } else if (this.valueCache === UNSET) {
        changed = true;
      } else {
        changed = !this.equals(this.valueCache as T, next);
      }
      this.hasError = false;
      this.computeError = undefined;
      this.valueCache = next;
    }

    if (changed) this.version++;
    return changed;
  }
}

const UNSET = Symbol("signals.unset");

export interface Computed<T> extends ReadonlySignal<T> {
  readonly value: T;
}

export function computed<T>(fn: () => T, options?: ComputedOptions<T>): Computed<T> {
  return new ComputedImpl(fn, options);
}

export { CLEAN };
