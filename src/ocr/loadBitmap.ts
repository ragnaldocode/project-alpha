/**
 * Converte a foto escolhida pelo cliente em um bitmap de tons de cinza.
 *
 * Esta é a versão **nativa** (iOS/Android): não existe API de pixels crus no
 * React Native, então o caminho é reduzir a foto, salvar como PNG em base64
 * (via expo-image-manipulator) e decodificar o PNG em JS. A redução acontece
 * já na decodificação (`maxWidth`), o que evita carregar uma foto de 12 MP na
 * memória — em celular isso é a diferença entre funcionar e estourar memória.
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { decodePngBase64 } from './png';
import type { Bitmap } from './recognize';

/**
 * Largura máxima de trabalho. O tabuleiro precisa de ~55 px por célula para ser
 * lido com folga; em 1000 px a célula fica com ~110 px — margem confortável sem
 * gastar tempo/memória com a resolução total da câmera.
 */
const MAX_WIDTH = 1000;

export async function loadBitmap(uri: string): Promise<Bitmap> {
  const context = ImageManipulator.manipulate(uri, { maxWidth: MAX_WIDTH });
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ base64: true, compress: 1, format: SaveFormat.PNG });

  if (!saved.base64) throw new Error('a imagem não pôde ser convertida para PNG');
  return decodePngBase64(saved.base64);
}
