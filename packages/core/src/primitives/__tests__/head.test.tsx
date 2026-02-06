/**
 * Head Service Unit Tests
 *
 * Tests for head element hoisting, stack-based deduplication,
 * key derivation, and cleanup on scope close.
 *
 * Test Categories:
 * - isHoistable: Tag detection
 * - deriveKey: Key derivation from tag + props
 * - Browser Head: DOM mounting, keyed dedup, cleanup
 * - Test Head: In-memory entry collection
 */
import { assert, describe, it } from "@effect/vitest";
import { Effect, Exit, FiberRef, Option, Scope } from "effect";
import {
  deriveKey,
  HOISTABLE_TAGS,
  IsDocumentMount,
  isHoistable,
  makeBrowserHead,
  makeTestHead,
} from "../head.js";
import { render } from "../../testing/index.js";
import * as Component from "../component.js";
import * as Signal from "../signal.js";

// =============================================================================
// isHoistable — Tag detection
// =============================================================================

describe("isHoistable", () => {
  it.effect("should recognize all hoistable tags", () =>
    Effect.gen(function* () {
      assert.isTrue(yield* isHoistable("title"));
      assert.isTrue(yield* isHoistable("meta"));
      assert.isTrue(yield* isHoistable("link"));
      assert.isTrue(yield* isHoistable("style"));
      assert.isTrue(yield* isHoistable("script"));
      assert.isTrue(yield* isHoistable("base"));
    }),
  );

  it.effect("should reject non-hoistable tags", () =>
    Effect.gen(function* () {
      assert.isFalse(yield* isHoistable("div"));
      assert.isFalse(yield* isHoistable("span"));
      assert.isFalse(yield* isHoistable("p"));
      assert.isFalse(yield* isHoistable("h1"));
      assert.isFalse(yield* isHoistable("a"));
      assert.isFalse(yield* isHoistable("img"));
    }),
  );

  it.effect("should have exactly 6 hoistable tags", () =>
    Effect.gen(function* () {
      assert.strictEqual(HOISTABLE_TAGS.size, 6);
    }),
  );
});

// =============================================================================
// deriveKey — Key derivation from tag + props
// =============================================================================

describe("deriveKey", () => {
  it.effect("should return 'title' for title tag", () =>
    Effect.gen(function* () {
      const key = yield* deriveKey("title", {});
      assert.deepStrictEqual(key, Option.some("title"));
    }),
  );

  it.effect("should return 'base' for base tag", () =>
    Effect.gen(function* () {
      const key = yield* deriveKey("base", { href: "/" });
      assert.deepStrictEqual(key, Option.some("base"));
    }),
  );

  it.effect("should derive key from meta[name]", () =>
    Effect.gen(function* () {
      const key = yield* deriveKey("meta", { name: "description" });
      assert.deepStrictEqual(key, Option.some("meta:name:description"));
    }),
  );

  it.effect("should derive key from meta[property]", () =>
    Effect.gen(function* () {
      const key = yield* deriveKey("meta", { property: "og:title" });
      assert.deepStrictEqual(key, Option.some("meta:property:og:title"));
    }),
  );

  it.effect("should derive key from meta[httpEquiv]", () =>
    Effect.gen(function* () {
      const key = yield* deriveKey("meta", { httpEquiv: "content-type" });
      assert.deepStrictEqual(key, Option.some("meta:http-equiv:content-type"));
    }),
  );

  it.effect("should derive key from meta[charset]", () =>
    Effect.gen(function* () {
      const key = yield* deriveKey("meta", { charset: "UTF-8" });
      assert.deepStrictEqual(key, Option.some("meta:charset"));
    }),
  );

  it.effect("should prefer name over property for meta", () =>
    Effect.gen(function* () {
      const key = yield* deriveKey("meta", { name: "author", property: "og:author" });
      assert.deepStrictEqual(key, Option.some("meta:name:author"));
    }),
  );

  it.effect("should return None for meta without identifying prop", () =>
    Effect.gen(function* () {
      const key = yield* deriveKey("meta", { content: "value" });
      assert.deepStrictEqual(key, Option.none());
    }),
  );

  it.effect("should return None for unkeyed tags", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* deriveKey("link", { rel: "stylesheet" }), Option.none());
      assert.deepStrictEqual(yield* deriveKey("style", {}), Option.none());
      assert.deepStrictEqual(yield* deriveKey("script", { src: "app.js" }), Option.none());
    }),
  );

  it.effect("should return None for non-hoistable tags", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* deriveKey("div", {}), Option.none());
      assert.deepStrictEqual(yield* deriveKey("span", { name: "x" }), Option.none());
    }),
  );
});

// =============================================================================
// Browser Head — DOM mounting, keyed dedup, cleanup
// =============================================================================

describe("Browser Head", () => {
  it.scoped("should mount unkeyed element to document.head", () =>
    Effect.gen(function* () {
      const head = yield* makeBrowserHead();
      const node = document.createElement("link");
      node.setAttribute("rel", "stylesheet");
      node.setAttribute("href", "/style.css");

      const mountScope = yield* Scope.make();
      yield* head.mount("link", node, Option.none()).pipe(Scope.extend(mountScope));

      assert.isTrue(document.head.contains(node));

      yield* Scope.close(mountScope, Exit.void);
      assert.isFalse(document.head.contains(node));
    }),
  );

  it.scoped("should mount keyed element (title) to document.head", () =>
    Effect.gen(function* () {
      const head = yield* makeBrowserHead();
      const node = document.createElement("title");
      node.textContent = "My Page";

      const mountScope = yield* Scope.make();
      yield* head.mount("title", node, Option.some("title")).pipe(Scope.extend(mountScope));

      assert.isTrue(document.head.contains(node));
      assert.strictEqual(document.head.querySelector("title")?.textContent, "My Page");

      yield* Scope.close(mountScope, Exit.void);
      assert.isFalse(document.head.contains(node));
    }),
  );

  it.scoped("should deduplicate keyed elements — deepest wins", () =>
    Effect.gen(function* () {
      const head = yield* makeBrowserHead();

      // Parent mounts title
      const parentTitle = document.createElement("title");
      parentTitle.textContent = "App";
      const parentScope = yield* Scope.make();
      yield* head.mount("title", parentTitle, Option.some("title")).pipe(Scope.extend(parentScope));

      assert.isTrue(document.head.contains(parentTitle));

      // Child mounts title — parent hidden, child visible
      const childTitle = document.createElement("title");
      childTitle.textContent = "About - App";
      const childScope = yield* Scope.make();
      yield* head.mount("title", childTitle, Option.some("title")).pipe(Scope.extend(childScope));

      assert.isFalse(document.head.contains(parentTitle));
      assert.isTrue(document.head.contains(childTitle));

      // Child unmounts — parent restored
      yield* Scope.close(childScope, Exit.void);
      assert.isTrue(document.head.contains(parentTitle));
      assert.isFalse(document.head.contains(childTitle));

      // Parent unmounts — both gone
      yield* Scope.close(parentScope, Exit.void);
      assert.isFalse(document.head.contains(parentTitle));
    }),
  );

  it.scoped("should handle 3-level deep dedup stack", () =>
    Effect.gen(function* () {
      const head = yield* makeBrowserHead();

      const t1 = document.createElement("title");
      t1.textContent = "Root";
      const s1 = yield* Scope.make();
      yield* head.mount("title", t1, Option.some("title")).pipe(Scope.extend(s1));

      const t2 = document.createElement("title");
      t2.textContent = "Section";
      const s2 = yield* Scope.make();
      yield* head.mount("title", t2, Option.some("title")).pipe(Scope.extend(s2));

      const t3 = document.createElement("title");
      t3.textContent = "Page";
      const s3 = yield* Scope.make();
      yield* head.mount("title", t3, Option.some("title")).pipe(Scope.extend(s3));

      // Only deepest visible
      assert.isFalse(document.head.contains(t1));
      assert.isFalse(document.head.contains(t2));
      assert.isTrue(document.head.contains(t3));

      // Pop deepest — middle restored
      yield* Scope.close(s3, Exit.void);
      assert.isFalse(document.head.contains(t1));
      assert.isTrue(document.head.contains(t2));

      // Pop middle — root restored
      yield* Scope.close(s2, Exit.void);
      assert.isTrue(document.head.contains(t1));

      // Pop root — all gone
      yield* Scope.close(s1, Exit.void);
      assert.isFalse(document.head.contains(t1));
    }),
  );

  it.scoped("should allow multiple unkeyed elements of same tag", () =>
    Effect.gen(function* () {
      const head = yield* makeBrowserHead();

      const link1 = document.createElement("link");
      link1.setAttribute("href", "/a.css");
      const link2 = document.createElement("link");
      link2.setAttribute("href", "/b.css");

      const s1 = yield* Scope.make();
      const s2 = yield* Scope.make();
      yield* head.mount("link", link1, Option.none()).pipe(Scope.extend(s1));
      yield* head.mount("link", link2, Option.none()).pipe(Scope.extend(s2));

      // Both present
      assert.isTrue(document.head.contains(link1));
      assert.isTrue(document.head.contains(link2));

      // Remove first — second stays
      yield* Scope.close(s1, Exit.void);
      assert.isFalse(document.head.contains(link1));
      assert.isTrue(document.head.contains(link2));

      yield* Scope.close(s2, Exit.void);
      assert.isFalse(document.head.contains(link2));
    }),
  );

  it.scoped("should deduplicate meta by name independently", () =>
    Effect.gen(function* () {
      const head = yield* makeBrowserHead();

      // First meta[name=description]
      const m1 = document.createElement("meta");
      m1.setAttribute("name", "description");
      m1.setAttribute("content", "Original");
      const s1 = yield* Scope.make();
      yield* head.mount("meta", m1, Option.some("meta:name:description")).pipe(Scope.extend(s1));

      // Second meta[name=description] — overwrites first
      const m2 = document.createElement("meta");
      m2.setAttribute("name", "description");
      m2.setAttribute("content", "Updated");
      const s2 = yield* Scope.make();
      yield* head.mount("meta", m2, Option.some("meta:name:description")).pipe(Scope.extend(s2));

      assert.isFalse(document.head.contains(m1));
      assert.isTrue(document.head.contains(m2));

      // Different key (meta[name=author]) — independent
      const m3 = document.createElement("meta");
      m3.setAttribute("name", "author");
      m3.setAttribute("content", "John");
      const s3 = yield* Scope.make();
      yield* head.mount("meta", m3, Option.some("meta:name:author")).pipe(Scope.extend(s3));

      assert.isTrue(document.head.contains(m2)); // description still there
      assert.isTrue(document.head.contains(m3)); // author added

      // Unmount updated description — original restored
      yield* Scope.close(s2, Exit.void);
      assert.isTrue(document.head.contains(m1));

      yield* Scope.close(s1, Exit.void);
      yield* Scope.close(s3, Exit.void);
    }),
  );

  it.scoped("should track entries correctly", () =>
    Effect.gen(function* () {
      const head = yield* makeBrowserHead();

      const title = document.createElement("title");
      title.textContent = "Test";
      const link = document.createElement("link");

      const s1 = yield* Scope.make();
      const s2 = yield* Scope.make();
      yield* head.mount("title", title, Option.some("title")).pipe(Scope.extend(s1));
      yield* head.mount("link", link, Option.none()).pipe(Scope.extend(s2));

      const entries = yield* head.entries;
      assert.strictEqual(entries.length, 2);
      assert.strictEqual(entries[0]?.tagName, "title");
      assert.strictEqual(entries[1]?.tagName, "link");

      yield* Scope.close(s1, Exit.void);
      const afterRemove = yield* head.entries;
      assert.strictEqual(afterRemove.length, 1);
      assert.strictEqual(afterRemove[0]?.tagName, "link");

      yield* Scope.close(s2, Exit.void);
      const afterAll = yield* head.entries;
      assert.strictEqual(afterAll.length, 0);
    }),
  );

  it.scoped("should handle middle-of-stack removal gracefully", () =>
    Effect.gen(function* () {
      const head = yield* makeBrowserHead();

      const t1 = document.createElement("title");
      t1.textContent = "First";
      const s1 = yield* Scope.make();
      yield* head.mount("title", t1, Option.some("title")).pipe(Scope.extend(s1));

      const t2 = document.createElement("title");
      t2.textContent = "Second";
      const s2 = yield* Scope.make();
      yield* head.mount("title", t2, Option.some("title")).pipe(Scope.extend(s2));

      const t3 = document.createElement("title");
      t3.textContent = "Third";
      const s3 = yield* Scope.make();
      yield* head.mount("title", t3, Option.some("title")).pipe(Scope.extend(s3));

      // Remove middle (not top of stack) — top stays visible
      yield* Scope.close(s2, Exit.void);
      assert.isTrue(document.head.contains(t3));
      assert.isFalse(document.head.contains(t2));
      assert.isFalse(document.head.contains(t1));

      // Remove top — falls back to first (skip removed middle)
      yield* Scope.close(s3, Exit.void);
      assert.isTrue(document.head.contains(t1));

      yield* Scope.close(s1, Exit.void);
    }),
  );
});

// =============================================================================
// Test Head — In-memory entry collection
// =============================================================================

describe("Test Head", () => {
  it.scoped("should collect entries without DOM manipulation", () =>
    Effect.gen(function* () {
      const head = yield* makeTestHead();
      const node = document.createElement("title");
      node.textContent = "Test Title";

      const mountScope = yield* Scope.make();
      yield* head.mount("title", node, Option.some("title")).pipe(Scope.extend(mountScope));

      const entries = yield* head.entries;
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0]?.tagName, "title");
      assert.deepStrictEqual(entries[0]?.key, Option.some("title"));

      yield* Scope.close(mountScope, Exit.void);
      const afterClose = yield* head.entries;
      assert.strictEqual(afterClose.length, 0);
    }),
  );

  it.scoped("should track multiple entries", () =>
    Effect.gen(function* () {
      const head = yield* makeTestHead();

      const title = document.createElement("title");
      const meta = document.createElement("meta");
      const link = document.createElement("link");

      const s1 = yield* Scope.make();
      const s2 = yield* Scope.make();
      const s3 = yield* Scope.make();

      yield* head.mount("title", title, Option.some("title")).pipe(Scope.extend(s1));
      yield* head.mount("meta", meta, Option.some("meta:name:desc")).pipe(Scope.extend(s2));
      yield* head.mount("link", link, Option.none()).pipe(Scope.extend(s3));

      const entries = yield* head.entries;
      assert.strictEqual(entries.length, 3);

      yield* Scope.close(s2, Exit.void);
      const afterRemove = yield* head.entries;
      assert.strictEqual(afterRemove.length, 2);
      assert.strictEqual(afterRemove[0]?.tagName, "title");
      assert.strictEqual(afterRemove[1]?.tagName, "link");

      yield* Scope.close(s1, Exit.void);
      yield* Scope.close(s3, Exit.void);
    }),
  );
});

// =============================================================================
// Renderer Integration — Head hoisting through JSX
// =============================================================================

describe("Renderer Integration", () => {
  it.scoped("should hoist <title> to document.head", () =>
    Effect.gen(function* () {
      const App = Component.gen(function* () {
        return (
          <>
            <title>My Page</title>
            <div data-testid="content">Hello</div>
          </>
        );
      });

      const { getByTestId, container } = yield* render(<App />);

      // Content rendered normally
      assert.strictEqual((yield* getByTestId("content")).textContent, "Hello");

      // Title NOT in the container (hoisted)
      assert.isNull(container.querySelector("title"));

      // Title IS in document.head
      const headTitle = document.head.querySelector("title");
      assert.isNotNull(headTitle);
      assert.strictEqual(headTitle?.textContent, "My Page");
    }),
  );

  it.scoped("should hoist <meta> to document.head", () =>
    Effect.gen(function* () {
      const App = Component.gen(function* () {
        return (
          <>
            <meta name="description" content="Test page" />
            <div data-testid="body">Body</div>
          </>
        );
      });

      const { container } = yield* render(<App />);

      // meta NOT in container
      assert.isNull(container.querySelector("meta[name='description']"));

      // meta IS in document.head
      const meta = document.head.querySelector("meta[name='description']");
      assert.isNotNull(meta);
      assert.strictEqual(meta?.getAttribute("content"), "Test page");
    }),
  );

  it.scoped("should keep mode='static' elements in-place", () =>
    Effect.gen(function* () {
      const App = Component.gen(function* () {
        return (
          <div data-testid="wrapper">
            <style mode="static">{`.x { color: red; }`}</style>
            <span>Content</span>
          </div>
        );
      });

      const { getByTestId } = yield* render(<App />);

      // Style stays in container (not hoisted)
      const style = (yield* getByTestId("wrapper")).querySelector("style");
      assert.isNotNull(style);
      assert.strictEqual(style?.textContent, ".x { color: red; }");
    }),
  );

  it.scoped("should hoist <link> to document.head", () =>
    Effect.gen(function* () {
      const App = Component.gen(function* () {
        return (
          <>
            <link rel="stylesheet" href="/app.css" />
            <div data-testid="main">Main</div>
          </>
        );
      });

      const { container } = yield* render(<App />);

      // link NOT in container
      assert.isNull(container.querySelector("link"));

      // link IS in document.head
      const link = document.head.querySelector("link[href='/app.css']");
      assert.isNotNull(link);
    }),
  );

  it.scoped("should clean up hoisted elements on unmount", () =>
    Effect.gen(function* () {
      const App = Component.gen(function* () {
        return <title>Cleanup Test</title>;
      });

      const scope = yield* Scope.make();
      yield* render(<App />).pipe(Scope.extend(scope));

      // Title present
      assert.isNotNull(document.head.querySelector("title"));

      // Unmount
      yield* Scope.close(scope, Exit.void);

      // Title removed
      const remaining = document.head.querySelector("title");
      assert.isNull(remaining);
    }),
  );
});

// =============================================================================
// Document-Level Elements — html/head/body mapping
// =============================================================================

describe("Document-Level Elements", () => {
  it.scoped("should map <html> attributes to document.documentElement", () =>
    Effect.gen(function* () {
      const App = Component.gen(function* () {
        return (
          <html lang="fr" className="dark">
            <body>
              <div data-testid="inner">Content</div>
            </body>
          </html>
        );
      });

      yield* FiberRef.set(IsDocumentMount, true);
      yield* render(<App />);

      assert.strictEqual(document.documentElement.getAttribute("lang"), "fr");
      assert.strictEqual(document.documentElement.getAttribute("class"), "dark");
    }),
  );

  it.scoped("should map <body> attributes to document.body", () =>
    Effect.gen(function* () {
      const App = Component.gen(function* () {
        return (
          <html lang="en">
            <body className="antialiased">
              <div data-testid="body-child">Hello</div>
            </body>
          </html>
        );
      });

      yield* FiberRef.set(IsDocumentMount, true);
      yield* render(<App />);

      assert.strictEqual(document.body.getAttribute("class"), "antialiased");
    }),
  );

  it.scoped("should render <body> children into document.body", () =>
    Effect.gen(function* () {
      const App = Component.gen(function* () {
        return (
          <html lang="en">
            <body>
              <div data-testid="doc-content">Document Content</div>
            </body>
          </html>
        );
      });

      yield* FiberRef.set(IsDocumentMount, true);
      yield* render(<App />);

      // Content should be in document.body
      const content = document.body.querySelector("[data-testid='doc-content']");
      assert.isNotNull(content);
      assert.strictEqual(content?.textContent, "Document Content");
    }),
  );

  it.scoped("should hoist <head> children to document.head", () =>
    Effect.gen(function* () {
      const App = Component.gen(function* () {
        return (
          <html lang="en">
            <head>
              <title>Doc Title</title>
              <meta name="description" content="Doc description" />
            </head>
            <body>
              <div>Body</div>
            </body>
          </html>
        );
      });

      yield* FiberRef.set(IsDocumentMount, true);
      yield* render(<App />);

      // Title and meta should be in document.head
      const title = document.head.querySelector("title");
      assert.isNotNull(title);
      assert.strictEqual(title?.textContent, "Doc Title");

      const meta = document.head.querySelector("meta[name='description']");
      assert.isNotNull(meta);
      assert.strictEqual(meta?.getAttribute("content"), "Doc description");
    }),
  );

  it.scoped("should NOT map html/head/body when IsDocumentMount is false", () =>
    Effect.gen(function* () {
      const App = Component.gen(function* () {
        return (
          <html lang="de">
            <body>
              <div data-testid="nested">Nested</div>
            </body>
          </html>
        );
      });

      // Default: IsDocumentMount = false
      const { container } = yield* render(<App />);

      // html element should be created as a normal element in the container
      const htmlEl = container.querySelector("html");
      assert.isNotNull(htmlEl);
      assert.strictEqual(htmlEl?.getAttribute("lang"), "de");

      // document.documentElement should NOT have lang="de" applied
      // (it may have been set by previous test, so check container instead)
      assert.isNotNull(container.querySelector("[data-testid='nested']"));
    }),
  );

  it.scoped("should revert attributes on cleanup", () =>
    Effect.gen(function* () {
      const prevLang = document.documentElement.getAttribute("lang");

      const App = Component.gen(function* () {
        return (
          <html lang="ja">
            <body>
              <div>Content</div>
            </body>
          </html>
        );
      });

      yield* FiberRef.set(IsDocumentMount, true);
      const scope = yield* Scope.make();
      yield* render(<App />).pipe(Scope.extend(scope));

      assert.strictEqual(document.documentElement.getAttribute("lang"), "ja");

      yield* Scope.close(scope, Exit.void);

      // lang should be reverted
      const afterLang = document.documentElement.getAttribute("lang");
      assert.strictEqual(afterLang, prevLang);
    }),
  );

  // ---------------------------------------------------------------------------
  // Signal-valued attributes on document elements
  // ---------------------------------------------------------------------------

  it.scoped("should apply Signal-valued attribute on <html> and update reactively", () =>
    Effect.gen(function* () {
      const theme = yield* Signal.make("dark");

      const App = Component.gen(function* () {
        return (
          <html lang="en" data-theme={theme}>
            <body>
              <div>Content</div>
            </body>
          </html>
        );
      });

      yield* FiberRef.set(IsDocumentMount, true);
      yield* render(<App />);

      // Initial value applied
      assert.strictEqual(document.documentElement.getAttribute("data-theme"), "dark");

      // Update signal — attribute should reflect new value
      yield* Signal.set(theme, "light");
      assert.strictEqual(document.documentElement.getAttribute("data-theme"), "light");

      // Update again
      yield* Signal.set(theme, "dark");
      assert.strictEqual(document.documentElement.getAttribute("data-theme"), "dark");
    }),
  );

  it.scoped("should revert Signal-valued attribute on cleanup", () =>
    Effect.gen(function* () {
      const prevTheme = document.documentElement.getAttribute("data-theme");

      const theme = yield* Signal.make("dark");

      const App = Component.gen(function* () {
        return (
          <html lang="en" data-theme={theme}>
            <body>
              <div>Content</div>
            </body>
          </html>
        );
      });

      yield* FiberRef.set(IsDocumentMount, true);
      const scope = yield* Scope.make();
      yield* render(<App />).pipe(Scope.extend(scope));

      assert.strictEqual(document.documentElement.getAttribute("data-theme"), "dark");

      yield* Scope.close(scope, Exit.void);

      // Attribute should be reverted to original
      assert.strictEqual(document.documentElement.getAttribute("data-theme"), prevTheme);
    }),
  );

  it.scoped("should unsubscribe from Signal on cleanup (no stale updates)", () =>
    Effect.gen(function* () {
      const theme = yield* Signal.make("dark");

      const App = Component.gen(function* () {
        return (
          <html lang="en" data-theme={theme}>
            <body>
              <div>Content</div>
            </body>
          </html>
        );
      });

      yield* FiberRef.set(IsDocumentMount, true);
      const scope = yield* Scope.make();
      yield* render(<App />).pipe(Scope.extend(scope));

      assert.strictEqual(document.documentElement.getAttribute("data-theme"), "dark");

      yield* Scope.close(scope, Exit.void);

      // After cleanup, signal updates should NOT affect the document element
      yield* Signal.set(theme, "light");
      // Attribute was reverted to original (null), not updated to "light"
      assert.notStrictEqual(document.documentElement.getAttribute("data-theme"), "light");
    }),
  );

  it.scoped("should handle multiple Signal-valued attributes on same document element", () =>
    Effect.gen(function* () {
      const theme = yield* Signal.make("dark");
      const dir = yield* Signal.make("ltr");

      const App = Component.gen(function* () {
        return (
          <html lang="en" data-theme={theme} data-dir={dir}>
            <body>
              <div>Content</div>
            </body>
          </html>
        );
      });

      yield* FiberRef.set(IsDocumentMount, true);
      yield* render(<App />);

      assert.strictEqual(document.documentElement.getAttribute("data-theme"), "dark");
      assert.strictEqual(document.documentElement.getAttribute("data-dir"), "ltr");

      // Update one signal
      yield* Signal.set(theme, "light");
      assert.strictEqual(document.documentElement.getAttribute("data-theme"), "light");
      assert.strictEqual(document.documentElement.getAttribute("data-dir"), "ltr");

      // Update the other
      yield* Signal.set(dir, "rtl");
      assert.strictEqual(document.documentElement.getAttribute("data-dir"), "rtl");
    }),
  );
});
