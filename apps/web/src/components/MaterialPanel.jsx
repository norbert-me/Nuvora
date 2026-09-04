// Wiederverwendbares Material-/Datei-Panel. Haengt an ein Thema (topicId), eine
// Stunde (entryId), einen Einstieg (methodId) oder eine Klassenarbeit (workId)
// — genau eins davon setzen. Bei der Klassenarbeit sagt `rolle` zusaetzlich,
// WOFUER die Datei steht ("arbeit"/"erwartung"); `titel` benennt den Kasten
// entsprechend. Kern-Feature, kein Modul-Gate. Download laeuft ueber fetch (Bearer-Token), nicht ueber <a href>,
// weil eine Browser-Navigation den Token nicht mitschickt.
import { useState, useEffect } from "react";
import { Icon, ICONS, btnSecondary, btnSmall, iconBtn, chipStyle, cardStyle, COLORS as C, CONTROL_R, Modal } from "./Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { hochladen } from "../core/upload.js";
import Fortschrittsbalken from "./Fortschrittsbalken.jsx";
import { undoDelete } from "../core/undo.jsx";
import { askConfirm } from "../core/dialog.jsx";
import { hol } from "../core/melden.js";

const API = "/api/material";

function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function MaterialPanel({ topicId = null, entryId = null, methodId = null,
                                       workId = null, rolle = null, titel = null,
                                       // Nur ansehen: kein Hochladen, kein Loeschen. Fuer Stellen,
                                       // an denen die Datei zum Nachschlagen dasteht (Vergleich) —
                                       // gepflegt wird sie dort, wo sie hingehoert.
                                       nurLesen = false }) {
  const { t } = useLanguage();
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [fortschritt, setFortschritt] = useState(null);   // 0..100, null = kein Upload
  const [err, setErr] = useState("");
  const [vorschau, setVorschau] = useState(null);   // { url, name, mime }

  // Blob-Adresse wieder freigeben, sonst haelt der Tab die Datei im Speicher.
  useEffect(() => () => { if (vorschau?.url) URL.revokeObjectURL(vorschau.url); }, [vorschau]);

  const q = topicId != null ? `?topic_id=${topicId}`
    : methodId != null ? `?method_id=${methodId}`
    : workId != null ? `?work_id=${workId}${rolle != null ? `&rolle=${rolle}` : ""}`
    : `?entry_id=${entryId}`;
  const load = () => hol(`${API}${q}`).then((d) => setItems(Array.isArray(d) ? d : []));
  useEffect(() => { load(); }, [topicId, entryId, methodId, workId, rolle]);

  const upload = async (file) => {
    if (!file) return;
    setErr(""); setBusy(true); setFortschritt(0);
    const fd = new FormData();
    fd.append("file", file);
    if (topicId != null) fd.append("topic_id", String(topicId));
    if (entryId != null) fd.append("entry_id", String(entryId));
    if (methodId != null) fd.append("method_id", String(methodId));
    if (workId != null) fd.append("work_id", String(workId));
    if (rolle) fd.append("rolle", rolle);
    // Mit Fortschritt: eine Klassenarbeit als Scan hat schnell 20 MB, und ohne
    // Balken ist der Unterschied zwischen „laedt" und „haengt" nicht zu sehen.
    const res = await hochladen(API, fd, { onFortschritt: setFortschritt });
    setBusy(false); setFortschritt(null);
    if (res.ok) load();
    else setErr(typeof res.daten?.detail === "string" ? res.daten.detail : t("common.notWork"));
  };

  // Was der Browser selbst zeigen kann, wird gezeigt. Office-Dateien kann er
  // nicht — die wandelt der Server einmalig nach PDF (LibreOffice) und behaelt
  // das Ergebnis. Ein Download ist bei einer Klassenarbeit, die man nur kurz
  // nachschlagen will, der falsche Weg.
  const OFFICE = /\.(docx?|xlsx?|pptx?|odt|ods|odp|rtf)$/i;
  const istOffice = (m) => OFFICE.test(m.filename || "") || /officedocument|opendocument|ms-(word|excel|powerpoint)|msword/.test(m.mime || "");
  const ansehbar = (m) => /^application\/pdf$|^image\//.test(m.mime || "") || istOffice(m);

  const ansehen = async (m) => {
    // Sofort das Fenster mit „lädt …" oeffnen: eine 5-MB-Datei braucht ein paar
    // Sekunden, und ohne Rueckmeldung wirkt der Klick wie verschluckt — man
    // klickt dann noch zweimal.
    const office = istOffice(m);
    setVorschau({ url: null, name: m.filename, mime: office ? "application/pdf" : m.mime, laedt: true, office });
    // Office geht ueber /pdf (wandelt beim ersten Mal), alles andere direkt.
    const res = await fetch(`${API}/${m.id}/${office ? "pdf" : "download"}`).catch(() => null);
    if (!res || !res.ok) {
      const b = res ? await res.json().catch(() => ({})) : {};
      setVorschau(null);
      setErr(typeof b.detail === "string" ? b.detail : t("common.notWork"));
      return;
    }
    const blob = await res.blob();
    // Typ mitgeben: ohne ihn zeigt der Browser ein PDF als Download-Dialog.
    const typ = office ? "application/pdf" : (m.mime || blob.type);
    setVorschau({ url: URL.createObjectURL(blob.slice(0, blob.size, typ)), name: m.filename, mime: typ, office });
  };

  const download = async (m) => {
    const res = await fetch(`${API}/${m.id}/download`).catch(() => null);
    if (!res || !res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = m.filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  const remove = (m) => {
    setItems((prev) => prev.filter((x) => x.id !== m.id));
    undoDelete({
      message: t("undo.deleted", { name: m.filename }),
      undo: () => load(),
      commit: async () => { await fetch(`${API}/${m.id}`, { method: "DELETE" }).catch(() => {}); },
    });
  };

  if (nurLesen && items.length === 0) return null;

  const row = { display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderTop: "1px solid var(--border)", fontSize: 14 };

  return (
    <div style={{ ...cardStyle, marginBottom: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
        {titel || t("material.title")}
        <span style={chipStyle}>{items.length}</span>
        {!nurLesen && (
          <label style={{ ...btnSecondary, ...btnSmall, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1, marginLeft: "auto" }}>
            {busy ? (fortschritt == null ? t("material.uploading") : `${t("material.uploading")} ${fortschritt} %`) : t("material.upload")}
            <input type="file" style={{ display: "none" }} disabled={busy}
              onChange={(e) => { const f = e.target.files[0]; e.target.value = ""; upload(f); }} />
          </label>
        )}
      </div>
      {/* Der Balken sagt, was die Prozentzahl allein nicht sagt: dass es
          weitergeht. Bei unbekannter Gesamtgroesse (selten) bleibt er auf
          voller Breite gedaempft — „laeuft, Dauer unbekannt". */}
      <Fortschrittsbalken wert={busy ? fortschritt : undefined} />
      {err && <p style={{ color: C.danger, fontSize: 13, margin: "0 0 8px" }}>{err}</p>}
      {items.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--text3)", margin: 0 }}>{t("material.empty")}</p>
      ) : items.map((m) => (
        <div key={m.id} style={row}>
          <button onClick={() => (ansehbar(m) ? ansehen(m) : download(m))}
            title={ansehbar(m) ? t("material.open") : t("material.noPreviewOther")}
            aria-label={ansehbar(m) ? t("material.open") : t("material.download")}
            style={{ flex: 1, minWidth: 0, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", border: "none", background: "none", cursor: "pointer", color: "var(--accent)", fontWeight: 600, fontSize: 14, padding: 0 }}>
            {m.filename}
          </button>
          <span style={{ fontSize: 12, color: "var(--text3)" }}>{fmtSize(m.size)}</span>
          {/* Speichern bleibt erreichbar, auch wenn der Klick jetzt anzeigt. */}
          {ansehbar(m) && (
            <button onClick={() => download(m)} title={t("material.download")} aria-label={t("material.download")}
              style={{ ...iconBtn, color: "var(--text3)", padding: 4 }}>
              <Icon d={ICONS.download} size={15} />
            </button>
          )}
          {!nurLesen && (
            <button onClick={async () => { if (await askConfirm(t("material.delConfirm", { name: m.filename }))) remove(m); }} title={t("common.delete")} aria-label={t("common.delete")}
              style={{ ...iconBtn, color: "var(--text3)", padding: 4 }}>
              <Icon d={ICONS.trash} size={15} />
            </button>
          )}
        </div>
      ))}

      {vorschau && (
        <Modal onClose={() => setVorschau(null)} width={900} label={vorschau.name}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 16, fontWeight: 700, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{vorschau.name}</span>
            {vorschau.url && (
              <>
                {/* Neuer Tab als Ausweg: der eingebettete PDF-Betrachter des
                    Browsers kann in manchen Fenstergroessen unbrauchbar klein
                    werden, und manche Browser zeigen PDFs nur im Tab. */}
                <a href={vorschau.url} target="_blank" rel="noreferrer" style={{ ...btnSecondary, ...btnSmall, textDecoration: "none" }}>{t("material.newTab")}</a>
                <a href={vorschau.url} download={vorschau.name} style={{ ...btnSecondary, ...btnSmall, textDecoration: "none" }}>{t("material.download")}</a>
              </>
            )}
          </div>
          {!vorschau.url ? (
            <div style={{ height: "72vh", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text3)", fontSize: 14, border: "1px solid var(--border)", borderRadius: CONTROL_R }}>
              {vorschau.office ? t("material.converting") : t("material.loading")}
            </div>
          ) : /^image\//.test(vorschau.mime || "") ? (
            <img src={vorschau.url} alt={vorschau.name} style={{ maxWidth: "100%", maxHeight: "72vh", display: "block", margin: "0 auto" }} />
          ) : (
            <iframe title={vorschau.name} src={vorschau.url} style={{ width: "100%", height: "72vh", border: "1px solid var(--border)", borderRadius: CONTROL_R }} />
          )}
        </Modal>
      )}
    </div>
  );
}
