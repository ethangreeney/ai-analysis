import { scaleLog } from "d3-scale";
import data from "./data/models.json";

export interface Model {
  slug: string;
  name: string;
  displayName: string;
  creator: string;
  intelligence: number;
  codingIndex: number | null;
  costPerTask: number | null;
  e2eLatency: number | null;
  reasoningTime: number | null;
  pricePerMillion: number;
  outputTokensPerSecond: number;
  ttft: number;
  releaseDate?: string;
  addedAt?: string;
  /** Derived client-side: releaseDate parsed to epoch ms, null when absent. */
  releaseMs: number | null;
}

interface RawSnapshot {
  fetchedAt: string;
  models: Omit<Model, "releaseMs">[];
}

const raw = data as RawSnapshot;

export const fetchedAtMs = Date.parse(raw.fetchedAt);

export const isPositiveFinite = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

export const allModels: Model[] = raw.models
  .filter((m) => isPositiveFinite(m.intelligence))
  .map((m) => {
    const ms = m.releaseDate ? Date.parse(m.releaseDate) : NaN;
    return { ...m, releaseMs: Number.isFinite(ms) ? ms : null };
  });

export const hasCost = (m: Model) => isPositiveFinite(m.costPerTask);
export const hasLatency = (m: Model) => isPositiveFinite(m.e2eLatency);

export const fmtCost = (c: number | null) =>
  c == null ? "—" : c >= 1000 ? `$${(c / 1000).toFixed(1)}k` : `$${c.toFixed(c >= 10 ? 1 : 2)}`;
export const fmtSeconds = (seconds: number | null) =>
  seconds == null ? "—" : `${seconds.toFixed(1)} s`;
export const fmtSecondsShort = (seconds: number) =>
  seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
/** "1.3×", "2×", "14×" — trailing .0 dropped so multiples read clean. */
export const fmtMultiple = (ratio: number) => {
  const r = ratio >= 10 ? Math.round(ratio).toString() : ratio.toFixed(1).replace(/\.0$/, "");
  return `${r}×`;
};
const fmtScore = (v: number) => Number(v.toFixed(1)).toString();
export const fmtDate = (ms: number | null) =>
  ms == null
    ? "—"
    : new Date(ms).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });

/**
 * One relative comparison fact, shared by the comparison strip and the
 * alternatives shortlist so both always speak the same language. Values are
 * relative (multiples, score deltas) — never raw cents or seconds, which mean
 * nothing out of context.
 */
export interface RelativeStat {
  key: "metric" | "speed" | "cost";
  /** Headline figure: "+3.3", "1.3×", "≈", or "—" when unknowable. */
  value: string;
  /** Reads after the value: "intelligence", "faster", "pricier per task". */
  label: string;
  /** Optional context shown small: "52.7 → 56". */
  detail?: string;
  /** From the challenger's perspective: 1 better, −1 worse, 0 neutral. */
  direction: 1 | 0 | -1;
}

const MINUS = "−";

/** How `to` compares against `from`, all in relative terms. */
export function relativeStats(from: Model, to: Model, metric: MetricConfig): RelativeStat[] {
  const stats: RelativeStat[] = [];

  const a = metric.value(from);
  const b = metric.value(to);
  if (a != null && b != null) {
    const delta = b - a;
    if (Math.abs(delta) < 0.05) {
      stats.push({ key: "metric", value: "≈", label: `same ${metric.noun}`, direction: 0 });
    } else {
      stats.push({
        key: "metric",
        value: `${delta > 0 ? "+" : MINUS}${Math.abs(delta).toFixed(1)}`,
        label: metric.noun,
        detail: `${fmtScore(a)} → ${fmtScore(b)}`,
        direction: delta > 0 ? 1 : -1,
      });
    }
  } else {
    stats.push({ key: "metric", value: "—", label: metric.noun, direction: 0 });
  }

  const ratioStat = (
    key: "speed" | "cost",
    fromV: number | null,
    toV: number | null,
    betterLabel: string, // lower value on `to` reads as this ("faster" / "cheaper per task")
    worseLabel: string,
    sameLabel: string,
    unknownLabel: string,
  ) => {
    if (!isPositiveFinite(fromV) || !isPositiveFinite(toV)) {
      stats.push({ key, value: "—", label: unknownLabel, direction: 0 });
      return;
    }
    const ratio = fromV / toV; // >1 → challenger is lower (better on these axes)
    if (ratio > 0.95 && ratio < 1.05) {
      stats.push({ key, value: "≈", label: sameLabel, direction: 0 });
    } else if (ratio > 1) {
      stats.push({ key, value: fmtMultiple(ratio), label: betterLabel, direction: 1 });
    } else {
      stats.push({ key, value: fmtMultiple(1 / ratio), label: worseLabel, direction: -1 });
    }
  };

  ratioStat("speed", from.e2eLatency, to.e2eLatency, "faster", "slower", "same speed", "speed unknown");
  ratioStat(
    "cost",
    from.costPerTask,
    to.costPerTask,
    "cheaper per task",
    "pricier per task",
    "same cost per task",
    "cost unknown",
  );
  return stats;
}

export type YMetric = "intelligence" | "coding";

export interface MetricConfig {
  label: string;
  rowLabel: string;
  noun: string;
  axisLabel: string;
  defaultMin: number;
  defaultMax: number;
  value: (m: Model) => number | null;
}

export const Y_METRICS: Record<YMetric, MetricConfig> = {
  intelligence: {
    label: "AA Intelligence",
    rowLabel: "Intelligence",
    noun: "intelligence",
    axisLabel: "AA intelligence index",
    defaultMin: 0,
    defaultMax: 65,
    value: (m) => m.intelligence,
  },
  coding: {
    label: "Coding",
    rowLabel: "Coding index",
    noun: "coding score",
    axisLabel: "Coding index",
    defaultMin: 0,
    defaultMax: 80,
    value: (m) => m.codingIndex,
  },
};

export type XMode = "speed" | "cost" | "timeline";

export interface XModeConfig {
  label: string;
  xValue: (m: Model) => number | null;
  colorValue: (m: Model) => number | null;
  colorTitle: string;
  fmtColor: (v: number) => string;
  fmtTick: (v: number) => string;
  xTicks: number[];
  axisTitle: string;
  leftCap: string;
  rightCap: string;
  railCap: string | null;
  /** Recent models without an X value that still show (on the rail) by default. */
  railDefault: (m: Model) => boolean;
  frontierLabel: string;
  frontierNote: (metricNoun: string) => string;
  cutLabel: (v: number) => string;
  subtitle: string;
  footnote: string;
}

export const X_MODES: Record<XMode, XModeConfig> = {
  speed: {
    label: "Speed",
    xValue: (m) => m.e2eLatency,
    colorValue: (m) => m.costPerTask,
    colorTitle: "cost/task",
    fmtColor: (v) => fmtCost(v),
    fmtTick: (v) => `${v}s`,
    xTicks: [5, 10, 30, 100, 200],
    axisTitle: "End-to-end response time",
    leftCap: "← Slower",
    rightCap: "Faster →",
    railCap: "No timing data",
    railDefault: hasCost,
    frontierLabel: "2D frontier",
    frontierNote: (noun) =>
      `This line shows models no other model beats on both ${noun} and speed.`,
    cutLabel: (v) => `Max wait ${fmtSecondsShort(v)}`,
    subtitle:
      "Shows task cost, not token price; end-to-end wait, not tokens/sec. Up is intelligence, right is faster, color is cost.",
    footnote:
      "Default map shows recent releases plus the frontier; priced models without timing data sit on the side rail.",
  },
  cost: {
    label: "Cost",
    xValue: (m) => m.costPerTask,
    colorValue: (m) => m.e2eLatency,
    colorTitle: "wait",
    fmtColor: (v) => fmtSecondsShort(v),
    fmtTick: (v) => (v >= 1 ? `$${v}` : `$${v.toFixed(2)}`),
    xTicks: [0.01, 0.03, 0.1, 0.3, 1, 3, 10, 30],
    axisTitle: "Cost per intelligence-index task",
    leftCap: "← Pricier",
    rightCap: "Cheaper →",
    railCap: "No cost data",
    railDefault: () => false,
    frontierLabel: "2D frontier",
    frontierNote: (noun) =>
      `This line shows models no other model beats on both ${noun} and price.`,
    cutLabel: (v) => `Max ${fmtCost(v)}`,
    subtitle:
      "Shows what a task really costs, not token price. Up is intelligence, right is cheaper per task, color is end-to-end wait.",
    footnote:
      "Default map shows recent releases plus the smart-and-cheap frontier; unpriced models appear on the side rail when searched.",
  },
  timeline: {
    label: "Timeline",
    xValue: (m) => m.releaseMs,
    colorValue: (m) => m.costPerTask,
    colorTitle: "cost/task",
    fmtColor: (v) => fmtCost(v),
    fmtTick: () => "",
    xTicks: [],
    axisTitle: "Release date",
    leftCap: "← Older",
    rightCap: "Newer →",
    railCap: null,
    railDefault: () => false,
    frontierLabel: "record line",
    frontierNote: (noun) =>
      `Each step is the model that raised the all-time ${noun} record when it shipped.`,
    cutLabel: () => "",
    subtitle:
      "Every benchmarked model by release date. Up is intelligence, right is newer, color is task cost.",
    footnote:
      "Every model with a published release date; the dashed line steps through successive record holders.",
  },
};

// Cool→hot gradient (cheap/fast → expensive/slow) with more separation in the
// middle so neighbouring levels read as visibly different.
const RAMP_COLD = [29, 96, 165]; // saturated deep blue
// Deep enough to hold 2.65:1 against the white chart card (validated with the
// dataviz palette checker; the old lighter sand washed out at 1.67:1).
const RAMP_MID = [192, 150, 78]; // warm ochre
const RAMP_HOT = [185, 50, 38]; // saturated deep red
export const NEUTRAL_DOT_COLOR = "#6d7781";
export const NEW_MODEL_COLOR = "#C96442";
export const PICK_COLOR = "#161512";

export function rampColor(t: number): string {
  const u = Math.max(0, Math.min(1, t));
  const lerp = (a: number[], b: number[], k: number) =>
    a.map((v, i) => Math.round(v + (b[i] - v) * k));
  const rgb = u < 0.5 ? lerp(RAMP_COLD, RAMP_MID, u * 2) : lerp(RAMP_MID, RAMP_HOT, (u - 0.5) * 2);
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

// Log scale so multiplicative differences map to even perceptual color steps,
// matching how budgets and wait-times are felt.
export function makeColorNorm([min, max]: [number, number]) {
  const low = min === max ? min * 0.8 : min * 0.9;
  const high = min === max ? max * 1.2 : max * 1.1;
  return scaleLog().domain([low, high]).range([0, 1]).clamp(true);
}

export interface Limits {
  maxWait: number | null;
  maxCost: number | null;
}

export const NO_LIMITS: Limits = { maxWait: null, maxCost: null };

export const limitsActive = (l: Limits) => l.maxWait != null || l.maxCost != null;

/** A model with unknown wait/cost never qualifies under a limit on that axis. */
export const qualifies = (m: Model, l: Limits) =>
  (l.maxWait == null || (isPositiveFinite(m.e2eLatency) && m.e2eLatency <= l.maxWait)) &&
  (l.maxCost == null || (isPositiveFinite(m.costPerTask) && m.costPerTask <= l.maxCost));
