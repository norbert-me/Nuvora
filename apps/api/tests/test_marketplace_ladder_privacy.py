"""Regressionstest: Marktplatz-Snapshot einer Lernleiter enthaelt keine
personenbezogenen/privaten Daten.

Hintergrund: eine Lernleiter haengt an einer Klasse, hat je Schueler Zuweisungen
(assignments) und eine freie Notiz der Lehrkraft. Der Marktplatz ist oeffentlich.
Es darf NICHTS davon in den geteilten Snapshot: keine class_id, keine
assignments (Schuelerbezug), keine Notizen (Freitext kann Namen enthalten),
keine topic_id (instanzlokal). Nur der Aufgabenpool + Thema als Text.
"""
from types import SimpleNamespace

from app.routers.marketplace import _snapshot_from_ladder, _EX_FIELDS


def test_ladder_snapshot_hat_keine_personendaten():
    ladder = SimpleNamespace(
        notizen="Max braucht mehr Zeit, Lisa ist schneller",  # Freitext mit Namen
        config={"max": 8},
        class_id=42,
        topic_id=7,
        assignments=[{"student_id": 1, "exercise_ids": [10]}],
    )
    ex = SimpleNamespace(**{k: ("x" if k not in ("foerderschwerpunkte", "unteraufgaben") else None) for k in _EX_FIELDS})
    snap = _snapshot_from_ladder("Bruchrechnung", "Brüche / Kürzen", ladder, [ex])

    # Das darf NICHT drin sein:
    assert "notizen" not in snap
    assert "assignments" not in snap
    assert "class_id" not in snap
    assert "topic_id" not in snap
    # Sicherheitshalber auch kein Schuelername irgendwo im Snapshot:
    import json
    blob = json.dumps(snap, ensure_ascii=False)
    assert "Max" not in blob and "Lisa" not in blob

    # Das gehoert rein: Thema als Text + der Aufgabenpool.
    assert snap["topic_name"] == "Brüche / Kürzen"
    assert len(snap["exercises"]) == 1
