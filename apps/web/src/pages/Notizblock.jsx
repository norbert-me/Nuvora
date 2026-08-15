// Modul Notizblock — freie Notizzettel (Titel + Text). Mehrere Zettel, per
// Drag&Drop sortierbar. Eigenständig (Regel 3), keine Schülerbindung.
//
// Früher speicherte die Seite von selbst (600 ms nach dem letzten Tastendruck)
// und schickte jede Umsortierung sofort. Beides ist jetzt ein Entwurf mit einem
// Speichern-Knopf: wo sich etwas ändern lässt, entscheidet der Mensch, wann es
// gilt — sonst fragt man sich, ob es drin ist.
import { useState, useEffect, useMemo } from "react";
import { pageTitle, btnPrimary, cardStyle, inputStyle, Icon, ICONS, iconBtn, COLORS as C, Empty, SHADOW } from "../components/Icons.jsx";
import Speicherleiste, { useEntwurf } from "../components/Speichern.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { useZiehVorschau } from "../core/ziehsortieren.js";
import { alsJson, hol } from "../core/melden.js";

const API = "/api/notizblock";

export default function Notizblock({ embedded } = {}) {
  const { t } = useLanguage();
  const [notes, setNotes] = useState([]);

  const load = () => hol(API).then((d) => setNotes(Array.isArray(d) ? d : []));
  useEffect(() => { load(); }, []);

  // Arbeitskopie aller Zettel: Reihenfolge, Titel und Text laufen als drei
  // parallele Listen einfacher Werte — so greift der flache Vergleich in
  // useEntwurf.
  const gespeichert = useMemo(() => ({
    ids: notes.map((n) => n.id),
    titel: notes.map((n) => n.title || ""),
    texte: notes.map((n) => n.content || ""),
  }), [notes]);
  const entwurf = useEntwurf(gespeichert, async (wert) => {
    const put = (url, body) => fetch(url, alsJson("PUT", body))
      .then((r) => r.ok).catch(() => false);
    let ok = true;
    if (String(wert.ids) !== String(gespeichert.ids)) ok = (await put(`${API}/reorder`, { ids: wert.ids })) && ok;
    const alt = Object.fromEntries(gespeichert.ids.map((id, i) => [id, [gespeichert.titel[i], gespeichert.texte[i]]]));
    for (let i = 0; i < wert.ids.length; i++) {
      const id = wert.ids[i], a = alt[id];
      if (!a || (a[0] === wert.titel[i] && a[1] === wert.texte[i])) continue;
      ok = (await put(`${API}/${id}`, { title: wert.titel[i], content: wert.texte[i] })) && ok;
    }
    if (!ok) return false;
    await load();
  });

  // Anlegen und Löschen sind Befehle und bleiben sofortig. Der Entwurf zieht
  // mit, sonst verschwände ein neuer Zettel hinter einer offenen Umsortierung.
  // WELCHE Zettel es gibt, sagt der Server; Reihenfolge und Inhalt sagt der
  // Entwurf. Nur bei OFFENEN Änderungen muss das von Hand abgeglichen werden
  // (ein eben angelegter Zettel, ein gelöschter) — sonst zieht `useEntwurf`
  // den neuen Stand selbst nach, und ein ungefragtes `setz` würde die Maske
  // fälschlich als „angefasst" markieren.
  useEffect(() => {
    if (!entwurf.geaendert) return;
    const ids = notes.map((n) => n.id);
    if (String([...entwurf.wert.ids].sort()) === String([...ids].sort())) return;
    entwurf.setz((v) => {
      const behalten = v.ids.filter((id) => ids.includes(id));
      const neue = ids.filter((id) => !v.ids.includes(id));
      const ord = [...neue, ...behalten]; // neue Zettel kommen nach oben
      const von = Object.fromEntries(notes.map((n) => [n.id, n]));
      return {
        ids: ord,
        titel: ord.map((id) => (v.ids.includes(id) ? v.titel[v.ids.indexOf(id)] : (von[id]?.title || ""))),
        texte: ord.map((id) => (v.ids.includes(id) ? v.texte[v.ids.indexOf(id)] : (von[id]?.content || ""))),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes]);

  // Anlegen und Löschen sind Befehle und bleiben sofortig — den Entwurf zieht
  // der Abgleich oben nach.
  const add = async () => {
    const r = await fetch(API, alsJson("POST", { title: "", content: "" })).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    if (r) setNotes((p) => [r, ...p]);
  };
  const del = async (id) => {
    setNotes((p) => p.filter((n) => n.id !== id));
    await fetch(`${API}/${id}`, { method: "DELETE" }).catch(() => {});
  };
  const patch = (idx, feld, value) => entwurf.setz((v) => ({ [feld]: v[feld].map((x, i) => (i === idx ? value : x)) }));

  // Angezeigt wird der Entwurf, nicht der Serverstand.
  const bekannt = Object.fromEntries(notes.map((n) => [n.id, n]));
  const view = entwurf.wert.ids
    .map((id, i) => (bekannt[id] ? { id, title: entwurf.wert.titel[i], content: entwurf.wert.texte[i], idx: i } : null))
    .filter(Boolean);

  // Ziehen mit Live-Vorschau — dieselbe Mechanik wie bei den To-dos und den
  // Fragen im Quiz, seit dem Zusammenfuehren nur noch in
  // core/ziehsortieren.js. Das Ablegen ordnet den ENTWURF um; gespeichert wird
  // per Knopf.
  const zieh = useZiehVorschau(view, (arr) => entwurf.setz((v) => {
    const pos = arr.map((n) => v.ids.indexOf(n.id));
    return { ids: pos.map((i) => v.ids[i]), titel: pos.map((i) => v.titel[i]), texte: pos.map((i) => v.texte[i]) };
  }));
  return (
    <div style={{ maxWidth: embedded ? "none" : 900, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        {embedded ? <span style={{ flex: 1 }} /> : <h1 style={{ ...pageTitle, marginBottom: 4, flex: 1 }}>{t("notizblock.title")}</h1>}
        <Speicherleiste entwurf={entwurf} />
        <button onClick={add} style={{ ...btnPrimary, display: "inline-flex", alignItems: "center", gap: 4 }}><Icon d={ICONS.plus} size={15} color="var(--bg)" /> {t("notizblock.new")}</button>
      </div>

      {view.length === 0 ? (
        <Empty title={t("notizblock.empty")} hint={t("notizblock.emptyHint")} action={t("notizblock.new")} onAction={add} />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
          {zieh.sichtbar.map((n, idx) => (
            <div key={n.id} {...zieh.props(idx)}
              style={{ ...cardStyle, display: "flex", flexDirection: "column", padding: 12, boxShadow: SHADOW.ruhig }}>
              <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 8 }}>
                <span className="drag-handle" title={t("notizblock.reorderHint")} style={{ color: "var(--text3)", cursor: "grab", display: "inline-flex", flexShrink: 0 }}><Icon d={ICONS.grip} size={15} /></span>
                <input value={n.title} onChange={(e) => patch(n.idx, "titel", e.target.value)} placeholder={t("notizblock.titlePlaceholder")}
                  style={{ ...inputStyle, flex: 1, minWidth: 0, fontWeight: 700, padding: "6px 8px", border: "none", background: "transparent" }} />
                <button onClick={() => del(n.id)} className="icon-btn" style={{ ...iconBtn, padding: 4, flexShrink: 0 }} title={t("common.delete")} aria-label={t("common.delete")}><Icon d={ICONS.trash} size={15} color={C.danger} /></button>
              </div>
              <textarea value={n.content} onChange={(e) => patch(n.idx, "texte", e.target.value)} placeholder={t("notizblock.placeholder")} rows={7}
                style={{ ...inputStyle, width: "100%", boxSizing: "border-box", resize: "vertical", fontSize: 14, lineHeight: 1.5, border: "none", background: "transparent", padding: "4px 8px" }} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
