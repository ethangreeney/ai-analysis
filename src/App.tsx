import { useEffect, useMemo, useRef, useState } from "react";
import { MapChart } from "./MapChart";
import { Changelog } from "./Changelog";
import { ComparisonCard } from "./ComparisonCard";
import {
  Model,
  YMetric,
  XMode,
  Y_METRICS,
  X_MODES,
  RelativeStat,
  relativeStats,
  allModels,
  fetchedAtMs,
  fmtCost,
  fmtDate,
  fmtSeconds,
  isPositiveFinite,
  rampColor,
} from "./model";

const RECENT_WINDOW_MONTHS = 6;
const DAY_MS = 86_400_000;
const REPO_URL = "https://github.com/ethangreeney/ai-analysis";
const CARD_SHADOW = "0 1px 3px rgba(23,20,10,0.04), 0 8px 24px rgba(23,20,10,0.04)";
const CHART_WIDTH = 1280;
const CHART_BASE_HEIGHT = 720;
const SAGE = { background: "#eaeee2", color: "#5b6b4c" };

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

// Shareable state lives in the URL hash: #y=coding&x=cost&q=claude&from=a&to=b
function readHash() {
  const p = new URLSearchParams(window.location.hash.slice(1));
  const y: YMetric = p.get("y") === "coding" ? "coding" : "intelligence";
  const xRaw = p.get("x");
  const x: XMode = xRaw === "cost" || xRaw === "timeline" ? xRaw : "speed";
  const q = p.get("q") ?? "";
  const knownSlugs = new Set(allModels.map((m) => m.slug));
  const from = p.get("from");
  const to = p.get("to");
  const comparedSlugs: string[] = [];
  if (from != null && knownSlugs.has(from)) {
    comparedSlugs.push(from);
    if (to != null && to !== from && knownSlugs.has(to)) comparedSlugs.push(to);
  }
  return { y, x, q, comparedSlugs };
}
const initial = readHash();

function AlternativesList({
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
    <div className="alternatives-panel px-1">
      <h2 className="text-[12.5px] font-semibold leading-none text-ink-900">Top alternatives</h2>
      <div className="mt-1.5 divide-y divide-ink-100">
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
    </div>
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

function HoverCard({ m, yMetric }: { m: Model; yMetric: YMetric }) {
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
      <div className="text-[11.5px] text-ink-500">{m.creator}</div>
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

/**
 * The one control: typing spotlights matches on the map, and picking a result
 * drops that model straight into the comparison. Search and "which model do I
 * use?" were the same question all along.
 */
function SearchBox({
  value,
  onChange,
  results,
  onSelect,
  matchCount,
  offViewCount,
}: {
  value: string;
  onChange: (v: string) => void;
  results: Model[];
  onSelect: (slug: string) => void;
  matchCount: number | null;
  offViewCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const active = value.trim().length > 0;
  const menuOpen = open && active && results.length > 0;

  useEffect(() => {
    if (!menuOpen) return;
    const onMouseDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [menuOpen]);

  const pick = (slug: string) => {
    onSelect(slug);
    onChange("");
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
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
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={menuOpen}
          aria-controls="model-search-results"
          aria-activedescendant={
            menuOpen && results[activeIndex] ? `search-option-${results[activeIndex].slug}` : undefined
          }
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setActiveIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && active) {
              event.stopPropagation();
              onChange("");
              setOpen(false);
            } else if (event.key === "ArrowDown" && results.length) {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((i) => Math.min(i + 1, results.length - 1));
            } else if (event.key === "ArrowUp" && results.length) {
              event.preventDefault();
              setActiveIndex((i) => Math.max(i - 1, 0));
            } else if (event.key === "Enter" && menuOpen && results[activeIndex]) {
              event.preventDefault();
              pick(results[activeIndex].slug);
              event.currentTarget.blur();
            }
          }}
          placeholder="Search or compare a model…"
          aria-label="Search models"
          className="h-8 w-full rounded-full border border-ink-100 bg-card pl-8 pr-8 text-[12px] text-ink-900 placeholder:text-ink-300 transition-colors focus:border-ink-300 focus:outline-none sm:w-56"
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
        {menuOpen && (
          <div
            id="model-search-results"
            role="listbox"
            className="model-picker-menu absolute left-0 top-full z-40 mt-2 max-h-72 w-[calc(100vw-2rem)] max-w-80 overflow-y-auto rounded-xl border border-ink-100 bg-card p-1.5"
            style={{ boxShadow: "0 1px 2px rgba(23,20,10,0.05), 0 16px 40px rgba(23,20,10,0.10)" }}
          >
            {results.map((model, index) => (
              <button
                key={model.slug}
                id={`search-option-${model.slug}`}
                role="option"
                aria-selected={index === activeIndex}
                tabIndex={-1}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => pick(model.slug)}
                className={`tap-target flex w-full items-baseline justify-between gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${
                  index === activeIndex ? "bg-ink-50" : "hover:bg-ink-50"
                }`}
              >
                <span className="min-w-0 truncate text-[12px] font-medium leading-tight text-ink-900">
                  {model.displayName}
                </span>
                <span className="shrink-0 text-[11px] text-ink-300">{model.creator}</span>
              </button>
            ))}
          </div>
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

export default function App() {
  const [yMetric, setYMetric] = useState<YMetric>(initial.y);
  const [xMode, setXMode] = useState<XMode>(initial.x);
  const [hoveredSlug, setHoveredSlug] = useState<string | null>(null);
  const [query, setQuery] = useState(initial.q);
  const [comparedSlugs, setComparedSlugs] = useState<string[]>(initial.comparedSlugs);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const chartScrollRef = useRef<HTMLDivElement>(null);
  const chartCanvasRef = useRef<HTMLDivElement>(null);
  const [chartHeight, setChartHeight] = useState(CHART_BASE_HEIGHT);

  // The chart draws on a fixed 1280-unit width and takes its height from the
  // space it actually has, so it fills the card instead of letterboxing inside
  // it. Clamped so extreme layouts never flatten or stretch the plot.
  useEffect(() => {
    const el = chartCanvasRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width < 1 || height < 1) return;
      const next = Math.round(
        Math.min(1150, Math.max(540, (CHART_WIDTH * height) / width)),
      );
      setChartHeight((prev) => (Math.abs(prev - next) > 6 ? next : prev));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Comparison isn't a mode you switch on — clicking any dot starts one.
  const comparisonOn = comparedSlugs.length > 0;

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

  // The search dropdown offers what the current view can actually plot, so a
  // pick never lands in a comparison that immediately says "not in this view".
  const searchResults = useMemo(() => {
    if (!matchedSlugs) return [];
    return viewModels.filter((m) => matchedSlugs.has(m.slug)).slice(0, 7);
  }, [matchedSlugs, viewModels]);

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
      setComparedSlugs(h.comparedSlugs);
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
  }, [yMetric, xMode, query, comparedSlugs]);

  useEffect(() => setCopyState("idle"), [yMetric, xMode, query, comparedSlugs]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !comparisonOn) return;
      setComparedSlugs([]);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [comparisonOn]);

  const selectForComparison = (slug: string) => {
    setComparedSlugs((current) => {
      if (current[0] === slug) return current.slice(1);
      if (current[1] === slug) return current.slice(0, 1);
      if (!current[0]) return [slug];
      return [current[0], slug];
    });
    setHoveredSlug(null);
  };
  const clearComparison = () => setComparedSlugs([]);
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
  const subtitle = xc.subtitle.replace("Up is intelligence", `Up is ${metric.noun}`);
  const stats =
    baselineModel && candidateModel
      ? relativeStats(baselineModel, candidateModel, metric)
      : [];
  const comparisonUnavailable = comparedModels.find(
    (model) => !viewModels.some((visible) => visible.slug === model.slug),
  );
  const shareUrl = window.location.href;

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
          <div className="comparison-mobile-hide hidden shrink-0 sm:block">
            <Changelog models={allModels} onSelect={selectForComparison} />
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
          {/* Full width on phones — squeezed beside the axis switch there was
              barely room for the word "Search". */}
          <div className="flex w-full min-w-0 items-center gap-2 sm:ml-auto sm:w-auto sm:gap-3">
            <SearchBox
              value={query}
              onChange={setQuery}
              results={searchResults}
              onSelect={selectForComparison}
              matchCount={matchCount}
              offViewCount={offViewCount}
            />
          </div>
        </div>

        {baselineModel && (
          <div className="mt-3 shrink-0 lg:hidden">
            <ComparisonCard
              baseline={baselineModel}
              candidate={candidateModel}
              stats={comparisonUnavailable ? [] : stats}
              metric={metric}
              unavailableName={comparisonUnavailable?.displayName ?? null}
              copyState={copyState}
              shareUrl={shareUrl}
              onSwap={() =>
                setComparedSlugs((current) =>
                  current.length === 2 ? [current[1], current[0]] : current,
                )
              }
              onClearBaseline={() => setComparedSlugs((current) => current.slice(1))}
              onClearCandidate={() => setComparedSlugs((current) => current.slice(0, 1))}
              onClose={clearComparison}
              onCopyLink={copyComparisonLink}
            />
            {quickAlternatives.length > 0 && (
              <div className="mobile-alternatives lg:hidden mt-2 flex max-w-[520px] items-stretch gap-2 overflow-x-auto">
                {quickAlternatives.map(({ model }, index) => (
                  <button
                    key={model.slug}
                    onClick={() => selectForComparison(model.slug)}
                    className={`${
                      index >= 3 ? "comparison-mobile-hide " : ""
                    }tap-target shrink-0 rounded-xl border px-3 py-1.5 text-left transition-colors ${
                      candidateModel?.slug === model.slug
                        ? "border-ink-900 bg-ink-900 text-paper"
                        : "border-ink-100 bg-card text-ink-900 hover:border-ink-300"
                    }`}
                  >
                    <span className="block whitespace-nowrap text-[11.5px] font-semibold leading-tight">
                      {model.displayName}
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
              {/* Wide screens fit the whole chart, no scrolling. Narrow ones
                  scroll a canvas sized from the height available — sizing it to
                  a fixed width instead just letterboxes the plot inside a
                  mostly empty scroll area. */}
              <div
                ref={chartCanvasRef}
                className="h-full w-full max-lg:aspect-[16/9] max-lg:w-auto max-lg:min-w-full"
              >
                <MapChart
                  height={chartHeight}
                  models={allModels}
                  yMetric={yMetric}
                  xMode={xMode}
                  onHover={setHoveredSlug}
                  hoveredSlug={hoveredSlug}
                  matchedSlugs={matchedSlugs}
                  newestSlugs={newestSlugs}
                  recentCutoffMs={recentCutoffMs}
                  colorDomain={colorDomain}
                  comparedSlugs={comparedSlugs}
                  alternativeSlugs={alternativeSlugs}
                  onSelect={selectForComparison}
                />
              </div>
              {hovered && <HoverCard m={hovered} yMetric={yMetric} />}
            </div>
            {baselineModel && (
              <aside className="hidden lg:flex w-[20rem] xl:w-[23rem] shrink-0 flex-col gap-3 self-stretch overflow-y-auto border-l border-ink-100 bg-paper p-3.5">
                <ComparisonCard
                  baseline={baselineModel}
                  candidate={candidateModel}
                  stats={comparisonUnavailable ? [] : stats}
                  metric={metric}
                  unavailableName={comparisonUnavailable?.displayName ?? null}
                  copyState={copyState}
                  shareUrl={shareUrl}
                  onSwap={() =>
                    setComparedSlugs((current) =>
                      current.length === 2 ? [current[1], current[0]] : current,
                    )
                  }
                  onClearBaseline={() => setComparedSlugs((current) => current.slice(1))}
                  onClearCandidate={() => setComparedSlugs((current) => current.slice(0, 1))}
                  onClose={clearComparison}
                  onCopyLink={copyComparisonLink}
                />
                <AlternativesList
                  baseline={baselineModel}
                  alternatives={recommendations}
                  selectedSlug={candidateModel?.slug ?? null}
                  yMetric={yMetric}
                  onSelect={selectForComparison}
                />
              </aside>
            )}
          </div>
        </main>

        <footer className="comparison-mobile-hide shrink-0 pt-2.5 mt-3 border-t border-ink-100">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <SegmentSwitch
              ariaLabel="Score"
              options={(Object.keys(Y_METRICS) as YMetric[]).map((k) => ({
                value: k,
                label: Y_METRICS[k].label,
              }))}
              value={yMetric}
              onChange={setYMetric}
            />
            <div className="hidden md:block">
              <FrontierLegend label={xc.frontierLabel} note={xc.frontierNote(metric.noun)} />
            </div>
            <div className="hidden lg:block">
              <ColorLegend title={xc.colorTitle} domain={colorDomain} fmt={xc.fmtColor} />
            </div>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="ml-auto text-[11px] text-ink-500 underline decoration-ink-300 underline-offset-2 transition-colors hover:text-ink-900"
            >
              Data from Artificial Analysis · Source
            </a>
          </div>
          <p className="hidden xl:block pt-2 text-[11px] leading-snug text-ink-300">
            {xc.footnote}
            {yMetric === "coding" &&
              " Cost figures are per Intelligence Index task — AA doesn’t publish per-coding-task cost."}
          </p>
        </footer>
      </div>
    </div>
  );
}
