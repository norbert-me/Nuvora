"""Der Anhang einer Fehlermeldung geht nur als Download hinaus.

Typ und Inhalt bestimmt der Melder — ein beliebiges angemeldetes Konto. Mit
`inline` liefe ein als `text/html` oder `image/svg+xml` hochgeladener Anhang
als Seite unter unserer Herkunft, im Browser der Administration.
"""
import pytest

import test_backup
from app.models import BugReport

_ruf = test_backup._ruf
welt = test_backup.welt  # Fixture ueber den Parameternamen (siehe test_backup_pfade.py)


@pytest.mark.asyncio
@pytest.mark.parametrize("typ", ["text/html", "image/svg+xml", "image/png"])
async def test_anhang_ist_immer_attachment_mit_nosniff(welt, typ):  # noqa: F811
    async with welt["Sitzung"]() as s:
        r = BugReport(user_id=2, message="x", anhang=b"<script>alert(1)</script>",
                      anhang_name="bild", anhang_typ=typ)
        s.add(r)
        await s.commit()
        rid = r.id
    antwort = await _ruf("GET", f"/api/admin/bugreports/{rid}/anhang")
    assert antwort.status == 200, antwort.body[:200]
    assert antwort.headers["content-disposition"].startswith("attachment")
    assert antwort.headers.get("x-content-type-options") == "nosniff"
