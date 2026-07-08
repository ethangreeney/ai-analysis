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
export const fmtDate = (ms: number | null) =>
  ms == null
    ? "—"
    : new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

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
    axisLabel: "AA INTELLIGENCE INDEX",
    defaultMin: 0,
    defaultMax: 65,
    value: (m) => m.intelligence,
  },
  coding: {
    label: "Coding",
    rowLabel: "Coding index",
    noun: "coding score",
    axisLabel: "CODING INDEX",
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
    axisTitle: "END-TO-END RESPONSE TIME",
    leftCap: "← SLOWER",
    rightCap: "FASTER →",
    railCap: "TIMING N/A",
    railDefault: hasCost,
    frontierLabel: "2D frontier",
    frontierNote: (noun) =>
      `This line shows models no other model beats on both ${noun} and speed.`,
    cutLabel: (v) => `MAX WAIT ${fmtSecondsShort(v).toUpperCase()}`,
    subtitle:
      "Shows task cost, not token price; end-to-end wait, not tokens/sec. Up is intelligence, right is faster, color is cost.",
    footnote:
      "Default map shows recent releases plus the frontier; priced untimed models sit on the timing n/a rail.",
  },
  cost: {
    label: "Cost",
    xValue: (m) => m.costPerTask,
    colorValue: (m) => m.e2eLatency,
    colorTitle: "wait",
    fmtColor: (v) => fmtSecondsShort(v),
    fmtTick: (v) => (v >= 1 ? `$${v}` : `$${v.toFixed(2)}`),
    xTicks: [0.01, 0.03, 0.1, 0.3, 1, 3, 10, 30],
    axisTitle: "COST PER INTELLIGENCE INDEX TASK",
    leftCap: "← PRICIER",
    rightCap: "CHEAPER →",
    railCap: "COST N/A",
    railDefault: () => false,
    frontierLabel: "2D frontier",
    frontierNote: (noun) =>
      `This line shows models no other model beats on both ${noun} and price.`,
    cutLabel: (v) => `MAX ${fmtCost(v).toUpperCase()}`,
    subtitle:
      "Shows what a task really costs, not token price. Up is intelligence, right is cheaper per task, color is end-to-end wait.",
    footnote:
      "Default map shows recent releases plus the smart-and-cheap frontier; unpriced models appear on the cost n/a rail when searched.",
  },
  timeline: {
    label: "Timeline",
    xValue: (m) => m.releaseMs,
    colorValue: (m) => m.costPerTask,
    colorTitle: "cost/task",
    fmtColor: (v) => fmtCost(v),
    fmtTick: () => "",
    xTicks: [],
    axisTitle: "RELEASE DATE",
    leftCap: "← OLDER",
    rightCap: "NEWER →",
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
const RAMP_MID = [222, 195, 138]; // warm sand
const RAMP_HOT = [185, 50, 38]; // saturated deep red
export const NEUTRAL_DOT_COLOR = "#6d7781";
export const NEW_MODEL_COLOR = "#C96442";
export const PICK_COLOR = "#0a0a0a";

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
