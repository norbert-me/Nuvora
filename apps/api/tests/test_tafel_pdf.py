"""PDF auf der Tafel: Striche je Seite werden auf ihre Form gebracht und begrenzt."""
from app.routers import tafel as T


def test_striche_form_und_grenzen():
    roh = [{"id": "a", "type": "pdf", "material_id": 9, "striche": {
        "1": [{"c": "#123456", "w": 3, "p": [0.1, 0.2, 0.3, 0.4]}, {"p": "kaputt"}, "auch kaputt"],
        "2": [{"c": "#f00", "w": 999, "p": list(range(T.MAX_PUNKTE * 3))}],
    }, "zaehlen": False}]
    it = T._items(roh)[0]
    assert it["material_id"] == 9.0
    assert it["striche"]["1"] == [{"c": "#123456", "w": 3.0, "p": [0.1, 0.2, 0.3, 0.4]}]
    zwei = it["striche"]["2"][0]
    assert zwei["w"] == 40.0 and len(zwei["p"]) == T.MAX_PUNKTE * 2
