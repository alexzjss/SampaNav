# Changelog

Todas as mudanças notáveis deste projeto são documentadas aqui.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/),
e o projeto usa [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [1.4.2] - 2026-10-29

### Corrigido

- Reserva do IP do cliente (quando falta `CF-Connecting-IP`) passa a usar a 3ª entrada
  do `X-Forwarded-For` a partir do fim, que é a cadeia medida no Render
  (cliente, borda do Cloudflare, rede interna). O caminho principal da 1.4.1, via
  `CF-Connecting-IP`, foi conferido em produção e está correto.

## [1.4.1] - 2026-10-29

### Corrigido

- Limite de requisições por IP podia ser contornado com `X-Forwarded-For` forjado
  (confirmado em produção). A API usa `CF-Connecting-IP` (Cloudflare, na frente do
  Render) e, sem ele, a última entrada do `X-Forwarded-For`.

### Alterado

- Capturas do README regeradas sobre o mapa real do OpenFreeMap.

## [1.4.0] - 2026-10-29

### Alterado

- Nova identidade visual inspirada na sinalização do Metrô de SP: ícone com rota a 45°
  e estações, marca "S" na Linha 1 Azul, perfis como linhas numeradas (1 Rápida · Azul,
  2 Equilibrada · Lilás, 3 Segura · Turquesa) e passo a passo desenhado como estações.
- Botões principais em pílula preta; tipografia de sistema estilo Helvetica.
- Frontend aponta para a API no Render (`sampanav-api.onrender.com`), com mesma origem
  em `localhost`.

### Adicionado

- `docs/GUIA-POS-DEPLOY.md` e `docs/IDENTIDADE.md`, com a folha da marca em
  `docs/img/brand/`.

## [1.3.0] - 2026-10-29

### Adicionado

- README com capturas reais, GIF da navegação, diagrama da arquitetura e números.
- `tools/screenshots`: regera as capturas com o backend e os dados reais.
- Aviso "Nova versão disponível" quando o service worker atualiza.
- Mensagens amigáveis para 429, erros 5xx e tempo esgotado.

### Corrigido

- `NaN` no corpo de `/api/routes` dava 500 (agora 422).
- `X-Forwarded-For` aceito só quando é um IP válido.
- Falha na carga dos grafos em segundo plano ficava como "loading" para sempre.
- `996 m` aparecia como "1000 m" nas instruções.
- Corridas no frontend: resposta antiga sobrescrevendo a nova ao trocar modo ou pontos.
- Rotas escondidas atrás do painel no celular ao enquadrar o mapa.
- Marcador do usuário sem papel acessível (axe agora sem violações).

### Alterado

- Memória da API com os três modos de ~415 para ~330 MB (parquet de risco lido sem o
  pool do Arrow).
- Service worker network-first para HTML, JS e CSS (`sampanav-shell-v3`).

## [1.2.0] - 2026-10-29

### Adicionado

- Modo bicicleta, derivado da malha a pé (sem dados novos), com trechos empurrando a
  bike em calçadões e escadas.
- Parada intermediária opcional (`via`), com passo de chegada à parada.
- Exposição e nível de risco da rota em cada período do dia, no cartão da rota.
- Exportação da rota em GPX.

### Alterado

- Limiares de nível por período calculados em segundo plano após a carga dos grafos.
- Cache do service worker passa a `sampanav-shell-v2`.

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
