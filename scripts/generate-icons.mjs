// Generates the SCDMS app icons in public/ from one geometric definition, with no dependencies.
// Run: node scripts/generate-icons.mjs
//
// The mark is the same as the in-app logo: a brand -> accent gradient tile with a white "S".
// The "S" is drawn as two round-capped arcs so the raster icons and favicon.svg match exactly,
// whatever fonts the device has.
import { writeFileSync } from "node:fs";
import { deflateSync, crc32 } from "node:zlib";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const OUT = join(fileURLToPath(new URL("..", import.meta.url)), "public");

const BRAND = [0x4f, 0x46, 0xe5]; // --color-brand
const ACCENT = [0x38, 0xbd, 0xf8]; // --color-accent
const SIZE = 512;
const RADIUS = 112; // tile corner radius
const STROKE = 48;
const R = 76;
// Upper arc: centre (256,180), from -20deg sweeping back through the top to the bottom (90deg).
// Lower arc: centre (256,332), from its top (-90deg) through the right and bottom to 160deg.
const ARCS = [
  { cx: 256, cy: 180, start: -270, sweep: 250 },
  { cx: 256, cy: 332, start: -90, sweep: 250 },
];

const rad = (d) => (d * Math.PI) / 180;
const pt = (a, deg) => [a.cx + R * Math.cos(rad(deg)), a.cy + R * Math.sin(rad(deg))];
const f = (n) => Number(n.toFixed(2));

function svg({ rounded = true } = {}) {
  const [x0, y0] = pt(ARCS[0], ARCS[0].start + ARCS[0].sweep); // -20deg
  const [x2, y2] = pt(ARCS[1], ARCS[1].start + ARCS[1].sweep); // 160deg
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">
  <title>SCDMS</title>
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4f46e5"/>
      <stop offset="1" stop-color="#38bdf8"/>
    </linearGradient>
  </defs>
  <rect width="${SIZE}" height="${SIZE}" rx="${rounded ? RADIUS : 0}" fill="url(#g)"/>
  <path d="M${f(x0)} ${f(y0)}A${R} ${R} 0 1 0 256 256A${R} ${R} 0 1 1 ${f(x2)} ${f(y2)}" fill="none" stroke="#fff" stroke-width="${STROKE}" stroke-linecap="round"/>
</svg>
`;
}

function arcDistance(x, y, a) {
  const dx = x - a.cx;
  const dy = y - a.cy;
  let t = ((Math.atan2(dy, dx) * 180) / Math.PI - a.start) % 360;
  if (t < 0) t += 360;
  if (t <= a.sweep) return Math.abs(Math.hypot(dx, dy) - R);
  const [ax, ay] = pt(a, a.start);
  const [bx, by] = pt(a, a.start + a.sweep);
  return Math.min(Math.hypot(x - ax, y - ay), Math.hypot(x - bx, y - by));
}

function insideTile(x, y, radius) {
  const qx = Math.max(radius - x, x - (SIZE - radius), 0);
  const qy = Math.max(radius - y, y - (SIZE - radius), 0);
  return qx * qx + qy * qy <= radius * radius;
}

function render(px, { rounded = true } = {}) {
  const ss = 4; // 4x4 supersampling for smooth edges
  const scale = SIZE / px;
  const radius = rounded ? RADIUS : 0;
  const rgba = Buffer.alloc(px * px * 4);
  for (let j = 0; j < px; j++) {
    for (let i = 0; i < px; i++) {
      let r = 0, g = 0, b = 0, cover = 0;
      for (let sj = 0; sj < ss; sj++) {
        for (let si = 0; si < ss; si++) {
          const x = (i + (si + 0.5) / ss) * scale;
          const y = (j + (sj + 0.5) / ss) * scale;
          if (radius && !insideTile(x, y, radius)) continue;
          const onS = ARCS.some((a) => arcDistance(x, y, a) <= STROKE / 2);
          const t = (x + y) / (2 * SIZE);
          const c = onS ? [255, 255, 255] : BRAND.map((v, k) => v + (ACCENT[k] - v) * t);
          r += c[0]; g += c[1]; b += c[2]; cover++;
        }
      }
      const o = (j * px + i) * 4;
      if (cover) {
        rgba[o] = Math.round(r / cover);
        rgba[o + 1] = Math.round(g / cover);
        rgba[o + 2] = Math.round(b / cover);
      }
      rgba[o + 3] = Math.round((cover / (ss * ss)) * 255);
    }
  }
  return png(px, rgba);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(px, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(px, 0);
  ihdr.writeUInt32BE(px, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const rows = Buffer.alloc(px * (px * 4 + 1));
  for (let y = 0; y < px; y++) rgba.copy(rows, y * (px * 4 + 1) + 1, y * px * 4, (y + 1) * px * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ICO with PNG-compressed entries (supported by every current browser and Windows Vista+).
function ico(sizes) {
  const images = sizes.map((s) => render(s));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map((img, k) => {
    const e = Buffer.alloc(16);
    e[0] = sizes[k] >= 256 ? 0 : sizes[k];
    e[1] = sizes[k] >= 256 ? 0 : sizes[k];
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(img.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += img.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...images]);
}

const manifest = {
  name: "SCDMS — School Conduct & Discipline Management",
  short_name: "SCDMS",
  icons: [
    { src: "/icon-192.png?v=2", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icon-512.png?v=2", sizes: "512x512", type: "image/png", purpose: "any" },
  ],
  start_url: "/",
  display: "standalone",
  theme_color: "#4f46e5",
  background_color: "#ffffff",
};

writeFileSync(join(OUT, "favicon.svg"), svg());
writeFileSync(join(OUT, "favicon.ico"), ico([16, 32, 48]));
// iOS applies its own rounded mask, so the touch icon is a full-bleed square.
writeFileSync(join(OUT, "apple-touch-icon.png"), render(180, { rounded: false }));
writeFileSync(join(OUT, "icon-192.png"), render(192));
writeFileSync(join(OUT, "icon-512.png"), render(512));
writeFileSync(join(OUT, "site.webmanifest"), JSON.stringify(manifest, null, 2) + "\n");
console.log("Icons written to", OUT);
