import {
  Model,
  MetricConfig,
  familyOf,
  fmtMoney,
  fmtMultiple,
  fmtSecondsShort,
  isPositiveFinite,
  nameParts,
  shortName,
} from "./model";

const DAY_MS = 86_400_000;
const UP = "#17804a";
const DOWN = "#b42318";

/** The gain over the release it replaces, said the way people say it. */
export function verdict(delta: number | null, predecessor: string | null) {
  const v = (lead: string, rest: string, tone: string | null) => ({ lead, rest, tone, text: lead + rest });
  if (delta == null || !predecessor) return v("A brand-new line", "", null);
  if (delta >= 5) return v("Big jump", ` over ${predecessor}`, UP);
  if (delta >= 2) return v("Clear step up", ` from ${predecessor}`, UP);
  if (delta >= 0.5) return v("Small step up", ` from ${predecessor}`, UP);
  if (delta > -0.5) return v("About the same", ` as ${predecessor}`, null);
  return v("Behind", ` ${predecessor}`, DOWN);
}

/**
 * Why a release matters, in one line. A launch can win three ways: it is the
 * smartest yet, or it matches earlier smarts for far less money, or far less
 * waiting. Failing those, it is judged against the version it replaces.
 */
export interface Gist {
  kind: "top" | "cheaper" | "faster" | "step" | "frontier" | "behind" | "unmeasured";
  lead: string;
  rest: string;
  tone: string | null;
  /** The receipts, as one plain sentence. */
  detail: string | null;
}

/** A win on price or speed only counts when it is big enough to notice. */
const NOTABLE = 1.5;

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
  /** The one-line reason it matters, whatever view you're on. */
  gist: Gist;
  /** How it moved against the version it replaces. */
  step: Gist;
  /** Where it stands on each scatter view's trade-off. */
  standing: Record<Axis, Gist>;
}

export type Axis = "cost" | "speed";

/**
 * "GPT-5.6 Sol" and "GPT-6 Sol" are the same line; only the numbers differ.
 * Word order doesn't matter either: "Claude 4.5 Haiku" became "Claude Haiku 5.5".
 */
const lineOf = (family: string) =>
  family
    .toLowerCase()
    .replace(/\d+(?:\.\d+)*/g, "#")
    .split(/\s+/)
    .sort()
    .join(" ");

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

/**
 * The best "same smarts for less" this release offers: for each of its
 * settings, the earlier model at least as smart that did it cheapest (or
 * fastest), and how many times better this one is.
 */
function bestWin(f: Family, all: Family[], metric: MetricConfig, value: (m: Model) => number | null) {
  const earlier = all
    .filter((o) => o.key !== f.key && o.releaseMs < f.releaseMs)
    .flatMap((o) => o.models)
    .filter((m) => isPositiveFinite(value(m)));
  let win: { model: Model; rival: Model; ratio: number } | null = null;
  for (const model of f.models) {
    const mine = value(model);
    if (!isPositiveFinite(mine)) continue;
    const rival = earlier
      .filter((m) => metric.value(m)! >= metric.value(model)!)
      .reduce<Model | null>((best, m) => (!best || value(m)! < value(best)! ? m : best), null);
    if (!rival) continue;
    const ratio = value(rival)! / mine;
    if (!win || ratio > win.ratio) win = { model, rival, ratio };
  }
  return win;
}

const AXES: Record<
  Axis,
  { value: (m: Model) => number | null; win: "cheaper" | "faster"; worse: string; noun: string; fmt: (v: number) => string }
> = {
  cost: { value: (m) => m.costPerTask, win: "cheaper", worse: "pricier", noun: "cost", fmt: fmtMoney },
  speed: { value: (m) => m.e2eLatency, win: "faster", worse: "slower", noun: "speed", fmt: fmtSecondsShort },
};

const possessive = (creator: string) => (creator.endsWith("s") ? `${creator}'` : `${creator}'s`);

/** How it moved against the version it replaces, or for a new line, the lab's best. */
function stepOf(
  f: Family,
  metric: MetricConfig,
  delta: number | null,
  pred: Family | null,
  sameLine: boolean,
): Gist {
  if (pred && delta != null && !sameLine) {
    // A brand-new line (Gemini 4 Argon) has no older version: measure it
    // against everything its lab shipped before, not one arbitrary model.
    const points = `${Math.abs(delta).toFixed(1)} points ${delta >= 0 ? "above" : "below"} ${pred.family}, ${possessive(f.creator)} previous best.`;
    return delta >= 0.5
      ? { kind: "step", lead: `${possessive(f.creator)} smartest yet`, rest: "", tone: UP, detail: points }
      : { kind: "step", lead: "A new line", rest: ` from ${f.creator}`, tone: null, detail: points };
  }
  const v = verdict(delta, pred?.family ?? null);
  return {
    kind: "step",
    lead: v.lead,
    rest: v.rest,
    tone: v.tone,
    detail:
      delta != null && pred && Math.abs(delta) >= 0.05
        ? `${Math.abs(delta).toFixed(1)} points ${delta > 0 ? "above" : "below"} ${pred.family} on ${metric.noun}.`
        : null,
  };
}

/**
 * Where a release stands on one trade-off. Best case it beats everything that
 * came before it as smart by a wide margin; otherwise it sits on today's
 * frontier, just behind it, or some multiple off the best at its level.
 */
function standingOf(f: Family, all: Family[], metric: MetricConfig, axis: Axis): Gist {
  const { value, win, worse, noun, fmt } = AXES[axis];
  const measured = f.models.filter((m) => isPositiveFinite(value(m)));
  if (!measured.length) {
    return { kind: "unmeasured", lead: `${noun[0].toUpperCase()}${noun.slice(1)} not measured yet`, rest: "", tone: null, detail: null };
  }
  const wins = bestWin(f, all, metric, value);
  const smart = metric.noun === "intelligence" ? " than anything as smart" : " than anything as good";
  if (wins && wins.ratio >= NOTABLE) {
    const [you, them] = [fmt(value(wins.model)!), fmt(value(wins.rival)!)];
    return {
      kind: win,
      lead: `${fmtMultiple(wins.ratio)} ${win}`,
      rest: smart,
      tone: UP,
      detail:
        axis === "cost"
          ? `${shortName(wins.model)} matches ${shortName(wins.rival)} for ${you} a task instead of ${them}.`
          : `${shortName(wins.model)} matches ${shortName(wins.rival)} in ${you} instead of ${them}.`,
    };
  }
  // Against everything on the map today, not just what came before.
  const others = all
    .filter((o) => o.key !== f.key)
    .flatMap((o) => o.models)
    .filter((m) => isPositiveFinite(value(m)));
  let closest: { model: Model; rival: Model | null; gap: number } | null = null;
  for (const model of measured) {
    const rival = others
      .filter((m) => metric.value(m)! >= metric.value(model)!)
      .reduce<Model | null>((best, m) => (!best || value(m)! < value(best)! ? m : best), null);
    const gap = rival ? value(model)! / value(rival)! : 0;
    if (!closest || gap < closest.gap) closest = { model, rival, gap };
  }
  const { model, rival, gap } = closest!;
  const frontier = `${noun} frontier`;
  if (!rival || gap <= 1) {
    return { kind: "frontier", lead: "On the", rest: ` ${frontier}`, tone: UP, detail: `Nothing as smart as ${shortName(model)} is ${win}.` };
  }
  const detail = `${shortName(rival)} is as smart as ${shortName(model)} at ${fmt(value(rival)!)}${axis === "cost" ? " a task" : ""} instead of ${fmt(value(model)!)}.`;
  // Compare as displayed, so a "1.5×" gap never reads as more than "just behind".
  return Number(gap.toFixed(1)) <= NOTABLE
    ? { kind: "behind", lead: "Just behind", rest: ` the ${frontier}`, tone: null, detail }
    : { kind: "behind", lead: `${fmtMultiple(gap)} ${worse}`, rest: " than the best at its level", tone: null, detail };
}

function gistOf(f: Family, all: Family[], metric: MetricConfig, rank: number, step: Gist, standing: Record<Axis, Gist>): Gist {
  if (rank === 1) {
    const runnerUp = all
      .filter((o) => o.key !== f.key)
      .reduce<Family | null>((best, o) => (!best || o.best > best.best ? o : best), null);
    return {
      kind: "top",
      lead: metric.noun === "intelligence" ? "The smartest model yet" : `The best at ${metric.noun.replace(/ score$/, "")} yet`,
      rest: "",
      tone: UP,
      detail: runnerUp
        ? `It scores ${(f.best - runnerUp.best).toFixed(1)} points above ${shortName(runnerUp.models[0])}, the next best.`
        : null,
    };
  }
  // A big win on price or speed is the headline even on the other views:
  // MiMo-V2.6-Pro matters for its price, wherever you're looking.
  const wins = [standing.cost, standing.speed].filter((g) => g.kind === "cheaper" || g.kind === "faster");
  const ratio = (g: Gist) => parseFloat(g.lead);
  return wins.sort((a, b) => ratio(b) - ratio(a))[0] ?? step;
}

function toRelease(f: Family, all: Family[], metric: MetricConfig): Release {
  const flagship = f.models[0];
  const pred = predecessorFamily(f, all);
  const predecessor = pred ? matchVariant(flagship, pred.models) : null;
  const rank = 1 + all.filter((other) => other.best > f.best).length;
  const delta = predecessor ? metric.value(flagship)! - metric.value(predecessor)! : null;
  const sameLine = pred != null && lineOf(pred.family) === lineOf(f.family);
  const step = stepOf(f, metric, delta, pred, sameLine);
  const standing = { cost: standingOf(f, all, metric, "cost"), speed: standingOf(f, all, metric, "speed") };
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
    delta,
    gist: gistOf(f, all, metric, rank, step, standing),
    step,
    standing,
  };
}

/**
 * The second line under a release: what it means on the view you're looking
 * at. On Cost it's where it sits on the price trade-off, on Speed the wait
 * trade-off, unless that's already the headline, in which case it says how it
 * moved against the version it replaces. On Timeline it's its overall rank.
 */
export function viewLine(release: Release, view: Axis | "timeline"): Gist | null {
  if (view === "timeline") {
    if (release.gist.kind === "top") return release.step;
    return { kind: "step", lead: `#${release.rank}`, rest: " overall", tone: null, detail: null };
  }
  const line = release.standing[view];
  return line.kind === release.gist.kind ? (release.gist.kind === "step" ? null : release.step) : line;
}

/**
 * The launches worth a look: recent, and good enough to matter. A 0.9B research
 * model released yesterday shouldn't push GPT-6 off the front page. A release
 * that isn't top-20 smart still earns a spot if it is much cheaper or faster
 * than anything as smart (MiMo-V2.6-Flash), as long as it isn't a toy.
 */
export function recentReleases(
  models: Model[],
  metric: MetricConfig,
  { windowDays = 30, limit = 3, maxRank = 20, maxValueRank = 40 } = {},
): Release[] {
  const all = familiesOf(models, metric);
  if (!all.length) return [];
  const newest = Math.max(...all.map((f) => f.releaseMs));
  return all
    .filter((f) => f.releaseMs >= newest - windowDays * DAY_MS)
    .map((f) => toRelease(f, all, metric))
    .filter(
      (r) =>
        r.rank <= maxRank ||
        ((r.gist.kind === "cheaper" || r.gist.kind === "faster") && r.rank <= maxValueRank),
    )
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
