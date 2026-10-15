# ==========================================
# Estágio 1: Build do Frontend Web (React + Vite)
# ==========================================
FROM node:22-bookworm-slim AS web-builder
WORKDIR /app/web
COPY web/package*.json ./
RUN npm install
COPY web/ ./
RUN npm run build

# ==========================================
# Estágio 2: Build do Backend TypeScript
# ==========================================
FROM node:22-bookworm-slim AS server-builder
WORKDIR /app
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json tsconfig.json ./
RUN npm install
COPY src/ ./src
RUN npm run build:server

# ==========================================
# Estágio 3: Runtime de Produção
# ==========================================
FROM node:22-bookworm-slim AS runner
WORKDIR /app

# Instalar FFmpeg necessário para decodificação de áudio WhatsApp Opus/OGG
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=8765
ENV DATA_DIR=/app/data

COPY package*.json ./
RUN npm install --omit=dev

# Copiar arquivos compilados do backend e do frontend
COPY --from=server-builder /app/dist ./dist
COPY --from=web-builder /app/web/dist ./web-dist

# Volume de persistência
VOLUME ["/app/data"]

EXPOSE 8765

CMD ["node", "dist/index.js"]
