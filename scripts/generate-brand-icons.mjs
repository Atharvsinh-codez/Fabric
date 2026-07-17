import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

const root = process.cwd();
const sourcePath = path.join(root, "public", "brand", "fabric-app-icon.svg");
const publicIconDirectory = path.join(root, "public", "icons");
const source = await readFile(sourcePath);

await mkdir(publicIconDirectory, { recursive: true });

async function renderPng(size, outputPath) {
  await sharp(source).resize(size, size).png({ compressionLevel: 9 }).toFile(outputPath);
}

await Promise.all([
  renderPng(64, path.join(root, "app", "icon.png")),
  renderPng(180, path.join(root, "app", "apple-icon.png")),
  renderPng(192, path.join(publicIconDirectory, "fabric-icon-192.png")),
  renderPng(512, path.join(publicIconDirectory, "fabric-icon-512.png")),
  renderPng(512, path.join(publicIconDirectory, "fabric-maskable-512.png")),
]);

const faviconPng = await sharp(source).resize(32, 32).png().toBuffer();
const icoHeader = Buffer.alloc(22);
icoHeader.writeUInt16LE(0, 0);
icoHeader.writeUInt16LE(1, 2);
icoHeader.writeUInt16LE(1, 4);
icoHeader.writeUInt8(32, 6);
icoHeader.writeUInt8(32, 7);
icoHeader.writeUInt16LE(0, 8);
icoHeader.writeUInt16LE(1, 10);
icoHeader.writeUInt16LE(32, 12);
icoHeader.writeUInt32LE(faviconPng.length, 14);
icoHeader.writeUInt32LE(22, 18);

await writeFile(path.join(root, "app", "favicon.ico"), Buffer.concat([icoHeader, faviconPng]));
