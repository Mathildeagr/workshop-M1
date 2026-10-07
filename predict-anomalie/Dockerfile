# Deux etapes : les dependances sont installees a part du code, pour que modifier
# une ligne de Python ne reinstalle pas scikit-learn.
FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim AS builder

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /app

RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --locked --no-install-project --no-dev

COPY src ./src
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --locked --no-dev


FROM python:3.13-slim-bookworm

# Compte sans privilege : la brique ne lit que le bus et n'ecrit que ses deux tables.
RUN groupadd --gid 1000 sentinel \
 && useradd --uid 1000 --gid 1000 --create-home sentinel \
 && mkdir -p /var/lib/predict-anomalie \
 && chown sentinel:sentinel /var/lib/predict-anomalie

COPY --from=builder --chown=sentinel:sentinel /app /app

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PREDICT_MODEL_DIR=/var/lib/predict-anomalie

USER sentinel
WORKDIR /app
EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request as r, sys; sys.exit(0 if r.urlopen('http://127.0.0.1:8000/health', timeout=4).status == 200 else 1)"

CMD ["python", "-m", "predict_anomalie"]
