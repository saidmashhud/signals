import {
  type Consumer,
  type ReactiveEffect,
  type Link,
  CLEAN,
  DIRTY,
  runWithTracking,
  clearSources,
  tagEffect,
  flush,
} from "./graph.js";

export type EffectCleanup = () => void;
export type EffectFn = () => EffectCleanup | unknown;

export interface EffectHandle {
  (): void;
  dispose(): void;
}

class EffectImpl implements ReactiveEffect {
  readonly isEffect = true as const;

  state: Consumer["state"] = DIRTY;
  sources: Link | undefined = undefined;
  sourcesTail: Link | undefined = undefined;
  sourcesCursor: Link | undefined = undefined;
  tracking = false;

  nextScheduled: ReactiveEffect | undefined = undefined;
  scheduled = false;

  private readonly fn: EffectFn;
  private cleanup: EffectCleanup | undefined = undefined;
  private disposed = false;

  constructor(fn: EffectFn) {
    this.fn = fn;
    tagEffect(this);
  }

  recompute(): boolean {
    this.run();
    return false;
  }

  run(): void {
    if (this.disposed) return;
    this.runCleanup();
    const result = runWithTracking(this, this.fn);
    this.state = CLEAN;
    if (typeof result === "function") {
      this.cleanup = result as EffectCleanup;
    }
  }

  private runCleanup(): void {
    const cleanup = this.cleanup;
    if (cleanup !== undefined) {
      this.cleanup = undefined;
      cleanup();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.runCleanup();
    clearSources(this);
    this.state = CLEAN;
    this.scheduled = false;
    this.nextScheduled = undefined;
  }
}

export function effect(fn: EffectFn): EffectHandle {
  const node = new EffectImpl(fn);
  node.run();

  const handle = (() => node.dispose()) as EffectHandle;
  handle.dispose = () => node.dispose();
  flush();
  return handle;
}

export { CLEAN };
