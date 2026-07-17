# Ein einziger node-Prozess: Express liefert Statik UND API (siehe server.js:
# express.static + Guard fuer sensible Dateien + Auth auf /api). nginx wird
# nicht mehr gebraucht und ist raus – frueher hing der Build an `apk add`
# (Alpine-Mirror ueber IPv6 blockiert auf dem NAS). npm erreicht sein Registry
# problemlos, also bleiben wir bei npm/node und rufen apk gar nicht mehr auf.
FROM node:alpine
WORKDIR /app

# Nur Prod-Deps, kein Dev/Build-Zeug.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Backend
COPY server.js ./
COPY daten/ ./daten/
COPY config/ ./config/

# Frontend (von express.static aus /app ausgeliefert)
COPY index.html impressum.html datenschutz.html kontakt.html ./
COPY css/ ./css/
COPY js/ ./js/
COPY vendor/ ./vendor/

EXPOSE 3000
CMD ["node", "server.js"]
