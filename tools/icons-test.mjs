#!/usr/bin/env node
/**
 * Installability + icon integrity checks (no dependencies, no network).
 *
 * The site became installable (PWA manifest + generated icons) so it can live on
 * a phone's home screen — which iOS requires before Web Push works at all. This
 * suite is what keeps that honest:
 *
 *   1. every committed PNG is a structurally valid PNG (signature, IHDR, per-
 *      chunk CRC-32, IDAT that inflates to the declared size, sane filters)
 *   2. the committed pixels are exactly what tools/make-icons.mjs renders now —
 *      a hand-edited or corrupted icon fails
 *   3. the icon colours are the site's own CSS tokens, read from the stylesheet
 *   4. the maskable variants keep their artwork inside the safe zone
 *   5. the manifest is valid JSON, relative-pathed (project Pages subpath), and
 *      every icon it names exists at the size it claims
 *   6. every page links the manifest, favicon, apple-touch-icon and theme colour
 *   7. the service worker's hard-coded buzz matches BasesLoadedRules.vibratePattern
 *   8. the dev server serves the manifest with a manifest MIME type
 *
 * Run: node tools/icons-test.mjs
 */
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  COLORS,
  ICONS,
  PALETTE_SOURCE,
  R_INFIELD,
  OUTLINE_BLEND,
  DIRT_BLEND,
  mix,
  render,
} from "./make-icons.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
let checks = 0;
const ok = (condition, label) => {
  assert.ok(condition, label);
  checks++;
};
const check = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  checks++;
};
const read = (file) => readFileSync(path.join(root, file), "utf8");
const readBytes = (file) => readFileSync(path.join(root, file));

/* ------------------------------------------------------- PNG structural pass */

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** CRC-32 (ISO 3309) — recomputed here, independently of the encoder. */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
};

/** Parse a PNG into { width, height, pixels } with full de-filtering. */
export function decodePng(buffer) {
  assert.ok(buffer.subarray(0, 8).equals(SIGNATURE), "PNG signature present");
  const chunks = [];
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    const stored = buffer.readUInt32BE(offset + 8 + length);
    assert.equal(
      crc32(Buffer.concat([Buffer.from(type, "ascii"), data])),
      stored,
      `chunk ${type} CRC matches`,
    );
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      assert.equal(data[10], 0, "deflate compression method");
      assert.equal(data[11], 0, "adaptive filtering method");
      assert.equal(data[12], 0, "no interlace");
    }
    if (type === "IDAT") chunks.push(data);
    if (type === "IEND") break;
    offset += 12 + length;
  }
  assert.equal(bitDepth, 8, "8-bit channels");
  assert.equal(colorType, 6, "truecolour + alpha");

  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * 4;
  assert.equal(raw.length, (stride + 1) * height, "IDAT inflates to the declared size");

  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y ? pixels.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    assert.ok(filter <= 4, `scanline ${y} filter type is defined (${filter})`);
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? out[x - 4] : 0;
      const b = prev[x];
      const c = x >= 4 ? prev[x - 4] : 0;
      let value = line[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += Math.floor((a + b) / 2);
      else if (filter === 4) value += paeth(a, b, c);
      out[x] = value & 0xff;
    }
  }
  return { width, height, pixels };
}

const pixelAt = (image, x, y) => {
  const offset = (y * image.width + x) * 4;
  return [image.pixels[offset], image.pixels[offset + 1], image.pixels[offset + 2], image.pixels[offset + 3]];
};
const hexAt = (image, x, y) =>
  `#${pixelAt(image, x, y)
    .slice(0, 3)
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`;
const hexToRgb = (hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/* ------------------------------------------------- 1. structure + dimensions */

const decoded = new Map();
for (const icon of ICONS) {
  const file = `assets/icons/${icon.file}`;
  ok(existsSync(path.join(root, file)), `${file} exists`);
  const image = decodePng(readBytes(file));
  check(image.width, icon.size, `${file}: IHDR width is the declared size`);
  check(image.height, icon.size, `${file}: IHDR height is the declared size`);
  check(pixelAt(image, 0, 0)[3], 255, `${file}: fully opaque (launchers composite it)`);
  decoded.set(icon.file, image);
}

/* ------------------------------------------ 2. committed pixels == generator */

for (const icon of ICONS) {
  const expected = render(icon.size, { scale: icon.purpose === "maskable" ? 0.8 : 1 });
  check(
    decoded.get(icon.file).pixels.equals(expected),
    true,
    `assets/icons/${icon.file}: pixels match tools/make-icons.mjs exactly`,
  );
}

/* ------------------------------------------- 3. colours are the site's tokens */

const css = read(PALETTE_SOURCE);
ok(css.includes(`--lime: ${COLORS.lime}`), `palette token --lime still ${COLORS.lime}`);
ok(css.includes(`--line: ${COLORS.line}`), `palette token --line still ${COLORS.line}`);
ok(css.includes(`--tension-max: ${COLORS.alert}`), `palette token --tension-max still ${COLORS.alert}`);
ok(/\.loaded-page\s*\{[^}]*background:\s*#0e1415/.test(css), "page background still #0e1415");

/** Sample the icon at a point given in the drawing's own [0,1] unit space. */
const sample = (image, ux, uy) =>
  hexAt(image, Math.floor(ux * image.width), Math.floor(uy * image.width));

const icon = decoded.get("icon-512.png");
check(sample(icon, 0.02, 0.02), COLORS.bg, "corner pixel is the page background");
check(
  sample(icon, 0.5 + R_INFIELD, 0.5),
  COLORS.lime,
  "first base is the brand lime",
);
check(
  sample(icon, 0.5, 0.5),
  mix(COLORS.bg, COLORS.lime, DIRT_BLEND),
  "infield interior is the dirt blend of the same two tokens",
);
check(
  sample(icon, 0.6555, 0.3445),
  mix(COLORS.bg, COLORS.lime, OUTLINE_BLEND),
  "infield outline ring is the line blend of the same two tokens",
);
check(
  sample(icon, 0.5, 0.5 + R_INFIELD),
  COLORS.ink,
  "home plate is the page's ink colour",
);
// A base must still resolve at the smallest shipped size.
const small = decoded.get("icon-192.png");
check(
  sample(small, 0.5 + R_INFIELD, 0.5),
  COLORS.lime,
  "first base still resolves at 192px",
);

/* ----------------------------------------------- 4. maskable keeps a safe zone */

for (const size of [192, 512]) {
  const maskable = decoded.get(`maskable-${size}.png`);
  const any = decoded.get(`icon-${size}.png`);
  // The centre of second base: solid artwork in the full-bleed variant, and
  // pushed outside the visible art (into background) once the maskable safe
  // zone shrinks everything by 20%.
  check(
    sample(any, 0.5, 0.5 - R_INFIELD),
    COLORS.lime,
    `icon-${size}: second base centre is artwork (full-bleed variant)`,
  );
  check(
    sample(maskable, 0.5, 0.5 - R_INFIELD),
    COLORS.bg,
    `maskable-${size}: that same point is background (art pulled inside the safe zone)`,
  );
  check(
    sample(maskable, 0.5, 0.5),
    mix(COLORS.bg, COLORS.lime, DIRT_BLEND),
    `maskable-${size}: the artwork itself survives the shrink`,
  );
  // Everything outside the middle 80% must be flat background.
  const edge = Math.floor(size * 0.1);
  for (const [x, y] of [
    [edge, edge],
    [size - 1 - edge, edge],
    [edge, size - 1 - edge],
    [size - 1 - edge, size - 1 - edge],
  ])
    check(hexAt(maskable, x, y), COLORS.bg, `maskable-${size}: corner (${x},${y}) is background`);
}

/* ------------------------------------------------------------- 5. the manifest */

const manifest = JSON.parse(read("manifest.webmanifest"));
check(manifest.short_name, "Loaded Late", "manifest short_name");
ok(typeof manifest.name === "string" && manifest.name.length > 10, "manifest has a full name");
ok(typeof manifest.description === "string" && manifest.description.length > 20, "manifest has a description");
check(manifest.display, "standalone", "manifest opens without browser chrome");
check(manifest.background_color, COLORS.bg, "manifest background matches the page background");
check(manifest.theme_color, COLORS.bg, "manifest theme colour matches the page background");
ok(!manifest.start_url.startsWith("/"), "manifest start_url is relative (works under a Pages subpath)");
ok(!manifest.scope.startsWith("/"), "manifest scope is relative");
ok(!manifest.id.startsWith("/"), "manifest id is relative");
for (const target of [manifest.start_url.replace(/^\.\//, ""), manifest.scope || "./"]) {
  const clean = target.replace(/\/$/, "") || ".";
  ok(
    clean === "." || existsSync(path.join(root, clean)),
    `manifest start/scope target resolves (${clean})`,
  );
}
const sizesSeen = new Set();
for (const entry of manifest.icons) {
  ok(!entry.src.startsWith("/"), `manifest icon path is relative (${entry.src})`);
  ok(existsSync(path.join(root, entry.src)), `manifest icon exists (${entry.src})`);
  const image = decodePng(readBytes(entry.src));
  const [w, h] = entry.sizes.split("x").map(Number);
  check(image.width, w, `manifest icon ${entry.src} width matches its declared sizes`);
  check(image.height, h, `manifest icon ${entry.src} height matches its declared sizes`);
  check(entry.type, "image/png", `manifest icon ${entry.src} declares image/png`);
  ok(["any", "maskable"].includes(entry.purpose), `manifest icon ${entry.src} purpose is known`);
  sizesSeen.add(`${entry.sizes}:${entry.purpose}`);
}
for (const required of ["192x192:any", "512x512:any", "192x192:maskable", "512x512:maskable"])
  ok(sizesSeen.has(required), `manifest ships the required ${required} icon`);

/* --------------------------------------------------- 6. every page is wired up */

const pages = [
  "index.html",
  "bases-loaded.html",
  "verification.html",
  "scoreboard.html",
  "reviews.html",
  "game.html",
  "404.html",
];
for (const page of pages) {
  const html = read(page);
  ok(/<link rel="manifest" href="manifest\.webmanifest" \/>/.test(html), `${page} links the manifest relatively`);
  ok(/<link rel="icon" type="image\/svg\+xml" href="assets\/icons\/favicon\.svg" \/>/.test(html), `${page} links the SVG favicon relatively`);
  ok(/<link rel="apple-touch-icon" href="assets\/icons\/apple-touch-icon\.png" \/>/.test(html), `${page} links the iOS touch icon relatively`);
  ok(/<meta name="theme-color" content="#0e1415" \/>/.test(html), `${page} declares the theme colour`);
  ok(/<meta name="apple-mobile-web-app-capable" content="yes" \/>/.test(html), `${page} opts into iOS standalone`);
  ok(/<meta name="mobile-web-app-capable" content="yes" \/>/.test(html), `${page} opts into standalone (current name)`);
  ok(/<meta name="apple-mobile-web-app-title" content="Loaded Late" \/>/.test(html), `${page} sets the iOS home-screen title`);
}
check(read("index.html"), read("bases-loaded.html"), "the two monitor entrypoints stay identical");

/* --------------------------------- 7. the service worker buzz matches the rules */

const core = read("assets/js/bases-loaded-core.js");
const corePattern = core.match(/vibratePattern = Object\.freeze\((\[[0-9,\s]*\])\)/);
ok(corePattern, "core exports a frozen vibrate pattern");
const sw = read("sw.js");
const swPattern = sw.match(/vibrate: (\[[0-9,\s]*\])/);
ok(swPattern, "the service worker declares a vibrate pattern");
check(JSON.parse(swPattern[1]), JSON.parse(corePattern[1]), "sw.js buzz === BasesLoadedRules.vibratePattern");
const pattern = JSON.parse(corePattern[1]);
ok(pattern.every((ms) => Number.isInteger(ms) && ms > 0), "every buzz step is a positive whole millisecond");
// sw.js icon paths must be relative to its scope, not root-absolute.
for (const name of ["icon", "badge"]) {
  const match = sw.match(new RegExp(`${name}: "([^"]+)"`));
  ok(match && !match[1].startsWith("/"), `sw.js ${name} path is relative to its scope`);
  ok(match && existsSync(path.join(root, match[1])), `sw.js ${name} file exists (${match[1]})`);
}

/* --------------------------------------- 8. the dev server serves the manifest */

const server = read("server.mjs");
ok(/'\.webmanifest':\s*'application\/manifest\+json'/.test(server), "server.mjs maps .webmanifest to the manifest MIME type");

/* ------------------------------------------------------ SVG favicon sanity */

const svg = read("assets/icons/favicon.svg");
ok(svg.startsWith("<svg "), "favicon.svg is an SVG document");
ok(svg.includes(COLORS.lime), "favicon.svg uses the brand lime");
ok(svg.includes(COLORS.bg), "favicon.svg uses the page background");
check((svg.match(/fill="#cfef78"/g) || []).length, 3, "favicon.svg draws exactly three bases");

/* --------------------------------------------------------------- the report */

// Colour math must round-trip: mixing a colour with itself changes nothing.
check(mix("#0e1415", "#0e1415", 0.5), "#0e1415", "mix() is idempotent for identical colours");
check(hexToRgb(COLORS.lime), [207, 239, 120], "the brand lime token decodes as expected");

console.log(`✓ ${checks} installability and icon checks passed`);
