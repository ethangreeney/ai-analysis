import { useMemo } from "react";
import { scaleLinear, scaleLog } from "d3-scale";
import {
  Model,
  YMetric,
  XMode,
  Y_METRICS,
  X_MODES,
  Limits,
  isPositiveFinite,
  limitsActive,
  makeColorNorm,
  qualifies,
  rampColor,
  NEUTRAL_DOT_COLOR,
  NEW_MODEL_COLOR,
  PICK_COLOR,
} from "./model";

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
const DAY_MS = 86_400_000;

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

export function MapChart({
  models,
  yMetric,
  xMode,
  onHover,
  hoveredSlug,
  matchedSlugs,
  newestSlugs,
  recentCutoffMs,
  limits,
  bestPickSlug,
  colorDomain,
  comparedSlugs,
  alternativeSlugs,
  onSelect,
}: {
  models: Model[];
  yMetric: YMetric;
  xMode: XMode;
  onHover: (slug: string | null) => void;
  hoveredSlug: string | null;
  matchedSlugs: Set<string> | null;
  newestSlugs: Set<string>;
  recentCutoffMs: number;
  limits: Limits;
  bestPickSlug: string | null;
  colorDomain: [number, number];
  comparedSlugs: string[];
  alternativeSlugs: Set<string>;
  onSelect: (slug: string) => void;
}) {
  const metric = Y_METRICS[yMetric];
  const xc = X_MODES[xMode];
  const timeline = xMode === "timeline";
  const searchActive = matchedSlugs !== null;
  const limited = limitsActive(limits);
  const comparisonActive = comparedSlugs.length > 0;
  const isCompared = (slug: string) => comparedSlugs.includes(slug);
  const isAlternative = (slug: string) => comparedSlugs.length === 1 && alternativeSlugs.has(slug);
  const isMatch = (slug: string) => !searchActive || matchedSlugs!.has(slug);
  const fits = (m: Model) => !limited || qualifies(m, limits);

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
  const H = 720;
  const M = { top: 28, right: 60, bottom: 56, left: 142 };
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;
  const untimedX = 18;

  const metricValues = metricModels.map((m) => metric.value(m)).filter(isPositiveFinite);
  const { min: metricMin, max: metricMax } = metricBounds(
    metricValues,
    metric.defaultMin,
    metric.defaultMax,
  );
  const tiers = relativeTiers(metricMin, metricMax);
  const yScale = scaleLinear().domain([metricMin, metricMax]).range([innerH, 0]);

  // X scale. Speed and cost use a log scale, inverted so better (faster /
  // cheaper) sits on the right — waits and budgets are both felt
  // multiplicatively. The timeline is linear in release date, newer right.
  const xVals = xModels.map((m) => xc.xValue(m)!);
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

  const colorNorm = useMemo(() => makeColorNorm(colorDomain), [colorDomain]);
  const markerColor = (m: Model) => {
    const v = xc.colorValue(m);
    return isPositiveFinite(v) ? rampColor(colorNorm(v)) : NEUTRAL_DOT_COLOR;
  };

  const sizeScale = scaleLinear()
    .domain([metricMin, metricMax])
    .range(timeline ? [4, 9.5] : [7, 12])
    .clamp(true);

  const opacityFor = (value: number) => {
    const t = (value - metricMin) / (metricMax - metricMin);
    return 0.4 + 0.55 * Math.max(0, Math.min(1, t));
  };

  const xy = (m: Model) => ({
    x: hasX(m) ? xScale(xc.xValue(m)!) : untimedX,
    y: yScale(metric.value(m)!),
    r: sizeScale(metric.value(m)!),
  });

  // Frontier. Scatter views: Pareto on (metric ↑, x-value ↓) — models no
  // other model beats on both axes, swept from best-x to worst-x keeping any
  // point that raises the running-best metric. Timeline: the record line —
  // swept by release date, keeping each model that raised the all-time record.
  const frontier = useMemo(() => {
    const sweep = [...(timeline ? metricModels : xModels)].sort((a, b) =>
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
  }, [metric, metricModels, timeline, xModels, xc]);
  const frontierSlugs = useMemo(() => new Set(frontier.map((m) => m.slug)), [frontier]);
  const isFrontier = (slug: string) => frontierSlugs.has(slug);

  const recentModels = useMemo(
    () =>
      metricModels
        .filter((m) => m.releaseMs != null && m.releaseMs >= recentCutoffMs)
        .sort((a, b) => b.releaseMs! - a.releaseMs!),
    [metricModels, recentCutoffMs],
  );
  const defaultRecentModels = useMemo(
    () => {
      const eligible = recentModels
        .filter((m) => hasX(m) || xc.railDefault(m) || newestSlugs.has(m.slug))
        .sort(
          (a, b) =>
            (b.releaseMs ?? 0) - (a.releaseMs ?? 0) || metric.value(b)! - metric.value(a)!,
        );
      const families = new Set<string>();
      const concise: Model[] = [];
      for (const model of eligible) {
        const family = model.displayName.replace(/\s*\([^)]*\)\s*$/, "").toLowerCase();
        if (families.has(family)) continue;
        families.add(family);
        concise.push(model);
        if (concise.length === 24) break;
      }
      return concise;
    },
    [newestSlugs, recentModels, xc, metric],
  );

  const findModel = (slug: string | null) =>
    slug ? metricModels.find((m) => m.slug === slug) : undefined;

  const visibleModels = useMemo(() => {
    if (timeline) return metricModels;
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

    add(findModel(bestPickSlug));
    add(findModel(hoveredSlug));
    comparedSlugs.forEach((slug) => add(findModel(slug)));
    alternativeSlugs.forEach((slug) => add(findModel(slug)));
    return [...bySlug.values()];
  }, [
    alternativeSlugs,
    bestPickSlug,
    comparedSlugs,
    defaultRecentModels,
    frontier,
    hoveredSlug,
    matchedSlugs,
    metricModels,
    newestSlugs,
    searchActive,
    timeline,
  ]);

  const labeledModels = useMemo(() => {
    const bySlug = new Map<string, Model>();
    const add = (m: Model | undefined) => {
      if (m) bySlug.set(m.slug, m);
    };

    frontier.forEach(add);
    metricModels.filter((m) => newestSlugs.has(m.slug)).forEach(add);
    add(findModel(bestPickSlug));
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
        .slice(0, 6)
        .forEach(add);
    }

    return [...bySlug.values()];
  }, [
    alternativeSlugs,
    bestPickSlug,
    comparedSlugs,
    defaultRecentModels,
    frontier,
    hoveredSlug,
    matchedSlugs,
    metric,
    metricModels,
    newestSlugs,
    recentModels,
    searchActive,
    timeline,
  ]);

  const labels = useMemo(
    () => placeLabels(labeledModels, xy, innerW, innerH, visibleModels),
    [labeledModels, visibleModels],
  );

  // Frontier path. Scatter: polyline from the left edge through the frontier
  // points, then down from the final point. Timeline: a staircase — hold each
  // record's level until the next record ships, then step up; extend the last
  // record to the right edge.
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
  }, [frontier, timeline, visibleModels]);

  const isDim = (m: Model, isHovered: boolean) => {
    if (isHovered || isCompared(m.slug) || isAlternative(m.slug)) return false;
    if (comparisonActive) return true;
    return (
      (searchActive && !isMatch(m.slug)) ||
      (limited && !fits(m)) ||
      (!searchActive && !limited && hoveredSlug !== null)
    );
  };

  // Draw order = stacking: hovered on top, then the pick, newest, search
  // matches, frontier, and finally the rest by selected metric value.
  const priority = (m: Model) =>
    isCompared(m.slug)
      ? 12 + comparedSlugs.indexOf(m.slug)
      : m.slug === hoveredSlug
      ? 11
      : isAlternative(m.slug)
        ? 10
      : m.slug === bestPickSlug
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

  // Shaded region for the limit that lives on the current X axis (worse side
  // is always the left, both scatter scales are inverted).
  const cutValue =
    xMode === "speed" ? limits.maxWait : xMode === "cost" ? limits.maxCost : null;
  const cutX =
    cutValue != null && !timeline
      ? Math.max(0, Math.min(innerW, xScale(Math.min(cutValue, xHigh))))
      : null;

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
      return `M${(a.x + offset).toFixed(1)},${a.y.toFixed(1)} C${(a.x + 62).toFixed(1)},${(
        a.y - 52
      ).toFixed(1)} ${(a.x + 62).toFixed(1)},${(a.y + 52).toFixed(1)} ${(
        b.x + offset
      ).toFixed(1)},${(b.y + 1).toFixed(1)}`;
    }
    const ux = dx / distance;
    const uy = dy / distance;
    const startPad = a.r + 6;
    const endPad = b.r + 11;
    return `M${(a.x + ux * startPad).toFixed(1)},${(a.y + uy * startPad).toFixed(
      1,
    )} L${(b.x - ux * endPad).toFixed(1)},${(b.y - uy * endPad).toFixed(1)}`;
  }, [comparedSlugs, metricModels, xMode, yMetric]);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-full select-none"
      preserveAspectRatio="xMidYMid meet"
      style={{ fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}
    >
      <defs>
        <marker
          id="comparison-arrow"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#0a0a0a" />
        </marker>
      </defs>
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

        {cutX != null && (
          <g style={{ pointerEvents: "none" }}>
            <rect x={0} y={0} width={cutX} height={innerH} fill="#0a0a0a" opacity={0.035} />
            <line
              x1={cutX}
              x2={cutX}
              y1={0}
              y2={innerH}
              stroke="#0a0a0a"
              strokeWidth={1}
              strokeDasharray="3 4"
              opacity={0.3}
            />
            <text
              x={cutX}
              y={-8}
              textAnchor="middle"
              fontSize={9}
              fontWeight={600}
              fill="#3a3a3a"
              letterSpacing={1.1}
            >
              {xc.cutLabel(cutValue!)}
            </text>
          </g>
        )}

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
              {xc.railCap}
            </text>
          </g>
        )}

        {/* X axis */}
        <line x1={0} x2={innerW} y1={innerH} y2={innerH} stroke="#9b9b9b" />
        {!timeline &&
          xTicks.map((t) => (
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
                {xc.fmtTick(t)}
              </text>
            </g>
          ))}
        {timeline &&
          timeTicks.map((t) => (
            <g key={`xt-${t.ms}`} transform={`translate(${xScale(t.ms)}, 0)`}>
              <line x1={0} x2={0} y1={innerH} y2={innerH + 5} stroke="#9b9b9b" strokeWidth={1} />
              <text
                x={0}
                y={innerH + 18}
                textAnchor="middle"
                fontSize={11}
                fontWeight={t.major ? 600 : 400}
                fill={t.major ? "#0a0a0a" : "#6b6b6b"}
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {t.label}
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
          {xc.rightCap}
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
          {xc.leftCap}
        </text>
        <text
          x={innerW / 2}
          y={innerH + 40}
          textAnchor="middle"
          fontSize={10}
          fill="#9b9b9b"
          letterSpacing={1.2}
        >
          {xc.axisTitle}
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

        {/* Frontier / record guide line */}
        {frontier.length > 1 && (
          <path
            d={frontierPath}
            fill="none"
            stroke="#bdbdbd"
            strokeWidth={1.1}
            strokeDasharray="5 5"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={comparisonActive ? 0.12 : hoveredSlug ? 0.22 : 0.52}
            style={{ pointerEvents: "none", transition: "opacity 200ms ease-out" }}
          />
        )}

        {/* Directional comparison connector: current model → considered model. */}
        {comparisonPath && (
          <path
            d={comparisonPath}
            fill="none"
            stroke="#0a0a0a"
            strokeWidth={2}
            strokeLinecap="round"
            markerEnd="url(#comparison-arrow)"
            opacity={0.9}
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
          const isPick = m.slug === bestPickSlug && !compared;
          const isNew = newestSlugs.has(m.slug) && !isPick && !compared;
          const baseOp = opacityFor(metric.value(m)!);
          let op = compared
            ? 1
            : isHovered
            ? 1
            : isOther
              ? onFrontier
                ? 0.38
                : Math.min(0.12, baseOp)
              : onFrontier || isLit || isNew || isPick
                ? Math.max(0.86, baseOp)
                : Math.min(0.5, baseOp);
          // Timeline: damp the background cloud so the highlights carry it.
          if (timeline && !isHovered && !isOther && !onFrontier && !isLit && !isNew && !isPick) {
            op = Math.min(op, 0.38);
          }
          const stroke = compared || isHovered || isLit || alternative ? "#0a0a0a" : "white";
          const strokeW = compared ? 2.2 : isHovered ? 1.8 : onFrontier ? 1.6 : 1.2;
          const dotR = onFrontier && !timeline ? r + 1.4 : r;
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
              role={compared || alternative ? "button" : undefined}
              tabIndex={compared || alternative ? 0 : undefined}
              aria-label={
                compared || alternative
                  ? `${compared ? "Remove" : "Compare with"} ${m.displayName}`
                  : undefined
              }
              style={{ cursor: "pointer" }}
            >
              {(isHovered || isLit) && <circle cx={x} cy={y} r={dotR + 7} fill={c} fillOpacity={0.18} />}
              {isNew && (
                <g opacity={isOther ? 0.18 : 1} style={{ pointerEvents: "none", transition: "opacity 200ms ease-out" }}>
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
                    strokeOpacity={isOther ? 0.25 : 0.7}
                    strokeWidth={1.1}
                  />
                </g>
              )}
              {isPick && (
                <g style={{ pointerEvents: "none" }}>
                  <circle cx={x} cy={y} r={dotR + 4.5} fill="none" stroke={PICK_COLOR} strokeWidth={1.5} />
                  <circle cx={x} cy={y} r={dotR + 8} fill="none" stroke={PICK_COLOR} strokeOpacity={0.25} strokeWidth={1} />
                </g>
              )}
              {alternative && (
                <circle
                  cx={x}
                  cy={y}
                  r={dotR + 4}
                  fill="none"
                  stroke="#0a0a0a"
                  strokeOpacity={0.34}
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
                    stroke="#0a0a0a"
                    strokeWidth={1.8}
                    strokeDasharray={comparisonIndex === 0 ? undefined : "3 2"}
                  />
                  <circle
                    cx={x}
                    cy={y}
                    r={dotR + 9}
                    fill="none"
                    stroke="#0a0a0a"
                    strokeOpacity={0.18}
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
                style={{ transition: "all 200ms ease-out" }}
              />
            </g>
          );
        })}

        {/* Label stems */}
        {labels.map((l) => {
          const m = metricModels.find((x) => x.slug === l.slug)!;
          const { x, y, r } = xy(m);
          const c = markerColor(m);
          const isHovered = hoveredSlug === l.slug;
          const compared = isCompared(l.slug);
          const isOther = isDim(m, isHovered);
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
              strokeWidth={compared || isHovered || onFrontier ? 1.3 : 1}
              strokeLinecap="round"
              opacity={isOther ? (onFrontier ? 0.2 : 0.08) : isHovered ? 0.58 : onFrontier ? 0.44 : 0.24}
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
          const baseOp = compared || isHovered || onFrontier ? 1 : tier.emphasis;
          const op = isOther ? (onFrontier ? 0.34 : 0.12) : Math.max(onFrontier ? 0.9 : 0.68, baseOp);
          return (
            <text
              key={`lbl-${l.slug}`}
              x={l.x}
              y={l.y}
              textAnchor={l.anchor}
              dominantBaseline="middle"
              fontSize={compared || isHovered || onFrontier ? 12 : 11}
              fontWeight={compared || isHovered || onFrontier ? 600 : 500}
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
              fontSize={8.5}
              fontWeight={750}
              fill="#0a0a0a"
              letterSpacing={0.8}
              stroke="#ffffff"
              strokeWidth={2.8}
              paintOrder="stroke"
              style={{ pointerEvents: "none" }}
            >
              {index === 0 ? "USING NOW" : "CONSIDERING"}
            </text>
          );
        })}

        {/* "NEW" tag on the most recently released model(s) */}
        {metricModels
          .filter((m) => newestSlugs.has(m.slug) && m.slug !== bestPickSlug && !isCompared(m.slug))
          .map((m) => {
            const { x, y, r } = xy(m);
            const dim = (searchActive && !isMatch(m.slug)) || (limited && !fits(m));
            return (
              <text
                key={`new-${m.slug}`}
                x={x}
                y={y - r - 9}
                textAnchor="middle"
                fontSize={8.5}
                fontWeight={750}
                fill={NEW_MODEL_COLOR}
                letterSpacing={0.8}
                opacity={dim ? 0.15 : 1}
                stroke="#ffffff"
                strokeWidth={2.4}
                paintOrder="stroke"
                style={{ pointerEvents: "none", transition: "opacity 200ms ease-out" }}
              >
                NEW
              </text>
            );
          })}

        {/* "TOP PICK" tag on the best model under the current limits */}
        {(() => {
          const m = findModel(bestPickSlug);
          if (!m || isCompared(m.slug)) return null;
          const { x, y, r } = xy(m);
          return (
            <text
              x={x}
              y={y - r - 12}
              textAnchor="middle"
              fontSize={8.5}
              fontWeight={750}
              fill={PICK_COLOR}
              letterSpacing={0.8}
              stroke="#ffffff"
              strokeWidth={2.4}
              paintOrder="stroke"
              style={{ pointerEvents: "none" }}
            >
              TOP PICK
            </text>
          );
        })()}
      </g>
    </svg>
  );
}
