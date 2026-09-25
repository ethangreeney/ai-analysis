import type { ReactNode } from "react";
import { MetricConfig } from "./model";
import type { Release } from "./releases";

const UP = "#17804a";
const DOWN = "#b42318";
const DAY_MS = 86_400_000;

const fmtDay = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

const fmtDelta = (d: number) => {
  if (Math.abs(d) < 0.05) return "±0";
  return `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}`;
};

/** "3 days ago" reads faster than a date when the point is freshness. */
const ago = (ms: number) => {
  const days = Math.floor((Date.now() - ms) / DAY_MS);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 14) return `${days} days ago`;
  return fmtDay(ms);
};

/** The gain over the release it replaces, said the way people say it. */
function verdict(delta: number | null, predecessor: string | null) {
  const v = (lead: string, rest: string, tone: string | null) => ({ lead, rest, tone, text: lead + rest });
  if (delta == null || !predecessor) return v("A brand-new line", "", null);
  if (delta >= 5) return v("Big jump", ` over ${predecessor}`, UP);
  if (delta >= 2) return v("Clear step up", ` from ${predecessor}`, UP);
  if (delta >= 0.5) return v("Small step up", ` from ${predecessor}`, UP);
  if (delta > -0.5) return v("About the same", ` as ${predecessor}`, null);
  return v("Behind", ` ${predecessor}`, DOWN);
}

/** Rank as a phrase; only the top of the table is worth shouting about. */
const standing = (rank: number) =>
  rank === 1 ? "New #1" : rank <= 3 ? "Top 3" : rank <= 10 ? "Top 10" : null;

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
  variant = "header",
}: {
  /** "rail": the side panel beside the chart, with room to breathe. */
  variant?: "header" | "rail";
  releases: Release[];
  metric: MetricConfig;
  activeKey: string | null;
  onOpen: (release: Release) => void;
  onPreview: (release: Release | null) => void;
  /** The full changelog, tucked behind a quiet link. */
  allReleases: ReactNode;
}) {
  if (!releases.length) return null;
  const rail = variant === "rail";

  return (
    <section
      aria-label="Latest releases"
      className={rail ? "flex w-full min-w-0 flex-col" : "w-full min-w-0 sm:w-[25rem]"}
    >
      <div
        className={`flex items-center justify-between gap-4 text-ink-500 ${
          rail ? "pb-2 text-[11.5px] leading-none" : "pb-1 text-[11px] leading-none"
        }`}
      >
        <h2 className={`font-semibold text-ink-900 ${rail ? "text-[13px] tracking-[-0.01em]" : "font-medium"}`}>
          Latest releases
        </h2>
        {allReleases}
      </div>
      <ul className={rail ? "grid gap-0.5" : "grid"}>
        {releases.map((release, index) => {
          const active = release.key === activeKey;
          const delta = release.delta;
          const v = verdict(delta, release.predecessorLabel);
          const badge = standing(release.rank);
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
                title={`#${release.rank} on ${metric.noun}${
                  release.predecessorLabel && delta != null
                    ? `, ${fmtDelta(delta)} points vs ${release.predecessorLabel}`
                    : ""
                }. Click to compare.`}
                aria-label={`${release.family} by ${release.creator}, released ${fmtDay(
                  release.releaseMs,
                )}. Ranked ${release.rank} on ${metric.noun}. ${v.text}. Compare on the map.`}
                className={`group -mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 text-left transition-colors ${
                  rail ? "py-2" : "py-[5px]"
                } ${
                  active ? "bg-ink-50" : "hover:bg-wash"
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[13.5px] font-semibold leading-tight text-ink-900">
                      {release.family}
                    </span>
                    {badge && (
                      <span
                        className={`shrink-0 rounded-full px-1.5 py-[3px] text-[10px] font-medium leading-none ${
                          release.rank === 1 ? "bg-ink-900 text-white" : "bg-ink-50 text-ink-700"
                        }`}
                      >
                        {badge}
                      </span>
                    )}
                  </span>
                  <span
                    className={`mt-0.5 block text-[12px] leading-tight text-ink-500 ${rail ? "" : "truncate"}`}
                  >
                    <span className="font-medium" style={v.tone ? { color: v.tone } : undefined}>
                      {v.lead}
                    </span>
                    {v.rest}
                  </span>
                  {rail && (
                    <span className="mt-1 block text-[11px] leading-tight text-ink-500">
                      {release.creator} · {ago(release.releaseMs)}
                    </span>
                  )}
                </span>
                {!rail && (
                  <span className="shrink-0 text-right text-[11px] leading-tight text-ink-500">
                    <span className="block">{release.creator}</span>
                    <span className="block">{ago(release.releaseMs)}</span>
                  </span>
                )}
                <span
                  aria-hidden
                  className="shrink-0 text-ink-300 transition-transform group-hover:translate-x-0.5 group-hover:text-ink-700"
                >
                  →
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {rail && (
        <p className="mt-3 border-t border-ink-100 pt-3 text-[11.5px] leading-snug text-ink-500">
          Pick a release to see it against the version it replaces.
        </p>
      )}
    </section>
  );
}
