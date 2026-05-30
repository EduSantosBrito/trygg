/**
 * Class name composition for trygg.
 *
 * @remarks
 * Owner module for the `cx` topic. Use this helper to compose static and signal-backed
 * class names without manually subscribing to signal inputs. The root `trygg`
 * entrypoint publishes this topic as `cx`, `ClassInput`, and `ClassValue`.
 *
 * @since 1.0.0
 * @module trygg/primitives/cx
 */
import { Effect, Scope } from "effect";
import * as Signal from "./signal.js";

/**
 * Class name input type - basic values
 *
 * @remarks
 * Matches the static shapes accepted by `cx`: strings, falsy sentinels, and object maps.
 *
 * @example
 * ```ts
 * const value: ClassValue = { active: true, disabled: false }
 * ```
 *
 * @category Class Composition
 * @public
 * @since 1.0.0
 */
export type ClassValue = string | boolean | null | undefined | Record<string, boolean | undefined>;

/**
 * Class name input that can include Signals for reactive class names
 *
 * @remarks
 * `cx` upgrades to a reactive `Signal<string>` when any input is a signal.
 *
 * @example
 * ```ts
 * const input: ClassInput = variantSignal
 * ```
 *
 * @category Class Composition
 * @public
 * @since 1.0.0
 */
export type ClassInput =
  | ClassValue
  | Signal.Signal<string>
  | Signal.Signal<boolean>
  | Signal.Signal<string | boolean | null | undefined>;

/**
 * Compute class string from inputs, resolving Signal values from a provided map.
 * @internal
 */
const computeClasses = (
  inputs: ReadonlyArray<ClassInput>,
  signalValues: ReadonlyMap<Signal.Signal<unknown>, unknown>,
): Effect.Effect<string> =>
  Effect.sync(() => {
    const classes: Array<string> = [];

    for (const input of inputs) {
      if (!input) continue;

      if (Signal.isSignal(input)) {
        const value = signalValues.get(input);
        if (value && typeof value === "string") {
          classes.push(value);
        }
        continue;
      }

      if (typeof input === "string") {
        classes.push(input);
        continue;
      }

      if (typeof input === "object") {
        for (const [key, value] of Object.entries(input)) {
          if (value) {
            classes.push(key);
          }
        }
      }
    }

    return classes.join(" ");
  });

/**
 * Compute class string from inputs, reading Signal values directly.
 * Uses SubscriptionRef.get to avoid triggering component-level re-renders.
 * @internal
 */
const computeClassesEffect = Effect.fn("computeClassesEffect")(function* (
  inputs: ReadonlyArray<ClassInput>,
) {
  const signalValues = new Map<Signal.Signal<unknown>, unknown>();

  for (const input of inputs) {
    if (Signal.isSignal(input)) {
      const value = yield* Signal.peek(input);
      signalValues.set(input, value);
    }
  }

  return yield* computeClasses(inputs, signalValues);
});

/**
 * Combine class names, filtering out falsy values.
 *
 * Supports both static values and Signals for reactive class names.
 * When Signals are present, returns a reactive Signal<string> that updates
 * automatically when any input Signal changes. The renderer resolves this
 * internally - no yield* needed at the call site.
 *
 * @remarks
 * Use `cx` in `className` props when you want the same helper to work for static
 * and reactive styling.
 *
 * @example
 * ```tsx
 * // Static class names — returns plain string
 * <div className={cx("flex gap-2", isActive && "bg-blue-500")} />
 *
 * // Object notation for conditional classes
 * <div className={cx("nav", { active: isActive, disabled: isDisabled })} />
 *
 * // Reactive class names with Signals — returns Signal<string>
 * const variant = yield* Signal.make("primary")
 * <button className={cx("btn", variant)} />
 * // className updates reactively when variant changes
 * ```
 *
 * @category Class Composition
 * @public
 * @since 1.0.0
 */
export const cx: (
  ...inputs: ReadonlyArray<ClassInput>
) => Effect.Effect<string | Signal.Signal<string>, Signal.SignalScopeError, Scope.Scope> =
  Effect.fn("cx")(function* (...inputs: ReadonlyArray<ClassInput>) {
    // Collect Signal inputs
    const signals: Array<Signal.Signal<unknown>> = [];
    for (const input of inputs) {
      if (Signal.isSignal(input)) {
        signals.push(input);
      }
    }

    // No signals — compute and return plain string
    if (signals.length === 0) {
      const signalValues = new Map<Signal.Signal<unknown>, unknown>();
      return yield* computeClasses(inputs, signalValues);
    }

    // Has signals — create reactive output Signal
    const renderScope = yield* Signal.CurrentRenderScope;
    const scope = renderScope ?? (yield* Effect.scope);

    const initial = yield* computeClassesEffect(inputs);
    const output: Signal.Signal<string> = yield* Signal.make(initial);

    // Subscribe to each signal — recompute on change
    const unsubscribes: Array<Effect.Effect<void>> = [];
    for (const sig of signals) {
      const unsubscribe = yield* Signal.subscribe(sig, () =>
        Effect.gen(function* () {
          const newValue = yield* computeClassesEffect(inputs);
          yield* Signal.set(output, newValue);
        }),
      );
      unsubscribes.push(unsubscribe);
    }

    // Register cleanup
    yield* Scope.addFinalizer(
      scope,
      Effect.gen(function* () {
        for (const unsub of unsubscribes) {
          yield* unsub;
        }
      }),
    );

    return output;
  });
