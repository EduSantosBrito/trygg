/**
 * Head hoisting and deduplication management.
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
import { Data, Effect, Option, Ref, Scope } from "effect";
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
 * through the current head manager instead of mounting inline.
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
// Head Entry — Represents a mounted head element
// =============================================================================

/**
 * A head element entry tracked by the head manager.
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
 * the built-in head manager.
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

const stripHeadMode = (props: ElementProps): ElementProps => {
  const { mode: _mode, ...domProps } = props;
  return domProps;
};

/**
 * Resolve the default Head hoisting policy.
 *
 * @remarks
 * The default policy owns document mount detection, head tag detection, mode
 * handling, key derivation, and dispatch to the active head manager.
 *
 * @internal
 */
export const maybeHoist: (
  tag: string,
  props: ElementProps,
) => Effect.Effect<Option.Option<HoistAction>> = Effect.fnUntraced(function* (tag, props) {
  const domProps = props.mode === undefined ? props : stripHeadMode(props);
  const isDocumentMount = yield* getFiberRef(IsDocumentMount);
  if (isDocumentMount && DOCUMENT_TAGS.has(tag)) {
    return Option.some(HoistAction.document({ props: domProps }));
  }

  const headManager = yield* getFiberRef(CurrentHead);
  if (headManager === null || !HOISTABLE_TAGS.has(tag) || props.mode === "static") {
    return Option.none();
  }

  const key = yield* deriveKey(tag, domProps);
  return Option.some(
    HoistAction.head({
      props: domProps,
      mount: (node) => headManager.mount(tag, node, key),
    }),
  );
});

// =============================================================================
// Head manager
// =============================================================================

/**
 * Head manager interface.
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
 * Create a browser head manager.
 * Mounts elements to document.head with stack-based dedup.
 *
 * @remarks
 * Use this when mounting into a real browser DOM and you need direct access to
 * the service directly.
 *
 * @example
 * ```ts
 * const head = yield* Head.makeBrowser()
 * ```
 *
 * @category Head Management
 * @public
 * @since 1.0.0
 */
export const makeBrowser = Effect.fn("Head.makeBrowser")(function* () {
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
 * Create a test head manager.
 * Collects entries in-memory without touching the DOM.
 * Useful for unit tests.
 *
 * @remarks
 * Prefer this in tests that need to inspect mounted head entries without
 * mutating `document.head`.
 *
 * @example
 * ```ts
 * const head = yield* Head.makeTest()
 * ```
 *
 * @category Head Management
 * @public
 * @since 1.0.0
 */
export const makeTest = Effect.fn("Head.makeTest")(function* () {
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
// FiberRef — Thread the head manager through the render tree
// =============================================================================

/**
 * FiberRef to track the current head manager.
 * Set by `mount()` — read by the renderer's Intrinsic case.
 * When null, hoistable elements render normally (append to parent).
 *
 * @remarks
 * Exported for renderer integration and tests that need to simulate the active
 * head manager explicitly.
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

/**
 * Synchronous guard: `true` only for tags that could ever produce a hoist
 * action (head-hoistable tags, or document-shell tags during a document mount).
 *
 * @remarks
 * For any tag outside `HOISTABLE_TAGS ∪ DOCUMENT_TAGS`, `maybeHoist`
 * provably returns `Option.none()` regardless of fiber-ref state — the
 * `!HOISTABLE_TAGS.has(tag)` branch short-circuits before either ref is read.
 * Renderers use this to skip allocating the hoist closure and running its
 * `Effect.gen` (two fiber-ref reads + option allocation) on every plain element
 * such as `<div>`/`<tr>`/`<td>`, which is the overwhelming common case.
 *
 * @internal
 * @since 1.0.0
 */
export const isHoistCandidate = (tag: string): boolean =>
  HOISTABLE_TAGS.has(tag) || DOCUMENT_TAGS.has(tag);
