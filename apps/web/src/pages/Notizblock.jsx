// Modul Notizblock — freie Notizzettel (Titel + Text). Mehrere Zettel, per
// Drag&Drop sortierbar. Eigenständig (Regel 3), keine Schülerbindung.
//
// Früher speicherte die Seite von selbst (600 ms nach dem letzten Tastendruck)
// und schickte jede Umsortierung sofort. Beides ist jetzt ein Entwurf mit einem
// Speichern-Knopf: wo sich etwas ändern lässt, entscheidet der Mensch, wann es
// gilt — sonst fragt man sich, ob es drin ist.
import { useState, useEffect, useMemo, useRef } from "react";
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
    // Groesse je Zettel als "BxH" — ein String, damit der flache Vergleich in
    // useEntwurf greift (ein Objekt je Zettel waere bei jedem Rendern neu).
    groessen: notes.map((n) => `${n.width || 0}x${n.height || 0}`),
  }), [notes]);
  const entwurf = useEntwurf(gespeichert, async (wert) => {
    const put = (url, body) => fetch(url, alsJson("PUT", body))
      .then((r) => r.ok).catch(() => false);
    let ok = true;
    if (String(wert.ids) !== String(gespeichert.ids)) ok = (await put(`${API}/reorder`, { ids: wert.ids })) && ok;
    const alt = Object.fromEntries(gespeichert.ids.map((id, i) => [id, [gespeichert.titel[i], gespeichert.texte[i], gespeichert.groessen[i]]]));
    for (let i = 0; i < wert.ids.length; i++) {
      const id = wert.ids[i], a = alt[id];
      if (!a || (a[0] === wert.titel[i] && a[1] === wert.texte[i] && a[2] === wert.groessen[i])) continue;
      const [w, h] = String(wert.groessen[i] || "0x0").split("x").map((x) => parseInt(x, 10) || 0);
      ok = (await put(`${API}/${id}`, { title: wert.titel[i], content: wert.texte[i], width: w, height: h })) && ok;
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
        groessen: ord.map((id) => (v.ids.includes(id) ? v.groessen[v.ids.indexOf(id)] : `${von[id]?.width || 0}x${von[id]?.height || 0}`)),
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

  // Die gezogene Groesse in den Entwurf schreiben — gespeichert wird wie alles
  // andere per Knopf. Ein ResizeObserver je Zettel statt eines eigenen
  // Maus-Handlers: der Browser zieht den Griff selbst (CSS `resize`), wir
  // lesen nur das Ergebnis.
  const beobachter = useRef(new Map());
  const beobachteGroesse = (el, idx) => {
    const alt = beobachter.current.get(idx);
    if (alt) { alt.disconnect(); beobachter.current.delete(idx); }
    if (!el || typeof ResizeObserver === "undefined") return;
    // Die erste Meldung kommt vom Einhaengen, nicht vom Ziehen — sonst stuende
    // die Maske sofort auf „nicht gespeichert", ohne dass jemand etwas tat.
    let erste = true;
    const ro = new ResizeObserver((eintraege) => {
      const r = eintraege[0]?.contentRect;
      if (!r) return;
      if (erste) { erste = false; return; }
      const w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight);
      entwurf.setz((v) => {
        const neu = `${w}x${h}`;
        if (v.groessen[idx] === neu) return {};
        return { groessen: v.groessen.map((x, i) => (i === idx ? neu : x)) };
      });
    });
    ro.observe(el);
    beobachter.current.set(idx, ro);
  };
  useEffect(() => () => { beobachter.current.forEach((ro) => ro.disconnect()); beobachter.current.clear(); }, []);

  // Angezeigt wird der Entwurf, nicht der Serverstand.
  const bekannt = Object.fromEntries(notes.map((n) => [n.id, n]));
  const view = entwurf.wert.ids
    .map((id, i) => (bekannt[id] ? { id, title: entwurf.wert.titel[i], content: entwurf.wert.texte[i], groesse: entwurf.wert.groessen[i] || "0x0", idx: i } : null))
    .filter(Boolean);

  // Ziehen mit Live-Vorschau — dieselbe Mechanik wie bei den To-dos und den
  // Fragen im Quiz, seit dem Zusammenfuehren nur noch in
  // core/ziehsortieren.js. Das Ablegen ordnet den ENTWURF um; gespeichert wird
  // per Knopf.
  const zieh = useZiehVorschau(view, (arr) => entwurf.setz((v) => {
    const pos = arr.map((n) => v.ids.indexOf(n.id));
    return { ids: pos.map((i) => v.ids[i]), titel: pos.map((i) => v.titel[i]), texte: pos.map((i) => v.texte[i]), groessen: pos.map((i) => v.groessen[i]) };
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
        // Flex statt Raster: ein Zettel darf eine eigene Breite haben, und in
        // einer Rasterzelle waere sie eine Luege (die Zelle bleibt, der Zettel
        // ragt heraus). Ohne eigene Groesse bleibt es bei den 260 px von vorher.
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-start" }}>
          {zieh.sichtbar.map((n, idx) => {
            const [bW, bH] = String(n.groesse || "0x0").split("x").map((x) => parseInt(x, 10) || 0);
            return (
            <div key={n.id} {...zieh.props(idx)}
              ref={(el) => beobachteGroesse(el, n.idx)}
              style={{ ...cardStyle, display: "flex", flexDirection: "column", padding: 12, boxShadow: SHADOW.ruhig,
                // resize braucht overflow != visible, sonst zeichnet kein
                // Browser den Griff.
                resize: "both", overflow: "auto",
                width: bW || 260, height: bH || undefined, minWidth: 200, minHeight: 140,
                boxSizing: "border-box" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 8 }}>
                <span className="drag-handle" title={t("notizblock.reorderHint")} style={{ color: "var(--text3)", cursor: "grab", display: "inline-flex", flexShrink: 0 }}><Icon d={ICONS.grip} size={15} /></span>
                <input value={n.title} onChange={(e) => patch(n.idx, "titel", e.target.value)} placeholder={t("notizblock.titlePlaceholder")}
                  style={{ ...inputStyle, flex: 1, minWidth: 0, fontWeight: 700, padding: "6px 8px", border: "none", background: "transparent" }} />
                <button onClick={() => del(n.id)} className="icon-btn" style={{ ...iconBtn, padding: 4, flexShrink: 0 }} title={t("common.delete")} aria-label={t("common.delete")}><Icon d={ICONS.trash} size={15} color={C.danger} /></button>
              </div>
              <textarea value={n.content} onChange={(e) => patch(n.idx, "texte", e.target.value)} placeholder={t("notizblock.placeholder")} rows={7}
                style={{ ...inputStyle, width: "100%", flex: 1, boxSizing: "border-box", resize: "none", fontSize: 14, lineHeight: 1.5, border: "none", background: "transparent", padding: "4px 8px" }} />
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
