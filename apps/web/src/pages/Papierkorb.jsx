// Gemeinsamer Papierkorb des Kerns: alles Gelöschte an einer Stelle — Klassen,
// Kurse, Themen, Kartenstapel, Karten, Lernpfade, Lernleitern, CardVote-Fragen. Die Module haben keinen
// eigenen Papierkorb mehr; sie löschen nur noch (Soft-Delete), gefunden wird
// hier. Serverseite: apps/api/app/routers/trash.py.
import { useState, useEffect } from "react";
import { useLanguage } from "../i18n/index.jsx";
import { askConfirm } from "../core/dialog.jsx";
import { pageTitle, pageIntro, btnSecondary, btnSmall, Icon, ICONS, iconBtn, COLORS as C, panelStyle, sectionLabel, Empty, pageApp, LoadError } from "../components/Icons.jsx";
import Werkzeugleiste from "../components/Werkzeugleiste.jsx";
import { sende } from "../core/melden.js";

const API = "/api";

// Anzeige-Reihenfolge der Arten (Kern zuerst, dann die Module).
const ARTEN = ["kurs", "class", "topic", "deck", "card", "path", "ladder", "question"];

export default function Papierkorb() {
  const { t } = useLanguage();
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);

  // „Papierkorb ist leer" ist hier die beruhigendste Meldung der Anwendung —
  // und war bei jedem Serverfehler gelogen. Wer sein geloeschtes Halbjahr
  // suchte, sah Leere und glaubte, die 30 Tage seien vorbei.
  const [ladefehler, setLadefehler] = useState(false);
  const load = () => fetch(`${API}/trash`)
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((d) => { setItems(Array.isArray(d) ? d : []); setLadefehler(false); })
    .catch(() => setLadefehler(true));
  useEffect(() => { load(); }, []);

  const restore = async (it) => {
    setBusy(true);
    // Ein gescheitertes Wiederherstellen war nicht von einem gelungenen zu
    // unterscheiden: der Eintrag blieb im Papierkorb stehen, kommentarlos.
    await sende(`${API}/trash/${it.kind}/${it.id}/restore`, { method: "POST" }, t("trash.restore"));
    setBusy(false);
    load();
  };
  const purge = async (it) => {
    if (!await askConfirm(t("trash.purgeConfirm", { name: it.label }))) return;
    setBusy(true);
    await sende(`${API}/trash/${it.kind}/${it.id}`, { method: "DELETE" }, t("trash.purge"));
    setBusy(false);
    load();
  };
  const leeren = async () => {
    if (!await askConfirm(t("trash.emptyConfirm", { n: items.length }))) return;
    setBusy(true);
    await sende(`${API}/trash`, { method: "DELETE" }, t("trash.empty"));
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
      <h1 style={{ ...pageTitle, marginBottom: 0 }}>{t("trash.title")}</h1>
      <p style={pageIntro}>{t("trash.intro")}</p>

      {/* „Alles endgültig löschen" stand offen in der Kopfleiste, direkt neben
          dem Titel — der eine Knopf der Seite, der nichts zurückholt. Er gehört
          ins Menü: selten und gefährlich (`gefahr: true` stellt ihn ans Ende
          und färbt ihn rot). */}
      {items.length > 0 && (
        <Werkzeugleiste mehr={[{
          key: "leeren", label: t("trash.empty"), icon: ICONS.trash, gefahr: true,
          disabled: busy, onClick: leeren,
        }]} />
      )}

      {ladefehler ? <LoadError message={t("trash.loadError")} onRetry={load} />
        : items.length === 0 && <Empty title={t("trash.emptyTitle")} hint={t("trash.emptyHint")} />}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {gruppen.map(({ kind, list }) => (
          <div key={kind} style={panelStyle}>
            <div style={{ ...sectionLabel, marginBottom: 8 }}>
              {list[0].art} ({list.length})
            </div>
            {list.map((it) => (
              <div key={`${it.kind}-${it.id}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderTop: "1px solid var(--border)" }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 500 }}>{it.label}</span>
                  {it.context && <span style={{ fontSize: 12, color: "var(--text3)", marginLeft: 8 }}>{it.context}</span>}
                </span>
                <span style={{ fontSize: 12, color: "var(--text3)", whiteSpace: "nowrap" }}>{t("trash.daysLeft", { n: restTage(it) })}</span>
                <button onClick={() => restore(it)} disabled={busy} style={{ ...btnSecondary, ...btnSmall, opacity: busy ? 0.6 : 1 }}>
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
