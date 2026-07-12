# ── Этап 1: сборка клиента ──────────────────────────────────
FROM node:20-alpine AS client-build
WORKDIR /build
COPY client/package*.json ./
RUN npm install
COPY client/ ./
RUN npm run build

# ── Этап 2: прод-образ ──────────────────────────────────────
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/app/data \
    TZ_OFFSET_HOURS=8 \
    PORT=3000

COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev

COPY server/ ./server/
COPY --from=client-build /build/dist ./client/dist

VOLUME /app/data
EXPOSE 3000

CMD ["node", "server/src/index.js"]
