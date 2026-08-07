// Modul Zufallsschüler — zieht per Knopfdruck eine zufällige Person aus einer
// Klasse. Reiner Client: liest nur die Kern-Klassen, speichert nichts.
// "Ohne Wiederholung" merkt sich die schon Gezogenen, bis die Klasse durch ist.
import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { pageTitle, btnPrimary, btnSecondary, selectStyle, inputStyle, Toggle, pageApp} from "../components/Icons.jsx";
import KursKlasseSelect from "../components/KursKlasseSelect.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { useModules } from "../core/modules.js";
import { swr , lastClass, rememberClass } from "../core/cache.js";
import { useUrlClass } from "../core/klassenwahl.js";

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default function Zufall() {
  const { t } = useLanguage();
  const { modules } = useModules();
  // Anwesenheit lebt jetzt im Modul „Orga & Anwesenheit" — daher orga prüfen.
  const anwesenheitAktiv = modules.find((m) => m.key === "orga")?.active ?? false;
  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState(null);
  // Aus dem Kurs verlinkt (?class=&kurs=): dann diesen Inhalt zeigen.
  useUrlClass(setClassId);
  const [ohneWdh, setOhneWdh] = useState(true);
  const [skipAbs, setSkipAbs] = useState(true);    // Abwesende überspringen
  const [gewichtet, setGewichtet] = useState(false); // am seltensten dran bevorzugen
  const [gezogen, setGezogen] = useState([]); // IDs schon gezogener Schüler (diese Runde)
  const [counts, setCounts] = useState({});   // wie oft je Schüler gezogen (Klasse)
  const [lastDrawn, setLastDrawn] = useState({}); // student_id -> letztes Zieh-Datum (ISO), serverseitig
  const [lastId, setLastId] = useState(null);     // zuletzt gezogen (nicht zweimal am Stück)
  const [absent, setAbsent] = useState(new Set()); // heute abwesende IDs
  const [niveau, setNiveau] = useState(""); // "" = alle, "E" oder "G" (Kurs-Niveau)
  const [aktuell, setAktuell] = useState(null);
  const [rollt, setRollt] = useState(false);
  // Unterseite kommt aus der Navbar (?tab=gruppen), damit Ziehen und Gruppen
  // eigene Menuepunkte sind statt interner Reiter.
  const [params] = useSearchParams();
  const tab = params.get("tab") === "gruppen" ? "gruppen" : "ziehen";
  const [groupMode, setGroupMode] = useState("count"); // count = Anzahl Gruppen | size = SuS je Gruppe
  const [groupN, setGroupN] = useState(4);
  const [groups, setGroups] = useState([]);

  useEffect(() => {
    return swr("classes", "/api/classes", (d) => {
      const list = Array.isArray(d) ? d : [];
      setClasses(list);
      if (classId === null && list.length) { const w = lastClass(); setClassId(list.some((c) => c.id === w) ? w : list[0].id); }
    });
  }, []);

  useEffect(() => { if (classId) rememberClass(classId); }, [classId]);

  const cls = useMemo(() => classes.find((c) => c.id === classId), [classes, classId]);
  const students = cls?.students || [];

  // Heutige Abwesende laden (nur wenn Modul aktiv und Option an).
  useEffect(() => {
    if (!anwesenheitAktiv || !skipAbs || !classId) { setAbsent(new Set()); return; }
    fetch(`/api/anwesenheit/${classId}?date=${new Date(ymd(new Date()) + "T00:00:00").toISOString()}`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((d) => { const s = new Set(); Object.entries(d || {}).forEach(([sid, v]) => { if (v.status && v.status !== "da") s.add(Number(sid)); }); setAbsent(s); })
      .catch(() => {});
  }, [anwesenheitAktiv, skipAbs, classId]);

  // Klassenwechsel: Runde zurücksetzen und Zieh-Gedächtnis vom Server laden.
  useEffect(() => {
    setGezogen([]); setAktuell(null);
    if (!classId) { setCounts({}); setLastDrawn({}); setLastId(null); return; }
    fetch(`/api/zufall/${classId}`).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d) return;
      const c = {}, ld = {};
      Object.entries(d.history || {}).forEach(([sid, v]) => { c[sid] = v.count; ld[sid] = v.drawn_at; });
      setCounts(c); setLastDrawn(ld); setLastId(d.last_student_id ?? null);
    }).catch(() => {});
  }, [classId]);
  useEffect(() => { setGezogen([]); setAktuell(null); }, [ohneWdh, niveau]);

  // Optional nur E- oder G-Niveau ziehen (Kurs-Niveau am Schüler).
  const nivPool = niveau ? students.filter((s) => (s.niveau || "") === niveau) : students;
  const anwesend = nivPool.filter((s) => !absent.has(s.id));
  const basis = anwesend.length ? anwesend : nivPool; // alle abwesend -> nicht blockieren
  const pool = ohneWdh ? basis.filter((s) => !gezogen.includes(s.id)) : basis;

  // Tage seit letztem Ziehen (nie gezogen = groß, damit sofort bevorzugt).
  const tageSeit = (id) => {
    const iso = lastDrawn[id];
    if (!iso) return 3650;
    return Math.max(0, (Date.now() - new Date(iso).getTime()) / 86400000);
  };
  // Gewichtete Auswahl nach Zeit: wer lange nicht dran war, hat mehr Gewicht.
  const waehle = (list) => {
    if (!gewichtet) return list[Math.floor(Math.random() * list.length)];
    const w = list.map((s) => 1 + tageSeit(s.id)); // Tage + 1, damit heute Gezogene nicht 0
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < list.length; i++) { r -= w[i]; if (r <= 0) return list[i]; }
    return list[list.length - 1];
  };

  const ziehen = () => {
    if (!basis.length || rollt) return;
    const leer = ohneWdh && !pool.length;
    let kandidaten = leer ? basis : pool;
    if (leer) setGezogen([]);
    // Nicht zweimal am Stück dieselbe Person (außer es bliebe niemand übrig).
    if (lastId != null && kandidaten.length > 1) {
      const ohneLetzte = kandidaten.filter((s) => s.id !== lastId);
      if (ohneLetzte.length) kandidaten = ohneLetzte;
    }
    setRollt(true);
    let ticks = 0;
    const iv = setInterval(() => {
      setAktuell(basis[Math.floor(Math.random() * basis.length)]);
      if (++ticks >= 10) {
        clearInterval(iv);
        const pick = waehle(kandidaten);
        setAktuell(pick);
        if (ohneWdh) setGezogen((g) => [...g, pick.id]);
        setCounts((c) => ({ ...c, [pick.id]: (c[pick.id] || 0) + 1 }));
        setLastDrawn((ld) => ({ ...ld, [pick.id]: new Date().toISOString() }));
        setLastId(pick.id);
        setRollt(false);
        // Serverseitig merken (fair über Stunden/Tage hinweg).
        fetch(`/api/zufall/${classId}/draw`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ student_id: pick.id }) }).catch(() => {});
      }
    }, 55);
  };

  // Nur die aktuelle Runde („ohne Wiederholung") zurücksetzen — das Zieh-
  // Gedächtnis für die Fairness bleibt bewusst erhalten.
  const reset = () => { setGezogen([]); setAktuell(null); };

  // Zufallsgruppen: anwesende SuS mischen und gleichmäßig (Round-Robin) verteilen.
  const makeGroups = () => {
    const pool = [...(anwesend.length ? anwesend : students)];
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    if (!pool.length) { setGroups([]); return; }
    const k = groupMode === "count"
      ? Math.max(1, Math.min(Math.round(groupN) || 1, pool.length))
      : Math.max(1, Math.ceil(pool.length / Math.max(1, Math.round(groupN) || 1)));
    const gs = Array.from({ length: k }, () => []);
    pool.forEach((s, i) => gs[i % k].push(s));
    setGroups(gs);
  };

  return (
    <div style={{ ...pageApp }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <KursKlasseSelect value={classId} onChange={setClassId} />
        {tab === "ziehen" && (
          <select value={niveau} onChange={(e) => setNiveau(e.target.value)} title={t("zufall.niveauHint")} style={{ ...selectStyle, fontSize: 13, padding: "8px 26px 8px 10px" }}>
            <option value="">{t("zufall.niveauAll")}</option>
            <option value="G">{t("zufall.niveauG")}</option>
            <option value="E">{t("zufall.niveauE")}</option>
          </select>
        )}
        {tab === "ziehen" && <Toggle checked={ohneWdh} onChange={setOhneWdh} label={t("zufall.noRepeat")} />}
        {tab === "ziehen" && <Toggle checked={gewichtet} onChange={setGewichtet} label={t("zufall.weighted")} />}
        {anwesenheitAktiv && <Toggle checked={skipAbs} onChange={setSkipAbs} label={t("zufall.skipAbsent")} />}
      </div>

      {tab === "gruppen" && (
        students.length === 0 ? <p style={{ color: "var(--text3)", fontSize: 14 }}>{t("zufall.noStudents")}</p> : (
        <>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
            <select value={groupMode} onChange={(e) => setGroupMode(e.target.value)} style={{ ...selectStyle }}>
              <option value="count">{t("zufall.byCount")}</option>
              <option value="size">{t("zufall.bySize")}</option>
            </select>
            <input type="number" min="1" max="30" value={groupN} onChange={(e) => setGroupN(e.target.value)} style={{ ...inputStyle, width: 80, padding: "8px 10px" }} />
            <button onClick={makeGroups} style={btnPrimary}>{groups.length ? t("zufall.reroll") : t("zufall.makeGroups")}</button>
          </div>
          {groups.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
              {groups.map((g, i) => (
                <div key={i} style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--card)", padding: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--accent)", marginBottom: 8 }}>{t("zufall.group", { n: i + 1 })} <span style={{ color: "var(--text3)", fontWeight: 400 }}>· {g.length}</span></div>
                  {g.map((s) => <div key={s.id} style={{ fontSize: 14, padding: "3px 0" }}>{s.name}</div>)}
                </div>
              ))}
            </div>
          )}
        </>
        )
      )}

      {skipAbs && anwesenheitAktiv && absent.size > 0 && (
        <p style={{ fontSize: 12.5, color: "var(--text3)", marginTop: -8, marginBottom: 16 }}>{t("zufall.absentSkipped", { n: absent.size })}</p>
      )}

      {tab === "ziehen" && (students.length === 0 ? (
        <p style={{ color: "var(--text3)", fontSize: 14 }}>{t("zufall.noStudents")}</p>
      ) : (
        <>
          <div style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--card)", padding: "48px 24px", textAlign: "center", marginBottom: 18 }}>
            <div style={{ fontSize: aktuell ? 34 : 18, fontWeight: 800, color: aktuell ? "var(--text)" : "var(--text3)", opacity: rollt ? 0.6 : 1, transition: "opacity .1s", minHeight: 44 }}>
              {aktuell ? aktuell.name : t("zufall.hint")}
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={ziehen} disabled={rollt} style={{ ...btnPrimary, fontSize: 16, padding: "12px 26px", opacity: rollt ? 0.6 : 1 }}>{t("zufall.draw")}</button>
            {ohneWdh && (
              <span style={{ fontSize: 13, color: "var(--text3)" }}>
                {t("zufall.progress", { done: gezogen.length, total: basis.length })}
              </span>
            )}
            {ohneWdh && gezogen.length > 0 && (
              <button onClick={reset} style={{ ...btnSecondary, marginLeft: "auto" }}>{t("zufall.reset")}</button>
            )}
          </div>
        </>
      ))}
    </div>
  );
}
