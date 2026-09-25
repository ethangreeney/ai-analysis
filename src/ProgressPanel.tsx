import { Model, fmtCost, fmtMultiple, nameParts } from "./model";
import { PROGRESS_SPANS, Progress, ProgressSpan, Gain } from "./progress";

const short = (m: Model) => {
  const { base, effort } = nameParts(m);
  return effort ? `${base} ${effort}` : base;
};

const fmtValue = (g: Gain, v: number) =>
  g.unit === "task"
    ? fmtCost(v)
    : g.unit === "tokens"
      ? `$${v < 1 ? v.toFixed(2) : v.toFixed(v < 10 ? 2 : 0)}`
      : g.unit === "wait"
        ? `${v < 10 ? v.toFixed(1) : v.toFixed(0)}s`
        : `${Math.round(v)} tok/s`;

const unitNote = (g: Gain) =>
  g.unit === "task"
    ? "per task"
    : g.unit === "tokens"
      ? "per 1M tokens"
      : g.unit === "wait"
        ? "wait"
        : "output speed";

/**
 * The timeline's headline: how far the field moved in a chosen window. Each
 * row is a real pair of models, so pointing at it lights both up and clicking
 * opens that exact comparison.
 */
export function ProgressPanel({
  progress,
  span,
  onSpan,
  onPreview,
  onCompare,
}: {
  progress: Progress;
  span: ProgressSpan;
  onSpan: (span: ProgressSpan) => void;
  onPreview: (pair: [Model, Model] | null) => void;
  onCompare: (pair: [Model, Model]) => void;
}) {
  const rows: { key: string; big: string; title: string; detail: string; pair: [Model, Model] }[] = [
    {
      key: "smarter",
      big: `+${progress.points.toFixed(1)}`,
      title: "points smarter at the top",
      detail: `${short(progress.thenBest)} → ${short(progress.nowBest)}`,
      pair: [progress.thenBest, progress.nowBest],
    },
  ];
  if (progress.cheaper) {
    const g = progress.cheaper;
    rows.push({
      key: "cheaper",
      big: fmtMultiple(g.ratio),
      title: "cheaper for the same smarts",
      detail: `${short(g.now)}, ${fmtValue(g, g.thenValue)} → ${fmtValue(g, g.nowValue)} ${unitNote(g)}`,
      pair: [g.then, g.now],
    });
  }
  if (progress.faster) {
    const g = progress.faster;
    rows.push({
      key: "faster",
      big: fmtMultiple(g.ratio),
      title: "faster for the same smarts",
      detail: `${short(g.now)}, ${fmtValue(g, g.thenValue)} → ${fmtValue(g, g.nowValue)} ${unitNote(g)}`,
      pair: [g.then, g.now],
    });
  }

  return (
    <section
      aria-label="Progress over time"
      className="progress-panel w-[22.5rem] rounded-lg border border-ink-100 bg-card/95 p-3 backdrop-blur"
      style={{ boxShadow: "0 1px 2px rgba(14,15,17,0.04), 0 8px 24px rgba(14,15,17,0.06)" }}
    >
      <div className="flex items-center justify-between gap-3 px-1">
        <h2 className="text-[12px] font-medium text-ink-900">Progress in the last</h2>
        <div className="flex rounded-md bg-ink-50 p-0.5" role="group" aria-label="Time window">
          {PROGRESS_SPANS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => onSpan(s.key)}
              aria-pressed={span === s.key}
              className={`rounded px-2 py-1 text-[11px] leading-none transition-colors ${
                span === s.key
                  ? "bg-card font-medium text-ink-900 shadow-[0_1px_2px_rgba(14,15,17,0.08)]"
                  : "text-ink-500 hover:text-ink-900"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <ul className="mt-2">
        {rows.map((row) => (
          <li key={`${span}-${row.key}`} className="progress-row">
            <button
              type="button"
              onMouseEnter={() => onPreview(row.pair)}
              onMouseLeave={() => onPreview(null)}
              onFocus={() => onPreview(row.pair)}
              onBlur={() => onPreview(null)}
              onClick={() => onCompare(row.pair)}
              className="group flex w-full items-baseline gap-3 rounded-md px-1 py-1.5 text-left transition-colors hover:bg-wash"
            >
              <span className="w-[4.25rem] shrink-0 text-[22px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-ink-900">
                {row.big}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] leading-tight text-ink-900">{row.title}</span>
                <span className="mt-0.5 block truncate text-[11px] leading-tight text-ink-500">
                  {row.detail}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
