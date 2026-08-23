import { useEffect, useMemo, useRef, useState } from "react";
import { fetchedAtMs, fmtDate, Y_METRICS, NEW_MODEL_COLOR, type Model } from "./model";

const RECENT_COUNT = 12;

/** When a model entered our dataset — vendor release date is the fallback. */
const addedMs = (m: Model): number | null => {
  const added = m.addedAt ? Date.parse(m.addedAt) : NaN;
  if (Number.isFinite(added)) return added;
  const released = m.releaseDate ? Date.parse(m.releaseDate) : NaN;
  return Number.isFinite(released) ? released : null;
};

/** UTC day key so models added hours apart still group under one heading. */
const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

interface Entry {
  model: Model;
  ms: number;
}

interface Group {
  key: string;
  ms: number;
  entries: Entry[];
}

export function Changelog({
  models,
  onSelect,
}: {
  models: Model[];
  onSelect: (slug: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const groups = useMemo<Group[]>(() => {
    const recent = models
      .map((model) => ({ model, ms: addedMs(model) }))
      .filter((entry): entry is Entry => entry.ms != null)
      .sort((a, b) => b.ms - a.ms)
      .slice(0, RECENT_COUNT);

    const out: Group[] = [];
    for (const entry of recent) {
      const key = dayKey(entry.ms);
      const last = out[out.length - 1];
      if (last && last.key === key) last.entries.push(entry);
      else out.push({ key, ms: entry.ms, entries: [entry] });
    }
    return out;
  }, [models]);

  const newest = groups[0]?.entries[0]?.model ?? null;

  // Escape anywhere, and any mousedown outside the control, dismiss the panel.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Swallow it here so Escape closes this panel without also tearing down
      // the comparison listening one level up on window.
      event.stopPropagation();
      setOpen(false);
    };
    const onMouseDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [open]);

  if (!newest) return null;

  return (
    <div ref={rootRef} className="relative text-right">
      <button
        type="button"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        aria-expanded={open}
        aria-label={`Recently added models. Newest: ${newest.displayName}`}
        className={`tap-target inline-flex items-center gap-1.5 rounded-full border border-transparent px-2.5 py-1 text-[11.5px] leading-none transition-colors hover:bg-ink-50 ${
          open ? "bg-ink-50 text-ink-900" : "text-ink-500"
        }`}
      >
        <span>Newest</span>
        <span aria-hidden className="text-ink-300">
          ·
        </span>
        <span className="font-medium" style={{ color: NEW_MODEL_COLOR }}>
          {newest.displayName}
        </span>
        <svg
          width="9"
          height="6"
          viewBox="0 0 9 6"
          aria-hidden
          className={`shrink-0 text-ink-300 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path
            d="M1 1.5 4.5 4.75 8 1.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-40 mt-2 w-80 overflow-hidden rounded-2xl border border-ink-100 bg-card text-left"
          style={{
            boxShadow: "0 1px 3px rgba(23,20,10,0.04), 0 8px 24px rgba(23,20,10,0.04)",
          }}
        >
          <div className="px-3.5 pb-2 pt-3 text-[12.5px] font-semibold text-ink-900">
            Recently added
          </div>

          <div className="max-h-[19rem] overflow-y-auto px-1.5 pb-1.5">
            {groups.map((group) => {
              const grouped = group.entries.length > 1;
              return (
                <div key={group.key}>
                  {grouped && (
                    <div className="px-2 pb-1 pt-2 text-[11px] text-ink-500">
                      {fmtDate(group.ms)}
                    </div>
                  )}
                  {group.entries.map(({ model, ms }) => (
                    <button
                      key={model.slug}
                      type="button"
                      onClick={() => {
                        onSelect(model.slug);
                        setOpen(false);
                      }}
                      className="tap-target flex w-full items-baseline justify-between gap-3 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-ink-50"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[12px] font-semibold leading-tight text-ink-900">
                          {model.displayName}
                        </span>
                        {!grouped && (
                          <span className="mt-0.5 block text-[11px] leading-tight text-ink-500">
                            {fmtDate(ms)}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-[11.5px] tabular-nums text-ink-700">
                        {model.intelligence.toFixed(1)}
                      </span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>

          <div className="border-t border-ink-100 px-3.5 py-2 text-[11px] leading-tight text-ink-500">
            {Y_METRICS.intelligence.rowLabel} score shown. Data updated {fmtDate(fetchedAtMs)}.
          </div>
        </div>
      )}
    </div>
  );
}
