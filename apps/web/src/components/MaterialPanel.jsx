// Wiederverwendbares Material-/Datei-Panel. Haengt an ein Thema (topicId) oder
// eine Stunde (entryId) — genau eins von beiden setzen. Kern-Feature, kein
// Modul-Gate. Download laeuft ueber fetch (Bearer-Token), nicht ueber <a href>,
// weil eine Browser-Navigation den Token nicht mitschickt.
import { useState, useEffect } from "react";
import { Icon, ICONS, btnSecondary } from "./Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { undoDelete } from "../core/undo.jsx";
import { askConfirm } from "../core/dialog.jsx";

const API = "/api/material";

function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function MaterialPanel({ topicId = null, entryId = null }) {
  const { t } = useLanguage();
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const q = topicId != null ? `?topic_id=${topicId}` : `?entry_id=${entryId}`;
  const load = () => fetch(`${API}${q}`).then((r) => (r.ok ? r.json() : [])).then((d) => setItems(Array.isArray(d) ? d : [])).catch(() => {});
  useEffect(() => { load(); }, [topicId, entryId]);

  const upload = async (file) => {
    if (!file) return;
    setErr(""); setBusy(true);
    const fd = new FormData();
    fd.append("file", file);
    if (topicId != null) fd.append("topic_id", String(topicId));
    if (entryId != null) fd.append("entry_id", String(entryId));
    const res = await fetch(API, { method: "POST", body: fd }).catch(() => null);
    setBusy(false);
    if (res && res.ok) load();
    else { const b = res ? await res.json().catch(() => ({})) : {}; setErr(typeof b.detail === "string" ? b.detail : t("common.notWork")); }
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
        {t("material.title")}
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text3)", background: "var(--bg2)", borderRadius: 980, padding: "1px 9px" }}>{items.length}</span>
        <label style={{ ...btnSecondary, padding: "5px 12px", fontSize: 12.5, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1, marginLeft: "auto" }}>
          {busy ? t("material.uploading") : t("material.upload")}
          <input type="file" style={{ display: "none" }} disabled={busy}
            onChange={(e) => { const f = e.target.files[0]; e.target.value = ""; upload(f); }} />
        </label>
      </div>
      {err && <p style={{ color: "#d1350f", fontSize: 12.5, margin: "0 0 8px" }}>{err}</p>}
      {items.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--text3)", margin: 0 }}>{t("material.empty")}</p>
      ) : items.map((m) => (
        <div key={m.id} style={row}>
          <button onClick={() => download(m)} title={t("material.download")}
            style={{ flex: 1, minWidth: 0, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", border: "none", background: "none", cursor: "pointer", color: "var(--accent)", fontWeight: 600, fontSize: 13.5, padding: 0 }}>
            {m.filename}
          </button>
          <span style={{ fontSize: 12, color: "var(--text3)" }}>{fmtSize(m.size)}</span>
          <button onClick={async () => { if (await askConfirm(t("material.delConfirm", { name: m.filename }))) remove(m); }} title={t("common.delete")}
            style={{ border: "none", background: "none", cursor: "pointer", color: "var(--text3)", display: "inline-flex", padding: 2 }}>
            <Icon d={ICONS.trash} size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}
