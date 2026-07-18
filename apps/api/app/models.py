from datetime import datetime
from typing import Optional

from sqlalchemy import ForeignKey, String, Text, DateTime, Integer, JSON, Boolean, UniqueConstraint, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class AppSetting(Base):
    """Instanzweite Einstellungen als Key-Value (z. B. der Update-Kanal)."""
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(String(255), default="", server_default="")


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    name: Mapped[str] = mapped_column(String(200), default="")
    salutation: Mapped[str] = mapped_column(String(10), default="Hr.")
    marketplace_name: Mapped[str] = mapped_column(String(100), default="", server_default="")
    grade_scale: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    token_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    pending_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    # Wurde das Konto schon einmal ans Modulregister angeschlossen? Verhindert,
    # dass der Backfill beim Start ein abgeschaltetes Modul wieder aktiviert.
    modules_initialized: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    # Modul Kalender: Stunden pro Tag im hinterlegten Stundenplan (Einstellung).
    timetable_periods: Mapped[int] = mapped_column(Integer, default=6, server_default="6")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    folders: Mapped[list["Folder"]] = relationship(back_populates="owner", cascade="all, delete-orphan")
    classes: Mapped[list["SchoolClass"]] = relationship(back_populates="owner", cascade="all, delete-orphan")
    sessions: Mapped[list["Session"]] = relationship(back_populates="owner", cascade="all, delete-orphan")


class Folder(Base):
    __tablename__ = "folders"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    parent_id: Mapped[Optional[int]] = mapped_column(ForeignKey("folders.id", ondelete="CASCADE"), nullable=True)
    owner_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    children: Mapped[list["Folder"]] = relationship(back_populates="parent", cascade="all, delete-orphan")
    parent: Mapped[Optional["Folder"]] = relationship(back_populates="children", remote_side="Folder.id")
    question_sets: Mapped[list["QuestionSet"]] = relationship(back_populates="folder", order_by="QuestionSet.name")
    owner: Mapped[Optional["User"]] = relationship(back_populates="folders")


class Question(Base):
    __tablename__ = "questions"

    id: Mapped[int] = mapped_column(primary_key=True)
    text: Mapped[str] = mapped_column(Text)
    question_type: Mapped[str] = mapped_column(String(20), default="mc")
    choices: Mapped[dict] = mapped_column(JSON, default=lambda: {"A": "", "B": "", "C": "", "D": ""})
    correct_answer: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    image_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    image_layout: Mapped[str] = mapped_column(String(20), default="above")
    num_choices: Mapped[int] = mapped_column(Integer, default=4)
    choice_images: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    owner_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    # Thema aus dem Kern (nicht CardVotes eigenes): verbindet die Frage mit
    # Lernpfad-Aufgaben desselben Themas. Optional — Bestandsfragen haben keins,
    # und ohne Thema bleibt die Frage voll nutzbar.
    topic_id: Mapped[Optional[int]] = mapped_column(ForeignKey("topics.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class QuestionSet(Base):
    __tablename__ = "question_sets"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    folder_id: Mapped[Optional[int]] = mapped_column(ForeignKey("folders.id", ondelete="CASCADE"), nullable=True)
    shuffle_questions: Mapped[bool] = mapped_column(Boolean, default=False)
    shuffle_answers: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    folder: Mapped[Optional[Folder]] = relationship(back_populates="question_sets")
    items: Mapped[list["QuestionSetItem"]] = relationship(back_populates="question_set", order_by="QuestionSetItem.position", cascade="all, delete-orphan")


class QuestionSetItem(Base):
    __tablename__ = "question_set_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    question_set_id: Mapped[int] = mapped_column(ForeignKey("question_sets.id", ondelete="CASCADE"))
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"))
    position: Mapped[int] = mapped_column(Integer)
    question_set: Mapped[QuestionSet] = relationship(back_populates="items")
    question: Mapped[Question] = relationship()


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(4), default="0000", server_default="0000")
    name: Mapped[str] = mapped_column(String(200), default="")
    class_id: Mapped[Optional[int]] = mapped_column(ForeignKey("school_classes.id"), nullable=True)
    question_set_id: Mapped[Optional[int]] = mapped_column(ForeignKey("question_sets.id"), nullable=True)
    current_question_id: Mapped[Optional[int]] = mapped_column(ForeignKey("questions.id"), nullable=True)
    owner_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="active")
    mode: Mapped[str] = mapped_column(String(20), default="test", server_default="test")
    archived: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    question_map: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    eval_config: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    scans: Mapped[list["Scan"]] = relationship(back_populates="session", cascade="all, delete-orphan")
    owner: Mapped[Optional["User"]] = relationship(back_populates="sessions")


class Scan(Base):
    __tablename__ = "scans"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"))
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id"))
    student_id: Mapped[int] = mapped_column(Integer)
    answer: Mapped[str] = mapped_column(String(1))
    scanned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    session: Mapped[Session] = relationship(back_populates="scans")


# ─── Nuvora-Kern: Klassen und Schueler ───
# Kerndaten, kein Modulbesitz: beide Module arbeiten darauf. Ein Modul, das
# eigene Klassen oder Schueler anlegt, hat den Sinn der Plattform gebrochen.
class SchoolClass(Base):
    __tablename__ = "school_classes"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    owner_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    # Standard-Anzahl Themenbloecke je Woche (Wochenplanung). Nur ein Vorschlag
    # beim Anlegen — die einzelne Woche darf abweichen.
    plan_blocks: Mapped[int] = mapped_column(Integer, default=2, server_default="2")
    # Einzigartiger Token fuer den Karten-Zugang (unratbar). Wird bei Bedarf gesetzt.
    karten_token: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    students: Mapped[list["Student"]] = relationship(back_populates="school_class", order_by="Student.card_id", cascade="all, delete-orphan")
    owner: Mapped[Optional["User"]] = relationship(back_populates="classes")


class Student(Base):
    __tablename__ = "students"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Nummer der bedruckten ArUco-Karte — CardVote-Zubehoer in einer
    # Kerntabelle. Sie bleibt hier, weil sie die Person innerhalb der Klasse
    # identifiziert (Scans referenzieren sie), aber der Kern darf sie nicht als
    # eigenes Konzept behandeln: die Oberflaeche zeigt sie nur, wenn CardVote
    # aktiviert ist. Weitere Modulbegriffe gehoeren NICHT hierher, sondern in
    # eine Tabelle des jeweiligen Moduls.
    card_id: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(200))
    class_id: Mapped[int] = mapped_column(ForeignKey("school_classes.id", ondelete="CASCADE"))

    # ─── Angaben zur Person, nicht zu einem Modul ───
    # Der Kern haelt, was ueber die Lernenden bekannt ist; jedes Modul
    # entscheidet selbst, was es davon nutzt. Lernpfad differenziert damit
    # seine Lernleitern, CardVote ignoriert es heute — beides ist in Ordnung.
    #
    # ACHTUNG, besonders schuetzenswert: foerder und notizen sind Daten nach
    # DSGVO Art. 9 (Dyskalkulie, LRS, Sozial-Emotional, Nachteilsausgleiche).
    # Sie duerfen NIE in Marktplatz-Veroeffentlichungen oder in Exporte
    # gelangen, die zum Teilen gedacht sind. Wer hier ein Feld ergaenzt,
    # prueft zuerst jeden Export- und Veroeffentlichungspfad.
    niveau: Mapped[str] = mapped_column(String(1), default="", server_default="")  # "E" | "G" | ""
    foerder: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    notizen: Mapped[str] = mapped_column(Text, default="", server_default="")
    # Einzigartiger Token fuer den kontenlosen Karten-Zugang (Bearer-Secret).
    karten_token: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, unique=True, index=True)
    # Klassenleitung des Kindes — am Schueler, nicht an der Klasse: ein Kurs
    # wie "Mathe 7.5" mischt Kinder aus mehreren Klassen mit je eigener
    # Klassenleitung. Freitext, weil Lehrkraefte keine Nuvora-Konten sind.
    klassenlehrer: Mapped[str] = mapped_column(String(120), default="", server_default="")

    school_class: Mapped[SchoolClass] = relationship(back_populates="students")


class MarketplaceQuiz(Base):
    __tablename__ = "marketplace_quizzes"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    author_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    author_name: Mapped[str] = mapped_column(String(200), default="")
    payload: Mapped[dict] = mapped_column(JSON)  # snapshot in cardvote_questionset format
    question_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    ratings: Mapped[list["MarketplaceRating"]] = relationship(back_populates="quiz", cascade="all, delete-orphan")


class MarketplaceRating(Base):
    __tablename__ = "marketplace_ratings"

    id: Mapped[int] = mapped_column(primary_key=True)
    quiz_id: Mapped[int] = mapped_column(ForeignKey("marketplace_quizzes.id", ondelete="CASCADE"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    stars: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    quiz: Mapped[MarketplaceQuiz] = relationship(back_populates="ratings")


# ─── Nuvora-Kern: Modulregister ───
# Module sind zuschaltbar. Der Kern besitzt Konten, Klassen und Schueler;
# Module arbeiten darauf, besitzen sie aber nicht. Welche Module eine Lehrkraft
# aktiviert hat, steht hier — eine Zeile pro aktiviertem Modul.
class UserModule(Base):
    __tablename__ = "user_modules"
    __table_args__ = (UniqueConstraint("user_id", "module_key", name="uq_user_module"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    module_key: Mapped[str] = mapped_column(String(50))
    activated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ─── Nuvora-Kern: Themen ───
# Der gemeinsame Wortschatz beider Module. CardVote-Fragen und Lernpfad-Aufgaben
# zeigen auf dieselben Themen — nur dadurch laesst sich ein in CardVote schwach
# ausgefallenes Thema spaeter auf passende Lernpfad-Aufgaben abbilden.
#
# Hierarchie ueber parent_id (Lernpfad nutzt heute genau zwei Ebenen:
# Thema > Unterthema). Die Tiefe ist bewusst nicht erzwungen — der Kern gibt
# den Wortschatz vor, nicht die Fachdidaktik eines Moduls.
class Topic(Base):
    __tablename__ = "topics"
    __table_args__ = (
        UniqueConstraint("owner_id", "parent_id", "name", name="uq_topic_name_per_parent"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    parent_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("topics.id", ondelete="CASCADE"), nullable=True, index=True
    )
    owner_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    position: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    children: Mapped[list["Topic"]] = relationship(
        back_populates="parent", cascade="all, delete-orphan"
    )
    parent: Mapped[Optional["Topic"]] = relationship(back_populates="children", remote_side="Topic.id")


# ─── Modul Lernpfad ───
# Fachdaten des Moduls. Sie zeigen auf den Kern (owner_id, topic_id, class_id),
# besitzen aber nichts davon. Was hier NICHT steht, ist Absicht: Klassen,
# Schueler und Themen gehoeren dem Kern — Lernpfad brachte frueher eigene mit.
class Exercise(Base):
    """Eine Aufgabe. Frueher `aufgaben` in Lernpfads eigener SQLite-Datei."""
    __tablename__ = "exercises"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    # Ersetzt Lernpfads freie Textfelder `thema`/`unterthema`: dieselbe
    # Taxonomie, auf die auch CardVote-Fragen zeigen. Erst dadurch findet ein
    # schwaches Testthema seine Uebungsaufgaben.
    topic_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("topics.id", ondelete="SET NULL"), nullable=True, index=True
    )

    kategorie: Mapped[str] = mapped_column(String(50), default="", server_default="")
    aufgabentext: Mapped[str] = mapped_column(Text, default="", server_default="")
    loesung: Mapped[str] = mapped_column(Text, default="", server_default="")
    operator: Mapped[str] = mapped_column(String(100), default="", server_default="")
    kompetenz: Mapped[str] = mapped_column(String(100), default="", server_default="")
    methode: Mapped[str] = mapped_column(String(100), default="", server_default="")
    unteraufgaben: Mapped[int] = mapped_column(Integer, default=1, server_default="1")

    quelle_typ: Mapped[str] = mapped_column(String(50), default="", server_default="")
    quelle_detail: Mapped[str] = mapped_column(String(255), default="", server_default="")

    lrs: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    lrs_text: Mapped[str] = mapped_column(Text, default="", server_default="")
    foerderschwerpunkte: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    latex: Mapped[str] = mapped_column(Text, default="", server_default="")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class LearningPath(Base):
    """Ein Lernpfad. Besteht aus mehreren Lernleitern (siehe LearningLadder) —
    das sind zwei Begriffe, nicht einer."""
    __tablename__ = "learning_paths"
    __table_args__ = (UniqueConstraint("owner_id", "name", name="uq_path_name_per_owner"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    ladders: Mapped[list["LearningLadder"]] = relationship(
        back_populates="path", cascade="all, delete-orphan", order_by="LearningLadder.position"
    )


class LearningLadder(Base):
    """Eine Lernleiter: eine Stufe eines Lernpfads — ein Thema, eine Klasse,
    und je Schueler eine eigene Aufgabenauswahl. Genau diese Auswahl ist die
    Differenzierung, um die es in dem Modul geht."""
    __tablename__ = "learning_ladders"

    id: Mapped[int] = mapped_column(primary_key=True)
    path_id: Mapped[int] = mapped_column(ForeignKey("learning_paths.id", ondelete="CASCADE"), index=True)
    # Zeigt auf die Klasse des Kerns. Frueher stand hier der Klassenname als
    # freier Text — ein Umbenennen der Klasse zerriss die Zuordnung.
    class_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("school_classes.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Das Thema der Stufe. Frueher thema/unterthema als Freitext.
    topic_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("topics.id", ondelete="SET NULL"), nullable=True, index=True
    )
    position: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    notizen: Mapped[str] = mapped_column(Text, default="", server_default="")
    # Aufgaben je Schueler: [{"student_id": 12, "exercise_ids": [3, 7, 9]}, ...]
    # Bewusst JSON statt eigener Tabelle: die Liste wird immer als Ganzes
    # gelesen und geschrieben, nie einzeln abgefragt.
    assignments: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    config: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    path: Mapped[LearningPath] = relationship(back_populates="ladders")


# ─── Modul Noten ───
# Eigenstaendig: es kommt ohne CardVote und ohne Lernpfad aus (Regel 3).
# Der Kern liefert Klassen und Schueler.
#
# Zwei Ebenen, wie ein Leistungskonzept: ABSCHNITTE (Klassenarbeit, Sonstige
# Mitarbeit) tragen die Gewichtung; darunter liegen SPALTEN (einzelne Arbeiten,
# Tests). Der Schnitt wird ueber die Abschnitte gewichtet; innerhalb eines
# Abschnitts zaehlen die Spalten gleich.
class GradeSection(Base):
    """Ein gewichteter Abschnitt, z.B. 'Klassenarbeiten' mit 50 %.
    Gewichte sind Fachkonferenz-Recht — das Werkzeug gibt keine vor."""
    __tablename__ = "grade_sections"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    # Abschnitte gelten pro Kurs/Klasse: verschiedene Faecher wiegen anders.
    class_id: Mapped[int] = mapped_column(ForeignKey("school_classes.id", ondelete="CASCADE"), index=True)
    # Halbjahr: jedes Halbjahr ein eigenes Notenbuch (eigene Abschnitte, Gewichte,
    # Endnote). "1"/"2" heute; String laesst spaeter "2024/1" zu.
    term: Mapped[str] = mapped_column(String(8), default="1", server_default="1", index=True)
    name: Mapped[str] = mapped_column(String(120))
    weight: Mapped[int] = mapped_column(Integer, default=0, server_default="0")  # Prozent
    position: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    categories: Mapped[list["GradeCategory"]] = relationship(
        back_populates="section", cascade="all, delete-orphan", order_by="GradeCategory.position"
    )


class GradeCategory(Base):
    """Eine Spalte innerhalb eines Abschnitts, z.B. eine einzelne
    Klassenarbeit. Traegt selbst KEIN Gewicht — das liegt am Abschnitt."""
    __tablename__ = "grade_categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    class_id: Mapped[int] = mapped_column(ForeignKey("school_classes.id", ondelete="CASCADE"), index=True)
    # Zu welchem Abschnitt gehoert die Spalte? Nullable nur fuer Altdaten —
    # der Backfill beim Start haengt sie an einen Standard-Abschnitt.
    section_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("grade_sections.id", ondelete="CASCADE"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(120))
    # Bleibt fuer Altdaten, wird aber nicht mehr zur Gewichtung genutzt.
    weight: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    position: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    section: Mapped[Optional["GradeSection"]] = relationship(back_populates="categories")
    entries: Mapped[list["GradeEntry"]] = relationship(back_populates="category", cascade="all, delete-orphan")


class GradeEntry(Base):
    """Ein Eintrag zu einer Person: entweder eine Note oder eine Beobachtung.

    Beides bewusst in einer Tabelle, aber mit `kind` getrennt: eine Beobachtung
    ("hat geholfen") ist keine Note und darf nie in einen Schnitt gerechnet
    werden. Wer das vermischt, erzeugt Scheinobjektivitaet.
    """
    __tablename__ = "grade_entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("grade_categories.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    # "grade" = zaehlt in den Schnitt, "observation" = zaehlt nie.
    kind: Mapped[str] = mapped_column(String(20), default="grade", server_default="grade")
    # Note als Zahl (1.0–6.0, Tendenzen als .3/.7). Bei Beobachtungen leer.
    value: Mapped[Optional[float]] = mapped_column(nullable=True)
    # Beobachtung: +1 positiv, -1 negativ, 0 neutral. Bei Noten leer.
    tendency: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    note: Mapped[str] = mapped_column(Text, default="", server_default="")
    # Datum der Stunde, nicht der Eingabe: nachtragen muss moeglich sein.
    date: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    category: Mapped[GradeCategory] = relationship(back_populates="entries")


class GradeOverride(Base):
    """Manuell gesetzte Note, die den errechneten Schnitt ersetzt.

    section_id gesetzt = Bereichsnote dieses Abschnitts; section_id NULL =
    Endnote. Die Note bleibt eine paedagogische Entscheidung — der Schnitt ist
    nur ein Vorschlag, den die Lehrkraft ueberschreiben und wieder loeschen darf.
    """
    __tablename__ = "grade_overrides"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    class_id: Mapped[int] = mapped_column(ForeignKey("school_classes.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    # NULL = Endnote, sonst die Bereichsnote dieses Abschnitts.
    section_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("grade_sections.id", ondelete="CASCADE"), nullable=True, index=True
    )
    # Halbjahr der Endnote (nur relevant, wenn section_id NULL ist).
    term: Mapped[str] = mapped_column(String(8), default="1", server_default="1")
    value: Mapped[float] = mapped_column(nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CalendarEntry(Base):
    """Unterrichtsplanung: ein Eintrag an einem Datum. Optional an eine Klasse
    und ein Thema geknuepft (Thema ON DELETE SET NULL — Regel 3)."""
    __tablename__ = "calendar_entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    class_id: Mapped[Optional[int]] = mapped_column(ForeignKey("school_classes.id", ondelete="CASCADE"), nullable=True, index=True)
    date: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    title: Mapped[str] = mapped_column(String(200), default="", server_default="")
    notes: Mapped[str] = mapped_column(Text, default="", server_default="")
    topic_id: Mapped[Optional[int]] = mapped_column(ForeignKey("topics.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TimetableSlot(Base):
    """Modul Kalender: eine Stunde im wiederkehrenden Wochen-Stundenplan.
    Keyed ueber Wochentag (0=Mo .. 6=So) + Stundennummer. Klasse und Thema
    kommen aus dem Kern (Thema ON DELETE SET NULL — Regel 3); title ist freies
    Eintragen, wenn keine Klasse/kein Thema passt."""
    __tablename__ = "timetable_slots"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    weekday: Mapped[int] = mapped_column(Integer)  # 0 = Montag
    period: Mapped[int] = mapped_column(Integer)    # 1-basiert
    class_id: Mapped[Optional[int]] = mapped_column(ForeignKey("school_classes.id", ondelete="CASCADE"), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(200), default="", server_default="")
    topic_id: Mapped[Optional[int]] = mapped_column(ForeignKey("topics.id", ondelete="SET NULL"), nullable=True, index=True)


class QuartalDivider(Base):
    """Optischer Quartalsstrich in der Notentabelle — nach welcher Spalte er
    steht. Mehrere je Klasse+Halbjahr moeglich, rein visuell."""
    __tablename__ = "quartal_dividers"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    class_id: Mapped[int] = mapped_column(ForeignKey("school_classes.id", ondelete="CASCADE"), index=True)
    term: Mapped[str] = mapped_column(String(8), default="1", server_default="1")
    after_category_id: Mapped[int] = mapped_column(ForeignKey("grade_categories.id", ondelete="CASCADE"), index=True)


# ─── Nuvora-Kern: Wochenplanung ───
# Verbindet, was die Module tun: eine Woche hat 1–3 Themenbloecke (aus der
# Taxonomie) und am Ende einen Test ueber diese Themen. Kern, kein Modul —
# sie setzt keins voraus (Regel 3): Themen liegen im Kern, der Test ist ein
# Marker, den CardVote spaeter fuellen kann.
class PlanWeek(Base):
    __tablename__ = "plan_weeks"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    class_id: Mapped[int] = mapped_column(ForeignKey("school_classes.id", ondelete="CASCADE"), index=True)
    # Freie Beschriftung, z.B. "Woche 12" oder "17.–21. März".
    label: Mapped[str] = mapped_column(String(120), default="", server_default="")
    position: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    notiz: Mapped[str] = mapped_column(Text, default="", server_default="")
    # Test am Ende der Woche geschrieben? Spaeter kann CardVote das fuellen.
    test_done: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    blocks: Mapped[list["PlanBlock"]] = relationship(
        back_populates="week", cascade="all, delete-orphan", order_by="PlanBlock.position"
    )


class PlanBlock(Base):
    """Ein Themenblock einer Woche — Verweis auf ein Kern-Thema."""
    __tablename__ = "plan_blocks"

    id: Mapped[int] = mapped_column(primary_key=True)
    week_id: Mapped[int] = mapped_column(ForeignKey("plan_weeks.id", ondelete="CASCADE"), index=True)
    topic_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("topics.id", ondelete="SET NULL"), nullable=True, index=True
    )
    position: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    week: Mapped[PlanWeek] = relationship(back_populates="blocks")


# ─── Modul Karten (Karteikarten, Spaced Repetition) ───
# Eigenstaendig (Regel 3). Kein Schueler-Login: Zugriff ueber einen
# einzigartigen Token pro Schueler (wie die gedruckte CardVote-Karte). Der
# Token IST die Identitaet — Bearer-Secret, muss unratbar sein.
class CardDeck(Base):
    """Ein Kartenstapel je Klasse."""
    __tablename__ = "card_decks"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    class_id: Mapped[int] = mapped_column(ForeignKey("school_classes.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120), default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Ausrollen: NULL = Entwurf, fuer SuS unsichtbar. Gesetzt = ab diesem
    # Zeitpunkt faellig (jetzt = sofort, Zukunft = geplant).
    released_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    cards: Mapped[list["Card"]] = relationship(back_populates="deck", cascade="all, delete-orphan", order_by="Card.position")


class Card(Base):
    __tablename__ = "cards"

    id: Mapped[int] = mapped_column(primary_key=True)
    deck_id: Mapped[int] = mapped_column(ForeignKey("card_decks.id", ondelete="CASCADE"), index=True)
    front: Mapped[str] = mapped_column(Text, default="", server_default="")
    back: Mapped[str] = mapped_column(Text, default="", server_default="")
    position: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    deck: Mapped[CardDeck] = relationship(back_populates="cards")


class CardReview(Base):
    """SM-2-Zustand je (Schueler, Karte). Fortschritt liegt am Server, damit
    die Lehrkraft ihn sieht — anders als bei Anki (Fortschritt am Geraet)."""
    __tablename__ = "card_reviews"
    __table_args__ = (UniqueConstraint("student_id", "card_id", name="uq_review_student_card"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    card_id: Mapped[int] = mapped_column(ForeignKey("cards.id", ondelete="CASCADE"), index=True)
    ease: Mapped[int] = mapped_column(Integer, default=250, server_default="250")   # SM-2 EF * 100
    interval_days: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    reps: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    lapses: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    due: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_reviewed: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
