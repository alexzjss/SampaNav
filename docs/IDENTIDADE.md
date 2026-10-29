# Identidade visual do SampaNav

## Conceito

A marca mistura três símbolos paulistanos:

- **Piso paulista**: o calçadão preto e branco criado por **Mirthes Bernardes** em 1966, inspirado no contorno do estado de São Paulo. Peças idênticas, pretas e brancas, em forma de "Z" (bordas horizontais unidas por diagonais de 45°), se encaixam em fileiras que formam ondas diagonais. No ícone, o piso é o "chão" e uma **rota azul** o atravessa, de uma origem (círculo branco) a um destino (ponto vermelho). Este trabalho é uma releitura em geometria SVG, inspirada no desenho original de Mirthes Bernardes.
- **Placas de rua**: azul com borda branca fina e letras brancas condensadas. O nome no cabeçalho do painel imita essa placa.
- **Metrô**: o azul da placa é próximo ao da Linha 1-Azul.

## Paleta

| Cor | Hex | Uso |
|---|---|---|
| Preto piso | `#111111` | Peças pretas do piso, contorno do ícone |
| Off-white | `#F5F3EE` | Peças claras do piso, `theme_color`/fundo do manifest |
| Azul placa | `#0455A1` | Ação primária (`--accent`), placa, `theme-color` claro. Branco sobre ele: 7,45:1 |
| Azul claro | `#6FA8F0` | `--accent` no modo escuro. Texto `#0B1220` sobre ele: 7,61:1 |
| Vermelho MASP | `#D62E2E` | Apenas o ponto de destino do ícone; uso raro |

Contrastes (WCAG): azul placa sobre fundo claro `#F5F4F0` 6,77:1; azul claro sobre superfície escura `#1B2029` 6,64:1; texto secundário `#5A5F69` sobre `#F5F4F0` 5,83:1. Todos AA.

## Escala de risco (separada da marca)

`--risk-0` a `--risk-3` (verde, amarelo, laranja, vermelho) e os `--badge-*` pertencem aos dados do mapa e **não fazem parte da identidade**. Não use essas cores na marca nem o azul/vermelho da marca para indicar risco.

## Uso do ícone

- Use `logo.svg` (cantos arredondados) em telas e documentos; `favicon.svg` (simplificado, legível em 16 px) para abas e ícones pequenos (até 32 px).
- Para ícones adaptativos (maskable) o conteúdo fica dentro do círculo central de 80%.
- Não gire o piso, não troque suas cores, não altere a rota nem coloque texto sobre o piso.
- Área livre mínima: 1/8 da largura do ícone.
- A faixa de piso na interface (topo do painel e do diálogo "Sobre") é decorativa, com opacidade reduzida, e nunca fica atrás de texto.
- A fonte da placa usa pilha do sistema (Arial Narrow / Roboto Condensed / Arial), sem carregar fontes externas.

## Arquivos

- `frontend/img/logo.svg`: marca principal
- `frontend/img/favicon.svg`: variante simplificada
- `frontend/img/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png` (180): PNGs derivados
- `docs/img/brand/piso.svg`: tile contínuo do piso (4×4, peças em "Z" com bordas horizontais e diagonais de 45°)
- `docs/img/brand/icon-maskable.svg`: fonte do ícone adaptativo (sem cantos arredondados)
- `docs/img/brand/brand-sheet.png`: prancha da marca
- Tokens: `frontend/css/base.css` (`--accent`, `--sign-*`, `--piso-strip`); placa: `.brand-sign` em `frontend/css/layout.css`
