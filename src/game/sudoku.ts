/**
 * Lógica pura do Sudoku: geração, validação e contagem de soluções.
 *
 * Este arquivo é intencionalmente autocontido (sem imports relativos) para que
 * possa ser executado direto pelo Node nos testes: `node scripts/verify-generator.mjs`.
 */

export const SIZE = 9;
export const EMPTY = 0;
export const LEVEL_COUNT = 12;

export type Grid = number[][];
export type Difficulty = 'facil' | 'medio' | 'dificil' | 'especialista';

export interface Tier {
  id: Difficulty;
  label: string;
  /** Quantidade alvo de números revelados no tabuleiro. */
  targetGivens: number;
  hint: string;
}

export interface LevelDef {
  level: number;
  tier: Tier;
  /** Alvo efetivo de revelados para este nível. */
  targetGivens: number;
}

/** De onde veio o tabuleiro em jogo. */
export type PuzzleSource = 'generated' | 'scan';

export interface Puzzle {
  puzzle: Grid;
  solution: Grid;
  /** Quantidade real de revelados (o gerador pode não atingir o alvo). */
  givens: number;
  seed: number;
  /** Quantas tentativas foram necessárias para chegar ao alvo. */
  attempts: number;
  level: number;
  difficulty: Difficulty;
  /** 'scan' = lido de uma foto; nesse caso `level`/`difficulty` não se aplicam. */
  source: PuzzleSource;
}

export const TIERS: Record<Difficulty, Tier> = {
  facil: {
    id: 'facil',
    label: 'Fácil',
    targetGivens: 42,
    hint: 'Muitos números revelados',
  },
  medio: {
    id: 'medio',
    label: 'Médio',
    targetGivens: 34,
    hint: 'Equilíbrio entre lógica e dedução',
  },
  dificil: {
    id: 'dificil',
    label: 'Difícil',
    targetGivens: 28,
    hint: 'Poucos revelados, exige técnica',
  },
  especialista: {
    id: 'especialista',
    label: 'Especialista',
    targetGivens: 25,
    hint: 'Piso de revelados com solução única',
  },
};

/**
 * Alvo de revelados por nível (1 → 12). Desce de 42 até 24, que é o piso que o
 * gerador consegue atingir de forma confiável mantendo solução única — medido
 * empiricamente: remoção gulosa satura entre 22 e 27 revelados.
 */
export const LEVEL_GIVENS = [42, 40, 38, 36, 34, 32, 30, 29, 28, 26, 25, 24];

/** Os 12 níveis: a cada 3 níveis a dificuldade sobe e os revelados diminuem. */
export function levelDef(level: number): LevelDef {
  const clamped = Math.min(Math.max(Math.trunc(level), 1), LEVEL_COUNT);
  const tierIds: Difficulty[] = ['facil', 'medio', 'dificil', 'especialista'];
  const tierIndex = Math.min(Math.floor((clamped - 1) / 3), tierIds.length - 1);
  const tier = TIERS[tierIds[tierIndex]];
  return { level: clamped, tier, targetGivens: LEVEL_GIVENS[clamped - 1] };
}

export function createEmptyGrid(): Grid {
  return Array.from({ length: SIZE }, () => Array<number>(SIZE).fill(EMPTY));
}

export function cloneGrid(grid: Grid): Grid {
  return grid.map((row) => [...row]);
}

/** RNG determinístico (mulberry32) — mesma seed, mesmo puzzle. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

const ALL_DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

export function boxStart(index: number): number {
  return Math.floor(index / 3) * 3;
}

/** O valor pode entrar em (row, col) sem violar linha, coluna ou caixa? */
export function isValidPlacement(grid: Grid, row: number, col: number, value: number): boolean {
  for (let i = 0; i < SIZE; i += 1) {
    if (grid[row][i] === value) return false;
    if (grid[i][col] === value) return false;
  }
  const r0 = boxStart(row);
  const c0 = boxStart(col);
  for (let r = r0; r < r0 + 3; r += 1) {
    for (let c = c0; c < c0 + 3; c += 1) {
      if (grid[r][c] === value) return false;
    }
  }
  return true;
}

/** Preenche um tabuleiro vazio com uma solução completa e aleatória. */
export function generateSolution(rng: () => number): Grid {
  const grid = createEmptyGrid();

  const fill = (pos: number): boolean => {
    if (pos === SIZE * SIZE) return true;
    const row = Math.floor(pos / SIZE);
    const col = pos % SIZE;
    for (const value of shuffled(ALL_DIGITS, rng)) {
      if (!isValidPlacement(grid, row, col, value)) continue;
      grid[row][col] = value;
      if (fill(pos + 1)) return true;
      grid[row][col] = EMPTY;
    }
    return false;
  };

  fill(0);
  return grid;
}

/**
 * Busca soluções até `limit` e devolve também a primeira encontrada — assim a
 * contagem (gerador) e a resolução (tabuleiro lido de foto) usam a mesma
 * implementação.
 */
export function solveGrid(input: Grid, limit = 2): { count: number; solution: Grid | null } {
  const grid = cloneGrid(input);
  let found = 0;
  let solution: Grid | null = null;

  const search = (): void => {
    if (found >= limit) return;

    // Heurística MRV: escolhe a célula vazia com menos candidatos.
    let bestRow = -1;
    let bestCol = -1;
    let bestMask = 0;
    let bestCount = 10;

    for (let row = 0; row < SIZE; row += 1) {
      for (let col = 0; col < SIZE; col += 1) {
        if (grid[row][col] !== EMPTY) continue;
        let mask = 0;
        let count = 0;
        for (const value of ALL_DIGITS) {
          if (isValidPlacement(grid, row, col, value)) {
            mask |= 1 << value;
            count += 1;
          }
        }
        if (count === 0) return; // beco sem saída
        if (count < bestCount) {
          bestCount = count;
          bestRow = row;
          bestCol = col;
          bestMask = mask;
          if (count === 1) break;
        }
      }
      if (bestCount === 1) break;
    }

    if (bestRow === -1) {
      found += 1;
      if (!solution) solution = cloneGrid(grid);
      return;
    }

    for (const value of ALL_DIGITS) {
      if ((bestMask & (1 << value)) === 0) continue;
      grid[bestRow][bestCol] = value;
      search();
      grid[bestRow][bestCol] = EMPTY;
      if (found >= limit) return;
    }
  };

  search();
  return { count: found, solution };
}

/**
 * Conta soluções até `limit` (padrão 2). Para o gerador só importa saber se é
 * exatamente 1 — parar em 2 mantém a checagem barata.
 */
export function countSolutions(input: Grid, limit = 2): number {
  return solveGrid(input, limit).count;
}

/** Remove números da solução até o alvo, preservando unicidade da solução. */
function dig(solution: Grid, targetGivens: number, rng: () => number): { puzzle: Grid; givens: number } {
  const puzzle = cloneGrid(solution);
  let givens = SIZE * SIZE;

  const order = shuffled(
    Array.from({ length: SIZE * SIZE }, (_, i) => i),
    rng,
  );

  for (const index of order) {
    if (givens <= targetGivens) break;
    const row = Math.floor(index / SIZE);
    const col = index % SIZE;
    if (puzzle[row][col] === EMPTY) continue;

    const backup = puzzle[row][col];
    puzzle[row][col] = EMPTY;
    if (countSolutions(puzzle, 2) === 1) {
      givens -= 1;
    } else {
      puzzle[row][col] = backup; // remoção quebraria a unicidade
    }
  }

  return { puzzle, givens };
}

/**
 * Gera um puzzle com solução única, removendo números de uma solução completa
 * até chegar ao alvo do nível. Remoção gulosa satura (nem toda solução permite
 * chegar a 24 revelados), então tenta novas seeds até `maxAttempts` vezes e
 * devolve a melhor tentativa caso nenhuma atinja o alvo.
 */
export function generatePuzzle(
  level: number,
  seed = Math.floor(Math.random() * 2 ** 31),
  maxAttempts = 12,
): Puzzle {
  const def = levelDef(level);
  let best: Puzzle | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const attemptSeed = attempt === 1 ? seed : (seed + attempt * 104729) % 2147483647;
    const rng = createRng(attemptSeed);
    const solution = generateSolution(rng);
    const { puzzle, givens } = dig(solution, def.targetGivens, rng);

    const candidate: Puzzle = {
      puzzle,
      solution,
      givens,
      seed: attemptSeed,
      attempts: attempt,
      level: def.level,
      difficulty: def.tier.id,
      source: 'generated',
    };

    if (!best || candidate.givens < best.givens) best = candidate;
    if (givens <= def.targetGivens) return candidate;
  }

  return best as Puzzle;
}

/** Tabuleiro completo e correto em relação à solução? */
export function isSolved(board: Grid, solution: Grid): boolean {
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      if (board[row][col] !== solution[row][col]) return false;
    }
  }
  return true;
}

/** Células que conflitam entre si (mesma linha, coluna ou caixa). */
export function findConflicts(board: Grid): boolean[][] {
  const conflicts = Array.from({ length: SIZE }, () => Array<boolean>(SIZE).fill(false));

  const markGroup = (cells: Array<[number, number]>): void => {
    const seen = new Map<number, Array<[number, number]>>();
    for (const [row, col] of cells) {
      const value = board[row][col];
      if (value === EMPTY) continue;
      const list = seen.get(value) ?? [];
      list.push([row, col]);
      seen.set(value, list);
    }
    for (const list of seen.values()) {
      if (list.length < 2) continue;
      for (const [row, col] of list) conflicts[row][col] = true;
    }
  };

  for (let i = 0; i < SIZE; i += 1) {
    markGroup(Array.from({ length: SIZE }, (_, j) => [i, j] as [number, number]));
    markGroup(Array.from({ length: SIZE }, (_, j) => [j, i] as [number, number]));
  }

  for (let br = 0; br < 3; br += 1) {
    for (let bc = 0; bc < 3; bc += 1) {
      const cells: Array<[number, number]> = [];
      for (let r = br * 3; r < br * 3 + 3; r += 1) {
        for (let c = bc * 3; c < bc * 3 + 3; c += 1) cells.push([r, c]);
      }
      markGroup(cells);
    }
  }

  return conflicts;
}

export type ImportedPuzzleResult =
  | { ok: true; puzzle: Puzzle; multipleSolutions: boolean }
  | { ok: false; reason: 'conflict' | 'unsolvable'; conflicts: boolean[][] };

/**
 * Monta um tabuleiro jogável a partir de uma grade lida de foto.
 *
 * - números repetidos em linha/coluna/caixa ⇒ recusa (o cliente corrige à mão);
 * - sem solução ⇒ recusa;
 * - mais de uma solução ⇒ aceita, mas avisa: normalmente significa que um
 *   número revelado ficou de fora na leitura, e o app usa a primeira solução
 *   encontrada para dicas e para detectar erros.
 */
export function puzzleFromGrid(grid: Grid): ImportedPuzzleResult {
  const conflicts = findConflicts(grid);
  if (conflicts.some((row) => row.some(Boolean))) {
    return { ok: false, reason: 'conflict', conflicts };
  }

  const { count, solution } = solveGrid(grid, 2);
  if (count === 0 || !solution) {
    return { ok: false, reason: 'unsolvable', conflicts };
  }

  let givens = 0;
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      if (grid[row][col] !== EMPTY) givens += 1;
    }
  }

  return {
    ok: true,
    multipleSolutions: count > 1,
    puzzle: {
      puzzle: cloneGrid(grid),
      solution,
      givens,
      seed: 0,
      attempts: 0,
      level: 0,
      difficulty: 'facil',
      source: 'scan',
    },
  };
}
