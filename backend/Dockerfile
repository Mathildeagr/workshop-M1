# API Sentinel-X (Node.js / Express)
FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production

# Dépendances d'abord : la couche reste en cache tant que package*.json ne change pas
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

# Jamais en root dans le conteneur (durcissement)
USER node

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1:3000/api/v1/health > /dev/null || exit 1

# Les secrets (DATABASE_URL, JWT_SECRET...) sont fournis par compose, jamais copiés dans l'image
CMD ["node", "src/server.js"]
