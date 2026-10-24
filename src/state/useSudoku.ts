import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  EMPTY,
  SIZE,
  cloneGrid,
  findConflicts,
  generatePuzzle,
  isSolved,
  type Grid,
  type Puzzle,
} from '../game/sudoku';

export type GameStatus = 'playing' | 'won';

export interface SelectedCell {
  row: number;
  col: number;
}

export interface UseSudokuResult {
  puzzle: Puzzle;
  board: Grid;
  status: GameStatus;
  selected: SelectedCell | null;
  conflicts: boolean[][];
  mistakes: number;
  hintsUsed: number;
  seconds: number;
  remaining: Record<number, number>;
  filled: number;
  isGiven: (row: number, col: number) => boolean;
  isWrong: (row: number, col: number) => boolean;
  select: (row: number, col: number) => void;
  input: (value: number) => void;
  erase: () => void;
  hint: () => void;
  restart: () => void;
  newRound: () => void;
}

function countRemaining(board: Grid): Record<number, number> {
  const remaining: Record<number, number> = {};
  for (let value = 1; value <= SIZE; value += 1) remaining[value] = SIZE;
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      const value = board[row][col];
      if (value !== EMPTY) remaining[value] -= 1;
    }
  }
  return remaining;
}

export function useSudoku(level: number): UseSudokuResult {
  const [puzzle, setPuzzle] = useState<Puzzle>(() => generatePuzzle(level));
  const [board, setBoard] = useState<Grid>(() => cloneGrid(puzzle.puzzle));
  const [selected, setSelected] = useState<SelectedCell | null>(null);
  const [status, setStatus] = useState<GameStatus>('playing');
  const [mistakes, setMistakes] = useState(0);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [seconds, setSeconds] = useState(0);

  const isGiven = useCallback(
    (row: number, col: number) => puzzle.puzzle[row][col] !== EMPTY,
    [puzzle],
  );

  const isWrong = useCallback(
    (row: number, col: number) => {
      const value = board[row][col];
      return value !== EMPTY && value !== puzzle.solution[row][col];
    },
    [board, puzzle.solution],
  );

  const conflicts = useMemo(() => findConflicts(board), [board]);
  const remaining = useMemo(() => countRemaining(board), [board]);
  const filled = useMemo(
    () => board.reduce((total, row) => total + row.filter((value) => value !== EMPTY).length, 0),
    [board],
  );

  useEffect(() => {
    if (status !== 'playing') return undefined;
    const id = setInterval(() => setSeconds((current) => current + 1), 1000);
    return () => clearInterval(id);
  }, [status]);

  useEffect(() => {
    if (isSolved(board, puzzle.solution)) setStatus('won');
  }, [board, puzzle.solution]);

  const select = useCallback((row: number, col: number) => {
    setSelected({ row, col });
  }, []);

  const input = useCallback(
    (value: number) => {
      if (!selected) return;
      const { row, col } = selected;
      if (puzzle.puzzle[row][col] !== EMPTY) return; // célula revelada é fixa
      if (value === board[row][col]) return;

      setBoard((current) => {
        const next = cloneGrid(current);
        next[row][col] = value;
        return next;
      });

      if (value !== puzzle.solution[row][col]) {
        setMistakes((current) => current + 1);
      }
    },
    [board, puzzle, selected],
  );

  const erase = useCallback(() => {
    if (!selected) return;
    const { row, col } = selected;
    if (puzzle.puzzle[row][col] !== EMPTY) return;
    setBoard((current) => {
      const next = cloneGrid(current);
      next[row][col] = EMPTY;
      return next;
    });
  }, [puzzle.puzzle, selected]);

  const hint = useCallback(() => {
    const empties: SelectedCell[] = [];
    for (let row = 0; row < SIZE; row += 1) {
      for (let col = 0; col < SIZE; col += 1) {
        if (board[row][col] !== puzzle.solution[row][col]) empties.push({ row, col });
      }
    }
    if (empties.length === 0) return;
    const pick = empties[Math.floor(Math.random() * empties.length)];
    setBoard((current) => {
      const next = cloneGrid(current);
      next[pick.row][pick.col] = puzzle.solution[pick.row][pick.col];
      return next;
    });
    setHintsUsed((current) => current + 1);
  }, [board, puzzle.solution]);

  const restart = useCallback(() => {
    setBoard(cloneGrid(puzzle.puzzle));
    setStatus('playing');
    setMistakes(0);
    setHintsUsed(0);
    setSeconds(0);
    setSelected(null);
  }, [puzzle.puzzle]);

  const newRound = useCallback(() => {
    const next = generatePuzzle(level);
    setPuzzle(next);
    setBoard(cloneGrid(next.puzzle));
    setStatus('playing');
    setMistakes(0);
    setHintsUsed(0);
    setSeconds(0);
    setSelected(null);
  }, [level]);

  return {
    puzzle,
    board,
    status,
    selected,
    conflicts,
    mistakes,
    hintsUsed,
    seconds,
    remaining,
    filled,
    isGiven,
    isWrong,
    select,
    input,
    erase,
    hint,
    restart,
    newRound,
  };
}
