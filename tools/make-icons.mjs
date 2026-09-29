#!/usr/bin/env node
/**
 * Loaded Late — deterministic app-icon generator.
 *
 * Why this file exists: the site is installable (PWA manifest + icons) so it can
 * live on a phone's home screen, which is what iOS requires before it will
 * deliver Web Push at all. Shipping icons meant either committing binary art of
 * unknown provenance or generating it. This generates it.
 *
 * Everything here is pure arithmetic + `node:zlib` — no dependencies, no fonts,
 * no image library, no network, and no invented artwork. The picture is the
 * thing the app detects: an infield diamond with all three bases occupied.
 * Colours are the site's own palette, read from `assets/css/bases-loaded.css`
 * rather than chosen here (see PALETTE_SOURCE).
 *
 * Run
 *   node tools/make-icons.mjs            # (re)write every icon under assets/icons
 *   node tools/make-icons.mjs --check    # write nothing; exit 1 if drift
 *   node tools/make-icons.mjs --dry      # write nothing; report what would change
 *
 * `tools/icons-test.mjs` re-renders every committed icon and compares decoded
 * pixels, so an icon edited by hand (or corrupted) fails the suite.
 */

import { deflateSync } from "node:zlib";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT_DIR = join(ROOT, "assets", "icons");

/* ------------------------------------------------------------------ palette
 * These four hex values are the site's own design tokens. They are read back
 * out of the stylesheet by `tools/icons-test.mjs`, which fails if the icons and
 * the CSS ever disagree — so the icon cannot silently drift from the brand.
 */
export const PALETTE_SOURCE = "assets/css/bases-loaded.css";

const css = readFileSync(join(ROOT, PALETTE_SOURCE), "utf8");

/** Pull a declared colour out of the stylesheet; never fall back to a guess. */
function token(name) {
  const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`palette token --${name} not found in ${PALETTE_SOURCE}`);
  return match[1];
}

/** The page background is a literal on `.loaded-page`, not a custom property. */
function background() {
  const match = css.match(/\.loaded-page\s*\{[^}]*background:\s*(#[0-9a-fA-F]{6})/);
  if (!match) throw new Error(`page background not found in ${PALETTE_SOURCE}`);
  return match[1];
}

/** The card/ink colour pages use for body text. */
function ink() {
  const match = css.match(/\.loaded-page\s*\{[^}]*color:\s*(#[0-9a-fA-F]{6})/);
  if (!match) throw new Error(`page text colour not found in ${PALETTE_SOURCE}`);
  return match[1];
}

export const COLORS = {
  bg: background(),
  lime: token("lime"),
  line: token("line"),
  ink: ink(),
  alert: token("tension-max"),
};

const hexToRgb = (hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/** Blend two hex colours; `amount` is how much of `over` shows through. */
export function mix(under, over, amount) {
  const a = hexToRgb(under);
  const b = hexToRgb(over);
  const t = Math.min(1, Math.max(0, amount));
  const channel = (i) => Math.round(a[i] + (b[i] - a[i]) * t);
  return `#${[0, 1, 2].map((i) => channel(i).toString(16).padStart(2, "0")).join("")}`;
}

/* ------------------------------------------------------------------ geometry
 * Unit space: the icon is the square [0,1] × [0,1], y pointing down. Baseball
 * orientation as a scoreboard draws it — home plate at the bottom, first base to
 * the right, second at the top, third to the left.
 *
 * A square rotated 45° with its vertices at distance r from its centre is
 * exactly the set of points with |dx| + |dy| <= r, which is why the bases and
 * the infield need no trigonometry.
 */
export const R_INFIELD = 0.3; // centre -> any base
export const R_BASE = 0.052; // base "radius" (centre -> corner)
export const W_LINE = 0.022; // infield outline thickness
const PLATE_HALF = 0.048; // home plate half-width
// How much brand lime the infield line and the dirt inside it carry. Shared by
// the raster and the SVG so the favicon and the install icon cannot disagree.
export const OUTLINE_BLEND = 0.45;
export const DIRT_BLEND = 0.1;

/** |dx| + |dy| <= r — a diamond (square on its corner). */
const inDiamond = (x, y, cx, cy, r) => Math.abs(x - cx) + Math.abs(y - cy) <= r;

/** Even-odd point-in-polygon, used for the five-sided home plate. */
export function inPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Home plate: a rectangle with the back corner coming to a point at the ground. */
export function homePlatePoints(cx, cy, half = PLATE_HALF) {
  return [
    [cx - half, cy - half],
    [cx + half, cy - half],
    [cx + half, cy + half * 0.25],
    [cx, cy + half],
    [cx - half, cy + half * 0.25],
  ];
}

/**
 * Which colour covers this point, as a hex string. `scale` shrinks the artwork
 * towards the centre: the maskable variant needs everything inside the middle
 * 80% because launchers crop circles, squircles and rounded squares out of it.
 */
export function paint(x, y, { scale = 1 } = {}) {
  const cx = 0.5 + (x - 0.5) / scale;
  const cy = 0.5 + (y - 0.5) / scale;
  // Outside the safe zone a maskable icon is cropped anyway; keep it flat.
  if (Math.abs(cx - 0.5) > 0.5 || Math.abs(cy - 0.5) > 0.5) return COLORS.bg;

  const d = Math.abs(cx - 0.5) + Math.abs(cy - 0.5);
  const dirt = mix(COLORS.bg, COLORS.lime, DIRT_BLEND);
  const outline = mix(COLORS.bg, COLORS.lime, OUTLINE_BLEND);

  // Bases first so the plate and the bases win over the infield lines.
  const bases = [
    [0.5 + R_INFIELD, 0.5], // first
    [0.5, 0.5 - R_INFIELD], // second
    [0.5 - R_INFIELD, 0.5], // third
  ];
  for (const [bx, by] of bases) if (inDiamond(cx, cy, bx, by, R_BASE)) return COLORS.lime;

  const plate = homePlatePoints(0.5, 0.5 + R_INFIELD);
  if (inPolygon(cx, cy, plate)) return COLORS.ink;

  // Interior dirt first, then the outline band that sits *outside* it — the
  // band is the set R < d <= R+W, so testing it first would swallow the infield.
  if (d <= R_INFIELD) return dirt;
  if (d <= R_INFIELD + W_LINE) return outline;

  return COLORS.bg;
}

/* --------------------------------------------------------------------- PNG
 * A minimal RGBA encoder: signature, IHDR, one IDAT of filter-0 scanlines,
 * IEND, each chunk with its own CRC-32 (ISO 3309 / PNG spec §5.2).
 */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

export function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/**
 * Rasterise the icon. `samples` per axis is supersampling for antialiasing:
 * 4 means 16 samples per pixel, which is what keeps the diagonals smooth
 * without a font or an image library in the loop.
 */
export function render(size, { scale = 1, samples = 4 } = {}) {
  const pixels = Buffer.alloc(size * size * 4);
  const cache = new Map();
  const rgbOf = (hex) => {
    let value = cache.get(hex);
    if (!value) {
      value = hexToRgb(hex);
      cache.set(hex, value);
    }
    return value;
  };

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      // Accumulate per channel so a partially covered pixel is a blend of the
      // colours actually under it, not the average of their hex strings.
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          // Sample centres inside the pixel, in the icon's [0,1] unit space.
          const x = (px + (sx + 0.5) / samples) / size;
          const y = (py + (sy + 0.5) / samples) / size;
          const [cr, cg, cb] = rgbOf(paint(x, y, { scale }));
          r += cr;
          g += cg;
          b += cb;
        }
      }
      const total = samples * samples;
      const offset = (py * size + px) * 4;
      pixels[offset] = Math.round(r / total);
      pixels[offset + 1] = Math.round(g / total);
      pixels[offset + 2] = Math.round(b / total);
      pixels[offset + 3] = 255; // opaque: launchers composite the icon themselves
    }
  }
  return pixels;
}

export function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour with alpha
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter type 0 (None) for every scanline
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export function renderPng(size, options) {
  return encodePng(size, render(size, options));
}

/* -------------------------------------------------------------------- SVG
 * The same geometry as vector, for the favicon: browsers scale it to whatever
 * the tab needs. Written by hand so it matches `paint()` by construction.
 */
export function faviconSvg() {
  const R = R_INFIELD;
  const c = 0.5;
  const n = (value) => value.toFixed(4).replace(/\.?0+$/, "") || "0";
  const diamond = (x, y, r) =>
    `M${n(x)} ${n(y - r)}L${n(x + r)} ${n(y)}L${n(x)} ${n(y + r)}L${n(x - r)} ${n(y)}Z`;
  const plate =
    homePlatePoints(c, c + R)
      .map(([x, y], i) => `${i ? "L" : "M"}${n(x)} ${n(y)}`)
      .join("") + "Z";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" width="64" height="64">
  <rect width="1" height="1" fill="${COLORS.bg}"/>
  <path d="${diamond(c, c, R + W_LINE)}" fill="${mix(COLORS.bg, COLORS.lime, OUTLINE_BLEND)}"/>
  <path d="${diamond(c, c, R)}" fill="${mix(COLORS.bg, COLORS.lime, DIRT_BLEND)}"/>
  <path d="${plate}" fill="${COLORS.ink}"/>
  <path d="${diamond(c + R, c, R_BASE)}" fill="${COLORS.lime}"/>
  <path d="${diamond(c, c - R, R_BASE)}" fill="${COLORS.lime}"/>
  <path d="${diamond(c - R, c, R_BASE)}" fill="${COLORS.lime}"/>
</svg>
`;
}

/* ------------------------------------------------------------------- output
 * One entry per file. `maskable` keeps the artwork inside the middle 80% so a
 * circular crop cannot cut a base off; `any` uses the full square.
 */
export const ICONS = [
  { file: "icon-192.png", size: 192, purpose: "any" },
  { file: "icon-512.png", size: 512, purpose: "any" },
  { file: "maskable-192.png", size: 192, purpose: "maskable" },
  { file: "maskable-512.png", size: 512, purpose: "maskable" },
  // iOS ignores the manifest's icons for Add to Home Screen and wants this size.
  { file: "apple-touch-icon.png", size: 180, purpose: "apple-touch-icon" },
];

export function buildAll() {
  const files = ICONS.map((icon) => ({
    ...icon,
    bytes: renderPng(icon.size, { scale: icon.purpose === "maskable" ? 0.8 : 1 }),
  }));
  files.push({ file: "favicon.svg", bytes: Buffer.from(faviconSvg(), "utf8") });
  return files;
}

export function writeAll(target = OUT_DIR) {
  mkdirSync(target, { recursive: true });
  const written = [];
  for (const icon of buildAll()) {
    const path = join(target, icon.file);
    const before = existsSync(path) ? readFileSync(path) : null;
    if (!before || !before.equals(icon.bytes)) {
      writeFileSync(path, icon.bytes);
      written.push(icon.file);
    }
  }
  return written;
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  const check = process.argv.includes("--check");
  const dry = process.argv.includes("--dry");
  if (check || dry) {
    const drift = [];
    for (const icon of buildAll()) {
      const path = join(OUT_DIR, icon.file);
      if (!existsSync(path)) drift.push(`${icon.file} (missing)`);
      else if (!readFileSync(path).equals(icon.bytes)) drift.push(`${icon.file} (differs)`);
    }
    if (drift.length) {
      console.error(`icon drift: ${drift.join(", ")} — run: node tools/make-icons.mjs`);
      process.exit(1);
    }
    console.log(`✓ ${buildAll().length} icons match the generator (no drift)`);
  } else {
    const written = writeAll();
    console.log(
      written.length
        ? `wrote ${written.join(", ")} to assets/icons/`
        : "assets/icons/ already up to date",
    );
  }
}
