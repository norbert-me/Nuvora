// Gemeinsamer Papierkorb des Kerns: alles Gelöschte an einer Stelle — Klassen,
// Kurse, Kartenstapel, Karten, Lernpfade, Lernleitern. Die Module haben keinen
// eigenen Papierkorb mehr; sie löschen nur noch (Soft-Delete), gefunden wird
// hier. Serverseite: apps/api/app/routers/trash.py.
import { useState, useEffect } from "react";
import { useLanguage } from "../i18n/index.jsx";
import { askConfirm } from "../core/dialog.jsx";
import { pageTitle, pageIntro, btnSecondary, Icon, ICONS, iconBtn, COLORS as C, panelStyle, Empty, pageApp } from "../components/Icons.jsx";

const API = "/api";

// Anzeige-Reihenfolge der Arten (Kern zuerst, dann die Module).
const ARTEN = ["kurs", "class", "deck", "card", "path", "ladder"];

export default function Papierkorb() {
  const { t } = useLanguage();
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = () => fetch(`${API}/trash`).then((r) => (r.ok ? r.json() : [])).then((d) => setItems(Array.isArray(d) ? d : [])).catch(() => {});
  useEffect(() => { load(); }, []);

  const restore = async (it) => {
    setBusy(true);
    await fetch(`${API}/trash/${it.kind}/${it.id}/restore`, { method: "POST" }).catch(() => {});
    setBusy(false);
    load();
  };
  const purge = async (it) => {
    if (!await askConfirm(t("trash.purgeConfirm", { name: it.label }))) return;
    setBusy(true);
    await fetch(`${API}/trash/${it.kind}/${it.id}`, { method: "DELETE" }).catch(() => {});
    setBusy(false);
    load();
  };
  const leeren = async () => {
    if (!await askConfirm(t("trash.emptyConfirm", { n: items.length }))) return;
    setBusy(true);
    await fetch(`${API}/trash`, { method: "DELETE" }).catch(() => {});
    setBusy(false);
    load();
  };

  // Verbleibende Tage bis zum endgültigen Löschen (Server: 30 Tage).
  const restTage = (it) => Math.max(0, Math.ceil((new Date(it.purge_at) - new Date()) / 86400000));

  const gruppen = ARTEN
    .map((kind) => ({ kind, list: items.filter((i) => i.kind === kind) }))
    .filter((g) => g.list.length);

  return (
    <div style={pageApp}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ ...pageTitle, marginBottom: 0, flex: 1 }}>{t("trash.title")}</h1>
        {items.length > 0 && (
          <button onClick={leeren} disabled={busy} style={{ ...btnSecondary, color: C.danger, opacity: busy ? 0.6 : 1 }}>
            {t("trash.empty")}
          </button>
        )}
      </div>
      <p style={pageIntro}>{t("trash.intro")}</p>

      {items.length === 0 && <Empty title={t("trash.emptyTitle")} hint={t("trash.emptyHint")} />}

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {gruppen.map(({ kind, list }) => (
          <div key={kind} style={panelStyle}>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text3)", marginBottom: 8 }}>
              {list[0].art} ({list.length})
            </div>
            {list.map((it) => (
              <div key={`${it.kind}-${it.id}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderTop: "1px solid var(--border)" }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 500 }}>{it.label}</span>
                  {it.context && <span style={{ fontSize: 12, color: "var(--text3)", marginLeft: 8 }}>{it.context}</span>}
                </span>
                <span style={{ fontSize: 12, color: "var(--text3)", whiteSpace: "nowrap" }}>{t("trash.daysLeft", { n: restTage(it) })}</span>
                <button onClick={() => restore(it)} disabled={busy} style={{ ...btnSecondary, padding: "4px 11px", fontSize: 12.5, opacity: busy ? 0.6 : 1 }}>
                  {t("trash.restore")}
                </button>
                <button onClick={() => purge(it)} disabled={busy} className="icon-btn" style={{ ...iconBtn, padding: 4 }} title={t("trash.purge")} aria-label={t("trash.purge")}>
                  <Icon d={ICONS.trash} size={15} color={C.danger} />
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
