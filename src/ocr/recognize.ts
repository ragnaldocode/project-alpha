/**
 * Reconhecimento de tabuleiro de Sudoku a partir de uma foto.
 *
 * Este módulo é intencionalmente autocontido (sem imports) para poder ser
 * executado direto pelo Node nas verificações: `node scripts/verify-ocr.mjs`.
 * Os templates de dígitos são injetados pelo chamador (`recognizeSudoku`) para
 * manter essa independência.
 *
 * Pipeline:
 *   1. limiar adaptativo por célula  → máscara de tinta
 *   2. detecção das 10 linhas da grade (perfis de projeção + espaçamento)
 *   3. por célula: remoção de ruído, densidade (vazia?), bbox do glifo
 *   4. normalização do glifo para 24×24 e comparação com os templates
 *   5. confiança por célula + sinalização de conflitos
 *
 * A saída é sempre "melhor esforço": o app mostra o tabuleiro lido e o cliente
 * corrige o que estiver errado antes de começar a jogar.
 */

export const GRID_SIZE = 9;

/** Imagem em tons de cinza: 0 = preto, 255 = branco. */
export interface Bitmap {
  width: number;
  height: number;
  gray: Uint8Array;
}

/** Glifo de referência já rasterizado (24×24 por convenção). */
export interface DigitTemplate {
  digit: number;
  /** Rótulo livre (fonte/peso) — só para depuração. */
  label: string;
  width: number;
  height: number;
  gray: Uint8Array;
  /** largura/altura do glifo antes da normalização. */
  aspect: number;
}

export interface ScanResult {
  /** 9×9; 0 = célula vazia. */
  grid: number[][];
  /** 0..1 por célula. */
  confidence: number[][];
  /** Célula que o leitor não tem certeza (deve ser conferida pelo cliente). */
  uncertain: boolean[][];
  /** A grade de 9×9 foi localizada pelas linhas da imagem. */
  gridDetected: boolean;
  /** Posição das 10 linhas verticais/horizontais no centro da imagem (px). */
  lines: { xs: number[]; ys: number[] };
  /** Quantas células foram lidas como não vazias. */
  filled: number;
  /** Média da confiança das células preenchidas. */
  meanConfidence: number;
  /** Menor fração de tinta entre as 20 linhas — mede a confiança da grade. */
  lineScore: number;
}

export interface RecognizeOptions {
  /** Densidade mínima de tinta para considerar a célula preenchida (0..1). */
  minInk?: number;
  /** Abaixo disso a célula é marcada como incerta. */
  minConfidence?: number;
}

/** Lado do bitmap normalizado — deve casar com o dos templates gerados. */
const OUT = 24;
const PAD = 2;
const INNER = OUT - PAD * 2;

export function createEmptyGrid(): number[][] {
  return Array.from({ length: GRID_SIZE }, () => Array<number>(GRID_SIZE).fill(0));
}

/* ------------------------------------------------------------------ limiar */

/** Limiar de Otsu global (usado como referência e para medir contraste). */
function otsuThreshold(gray: Uint8Array): number {
  const histogram = new Array<number>(256).fill(0);
  for (let i = 0; i < gray.length; i += 1) histogram[gray[i]] += 1;

  const total = gray.length;
  let sum = 0;
  for (let v = 0; v < 256; v += 1) sum += v * histogram[v];

  let sumB = 0;
  let weightB = 0;
  let best = 0;
  let bestVariance = -1;

  for (let v = 0; v < 256; v += 1) {
    weightB += histogram[v];
    if (weightB === 0) continue;
    const weightF = total - weightB;
    if (weightF === 0) break;
    sumB += v * histogram[v];
    const meanB = sumB / weightB;
    const meanF = (sum - sumB) / weightF;
    const variance = weightB * weightF * (meanB - meanF) * (meanB - meanF);
    if (variance > bestVariance) {
      bestVariance = variance;
      best = v;
    }
  }
  return best;
}

interface Region {
  gray: Uint8Array;
  width: number;
  height: number;
}

/**
 * Máscara de tinta de uma região com limiar local: o Sudoku é impresso em
 * papel claro, então o próprio contraste da célula separa dígito de fundo —
 * o que sobrevive a fotos com sombra/iluminação irregular, onde um limiar
 * global falha.
 */
function inkMask(region: Region): { mask: Uint8Array; contrast: number } {
  const { gray, width, height } = region;
  const mask = new Uint8Array(width * height);
  let min = 255;
  let max = 0;
  for (let i = 0; i < gray.length; i += 1) {
    const v = gray[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const contrast = max - min;
  if (contrast < 40) return { mask, contrast };

  // Otsu restrito à faixa da célula (mais estável que a média simples).
  const histogram = new Array<number>(256).fill(0);
  for (let i = 0; i < gray.length; i += 1) histogram[gray[i]] += 1;
  const total = gray.length;
  let sum = 0;
  for (let v = 0; v < 256; v += 1) sum += v * histogram[v];
  let sumB = 0;
  let weightB = 0;
  let threshold = (min + max) / 2;
  let bestVariance = -1;
  for (let v = 0; v < 256; v += 1) {
    weightB += histogram[v];
    if (weightB === 0) continue;
    const weightF = total - weightB;
    if (weightF === 0) break;
    sumB += v * histogram[v];
    const meanB = sumB / weightB;
    const meanF = (sum - sumB) / weightF;
    const variance = weightB * weightF * (meanB - meanF) * (meanB - meanF);
    if (variance > bestVariance) {
      bestVariance = variance;
      threshold = v;
    }
  }

  // Nunca acima do ponto médio da faixa: evita transformar fundo em tinta.
  const limit = Math.min(threshold, (min + max) / 2);
  for (let i = 0; i < gray.length; i += 1) {
    mask[i] = gray[i] <= limit ? 1 : 0;
  }
  return { mask, contrast };
}

/**
 * Remove componentes conexos pequenos (ruído, restos de linha da grade).
 * Mantém apenas o componente dominante e os que tiverem ao menos `keepRatio`
 * da área dele — o dígito normalmente é um único componente, com o miolo do
 * 4/5/7 eventualmente separado.
 */
function dominantComponents(
  mask: Uint8Array,
  width: number,
  height: number,
  keepRatio = 0.12,
): Uint8Array {
  const labels = new Int32Array(width * height);
  const stack = new Int32Array(width * height);
  const sizes: number[] = [0];
  let next = 1;

  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] === 0 || labels[start] !== 0) continue;
    let top = 0;
    stack[top] = start;
    top += 1;
    labels[start] = next;
    let size = 0;
    while (top > 0) {
      top -= 1;
      const index = stack[top];
      size += 1;
      const x = index % width;
      const y = (index - x) / width;
      if (x > 0) {
        const n = index - 1;
        if (mask[n] === 1 && labels[n] === 0) {
          labels[n] = next;
          stack[top] = n;
          top += 1;
        }
      }
      if (x < width - 1) {
        const n = index + 1;
        if (mask[n] === 1 && labels[n] === 0) {
          labels[n] = next;
          stack[top] = n;
          top += 1;
        }
      }
      if (y > 0) {
        const n = index - width;
        if (mask[n] === 1 && labels[n] === 0) {
          labels[n] = next;
          stack[top] = n;
          top += 1;
        }
      }
      if (y < height - 1) {
        const n = index + width;
        if (mask[n] === 1 && labels[n] === 0) {
          labels[n] = next;
          stack[top] = n;
          top += 1;
        }
      }
    }
    sizes.push(size);
    next += 1;
  }

  if (next === 1) return new Uint8Array(width * height);

  let largest = 0;
  for (let i = 1; i < sizes.length; i += 1) if (sizes[i] > largest) largest = sizes[i];
  const minSize = Math.max(6, largest * keepRatio);

  const out = new Uint8Array(width * height);
  for (let i = 0; i < labels.length; i += 1) {
    const label = labels[i];
    if (label !== 0 && sizes[label] >= minSize) out[i] = 1;
  }
  return out;
}

/**
 * Conta buracos (regiões de fundo fechadas) — separa dígitos com o mesmo
 * contorno grosseiro: 8 tem 2 buracos, 0/6/9 têm 1, os demais nenhum.
 */
function countHoles(mask: Uint8Array, width: number, height: number): number {
  const outside = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);

  const push = (index: number, top: number): number => {
    if (mask[index] === 0 && outside[index] === 0) {
      outside[index] = 1;
      stack[top] = index;
      return top + 1;
    }
    return top;
  };

  let top = 0;
  for (let x = 0; x < width; x += 1) {
    top = push(x, top);
    top = push((height - 1) * width + x, top);
  }
  for (let y = 0; y < height; y += 1) {
    top = push(y * width, top);
    top = push(y * width + width - 1, top);
  }

  while (top > 0) {
    top -= 1;
    const index = stack[top];
    const x = index % width;
    const y = (index - x) / width;
    if (x > 0) top = push(index - 1, top);
    if (x < width - 1) top = push(index + 1, top);
    if (y > 0) top = push(index - width, top);
    if (y < height - 1) top = push(index + width, top);
  }

  let holes = 0;
  const seen = new Uint8Array(width * height);
  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] !== 0 || outside[start] !== 0 || seen[start] !== 0) continue;
    holes += 1;
    let stackTop = 0;
    stack[stackTop] = start;
    stackTop += 1;
    seen[start] = 1;
    while (stackTop > 0) {
      stackTop -= 1;
      const index = stack[stackTop];
      const x = index % width;
      const y = (index - x) / width;
      const expand = (n: number): void => {
        if (mask[n] === 0 && outside[n] === 0 && seen[n] === 0) {
          seen[n] = 1;
          stack[stackTop] = n;
          stackTop += 1;
        }
      };
      if (x > 0) expand(index - 1);
      if (x < width - 1) expand(index + 1);
      if (y > 0) expand(index - width);
      if (y < height - 1) expand(index + width);
    }
  }
  return holes;
}

/**
 * Normaliza o glifo para OUT×OUT com a mesma moldura usada na geração dos
 * templates: o glifo é escalado para caber em INNER×INNER e centralizado.
 */
function normalizeGlyph(
  mask: Uint8Array,
  width: number,
  bbox: { x0: number; y0: number; x1: number; y1: number },
): Float32Array {
  const out = new Float32Array(OUT * OUT);
  const bw = bbox.x1 - bbox.x0 + 1;
  const bh = bbox.y1 - bbox.y0 + 1;
  if (bw <= 0 || bh <= 0) return out;

  const scaleX = INNER / bw;
  const scaleY = INNER / bh;

  for (let oy = 0; oy < INNER; oy += 1) {
    const sy0 = bbox.y0 + (oy * bh) / INNER;
    const sy1 = bbox.y0 + ((oy + 1) * bh) / INNER;
    for (let ox = 0; ox < INNER; ox += 1) {
      const sx0 = bbox.x0 + (ox * bw) / INNER;
      const sx1 = bbox.x0 + ((ox + 1) * bw) / INNER;
      let sum = 0;
      let count = 0;
      const yStart = Math.floor(sy0);
      const yEnd = Math.max(yStart + 1, Math.ceil(sy1));
      const xStart = Math.floor(sx0);
      const xEnd = Math.max(xStart + 1, Math.ceil(sx1));
      for (let sy = yStart; sy < yEnd; sy += 1) {
        if (sy < 0 || sy >= width) continue;
        for (let sx = xStart; sx < xEnd; sx += 1) {
          if (sx < 0 || sx >= width) continue;
          sum += mask[sy * width + sx];
          count += 1;
        }
      }
      out[(oy + PAD) * OUT + (ox + PAD)] = count > 0 ? sum / count : 0;
    }
  }
  void scaleX;
  void scaleY;
  return out;
}

/** Distância média absoluta entre dois bitmaps normalizados. */
function glyphDistance(a: Float32Array, b: Float32Array): number {
  let total = 0;
  for (let i = 0; i < a.length; i += 1) total += Math.abs(a[i] - b[i]);
  return total / a.length;
}

/** Converte um template rasterizado em vetor normalizado (uma vez por app). */
export function prepareTemplates(
  templates: DigitTemplate[],
): Array<{ digit: number; vector: Float32Array; holes: number; aspect: number }> {
  return templates.map((template) => {
    const vector = new Float32Array(OUT * OUT);
    for (let y = 0; y < template.height; y += 1) {
      for (let x = 0; x < template.width; x += 1) {
        if (y >= OUT || x >= OUT) continue;
        // Templates vêm com fundo branco (255) e glifo escuro.
        vector[y * OUT + x] = 1 - template.gray[y * template.width + x] / 255;
      }
    }
    const binary = new Uint8Array(template.width * template.height);
    for (let i = 0; i < template.gray.length; i += 1) {
      binary[i] = template.gray[i] < 140 ? 1 : 0;
    }
    const holes = countHoles(binary, template.width, template.height);
    return { digit: template.digit, vector, holes, aspect: template.aspect };
  });
}

/* --------------------------------------------------- detecção das linhas */

/**
 * Máscara de tinta para achar as linhas da grade, com limiar **adaptativo**
 * (fundo local estimado por média de caixa). Isso importa porque as linhas
 * finas do Sudoku são bem mais claras que os dígitos — um limiar global as
 * descarta — e porque fotos têm sombra/vinheta, onde o fundo escurece nas
 * bordas e um limiar global marcaria a página inteira como tinta.
 *
 * Um pixel é tinta quando é pelo menos ~4% (no mínimo 6 níveis) mais escuro que
 * a vizinhança: linhas finas desenhadas em posição sub-pixel viram duas linhas
 * de ~50% de intensidade, e um critério proporcional mais duro as perderia.
 */
function adaptiveInkMask(gray: Uint8Array, width: number, height: number): Uint8Array {
  const stride = width + 1;
  const integral = new Float64Array(stride * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      rowSum += gray[y * width + x];
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + rowSum;
    }
  }

  const radius = Math.max(6, Math.floor(Math.min(width, height) / 24));
  const mask = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      const area = (y1 - y0 + 1) * (x1 - x0 + 1);
      const sum =
        integral[(y1 + 1) * stride + x1 + 1] -
        integral[y0 * stride + x1 + 1] -
        integral[(y1 + 1) * stride + x0] +
        integral[y0 * stride + x0];
      const mean = sum / area;
      const delta = Math.max(6, mean * 0.04);
      mask[y * width + x] = gray[y * width + x] < mean - delta ? 1 : 0;
    }
  }
  return mask;
}

interface LineCandidates {
  centers: number[];
  strengths: number[];
}

/**
 * Candidatos a linha: posições onde existe uma sequência de tinta contínua
 * cobrindo boa parte da imagem. As linhas da grade atravessam o tabuleiro
 * inteiro; dígitos não.
 */
function findLineCandidates(
  mask: Uint8Array,
  width: number,
  height: number,
  axis: 'x' | 'y',
): LineCandidates {
  const along = axis === 'x' ? width : height;
  const across = axis === 'x' ? height : width;
  const reaches = new Int32Array(along);
  const coverage = new Int32Array(along);
  // Tolerância a falhas curtas: o cruzamento com a linha perpendicular escurece
  // a vizinhança e derruba alguns pixels da máscara adaptativa, então a linha
  // "some" por alguns px. Buracos de dígito são maiores e continuam fora.
  const gapTolerance = Math.max(3, Math.round(across * 0.014));

  for (let a = 0; a < along; a += 1) {
    let best = 0;
    let runStart = -1;
    let runEnd = -1;
    let gap = 0;
    let ink = 0;
    for (let b = 0; b < across; b += 1) {
      const index = axis === 'x' ? b * width + a : a * width + b;
      if (mask[index] === 1) {
        ink += 1;
        if (runStart < 0) runStart = b;
        runEnd = b;
        gap = 0;
      } else if (runStart >= 0) {
        gap += 1;
        if (gap > gapTolerance) {
          const length = runEnd - runStart + 1;
          if (length > best) best = length;
          runStart = -1;
          gap = 0;
        }
      }
    }
    if (runStart >= 0) {
      const length = runEnd - runStart + 1;
      if (length > best) best = length;
    }
    reaches[a] = best;
    coverage[a] = ink;
  }

  let maxReach = 0;
  for (let a = 0; a < along; a += 1) if (reaches[a] > maxReach) maxReach = reaches[a];
  if (maxReach < across * 0.3) return { centers: [], strengths: [] };

  const limit = Math.max(across * 0.4, maxReach * 0.7);
  // Uma linha da grade cobre a travessia inteira mesmo quando a máscara a
  // quebra em pedaços (linhas finas em posição sub-pixel): nesse caso o
  // critério é a cobertura total, não o trecho contínuo mais longo. Dígitos
  // numa mesma linha não passam de ~35% de cobertura.
  const coverageLimit = across * 0.72;
  const qualifies = (a: number): boolean => reaches[a] >= limit || coverage[a] >= coverageLimit;

  const centers: number[] = [];
  const strengths: number[] = [];

  let runStart = -1;
  let runBest = 0;
  let runSum = 0;
  let runCount = 0;
  for (let a = 0; a <= along; a += 1) {
    const ok = a < along ? qualifies(a) : false;
    if (ok) {
      if (runStart < 0) {
        runStart = a;
        runBest = 0;
        runSum = 0;
        runCount = 0;
      }
      if (reaches[a] > runBest) runBest = reaches[a];
      runSum += a;
      runCount += 1;
    } else if (runStart >= 0) {
      centers.push(runSum / runCount);
      strengths.push(runBest);
      runStart = -1;
    }
  }
  return { centers, strengths };
}

interface GridLines {
  lines: number[];
  /** Coeficiente de variação dos espaçamentos (menor = mais uniforme). */
  spread: number;
}

function gapsOf(lines: number[]): number[] {
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i += 1) gaps.push(lines[i] - lines[i - 1]);
  return gaps;
}

function spreadOf(gaps: number[]): number {
  if (gaps.length === 0) return Number.POSITIVE_INFINITY;
  const mean = gaps.reduce((total, g) => total + g, 0) / gaps.length;
  if (mean <= 0) return Number.POSITIVE_INFINITY;
  let total = 0;
  for (const gap of gaps) total += Math.abs(gap - mean) / mean;
  return total / gaps.length;
}

/**
 * Reduz os candidatos a exatamente 10 linhas: enquanto houver mais que 10,
 * funde o par adjacente mais próximo (halos e linhas duplas viram uma linha
 * só, em vez de deslocar a grade inteira).
 */
function mergeToLines(candidates: number[], expected: number): GridLines | null {
  if (candidates.length < expected) return null;
  let lines = [...candidates].sort((a, b) => a - b);

  while (lines.length > expected) {
    let bestIndex = 0;
    let bestGap = Number.POSITIVE_INFINITY;
    for (let i = 1; i < lines.length; i += 1) {
      const gap = lines[i] - lines[i - 1];
      if (gap < bestGap) {
        bestGap = gap;
        bestIndex = i;
      }
    }
    const merged = (lines[bestIndex] + lines[bestIndex - 1]) / 2;
    lines = [...lines.slice(0, bestIndex - 1), merged, ...lines.slice(bestIndex + 1)];
  }

  const gaps = gapsOf(lines);
  const mean = gaps.reduce((total, g) => total + g, 0) / gaps.length;
  if (mean < 8) return null;
  const spread = spreadOf(gaps);
  for (const gap of gaps) {
    if (Math.abs(gap - mean) / mean > 0.35) return null;
  }
  return { lines, spread };
}

/**
 * Caso comum em fotos: o cliente enquadra só o tabuleiro e a borda externa sai
 * do quadro. Nesse caso temos 8 linhas internas uniformes — as duas externas
 * são extrapoladas a partir do espaçamento.
 */
function fitInnerLines(candidates: number[], expected: number): GridLines | null {
  const internal = expected - 1;
  if (candidates.length < internal) return null;
  let best: GridLines | null = null;

  for (let start = 0; start + internal <= candidates.length; start += 1) {
    const window = candidates.slice(start, start + internal);
    const gaps = gapsOf(window);
    const mean = gaps.reduce((total, g) => total + g, 0) / gaps.length;
    if (mean < 8) continue;
    const spread = spreadOf(gaps);
    if (spread > 0.12) continue;
    let worst = 0;
    for (const gap of gaps) worst = Math.max(worst, Math.abs(gap - mean) / mean);
    if (worst > 0.25) continue;

    const lines = [window[0] - mean, ...window, window[window.length - 1] + mean];
    const finalGaps = gapsOf(lines);
    const finalSpread = spreadOf(finalGaps);
    if (!best || finalSpread < best.spread) best = { lines, spread: finalSpread };
  }
  return best;
}

/** Escolhe as 10 linhas da grade a partir dos candidatos. */
function pickLines(candidates: number[], expected = 10): GridLines | null {
  const merged = mergeToLines(candidates, expected);
  if (merged && merged.spread <= 0.16) return merged;

  const extrapolated = fitInnerLines(candidates, expected);
  if (extrapolated) return extrapolated;

  return merged && merged.spread <= 0.25 ? merged : null;
}

/* --------------------------------------------------------- correção de giro */

/**
 * Nitidez das projeções de tinta para um dado giro: linhas retas e alinhadas
 * concentram a tinta em poucas colunas/linhas, então a soma dos quadrados
 * atinge o máximo quando a grade fica em pé.
 */
function projectionSharpness(
  ink: Int32Array,
  count: number,
  width: number,
  height: number,
  cos: number,
  sin: number,
): number {
  const binsX = new Int32Array(width + height);
  const binsY = new Int32Array(width + height);
  const cx = width / 2;
  const cy = height / 2;
  const offset = Math.floor(height / 2);

  for (let i = 0; i < count; i += 1) {
    const x = ink[i * 2] - cx;
    const y = ink[i * 2 + 1] - cy;
    const rx = x * cos + y * sin + cx;
    const ry = -x * sin + y * cos + cy;
    const bx = Math.round(rx) + offset;
    const by = Math.round(ry) + offset;
    if (bx >= 0 && bx < binsX.length) binsX[bx] += 1;
    if (by >= 0 && by < binsY.length) binsY[by] += 1;
  }

  let score = 0;
  for (let i = 0; i < binsX.length; i += 1) score += binsX[i] * binsX[i] + binsY[i] * binsY[i];
  return score;
}

/**
 * Estima o giro (em graus) da grade. Varredura grossa de 0,5° e refinamento de
 * 0,1° — barato porque só percorre os pixels de tinta.
 */
function estimateSkew(
  mask: Uint8Array,
  width: number,
  height: number,
  maxDegrees = 8,
): number {
  const ink: number[] = [];
  for (let i = 0; i < mask.length; i += 1) {
    if (mask[i] === 1) ink.push(i % width, Math.floor(i / width));
  }
  const count = ink.length / 2;
  if (count < 50) return 0;
  const pixels = Int32Array.from(ink);

  const evaluate = (degrees: number): number => {
    const radians = (degrees * Math.PI) / 180;
    return projectionSharpness(pixels, count, width, height, Math.cos(radians), Math.sin(radians));
  };

  let best = 0;
  let bestScore = evaluate(0);
  for (let deg = -maxDegrees; deg <= maxDegrees; deg += 0.5) {
    const score = evaluate(deg);
    if (score > bestScore) {
      bestScore = score;
      best = deg;
    }
  }
  const coarse = best;
  for (let deg = coarse - 0.5; deg <= coarse + 0.5; deg += 0.1) {
    const score = evaluate(deg);
    if (score > bestScore) {
      bestScore = score;
      best = Math.round(deg * 10) / 10;
    }
  }
  return best;
}

/**
 * Rotaciona o bitmap em torno do centro (bilinear), preenchendo com papel.
 *
 * A saída é **maior** que a entrada quando necessário: girar um tabuleiro que
 * ocupa a imagem inteira cortaria as bordas, e são justamente as linhas
 * externas que dizem onde a grade começa e termina.
 */
function rotateBitmap(bitmap: Bitmap, degrees: number): Bitmap {
  const { width, height, gray } = bitmap;
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  const outWidth = Math.ceil(Math.abs(cos) * width + Math.abs(sin) * height);
  const outHeight = Math.ceil(Math.abs(sin) * width + Math.abs(cos) * height);
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const outCx = (outWidth - 1) / 2;
  const outCy = (outHeight - 1) / 2;
  const out = new Uint8Array(outWidth * outHeight);

  for (let y = 0; y < outHeight; y += 1) {
    for (let x = 0; x < outWidth; x += 1) {
      const dx = x - outCx;
      const dy = y - outCy;
      const sx = dx * cos + dy * sin + cx;
      const sy = -dx * sin + dy * cos + cy;

      if (sx < 0 || sy < 0 || sx >= width - 1 || sy >= height - 1) {
        out[y * outWidth + x] = 255;
        continue;
      }
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      const p00 = gray[y0 * width + x0];
      const p10 = gray[y0 * width + x0 + 1];
      const p01 = gray[(y0 + 1) * width + x0];
      const p11 = gray[(y0 + 1) * width + x0 + 1];
      const top = p00 + (p10 - p00) * fx;
      const bottom = p01 + (p11 - p01) * fx;
      out[y * outWidth + x] = Math.round(top + (bottom - top) * fy);
    }
  }
  return { width: outWidth, height: outHeight, gray: out };
}

/* ------------------------------------------------- ajuste fino das linhas */

/**
 * Uma linha da grade: posição no centro e inclinação (px por px).
 *
 * Ajustar inclinação **por linha** resolve de uma vez os dois defeitos que
 * mais aparecem em foto de celular: a foto torta (todas as linhas inclinadas)
 * e a perspectiva (linhas convergindo). Uma grade perfeita tem inclinação 0.
 */
interface GridLine {
  /** Posição (x para verticais, y para horizontais) na linha central. */
  offset: number;
  /** Variação da posição por unidade de eixo perpendicular. */
  slope: number;
}

/** Interseção entre uma linha vertical e uma horizontal. */
function intersect(vertical: GridLine, horizontal: GridLine, cx: number, cy: number): { x: number; y: number } {
  // Inclinações são pequenas; duas iterações de ponto fixo já convergem.
  let y = horizontal.offset;
  let x = vertical.offset + vertical.slope * (y - cy);
  for (let i = 0; i < 2; i += 1) {
    y = horizontal.offset + horizontal.slope * (x - cx);
    x = vertical.offset + vertical.slope * (y - cy);
  }
  return { x, y };
}

/** Fração de tinta ao longo de uma linha candidata (0..1). */
function lineScore(
  mask: Uint8Array,
  width: number,
  height: number,
  line: GridLine,
  axis: 'x' | 'y',
  cx: number,
  cy: number,
  from: number,
  to: number,
): number {
  let hits = 0;
  let samples = 0;
  const step = 2;
  for (let t = from; t < to; t += step) {
    let px: number;
    let py: number;
    if (axis === 'x') {
      py = t;
      px = line.offset + line.slope * (py - cy);
    } else {
      px = t;
      py = line.offset + line.slope * (px - cx);
    }
    const ix = Math.round(px);
    const iy = Math.round(py);
    samples += 1;
    if (ix < 0 || iy < 0 || ix >= width || iy >= height) continue;
    if (mask[iy * width + ix] === 1) hits += 1;
  }
  return samples > 0 ? hits / samples : 0;
}

/**
 * Dilata a máscara (filtro de máximo separável). A busca por linha usa a
 * máscara dilatada: assim uma candidata a poucos pixels da linha real já pontua
 * bem, e a busca grossa consegue "ver" linhas de 1 px em vez de só acertar por
 * sorte na posição exata.
 */
function dilateMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) return mask;
  const horizontal = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * width;
    for (let x = 0; x < width; x += 1) {
      let hit = 0;
      const from = Math.max(0, x - radius);
      const to = Math.min(width - 1, x + radius);
      for (let i = from; i <= to; i += 1) {
        if (mask[rowStart + i] === 1) {
          hit = 1;
          break;
        }
      }
      horizontal[rowStart + x] = hit;
    }
  }
  const out = new Uint8Array(mask.length);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      let hit = 0;
      const from = Math.max(0, y - radius);
      const to = Math.min(height - 1, y + radius);
      for (let i = from; i <= to; i += 1) {
        if (horizontal[i * width + x] === 1) {
          hit = 1;
          break;
        }
      }
      out[y * width + x] = hit;
    }
  }
  return out;
}

/**
 * Ajusta as 10 linhas de um eixo.
 *
 * Modelo: perspectiva faz as linhas convergirem para o centro, então a
 * inclinação de cada linha é proporcional à distância dela ao centro —
 * `slope = (offset - centro) * k / centro` — com **um único k** para o eixo.
 * Assim o ajuste tem 11 parâmetros (10 posições + 1 perspectiva) em vez de 20
 * independentes, e nenhuma linha pode "pular" para a faixa da vizinha.
 *
 * Depois do ajuste global, cada linha recebe um refino local pequeno (posição e
 * inclinação residual), suficiente para absorver a distorção da lente.
 */
function refineLines(
  mask: Uint8Array,
  width: number,
  height: number,
  initial: number[],
  axis: 'x' | 'y',
  extent: { start: number; end: number },
): { lines: GridLine[]; scores: number[]; perspective: number } {
  const along = axis === 'x' ? height : width;
  const cross = axis === 'x' ? width : height;
  const crossCenter = cross / 2;
  const cellSize = Math.abs(initial[initial.length - 1] - initial[0]) / (initial.length - 1);
  const span = { center: along / 2, extent: (extent.end - extent.start) * 0.98 };
  const cx = width / 2;
  const cy = height / 2;

  const scoreLine = (offset: number, k: number): number => {
    const line: GridLine = { offset, slope: ((offset - crossCenter) * k) / crossCenter };
    return lineScore(
      mask,
      width,
      height,
      line,
      axis,
      cx,
      cy,
      span.center - span.extent / 2,
      span.center + span.extent / 2,
    );
  };

  // Busca a perspectiva k que melhor explica o conjunto das 10 linhas.
  let bestK = 0;
  let bestKScore = -1;
  const offsetStep = cellSize * 0.075;
  const offsetRadius = cellSize * 0.42;

  for (let k = -0.18; k <= 0.181; k += 0.02) {
    let total = 0;
    for (const position of initial) {
      let lineBest = 0;
      for (let o = -offsetRadius; o <= offsetRadius; o += offsetStep) {
        const score = scoreLine(position + o, k);
        if (score > lineBest) lineBest = score;
      }
      total += lineBest;
    }
    if (total > bestKScore) {
      bestKScore = total;
      bestK = k;
    }
  }

  // Com k fixo: escolhe a posição de cada linha e depois refina localmente.
  const lines: GridLine[] = [];
  const scores: number[] = [];
  for (const position of initial) {
    let bestOffset = position;
    let bestScore = -1;
    for (let o = -offsetRadius; o <= offsetRadius; o += offsetStep) {
      const score = scoreLine(position + o, bestK);
      if (score > bestScore) {
        bestScore = score;
        bestOffset = position + o;
      }
    }

    let bestLine: GridLine = {
      offset: bestOffset,
      slope: ((bestOffset - crossCenter) * bestK) / crossCenter,
    };
    // Refino: ±0,06 célula e ±0,03 de inclinação residual.
    for (let o = -cellSize * 0.06; o <= cellSize * 0.061; o += cellSize * 0.015) {
      for (let s = -0.03; s <= 0.031; s += 0.01) {
        const candidate: GridLine = { offset: bestOffset + o, slope: bestLine.slope + s };
        const score = lineScore(
          mask,
          width,
          height,
          candidate,
          axis,
          cx,
          cy,
          span.center - span.extent / 2,
          span.center + span.extent / 2,
        );
        if (score > bestScore) {
          bestScore = score;
          bestLine = candidate;
        }
      }
    }

    lines.push(bestLine);
    scores.push(Math.round(bestScore * 100) / 100);
  }

  return { lines, scores, perspective: Math.round(bestK * 1000) / 1000 };
}

/**
 * Caixa da tinta por percentil — ignora ruído isolado nas bordas. Serve de
 * ponto de partida quando as linhas não aparecem no primeiro passe.
 */
function inkBounds(
  mask: Uint8Array,
  width: number,
  height: number,
): { x0: number; y0: number; x1: number; y1: number } | null {
  const rowTotals = new Int32Array(height);
  const colTotals = new Int32Array(width);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (mask[y * width + x] === 1) {
        rowTotals[y] += 1;
        colTotals[x] += 1;
      }
    }
  }
  let maxRow = 0;
  let maxCol = 0;
  for (let i = 0; i < height; i += 1) if (rowTotals[i] > maxRow) maxRow = rowTotals[i];
  for (let i = 0; i < width; i += 1) if (colTotals[i] > maxCol) maxCol = colTotals[i];
  if (maxRow === 0 || maxCol === 0) return null;

  const rowLimit = Math.max(1, maxRow * 0.08);
  const colLimit = Math.max(1, maxCol * 0.08);
  let y0 = 0;
  let y1 = height - 1;
  let x0 = 0;
  let x1 = width - 1;
  while (y0 < y1 && rowTotals[y0] < rowLimit) y0 += 1;
  while (y1 > y0 && rowTotals[y1] < rowLimit) y1 -= 1;
  while (x0 < x1 && colTotals[x0] < colLimit) x0 += 1;
  while (x1 > x0 && colTotals[x1] < colLimit) x1 -= 1;
  if (x1 - x0 < 40 || y1 - y0 < 40) return null;
  return { x0, y0, x1, y1 };
}

/**
 * Recorta uma célula quadrilátera (definida pelos 4 cantos) para um quadrado
 * SAMPLE×SAMPLE. A amostragem é bilinear dentro do quadrilátero, então células
 * deformadas por perspectiva voltam a ser retangulares antes da classificação.
 */
const SAMPLE = 56;

function sampleQuad(
  gray: Uint8Array,
  width: number,
  height: number,
  topLeft: { x: number; y: number },
  topRight: { x: number; y: number },
  bottomLeft: { x: number; y: number },
  bottomRight: { x: number; y: number },
  margin: number,
): Uint8Array {
  const out = new Uint8Array(SAMPLE * SAMPLE);
  for (let oy = 0; oy < SAMPLE; oy += 1) {
    const v = margin + ((oy + 0.5) / SAMPLE) * (1 - margin * 2);
    for (let ox = 0; ox < SAMPLE; ox += 1) {
      const u = margin + ((ox + 0.5) / SAMPLE) * (1 - margin * 2);
      const topX = topLeft.x + (topRight.x - topLeft.x) * u;
      const topY = topLeft.y + (topRight.y - topLeft.y) * u;
      const bottomX = bottomLeft.x + (bottomRight.x - bottomLeft.x) * u;
      const bottomY = bottomLeft.y + (bottomRight.y - bottomLeft.y) * u;
      const sx = topX + (bottomX - topX) * v;
      const sy = topY + (bottomY - topY) * v;

      if (sx < 0 || sy < 0 || sx >= width - 1 || sy >= height - 1) {
        out[oy * SAMPLE + ox] = 255;
        continue;
      }
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      const p00 = gray[y0 * width + x0];
      const p10 = gray[y0 * width + x0 + 1];
      const p01 = gray[(y0 + 1) * width + x0];
      const p11 = gray[(y0 + 1) * width + x0 + 1];
      const top = p00 + (p10 - p00) * fx;
      const bottom = p01 + (p11 - p01) * fx;
      out[oy * SAMPLE + ox] = Math.round(top + (bottom - top) * fy);
    }
  }
  return out;
}

/* --------------------------------------------------------- reconhecimento */

/** Resultado da leitura de uma única célula. */
/**
 * Leitura de uma célula:
 * - `digit`: um número foi reconhecido;
 * - `empty`: a célula está vazia;
 * - `unreadable`: há tinta, mas ela não parece um dígito confiável (resto de
 *   linha, mancha, número escrito à mão). A célula fica **vazia** no tabuleiro
 *   — inventar um número aqui seria pior do que deixar o cliente preencher.
 */
export type CellReading =
  | { kind: 'digit'; digit: number; confidence: number }
  | { kind: 'empty' }
  | { kind: 'unreadable'; confidence: number };

/**
 * Limites que separam dígito impresso de sujeira — medidos em 354 células
 * lidas corretamente nas fixtures (fontes fora dos templates, com giro,
 * perspectiva, desfoque, grão e vinheta) contra fragmentos de linha da grade:
 *
 *                dígitos reais        fragmentos/ruído
 *   score        ≤ 0,256              ≥ 0,34
 *   largura      ≥ 0,32 da célula     0,05 – 0,21
 *   preenchim.   ≤ 0,64               1,0 (barra sólida)
 */
const MAX_MATCH_SCORE = 0.3;
const MIN_GLYPH_WIDTH = 0.26;
const MAX_GLYPH_FILL = 0.78;

/**
 * Lê o dígito de uma célula já recortada (região quadrada em tons de cinza).
 *
 * Exportada para poder ser verificada diretamente contra os templates, sem
 * precisar montar um tabuleiro.
 */
export function classifyCell(
  region: Uint8Array,
  size: number,
  templates: Array<{ digit: number; vector: Float32Array; holes: number; aspect: number }>,
  minInk = 0.018,
): CellReading {
  const w = size;
  const h = size;

  const { mask: cellMask, contrast } = inkMask({ gray: region, width: w, height: h });
  if (contrast < 40) return { kind: 'empty' }; // célula uniforme → vazia

  const cleaned = dominantComponents(cellMask, w, h, 0.15);
  let inkCount = 0;
  for (let i = 0; i < cleaned.length; i += 1) inkCount += cleaned[i];
  if (inkCount / (w * h) < minInk) return { kind: 'empty' };

  let bx0 = w;
  let by0 = h;
  let bx1 = -1;
  let by1 = -1;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (cleaned[y * w + x] !== 1) continue;
      if (x < bx0) bx0 = x;
      if (x > bx1) bx1 = x;
      if (y < by0) by0 = y;
      if (y > by1) by1 = y;
    }
  }
  if (bx1 < 0) return { kind: 'empty' };

  const glyphH = by1 - by0 + 1;
  const glyphW = bx1 - bx0 + 1;
  // Glifo precisa ocupar altura típica de dígito dentro da célula.
  if (glyphH < h * 0.3 || glyphW < 2) return { kind: 'empty' };
  if (glyphH > h * 1.02) return { kind: 'unreadable', confidence: 0 };

  const vector = normalizeGlyph(cleaned, w, { x0: bx0, y0: by0, x1: bx1, y1: by1 });
  const glyphHoles = countHoles(cleaned, w, h);
  const aspect = glyphW / glyphH;

  let bestDigit = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  let secondScore = Number.POSITIVE_INFINITY;
  const perDigit = new Map<number, number>();

  for (const template of templates) {
    const distance = glyphDistance(vector, template.vector);
    const aspectPenalty = Math.min(0.25, Math.abs(Math.log((aspect || 0.5) / (template.aspect || 0.5))) * 0.08);
    const holePenalty = Math.min(0.3, Math.abs(glyphHoles - template.holes) * 0.09);
    const score = distance + aspectPenalty + holePenalty;
    const previous = perDigit.get(template.digit);
    if (previous === undefined || score < previous) perDigit.set(template.digit, score);
  }

  for (const [digit, score] of perDigit) {
    if (score < bestScore) {
      secondScore = bestScore;
      bestScore = score;
      bestDigit = digit;
    } else if (score < secondScore) {
      secondScore = score;
    }
  }

  if (bestDigit === 0) return { kind: 'unreadable', confidence: 0 };

  let inkInBox = 0;
  for (let y = by0; y <= by1; y += 1) {
    for (let x = bx0; x <= bx1; x += 1) inkInBox += cleaned[y * w + x];
  }
  const fill = inkInBox / (glyphW * glyphH);
  const widthRatio = glyphW / w;

  // Sujeira que não é dígito: casamento ruim com qualquer template, glifo
  // fino demais (resto de linha) ou maciço demais (barra sólida).
  if (bestScore > MAX_MATCH_SCORE || widthRatio < MIN_GLYPH_WIDTH || fill > MAX_GLYPH_FILL) {
    return { kind: 'unreadable', confidence: 0 };
  }

  // Confiança combina qualidade absoluta e margem sobre o segundo lugar.
  const quality = Math.max(0, Math.min(1, 1 - bestScore / 0.42));
  const margin =
    secondScore === Number.POSITIVE_INFINITY
      ? 1
      : Math.max(0, Math.min(1, (secondScore - bestScore) / Math.max(secondScore, 1e-6)));
  const confidence = Math.round((quality * 0.6 + margin * 0.4) * 100) / 100;

  return { kind: 'digit', digit: bestDigit, confidence };
}

function emptyResult(): ScanResult {
  return {
    grid: createEmptyGrid(),
    confidence: Array.from({ length: GRID_SIZE }, () => Array<number>(GRID_SIZE).fill(0)),
    uncertain: Array.from({ length: GRID_SIZE }, () => Array<boolean>(GRID_SIZE).fill(false)),
    gridDetected: false,
    lines: { xs: [], ys: [] },
    filled: 0,
    meanConfidence: 0,
    lineScore: 0,
  };
}

export function recognizeSudoku(
  bitmap: Bitmap,
  templates: Array<{ digit: number; vector: Float32Array; holes: number; aspect: number }>,
  options: RecognizeOptions = {},
): ScanResult {
  const minInk = options.minInk ?? 0.018;
  const minConfidence = options.minConfidence ?? 0.5;
  const { width, height, gray } = bitmap;

  let work = bitmap;
  let mask = adaptiveInkMask(work.gray, work.width, work.height);

  // 1º passe: linhas contínuas (rápido e exato quando a grade está reta).
  let pickedX = pickLines(findLineCandidates(mask, work.width, work.height, 'x').centers);
  let pickedY = pickLines(findLineCandidates(mask, work.width, work.height, 'y').centers);

  // Foto torta quebra a continuidade das linhas: estima o giro, endireita e
  // repete o 1º passe. (Perspectiva fica para o ajuste fino, abaixo.)
  if (!pickedX || !pickedY) {
    const skew = estimateSkew(mask, work.width, work.height);
    if (Math.abs(skew) >= 0.4) {
      const rotated = rotateBitmap(bitmap, -skew);
      const rotatedMask = adaptiveInkMask(rotated.gray, rotated.width, rotated.height);
      const rotatedX = pickLines(findLineCandidates(rotatedMask, rotated.width, rotated.height, 'x').centers);
      const rotatedY = pickLines(findLineCandidates(rotatedMask, rotated.width, rotated.height, 'y').centers);
      if (rotatedX && rotatedY) {
        work = rotated;
        mask = rotatedMask;
        pickedX = rotatedX;
        pickedY = rotatedY;
      }
    }
  }

  const gw = work.width;
  const gh = work.height;

  // Sem linhas contínuas confiáveis: parte da caixa da tinta dividida em 9 e
  // deixa o ajuste fino encontrar cada linha.
  const bounds = inkBounds(mask, gw, gh);
  const initialX = pickedX ? pickedX.lines : bounds
    ? Array.from({ length: GRID_SIZE + 1 }, (_, i) => bounds.x0 + ((bounds.x1 - bounds.x0) * i) / GRID_SIZE)
    : null;
  const initialY = pickedY ? pickedY.lines : bounds
    ? Array.from({ length: GRID_SIZE + 1 }, (_, i) => bounds.y0 + ((bounds.y1 - bounds.y0) * i) / GRID_SIZE)
    : null;

  if (!initialX || !initialY) {
    return emptyResult();
  }

  // 2º passe: cada uma das 10 linhas é ajustada de forma independente
  // (posição + inclinação), o que corrige foto torta e perspectiva.
  const extentX = { start: initialY[0], end: initialY[GRID_SIZE] };
  const extentY = { start: initialX[0], end: initialX[GRID_SIZE] };
  // A pontuação das linhas usa a máscara dilatada, para que a busca encontre
  // linhas finas sem precisar cair na posição exata.
  const scoringMask = dilateMask(mask, gw, gh, Math.max(2, Math.round(Math.min(gw, gh) / 220)));
  const refinedX = refineLines(scoringMask, gw, gh, initialX, 'x', extentX);
  const refinedY = refineLines(scoringMask, gw, gh, initialY, 'y', extentY);

  // Todas as linhas precisam ter tinta de verdade: é isso que separa "tem um
  // tabuleiro aqui" de "tem texto qualquer".
  const minLineScore = Math.min(...refinedX.scores, ...refinedY.scores);
  if (minLineScore < 0.55) {
    return emptyResult();
  }

  const cx = gw / 2;
  const cy = gh / 2;

  const grid = createEmptyGrid();
  const confidence: number[][] = [];
  const uncertain: boolean[][] = [];
  let filled = 0;
  let confidenceSum = 0;

  for (let row = 0; row < GRID_SIZE; row += 1) {
    confidence.push(new Array<number>(GRID_SIZE).fill(0));
    uncertain.push(new Array<boolean>(GRID_SIZE).fill(false));

    for (let col = 0; col < GRID_SIZE; col += 1) {
      const topLeft = intersect(refinedX.lines[col], refinedY.lines[row], cx, cy);
      const topRight = intersect(refinedX.lines[col + 1], refinedY.lines[row], cx, cy);
      const bottomLeft = intersect(refinedX.lines[col], refinedY.lines[row + 1], cx, cy);
      const bottomRight = intersect(refinedX.lines[col + 1], refinedY.lines[row + 1], cx, cy);

      const cellW = Math.hypot(topRight.x - topLeft.x, topRight.y - topLeft.y);
      const cellH = Math.hypot(bottomLeft.x - topLeft.x, bottomLeft.y - topLeft.y);
      if (cellW < 10 || cellH < 10) continue;

      const region = sampleQuad(work.gray, gw, gh, topLeft, topRight, bottomLeft, bottomRight, 0.17);
      const cell = classifyCell(region, SAMPLE, templates, minInk);
      if (cell.kind === 'empty') continue;
      if (cell.kind === 'unreadable') {
        // Fica vazio (nada de número inventado), mas destacado para conferência.
        uncertain[row][col] = true;
        continue;
      }

      grid[row][col] = cell.digit;
      confidence[row][col] = cell.confidence;
      uncertain[row][col] = cell.confidence < minConfidence;
      filled += 1;
      confidenceSum += cell.confidence;
    }
  }

  // Duplicata em linha/coluna/caixa é sinal forte de leitura errada.
  const flagDuplicate = (cells: Array<[number, number]>): void => {
    const groups = new Map<number, Array<[number, number]>>();
    for (const [row, col] of cells) {
      const value = grid[row][col];
      if (value === 0) continue;
      const list = groups.get(value) ?? [];
      list.push([row, col]);
      groups.set(value, list);
    }
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      for (const [row, col] of list) uncertain[row][col] = true;
    }
  };

  for (let i = 0; i < GRID_SIZE; i += 1) {
    flagDuplicate(Array.from({ length: GRID_SIZE }, (_, j) => [i, j] as [number, number]));
    flagDuplicate(Array.from({ length: GRID_SIZE }, (_, j) => [j, i] as [number, number]));
  }
  for (let br = 0; br < 3; br += 1) {
    for (let bc = 0; bc < 3; bc += 1) {
      const cells: Array<[number, number]> = [];
      for (let r = br * 3; r < br * 3 + 3; r += 1) {
        for (let c = bc * 3; c < bc * 3 + 3; c += 1) cells.push([r, c]);
      }
      flagDuplicate(cells);
    }
  }

  return {
    grid,
    confidence,
    uncertain,
    gridDetected: true,
    lines: {
      xs: refinedX.lines.map((line) => Math.round(line.offset)),
      ys: refinedY.lines.map((line) => Math.round(line.offset)),
    },
    filled,
    meanConfidence: filled > 0 ? Math.round((confidenceSum / filled) * 100) / 100 : 0,
    lineScore: Math.round(minLineScore * 100) / 100,
  };
}
