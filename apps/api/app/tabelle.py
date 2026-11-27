"""Excel-Ausgabe an einer Stelle: Zelle ohne Formel-Injektion, Arbeitsmappe als Download.

Stand in `routers/export_import.py`; seit auch die Checklisten (Orga) eine Tabelle hinausgeben, liegt es hier
als Blatt — ein Router importiert keinen anderen.
"""
import io

from fastapi.responses import StreamingResponse

from .uploads import anhang_kopf

XLSX_MEDIA = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
FORMEL_ANFANG = ("=", "+", "-", "@", "\t", "\r")


def xlsx_antwort(wb, filename: str) -> StreamingResponse:
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(buf, media_type=XLSX_MEDIA, headers={"Content-Disposition": anhang_kopf(filename)})


def zelle(ws, row: int, column: int, wert):
    """Zelle schreiben — Text, der wie eine Formel anfaengt, bleibt Text.

    Ein Fragen- oder Schuelername „=HYPERLINK(…)" wuerde sonst beim Oeffnen ausgewertet (Formel-Injektion);
    openpyxl haelt jede Zeichenkette mit „=" sogar selbst fuer eine Formel. Die Zelle wird als Text markiert
    und bekommt das Text-Praefix, das Excel wie ein fuehrendes ' behandelt, aber nicht in den Wert schreibt —
    der Inhalt kommt ueber den Import unveraendert zurueck. Zahlen bleiben unberuehrt.
    """
    c = ws.cell(row=row, column=column, value=wert)
    if isinstance(wert, str) and wert.startswith(FORMEL_ANFANG):
        c.value = wert
        c.data_type = "s"
        c.quotePrefix = True
    return c
