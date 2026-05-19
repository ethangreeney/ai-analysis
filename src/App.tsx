import { useEffect, useMemo, useRef, useState } from "react";
import { scaleLinear, scaleLog } from "d3-scale";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
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

function trueParetoFrontier(models: Model[]): Model[] {
  return models
    .filter((m) => {
      return !models.some((other) => {
        if (other.slug === m.slug) return false;
        const atLeastAsSmart = other.intelligence >= m.intelligence;
        const atLeastAsFast = other.e2eLatency <= m.e2eLatency;
        const atLeastAsCheap = other.costToRun <= m.costToRun;
        const strictlyBetter =
          other.intelligence > m.intelligence ||
          other.e2eLatency < m.e2eLatency ||
          other.costToRun < m.costToRun;

        return atLeastAsSmart && atLeastAsFast && atLeastAsCheap && strictlyBetter;
      });
    })
    .sort((a, b) => b.intelligence - a.intelligence);
}

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
const FRONTIER_3D_COLOR = "#087a5a";
const DOMINATED_3D_COLOR = "#d9d6cf";
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
        2D frontier
      </span>
      <div
        className="invisible opacity-0 group-hover:visible group-hover:opacity-100 absolute top-full right-0 mt-2 w-64 bg-white border border-ink-100 rounded-lg px-3 py-2 text-[11px] text-ink-700 leading-snug z-30 transition-opacity duration-150"
        style={{ boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.06)" }}
      >
        This line only uses intelligence and speed. The 3D tab marks the true frontier
        after cost is included as a third optimization axis.
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

// True 3D Pareto view -------------------------------------------------------

function makeTextSprite(text: string, color = "#0a0a0a") {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = 420 * dpr;
  canvas.height = 72 * dpr;
  ctx.scale(dpr, dpr);
  ctx.font = "500 24px Inter, ui-sans-serif, system-ui, sans-serif";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(255,255,255,0.92)";
  ctx.lineWidth = 7;
  ctx.strokeText(text, 10, 36);
  ctx.fillStyle = color;
  ctx.fillText(text, 10, 36);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.08, 0.19, 1);
  return sprite;
}

function axisLabel(text: string, position: THREE.Vector3) {
  const label = makeTextSprite(text, "#3a3a3a");
  label.position.copy(position);
  label.scale.set(0.92, 0.16, 1);
  return label;
}

function frontierEnvelopeGeometry(points: THREE.Vector3[], x0: number, x1: number, z0: number, z1: number) {
  const steps = 18;
  const positions: number[] = [];
  const indices: number[] = [];
  const vertexIndex = new Map<string, number>();
  const yAt = (x: number, z: number) => {
    const candidates = points.filter((p) => p.x >= x && p.z >= z);
    if (!candidates.length) return null;
    return Math.max(...candidates.map((p) => p.y));
  };
  const getVertex = (ix: number, iz: number) => {
    const key = `${ix}:${iz}`;
    const existing = vertexIndex.get(key);
    if (existing !== undefined) return existing;

    const x = x0 + ((x1 - x0) * ix) / steps;
    const z = z0 + ((z1 - z0) * iz) / steps;
    const y = yAt(x, z);
    if (y === null) return null;

    const idx = positions.length / 3;
    positions.push(x, y, z);
    vertexIndex.set(key, idx);
    return idx;
  };

  for (let ix = 0; ix < steps; ix += 1) {
    for (let iz = 0; iz < steps; iz += 1) {
      const a = getVertex(ix, iz);
      const b = getVertex(ix + 1, iz);
      const c = getVertex(ix + 1, iz + 1);
      const d = getVertex(ix, iz + 1);
      if (a === null || b === null || c === null || d === null) continue;
      indices.push(a, b, c, a, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function ThreeFrontierChart({
  models,
  onHover,
  hoveredSlug,
}: {
  models: Model[];
  onHover: (slug: string | null) => void;
  hoveredSlug: string | null;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const hoveredRef = useRef<string | null>(hoveredSlug);
  const onHoverRef = useRef(onHover);
  const [frontierCount, setFrontierCount] = useState(0);

  useEffect(() => {
    hoveredRef.current = hoveredSlug;
  }, [hoveredSlug]);

  useEffect(() => {
    onHoverRef.current = onHover;
  }, [onHover]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const chartModels = models.filter(isChartableModel);
    const frontierSlugs = new Set(trueParetoFrontier(chartModels).map((m) => m.slug));
    setFrontierCount(frontierSlugs.size);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#fbfbfa");

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0.35, 3.15, 7.45);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.display = "block";
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 0, 0);
    controls.minDistance = 4;
    controls.maxDistance = 12;

    scene.add(new THREE.AmbientLight("#ffffff", 1.95));
    const keyLight = new THREE.DirectionalLight("#ffffff", 1.7);
    keyLight.position.set(4, 7, 5);
    scene.add(keyLight);

    const bounds = {
      x: 5.6,
      y: 3.8,
      z: 4.4,
    };
    const intelExtent = [
      Math.min(...chartModels.map((m) => m.intelligence)),
      Math.max(...chartModels.map((m) => m.intelligence)),
    ] as const;
    const latencyExtent = [
      Math.min(...chartModels.map((m) => m.e2eLatency)),
      Math.max(...chartModels.map((m) => m.e2eLatency)),
    ] as const;
    const costExtent = [
      Math.min(...chartModels.map((m) => m.costToRun)),
      Math.max(...chartModels.map((m) => m.costToRun)),
    ] as const;
    const intelScale = scaleLinear().domain([intelExtent[0] - 2, intelExtent[1] + 2]).range([-bounds.y / 2, bounds.y / 2]);
    const latencyScale = scaleLog().domain([latencyExtent[1] * 1.12, latencyExtent[0] * 0.88]).range([-bounds.x / 2, bounds.x / 2]);
    const costScale = scaleLog().domain([costExtent[1] * 1.12, costExtent[0] * 0.88]).range([-bounds.z / 2, bounds.z / 2]);
    const positionFor = (m: Model) =>
      new THREE.Vector3(latencyScale(m.e2eLatency), intelScale(m.intelligence), costScale(m.costToRun));

    const frame = new THREE.Group();
    scene.add(frame);
    const gridMaterial = new THREE.LineBasicMaterial({ color: "#e5e5e1", transparent: true, opacity: 0.55 });
    const axisMaterial = new THREE.LineBasicMaterial({ color: "#8f8f8a", transparent: true, opacity: 0.84 });
    const addLine = (a: THREE.Vector3, b: THREE.Vector3, material = gridMaterial) => {
      const geometry = new THREE.BufferGeometry().setFromPoints([a, b]);
      const line = new THREE.Line(geometry, material);
      frame.add(line);
      return line;
    };

    const x0 = -bounds.x / 2;
    const x1 = bounds.x / 2;
    const y0 = -bounds.y / 2;
    const y1 = bounds.y / 2;
    const z0 = -bounds.z / 2;
    const z1 = bounds.z / 2;
    for (let i = 0; i <= 5; i += 1) {
      const x = x0 + (bounds.x * i) / 5;
      const z = z0 + (bounds.z * i) / 5;
      addLine(new THREE.Vector3(x, y0, z0), new THREE.Vector3(x, y0, z1));
      addLine(new THREE.Vector3(x0, y0, z), new THREE.Vector3(x1, y0, z));
      addLine(new THREE.Vector3(x0, y0 + (bounds.y * i) / 5, z0), new THREE.Vector3(x0, y0 + (bounds.y * i) / 5, z1));
      addLine(new THREE.Vector3(x0, y0 + (bounds.y * i) / 5, z0), new THREE.Vector3(x1, y0 + (bounds.y * i) / 5, z0));
    }
    addLine(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1 + 0.5, y0, z0), axisMaterial);
    addLine(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x0, y1 + 0.42, z0), axisMaterial);
    addLine(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x0, y0, z1 + 0.5), axisMaterial);
    frame.add(axisLabel("faster", new THREE.Vector3(x1 + 0.9, y0, z0)));
    frame.add(axisLabel("smarter", new THREE.Vector3(x0, y1 + 0.72, z0)));
    frame.add(axisLabel("cheaper", new THREE.Vector3(x0, y0, z1 + 0.9)));

    const frontierPoints = chartModels.filter((m) => frontierSlugs.has(m.slug)).map(positionFor);
    const frontierMaterial = new THREE.MeshBasicMaterial({
      color: FRONTIER_3D_COLOR,
      transparent: true,
      opacity: 0.032,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const envelope = new THREE.Mesh(
      frontierEnvelopeGeometry(frontierPoints, x0, x1, z0, z1),
      frontierMaterial,
    );
    scene.add(envelope);

    const sphereGeometry = new THREE.SphereGeometry(0.085, 32, 16);
    const ringGeometry = new THREE.TorusGeometry(0.14, 0.012, 10, 36);
    const pickables: THREE.Mesh[] = [];
    const objectBySlug = new Map<string, THREE.Mesh>();
    const baseMaterialBySlug = new Map<string, THREE.MeshStandardMaterial>();
    const ringBySlug = new Map<string, THREE.Mesh>();

    chartModels.forEach((m) => {
      const isFrontier = frontierSlugs.has(m.slug);
      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(isFrontier ? FRONTIER_3D_COLOR : DOMINATED_3D_COLOR),
        roughness: 0.62,
        metalness: 0.02,
        transparent: true,
        opacity: isFrontier ? 0.98 : 0.18,
      });
      const sphere = new THREE.Mesh(sphereGeometry, material);
      sphere.position.copy(positionFor(m));
      sphere.scale.setScalar(isFrontier ? 1.42 : 0.62);
      sphere.userData.slug = m.slug;
      scene.add(sphere);
      pickables.push(sphere);
      objectBySlug.set(m.slug, sphere);
      baseMaterialBySlug.set(m.slug, material);

      if (isFrontier) {
        const ring = new THREE.Mesh(
          ringGeometry,
          new THREE.MeshBasicMaterial({ color: "#0a0a0a", transparent: true, opacity: 0.46 }),
        );
        ring.position.copy(sphere.position);
        ring.rotation.x = Math.PI / 2;
        scene.add(ring);
        ringBySlug.set(m.slug, ring);

        const label = makeTextSprite(m.displayName, "#0a0a0a");
        label.position.copy(sphere.position).add(new THREE.Vector3(0.08, 0.18, 0.05));
        label.userData.isLabel = true;
        scene.add(label);
      }
    });

    const pointer = new THREE.Vector2(20, 20);
    const raycaster = new THREE.Raycaster();
    let localHover: string | null = null;
    let raf = 0;

    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, true);
    };

    const setVisualHover = (slug: string | null) => {
      objectBySlug.forEach((sphere, key) => {
        const material = baseMaterialBySlug.get(key);
        if (!material) return;
        const isFrontier = frontierSlugs.has(key);
        const isHovered = slug === key;
        const hasHover = slug !== null;
        sphere.scale.setScalar(isHovered ? 1.9 : isFrontier ? 1.42 : 0.62);
        material.opacity = isHovered ? 1 : hasHover && !isFrontier ? 0.1 : isFrontier ? 0.98 : 0.18;
      });
      ringBySlug.forEach((ring, key) => {
        ring.scale.setScalar(slug === key ? 1.25 : 1);
      });
    };

    const animate = () => {
      raf = window.requestAnimationFrame(animate);
      controls.update();
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(pickables, false)[0];
      const nextHover = hit ? String(hit.object.userData.slug) : null;
      if (nextHover !== localHover) {
        localHover = nextHover;
        hoveredRef.current = nextHover;
        onHoverRef.current(nextHover);
      }
      setVisualHover(hoveredRef.current);
      renderer.render(scene, camera);
    };

    const onPointerMove = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    };
    const onPointerLeave = () => {
      pointer.set(20, 20);
      localHover = null;
      hoveredRef.current = null;
      onHoverRef.current(null);
    };

    resize();
    animate();
    window.addEventListener("resize", resize);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      controls.dispose();
      renderer.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Sprite) {
          object.geometry?.dispose();
          if (Array.isArray(object.material)) {
            object.material.forEach((material) => material.dispose());
          } else {
            object.material?.dispose();
          }
        }
      });
      host.removeChild(renderer.domElement);
    };
  }, [models]);

  return (
    <div className="h-full w-full relative overflow-hidden bg-[#fbfbfa]">
      <div ref={hostRef} className="absolute inset-0" aria-label="3D model frontier chart" />
      <div className="absolute left-3 top-3 z-10 bg-white/90 border border-ink-100 rounded-lg px-3 py-2 text-[11px] text-ink-700 leading-snug">
        <div className="font-medium text-ink-900">True 3D frontier</div>
        <div>{frontierCount} non-dominated models across intelligence, latency, and cost.</div>
      </div>
      <div className="absolute left-3 bottom-3 z-10 flex items-center gap-4 text-[10px] uppercase tracking-[0.12em] text-ink-500">
        <span>Drag to rotate</span>
        <span>Scroll to zoom</span>
        <span>Hover a point</span>
      </div>
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

type Tab = "chart" | "frontier3d" | "detail";

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
            <TabBtn id="frontier3d" label="3D Frontier" />
            <TabBtn id="detail" label="Detail" />
          </div>
          <div className="flex items-center gap-6">
            {tab === "frontier3d" ? (
              <div className="text-[11px] text-ink-700">
                Green points are true frontier models. Pale points are dominated.
              </div>
            ) : (
              <FrontierLegend />
            )}
            {tab !== "frontier3d" && <CostLegend />}
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
          {tab === "frontier3d" && (
            <div className="h-full w-full relative">
              <ThreeFrontierChart
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
