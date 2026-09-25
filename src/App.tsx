import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MapChart } from "./MapChart";
import { Changelog } from "./Changelog";
import { ComparisonCard } from "./ComparisonCard";
import { ReleaseStrip } from "./ReleaseStrip";
import { ProgressPanel } from "./ProgressPanel";
import { PROGRESS_SPANS, ProgressSpan, progressSince } from "./progress";
import {
  focusFor,
  predecessorOf,
  recentReleases,
  type FocusScope,
  type Release,
} from "./releases";
import { FocusPanel } from "./FocusPanel";
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
  intelligenceIndexVersion,
  fmtCost,
  fmtDate,
  isPositiveFinite,
  makeColorNorm,
  nameParts,
  LABS,
  OTHER_LAB_COLOR,
  labColor,
  BAND_COLORS,
  NO_DATA_COLOR,
  bandIndex,
  type ColorBy,
  type XModeConfig,
  familyOf,
} from "./model";

const RECENT_WINDOW_MONTHS = 6;
const DAY_MS = 86_400_000;
const REPO_URL = "https://github.com/ethangreeney/ai-analysis";
const CARD_SHADOW = "0 1px 3px rgba(14,15,17,0.04), 0 8px 24px rgba(14,15,17,0.04)";
const CHART_WIDTH = 1280;
const CHART_BASE_HEIGHT = 720;
const UPGRADE = "#17804a";
const HOVER_CARD_W = 244;

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

// Shareable state lives in the URL hash: #y=coding&x=cost&q=claude&from=a&to=b&cap=1.5
function readHash() {
  const p = new URLSearchParams(window.location.hash.slice(1));
  const y: YMetric = p.get("y") === "coding" ? "coding" : "intelligence";
  const xRaw = p.get("x");
  const x: XMode = xRaw === "cost" || xRaw === "timeline" ? xRaw : "speed";
  const q = p.get("q") ?? "";
  const capRaw = Number(p.get("cap"));
  const cap = isPositiveFinite(capRaw) ? capRaw : null;
  const knownSlugs = new Set(allModels.map((m) => m.slug));
  const from = p.get("from");
  const to = p.get("to");
  const comparedSlugs: string[] = [];
  if (from != null && knownSlugs.has(from)) {
    comparedSlugs.push(from);
    if (to != null && to !== from && knownSlugs.has(to)) comparedSlugs.push(to);
  }
  const c: ColorBy = p.get("c") === "lab" ? "lab" : "value";
  const f = p.get("f");
  const focusKey = f && allModels.some((m) => `${m.creator}|${familyOf(m)}` === f) ? f : null;
  const focusScope: FocusScope = p.get("fs") === "lineup" ? "lineup" : "release";
  return { y, x, q, cap, comparedSlugs, c, focusKey, focusScope };
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
                      className="shrink-0 text-[10.5px] font-medium leading-none"
                      style={{ color: tier === "clear" ? UPGRADE : "#6a6f78" }}
                    >
                      {tier === "clear" ? "Better on all" : "Small tradeoff"}
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
  const trackRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number; ready: boolean } | null>(null);

  // The white thumb slides between segments instead of snapping, so a switch
  // reads as one control changing state rather than two buttons swapping.
  useLayoutEffect(() => {
    const track = trackRef.current;
    const button = track?.querySelector<HTMLButtonElement>(`[data-value="${value}"]`);
    if (!track || !button) return;
    const measure = () =>
      setThumb((prev) => ({
        left: button.offsetLeft,
        width: button.offsetWidth,
        ready: prev != null,
      }));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => observer.disconnect();
  }, [value]);

  return (
    <div
      ref={trackRef}
      role="group"
      aria-label={ariaLabel}
      className="relative flex w-fit items-center gap-0.5 rounded-full bg-ink-50 p-0.5 ring-1 ring-inset ring-ink-100/70"
    >
      {thumb && (
        <span
          aria-hidden
          className="absolute top-0.5 bottom-0.5 rounded-full bg-card shadow-[0_1px_2px_rgba(14,15,17,0.08),0_2px_6px_rgba(14,15,17,0.04)]"
          style={{
            left: thumb.left,
            width: thumb.width,
            transition: thumb.ready
              ? "left 320ms cubic-bezier(0.22, 1, 0.36, 1), width 320ms cubic-bezier(0.22, 1, 0.36, 1)"
              : "none",
          }}
        />
      )}
      {options.map((opt) => (
        <button
          key={opt.value}
          data-value={opt.value}
          onClick={() => onChange(opt.value)}
          aria-pressed={value === opt.value}
          className={`tap-target relative rounded-full border border-transparent px-3 py-1.5 text-[12px] leading-none transition-colors duration-200 ${
            value === opt.value ? "font-semibold text-ink-900" : "text-ink-500 hover:text-ink-900"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/**
 * What the dot colours mean, and a switch between the two meanings: the third
 * number (cost, or wait in Cost view), or who made the model. Pointing at a
 * swatch lights up those models on the map.
 */
function ColorKey({
  xc,
  colorBy,
  onColorBy,
  onPreview,
}: {
  xc: XModeConfig;
  colorBy: ColorBy;
  onColorBy: (c: ColorBy) => void;
  onPreview: (key: string | null) => void;
}) {
  const items =
    colorBy === "lab"
      ? [...LABS, { name: "Other", color: OTHER_LAB_COLOR }].map((l) => ({
          key: l.name,
          label: l.name,
          color: l.color,
        }))
      : [
          ...xc.bandLabels.map((label, i) => ({ key: String(i), label, color: BAND_COLORS[i] })),
          { key: "none", label: "No data", color: NO_DATA_COLOR },
        ];
  const valueLabel = xc.colorTitle === "Wait" ? "Wait" : "Cost";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <div
        role="group"
        aria-label="Colour dots by"
        className="flex items-center gap-0.5 rounded-md bg-ink-50 p-0.5 ring-1 ring-inset ring-ink-100/70"
      >
        {(
          [
            ["value", valueLabel],
            ["lab", "Lab"],
          ] as [ColorBy, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => onColorBy(value)}
            aria-pressed={colorBy === value}
            className={`rounded px-2 py-1 text-[11px] leading-none transition-colors ${
              colorBy === value
                ? "bg-card font-medium text-ink-900 shadow-[0_1px_2px_rgba(14,15,17,0.08)]"
                : "text-ink-500 hover:text-ink-900"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <ul
        className="flex flex-wrap items-center gap-x-3 gap-y-1"
        aria-label={colorBy === "lab" ? "Labs" : `${xc.colorTitle} bands`}
      >
        {items.map((item) => (
          <li
            key={`${colorBy}-${item.key}`}
            className="flex cursor-default items-center gap-1.5 text-[11.5px] tabular-nums text-ink-700 transition-colors hover:text-ink-900"
            onMouseEnter={() => onPreview(item.key)}
            onMouseLeave={() => onPreview(null)}
          >
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: item.color }} aria-hidden />
            {item.label}
          </li>
        ))}
      </ul>
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
          stroke="#3a3d43"
          strokeWidth="1.4"
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
// end with the maximum, so the ramp can be decoded to actual values. The
// ramp doubles as a cap: drag its handle in from the right and everything
// pricier (or slower, in Cost view) drops out of the map, so the frontier
// answers "what's the best I can get for this much?".
function ColorLegend({
  title,
  domain,
  fmt,
  cap,
  onCapChange,
  bands,
  banded,
}: {
  title: string;
  domain: [number, number];
  fmt: (v: number) => string;
  cap: number | null;
  onCapChange: (cap: number | null) => void;
  /** Band edges; when the dots wear these colours the track does too. */
  bands: number[];
  banded: boolean;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  // While dragging, the handle follows the pointer directly and the cap is
  // committed once per frame — the chart behind it is far heavier than the
  // handle, and must never hold it back.
  const [draft, setDraft] = useState<number | null>(null);
  const pending = useRef<number | null>(null);
  const frame = useRef(0);
  // Log mapping: budgets and waits are felt in multiples, not dollars.
  const norm = makeColorNorm(domain);
  const committed = cap == null ? 1 : norm(cap);
  const t = draft ?? committed;
  const dragging = draft != null;
  const active = cap != null;

  const capAt = (fraction: number) => {
    const u = Math.max(0, Math.min(1, fraction));
    // Parking the handle back at the right end clears the cap entirely.
    onCapChange(u >= 0.985 ? null : norm.invert(u));
  };
  const fractionAt = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width < 1) return null;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };
  const dragTo = (clientX: number) => {
    const u = fractionAt(clientX);
    if (u == null) return;
    setDraft(u);
    pending.current = u;
    if (!frame.current) {
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        if (pending.current != null) capAt(pending.current);
      });
    }
  };
  const endDrag = () => {
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = 0;
    if (pending.current != null) capAt(pending.current);
    pending.current = null;
    setDraft(null);
  };

  return (
    <div className="flex items-center gap-3" title="Drag left to set a budget">
      <span className="text-[12px] leading-none text-ink-500">
        {title === "Wait" ? "Max wait" : "Max cost per task"}
      </span>
      <div
        ref={trackRef}
        className="relative h-1 w-36 cursor-ew-resize touch-none rounded-full py-2.5 -my-2.5 box-content xl:w-44"
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          dragTo(e.clientX);
        }}
        onPointerMove={(e) => dragging && dragTo(e.clientX)}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {banded ? (
          <>
            {/* The track is the legend: the same bands the dots wear. */}
            <div
              className="h-1 rounded-full"
              style={{
                background: `linear-gradient(to right, ${BAND_COLORS.map((c, i) => {
                  const from = i === 0 ? 0 : norm(bands[i - 1]) * 100;
                  const to = i === bands.length ? 100 : norm(bands[i]) * 100;
                  return `${c} ${from.toFixed(1)}% ${to.toFixed(1)}%`;
                }).join(", ")})`,
              }}
            />
            {/* Everything past the cap is out of play: wash it out. */}
            <div
              className="pointer-events-none absolute right-0 top-2.5 h-1 rounded-r-full bg-card/80"
              style={{ left: `${t * 100}%`, opacity: active || dragging ? 1 : 0 }}
            />
          </>
        ) : (
          <>
            <div className="h-1 rounded-full bg-ink-100" />
            <div
              className={`pointer-events-none absolute left-0 top-2.5 h-1 rounded-full transition-colors ${
                active || dragging ? "bg-ink-900" : "bg-ink-300"
              }`}
              style={{ width: `${t * 100}%` }}
            />
          </>
        )}
        <div
          role="slider"
          tabIndex={0}
          aria-label={`${title} cap`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(t * 100)}
          aria-valuetext={active ? `up to ${fmt(cap)}` : "no cap"}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") capAt(t - 0.03);
            else if (e.key === "ArrowRight") capAt(t + 0.03);
            else if (e.key === "Home" || e.key === "Escape") onCapChange(null);
            else return;
            e.preventDefault();
          }}
          className={`absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border bg-card outline-none transition-[transform,border-color,box-shadow] duration-200 focus-visible:ring-2 focus-visible:ring-ink-300 active:cursor-grabbing ${
            dragging
              ? "scale-110 border-ink-900 shadow-[0_2px_8px_rgba(14,15,17,0.22)]"
              : active
                ? "border-ink-900 shadow-[0_1px_3px_rgba(14,15,17,0.18)]"
                : "border-ink-300 shadow-[0_1px_3px_rgba(14,15,17,0.14)] hover:scale-110"
          }`}
          style={{ left: `${t * 100}%` }}
        />
      </div>
      <span
        className={`min-w-[3rem] text-[12px] leading-none tabular-nums ${
          active || dragging ? "font-medium text-ink-900" : "text-ink-500"
        }`}
      >
        {active ? `≤ ${fmt(cap)}` : dragging ? `≤ ${fmt(norm.invert(t))}` : "Any"}
      </span>
      {active && (
        <button
          type="button"
          onClick={() => onCapChange(null)}
          className="-ml-1 rounded px-1 text-[11px] text-ink-500 transition-colors hover:text-ink-900"
          aria-label="Clear cap"
        >
          ×
        </button>
      )}
    </div>
  );
}

/** A compact read-out that sits beside the dot you're pointing at. */
function HoverCard({
  m,
  yMetric,
  position,
  baseline,
  showLab = false,
}: {
  showLab?: boolean;
  m: Model;
  yMetric: YMetric;
  position: { left: number; top: number };
  baseline: Model | null;
}) {
  const active = Y_METRICS[yMetric];
  const other = Y_METRICS[yMetric === "intelligence" ? "coding" : "intelligence"];
  const { base, effort } = nameParts(m);
  const stats = [
    { label: active.noun, value: fmtIndex(active.value(m)) },
    {
      label: isPositiveFinite(m.e2eLatency) ? "wait" : "not timed yet",
      value: isPositiveFinite(m.e2eLatency) ? `${m.e2eLatency.toFixed(m.e2eLatency < 10 ? 1 : 0)}s` : "—",
    },
    { label: "per task", value: fmtCost(m.costPerTask) },
  ];
  const otherValue = other.value(m);
  const hint =
    baseline == null
      ? "Click to compare"
      : baseline.slug === m.slug
        ? "Click to remove"
        : `Click to compare with ${nameParts(baseline).base}`;

  return (
    <div
      key={m.slug}
      className="hover-card pointer-events-none absolute z-20 rounded-xl border border-ink-100 bg-card/95 px-3.5 pb-2.5 pt-3 text-ink-900 backdrop-blur"
      style={{
        left: position.left,
        top: position.top,
        width: HOVER_CARD_W,
        boxShadow: "0 1px 2px rgba(14,15,17,0.05), 0 14px 36px rgba(14,15,17,0.12)",
      }}
    >
      <div className="flex items-center justify-between gap-3 text-[11px] leading-none text-ink-500">
        <span className="flex min-w-0 items-center gap-1.5">
          {showLab && (
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: labColor(m.creator) }} aria-hidden />
          )}
          <span className="truncate">{m.creator}</span>
        </span>
        <span className="shrink-0 tabular-nums">{fmtDate(m.releaseMs)}</span>
      </div>
      <div className="mt-1.5 text-[14px] font-semibold leading-tight text-ink-900">
        {base}
        {effort && <span className="font-normal text-ink-500"> {effort}</span>}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {stats.map((stat) => (
          <div key={stat.label} className="min-w-0">
            <div className="text-[15px] font-semibold leading-none tabular-nums text-ink-900">
              {stat.value}
            </div>
            <div className="mt-1 truncate text-[10.5px] leading-none text-ink-500">{stat.label}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-ink-100 pt-2 text-[10.5px] leading-none">
        <span className="truncate text-ink-500">{hint}</span>
        {isPositiveFinite(otherValue) && (
          <span className="shrink-0 tabular-nums text-ink-300">
            {other.rowLabel.replace(" index", "")} {fmtIndex(otherValue)}
          </span>
        )}
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
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  results: Model[];
  onSelect: (slug: string) => void;
  matchCount: number | null;
  offViewCount: number;
  placeholder: string;
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
          stroke="#b3b7be"
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
          placeholder={placeholder}
          aria-label="Search models"
          className="h-8 w-full rounded-full border border-ink-100 bg-card pl-8 pr-8 text-[12px] text-ink-900 shadow-[0_1px_2px_rgba(14,15,17,0.04)] placeholder:text-ink-500 transition-[border-color,box-shadow] focus:border-ink-300 focus:shadow-[0_0_0_4px_rgba(14,15,17,0.04)] focus:outline-none sm:w-60"
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
            style={{ boxShadow: "0 1px 2px rgba(14,15,17,0.05), 0 16px 40px rgba(14,15,17,0.10)" }}
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
  const [colorBy, setColorBy] = useState<ColorBy>(initial.c);
  // A release in focus: its own frontier drawn over the map, details in the rail.
  const [focusKey, setFocusKey] = useState<string | null>(initial.focusKey);
  const [focusScope, setFocusScope] = useState<FocusScope>(initial.focusScope);
  // Cap on whatever the color ramp encodes — cost per task in Speed and
  // Timeline views, wait in Cost view. Cleared when the axis changes meaning.
  const [colorCap, setColorCap] = useState<number | null>(initial.cap);
  const changeXMode = (next: XMode) => {
    setXMode(next);
    setColorCap(null);
  };
  const [hoveredSlug, setHoveredSlug] = useState<string | null>(null);
  const [hoverPos, setHoverPos] = useState<{ left: number; top: number } | null>(null);
  // Pointing at a release card spotlights every variant of it on the map.
  const [previewSlugs, setPreviewSlugs] = useState<Set<string> | null>(null);
  const [query, setQuery] = useState(initial.q);
  const [comparedSlugs, setComparedSlugs] = useState<string[]>(initial.comparedSlugs);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const chartScrollRef = useRef<HTMLDivElement>(null);
  const chartCanvasRef = useRef<HTMLDivElement>(null);
  const [chartHeight, setChartHeight] = useState(CHART_BASE_HEIGHT);
  const [chartWidth, setChartWidth] = useState(CHART_WIDTH);

  // The chart draws at the size it's shown, so its text is real pixels and
  // doesn't shrink when the side rail takes some width. Below a minimum width
  // (phones) it keeps a wider canvas and scales down instead of cramming.
  // Height comes from the space available, clamped so extreme layouts never
  // flatten or stretch the plot.
  useEffect(() => {
    const el = chartCanvasRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width < 1 || height < 1) return;
      const w = Math.round(Math.min(1600, Math.max(960, width)));
      const next = Math.round(Math.min(1150, Math.max(540, (w * height) / width)));
      setChartWidth((prev) => (Math.abs(prev - w) > 6 ? w : prev));
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

  // Six fit the side rail; the phone header keeps it to three.
  const releases = useMemo(() => recentReleases(allModels, metric, { limit: 6 }), [metric]);
  const activeReleaseKey =
    releases.find(
      (release) =>
        comparedSlugs[comparedSlugs.length - 1] === release.flagship.slug &&
        (release.predecessor ? comparedSlugs[0] === release.predecessor.slug : comparedSlugs.length === 1),
    )?.key ?? null;
  /** A release opens as the upgrade question: what it replaces → the release. */
  const openModelAsUpgrade = (model: Model) => {
    const before = predecessorOf(model, allModels, metric);
    setQuery("");
    setPreviewSlugs(null);
    setComparedSlugs(before ? [before.slug, model.slug] : [model.slug]);
  };
  const [progressSpan, setProgressSpan] = useState<ProgressSpan>("1y");
  const progress = useMemo(
    () => (xMode === "timeline" ? progressSince(allModels, metric, progressSpan) : null),
    [xMode, metric, progressSpan],
  );
  const compareModels = (pair: [Model, Model]) => {
    setQuery("");
    setPreviewSlugs(null);
    setComparedSlugs([pair[0].slug, pair[1].slug]);
  };
  const focus = useMemo(
    () => (focusKey ? focusFor(focusKey, focusScope, allModels, metric) : null),
    [focusKey, focusScope, metric],
  );
  const focusSets = useMemo(() => {
    if (!focus) return null;
    const lit = new Set(focus.models.map((m) => m.slug));
    const ghost = new Set(focus.ghost.map((m) => m.slug));
    return { lit, ghost, all: new Set([...lit, ...ghost]) };
  }, [focus]);
  /** Picking a release puts it in focus; picking it again lets go. */
  const openRelease = (release: Release) => {
    setQuery("");
    setPreviewSlugs(null);
    setComparedSlugs([]);
    if (release.key === focusKey) {
      setFocusKey(null);
      return;
    }
    setFocusKey(release.key);
    setFocusScope("release");
  };
  const focusModelFamily = (model: Model) => {
    setQuery("");
    setPreviewSlugs(null);
    setComparedSlugs([]);
    setFocusKey(`${model.creator}|${familyOf(model)}`);
    setFocusScope("release");
  };

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
      setColorCap(h.cap);
      setQuery(h.q);
      setComparedSlugs(h.comparedSlugs);
      setColorBy(h.c);
      setFocusKey(h.focusKey);
      setFocusScope(h.focusScope);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Mirror the view into the URL hash so any state is shareable. Debounced:
  // a drag produces dozens of updates a second, and Chrome starts ignoring
  // replaceState calls when they come that fast.
  useEffect(() => {
    const timer = setTimeout(() => {
      const p = new URLSearchParams();
      if (yMetric !== "intelligence") p.set("y", yMetric);
      if (xMode !== "speed") p.set("x", xMode);
      if (query.trim()) p.set("q", query.trim());
      if (comparedSlugs[0]) p.set("from", comparedSlugs[0]);
      if (comparedSlugs[1]) p.set("to", comparedSlugs[1]);
      if (colorCap != null) p.set("cap", colorCap.toPrecision(3));
      if (colorBy === "lab") p.set("c", "lab");
      if (focusKey) {
        p.set("f", focusKey);
        if (focusScope === "lineup") p.set("fs", "lineup");
      }
      const hash = p.toString();
      const next = hash ? `#${hash}` : "";
      if (next === location.hash) return;
      try {
        history.replaceState(null, "", `${location.pathname}${location.search}${next}`);
      } catch {
        // Sandboxed/about:blank documents (README screenshot capture) refuse
        // replaceState — the URL mirror is best-effort there.
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [yMetric, xMode, query, comparedSlugs, colorCap, colorBy, focusKey, focusScope]);

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

  // Anchor the hover card beside the dot, flipping to the left near the right
  // edge — reading a value shouldn't mean looking to the far corner.
  useLayoutEffect(() => {
    const container = chartScrollRef.current;
    const dot = hoveredSlug
      ? container?.querySelector<SVGCircleElement>(`[data-model-slug="${hoveredSlug}"] .dot-core`)
      : null;
    if (!container || !dot) {
      setHoverPos(null);
      return;
    }
    const box = container.getBoundingClientRect();
    const rect = dot.getBoundingClientRect();
    const cx = rect.left - box.left + container.scrollLeft + rect.width / 2;
    const cy = rect.top - box.top + rect.height / 2;
    const gap = rect.width / 2 + 16;
    const fitsRight = cx + gap + HOVER_CARD_W < container.scrollLeft + container.clientWidth - 8;
    const left = fitsRight ? cx + gap : cx - gap - HOVER_CARD_W;
    const top = Math.max(8, Math.min(container.clientHeight - 150, cy - 34));
    setHoverPos({ left, top });
  }, [hoveredSlug, xMode, yMetric, chartHeight]);
  const searchPlaceholder = !baselineModel
    ? "Search models…"
    : !candidateModel
      ? "Compare it with…"
      : "Search models…";
  const stats =
    baselineModel && candidateModel
      ? relativeStats(baselineModel, candidateModel, metric)
      : [];
  const comparisonUnavailable = comparedModels.find(
    (model) => !viewModels.some((visible) => visible.slug === model.slug),
  );
  const shareUrl = window.location.href;
  const focusPanel = (compact: boolean) =>
    focus && (
      <FocusPanel
        focus={focus}
        metric={metric}
        compact={compact}
        onScope={setFocusScope}
        onClose={() => setFocusKey(null)}
        onCompare={() => openModelAsUpgrade(focus.release.flagship)}
        onHoverModel={setHoveredSlug}
        onPickModel={(m) =>
          focus.scope === "release" ? openModelAsUpgrade(m) : setComparedSlugs([m.slug])
        }
      />
    );
  const releaseList = (variant: "header" | "rail") => (
    <ReleaseStrip
      variant={variant}
      releases={variant === "rail" ? releases : releases.slice(0, 3)}
      metric={metric}
      activeKey={focusKey ?? activeReleaseKey}
      onOpen={openRelease}
      onPreview={(release) =>
        setPreviewSlugs(release ? new Set(release.models.map((m) => m.slug)) : null)
      }
      allReleases={
        <Changelog
          models={allModels}
          panelWidth={variant === "rail" ? "w-[16rem] 2xl:w-[18rem]" : "w-80"}
          onSelect={(slug) => {
            const model = allModels.find((m) => m.slug === slug);
            if (model) focusModelFamily(model);
          }}
        />
      }
    />
  );

  return (
    <div
      className={`app-shell h-screen w-full flex flex-col overflow-hidden ${
        comparisonOn ? "comparison-active" : ""
      }`}
    >
      <div className="app-frame mx-auto max-w-[1400px] 2xl:max-w-[1840px] w-full px-4 sm:px-8 md:px-12 2xl:px-16 pt-6 pb-3 flex-1 flex flex-col min-h-0">
        <header className="shrink-0 flex flex-wrap items-start justify-between gap-x-10 gap-y-4 pb-4">
          <div className="page-in min-w-0 max-w-[30rem]">
            <h1 className="text-[24px] font-semibold leading-none tracking-[-0.03em] text-ink-900 md:text-[28px]">
              Smart, fast, and cheap.
            </h1>
            <p className="comparison-mobile-hide mt-2 text-[13px] leading-snug text-ink-500">
              Frontier AI models compared on intelligence, speed, and cost per task.
            </p>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="comparison-mobile-hide mt-1 inline-block text-[11.5px] text-ink-500 transition-colors hover:text-ink-900"
            >
              Data from Artificial Analysis
              {intelligenceIndexVersion && `, Index v${intelligenceIndexVersion}`}, updated{" "}
              {fmtDate(fetchedAtMs)}
              <span className="ml-1 underline decoration-ink-300 underline-offset-2">Source</span>
            </a>
          </div>
          <div className="comparison-mobile-hide w-full min-w-0 max-w-full sm:w-auto xl:hidden">
            {releaseList("header")}
          </div>
        </header>

        <div
          className="page-in shrink-0 flex flex-wrap items-center gap-2 border-y border-ink-100 py-2.5 sm:gap-3"
          style={{ animationDelay: "60ms" }}
        >
          <SegmentSwitch
            ariaLabel="Horizontal axis"
            options={(Object.keys(X_MODES) as XMode[]).map((k) => ({
              value: k,
              label: X_MODES[k].label,
            }))}
            value={xMode}
            onChange={changeXMode}
          />
          <span className="mx-1 hidden h-4 w-px bg-ink-100 lg:block" aria-hidden />
          <div className="hidden lg:block">
            <ColorLegend
              title={xc.colorTitle}
              domain={colorDomain}
              fmt={xc.fmtColor}
              cap={colorCap}
              onCapChange={setColorCap}
              bands={xc.bands}
              banded={colorBy === "value"}
            />
          </div>
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
              placeholder={searchPlaceholder}
            />
          </div>
        </div>

        {focus && !baselineModel && (
          <div className="mt-3 shrink-0 rounded-lg border border-ink-100 px-3 py-2 xl:hidden">
            {focusPanel(true)}
          </div>
        )}
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

        <main
          className="page-in chart-main relative mt-3 min-h-0 flex-1"
          style={{ animationDelay: "120ms" }}
        >
          <div
            className="flex h-full w-full overflow-hidden rounded-xl border border-ink-100 bg-card"
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
                  width={chartWidth}
                  models={allModels}
                  yMetric={yMetric}
                  xMode={xMode}
                  onHover={setHoveredSlug}
                  hoveredSlug={hoveredSlug}
                  matchedSlugs={matchedSlugs}
                  spotlightSlugs={previewSlugs ?? (comparisonOn ? null : focusSets?.all ?? null)}
                  focusSlugs={comparisonOn ? null : focusSets?.lit ?? null}
                  ghostSlugs={comparisonOn ? null : focusSets?.ghost ?? null}
                  newestSlugs={newestSlugs}
                  recentCutoffMs={recentCutoffMs}
                  colorCap={colorCap}
                  comparedSlugs={comparedSlugs}
                  alternativeSlugs={alternativeSlugs}
                  onSelect={selectForComparison}
                  referenceMs={progress && !comparisonOn ? progress.sinceMs : null}
                  colorBy={colorBy}
                  referenceLabel={`${PROGRESS_SPANS.find((s) => s.key === progressSpan)!.label} ago`}
                />
              </div>
              {progress && !comparisonOn && (
                <div
                  className="absolute z-10 hidden lg:block"
                  // Just inside the plot's left edge (84 units of margin + a gutter).
                  style={{ left: `${(112 / chartWidth) * 100}%`, top: 24 }}
                >
                  <ProgressPanel
                    progress={progress}
                    span={progressSpan}
                    onSpan={setProgressSpan}
                    onPreview={(pair) =>
                      setPreviewSlugs(pair ? new Set(pair.map((m) => m.slug)) : null)
                    }
                    onCompare={compareModels}
                  />
                </div>
              )}
              {hovered && hoverPos && (
                <HoverCard
                  m={hovered}
                  yMetric={yMetric}
                  position={hoverPos}
                  baseline={baselineModel}
                  showLab={colorBy === "lab"}
                />
              )}
            </div>
            {/* The rail is the details panel: new releases until you pick
                something, then the comparison. On a laptop, height is what
                the chart is short of, so this lives beside it, not above. */}
            {!baselineModel && (
              <aside className="hidden w-[18rem] shrink-0 flex-col self-stretch overflow-y-auto border-l border-ink-100 p-4 xl:flex 2xl:w-[20rem]">
                {focus ? focusPanel(false) : releaseList("rail")}
              </aside>
            )}
            {baselineModel && (
              <aside className="hidden lg:flex w-[20rem] xl:w-[23rem] shrink-0 flex-col gap-3 self-stretch overflow-y-auto border-l border-ink-100 bg-wash p-3.5">
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

        <footer
          className="page-in comparison-mobile-hide shrink-0 mt-3 border-t border-ink-100 pt-2.5"
          style={{ animationDelay: "180ms" }}
        >
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
            <div className="w-full md:w-auto">
              <ColorKey
                xc={xc}
                colorBy={colorBy}
                onColorBy={setColorBy}
                onPreview={(key) => {
                  if (key == null) return setPreviewSlugs(null);
                  const named = new Set(LABS.map((l) => l.name));
                  const inGroup = (m: Model) => {
                    if (colorBy === "lab")
                      return key === "Other" ? !named.has(m.creator) : m.creator === key;
                    const v = xc.colorValue(m);
                    if (key === "none") return !isPositiveFinite(v);
                    return isPositiveFinite(v) && bandIndex(v, xc.bands) === Number(key);
                  };
                  setPreviewSlugs(new Set(allModels.filter(inGroup).map((m) => m.slug)));
                }}
              />
            </div>
            <span className="hidden h-4 w-px bg-ink-100 md:block" aria-hidden />
            <div className="hidden md:block">
              <FrontierLegend label={xc.frontierLabel} note={xc.frontierNote(metric.noun)} />
            </div>
            <div className="hidden items-center gap-2 xl:flex">
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="shrink-0">
                <circle
                  cx="6"
                  cy="6"
                  r="4.6"
                  fill="#ffffff"
                  stroke="#b3b7be"
                  strokeWidth="1.3"
                  strokeDasharray="2.4 1.8"
                />
              </svg>
              <span className="text-[11.5px] text-ink-700">Not measured yet</span>
            </div>

          </div>
        </footer>
      </div>
    </div>
  );
}
