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
  allModels,
  fetchedAtMs,
  fmtCost,
  fmtDate,
  fmtSeconds,
  fmtSecondsShort,
  isPositiveFinite,
  limitsActive,
  qualifies,
  rampColor,
  NEW_MODEL_COLOR,
  PICK_COLOR,
} from "./model";

const RECENT_WINDOW_MONTHS = 3;
const DAY_MS = 86_400_000;

const releaseTimes = allModels.map((m) => m.releaseMs).filter((t): t is number => t != null);
const minReleaseMs = releaseTimes.length ? Math.min(...releaseTimes) : fetchedAtMs - 365 * DAY_MS;

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

const comparisonSummary = (from: Model, to: Model, yMetric: YMetric) => {
  const parts: string[] = [];
  const metric = Y_METRICS[yMetric];
  const metricFrom = metric.value(from);
  const metricTo = metric.value(to);
  if (isPositiveFinite(metricFrom) && isPositiveFinite(metricTo)) {
    const delta = metricTo - metricFrom;
    parts.push(
      Math.abs(delta) < 0.05
        ? `same ${metric.noun}`
        : `${delta > 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)} ${metric.noun}`,
    );
  }
  if (isPositiveFinite(from.e2eLatency) && isPositiveFinite(to.e2eLatency)) {
    const ratio = from.e2eLatency / to.e2eLatency;
    parts.push(
      ratio > 1.05
        ? `${ratio.toFixed(1)}× faster`
        : ratio < 0.95
          ? `${(1 / ratio).toFixed(1)}× slower`
          : "about the same speed",
    );
  }
  if (isPositiveFinite(from.costPerTask) && isPositiveFinite(to.costPerTask)) {
    const delta = to.costPerTask - from.costPerTask;
    parts.push(
      Math.abs(delta) < 0.005
        ? "about the same cost"
        : `${fmtCost(Math.abs(delta))} ${delta < 0 ? "cheaper" : "pricier"}/task`,
    );
  }
  return parts;
};

// Shareable state lives in the URL hash: #y=coding&x=cost&q=claude&asof=2025-06-01&wait=30&cost=1
function readHash() {
  const p = new URLSearchParams(window.location.hash.slice(1));
  const y: YMetric = p.get("y") === "coding" ? "coding" : "intelligence";
  const xRaw = p.get("x");
  const x: XMode = xRaw === "cost" || xRaw === "timeline" ? xRaw : "speed";
  const q = p.get("q") ?? "";
  let asOf: number | null = null;
  const asofRaw = p.get("asof");
  if (asofRaw) {
    const ms = Date.parse(asofRaw);
    if (Number.isFinite(ms) && ms < fetchedAtMs) asOf = Math.max(ms, minReleaseMs);
  }
  const wait = Number.parseFloat(p.get("wait") ?? "");
  const cost = Number.parseFloat(p.get("cost") ?? "");
  const maxWait = Number.isFinite(wait) && wait > 0 ? wait : null;
  const maxCost = Number.isFinite(cost) && cost > 0 ? cost : null;
  const knownSlugs = new Set(allModels.map((m) => m.slug));
  const from = p.get("from");
  const to = p.get("to");
  const comparedSlugs = [from, to].filter(
    (slug, index, slugs): slug is string =>
      slug != null && knownSlugs.has(slug) && slugs.indexOf(slug) === index,
  );
  return {
    y,
    x,
    q,
    asOf,
    maxWait,
    maxCost,
    limitsOn: maxWait != null || maxCost != null,
    comparedSlugs,
  };
}
const initial = readHash();

const trimNum = (v: number) => String(Number(v.toPrecision(3)));

function ComparisonModel({
  label,
  model,
  emptyLabel,
  onRemove,
}: {
  label: string;
  model: Model | null;
  emptyLabel: string;
  onRemove: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-2">
      <span className="text-[9px] uppercase tracking-[0.14em] text-ink-300 whitespace-nowrap">
        {label}
      </span>
      {model ? (
        <div className="flex w-full min-w-0 items-center gap-1.5 rounded-full border border-ink-300 bg-white px-2.5 py-1 sm:w-auto">
          <span className="truncate text-[11px] font-semibold text-ink-900">{model.displayName}</span>
          <button
            onClick={onRemove}
            aria-label={`Remove ${model.displayName}`}
            className="shrink-0 text-[13px] leading-none text-ink-300 hover:text-ink-900"
          >
            ×
          </button>
        </div>
      ) : (
        <span className="text-[11px] text-ink-500 whitespace-nowrap">{emptyLabel}</span>
      )}
    </div>
  );
}

function ModelPicker({ models, onSelect }: { models: Model[]; onSelect: (slug: string) => void }) {
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
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

  return (
    <div className="relative w-56">
      <input
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
        placeholder="Search for your model…"
        aria-label="Choose the model you use now"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls="current-model-options"
        aria-activedescendant={open && results[activeIndex] ? `model-option-${results[activeIndex].slug}` : undefined}
        className="w-full rounded-full border border-ink-300 px-3 py-1.5 text-[11px] text-ink-900 placeholder:text-ink-300 focus:border-ink-900 focus:outline-none"
      />
      {open && (
        <div
          id="current-model-options"
          role="listbox"
          className="model-picker-menu absolute right-0 top-full z-40 mt-1.5 max-h-64 w-[calc(100vw-2rem)] max-w-72 overflow-y-auto rounded-lg border border-ink-100 bg-white p-1 shadow-xl sm:left-0 sm:right-auto"
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
                className={`flex w-full items-baseline justify-between gap-3 rounded-md px-2.5 py-2 text-left ${
                  index === activeIndex ? "bg-ink-50" : "hover:bg-ink-50"
                }`}
              >
                <span className="text-[11px] font-medium leading-tight text-ink-900">
                  {model.displayName}
                </span>
                <span className="shrink-0 text-[9px] uppercase tracking-wide text-ink-300">
                  {model.creator}
                </span>
              </button>
            ))
          ) : (
            <div className="px-2.5 py-3 text-[11px] text-ink-500">No matching model</div>
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
  return (
    <aside className="alternatives-panel hidden xl:flex w-[17.5rem] max-h-full shrink-0 self-start flex-col overflow-y-auto rounded-xl border border-ink-100 bg-white p-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-900">
          Top alternatives
        </div>
        <span className="text-[9px] text-ink-300">Clear upgrades first</span>
      </div>
      <div className="mt-2 divide-y divide-ink-100">
        {alternatives.length ? (
          alternatives.map(({ model, tier }, index) => {
            const selected = model.slug === selectedSlug;
            const summary = comparisonSummary(baseline, model, yMetric);
            return (
              <button
                key={model.slug}
                onClick={() => onSelect(model.slug)}
                aria-label={`Compare ${baseline.displayName} with ${model.displayName}`}
                className={`alternative-row w-full px-1 py-2.5 text-left transition-colors ${
                  selected
                    ? "bg-ink-50"
                    : "hover:bg-ink-50"
                }`}
                style={{ animationDelay: `${60 + index * 35}ms` }}
              >
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className="text-[10px] tabular-nums text-ink-300">{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-[11px] font-semibold leading-tight text-ink-900">
                    {model.displayName}
                  </span>
                  {tier !== "tradeoff" && (
                    <span className="shrink-0 text-[8px] font-semibold uppercase tracking-[0.1em] text-ink-500">
                      {tier === "clear" ? "Clear upgrade" : "Small tradeoff"}
                    </span>
                  )}
                </div>
                <div className="mt-1 pl-4 text-[9.5px] leading-snug text-ink-500">
                  {summary.join(" · ") || "Comparable benchmark data"}
                </div>
              </button>
            );
          })
        ) : (
          <div className="rounded-lg bg-ink-50 px-3 py-3 text-[11px] leading-snug text-ink-500">
            No close alternatives have enough comparable data in this view.
          </div>
        )}
      </div>
    </aside>
  );
}

function SegmentSwitch<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex items-center gap-1 border border-ink-100 rounded-full p-0.5 w-fit">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-2.5 py-1 text-[11px] rounded-full transition-colors ${
            value === opt.value ? "bg-ink-900 text-white font-medium" : "text-ink-500 hover:text-ink-900"
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
          stroke="#9b9b9b"
          strokeWidth="1.25"
          strokeDasharray="3 3"
          strokeLinecap="round"
        />
      </svg>
      <span className="text-[11px] text-ink-700 underline decoration-dotted decoration-ink-300 underline-offset-[3px]">
        {label}
      </span>
      <div
        className="invisible opacity-0 group-hover:visible group-hover:opacity-100 absolute top-full right-0 mt-2 w-64 bg-white border border-ink-100 rounded-lg px-3 py-2 text-[11px] text-ink-700 leading-snug z-30 transition-opacity duration-150"
        style={{ boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.06)" }}
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
      <span className="text-[11px] text-ink-700">{title}</span>
      <span className="text-[10px] tabular-nums text-ink-500">{fmt(domain[0])}</span>
      <div
        className="h-2 w-32 rounded-full"
        style={{ background: `linear-gradient(to right, ${stops.join(", ")})` }}
      />
      <span className="text-[10px] tabular-nums text-ink-500">{fmt(domain[1])}</span>
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
      className="pointer-events-none absolute top-3 right-3 w-[18.5rem] rounded-xl border border-ink-100/80 bg-white/95 px-4 py-3.5 text-ink-900 z-20 backdrop-blur"
      style={{ boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 18px 48px rgba(0,0,0,0.10)" }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-ink-500">
          {m.creator}
        </div>
        {caption && (
          <div
            className="text-[9px] font-bold uppercase tracking-[0.14em]"
            style={{ color: PICK_COLOR }}
          >
            {caption}
          </div>
        )}
      </div>
      <div className="mt-1.5 text-[15px] font-semibold leading-tight text-ink-900">
        {m.displayName}
      </div>
      <div className="mt-3 divide-y divide-ink-100 text-[12px]">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-5 py-2 first:pt-0 last:pb-0">
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
    <div className="flex items-center gap-2">
      <div className="relative">
        <svg
          className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#9b9b9b"
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
          placeholder="Search models…"
          aria-label="Search models"
          className="w-36 sm:w-48 text-[12px] pl-7 pr-7 py-1.5 rounded-full border border-ink-100 text-ink-900 placeholder:text-ink-300 focus:outline-none focus:border-ink-300 transition-colors"
        />
        {active && (
          <button
            onClick={() => onChange("")}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-300 hover:text-ink-700 text-[14px] leading-none"
          >
            ×
          </button>
        )}
      </div>
      {active && (
        <span className="hidden sm:inline text-[10px] tabular-nums text-ink-500 whitespace-nowrap">
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
      <span className="text-[11px] text-ink-500 whitespace-nowrap">{label}</span>
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
        className="limit w-28 sm:w-32"
        aria-label={label}
      />
      <span className="text-[11px] font-medium tabular-nums text-ink-900 w-12">
        {value == null ? "any" : fmt(value)}
      </span>
    </label>
  );
}

function TimeScrubber({
  value,
  playing,
  onChange,
  onTogglePlay,
}: {
  value: number | null;
  playing: boolean;
  onChange: (v: number | null) => void;
  onTogglePlay: () => void;
}) {
  return (
    <div className="shrink-0 flex items-center gap-3 pt-2">
      <button
        onClick={onTogglePlay}
        aria-label={playing ? "Pause replay" : "Replay history"}
        className="h-6 w-6 rounded-full border border-ink-100 flex items-center justify-center text-ink-700 hover:border-ink-300 transition-colors shrink-0"
      >
        {playing ? (
          <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden>
            <rect x="1.5" y="1" width="2.6" height="8" fill="currentColor" />
            <rect x="5.9" y="1" width="2.6" height="8" fill="currentColor" />
          </svg>
        ) : (
          <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden>
            <path d="M2 0.8v8.4L9 5z" fill="currentColor" />
          </svg>
        )}
      </button>
      <span className="hidden sm:inline text-[9px] uppercase tracking-[0.16em] text-ink-300 shrink-0">
        Replay
      </span>
      <input
        type="range"
        name="asof"
        min={minReleaseMs}
        max={fetchedAtMs}
        step={DAY_MS}
        value={value ?? fetchedAtMs}
        onChange={(e) => {
          const v = Number(e.target.value);
          // The day-step never lands exactly on the max, so treat the last
          // step as "today".
          onChange(fetchedAtMs - v < DAY_MS ? null : v);
        }}
        className="scrub flex-1 min-w-0"
        aria-label="View the map as of a past date"
      />
      <span className="text-[11px] tabular-nums text-ink-700 w-24 text-right shrink-0">
        {value == null ? "Today" : fmtDate(value)}
      </span>
    </div>
  );
}

export default function App() {
  const [yMetric, setYMetric] = useState<YMetric>(initial.y);
  const [xMode, setXMode] = useState<XMode>(initial.x);
  const [hoveredSlug, setHoveredSlug] = useState<string | null>(null);
  const [query, setQuery] = useState(initial.q);
  const [asOf, setAsOf] = useState<number | null>(initial.asOf);
  const [playing, setPlaying] = useState(false);
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
  // The timeline already shows all of history, so the scrubber only applies
  // to the scatter views.
  const effectiveAsOf = timeline ? null : asOf;

  const asOfModels = useMemo(
    () =>
      effectiveAsOf == null
        ? allModels
        : allModels.filter((m) => m.releaseMs != null && m.releaseMs <= effectiveAsOf),
    [effectiveAsOf],
  );
  const metricModels = useMemo(
    () => asOfModels.filter((m) => isPositiveFinite(metric.value(m))),
    [asOfModels, metric],
  );
  const viewModels = useMemo(
    () => metricModels.filter((m) => !timeline || m.releaseMs != null),
    [metricModels, timeline],
  );
  const comparedModels = useMemo(
    () => comparedSlugs.map((slug) => allModels.find((m) => m.slug === slug)).filter((m): m is Model => m != null),
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
      if (!isPositiveFinite(modelMetric) || modelMetric < baselineMetric - 3) return [];

      const canCompareSpeed =
        baselineHasSpeed && isPositiveFinite(model.e2eLatency);
      const canCompareCost =
        baselineHasCost && isPositiveFinite(model.costPerTask);
      if (
        (baselineHasSpeed && !canCompareSpeed) ||
        (baselineHasCost && !canCompareCost) ||
        (xMode === "speed" && !canCompareSpeed) ||
        (xMode === "cost" && !canCompareCost)
      ) {
        return [];
      }

      const metricDelta = modelMetric - baselineMetric;
      const speedDelta = canCompareSpeed ? Math.log(baselineModel.e2eLatency! / model.e2eLatency!) : 0;
      const costDelta = canCompareCost ? Math.log(baselineModel.costPerTask! / model.costPerTask!) : 0;
      const newerDelta =
        timeline && baselineModel.releaseMs != null && model.releaseMs != null
          ? (model.releaseMs - baselineModel.releaseMs) / (365 * DAY_MS)
          : 0;
      const hasImprovement =
        metricDelta > 0.5 || speedDelta > Math.log(1.08) || costDelta > Math.log(1.08) || newerDelta > 0.1;
      const extremeSpeedTradeoff = speedDelta < -Math.log(4);
      const extremeCostTradeoff = costDelta < -Math.log(4);
      if (!hasImprovement || extremeSpeedTradeoff || extremeCostTradeoff) return [];

      const speedNoWorse = !baselineHasSpeed || speedDelta >= 0;
      const costNoWorse = !baselineHasCost || costDelta >= 0;
      const clearUpgrade =
        comparableDimensions >= 2 &&
        metricDelta >= 0 &&
        speedNoWorse &&
        costNoWorse &&
        (metricDelta > 0.5 || speedDelta > Math.log(1.05) || costDelta > Math.log(1.05));
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
      if (tier === "tradeoff" && score <= 0) return [];
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
      if (shortlist.length === 3) break;
    }
    return shortlist;
  }, [baselineModel, metric, timeline, viewModels, xMode]);
  const recommendedModels = useMemo(
    () => recommendations.map((recommendation) => recommendation.model),
    [recommendations],
  );
  const alternativeSlugs = useMemo(
    () => new Set(candidateModel ? [] : recommendedModels.map((m) => m.slug)),
    [candidateModel, recommendedModels],
  );

  const colorDomain = useMemo<[number, number]>(() => {
    const v = viewModels.map((m) => xc.colorValue(m)).filter(isPositiveFinite);
    return v.length ? [Math.min(...v), Math.max(...v)] : [1, 10];
  }, [viewModels, xc]);

  const recentCutoffMs = useMemo(() => {
    const cutoff = new Date(effectiveAsOf ?? fetchedAtMs);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - RECENT_WINDOW_MONTHS);
    return cutoff.getTime();
  }, [effectiveAsOf]);

  // Keep the newest marker singular even when many variants launch together.
  // Fall back to first-seen timestamps only when release dates are absent.
  const newestSlugs = useMemo(() => {
    const hasReleaseDates = asOfModels.some((m) => m.releaseMs != null);
    const dated = asOfModels
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
  }, [asOfModels, metric]);
  const newestModel = useMemo(
    () =>
      viewModels
        .filter((m) => newestSlugs.has(m.slug))
        .sort((a, b) => metric.value(b)! - metric.value(a)!)[0] ?? null,
    [metric, newestSlugs, viewModels],
  );

  // Search matches all models as of the viewed date — matches that can't be
  // plotted on the current view are reported as "off view" instead of
  // silently vanishing.
  const matchedSlugs = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return new Set(
      asOfModels
        .filter(
          (m) =>
            m.displayName.toLowerCase().includes(q) ||
            m.name.toLowerCase().includes(q) ||
            m.creator.toLowerCase().includes(q),
        )
        .map((m) => m.slug),
    );
  }, [query, asOfModels]);
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

  // Replay: sweep the as-of date from the first release to today.
  useEffect(() => {
    if (!playing) return;
    const step = Math.max(DAY_MS, Math.round((fetchedAtMs - minReleaseMs) / 150));
    const id = setInterval(() => setAsOf((prev) => (prev ?? minReleaseMs) + step), 70);
    return () => clearInterval(id);
  }, [playing]);
  useEffect(() => {
    if (asOf != null && asOf >= fetchedAtMs) {
      setAsOf(null);
      setPlaying(false);
    }
  }, [asOf]);
  useEffect(() => {
    if (timeline) setPlaying(false);
  }, [timeline]);

  // When the chart is wider than a phone viewport, keep the active comparison
  // in view instead of opening at the unrelated left edge of the map.
  useEffect(() => {
    const container = chartScrollRef.current;
    if (!container || !baselineModel) return;

    let frame = 0;
    const focusComparison = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const containerRect = container.getBoundingClientRect();
        const centers = [baselineModel.slug, candidateModel?.slug]
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
          left: Math.max(0, Math.min(maxScroll, target - container.clientWidth / 2)),
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
  }, [baselineModel, candidateModel, xMode, yMetric]);
  const togglePlay = () => {
    if (!playing && asOf == null) setAsOf(minReleaseMs);
    setPlaying((p) => !p);
  };

  // Apply externally-set hashes (pasted URL, back/forward) — replaceState
  // below never fires hashchange, so this can't loop.
  useEffect(() => {
    const onHash = () => {
      const h = readHash();
      setYMetric(h.y);
      setXMode(h.x);
      setQuery(h.q);
      setAsOf(h.asOf);
      setLimitsOn(h.limitsOn);
      setMaxWait(h.maxWait);
      setMaxCost(h.maxCost);
      setComparedSlugs(h.comparedSlugs);
      setComparisonOn(h.comparedSlugs.length > 0);
      if (h.y !== "intelligence" || h.limitsOn) setOptionsOn(true);
      setPlaying(false);
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
    if (asOf != null) p.set("asof", new Date(asOf).toISOString().slice(0, 10));
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
  }, [yMetric, xMode, query, asOf, limitsOn, maxWait, maxCost, comparedSlugs]);

  useEffect(
    () => setCopyState("idle"),
    [yMetric, xMode, query, asOf, limitsOn, maxWait, maxCost, comparedSlugs],
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
  const copyComparisonLink = () => {
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

  const fetchedDate = fmtDate(fetchedAtMs);
  const hovered = hoveredSlug ? viewModels.find((m) => m.slug === hoveredSlug) : null;
  const cardModel = hovered ?? (limited ? bestPick : null);
  const subtitle = xc.subtitle.replace("Up is intelligence", `Up is ${metric.noun}`);
  const summary =
    baselineModel && candidateModel ? comparisonSummary(baselineModel, candidateModel, yMetric) : [];
  const comparisonUnavailable = comparedModels.find(
    (model) => !viewModels.some((visible) => visible.slug === model.slug),
  );

  return (
    <div className="app-shell h-screen w-full flex flex-col overflow-hidden">
      <div className="app-frame mx-auto max-w-[1400px] w-full px-4 sm:px-8 md:px-12 pt-6 pb-3 flex-1 flex flex-col min-h-0">
        <header className="shrink-0 flex items-end justify-between gap-8 pb-4 border-b border-ink-100">
          <div>
            <h1 className="text-2xl md:text-[28px] font-light tracking-tight text-ink-900 leading-tight">
              Smart, fast, and cheap.
            </h1>
            <p className="mt-1.5 text-[13px] text-ink-500 max-w-3xl leading-snug">{subtitle}</p>
          </div>
          <div className="hidden sm:block text-right shrink-0">
            <div className="text-[10px] tracking-wide text-ink-300 uppercase">
              {effectiveAsOf == null ? `Updated ${fetchedDate}` : `As of ${fmtDate(effectiveAsOf)}`}
            </div>
            {newestModel && (
              <div className="mt-0.5 text-[10px] tracking-wide">
                <span className="uppercase text-ink-300">Newest </span>
                <span className="font-medium" style={{ color: NEW_MODEL_COLOR }}>
                  {newestModel.displayName}
                </span>
              </div>
            )}
          </div>
        </header>

        <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 py-3">
          <div className="flex items-center gap-2 md:gap-3">
            <SegmentSwitch
              options={(Object.keys(X_MODES) as XMode[]).map((k) => ({
                value: k,
                label: X_MODES[k].label,
              }))}
              value={xMode}
              onChange={setXMode}
            />
          </div>
          <div className="flex items-center gap-2 md:gap-3">
            <button
              onClick={() => (comparisonOn ? clearComparison() : setComparisonOn(true))}
              aria-pressed={comparisonOn}
              className={`px-2.5 py-1 text-[11px] rounded-full border transition-colors ${
                comparisonOn
                  ? "bg-ink-700 text-white border-ink-700 font-medium"
                  : "bg-ink-900 text-white border-ink-900 font-medium hover:bg-ink-700"
              }`}
            >
              Find alternatives
            </button>
            <SearchBox
              value={query}
              onChange={setQuery}
              matchCount={matchCount}
              offViewCount={offViewCount}
            />
            <button
              onClick={() => setOptionsOn((value) => !value)}
              aria-expanded={optionsOn}
              className={`px-2.5 py-1 text-[11px] rounded-full border transition-colors ${
                optionsOn
                  ? "border-ink-900 text-ink-900 font-medium"
                  : "border-ink-100 text-ink-500 hover:text-ink-900"
              }`}
            >
              Options{yMetric !== "intelligence" || limitsOn ? " ·" : ""}
            </button>
          </div>
        </div>

        {optionsOn && (
          <div className="shrink-0 flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-ink-100 py-2.5">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-[0.12em] text-ink-300">Score</span>
              <SegmentSwitch
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
              className={`px-2.5 py-1 text-[11px] rounded-full border transition-colors ${
                limitsOn
                  ? "bg-ink-900 text-white border-ink-900 font-medium"
                  : "border-ink-100 text-ink-500 hover:text-ink-900"
              }`}
            >
              {limitsOn ? "Limits on" : "Set limits"}
            </button>
          </div>
        )}

        {comparisonOn && (
          <div className="comparison-strip relative z-30 shrink-0 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-ink-100 py-2.5">
            <div
              className={
                baselineModel
                  ? "grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-end gap-2 sm:flex sm:w-auto sm:items-center sm:gap-3"
                  : "flex min-w-0 items-center gap-3"
              }
            >
              {baselineModel ? (
                <>
                  <ComparisonModel
                    label="Using now"
                    model={baselineModel}
                    emptyLabel=""
                    onRemove={() => setComparedSlugs((current) => current.slice(1))}
                  />
                  <span className="text-ink-300" aria-hidden>
                    →
                  </span>
                  <ComparisonModel
                    label="Considering"
                    model={candidateModel}
                    emptyLabel="Choose an alternative"
                    onRemove={() => setComparedSlugs((current) => current.slice(0, 1))}
                  />
                  {candidateModel && (
                    <button
                      onClick={() =>
                        setComparedSlugs((current) =>
                          current.length === 2 ? [current[1], current[0]] : current,
                        )
                      }
                      aria-label="Swap the models"
                      title="Swap models"
                      className="text-[14px] leading-none text-ink-300 hover:text-ink-900"
                    >
                      ⇄
                    </button>
                  )}
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-[9px] uppercase tracking-[0.14em] text-ink-300 whitespace-nowrap">
                    Using now
                  </span>
                  <ModelPicker models={viewModels} onSelect={selectForComparison} />
                </div>
              )}
            </div>

            {baselineModel && <div className="min-w-0 flex-1 text-[11px] text-ink-500">
              {comparisonUnavailable ? (
                <span>
                  <span className="font-medium text-ink-900">{comparisonUnavailable.displayName}</span> isn’t
                  available in this view.
                </span>
              ) : summary.length ? (
                <span>
                  {summary.map((item, index) => (
                    <span key={item}>
                      {index > 0 && <span className="mx-1.5 text-ink-300">·</span>}
                      <span className="font-medium text-ink-900">{item}</span>
                    </span>
                  ))}
                </span>
              ) : baselineModel ? (
                "Pick from the shortlist or a highlighted point."
              ) : null}
            </div>}

            <div className="ml-auto flex items-center gap-3">
              {baselineModel && copyState === "failed" ? (
                <input
                  autoFocus
                  readOnly
                  value={window.location.href}
                  onFocus={(event) => event.currentTarget.select()}
                  onClick={(event) => event.currentTarget.select()}
                  aria-label="Comparison link, selected for copying"
                  className="w-48 rounded-full border border-ink-300 px-3 py-1.5 text-[10px] text-ink-700 focus:border-ink-900 focus:outline-none"
                />
              ) : baselineModel ? (
                <button
                  onClick={copyComparisonLink}
                  className="rounded-full bg-ink-900 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-ink-700"
                >
                  {copyState === "copied" ? "Link copied" : "Copy link"}
                </button>
              ) : null}
              <button
                onClick={clearComparison}
                aria-label="Close comparison"
                className="text-[16px] leading-none text-ink-300 hover:text-ink-900"
              >
                ×
              </button>
            </div>
            {baselineModel && recommendedModels.length > 0 && (
              <div className="mobile-alternatives xl:hidden basis-full flex items-center gap-2 overflow-x-auto pt-1">
                <span className="shrink-0 text-[9px] font-semibold uppercase tracking-[0.12em] text-ink-300">
                  Top alternatives
                </span>
                {recommendedModels.map((model, index) => (
                  <button
                    key={model.slug}
                    onClick={() => selectForComparison(model.slug)}
                    className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] ${
                      candidateModel?.slug === model.slug
                        ? "border-ink-900 bg-ink-900 text-white"
                        : "border-ink-100 text-ink-700"
                    }`}
                  >
                    {index + 1}. {model.displayName}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {limitsOn && (
          <div className="shrink-0 flex flex-wrap items-center gap-x-8 gap-y-2 border-b border-ink-100 py-2.5">
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
            <div className="text-[11px] text-ink-500">
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
                className="text-[11px] text-ink-500 underline decoration-ink-300 underline-offset-2 hover:text-ink-900"
              >
                Clear
              </button>
            )}
          </div>
        )}

        <main className="chart-main flex-1 min-h-0 mt-3 relative">
          <div className="h-full w-full flex gap-3">
            <div ref={chartScrollRef} className="mobile-chart-scroll min-w-0 flex-1 relative overflow-x-auto">
              <div className={`h-full ${baselineModel ? "min-w-[780px]" : "min-w-[860px]"}`}>
                <MapChart
                  models={asOfModels}
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

        {!timeline && (
          <TimeScrubber value={asOf} playing={playing} onChange={setAsOf} onTogglePlay={togglePlay} />
        )}

        <footer className="shrink-0 pt-3 mt-2 border-t border-ink-100 text-[10px] text-ink-300 tracking-wide leading-snug">
          Data from Artificial Analysis. {xc.footnote}
          {yMetric === "coding" &&
            " Cost figures are per Intelligence Index task — AA doesn't publish per-coding-task cost."}
        </footer>
      </div>
    </div>
  );
}
