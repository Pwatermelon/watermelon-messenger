#!/usr/bin/env node
/**
 * Экспорт favicon.ico из apps/web/public/icon-32.png (оригинальный арбуз).
 * Usage: node scripts/export-favicon-ico.mjs
 */
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "apps/web/public");
const icon32 = join(publicDir, "icon-32.png");
const pngBuffer = readFileSync(icon32);
const size = 32;

function pngToIco(pngBuffer, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);

  const entry = Buffer.alloc(16);
  entry[0] = size >= 256 ? 0 : size;
  entry[1] = size >= 256 ? 0 : size;
  entry[2] = 0;
  entry[3] = 0;
  entry[4] = 1;
  entry[5] = 0;
  entry[6] = 32;
  entry[7] = 0;
  entry.writeUInt32LE(pngBuffer.length, 8);
  entry.writeUInt32LE(22, 12);

  return Buffer.concat([header, entry, pngBuffer]);
}

const out = join(publicDir, "favicon.ico");
writeFileSync(out, pngToIco(pngBuffer, size));
console.log("wrote favicon.ico from icon-32.png");
