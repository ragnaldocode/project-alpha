# Project Alpha — Sudoku

App mobile de Sudoku em **Expo + React Native + TypeScript**. Doze níveis com dificuldade
progressiva; cada tabuleiro é gerado na hora, aleatoriamente, com **solução única**. Também é
possível **jogar a partir de uma foto**: o app lê o tabuleiro impresso (OCR próprio, sem serviço
externo) e transfere os números para a tela.

## Como rodar

```bash
npm install
npm start          # Expo Dev Server (QR no terminal)
npm run android    # emulador/dispositivo Android
npm run web        # navegador
```

Checagens:

```bash
npm run typecheck   # tsc --noEmit
npm run verify      # gerador + leitor de fotos
npm run verify:ocr  # só o leitor de fotos (templates, decodificador PNG, fixtures)
npm run check       # typecheck + verify
```

## Estrutura

```
App.tsx                       # máquina de estados: Home → (Nível | Leitor) → Jogo
src/
  game/sudoku.ts              # lógica pura: gerador, solver, soluções, conflitos, grade → puzzle
  state/useSudoku.ts          # estado do jogo: tabuleiro, seleção, erros, dicas, timer
  components/Board.tsx        # grade 9x9 (revelados, erros, pares realçados, células a conferir)
  components/NumberPad.tsx    # teclado 1–9 + apagar, com contagem restante
  screens/HomeScreen.tsx      # entrada do leitor + lista dos 12 níveis
  screens/GameScreen.tsx      # jogo, cabeçalho de status, tela de vitória
  screens/ScanScreen.tsx      # foto → leitura → conferência/correção → jogo
  ocr/recognize.ts            # visão computacional pura: linhas, giro, perspectiva, dígitos
  ocr/templates.ts            # 72 glifos de referência (4 fontes × 2 pesos × 1–9)
  ocr/png.ts                  # decodificador PNG (base64 → pixels) para o caminho nativo
  ocr/loadBitmap.ts|.web.ts   # foto → bitmap em tons de cinza, por plataforma
  ocr/scan.ts                 # serviço: foto → grade + confiança por célula
  theme.ts                    # cores/espaçamento
scripts/verify-generator.mjs  # verificação do gerador no Node
scripts/verify-ocr.mjs        # verificação do leitor de fotos no Node
scripts/generate-templates.mjs # regera src/ocr/templates.ts a partir de um JSON de glifos
scripts/fixtures/             # imagens de teste + manifest com a grade esperada
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

## Ler o tabuleiro de uma foto

Na tela inicial, **Ler foto do Sudoku** → tirar foto (ou escolher da galeria) → o app mostra o
tabuleiro lido para conferência → **Jogar este tabuleiro**. A partida é a mesma dos níveis:
erros, dicas, cronômetro, detecção de vitória.

Tudo roda **no aparelho**, sem servidor e sem chave de API: o reconhecimento é um módulo TypeScript
puro (`src/ocr/recognize.ts`), o que também permite verificá-lo no Node.

### Como a leitura funciona

1. **Foto → pixels**: reduz para 1000 px de largura (célula ≈ 110 px). No nativo isso é
   `expo-image-manipulator` (com redução já na decodificação, para não estourar memória com foto de
   12 MP) → PNG em base64 → decodificador PNG em JS (`fflate` + desfiltro das 5 variantes). Na web,
   `canvas.getImageData`.
2. **Máscara de tinta adaptativa**: cada pixel é comparado com a média da vizinhança (integral
   image), não com um limiar global. Isso é o que faz as linhas **finas e claras** do Sudoku
   aparecerem e, ao mesmo tempo, impede que vinheta/sombra marquem a página inteira como tinta.
3. **Localizar as 10 linhas**: perfis de tinta com tolerância a falhas curtas + um critério de
   cobertura (linha fina desenhada em posição sub-pixel sai quebrada em pedaços mas cobre a
   travessia inteira; dígitos não). Se a grade estiver torta, o giro é estimado pela nitidez das
   projeções e a imagem é endireitada — **expandindo a tela** para não cortar as bordas.
4. **Ajuste fino por linha**: as 10 posições são refinadas junto com **um** parâmetro de
   perspectiva por eixo (as linhas convergem para o centro proporcionalmente à distância dele).
   Modelar a perspectiva globalmente é o que evita uma linha "pular" para a faixa da vizinha.
5. **Célula → dígito**: cada célula é recortada como quadrilátero (amostragem bilinear, então
   perspectiva deixa de importar), tinta é separada com Otsu local, ruído é descartado por
   componente conexo, o glifo é normalizado para 24×24 e comparado com 72 templates (4 fontes ×
   normal/negrito) por distância + buracos fechados (0/6/9 têm 1, 8 tem 2) + proporção.
6. **Conferência obrigatória**: cada célula volta com confiança; as duvidosas aparecem em amarelo e
   podem ser corrigidas antes de jogar. Números repetidos aparecem em vermelho e o app **não deixa
   começar** enquanto houver conflito; tabuleiro com mais de uma solução pede confirmação.

### Limites (medidos, não estimados)

`npm run verify:ocr` roda 11 imagens geradas com fontes que **não** estão nos templates, com giro
(1,5° a 3,2°), perspectiva (16% de afunilamento), desfoque, grão e vinheta:

| Cenário | Resultado |
|---|---|
| 8 digitalizações/fotos dentro do envelope (inclui perspectiva e giro) | 81/81 células corretas |
| imagem sem tabuleiro | recusada (não inventa grade) |
| 600 px com desfoque de 1,5 px / 400 px com 1,7 px | recusadas com mensagem para refazer a foto |

Ou seja: **o tabuleiro precisa de ~50 px por célula e foco razoável**. Em foto de celular (reduzida
para 1000 px) a célula fica com ~110 px e o desfoque efetivo é ~10× menor que o do caso recusado.
Dígitos **manuscritos** não são suportados — os templates são de fonte tipográfica.

### Verificação

```bash
npm run verify:ocr
```

Cobre três camadas: o decodificador PNG (ida e volta em todos os filtros de linha e tipos de cor),
os 72 templates (cada glifo precisa voltar como ele mesmo, inclusive deslocado 1 px) e as fixtures
de foto (acerto exato célula por célula, preservação das células vazias e recusa dos casos ilegíveis).

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

- Detecção de quadrilátero (4 cantos) para perspectiva muito forte, e recorte manual da foto.
- Persistir progresso e melhores tempos (`expo-sqlite` ou `AsyncStorage`).
- Modo notas (marcações a lápis) e destaque de candidatos.
- Técnicas de geração para reduzir revelados abaixo de 24.
- Build EAS (`eas build`) e publicação.
