const express = require('express');
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

let db = null;
// Im Docker zeigt DB_PATH in ein gemountetes Verzeichnis (/app/data/...).
// Niemals eine einzelne Datei mounten: existiert sie auf dem Host nicht,
// legt Docker sie als Verzeichnis an und readFileSync wirft EISDIR.
const dbPath = process.env.DB_PATH || './lernleiter.db';

const SESSION_COOKIE = 'll_session';
const SESSION_DAYS = 30;

app.use(express.json({ limit: '50mb' }));

// ─── Statische Dateien (öffentlich, damit die Login-Seite lädt) ───
// WICHTIG: sensible Dateien nie ausliefern. Vor dem letzten Fix wurde
// express.static VOR der Auth eingehängt - dadurch war u.a. die komplette
// lernleiter.db ohne Login abrufbar. Dieser Guard blockt DB/Config/Quellcode.
app.use((req, res, next) => {
  const p = req.path.toLowerCase();
  // Verzeichnisse mit Slash-Grenze prüfen, sonst würde z.B. "/daten" auch
  // "/datenschutz.html" blocken.
  const inDir = d => p === d || p.startsWith(d + '/');
  if (p.endsWith('.db') || inDir('/backups') || inDir('/config') ||
      inDir('/daten') || inDir('/node_modules') ||
      p === '/server.js' || p.endsWith('.htpasswd') ||
      p === '/package.json' || p === '/package-lock.json') {
    return res.status(404).end();
  }
  next();
});
app.use(express.static(path.join(__dirname, '.'), { index: 'index.html', extensions: [] }));

// ─── Passwort-Hashing (scrypt, kein externes Paket nötig) ───
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return salt + ':' + hash;
}
function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const h = crypto.scryptSync(pw, salt, 64);
  const b = Buffer.from(hash, 'hex');
  return h.length === b.length && crypto.timingSafeEqual(h, b);
}

// ─── Cookies / Sessions ───
function parseCookies(req) {
  const out = {};
  const h = req.headers.cookie;
  if (h) h.split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function setSessionCookie(req, res, token) {
  const secure = req.headers['x-forwarded-proto'] === 'https';
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  res.setHeader('Set-Cookie',
    `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}` +
    (secure ? '; Secure' : ''));
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}
function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  db.run('INSERT INTO sessions (token, user_id, expires) VALUES (?, ?, ?)', [token, userId, expires]);
  saveDB();
  return token;
}
function getSession(token) {
  if (!token) return null;
  const row = queryOne('SELECT user_id, expires FROM sessions WHERE token = ?', [token]);
  if (!row) return null;
  if (Number(row.expires) < Date.now()) {
    db.run('DELETE FROM sessions WHERE token = ?', [token]);
    return null;
  }
  return { userId: row.user_id };
}

// ─── Prepared-Statement-Helfer (parametrisiert = kein SQL-Injection) ───
function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const out = [];
  while (stmt.step()) out.push(stmt.getAsObject());
  stmt.free();
  return out;
}
function queryOne(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows[0] || null;
}
// sql.js kann undefined nicht binden - fehlende Felder zu null machen.
function nn(arr) { return arr.map(v => v === undefined ? null : v); }

// ─── Auth-Middleware: schützt alle /api-Routen außer den öffentlichen ───
function requireAuth(req, res, next) {
  const sess = getSession(parseCookies(req)[SESSION_COOKIE]);
  if (!sess) return res.status(401).json({ error: 'Nicht angemeldet' });
  req.userId = sess.userId;
  next();
}

async function initDB() {
  const SQL = await initSqlJs();

  let filebuffer = null;
  if (fs.existsSync(dbPath)) {
    if (fs.statSync(dbPath).isDirectory()) {
      throw new Error(
        `DB-Pfad "${dbPath}" ist ein Verzeichnis, keine Datei. Das passiert, wenn ` +
        `docker-compose eine noch nicht existierende Datei als Volume mountet. ` +
        `Verzeichnis mounten (./data:/app/data) und DB_PATH auf eine Datei darin setzen.`
      );
    }
    filebuffer = fs.readFileSync(dbPath);
  }

  // Zielverzeichnis anlegen, damit der erste Start in einem leeren Volume klappt
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

  db = openOrRestore(SQL, filebuffer);

  // Schema mit Mandantentrennung: jede Datenzeile gehört einem user_id.
  // Eindeutigkeiten (aufgaben.id, klassen.name, lernpfade.name) gelten PRO
  // Nutzer, nicht global - sonst könnten zwei Lehrkräfte nicht dieselbe
  // Klasse "5a" oder Aufgaben-ID "#000001" haben.
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      pass_hash TEXT,
      erstellt TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT,
      expires INTEGER
    );
    CREATE TABLE IF NOT EXISTS aufgaben (
      _id TEXT PRIMARY KEY,
      user_id TEXT,
      id TEXT,
      thema TEXT,
      unterthema TEXT,
      kategorie TEXT,
      quelleTyp TEXT,
      quelleDetail TEXT,
      quelle TEXT,
      operator TEXT,
      unteraufgaben INTEGER DEFAULT 1,
      kompetenz TEXT,
      methode TEXT,
      lrs INTEGER DEFAULT 0,
      lrsText TEXT,
      loesung TEXT,
      aufgabentext TEXT,
      bild LONGTEXT,
      loesungBild LONGTEXT,
      foerderschwerpunkte TEXT,
      latex TEXT,
      UNIQUE(user_id, id)
    );
    CREATE TABLE IF NOT EXISTS schueler (
      _id TEXT PRIMARY KEY,
      user_id TEXT,
      name TEXT,
      klasse TEXT,
      niveau TEXT,
      foerder TEXT,
      notizen TEXT
    );
    CREATE TABLE IF NOT EXISTS klassen (
      user_id TEXT,
      name TEXT,
      PRIMARY KEY (user_id, name)
    );
    CREATE TABLE IF NOT EXISTS lernpfade (
      _id TEXT PRIMARY KEY,
      user_id TEXT,
      name TEXT,
      aufgaben_order TEXT,
      lernleitern TEXT,
      UNIQUE(user_id, name)
    );
    CREATE TABLE IF NOT EXISTS kontakt (
      _id TEXT PRIMARY KEY,
      erstellt TEXT,
      name TEXT,
      email TEXT,
      nachricht TEXT,
      gelesen INTEGER DEFAULT 0
    );
  `);

  migrateMultiUser();
  migrateLernpfade();
  // Spalte latex nachrüsten (neue Quellenart LaTeX)
  if (!hasCol('aufgaben', 'latex')) {
    db.run('ALTER TABLE aufgaben ADD COLUMN latex TEXT');
    console.log('Migration: aufgaben.latex hinzugefügt');
  }
  // Seed-Daten aus daten/ NUR wenn ausdrücklich verlangt (LERNLEITER_SEED=1).
  // Im Deploy ist die Variable nicht gesetzt: leere DB bleibt leer, es werden
  // keine Dummy-Aufgaben angelegt.
  if (process.env.LERNLEITER_SEED === '1') {
    loadInitialData();
  }
  saveDB();
}

function hasCol(table, col) {
  const r = db.exec(`PRAGMA table_info(${table})`);
  const names = r[0]?.values.map(v => v[1]) || [];
  return names.includes(col);
}

// DBs aus der Zeit vor der Mandantentrennung haben Tabellen ohne user_id und
// mit globalen UNIQUE-Constraints. Diese lassen sich in SQLite nicht per ALTER
// umbauen, darum werden die betroffenen Tabellen neu angelegt. Betrifft nur
// alte Entwicklungs-/Dummy-Datenbanken; die Produktions-DB startet bereits im
// neuen Schema.
function migrateMultiUser() {
  const dataTables = ['aufgaben', 'schueler', 'lernpfade', 'klassen'];
  const old = dataTables.filter(t => !hasCol(t, 'user_id'));
  if (!old.length) return;
  console.warn('Migration Mehrmandanten: alte Tabellen werden neu aufgebaut:', old.join(', '));
  old.forEach(t => db.run('DROP TABLE IF EXISTS ' + t));
  db.run(`
    CREATE TABLE IF NOT EXISTS aufgaben (
      _id TEXT PRIMARY KEY, user_id TEXT, id TEXT, thema TEXT, unterthema TEXT,
      kategorie TEXT, quelleTyp TEXT, quelleDetail TEXT, quelle TEXT, operator TEXT,
      unteraufgaben INTEGER DEFAULT 1, kompetenz TEXT, methode TEXT, lrs INTEGER DEFAULT 0,
      lrsText TEXT, loesung TEXT, aufgabentext TEXT, bild LONGTEXT, loesungBild LONGTEXT,
      foerderschwerpunkte TEXT, latex TEXT, UNIQUE(user_id, id)
    );
    CREATE TABLE IF NOT EXISTS schueler (
      _id TEXT PRIMARY KEY, user_id TEXT, name TEXT, klasse TEXT, niveau TEXT,
      foerder TEXT, notizen TEXT
    );
    CREATE TABLE IF NOT EXISTS klassen (
      user_id TEXT, name TEXT, PRIMARY KEY (user_id, name)
    );
    CREATE TABLE IF NOT EXISTS lernpfade (
      _id TEXT PRIMARY KEY, user_id TEXT, name TEXT, aufgaben_order TEXT,
      lernleitern TEXT, UNIQUE(user_id, name)
    );
  `);
}

// Ältere DBs haben lernpfade ohne lernleitern-Spalte
function migrateLernpfade() {
  const cols = db.exec('PRAGMA table_info(lernpfade)')[0]?.values.map(r => r[1]) || [];
  if (!cols.includes('lernleitern')) {
    db.run('ALTER TABLE lernpfade ADD COLUMN lernleitern TEXT');
    console.log('Migration: lernpfade.lernleitern hinzugefügt');
  }
}

function loadInitialData() {
  const aufgabenCount = db.exec('SELECT COUNT(*) as cnt FROM aufgaben')[0]?.values[0]?.[0] || 0;
  if (aufgabenCount > 0) return;

  const datenDir = path.join(__dirname, 'daten');
  if (!fs.existsSync(datenDir)) return;

  let importCounter = 0;

  fs.readdirSync(datenDir).forEach(file => {
    if (!file.endsWith('.json')) return;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(datenDir, file), 'utf8'));
      if (!Array.isArray(data)) return;

      data.forEach(a => {
        const _id = a._id || `id_${Date.now()}_${Math.random()}`;
        // JSON-Dateien haben oft keine id - sql.js kann undefined nicht binden,
        // darum hier eine laufende Nummer im Format der App vergeben.
        const id = a.id || '#' + String(++importCounter).padStart(6, '0');
        db.run(
          `INSERT OR IGNORE INTO aufgaben
           (_id, id, thema, unterthema, kategorie, quelleTyp, quelleDetail, quelle, operator, unteraufgaben, kompetenz, methode, lrs, lrsText, loesung, aufgabentext, bild, loesungBild, foerderschwerpunkte)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            _id,
            id,
            a.thema || '',
            a.unterthema || '',
            a.kategorie || a.kategorien?.[0] || '',
            a.quelleTyp || 'schulbuch',
            a.quelleDetail || '',
            a.quelle || '',
            a.operator || '',
            a.unteraufgaben || 1,
            a.kompetenz || '',
            a.methode || '',
            a.lrs ? 1 : 0,
            a.lrsText || '',
            a.loesung || '',
            a.aufgabentext || '',
            a.bild || null,
            a.loesungBild || null,
            JSON.stringify(a.foerderschwerpunkte || [])
          ]
        );
      });
    } catch(e) {
      // sql.js wirft Strings statt Error-Objekten - e.message waere undefined
      console.error('Error loading', file, e && e.message ? e.message : e);
    }
  });
}

// DB laden; ist die Datei korrupt, automatisch neuestes Backup einspielen
// statt mit leerer DB zu starten (sonst wäre alles weg).
function openOrRestore(SQL, filebuffer) {
  // sql.js wirft bei korrupter Datei nicht im Konstruktor, sondern erst bei
  // der ersten Query ("file is not a database"). Darum mit Probe validieren.
  const tryOpen = buf => {
    const d = new SQL.Database(buf);
    d.exec('SELECT count(*) FROM sqlite_master');
    return d;
  };
  try {
    return tryOpen(filebuffer);
  } catch (e) {
    console.error('DB korrupt:', e && e.message ? e.message : e);
    const dir = path.join(path.dirname(dbPath), 'backups');
    if (fs.existsSync(dir)) {
      const backups = fs.readdirSync(dir).filter(f => f.endsWith('.db')).sort().reverse();
      for (const b of backups) {
        try {
          const d = tryOpen(fs.readFileSync(path.join(dir, b)));
          console.warn('Backup wiederhergestellt:', b);
          return d;
        } catch (_) { /* nächstes Backup probieren */ }
      }
    }
    console.error('Kein brauchbares Backup gefunden - starte mit leerer DB.');
    return new SQL.Database();
  }
}

let lastBackup = 0;
const BACKUP_DIR = path.join(path.dirname(dbPath), 'backups');
const BACKUP_INTERVAL_MS = 60 * 1000; // höchstens 1 Backup/Minute (Massen-Import bündelt)
const BACKUP_KEEP = 60;               // letzte 60 Stände behalten

function saveDB() {
  const buffer = Buffer.from(db.export());

  // Atomar schreiben: erst temp, dann rename. Ein Crash mitten im Write
  // kann so die echte DB nie halb-beschrieben/korrupt hinterlassen.
  const tmp = dbPath + '.tmp';
  fs.writeFileSync(tmp, buffer);
  fs.renameSync(tmp, dbPath);

  rotateBackup(buffer);
}

// Zeitgestempelte Sicherungen, damit auch ein Logikfehler (versehentliches
// Leeren) rückgängig gemacht werden kann - nicht nur Crash-Schutz.
function rotateBackup(buffer) {
  const now = Date.now();
  if (now - lastBackup < BACKUP_INTERVAL_MS) return;
  lastBackup = now;
  try {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(BACKUP_DIR, `lernleiter-${stamp}.db`), buffer);

    const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.db')).sort();
    while (files.length > BACKUP_KEEP) {
      fs.unlinkSync(path.join(BACKUP_DIR, files.shift()));
    }
  } catch (e) {
    console.error('Backup fehlgeschlagen:', e && e.message ? e.message : e);
  }
}

// ─────────────── Öffentliche Auth-Routen ───────────────

// Einfaches In-Memory-Ratelimit gegen Passwort-Raten (pro IP).
const loginAttempts = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const e = loginAttempts.get(ip) || { count: 0, first: now };
  if (now - e.first > 15 * 60 * 1000) { e.count = 0; e.first = now; }
  e.count++;
  loginAttempts.set(ip, e);
  return e.count > 20; // >20 Versuche / 15 Min
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

app.post('/api/register', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const pw = String(req.body?.password || '');
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Ungültige E-Mail' });
  if (pw.length < 8) return res.status(400).json({ error: 'Passwort mind. 8 Zeichen' });
  if (queryOne('SELECT id FROM users WHERE email = ?', [email])) {
    return res.status(409).json({ error: 'E-Mail bereits registriert' });
  }
  const id = 'u_' + crypto.randomBytes(9).toString('hex');
  db.run('INSERT INTO users (id, email, pass_hash, erstellt) VALUES (?, ?, ?, ?)',
    [id, email, hashPassword(pw), new Date().toISOString()]);
  saveDB();
  const token = createSession(id);
  setSessionCookie(req, res, token);
  res.json({ email });
});

app.post('/api/login', (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?';
  if (rateLimited(ip)) return res.status(429).json({ error: 'Zu viele Versuche, später erneut' });
  const email = String(req.body?.email || '').trim().toLowerCase();
  const pw = String(req.body?.password || '');
  const user = queryOne('SELECT id, pass_hash FROM users WHERE email = ?', [email]);
  // Immer gleiche Fehlermeldung: verrät nicht, ob die E-Mail existiert.
  if (!user || !verifyPassword(pw, user.pass_hash)) {
    return res.status(401).json({ error: 'E-Mail oder Passwort falsch' });
  }
  const token = createSession(user.id);
  setSessionCookie(req, res, token);
  res.json({ email });
});

app.post('/api/logout', (req, res) => {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) { db.run('DELETE FROM sessions WHERE token = ?', [token]); saveDB(); }
  clearSessionCookie(res);
  res.json({ ok: 1 });
});

app.get('/api/me', (req, res) => {
  const sess = getSession(parseCookies(req)[SESSION_COOKIE]);
  if (!sess) return res.json({ user: null });
  const u = queryOne('SELECT email FROM users WHERE id = ?', [sess.userId]);
  res.json({ user: u ? { email: u.email } : null });
});

app.get('/api/site', (req, res) => {
  res.json(loadSiteInfo());
});

// Kontaktformular ist öffentlich (Besucher der Startseite).
app.post('/api/kontakt', (req, res) => {
  const { name, email, nachricht } = req.body || {};
  if (!nachricht || !nachricht.trim()) return res.status(400).json({ error: 'Nachricht fehlt' });
  if (nachricht.length > 5000) return res.status(400).json({ error: 'Nachricht zu lang' });
  const _id = `k_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  db.run(
    'INSERT INTO kontakt (_id, erstellt, name, email, nachricht, gelesen) VALUES (?, ?, ?, ?, ?, 0)',
    [_id, new Date().toISOString(), (name || '').slice(0, 200), (email || '').slice(0, 200), nachricht.trim()]
  );
  saveDB();
  res.json({ ok: 1 });
});

// ─────────────── Ab hier: alles nur mit gültiger Session ───────────────
app.use('/api', requireAuth);

app.get('/api/aufgaben', (req, res) => {
  const rows = queryAll('SELECT * FROM aufgaben WHERE user_id = ? ORDER BY id', [req.userId]);
  rows.forEach(r => {
    r.foerderschwerpunkte = r.foerderschwerpunkte ? JSON.parse(r.foerderschwerpunkte) : [];
    delete r.user_id;
  });
  res.json(rows);
});

app.post('/api/aufgaben', (req, res) => {
  const a = req.body;
  const _id = a._id || `id_${Date.now()}_${Math.random()}`;
  const owner = queryOne('SELECT user_id FROM aufgaben WHERE _id = ?', [_id]);
  if (owner && owner.user_id !== req.userId) return res.status(403).json({ error: 'Kein Zugriff' });
  db.run(
    `INSERT OR REPLACE INTO aufgaben
     (_id, user_id, id, thema, unterthema, kategorie, quelleTyp, quelleDetail, quelle, operator, unteraufgaben, kompetenz, methode, lrs, lrsText, loesung, aufgabentext, bild, loesungBild, foerderschwerpunkte, latex)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    nn([
      _id, req.userId, a.id, a.thema, a.unterthema, a.kategorie, a.quelleTyp, a.quelleDetail, a.quelle,
      a.operator, a.unteraufgaben, a.kompetenz, a.methode, a.lrs ? 1 : 0, a.lrsText, a.loesung,
      a.aufgabentext, a.bild, a.loesungBild, JSON.stringify(a.foerderschwerpunkte || []), a.latex
    ])
  );
  saveDB();
  res.json({ _id });
});

app.get('/api/schueler', (req, res) => {
  const rows = queryAll('SELECT * FROM schueler WHERE user_id = ? ORDER BY klasse, name', [req.userId]);
  rows.forEach(r => {
    r.foerder = r.foerder ? JSON.parse(r.foerder) : [];
    delete r.user_id;
  });
  res.json(rows);
});

app.post('/api/schueler', (req, res) => {
  const s = req.body;
  const _id = s._id || `id_${Date.now()}_${Math.random()}`;
  const owner = queryOne('SELECT user_id FROM schueler WHERE _id = ?', [_id]);
  if (owner && owner.user_id !== req.userId) return res.status(403).json({ error: 'Kein Zugriff' });
  db.run(
    `INSERT OR REPLACE INTO schueler (_id, user_id, name, klasse, niveau, foerder, notizen)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    nn([_id, req.userId, s.name, s.klasse, s.niveau, JSON.stringify(s.foerder || []), s.notizen || ''])
  );
  saveDB();
  res.json({ _id });
});

app.get('/api/klassen', (req, res) => {
  const rows = queryAll('SELECT name FROM klassen WHERE user_id = ? ORDER BY name', [req.userId]);
  res.json(rows.map(r => r.name));
});

app.post('/api/klassen', (req, res) => {
  db.run('INSERT OR IGNORE INTO klassen (user_id, name) VALUES (?, ?)', [req.userId, req.body.name]);
  saveDB();
  res.json({ ok: 1 });
});

app.delete('/api/aufgaben/:id', (req, res) => {
  db.run('DELETE FROM aufgaben WHERE _id = ? AND user_id = ?', [req.params.id, req.userId]);
  saveDB();
  res.json({ ok: 1 });
});

app.delete('/api/schueler/:id', (req, res) => {
  db.run('DELETE FROM schueler WHERE _id = ? AND user_id = ?', [req.params.id, req.userId]);
  saveDB();
  res.json({ ok: 1 });
});

app.delete('/api/klassen/:name', (req, res) => {
  db.run('DELETE FROM klassen WHERE name = ? AND user_id = ?', [req.params.name, req.userId]);
  saveDB();
  res.json({ ok: 1 });
});

app.get('/api/lernpfade', (req, res) => {
  const rows = queryAll('SELECT * FROM lernpfade WHERE user_id = ? ORDER BY name', [req.userId]);
  rows.forEach(r => {
    r.aufgaben_order = r.aufgaben_order ? JSON.parse(r.aufgaben_order) : [];
    r.lernleitern = r.lernleitern ? JSON.parse(r.lernleitern) : [];
    delete r.user_id;
  });
  res.json(rows);
});

app.post('/api/lernpfade', (req, res) => {
  const p = req.body;
  const _id = p._id || `pfad_${Date.now()}`;
  const owner = queryOne('SELECT user_id FROM lernpfade WHERE _id = ?', [_id]);
  if (owner && owner.user_id !== req.userId) return res.status(403).json({ error: 'Kein Zugriff' });
  db.run(
    'INSERT OR REPLACE INTO lernpfade (_id, user_id, name, aufgaben_order, lernleitern) VALUES (?, ?, ?, ?, ?)',
    nn([_id, req.userId, p.name, JSON.stringify(p.aufgaben_order || []), JSON.stringify(p.lernleitern || [])])
  );
  saveDB();
  res.json({ _id });
});

app.delete('/api/lernpfade/:id', (req, res) => {
  db.run('DELETE FROM lernpfade WHERE _id = ? AND user_id = ?', [req.params.id, req.userId]);
  saveDB();
  res.json({ ok: 1 });
});

// Betreiber-/Impressumsdaten aus gitignored config/site.json laden.
// Fällt auf die Vorlage zurück, wenn keine echte Datei vorhanden ist.
function loadSiteInfo() {
  const real = path.join(__dirname, 'config', 'site.json');
  const example = path.join(__dirname, 'config', 'site.example.json');
  const file = fs.existsSync(real) ? real : example;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error('site.json konnte nicht gelesen werden:', e && e.message ? e.message : e);
    return {};
  }
}

// Eingegangene Kontaktnachrichten lesen - nur für den Betreiber (ADMIN_EMAIL),
// sonst könnte jede registrierte Lehrkraft alle Nachrichten lesen.
app.get('/api/kontakt', (req, res) => {
  const me = queryOne('SELECT email FROM users WHERE id = ?', [req.userId]);
  const admin = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  if (!admin || !me || me.email !== admin) return res.status(403).json({ error: 'Kein Zugriff' });
  const rows = queryAll('SELECT * FROM kontakt ORDER BY erstellt DESC');
  res.json(rows);
});

initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Lernleiter Backend läuft auf Port ${PORT} (DB: ${dbPath})`);
  });
}).catch(err => {
  // Ohne dieses catch stirbt der Prozess wortlos und nginx liefert nur 502
  console.error('Backend konnte nicht starten:', err && err.message ? err.message : err);
  process.exit(1);
});
