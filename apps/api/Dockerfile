FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --default-timeout=180 --retries 5 -r requirements.txt
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
