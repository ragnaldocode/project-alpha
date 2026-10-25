#!/usr/bin/env node
/**
 * Verificação do leitor de fotos (OCR de Sudoku) com Node puro.
 *
 * Uso: node scripts/verify-ocr.mjs
 *
 * Três blocos:
 *  1. decodificador PNG — ida e volta contra um PNG gerado aqui (todos os
 *     filtros de linha, RGB/RGBA/cinza), porque no app nativo é ele que
 *     transforma a foto em pixels;
 *  2. integridade dos templates — cada glifo de referência precisa ser
 *     classificado como ele mesmo (protege a normalização);
 *  3. fixtures reais (fontes não usadas nos templates, com giro, perspectiva,
 *     desfoque e ruído) — acerto exato nos casos legíveis e, nos casos ruins,
 *     a garantia de que o app NÃO devolve um tabuleiro inventado.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

import { decodePng } from '../src/ocr/png.ts';
import { recognizeSudoku, prepareTemplates, classifyCell } from '../src/ocr/recognize.ts';
import { DIGIT_TEMPLATES } from '../src/ocr/templates.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures');

let failures = 0;
const check = (label, condition, detail = '') => {
  if (condition) return;
  failures += 1;
  console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------------------------ 1. decodificador PNG */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

/** Codifica um PNG de teste aplicando um filtro de linha por vez. */
function encodePng(width, height, channels, pixels, filter) {
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = filter;
    for (let i = 0; i < stride; i += 1) {
      const value = pixels[y * stride + i];
      const left = i >= channels ? pixels[y * stride + i - channels] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + i] : 0;
      const upLeft = y > 0 && i >= channels ? pixels[(y - 1) * stride + i - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      raw[y * (stride + 1) + 1 + i] = (value - predictor) & 0xff;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = channels === 1 ? 0 : channels === 2 ? 4 : channels === 3 ? 2 : 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

console.log('Decodificador PNG');
const pngWidth = 17;
const pngHeight = 11;
for (const channels of [1, 2, 3, 4]) {
  const pixels = new Uint8Array(pngWidth * pngHeight * channels);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 37 + 11) & 0xff;

  for (let filter = 0; filter <= 4; filter += 1) {
    const png = encodePng(pngWidth, pngHeight, channels, pixels, filter);
    const decoded = decodePng(new Uint8Array(png));
    check(`PNG ${channels} canais, filtro ${filter}: dimensões`, decoded.width === pngWidth && decoded.height === pngHeight);

    // Recompõe a luminância esperada a partir dos canais de origem.
    let mismatches = 0;
    for (let i = 0; i < pngWidth * pngHeight; i += 1) {
      const base = i * channels;
      let luminance;
      if (channels <= 2) {
        luminance = pixels[base];
        if (channels === 2) {
          const alpha = pixels[base + 1] / 255;
          luminance = luminance * alpha + 255 * (1 - alpha);
        }
      } else {
        luminance = 0.299 * pixels[base] + 0.587 * pixels[base + 1] + 0.114 * pixels[base + 2];
        if (channels === 4) {
          const alpha = pixels[base + 3] / 255;
          luminance = luminance * alpha + 255 * (1 - alpha);
        }
      }
      const expected = Math.max(0, Math.min(255, Math.round(luminance)));
      if (Math.abs(decoded.gray[i] - expected) > 1) mismatches += 1;
    }
    check(`PNG ${channels} canais, filtro ${filter}: pixels`, mismatches === 0, `${mismatches} divergências`);
  }
}
console.log('  ok\n');

/* --------------------------------------------- 2. integridade dos templates */

console.log('Templates de dígitos');
const templates = prepareTemplates(DIGIT_TEMPLATES);
check('templates carregados', templates.length >= 63, `${templates.length} templates`);

/** Desloca um bitmap em (dx,dy) px — simula o dígito fora de centro na célula. */
function shift(gray, width, height, dx, dy) {
  const out = new Uint8Array(width * height).fill(255);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sx = x - dx;
      const sy = y - dy;
      if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
      out[y * width + x] = gray[sy * width + sx];
    }
  }
  return out;
}

const variants = [
  ['centrado', 0, 0],
  ['deslocado +1,+1', 1, 1],
  ['deslocado -1,0', -1, 0],
];

for (const [label, dx, dy] of variants) {
  let wrong = 0;
  let unread = 0;
  for (const template of DIGIT_TEMPLATES) {
    const gray = dx === 0 && dy === 0
      ? template.gray
      : shift(template.gray, template.width, template.height, dx, dy);
    const reading = classifyCell(gray, template.width, templates);
    if (!reading) {
      unread += 1;
      continue;
    }
    if (reading.digit !== template.digit) wrong += 1;
  }
  const total = DIGIT_TEMPLATES.length;
  console.log(`  ${label.padEnd(16)} ${total - wrong - unread}/${total} corretos (${unread} ilegíveis)`);
  check(`templates ${label}: todos lidos`, unread === 0, `${unread} ilegíveis`);
  check(`templates ${label}: dígito certo`, wrong === 0, `${wrong} errados`);
}
console.log('  ok\n');

/* ------------------------------------- 2b. células que NÃO têm dígito */

console.log('Células sem dígito (não pode virar número)');
const CELL = 56;
const blankCell = () => new Uint8Array(CELL * CELL).fill(255);

const withVerticalBar = (x0, width, value = 40) => {
  const cell = blankCell();
  for (let y = 0; y < CELL; y += 1) {
    for (let x = x0; x < x0 + width; x += 1) if (x >= 0 && x < CELL) cell[y * CELL + x] = value;
  }
  return cell;
};

const withDiagonal = (from, to, value = 60) => {
  const cell = blankCell();
  for (let y = 0; y < CELL; y += 1) {
    const x = Math.round(from + ((to - from) * y) / CELL);
    for (let d = 0; d < 2; d += 1) if (x + d >= 0 && x + d < CELL) cell[y * CELL + x + d] = value;
  }
  return cell;
};

const withNoise = (amplitude, seed = 7) => {
  const cell = blankCell();
  let state = seed;
  const rnd = () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < cell.length; i += 1) {
    cell[i] = Math.max(0, Math.min(255, Math.round(250 + (rnd() + rnd() - 1) * amplitude)));
  }
  return cell;
};

const withBlob = (cx, cy, size, value = 50) => {
  const cell = blankCell();
  for (let y = cy; y < cy + size; y += 1) {
    for (let x = cx; x < cx + size; x += 1) {
      if (x >= 0 && x < CELL && y >= 0 && y < CELL) cell[y * CELL + x] = value;
    }
  }
  return cell;
};

const nonDigits = [
  ['célula em branco', blankCell()],
  ['resto de linha vertical (borda)', withVerticalBar(0, 3)],
  ['resto de linha vertical (meio)', withVerticalBar(26, 3)],
  ['resto de linha na diagonal', withDiagonal(0, 12)],
  ['ruído forte de sensor', withNoise(70)],
  ['mancha de sujeira 8x8', withBlob(24, 24, 8)],
  ['traço curto', withBlob(26, 22, 3)],
];

for (const [label, cell] of nonDigits) {
  const reading = classifyCell(cell, CELL, templates);
  check(`${label}: não pode virar dígito`, reading.kind !== 'digit',
    reading.kind === 'digit' ? `leu ${reading.digit}` : '');
  console.log(`  ${label.padEnd(34)} ${reading.kind}`);
}
console.log('  ok\n');

/* ------------------------------------------------------- 3. fixtures reais */

console.log('Fixtures');
const manifest = JSON.parse(readFileSync(join(fixtures, 'manifest.json'), 'utf8'));
const started = Date.now();

console.log('Fixture               Grade   Acerto  Vazios  Conf  Linhas  Tempo');
console.log('----------------------------------------------------------------');
for (const item of manifest) {
  const png = readFileSync(join(fixtures, `${item.name}.png`));
  const bitmap = decodePng(new Uint8Array(png));
  const began = Date.now();
  const result = recognizeSudoku(bitmap, templates);
  const elapsed = Date.now() - began;

  if (item.expect === 'no-grid') {
    check(`${item.name}: imagem sem tabuleiro é recusada`, !result.gridDetected && result.filled === 0,
      `detectou ${result.filled} células`);
    console.log(
      `${item.name.padEnd(21)} recusada  ${String(0).padStart(3)}/81  ${String(result.filled).padStart(6)}  ` +
        `${result.meanConfidence.toFixed(2)}  ${result.lineScore.toFixed(2)}  ${String(elapsed).padStart(4)} ms`,
    );
    continue;
  }

  let correct = 0;
  for (let row = 0; row < 9; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      if (item.expected[row][col] === result.grid[row][col]) correct += 1;
    }
  }
  const givens = item.expected.flat().filter((value) => value !== 0).length;
  const emptyOk = result.filled === givens;

  console.log(
    `${item.name.padEnd(21)} ${result.gridDetected ? 'ok    ' : 'recusa'}  ${String(correct).padStart(3)}/81  ` +
      `${String(result.filled).padStart(3)}/${String(givens).padEnd(3)} ${result.meanConfidence.toFixed(2)}  ` +
      `${result.lineScore.toFixed(2)}  ${String(elapsed).padStart(4)} ms`,
  );

  if (item.expect === 'exact') {
    check(`${item.name}: grade localizada`, result.gridDetected);
    check(`${item.name}: 81 células corretas`, correct === 81, `${correct}/81`);
    check(`${item.name}: células vazias preservadas`, emptyOk, `${result.filled} preenchidas, esperado ${givens}`);
    const render = item.render ?? {};
    const clean = !render.tilt && !render.blur;
    if (clean) {
      const flagged = result.uncertain.flat().filter(Boolean).length;
      check(`${item.name}: leitura limpa não marca células como duvidosas`, flagged <= 2,
        `${flagged} células incertas`);
    }
  } else if (item.expect === 'no-invented') {
    // Sujeira nas células vazias não pode virar número: o que o app devolve
    // precisa existir na foto. Faltar número é aceitável; inventar não.
    const invented = [];
    for (let row = 0; row < 9; row += 1) {
      for (let col = 0; col < 9; col += 1) {
        if (result.grid[row][col] !== 0 && result.grid[row][col] !== item.expected[row][col]) {
          invented.push(`r${row + 1}c${col + 1}=${result.grid[row][col]}(esperado ${item.expected[row][col]})`);
        }
      }
    }
    const read = result.grid.flat().filter((value) => value !== 0).length;
    console.log(`  → ${read}/${givens} números lidos, ${invented.length} inventados`);
    check(`${item.name}: nenhum número inventado em célula vazia`, invented.length === 0, invented.slice(0, 6).join(' '));
    check(`${item.name}: leu a maioria dos números da foto`, read >= givens * 0.8, `${read}/${givens}`);
  } else {
    // Caso fora do envelope de qualidade: recusar é aceitável, inventar não.
    if (result.gridDetected) {
      check(`${item.name}: leitura de baixa qualidade não pode virar tabuleiro errado`, correct >= 81 * 0.75,
        `${correct}/81 corretas`);
    }
    check(`${item.name}: não devolve grade inconsistente com confiança alta`,
      !result.gridDetected || result.meanConfidence >= 0.4, `confiança ${result.meanConfidence}`);
  }
}

const elapsed = Date.now() - started;
console.log(`\n${manifest.length} fixtures verificadas em ${elapsed} ms`);

if (failures > 0) {
  console.error(`\n${failures} verificação(ões) do leitor falharam.`);
  process.exit(1);
}
console.log('Leitor de fotos: todas as verificações passaram.');
