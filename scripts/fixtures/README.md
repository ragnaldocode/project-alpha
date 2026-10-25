# Fixtures do leitor de fotos

Imagens usadas por `npm run verify:ocr` para medir a leitura de Sudoku a partir
de foto. São **artefatos versionados** (PNG em tons de cinza): o teste roda no
Node puro, sem navegador, então a imagem de entrada precisa existir no
repositório.

## Como cada uma foi gerada

Todas foram desenhadas em um canvas do Chrome (`ctx.fillText` + `stroke` das
linhas) e exportadas com `canvas.toDataURL('image/png')`, depois convertidas
para PNG de 1 canal. A receita é sempre a mesma:

1. fundo branco `#ffffff`, tabuleiro quadrado, `cell = lado / 9`;
2. linhas finas (`i % 3 != 0`) e linhas grossas (`i % 3 == 0`) com cores e
   espessuras diferentes por fixture (`thinW` / `thickW`);
3. dígitos com `textAlign: center`, `textBaseline: middle`, tamanho
   `cell * 0.66` (ou `digitScale`);
4. defeitos, aplicados nesta ordem: `ctx.filter = blur(Npx)` no desenho,
   rotação (`ctx.rotate`), perspectiva (redesenho em 96 faixas horizontais com
   escala horizontal variando de `kTop` a `kBottom`), grão em baixa frequência
   (ruído gerado em `lado/5` e ampliado) e vinheta (gradiente radial).

Os parâmetros de cada imagem estão em `manifest.json`, no campo `render`, junto
com a grade que o leitor **deve** devolver.

## O que cada fixture cobre

| Fixture | Fonte | O que testa |
|---|---|---|
| `clean-lato` | Lato 400 | caso base, linhas finas de 1 px |
| `serif-merriweather` | Merriweather 400 | serifa, linhas cinzas claras |
| `mono-bold` | DejaVu Sans Mono 700 | monoespaçada, linhas grossas, linhas finas sub-pixel |
| `photo-lato` | Lato 700 | foto: giro de 1,5°, grão, vinheta |
| `photo-serif-tilt` | Merriweather 700 | giro de 3,2°, desfoque forte, vinheta |
| `mono-tilt-margin` | DejaVu Sans Mono 400 | giro negativo, margem em volta do tabuleiro |
| `persp-trap` | Lato 400 | perspectiva (16% de afunilamento no topo) |
| `dense-print` | Lato 700 | células apertadas, dígitos grandes (0,82 da célula) |
| `smudges` | Lato 700 | manchas de papel em células vazias (não podem virar número) |
| `no-grid` | Lato 400 | controle negativo: texto sem tabuleiro |
| `lowres-blur` | Merriweather 400 | fora do envelope: 600 px com desfoque 1,5 px |
| `tiny-400` | Lato 400 | fora do envelope: 400 px com desfoque 1,7 px |

As fontes usadas aqui **não** fazem parte dos templates do classificador
(`src/ocr/templates.ts` usa DejaVu Sans, Roboto, Noto Sans e Open Sans), então a
leitura é testada contra formas que o app nunca viu.

`smudges` usa a expectativa `no-invented`: todo número devolvido precisa existir
na foto (faltar é aceitável, inventar não).

`lowres-blur` e `tiny-400` ficam fora do envelope de qualidade, com a expectativa
`no-garbage`: "recusar é aceitável, devolver tabuleiro errado com confiança não
é".

## Como verificar

```bash
npm run verify:ocr
```

## Como regenerar

Não há script porque depende de rasterização de fonte real no navegador (Node
não tem fontes). Para refazer: abra o Chrome, execute o trecho de canvas descrito
acima com os parâmetros de `manifest.json` e salve cada PNG em tons de cinza de
1 canal sobre o arquivo correspondente. Alterar uma fixture exige atualizar a
grade esperada em `manifest.json` — o teste compara célula por célula.
