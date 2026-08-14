// Wiederverwendbares Material-/Datei-Panel. Haengt an ein Thema (topicId), eine
// Stunde (entryId), einen Einstieg (methodId) oder eine Klassenarbeit (workId)
// — genau eins davon setzen. Bei der Klassenarbeit sagt `rolle` zusaetzlich,
// WOFUER die Datei steht ("arbeit"/"erwartung"); `titel` benennt den Kasten
// entsprechend. Kern-Feature, kein Modul-Gate. Download laeuft ueber fetch (Bearer-Token), nicht ueber <a href>,
// weil eine Browser-Navigation den Token nicht mitschickt.
import { useState, useEffect } from "react";
import { Icon, ICONS, btnSecondary, COLORS as C, Modal } from "./Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { undoDelete } from "../core/undo.jsx";
import { askConfirm } from "../core/dialog.jsx";

const API = "/api/material";

function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function MaterialPanel({ topicId = null, entryId = null, methodId = null,
                                       workId = null, rolle = null, titel = null }) {
  const { t } = useLanguage();
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [vorschau, setVorschau] = useState(null);   // { url, name, mime }

  // Blob-Adresse wieder freigeben, sonst haelt der Tab die Datei im Speicher.
  useEffect(() => () => { if (vorschau) URL.revokeObjectURL(vorschau.url); }, [vorschau]);

  const q = topicId != null ? `?topic_id=${topicId}`
    : methodId != null ? `?method_id=${methodId}`
    : workId != null ? `?work_id=${workId}${rolle != null ? `&rolle=${rolle}` : ""}`
    : `?entry_id=${entryId}`;
  const load = () => fetch(`${API}${q}`).then((r) => (r.ok ? r.json() : [])).then((d) => setItems(Array.isArray(d) ? d : [])).catch(() => {});
  useEffect(() => { load(); }, [topicId, entryId, methodId, workId, rolle]);

  const upload = async (file) => {
    if (!file) return;
    setErr(""); setBusy(true);
    const fd = new FormData();
    fd.append("file", file);
    if (topicId != null) fd.append("topic_id", String(topicId));
    if (entryId != null) fd.append("entry_id", String(entryId));
    if (methodId != null) fd.append("method_id", String(methodId));
    if (workId != null) fd.append("work_id", String(workId));
    if (rolle) fd.append("rolle", rolle);
    const res = await fetch(API, { method: "POST", body: fd }).catch(() => null);
    setBusy(false);
    if (res && res.ok) load();
    else { const b = res ? await res.json().catch(() => ({})) : {}; setErr(typeof b.detail === "string" ? b.detail : t("common.notWork")); }
  };

  // Was der Browser selbst zeigen kann, wird gezeigt — ein Klick, Datei da.
  // Alles andere (docx, zip …) bleibt ein Download: dafuer gibt es im Browser
  // keine Anzeige, und ein leeres Fenster waere schlechter als eine Datei.
  const ansehbar = (m) => /^application\/pdf$|^image\//.test(m.mime || "");

  const ansehen = async (m) => {
    const res = await fetch(`${API}/${m.id}/download`).catch(() => null);
    if (!res || !res.ok) return;
    const blob = await res.blob();
    // Typ mitgeben: ohne ihn zeigt der Browser ein PDF als Download-Dialog.
    setVorschau({ url: URL.createObjectURL(blob.slice(0, blob.size, m.mime || blob.type)), name: m.filename, mime: m.mime });
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

  const row = { display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderTop: "1px solid var(--border)", fontSize: 13.5 };

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--card)", padding: 16, marginBottom: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
        {titel || t("material.title")}
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text3)", background: "var(--bg2)", borderRadius: 980, padding: "1px 9px" }}>{items.length}</span>
        <label style={{ ...btnSecondary, padding: "5px 12px", fontSize: 12.5, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1, marginLeft: "auto" }}>
          {busy ? t("material.uploading") : t("material.upload")}
          <input type="file" style={{ display: "none" }} disabled={busy}
            onChange={(e) => { const f = e.target.files[0]; e.target.value = ""; upload(f); }} />
        </label>
      </div>
      {err && <p style={{ color: C.danger, fontSize: 12.5, margin: "0 0 8px" }}>{err}</p>}
      {items.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--text3)", margin: 0 }}>{t("material.empty")}</p>
      ) : items.map((m) => (
        <div key={m.id} style={row}>
          <button onClick={() => (ansehbar(m) ? ansehen(m) : download(m))}
            title={ansehbar(m) ? t("material.open") : t("material.noPreview")}
            aria-label={ansehbar(m) ? t("material.open") : t("material.download")}
            style={{ flex: 1, minWidth: 0, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", border: "none", background: "none", cursor: "pointer", color: "var(--accent)", fontWeight: 600, fontSize: 13.5, padding: 0 }}>
            {m.filename}
          </button>
          <span style={{ fontSize: 12, color: "var(--text3)" }}>{fmtSize(m.size)}</span>
          {/* Speichern bleibt erreichbar, auch wenn der Klick jetzt anzeigt. */}
          {ansehbar(m) && (
            <button onClick={() => download(m)} title={t("material.download")} aria-label={t("material.download")}
              style={{ border: "none", background: "none", cursor: "pointer", color: "var(--text3)", display: "inline-flex", padding: 2 }}>
              <Icon d={ICONS.download} size={15} />
            </button>
          )}
          <button onClick={async () => { if (await askConfirm(t("material.delConfirm", { name: m.filename }))) remove(m); }} title={t("common.delete")} aria-label={t("common.delete")}
            style={{ border: "none", background: "none", cursor: "pointer", color: "var(--text3)", display: "inline-flex", padding: 2 }}>
            <Icon d={ICONS.trash} size={15} />
          </button>
        </div>
      ))}

      {vorschau && (
        <Modal onClose={() => setVorschau(null)} width={900} label={vorschau.name}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 700, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{vorschau.name}</span>
            <a href={vorschau.url} download={vorschau.name} style={{ ...btnSecondary, padding: "5px 12px", fontSize: 12.5, textDecoration: "none" }}>{t("material.download")}</a>
          </div>
          {/^image\//.test(vorschau.mime || "") ? (
            <img src={vorschau.url} alt={vorschau.name} style={{ maxWidth: "100%", maxHeight: "72vh", display: "block", margin: "0 auto" }} />
          ) : (
            <iframe title={vorschau.name} src={vorschau.url} style={{ width: "100%", height: "72vh", border: "1px solid var(--border)", borderRadius: 8 }} />
          )}
        </Modal>
      )}
    </div>
  );
}
