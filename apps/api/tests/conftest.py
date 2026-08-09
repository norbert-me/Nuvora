"""Gemeinsame Vorbereitung fuer alle Tests.

Der Upload-Ordner liegt im Container unter /app/uploads. Beim Testen gibt es
den nicht — ohne diese Umleitung scheitert schon der Import.
"""
import os
import tempfile

os.environ.setdefault("NUVORA_UPLOAD_DIR", tempfile.mkdtemp(prefix="nuvora-test-uploads-"))
