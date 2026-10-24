# Project Alpha — Sudoku

App mobile de Sudoku em **Expo + React Native + TypeScript**. Doze níveis com dificuldade
progressiva; cada tabuleiro é gerado na hora, aleatoriamente, com **solução única**.

## Como rodar

```bash
npm install
npm start          # Expo Dev Server (QR no terminal)
npm run android    # emulador/dispositivo Android
npm run web        # navegador
```

Checagens:

```bash
npm run typecheck  # tsc --noEmit
npm run verify     # valida o gerador (12 níveis, unicidade, determinismo)
npm run check      # os dois
```

## Estrutura

```
App.tsx                      # alterna Home → Jogo (sem lib de navegação)
src/
  game/sudoku.ts             # lógica pura: gerador, solver, contagem de soluções, conflitos
  state/useSudoku.ts         # estado do jogo: tabuleiro, seleção, erros, dicas, timer
  components/Board.tsx       # grade 9x9 (revelados, erros, pares realçados)
  components/NumberPad.tsx   # teclado 1–9 + apagar, com contagem restante
  screens/HomeScreen.tsx     # lista dos 12 níveis
  screens/GameScreen.tsx     # jogo, cabeçalho de status, tela de vitória
  theme.ts                   # cores/espaçamento
scripts/verify-generator.mjs # verificação do gerador rodando no Node
```

## Níveis e dificuldade

| Nível | Dificuldade | Números revelados |
|---|---|---|
| 1–3 | Fácil | 42, 40, 38 |
| 4–6 | Médio | 36, 34, 32 |
| 7–9 | Difícil | 30, 29, 28 |
| 10–12 | Especialista | 26, 25, 24 |

Como funciona a geração (`generatePuzzle`):

1. Preenche um tabuleiro vazio por backtracking com ordem de dígitos aleatória (seed determinística).
2. Remove números um a um; cada remoção só é aceita se o tabuleiro continuar com **exatamente
   uma** solução (`countSolutions` com corte em 2).
3. A remoção gulosa satura — nem toda solução permite chegar a 24 revelados. Por isso o gerador
   tenta até 12 seeds e fica com a melhor tentativa; na prática 24 revelados é atingido em 100%
   das amostras medidas (40/40, pior caso 91 ms).

O mínimo teórico de um Sudoku com solução única é 17 revelados, mas atingi-lo exige técnicas de
busca mais caras do que a remoção gulosa — por isso o piso do jogo é 24.

## Testar no celular pela rede (Tailscale)

No computador, com o app rodando:

```bash
REACT_NATIVE_PACKAGER_HOSTNAME=$(tailscale ip -4) npx expo start
```

Ou, para uma URL HTTPS estável (funciona com dev build em qualquer rede):

```bash
npx expo start --port 8081
tailscale serve --bg 8081      # https://<maquina>.<tailnet>.ts.net
```

## Próximos passos

- Persistir progresso e melhores tempos (`expo-sqlite` ou `AsyncStorage`).
- Modo notas (marcações a lápis) e destaque de candidatos.
- Técnicas de geração para reduzir revelados abaixo de 24.
- Build EAS (`eas build`) e publicação.
