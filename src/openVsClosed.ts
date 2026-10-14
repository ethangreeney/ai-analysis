import { Model, MetricConfig, isPositiveFinite } from "./model";

const MONTH_MS = 30.44 * 86_400_000;

export interface SideGain {
  /** The cheapest (or fastest) model on each side that reaches the level. */
  open: Model;
  closed: Model;
  /** closed ÷ open: above 1 means open is cheaper or faster. */
  ratio: number;
}

export interface OpenVsClosed {
  bestOpen: Model;
  bestClosed: Model;
  /** Best closed minus best open, in metric points. */
  points: number;
  /** The first closed model to reach the best open model's level. */
  caughtUp: Model | null;
  /** How long after that closed model the open one arrived. */
  lagMonths: number | null;
  /** The same lag measured a year earlier, to say if the gap is closing. */
  lagYearAgo: number | null;
  /** At the best open model's level: who does it for less, and faster. */
  cost: SideGain | null;
  speed: SideGain | null;
}

const argMax = <T>(items: T[], score: (t: T) => number) =>
  items.reduce<T | null>((best, t) => (best == null || score(t) > score(best) ? t : best), null);

/**
 * "Where are open models at?" in four answers: how far behind the best closed
 * model they are, how many months of progress that is, and whether, at the
 * level they've reached, open is cheaper or faster than closed.
 */
export function openVsClosed(models: Model[], metric: MetricConfig): OpenVsClosed | null {
  const scored = models.filter((m) => isPositiveFinite(metric.value(m)) && m.releaseMs != null);
  const score = (m: Model) => metric.value(m)!;
  const open = scored.filter((m) => m.openWeights === true);
  const closed = scored.filter((m) => m.openWeights === false);
  const bestOpen = argMax(open, score);
  const bestClosed = argMax(closed, score);
  if (!bestOpen || !bestClosed) return null;

  // The lag: how long ago closed models first reached open's best.
  const lag = (asOf: number) => {
    const openThen = argMax(open.filter((m) => m.releaseMs! <= asOf), score);
    if (!openThen) return null;
    const first = closed
      .filter((m) => score(m) >= score(openThen))
      .sort((a, b) => a.releaseMs! - b.releaseMs!)[0];
    if (!first) return null;
    return { first, months: Math.max(0, (openThen.releaseMs! - first.releaseMs!) / MONTH_MS) };
  };
  const now = lag(Infinity);
  const newest = Math.max(...scored.map((m) => m.releaseMs!));
  const yearAgo = lag(newest - 12 * MONTH_MS);

  // At the level open has reached, the cheapest / fastest way to get there on
  // each side. Lower is better for both cost and wait.
  const level = score(bestOpen);
  const gain = (value: (m: Model) => number | null): SideGain | null => {
    const lowest = (side: Model[]) =>
      side
        .filter((m) => score(m) >= level && isPositiveFinite(value(m)))
        .reduce<Model | null>((best, m) => (!best || value(m)! < value(best)! ? m : best), null);
    const o = lowest(open);
    const c = lowest(closed);
    return o && c ? { open: o, closed: c, ratio: value(c)! / value(o)! } : null;
  };

  return {
    bestOpen,
    bestClosed,
    points: score(bestClosed) - score(bestOpen),
    caughtUp: now?.first ?? null,
    lagMonths: now?.months ?? null,
    lagYearAgo: yearAgo?.months ?? null,
    cost: gain((m) => m.costPerTask),
    speed: gain((m) => m.e2eLatency),
  };
}
