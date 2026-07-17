# Code-Detektiv — reine Client-App (React 19 + Vite). Bauen, statisch ausliefern.
# Eigener Container statt in apps/web integriert: andere React-/Vite-Version,
# ein Merge waere Abhaengigkeitsrisiko ohne Gewinn.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --include=dev
COPY . .
RUN npx vite build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html/code-detektiv-app
# SPA: alle Pfade unter /code-detektiv-app/ auf index.html (BrowserRouter).
RUN printf 'server {\n  listen 3000;\n  root /usr/share/nginx/html;\n  location /code-detektiv-app/ {\n    try_files $uri $uri/ /code-detektiv-app/index.html;\n  }\n}\n' > /etc/nginx/conf.d/default.conf
EXPOSE 3000
