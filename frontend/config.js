// Configuração em tempo de deploy. apiBase vazio = mesma origem (o backend serve o frontend).
// Em produção (Vercel) aponta para a API no Render (sem barra final). Rodando localmente
// (uvicorn, http.server, capturas, testes), usa a mesma origem.
window.SAMPANAV_CONFIG = {
  apiBase: /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) ? '' : 'https://sampanav-api.onrender.com',
};
