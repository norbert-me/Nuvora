"""Die Auskunft nach Art. 15 DSGVO muss vollständig sein.

`GET /api/me/export` verspricht im eigenen Datenschutztext eine vollständige
Kopie. Eine neue Tabelle wird dort aber leicht vergessen — genau so fehlten
zeitweise die Beobachtungen, die Elternkontakte, der Notizblock und der
Kartenfortschritt, also ausgerechnet das Persönlichste.

Dieser Test vergleicht die Tabellen der Modelle mit denen, die der Export
anfasst. Neue Tabelle ohne Eintrag im Export = roter Test. Was bewusst nicht
hineingehört, steht in NICHT_IM_EXPORT — mit Begründung.
"""
import pathlib
import re

from app.models import Base

ME = pathlib.Path(__file__).resolve().parents[1] / "app" / "routers" / "me.py"

# Tabellen, die bewusst nicht in der Auskunft stehen.
NICHT_IM_EXPORT = {
    # Technisch, ohne Personenbezug zur auskunftsuchenden Person.
    "app_settings": "globale Einstellung der Installation, kein Personenbezug",
    "users": "das Profil steht als eigener Abschnitt drin (nicht als Tabelle)",
}


def _exportierte_modelle() -> set:
    """Modellnamen, die me.py im Export verwendet (m.Xxx)."""
    return set(re.findall(r"\bm\.([A-Z]\w+)", ME.read_text()))


def _tabelle_zu_modell() -> dict:
    return {t.name: k.__name__ for k in Base.registry.mappers
            for t in [k.local_table] if t is not None
            for _ in [0]
            for k in [k.class_]} if False else {
        mapper.local_table.name: mapper.class_.__name__
        for mapper in Base.registry.mappers if mapper.local_table is not None
    }


def test_jede_tabelle_ist_in_der_auskunft():
    exportiert = _exportierte_modelle()
    fehlend = {tabelle: modell for tabelle, modell in _tabelle_zu_modell().items()
               if tabelle not in NICHT_IM_EXPORT and modell not in exportiert}
    assert not fehlend, (
        "Diese Tabellen fehlen in GET /api/me/export (DSGVO Art. 15 verlangt "
        "Vollständigkeit) — entweder dort ergänzen oder mit Begründung in "
        "NICHT_IM_EXPORT eintragen: "
        + ", ".join(f"{t} ({mod})" for t, mod in sorted(fehlend.items()))
    )
