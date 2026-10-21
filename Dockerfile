# Build SmartBasket's React frontend and Flask backend into one Railway service.
# Run this Dockerfile from the BeautifulSoup/ project directory.

# --------------------------- React frontend ---------------------------
FROM node:22-bookworm-slim AS react-builder
WORKDIR /source
COPY . .

# Support a React package.json in frontend/ (usual layout) or at project root.
RUN set -eu; \
    if [ -f frontend/package.json ]; then \
        cd frontend; \
    elif [ -f package.json ]; then \
        cd /source; \
    else \
        echo 'ERROR: React package.json not found in frontend/ or project root'; \
        exit 1; \
    fi; \
    if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; \
    else npm install --no-audit --no-fund; fi; \
    npm run build; \
    mkdir -p /react-output; \
    if [ -f dist/index.html ]; then \
        cp -a dist/. /react-output/; \
    elif [ -f build/index.html ]; then \
        cp -a build/. /react-output/; \
    else \
        echo 'ERROR: React build completed without dist/index.html or build/index.html'; \
        exit 1; \
    fi

# --------------------------- Flask backend ----------------------------
FROM python:3.11-slim-bookworm
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN python -m playwright install --with-deps chromium

COPY . .
COPY --from=react-builder /react-output/ /app/frontend/dist/

# The Railway service's public domain target port is 8080.
EXPOSE 8080
CMD ["sh", "-c", "exec gunicorn --chdir /app/backend app:app --bind 0.0.0.0:${PORT:-8080} --workers 1 --threads 4 --timeout 120"]
