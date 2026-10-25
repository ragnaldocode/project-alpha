/**
 * Decodificador PNG mínimo → bitmap em tons de cinza.
 *
 * Necessário no caminho nativo: `expo-image-manipulator` entrega PNG em
 * base64, e não existe API de pixels crus no React Native. Suportamos o
 * subconjunto que o próprio sistema produz (8 bits, sem entrelaçamento,
 * RGB/RGBA/cinza), que é exatamente o que o manipulador devolve.
 *
 * Só depende de `fflate` (inflate em JS puro — compatível com Hermes).
 */
import { unzlibSync } from 'fflate';

export interface GrayBitmap {
  width: number;
  height: number;
  gray: Uint8Array;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Converte os bytes de um PNG em tons de cinza (0 = preto, 255 = branco). */
export function decodePng(bytes: Uint8Array): GrayBitmap {
  for (let i = 0; i < SIGNATURE.length; i += 1) {
    if (bytes[i] !== SIGNATURE[i]) throw new Error('não é um PNG válido');
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat: Uint8Array[] = [];

  while (offset + 8 <= bytes.length) {
    const length =
      ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    );
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > bytes.length) throw new Error('PNG truncado');

    if (type === 'IHDR') {
      width = ((bytes[dataStart] << 24) | (bytes[dataStart + 1] << 16) | (bytes[dataStart + 2] << 8) | bytes[dataStart + 3]) >>> 0;
      height = ((bytes[dataStart + 4] << 24) | (bytes[dataStart + 5] << 16) | (bytes[dataStart + 6] << 8) | bytes[dataStart + 7]) >>> 0;
      bitDepth = bytes[dataStart + 8];
      colorType = bytes[dataStart + 9];
      interlace = bytes[dataStart + 12];
    } else if (type === 'IDAT') {
      idat.push(bytes.subarray(dataStart, dataEnd));
    } else if (type === 'IEND') {
      break;
    }

    offset = dataEnd + 4; // + CRC
  }

  if (!width || !height) throw new Error('PNG sem cabeçalho IHDR');
  if (bitDepth !== 8) throw new Error(`PNG com ${bitDepth} bits por canal não suportado`);
  if (interlace !== 0) throw new Error('PNG entrelaçado não suportado');

  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 6 ? 4 : 0;
  if (channels === 0) throw new Error(`tipo de cor PNG ${colorType} não suportado`);

  let compressedLength = 0;
  for (const chunk of idat) compressedLength += chunk.length;
  const compressed = new Uint8Array(compressedLength);
  let cursor = 0;
  for (const chunk of idat) {
    compressed.set(chunk, cursor);
    cursor += chunk.length;
  }

  const raw = unzlibSync(compressed);
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) throw new Error('dados PNG incompletos');

  const pixels = new Uint8Array(stride * height);
  let previous = new Uint8Array(stride);
  let position = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = raw[position];
    position += 1;
    const row = raw.subarray(position, position + stride);
    position += stride;
    const out = new Uint8Array(stride);

    for (let i = 0; i < stride; i += 1) {
      const left = i >= channels ? out[i - channels] : 0;
      const up = previous[i];
      const upLeft = i >= channels ? previous[i - channels] : 0;
      const value = row[i];
      let restored: number;
      switch (filter) {
        case 0:
          restored = value;
          break;
        case 1:
          restored = value + left;
          break;
        case 2:
          restored = value + up;
          break;
        case 3:
          restored = value + ((left + up) >> 1);
          break;
        case 4:
          restored = value + paeth(left, up, upLeft);
          break;
        default:
          throw new Error(`filtro PNG ${filter} desconhecido`);
      }
      out[i] = restored & 0xff;
    }

    pixels.set(out, y * stride);
    previous = out;
  }

  // Compõe sobre branco (fotos com transparência não devem virar tinta).
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const base = i * channels;
    let luminance: number;
    if (channels <= 2) {
      luminance = pixels[base];
      if (channels === 2) {
        const alpha = pixels[base + 1] / 255;
        luminance = luminance * alpha + 255 * (1 - alpha);
      }
    } else {
      const r = pixels[base];
      const g = pixels[base + 1];
      const b = pixels[base + 2];
      luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      if (channels === 4) {
        const alpha = pixels[base + 3] / 255;
        luminance = luminance * alpha + 255 * (1 - alpha);
      }
    }
    gray[i] = Math.max(0, Math.min(255, Math.round(luminance)));
  }

  return { width, height, gray };
}

/** Decodifica um PNG em base64 (formato devolvido por expo-image-manipulator). */
export function decodePngBase64(base64: string): GrayBitmap {
  const cleaned = base64.replace(/^data:image\/png;base64,/, '').replace(/\s/g, '');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Int16Array(128).fill(-1);
  for (let i = 0; i < alphabet.length; i += 1) lookup[alphabet.charCodeAt(i)] = i;

  let length = cleaned.length;
  while (length > 0 && cleaned[length - 1] === '=') length -= 1;
  const bytes = new Uint8Array(Math.floor((length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let offset = 0;
  for (let i = 0; i < length; i += 1) {
    const value = lookup[cleaned.charCodeAt(i)];
    if (value < 0) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[offset] = (buffer >> bits) & 0xff;
      offset += 1;
    }
  }
  return decodePng(bytes.subarray(0, offset));
}
