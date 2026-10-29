# Changelog

Todas as mudanças notáveis deste projeto são documentadas aqui.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/),
e o projeto usa [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [1.1.0] - 2026-10-29

### Adicionado

- Geocodificação reversa (`GET /api/reverse`): clique ou arraste no mapa mostra o
  endereço em vez de coordenadas.
- Instruções faladas em português na navegação, com botão para desligar.
- Tempo restante e hora prevista de chegada no banner de navegação.
- Janela "Sobre e limitações" com funcionamento do modelo, limitações e fontes.
- Explicação dos níveis de risco (relativos às ruas da cidade) nos cartões de rota.
- PWA: manifesto, ícones e service worker para a interface (a API nunca é cacheada).

## [1.0.0] - 2026-10-29

Primeira versão pública, reescrita sobre dados reais da cidade de São Paulo.

### Adicionado

- Rotas a pé e de carro com três opções (mais rápida, equilibrada e mais segura),
  calculadas com o risco por aresta sobre a malha do OpenStreetMap.
- Modelo de risco v2 com taxa por movimento (tipo de via) e iluminação pública do
  GeoSampa, por período do dia.
- Navegação passo a passo em português, com modo GPS: passo atual, aviso de saída
  de rota e recálculo.
- Compartilhamento de rota por link: origem, destino, modo, período e rota na URL.
- Histórico local das últimas 10 buscas, guardado só no navegador.
- Deploy gratuito: frontend na Vercel, API no Render e atualização mensal dos
  dados por GitHub Actions.

### Alterado

- Dados criminais passam a vir da SSP-SP (janela de 24 meses, anos 2024 a 2026),
  substituindo o grafo fictício do protótipo.
- Motor de rotas mais leve, com carga em segundo plano e `/api/health`.

### Fechamento

- Licença MIT (`LICENSE`) para o código, com as licenças dos dados em
  `docs/LICENCAS-DADOS.md`.
- Política de segurança de cabeçalhos no frontend: Content-Security-Policy e
  Permissions-Policy no `vercel.json`, e Subresource Integrity nas bibliotecas do CDN.
- Limite de requisições por IP na API, fila de cálculo com timeout (503) e logs
  estruturados por rota (sem coordenadas).
- Validação dos dados antes de publicar uma nova Release.
- Testes unitários do frontend (`node --test`), build do Docker e smoke test com
  Playwright no CI.
