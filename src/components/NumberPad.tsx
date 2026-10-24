import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SIZE } from '../game/sudoku';
import { colors, radius, spacing } from '../theme';

interface NumberPadProps {
  onDigit: (value: number) => void;
  onErase: () => void;
  remaining: Record<number, number>;
  disabled?: boolean;
}

export function NumberPad({ onDigit, onErase, remaining, disabled }: NumberPadProps) {
  return (
    <View style={styles.wrapper}>
      <View style={styles.grid}>
        {Array.from({ length: SIZE }, (_, index) => index + 1).map((value) => {
          const left = remaining[value] ?? 0;
          const done = left <= 0;
          return (
            <Pressable
              key={value}
              disabled={disabled}
              onPress={() => onDigit(value)}
              style={({ pressed }) => [
                styles.key,
                done && styles.keyDone,
                pressed && styles.keyPressed,
                disabled && styles.keyDisabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Número ${value}, ${left} restantes`}
            >
              <Text style={[styles.keyText, done && styles.keyTextDone]}>{value}</Text>
              <Text style={styles.count}>{done ? 'ok' : left}</Text>
            </Pressable>
          );
        })}
        <Pressable
          onPress={onErase}
          disabled={disabled}
          style={({ pressed }) => [
            styles.key,
            styles.erase,
            pressed && styles.keyPressed,
            disabled && styles.keyDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Apagar célula"
        >
          <Text style={styles.eraseText}>apagar</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginTop: spacing.md,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  key: {
    width: 54,
    height: 58,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyDone: {
    opacity: 0.35,
  },
  keyPressed: {
    borderColor: colors.accent,
    transform: [{ scale: 0.96 }],
  },
  keyDisabled: {
    opacity: 0.4,
  },
  keyText: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '600',
  },
  keyTextDone: {
    color: colors.textMuted,
  },
  count: {
    color: colors.textMuted,
    fontSize: 10,
    marginTop: 2,
  },
  erase: {
    width: 78,
    backgroundColor: colors.accentSoft,
  },
  eraseText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
});
