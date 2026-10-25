#!/usr/bin/env node
/**
 * Gera `src/ocr/templates.ts` a partir do JSON rasterizado no navegador.
 *
 * Uso: node scripts/generate-templates.mjs /caminho/ocr-templates.json
 *
 * O JSON é produzido renderizando cada dígito (1–9) em canvas, num conjunto de
 * fontes/pesos, recortando a caixa de tinta e reduzindo para 24×24. Os
 * templates compartilham a mesma moldura usada por `normalizeGlyph` em
 * src/ocr/recognize.ts (glifo dentro de 20×20 com 2px de margem), por isso
 * não podem ser regerados com outro tamanho sem ajustar aquele módulo.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const input = process.argv[2];
if (!input) {
  console.error('uso: node scripts/generate-templates.mjs <templates.json>');
  process.exit(1);
}

const templates = JSON.parse(readFileSync(input, 'utf8'));
const rows = templates.map(
  (t) =>
    `  { digit: ${t.digit}, label: ${JSON.stringify(t.label)}, width: ${t.width}, height: ${t.height}, aspect: ${t.aspect}, gray: decodeBase64('${t.b64}') },`,
);

const source = `/**
 * Templates de dígitos usados pelo leitor de fotos (src/ocr/recognize.ts).
 *
 * GERADO AUTOMATICAMENTE — não editar à mão.
 * Regenerar: renderizar os dígitos 1–9 em canvas com as fontes desejadas,
 * recortar a caixa de tinta e reduzir para ${templates[0]?.width ?? 24}×${templates[0]?.height ?? 24}, e então
 * rodar \`node scripts/generate-templates.mjs <json>\`.
 *
 * As fontes escolhidas cobrem o que aparece em Sudoku impresso e em telas
 * (grotescas sem serifa modernas) em peso normal e negrito.
 */

export interface DigitTemplateData {
  digit: number;
  /** Fonte e peso — apenas informativo/depuração. */
  label: string;
  width: number;
  height: number;
  /** largura/altura do glifo antes da redução. */
  aspect: number;
  gray: Uint8Array;
}

/** Decodificador base64 próprio: Hermes/RN não garante \`atob\` global. */
function decodeBase64(input: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Int16Array(128).fill(-1);
  for (let i = 0; i < alphabet.length; i += 1) lookup[alphabet.charCodeAt(i)] = i;

  let length = input.length;
  while (length > 0 && input[length - 1] === '=') length -= 1;
  const out = new Uint8Array(Math.floor((length * 3) / 4));

  let buffer = 0;
  let bits = 0;
  let offset = 0;
  for (let i = 0; i < length; i += 1) {
    const value = lookup[input.charCodeAt(i)];
    if (value < 0) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[offset] = (buffer >> bits) & 0xff;
      offset += 1;
    }
  }
  return out.subarray(0, offset);
}

export const DIGIT_TEMPLATES: DigitTemplateData[] = [
${rows.join('\n')}
];
`;

writeFileSync('src/ocr/templates.ts', source);
console.log(`src/ocr/templates.ts escrito com ${templates.length} templates.`);
