# Beide Images auf den Digest festgenagelt: bewegliche Tags machen zwei Builds
# vom selben Commit unterschiedlich. Tag bleibt stehen, damit lesbar ist, was
# gemeint ist. Neu holen (Index-Digest, gilt fuer amd64 UND arm64):
#   N=node T=22-slim; TOKEN=$(curl -s "https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/$N:pull" | python3 -c "import json,sys;print(json.load(sys.stdin)['token'])"); curl -sI -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json" "https://registry-1.docker.io/v2/library/$N/manifests/$T" | grep -i docker-content-digest
FROM node:22-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS build
WORKDIR /app
COPY package.json package-lock.json* ./
# npm ci statt install: baut genau die Fassungen aus package-lock.json
# und schreibt die Lockdatei nicht um — sonst sind zwei Builds vom
# selben Commit nicht zwingend gleich.
RUN npm ci --include=dev
COPY . .
RUN npx vite build

# Gleiche Fassung wie der proxy-Dienst in docker-compose.yml — zusammen aendern.
FROM nginx:alpine@sha256:4a73073bd557c65b759505da037898b61f1be6cbcc3c2c3aeac22d2a470c1752
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
