import { useEffect, useState } from "react";
import {
  Modal, DialogKopf, Toggle, btnSecondary, btnSmall, cardStyle, COLORS as C,
  Icon, ICONS, iconBtn, sectionLabel,
} from "./Icons.jsx";
import { askConfirm } from "../core/dialog.jsx";
import AuthImage from "./AuthImage.jsx";
import { useLanguage } from "../i18n";

// Fehlermeldungen für die Administration.
//
// Sie gingen früher per Mail: weg, sobald das Postfach aufgeräumt wurde, nicht
// durchsuchbar, und ohne funktionierendes SMTP schlicht verloren. Jetzt liegen
// sie in der Datenbank — hier sieht man alle, löscht einzeln und schaltet den
// Melde-Knopf im Ganzen ab.
//
// Weil das geht, braucht es keine Mengenbremse mehr: was zu viel ist,
// entscheidet der Betreiber, nicht ein Zähler, der eine echte Meldung im
// ungeeignetsten Moment abweist.
export default function BugAdmin() {
  const { t } = useLanguage();
  const [an, setAn] = useState(true);
  const [offen, setOffen] = useState(false);
  const [liste, setListe] = useState(null);
  const [gross, setGross] = useState(null);   // aufgeklappte Meldung

  useEffect(() => {
    fetch("/api/bugreport/status").then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setAn(!!d.an); }).catch(() => {});
  }, []);

  const schalten = async (v) => {
    setAn(v);
    await fetch("/api/admin/bugreport", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ an: v }),
    }).catch(() => {});
  };

  const laden = async () => {
    setOffen(true);
    setListe(null);
    const d = await fetch("/api/admin/bugreports").then((r) => (r.ok ? r.json() : [])).catch(() => []);
    setListe(Array.isArray(d) ? d : []);
  };

  const loeschen = async (r) => {
    if (!(await askConfirm(t("bugadmin.loeschenFrage")))) return;
    await fetch(`/api/admin/bugreports/${r.id}`, { method: "DELETE" }).catch(() => {});
    setListe((l) => (l || []).filter((x) => x.id !== r.id));
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Toggle checked={an} onChange={schalten} label={t("bugadmin.schalter")} />
        <button onClick={laden} style={{ ...btnSecondary, ...btnSmall, marginLeft: "auto" }}>
          {t("bugadmin.alle")}
        </button>
      </div>

      {offen && (
        <Modal onClose={() => setOffen(false)} width={640} label={t("bugadmin.titel")}>
          <DialogKopf titel={t("bugadmin.titel")} onClose={() => setOffen(false)} schliessenLabel={t("common.close")} />
          {!liste && <p style={{ fontSize: 13, color: "var(--text3)" }}>{t("common.loading")}</p>}
          {liste && liste.length === 0 && <p style={{ fontSize: 13, color: "var(--text3)" }}>{t("bugadmin.leer")}</p>}
          {(liste || []).map((r) => (
            <div key={r.id} style={{ ...cardStyle, padding: 10, marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: "var(--text3)" }}>
                  {r.created_at ? new Date(r.created_at).toLocaleString() : ""}
                </span>
                {/* Von wem — die Rückfrage geht sonst ins Leere. */}
                <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{r.email || "—"}</span>
                {/* Dass etwas anhaengt, muss man sehen, ohne jede Meldung
                    aufzuklappen — meistens ist es ein Bildschirmfoto, und das
                    ist der halbe Bericht. */}
                {r.anhang_name && (
                  <span title={r.anhang_name} style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--text3)" }}>
                    <Icon d={ICONS.image} size={15} color="var(--text3)" />
                  </span>
                )}
                <button onClick={() => setGross(gross === r.id ? null : r.id)} style={{ ...btnSecondary, ...btnSmall }}>
                  {gross === r.id ? t("bugadmin.zu") : t("bugadmin.mehr")}
                </button>
                <button onClick={() => loeschen(r)} className="icon-btn" style={{ ...iconBtn, padding: 4 }}
                  title={t("common.delete")} aria-label={t("common.delete")}>
                  <Icon d={ICONS.trash} size={15} color={C.danger} />
                </button>
              </div>
              <p style={{ fontSize: 13, margin: "6px 0 0", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{r.message}</p>
              {/* Ein Bild wird als Bild gezeigt, nicht als Dateiname: ein
                  Bildschirmfoto beantwortet die Meldung oft allein. Klick macht
                  es gross (AuthImage — der Endpunkt braucht den Token). */}
              {r.anhang_name && /^image\//.test(r.anhang_typ || "") && (
                <AuthImage src={`/api/admin/bugreports/${r.id}/anhang`} alt={r.anhang_name}
                  style={{ marginTop: 8, maxHeight: 120, maxWidth: "100%", objectFit: "contain",
                           borderRadius: cardStyle.borderRadius, border: "1px solid var(--border2)" }} />
              )}
              {gross === r.id && (
                <div style={{ marginTop: 8, fontSize: 12, color: "var(--text2)" }}>
                  <div style={{ ...sectionLabel, margin: "0 0 4px" }}>{r.seite} · {r.fassung}</div>
                  <div style={{ color: "var(--text3)", overflowWrap: "anywhere" }}>{r.browser}</div>
                  {r.anhang_name && (
                    <a href={`/api/admin/bugreports/${r.id}/anhang`} target="_blank" rel="noreferrer"
                      style={{ color: "var(--accent)", display: "inline-block", marginTop: 6 }}>
                      {r.anhang_name}
                    </a>
                  )}
                  {(r.umgebung || r.log) && (
                    <pre style={{ maxHeight: 220, overflow: "auto", fontSize: 11, lineHeight: 1.5,
                      whiteSpace: "pre-wrap", marginTop: 6 }}>
                      {[r.umgebung, r.log].filter(Boolean).join("\n\n")}
                    </pre>
                  )}
                </div>
              )}
            </div>
          ))}
        </Modal>
      )}
    </>
  );
}
