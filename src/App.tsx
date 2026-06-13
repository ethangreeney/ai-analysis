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
  costToRun: number | null;
  e2eLatency: number;
  reasoningTime: number;
  pricePerMillion: number;
  outputTokensPerSecond: number;
  ttft: number;
}

interface Snapshot {
  fetchedAt: string;
  models: Model[];
}

const snapshot = data as Snapshot;

type ChartableModel = Model & { costToRun: number };

const fmtCost = (c: number | null) =>
  c == null
    ? "Pending"
    : c >= 1e6 ? `$${(c / 1e6).toFixed(1)}M`
    : c >= 1000 ? `$${(c / 1000).toFixed(1)}k` : c >= 100 ? `$${Math.round(c)}` : `$${c.toFixed(0)}`;

const fmtHoverCost = (c: number | null) =>
  c == null ? "Pending" : c >= 1000 ? `$${(c / 1000).toFixed(1)}k` : `$${c.toFixed(0)}`;

const isPositiveFinite = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;
const isChartableModel = (m: Model): m is ChartableModel =>
  isPositiveFinite(m.intelligence) && isPositiveFinite(m.costToRun) && isPositiveFinite(m.e2eLatency);

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

const INTELLIGENCE_STEP = 5;
const DEFAULT_INTELLIGENCE_MIN = 14;
const DEFAULT_INTELLIGENCE_MAX = 65;

function intelligenceBounds(models: Model[]) {
  const values = models.map((m) => m.intelligence).filter(isPositiveFinite);
  const min = values.length ? Math.min(...values) : DEFAULT_INTELLIGENCE_MIN;
  const max = values.length ? Math.max(...values) : DEFAULT_INTELLIGENCE_MAX;
  return {
    min: Math.min(DEFAULT_INTELLIGENCE_MIN, Math.floor((min - 2) / INTELLIGENCE_STEP) * INTELLIGENCE_STEP),
    max: Math.max(DEFAULT_INTELLIGENCE_MAX, Math.ceil((max + 2) / INTELLIGENCE_STEP) * INTELLIGENCE_STEP),
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
const PENDING_COST_COLOR = "#6d7781";
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
    let y = Math.max(12, Math.min(innerH - 12, c.baseY));

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
  onHover,
  hoveredSlug,
}: {
  models: Model[];
  onHover: (slug: string | null) => void;
  hoveredSlug: string | null;
}) {
  const pricedModels = useMemo(() => models.filter(isChartableModel), [models]);
  const W = 1280;
  const H = 720;
  const M = { top: 28, right: 60, bottom: 56, left: 142 };
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;

  const { min: intelMin, max: intelMax } = intelligenceBounds(models);
  const tiers = relativeTiers(intelMin, intelMax);
  const yScale = scaleLinear().domain([intelMin, intelMax]).range([innerH, 0]);

  // X = end-to-end latency, log scale, inverted so faster sits on the right.
  // Log fits the user-felt cost of waiting (perception is roughly logarithmic;
  // the UX thresholds 1s / 10s / 1min are each an order of magnitude apart),
  // matches industry convention, and keeps the right-side cluster legible.
  const latencies = models.map((m) => m.e2eLatency);
  const latMin = latencies.length ? Math.min(...latencies) : 1;
  const latMax = latencies.length ? Math.max(...latencies) : 10;
  const latLow = latMin === latMax ? latMin * 0.8 : latMin * 0.9;
  const latHigh = latMin === latMax ? latMax * 1.2 : latMax * 1.1;
  const xScale = scaleLog().domain([latHigh, latLow]).range([0, innerW]);

  // Cost → color via log scale. Multiplicative cost differences map to even
  // perceptual color steps, matching how budgets are felt.
  const costs = pricedModels.map((m) => m.costToRun);
  const costMin = costs.length ? Math.min(...costs) : 1;
  const costMax = costs.length ? Math.max(...costs) : 10;
  const costLow = costMin === costMax ? costMin * 0.8 : costMin * 0.9;
  const costHigh = costMin === costMax ? costMax * 1.2 : costMax * 1.1;
  const costNorm = scaleLog().domain([costLow, costHigh]).range([0, 1]).clamp(true);

  const sizeScale = scaleLinear().domain([intelMin, intelMax]).range([7, 12]).clamp(true);

  const opacityFor = (intel: number) => {
    const t = (intel - intelMin) / (intelMax - intelMin);
    return 0.4 + 0.55 * Math.max(0, Math.min(1, t));
  };

  const xy = (m: Model) => ({
    x: xScale(m.e2eLatency),
    y: yScale(m.intelligence),
    r: sizeScale(m.intelligence),
  });

  const markerColor = (m: Model) =>
    isPositiveFinite(m.costToRun) ? costColor(costNorm(m.costToRun)) : PENDING_COST_COLOR;

  const labels = useMemo(
    () => placeLabels(models, xy, innerW, innerH, models),
    [models],
  );

  // Pareto frontier on (intelligence ↑, latency ↓): models that no other
  // model beats on both axes. Sweep from fastest to slowest, keeping any
  // point that raises the running-best intelligence.
  const frontier = useMemo(() => {
    const sweep = [...models].sort(
      (a, b) => a.e2eLatency - b.e2eLatency || b.intelligence - a.intelligence,
    );
    const keep: Model[] = [];
    let bestIntel = -Infinity;
    for (const m of sweep) {
      if (m.intelligence > bestIntel) {
        keep.push(m);
        bestIntel = m.intelligence;
      }
    }
    return keep.sort((a, b) => a.intelligence - b.intelligence);
  }, [models]);

  const frontierPath = frontier
    .map((m, i) => {
      const { x, y } = xy(m);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const ordered = [...models].sort((a, b) => {
    if (a.slug === hoveredSlug) return 1;
    if (b.slug === hoveredSlug) return -1;
    return a.intelligence - b.intelligence;
  });

  const xTicks = [5, 10, 30, 100, 200].filter(
    (t) => t >= xScale.domain()[1] && t <= xScale.domain()[0],
  );

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
          const yTop = yScale(Math.min(t.max, intelMax));
          const yBottom = yScale(Math.max(t.min, intelMin));
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
          { length: Math.floor(intelMax / 10) - Math.ceil(intelMin / 10) + 1 },
          (_, i) => (Math.ceil(intelMin / 10) + i) * 10,
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
          END-TO-END LATENCY
        </text>

        <text
          transform={`translate(-112, ${innerH / 2}) rotate(-90)`}
          textAnchor="middle"
          fontSize={11}
          fill="#0a0a0a"
          fontWeight={500}
          letterSpacing={1.4}
        >
          INTELLIGENCE INDEX
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
            opacity={hoveredSlug ? 0.1 : 0.36}
            style={{ pointerEvents: "none", transition: "opacity 200ms ease-out" }}
          />
        )}

        {/* Dots */}
        {ordered.map((m) => {
          const { x, y, r } = xy(m);
          const hasCost = isPositiveFinite(m.costToRun);
          const c = markerColor(m);
          const isHovered = hoveredSlug === m.slug;
          const isOther = hoveredSlug !== null && !isHovered;
          const baseOp = opacityFor(m.intelligence);
          const op = isHovered ? 1 : isOther ? Math.min(0.18, baseOp) : baseOp;
          const stroke = isHovered ? "#0a0a0a" : "white";
          const strokeW = isHovered ? 1.5 : 1.2;
          return (
            <g
              key={m.slug}
              onMouseEnter={() => onHover(m.slug)}
              onMouseLeave={() => onHover(null)}
              style={{ cursor: "pointer" }}
            >
              {isHovered && <circle cx={x} cy={y} r={r + 7} fill={c} fillOpacity={0.18} />}
              <circle
                cx={x}
                cy={y}
                r={r}
                fill={c}
                fillOpacity={hasCost ? (isOther ? op : 0.88) : isOther ? 0.1 : 0.12}
                stroke={stroke}
                strokeWidth={hasCost ? (isHovered ? strokeW : 1.6) : isHovered ? 2 : 1.7}
                strokeDasharray={hasCost ? undefined : "3 2"}
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
          const isOther = hoveredSlug !== null && !isHovered;
          const dir = l.anchor === "start" ? 1 : -1;
          const fromX = x + dir * (r + 3);
          const toX = l.anchor === "start" ? l.x - 5 : l.x + 5;

          return (
            <path
              key={`stem-${l.slug}`}
              d={`M${fromX.toFixed(1)},${y.toFixed(1)} L${toX.toFixed(1)},${l.y.toFixed(1)}`}
              fill="none"
              stroke={c}
              strokeWidth={isHovered ? 1.3 : 1}
              strokeLinecap="round"
              opacity={isOther ? 0.08 : isHovered ? 0.58 : 0.34}
              style={{ pointerEvents: "none", transition: "all 180ms ease-out" }}
            />
          );
        })}

        {/* Labels */}
        {labels.map((l) => {
          const m = models.find((x) => x.slug === l.slug)!;
          const isHovered = hoveredSlug === l.slug;
          const isOther = hoveredSlug !== null && !isHovered;
          const tier = tierFor(m.intelligence, tiers);
          const baseOp = isHovered ? 1 : tier.emphasis;
          const op = isOther ? 0.12 : Math.max(0.72, baseOp);
          return (
            <text
              key={`lbl-${l.slug}`}
              x={l.x}
              y={l.y}
              textAnchor={l.anchor}
              dominantBaseline="middle"
              fontSize={isHovered ? 12 : 11}
              fontWeight={isHovered ? 600 : 500}
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
      <span className="text-[11px] text-ink-700">cheap</span>
      <div
        className="h-2 w-40 rounded-full"
        style={{
          background: `linear-gradient(to right, ${stops.join(", ")})`,
        }}
      />
      <span className="text-[11px] text-ink-700">expensive</span>
    </div>
  );
}

// Ranking ---------------------------------------------------------------
//
// Score = expected dollars to get a unit of coding work done, retries included.
//
//   work cost = attempts × (compute cost + wall-clock time × hourly rate)
//   attempts  = 2 ^ ((frontier coding index − coding index) ÷ ATTEMPTS_DOUBLE_EVERY)
//
// Capability input is the AA Coding Index (LiveCodeBench, SciCode,
// Terminal-Bench Hard, τ²-bench) — general intelligence overrates models that
// benchmark well but code poorly. Compute cost is the AA eval-suite cost.
// Wall-clock = e2e latency × calls per work unit. Attempts are exponential in
// the gap to the frontier: each point below costs the same multiplicative
// factor, so the last few points of frontier capability matter enormously and
// far-from-frontier models effectively never finish.

const ATTEMPTS_DOUBLE_EVERY = 2.5; // coding-index points below frontier per doubling
const HOURLY_RATE = 100; // USD per hour of human/agent supervision
const CALLS_PER_WORK_UNIT = 1000; // sequential model calls in one unit of work

type RankableModel = ChartableModel & { codingIndex: number };

const isRankableModel = (m: Model): m is RankableModel =>
  isChartableModel(m) && isPositiveFinite(m.codingIndex);

// "cost" ranks by expected dollars (best value); "time" ranks by expected
// wall-clock (best model, money no object — the hourly rate drops out);
// "intel" ranks by the raw AA Coding Index, no formula at all.
type RankMode = "cost" | "time" | "intel";

interface RankedModel extends RankableModel {
  rank: number;
  attempts: number;
  workCost: number;
  workTime: number; // expected hours to finish a work unit, retries included
  scorePos: number; // 0..1, better score = closer to 1
}

// Past 10 years of expected wall-clock the honest answer is "never" — the
// model is too far from the frontier to finish, not merely slow.
const fmtHours = (h: number) =>
  h >= 87600 ? "never"
  : h >= 17520 ? `${Math.round(h / 8760)}y`
  : h >= 100 ? `${Math.round(h / 24)}d`
  : h >= 10 ? `${Math.round(h)}h` : `${h.toFixed(1)}h`;

const fmtAttempts = (a: number) =>
  a >= 1000 ? `${Math.round(a / 1000)}k×` : a >= 10 ? `${a.toFixed(0)}×` : `${a.toFixed(1)}×`;

// Mobile shows rank/model/score/attempts; the per-axis numbers join at md+.
const rankGridClass =
  "grid grid-cols-[1.5rem_minmax(0,1.5fr)_minmax(5.5rem,0.9fr)_3rem] gap-x-3 " +
  "md:grid-cols-[3rem_minmax(0,1fr)_minmax(10rem,0.8fr)_5rem_5rem_5rem_5rem] md:gap-x-8";

function expandedExtent(values: number[]) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return { min: min * 0.9, max: max * 1.1 };
  return { min, max };
}

function scoreRankings(models: RankableModel[], mode: RankMode): RankedModel[] {
  if (!models.length) return [];

  const frontier = Math.max(...models.map((m) => m.codingIndex));

  const scored = models.map((m) => {
    const attempts = 2 ** ((frontier - m.codingIndex) / ATTEMPTS_DOUBLE_EVERY);
    const wallClockHours = (m.e2eLatency * CALLS_PER_WORK_UNIT) / 3600;
    const workCost = attempts * (m.costToRun + wallClockHours * HOURLY_RATE);
    const workTime = attempts * wallClockHours;
    return { ...m, rank: 0, attempts, workCost, workTime, scorePos: 0 };
  });

  if (mode === "intel") {
    const codingExtent = expandedExtent(scored.map((m) => m.codingIndex));
    const codingScale = scaleLinear()
      .domain([codingExtent.min, codingExtent.max])
      .range([0, 1])
      .clamp(true);
    return scored
      .sort((a, b) => b.codingIndex - a.codingIndex || b.intelligence - a.intelligence)
      .map((m, i) => ({ ...m, rank: i + 1, scorePos: codingScale(m.codingIndex) }));
  }

  const metric = (m: { workCost: number; workTime: number }) =>
    mode === "cost" ? m.workCost : m.workTime;

  const workExtent = expandedExtent(scored.map(metric));
  const workScale = scaleLog()
    .domain([workExtent.max, workExtent.min])
    .range([0, 1])
    .clamp(true);

  return scored
    .sort((a, b) => metric(a) - metric(b) || b.codingIndex - a.codingIndex)
    .map((m, i) => ({ ...m, rank: i + 1, scorePos: workScale(metric(m)) }));
}

function RankingView({
  models,
  hoveredSlug,
  onHover,
}: {
  models: Model[];
  hoveredSlug: string | null;
  onHover: (s: string | null) => void;
}) {
  const [mode, setMode] = useState<RankMode>("cost");
  const ranked = useMemo(() => scoreRankings(models.filter(isRankableModel), mode), [models, mode]);

  const ModeBtn = ({ id, label }: { id: RankMode; label: string }) => (
    <button
      onClick={() => setMode(id)}
      className={`px-2.5 py-1 text-[11px] rounded-full transition-colors ${
        mode === id ? "bg-ink-900 text-white font-medium" : "text-ink-500 hover:text-ink-900"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 flex flex-col sm:flex-row sm:items-end justify-between gap-3 sm:gap-6 mb-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.14em] text-ink-300 mb-1">
            {mode === "cost"
              ? "Cost to get coding work done"
              : mode === "time"
                ? "Time to get coding work done"
                : "Raw coding ability"}
          </div>
          <div className="text-[13px] text-ink-600">
            {mode === "cost"
              ? "Expected dollars to finish a unit of coding work, retries included. The best value for money."
              : mode === "time"
                ? "Expected hours to finish a unit of coding work, retries included. The best model, money no object."
                : "The AA Coding Index, straight from the benchmarks. No formula — higher is better."}
          </div>
          <div className="mt-1 text-[11px] text-ink-400 tabular-nums">
            {mode === "intel" ? (
              <>score = Artificial Analysis Coding Index, unweighted</>
            ) : (
              <>
                {mode === "cost" ? (
                  <>work cost = attempts × (compute&nbsp;$ + time × ${HOURLY_RATE}/hr)</>
                ) : (
                  <>work time = attempts × latency</>
                )}{" "}
                · attempts double every {ATTEMPTS_DOUBLE_EVERY} coding-index points below the frontier ·
                one work unit ≈ {CALLS_PER_WORK_UNIT.toLocaleString()} model calls
              </>
            )}
          </div>
        </div>
        <div className="shrink-0">
          <div className="flex items-center gap-1 border border-ink-100 rounded-full p-0.5 w-fit">
            <ModeBtn id="cost" label="Cost" />
            <ModeBtn id="time" label="Time" />
            <ModeBtn id="intel" label="Coding" />
          </div>
        </div>
      </div>

      <div className={rankGridClass + " px-1 pb-2 text-[10px] uppercase tracking-[0.12em] text-ink-300 shrink-0"}>
        <div>Rank</div>
        <div>Model</div>
        <div>{mode === "cost" ? "Work cost" : mode === "time" ? "Work time" : "Coding index"}</div>
        <div className="text-right">Attempts</div>
        <div className="hidden md:block text-right">{mode === "intel" ? "Intel" : "Coding"}</div>
        <div className="hidden md:block text-right">Speed</div>
        <div className="hidden md:block text-right">Cost</div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto divide-y divide-ink-100">
        {ranked.map((m) => {
          const c = colorFor(m.creator);
          const isHovered = hoveredSlug === m.slug;
          const rowClass = rankGridClass + " items-center py-2 px-1 rounded transition-colors " +
            (isHovered ? "bg-ink-50" : "");
          return (
            <div
              key={m.slug}
              onMouseEnter={() => onHover(m.slug)}
              onMouseLeave={() => onHover(null)}
              className={rowClass}
            >
              <div className="text-[13px] font-semibold tabular-nums text-ink-700">{m.rank}</div>
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: c }} />
                <span className="text-[13px] font-medium text-ink-900 truncate">
                  {m.displayName}
                </span>
                <span className="hidden sm:inline text-[10px] text-ink-300 shrink-0">{m.creator}</span>
              </div>
              <ScoreCell
                value={
                  mode === "cost"
                    ? fmtCost(m.workCost)
                    : mode === "time"
                      ? fmtHours(m.workTime)
                      : m.codingIndex.toFixed(1)
                }
                pos={m.scorePos}
                color={c}
              />
              <div className="text-right tabular-nums text-[12px] font-medium text-ink-700">
                {fmtAttempts(m.attempts)}
              </div>
              <div className="hidden md:block text-right tabular-nums text-[12px] text-ink-700">
                {mode === "intel" ? m.intelligence.toFixed(1) : m.codingIndex.toFixed(1)}
              </div>
              <div className="hidden md:block text-right tabular-nums text-[12px] text-ink-700">
                {m.e2eLatency.toFixed(0)}s
              </div>
              <div className="hidden md:block text-right tabular-nums text-[12px] text-ink-700">
                {fmtCost(m.costToRun)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ScoreCell({ value, pos, color }: { value: string; pos: number; color: string }) {
  const pct = Math.max(0, Math.min(1, pos)) * 100;
  return (
    <div className="flex items-center gap-3">
      <div className="relative h-1.5 w-full bg-ink-100 rounded-full overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: pct + "%", backgroundColor: color }}
        />
      </div>
      <div className="shrink-0 w-12 text-right tabular-nums text-[13px] font-semibold text-ink-900">
        {value}
      </div>
    </div>
  );
}

function HoverCard({ m }: { m: Model }) {
  return (
    <div
      className="pointer-events-none absolute top-3 right-3 bg-white border border-ink-100 rounded-lg px-4 py-3 max-w-[20rem] z-20"
      style={{ boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.06)" }}
    >
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: colorFor(m.creator) }} />
        <span className="text-[11px] uppercase tracking-[0.12em] text-ink-500">{m.creator}</span>
      </div>
      <div className="mt-1 text-[14px] font-medium text-ink-900 leading-tight">
        {m.displayName}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px] tabular-nums">
        <span className="text-ink-500">Intelligence</span>
        <span className="text-ink-900 text-right">{m.intelligence.toFixed(1)}</span>
        <span className="text-ink-500">Coding index</span>
        <span className="text-ink-900 text-right">{m.codingIndex == null ? "—" : m.codingIndex.toFixed(1)}</span>
        <span className="text-ink-500">Cost to run eval</span>
        <span className="text-ink-900 text-right">{fmtHoverCost(m.costToRun)}</span>
        <span className="text-ink-500">E2E latency</span>
        <span className="text-ink-900 text-right">{m.e2eLatency.toFixed(1)} s</span>
      </div>
    </div>
  );
}

// Page shell ---------------------------------------------------------------

type Tab = "chart" | "ranking";

export default function App() {
  const [tab, setTab] = useState<Tab>("chart");
  const [hoveredSlug, setHoveredSlug] = useState<string | null>(null);
  const models = useMemo(
    () => snapshot.models.filter((m) => isPositiveFinite(m.intelligence) && isPositiveFinite(m.e2eLatency)),
    [],
  );
  const chartModels = useMemo(() => models.filter(isChartableModel), [models]);
  const fetchedDate = new Date(snapshot.fetchedAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const hovered = hoveredSlug ? models.find((m) => m.slug === hoveredSlug) : null;

  const TabBtn = ({ id, label }: { id: Tab; label: string }) => (
    <button
      onClick={() => setTab(id)}
      className={`relative pb-2 text-[12px] tracking-wide transition-colors ${
        tab === id ? "text-ink-900 font-medium" : "text-ink-500 hover:text-ink-900"
      }`}
    >
      {label}
      {tab === id && <span className="absolute left-0 right-0 -bottom-[1px] h-[2px] bg-ink-900" />}
    </button>
  );

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden">
      <div className="mx-auto max-w-[1400px] w-full px-4 sm:px-8 md:px-12 pt-6 pb-3 flex-1 flex flex-col min-h-0">
        <header className="shrink-0 flex items-end justify-between gap-8 pb-4 border-b border-ink-100">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-ink-500 mb-1.5">
              Frontier AI · Landscape
            </div>
            <h1 className="text-2xl md:text-[28px] font-light tracking-tight text-ink-900 leading-tight">
              Smart, fast, and cheap.
            </h1>
            <p className="mt-1.5 text-[13px] text-ink-500 max-w-3xl leading-snug">
              {tab === "chart"
                ? "Up is smarter. Right is faster. Blue is cheap, red is expensive. Pick the highest, rightmost dot your budget allows."
                : "What it actually takes to get coding work done with each model — in dollars, hours, or raw smarts."}
            </p>
          </div>
          <div className="hidden sm:block text-right shrink-0">
            <div className="text-[10px] tracking-wide text-ink-300 uppercase">
              Updated {fetchedDate}
            </div>
            <div className="text-[10px] tracking-wide text-ink-300 uppercase">
              Source: Artificial Analysis · {chartModels.length} priced · {models.length} tracked
            </div>
          </div>
        </header>

        {/* The two visible horizontal lines are this row's top sibling
            border (header's border-b) and this row's own border-b. So the
            row sits flush against the header (no margin), and any padding
            applied evenly here keeps the bar at the geometric midpoint of
            the two borders. */}
        <div className="shrink-0 flex items-center justify-between gap-6 border-b border-ink-100 py-3">
          <div className="flex items-center gap-6">
            <TabBtn id="chart" label="Map" />
            <TabBtn id="ranking" label="Coding ranking" />
          </div>
          <div className="hidden md:flex items-center gap-6">
            {tab === "chart" && <FrontierLegend />}
            {tab === "chart" && <CostLegend />}
          </div>
        </div>

        <main className="flex-1 min-h-0 mt-3 relative">
          {tab === "chart" && (
            <div className="h-full w-full relative overflow-x-auto">
              <div className="h-full min-w-[860px]">
                <MapChart
                  models={models}
                  onHover={setHoveredSlug}
                  hoveredSlug={hoveredSlug}
                />
              </div>
              {hovered && <HoverCard m={hovered} />}
            </div>
          )}
          {tab === "ranking" && (
            <RankingView
              models={models}
              hoveredSlug={hoveredSlug}
              onHover={setHoveredSlug}
            />
          )}
        </main>

        <footer className="shrink-0 pt-3 mt-2 border-t border-ink-100 text-[10px] text-ink-300 tracking-wide leading-snug">
          Cost to run = USD spent on the AA Intelligence Index eval suite (input +
          reasoning + answer tokens × per-token price). E2E latency = median wall-clock
          per query (input + reasoning + answer phases). Coding index = AA Coding Index
          (LiveCodeBench, SciCode, Terminal-Bench Hard, τ²-bench).
        </footer>
      </div>
    </div>
  );
}
