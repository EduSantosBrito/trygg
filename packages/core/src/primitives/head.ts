/**
 * Head hoisting and deduplication services.
 *
 * @remarks
 * Owner module for the `Head` topic. Use this module when components should
 * describe document metadata declaratively and let the renderer coordinate
 * hoisting, deduplication, and cleanup.
 *
 * @see ./head.docs.md - Source-owned topic guide
 * @since 1.0.0
 * @module trygg/primitives/head
 */
import { Data, Effect, Option, Ref, Schema, Scope } from "effect";
import * as Context from "effect/Context";
import { getFiberRef, setFiberRef } from "../internal/fiber-ref.js";
import type { ElementProps } from "./element.js";

// =============================================================================
// Constants
// =============================================================================

/**
 * Tags that are hoisted to document.head by default.
 *
 * @remarks
 * The renderer uses this set to decide which intrinsic elements should be sent
 * through the current `Head` service instead of mounting inline.
 *
 * @example
 * ```ts
 * const canHoistTitle = Head.HOISTABLE_TAGS.has("title")
 * ```
 *
 * @category Head Management
 * @public
 * @since 1.0.0
 */
export const HOISTABLE_TAGS: ReadonlySet<string> = new Set([
  "title",
  "meta",
  "link",
  "style",
  "script",
  "base",
]);

/**
 * Check if a tag name is hoistable.
 *
 * @remarks
 * Use this when building tooling or render helpers that need the same hoisting
 * decision the renderer applies internally.
 *
 * @example
 * ```ts
 * const canHoist = yield* Head.isHoistable("meta")
 * ```
 *
 * @category Head Management
 * @public
 * @since 1.0.0
 */
export const isHoistable = (tag: string): Effect.Effect<boolean> =>
  Effect.sync(() => HOISTABLE_TAGS.has(tag));

// =============================================================================
// HeadStrategy — Controls WHERE head computation happens
// =============================================================================

/**
 * HeadStrategy service — determines whether head elements are computed
 * server-side (in initial HTML) or client-side (after JS).
 *
 * @remarks
 * Defaults to following RenderStrategy:
 * - RenderStrategy.SSR → HeadStrategy.Server
 * - RenderStrategy.Lazy/Eager → HeadStrategy.Client
 *
 * Can be explicitly overridden per-route.
 *
 * @example
 * ```ts
 * const strategy = Head.HeadStrategy.Server
 * ```
 *
 * @category Head Management
 * @public
 * @since 1.0.0
 */
export type HeadStrategyService = Data.TaggedEnum<{
  readonly HeadStrategy: { readonly isServer: boolean };
}>;

const HeadStrategyService = Data.taggedEnum<HeadStrategyService>();

/**
 * Service tag for the active head-computation strategy.
 *
 * @remarks
 * Resolve this tag to learn whether head elements are computed server-side (in
 * the initial HTML) or client-side (after JS). It follows {@link RenderStrategy}
 * by default — SSR maps to the server strategy, Lazy/Eager to the client one —
 * and can be overridden per route. Use the `HeadStrategy.Server` /
 * `HeadStrategy.Client` constructors to build a value.
 *
 * @example
 * ```ts
 * const strategy = yield* HeadStrategy
 * if (strategy.isServer) {
 *   // compute the document <head> during SSR
 * }
 * ```
 *
 * @category Head Management
 * @public
 * @since 1.0.0
 */
export class HeadStrategy extends Context.Service<
  HeadStrategy,
  {
    readonly _tag: "HeadStrategy";
    readonly isServer: boolean;
  }
>()("trygg/HeadStrategy") {
  /**
   * Head computed server-side (in initial HTML).
   * SEO-optimal — crawlers see head content immediately.
   */
  static readonly Server: HeadStrategyService = HeadStrategyService.HeadStrategy({
    isServer: true,
  });

  /**
   * Head computed client-side (after JS loads).
   * For personalization, A/B testing, device-specific tags.
   */
  static readonly Client: HeadStrategyService = HeadStrategyService.HeadStrategy({
    isServer: false,
  });
}

/**
 * HeadStrategy service interface.
 *
 * @remarks
 * This is the structural contract yielded by `HeadStrategy` when routes or
 * render code need to inspect whether head work should happen on the server.
 *
 * @example
 * ```ts
 * const strategy: Head.HeadStrategyService = Head.HeadStrategy.Client
 * ```
 *
 * @category Head Management
 * @public
 * @since 1.0.0
 */

// =============================================================================
// Head Entry — Represents a mounted head element
// =============================================================================

/**
 * A head element entry tracked by the Head service.
 *
 * @remarks
 * Browser and test implementations return these entries so tests or SSR code
 * can inspect the currently mounted head state.
 *
 * @example
 * ```ts
 * const entries: ReadonlyArray<Head.HeadEntry> = yield* head.entries
 * ```
 *
 * @category Head Management
 * @public
 * @since 1.0.0
 */
export interface HeadEntry {
  readonly tagName: string;
  readonly node: HTMLElement;
  readonly key: Option.Option<string>;
}

// =============================================================================
// Key Derivation
// =============================================================================

/**
 * Derive a deduplication key from tag name and props.
 *
 * | Tag | Key |
 * |-----|-----|
 * | title | "title" (singleton) |
 * | base | "base" (singleton) |
 * | meta[name] | "meta:name:{name}" |
 * | meta[property] | "meta:property:{property}" |
 * | meta[httpEquiv] | "meta:http-equiv:{value}" |
 * | meta[charset] | "meta:charset" |
 * | link, style, script | None (allow duplicates) |
 *
 * @remarks
 * Use this helper when custom render code needs the same dedup key strategy as
 * the built-in head service.
 *
 * @example
 * ```ts
 * const key = yield* Head.deriveKey("meta", { name: "description" })
 * ```
 *
 * @category Head Management
 * @public
 * @since 1.0.0
 */
export const deriveKey = (
  tag: string,
  props: ElementProps | Record<string, unknown>,
): Effect.Effect<Option.Option<string>> =>
  Effect.sync(() => {
    switch (tag) {
      case "title":
        return Option.some("title");
      case "base":
        return Option.some("base");
      case "meta": {
        const name = props["name"];
        if (typeof name === "string") return Option.some(`meta:name:${name}`);
        const property = props["property"];
        if (typeof property === "string") return Option.some(`meta:property:${property}`);
        const httpEquiv = props["httpEquiv"];
        if (typeof httpEquiv === "string") return Option.some(`meta:http-equiv:${httpEquiv}`);
        if (props["charset"] !== undefined) return Option.some("meta:charset");
        return Option.none();
      }
      default:
        return Option.none();
    }
  });

// =============================================================================
// HeadHoist — Renderer seam
// =============================================================================

/**
 * Renderer action for intrinsic elements whose mount location is owned by Head.
 *
 * @remarks
 * The renderer applies this action without knowing whether a tag is hoistable,
 * which key it uses, or which document node receives it.
 *
 * @internal
 */
export type HoistAction = Data.TaggedEnum<{
  readonly head: {
    readonly props: ElementProps;
    readonly mount: (node: HTMLElement) => Effect.Effect<void, never, Scope.Scope>;
  };
  readonly document: {
    readonly props: ElementProps;
  };
}>;

export const HoistAction = Data.taggedEnum<HoistAction>();

/**
 * Head-owned hoisting seam consumed by the renderer.
 *
 * @remarks
 * Implementations decide whether an intrinsic element needs special mounting and
 * return the action the renderer should apply.
 *
 * @internal
 */
export interface HeadHoist {
  readonly maybeHoist: (
    tag: string,
    props: ElementProps,
  ) => Effect.Effect<Option.Option<HoistAction>>;
}

const stripHeadMode = (props: ElementProps): ElementProps => {
  const { mode: _mode, ...domProps } = props;
  return domProps;
};

/**
 * Build the default Head hoisting policy.
 *
 * @remarks
 * The default policy owns document mount detection, head tag detection, mode
 * handling, key derivation, and dispatch to the active Head service.
 *
 * @internal
 */
export const makeHeadHoist = (): HeadHoist => ({
  maybeHoist: (tag, props) =>
    Effect.gen(function* () {
      const domProps = props.mode === undefined ? props : stripHeadMode(props);
      const isDocumentMount = yield* getFiberRef(IsDocumentMount);
      if (isDocumentMount && DOCUMENT_TAGS.has(tag)) {
        return Option.some(HoistAction.document({ props: domProps }));
      }

      const headService = yield* getFiberRef(CurrentHead);
      if (headService === null || !HOISTABLE_TAGS.has(tag) || props.mode === "static") {
        return Option.none();
      }

      const key = yield* deriveKey(tag, domProps);
      return Option.some(
        HoistAction.head({
          props: domProps,
          mount: (node) => headService.mount(tag, node, key),
        }),
      );
    }),
});

// =============================================================================
// Head Service
// =============================================================================

/**
 * Head service error — mounting failed.
 *
 * @remarks
 * Browser head implementations can raise this when a head node cannot be
 * mounted or reconciled as requested.
 *
 * @example
 * ```ts
 * const error = new Head.HeadMountError({ tagName: "title", key: Option.none(), cause: "boom" })
 * ```
 *
 * @category Head Management
 * @public
 * @since 1.0.0
 */
export class HeadMountError extends Schema.TaggedErrorClass<HeadMountError>()("HeadMountError", {
  tagName: Schema.String,
  key: Schema.Unknown,
  cause: Schema.Unknown,
}) {}

/**
 * Head service interface.
 *
 * @remarks
 * `HeadService` owns the mount and inspection operations used by browser,
 * document, and test renderers.
 *
 * @example
 * ```ts
 * const entries = yield* head.entries
 * ```
 *
 * @category Head Management
 * @public
 * @since 1.0.0
 */
export interface HeadService {
  /**
   * Mount a head element. Handles deduplication for keyed elements.
   * Registers a Scope finalizer for cleanup on unmount.
   *
   * For keyed elements (title, meta, base): pushes onto stack, deepest wins.
   * For unkeyed elements (link, style, script): appends to head.
   */
  readonly mount: (
    tagName: string,
    node: HTMLElement,
    key: Option.Option<string>,
  ) => Effect.Effect<void, never, Scope.Scope>;

  /**
   * Get all currently mounted head entries (for testing/SSR serialization).
   */
  readonly entries: Effect.Effect<ReadonlyArray<HeadEntry>>;
}

/**
 * Head service key.
 * Provided implicitly by `mount` (browser) or `renderToString` (SSR).
 * Components never provide this manually.
 *
 * @remarks
 * This interface describes the typed service identity threaded through Effect
 * context for the current head manager.
 *
 * @example
 * ```ts
 * const service = yield* Head.Head
 * ```
 *
 * @category Head Management
 * @public
 * @since 1.0.0
 */
export interface Head extends Context.Service<
  Head,
  {
    readonly mount: (
      tagName: string,
      node: HTMLElement,
      key: Option.Option<string>,
    ) => Effect.Effect<void, never, Scope.Scope>;
    readonly entries: Effect.Effect<ReadonlyArray<HeadEntry>>;
  }
> {}

/**
 * Service tag for the current head manager.
 *
 * @remarks
 * Yield this tag in Effects when low-level head utilities need direct access to
 * the active `HeadService` implementation.
 *
 * @example
 * ```ts
 * const head = yield* Head.Head
 * ```
 *
 * @category Head Management
 * @public
 * @since 1.0.0
 */
export const Head = Context.Service<
  Head,
  {
    readonly mount: (
      tagName: string,
      node: HTMLElement,
      key: Option.Option<string>,
    ) => Effect.Effect<void, never, Scope.Scope>;
    readonly entries: Effect.Effect<ReadonlyArray<HeadEntry>>;
  }
>("trygg/Head");

// =============================================================================
// Dedup Stack — Stack-based deduplication for keyed head elements
// =============================================================================

/**
 * Internal dedup stack entry.
 * @internal
 */
interface DedupEntry {
  readonly node: HTMLElement;
  hidden: boolean;
}

/**
 * Dedup stack: key → ordered array of entries (last = visible).
 * Mutable because it's DOM-bound state — conceptually part of the browser environment.
 * @internal
 */
type DedupStacks = Map<string, Array<DedupEntry>>;

// =============================================================================
// Browser Head Implementation
// =============================================================================

/**
 * Create a browser Head service implementation.
 * Mounts elements to document.head with stack-based dedup.
 *
 * @remarks
 * Use this when mounting into a real browser DOM and you need direct access to
 * the service instead of the higher-level `browserHeadLayer` effect.
 *
 * @example
 * ```ts
 * const head = yield* Head.makeBrowserHead()
 * ```
 *
 * @category Head Management
 * @public
 * @since 1.0.0
 */
export const makeBrowserHead = Effect.fn("Head.makeBrowserHead")(function* () {
  const stacks: DedupStacks = new Map();
  const entriesRef = yield* Ref.make<ReadonlyArray<HeadEntry>>([]);

  const mount: HeadService["mount"] = Effect.fn("Head.browserMount")(
    function* (tagName, node, key) {
      const entry: HeadEntry = { tagName, node, key };

      if (Option.isSome(key)) {
        // Keyed element — stack-based dedup
        const k = key.value;
        let stack = stacks.get(k);
        if (stack === undefined) {
          stack = [];
          stacks.set(k, stack);
        }

        // Hide previous visible entry (if any)
        const prev = stack.length > 0 ? stack[stack.length - 1] : undefined;
        if (prev !== undefined && !prev.hidden) {
          prev.node.remove();
          prev.hidden = true;
        }

        // Push new entry as visible
        const dedupEntry: DedupEntry = { node, hidden: false };
        stack.push(dedupEntry);
        document.head.appendChild(node);

        // Register cleanup: remove from stack, restore previous
        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            // Remove this entry from stack
            const currentStack = stacks.get(k);
            if (currentStack !== undefined) {
              const idx = currentStack.indexOf(dedupEntry);
              if (idx !== -1) {
                currentStack.splice(idx, 1);
              }

              // Restore previous (now top of stack)
              if (currentStack.length > 0) {
                const restored = currentStack[currentStack.length - 1];
                if (restored !== undefined && restored.hidden) {
                  restored.hidden = false;
                  document.head.appendChild(restored.node);
                }
              } else {
                stacks.delete(k);
              }
            }

            // Remove node from DOM
            node.remove();

            // Remove from entries ref
            yield* Ref.update(entriesRef, (entries) => entries.filter((e) => e.node !== node));
          }),
        );
      } else {
        // Unkeyed element — just append
        document.head.appendChild(node);

        // Register cleanup: just remove
        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            node.remove();
            yield* Ref.update(entriesRef, (entries) => entries.filter((e) => e.node !== node));
          }),
        );
      }

      // Track entry
      yield* Ref.update(entriesRef, (entries) => [...entries, entry]);
    },
  );

  const entries: HeadService["entries"] = Ref.get(entriesRef);

  return { mount, entries };
});

// =============================================================================
// Test Head Implementation
// =============================================================================

/**
 * Create a test Head service implementation.
 * Collects entries in-memory without touching the DOM.
 * Useful for unit tests.
 *
 * @remarks
 * Prefer this in tests that need to inspect mounted head entries without
 * mutating `document.head`.
 *
 * @example
 * ```ts
 * const head = yield* Head.makeTestHead()
 * ```
 *
 * @category Head Management
 * @public
 * @since 1.0.0
 */
export const makeTestHead = Effect.fn("Head.makeTestHead")(function* () {
  const entriesRef = yield* Ref.make<ReadonlyArray<HeadEntry>>([]);

  const mount: HeadService["mount"] = Effect.fn("Head.testMount")(function* (tagName, node, key) {
    const entry: HeadEntry = { tagName, node, key };
    yield* Ref.update(entriesRef, (entries) => [...entries, entry]);

    yield* Effect.addFinalizer(() =>
      Ref.update(entriesRef, (entries) => entries.filter((e) => e.node !== node)),
    );
  });

  const entries: HeadService["entries"] = Ref.get(entriesRef);

  return { mount, entries };
});

// =============================================================================
// FiberRef — Thread Head service through the render tree
// =============================================================================

/**
 * FiberRef to track the current Head service.
 * Set by `mount()` — read by the renderer's Intrinsic case.
 * When null, hoistable elements render normally (append to parent).
 *
 * @remarks
 * Exported for renderer integration and tests that need to simulate the active
 * head service explicitly.
 *
 * @internal
 * @since 1.0.0
 */
export const CurrentHead = Context.Reference<HeadService | null>("trygg/Head/CurrentHead", {
  defaultValue: () => null,
});

/**
 * FiberRef to gate document-level element mapping.
 * When true, `<html>`, `<head>`, `<body>` map to existing DOM nodes
 * instead of creating new elements.
 * Set by `mountDocument()` — not by regular `mount()`.
 *
 * @remarks
 * Exported for renderer internals and tests that need document-mode behavior.
 *
 * @internal
 * @since 1.0.0
 */
export const IsDocumentMount = Context.Reference<boolean>("trygg/Head/IsDocumentMount", {
  defaultValue: () => false,
});

/**
 * Enable document-level mount mapping for the current render fiber.
 *
 * @remarks
 * This keeps the document-mode flag inside Head while allowing document render
 * entrypoints to opt into mapping html, head, and body to existing nodes.
 *
 * @internal
 */
export const enableDocumentMount: Effect.Effect<void> = setFiberRef(IsDocumentMount, true);

/**
 * Tags that map to existing document nodes in document-mount mode.
 *
 * @remarks
 * Renderer internals use this set when reconciling document-level mounts.
 *
 * @internal
 * @since 1.0.0
 */
export const DOCUMENT_TAGS: ReadonlySet<string> = new Set(["html", "head", "body"]);

// =============================================================================
// Layers
// =============================================================================

/**
 * Browser Head layer — mounts elements to document.head.
 *
 * @remarks
 * Use this effect when a parent component or test needs to provide a browser
 * head service explicitly.
 *
 * @example
 * ```ts
 * const layer = Head.browserHeadLayer
 * ```
 *
 * @category Head Management
 * @public
 * @since 1.0.0
 */
export const browserHeadLayer: Effect.Effect<HeadService, never, Scope.Scope> = makeBrowserHead();

/**
 * Test Head layer — collects entries in-memory.
 *
 * @remarks
 * Use this effect in tests that need a head service without mutating the real
 * document head.
 *
 * @example
 * ```ts
 * const layer = Head.testHeadLayer
 * ```
 *
 * @category Head Management
 * @public
 * @since 1.0.0
 */
export const testHeadLayer: Effect.Effect<HeadService, never, Scope.Scope> = makeTestHead();
