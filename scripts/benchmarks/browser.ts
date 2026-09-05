import { Deferred, Effect, Exit, Fiber, Layer, Scope } from "effect";
import * as References from "effect/References";
import { Component, Element, Signal, intrinsic, mount } from "../../packages/core/dist/index.js";
import { jsx } from "../../packages/core/dist/jsx-runtime.js";
import * as Profiling from "./profiling.js";

declare const __TRYGG_BENCHMARK_GRANULAR__: boolean;
declare const __TRYGG_BENCHMARK_OTLP__: string;

interface Row {
  readonly id: number;
  readonly label: string;
}

export interface Measurement {
  readonly operation: string;
  readonly handlerMs: number;
  readonly frameMs: number;
  readonly rows: number;
}

declare global {
  interface Window {
    tryggBenchmark: {
      readonly run: (operation: string) => Promise<Measurement>;
      readonly mountCycle: () => ReturnType<typeof import("./mounts.js").runCycle>;
      readonly profile?: Effect.Success<typeof Profiling.controls>;
    };
  }
}

let nextId = 1;
const rows = (count: number): ReadonlyArray<Row> =>
  Array.from({ length: count }, () => {
    const id = nextId++;
    return { id, label: `pretty blue table ${id}` };
  });

const verify = (operation: string, before: ReadonlyArray<HTMLTableRowElement>): number => {
  const after = Array.from(document.querySelectorAll<HTMLTableRowElement>("tbody tr"));
  const require = (condition: boolean, message: string): void => {
    if (!condition) throw new Error(`${operation}: ${message}`);
  };
  if (operation === "update" || operation === "select") {
    require(after.length === before.length &&
      after.every((row, index) => row === before[index]), "row identity changed");
  }
  if (operation === "update") {
    require(after.every(
      (row, index) => (row.cells[1]?.textContent?.endsWith(" !!!") ?? false) === (index % 10 === 0),
    ), "incorrect updated labels");
  }
  if (operation === "select") {
    require(after[1]?.className === "danger" &&
      after.filter((row) => row.className === "danger").length === 1, "incorrect selection");
  }
  if (operation === "swap") {
    require(after.length === before.length &&
      after.every(
        (row, index) =>
          row === before[index === 1 ? before.length - 2 : index === before.length - 2 ? 1 : index],
      ), "incorrect keyed reorder");
  }
  if (operation === "remove") {
    require(after.length === before.length - 1 &&
      after.every(
        (row, index) => row === before[index < 1 ? index : index + 1],
      ), "removal recreated surviving rows");
  }
  if (operation === "append1k") {
    require(before.every((row, index) => row === after[index]), "append recreated existing rows");
  }
  if (operation === "replace1k") {
    const old = new Set(before);
    require(after.every((row) => !old.has(row)), "replacement retained old keyed rows");
  }
  return after.length;
};

const App = Component.gen(function* () {
  const items = yield* Signal.make<ReadonlyArray<Row>>([]);
  const selected = yield* Signal.make(0);
  const isSelected = yield* Signal.selector(selected);
  const rowLabels = new Map<number, Signal.Signal<string>>();
  const rowWorkers = new Map<number, Deferred.Deferred<Fiber.Fiber<unknown, unknown>>>();
  let complete: ((handlerEnd: number) => void) | undefined;

  const operations: Readonly<Record<string, Effect.Effect<void, unknown>>> = {
    create1k: Signal.set(items, []).pipe(
      Effect.andThen(Effect.suspend(() => Signal.set(items, rows(1_000)))),
    ),
    replace1k: Effect.suspend(() => Signal.set(items, rows(1_000))),
    create10k: Effect.suspend(() => Signal.set(items, rows(10_000))),
    append1k: Signal.update(items, (current) => [...current, ...rows(1_000)]),
    update: __TRYGG_BENCHMARK_GRANULAR__ ? Effect.gen(function* () {
      const current = yield* Signal.peek(items);
      for (let index = 0; index < current.length; index += 10) {
        const row = current[index];
        if (row === undefined) continue;
        const label = rowLabels.get(row.id);
        if (label === undefined) throw new Error(`Missing row Signal ${row.id}`);
        const entered = yield* Deferred.make<Fiber.Fiber<unknown, unknown>>();
        rowWorkers.set(row.id, entered);
        yield* Signal.update(label, (value) => `${value} !!!`);
        const exit = yield* Fiber.await(yield* Deferred.await(entered));
        rowWorkers.delete(row.id);
        if (Exit.isFailure(exit)) return yield* Effect.failCause(exit.cause);
      }
    }) : Signal.update(items, (current) =>
      current.map((row, index) => (index % 10 === 0 ? { ...row, label: `${row.label} !!!` } : row)),
    ),
    swap: Signal.update(items, (current) => {
      const second = current[1];
      const beforeLast = current[current.length - 2];
      if (second === undefined || beforeLast === undefined) return current;
      const next = current.slice();
      next[1] = beforeLast;
      next[next.length - 2] = second;
      return next;
    }),
    select: Effect.gen(function* () {
      const current = yield* Signal.peek(items);
      yield* Signal.set(selected, current[1]?.id ?? 0);
    }),
    remove: Signal.update(items, (current) => current.filter((_, index) => index !== 1)),
    clear: Signal.set(items, []),
  };

  window.tryggBenchmark = {
    ...(__TRYGG_BENCHMARK_OTLP__ === "off" ? {} : { profile: yield* Profiling.controls }),
    mountCycle: () => import("./mounts.js").then((probe) => probe.runCycle()),
    run: (operation) =>
      new Promise((resolve, reject) => {
        const button = document.getElementById(operation);
        if (button === null) {
          reject(new Error(`Unknown benchmark operation: ${operation}`));
          return;
        }
        const before = Array.from(document.querySelectorAll<HTMLTableRowElement>("tbody tr"));
        const timeout = window.setTimeout(() => {
          complete = undefined;
          reject(new Error(`${operation}: handler did not settle within 30 seconds`));
        }, 30_000);
        const start = performance.now();
        complete = (handlerEnd) =>
          requestAnimationFrame(() =>
            setTimeout(() => {
              const frameMs = performance.now() - start;
              clearTimeout(timeout);
              complete = undefined;
              try {
                resolve({
                  operation,
                  handlerMs: handlerEnd - start,
                  frameMs,
                  rows: verify(operation, before),
                });
              } catch (error) {
                reject(error);
              }
            }, 0),
          );
        button.click();
      }),
  };

  const buttons = Object.entries(operations).map(([id, operation]) =>
    intrinsic(
      "button",
      {
        id,
        onClick: () =>
          operation.pipe(Effect.andThen(Effect.sync(() => complete?.(performance.now())))),
      },
      [Element.Text({ content: id })],
    ),
  );

  const table = Signal.each(
    items,
    (row) =>
      Effect.gen(function* () {
        let label = row.label;
        if (__TRYGG_BENCHMARK_GRANULAR__) {
          const rowLabel = yield* Signal.make(row.label);
          if (!rowLabels.has(row.id)) {
            rowLabels.set(row.id, rowLabel);
            yield* Effect.addFinalizer(() => Effect.sync(() => {
              rowLabels.delete(row.id);
              rowWorkers.delete(row.id);
            }));
          }
          label = yield* Signal.get(rowLabel);
          const entered = rowWorkers.get(row.id);
          if (entered !== undefined)
            yield* Effect.withFiber((fiber) => Deferred.succeed(entered, fiber));
        }
        const active = yield* isSelected(row.id);
        const className = yield* Signal.derive(active, (value) => (value ? "danger" : ""));
        const children = [
          intrinsic("td", {}, [Element.Text({ content: String(row.id) })]),
          intrinsic("td", {}, [intrinsic("a", {}, [Element.Text({ content: label })])]),
          intrinsic("td", {}, [intrinsic("a", {}, [Element.Text({ content: "remove" })])]),
          intrinsic("td", {}, []),
        ];
        return __TRYGG_BENCHMARK_GRANULAR__
          ? jsx("tr", { "data-id": Effect.succeed(String(row.id)), className, children })
          : intrinsic("tr", { "data-id": String(row.id), className }, children);
      }),
    { key: (row) => row.id },
  );

  return intrinsic("main", {}, [
    intrinsic("nav", {}, buttons),
    intrinsic("table", {}, [intrinsic("tbody", {}, [table])]),
  ]);
}).pipe(Component.provide(Layer.mergeAll(
  Layer.effect(Scope.Scope, Effect.scope),
  Layer.succeed(References.MinimumLogLevel, "None"),
)));

const root = document.getElementById("root");
if (root !== null) {
  const app = __TRYGG_BENCHMARK_OTLP__ === "off" ? App : App.pipe(Component.provide(Profiling.layer));
  mount(root, Effect.succeed(app({})));
}
