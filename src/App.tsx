import { useMemo, useState } from "react";
import { scaleLinear, scaleLog } from "d3-scale";
import data from "./data/models.json";
import { colorFor } from "./providerStyle";

interface Model {
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
}

interface Snapshot {
  fetchedAt: string;
  models: Model[];
}

const snapshot = data as Snapshot;

type ChartableModel = Model & { costPerTask: number };
type TimedModel = Model & { e2eLatency: number };

const fmtHoverCost = (c: number | null) =>
  c == null ? "—" : c >= 1000 ? `$${(c / 1000).toFixed(1)}k` : `$${c.toFixed(c >= 10 ? 1 : 2)}`;
const fmtHoverLatency = (seconds: number | null) => (seconds == null ? "—" : `${seconds.toFixed(1)} s`);

const isPositiveFinite = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;
const hasCost = (m: Model): m is ChartableModel => isPositiveFinite(m.costPerTask);
const hasLatency = (m: Model): m is TimedModel => isPositiveFinite(m.e2eLatency);

type YMetric = "intelligence" | "coding";

interface MetricConfig {
  label: string;
  title: string;
  axisLabel: string;
  defaultMin: number;
  defaultMax: number;
  value: (m: Model) => number | null;
}

const Y_METRICS: Record<YMetric, MetricConfig> = {
  intelligence: {
    label: "AA Intelligence",
    title: "Artificial Analysis Intelligence Index",
    axisLabel: "AA INTELLIGENCE INDEX",
    defaultMin: 0,
    defaultMax: 65,
    value: (m) => m.intelligence,
  },
  coding: {
    label: "Coding",
    title: "Coding Index",
    axisLabel: "CODING INDEX",
    defaultMin: 0,
    defaultMax: 80,
    value: (m) => m.codingIndex,
  },
};

const RECENT_WINDOW_MONTHS = 3;

interface Tier {
  label: string;
  min: number;
  max: number;
  shade: string;
  emphasis: number;
}

interface TierBand {
  label: string;
  lower: number;
  upper: number;
  shade: string;
  emphasis: number;
}

const RELATIVE_TIERS: TierBand[] = [
  { label: "Leaders", lower: 0.82, upper: 1, shade: "#f7f7f2", emphasis: 1 },
  { label: "Frontier Pack", lower: 0.64, upper: 0.82, shade: "#fafaf7", emphasis: 1 },
  { label: "Competitive", lower: 0.46, upper: 0.64, shade: "#fafafa", emphasis: 0.85 },
  { label: "Established", lower: 0.28, upper: 0.46, shade: "#fcfcfc", emphasis: 0.55 },
  { label: "Trailing", lower: 0, upper: 0.28, shade: "#ffffff", emphasis: 0.3 },
];

const METRIC_STEP = 5;

function metricBounds(values: number[], defaultMin: number, defaultMax: number) {
  const min = values.length ? Math.min(...values) : defaultMin;
  const max = values.length ? Math.max(...values) : defaultMax;
  return {
    min: Math.min(defaultMin, Math.floor((min - 2) / METRIC_STEP) * METRIC_STEP),
    max: Math.max(defaultMax, Math.ceil((max + 2) / METRIC_STEP) * METRIC_STEP),
  };
}

function relativeTiers(min: number, max: number): Tier[] {
  const span = Math.max(1, max - min);
  return RELATIVE_TIERS.map((tier) => ({
    label: tier.label,
    min: min + span * tier.lower,
    max: min + span * tier.upper,
    shade: tier.shade,
    emphasis: tier.emphasis,
  }));
}

function tierFor(intel: number, tiers: Tier[]): Tier {
  return tiers.find((t) => intel >= t.min && intel <= t.max) ?? tiers[tiers.length - 1];
}

// Cool→hot cost gradient with more separation in the middle so neighbouring
// cost levels read as visibly different.
const COST_COLD = [29, 96, 165]; // saturated deep blue (cheap)
const COST_MID = [222, 195, 138]; // warm sand (mid)
const COST_HOT = [185, 50, 38]; // saturated deep red (expensive)
const NEUTRAL_COST_COLOR = "#6d7781";
function costColor(t: number): string {
  const u = Math.max(0, Math.min(1, t));
  const lerp = (a: number[], b: number[], k: number) =>
    a.map((v, i) => Math.round(v + (b[i] - v) * k));
  const rgb = u < 0.5 ? lerp(COST_COLD, COST_MID, u * 2) : lerp(COST_MID, COST_HOT, (u - 0.5) * 2);
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

interface Placed {
  slug: string;
  x: number;
  y: number;
  anchor: "start" | "end";
  text: string;
}

const labelWidth = (text: string) => text.length * 6.2;

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

function MapChart({
  models,
  yMetric,
  onHover,
  hoveredSlug,
  matchedSlugs,
  newestSlugs,
}: {
  models: Model[];
  yMetric: YMetric;
  onHover: (slug: string | null) => void;
  hoveredSlug: string | null;
  matchedSlugs: Set<string> | null;
  newestSlugs: Set<string>;
}) {
  const metric = Y_METRICS[yMetric];
  const searchActive = matchedSlugs !== null;
  const isMatch = (slug: string) => !searchActive || matchedSlugs!.has(slug);
  const metricModels = useMemo(
    () => models.filter((m) => isPositiveFinite(metric.value(m))),
    [metric, models],
  );
  const timedModels = useMemo(() => metricModels.filter(hasLatency), [metricModels]);
  const pricedModels = useMemo(() => metricModels.filter(hasCost), [metricModels]);
  const W = 1280;
  const H = 720;
  const M = { top: 28, right: 60, bottom: 56, left: 142 };
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;
  const untimedX = 18;

  const metricValues = metricModels.map((m) => metric.value(m)).filter(isPositiveFinite);
  const { min: metricMin, max: metricMax } = metricBounds(metricValues, metric.defaultMin, metric.defaultMax);
  const tiers = relativeTiers(metricMin, metricMax);
  const yScale = scaleLinear().domain([metricMin, metricMax]).range([innerH, 0]);

  // X = end-to-end response time, log scale, inverted so faster sits on the right.
  // Log fits the user-felt cost of waiting (perception is roughly logarithmic;
  // the UX thresholds 1s / 10s / 1min are each an order of magnitude apart),
  // matches industry convention, and keeps the right-side cluster legible.
  const latencies = timedModels.map((m) => m.e2eLatency);
  const latMin = latencies.length ? Math.min(...latencies) : 1;
  const latMax = latencies.length ? Math.max(...latencies) : 10;
  const latLow = latMin === latMax ? latMin * 0.8 : latMin * 0.9;
  const latHigh = latMin === latMax ? latMax * 1.2 : latMax * 1.1;
  const xScale = scaleLog().domain([latHigh, latLow]).range([0, innerW]);

  // Cost → color via log scale. Multiplicative cost differences map to even
  // perceptual color steps, matching how budgets are felt.
  const costs = pricedModels.map((m) => m.costPerTask);
  const costMin = costs.length ? Math.min(...costs) : 1;
  const costMax = costs.length ? Math.max(...costs) : 10;
  const costLow = costMin === costMax ? costMin * 0.8 : costMin * 0.9;
  const costHigh = costMin === costMax ? costMax * 1.2 : costMax * 1.1;
  const costNorm = scaleLog().domain([costLow, costHigh]).range([0, 1]).clamp(true);

  const sizeScale = scaleLinear().domain([metricMin, metricMax]).range([7, 12]).clamp(true);

  const opacityFor = (value: number) => {
    const t = (value - metricMin) / (metricMax - metricMin);
    return 0.4 + 0.55 * Math.max(0, Math.min(1, t));
  };

  const xy = (m: Model) => ({
    x: hasLatency(m) ? xScale(m.e2eLatency) : untimedX,
    y: yScale(metric.value(m)!),
    r: sizeScale(metric.value(m)!),
  });

  const markerColor = (m: Model) =>
    isPositiveFinite(m.costPerTask) ? costColor(costNorm(m.costPerTask)) : NEUTRAL_COST_COLOR;

  // Pareto frontier on (selected metric ↑, latency ↓): models that no other
  // model beats on both axes. Sweep from fastest to slowest, keeping any
  // point that raises the running-best metric value.
  const frontier = useMemo(() => {
    const sweep = [...timedModels].sort(
      (a, b) => a.e2eLatency - b.e2eLatency || metric.value(b)! - metric.value(a)!,
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
    return keep.sort((a, b) => metric.value(a)! - metric.value(b)!);
  }, [metric, timedModels]);
  const frontierSlugs = useMemo(() => new Set(frontier.map((m) => m.slug)), [frontier]);
  const isFrontier = (slug: string) => frontierSlugs.has(slug);

  const recentCutoffMs = useMemo(() => {
    const cutoff = new Date(snapshot.fetchedAt);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - RECENT_WINDOW_MONTHS);
    return cutoff.getTime();
  }, []);

  const recentModels = useMemo(
    () =>
      metricModels
        .filter((m) => m.releaseDate && Date.parse(m.releaseDate) >= recentCutoffMs)
        .sort((a, b) => Date.parse(b.releaseDate!) - Date.parse(a.releaseDate!)),
    [metricModels, recentCutoffMs],
  );
  const defaultRecentModels = useMemo(
    () => recentModels.filter((m) => hasLatency(m) || hasCost(m) || newestSlugs.has(m.slug)),
    [newestSlugs, recentModels],
  );

  const visibleModels = useMemo(() => {
    const bySlug = new Map<string, Model>();
    const add = (m: Model | undefined) => {
      if (m) bySlug.set(m.slug, m);
    };

    frontier.forEach(add);
    metricModels.filter((m) => newestSlugs.has(m.slug)).forEach(add);

    if (searchActive) {
      metricModels.filter((m) => isMatch(m.slug)).forEach(add);
    } else {
      defaultRecentModels.forEach(add);
    }

    if (hoveredSlug) add(metricModels.find((m) => m.slug === hoveredSlug));
    return [...bySlug.values()];
  }, [defaultRecentModels, frontier, hoveredSlug, matchedSlugs, metricModels, newestSlugs, searchActive]);

  const labeledModels = useMemo(() => {
    const bySlug = new Map<string, Model>();
    const add = (m: Model | undefined) => {
      if (m) bySlug.set(m.slug, m);
    };

    frontier.forEach(add);
    metricModels
      .filter((m) => newestSlugs.has(m.slug))
      .forEach(add);
    if (hoveredSlug) add(metricModels.find((m) => m.slug === hoveredSlug));

    const visibleMatches = searchActive
      ? metricModels
          .filter((m) => isMatch(m.slug))
          .sort((a, b) => metric.value(b)! - metric.value(a)!)
          .slice(0, 80)
      : [];
    visibleMatches.forEach(add);

    if (!searchActive) {
      defaultRecentModels
        .slice()
        .sort((a, b) => metric.value(b)! - metric.value(a)!)
        .slice(0, 6)
        .forEach(add);
    }

    return [...bySlug.values()];
  }, [defaultRecentModels, frontier, hoveredSlug, matchedSlugs, metric, metricModels, newestSlugs, searchActive]);

  const labels = useMemo(
    () => placeLabels(labeledModels, xy, innerW, innerH, visibleModels),
    [labeledModels, visibleModels],
  );

  const frontierPoints = [...frontier].reverse().map((m) => xy(m));
  const frontierPath = frontierPoints.length
    ? [
        `M0,${frontierPoints[0].y.toFixed(1)}`,
        ...frontierPoints.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`),
      ].join(" ")
    : "";

  // Draw order = stacking: hovered on top, then newest, search matches,
  // frontier, and finally the rest by selected metric value.
  const priority = (m: Model) =>
    m.slug === hoveredSlug
      ? 4
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

  const xTicks = [5, 10, 30, 100, 200].filter(
    (t) => t >= xScale.domain()[1] && t <= xScale.domain()[0],
  );
  const hasVisibleUntimed = visibleModels.some((m) => !hasLatency(m));

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-full select-none"
      preserveAspectRatio="xMidYMid meet"
      style={{ fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}
    >
      <g transform={`translate(${M.left}, ${M.top})`}>
        {/* Tier bands */}
        {tiers.map((t) => {
          const yTop = yScale(Math.min(t.max, metricMax));
          const yBottom = yScale(Math.max(t.min, metricMin));
          const h = yBottom - yTop;
          if (h <= 0) return null;
          return (
            <g key={t.label}>
              <rect x={0} y={yTop} width={innerW} height={h} fill={t.shade} />
              <text
                x={-14}
                y={(yTop + yBottom) / 2}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={11}
                fontWeight={t.emphasis > 0.7 ? 600 : 400}
                fill={t.emphasis > 0.7 ? "#0a0a0a" : "#9b9b9b"}
                letterSpacing={0.4}
              >
                {t.label.toUpperCase()}
              </text>
            </g>
          );
        })}

          {Array.from(
          { length: Math.floor(metricMax / 10) - Math.ceil(metricMin / 10) + 1 },
          (_, i) => (Math.ceil(metricMin / 10) + i) * 10,
        ).map((v) => (
          <line
            key={`yt-${v}`}
            x1={0}
            x2={innerW}
            y1={yScale(v)}
            y2={yScale(v)}
            stroke="#eaeaea"
            strokeWidth={0.5}
          />
        ))}

        {tiers.slice(0, -1).map((t) => (
          <line
            key={`sep-${t.label}`}
            x1={0}
            x2={innerW}
            y1={yScale(t.min)}
            y2={yScale(t.min)}
            stroke="#e0e0e0"
            strokeWidth={1}
          />
        ))}

        {hasVisibleUntimed && (
          <g style={{ pointerEvents: "none" }}>
            <line
              x1={untimedX}
              x2={untimedX}
              y1={0}
              y2={innerH}
              stroke="#d8d8d8"
              strokeWidth={1}
              strokeDasharray="2 5"
            />
            <text
              x={untimedX}
              y={-8}
              textAnchor="middle"
              fontSize={9}
              fontWeight={600}
              fill="#9b9b9b"
              letterSpacing={1.1}
            >
              TIMING N/A
            </text>
          </g>
        )}


        {/* X axis */}
        <line x1={0} x2={innerW} y1={innerH} y2={innerH} stroke="#9b9b9b" />
        {xTicks.map((t) => (
          <g key={`xt-${t}`} transform={`translate(${xScale(t)}, 0)`}>
            <line x1={0} x2={0} y1={innerH} y2={innerH + 5} stroke="#9b9b9b" strokeWidth={1} />
            <text
              x={0}
              y={innerH + 18}
              textAnchor="middle"
              fontSize={11}
              fontWeight={500}
              fill="#3a3a3a"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {t}s
            </text>
          </g>
        ))}
        <text
          x={innerW}
          y={innerH + 40}
          textAnchor="end"
          fontSize={11}
          fontWeight={600}
          fill="#0a0a0a"
          letterSpacing={1.4}
        >
          FASTER →
        </text>
        <text
          x={0}
          y={innerH + 40}
          textAnchor="start"
          fontSize={11}
          fontWeight={500}
          fill="#3a3a3a"
          letterSpacing={1.4}
        >
          ← SLOWER
        </text>
        <text
          x={innerW / 2}
          y={innerH + 40}
          textAnchor="middle"
          fontSize={10}
          fill="#9b9b9b"
          letterSpacing={1.2}
        >
          END-TO-END RESPONSE TIME
        </text>

        <text
          transform={`translate(-112, ${innerH / 2}) rotate(-90)`}
          textAnchor="middle"
          fontSize={11}
          fill="#0a0a0a"
          fontWeight={500}
          letterSpacing={1.4}
        >
          {metric.axisLabel}
        </text>

        {/* Pareto frontier — guide line through non-dominated points */}
        {frontier.length > 1 && (
          <path
            d={frontierPath}
            fill="none"
            stroke="#bdbdbd"
            strokeWidth={1.1}
            strokeDasharray="5 5"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={hoveredSlug ? 0.22 : 0.52}
            style={{ pointerEvents: "none", transition: "opacity 200ms ease-out" }}
          />
        )}

        {/* Dots */}
        {ordered.map((m) => {
          const { x, y, r } = xy(m);
          const hasCost = isPositiveFinite(m.costPerTask);
          const c = markerColor(m);
          const onFrontier = isFrontier(m.slug);
          const isHovered = hoveredSlug === m.slug;
          const isOther = isHovered
            ? false
            : searchActive
              ? !isMatch(m.slug)
              : hoveredSlug !== null;
          const isLit = !isHovered && searchActive && isMatch(m.slug);
          const isNew = newestSlugs.has(m.slug);
          const baseOp = opacityFor(metric.value(m)!);
          const op = isHovered
            ? 1
            : isOther
              ? onFrontier ? 0.38 : Math.min(0.12, baseOp)
              : onFrontier || isLit || isNew
                ? Math.max(0.86, baseOp)
                : Math.min(0.5, baseOp);
          const stroke = isHovered || isLit ? "#0a0a0a" : "white";
          const strokeW = isHovered ? 1.8 : onFrontier ? 1.6 : 1.2;
          const dotR = onFrontier ? r + 1.4 : r;
          return (
            <g
              key={m.slug}
              onMouseEnter={() => onHover(m.slug)}
              onMouseLeave={() => onHover(null)}
              style={{ cursor: "pointer" }}
            >
              {(isHovered || isLit) && <circle cx={x} cy={y} r={dotR + 7} fill={c} fillOpacity={0.18} />}
              <circle
                cx={x}
                cy={y}
                r={dotR}
                fill={c}
                fillOpacity={hasCost ? op : isOther ? 0.18 : onFrontier ? 0.72 : 0.54}
                stroke={stroke}
                strokeWidth={strokeW}
                style={{ transition: "all 200ms ease-out" }}
              />
            </g>
          );
        })}

        {/* Label stems */}
        {labels.map((l) => {
          const m = models.find((x) => x.slug === l.slug)!;
          const { x, y, r } = xy(m);
          const c = markerColor(m);
          const isHovered = hoveredSlug === l.slug;
          const isOther = isHovered
            ? false
            : searchActive
              ? !isMatch(l.slug)
              : hoveredSlug !== null;
          const onFrontier = isFrontier(l.slug);
          const dir = l.anchor === "start" ? 1 : -1;
          const fromX = x + dir * (r + 3);
          const toX = l.anchor === "start" ? l.x - 5 : l.x + 5;

          return (
            <path
              key={`stem-${l.slug}`}
              d={`M${fromX.toFixed(1)},${y.toFixed(1)} L${toX.toFixed(1)},${l.y.toFixed(1)}`}
              fill="none"
              stroke={c}
              strokeWidth={isHovered || onFrontier ? 1.3 : 1}
              strokeLinecap="round"
              opacity={isOther ? (onFrontier ? 0.2 : 0.08) : isHovered ? 0.58 : onFrontier ? 0.44 : 0.24}
              style={{ pointerEvents: "none", transition: "all 180ms ease-out" }}
            />
          );
        })}

        {/* Labels */}
        {labels.map((l) => {
          const m = models.find((x) => x.slug === l.slug)!;
          const isHovered = hoveredSlug === l.slug;
          const isOther = isHovered
            ? false
            : searchActive
              ? !isMatch(l.slug)
              : hoveredSlug !== null;
          const onFrontier = isFrontier(l.slug);
          const tier = tierFor(metric.value(m)!, tiers);
          const baseOp = isHovered || onFrontier ? 1 : tier.emphasis;
          const op = isOther ? (onFrontier ? 0.34 : 0.12) : Math.max(onFrontier ? 0.9 : 0.68, baseOp);
          return (
            <text
              key={`lbl-${l.slug}`}
              x={l.x}
              y={l.y}
              textAnchor={l.anchor}
              dominantBaseline="middle"
              fontSize={isHovered || onFrontier ? 12 : 11}
              fontWeight={isHovered || onFrontier ? 600 : 500}
              fill={isHovered ? "#0a0a0a" : "#2f2f2f"}
              fillOpacity={op}
              stroke="#ffffff"
              strokeWidth={3}
              paintOrder="stroke"
              style={{ pointerEvents: "none", transition: "all 180ms ease-out" }}
            >
              {l.text}
            </text>
          );
        })}

        {/* "NEW" tag on the most recently added model(s) */}
        {models
          .filter((m) => newestSlugs.has(m.slug) && isPositiveFinite(metric.value(m)))
          .map((m) => {
            const { x, y, r } = xy(m);
            const dim = searchActive && !isMatch(m.slug);
            return (
              <text
                key={`new-${m.slug}`}
                x={x}
                y={y - r - 8}
                textAnchor="middle"
                fontSize={9}
                fontWeight={700}
                fill={colorFor(m.creator)}
                letterSpacing={0.8}
                opacity={dim ? 0.15 : 1}
                stroke="#ffffff"
                strokeWidth={2.5}
                paintOrder="stroke"
                style={{ pointerEvents: "none", transition: "opacity 200ms ease-out" }}
              >
                NEW
              </text>
            );
          })}
      </g>
    </svg>
  );
}

function FrontierLegend() {
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
        2D frontier
      </span>
      <div
        className="invisible opacity-0 group-hover:visible group-hover:opacity-100 absolute top-full right-0 mt-2 w-64 bg-white border border-ink-100 rounded-lg px-3 py-2 text-[11px] text-ink-700 leading-snug z-30 transition-opacity duration-150"
        style={{ boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.06)" }}
      >
        This line shows models no other model beats on both intelligence and speed.
      </div>
    </div>
  );
}

// Cost color legend — "cheap" sits on the cheap side of the bar, "expensive"
// on the expensive side, so proximity matches meaning.
function CostLegend() {
  const stops = [0, 0.25, 0.5, 0.75, 1].map((t) => costColor(t));
  return (
    <div className="flex items-center gap-3">
      <span className="text-[11px] text-ink-700">low cost/task</span>
      <div
        className="h-2 w-40 rounded-full"
        style={{
          background: `linear-gradient(to right, ${stops.join(", ")})`,
        }}
      />
      <span className="text-[11px] text-ink-700">high</span>
    </div>
  );
}

function HoverCard({ m }: { m: Model }) {
  const metrics = [
    { label: "End-to-end response time", value: fmtHoverLatency(m.e2eLatency) },
    { label: "Cost per task", value: fmtHoverCost(m.costPerTask) },
    { label: "Intelligence", value: m.intelligence.toFixed(1) },
  ];

  return (
    <div
      className="pointer-events-none absolute top-3 right-3 w-[18.5rem] rounded-xl border border-ink-100/80 bg-white/95 px-4 py-3.5 text-ink-900 z-20 backdrop-blur"
      style={{ boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 18px 48px rgba(0,0,0,0.10)" }}
    >
      <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-ink-500">
        {m.creator}
      </div>
      <div className="mt-1.5 text-[15px] font-semibold leading-tight text-ink-900">
        {m.displayName}
      </div>
      <div className="mt-3 divide-y divide-ink-100 text-[12px]">
        {metrics.map((metric) => (
          <div key={metric.label} className="flex items-baseline justify-between gap-5 py-2 first:pt-0 last:pb-0">
            <span className="text-ink-500">{metric.label}</span>
            <span className="font-semibold tabular-nums text-ink-900">{metric.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MetricSwitch({
  value,
  onChange,
}: {
  value: YMetric;
  onChange: (value: YMetric) => void;
}) {
  return (
    <div className="flex items-center gap-1 border border-ink-100 rounded-full p-0.5 w-fit">
      {(Object.keys(Y_METRICS) as YMetric[]).map((metric) => (
        <button
          key={metric}
          onClick={() => onChange(metric)}
          className={`px-2.5 py-1 text-[11px] rounded-full transition-colors ${
            value === metric ? "bg-ink-900 text-white font-medium" : "text-ink-500 hover:text-ink-900"
          }`}
        >
          {Y_METRICS[metric].label}
        </button>
      ))}
    </div>
  );
}

// Search — spotlight matching models, dim the rest.
function SearchBox({
  value,
  onChange,
  matchCount,
}: {
  value: string;
  onChange: (v: string) => void;
  matchCount: number | null;
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
        <span className="hidden sm:inline text-[10px] tabular-nums text-ink-400 whitespace-nowrap">
          {matchCount} {matchCount === 1 ? "match" : "matches"}
        </span>
      )}
    </div>
  );
}

export default function App() {
  const [yMetric, setYMetric] = useState<YMetric>("intelligence");
  const [hoveredSlug, setHoveredSlug] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const models = useMemo(
    () => snapshot.models.filter((m) => isPositiveFinite(m.intelligence)),
    [],
  );
  const metric = Y_METRICS[yMetric];
  const metricModels = useMemo(
    () => models.filter((m) => isPositiveFinite(metric.value(m))),
    [metric, models],
  );
  const fetchedDate = new Date(snapshot.fetchedAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  // Newest = model(s) sharing the latest release date. Fall back to first-seen
  // timestamps only when AA has not published release dates for any model.
  const newestSlugs = useMemo(() => {
    const hasReleaseDates = models.some((m) => m.releaseDate);
    const dated = models
      .map((m) => ({ model: m, date: hasReleaseDates ? m.releaseDate : m.addedAt }))
      .filter((item): item is { model: Model; date: string } => Boolean(item.date));
    const times = dated.map((item) => Date.parse(item.date)).filter(Number.isFinite);
    if (times.length < 2) return new Set<string>();
    const max = Math.max(...times);
    if (max === Math.min(...times)) return new Set<string>();
    return new Set(
      dated
        .filter((item) => Date.parse(item.date) === max)
        .map((item) => item.model.slug),
    );
  }, [models]);
  const newestModel = useMemo(
    () =>
      metricModels
        .filter((m) => newestSlugs.has(m.slug))
        .sort((a, b) => metric.value(b)! - metric.value(a)!)[0] ?? null,
    [metric, metricModels, newestSlugs],
  );

  const matchedSlugs = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return new Set(
      metricModels
        .filter(
          (m) =>
            m.displayName.toLowerCase().includes(q) ||
            m.name.toLowerCase().includes(q) ||
            m.creator.toLowerCase().includes(q),
        )
        .map((m) => m.slug),
    );
  }, [query, metricModels]);
  const matchCount = matchedSlugs?.size ?? null;

  const hovered = hoveredSlug ? metricModels.find((m) => m.slug === hoveredSlug) : null;

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden">
      <div className="mx-auto max-w-[1400px] w-full px-4 sm:px-8 md:px-12 pt-6 pb-3 flex-1 flex flex-col min-h-0">
        <header className="shrink-0 flex items-end justify-between gap-8 pb-4 border-b border-ink-100">
          <div>
            <h1 className="text-2xl md:text-[28px] font-light tracking-tight text-ink-900 leading-tight">
              Smart, fast, and cheap.
            </h1>
            <p className="mt-1.5 text-[13px] text-ink-500 max-w-3xl leading-snug">
              Shows task cost, not token price; end-to-end wait, not tokens/sec. Up is intelligence, right is faster, color is cost.
            </p>
          </div>
          <div className="hidden sm:block text-right shrink-0">
            <div className="text-[10px] tracking-wide text-ink-300 uppercase">
              Updated {fetchedDate}
            </div>
            {newestModel && (
              <div className="mt-0.5 text-[10px] tracking-wide">
                <span className="uppercase text-ink-300">Newest </span>
                <span className="font-medium" style={{ color: colorFor(newestModel.creator) }}>
                  {newestModel.displayName}
                </span>
              </div>
            )}
          </div>
        </header>

        <div className="shrink-0 flex items-center justify-between gap-6 border-b border-ink-100 py-3">
          <div className="flex items-center gap-4">
            <MetricSwitch value={yMetric} onChange={setYMetric} />
          </div>
          <div className="flex items-center gap-4 md:gap-6">
            <div className="hidden md:block"><FrontierLegend /></div>
            <div className="hidden md:block"><CostLegend /></div>
            <SearchBox value={query} onChange={setQuery} matchCount={matchCount} />
          </div>
        </div>

        <main className="flex-1 min-h-0 mt-3 relative">
          <div className="h-full w-full relative overflow-x-auto">
            <div className="h-full min-w-[860px]">
              <MapChart
                models={models}
                yMetric={yMetric}
                onHover={setHoveredSlug}
                hoveredSlug={hoveredSlug}
                matchedSlugs={matchedSlugs}
                newestSlugs={newestSlugs}
              />
            </div>
            {hovered && <HoverCard m={hovered} />}
          </div>
        </main>

        <footer className="shrink-0 pt-3 mt-2 border-t border-ink-100 text-[10px] text-ink-300 tracking-wide leading-snug">
          Data from Artificial Analysis. Default map shows the last {RECENT_WINDOW_MONTHS} months plus the frontier; priced untimed models sit on the timing n/a rail.
        </footer>
      </div>
    </div>
  );
}
