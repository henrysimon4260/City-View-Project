import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = resolve(root, "public/panorama");
mkdirSync(dir, { recursive: true });

function writePng(path, width, height, pixel) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixel(x, y, width, height);
      const i = row + 1 + x * 3;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunk = (type, data) => {
    const head = Buffer.from(type);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head, data])) >>> 0, 0);
    return Buffer.concat([length, head, data, crc]);
  };
  writeFileSync(path, Buffer.concat([signature, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

const table = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  table[n] = c;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

function mix(a, b, t) {
  return a.map((channel, index) => Math.round(channel + (b[index] - channel) * t));
}

function skyWater(x, y, width, height, water, land) {
  const t = y / (height - 1);
  const horizon = 0.46;
  if (t < horizon) {
    const u = t / horizon;
    return mix([186, 214, 232], [232, 220, 196], u * 0.85 + (x / width) * 0.05);
  }
  const u = (t - horizon) / (1 - horizon);
  const wave = Math.sin(x * 0.08 + y * 0.2) * 0.04;
  const color = mix(water, land, Math.max(0, u - 0.72));
  return color.map((channel) => Math.max(0, Math.min(255, Math.round(channel + wave * 30))));
}

const size = 512;
writePng(resolve(dir, "south.png"), size, size, (x, y, w, h) =>
  skyWater(x, y, w, h, [74, 116, 140], [92, 104, 86]),
);
writePng(resolve(dir, "east.png"), size, size, (x, y, w, h) =>
  skyWater(x, y, w, h, [68, 122, 132], [110, 116, 96]),
);
writePng(resolve(dir, "west.png"), size, size, (x, y, w, h) =>
  skyWater(x, y, w, h, [86, 118, 138], [120, 112, 100]),
);
writePng(resolve(dir, "sky.png"), size, size, (x, y, w, h) => {
  const u = y / (h - 1);
  return mix([126, 176, 214], [214, 206, 186], u);
});
writePng(resolve(dir, "north.png"), size, size, (x, y, w, h) => {
  const base = skyWater(x, y, w, h, [150, 146, 132], [120, 110, 98]);
  const horizon = Math.floor(h * 0.46);
  const band = y > horizon - 70 && y < horizon + 8;
  const tower = band && (x % 47 < 18 || x % 83 < 10);
  return tower ? [78, 74, 70] : base;
});

console.log("Wrote illustrative panorama cards.");
