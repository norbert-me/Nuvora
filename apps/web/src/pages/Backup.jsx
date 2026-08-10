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
import { useState, useEffect, useRef } from "react";
import { useLanguage } from "../i18n/index.jsx";
import { askConfirm } from "../core/dialog.jsx";
import {
  pageApp, pageTitle, pageIntro, panelStyle, cardStyle, btnPrimary, btnSecondary,
  btnSmall, selectStyle, inputStyle, chipStyle, sectionLabel, COLORS as C, Icon, ICONS, iconBtn, Empty,
  Skeleton, badge, Modal,
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

// Das Ergebnis eines Probelaufs: was steckt wirklich in der Datei? „30 Schüler,
// 1 Klasse, 214 Noten" — statt es glauben zu müssen. Zweimal gebraucht (Liste
// und Einspiel-Dialog), deshalb eine Komponente.
function Zahlen({ daten, t }) {
  const tabellen = Object.entries(daten.tabellen || {});
  return (
    <div style={{ fontSize: 12.5, color: "var(--text2)", lineHeight: 1.7 }}>
      {t("backup.dryRunSummary", {
        rows: daten.zeilen,
        tables: tabellen.length,
        files: daten.uploads_anzahl,
      })}
      {daten.nuvora ? <> · {t("backup.dryRunVersion", { v: daten.nuvora })}</> : null}
      {daten.erzeugt ? <> · {zeitpunkt(daten.erzeugt)}</> : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
        {tabellen.map(([name, n]) => (
          <span key={name} style={{ ...chipStyle, whiteSpace: "nowrap" }}>{name} {n}</span>
        ))}
      </div>
    </div>
  );
}

export default function Backup() {
  const { t } = useLanguage();
  const [stand, setStand] = useState(null);
  const [laden, setLaden] = useState(true);
  const [busy, setBusy] = useState("");
  const [meldung, setMeldung] = useState(null); // {art: "ok"|"fehler", text}
  const [pruefung, setPruefung] = useState(null); // Ergebnis der Integritätsprüfung
  const [probe, setProbe] = useState(null); // Ergebnis des Probelaufs
  // Der Einspiel-Dialog. {name, probe, laeuft, wort, fehler} — er ist die
  // einzige Stelle, an der die Oberfläche etwas Unwiderrufliches auslöst.
  const [dialog, setDialog] = useState(null);
  const dateiRef = useRef(null);

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

  // Hochladen: der Dateiname des Clients ist dem Server egal, er vergibt selbst
  // einen (backup.py: _neuer_name). Hier wird deshalb nichts bereinigt.
  const hochladen = async (ereignis) => {
    const datei = ereignis.target.files?.[0];
    ereignis.target.value = ""; // dieselbe Datei soll erneut wählbar bleiben
    if (!datei) return;
    setBusy("upload"); setMeldung(null); setPruefung(null); setProbe(null);
    try {
      const formular = new FormData();
      formular.append("file", datei);
      const r = await fetch(`${API}/hochladen`, { method: "POST", body: formular });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.detail || r.status);
      setMeldung({ art: "ok", text: t("backup.uploadDone", { name: d.name }) });
      await load();
    } catch (e) {
      setMeldung({ art: "fehler", text: `${t("backup.uploadFailed")}: ${e.message}` });
    } finally {
      setBusy("");
    }
  };

  // Probelauf: spielt serverseitig in eine Wegwerf-Datenbank und meldet, was
  // drinsteht. Rührt die laufende Datenbank nicht an.
  const probelauf = async (name) => {
    const r = await fetch(`${API}/${encodeURIComponent(name)}/probelauf`, { method: "POST" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.detail || r.status);
    return d;
  };

  const probeZeigen = async (name) => {
    setBusy(name); setProbe(null); setPruefung(null); setMeldung(null);
    try {
      setProbe(await probelauf(name));
    } catch (e) {
      setMeldung({ art: "fehler", text: `${t("backup.dryRunFailed")}: ${e.message}` });
    } finally {
      setBusy("");
    }
  };

  // Der Dialog holt sich den Probelauf selbst: niemand soll über „Einspielen"
  // gehen, ohne vorher gesehen zu haben, was in der Datei steckt.
  const dialogOeffnen = async (name) => {
    setDialog({ name, probe: null, laeuft: true, wort: "", fehler: "" });
    try {
      const d = await probelauf(name);
      setDialog((v) => (v && v.name === name ? { ...v, probe: d, laeuft: false } : v));
    } catch (e) {
      setDialog((v) => (v && v.name === name ? { ...v, laeuft: false, fehler: e.message } : v));
    }
  };

  const einspielen = async () => {
    const name = dialog.name;
    setDialog((v) => ({ ...v, laeuft: true, fehler: "" }));
    try {
      const r = await fetch(`${API}/${encodeURIComponent(name)}/zurueckspielen`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bestaetigung: dialog.wort }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.detail || r.status);
      // Neu laden, nicht neu rendern: die Oberfläche hält sonst Klassen, Namen
      // und einen Token, die es in der neuen Datenbank so nicht mehr gibt.
      window.location.reload();
    } catch (e) {
      setDialog((v) => ({ ...v, laeuft: false, fehler: e.message }));
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
        <input
          ref={dateiRef}
          type="file"
          accept=".zip,application/zip"
          onChange={hochladen}
          style={{ display: "none" }}
        />
        <button
          onClick={() => dateiRef.current?.click()}
          disabled={!!busy}
          style={{ ...btnSecondary, opacity: busy ? 0.6 : 1 }}
        >
          {busy === "upload" ? t("backup.uploading") : t("backup.upload")}
        </button>
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
                <button onClick={() => probeZeigen(s.name)} disabled={!!busy} style={{ ...btnSecondary, ...btnSmall }}>
                  {t("backup.dryRun")}
                </button>
                <button onClick={() => laden_datei(s.name)} disabled={!!busy} style={{ ...btnSecondary, ...btnSmall }}>
                  {t("backup.download")}
                </button>
                <button
                  onClick={() => dialogOeffnen(s.name)}
                  disabled={!!busy}
                  style={{ ...btnSecondary, ...btnSmall, borderColor: C.danger, color: C.danger }}
                >
                  {t("backup.restoreNow")}
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
        {probe && (
          <div style={{ ...cardStyle, marginTop: 12, borderColor: C.success }}>
            <div style={{ fontWeight: 600, color: C.success, marginBottom: 6 }}>
              {t("backup.dryRunOk")} — {probe.name}
            </div>
            <Zahlen daten={probe} t={t} />
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

      {/* Einspielen. Der einzige Knopf der Anwendung, der ALLE Daten der
          Installation ersetzt — deshalb: erst der Probelauf, dann die Warnung,
          dann das abgetippte Wort. */}
      {dialog && (
        <Modal onClose={() => (dialog.laeuft ? null : setDialog(null))} width={560} title={t("backup.restoreTitle")}>
          <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.7 }}>
            <div style={{ fontWeight: 600, color: "var(--text)", wordBreak: "break-all", marginBottom: 8 }}>
              {dialog.name}
            </div>

            {/* (a) Was steckt in der Datei? */}
            <div style={{ ...cardStyle, marginBottom: 12 }}>
              <div style={{ ...sectionLabel, marginBottom: 6 }}>{t("backup.dryRun")}</div>
              {dialog.laeuft && !dialog.probe ? (
                <Skeleton rows={2} />
              ) : dialog.probe ? (
                <Zahlen daten={dialog.probe} t={t} />
              ) : (
                <div style={{ color: C.danger, fontSize: 12.5 }}>{dialog.fehler}</div>
              )}
            </div>

            {/* (b) Was passiert dabei — im Klartext. */}
            <div style={{ ...cardStyle, borderColor: C.danger, color: C.danger, marginBottom: 12 }}>
              {t("backup.restoreWarn")}
            </div>

            {/* (d) Vorher wird automatisch gesichert. */}
            <p style={{ marginTop: 0, fontSize: 12.5, color: "var(--text3)" }}>
              {t("backup.restoreNet")}
            </p>

            {/* (c) Das Wort abtippen. */}
            <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 13 }}>
              {t("backup.restoreType", { word: stand.bestaetigung })}
              <input
                value={dialog.wort}
                onChange={(e) => setDialog((v) => ({ ...v, wort: e.target.value }))}
                placeholder={stand.bestaetigung}
                autoFocus
                style={{ ...inputStyle, width: "100%" }}
              />
            </label>

            {dialog.fehler && dialog.probe && (
              <div style={{ color: C.danger, fontSize: 12.5, marginTop: 8 }}>{dialog.fehler}</div>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
              <button onClick={() => setDialog(null)} disabled={dialog.laeuft} style={btnSecondary}>
                {t("common.cancel")}
              </button>
              <button
                onClick={einspielen}
                disabled={dialog.laeuft || !dialog.probe
                  || dialog.wort.trim().toUpperCase() !== stand.bestaetigung}
                style={{
                  ...btnPrimary,
                  background: C.danger,
                  opacity: dialog.laeuft || !dialog.probe
                    || dialog.wort.trim().toUpperCase() !== stand.bestaetigung ? 0.5 : 1,
                }}
              >
                {dialog.laeuft && dialog.probe ? t("backup.restoreRunning") : t("backup.restoreGo")}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
