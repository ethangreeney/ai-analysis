import { useEffect, useMemo, useState } from "react";
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
  return { y, x, q, asOf, maxWait, maxCost, limitsOn: maxWait != null || maxCost != null };
}
const initial = readHash();

const trimNum = (v: number) => String(Number(v.toPrecision(3)));

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

  const colorDomain = useMemo<[number, number]>(() => {
    const v = viewModels.map((m) => xc.colorValue(m)).filter(isPositiveFinite);
    return v.length ? [Math.min(...v), Math.max(...v)] : [1, 10];
  }, [viewModels, xc]);

  const recentCutoffMs = useMemo(() => {
    const cutoff = new Date(effectiveAsOf ?? fetchedAtMs);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - RECENT_WINDOW_MONTHS);
    return cutoff.getTime();
  }, [effectiveAsOf]);

  // Newest = model(s) sharing the latest release date as of the viewed date.
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
    return new Set(dated.filter((item) => item.t === max).map((item) => item.m.slug));
  }, [asOfModels]);
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
    const hash = p.toString();
    const next = hash ? `#${hash}` : "";
    if (next === location.hash) return;
    try {
      history.replaceState(null, "", `${location.pathname}${location.search}${next}`);
    } catch {
      // Sandboxed/about:blank documents (README screenshot capture) refuse
      // replaceState — the URL mirror is best-effort there.
    }
  }, [yMetric, xMode, query, asOf, limitsOn, maxWait, maxCost]);

  const fetchedDate = fmtDate(fetchedAtMs);
  const hovered = hoveredSlug ? viewModels.find((m) => m.slug === hoveredSlug) : null;
  const cardModel = hovered ?? (limited ? bestPick : null);
  const subtitle = xc.subtitle.replace("Up is intelligence", `Up is ${metric.noun}`);

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden">
      <div className="mx-auto max-w-[1400px] w-full px-4 sm:px-8 md:px-12 pt-6 pb-3 flex-1 flex flex-col min-h-0">
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

        <div className="shrink-0 flex items-center justify-between gap-6 border-b border-ink-100 py-3">
          <div className="flex items-center gap-2 md:gap-3">
            <SegmentSwitch
              options={(Object.keys(Y_METRICS) as YMetric[]).map((k) => ({
                value: k,
                label: Y_METRICS[k].label,
              }))}
              value={yMetric}
              onChange={setYMetric}
            />
            <SegmentSwitch
              options={(Object.keys(X_MODES) as XMode[]).map((k) => ({
                value: k,
                label: X_MODES[k].label,
              }))}
              value={xMode}
              onChange={setXMode}
            />
          </div>
          <div className="flex items-center gap-4 md:gap-6">
            <div className="hidden md:block">
              <FrontierLegend label={xc.frontierLabel} note={xc.frontierNote(metric.noun)} />
            </div>
            <div className="hidden md:block">
              <ColorLegend title={xc.colorTitle} domain={colorDomain} fmt={xc.fmtColor} />
            </div>
            <button
              onClick={() => setLimitsOn((v) => !v)}
              className={`px-2.5 py-1 text-[11px] rounded-full border transition-colors ${
                limitsOn
                  ? "bg-ink-900 text-white border-ink-900 font-medium"
                  : "border-ink-100 text-ink-500 hover:text-ink-900"
              }`}
            >
              Limits
            </button>
            <SearchBox
              value={query}
              onChange={setQuery}
              matchCount={matchCount}
              offViewCount={offViewCount}
            />
          </div>
        </div>

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

        <main className="flex-1 min-h-0 mt-3 relative">
          <div className="h-full w-full relative overflow-x-auto">
            <div className="h-full min-w-[860px]">
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
