import { writeFileSync } from "node:fs";
import { deflateSync, crc32 } from "node:zlib";

const BG = [15, 18, 22];
const ORB = [124, 196, 255];

function chunk(type, data) {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "ascii");
    data.copy(out, 8);
    out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
    return out;
}

function icon(size) {
    const rows = [];
    const r = size * 0.32;
    for (let y = 0; y < size; y++) {
        const row = Buffer.alloc(1 + size * 3);
        for (let x = 0; x < size; x++) {
            const d = Math.hypot(x - size / 2, y - size / 2);
            const k = Math.min(1, Math.max(0, r - d + 0.5)) * (0.75 + 0.25 * (1 - d / r));
            for (let c = 0; c < 3; c++) row[1 + x * 3 + c] = Math.round(BG[c] + (ORB[c] - BG[c]) * k);
        }
        rows.push(row);
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(size, 0);
    header.writeUInt32BE(size, 4);
    header[8] = 8;
    header[9] = 2;
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", header),
        chunk("IDAT", deflateSync(Buffer.concat(rows))),
        chunk("IEND", Buffer.alloc(0)),
    ]);
}

for (const size of [192, 512]) writeFileSync(`public/phone/icon-${size}.png`, icon(size));
console.log("wrote public/phone/icon-192.png and icon-512.png");
