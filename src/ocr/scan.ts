/**
 * Serviço do leitor de fotos: foto → grade 9×9 + confiança por célula.
 *
 * Junta as três peças: carregar a imagem (por plataforma), reconhecer e montar
 * o tabuleiro jogável. O trabalho pesado é puro (src/ocr/recognize.ts) e está
 * coberto por `npm run verify:ocr`.
 */
import { loadBitmap } from './loadBitmap';
import { prepareTemplates, recognizeSudoku, type ScanResult } from './recognize';
import { DIGIT_TEMPLATES } from './templates';

/** Os templates são preparados uma única vez (conversão de 72 glifos). */
let cachedTemplates: ReturnType<typeof prepareTemplates> | null = null;

function templates(): ReturnType<typeof prepareTemplates> {
  if (!cachedTemplates) cachedTemplates = prepareTemplates(DIGIT_TEMPLATES);
  return cachedTemplates;
}

export type { ScanResult };

/** Lê o tabuleiro de uma imagem (file://, content://, data: ou blob:). */
export async function scanSudokuImage(uri: string): Promise<ScanResult> {
  const bitmap = await loadBitmap(uri);
  return recognizeSudoku(bitmap, templates());
}
