/**
 * The on-demand location channel, held ENTIRELY IN MEMORY.
 *
 * A driver on duty parks one ordinary HTTP request here (`park`). When a parent
 * asks where the bus is (`requestPosition`), that parked request is answered
 * with a `locate` instruction, the driver's phone reads GPS once and posts the
 * position back (`submitPosition`), and the position is handed straight to the
 * waiting parent and dropped.
 *
 * Deliberate properties:
 *   - NOTHING is persisted. No coordinate ever reaches the database, a log or a
 *     cache; a position exists only for the few hundred milliseconds it takes to
 *     travel from `submitPosition` to the parent's response.
 *   - No polling. With nobody asking, the phone never reads GPS.
 *   - Several parents of the same bus asking at once share ONE round-trip to the
 *     driver rather than each waking the phone.
 *
 * Limit: per-process state. Behind more than one instance this must move to a
 * shared broker (Redis pub/sub) so a parent's request reaches whichever process
 * holds that driver's parked request.
 */

export interface BusPosition {
  lat: number;
  lng: number;
  accuracy?: number;
  /** When the driver's phone took the reading (epoch ms). */
  at: number;
}

export type LocateOutcome =
  | { state: 'located'; position: BusPosition }
  /** The driver's app is not holding a request — off duty, backgrounded or no signal. */
  | { state: 'not_on_duty' }
  /** Parked, but no position came back in time. */
  | { state: 'unreachable' };

/** How long a driver's request is parked before it returns empty and re-parks. */
export const PARK_MS = 25_000;
/** How long a parent's request waits for the driver's phone to answer. */
export const LOCATE_TIMEOUT_MS = 10_000;
/** A driver is still "on duty" this long after their last park (covers re-parking). */
const PRESENCE_GRACE_MS = 40_000;

interface Waiter {
  /** Resolves the driver's parked request. */
  resolve: (value: { locate: false } | { locate: true; reqId: string }) => void;
  timer: NodeJS.Timeout;
}

interface PendingLocate {
  reqId: string;
  /** Every parent waiting on this one round-trip. */
  resolvers: ((outcome: LocateOutcome) => void)[];
  timer: NodeJS.Timeout;
}

interface BusEntry {
  waiter?: Waiter;
  pending?: PendingLocate;
  lastParkedAt: number;
}

const buses = new Map<string, BusEntry>();
let seq = 0;

function entry(busId: string): BusEntry {
  const found = buses.get(busId);
  if (found) return found;
  const fresh: BusEntry = { lastParkedAt: 0 };
  buses.set(busId, fresh);
  return fresh;
}

/** True when this bus's driver app is holding (or has just held) a request. */
export function isOnDuty(busId: string): boolean {
  const e = buses.get(busId);
  if (!e) return false;
  return Boolean(e.waiter) || Date.now() - e.lastParkedAt < PRESENCE_GRACE_MS;
}

/**
 * Park the driver's request. Resolves immediately with a `locate` when a parent
 * is already waiting; otherwise after `PARK_MS` with nothing, and the app
 * re-parks. Any previously parked request for the bus is released first, so a
 * reconnecting app never leaves two.
 */
export function park(busId: string, holdMs: number = PARK_MS): Promise<{ locate: false } | { locate: true; reqId: string }> {
  const e = entry(busId);
  e.lastParkedAt = Date.now();

  if (e.waiter) {
    clearTimeout(e.waiter.timer);
    e.waiter.resolve({ locate: false });
    e.waiter = undefined;
  }

  // A parent asked while the app was between parks — answer at once.
  if (e.pending) return Promise.resolve({ locate: true, reqId: e.pending.reqId });

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const cur = buses.get(busId);
      if (cur?.waiter?.timer === timer) cur.waiter = undefined;
      resolve({ locate: false });
    }, holdMs);
    if (typeof timer.unref === 'function') timer.unref();
    e.waiter = { resolve, timer };
  });
}

/**
 * Ask this bus for its position now. Joins an in-flight request when one is
 * already out, so ten parents cost the driver's phone one GPS read.
 */
export function requestPosition(busId: string, timeoutMs: number = LOCATE_TIMEOUT_MS): Promise<LocateOutcome> {
  const e = entry(busId);

  if (e.pending) {
    return new Promise((resolve) => e.pending!.resolvers.push(resolve));
  }
  if (!isOnDuty(busId)) return Promise.resolve({ state: 'not_on_duty' });

  seq += 1;
  const reqId = `${busId}:${String(Date.now())}:${String(seq)}`;

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const cur = buses.get(busId);
      const pending = cur?.pending;
      if (!pending || pending.reqId !== reqId) return;
      cur.pending = undefined;
      for (const r of pending.resolvers) r({ state: 'unreachable' });
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    e.pending = { reqId, resolvers: [resolve], timer };

    // Wake the parked request, if the app is holding one right now.
    if (e.waiter) {
      const { resolve: wake, timer: parkTimer } = e.waiter;
      clearTimeout(parkTimer);
      e.waiter = undefined;
      wake({ locate: true, reqId });
    }
  });
}

/**
 * The driver's phone answering a `locate`. Hands the position to everyone
 * waiting and keeps no copy. Returns false for a reqId that already timed out.
 */
export function submitPosition(busId: string, reqId: string, position: BusPosition): boolean {
  const e = buses.get(busId);
  if (!e?.pending || e.pending.reqId !== reqId) return false;
  const { resolvers, timer } = e.pending;
  clearTimeout(timer);
  e.pending = undefined;
  for (const r of resolvers) r({ state: 'located', position });
  return true;
}

/** Release everything for a bus — called when a trip ends. */
export function clearBus(busId: string): void {
  const e = buses.get(busId);
  if (!e) return;
  if (e.waiter) {
    clearTimeout(e.waiter.timer);
    e.waiter.resolve({ locate: false });
  }
  if (e.pending) {
    clearTimeout(e.pending.timer);
    for (const r of e.pending.resolvers) r({ state: 'not_on_duty' });
  }
  buses.delete(busId);
}

/** Test helper — drops all state so one test's parked request cannot leak into the next. */
export function clearAllDuty(): void {
  for (const busId of [...buses.keys()]) clearBus(busId);
}
