import { useEffect, useMemo, useRef, useState } from "react";
import { MapChart } from "./MapChart";
import {
  Model,
  YMetric,
  XMode,
  Y_METRICS,
  X_MODES,
  Limits,
  NO_LIMITS,
  RelativeStat,
  relativeStats,
  allModels,
  fetchedAtMs,
  fmtCost,
  fmtDate,
  fmtSeconds,
  fmtSecondsShort,
  isPositiveFinite,
  limitsActive,
  makeColorNorm,
  qualifies,
  rampColor,
  NEUTRAL_DOT_COLOR,
  NEW_MODEL_COLOR,
} from "./model";

const RECENT_WINDOW_MONTHS = 6;
const DAY_MS = 86_400_000;
const REPO_URL = "https://github.com/ethangreeney/ai-analysis";
const CARD_SHADOW = "0 1px 3px rgba(23,20,10,0.04), 0 8px 24px rgba(23,20,10,0.04)";
const SAGE = { background: "#eaeee2", color: "#5b6b4c" };

const dataRange = (values: (number | null)[]): [number, number] => {
  const v = values.filter(isPositiveFinite);
  return v.length ? [Math.min(...v) * 0.9, Math.max(...v) * 1.1] : [1, 10];
};
const WAIT_RANGE = dataRange(allModels.map((m) => m.e2eLatency));
const COST_RANGE = dataRange(allModels.map((m) => m.costPerTask));

const fmtIndex = (v: number | null) => (v == null ? "—" : v.toFixed(1));

type RecommendationTier = "clear" | "near" | "tradeoff";

interface Recommendation {
  model: Model;
  tier: RecommendationTier;
  score: number;
}

/** One-line version of the same relative facts the hero shows, for tight rows. */
const compactStats = (stats: RelativeStat[]) =>
  stats
    .filter((stat) => stat.value !== "—")
    .map((stat) => (stat.value === "≈" ? stat.label : `${stat.value} ${stat.label}`))
    .join(" · ");

// Shareable state lives in the URL hash: #y=coding&x=cost&q=claude&wait=30&cost=1
function readHash() {
  const p = new URLSearchParams(window.location.hash.slice(1));
  const y: YMetric = p.get("y") === "coding" ? "coding" : "intelligence";
  const xRaw = p.get("x");
  const x: XMode = xRaw === "cost" || xRaw === "timeline" ? xRaw : "speed";
  const q = p.get("q") ?? "";
  const wait = Number.parseFloat(p.get("wait") ?? "");
  const cost = Number.parseFloat(p.get("cost") ?? "");
  const maxWait = Number.isFinite(wait) && wait > 0 ? wait : null;
  const maxCost = Number.isFinite(cost) && cost > 0 ? cost : null;
  const knownSlugs = new Set(allModels.map((m) => m.slug));
  const from = p.get("from");
  const to = p.get("to");
  const comparedSlugs: string[] = [];
  if (from != null && knownSlugs.has(from)) {
    comparedSlugs.push(from);
    if (to != null && to !== from && knownSlugs.has(to)) comparedSlugs.push(to);
  }
  return {
    y,
    x,
    q,
    maxWait,
    maxCost,
    limitsOn: maxWait != null || maxCost != null,
    comparedSlugs,
  };
}
const initial = readHash();

const trimNum = (v: number) => String(Number(v.toPrecision(3)));

/** A model in the hero row: ramp dot, quiet role, name. */
function ModelChip({
  role,
  model,
  color,
  onRemove,
}: {
  role: string;
  model: Model;
  color: string;
  onRemove: () => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-full border border-ink-100 bg-paper py-1.5 pl-2.5 pr-1.5">
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-card"
        style={{ background: color }}
        aria-hidden
      />
      <span className="comparison-mobile-hide shrink-0 text-[11px] text-ink-500">{role}</span>
      <span className="comparison-mobile-hide shrink-0 text-ink-300" aria-hidden>
        ·
      </span>
      <span className="truncate text-[12.5px] font-semibold leading-tight text-ink-900">
        {model.displayName}
      </span>
      <button
        onClick={onRemove}
        aria-label={`Remove ${model.displayName}`}
        className="tap-target-square flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[14px] leading-none text-ink-300 transition-colors hover:bg-ink-100 hover:text-ink-900"
      >
        ×
      </button>
    </div>
  );
}

/** Big relative figure, quiet label underneath. Built to be screenshotted. */
function StatBlock({ stat }: { stat: RelativeStat }) {
  const unknown = stat.value === "—";
  return (
    <div className="min-w-0">
      <div
        className={`text-[20px] font-semibold leading-none tabular-nums ${
          unknown ? "text-ink-300" : "text-ink-900"
        }`}
      >
        {stat.value}
      </div>
      <div
        className={`mt-1.5 text-[11px] leading-snug ${unknown ? "text-ink-300" : "text-ink-500"}`}
      >
        {stat.label}
        {stat.detail && (
          <span className="comparison-mobile-hide">
            <span className="text-ink-300"> · </span>
            <span className="tabular-nums text-ink-300">{stat.detail}</span>
          </span>
        )}
      </div>
    </div>
  );
}

function ModelPicker({ models, onSelect }: { models: Model[]; onSelect: (slug: string) => void }) {
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => {
    const query = value.trim().toLowerCase();
    const matches = query
      ? models.filter(
          (model) =>
            model.displayName.toLowerCase().includes(query) ||
            model.creator.toLowerCase().includes(query),
        )
      : models;
    return matches.slice(0, 7);
  }, [models, value]);

  // Opening the picker is the whole point of "Find alternatives" — land the
  // caret in it without a second click, even when autoFocus loses the race.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
      <input
        ref={inputRef}
        autoFocus
        type="text"
        value={value}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setValue(event.target.value);
          setOpen(true);
          setActiveIndex(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            setOpen(false);
          } else if (event.key === "ArrowDown" && results.length) {
            event.preventDefault();
            setOpen(true);
            setActiveIndex((index) => Math.min(index + 1, results.length - 1));
          } else if (event.key === "ArrowUp" && results.length) {
            event.preventDefault();
            setOpen(true);
            setActiveIndex((index) => Math.max(index - 1, 0));
          } else if (event.key === "Enter" && open && results[activeIndex]) {
            event.preventDefault();
            onSelect(results[activeIndex].slug);
            setOpen(false);
          }
        }}
        placeholder="Which model do you use now?"
        aria-label="Choose the model you use now"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls="current-model-options"
        aria-activedescendant={
          open && results[activeIndex] ? `model-option-${results[activeIndex].slug}` : undefined
        }
        className="tap-target h-9 w-full rounded-full border border-ink-300 bg-card px-3.5 text-[12.5px] text-ink-900 placeholder:text-ink-300 focus:border-ink-900 focus:outline-none"
      />
      {open && (
        <div
          id="current-model-options"
          role="listbox"
          className="model-picker-menu absolute left-0 top-full z-40 mt-2 max-h-64 w-[calc(100vw-2rem)] max-w-80 overflow-y-auto rounded-xl border border-ink-100 bg-card p-1.5"
          style={{ boxShadow: "0 1px 2px rgba(23,20,10,0.05), 0 16px 40px rgba(23,20,10,0.10)" }}
        >
          {results.length ? (
            results.map((model, index) => (
              <button
                key={model.slug}
                id={`model-option-${model.slug}`}
                role="option"
                aria-selected={index === activeIndex}
                tabIndex={-1}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => {
                  onSelect(model.slug);
                  setOpen(false);
                }}
                className={`tap-target flex w-full items-baseline justify-between gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${
                  index === activeIndex ? "bg-ink-50" : "hover:bg-ink-50"
                }`}
              >
                <span className="text-[12px] font-medium leading-tight text-ink-900">
                  {model.displayName}
                </span>
                <span className="shrink-0 text-[11px] text-ink-300">{model.creator}</span>
              </button>
            ))
          ) : (
            <div className="px-2.5 py-3 text-[12px] text-ink-500">No matching model</div>
          )}
        </div>
      )}
    </div>
  );
}

function AlternativesPanel({
  baseline,
  alternatives,
  selectedSlug,
  yMetric,
  onSelect,
}: {
  baseline: Model;
  alternatives: Recommendation[];
  selectedSlug: string | null;
  yMetric: YMetric;
  onSelect: (slug: string) => void;
}) {
  const metric = Y_METRICS[yMetric];
  return (
    <aside className="alternatives-panel hidden xl:flex w-[19.5rem] shrink-0 flex-col self-stretch overflow-y-auto border-l border-ink-100 px-4 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[13px] font-semibold leading-none text-ink-900">Top alternatives</h2>
        <span className="text-[11px] text-ink-300">Best first</span>
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-ink-500">
        Compared with {baseline.displayName}.
      </p>
      <div className="mt-2.5 divide-y divide-ink-100">
        {alternatives.length ? (
          alternatives.map(({ model, tier }, index) => {
            const selected = model.slug === selectedSlug;
            const summary = compactStats(relativeStats(baseline, model, metric));
            return (
              <button
                key={model.slug}
                onClick={() => onSelect(model.slug)}
                aria-pressed={selected}
                aria-label={`Compare ${baseline.displayName} with ${model.displayName}`}
                className={`alternative-row -mx-2 w-[calc(100%+1rem)] rounded-lg px-2 py-2.5 text-left transition-colors ${
                  selected ? "bg-ink-50" : "hover:bg-ink-50"
                }`}
                style={{ animationDelay: `${40 + index * 28}ms` }}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="w-3 shrink-0 text-[11px] tabular-nums text-ink-300">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold leading-tight text-ink-900">
                    {model.displayName}
                  </span>
                  {tier !== "tradeoff" && (
                    <span
                      className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none"
                      style={tier === "clear" ? SAGE : { background: "#f2f0eb", color: "#6f6b63" }}
                    >
                      {tier === "clear" ? "Clear upgrade" : "Small tradeoff"}
                    </span>
                  )}
                </div>
                <div className="mt-1 pl-5 text-[11px] leading-snug tabular-nums text-ink-500">
                  {summary || "Comparable benchmark data"}
                </div>
              </button>
            );
          })
        ) : (
          <div className="rounded-lg bg-ink-50 px-3 py-3 text-[12px] leading-snug text-ink-500">
            No close alternatives have enough comparable data in this view.
          </div>
        )}
      </div>
    </aside>
  );
}

/** Pill segmented control: white active segment on the warm ink-50 track. */
function SegmentSwitch<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex w-fit items-center gap-0.5 rounded-full bg-ink-50 p-0.5"
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          aria-pressed={value === opt.value}
          className={`tap-target rounded-full px-3 py-1.5 text-[12px] leading-none transition-colors ${
            value === opt.value
              ? "border border-ink-100 bg-card font-semibold text-ink-900 shadow-[0_1px_2px_rgba(23,20,10,0.06)]"
              : "border border-transparent text-ink-500 hover:text-ink-900"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function FrontierLegend({ label, note }: { label: string; note: string }) {
  return (
    <div className="relative group flex items-center gap-2 cursor-help">
      <svg width="32" height="6" className="shrink-0" aria-hidden>
        <line
          x1="1"
          y1="3"
          x2="31"
          y2="3"
          stroke="#b5b1a8"
          strokeWidth="1.25"
          strokeDasharray="3 3"
          strokeLinecap="round"
        />
      </svg>
      <span className="text-[11.5px] text-ink-700 underline decoration-dotted decoration-ink-300 underline-offset-[3px]">
        {label}
      </span>
      <div
        className="invisible opacity-0 group-hover:visible group-hover:opacity-100 absolute top-full right-0 mt-2 w-64 bg-card border border-ink-100 rounded-xl px-3 py-2 text-[11.5px] text-ink-700 leading-snug z-30 transition-opacity duration-150"
        style={{ boxShadow: CARD_SHADOW }}
      >
        {note}
      </div>
    </div>
  );
}

// Color legend — low (blue) end labeled with the data minimum, high (red)
// end with the maximum, so the ramp can be decoded to actual values.
function ColorLegend({
  title,
  domain,
  fmt,
}: {
  title: string;
  domain: [number, number];
  fmt: (v: number) => string;
}) {
  const stops = [0, 0.25, 0.5, 0.75, 1].map((t) => rampColor(t));
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11.5px] text-ink-700">{title}</span>
      <span className="text-[11px] tabular-nums text-ink-500">{fmt(domain[0])}</span>
      <div
        className="h-2 w-32 rounded-full"
        style={{ background: `linear-gradient(to right, ${stops.join(", ")})` }}
      />
      <span className="text-[11px] tabular-nums text-ink-500">{fmt(domain[1])}</span>
    </div>
  );
}

function HoverCard({ m, yMetric, caption }: { m: Model; yMetric: YMetric; caption?: string }) {
  const active = Y_METRICS[yMetric];
  const other = Y_METRICS[yMetric === "intelligence" ? "coding" : "intelligence"];
  const rows = [
    { label: active.rowLabel, value: fmtIndex(active.value(m)) },
    ...(isPositiveFinite(other.value(m))
      ? [{ label: other.rowLabel, value: fmtIndex(other.value(m)) }]
      : []),
    { label: "Cost per task", value: fmtCost(m.costPerTask) },
    { label: "End-to-end response time", value: fmtSeconds(m.e2eLatency) },
    { label: "Released", value: fmtDate(m.releaseMs) },
  ];

  return (
    <div
      className="pointer-events-none absolute top-3 right-3 w-[18.5rem] rounded-xl border border-ink-100 bg-card/95 px-4 py-3.5 text-ink-900 z-20 backdrop-blur"
      style={{ boxShadow: "0 1px 2px rgba(23,20,10,0.04), 0 18px 48px rgba(23,20,10,0.10)" }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-[11.5px] text-ink-500">{m.creator}</div>
        {caption && (
          <div className="rounded-full bg-ink-50 px-2 py-0.5 text-[10.5px] font-medium leading-none text-ink-700">
            {caption}
          </div>
        )}
      </div>
      <div className="mt-1.5 text-[15px] font-semibold leading-tight text-ink-900">
        {m.displayName}
      </div>
      <div className="mt-3 divide-y divide-ink-100 text-[12px]">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-baseline justify-between gap-5 py-2 first:pt-0 last:pb-0"
          >
            <span className="text-ink-500">{row.label}</span>
            <span className="font-semibold tabular-nums text-ink-900">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Search — spotlight matching models, dim the rest.
function SearchBox({
  value,
  onChange,
  matchCount,
  offViewCount,
}: {
  value: string;
  onChange: (v: string) => void;
  matchCount: number | null;
  offViewCount: number;
}) {
  const active = value.trim().length > 0;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
      <div className="relative min-w-0 flex-1 sm:flex-none">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#b5b1a8"
          strokeWidth="2.4"
          aria-hidden
        >
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.5" y2="16.5" strokeLinecap="round" />
        </svg>
        <input
          type="text"
          name="model-search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && active) {
              event.stopPropagation();
              onChange("");
            }
          }}
          placeholder="Search models…"
          aria-label="Search models"
          className="h-8 w-full rounded-full border border-ink-100 bg-card pl-8 pr-8 text-[12px] text-ink-900 placeholder:text-ink-300 transition-colors focus:border-ink-300 focus:outline-none sm:w-44"
        />
        {active && (
          <button
            onClick={() => onChange("")}
            aria-label="Clear search"
            className="absolute right-0 top-0 flex h-full w-8 items-center justify-center text-[14px] leading-none text-ink-300 hover:text-ink-700"
          >
            ×
          </button>
        )}
      </div>
      {active && (
        <span
          aria-live="polite"
          className="hidden sm:inline text-[11px] tabular-nums text-ink-500 whitespace-nowrap"
        >
          {matchCount} {matchCount === 1 ? "match" : "matches"}
          {offViewCount > 0 && <span className="text-ink-300"> · {offViewCount} off view</span>}
        </span>
      )}
    </div>
  );
}

// One limit knob: log-mapped slider where the far right means "any".
function LimitSlider({
  label,
  range,
  value,
  onChange,
  fmt,
}: {
  label: string;
  range: [number, number];
  value: number | null;
  onChange: (v: number | null) => void;
  fmt: (v: number) => string;
}) {
  const [lo, hi] = range;
  const t = value == null ? 1 : Math.max(0, Math.min(1, Math.log(value / lo) / Math.log(hi / lo)));
  return (
    <label className="flex items-center gap-2">
      <span className="text-[11.5px] text-ink-500 whitespace-nowrap">{label}</span>
      <input
        type="range"
        name={label}
        min={0}
        max={1}
        step={0.005}
        value={t}
        onChange={(e) => {
          const u = Number.parseFloat(e.target.value);
          onChange(u >= 1 ? null : lo * Math.pow(hi / lo, u));
        }}
        className="limit tap-target w-28 sm:w-32"
        aria-label={label}
        aria-valuetext={value == null ? "Any" : fmt(value)}
      />
      <span className="w-12 text-[11.5px] font-medium tabular-nums text-ink-900">
        {value == null ? "any" : fmt(value)}
      </span>
    </label>
  );
}

export default function App() {
  const [yMetric, setYMetric] = useState<YMetric>(initial.y);
  const [xMode, setXMode] = useState<XMode>(initial.x);
  const [hoveredSlug, setHoveredSlug] = useState<string | null>(null);
  const [query, setQuery] = useState(initial.q);
  const [limitsOn, setLimitsOn] = useState(initial.limitsOn);
  const [maxWait, setMaxWait] = useState<number | null>(initial.maxWait);
  const [maxCost, setMaxCost] = useState<number | null>(initial.maxCost);
  const [comparisonOn, setComparisonOn] = useState(initial.comparedSlugs.length > 0);
  const [comparedSlugs, setComparedSlugs] = useState<string[]>(initial.comparedSlugs);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [optionsOn, setOptionsOn] = useState(initial.y !== "intelligence" || initial.limitsOn);
  const chartScrollRef = useRef<HTMLDivElement>(null);

  const metric = Y_METRICS[yMetric];
  const xc = X_MODES[xMode];
  const timeline = xMode === "timeline";

  const metricModels = useMemo(
    () => allModels.filter((m) => isPositiveFinite(metric.value(m))),
    [metric],
  );
  const viewModels = useMemo(
    () => metricModels.filter((m) => !timeline || m.releaseMs != null),
    [metricModels, timeline],
  );
  const comparedModels = useMemo(
    () =>
      comparedSlugs
        .map((slug) => allModels.find((m) => m.slug === slug))
        .filter((m): m is Model => m != null),
    [comparedSlugs],
  );
  const baselineModel = comparedModels[0] ?? null;
  const candidateModel = comparedModels[1] ?? null;

  // Rank obvious replacements before bounded tradeoffs. Near-equal price and
  // latency bands reflect the precision at which these task metrics matter.
  const recommendations = useMemo<Recommendation[]>(() => {
    if (!baselineModel || !viewModels.some((m) => m.slug === baselineModel.slug)) return [];
    const baselineMetric = metric.value(baselineModel);
    if (!isPositiveFinite(baselineMetric)) return [];
    const baselineHasSpeed = isPositiveFinite(baselineModel.e2eLatency);
    const baselineHasCost = isPositiveFinite(baselineModel.costPerTask);
    const comparableDimensions = 1 + Number(baselineHasSpeed) + Number(baselineHasCost);
    const speedWeight = xMode === "speed" ? 1 : xMode === "cost" ? 0.45 : 0.65;
    const costWeight = xMode === "cost" ? 1 : xMode === "speed" ? 0.45 : 0.65;
    const scored = viewModels.flatMap((model) => {
      if (model.slug === baselineModel.slug) return [];
      const modelMetric = metric.value(model);
      if (!isPositiveFinite(modelMetric) || modelMetric < baselineMetric - 6) return [];

      const canCompareSpeed = baselineHasSpeed && isPositiveFinite(model.e2eLatency);
      const canCompareCost = baselineHasCost && isPositiveFinite(model.costPerTask);
      if (
        (baselineHasSpeed && !canCompareSpeed) ||
        (baselineHasCost && !canCompareCost) ||
        (xMode === "speed" && !canCompareSpeed) ||
        (xMode === "cost" && !canCompareCost)
      ) {
        return [];
      }

      const metricDelta = modelMetric - baselineMetric;
      const speedDelta = canCompareSpeed
        ? Math.log(baselineModel.e2eLatency! / model.e2eLatency!)
        : 0;
      const costDelta = canCompareCost
        ? Math.log(baselineModel.costPerTask! / model.costPerTask!)
        : 0;
      const newerDelta =
        timeline && baselineModel.releaseMs != null && model.releaseMs != null
          ? (model.releaseMs - baselineModel.releaseMs) / (365 * DAY_MS)
          : 0;
      const hasImprovement =
        metricDelta > 0.5 ||
        speedDelta > Math.log(1.08) ||
        costDelta > Math.log(1.08) ||
        newerDelta > 0.1;
      const extremeSpeedTradeoff = speedDelta < -Math.log(6);
      const extremeCostTradeoff = costDelta < -Math.log(6);
      if (!hasImprovement || extremeSpeedTradeoff || extremeCostTradeoff) return [];

      const speedNear =
        !baselineHasSpeed ||
        (model.e2eLatency! <= baselineModel.e2eLatency! * 1.15 &&
          model.e2eLatency! - baselineModel.e2eLatency! <=
            Math.max(0.5, baselineModel.e2eLatency! * 0.05));
      const costNear =
        !baselineHasCost ||
        (model.costPerTask! <= baselineModel.costPerTask! * 1.25 &&
          model.costPerTask! - baselineModel.costPerTask! <=
            Math.max(0.01, baselineModel.costPerTask! * 0.1));
      const speedNoWorse = !baselineHasSpeed || speedDelta >= 0;
      const costNoWorse = costNear;
      const clearUpgrade =
        comparableDimensions >= 2 &&
        metricDelta >= 0 &&
        speedNoWorse &&
        costNoWorse &&
        (metricDelta > 0.5 || speedDelta > Math.log(1.05) || costDelta > Math.log(1.05));
      const nearUpgrade =
        comparableDimensions >= 2 &&
        !clearUpgrade &&
        metricDelta > 0 &&
        speedNear &&
        costNear &&
        (speedDelta > Math.log(1.05) || costDelta > Math.log(1.05));
      const tier: RecommendationTier = clearUpgrade ? "clear" : nearUpgrade ? "near" : "tradeoff";
      const score =
        (metricDelta / 5) * 1.2 + speedDelta * speedWeight + costDelta * costWeight + newerDelta * 0.15;
      // A negative score culls worse-everything candidates, but a smarter model
      // is a real alternative direction even when it costs speed or money —
      // from a frontier baseline those are often the only neighbours left.
      if (tier === "tradeoff" && score <= 0 && metricDelta <= 0) return [];
      return [{ model, score, tier }];
    });

    const tierOrder: Record<RecommendationTier, number> = { clear: 0, near: 1, tradeoff: 2 };
    scored.sort(
      (a, b) =>
        tierOrder[a.tier] - tierOrder[b.tier] ||
        b.score - a.score ||
        metric.value(b.model)! - metric.value(a.model)! ||
        a.model.slug.localeCompare(b.model.slug),
    );
    const familyCounts = new Map<string, number>();
    const shortlist: Recommendation[] = [];
    for (const item of scored) {
      const family = item.model.displayName.replace(/\s*\([^)]*\)\s*$/, "").toLowerCase();
      const count = familyCounts.get(family) ?? 0;
      if (count >= 2) continue;
      familyCounts.set(family, count + 1);
      shortlist.push(item);
      if (shortlist.length === 5) break;
    }
    return shortlist;
  }, [baselineModel, metric, timeline, viewModels, xMode]);
  const recommendedModels = useMemo(
    () => recommendations.map((recommendation) => recommendation.model),
    [recommendations],
  );
  const quickAlternatives = useMemo(
    () =>
      recommendations.filter(
        (recommendation) => recommendation.model.slug !== candidateModel?.slug,
      ),
    [candidateModel, recommendations],
  );
  const alternativeSlugs = useMemo(
    () => new Set(candidateModel ? [] : recommendedModels.map((m) => m.slug)),
    [candidateModel, recommendedModels],
  );

  const colorDomain = useMemo<[number, number]>(() => {
    const v = viewModels.map((m) => xc.colorValue(m)).filter(isPositiveFinite);
    return v.length ? [Math.min(...v), Math.max(...v)] : [1, 10];
  }, [viewModels, xc]);
  // Chips carry the same ramp color the dot has on the map, so the strip and
  // the chart read as one picture.
  const colorNorm = useMemo(() => makeColorNorm(colorDomain), [colorDomain]);
  const dotColor = (model: Model) => {
    const v = xc.colorValue(model);
    return isPositiveFinite(v) ? rampColor(colorNorm(v)) : NEUTRAL_DOT_COLOR;
  };

  const recentCutoffMs = useMemo(() => {
    const cutoff = new Date(fetchedAtMs);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - RECENT_WINDOW_MONTHS);
    return cutoff.getTime();
  }, []);

  // Keep the newest marker singular even when many variants launch together.
  // Fall back to first-seen timestamps only when release dates are absent.
  const newestSlugs = useMemo(() => {
    const hasReleaseDates = allModels.some((m) => m.releaseMs != null);
    const dated = allModels
      .map((m) => ({
        m,
        t: hasReleaseDates ? m.releaseMs : m.addedAt ? Date.parse(m.addedAt) : NaN,
      }))
      .filter((item): item is { m: Model; t: number } => Number.isFinite(item.t));
    if (dated.length < 2) return new Set<string>();
    const times = dated.map((item) => item.t);
    const max = Math.max(...times);
    if (max === Math.min(...times)) return new Set<string>();
    const newest = dated
      .filter((item) => item.t === max && isPositiveFinite(metric.value(item.m)))
      .sort((a, b) => metric.value(b.m)! - metric.value(a.m)!)[0];
    return new Set(newest ? [newest.m.slug] : []);
  }, [metric]);
  const newestModel = useMemo(
    () =>
      viewModels
        .filter((m) => newestSlugs.has(m.slug))
        .sort((a, b) => metric.value(b)! - metric.value(a)!)[0] ?? null,
    [metric, newestSlugs, viewModels],
  );

  // Search matches every model, so matches that can't be plotted on the
  // current view are reported as "off view" instead of silently vanishing.
  const matchedSlugs = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return new Set(
      allModels
        .filter(
          (m) =>
            m.displayName.toLowerCase().includes(q) ||
            m.name.toLowerCase().includes(q) ||
            m.creator.toLowerCase().includes(q),
        )
        .map((m) => m.slug),
    );
  }, [query]);
  const matchCount = matchedSlugs?.size ?? null;
  const offViewCount = useMemo(() => {
    if (!matchedSlugs) return 0;
    const plottable = new Set(viewModels.map((m) => m.slug));
    return [...matchedSlugs].filter((slug) => !plottable.has(slug)).length;
  }, [matchedSlugs, viewModels]);

  const limits: Limits = limitsOn ? { maxWait, maxCost } : NO_LIMITS;
  const limited = limitsActive(limits);
  const bestPick = useMemo(() => {
    if (!limited) return null;
    return (
      viewModels
        .filter((m) => qualifies(m, limits) && (!matchedSlugs || matchedSlugs.has(m.slug)))
        .sort((a, b) => metric.value(b)! - metric.value(a)!)[0] ?? null
    );
  }, [limited, matchedSlugs, maxCost, maxWait, metric, viewModels]);

  // When the chart is wider than a phone viewport, keep the active comparison
  // in view instead of opening at the unrelated left edge of the map.
  useEffect(() => {
    const container = chartScrollRef.current;
    const focusedSlugs = baselineModel
      ? [baselineModel.slug, candidateModel?.slug]
      : matchedSlugs?.size === 1
        ? [...matchedSlugs]
        : [newestModel?.slug];
    if (!container || !focusedSlugs.some((slug) => slug != null)) return;

    let frame = 0;
    const focusComparison = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const containerRect = container.getBoundingClientRect();
        const centers = focusedSlugs
          .filter((slug): slug is string => slug != null)
          .map((slug) => container.querySelector<SVGGElement>(`[data-model-slug="${slug}"]`))
          .filter((element): element is SVGGElement => element != null)
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return rect.left - containerRect.left + container.scrollLeft + rect.width / 2;
          });
        if (!centers.length) return;

        const left = Math.min(...centers);
        const right = Math.max(...centers);
        const target =
          centers.length > 1 && right - left > container.clientWidth * 0.72
            ? centers[centers.length - 1]
            : (left + right) / 2;
        const maxScroll = container.scrollWidth - container.clientWidth;
        container.scrollTo({
          left:
            container.clientWidth >= 700
              ? 0
              : Math.max(0, Math.min(maxScroll, target - container.clientWidth / 2)),
          behavior: "smooth",
        });
      });
    };

    focusComparison();
    const observer = new ResizeObserver(focusComparison);
    observer.observe(container);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [baselineModel, candidateModel, matchedSlugs, newestModel, xMode, yMetric]);

  // Apply externally-set hashes (pasted URL, back/forward) — replaceState
  // below never fires hashchange, so this can't loop.
  useEffect(() => {
    const onHash = () => {
      const h = readHash();
      setYMetric(h.y);
      setXMode(h.x);
      setQuery(h.q);
      setLimitsOn(h.limitsOn);
      setMaxWait(h.maxWait);
      setMaxCost(h.maxCost);
      setComparedSlugs(h.comparedSlugs);
      setComparisonOn(h.comparedSlugs.length > 0);
      setOptionsOn(h.y !== "intelligence" || h.limitsOn);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Mirror the view into the URL hash so any state is shareable.
  useEffect(() => {
    const p = new URLSearchParams();
    if (yMetric !== "intelligence") p.set("y", yMetric);
    if (xMode !== "speed") p.set("x", xMode);
    if (query.trim()) p.set("q", query.trim());
    if (limitsOn && maxWait != null) p.set("wait", trimNum(maxWait));
    if (limitsOn && maxCost != null) p.set("cost", trimNum(maxCost));
    if (comparedSlugs[0]) p.set("from", comparedSlugs[0]);
    if (comparedSlugs[1]) p.set("to", comparedSlugs[1]);
    const hash = p.toString();
    const next = hash ? `#${hash}` : "";
    if (next === location.hash) return;
    try {
      history.replaceState(null, "", `${location.pathname}${location.search}${next}`);
    } catch {
      // Sandboxed/about:blank documents (README screenshot capture) refuse
      // replaceState — the URL mirror is best-effort there.
    }
  }, [yMetric, xMode, query, limitsOn, maxWait, maxCost, comparedSlugs]);

  useEffect(
    () => setCopyState("idle"),
    [yMetric, xMode, query, limitsOn, maxWait, maxCost, comparedSlugs],
  );
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !comparisonOn) return;
      setComparisonOn(false);
      setComparedSlugs([]);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [comparisonOn]);

  const selectForComparison = (slug: string) => {
    setComparisonOn(true);
    setComparedSlugs((current) => {
      if (current[0] === slug) return current.slice(1);
      if (current[1] === slug) return current.slice(0, 1);
      if (!current[0]) return [slug];
      return [current[0], slug];
    });
    setHoveredSlug(null);
  };
  const clearComparison = () => {
    setComparisonOn(false);
    setComparedSlugs([]);
  };
  const copyComparisonLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopyState("copied");
      return;
    } catch {
      // Older and embedded browsers may not expose the async clipboard API.
    }

    const field = document.createElement("textarea");
    field.value = window.location.href;
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    if (copied) {
      setCopyState("copied");
      return;
    }
    setCopyState("failed");
  };

  const hovered = hoveredSlug ? viewModels.find((m) => m.slug === hoveredSlug) : null;
  const cardModel = hovered ?? (limited ? bestPick : null);
  const subtitle = xc.subtitle.replace("Up is intelligence", `Up is ${metric.noun}`);
  const stats =
    baselineModel && candidateModel
      ? relativeStats(baselineModel, candidateModel, metric)
      : [];
  const comparisonUnavailable = comparedModels.find(
    (model) => !viewModels.some((visible) => visible.slug === model.slug),
  );

  return (
    <div
      className={`app-shell h-screen w-full flex flex-col overflow-hidden ${
        comparisonOn ? "comparison-active" : ""
      }`}
    >
      <div className="app-frame mx-auto max-w-[1400px] w-full px-4 sm:px-8 md:px-12 pt-6 pb-3 flex-1 flex flex-col min-h-0">
        <header className="shrink-0 flex items-end justify-between gap-8 pb-4">
          <div className="min-w-0">
            <h1
              className="font-serif text-[26px] md:text-[30px] leading-none tracking-[-0.015em] text-ink-900"
              style={{ fontWeight: 560 }}
            >
              Smart, fast, and <span className="italic">cheap.</span>
            </h1>
            <p className="comparison-mobile-hide mt-2 text-[12px] leading-snug text-ink-500 sm:hidden">
              Up is {metric.noun}.{" "}
              {timeline
                ? "Newer is right."
                : xMode === "cost"
                  ? "Right is cheaper."
                  : "Right is faster."}
            </p>
            <p className="comparison-mobile-hide mt-2 hidden max-w-3xl text-[13px] leading-snug text-ink-500 sm:block">
              {subtitle}
            </p>
          </div>
          <div className="comparison-mobile-hide hidden shrink-0 text-right sm:block">
            <div className="text-[11.5px] text-ink-500">Updated {fmtDate(fetchedAtMs)}</div>
            {newestModel && (
              <div className="mt-1 text-[11.5px] text-ink-500">
                Newest:{" "}
                <span className="font-medium" style={{ color: NEW_MODEL_COLOR }}>
                  {newestModel.displayName}
                </span>
              </div>
            )}
          </div>
        </header>

        <div className="shrink-0 flex flex-wrap items-center gap-2 border-y border-ink-100 py-2.5 sm:gap-3">
          <SegmentSwitch
            ariaLabel="Horizontal axis"
            options={(Object.keys(X_MODES) as XMode[]).map((k) => ({
              value: k,
              label: X_MODES[k].label,
            }))}
            value={xMode}
            onChange={setXMode}
          />
          <div className="comparison-mobile-hide ml-auto flex w-full items-center gap-2 sm:w-auto sm:gap-3">
            <SearchBox
              value={query}
              onChange={setQuery}
              matchCount={matchCount}
              offViewCount={offViewCount}
            />
            <button
              onClick={() => (comparisonOn ? clearComparison() : setComparisonOn(true))}
              aria-pressed={comparisonOn}
              className={`tap-target h-8 shrink-0 rounded-full border px-3.5 text-[12px] font-semibold transition-colors ${
                comparisonOn
                  ? "border-ink-900 bg-ink-900 text-paper"
                  : "border-ink-300 bg-card text-ink-900 hover:border-ink-900 hover:bg-ink-50"
              }`}
            >
              <span className="sm:hidden">Compare</span>
              <span className="hidden sm:inline">Find alternatives</span>
            </button>
            <button
              onClick={() => setOptionsOn((value) => !value)}
              aria-expanded={optionsOn}
              aria-label="Options"
              className={`tap-target-square h-8 shrink-0 rounded-full border px-3 text-[12px] transition-colors ${
                optionsOn
                  ? "border-ink-300 bg-ink-50 font-medium text-ink-900"
                  : "border-transparent text-ink-500 hover:bg-ink-50 hover:text-ink-900"
              }`}
            >
              <span className="sm:hidden">⋯</span>
              <span className="hidden sm:inline">
                Options{yMetric !== "intelligence" || limitsOn ? " ·" : ""}
              </span>
            </button>
          </div>
        </div>

        {optionsOn && (
          <div className="comparison-mobile-hide shrink-0 flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-ink-100 py-2.5">
            <div className="flex items-center gap-2">
              <span className="text-[11.5px] text-ink-500">Score</span>
              <SegmentSwitch
                ariaLabel="Score"
                options={(Object.keys(Y_METRICS) as YMetric[]).map((k) => ({
                  value: k,
                  label: Y_METRICS[k].label,
                }))}
                value={yMetric}
                onChange={setYMetric}
              />
            </div>
            <div className="hidden md:block">
              <FrontierLegend label={xc.frontierLabel} note={xc.frontierNote(metric.noun)} />
            </div>
            <div className="hidden md:block">
              <ColorLegend title={xc.colorTitle} domain={colorDomain} fmt={xc.fmtColor} />
            </div>
            <button
              onClick={() => setLimitsOn((value) => !value)}
              aria-pressed={limitsOn}
              className={`tap-target rounded-full border px-3 py-1 text-[11.5px] transition-colors ${
                limitsOn
                  ? "border-ink-900 bg-ink-900 font-medium text-paper"
                  : "border-ink-100 text-ink-500 hover:text-ink-900"
              }`}
            >
              {limitsOn ? "Limits on" : "Set limits"}
            </button>
          </div>
        )}

        {limitsOn && (
          <div className="comparison-mobile-hide shrink-0 flex flex-wrap items-center gap-x-8 gap-y-2 border-b border-ink-100 py-2.5">
            <LimitSlider
              label="Max wait"
              range={WAIT_RANGE}
              value={maxWait}
              onChange={setMaxWait}
              fmt={fmtSecondsShort}
            />
            <LimitSlider
              label="Max cost/task"
              range={COST_RANGE}
              value={maxCost}
              onChange={setMaxCost}
              fmt={fmtCost}
            />
            <div className="text-[11.5px] text-ink-500">
              {limited ? (
                bestPick ? (
                  <>
                    Top pick under these limits:{" "}
                    <span className="font-semibold text-ink-900">{bestPick.displayName}</span>
                  </>
                ) : (
                  "No model fits these limits."
                )
              ) : (
                "Drag a slider to set a limit — the smartest model that fits gets flagged."
              )}
            </div>
            {limited && (
              <button
                onClick={() => {
                  setMaxWait(null);
                  setMaxCost(null);
                }}
                aria-label="Clear limits"
                className="tap-target px-2 text-[11.5px] text-ink-500 underline decoration-ink-300 underline-offset-2 hover:text-ink-900"
              >
                Clear
              </button>
            )}
          </div>
        )}

        {comparisonOn && (
          <div
            className="comparison-strip relative z-30 mt-3 shrink-0 rounded-2xl border border-ink-100 bg-card px-4 py-3.5 sm:px-5 sm:py-4"
            style={{ boxShadow: CARD_SHADOW }}
          >
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
              {baselineModel ? (
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:flex-none sm:flex-nowrap sm:gap-2.5">
                  <ModelChip
                    role="Using now"
                    model={baselineModel}
                    color={dotColor(baselineModel)}
                    onRemove={() => setComparedSlugs((current) => current.slice(1))}
                  />
                  {candidateModel ? (
                    <button
                      onClick={() =>
                        setComparedSlugs((current) =>
                          current.length === 2 ? [current[1], current[0]] : current,
                        )
                      }
                      aria-label="Swap the models"
                      title="Swap models"
                      className="tap-target-square flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[13px] leading-none text-ink-300 transition-colors hover:bg-ink-50 hover:text-ink-900"
                    >
                      ⇄
                    </button>
                  ) : (
                    <span className="shrink-0 text-ink-300" aria-hidden>
                      →
                    </span>
                  )}
                  {candidateModel ? (
                    <ModelChip
                      role="Considering"
                      model={candidateModel}
                      color={dotColor(candidateModel)}
                      onRemove={() => setComparedSlugs((current) => current.slice(0, 1))}
                    />
                  ) : (
                    <span className="truncate rounded-full border border-dashed border-ink-300 px-3 py-1.5 text-[12px] text-ink-500">
                      Considering · nothing yet
                    </span>
                  )}
                </div>
              ) : (
                <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
                  <span className="comparison-mobile-hide shrink-0 text-[12px] text-ink-500">
                    Using now
                  </span>
                  <ModelPicker models={viewModels} onSelect={selectForComparison} />
                  <button
                    onClick={clearComparison}
                    aria-label="Close comparison"
                    className="comparison-mobile-show-flex tap-target-square hidden shrink-0 items-center justify-center rounded-full text-[16px] leading-none text-ink-300 hover:bg-ink-50 hover:text-ink-900"
                  >
                    ×
                  </button>
                </div>
              )}

              {baselineModel && (
                <div className="hidden h-9 w-px shrink-0 bg-ink-100 sm:block" aria-hidden />
              )}

              {baselineModel &&
                (comparisonUnavailable ? (
                  <p className="min-w-0 flex-1 text-[12px] leading-snug text-ink-500">
                    <span className="font-semibold text-ink-900">
                      {comparisonUnavailable.displayName}
                    </span>{" "}
                    isn’t available in this view.
                  </p>
                ) : stats.length ? (
                  <div className="flex w-full min-w-0 items-start justify-between gap-4 sm:w-auto sm:flex-1 sm:justify-start sm:gap-9">
                    {stats.map((stat) => (
                      <StatBlock key={stat.key} stat={stat} />
                    ))}
                  </div>
                ) : (
                  <p className="min-w-0 flex-1 text-[12px] leading-snug text-ink-500">
                    Pick a challenger from the shortlist, or click any dot.
                  </p>
                ))}

              <div className="ml-auto flex shrink-0 items-center gap-2">
                {baselineModel && copyState === "failed" ? (
                  <input
                    autoFocus
                    readOnly
                    value={window.location.href}
                    onFocus={(event) => event.currentTarget.select()}
                    onClick={(event) => event.currentTarget.select()}
                    aria-label="Comparison link, selected for copying"
                    className="w-36 rounded-full border border-ink-300 px-3 py-1.5 text-[11px] text-ink-700 focus:border-ink-900 focus:outline-none sm:w-48"
                  />
                ) : baselineModel ? (
                  <button
                    onClick={copyComparisonLink}
                    className="tap-target h-8 rounded-full bg-ink-900 px-3.5 text-[12px] font-medium text-paper transition-colors hover:bg-ink-700"
                  >
                    <span className="comparison-mobile-hide">
                      {copyState === "copied" ? "Link copied" : "Copy link"}
                    </span>
                    <span className="comparison-mobile-show hidden">
                      {copyState === "copied" ? "Copied" : "Copy"}
                    </span>
                  </button>
                ) : null}
                <button
                  onClick={clearComparison}
                  aria-label="Close comparison"
                  className={`${
                    baselineModel ? "" : "comparison-mobile-hide "
                  }tap-target-square flex items-center justify-center rounded-full text-[16px] leading-none text-ink-300 hover:bg-ink-50 hover:text-ink-900`}
                >
                  ×
                </button>
              </div>
            </div>

            {baselineModel && quickAlternatives.length > 0 && (
              <div className="mobile-alternatives xl:hidden mt-3 flex items-stretch gap-2 overflow-x-auto border-t border-ink-100 pt-3">
                <span className="shrink-0 self-center text-[11px] text-ink-500">
                  <span className="comparison-mobile-hide">Top alternatives</span>
                  <span className="comparison-mobile-show hidden">Try</span>
                </span>
                {quickAlternatives.map(({ model }, index) => (
                  <button
                    key={model.slug}
                    onClick={() => selectForComparison(model.slug)}
                    className={`${
                      index >= 2 ? "comparison-mobile-hide " : ""
                    }tap-target shrink-0 rounded-xl border px-3 py-1.5 text-left transition-colors ${
                      candidateModel?.slug === model.slug
                        ? "border-ink-900 bg-ink-900 text-paper"
                        : "border-ink-100 bg-paper text-ink-900 hover:border-ink-300"
                    }`}
                  >
                    <span className="block whitespace-nowrap text-[11.5px] font-semibold leading-tight">
                      {model.displayName}
                    </span>
                    <span
                      className={`comparison-mobile-hide block whitespace-nowrap text-[10.5px] leading-snug tabular-nums ${
                        candidateModel?.slug === model.slug ? "text-ink-300" : "text-ink-500"
                      }`}
                    >
                      {compactStats(relativeStats(baselineModel, model, metric))}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <main className="chart-main relative mt-3 min-h-0 flex-1">
          <div
            className="flex h-full w-full overflow-hidden rounded-2xl border border-ink-100 bg-card"
            style={{ boxShadow: CARD_SHADOW }}
          >
            <div
              ref={chartScrollRef}
              className="mobile-chart-scroll relative min-w-0 flex-1 overflow-x-auto"
            >
              <div className={`h-full ${baselineModel ? "min-w-[780px]" : "min-w-[860px]"}`}>
                <MapChart
                  models={allModels}
                  yMetric={yMetric}
                  xMode={xMode}
                  onHover={setHoveredSlug}
                  hoveredSlug={hoveredSlug}
                  matchedSlugs={matchedSlugs}
                  newestSlugs={newestSlugs}
                  recentCutoffMs={recentCutoffMs}
                  limits={limits}
                  bestPickSlug={bestPick?.slug ?? null}
                  colorDomain={colorDomain}
                  comparedSlugs={comparedSlugs}
                  alternativeSlugs={alternativeSlugs}
                  onSelect={selectForComparison}
                />
              </div>
              {cardModel && (
                <HoverCard
                  m={cardModel}
                  yMetric={yMetric}
                  caption={!hovered && cardModel === bestPick ? "Top pick" : undefined}
                />
              )}
            </div>
            {baselineModel && (
              <AlternativesPanel
                baseline={baselineModel}
                alternatives={recommendations}
                selectedSlug={candidateModel?.slug ?? null}
                yMetric={yMetric}
                onSelect={selectForComparison}
              />
            )}
          </div>
        </main>

        <footer className="comparison-mobile-hide shrink-0 pt-3 mt-3 border-t border-ink-100 text-[11px] leading-snug text-ink-500">
          Data from Artificial Analysis. {xc.footnote}
          {yMetric === "coding" &&
            " Cost figures are per Intelligence Index task — AA doesn’t publish per-coding-task cost."}{" "}
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="underline decoration-ink-300 underline-offset-2 transition-colors hover:text-ink-900"
          >
            Source on GitHub
          </a>
        </footer>
      </div>
    </div>
  );
}
