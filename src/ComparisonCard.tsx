import { Model, MetricConfig, RelativeStat, fmtDate } from "./model";

const fmtScore = (v: number | null) => (v == null ? "—" : Number(v.toFixed(1)).toString());

/**
 * One side of the before/after: role, name, release date, score. The date sits
 * directly under the name so an old high scorer and a new cheap one read as a
 * generational pair without any copy having to say so.
 */
function ModelRow({
  role,
  model,
  metric,
  onRemove,
}: {
  role: string;
  model: Model;
  metric: MetricConfig;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <div className="text-[11px] leading-none text-ink-500">{role}</div>
        <div className="mt-1.5 truncate text-[16px] font-semibold leading-tight text-ink-900">
          {model.displayName}
        </div>
        <div className="mt-1 truncate text-[11.5px] leading-none text-ink-500">
          {fmtDate(model.releaseMs)}
        </div>
      </div>
      <div className="shrink-0 pt-[13px] text-[16px] font-medium leading-none tabular-nums text-ink-900">
        {fmtScore(metric.value(model))}
      </div>
      <button
        onClick={onRemove}
        aria-label={`Remove ${model.displayName}`}
        title="Remove"
        className="tap-target-square -mr-1 mt-[6px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[14px] leading-none text-ink-300 transition-colors hover:bg-ink-50 hover:text-ink-900"
      >
        ×
      </button>
    </div>
  );
}

/** The payoff figure: display type, quiet label, quiet context line. */
function StatCell({ stat }: { stat: RelativeStat }) {
  const unknown = stat.value === "—";
  return (
    <div className="min-w-0">
      <div
        className={`font-serif text-[26px] leading-none tabular-nums sm:text-[29px] ${
          unknown ? "text-ink-300" : "text-ink-900"
        }`}
        style={{ fontOpticalSizing: "auto" }}
      >
        {stat.value}
      </div>
      <div
        className={`mt-2 text-[11.5px] leading-snug ${unknown ? "text-ink-300" : "text-ink-500"}`}
      >
        {stat.label}
      </div>
      {stat.detail && (
        <div className="mt-0.5 truncate text-[11px] leading-snug tabular-nums text-ink-300">
          {stat.detail}
        </div>
      )}
    </div>
  );
}

/**
 * The comparison, as a self-contained card that survives being cropped out of a
 * screenshot: what you use now, what you'd move to, and the three relative
 * numbers between them.
 */
export function ComparisonCard({
  baseline,
  candidate,
  stats,
  metric,
  unavailableName,
  copyState,
  shareUrl,
  onSwap,
  onClearBaseline,
  onClearCandidate,
  onClose,
  onCopyLink,
}: {
  baseline: Model;
  candidate: Model | null;
  stats: RelativeStat[];
  metric: MetricConfig;
  unavailableName: string | null;
  copyState: "idle" | "copied" | "failed";
  shareUrl: string;
  onSwap: () => void;
  onClearBaseline: () => void;
  onClearCandidate: () => void;
  onClose: () => void;
  onCopyLink: () => void;
}) {
  return (
    <section
      aria-label="Model comparison"
      className="comparison-strip relative z-30 w-full max-w-[520px] shrink-0 rounded-2xl border border-ink-100 bg-card px-4 py-3.5 sm:px-5 sm:py-4"
      style={{ boxShadow: "0 1px 3px rgba(23,20,10,0.04), 0 8px 24px rgba(23,20,10,0.04)" }}
    >
      <header className="flex items-start justify-between gap-3">
        <p className="min-w-0 truncate text-[11.5px] leading-none text-ink-500">
          Compared on {metric.noun}
        </p>
        <button
          onClick={onClose}
          aria-label="Close comparison"
          className="tap-target-square -mr-1 -mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[15px] leading-none text-ink-300 transition-colors hover:bg-ink-50 hover:text-ink-900"
        >
          ×
        </button>
      </header>

      <div className="mt-3">
        <ModelRow role="Using now" model={baseline} metric={metric} onRemove={onClearBaseline} />
      </div>

      <div className="my-3 flex items-center gap-3">
        <span className="h-px flex-1 bg-ink-100" aria-hidden />
        <span className="text-[12px] leading-none text-ink-300" aria-hidden>
          ↓
        </span>
        <span className="h-px flex-1 bg-ink-100" aria-hidden />
        {candidate && (
          <button
            onClick={onSwap}
            aria-label="Swap the models"
            title="Swap models"
            className="tap-target-square -mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[12px] leading-none text-ink-300 transition-colors hover:bg-ink-50 hover:text-ink-900"
          >
            ⇄
          </button>
        )}
      </div>

      {candidate ? (
        <ModelRow
          role="Considering"
          model={candidate}
          metric={metric}
          onRemove={onClearCandidate}
        />
      ) : (
        <div className="min-w-0">
          <div className="text-[11px] leading-none text-ink-500">Considering</div>
          <p className="mt-1.5 text-[12.5px] leading-snug text-ink-500">
            Click any dot on the chart, or pick one from the shortlist.
          </p>
        </div>
      )}

      {unavailableName ? (
        <p className="mt-4 border-t border-ink-100 pt-3.5 text-[12px] leading-snug text-ink-500">
          <span className="font-semibold text-ink-900">{unavailableName}</span> isn’t available in
          this view.
        </p>
      ) : stats.length ? (
        <div className="mt-4 grid grid-cols-3 items-start gap-x-3 border-t border-ink-100 pt-4 sm:gap-x-5">
          {stats.map((stat) => (
            <StatCell key={stat.key} stat={stat} />
          ))}
        </div>
      ) : null}

      <div className="mt-4 flex items-center justify-end">
        {copyState === "failed" ? (
          <input
            autoFocus
            readOnly
            value={shareUrl}
            onFocus={(event) => event.currentTarget.select()}
            onClick={(event) => event.currentTarget.select()}
            aria-label="Comparison link, selected for copying"
            className="w-full max-w-[240px] rounded-full border border-ink-300 px-3 py-1.5 text-[11px] text-ink-700 focus:border-ink-900 focus:outline-none"
          />
        ) : (
          <button
            onClick={onCopyLink}
            className="tap-target h-8 rounded-full bg-ink-900 px-3.5 text-[12px] font-medium text-paper transition-colors hover:bg-ink-700"
          >
            {copyState === "copied" ? "Link copied" : "Copy link"}
          </button>
        )}
      </div>
    </section>
  );
}
