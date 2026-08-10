import asyncio
import logging
import os
import smtplib
import ssl
from email.message import EmailMessage

logger = logging.getLogger("cardvote.mail")


def _fuer_log(wert: str, max_len: int = 120) -> str:
    """Adresse logtauglich machen.

    Die Adresse kommt aus dem Formular. Mit einem Zeilenumbruch darin liesse
    sich eine komplette zusaetzliche Logzeile einschleusen ("Anmeldung
    erfolgreich" o. ae.) — genau das Log soll im Zweifel eine
    Datenschutz-Auskunft belegen. Umbrueche und Steuerzeichen fliegen raus,
    die Adresse bleibt lesbar.
    """
    # Umbrueche ausdruecklich zuerst — nicht nur der Lesbarkeit wegen: die
    # Pruefwerkzeuge (CodeQL) erkennen erst diese Form als Bereinigung an und
    # melden die Stelle sonst weiter als Log-Injektion. Die anschliessende
    # Schleife raeumt die uebrigen Steuerzeichen weg.
    text = (wert or "").replace("\r", " ").replace("\n", " ")
    text = "".join(" " if ord(c) < 32 or ord(c) == 127 else c for c in text)
    text = text.strip()
    if len(text) > max_len:
        text = text[:max_len] + "…"
    return text or "(leer)"


def email_configured() -> bool:
    return bool(os.environ.get("SMTP_HOST") and os.environ.get("SMTP_FROM"))


def _send_sync(to: str, subject: str, body: str, reply_to: str = "") -> bool:
    host = os.environ.get("SMTP_HOST")
    port = int(os.environ.get("SMTP_PORT", "465"))
    user = os.environ.get("SMTP_USER")
    password = os.environ.get("SMTP_PASSWORD")
    sender = os.environ.get("SMTP_FROM")
    from_name = os.environ.get("SMTP_FROM_NAME", "Nuvora")
    if not host or not sender:
        return False

    msg = EmailMessage()
    msg["From"] = f"{from_name} <{sender}>" if from_name else sender
    msg["To"] = to
    if reply_to:
        msg["Reply-To"] = reply_to
    msg["Subject"] = subject
    msg.set_content(body)

    ctx = ssl.create_default_context()
    if port == 465:
        with smtplib.SMTP_SSL(host, port, context=ctx, timeout=15) as s:
            if user:
                s.login(user, password or "")
            s.send_message(msg)
    else:
        with smtplib.SMTP(host, port, timeout=15) as s:
            s.ehlo()
            s.starttls(context=ctx)
            if user:
                s.login(user, password or "")
            s.send_message(msg)
    return True


async def send_email(to: str, subject: str, body: str, reply_to: str = "") -> bool:
    """Versendet best-effort — wirft nie, blockiert nie den Request (läuft im Threadpool)."""
    if not email_configured():
        logger.info("SMTP nicht konfiguriert — E-Mail an %s übersprungen", _fuer_log(to))
        return False
    try:
        return await asyncio.to_thread(_send_sync, to, subject, body, reply_to)
    except Exception as e:
        logger.warning("E-Mail-Versand an %s fehlgeschlagen: %s", _fuer_log(to), _fuer_log(str(e), 300))
        return False


def config_status() -> dict:
    return {
        "host": os.environ.get("SMTP_HOST") or "",
        "port": os.environ.get("SMTP_PORT", "465"),
        "user_set": bool(os.environ.get("SMTP_USER")),
        "password_set": bool(os.environ.get("SMTP_PASSWORD")),
        "from": os.environ.get("SMTP_FROM") or "",
        "configured": email_configured(),
    }


async def send_test(to: str):
    """Diagnose: versucht Versand, gibt echten Fehler zurück statt zu schlucken."""
    if not email_configured():
        return {"ok": False, "error": "SMTP nicht konfiguriert (SMTP_HOST oder SMTP_FROM leer)", "config": config_status()}
    try:
        await asyncio.to_thread(_send_sync, to, "Nuvora — Test-E-Mail", "Test erfolgreich. SMTP funktioniert.")
        return {"ok": True, "config": config_status()}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}", "config": config_status()}
