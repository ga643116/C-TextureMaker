/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const ADLER_MOD = 65521;
const CRC_TABLE = new Uint32Array(256);

for (let i = 0; i < CRC_TABLE.length; i++) {
  let value = i;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  CRC_TABLE[i] = value >>> 0;
}

function writeU32BE(target, offset, value) {
  target[offset] = (value >>> 24) & 255;
  target[offset + 1] = (value >>> 16) & 255;
  target[offset + 2] = (value >>> 8) & 255;
  target[offset + 3] = value & 255;
}

function crc32(type, data) {
  let crc = 0xffffffff;
  for (let i = 0; i < 4; i++) crc = CRC_TABLE[(crc ^ type.charCodeAt(i)) & 255] ^ (crc >>> 8);
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const chunk = new Uint8Array(data.length + 12);
  writeU32BE(chunk, 0, data.length);
  for (let i = 0; i < 4; i++) chunk[4 + i] = type.charCodeAt(i);
  chunk.set(data, 8);
  writeU32BE(chunk, chunk.length - 4, crc32(type, data));
  return chunk;
}

function adler32(data) {
  let a = 1;
  let b = 0;
  for (let start = 0; start < data.length; start += 5552) {
    const end = Math.min(data.length, start + 5552);
    for (let i = start; i < end; i++) {
      a += data[i];
      b += a;
    }
    a %= ADLER_MOD;
    b %= ADLER_MOD;
  }
  return ((b << 16) | a) >>> 0;
}

function zlibStored(data) {
  const blockCount = Math.ceil(data.length / 65535);
  const result = new Uint8Array(2 + data.length + blockCount * 5 + 4);
  result[0] = 0x78;
  result[1] = 0x01;
  let inputOffset = 0;
  let outputOffset = 2;

  while (inputOffset < data.length) {
    const length = Math.min(65535, data.length - inputOffset);
    const finalBlock = inputOffset + length === data.length;
    result[outputOffset++] = finalBlock ? 1 : 0;
    result[outputOffset++] = length & 255;
    result[outputOffset++] = (length >>> 8) & 255;
    const inverse = (~length) & 0xffff;
    result[outputOffset++] = inverse & 255;
    result[outputOffset++] = (inverse >>> 8) & 255;
    result.set(data.subarray(inputOffset, inputOffset + length), outputOffset);
    inputOffset += length;
    outputOffset += length;
  }

  writeU32BE(result, outputOffset, adler32(data));
  return result;
}

function base64(bytes) {
  const parts = [];
  let part = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const first = bytes[i];
    const hasSecond = i + 1 < bytes.length;
    const hasThird = i + 2 < bytes.length;
    const second = hasSecond ? bytes[i + 1] : 0;
    const third = hasThird ? bytes[i + 2] : 0;
    part += BASE64[first >>> 2];
    part += BASE64[((first & 3) << 4) | (second >>> 4)];
    part += hasSecond ? BASE64[((second & 15) << 2) | (third >>> 6)] : '=';
    part += hasThird ? BASE64[third & 63] : '=';
    if (part.length >= 32768) {
      parts.push(part);
      part = '';
    }
  }
  if (part) parts.push(part);
  return parts.join('');
}

/** Encode black RGB pixels with the supplied alpha as a browser-safe PNG data URL. */
export function encodeAlphaPNG(alpha, width, height) {
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new TypeError('PNG dimensions must be positive integers');
  }
  if (!(alpha instanceof Uint8Array) || alpha.length !== width * height) {
    throw new TypeError(`Alpha data must contain exactly ${width * height} bytes`);
  }

  const rowBytes = width * 4 + 1;
  const raw = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    let offset = y * rowBytes;
    raw[offset++] = 0;
    const pixelOffset = y * width;
    for (let x = 0; x < width; x++) {
      raw[offset++] = 0;
      raw[offset++] = 0;
      raw[offset++] = 0;
      raw[offset++] = alpha[pixelOffset + x];
    }
  }

  const ihdr = new Uint8Array(13);
  writeU32BE(ihdr, 0, width);
  writeU32BE(ihdr, 4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlibStored(raw);
  const ihdrChunk = pngChunk('IHDR', ihdr);
  const idatChunk = pngChunk('IDAT', idat);
  const iendChunk = pngChunk('IEND', new Uint8Array(0));
  const png = new Uint8Array(PNG_SIGNATURE.length + ihdrChunk.length + idatChunk.length + iendChunk.length);
  let offset = 0;
  for (const part of [PNG_SIGNATURE, ihdrChunk, idatChunk, iendChunk]) {
    png.set(part, offset);
    offset += part.length;
  }
  return `data:image/png;base64,${base64(png)}`;
}
