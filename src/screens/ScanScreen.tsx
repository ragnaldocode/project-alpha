import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import { Board } from '../components/Board';
import { NumberPad } from '../components/NumberPad';
import {
  EMPTY,
  SIZE,
  cloneGrid,
  createEmptyGrid,
  findConflicts,
  puzzleFromGrid,
  type Grid,
  type Puzzle,
} from '../game/sudoku';
import { scanSudokuImage, type ScanResult } from '../ocr/scan';
import { colors, radius, spacing } from '../theme';

interface ScanScreenProps {
  onCancel: () => void;
  onReady: (puzzle: Puzzle) => void;
}

type Phase = 'idle' | 'reading' | 'review';

/**
 * Leitor de tabuleiro por foto.
 *
 * O cliente tira uma foto (ou escolhe da galeria), o app lê os 81 números e
 * mostra o resultado para conferência — a leitura é automática, mas a palavra
 * final é dele: células com leitura duvidosa ficam destacadas e podem ser
 * corrigidas antes de começar a jogar.
 */
export function ScanScreen({ onCancel, onReady }: ScanScreenProps) {
  const { width } = useWindowDimensions();
  const [phase, setPhase] = useState<Phase>('idle');
  const [photo, setPhoto] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [grid, setGrid] = useState<Grid>(() => createEmptyGrid());
  const [selected, setSelected] = useState<{ row: number; col: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const cellSize = useMemo(() => {
    const usable = Math.min(width - spacing.md * 2, 380);
    return Math.floor(usable / SIZE);
  }, [width]);

  const conflicts = useMemo(() => findConflicts(grid), [grid]);
  const conflictCount = useMemo(
    () => conflicts.reduce((total, row) => total + row.filter(Boolean).length, 0),
    [conflicts],
  );
  /** Células destacadas que têm número (leitura duvidosa) ... */
  const doubtfulDigits = useMemo(() => {
    if (!result) return 0;
    let total = 0;
    for (let row = 0; row < SIZE; row += 1) {
      for (let col = 0; col < SIZE; col += 1) {
        if (result.uncertain[row][col] && grid[row][col] !== EMPTY) total += 1;
      }
    }
    return total;
  }, [grid, result]);

  /** ... e células que tinham tinta mas ficaram vazias (não deu para ler). */
  const doubtfulEmpty = useMemo(() => {
    if (!result) return 0;
    let total = 0;
    for (let row = 0; row < SIZE; row += 1) {
      for (let col = 0; col < SIZE; col += 1) {
        if (result.uncertain[row][col] && grid[row][col] === EMPTY) total += 1;
      }
    }
    return total;
  }, [grid, result]);
  const filledCount = useMemo(
    () => grid.reduce((total, row) => total + row.filter((value) => value !== EMPTY).length, 0),
    [grid],
  );
  const remaining = useMemo(() => {
    const counts: Record<number, number> = {};
    for (let value = 1; value <= SIZE; value += 1) counts[value] = SIZE;
    for (const row of grid) for (const value of row) if (value !== EMPTY) counts[value] -= 1;
    return counts;
  }, [grid]);

  const readPhoto = useCallback(async (uri: string) => {
    setPhoto(uri);
    setPhase('reading');
    setMessage(null);
    setWarning(null);
    try {
      const scan = await scanSudokuImage(uri);
      if (!scan.gridDetected || scan.filled === 0) {
        setResult(null);
        setPhase('idle');
        setMessage(
          'Não encontrei o tabuleiro na foto. Enquadre só o tabuleiro, com as quatro bordas dentro da imagem, e tente de novo.',
        );
        return;
      }
      setResult(scan);
      setGrid(cloneGrid(scan.grid));
      setSelected(null);
      setPhase('review');
    } catch (error) {
      setResult(null);
      setPhase('idle');
      setMessage(
        error instanceof Error
          ? `Não foi possível ler a imagem: ${error.message}`
          : 'Não foi possível ler a imagem.',
      );
    }
  }, []);

  const pickFromLibrary = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setMessage('Preciso de acesso às suas fotos para importar o tabuleiro.');
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
      exif: false,
    });
    if (picked.canceled || !picked.assets?.length) return;
    await readPhoto(picked.assets[0].uri);
  }, [readPhoto]);

  const takePhoto = useCallback(async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setMessage('Preciso de acesso à câmera para tirar a foto do tabuleiro.');
      return;
    }
    const taken = await ImagePicker.launchCameraAsync({
      mediaTypes: 'images',
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
      exif: false,
    });
    if (taken.canceled || !taken.assets?.length) return;
    await readPhoto(taken.assets[0].uri);
  }, [readPhoto]);

  const setCell = useCallback((value: number) => {
    if (!selected) return;
    setGrid((current) => {
      const next = cloneGrid(current);
      next[selected.row][selected.col] = value;
      return next;
    });
    setWarning(null);
    setMessage(null);
  }, [selected]);

  const eraseCell = useCallback(() => {
    if (!selected) return;
    setGrid((current) => {
      const next = cloneGrid(current);
      next[selected.row][selected.col] = EMPTY;
      return next;
    });
    setWarning(null);
    setMessage(null);
  }, [selected]);

  const startGame = useCallback(() => {
    const imported = puzzleFromGrid(grid);
    if (!imported.ok) {
      if (imported.reason === 'conflict') {
        setMessage(
          'Há números repetidos na mesma linha, coluna ou bloco (destacados em vermelho). Corrija as células para continuar.',
        );
      } else {
        setMessage(
          'Este tabuleiro não tem solução — algum número deve ter sido lido errado. Confira as células destacadas.',
        );
      }
      return;
    }

    if (imported.multipleSolutions && !warning) {
      setWarning(
        'Este tabuleiro tem mais de uma solução, o que costuma significar que um número revelado não foi lido. Confira a foto e toque em "Usar assim mesmo" se estiver tudo certo.',
      );
      return;
    }

    onReady(imported.puzzle);
  }, [grid, onReady, warning]);

  const isReview = phase === 'review' && result !== null;

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.topBar}>
        <Pressable onPress={onCancel} hitSlop={12} accessibilityRole="button" accessibilityLabel="Voltar">
          <Text style={styles.back}>‹ níveis</Text>
        </Pressable>
      </View>

      <Text style={styles.eyebrow}>leitor de fotos</Text>
      <Text style={styles.title}>Sudoku da foto</Text>
      <Text style={styles.subtitle}>
        Tire uma foto do tabuleiro impresso (ou escolha uma da galeria). O app lê os números e você
        confere antes de começar.
      </Text>

      {photo && phase !== 'review' ? (
        <Image source={{ uri: photo }} style={styles.preview} resizeMode="cover" />
      ) : null}

      {phase === 'reading' ? (
        <View style={styles.reading}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.readingText}>Lendo o tabuleiro…</Text>
        </View>
      ) : null}

      {message ? <Text style={styles.error}>{message}</Text> : null}

      {!isReview ? (
        <View style={styles.actionsColumn}>
          {Platform.OS !== 'web' ? (
            <Pressable
              onPress={takePhoto}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Tirar foto do tabuleiro"
              disabled={phase === 'reading'}
            >
              <Text style={styles.primaryButtonText}>Tirar foto</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={pickFromLibrary}
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Escolher imagem da galeria"
            disabled={phase === 'reading'}
          >
            <Text style={styles.secondaryButtonText}>
              {Platform.OS === 'web' ? 'Escolher imagem' : 'Escolher da galeria'}
            </Text>
          </Pressable>
          <Text style={styles.hint}>
            Dica: enquadre apenas o tabuleiro, com boa luz e sem sombra. O app corrige foto torta e
            perspectiva.
          </Text>
        </View>
      ) : null}

      {isReview ? (
        <View>
          <View style={styles.summary}>
            <Text style={styles.summaryTitle}>Tabuleiro lido</Text>
            <Text style={styles.summaryBody}>
              {filledCount} números · confiança média {Math.round((result?.meanConfidence ?? 0) * 100)}%
            </Text>
            {doubtfulDigits > 0 ? (
              <Text style={styles.summaryWarning}>
                {doubtfulDigits} número{doubtfulDigits > 1 ? 's' : ''} em amarelo com leitura duvidosa —
                confira contra a foto.
              </Text>
            ) : null}
            {doubtfulEmpty > 0 ? (
              <Text style={styles.summaryWarning}>
                {doubtfulEmpty} célula{doubtfulEmpty > 1 ? 's' : ''} em amarelo deixada
                {doubtfulEmpty > 1 ? 's' : ''} vazia{doubtfulEmpty > 1 ? 's' : ''}: tinha marca, mas não é
                um número legível (risco, resto de linha ou escrita à mão). Se for um número, toque e digite.
              </Text>
            ) : null}
            {doubtfulDigits === 0 && doubtfulEmpty === 0 ? (
              <Text style={styles.summaryOk}>Nenhuma célula duvidosa — confira na foto e comece.</Text>
            ) : null}
            {filledCount > 55 ? (
              <Text style={styles.summaryError}>
                {filledCount} números é muito para um Sudoku jogável (o normal é 22–45): pode haver número
                a mais. Confira as células vazias da foto antes de jogar.
              </Text>
            ) : null}
            {conflictCount > 0 ? (
              <Text style={styles.summaryError}>
                {conflictCount} conflito{conflictCount > 1 ? 's' : ''} (número repetido em vermelho).
              </Text>
            ) : null}
          </View>

          <View style={styles.boardWrapper}>
            <Board
              board={grid}
              given={createEmptyGrid()}
              selected={selected}
              conflicts={conflicts}
              isWrong={() => false}
              onSelect={(row, col) => setSelected({ row, col })}
              cellSize={cellSize}
              mark={result?.uncertain}
            />
          </View>

          <Text style={styles.editHint}>
            {selected
              ? `Corrigindo linha ${selected.row + 1}, coluna ${selected.col + 1}`
              : 'Toque em uma célula para corrigir o que foi lido errado.'}
          </Text>

          <NumberPad onDigit={setCell} onErase={eraseCell} remaining={remaining} />

          {warning ? <Text style={styles.warning}>{warning}</Text> : null}

          <View style={styles.reviewActions}>
            <Pressable
              onPress={startGame}
              style={({ pressed }) => [styles.primaryButton, styles.flex, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={warning ? 'Usar este tabuleiro mesmo assim' : 'Começar a jogar com o tabuleiro lido'}
            >
              <Text style={styles.primaryButtonText}>{warning ? 'Usar assim mesmo' : 'Jogar este tabuleiro'}</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setPhoto(null);
                setResult(null);
                setPhase('idle');
                setWarning(null);
                setMessage(null);
              }}
              style={({ pressed }) => [styles.secondaryButton, styles.flex, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Ler outra foto"
            >
              <Text style={styles.secondaryButtonText}>Outra foto</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
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
  eyebrow: {
    color: colors.accent,
    fontSize: 12,
    letterSpacing: 2,
    textTransform: 'uppercase',
    fontWeight: '700',
    marginTop: spacing.sm,
  },
  title: {
    color: colors.text,
    fontSize: 32,
    fontWeight: '800',
    marginTop: spacing.xs,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: spacing.sm,
  },
  preview: {
    width: '100%',
    height: 180,
    borderRadius: radius.md,
    marginTop: spacing.md,
    backgroundColor: colors.surface,
  },
  reading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  readingText: {
    color: colors.textMuted,
    fontSize: 14,
  },
  error: {
    color: colors.userError,
    fontSize: 13,
    lineHeight: 19,
    marginTop: spacing.md,
    backgroundColor: '#2A1620',
    borderRadius: radius.md,
    padding: spacing.md,
  },
  warning: {
    color: colors.warning,
    fontSize: 13,
    lineHeight: 19,
    marginTop: spacing.md,
    backgroundColor: colors.warningSoft,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  actionsColumn: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
    paddingHorizontal: spacing.md,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
    paddingHorizontal: spacing.md,
  },
  secondaryButtonText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.75,
  },
  hint: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: spacing.sm,
  },
  summary: {
    marginTop: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 4,
  },
  summaryTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  summaryBody: {
    color: colors.textMuted,
    fontSize: 13,
  },
  summaryWarning: {
    color: colors.warning,
    fontSize: 13,
    marginTop: 2,
  },
  summaryOk: {
    color: colors.success,
    fontSize: 13,
    marginTop: 2,
  },
  summaryError: {
    color: colors.userError,
    fontSize: 13,
    marginTop: 2,
  },
  boardWrapper: {
    alignItems: 'center',
    marginTop: spacing.md,
  },
  editHint: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  reviewActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  flex: {
    flex: 1,
  },
});
