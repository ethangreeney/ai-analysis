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
  /** Which revision of the AA Intelligence Index the scores were taken from. */
  intelligenceIndexVersion?: string | null;
  models: Omit<Model, "releaseMs">[];
}

const raw = data as RawSnapshot;

export const fetchedAtMs = Date.parse(raw.fetchedAt);
export const intelligenceIndexVersion = raw.intelligenceIndexVersion ?? null;

export const isPositiveFinite = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

/**
 * "(max with fallback)" is AA's note that Anthropic's adaptive models fall back
 * to a default when a request can't run at full effort. True, but it doubled the
 * length of every Claude label for a detail no one chooses a model on.
 */
const tidyName = (name: string) =>
  name.replace(/ with fallback\)/, ")").replace(/\s*\(with fallback\)\s*$/, "");

export const allModels: Model[] = raw.models
  .filter((m) => isPositiveFinite(m.intelligence))
  .map((m) => {
    const ms = m.releaseDate ? Date.parse(m.releaseDate) : NaN;
    return {
      ...m,
      displayName: tidyName(m.displayName),
      releaseMs: Number.isFinite(ms) ? ms : null,
    };
  });

const EFFORT = /\s*\(((?:non-)?reasoning(?:, [a-z]+)?|max|xhigh|high|medium|low|minimal)\)\s*$/i;

/**
 * A model's name split into what it is and how hard it's thinking, so labels can
 * set the effort level quieter than the name: "Claude Opus 5.5" + "max".
 */
export function nameParts(m: Model): { base: string; effort: string | null } {
  const match = m.displayName.match(EFFORT);
  if (!match) return { base: m.displayName, effort: null };
  return { base: m.displayName.slice(0, match.index).trim(), effort: match[1].toLowerCase() };
}

/** The release a variant belongs to: "GPT-6 Sol (high)" → "GPT-6 Sol". */
export const familyOf = (m: Model) => m.displayName.replace(/\s*\([^)]*\)\s*$/, "").trim();

export const hasCost = (m: Model) => isPositiveFinite(m.costPerTask);
export const hasLatency = (m: Model) => isPositiveFinite(m.e2eLatency);

export const fmtCost = (c: number | null) =>
  c == null ? "—" : c >= 1000 ? `$${(c / 1000).toFixed(1)}k` : `$${c.toFixed(c >= 10 ? 1 : 2)}`;
export const fmtSeconds = (seconds: number | null) =>
  seconds == null ? "—" : `${seconds.toFixed(1)} s`;
export const fmtSecondsShort = (seconds: number) =>
  seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
/** "0.06×", "0.6×", "1.3×", "14×" — trailing .0 dropped so multiples read clean. */
export const fmtMultiple = (ratio: number) => {
  const r =
    ratio >= 10
      ? Math.round(ratio).toString()
      : ratio >= 0.095
        ? ratio.toFixed(1).replace(/\.0$/, "")
        : ratio.toFixed(2).replace(/0$/, "");
  return `${r}×`;
};
/** Money the way people say it: 11¢, $3.44. */
export const fmtMoney = (v: number) => (v < 1 ? `${Math.max(1, Math.round(v * 100))}¢` : `$${v.toFixed(2)}`);
/** "GPT-6 Sol max": the name without the brackets. */
export const shortName = (m: Model) => {
  const { base, effort } = nameParts(m);
  return effort ? `${base} ${effort}` : base;
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
  /** Reads after the value: "intelligence", "faster", "the cost per task". */
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

  // Cost reads as a plain multiple of what you pay now — "0.6× the cost" is
  // instantly graspable where "1.6× cheaper" makes people do division.
  if (!isPositiveFinite(from.costPerTask) || !isPositiveFinite(to.costPerTask)) {
    stats.push({ key: "cost", value: "—", label: "cost unknown", direction: 0 });
  } else {
    const costRatio = to.costPerTask / from.costPerTask;
    if (costRatio > 0.95 && costRatio < 1.05) {
      stats.push({ key: "cost", value: "≈", label: "same cost per task", direction: 0 });
    } else {
      stats.push({
        key: "cost",
        value: fmtMultiple(costRatio),
        label: "the cost per task",
        direction: costRatio < 1 ? 1 : -1,
      });
    }
  }
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
  /** Band edges for the colour, cheap/fast → pricey/slow. Five even-ish
      groups on the current field, in round numbers people can repeat. */
  bands: number[];
  bandLabels: string[];
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
  subtitle: string;
  footnote: string;
}

export const X_MODES: Record<XMode, XModeConfig> = {
  speed: {
    label: "Speed",
    xValue: (m) => m.e2eLatency,
    colorValue: (m) => m.costPerTask,
    colorTitle: "Cost per task",
    fmtColor: (v) => fmtCost(v),
    bands: [0.1, 0.3, 1, 3],
    bandLabels: ["Under 10¢", "10–30¢", "30¢–$1", "$1–3", "Over $3"],
    fmtTick: (v) => `${v}s`,
    xTicks: [5, 10, 30, 100, 200],
    axisTitle: "End-to-end response time",
    leftCap: "← Slower",
    rightCap: "Faster →",
    railCap: "Not timed yet",
    railDefault: hasCost,
    frontierLabel: "2D frontier",
    frontierNote: (noun) =>
      `This line shows models no other model beats on both ${noun} and speed.`,
    subtitle:
      "Shows task cost, not token price; end-to-end wait, not tokens/sec. Up is intelligence, right is faster, color is cost.",
    footnote:
      "Default map shows recent releases plus the frontier; priced models without timing data sit on the side rail.",
  },
  cost: {
    label: "Cost",
    xValue: (m) => m.costPerTask,
    colorValue: (m) => m.e2eLatency,
    colorTitle: "Wait",
    fmtColor: (v) => fmtSecondsShort(v),
    bands: [10, 20, 45, 90],
    bandLabels: ["Under 10s", "10–20s", "20–45s", "45–90s", "Over 90s"],
    fmtTick: (v) => (v >= 1 ? `$${v}` : `$${v.toFixed(2)}`),
    xTicks: [0.01, 0.03, 0.1, 0.3, 1, 3, 10, 30],
    axisTitle: "Cost per intelligence-index task",
    leftCap: "← Pricier",
    rightCap: "Cheaper →",
    railCap: "No cost yet",
    railDefault: () => false,
    frontierLabel: "2D frontier",
    frontierNote: (noun) =>
      `This line shows models no other model beats on both ${noun} and price.`,
    subtitle:
      "Shows what a task really costs, not token price. Up is intelligence, right is cheaper per task, color is end-to-end wait.",
    footnote:
      "Default map shows recent releases plus the smart-and-cheap frontier; unpriced models appear on the side rail when searched.",
  },
  timeline: {
    label: "Timeline",
    xValue: (m) => m.releaseMs,
    colorValue: (m) => m.costPerTask,
    colorTitle: "Cost per task",
    fmtColor: (v) => fmtCost(v),
    bands: [0.1, 0.3, 1, 3],
    bandLabels: ["Under 10¢", "10–30¢", "30¢–$1", "$1–3", "Over $3"],
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
export const NEW_MODEL_COLOR = "#0e0f11";

/**
 * Colour is who made it. It's the first thing people look for on a map like
 * this ("where's OpenAI?"), and one meaning everywhere beats a cost ramp that
 * turned forty dots the same terracotta. Fixed order, never cycled; checked
 * for colour-blind separation in OKLab (every pair ≥ 16.5 for normal vision,
 * worst simulated pair 6.8, backed by labels and the legend).
 */
export const LABS: { name: string; color: string }[] = [
  { name: "OpenAI", color: "#10a37f" },
  { name: "Anthropic", color: "#e0662f" },
  { name: "Google", color: "#2d5bd2" },
  { name: "SpaceXAI", color: "#24272c" },
  { name: "Meta", color: "#b760d8" },
  { name: "DeepSeek", color: "#56b4e9" },
  { name: "Alibaba", color: "#ebb526" },
];
export const OTHER_LAB_COLOR = "#c3c7cd";

/**
 * The third dimension: five bands from cheap (cool) to pricey (warm). Bands
 * instead of a smooth ramp, because most frontier models sit in one narrow
 * price range and a continuous ramp painted them all the same orange.
 * Adjacent steps checked for colour-blind separation (all ≥ 14.7 in OKLab).
 */
export const BAND_COLORS = ["#1f5aa6", "#4fa3cf", "#dfbd52", "#e0692a", "#a82a2a"];
export const NO_DATA_COLOR = "#d3d6da";
export const bandIndex = (value: number, edges: number[]) => {
  const i = edges.findIndex((edge) => value < edge);
  return i === -1 ? edges.length : i;
};
export type ColorBy = "value" | "lab";
const LAB_COLOR = new Map(LABS.map((l) => [l.name, l.color]));
export const labColor = (creator: string) => LAB_COLOR.get(creator) ?? OTHER_LAB_COLOR;

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

