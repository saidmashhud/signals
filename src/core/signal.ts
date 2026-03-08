import {
  type Producer,
  CLEAN,
  track,
  propagate,
  observerCount,
} from "./graph.js";

export interface ReadonlySignal<T> {
  readonly value: T;
  get(): T;
  peek(): T;
}

export interface Signal<T> extends ReadonlySignal<T> {
  value: T;
  set(next: T): void;
  update(fn: (prev: T) => T): void;
}

export interface SignalOptions<T> {
  equals?: (a: T, b: T) => boolean;
}

class SignalImpl<T> implements Signal<T>, Producer {
  version = 0;
  observers: Producer["observers"] = undefined;
  observersTail: Producer["observers"] = undefined;

  private current: T;
  private readonly equals: (a: T, b: T) => boolean;

  constructor(initial: T, options?: SignalOptions<T>) {
    this.current = initial;
    this.equals = options?.equals ?? Object.is;
  }

  get value(): T {
    track(this);
    return this.current;
  }

  set value(next: T) {
    this.set(next);
  }

  get(): T {
    track(this);
    return this.current;
  }

  peek(): T {
    return this.current;
  }

  set(next: T): void {
    if (this.equals(this.current, next)) return;
    this.current = next;
    this.version++;
    propagate(this);
  }

  update(fn: (prev: T) => T): void {
    this.set(fn(this.current));
  }
}

export function signal<T>(initial: T, options?: SignalOptions<T>): Signal<T> {
  return new SignalImpl(initial, options);
}

export function isSignal(x: unknown): x is ReadonlySignal<unknown> {
  return x instanceof SignalImpl || (typeof x === "object" && x !== null && "peek" in x && "get" in x);
}

export { observerCount, CLEAN };
