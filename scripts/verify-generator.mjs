#!/usr/bin/env node
/**
 * Verificação da lógica do Sudoku com Node puro (type stripping nativo).
 * Uso: node scripts/verify-generator.mjs
 */
import {
  SIZE,
  levelDef,
  generatePuzzle,
  countSolutions,
  isSolved,
  findConflicts,
  LEVEL_COUNT,
} from '../src/game/sudoku.ts';

let failures = 0;
const check = (label, condition, detail = '') => {
  if (condition) return;
  failures += 1;
  console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
};

const countGivens = (grid) =>
  grid.reduce((total, row) => total + row.filter((value) => value !== 0).length, 0);

const validSolution = (grid) => {
  const expected = '123456789';
  for (let i = 0; i < SIZE; i += 1) {
    const row = grid[i].slice().sort().join('');
    const col = grid.map((r) => r[i]).slice().sort().join('');
    if (row !== expected) return false;
    if (col !== expected) return false;
  }
  for (let br = 0; br < 3; br += 1) {
    for (let bc = 0; bc < 3; bc += 1) {
      const cells = [];
      for (let r = br * 3; r < br * 3 + 3; r += 1) {
        for (let c = bc * 3; c < bc * 3 + 3; c += 1) cells.push(grid[r][c]);
      }
      if (cells.slice().sort().join('') !== expected) return false;
    }
  }
  return true;
};

console.log('Nível  Dificuldade     Alvo  Gerado  Único  Solução');
console.log('--------------------------------------------------');

const givensByLevel = [];
const started = Date.now();

for (let level = 1; level <= LEVEL_COUNT; level += 1) {
  const def = levelDef(level);
  const puzzle = generatePuzzle(level, 1000 + level);

  const givensCounted = countGivens(puzzle.puzzle);
  const solutions = countSolutions(puzzle.puzzle, 2);

  check(`nível ${level}: contagem de revelados`, givensCounted === puzzle.givens, `${givensCounted} != ${puzzle.givens}`);
  check(`nível ${level}: solução completa e válida`, validSolution(puzzle.solution));
  check(`nível ${level}: puzzle é subconjunto da solução`,
    puzzle.puzzle.every((row, r) => row.every((value, c) => value === 0 || value === puzzle.solution[r][c])));
  check(`nível ${level}: solução única`, solutions === 1, `encontrou ${solutions}`);
  check(`nível ${level}: puzzle resolvido pela solução`, isSolved(puzzle.solution, puzzle.solution));
  check(`nível ${level}: puzzle incompleto não conta como resolvido`, !isSolved(puzzle.puzzle, puzzle.solution));
  check(`nível ${level}: nenhum conflito na solução`, findConflicts(puzzle.solution).flat().every((v) => v === false));
  check(`nível ${level}: respeitou o alvo`, givensCounted <= def.targetGivens, `${givensCounted} > ${def.targetGivens}`);

  givensByLevel.push(givensCounted);
  console.log(
    `${String(level).padStart(5)}  ${def.tier.label.padEnd(14)}  ${String(def.targetGivens).padStart(4)}  ${String(givensCounted).padStart(6)}  ${solutions === 1 ? ' sim ' : ' NÃO '}  ${validSolution(puzzle.solution) ? ' ok ' : ' FALHA'}`,
  );
}

// Determinismo: mesma seed → mesmo tabuleiro.
const a = generatePuzzle(7, 42);
const b = generatePuzzle(7, 42);
check('mesma seed gera o mesmo puzzle', JSON.stringify(a.puzzle) === JSON.stringify(b.puzzle));
const c = generatePuzzle(7, 43);
check('seeds diferentes geram puzzles diferentes', JSON.stringify(a.puzzle) !== JSON.stringify(c.puzzle));

// Progressão: média dos 3 primeiros níveis > média dos 3 últimos.
const avg = (list) => list.reduce((s, v) => s + v, 0) / list.length;
const easyAvg = avg(givensByLevel.slice(0, 3));
const expertAvg = avg(givensByLevel.slice(-3));
console.log(`\nMédia revelados — fácil: ${easyAvg.toFixed(1)} | especialista: ${expertAvg.toFixed(1)}`);
check('dificuldade progride (menos revelados no fim)', expertAvg < easyAvg, `${expertAvg} >= ${easyAvg}`);

const elapsed = Date.now() - started;
console.log(`\n${LEVEL_COUNT} níveis verificados em ${elapsed} ms`);

if (failures > 0) {
  console.error(`\n${failures} verificação(ões) falharam.`);
  process.exit(1);
}
console.log('Todas as verificações passaram.');
