import type { ReactNode } from "react";
import { MetricConfig } from "./model";
import type { Release } from "./releases";

const DAY_MS = 86_400_000;

const fmtDay = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

/** "3 days ago" reads faster than a date when the point is freshness. */
export const ago = (ms: number) => {
  const days = Math.floor((Date.now() - ms) / DAY_MS);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 14) return `${days} days ago`;
  return fmtDay(ms);
};

/** The same, short enough to sit beside a name: "4d", "Sep 2". */
const agoShort = (ms: number) => {
  const days = Math.floor((Date.now() - ms) / DAY_MS);
  if (days <= 0) return "Today";
  if (days < 14) return `${days}d ago`;
  return fmtDay(ms);
};

/**
 * The front door for "something new came out — is it any good?". One row per
 * launch: its name, and the one reason it matters. Clicking a row puts that
 * release in focus on the map.
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
          const { gist } = release;
          return (
            <li key={release.key} className="release-row" style={{ animationDelay: `${80 + index * 50}ms` }}>
              <button
                type="button"
                onClick={() => {
                  onPreview(null);
                  onOpen(release);
                }}
                onMouseEnter={() => onPreview(release)}
                onMouseLeave={() => onPreview(null)}
                onFocus={() => onPreview(release)}
                onBlur={() => onPreview(null)}
                aria-pressed={active}
                title={`${release.creator}, #${release.rank} on ${metric.noun}.${gist.detail ? ` ${gist.detail}` : ""}`}
                aria-label={`${release.family} by ${release.creator}, released ${fmtDay(release.releaseMs)}. ${
                  gist.lead
                }${gist.rest}. Show it on the map.`}
                className={`group -mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 text-left transition-colors ${
                  rail ? "py-2" : "py-[5px]"
                } ${active ? "bg-ink-50" : "hover:bg-wash"}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate text-[13.5px] font-semibold leading-tight text-ink-900">
                      {release.family}
                    </span>
                    <span className="ml-auto shrink-0 text-[11px] leading-tight text-ink-500">
                      {agoShort(release.releaseMs)}
                    </span>
                  </span>
                  <span
                    className={`mt-0.5 block text-[12px] leading-snug text-ink-500 ${rail ? "" : "truncate"}`}
                  >
                    <span className="font-medium" style={gist.tone ? { color: gist.tone } : undefined}>
                      {gist.lead}
                    </span>
                    {gist.rest}
                  </span>
                </span>
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
    </section>
  );
}
