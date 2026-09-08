FROM python:3.11-slim

WORKDIR /app

# Install system dependencies and core libraries required by Playwright Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libffi-dev \
    libssl-dev \
    curl \
    git \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

# Copy and install python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install only the Chromium browser binary without triggering internal apt scripts
RUN playwright install chromium

# Copy the rest of the application source code
COPY . .

# Expose default web port
EXPOSE 5000

# Run production WSGI server via Gunicorn
CMD gunicorn app:app --bind 0.0.0.0:${PORT:-5000} --workers 2 --threads 4 --timeout 120