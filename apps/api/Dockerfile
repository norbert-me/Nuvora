# Auf den Digest festgenagelt: der Tag "3.14-slim" wandert, sonst ergeben zwei
# Builds vom selben Commit unterschiedliche Images. Tag bleibt zur Lesbarkeit.
# Neu holen (Index-Digest, gilt fuer amd64 UND arm64):
#   N=python T=3.14-slim; TOKEN=$(curl -s "https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/$N:pull" | python3 -c "import json,sys;print(json.load(sys.stdin)['token'])"); curl -sI -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json" "https://registry-1.docker.io/v2/library/$N/manifests/$T" | grep -i docker-content-digest
FROM python:3.14-slim@sha256:a7fb1e634c4a578f9e0bd6327f11a3cde11b7a9395f48e24360c0988bcc5c2bc
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
# Aus der Lock-Datei, nicht aus requirements.txt: feste Fassungen statt Bereiche,
# und --require-hashes laesst pip abbrechen, wenn ein Paket nicht Byte fuer Byte
# das ist, gegen das hier zuletzt getestet wurde. Neu erzeugt wird sie mit
# pip-compile (siehe Kopf von requirements.txt), nie von Hand.
COPY requirements.lock.txt .
RUN pip install --default-timeout=180 --retries 5 --require-hashes -r requirements.lock.txt
COPY . .

# Nicht als root laufen: der Dienst nimmt Datei-Uploads entgegen und laesst
# OpenCV darauf los. Ein Fehler darin soll nicht gleich den Container gehoeren.
# /app/uploads und /app/backups sind Volumes — sie muessen dem Benutzer gehoeren,
# sonst kann er nichts hineinschreiben. Wichtig: die Ordner muessen HIER im Image
# existieren. Docker uebernimmt Inhalt und Rechte des Image-Ordners nur in ein
# LEERES benanntes Volume; fehlt der Ordner im Image, legt Docker ihn beim Mounten
# als root:root an, und der Dienst bekommt beim Schreiben ein
# "PermissionError: [Errno 13] Permission denied".
RUN useradd --system --uid 10001 --create-home nuvora \
    && mkdir -p /app/uploads /app/backups \
    && chown -R nuvora:nuvora /app
USER nuvora

# Fuer den Healthcheck in docker-compose.yml (das Image bringt kein curl mit).
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4).status == 200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
