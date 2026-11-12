"""Eine Frage, die nie gestellt wurde, laesst sich aus der Auswertung ausnehmen."""
from app.routers.results import ausgeschlossene


class _S:
    def __init__(self, cfg): self.eval_config = cfg


def test_ausgeschlossene_liest_ids():
    assert ausgeschlossene(_S({"ausgeschlossen": [3, "5"]})) == {3, 5}


def test_ausgeschlossene_ohne_eintrag_oder_muell():
    assert ausgeschlossene(_S(None)) == set()
    assert ausgeschlossene(_S({"ausgeschlossen": ["x", None, 2]})) == {2}
