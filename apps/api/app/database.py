import os

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./cardvote.db")

engine = create_async_engine(DATABASE_URL)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_db():
    async with async_session() as session:
        yield session


# Die Installation laeuft auf Postgres (Server) oder SQLite (eingebaute App auf
# einem einzelnen Rechner). Die wenigen Stellen mit eigenem SQL gehen ueber diese
# beiden Helfer, damit sie nicht je Datenbank doppelt dastehen.
IST_SQLITE = DATABASE_URL.startswith("sqlite")


def sql_jetzt() -> str:
    return "datetime('now')" if IST_SQLITE else "now()"


def sql_vor(intervall: str) -> str:
    """\"vor 30 days\" als SQL-Ausdruck, z. B. sql_vor('30 days')."""
    return f"datetime('now', '-{intervall}')" if IST_SQLITE else f"now() - interval '{intervall}'"
