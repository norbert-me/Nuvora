FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
# npm ci statt install: baut genau die Fassungen aus package-lock.json
# und schreibt die Lockdatei nicht um — sonst sind zwei Builds vom
# selben Commit nicht zwingend gleich.
RUN npm ci --include=dev
COPY . .
RUN npx vite build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
