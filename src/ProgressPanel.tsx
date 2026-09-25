import type { ReactNode } from "react";
import { Model, fmtMoney as money, fmtMultiple, shortName as short } from "./model";
import { PROGRESS_SPANS, Progress, ProgressSpan, Gain } from "./progress";

const SPAN_AGO: Record<ProgressSpan, string> = {
  "6m": "6 months ago",
  "1y": "a year ago",
  "2y": "2 years ago",
};

const seconds = (v: number) => (v < 10 ? v.toFixed(1) : Math.round(v).toString());

function cheaperLine(g: Gain) {
  const unit = g.unit === "task" ? " a task" : " per million tokens";
  return `${short(g.now)} matches it for ${money(g.nowValue)}${unit} instead of ${money(g.thenValue)}.`;
}
function fasterLine(g: Gain) {
  if (g.unit === "wait")
    return `${short(g.now)} answers in ${seconds(g.nowValue)} seconds instead of ${seconds(g.thenValue)}.`;
  return `${short(g.now)} writes ${Math.round(g.nowValue)} tokens a second instead of ${Math.round(g.thenValue)}.`;
}

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
  const ago = SPAN_AGO[span];
  const rows: { key: string; head: ReactNode; detail: string; pair: [Model, Model] }[] = [
    {
      key: "rank",
      head: (
        <>
          The best AI from {ago} now ranks <strong>#{progress.thenRankToday}</strong>
        </>
      ),
      detail: `That was ${short(progress.thenBest)}. ${progress.thenRankToday - 1} releases have beaten it since.`,
      pair: [progress.thenBest, progress.nowBest],
    },
  ];
  if (progress.cheaper) {
    const g = progress.cheaper;
    rows.push({
      key: "cheaper",
      head: (
        <>
          The same smarts now cost <strong>{fmtMultiple(g.ratio)} less</strong>
        </>
      ),
      detail: cheaperLine(g),
      pair: [g.then, g.now],
    });
  }
  if (progress.faster) {
    const g = progress.faster;
    rows.push({
      key: "faster",
      head: (
        <>
          And arrive <strong>{fmtMultiple(g.ratio)} faster</strong>
        </>
      ),
      detail: fasterLine(g),
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
        <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-ink-900">How far AI has come</h2>
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
      <ul className="mt-1.5 grid gap-0.5">
        {rows.map((row) => (
          <li key={`${span}-${row.key}`} className="progress-row">
            <button
              type="button"
              onMouseEnter={() => onPreview(row.pair)}
              onMouseLeave={() => onPreview(null)}
              onFocus={() => onPreview(row.pair)}
              onBlur={() => onPreview(null)}
              onClick={() => {
                onPreview(null);
                onCompare(row.pair);
              }}
              title="Compare these two on the map"
              className="group block w-full rounded-md px-1.5 py-2 text-left transition-colors hover:bg-wash"
            >
              <span className="block text-[14px] leading-snug text-ink-900 [&_strong]:font-semibold">
                {row.head}
              </span>
              <span className="mt-0.5 block text-[12px] leading-snug text-ink-500">{row.detail}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
