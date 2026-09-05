# Beide Images auf den Digest festgenagelt: bewegliche Tags machen zwei Builds
# vom selben Commit unterschiedlich. Tag bleibt stehen, damit lesbar ist, was
# gemeint ist. Neu holen (Index-Digest, gilt fuer amd64 UND arm64):
#   N=node T=26-slim; TOKEN=$(curl -s "https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/$N:pull" | python3 -c "import json,sys;print(json.load(sys.stdin)['token'])"); curl -sI -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json" "https://registry-1.docker.io/v2/library/$N/manifests/$T" | grep -i docker-content-digest
FROM node:26-slim@sha256:4ebb5ace66f15a24c14c492e01a8beeed4fddf970a856109f5126e703e5fe503 AS build
WORKDIR /app
COPY package.json package-lock.json* ./
# npm ci statt install: baut genau die Fassungen aus package-lock.json
# und schreibt die Lockdatei nicht um — sonst sind zwei Builds vom
# selben Commit nicht zwingend gleich.
RUN npm ci --include=dev
COPY . .
RUN npx vite build
# Einmal beim Bauen komprimieren statt bei jedem Aufruf: nginx liefert die
# .gz-Datei per gzip_static aus (siehe nginx.conf). -9 lohnt hier, weil es genau
# einmal passiert; -k behaelt das Original fuer Clients ohne gzip.
RUN find dist -type f \( -name '*.js' -o -name '*.css' -o -name '*.html' -o -name '*.json' -o -name '*.svg' \) \
    -size +1k -exec gzip -9 -k {} +

# Gleiche Fassung wie der proxy-Dienst in docker-compose.yml — zusammen aendern.
FROM nginx:alpine@sha256:db35bfc6b2951e7f8a72db5db120288c127ffaeeb4a6d4b95a26fead017d5913
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
