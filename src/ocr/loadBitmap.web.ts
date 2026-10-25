/**
 * Versão **web** de `loadBitmap`: no navegador dá para ler os pixels direto do
 * canvas, então não é preciso passar por PNG/base64.
 *
 * O Metro resolve este arquivo no lugar de `loadBitmap.ts` quando o alvo é web.
 */
import type { Bitmap } from './recognize';

const MAX_WIDTH = 1000;

function loadImage(uri: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('não foi possível abrir a imagem'));
    image.src = uri;
  });
}

export async function loadBitmap(uri: string): Promise<Bitmap> {
  const image = await loadImage(uri);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) throw new Error('imagem sem dimensões');

  const scale = Math.min(1, MAX_WIDTH / sourceWidth);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('canvas indisponível neste navegador');

  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;

  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i += 1) {
    const r = pixels[i * 4];
    const g = pixels[i * 4 + 1];
    const b = pixels[i * 4 + 2];
    const alpha = pixels[i * 4 + 3] / 255;
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    // Fundo transparente conta como papel, não como tinta.
    gray[i] = Math.max(0, Math.min(255, Math.round(luminance * alpha + 255 * (1 - alpha))));
  }

  return { width, height, gray };
}
