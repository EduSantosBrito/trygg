# Head

## When to use

Use `Head` when components need to describe document metadata near the route or UI that owns it instead of mutating `document.head` manually.

## Behavior

The `Head` module defines the hoisting rules, key derivation, and browser or test services that keep `<title>`, `<meta>`, and related tags deduplicated as components mount and unmount.

Layout components should own static SEO by rendering tags directly inside their layout-rendered `<head>`. The renderer hoists these tags to `document.head`, so the metadata stays colocated with the route tree that owns it while still landing in the browser head.

```tsx
const seo = {
  title: "trygg — Effect-native UI framework",
  description: "Effect-native UI framework with fine-grained reactivity.",
  url: "https://trygg.dev",
} as const;

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "trygg",
  description: seo.description,
  url: seo.url,
};

export default Component.gen(function* () {
  return (
    <html lang="en">
      <head>
        <title>{seo.title}</title>
        <meta name="description" content={seo.description} />
        <link rel="canonical" href={seo.url} />

        <meta property="og:type" content="website" />
        <meta property="og:url" content={seo.url} />
        <meta property="og:title" content={seo.title} />
        <meta property="og:description" content={seo.description} />

        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={seo.title} />
        <meta name="twitter:description" content={seo.description} />

        <meta name="theme-color" content="#050508" />
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </head>
      <body>{/* app shell */}</body>
    </html>
  );
});
```

Do not duplicate static SEO injection through Vite `transformIndexHtml`; use `transformIndexHtml` only for document shell concerns outside the app-owned metadata tree.

## Related exports

- `Head.HeadStrategy`
- `Head.deriveKey`
- `Head.makeBrowserHead`
- `Head.browserHeadLayer`
