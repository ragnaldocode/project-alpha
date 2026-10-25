import { useMemo } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { Board } from '../components/Board';
import { NumberPad } from '../components/NumberPad';
import { LEVEL_COUNT, levelDef, type Puzzle } from '../game/sudoku';
import { useSudoku } from '../state/useSudoku';
import { colors, radius, spacing } from '../theme';

interface GameScreenProps {
  level: number;
  onExit: () => void;
  onStart: (level: number) => void;
  /** Tabuleiro lido de foto (dispensa nível; a partida roda igual). */
  imported?: Puzzle;
  /** Voltar para o leitor de fotos (só faz sentido no modo importado). */
  onScan?: () => void;
}

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function GameScreen({ level, onExit, onStart, imported, onScan }: GameScreenProps) {
  const { width } = useWindowDimensions();
  const def = levelDef(level);
  const game = useSudoku(level, imported);

  const cellSize = useMemo(() => {
    const usable = Math.min(width - spacing.md * 2, 440);
    return Math.floor(usable / 9);
  }, [width]);

  const won = game.status === 'won';
  const nextLevel = Math.min(level + 1, LEVEL_COUNT);

  return (
    <View style={styles.root}>
      <View style={styles.topBar}>
        <Pressable onPress={onExit} hitSlop={12} accessibilityRole="button" accessibilityLabel="Voltar">
          <Text style={styles.back}>‹ níveis</Text>
        </Pressable>
        <View style={styles.stats}>
          <Text style={styles.stat}>{formatTime(game.seconds)}</Text>
          <Text style={styles.statMuted}>erros {game.mistakes}</Text>
          <Text style={styles.statMuted}>dicas {game.hintsUsed}</Text>
        </View>
      </View>

      <Text style={styles.level}>{imported ? 'Foto importada' : `Nível ${def.level}`}</Text>
      <Text style={styles.meta}>
        {imported
          ? `lido da sua foto · ${game.puzzle.givens} revelados`
          : `${def.tier.label} · ${game.puzzle.givens} revelados · ${def.tier.hint}`}
      </Text>

      <View style={styles.boardWrapper}>
        <Board
          board={game.board}
          given={game.puzzle.puzzle}
          selected={game.selected}
          conflicts={game.conflicts}
          isWrong={game.isWrong}
          onSelect={game.select}
          cellSize={cellSize}
        />
      </View>

      <NumberPad
        onDigit={game.input}
        onErase={game.erase}
        remaining={game.remaining}
        disabled={won}
      />

      <View style={styles.actions}>
        <Pressable
          onPress={game.hint}
          disabled={won}
          style={styles.action}
          accessibilityRole="button"
          accessibilityLabel="Pedir dica"
        >
          <Text style={styles.actionText}>Dica</Text>
        </Pressable>
        <Pressable
          onPress={game.restart}
          style={styles.action}
          accessibilityRole="button"
          accessibilityLabel="Reiniciar o tabuleiro atual"
        >
          <Text style={styles.actionText}>Reiniciar</Text>
        </Pressable>
        {imported ? (
          <Pressable
            onPress={onScan}
            style={[styles.action, styles.actionPrimary]}
            accessibilityRole="button"
            accessibilityLabel="Ler outro tabuleiro de uma foto"
          >
            <Text style={styles.actionTextPrimary}>Escanear outro</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={game.newRound}
            style={[styles.action, styles.actionPrimary]}
            accessibilityRole="button"
            accessibilityLabel="Gerar novo tabuleiro do mesmo nível"
          >
            <Text style={styles.actionTextPrimary}>Novo tabuleiro</Text>
          </Pressable>
        )}
      </View>

      {won ? (
        <View style={styles.overlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Resolvido</Text>
            <Text style={styles.modalBody}>
              {imported ? 'Tabuleiro da foto' : `Nível ${def.level}`} em {formatTime(game.seconds)}
              {game.mistakes > 0 ? ` · ${game.mistakes} erro(s)` : ' · sem erros'}
            </Text>
            <Pressable
              style={[styles.modalButton, styles.modalPrimary]}
              onPress={() => (imported ? game.restart() : onStart(nextLevel))}
              accessibilityRole="button"
              accessibilityLabel={
                imported || nextLevel === level ? 'Jogar novamente' : `Ir para o nível ${nextLevel}`
              }
            >
              <Text style={styles.modalButtonText}>
                {imported || nextLevel === level ? 'Jogar de novo' : `Ir para o nível ${nextLevel}`}
              </Text>
            </Pressable>
            <Pressable
              style={styles.modalButton}
              onPress={imported ? onScan : onExit}
              accessibilityRole="button"
              accessibilityLabel={imported ? 'Ler outro tabuleiro de uma foto' : 'Escolher outro nível'}
            >
              <Text style={[styles.modalButtonText, styles.modalButtonTextMuted]}>
                {imported ? 'Escanear outro' : 'Escolher outro nível'}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  back: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: '600',
  },
  stats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  stat: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  statMuted: {
    color: colors.textMuted,
    fontSize: 12,
  },
  level: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '800',
    marginTop: spacing.sm,
  },
  meta: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  boardWrapper: {
    alignItems: 'center',
    marginTop: spacing.md,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  action: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  actionPrimary: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  actionText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  actionTextPrimary: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(6, 11, 20, 0.86)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modal: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  modalTitle: {
    color: colors.success,
    fontSize: 22,
    fontWeight: '800',
  },
  modalBody: {
    color: colors.textMuted,
    fontSize: 14,
    marginBottom: spacing.sm,
  },
  modalButton: {
    paddingVertical: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  modalPrimary: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  modalButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  modalButtonTextMuted: {
    color: colors.textMuted,
    fontSize: 14,
  },
});
