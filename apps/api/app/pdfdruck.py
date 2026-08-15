"""PDF-Handgriffe, die jeder Drucker-Endpunkt gleich macht.

Ein Blatt: importiert nichts aus der Anwendung. Reportlab wird bewusst erst
**in** den Funktionen geholt — so war es an allen acht Stellen vorher auch, und
so kostet der Start der API die Bibliothek nicht.

Zusammengefuehrt sind zwei Dinge, die wortgleich herumlagen:

* die vier Zeilen „A4-Leinwand aufziehen" (Zeugnis, Fehlzeiten zweimal,
  ArUco-Karten, Zugangszettel, drei CardVote-Auswertungen),
* und der Rueckgabe-Dreizeiler „Puffer an den Anfang, als Anhang ausliefern",
  den `anwesenheit.py` schon als `_pdf_response` hatte und der daneben noch
  fuenfmal ausgeschrieben stand.
"""
from __future__ import annotations


def neue_seite(buf):
    """A4-Leinwand auf `buf`; zurueck kommen Leinwand, Breite, Hoehe.

    Ersetzt ueberall dieselben vier Zeilen (`Canvas(buf, pagesize=A4)` und
    `w, h = A4`).
    """
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas
    c = canvas.Canvas(buf, pagesize=A4)
    w, h = A4
    return c, w, h


def als_anhang(inhalt, filename: str):
    """Fertiges PDF als Download ausliefern.

    `inhalt` ist entweder ein Puffer (dann wird er vorgespult) oder Bytes.
    """
    import io
    from fastapi.responses import StreamingResponse
    puffer = io.BytesIO(inhalt) if isinstance(inhalt, (bytes, bytearray)) else inhalt
    puffer.seek(0)
    return StreamingResponse(puffer, media_type="application/pdf",
                             headers={"Content-Disposition": f'attachment; filename="{filename}"'})
