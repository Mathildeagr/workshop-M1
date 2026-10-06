# Dashboard Sentinel-X : build Angular, puis fichiers statiques servis par nginx

# --- Étape 1 : build ---
FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx ng build --configuration production

# --- Étape 2 : image finale (sans Node ni sources, uniquement le résultat du build) ---
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/dashboard/browser /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
    CMD wget -qO- http://127.0.0.1/ > /dev/null || exit 1
