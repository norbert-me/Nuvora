// Sicherungen — Serververwaltung, kein Modul. Sie steht deshalb NICHT im
// Modulregister (REGISTRY) und hängt nicht am ModuleGate, sondern an der
// Administration (Nutzer-ID 1), genau wie der Administrationsteil in /profile.
//
// Serverseite: apps/api/app/routers/backup.py. Dort steht auch, WAS gesichert
// wird (Datenbank + Upload-Ordner + config/site.json) und warum die Dateien
// bewusst unverschlüsselt abgelegt werden.
//
// Alle Stile kommen aus components/Icons.jsx — pro Seite wird hier nichts neu
// definiert (CLAUDE.md: einzige Design-Quelle).
import { useState, useEffect } from "react";
import { useLanguage } from "../i18n/index.jsx";
import { askConfirm } from "../core/dialog.jsx";
import {
  pageApp, pageTitle, pageIntro, panelStyle, cardStyle, btnPrimary, btnSecondary,
  btnSmall, selectStyle, sectionLabel, COLORS as C, Icon, ICONS, iconBtn, Empty,
  Skeleton, badge,
} from "../components/Icons.jsx";

const API = "/api/admin/backup";

const groesse = (b) => {
  if (!b && b !== 0) return "—";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} kB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

const zeitpunkt = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleString();
};

export default function Backup() {
  const { t } = useLanguage();
  const [stand, setStand] = useState(null);
  const [laden, setLaden] = useState(true);
  const [busy, setBusy] = useState("");
  const [meldung, setMeldung] = useState(null); // {art: "ok"|"fehler", text}
  const [pruefung, setPruefung] = useState(null); // Ergebnis der Integritätsprüfung

  const load = () =>
    fetch(API)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setStand(d))
      .catch(() => setStand(null))
      .finally(() => setLaden(false));

  useEffect(() => { load(); }, []);

  const sichern = async () => {
    setBusy("neu"); setMeldung(null); setPruefung(null);
    try {
      const r = await fetch(API, { method: "POST" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.status);
      setMeldung({ art: "ok", text: t("backup.doneNew") });
      await load();
    } catch (e) {
      setMeldung({ art: "fehler", text: `${t("backup.failed")}: ${e.message}` });
    } finally {
      setBusy("");
    }
  };

  const einstellen = async (feld, wert) => {
    setBusy(feld); setMeldung(null);
    try {
      const r = await fetch(`${API}/einstellungen`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [feld]: wert }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.detail || r.status);
      setStand(d);
    } catch (e) {
      setMeldung({ art: "fehler", text: e.message });
    } finally {
      setBusy("");
    }
  };

  // Der Download läuft über den angemeldeten Endpunkt, nicht über eine feste
  // Adresse: ein <a href> würde den Token aus dem localStorage nicht
  // mitschicken (der globale fetch-Interceptor in main.jsx tut es).
  const laden_datei = async (name) => {
    setBusy(name); setMeldung(null);
    try {
      const r = await fetch(`${API}/${encodeURIComponent(name)}`);
      if (!r.ok) throw new Error(r.status);
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setMeldung({ art: "fehler", text: `${t("backup.downloadFailed")}: ${e.message}` });
    } finally {
      setBusy("");
    }
  };

  const pruefen = async (name) => {
    setBusy(name); setPruefung(null); setMeldung(null);
    try {
      const r = await fetch(`${API}/${encodeURIComponent(name)}/pruefen`, { method: "POST" });
      const d = await r.json();
      setPruefung(d);
    } catch (e) {
      setMeldung({ art: "fehler", text: e.message });
    } finally {
      setBusy("");
    }
  };

  const loeschen = async (name) => {
    if (!(await askConfirm(t("backup.deleteConfirm", { name })))) return;
    setBusy(name);
    await fetch(`${API}/${encodeURIComponent(name)}`, { method: "DELETE" }).catch(() => {});
    setBusy("");
    setPruefung(null);
    load();
  };

  if (laden) return <div style={pageApp}><Skeleton rows={4} /></div>;
  if (!stand) {
    return (
      <div style={pageApp}>
        <h1 style={pageTitle}>{t("backup.title")}</h1>
        <Empty title={t("backup.noAccess")} hint={t("backup.noAccessHint")} />
      </div>
    );
  }

  const letzte = stand.letzte;

  return (
    <div style={pageApp}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ ...pageTitle, marginBottom: 0, flex: 1, minWidth: 180 }}>{t("backup.title")}</h1>
        <button onClick={sichern} disabled={!!busy} style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }}>
          {busy === "neu" ? t("backup.running") : t("backup.now")}
        </button>
      </div>
      <p style={pageIntro}>{t("backup.intro")}</p>

      {meldung && (
        <div style={{ ...cardStyle, marginBottom: 14, borderColor: meldung.art === "ok" ? C.success : C.danger, color: meldung.art === "ok" ? C.success : C.danger, fontSize: 13.5 }}>
          {meldung.text}
        </div>
      )}

      {/* Zustand: wann lief es zuletzt, und hat es geklappt? */}
      <div style={{ ...panelStyle, marginBottom: 14 }}>
        <div style={{ ...sectionLabel, marginBottom: 8 }}>{t("backup.state")}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 18, fontSize: 13.5, color: "var(--text2)" }}>
          <div>
            <div style={{ color: "var(--text3)", fontSize: 12 }}>{t("backup.lastRun")}</div>
            <div style={{ color: "var(--text)" }}>
              {letzte ? zeitpunkt(letzte.zeit) : t("backup.never")}
              {letzte && (
                <span style={{ ...badge(letzte.ok ? C.success : C.danger), marginLeft: 8 }}>
                  {letzte.ok ? t("backup.ok") : t("backup.failedShort")}
                </span>
              )}
            </div>
            {letzte && !letzte.ok && letzte.fehler && (
              <div style={{ color: C.danger, fontSize: 12, marginTop: 4 }}>{letzte.fehler}</div>
            )}
          </div>
          <div>
            <div style={{ color: "var(--text3)", fontSize: 12 }}>{t("backup.count")}</div>
            <div style={{ color: "var(--text)" }}>
              {t("backup.countValue", { n: stand.sicherungen.length, max: stand.aufbewahrung.anzahl, size: groesse(stand.belegt_bytes) })}
            </div>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: "var(--text3)", fontSize: 12 }}>{t("backup.folder")}</div>
            <div style={{ color: "var(--text)", wordBreak: "break-all" }}>{stand.verzeichnis}</div>
          </div>
        </div>
        {!stand.dauerhaft && (
          <div style={{ marginTop: 10, fontSize: 12.5, color: C.warning }}>{t("backup.notPersistent")}</div>
        )}
      </div>

      {/* Ziel und Zeitplan */}
      <div style={{ ...panelStyle, marginBottom: 14 }}>
        <div style={{ ...sectionLabel, marginBottom: 8 }}>{t("backup.settings")}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
          <label style={{ fontSize: 13, color: "var(--text2)", display: "flex", flexDirection: "column", gap: 5, minWidth: 220, flex: 1 }}>
            {t("backup.target")}
            <select
              value={stand.ziel}
              disabled={busy === "ziel"}
              onChange={(e) => einstellen("ziel", e.target.value)}
              style={{ ...selectStyle, width: "100%" }}
            >
              {stand.ziele.map((z) => (
                <option key={z.key} value={z.key} disabled={!z.verfuegbar}>
                  {z.label}{z.verfuegbar ? "" : ` — ${z.grund}`}
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: 13, color: "var(--text2)", display: "flex", flexDirection: "column", gap: 5, minWidth: 200, flex: 1 }}>
            {t("backup.schedule")}
            <select
              value={stand.plan}
              disabled={busy === "plan"}
              onChange={(e) => einstellen("plan", e.target.value)}
              style={{ ...selectStyle, width: "100%" }}
            >
              {stand.plaene.map((p) => (
                <option key={p} value={p}>{t(`backup.plan.${p}`)}</option>
              ))}
            </select>
          </label>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--text3)", marginTop: 10, lineHeight: 1.6 }}>
          {t("backup.retentionHint", { n: stand.aufbewahrung.anzahl, mb: stand.aufbewahrung.max_mb })}
          <br />
          {t("backup.plainHint")}
        </div>
      </div>

      {/* Was drin ist und was nicht — damit niemand von einer Sicherung ausgeht,
          die es so nicht gibt. */}
      <div style={{ ...panelStyle, marginBottom: 14 }}>
        <div style={{ ...sectionLabel, marginBottom: 8 }}>{t("backup.contents")}</div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--text2)", lineHeight: 1.7 }}>
          {stand.inhalt.map((i) => <li key={i}>{i}</li>)}
          {stand.nicht_enthalten.map((i) => (
            <li key={i} style={{ color: "var(--text3)" }}>{t("backup.notIncluded")}: {i}</li>
          ))}
        </ul>
      </div>

      {/* Liste */}
      <div style={{ ...panelStyle, marginBottom: 14 }}>
        <div style={{ ...sectionLabel, marginBottom: 8 }}>{t("backup.list")}</div>
        {stand.sicherungen.length === 0 ? (
          <Empty title={t("backup.emptyTitle")} hint={t("backup.emptyHint")} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {stand.sicherungen.map((s) => (
              <div
                key={s.name}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderTop: "1px solid var(--border)", flexWrap: "wrap" }}
              >
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ fontWeight: 500, color: "var(--text)", wordBreak: "break-all" }}>{s.name}</div>
                  <div style={{ fontSize: 12, color: "var(--text3)" }}>
                    {zeitpunkt(s.zeit)} · {groesse(s.bytes)}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text3)", fontFamily: "monospace", wordBreak: "break-all" }}>
                    sha256 {s.sha256 || "—"}
                  </div>
                </div>
                <button onClick={() => pruefen(s.name)} disabled={!!busy} style={{ ...btnSecondary, ...btnSmall }}>
                  {t("backup.verify")}
                </button>
                <button onClick={() => laden_datei(s.name)} disabled={!!busy} style={{ ...btnSecondary, ...btnSmall }}>
                  {t("backup.download")}
                </button>
                <button
                  onClick={() => loeschen(s.name)}
                  disabled={!!busy}
                  className="icon-btn"
                  style={{ ...iconBtn, color: C.danger }}
                  title={t("backup.delete")}
                  aria-label={t("backup.delete")}
                >
                  <Icon d={ICONS.trash} size={18} />
                </button>
              </div>
            ))}
          </div>
        )}
        {pruefung && (
          <div style={{ ...cardStyle, marginTop: 12, borderColor: pruefung.ok ? C.success : C.danger }}>
            <div style={{ fontWeight: 600, color: pruefung.ok ? C.success : C.danger, marginBottom: 6 }}>
              {pruefung.ok ? t("backup.verifyOk") : t("backup.verifyBad")} — {pruefung.name}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text2)", lineHeight: 1.7 }}>
              {t("backup.verifyRows", { n: pruefung.zeilen, files: pruefung.uploads_anzahl })}
              <br />
              <span style={{ fontFamily: "monospace", wordBreak: "break-all" }}>sha256 {pruefung.sha256}</span>
            </div>
            {pruefung.fehler?.length > 0 && (
              <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12.5, color: C.danger }}>
                {pruefung.fehler.map((f) => <li key={f}>{f}</li>)}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Anleitung zum Zurückspielen — der Punkt, der über allem steht. */}
      <div style={panelStyle}>
        <div style={{ ...sectionLabel, marginBottom: 8 }}>{t("backup.restore")}</div>
        <p style={{ fontSize: 13, color: "var(--text2)", marginTop: 0, lineHeight: 1.6 }}>
          {t("backup.restoreIntro")}
        </p>
        <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "var(--text2)", lineHeight: 1.8 }}>
          {stand.anleitung.map((schritt) => (
            <li key={schritt} style={{ wordBreak: "break-word" }}>{schritt.replace(/^\d+\.\s*/, "")}</li>
          ))}
        </ol>
      </div>
    </div>
  );
}
