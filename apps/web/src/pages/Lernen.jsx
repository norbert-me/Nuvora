// Kartenlernen für Schüler — KEIN Login, Zugriff über den Token in der URL.
// Öffentliche Route: läuft ohne Nuvora-Konto. Der Token ist die Identität.
//
// Übersetzt wie jede andere Seite: der LanguageProvider liegt in main.jsx um
// ALLE Routen, also auch um die öffentlichen. Harte deutsche Zeichenketten
// standen hier nur, weil die Seite kein Konto braucht — die lernende Person
// liest sie trotzdem.
import { useState, useEffect, useCallback } from "react";
import CardFace from "../components/CardFace.jsx";
import { COLORS as C, REIFE_COLORS, Icon, ICONS, Tabs, btnPrimary, btnSecondary, cardStyle } from "../components/Icons.jsx";
import { useParams } from "react-router-dom";
import RechtsFuss from "../components/RechtsFuss.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { alsJson } from "../core/melden.js";

const API = "/api/karten";

export default function Lernen() {
  const { t } = useLanguage();
  const { token } = useParams();
  const [data, setData] = useState(null);   // { name, cards, total }
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [results, setResults] = useState(null); // CardVote-Ergebnisse (Token-öffentlich)
  const [tab, setTab] = useState(null);         // "karten" | "ergebnisse"

  useEffect(() => {
    fetch(`${API}/lernen/${token}/results`).then((r) => (r.ok ? r.json() : [])).then((d) => setResults(Array.isArray(d) ? d : [])).catch(() => setResults([]));
  }, [token]);

  // all=true: freiwilliges Weiteruben — alle Karten, auch nicht faellige.
  const load = useCallback((all = false) => {
    fetch(`${API}/lernen/${token}${all ? "?all=1" : ""}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => { setData(d); setI(0); setFlipped(false); setDone((d.cards || []).length === 0); })
      .catch(() => setError(t("lernen.invalid")));
  }, [token, t]);
  useEffect(() => { load(); }, [load]);

  const bewerten = async (grade) => {
    const card = data.cards[i];
    // Bewertung MUSS ankommen, sonst geht Fortschritt verloren und die Sitzung
    // beginnt spaeter von vorn. Schlaegt der Aufruf fehl, hier stoppen und
    // melden statt still weiterzublaettern.
    try {
      const r = await fetch(`${API}/lernen/${token}/review`, alsJson("POST", { card_id: card.card_id, grade }));
      console.debug("[Karten] Review", card.card_id, "grade", grade, "→", r.status, r.ok);
      if (!r.ok) { setError(t("lernen.saveFailed", { status: r.status })); return; }
    } catch (e) {
      console.error("[Karten] Review-Aufruf fehlgeschlagen:", e);
      setError(t("lernen.offline"));
      return;
    }
    setFlipped(false);
    // "Nochmal" (grade 0): Karte kommt in dieser Sitzung erneut dran — ans Ende
    // der Warteschlange. Sonst ist sie fuer heute erledigt und faellt raus.
    const rest = data.cards.filter((_, idx) => idx !== i);
    const queue = grade === 0 ? [...rest, card] : rest;
    // Fertig: frisch vom Server laden, damit "gelernt" und Reifegrad die eben
    // gesendeten Bewertungen zeigen und nicht den Stand vom Seitenaufruf.
    if (queue.length === 0) { load(); return; }
    setData({ ...data, cards: queue });
    // Nicht dieselbe Karte direkt noch einmal: war sie die letzte, vorne weiter.
    setI(i >= queue.length || (grade === 0 && i >= queue.length - 1) ? 0 : i);
  };

  if (error) return <Center hinweis={t("lernen.footerHint")}><p style={{ color: C.danger }}>{error}</p></Center>;
  if (!data) return <Center hinweis={t("lernen.footerHint")}><p style={{ color: "var(--text3)" }}>{t("common.loading")}</p></Center>;

  // Hat der Schüler überhaupt Karten? Ohne Karten-Modul/Stapel gibt es keine —
  // dann zeigt die Seite nur die Testergebnisse.
  const hatKarten = (data.total || 0) > 0 || (data.cards || []).length > 0 || (data.learned || 0) > 0;
  const aktiverTab = tab || (hatKarten ? "karten" : "ergebnisse");
  const tabBar = hatKarten ? (
    <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
      <Tabs value={aktiverTab} onChange={setTab}
        options={[["karten", t("karten.tabCards")], ["ergebnisse", t("lernen.tabResults")]]} />
    </div>
  ) : null;

  if (aktiverTab === "ergebnisse") {
    return <Center hinweis={t("lernen.footerHint")}><div style={{ width: "100%", maxWidth: 460 }}>{tabBar}<Ergebnisse t={t} results={results} /></div></Center>;
  }

  if (done) {
    return (
      <Center hinweis={t("lernen.footerHint")}>
        <div style={{ textAlign: "center", width: "100%", maxWidth: 460 }}>
          {tabBar}
          <div style={{ marginBottom: 8 }}><Icon d={ICONS.check} size={48} color={C.success} /></div>
          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>{t("lernen.doneTitle")}</h2>
          <p style={{ color: "var(--text2)", marginBottom: 16 }}>{t("lernen.doneHint")}</p>
          {data.next_due && (
            <p style={{ fontSize: 14, color: "var(--text)", marginBottom: 16 }}>
              {t("lernen.nextLearning")} <strong>{new Date(data.next_due).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</strong>
            </p>
          )}
          <MeinFortschritt data={data} t={t} />
          {data.total > 0 && (
            <button onClick={() => load(true)} style={{ ...btnSecondary, marginTop: 16 }}>
              {t("lernen.practiceMore")}
            </button>
          )}
        </div>
      </Center>
    );
  }

  const card = data.cards[i];
  return (
    <Center hinweis={t("lernen.footerHint")}>
      <div style={{ width: "100%", maxWidth: 460 }}>
        {tabBar}
        <div style={{ fontSize: 13, color: "var(--text3)", textAlign: "center", marginBottom: 12 }}>
          {data.name} · {t("lernen.cardOf", { i: i + 1, n: data.cards.length })}
        </div>
        <div onClick={() => !flipped && setFlipped(true)} style={{ cursor: flipped ? "default" : "pointer" }}>
          <CardFace
            text={flipped ? card.back : card.front}
            imageUrl={(flipped ? card.has_back_image : card.has_front_image)
              ? `${API}/lernen/${token}/image/${card.card_id}/${flipped ? "back" : "front"}` : null}
          />
        </div>

        {!flipped ? (
          <button onClick={() => setFlipped(true)} style={{ ...btnPrimary, width: "100%", marginTop: 16 }}>{t("lernen.flip")}</button>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginTop: 16 }}>
            <Grade label={t("lernen.gradeAgain")} color={C.danger} onClick={() => bewerten(0)} />
            <Grade label={t("lernen.gradeHard")} color={C.warning} onClick={() => bewerten(1)} />
            <Grade label={t("lernen.gradeGood")} color={C.success} onClick={() => bewerten(2)} />
            <Grade label={t("lernen.gradeEasy")} color={C.info} onClick={() => bewerten(3)} />
          </div>
        )}
      </div>
    </Center>
  );
}

// Eigener Fortschritt fuer die lernende Person: gelernt-Anteil und die
// Reifegrad-Verteilung als kleiner gestapelter Balken. Die Beschriftung kommt
// aus der Uebersetzung, die Farbe aus REIFE_COLORS (Icons.jsx) — dieselbe
// Staffelung wie in der Lehrer-Ansicht.
const REIFE = [
  ["neu", "lernen.reifeNeu"],
  ["lernen", "lernen.reifeLernen"],
  ["kurz", "lernen.reifeKurz"],
  ["mittel", "lernen.reifeMittel"],
  ["lang", "lernen.reifeLang"],
];

function MeinFortschritt({ data, t }) {
  const hist = data?.hist || {};
  const total = data?.total || 0;
  if (!total) return null;
  const learned = data?.learned || 0;
  return (
    <div style={{ ...cardStyle, textAlign: "left" }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{t("lernen.myProgress")}</div>
      <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 12 }}>{t("lernen.learnedOf", { n: learned, total })}</div>
      {/* Balken und Punkt sind reine Grafik: der Radius ist jeweils die halbe
          Kante (12/2 bzw. 8/2), also ein rundes Ende, kein Bedienelement. */}
      <div style={{ display: "flex", height: 12, borderRadius: 6, overflow: "hidden", marginBottom: 8 }}>
        {REIFE.map(([k]) => {
          const n = hist[k] || 0;
          return n > 0 ? <div key={k} style={{ width: `${(n / total) * 100}%`, background: REIFE_COLORS[k] }} title={`${n}`} /> : null;
        })}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px" }}>
        {REIFE.map(([k, label]) => (
          <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text3)" }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: REIFE_COLORS[k] }} />
            {t(label)} {hist[k] || 0}
          </span>
        ))}
      </div>
    </div>
  );
}

// CardVote-Testergebnisse des Schülers (öffentlich über den Token).
function Ergebnisse({ results, t }) {
  if (results === null) return <p style={{ color: "var(--text3)", textAlign: "center" }}>{t("common.loading")}</p>;
  if (!results.length) return (
    <div style={{ textAlign: "center", padding: "40px 0" }}>
      <div style={{ marginBottom: 8 }}><Icon d={ICONS.chart} size={42} color="var(--text3)" /></div>
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>{t("lernen.noResultTitle")}</h2>
      <p style={{ color: "var(--text2)" }}>{t("lernen.noResultHint")}</p>
    </div>
  );
  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12, textAlign: "center" }}>{t("lernen.resultsTitle")}</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {results.map((r, idx) => (
          <div key={idx} style={{ ...cardStyle, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
              <div style={{ fontSize: 12, color: "var(--text3)" }}>{r.date ? new Date(r.date).toLocaleDateString() : ""}</div>
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: r.pct >= 50 ? C.success : C.danger }}>{r.pct}%</div>
            <div style={{ fontSize: 12, color: "var(--text3)" }}>{r.score}/{r.total}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

const Center = ({ children, hinweis }) => (
  <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "var(--bg)" }}>
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      {children}
    </div>
    {/* Pflichtangaben auch hier: diese Seite sehen Lernende ohne Konto. */}
    <RechtsFuss hinweis={hinweis} />
  </div>
);

// Bewertungsknopf: dieselbe Pille wie ueberall, nur die Farbe sagt, was sie tut.
function Grade({ label, color, onClick }) {
  return (
    <button onClick={onClick} style={{ ...btnPrimary, background: color, color: C.aufAkzent, width: "100%", boxSizing: "border-box", padding: "12px 4px", fontSize: 13 }}>
      {label}
    </button>
  );
}
