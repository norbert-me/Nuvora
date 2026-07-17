#!/usr/bin/env python3
"""Uebernimmt Daten der alten Lernleiter-App (SQLite) in den Nuvora-Kern.

Es ist keine Kopie, sondern eine Uebersetzung:

    thema + unterthema (Freitext)  ->  topics (Kern-Taxonomie, zweistufig)
    klassen.name (Freitext)        ->  school_classes
    schueler                       ->  students (mit niveau/foerder/notizen)
    aufgaben                       ->  exercises (topic_id statt Freitext)
    lernpfade + lernleitern (JSON) ->  learning_paths + learning_ladders

Aufruf auf dem Server (dort liegen DB und Daten):

    docker compose cp scripts/migrate-lernleiter.py api:/tmp/m.py
    docker compose cp /mnt/nas/lernleiter/data/lernleiter.db api:/tmp/alt.db
    docker compose exec api python /tmp/m.py --sqlite /tmp/alt.db --email DEINE@MAIL --dry-run
    # sieht es gut aus, dann ohne --dry-run

Idempotent: laeuft das Skript zweimal, entstehen keine Dubletten — Themen,
Klassen und Schueler werden am Namen wiedererkannt, Aufgaben an Thema +
Aufgabentext.
"""
import argparse
import asyncio
import json
import sqlite3
import sys

from sqlalchemy import select

sys.path.insert(0, "/app")

from app.database import async_session  # noqa: E402
from app.models import (  # noqa: E402
    Exercise, LearningLadder, LearningPath, SchoolClass, Student, Topic, User, UserModule,
)


def _json(value, fallback):
    if not value:
        return fallback
    try:
        return json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return fallback


async def migrate(sqlite_path: str, email: str, dry_run: bool) -> int:
    src = sqlite3.connect(sqlite_path)
    src.row_factory = sqlite3.Row
    cur = src.cursor()

    async with async_session() as db:
        user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
        if not user:
            print(f"FEHLER: kein Nuvora-Konto mit der Adresse {email}.")
            print("Erst in Nuvora registrieren, dann migrieren.")
            return 1
        print(f"Ziel-Konto: {user.email} (id {user.id})\n")

        # ─── Themen: thema/unterthema -> zweistufige Taxonomie ───
        paare = cur.execute(
            "SELECT DISTINCT thema, unterthema FROM aufgaben "
            "WHERE thema IS NOT NULL AND thema != '' ORDER BY thema, unterthema"
        ).fetchall()

        topic_id: dict[tuple, int] = {}   # (thema, unterthema|None) -> id

        async def topic_for(name: str, parent_id=None):
            key = (name, parent_id)
            q = select(Topic).where(Topic.owner_id == user.id, Topic.name == name)
            q = q.where(Topic.parent_id.is_(None) if parent_id is None else Topic.parent_id == parent_id)
            found = (await db.execute(q)).scalar_one_or_none()
            if found:
                return found.id
            t = Topic(name=name, parent_id=parent_id, owner_id=user.id)
            db.add(t)
            await db.flush()
            print(f"  + Thema: {name}" if parent_id is None else f"    + Unterthema: {name}")
            return t.id

        for row in paare:
            thema, unter = row["thema"], (row["unterthema"] or "").strip()
            if ("_root", thema) not in topic_id:
                topic_id[("_root", thema)] = await topic_for(thema)
            if unter:
                topic_id[(thema, unter)] = await topic_for(unter, topic_id[("_root", thema)])

        def tid(thema, unter):
            unter = (unter or "").strip()
            if unter and (thema, unter) in topic_id:
                return topic_id[(thema, unter)]
            return topic_id.get(("_root", thema))

        # ─── Klassen und Schueler ───
        klassen = cur.execute("SELECT DISTINCT name FROM klassen WHERE name != ''").fetchall()
        class_id: dict[str, int] = {}
        for row in klassen:
            name = row["name"]
            found = (await db.execute(
                select(SchoolClass).where(SchoolClass.owner_id == user.id, SchoolClass.name == name)
            )).scalar_one_or_none()
            if found:
                class_id[name] = found.id
                print(f"  = Klasse (vorhanden): {name}")
                continue
            sc = SchoolClass(name=name, owner_id=user.id)
            db.add(sc)
            await db.flush()
            class_id[name] = sc.id
            print(f"  + Klasse: {name}")

        student_id: dict[str, int] = {}   # alte _id -> neue id
        for kname, cid in class_id.items():
            rows = cur.execute("SELECT * FROM schueler WHERE klasse = ? ORDER BY name", (kname,)).fetchall()
            # card_id ist CardVote-Zubehoer, das die alte App nicht kannte:
            # fortlaufend vergeben, damit die Karten spaeter druckbar sind.
            naechste = 1
            vorhandene = (await db.execute(select(Student).where(Student.class_id == cid))).scalars().all()
            by_name = {s.name: s for s in vorhandene}
            if vorhandene:
                naechste = max(s.card_id for s in vorhandene) + 1
            for r in rows:
                if r["name"] in by_name:
                    student_id[r["_id"]] = by_name[r["name"]].id
                    continue
                st = Student(
                    card_id=naechste, name=r["name"], class_id=cid,
                    niveau=(r["niveau"] or ""), foerder=_json(r["foerder"], []) or None,
                    notizen=(r["notizen"] or ""),
                )
                db.add(st)
                await db.flush()
                student_id[r["_id"]] = st.id
                naechste += 1
                print(f"    + Schüler: {r['name']} (#{st.card_id}, {r['niveau'] or '—'})")

        # ─── Aufgaben ───
        ex_id: dict[str, int] = {}   # alte _id -> neue id
        neu = uebersprungen = 0
        for r in cur.execute("SELECT * FROM aufgaben").fetchall():
            t = tid(r["thema"], r["unterthema"])
            text = r["aufgabentext"] or ""
            found = (await db.execute(
                select(Exercise).where(
                    Exercise.owner_id == user.id, Exercise.topic_id == t, Exercise.aufgabentext == text,
                )
            )).scalar_one_or_none()
            if found:
                ex_id[r["_id"]] = found.id
                uebersprungen += 1
                continue
            ex = Exercise(
                owner_id=user.id, topic_id=t,
                kategorie=r["kategorie"] or "", aufgabentext=text, loesung=r["loesung"] or "",
                operator=r["operator"] or "", kompetenz=r["kompetenz"] or "", methode=r["methode"] or "",
                unteraufgaben=int(r["unteraufgaben"] or 1),
                quelle_typ=r["quelleTyp"] or "", quelle_detail=r["quelleDetail"] or "",
                lrs=str(r["lrs"]) in ("1", "True", "true"), lrs_text=r["lrsText"] or "",
                foerderschwerpunkte=_json(r["foerderschwerpunkte"], None) or None,
                latex=r["latex"] or "",
            )
            db.add(ex)
            await db.flush()
            ex_id[r["_id"]] = ex.id
            neu += 1
        print(f"\n  Aufgaben: {neu} neu, {uebersprungen} schon vorhanden")

        # ─── Lernpfade und ihre Lernleitern ───
        for r in cur.execute("SELECT * FROM lernpfade").fetchall():
            name = r["name"]
            found = (await db.execute(
                select(LearningPath).where(LearningPath.owner_id == user.id, LearningPath.name == name)
            )).scalar_one_or_none()
            if found:
                print(f"  = Lernpfad (vorhanden, übersprungen): {name}")
                continue
            path = LearningPath(name=name, owner_id=user.id)
            db.add(path)
            await db.flush()
            print(f"  + Lernpfad: {name}")

            for pos, ll in enumerate(_json(r["lernleitern"], [])):
                # Aufgaben je Schueler: alte IDs auf neue umschreiben. Was sich
                # nicht aufloesen laesst, faellt weg statt kaputt mitzuwandern.
                assignments = []
                for s in ll.get("schueler", []):
                    sid = student_id.get(s.get("_id"))
                    if not sid:
                        continue
                    ids = [ex_id[a] for a in s.get("aufgabenIds", []) if a in ex_id]
                    assignments.append({"student_id": sid, "exercise_ids": ids})
                db.add(LearningLadder(
                    path_id=path.id, position=pos,
                    class_id=class_id.get(ll.get("klasse")),
                    topic_id=tid(ll.get("thema"), ll.get("unterthema")),
                    notizen=ll.get("notizen", "") or "",
                    assignments=assignments or None,
                    config=ll.get("config") or None,
                ))
                print(f"    + Lernleiter: {ll.get('unterthema') or ll.get('thema')} "
                      f"({len(assignments)} Schüler)")

        # ─── Modul aktivieren, sonst sieht er seine Daten nicht ───
        aktiv = (await db.execute(select(UserModule).where(
            UserModule.user_id == user.id, UserModule.module_key == "lernpfad"
        ))).scalar_one_or_none()
        if not aktiv:
            db.add(UserModule(user_id=user.id, module_key="lernpfad"))
            print("\n  + Modul Lernpfad aktiviert")

        if dry_run:
            await db.rollback()
            print("\nTROCKENLAUF — nichts gespeichert. Ohne --dry-run wiederholen.")
        else:
            await db.commit()
            print("\nÜbernommen.")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--sqlite", required=True, help="Pfad zur alten lernleiter.db")
    ap.add_argument("--email", required=True, help="E-Mail des Nuvora-Kontos, dem die Daten gehören")
    ap.add_argument("--dry-run", action="store_true", help="nur zeigen, nichts schreiben")
    a = ap.parse_args()
    raise SystemExit(asyncio.run(migrate(a.sqlite, a.email, a.dry_run)))
