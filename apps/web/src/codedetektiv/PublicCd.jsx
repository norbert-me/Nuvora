// Öffentliche Spiel-Seite für Code-Detektiv — Schüler treten ohne Login über
// den Session-Code bei (eigene Geräte). Route /cd/:code/*, kein ModuleGate.
import { useState, useEffect } from "react";
import { Routes, Route, useParams, useNavigate } from "react-router-dom";
import { StoreProvider, useStore } from "./data/store";
import { CdBase } from "./base.jsx";
import RechtsFuss from "../components/RechtsFuss.jsx";
import { btnPrimary, cardStyle, inputStyle, pageForm, pageTitle, COLORS } from "../components/Icons.jsx";
import PuzzlePage from "./pages/PuzzlePage";
import PlaySession from "./pages/PlaySession";
import { useCdText } from "./i18n.js";
import "./styles/makecode.css";

// Beitreten (Name eingeben) — der Code steht schon in der URL.
function PublicJoin({ code }) {
  const { t } = useCdText();
  const { dispatch } = useStore();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [gefunden, setGefunden] = useState(null); // null=prüft, true/false

  useEffect(() => {
    fetch(`/api/codedetektiv/sessions/${code}`).then((r) => setGefunden(r.ok)).catch(() => setGefunden(false));
  }, [code]);

  const beitreten = async (e) => {
    e.preventDefault();
    setError("");
    const n = name.trim(); if (!n) return;
    const r = await fetch(`/api/codedetektiv/sessions/${code}/join`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: n }),
    }).catch(() => null);
    if (!r || !r.ok) {
      setError(r && r.status === 400
        ? t('cd.public.beitritt_zu', "Beitreten nicht möglich (läuft schon oder beendet).")
        : t('cd.session.nicht_gefunden', "Session nicht gefunden."));
      return;
    }
    dispatch({ type: "SET_USER", user: { name: n, role: "player" } });
    dispatch({ type: "SET_CURRENT_SESSION", code });
    navigate(`/cd/${code}/play/${code}`);
  };

  // Wie jede Formularseite in Nuvora: normale Flaeche, eine Karte, Shell-Tokens.
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "var(--bg)" }}>
      <form onSubmit={beitreten} style={{ ...cardStyle, ...pageForm, padding: 22, textAlign: "center" }}>
        <h1 style={pageTitle}>{t('cd.titel', "Code-Detektiv")}</h1>
        <p style={{ color: "var(--text2)", fontSize: 14, marginBottom: 18 }}>{t('cd.session', "Session")} <strong style={{ letterSpacing: 3 }}>{code}</strong></p>
        {gefunden === false && <p style={{ color: COLORS.danger, fontSize: 13.5, fontWeight: 600, marginBottom: 12 }}>{t('cd.session.nicht_gefunden', "Session nicht gefunden.")}</p>}
        <input type="text" placeholder={t('cd.dein_name', "Dein Name")} value={name} onChange={(e) => setName(e.target.value)} required
          style={{ ...inputStyle, width: "100%", marginBottom: 12 }} />
        {error && <div style={{ color: COLORS.danger, fontSize: 13.5, fontWeight: 600, marginBottom: 12 }}>{error}</div>}
        <button type="submit" style={{ ...btnPrimary, width: "100%" }}>{t('cd.beitreten', "Beitreten")} →</button>
      </form>
    </div>
  );
}

export default function PublicCd() {
  const { t } = useCdText();
  const { code } = useParams();
  const base = `/cd/${code}`;
  return (
    <CdBase.Provider value={base}>
      <div className="cd-scope">
        <StoreProvider>
          <Routes>
            <Route path="" element={<PublicJoin code={code} />} />
            <Route path="play/:sessionId" element={<PlaySession />} />
            <Route path="puzzle/:id" element={<PuzzlePage />} />
          </Routes>
        </StoreProvider>
        {/* Pflichtangaben: diese Seite sehen Lernende ohne Konto. */}
        <RechtsFuss hinweis={t('cd.public.hinweis', "Dein gewählter Name und dein Lösungsstand sind für alle sichtbar, die den Sitzungscode haben.")} />
      </div>
    </CdBase.Provider>
  );
}
