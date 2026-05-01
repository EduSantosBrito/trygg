#!/usr/bin/env node
/**
 * scripts/build-og-images.mjs
 *
 * Renders Open Graph SVGs in scripts/og/ to PNGs in public/og/.
 *
 * Strategy (mirrors trygg-cloud-astro):
 *   • @resvg/resvg-js — SVG → raw pixels with explicit TTF font buffers.
 *   • sharp — PNG encode for smaller file size.
 *
 * Fonts are downloaded once into scripts/.fonts/ on first run and reused.
 */

import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const FONTS_DIR = join(__dirname, ".fonts");

const LEGACY_UA =
  "Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10_6_3; en-us) " +
  "AppleWebKit/533.18.1 (KHTML, like Gecko) Version/5.0.2 Safari/533.18.5";

const FONT_FAMILIES = ["Space Grotesk", "IBM Plex Sans", "IBM Plex Mono"];
const DEFAULT_FONT_FAMILY = "IBM Plex Sans";

/**
 * Width is the *source* render width passed to resvg. We render at 2× the
 * standard 1200×630 OG card so retina displays show crisp glyphs and the
 * pixel-ladder mark stays sharp under platform downscaling. The 1.91:1 aspect
 * is preserved, so Twitter/LinkedIn/etc. crop identically.
 */
const TARGETS = [
  {
    svg: "scripts/og/og-image.svg",
    png: "public/og/og-image.png",
    width: 2400,
    height: 1260,
  },
];

const PER_WEIGHT_REQUESTS = [
  ["IBM+Plex+Sans", 400],
  ["IBM+Plex+Sans", 500],
  ["IBM+Plex+Sans", 600],
  ["IBM+Plex+Sans", 700],
  ["IBM+Plex+Mono", 500],
  ["Space+Grotesk", 700],
];

function cachedFileName(family, weight) {
  return `${family.replace(/\+/g, "-")}-${weight}.ttf`;
}

async function ensureFontCache() {
  await mkdir(FONTS_DIR, { recursive: true });

  const existing = new Set((await readdir(FONTS_DIR)).filter((f) => f.endsWith(".ttf")));

  const missing = PER_WEIGHT_REQUESTS.filter(
    ([family, weight]) => !existing.has(cachedFileName(family, weight)),
  );

  if (missing.length === 0) {
    return PER_WEIGHT_REQUESTS.map(([family, weight]) =>
      join(FONTS_DIR, cachedFileName(family, weight)),
    );
  }

  console.log(`  (${missing.length} font(s) missing — downloading from Google Fonts…)`);

  for (const [family, weight] of missing) {
    const familyUrl = `https://fonts.googleapis.com/css2?family=${family}:wght@${weight}&display=swap`;
    const perFaceCss = await (
      await fetch(familyUrl, { headers: { "User-Agent": LEGACY_UA } })
    ).text();
    const url = perFaceCss.match(/url\(([^)]+)\)/)?.[1];
    if (!url) continue;
    const fontResp = await fetch(url);
    if (!fontResp.ok) continue;
    const buf = Buffer.from(await fontResp.arrayBuffer());
    const fileName = cachedFileName(family, weight);
    const filePath = join(FONTS_DIR, fileName);
    await writeFile(filePath, buf);
    console.log(`    ✓ ${fileName} (${(buf.length / 1024).toFixed(0)} KB)`);
  }

  const finalFiles = (await readdir(FONTS_DIR)).filter((f) => f.endsWith(".ttf"));
  if (finalFiles.length === 0) {
    throw new Error("No fonts downloaded — Google Fonts may have changed.");
  }
  return finalFiles.map((f) => join(FONTS_DIR, f));
}

function stripPreviewStyle(svg) {
  return svg.replace(
    /\u003cstyle\u003e\s*\u003c!\[CDATA\[[\s\S]*?@import[\s\S]*?\]\]\u003e\s*\u003c\/style\u003e\s*/,
    "",
  );
}

async function renderOne(target, fontPaths) {
  const svgPath = join(ROOT, target.svg);
  const pngPath = join(ROOT, target.png);

  const raw = await readFile(svgPath, "utf8");
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

  await mkdir(dirname(pngPath), { recursive: true });
  const png = await sharp(raster)
    .png({ compressionLevel: 9, palette: false, effort: 10 })
    .toBuffer();
  await writeFile(pngPath, png);

  const kb = (png.length / 1024).toFixed(1);
  console.log(`  ✓ ${target.png} — ${target.width}×${target.height}, ${kb} KB`);
}

async function main() {
  console.log("◆ Checking font cache…");
  const fontPaths = await ensureFontCache();
  console.log(`  ${fontPaths.length} TTF file(s) loaded\n`);

  console.log("◆ Rendering PNGs…");
  for (const target of TARGETS) {
    await renderOne(target, fontPaths);
  }
  console.log("\n◆ Done.");
}

main().catch((err) => {
  console.error("\n✗ OG build failed:", err);
  process.exitCode = 1;
});
