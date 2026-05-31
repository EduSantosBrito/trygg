#!/usr/bin/env node
/**
 * apps/www/scripts/build-readme-header.mjs
 *
 * Renders README header SVG to PNG.
 * Outputs to ../../.github/assets/readme-header.png
 */

import { Resvg } from "@resvg/resvg-js";
import { Effect, ManagedRuntime } from "effect";
import { FetchHttpClient, HttpClient } from "effect/unstable/http";
import sharp from "sharp";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../../..");
const FONTS_DIR = join(__dirname, ".fonts");

const LEGACY_UA =
  "Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10_6_3; en-us) " +
  "AppleWebKit/533.18.1 (KHTML, like Gecko) Version/5.0.2 Safari/533.18.5";

const FONT_FAMILIES = ["Space Grotesk", "IBM Plex Sans", "IBM Plex Mono"];
const DEFAULT_FONT_FAMILY = "IBM Plex Sans";

const fetchText = Effect.fn("buildReadmeHeader.fetchText")(function* (url, options) {
  const response = yield* HttpClient.get(url, options);
  return yield* response.text;
});

const fetchBytesIfOk = Effect.fn("buildReadmeHeader.fetchBytesIfOk")(function* (url) {
  const response = yield* HttpClient.get(url);
  if (response.status < 200 || response.status >= 300) {
    return undefined;
  }
  const buffer = yield* response.arrayBuffer;
  return Buffer.from(buffer);
});

const httpRuntime = ManagedRuntime.make(FetchHttpClient.layer);
const runHttp = (effect) => httpRuntime.runPromise(effect);

const TARGET = {
  svg: join(ROOT, ".github/assets/readme-header.svg"),
  png: join(ROOT, ".github/assets/readme-header.png"),
  width: 1200,
  height: 300,
};

async function ensureFontCache() {
  await mkdir(FONTS_DIR, { recursive: true });

  const existing = (await readdir(FONTS_DIR)).filter((f) => f.endsWith(".ttf"));
  if (existing.length > 0) {
    return existing.map((f) => join(FONTS_DIR, f));
  }

  console.log("  (cache empty — downloading TTFs from Google Fonts…)");

  const perWeightRequests = [
    ["IBM+Plex+Sans", 400],
    ["IBM+Plex+Sans", 500],
    ["IBM+Plex+Sans", 600],
    ["IBM+Plex+Mono", 500],
    ["Space+Grotesk", 700],
  ];

  const downloads = [];
  for (const [family, weight] of perWeightRequests) {
    const familyUrl = `https://fonts.googleapis.com/css2?family=${family}:wght@${weight}&display=swap`;
    const perFaceCss = await runHttp(
      fetchText(familyUrl, { headers: { "User-Agent": LEGACY_UA } }),
    );
    const url = perFaceCss.match(/url\(([^)]+)\)/)?.[1];
    if (!url) continue;
    const buf = await runHttp(fetchBytesIfOk(url));
    if (buf === undefined) continue;
    const displayFamily = family.replace(/\+/g, " ");
    const fileName = `${displayFamily.replace(/\s+/g, "-")}-${weight}.ttf`;
    const filePath = join(FONTS_DIR, fileName);
    await writeFile(filePath, buf);
    downloads.push(filePath);
    console.log(`    ✓ ${fileName} (${(buf.length / 1024).toFixed(0)} KB)`);
  }

  if (downloads.length === 0) {
    await Effect.runPromise(Effect.fail("No fonts downloaded — Google Fonts may have changed."));
  }
  return downloads;
}

function stripPreviewStyle(svg) {
  return svg.replace(
    /\u003cstyle\u003e\s*\u003c!\[CDATA\[[\s\S]*?@import[\s\S]*?\]\]\u003e\s*\u003c\/style\u003e\s*/,
    "",
  );
}

async function render(target, fontPaths) {
  const raw = await readFile(target.svg, "utf8");
  const svg = stripPreviewStyle(raw);

  const resvg = new Resvg(svg, {
    font: {
      fontFiles: fontPaths,
      loadSystemFonts: false,
      defaultFontFamily: DEFAULT_FONT_FAMILY,
      serifFamily: FONT_FAMILIES[0],
      sansSerifFamily: FONT_FAMILIES[1],
      cursiveFamily: FONT_FAMILIES[1],
      fantasyFamily: FONT_FAMILIES[1],
      monospaceFamily: "IBM Plex Mono",
    },
    fitTo: { mode: "width", value: target.width },
    background: "#f7f4ed",
  });

  const raster = resvg.render().asPng();

  await mkdir(dirname(target.png), { recursive: true });
  const png = await sharp(raster)
    .png({ compressionLevel: 9, palette: false, effort: 10 })
    .toBuffer();
  await writeFile(target.png, png);

  const kb = (png.length / 1024).toFixed(1);
  console.log(`  ✓ ${target.png} — ${target.width}×${target.height}, ${kb} KB`);
}

async function main() {
  console.log("◆ Checking font cache…");
  const fontPaths = await ensureFontCache();
  console.log(`  ${fontPaths.length} TTF file(s) loaded\n`);

  console.log("◆ Rendering README header…");
  await render(TARGET, fontPaths);
  console.log("\n◆ Done.");
}

await Effect.runPromise(
  Effect.tryPromise({
    try: main,
    catch: (error) => error,
  }).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        console.error("\n✗ Build failed:", error);
        process.exitCode = 1;
      }),
    ),
  ),
);
