import { useState } from 'react';
import { Platform, SafeAreaView, StatusBar as RNStatusBar, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import type { Puzzle } from './src/game/sudoku';
import { GameScreen } from './src/screens/GameScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { ScanScreen } from './src/screens/ScanScreen';
import { colors } from './src/theme';

/**
 * Máquina de estados simples de 3 telas: início → (nível | leitor de foto) →
 * jogo. Cada tabuleiro entra no jogo com uma `key` própria para o React
 * remontar o estado da partida.
 */
type Screen =
  | { name: 'home' }
  | { name: 'scan' }
  | { name: 'game'; level: number; imported?: Puzzle; key: string };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });

  const openLevel = (level: number) => {
    setScreen({ name: 'game', level, key: `level-${level}-${Date.now()}` });
  };

  const playImported = (puzzle: Puzzle) => {
    // O nível não se aplica ao tabuleiro lido de foto: o jogo usa o próprio
    // tabuleiro e a tela esconde o cabeçalho de nível.
    setScreen({ name: 'game', level: 1, imported: puzzle, key: `scan-${Date.now()}` });
  };

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe}>
        {screen.name === 'home' ? (
          <HomeScreen onStart={openLevel} onScan={() => setScreen({ name: 'scan' })} />
        ) : null}

        {screen.name === 'scan' ? (
          <ScanScreen onCancel={() => setScreen({ name: 'home' })} onReady={playImported} />
        ) : null}

        {screen.name === 'game' ? (
          <GameScreen
            key={screen.key}
            level={screen.level}
            imported={screen.imported}
            onExit={() => setScreen({ name: 'home' })}
            onStart={openLevel}
            onScan={() => setScreen({ name: 'scan' })}
          />
        ) : null}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingTop: Platform.OS === 'android' ? RNStatusBar.currentHeight ?? 0 : 0,
  },
  safe: {
    flex: 1,
  },
});
