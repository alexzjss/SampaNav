# Guia pós-deploy

O frontend já está em <https://sampanav.vercel.app>. Este guia lista o que falta para o
app funcionar de ponta a ponta e ficar redondo, na ordem em que vale fazer. Os itens
marcados como **obrigatório** impedem o app de calcular rotas se ficarem para trás.

## 1. API no Render (obrigatório)

O frontend na Vercel é só HTML, CSS e JS. As rotas vêm da API, que roda no Render.

1. Em <https://dashboard.render.com>, clique em **New → Blueprint** e escolha o
   repositório `alexzjss/SampaNav`. O Render lê o `render.yaml` e cria o serviço
   `sampanav-api` (Docker, plano free).
2. Quando ele pedir `ALLOWED_ORIGINS`, preencha com a origem do frontend, **sem barra no
   final**:

   ```
   https://sampanav.vercel.app
   ```

   Se usar mais de um domínio (por exemplo, um domínio próprio), separe por vírgula.
3. Espere o primeiro build. Ele baixa os dados da Release mais recente
   (`sampanav-data.tar.gz`, ~40 MB), então leva alguns minutos.
4. Anote a URL do serviço, algo como `https://sampanav-api.onrender.com`. Se o nome já
   estiver em uso no Render, ele recebe um sufixo (`sampanav-api-xxxx.onrender.com`).
5. Teste no navegador: `https://<sua-api>.onrender.com/api/health` deve responder
   `{"status": "ok", ...}` com `walk`, `drive` e `bike` com nós e arestas acima de zero.

## 2. Apontar o frontend para a API (obrigatório)

Hoje `frontend/config.js` está com `apiBase: ''`. Com esse valor, o site chama `/api` no
próprio domínio da Vercel, onde não há API, e fica preso em "Acordando o servidor".

1. Edite `frontend/config.js`:

   ```js
   window.SAMPANAV_CONFIG = { apiBase: 'https://<sua-api>.onrender.com' };
   ```

   Sem barra no final.
2. Faça commit na `main`. A Vercel publica sozinha, e o `vercel.json` já manda o
   navegador não guardar o `config.js` em cache.
3. A CSP do `vercel.json` já libera `https://*.onrender.com` em `connect-src`. Se um dia
   a API sair do Render (outro host ou domínio próprio), acrescente o host novo ali,
   senão o navegador bloqueia as chamadas.

## 3. Conferir se está tudo de pé

Abra <https://sampanav.vercel.app> e confira:

- [ ] O aviso "Acordando o servidor" some em até 1 a 2 minutos (cold start do plano free).
- [ ] O rodapé mostra o período dos dados ("01/09/2024 a 31/08/2026" ou mais recente).
- [ ] A busca de endereço sugere resultados, e clicar no mapa mostra o endereço.
- [ ] "Calcular rotas" funciona nos modos A pé, Carro e Bike.
- [ ] O mapa de risco aparece com zoom 12 ou mais.
- [ ] No celular: o painel inferior funciona, "Iniciar navegação" pede a localização e
      o banner aparece.
- [ ] O console do navegador (F12) não mostra erros de CORS nem de CSP.

Se aparecer erro de **CORS**, o `ALLOWED_ORIGINS` no Render não bate exatamente com a
origem do site (atenção a `https://`, `www.` e barra no final). Corrija em
**Render → sampanav-api → Environment** e salve (ele reinicia sozinho).

Também dá para conferir o CORS pelo terminal:

```bash
curl -si https://<sua-api>.onrender.com/api/meta -H 'Origin: https://sampanav.vercel.app' | grep -i access-control-allow-origin
```

A resposta deve trazer `access-control-allow-origin: https://sampanav.vercel.app`.

## 4. Atualização mensal dos dados

O workflow **Atualização mensal dos dados** roda todo dia 10 e publica uma Release nova,
mas só se a validação passar.

1. Em **GitHub → Settings → Actions → General → Workflow permissions**, deixe marcado
   **Read and write permissions**. O workflow precisa disso para criar a Release.
2. No Render, abra **sampanav-api → Settings → Deploy Hook** e copie a URL.
3. No GitHub, em **Settings → Secrets and variables → Actions → New repository secret**,
   crie `RENDER_DEPLOY_HOOK_URL` com essa URL. Assim o deploy roda logo depois de cada
   Release nova. Sem o segredo, os dados novos só entram no próximo deploy manual.
4. Rode uma vez na mão para testar: **Actions → Atualização mensal dos dados → Run
   workflow**. Se a validação reprovar, o resumo da execução diz por quê, e nenhuma
   Release é publicada.

## 5. Conferir o limite de requisições por IP

A API limita requisições por IP, e o IP vem do primeiro valor do cabeçalho
`X-Forwarded-For`. Falta confirmar como o proxy do Render preenche esse cabeçalho, porque
um cliente pode tentar forjá-lo. Teste com 25 requisições, cada uma com um IP inventado
diferente:

```bash
API=https://<sua-api>.onrender.com
for i in $(seq 1 25); do
  curl -s -o /dev/null -w "%{http_code} " -X POST "$API/api/routes" \
    -H 'Content-Type: application/json' -H "X-Forwarded-For: 10.0.0.$i" \
    -d '{"origin":{"lat":-23.5503,"lon":-46.6339},"destination":{"lat":-23.5614,"lon":-46.6559},"mode":"walk"}'
done; echo
```

- **Aparece `429` depois de umas 20 respostas `200`**: o Render sobrescreve o cabeçalho e
  o limite funciona. Nada a fazer.
- **Só aparece `200`**: o IP inventado está sendo aceito e o limite pode ser contornado.
  Nesse caso, peça para ajustar `client_ip` em `backend/app/ratelimit.py` para usar a
  entrada adicionada pelo proxy (a última da lista, ou a penúltima se houver dois
  proxies), e repita o teste.

## 6. Cold start do plano free (opcional)

A API dorme depois de 15 minutos sem uso, e a primeira visita espera de 1 a 2 minutos. O
app já mostra o aviso e abre a interface na hora (PWA). Se quiser evitar a espera:

- Um monitor gratuito (UptimeRobot, Better Stack) chamando `/api/health` a cada 10 minutos
  mantém a API acordada. O plano free do Render dá 750 horas por mês, o suficiente para
  um serviço ligado o mês todo. Confira os termos de uso do Render antes.
- O plano pago mais barato do Render elimina o sono e dá mais CPU, o que também acelera o
  cálculo de rotas longas.

## 7. Acabamento do repositório (opcional, recomendado para portfólio)

- [ ] Em **About** (engrenagem na página do repositório): descrição curta, **Website**
      `https://sampanav.vercel.app` e tópicos (`sao-paulo`, `routing`, `fastapi`,
      `maplibre`, `openstreetmap`, `h3`, `pwa`).
- [ ] Em **Settings → General → Social preview**, envie `docs/img/hero-desktop.png`. É a
      imagem que aparece quando o link do repositório é compartilhado.
- [ ] Em **Settings → Branches**, proteja a `main` exigindo os checks do CI (`test`,
      `frontend`, `docker`, `smoke`) antes do merge.
- [ ] Confirme os termos de uso do GeoSampa e atualize `docs/LICENCAS-DADOS.md`, que
      ainda diz "verificar termos de uso".
- [ ] Teste a instalação como app no celular: no Chrome (Android), "Instalar app"; no
      Safari (iOS), "Compartilhar → Adicionar à Tela de Início".
- [ ] Se quiser, regere as capturas do README com os tiles reais, num computador com
      internet: `BASEMAP=real tools/screenshots/run.sh <pasta_dos_dados>`.

## 8. Domínio próprio (opcional)

1. Na Vercel: **Project → Settings → Domains → Add**, e siga as instruções de DNS.
2. Acrescente o novo domínio a `ALLOWED_ORIGINS` no Render (separado por vírgula).
3. A API pode continuar em `onrender.com`. Se também ganhar domínio próprio, troque o
   `apiBase` em `frontend/config.js` e acrescente o host na `connect-src` da CSP no
   `vercel.json`.

## Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Fica em "Acordando o servidor" e depois "Não foi possível contatar o servidor" | `apiBase` vazio ou errado, ou a API fora do ar | Passos 1 e 2; abrir `/api/health` direto |
| Erro de CORS no console | `ALLOWED_ORIGINS` diferente da origem do site | Passo 3 |
| Erro de CSP em `connect-src` no console | API fora de `*.onrender.com` | Acrescentar o host no `vercel.json` |
| "Muitas requisições; aguarde um instante." | Limite por IP (20 rotas por minuto) | Esperar; ajustar `SAMPANAV_RATE_ROUTES` no Render se for legítimo |
| "Servidor ocupado" com frequência | Cálculos longos em fila na CPU do plano free | Plano pago ou `SAMPANAV_ROUTE_QUEUE_TIMEOUT` maior |
| Busca de endereço não responde | Photon (komoot) instável ou limitando | Temporário; o clique no mapa continua funcionando |
| Interface antiga depois de um deploy | Service worker | O app mostra "Nova versão disponível"; recarregar |
| Workflow mensal falha em "Validar dados" | SSP mudou o formato ou ainda não publicou o mês | Ler o resumo da execução; a Release anterior continua no ar |
