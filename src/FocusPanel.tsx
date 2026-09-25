import { useState } from "react";
import { Model, MetricConfig, fmtCost, isPositiveFinite, nameParts } from "./model";
import type { Focus, FocusScope } from "./releases";
import { ago } from "./ReleaseStrip";

const seconds = (v: number | null) =>
  isPositiveFinite(v) ? `${v < 10 ? v.toFixed(1) : Math.round(v)}s` : "—";

function Swatch({ kind }: { kind: "focus" | "ghost" | "all" }) {
  return (
    <svg width="22" height="6" aria-hidden className="shrink-0">
      <line
        x1="1"
        y1="3"
        x2="21"
        y2="3"
        stroke={kind === "focus" ? "#0e0f11" : kind === "ghost" ? "#6a6f78" : "#c4c7cc"}
        strokeWidth={kind === "focus" ? 2.4 : 1.6}
        strokeDasharray={kind === "ghost" ? "5 4" : undefined}
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * One release up close. It opens on the one thing worth knowing about it; the
 * three lines on the map carry the rest, and the per-setting numbers wait
 * behind a toggle for anyone who wants them.
 */
export function FocusPanel({
  focus,
  metric,
  onScope,
  onClose,
  onCompare,
  onHoverModel,
  onPickModel,
  compact = false,
}: {
  focus: Focus;
  metric: MetricConfig;
  onScope: (scope: FocusScope) => void;
  onClose: () => void;
  onCompare: () => void;
  onHoverModel: (slug: string | null) => void;
  onPickModel: (model: Model) => void;
  /** Small screens: header, switch and key only; the chart does the rest. */
  compact?: boolean;
}) {
  const { release } = focus;
  const { gist } = release;
  const [showNumbers, setShowNumbers] = useState(false);
  const lineup = focus.scope === "lineup";
  const rows = [...focus.models].sort((a, b) => metric.value(b)! - metric.value(a)!);
  // In a lineup, drop the shared prefix: "Astra max", not "GPT-6 Astra max".
  const prefix = focus.lineupLabel?.replace(/^All /, "") ?? "";
  const rowName = (m: Model) => {
    const { base, effort } = nameParts(m);
    const short = lineup && base.startsWith(`${prefix} `) ? base.slice(prefix.length + 1) : base;
    return lineup ? `${short}${effort ? ` ${effort}` : ""}` : effort ?? base;
  };

  const scopeSwitch = focus.lineupLabel && (
    <div
      role="group"
      aria-label="Show"
      className="flex w-fit items-center gap-0.5 rounded-md bg-ink-50 p-0.5 ring-1 ring-inset ring-ink-100/70"
    >
      {(
        [
          ["release", release.family],
          ["lineup", focus.lineupLabel],
        ] as [FocusScope, string][]
      ).map(([value, label]) => (
        <button
          key={value}
          type="button"
          onClick={() => onScope(value)}
          aria-pressed={focus.scope === value}
          className={`rounded px-2 py-1 text-[11.5px] leading-none transition-colors ${
            focus.scope === value
              ? "bg-card font-medium text-ink-900 shadow-[0_1px_2px_rgba(14,15,17,0.08)]"
              : "text-ink-500 hover:text-ink-900"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  // Small screens: one slim bar, so the chart keeps its height.
  if (compact) {
    return (
      <section
        aria-label={`${focus.label} in focus`}
        className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] leading-none"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Back to latest releases"
          className="text-ink-500 transition-colors hover:text-ink-900"
        >
          ←
        </button>
        <span className="font-semibold text-ink-900">{release.family}</span>
        <span className="text-ink-700">
          <span className="font-medium" style={gist.tone ? { color: gist.tone } : undefined}>
            {gist.lead}
          </span>
          {gist.rest}
        </span>
        {scopeSwitch}
        {focus.ghostLabel && (
          <button
            type="button"
            onClick={onCompare}
            className="ml-auto rounded-full bg-ink-900 px-3 py-1.5 text-[11.5px] font-medium text-white"
          >
            Compare →
          </button>
        )}
      </section>
    );
  }

  return (
    <section aria-label={`${focus.label} in focus`} className="focus-panel flex w-full min-w-0 flex-col gap-3">
      <button
        type="button"
        onClick={onClose}
        className="-ml-1 w-fit rounded px-1 text-[11.5px] text-ink-500 transition-colors hover:text-ink-900"
      >
        ← Latest releases
      </button>

      <header className="grid gap-1.5">
        <div>
          <h2 className="truncate text-[17px] font-semibold leading-tight tracking-[-0.015em] text-ink-900">
            {release.family}
          </h2>
          <p className="mt-0.5 text-[11.5px] leading-snug text-ink-500">
            {release.creator} · {ago(release.releaseMs)}
          </p>
        </div>
        <p className="text-[13.5px] leading-snug text-ink-900">
          <span className="font-semibold" style={gist.tone ? { color: gist.tone } : undefined}>
            {gist.lead}
          </span>
          {gist.rest}
        </p>
        {gist.detail && <p className="text-[12px] leading-snug text-ink-500">{gist.detail}</p>}
      </header>

      {scopeSwitch}

      <ul className="grid gap-1.5 text-[11.5px] leading-none text-ink-700">
        <li className="flex items-center gap-2">
          <Swatch kind="focus" />
          {focus.label}
        </li>
        {focus.ghostLabel && (
          <li className="flex items-center gap-2 text-ink-500">
            <Swatch kind="ghost" />
            {focus.ghostLabel}, before
          </li>
        )}
        <li className="flex items-center gap-2 text-ink-500">
          <Swatch kind="all" />
          Best of all models
        </li>
      </ul>

      <div>
        <button
          type="button"
          onClick={() => setShowNumbers((v) => !v)}
          aria-expanded={showNumbers}
          className="-ml-1 flex items-center gap-1 rounded px-1 text-[11.5px] text-ink-500 transition-colors hover:text-ink-900"
        >
          <span aria-hidden className={`inline-block transition-transform ${showNumbers ? "rotate-90" : ""}`}>
            ›
          </span>
          {showNumbers ? "Hide" : "Show"} the numbers
        </button>
        {showNumbers && (
          <table className="mt-1.5 w-full table-fixed border-collapse text-[12px] tabular-nums">
            <colgroup>
              <col />
              <col className="w-[2.75rem]" />
              <col className="w-[3rem]" />
              <col className="w-[3.25rem]" />
            </colgroup>
            <thead>
              <tr className="text-[10.5px] text-ink-500">
                <th className="py-1 text-left font-normal">{lineup ? "Model" : "Setting"}</th>
                <th className="py-1 text-right font-normal">Score</th>
                <th className="py-1 text-right font-normal">Wait</th>
                <th className="py-1 text-right font-normal">Cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr
                  key={m.slug}
                  className="cursor-pointer border-t border-ink-100 transition-colors hover:bg-wash"
                  onMouseEnter={() => onHoverModel(m.slug)}
                  onMouseLeave={() => onHoverModel(null)}
                  onClick={() => onPickModel(m)}
                  title="Click to compare"
                >
                  <td className="truncate py-1.5 pr-2 text-ink-900" title={m.displayName}>
                    {rowName(m)}
                  </td>
                  <td className="py-1.5 text-right text-ink-900">{metric.value(m)!.toFixed(1)}</td>
                  <td className="py-1.5 pl-2 text-right text-ink-700">{seconds(m.e2eLatency)}</td>
                  <td className="py-1.5 pl-2 text-right text-ink-700">{fmtCost(m.costPerTask)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {focus.ghostLabel && (
        <button
          type="button"
          onClick={onCompare}
          className="w-fit rounded-full bg-ink-900 px-3.5 py-2 text-[12px] font-medium leading-none text-white transition-opacity hover:opacity-85"
        >
          Compare with {focus.ghostLabel} →
        </button>
      )}
    </section>
  );
}
