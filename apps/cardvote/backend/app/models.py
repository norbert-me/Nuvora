from datetime import datetime
from typing import Optional

from sqlalchemy import ForeignKey, String, Text, DateTime, Integer, JSON, Boolean, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


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


class SchoolClass(Base):
    __tablename__ = "school_classes"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    owner_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    students: Mapped[list["Student"]] = relationship(back_populates="school_class", order_by="Student.card_id", cascade="all, delete-orphan")
    owner: Mapped[Optional["User"]] = relationship(back_populates="classes")


class Student(Base):
    __tablename__ = "students"

    id: Mapped[int] = mapped_column(primary_key=True)
    card_id: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(200))
    class_id: Mapped[int] = mapped_column(ForeignKey("school_classes.id", ondelete="CASCADE"))
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
