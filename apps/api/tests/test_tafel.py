"""Die Tafel prueft die FORM ihrer Elemente, nicht den Inhalt (siehe
routers/tafel.py). Dieser Test haelt fest, was dabei erhalten bleiben muss.
"""
def test_einstellungen_der_widgets_ueberleben_das_speichern():
    """`minutes` (Timer) und `schwelle` (Lautstärke) fielen aus der Formprüfung
    heraus — die Einstellung war nach dem Speichern weg. Sie werden nur
    übernommen, wenn sie dastehen: ein „minutes: 0" an jedem Textfeld wäre eine
    Angabe, die niemand gemacht hat."""
    from app.routers.tafel import _items

    raus = _items([
        {"id": "a", "type": "timer", "minutes": 7, "muted": True},
        {"id": "b", "type": "laerm", "schwelle": 65},
        {"id": "c", "type": "text", "text": "Hallo"},
    ])
    assert raus[0]["minutes"] == 7 and raus[0]["muted"] is True
    assert raus[1]["schwelle"] == 65
    assert "minutes" not in raus[2] and "schwelle" not in raus[2]
