import { Model, MetricConfig, familyOf, isPositiveFinite, nameParts } from "./model";

const DAY_MS = 86_400_000;

/**
 * One launch as people talk about it — "Claude Opus 5.5 came out" — rather than
 * the five effort variants Artificial Analysis benchmarks it as.
 */
export interface Release {
  key: string;
  family: string;
  creator: string;
  releaseMs: number;
  /** Variants, best first on the active metric. */
  models: Model[];
  flagship: Model;
  /** Position of this release's best variant among every release's best. */
  rank: number;
  /** The variant of the release this one replaces, matched on effort. */
  predecessor: Model | null;
  /** Name of the release this one replaces. */
  predecessorLabel: string | null;
  /** Flagship minus predecessor on the active metric. */
  delta: number | null;
}

/** "GPT-5.6 Sol" and "GPT-6 Sol" are the same line; only the numbers differ. */
const lineOf = (family: string) => family.replace(/\d+(?:\.\d+)*/g, "#").toLowerCase();

const versionOf = (family: string) =>
  (family.match(/\d+(?:\.\d+)*/g) ?? []).join(".").split(".").filter(Boolean).map(Number);

const compareVersions = (a: number[], b: number[]) => {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
};

interface Family {
  key: string;
  family: string;
  creator: string;
  releaseMs: number;
  models: Model[];
  best: number;
}

function familiesOf(models: Model[], metric: MetricConfig): Family[] {
  const byKey = new Map<string, Family>();
  for (const m of models) {
    const value = metric.value(m);
    if (!isPositiveFinite(value) || m.releaseMs == null) continue;
    const family = familyOf(m);
    const key = `${m.creator}|${family}`;
    const current = byKey.get(key);
    if (current) {
      current.models.push(m);
      current.releaseMs = Math.max(current.releaseMs, m.releaseMs);
      current.best = Math.max(current.best, value);
    } else {
      byKey.set(key, { key, family, creator: m.creator, releaseMs: m.releaseMs, models: [m], best: value });
    }
  }
  for (const f of byKey.values()) {
    f.models.sort((a, b) => metric.value(b)! - metric.value(a)!);
  }
  return [...byKey.values()];
}

/** Same effort as the new model where the old release had one, else its best. */
function matchVariant(target: Model, candidates: Model[]): Model {
  const effort = nameParts(target).effort;
  return candidates.find((m) => nameParts(m).effort === effort) ?? candidates[0];
}

function predecessorFamily(release: Family, all: Family[]): Family | null {
  const earlier = all.filter(
    (f) => f.creator === release.creator && f.key !== release.key && f.releaseMs < release.releaseMs,
  );
  const line = lineOf(release.family);
  const version = versionOf(release.family);
  const sameLine = earlier
    .filter((f) => lineOf(f.family) === line && compareVersions(versionOf(f.family), version) < 0)
    .sort(
      (a, b) =>
        compareVersions(versionOf(b.family), versionOf(a.family)) || b.releaseMs - a.releaseMs,
    );
  if (sameLine.length) return sameLine[0];
  // A brand-new line (GPT-6 Astra) has no older version; the fairest yardstick
  // is the lab's best release before it.
  return earlier.sort((a, b) => b.best - a.best)[0] ?? null;
}

function toRelease(f: Family, all: Family[], metric: MetricConfig): Release {
  const flagship = f.models[0];
  const pred = predecessorFamily(f, all);
  const predecessor = pred ? matchVariant(flagship, pred.models) : null;
  const rank = 1 + all.filter((other) => other.best > f.best).length;
  return {
    key: f.key,
    family: f.family,
    creator: f.creator,
    releaseMs: f.releaseMs,
    models: f.models,
    flagship,
    rank,
    predecessor,
    predecessorLabel: pred ? pred.family : null,
    delta: predecessor ? metric.value(flagship)! - metric.value(predecessor)! : null,
  };
}

/**
 * The launches worth a look: recent, and good enough to matter. A 0.9B research
 * model released yesterday shouldn't push GPT-6 off the front page.
 */
export function recentReleases(
  models: Model[],
  metric: MetricConfig,
  { windowDays = 30, limit = 3, maxRank = 20 } = {},
): Release[] {
  const all = familiesOf(models, metric);
  if (!all.length) return [];
  const newest = Math.max(...all.map((f) => f.releaseMs));
  return all
    .filter((f) => f.releaseMs >= newest - windowDays * DAY_MS)
    .map((f) => toRelease(f, all, metric))
    .filter((r) => r.rank <= maxRank)
    .sort((a, b) => b.releaseMs - a.releaseMs || a.rank - b.rank)
    .slice(0, limit);
}

/** The comparison a release invites: what it replaces → the release itself. */
export function releaseFor(model: Model, models: Model[], metric: MetricConfig): Release | null {
  const all = familiesOf(models, metric);
  const family = all.find((f) => f.key === `${model.creator}|${familyOf(model)}`);
  return family ? toRelease(family, all, metric) : null;
}

/** The variant a specific model would be upgrading from, if its line has one. */
export function predecessorOf(model: Model, models: Model[], metric: MetricConfig): Model | null {
  const all = familiesOf(models, metric);
  const family = all.find((f) => f.key === `${model.creator}|${familyOf(model)}`);
  if (!family) return null;
  const pred = predecessorFamily(family, all);
  return pred ? matchVariant(model, pred.models) : null;
}

export type FocusScope = "release" | "lineup";

/**
 * The wider lineup a release belongs to: the family name minus its last word.
 * "GPT-6 Sol" → "GPT-6" (Sol, Astra, Luna); "Claude Opus 5.5" → "Claude Opus";
 * "Grok 4.7" → "Grok". A one-word family has no lineup.
 */
export function lineupOf(family: string): string | null {
  const words = family.trim().split(/\s+/);
  return words.length >= 2 ? words.slice(0, -1).join(" ") : null;
}

export interface Focus {
  release: Release;
  scope: FocusScope;
  /** What the focus line is drawn through. */
  models: Model[];
  label: string;
  /** The release it replaces, drawn dashed for contrast (release scope only). */
  ghost: Model[];
  ghostLabel: string | null;
  /** Label for the wider lineup, when there is one. */
  lineupLabel: string | null;
}

/** Everything the map needs to spotlight one release, or its whole lineup. */
export function focusFor(
  key: string,
  scope: FocusScope,
  models: Model[],
  metric: MetricConfig,
): Focus | null {
  const [creator] = key.split("|");
  const member = models.find((m) => `${m.creator}|${familyOf(m)}` === key);
  if (!member) return null;
  const release = releaseFor(member, models, metric);
  if (!release) return null;
  const scored = models.filter((m) => isPositiveFinite(metric.value(m)) && m.creator === creator);
  const prefix = lineupOf(release.family);
  const lineupLabel = prefix ? `All ${prefix}` : null;
  const inLineup = (m: Model) => {
    const f = familyOf(m);
    return prefix != null && (f === prefix || f.startsWith(`${prefix} `));
  };
  const lineup = scope === "lineup" && prefix != null;
  const members = lineup ? scored.filter(inLineup) : scored.filter((m) => familyOf(m) === release.family);
  const ghost =
    !lineup && release.predecessorLabel
      ? scored.filter((m) => familyOf(m) === release.predecessorLabel)
      : [];
  return {
    release,
    scope: lineup ? "lineup" : "release",
    models: members,
    label: lineup ? lineupLabel! : release.family,
    ghost,
    ghostLabel: ghost.length ? release.predecessorLabel : null,
    lineupLabel,
  };
}
