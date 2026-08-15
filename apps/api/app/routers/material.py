"""Material-/Dateiablage der Lehrkraft.

Kern-Funktion (kein Modul-Gate): haengt an Themen (Kern) und optional an einen
Kalender-Eintrag (Stunde). Reine private Ablage — nichts wird geteilt, nichts
geht in den Marktplatz oder einen Export an Dritte. Inhalt liegt in der DB und
faellt mit dem Konto weg (owner_id CASCADE).
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File, Form
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Material, Topic, CalendarEntry, Method, WorkAnalysis, User
from sqlalchemy import func

from .auth import get_current_user, rate_limit

router = APIRouter(prefix="/api/material", tags=["material"])

MAX_BYTES = 15 * 1024 * 1024          # 15 MB je Datei — reicht fuer Arbeitsblaetter/PDFs
QUOTA_BYTES = 200 * 1024 * 1024       # 200 MB je Konto — gegen unbegrenztes Vollladen (Public-Betrieb)


class MaterialOut(BaseModel):
    id: int
    topic_id: Optional[int] = None
    entry_id: Optional[int] = None
    method_id: Optional[int] = None
    work_id: Optional[int] = None
    rolle: str = ""          # "arbeit" | "erwartung" | "" (sonstiger Anhang)
    filename: str
    mime: str
    size: int
    model_config = {"from_attributes": True}


async def _check_topic(db: AsyncSession, user_id: int, topic_id: Optional[int]) -> Optional[int]:
    if topic_id is None:
        return None
    ok = (await db.execute(select(Topic.id).where(Topic.id == topic_id, Topic.owner_id == user_id))).scalar_one_or_none()
    if not ok:
        raise HTTPException(404, "Thema nicht gefunden")
    return topic_id


async def _check_entry(db: AsyncSession, user_id: int, entry_id: Optional[int]) -> Optional[int]:
    if entry_id is None:
        return None
    ok = (await db.execute(select(CalendarEntry.id).where(CalendarEntry.id == entry_id, CalendarEntry.owner_id == user_id))).scalar_one_or_none()
    if not ok:
        raise HTTPException(404, "Kalender-Eintrag nicht gefunden")
    return entry_id


async def _check_method(db: AsyncSession, user_id: int, method_id: Optional[int]) -> Optional[int]:
    if method_id is None:
        return None
    ok = (await db.execute(select(Method.id).where(Method.id == method_id, Method.owner_id == user_id))).scalar_one_or_none()
    if not ok:
        raise HTTPException(404, "Einstieg nicht gefunden")
    return method_id


async def _check_work(db: AsyncSession, user_id: int, work_id: Optional[int]) -> Optional[int]:
    if work_id is None:
        return None
    ok = (await db.execute(select(WorkAnalysis.id).where(
        WorkAnalysis.id == work_id, WorkAnalysis.owner_id == user_id))).scalar_one_or_none()
    if not ok:
        raise HTTPException(404, "Klassenarbeit nicht gefunden")
    return work_id


# Nur benannte Rollen, sonst leer: eine erfundene Rolle wuerde die Datei in der
# Oberflaeche verschwinden lassen (sie zeigt genau die drei Faelle).
ROLLEN = ("arbeit", "erwartung")


@router.get("", response_model=List[MaterialOut])
async def list_material(topic_id: Optional[int] = None, entry_id: Optional[int] = None, method_id: Optional[int] = None,
                        work_id: Optional[int] = None, rolle: Optional[str] = None,
                        user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Material der Lehrkraft, gefiltert nach Thema, Stunde, Einstieg oder Arbeit."""
    q = select(Material).where(Material.owner_id == user.id)
    if topic_id is not None:
        q = q.where(Material.topic_id == topic_id)
    if entry_id is not None:
        q = q.where(Material.entry_id == entry_id)
    if method_id is not None:
        q = q.where(Material.method_id == method_id)
    if work_id is not None:
        q = q.where(Material.work_id == work_id)
    if rolle is not None:
        q = q.where(Material.rolle == (rolle if rolle in ROLLEN else ""))
    rows = (await db.execute(q.order_by(Material.created_at.desc()))).scalars().all()
    return rows


@router.post("", response_model=MaterialOut, status_code=201)
async def upload_material(file: UploadFile = File(...), topic_id: Optional[int] = Form(None),
                          entry_id: Optional[int] = Form(None), method_id: Optional[int] = Form(None),
                          work_id: Optional[int] = Form(None), rolle: str = Form(""),
                          user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rate_limit("material_up", f"u{user.id}", 60, 60, "Zu viele Uploads. Bitte kurz warten.")
    if topic_id is None and entry_id is None and method_id is None and work_id is None:
        raise HTTPException(400, "Material braucht ein Thema, eine Stunde, einen Einstieg oder eine Klassenarbeit")
    topic_id = await _check_topic(db, user.id, topic_id)
    entry_id = await _check_entry(db, user.id, entry_id)
    method_id = await _check_method(db, user.id, method_id)
    work_id = await _check_work(db, user.id, work_id)
    data = await file.read()
    if not data:
        raise HTTPException(400, "Datei ist leer")
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "Datei zu groß (max. 15 MB)")
    used = (await db.execute(select(func.coalesce(func.sum(Material.size), 0)).where(Material.owner_id == user.id))).scalar_one()
    if used + len(data) > QUOTA_BYTES:
        raise HTTPException(413, "Speicher voll (max. 200 MB je Konto). Bitte alte Dateien löschen.")
    m = Material(owner_id=user.id, topic_id=topic_id, entry_id=entry_id, method_id=method_id,
                 work_id=work_id, rolle=rolle if rolle in ROLLEN else "",
                 filename=(file.filename or "datei")[:255], mime=(file.content_type or "")[:120],
                 size=len(data), data=data)
    db.add(m)
    await db.commit()
    await db.refresh(m)
    return m


# Dieselbe Datei wird oft mehrmals geoeffnet — beim Korrigieren geht man
# zwischen Arbeit und Erwartungshorizont hin und her. Ohne Kennung laedt der
# Browser jedes Mal alles neu; in einem Schulnetz sind das bei einer 5-MB-Arbeit
# spuerbare Sekunden. Mit ETag antwortet der Server beim zweiten Mal „304, du
# hast es schon" und schickt kein Byte Inhalt.
#
# `private`: die Datei gehoert einer Lehrkraft, kein geteilter Zwischenspeicher
# darf sie halten. Die Kennung enthaelt die Laenge — aendert sich die Datei,
# aendert sich die Kennung.
def _cache_kopf(etag: str) -> dict:
    return {"ETag": etag, "Cache-Control": "private, max-age=300"}


def _unveraendert(request, etag: str) -> bool:
    roh = request.headers.get("if-none-match", "")
    return any(teil.strip().lstrip("W/") == etag for teil in roh.split(",") if teil.strip())


@router.get("/{material_id}/download")
async def download_material(material_id: int, request: Request, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    m = await db.get(Material, material_id)
    if not m or m.owner_id != user.id:
        raise HTTPException(404, "Material nicht gefunden")
    etag = f'"d{m.id}-{m.size}"'
    if _unveraendert(request, etag):
        return Response(status_code=304, headers=_cache_kopf(etag))
    safe = m.filename.replace("\r", " ").replace("\n", " ").replace('"', "'")
    # Inline nur fuer sichere, nicht-skriptfaehige Typen (PDF, Rasterbilder).
    # Alles andere — besonders HTML/SVG — als Download, damit hochgeladener Code
    # nicht im eigenen Origin ausgefuehrt wird (SVG kann Skript tragen).
    inline_ok = {"application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"}
    disp = "inline" if (m.mime in inline_ok) else "attachment"
    return Response(content=m.data, media_type=m.mime or "application/octet-stream",
                    headers={"Content-Disposition": f'{disp}; filename="{safe}"',
                             "X-Content-Type-Options": "nosniff", **_cache_kopf(etag)})


# Office-Dateien, die der Browser nicht anzeigen kann — sie werden auf Wunsch
# einmalig nach PDF gewandelt. Alles andere bleibt ein Download.
OFFICE = {
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",   # docx
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",         # xlsx
    "application/vnd.openxmlformats-officedocument.presentationml.presentation", # pptx
    "application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint",
    "application/vnd.oasis.opendocument.text", "application/vnd.oasis.opendocument.spreadsheet",
    "application/vnd.oasis.opendocument.presentation", "application/rtf", "text/rtf",
}
OFFICE_ENDUNGEN = (".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt", ".odt", ".ods", ".odp", ".rtf")


def _ist_office(m) -> bool:
    return (m.mime in OFFICE) or (m.filename or "").lower().endswith(OFFICE_ENDUNGEN)


# Ab dieser Groesse lohnt es, fuer die Ansicht eine leichtere Fassung zu bauen.
# Darunter ist der Aufwand groesser als der Gewinn.
VORSCHAU_AB = 1_500_000


def _verkleinern(pdf: bytes) -> bytes:
    """Leichtere PDF-Fassung fuer die Bildschirmansicht (Ghostscript).

    Eine 5-MB-Arbeit mit eingescannten Bildern laedt spuerbar lange, obwohl
    niemand sie am Bildschirm in Druckaufloesung braucht. `/ebook` rechnet Bilder
    auf rund 150 dpi herunter — am Monitor nicht zu unterscheiden, oft ein
    Viertel der Groesse. Der Download bleibt davon unberuehrt: dort geht immer
    das Original raus.

    Faellt Ghostscript aus (nicht installiert, kaputte Datei), bleibt es beim
    Original — eine langsamere Vorschau ist besser als gar keine.
    """
    import shutil
    import subprocess
    import tempfile
    from pathlib import Path

    gs = shutil.which("gs")
    if not gs:
        return pdf
    with tempfile.TemporaryDirectory() as tmp:
        quelle = Path(tmp) / "gross.pdf"
        ziel = Path(tmp) / "klein.pdf"
        quelle.write_bytes(pdf)
        try:
            subprocess.run(
                [gs, "-sDEVICE=pdfwrite", "-dCompatibilityLevel=1.5", "-dPDFSETTINGS=/ebook",
                 "-dNOPAUSE", "-dBATCH", "-dQUIET", "-dSAFER",
                 f"-sOutputFile={ziel}", str(quelle)],
                check=True, timeout=60, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            )
        except Exception:
            return pdf
        if not ziel.exists():
            return pdf
        klein = ziel.read_bytes()
        # Nur nehmen, wenn es wirklich kleiner ist — bei reinen Textdateien
        # kommt manchmal eine groessere Datei heraus.
        return klein if 0 < len(klein) < len(pdf) else pdf


def _nach_pdf(daten: bytes, dateiname: str) -> bytes:
    """Office-Datei nach PDF wandeln — mit LibreOffice, ohne Netz, im Tempordner.

    Laeuft im Threadpool (der Aufrufer sorgt dafuer): die Umwandlung dauert
    Sekunden und wuerde sonst die ganze Ereignisschleife blockieren.

    Bewusst ein eigenes Profilverzeichnis je Aufruf: zwei gleichzeitige
    Umwandlungen mit demselben Profil blockieren einander (LibreOffice laesst nur
    eine Instanz je Profil zu) — der zweite Aufruf haengt dann bis zum Timeout.
    """
    import shutil
    import subprocess
    import tempfile
    from pathlib import Path

    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        raise HTTPException(501, "Umwandlung nicht verfügbar: LibreOffice fehlt im Server-Image.")

    endung = Path(dateiname or "datei").suffix or ".docx"
    with tempfile.TemporaryDirectory() as tmp:
        quelle = Path(tmp) / f"eingabe{endung}"
        quelle.write_bytes(daten)
        profil = Path(tmp) / "profil"
        try:
            subprocess.run(
                [soffice, "--headless", "--norestore", "--nolockcheck", "--nodefault",
                 f"-env:UserInstallation=file://{profil}",
                 "--convert-to", "pdf", "--outdir", tmp, str(quelle)],
                check=True, timeout=90, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            )
        except subprocess.TimeoutExpired:
            raise HTTPException(504, "Die Umwandlung hat zu lange gedauert.")
        except subprocess.CalledProcessError as e:
            raise HTTPException(500, f"Die Datei liess sich nicht umwandeln: {(e.stderr or b'')[:200].decode(errors='replace')}")
        ziel = Path(tmp) / "eingabe.pdf"
        if not ziel.exists():
            raise HTTPException(500, "Die Umwandlung hat kein PDF erzeugt.")
        return ziel.read_bytes()


@router.get("/{material_id}/pdf")
async def material_als_pdf(material_id: int, request: Request, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Die Datei als PDF — zum Ansehen im Browser, ohne Download.

    PDFs kommen unveraendert zurueck. Office-Dateien werden beim ERSTEN Aufruf
    gewandelt und danach behalten; jede weitere Ansicht ist sofort da.
    """
    from starlette.concurrency import run_in_threadpool
    from sqlalchemy.orm import undefer
    from sqlalchemy import func as _func

    # Erst nur die Kenndaten holen: liegt die Ansichtsfassung schon bereit und
    # hat der Browser sie, ist hier Schluss — ohne die Bytes ueberhaupt aus der
    # Datenbank zu lesen.
    kopf = (await db.execute(select(Material.owner_id, Material.size,
                                    _func.length(Material.pdf_data))
                             .where(Material.id == material_id))).first()
    if not kopf or kopf[0] != user.id:
        raise HTTPException(404, "Material nicht gefunden")
    # Kennung auch OHNE gebaute Ansichtsfassung: ein PDF unter der
    # Verkleinerungsgrenze wird unveraendert durchgereicht, `pdf_data` bleibt
    # dann leer — und genau dafuer gab es vorher nie ein 304. Die Laenge des
    # Originals ist hier die richtige Kennung, weil genau das ausgeliefert wird.
    fertig = kopf[2] or 0
    etag = f'"p{material_id}-{fertig}"' if fertig else f'"o{material_id}-{kopf[1]}"'
    if _unveraendert(request, etag):
        return Response(status_code=304, headers=_cache_kopf(etag))

    m = (await db.execute(select(Material).options(undefer(Material.pdf_data))
                          .where(Material.id == material_id))).scalar_one_or_none()
    if not m or m.owner_id != user.id:
        raise HTTPException(404, "Material nicht gefunden")

    if m.pdf_data:
        pdf = m.pdf_data                     # schon gebaute Ansichtsfassung
    elif m.mime == "application/pdf":
        pdf = m.data
        if len(pdf) > VORSCHAU_AB:
            # Grosse PDFs einmalig leichter machen und behalten: die Ansicht
            # soll beim zweiten Aufruf sofort da sein.
            rate_limit("material_pdf", f"u{user.id}", 30, 60, "Zu viele Umwandlungen. Bitte kurz warten.")
            klein = await run_in_threadpool(_verkleinern, pdf)
            if len(klein) < len(pdf):
                m.pdf_data = klein
                await db.commit()
                pdf = klein
    elif _ist_office(m):
        rate_limit("material_pdf", f"u{user.id}", 30, 60, "Zu viele Umwandlungen. Bitte kurz warten.")
        pdf = await run_in_threadpool(_nach_pdf, m.data, m.filename)
        if len(pdf) > VORSCHAU_AB:
            pdf = await run_in_threadpool(_verkleinern, pdf)
        m.pdf_data = pdf
        await db.commit()
    else:
        raise HTTPException(415, "Diese Datei lässt sich nicht als PDF anzeigen.")

    safe = (m.filename or "datei").rsplit(".", 1)[0].replace('"', "'")[:180]
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="{safe}.pdf"',
                             "X-Content-Type-Options": "nosniff",
                             # Dieselbe Kennung wie oben — sonst passt der
                             # zweite Abruf nie auf den ersten.
                             **_cache_kopf(f'"p{material_id}-{len(pdf)}"' if m.pdf_data
                                           else f'"o{material_id}-{m.size}"')})


@router.delete("/{material_id}", status_code=204)
async def delete_material(material_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    m = await db.get(Material, material_id)
    if not m or m.owner_id != user.id:
        raise HTTPException(404, "Material nicht gefunden")
    await db.delete(m)
    await db.commit()
