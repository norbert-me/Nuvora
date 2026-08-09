# Auf den Digest festgenagelt: der Tag "3.12-slim" wandert, sonst ergeben zwei
# Builds vom selben Commit unterschiedliche Images. Tag bleibt zur Lesbarkeit.
# Neu holen (Index-Digest, gilt fuer amd64 UND arm64):
#   N=python T=3.12-slim; TOKEN=$(curl -s "https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/$N:pull" | python3 -c "import json,sys;print(json.load(sys.stdin)['token'])"); curl -sI -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json" "https://registry-1.docker.io/v2/library/$N/manifests/$T" | grep -i docker-content-digest
FROM python:3.12-slim@sha256:229a2c5bfa27522db7815ea81f9bed70af17ccb9de9fc7ad142b1877b5830d36
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
# /app/uploads ist ein Volume — es muss dem Benutzer gehoeren, sonst kann er
# nichts hineinschreiben.
RUN useradd --system --uid 10001 --create-home nuvora \
    && mkdir -p /app/uploads \
    && chown -R nuvora:nuvora /app
USER nuvora

# Fuer den Healthcheck in docker-compose.yml (das Image bringt kein curl mit).
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4).status == 200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
