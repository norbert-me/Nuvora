"""Das Dateiformat, in dem ein Quiz das Haus verlaesst — an einer Stelle.

Ein Blatt: nur die Modelle, kein Router.

Dasselbe Abbild („cardvote_questionset", Fassung 1) entsteht an zwei Wegen: als
**Datei** (`export_import.export_question_set`, Ordner-Export) und als
**Marktplatz-Eintrag** (`marketplace._snapshot_from_items`). Die beiden Fassungen
lagen Schluessel fuer Schluessel gleich da. Sie standen getrennt mit der
Begruendung, der Marktplatz lasse „niveau" bewusst weg — das stimmte zum
Zeitpunkt des Kommentars vielleicht, im Bestand trug er es laengst mit; die
Begruendung war nur nicht mitgewachsen.

Das ist keine Kosmetik: ein Abbild ueberlebt den Code, der es geschrieben hat.
Wer hier ein Feld ergaenzt und die zweite Fassung uebersieht, macht dieselbe
Angabe je nach Weg mal mit und mal ohne — und der Einlese-Weg (`import_question_set`,
`marketplace uebernehmen`) sieht den Unterschied erst beim Nutzer.
"""
from __future__ import annotations

TYP = "cardvote_questionset"
FASSUNG = 1


def frage_schnappschuss(item) -> dict:
    """Eine Frage als Abbild. `niveau` haengt am Set-Eintrag, nicht an der Frage
    — dieselbe Frage kann anderswo Anforderung sein (siehe CLAUDE.md, E/G)."""
    q = item.question
    return {
        "niveau": item.niveau or "",
        "text": q.text,
        "choices": q.choices,
        "correct_answer": q.correct_answer,
        "image_url": q.image_url,
        "image_layout": q.image_layout,
        "num_choices": q.num_choices,
        "choice_images": q.choice_images,
    }


def quiz_inhalt(qs, items) -> dict:
    """Der Inhalt eines Quiz — ohne `type`/`version`.

    Die braucht nur, was allein in einer Datei steht. Im Ordner-Export liegen
    viele Quizze **in** einem Abbild; dort stehen Art und Fassung einmal aussen
    am Ordner. Genau darum ist das der eigene Baustein und nicht ein Schalter.

    `niveau_aktiv` und `minuspunkte` gehoeren dazu — ohne sie waere die
    uebernommene Fassung anders bewertet als das Original.
    """
    return {
        "name": qs.name,
        "shuffle_questions": qs.shuffle_questions,
        "shuffle_answers": qs.shuffle_answers,
        "niveau_aktiv": bool(qs.niveau_aktiv),
        "minuspunkte": bool(qs.minuspunkte),
        "questions": [frage_schnappschuss(it) for it in items],
    }


def quiz_schnappschuss(qs, items) -> dict:
    """Ein ganzes Quiz als eigenstaendiges Abbild (Datei, Marktplatz-Eintrag)."""
    return {"type": TYP, "version": FASSUNG, **quiz_inhalt(qs, items)}
