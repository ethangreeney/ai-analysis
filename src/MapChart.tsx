import { useDeferredValue, useMemo, useRef } from "react";
import { scaleLinear, scaleLog } from "d3-scale";
import {
  Model,
  YMetric,
  XMode,
  Y_METRICS,
  X_MODES,
  isPositiveFinite,
  labColor,
  BAND_COLORS,
  NO_DATA_COLOR,
  bandIndex,
  type ColorBy,
  NEW_MODEL_COLOR,
  nameParts,
} from "./model";

/* Warm ink scale, mirrored from tailwind.config.js so the SVG (which cannot
   read Tailwind classes for stroke/fill on every element) stays in step. */
const INK_900 = "#0e0f11";
const INK_700 = "#3a3d43";
const INK_500 = "#6a6f78";
const INK_300 = "#b3b7be";
const INK_100 = "#e7e8eb";
const CARD = "#ffffff";
const GRID = "#f0f1f3";
const LANE = "#f7f8f9";

/** Width of the lane that holds models whose x value isn't measured yet. */
const LANE_W = 44;
const LANE_GAP = 18;

const FONT = "Geist, ui-sans-serif, system-ui, sans-serif";

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
  obstacleModels: Model[],
  textOf: (m: Model) => string,
  isKey: (m: Model) => boolean,
): Placed[] {
  const cands = models
    .map((m) => {
      const { x, y, r } = xy(m);
      const text = textOf(m);
      const anchor: "start" | "end" = x + r + 12 + labelWidth(text) < innerW ? "start" : "end";
      const off = anchor === "start" ? r + 8 : -(r + 8);
      return { slug: m.slug, x: x + off, y, anchor, text, baseY: y, key: isKey(m) };
    })
    // Key labels (frontier, newest, the ones you're pointing at) claim space
    // first; the rest only land if they fit right beside their dot.
    .sort((a, b) => Number(b.key) - Number(a.key) || a.baseY - b.baseY);
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
    // Long leader lines read as clutter: key labels may travel a little,
    // everything else sits beside its dot or not at all.
    const offsets = c.key ? [0, 16, -16, 32, -32, 48, -48] : [0, 14, -14];
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
  spotlightSlugs = null,
  newestSlugs,
  recentCutoffMs,
  colorCap: colorCapProp = null,
  comparedSlugs,
  alternativeSlugs,
  onSelect,
  height = 720,
  referenceMs = null,
  referenceLabel = "",
  colorBy = "value",
}: {
  models: Model[];
  yMetric: YMetric;
  xMode: XMode;
  onHover: (slug: string | null) => void;
  hoveredSlug: string | null;
  matchedSlugs: Set<string> | null;
  /** Highlight these without re-framing the map (previewing a release). */
  spotlightSlugs?: Set<string> | null;
  newestSlugs: Set<string>;
  recentCutoffMs: number;
  /** Upper bound on the color value; models above it leave the map as ghosts. */
  colorCap?: number | null;
  comparedSlugs: string[];
  alternativeSlugs: Set<string>;
  onSelect: (slug: string) => void;
  /** Timeline only: a "this long ago" marker for the progress read-out. */
  referenceMs?: number | null;
  referenceLabel?: string;
  /** Dots show the third number (cost, or wait in Cost view) or the lab. */
  colorBy?: ColorBy;
  /** Canvas height in viewBox units; the width stays 1280 so text keeps its
      relative size while the plot takes the shape of its container. */
  height?: number;
}) {
  const metric = Y_METRICS[yMetric];
  const xc = X_MODES[xMode];
  const timeline = xMode === "timeline";
  // A search re-frames the map around its matches; a spotlight only lights
  // models up where they already sit, so pointing at something never moves it.
  const highlight = matchedSlugs ?? spotlightSlugs;
  const searchActive = highlight !== null;
  // Let the legend handle track the pointer at full rate while the chart
  // catches up at whatever rate it can render.
  const colorCap = useDeferredValue(colorCapProp);
  const comparisonActive = comparedSlugs.length > 0;
  const isCompared = (slug: string) => comparedSlugs.includes(slug);
  const isAlternative = (slug: string) => comparedSlugs.length === 1 && alternativeSlugs.has(slug);
  const isMatch = (slug: string) => !searchActive || highlight!.has(slug);

  const metricModels = useMemo(
    () =>
      models.filter(
        (m) => isPositiveFinite(metric.value(m)) && (!timeline || m.releaseMs != null),
      ),
    [metric, models, timeline],
  );
  // The cap only ever takes models away from the view you already had — it
  // never pulls cheaper ones in to fill the gaps, and the canvas is framed
  // on the uncapped view so nothing moves while the handle is dragged.
  const overCap = (m: Model) => {
    const v = xc.colorValue(m);
    return colorCap != null && isPositiveFinite(v) && v > colorCap;
  };
  const underCap = (m: Model) => !overCap(m);
  const hasX = (m: Model) => isPositiveFinite(xc.xValue(m));
  const xModels = useMemo(() => metricModels.filter(hasX), [metricModels, xc]);

  const W = 1280;
  const H = height;
  const M = { top: 30, right: 40, bottom: 60, left: 84 };
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;
  const untimedX = LANE_W / 2;

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
  const sweepFrontier = (source: Model[]) => {
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
  };
  /** The frontier with no cap — what frames the canvas. */
  const fullFrontier = useMemo(
    () => sweepFrontier(timeline ? metricModels : xModels.filter(inPack)),
    [metric, metricModels, packFloor, timeline, xModels, xc],
  );
  /** The frontier you can actually afford — what is drawn. */
  const frontier = useMemo(
    () => (colorCap == null ? fullFrontier : sweepFrontier((timeline ? metricModels : xModels.filter(inPack)).filter(underCap))),
    [colorCap, fullFrontier, metric, metricModels, packFloor, timeline, xModels, xc],
  );
  const frontierSlugs = useMemo(() => new Set(frontier.map((m) => m.slug)), [frontier]);
  const isFrontier = (slug: string) => frontierSlugs.has(slug);

  /** Everything the view would show with no cap; the cap subtracts from this. */
  const framedModels = useMemo(() => {
    if (timeline) return metricModels;
    const bySlug = new Map<string, Model>();
    const add = (m: Model | undefined) => {
      if (m) bySlug.set(m.slug, m);
    };

    fullFrontier.forEach(add);
    frontier.forEach(add);
    metricModels.filter((m) => newestSlugs.has(m.slug) && inPack(m)).forEach(add);

    if (matchedSlugs) {
      metricModels.filter((m) => matchedSlugs.has(m.slug)).forEach(add);
    } else {
      defaultRecentModels.forEach(add);
      if (spotlightSlugs) metricModels.filter((m) => spotlightSlugs.has(m.slug)).forEach(add);
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
    fullFrontier,
    hoveredSlug,
    matchedSlugs,
    metricModels,
    newestSlugs,
    packFloor,
    searchActive,
    spotlightSlugs,
    timeline,
  ]);
  const visibleModels = useMemo(
    () => (colorCap == null ? framedModels : framedModels.filter(underCap)),
    [colorCap, framedModels, xc],
  );
  // What the cap took away, kept as faint ghosts so the trade-off stays visible.
  const cappedModels = useMemo(
    () => (colorCap == null ? [] : framedModels.filter((m) => overCap(m) && hasX(m))),
    [colorCap, framedModels, xc],
  );

  // Value axis is cropped to the models actually drawn — surfacing a low model
  // through search or comparison expands it again, on its own.
  const { min: metricMin, max: metricMax } = metricBounds(
    framedModels.map((m) => metric.value(m)!).filter(isPositiveFinite),
    metric.defaultMin,
    metric.defaultMax,
  );
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
  const xVals = framedModels.filter(hasX).map((m) => xc.xValue(m)!);
  // Models with no measured x get their own lane, set apart from the axis, so
  // an untimed release never reads as the slowest thing on the map.
  const hasLane = !timeline && framedModels.some((m) => !hasX(m));
  const plotX0 = hasLane ? LANE_W + LANE_GAP : 0;
  const xMin = xVals.length ? Math.min(...xVals) : 1;
  const xMax = xVals.length ? Math.max(...xVals) : 10;
  const xLow = xMin === xMax ? xMin * 0.8 : xMin * 0.9;
  const xHigh = xMin === xMax ? xMax * 1.2 : xMax * 1.1;
  const timeSpan = Math.max(30 * DAY_MS, xMax - xMin);
  const xScale = timeline
    ? scaleLinear()
        .domain([xMin - timeSpan * 0.02, xMax + timeSpan * 0.04])
        .range([plotX0, innerW])
    : scaleLog().domain([xHigh, xLow]).range([plotX0, innerW]);

  // Every path below is laid out in scale space, so it has to be recomputed
  // whenever the canvas or either domain moves — not only when the data behind
  // it changes. Without this the frontier keeps the shape it had before the
  // comparison rail resized the chart, until an unrelated re-render fixes it.
  const geometry = [innerW, innerH, xMin, xMax, metricMin, metricMax, plotX0].join(":");

  const markerColor = (m: Model) => {
    if (colorBy === "lab") return labColor(m.creator);
    const v = xc.colorValue(m);
    return isPositiveFinite(v) ? BAND_COLORS[bandIndex(v, xc.bands)] : NO_DATA_COLOR;
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

    return [...bySlug.values()].filter(underCap);
  }, [
    alternativeSlugs,
    colorCap,
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
    spotlightSlugs,
    timeline,
    xc,
  ]);

  const isNewest = (m: Model) => newestSlugs.has(m.slug) && !isCompared(m.slug);
  const labelText = (m: Model) => {
    const { base, effort } = nameParts(m);
    return `${isNewest(m) ? "New " : ""}${base}${effort ? ` ${effort}` : ""}`;
  };
  const labels = useMemo(
    () =>
      placeLabels(
        labeledModels,
        xy,
        innerW,
        innerH,
        visibleModels,
        labelText,
        (m) =>
          isFrontier(m.slug) ||
          newestSlugs.has(m.slug) ||
          isCompared(m.slug) ||
          m.slug === hoveredSlug ||
          isAlternative(m.slug) ||
          (searchActive && isMatch(m.slug)),
      ),
    [labeledModels, visibleModels, geometry, comparedSlugs, newestSlugs, hoveredSlug],
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
      `M${plotX0},${pts[0].y.toFixed(1)}`,
      ...pts.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`),
      // Drop to the floor at the fast end: nothing lives to the right of it.
      `V${innerH}`,
    ].join(" ");
  }, [frontier, timeline, geometry]);

  /** The region the frontier encloses — everything you can actually get. */
  const frontierArea = useMemo(() => {
    if (frontier.length < 2) return "";
    if (timeline) {
      const x0 = xy(frontier[0]).x;
      return `${frontierPath} V${innerH} H${x0.toFixed(1)} Z`;
    }
    return `${frontierPath} H${plotX0} Z`;
  }, [frontierPath, frontier, timeline, geometry]);

  /** Anchor for the quiet frontier caption — the flat run nothing sits above. */
  const frontierTag = useMemo(() => {
    if (frontier.length < 2) return null;
    // The timeline's record line is named in the legend; a caption at its
    // end only ever collided with the newest record holder's label.
    if (timeline) return null;
    // The fastest end of the line drops straight to the floor, and the corner
    // beside that drop (fast but weak) is almost always empty — a caption there
    // never lands on the leaders' labels at the top.
    const fastest = xy(frontier[0]);
    return { x: fastest.x - 8, y: innerH - 10, anchor: "end" as const };
  }, [frontier, timeline, geometry]);

  /** Hovering only quietens the field; search and comparison mute it. */
  const softDim = !comparisonActive && !searchActive && hoveredSlug !== null;
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

  // Motion bookkeeping. Dots and labels play their entrance once; React
  // re-inserts nodes when hover changes stacking order, and a re-inserted node
  // would otherwise replay its entrance.
  const entered = useRef(new Set<string>());
  const viewKey = `${xMode}|${yMetric}|${geometry}`;

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
        {/* Contact shadow for the dot in your hand, so it lifts off the page. */}
        <filter id="dot-lift-strong" x="-80%" y="-80%" width="260%" height="280%">
          <feDropShadow dx="0" dy="2.4" stdDeviation="2.6" floodColor={INK_900} floodOpacity="0.2" />
        </filter>
        <linearGradient id="frontier-wash" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={INK_900} stopOpacity="0.045" />
          <stop offset="100%" stopColor={INK_900} stopOpacity="0.01" />
        </linearGradient>
        <pattern
          id="lane-hatch"
          width="7"
          height="7"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line x1="0" y1="0" x2="0" y2="7" stroke={INK_100} strokeWidth="1" />
        </pattern>
      </defs>
      <g transform={`translate(${M.left}, ${M.top})`}>
        {/* Lane for models whose x isn't measured: its own column, hatched,
            outside the axis — "we don't know yet", not "slowest". */}
        {hasLane && (
          <g style={{ pointerEvents: "none" }}>
            <rect x={0} y={-4} width={LANE_W} height={innerH + 8} rx={10} fill={LANE} />
            <rect
              x={0}
              y={-4}
              width={LANE_W}
              height={innerH + 8}
              rx={10}
              fill="url(#lane-hatch)"
              opacity={0.7}
            />
            <text
              x={LANE_W / 2}
              y={innerH + 18}
              textAnchor="middle"
              fontSize={10}
              fontWeight={500}
              fill={INK_500}
            >
              {xc.railCap?.split(" ").slice(0, 2).join(" ")}
            </text>
            <text
              x={LANE_W / 2}
              y={innerH + 31}
              textAnchor="middle"
              fontSize={10}
              fontWeight={500}
              fill={INK_500}
            >
              {xc.railCap?.split(" ").slice(2).join(" ")}
            </text>
          </g>
        )}

        {/* Value gridlines + readings */}
        {yTicks.map((v) => (
          <g key={`yt-${v}`}>
            <line
              x1={plotX0}
              x2={innerW}
              y1={yScale(v)}
              y2={yScale(v)}
              stroke={GRID}
              strokeWidth={1}
            />
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

        {/* X axis */}
        <line x1={plotX0} x2={innerW} y1={innerH} y2={innerH} stroke={INK_100} strokeWidth={1} />
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
        <text x={plotX0} y={innerH + 42} textAnchor="start" fontSize={11.5} fontWeight={500} fill={INK_500}>
          {xc.leftCap}
        </text>
        <text
          x={(plotX0 + innerW) / 2}
          y={innerH + 42}
          textAnchor="middle"
          fontSize={11.5}
          fontWeight={550}
          fill={INK_500}
        >
          {xc.axisTitle}
        </text>

        <text
          transform={`translate(-58, ${innerH / 2}) rotate(-90)`}
          textAnchor="middle"
          fontSize={11.5}
          fontWeight={550}
          fill={INK_500}
        >
          {metric.axisLabel}
        </text>

        {timeline && referenceMs != null && referenceMs > xMin && (
          <g
            key={`ref-${referenceMs}-${viewKey}`}
            className="label-in"
            transform={`translate(${xScale(referenceMs).toFixed(1)}, 0)`}
            style={{ pointerEvents: "none", animationDelay: "0ms" }}
          >
            <line y1={-6} y2={innerH} stroke={INK_500} strokeWidth={1} strokeDasharray="2 3" />
            <text
              x={6}
              y={innerH - 8}
              fontSize={10.5}
              fontWeight={550}
              fill={INK_500}
              stroke={CARD}
              strokeWidth={3}
              paintOrder="stroke"
            >
              {referenceLabel}
            </text>
          </g>
        )}

        {/* Frontier / record guide line — drawn in left to right whenever the
            view changes, so the eye follows it rather than finding it. */}
        {frontier.length > 1 && (
          <g
            style={{
              pointerEvents: "none",
              opacity: comparisonActive ? 0.3 : hoveredSlug ? 0.55 : 1,
              transition: "opacity 240ms ease-out",
            }}
          >
            <path
              key={`frontier-area-${viewKey}`}
              className="frontier-fill"
              d={frontierArea}
              fill="url(#frontier-wash)"
            />
            <path
              key={`frontier-${viewKey}`}
              className="frontier-draw"
              d={frontierPath}
              fill="none"
              stroke={INK_700}
              strokeWidth={1.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {frontierTag && (
              <text
                key={`frontier-tag-${viewKey}`}
                className="label-in"
                x={frontierTag.x}
                y={frontierTag.y}
                textAnchor={frontierTag.anchor}
                fontSize={10.5}
                fontWeight={500}
                fill={INK_500}
                stroke={CARD}
                strokeWidth={2.6}
                paintOrder="stroke"
                style={{ animationDelay: "650ms" }}
              >
                {xc.frontierLabel}
              </text>
            )}
          </g>
        )}

        {/* Directional comparison connector: current model → considered model. */}
        {comparisonPath && (
          <path
            key={`arc-${comparedSlugs.join(">")}-${viewKey}`}
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

        {/* Ghosts of models the cap removed */}
        {cappedModels.map((m) => {
          const { x, y, r } = xy(m);
          if (x < 0 || x > innerW || y < 0 || y > innerH) return null;
          return (
            <circle
              key={`capped-${m.slug}`}
              cx={x}
              cy={y}
              r={r * 0.85}
              fill={markerColor(m)}
              opacity={0.1}
              style={{ pointerEvents: "none" }}
            />
          );
        })}

        {/* Dots. Each sits in a positioned group whose transform transitions,
            so switching view or score glides every model to its new place. */}
        {ordered.map((m) => {
          const { x, y, r } = xy(m);
          const timed = timeline || hasX(m);
          const c = markerColor(m);
          const onFrontier = isFrontier(m.slug);
          const isHovered = hoveredSlug === m.slug;
          const isOther = isDim(m, isHovered);
          const quiet = isOther && softDim;
          const isLit = !isHovered && searchActive && isMatch(m.slug);
          const comparisonIndex = comparedSlugs.indexOf(m.slug);
          const compared = comparisonIndex >= 0;
          const alternative = isAlternative(m.slug);
          const isNew = isNewest(m);
          const keyboardInteractive = compared || alternative || isLit || isNew;
          const baseOp = opacityFor(metric.value(m)!);
          let op = compared
            ? 1
            : isHovered
              ? 1
              : isOther
                ? quiet
                  ? Math.min(0.42, baseOp)
                  : onFrontier
                    ? 0.38
                    : Math.min(0.12, baseOp)
                : onFrontier || isLit || isNew
                  ? Math.max(0.9, baseOp)
                  : // Bands are categories: keep them near full strength so the
                    // red never washes out into pink.
                    Math.max(0.82, Math.min(0.9, baseOp));
          // Timeline: damp the background cloud so the highlights carry it.
          if (timeline && !isHovered && !isOther && !onFrontier && !isLit && !isNew) {
            op = Math.min(op, 0.38);
          }
          // Hollow means "not measured yet": the model has no x position.
          // A missing colour value is just a pale grey dot ("No data").
          const hollow = !timed;
          const stroke = compared || isHovered || isLit || alternative ? INK_900 : hollow ? c : CARD;
          const strokeW = compared ? 2 : isHovered ? 1.8 : hollow ? 1.6 : 1.5;
          const dotR = onFrontier && !timeline ? r + 1.2 : r;
          // Shadows and sheen are cheap on the scatter's ~50 dots, not on the
          // timeline's full field — there, only the dots doing work get them.
          // Flat dots; only the one in your hand lifts off the page.
          const lift = compared || isHovered ? "url(#dot-lift-strong)" : undefined;
          const entering = !entered.current.has(m.slug);
          const enterDelay = Math.round(80 + Math.max(0, Math.min(1, x / innerW)) * 520);
          return (
            <g
              key={m.slug}
              data-model-slug={m.slug}
              className="dot-pos"
              style={{ transform: `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`, cursor: "pointer" }}
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
                      : `Compare ${m.displayName}`
                  : undefined
              }
            >
              <g
                className={`dot-body${entering ? " dot-enter" : ""}${isHovered ? " is-hovered" : ""}`}
                style={entering ? { animationDelay: `${enterDelay}ms` } : undefined}
                onAnimationEnd={() => entered.current.add(m.slug)}
              >
                <circle
                  r={keyboardInteractive ? Math.max(dotR + 6, 16) : Math.max(dotR + 3, 10)}
                  className={keyboardInteractive ? "chart-hit-target" : undefined}
                  fill="transparent"
                />
                {(isHovered || isLit) && <circle r={dotR + 7} fill={c} fillOpacity={0.16} />}
                {isNew && (
                  <g
                    opacity={isOther && !quiet ? 0.18 : 1}
                    style={{ pointerEvents: "none", transition: "opacity 200ms ease-out" }}
                  >
                    {!isOther && <circle r={dotR + 7} fill={c} className="newest-glow" />}
                    <circle
                      r={dotR + 3.5}
                      fill="none"
                      stroke={c}
                      strokeOpacity={isOther ? 0.3 : 0.7}
                      strokeWidth={1.2}
                    />
                  </g>
                )}
                {alternative && (
                  <circle
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
                      r={dotR + 5}
                      fill="none"
                      stroke={INK_900}
                      strokeWidth={1.6}
                      strokeDasharray={comparisonIndex === 0 ? undefined : "3 2"}
                    />
                    <circle r={dotR + 9} fill="none" stroke={INK_900} strokeOpacity={0.15} strokeWidth={1} />
                  </g>
                )}
                <circle
                  r={dotR}
                  fill={hollow ? CARD : c}
                  fillOpacity={hollow ? Math.max(op, 0.9) : op}
                  stroke={stroke}
                  strokeOpacity={hollow && !compared && !isHovered ? Math.max(op, 0.55) : 1}
                  strokeWidth={strokeW}
                  strokeDasharray={!timed && !compared && !isHovered ? "3 2.2" : undefined}
                  filter={lift}
                  className="dot-core"
                />
              </g>
              {/* Persistent role tags make shared links self-explanatory. */}
              {compared && (
                <text
                  y={-r - 14}
                  textAnchor="middle"
                  fontSize={10.5}
                  fontWeight={600}
                  fill={INK_900}
                  stroke={CARD}
                  strokeWidth={2.8}
                  paintOrder="stroke"
                  className="label-in"
                  style={{ pointerEvents: "none" }}
                >
                  {comparisonIndex === 0 ? "Using now" : "Considering"}
                </text>
              )}
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
          const key = `${viewKey}|stem|${l.slug}`;
          const entering = !entered.current.has(key);
          return (
            <path
              key={key}
              d={`M${fromX.toFixed(1)},${y.toFixed(1)} L${toX.toFixed(1)},${l.y.toFixed(1)}`}
              fill="none"
              stroke={compared || isHovered ? INK_300 : INK_100}
              strokeWidth={1}
              strokeLinecap="round"
              opacity={isOther ? (softDim ? 0.5 : 0.3) : 1}
              className={entering ? "label-in" : undefined}
              onAnimationEnd={() => entered.current.add(key)}
              style={{ pointerEvents: "none", transition: "opacity 180ms ease-out" }}
            />
          );
        })}

        {/* Labels: name in ink, effort level quieter, "New" in the accent. */}
        {labels.map((l) => {
          const m = metricModels.find((x) => x.slug === l.slug)!;
          const isHovered = hoveredSlug === l.slug;
          const compared = isCompared(l.slug);
          const isOther = isDim(m, isHovered);
          const onFrontier = isFrontier(l.slug);
          const strong = compared || isHovered || onFrontier || isNewest(m);
          const op = isOther ? (softDim ? 0.42 : onFrontier ? 0.32 : 0.14) : strong ? 1 : 0.8;
          const { base, effort } = nameParts(m);
          const key = `${viewKey}|label|${l.slug}`;
          const entering = !entered.current.has(key);
          return (
            <text
              key={key}
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
              className={entering ? "label-in" : undefined}
              onAnimationEnd={() => entered.current.add(key)}
              style={{ pointerEvents: "none", transition: "fill-opacity 180ms ease-out" }}
            >
              {isNewest(m) && (
                <tspan fill={NEW_MODEL_COLOR} fontWeight={650}>
                  {"New "}
                </tspan>
              )}
              <tspan>{base}</tspan>
              {effort && (
                <tspan fill={INK_500} fontWeight={450}>
                  {` ${effort}`}
                </tspan>
              )}
            </text>
          );
        })}
      </g>
    </svg>
  );
}
