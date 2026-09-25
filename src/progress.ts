import { Model, MetricConfig, familyOf, isPositiveFinite } from "./model";

const DAY_MS = 86_400_000;

export const PROGRESS_SPANS = [
  { key: "6m", label: "6 months", days: 182 },
  { key: "1y", label: "1 year", days: 365 },
  { key: "2y", label: "2 years", days: 730 },
] as const;
export type ProgressSpan = (typeof PROGRESS_SPANS)[number]["key"];

export interface Gain {
  then: Model;
  now: Model;
  thenValue: number;
  nowValue: number;
  /** How many times cheaper or faster it got. */
  ratio: number;
  /** What was measured, since older models only have list price and speed. */
  unit: "task" | "tokens" | "wait" | "tokens/s";
}

export interface Progress {
  sinceMs: number;
  /** The smartest model you could use back then, and the smartest today. */
  thenBest: Model;
  nowBest: Model;
  points: number;
  /** Where the old champion would rank today, counting each release once. */
  thenRankToday: number;
  /** Then-best's level of smarts, bought as cheaply as today allows. */
  cheaper: Gain | null;
  /** Then-best's level of smarts, as fast as today allows. */
  faster: Gain | null;
}

const argBest = <T>(items: T[], score: (t: T) => number) =>
  items.reduce<T | null>((best, t) => (best == null || score(t) > score(best) ? t : best), null);

/**
 * "How far have we come?" answered three ways: the best model got this much
 * smarter, and the best model of back then is now this much cheaper and this
 * much faster to match. The last two are the ones people feel.
 */
export function progressSince(
  models: Model[],
  metric: MetricConfig,
  span: ProgressSpan,
): Progress | null {
  const pool = models.filter((m) => isPositiveFinite(metric.value(m)) && m.releaseMs != null);
  if (!pool.length) return null;
  const newest = Math.max(...pool.map((m) => m.releaseMs!));
  const days = PROGRESS_SPANS.find((s) => s.key === span)!.days;
  const sinceMs = newest - days * DAY_MS;

  const score = (m: Model) => metric.value(m)!;
  const thenBest = argBest(
    pool.filter((m) => m.releaseMs! <= sinceMs),
    score,
  );
  const nowBest = argBest(pool, score);
  if (!thenBest || !nowBest) return null;

  // Everything today that is at least as smart as the old champion.
  const bar = score(thenBest);
  const matches = pool.filter((m) => score(m) >= bar);

  // Lower is better for cost and wait; higher is better for throughput.
  const gain = (
    value: (m: Model) => number | null,
    unit: Gain["unit"],
    higherIsBetter = false,
  ): Gain | null => {
    const thenValue = value(thenBest);
    if (!isPositiveFinite(thenValue)) return null;
    const known = matches.filter((m) => isPositiveFinite(value(m)));
    const now = argBest(known, (m) => (higherIsBetter ? value(m)! : -value(m)!));
    if (!now || now.slug === thenBest.slug) return null;
    const nowValue = value(now)!;
    const ratio = higherIsBetter ? nowValue / thenValue : thenValue / nowValue;
    return ratio > 1 ? { then: thenBest, now, thenValue, nowValue, ratio, unit } : null;
  };

  // One entry per release family (Opus 5.5 is one release, not five effort
  // levels), so "ranks #40" means forty launches, not forty variants.
  const familyBest = new Map<string, number>();
  for (const m of pool) {
    const key = `${m.creator}|${familyOf(m)}`;
    familyBest.set(key, Math.max(familyBest.get(key) ?? 0, score(m)));
  }
  const ownFamily = `${thenBest.creator}|${familyOf(thenBest)}`;
  const thenRankToday =
    1 + [...familyBest].filter(([key, best]) => key !== ownFamily && best > bar).length;

  return {
    sinceMs,
    thenRankToday,
    thenBest,
    nowBest,
    points: score(nowBest) - bar,
    // Per-task cost and wall-clock wait are the honest numbers, but only
    // recent models have them; list price and throughput go back further.
    cheaper: gain((m) => m.costPerTask, "task") ?? gain((m) => m.pricePerMillion, "tokens"),
    faster:
      gain((m) => m.e2eLatency, "wait") ?? gain((m) => m.outputTokensPerSecond, "tokens/s", true),
  };
}
