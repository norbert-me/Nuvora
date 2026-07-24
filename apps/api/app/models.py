from datetime import datetime
from typing import Optional

from sqlalchemy import ForeignKey, String, Text, DateTime, Integer, JSON, Boolean, LargeBinary, UniqueConstraint, func
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
    # Noten mit Tendenz (2+/2-) statt ganzer Note (2). Default an — Module (Klassen-
    # arbeit, CardVote) übernehmen das als Voreinstellung.
    grade_tendency: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    token_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    pending_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    # Wurde das Konto schon einmal ans Modulregister angeschlossen? Verhindert,
    # dass der Backfill beim Start ein abgeschaltetes Modul wieder aktiviert.
    modules_initialized: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    # Unratbares Token fuer den ICS-Kalender-Abo-Feed (Apple/Google abonnieren
    # per URL ohne Login). Erst bei Bedarf gesetzt.
    calendar_token: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, unique=True, index=True)
    # Externer Kalender (ICS-URL, z.B. Google/Apple), den Nuvora read-only
    # einblendet — die „andere Richtung". Leer = aus. Isoliert/leicht entfernbar.
    external_ics_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Eigene Anzeigefarbe für abonnierte (externe) Termine (Hex, "" = Standard).
    external_ics_color: Mapped[str] = mapped_column(String(9), default="", server_default="")
    # Einstiege-Startsammlung einmalig angelegt? Danach nicht erneut seeden,
    # auch wenn die Lehrkraft alle Einstiege loescht (sonst tauchen sie wieder auf).
    methoden_seeded: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    # Modul Kalender: Stunden pro Tag im hinterlegten Stundenplan (Einstellung).
    timetable_periods: Mapped[int] = mapped_column(Integer, default=6, server_default="6")
    # Uhrzeiten je Stunde: Liste [{start,end}] (Index = Stunde-1). Optional.
    timetable_times: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
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
    # Besitzer — nötig für Fragensets OHNE Ordner (Top-Level). In Ordnern kommt der
    # Besitz sonst über folder.owner_id; ein ordnerloses Set braucht ihn direkt.
    owner_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
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
class Kurs(Base):
    """Eine Lerngruppe (die echten SuS). Mehrere Fach-Klassen (Mathe 7.5,
    Lernzeit 7.5) hängen am selben Kurs und teilen sich dessen Schüler und
    Anwesenheit — Karten/Noten/Orga bleiben pro Fach-Klasse. Phase 1: jede
    Klasse hat vorerst ihren eigenen Kurs (1:1)."""
    __tablename__ = "kurse"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100), default="", server_default="")
    # Papierkorb: gesetzt = gelöscht, 30 Tage wiederherstellbar. deleted_members
    # merkt sich die (Sharing-)Klassen beim Löschen, damit Restore sie neu gruppiert.
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    deleted_members: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    # Nutzt dieser Kurs E-/G-Niveaus? Nur dann zeigt die UI die E/G-Auswahl —
    # bei Kursen ohne Niveau-Differenzierung nervt sie sonst. E/G wird im Kurs
    # gepflegt (nicht je Fach-Klasse), weil es die Person betrifft.
    niveau_aktiv: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    # Farbe des Kurses (Stundenplan/Kalender). Die Fach-Klassen teilen sie sich —
    # darum am Kurs, nicht je Klasse.
    color: Mapped[str] = mapped_column(String(9), default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class KursTag(Base):
    """Lose Mehrfach-Zugehörigkeit: eine Klasse kann zusätzlich zu ihrem einen
    Sharing-Kurs (SchoolClass.kurs_id) in weiteren Kursen als Etikett stehen —
    nur Gruppierung, KEIN Teilen von SuS/Anwesenheit."""
    __tablename__ = "kurs_tags"
    __table_args__ = (UniqueConstraint("kurs_id", "class_id", name="uq_kurs_tag"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    kurs_id: Mapped[int] = mapped_column(ForeignKey("kurse.id", ondelete="CASCADE"), index=True)
    class_id: Mapped[int] = mapped_column(ForeignKey("school_classes.id", ondelete="CASCADE"), index=True)


class KursStudent(Base):
    """Einzelne SuS in einem Kurs — für Kurse aus TEILEN von Klassen (eine Auswahl
    von Schülern mehrerer Klassen). Zusätzlich zu den ganzen Klassen (KursTag /
    SchoolClass.kurs_id). Der Roster eines Kurses ist die Vereinigung beider."""
    __tablename__ = "kurs_students"
    __table_args__ = (UniqueConstraint("kurs_id", "student_id", name="uq_kurs_student"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    kurs_id: Mapped[int] = mapped_column(ForeignKey("kurse.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)


class SchoolClass(Base):
    __tablename__ = "school_classes"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    owner_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    # Zugehöriger Kurs (Lerngruppe). Fach-Klassen mit gleichem kurs_id teilen SuS.
    kurs_id: Mapped[Optional[int]] = mapped_column(ForeignKey("kurse.id", ondelete="SET NULL"), nullable=True, index=True)
    # Standard-Anzahl Themenbloecke je Woche (Wochenplanung). Nur ein Vorschlag
    # beim Anlegen — die einzelne Woche darf abweichen.
    plan_blocks: Mapped[int] = mapped_column(Integer, default=2, server_default="2")
    # Anzeigefarbe (Hex), z.B. im Kalender/Stundenplan. Wird beim Anlegen
    # automatisch vergeben, ist aber aenderbar.
    color: Mapped[str] = mapped_column(String(9), default="", server_default="")
    # Einzigartiger Token fuer den Karten-Zugang (unratbar). Wird bei Bedarf gesetzt.
    karten_token: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, unique=True, index=True)
    # Papierkorb: gesetzt = gelöscht, aber 30 Tage wiederherstellbar. Die Kaskade
    # (Schüler → Noten/Karten/…) bleibt in dieser Zeit unangetastet.
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
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
    # Zugehöriger Kurs (Lerngruppe der Klasse). Anwesenheit wird über den Kurs
    # geteilt: gleichnamige SuS der Fach-Klassen desselben Kurses gelten als
    # dieselbe Person. Karten/Noten bleiben pro Klasse (Student-Zeile).
    kurs_id: Mapped[Optional[int]] = mapped_column(ForeignKey("kurse.id", ondelete="SET NULL"), nullable=True, index=True)

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
    # Art des Inhalts: "cardvote_questionset" | "karten_deck" | "method".
    # Default = Quiz, damit Bestandszeilen ohne Migration gueltig bleiben.
    kind: Mapped[str] = mapped_column(String(30), default="cardvote_questionset", server_default="cardvote_questionset")
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    author_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    author_name: Mapped[str] = mapped_column(String(200), default="")
    payload: Mapped[dict] = mapped_column(JSON)  # Snapshot je nach kind
    question_count: Mapped[int] = mapped_column(Integer, default=0)  # Zahl der Elemente (Fragen/Karten)
    # Wie oft übernommen — Orientierung („beliebt?"). Steigt bei jeder Kopie.
    copies: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
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
    # Freie Notiz je Thema/Unterthema: Lernziele/Inhalt ("Was sollen die SuS hier
    # lernen?") zur Unterrichtsplanung. Rein für die Lehrkraft, kein Modul hängt daran.
    notes: Mapped[str] = mapped_column(Text, default="", server_default="")
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

    # Anzeige-Code (#000001), lueckenfuellend je Lehrkraft vergeben — getrennt
    # von der DB-id, damit die Nummerierung bei 1 beginnt statt bei der
    # fortlaufenden Datenbank-id.
    code: Mapped[str] = mapped_column(String(20), default="", server_default="")
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
    # Papierkorb: gesetzt = gelöscht, 30 Tage wiederherstellbar (Lernleitern bleiben).
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
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
    # Soft-Delete: eine entfernte Lernleiter wandert in den Papierkorb (statt hart
    # geloescht zu werden) und ist wiederherstellbar.
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True, index=True)

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
    # Abschnitte gelten pro Kurs (Fach): dieselbe Klasse (SuS) wird in Mathe
    # anders bewertet als in Info. kurs_id NULL = Klasse ohne Kurs (Fallback).
    class_id: Mapped[int] = mapped_column(ForeignKey("school_classes.id", ondelete="CASCADE"), index=True)
    kurs_id: Mapped[Optional[int]] = mapped_column(ForeignKey("kurse.id", ondelete="CASCADE"), nullable=True, index=True)
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
    # Wurde die Spalte aus einer CardVote-Session uebernommen? Dann zeigt das
    # Notenbuch einen Link zur Auswertung. SET NULL: Session-Loeschung laesst die
    # Note bestehen (Regel 3 — kein Modul reisst das andere mit).
    source_session_id: Mapped[Optional[int]] = mapped_column(ForeignKey("sessions.id", ondelete="SET NULL"), nullable=True, index=True)
    # Herkunft der Spalte, damit das Notenbuch die Quelle kennzeichnet:
    # "cardvote" | "karten" | "codedetektiv" (leer = von Hand angelegt).
    source_kind: Mapped[str] = mapped_column(String(20), default="", server_default="")
    # Thema der Spalte (z.B. eine Klassenarbeit deckt ein Thema ab). Optional,
    # SET NULL. Grundlage fuer den Nachholbedarf: schwache SuS -> Karten des
    # Themas wieder faellig setzen / Aufgaben vorschlagen.
    topic_id: Mapped[Optional[int]] = mapped_column(ForeignKey("topics.id", ondelete="SET NULL"), nullable=True, index=True)
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
    # Endnote-Override (section_id NULL) haengt am Kurs (Fach) wie die Abschnitte.
    kurs_id: Mapped[Optional[int]] = mapped_column(ForeignKey("kurse.id", ondelete="CASCADE"), nullable=True, index=True)
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
    # Gewaehlter Kurs (Fach) — dieselbe Fach-Klasse kann in mehreren Kursen liegen;
    # ohne diesen Hinweis riete die Auswahl beim Bearbeiten den falschen Kurs.
    kurs_id: Mapped[Optional[int]] = mapped_column(ForeignKey("kurse.id", ondelete="SET NULL"), nullable=True, index=True)
    date: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    title: Mapped[str] = mapped_column(String(200), default="", server_default="")
    notes: Mapped[str] = mapped_column(Text, default="", server_default="")
    topic_id: Mapped[Optional[int]] = mapped_column(ForeignKey("topics.id", ondelete="SET NULL"), nullable=True, index=True)
    # Optionaler Unterrichtseinstieg/Methode aus dem Modul Methoden (Regel 3:
    # ON DELETE SET NULL, der Eintrag bleibt ohne die Methode nutzbar).
    method_id: Mapped[Optional[int]] = mapped_column(ForeignKey("methods.id", ondelete="SET NULL"), nullable=True, index=True)
    # Aus welcher Stundenplan-Stunde der Eintrag stammt (1..n). Macht die Zuordnung
    # Tag+Stunde eindeutig, damit ein erneuter Klick auf dieselbe Stunde den
    # vorhandenen Eintrag bearbeitet statt einen zweiten anzulegen.
    period: Mapped[Optional[int]] = mapped_column(nullable=True)
    # Optionale freie Uhrzeit ("HH:MM"), unabhaengig vom Stundenplan. Gesetzt =
    # getakteter Termin (hat Vorrang vor der period-Uhrzeit im ICS/Tagesplan).
    start_time: Mapped[str] = mapped_column(String(5), default="", server_default="")
    end_time: Mapped[str] = mapped_column(String(5), default="", server_default="")
    # Verknuepfte Modul-Objekte (Regel 3: alle optional, ON DELETE SET NULL —
    # der Eintrag bleibt ohne das jeweilige Modul voll nutzbar). CardVote-Quiz,
    # Karten-Deck (wird am Kalendertag freigeschaltet), Lernpfad-Lernleiter.
    cardvote_set_id: Mapped[Optional[int]] = mapped_column(ForeignKey("question_sets.id", ondelete="SET NULL"), nullable=True, index=True)
    karten_deck_id: Mapped[Optional[int]] = mapped_column(ForeignKey("card_decks.id", ondelete="SET NULL"), nullable=True, index=True)
    lernpfad_ladder_id: Mapped[Optional[int]] = mapped_column(ForeignKey("learning_ladders.id", ondelete="SET NULL"), nullable=True, index=True)
    # Code-Detektiv-Rätsel per stabiler client_id (kein FK, App-eigener ID-Raum).
    codedetektiv_puzzle: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Attendance(Base):
    """Modul Anwesenheit: ein Status je (Schueler, Datum, Stunde). Schueler
    bleiben im Kern (Regel 3). status: da | fehlt | spaet | entsch. period NULL =
    ganzer Tag; je Stunde eine Zeile, damit sich Stunden unterscheiden."""
    __tablename__ = "attendance"
    __table_args__ = (UniqueConstraint("student_id", "date", "period", name="uq_attendance_student_date_period"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    class_id: Mapped[int] = mapped_column(ForeignKey("school_classes.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    date: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    status: Mapped[str] = mapped_column(String(10), default="da", server_default="da")
    note: Mapped[str] = mapped_column(Text, default="", server_default="")
    # Optional: auf welche Stunde (Stundenplan-Period) sich der Fehltag bezieht.
    # 0/NULL = ganzer Tag. Ein Datensatz je (Schueler, Datum).
    period: Mapped[Optional[int]] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CodePuzzle(Base):
    """Modul Code-Detektiv: ein Rätsel serverseitig, damit es themen-getaggt und
    im Kalender planbar ist. `client_id` ist die stabile ID der App; `payload`
    hält das ganze Rätselobjekt. topic_id ON DELETE SET NULL (Regel 3)."""
    __tablename__ = "code_puzzles"
    __table_args__ = (UniqueConstraint("owner_id", "client_id", name="uq_codepuzzle_owner_client"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    client_id: Mapped[str] = mapped_column(String(64), index=True)
    title: Mapped[str] = mapped_column(String(200), default="", server_default="")
    topic_id: Mapped[Optional[int]] = mapped_column(ForeignKey("topics.id", ondelete="SET NULL"), nullable=True, index=True)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CodeSession(Base):
    """Modul Code-Detektiv: eine Klassen-Session serverseitig, damit Schueler von
    eigenen Geraeten per Code beitreten koennen (oeffentlich, ohne Login). Die
    gewaehlten Raetsel werden als Schnappschuss eingebettet (auch Beispiel-Raetsel,
    die sonst nur im Browser liegen). players/results als JSON-Listen."""
    __tablename__ = "code_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    code: Mapped[str] = mapped_column(String(8), unique=True, index=True)
    puzzles: Mapped[list] = mapped_column(JSON, default=list)   # Schnappschuss der Raetselobjekte
    players: Mapped[list] = mapped_column(JSON, default=list)   # [{name, joinedAt}]
    results: Mapped[list] = mapped_column(JSON, default=list)   # [{playerName,puzzleId,solved,attempts,time}]
    started: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    ended: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    current_index: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    round_started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class ZufallDraw(Base):
    """Modul Zufallsschüler: wann eine Person zuletzt gezogen wurde. Nur das
    letzte Datum je Schüler (Regel 3: Schüler im Kern). Grundlage für faire
    Gewichtung (lange nicht dran = höheres Gewicht) und „nicht zweimal am
    Stück"."""
    __tablename__ = "zufall_draws"
    __table_args__ = (UniqueConstraint("owner_id", "student_id", name="uq_zufall_owner_student"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    class_id: Mapped[int] = mapped_column(ForeignKey("school_classes.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    drawn_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SeatingPlan(Base):
    """Modul Sitzplan: ein Rasterlayout je Klasse. `data` haelt Spaltenzahl und
    die Zellenbelegung (Schueler-IDs) als JSON — Schueler bleiben im Kern, hier
    liegen nur ihre Positionen (Regel 3)."""
    __tablename__ = "seating_plans"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    class_id: Mapped[int] = mapped_column(ForeignKey("school_classes.id", ondelete="CASCADE"), index=True)
    # Sitzplan haengt am Kurs (Fach): dieselbe Klasse sitzt in Mathe anders als
    # in Info. kurs_id NULL = Klasse ohne Kurs (Fallback auf class_id).
    kurs_id: Mapped[Optional[int]] = mapped_column(ForeignKey("kurse.id", ondelete="CASCADE"), nullable=True, index=True)
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class OrgaItem(Base):
    """Modul Orga: ein Sammel-/Orga-Punkt je Klasse (z.B. „Unterschrift KA1").
    `done` hält die Schueler-IDs, die erledigt sind (JSON-Liste). Schueler
    bleiben im Kern (Regel 3)."""
    __tablename__ = "orga_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    class_id: Mapped[int] = mapped_column(ForeignKey("school_classes.id", ondelete="CASCADE"), index=True)
    # Checkliste hängt am Kurs (Fach). NULL = Klasse ohne Kurs (Fallback).
    kurs_id: Mapped[Optional[int]] = mapped_column(ForeignKey("kurse.id", ondelete="CASCADE"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(160), default="", server_default="")
    position: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    done: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class MaterialItem(Base):
    """Modul Material-Ausleihe: ein Gegenstand, den die Lehrkraft verleiht."""
    __tablename__ = "material_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(160), default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    loans: Mapped[list["MaterialLoan"]] = relationship(back_populates="item", cascade="all, delete-orphan")


class MaterialLoan(Base):
    """Eine Ausleihe: Gegenstand an eine Person (Kern-Schueler oder Freitext).
    returned_at NULL = noch offen. student_id ON DELETE SET NULL (Regel 3)."""
    __tablename__ = "material_loans"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("material_items.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[Optional[int]] = mapped_column(ForeignKey("students.id", ondelete="SET NULL"), nullable=True)
    borrower: Mapped[str] = mapped_column(String(160), default="", server_default="")  # Anzeigename
    out_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    returned_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    item: Mapped[MaterialItem] = relationship(back_populates="loans")


class CalendarBreak(Base):
    """Unterrichtsfreier Zeitraum (Ferien, beweglicher Feiertag). An Tagen
    innerhalb des Zeitraums zeigt der Kalender weder Stundenplan-Vorlagen noch
    Eintraege — sie bleiben in der DB, sind aber ausgeblendet."""
    __tablename__ = "calendar_breaks"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    start_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    end_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    label: Mapped[str] = mapped_column(String(120), default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Method(Base):
    """Modul Einstiege: eine Idee fuer den Unterrichtseinstieg — Kurzbeschreibung
    (Idee), Ablauf mit Material, Materialliste und ungefaehre Dauer.
    (Tabellenname bleibt "methods"; kind/phase bleiben als Altspalten erhalten.)"""
    __tablename__ = "methods"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20), default="einstieg", server_default="einstieg")  # Altspalte
    title: Mapped[str] = mapped_column(String(200), default="", server_default="")
    description: Mapped[str] = mapped_column(Text, default="", server_default="")  # die Idee als Text
    ablauf: Mapped[str] = mapped_column(Text, default="", server_default="")       # Ablauf mit Material
    material: Mapped[str] = mapped_column(Text, default="", server_default="")     # Materialliste
    dauer: Mapped[Optional[int]] = mapped_column(nullable=True)                    # ca. Dauer in Minuten
    phase: Mapped[str] = mapped_column(String(40), default="", server_default="")  # Altspalte
    # Optionale Themen-Bindung (Kern-Taxonomie), damit ein schwaches Thema einen
    # passenden Einstieg vorschlagen kann. ON DELETE SET NULL (Regel 3).
    topic_id: Mapped[Optional[int]] = mapped_column(ForeignKey("topics.id", ondelete="SET NULL"), nullable=True, index=True)
    # Ordner (wie CardVote/Karten). NULL = Wurzel. ON DELETE SET NULL: löscht man
    # einen Ordner, wandern seine Einstiege in die Wurzel statt mitzusterben.
    folder_id: Mapped[Optional[int]] = mapped_column(ForeignKey("method_folders.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class MethodFolder(Base):
    """Ordner für Einstiege — nur der Lehrkraft zugeordnet (Einstiege sind global,
    nicht pro Klasse). Verschachtelbar über parent_id."""
    __tablename__ = "method_folders"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    parent_id: Mapped[Optional[int]] = mapped_column(ForeignKey("method_folders.id", ondelete="CASCADE"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(120), default="", server_default="")


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
    # Der gewaehlte Kurs (Fach) — die Anzeige denkt in Kursen. class_id bleibt fuer
    # den Inhalt (eine Fach-Klasse), kurs_id haelt fest, WELCHER Kurs gemeint war
    # (eine Klasse kann in mehreren Kursen liegen — sonst raet die Anzeige).
    kurs_id: Mapped[Optional[int]] = mapped_column(ForeignKey("kurse.id", ondelete="SET NULL"), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(200), default="", server_default="")
    topic_id: Mapped[Optional[int]] = mapped_column(ForeignKey("topics.id", ondelete="SET NULL"), nullable=True, index=True)


class SlotCancellation(Base):
    """Eine einzelne Stundenplan-Stunde entfällt an EINEM Tag (Datum + Stunde).
    Die wiederkehrende Vorlage bleibt; nur diese Ausnahme blendet sie aus."""
    __tablename__ = "slot_cancellations"
    __table_args__ = (UniqueConstraint("owner_id", "date", "period", name="uq_slotcancel"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    date: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    period: Mapped[int] = mapped_column(Integer)


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
    # Kartenstapel gelten für den ganzen KURS (alle Fach-Klassen), nicht die
    # einzelne Klasse. class_id bleibt als Herkunft/Fallback.
    kurs_id: Mapped[Optional[int]] = mapped_column(ForeignKey("kurse.id", ondelete="SET NULL"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(120), default="", server_default="")
    # Niveau-Stapel: "E"/"G" nur fuer Schueler des jeweiligen Niveaus, "" fuer
    # alle. So teilt eine Stunde automatisch getrennte Kartensaetze aus.
    niveau: Mapped[str] = mapped_column(String(1), default="", server_default="")
    # Optionale Bindung an ein Kern-Thema (oder NULL = freie Karten). Kalender-
    # Eintraege mit demselben Thema rollen den Stapel automatisch aus.
    topic_id: Mapped[Optional[int]] = mapped_column(ForeignKey("topics.id", ondelete="SET NULL"), nullable=True, index=True)
    # Optionaler Ordner (wie bei CardVote) zum Gruppieren der Stapel. NULL = Wurzel.
    folder_id: Mapped[Optional[int]] = mapped_column(ForeignKey("card_folders.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Papierkorb: gesetzt = gelöscht, 30 Tage wiederherstellbar (Karten-Fortschritt bleibt).
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    # Ausrollen: NULL = Entwurf, fuer SuS unsichtbar. Gesetzt = ab diesem
    # Zeitpunkt faellig (jetzt = sofort, Zukunft = geplant).
    released_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    cards: Mapped[list["Card"]] = relationship(back_populates="deck", cascade="all, delete-orphan", order_by="Card.position")


class CardFolder(Base):
    """Ordner zum Gruppieren von Kartenstapeln (wie CardVote-Ordner), pro
    Klasse/Kurs. Verschachtelt über parent_id. Löschen eines Ordners kaskadiert
    zu Unterordnern; die Stapel darin wandern in die Wurzel (deck.folder_id SET NULL)."""
    __tablename__ = "card_folders"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    class_id: Mapped[int] = mapped_column(ForeignKey("school_classes.id", ondelete="CASCADE"), index=True)
    kurs_id: Mapped[Optional[int]] = mapped_column(ForeignKey("kurse.id", ondelete="SET NULL"), nullable=True, index=True)
    parent_id: Mapped[Optional[int]] = mapped_column(ForeignKey("card_folders.id", ondelete="CASCADE"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(120), default="", server_default="")


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
    die Lehrkraft ihn sieht — der Fortschritt liegt am Server, nicht am Geraet."""
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


class WorkAnalysis(Base):
    """Modul „Klassenarbeit auswerten": eine Arbeit als Aufgaben-Raster.

    Je Aufgabe ein Thema (topic_id); je SuS richtig/falsch. Daraus entsteht pro
    SuS ein Fehlerprofil nach Thema → gezielte Wiederholung (Karten wieder fällig
    / Lernpfad-Aufgabe). Eigenständig (Regel 3): eigene Tabelle, keine Abhängigkeit;
    die Themen kommen aus dem Kern, Karten/Lernpfad sind optionale Brücken.

    tasks (JSON):   [{"id": "t1", "label": "Bruch addieren", "topic_id": 5}, …]
    results (JSON): {"<student_id>": ["t2", "t5"]}  — je SuS die FALSCHEN Aufgaben-ids
    """
    __tablename__ = "work_analyses"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    class_id: Mapped[int] = mapped_column(ForeignKey("school_classes.id", ondelete="CASCADE"), index=True)
    kurs_id: Mapped[Optional[int]] = mapped_column(ForeignKey("kurse.id", ondelete="CASCADE"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(200), default="", server_default="")
    tasks: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    results: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    # Abwesende SuS (Liste von student_id als String). Orthogonal zu results:
    # abwesend heisst „aus der Klassenstatistik rausrechnen", loescht aber die
    # erreichten Punkte NICHT — kommt der SuS zurueck, sind sie noch da.
    absent: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    # Notenschlüssel dieser Arbeit ({"1":87,…}). NULL = Voreinstellung aus dem
    # Profil (users.grade_scale). Der Schlüssel ist eine paedagogische Wahl je
    # Arbeit, darum ueberschreibbar — Default bleibt das Profil.
    scale: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SegelStatus(Base):
    """SEGEL-Stufe je Schueler und Kurs (Helios-Konzept: Hafen → Küste → Meer →
    Welt, zunehmende Selbststeuerung). Wird am Sitzplatz angezeigt. Haengt wie der
    Sitzplan am Kurs (kurs_id) mit Klassen-Fallback (class_id). Schueler CASCADE."""
    __tablename__ = "segel_status"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    class_id: Mapped[Optional[int]] = mapped_column(ForeignKey("school_classes.id", ondelete="CASCADE"), nullable=True, index=True)
    kurs_id: Mapped[Optional[int]] = mapped_column(ForeignKey("kurse.id", ondelete="CASCADE"), nullable=True, index=True)
    stage: Mapped[str] = mapped_column(String(10), default="", server_default="")  # hafen|kueste|meer|welt


class Material(Base):
    """Datei-/Materialablage der Lehrkraft, an ein Thema und/oder eine Stunde
    (Kalender-Eintrag) gehaengt. Beides optional und ON DELETE SET NULL (Regel 3:
    das Material bleibt, wenn Thema/Eintrag verschwinden). Inhalt liegt in der DB
    (durabel, owner-scoped, faellt mit dem Konto weg). Nicht geteilt, nicht im
    Marktplatz — reine private Ablage."""
    __tablename__ = "materials"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    topic_id: Mapped[Optional[int]] = mapped_column(ForeignKey("topics.id", ondelete="SET NULL"), nullable=True, index=True)
    entry_id: Mapped[Optional[int]] = mapped_column(ForeignKey("calendar_entries.id", ondelete="SET NULL"), nullable=True, index=True)
    filename: Mapped[str] = mapped_column(String(255))
    mime: Mapped[str] = mapped_column(String(120), default="", server_default="")
    size: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    data: Mapped[bytes] = mapped_column(LargeBinary)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
