FROM node:20-slim

RUN apt-get update && apt-get install -y \
    build-essential \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    libpixman-1-dev \
    pkg-config \
    python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm install tsx typescript @types/node @types/pdfkit

COPY tsconfig.json bot.ts ./
COPY commands/ ./commands/

RUN mkdir -p data

ENV BOT=clover
CMD ["npx", "tsx", "bot.ts"]
