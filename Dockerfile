FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.13.1 /uv /usr/local/bin/uv
# Bytecode pré-compilado: no Render free (0.1 CPU) os imports são a maior parte do startup.
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONUNBUFFERED=1
WORKDIR /app

# Só as dependências da API, nas versões do uv.lock (o pipeline roda fora do container).
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-default-groups
ENV PATH="/app/.venv/bin:$PATH"

COPY pipeline/__init__.py pipeline/config.py pipeline/
COPY backend backend
COPY frontend frontend

# Dados (grafos + risco) da GitHub Release mais recente. ADD com URL rebaixa o
# arquivo a cada build e invalida o cache quando o conteúdo muda, então a
# atualização mensal dos dados chega no próximo deploy.
ARG DATA_URL=https://github.com/alexzjss/SampaNav/releases/latest/download/sampanav-data.tar.gz
ADD ${DATA_URL} /tmp/sampanav-data.tar.gz
RUN mkdir -p data/processed && tar -xzf /tmp/sampanav-data.tar.gz -C data/processed && rm /tmp/sampanav-data.tar.gz

ENV SAMPANAV_BACKGROUND_LOAD=1 MALLOC_ARENA_MAX=2 PORT=10000
EXPOSE 10000
CMD ["sh", "-c", "exec uvicorn backend.app.main:app --host 0.0.0.0 --port ${PORT} --no-access-log"]
