import { useState } from 'react';
import { Platform, SafeAreaView, StatusBar as RNStatusBar, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { GameScreen } from './src/screens/GameScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { colors } from './src/theme';

export default function App() {
  const [level, setLevel] = useState<number | null>(null);

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe}>
        {level === null ? (
          <HomeScreen onStart={setLevel} />
        ) : (
          <GameScreen
            key={`level-${level}`}
            level={level}
            onExit={() => setLevel(null)}
            onStart={setLevel}
          />
        )}
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
