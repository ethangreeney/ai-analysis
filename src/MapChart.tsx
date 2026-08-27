import { useMemo } from "react";
import { scaleLinear, scaleLog } from "d3-scale";
import {
  Model,
  YMetric,
  XMode,
  Y_METRICS,
  X_MODES,
  isPositiveFinite,
  makeColorNorm,
  rampColor,
  NEUTRAL_DOT_COLOR,
  NEW_MODEL_COLOR,
} from "./model";

/* Warm ink scale, mirrored from tailwind.config.js so the SVG (which cannot
   read Tailwind classes for stroke/fill on every element) stays in step. */
const INK_900 = "#161512";
const INK_700 = "#403d38";
const INK_500 = "#6f6b63";
const INK_300 = "#b5b1a8";
const INK_100 = "#e8e5de";
const CARD = "#fffefc";
const GRID = "#eeece6";
const BAND = "#faf8f3";

const FONT = "Inter, ui-sans-serif, system-ui, sans-serif";

interface Tier {
  label: string;
  min: number;
  max: number;
  banded: boolean;
  emphasis: number;
}

interface TierBand {
  label: string;
  lower: number;
  upper: number;
  banded: boolean;
  emphasis: number;
}

/* Bands alternate warm-tint / untinted rather than stepping through five
   shades — an even ramp reads as five hard seams on a white card. */
const RELATIVE_TIERS: TierBand[] = [
  { label: "Leaders", lower: 0.82, upper: 1, banded: true, emphasis: 1 },
  { label: "Frontier pack", lower: 0.64, upper: 0.82, banded: false, emphasis: 1 },
  { label: "Competitive", lower: 0.46, upper: 0.64, banded: true, emphasis: 0.85 },
  { label: "Established", lower: 0.28, upper: 0.46, banded: false, emphasis: 0.6 },
  { label: "Trailing", lower: 0, upper: 0.28, banded: true, emphasis: 0.4 },
];

const METRIC_STEP = 5;
const DAY_MS = 86_400_000;
/** Points below the pack median at which a model stops shaping the default view. */
const OUTLIER_GAP = 25;
/** Variants of one family kept in the default landscape. */
const FAMILY_VARIANT_CAP = 3;
/** Total dots in the default landscape. */
const DEFAULT_MODEL_CAP = 48;
/** Names drawn by default (search and comparison raise this on their own). */
const DEFAULT_LABEL_CAP = 10;

/**
 * Crop the value axis to what is actually on screen. Anchoring at zero left
 * two-thirds of the canvas empty; a little padding below the lowest drawn dot
 * and above the highest is all the breathing room the field needs.
 */
function metricBounds(values: number[], defaultMin: number, defaultMax: number) {
  if (!values.length) return { min: defaultMin, max: defaultMax };
  const min = Math.min(...values);
  const max = Math.max(...values);
  return {
    min: Math.floor((min - 3) / METRIC_STEP) * METRIC_STEP,
    max: Math.ceil((max + 2) / METRIC_STEP) * METRIC_STEP,
  };
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function relativeTiers(min: number, max: number): Tier[] {
  const span = Math.max(1, max - min);
  return RELATIVE_TIERS.map((tier) => ({
    label: tier.label,
    min: min + span * tier.lower,
    max: min + span * tier.upper,
    banded: tier.banded,
    emphasis: tier.emphasis,
  }));
}

function tierFor(intel: number, tiers: Tier[]): Tier {
  return tiers.find((t) => intel >= t.min && intel <= t.max) ?? tiers[tiers.length - 1];
}

interface Placed {
  slug: string;
  x: number;
  y: number;
  anchor: "start" | "end";
  text: string;
}

const labelWidth = (text: string) => text.length * 6.3;

function placeLabels(
  models: Model[],
  xy: (m: Model) => { x: number; y: number; r: number },
  innerW: number,
  innerH: number,
  obstacleModels = models,
): Placed[] {
  const cands = models
    .map((m) => {
      const { x, y, r } = xy(m);
      const anchor: "start" | "end" = x + r + 130 < innerW ? "start" : "end";
      const off = anchor === "start" ? r + 8 : -(r + 8);
      return { slug: m.slug, x: x + off, y, anchor, text: m.displayName, baseY: y };
    })
    .sort((a, b) => a.baseY - b.baseY);
  const placed: Placed[] = [];
  const labelH = 15;
  const labelPad = 4;
  const dotPad = 3;
  const rectFor = (item: Omit<Placed, "slug">) => {
    const w = labelWidth(item.text);
    return {
      x1: item.anchor === "start" ? item.x : item.x - w,
      x2: item.anchor === "start" ? item.x + w : item.x,
      y1: item.y - labelH / 2,
      y2: item.y + labelH / 2,
    };
  };
  const dotRects = obstacleModels.map((m) => {
    const { x, y, r } = xy(m);
    return {
      x1: x - r - dotPad,
      x2: x + r + dotPad,
      y1: y - r - dotPad,
      y2: y + r + dotPad,
    };
  });
  const overlaps = (a: ReturnType<typeof rectFor>, b: ReturnType<typeof rectFor>) =>
    a.x1 - labelPad < b.x2 &&
    a.x2 + labelPad > b.x1 &&
    a.y1 - labelPad < b.y2 &&
    a.y2 + labelPad > b.y1;

  for (const c of cands) {
    const offsets = [0, 18, -18, 36, -36, 54, -54, 72, -72, 90, -90];
    let y: number | null = null;

    for (const offset of offsets) {
      const candidateY = Math.max(12, Math.min(innerH - 12, c.baseY + offset));
      const rect = rectFor({ ...c, y: candidateY });
      if (
        !placed.some((p) => overlaps(rect, rectFor(p))) &&
        !dotRects.some((dot) => overlaps(rect, dot))
      ) {
        y = candidateY;
        break;
      }
    }
    if (y == null) continue;
    placed.push({
      slug: c.slug,
      x: c.x,
      y: Math.max(12, Math.min(innerH - 12, y)),
      anchor: c.anchor,
      text: c.text,
    });
  }
  return placed;
}

export function MapChart({
  models,
  yMetric,
  xMode,
  onHover,
  hoveredSlug,
  matchedSlugs,
  newestSlugs,
  recentCutoffMs,
  colorDomain,
  comparedSlugs,
  alternativeSlugs,
  onSelect,
  height = 720,
}: {
  models: Model[];
  yMetric: YMetric;
  xMode: XMode;
  onHover: (slug: string | null) => void;
  hoveredSlug: string | null;
  matchedSlugs: Set<string> | null;
  newestSlugs: Set<string>;
  recentCutoffMs: number;
  colorDomain: [number, number];
  comparedSlugs: string[];
  alternativeSlugs: Set<string>;
  onSelect: (slug: string) => void;
  /** Canvas height in viewBox units; the width stays 1280 so text keeps its
      relative size while the plot takes the shape of its container. */
  height?: number;
}) {
  const metric = Y_METRICS[yMetric];
  const xc = X_MODES[xMode];
  const timeline = xMode === "timeline";
  const searchActive = matchedSlugs !== null;
  const comparisonActive = comparedSlugs.length > 0;
  const isCompared = (slug: string) => comparedSlugs.includes(slug);
  const isAlternative = (slug: string) => comparedSlugs.length === 1 && alternativeSlugs.has(slug);
  const isMatch = (slug: string) => !searchActive || matchedSlugs!.has(slug);

  const metricModels = useMemo(
    () =>
      models.filter(
        (m) => isPositiveFinite(metric.value(m)) && (!timeline || m.releaseMs != null),
      ),
    [metric, models, timeline],
  );
  const hasX = (m: Model) => isPositiveFinite(xc.xValue(m));
  const xModels = useMemo(() => metricModels.filter(hasX), [metricModels, xc]);

  const W = 1280;
  const H = height;
  const M = { top: 30, right: 64, bottom: 60, left: 150 };
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;
  const untimedX = 18;

  const findModel = (slug: string | null) =>
    slug ? metricModels.find((m) => m.slug === slug) : undefined;

  const recentModels = useMemo(
    () =>
      metricModels
        .filter((m) => m.releaseMs != null && m.releaseMs >= recentCutoffMs)
        .sort((a, b) => b.releaseMs! - a.releaseMs!),
    [metricModels, recentCutoffMs],
  );

  /**
   * Default landscape: several variants per family so the shape of each lab's
   * line-up is legible, capped so the field stays readable. Models sitting far
   * below the pack (a fast, cheap, very low-scoring model) are demoted — they
   * stretch the canvas into empty space and drag the frontier with them. They
   * stay reachable through search, comparison and alternatives.
   */
  const { defaultRecentModels, packFloor } = useMemo(() => {
    const eligible = recentModels
      .filter((m) => hasX(m) || xc.railDefault(m) || newestSlugs.has(m.slug))
      .sort(
        (a, b) => (b.releaseMs ?? 0) - (a.releaseMs ?? 0) || metric.value(b)! - metric.value(a)!,
      );
    const families = new Map<string, number>();
    const concise: Model[] = [];
    for (const model of eligible) {
      const family = model.displayName.replace(/\s*\([^)]*\)\s*$/, "").toLowerCase();
      const seen = families.get(family) ?? 0;
      if (seen >= FAMILY_VARIANT_CAP) continue;
      families.set(family, seen + 1);
      concise.push(model);
      if (concise.length === DEFAULT_MODEL_CAP) break;
    }
    const pool = concise.length ? concise : metricModels;
    const mid = median(pool.map((m) => metric.value(m)!));
    const floor = mid == null ? -Infinity : mid - OUTLIER_GAP;
    return {
      defaultRecentModels: concise.filter((m) => metric.value(m)! >= floor),
      packFloor: floor,
    };
  }, [metric, metricModels, newestSlugs, recentModels, xc]);

  /** Timeline shows the whole record, so nothing is demoted there. */
  const inPack = (m: Model) => timeline || metric.value(m)! >= packFloor;

  // Frontier. Scatter views: Pareto on (metric ↑, x-value ↓) — models no
  // other model beats on both axes, swept from best-x to worst-x keeping any
  // point that raises the running-best metric. Far-below-pack models are held
  // out of the sweep so the line does not dive into empty canvas to reach
  // them. Timeline: the record line — swept by release date, keeping each
  // model that raised the all-time record.
  const frontier = useMemo(() => {
    const source = timeline ? metricModels : xModels.filter(inPack);
    const sweep = [...source].sort((a, b) =>
      timeline
        ? a.releaseMs! - b.releaseMs! || metric.value(b)! - metric.value(a)!
        : xc.xValue(a)! - xc.xValue(b)! || metric.value(b)! - metric.value(a)!,
    );
    const keep: Model[] = [];
    let bestValue = -Infinity;
    for (const m of sweep) {
      const value = metric.value(m)!;
      if (value > bestValue) {
        keep.push(m);
        bestValue = value;
      }
    }
    return timeline ? keep : keep.sort((a, b) => metric.value(a)! - metric.value(b)!);
  }, [metric, metricModels, packFloor, timeline, xModels, xc]);
  const frontierSlugs = useMemo(() => new Set(frontier.map((m) => m.slug)), [frontier]);
  const isFrontier = (slug: string) => frontierSlugs.has(slug);

  const visibleModels = useMemo(() => {
    if (timeline) return metricModels;
    const bySlug = new Map<string, Model>();
    const add = (m: Model | undefined) => {
      if (m) bySlug.set(m.slug, m);
    };

    frontier.forEach(add);
    metricModels.filter((m) => newestSlugs.has(m.slug) && inPack(m)).forEach(add);

    if (searchActive) {
      metricModels.filter((m) => isMatch(m.slug)).forEach(add);
    } else {
      defaultRecentModels.forEach(add);
    }

    add(findModel(hoveredSlug));
    comparedSlugs.forEach((slug) => add(findModel(slug)));
    alternativeSlugs.forEach((slug) => add(findModel(slug)));
    return [...bySlug.values()];
  }, [
    alternativeSlugs,
    comparedSlugs,
    defaultRecentModels,
    frontier,
    hoveredSlug,
    matchedSlugs,
    metricModels,
    newestSlugs,
    packFloor,
    searchActive,
    timeline,
  ]);

  // Value axis is cropped to the models actually drawn — surfacing a low model
  // through search or comparison expands it again, on its own.
  const { min: metricMin, max: metricMax } = metricBounds(
    visibleModels.map((m) => metric.value(m)!).filter(isPositiveFinite),
    metric.defaultMin,
    metric.defaultMax,
  );
  const tiers = relativeTiers(metricMin, metricMax);
  const yScale = scaleLinear().domain([metricMin, metricMax]).range([innerH, 0]);
  const gridStep = metricMax - metricMin <= 30 ? 5 : 10;
  const yTicks = useMemo(() => {
    const first = Math.ceil(metricMin / gridStep) * gridStep;
    const out: number[] = [];
    for (let v = first; v <= metricMax; v += gridStep) out.push(v);
    return out;
  }, [gridStep, metricMax, metricMin]);

  // X scale. Speed and cost use a log scale, inverted so better (faster /
  // cheaper) sits on the right — waits and budgets are both felt
  // multiplicatively. The timeline is linear in release date, newer right.
  // Like the value axis, the x domain crops to the models actually drawn —
  // demoted outliers shouldn't stretch the canvas into empty space.
  const xVals = visibleModels.filter(hasX).map((m) => xc.xValue(m)!);
  const xMin = xVals.length ? Math.min(...xVals) : 1;
  const xMax = xVals.length ? Math.max(...xVals) : 10;
  const xLow = xMin === xMax ? xMin * 0.8 : xMin * 0.9;
  const xHigh = xMin === xMax ? xMax * 1.2 : xMax * 1.1;
  const timeSpan = Math.max(30 * DAY_MS, xMax - xMin);
  const xScale = timeline
    ? scaleLinear()
        .domain([xMin - timeSpan * 0.02, xMax + timeSpan * 0.04])
        .range([0, innerW])
    : scaleLog().domain([xHigh, xLow]).range([0, innerW]);

  // Every path below is laid out in scale space, so it has to be recomputed
  // whenever the canvas or either domain moves — not only when the data behind
  // it changes. Without this the frontier keeps the shape it had before the
  // comparison rail resized the chart, until an unrelated re-render fixes it.
  const geometry = [innerW, innerH, xMin, xMax, metricMin, metricMax].join(":");

  const colorNorm = useMemo(() => makeColorNorm(colorDomain), [colorDomain]);
  const markerColor = (m: Model) => {
    const v = xc.colorValue(m);
    return isPositiveFinite(v) ? rampColor(colorNorm(v)) : NEUTRAL_DOT_COLOR;
  };

  const sizeScale = scaleLinear()
    .domain([metricMin, metricMax])
    .range(timeline ? [4, 9.5] : [6.5, 11.5])
    .clamp(true);

  const opacityFor = (value: number) => {
    const t = (value - metricMin) / (metricMax - metricMin);
    return 0.45 + 0.5 * Math.max(0, Math.min(1, t));
  };

  const xy = (m: Model) => ({
    x: hasX(m) ? xScale(xc.xValue(m)!) : untimedX,
    y: yScale(metric.value(m)!),
    r: sizeScale(metric.value(m)!),
  });

  const labeledModels = useMemo(() => {
    const bySlug = new Map<string, Model>();
    const add = (m: Model | undefined) => {
      if (m) bySlug.set(m.slug, m);
    };

    frontier.forEach(add);
    metricModels.filter((m) => newestSlugs.has(m.slug) && inPack(m)).forEach(add);
    add(findModel(hoveredSlug));
    comparedSlugs.forEach((slug) => add(findModel(slug)));
    alternativeSlugs.forEach((slug) => add(findModel(slug)));

    if (searchActive) {
      metricModels
        .filter((m) => isMatch(m.slug))
        .sort((a, b) => metric.value(b)! - metric.value(a)!)
        .slice(0, 80)
        .forEach(add);
    } else {
      (timeline ? recentModels : defaultRecentModels)
        .slice()
        .sort((a, b) => metric.value(b)! - metric.value(a)!)
        .slice(0, DEFAULT_LABEL_CAP)
        .forEach(add);
    }

    return [...bySlug.values()];
  }, [
    alternativeSlugs,
    comparedSlugs,
    defaultRecentModels,
    frontier,
    hoveredSlug,
    matchedSlugs,
    metric,
    metricModels,
    newestSlugs,
    packFloor,
    recentModels,
    searchActive,
    timeline,
  ]);

  const labels = useMemo(
    () => placeLabels(labeledModels, xy, innerW, innerH, visibleModels),
    [labeledModels, visibleModels, geometry],
  );

  // Frontier path. Scatter: polyline from the left edge through the frontier
  // points, then straight down to the plot floor — the drop closes the region
  // so everything right of the line reads as "no model lives here". Timeline:
  // a staircase — hold each record's level until the next record ships, then
  // step up; extend the last record to the right edge.
  const frontierPath = useMemo(() => {
    if (frontier.length === 0) return "";
    if (timeline) {
      const pts = frontier.map((m) => xy(m));
      let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
      for (let i = 1; i < pts.length; i++) {
        d += ` H${pts[i].x.toFixed(1)} V${pts[i].y.toFixed(1)}`;
      }
      return `${d} H${innerW}`;
    }
    const pts = [...frontier].reverse().map((m) => xy(m));
    return [
      `M0,${pts[0].y.toFixed(1)}`,
      ...pts.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`),
      `V${innerH}`,
    ].join(" ");
  }, [frontier, timeline, geometry]);

  /** Anchor for the quiet frontier caption — the flat run nothing sits above. */
  const frontierTag = useMemo(() => {
    if (frontier.length < 2) return null;
    if (timeline) {
      const last = xy(frontier[frontier.length - 1]);
      return { x: innerW - 4, y: last.y - 9, anchor: "end" as const };
    }
    const top = xy(frontier[frontier.length - 1]);
    return { x: 6, y: top.y - 9, anchor: "start" as const };
  }, [frontier, timeline, geometry]);

  const isDim = (m: Model, isHovered: boolean) => {
    if (isHovered || isCompared(m.slug) || isAlternative(m.slug)) return false;
    if (comparisonActive) return true;
    return (searchActive && !isMatch(m.slug)) || (!searchActive && hoveredSlug !== null);
  };

  // Draw order = stacking: hovered on top, then newest, search matches,
  // frontier, and finally the rest by selected metric value.
  const priority = (m: Model) =>
    isCompared(m.slug)
      ? 12 + comparedSlugs.indexOf(m.slug)
      : m.slug === hoveredSlug
      ? 11
      : isAlternative(m.slug)
        ? 10
        : newestSlugs.has(m.slug)
          ? 3
          : searchActive && isMatch(m.slug)
            ? 2
            : isFrontier(m.slug)
              ? 1
              : 0;
  const ordered = [...visibleModels].sort(
    (a, b) => priority(a) - priority(b) || metric.value(a)! - metric.value(b)!,
  );

  const xTicks = xc.xTicks.filter((t) => t >= xLow && t <= xHigh);
  // Timeline ticks: every 6 months on Jan/Jul 1, years emphasized.
  const timeTicks = useMemo(() => {
    if (!timeline || !xVals.length) return [];
    const ticks: { ms: number; label: string; major: boolean }[] = [];
    const d = new Date(xMin);
    d.setUTCDate(1);
    d.setUTCHours(0, 0, 0, 0);
    const m0 = d.getUTCMonth();
    d.setUTCMonth(m0 + ((6 - (m0 % 6)) % 6));
    while (+d <= xMax) {
      const major = d.getUTCMonth() === 0;
      ticks.push({
        ms: +d,
        label: major
          ? String(d.getUTCFullYear())
          : `Jul ’${String(d.getUTCFullYear()).slice(2)}`,
        major,
      });
      d.setUTCMonth(d.getUTCMonth() + 6);
    }
    return ticks;
  }, [timeline, xMin, xMax, xVals.length]);

  const hasVisibleUntimed = !timeline && visibleModels.some((m) => !hasX(m));

  // Comparison connector: a gently bowed quadratic from the model in use to
  // the one being considered. A straight rule read as a chart annotation; the
  // bow reads as a move.
  const comparisonPath = useMemo(() => {
    if (comparedSlugs.length !== 2) return null;
    const from = findModel(comparedSlugs[0]);
    const to = findModel(comparedSlugs[1]);
    if (!from || !to) return null;
    const a = xy(from);
    const b = xy(to);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 4) {
      const offset = Math.max(a.r, b.r) + 5;
      return `M${(a.x + offset).toFixed(1)},${a.y.toFixed(1)} C${(a.x + 58).toFixed(1)},${(
        a.y - 48
      ).toFixed(1)} ${(a.x + 58).toFixed(1)},${(a.y + 48).toFixed(1)} ${(
        b.x + offset
      ).toFixed(1)},${(b.y + 1).toFixed(1)}`;
    }
    const ux = dx / distance;
    const uy = dy / distance;
    const startPad = a.r + 7;
    const endPad = b.r + 12;
    const sx = a.x + ux * startPad;
    const sy = a.y + uy * startPad;
    const ex = b.x - ux * endPad;
    const ey = b.y - uy * endPad;
    // Control point rides the perpendicular at ~12% of the span, so short
    // hops stay nearly straight and long ones arc without swinging wide.
    const bow = Math.min(56, distance * 0.24);
    const cx = (sx + ex) / 2 + uy * bow;
    const cy = (sy + ey) / 2 - ux * bow;
    return `M${sx.toFixed(1)},${sy.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${ex.toFixed(
      1,
    )},${ey.toFixed(1)}`;
  }, [comparedSlugs, metricModels, xMode, yMetric, geometry]);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-full select-none"
      preserveAspectRatio="xMidYMid meet"
      style={{ fontFamily: FONT }}
    >
      <defs>
        <marker
          id="comparison-arrow"
          viewBox="0 0 8 8"
          refX="6.8"
          refY="4"
          markerWidth="6"
          markerHeight="6"
          orient="auto"
        >
          <path d="M0.6,0.8 L7.4,4 L0.6,7.2 Z" fill={INK_900} />
        </marker>
        {/* Dots sit on a white card; a whisper of shadow lifts them off it. */}
        <filter id="dot-lift" x="-60%" y="-60%" width="220%" height="220%">
          <feDropShadow dx="0" dy="0.6" stdDeviation="0.9" floodColor={INK_900} floodOpacity="0.2" />
        </filter>
        <filter id="dot-lift-strong" x="-80%" y="-80%" width="260%" height="260%">
          <feDropShadow dx="0" dy="1.2" stdDeviation="2.2" floodColor={INK_900} floodOpacity="0.26" />
        </filter>
      </defs>
      <g transform={`translate(${M.left}, ${M.top})`}>
        {/* Tier bands — warm alternation, no rules between them */}
        {tiers.map((t) => {
          const yTop = yScale(Math.min(t.max, metricMax));
          const yBottom = yScale(Math.max(t.min, metricMin));
          const h = yBottom - yTop;
          if (h <= 0) return null;
          return (
            <g key={t.label}>
              {t.banded && <rect x={0} y={yTop} width={innerW} height={h} fill={BAND} />}
              <text
                x={-46}
                y={(yTop + yBottom) / 2}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={11}
                fontWeight={500}
                fill={t.emphasis > 0.7 ? INK_500 : INK_300}
              >
                {t.label}
              </text>
            </g>
          );
        })}

        {/* Value gridlines + readings */}
        {yTicks.map((v) => (
          <g key={`yt-${v}`}>
            <line x1={0} x2={innerW} y1={yScale(v)} y2={yScale(v)} stroke={GRID} strokeWidth={1} />
            <text
              x={-12}
              y={yScale(v)}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={10.5}
              fontWeight={450}
              fill={INK_500}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {v}
            </text>
          </g>
        ))}

        {/* Vertical guides at the labelled x positions */}
        {!timeline &&
          xTicks.map((t) => (
            <line
              key={`xg-${t}`}
              x1={xScale(t)}
              x2={xScale(t)}
              y1={0}
              y2={innerH}
              stroke={GRID}
              strokeWidth={1}
              opacity={0.75}
            />
          ))}
        {timeline &&
          timeTicks.map((t) => (
            <line
              key={`xg-${t.ms}`}
              x1={xScale(t.ms)}
              x2={xScale(t.ms)}
              y1={0}
              y2={innerH}
              stroke={GRID}
              strokeWidth={1}
              opacity={t.major ? 1 : 0.6}
            />
          ))}

        {hasVisibleUntimed && (
          <g style={{ pointerEvents: "none" }}>
            <line
              x1={untimedX}
              x2={untimedX}
              y1={0}
              y2={innerH}
              stroke={INK_100}
              strokeWidth={1}
              strokeDasharray="2 5"
            />
            <text x={untimedX} y={-9} textAnchor="middle" fontSize={10.5} fontWeight={500} fill={INK_300}>
              {xc.railCap}
            </text>
          </g>
        )}

        {/* X axis */}
        <line x1={0} x2={innerW} y1={innerH} y2={innerH} stroke={INK_100} strokeWidth={1} />
        {!timeline &&
          xTicks.map((t) => (
            <g key={`xt-${t}`} transform={`translate(${xScale(t)}, 0)`}>
              <line x1={0} x2={0} y1={innerH} y2={innerH + 4} stroke={INK_100} strokeWidth={1} />
              <text
                x={0}
                y={innerH + 18}
                textAnchor="middle"
                fontSize={10.5}
                fontWeight={450}
                fill={INK_500}
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {xc.fmtTick(t)}
              </text>
            </g>
          ))}
        {timeline &&
          timeTicks.map((t) => (
            <g key={`xt-${t.ms}`} transform={`translate(${xScale(t.ms)}, 0)`}>
              <line x1={0} x2={0} y1={innerH} y2={innerH + 4} stroke={INK_100} strokeWidth={1} />
              <text
                x={0}
                y={innerH + 18}
                textAnchor="middle"
                fontSize={10.5}
                fontWeight={t.major ? 600 : 450}
                fill={t.major ? INK_700 : INK_300}
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {t.label}
              </text>
            </g>
          ))}
        <text x={innerW} y={innerH + 42} textAnchor="end" fontSize={11.5} fontWeight={600} fill={INK_700}>
          {xc.rightCap}
        </text>
        <text x={0} y={innerH + 42} textAnchor="start" fontSize={11.5} fontWeight={500} fill={INK_500}>
          {xc.leftCap}
        </text>
        <text
          x={innerW / 2}
          y={innerH + 42}
          textAnchor="middle"
          fontSize={11.5}
          fontWeight={550}
          fill={INK_500}
        >
          {xc.axisTitle}
        </text>

        <text
          transform={`translate(-124, ${innerH / 2}) rotate(-90)`}
          textAnchor="middle"
          fontSize={11.5}
          fontWeight={550}
          fill={INK_500}
        >
          {metric.axisLabel}
        </text>

        {/* Frontier / record guide line */}
        {frontier.length > 1 && (
          <g style={{ pointerEvents: "none" }}>
            <path
              d={frontierPath}
              fill="none"
              stroke={INK_300}
              strokeWidth={1}
              strokeDasharray="4 5"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={comparisonActive ? 0.3 : hoveredSlug ? 0.5 : 0.95}
              style={{ transition: "opacity 200ms ease-out" }}
            />
            {frontierTag && (
              <text
                x={frontierTag.x}
                y={frontierTag.y}
                textAnchor={frontierTag.anchor}
                fontSize={10.5}
                fontWeight={500}
                fill={INK_300}
                stroke={CARD}
                strokeWidth={2.6}
                paintOrder="stroke"
                opacity={comparisonActive || hoveredSlug ? 0.4 : 1}
                style={{ transition: "opacity 200ms ease-out" }}
              >
                {xc.frontierLabel}
              </text>
            )}
          </g>
        )}

        {/* Directional comparison connector: current model → considered model. */}
        {comparisonPath && (
          <path
            d={comparisonPath}
            fill="none"
            stroke={INK_900}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            markerEnd="url(#comparison-arrow)"
            opacity={0.85}
            style={{ pointerEvents: "none" }}
            pathLength={1}
            className="comparison-arrow"
            data-comparison-arrow
          />
        )}

        {/* Dots */}
        {ordered.map((m) => {
          const { x, y, r } = xy(m);
          const colored = isPositiveFinite(xc.colorValue(m));
          const c = markerColor(m);
          const onFrontier = isFrontier(m.slug);
          const isHovered = hoveredSlug === m.slug;
          const isOther = isDim(m, isHovered);
          const isLit = !isHovered && searchActive && isMatch(m.slug);
          const comparisonIndex = comparedSlugs.indexOf(m.slug);
          const compared = comparisonIndex >= 0;
          const alternative = isAlternative(m.slug);
          const isNew = newestSlugs.has(m.slug) && !compared;
          const keyboardInteractive = compared || alternative || isLit || isNew;
          const baseOp = opacityFor(metric.value(m)!);
          let op = compared
            ? 1
            : isHovered
            ? 1
            : isOther
              ? onFrontier
                ? 0.38
                : Math.min(0.12, baseOp)
              : onFrontier || isLit || isNew
                ? Math.max(0.88, baseOp)
                : Math.min(0.58, baseOp);
          // Timeline: damp the background cloud so the highlights carry it.
          if (timeline && !isHovered && !isOther && !onFrontier && !isLit && !isNew) {
            op = Math.min(op, 0.38);
          }
          const prominent = compared || isHovered || isLit || isNew || onFrontier;
          const stroke = compared || isHovered || isLit || alternative ? INK_900 : CARD;
          const strokeW = compared ? 2 : isHovered ? 1.8 : 1.5;
          const dotR = onFrontier && !timeline ? r + 1.2 : r;
          // Shadows are cheap on the scatter's ~50 dots, not on the timeline's
          // full field — there, only the dots doing work get the lift.
          const lift =
            isOther || (timeline && !prominent)
              ? undefined
              : compared || isHovered
                ? "url(#dot-lift-strong)"
                : "url(#dot-lift)";
          return (
            <g
              key={m.slug}
              data-model-slug={m.slug}
              onMouseEnter={() => onHover(m.slug)}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onHover(m.slug)}
              onBlur={() => onHover(null)}
              onClick={() => onSelect(m.slug)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(m.slug);
                }
              }}
              role={keyboardInteractive ? "button" : undefined}
              tabIndex={keyboardInteractive ? 0 : undefined}
              aria-label={
                keyboardInteractive
                  ? compared
                    ? `Remove ${m.displayName}`
                    : comparisonActive
                      ? `Compare with ${m.displayName}`
                      : `Find alternatives for ${m.displayName}`
                  : undefined
              }
              style={{ cursor: "pointer" }}
            >
              <circle
                cx={x}
                cy={y}
                r={keyboardInteractive ? Math.max(dotR + 6, 16) : Math.max(dotR + 3, 10)}
                className={keyboardInteractive ? "chart-hit-target" : undefined}
                fill="transparent"
              />
              {(isHovered || isLit) && (
                <circle cx={x} cy={y} r={dotR + 7} fill={c} fillOpacity={0.16} />
              )}
              {isNew && (
                <g
                  opacity={isOther ? 0.18 : 1}
                  style={{ pointerEvents: "none", transition: "opacity 200ms ease-out" }}
                >
                  {!isOther && (
                    <circle
                      cx={x}
                      cy={y}
                      r={dotR + 7}
                      fill={NEW_MODEL_COLOR}
                      className="newest-glow"
                    />
                  )}
                  <circle
                    cx={x}
                    cy={y}
                    r={dotR + 3}
                    fill="none"
                    stroke={NEW_MODEL_COLOR}
                    strokeOpacity={isOther ? 0.25 : 0.65}
                    strokeWidth={1.1}
                  />
                </g>
              )}
              {alternative && (
                <circle
                  cx={x}
                  cy={y}
                  r={dotR + 4}
                  fill="none"
                  stroke={INK_700}
                  strokeOpacity={0.4}
                  strokeWidth={1.2}
                  className="alternative-ring"
                  style={{ pointerEvents: "none" }}
                />
              )}
              {compared && (
                <g className="comparison-ring" style={{ pointerEvents: "none" }}>
                  <circle
                    cx={x}
                    cy={y}
                    r={dotR + 5}
                    fill="none"
                    stroke={INK_900}
                    strokeWidth={1.6}
                    strokeDasharray={comparisonIndex === 0 ? undefined : "3 2"}
                  />
                  <circle
                    cx={x}
                    cy={y}
                    r={dotR + 9}
                    fill="none"
                    stroke={INK_900}
                    strokeOpacity={0.15}
                    strokeWidth={1}
                  />
                </g>
              )}
              <circle
                cx={x}
                cy={y}
                r={dotR}
                fill={c}
                fillOpacity={colored ? op : isOther ? 0.18 : onFrontier ? 0.72 : Math.min(op, 0.54)}
                stroke={stroke}
                strokeWidth={strokeW}
                filter={lift}
                style={{ transition: "all 200ms ease-out" }}
              />
            </g>
          );
        })}

        {/* Leader lines */}
        {labels.map((l) => {
          const m = metricModels.find((x) => x.slug === l.slug)!;
          const { x, y, r } = xy(m);
          const isHovered = hoveredSlug === l.slug;
          const compared = isCompared(l.slug);
          const isOther = isDim(m, isHovered);
          const dir = l.anchor === "start" ? 1 : -1;
          const fromX = x + dir * (r + 3);
          const toX = l.anchor === "start" ? l.x - 5 : l.x + 5;

          return (
            <path
              key={`stem-${l.slug}`}
              d={`M${fromX.toFixed(1)},${y.toFixed(1)} L${toX.toFixed(1)},${l.y.toFixed(1)}`}
              fill="none"
              stroke={compared || isHovered ? INK_300 : INK_100}
              strokeWidth={1}
              strokeLinecap="round"
              opacity={isOther ? 0.3 : 1}
              style={{ pointerEvents: "none", transition: "all 180ms ease-out" }}
            />
          );
        })}

        {/* Labels */}
        {labels.map((l) => {
          const m = metricModels.find((x) => x.slug === l.slug)!;
          const isHovered = hoveredSlug === l.slug;
          const compared = isCompared(l.slug);
          const isOther = isDim(m, isHovered);
          const onFrontier = isFrontier(l.slug);
          const tier = tierFor(metric.value(m)!, tiers);
          const strong = compared || isHovered || onFrontier;
          const baseOp = strong ? 1 : Math.max(0.7, tier.emphasis);
          const op = isOther ? (onFrontier ? 0.32 : 0.14) : baseOp;
          return (
            <text
              key={`lbl-${l.slug}`}
              x={l.x}
              y={l.y}
              textAnchor={l.anchor}
              dominantBaseline="middle"
              fontSize={strong ? 12 : 11.5}
              fontWeight={strong ? 560 : 480}
              fill={isHovered || compared ? INK_900 : INK_700}
              fillOpacity={op}
              stroke={CARD}
              strokeWidth={3}
              paintOrder="stroke"
              style={{ pointerEvents: "none", transition: "all 180ms ease-out" }}
            >
              {l.text}
            </text>
          );
        })}

        {/* Persistent role tags make shared links self-explanatory. */}
        {comparedSlugs.map((slug, index) => {
          const m = findModel(slug);
          if (!m) return null;
          const { x, y, r } = xy(m);
          return (
            <text
              key={`compared-${slug}`}
              x={x}
              y={y - r - 13}
              textAnchor="middle"
              fontSize={10.5}
              fontWeight={600}
              fill={INK_900}
              stroke={CARD}
              strokeWidth={2.8}
              paintOrder="stroke"
              style={{ pointerEvents: "none" }}
            >
              {index === 0 ? "Using now" : "Considering"}
            </text>
          );
        })}

        {/* "New" tag on the most recently released model(s) */}
        {metricModels
          .filter((m) => newestSlugs.has(m.slug) && !isCompared(m.slug) && inPack(m))
          .map((m) => {
            const { x, y, r } = xy(m);
            const dim = searchActive && !isMatch(m.slug);
            return (
              <text
                key={`new-${m.slug}`}
                x={x}
                y={y - r - 10}
                textAnchor="middle"
                fontSize={10.5}
                fontWeight={600}
                fill={NEW_MODEL_COLOR}
                opacity={dim ? 0.15 : 1}
                stroke={CARD}
                strokeWidth={2.6}
                paintOrder="stroke"
                style={{ pointerEvents: "none", transition: "opacity 200ms ease-out" }}
              >
                New
              </text>
            );
          })}
      </g>
    </svg>
  );
}
