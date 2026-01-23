/**
 * @since 1.0.0
 * Head management for effect-ui
 *
 * Provides head element hoisting (title, meta, link, style, script, base)
 * from component JSX into document.head with stack-based deduplication.
 *
 * @example
 * ```tsx
 * const AboutPage = Component.gen(function* () {
 *   return <>
 *     <title>About Us</title>
 *     <meta name="description" content="Learn about our team" />
 *     <div className="about">Content</div>
 *   </>
 * })
 * ```
 *
 * Head elements are hoisted to document.head on mount and removed on unmount.
 * Keyed elements (title, meta, base) use stack-based dedup — deepest component
 * wins, previous value restores on unmount.
 */
import { Context, Data, Effect, FiberRef, Option, Ref, Scope } from "effect";

// =============================================================================
// Constants
// =============================================================================

/**
 * Tags that are hoisted to document.head by default.
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
 * Defaults to following RenderStrategy:
 * - RenderStrategy.SSR → HeadStrategy.Server
 * - RenderStrategy.Lazy/Eager → HeadStrategy.Client
 *
 * Can be explicitly overridden per-route.
 * @since 1.0.0
 */
export class HeadStrategy extends Context.Tag("effect-ui/HeadStrategy")<
  HeadStrategy,
  HeadStrategyService
>() {
  /**
   * Head computed server-side (in initial HTML).
   * SEO-optimal — crawlers see head content immediately.
   */
  static readonly Server: HeadStrategyService = { _tag: "HeadStrategy", isServer: true };

  /**
   * Head computed client-side (after JS loads).
   * For personalization, A/B testing, device-specific tags.
   */
  static readonly Client: HeadStrategyService = { _tag: "HeadStrategy", isServer: false };
}

/**
 * HeadStrategy service interface.
 * @since 1.0.0
 */
export interface HeadStrategyService {
  readonly _tag: "HeadStrategy";
  readonly isServer: boolean;
}

// =============================================================================
// Head Entry — Represents a mounted head element
// =============================================================================

/**
 * A head element entry tracked by the Head service.
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
 * @since 1.0.0
 */
export const deriveKey = (
  tag: string,
  props: Record<string, unknown>,
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
        if ("charset" in props) return Option.some("meta:charset");
        return Option.none();
      }
      default:
        return Option.none();
    }
  });

// =============================================================================
// Head Service
// =============================================================================

/**
 * Head service error — mounting failed.
 * @since 1.0.0
 */
export class HeadMountError extends Data.TaggedError("HeadMountError")<{
  readonly tagName: string;
  readonly key: Option.Option<string>;
  readonly cause: unknown;
}> {}

/**
 * Head service interface.
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
 * Head service tag.
 * Provided implicitly by `mount` (browser) or `renderToString` (SSR).
 * Components never provide this manually.
 * @since 1.0.0
 */
export class Head extends Context.Tag("effect-ui/Head")<Head, HeadService>() {}

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
 * @since 1.0.0
 */
export const makeBrowserHead = (): Effect.Effect<HeadService, never, Scope.Scope> =>
  Effect.gen(function* () {
    const stacks: DedupStacks = new Map();
    const entriesRef = yield* Ref.make<ReadonlyArray<HeadEntry>>([]);

    const mount: HeadService["mount"] = (tagName, node, key) =>
      Effect.gen(function* () {
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
      });

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
 * @since 1.0.0
 */
export const makeTestHead = (): Effect.Effect<HeadService, never, Scope.Scope> =>
  Effect.gen(function* () {
    const entriesRef = yield* Ref.make<ReadonlyArray<HeadEntry>>([]);

    const mount: HeadService["mount"] = (tagName, node, key) =>
      Effect.gen(function* () {
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
 * @since 1.0.0
 */
export const CurrentHead: FiberRef.FiberRef<HeadService | null> =
  FiberRef.unsafeMake<HeadService | null>(null);

/**
 * FiberRef to gate document-level element mapping.
 * When true, `<html>`, `<head>`, `<body>` map to existing DOM nodes
 * instead of creating new elements.
 * Set by `mountDocument()` — not by regular `mount()`.
 * @since 1.0.0
 */
export const IsDocumentMount: FiberRef.FiberRef<boolean> = FiberRef.unsafeMake<boolean>(false);

/**
 * Tags that map to existing document nodes in document-mount mode.
 * @since 1.0.0
 */
export const DOCUMENT_TAGS: ReadonlySet<string> = new Set(["html", "head", "body"]);

// =============================================================================
// Layers
// =============================================================================

/**
 * Browser Head layer — mounts elements to document.head.
 * @since 1.0.0
 */
export const browserHeadLayer: Effect.Effect<HeadService, never, Scope.Scope> = makeBrowserHead();

/**
 * Test Head layer — collects entries in-memory.
 * @since 1.0.0
 */
export const testHeadLayer: Effect.Effect<HeadService, never, Scope.Scope> = makeTestHead();
