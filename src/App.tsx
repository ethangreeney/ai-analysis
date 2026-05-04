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
  costToRun: number;
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

const fmtCost = (c: number) =>
  c >= 1000 ? `$${(c / 1000).toFixed(1)}k` : c >= 100 ? `$${Math.round(c)}` : `$${c.toFixed(0)}`;

const isPositiveFinite = (value: number) => Number.isFinite(value) && value > 0;
const isChartableModel = (m: Model) =>
  isPositiveFinite(m.intelligence) && isPositiveFinite(m.costToRun) && isPositiveFinite(m.e2eLatency);

interface Tier {
  label: string;
  min: number;
  max: number;
  shade: string;
  emphasis: number;
}

const TIERS: Tier[] = [
  { label: "Frontier", min: 55, max: 65, shade: "#fafaf7", emphasis: 1 },
  { label: "Strong", min: 45, max: 55, shade: "#fafafa", emphasis: 0.85 },
  { label: "Capable", min: 35, max: 45, shade: "#fcfcfc", emphasis: 0.55 },
  { label: "Basic", min: 0, max: 35, shade: "#ffffff", emphasis: 0.3 },
];

function tierFor(intel: number): Tier {
  return TIERS.find((t) => intel >= t.min && intel < t.max) ?? TIERS[TIERS.length - 1];
}

// Cool→hot cost gradient with more separation in the middle so neighbouring
// cost levels read as visibly different.
const COST_COLD = [29, 96, 165]; // saturated deep blue (cheap)
const COST_MID = [222, 195, 138]; // warm sand (mid)
const COST_HOT = [185, 50, 38]; // saturated deep red (expensive)
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
const labelBlockWidth = (m: Model) => Math.max(labelWidth(m.displayName), labelWidth(fmtCost(m.costToRun)));

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
  const labelH = 24;
  const labelPad = 4;
  const dotPad = 3;
  const rectFor = (item: Omit<Placed, "slug">) => {
    const model = models.find((m) => m.slug === (item as Placed).slug);
    const w = model ? labelBlockWidth(model) : labelWidth(item.text);
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
  const chartModels = useMemo(() => models.filter(isChartableModel), [models]);
  const W = 1280;
  const H = 720;
  const M = { top: 28, right: 60, bottom: 56, left: 110 };
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;

  const intelMin = 14;
  const intelMax = 64;
  const yScale = scaleLinear().domain([intelMin, intelMax]).range([innerH, 0]);

  // X = end-to-end latency, log scale, inverted so faster sits on the right.
  // Log fits the user-felt cost of waiting (perception is roughly logarithmic;
  // the UX thresholds 1s / 10s / 1min are each an order of magnitude apart),
  // matches industry convention, and keeps the right-side cluster legible.
  const latencies = chartModels.map((m) => m.e2eLatency);
  const latMin = latencies.length ? Math.min(...latencies) : 1;
  const latMax = latencies.length ? Math.max(...latencies) : 10;
  const latLow = latMin === latMax ? latMin * 0.8 : latMin * 0.9;
  const latHigh = latMin === latMax ? latMax * 1.2 : latMax * 1.1;
  const xScale = scaleLog().domain([latHigh, latLow]).range([0, innerW]);

  // Cost → color via log scale. Multiplicative cost differences map to even
  // perceptual color steps, matching how budgets are felt.
  const costs = chartModels.map((m) => m.costToRun);
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

  const labels = useMemo(
    () => placeLabels(chartModels, xy, innerW, innerH, chartModels),
    [chartModels],
  );

  // Pareto frontier on (intelligence ↑, latency ↓): models that no other
  // model beats on both axes. Sweep from fastest to slowest, keeping any
  // point that raises the running-best intelligence.
  const frontier = useMemo(() => {
    const sweep = [...chartModels].sort(
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
  }, [chartModels]);

  const frontierPath = frontier
    .map((m, i) => {
      const { x, y } = xy(m);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const ordered = [...chartModels].sort((a, b) => {
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
        {TIERS.map((t) => {
          const yTop = yScale(Math.min(t.max, intelMax));
          const yBottom = yScale(Math.max(t.min, intelMin));
          const h = yBottom - yTop;
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
              <text
                x={-14}
                y={(yTop + yBottom) / 2 + 14}
                textAnchor="end"
                fontSize={9}
                fill="#bcbcbc"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {t.min}–{t.max}
              </text>
            </g>
          );
        })}

        {[20, 30, 40, 50, 60].map((v) => (
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

        {TIERS.slice(0, -1).map((t) => (
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
          transform={`translate(-78, ${innerH / 2}) rotate(-90)`}
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
          const costT = costNorm(m.costToRun);
          const c = costColor(costT);
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
                fillOpacity={isOther ? op : 0.88}
                stroke={stroke}
                strokeWidth={isHovered ? strokeW : 1.6}
                style={{ transition: "all 200ms ease-out" }}
              />
            </g>
          );
        })}

        {/* Label stems */}
        {labels.map((l) => {
          const m = chartModels.find((x) => x.slug === l.slug)!;
          const { x, y, r } = xy(m);
          const costT = costNorm(m.costToRun);
          const c = costColor(costT);
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
              const m = chartModels.find((x) => x.slug === l.slug)!;
          const costT = costNorm(m.costToRun);
          const c = costColor(costT);
          const isHovered = hoveredSlug === l.slug;
          const isOther = hoveredSlug !== null && !isHovered;
          const tier = tierFor(m.intelligence);
          const baseOp = isHovered ? 1 : tier.emphasis;
          const op = isOther ? 0.12 : Math.max(0.72, baseOp);
          return (
            <g key={`lbl-${l.slug}`} style={{ pointerEvents: "none", transition: "all 180ms ease-out" }}>
              <text
                x={l.x}
                y={l.y - 4}
                textAnchor={l.anchor}
                dominantBaseline="middle"
                fontSize={isHovered ? 12 : 11}
                fontWeight={isHovered ? 600 : 500}
                fill={isHovered ? "#0a0a0a" : "#2f2f2f"}
                fillOpacity={op}
                stroke="#ffffff"
                strokeWidth={3}
                paintOrder="stroke"
              >
                {l.text}
              </text>
              <text
                x={l.x}
                y={l.y + 8}
                textAnchor={l.anchor}
                dominantBaseline="middle"
                fontSize={isHovered ? 10.5 : 9.5}
                fontWeight={800}
                fill={c}
                fillOpacity={isOther ? 0.12 : 0.92}
                stroke="#ffffff"
                strokeWidth={3}
                paintOrder="stroke"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {fmtCost(m.costToRun)}
              </text>
            </g>
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
        Pareto frontier
      </span>
      <div
        className="invisible opacity-0 group-hover:visible group-hover:opacity-100 absolute top-full right-0 mt-2 w-64 bg-white border border-ink-100 rounded-lg px-3 py-2 text-[11px] text-ink-700 leading-snug z-30 transition-opacity duration-150"
        style={{ boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.06)" }}
      >
        Models on this line aren't beaten by any other on <em>both</em> intelligence and
        speed. Dots below-left are dominated — there's another model that wins on both axes.
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

// Detail leaderboard --------------------------------------------------------

type SortKey = "intelligence" | "e2eLatency" | "costToRun";

function MetricStrip({
  models,
  hoveredSlug,
  onHover,
}: {
  models: Model[];
  hoveredSlug: string | null;
  onHover: (s: string | null) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("intelligence");

  const sorted = useMemo(() => {
    const cp = [...models];
    if (sortKey === "intelligence") cp.sort((a, b) => b.intelligence - a.intelligence);
    if (sortKey === "e2eLatency") cp.sort((a, b) => a.e2eLatency - b.e2eLatency);
    if (sortKey === "costToRun") cp.sort((a, b) => a.costToRun - b.costToRun);
    return cp;
  }, [sortKey, models]);

  const intelMin = Math.min(...models.map((m) => m.intelligence));
  const intelMax = Math.max(...models.map((m) => m.intelligence));
  const latMin = Math.min(...models.map((m) => m.e2eLatency));
  const latMax = Math.max(...models.map((m) => m.e2eLatency));
  const costMin = Math.min(...models.map((m) => m.costToRun));
  const costMax = Math.max(...models.map((m) => m.costToRun));
  const intelScale = scaleLinear().domain([intelMin - 4, intelMax + 2]).range([0, 1]).clamp(true);
  const latScale = scaleLog().domain([latMin * 0.85, latMax * 1.15]).range([1, 0]).clamp(true);
  const costScale = scaleLog().domain([costMin * 0.85, costMax * 1.15]).range([1, 0]).clamp(true);

  const Pill = ({ k, label }: { k: SortKey; label: string }) => (
    <button
      onClick={() => setSortKey(k)}
      className={`text-[11px] px-3 py-1 rounded-full border transition-colors ${
        sortKey === k
          ? "border-ink-900 bg-ink-900 text-white"
          : "border-ink-100 text-ink-500 hover:text-ink-900 hover:border-ink-300"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="h-full flex flex-col">
      <div className="flex flex-wrap items-center gap-2 mb-3 shrink-0">
        <span className="text-[11px] uppercase tracking-[0.12em] text-ink-300 mr-1">Sort</span>
        <Pill k="intelligence" label="Intelligence" />
        <Pill k="e2eLatency" label="Fastest" />
        <Pill k="costToRun" label="Cheapest" />
      </div>

      <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-x-6 px-1 pb-2 text-[10px] uppercase tracking-[0.12em] text-ink-300 shrink-0">
        <div>Model</div>
        <div>Intelligence</div>
        <div>Speed (E2E)</div>
        <div>Cost to run</div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto divide-y divide-ink-100">
        {sorted.map((m) => {
          const c = colorFor(m.creator);
          const isHovered = hoveredSlug === m.slug;
          const tier = tierFor(m.intelligence);
          const dim = tier.emphasis < 0.5 ? "opacity-60" : "";
          return (
            <div
              key={m.slug}
              onMouseEnter={() => onHover(m.slug)}
              onMouseLeave={() => onHover(null)}
              className={`grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-x-6 items-center py-2 px-1 rounded transition-colors ${
                isHovered ? "bg-ink-50" : ""
              } ${dim}`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: c }} />
                <span className="text-[13px] font-medium text-ink-900 truncate">
                  {m.displayName}
                </span>
                <span className="text-[10px] text-ink-300 shrink-0">{m.creator}</span>
              </div>
              <Track value={m.intelligence.toFixed(1)} pos={intelScale(m.intelligence)} color={c} />
              <Track value={`${m.e2eLatency.toFixed(0)}s`} pos={latScale(m.e2eLatency)} color={c} />
              <Track value={fmtCost(m.costToRun)} pos={costScale(m.costToRun)} color={c} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Track({ value, pos, color }: { value: string; pos: number; color: string }) {
  const pct = Math.max(0, Math.min(1, pos)) * 100;
  return (
    <div className="flex items-center gap-3">
      <div className="relative h-px w-full bg-ink-100">
        <div
          className="absolute -top-[3px] h-[7px] w-[7px] rounded-full transition-all duration-300"
          style={{
            left: `calc(${pct}% - 3.5px)`,
            backgroundColor: color,
            boxShadow: `0 0 0 3px ${color}14`,
          }}
        />
      </div>
      <div className="shrink-0 w-14 text-right tabular-nums text-[12px] text-ink-700 font-medium">
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
        <span className="text-ink-500">Cost to run eval</span>
        <span className="text-ink-900 text-right">${m.costToRun.toFixed(0)}</span>
        <span className="text-ink-500">E2E latency</span>
        <span className="text-ink-900 text-right">{m.e2eLatency.toFixed(1)} s</span>
      </div>
    </div>
  );
}

// Page shell ---------------------------------------------------------------

type Tab = "chart" | "detail";

export default function App() {
  const [tab, setTab] = useState<Tab>("chart");
  const [hoveredSlug, setHoveredSlug] = useState<string | null>(null);
  const models = useMemo(() => snapshot.models.filter(isChartableModel), []);
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
      <div className="mx-auto max-w-[1400px] w-full px-8 md:px-12 pt-6 pb-3 flex-1 flex flex-col min-h-0">
        <header className="shrink-0 flex items-end justify-between gap-8 pb-4 border-b border-ink-100">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-ink-500 mb-1.5">
              Frontier AI · Landscape
            </div>
            <h1 className="text-2xl md:text-[28px] font-light tracking-tight text-ink-900 leading-tight">
              Smart, fast, and cheap.
            </h1>
            <p className="mt-1.5 text-[13px] text-ink-500 max-w-3xl leading-snug">
              Up is smarter. Right is faster. Blue is cheap, red is expensive.
              Pick the highest, rightmost dot your budget allows.
            </p>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[10px] tracking-wide text-ink-300 uppercase">
              Updated {fetchedDate}
            </div>
            <div className="text-[10px] tracking-wide text-ink-300 uppercase">
              Source: Artificial Analysis · {models.length} models
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
            <TabBtn id="detail" label="Detail" />
          </div>
          <div className="flex items-center gap-6">
            <FrontierLegend />
            <CostLegend />
          </div>
        </div>

        <main className="flex-1 min-h-0 mt-3 relative">
          {tab === "chart" && (
            <div className="h-full w-full relative">
              <MapChart
                models={models}
                onHover={setHoveredSlug}
                hoveredSlug={hoveredSlug}
              />
              {hovered && <HoverCard m={hovered} />}
            </div>
          )}
          {tab === "detail" && (
            <MetricStrip
              models={models}
              hoveredSlug={hoveredSlug}
              onHover={setHoveredSlug}
            />
          )}
        </main>

        <footer className="shrink-0 pt-3 mt-2 border-t border-ink-100 text-[10px] text-ink-300 tracking-wide leading-snug">
          Cost to run = USD spent on the AA Intelligence Index eval suite (input +
          reasoning + answer tokens × per-token price). E2E latency = median wall-clock
          per query (input + reasoning + answer phases).
        </footer>
      </div>
    </div>
  );
}
