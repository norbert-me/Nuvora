// Globale Suche („springe zu …") — ⌘K / Strg+K, Lupe in der Navigation,
// Suchfeld auf der Startseite.
//
// Warum: die Navigation zeigt immer nur den Bereich, in dem man gerade steht.
// Wer weiß, dass es die Ausleihe gibt, aber nicht, dass sie unter Orga sitzt,
// klickt sich durch 14 Module. Hier tippt man „ausleihe" und ist da.
//
// Gesucht wird in drei Töpfen: Seiten und Reiter (core/ziele.js), die eigenen
// Klassen/Kurse und die Themen. Klassen und Themen werden erst beim Öffnen
// geholt — die Suche kostet nichts, solange sie zu ist.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { COLORS as C, CONTROL_R, Icon, ICONS, inputStyle, menuRow, modalOverlay, modalPanel, sectionLabel, SHADOW } from "./Icons.jsx";
import { ZIELE, passt, rang } from "../core/ziele.js";
import { useAktiv } from "../core/modules.js";
import { useLanguage } from "../i18n/index.jsx";
import { hol } from "../core/melden.js";

const MAX = 8;   // je Gruppe — mehr liest niemand, und die Liste soll nicht scrollen

export default function Suche({ offen, onClose }) {
  const { t } = useLanguage();
  const aktiv = useAktiv();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [wahl, setWahl] = useState(0);
  const [daten, setDaten] = useState({ klassen: [], kurse: [], themen: [] });
  const feld = useRef(null);

  useEffect(() => {
    if (!offen) return;
    setQ(""); setWahl(0);
    setTimeout(() => feld.current?.focus(), 30);
    let ab = false;
    Promise.all([hol("/api/classes"), hol("/api/kurse"), hol("/api/topics")]).then(([k, ku, th]) => {
      if (!ab) setDaten({ klassen: k || [], kurse: ku || [], themen: th || [] });
    });
    return () => { ab = true; };
  }, [offen]);

  // Seiten: nur, was diese Lehrkraft auch hat (Regel 3).
  const treffer = useMemo(() => {
    const begriff = q.trim();
    const seiten = ZIELE
      .filter((z) => !z.modul || aktiv(z.modul))
      .map((z) => ({ ...z, titel: t(z.key) }))
      .filter((z) => !begriff || passt([z.titel, ...(z.worte || []), z.pfad].join(" "), begriff))
      .sort((a, b) => rang(a.titel, begriff) - rang(b.titel, begriff))
      .slice(0, begriff ? MAX : MAX);

    const wenn = (liste, bau) => (!begriff ? [] : liste.filter((x) => passt(x.name || "", begriff)).slice(0, MAX).map(bau));
    const klassen = wenn(daten.klassen, (k) => ({ titel: k.name, pfad: `/classes?open=${k.id}`, art: "klasse" }));
    const kurse = wenn(daten.kurse, (k) => ({ titel: k.name, pfad: "/kurse", art: "kurs" }));
    // Themen fuehren in die Themenansicht: dort steht alles zum Thema quer
    // ueber die aktiven Module — genau das sucht man.
    const themen = wenn(daten.themen, (th) => ({ titel: th.name, pfad: `/thema/${th.id}`, art: "thema" }));
    return [
      { gruppe: t("suche.pages"), eintraege: seiten.map((s) => ({ titel: s.titel, pfad: s.pfad, art: "seite" })) },
      { gruppe: t("suche.classes"), eintraege: [...klassen, ...kurse] },
      { gruppe: t("nav.topics"), eintraege: themen },
    ].filter((g) => g.eintraege.length);
  }, [q, daten, aktiv, t]);

  const flach = useMemo(() => treffer.flatMap((g) => g.eintraege), [treffer]);
  useEffect(() => { setWahl(0); }, [q]);

  if (!offen) return null;

  const springe = (ziel) => { onClose(); navigate(ziel.pfad); };
  const taste = (e) => {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setWahl((i) => Math.min(i + 1, flach.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setWahl((i) => Math.max(i - 1, 0)); }
    if (e.key === "Enter" && flach[wahl]) { e.preventDefault(); springe(flach[wahl]); }
  };

  const symbol = { seite: ICONS.open, klasse: ICONS.users, kurs: ICONS.users, thema: ICONS.tag };
  let lauf = -1;

  return (
    <div onClick={onClose} role="presentation"
      style={{ ...modalOverlay, alignItems: "flex-start", padding: "12vh 16px 16px", zIndex: 4100 }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t("suche.title")}
        style={{ ...modalPanel, maxWidth: 560, padding: 0, maxHeight: "none", overflow: "hidden", boxShadow: SHADOW.ueber }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px", borderBottom: "1px solid var(--border)" }}>
          <Icon d={ICONS.search} size={16} color="var(--text3)" />
          {/* data-suche: der Browser-Test darf nicht am uebersetzten
              Platzhalter haengen — mit englischer Oberflaeche fand er das Feld
              nicht und klickte danach gegen den schon offenen Dialog. */}
          <input ref={feld} data-suche="feld" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={taste}
            placeholder={t("suche.placeholder")} aria-label={t("suche.title")}
            style={{ ...inputStyle, flex: 1, border: "none", background: "none", fontSize: 16, padding: 4 }} />
          <kbd style={{ fontSize: 11, color: "var(--text3)", border: "1px solid var(--border2)", borderRadius: CONTROL_R, padding: "2px 6px" }}>esc</kbd>
        </div>

        <div style={{ maxHeight: "52vh", overflowY: "auto", padding: 4 }}>
          {flach.length === 0 && (
            <div style={{ padding: 16, fontSize: 13, color: "var(--text3)" }}>{t("suche.nothing")}</div>
          )}
          {treffer.map((g) => (
            <div key={g.gruppe}>
              <div style={{ ...sectionLabel, padding: "8px 10px 4px" }}>{g.gruppe}</div>
              {g.eintraege.map((e) => {
                lauf += 1;
                const i = lauf;
                return (
                  <button key={`${e.art}-${e.pfad}`} onClick={() => springe(e)} onMouseEnter={() => setWahl(i)}
                    style={{ ...menuRow, background: i === wahl ? "var(--bg2)" : "none" }}>
                    <Icon d={symbol[e.art]} size={15} color={i === wahl ? C.info : "var(--text3)"} />
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.titel}</span>
                    <span style={{ fontSize: 12, color: "var(--text3)" }}>{e.pfad.split("?")[0]}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 12, padding: "8px 12px", borderTop: "1px solid var(--border)", fontSize: 12, color: "var(--text3)" }}>
          <span>↑↓ {t("suche.hintMove")}</span>
          <span>↵ {t("suche.hintOpen")}</span>
        </div>
      </div>
    </div>
  );
}
