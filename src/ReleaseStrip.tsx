import type { ReactNode } from "react";
import { MetricConfig } from "./model";
import type { Release } from "./releases";

const UP = "#17804a";
const DOWN = "#b42318";

const fmtDay = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

const fmtDelta = (d: number) => {
  if (Math.abs(d) < 0.05) return "±0";
  return `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}`;
};

/**
 * The front door for "something new came out — is it any good?". A plain table,
 * one row per launch: who, when, where it ranks, and what it gained over the
 * version it replaces. Clicking a row opens exactly that comparison on the map.
 */
export function ReleaseStrip({
  releases,
  metric,
  activeKey,
  onOpen,
  onPreview,
  allReleases,
}: {
  releases: Release[];
  metric: MetricConfig;
  activeKey: string | null;
  onOpen: (release: Release) => void;
  onPreview: (release: Release | null) => void;
  /** The full changelog, tucked behind a quiet link. */
  allReleases: ReactNode;
}) {
  if (!releases.length) return null;

  return (
    <section aria-label="Latest releases" className="w-full min-w-0 sm:w-[31rem]">
      <div className="flex items-center justify-between gap-4 border-b border-ink-100 pb-1.5 text-[11px] leading-none text-ink-500">
        <h2 className="font-medium text-ink-900">Latest releases</h2>
        {allReleases}
      </div>
      <ul>
        {releases.map((release, index) => {
          const active = release.key === activeKey;
          const delta = release.delta;
          return (
            <li key={release.key} className="release-row" style={{ animationDelay: `${80 + index * 50}ms` }}>
              <button
                type="button"
                onClick={() => onOpen(release)}
                onMouseEnter={() => onPreview(release)}
                onMouseLeave={() => onPreview(null)}
                onFocus={() => onPreview(release)}
                onBlur={() => onPreview(null)}
                aria-pressed={active}
                aria-label={`${release.family} by ${release.creator}, released ${fmtDay(
                  release.releaseMs,
                )}. Ranked ${release.rank} on ${metric.noun}.${
                  release.predecessorLabel && delta != null
                    ? ` ${fmtDelta(delta)} over ${release.predecessorLabel}.`
                    : ""
                } Compare on the map.`}
                className={`group flex w-full items-baseline gap-4 border-b border-ink-100 px-1 py-[7px] text-left text-[12.5px] leading-none transition-colors ${
                  active ? "bg-ink-50" : "hover:bg-wash"
                }`}
              >
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium text-ink-900">{release.family}</span>
                  <span className="ml-2 text-[11.5px] text-ink-500">
                    {release.creator} · {fmtDay(release.releaseMs)}
                  </span>
                </span>
                <span
                  className="hidden w-8 shrink-0 text-right tabular-nums text-ink-700 sm:inline"
                  title={`Ranks #${release.rank} among every release on ${metric.noun}`}
                >
                  #{release.rank}
                </span>
                <span className="w-[8.5rem] shrink-0 truncate text-right text-[11.5px] text-ink-500">
                  {release.predecessorLabel && delta != null ? (
                    <>
                      <span
                        className="font-medium tabular-nums"
                        style={{ color: delta > 0.05 ? UP : delta < -0.05 ? DOWN : undefined }}
                      >
                        {fmtDelta(delta)}
                      </span>{" "}
                      vs {release.predecessorLabel}
                    </>
                  ) : (
                    "New line"
                  )}
                </span>
                <span
                  aria-hidden
                  className="w-3 shrink-0 text-right text-ink-300 transition-transform group-hover:translate-x-0.5 group-hover:text-ink-700"
                >
                  →
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
