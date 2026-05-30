/**
 * Trace analyzers — higher-level ordering findings over a flight-recorder
 * buffer.
 *
 * @remarks
 * Normal tests assert *what* happened; analyzers explain *why a sequence is
 * wrong*. Each analyzer is a pure scan over the ordered records that encodes one
 * documented ordering invariant from the catalog families. They return findings
 * rather than throwing, so a report can list every violation at once.
 *
 * @internal
 */
import type { TraceEventName } from "./catalog.js";
import type { TraceRecord } from "./trace.js";

export interface Finding {
  /** Stable identifier for the violated invariant. */
  readonly rule: string;
  /** Human/LLM-readable explanation. */
  readonly message: string;
  /** Index into the analyzed record array where the violation was observed. */
  readonly index: number;
}

export interface Analyzer {
  readonly rule: string;
  readonly description: string;
  readonly run: (records: ReadonlyArray<TraceRecord>) => ReadonlyArray<Finding>;
}

const names = (records: ReadonlyArray<TraceRecord>): ReadonlyArray<TraceEventName> =>
  records.map((record) => record.name);

/**
 * A committed navigation must publish the new Current route first. A
 * `router.navigate.commit` with no preceding `router.current.set` in the same
 * request means RouterService reported completion before its public state was
 * observable.
 */
export const navigateWithoutCurrentSet: Analyzer = {
  rule: "navigate-without-current-set",
  description: "router.navigate.commit must be preceded by router.current.set in the same request.",
  run: (records) => {
    const seq = names(records);
    const findings: Array<Finding> = [];
    for (let i = 0; i < seq.length; i++) {
      if (seq[i] !== "router.navigate.commit") continue;
      let settled = false;
      for (let j = i - 1; j >= 0; j--) {
        if (seq[j] === "router.current.set") {
          settled = true;
          break;
        }
        if (seq[j] === "router.navigate.request") break;
      }
      if (!settled) {
        findings.push({
          rule: "navigate-without-current-set",
          message: `router.navigate.commit at #${i + 1} had no preceding router.current.set in the same request.`,
          index: i,
        });
      }
    }
    return findings;
  },
};

/**
 * No-blank swap: within a single SignalElement swap, the next Element must be
 * rendered (`signalElement.swap.render`) before the swap commits
 * (`signalElement.swap.commit`). A commit with no preceding render since the
 * last `signalElement.swap.start` means the previous DOM may have blanked.
 */
export const swapRenderBeforeCommit: Analyzer = {
  rule: "swap-render-before-commit",
  description: "signalElement.swap.commit must be preceded by signalElement.swap.render.",
  run: (records) => {
    const seq = names(records);
    const findings: Array<Finding> = [];
    let rendered = false;
    let started = false;
    for (let i = 0; i < seq.length; i++) {
      const name = seq[i];
      if (name === "signalElement.swap.start") {
        started = true;
        rendered = false;
      } else if (name === "signalElement.swap.render") {
        rendered = true;
      } else if (name === "signalElement.swap.commit") {
        if (started && !rendered) {
          findings.push({
            rule: "swap-render-before-commit",
            message: `signalElement.swap.commit at #${i + 1} committed without a preceding signalElement.swap.render (possible blank swap).`,
            index: i,
          });
        }
        started = false;
        rendered = false;
      }
    }
    return findings;
  },
};

/**
 * Cleanup of a previous route tree (`route.finalizer.run` / `route.leaf.unmount`)
 * must occur after the replacement `outlet.process.commit` that makes cleanup
 * safe — never before the first commit.
 */
export const cleanupBeforeCommit: Analyzer = {
  rule: "cleanup-before-commit",
  description: "route cleanup must not run before any outlet.process.commit.",
  run: (records) => {
    const seq = names(records);
    const findings: Array<Finding> = [];
    let committed = false;
    for (let i = 0; i < seq.length; i++) {
      const name = seq[i];
      if (name === "outlet.process.commit") {
        committed = true;
      } else if ((name === "route.finalizer.run" || name === "route.leaf.unmount") && !committed) {
        findings.push({
          rule: "cleanup-before-commit",
          message: `${name} at #${i + 1} ran before any outlet.process.commit (cleanup before a safe commit).`,
          index: i,
        });
      }
    }
    return findings;
  },
};

/**
 * Each `outlet.lazyLeaf.load.start` must terminate in exactly one
 * `outlet.lazyLeaf.load.ready` or `outlet.lazyLeaf.load.error`.
 */
export const lazyLeafTerminates: Analyzer = {
  rule: "lazy-leaf-terminates",
  description: "outlet.lazyLeaf.load.start must be followed by ready or error.",
  run: (records) => {
    const seq = names(records);
    const findings: Array<Finding> = [];
    let openIndex = -1;
    for (let i = 0; i < seq.length; i++) {
      const name = seq[i];
      if (name === "outlet.lazyLeaf.load.start") {
        if (openIndex !== -1) {
          findings.push({
            rule: "lazy-leaf-terminates",
            message: `outlet.lazyLeaf.load.start at #${openIndex + 1} did not terminate before a new load started at #${i + 1}.`,
            index: openIndex,
          });
        }
        openIndex = i;
      } else if (name === "outlet.lazyLeaf.load.ready" || name === "outlet.lazyLeaf.load.error") {
        openIndex = -1;
      }
    }
    if (openIndex !== -1) {
      findings.push({
        rule: "lazy-leaf-terminates",
        message: `outlet.lazyLeaf.load.start at #${openIndex + 1} never reached ready or error.`,
        index: openIndex,
      });
    }
    return findings;
  },
};

/** All built-in analyzers. */
export const analyzers: ReadonlyArray<Analyzer> = [
  navigateWithoutCurrentSet,
  swapRenderBeforeCommit,
  cleanupBeforeCommit,
  lazyLeafTerminates,
];

/** Run every analyzer and collect all findings. */
export const analyze = (records: ReadonlyArray<TraceRecord>): ReadonlyArray<Finding> =>
  analyzers.flatMap((analyzer) => analyzer.run(records));
