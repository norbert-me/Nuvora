"""Startinhalt fuer frische Konten.

Ein leeres Konto zeigt nicht, was das Werkzeug kann. Deshalb bekommt jedes neue
Konto ein Beispiel-Frageset, das den Funktionsumfang vorfuehrt (2/3/4 Antworten,
Mehrfachauswahl, LaTeX), und eine Blanko-Klasse mit 30 Karten zum Ueberschreiben.

Beides ist normaler Inhalt: loeschbar, aenderbar, kein Sonderstatus. Wer es
nicht braucht, wirft es weg.
"""
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Folder, Question, QuestionSet, QuestionSetItem, SchoolClass, Student

BEISPIEL_SET = "Beispiel: Was CardVote kann"
BLANKO_KLASSE = "Beispielklasse (30 Karten)"

# Jede Frage fuehrt bewusst eine Faehigkeit vor — die Erklaerung steht in der
# Frage selbst, damit der Zweck beim Durchklicken sichtbar wird.
BEISPIEL_FRAGEN = [
    {
        "text": "Wie viele Antwortmöglichkeiten kann eine Frage haben?",
        "choices": {"A": "Nur 4", "B": "2, 3 oder 4", "C": "Beliebig viele", "D": "Immer 2"},
        "correct_answer": "B",
        "num_choices": 4,
    },
    {
        "text": "Diese Frage hat nur zwei Antworten — praktisch für Ja/Nein.",
        "choices": {"A": "Verstanden", "B": "Noch nicht"},
        "correct_answer": "A",
        "num_choices": 2,
    },
    {
        "text": "Drei Antworten gehen auch. Welche Aussage stimmt?",
        "choices": {
            "A": "Die Lernenden brauchen ein Handy",
            "B": "Nur die Lehrkraft braucht ein Gerät",
            "C": "Alle brauchen WLAN",
        },
        "correct_answer": "B",
        "num_choices": 3,
    },
    {
        "text": "Mehrfachauswahl: Welche Angaben stimmen? (mehrere richtig)",
        "choices": {
            "A": "Ergebnisse erscheinen live auf dem Beamer",
            "B": "Die Karten werden mit der Handykamera gescannt",
            "C": "Lernende müssen sich registrieren",
            "D": "Der Export geht als PDF und Excel",
        },
        "correct_answer": "ABD",
        "num_choices": 4,
    },
    {
        "text": "Formeln werden gesetzt: Was ergibt $\\frac{3}{4} + \\frac{1}{4}$?",
        "choices": {"A": "$\\frac{4}{8}$", "B": "$1$", "C": "$\\frac{3}{16}$", "D": "$\\frac{4}{4}$ und $1$"},
        "correct_answer": "BD",
        "num_choices": 4,
    },
    {
        "text": "Mathematik im Fragetext: Für welches $x$ gilt $2x + 6 = 14$?",
        "choices": {"A": "$x = 4$", "B": "$x = 10$", "C": "$x = 8$", "D": "$x = 2$"},
        "correct_answer": "A",
        "num_choices": 4,
    },
]


async def seed_new_account(db: AsyncSession, user_id: int) -> None:
    """Legt Beispielinhalt fuer ein frisches Konto an.

    Best-effort: schlaegt das hier fehl, darf die Registrierung trotzdem
    gelingen — ein Konto ohne Beispiel ist brauchbar, ein Konto, das an einer
    Demo scheitert, nicht. Der Aufrufer faengt die Ausnahme.
    """
    ordner = Folder(name="Beispiele", owner_id=user_id)
    db.add(ordner)
    await db.flush()

    qset = QuestionSet(name=BEISPIEL_SET, folder_id=ordner.id, shuffle_questions=False, shuffle_answers=False)
    db.add(qset)
    await db.flush()

    for pos, f in enumerate(BEISPIEL_FRAGEN):
        q = Question(
            text=f["text"], choices=f["choices"], correct_answer=f["correct_answer"],
            num_choices=f["num_choices"], owner_id=user_id,
        )
        db.add(q)
        await db.flush()
        db.add(QuestionSetItem(question_set_id=qset.id, question_id=q.id, position=pos))

    # Blanko-Klasse: 30 Karten mit leeren Namen. Die Kartennummern sind das
    # Eigentliche — sie koennen sofort gedruckt und spaeter benannt werden.
    klasse = SchoolClass(name=BLANKO_KLASSE, owner_id=user_id)
    db.add(klasse)
    await db.flush()
    for nr in range(1, 31):
        db.add(Student(card_id=nr, name=f"Platz {nr}", class_id=klasse.id))

    await db.commit()
