export const CLEAN = 0 as const;
export const CHECK = 1 as const;
export const DIRTY = 2 as const;
export const RUNNING = 3 as const;

export type NodeState = typeof CLEAN | typeof CHECK | typeof DIRTY | typeof RUNNING;

export interface Link {
  readonly source: Producer;
  readonly target: Consumer;
  version: number;

  nextObserver: Link | undefined;
  prevObserver: Link | undefined;

  nextSource: Link | undefined;
  prevSource: Link | undefined;
}

export interface Producer {
  version: number;
  observers: Link | undefined;
  observersTail: Link | undefined;
}

export interface Consumer {
  state: NodeState;
  sources: Link | undefined;
  sourcesTail: Link | undefined;
  sourcesCursor: Link | undefined;
  tracking: boolean;
  recompute(): boolean;
}

export interface ReactiveEffect extends Consumer {
  isEffect: true;
  nextScheduled: ReactiveEffect | undefined;
  scheduled: boolean;
  run(): void;
}

let active: Consumer | undefined = undefined;
let batchDepth = 0;
let scheduledHead: ReactiveEffect | undefined = undefined;
let scheduledTail: ReactiveEffect | undefined = undefined;
let flushing = false;

export function getActiveConsumer(): Consumer | undefined {
  return active;
}

export function track(src: Producer): void {
  const c = active;
  if (c === undefined || !c.tracking) return;

  const cur = c.sourcesCursor;

  if (cur !== undefined && cur.source === src) {
    cur.version = src.version;
    c.sourcesCursor = cur.nextSource;
    return;
  }

  for (let probe = cur; probe !== undefined; probe = probe.nextSource) {
    if (probe.source === src) {
      moveLinkToCursor(c, probe);
      probe.version = src.version;
      c.sourcesCursor = probe.nextSource;
      return;
    }
  }

  const link = createLink(src, c);
  insertLinkBeforeCursor(c, link);
}

function createLink(source: Producer, target: Consumer): Link {
  return {
    source,
    target,
    version: source.version,
    nextObserver: undefined,
    prevObserver: undefined,
    nextSource: undefined,
    prevSource: undefined,
  };
}

function insertLinkBeforeCursor(c: Consumer, link: Link): void {
  const cur = c.sourcesCursor;
  if (cur === undefined) {
    link.prevSource = c.sourcesTail;
    link.nextSource = undefined;
    if (c.sourcesTail !== undefined) c.sourcesTail.nextSource = link;
    else c.sources = link;
    c.sourcesTail = link;
  } else {
    link.nextSource = cur;
    link.prevSource = cur.prevSource;
    if (cur.prevSource !== undefined) cur.prevSource.nextSource = link;
    else c.sources = link;
    cur.prevSource = link;
  }
  appendObserver(link.source, link);
}

function moveLinkToCursor(c: Consumer, link: Link): void {
  if (link === c.sourcesCursor) return;
  detachFromSourceList(c, link);
  const cur = c.sourcesCursor;
  if (cur === undefined) {
    link.prevSource = c.sourcesTail;
    link.nextSource = undefined;
    if (c.sourcesTail !== undefined) c.sourcesTail.nextSource = link;
    else c.sources = link;
    c.sourcesTail = link;
  } else {
    link.nextSource = cur;
    link.prevSource = cur.prevSource;
    if (cur.prevSource !== undefined) cur.prevSource.nextSource = link;
    else c.sources = link;
    cur.prevSource = link;
  }
}

function appendObserver(src: Producer, link: Link): void {
  link.prevObserver = src.observersTail;
  link.nextObserver = undefined;
  if (src.observersTail !== undefined) src.observersTail.nextObserver = link;
  else src.observers = link;
  src.observersTail = link;
}

function detachFromSourceList(c: Consumer, link: Link): void {
  if (link.prevSource !== undefined) link.prevSource.nextSource = link.nextSource;
  else c.sources = link.nextSource;
  if (link.nextSource !== undefined) link.nextSource.prevSource = link.prevSource;
  else c.sourcesTail = link.prevSource;
  link.prevSource = undefined;
  link.nextSource = undefined;
}

function detachFromObserverList(link: Link): void {
  const src = link.source;
  if (link.prevObserver !== undefined) link.prevObserver.nextObserver = link.nextObserver;
  else src.observers = link.nextObserver;
  if (link.nextObserver !== undefined) link.nextObserver.prevObserver = link.prevObserver;
  else src.observersTail = link.prevObserver;
  link.prevObserver = undefined;
  link.nextObserver = undefined;
}

function destroyLink(c: Consumer, link: Link): void {
  detachFromSourceList(c, link);
  detachFromObserverList(link);
}

export function runWithTracking<T>(c: Consumer, fn: () => T): T {
  const prev = active;
  active = c;
  c.tracking = true;
  c.sourcesCursor = c.sources;
  try {
    return fn();
  } finally {
    c.tracking = false;
    pruneStaleSources(c);
    active = prev;
  }
}

function pruneStaleSources(c: Consumer): void {
  let link = c.sourcesCursor;
  while (link !== undefined) {
    const next = link.nextSource;
    destroyLink(c, link);
    link = next;
  }
  c.sourcesCursor = undefined;
}

export function clearSources(c: Consumer): void {
  let link = c.sources;
  while (link !== undefined) {
    const next = link.nextSource;
    destroyLink(c, link);
    link = next;
  }
  c.sources = undefined;
  c.sourcesTail = undefined;
  c.sourcesCursor = undefined;
}

export function propagate(src: Producer): void {
  for (let link = src.observers; link !== undefined; link = link.nextObserver) {
    markDirty(link.target);
  }
  if (batchDepth === 0) flush();
}

function markDirty(c: Consumer): void {
  if (c.state >= DIRTY) {
    if (isEffect(c)) scheduleEffect(c);
    return;
  }
  c.state = DIRTY;
  markObserversCheck(c);
  if (isEffect(c)) scheduleEffect(c);
}

function markObserversCheck(node: Consumer): void {
  if (!isProducerConsumer(node)) return;
  const producer = node as unknown as Producer;
  for (let link = producer.observers; link !== undefined; link = link.nextObserver) {
    const t = link.target;
    if (t.state === CLEAN) {
      t.state = CHECK;
      markObserversCheck(t);
      if (isEffect(t)) scheduleEffect(t);
    }
  }
}

export function updateIfNecessary(c: Consumer): void {
  if (c.state === CLEAN) return;

  if (c.state === RUNNING) {
    throw new Error("signals: cycle detected — a computed read itself while computing.");
  }

  if (c.state === CHECK) {
    for (let link = c.sources; link !== undefined; link = link.nextSource) {
      const src = link.source;
      const dep = asConsumer(src);
      if (dep !== undefined && dep.state !== CLEAN) {
        updateIfNecessary(dep);
      }
      if (link.version !== src.version) {
        c.state = DIRTY;
        break;
      }
    }
    if (c.state === CHECK) {
      c.state = CLEAN;
      return;
    }
  }

  if (c.state === DIRTY) {
    c.recompute();
  }
}

function scheduleEffect(e: ReactiveEffect): void {
  if (e.scheduled) return;
  e.scheduled = true;
  e.nextScheduled = undefined;
  if (scheduledTail !== undefined) scheduledTail.nextScheduled = e;
  else scheduledHead = e;
  scheduledTail = e;
}

export function flush(): void {
  if (flushing || batchDepth > 0) return;
  flushing = true;
  try {
    while (scheduledHead !== undefined) {
      const e = scheduledHead;
      scheduledHead = e.nextScheduled;
      if (scheduledHead === undefined) scheduledTail = undefined;
      e.nextScheduled = undefined;
      e.scheduled = false;
      if (e.state !== CLEAN) {
        updateIfNecessary(e);
      }
    }
  } finally {
    flushing = false;
  }
}

export function startBatch(): void {
  batchDepth++;
}

export function endBatch(): void {
  if (--batchDepth === 0) flush();
}

export function batch<T>(fn: () => T): T {
  startBatch();
  try {
    return fn();
  } finally {
    endBatch();
  }
}

export function untracked<T>(fn: () => T): T {
  const prev = active;
  active = undefined;
  try {
    return fn();
  } finally {
    active = prev;
  }
}

const PRODUCER_CONSUMER = Symbol("signals.producerConsumer");
const EFFECT = Symbol("signals.effect");

export function tagProducerConsumer(node: object): void {
  (node as Record<symbol, boolean>)[PRODUCER_CONSUMER] = true;
}

export function tagEffect(node: object): void {
  (node as Record<symbol, boolean>)[EFFECT] = true;
}

function isProducerConsumer(node: object): boolean {
  return (node as Record<symbol, boolean>)[PRODUCER_CONSUMER] === true;
}

function isEffect(node: Consumer): node is ReactiveEffect {
  return (node as unknown as Record<symbol, boolean>)[EFFECT] === true;
}

function asConsumer(src: Producer): Consumer | undefined {
  return isProducerConsumer(src) ? (src as unknown as Consumer) : undefined;
}

export function observerCount(src: Producer): number {
  let n = 0;
  for (let link = src.observers; link !== undefined; link = link.nextObserver) n++;
  return n;
}

export function sourceCount(c: Consumer): number {
  let n = 0;
  for (let link = c.sources; link !== undefined; link = link.nextSource) n++;
  return n;
}
