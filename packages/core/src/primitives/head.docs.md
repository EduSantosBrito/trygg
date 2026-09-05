# Head

Set the document title and head tags from anywhere in the component tree, and let the renderer hoist them to `document.head` with dedup so the nearest writer wins.

```tsx
import { Component } from "trygg";

const ArticlePage = Component.gen(function* () {
  return (
    <article>
      <title>Effect-native UI — trygg</title>
      <meta name="description" content="Render head tags from the component that owns them." />
      <link rel="canonical" href="https://trygg.dev/article" />
      <h1>Effect-native UI</h1>
    </article>
  );
});
```

## When to use

Reach for `Head` whenever a component or route should describe its own document metadata — `<title>`, `<meta>`, `<link>`, `<style>`, `<script>`, `<base>` — instead of mutating `document.head` by hand. The tags live in the JSX of the component that owns them, and the renderer moves them to the head.

Use Vite `transformIndexHtml` only for document-shell concerns that exist outside the app tree; do not also inject app-owned metadata there, or it will compete with the hoisted tags.

## Behavior

The renderer hoists the tags in `Head.HOISTABLE_TAGS` (`title`, `meta`, `link`, `style`, `script`, `base`) through its active head manager rather than mounting them where they appear. Components never provide this manager: browser rendering creates it for the render scope, and when no manager is active the tags render inline as ordinary elements.

Dedup is keyed by `Head.deriveKey(tag, props)`:

- `title` and `base` use a singleton key — only one is visible at a time.
- `meta` is keyed by `name`, then `property`, then `httpEquiv`, then `charset`.
- `link`, `style`, and `script` have no key, so duplicates are allowed.

Keyed tags use a stack, so the nearest (last-mounted) writer is the visible one. When a deeper component mounts a `<title>`, the previous title is hidden; when that component unmounts, its Scope finalizer removes the node and restores the previous title. This makes a layout's default title yield to a page's title.

## Static SEO from layouts

Put static, page-independent SEO in the layout that owns the document. A layout renders the `<head>`, so tags placed there cover every route mounted beneath its outlet, and a deeper page's `<title>`/`<meta>` overrides the layout default by key while it stays mounted.

```tsx
import { Component } from "trygg";
import * as Router from "trygg/router";

const RootLayout = Component.gen(function* () {
  return (
    <html lang="en">
      <head>
        <title>trygg</title>
        <meta name="description" content="Effect-native UI framework." />
        <link rel="canonical" href="https://trygg.dev" />
        <script type="application/ld+json">
          {JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: "trygg",
          })}
        </script>
      </head>
      <body>
        <Router.Outlet />
      </body>
    </html>
  );
});
```

The renderer hoists these tags to `document.head` from the layout-rendered `<head>`. Structured data works the same way: a `<script type="application/ld+json">` block is hoistable (`script` is in `Head.HOISTABLE_TAGS`), so JSON-LD declared in a layout reaches the head like any other tag.

Do not duplicate static SEO injection through Vite `transformIndexHtml`. Tags injected into the shell there live outside the app tree, so they compete with the hoisted layout tags instead of deduping against them; keep app-owned metadata in the layout and reserve `transformIndexHtml` for document-shell concerns outside the tree.

## Related exports

- `Head.deriveKey` — computes the dedup key for a tag
- `Head.isHoistable`
- `Head.HOISTABLE_TAGS` — the tags the renderer hoists into the head
- `Head.makeBrowser`
- `Head.makeTest`

## Troubleshooting

- A page `<meta name="description">` does not override the layout's: both resolve to the same key `meta:name:description`, so the deeper one wins only while it is mounted — confirm the page component is actually nested under the layout in the route tree.
- Two `<link>` or `<script>` tags both appear: `link`, `style`, and `script` have no dedup key by design. Move shared, single-instance metadata to a keyed `title`/`meta` tag, or render the duplicate-prone tag once in a shared ancestor.
- A tag renders in place instead of in the head: no head manager is active on that fiber. The browser renderer creates the manager at the Mount boundary; check that the element is mounted through `mount` and not a `mode: "static"` element, which opts out of hoisting.
