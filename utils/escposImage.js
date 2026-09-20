// Logo ko thermal printer ke liye (black & white dots) convert karta hai.
// Koi extra npm package nahi chahiye - PNG khud decode hota hai (zlib se).
//
// Logo file: backend/assets/logos/cafe.png (PNG hi chalega, non-interlaced).
// Simple, high-contrast logo sabse acha print hota hai.
import fs from "fs";
import zlib from "zlib";

// ---------------------------------------------------------------- PNG decode
export const decodePng = (buf) => {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length < 8 || !sig.every((b, i) => buf[i] === b)) throw new Error("Not a PNG file");

  let pos = 8;
  let width = 0, height = 0, bitDepth = 8, colorType = 6, interlace = 0;
  let palette = null, trns = null;
  const idat = [];

  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "PLTE") palette = data;
    else if (type === "tRNS") trns = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (interlace) throw new Error("Interlaced PNG not supported - save logo as non-interlaced PNG");

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`Unsupported PNG color type ${colorType}`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bitsPerPixel = channels * bitDepth;
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const rowBytes = Math.ceil((width * bitsPerPixel) / 8);
  const pix = Buffer.alloc(rowBytes * height);

  // Unfilter each scanline
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (rowBytes + 1)];
    const src = y * (rowBytes + 1) + 1;
    const dst = y * rowBytes;
    for (let x = 0; x < rowBytes; x++) {
      const a = x >= bpp ? pix[dst + x - bpp] : 0;
      const b = y > 0 ? pix[dst - rowBytes + x] : 0;
      const c = x >= bpp && y > 0 ? pix[dst - rowBytes + x - bpp] : 0;
      let v = raw[src + x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      pix[dst + x] = v & 0xff;
    }
  }

  // Sample reader (handles 1/2/4/8/16 bit)
  const maxVal = (1 << Math.min(bitDepth, 8)) - 1;
  const sample = (y, idx) => {
    const base = y * rowBytes;
    if (bitDepth === 8) return pix[base + idx];
    if (bitDepth === 16) return pix[base + idx * 2]; // high byte
    const bitPos = idx * bitDepth;
    const byte = pix[base + (bitPos >> 3)];
    return (byte >> (8 - bitDepth - (bitPos & 7))) & maxVal;
  };

  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r, g, b, a = 255;
      if (colorType === 6) {
        r = sample(y, x * 4); g = sample(y, x * 4 + 1); b = sample(y, x * 4 + 2); a = sample(y, x * 4 + 3);
      } else if (colorType === 2) {
        r = sample(y, x * 3); g = sample(y, x * 3 + 1); b = sample(y, x * 3 + 2);
      } else if (colorType === 4) {
        r = g = b = sample(y, x * 2); a = sample(y, x * 2 + 1);
      } else if (colorType === 0) {
        const s = sample(y, x);
        r = g = b = bitDepth < 8 ? Math.round((s * 255) / maxVal) : s;
      } else {
        const i = sample(y, x);
        r = palette[i * 3]; g = palette[i * 3 + 1]; b = palette[i * 3 + 2];
        if (trns && i < trns.length) a = trns[i];
      }
      const o = (y * width + x) * 4;
      data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = a;
    }
  }
  return { width, height, data };
};

// ------------------------------------------------------- RGBA -> ESC/POS
// Returns Buffer of GS v 0 raster commands (strips of 128 rows), centered on a
// paper `paperDots` wide (58mm printers = 384 dots).
export const rasterFromRGBA = ({ width, height, data }, { maxWidth = 240, paperDots = 384, threshold = 140 } = {}) => {
  const tw = Math.max(1, Math.min(maxWidth, width, paperDots));
  const th = Math.max(1, Math.round((height * tw) / width));
  const bytesPerRow = paperDots >> 3;
  const left = Math.floor((paperDots - tw) / 2);
  const bitmap = Buffer.alloc(bytesPerRow * th); // 0 = white

  for (let ty = 0; ty < th; ty++) {
    const sy0 = Math.floor((ty * height) / th);
    const sy1 = Math.max(sy0 + 1, Math.floor(((ty + 1) * height) / th));
    for (let tx = 0; tx < tw; tx++) {
      const sx0 = Math.floor((tx * width) / tw);
      const sx1 = Math.max(sx0 + 1, Math.floor(((tx + 1) * width) / tw));
      let sum = 0, n = 0;
      for (let sy = sy0; sy < sy1 && sy < height; sy++) {
        for (let sx = sx0; sx < sx1 && sx < width; sx++) {
          const o = (sy * width + sx) * 4;
          const alpha = data[o + 3] / 255;
          const lum = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
          sum += lum * alpha + 255 * (1 - alpha); // transparent = white
          n++;
        }
      }
      if (n && sum / n < threshold) {
        const col = left + tx;
        bitmap[ty * bytesPerRow + (col >> 3)] |= 0x80 >> (col & 7);
      }
    }
  }

  const chunks = [];
  const STRIP = 128;
  for (let y0 = 0; y0 < th; y0 += STRIP) {
    const rows = Math.min(STRIP, th - y0);
    chunks.push(Buffer.from([0x1d, 0x76, 0x30, 0x00, bytesPerRow & 0xff, bytesPerRow >> 8, rows & 0xff, rows >> 8]));
    chunks.push(bitmap.subarray(y0 * bytesPerRow, (y0 + rows) * bytesPerRow));
  }
  return Buffer.concat(chunks);
};

// ------------------------------------------------------------- file loader
const cache = new Map();
const warned = new Set();

// Logo file nahi hai / kharab hai to null (receipt bina logo ke print hogi).
export const loadLogoRaster = async (filePath, opts) => {
  try {
    if (!fs.existsSync(filePath)) return null;
    const key = `${filePath}:${fs.statSync(filePath).mtimeMs}:${opts?.maxWidth || ""}`;
    if (cache.has(key)) return cache.get(key);
    const raster = rasterFromRGBA(decodePng(fs.readFileSync(filePath)), opts);
    cache.set(key, raster);
    return raster;
  } catch (err) {
    if (!warned.has(filePath)) {
      warned.add(filePath);
      console.warn(`[receipt] Logo skip kiya (${filePath}): ${err.message}`);
    }
    return null;
  }
};
