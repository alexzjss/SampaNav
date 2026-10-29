# Identidade visual do SampaNav

## Conceito

A marca usa a linguagem de sinalização do **Metrô de São Paulo**:

- **Perfis como linhas**: cada perfil de rota é uma linha colorida com número (1, 2, 3), como no mapa da rede.
- **Rota a 45°**: o ícone desenha o trajeto com curvas de 45° e estações (círculos brancos com anel preto), de uma origem a um destino.
- **Passo a passo como estações**: no cartão selecionado, as instruções formam uma linha vertical na cor do perfil, com estações (anel maior na partida e na chegada, menor no meio).

Este é um trabalho inspirado na sinalização do Metrô; não usa logotipos nem marcas do Metrô.

## Paleta

| Cor | Hex | Uso | Contraste |
|---|---|---|---|
| Tinta | `#111111` | Texto, botão primário (pílula), `theme-color`, fundo do ícone | 18,9:1 no branco |
| Azul Linha 1 | `#0455A1` | Marca, links, foco, interruptores (`--accent`) | 7,45:1 no branco |
| Superfície | `#F4F5F7` | Fundo do app, cartões secundários | tinta: 17,3:1 |
| Borda | `#DDE0E6` | Divisores e contornos | decorativa |
| Texto secundário | `#545861` | Legendas e metadados | 7,13:1 no branco; 6,54:1 em `#F4F5F7` |

Modo escuro: fundo `#0F1115`, superfície `#17191E` / `#1F2229`, texto `#F1F2F4`, secundário `#A4A9B3` (7,46:1 na superfície), botão primário `#F4F5F7` com texto `#111111` (17,3:1), azul de links `#6FA8F0` (7,15:1), foco `#7DB4F5` (8,14:1). O círculo "S" da marca usa `#1F6FCB` (branco sobre ele: 5,01:1; contra a superfície: 3,51:1).

## Linhas (perfis)

Mapeamento único em `LINES` (`frontend/js/format.js`), espelhado em `--line-*` (`frontend/css/base.css`); um teste unitário garante que os dois coincidem.

| Perfil | Linha | Cor clara | Branco sobre ela | Cor escura | Dígito `#0B0D10` sobre ela | Contra a superfície escura |
|---|---|---|---|---|---|---|
| `rapida` | 1 · Azul | `#0455A1` | 7,45:1 | `#6AA8F0` | 7,85:1 | 7,09:1 |
| `equilibrada` | 2 · Lilás | `#6B3FA0` | 7,38:1 | `#B79CE6` | 8,26:1 | 7,46:1 |
| `segura` | 3 · Turquesa | `#00707A` | 5,84:1 | `#3FB6C0` | 8,03:1 | 7,25:1 |

No modo claro o círculo numerado é a cor da linha com dígito branco; no escuro, a variante clara com dígito escuro. O cartão selecionado tem borda de 2 px na cor da linha e fundo com 7% (claro) ou 12% (escuro) dessa cor sobre a superfície. As cores evitam vermelho, laranja, amarelo e verde para não competir com a escala de risco.

## Escala de risco (separada da marca)

`--risk-0` a `--risk-3` (verde, amarelo, laranja, vermelho) e os `--badge-*` pertencem aos dados e **não fazem parte da identidade**. A rota selecionada no mapa continua colorida por segmento de risco, as alternativas ficam em cinza neutro (`--route-muted`) e as cores das linhas nunca indicam risco.

## Tipografia

Pilha do sistema parecida com Helvetica: `"Helvetica Neue", Helvetica, Inter, Arial, system-ui, sans-serif`. Nenhuma fonte externa é carregada (a CSP não permite). O nome "SampaNav" usa peso 800 e espaçamento `-0,02em`, ao lado de um círculo azul com um "S" branco em negrito (`.brand-mark`, decorativo; o `<h1>` mantém o nome acessível "SampaNav").

## Uso do ícone

- `logo.svg` (cantos arredondados, `rx` 112 em 512) em telas e documentos; `favicon.svg` (versão simplificada: rota mais grossa e só o destino) para abas e tamanhos até 32 px, legível em 16 px.
- PNGs: `icon-192`, `icon-512` (cantos arredondados, transparência), `apple-touch-icon` (180 px, sem transparência, fundo preto) e `icon-maskable-512` (fundo preto até a borda).
- Maskable: todo o conteúdo fica dentro do círculo central de 80% (rota e estações reduzidas a 80%).
- Área livre mínima: 1/8 da largura do ícone. Não mude as cores, não gire e não coloque texto sobre o ícone.

## Arquivos

- `frontend/img/logo.svg`, `frontend/img/favicon.svg`
- `frontend/img/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`: PNGs derivados (renderizados com Chromium)
- `docs/img/brand/icon-maskable.svg`: fonte do ícone adaptativo
- `docs/img/brand/brand-sheet.png`: prancha da marca
- Tokens: `frontend/css/base.css` (`--accent`, `--btn-*`, `--brand`, `--line-*`); marca do painel: `.brand-*` em `frontend/css/layout.css`; cartões e estações: `frontend/css/components.css`
