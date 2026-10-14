import { CLOSED_COLOR, Model, MetricConfig, OPEN_COLOR, fmtMoney, fmtMultiple, fmtSecondsShort, shortName } from "./model";
import type { OpenVsClosed } from "./openVsClosed";
import { Readout, type ReadoutRow } from "./ProgressPanel";

const months = (n: number) => {
  const r = Math.round(n);
  return r < 1 ? "less than a month" : r === 1 ? "1 month" : `${r} months`;
};
const monthYear = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });

/**
 * Where open-weight models stand against closed ones: how far behind the best
 * they are in time and in points, and what you trade at the level they reach.
 */
export function OpenClosedPanel({
  data,
  metric,
  onPreview,
  onCompare,
}: {
  data: OpenVsClosed;
  metric: MetricConfig;
  onPreview: (pair: [Model, Model] | null) => void;
  onCompare: (pair: [Model, Model]) => void;
}) {
  const { bestOpen, bestClosed, caughtUp, lagMonths, lagYearAgo, cost, speed } = data;
  const smarts = metric.noun === "intelligence" ? "smarts" : "score";
  const rows: ReadoutRow[] = [];

  if (caughtUp && lagMonths != null) {
    const trend =
      lagYearAgo == null || Math.round(lagYearAgo) === Math.round(lagMonths)
        ? ""
        : ` A year ago the gap was ${months(lagYearAgo)}.`;
    rows.push({
      key: "lag",
      head:
        lagMonths < 0.5 ? (
          <>Open models have <strong>caught up</strong></>
        ) : (
          <>
            Open models are <strong>{months(lagMonths)}</strong> behind
          </>
        ),
      detail: `${shortName(bestOpen)} matches ${shortName(caughtUp)}, released ${monthYear(caughtUp.releaseMs!)}.${trend}`,
      pair: [caughtUp, bestOpen],
    });
  }

  if (data.points > 0.05) {
    rows.push({
      key: "points",
      head: (
        <>
          Closed still leads by <strong>{data.points.toFixed(1)} points</strong>
        </>
      ),
      detail: `${shortName(bestClosed)} scores ${metric.value(bestClosed)!.toFixed(1)}; the best open model, ${shortName(bestOpen)}, ${metric.value(bestOpen)!.toFixed(1)}.`,
      pair: [bestClosed, bestOpen],
    });
  }

  if (cost) {
    const cheaper = cost.ratio >= 1;
    rows.push({
      key: "cost",
      head:
        Math.abs(Math.log(cost.ratio)) < 0.1 ? (
          <>For the same {smarts}, open costs <strong>about the same</strong></>
        ) : (
          <>
            For the same {smarts}, open is{" "}
            <strong>{cheaper ? `${fmtMultiple(cost.ratio)} cheaper` : `${fmtMultiple(1 / cost.ratio)} pricier`}</strong>
          </>
        ),
      detail: `${shortName(cost.open)} costs ${fmtMoney(cost.open.costPerTask!)} a task; the cheapest closed model as good, ${shortName(cost.closed)}, costs ${fmtMoney(cost.closed.costPerTask!)}.`,
      pair: [cost.closed, cost.open],
    });
  }

  if (speed) {
    const faster = speed.ratio >= 1;
    const joiner = cost && cost.ratio >= 1 !== faster ? "but" : "and";
    rows.push({
      key: "speed",
      head:
        Math.abs(Math.log(speed.ratio)) < 0.1 ? (
          <>{cost ? `${joiner[0].toUpperCase()}${joiner.slice(1)} about as fast` : "About as fast"}</>
        ) : (
          <>
            {cost ? `${joiner[0].toUpperCase()}${joiner.slice(1)} ` : ""}
            <strong>{faster ? `${fmtMultiple(speed.ratio)} faster` : `${fmtMultiple(1 / speed.ratio)} slower`}</strong>
          </>
        ),
      detail: `${shortName(speed.open)} answers in ${fmtSecondsShort(speed.open.e2eLatency!)}; ${shortName(speed.closed)} in ${fmtSecondsShort(speed.closed.e2eLatency!)}.`,
      pair: [speed.closed, speed.open],
    });
  }

  return (
    <Readout
      label="Open versus closed models"
      title="Where open models stand"
      rows={rows}
      onPreview={onPreview}
      onCompare={onCompare}
      controls={
        <span className="flex items-center gap-3 text-[11px] text-ink-700">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: OPEN_COLOR }} aria-hidden />
            Open
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: CLOSED_COLOR }} aria-hidden />
            Closed
          </span>
        </span>
      }
    />
  );
}
