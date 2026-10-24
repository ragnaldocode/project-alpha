import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SIZE, type Grid } from '../game/sudoku';
import { colors, radius } from '../theme';
import type { SelectedCell } from '../state/useSudoku';

interface BoardProps {
  board: Grid;
  given: Grid;
  selected: SelectedCell | null;
  conflicts: boolean[][];
  isWrong: (row: number, col: number) => boolean;
  onSelect: (row: number, col: number) => void;
  cellSize: number;
}

export function Board({
  board,
  given,
  selected,
  conflicts,
  isWrong,
  onSelect,
  cellSize,
}: BoardProps) {
  const selectedValue = selected ? board[selected.row][selected.col] : 0;

  const isPeer = useMemo(
    () => (row: number, col: number) => {
      if (!selected) return false;
      if (row === selected.row || col === selected.col) return true;
      const sameBox =
        Math.floor(row / 3) === Math.floor(selected.row / 3) &&
        Math.floor(col / 3) === Math.floor(selected.col / 3);
      return sameBox;
    },
    [selected],
  );

  return (
    <View style={[styles.board, { width: cellSize * SIZE + 4 }]}>
      {board.map((row, rowIndex) => (
        <View key={`row-${rowIndex}`} style={styles.row}>
          {row.map((value, colIndex) => {
            const isSelected = selected?.row === rowIndex && selected?.col === colIndex;
            const givenCell = given[rowIndex][colIndex] !== 0;
            const conflict = conflicts[rowIndex][colIndex];
            const wrong = isWrong(rowIndex, colIndex);
            const peer = isPeer(rowIndex, colIndex);
            const sameValue = selectedValue !== 0 && value === selectedValue;

            const background = isSelected
              ? colors.selected
              : conflict
                ? '#3A1B26'
                : sameValue
                  ? colors.highlightSame
                  : peer
                    ? colors.highlightPeers
                    : 'transparent';

            return (
              <Pressable
                key={`cell-${rowIndex}-${colIndex}`}
                onPress={() => onSelect(rowIndex, colIndex)}
                style={[
                  styles.cell,
                  {
                    width: cellSize,
                    height: cellSize,
                    backgroundColor: background,
                    borderRightWidth: colIndex % 3 === 2 ? 2 : StyleSheet.hairlineWidth,
                    borderBottomWidth: rowIndex % 3 === 2 ? 2 : StyleSheet.hairlineWidth,
                    borderRightColor: colIndex % 3 === 2 ? colors.borderStrong : colors.border,
                    borderBottomColor: rowIndex % 3 === 2 ? colors.borderStrong : colors.border,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Linha ${rowIndex + 1}, coluna ${colIndex + 1}${
                  value ? `, valor ${value}` : ', vazio'
                }`}
              >
                <Text
                  style={{
                    fontSize: cellSize * 0.52,
                    color: wrong
                      ? colors.userError
                      : givenCell
                        ? colors.given
                        : colors.user,
                    fontWeight: givenCell ? '700' : '500',
                  }}
                >
                  {value === 0 ? '' : String(value)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  board: {
    borderWidth: 2,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  row: {
    flexDirection: 'row',
  },
  cell: {
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 0,
    borderLeftWidth: 0,
  },
});
