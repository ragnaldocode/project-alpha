import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { LEVEL_COUNT, levelDef } from '../game/sudoku';
import { colors, radius, spacing } from '../theme';

interface HomeScreenProps {
  onStart: (level: number) => void;
}

const TIER_COLORS: Record<string, string> = {
  facil: '#34D399',
  medio: '#60A5FA',
  dificil: '#FBBF24',
  especialista: '#F87171',
};

export function HomeScreen({ onStart }: HomeScreenProps) {
  const levels = Array.from({ length: LEVEL_COUNT }, (_, index) => levelDef(index + 1));

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.eyebrow}>project-alpha</Text>
      <Text style={styles.title}>Sudoku</Text>
      <Text style={styles.subtitle}>
        {LEVEL_COUNT} níveis gerados aleatoriamente. Quanto maior o nível, menos números revelados —
        e cada tabuleiro tem solução única.
      </Text>

      <View style={styles.list}>
        {levels.map((def) => (
          <Pressable
            key={def.level}
            onPress={() => onStart(def.level)}
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            accessibilityRole="button"
            accessibilityLabel={`Nível ${def.level}, ${def.tier.label}, ${def.targetGivens} números revelados`}
          >
            <View style={[styles.dot, { backgroundColor: TIER_COLORS[def.tier.id] }]} />
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>Nível {def.level}</Text>
              <Text style={styles.cardMeta}>
                {def.tier.label} · alvo de {def.targetGivens} revelados
              </Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.footnote}>
        Dificuldade progressiva: Fácil (níveis 1–3), Médio (4–6), Difícil (7–9), Especialista
        (10–12).
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 12,
    letterSpacing: 2,
    textTransform: 'uppercase',
    fontWeight: '700',
  },
  title: {
    color: colors.text,
    fontSize: 40,
    fontWeight: '800',
    marginTop: spacing.xs,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: spacing.sm,
  },
  list: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.md,
  },
  cardPressed: {
    borderColor: colors.accent,
    backgroundColor: colors.surfaceAlt,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  cardBody: {
    flex: 1,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  cardMeta: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  chevron: {
    color: colors.textMuted,
    fontSize: 22,
  },
  footnote: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: spacing.lg,
  },
});
