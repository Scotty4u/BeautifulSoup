FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for compilation and Playwright headless browsers
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libffi-dev \
    libssl-dev \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copy and install python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Playwright browser binaries and OS-level dependencies for scraping
RUN playwright install --with-deps

# Copy the rest of the application source code
COPY . .

# Expose default web port
EXPOSE 5000

# Run production WSGI server via Gunicorn
CMD gunicorn app:app --bind 0.0.0.0:${PORT:-5000} --workers 2 --threads 4 --timeout 120