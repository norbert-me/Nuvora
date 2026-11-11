"""Gezeigte Reihenfolge einer Sitzung: sie muss ein Neuladen (Netzausfall) überstehen."""
import pytest
from fastapi import HTTPException

from app.importe import geprueft
from app.routers.sessions import QuestionLayoutIn


def test_layout_bleibt_in_der_gezeigten_reihenfolge():
    roh = [{"id": 7, "choices": {"A": "x", "B": "y"}, "correct_answer": "B"},
           {"id": 3, "choices": {"A": "p", "B": "q"}, "choice_images": {"A": "/api/uploads/a.png"}, "correct_answer": "A"}]
    aus = geprueft(QuestionLayoutIn, roh, "Reihenfolge").model_dump()
    assert [e["id"] for e in aus] == [7, 3]
    assert aus[0]["correct_answer"] == "B"
    assert aus[1]["choice_images"] == {"A": "/api/uploads/a.png"}


def test_layout_lehnt_unsinn_ab():
    with pytest.raises(HTTPException):
        geprueft(QuestionLayoutIn, [{"choices": {"A": "x"}}], "Reihenfolge")           # ohne id
    with pytest.raises(HTTPException):
        geprueft(QuestionLayoutIn, [{"id": 1, "choices": "A"}], "Reihenfolge")         # Antworten kein Objekt
    with pytest.raises(HTTPException):
        geprueft(QuestionLayoutIn, [{"id": i} for i in range(1001)], "Reihenfolge")    # zu viele
